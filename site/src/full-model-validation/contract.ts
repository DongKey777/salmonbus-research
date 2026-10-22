import type { FullModelValidation } from './types.ts';

function fail(path: string): never { throw new Error(`FULL_MODEL_VALIDATION_CONTRACT:${path}`); }
function closed(value: unknown, keys: string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) fail(`${path}.keys`);
  return result;
}
function num(value: unknown, path: string, maximum = Number.MAX_VALUE, integer = false, minimum = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isSafeInteger(value))) fail(path);
}
function hash(value: unknown, path: string) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(path); }
export function verifyFullModelValidation(value: unknown): FullModelValidation {
  const root = closed(value, ['schema', 'status', 'observedAt', 'sourceKind', 'model', 'dataset', 'metrics', 'units', 'validation', 'boundaries', 'provenance', 'compute'], 'root');
  if (root.schema !== 'full-model-validation/1' || root.status !== 'SAVED_CHECKPOINT_VALIDATED' || root.sourceKind !== 'REAL_OBSERVATION_EXECUTION') fail('identity');
  if (typeof root.observedAt !== 'string' || root.observedAt.length > 64 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(root.observedAt) || !Number.isFinite(Date.parse(root.observedAt))) fail('observedAt');
  const model = closed(root.model, ['kind', 'rounds', 'trainedBackend', 'scoringBackend', 'originalModelSha256', 'validatedSavedCheckpoints'], 'model');
  if (model.kind !== 'XGBOOST_SEAT_REGRESSION' || model.trainedBackend !== 'GPU' || model.scoringBackend !== 'SAVED_CPU') fail('model.backends');
  num(model.rounds, 'model.rounds', Number.MAX_SAFE_INTEGER, true, 1);
  num(model.validatedSavedCheckpoints, 'model.validatedSavedCheckpoints', Number.MAX_SAFE_INTEGER, true, 1);
  hash(model.originalModelSha256, 'model.originalModelSha256');
  const dataset = closed(root.dataset, ['trainRows', 'devRows', 'arrivalGroups', 'weightSum', 'weighting', 'HIncluded', 'developmentEvaluation'], 'dataset');
  for (const key of ['trainRows', 'devRows', 'arrivalGroups']) num(dataset[key], `dataset.${key}`, Number.MAX_SAFE_INTEGER, true, 1);
  num(dataset.weightSum, 'dataset.weightSum', Number.MAX_SAFE_INTEGER, false, 1);
  if (dataset.weighting !== 'ARRIVAL_GROUP_EQUAL_1_OVER_M' || dataset.HIncluded !== false || dataset.developmentEvaluation !== true || dataset.weightSum !== dataset.arrivalGroups || (dataset.arrivalGroups as number) > (dataset.devRows as number)) fail('dataset.cohort');
  const metrics = closed(root.metrics, ['MAE', 'RMSE', 'MSE', 'Brier', 'NRPS'], 'metrics');
  num(metrics.MAE, 'metrics.MAE', 70); num(metrics.RMSE, 'metrics.RMSE', 70); num(metrics.MSE, 'metrics.MSE', 4900);
  if (metrics.Brier !== null || metrics.NRPS !== null || Math.abs(Math.sqrt(metrics.MSE as number) - (metrics.RMSE as number)) > 1e-10) fail('metrics.semantic');
  const units = closed(root.units, ['MAE', 'RMSE', 'MSE'], 'units');
  if (units.MAE !== '석' || units.RMSE !== '석' || units.MSE !== '석²') fail('units');
  const validation = closed(root.validation, ['wholeDevScored', 'cpuSaveReloadExactRows', 'cpuSaveReloadMismatches', 'originalCrossBackendToleranceViolations', 'violatingRowsNumericallyExplained', 'allRowsRoutingReplayVerified', 'additionalTrainingRuns', 'wallSeconds'], 'validation');
  for (const key of ['cpuSaveReloadExactRows', 'originalCrossBackendToleranceViolations', 'violatingRowsNumericallyExplained']) num(validation[key], `validation.${key}`, dataset.devRows as number, true);
  num(validation.wallSeconds, 'validation.wallSeconds');
  if (validation.wholeDevScored !== true || validation.cpuSaveReloadExactRows !== dataset.devRows || validation.cpuSaveReloadMismatches !== 0 || validation.violatingRowsNumericallyExplained !== validation.originalCrossBackendToleranceViolations || validation.allRowsRoutingReplayVerified !== false || validation.additionalTrainingRuns !== 0) fail('validation.scope');
  const boundaries = closed(root.boundaries, ['originalTrainingRunStatus', 'originalTrainingRunAccepted', 'fullHeadStarted', 'originalTrainingHeapCompared', 'productComparison', 'improvementClaim', 'modelAdopted', 'generalizationClaim'], 'boundaries');
  if (boundaries.originalTrainingRunStatus !== 'FAILED_PRESERVED' || boundaries.productComparison !== 'NOT_CONNECTED') fail('boundaries.status');
  for (const key of ['originalTrainingRunAccepted', 'fullHeadStarted', 'originalTrainingHeapCompared', 'improvementClaim', 'modelAdopted', 'generalizationClaim']) if (boundaries[key] !== false) fail(`boundaries.${key}`);
  const provenance = closed(root.provenance, ['datasetSha256', 'modelSha256', 'scoreSha256', 'completionSha256', 'consumerSha256'], 'provenance');
  for (const key of Object.keys(provenance)) hash(provenance[key], `provenance.${key}`);
  if (provenance.modelSha256 !== model.originalModelSha256) fail('provenance.modelIdentity');
  const released = Boolean(root.compute && typeof root.compute === 'object' && 'status' in root.compute && root.compute.status === 'RELEASED');
  const compute = closed(root.compute, ['status', 'networkResultsPreserved', ...(released ? ['storageRetained', 'releaseVerifiedAt'] : [])], 'compute');
  if (!['RELEASE_PENDING', 'RELEASED'].includes(compute.status as string) || compute.networkResultsPreserved !== true) fail('compute');
  if (released && (compute.storageRetained !== true || typeof compute.releaseVerifiedAt !== 'string' || compute.releaseVerifiedAt.length > 64 || !/^\d{4}-\d{2}-\d{2}T/.test(compute.releaseVerifiedAt) || !Number.isFinite(Date.parse(compute.releaseVerifiedAt)))) fail('compute.release');
  return root as unknown as FullModelValidation;
}
