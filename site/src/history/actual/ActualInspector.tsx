import { useState } from 'react';
import { formatNumber, shortId } from '../presentation.ts';
import { ACTUAL_METRICS } from './types.ts';
import type { ActualEvaluation, ActualGroup, ActualModel, ActualReference, ActualTrial } from './types.ts';
import { decisionText, resourceNumber } from './presentation.ts';
import { useMetricMode } from '../../metrics/MetricPresentation';
import { formatMetric, metricSpec, metricTooltip } from '../../metrics/display.ts';

function Pin({ name, value }: { name: string; value: string | number | null | undefined }) {
  const [copied, setCopied] = useState(false);
  return <div className="history-identity"><dt>{name}</dt><dd><code>{value == null ? '미제공' : String(value)}</code>{value != null && <button aria-label={`${name} 복사`} onClick={() => {
    void navigator.clipboard.writeText(String(value)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => setCopied(false));
  }}>{copied ? '복사됨' : '복사'}</button>}</dd></div>;
}
const pinSections = [
  { label: '모델 상태 · 예측 · restore · receipt', match: /model|prediction|restore/i },
  { label: '코드 archive · recipe · registry', match: /code|recipe|registry|^producerRef$/i },
  { label: '학습·예보 입력 · 특성 · 분할', match: /input|feature|split|dataset/i },
  { label: '가중치 · scorer · 판정 정책', match: /weight|scor|policy/i },
  { label: '작업 · 예약 · template', match: /task|reservation/i },
];
export function ActualInspector({ trial, evaluation, model, reference, inspectReference, group, loading, error, onFocus }: {
  trial: ActualTrial | undefined; evaluation: ActualEvaluation | undefined; model: ActualModel | undefined;
  reference: ActualReference | undefined; inspectReference: boolean; group: ActualGroup | undefined;
  loading: boolean; error: boolean; onFocus: (ordinal: number) => void;
}) {
  const { mode: metricMode } = useMetricMode();
  const metrics = inspectReference ? reference?.metrics : trial?.metrics;
  return <aside className="history-panel history-inspector history-actual-inspector" aria-label="실제 모델과 평가 신원">
    <header className="history-panel-head"><div><h2>{inspectReference ? '당시 제품 예보 · 외부 기준' : '선택한 실제 후보'}</h2><p>{inspectReference ? '모델 ID·revision 없음 · 새 fit 아님' : '불변 모델 revision과 평가 revision을 구분합니다.'}</p></div><span className="history-inspector-mark">READ ONLY</span></header>
    {error && <div className="history-inline-error" role="alert">상세 조회 실패 · 같은 신원의 마지막 성공 응답이 있으면 유지합니다.</div>}
    {metrics ? <>
      <div className="history-selected-heading"><div><span>{inspectReference ? 'EXTERNAL REFERENCE' : 'ACTUAL CANDIDATE'}</span><h3>{inspectReference ? '제품 예보' : `#${formatNumber(trial?.trialOrdinal)}`}</h3></div>{!inspectReference && trial && <button onClick={() => onFocus(trial.trialOrdinal)}>주변 범위 보기 ↗</button>}</div>
      <p className="history-selection-id">{inspectReference ? shortId(reference?.referenceId, 23) : trial?.candidateId}</p>
      <div className="history-selected-metrics history-actual-metrics">{ACTUAL_METRICS.map(metric => {
        const spec = metricSpec(metric, metricMode);
        return <div key={metric} title={metricTooltip(metrics[metric], metric, metricMode)}><span>{spec.label}{spec.unit && <small> · {spec.unit}</small>}</span><b>{formatMetric(metrics[metric], metric, metricMode)}</b></div>;
      })}</div>
      {inspectReference && reference ? <>
        <div className="history-actual-reference-note">HISTORICAL_PRODUCT_REFERENCE<br/>신규 모델 수에 포함하지 않습니다. NRPS·ECE는 미제공입니다.</div>
        <section className="history-identity-section"><h3>외부 기준 신원</h3><dl>
          <Pin name="referenceId" value={reference.referenceId}/><Pin name="referenceRevisionRef" value={reference.referenceRevisionRef}/>
          <Pin name="evaluationId" value={reference.evaluationId}/><Pin name="referenceReportRef" value={reference.referenceReportRef}/>
          <Pin name="sourceReferenceRef" value={reference.sourceReferenceRef}/><Pin name="groupRef" value={reference.groupRef}/>
        </dl></section><details className="history-execution-detail"><summary>제품 채점 · 등록 pins</summary><dl>{Object.entries(reference.pins).map(([key, value]) => <Pin key={key} name={key} value={value}/>)}</dl></details>
      </> : trial ? <>
        <div className="history-selection-facts"><span>실행 <b>{trial.status}</b></span><span>MAIN <b>{decisionText(trial.decisions.MAIN)}</b></span><span>AUX <b>{decisionText(trial.decisions.AUX)}</b></span><span>원 실행 내 순번 <b>{trial.cycleIndex}</b></span><span>평가 V <b>{formatNumber(trial.support.rows)}행</b></span></div>
        <section className="history-identity-section"><h3>모델 신원 <span>IMMUTABLE REVISION</span></h3><dl>
          <Pin name="modelId" value={trial.modelId}/><Pin name="modelRevisionRef" value={trial.modelRevisionRef}/>
          <Pin name="modelDefinitionId" value={trial.modelDefinitionId}/><Pin name="sourceModelId" value={model?.sourceModelId}/>
        </dl>{model ? <>
          <div className="history-actual-model-counts"><span>T <b>{formatNumber(model.counts.trainingRows)}</b></span><span>예측 V <b>{formatNumber(model.counts.predictionRows)}</b></span><span>fit <b>{model.counts.fits}</b></span><span>producer restore <b>{model.counts.producerRestores}</b></span></div>
          <p className="history-model-verification">모델·예측·Python 코드 bytes의 hash와 메타데이터 연결 확인. restore는 생산자 receipt 보고이며 수신기가 재예측한 결과가 아닙니다.</p>
          <dl><Pin name="codeRef" value={model.codeRef}/><Pin name="recipeRef" value={model.recipeRef}/><Pin name="dataRef" value={model.dataRef}/><Pin name="weightsRef · 학습된 PMF 상태 SHA" value={model.weightsRef}/><Pin name="manifestRef · 코드 archive" value={model.manifestRef}/></dl>
        </> : <p className="history-muted">{loading ? '선택한 실제 모델 revision을 읽고 있습니다.' : '모델 상세가 없습니다.'}</p>}</section>
        {model && pinSections.map(section => <details className="history-execution-detail" key={section.label}><summary>{section.label}</summary><dl>{Object.entries(model.pins).filter(([key]) => section.match.test(key)).map(([key, value]) => <Pin key={key} name={key} value={value}/>)}</dl></details>)}
        <section className="history-identity-section"><h3>평가 신원 <span>EVALUATION / REPORT</span></h3><dl><Pin name="evaluationId" value={trial.evaluationId}/><Pin name="evaluationRevisionRef" value={trial.evaluationRevisionRef}/><Pin name="reportRef" value={trial.reportRef}/><Pin name="등록 eventHash" value={trial.sourceRegistration.eventHash}/><Pin name="등록 producerSeq" value={trial.sourceRegistration.producerSeq}/></dl></section>
        {evaluation && <>
          <details className="history-execution-detail"><summary>독립 scorer · 점수·등록 pins</summary><dl>{Object.entries(evaluation.pins).map(([key, value]) => <Pin key={key} name={key} value={value}/>)}</dl></details>
          <details className="history-execution-detail"><summary>MAIN / AUX 판정 · 다음 제안</summary><dl>
            <Pin name="MAIN decisionRef" value={evaluation.mainDecision.decisionRef}/><Pin name="MAIN revisionRef" value={evaluation.mainDecision.revisionRef}/>
            <Pin name="AUX decisionRef" value={evaluation.auxDecision.decisionRef}/><Pin name="AUX revisionRef" value={evaluation.auxDecision.revisionRef}/>
            <Pin name="proposalRef" value={evaluation.proposal.proposalRef}/><Pin name="다음 동작" value={evaluation.proposal.nextAction}/>
            <Pin name="selectedCandidateId" value={evaluation.proposal.selectedCandidateId}/><Pin name="selectedTaskTemplateRef" value={evaluation.proposal.selectedTaskTemplateRef}/>
            <Pin name="consumptionRef" value={evaluation.proposal.consumptionRef}/><Pin name="nextReservationRef" value={evaluation.proposal.nextReservationRef}/>
          </dl></details>
        </>}
        {model && <div className="history-selection-foot">보고 CPU {resourceNumber(model.resources.cpuSeconds)}초 · 벽시계 {resourceNumber(model.resources.wallSeconds)}초<br/>최고 RSS {formatNumber(model.resources.peakRssMiB)} MiB · 현재 RSS 미계측</div>}
      </> : null}
      {group && <details className="history-execution-detail"><summary>같은 V 비교 조건 pins</summary><dl><Pin name="groupRef" value={group.groupRef}/><Pin name="comparisonRef" value={group.comparisonRef}/>{Object.entries(group.conditions).map(([key, value]) => <Pin key={key} name={key} value={value}/>)}</dl><p>후보별 recipe·학습 입력·예보 입력 hash는 공통 그룹 키에 포함하지 않습니다.</p></details>}
      <div className="history-selection-foot">개발 V 재사용 · H 미봉인 · 미채택<br/>원시 학습·예보·정답 본문과 과거 커밋 가용성은 재검증하지 않았습니다.</div>
    </> : <div className="history-empty">{loading ? '실제 이력 상세를 읽고 있습니다.' : '실제 후보나 외부 제품 기준을 선택하세요.'}</div>}
  </aside>;
}
