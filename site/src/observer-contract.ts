import type {ObservedRun} from './observer-view.ts';

export const PHASES=['NEW','PREPARE','MODEL_RESERVED','MODEL_RUNNING','SCORE_RESERVED','SCORE_RUNNING','SCORED','COMPARE_RESERVED','COMPARE_RUNNING','COMPARED','PROPOSE','PROPOSAL_RESERVED','PROPOSAL_RUNNING','PROPOSAL_AVAILABLE','CLOSED','HELD'] as const;
export const JOURNAL_EVENTS=['CREATED','MODEL_RESERVED','MODEL_DISPATCHED','MODEL_COMPLETED','MODEL_REUSED','SCORE_DISPATCHED','SCORE_COMPLETED','SCORE_REUSED','NEW_REPORT_REGISTERED','BASELINE_SELECTED','COMPARISON_DISPATCHED','COMPARISON_COMPLETED','COMPARISON_REUSED','FRESH_REPORT_PROJECTED','LIVE_PROPOSAL_CONSUMED','PROPOSAL_DISPATCHED','PROPOSAL_COMPLETED','PROPOSAL_REUSED','FIXED_GATE_APPLIED','HELD'] as const;
const METRIC_KEYS=['Brier','NRPS','MAE','ECE10','MeanMSE','MeanRMSE','ProbabilityBias','SeatBias','SeatOver','SeatUnder'];
export interface V2Candidate {
 candidateId:string;label:string|null;reportHash:string;sourceCohortHash:string;cohortHash:string;comparisonContractHash:string;
 metrics:Record<string,number>;support:{days:number;events:number;fullEvents:number;nonFullEvents:number;positiveRows:number;rows:number};weightSum:number;
 registeredOrder:number;registeredGeneration:number;occurredAt:string;observedAt:string;receivedAt:string;validity:'VERIFIED_REGISTERED';decisionStatus:'NOT_CONNECTED';
}
export interface V2Event {sourceId:string;sourceKind:'JOURNAL';sourceSeq:number;sourceHash:string;journalEvent:string;phase:string;occurredAt:string;observedAt:string;receivedAt:string;registeredCandidateIds:string[]}
export interface V2Run {
 runId:string;sourceKind:'ACTUAL_SAVED_SYNTHETIC'|'ARTIFICIAL_FIXTURE';phase:string;reportValidity:'VERIFIED_REGISTERED_ONLY';decisionStatus:'NOT_CONNECTED';
 head:{seq:number;hash:string};lastOccurredAt:string;lastObservedAt:string;lastReceivedAt:string;candidateCount:number;registeredCandidates:V2Candidate[];
 comparisonGroups:{cohortHash:string;comparisonContractHash:string;candidateIds:string[]}[];events:V2Event[];
}
export interface V2Snapshot {schemaVersion:'research-monitor-v2';generationId:string;cursor:number;lastReceivedAt:string|null;source:{kind:'COMMITTED_SYNTHETIC_JOURNAL';mode:'FINITE_POLL_ONCE'};runs:V2Run[]}
const fail=():never=>{throw Error('OBSERVER_CONTRACT_MISMATCH');};
function need(v:unknown):asserts v{if(!v)fail();}
function object(v:unknown):asserts v is Record<string,unknown>{need(v!==null&&typeof v==='object'&&!Array.isArray(v));}
function exact(v:unknown,fields:string[]){object(v);need(Object.keys(v).length===fields.length&&fields.every(f=>Object.hasOwn(v,f)));}
const integer=(v:unknown,min=0)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
const string=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=160;
const hash=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const time=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const sameSet=(a:string[],b:string[])=>new Set(a).size===a.length&&new Set(b).size===b.length&&a.length===b.length&&a.every(x=>b.includes(x));

