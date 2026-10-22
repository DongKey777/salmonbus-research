import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import type { MetricMode, MetricKey } from './display.ts';
import { formatMetric, metricSpec, metricTooltip } from './display.ts';
import './metric-presentation.css';

const storageKey = 'salmonbus.metric-presentation.v1';
const Context = createContext<{ mode: MetricMode; setMode: (mode: MetricMode) => void }>({ mode: 'readable', setMode: () => {} });

export function MetricPresentationProvider({ children }: { children: ReactNode }) {
  const [mode, update] = useState<MetricMode>(() => {
    try { return localStorage.getItem(storageKey) === 'raw' ? 'raw' : 'readable'; } catch { return 'readable'; }
  });
  const setMode = (next: MetricMode) => {
    update(next);
    try { localStorage.setItem(storageKey, next); } catch { /* The display also works without persistent storage. */ }
  };
  return <Context.Provider value={{ mode, setMode }}>{children}</Context.Provider>;
}

export function useMetricMode() { return useContext(Context); }

export function MetricUnitControl() {
  const { mode, setMode } = useMetricMode();
  return <section className="metric-unit-control" aria-label="지표 숫자 표시">
    <div className="metric-unit-choice"><strong>숫자 표시</strong><div role="group" aria-label="지표 표시 단위">
      <button type="button" aria-pressed={mode === 'readable'} onClick={() => setMode('readable')}>읽기 쉬운 단위</button>
      <button type="button" aria-pressed={mode === 'raw'} onClick={() => setMode('raw')}>원값</button>
    </div></div>
    <p>{mode === 'readable'
      ? 'Brier ×100만 · MSE → RMSE(석) · NRPS 0–100 오차 척도 · ECE %p'
      : '원래 Brier · MAE · MSE · NRPS · ECE 값과 단위를 표시합니다.'}</p>
    <details><summary>단위 설명</summary><div className="metric-unit-explanation">
      <p>모든 오차 지표는 낮을수록 좋습니다. 표시 환산은 원본 점수·순위·판정을 바꾸지 않습니다. 원값은 전환 버튼과 숫자의 설명에서 확인할 수 있습니다.</p>
      <dl>{(['Brier', 'MAE', 'MSE', 'NRPS', 'ECE'] as const).map(metric => {
        const spec = metricSpec(metric, mode);
        return <div key={metric}><dt>{spec.label} · {spec.unit}</dt><dd>{spec.explanation}</dd></div>;
      })}</dl>
    </div></details>
  </section>;
}

export function MetricValue({ value, metric, withUnit = false }: {
  value: number | null | undefined; metric: MetricKey; withUnit?: boolean;
}) {
  const { mode } = useMetricMode();
  return <span title={metricTooltip(value, metric, mode)}>{formatMetric(value, metric, mode, withUnit)}</span>;
}
