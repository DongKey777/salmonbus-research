import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QueryClient } from '@tanstack/react-query';
import { verifyFullModelValidation } from '../src/full-model-validation/contract.ts';
import { readFullModelValidation } from '../src/full-model-validation/connection.ts';
import { seatScores } from '../src/full-model-validation/presentation.ts';

// Read only the explicitly public aggregate. Mutations below are artificial test cases.
const published = JSON.parse(readFileSync(new URL('../public/full-model-validation.json', import.meta.url), 'utf8'));
const artificial = () => ({ origin: 'CONTRACT_EXAMPLE', executionEvidence: false, payload: structuredClone(published) });

test('saved full-model validation: public identity and easy seat units preserve the failed training boundary', () => {
  const data = verifyFullModelValidation(published), scores = seatScores(data);
  assert.equal(scores.mae, '4.48 석'); assert.equal(scores.rmse, '7.19 석');
  assert.equal(data.boundaries.originalTrainingRunAccepted, false);
  assert.equal(data.validation.additionalTrainingRuns, 0);
  assert.equal(data.metrics.Brier, null); assert.equal(data.metrics.NRPS, null);
  assert.equal(data.validation.cpuSaveReloadExactRows, data.dataset.devRows);
  assert.equal(data.provenance.modelSha256, data.model.originalModelSha256);
  assert.equal(data.compute.status, 'RELEASED');
});

test('saved full-model validation: artificial claims, unbound pins and metric substitutions are rejected', () => {
  assert.throws(() => verifyFullModelValidation(artificial()));
  for (const change of [
    (data: any) => { data.boundaries.originalTrainingRunAccepted = true; },
    (data: any) => { data.boundaries.modelAdopted = true; },
    (data: any) => { data.metrics.Brier = 0; },
    (data: any) => { data.metrics.RMSE = data.metrics.MSE; },
    (data: any) => { data.provenance.modelSha256 = 'a'.repeat(64); },
    (data: any) => { data.validation.allRowsRoutingReplayVerified = true; },
    (data: any) => { data.validation.violatingRowsNumericallyExplained = 20989927; },
    (data: any) => { data.compute.storageRetained = false; },
    (data: any) => { data.privatePath = 'ARTIFICIAL_FORBIDDEN_FIELD'; },
  ]) {
    const data = artificial().payload; change(data);
    assert.throws(() => verifyFullModelValidation(data));
  }
});

test('saved full-model validation: read error keeps the previous verified result without inventing a new success', async () => {
  const original = globalThis.fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ['full-model-validation-test'];
  const options = { queryKey: key, queryFn: ({ signal }: { signal: AbortSignal }) => readFullModelValidation(signal) };
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(input, '/full-model-validation.json'); assert.equal(init?.method, 'GET');
      return new Response(JSON.stringify(published));
    };
    await client.fetchQuery(options);
    globalThis.fetch = async () => new Response(null, { status: 503 });
    await assert.rejects(client.fetchQuery(options), /HTTP_503/);
    assert.deepEqual(client.getQueryData(key), published);
    assert.ok(client.getQueryState(key)?.error);
  } finally { client.clear(); globalThis.fetch = original; }
});
