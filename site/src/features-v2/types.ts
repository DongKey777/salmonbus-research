export const FEATURES_V2_SCHEMA = 'features-v2-report/1' as const;
export const FEATURES_V2_STATUSES = ['FEATURES_V2_TRAINED_AND_DEV_SCORED_NOT_ADOPTED', 'TEST_ONLY_NOT_ACCEPTED'] as const;
export const FEATURES_V2_LIMITS = { maxRoutes: 96, maxSeatModels: 8, maxFullModels: 8, responseBytes: 524288, futureSkewMs: 600000, closureTolerance: 1e-6, weightTolerance: 1e-6 } as const;
export type SeatRole = 'REFERENCE' | 'PRODUCT' | 'CANDIDATE';
export interface Delta { MAE: number; standardError: number | null }
export interface SeatModel {
  id: string; label: string; role: SeatRole; featureSet: string; depth: number | null; rounds: number | null;
  MAE: number; RMSE: number; routeMacroMAE: number; bias: number; MAEClip0To70: number;
  deltaVsReference: Delta | null; deltaVsProduct: Delta | null;
}
export interface CurvePoint { rounds: number; MAE: number; RMSE: number }
export interface Ablation { id: string; label: string; withModel: string; withoutModel: string; rounds: number; withMAE: number; withoutMAE: number; MAEDelta: number; standardError: number | null }
export interface FullModel { id: string; label: string; role: 'PRODUCT' | 'CANDIDATE' | 'BASELINE'; Brier: number; logLoss: number | null; meanProbability: number }
export interface RouteRow { token: string; devRows: number; weight: number; trainRows: number; MAE: Record<string, number> }
export interface SegmentRow { key: number; label: string; devRows: number; weight: number; MAE: Record<string, number> }
export interface Segment { id: string; label: string; rows: SegmentRow[] }
export interface FeatureGroup { id: 'BASE' | 'PRODUCTION' | 'EXTRA' | 'STOP_DEMAND'; label: string; names: string[] }
export interface FeaturesV2Report {
  schema: typeof FEATURES_V2_SCHEMA; origin: 'REAL_OBSERVATION_PIPELINE'; runId: string; evaluationRole: 'DEV';
  producerStatus: typeof FEATURES_V2_STATUSES[number];
  receiptSha256: string; workerReceiptSha256: string; metricsSha256: string; packageSha256: string;
  dataset: { manifestSha256: string; featureManifestSha256: string; stopDemandManifestSha256: string; trainRows: number; devRows: number; devWeightSum: number };
  featureGroups: FeatureGroup[]; seatModels: SeatModel[]; curve: { id: string; points: CurvePoint[] }[]; ablations: Ablation[];
  fullModels: FullModel[]; observedFullShare: number; routes: RouteRow[]; segments: Segment[];
  DEVReused: true; HRead: false; modelAdoption: false; generalizationClaim: false; servedAt: string; sourceReportedAt: string | null;
}
