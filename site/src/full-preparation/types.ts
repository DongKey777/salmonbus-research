export const FULL_PHASES = [
  'PREPARING_RESOURCE', 'UPLOADING', 'NORMALIZING', 'BUILDING_DATASET',
  'TRAINING', 'EVALUATING', 'STOPPED', 'COMPLETE',
] as const;
export type FullPhase = typeof FULL_PHASES[number];

export interface FullTrainingProgressV1 {
  schema: 'full-training-progress/1';
  origin: 'REAL_OBSERVATION_PIPELINE';
  phase: FullPhase;
  servedAt: string;
  lastObservedProgressAt: string | null;
  sourceReportedAt: string | null;
  statusDetail: string;
  normalization: {
    committedSourceFiles: number | null;
    totalSourceFiles: 5341;
    committedRows: number | null;
    totalRawRows: 156905287;
    compressedBytesRead: number | null;
    totalCompressedBytes: 4189735827;
    complete: boolean;
  };
  training: {
    ready: boolean;
    trainRows: number | null;
    devRows: number | null;
    cpuFits: number;
    gpuFits: number;
  };
  resources: {
    gpuName: string | null;
    allocatedHostMemoryGB: number | null;
    cpuSeconds: number | null;
    workerWallSeconds: number | null;
    processRssBytes: number | null;
    estimatedComputeUsd: number | null;
  };
}

export const EXECUTION_MODES = ['SINGLE_PROCESS', 'MULTI_PROCESS'] as const;
export const RSS_MEASUREMENT_KINDS = [
  'PROCESS_PEAK', 'AGGREGATE_SAMPLED_PEAK', 'PEAK_SUM_UPPER_BOUND', 'UNMEASURED',
] as const;
export type RssMeasurementKind = typeof RSS_MEASUREMENT_KINDS[number];
export interface CurrentAttempt {
  id: string;
  executionMode: typeof EXECUTION_MODES[number];
  workerCount: number;
  reason: string;
}
export interface PreviousAttempt {
  id: string;
  status: 'STOPPED' | 'COMPLETE';
  reason: string;
  committedSourceFiles: number | null;
  committedRows: number | null;
  elapsedSeconds: number | null;
}
export const PARTIAL_VERIFICATION_STATUSES = ['NOT_STARTED', 'VERIFYING', 'VERIFIED', 'FAILED', 'UNKNOWN'] as const;
export interface RecoveryProgress {
  reusedSourceFiles: number | null;
  reusedRows: number | null;
  freshSourceFiles: number | null;
  freshRows: number | null;
  partialVerificationStatus: typeof PARTIAL_VERIFICATION_STATUSES[number];
  sourceAttemptId: string;
}
export interface FullTrainingProgressV2 extends Omit<FullTrainingProgressV1, 'schema' | 'resources'> {
  schema: 'full-training-progress/2';
  currentAttempt: CurrentAttempt;
  previousAttempts: PreviousAttempt[];
  recovery?: RecoveryProgress;
  resources: FullTrainingProgressV1['resources'] & {
    rssMeasurementKind: RssMeasurementKind;
    allocatedVcpuCount: number | null;
    cpuQuotaCores: number | null;
    workloadCpuUtilizationPercent: number | null;
    gpuUtilizationPercent: number | null;
    gpuMemoryUsedBytes: number | null;
  };
}
export type FullTrainingProgress = FullTrainingProgressV1 | FullTrainingProgressV2;
