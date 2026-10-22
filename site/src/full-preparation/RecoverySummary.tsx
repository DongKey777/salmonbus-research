import type { FullTrainingProgress } from './types.ts';
import { recoveryCoverage } from './project.ts';
import { count, partialVerificationLabel } from './presentation.ts';

export function RecoverySummary({ data }: { data: FullTrainingProgress }) {
  const recovery = recoveryCoverage(data);
  if (!recovery) return null;
  return <section className="full-preparation-recovery" aria-label="복구 검증 범위와 새 처리량">
    <header><span>이전 완료 자료 복구</span><strong>{partialVerificationLabel[recovery.partialVerificationStatus]}</strong></header>
    <p>재사용 출처 <code>{recovery.sourceAttemptId}</code> · 부분 아티팩트 검증을 통과한 범위만 재사용량에 포함합니다.</p>
    <dl>
      <div><dt>재사용 검증 완료</dt><dd>{count(recovery.reusedSourceFiles)} 파일 · {count(recovery.reusedRows)} 원자료 행</dd></div>
      <div><dt>이번 시도 새 처리</dt><dd>{count(recovery.freshSourceFiles)} 파일 · {count(recovery.freshRows)} 원자료 행</dd></div>
      <div><dt>총 검증 완료 범위</dt><dd>{count(recovery.coveredSourceFiles)} / {count(recovery.totalSourceFiles)} 파일 · {count(recovery.coveredRows)} / {count(recovery.totalRows)} 원자료 행</dd></div>
    </dl>
    <p>재사용 검증량의 증가는 새 처리속도에 포함하지 않습니다. 이전 중단 시도의 공개 관측량은 그대로 보존합니다.</p>
  </section>;
}
