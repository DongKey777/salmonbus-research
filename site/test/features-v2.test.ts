import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyFeaturesV2Report } from '../src/features-v2/contract.ts';

const NOW = Date.parse('2026-10-22T00:00:00+00:00');
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/features-v2-test-only.json', import.meta.url), 'utf8'));
const verify = (value: unknown) => verifyFeaturesV2Report(value, NOW, { allowTestOnly: true });
const reject = (change: (value: any) => void, pattern: RegExp) => { const value = fixture(); change(value); assert.throws(() => verify(value), pattern); };

test('features v2: test-only report is refused unless explicitly allowed', () => {
  const value = fixture();
  assert.equal(value.producerStatus, 'TEST_ONLY_NOT_ACCEPTED');
  assert.throws(() => verifyFeaturesV2Report(value, NOW), /testOnlyReport/);
  const data = verify(value);
  assert.equal(data.featureGroups.flatMap(group => group.names).length, 32);
  assert.deepEqual(data.featureGroups.map(group => group.id), ['BASE', 'PRODUCTION', 'EXTRA', 'STOP_DEMAND']);
  assert.deepEqual(data.seatModels.slice(0, 2).map(model => model.role), ['REFERENCE', 'PRODUCT']);
});

test('features v2: route and segment rows close to the declared DEV population and to every model MAE', () => {
  const data = verify(fixture());
  assert.equal(data.routes.reduce((sum, route) => sum + route.devRows, 0), data.dataset.devRows);
  assert.ok(data.routes.every(route => /^[0-9a-f]{16}$/.test(route.token)));
  reject(value => { value.routes[0].devRows += 1; }, /routes\.closure/);
  reject(value => { value.routes[0].MAE.D6 += 0.5; }, /routes\.micro\.D6/);
  reject(value => { value.segments[0].rows[0].weight += 1; }, /segments\.0\.closure/);
  reject(value => { value.routes[1].token = value.routes[0].token; }, /duplicate/);
});

test('features v2: routes are listed by token so position never follows route_id', () => {
  const data = verify(fixture());
  const tokens = data.routes.map(route => route.token);
  assert.deepEqual(tokens, [...tokens].sort());
  reject(value => { value.routes.reverse(); }, /routes\.1\.order/);
  reject(value => { [value.routes[2], value.routes[3]] = [value.routes[3], value.routes[2]]; }, /routes\.3\.order/);
  const published = JSON.parse(readFileSync(new URL('../public/features-v2-report.json', import.meta.url), 'utf8'));
  const order = verifyFeaturesV2Report(published, Date.parse(published.servedAt)).routes.map(route => route.token);
  assert.deepEqual(order, [...order].sort());
});

test('features v2: deltas, ablations and curves must agree with the scores they summarise', () => {
  reject(value => { value.seatModels[2].deltaVsReference.MAE += 0.01; }, /deltaVsReference\.closure/);
  reject(value => { value.seatModels[2].deltaVsProduct = null; }, /deltaMissing/);
  reject(value => { value.ablations[0].MAEDelta = -value.ablations[0].MAEDelta - 1; }, /ablations\.0\.closure/);
  reject(value => { value.curve[1].points.at(-1).MAE += 0.1; }, /curve\.1\.final/);
  reject(value => { value.fullModels[0].Brier = 1.5; }, /Brier\.range/);
});

test('features v2: claims and identity stay fixed', () => {
  reject(value => { value.modelAdoption = true; }, /modelAdoption/);
  reject(value => { value.DEVReused = false; }, /DEVReused/);
  reject(value => { value.schema = 'features-v2-report/2'; }, /identity/);
  reject(value => { value.extra = 1; }, /root\.keys/);
  reject(value => { value.servedAt = '2030-01-01T00:00:00Z'; }, /servedAt\.future/);
});
