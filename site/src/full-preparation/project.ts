import type { FullTrainingProgress } from './types.ts';

export interface NormalizationProgress { committedRows: number; totalRows: number; percentage: number }
/** This is source-row normalization only, never overall research or training completion. */
export function normalizationProgress(value: FullTrainingProgress): NormalizationProgress | null {
  if (value.phase !== 'NORMALIZING' || value.normalization.committedRows === null) return null;
  return {
    committedRows: value.normalization.committedRows,
    totalRows: value.normalization.totalRawRows,
    percentage: value.normalization.committedRows / value.normalization.totalRawRows * 100,
  };
}
/** Keep reported clocks separate. A poll/servedAt must not fabricate progress or producer time. */
export function progressClocks(value: FullTrainingProgress) {
  return {
    snapshotWrittenAt: value.servedAt,
    lastObservedProgressAt: value.lastObservedProgressAt,
    producerReportedAt: value.sourceReportedAt,
  };
}

/** Recovery counts are verified coverage, not fresh processing or historical sums. */
export function recoveryCoverage(value: FullTrainingProgress) {
  if (value.schema !== 'full-training-progress/2' || !value.recovery) return null;
  return {
    ...value.recovery,
    coveredSourceFiles: value.normalization.committedSourceFiles,
    coveredRows: value.normalization.committedRows,
    totalSourceFiles: value.normalization.totalSourceFiles,
    totalRows: value.normalization.totalRawRows,
  };
}
