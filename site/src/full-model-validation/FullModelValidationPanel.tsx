import { useFullModelValidation } from './connection.ts';
import { count, observedTime, seatScores } from './presentation.ts';
import './full-model-validation.css';

export function FullModelValidationPanel() {
  const query = useFullModelValidation(), data = query.data;
  const scores = data ? seatScores(data) : null;
  return <section className="full-model-validation" aria-label="전체 자료 저장 체크포인트 검증">
    <header><div><span>SAVED MODEL · FULL DEV VALIDATION</span><h2>{data ? '저장 모델 · 전체 DEV 평가 완료' : '저장 모델 · 전체 DEV 평가'}</h2></div><button onClick={() => void query.refetch()} disabled={query.isFetching}>↻ 검증 결과 다시 읽기</button></header>
    {query.error && <p className="full-model-validation-error" role="alert">{data ? '결과를 다시 읽지 못해 마지막 성공 자료를 표시합니다.' : query.error.message.endsWith('HTTP_404') ? '저장된 검증 결과가 아직 게시되지 않았습니다.' : '저장된 검증 결과를 읽거나 확인하지 못했습니다.'} <code>{query.error.message}</code></p>}
    {!data || !scores ? <p className="full-model-validation-pending">공개된 검증 결과를 확인합니다. 미게시 점수는 대신 만들지 않습니다.</p> : <>
      <div className="full-model-validation-status"><span>저장 체크포인트 검증 {count(data.model.validatedSavedCheckpoints)}건 완료</span><span>원 GPU 실행 실패 · 미승인 유지</span><span>추가 학습 {count(data.validation.additionalTrainingRuns)}회</span></div>
      <div className="full-model-validation-grid">
        <div><span>평균 좌석 오차 · MAE</span><strong title={`원값 MAE ${scores.rawMAE} 석`}>{scores.mae}</strong><p>예측 잔여좌석과 정답 간 절대 차이의 평균</p></div>
        <div><span>큰 오차를 반영한 좌석 오차 · RMSE</span><strong title={`원값 RMSE ${scores.rawRMSE} 석 · MSE ${scores.rawMSE} 석²`}>{scores.rmse}</strong><p>좌석 단위 오차이며 정확도 퍼센트가 아닙니다.</p></div>
        <div><span>고정 자료 범위 · SEAT {count(data.model.rounds)}라운드</span><strong className="full-model-validation-cohort">TRAIN {count(data.dataset.trainRows)}<br/>DEV {count(data.dataset.devRows)}</strong><p>DEV 전체 {count(data.dataset.arrivalGroups)}개 도착 그룹 · 그룹마다 동일 가중치</p></div>
      </div>
      <p className="full-model-validation-note">GPU 실행에서 저장한 체크포인트를 CPU 기준으로 전체 DEV에 별도 채점했습니다. 기존 P1 평가와 별개이며 제품 비교는 연결되지 않았습니다.</p>
      <div className="full-model-validation-boundaries"><span>만석 확률 모델 미시작 · Brier/NRPS 미산출</span><span>H 지정(10/22) 전 산출 · 현재 H 4일 포함 · 일반화 주장 없음</span><span>제품 대비 개선: 아직 비교 전 · 채택: 미채택</span><span>{data.compute.status === 'RELEASED' ? '해당 이전 실행 GPU 중지 · 저장공간 유지' : '해당 이전 실행 GPU 중지 확인 대기'} · 결과 보존</span></div>
      <details><summary>재현 검증 범위 · 정확한 원값 · 불변 참조</summary><div className="full-model-validation-detail">
        <div><h3>저장·재로드 검증</h3><p>CPU 저장·재로드 예측이 DEV {count(data.validation.cpuSaveReloadExactRows)}행 전체에서 정확히 일치했습니다. 불일치 {count(data.validation.cpuSaveReloadMismatches)}행.</p><p>원 GPU/CPU 허용오차 초과 {count(data.validation.originalCrossBackendToleranceViolations)}행 중 {count(data.validation.violatingRowsNumericallyExplained)}행의 수치 차이를 설명했습니다. 전체 행의 routing replay를 검증했다는 뜻은 아닙니다. 원 학습 heap 비교도 수행되지 않았습니다.</p><p>채점 완료 및 결과 소비 확인 참조가 등록됐습니다. 원 학습 실행의 FAILED 상태와 미승인은 유지합니다.</p></div>
        <dl><div><dt>MAE 원값 · 석</dt><dd>{scores.rawMAE}</dd></div><div><dt>RMSE 원값 · 석</dt><dd>{scores.rawRMSE}</dd></div><div><dt>MSE 원값 · 석²</dt><dd>{scores.rawMSE}</dd></div><div><dt>가중치 합</dt><dd>{count(data.dataset.weightSum)}</dd></div></dl>
      </div><dl className="full-model-validation-pins">{Object.entries(data.provenance).map(([key, value]) => <div key={key}><dt>{key}</dt><dd><code>{value}</code></dd></div>)}</dl></details>
      <footer>저장 검증 결과 관측 {observedTime(data.observedAt)} · 실행 heartbeat 아님 · {data.sourceKind}</footer>
    </>}
  </section>;
}
