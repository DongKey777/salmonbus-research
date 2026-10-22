export const ROUTE_REPORT_SCHEMA = 'route-report/1' as const;
export const ROUTE_REPORT_STATUS = 'ROUTE_REPORT_DEV_REUSED_NOT_ADOPTED' as const;
export const ROUTE_DATASET = { manifestSha256: 'a2e42ab6ab45c1f33c8963b13456fe957a500f1752c9d027f4125a0cb0cc7a62', trainRows: 38651044, devRows: 20989927, trainGroups: 631972, devGroups: 351831 } as const;
export const ROUTE_LIMITS = { maxRoutes: 96, maxModels: 8, responseBytes: 262144, futureSkewMs: 600000, closureTolerance: 1e-9, weightTolerance: 1e-6 } as const;
export type ModelRole = 'REFERENCE' | 'CANDIDATE';
export interface RoutePopulation {
  token: string;
  devRows: number;
  devGroups: number;
  weightSum: number;
  trainSupport: { rows: number; groups: number } | null;
}
export interface UnknownPopulation { devRows: number; devGroups: number; weightSum: number }
export interface PairedScore { MAE: number; MSE: number; pairedMAEDelta: number | null; pairedMSEDelta: number | null }
export interface NullablePairedScore { MAE: number | null; MSE: number | null; pairedMAEDelta: number | null; pairedMSEDelta: number | null }
export interface RouteModelScore extends PairedScore { token: string }
export interface RouteModel {
  id: string;
  role: ModelRole;
  trainingMode: 'CONTINUED_REFERENCE' | 'FRESH_FROM_ZERO';
  depth: number | null;
  rounds: number;
  publishedGlobal: { source: string; MAE: number; MSE: number } | null;
  micro: PairedScore;
  knownRouteMacro: { MAE: number; MSE: number; routeCount: number };
  unknown: NullablePairedScore;
  routes: RouteModelScore[];
}
export interface RouteReport {
  schema: typeof ROUTE_REPORT_SCHEMA;
  origin: 'REAL_OBSERVATION_PIPELINE';
  runId: string;
  evaluationRole: 'DEV';
  producerStatus: typeof ROUTE_REPORT_STATUS;
  receiptSha256: string;
  dataset: typeof ROUTE_DATASET;
  routeMap: { sha256: string; routeDefinition: 'R.route_id'; tokenKind: 'OPAQUE_ROUTE_TOKEN'; knownRouteCount: number; unknownGroupCount: number };
  routes: RoutePopulation[];
  unknown: UnknownPopulation;
  models: RouteModel[];
  DEVReused: true;
  HRead: false;
  modelAdoption: false;
  generalizationClaim: false;
  replacesGlobalGate: false;
  servedAt: string;
  sourceReportedAt: string | null;
}
