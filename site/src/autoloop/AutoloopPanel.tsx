import { useAutoloopReport } from './connection.ts';
import type { HFinal } from './types.ts';
import { count, seatDelta, seats } from '../route-report/presentation.ts';
import '../route-report/route-report.css';
import './autoloop.css';
import { PUBLIC_SITE, siteUrl } from '../site/env.ts';

const usd = (v: number | null) => v === null ? '—' : `$${v.toFixed(2)}`;
const ci = (v: [number, number] | null) => v === null ? '—' : `[${seatDelta(v[0])}, ${seatDelta(v[1])}]`;
const GUARD_LABEL: Record<string, string> = { unseenRouteMAE: '학습에 없던 노선', routeMacroMAE: '노선 평균', fullBusUnder2Share: '만석 예보', over10Share: '10석 이상 오류' };
const STATE_LABEL: Record<string, string> = { STOP_FILE: '사용자 정지', NO_IMPROVEMENT_ROUNDS: '연속 미개선', INFRASTRUCTURE_FAILURES: '연속 장애', BUDGET_EXHAUSTED: '예산 소진', PLANNER_FAILED: '플래너 실패', GENERATION_FAILED: '생성 실패', OVER_BUDGET: '예산 초과 명세', STOP_UNCONFIRMED: 'Pod 정지 미확인', H_ALREADY_OPENED: 'H를 이미 열었음', JUDGE_STOP: '심사 AI 정지 판단', ANOMALY_SUSPECTED: '이상 의심 정지', JUDGE_FAILED: '심사 실패', AI_BUDGET_EXHAUSTED: 'AI 예산 소진', DESIGN_DEADLOCKS: '설계 교착 2회' };
const EVENT_LABEL: Record<string, string> = { LOOP_START: '루프 시작', PLANNING: '플래너가 다음 실험 설계 중', GENERATING: '실행 패키지 생성과 사전 시험 중', LAUNCHING: 'Pod 실행 준비', LAUNCH_CAPACITY_MISSING: 'GPU(L40S) 자리 대기 중', LAUNCH_CAPACITY_LOW: 'GPU 자리 확인됨', LAUNCH_CAPACITY_MEDIUM: 'GPU 자리 확인됨', LAUNCH_CAPACITY_HIGH: 'GPU 자리 확인됨', LAUNCH_DRY_RUN_OK: '사전 점검 통과', LAUNCH_PREPARED: 'Pod 준비 완료', LAUNCH_WATCHDOG_ARMED: 'Pod에서 학습·평가 중', LAUNCH_PARENT_EXIT: '결과 회수 중', RUN_COMPLETED: '바퀴 완료', RUN_FAILED: '바퀴 실패', PLANNED: '플래너가 다음 실험을 정함', DESIGN_DEADLOCK: '설계 교착 · 다시 설계', AI_BUDGET_STOP: 'AI 예산이 모자라 설계 중단', JUDGED: '심사 AI 판정 끝', JUDGE_FAILED: '심사 실패' };

