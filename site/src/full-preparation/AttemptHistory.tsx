import type { FullTrainingProgress } from './types.ts';
import { count, decimal, executionModeLabel } from './presentation.ts';

export function AttemptHistory({ data }: { data: FullTrainingProgress }) {
  if (data.schema === 'full-training-progress/1') return null;
  return <div className="full-preparation-attempts" aria-label="전체 자료 실행 시도">
    <div className="full-preparation-current-attempt">
      <span>현재 시도 <code>{data.currentAttempt.id}</code></span>
      <strong>{executionModeLabel[data.currentAttempt.executionMode]} · worker {data.currentAttempt.workerCount}개</strong>
    </div>
    <p>{data.currentAttempt.reason}</p>
    <p>{data.recovery ?
      '위 원자료 범위는 검증 완료된 재사용량과 이번 새 처리량의 합계입니다. 자원 측정은 현재 시도에 속합니다.' :
      '위 정규화 수치와 자원 측정은 현재 시도에 속합니다. 이전 시도의 처리 행을 더하지 않습니다.'}</p>
    {data.previousAttempts.length > 0 && <details>
      <summary>이전 종료 시도 {data.previousAttempts.length}건</summary>
      <div className="full-preparation-attempt-table"><table>
        <thead><tr><th>시도 / 종료 사유</th><th>상태</th><th>확정 파일</th><th>확정 원자료 행</th><th>경과 시간</th></tr></thead>
        <tbody>{data.previousAttempts.map(attempt => <tr key={attempt.id}>
          <td><code>{attempt.id}</code><p>{attempt.reason}</p></td>
          <td>{attempt.status === 'STOPPED' ? '중단 보고' : '완료 보고'}</td>
          <td>{count(attempt.committedSourceFiles)}</td><td>{count(attempt.committedRows)}</td>
          <td>{attempt.elapsedSeconds === null ? '미측정' : `${decimal(attempt.elapsedSeconds)}초`}</td>
        </tr>)}</tbody>
      </table></div>
    </details>}
  </div>;
}
