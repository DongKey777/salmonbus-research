import { useState } from 'react';
import { useFeaturesV2Report } from './connection.ts';
import { clock, count, seatDelta, seats, share, shortToken } from '../route-report/presentation.ts';
import type { FeaturesV2Report, SeatModel } from './types.ts';
import '../route-report/route-report.css';
import './features-v2.css';

const brier = (value: number) => new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(value);
const withError = (d: { MAE: number; standardError: number | null } | null) => d === null ? '—' : `${seatDelta(d.MAE)}${d.standardError === null ? '' : ` ± ${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 }).format(d.standardError)}`}`;
function best(data: FeaturesV2Report): SeatModel { return data.seatModels.filter(m => m.role === 'CANDIDATE').reduce((a, b) => (b.MAE < a.MAE ? b : a)); }

export function FeaturesV2Panel() {
  const query = useFeaturesV2Report(), data = query.data;
  const [segmentId, setSegmentId] = useState<string | null>(null);
  const top = data ? best(data) : null;
  const reference = data?.seatModels[0], product = data?.seatModels[1];
  const segment = data ? data.segments.find(s => s.id === segmentId) ?? data.segments[0] : null;
  const ids = data ? data.seatModels.map(m => m.id) : [];
  const total = data ? data.dataset.devWeightSum : 1;
  return <section className="full-learning-batch route-report features-v2" aria-label="32열 모델과 운영 예보 비교">
    <header><div><span>FULL DATA · FEATURES V2 · SAME DEV ROWS AS PRODUCT</span><h2>32열 모델 · 기존 6열 D6 · 운영 예보 비교</h2></div><button onClick={() => void query.refetch()} disabled={query.isFetching}>↻ 비교 보고 다시 읽기</button></header>
    {query.error && <div role="alert" className="full-learning-batch-error">{data ? '최신 비교 보고를 읽지 못해 마지막 성공 자료를 표시합니다.' : query.error.message.endsWith('HTTP_404') ? '32열 학습 결과(features-v2-report.json)가 아직 게시되지 않았습니다. GPU 실행이 끝나면 게시합니다.' : '비교 보고를 읽거나 검증하지 못했습니다.'}<code>{query.error.message}</code></div>}
    {!data || !top || !reference || !product || !segment ? <p className="full-learning-batch-pending">검증된 비교 보고를 기다립니다. 모든 점수는 같은 DEV 행·같은 그룹 가중(1/m)으로 계산합니다.</p> : <>
      <div className="full-learning-batch-state"><strong>{data.runId}</strong><span>TRAIN {count(data.dataset.trainRows)}행 · DEV {count(data.dataset.devRows)}행</span><span><code>{data.producerStatus}</code></span>
        <p>입력은 {data.featureGroups.map(g => `${g.label} ${g.names.length}열`).join(' · ')}입니다. 운영 예보는 그 시점에 실제로 발행된 값이며 같은 DEV 행에 붙여 채점했습니다.</p></div>
      <div className="route-report-summary">
        <div><span>기존 6열 D6</span><strong>{seats(reference.MAE, 'MAE')}</strong><small>RMSE {seats(reference.RMSE, 'MAE')} · 노선 macro {seats(reference.routeMacroMAE, 'MAE')}</small></div>
        <div><span>운영 예보 · 같은 행</span><strong>{seats(product.MAE, 'MAE')}</strong><small>RMSE {seats(product.RMSE, 'MAE')} · D6 대비 {withError(product.deltaVsReference)}</small></div>
        <div><span>가장 낮은 후보 · {top.label}</span><strong>{seats(top.MAE, 'MAE')}</strong><small>D6 대비 {withError(top.deltaVsReference)} · 운영 대비 {withError(top.deltaVsProduct)}</small></div>
        {data.ablations.map(a => <div key={a.id}><span>{a.label} · {count(a.rounds)}라운드</span><strong>{seatDelta(-a.MAEDelta)}</strong><small>넣으면 {seats(a.withMAE, 'MAE')} · 빼면 {seats(a.withoutMAE, 'MAE')}{a.standardError === null ? '' : ` · 오차 ±${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 }).format(a.standardError)}`}</small></div>)}
      </div>
      <div className="full-learning-batch-table"><table><thead><tr><th>모델</th><th>입력</th><th>depth · 라운드</th><th>MAE · 석</th><th>RMSE · 석</th><th>노선 macro MAE</th><th>평균 편향</th><th>D6 대비</th><th>운영 대비</th></tr></thead><tbody>{data.seatModels.map(m => <tr key={m.id} className={m.id === top.id ? 'best' : ''}>
        <td><b>{m.label}</b><small>{m.id}</small></td><td>{m.featureSet}</td><td>{m.depth === null ? '—' : `${m.depth} · ${count(m.rounds)}`}</td><td title={`원값 ${m.MAE}`}>{seats(m.MAE, 'MAE')}</td><td>{seats(m.RMSE, 'MAE')}</td><td>{seats(m.routeMacroMAE, 'MAE')}</td><td>{seatDelta(m.bias)}</td><td>{withError(m.deltaVsReference)}</td><td>{withError(m.deltaVsProduct)}</td></tr>)}</tbody></table></div>
      <div className="features-v2-curve">{data.curve.filter(c => c.points.length > 1).map(c => <p key={c.id}><b>{c.id}</b> 라운드별 MAE {c.points.map(p => `${count(p.rounds)} → ${seats(p.MAE, 'MAE')}`).join(' · ')}</p>)}</div>
      <div className="full-learning-batch-table"><table><thead><tr><th>만석 확률</th><th>Brier</th><th>log loss</th><th>평균 확률</th></tr></thead><tbody>{data.fullModels.map(f => <tr key={f.id}><td><b>{f.label}</b><small>{f.id}</small></td><td>{brier(f.Brier)}</td><td>{f.logLoss === null ? '—' : brier(f.logLoss)}</td><td>{share(f.meanProbability)}</td></tr>)}</tbody></table>
        <small className="features-v2-note">실제 만석 비율 {share(data.observedFullShare)} · Brier는 낮을수록 좋습니다.</small></div>
      <div className="route-report-sort"><span>구간</span>{data.segments.map(s => <button key={s.id} className={s.id === segment.id ? 'selected' : ''} onClick={() => setSegmentId(s.id)}>{s.label}</button>)}</div>
      <div className="full-learning-batch-table"><table><thead><tr><th>{segment.label}</th><th>DEV 행</th><th>질량 비중</th>{ids.map(id => <th key={id}>{id}</th>)}</tr></thead><tbody>{segment.rows.map(r => <tr key={r.key}><td>{r.label}</td><td>{count(r.devRows)}</td><td>{share(r.weight / total)}</td>{ids.map(id => <td key={id}>{seats(r.MAE[id], 'MAE')}</td>)}</tr>)}</tbody></table></div>
      <div className="full-learning-batch-table route-report-table"><table><thead><tr><th>노선 token</th><th>DEV 행</th><th>TRAIN 행</th>{ids.map(id => <th key={id}>{id}</th>)}</tr></thead><tbody>{[...data.routes].sort((a, b) => b.weight - a.weight).map(r => <tr key={r.token} className={r.trainRows === 0 ? 'dev-only' : ''}>
        <td><code title={r.token}>{shortToken(r.token)}</code></td><td>{count(r.devRows)}</td><td>{r.trainRows === 0 ? 'DEV 전용' : count(r.trainRows)}</td>{ids.map(id => <td key={id}>{seats(r.MAE[id], 'MAE')}</td>)}</tr>)}</tbody></table></div>
      <div className="full-learning-batch-notes"><p>MAE = Σw|오차| / Σw, w = 1/m(같은 정답 그룹의 질문 수). 오차 폭은 정답 그룹을 독립으로 본 값이라 같은 날 안의 상관을 무시하므로 실제보다 작게 나옵니다.</p>
        <p>DEV는 이전 실험에서도 쓴 자료입니다. 후보 목록은 실행 전에 고정했고 DEV를 보고 고르지 않았습니다. 이 보고는 10/22에 H를 정하기 전에 DEV 전체로 채점한 것이라 지금의 H 4일(10/13·15·18·19)이 들어 있습니다. 자율 루프의 시작 챔피언 V2_D8도 이 점수로 골랐습니다. 그래서 V2_D8의 H 점수는 처음 보는 자료의 점수가 아닙니다.</p>
        <p className="route-report-claims"><span>DEV 재사용</span><span>H 지정(10/22) 전 산출 · 현재 H 4일 포함</span><span>채택 없음</span><span>일반화 주장 없음</span></p></div>
      <details><summary>수신 핀 · 보고 시각</summary><p>receipt {data.receiptSha256.slice(0, 12)} · metrics {data.metricsSha256.slice(0, 12)} · package {data.packageSha256.slice(0, 12)} · dataset {data.dataset.manifestSha256.slice(0, 12)} · features {data.dataset.featureManifestSha256.slice(0, 12)} · stop demand {data.dataset.stopDemandManifestSha256.slice(0, 12)}</p></details>
      <footer>상태 자료 작성 {clock(data.servedAt)} · 10초마다 읽기 전용 확인 · {data.schema}</footer>
    </>}
  </section>;
}
