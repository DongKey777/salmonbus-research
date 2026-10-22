export const AUTOLOOP_SCHEMA = 'autoloop-report/1' as const;
export const AUTOLOOP_LIMITS = { maxRuns: 500, maxCandidates: 12, responseBytes: 2097152, futureSkewMs: 600000 } as const;
export interface LoopCandidate {
  candidate: string; kind: 'XGB' | 'LINEAR'; head: 'SEAT' | 'FULL'; features: string; blocks: 'NONE' | 'ROUTE_HORIZON'; objective: string | null;
  depth: number | null; eta: number | null; rounds: number | null; note: string;
  MAE: number | null; RMSE: number | null; deltaMAE: number | null; deltaMAECI95: [number, number] | null; guardsWorsened: string[]; gatePassed: boolean | null; Brier: number | null;
}
export interface LoopRun {
  runId: string; experimentId: string; status: 'COMPLETED' | 'INFRASTRUCTURE_FAILURE'; hypothesis: string; rationale: string;
  estimatedUSD: number; actualUSD: number; championBefore: string; championAfter: string; championBeforeMAE: number | null; productMAE: number | null; failure: string | null; candidates: LoopCandidate[];
}
export interface HMetrics { MAE: number; RMSE: number; routeMacroMAE: number; unseenRouteMAE: number | null; over10Share: number; fullBusUnder2Share: number | null }
export interface HFinal {
  status: 'COMPLETED' | 'RUNNING' | 'REPRODUCTION_FAILED_SEALED' | 'FAILED_AFTER_OPENING'; champion: string; reason: string; days: string[]; rows: number | null; blocks: number | null;
  reproductionMaxAbsDiff: number | null; championMetrics: HMetrics | null; referenceMetrics: HMetrics | null; productMetrics: HMetrics | null;
  championVsReferenceCI95: [number, number] | null; championVsProductCI95: [number, number] | null; referenceVsProductCI95: [number, number] | null;
}
export interface AutoloopReport {
  schema: typeof AUTOLOOP_SCHEMA; origin: 'REAL_OBSERVATION_PIPELINE'; evaluationSplit: 'DEV_S'; HOpened: boolean; hFinal: HFinal | null;
  policy: { budget: { perRunUSD: number; perDayUSD: number; totalUSD: number; overrun: string }; stop: { noImprovementRounds: number; consecutiveInfrastructureFailures: number }; gate: string; guards: string[] };
  state: { running: boolean; stopReason: string | null; lastEvent: string | null; lastEventAt: string | null; nextRun: number; consecutiveNoImprovement: number; consecutiveInfraFailures: number; spentTotalUSD: number; spentTodayUSD: number };
  champion: { modelId: string; runId: string; candidate: string; devSMAE: number | null; spec: Record<string, string | number | null> };
  championHistory: { runId: string; from: string; to: string; devSMAE: number; previousDevSMAE: number }[];
  runs: LoopRun[]; servedAt: string; DEVReused: true; modelAdoption: false;
}
