import { useModelRegistry } from './connection.ts';
import type { RegistryModel } from './contract.ts';
import './model-registry.css';

const seats = (v: number) => `${v.toFixed(2)} 석`;
const short = (h: string) => h.slice(0, 12);
const path = (m: RegistryModel) => m.parentModelId ? `이어 학습 · ${m.parentModelId.replace('SEAT.', '')}에서` : m.gateBaselineModelId ? '0부터 새 학습' : '저장 기준';
const gate = (m: RegistryModel) => m.gatePassed === null ? '비교 기준' : m.gatePassed ? `기준 충족 · 대비 ${m.gateBaselineModelId?.replace('SEAT.', '')}` : `미충족 · 대비 ${m.gateBaselineModelId?.replace('SEAT.', '')}`;

export function ModelRegistryPanel() {
  const query = useModelRegistry(), data = query.data;
  return <section className="model-registry" aria-label="모델 판본 기록">
    <header><div><span>MODEL VERSIONS · REGISTRY</span><h2>모델 판본 · 실제 학습 {data ? data.models.length : '–'}개</h2></div><button onClick={() => void query.refetch()} disabled={query.isFetching}>↻ 판본 다시 읽기</button></header>
    {query.error && <p className="model-registry-error" role="alert">{data ? '판본 기록을 다시 읽지 못해 마지막 성공 자료를 표시합니다.' : '판본 기록을 읽거나 확인하지 못했습니다.'} <code>{query.error.message}</code></p>}
    {!data ? <p className="model-registry-pending">검증된 판본 기록을 확인합니다.</p> : <>
      <div className="model-registry-scroll"><table><thead><tr><th>판본</th><th>학습 경로</th><th>깊이</th><th>라운드</th><th>MAE</th><th>RMSE</th><th>재사용 DEV 기준</th></tr></thead><tbody>
        {data.models.map(m => <tr key={m.id} className={m.bestObservedDevModel ? 'best' : ''}>
          <td><strong>{m.id.replace('SEAT.', '')}</strong>{m.bestObservedDevModel && <em>해당 실행 최저 MAE</em>}<small>{m.runId ?? '실행 ID 미기록'}</small></td>
          <td>{path(m)}</td><td>{m.maxDepth ?? '–'}</td><td>{m.totalRounds}</td>
          <td title={`원값 MAE ${m.MAE}`}>{seats(m.MAE)}</td><td title={`원값 RMSE ${m.RMSE}${m.MSE !== null ? ` · MSE ${m.MSE}` : ''}`}>{seats(m.RMSE)}</td>
          <td>{gate(m)}</td></tr>)}
      </tbody></table></div>
      <p className="model-registry-lineage">계보: {data.lineage.map(e => `${e.from.replace('SEAT.', '')} → ${e.to.replace('SEAT.', '')} (+${e.additionalRounds})`).join(' · ')} · 부모 없는 새 학습 {data.models.filter(m => m.parentModelId === null && m.gateBaselineModelId !== null).map(m => m.id.replace('SEAT.', '')).join('·')}</p>
      <p className="model-registry-note">{data.note} 판본 점수는 10/22에 H를 정하기 전에 DEV 전체로 낸 값이라 지금의 H 4일이 들어 있습니다. 채택된 판본은 없습니다.</p>
      <details><summary>모델·기록 해시</summary><dl>{data.models.map(m => <div key={m.id}><dt>{m.id}</dt><dd><code title={m.artifactSha256}>model {short(m.artifactSha256)}</code> <code title={m.recordSha256}>record {short(m.recordSha256)}</code></dd></div>)}</dl></details>
      <footer>레지스트리 index <code title={data.registryIndexSha256}>{short(data.registryIndexSha256)}</code> · 생성 {new Date(data.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST · {data.origin}</footer>
    </>}
  </section>;
}
