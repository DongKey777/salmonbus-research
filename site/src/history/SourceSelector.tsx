import type { HistorySourceMode } from './source.ts';

export function SourceSelector({ source, onChange }: { source: HistorySourceMode; onChange: (source: HistorySourceMode) => void }) {
  return <div className="history-source-selector" aria-label="연구 이력 자료 선택">
    <span>이력 자료</span><div>
      <button className={source === 'actual' ? 'active' : ''} aria-pressed={source === 'actual'} onClick={() => onChange('actual')}>실제 연구</button>
      <button className={source === 'fixture' ? 'active fixture' : 'fixture'} aria-pressed={source === 'fixture'} onClick={() => onChange('fixture')}>ARTIFICIAL · 인공 부하 검증</button>
    </div><small>{source === 'actual' ? '실제 연구 기록 · 인공 자료로 자동 전환하지 않음' : '10,000건 메타데이터 시험 · 실제 10,000회 학습 아님'}</small>
  </div>;
}
