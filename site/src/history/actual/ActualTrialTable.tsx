import { formatNumber, shortId, statusLabel } from '../presentation.ts';
import type { TrialStatus } from '../types.ts';
import { ACTUAL_METRICS } from './types.ts';
import type { CatalogResponse } from './types.ts';
import { decisionText } from './presentation.ts';
import { MetricUnitControl, useMetricMode } from '../../metrics/MetricPresentation';
import { formatMetric, metricSpec, metricTooltip } from '../../metrics/display.ts';

export function ActualTrialTable({ catalog, selectedId, page, status, busy, onSelect, onStatus, onPrevious, onNext }: {
  catalog: CatalogResponse['data'] | undefined; selectedId: string | null; page: number; status: TrialStatus | ''; busy: boolean;
  onSelect: (id: string) => void; onStatus: (value: TrialStatus | '') => void; onPrevious: () => void; onNext: () => void;
}) {
  const { mode: metricMode } = useMetricMode();
  return <section className="history-panel history-trials" aria-label="실제 모델과 평가 목록"><header className="history-panel-head"><div><h2>실제 후보 평가</h2><p>후보만 표시 · 당시 제품 예보는 별도 외부 기준 · 최대 100건</p></div><label className="history-status-filter">상태<select value={status} onChange={event => onStatus(event.target.value as TrialStatus | '')}><option value="">모든 상태</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></header>
    <div className="history-actual-table-unit-control"><MetricUnitControl/></div>
    <div className="history-table-scroll" aria-busy={busy}><table><thead><tr><th>후보 / 모델</th>{ACTUAL_METRICS.map(metric => {
      const spec = metricSpec(metric, metricMode);
      return <th key={metric} title={spec.explanation}>{spec.label}{spec.unit && <small className="history-metric-unit">{spec.unit}</small>}</th>;
    })}<th>MAIN</th><th>AUX</th><th>V행 / 그룹</th><th>상태</th></tr></thead><tbody>{catalog?.rows.map(trial => <tr key={trial.trialId} className={selectedId === trial.trialId ? 'selected' : ''}>
      <td><button className="history-trial-select" onClick={() => onSelect(trial.trialId)} aria-pressed={selectedId === trial.trialId}><b>#{trial.trialOrdinal}</b><span>{trial.candidateId}</span></button><button className="history-model-select" onClick={() => onSelect(trial.trialId)} title={`${trial.modelId}\n${trial.modelRevisionRef}`}>{shortId(trial.modelId, 14)}<small>rev {shortId(trial.modelRevisionRef, 9)} · 시도 {trial.cycleIndex}</small></button></td>
      {ACTUAL_METRICS.map(metric => <td key={metric} title={metricTooltip(trial.metrics[metric], metric, metricMode)} className={metric === 'Brier' ? 'history-primary-score' : ''}>{formatMetric(trial.metrics[metric], metric, metricMode)}</td>)}
      <td>{decisionText(trial.decisions.MAIN)}</td><td>{decisionText(trial.decisions.AUX)}</td><td>{formatNumber(trial.support.rows)} / {formatNumber(trial.support.groups)}</td><td>{statusLabel[trial.status]}</td>
    </tr>)}</tbody></table>{!catalog && <div className="history-empty">{busy ? '고정 스냅샷의 실제 후보를 읽고 있습니다.' : '등록된 실제 후보가 없습니다.'}</div>}{catalog?.rows.length === 0 && <div className="history-empty">이 비교 그룹과 상태에 해당하는 실제 후보가 없습니다.</div>}</div>
    <footer className="history-table-foot"><span>{formatNumber(catalog?.rows.length)}건 · 페이지 {page + 1} · 전역 순번과 실행 내 시도 구분</span><div><button disabled={busy || page === 0} onClick={onPrevious}>← 이전</button><button disabled={busy || !catalog?.page.hasMore} onClick={onNext}>다음 →</button></div></footer>
  </section>;
}
