import type { FullDepthSweep } from './types.ts';
import { activeDepthRounds, depthContrasts, depthEvaluationProgress } from './project.ts';
import { clock, count, depthLabel, percent, phaseLabel, producerStatusLabel, seatDelta, seatScore, shortSha, statusLabel } from './presentation.ts';

export function DepthSweepContent({ data }: { data: FullDepthSweep }) {
  const rounds = activeDepthRounds(data), evaluation = depthEvaluationProgress(data), contrasts = depthContrasts(data);
  return <>
    <div className="full-learning-batch-state"><strong className={data.phase.toLowerCase()}>{phaseLabel[data.phase]}</strong><span>새 후보 검수 완료 {count(data.verifiedCandidateCount)} / 3</span><span>학습 호출 예약 {count(data.trainingCallsReserved)} / 3 · 완료 횟수 아님</span>{data.producerStatus && <span className="depth-producer-status"><code>{data.producerStatus}</code> {producerStatusLabel[data.producerStatus]}</span>}<p>{data.statusDetail}</p></div>
    <div className="depth-prior-attempt"><span>이전 시도 {data.priorAttempt.runId}</span><strong>환경 복원 단계에서 중단 · 새 fit {data.priorAttempt.freshFits}회 · 공개 점수 없음 · 미승인</strong><small>이번 {data.runId} 결과와 합치지 않습니다. 실패 기록은 별도로 보존합니다.</small></div>
    {data.phase === 'TRAINING' && rounds && <div className="full-learning-batch-track"><div><span>{depthLabel[rounds.id]} · 처음부터 새로 학습</span><strong>현재 후보 관측 {count(rounds.observed)} / {count(rounds.target)}라운드</strong></div>
      <progress key={rounds.id} value={rounds.observed} max={rounds.target} aria-label={`${depthLabel[rounds.id]} 라운드 관측`} aria-valuetext={`현재 후보 ${rounds.observed} / ${rounds.target}라운드`}/>
      <p>후보마다 0라운드에서 시작합니다. 다른 후보의 라운드를 현재 후보에 이어 붙이지 않습니다.</p></div>}
    {evaluation && <div className="full-learning-batch-track"><div><span>전체 DEV 채점 처리 행</span><strong>{count(evaluation.observed)} / {count(evaluation.total)}</strong></div>
      <progress value={evaluation.observed} max={evaluation.total} aria-label="전체 DEV 채점 처리 행"/>
      <p>채점 처리량과 최종 점수 검수 완료는 별도 상태입니다.</p></div>}
    <div className="depth-control-note"><strong>새 depth 6 = 깊이 대조군(depth control).</strong> 순수 깊이 비교는 새 학습 D4 / D6 / D8 사이에서만 성립합니다. 기존 B256은 이어 학습한 참조 모델이므로 B256 대비 쌍은 학습 경로까지 다르며 순수 depth 비교가 아닙니다.</div>
    <div className="full-learning-batch-table"><table><thead><tr><th>모델 / 학습 방식</th><th>깊이</th><th>관측 / 목표 라운드</th><th>보고 상태</th><th>평균 좌석 오차 MAE · 석</th><th>RMSE · 석</th><th>재사용 DEV 기준</th></tr></thead><tbody>{data.models.map(model => <tr key={model.id} className={data.candidate === model.id ? 'active' : data.bestObservedDevModel === model.id ? 'selected' : ''}>
      <td>{depthLabel[model.id]}<small>{model.trainingMode === 'CONTINUED_REFERENCE' ? '기존 이어학습 참조 · 새 fit 0회 · 대조군 아님' : model.depth === 6 ? '0부터 새 학습 · 256라운드 · 깊이 대조군' : '0부터 새 학습 · 256라운드'}</small></td><td>{model.depth}</td><td>{count(model.observedRounds)} / {count(model.targetRounds)}</td><td>{statusLabel[model.status] ?? model.status}</td>
      <td title={model.metrics ? `원값 MAE ${model.metrics.MAE}` : undefined}>{seatScore(model, 'MAE')}</td><td title={model.metrics ? `원값 RMSE ${model.metrics.RMSE} · MSE ${model.metrics.MSE}` : undefined}>{seatScore(model, 'RMSE')}</td>
      <td>{model.id === 'BASELINE' ? '비교 기준' : model.gatePassed === null ? '미확정' : model.gatePassed ? '개발 기준 충족' : '개발 기준 미충족'}</td>
    </tr>)}</tbody></table></div>
    {contrasts && <div className="full-learning-batch-table depth-contrast"><table><caption>검수된 점수의 쌍 비교 · 석 차이는 후보 − 기준, 상대 개선율은 기준 MAE 대비 감소 비율(%)</caption><thead><tr><th>새 후보</th><th>MAE · 석</th><th>새 D6 대조군 대비 · 순수 깊이 비교</th><th>기존 B256 대비 · 순수 깊이 비교 아님</th></tr></thead><tbody>{contrasts.map(row => <tr key={row.id} className={row.isControl ? 'control' : ''}>
      <td>{depthLabel[row.id]}</td><td>{seatScore(data.models.find(model => model.id === row.id)!, 'MAE')}</td>
      <td>{row.vsFreshControl ? <>{seatDelta(row.vsFreshControl.seatDelta)} <small>상대 개선율 {percent(row.vsFreshControl.relativeImprovementPct)}</small></> : <>대조군 자체<small>비교 기준 0</small></>}</td>
      <td>{seatDelta(row.vsContinuedReference.seatDelta)} <small>상대 개선율 {percent(row.vsContinuedReference.relativeImprovementPct)} · 학습 경로 차이 포함</small></td>
    </tr>)}</tbody></table></div>}
    <div className="full-learning-batch-notes"><p>고정 TRAIN {count(data.trainRows)}행 · DEV {count(data.devRows)}행 · 보고된 새 학습 총 라운드 {count(data.freshRoundsCompleted)} / 768</p>
      <p>MAE는 예측 잔여 좌석이 실제와 평균 몇 석 다른지, RMSE는 큰 오차를 반영한 좌석 단위 오차입니다. 후보 점수는 최종 완료 근거 검수 후에 표시합니다.</p>
      {data.bestObservedDevModel && <p><strong>재사용 DEV 기준상 탐색 선택: {depthLabel[data.bestObservedDevModel]}</strong> · 모델 채택 아님 · 일반화 주장 아님</p>}
      <p className="depth-claims"><span>DEV 재사용</span><span>H 지정(10/22) 전 산출 · 현재 H 4일 포함</span><span>채택 없음</span><span>일반화 주장 없음</span><span>제품 비교 미연결</span><span>이전 실패 실행 미승인 유지</span></p>
      {data.phase === 'FAILED' && <p>{data.terminal ? '실패 종료 정리가 보고됐습니다.' : '실패 보고 후 작업 정리 확인을 기다립니다.'}</p>}
    </div>
    <details><summary>정확한 원값 · 수신 핀 · 관측 시각</summary>{data.models.filter(model => model.metrics).map(model => <p key={model.id}>{depthLabel[model.id]} · MAE {model.metrics!.MAE} · RMSE {model.metrics!.RMSE} · MSE {model.metrics!.MSE}</p>)}<p>Brier·logLoss·NRPS는 미산출입니다. 보고 worker 경과 시간 {data.workerElapsedSeconds === null ? '미보고' : `${data.workerElapsedSeconds.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}초`} · 생산자 보고 {clock(data.sourceReportedAt)}</p><p>producer receipt.json {shortSha(data.receiptSha256)} · complete.json {shortSha(data.completeSha256)} · 완료 전에는 핀 없음</p></details>
    <footer>상태 자료 작성 {clock(data.servedAt)} · 5초마다 읽기 전용 확인 · 조회 시각은 worker heartbeat가 아님 · {data.runId} · {data.schema}</footer>
  </>;
}
