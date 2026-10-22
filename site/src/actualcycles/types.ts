export const METRICS = ['Brier', 'MAE', 'MSE', 'NRPS', 'ECE'] as const;
export type Metric = typeof METRICS[number];
export type SourceKind = 'REAL_OBSERVATION_EXECUTION' | 'ARTIFICIAL_TRANSPORT_FIXTURE';
export type Status = 'IN_PROGRESS' | 'COMPLETED' | 'HELD' | 'FAILED';
export const EVENT_KINDS = ['RUN_STARTED', 'REFERENCE_REGISTERED', 'MODEL_RESERVED', 'MODEL_STARTED', 'MODEL_VERIFIED', 'SCORE_REGISTERED', 'MAIN_DECISION_COMMITTED', 'AUX_DECISION_COMMITTED', 'PROPOSAL_SEALED', 'PROPOSAL_CONSUMED', 'CYCLE_COMPLETED', 'RUN_COMPLETED', 'RUN_HELD', 'RUN_FAILED'] as const;
export type EventKind = typeof EVENT_KINDS[number];
export interface ComparisonGroup {
  groupRef: string; datasetRef: string; splitRef: string; weightRef: string; scorerRef: string; mainPolicyRef: string; auxPolicyRef: string;
}
export interface Prefix { producerSeq: number; eventHash: string }
export interface Resources {
  currentRssMiB: null; reportedPeakRssMiB: number | null; reportedCpuSeconds: number | null; reportedWallSeconds: number | null;
  measurementKind: 'ARTIFICIAL_FIXTURE_VALUE' | 'PRODUCER_REPORTED_MEASUREMENT';
}
export interface Report {
  evaluationId: string; reportRef: string; scorerReceiptRef: string; scoreArtifactRef: string; completionRef: string;
  groupRef: string; validity: 'VALID' | 'INVALID'; numericSupport: 'DEFINED' | 'UNDEFINED' | 'INVALID';
  metrics: Record<Metric, number | null>; metricMethods: Record<Metric, string | null>;
  support: { rows: number | null; groups: number | null; fullGroups: number | null; nonFullGroups: number | null; weightSum: number | null };
  registeredSeq: number; registrationHash: string; registeredAt: string;
}
export interface CandidateReport extends Report { jobId: string; modelId: string; modelReceiptRef: string }
export interface Reference {
  cycleIndex: 0; cycleId: string; candidateId: string; kind: 'HISTORICAL_PRODUCT_REFERENCE'; isExternalReference: true;
  verification: 'VERIFIED_SCALAR_SCORE'; referenceRef: string; report: Report;
}
export interface Model {
  jobId: string; modelId: string; recipeRef: string; taskTemplateRef: string; workerCodeHash: string; reservationRef: string;
  state: 'RESERVED' | 'STARTED' | 'VERIFIED';
  taskRef: string | null; modelReceiptRef: string | null; modelArtifactRef: string | null; completionRef: string | null;
  trainingRows: number | null; predictionRows: number | null; resources: Resources | null;
}
export interface Decision {
  purpose: 'MAIN' | 'AUX'; validity: 'VALID' | 'INVALID'; outcome: 'MET' | 'NOT_MET' | 'INCONCLUSIVE' | 'INVALID';
  revisionRef: string; decisionRef: string; referenceCandidateId: string; referenceReportRef: string; candidateReportRef: string;
  groupRef: string; policyRef: string; primaryMetric: 'Brier' | 'MAE_MSE'; adoption: false; comparisonStatus: 'SAME_GROUP';
}
export interface Proposal {
  proposalRef: string; inputRef: string; outputRef: string; sourcePrefix: Prefix; mainRevisionRef: string; auxRevisionRef: string;
  nextAction: 'CONTINUE' | 'STOP'; selectedCandidateId: string | null; selectedRecipeRef: string | null; selectedTaskTemplateRef: string | null;
  stopReason: 'FIVE_CYCLES_COMPLETE' | null; state: 'SEALED' | 'CONSUMED'; consumptionRef: string | null; nextReservationRef: string | null;
}
export interface Cycle {
  cycleIndex: number; cycleId: string; candidateId: string; kind: 'FRESH_MODEL_FIT'; phase: EventKind; status: Status;
  model: Model; report: CandidateReport | null; mainDecision: Decision | null; auxDecision: Decision | null; proposal: Proposal | null;
  resources: Resources | null; lastOccurredAt: string; lastObservedAt: string; lastReceivedAt: string;
}
export interface PublicEvent {
  eventId: string; eventHash: string; producerSeq: number; cycleIndex: number; kind: EventKind;
  occurredAt: string; observedAt: string; receivedAt: string;
}
export interface Run {
  sourceKind: SourceKind; sourceGenerationId: string; runId: string; attemptId: string; executionId: string; contextRef: string; producerCodeHash: string;
  proposerKind: 'LOCAL_RULE_PROPOSER' | 'CACHED_JEV'; targetCycles: 5; baselineCandidateId: string; baselineKind: 'HISTORICAL_PRODUCT_REFERENCE';
  comparisonGroup: ComparisonGroup; initialPlan: { candidateId: string; recipeRef: string; taskTemplateRef: string };
  budget: { modelJobs: 5; proposals: 5; providerCalls: 0; javaCalls: 0 };
  mode: 'DECLARED_EVENT_TIME_REPLAY'; historicalCommitAvailabilityVerified: false; HSealed: false; adoption: false; generalizationClaim: false;
  baseline: Reference | null; cycles: Cycle[]; head: Prefix; phase: EventKind; status: Status; terminalReason: string | null;
  counts: { registeredReferences: number; modelReservations: number; modelVerifications: number; registeredCandidateScores: number; completedCycles: number; mainDecisions: number; auxDecisions: number; proposals: number; proposalConsumptions: number };
  budgetObserved: { modelJobs: number; newModelsExecutedByMonitor: 0; providerCalls: 0; javaCalls: 0 };
  quality: { inputKind: SourceKind; actualExecutionClaim: boolean; verification: 'SANITIZED_JOURNAL_PINS_PRODUCER_ARTIFACT_ATTESTATION'; independentArtifactVerification: false; generalizationClaim: false; adoption: false };
  events: PublicEvent[];
}
export interface Snapshot {
  schemaVersion: 'real-cycle-monitor-v1'; generationId: string; cursor: number; servedAt: string; lastReceivedAt: string | null; runs: Run[];
}
export interface Invalidation {
  schemaVersion: 'real-cycle-event-v1'; serverSeq: number; eventId: string; runId: string; attemptId: string; sourceGenerationId: string;
  producerSeq: number; cycleIndex: number; kind: EventKind; occurredAt: string; observedAt: string; receivedAt: string;
}
export interface ChartGroup {
  group: ComparisonGroup; reference: Reference | null; slots: (Cycle | null)[];
}
