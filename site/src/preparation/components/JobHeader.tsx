import {Clock3,RefreshCw} from 'lucide-react';
import type {PreparationJob} from '../types';
import {JOB_STATUS,freshness,minutes,time} from '../presentation';

export function JobHeader({job,now,refreshing,onRefresh}:{job:PreparationJob;now:number;refreshing:boolean;onRefresh:()=>void}){
 const current=freshness(job,now),status=JOB_STATUS[job.status];
 return <>
  <div className="prep-heading"><div><span className="prep-eyebrow">자료 검증</span><h1>{job.title}<em className={`prep-badge ${status.tone}`}>{status.label}</em></h1></div>
   <button className="prep-refresh" onClick={onRefresh} disabled={refreshing}><RefreshCw size={14} className={refreshing?'spin':''}/>보고 다시 읽기</button>
  </div>
  <div className="prep-context-line"><span><Clock3 size={12}/>보고된 경과 <b>{minutes(job.elapsedSeconds)}</b></span><span>마지막 보고 수신 <b>{time(job.lastReportReceivedAt)}</b> KST</span></div>
  {current.waitingForNewReport&&<div className="prep-stale" role="status">새 진행 보고를 기다리고 있습니다. 화면에는 마지막으로 확인한 상태를 유지합니다.</div>}
 </>;
}
