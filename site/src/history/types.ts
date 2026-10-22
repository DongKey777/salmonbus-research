export const METRICS = ['Brier', 'NRPS', 'MAE', 'ECE'] as const;
export type Metric = typeof METRICS[number];
export type SourceKind = 'ARTIFICIAL_SCALE_FIXTURE';
export type SnapshotCursor = number;
export type MetricState = 'VALID' | 'NULL' | 'INVALID' | 'UNREGISTERED';
export type TrialStatus = 'FINISHED' | 'FAILED' | 'HELD' | 'RUNNING';
export type DisplayMode = 'RAW' | 'MIN_MAX';

export interface Envelope<T> {
  schemaVersion: 'history-monitor-v1';
  sourceKind: SourceKind;
  historyGenerationId: string;
  snapshotCursor: SnapshotCursor;
  servedAt: string;
  data: T;
}
export interface Trial {
  trialId: string;
  trialOrdinal: number;
  runId: string;
  attemptId: string;
  cycleIndex: number;
  role: 'BASELINE' | 'CANDIDATE' | 'REEVALUATION';
  modelId: string;
  modelRevisionRef: string;
  modelDefinitionId: string;
  evaluationId: string;
  reportId: string | null;
  reportRef: string | null;
  groupRef: string;
  status: TrialStatus;
  registrationState: 'REGISTERED_VERIFIED' | 'NOT_REGISTERED' | 'INVALID';
  numericValidity: 'DEFINED' | 'NULL' | 'INVALID' | 'UNREGISTERED';
  metrics: Record<Metric, number | null>;
  support: { rows: number | null };
  sourceKind: SourceKind;
}
export interface CatalogScope {
  runId: string | null;
  attemptId: string | null;
  groupRef: string | null;
  status: TrialStatus | null;
  direction: 'ASC' | 'DESC';
}
export interface Catalog {
  rows: Trial[];
  page: { limit: number; nextCursor: string | null; hasMore: boolean };
  scope: CatalogScope;
}
export interface ComparisonGroup {
  groupRef: string;
  cohortRef: string;
  scorerRef: string;
  policyRef: string;
  metricMethods: Record<Metric, string>;
  objective: 'MINIMIZE';
}
export interface Groups {
  groups: ComparisonGroup[];
  trialExtent: { fromOrdinal: number | null; toOrdinal: number | null };
}
export interface MetricPoint {
  trialId: string;
  trialOrdinal: number;
  runId: string;
  attemptId: string;
  cycleIndex: number;
  modelId: string;
  evaluationId: string;
  reportId: string | null;
  reportRef: string | null;
  status: TrialStatus;
  metricState: MetricState;
  value: number | null;
}
export interface Counts {
  totalTrials: number;
  validCount: number;
  nullCount: number;
  invalidCount: number;
  unregisteredCount: number;
  failedCount: number;
  heldCount: number;
  runningCount: number;
}
export interface RangeBucket {
  fromOrdinal: number;
  toOrdinal: number;
  first: MetricPoint | null;
  last: MetricPoint | null;
  min: MetricPoint | null;
  max: MetricPoint | null;
  continuity: 'ALL_VALID' | 'HAS_GAPS' | 'NO_VALID';
  counts: Counts;
}
export interface HistoryRange {
  groupRef: string;
  metric: Metric;
  method: string;
  objective: 'MINIMIZE';
  mode: DisplayMode;
  fromOrdinal: number;
  toOrdinal: number;
  points: MetricPoint[];
  buckets: RangeBucket[];
  counts: Counts;
  observedBestSoFar: { carryIn: MetricPoint | null; end: MetricPoint | null };
  adoptedModel: null;
  displayOnly: true;
}
export interface ModelIdentity {
  modelId: string;
  modelDefinitionId: string;
  modelRevisionRef: string;
  codeRef: string;
  recipeRef: string;
  dataRef: string;
  weightsRef: string;
  manifestRef: string;
  sourceKind: SourceKind;
  verificationKind: 'ARTIFICIAL_METADATA_ONLY';
}
export interface ModelDetail {
  model: ModelIdentity;
  requestedModelRevisionRef: string;
}
export interface OrdinalWindow { fromOrdinal: number; toOrdinal: number }
export interface RangeRequest extends OrdinalWindow {
  groupRef: string;
  metric: Metric;
  mode: DisplayMode;
  buckets: number;
  snapshotCursor: SnapshotCursor;
  historyGenerationId: string;
}
export interface CatalogRequest {
  groupRef: string;
  status: TrialStatus | '';
  cursor: string | null;
  limit: number;
}
