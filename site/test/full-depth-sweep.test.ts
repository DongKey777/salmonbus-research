import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QueryClient } from '@tanstack/react-query';
import { verifyFullDepthSweep } from '../src/full-depth-sweep/contract.ts';
import { activeDepthRounds, depthContrasts, depthEvaluationProgress } from '../src/full-depth-sweep/project.ts';
import { percent, seatDelta, seatScore } from '../src/full-depth-sweep/presentation.ts';
import { readFullDepthSweep } from '../src/full-depth-sweep/connection.ts';
import { DEPTH_FUTURE_SKEW_MS } from '../src/full-depth-sweep/types.ts';

const NOW = Date.parse('2027-01-15T08:00:00+00:00');
const verify = (value: unknown, now = NOW) => verifyFullDepthSweep(value, now);
const reject = (value: unknown, pattern: RegExp) => assert.throws(() => verify(value), pattern);

function artificial(name: 'training' | 'next-candidate' | 'evaluating' | 'complete' | 'failed') {
  const wrapper = JSON.parse(readFileSync(new URL(`./fixtures/full-depth-sweep/ARTIFICIAL-${name}.json`, import.meta.url), 'utf8'));
  assert.equal(wrapper.fixtureOrigin, 'ARTIFICIAL_TRANSPORT_FIXTURE'); assert.equal(wrapper.actualExecution, false);
  assert.throws(() => verifyFullDepthSweep(wrapper, NOW), /root\.keys/);
  return wrapper.public;
}

test('depth sweep 002: identity is the new run; the failed 001 attempt is a fixed separate record', () => {
  const data = verify(artificial('training'));
  assert.equal(data.schema, 'full-depth-sweep/2'); assert.equal(data.runId, 'SEAT_DEPTH_SWEEP_002');
  assert.deepEqual(data.priorAttempt, { runId: 'SEAT_DEPTH_SWEEP_001', outcome: 'STOPPED_BEFORE_TRAINING', freshFits: 0, accepted: false, publicScorePublished: false });
  for (const [change, pattern] of [
    [(value: any) => { value.runId = 'SEAT_DEPTH_SWEEP_001'; }, /identity/],
    [(value: any) => { value.schema = 'full-depth-sweep/1'; }, /identity/],
    [(value: any) => { value.priorAttempt.freshFits = 1; }, /priorAttempt\.freshFits/],
    [(value: any) => { value.priorAttempt.accepted = true; }, /priorAttempt\.accepted/],
    [(value: any) => { value.priorAttempt.publicScorePublished = true; }, /priorAttempt\.publicScorePublished/],
    [(value: any) => { value.priorAttempt.outcome = 'COMPLETE'; }, /priorAttempt\.outcome/],
    [(value: any) => { delete value.priorAttempt; }, /root\.keys/],
  ] as const) { const value = artificial('training'); change(value); reject(value, pattern); }
});

test('depth sweep 002: producer status and receipt pins are coupled to the phase', () => {
  const complete = verify(artificial('complete'));
  assert.equal(complete.producerStatus, 'FRESH_DEPTH_SWEEP_AND_DEV_VERIFIED_NOT_ADOPTED');
  assert.match(complete.receiptSha256!, /^[0-9a-f]{64}$/); assert.notEqual(complete.receiptSha256, complete.completeSha256);
  const failed = verify(artificial('failed'));
  assert.equal(failed.phase, 'FAILED'); assert.equal(failed.producerStatus, 'FAILED_PRESERVED_NOT_ACCEPTED'); assert.equal(failed.receiptSha256, null); assert.equal(failed.models[1].metrics, null);
  const training = verify(artificial('training'));
  assert.equal(training.producerStatus, null); assert.equal(training.receiptSha256, null);
  for (const [change, pattern] of [
    [(value: any) => { value.producerStatus = 'FRESH_DEPTH_SWEEP_AND_DEV_VERIFIED_NOT_ADOPTED'; }, /producerStatus\.phase/],
    [(value: any) => { value.producerStatus = 'ADOPTED'; }, /^Error: FULL_DEPTH_SWEEP_CONTRACT:producerStatus$/],
    [(value: any) => { value.receiptSha256 = 'a'.repeat(64); }, /receiptPins/],
  ] as const) { const value = artificial('training'); change(value); reject(value, pattern); }
  for (const [change, pattern] of [
    [(value: any) => { value.producerStatus = null; }, /producerStatus\.phase/],
    [(value: any) => { value.producerStatus = 'FAILED_PRESERVED_NOT_ACCEPTED'; }, /producerStatus\.phase/],
    [(value: any) => { value.receiptSha256 = null; }, /receiptPins/],
    [(value: any) => { value.completeSha256 = value.receiptSha256; }, /receiptPins/],
    [(value: any) => { value.receiptSha256 = '0'.repeat(64); }, /^Error: FULL_DEPTH_SWEEP_CONTRACT:receiptSha256$/],
  ] as const) { const value = artificial('complete'); change(value); reject(value, pattern); }
});

