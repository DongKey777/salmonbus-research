import { EXECUTION_MODES, FULL_PHASES, PARTIAL_VERIFICATION_STATUSES, RSS_MEASUREMENT_KINDS } from './types.ts';
import type { FullTrainingProgress } from './types.ts';

function fail(path: string): never { throw new Error(`FULL_PREPARATION_CONTRACT:${path}`); }
function closed(value: unknown, keys: string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path);
  const object = value as Record<string, unknown>;
  if (Object.keys(object).length !== keys.length || keys.some(key => !Object.hasOwn(object, key))) fail(`${path}.keys`);
  return object;
}
function integer(value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) fail(path);
}
function optionalInteger(value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER) {
  if (value !== null) integer(value, path, maximum);
}
function nonnegative(value: unknown, path: string) {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) fail(path);
}
function timestamp(value: unknown, path: string, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.length > 64 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))) fail(path);
}
export function verifyFullTrainingProgress(value: unknown): FullTrainingProgress {
  const isV2 = Boolean(value && typeof value === 'object' && 'schema' in value && value.schema === 'full-training-progress/2');
  const hasRecovery = isV2 && Object.hasOwn(value as object, 'recovery');
  const result = closed(value, [
    'schema', 'origin', 'phase', 'servedAt', 'lastObservedProgressAt', 'sourceReportedAt',
    'statusDetail', 'normalization', 'training', 'resources',
    ...(isV2 ? ['currentAttempt', 'previousAttempts'] : []),
    ...(hasRecovery ? ['recovery'] : []),
  ], 'progress');
  if ((!isV2 && result.schema !== 'full-training-progress/1') || result.origin !== 'REAL_OBSERVATION_PIPELINE' ||
    !FULL_PHASES.includes(result.phase as FullTrainingProgress['phase'])) fail('identity');
  timestamp(result.servedAt, 'servedAt');
  timestamp(result.lastObservedProgressAt, 'lastObservedProgressAt', true);
  timestamp(result.sourceReportedAt, 'sourceReportedAt', true);
  if (typeof result.statusDetail !== 'string' || result.statusDetail.length > 2000) fail('statusDetail');
  const normalization = closed(result.normalization, [
    'committedSourceFiles', 'totalSourceFiles', 'committedRows', 'totalRawRows',
    'compressedBytesRead', 'totalCompressedBytes', 'complete',
  ], 'normalization');
  if (normalization.totalSourceFiles !== 5341 || normalization.totalRawRows !== 156905287 ||
    normalization.totalCompressedBytes !== 4189735827 || typeof normalization.complete !== 'boolean') fail('normalization.definition');
  optionalInteger(normalization.committedSourceFiles, 'normalization.committedSourceFiles', 5341);
  optionalInteger(normalization.committedRows, 'normalization.committedRows', 156905287);
  optionalInteger(normalization.compressedBytesRead, 'normalization.compressedBytesRead', 4189735827);
  const training = closed(result.training, ['ready', 'trainRows', 'devRows', 'cpuFits', 'gpuFits'], 'training');
  if (typeof training.ready !== 'boolean') fail('training.ready');
  optionalInteger(training.trainRows, 'training.trainRows');
  optionalInteger(training.devRows, 'training.devRows');
  integer(training.cpuFits, 'training.cpuFits');
  integer(training.gpuFits, 'training.gpuFits');
  const resources = closed(result.resources, [
    'gpuName', 'allocatedHostMemoryGB', 'cpuSeconds', 'workerWallSeconds',
    'processRssBytes', 'estimatedComputeUsd',
    ...(isV2 ? ['rssMeasurementKind', 'allocatedVcpuCount', 'cpuQuotaCores', 'workloadCpuUtilizationPercent', 'gpuUtilizationPercent', 'gpuMemoryUsedBytes'] : []),
  ], 'resources');
  if (resources.gpuName !== null && (typeof resources.gpuName !== 'string' || resources.gpuName.length === 0 || resources.gpuName.length > 160)) fail('resources.gpuName');
  for (const key of ['allocatedHostMemoryGB', 'cpuSeconds', 'workerWallSeconds', 'estimatedComputeUsd']) nonnegative(resources[key], `resources.${key}`);
  optionalInteger(resources.processRssBytes, 'resources.processRssBytes');
  if (isV2) {
    if (!RSS_MEASUREMENT_KINDS.includes(resources.rssMeasurementKind as typeof RSS_MEASUREMENT_KINDS[number]) ||
      (resources.rssMeasurementKind === 'UNMEASURED') !== (resources.processRssBytes === null)) fail('resources.rssMeasurementKind');
    const current = closed(result.currentAttempt, ['id', 'executionMode', 'workerCount', 'reason'], 'currentAttempt');
    attemptId(current.id, 'currentAttempt.id');
    reason(current.reason, 'currentAttempt.reason');
    if (!EXECUTION_MODES.includes(current.executionMode as typeof EXECUTION_MODES[number])) fail('currentAttempt.executionMode');
    integer(current.workerCount, 'currentAttempt.workerCount', 32);
    if (current.workerCount === 0 || (current.executionMode === 'SINGLE_PROCESS') !== (current.workerCount === 1)) fail('currentAttempt.workerCount');
    optionalInteger(resources.allocatedVcpuCount, 'resources.allocatedVcpuCount', 32);
    if (resources.allocatedVcpuCount === 0 ||
      (typeof resources.allocatedVcpuCount === 'number' && (current.workerCount as number) > resources.allocatedVcpuCount)) fail('resources.allocatedVcpuCount');
    nonnegative(resources.cpuQuotaCores, 'resources.cpuQuotaCores');
    if (resources.cpuQuotaCores !== null && (typeof resources.allocatedVcpuCount !== 'number' ||
      (resources.cpuQuotaCores as number) <= 0 || (resources.cpuQuotaCores as number) > resources.allocatedVcpuCount)) fail('resources.cpuQuotaCores');
    for (const key of ['workloadCpuUtilizationPercent', 'gpuUtilizationPercent']) {
      nonnegative(resources[key], `resources.${key}`);
      if (typeof resources[key] === 'number' && resources[key] > 100) fail(`resources.${key}`);
    }
    if (resources.workloadCpuUtilizationPercent !== null && resources.cpuQuotaCores === null) fail('resources.workloadCpuUtilizationPercent.quotaRequired');
    optionalInteger(resources.gpuMemoryUsedBytes, 'resources.gpuMemoryUsedBytes');
    if (!Array.isArray(result.previousAttempts) || result.previousAttempts.length > 32) fail('previousAttempts');
    const ids = new Set([current.id]);
    result.previousAttempts.forEach((entry, index) => {
      const path = `previousAttempts.${index}`;
      const previous = closed(entry, ['id', 'status', 'reason', 'committedSourceFiles', 'committedRows', 'elapsedSeconds'], path);
      attemptId(previous.id, `${path}.id`);
      if (ids.has(previous.id)) fail(`${path}.duplicateId`);
      ids.add(previous.id);
      if (previous.status !== 'STOPPED' && previous.status !== 'COMPLETE') fail(`${path}.status`);
      reason(previous.reason, `${path}.reason`);
      optionalInteger(previous.committedSourceFiles, `${path}.committedSourceFiles`, 5341);
      optionalInteger(previous.committedRows, `${path}.committedRows`, 156905287);
      nonnegative(previous.elapsedSeconds, `${path}.elapsedSeconds`);
    });
    if (hasRecovery) verifyRecovery(result, current, normalization);
  }
  return result as unknown as FullTrainingProgress;
}

