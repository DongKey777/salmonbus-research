import { useMemo, useState } from 'react';
import { ResearchNav } from '../ui/ResearchNav';
import { PUBLIC_SITE, SITE_MARK } from '../site/env.ts';
import { ChartFrame } from '../ui/ChartFrame';
import { Panel } from '../ui/Panel';
import { useActualCycles } from './connection.ts';
import { runKey } from './contract.ts';
import { chartGroup, metricValue, referenceValue, selectedCycle, verifiedRows, workflow } from './project.ts';
import { deltaTrend, metricTrend, resourcesTrend } from './charts.ts';
import { decisionLabel, number, phases, short, statusLabel, time } from './presentation.ts';
import { METRICS } from './types.ts';
import { EvidencePanel } from './EvidencePanel';
import { MetricUnitControl, MetricValue, useMetricMode } from '../metrics/MetricPresentation';
import { metricSpec } from '../metrics/display.ts';
import { FullPreparationPanel } from '../full-preparation/FullPreparationPanel';
import { FullModelValidationPanel } from '../full-model-validation/FullModelValidationPanel';
import { FullLearningBatchPanel } from '../full-learning-batch/FullLearningBatchPanel';
import { FullDepthSweepPanel } from '../full-depth-sweep/FullDepthSweepPanel';
import { RouteReportPanel } from '../route-report/RouteReportPanel';
import { FeaturesV2Panel } from '../features-v2/FeaturesV2Panel';
import { AutoloopPanel } from '../autoloop/AutoloopPanel';
import { ModelRegistryPanel } from '../model-registry/ModelRegistryPanel';
import './actualcycles.css';

