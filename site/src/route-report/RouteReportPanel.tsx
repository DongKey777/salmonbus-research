import { useState } from 'react';
import { useRouteReport } from './connection.ts';
import { defaultModelId, routeRows, selectModel, summary } from './project.ts';
import type { RouteSort } from './project.ts';
import { clock, count, modeLabel, percent, seatDelta, seats, share, shortToken } from './presentation.ts';
import './route-report.css';

export function RouteReportPanel() {
  const query = useRouteReport(), data = query.data;
  const [modelId, setModelId] = useState<string | null>(null);
  const [sort, setSort] = useState<RouteSort>('weight');
  const model = data ? selectModel(data, modelId) : null;
  const rows = data && model ? routeRows(data, model, sort) : [];
  const facts = data && model ? summary(data, model) : null;
  return <section className="full-learning-batch route-report" aria-label="노선별 평가 보고">
    <header><div><span>FULL DATA · PER-ROUTE DEV REPORT</span><h2>노선별 평가 · 전체 micro / 노선 macro / unknown 질량</h2></div><button onClick={() => void query.refetch()} disabled={query.isFetching}>↻ 노선 보고 다시 읽기</button></header>
    {query.error && <div role="alert" className="full-learning-batch-error">{data ? '최신 노선 보고를 읽지 못해 마지막 성공 자료를 표시합니다.' : query.error.message.endsWith('HTTP_404') ? '노선별 평가 보고(route-report.json)가 아직 게시되지 않았습니다. 노선 수·노선별 오차는 미산출입니다.' : '노선별 평가 보고를 읽거나 검증하지 못했습니다.'}<code>{query.error.message}</code></div>}
    {!data || !model || !facts ? <p className="full-learning-batch-pending">검증된 노선별 보고를 기다립니다. 노선 집계는 원 global 점수를 대체하지 않으며, 기존 gate를 바꾸지 않습니다.</p> : <>
      <div className="full-learning-batch-state"><strong>{data.runId}</strong><span>DEV {count(data.dataset.devRows)}행 · {count(data.dataset.devGroups)} 정답 그룹 · 노선 {count(data.routeMap.knownRouteCount)}개 식별</span><span><code>{data.producerStatus}</code></span><p>노선은 opaque token으로만 표시합니다. 원 노선 ID·차량 식별자는 포함하지 않습니다. 평가 단위는 R.route_id이며 version은 내부 provenance로만 보존합니다.</p></div>
      <div className="route-report-models" role="tablist" aria-label="평가 모델 선택">{data.models.map(item => <button key={item.id} role="tab" aria-selected={item.id === model.id} className={item.id === model.id ? 'selected' : ''} onClick={() => setModelId(item.id)}>
        <b>{item.id}</b><small>{item.role === 'REFERENCE' ? '비교 기준' : '후보'} · {modeLabel[item.trainingMode]}{item.depth !== null ? ` · depth ${item.depth}` : ''} · {count(item.rounds)}라운드</small></button>)}</div>
      <div className="route-report-summary">
        <div><span>전체 micro MAE · 그룹 가중</span><strong>{seats(facts.micro.MAE, 'MAE')}</strong><small>RMSE {seats(facts.micro.MSE, 'MSE')} · {facts.micro.matchesPublished ? `기존 global 점수와 일치 (${facts.micro.publishedSource})` : '기존 global 발행본 참조 없음'}</small></div>
        <div><span>known-route macro MAE · 노선 균등</span><strong>{seats(facts.macro.MAE, 'MAE')}</strong><small>RMSE {seats(facts.macro.MSE, 'MSE')} · 노선 {count(facts.macro.routeCount)}개 · unknown 제외 · 진단용</small></div>
        <div><span>unknown 노선 질량 · micro에 포함</span><strong>{share(facts.unknown.weightShare)}</strong><small>{count(facts.unknown.devGroups)} 그룹 · {count(facts.unknown.devRows)}행 · MAE {seats(facts.unknown.MAE, 'MAE')}</small></div>
        {!facts.isReference && <div><span>기준 {facts.referenceId} 대비 micro</span><strong>{seatDelta(facts.micro.pairedMAEDelta)}</strong><small>상대 개선율 {percent(facts.micro.relativeImprovementPct)} · 같은 DEV 재사용 · 채택 아님</small></div>}
      </div>
      <div className="route-report-sort"><span>정렬</span>{([['weight', '가중 질량'], ['mae', 'MAE 큰 순'], ['delta', '개선 큰 순']] as const).map(([key, label]) => <button key={key} className={sort === key ? 'selected' : ''} disabled={key === 'delta' && facts.isReference} onClick={() => setSort(key)}>{label}</button>)}<small>DEV 전용 노선 {count(facts.devOnlyRoutes)}개 · 작은 노선도 숨기지 않고 표본 수를 함께 표시</small></div>
      <div className="full-learning-batch-table route-report-table"><table><thead><tr><th>노선 token</th><th>N_r · DEV 행</th><th>G_r · 그룹</th><th>W_r · Σw</th><th>질량 비중</th><th>TRAIN support</th><th>MAE_r · 석</th><th>RMSE_r · 석</th><th>{facts.isReference ? '기준 모델' : `Δ MAE vs ${facts.referenceId}`}</th></tr></thead><tbody>{rows.map(row => <tr key={row.token} className={row.trainSupport === null ? 'dev-only' : ''}>
        <td><code title={row.token}>{shortToken(row.token)}</code></td><td>{count(row.devRows)}</td><td>{count(row.devGroups)}</td><td>{new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(row.weightSum)}</td><td>{share(row.weightShare)}</td>
        <td>{row.trainSupport ? <>{count(row.trainSupport.groups)} 그룹<small>{count(row.trainSupport.rows)}행</small></> : <>DEV 전용<small>TRAIN 없음</small></>}</td>
        <td title={`원값 MAE ${row.MAE}`}>{seats(row.MAE, 'MAE')}</td><td title={`원값 MSE ${row.MSE}`}>{seats(row.MSE, 'MSE')}</td>
        <td>{facts.isReference ? '—' : <>{seatDelta(row.pairedMAEDelta)}<small>상대 개선율 {percent(row.relativeImprovementPct)}</small></>}</td>
      </tr>)}</tbody></table></div>
      <div className="full-learning-batch-notes"><p>MAE_r = Σw|오차| / W_r, w = 1/m(같은 정답 그룹의 질문 수). 전체 micro는 노선 점수를 그룹 수로 가중한 값이며 기존 global과 같은 정의입니다. macro는 known 노선의 단순 평균이고 unknown 질량은 micro에만 남습니다.</p>
        <p>작은 노선의 오차는 변동이 큽니다. 특정 그룹 수를 통계적 충분성의 보장으로 선언하지 않습니다. 고유 그룹도 완전한 독립 단위라는 보장은 없습니다.</p>
        <p className="route-report-claims"><span>DEV 재사용</span><span>H 지정(10/22) 전 산출 · 현재 H 4일 포함</span><span>채택 없음</span><span>일반화 주장 없음</span><span>기존 gate 대체 없음</span><span>원 global 점수 소급 수정 없음</span></p></div>
      <details><summary>수신 핀 · 보고 시각</summary><p>route-report receipt {data.receiptSha256.slice(0, 12)} · group→route map {data.routeMap.sha256.slice(0, 12)} · dataset manifest {data.dataset.manifestSha256.slice(0, 12)}</p><p>생산자 보고 {clock(data.sourceReportedAt)}</p></details>
      <footer>상태 자료 작성 {clock(data.servedAt)} · 10초마다 읽기 전용 확인 · {data.schema}</footer>
    </>}
  </section>;
}
