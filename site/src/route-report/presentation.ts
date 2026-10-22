import { formatMetric } from '../metrics/display.ts';
export const count = (value: number | null) => value === null ? '미보고' : new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(value);
export const seats = (value: number | null, metric: 'MAE' | 'MSE') => value === null ? '미산출' : formatMetric(value, metric, 'readable', true);
const signedNumber = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' });
export const seatDelta = (value: number | null) => value === null ? '—' : `${signedNumber.format(value)} 석`;
export const percent = (value: number | null) => value === null ? '—' : `${signedNumber.format(value)}%`;
export const share = (value: number) => `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(value * 100)}%`;
export const shortToken = (token: string) => token.slice(0, 8);
export const modeLabel = { CONTINUED_REFERENCE: '이어학습 참조', FRESH_FROM_ZERO: '0부터 새 학습' } as const;
export function clock(value: string | null) {
  return value === null ? '미제공' : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)) + ' KST';
}
