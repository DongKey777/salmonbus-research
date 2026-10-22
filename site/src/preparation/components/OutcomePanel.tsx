import {CircleAlert,ShieldCheck} from 'lucide-react';
import type {PreparationJob} from '../types';
import {Panel} from '../../ui/Panel';
import {number} from '../presentation';

export function OutcomePanel({job}:{job:PreparationJob}){
 const verified=job.status==='VERIFIED';
 return <Panel title="검증 상태" subtitle="실행 종료와 검증 통과는 별도로 확인" className="prep-outcome" footer={<span>모델 성능 개선이나 학습 적격 판정이 아닙니다.</span>}>
  <div className={`prep-outcome-main ${verified?'verified':job.status==='STOPPED'?'stopped':''}`}>
   {verified?<ShieldCheck size={20}/>:<CircleAlert size={20}/>}
   <strong>{verified?'독립 감사 완료 보고':job.status==='STOPPED'?'최종 완료로 채택하지 않음':'최종 검증 결과 대기'}</strong>
   <p>{verified?'확인된 감사 범위만 다음 검토의 근거로 남깁니다.':job.status==='STOPPED'?'중간 결과를 보존했습니다. 실패한 실행의 완료 상태를 바꾸지 않습니다.':'작업 보고를 수신 중입니다. 완료 근거가 확인되기 전에는 통과로 표시하지 않습니다.'}</p>
  </div>
  {job.failureCode&&<div className="prep-failure"><span>중단 코드</span><code>{job.failureCode}</code></div>}
  <dl className="prep-limits"><div><dt>시간 한도</dt><dd>{number(job.limits.wallSeconds===null?null:job.limits.wallSeconds/60)}<small>분</small></dd></div>
   <div><dt>최고 메모리 한도</dt><dd>{number(job.limits.rssMiB)}<small>MiB</small></dd></div>
   <div><dt>새 공간 한도</dt><dd>{number(job.limits.newGiB,2)}<small>GiB</small></dd></div>
   <div><dt>프로세스</dt><dd>{number(job.limits.processes)}<small>개</small></dd></div></dl>
 </Panel>;
}
