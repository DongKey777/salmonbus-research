export type Metric = 'Brier'|'NRPS'|'MAE';
export type Metrics = Record<Metric,number> & {ECE10:number;MeanMSE?:number};
export interface SourceEvent{seq:number;stage:string;status:string;candidateId:string|null;recordedAt:string;counts:Record<string,number>;reason:string|null}
export interface Forecast{key:string;pmf:number[];full:number;mean:number;truth:number|null;labelState:'SETTLED'|'LOST';weight?:number;day?:string}
export interface Curve{n:number;weight:number;throughQuestion?:string;day?:string;metrics:Metrics}
export interface Model{id:string;label:string;metrics:Metrics;forecasts:Forecast[];curves:{daily:Curve[];prefix:Curve[]};wallSeconds:number;mainDecision:string;auxDecision:string;reportRef:string}
export interface RecordedSnapshot{schema:string;origin:string;snapshotId:string;models:Model[];events:SourceEvent[];sourceStartedAt:string;sourceCompletedAt:string;generatedAt:string;sourceVersion:string;decisionVersion:string;overallEnvironment:string;support:{questions:number;settled:number;lost:number;scoreWeight:number;questionCoverage:number;replayForecasts:number;replayFeedbacks:number};decision:{status:string;selected:string;reason:string;scope:string};ai:{claudeCalls:number;jevNewCalls:number;jevMode:string;claudeEstimatedUsd:number;costScope:string;stopReason:string};limitations:string[]}
export interface MonitorSnapshot{schemaVersion:'research-monitor-v1';generationId:string;cursor:number;lastReceivedAt:string|null;source:{kind:'SAVED_SYNTHETIC_EXECUTION';snapshotId:string|null};projection:{recordedSnapshot:RecordedSnapshot|null;receivedEventCount:number;replayStatus:'EMPTY'|'REPLAYING'|'COMPLETED';candidatesReady:string[];lastSourceEvent:SourceEvent|null}}
export type Mode='archive'|'live';
export type CurveMode='attempt'|'prefix';
export const METRICS:Metric[]=['Brier','NRPS','MAE'];
export const POLICY={id:'composite-display-v0.1-b60-r25-m15',status:'DRAFT_DISPLAY_ONLY',weights:{Brier:.60,NRPS:.25,MAE:.15},minimumReference:1e-10} as const;
export {MODEL_COLORS} from './ui/chart-theme.ts';
export const STAGES:Record<string,string>={CONTROL:'주기 제어',FEATURE_CACHE:'특징',FIT:'학습',DAY_REPLAY:'예보·피드백',STATE_RESTORE:'복원',MODEL:'모델',SCORE:'평가',COMPARE:'비교',PROPOSER:'가설 제안'};
export const STATUS:Record<string,string>={STARTED:'시작',COMPLETED:'완료',VALIDATED:'검사',COMMITTED:'장부 반영'};
export const DECISIONS:Record<string,string>={BASELINE:'기준 모델',INCONCLUSIVE:'근거 부족',CRITERIA_NOT_MET:'기준 미달'};
export function composite(metrics:Partial<Metrics>,reference:Partial<Metrics>,weights:Record<Metric,number>=POLICY.weights):number|null{
 if(METRICS.some(k=>!Number.isFinite(weights[k])||weights[k]<0)||Math.abs(METRICS.reduce((s,k)=>s+weights[k],0)-1)>1e-12)return null;
 if(METRICS.some(k=>!Number.isFinite(metrics[k])||!Number.isFinite(reference[k])||metrics[k]!<0||reference[k]!<=POLICY.minimumReference))return null;
 return 100*METRICS.reduce((s,k)=>s+weights[k]*(1-metrics[k]!/reference[k]!),0);
}
export function contributions(metrics:Metrics,reference:Metrics){return METRICS.map(key=>({key,value:100*POLICY.weights[key]*(1-metrics[key]/reference[key])}));}
export function readyModels(s:MonitorSnapshot|null|undefined):Model[]{const p=s?.projection;return p?.recordedSnapshot?.models.filter(m=>p.candidatesReady.includes(m.id))||[];}
export function receivedSourceEvents(s:MonitorSnapshot|null|undefined):SourceEvent[]{const p=s?.projection;if(!p?.recordedSnapshot||!p.lastSourceEvent)return [];return p.recordedSnapshot.events.filter(e=>e.seq<=p.lastSourceEvent!.seq);}
export function prefixComposite(m:Model,baseline:Model){return m.curves.prefix.map(row=>{const r=baseline.curves.prefix.find(x=>x.n===row.n&&x.weight===row.weight&&x.throughQuestion===row.throughQuestion);return [row.n,r?composite(row.metrics,r.metrics):null] as const;});}
function canonical(value:unknown):string{if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';return JSON.stringify(value);}
export function verifySnapshot(raw:unknown):MonitorSnapshot{
 const fail=()=>{throw new Error('MONITOR_CONTRACT_MISMATCH');};
 if(!raw||typeof raw!=='object')return fail();const s=raw as MonitorSnapshot;
 if(s.schemaVersion!=='research-monitor-v1'||typeof s.generationId!=='string'||!s.generationId||!Number.isSafeInteger(s.cursor)||s.cursor<0||s.cursor>138||s.source?.kind!=='SAVED_SYNTHETIC_EXECUTION')return fail();
 const p=s.projection;if(!p||p.receivedEventCount!==s.cursor||!['EMPTY','REPLAYING','COMPLETED'].includes(p.replayStatus)||!Array.isArray(p.candidatesReady)||new Set(p.candidatesReady).size!==p.candidatesReady.length)return fail();
 if(!p.recordedSnapshot){if(s.cursor!==0||p.candidatesReady.length||p.lastSourceEvent||p.replayStatus!=='EMPTY')return fail();return s;}
 const d=p.recordedSnapshot;if(d.schema!=='salmonbus-analysis-v1'||d.origin!=='SAVED_SYNTHETIC_EXECUTION'||d.snapshotId!==s.source.snapshotId||!Array.isArray(d.models)||d.models.length!==4||!Array.isArray(d.events)||d.events.length!==132)return fail();
 if(p.candidatesReady.some(id=>!d.models.some(m=>m.id===id)))return fail();
 if(p.lastSourceEvent&&!d.events.some(e=>e.seq===p.lastSourceEvent!.seq&&canonical(e)===canonical(p.lastSourceEvent)))return fail();
 if(p.replayStatus==='COMPLETED'&&(s.cursor!==138||p.candidatesReady.length!==4||p.lastSourceEvent?.seq!==132))return fail();
 if(p.candidatesReady.some(id=>!d.events.some(e=>e.candidateId===id&&e.stage==='SCORE'&&e.status==='COMPLETED'&&e.seq<=(p.lastSourceEvent?.seq||0))))return fail();
 for(const m of d.models){if(!m.curves?.prefix?.length||!m.forecasts?.length||METRICS.some(k=>!Number.isFinite(m.metrics[k])||m.metrics[k]<0))return fail();for(const c of m.curves.prefix)if(!Number.isFinite(c.n)||METRICS.some(k=>!Number.isFinite(c.metrics[k])||c.metrics[k]<0))return fail();}
 return s;
}
export function fmt(value:number|null|undefined,digits=2){return value===null||value===undefined||!Number.isFinite(value)?'—':value.toFixed(digits);}
export function signed(value:number|null|undefined,digits=2){return value===null||value===undefined?'—':`${value>0?'+':''}${fmt(value,digits)}`;}
export function kst(value:string|null|undefined){return value?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value)):'—';}
