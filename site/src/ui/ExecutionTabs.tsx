import './execution-tabs.css';
import {viewUrl} from '../site/env.ts';

/** Navigation only. Reading either view must never launch or resume a job. */
export function ExecutionTabs({active}:{active:'journal'|'runtime'}){
 return <nav className="execution-tabs" aria-label="실행 기록 보기">
  <a href={viewUrl('observer')} className={active==='journal'?'current':''} aria-current={active==='journal'?'page':undefined}>등록 장부</a>
  <a href={viewUrl('runtime')} className={active==='runtime'?'current':''} aria-current={active==='runtime'?'page':undefined}>실행 상태</a>
 </nav>;
}
