import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyRealPilot } from '../src/real/contract.ts';
import { readRealPilot } from '../src/real/connection.ts';
import { comparedPoints, diagnosticPoints } from '../src/real/project.ts';
import { comparisonOption, nrpsDiagnosticOption } from '../src/real/charts.ts';
import { IDENTITY_KEYS } from '../src/real/types.ts';
import { score } from '../src/real/presentation.ts';

/**
 * ARTIFICIAL TEST DATA ONLY. Kept exclusively in this private test module.
 * These invented numbers/hashes are never written to public/, src/, or an API.
 */
function artificialTestPayload() {
  return {
    schema: 'real-pilot-public-summary/1', status: 'SCORED_NOT_ADOPTED',
    origin: 'LOCAL_CAPTURED_REAL_OBSERVATIONS', mode: 'DECLARED_EVENT_TIME_REPLAY',
    recordedAt: '2030-01-01T00:00:00Z', candidateId: 'REAL_GLOBAL_DIRICHLET_V1',
    counts: { trainRows: 8, evalRows: 8 },
    identity: Object.fromEntries(IDENTITY_KEYS.map((key, index) => [key, (index + 1).toString(16).repeat(64)])),
    metrics: {
      modelBrier: .2, modelMAE: 2, modelMSE: 5, modelNRPS: .0086,
      productRawBrier: .3, productFinalBrier: .25, productMAE: 3, productMSE: 10, productNRPS: null,
    },
    HSealed: false, generalizationClaim: false, adoption: false,
    historicalCommitAvailabilityVerified: false, sourceFeaturesConditioned: false,
  };
}

test('real pilot contract: only the pinned T8/V8 captured-observation protocol is accepted', () => {
  const result = verifyRealPilot(artificialTestPayload());
  assert.equal(result.counts.trainRows, 8);
  assert.equal(result.counts.evalRows, 8);
  assert.equal(result.sourceFeaturesConditioned, false);
  for (const [key, value] of [
    ['origin', 'SYNTHETIC_MODEL_EXECUTION'], ['mode', 'LIVE'], ['candidateId', 'LEARNED_JEV'],
    ['status', 'ADOPTED'], ['schema', 'real-pilot-public-summary/2'],
  ]) {
    assert.throws(() => verifyRealPilot({ ...artificialTestPayload(), [key]: value }));
  }
  const changedCount = artificialTestPayload(); changedCount.counts.evalRows = 9;
  assert.throws(() => verifyRealPilot(changedCount), /T8V8/);
});

test('real pilot contract: closed shapes reject extra metrics or raw identifiers', () => {
  assert.throws(() => verifyRealPilot({ ...artificialTestPayload(), routeId: 'private-route' }), /summary.keys/);
  const extraMetric = artificialTestPayload();
  Object.assign(extraMetric.metrics, { qualityComposite: .9 });
  assert.throws(() => verifyRealPilot(extraMetric), /metrics.keys/);
  const extraIdentity = artificialTestPayload();
  extraIdentity.identity.rawSeatValue = '0';
  assert.throws(() => verifyRealPilot(extraIdentity), /identity.keys/);
});

test('real pilot contract: all provenance hashes are required and distinct fields remain separate', () => {
  const result = verifyRealPilot(artificialTestPayload());
  assert.equal(result.identity.sourceDatasetSha256, '9'.repeat(64));
  assert.equal(result.identity.modelHash, '3'.repeat(64));
  assert.equal(result.identity.scoringContractHash, '8'.repeat(64));
  for (const key of IDENTITY_KEYS) {
    const invalid = artificialTestPayload();
    invalid.identity[key] = 'not-a-sha256';
    assert.throws(() => verifyRealPilot(invalid), new RegExp(`identity.${key}`));
  }
});

