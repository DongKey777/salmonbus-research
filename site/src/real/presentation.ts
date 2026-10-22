import type { IdentityKey } from './types.ts';

export function score(value: number | null, digits = 5) {
  if (value === null) return '미제공';
  if (value === 0) return '0';
  // Preserve small nonzero scores instead of displaying them as a perfect zero.
  return Math.abs(value) < 10 ** -digits ? value.toExponential(3) : value.toFixed(digits);
}
export function resultTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(value));
}
export const identityLabels: Record<IdentityKey, string> = {
  manifestSha256: '평가 manifest',
  modelReceiptSha256: '모델 실행 receipt',
  modelHash: '모델 신원',
  inputHash: '입력 자료',
  inputContractHash: '입력 계약',
  splitProofHash: 'T/V 분할 근거',
  recipeHash: '모델 recipe',
  scoringContractHash: '채점 계약',
  sourceDatasetSha256: '실제 관측 원본 dataset',
};
