import { useFullLearningBatch } from './connection.ts';
import { activeRounds } from './project.ts';
import { clock, count, modelLabel, phaseLabel, score, statusLabel } from './presentation.ts';
import './full-learning-batch.css';

export function FullLearningBatchPanel() {
  const query = useFullLearningBatch(), data = query.data;
  const rounds = data ? activeRounds(data) : null;
  return <section className="full-learning-batch" aria-label="전체 자료 추가 학습 배치">
    <header><div><span>FULL DATA · CONTINUED SEAT TRAINING</span><h2>전체 자료 추가 학습 · 기준 64 → A 128 → 조건부 B 256</h2></div><button onClick={() => void query.refetch()} disabled={query.isFetching}>↻ 배치 상태 다시 읽기</button></header>
    {query.error && <div role="alert" className="full-learning-batch-error">{data ? '최신 상태를 읽지 못해 마지막 성공 자료를 표시합니다.' : query.error.message.endsWith('HTTP_404') ? '추가 학습 상태 파일이 아직 게시되지 않았습니다. 시작 여부와 점수는 미확인입니다.' : '추가 학습 상태를 읽거나 검증하지 못했습니다.'}<code>{query.error.message}</code></div>}
    {!data ? <p className="full-learning-batch-pending">공개된 배치 상태를 기다립니다. 목표 라운드와 예약 호출은 완료한 학습량으로 표시하지 않습니다.</p> : <>
      <div className="full-learning-batch-state"><strong className={data.phase.toLowerCase()}>{phaseLabel[data.phase]}</strong><span>새 후보 검수 완료 {count(data.verifiedCandidateCount)} / 2</span><span>학습 호출 예약 {count(data.trainingCallsReserved)} / 2 · 완료 횟수 아님</span><p>{data.statusDetail}</p></div>
      {rounds && <div className="full-learning-batch-track"><div><span>{modelLabel[rounds.id]} · 관측 총 {count(rounds.observedTotal)} / 목표 {count(rounds.targetTotal)}라운드</span><strong>추가 관측 {count(rounds.observedAdditional)} / {count(rounds.targetAdditional)}라운드</strong></div>
        <progress value={rounds.observedAdditional} max={rounds.targetAdditional} aria-label={`${modelLabel[rounds.id]} 추가 라운드 관측`} aria-valuetext={`기존 ${rounds.parentRounds}라운드를 제외한 추가 관측 ${rounds.observedAdditional} / ${rounds.targetAdditional}`}/>
        <p>보고된 모델 총 라운드에는 기존 {count(rounds.parentRounds)}라운드가 포함됩니다. 관측 콜백의 값이며 최종 점수 검수와 구분합니다.</p></div>}
      <div className="full-learning-batch-table"><table><thead><tr><th>모델</th><th>목표 / 관측 총 라운드</th><th>보고 상태</th><th>MAE · 석</th><th>RMSE · 석</th><th>고정 DEV 기준</th></tr></thead><tbody>{data.models.map(model => <tr key={model.id} className={data.candidate === model.id ? 'active' : data.bestObservedDevModel === model.id ? 'selected' : ''}>
        <td>{modelLabel[model.id]}<small>{model.id === 'BASELINE' ? '저장 기준 · 새 학습 아님' : model.id === 'A' ? '기준 모델에서 +64라운드' : 'A 조건 충족 때만 +128라운드'}</small></td>
        <td>{count(model.targetRounds)} / {count(model.observedRounds)}</td><td>{statusLabel[model.status]}</td>
        <td title={model.metrics ? `원값 MAE ${model.metrics.MAE}` : undefined}>{score(model, 'MAE')}</td>
        <td title={model.metrics ? `원값 RMSE ${model.metrics.RMSE} · MSE ${model.metrics.MSE}` : undefined}>{score(model, 'RMSE')}</td>
        <td>{model.id === 'BASELINE' ? '비교 기준' : model.gatePassed === null ? '미확정' : model.gatePassed ? '개발 기준 충족' : '개발 기준 미충족'}</td>
      </tr>)}</tbody></table></div>
      <div className="full-learning-batch-notes"><p>고정 TRAIN {count(data.trainRows)}행 · DEV {count(data.devRows)}행 전체를 사용합니다. MAE는 절대 좌석 오차의 평균, RMSE는 큰 오차를 반영한 좌석 단위 오차입니다.</p>
        <p>개발 기준: 저장 기준보다 MAE가 엄격히 작고 RMSE가 커지지 않아야 합니다. 후보 A가 충족할 때만 후보 B를 진행합니다.</p>
        {data.bestObservedDevModel && <p><strong>재사용 DEV 기준상 선택: {modelLabel[data.bestObservedDevModel]}</strong> · 모델 채택 아님</p>}
        <p>DEV 반복 사용 · H 지정(10/22) 전 산출 · 현재 H 4일 포함 · 일반화 주장 없음 · 미채택 · 제품 비교 미연결 · 기존 실패 실행의 미승인 유지</p>
        {data.phase === 'FAILED' && <p>{data.terminal ? '실패 종료 정리가 보고됐습니다.' : '실패 보고 후 자식 작업 정리 확인을 기다립니다.'}</p>}
      </div>
      <details><summary>점수 공개 조건 · 원값 · 보고 시각</summary><p>후보 점수는 완료·수신 근거와 저장된 채점 결과의 검수가 끝난 경우에만 표시합니다. 기준 모델 64라운드는 기존 저장 모델이며 새 학습 후보 수에 포함하지 않습니다. Brier·logLoss·NRPS는 미산출입니다.</p>
        {data.models.filter(model => model.metrics).map(model => <p key={model.id}>{modelLabel[model.id]} 원값 · MAE {model.metrics!.MAE} · RMSE {model.metrics!.RMSE} · MSE {model.metrics!.MSE}</p>)}
        <p>보고 worker 경과 시간 {data.workerElapsedSeconds === null ? '미보고' : `${data.workerElapsedSeconds.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}초`} · 생산자 보고 {clock(data.sourceReportedAt)}</p></details>
      <footer>상태 자료 작성 {clock(data.servedAt)} · 5초마다 읽기 전용 확인 · 조회 시각은 worker heartbeat가 아님 · {data.runId}</footer>
    </>}
  </section>;
}
