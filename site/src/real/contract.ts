import { IDENTITY_KEYS, METRIC_KEYS } from './types.ts';
import type { RealPilotSummary } from './types.ts';

function fail(path: string): never { throw new Error(`REAL_PILOT_CONTRACT:${path}`); }
function closed(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path);
  const object = value as Record<string, unknown>;
  if (Object.keys(object).length !== keys.length || keys.some(key => !Object.hasOwn(object, key))) fail(`${path}.keys`);
  return object;
}
/** This intentionally accepts only the saved T8/V8 real-observation pilot protocol. */
export function verifyRealPilot(value: unknown): RealPilotSummary {
  const summary = closed(value, 'summary', [
    'schema', 'status', 'origin', 'mode', 'recordedAt', 'candidateId', 'counts', 'identity', 'metrics',
    'HSealed', 'generalizationClaim', 'adoption', 'historicalCommitAvailabilityVerified', 'sourceFeaturesConditioned',
  ]);
  const literals = {
    schema: 'real-pilot-public-summary/1',
    status: 'SCORED_NOT_ADOPTED',
    origin: 'LOCAL_CAPTURED_REAL_OBSERVATIONS',
    mode: 'DECLARED_EVENT_TIME_REPLAY',
    candidateId: 'REAL_GLOBAL_DIRICHLET_V1',
  } as const;
  for (const [key, expected] of Object.entries(literals)) if (summary[key] !== expected) fail(key);
  if (typeof summary.recordedAt !== 'string' || summary.recordedAt.length > 64 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$/.test(summary.recordedAt) ||
    !Number.isFinite(Date.parse(summary.recordedAt))) fail('recordedAt');
  const counts = closed(summary.counts, 'counts', ['trainRows', 'evalRows']);
  if (counts.trainRows !== 8 || counts.evalRows !== 8) fail('counts.T8V8');
  const identity = closed(summary.identity, 'identity', IDENTITY_KEYS);
  for (const key of IDENTITY_KEYS) {
    if (typeof identity[key] !== 'string' || !/^[0-9a-f]{64}$/.test(identity[key] as string)) fail(`identity.${key}`);
  }
  const metrics = closed(summary.metrics, 'metrics', METRIC_KEYS);
  for (const key of METRIC_KEYS) {
    if (key === 'productNRPS') {
      if (metrics[key] !== null) fail('metrics.productNRPS');
      continue;
    }
    const maximum = key.endsWith('MSE') ? 4900 : key.endsWith('MAE') ? 70 : 1;
    const metric = metrics[key];
    if (typeof metric !== 'number' || !Number.isFinite(metric) || metric < 0 || metric > maximum) fail(`metrics.${key}`);
  }
  for (const key of ['HSealed', 'generalizationClaim', 'adoption', 'historicalCommitAvailabilityVerified', 'sourceFeaturesConditioned']) {
    if (summary[key] !== false) fail(key);
  }
  return summary as unknown as RealPilotSummary;
}
