import type { HistoryRange, MetricPoint, OrdinalWindow, RangeBucket, Trial } from './types.ts';

/** Ordinals are experiment records. They are never epochs or model versions. */
export function boundedWindow(window: OrdinalWindow, extent: OrdinalWindow): OrdinalWindow {
  const fromOrdinal = Math.max(extent.fromOrdinal, Math.min(Math.round(window.fromOrdinal), extent.toOrdinal));
  const toOrdinal = Math.max(fromOrdinal, Math.min(Math.round(window.toOrdinal), extent.toOrdinal, fromOrdinal + 9999));
  return { fromOrdinal, toOrdinal };
}
export function lastWindow(size: number, extent: OrdinalWindow): OrdinalWindow {
  return { fromOrdinal: Math.max(extent.fromOrdinal, extent.toOrdinal - size + 1), toOrdinal: extent.toOrdinal };
}
export function windowFromZoom(
  event: { start?: number; end?: number; startValue?: number; endValue?: number; batch?: unknown[] },
  window: OrdinalWindow,
): OrdinalWindow | null {
  const value = (Array.isArray(event.batch) ? event.batch[0] : event) as typeof event | undefined;
  if (!value) return null;
  const width = window.toOrdinal - window.fromOrdinal;
  const start = typeof value.startValue === 'number' ? value.startValue :
    typeof value.start === 'number' ? window.fromOrdinal + width * value.start / 100 : NaN;
  const end = typeof value.endValue === 'number' ? value.endValue :
    typeof value.end === 'number' ? window.fromOrdinal + width * value.end / 100 : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null;
  const next = boundedWindow({ fromOrdinal: Math.floor(start), toOrdinal: Math.ceil(end) }, window);
  return next.fromOrdinal === window.fromOrdinal && next.toOrdinal === window.toOrdinal ? null : next;
}
export function isValidPoint(point: MetricPoint | null): point is MetricPoint & { value: number } {
  return point !== null && point.metricState === 'VALID' && point.value !== null && Number.isFinite(point.value);
}
export type PlotPoint = { value: [number, number | null]; candidateId?: string; trialOrdinal?: number };
const plotPoint = (point: MetricPoint): PlotPoint => ({
  value: [point.trialOrdinal, isValidPoint(point) ? point.value : null],
  ...(isValidPoint(point) ? { candidateId: point.trialId, trialOrdinal: point.trialOrdinal } : {}),
});
const gap = (ordinal: number): PlotPoint => ({ value: [ordinal, null] });

/** RAW is complete for the selected group: other groups' ordinals are not missing results. */
export function rawLine(points: MetricPoint[]): PlotPoint[] {
  return points.map(plotPoint);
}
/** Only contiguous ALL_VALID buckets may share a line. HAS_GAPS uses markers/bands only. */
export function bucketLine(buckets: RangeBucket[]): PlotPoint[] {
  const result: PlotPoint[] = [];
  let previous: RangeBucket | undefined;
  for (const bucket of buckets) {
    if (bucket.continuity !== 'ALL_VALID' || !isValidPoint(bucket.first) || !isValidPoint(bucket.last)) {
      result.push(gap(bucket.fromOrdinal));
      previous = undefined;
      continue;
    }
    if (!previous || previous.toOrdinal + 1 !== bucket.fromOrdinal) result.push(gap(bucket.fromOrdinal));
    result.push(plotPoint(bucket.first));
    if (bucket.last.trialId !== bucket.first.trialId) result.push(plotPoint(bucket.last));
    previous = bucket;
  }
  return result;
}
export function sampledPoints(range: Pick<HistoryRange, 'mode' | 'points' | 'buckets'>): MetricPoint[] {
  const values = range.mode === 'RAW' ? range.points :
    range.buckets.flatMap(bucket => [bucket.first, bucket.last, bucket.min, bucket.max]);
  return [...new Map(values.filter(isValidPoint).map(point => [point.trialId, point])).values()]
    .sort((a, b) => a.trialOrdinal - b.trialOrdinal);
}
export function resolveSelection(trialId: string | null, rows: Trial[]): Trial | undefined {
  // A selection uses the immutable trial ID. A repeated model evaluation remains distinct.
  return trialId === null ? rows[0] : rows.find(row => row.trialId === trialId);
}
export function modelSelectionKey(trial: Pick<Trial, 'modelId' | 'modelRevisionRef'>) {
  return [trial.modelId, trial.modelRevisionRef] as const;
}
