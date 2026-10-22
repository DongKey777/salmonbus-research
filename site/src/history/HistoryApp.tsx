import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ResearchNav } from '../ui/ResearchNav';
import { SITE_MARK } from '../site/env.ts';
import { RangeChart } from './RangeChart';
import { SelectionPanel } from './SelectionPanel';
import { TrialTable } from './TrialTable';
import { useHistoryCatalog, useHistoryGroups, useHistoryModel, useHistoryRanges, useHistoryTrial } from './connection.ts';
import type { Anchor } from './connection.ts';
import { boundedWindow, lastWindow, resolveSelection } from './project.ts';
import { formatNumber, formatScore, formatTime, metricInfo, shortId } from './presentation.ts';
import type { Catalog, DisplayMode, Envelope, OrdinalWindow, TrialStatus } from './types.ts';
import { METRICS } from './types.ts';
import { SourceSelector } from './SourceSelector';
import { historySourceFromSearch, historySourceSearch } from './source.ts';
import type { HistorySourceMode } from './source.ts';
import { ActualHistoryWorkspace } from './actual/ActualHistoryWorkspace';
import './history.css';

const sameWindow = (a: OrdinalWindow, b: OrdinalWindow) => a.fromOrdinal === b.fromOrdinal && a.toOrdinal === b.toOrdinal;

export default function HistoryApp() {
  return <ActualHistoryWorkspace key="actual-v8" sourceSelector={null}/>;
}