test('real pilot contract: flags cannot imply adoption, generalization, feature learning, or historical availability', () => {
  for (const key of ['HSealed', 'generalizationClaim', 'adoption', 'historicalCommitAvailabilityVerified', 'sourceFeaturesConditioned']) {
    for (const value of [true, null, 'false']) {
      assert.throws(() => verifyRealPilot({ ...artificialTestPayload(), [key]: value }), new RegExp(key));
    }
  }
});

test('real pilot contract: finite metric bounds are enforced independently', () => {
  const bounds = { modelBrier: 1, modelMAE: 70, modelMSE: 4900, modelNRPS: 1, productRawBrier: 1, productFinalBrier: 1, productMAE: 70, productMSE: 4900 };
  for (const [key, max] of Object.entries(bounds)) {
    for (const value of [NaN, Infinity, -.001, max + .001, null]) {
      const payload = artificialTestPayload();
      Object.assign(payload.metrics, { [key]: value });
      assert.throws(() => verifyRealPilot(payload), new RegExp(`metrics.${key}`));
    }
  }
});

test('real pilot product NRPS: unavailable means null, never a zero score or fabricated PMF comparison', () => {
  const result = verifyRealPilot(artificialTestPayload());
  assert.equal(result.metrics.productNRPS, null);
  assert.deepEqual(diagnosticPoints(result).map(point => point.value), [result.metrics.modelNRPS]);
  const invalid = artificialTestPayload(); Object.assign(invalid.metrics, { productNRPS: 0 });
  assert.throws(() => verifyRealPilot(invalid), /productNRPS/);
  const option = nrpsDiagnosticOption(result, 'raw');
  const series = option.series as { data: unknown[]; type: string }[];
  assert.equal(series.length, 1);
  assert.equal(series[0].data.length, 1);
  assert.equal(series[0].type, 'bar');
  const axis = option.xAxis as { axisLabel: { formatter: (value: number) => string } };
  assert.equal(axis.axisLabel.formatter(.0086), '0.0086');
});

test('real pilot plots: Brier preserves model/raw/final while MAE/MSE each have model/product only', () => {
  const result = verifyRealPilot(artificialTestPayload());
  assert.deepEqual(comparedPoints(result, 'Brier').map(point => point.value), [.2, .3, .25]);
  assert.deepEqual(comparedPoints(result, 'MAE').map(point => point.value), [2, 3]);
  assert.deepEqual(comparedPoints(result, 'MSE').map(point => point.value), [5, 10]);
  for (const metric of ['Brier', 'MAE', 'MSE'] as const) {
    const option = comparisonOption(result, metric);
    const series = option.series as { type: string; data: unknown[] }[];
    assert.equal(series.length, 1);
    assert.equal(series[0].type, 'bar');
    assert.equal(series[0].data.length, metric === 'Brier' ? 3 : 2);
    assert.equal((option.xAxis as { min: number }).min, 0);
  }
});

test('real pilot recordedAt: UTC result timestamp is required, not an arbitrary heartbeat value', () => {
  for (const value of ['now', '2030-01-01', '2030-01-01T09:00:00+09:00']) {
    assert.throws(() => verifyRealPilot({ ...artificialTestPayload(), recordedAt: value }), /recordedAt/);
  }
  verifyRealPilot({ ...artificialTestPayload(), recordedAt: '2030-01-01T00:00:00+00:00' });
});

test('real pilot tiny scores: a small nonzero Brier remains visible instead of rounding to zero', () => {
  assert.equal(score(2.449053563250482e-6), '2.449e-6');
  assert.equal(score(0), '0');
  assert.equal(score(null), '미제공');
  const payload = artificialTestPayload();
  payload.metrics.modelBrier = 2.449053563250482e-6;
  const option = comparisonOption(verifyRealPilot(payload), 'Brier', 'raw');
  const series = option.series as { label: { formatter: (item: { value: number; dataIndex: number }) => string } }[];
  assert.equal(series[0].label.formatter({ value: payload.metrics.modelBrier, dataIndex: 0 }), '0.000002449054');
  assert.match((option.aria as { description: string }).description, /0\.000002449054/);
  const tooltip = option.tooltip as { formatter: (item: { name: string; value: number; dataIndex: number }) => string };
  assert.match(tooltip.formatter({ name: '기준 모델', value: payload.metrics.modelBrier, dataIndex: 0 }), /원값 Brier: 0\.000002449053563250482/);
});

