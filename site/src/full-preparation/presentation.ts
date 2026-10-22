import type { FullPhase, FullTrainingProgress, RecoveryProgress, RssMeasurementKind } from './types.ts';
import { FullPreparationReadError } from './errors.ts';

export const phaseLabel: Record<FullPhase, string> = {
  PREPARING_RESOURCE: '자원 준비', UPLOADING: '자료 전송', NORMALIZING: '원자료 정규화',
  BUILDING_DATASET: '학습 사례 구성', TRAINING: '학습', EVALUATING: '평가',
  STOPPED: '중단 보고', COMPLETE: '완료 보고',
};
export function count(value: number | null | undefined) {
  return value == null ? '미측정' : new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(value);
}
export function decimal(value: number | null | undefined, digits = 2) {
  if (value == null) return '미측정';
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: digits, ...(value > 0 && value < 10 ** -digits ? { maximumSignificantDigits: 3 } : {}) }).format(value);
}
export function percentage(value: number) { return `${decimal(value, 2)}%`; }
export function bytes(value: number | null | undefined) {
  if (value == null) return '미측정';
  if (value >= 1024 ** 3) return `${decimal(value / 1024 ** 3)} GiB`;
  if (value >= 1024 ** 2) return `${decimal(value / 1024 ** 2)} MiB`;
  if (value >= 1024) return `${decimal(value / 1024)} KiB`;
  return `${count(value)} B`;
}
export function usd(value: number | null | undefined) {
  if (value == null) return '미측정';
  return `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4, ...(value > 0 && value < .0001 ? { maximumSignificantDigits: 3 } : {}) }).format(value)}`;
}
export function clock(value: string | null | undefined) {
  return value == null ? '미제공' : new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(value)) + ' KST';
}
export function readErrorText(error: Error, hasPrevious: boolean) {
  if (hasPrevious) return '상태를 다시 읽지 못해 마지막 성공 자료를 표시합니다.';
  return error instanceof FullPreparationReadError && error.status === 404 ?
    '상태 파일이 아직 준비되지 않았습니다. HTTP 404 · 준비되면 자동으로 다시 확인합니다.' :
    '전체 자료 상태를 읽거나 검증하지 못했습니다. 상태 다시 읽기로 재시도할 수 있습니다.';
}

export const executionModeLabel = { SINGLE_PROCESS: '단일 프로세스', MULTI_PROCESS: '다중 프로세스' } as const;
export const partialVerificationLabel: Record<RecoveryProgress['partialVerificationStatus'], string> = {
  NOT_STARTED: '검증 미시작', VERIFYING: '검증 중', VERIFIED: '검증 완료', FAILED: '검증 실패', UNKNOWN: '검증 상태 미확인',
};
export function rssPresentation(value: FullTrainingProgress) {
  if (value.schema === 'full-training-progress/1') {
    return { label: '정규화 프로세스 최대 RSS', explanation: 'v1에 보고된 정규화 프로세스 최대값' };
  }
  const formats: Record<RssMeasurementKind, { label: string; explanation: string }> = {
    PROCESS_PEAK: { label: '단일 프로세스 최대 RSS', explanation: '한 프로세스의 최대 RSS입니다.' },
    AGGREGATE_SAMPLED_PEAK: { label: '동시 표본 합계 RSS 최대값', explanation: '같은 시점에 관측한 프로세스 RSS 합계의 최대값입니다. 표본 사이의 최고값은 놓칠 수 있습니다.' },
    PEAK_SUM_UPPER_BOUND: { label: '프로세스별 최대 RSS 합계 상한', explanation: '서로 다른 시점의 개별 최대값을 합친 상한입니다. 실제 동시 메모리 사용량이 아닙니다.' },
    UNMEASURED: { label: '정규화 RSS 미측정', explanation: '측정값과 측정 방식이 아직 보고되지 않았습니다.' },
  };
  return formats[value.resources.rssMeasurementKind];
}
