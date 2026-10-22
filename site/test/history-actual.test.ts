import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyActualCatalog, verifyActualGroups, verifyActualInvalidation, verifyActualModel, verifyActualRange, verifyActualReference, verifyActualTrial } from '../src/history/actual/contract.ts';
import { actualCatalogPath, actualRangePath, readActualHistory } from '../src/history/actual/connection.ts';
import { actualAxisTick, actualScore, resourceNumber } from '../src/history/actual/presentation.ts';
import { actualRangeOption } from '../src/history/actual/charts.ts';
import { bucketLine, rawLine } from '../src/history/project.ts';
import type { ActualRange, ActualRangeRequest } from '../src/history/actual/types.ts';
import { displayValue, formatMetric, formatDisplayNumber, metricSpec, rawMetricText } from '../src/metrics/display.ts';

/** Owner-approved saved API metadata only. Mutations below are test-only, never public responses. */
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../evidence/history-actual/fixtures/${name}.actual-saved.json`, import.meta.url), 'utf8'));
const group = verifyActualGroups(fixture('groups')).data.groups[0];
const anchor = () => {
  const groups = fixture('groups'); return { historyGenerationId: groups.historyGenerationId, snapshotCursor: groups.snapshotCursor };
};
const selectedTrial = () => fixture('trial').data.trial;

test('actual history: six exact owner response copies validate with five candidates and a separate external reference', () => {
  const groups = verifyActualGroups(fixture('groups'));
  const catalog = verifyActualCatalog(fixture('catalog'));
  const range = verifyActualRange(fixture('range'));
  const trial = verifyActualTrial(fixture('trial'), { ...anchor(), trialId: selectedTrial().trialId, group });
  const model = verifyActualModel(fixture('model'), { ...anchor(), trial: trial.data.trial, group });
  const reference = verifyActualReference(fixture('reference'), { ...anchor(), group });
  assert.equal(groups.snapshotCursor, 1);
  assert.deepEqual(catalog.data.rows.map(row => row.trialOrdinal).sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  assert.equal(range.data.counts.totalTrials, 5);
  assert.equal(model.data.model.counts.fits, 1);
  assert.equal(reference.data.reference.modelId, null);
  assert.equal(reference.data.reference.kind, 'HISTORICAL_PRODUCT_REFERENCE');
});

test('actual history: empty contract example remains empty without inventing an actual execution', () => {
  const value = JSON.parse(readFileSync(new URL('../evidence/history-actual/groups.empty.contract-example.json', import.meta.url), 'utf8'));
  const result = verifyActualGroups(value);
  assert.equal(result.historyGenerationId, 'CONTRACT_EXAMPLE_NOT_EXECUTION');
  assert.equal(result.data.groups.length, 0);
  assert.deepEqual(result.data.trialExtent, { fromOrdinal: null, toOrdinal: null });
  assert.equal(result.provenance.trainingRows, null);
});

test('actual history: v6 fixture source and modified provenance cannot enter the actual namespace', () => {
  const old = JSON.parse(readFileSync(new URL('../evidence/history-ui/fixtures/groups.artificial.json', import.meta.url), 'utf8'));
  assert.throws(() => verifyActualGroups(old));
  for (const patch of [{ adoption: true }, { HSealed: true }, { inputBodiesVerified: true }, { trainingPeriod: '2026-10-20' }]) {
    const value = fixture('groups'); Object.assign(value.provenance, patch);
    assert.throws(() => verifyActualGroups(value));
  }
});

test('actual history: common V group excludes candidate forecast input hashes, while model pins preserve them', () => {
  assert.equal('forecastRef' in group.conditions, false);
  const model = verifyActualModel(fixture('model'), { ...anchor(), trial: selectedTrial(), group }).data.model;
  assert.match(model.pins.forecastInputRef, /^[0-9a-f]{64}$/);
  assert.match(model.pins.trainingInputRef, /^[0-9a-f]{64}$/);
  assert.match(model.pins.taskTemplateRef, /^[0-9a-f]{64}$/);
  const missing = fixture('model'); delete missing.data.model.pins.taskTemplateRef;
  assert.throws(() => verifyActualModel(missing, { ...anchor(), trial: selectedTrial(), group }));
});

test('actual history: selecting a model binds immutable ID/revision/candidate and exact V population', () => {
  const expected = { ...anchor(), trial: selectedTrial(), group };
  for (const patch of [{ modelId: 'mdl_other' }, { modelRevisionRef: '0'.repeat(64) }, { candidateId: 'OTHER_CANDIDATE' }]) {
    const value = fixture('model'); Object.assign(value.data.model, patch);
    assert.throws(() => verifyActualModel(value, expected), /modelSelection/);
  }
  const wrongRows = fixture('model'); wrongRows.data.model.counts.predictionRows++;
  assert.throws(() => verifyActualModel(wrongRows, expected), /modelPins/);
  const missingState = fixture('model'); missingState.data.model.weightsRef = null;
  assert.throws(() => verifyActualModel(missingState, expected));
});

test('actual history: product reference is never a sixth model or a fabricated product PMF', () => {
  const expected = { ...anchor(), group };
  const wrongModel = fixture('reference'); wrongModel.data.reference.modelId = 'sixth-model';
  assert.throws(() => verifyActualReference(wrongModel, expected));
  const wrongNRPS = fixture('reference'); wrongNRPS.data.reference.metrics.NRPS = 0;
  assert.throws(() => verifyActualReference(wrongNRPS, expected), /externalReference/);
  const reference = verifyActualReference(fixture('reference'), expected).data.reference;
  const range = verifyActualRange(fixture('range')).data;
  const nrps = { ...range, metric: 'NRPS' as const, method: group.metricMethods.NRPS };
  const series = actualRangeOption(nrps, null, reference).series as { id: string }[];
  assert.equal(series.some(item => item.id === 'actual-external-reference'), false);
});

test('actual history: class-zero support and decisions stay evidence-limited, never adopted', () => {
  const trial = verifyActualTrial(fixture('trial'), { ...anchor(), trialId: selectedTrial().trialId, group }).data.trial;
  assert.equal(trial.support.fullGroups, 0);
  assert.equal(trial.support.rows, 127);
  assert.equal(trial.decisions.MAIN.outcome, 'INCONCLUSIVE');
  assert.equal(trial.decisions.AUX.outcome, 'INCONCLUSIVE');
  const wrongPartition = fixture('reference'); wrongPartition.data.reference.support.fullGroups = 1;
  assert.throws(() => verifyActualReference(wrongPartition, { ...anchor(), group }), /groupPartition/);
  const adopted = fixture('range'); adopted.data.adoptedModel = selectedTrial().modelId;
  assert.throws(() => verifyActualRange(adopted));
});

test('actual history: null raw scores and HAS_GAPS summaries never bridge missing results', () => {
  const value = fixture('range');
  value.data.points[1].metricState = 'NULL'; value.data.points[1].value = null;
  value.data.counts.validCount--; value.data.counts.nullCount++;
  const raw = verifyActualRange(value).data;
  assert.equal(rawLine(raw.points)[1].value[1], null);
  const valid = raw.points.filter(point => point.metricState === 'VALID');
  const min = valid.reduce((a, b) => a.value! < b.value! ? a : b);
  const max = valid.reduce((a, b) => a.value! > b.value! ? a : b);
  const summarized = structuredClone(value);
  summarized.data.mode = 'MIN_MAX'; summarized.data.points = [];
  summarized.data.buckets = [{ fromOrdinal: 1, toOrdinal: 5, first: valid[0], last: valid.at(-1), min, max, continuity: 'HAS_GAPS', counts: raw.counts }];
  const range = verifyActualRange(summarized).data;
  assert.ok(bucketLine(range.buckets).every(item => item.value[1] === null));
  assert.equal((actualRangeOption(range, null, undefined).series as { id: string; connectNulls?: boolean }[]).find(item => item.id === 'actual-candidate-line')?.connectNulls, false);
});

test('actual history: commit cursor one is independent of five ordinals and requests remain bounded', () => {
  const request: ActualRangeRequest = { ...anchor(), groupRef: group.groupRef, metric: 'MSE', fromOrdinal: 1, toOrdinal: 5, mode: 'RAW', buckets: 128 };
  const path = new URL(actualRangePath(request), 'http://localhost/');
  assert.equal(path.searchParams.get('snapshotCursor'), '1');
  assert.equal(path.searchParams.get('toOrdinal'), '5');
  assert.equal(path.searchParams.get('metric'), 'MSE');
  assert.throws(() => actualRangePath({ ...request, toOrdinal: 2001 }), /RANGE_REQUEST/);
  assert.throws(() => actualRangePath({ ...request, mode: 'MIN_MAX', toOrdinal: 10001 }), /RANGE_REQUEST/);
  const catalog = new URL(actualCatalogPath({ ...anchor(), groupRef: group.groupRef, status: '', cursor: 'opaque/+signed==', limit: 100 }), 'http://localhost/');
  assert.equal(catalog.searchParams.get('cursor'), 'opaque/+signed==');
  assert.throws(() => actualCatalogPath({ ...anchor(), groupRef: group.groupRef, status: '', cursor: null, limit: 101 }));
});

test('actual history: small positive scores and neighboring Brier axis ticks remain distinct', () => {
  assert.equal(actualScore(1.402e-5), '1.402e-5');
  assert.equal(actualScore(1.318e-5), '1.318e-5');
  assert.equal(actualScore(1.5535542221261573e-8), '1.554e-8');
  assert.deepEqual([5e-6, 1e-5, 1.5e-5, 2e-5, 2.5e-5].map(actualAxisTick), ['5e-6', '1e-5', '1.5e-5', '2e-5', '2.5e-5']);
  assert.equal(actualScore(null), '—');
  assert.equal(actualScore(0), '0');
});

test('actual history: bundle invalidations use commit units and keep external reference out of model count', () => {
  const event = { schemaVersion: 'history-actual-invalidation-v1', ...anchor(), commitCursor: 1, changeKind: 'RUN_BUNDLE_IMPORTED', runId: 'REAL_P1_VEHICLE_20261020_R1', fromTrialOrdinal: 1, toTrialOrdinal: 5, modelCount: 5, evaluationCount: 5, referenceCount: 1 };
  delete (event as Partial<typeof event>).snapshotCursor;
  const validated = verifyActualInvalidation(event);
  assert.equal(validated.commitCursor, 1);
  assert.equal(validated.toTrialOrdinal, 5);
  assert.throws(() => verifyActualInvalidation({ ...event, modelCount: 6 }), /bundleCounts/);
});

test('actual history: read failure stays on v8 and never falls back to the 10k fixture endpoint', async () => {
  const original = globalThis.fetch, requests: string[] = [];
  try {
    globalThis.fetch = async (input, init) => {
      requests.push(String(input)); assert.equal(init?.method, 'GET');
      return new Response(JSON.stringify({ error: { code: 'STORAGE_UNAVAILABLE' } }), { status: 503 });
    };
    await assert.rejects(readActualHistory('groups', new AbortController().signal, verifyActualGroups), /STORAGE_UNAVAILABLE/);
    assert.deepEqual(requests, ['/api/v8/history/groups']);
  } finally { globalThis.fetch = original; }
});

type DisplayDatum = { value: [number, number | null]; rawValue: number | null; candidateId?: string; symbolSize?: number };
type DisplaySeries = { id: string; connectNulls?: boolean; data: DisplayDatum[] };
function displayRange(values: (number | null)[], metric: ActualRange['metric'] = 'MSE'): ActualRange {
  // Display-only test mutations: no API, scoring policy or saved evidence is changed.
  const range = verifyActualRange(fixture('range')).data;
  range.metric = metric; range.method = group.metricMethods[metric]; range.toOrdinal = values.length;
  range.points = range.points.slice(0, values.length).map((point, index) => ({
    ...point, value: values[index], metricState: values[index] === null ? 'NULL' : 'VALID',
  }));
  range.counts = { totalTrials: values.length, validCount: values.filter(value => value !== null).length,
    nullCount: values.filter(value => value === null).length, invalidCount: 0, unregisteredCount: 0, failedCount: 0, heldCount: 0, runningCount: 0 };
  range.observedBestSoFar = { carryIn: null, end: range.points.filter(point => point.value !== null).reduce<ActualRange['points'][number] | null>((best, point) => best === null || point.value! < best.value! ? point : best, null) };
  return range;
}

test('actual history display: readable MSE uses RMSE coordinates for line, points and product reference without mutating raw data', () => {
  const range = displayRange([4, 9, 16]);
  const reference = verifyActualReference(fixture('reference'), { ...anchor(), group }).data.reference;
  reference.metrics.MSE = 25;
  const before = structuredClone({ range, reference });
  const selectedId = range.points[1].trialId;
  const option = actualRangeOption(range, selectedId, reference, false, 'readable');
  const series = option.series as DisplaySeries[];
  assert.deepEqual(series.find(item => item.id === 'actual-candidate-line')!.data.map(point => point.value[1]), [2, 3, 4]);
  const points = series.find(item => item.id === 'actual-candidate-points')!.data;
  assert.deepEqual(points.map(point => point.value[1]), [2, 3, 4]);
  assert.deepEqual(points.map(point => point.rawValue), [4, 9, 16]);
  assert.equal(points[1].candidateId, selectedId);
  assert.equal(points[1].symbolSize, 11);
  assert.deepEqual(series.find(item => item.id === 'actual-external-reference')!.data.map(point => point.value[1]), [5, 5]);
  assert.equal((option.yAxis as { name: string }).name, '석');
  assert.match((option.aria as { description: string }).description, /RMSE/);
  assert.equal(metricSpec('MSE', 'raw').label, 'MSE');
  assert.equal(metricSpec('MSE', 'readable').label, 'RMSE');
  assert.deepEqual({ range, reference }, before);
  const raw = actualRangeOption(range, selectedId, reference, false, 'raw').series as DisplaySeries[];
  assert.deepEqual(raw.find(item => item.id === 'actual-candidate-points')!.data.map(point => point.value[1]), [4, 9, 16]);
});

test('actual history display: MSE min/max bands transform their endpoints while HAS_GAPS remains disconnected', () => {
  const raw = displayRange([4, null, 16]);
  const first = raw.points[0], last = raw.points[2];
  const range: ActualRange = { ...raw, mode: 'MIN_MAX', points: [], buckets: [{
    fromOrdinal: 1, toOrdinal: 3, first, last, min: first, max: last, continuity: 'HAS_GAPS', counts: raw.counts,
  }] };
  const before = structuredClone(range);
  const series = actualRangeOption(range, null, undefined, true, 'readable').series as DisplaySeries[];
  assert.deepEqual(series.find(item => item.id === 'actual-gap-bands')!.data.map(point => point.value[1]), [2, 4, null]);
  assert.deepEqual(series.find(item => item.id === 'actual-gap-bands')!.data.map(point => point.rawValue), [4, 16, null]);
  const line = series.find(item => item.id === 'actual-candidate-line')!;
  assert.equal(line.connectNulls, false);
  assert.ok(line.data.every(point => point.value[1] === null));
  assert.deepEqual(range, before);
});

test('actual history display: scaled Brier and diagnostic units retain tiny nonzero values, zero and null semantics', () => {
  const range = displayRange([1.5535542221261573e-8, 0, null], 'Brier');
  const series = actualRangeOption(range, null, undefined, true, 'readable').series as DisplaySeries[];
  const line = series.find(item => item.id === 'actual-candidate-line')!;
  assert.equal(line.data[0].value[1], range.points[0].value! * 1_000_000);
  assert.ok(line.data[0].value[1]! > 0);
  assert.equal(line.data[1].value[1], 0);
  assert.equal(line.data[2].value[1], null);
  assert.equal(formatMetric(1.402e-5, 'Brier', 'readable'), '14.02');
  assert.equal(formatMetric(1.318e-5, 'Brier', 'readable'), '13.18');
  assert.notEqual(formatMetric(1e-20, 'Brier', 'readable'), '0');
  assert.equal(displayValue(.0582, 'NRPS', 'readable'), 5.82);
  assert.equal(metricSpec('NRPS', 'readable').unit, '점');
  assert.match(metricSpec('NRPS', 'readable').explanation, /정확도가 아닙니다/);
  assert.equal(displayValue(.015, 'ECE', 'readable'), 1.5);
  assert.equal(metricSpec('ECE', 'readable').unit, '%p');
  assert.equal(displayValue(null, 'ECE', 'readable'), null);
});

test('actual history display: tooltip keeps exact raw MSE and the axis formats transformed values only once', () => {
  const range = displayRange([4, 9, 16]);
  const option = actualRangeOption(range, null, undefined, false, 'readable');
  const points = (option.series as DisplaySeries[]).find(item => item.id === 'actual-candidate-points')!.data;
  const tooltip = (option.tooltip as { formatter: (params: { data: DisplayDatum }) => string }).formatter({ data: points[2] });
  assert.match(tooltip, /RMSE 4\.00 석/);
  assert.ok(tooltip.includes(`원값 MSE: ${rawMetricText(16)}`));
  const axis = option.yAxis as { axisLabel: { formatter: (value: number) => string } };
  assert.equal(axis.axisLabel.formatter(4), formatDisplayNumber(4));
  assert.notEqual(axis.axisLabel.formatter(4), formatDisplayNumber(Math.sqrt(4)));
});

test('actual history display: negative MSE cannot become NaN and resource time remains outside metric conversion', () => {
  const range = displayRange([-1, 0, null]);
  const series = actualRangeOption(range, null, undefined, false, 'readable').series as DisplaySeries[];
  assert.deepEqual(series.find(item => item.id === 'actual-candidate-line')!.data.map(point => point.value[1]), [null, 0, null]);
  assert.equal(displayValue(-1, 'MSE', 'readable'), null);
  assert.equal(resourceNumber(.075), '0.075');
  assert.equal(resourceNumber(2e-6), '2.000e-6');
  assert.equal(resourceNumber(null), '—');
});
