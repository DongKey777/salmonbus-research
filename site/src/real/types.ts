export const IDENTITY_KEYS = [
  'manifestSha256', 'modelReceiptSha256', 'modelHash', 'inputHash', 'inputContractHash',
  'splitProofHash', 'recipeHash', 'scoringContractHash', 'sourceDatasetSha256',
] as const;
export type IdentityKey = typeof IDENTITY_KEYS[number];
export const METRIC_KEYS = [
  'modelBrier', 'modelMAE', 'modelMSE', 'modelNRPS',
  'productRawBrier', 'productFinalBrier', 'productMAE', 'productMSE', 'productNRPS',
] as const;
export interface RealPilotSummary {
  schema: 'real-pilot-public-summary/1';
  status: 'SCORED_NOT_ADOPTED';
  origin: 'LOCAL_CAPTURED_REAL_OBSERVATIONS';
  mode: 'DECLARED_EVENT_TIME_REPLAY';
  recordedAt: string;
  candidateId: 'REAL_GLOBAL_DIRICHLET_V1';
  counts: { trainRows: 8; evalRows: 8 };
  identity: Record<IdentityKey, string>;
  metrics: {
    modelBrier: number; modelMAE: number; modelMSE: number; modelNRPS: number;
    productRawBrier: number; productFinalBrier: number; productMAE: number; productMSE: number;
    productNRPS: null;
  };
  HSealed: false;
  generalizationClaim: false;
  adoption: false;
  historicalCommitAvailabilityVerified: false;
  sourceFeaturesConditioned: false;
}
export type PilotRead = { state: 'pending' } | { state: 'scored'; summary: RealPilotSummary; publicSummarySha256: string };
export interface RealPilotSupport {
  schema: 'real-pilot-support/1';
  origin: 'LOCAL_CAPTURED_REAL_OBSERVATIONS';
  publicSummarySha256: string;
  modelReceiptSha256: string;
  inputHash: string;
  evalRows: 8;
  fullEvents: number;
  nonFullEvents: number;
  policy: 'SEAT_ZERO_IS_FULL';
  truthBytesSha256: string;
  rawRowsPublished: false;
}
export interface SupportAnchor {
  publicSummarySha256: string;
  modelReceiptSha256: string;
  inputHash: string;
  evalRows: 8;
}
export type SupportRead = { state: 'unavailable' } | { state: 'verified'; support: RealPilotSupport };
export type ComparedMetric = 'Brier' | 'MAE' | 'MSE';
export interface ComparisonPoint { label: string; value: number; color: string }
