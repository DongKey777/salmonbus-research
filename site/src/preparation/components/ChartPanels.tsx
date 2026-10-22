import type {PreparationJob} from '../types';
import {ChartFrame} from '../../ui/ChartFrame';
import {Panel} from '../../ui/Panel';
import {diskOption,memoryOption,referenceOption,sampleCount,timelineOption,workloadOption} from '../charts';
import {countScopeLabel,number,time} from '../presentation';

export function TimelinePanel({job}:{job:PreparationJob}){
 const timed=job.milestones.some(m=>m.reportReceivedAt!==null);
 return <Panel title="검증 단계 기록" subtitle="점 하나는 담당자가 보고한 단계 · 가로축은 보고 수신 시각" className="prep-timeline" actions={<span className="prep-panel-count">{job.milestones.length}개 보고</span>} footer={<><span>단계 사이의 지속 시간·전체 완료율은 추정하지 않습니다.</span><span>최근 단계 · {job.phaseLabel}</span></>}>
  {timed?<ChartFrame id={`prep-timeline-${job.id}`} label="보고 수신 시각별 검증 단계" option={timelineOption(job)}/>:<div className="plot-empty">수신 시각이 확인된 단계 보고가 없습니다.</div>}
 </Panel>;
}
export function ResourcesPanel({job,kind}:{job:PreparationJob;kind:'memory'|'disk'|'workload'}){
 const memory=kind==='memory',disk=kind==='disk';
 const count=memory?(['currentRssMiB','peakRssMiB','reportedRssMiB'] as const).reduce((n,key)=>n+sampleCount(job,key),0):sampleCount(job,disk?'freeGiB':'algorithmVisits');
 return <Panel title={memory?'메모리 보고':disk?'디스크 여유':'검사 작업량'} subtitle={memory?'현재값·최고값·종류 미확인을 구별':disk?'보고 시점의 사용 가능한 공간':'누적 알고리즘 방문 수 · 처리 행수와 다름'} className={`prep-resource prep-${kind}`} footer={<span>{memory?'측정 종류가 다른 값은 같은 선으로 잇지 않습니다.':disk?'점이 없는 구간의 상태는 알 수 없습니다.':'방문 수로 완료율이나 모델 성능을 계산하지 않습니다.'}</span>}>
  {count?<ChartFrame id={`prep-${kind}-${job.id}`} label={memory?'보고 시각별 메모리 사용량':disk?'보고 시각별 디스크 여유':'보고 시각별 알고리즘 방문 수'} option={memory?memoryOption(job):disk?diskOption(job):workloadOption(job)}/>:<div className="plot-empty">이 항목의 관측값은 아직 미보고입니다.</div>}
 </Panel>;
}
export function ReferencePanel({job}:{job:PreparationJob}){
 const available=job.counts!==null;
 return <Panel title="도착 관측 참조" subtitle={countScopeLabel(job)} className={`prep-references ${job.countScope==='INTERMEDIATE'?'intermediate':''}`} footer={<span>NULL·수집 상한 밖 참조를 0석이나 오답으로 바꾸지 않습니다.</span>}>
  <div className="prep-count-summary"><span>직접 그룹</span><strong>{number(job.counts?.groups)}</strong><small>{job.countScope==='INTERMEDIATE'?'미확정 중간 결과':job.countScope==='VERIFIED'?'검증 완료 보고':'완료 보고 없음'}</small></div>
  {available?<><ChartFrame id={`prep-references-${job.id}`} label="관측 키 연결·수집 상한 밖·NULL 행수 비교" option={referenceOption(job)}/><div className="prep-reference-detail"><span>관측 키 연결 <b>{number(job.counts?.matched)}</b></span><span>수집 상한 밖 <b>{number(job.counts?.aboveHighwater)}</b></span><span>참조 NULL <b>{number(job.counts?.nullRows)}</b></span></div></>:<div className="plot-empty">새 검증 결과가 확인되면 집계를 표시합니다.</div>}
 </Panel>;
}
export function ReportList({job}:{job:PreparationJob}){
 return <Panel title="수신한 단계 보고" subtitle="최근 보고 순 · 원시 행과 실행 명령은 공개하지 않음" className="prep-report-list">
  <div className="prep-report-rows">{job.milestones.slice(-8).reverse().map(m=><div key={m.id}><i className={`prep-state-dot ${m.state==='STOPPED'?'stopped':m.state==='COMPLETED'?'verified':'running'}`}/><strong>{m.label}</strong><time>{time(m.reportReceivedAt)}</time></div>)}</div>
 </Panel>;
}
