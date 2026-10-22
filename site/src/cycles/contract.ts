import schema from './snapshot.schema.json' with {type:'json'};
import type {Values} from './types.ts';

export interface Resource {currentRssMiB:number|null;peakRssMiB:number|null;cpuSeconds:number|null;wallSeconds:number|null;javaCalls:number|null;measurementKind:string;sourceOccurredAt:string|null;sourceMonotonicSeconds:number|null}
export interface Decision {purpose:'MAIN'|'AUXILIARY';producerValidity:'VALID'|'INVALID';outcome:'CRITERIA_MET'|'CRITERIA_NOT_MET'|'INCONCLUSIVE'|'INVALID';revisionRef:string;decisionRef:string;referenceCandidateId:string;referenceReportHash:string;candidateReportHash:string;policyRef:string;planRef:string;contractRef:string;comparisonStatus:string}
export interface Report {jobId:string;modelReceiptRef:string;scoreReceiptRef:string;reportHash:string;groupRef:string;numericValidity:'DEFINED'|'UNDEFINED'|'INVALID';metrics:Values;support:{rows:number|null;positiveRows:number|null;events:number|null;weightSum:number|null};metricMethods:{ECE:'ECE10'|null};validity:string;registeredOrder:number;registeredSeq:number;registrationHash:string}
export interface Cycle {cycleIndex:number;cycleId:string;candidateId:string;jobId:string;phase:string;status:'IN_PROGRESS'|'COMPLETED'|'HELD';model:{state:string;receiptRef:string|null;artifactRef:string|null;completionRef:string|null;resources:Resource|null};score:Cycle['model'];report:Report|null;mainDecision:Decision|null;auxDecision:Decision|null;proposal:{state:string;selectedCandidateId:string|null;proposalRef:string;consumptionRef:string|null}|null;resources:Resource;lastOccurredAt:string;lastObservedAt:string;lastReceivedAt:string}
export interface Group {groupRef:string;cohortRef:string;comparisonContractRef:string;mainPolicyRef:string;mainPlanRef:string;mainContractRef:string;auxPolicyRef:string;auxPlanRef:string;auxContractRef:string;eceMethod:'ECE10'|null;candidateIds:string[];cycleIndexes:number[]}
export interface Run {runId:string;attemptId:string;executionId:string;sourceKind:'SYNTHETIC_MODEL_EXECUTION'|'ARTIFICIAL_TRANSPORT_FIXTURE';sourceGenerationId:string;contextRef:string;producerCodeHash:string;proposerKind:string;targetCycles:5;baselineCandidateId:string;head:{producerSeq:number;eventHash:string};phase:string;status:'IN_PROGRESS'|'CLOSED'|'HELD';baseline:Cycle|null;cycles:Cycle[];comparisonGroups:Group[];counts:{registeredCandidates:number;completedCycles:number;modelReceiptFacts:number;scoreReceiptFacts:number;decisionFacts:number;proposalFacts:number;proposalConsumptions:number};budget:{modelJobs:6;proposals:5;javaCalls:1344;providerCalls:0};budgetObserved:{modelReservations:number;proposals:number;reportedJavaCalls:number;javaCoverage:string;newModelsExecutedByMonitor:0};quality:{actualQualityClaim:false;HUsed:false;C2Ready:false;inputKind:string;verification:string};events:{eventId:string;producerSeq:number;eventHash:string;cycleIndex:number;kind:string;occurredAt:string;observedAt:string;receivedAt:string}[]}
export interface Snapshot {schemaVersion:'five-cycle-monitor-v1';generationId:string;cursor:number;servedAt:string;lastReceivedAt:string|null;runs:Run[]}
type Shape={type?:string;properties?:Record<string,Shape>;required?:string[];additionalProperties?:boolean;items?:Shape;anyOf?:Shape[];const?:unknown;enum?:unknown[];minimum?:number;maximum?:number;minLength?:number;maxLength?:number;minItems?:number;maxItems?:number;pattern?:string;format?:string};
const keywords=new Set(['$id','$schema','type','properties','required','additionalProperties','items','anyOf','const','enum','minimum','maximum','minLength','maxLength','minItems','maxItems','pattern','format']);
function need(ok:unknown):asserts ok {if(!ok)throw Error('CYCLE_CONTRACT_MISMATCH');}
function validate(v:unknown,s:Shape):void{
 need(Object.keys(s).every(k=>keywords.has(k)));
 if(s.anyOf){need(s.anyOf.some(b=>{try{validate(v,b);return true;}catch{return false;}}));return;}
 if(Object.hasOwn(s,'const'))need(v===s.const);if(s.enum)need(s.enum.includes(v));
 if(s.type==='null'){need(v===null);return;}if(s.type==='boolean'){need(typeof v==='boolean');return;}
 if(s.type==='object'){need(typeof v==='object'&&v!==null&&!Array.isArray(v));const o=v as Record<string,unknown>;need(s.required?.every(k=>Object.hasOwn(o,k))??true);if(s.additionalProperties===false)need(Object.keys(o).every(k=>Object.hasOwn(s.properties??{},k)));for(const [k,b] of Object.entries(s.properties??{}))if(Object.hasOwn(o,k))validate(o[k],b);return;}
 if(s.type==='array'){need(Array.isArray(v)&&v.length>=(s.minItems??0)&&v.length<=(s.maxItems??Number.MAX_SAFE_INTEGER));if(s.items)for(const a of v)validate(a,s.items);return;}
 if(s.type==='string'){need(typeof v==='string'&&v.length>=(s.minLength??0)&&v.length<=(s.maxLength??Number.MAX_SAFE_INTEGER));if(s.pattern)need(new RegExp(s.pattern).test(v));if(s.format){need(s.format==='date-time'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v)));}return;}
 if(s.type==='number'||s.type==='integer'){need(typeof v==='number'&&Number.isFinite(v)&&v>=(s.minimum??-Number.MAX_SAFE_INTEGER)&&v<=(s.maximum??Number.MAX_SAFE_INTEGER));if(s.type==='integer')need(Number.isSafeInteger(v));return;}
 need(s.type===undefined&&(Object.hasOwn(s,'const')||s.enum!==undefined));
}
export const runKey=(r:Run)=>`${r.runId}/${r.attemptId}/${r.sourceGenerationId}`;
export function verifySnapshot(v:unknown):Snapshot{
 validate(v,schema as Shape);const s=v as Snapshot;
 need(new Set(s.runs.map(runKey)).size===s.runs.length);need(s.runs.reduce((n,r)=>n+r.events.length,0)===s.cursor);
 for(const r of s.runs){
  need(r.events.length===r.head.producerSeq+1&&r.events.at(-1)?.eventHash===r.head.eventHash);
  r.events.forEach((e,i)=>need(e.producerSeq===i));
  const all=[...(r.baseline?[r.baseline]:[]),...r.cycles],registered=all.filter(c=>c.report!==null);
  need(all.every((c,i)=>c.cycleIndex===i));need(r.counts.registeredCandidates===registered.length);
  need(r.counts.completedCycles===r.cycles.filter(c=>c.status==='COMPLETED').length);
  if(r.status==='CLOSED')need(r.cycles.length===5&&r.counts.completedCycles===5&&registered.length===6);
  if(r.baseline)need(r.baseline.candidateId===r.baselineCandidateId);
  for(const c of registered){
   const p=c.report!;need(c.model.state==='RECEIPT_VERIFIED'&&c.score.state==='RECEIPT_VERIFIED');
   need(p.modelReceiptRef===c.model.receiptRef&&p.scoreReceiptRef===c.score.receiptRef&&p.jobId===c.jobId);
   need(r.events[p.registeredSeq]?.kind==='REPORT_REGISTERED'&&r.events[p.registeredSeq]?.eventHash===p.registrationHash);
   const g=r.comparisonGroups.find(g=>g.groupRef===p.groupRef);need(g&&g.cycleIndexes.includes(c.cycleIndex));
   if(p.numericValidity!=='DEFINED')need(Object.values(p.metrics).every(v=>v===null));
   if(p.metrics.ECE!==null)need(p.metricMethods.ECE==='ECE10'&&g.eceMethod==='ECE10');
   for(const d of [c.mainDecision,c.auxDecision])if(d){
    need(d.candidateReportHash===p.reportHash&&d.referenceReportHash===r.baseline?.report?.reportHash&&d.referenceCandidateId===r.baselineCandidateId);
    const purpose=d.purpose==='MAIN'?'main':'aux';
    need(d.policyRef===g[`${purpose}PolicyRef`]&&d.planRef===g[`${purpose}PlanRef`]&&d.contractRef===g[`${purpose}ContractRef`]);
    if(d.producerValidity==='VALID')need(p.groupRef===r.baseline?.report?.groupRef);
   }
  }
 }
 return s;
}
export function verifyExtension(before:Snapshot,after:Snapshot):void{
 if(before.generationId!==after.generationId)return;
 need(after.cursor>=before.cursor);
 for(const r of before.runs){
  const n=after.runs.find(x=>runKey(x)===runKey(r));need(n&&n.events.length>=r.events.length);
  r.events.forEach((e,i)=>need(JSON.stringify(e)===JSON.stringify(n.events[i])));
  for(const c of [...(r.baseline?[r.baseline]:[]),...r.cycles])if(c.report){
   const nc=c.cycleIndex===0?n.baseline:n.cycles.find(x=>x.cycleIndex===c.cycleIndex);need(nc?.report&&JSON.stringify(nc.report)===JSON.stringify(c.report));
  }
 }
}
