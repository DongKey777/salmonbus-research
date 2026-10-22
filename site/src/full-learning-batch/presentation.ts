import { formatMetric } from '../metrics/display.ts';
import type { BatchPhase, BatchModel, ModelId } from './types.ts';
export const phaseLabel: Record<BatchPhase, string> = {
  WAITING: '시작 보고 대기', BUILDING_MATRIX: '학습 입력 구성 중', TRAINING: '추가 학습 중',
  EVALUATING: '전체 DEV 평가·검수 중', COMPLETE: '배치 검수 완료', FAILED: '실패 보고',
};
export const modelLabel: Record<ModelId, string> = { BASELINE: '저장 기준', A: '후보 A', B: '후보 B' };
export const statusLabel: Record<BatchModel['status'], string> = {
  VALIDATED_SAVED_REFERENCE: '검증된 저장 기준', NOT_OBSERVED: '관측 자료 없음', BUILDING_MATRIX: '입력 구성',
  TRAINING: '학습 중', EVALUATING: '평가 중 · 검수 전', FINALIZING: '완료 근거 검수 전', COMPLETE: '완료 보고 · 검수 전',
  VERIFIED: '점수 검수 완료', SKIPPED: 'A 기준 미충족 · 생략', TRAINED_NOT_ACCEPTED: '라운드 도달 · 검수 전', PROGRESS_OBSERVED: '진행 관측 · 검수 전',
};
export const count = (value: number | null) => value === null ? '미보고' : new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(value);
export function score(model: BatchModel, metric: 'MAE' | 'RMSE') {
  if (!model.metrics) return '미등록';
  return metric === 'MAE' ? formatMetric(model.metrics.MAE, 'MAE', 'readable', true) : formatMetric(model.metrics.MSE, 'MSE', 'readable', true);
}
export function clock(value: string | null) {
  return value === null ? '미제공' : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)) + ' KST';
}
