import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAutoloopReport } from '../src/autoloop/contract.ts';

const NOW = Date.parse('2026-10-22T00:00:00+00:00');
const seat = (candidate: string, MAE: number, ci: [number, number], guards: string[] = []) => ({ candidate, kind: 'XGB', head: 'SEAT', features: 'ALL', blocks: 'NONE', objective: 'reg:absoluteerror', depth: 8, eta: 0.1, rounds: 1024, note: '', MAE, RMSE: MAE + 1, deltaMAE: (ci[0] + ci[1]) / 2, deltaMAECI95: ci, guardsWorsened: guards, gatePassed: ci[1] < 0 && guards.length === 0, Brier: null });
const fixture = (): any => ({
  schema: 'autoloop-report/1', origin: 'REAL_OBSERVATION_PIPELINE', evaluationSplit: 'DEV_S', HOpened: false, hFinal: null,
  policy: { budget: { perRunUSD: 1, perDayUSD: 5, totalUSD: 20, overrun: 'stop and report' }, stop: { noImprovementRounds: 4, consecutiveInfrastructureFailures: 2 }, gate: 'day x hour block bootstrap', guards: ['unseenRouteMAE'] },
  state: { running: false, stopReason: 'NO_IMPROVEMENT_ROUNDS', lastEvent: 'LOOP_STOP', lastEventAt: '2026-10-22 08:00:00', nextRun: 3, consecutiveNoImprovement: 0, consecutiveInfraFailures: 1, spentTotalUSD: 0.5, spentTodayUSD: 0.5 },
  champion: { modelId: 'SEAT.AUTOLOOP_001_MED', runId: 'AUTOLOOP_001', candidate: 'MED', devSMAE: 1.9, spec: { kind: 'XGB', head: 'SEAT', features: 'ALL', blocks: 'NONE', objective: 'reg:absoluteerror', rounds: 1024, depth: 8, eta: 0.1 } },
  championHistory: [{ runId: 'AUTOLOOP_001', from: 'SEAT.V2_D8', to: 'SEAT.AUTOLOOP_001_MED', devSMAE: 1.9, previousDevSMAE: 2.0 }],
  runs: [
    { runId: 'AUTOLOOP_002', experimentId: 'DEPTH_002', status: 'INFRASTRUCTURE_FAILURE', hypothesis: 'h', rationale: '', estimatedUSD: 0.4, actualUSD: 0.1, championBefore: 'SEAT.AUTOLOOP_001_MED', championAfter: 'SEAT.AUTOLOOP_001_MED', championBeforeMAE: null, productMAE: null, failure: 'STOP_UNCONFIRMED',
      candidates: [{ ...seat('D10', 0, [0, 0]), MAE: null, RMSE: null, deltaMAE: null, deltaMAECI95: null, gatePassed: null }] },
    { runId: 'AUTOLOOP_001', experimentId: 'OBJ_001', status: 'COMPLETED', hypothesis: 'h', rationale: 'r', estimatedUSD: 0.39, actualUSD: 0.4, championBefore: 'SEAT.V2_D8', championAfter: 'SEAT.AUTOLOOP_001_MED', championBeforeMAE: 2.0, productMAE: 3.0, failure: null,
      candidates: [seat('MED', 1.9, [-0.12, -0.08]), seat('HUB', 1.95, [-0.07, -0.03], ['fullBusUnder2Share']), seat('SQ', 2.01, [-0.01, 0.03]),
        { ...seat('FULLP', 0, [0, 0]), head: 'FULL', MAE: null, RMSE: null, deltaMAE: null, deltaMAECI95: null, gatePassed: null, Brier: 0.05 }] },
  ],
  servedAt: '2026-10-21T23:00:00Z', DEVReused: true, modelAdoption: false,
});
const verify = (value: unknown) => verifyAutoloopReport(value, NOW);
const reject = (change: (value: any) => void, pattern: RegExp) => { const value = fixture(); change(value); assert.throws(() => verify(value), pattern); };

test('autoloop: completed and failed rounds both verify', () => {
  const data = verify(fixture());
  assert.equal(data.runs.length, 2);
  assert.deepEqual(data.runs[1].candidates.map(c => c.gatePassed), [true, false, false, null]);
});

