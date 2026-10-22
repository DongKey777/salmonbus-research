import {useEffect,useState} from 'react';
import {ChevronDown,FileCheck2} from 'lucide-react';
import type {V2Snapshot} from '../observer-contract';
import {Panel} from '../ui/Panel';
import {ChartFrame} from '../ui/ChartFrame';
import {useSavedReview} from './connection';
import {catalogGate,matchReview} from './join';
import {REVIEW_CATALOG} from './catalog';
import {frontierOption} from './charts';
import type {Revision,SavedReview} from './types';
import './review.css';

const when=(value:string|null)=>value?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'시각 미확인';
const outcome=(r:Revision)=>r.producerValidity==='INVALID'?'입력 계약 무효':r.outcome==='INCONCLUSIVE'?'판정 유보':'기준 미달';
function Contents({review,snapshot,selectedCandidate,onSelect}:{review:SavedReview;snapshot:V2Snapshot;selectedCandidate:string;onSelect:(id:string)=>void}){
  const [purpose,setPurpose]=useState<'MAIN'|'AUXILIARY'>('MAIN'),[frameIndex,setFrameIndex]=useState(0);
  const run=snapshot.runs.find(r=>r.runId===review.source.sourceResearchRunId)!;
  const labels=Object.fromEntries(run.registeredCandidates.map(r=>[r.candidateId,r.label??r.candidateId]));
  const rows=review.revisions.filter(r=>r.purpose===purpose),frame=review.proposalFrames[frameIndex]??review.proposalFrames[0];
  return <>
    <div className="review-scope"><span>저장된 합성 결과 · 후속 계약으로 재검토</span><span>새 학습 0 · 새 점수 0 · 새 제안 전송 0</span></div>
    <div className="review-content-grid"><section className="review-decisions">
      <div className="review-section-head"><h3>판정 이력</h3><div className="segmented" aria-label="판정 목적">{(['MAIN','AUXILIARY'] as const).map(p=><button key={p} className={purpose===p?'active':''} aria-pressed={purpose===p} onClick={()=>setPurpose(p)}>{p==='MAIN'?'주 평가':'보조 평가'}</button>)}</div></div>
      <div className="review-table"><table><thead><tr><th>후보 · 명시 비교 기준</th><th>판정</th><th>판정 판본</th></tr></thead><tbody>{rows.map(r=><tr key={r.reviewRevisionId} className={r.candidate.candidateId===selectedCandidate?'focused':''}>
        <td><button onClick={()=>onSelect(r.candidate.candidateId)}>{labels[r.candidate.candidateId]}</button><small>기준 · {labels[r.reference.candidateId]}</small></td>
        <td><span className={`review-outcome ${r.outcome==='CRITERIA_NOT_MET'?'below':''}`}>{outcome(r)}</span></td><td><code title={r.revisionRef}>{r.revisionRef.slice(0,10)}</code></td>
      </tr>)}</tbody></table></div>
      <p className="review-note">이 비교 기준은 재검토 기록에 고정돼 있습니다. 위 그래프의 화면 비교기준 선택과 구분합니다.</p>
      <details className="review-details"><summary>정책과 검증 범위</summary>{rows.map(r=><div key={r.reviewRevisionId}><strong>{labels[r.candidate.candidateId]}</strong><span>정책 <code title={r.policyRef}>{r.policyRef.slice(0,12)}</code> · 계획 <code title={r.planRef}>{r.planRef.slice(0,12)}</code></span><span>원 판정 {when(r.times.decisionOccurredAt)} · 재검토 요약 {when(r.times.decisionReviewSummaryCompletedAt)}</span></div>)}<p>실행 문맥과 입력 계보는 기존 소유자의 검증 기록에 의존합니다. 원 실행·개별 판정 원본을 화면에서 다시 검증하지 않습니다.</p></details>
    </section><section className="review-frontier">
      <div className="review-section-head"><h3>제안 입력에 포함된 보고</h3><select aria-label="과거 제안 시점" value={frameIndex} onChange={e=>setFrameIndex(Number(e.target.value))}>{review.proposalFrames.map((f,i)=><option value={i} key={f.sourceGeneration}>장부 #{f.sourceGeneration}</option>)}</select></div>
      {frame?<><ChartFrame id={`review-frontier-${frame.sourceGeneration}`} label="과거 제안 시점까지 등록된 보고" option={frontierOption(frame,labels)}/><div className="review-frame-summary"><span>등록 보고 <b>{frame.registeredPrefix.length}</b>개</span><span>선택한 주 판정 <b>{frame.history.length}</b>개</span><span>{frame.proposalStatus==='REVIEW_HELD'?'입력 초안 보류':'미전송 입력 초안'}</span></div><p className="review-note">이후 등록된 결과는 제외했습니다. 나중 계약으로 만든 초안이며, 당시 실제 공급자 요청·응답을 재검증한 결과는 아닙니다.</p></>:<p className="review-note">표시할 과거 입력 초안이 없습니다.</p>}
    </section></div>
    <div className="review-footer"><span>원 주기는 장부 #{review.terminal?.sourceGeneration}에서 종료 · 추가 작업 요청 없음</span><span>목록 {review.catalogRef.slice(0,12)}</span></div>
  </>;
}
export function SavedReviewPanel({snapshot,runId,selectedCandidate,onSelect,registrationError}:{snapshot:V2Snapshot|undefined;runId:string|undefined;selectedCandidate:string;onSelect:(id:string)=>void;registrationError:boolean}){
  const [open,setOpen]=useState(()=>new URLSearchParams(location.search).get('review')==='1'),gate=catalogGate(snapshot,runId,REVIEW_CATALOG);
  const toggle=()=>{const next=!open;setOpen(next);const params=new URLSearchParams(location.search);if(next)params.set('review','1');else params.delete('review');history.replaceState(null,'',`${location.pathname}?${params}${location.hash}`);};
  const query=useSavedReview(open&&gate==='MATCHED'&&!registrationError);
  useEffect(()=>{if(open&&query.data&&location.hash==='#saved-review')document.getElementById('saved-review')?.scrollIntoView({block:'start'});},[open,query.data]);
  const match=query.data?matchReview(query.data,snapshot,runId):gate;
  useEffect(()=>{if(import.meta.env.DEV)(window as unknown as {__savedReview:unknown}).__savedReview={open,gate,match,error:query.error?.message??null,catalog:match==='MATCHED'&&open&&!registrationError?query.data:undefined};},[open,gate,match,query.data,query.error,registrationError]);
  const blocked=registrationError?'현재 등록 장부를 확인하지 못했습니다. 재검토 표시를 보류합니다.':match==='WAITING'?'필요한 보고의 등록을 기다립니다. 판정과 과거 입력은 아직 표시하지 않습니다.':match==='DIFFERENT_RUN'?'이 연구 주기에 연결된 저장 재검토가 없습니다.':match==='MISMATCH'?'현재 장부와 재검토의 실행·보고 신원이 다릅니다. 결과를 연결하지 않았습니다.':null;
  return <Panel id="saved-review" title="저장 재검토" subtitle="원 실행 뒤에 만든 판정 기록 · 원 성적과 판정은 유지" className={`observer-saved-review ${open?'is-open':''}`} actions={<button className="review-toggle" aria-expanded={open} aria-controls="saved-review-content" onClick={toggle}><FileCheck2 size={13}/>{open?'접기':'저장 재검토 보기'}<ChevronDown size={13}/></button>}>
    {open&&<div id="saved-review-content">{blocked?<p className="review-blocked" role="status">{blocked}</p>:<>{query.error&&<div className="review-blocked error" role="alert">재검토 파일을 확인하지 못했습니다.{query.data?' 마지막 검증 자료를 표시합니다.':''}<button onClick={()=>void query.refetch()}>다시 확인</button></div>}{query.data&&snapshot?<Contents review={query.data} snapshot={snapshot} selectedCandidate={selectedCandidate} onSelect={onSelect}/>:!query.error&&<p className="review-blocked">고정된 재검토 파일과 현재 장부를 대조하고 있습니다.</p>}</>}</div>}
  </Panel>;
}
