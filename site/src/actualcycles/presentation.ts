import type { Decision, EventKind, Metric, Status } from './types.ts';
export const metricInfo: Record<Metric, { title: string; label: string; color: string; unit: string }> = {
  Brier: { title: '만석 확률 예측 오차', label: 'Brier', color: '#32988f', unit: 'Brier' },
  MAE: { title: '잔여 좌석 절대 오차', label: 'MAE', color: '#cf725b', unit: '좌석' },
  MSE: { title: '잔여 좌석 제곱 오차', label: 'MSE', color: '#4d8fb8', unit: '좌석²' },
  NRPS: { title: '모델 자체 분포 진단', label: 'NRPS', color: '#8b72be', unit: 'NRPS' },
  ECE: { title: '확률 보정 진단', label: 'ECE', color: '#b38a42', unit: 'ECE' },
};
export function number(value: number | null | undefined) {
  return value == null ? '—' : new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(value);
}
export function score(value: number | null | undefined, digits = 5) {
  if (value == null) return '—';
  if (value === 0) return '0';
  return Math.abs(value) < Math.max(0.001, 10 ** -digits) ? value.toExponential(3) : value.toFixed(digits);
}
export function axisTick(value: number) {
  if (value === 0) return '0';
  const rounded = Number(value.toPrecision(8));
  return Math.abs(value) < 0.001 ? rounded.toExponential() : String(rounded);
}
export function short(value: string | null | undefined, size = 12) {
  return value ? value.length > size + 5 ? `${value.slice(0, size)}…${value.slice(-4)}` : value : '—';
}
export function time(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)) : '—';
}
export const statusLabel: Record<Status, string> = { IN_PROGRESS: '진행 중', COMPLETED: '실행 절차 완료', HELD: '보류', FAILED: '실행 실패' };
export const phases: Record<EventKind, string> = {
  RUN_STARTED: '실행 시작', REFERENCE_REGISTERED: '당시 제품 예보 등록', MODEL_RESERVED: '모델 작업 예약', MODEL_STARTED: '모델 실행 중',
  MODEL_VERIFIED: '모델 결과 검증', SCORE_REGISTERED: '성적 등록', MAIN_DECISION_COMMITTED: '주 판정 확정',
  AUX_DECISION_COMMITTED: '보조 판정 확정', PROPOSAL_SEALED: '다음 제안 확정', PROPOSAL_CONSUMED: '다음 실험에 반영',
  CYCLE_COMPLETED: '실험 절차 완료', RUN_COMPLETED: '5회 실행 절차 완료', RUN_HELD: '실행 보류', RUN_FAILED: '실행 실패',
};
export function decisionLabel(decision: Decision | null | undefined) {
  return !decision ? '판정 대기' : decision.validity === 'INVALID' ? '판정 무효' :
    decision.outcome === 'MET' ? '개발 기준 충족' : decision.outcome === 'NOT_MET' ? '개발 기준 미달' : '근거 부족';
}