export function FixtureHistoryWorkspace({ sourceSelector }: { sourceSelector: ReactNode }) {
  const groupQuery = useHistoryGroups();
  const [groupRef, setGroupRef] = useState('');
  const groups = groupQuery.data?.data.groups ?? [];
  const group = groups.find(item => item.groupRef === groupRef) ?? groups[0];
  const [status, setStatus] = useState<TrialStatus | ''>('');
  const [session, setSession] = useState(0);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [pageAnchor, setPageAnchor] = useState<Anchor | undefined>(undefined);
  const [firstPage, setFirstPage] = useState<Envelope<Catalog> | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [window, setWindow] = useState<OrdinalWindow | null>(null);
  const [mode, setMode] = useState<DisplayMode>('MIN_MAX');
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [windowError, setWindowError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const catalogRequest = useMemo(() => ({
    groupRef: group?.groupRef ?? '', status, cursor: cursors[page] ?? null, limit: 100,
  }), [group?.groupRef, status, cursors, page]);
  const catalogQuery = useHistoryCatalog(catalogRequest, session, Boolean(group), page > 0 ? pageAnchor : undefined, firstPage);
  const catalog = catalogQuery.data;
  const anchor = useMemo(() => pageAnchor ?? (catalog ? {
    historyGenerationId: catalog.historyGenerationId, snapshotCursor: catalog.snapshotCursor,
  } : null), [pageAnchor, catalog]);
  useEffect(() => {
    if (catalog && !pageAnchor) setPageAnchor({ historyGenerationId: catalog.historyGenerationId, snapshotCursor: catalog.snapshotCursor });
    if (catalog && page === 0 && !firstPage) setFirstPage(catalog);
  }, [catalog, pageAnchor, page, firstPage]);
  const extent = useMemo(() => {
    const value = groupQuery.data?.data.trialExtent;
    return value?.fromOrdinal != null && value.toOrdinal != null ? { fromOrdinal: value.fromOrdinal, toOrdinal: value.toOrdinal } : null;
  }, [groupQuery.data]);
  const focus = useMemo(() => extent ? boundedWindow(window ?? lastWindow(10000, extent), extent) : null, [window, extent]);
  const generationMatches = !catalog || !groupQuery.data || catalog.historyGenerationId === groupQuery.data.historyGenerationId;
  const rangeRequest = useMemo(() => anchor && group && focus && generationMatches ? {
    ...anchor, ...focus, groupRef: group.groupRef, mode, buckets: 128,
  } : null, [anchor, group, focus, mode, generationMatches]);
  const rangeQueries = useHistoryRanges(rangeRequest);
  const brierQuery = rangeQueries[0];
  const brier = brierQuery.data?.data;
  const row = resolveSelection(selectedId, catalog?.data.rows ?? []);
  const effectiveSelectedId = selectedId ?? row?.trialId ?? null;
  const trialQuery = useHistoryTrial(effectiveSelectedId, anchor);
  const trial = trialQuery.data?.data.trial ?? row;
  const modelQuery = useHistoryModel(trial, anchor);
  const busy = refreshing || catalogQuery.isFetching || rangeQueries.some(query => query.isFetching);
  const errors = [groupQuery.error, catalogQuery.error, ...rangeQueries.map(query => query.error), trialQuery.error, modelQuery.error].filter(Boolean);
  const hasAnyData = Boolean(catalog || rangeQueries.some(query => query.data));
  const rangeWidth = focus ? focus.toOrdinal - focus.fromOrdinal + 1 : 0;
  const resetCatalog = () => { setSession(value => value + 1); setPage(0); setCursors([null]); setPageAnchor(undefined); setFirstPage(undefined); };
  const changeGroup = (next: string) => { setGroupRef(next); setSelectedId(null); resetCatalog(); };
  const changeStatus = (next: TrialStatus | '') => { setStatus(next); resetCatalog(); };
  const changeWindow = (next: OrdinalWindow) => {
    if (!extent) return;
    const bounded = boundedWindow(next, extent);
    if (mode === 'RAW' && bounded.toOrdinal - bounded.fromOrdinal >= 2000) setMode('MIN_MAX');
    setWindow(bounded); setWindowError('');
  };
  useEffect(() => {
    setDraftFrom(focus ? String(focus.fromOrdinal) : '');
    setDraftTo(focus ? String(focus.toOrdinal) : '');
  }, [focus?.fromOrdinal, focus?.toOrdinal]);
  const applyWindow = () => {
    const fromOrdinal = Number(draftFrom), toOrdinal = Number(draftTo);
    if (!extent || !Number.isSafeInteger(fromOrdinal) || !Number.isSafeInteger(toOrdinal) ||
      fromOrdinal < extent.fromOrdinal || toOrdinal > extent.toOrdinal || toOrdinal < fromOrdinal ||
      toOrdinal - fromOrdinal >= 10000) {
      setWindowError('기록 범위 안에서 시작 ≤ 끝, 최대 10,000건을 입력하세요.'); return;
    }
    changeWindow({ fromOrdinal, toOrdinal });
  };
  const refreshCurrent = async () => {
    setRefreshing(true);
    try {
      // The original page is cached; rereading it without a signed cursor would move the snapshot.
      const reads: Promise<unknown>[] = rangeQueries.filter(query => query.data || query.error).map(query => query.refetch());
      if (effectiveSelectedId) reads.push(trialQuery.refetch());
      if (trial) reads.push(modelQuery.refetch());
      if (!catalog || page > 0) reads.push(catalogQuery.refetch());
      if (!groupQuery.data) reads.push(groupQuery.refetch());
      await Promise.allSettled(reads);
    } finally { setRefreshing(false); }
  };
  const latestSnapshot = async () => {
    setRefreshing(true);
    try { await groupQuery.refetch(); resetCatalog(); }
    finally { setRefreshing(false); }
  };
  const focusTrial = (ordinal: number) => {
    if (!extent) return;
    changeWindow({ fromOrdinal: Math.max(extent.fromOrdinal, ordinal - 99), toOrdinal: Math.min(extent.toOrdinal, ordinal + 100) });
    setMode('RAW');
    document.getElementById('history-range')?.scrollIntoView({ block: 'start', behavior: 'auto' });
  };
  return <div className="history-app">
    <a className="skip" href="#history-workbench">장기 개선 기록으로 이동</a>
    <header className="topbar">
      <div className="wordmark"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 14h4l3-8 4 13 3-8h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg><b>salmonbus</b><span>/</span><strong>Research</strong></div>
      <ResearchNav active="history"/><span className="history-local">{SITE_MARK}</span>
    </header>
    {sourceSelector}
    <div className="history-sourcebar"><span className="history-fixture-tag">인공 자료</span><strong>10,000건 메타데이터 부하 시험</strong><span>실제 학습·모델 실행 결과 아님</span><code>ARTIFICIAL_SCALE_FIXTURE</code></div>
    <main id="history-workbench" className="history-workbench">
      <div className="history-heading"><div><p>EXPERIMENT HISTORY</p><h1>장기 개선 기록 <span>조회·비교·신원 확인</span></h1></div>
        <div className="history-heading-actions"><span className={`history-connection ${errors.length || !generationMatches ? 'has-error' : catalog ? 'is-ready' : ''}`}><i/>{errors.length ? '읽기 오류' : catalog ? '스냅샷 고정됨' : '연결 중'}</span>
          <button disabled={busy} onClick={() => void refreshCurrent()} title="현재 스냅샷의 범위와 상세 자료를 다시 읽습니다.">↻ 다시 읽기</button>
          <button className="history-new-snapshot" disabled={busy} onClick={() => void latestSnapshot()}>최신 스냅샷 열기</button>
        </div>
      </div>
      {(errors.length > 0 || !generationMatches) && <div className="history-error" role="alert">
        <div><strong>{hasAnyData ? '일부 조회 실패 · 각 영역의 마지막 성공 응답을 표시합니다.' : '장기 개선 기록을 읽지 못했습니다.'}</strong>
          <span>{!generationMatches ? '자료 세대가 달라 최신 스냅샷을 다시 열어야 합니다.' : '범위와 선택은 유지됩니다. 다시 읽기로 재시도할 수 있습니다.'}</span></div>
        <details><summary>오류 코드</summary><code>{errors.map(error => error?.message).join(' · ') || 'HISTORY_GENERATION_MISMATCH'}</code></details>
      </div>}
      <section className="history-scope-panel" aria-label="비교 그룹과 스냅샷">
        <div className="history-group-control"><label htmlFor="history-group">비교 그룹</label><select id="history-group" value={group?.groupRef ?? ''} disabled={!groups.length} onChange={event => changeGroup(event.target.value)}>
          {!groups.length && <option value="">등록된 그룹 없음</option>}
          {groups.map((item, index) => <option key={item.groupRef} value={item.groupRef}>그룹 {index + 1} · {shortId(item.groupRef, 12)}</option>)}
        </select></div>
        <div className="history-scope-fact"><span>cohort</span><code title={group?.cohortRef}>{shortId(group?.cohortRef, 12)}</code></div>
        <div className="history-scope-fact"><span>scorer / policy</span><code title={`${group?.scorerRef ?? ''}\n${group?.policyRef ?? ''}`}>{shortId(group?.scorerRef, 8)} / {shortId(group?.policyRef, 8)}</code></div>
        <div className="history-scope-fact history-snapshot-fact"><span>고정 snapshot</span><code>{anchor ? formatNumber(anchor.snapshotCursor) : '—'}</code><small title={anchor?.historyGenerationId}>{shortId(anchor?.historyGenerationId, 16)}</small></div>
      </section>
      <div className="history-scope-note"><span>cohort · scorer · policy가 같은 그룹만 비교합니다.</span><span>평가 순서에 따른 관측 통계 · 모든 지표는 낮을수록 유리</span></div>
      <div className="history-workspace">
        <div className="history-analysis">
          <section id="history-range" className="history-panel history-hero" aria-label="Brier 장기 개선 그래프" aria-busy={brierQuery.isFetching}>
            <header className="history-panel-head"><div><h2>Brier <span>만석 확률 예측 오차</span></h2><p>개선 기록 순번으로 읽는 평가 결과 · 학습 epoch 아님</p></div><span className="history-method">{group?.metricMethods.Brier ?? 'BRIER_V1'}</span></header>
            <div className="history-windowbar">
              <div className="history-presets" aria-label="최근 기록 범위">{[10000, 2000, 500].map(size => <button key={size} disabled={!extent} className={extent && focus && sameWindow(focus, lastWindow(size, extent)) ? 'active' : ''} onClick={() => extent && changeWindow(lastWindow(size, extent))}>{size === 10000 ? '전체 10k' : `최근 ${formatNumber(size)}`}</button>)}</div>
              <form className="history-window-inputs" onSubmit={event => { event.preventDefault(); applyWindow(); }}>
                <input aria-label="시작 기록 순번" inputMode="numeric" value={draftFrom} onChange={event => setDraftFrom(event.target.value)} disabled={!extent}/><span>—</span>
                <input aria-label="끝 기록 순번" inputMode="numeric" value={draftTo} onChange={event => setDraftTo(event.target.value)} disabled={!extent}/><button disabled={!extent}>적용</button>
              </form>
              <div className="history-mode" aria-label="차트 표시 방식"><button className={mode === 'MIN_MAX' ? 'active' : ''} aria-pressed={mode === 'MIN_MAX'} onClick={() => setMode('MIN_MAX')}>Min–max 요약</button><button className={mode === 'RAW' ? 'active' : ''} aria-pressed={mode === 'RAW'} disabled={rangeWidth > 2000 || !focus} title={rangeWidth > 2000 ? '원점수는 범위를 2,000건 이하로 좁혀 확인합니다.' : '범위 안의 모든 원점수'} onClick={() => setMode('RAW')}>원점수</button></div>
            </div>
            {windowError && <p className="history-window-error" role="alert">{windowError}</p>}
            <div className="history-range-summary"><div><span>범위 끝까지 관측한 최저 Brier</span><strong>{formatScore(brier?.observedBestSoFar.end?.value)}</strong><small>{brier?.observedBestSoFar.end ? `#${formatNumber(brier.observedBestSoFar.end.trialOrdinal)} · 원점수 누적 최저` : '유효 점수 없음'}</small></div>
              <div className="history-summary-secondary"><span>창 시작 전 최저</span><b>{formatScore(brier?.observedBestSoFar.carryIn?.value)}</b><small>carry-in</small></div>
              <div className="history-summary-secondary history-adoption"><span>채택 모델</span><b>미제공</b><small>채택 근거 없음 · null</small></div>
              <div className="history-chart-legend"><span><i className="history-legend-point"/>실제 유효 표본</span>{mode === 'MIN_MAX' && <><span><i className="history-legend-band"/>min–max 범위</span><span><i className="history-legend-gap"/>결측 포함 구간</span></>}</div>
            </div>
            {brierQuery.error && <div className="history-inline-error">{brier ? 'Brier 재조회 실패 · 이전 성공 응답 표시' : 'Brier 범위를 읽지 못했습니다.'}</div>}
            <div className="history-hero-chart">{brier ? <RangeChart range={brier} selectedId={effectiveSelectedId} main onSelect={setSelectedId} onWindow={changeWindow}/> : <div className="history-empty">{brierQuery.isFetching ? '선택한 범위의 Brier를 읽고 있습니다.' : extent ? '표시할 Brier 범위가 없습니다.' : '기록이 아직 없습니다.'}</div>}</div>
            <div className="history-count-strip"><span>범위 내 <b>{formatNumber(brier?.counts.totalTrials)}</b></span><span>유효 <b>{formatNumber(brier?.counts.validCount)}</b></span><span>미산출 <b>{formatNumber(brier?.counts.nullCount)}</b></span><span>무효 <b>{formatNumber(brier?.counts.invalidCount)}</b></span><span>미등록 <b>{formatNumber(brier?.counts.unregisteredCount)}</b></span><span className="history-count-status">실패 {formatNumber(brier?.counts.failedCount)} · 보류 {formatNumber(brier?.counts.heldCount)} · 진행 {formatNumber(brier?.counts.runningCount)}</span></div>
            <footer className="history-chart-foot"><span>{mode === 'MIN_MAX' ? '요약은 실제 first / last / min / max 표본입니다. 결측 포함 구간은 선으로 연결하지 않습니다.' : '선택 그룹의 원점수 전체 · 미산출·무효·미등록 값은 빈 구간으로 유지합니다.'}</span><span>{mode === 'MIN_MAX' ? `${formatNumber(brier?.buckets.length)} 구간` : `${formatNumber(brier?.points.length)} 점`} · {formatTime(brierQuery.data?.servedAt)} KST{brierQuery.isFetching ? ' · 갱신 중' : ''}</span></footer>
          </section>
          <div className="history-chart-help"><span>하단 슬라이더 또는 Ctrl + 휠로 범위를 좁히면 해당 범위를 다시 조회합니다.</span><span>정확한 결측 위치: 2,000건 이하에서 원점수 선택</span></div>
          <div className="history-small-grid">{METRICS.slice(1).map((metric, index) => {
            const query = rangeQueries[index + 1], range = query.data?.data;
            return <section key={metric} className="history-panel history-small-panel" aria-label={`${metricInfo[metric].label} 보조 지표`}>
              <header className="history-panel-head"><div><h2>{metricInfo[metric].label}</h2><p>{metricInfo[metric].description}</p></div><strong style={{ color: metricInfo[metric].color }}>{formatScore(range?.observedBestSoFar.end?.value, metric)}</strong></header>
              {query.error && <div className="history-inline-error">{range ? '재조회 실패 · 이전 성공 응답' : '조회 실패'}</div>}
              <div className="history-small-chart">{range ? <RangeChart range={range} selectedId={effectiveSelectedId} onSelect={setSelectedId}/> : <div className="history-empty">{query.isFetching ? '범위 조회 중' : '유효 자료 없음'}</div>}</div>
              <footer className="history-chart-foot"><span>관측 최저 · 채택 아님</span><span>유효 {formatNumber(range?.counts.validCount)} / {formatNumber(range?.counts.totalTrials)}</span></footer>
            </section>;
          })}</div>
          <div className="history-catalog-note"><span>목록은 선택 그룹 전체를 최신순으로 탐색합니다. 그래프의 표시 범위와 별도입니다.</span><span>상태 필터는 목록에만 적용</span></div>
          {catalogQuery.error && <div className="history-inline-error">{catalog ? '목록 재조회 실패 · 이전 성공 페이지 표시' : '목록 조회 실패'}</div>}
          <TrialTable catalog={catalog?.data} selectedId={effectiveSelectedId} page={page} status={status} busy={catalogQuery.isFetching}
            onSelect={setSelectedId} onStatus={changeStatus} onPrevious={() => setPage(value => Math.max(0, value - 1))}
            onNext={() => {
              const next = catalog?.data.page.nextCursor;
              if (!next || !catalog) return;
              setCursors(previous => [...previous.slice(0, page + 1), next]); setPage(value => value + 1);
            }}/>
        </div>
        <SelectionPanel trial={trial} model={modelQuery.data?.data.model} loading={trialQuery.isFetching || modelQuery.isFetching}
          error={Boolean(trialQuery.error || modelQuery.error)} onFocus={focusTrial}/>
      </div>
      <footer className="history-footer"><span>인공 메타데이터 10k 조회 시험 · 실제 10k 학습이나 모델 성능을 의미하지 않습니다.</span><span>동일 비교 그룹만 표시 · 관측 최저와 채택을 구분 · 읽기 전용</span></footer>
    </main>
  </div>;
}