function verifyRecovery(result: Record<string, unknown>, current: Record<string, unknown>, normalization: Record<string, unknown>) {
  const recovery = closed(result.recovery, [
    'reusedSourceFiles', 'reusedRows', 'freshSourceFiles', 'freshRows', 'partialVerificationStatus', 'sourceAttemptId',
  ], 'recovery');
  for (const [files, rows] of [['reusedSourceFiles', 'reusedRows'], ['freshSourceFiles', 'freshRows']]) {
    optionalInteger(recovery[files], `recovery.${files}`, 5341);
    optionalInteger(recovery[rows], `recovery.${rows}`, 156905287);
    if ((recovery[files] === null) !== (recovery[rows] === null)) fail(`recovery.${files}.pair`);
    if (recovery[files] === 0 && recovery[rows] !== 0) fail(`recovery.${files}.emptySet`);
  }
  if (!PARTIAL_VERIFICATION_STATUSES.includes(recovery.partialVerificationStatus as typeof PARTIAL_VERIFICATION_STATUSES[number])) fail('recovery.partialVerificationStatus');
  attemptId(recovery.sourceAttemptId, 'recovery.sourceAttemptId');
  if (recovery.sourceAttemptId === current.id ||
    !(result.previousAttempts as Record<string, unknown>[]).some(attempt => attempt.id === recovery.sourceAttemptId && attempt.status === 'STOPPED')) fail('recovery.sourceAttemptId');
  const status = recovery.partialVerificationStatus;
  if ((status === 'NOT_STARTED' || status === 'UNKNOWN') && recovery.reusedRows !== null) fail('recovery.unverifiedReuse');
  if (status === 'VERIFIED' && recovery.reusedRows === null) fail('recovery.verifiedReuseRequired');
  if (status === 'FAILED' && (result.phase !== 'STOPPED' || normalization.complete !== false)) fail('recovery.failedMustStop');
  const known = recovery.reusedRows !== null && recovery.freshRows !== null;
  if (known) {
    const files = (recovery.reusedSourceFiles as number) + (recovery.freshSourceFiles as number);
    const rows = (recovery.reusedRows as number) + (recovery.freshRows as number);
    if (normalization.committedSourceFiles !== files || normalization.committedRows !== rows) fail('recovery.unionMismatch');
  } else if (normalization.committedSourceFiles !== null || normalization.committedRows !== null) fail('recovery.unknownUnion');
  if (normalization.complete && (status !== 'VERIFIED' || !known ||
    normalization.committedSourceFiles !== 5341 || normalization.committedRows !== 156905287 ||
    normalization.compressedBytesRead !== 4189735827)) fail('recovery.incompleteCoverage');
}

function attemptId(value: unknown, path: string) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) fail(path);
}
function reason(value: unknown, path: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) fail(path);
}
