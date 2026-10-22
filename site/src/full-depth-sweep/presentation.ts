import { formatMetric } from '../metrics/display.ts';
import type { DepthModel, DepthModelId, FullDepthSweep } from './types.ts';
export const depthLabel: Record<DepthModelId, string> = { BASELINE: '기존 B256 기준 (이어학습)', D4: '새 depth 4', D6: '새 depth 6 (대조군)', D8: '새 depth 8' };
export const phaseLabel: Record<FullDepthSweep['phase'], string> = { WAITING: '시작 보고 대기', BUILDING_MATRIX: '학습 입력 구성 중', TRAINING: '새 후보 학습 중', EVALUATING: '전체 DEV 평가·검수 중', COMPLETE: '깊이 비교 검수 완료', FAILED: '실패 보고' };
export const producerStatusLabel: Record<NonNullable<FullDepthSweep['producerStatus']>, string> = {
  FRESH_DEPTH_SWEEP_AND_DEV_VERIFIED_NOT_ADOPTED: '새 학습 3회 · DEV 검수 완료 · 채택 아님',
  FAILED_PRESERVED_NOT_ACCEPTED: '실패 기록 보존 · 미승인',
};
export const statusLabel: Record<DepthModel['status'], string> = {
  VALIDATED_SAVED_REFERENCE: '검증된 이어학습 기준',
  NOT_OBSERVED: '관측 자료 없음', BUILDING_MATRIX: '입력 구성', TRAINING: '학습 중', EVALUATING: '평가 중 · 검수 전',
  FINALIZING: '완료 근거 검수 전', COMPLETE: '완료 보고 · 검수 전', VERIFIED: '점수 검수 완료',
  TRAINED_NOT_EVALUATED: '학습 라운드 완료 · 평가 전', PROGRESS_OBSERVED: '진행 관측 · 검수 전',
};
export const count = (value: number | null) => value === null ? '미보고' : new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(value);
export function seatScore(model: DepthModel, metric: 'MAE' | 'RMSE') {
  if (!model.metrics) return '미등록';
  return metric === 'MAE' ? formatMetric(model.metrics.MAE, 'MAE', 'readable', true) : formatMetric(model.metrics.MSE, 'MSE', 'readable', true);
}
const signedNumber = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' });
export function seatDelta(value: number) { return `${signedNumber.format(value)} 석`; }
export function percent(value: number | null) { return value === null ? '기준 0 · 미산출' : `${signedNumber.format(value)}%`; }
export function shortSha(value: string | null) { return value === null ? '미제공' : value.slice(0, 12); }
export function clock(value: string | null) {
  return value === null ? '미제공' : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)) + ' KST';
}
