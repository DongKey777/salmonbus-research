export interface FullModelValidation {
  schema: 'full-model-validation/1';
  status: 'SAVED_CHECKPOINT_VALIDATED';
  observedAt: string;
  sourceKind: 'REAL_OBSERVATION_EXECUTION';
  model: { kind: 'XGBOOST_SEAT_REGRESSION'; rounds: number; trainedBackend: 'GPU'; scoringBackend: 'SAVED_CPU'; originalModelSha256: string; validatedSavedCheckpoints: number };
  dataset: { trainRows: number; devRows: number; arrivalGroups: number; weightSum: number; weighting: 'ARRIVAL_GROUP_EQUAL_1_OVER_M'; HIncluded: false; developmentEvaluation: true };
  metrics: { MAE: number; RMSE: number; MSE: number; Brier: null; NRPS: null };
  units: { MAE: '석'; RMSE: '석'; MSE: '석²' };
  validation: { wholeDevScored: true; cpuSaveReloadExactRows: number; cpuSaveReloadMismatches: 0; originalCrossBackendToleranceViolations: number; violatingRowsNumericallyExplained: number; allRowsRoutingReplayVerified: false; additionalTrainingRuns: 0; wallSeconds: number };
  boundaries: { originalTrainingRunStatus: 'FAILED_PRESERVED'; originalTrainingRunAccepted: false; fullHeadStarted: false; originalTrainingHeapCompared: false; productComparison: 'NOT_CONNECTED'; improvementClaim: false; modelAdopted: false; generalizationClaim: false };
  provenance: { datasetSha256: string; modelSha256: string; scoreSha256: string; completionSha256: string; consumerSha256: string };
  compute: { status: 'RELEASE_PENDING'; networkResultsPreserved: true } | { status: 'RELEASED'; networkResultsPreserved: true; storageRetained: true; releaseVerifiedAt: string };
}
