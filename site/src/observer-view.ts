import {composite, METRICS} from './domain.ts';
import type {Metric, Metrics} from './domain.ts';

// Presentation model; the receiver contract is mapped separately.
// No candidate identity, count, score or accepted model is manufactured here.
export interface ObservedReport {
  id:string;
  label:string;
  reportHash:string;
  registeredGeneration:number;
  registeredOrder?:number;
  comparisonKey:string|null;
  role:'BASELINE'|'CANDIDATE'|'UNKNOWN';
  metrics:Partial<Metrics>;
  support:{questions:number|null;scored:number|null;weight:number|null;events?:number};
}
export interface ObservedSourceEvent {
  id:string;
  generation:number;
  recordedAt:string|null;
  phase:string;
  event:string;
  registeredReports:number;
}
export interface ObservedRun {
  id:string;
  label:string;
  origin:string;
  historical:boolean;
  phase:string;
  stopReason:string|null;
  headSequence:number;
  headHash:string;
  lastSourceAt:string|null;
  observedAt:string|null;
  receivedAt:string|null;
  observerStatus:string;
  reports:ObservedReport[];
  events:ObservedSourceEvent[];
  decision:{connected:boolean;revision:string|null;label:string};
}
export interface ComparisonGroup {
  key:string;
  reports:ObservedReport[];
  baseline:ObservedReport|null;
  reason:'READY'|'REFERENCE_MISSING'|'REFERENCE_AMBIGUOUS'|'COMPARISON_UNSPECIFIED';
}

export function comparisonGroups(run:ObservedRun):ComparisonGroup[]{
  const groups=new Map<string,ObservedReport[]>();
  for(const report of [...run.reports].sort((a,b)=>a.registeredGeneration-b.registeredGeneration||a.id.localeCompare(b.id))){
    const key=report.comparisonKey??`unbound:${report.id}`;
    groups.set(key,[...(groups.get(key)??[]),report]);
  }
  return [...groups].map(([key,reports])=>{
    const baseline=reports.filter(r=>r.role==='BASELINE');
    const reason=reports.some(r=>r.comparisonKey===null)?'COMPARISON_UNSPECIFIED':baseline.length===0?'REFERENCE_MISSING':baseline.length>1?'REFERENCE_AMBIGUOUS':'READY';
    return {key,reports,baseline:reason==='READY'?baseline[0]:null,reason};
  });
}

export function reportValue(report:ObservedReport,baseline:ObservedReport|null,metric:Metric|'COMPOSITE'):number|null{
  if(metric==='COMPOSITE')return baseline?composite(report.metrics,baseline.metrics):null;
  const value=report.metrics[metric];
  return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
}

export function comparisonSeries(group:ComparisonGroup,metric:Metric|'COMPOSITE'){
  // Candidate order is local to this run and comparison group, never a learning epoch.
  // The frontier is descriptive; it cannot supply a model acceptance decision.
  let best:number|null=null;
  return group.reports.map((report,index)=>{
    const value=reportValue(report,group.baseline,metric);
    if(value!==null)best=best===null?value:metric==='COMPOSITE'?Math.max(best,value):Math.min(best,value);
    return {id:report.id,order:report.registeredOrder??index+1,value,bestObserved:best,reportHash:report.reportHash};
  });
}

export function supportLabel(report:ObservedReport|null){
  if(!report)return '보고 수신 대기';
  const {questions,scored,weight}=report.support;
  const count=questions!==null&&scored!==null?`${scored.toLocaleString()} / ${questions.toLocaleString()} 질문`:scored!==null?`채점 ${scored.toLocaleString()}행 · 전체 대상 미제공`:'평가 분모 미확인';
  return `${count}${weight!==null?` · 가중치 합 ${weight.toLocaleString()}`:''}`;
}

export function allMetricsPresent(report:ObservedReport){
  return METRICS.every(k=>reportValue(report,null,k)!==null);
}
