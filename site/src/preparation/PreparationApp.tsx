import {useEffect,useState} from 'react';
import {Activity,Database,RefreshCw,Unplug} from 'lucide-react';
import {ResearchNav} from '../ui/ResearchNav';
import {PUBLIC_SITE,SITE_MARK} from '../site/env.ts';
import {usePreparation} from './connection';
import {JobSidebar} from './components/JobSidebar';
import {JobHeader} from './components/JobHeader';
import {OutcomePanel} from './components/OutcomePanel';
import {TimelinePanel,ResourcesPanel,ReferencePanel,ReportList} from './components/ChartPanels';
import {time} from './presentation';
import './preparation.css';

/** Composition and selection only. Evidence, networking and charts live elsewhere. */
export default function PreparationApp(){
 const query=usePreparation();
 const [selected,setSelected]=useState(new URLSearchParams(location.search).get('attempt')??'C1B_INDEPENDENT_AUDIT');
 const [now,setNow]=useState(Date.now());
 const data=query.data,job=data?.jobs.find(j=>j.id===selected)??data?.jobs.at(-1);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{if(job){history.replaceState(null,'',`${location.pathname}?${new URLSearchParams({view:'preparation',attempt:job.id})}`);}},[job?.id]);
 useEffect(()=>{if(import.meta.env.DEV)(window as unknown as {__preparation:unknown}).__preparation={data,selected:job?.id,error:query.error?.message??null};},[data,job?.id,query.error]);
 return <div className="preparation-app">
  <a className="skip" href="#preparation-workbench">자료 검증으로 이동</a>
  <header className="topbar"><div className="wordmark"><Activity size={22}/><b>salmonbus</b><span>/</span><strong>Research</strong></div><ResearchNav active="preparation"/><span className="prep-top-label">{SITE_MARK}</span></header>
  <div className="scopebar prep-scope"><span className="scope"><Database size={12}/>실자료 준비 집계</span><span className={`connection ${query.error?'error':data?'connected':''}`}><i/>{query.error?'보고 자료 연결 오류':data?(PUBLIC_SITE?'저장 사본':'보고 자료 연결됨'):'보고 자료 연결 중'}</span><span>{PUBLIC_SITE?'담당 보고 기반 · 배포할 때 저장한 사본':'담당 보고 기반 · 10초마다 확인'}</span></div>
  <div className="shell"><JobSidebar jobs={data?.jobs??[]} selected={job?.id??selected} onSelect={setSelected}/>
   <main id="preparation-workbench">
    {query.error&&<div className="error-banner prep-error" role="alert"><Unplug size={15}/><span>{data?'자료를 새로 확인하지 못했습니다. 마지막 응답을 표시합니다.':'보고 자료를 읽지 못했습니다. 다른 자료로 자동 전환하지 않습니다.'}</span><button onClick={()=>void query.refetch()}>다시 연결</button></div>}
    {job?<>
     <JobHeader job={job} now={now} refreshing={query.isFetching} onRefresh={()=>void query.refetch()}/>
     <div className="prep-grid">
      <TimelinePanel job={job}/><ReferencePanel job={job}/>
      <ResourcesPanel job={job} kind="memory"/><ResourcesPanel job={job} kind="disk"/>
      <ResourcesPanel job={job} kind="workload"/><OutcomePanel job={job}/>
      <ReportList job={job}/>
     </div>
    </>:<div className="prep-loading"><RefreshCw size={24} className={query.isPending?'spin':''}/><h1>자료 검증 보고를 기다리고 있습니다.</h1><p>검증된 응답을 받은 뒤 그래프를 표시합니다.</p></div>}
    <footer className="work-footer prep-footer"><span>실행기 직접 계측이 아닌 담당 보고입니다. 중간 집계와 완료 보고를 구별합니다.</span><span>응답 시각 {time(data?.servedAt??null)} KST · 학습 준비 미완료</span></footer>
   </main>
  </div>
 </div>;
}
