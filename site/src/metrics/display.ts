export type MetricKey = 'Brier' | 'MAE' | 'MSE' | 'NRPS' | 'ECE';
export type MetricMode = 'readable' | 'raw';

const base = {
  Brier: { label: 'Brier', title: '만석 확률 예측 오차', unit: '원값', explanation: '예측 확률과 실제 결과의 제곱오차입니다.' },
  MAE: { label: 'MAE', title: '평균 좌석 오차', unit: '석', explanation: '예측 잔여 좌석이 실제와 평균 몇 석 다른지 나타냅니다.' },
  MSE: { label: 'MSE', title: '좌석 제곱오차', unit: '석²', explanation: '큰 좌석 오차에 더 큰 벌점을 주는 제곱오차입니다.' },
  NRPS: { label: 'NRPS', title: '좌석 분포 예측 오차', unit: '원값', explanation: '정규화한 분포 예측 오차입니다. 제품 분포가 없으면 제품 비교값은 표시하지 않습니다.' },
  ECE: { label: 'ECE', title: '확률 보정 오차', unit: '원값', explanation: '예측 확률과 관측 빈도 사이의 보정 오차입니다. 미산출 값은 비워 둡니다.' },
} as const;

export function metricSpec(metric: MetricKey, mode: MetricMode) {
  if (mode === 'raw' || metric === 'MAE') return base[metric];
  switch (metric) {
    case 'Brier': return { ...base.Brier, unit: '×100만', explanation: '작은 제곱오차를 읽기 쉽게 원값의 1,000,000배로 표시합니다. 확률이나 정확도가 아닙니다.' };
    case 'MSE': return { label: 'RMSE', title: '큰 오차를 반영한 좌석 오차', unit: '석', explanation: 'MSE의 제곱근입니다. 큰 오차에 민감한 지표를 좌석 단위로 읽을 수 있습니다.' };
    case 'NRPS': return { ...base.NRPS, unit: '점', explanation: '원값 ×100으로 표시한 0–100 오차 척도입니다. 낮을수록 좋으며 정확도가 아닙니다.' };
    case 'ECE': return { ...base.ECE, unit: '%p', explanation: '원값 ×100을 퍼센트포인트(%p)로 표시한 확률 보정 오차입니다.' };
  }
}

// Transform only the presentation value. Callers keep the original report for
// provenance, comparison policy, selection and exact-value inspection.
export function displayValue(raw: number | null | undefined, metric: MetricKey, mode: MetricMode): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  if (mode === 'raw') return raw;
  const converted = metric === 'Brier' ? raw * 1_000_000
    : metric === 'MSE' ? raw < 0 ? NaN : Math.sqrt(raw)
    : metric === 'NRPS' || metric === 'ECE' ? raw * 100 : raw;
  return Number.isFinite(converted) ? converted : null;
}

export function formatDisplayNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  // Keep distinct axis steps and preserve small nonzero values without e-notation.
  return new Intl.NumberFormat('ko-KR', {
    maximumSignificantDigits: 8,
  }).format(value);
}

export function rawMetricText(raw: number | null | undefined): string {
  return raw == null || !Number.isFinite(raw) ? '미산출' : String(raw);
}

export function formatMetric(raw: number | null | undefined, metric: MetricKey, mode: MetricMode, withUnit = false): string {
  const value = displayValue(raw, metric, mode);
  if (value === null) return '—';
  const absolute = Math.abs(value);
  const formatted = value === 0 ? '0' : mode === 'raw'
    ? new Intl.NumberFormat('ko-KR', { maximumSignificantDigits: 7 }).format(value)
    : absolute >= 1
      ? new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
      : new Intl.NumberFormat('ko-KR', { maximumSignificantDigits: 3 }).format(value);
  return withUnit ? `${formatted} ${metricSpec(metric, mode).unit}` : formatted;
}

export function metricTooltip(raw: number | null | undefined, metric: MetricKey, mode: MetricMode): string {
  if (raw == null || !Number.isFinite(raw)) return `${metricSpec(metric, mode).label} 미산출`;
  const spec = metricSpec(metric, mode);
  return `${spec.label} ${formatMetric(raw, metric, mode, true)}\n원값 ${metric}: ${rawMetricText(raw)}\n${spec.explanation}`;
}
