import type {Run,Cycle} from './contract.ts';
import type {CyclePoint,CycleChartGroup} from './types.ts';
export function point(c:Cycle,run:Run):CyclePoint|null{
 const r=c.report;if(!r)return null;
 const source=run.events[r.registeredSeq];
 return {index:c.cycleIndex,cycleId:c.cycleId,candidateId:c.candidateId,groupRef:r.groupRef,reportHash:r.reportHash,
  metrics:{...r.metrics},baselineMetrics:run.baseline?.report?.groupRef===r.groupRef?{...run.baseline.report.metrics}:null,
  rows:r.support.rows,events:r.support.events,weightSum:r.support.weightSum,main:c.mainDecision?.outcome??null,auxiliary:c.auxDecision?.outcome??null,
  registeredAt:source?.occurredAt??null,wallSeconds:c.model.resources?.wallSeconds??null,cpuSeconds:c.model.resources?.cpuSeconds??null,peakRssBytes:c.model.resources?.peakRssMiB==null?null:c.model.resources.peakRssMiB*1048576};
}
export function groups(run:Run):CycleChartGroup[]{
 const items=[...(run.baseline?[run.baseline]:[]),...run.cycles].map(c=>point(c,run)).filter((p):p is CyclePoint=>p!==null);
 return run.comparisonGroups.map(g=>({ref:g.groupRef,baseline:items.find(p=>p.index===0&&p.groupRef===g.groupRef)??null,points:items.filter(p=>p.index!==0&&p.groupRef===g.groupRef)}));
}
export const outcome=(v:string|null|undefined)=>v===null||v===undefined?'판정 대기':({CRITERIA_MET:'기준 충족',CRITERIA_NOT_MET:'기준 미달',INCONCLUSIVE:'근거 부족',INVALID:'무효'}[v]??'미확인');
export const phase=(v:string)=>({RUN_STARTED:'실행 준비',MODEL_RESERVED:'학습 예약',MODEL_DISPATCHED:'모델 실행',FIT_RUNNING:'학습 중',PREDICT_RUNNING:'예보·피드백',MODEL_RECEIPT_VERIFIED:'모델 결과 검증',SCORE_RUNNING:'채점 중',SCORE_RECEIPT_VERIFIED:'채점 검증',REPORT_REGISTERED:'점수 등록',MAIN_DECISION_COMMITTED:'주지표 판정',AUX_DECISION_COMMITTED:'보조 판정',PROPOSAL_SEALED:'다음 실험 제안',PROPOSAL_CONSUMED:'제안 반영',CYCLE_COMPLETED:'주기 완료',RUN_CLOSED:'5회 실행 완료',RUN_HELD:'실행 보류',HEARTBEAT:'작업 신호'}[v]??v);
