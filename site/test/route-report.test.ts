import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QueryClient } from '@tanstack/react-query';
import { verifyRouteReport } from '../src/route-report/contract.ts';
import { ROUTE_LIMITS } from '../src/route-report/types.ts';
import { defaultModelId, routeRows, selectModel, summary } from '../src/route-report/project.ts';
import { percent, seatDelta, seats, shortToken } from '../src/route-report/presentation.ts';
import { readRouteReport } from '../src/route-report/connection.ts';

const NOW = Date.parse('2027-01-15T08:00:00+00:00');
function artificial() {
  const wrapper = JSON.parse(readFileSync(new URL('./fixtures/route-report/route-report.ARTIFICIAL.json', import.meta.url), 'utf8'));
  assert.equal(wrapper.fixtureOrigin, 'ARTIFICIAL_TRANSPORT_FIXTURE'); assert.equal(wrapper.actualExecution, false);
  assert.throws(() => verifyRouteReport(wrapper, NOW), /root\.keys/);
  return wrapper.public;
}
const verify = (value: unknown, now = NOW) => verifyRouteReport(value, now);
const reject = (change: (value: any) => void, pattern: RegExp) => { const value = artificial(); change(value); assert.throws(() => verify(value), pattern); };

test('route report: population closes to the frozen DEV population and tokens stay opaque', () => {
  const data = verify(artificial());
  assert.equal(data.routes.length, 7); assert.equal(data.routeMap.knownRouteCount, 7);
  assert.equal(data.routes.reduce((sum, route) => sum + route.devRows, 0) + data.unknown.devRows, 20989927);
  assert.equal(data.routes.reduce((sum, route) => sum + route.devGroups, 0) + data.unknown.devGroups, 351831);
  assert.ok(data.routes.every(route => /^[0-9a-f]{12,32}$/.test(route.token) && /[a-f]/.test(route.token)));
  reject(value => { value.routes[0].devRows += 1; }, /closure\.devRows/);
  reject(value => { value.unknown.devGroups -= 1; value.unknown.weightSum -= 1; value.routeMap.unknownGroupCount -= 1; }, /closure\.devGroups/);
  reject(value => { value.routes[0].weightSum += 1; }, /weightSum/);
  reject(value => { value.routes[1].token = value.routes[0].token; value.models.forEach((model: any) => { model.routes[1].token = value.routes[0].token; }); }, /duplicateToken/);
  reject(value => { value.routes[0].token = '000000000000'; }, /routes\.0\.token/);
  reject(value => { value.routes[0].token = 'ABCDEF000000'; }, /routes\.0\.token/);
  reject(value => { value.routes[0].trainSupport = { rows: 10, groups: 20 }; }, /trainSupport/);
  reject(value => { value.routeMap.knownRouteCount = 6; }, /knownRouteCount/);
  reject(value => { value.routes[0].rawRouteId = 'FORBIDDEN'; }, /keys/);
});

test('route report: micro, macro, published-global and paired deltas must close against each other', () => {
  const data = verify(artificial());
  const reference = data.models[0], candidate = data.models[1];
  assert.equal(reference.role, 'REFERENCE'); assert.equal(candidate.role, 'CANDIDATE');
  assert.ok(reference.micro.MAE > 0 && reference.publishedGlobal !== null);
  assert.equal(reference.routes[0].pairedMAEDelta, null);
  assert.ok(Math.abs(candidate.routes[0].pairedMAEDelta! - (candidate.routes[0].MAE - reference.routes[0].MAE)) < 1e-12);
  reject(value => { value.models[0].micro.MAE *= 1.001; }, /micro\.closure/);
  reject(value => { value.models[0].knownRouteMacro.MAE += 0.01; }, /knownRouteMacro\.closure/);
  reject(value => { value.models[0].knownRouteMacro.routeCount = 6; }, /routeCount/);
  reject(value => { value.models[0].publishedGlobal.MAE += 1e-6; }, /publishedGlobal\.mismatch/);
  reject(value => { value.models[1].routes[2].pairedMAEDelta = 0; }, /pairedDelta/);
  reject(value => { value.models[1].micro.pairedMAEDelta = null; }, /pairedMAEDelta/);
  reject(value => { value.models[0].routes[0].pairedMAEDelta = 0; }, /pairedMAEDelta/);
  reject(value => { value.models[1].role = 'REFERENCE'; for (const score of [value.models[1].micro, value.models[1].unknown, ...value.models[1].routes]) { score.pairedMAEDelta = null; score.pairedMSEDelta = null; } }, /models\.reference/);
  reject(value => { value.models[1].id = 'BASELINE'; }, /duplicateId/);
  reject(value => { value.models[0].unknown.MAE = null; value.models[0].unknown.MSE = null; }, /unknown\.coverage/);
  reject(value => { value.models[1].routes[0].token = value.routes[1].token; }, /routes\.0\.token/);
});

test('route report: scope flags, identity and dataset constants are fixed', () => {
  reject(value => { value.modelAdoption = true; }, /modelAdoption/);
  reject(value => { value.replacesGlobalGate = true; }, /replacesGlobalGate/);
  reject(value => { value.HRead = true; }, /HRead/);
  reject(value => { value.dataset.devRows = 1; }, /dataset\.devRows/);
  reject(value => { value.routeMap.routeDefinition = 'R.route_version_id'; }, /routeMap\.definition/);
  reject(value => { value.producerStatus = 'ADOPTED'; }, /identity/);
  reject(value => { value.receiptSha256 = null; }, /receiptSha256/);
  reject(value => { value.runId = 'seat'; }, /runId/);
  reject(value => { value.vehiclePlate = 'FORBIDDEN'; }, /keys/);
});

