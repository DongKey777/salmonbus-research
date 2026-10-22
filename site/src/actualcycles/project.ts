import type { ChartGroup, Cycle, Metric, Report, Run } from './types.ts';

/** A fresh fit is a candidate 1..5. The external product reference never occupies a model slot. */
export function chartGroup(run: Run): ChartGroup {
  return {
    group: run.comparisonGroup,
    reference: run.baseline?.report.groupRef === run.comparisonGroup.groupRef ? run.baseline : null,
    slots: Array.from({ length: 5 }, (_, index) => {
      const cycle = run.cycles.find(value => value.cycleIndex === index + 1);
      return cycle && (!cycle.report || cycle.report.groupRef === run.comparisonGroup.groupRef) ? cycle : null;
    }),
  };
}
export function metricValue(report: Report | null | undefined, metric: Metric, groupRef: string): number | null {
  return report?.validity === 'VALID' && report.numericSupport === 'DEFINED' && report.groupRef === groupRef &&
    report.metricMethods[metric] !== null ? report.metrics[metric] : null;
}
export function candidateValue(cycle: Cycle | null, metric: Metric, groupRef: string) {
  return cycle?.model.state === 'VERIFIED' ? metricValue(cycle.report, metric, groupRef) : null;
}
export function referenceValue(group: ChartGroup, metric: Metric) {
  // Product scalar forecasts provide no PMF or calibration diagnostic.
  return metric === 'NRPS' || metric === 'ECE' ? null : metricValue(group.reference?.report, metric, group.group.groupRef);
}
export function selectedCycle(run: Run, cycleId: string | null): Cycle | undefined {
  return cycleId === null ? run.cycles.at(-1) : run.cycles.find(cycle => cycle.cycleId === cycleId);
}
export function verifiedRows(cycle: Cycle | undefined) {
  return cycle?.model.state === 'VERIFIED' ?
    { trainingRows: cycle.model.trainingRows, predictionRows: cycle.model.predictionRows } :
    { trainingRows: null, predictionRows: null };
}
export function workflow(run: Run, cycle: Cycle | undefined) {
  const kinds = new Set(run.events.filter(event => event.cycleIndex === cycle?.cycleIndex).map(event => event.kind));
  return [
    ['MODEL_RESERVED', '예약'], ['MODEL_STARTED', '실행'], ['MODEL_VERIFIED', '모델 검증'],
    ['SCORE_REGISTERED', '성적 등록'], ['MAIN_DECISION_COMMITTED', '주 판정'],
    ['AUX_DECISION_COMMITTED', '보조 판정'], ['PROPOSAL_SEALED', '제안 확정'],
    [cycle?.cycleIndex === 5 ? 'CYCLE_COMPLETED' : 'PROPOSAL_CONSUMED', cycle?.cycleIndex === 5 ? '5회 종료' : '제안 소비'],
  ].map(([kind, label]) => ({ kind, label, done: kinds.has(kind as Parameters<typeof kinds.has>[0]) }));
}
