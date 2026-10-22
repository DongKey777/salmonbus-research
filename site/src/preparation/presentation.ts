import type {JobStatus,PreparationJob} from './types';

export const PREPARATION_COLORS={blue:'#4f72c3',teal:'#3d8e8b',amber:'#b58045',rose:'#bd6b5d',muted:'#94a4b8',grid:'#e9eef5'};
export const JOB_STATUS:Record<JobStatus,{label:string;tone:string}>={
 WAITING:{label:'시작 보고 대기',tone:'neutral'},
 RUNNING:{label:'보고상 진행 중',tone:'running'},
 STOPPED:{label:'중단 · 결과 보존',tone:'stopped'},
 VERIFIED:{label:'독립 검증 완료 보고',tone:'verified'},
 UNVERIFIED:{label:'완료 증거 미확인',tone:'neutral'},
};
export function number(value:number|null|undefined,maximumFractionDigits=0){
 return value==null?'—':new Intl.NumberFormat('ko-KR',{maximumFractionDigits}).format(value);
}
export function minutes(seconds:number|null){
 if(seconds===null)return '미보고';
 const whole=Math.floor(seconds/60),remainder=Math.round(seconds%60);
 return `${whole}분${remainder?` ${remainder}초`:''}`;
}
export function time(value:string|null){
 return value?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'시각 미확인';
}
export function ageSeconds(reportedAt:string|null,now:number){
 return reportedAt===null?null:Math.max(0,(now-Date.parse(reportedAt))/1000);
}
export function freshness(job:PreparationJob,now:number){
 const age=ageSeconds(job.lastReportReceivedAt,now);
 return {age,waitingForNewReport:job.status==='RUNNING'&&(age===null||age>180)};
}
export function countScopeLabel(job:PreparationJob){
 return job.countScope==='VERIFIED'?'담당자가 검증 완료로 보고한 집계':job.countScope==='INTERMEDIATE'?'완료로 채택하지 않은 중간 집계':'확정 집계 미수신';
}
export function latestSample(job:PreparationJob){return job.samples.at(-1)??null;}
