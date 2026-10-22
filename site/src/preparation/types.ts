/** Presentation model. Wire changes are isolated in project.ts. */
export type JobStatus='WAITING'|'RUNNING'|'STOPPED'|'VERIFIED'|'UNVERIFIED';
export type CountScope='NONE'|'INTERMEDIATE'|'VERIFIED';
export interface ResourceSample {
 receivedAt:string|null;
 elapsedSeconds:number|null;
 freeGiB:number|null;
 currentRssMiB:number|null;
 peakRssMiB:number|null;
 reportedRssMiB:number|null;
 algorithmVisits:number|null;
 pressure:number|null;
}
export interface Milestone {
 id:string;
 label:string;
 elapsedSeconds:number|null;
 reportReceivedAt:string|null;
 state:'REPORTED'|'COMPLETED'|'STOPPED';
}
export interface ReferenceCounts {
 nonNull:number|null;
 nullRows:number|null;
 groups:number|null;
 matched:number|null;
 aboveHighwater:number|null;
}
export interface PreparationJob {
 id:string;
 title:string;
 status:JobStatus;
 phaseLabel:string;
 lastReportReceivedAt:string|null;
 elapsedSeconds:number|null;
 failureCode:string|null;
 limits:{wallSeconds:number|null;rssMiB:number|null;newGiB:number|null;minimumFreeGiB:number|null;processes:number|null};
 inputs:{evaluationRows:number|null;observationRows:number|null};
 samples:ResourceSample[];
 milestones:Milestone[];
 countScope:CountScope;
 counts:ReferenceCounts|null;
 verifiedClaims:string[];
 caveats:string[];
}
export interface PreparationView {
 sourceUpdatedAt:string|null;
 servedAt:string;
 jobs:PreparationJob[];
}
