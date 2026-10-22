import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QueryClient } from '@tanstack/react-query';
import { verifyFullLearningBatch } from '../src/full-learning-batch/contract.ts';
import { activeRounds } from '../src/full-learning-batch/project.ts';
import { score } from '../src/full-learning-batch/presentation.ts';
import { readFullLearningBatch } from '../src/full-learning-batch/connection.ts';

function artificial(kind: 'training' | 'complete' | 'skipped') {
  const wrapper = JSON.parse(readFileSync(new URL(`../evidence/full-learning-batch-ui/fixtures/ARTIFICIAL-${kind}.json`, import.meta.url), 'utf8'));
  assert.equal(wrapper.fixtureOrigin, 'ARTIFICIAL_TRANSPORT_FIXTURE'); assert.equal(wrapper.actualExecution, false);
  assert.throws(() => verifyFullLearningBatch(wrapper));
  return wrapper.public;
}

test('learning batch: fixed three models separate the existing baseline from reserved and verified candidates', () => {
  const data = verifyFullLearningBatch(artificial('training'));
  assert.equal(data.models.length, 3); assert.equal(data.trainingCallsReserved, 1); assert.equal(data.verifiedCandidateCount, 0);
  assert.equal(score(data.models[1], 'MAE'), '미등록');
  assert.deepEqual(activeRounds(data), { id: 'A', observedTotal: 80, targetTotal: 128, parentRounds: 64, observedAdditional: 16, targetAdditional: 64 });
  const unknown = artificial('training'); unknown.models[1].observedRounds = null; unknown.currentModelRoundsCompleted = null;
  assert.equal(activeRounds(verifyFullLearningBatch(unknown)), null);
});

test('learning batch: final verified scores and a sealed skip preserve conditional B and no adoption', () => {
  const complete = verifyFullLearningBatch(artificial('complete'));
  assert.equal(complete.verifiedCandidateCount, 2); assert.equal(complete.bestObservedDevModel, 'B');
  assert.equal(score(complete.models[2], 'RMSE'), '2.80 석');
  const skipped = verifyFullLearningBatch(artificial('skipped'));
  assert.equal(skipped.models[2].status, 'SKIPPED'); assert.equal(skipped.models[2].metrics, null);
  assert.equal(skipped.bestObservedDevModel, 'BASELINE'); assert.equal(skipped.legacyRunAccepted, false); assert.equal(skipped.modelAdoption, false);
});

test('learning batch: premature metrics, fake rounds, wrong gates and extra private fields are rejected', () => {
  for (const mutate of [
    (data: any) => { data.models[1].metrics = data.models[0].metrics; },
    (data: any) => { data.models[1].observedRounds = 63; },
    (data: any) => { data.verifiedCandidateCount = 1; },
    (data: any) => { data.terminal = true; },
    (data: any) => { data.modelAdoption = true; },
    (data: any) => { data.path = 'FORBIDDEN_ARTIFICIAL_FIELD'; },
  ]) { const data = artificial('training'); mutate(data); assert.throws(() => verifyFullLearningBatch(data)); }
  const wrongGate = artificial('complete'); wrongGate.models[1].gatePassed = false;
  assert.throws(() => verifyFullLearningBatch(wrongGate));
  const forgedMetric = artificial('complete'); forgedMetric.models[1].metrics.Brier = 0;
  assert.throws(() => verifyFullLearningBatch(forgedMetric));
});

test('learning batch: failure cleanup and publisher clocks do not fabricate accepted metrics or producer time', () => {
  const failed = artificial('training'); failed.phase = 'FAILED'; failed.terminal = false; failed.sourceReportedAt = null;
  const data = verifyFullLearningBatch(failed);
  assert.equal(data.models[1].metrics, null); assert.equal(data.terminal, false); assert.equal(data.sourceReportedAt, null);
  failed.terminal = true; verifyFullLearningBatch(failed);
});

test('learning batch: GET failures retain last verified public data and reject oversized bodies', async () => {
  const original = globalThis.fetch, client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const fixture = artificial('training'), key = ['artificial-learning-batch'];
  const options = { queryKey: key, queryFn: ({ signal }: { signal: AbortSignal }) => readFullLearningBatch(signal) };
  try {
    globalThis.fetch = async (input, init) => { assert.equal(input, '/full-learning-batch.json'); assert.equal(init?.method, 'GET'); return new Response(JSON.stringify(fixture)); };
    await client.fetchQuery(options);
    globalThis.fetch = async () => new Response(null, { status: 503 });
    await assert.rejects(client.fetchQuery(options), /HTTP_503/); assert.deepEqual(client.getQueryData(key), fixture);
    globalThis.fetch = async () => new Response('x'.repeat(32769));
    await assert.rejects(readFullLearningBatch(new AbortController().signal), /RESPONSE_LIMIT/);
  } finally { client.clear(); globalThis.fetch = original; }
});
