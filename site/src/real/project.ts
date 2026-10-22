import type { ComparedMetric, ComparisonPoint, RealPilotSummary } from './types.ts';

export const PILOT_COLORS = { model: '#32988f', productRaw: '#94a3b8', productFinal: '#6488b8', product: '#6488b8', diagnostic: '#8b72be' } as const;
export function comparedPoints(summary: RealPilotSummary, metric: ComparedMetric): ComparisonPoint[] {
  const scores = summary.metrics;
  if (metric === 'Brier') return [
    { label: '기준 모델', value: scores.modelBrier, color: PILOT_COLORS.model },
    { label: '제품 raw', value: scores.productRawBrier, color: PILOT_COLORS.productRaw },
    { label: '제품 final', value: scores.productFinalBrier, color: PILOT_COLORS.productFinal },
  ];
  return [
    { label: '기준 모델', value: metric === 'MAE' ? scores.modelMAE : scores.modelMSE, color: PILOT_COLORS.model },
    { label: '제품 예보', value: metric === 'MAE' ? scores.productMAE : scores.productMSE, color: PILOT_COLORS.product },
  ];
}
/** Product NRPS is unavailable: it never becomes zero, a second bar, or an inferred PMF. */
export function diagnosticPoints(summary: RealPilotSummary): ComparisonPoint[] {
  return [{ label: '기준 모델만', value: summary.metrics.modelNRPS, color: PILOT_COLORS.diagnostic }];
}
