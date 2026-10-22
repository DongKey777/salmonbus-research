import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ResearchNav } from '../../ui/ResearchNav';
import { SITE_MARK } from '../../site/env.ts';
import { boundedWindow, lastWindow } from '../project.ts';
import { formatNumber, formatTime, shortId } from '../presentation.ts';
import type { DisplayMode, OrdinalWindow, TrialStatus } from '../types.ts';
import { ActualRangeChart } from './ActualRangeChart';
import { ActualInspector } from './ActualInspector';
import { ActualTrialTable } from './ActualTrialTable';
import { useActualCatalog, useActualGroups, useActualInvalidations, useActualModel, useActualRanges, useActualReference, useActualTrial } from './connection.ts';
import { ACTUAL_METRICS } from './types.ts';
import type { GroupsResponse } from './types.ts';
import { metricInfo } from './presentation.ts';
import { MetricUnitControl, useMetricMode } from '../../metrics/MetricPresentation';
import { formatMetric, metricSpec, metricTooltip } from '../../metrics/display.ts';
import './actual-history.css';

export function ActualHistoryWorkspace({ sourceSelector }: { sourceSelector: ReactNode }) {
  const { mode: metricMode } = useMetricMode();
  const brierSpec = metricSpec('Brier', metricMode);
  const groupsQuery = useActualGroups();
  const [active, setActive] = useState<GroupsResponse | null>(null);
  const [groupRef, setGroup] = useState('');
  const [status, setStatus] = useState<TrialStatus | ''>('');
  const [cursors, setCursors] = useState<(string | null)[]>([null]), [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null), [inspectReference, setInspectReference] = useState(false);
  const [window, setWindow] = useState<OrdinalWindow | null>(null), [displayMode, setDisplayMode] = useState<DisplayMode>('RAW');
  const [draftFrom, setDraftFrom] = useState(''), [draftTo, setDraftTo] = useState(''), [windowError, setWindowError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    if (groupsQuery.data && (!active || active.data.groups.length === 0 && groupsQuery.data.data.groups.length > 0)) setActive(groupsQuery.data);
  }, [groupsQuery.data, active]);
  const groups = active?.data.groups ?? [], group = groups.find(value => value.groupRef === groupRef) ?? groups[0];
  const anchor = useMemo(() => active ? { historyGenerationId: active.historyGenerationId, snapshotCursor: active.snapshotCursor } : null, [active]);
  const stream = useActualInvalidations(anchor);
  const extent = useMemo(() => active?.data.trialExtent.fromOrdinal != null && active.data.trialExtent.toOrdinal != null ?
    { fromOrdinal: active.data.trialExtent.fromOrdinal, toOrdinal: active.data.trialExtent.toOrdinal } : null, [active]);
  const focus = useMemo(() => extent ? boundedWindow(window ?? lastWindow(10000, extent), extent) : null, [window, extent]);
  const width = focus ? focus.toOrdinal - focus.fromOrdinal + 1 : 0;
  const mode = displayMode === 'RAW' && width > 2000 ? 'MIN_MAX' : displayMode;
  const catalogRequest = useMemo(() => anchor && group ? { ...anchor, groupRef: group.groupRef, status, limit: 100, cursor: cursors[page] ?? null } : null, [anchor, group, status, cursors, page]);
  const catalogQuery = useActualCatalog(catalogRequest), catalog = catalogQuery.data?.data;
  const rangeRequest = useMemo(() => anchor && group && focus ? { ...anchor, ...focus, groupRef: group.groupRef, mode, buckets: 128 } : null, [anchor, group, focus, mode]);
  const rangeQueries = useActualRanges(rangeRequest), brierQuery = rangeQueries[0], brier = brierQuery.data?.data;
  const row = selectedId === null ? catalog?.rows[0] : catalog?.rows.find(value => value.trialId === selectedId);
  const effectiveId = selectedId ?? row?.trialId ?? null;
  const trialQuery = useActualTrial(effectiveId, anchor, group), trial = trialQuery.data?.data.trial ?? row;
  const modelQuery = useActualModel(trial, anchor, group, !inspectReference), referenceQuery = useActualReference(anchor, group);
  const reference = referenceQuery.data?.data.reference;
  const support = reference?.support ?? catalog?.rows[0]?.support;
  const provenance = active?.provenance;
  const busy = refreshing || groupsQuery.isFetching || catalogQuery.isFetching || rangeQueries.some(query => query.isFetching);
  const errors = [groupsQuery.error, catalogQuery.error, ...rangeQueries.map(query => query.error), referenceQuery.error,
    ...(inspectReference ? [] : [trialQuery.error, modelQuery.error])].filter(Boolean);
  const newer = Boolean(active && groupsQuery.data && (groupsQuery.data.historyGenerationId !== active.historyGenerationId || groupsQuery.data.snapshotCursor > active.snapshotCursor));
  useEffect(() => { setDraftFrom(focus ? String(focus.fromOrdinal) : ''); setDraftTo(focus ? String(focus.toOrdinal) : ''); }, [focus?.fromOrdinal, focus?.toOrdinal]);
  const resetPage = () => { setPage(0); setCursors([null]); };
  const selectTrial = (id: string) => { setSelectedId(id); setInspectReference(false); };
  const changeWindow = (next: OrdinalWindow) => { if (extent) { setWindow(boundedWindow(next, extent)); setWindowError(''); } };
  const applyWindow = () => {
    const fromOrdinal = Number(draftFrom), toOrdinal = Number(draftTo);
    if (!extent || !Number.isSafeInteger(fromOrdinal) || !Number.isSafeInteger(toOrdinal) || fromOrdinal < extent.fromOrdinal ||
      toOrdinal > extent.toOrdinal || toOrdinal < fromOrdinal || toOrdinal - fromOrdinal >= 10000) { setWindowError('등록 범위 안에서 시작 ≤ 끝, 최대 10,000건을 입력하세요.'); return; }
    changeWindow({ fromOrdinal, toOrdinal });
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      const reads: Promise<unknown>[] = [groupsQuery.refetch()];
      if (catalogRequest) reads.push(catalogQuery.refetch());
      if (rangeRequest) reads.push(...rangeQueries.map(query => query.refetch()));
      if (group && anchor) reads.push(referenceQuery.refetch());
      if (effectiveId && group && anchor) reads.push(trialQuery.refetch());
      if (trial && !inspectReference && group && anchor) reads.push(modelQuery.refetch());
      await Promise.allSettled(reads);
    } finally { setRefreshing(false); }
  };
  const openLatest = async () => {
    setRefreshing(true);
    try {
      const result = await groupsQuery.refetch();
      if (result.data && !result.error) {
        if (active?.historyGenerationId !== result.data.historyGenerationId) { setWindow(null); setGroup(''); setSelectedId(null); setInspectReference(false); }
        setActive(result.data); resetPage();
      }
    } finally { setRefreshing(false); }
  };
  const focusTrial = (ordinal: number) => {
    if (!extent) return;
    changeWindow({ fromOrdinal: Math.max(extent.fromOrdinal, ordinal - 99), toOrdinal: Math.min(extent.toOrdinal, ordinal + 100) });
    setDisplayMode('RAW');
    document.getElementById('actual-history-range')?.scrollIntoView({ block: 'start', behavior: 'auto' });
  };
  return <div className="history-app history-actual-app">
    <a className="skip" href="#actual-history-workbench">실제 연구 이력으로 이동</a>
    <header className="topbar"><div className="wordmark"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 14h4l3-8 4 13 3-8h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg><b>salmonbus</b><span>/</span><strong>Research</strong></div><ResearchNav active="history"/><span className="history-local">{SITE_MARK}</span></header>
    {sourceSelector}
    <div className="history-actual-sourcebar"><span>실제 관측</span><strong>완료 연구의 모델·평가 메타데이터</strong><small>개발 V 재사용 · H 미봉인 · 미채택</small><code>REAL_OBSERVATION_EXECUTION</code></div>
    <main id="actual-history-workbench" className="history-workbench">
      <div className="history-heading"><div><p>ACTUAL RESEARCH HISTORY</p><h1>실제 연구 이력 <span>범위 비교 · 모델 선택 · 불변 신원 확인</span></h1></div><div className="history-heading-actions"><span className={`history-connection ${errors.length ? 'has-error' : catalog ? 'is-ready' : ''}`}><i/>{errors.length ? '읽기 오류' : stream === 'connected' ? '스냅샷 연결' : active ? '고정 스냅샷' : '연결 중'}</span><button disabled={busy} onClick={() => void refresh()}>↻ 다시 읽기</button><button className="history-new-snapshot" disabled={busy} onClick={() => void openLatest()}>{newer ? '새 기록 · 최신 스냅샷 열기' : '최신 스냅샷 열기'}</button></div></div>
      <div className="history-actual-main-unit-control"><MetricUnitControl/><p className="history-metric-scope">표시 환산은 원값 점수·순위·판정을 바꾸지 않습니다.</p></div>
      {errors.length > 0 && <div className="history-error" role="alert"><div><strong>{active ? '실제 이력 조회 실패 · 각 영역의 마지막 성공 응답을 유지합니다.' : '실제 연구 이력을 읽지 못했습니다.'}</strong><span>현재 자료 선택은 실제 연구로 유지됩니다.</span></div><details><summary>오류 코드</summary><code>{errors.map(error => error?.message).join(' · ')}</code></details></div>}
      <section className="history-scope-panel" aria-label="실제 이력 비교 범위"><div className="history-group-control"><label htmlFor="actual-history-group">같은 V 그룹</label><select id="actual-history-group" value={group?.groupRef ?? ''} disabled={!groups.length} onChange={event => { setGroup(event.target.value); setSelectedId(null); setInspectReference(false); resetPage(); }}>{!groups.length && <option value="">등록된 비교 그룹 없음</option>}{groups.map((item, index) => <option key={item.groupRef} value={item.groupRef}>그룹 {index + 1} · {shortId(item.groupRef, 12)}</option>)}</select></div><div className="history-scope-fact"><span>검증된 보고 건수</span><code>T {formatNumber(provenance?.trainingRows)} · V {formatNumber(provenance?.validationRows)}</code></div><div className="history-scope-fact"><span>후보 평가 순번</span><code>{extent ? `${formatNumber(extent.fromOrdinal)}–${formatNumber(extent.toOrdinal)}` : '—'}</code></div><div className="history-scope-fact history-snapshot-fact"><span>원자 bundle commit</span><code>{formatNumber(anchor?.snapshotCursor)}</code><small title={anchor?.historyGenerationId}>{shortId(anchor?.historyGenerationId, 16)}</small></div></section>
      <div className="history-scope-note"><span>같은 V 모집단·정답·가중치·시간·grouping·scorer·판정 정책·제품 기준으로 비교합니다.</span><span>자료 기간 미제공 · 실행 날짜로 채우지 않음</span></div>
      {group && extent ? <>
        <div className="history-actual-reference-row"><button className={inspectReference ? 'selected' : ''} disabled={!reference} onClick={() => setInspectReference(true)}><span>별도 외부 기준</span><strong>당시 제품 예보</strong><small>새 모델·fit 아님 · modelId/revision null</small><b title={metricTooltip(reference?.metrics.Brier, 'Brier', metricMode)}>{brierSpec.label} {formatMetric(reference?.metrics.Brier, 'Brier', metricMode, true)}<em title={metricTooltip(reference?.metrics.MAE, 'MAE', metricMode)}>{metricSpec('MAE', metricMode).label} {formatMetric(reference?.metrics.MAE, 'MAE', metricMode, true)}</em></b></button><div><span>같은 개발 V 구성</span><strong>{formatNumber(support?.rows)}행 · {formatNumber(support?.groups)}평가 그룹</strong><small>만석 그룹 {formatNumber(support?.fullGroups)} · 비만석 그룹 {formatNumber(support?.nonFullGroups)} · 재표본화 구성요소 {formatNumber(support?.resamplingComponents)}</small></div></div>
        {support?.fullGroups === 0 && <div className="history-actual-class-note" role="note"><strong>검증 V에 만석 그룹이 0개입니다.</strong><span>이 자료로 만석 탐지 성능을 판단할 수 없습니다. 낮은 Brier나 관측 최저값은 운영 개선·채택 근거가 아닙니다.</span></div>}
        <div className="history-workspace"><div className="history-analysis">
          <section id="actual-history-range" className="history-panel history-hero" aria-label="실제 이력 Brier 범위" aria-busy={brierQuery.isFetching}>
            <header className="history-panel-head"><div><h2>{brierSpec.label} <span>{brierSpec.title} · {brierSpec.unit}</span></h2><p title={brierSpec.explanation}>개별 등록 점수와 고정 제품 기준 · 후보 평가 순번 · 학습 epoch 아님</p></div><span className="history-method">{mode === 'RAW' ? '개별 평가점' : 'MIN_MAX'}</span></header>
            <div className="history-windowbar"><div className="history-presets"><button className={focus?.fromOrdinal === Math.max(extent.fromOrdinal, extent.toOrdinal - 9999) && focus?.toOrdinal === extent.toOrdinal ? 'active' : ''} onClick={() => changeWindow(lastWindow(10000, extent))}>{extent.toOrdinal - extent.fromOrdinal < 10000 ? `전체 ${formatNumber(extent.toOrdinal - extent.fromOrdinal + 1)}건` : '최근 10,000'}</button>{[2000, 500].filter(size => extent.toOrdinal - extent.fromOrdinal + 1 > size).map(size => <button key={size} onClick={() => changeWindow(lastWindow(size, extent))}>최근 {formatNumber(size)}</button>)}</div>
              <form className="history-window-inputs" onSubmit={event => { event.preventDefault(); applyWindow(); }}><input aria-label="실제 이력 시작 순번" value={draftFrom} inputMode="numeric" onChange={event => setDraftFrom(event.target.value)}/><span>—</span><input aria-label="실제 이력 끝 순번" value={draftTo} inputMode="numeric" onChange={event => setDraftTo(event.target.value)}/><button>적용</button></form>
              <div className="history-mode" aria-label="평가점 집계 방식"><button className={mode === 'RAW' ? 'active' : ''} aria-pressed={mode === 'RAW'} disabled={width > 2000} onClick={() => setDisplayMode('RAW')}>개별 평가점</button><button className={mode === 'MIN_MAX' ? 'active' : ''} aria-pressed={mode === 'MIN_MAX'} onClick={() => setDisplayMode('MIN_MAX')}>Min–max 요약</button></div></div>
            {windowError && <p className="history-window-error" role="alert">{windowError}</p>}
            <div className="history-range-summary"><div title={metricTooltip(brier?.observedBestSoFar.end?.value, 'Brier', metricMode)}><span>범위 끝까지 관측한 최저 {brierSpec.label} · {brierSpec.unit}</span><strong>{formatMetric(brier?.observedBestSoFar.end?.value, 'Brier', metricMode)}</strong><small>{brier?.observedBestSoFar.end ? `후보 평가 #${brier.observedBestSoFar.end.trialOrdinal}` : '유효 점수 없음'} · 채택 아님</small></div><div className="history-summary-secondary" title={metricTooltip(brier?.observedBestSoFar.carryIn?.value, 'Brier', metricMode)}><span>창 시작 전 최저 · {brierSpec.unit}</span><b>{formatMetric(brier?.observedBestSoFar.carryIn?.value, 'Brier', metricMode)}</b><small>carry-in</small></div><div className="history-summary-secondary history-adoption"><span>채택 모델</span><b>없음</b><small>adoptedModel = null</small></div><div className="history-chart-legend"><span><i className="history-legend-point"/>실제 후보</span><span><i className="history-actual-reference-legend"/>당시 제품 예보</span>{mode === 'MIN_MAX' && <span><i className="history-legend-gap"/>결측 포함 구간</span>}</div></div>
            {brierQuery.error && <div className="history-inline-error">{brier ? '범위 재조회 실패 · 같은 스냅샷의 이전 성공 응답' : 'Brier 범위를 읽지 못했습니다.'}</div>}
            <div className="history-hero-chart">{brier ? <ActualRangeChart range={brier} reference={reference} selectedId={inspectReference ? null : effectiveId} main onSelect={selectTrial} onWindow={changeWindow}/> : <div className="history-empty">{brierQuery.isFetching ? '실제 Brier 범위를 읽고 있습니다.' : '표시할 실제 점수가 없습니다.'}</div>}</div>
            <div className="history-count-strip"><span>범위 후보 <b>{formatNumber(brier?.counts.totalTrials)}</b></span><span>유효 <b>{formatNumber(brier?.counts.validCount)}</b></span><span>미산출 <b>{formatNumber(brier?.counts.nullCount)}</b></span><span>무효 <b>{formatNumber(brier?.counts.invalidCount)}</b></span><span>미등록 <b>{formatNumber(brier?.counts.unregisteredCount)}</b></span></div>
            <footer className="history-chart-foot"><span>{mode === 'RAW' ? '개별 등록 평가 · 표시 단위만 환산 · null은 빈 구간 유지' : '실제 first / last / min / max의 표시 단위 환산 · HAS_GAPS 연결 없음'}</span><span>{mode === 'RAW' ? `${formatNumber(brier?.points.length)}점` : `${formatNumber(brier?.buckets.length)}구간`} · 응답 {formatTime(brierQuery.data?.servedAt)} KST</span></footer>
          </section>
          <div className="history-chart-help"><span>슬라이더 또는 Ctrl + 휠로 좁힌 범위를 다시 조회합니다.</span><span>RAW 최대 2,000점 · 한 조회 최대 10,000순번</span></div>
          <div className="history-small-grid history-actual-small-grid">{ACTUAL_METRICS.slice(1).map((metric, index) => {
            const query = rangeQueries[index + 1], range = query.data?.data;
            const spec = metricSpec(metric, metricMode);
            return <section className="history-panel history-small-panel" key={metric}><header className="history-panel-head"><div><h2>{spec.label} <small className="history-metric-unit-inline">{spec.unit}</small></h2><p title={spec.explanation}>{spec.title}</p></div><strong title={metricTooltip(range?.observedBestSoFar.end?.value, metric, metricMode)} style={{ color: metricInfo[metric].color }}>{formatMetric(range?.observedBestSoFar.end?.value, metric, metricMode)}</strong></header>{query.error && <div className="history-inline-error">{range ? '이전 성공 응답 · 재조회 실패' : '조회 실패'}</div>}<div className="history-small-chart">{range ? <ActualRangeChart range={range} reference={reference} selectedId={inspectReference ? null : effectiveId} onSelect={selectTrial}/> : <div className="history-empty">{query.isFetching ? '조회 중' : '자료 없음'}</div>}</div><footer className="history-chart-foot"><span>{metric === 'NRPS' ? metricMode === 'readable' ? '0–100 오차 척도 · 정확도 아님 · 제품 PMF 없음' : '모델 자체 진단 · 제품 PMF 없음' : metric === 'ECE' ? 'method/value null · 0으로 채우지 않음' : '회색 점선: 당시 제품 예보'}</span><span>유효 {formatNumber(range?.counts.validCount)}</span></footer></section>;
          })}</div>
          <div className="history-catalog-note"><span>목록은 선택 그룹 전체의 후보 평가를 최신순으로 탐색합니다.</span><span>현재 snapshot 고정 · 제품 기준은 목록 밖</span></div>
          <ActualTrialTable catalog={catalog} selectedId={inspectReference ? null : effectiveId} page={page} status={status} busy={catalogQuery.isFetching} onSelect={selectTrial}
            onStatus={next => { setStatus(next); resetPage(); }} onPrevious={() => setPage(value => Math.max(0, value - 1))}
            onNext={() => { if (catalog?.page.nextCursor) { setCursors(values => [...values.slice(0, page + 1), catalog.page.nextCursor]); setPage(value => value + 1); } }}/>
        </div><ActualInspector trial={trial} evaluation={trialQuery.data?.data.evaluation} model={modelQuery.data?.data.model} reference={reference} inspectReference={inspectReference} group={group} loading={trialQuery.isFetching || modelQuery.isFetching || referenceQuery.isFetching} error={Boolean(inspectReference ? referenceQuery.error : trialQuery.error || modelQuery.error)} onFocus={focusTrial}/></div>
      </> : <section className="history-panel history-actual-empty"><h2>{groupsQuery.isFetching ? '실제 연구 이력을 확인하고 있습니다.' : errors.length ? '실제 이력 연결을 확인해 주세요.' : '등록된 실제 연구 이력이 없습니다.'}</h2><p>등록된 실제 모델·평가·외부 기준이 있으면 같은 스냅샷에서 표시합니다.</p><span>현재 실제 점수나 후보 수를 만들어 표시하지 않습니다.</span></section>}
      <div className="history-actual-provenance"><span>DEV_REUSED · H 미봉인 · 일반화 주장 없음 · 미채택</span><span>원시 입력 본문 미재검증 · restore는 생산자 보고 · 당시 커밋 가용성 미검증</span></div>
      <footer className="history-footer"><span>소스 완료 {formatTime(provenance?.sourceCompletedAt ?? undefined)} · 최초 수신 {formatTime(provenance?.firstReceivedAt ?? undefined)} KST · worker heartbeat 아님</span><span>소규모 P1 실자료 5회 실행의 저장 이력입니다. 전체 자료 학습 결과는 실자료 반복 화면에 있습니다.</span></footer>
    </main>
  </div>;
}
