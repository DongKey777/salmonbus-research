import type { ActualMetric, ActualTrial } from './types.ts';
export const metricInfo: Record<ActualMetric, { label: string; title: string; color: string; digits: number }> = {
  Brier: { label: 'Brier', title: '만석 확률 예측 오차', color: '#32988f', digits: 5 },
  MAE: { label: 'MAE', title: '잔여 좌석 절대 오차 · 좌석', color: '#cf725b', digits: 3 },
  MSE: { label: 'MSE', title: '잔여 좌석 제곱 오차 · 좌석²', color: '#4d8fb8', digits: 3 },
  NRPS: { label: 'NRPS', title: '모델 자체 분포 진단', color: '#8b72be', digits: 5 },
  ECE: { label: 'ECE', title: '보정 진단 · 현재 미제공', color: '#b38a42', digits: 5 },
};
export function actualScore(value: number | null | undefined, metric: ActualMetric = 'Brier', axis = false) {
  if (value == null) return '—';
  if (value === 0) return '0';
  if (axis) return actualAxisTick(value);
  const digits = axis ? 5 : metricInfo[metric].digits;
  return Math.abs(value) < .001 ? value.toExponential(3) : value.toFixed(digits);
}
export function actualAxisTick(value: number) {
  if (value === 0) return '0';
  const significant = Number(value.toPrecision(8));
  return Math.abs(significant) < .001 ? significant.toExponential() : String(significant);
}
/** Resource telemetry is not a metric and never participates in display-unit conversion. */
export function resourceNumber(value: number | null | undefined) {
  if (value == null) return '—';
  if (value === 0) return '0';
  return Math.abs(value) < .001 ? value.toExponential(3) : value.toFixed(3);
}
export function decisionText(decision: ActualTrial['decisions']['MAIN'] | undefined) {
  return !decision ? '—' : decision.validity === 'INVALID' ? '판정 무효' :
    decision.outcome === 'MET' ? '개발 기준 충족' : decision.outcome === 'NOT_MET' ? '개발 기준 미달' : '근거 부족';
}
