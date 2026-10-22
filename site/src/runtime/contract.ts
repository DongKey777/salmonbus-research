/** Closed wire boundary. No producer imports, receipt execution or private data. */
export type Status='RUNNING'|'STOPPED'|'EXECUTION_FINISHED';
export type Stage='INITIALIZING'|'TRANSFORMING'|'FINALIZING'|'TERMINAL';
export type Kind='STARTED'|'PROGRESS'|'HEARTBEAT'|'STOPPED'|'EXECUTION_FINISHED';
type Progress={completedUnits:number;totalUnits:number;unit:'INTEGER_RECORDS'};
type Resources={currentRssMiB:number|null;peakRssMiB:number|null};
type Pacing={pacedForObservation:boolean;pacingMs:number};
export interface RuntimeEvent{eventId:string;previousEventId:string|null;runId:string;attemptId:string;producerSeq:number;occurredAt:string;receivedAt:string;monotonicElapsedSeconds:number;eventKind:Kind;stage:Stage;status:Status;progress:Progress;resources:Resources;pacing:Pacing;claimHash:string|null;}
export interface WireAttempt{attemptId:string;previousAttemptId:string|null;status:Status;stage:Stage;lastProducerSeq:number;lastEventAt:string;lastReceivedAt:string;lastWorkerHeartbeatAt:string|null;lastHeartbeatReceivedAt:string|null;monotonicElapsedSeconds:number;progress:Progress;resources:Resources;pacing:Pacing;observation:{state:'FRESH'|'STALE'|'UNKNOWN';ageSeconds:number|null;staleAfterSeconds:5;basis:'LAST_WORKER_RECEIPT'};completionEvidence:{state:'NOT_REPORTED'|'VERIFIED'|'REJECTED';evidenceId:string|null;checkedAt:string|null;claimHash:string|null;reason:'INCOMPLETE'|'NO_FINISH_CLAIM'|'CHECKSUM_MISMATCH'|'MISSING_OUTPUT'|null;scope:'SYNTHETIC_INTEGER_TRANSFORM_ONLY'};events:RuntimeEvent[];}
export interface RuntimeSnapshot{schemaVersion:'runtime-monitor-v4';sourceKind:'SYNTHETIC_HARNESS';servedAt:string;runs:{runId:string;sourceKind:'SYNTHETIC_HARNESS';taskKind:'INTEGER_TRANSFORM';attempts:WireAttempt[]}[];scope:{syntheticOnly:true;modelTraining:false;modelPerformanceClaim:false;realData:false};}
const statuses=['RUNNING','STOPPED','EXECUTION_FINISHED'],stages=['INITIALIZING','TRANSFORMING','FINALIZING','TERMINAL'],kinds=['STARTED','PROGRESS','HEARTBEAT','STOPPED','EXECUTION_FINISHED'];
function need(v:unknown):asserts v{if(!v)throw Error('RUNTIME_CONTRACT_MISMATCH');}
function obj(v:unknown,keys:string[]){need(typeof v==='object'&&v!==null&&!Array.isArray(v));const o=v as Record<string,unknown>;need(Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k)));return o;}
function list(v:unknown,max:number,min=0){need(Array.isArray(v)&&v.length>=min&&v.length<=max);return v;}
function member(v:unknown,values:string[]){need(typeof v==='string'&&values.includes(v));}
function num(v:unknown,max=1e9,integer=false,nullable=false){if(nullable&&v===null)return;need(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max&&(!integer||Number.isSafeInteger(v)));}
function hash(v:unknown,nullable=false){if(nullable&&v===null)return;need(typeof v==='string'&&/^[0-9a-f]{64}$/.test(v));}
function time(v:unknown,nullable=false){if(nullable&&v===null)return;need(typeof v==='string'&&v.length<=64&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v)));}
function progress(v:unknown){const p=obj(v,['completedUnits','totalUnits','unit']);num(p.completedUnits,16384,true);num(p.totalUnits,16384,true);need((p.totalUnits as number)>0&&(p.completedUnits as number)<=(p.totalUnits as number)&&p.unit==='INTEGER_RECORDS');}
function resources(v:unknown){const r=obj(v,['currentRssMiB','peakRssMiB']);num(r.currentRssMiB,1e9,false,true);num(r.peakRssMiB,1e9,false,true);}
function pacing(v:unknown){const p=obj(v,['pacedForObservation','pacingMs']);num(p.pacingMs,1000,true);need(p.pacedForObservation===((p.pacingMs as number)>0));}
function canonical(v:unknown):string{return Array.isArray(v)?'['+v.map(canonical).join(',')+']':v!==null&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}':JSON.stringify(v);}
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
export function verifyRuntime(value:unknown):RuntimeSnapshot{
 const root=obj(value,['schemaVersion','sourceKind','servedAt','runs','scope']);need(root.schemaVersion==='runtime-monitor-v4'&&root.sourceKind==='SYNTHETIC_HARNESS');time(root.servedAt);
 const scope=obj(root.scope,['syntheticOnly','modelTraining','modelPerformanceClaim','realData']);need(scope.syntheticOnly===true&&scope.modelTraining===false&&scope.modelPerformanceClaim===false&&scope.realData===false);
 const ids=new Set<string>();
 for(const entry of list(root.runs,8)){
  const r=obj(entry,['runId','sourceKind','taskKind','attempts']);need(typeof r.runId==='string'&&/^syn-[0-9a-f]{16}$/.test(r.runId)&&!ids.has(r.runId));ids.add(r.runId);need(r.sourceKind==='SYNTHETIC_HARNESS'&&r.taskKind==='INTEGER_TRANSFORM');
  const seen=new Set<string>();
  for(const entry of list(r.attempts,4,1)){
   const a=obj(entry,['attemptId','previousAttemptId','status','stage','lastProducerSeq','lastEventAt','lastReceivedAt','lastWorkerHeartbeatAt','lastHeartbeatReceivedAt','monotonicElapsedSeconds','progress','resources','pacing','observation','completionEvidence','events']);
   need(typeof a.attemptId==='string'&&/^attempt-[1-4]$/.test(a.attemptId)&&!seen.has(a.attemptId));need(a.previousAttemptId===null||typeof a.previousAttemptId==='string'&&seen.has(a.previousAttemptId));seen.add(a.attemptId);
   member(a.status,statuses);member(a.stage,stages);num(a.lastProducerSeq,63,true);time(a.lastEventAt);time(a.lastReceivedAt);time(a.lastWorkerHeartbeatAt,true);time(a.lastHeartbeatReceivedAt,true);num(a.monotonicElapsedSeconds);progress(a.progress);resources(a.resources);pacing(a.pacing);
   const events=list(a.events,64,1);let previous:RuntimeEvent|undefined;
   for(const [seq,entry] of events.entries()){
    const e=obj(entry,['eventId','previousEventId','runId','attemptId','producerSeq','occurredAt','receivedAt','monotonicElapsedSeconds','eventKind','stage','status','progress','resources','pacing','claimHash']);
    hash(e.eventId);hash(e.previousEventId,true);need(e.producerSeq===seq&&e.runId===r.runId&&e.attemptId===a.attemptId&&e.previousEventId===(previous?.eventId??null));
    time(e.occurredAt);time(e.receivedAt);num(e.monotonicElapsedSeconds);member(e.eventKind,kinds);member(e.stage,stages);member(e.status,statuses);progress(e.progress);resources(e.resources);pacing(e.pacing);hash(e.claimHash,true);
    const typed=entry as RuntimeEvent;
    need(same(typed.pacing,a.pacing)&&typed.progress.totalUnits===(a.progress as Progress).totalUnits);
    if(previous)need(previous.status==='RUNNING'&&typed.monotonicElapsedSeconds>=previous.monotonicElapsedSeconds&&typed.progress.completedUnits>=previous.progress.completedUnits&&typed.eventKind!=='STARTED');
    else need(typed.eventKind==='STARTED'&&typed.status==='RUNNING'&&typed.stage==='INITIALIZING'&&typed.progress.completedUnits===0);
    if(typed.eventKind==='EXECUTION_FINISHED')need(typed.status==='EXECUTION_FINISHED'&&typed.stage==='TERMINAL'&&typed.progress.completedUnits===typed.progress.totalUnits&&typed.claimHash!==null);
    else if(typed.eventKind==='STOPPED')need(typed.status==='STOPPED'&&typed.stage==='TERMINAL'&&typed.claimHash===null);
    else need(typed.status==='RUNNING'&&typed.claimHash===null);
    previous=typed;
   }
   const last=previous!;need(a.lastProducerSeq===events.length-1&&a.status===last.status&&a.stage===last.stage&&a.lastEventAt===last.occurredAt&&a.lastReceivedAt===last.receivedAt&&a.monotonicElapsedSeconds===last.monotonicElapsedSeconds&&same(a.progress,last.progress)&&same(a.resources,last.resources));
   need(a.lastWorkerHeartbeatAt===null||a.lastWorkerHeartbeatAt===last.occurredAt);need(a.lastHeartbeatReceivedAt===null||a.lastHeartbeatReceivedAt===last.receivedAt);
   const o=obj(a.observation,['state','ageSeconds','staleAfterSeconds','basis']);member(o.state,['FRESH','STALE','UNKNOWN']);num(o.ageSeconds,1e9,false,true);need(o.staleAfterSeconds===5&&o.basis==='LAST_WORKER_RECEIPT');
   const age=a.lastHeartbeatReceivedAt===null?null:(Date.parse(root.servedAt as string)-Date.parse(a.lastHeartbeatReceivedAt as string))/1000;
   if(age===null||age<0)need(o.state==='UNKNOWN'&&o.ageSeconds===null);else need(o.state===(age>5?'STALE':'FRESH')&&o.ageSeconds!==null&&Math.abs((o.ageSeconds as number)-age)<.002);
   const c=obj(a.completionEvidence,['state','evidenceId','checkedAt','claimHash','reason','scope']);member(c.state,['NOT_REPORTED','VERIFIED','REJECTED']);hash(c.evidenceId,true);time(c.checkedAt,true);hash(c.claimHash,true);need(c.scope==='SYNTHETIC_INTEGER_TRANSFORM_ONLY');
   if(c.state==='NOT_REPORTED')need(c.evidenceId===null&&c.checkedAt===null&&c.claimHash===null&&c.reason===null);
   else {need(c.evidenceId!==null&&c.checkedAt!==null);if(c.state==='VERIFIED')need(a.status==='EXECUTION_FINISHED'&&c.reason===null&&c.claimHash===last.claimHash&&c.claimHash!==null);else member(c.reason,['INCOMPLETE','NO_FINISH_CLAIM','CHECKSUM_MISMATCH','MISSING_OUTPUT']);}
  }
 }
 return value as RuntimeSnapshot;
}
/** Within this fixed server, an accepted prefix may only grow. No automatic rollback. */
export function verifyExtension(before:RuntimeSnapshot,after:RuntimeSnapshot){
 for(const r of before.runs)for(const a of r.attempts){const next=after.runs.find(x=>x.runId===r.runId)?.attempts.find(x=>x.attemptId===a.attemptId);need(next&&next.events.length>=a.events.length&&same(a.events,next.events.slice(0,a.events.length)));if(a.completionEvidence.state!=='NOT_REPORTED')need(same(a.completionEvidence,next.completionEvidence));}
}
