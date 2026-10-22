import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyAnchor, verifyCatalog, verifyGroups, verifyModelDetail, verifyPoint, verifyRange, verifyTrialDetail } from '../src/history/contract.ts';
import { catalogPath, rangePath, readHistory } from '../src/history/connection.ts';
import type { RangeRequest } from '../src/history/types.ts';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../evidence/history-ui/fixtures/${name}.artificial.json`, import.meta.url), 'utf8'));
const anchor = { historyGenerationId: 'artificial-example-generation', snapshotCursor: 1 };

test('history contract: owner examples are accepted, including the empty extent and expanded point identity', () => {
  const catalog = verifyCatalog(fixture('catalog'));
  verifyGroups(fixture('groups'));
  assert.deepEqual(verifyGroups(fixture('groups.empty')).data.trialExtent, { fromOrdinal: null, toOrdinal: null });
  const range = verifyRange(fixture('range'));
  assert.equal(range.data.buckets[0].first?.runId, 'artificial-run-1');
  assert.equal(range.data.buckets[0].first?.cycleIndex, 0);
  const row = catalog.data.rows[0];
  verifyTrialDetail(fixture('trial'), { ...anchor, trialId: row.trialId });
  const model = verifyModelDetail(fixture('model'), { ...anchor, modelId: row.modelId, modelRevisionRef: row.modelRevisionRef });
  assert.equal(model.data.model.verificationKind, 'ARTIFICIAL_METADATA_ONLY');
  assert.equal(range.data.adoptedModel, null);
  assert.equal(range.sourceKind, 'ARTIFICIAL_SCALE_FIXTURE');
});

test('history contract: closed responses reject unknown fields and missing required identity', () => {
  const catalog = fixture('catalog');
  catalog.data.rows[0].trained = true;
  assert.throws(() => verifyCatalog(catalog), /trial.keys/);
  const range = fixture('range');
  delete range.data.buckets[0].first.runId;
  assert.throws(() => verifyRange(range), /keys/);
});

test('history contract: cursor strings, cursor rollback/mismatch, and mixed generations cannot be joined', () => {
  const value = fixture('catalog');
  value.snapshotCursor = '1';
  assert.throws(() => verifyCatalog(value), /snapshotCursor/);
  const catalog = verifyCatalog(fixture('catalog'));
  assert.throws(() => verifyAnchor(catalog, { ...anchor, snapshotCursor: 2 }), /snapshot.mismatch/);
  assert.throws(() => verifyAnchor(catalog, { ...anchor, historyGenerationId: 'another' }), /generation.mismatch/);
});

test('history contract: model selection requires exact model ID and immutable revision, with nonnull hashes', () => {
  const row = verifyCatalog(fixture('catalog')).data.rows[0];
  const expected = { ...anchor, modelId: row.modelId, modelRevisionRef: row.modelRevisionRef };
  assert.throws(() => verifyModelDetail(fixture('model'), { ...expected, modelId: 'another-model' }), /identityMismatch/);
  assert.throws(() => verifyModelDetail(fixture('model'), { ...expected, modelRevisionRef: '0'.repeat(64) }), /identityMismatch/);
  for (const key of ['codeRef', 'recipeRef', 'dataRef', 'weightsRef', 'manifestRef', 'modelRevisionRef']) {
    const value = fixture('model'); value.data.model[key] = null;
    assert.throws(() => verifyModelDetail(value, expected));
  }
});

test('history contract: nonfinite, negative, out-of-budget, and unregistered scores never become zero', () => {
  for (const value of [NaN, Infinity, -.01, 1e13]) {
    const point = fixture('range').data.buckets[0].first;
    point.value = value;
    assert.throws(() => verifyPoint(point));
  }
  const point = fixture('range').data.buckets[0].first;
  point.metricState = 'UNREGISTERED'; point.value = null; point.reportId = null; point.reportRef = null;
  assert.equal(verifyPoint(point).value, null);
  point.value = 0;
  assert.throws(() => verifyPoint(point), /validity/);
  const catalog = fixture('catalog');
  catalog.data.rows[0].registrationState = 'NOT_REGISTERED';
  assert.throws(() => verifyCatalog(catalog), /unregistered/);
});

test('history contract: a failed experiment can still have a valid registered score', () => {
  const point = fixture('range').data.buckets[0].first;
  point.status = 'FAILED';
  assert.equal(verifyPoint(point).metricState, 'VALID');
  const catalog = fixture('catalog'); catalog.data.rows[0].status = 'FAILED';
  assert.equal(verifyCatalog(catalog).data.rows[0].metrics.Brier, .25693504);
});

test('history contract: metric counts, ordered buckets, and observed-best/adoption meaning are checked', () => {
  const wrongCounts = fixture('range'); wrongCounts.data.counts.invalidCount = 1;
  assert.throws(() => verifyRange(wrongCounts), /partition/);
  const wrongBucket = fixture('range'); wrongBucket.data.buckets[0].continuity = 'HAS_GAPS';
  assert.throws(() => verifyRange(wrongBucket), /continuity/);
  const adopted = fixture('range'); adopted.data.adoptedModel = adopted.data.observedBestSoFar.end.modelId;
  assert.throws(() => verifyRange(adopted), /semantics/);
  const method = fixture('range'); method.data.method = 'NRPS_V1';
  assert.throws(() => verifyRange(method), /method/);
});

test('history requests: signed catalog cursors remain opaque and pages stay within 100 rows', () => {
  const request = { groupRef: '', status: '' as const, limit: 100, cursor: 'opaque/+signed==value' };
  const url = new URL(catalogPath(request), 'http://localhost/');
  assert.equal(url.searchParams.get('cursor'), request.cursor);
  assert.equal(url.searchParams.get('direction'), 'DESC');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['cursor', 'direction', 'limit']);
  assert.throws(() => catalogPath({ ...request, limit: 101 }), /PAGE_LIMIT/);
});

test('history requests: each range is one group/metric with bounded RAW or MIN_MAX budget', () => {
  const groupRef = verifyGroups(fixture('groups')).data.groups[0].groupRef;
  const request: RangeRequest = { ...anchor, groupRef, metric: 'Brier', fromOrdinal: 1, toOrdinal: 10000, mode: 'MIN_MAX', buckets: 128 };
  const url = new URL(rangePath(request), 'http://localhost/');
  assert.equal(url.searchParams.get('groupRef'), groupRef);
  assert.equal(url.searchParams.get('snapshotCursor'), '1');
  assert.equal(url.searchParams.has('historyGenerationId'), false);
  assert.throws(() => rangePath({ ...request, toOrdinal: 10001 }), /RANGE_LIMIT/);
  assert.throws(() => rangePath({ ...request, mode: 'RAW', toOrdinal: 2001 }), /RANGE_LIMIT/);
  assert.ok(rangePath({ ...request, mode: 'RAW', toOrdinal: 2000 }));
  assert.throws(() => rangePath({ ...request, buckets: 501 }), /RANGE_LIMIT/);
});

test('history reads: payload bytes are capped before parsing and only same-origin GET is used', async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = async (input, init) => {
    assert.equal(input, '/api/v6/history/groups');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.cache, 'no-store');
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
      cancel() { cancelled = true; },
    }));
  };
  try {
    await assert.rejects(readHistory('groups', new AbortController().signal, verifyGroups), /RESPONSE_LIMIT/);
    assert.equal(cancelled, true);
  } finally { globalThis.fetch = originalFetch; }
});
