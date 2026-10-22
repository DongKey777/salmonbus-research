import type { Catalog, TrialStatus } from './types.ts';
import { formatNumber, formatScore, shortId, statusLabel } from './presentation.ts';

export function TrialTable({ catalog, selectedId, page, status, busy, onSelect, onStatus, onPrevious, onNext }: {
  catalog: Catalog | undefined;
  selectedId: string | null;
  page: number;
  status: TrialStatus | '';
  busy: boolean;
  onSelect: (id: string) => void;
  onStatus: (status: TrialStatus | '') => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return <section className="history-panel history-trials" aria-label="개선 기록 목록">
    <header className="history-panel-head">
      <div><h2>개선 기록</h2><p>고정 스냅샷 · 최신순 · 한 페이지 최대 100건</p></div>
      <label className="history-status-filter">상태
        <select value={status} onChange={event => onStatus(event.target.value as TrialStatus | '')}>
          <option value="">모든 상태</option>
          {Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
    </header>
    <div className="history-table-scroll" aria-busy={busy}>
      <table>
        <thead><tr><th scope="col">기록 / 평가</th><th scope="col">모델 ID</th><th scope="col">Brier ↓</th><th scope="col">NRPS ↓</th><th scope="col">MAE ↓</th><th scope="col">ECE10 ↓</th><th scope="col">상태 / 숫자</th></tr></thead>
        <tbody>{catalog?.rows.map(trial => <tr key={trial.trialId} className={selectedId === trial.trialId ? 'selected' : ''}>
          <td><button className="history-trial-select" aria-pressed={selectedId === trial.trialId} onClick={() => onSelect(trial.trialId)}>
            <b>#{formatNumber(trial.trialOrdinal)}</b><span>{trial.role === 'BASELINE' ? '기준' : trial.role === 'REEVALUATION' ? '재평가' : '후보'} · {trial.trialId}</span>
          </button><small title={trial.evaluationId}>{shortId(trial.evaluationId, 12)}</small></td>
          <td><button className="history-model-select" title={`${trial.modelId}\nrevision: ${trial.modelRevisionRef}`} onClick={() => onSelect(trial.trialId)}>
            {shortId(trial.modelId, 13)}<small>rev {shortId(trial.modelRevisionRef, 8)}</small>
          </button></td>
          <td className="history-primary-score">{formatScore(trial.metrics.Brier)}</td>
          <td>{formatScore(trial.metrics.NRPS, 'NRPS')}</td>
          <td>{formatScore(trial.metrics.MAE, 'MAE')}</td>
          <td>{formatScore(trial.metrics.ECE, 'ECE')}</td>
          <td><span className={`history-status is-${trial.status.toLowerCase()}`}>{statusLabel[trial.status]}</span><small>{trial.numericValidity === 'DEFINED' ? '유효 숫자' : trial.numericValidity === 'NULL' ? '미산출' : trial.numericValidity === 'INVALID' ? '숫자 무효' : '미등록'}</small></td>
        </tr>)}</tbody>
      </table>
      {!catalog && <div className="history-empty">{busy ? '고정 스냅샷에서 기록을 읽고 있습니다.' : '기록을 읽지 못했습니다. 다시 읽기를 눌러 주세요.'}</div>}
      {catalog?.rows.length === 0 && <div className="history-empty">선택한 비교 그룹과 상태에 해당하는 기록이 없습니다.</div>}
    </div>
    <footer className="history-table-foot">
      <span>{formatNumber(catalog?.rows.length)}건 표시 · 페이지 {page + 1}</span>
      <div><button disabled={busy || page === 0} onClick={onPrevious}>← 이전</button><button disabled={busy || !catalog?.page.hasMore} onClick={onNext}>다음 →</button></div>
    </footer>
  </section>;
}
