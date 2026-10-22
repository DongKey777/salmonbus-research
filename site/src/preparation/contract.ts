/** The API boundary. Reject unexpected data before it reaches charts or labels. */
export const PHASES=['UNKNOWN','APPROVED','FRESH_GUARD_PASSED','SOURCE_PARTITION','SORTING','HEADERS','EXACT_E_VALIDATION','PACKING','E_SEQUENTIAL_MERGE','FINAL_CHECKS','STOPPED','AUDIT_CLAIMS_REPORTED_VERIFIED'] as const;
export const STATUSES=['UNKNOWN','PROPOSED','APPROVED','RUNNING','STOPPED_NOT_ACCEPTED','AUDIT_STOPPED','COMPLETED_UNVERIFIED','AUDIT_CLAIMS_REPORTED_VERIFIED'] as const;
export const FAILURE_CODES=['C1B_FULL_IMMUTABLE_BASE_CHANGED','C1B_GUARD_TIME_CAP','C1B_GUARD_RSS_CAP','C1B_GUARD_FREE_FLOOR','C1B_GUARD_MEMORY_CRITICAL','AUDIT_SOURCE_PIN_OR_EOF','AUDIT_ORIGINAL_INPUT_FILE_PIN','AUDIT_OLD_FILE_STAT_PIN','AUDIT_FINAL_LEAF_CHANGED','AUDIT_READ_GLOBAL_PRECHARGE_CAP','AUDIT_READ_ROLE_PRECHARGE_CAP','OTHER_REPORTED_FAILURE'] as const;
export type WirePhase=typeof PHASES[number];
type WireCounts={nonNullMembers:number|null;nullRows:number|null;groups:number|null;weightedOMatched:number|null;weightedOAboveHighwater:number|null};
export interface WireSample {
 receivedAt:string|null;sourceReportedAt:string|null;elapsedSeconds:number|null;
 elapsedBasis:'APPROXIMATE_REPORTED'|'WALL_REPORTED'|'MONOTONIC_REPORTED'|null;
 freeGiB:number|null;pressure:number|null;currentRssMiB:number|null;peakRssMiB:number|null;
 unspecifiedReportedRssMiB:number|null;algorithmVisits:number|null;
}
export interface WireAttempt {
 id:'C1B_ORIGINAL'|'C1B_INDEPENDENT_AUDIT';title:string;status:typeof STATUSES[number];phase:WirePhase;
 lastReportReceivedAt:string|null;sourceReportedTimes:{startedAt:string|null;stoppedAt:string|null;completedAt:string|null};
 limits:{maxAttempts:number|null;processes:number|null;wallSeconds:number|null;rssMiB:number|null;newOutputBytes:number|null;startFreeGiB:number|null;minimumFreeGiB:number|null;algorithmVisits:number|null;allReadBytes:number|null};
 inputs:{evaluationRows:number|null;observationKeyRows:number|null};acceptedCounts:WireCounts|null;intermediateCounts:WireCounts|null;
 failureCode:typeof FAILURE_CODES[number]|null;proofStatus:'REPORTED_VERIFIED'|null;
 milestones:{phase:WirePhase;receivedAt:string|null;sourceReportedAt:string|null}[];samples:WireSample[];
}
export interface PreparationSnapshot {
 schemaVersion:'preparation-monitor-v3';sourceKind:'OWNER_REPORTS';servedAt:string;sourceUpdatedAt:string|null;
 attempts:WireAttempt[];
 readiness:{originalCompletionAccepted:false;legacyConsumerEligible:false;C2Ready:false;HSealed:false;trainingReady:false;modelResultCount:0};
}
function need(condition:unknown):asserts condition{if(!condition)throw Error('PREPARATION_CONTRACT_MISMATCH');}
function obj(value:unknown,keys:string[]){need(typeof value==='object'&&value!==null&&!Array.isArray(value));const v=value as Record<string,unknown>;need(Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)));return v;}
function time(value:unknown,nullable=true){if(nullable&&value===null)return;need(typeof value==='string'&&value.length<=64&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value)));}
function number(value:unknown,integer=false){if(value===null)return;need(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER&&(!integer||Number.isSafeInteger(value)));}
function oneOf(value:unknown,values:readonly string[],nullable=false){need(nullable&&value===null||typeof value==='string'&&values.includes(value));}
function list(value:unknown,max:number){need(Array.isArray(value)&&value.length<=max);return value;}
const countKeys=['nonNullMembers','nullRows','groups','weightedOMatched','weightedOAboveHighwater'];
function counts(value:unknown){if(value===null)return;const v=obj(value,countKeys);Object.values(v).forEach(n=>number(n,true));}

