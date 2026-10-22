import type { Cycle, Reference, Run } from './types.ts';
import { decisionLabel, number, phases, score, short, time } from './presentation.ts';

function Ref({ name, value }: { name: string; value: string | number | null | undefined }) {
  return <div className="actual-ref"><dt>{name}</dt><dd>{value == null ? '—' : <code title={String(value)}>{String(value)}</code>}</dd></div>;
}
export function EvidencePanel({ run, cycle, reference }: { run: Run; cycle: Cycle | undefined; reference: Reference | null }) {
  const report = reference?.report ?? cycle?.report;
  return <section className="actual-evidence" aria-label="선택 기록의 검증 근거">
    <header><div><h2>{reference ? '당시 제품 예보의 근거' : cycle ? `시도 ${cycle.cycleIndex} · 모델과 평가 근거` : '검증 근거'}</h2><p>{reference ? '외부 제품 기준 · 모델 작업·fit·모델 receipt 없음' : '등록된 모델·채점·판정·제안의 불변 참조'}</p></div><span>{reference?.candidateId ?? cycle?.candidateId ?? '선택 기록 없음'}</span></header>
    {(cycle || reference) ? <div className="actual-evidence-grid">
      <div className="actual-evidence-block"><h3>{reference ? '외부 제품 기준' : '모델 신원'}</h3><dl>
        {reference ? <><Ref name="referenceRef" value={reference.referenceRef}/><Ref name="verification" value={reference.verification}/><Ref name="모델 작업 수" value="해당 없음"/></> : <>
          <Ref name="modelId" value={cycle?.model.modelId}/><Ref name="jobId" value={cycle?.model.jobId}/>
          <Ref name="modelReceiptRef" value={cycle?.model.modelReceiptRef}/><Ref name="modelArtifactRef" value={cycle?.model.modelArtifactRef}/>
          <Ref name="modelCompletionRef" value={cycle?.model.completionRef}/><Ref name="recipeRef" value={cycle?.model.recipeRef}/>
          <Ref name="taskRef" value={cycle?.model.taskRef}/><Ref name="workerCodeHash" value={cycle?.model.workerCodeHash}/>
        </>}
      </dl></div>
      <div className="actual-evidence-block"><h3>독립 채점과 등록</h3><dl>
        <Ref name="evaluationId" value={report?.evaluationId}/><Ref name="reportRef" value={report?.reportRef}/>
        <Ref name="scorerReceiptRef" value={report?.scorerReceiptRef}/><Ref name="scoreArtifactRef" value={report?.scoreArtifactRef}/>
        <Ref name="등록 hash" value={report?.registrationHash}/><Ref name="groupRef" value={report?.groupRef}/>
        <Ref name="숫자 지원 / 유효성" value={report ? `${report.numericSupport} / ${report.validity}` : null}/>
      </dl></div>
      <div className="actual-evidence-block"><h3>{reference ? '평가 지원' : '개발 판정과 다음 제안'}</h3>
        {reference ? <dl><Ref name="평가 행" value={report?.support.rows}/><Ref name="평가 그룹" value={report?.support.groups}/><Ref name="만석 그룹" value={report?.support.fullGroups}/><Ref name="비만석 그룹" value={report?.support.nonFullGroups}/><Ref name="가중치 합" value={report?.support.weightSum}/></dl> : <>
          <div className="actual-evidence-decisions"><span>MAIN <b>{decisionLabel(cycle?.mainDecision)}</b></span><span>AUX <b>{decisionLabel(cycle?.auxDecision)}</b></span></div>
          <dl><Ref name="MAIN revision" value={cycle?.mainDecision?.revisionRef}/><Ref name="MAIN decision" value={cycle?.mainDecision?.decisionRef}/>
            <Ref name="AUX revision" value={cycle?.auxDecision?.revisionRef}/><Ref name="AUX decision" value={cycle?.auxDecision?.decisionRef}/>
            <Ref name="proposalRef" value={cycle?.proposal?.proposalRef}/><Ref name="consumptionRef" value={cycle?.proposal?.consumptionRef}/>
            <Ref name="다음 동작" value={cycle?.proposal?.nextAction}/><Ref name="다음 후보" value={cycle?.proposal?.selectedCandidateId}/>
          </dl></>}
      </div>
    </div> : <p className="actual-evidence-empty">모델 예약이나 외부 제품 기준이 등록되면 불변 참조를 확인할 수 있습니다.</p>}
    {cycle && !reference && <div className="actual-resource-facts"><span>보고 CPU <b>{score(cycle.resources?.reportedCpuSeconds, 3)}초</b></span><span>보고 벽시계 <b>{score(cycle.resources?.reportedWallSeconds, 3)}초</b></span><span>보고 최고 RSS <b>{number(cycle.resources?.reportedPeakRssMiB)} MiB</b></span><span>현재 RSS <b>미계측 · null</b></span><small>{cycle.resources?.measurementKind === 'ARTIFICIAL_FIXTURE_VALUE' ? '인공 자원 값' : 'producer가 보고한 모델 작업 측정값'}</small></div>}
    <details className="actual-events"><summary>수신한 실행 기록 {run.events.length}건 · source generation {short(run.sourceGenerationId)}</summary><div className="actual-events-scroll"><table><thead><tr><th>소스 순번</th><th>시도</th><th>사건</th><th>발생</th><th>관측</th><th>수신</th><th>eventHash</th></tr></thead><tbody>{[...run.events].reverse().map(event => <tr key={event.eventId}><td>{event.producerSeq}</td><td>{event.cycleIndex === 0 ? '외부 기준' : event.cycleIndex}</td><td>{phases[event.kind]}</td><td>{time(event.occurredAt)}</td><td>{time(event.observedAt)}</td><td>{time(event.receivedAt)}</td><td title={event.eventHash}>{short(event.eventHash)}</td></tr>)}</tbody></table></div></details>
  </section>;
}
