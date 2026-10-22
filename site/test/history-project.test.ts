import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyCatalog, verifyRange } from '../src/history/contract.ts';
import { bucketLine, boundedWindow, lastWindow, modelSelectionKey, rawLine, resolveSelection, sampledPoints, windowFromZoom } from '../src/history/project.ts';
import { historyTimelineOption } from '../src/history/charts.ts';
import type { MetricPoint, RangeBucket } from '../src/history/types.ts';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../evidence/history-ui/fixtures/${name}.artificial.json`, import.meta.url), 'utf8'));
const point = (ordinal: number, value: number | null = .3): MetricPoint => ({
  ...fixture('range').data.buckets[0].first,
  trialId: `trial-${ordinal}`, trialOrdinal: ordinal, evaluationId: `evaluation-${ordinal}`,
  metricState: value === null ? 'NULL' : 'VALID', value,
});
const bucket = (from: number, to: number, continuity: RangeBucket['continuity']): RangeBucket => ({
  fromOrdinal: from, toOrdinal: to, continuity,
  first: point(from), last: point(to), min: point(to, .2), max: point(from, .3),
  counts: { totalTrials: to - from + 1, validCount: to - from + 1, nullCount: 0, invalidCount: 0, unregisteredCount: 0, failedCount: 0, heldCount: 0, runningCount: 0 },
});

test('history projections: invalid, null, and unregistered records break raw connections', () => {
  const invalid = { ...point(3, null), metricState: 'INVALID' as const };
  const unregistered = { ...point(5, null), metricState: 'UNREGISTERED' as const };
  const line = rawLine([point(1), point(2, null), invalid, point(4), unregistered, point(7)]);
  assert.deepEqual(line.map(item => item.value), [[1, .3], [2, null], [3, null], [4, .3], [5, null], [7, .3]]);
  assert.ok(line.filter(item => item.value[1] === null).every(item => item.candidateId === undefined));
});

test('history projections: interleaved other-group ordinals do not invent missing evaluations', () => {
  assert.deepEqual(rawLine([point(1), point(4), point(7)]).map(item => item.value), [[1, .3], [4, .3], [7, .3]]);
  const a = { ...bucket(1, 4, 'ALL_VALID'), first: point(1), last: point(3) };
  const b = { ...bucket(5, 8, 'ALL_VALID'), first: point(6), last: point(8) };
  const line = bucketLine([a, b]);
  assert.deepEqual(line.slice(1).map(item => item.value), [[1, .3], [3, .3], [6, .3], [8, .3]]);
});

test('history projections: no score line enters, exits, or crosses a HAS_GAPS bucket', () => {
  const line = bucketLine([bucket(1, 4, 'ALL_VALID'), bucket(5, 8, 'HAS_GAPS'), bucket(9, 12, 'ALL_VALID')]);
  const segments: number[][] = [[]];
  for (const item of line) {
    if (item.value[1] === null) segments.push([]);
    else segments.at(-1)!.push(item.value[0]);
  }
  assert.deepEqual(segments.filter(segment => segment.length), [[1, 4], [9, 12]]);
  assert.equal(line.some(item => item.candidateId && item.value[0] >= 5 && item.value[0] <= 8), false);
});

test('history projections: empty buckets and ordinal discontinuities separate otherwise valid buckets', () => {
  const empty = { ...bucket(5, 8, 'NO_VALID'), first: null, last: null, min: null, max: null };
  const line = bucketLine([bucket(1, 4, 'ALL_VALID'), empty, bucket(9, 12, 'ALL_VALID'), bucket(20, 24, 'ALL_VALID')]);
  assert.ok(line.find(item => item.value[0] === 5 && item.value[1] === null));
  assert.ok(line.find(item => item.value[0] === 20 && item.value[1] === null));
});

test('history selection: duplicate cycle indices and repeated models remain separate evaluations', () => {
  const first = verifyCatalog(fixture('catalog')).data.rows[0];
  const second = { ...first, trialId: 'trial-other', evaluationId: 'evaluation-other', runId: 'another-run', trialOrdinal: 2 };
  assert.equal(resolveSelection(second.trialId, [first, second])?.evaluationId, 'evaluation-other');
  assert.equal(resolveSelection('unloaded-trial', [first, second]), undefined);
  assert.deepEqual(modelSelectionKey(second), [first.modelId, first.modelRevisionRef]);
  assert.equal(resolveSelection(null, [first, second])?.trialId, first.trialId);
});

test('history windows: presets and zoom events produce bounded new server windows', () => {
  const extent = { fromOrdinal: 1, toOrdinal: 10000 };
  assert.deepEqual(lastWindow(500, extent), { fromOrdinal: 9501, toOrdinal: 10000 });
  assert.deepEqual(boundedWindow({ fromOrdinal: -10, toOrdinal: 50000 }, extent), extent);
  assert.deepEqual(windowFromZoom({ start: 20, end: 30 }, extent), { fromOrdinal: 2000, toOrdinal: 3001 });
  assert.deepEqual(windowFromZoom({ batch: [{ startValue: 400, endValue: 800 }] }, extent), { fromOrdinal: 400, toOrdinal: 800 });
  assert.equal(windowFromZoom({ start: 0, end: 100 }, extent), null);
  assert.equal(windowFromZoom({ start: NaN, end: 100 }, extent), null);
});

test('history charts: summary bands are silent, raw points retain immutable trial selection, and zoom is present', () => {
  const range = verifyRange(fixture('range')).data;
  const option = historyTimelineOption(range, range.buckets[0].first!.trialId, true);
  const series = option.series as { id: string; silent?: boolean; connectNulls?: boolean; type: string; data: { candidateId?: string; symbolSize?: number }[] }[];
  assert.equal(series.find(item => item.id === 'history-band-Brier')?.silent, true);
  assert.equal(series.find(item => item.id === 'history-line-Brier')?.connectNulls, false);
  const plotted = series.find(item => item.type === 'scatter')!;
  assert.equal(plotted.data[0].candidateId, range.buckets[0].first!.trialId);
  assert.equal(plotted.data[0].symbolSize, 11);
  assert.equal((option.dataZoom as unknown[]).length, 2);
  assert.equal(sampledPoints(range).length, 1);
});

test('history charts: nearby NRPS ticks remain distinguishable at five decimal places', () => {
  const range = { ...verifyRange(fixture('range')).data, metric: 'NRPS' as const, method: 'NRPS_V1' };
  const option = historyTimelineOption(range, null);
  const axis = option.yAxis as { axisLabel: { formatter: (value: number) => string } };
  assert.equal(axis.axisLabel.formatter(.0086), '0.00860');
  assert.equal(axis.axisLabel.formatter(.009), '0.00900');
});
