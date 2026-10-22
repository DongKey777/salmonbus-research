export type DepthModelId = 'BASELINE' | 'D4' | 'D6' | 'D8';
export const DEPTH_RUN_ID = 'SEAT_DEPTH_SWEEP_002' as const;
export const DEPTH_SCHEMA = 'full-depth-sweep/2' as const;
export const DEPTH_FUTURE_SKEW_MS = 600000;
export const PRIOR_DEPTH_ATTEMPT = { runId: 'SEAT_DEPTH_SWEEP_001', outcome: 'STOPPED_BEFORE_TRAINING', freshFits: 0, accepted: false, publicScorePublished: false } as const;
export const DEPTH_PRODUCER_STATUSES = ['FRESH_DEPTH_SWEEP_AND_DEV_VERIFIED_NOT_ADOPTED', 'FAILED_PRESERVED_NOT_ACCEPTED'] as const;
export const DEPTH_PHASES = ['WAITING', 'BUILDING_MATRIX', 'TRAINING', 'EVALUATING', 'COMPLETE', 'FAILED'] as const;
export const DEPTH_MODEL_STATUSES = ['VALIDATED_SAVED_REFERENCE', 'NOT_OBSERVED', 'TRAINING', 'EVALUATING', 'BUILDING_MATRIX', 'FINALIZING', 'COMPLETE', 'VERIFIED', 'TRAINED_NOT_EVALUATED', 'PROGRESS_OBSERVED'] as const;
export interface DepthMetrics { MAE: number; MSE: number; RMSE: number; Brier: null; logLoss: null; NRPS: null }
export interface DepthModel {
  id: DepthModelId;
  depth: 4 | 6 | 8;
  trainingMode: 'CONTINUED_REFERENCE' | 'FRESH_FROM_ZERO';
  targetRounds: 256;
  observedRounds: number | null;
  status: typeof DEPTH_MODEL_STATUSES[number];
  metrics: DepthMetrics | null;
  gatePassed: boolean | null;
}
export interface FullDepthSweep {
  schema: typeof DEPTH_SCHEMA;
  origin: 'REAL_OBSERVATION_PIPELINE';
  runId: typeof DEPTH_RUN_ID;
  producerStatus: typeof DEPTH_PRODUCER_STATUSES[number] | null;
  priorAttempt: typeof PRIOR_DEPTH_ATTEMPT;
  receiptSha256: string | null;
  completeSha256: string | null;
  phase: typeof DEPTH_PHASES[number];
  terminal: boolean;
  statusDetail: string;
  candidate: 'D4' | 'D6' | 'D8' | null;
  trainingCallsReserved: number | null;
  verifiedCandidateCount: number;
  currentModelRoundsCompleted: number | null;
  freshRoundsCompleted: number | null;
  devRowsProcessed: number | null;
  trainRows: 38651044;
  devRows: 20989927;
  baselineRounds: 256;
  models: DepthModel[];
  bestObservedDevModel: DepthModelId | null;
  workerElapsedSeconds: number | null;
  servedAt: string;
  sourceReportedAt: string | null;
  legacyRunAccepted: false;
  modelAdoption: false;
  generalizationClaim: false;
  DEVReused: true;
  productComparison: 'NOT_CONNECTED';
  pureDepthContrast: 'FRESH_D4_D6_D8_ONLY';
  continuedBaselineIsNotFreshControl: true;
}
