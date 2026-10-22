import { useMemo, useState } from 'react';
import { ResearchNav } from '../ui/ResearchNav';
import { SITE_MARK } from '../site/env.ts';
import { ChartFrame } from '../ui/ChartFrame';
import { Panel } from '../ui/Panel';
import { useRealPilot } from './connection.ts';
import { useRealSupport } from './support-connection.ts';
import { comparisonOption, nrpsDiagnosticOption } from './charts.ts';
import { comparedPoints } from './project.ts';
import { identityLabels, resultTime } from './presentation.ts';
import { metricSpec } from '../metrics/display.ts';
import { MetricUnitControl, MetricValue, useMetricMode } from '../metrics/MetricPresentation.tsx';
import { IDENTITY_KEYS } from './types.ts';
import type { IdentityKey, RealPilotSummary } from './types.ts';
import './real.css';

function HashRow({ name, value }: { name: IdentityKey; value: string }) {
  const [copied, setCopied] = useState(false);
  return <div className="real-hash-row"><dt>{identityLabels[name]}<small>{name}</small></dt><dd><code>{value}</code>
    <button aria-label={`${identityLabels[name]} 해시 복사`} onClick={() => {
      void navigator.clipboard.writeText(value).then(() => {
        setCopied(true); setTimeout(() => setCopied(false), 1500);
      }).catch(() => setCopied(false));
    }}>{copied ? '복사됨' : '복사'}</button></dd></div>;
}
function Protocol({ summary }: { summary: RealPilotSummary }) {
  return <section className="real-protocol" aria-label="실제 관측 소형 평가 범위">
    <div className="real-protocol-heading"><h2>소형 연결 점검</h2><span>T8 / V8</span></div>
    <p className="real-protocol-intro">다운로드해 저장한 실제 관측·제품 예보·정답을 연결한 평가입니다.</p>
    {summary.identity.sourceDatasetSha256==='06b5c5fcb70a7c7aef19cabf389827b6e6f2efc2607c873635379e4c45db4d9d'&&<p className="real-protocol-intro">2026-10-12, 한 노선의 소형 자료입니다. 제품 값도 당시 저장된 예보와 비교했습니다.</p>}
    <dl className="real-protocol-facts">
      <div><dt>학습에 사용한 기록 T</dt><dd>{summary.counts.trainRows}건</dd></div>
      <div><dt>평가에 사용한 기록 V</dt><dd>{summary.counts.evalRows}건</dd></div>
      <div><dt>자료 모드</dt><dd>기록된 관측 시각 기준</dd></div>
      <div><dt>노선·시간대 등 특징 사용</dt><dd>사용하지 않음</dd></div>
      <div><dt>채택</dt><dd>없음 · false</dd></div>
    </dl>
    <div className="real-model-note"><span>이번 기준 모델</span><strong>전역 좌석 빈도 PMF</strong><p>T8의 좌석 분포에 Dirichlet 사전 질량 총합 1을 적용했습니다. Jev·개별 입력 특성 학습은 포함하지 않습니다.</p><code>EMPIRICAL_SEAT_PMF_DIRICHLET_TOTAL_ONE_V1</code></div>
    <p className="real-protocol-limit">전체 자료 학습이나 실제 관측을 이용한 5회 개선 실행의 결과가 아닙니다.</p>
  </section>;
}
function Results({ summary, publicSummarySha256 }: { summary: RealPilotSummary; publicSummarySha256: string }) {
  const { mode } = useMetricMode();
  const anchor = useMemo(() => ({
    publicSummarySha256, modelReceiptSha256: summary.identity.modelReceiptSha256,
    inputHash: summary.identity.inputHash, evalRows: summary.counts.evalRows,
  }), [publicSummarySha256, summary]);
  const supportQuery = useRealSupport(anchor);
  const support = !supportQuery.error && supportQuery.data?.state === 'verified' ? supportQuery.data.support : undefined;
  const options = useMemo(() => ({
    Brier: comparisonOption(summary, 'Brier', mode), MAE: comparisonOption(summary, 'MAE', mode),
    MSE: comparisonOption(summary, 'MSE', mode), NRPS: nrpsDiagnosticOption(summary, mode),
  }), [summary, mode]);
  const brier = metricSpec('Brier', mode), mae = metricSpec('MAE', mode);
  const squared = metricSpec('MSE', mode), nrps = metricSpec('NRPS', mode);
  return <>
    <div className="real-evaluation-grid">
      <Panel title="만석 확률 예측 오차" subtitle={`${brier.label} · ${brier.unit} · 기준 모델 / 제품 raw / 제품 final`}
        className="real-brier-panel" actions={<span className="real-panel-tag">동일 V8 평가</span>}
        footer={<><span>{brier.explanation}</span><span>V8 · 채택 판정 없음</span></>}>
        <div className={`real-support-note ${support ? 'verified' : ''}`} aria-live="polite">
          {support ? <><strong>검증 {support.evalRows}건 중 만석 {support.fullEvents} · 비만석 {support.nonFullEvents}</strong><span>{support.fullEvents === 0 ? '이번 자료로 만석 탐지 성능을 판단할 수 없습니다.' : '소형 연결 점검이며 일반화 성능을 판단할 수 없습니다.'}</span></> :
            supportQuery.error ? <><span role="alert">평가 구성 집계의 신원·개수를 검증하지 못했습니다. 점수는 별도 검증 결과를 유지합니다.</span><button onClick={() => void supportQuery.refetch()}>집계 다시 확인</button><details><summary>오류 코드</summary><code>{supportQuery.error.message}</code></details></> :
              <span>{supportQuery.isFetching ? '평가 자료의 만석·비만석 집계를 확인하고 있습니다.' : '평가 자료의 만석·비만석 집계가 아직 제공되지 않았습니다.'}</span>}
        </div>
        <ChartFrame id="real-brier" label={`실제 관측 V8의 기준 모델과 제품 raw 및 final ${brier.label} 비교`} option={options.Brier}/>
      </Panel>
      <Protocol summary={summary}/>
      <Panel title="잔여 좌석 절대 오차" subtitle={`${mae.label} · 기준 모델 / 제품 예보`} className="real-metric-panel"
        footer={<><span>{mae.explanation}</span><span>V8 · {mae.unit}</span></>}>
        <ChartFrame id="real-mae" label={`실제 관측 V8의 모델과 제품 ${mae.label} 비교`} option={options.MAE}/>
      </Panel>
      <Panel title={squared.title} subtitle={`${squared.label} · 기준 모델 / 제품 예보`} className="real-metric-panel"
        footer={<><span>{squared.explanation}</span><span>V8 · {squared.unit}</span></>}>
        <ChartFrame id="real-mse" label={`실제 관측 V8의 모델과 제품 ${squared.label} 비교`} option={options.MSE}/>
      </Panel>
      <Panel title="모델 자체 분포 진단" subtitle={`${nrps.label} · 모델 PMF만 평가`} className="real-metric-panel real-diagnostic-panel"
        actions={<span className="real-diagnostic-tag">비교 불가</span>}
        footer={<span>{nrps.explanation} 제품 NRPS는 미제공입니다.</span>}>
        <ChartFrame id="real-nrps" label={`기준 모델의 ${nrps.label} 자체 진단, 제품 NRPS는 미제공`} option={options.NRPS}/>
      </Panel>
    </div>
    <section className="real-evidence-table" aria-label={mode === 'raw' ? '평가 점수 원값' : '읽기 쉬운 단위로 표시한 평가 점수'}>
      <header><h2>등록 점수</h2><p>{mode === 'readable' ? '읽기 쉬운 단위로 환산한 값 · 원값 전환 가능' : '저장된 지표의 원값'} · 판정은 유지됩니다.</p></header>
      <div className="real-score-table"><table><thead><tr><th scope="col">지표</th><th scope="col">기준 모델</th><th scope="col">제품 예보</th><th scope="col">범위</th></tr></thead><tbody>
        <tr><th scope="row" title={brier.explanation}>{brier.label}</th><td><MetricValue value={summary.metrics.modelBrier} metric="Brier" withUnit/></td><td><span>raw <MetricValue value={summary.metrics.productRawBrier} metric="Brier" withUnit/></span><span>final <MetricValue value={summary.metrics.productFinalBrier} metric="Brier" withUnit/></span></td><td>만석 확률 오차 · V8</td></tr>
        {(['MAE', 'MSE'] as const).map(metric => {
          const points = comparedPoints(summary, metric);
          const spec = metricSpec(metric, mode);
          return <tr key={metric}><th scope="row" title={spec.explanation}>{spec.label}</th><td><MetricValue value={points[0].value} metric={metric} withUnit/></td><td><MetricValue value={points[1].value} metric={metric} withUnit/></td><td>{spec.unit} · V8</td></tr>;
        })}
        <tr className="real-diagnostic-row"><th scope="row" title={nrps.explanation}>{nrps.label} <small>자체 진단</small></th><td><MetricValue value={summary.metrics.modelNRPS} metric="NRPS" withUnit/></td><td>미제공 <code>null</code></td><td>제품과 비교 불가</td></tr>
      </tbody></table></div>
    </section>
    <section className="real-claims" aria-label="평가 해석의 범위">
      <span><i/>독립 H 봉인 없음 <code>HSealed=false</code></span><span><i/>일반화 성능 주장 없음 <code>generalizationClaim=false</code></span>
      <span><i/>당시 커밋 가용성 미검증 <code>historicalCommitAvailabilityVerified=false</code></span>
    </section>
    <section className="real-identities" aria-label="자료와 모델의 검증 식별자">
      <header><div><h2>자료·모델·평가 신원</h2><p>원본 자료와 입력, 모델 receipt, 채점 계약을 별도 해시로 확인합니다.</p></div><code>{summary.candidateId}</code></header>
      <dl className="real-primary-hashes"><HashRow name="sourceDatasetSha256" value={summary.identity.sourceDatasetSha256}/><HashRow name="modelHash" value={summary.identity.modelHash}/></dl>
      <details><summary>manifest · receipt · 입력 · 분할 · recipe · 채점 계약 해시</summary><dl>{IDENTITY_KEYS.filter(key => key !== 'sourceDatasetSha256' && key !== 'modelHash').map(key => <HashRow key={key} name={key} value={summary.identity[key]}/>)}</dl></details>
      <details className="real-support-identity"><summary>공개 점수 파일과 평가 구성 집계의 연결</summary><dl>
        <div className="real-hash-row"><dt>공개 점수 파일 <small>publicSummarySha256</small></dt><dd><code>{publicSummarySha256}</code></dd></div>
        {support && <div className="real-hash-row"><dt>집계에 사용한 정답 파일 <small>truthBytesSha256</small></dt><dd><code>{support.truthBytesSha256}</code></dd></div>}
      </dl><p>{support ? '점수 파일·모델 receipt·입력·평가 건수 일치 확인 · 원시 행 비공개' : '평가 구성 집계와의 연결은 아직 확인되지 않았습니다.'}</p></details>
    </section>
  </>;
}

