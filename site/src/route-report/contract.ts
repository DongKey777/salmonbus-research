import { ROUTE_DATASET, ROUTE_LIMITS, ROUTE_REPORT_SCHEMA, ROUTE_REPORT_STATUS } from './types.ts';
import type { PairedScore, RouteModel, RouteModelScore, RoutePopulation, RouteReport, UnknownPopulation } from './types.ts';

function fail(path: string): never { throw new Error(`ROUTE_REPORT_CONTRACT:${path}`); }
function closed(value: unknown, keys: string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) fail(`${path}.keys`);
  return result;
}
function finite(value: unknown, path: string, min = 0, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) fail(path);
  return value as number;
}
function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(path);
  return value as number;
}
function delta(value: unknown, path: string, mode: 'NULL' | 'NUMBER'): number | null {
  if (mode === 'NULL') { if (value !== null) fail(path); return null; }
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path);
  return value as number;
}
function sha256(value: unknown, path: string) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value) || value === '0'.repeat(64)) fail(path);
}
function timestamp(value: unknown, path: string, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail(path);
}
export function near(a: number, b: number, tolerance: number) { return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b)); }
const TOKEN = /^[0-9a-f]{12,32}$/;
function population(value: unknown, index: number): RoutePopulation {
  const route = closed(value, ['token', 'devRows', 'devGroups', 'weightSum', 'trainSupport'], `routes.${index}`);
  if (typeof route.token !== 'string' || !TOKEN.test(route.token) || !/[a-f]/.test(route.token)) fail(`routes.${index}.token`);
  const devGroups = integer(route.devGroups, `routes.${index}.devGroups`, 1, ROUTE_DATASET.devGroups);
  const devRows = integer(route.devRows, `routes.${index}.devRows`, devGroups, ROUTE_DATASET.devRows);
  const weightSum = finite(route.weightSum, `routes.${index}.weightSum`)!;
  if (weightSum <= 0 || !near(weightSum, devGroups, ROUTE_LIMITS.weightTolerance)) fail(`routes.${index}.weightSum`);
  if (route.trainSupport !== null) {
    const support = closed(route.trainSupport, ['rows', 'groups'], `routes.${index}.trainSupport`);
    const groups = integer(support.groups, `routes.${index}.trainSupport.groups`, 1, ROUTE_DATASET.trainGroups);
    integer(support.rows, `routes.${index}.trainSupport.rows`, groups, ROUTE_DATASET.trainRows);
  }
  return route as unknown as RoutePopulation;
}
function paired(value: unknown, path: string, candidate: boolean, nullableScore = false): PairedScore {
  const score = closed(value, ['MAE', 'MSE', 'pairedMAEDelta', 'pairedMSEDelta'], path);
  const mae = finite(score.MAE, `${path}.MAE`, 0, nullableScore), mse = finite(score.MSE, `${path}.MSE`, 0, nullableScore);
  if ((mae === null) !== (mse === null)) fail(`${path}.nullPair`);
  const mode = candidate && mae !== null ? 'NUMBER' : 'NULL';
  delta(score.pairedMAEDelta, `${path}.pairedMAEDelta`, mode); delta(score.pairedMSEDelta, `${path}.pairedMSEDelta`, mode);
  return score as unknown as PairedScore;
}
function model(value: unknown, index: number, routes: RoutePopulation[], unknown: UnknownPopulation): RouteModel {
  const entry = closed(value, ['id', 'role', 'trainingMode', 'depth', 'rounds', 'publishedGlobal', 'micro', 'knownRouteMacro', 'unknown', 'routes'], `models.${index}`);
  if (typeof entry.id !== 'string' || !/^[A-Z][A-Z0-9_]{0,31}$/.test(entry.id) || !['REFERENCE', 'CANDIDATE'].includes(entry.role as string) || !['CONTINUED_REFERENCE', 'FRESH_FROM_ZERO'].includes(entry.trainingMode as string)) fail(`models.${index}.identity`);
  if (entry.depth !== null) integer(entry.depth, `models.${index}.depth`, 1, 64);
  integer(entry.rounds, `models.${index}.rounds`, 1, 100000);
  const candidate = entry.role === 'CANDIDATE';
  const micro = paired(entry.micro, `models.${index}.micro`, candidate);
  const macro = closed(entry.knownRouteMacro, ['MAE', 'MSE', 'routeCount'], `models.${index}.knownRouteMacro`);
  finite(macro.MAE, `models.${index}.knownRouteMacro.MAE`); finite(macro.MSE, `models.${index}.knownRouteMacro.MSE`);
  if (macro.routeCount !== routes.length) fail(`models.${index}.knownRouteMacro.routeCount`);
  const unknownScore = paired(entry.unknown, `models.${index}.unknown`, candidate, true);
  if ((unknownScore.MAE === null) !== (unknown.devGroups === 0)) fail(`models.${index}.unknown.coverage`);
  if (!Array.isArray(entry.routes) || entry.routes.length !== routes.length) fail(`models.${index}.routes`);
  const scores = entry.routes.map((item, position) => {
    const score = closed(item, ['token', 'MAE', 'MSE', 'pairedMAEDelta', 'pairedMSEDelta'], `models.${index}.routes.${position}`);
    if (score.token !== routes[position].token) fail(`models.${index}.routes.${position}.token`);
    paired({ MAE: score.MAE, MSE: score.MSE, pairedMAEDelta: score.pairedMAEDelta, pairedMSEDelta: score.pairedMSEDelta }, `models.${index}.routes.${position}`, candidate);
    return score as unknown as RouteModelScore;
  });
  const totalWeight = routes.reduce((sum, route) => sum + route.weightSum, 0) + unknown.weightSum;
  const microMAE = (scores.reduce((sum, score, position) => sum + score.MAE * routes[position].weightSum, 0) + (unknownScore.MAE ?? 0) * unknown.weightSum) / totalWeight;
  const microMSE = (scores.reduce((sum, score, position) => sum + score.MSE * routes[position].weightSum, 0) + (unknownScore.MSE ?? 0) * unknown.weightSum) / totalWeight;
  if (!near(micro.MAE, microMAE, ROUTE_LIMITS.closureTolerance) || !near(micro.MSE, microMSE, ROUTE_LIMITS.closureTolerance)) fail(`models.${index}.micro.closure`);
  const macroMAE = scores.reduce((sum, score) => sum + score.MAE, 0) / scores.length, macroMSE = scores.reduce((sum, score) => sum + score.MSE, 0) / scores.length;
  if (!near(macro.MAE as number, macroMAE, ROUTE_LIMITS.closureTolerance) || !near(macro.MSE as number, macroMSE, ROUTE_LIMITS.closureTolerance)) fail(`models.${index}.knownRouteMacro.closure`);
  if (entry.publishedGlobal !== null) {
    const published = closed(entry.publishedGlobal, ['source', 'MAE', 'MSE'], `models.${index}.publishedGlobal`);
    if (typeof published.source !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}\.json$/.test(published.source) || published.source.includes('..')) fail(`models.${index}.publishedGlobal.source`);
    finite(published.MAE, `models.${index}.publishedGlobal.MAE`); finite(published.MSE, `models.${index}.publishedGlobal.MSE`);
    if (!near(published.MAE as number, micro.MAE, ROUTE_LIMITS.closureTolerance) || !near(published.MSE as number, micro.MSE, ROUTE_LIMITS.closureTolerance)) fail(`models.${index}.publishedGlobal.mismatch`);
  }
  return entry as unknown as RouteModel;
}
function pairedClosure(candidate: RouteModel, reference: RouteModel, index: number) {
  const check = (mine: { MAE: number | null; MSE: number | null; pairedMAEDelta: number | null; pairedMSEDelta: number | null }, theirs: { MAE: number | null; MSE: number | null }, path: string) => {
    if (mine.MAE === null || theirs.MAE === null) { if (mine.MAE !== theirs.MAE) fail(path); return; }
    if (!near(mine.pairedMAEDelta!, mine.MAE - theirs.MAE, ROUTE_LIMITS.closureTolerance) || !near(mine.pairedMSEDelta!, mine.MSE! - theirs.MSE!, ROUTE_LIMITS.closureTolerance)) fail(path);
  };
  check(candidate.micro, reference.micro, `models.${index}.micro.pairedDelta`);
  check(candidate.unknown, reference.unknown, `models.${index}.unknown.pairedDelta`);
  candidate.routes.forEach((score, position) => check(score, reference.routes[position], `models.${index}.routes.${position}.pairedDelta`));
}
export function verifyRouteReport(value: unknown, now: number = Date.now()): RouteReport {
  const data = closed(value, ['schema', 'origin', 'runId', 'evaluationRole', 'producerStatus', 'receiptSha256', 'dataset', 'routeMap', 'routes', 'unknown', 'models', 'DEVReused', 'HRead', 'modelAdoption', 'generalizationClaim', 'replacesGlobalGate', 'servedAt', 'sourceReportedAt'], 'root');
  if (data.schema !== ROUTE_REPORT_SCHEMA || data.origin !== 'REAL_OBSERVATION_PIPELINE' || data.evaluationRole !== 'DEV' || data.producerStatus !== ROUTE_REPORT_STATUS) fail('identity');
  if (typeof data.runId !== 'string' || !/^[A-Z][A-Z0-9_]{2,63}$/.test(data.runId)) fail('runId');
  sha256(data.receiptSha256, 'receiptSha256');
  const dataset = closed(data.dataset, Object.keys(ROUTE_DATASET), 'dataset');
  for (const [key, expected] of Object.entries(ROUTE_DATASET)) if (dataset[key] !== expected) fail(`dataset.${key}`);
  const map = closed(data.routeMap, ['sha256', 'routeDefinition', 'tokenKind', 'knownRouteCount', 'unknownGroupCount'], 'routeMap');
  sha256(map.sha256, 'routeMap.sha256');
  if (map.routeDefinition !== 'R.route_id' || map.tokenKind !== 'OPAQUE_ROUTE_TOKEN') fail('routeMap.definition');
  if (!Array.isArray(data.routes) || data.routes.length < 1 || data.routes.length > ROUTE_LIMITS.maxRoutes) fail('routes');
  const routes = data.routes.map(population);
  if (new Set(routes.map(route => route.token)).size !== routes.length) fail('routes.duplicateToken');
  if (map.knownRouteCount !== routes.length) fail('routeMap.knownRouteCount');
  const unknownEntry = closed(data.unknown, ['devRows', 'devGroups', 'weightSum'], 'unknown');
  const unknownGroups = integer(unknownEntry.devGroups, 'unknown.devGroups', 0, ROUTE_DATASET.devGroups);
  const unknownRows = integer(unknownEntry.devRows, 'unknown.devRows', unknownGroups, ROUTE_DATASET.devRows);
  const unknownWeight = finite(unknownEntry.weightSum, 'unknown.weightSum')!;
  if ((unknownGroups === 0) !== (unknownRows === 0) || !near(unknownWeight, unknownGroups, ROUTE_LIMITS.weightTolerance)) fail('unknown.weightSum');
  if (map.unknownGroupCount !== unknownGroups) fail('routeMap.unknownGroupCount');
  const unknown = unknownEntry as unknown as UnknownPopulation;
  if (routes.reduce((sum, route) => sum + route.devRows, 0) + unknownRows !== ROUTE_DATASET.devRows) fail('closure.devRows');
  if (routes.reduce((sum, route) => sum + route.devGroups, 0) + unknownGroups !== ROUTE_DATASET.devGroups) fail('closure.devGroups');
  if (!near(routes.reduce((sum, route) => sum + route.weightSum, 0) + unknownWeight, ROUTE_DATASET.devGroups, ROUTE_LIMITS.weightTolerance)) fail('closure.weightSum');
  if (routes.reduce((sum, route) => sum + (route.trainSupport?.groups ?? 0), 0) > ROUTE_DATASET.trainGroups || routes.reduce((sum, route) => sum + (route.trainSupport?.rows ?? 0), 0) > ROUTE_DATASET.trainRows) fail('closure.trainSupport');
  if (!Array.isArray(data.models) || data.models.length < 1 || data.models.length > ROUTE_LIMITS.maxModels) fail('models');
  const models = data.models.map((entry, index) => model(entry, index, routes, unknown));
  if (new Set(models.map(item => item.id)).size !== models.length) fail('models.duplicateId');
  const references = models.filter(item => item.role === 'REFERENCE');
  if (references.length !== 1) fail('models.reference');
  models.forEach((item, index) => { if (item.role === 'CANDIDATE') pairedClosure(item, references[0], index); });
  for (const [key, expected] of Object.entries({ DEVReused: true, HRead: false, modelAdoption: false, generalizationClaim: false, replacesGlobalGate: false })) if (data[key] !== expected) fail(key);
  timestamp(data.servedAt, 'servedAt'); timestamp(data.sourceReportedAt, 'sourceReportedAt', true);
  if (Date.parse(data.servedAt as string) > now + ROUTE_LIMITS.futureSkewMs) fail('servedAt.future');
  return data as unknown as RouteReport;
}