test('depth sweep 002: continued baseline is a reference, fresh rounds and fits are separate observations', () => {
  const data = verify(artificial('training'));
  assert.equal(data.models[0].trainingMode, 'CONTINUED_REFERENCE'); assert.equal(data.models[0].depth, 6);
  assert.equal(data.models[2].trainingMode, 'FRESH_FROM_ZERO'); assert.equal(data.models[2].depth, 6);
  assert.equal(data.trainingCallsReserved, 1); assert.equal(data.verifiedCandidateCount, 0); assert.equal(data.freshRoundsCompleted, null);
  assert.deepEqual(activeDepthRounds(data), { id: 'D4', depth: 4, observed: 32, target: 256 });
  assert.equal(seatScore(data.models[1], 'MAE'), '미등록'); assert.equal(depthContrasts(data), null);
});

test('depth sweep 002: a new candidate resets current rounds to real zero without erasing the preceding model', () => {
  const before = verify(artificial('training'));
  const after = verify(artificial('next-candidate'));
  assert.equal(before.currentModelRoundsCompleted, 32); assert.equal(after.currentModelRoundsCompleted, 0);
  assert.equal(after.models[1].observedRounds, 32); assert.equal(activeDepthRounds(after)?.observed, 0);
  const missing = artificial('next-candidate'); missing.currentModelRoundsCompleted = null; missing.models[2].observedRounds = null;
  assert.equal(activeDepthRounds(verify(missing)), null);
});

test('depth sweep 002: partial DEV processing does not register candidate scores or infer total fresh rounds', () => {
  const data = verify(artificial('evaluating'));
  assert.deepEqual(depthEvaluationProgress(data), { observed: 1000, total: 20989927 });
  assert.equal(activeDepthRounds(data), null); assert.equal(data.freshRoundsCompleted, null);
  assert.equal(data.verifiedCandidateCount, 0); assert.ok(data.models.slice(1).every(model => model.metrics === null));
});

test('depth sweep 002: sealed scores expose seat deltas against the fresh D6 control and, separately, the continued B256', () => {
  const data = verify(artificial('complete'));
  assert.equal(data.verifiedCandidateCount, 3); assert.equal(data.freshRoundsCompleted, 768);
  assert.equal(data.bestObservedDevModel, 'D8'); assert.equal(seatScore(data.models[3], 'RMSE'), '2.70 석');
  const rows = depthContrasts(data)!;
  assert.deepEqual(rows.map(row => row.id), ['D4', 'D6', 'D8']);
  const control = rows.find(row => row.isControl)!;
  assert.equal(control.id, 'D6'); assert.equal(control.vsFreshControl, null);
  const d8 = rows.find(row => row.id === 'D8')!;
  assert.ok(Math.abs(d8.vsFreshControl!.seatDelta - (1.7 - 1.8)) < 1e-12);
  assert.ok(Math.abs(d8.vsFreshControl!.relativeImprovementPct! - (0.1 / 1.8) * 100) < 1e-9);
  assert.ok(Math.abs(d8.vsContinuedReference.seatDelta - (1.7 - 2.0)) < 1e-12);
  assert.ok(Math.abs(d8.vsContinuedReference.relativeImprovementPct! - 15) < 1e-9);
  assert.equal(seatDelta(d8.vsContinuedReference.seatDelta), '-0.30 석'); assert.equal(percent(d8.vsContinuedReference.relativeImprovementPct), '+15.00%');
  assert.equal(percent(null), '기준 0 · 미산출');
  assert.equal(data.legacyRunAccepted, false); assert.equal(data.modelAdoption, false); assert.equal(data.continuedBaselineIsNotFreshControl, true);
});

