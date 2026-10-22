/** Presentation model only. Wire contract is validated before this shape is built. */
export const METRICS=['Brier','NRPS','MAE','ECE'] as const;
export type Metric=typeof METRICS[number];
export type Values=Record<Metric,number|null>;
export type CyclePoint={
 index:number; cycleId:string; candidateId:string; groupRef:string;
 reportHash:string; metrics:Values; baselineMetrics:Values|null;
 rows:number|null; events:number|null; weightSum:number|null;
 main:string|null; auxiliary:string|null; registeredAt:string|null;
 wallSeconds:number|null; cpuSeconds:number|null; peakRssBytes:number|null;
};
export type CycleChartGroup={ref:string; baseline:CyclePoint|null; points:CyclePoint[]};
