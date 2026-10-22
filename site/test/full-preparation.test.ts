import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { verifyFullTrainingProgress } from '../src/full-preparation/contract.ts';
import { readFullPreparation } from '../src/full-preparation/connection.ts';
import { FullPreparationReadError } from '../src/full-preparation/errors.ts';
import { normalizationProgress, progressClocks } from '../src/full-preparation/project.ts';
import { bytes, clock, count, decimal, percentage, readErrorText, usd } from '../src/full-preparation/presentation.ts';
import { FULL_PHASES } from '../src/full-preparation/types.ts';
import type { FullTrainingProgress } from '../src/full-preparation/types.ts';

/** CONTRACT_EXAMPLE only: fabricated test data, never execution evidence or a public file. */
const example = (): { origin: 'CONTRACT_EXAMPLE'; executionEvidence: false; payload: FullTrainingProgress } => ({
  origin: 'CONTRACT_EXAMPLE', executionEvidence: false,
  payload: {
    schema: 'full-training-progress/1', origin: 'REAL_OBSERVATION_PIPELINE', phase: 'PREPARING_RESOURCE',
    servedAt: '2030-01-01T00:00:00Z', lastObservedProgressAt: null, sourceReportedAt: null,
    statusDetail: 'CONTRACT_EXAMPLE · test-only resource preparation',
    normalization: {
      committedSourceFiles: null, totalSourceFiles: 5341, committedRows: null, totalRawRows: 156905287,
      compressedBytesRead: null, totalCompressedBytes: 4189735827, complete: false,
    },
    training: { ready: false, trainRows: null, devRows: null, cpuFits: 0, gpuFits: 0 },
    resources: { gpuName: null, allocatedHostMemoryGB: null, cpuSeconds: null, workerWallSeconds: null, processRssBytes: null, estimatedComputeUsd: null },
  },
});

test('full preparation: contract examples are wrapped and every unmeasured value stays null', () => {
  const wrapper = example();
  assert.equal(wrapper.origin, 'CONTRACT_EXAMPLE');
  assert.equal(wrapper.executionEvidence, false);
  assert.throws(() => verifyFullTrainingProgress(wrapper));
  const result = verifyFullTrainingProgress(wrapper.payload);
  assert.equal(result.normalization.committedRows, null);
  assert.equal(result.normalization.committedSourceFiles, null);
  assert.equal(result.normalization.compressedBytesRead, null);
  assert.equal(result.training.trainRows, null);
  assert.equal(result.training.devRows, null);
  assert.equal(result.sourceReportedAt, null);
  assert.equal(count(result.normalization.committedRows), '미측정');
  assert.equal(count(0), '0');
});

test('full preparation: fixed source totals and bounded committed counters are enforced', () => {
  for (const patch of [
    { totalSourceFiles: 5342 }, { totalRawRows: 156905288 }, { totalCompressedBytes: 4189735828 },
    { committedSourceFiles: -1 }, { committedSourceFiles: 5342 }, { committedRows: 156905288 },
    { compressedBytesRead: 4189735828 }, { committedRows: .5 }, { committedRows: '0' },
  ]) {
    const data = example().payload;
    Object.assign(data.normalization, patch);
    assert.throws(() => verifyFullTrainingProgress(data));
  }
  const zero = example().payload;
  Object.assign(zero.normalization, { committedSourceFiles: 0, committedRows: 0, compressedBytesRead: 0 });
  assert.equal(verifyFullTrainingProgress(zero).normalization.committedRows, 0);
});

test('full preparation: row progress belongs only to NORMALIZING and never measures training completion', () => {
  const data = example().payload;
  data.normalization.committedRows = 1000;
  data.training = { ready: true, trainRows: 80, devRows: 20, cpuFits: 1, gpuFits: 0 };
  for (const phase of FULL_PHASES) {
    data.phase = phase;
    const result = normalizationProgress(verifyFullTrainingProgress(data));
    if (phase === 'NORMALIZING') {
      assert.equal(result?.committedRows, 1000);
      assert.equal(result?.percentage, 1000 / 156905287 * 100);
      assert.notEqual(result?.committedRows, data.training.trainRows);
    } else assert.equal(result, null);
  }
  data.phase = 'NORMALIZING';
  data.normalization.committedRows = null;
  data.normalization.complete = true;
  assert.equal(normalizationProgress(data), null);
});

test('full preparation: observed zero is 0%, unknown is not 0%, and small positive progress is retained', () => {
  const data = example().payload; data.phase = 'NORMALIZING';
  assert.equal(normalizationProgress(data), null);
  data.normalization.committedRows = 0;
  assert.equal(normalizationProgress(data)?.percentage, 0);
  assert.equal(percentage(0), '0%');
  data.normalization.committedRows = 1;
  const value = normalizationProgress(data)!;
  assert.ok(value.percentage > 0);
  assert.notEqual(percentage(value.percentage), '0%');
  data.normalization.committedRows = data.normalization.totalRawRows;
  assert.equal(normalizationProgress(data)?.percentage, 100);
});

