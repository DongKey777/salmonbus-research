import { BATCH_PHASES, MODEL_STATUSES } from './types.ts';
import type { BatchMetrics, BatchModel, FullLearningBatch } from './types.ts';

function fail(path: string): never { throw new Error(`FULL_LEARNING_BATCH_CONTRACT:${path}`); }
function closed(value: unknown, keys: string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) fail(`${path}.keys`);
  return result;
}
function number(value: unknown, path: string, min = 0, max = Number.MAX_VALUE, integer = false, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) fail(path);
}
function timestamp(value: unknown, path: string, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail(path);
}
function metric(value: unknown, path: string): BatchMetrics {
  const data = closed(value, ['MAE', 'MSE', 'RMSE', 'Brier', 'logLoss', 'NRPS'], path);
  for (const key of ['MAE', 'MSE', 'RMSE']) number(data[key], `${path}.${key}`);
  const root = Math.sqrt(data.MSE as number), rmse = data.RMSE as number;
  if (Math.abs(root - rmse) > 1e-12 * Math.max(1, root, rmse) || data.Brier !== null || data.logLoss !== null || data.NRPS !== null) fail(`${path}.semantics`);
  return data as unknown as BatchMetrics;
}
export function verifyFullLearningBatch(value: unknown): FullLearningBatch {
  const data = closed(value, ['schema', 'origin', 'runId', 'phase', 'terminal', 'statusDetail', 'candidate', 'trainingCallsReserved', 'verifiedCandidateCount', 'currentModelRoundsCompleted', 'trainRows', 'devRows', 'baselineRounds', 'models', 'bestObservedDevModel', 'workerElapsedSeconds', 'servedAt', 'sourceReportedAt', 'legacyRunAccepted', 'modelAdoption', 'generalizationClaim', 'DEVReused', 'productComparison'], 'root');
  if (data.schema !== 'full-learning-batch/1' || data.origin !== 'REAL_OBSERVATION_PIPELINE' || data.runId !== 'SEAT_CONTINUATION_001') fail('identity');
  if (!BATCH_PHASES.includes(data.phase as FullLearningBatch['phase']) || typeof data.terminal !== 'boolean' || typeof data.statusDetail !== 'string' || data.statusDetail.length > 1000) fail('phase');
  if (![null, 'A', 'B'].includes(data.candidate as string | null) || ![null, 'BASELINE', 'A', 'B'].includes(data.bestObservedDevModel as string | null)) fail('candidate');
  number(data.trainingCallsReserved, 'trainingCallsReserved', 0, 2, true, true);
  number(data.verifiedCandidateCount, 'verifiedCandidateCount', 0, 2, true);
  number(data.currentModelRoundsCompleted, 'currentModelRoundsCompleted', 64, 256, true, true);
  number(data.workerElapsedSeconds, 'workerElapsedSeconds', 0, Number.MAX_VALUE, false, true);
  timestamp(data.servedAt, 'servedAt'); timestamp(data.sourceReportedAt, 'sourceReportedAt', true);
  if (data.trainRows !== 38651044 || data.devRows !== 20989927 || data.baselineRounds !== 64 || data.DEVReused !== true || data.productComparison !== 'NOT_CONNECTED') fail('cohort');
  for (const key of ['legacyRunAccepted', 'modelAdoption', 'generalizationClaim']) if (data[key] !== false) fail(key);
  if (!Array.isArray(data.models) || data.models.length !== 3) fail('models');
  const ids = ['BASELINE', 'A', 'B'], targets = [64, 128, 256], lower = [64, 64, 128];
  const models = data.models.map((item, index) => {
    const model = closed(item, ['id', 'targetRounds', 'observedRounds', 'status', 'metrics', 'gatePassed'], `models.${index}`);
    if (model.id !== ids[index] || model.targetRounds !== targets[index] || !MODEL_STATUSES.includes(model.status as BatchModel['status'])) fail(`models.${index}.identity`);
    number(model.observedRounds, `models.${index}.observedRounds`, lower[index], targets[index], true, true);
    if (index === 0) {
      if (model.status !== 'VALIDATED_SAVED_REFERENCE' || model.observedRounds !== 64 || model.gatePassed !== null) fail('baseline');
      metric(model.metrics, 'baseline.metrics');
    } else if (model.status === 'VERIFIED') {
      metric(model.metrics, `models.${index}.metrics`);
      if (typeof model.gatePassed !== 'boolean' || model.observedRounds !== model.targetRounds) fail(`models.${index}.verified`);
    } else if (model.metrics !== null || model.gatePassed !== null || model.status === 'VALIDATED_SAVED_REFERENCE' || (index === 1 && model.status === 'SKIPPED')) fail(`models.${index}.unverified`);
    return model as unknown as BatchModel;
  });
  const verified = models.slice(1).filter(model => model.status === 'VERIFIED');
  if (verified.length !== data.verifiedCandidateCount || (typeof data.trainingCallsReserved === 'number' && verified.length > data.trainingCallsReserved)) fail('verifiedCount');
  const base = models[0].metrics!;
  for (const model of verified) if (model.gatePassed !== (model.metrics!.MAE < base.MAE && model.metrics!.RMSE <= base.RMSE)) fail('fixedDevGate');
  if (models[2].status === 'SKIPPED' && models[1].gatePassed !== false) fail('skipRequiresFailedA');
  if (data.phase === 'COMPLETE') {
    if (!data.terminal || data.candidate !== null || verified.length < 1 || data.trainingCallsReserved !== verified.length || models[1].status !== 'VERIFIED') fail('completion');
    if (models[1].gatePassed ? models[2].status !== 'VERIFIED' : models[2].status !== 'SKIPPED') fail('conditionalB');
    const eligible = [models[0], ...verified.filter(model => model.gatePassed)];
    eligible.sort((a, b) => a.metrics!.MAE - b.metrics!.MAE || a.metrics!.RMSE - b.metrics!.RMSE || a.targetRounds - b.targetRounds);
    if (data.bestObservedDevModel !== eligible[0].id) fail('bestObservedDevModel');
  } else if (verified.length !== 0 || data.bestObservedDevModel !== null || (data.phase !== 'FAILED' && data.terminal)) fail('nonterminal');
  return data as unknown as FullLearningBatch;
}
