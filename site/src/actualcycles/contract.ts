import { eventSchema, snapshotSchema } from './schemas.ts';
import { validateSchema } from './schema-validator.ts';
import { METRICS } from './types.ts';
import type { Cycle, Decision, Invalidation, Report, Run, Snapshot } from './types.ts';

function fail(path: string): never { throw new Error(`ACTUAL_CYCLES_SEMANTICS:${path}`); }
export const runKey = (run: Pick<Run, 'runId' | 'attemptId' | 'sourceGenerationId' | 'executionId'>) =>
  JSON.stringify([run.runId, run.attemptId, run.sourceGenerationId, run.executionId]);
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]` :
  value && typeof value === 'object' ? `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}` : JSON.stringify(value) ?? '';
const equal = (a: unknown, b: unknown) => stable(a) === stable(b);
function reportRules(report: Report, run: Run, reference: boolean) {
  if (report.groupRef !== run.comparisonGroup.groupRef) fail('report.group');
  for (const metric of METRICS) {
    if (report.metrics[metric] !== null && (!report.metricMethods[metric] || report.numericSupport !== 'DEFINED')) fail('report.numericSupport');
  }
  if (reference && (report.metrics.NRPS !== null || report.metrics.ECE !== null ||
    report.metricMethods.NRPS !== null || report.metricMethods.ECE !== null)) fail('reference.distributionUnavailable');
  const event = run.events[report.registeredSeq];
  if (!event || event.eventHash !== report.registrationHash || event.kind !== (reference ? 'REFERENCE_REGISTERED' : 'SCORE_REGISTERED')) fail('report.registration');
}
function decisionRules(decision: Decision, purpose: 'MAIN' | 'AUX', cycle: Cycle, run: Run) {
  if (!cycle.report || !run.baseline || decision.purpose !== purpose ||
    decision.primaryMetric !== (purpose === 'MAIN' ? 'Brier' : 'MAE_MSE') ||
    decision.groupRef !== run.comparisonGroup.groupRef ||
    decision.policyRef !== run.comparisonGroup[purpose === 'MAIN' ? 'mainPolicyRef' : 'auxPolicyRef'] ||
    decision.referenceCandidateId !== run.baselineCandidateId ||
    decision.referenceReportRef !== run.baseline.report.reportRef || decision.candidateReportRef !== cycle.report.reportRef ||
    (decision.validity === 'INVALID' ? decision.outcome !== 'INVALID' : decision.outcome === 'INVALID')) fail('decision.binding');
}
function runRules(run: Run) {
  if (!run.events.length || run.events[0].kind !== 'RUN_STARTED') fail('run.start');
  run.events.forEach((event, index) => {
    if (event.producerSeq !== index || event.cycleIndex < 0 || event.cycleIndex > 5) fail('events.prefix');
  });
  if (new Set(run.events.map(event => event.eventId)).size !== run.events.length) fail('events.duplicate');
  const head = run.events.at(-1)!;
  if (head.eventHash !== run.head.eventHash || head.producerSeq !== run.head.producerSeq || head.kind !== run.phase) fail('run.head');
  if (run.quality.inputKind !== run.sourceKind || (run.sourceKind === 'ARTIFICIAL_TRANSPORT_FIXTURE' && run.quality.actualExecutionClaim)) fail('run.sourceClaim');
  if (run.baseline) {
    if (run.baseline.candidateId !== run.baselineCandidateId) fail('reference.identity');
    reportRules(run.baseline.report, run, true);
  }
  const revisions: string[] = [];
  run.cycles.forEach((cycle, index) => {
    if (cycle.cycleIndex !== index + 1 || cycle.cycleIndex > 5 || cycle.candidateId === run.baselineCandidateId || !run.baseline) fail('cycle.index');
    const events = run.events.filter(event => event.cycleIndex === cycle.cycleIndex);
    const reservation = events.find(event => event.kind === 'MODEL_RESERVED');
    const model = cycle.model, verified = model.state === 'VERIFIED';
    if (!reservation || reservation.eventHash !== model.reservationRef) fail('model.reservation');
    if (verified !== events.some(event => event.kind === 'MODEL_VERIFIED')) fail('model.verificationEvent');
    if (model.state === 'RESERVED' ? model.taskRef !== null : model.taskRef === null) fail('model.task');
    const afterVerification = [model.modelReceiptRef, model.modelArtifactRef, model.completionRef, model.trainingRows, model.predictionRows, model.resources];
    if (verified ? afterVerification.some(value => value === null) : afterVerification.some(value => value !== null)) fail('model.verificationFields');
    if (!equal(cycle.resources, model.resources)) fail('resources.binding');
    if (model.resources && model.resources.measurementKind !== (run.sourceKind === 'REAL_OBSERVATION_EXECUTION' ? 'PRODUCER_REPORTED_MEASUREMENT' : 'ARTIFICIAL_FIXTURE_VALUE')) fail('resources.source');
    if (cycle.report) {
      if (!verified || cycle.report.modelReceiptRef !== model.modelReceiptRef || cycle.report.modelId !== model.modelId ||
        cycle.report.jobId !== model.jobId) fail('report.beforeVerified');
      reportRules(cycle.report, run, false);
      if (cycle.report.numericSupport === 'DEFINED' && cycle.report.validity === 'VALID' &&
        (cycle.report.support.rows !== model.predictionRows ||
          (run.baseline.report.numericSupport === 'DEFINED' && run.baseline.report.support.rows !== model.predictionRows))) fail('report.population');
    }
    if (cycle.mainDecision) { decisionRules(cycle.mainDecision, 'MAIN', cycle, run); revisions.push(cycle.mainDecision.revisionRef); }
    if (cycle.auxDecision) {
      if (!cycle.mainDecision) fail('decision.order');
      decisionRules(cycle.auxDecision, 'AUX', cycle, run); revisions.push(cycle.auxDecision.revisionRef);
    }
    const proposal = cycle.proposal;
    if (proposal) {
      if (!cycle.mainDecision || !cycle.auxDecision ||
        proposal.mainRevisionRef !== cycle.mainDecision.revisionRef || proposal.auxRevisionRef !== cycle.auxDecision.revisionRef) fail('proposal.decisions');
      const aux = events.find(event => event.kind === 'AUX_DECISION_COMMITTED');
      const sealed = events.find(event => event.kind === 'PROPOSAL_SEALED');
      if (!aux || !sealed || proposal.sourcePrefix.producerSeq !== aux.producerSeq ||
        proposal.sourcePrefix.eventHash !== aux.eventHash || sealed.producerSeq !== aux.producerSeq + 1) fail('proposal.prefix');
      const selected = [proposal.selectedCandidateId, proposal.selectedRecipeRef, proposal.selectedTaskTemplateRef];
      if (cycle.cycleIndex === 5 ? proposal.nextAction !== 'STOP' || selected.some(value => value !== null) || proposal.stopReason !== 'FIVE_CYCLES_COMPLETE' :
        proposal.nextAction !== 'CONTINUE' || selected.some(value => value === null) || proposal.stopReason !== null) fail('proposal.stop');
      if ((proposal.state === 'CONSUMED') !== (proposal.consumptionRef !== null) ||
        (proposal.state === 'CONSUMED') !== events.some(event => event.kind === 'PROPOSAL_CONSUMED')) fail('proposal.consumption');
    }
    if (cycle.status === 'COMPLETED' && (!proposal || !cycle.report || !cycle.mainDecision || !cycle.auxDecision ||
      !events.some(event => event.kind === 'CYCLE_COMPLETED') || (cycle.cycleIndex < 5 && proposal.state !== 'CONSUMED'))) fail('cycle.completed');
    if (index === 0 && (cycle.candidateId !== run.initialPlan.candidateId || model.recipeRef !== run.initialPlan.recipeRef ||
      model.taskTemplateRef !== run.initialPlan.taskTemplateRef)) fail('model.initialPlan');
    if (index > 0) {
      const prior = run.cycles[index - 1].proposal;
      if (!prior || prior.state !== 'CONSUMED' || prior.selectedCandidateId !== cycle.candidateId ||
        prior.selectedRecipeRef !== model.recipeRef || prior.selectedTaskTemplateRef !== model.taskTemplateRef ||
        prior.nextReservationRef !== model.reservationRef) fail('model.proposalBinding');
    }
  });
  if (new Set(revisions).size !== revisions.length) fail('decision.duplicateRevision');
  const counts = {
    registeredReferences: run.baseline ? 1 : 0, modelReservations: run.cycles.length,
    modelVerifications: run.cycles.filter(cycle => cycle.model.state === 'VERIFIED').length,
    registeredCandidateScores: run.cycles.filter(cycle => cycle.report).length,
    completedCycles: run.cycles.filter(cycle => cycle.status === 'COMPLETED').length,
    mainDecisions: run.cycles.filter(cycle => cycle.mainDecision).length, auxDecisions: run.cycles.filter(cycle => cycle.auxDecision).length,
    proposals: run.cycles.filter(cycle => cycle.proposal).length, proposalConsumptions: run.cycles.filter(cycle => cycle.proposal?.state === 'CONSUMED').length,
  };
  if (!equal(counts, run.counts) || run.budgetObserved.modelJobs > 5 || run.budgetObserved.modelJobs < counts.modelVerifications) fail('counts');
  if (run.status === 'COMPLETED' && (counts.completedCycles !== 5 || run.phase !== 'RUN_COMPLETED')) fail('run.completed');
  if (run.status === 'FAILED' && run.phase !== 'RUN_FAILED') fail('run.failed');
  if (run.status === 'HELD' && run.phase !== 'RUN_HELD') fail('run.held');
}
export function verifySnapshot(value: unknown): Snapshot {
  validateSchema(value, snapshotSchema);
  const snapshot = value as Snapshot;
  if (new Set(snapshot.runs.map(runKey)).size !== snapshot.runs.length) fail('runs.duplicate');
  snapshot.runs.forEach(runRules);
  return snapshot;
}
export function verifyInvalidation(value: unknown): Invalidation {
  validateSchema(value, eventSchema, 'event');
  const event = value as Invalidation;
  if (event.cycleIndex > 5 || event.producerSeq > 127) fail('event.bounds');
  return event;
}
/** New server generations are explicitly resynchronized, never joined to an old prefix. */
export function verifyExtension(previous: Snapshot, next: Snapshot): 'EXTENSION' | 'RESYNC' {
  if (previous.generationId !== next.generationId) return 'RESYNC';
  if (next.cursor < previous.cursor) fail('cursor.rollback');
  for (const prior of previous.runs) {
    const run = next.runs.find(candidate => runKey(candidate) === runKey(prior));
    if (!run || run.events.length < prior.events.length || !equal(prior.events, run.events.slice(0, prior.events.length))) fail('events.fork');
    for (const key of ['sourceKind', 'contextRef', 'producerCodeHash', 'comparisonGroup', 'initialPlan', 'budget', 'baselineCandidateId'] as const) {
      if (!equal(prior[key], run[key])) fail(`run.immutable.${key}`);
    }
    if (prior.baseline && !equal(prior.baseline, run.baseline)) fail('reference.changed');
    if (prior.status !== 'IN_PROGRESS' && !equal(prior, run)) fail('terminal.changed');
    for (const before of prior.cycles) {
      const after = run.cycles.find(cycle => cycle.cycleId === before.cycleId);
      if (!after || before.candidateId !== after.candidateId || before.cycleIndex !== after.cycleIndex) fail('cycle.identityChanged');
      for (const key of ['jobId', 'modelId', 'recipeRef', 'taskTemplateRef', 'workerCodeHash', 'reservationRef'] as const) {
        if (before.model[key] !== after.model[key]) fail('model.identityChanged');
      }
      if (before.model.taskRef !== null && before.model.taskRef !== after.model.taskRef) fail('model.taskChanged');
      if (before.model.state === 'VERIFIED' && !equal(before.model, after.model)) fail('model.receiptChanged');
      if (before.model.state === 'STARTED' && after.model.state === 'RESERVED') fail('model.rollback');
      for (const key of ['report', 'mainDecision', 'auxDecision'] as const) if (before[key] && !equal(before[key], after[key])) fail(`${key}.changed`);
      if (before.proposal) {
        if (!after.proposal) fail('proposal.removed');
        for (const key of Object.keys(before.proposal) as (keyof typeof before.proposal)[]) {
          if (key === 'state') { if (before.proposal.state === 'CONSUMED' && after.proposal.state !== 'CONSUMED') fail('proposal.rollback'); }
          else if (before.proposal[key] !== null && !equal(before.proposal[key], after.proposal[key])) fail('proposal.changed');
        }
      }
    }
  }
  return 'EXTENSION';
}
