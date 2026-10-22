import { useEffect, useState } from 'react';
import type { FullTrainingProgress, FullTrainingProgressV2 } from './types.ts';

export interface ObservationWindow { previous: FullTrainingProgressV2 | null; current: FullTrainingProgressV2 | null }
const emptyWindow = (): ObservationWindow => ({ previous: null, current: null });

function processingRows(data: FullTrainingProgressV2) {
  return data.recovery ? data.recovery.freshRows : data.normalization.committedRows;
}
function sameProcessingSeries(before: FullTrainingProgressV2, after: FullTrainingProgressV2) {
  return before.currentAttempt.id === after.currentAttempt.id &&
    Boolean(before.recovery) === Boolean(after.recovery) &&
    before.recovery?.sourceAttemptId === after.recovery?.sourceAttemptId;
}

/** Polls with the same actual-progress clock are not independent observations. */
export function advanceObservation(window: ObservationWindow, data: FullTrainingProgress | undefined): ObservationWindow {
  if (!data || data.schema !== 'full-training-progress/2' || data.phase !== 'NORMALIZING' ||
    data.lastObservedProgressAt === null) return emptyWindow();
  const current = window.current;
  if (!current || !sameProcessingSeries(current, data)) return { previous: null, current: data };
  const elapsed = Date.parse(data.lastObservedProgressAt) - Date.parse(current.lastObservedProgressAt!);
  if (elapsed === 0) return window;
  const rows = processingRows(data), oldRows = processingRows(current);
  if (elapsed < 0 || rows === null || oldRows === null || rows < oldRows) return { previous: null, current: data };
  // A coverage increase from verifying reusable artifacts is not fresh processing.
  // Keep the last fresh-row observation as the baseline; suppress its displayed
  // rate until a subsequent fresh-row observation arrives.
  if (data.recovery && rows === oldRows) return window;
  return { previous: current, current: data };
}

export function observationRates(window: ObservationWindow) {
  const { previous, current } = window;
  if (!previous || !current || !sameProcessingSeries(previous, current) ||
    previous.phase !== 'NORMALIZING' || current.phase !== 'NORMALIZING' ||
    previous.lastObservedProgressAt === null || current.lastObservedProgressAt === null) return null;
  const previousRows = processingRows(previous), currentRows = processingRows(current);
  if (previousRows === null || currentRows === null) return null;
  const seconds = (Date.parse(current.lastObservedProgressAt) - Date.parse(previous.lastObservedProgressAt)) / 1000;
  const rows = currentRows - previousRows;
  if (seconds <= 0 || rows < 0 || (current.recovery && rows === 0)) return null;
  const rowsPerSecond = rows / seconds;
  let derivedCpuUtilizationPercent: number | null = null;
  const before = previous.resources, after = current.resources;
  if (before.cpuSeconds !== null && after.cpuSeconds !== null &&
    before.workerWallSeconds !== null && after.workerWallSeconds !== null &&
    after.cpuQuotaCores !== null && after.cpuQuotaCores === before.cpuQuotaCores) {
    const cpuDelta = after.cpuSeconds - before.cpuSeconds;
    const wallDelta = after.workerWallSeconds - before.workerWallSeconds;
    const cpu = cpuDelta / wallDelta / after.cpuQuotaCores * 100;
    if (cpuDelta >= 0 && wallDelta > 0 && Number.isFinite(cpu) && cpu >= 0 && cpu <= 100) derivedCpuUtilizationPercent = cpu;
  }
  return {
    rowsPerSecond, intervalSeconds: seconds, derivedCpuUtilizationPercent,
    remainingSeconds: rowsPerSecond > 0 && current.normalization.committedRows !== null ?
      (current.normalization.totalRawRows - current.normalization.committedRows) / rowsPerSecond : null,
  };
}

/** A reused-only coverage update must not keep showing the prior fresh rate. */
export function ratesForObservation(window: ObservationWindow, data: FullTrainingProgress | undefined) {
  if (!data || data.schema !== 'full-training-progress/2' || data.phase !== 'NORMALIZING' ||
    !window.current || !sameProcessingSeries(window.current, data) ||
    window.current.lastObservedProgressAt !== data.lastObservedProgressAt ||
    processingRows(window.current) !== processingRows(data) ||
    window.current.normalization.committedRows !== data.normalization.committedRows ||
    window.current.normalization.committedSourceFiles !== data.normalization.committedSourceFiles) return null;
  return observationRates(window);
}

export function useObservationRates(data: FullTrainingProgress | undefined) {
  const [window, setWindow] = useState<ObservationWindow>(emptyWindow);
  useEffect(() => { setWindow(previous => advanceObservation(previous, data)); }, [data]);
  return ratesForObservation(window, data);
}