export function AutoloopPanel() {
  const query = useAutoloopReport(), data = query.data;
  return <section className="full-learning-batch route-report autoloop" aria-label="자율 개선 루프">
    <header><div><span>AUTONOMOUS IMPROVEMENT LOOP · DEV_S ONLY · H NOT USED FOR SELECTION</span><h2>자율 개선 루프 · 플래너가 다음 실험을 스스로 정합니다</h2></div><div className="autoloop-actions"><a href={siteUrl('autoloop-route.html')}>노선도 보기</a><button onClick={() => void query.refetch()} disabled={query.isFetching}>↻ 루프 다시 읽기</button></div></header>
    {query.error && <div role="alert" className="full-learning-batch-error">{data ? '최신 루프 기록을 읽지 못해 마지막 성공 자료를 표시합니다.' : query.error.message.endsWith('HTTP_404') ? '자율 루프 기록(autoloop-report.json)이 아직 게시되지 않았습니다.' : '자율 루프 기록을 읽거나 검증하지 못했습니다.'}<code>{query.error.message}</code></div>}
    {!data ? <p className="full-learning-batch-pending">검증된 루프 기록을 기다립니다.</p> : <>
      <div className="route-report-summary">
        <div><span>상태</span><strong>{data.state.running ? '진행 중' : '정지'}</strong><small>{data.state.running ? `${EVENT_LABEL[data.state.lastEvent ?? ''] ?? data.state.lastEvent ?? '—'} · ${data.state.lastEventAt ?? ''} KST` : `정지 사유 ${STATE_LABEL[data.state.stopReason ?? ''] ?? data.state.stopReason ?? '—'}`}</small></div>
        <div><span>현재 챔피언</span><strong>{data.champion.modelId.replace('SEAT.', '')}</strong><small>DEV-S MAE {data.champion.devSMAE === null ? '첫 바퀴 뒤 측정' : seats(data.champion.devSMAE, 'MAE')} · {String(data.champion.spec.objective)} · depth {String(data.champion.spec.depth)} · {count(data.champion.spec.rounds as number)}라운드</small></div>
        <div><span>GPU 비용</span><strong>{usd(data.state.spentTotalUSD)}</strong><small>오늘 {usd(data.state.spentTodayUSD)} / 하루 {usd(data.policy.budget.perDayUSD)} · 총 한도 {usd(data.policy.budget.totalUSD)} · 회당 {usd(data.policy.budget.perRunUSD)}</small></div>
        <div><span>연속 미개선</span><strong>{data.state.consecutiveNoImprovement} / {data.policy.stop.noImprovementRounds}</strong><small>한도에 닿으면 H로 최종 확인 · 연속 장애 {data.state.consecutiveInfraFailures} / {data.policy.stop.consecutiveInfrastructureFailures}</small></div>
      </div>
      {data.hFinal && <HFinalView h={data.hFinal}/>}
      {data.championHistory.length > 0 && <div className="autoloop-history">{data.championHistory.map(h => <p key={h.runId}><b>{h.runId}</b> {h.from.replace('SEAT.', '')} → {h.to.replace('SEAT.', '')} · DEV-S MAE {seats(h.previousDevSMAE, 'MAE')} → {seats(h.devSMAE, 'MAE')}</p>)}</div>}
      {data.runs.length === 0 && <p className="full-learning-batch-pending">첫 바퀴가 진행 중입니다. 결과가 나오면 여기에 바퀴마다 가설·후보·판정이 쌓입니다.</p>}
      {data.runs.map(run => <details key={run.runId} className="autoloop-run" open={run === data.runs[0]}>
        <summary><b>{run.runId}</b> · {run.experimentId} · {run.status === 'COMPLETED' ? (run.championAfter !== run.championBefore ? `챔피언 교체 → ${run.championAfter.replace('SEAT.', '')}` : '챔피언 유지') : `장애 · ${run.failure ?? ''}`} · 비용 {usd(run.actualUSD)}</summary>
        <p className="autoloop-hypothesis"><b>가설</b> {run.hypothesis}</p>
        {run.rationale && <p className="autoloop-rationale"><b>근거</b> {run.rationale}</p>}
        {run.status === 'COMPLETED' && <p className="autoloop-rationale">실행 전 챔피언 DEV-S MAE {seats(run.championBeforeMAE, 'MAE')} · 운영 예보 {seats(run.productMAE, 'MAE')}</p>}
        <div className="full-learning-batch-table"><table><thead><tr><th>후보</th><th>방식</th><th>목적함수</th><th>입력 · 구간</th><th>depth · eta · 라운드</th><th>MAE</th><th>챔피언 대비</th><th>95% 구간</th><th>판정</th></tr></thead><tbody>
          {run.candidates.map(c => <tr key={c.candidate} className={c.gatePassed ? 'best' : ''}><td><b>{c.candidate}</b>{c.note && <small>{c.note}</small>}</td><td>{c.kind} · {c.head}</td><td>{c.objective ?? '—'}</td><td>{c.features} · {c.blocks === 'NONE' ? '통합' : '노선×거리'}</td>
            <td>{c.depth ?? '—'} · {c.eta ?? '—'} · {c.rounds === null ? '—' : count(c.rounds)}</td><td>{c.head === 'FULL' ? (c.Brier === null ? '—' : `Brier ${c.Brier.toFixed(4)}`) : seats(c.MAE, 'MAE')}</td><td>{seatDelta(c.deltaMAE)}</td><td>{ci(c.deltaMAECI95)}</td>
            <td>{c.gatePassed === null ? (c.head === 'FULL' ? '만석 확률' : '—') : c.gatePassed ? '통과' : c.guardsWorsened.length ? `보호 지표 악화: ${c.guardsWorsened.map(g => GUARD_LABEL[g] ?? g).join(', ')}` : '개선 유의하지 않음'}</td></tr>)}
        </tbody></table></div>
      </details>)}
      <div className="full-learning-batch-notes"><p>판정은 DEV-S(10/12·14·16·17)에서만 합니다. H(10/13·15·18·19)는 연속 미개선 상한, 총예산 소진, 심사 AI의 정지 판단 가운데 하나로 루프가 끝날 때만 챔피언 하나로 한 번 확인합니다. 장애나 수동 정지로 멈출 때는 열지 않습니다. 구간은 (운행일 × 시간) 블록 부트스트랩 95%입니다.</p>
        <p>H는 자율 루프가 후보를 고를 때 쓰지 않으려고 떼어 둔 4일이며, 한 번도 쓰지 않은 자료는 아닙니다. 10/22에 H를 정하기 전의 보고서와 시작 챔피언 V2_D8 선택에는 이 4일이 들어 있는 DEV 전체를 썼습니다. 그래서 V2_D8과 운영 예보의 H 점수는 공개된 DEV 전체·DEV-S 점수로 대략 계산할 수 있습니다.</p>
        <p className="route-report-claims"><span>DEV 재사용</span><span>H는 루프 선택에서만 제외</span><span>채택 없음</span><span>사람 승인 없이 예산 안에서 자동 실행</span></p></div>
      <footer>상태 자료 작성 {new Date(data.servedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })} KST · {PUBLIC_SITE ? '공개 사본 · 배포 시점 자료' : '10초마다 읽기 전용 확인'} · {data.schema}</footer>
    </>}
  </section>;
}

