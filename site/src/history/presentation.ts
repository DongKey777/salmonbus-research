import type { Metric, MetricState, TrialStatus } from './types.ts';

export const metricInfo: Record<Metric, { label: string; description: string; color: string; digits: number }> = {
  Brier: { label: 'Brier', description: '만석 확률 예측 오차', color: '#32988f', digits: 5 },
  NRPS: { label: 'NRPS', description: '좌석 분포 오차', color: '#4d8fb8', digits: 5 },
  MAE: { label: 'MAE', description: '잔여 좌석 오차 · 좌석', color: '#cf725b', digits: 3 },
  ECE: { label: 'ECE10', description: '확률 보정 진단 · 고정 10구간', color: '#8b72be', digits: 5 },
};
export const statusLabel: Record<TrialStatus, string> = {
  FINISHED: '완료', FAILED: '실패', HELD: '보류', RUNNING: '진행 중',
};
export const metricStateLabel: Record<MetricState, string> = {
  VALID: '유효', NULL: '미산출', INVALID: '유효하지 않음', UNREGISTERED: '미등록',
};
export function formatNumber(value: number | null | undefined, digits = 0) {
  return value == null ? '—' : new Intl.NumberFormat('ko-KR', { maximumFractionDigits: digits }).format(value);
}
export function formatScore(value: number | null | undefined, metric: Metric = 'Brier') {
  return value == null ? '—' : value.toFixed(metricInfo[metric].digits);
}
export function shortId(value: string | null | undefined, length = 14) {
  if (!value) return '—';
  return value.length > length + 6 ? `${value.slice(0, length)}…${value.slice(-5)}` : value;
}
export function formatTime(value: string | undefined) {
  return value ? new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(value)) : '—';
}
