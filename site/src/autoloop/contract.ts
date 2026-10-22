import { AUTOLOOP_LIMITS, AUTOLOOP_SCHEMA } from './types.ts';
import type { AutoloopReport } from './types.ts';

function fail(path: string): never { throw new Error(`AUTOLOOP_CONTRACT:${path}`); }
function closed(value: unknown, keys: string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path);
  const r = value as Record<string, unknown>;
  if (Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwn(r, k))) fail(`${path}.keys`);
  return r;
}
function num(v: unknown, path: string, min = Number.NEGATIVE_INFINITY, nullable = false): number | null {
  if (nullable && v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) fail(path);
  return v as number;
}
function text(v: unknown, path: string, max = 2000, nullable = false): string | null {
  if (nullable && v === null) return null;
  if (typeof v !== 'string' || v.length > max) fail(path);
  return v as string;
}
const RUN = /^AUTOLOOP_\d{3}$/, MODEL = /^SEAT\.[A-Za-z0-9_]{1,60}$/, NAME = /^[A-Z][A-Z0-9_]{0,31}$/;
const GUARDS = ['fullBusUnder2Share', 'over10Share', 'routeMacroMAE', 'unseenRouteMAE'];
function candidate(v: unknown, path: string, completed: boolean) {
  const c = closed(v, ['candidate', 'kind', 'head', 'features', 'blocks', 'objective', 'depth', 'eta', 'rounds', 'note', 'MAE', 'RMSE', 'deltaMAE', 'deltaMAECI95', 'guardsWorsened', 'gatePassed', 'Brier'], path);
  if (!NAME.test(String(c.candidate)) || !['XGB', 'LINEAR'].includes(c.kind as string) || !['SEAT', 'FULL'].includes(c.head as string) || !['NONE', 'ROUTE_HORIZON'].includes(c.blocks as string)) fail(`${path}.identity`);
  text(c.features, `${path}.features`, 40); text(c.objective, `${path}.objective`, 40, true); text(c.note, `${path}.note`, 200);
  num(c.depth, `${path}.depth`, 1, true); num(c.eta, `${path}.eta`, 0, true); num(c.rounds, `${path}.rounds`, 1, true);
  if (!Array.isArray(c.guardsWorsened) || c.guardsWorsened.some(g => !GUARDS.includes(g as string))) fail(`${path}.guards`);
  if (completed && c.head === 'SEAT') {
    const mae = num(c.MAE, `${path}.MAE`, 0)!; num(c.RMSE, `${path}.RMSE`, 0); num(c.deltaMAE, `${path}.deltaMAE`);
    if (!Array.isArray(c.deltaMAECI95) || c.deltaMAECI95.length !== 2) fail(`${path}.ci`);
    const [lo, hi] = c.deltaMAECI95.map((x, i) => num(x, `${path}.ci.${i}`)!); if (lo > hi) fail(`${path}.ci.order`);
    if (typeof c.gatePassed !== 'boolean') fail(`${path}.gate`);
    const expected = hi < 0 && (c.guardsWorsened as unknown[]).length === 0;
    if (c.gatePassed !== expected) fail(`${path}.gate.consistency`);
    if (mae > (c.RMSE as number) + 1e-9) fail(`${path}.ordering`);
  } else {
    for (const k of ['MAE', 'RMSE', 'deltaMAE', 'deltaMAECI95', 'gatePassed']) if (c[k] !== null) fail(`${path}.${k}.mustBeNull`);
    if (completed) { const b = num(c.Brier, `${path}.Brier`, 0)!; if (b > 1) fail(`${path}.Brier.range`); } else if (c.Brier !== null) fail(`${path}.Brier.mustBeNull`);
  }
}
const H_STATUS = ['COMPLETED', 'RUNNING', 'REPRODUCTION_FAILED_SEALED', 'FAILED_AFTER_OPENING'];
const H_KEYS = ['MAE', 'RMSE', 'routeMacroMAE', 'unseenRouteMAE', 'over10Share', 'fullBusUnder2Share'];
function interval(v: unknown, path: string) {
  if (v === null) return null;
  if (!Array.isArray(v) || v.length !== 2) fail(path);
  const [lo, hi] = v.map((x, i) => num(x, `${path}.${i}`)!); if (lo > hi) fail(`${path}.order`); return [lo, hi];
}
function hFinal(v: unknown, HOpened: boolean) {
  if (v === null) { if (HOpened) fail('hFinal.missing'); return; }
  const h = closed(v, ['status', 'champion', 'reason', 'days', 'rows', 'blocks', 'reproductionMaxAbsDiff', 'championMetrics', 'referenceMetrics', 'productMetrics', 'championVsReferenceCI95', 'championVsProductCI95', 'referenceVsProductCI95'], 'hFinal');
  if (!H_STATUS.includes(h.status as string) || !MODEL.test(String(h.champion))) fail('hFinal.identity'); text(h.reason, 'hFinal.reason', 80);
  if (!Array.isArray(h.days) || h.days.length !== 4 || h.days.some(x => !/^\d{4}-\d{2}-\d{2}$/.test(String(x)))) fail('hFinal.days');
  const completed = h.status === 'COMPLETED';
  if (HOpened !== (completed || h.status === 'FAILED_AFTER_OPENING')) fail('hFinal.opened');
  num(h.reproductionMaxAbsDiff, 'hFinal.reproduction', 0, !completed);
  if (completed && (h.reproductionMaxAbsDiff as number) > 0.01) fail('hFinal.reproduction.tolerance');
  for (const k of ['rows', 'blocks']) num(h[k], `hFinal.${k}`, 1, !completed);
  for (const m of ['championMetrics', 'referenceMetrics', 'productMetrics']) {
    if (!completed) { if (h[m] !== null) fail(`hFinal.${m}.mustBeNull`); continue; }
    const x = closed(h[m], H_KEYS, `hFinal.${m}`);
    for (const k of H_KEYS) num(x[k], `hFinal.${m}.${k}`, 0, k === 'unseenRouteMAE' || k === 'fullBusUnder2Share');
    if ((x.MAE as number) > (x.RMSE as number) + 1e-9) fail(`hFinal.${m}.ordering`);
  }
  for (const k of ['championVsReferenceCI95', 'championVsProductCI95', 'referenceVsProductCI95']) interval(h[k], `hFinal.${k}`);
  if (completed && (h.championVsProductCI95 === null || h.referenceVsProductCI95 === null)) fail('hFinal.intervals');
}
export function verifyAutoloopReport(value: unknown, now: number = Date.now()): AutoloopReport {
  const d = closed(value, ['schema', 'origin', 'evaluationSplit', 'HOpened', 'hFinal', 'policy', 'state', 'champion', 'championHistory', 'runs', 'servedAt', 'DEVReused', 'modelAdoption'], 'root');
  if (d.schema !== AUTOLOOP_SCHEMA || d.origin !== 'REAL_OBSERVATION_PIPELINE' || d.evaluationSplit !== 'DEV_S' || typeof d.HOpened !== 'boolean' || d.DEVReused !== true || d.modelAdoption !== false) fail('identity');
  hFinal(d.hFinal, d.HOpened as boolean);
  const p = closed(d.policy, ['budget', 'stop', 'gate', 'guards'], 'policy'); const b = closed(p.budget, ['perRunUSD', 'perDayUSD', 'totalUSD', 'overrun'], 'policy.budget');
  for (const k of ['perRunUSD', 'perDayUSD', 'totalUSD']) num(b[k], `policy.budget.${k}`, 0); text(b.overrun, 'policy.budget.overrun', 300);
  const st = closed(p.stop, ['noImprovementRounds', 'consecutiveInfrastructureFailures'], 'policy.stop'); num(st.noImprovementRounds, 'policy.stop.n', 1); num(st.consecutiveInfrastructureFailures, 'policy.stop.f', 1);
  text(p.gate, 'policy.gate', 400); if (!Array.isArray(p.guards)) fail('policy.guards');
  const s = closed(d.state, ['running', 'stopReason', 'lastEvent', 'lastEventAt', 'nextRun', 'consecutiveNoImprovement', 'consecutiveInfraFailures', 'spentTotalUSD', 'spentTodayUSD'], 'state');
  if (typeof s.running !== 'boolean') fail('state.running'); text(s.stopReason, 'state.stopReason', 80, true); text(s.lastEvent, 'state.lastEvent', 80, true); text(s.lastEventAt, 'state.lastEventAt', 40, true);
  num(s.nextRun, 'state.nextRun', 1); num(s.consecutiveNoImprovement, 'state.noImprovement', 0); num(s.consecutiveInfraFailures, 'state.infra', 0);
  const spent = num(s.spentTotalUSD, 'state.spentTotal', 0)!; if (spent > (b.totalUSD as number) + 1.0) fail('state.spentTotal.overBudget'); num(s.spentTodayUSD, 'state.spentToday', 0);
  const ch = closed(d.champion, ['modelId', 'runId', 'candidate', 'devSMAE', 'spec'], 'champion'); if (!MODEL.test(String(ch.modelId))) fail('champion.modelId'); num(ch.devSMAE, 'champion.devSMAE', 0, true);
  if (!Array.isArray(d.championHistory)) fail('championHistory');
  for (const [i, h] of (d.championHistory as unknown[]).entries()) { const x = closed(h, ['runId', 'from', 'to', 'devSMAE', 'previousDevSMAE'], `championHistory.${i}`); if (!RUN.test(String(x.runId))) fail(`championHistory.${i}.runId`); if (num(x.devSMAE, `championHistory.${i}.mae`, 0)! >= num(x.previousDevSMAE, `championHistory.${i}.prev`, 0)!) fail(`championHistory.${i}.notImprovement`); }
  if (!Array.isArray(d.runs) || d.runs.length > AUTOLOOP_LIMITS.maxRuns) fail('runs');
  let total = 0; const ids = new Set<string>();
  for (const [i, r] of (d.runs as unknown[]).entries()) {
    const x = closed(r, ['runId', 'experimentId', 'status', 'hypothesis', 'rationale', 'estimatedUSD', 'actualUSD', 'championBefore', 'championAfter', 'championBeforeMAE', 'productMAE', 'failure', 'candidates'], `runs.${i}`);
    if (!RUN.test(String(x.runId)) || ids.has(x.runId as string)) fail(`runs.${i}.runId`); ids.add(x.runId as string);
    if (!['COMPLETED', 'INFRASTRUCTURE_FAILURE'].includes(x.status as string)) fail(`runs.${i}.status`);
    text(x.experimentId, `runs.${i}.experimentId`, 60); text(x.hypothesis, `runs.${i}.hypothesis`, 1200); text(x.rationale, `runs.${i}.rationale`, 1500); text(x.failure, `runs.${i}.failure`, 200, true);
    num(x.estimatedUSD, `runs.${i}.estimated`, 0); total += num(x.actualUSD, `runs.${i}.actual`, 0)!;
    if (!MODEL.test(String(x.championBefore)) || !MODEL.test(String(x.championAfter))) fail(`runs.${i}.champion`);
    const completed = x.status === 'COMPLETED'; num(x.championBeforeMAE, `runs.${i}.championMAE`, 0, !completed); num(x.productMAE, `runs.${i}.productMAE`, 0, !completed);
    if (!Array.isArray(x.candidates) || x.candidates.length < 1 || x.candidates.length > AUTOLOOP_LIMITS.maxCandidates) fail(`runs.${i}.candidates`);
    (x.candidates as unknown[]).forEach((c, j) => candidate(c, `runs.${i}.candidates.${j}`, completed));
    const passing = (x.candidates as { gatePassed: boolean | null }[]).some(c => c.gatePassed === true);
    if (completed && passing === (x.championBefore === x.championAfter)) fail(`runs.${i}.championChange`);
  }
  if (Math.abs(total - spent) > 0.01) fail('state.spentTotal.closure');
  if (typeof d.servedAt !== 'string' || Number.isNaN(Date.parse(d.servedAt)) || Date.parse(d.servedAt) > now + AUTOLOOP_LIMITS.futureSkewMs) fail('servedAt');
  return d as unknown as AutoloopReport;
}