test('depth sweep 002: wrong topology, premature metrics, forged gate and extra fields are rejected', () => {
  for (const [change, pattern] of [
    [(data: any) => { data.models[2].trainingMode = 'CONTINUED_REFERENCE'; }, /models\.2\.identity/],
    [(data: any) => { data.models[1].observedRounds = 257; }, /models\.1\.observedRounds/],
    [(data: any) => { data.models[1].metrics = data.models[0].metrics; }, /models\.1\.unverified/],
    [(data: any) => { data.freshRoundsCompleted = 769; }, /freshRoundsCompleted/],
    [(data: any) => { data.verifiedCandidateCount = 1; }, /verifiedCount/],
    [(data: any) => { data.continuedBaselineIsNotFreshControl = false; }, /trainingPathContrast/],
    [(data: any) => { data.modelAdoption = true; }, /modelAdoption/],
    [(data: any) => { data.privatePath = 'FORBIDDEN_ARTIFICIAL_FIELD'; }, /root\.keys/],
  ] as const) { const data = artificial('training'); change(data); reject(data, pattern); }
  const incomplete = artificial('complete'); incomplete.verifiedCandidateCount = 2;
  reject(incomplete, /verifiedCount/);
  const forgedGate = artificial('complete'); forgedGate.models[1].gatePassed = false;
  reject(forgedGate, /fixedDevGate/);
  const forgedPass = artificial('complete'); forgedPass.models[1].metrics.MAE = forgedPass.models[0].metrics.MAE + 0.5; forgedPass.models[1].gatePassed = true;
  reject(forgedPass, /fixedDevGate/);
  const honestFail = artificial('complete'); honestFail.models[1].metrics.MAE = honestFail.models[0].metrics.MAE + 0.5; honestFail.models[1].gatePassed = false;
  assert.equal(verify(honestFail).bestObservedDevModel, 'D8');
  const wrongBest = artificial('complete'); wrongBest.bestObservedDevModel = 'D4';
  reject(wrongBest, /bestObservedDevModel/);
});

test('depth sweep 002: read failures preserve the last good model table and never synthesize scores', async () => {
  const original = globalThis.fetch, client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const fixture = artificial('training'), key = ['artificial-depth-sweep-002'];
  const options = { queryKey: key, queryFn: ({ signal }: { signal: AbortSignal }) => readFullDepthSweep(signal, NOW) };
  try {
    globalThis.fetch = async (input, init) => { assert.equal(input, '/full-depth-sweep.json'); assert.equal(init?.method, 'GET'); return new Response(JSON.stringify(fixture)); };
    await client.fetchQuery(options);
    globalThis.fetch = async () => new Response(null, { status: 503 });
    await assert.rejects(client.fetchQuery(options), /HTTP_503/); assert.deepEqual(client.getQueryData(key), fixture);
    globalThis.fetch = async () => new Response('x'.repeat(32769));
    await assert.rejects(readFullDepthSweep(new AbortController().signal, NOW), /RESPONSE_LIMIT/);
  } finally { client.clear(); globalThis.fetch = original; }
});

test('depth sweep 002: a file dated ahead of the receiver clock is rejected, so the 2027 artificial fixtures never verify today', () => {
  for (const name of ['training', 'next-candidate', 'evaluating', 'complete', 'failed'] as const) {
    const value = artificial(name);
    assert.throws(() => verifyFullDepthSweep(value), /servedAt\.future/);
    assert.throws(() => verifyFullDepthSweep(value, NOW - DEPTH_FUTURE_SKEW_MS - 1), /servedAt\.future/);
    assert.ok(verifyFullDepthSweep(value, NOW - DEPTH_FUTURE_SKEW_MS));
  }
  assert.ok(Date.now() < NOW - DEPTH_FUTURE_SKEW_MS);
});
