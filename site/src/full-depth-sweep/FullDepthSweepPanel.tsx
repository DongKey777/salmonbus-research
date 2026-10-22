import { useFullDepthSweep } from './connection.ts';
import { DepthSweepContent } from './DepthSweepContent.tsx';
import './full-depth-sweep.css';

export function FullDepthSweepPanel() {
  const query = useFullDepthSweep(), data = query.data;
  return <section className="full-learning-batch full-depth-sweep" aria-label="전체 자료 새 학습 깊이 비교 SEAT_DEPTH_SWEEP_002">
    <header><div><span>FULL DATA · FRESH DEPTH COMPARISON</span><h2>새 학습 깊이 비교 · depth 4 / 6 / 8 · SEAT_DEPTH_SWEEP_002</h2></div><button onClick={() => void query.refetch()} disabled={query.isFetching}>↻ 깊이 비교 다시 읽기</button></header>
    {query.error && <div role="alert" className="full-learning-batch-error">{data ? '최신 상태를 읽지 못해 마지막 성공 자료를 표시합니다.' : query.error.message.endsWith('HTTP_404') ? 'SEAT_DEPTH_SWEEP_002 상태 파일이 아직 게시되지 않았습니다. 실행 여부와 점수는 미확인입니다. 이전 SEAT_DEPTH_SWEEP_001은 학습 전 중단(fit 0)으로 기록돼 있습니다.' : '깊이 비교 상태를 읽거나 검증하지 못했습니다.'}<code>{query.error.message}</code></div>}
    {data ? <DepthSweepContent data={data}/> : <p className="full-learning-batch-pending">공개된 깊이 비교 상태를 기다립니다. 목표 라운드와 예약 호출을 완료한 학습량으로 대신 표시하지 않습니다.</p>}
  </section>;
}
