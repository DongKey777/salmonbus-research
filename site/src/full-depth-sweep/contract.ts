import { DEPTH_FUTURE_SKEW_MS, DEPTH_MODEL_STATUSES, DEPTH_PHASES, DEPTH_PRODUCER_STATUSES, DEPTH_RUN_ID, DEPTH_SCHEMA, PRIOR_DEPTH_ATTEMPT } from './types.ts';
import type { DepthMetrics, DepthModel, FullDepthSweep } from './types.ts';

function fail(path: string): never { throw new Error(`FULL_DEPTH_SWEEP_CONTRACT:${path}`); }
function closed(value: unknown, keys: string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) fail(`${path}.keys`);
  return result;
}
function number(value: unknown, path: string, max = Number.MAX_VALUE, integer = false, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isSafeInteger(value))) fail(path);
}
function timestamp(value: unknown, path: string, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail(path);
}
function sha256(value: unknown, path: string, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value) || value === '0'.repeat(64)) fail(path);
}
function metrics(value: unknown, path: string): DepthMetrics {
  const metric = closed(value, ['MAE', 'MSE', 'RMSE', 'Brier', 'logLoss', 'NRPS'], path);
  for (const key of ['MAE', 'MSE', 'RMSE']) number(metric[key], `${path}.${key}`);
  const root = Math.sqrt(metric.MSE as number), rmse = metric.RMSE as number;
  if (Math.abs(root - rmse) > 1e-12 * Math.max(1, root, rmse) || metric.Brier !== null || metric.logLoss !== null || metric.NRPS !== null) fail(`${path}.semantics`);
  return metric as unknown as DepthMetrics;
}
export function verifyFullDepthSweep(value: unknown, now: number = Date.now()): FullDepthSweep {
  const data = closed(value, ['schema', 'origin', 'runId', 'producerStatus', 'priorAttempt', 'receiptSha256', 'completeSha256', 'phase', 'terminal', 'statusDetail', 'candidate', 'trainingCallsReserved', 'verifiedCandidateCount', 'currentModelRoundsCompleted', 'trainRows', 'devRows', 'baselineRounds', 'models', 'bestObservedDevModel', 'workerElapsedSeconds', 'servedAt', 'sourceReportedAt', 'legacyRunAccepted', 'modelAdoption', 'generalizationClaim', 'DEVReused', 'productComparison', 'freshRoundsCompleted', 'devRowsProcessed', 'pureDepthContrast', 'continuedBaselineIsNotFreshControl'], 'root');
  if (data.schema !== DEPTH_SCHEMA || data.origin !== 'REAL_OBSERVATION_PIPELINE' || data.runId !== DEPTH_RUN_ID) fail('identity');
  const prior = closed(data.priorAttempt, Object.keys(PRIOR_DEPTH_ATTEMPT), 'priorAttempt');
  for (const [key, expected] of Object.entries(PRIOR_DEPTH_ATTEMPT)) if (prior[key] !== expected) fail(`priorAttempt.${key}`);
  if (!DEPTH_PHASES.includes(data.phase as FullDepthSweep['phase']) || typeof data.terminal !== 'boolean' || typeof data.statusDetail !== 'string' || data.statusDetail.length > 1000) fail('phase');
  if (data.producerStatus !== null && !DEPTH_PRODUCER_STATUSES.includes(data.producerStatus as FullDepthSweep['producerStatus'] & string)) fail('producerStatus');
  const expectedStatus = data.phase === 'COMPLETE' ? 'FRESH_DEPTH_SWEEP_AND_DEV_VERIFIED_NOT_ADOPTED' : data.phase === 'FAILED' ? 'FAILED_PRESERVED_NOT_ACCEPTED' : null;
  if (data.producerStatus !== expectedStatus) fail('producerStatus.phase');
  sha256(data.receiptSha256, 'receiptSha256', true); sha256(data.completeSha256, 'completeSha256', true);
  if (data.phase === 'COMPLETE' ? (data.receiptSha256 === null || data.completeSha256 === null || data.receiptSha256 === data.completeSha256) : (data.receiptSha256 !== null || data.completeSha256 !== null)) fail('receiptPins');
  if (![null, 'D4', 'D6', 'D8'].includes(data.candidate as string | null) || ![null, 'BASELINE', 'D4', 'D6', 'D8'].includes(data.bestObservedDevModel as string | null)) fail('candidate');
  number(data.trainingCallsReserved, 'trainingCallsReserved', 3, true, true); number(data.verifiedCandidateCount, 'verifiedCandidateCount', 3, true);
  number(data.currentModelRoundsCompleted, 'currentModelRoundsCompleted', 256, true, true);
  number(data.freshRoundsCompleted, 'freshRoundsCompleted', 768, true, true); number(data.devRowsProcessed, 'devRowsProcessed', 20989927, true, true);
  number(data.workerElapsedSeconds, 'workerElapsedSeconds', Number.MAX_VALUE, false, true);
  timestamp(data.servedAt, 'servedAt'); timestamp(data.sourceReportedAt, 'sourceReportedAt', true);
  if (Date.parse(data.servedAt as string) > now + DEPTH_FUTURE_SKEW_MS) fail('servedAt.future');
  if (data.trainRows !== 38651044 || data.devRows !== 20989927 || data.baselineRounds !== 256 || data.DEVReused !== true || data.productComparison !== 'NOT_CONNECTED') fail('cohort');
  if (data.pureDepthContrast !== 'FRESH_D4_D6_D8_ONLY' || data.continuedBaselineIsNotFreshControl !== true) fail('trainingPathContrast');
  for (const key of ['legacyRunAccepted', 'modelAdoption', 'generalizationClaim']) if (data[key] !== false) fail(key);
  if (!Array.isArray(data.models) || data.models.length !== 4) fail('models');
  const ids = ['BASELINE', 'D4', 'D6', 'D8'], depths = [6, 4, 6, 8];
  const models = data.models.map((entry, index) => {
    const model = closed(entry, ['id', 'targetRounds', 'observedRounds', 'status', 'metrics', 'gatePassed', 'depth', 'trainingMode'], `models.${index}`);
    if (model.id !== ids[index] || model.depth !== depths[index] || model.targetRounds !== 256 || model.trainingMode !== (index === 0 ? 'CONTINUED_REFERENCE' : 'FRESH_FROM_ZERO') || !DEPTH_MODEL_STATUSES.includes(model.status as DepthModel['status'])) fail(`models.${index}.identity`);
    number(model.observedRounds, `models.${index}.observedRounds`, 256, true, true);
    if (index === 0) {
      if (model.observedRounds !== 256 || model.status !== 'VALIDATED_SAVED_REFERENCE' || model.gatePassed !== null) fail('baseline');
      metrics(model.metrics, 'baseline.metrics');
    } else if (model.status === 'VERIFIED') {
      if (model.observedRounds !== 256 || typeof model.gatePassed !== 'boolean') fail(`models.${index}.verified`);
      metrics(model.metrics, `models.${index}.metrics`);
    } else if (model.metrics !== null || model.gatePassed !== null || model.status === 'VALIDATED_SAVED_REFERENCE') fail(`models.${index}.unverified`);
    return model as unknown as DepthModel;
  });
  const verified = models.slice(1).filter(model => model.status === 'VERIFIED');
  if (verified.length !== data.verifiedCandidateCount) fail('verifiedCount');
  const base = models[0].metrics!;
  for (const model of verified) if (model.gatePassed !== (model.metrics!.MAE < base.MAE && model.metrics!.RMSE <= base.RMSE)) fail('fixedDevGate');
  if (data.phase === 'EVALUATING' && models.slice(1).some(model => model.observedRounds !== 256)) fail('evaluationBeforeFitCompletion');
  if (data.phase === 'COMPLETE') {
    if (!data.terminal || data.candidate !== null || verified.length !== 3 || data.trainingCallsReserved !== 3 || data.freshRoundsCompleted !== 768 || data.devRowsProcessed !== 20989927) fail('completion');
    const eligible = [models[0], ...verified.filter(model => model.gatePassed)];
    eligible.sort((a, b) => a.metrics!.MAE - b.metrics!.MAE || a.metrics!.RMSE - b.metrics!.RMSE || a.depth - b.depth);
    if (data.bestObservedDevModel !== eligible[0].id) fail('bestObservedDevModel');
  } else if (verified.length !== 0 || data.bestObservedDevModel !== null || (data.phase !== 'FAILED' && data.terminal)) fail('nonterminal');
  return data as unknown as FullDepthSweep;
}