export function verifyV2(raw:unknown):V2Snapshot {
 exact(raw,['schemaVersion','generationId','cursor','lastReceivedAt','source','runs']);const s=raw as V2Snapshot;
 need(s.schemaVersion==='research-monitor-v2'&&string(s.generationId)&&integer(s.cursor));
 exact(s.source,['kind','mode']);need(s.source.kind==='COMMITTED_SYNTHETIC_JOURNAL'&&s.source.mode==='FINITE_POLL_ONCE');
 need(Array.isArray(s.runs)&&s.runs.length<=32&&new Set(s.runs.map(r=>r?.runId)).size===s.runs.length);
 need(s.cursor===0?s.lastReceivedAt===null:time(s.lastReceivedAt));let count=0;const sourceIds=new Set<string>();
 for(const r of s.runs){
  exact(r,['runId','sourceKind','phase','reportValidity','decisionStatus','head','lastOccurredAt','lastObservedAt','lastReceivedAt','candidateCount','registeredCandidates','comparisonGroups','events']);
  need(string(r.runId)&&['ACTUAL_SAVED_SYNTHETIC','ARTIFICIAL_FIXTURE'].includes(r.sourceKind)&&PHASES.includes(r.phase as never));
  need(r.reportValidity==='VERIFIED_REGISTERED_ONLY'&&r.decisionStatus==='NOT_CONNECTED');
  exact(r.head,['seq','hash']);need(integer(r.head.seq)&&r.head.seq<4096&&hash(r.head.hash));
  need(time(r.lastOccurredAt)&&time(r.lastObservedAt)&&time(r.lastReceivedAt));
  need(Array.isArray(r.registeredCandidates)&&r.registeredCandidates.length<=128&&integer(r.candidateCount)&&r.candidateCount===r.registeredCandidates.length);
  need(new Set(r.registeredCandidates.map(c=>c?.candidateId)).size===r.candidateCount);
  for(const [index,c] of r.registeredCandidates.entries()){
   exact(c,['candidateId','label','reportHash','sourceCohortHash','cohortHash','comparisonContractHash','metrics','support','weightSum','registeredOrder','registeredGeneration','occurredAt','observedAt','receivedAt','validity','decisionStatus']);
   need(string(c.candidateId)&&(c.label===null||string(c.label))&&[c.reportHash,c.sourceCohortHash,c.cohortHash,c.comparisonContractHash].every(hash));
   need(c.validity==='VERIFIED_REGISTERED'&&c.decisionStatus==='NOT_CONNECTED'&&c.registeredOrder===index+1&&integer(c.registeredGeneration)&&c.registeredGeneration<=r.head.seq);
   if(index)need(c.registeredGeneration>=r.registeredCandidates[index-1].registeredGeneration);
   need(time(c.occurredAt)&&time(c.observedAt)&&time(c.receivedAt));object(c.metrics);
   need(Object.keys(c.metrics).length>0&&Object.entries(c.metrics).every(([k,v])=>METRIC_KEYS.includes(k)&&typeof v==='number'&&Number.isFinite(v)&&(['ProbabilityBias','SeatBias'].includes(k)||v>=0)));
   exact(c.support,['days','events','fullEvents','nonFullEvents','positiveRows','rows']);need(Object.values(c.support).every(v=>integer(v)));
   need(c.support.positiveRows<=c.support.rows&&c.support.fullEvents+c.support.nonFullEvents===c.support.events&&Number.isFinite(c.weightSum)&&c.weightSum>0);
  }
  need(Array.isArray(r.comparisonGroups)&&r.comparisonGroups.length<=128);const groupKeys=new Set<string>(),members:string[]=[];
  for(const g of r.comparisonGroups){
   exact(g,['cohortHash','comparisonContractHash','candidateIds']);need(hash(g.cohortHash)&&hash(g.comparisonContractHash)&&Array.isArray(g.candidateIds));
   const key=g.cohortHash+':'+g.comparisonContractHash;need(!groupKeys.has(key));groupKeys.add(key);
   need(g.candidateIds.length>0&&sameSet(g.candidateIds,r.registeredCandidates.filter(c=>c.cohortHash===g.cohortHash&&c.comparisonContractHash===g.comparisonContractHash).map(c=>c.candidateId)));members.push(...g.candidateIds);
  }
  need(sameSet(members,r.registeredCandidates.map(c=>c.candidateId)));
  need(Array.isArray(r.events)&&r.events.length===r.head.seq+1);count+=r.events.length;
  for(const [seq,e] of r.events.entries()){
   exact(e,['sourceId','sourceKind','sourceSeq','sourceHash','journalEvent','phase','occurredAt','observedAt','receivedAt','registeredCandidateIds']);
   need(hash(e.sourceId)&&!sourceIds.has(e.sourceId)&&e.sourceKind==='JOURNAL'&&e.sourceSeq===seq&&hash(e.sourceHash));sourceIds.add(e.sourceId);
   need(JOURNAL_EVENTS.includes(e.journalEvent as never)&&PHASES.includes(e.phase as never)&&time(e.occurredAt)&&time(e.observedAt)&&time(e.receivedAt));
   need(Array.isArray(e.registeredCandidateIds)&&sameSet(e.registeredCandidateIds,r.registeredCandidates.filter(c=>c.registeredGeneration===seq).map(c=>c.candidateId)));
   need(e.registeredCandidateIds.length===0||e.journalEvent==='NEW_REPORT_REGISTERED');
  }
  const last=r.events.at(-1)!;need(last.sourceHash===r.head.hash&&last.phase===r.phase&&last.occurredAt===r.lastOccurredAt&&last.observedAt===r.lastObservedAt&&last.receivedAt===r.lastReceivedAt);
 }
 need(count===s.cursor);return s;
}

export function asObservedRun(r:V2Run):ObservedRun {
 return {id:r.runId,label:r.runId,origin:r.sourceKind,historical:true,phase:r.phase,stopReason:null,headSequence:r.head.seq,headHash:r.head.hash,lastSourceAt:r.lastOccurredAt,observedAt:r.lastObservedAt,receivedAt:r.lastReceivedAt,observerStatus:'CONFIRMED_JOURNAL',
  reports:r.registeredCandidates.map(c=>({id:c.candidateId,label:c.label??c.candidateId,reportHash:c.reportHash,registeredGeneration:c.registeredGeneration,registeredOrder:c.registeredOrder,comparisonKey:c.cohortHash+':'+c.comparisonContractHash,role:'UNKNOWN',metrics:c.metrics,support:{questions:null,scored:c.support.rows,weight:c.weightSum,events:c.support.events}})),
  events:r.events.map(e=>({id:e.sourceId,generation:e.sourceSeq,recordedAt:e.occurredAt,phase:e.phase,event:e.journalEvent,registeredReports:e.registeredCandidateIds.length})),
  decision:{connected:false,revision:null,label:'채택 판정 미연결'}};
}
