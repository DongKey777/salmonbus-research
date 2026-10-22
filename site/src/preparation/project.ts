/** Maps wire evidence into the UI. No network, chart options or inferred progress. */
import type {PreparationSnapshot,WireAttempt,WirePhase} from './contract';
import type {JobStatus,PreparationJob,PreparationView,ResourceSample} from './types';

export const PHASE_LABEL:Record<WirePhase,string>={UNKNOWN:'단계 미확인',APPROVED:'실행 승인',FRESH_GUARD_PASSED:'시작 검사',SOURCE_PARTITION:'정산 자료 읽기',SORTING:'정렬',HEADERS:'그룹 정보 생성',EXACT_E_VALIDATION:'원위치 대조',PACKING:'대조 자료 분할',E_SEQUENTIAL_MERGE:'정산 순차 대조',FINAL_CHECKS:'최종 검사',STOPPED:'중단',AUDIT_CLAIMS_REPORTED_VERIFIED:'독립 검증 완료 보고'};
function status(a:WireAttempt):JobStatus{
 if(a.status==='RUNNING')return 'RUNNING';
 if(a.status==='STOPPED_NOT_ACCEPTED'||a.status==='AUDIT_STOPPED')return 'STOPPED';
 if(a.status==='AUDIT_CLAIMS_REPORTED_VERIFIED')return 'VERIFIED';
 if(a.status==='COMPLETED_UNVERIFIED')return 'UNVERIFIED';
 return 'WAITING';
}
export function projectPreparation(snapshot:PreparationSnapshot):PreparationView{
 return {sourceUpdatedAt:snapshot.sourceUpdatedAt,servedAt:snapshot.servedAt,jobs:snapshot.attempts.map(a=>{
  const qualified=a.id==='C1B_INDEPENDENT_AUDIT'&&a.proofStatus==='REPORTED_VERIFIED';
  const count=qualified?a.acceptedCounts:a.intermediateCounts;
  // Resource plots use report-received time. Two clock descriptions of one sample
  // must not become two independent memory/disk observations.
  const samples:ResourceSample[]=[];const seen=new Set<string>();
  for(const s of a.samples){
   const point={receivedAt:s.receivedAt,elapsedSeconds:s.elapsedSeconds,freeGiB:s.freeGiB,currentRssMiB:s.currentRssMiB,peakRssMiB:s.peakRssMiB,reportedRssMiB:s.unspecifiedReportedRssMiB,algorithmVisits:s.algorithmVisits,pressure:s.pressure};
   const key=JSON.stringify({...point,elapsedSeconds:null});if(!seen.has(key)){seen.add(key);samples.push(point);}
  }
  const reportedElapsed=a.samples.filter(s=>s.elapsedSeconds!==null&&s.elapsedBasis!=='MONOTONIC_REPORTED').at(-1)?.elapsedSeconds??null;
  const job:PreparationJob={id:a.id,title:a.id==='C1B_ORIGINAL'?'원 정답 그룹 구성':'독립 재감사',status:status(a),phaseLabel:PHASE_LABEL[a.phase],
   lastReportReceivedAt:a.lastReportReceivedAt,elapsedSeconds:reportedElapsed,failureCode:a.failureCode,
   limits:{wallSeconds:a.limits.wallSeconds,rssMiB:a.limits.rssMiB,newGiB:a.limits.newOutputBytes===null?null:a.limits.newOutputBytes/2**30,minimumFreeGiB:a.limits.minimumFreeGiB,processes:a.limits.processes},
   inputs:{evaluationRows:a.inputs.evaluationRows,observationRows:a.inputs.observationKeyRows},samples,
   milestones:a.milestones.map((m,i)=>({id:`${a.id}:${i}`,label:PHASE_LABEL[m.phase],elapsedSeconds:null,reportReceivedAt:m.receivedAt,state:m.phase==='STOPPED'?'STOPPED':m.phase==='AUDIT_CLAIMS_REPORTED_VERIFIED'?'COMPLETED':'REPORTED'})),
   countScope:count===null?'NONE':qualified?'VERIFIED':'INTERMEDIATE',counts:count?{nonNull:count.nonNullMembers,nullRows:count.nullRows,groups:count.groups,matched:count.weightedOMatched,aboveHighwater:count.weightedOAboveHighwater}:null,
   verifiedClaims:[],caveats:['담당 보고 기반','당시 가용성·학습 준비 미확인'],
  };return job;
 })};
}
