import {useEffect,useRef,useState} from 'react';
import {Activity,RefreshCw,ShieldCheck,Unplug} from 'lucide-react';
import {ResearchNav} from '../ui/ResearchNav';
import {ExecutionTabs} from '../ui/ExecutionTabs';
import {Panel} from '../ui/Panel';
import {ChartFrame} from '../ui/ChartFrame';
import {useRuntime} from './connection';
import {signalLabel} from './project';
import {eventsOption,memoryOption,workOption} from './charts';
import type {RuntimeAttempt} from './types';
import './runtime.css';

const number=(n:number|null)=>n===null?'—':new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(n);
const seconds=(n:number|null)=>n!==null&&n>0&&n<.01?'<0.01':number(n);
const timestamp=(value:string|null)=>value?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value)):'미확인';
function Attempts({jobs,selected,onSelect}:{jobs:RuntimeAttempt[];selected:string;onSelect:(key:string)=>void}){
 const list=useRef<HTMLDivElement>(null);
 useEffect(()=>{const host=list.current;if(!host)return;
  const reveal=()=>{const button=host.querySelector<HTMLElement>('[aria-pressed="true"]');if(!button||host.scrollWidth<=host.clientWidth)return;const h=host.getBoundingClientRect(),b=button.getBoundingClientRect();if(b.left<h.left)host.scrollLeft-=h.left-b.left;else if(b.right>h.right)host.scrollLeft+=b.right-h.right;};
  reveal();const resize=new ResizeObserver(reveal);resize.observe(host);return()=>resize.disconnect();
 },[selected]);
 return <aside className="sidebar runtime-sidebar"><div className="sidebar-head"><strong>합성 작업</strong><span>{jobs.length}</span></div>
  <div className="runtime-jobs" ref={list}>{jobs.map(j=><button key={j.key} className={`runtime-job ${j.key===selected?'selected':''}`} onClick={()=>onSelect(j.key)} aria-label={`${j.runId} ${j.attemptId}`} aria-pressed={j.key===selected}>
   <small>{j.runId}</small><strong>{j.title}</strong><span>{j.stateLabel} · {j.proofLabel}</span>
  </button>)}</div><div className="sidebar-bottom"><ShieldCheck size={13}/>웹에서는 작업을 시작하지 않음</div>
 </aside>;
}
function Evidence({job}:{job:RuntimeAttempt}){
 const last=job.events.at(-1)!;
 return <div className="runtime-evidence"><span>완료 단위 <b>{number(last.done)} / {number(last.total)}</b> 정수 레코드</span><span>작업 경과 <b>{seconds(job.elapsedSeconds)}</b>초</span><span>사건 <b>{job.events.length}</b>개</span><span>마지막 작업 신호 <b>{timestamp(job.lastWorkerSignalAt)}</b> KST</span></div>;
}
function EventTable({job}:{job:RuntimeAttempt}){
 return <Panel title="실행 사건" subtitle="발생 순번 기준 · 작업 시각과 장부 반영 시각은 별도" className="runtime-table-panel">
  <div className="runtime-table"><table><thead><tr><th>순번</th><th>단계</th><th>사건</th><th>경과</th><th>완료 단위</th><th>작업 시각 KST</th><th>장부 반영 KST</th></tr></thead><tbody>{[...job.events].reverse().map(e=><tr key={e.seq}><td>#{e.seq}</td><td>{e.stageLabel}</td><td>{e.eventLabel}</td><td>{seconds(e.elapsedSeconds)}초</td><td>{number(e.done)} / {number(e.total)}</td><td>{timestamp(e.occurredAt)}</td><td>{timestamp(e.committedAt)}</td></tr>)}</tbody></table></div>
 </Panel>;
}
export default function RuntimeApp(){
 const query=useRuntime(),data=query.data?.view;
 const [selected,setSelected]=useState(new URLSearchParams(location.search).get('attempt')??'');
 const [now,setNow]=useState(performance.now());
 const job=data?.attempts.find(j=>j.key===selected)??data?.attempts.at(-1);
 useEffect(()=>{const id=setInterval(()=>setNow(performance.now()),1000);return()=>clearInterval(id);},[]);
 useEffect(()=>{if(job)history.replaceState(null,'',`/?${new URLSearchParams({view:'runtime',attempt:job.key})}`);},[job?.key]);
 useEffect(()=>{if(import.meta.env.DEV)(window as unknown as {__runtime:unknown}).__runtime={data,selected:job?.key,error:query.error?.message??null};},[data,job?.key,query.error]);
 return <div className="runtime-app"><a className="skip" href="#runtime-workbench">실행 상태로 이동</a>
  <header className="topbar"><div className="wordmark"><Activity size={22}/><b>salmonbus</b><span>/</span><strong>Research</strong></div><ResearchNav active="observer"/><span className="runtime-local">LOCAL RESEARCH</span></header>
  <ExecutionTabs active="runtime"/>
  <div className="scopebar"><span className="scope">합성 연결 시험 · 실제 작업 계측</span><span className={`connection ${query.error?'error':data?'connected':''}`}><i/>{query.error?'계측 자료 연결 오류':data?'계측 자료 연결됨':'계측 자료 연결 중'}</span><span className="runtime-refresh-note">1초마다 확인 · 학습·실자료 성능 아님</span></div>
  <div className="shell"><Attempts jobs={data?.attempts??[]} selected={job?.key??selected} onSelect={setSelected}/><main id="runtime-workbench">
   {query.error&&<div className="error-banner" role="alert"><Unplug size={15}/><span>{data?'계측 자료를 새로 읽지 못했습니다. 마지막 응답을 표시합니다.':'계측 자료를 읽지 못했습니다. 작업을 시작하거나 다른 자료로 전환하지 않습니다.'}</span><button onClick={()=>void query.refetch()}>다시 연결</button></div>}
   {job?<><div className="runtime-heading"><div><span className="runtime-caption">실행 상태</span><h1>{job.title}<em className={job.tone}>{job.stateLabel}</em><em className={job.proofVerified?'verified':'neutral'}>{job.proofLabel}</em></h1></div><button className="runtime-refresh" onClick={()=>void query.refetch()} aria-label="계측 다시 읽기"><RefreshCw size={14}/></button></div>
    <div className={`runtime-signal ${!job.terminal?'active':''}`} role="status">{signalLabel(job,(now-(query.data?.observedAt??now))/1000,!!query.error)}<span>현재 단계 · {job.stageLabel}</span></div>
    <Evidence job={job}/>
    {job.failureLabel&&<p className="runtime-proof-note">검증 거절 사유 · {{INCOMPLETE:'처리가 끝나지 않음',NO_FINISH_CLAIM:'종료 근거 없음',CHECKSUM_MISMATCH:'계산 결과 불일치',MISSING_OUTPUT:'결과 누락'}[job.failureLabel]??'검증 조건 미충족'}</p>}
    {job.paced&&<div className="runtime-pacing">진행 화면 확인을 위해 청크 사이 {number(job.pacingMs/1000)}초 대기 · 경과 시간은 대기를 포함하며 계산 성능을 뜻하지 않습니다.</div>}
    <div className="runtime-grid">
     <Panel title="자료 처리 흐름" subtitle="실제로 장부에 반영된 정수 레코드 · 전체 연구의 진행률 아님" className="runtime-work" footer={<span>이번 합성 작업의 고정 분모만 사용합니다. 모델 loss·정확도 곡선이 아닙니다.</span>}><ChartFrame id={`runtime-work-${job.key.replace('/','-')}`} label="합성 정수 처리 완료 단위 추이" option={workOption(job)}/></Panel>
     <Panel title="메모리 계측" subtitle="작업 프로세스가 기록한 현재값·최고값" className="runtime-memory" footer={<span>현재 RSS 미계측은 빈 값으로 유지합니다.</span>}><ChartFrame id={`runtime-memory-${job.key.replace('/','-')}`} label="작업 경과별 RSS 계측" option={memoryOption(job)}/></Panel>
     <Panel title="단계별 사건" subtitle="작업의 단조 시계 기준 · 수신 지연과 별개" className="runtime-stages" footer={<span>실행 종료만으로 결과 검증·모델 개선을 선언하지 않습니다.</span>}><ChartFrame id={`runtime-events-${job.key.replace('/','-')}`} label="작업 경과별 실행 사건" option={eventsOption(job)}/></Panel>
     <EventTable job={job}/>
    </div></>:<div className="runtime-empty"><Activity size={28}/><h1>{query.error?'실행 상태를 확인할 수 없습니다.':'등록된 합성 작업이 없습니다.'}</h1><p>작업이 사건을 남기면 이곳에 표시됩니다. 페이지 조회는 작업을 실행하지 않습니다.</p></div>}
   <footer className="work-footer"><span>합성 정수 변환 연결 검증 · 모델 학습·정답 평가·채택 판정 없음</span><span>API 응답 {timestamp(data?.servedAt??null)} KST</span></footer>
  </main></div>
 </div>;
}