export function verifyPreparation(value:unknown):PreparationSnapshot{
 const root=obj(value,['schemaVersion','sourceKind','servedAt','sourceUpdatedAt','attempts','readiness']);
 need(root.schemaVersion==='preparation-monitor-v3'&&root.sourceKind==='OWNER_REPORTS');time(root.servedAt,false);time(root.sourceUpdatedAt);
 const readiness=obj(root.readiness,['originalCompletionAccepted','legacyConsumerEligible','C2Ready','HSealed','trainingReady','modelResultCount']);
 need(readiness.modelResultCount===0&&Object.entries(readiness).every(([k,v])=>k==='modelResultCount'||v===false));
 const attempts=list(root.attempts,2);need(attempts.length===2);const ids=new Set<string>();
 for(const entry of attempts){
  const a=obj(entry,['id','title','status','phase','lastReportReceivedAt','sourceReportedTimes','limits','inputs','acceptedCounts','intermediateCounts','failureCode','proofStatus','milestones','samples']);
  oneOf(a.id,['C1B_ORIGINAL','C1B_INDEPENDENT_AUDIT']);need(!ids.has(a.id as string));ids.add(a.id as string);
  need(a.title===(a.id==='C1B_ORIGINAL'?'C1b 원 실행 — 미완료 보존':'독립 재감사 — 담당 보고'));
  oneOf(a.status,STATUSES);oneOf(a.phase,PHASES);time(a.lastReportReceivedAt);
  Object.values(obj(a.sourceReportedTimes,['startedAt','stoppedAt','completedAt'])).forEach(v=>time(v));
  const limits=obj(a.limits,['maxAttempts','processes','wallSeconds','rssMiB','newOutputBytes','startFreeGiB','minimumFreeGiB','algorithmVisits','allReadBytes']);
  Object.entries(limits).forEach(([k,v])=>number(v,['maxAttempts','processes','newOutputBytes','algorithmVisits','allReadBytes'].includes(k)));
  Object.values(obj(a.inputs,['evaluationRows','observationKeyRows'])).forEach(v=>number(v,true));counts(a.acceptedCounts);counts(a.intermediateCounts);
  oneOf(a.failureCode,FAILURE_CODES,true);oneOf(a.proofStatus,['REPORTED_VERIFIED'],true);
  if(a.acceptedCounts!==null||a.proofStatus!==null)need(a.id==='C1B_INDEPENDENT_AUDIT'&&a.status==='AUDIT_CLAIMS_REPORTED_VERIFIED'&&a.proofStatus==='REPORTED_VERIFIED');
  if(a.status==='AUDIT_CLAIMS_REPORTED_VERIFIED')need(a.id==='C1B_INDEPENDENT_AUDIT'&&a.proofStatus==='REPORTED_VERIFIED');
  for(const value of list(a.milestones,64)){const m=obj(value,['phase','receivedAt','sourceReportedAt']);oneOf(m.phase,PHASES);time(m.receivedAt);time(m.sourceReportedAt);}
  for(const value of list(a.samples,128)){
   const s=obj(value,['receivedAt','sourceReportedAt','elapsedSeconds','elapsedBasis','freeGiB','pressure','currentRssMiB','peakRssMiB','unspecifiedReportedRssMiB','algorithmVisits']);
   time(s.receivedAt);time(s.sourceReportedAt);oneOf(s.elapsedBasis,['APPROXIMATE_REPORTED','WALL_REPORTED','MONOTONIC_REPORTED'],true);
   for(const k of ['elapsedSeconds','freeGiB','currentRssMiB','peakRssMiB','unspecifiedReportedRssMiB'])number(s[k]);
   number(s.pressure,true);need(s.pressure===null||(s.pressure as number)<=4);number(s.algorithmVisits,true);
  }
 }
 return value as PreparationSnapshot;
}
