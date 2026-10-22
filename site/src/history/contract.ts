import { METRICS } from './types.ts';
import type {
  Catalog, CatalogRequest, Counts, Envelope, Groups, HistoryRange, MetricPoint, ModelDetail,
  RangeBucket, RangeRequest, SnapshotCursor, Trial,
} from './types.ts';

type ObjectValue = Record<string, unknown>;
function fail(path: string): never { throw new Error(`HISTORY_CONTRACT:${path}`); }
function object(value: unknown, path: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path);
  return value as ObjectValue;
}
function closed(value: unknown, path: string, keys: string): ObjectValue {
  const result = object(value, path);
  const expected = keys.split(' ');
  if (Object.keys(result).length !== expected.length || expected.some(key => !Object.hasOwn(result, key))) fail(`${path}.keys`);
  return result;
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) fail(path);
  return value;
}
function nullableText(value: unknown, path: string) { return value === null ? null : text(value, path); }
function identity(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(result)) fail(path);
  return result;
}
function hash(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^[0-9a-f]{64}$/.test(result)) fail(path);
  return result;
}
export const METHODS = { Brier: 'BRIER_V1', NRPS: 'NRPS_V1', MAE: 'MAE_V1', ECE: 'ECE10' } as const;
function integer(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(path);
  return value;
}
function oneOf<T extends string>(value: unknown, options: readonly T[], path: string): T {
  if (typeof value !== 'string' || !options.includes(value as T)) fail(path);
  return value as T;
}
function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(path);
  return value;
}
function score(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e12) fail(path);
  return value;
}
const statuses = ['FINISHED', 'FAILED', 'HELD', 'RUNNING'] as const;
function fixture(value: unknown, path: string) {
  if (value !== 'ARTIFICIAL_SCALE_FIXTURE') fail(path);
}
export function verifyEnvelope<T>(value: unknown, verify: (data: unknown) => T): Envelope<T> {
  const envelope = closed(value, 'envelope', 'schemaVersion sourceKind historyGenerationId snapshotCursor servedAt data');
  if (envelope.schemaVersion !== 'history-monitor-v1') fail('schemaVersion');
  fixture(envelope.sourceKind, 'sourceKind');
  identity(envelope.historyGenerationId, 'historyGenerationId');
  integer(envelope.snapshotCursor, 'snapshotCursor');
  const servedAt = text(envelope.servedAt, 'servedAt');
  if (!Number.isFinite(Date.parse(servedAt))) fail('servedAt');
  const data = verify(envelope.data);
  return { ...envelope, data } as Envelope<T>;
}
export function verifyAnchor(
  envelope: Envelope<unknown>,
  expected: { historyGenerationId: string; snapshotCursor: SnapshotCursor },
) {
  if (envelope.historyGenerationId !== expected.historyGenerationId) fail('generation.mismatch');
  if (envelope.snapshotCursor !== expected.snapshotCursor) fail('snapshot.mismatch');
}
export function verifyTrial(value: unknown): Trial {
  const row = closed(value, 'trial', 'trialId trialOrdinal runId attemptId cycleIndex role modelId modelRevisionRef modelDefinitionId evaluationId reportId reportRef groupRef status registrationState numericValidity metrics support sourceKind');
  for (const name of ['trialId', 'runId', 'attemptId', 'modelId', 'modelDefinitionId', 'evaluationId']) {
    identity(row[name], `trial.${name}`);
  }
  hash(row.modelRevisionRef, 'trial.modelRevisionRef');
  hash(row.groupRef, 'trial.groupRef');
  integer(row.trialOrdinal, 'trial.trialOrdinal', 1);
  integer(row.cycleIndex, 'trial.cycleIndex');
  oneOf(row.role, ['BASELINE', 'CANDIDATE', 'REEVALUATION'], 'trial.role');
  oneOf(row.status, statuses, 'trial.status');
  const registration = oneOf(row.registrationState, ['REGISTERED_VERIFIED', 'NOT_REGISTERED', 'INVALID'], 'trial.registrationState');
  const validity = oneOf(row.numericValidity, ['DEFINED', 'NULL', 'INVALID', 'UNREGISTERED'], 'trial.numericValidity');
  if (row.reportId !== null) identity(row.reportId, 'trial.reportId');
  if (row.reportRef !== null) hash(row.reportRef, 'trial.reportRef');
  const metrics = closed(row.metrics, 'trial.metrics', 'Brier NRPS MAE ECE');
  for (const metric of METRICS) {
    const value = score(metrics[metric], `trial.metrics.${metric}`);
    if ((registration !== 'REGISTERED_VERIFIED' || validity !== 'DEFINED') && value !== null) fail(`trial.unregistered.${metric}`);
  }
  if (registration === 'REGISTERED_VERIFIED' && validity === 'DEFINED' && (!row.reportId || !row.reportRef)) fail('trial.reportIdentity');
  const support = closed(row.support, 'trial.support', 'rows');
  if (support.rows !== null) integer(support.rows, 'trial.support.rows');
  fixture(row.sourceKind, 'trial.sourceKind');
  return row as unknown as Trial;
}
export function verifyCatalog(value: unknown, request?: CatalogRequest): Envelope<Catalog> {
  return verifyEnvelope(value, data => {
    const catalog = closed(data, 'catalog', 'rows page scope');
    const rows = array(catalog.rows, 'catalog.rows', 100).map(verifyTrial);
    const page = closed(catalog.page, 'catalog.page', 'limit nextCursor hasMore');
    const limit = integer(page.limit, 'catalog.page.limit', 1, 100);
    if (rows.length > limit) fail('catalog.page.rowLimit');
    nullableText(page.nextCursor, 'catalog.page.nextCursor');
    if (typeof page.nextCursor === 'string' && page.nextCursor.length > 2048) fail('catalog.page.nextCursor');
    if (typeof page.hasMore !== 'boolean' || page.hasMore !== (page.nextCursor !== null)) fail('catalog.page.hasMore');
    const scope = closed(catalog.scope, 'catalog.scope', 'runId attemptId groupRef status direction');
    for (const key of ['runId', 'attemptId']) if (scope[key] !== null) identity(scope[key], `catalog.scope.${key}`);
    if (scope.groupRef !== null) hash(scope.groupRef, 'catalog.scope.groupRef');
    if (scope.status !== null) oneOf(scope.status, statuses, 'catalog.scope.status');
    const direction = oneOf(scope.direction, ['ASC', 'DESC'], 'catalog.scope.direction');
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      for (const key of ['runId', 'attemptId', 'groupRef', 'status'] as const) {
        if (scope[key] !== null && scope[key] !== row[key]) fail(`catalog.filter.${key}`);
      }
      if (index && (direction === 'ASC' ? rows[index - 1].trialOrdinal >= row.trialOrdinal : rows[index - 1].trialOrdinal <= row.trialOrdinal)) fail('catalog.order');
    }
    if (new Set(rows.map(row => row.trialId)).size !== rows.length) fail('catalog.duplicateTrial');
    if (request && (limit !== request.limit || direction !== 'DESC' || scope.groupRef !== (request.groupRef || null) ||
        scope.status !== (request.status || null) || scope.runId !== null || scope.attemptId !== null)) fail('catalog.requestMismatch');
    return { rows, page, scope } as unknown as Catalog;
  });
}
export function verifyGroups(value: unknown): Envelope<Groups> {
  return verifyEnvelope(value, data => {
    const result = closed(data, 'groups', 'groups trialExtent');
    const groups = array(result.groups, 'groups.groups', 16).map((value, index) => {
      const group = closed(value, `groups.${index}`, 'groupRef cohortRef scorerRef policyRef metricMethods objective');
      for (const key of ['groupRef', 'cohortRef', 'scorerRef', 'policyRef']) hash(group[key], `group.${key}`);
      if (group.objective !== 'MINIMIZE') fail('group.objective');
      const methods = closed(group.metricMethods, 'group.metricMethods', 'Brier NRPS MAE ECE');
      for (const metric of METRICS) if (methods[metric] !== METHODS[metric]) fail(`group.method.${metric}`);
      return group;
    });
    if (new Set(groups.map(group => group.groupRef)).size !== groups.length) fail('groups.duplicate');
    const extent = closed(result.trialExtent, 'groups.trialExtent', 'fromOrdinal toOrdinal');
    if (extent.fromOrdinal !== null || extent.toOrdinal !== null) {
      integer(extent.fromOrdinal, 'groups.extent.from', 1);
      integer(extent.toOrdinal, 'groups.extent.to', extent.fromOrdinal as number);
    }
    return { groups, trialExtent: extent } as unknown as Groups;
  });
}
function verifyCounts(value: unknown, path: string): Counts {
  const counts = closed(value, path, 'totalTrials validCount nullCount invalidCount unregisteredCount failedCount heldCount runningCount');
  for (const key of ['totalTrials', 'validCount', 'nullCount', 'invalidCount', 'unregisteredCount', 'failedCount', 'heldCount', 'runningCount']) integer(counts[key], `${path}.${key}`);
  const c = counts as unknown as Counts;
  if (c.validCount + c.nullCount + c.invalidCount + c.unregisteredCount !== c.totalTrials) fail(`${path}.partition`);
  if (c.failedCount + c.heldCount + c.runningCount > c.totalTrials) fail(`${path}.statuses`);
  return c;
}
export function verifyPoint(value: unknown, path = 'point'): MetricPoint {
  const point = closed(value, path, 'trialId trialOrdinal runId attemptId cycleIndex modelId evaluationId reportId reportRef status metricState value');
  for (const key of ['trialId', 'runId', 'attemptId', 'modelId', 'evaluationId']) identity(point[key], `${path}.${key}`);
  integer(point.trialOrdinal, `${path}.trialOrdinal`, 1);
  integer(point.cycleIndex, `${path}.cycleIndex`);
  if (point.reportId !== null) identity(point.reportId, `${path}.reportId`);
  if (point.reportRef !== null) hash(point.reportRef, `${path}.reportRef`);
  oneOf(point.status, statuses, `${path}.status`);
  const state = oneOf(point.metricState, ['VALID', 'NULL', 'INVALID', 'UNREGISTERED'], `${path}.metricState`);
  const metricValue = score(point.value, `${path}.value`);
  if (state === 'VALID' ? metricValue === null || !point.reportId || !point.reportRef : metricValue !== null) fail(`${path}.validity`);
  return point as unknown as MetricPoint;
}
function inWindow(point: MetricPoint, from: number, to: number, path: string) {
  if (point.trialOrdinal < from || point.trialOrdinal > to) fail(path);
}
function verifyBucket(value: unknown): RangeBucket {
  const bucket = closed(value, 'bucket', 'fromOrdinal toOrdinal first last min max continuity counts');
  const from = integer(bucket.fromOrdinal, 'bucket.fromOrdinal', 1);
  const to = integer(bucket.toOrdinal, 'bucket.toOrdinal', from, from + 1023);
  const counts = verifyCounts(bucket.counts, 'bucket.counts');
  const continuity = oneOf(bucket.continuity, ['ALL_VALID', 'HAS_GAPS', 'NO_VALID'], 'bucket.continuity');
  const points = (['first', 'last', 'min', 'max'] as const).map(key => {
    const point = bucket[key] === null ? null : verifyPoint(bucket[key], `bucket.${key}`);
    if (point) {
      if (point.metricState !== 'VALID') fail('bucket.sampleInvalid');
      inWindow(point, from, to, `bucket.${key}.outside`);
    }
    return point;
  });
  if (counts.validCount === 0 ? points.some(Boolean) || continuity !== 'NO_VALID' :
    points.some(point => point === null) || continuity !== (counts.validCount === counts.totalTrials ? 'ALL_VALID' : 'HAS_GAPS')) fail('bucket.continuity');
  const [first, last, min, max] = points;
  if (first && last && min && max) {
    if (first.trialOrdinal > last.trialOrdinal || min.value! > max.value! ||
      [first, last].some(point => point.value! < min.value! || point.value! > max.value!)) fail('bucket.extrema');
  }
  if (counts.totalTrials > to - from + 1) fail('bucket.countOverflow');
  return bucket as unknown as RangeBucket;
}
export function verifyRange(value: unknown, request?: RangeRequest): Envelope<HistoryRange> {
  const envelope = verifyEnvelope(value, data => {
    const range = closed(data, 'range', 'groupRef metric method objective mode fromOrdinal toOrdinal points buckets counts observedBestSoFar adoptedModel displayOnly');
    hash(range.groupRef, 'range.groupRef');
    const metric = oneOf(range.metric, METRICS, 'range.metric');
    if (range.method !== METHODS[metric]) fail('range.method');
    if (range.objective !== 'MINIMIZE' || range.displayOnly !== true || range.adoptedModel !== null) fail('range.semantics');
    const mode = oneOf(range.mode, ['RAW', 'MIN_MAX'], 'range.mode');
    const from = integer(range.fromOrdinal, 'range.fromOrdinal', 1);
    const to = integer(range.toOrdinal, 'range.toOrdinal', from, from + 9999);
    const points = array(range.points, 'range.points', 2000).map((point, index) => verifyPoint(point, `range.points.${index}`));
    const buckets = array(range.buckets, 'range.buckets', 500).map(verifyBucket);
    const counts = verifyCounts(range.counts, 'range.counts');
    if (mode === 'RAW' ? buckets.length > 0 : points.length > 0) fail('range.modePayload');
    points.forEach((point, index) => {
      inWindow(point, from, to, 'range.pointOutside');
      if (index && points[index - 1].trialOrdinal >= point.trialOrdinal) fail('range.pointOrder');
    });
    buckets.forEach((bucket, index) => {
      if (bucket.fromOrdinal < from || bucket.toOrdinal > to || (index && buckets[index - 1].toOrdinal >= bucket.fromOrdinal)) fail('range.bucketOrder');
    });
    const actualCounts = mode === 'RAW' ? {
      totalTrials: points.length,
      validCount: points.filter(point => point.metricState === 'VALID').length,
      nullCount: points.filter(point => point.metricState === 'NULL').length,
      invalidCount: points.filter(point => point.metricState === 'INVALID').length,
      unregisteredCount: points.filter(point => point.metricState === 'UNREGISTERED').length,
      failedCount: points.filter(point => point.status === 'FAILED').length,
      heldCount: points.filter(point => point.status === 'HELD').length,
      runningCount: points.filter(point => point.status === 'RUNNING').length,
    } : Object.fromEntries(Object.keys(counts).map(key => [
      key, buckets.reduce((sum, bucket) => sum + bucket.counts[key as keyof Counts], 0),
    ])) as unknown as Counts;
    for (const key of Object.keys(counts) as (keyof Counts)[]) if (counts[key] !== actualCounts[key]) fail(`range.counts.${key}`);
    const best = closed(range.observedBestSoFar, 'range.observedBestSoFar', 'carryIn end');
    const carry = best.carryIn === null ? null : verifyPoint(best.carryIn, 'range.best.carryIn');
    const end = best.end === null ? null : verifyPoint(best.end, 'range.best.end');
    if (carry && (carry.metricState !== 'VALID' || carry.trialOrdinal >= from)) fail('range.best.carryIn');
    if (end && (end.metricState !== 'VALID' || end.trialOrdinal > to)) fail('range.best.end');
    if (carry && (!end || end.value! > carry.value!)) fail('range.best.regression');
    if (counts.validCount > 0 && !end) fail('range.best.missing');
    if (request && (range.groupRef !== request.groupRef || metric !== request.metric || mode !== request.mode ||
      from !== request.fromOrdinal || to !== request.toOrdinal)) fail('range.requestMismatch');
    return range as unknown as HistoryRange;
  });
  if (request) verifyAnchor(envelope, request);
  return envelope;
}
export function verifyTrialDetail(
  value: unknown, expected: { trialId: string; historyGenerationId: string; snapshotCursor: SnapshotCursor },
): Envelope<{ trial: Trial }> {
  const envelope = verifyEnvelope(value, data => ({ trial: verifyTrial(closed(data, 'detail', 'trial').trial) }));
  verifyAnchor(envelope, expected);
  if (envelope.data.trial.trialId !== expected.trialId) fail('trial.idMismatch');
  return envelope;
}
export function verifyModelDetail(
  value: unknown, expected: { modelId: string; modelRevisionRef: string; historyGenerationId: string; snapshotCursor: SnapshotCursor },
): Envelope<ModelDetail> {
  const envelope = verifyEnvelope(value, data => {
    const detail = closed(data, 'modelDetail', 'model requestedModelRevisionRef');
    const model = closed(detail.model, 'model', 'modelId modelDefinitionId modelRevisionRef codeRef recipeRef dataRef weightsRef manifestRef sourceKind verificationKind');
    for (const key of ['modelId', 'modelDefinitionId']) identity(model[key], `model.${key}`);
    for (const key of ['modelRevisionRef', 'codeRef', 'recipeRef', 'dataRef', 'weightsRef', 'manifestRef']) hash(model[key], `model.${key}`);
    if (model.verificationKind !== 'ARTIFICIAL_METADATA_ONLY') fail('model.verificationKind');
    fixture(model.sourceKind, 'model.sourceKind');
    if (model.modelId !== expected.modelId || model.modelRevisionRef !== expected.modelRevisionRef ||
      detail.requestedModelRevisionRef !== expected.modelRevisionRef) fail('model.identityMismatch');
    return detail as unknown as ModelDetail;
  });
  verifyAnchor(envelope, expected);
  return envelope;
}
