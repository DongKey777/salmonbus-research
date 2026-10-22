import { formatMetric, rawMetricText } from '../metrics/display.ts';
import type { FullModelValidation } from './types.ts';
export const count = (value: number) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(value);
export function seatScores(data: FullModelValidation) {
  return { mae: formatMetric(data.metrics.MAE, 'MAE', 'readable', true), rmse: formatMetric(data.metrics.MSE, 'MSE', 'readable', true), rawMAE: rawMetricText(data.metrics.MAE), rawRMSE: rawMetricText(data.metrics.RMSE), rawMSE: rawMetricText(data.metrics.MSE) };
}
export function observedTime(value: string) { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)) + ' KST'; }
