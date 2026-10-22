export const BATCH_PHASES = ['WAITING', 'BUILDING_MATRIX', 'TRAINING', 'EVALUATING', 'COMPLETE', 'FAILED'] as const;
export const MODEL_STATUSES = ['VALIDATED_SAVED_REFERENCE', 'NOT_OBSERVED', 'BUILDING_MATRIX', 'TRAINING', 'EVALUATING', 'FINALIZING', 'COMPLETE', 'VERIFIED', 'SKIPPED', 'TRAINED_NOT_ACCEPTED', 'PROGRESS_OBSERVED'] as const;
export type BatchPhase = typeof BATCH_PHASES[number];
export type ModelId = 'BASELINE' | 'A' | 'B';
export interface BatchMetrics { MAE: number; MSE: number; RMSE: number; Brier: null; logLoss: null; NRPS: null }
export interface BatchModel {
  id: ModelId;
  targetRounds: 64 | 128 | 256;
  observedRounds: number | null;
  status: typeof MODEL_STATUSES[number];
  metrics: BatchMetrics | null;
  gatePassed: boolean | null;
}
export interface FullLearningBatch {
  schema: 'full-learning-batch/1';
  origin: 'REAL_OBSERVATION_PIPELINE';
  runId: 'SEAT_CONTINUATION_001';
  phase: BatchPhase;
  terminal: boolean;
  statusDetail: string;
  candidate: 'A' | 'B' | null;
  trainingCallsReserved: number | null;
  verifiedCandidateCount: number;
  currentModelRoundsCompleted: number | null;
  trainRows: 38651044;
  devRows: 20989927;
  baselineRounds: 64;
  models: BatchModel[];
  bestObservedDevModel: ModelId | null;
  workerElapsedSeconds: number | null;
  servedAt: string;
  sourceReportedAt: string | null;
  legacyRunAccepted: false;
  modelAdoption: false;
  generalizationClaim: false;
  DEVReused: true;
  productComparison: 'NOT_CONNECTED';
}
