import { FEATURES_V2_LIMITS, FEATURES_V2_SCHEMA, FEATURES_V2_STATUSES } from './types.ts';
import type { FeaturesV2Report, SeatModel } from './types.ts';

function fail(path: string): never { throw new Error(`FEATURES_V2_CONTRACT:${path}`); }
function closed(value: unknown, keys: string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) fail(`${path}.keys`);
  return result;
}
function num(value: unknown, path: string, min = Number.NEGATIVE_INFINITY, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) fail(path);
  return value as number;
}
function int(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(path);
  return value as number;
}
function sha256(value: unknown, path: string) { if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value) || value === '0'.repeat(64)) fail(path); }
function text(value: unknown, path: string, pattern = /^[^\u0000-\u001f]{1,80}$/) { if (typeof value !== 'string' || !pattern.test(value)) fail(path); return value as string; }
function timestamp(value: unknown, path: string, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail(path);
}
export function near(a: number, b: number, tolerance: number) { return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b)); }
const ID = /^[A-Z][A-Z0-9_]{0,31}$/;
function delta(value: unknown, path: string) {
  if (value === null) return null;
  const d = closed(value, ['MAE', 'standardError'], path); num(d.MAE, `${path}.MAE`); num(d.standardError, `${path}.standardError`, 0, true);
  return d as unknown as { MAE: number };
}
function seatModel(value: unknown, index: number): SeatModel {
  const path = `seatModels.${index}`;
  const m = closed(value, ['id', 'label', 'role', 'featureSet', 'depth', 'rounds', 'MAE', 'RMSE', 'routeMacroMAE', 'bias', 'MAEClip0To70', 'deltaVsReference', 'deltaVsProduct'], path);
  text(m.id, `${path}.id`, ID); text(m.label, `${path}.label`); text(m.featureSet, `${path}.featureSet`, ID);
  if (!['REFERENCE', 'PRODUCT', 'CANDIDATE'].includes(m.role as string)) fail(`${path}.role`);
  if (m.depth !== null) int(m.depth, `${path}.depth`, 1, 64);
  if (m.rounds !== null) int(m.rounds, `${path}.rounds`, 1, 100000);
  for (const key of ['MAE', 'RMSE', 'routeMacroMAE', 'MAEClip0To70']) num(m[key], `${path}.${key}`, 0);
  num(m.bias, `${path}.bias`);
  if ((m.MAE as number) > (m.RMSE as number) + 1e-9) fail(`${path}.ordering`);
  delta(m.deltaVsReference, `${path}.deltaVsReference`); delta(m.deltaVsProduct, `${path}.deltaVsProduct`);
  return m as unknown as SeatModel;
}
function maeMap(value: unknown, ids: string[], path: string) {
  const map = closed(value, ids, path); for (const id of ids) num(map[id], `${path}.${id}`, 0);
  return map as Record<string, number>;
}
export function verifyFeaturesV2Report(value: unknown, now: number = Date.now(), options: { allowTestOnly?: boolean } = {}): FeaturesV2Report {
  const data = closed(value, ['schema', 'origin', 'runId', 'evaluationRole', 'producerStatus', 'receiptSha256', 'workerReceiptSha256', 'metricsSha256', 'packageSha256', 'dataset', 'featureGroups', 'seatModels', 'curve', 'ablations', 'fullModels', 'observedFullShare', 'routes', 'segments', 'DEVReused', 'HRead', 'modelAdoption', 'generalizationClaim', 'servedAt', 'sourceReportedAt'], 'root');
  if (data.schema !== FEATURES_V2_SCHEMA || data.origin !== 'REAL_OBSERVATION_PIPELINE' || data.evaluationRole !== 'DEV' || !(FEATURES_V2_STATUSES as readonly string[]).includes(data.producerStatus as string)) fail('identity');
  if (data.producerStatus === 'TEST_ONLY_NOT_ACCEPTED' && options.allowTestOnly !== true) fail('testOnlyReport');
  text(data.runId, 'runId', /^[A-Z][A-Z0-9_]{2,63}$/);
  for (const key of ['receiptSha256', 'workerReceiptSha256', 'metricsSha256', 'packageSha256']) sha256(data[key], key);
  const ds = closed(data.dataset, ['manifestSha256', 'featureManifestSha256', 'stopDemandManifestSha256', 'trainRows', 'devRows', 'devWeightSum'], 'dataset');
  for (const key of ['manifestSha256', 'featureManifestSha256', 'stopDemandManifestSha256']) sha256(ds[key], `dataset.${key}`);
  int(ds.trainRows, 'dataset.trainRows', 1, 1e9); const devRows = int(ds.devRows, 'dataset.devRows', 1, 1e9); const devWeight = num(ds.devWeightSum, 'dataset.devWeightSum', 0)!;
  if (!Array.isArray(data.featureGroups) || data.featureGroups.length !== 4) fail('featureGroups');
  const groupIds = data.featureGroups.map((group, index) => { const g = closed(group, ['id', 'label', 'names'], `featureGroups.${index}`); text(g.label, `featureGroups.${index}.label`);
    if (!Array.isArray(g.names) || g.names.length < 1 || g.names.some(name => typeof name !== 'string' || !/^[a-z][a-z0-9_]{1,40}$/.test(name))) fail(`featureGroups.${index}.names`); return g.id; });
  if (groupIds.join() !== 'BASE,PRODUCTION,EXTRA,STOP_DEMAND') fail('featureGroups.order');
  const names = (data.featureGroups as { names: string[] }[]).flatMap(group => group.names); if (new Set(names).size !== names.length) fail('featureGroups.duplicate');
  if (!Array.isArray(data.seatModels) || data.seatModels.length < 3 || data.seatModels.length > FEATURES_V2_LIMITS.maxSeatModels) fail('seatModels');
  const seat = data.seatModels.map(seatModel); const ids = seat.map(m => m.id);
  if (new Set(ids).size !== ids.length || seat[0].role !== 'REFERENCE' || seat[1].role !== 'PRODUCT' || seat.slice(2).some(m => m.role !== 'CANDIDATE')) fail('seatModels.roles');
  const reference = seat[0], product = seat[1];
  if (reference.deltaVsReference !== null || product.deltaVsProduct !== null) fail('seatModels.selfDelta');
  for (const [index, m] of seat.entries()) {
    if (m.deltaVsReference && !near(m.deltaVsReference.MAE, m.MAE - reference.MAE, FEATURES_V2_LIMITS.closureTolerance)) fail(`seatModels.${index}.deltaVsReference.closure`);
    if (m.deltaVsProduct && !near(m.deltaVsProduct.MAE, m.MAE - product.MAE, FEATURES_V2_LIMITS.closureTolerance)) fail(`seatModels.${index}.deltaVsProduct.closure`);
    if (m.role === 'CANDIDATE' && (!m.deltaVsReference || !m.deltaVsProduct)) fail(`seatModels.${index}.deltaMissing`);
  }
  if (!Array.isArray(data.curve)) fail('curve');
  data.curve.forEach((item, index) => { const c = closed(item, ['id', 'points'], `curve.${index}`); if (!ids.includes(c.id as string) || !Array.isArray(c.points) || c.points.length < 1) fail(`curve.${index}`);
    let last = 0; for (const [p, point] of (c.points as unknown[]).entries()) { const q = closed(point, ['rounds', 'MAE', 'RMSE'], `curve.${index}.points.${p}`); const r = int(q.rounds, `curve.${index}.points.${p}.rounds`, 1, 100000); if (r <= last) fail(`curve.${index}.order`); last = r; num(q.MAE, `curve.${index}.points.${p}.MAE`, 0); num(q.RMSE, `curve.${index}.points.${p}.RMSE`, 0); }
    const final = seat.find(m => m.id === c.id)!, tail = (c.points as { rounds: number; MAE: number }[]).at(-1)!;
    if (tail.rounds !== final.rounds || !near(tail.MAE, final.MAE, 1e-12)) fail(`curve.${index}.final`); });
  if (!Array.isArray(data.ablations)) fail('ablations');
  data.ablations.forEach((item, index) => { const a = closed(item, ['id', 'label', 'withModel', 'withoutModel', 'rounds', 'withMAE', 'withoutMAE', 'MAEDelta', 'standardError'], `ablations.${index}`);
    text(a.id, `ablations.${index}.id`, ID); text(a.label, `ablations.${index}.label`); if (!ids.includes(a.withModel as string) || !ids.includes(a.withoutModel as string)) fail(`ablations.${index}.models`);
    int(a.rounds, `ablations.${index}.rounds`, 1, 100000); num(a.withMAE, `ablations.${index}.withMAE`, 0); num(a.withoutMAE, `ablations.${index}.withoutMAE`, 0); num(a.MAEDelta, `ablations.${index}.MAEDelta`); num(a.standardError, `ablations.${index}.standardError`, 0, true);
    if (!near(a.MAEDelta as number, (a.withoutMAE as number) - (a.withMAE as number), FEATURES_V2_LIMITS.closureTolerance)) fail(`ablations.${index}.closure`); });
  if (!Array.isArray(data.fullModels) || data.fullModels.length < 1 || data.fullModels.length > FEATURES_V2_LIMITS.maxFullModels) fail('fullModels');
  data.fullModels.forEach((item, index) => { const f = closed(item, ['id', 'label', 'role', 'Brier', 'logLoss', 'meanProbability'], `fullModels.${index}`); text(f.id, `fullModels.${index}.id`, ID); text(f.label, `fullModels.${index}.label`);
    if (!['PRODUCT', 'CANDIDATE', 'BASELINE'].includes(f.role as string)) fail(`fullModels.${index}.role`);
    const brier = num(f.Brier, `fullModels.${index}.Brier`, 0)!; if (brier > 1) fail(`fullModels.${index}.Brier.range`); num(f.logLoss, `fullModels.${index}.logLoss`, 0, true);
    const p = num(f.meanProbability, `fullModels.${index}.meanProbability`, 0)!; if (p > 1) fail(`fullModels.${index}.meanProbability.range`); });
  const share = num(data.observedFullShare, 'observedFullShare', 0)!; if (share > 1) fail('observedFullShare.range');
  if (!Array.isArray(data.routes) || data.routes.length < 1 || data.routes.length > FEATURES_V2_LIMITS.maxRoutes) fail('routes');
  let rows = 0, weight = 0, previous = ''; const tokens = new Set<string>(); const sums = Object.fromEntries(ids.map(id => [id, 0]));
  data.routes.forEach((item, index) => { const r = closed(item, ['token', 'devRows', 'weight', 'trainRows', 'MAE'], `routes.${index}`);
    const token = text(r.token, `routes.${index}.token`, /^[0-9a-f]{16}$/); if (tokens.has(token)) fail(`routes.${index}.duplicate`); tokens.add(token);
    if (token <= previous) fail(`routes.${index}.order`); previous = token;
    rows += int(r.devRows, `routes.${index}.devRows`, 1, devRows); const w = num(r.weight, `routes.${index}.weight`, 0)!; weight += w; int(r.trainRows, `routes.${index}.trainRows`, 0, 1e9);
    const mae = maeMap(r.MAE, ids, `routes.${index}.MAE`); for (const id of ids) sums[id] += mae[id] * w; });
  if (rows !== devRows || !near(weight, devWeight, FEATURES_V2_LIMITS.weightTolerance)) fail('routes.closure');
  for (const m of seat) if (!near(sums[m.id] / weight, m.MAE, FEATURES_V2_LIMITS.closureTolerance)) fail(`routes.micro.${m.id}`);
  if (!Array.isArray(data.segments) || data.segments.length < 1) fail('segments');
  data.segments.forEach((item, index) => { const s = closed(item, ['id', 'label', 'rows'], `segments.${index}`); text(s.id, `segments.${index}.id`, /^[a-zA-Z]{2,40}$/); text(s.label, `segments.${index}.label`);
    if (!Array.isArray(s.rows) || s.rows.length < 1) fail(`segments.${index}.rows`);
    let n = 0, w = 0; const acc = Object.fromEntries(ids.map(id => [id, 0]));
    (s.rows as unknown[]).forEach((row, position) => { const r = closed(row, ['key', 'label', 'devRows', 'weight', 'MAE'], `segments.${index}.rows.${position}`); int(r.key, `segments.${index}.rows.${position}.key`, 0, 64); text(r.label, `segments.${index}.rows.${position}.label`);
      n += int(r.devRows, `segments.${index}.rows.${position}.devRows`, 1, devRows); const rw = num(r.weight, `segments.${index}.rows.${position}.weight`, 0)!; w += rw;
      const mae = maeMap(r.MAE, ids, `segments.${index}.rows.${position}.MAE`); for (const id of ids) acc[id] += mae[id] * rw; });
    if (n !== devRows || !near(w, devWeight, FEATURES_V2_LIMITS.weightTolerance)) fail(`segments.${index}.closure`);
    for (const m of seat) if (!near(acc[m.id] / w, m.MAE, FEATURES_V2_LIMITS.closureTolerance)) fail(`segments.${index}.micro.${m.id}`); });
  for (const [key, expected] of Object.entries({ DEVReused: true, HRead: false, modelAdoption: false, generalizationClaim: false })) if (data[key] !== expected) fail(key);
  timestamp(data.servedAt, 'servedAt'); timestamp(data.sourceReportedAt, 'sourceReportedAt', true);
  if (Date.parse(data.servedAt as string) > now + FEATURES_V2_LIMITS.futureSkewMs) fail('servedAt.future');
  return data as unknown as FeaturesV2Report;
}
