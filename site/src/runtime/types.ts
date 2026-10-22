/** UI-only model. The wire adapter supplies all labels and evidence states. */
export interface RuntimePoint {
 seq:number; elapsedSeconds:number; occurredAt:string; committedAt:string;
 stage:string; stageLabel:string; eventLabel:string;
 currentRssMiB:number|null; peakRssMiB:number|null;
 done:number|null; total:number|null; unitLabel:string|null;
}
export interface RuntimeAttempt {
 key:string; runId:string; attemptId:string; title:string;
 stateLabel:string; tone:'neutral'|'running'|'stopped'|'verified'; terminal:boolean;
 stageLabel:string; proofLabel:string; proofVerified:boolean;
 lastWorkerSignalAt:string|null; staleAfterSeconds:number; observationState:'FRESH'|'STALE'|'UNKNOWN'; ageAtResponse:number|null; failureLabel:string|null;
 elapsedSeconds:number|null; paced:boolean; pacingMs:number;
 events:RuntimePoint[];
}
export interface RuntimeView {servedAt:string; updatedAt:string|null; attempts:RuntimeAttempt[];}