test('autoloop: the gate verdict must follow the interval and the guards', () => {
  reject(value => { value.runs[1].candidates[2].gatePassed = true; }, /gate\.consistency/);
  reject(value => { value.runs[1].candidates[1].gatePassed = true; }, /gate\.consistency/);
  reject(value => { value.runs[1].candidates[0].deltaMAECI95 = [-0.05, -0.1]; }, /ci\.order/);
  reject(value => { value.runs[1].candidates[0].guardsWorsened = ['someGuard']; }, /guards/);
});

test('autoloop: the champion changes exactly when a candidate passes', () => {
  reject(value => { value.runs[1].championAfter = 'SEAT.V2_D8'; }, /championChange/);
  reject(value => { value.runs[1].candidates[0] = seat('MED', 1.9, [-0.02, 0.01]); }, /championChange/);
  reject(value => { value.championHistory[0].devSMAE = 2.1; }, /notImprovement/);
});

test('autoloop: failed rounds carry no scores and spending closes to the ledger', () => {
  reject(value => { value.runs[0].candidates[0].MAE = 2; }, /mustBeNull/);
  reject(value => { value.runs[0].actualUSD = 0.3; }, /spentTotal\.closure/);
  reject(value => { value.state.spentTotalUSD = 25; value.runs[1].actualUSD = 24.9; }, /overBudget/);
});

test('autoloop: identity, H seal and adoption claims stay fixed', () => {
  reject(value => { value.HOpened = true; }, /hFinal\.missing/);
  reject(value => { value.HOpened = 'yes'; }, /identity/);
  reject(value => { value.modelAdoption = true; }, /identity/);
  reject(value => { value.evaluationSplit = 'H'; }, /identity/);
  reject(value => { value.extra = 1; }, /root\.keys/);
  reject(value => { value.runs[1].runId = 'AUTOLOOP_002'; }, /runId/);
  reject(value => { value.servedAt = '2026-10-23T00:00:00Z'; }, /servedAt/);
});

const hMetrics = (MAE: number) => ({ MAE, RMSE: MAE + 1.5, routeMacroMAE: MAE + 0.3, unseenRouteMAE: null, over10Share: 0.03, fullBusUnder2Share: 0.5 });
const hDone = () => ({ status: 'COMPLETED', champion: 'SEAT.AUTOLOOP_001_MED', reason: 'NO_IMPROVEMENT_ROUNDS', days: ['2026-10-13', '2026-10-15', '2026-10-18', '2026-10-19'], rows: 10288185, blocks: 90, reproductionMaxAbsDiff: 0.0004,
  championMetrics: hMetrics(1.95), referenceMetrics: hMetrics(2.05), productMetrics: hMetrics(3.1), championVsReferenceCI95: [-0.13, -0.07], championVsProductCI95: [-1.2, -1.1], referenceVsProductCI95: [-1.1, -1.0] });

test('autoloop: the sealed H result appears exactly when H was opened and keeps its reproduction proof', () => {
  const value = fixture(); value.HOpened = true; value.hFinal = hDone(); assert.equal(verify(value).hFinal?.status, 'COMPLETED');
  reject(value => { value.hFinal = hDone(); }, /hFinal\.opened/);
  reject(value => { value.HOpened = true; value.hFinal = { ...hDone(), reproductionMaxAbsDiff: 0.5 }; }, /reproduction\.tolerance/);
  reject(value => { value.HOpened = true; value.hFinal = { ...hDone(), championVsProductCI95: null }; }, /hFinal\.intervals/);
  reject(value => { value.HOpened = true; value.hFinal = { ...hDone(), days: ['2026-10-13'] }; }, /hFinal\.days/);
  const sealed = fixture(); sealed.hFinal = { ...hDone(), status: 'REPRODUCTION_FAILED_SEALED', rows: null, blocks: null, reproductionMaxAbsDiff: 0.2, championMetrics: null, referenceMetrics: null, productMetrics: null, championVsReferenceCI95: null, championVsProductCI95: null, referenceVsProductCI95: null };
  assert.equal(verify(sealed).HOpened, false);
});