export default function RealApp() {
  const query = useRealPilot();
  const summary = query.data?.state === 'scored' ? query.data.summary : undefined;
  return <div className="real-app">
    <a className="skip" href="#real-workbench">실제 관측 평가로 이동</a>
    <header className="topbar"><div className="wordmark"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 14h4l3-8 4 13 3-8h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg><b>salmonbus</b><span>/</span><strong>Research</strong></div><ResearchNav active="real"/><span className="real-local">{SITE_MARK}</span></header>
    <div className="real-sourcebar"><span className="real-origin-tag">실제 관측</span><strong>저장된 실제 관측 평가 · 실시간 학습 연결 전</strong><code>LOCAL_CAPTURED_REAL_OBSERVATIONS</code></div>
    <main id="real-workbench" className="real-workbench">
      <div className="real-heading"><div><p>CAPTURED OBSERVATION PILOT</p><h1>실제 관측 평가 <span>T8 / V8 · 소형 연결 점검</span></h1></div>
        <div className="real-heading-actions"><span className={query.error ? 'real-status error' : summary ? 'real-status scored' : 'real-status'}><i/>{query.error ? '결과 읽기 오류' : summary ? '채점 완료 · 미채택' : '저장 결과 대기'}</span><button disabled={query.isFetching} onClick={() => void query.refetch()}>↻ 결과 확인</button></div>
      </div>
      <div className="real-metric-controls"><MetricUnitControl/></div>
      <div className="real-receipt-line"><span>{summary ? <>결과 생성 <time dateTime={summary.recordedAt}>{resultTime(summary.recordedAt)} KST</time></> : '검증된 공개 결과가 저장되면 평가값을 표시합니다.'}</span><span>저장 파일 읽기 전용 · 실시간 작업 상태 아님</span></div>
      {query.error && <div className="real-error" role="alert"><div><strong>{summary ? '재조회 실패 · 마지막으로 검증한 저장 결과를 표시합니다.' : '평가 결과를 읽거나 검증하지 못했습니다.'}</strong><span>결과 확인을 눌러 다시 읽을 수 있습니다.</span></div><details><summary>오류 코드</summary><code>{query.error.message}</code></details></div>}
      {summary && query.data?.state === 'scored' ? <Results summary={summary} publicSummarySha256={query.data.publicSummarySha256}/> : <section className="real-pending" aria-live="polite">
        <svg className="real-pending-document" width="36" height="44" viewBox="0 0 36 44" fill="none" aria-hidden="true"><path d="M6 2h16l8 8v31H6V2Z" stroke="currentColor" strokeWidth="1.3"/><path d="M22 2v9h8M12 20h12M12 26h12M12 32h8" stroke="currentColor" strokeWidth="1.3"/></svg><h2>{query.isFetching ? '저장된 평가 결과 확인 중' : '공개된 평가 결과가 아직 없습니다.'}</h2>
        <p>실제 관측 T8/V8 평가와 독립 채점이 끝난 검증 결과가 저장되면 그래프를 표시합니다.</p>
        <span>현재 모델 점수·제품 점수는 표시하지 않습니다.</span>
      </section>}
      <footer className="real-footer"><span>실제 관측 소형 연결 점검 · 전체 자료 학습·실제 관측 5회 개선·일반화 성능을 의미하지 않습니다.</span><span>원시 관측·노선·개별 식별자 비공개</span></footer>
    </main>
  </div>;
}