const H_STATUS: Record<HFinal['status'], string> = { COMPLETED: '완료', RUNNING: '진행 중', REPRODUCTION_FAILED_SEALED: '재현 실패 · H는 열지 않음', FAILED_AFTER_OPENING: 'H를 연 뒤 실패' };
const pct = (v: number | null) => v === null ? '—' : `${(v * 100).toFixed(1)}%`;
function HFinalView({ h }: { h: HFinal }) {
  const rows = [['선택된 챔피언 · ' + h.champion.replace('SEAT.', ''), h.championMetrics], ['기준 V2_D8', h.referenceMetrics], ['운영 예보', h.productMetrics]] as const;
  return <div className="autoloop-hfinal">
    <p><b>H 최종 확인 · {H_STATUS[h.status]}</b> · {h.days.map(d => d.slice(5).replace('-', '/')).join('·')} · 정지 사유 {STATE_LABEL[h.reason] ?? h.reason}{h.rows !== null && ` · ${count(h.rows)}행 · ${h.blocks}블록`}{h.reproductionMaxAbsDiff !== null && ` · DEV-S 재현 최대 차이 ${h.reproductionMaxAbsDiff.toFixed(4)}석`}</p>
    {h.status === 'COMPLETED' && <div className="full-learning-batch-table"><table><thead><tr><th>모델</th><th>MAE</th><th>RMSE</th><th>노선 평균</th><th>학습에 없던 노선</th><th>10석 이상 오류</th><th>만석일 때 2석 미만 예보</th></tr></thead><tbody>
      {rows.map(([name, m]) => m && <tr key={name}><td><b>{name}</b></td><td>{seats(m.MAE, 'MAE')}</td><td>{seats(m.RMSE, 'MAE')}</td><td>{seats(m.routeMacroMAE, 'MAE')}</td><td>{m.unseenRouteMAE === null ? '—' : seats(m.unseenRouteMAE, 'MAE')}</td><td>{pct(m.over10Share)}</td><td>{pct(m.fullBusUnder2Share)}</td></tr>)}
    </tbody></table></div>}
    {h.status === 'COMPLETED' && <p>챔피언 − V2_D8 MAE 95% 구간 {ci(h.championVsReferenceCI95 as [number, number] | null)} · 챔피언 − 운영 예보 {ci(h.championVsProductCI95 as [number, number] | null)} · V2_D8 − 운영 예보 {ci(h.referenceVsProductCI95 as [number, number] | null)}</p>}
  </div>;
}
