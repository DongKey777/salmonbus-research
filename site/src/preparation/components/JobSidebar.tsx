import {ChevronRight,ShieldCheck} from 'lucide-react';
import type {PreparationJob} from '../types';
import {JOB_STATUS,number} from '../presentation';

export function JobSidebar({jobs,selected,onSelect}:{jobs:PreparationJob[];selected:string;onSelect:(id:string)=>void}){
 const active=jobs.find(job=>job.id===selected);
 return <aside className="sidebar prep-sidebar">
  <div className="sidebar-head"><strong>자료 검증 시도</strong><span>{jobs.length}</span></div>
  <div className="prep-jobs">{jobs.map((job,i)=><button key={job.id} className={`prep-job ${job.id===selected?'selected':''}`} onClick={()=>onSelect(job.id)} aria-label={`${job.title} · ${JOB_STATUS[job.status].label}`} aria-pressed={job.id===selected}>
   <span className="prep-job-index">{String(i+1).padStart(2,'0')} <i className={`prep-state-dot ${JOB_STATUS[job.status].tone}`}/></span>
   <strong>{job.title}</strong><small>{JOB_STATUS[job.status].label}</small><ChevronRight size={13}/>
  </button>)}</div>
  {!jobs.length&&<p className="prep-side-empty">검증 작업의 보고를<br/>기다리고 있습니다.</p>}
  <div className="sidebar-section"><span className="section-label">고정 입력 범위</span><dl>
   <dt>정산 행</dt><dd>{number(active?.inputs.evaluationRows)}</dd>
   <dt>관측 키</dt><dd>{number(active?.inputs.observationRows)}</dd>
  </dl><p className="prep-side-note">입력 건수이며 처리 완료 건수가 아닙니다.</p></div>
  <div className="sidebar-section"><span className="section-label">연구 준비</span><dl>
   <dt>학습 준비</dt><dd>미완료</dd><dt>최종 평가 자료</dt><dd>미확정</dd><dt>이번 모델 호출</dt><dd>없음</dd>
  </dl></div>
  <div className="sidebar-bottom"><ShieldCheck size={13}/>집계 보고만 조회</div>
 </aside>;
}