export default function ActualCyclesApp() {
  const { mode } = useMetricMode();
  const query = useActualCycles(), snapshot = query.data;
  const [selectedRunKey, selectRun] = useState<string | null>(null);
  const [cycleId, selectCycle] = useState<string | null>(null);
  const [referenceSelected, selectReference] = useState(false);
  const runs = snapshot?.runs ?? [];
  const run = runs.find(item => runKey(item) === selectedRunKey) ?? runs.filter(item => item.sourceKind === 'REAL_OBSERVATION_EXECUTION').at(-1) ?? runs.at(-1);
  const cycle = run ? selectedCycle(run, cycleId) : undefined;
  const group = useMemo(() => run ? chartGroup(run) : null, [run]);
  const options = useMemo(() => group ? {
    Brier: metricTrend(group, 'Brier', cycle?.cycleId ?? null, true, mode), MAE: metricTrend(group, 'MAE', cycle?.cycleId ?? null, false, mode),
    MSE: metricTrend(group, 'MSE', cycle?.cycleId ?? null, false, mode), NRPS: metricTrend(group, 'NRPS', cycle?.cycleId ?? null, false, mode),
    delta: deltaTrend(group, mode), resources: resourcesTrend(group),
  } : null, [group, cycle?.cycleId, mode]);
  const actual = run?.sourceKind === 'REAL_OBSERVATION_EXECUTION';
  const rows = verifiedRows(referenceSelected ? undefined : cycle);
  const last = run?.events.at(-1);
  const referenceSupport = run?.baseline?.report.numericSupport === 'DEFINED' ? run.baseline.report.support : null;
  const chooseCycle = (id: string) => { if (run?.cycles.some(item => item.cycleId === id)) { selectCycle(id); selectReference(false); } };
  return <div className="actual-app">
    <a className="skip" href="#actual-workbench">실자료 반복 평가로 이동</a>
    <header className="topbar"><div className="wordmark"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 14h4l3-8 4 13 3-8h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg><b>salmonbus</b><span>/</span><strong>Research</strong></div><ResearchNav active="actual-cycles"/><span className="actual-local">{SITE_MARK}</span></header>
    <div className={`actual-sourcebar ${run && !actual ? 'fixture' : ''}`}><strong>{run ? actual ? '실제 관측 반복 실행' : 'ARTIFICIAL · 인공 통신 검증 자료 · 실제 실행 아님' : '실자료 반복 실행 연결 대기'}</strong><span>선언된 사건 시점 재현 · 당시 제품 예보와 새 후보 5회 비교</span><code>{run?.sourceKind ?? 'NO_REGISTERED_RUN'}</code></div>
    <div className="actual-shell"><aside className="actual-sidebar"><div className="actual-sidebar-heading"><h2>실행 이력</h2><span>{runs.length}</span></div>
      <div className="actual-run-list">{[...runs].reverse().map(item => <button key={runKey(item)} className={run && runKey(item) === runKey(run) ? 'selected' : ''} onClick={() => { selectRun(runKey(item)); selectCycle(null); selectReference(false); }}>
        <span>{item.sourceKind === 'REAL_OBSERVATION_EXECUTION' ? '실제 관측' : '인공 통신 예시'} <i className={`actual-state-dot ${item.status.toLowerCase()}`}/></span>
        <b title={item.runId}>{short(item.runId, 22)}</b><small>{short(item.attemptId, 16)} · {item.counts.completedCycles}/5회</small><em>{statusLabel[item.status]}</em>
      </button>)}</div>
      {!runs.length && <p className="actual-sidebar-empty">등록된 실행이 없습니다.</p>}
      <div className="actual-sidebar-foot"><span>읽기 전용 관제</span><p>실패·보류 이력을 보존합니다. 기준 제품 예보는 새 모델 수에 포함하지 않습니다.</p></div>
    </aside>
    <main id="actual-workbench" className="actual-workbench">
      <div className="actual-heading"><div><p>REAL OBSERVATION RESEARCH</p><h1>실자료 연구 현황 <span>전체 자료 학습·평가 · 최신 결과부터</span></h1></div><div className="actual-actions"><span className={query.error ? 'error' : ''}><i/>{query.error ? '읽기 오류' : query.streamState === 'static' ? '저장 사본' : query.streamState === 'connected' ? '실행 장부 연결' : '2초 조회'}</span><button disabled={query.isFetching} onClick={() => void query.refetch()}>↻ 다시 읽기</button></div></div>
      <AutoloopPanel/>
      <FeaturesV2Panel/>
      <FullDepthSweepPanel/>
      <ModelRegistryPanel/>
      <FullLearningBatchPanel/>
      <FullModelValidationPanel/>
      <RouteReportPanel/>
      <details className="actual-archived-record"><summary>이전 기록 · 최초 전체 자료 GPU 실행 상태(2026-10-21 05:15 KST 작성) · 현재 상태 아님</summary><p>이 기록 뒤로 저장 모델 검증, 추가 학습 2회, 깊이 비교 3회가 실제로 끝났습니다. 위 패널들이 최신 결과입니다.</p><FullPreparationPanel/></details>
      <h2 className="actual-section-divider">소규모 P1 실자료 5회 비교 <span>2026-10-20 · 전체 자료 학습과 별개 실험</span></h2>
      {query.error && <div className="actual-error" role="alert"><div><strong>{snapshot ? '새 자료를 검증하지 못해 마지막 성공 응답을 표시합니다.' : '실행 장부를 읽지 못했습니다.'}</strong><span>조회 오류가 모델 실행 상태를 변경하지 않습니다.</span></div><details><summary>오류 코드</summary><code>{query.error.message}</code></details></div>}
      {query.resyncs > 0 && <div className="actual-resync" role="status">서버 세대가 바뀌어 새 스냅샷으로 다시 동기화했습니다.</div>}
      {run && group && options ? <>
        <div className="actual-run-context"><span className={`actual-run-status ${run.status.toLowerCase()}`}>{statusLabel[run.status]}</span><span>{phases[run.phase]}</span><code title={run.sourceGenerationId}>소스 세대 {short(run.sourceGenerationId, 18)}</code><span>모델 검증 <b>{run.counts.modelVerifications}/5</b></span><span>성적 등록 <b>{run.counts.registeredCandidateScores}/5</b></span>{run.terminalReason && <span className="actual-terminal">{run.terminalReason}</span>}</div>
        <div className="actual-five-track" aria-label="새 모델 5회 실행 절차">{Array.from({ length: 5 }, (_, index) => {
          const item = run.cycles.find(value => value.cycleIndex === index + 1);
          return <button key={index} disabled={!item} className={`${item?.status === 'COMPLETED' ? 'completed' : item?.status === 'FAILED' ? 'failed' : item ? 'started' : ''} ${!referenceSelected && cycle?.cycleId === item?.cycleId && item ? 'selected' : ''}`} onClick={() => item && chooseCycle(item.cycleId)}>
            <span>{index + 1}</span><div><b>새 후보 {index + 1}</b><small>{item ? phases[item.phase] : '미예약'}</small></div><em>{item?.status === 'COMPLETED' ? '절차 완료' : item?.status === 'HELD' ? '보류' : item?.status === 'FAILED' ? '실패' : item ? '진행' : '—'}</em>
          </button>;
        })}</div>
        <div className="actual-completion-note">{run.counts.completedCycles === 5 ? '같은 검증 자료에서 5회 비교를 마쳤습니다. 실행 완료가 성능 개선·일반화·채택을 의미하지는 않습니다.' : '같은 검증 자료에서 후보를 반복 비교합니다. 개발 기준 충족은 채택 결정이 아닙니다.'}</div>
        <MetricUnitControl/>
        <div className="actual-reference-row"><button className={`actual-reference ${referenceSelected ? 'selected' : ''}`} disabled={!run.baseline} onClick={() => selectReference(true)}>
          <span>고정 외부 기준</span><strong>당시 제품 예보</strong><small>HISTORICAL_PRODUCT_REFERENCE · 신규 fit 없음</small><b>Brier <MetricValue value={referenceValue(group, 'Brier')} metric="Brier" withUnit/></b>
        </button><div className="actual-population"><span>{referenceSelected ? '외부 제품 기준 평가' : '선택 모델 검증된 입력 수'}</span><div>{referenceSelected ? <b>평가 V {number(run.baseline?.report.support.rows)}</b> : <><b>T {number(rows.trainingRows)}</b><b>예측 V {number(rows.predictionRows)}</b></>}</div><small>{referenceSelected ? '제품 예보 기준 · 신규 학습 T 없음' : cycle?.model.state === 'VERIFIED' ? '모델 receipt가 보고한 실제 처리 건수' : '검증 전 · 계획 한도를 실제 건수로 표시하지 않음'}</small></div><div className="actual-clock"><span>마지막 소스 발생 <b>{time(last?.occurredAt)} KST</b></span><span>마지막 수신 <b>{time(last?.receivedAt)} KST</b></span><small>응답 시각은 진행 신호가 아닙니다.</small></div></div>
        {referenceSupport && <div className="actual-completion-note" role="status">정답 그룹 {number(referenceSupport.groups)}개 · 만석 {number(referenceSupport.fullGroups)}개 · 비만석 {number(referenceSupport.nonFullGroups)}개. 같은 정답을 공유하는 질문은 한 그룹의 가중치를 나눠 가집니다.{referenceSupport.fullGroups === 0 ? ' 만석 정답이 없어 이번 자료만으로 만석을 찾아내는 성능을 판단할 수 없습니다.' : referenceSupport.nonFullGroups === 0 ? ' 비만석 정답이 없어 이번 자료만으로 비만석을 구분하는 성능을 판단할 수 없습니다.' : ''}</div>}
        <details className="actual-group"><summary>동일 비교 조건 <code>{short(run.comparisonGroup.groupRef, 18)}</code><span>dataset · split · weight · scorer · MAIN/AUX 정책 고정</span></summary><dl>{Object.entries(run.comparisonGroup).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></details>
        <div className="actual-chart-grid">
          <Panel title="만석 확률 예측 오차" subtitle={`Brier · ${metricSpec('Brier', mode).unit} · 낮을수록 유리 · 당시 제품 예보와 비교`} className="actual-brier"
            footer={<><span>회색 점선: 고정 외부 제품 기준 · 공백: 미등록·무효·미산출</span><span>동일 비교 그룹</span></>}>
            <ChartFrame id="actual-brier" label="실제 관측 새 후보 다섯 번의 Brier와 당시 제품 예보" option={options.Brier} onPick={chooseCycle}/>
          </Panel>
          <Panel title="제품 기준 대비 Brier 차이" subtitle={`제품 − 후보 · ${metricSpec('Brier', mode).unit} · 양수면 오차가 작음`} className="actual-delta"
            footer={<span>개발 점수 차이 · 채택·일반화 주장 없음</span>}><ChartFrame id="actual-delta" label="당시 제품 예보 대비 후보 Brier 차이" option={options.delta}/></Panel>
          {(['MAE', 'MSE', 'NRPS'] as const).map(metric => <Panel key={metric} title={metricSpec(metric, mode).title} subtitle={`${metricSpec(metric, mode).label} · ${metricSpec(metric, mode).unit} · ${metric === 'NRPS' ? mode === 'readable' ? '0–100 오차 척도 · 낮을수록 유리' : '모델 자체 진단 · 제품 분포 없음' : '당시 제품 예보 고정 기준'}`} className="actual-small-chart"
            footer={<span>{metric === 'NRPS' ? '제품 PMF·NRPS를 구성하지 않습니다.' : '좌석 오차 · 낮을수록 유리'}</span>}>
            <ChartFrame id={`actual-${metric.toLowerCase()}`} label={`새 후보별 ${metricSpec(metric, mode).label}`} option={options[metric]} onPick={chooseCycle}/>
          </Panel>)}
          <Panel title="모델 작업 자원" subtitle={actual ? 'producer가 보고한 완료 작업 측정값' : '인공 측정 예시 · 실제 자원 사용량 아님'} className="actual-small-chart"
            footer={<span>CPU·벽시계 시간·최고 RSS · 현재 RSS 미계측</span>}><ChartFrame id="actual-resources" label="모델 작업별 보고 CPU 벽시계 최고 RSS" option={options.resources}/></Panel>
        </div>
        <div className="actual-selection-heading"><h2>{referenceSelected ? '당시 제품 예보 선택됨' : cycle ? `시도 ${cycle.cycleIndex} 처리 절차` : '새 후보 등록 대기'}</h2><span>ECE <MetricValue value={metricValue(cycle?.report, 'ECE', group.group.groupRef)} metric="ECE" withUnit/> · 미산출 값은 0으로 바꾸지 않음</span></div>
        {!referenceSelected && <div className="actual-workflow">{workflow(run, cycle).map(stage => <div key={stage.kind} className={stage.done ? 'done' : ''}><i/>{stage.label}</div>)}</div>}
        <section className="actual-results" aria-label="후보별 실행 상태와 개발 판정"><header><h2>후보별 실행과 판정</h2><span>완료 여부 · 주 판정 Brier · 보조 판정 MAE/MSE 원값 기준</span></header><div className="actual-table-scroll"><table><thead><tr><th>새 후보</th>{METRICS.map(metric => <th key={metric} title={metricSpec(metric, mode).explanation}>{metricSpec(metric, mode).label}<small className="actual-metric-unit">{metricSpec(metric, mode).unit}</small></th>)}<th>검증 T / 예측 V</th><th>실행 상태</th><th>주 판정</th><th>보조 판정</th></tr></thead><tbody>{run.cycles.map(item => <tr key={item.cycleId} className={!referenceSelected && cycle?.cycleId === item.cycleId ? 'selected' : ''}><td><button onClick={() => chooseCycle(item.cycleId)}><b>시도 {item.cycleIndex}</b><small>{item.candidateId}</small></button></td>{METRICS.map(metric => <td key={metric}><MetricValue value={metricValue(item.report, metric, group.group.groupRef)} metric={metric}/></td>)}<td>{number(verifiedRows(item).trainingRows)} / {number(verifiedRows(item).predictionRows)}</td><td>{statusLabel[item.status]}<small>{phases[item.phase]}</small></td><td>{decisionLabel(item.mainDecision)}</td><td>{decisionLabel(item.auxDecision)}</td></tr>)}</tbody></table></div>{!run.cycles.length && <p className="actual-inline-empty">새 모델 작업이 아직 예약되지 않았습니다.</p>}</section>
        <EvidencePanel run={run} cycle={cycle} reference={referenceSelected ? run.baseline : null}/>
        <div className="actual-claims"><span>H 봉인 없음</span><span>일반화 성능 주장 없음</span><span>채택 없음</span><span>당시 커밋 가용성 미검증</span><span>수신기는 원본 아티팩트를 직접 검증하지 않음</span></div>
      </> : <section className="actual-empty"><svg width="38" height="38" viewBox="0 0 38 38" fill="none" aria-hidden="true"><path d="M7 6h24v27H7zM13 13h12M13 19h12M13 25h7" stroke="currentColor" strokeWidth="1.4"/></svg><h2>등록된 실자료 반복 실행이 없습니다.</h2><p>당시 제품 예보가 외부 기준으로 등록되고, 새 후보의 모델 검증과 독립 채점이 끝나면 그래프가 채워집니다.</p><span>현재 실제 T/V 건수·모델 성적·개발 판정을 표시하지 않습니다.</span></section>}
      <footer className="actual-footer"><span>{PUBLIC_SITE ? '공개 사본 · 배포할 때 저장한 실행 장부 · 소스 세대별 기록 유지' : '읽기 전용 · 2초 조회 + 사건 무효화 알림 · 소스 세대별 기록 유지'}</span><span>응답 {time(snapshot?.servedAt)} KST · 마지막 수신 {time(snapshot?.lastReceivedAt)} KST</span></footer>
    </main></div>
  </div>;
}
