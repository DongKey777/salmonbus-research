import type {RuntimeSnapshot} from './contract';
import type {RuntimeView} from './types';
const stage={INITIALIZING:'시작',TRANSFORMING:'정수 변환',FINALIZING:'마감',TERMINAL:'종료'};
const event={STARTED:'작업 시작',PROGRESS:'청크 반영',HEARTBEAT:'작업 신호',STOPPED:'작업 중단',EXECUTION_FINISHED:'실행 종료'};
export function projectRuntime(wire:RuntimeSnapshot):RuntimeView{
 return {servedAt:wire.servedAt,updatedAt:null,attempts:wire.runs.flatMap(r=>r.attempts.map(a=>({
  key:`${r.runId}/${a.attemptId}`,runId:r.runId,attemptId:a.attemptId,title:`정수 변환 · 시도 ${a.attemptId.slice(-1)}`,
  stateLabel:a.status==='RUNNING'?'실행 중':a.status==='STOPPED'?'중단':'실행 종료',
  tone:a.status==='RUNNING'?'running' as const:a.status==='STOPPED'?'stopped' as const:'neutral' as const,terminal:a.status!=='RUNNING',stageLabel:stage[a.stage],
  proofLabel:a.completionEvidence.state==='VERIFIED'?'합성 결과 검증 완료':a.completionEvidence.state==='REJECTED'?'결과 검증 거절':'완료 증거 미확인',proofVerified:a.completionEvidence.state==='VERIFIED',
  lastWorkerSignalAt:a.lastHeartbeatReceivedAt,staleAfterSeconds:a.observation.staleAfterSeconds,observationState:a.observation.state,ageAtResponse:a.observation.ageSeconds,
  failureLabel:a.completionEvidence.reason,elapsedSeconds:a.monotonicElapsedSeconds,paced:a.pacing.pacedForObservation,pacingMs:a.pacing.pacingMs,
  events:a.events.map(e=>({seq:e.producerSeq,elapsedSeconds:e.monotonicElapsedSeconds,occurredAt:e.occurredAt,committedAt:e.receivedAt,stage:e.stage,stageLabel:stage[e.stage],eventLabel:event[e.eventKind],currentRssMiB:e.resources.currentRssMiB,peakRssMiB:e.resources.peakRssMiB,done:e.progress.completedUnits,total:e.progress.totalUnits,unitLabel:'정수 레코드'})),
 }))).sort((a,b)=>Date.parse(a.events[0].committedAt)-Date.parse(b.events[0].committedAt))};
}
export function signalLabel(job:RuntimeView['attempts'][number],secondsSinceResponse:number,connectionError:boolean){
 if(job.terminal)return '종료된 작업의 마지막 계측';
 if(connectionError||job.ageAtResponse===null||job.observationState==='UNKNOWN')return '작업 신호 확인 불가';
 return job.ageAtResponse+Math.max(0,secondsSinceResponse)>job.staleAfterSeconds?'작업 신호 지연 · 상태 미확정':'작업 신호 수신';
}