test('real pilot readable units transform bar values and names, while raw reports stay unchanged', () => {
  const payload = artificialTestPayload();
  payload.metrics.modelBrier = .0000025;
  payload.metrics.modelMSE = 9;
  payload.metrics.productMSE = 16;
  const summary = verifyRealPilot(payload);
  const before = JSON.stringify(summary);
  const bars = (option: ReturnType<typeof comparisonOption>) => (option.series as { data: { value: number }[] }[])[0].data.map(item => item.value);
  assert.deepEqual(bars(comparisonOption(summary, 'Brier', 'readable')), [2.5, 300000, 250000]);
  assert.deepEqual(bars(comparisonOption(summary, 'MSE', 'readable')), [3, 4]);
  assert.deepEqual(bars(comparisonOption(summary, 'MSE', 'raw')), [9, 16]);
  assert.deepEqual(bars(comparisonOption(summary, 'MAE', 'readable')), [2, 3]);
  const readableMse = comparisonOption(summary, 'MSE', 'readable');
  assert.equal((readableMse.xAxis as { name: string }).name, 'RMSE · 석');
  assert.equal((comparisonOption(summary, 'MSE', 'raw').xAxis as { name: string }).name, 'MSE · 석²');
  const tooltip = readableMse.tooltip as { formatter: (item: { name: string; value: number; dataIndex: number }) => string };
  const text = tooltip.formatter({ name: '기준 모델', value: 3, dataIndex: 0 });
  assert.match(text, /RMSE 3\.00 석/);
  assert.match(text, /원값 MSE: 9/);
  assert.equal(JSON.stringify(summary), before);
});

test('real pilot NRPS uses a 0–100 error scale without adding an unavailable product value', () => {
  const summary = verifyRealPilot(artificialTestPayload());
  const option = nrpsDiagnosticOption(summary, 'readable');
  const series = option.series as { data: { value: number }[] }[];
  assert.equal(series.length, 1);
  assert.equal(series[0].data.length, 1);
  assert.equal(series[0].data[0].value, .86);
  assert.equal((option.xAxis as { max: number }).max, 100);
  assert.match((option.aria as { description: string }).description, /정확도가 아닙니다/);
  assert.equal(summary.metrics.productNRPS, null);
});

test('real pilot reader: 404 remains pending without metrics, successful reads validate, and no write is made', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(input, '/real-pilot/summary.json');
      assert.equal(init?.method, 'GET');
      assert.equal(init?.cache, 'no-store');
      assert.deepEqual(init?.headers, { Accept: 'application/json' });
      return new Response(null, { status: 404 });
    };
    assert.deepEqual(await readRealPilot(new AbortController().signal), { state: 'pending' });
    const exactBody = JSON.stringify(artificialTestPayload()) + '\n';
    globalThis.fetch = async () => new Response(exactBody, { status: 200 });
    const result = await readRealPilot(new AbortController().signal);
    assert.equal(result.state, 'scored');
    if (result.state === 'scored') {
      assert.equal(result.summary.metrics.productNRPS, null);
      assert.equal(result.publicSummarySha256, createHash('sha256').update(exactBody).digest('hex'));
      assert.notEqual(result.publicSummarySha256, createHash('sha256').update(exactBody.trim()).digest('hex'));
    }
    globalThis.fetch = async () => new Response('<html>fallback</html>', { status: 200 });
    await assert.rejects(readRealPilot(new AbortController().signal), /INVALID_JSON/);
  } finally { globalThis.fetch = originalFetch; }
});
