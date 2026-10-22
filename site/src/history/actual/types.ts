import type { CatalogRequest, OrdinalWindow } from '../types.ts';
import type { CatalogResponse, GroupsResponse, ModelResponse, RangeResponse, ReferenceResponse, TrialResponse } from './wire-types.ts';

export type { CatalogResponse, GroupsResponse, ModelResponse, RangeResponse, ReferenceResponse, TrialResponse, InvalidationResponse } from './wire-types.ts';
export const ACTUAL_METRICS = ['Brier', 'MAE', 'MSE', 'NRPS', 'ECE'] as const;
export type ActualMetric = typeof ACTUAL_METRICS[number];
export type ActualTrial = CatalogResponse['data']['rows'][number];
export type ActualGroup = GroupsResponse['data']['groups'][number];
export type ActualRange = RangeResponse['data'];
export type ActualModel = ModelResponse['data']['model'];
export type ActualReference = ReferenceResponse['data']['reference'];
export type ActualEvaluation = TrialResponse['data']['evaluation'];
export type Provenance = GroupsResponse['provenance'];
export type Anchor = Pick<GroupsResponse, 'historyGenerationId' | 'snapshotCursor'>;
export type ActualCatalogRequest = CatalogRequest & Anchor;
export interface ActualRangeRequest extends OrdinalWindow, Anchor {
  groupRef: string; metric: ActualMetric; mode: 'RAW' | 'MIN_MAX'; buckets: number;
}
export const METHODS = {
  Brier: 'FULL_EVENT_BRIER_ARRIVAL_GROUP_UNIFORM_V1',
  MAE: 'MEAN_SEAT_MAE_ARRIVAL_GROUP_UNIFORM_V1',
  MSE: 'MEAN_SEAT_MSE_ARRIVAL_GROUP_UNIFORM_V1',
  NRPS: 'ORDERED_SEAT_CDF_70_CUTOFFS_GROUP_UNIFORM_V1',
  ECE: null,
} as const;
