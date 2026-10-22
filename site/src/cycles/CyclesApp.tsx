import {useEffect,useMemo,useState} from 'react';
import {Activity,GitBranch,RefreshCw,Unplug,Check,Clock3} from 'lucide-react';
import {ResearchNav} from '../ui/ResearchNav';
import {Panel} from '../ui/Panel';
import {ChartFrame} from '../ui/ChartFrame';
import {useCycles} from './connection.ts';
import {runKey} from './contract.ts';
import {groups,phase,outcome} from './project.ts';
import {metricTrend,deltaTrend,resourcesTrend} from './charts.ts';
import type {Cycle} from './contract.ts';
import './cycles.css';
import {ModelVersion} from '../registry/ModelVersion';
const number=(n:number|null|undefined,d=4)=>n==null?'—':new Intl.NumberFormat('ko-KR',{maximumFractionDigits:d}).format(n);
const clock=(t:string|null|undefined)=>t?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(t)):'—';
export default function CyclesApp(){
 const query=useCycles(),s=query.data;const [selectedRun,setRun]=useState(new URLSearchParams(location.search).get('run')??'');
 const [selected,setSelected]=useState<number|null>(null),[groupRef,setGroup]=useState('');
 const run=s?.runs.find(r=>runKey(r)===selectedRun)??s?.runs.filter(r=>r.sourceKind==='SYNTHETIC_MODEL_EXECUTION').at(-1)??s?.runs.at(-1);
 const grouped=useMemo(()=>run?groups(run):[],[run]),group=grouped.find(g=>g.ref===groupRef)??grouped[0];
 const all:Cycle[]=run?[...(run.baseline?[run.baseline]:[]),...run.cycles]:[];
 const selectedCycle=all.find(c=>c.cycleIndex===selected)??all.at(-1);
 const plotted=useMemo(()=>group?[...(group.baseline?[group.baseline]:[]),...group.points]:[],[group]);
 const chartOptions=useMemo(()=>group?{Brier:metricTrend(group,'Brier',selectedCycle?.cycleIndex??null),NRPS:metricTrend(group,'NRPS',selectedCycle?.cycleIndex??null),MAE:metricTrend(group,'MAE',selectedCycle?.cycleIndex??null),ECE:metricTrend(group,'ECE',selectedCycle?.cycleIndex??null),delta:deltaTrend(group)}:null,[group,selectedCycle?.cycleIndex]);
 const resourceOptions=useMemo(()=>resourcesTrend(plotted),[plotted]);
 const actual=run?.sourceKind==='SYNTHETIC_MODEL_EXECUTION';
 const lastRunReceipt=run?.events.at(-1)?.receivedAt;
 const quiet=run?.status==='IN_PROGRESS'&&lastRunReceipt!==undefined&&Date.now()-Date.parse(lastRunReceipt)>120000;
 useEffect(()=>{if(run)history.replaceState(null,'','/?'+new URLSearchParams({view:'cycles',run:runKey(run)}));},[run&&runKey(run)]);
 useEffect(()=>{if(import.meta.env.DEV)(window as unknown as {__cycles:unknown}).__cycles={snapshot:s,error:query.error?.message??null,selected:selectedCycle?.cycleIndex};},[s,query.error,selectedCycle?.cycleIndex]);
 const chartEvent=(id:string)=>{const m=/^cycle:(\d+)$/.exec(id);if(m)setSelected(Number(m[1]));};
 return <div className="cycles-app"><a className="skip" href="#cycle-workbench">반복 연구로 이동</a>
  <header className="topbar"><div className="wordmark"><Activity size={22}/><b>salmonbus</b><span>/</span><strong>Research</strong></div><ResearchNav active="cycles"/><span className="cycle-local">LOCAL RESEARCH</span></header>
  <div className="scopebar"><span className="scope">{actual?'실제 모델 실행 · 합성 관측 입력':'통신 검증용 인공 자료'}</span><span className={`connection ${query.error?'error':s?'connected':''}`}><i/>{query.error?'연결 오류 · 마지막 수신 자료':s?'연구 장부 연결됨':'연결 중'}</span><span>2초 갱신 · 등록된 결과만 표시</span></div>
  <div className="shell"><aside className="sidebar cycle-sidebar"><div className="sidebar-head"><strong>연구 실행</strong><span>{s?.runs.length??0}</span></div>
   <div className="cycle-run-list">{s?.runs.map(r=><button key={runKey(r)} onClick={()=>{setRun(runKey(r));setSelected(null);setGroup('');}} className={run&&runKey(run)===runKey(r)?'selected':''}><small>{r.sourceKind==='SYNTHETIC_MODEL_EXECUTION'?'모델 실행':'인공 예시'}</small><b>{r.runId}</b><span>{r.counts.completedCycles}/5회 · {phase(r.phase)}</span></button>)}</div>
   <div className="sidebar-bottom">읽기 전용 관제 · 실행 기록 보존</div>
  </aside><main id="cycle-workbench">
   {query.error&&<div role="alert" className="error-banner"><Unplug size={15}/><span>{s?'새 자료를 받지 못해 마지막 성공 응답을 표시합니다.':'연구 자료를 읽지 못했습니다.'}</span><button onClick={()=>void query.refetch()}>다시 연결</button></div>}
   {run?<><div className="cycle-heading"><div><span>ITERATIVE RESEARCH</span><h1>모델 개선 추이 <em>{run.counts.completedCycles}<small>/5</small></em></h1></div><div className="cycle-actions"><b>{phase(run.phase)}</b><button onClick={()=>void query.refetch()} aria-label="연구 장부 다시 읽기"><RefreshCw size={15}/></button></div></div>
    <div className="cycle-track" aria-label="5회 연구 진행">{Array.from({length:5},(_,i)=>{const c=run.cycles.find(c=>c.cycleIndex===i+1);return <button key={i} disabled={!c} onClick={()=>setSelected(i+1)} className={`${c?.status==='COMPLETED'?'done':c?'active':''} ${selectedCycle?.cycleIndex===i+1?'selected':''}`}><span>{c?.status==='COMPLETED'?<Check size={13}/>:c?<Clock3 size={13}/>:i+1}</span><b>시도 {i+1}</b><small>{c?phase(c.phase):'대기'}</small></button>;})}</div>
    <div className="cycle-facts"><span>모델 결과 <b>{run.counts.modelReceiptFacts}</b> / 6</span><span>등록 성적 <b>{run.counts.registeredCandidates}</b></span><span>채점 문항 <b>{number(run.baseline?.report?.support.rows,0)}</b> · 같은 평가 집합</span><span>마지막 수신 <b>{clock(lastRunReceipt)}</b> KST</span></div>
    {quiet&&<div className="error-banner" role="status">이 실행의 새 진행 기록이 2분 이상 없습니다. 마지막으로 수신한 상태를 표시합니다.</div>}
    {grouped.length>1&&<label className="cycle-group">비교 조건 <select value={group?.ref??''} onChange={e=>setGroup(e.target.value)}>{grouped.map((g,i)=><option key={g.ref} value={g.ref}>그룹 {i+1} · {g.points.length}개 시도</option>)}</select><span>조건이 다른 성적은 연결하지 않습니다.</span></label>}
    <div className="cycle-grid">
     <Panel title="만석 확률 예측 오차" subtitle="Brier · 낮을수록 유리 · 학습 epoch가 아닌 개선 시도별 평가" className="cycle-main-plot" footer={<span>실행 성공과 개선 판정은 별도입니다. 같은 개발 자료를 반복 평가한 결과이며 독립 H 평가가 아닙니다.</span>}>{group?<ChartFrame id="cycle-brier" label="개선 시도별 Brier" option={chartOptions!.Brier} onPick={chartEvent}/>:<div className="plot-empty">첫 모델의 검증된 성적을 기다립니다.</div>}</Panel>
     <Panel title="기준 대비 Brier 차이" subtitle="기준 − 후보 · 양수면 개발 점수가 낮아짐" className="cycle-delta">{group?<ChartFrame id="cycle-delta" label="기준 대비 Brier 차이" option={chartOptions!.delta}/>:<div className="plot-empty">비교할 등록 결과가 없습니다.</div>}</Panel>
     <Panel title="좌석 분포 오차" subtitle="NRPS · 낮을수록 유리" className="cycle-small-plot">{group?<ChartFrame id="cycle-nrps" label="개선 시도별 NRPS" option={chartOptions!.NRPS}/>:<div className="plot-empty">등록 대기</div>}</Panel>
     <Panel title="잔여 좌석 오차" subtitle="MAE · 단위: 좌석" className="cycle-small-plot">{group?<ChartFrame id="cycle-mae" label="개선 시도별 좌석 MAE" option={chartOptions!.MAE}/>:<div className="plot-empty">등록 대기</div>}</Panel>
     <Panel title="확률 보정 진단" subtitle="ECE10 · 고정 10구간 · 소표본 탐색용" className="cycle-small-plot">{group?<ChartFrame id="cycle-ece" label="개선 시도별 ECE10" option={chartOptions!.ECE}/>:<div className="plot-empty">등록 대기</div>}</Panel>
     <Panel title="모델 작업 자원" subtitle="모델 작업 시간·Python 프로세스 최고 RSS · 미계측은 빈 값" className="cycle-small-plot"><ChartFrame id="cycle-resources" label="시도별 모델 시간과 메모리" option={resourceOptions}/></Panel>
     <Panel title="시도별 결과와 판정" subtitle="차트의 점을 선택하면 해당 기록을 강조합니다." className="cycle-table-panel">
      <div className="cycle-table"><table><thead><tr><th>시도</th><th>후보</th><th>Brier</th><th>NRPS</th><th>MAE</th><th>주 판정</th><th>보조 판정</th><th>채점 문항</th><th>모델 시간</th></tr></thead><tbody>{all.map(c=><tr key={c.cycleId} className={selectedCycle?.cycleIndex===c.cycleIndex?'selected':''} onClick={()=>setSelected(c.cycleIndex)}><td>{c.cycleIndex===0?'기준':`#${c.cycleIndex}`}</td><td><b>{c.candidateId}</b><small>{phase(c.phase)}</small></td><td>{number(c.report?.metrics.Brier)}</td><td>{number(c.report?.metrics.NRPS,5)}</td><td>{number(c.report?.metrics.MAE,3)}</td><td>{c.cycleIndex===0?'—':outcome(c.mainDecision?.outcome)}</td><td>{c.cycleIndex===0?'—':outcome(c.auxDecision?.outcome)}</td><td>{number(c.report?.support.rows,0)}</td><td>{c.model.resources?.wallSeconds==null?'—':number(c.model.resources.wallSeconds,2)+'초'}</td></tr>)}</tbody></table></div>
     </Panel>
    </div>
    {selectedCycle&&<details className="cycle-evidence"><summary><GitBranch size={14}/>선택한 시도의 근거 · {selectedCycle.candidateId}</summary><dl><dt>보고서</dt><dd>{selectedCycle.report?.reportHash??'미등록'}</dd><dt>MAIN revision</dt><dd>{selectedCycle.mainDecision?.revisionRef??'미산출'}</dd><dt>AUX revision</dt><dd>{selectedCycle.auxDecision?.revisionRef??'미산출'}</dd><dt>다음 제안</dt><dd>{selectedCycle.proposal?.selectedCandidateId??(selectedCycle.cycleIndex===5?'5회 실행 한도 종료':'미등록')}</dd></dl><ModelVersion run={run} cycle={selectedCycle}/></details>}
   </>:<div className="cycle-empty"><Activity size={28}/><h1>새 연구 실행을 기다립니다.</h1><p>모델 결과의 검증과 등록이 끝나면 그래프가 채워집니다.</p></div>}
   <footer className="work-footer"><span>{actual?'새 수치 모델의 합성 자료 평가 · 실관측 성능·독립 H 검증은 별도':'인공 전송 예시 · 실제 모델 성적 아님'}</span><span>응답 {clock(s?.servedAt)} KST</span></footer>
  </main></div>
 </div>;
}
