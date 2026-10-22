import { useState } from 'react';
import type { ModelIdentity, Trial } from './types.ts';
import { formatNumber, formatScore, metricInfo, shortId, statusLabel } from './presentation.ts';
import { METRICS } from './types.ts';

function Identity({ label, value }: { label: string; value: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  return <div className="history-identity"><dt>{label}</dt><dd>
    <code title={value ?? undefined}>{value ?? '미등록'}</code>
    {value && <button aria-label={`${label} 복사`} onClick={() => {
      void navigator.clipboard.writeText(value).then(() => {
        setCopied(true); setTimeout(() => setCopied(false), 1500);
      }).catch(() => setCopied(false));
    }}>{copied ? '복사됨' : '복사'}</button>}
  </dd></div>;
}
export function SelectionPanel({ trial, model, loading, error, onFocus }: {
  trial: Trial | undefined;
  model: ModelIdentity | undefined;
  loading: boolean;
  error: boolean;
  onFocus: (ordinal: number) => void;
}) {
  return <aside className="history-panel history-inspector" aria-label="선택 기록과 모델 신원">
    <header className="history-panel-head"><div><h2>선택 기록</h2><p>모델 신원과 평가 신원을 각각 확인합니다.</p></div><span className="history-inspector-mark">READ ONLY</span></header>
    {error && <div role="alert" className="history-inline-error">{trial || model ? '상세 재조회 실패 · 마지막 성공 자료 표시' : '상세 자료를 읽지 못했습니다.'}</div>}
    {trial ? <>
      <div className="history-selected-heading"><div><span>TRIAL</span><h3>#{formatNumber(trial.trialOrdinal)} <small>{trial.role === 'REEVALUATION' ? '재평가' : trial.role === 'BASELINE' ? '기준' : '후보'}</small></h3></div><button onClick={() => onFocus(trial.trialOrdinal)}>주변 200건 보기 ↗</button></div>
      <p className="history-selection-id">{trial.trialId}</p>
      <div className="history-selected-metrics">{METRICS.map(metric => <div key={metric}><span>{metricInfo[metric].label}</span><b>{formatScore(trial.metrics[metric], metric)}</b></div>)}</div>
      <div className="history-selection-facts"><span>실행 상태 <b>{statusLabel[trial.status]}</b></span><span>평가 문항 <b>{formatNumber(trial.support.rows)}</b></span><span>숫자 유효성 <b>{trial.numericValidity}</b></span><span>등록 <b>{trial.registrationState}</b></span></div>
      <section className="history-identity-section"><h3>모델 <span>IMMUTABLE IDENTITY</span></h3>
        <dl><Identity label="modelId" value={trial.modelId}/><Identity label="revision" value={trial.modelRevisionRef}/><Identity label="definition" value={trial.modelDefinitionId}/></dl>
        {model ? <>
          <p className="history-model-verification">인공 신원 메타데이터 · 실제 모델 아티팩트 검증 없음</p>
          <dl>{(['codeRef', 'recipeRef', 'dataRef', 'weightsRef', 'manifestRef'] as const).map(key => <Identity key={key} label={key} value={model[key]}/>)}</dl>
        </> : <p className="history-muted">{loading ? '선택한 불변 revision을 읽고 있습니다.' : '모델 상세 자료가 없습니다.'}</p>}
      </section>
      <section className="history-identity-section"><h3>평가 <span>EVALUATION / REPORT</span></h3><dl>
        <Identity label="evaluationId" value={trial.evaluationId}/><Identity label="reportId" value={trial.reportId}/><Identity label="reportRef" value={trial.reportRef}/>
      </dl></section>
      <details className="history-execution-detail"><summary>실행과 비교 조건</summary><dl>
        <Identity label="runId" value={trial.runId}/><Identity label="attemptId" value={trial.attemptId}/><Identity label="groupRef" value={trial.groupRef}/>
      </dl><p>실행 내 개선 순번 {formatNumber(trial.cycleIndex)} · 학습 epoch 아님</p></details>
      <div className="history-selection-foot">동일 modelId의 재평가도 evaluationId별로 구분합니다. <code>{shortId(trial.modelId, 9)}</code></div>
    </> : <div className="history-empty">{loading ? '선택 기록을 읽고 있습니다.' : '차트의 점이나 목록의 모델을 선택해 신원을 확인하세요.'}</div>}
  </aside>;
}