test('full preparation: poll/snapshot time cannot create a producer timestamp or a progress heartbeat', () => {
  const data = example().payload;
  data.lastObservedProgressAt = '2030-01-01T00:00:00Z';
  const before = progressClocks(data);
  const after = progressClocks({ ...data, servedAt: '2030-01-01T01:00:00Z' });
  assert.equal(after.lastObservedProgressAt, before.lastObservedProgressAt);
  assert.equal(after.producerReportedAt, null);
  assert.notEqual(after.snapshotWrittenAt, before.snapshotWrittenAt);
  assert.equal(clock(after.producerReportedAt), '미제공');
  assert.throws(() => verifyFullTrainingProgress({ ...data, sourceReportedAt: 'no UTC available' }));
});

test('full preparation: private identifiers, paths and raw-row fields cannot enter the closed public shape', () => {
  for (const key of ['podId', 'ip', 'key', 'accountBalance', 'path', 'rawRows']) {
    assert.throws(() => verifyFullTrainingProgress({ ...example().payload, [key]: 'not-public' }));
    const data = example().payload;
    Object.assign(data.resources, { [key]: 'not-public' });
    assert.throws(() => verifyFullTrainingProgress(data));
  }
  assert.throws(() => verifyFullTrainingProgress({ ...example().payload, origin: 'CONTRACT_EXAMPLE' }));
  assert.throws(() => verifyFullTrainingProgress({ ...example().payload, phase: 'NORMALIZATION' }));
});

test('full preparation: telemetry accepts measured zero and rejects nonfinite/negative values', () => {
  const data = example().payload;
  Object.assign(data.resources, { cpuSeconds: 0, workerWallSeconds: .25, processRssBytes: 0, estimatedComputeUsd: 0 });
  const result = verifyFullTrainingProgress(data);
  assert.equal(result.resources.cpuSeconds, 0);
  assert.equal(decimal(0), '0');
  assert.equal(bytes(null), '미측정');
  assert.equal(bytes(0), '0 B');
  assert.equal(usd(null), '미측정');
  assert.equal(usd(0), '$0.00');
  assert.notEqual(decimal(.000001), '0');
  for (const value of [-1, NaN, Infinity]) {
    assert.throws(() => verifyFullTrainingProgress({ ...data, resources: { ...data.resources, cpuSeconds: value } }));
  }
});

test('full preparation: GET uses JSON accept and 404 reports preparation pending without fabricating data', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(input, '/full-preparation.json');
      assert.equal(init?.method, 'GET');
      assert.equal(init?.cache, 'no-store');
      assert.deepEqual(init?.headers, { Accept: 'application/json' });
      return new Response(null, { status: 404 });
    };
    await assert.rejects(readFullPreparation(new AbortController().signal), (error: Error) => {
      assert.ok(error instanceof FullPreparationReadError);
      assert.equal(error.status, 404);
      assert.match(readErrorText(error, false), /아직 준비되지 않았습니다.*404/);
      return true;
    });
  } finally { globalThis.fetch = original; }
});

test('full preparation: the query cache retains the prior verified response alongside a new error', async () => {
  const original = globalThis.fetch, client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const data = example().payload, key = ['full-preparation-contract-example'];
  const options = { queryKey: key, queryFn: ({ signal }: { signal: AbortSignal }) => readFullPreparation(signal) };
  try {
    globalThis.fetch = async () => new Response(JSON.stringify(data), { status: 200 });
    await client.fetchQuery(options);
    globalThis.fetch = async () => new Response(null, { status: 503 });
    await assert.rejects(client.fetchQuery(options), /HTTP_503/);
    const state = client.getQueryState<FullTrainingProgress>(key)!;
    assert.deepEqual(state.data, data);
    assert.ok(state.error instanceof FullPreparationReadError);
    assert.match(readErrorText(state.error, Boolean(state.data)), /마지막 성공 자료/);
  } finally { client.clear(); globalThis.fetch = original; }
});

test('full preparation: oversized or malformed responses fail without exposing response bodies', async () => {
  const original = globalThis.fetch;
  let cancelled = false;
  try {
    globalThis.fetch = async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(32769)); },
      cancel() { cancelled = true; },
    }));
    await assert.rejects(readFullPreparation(new AbortController().signal), /RESPONSE_LIMIT/);
    assert.equal(cancelled, true);
    globalThis.fetch = async () => new Response('<html>SPA fallback</html>');
    await assert.rejects(readFullPreparation(new AbortController().signal), /INVALID_JSON/);
  } finally { globalThis.fetch = original; }
});