test('route report: rows keep small and DEV-only routes visible with support, sorted without hiding', () => {
  const data = verify(artificial());
  assert.equal(defaultModelId(data), 'D6');
  const candidate = selectModel(data, null), reference = selectModel(data, 'BASELINE');
  const byWeight = routeRows(data, candidate, 'weight');
  assert.equal(byWeight.length, 7); assert.ok(byWeight[0].weightSum >= byWeight.at(-1)!.weightSum);
  const devOnly = byWeight.filter(row => row.trainSupport === null);
  assert.equal(devOnly.length, 1); assert.ok(devOnly[0].devGroups > 0);
  const byDelta = routeRows(data, candidate, 'delta');
  assert.ok(byDelta[0].pairedMAEDelta! <= byDelta.at(-1)!.pairedMAEDelta!);
  const smallest = [...byWeight].sort((a, b) => a.devGroups - b.devGroups)[0];
  assert.ok(byWeight.some(row => row.token === smallest.token));
  assert.ok(Math.abs(byWeight.reduce((sum, row) => sum + row.weightShare, 0) + data.unknown.weightSum / 351831 - 1) < 1e-9);
  const referenceRows = routeRows(data, reference, 'weight');
  assert.ok(referenceRows.every(row => row.pairedMAEDelta === null && row.relativeImprovementPct === null));
  const facts = summary(data, candidate);
  assert.equal(facts.isReference, false); assert.equal(facts.referenceId, 'BASELINE'); assert.equal(facts.devOnlyRoutes, 1);
  assert.ok(Math.abs(facts.micro.relativeImprovementPct! - (-(candidate.micro.pairedMAEDelta!) / reference.micro.MAE) * 100) < 1e-9);
  assert.equal(summary(data, reference).micro.matchesPublished, true); assert.equal(facts.micro.matchesPublished, false);
  assert.equal(seats(1.85, 'MAE'), '1.85 석'); assert.equal(seats(7.7, 'MSE'), '2.77 석'); assert.equal(seatDelta(-0.05), '-0.05 석'); assert.equal(percent(null), '—'); assert.equal(shortToken(data.routes[0].token).length, 8);
});

test('route report: GET failures retain the last verified report and reject oversized bodies', async () => {
  const original = globalThis.fetch, client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const fixture = artificial(), key = ['artificial-route-report'];
  const options = { queryKey: key, queryFn: ({ signal }: { signal: AbortSignal }) => readRouteReport(signal, NOW) };
  try {
    globalThis.fetch = async (input, init) => { assert.equal(input, '/route-report.json'); assert.equal(init?.method, 'GET'); return new Response(JSON.stringify(fixture)); };
    await client.fetchQuery(options);
    globalThis.fetch = async () => new Response(null, { status: 404 });
    await assert.rejects(client.fetchQuery(options), /HTTP_404/); assert.deepEqual(client.getQueryData(key), fixture);
    globalThis.fetch = async () => new Response('x'.repeat(262145));
    await assert.rejects(readRouteReport(new AbortController().signal, NOW), /RESPONSE_LIMIT/);
  } finally { client.clear(); globalThis.fetch = original; }
});

test('route report: a file dated ahead of the receiver clock is rejected, so the 2027 artificial fixture never verifies today', () => {
  const value = artificial();
  assert.throws(() => verifyRouteReport(value), /servedAt\.future/);
  assert.throws(() => verifyRouteReport(value, NOW - ROUTE_LIMITS.futureSkewMs - 1), /servedAt\.future/);
  assert.ok(verifyRouteReport(value, NOW - ROUTE_LIMITS.futureSkewMs));
  assert.ok(verifyRouteReport(value, NOW + 86400000));
  assert.ok(Date.now() < NOW - ROUTE_LIMITS.futureSkewMs);
});

test('route report: the route limit is reachable under the byte limit at the widest pretty-printed shape', () => {
  const value = artificial();
  const route = { token: 'f'.repeat(32), devRows: 20989927, devGroups: 351831, weightSum: 351831.123456789, trainSupport: { rows: 38651044, groups: 631972 } };
  const score = { token: route.token, MAE: -1.2345678901234567, MSE: 12.345678901234567, pairedMAEDelta: -1.2345678901234567, pairedMSEDelta: -12.345678901234567 };
  value.routes = Array.from({ length: ROUTE_LIMITS.maxRoutes }, () => ({ ...route }));
  value.models = Array.from({ length: ROUTE_LIMITS.maxModels }, (_, index) => ({ ...value.models[1], id: `CANDIDATE_MODEL_ID_${String(index).padStart(12, '0')}`, routes: value.routes.map(() => ({ ...score })) }));
  const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2)).byteLength;
  assert.ok(bytes <= ROUTE_LIMITS.responseBytes, `${bytes} > ${ROUTE_LIMITS.responseBytes}`);
  const over = artificial(); over.routes = Array.from({ length: ROUTE_LIMITS.maxRoutes + 1 }, () => ({ ...route }));
  assert.throws(() => verify(over), /^Error: ROUTE_REPORT_CONTRACT:routes$/);
});
