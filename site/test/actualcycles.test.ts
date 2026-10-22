import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyExtension, verifyInvalidation, verifySnapshot } from '../src/actualcycles/contract.ts';
import { chartGroup, metricValue, referenceValue, selectedCycle, verifiedRows } from '../src/actualcycles/project.ts';
import { deltaTrend, metricTrend } from '../src/actualcycles/charts.ts';
import { axisTick, decisionLabel, score } from '../src/actualcycles/presentation.ts';
import { readSnapshot } from '../src/actualcycles/connection.ts';
import type { Cycle, Decision, EventKind, Report, Run, Snapshot } from '../src/actualcycles/types.ts';

test('actual cycles: small measured Brier values and neighboring ticks remain distinguishable', () => {
  assert.equal(score(2.5579888093701708e-5), '2.558e-5');
  assert.notEqual(score(1.402462693036269e-5), score(1.3182512074488608e-5));
  const ticks = [0, 5e-6, 1e-5, 1.5e-5, 2e-5, 2.5e-5, 3e-5].map(axisTick);
  assert.equal(new Set(ticks).size, ticks.length);
  assert.equal(axisTick(3), '3');
  assert.notEqual(axisTick(0.111111), axisTick(0.111113));
});

/** ARTIFICIAL TRANSPORT TEST DATA ONLY. No producer, fit, source files, API, or public preview. */
const h = (value: string) => createHash('sha256').update(`ARTIFICIAL_TRANSPORT_FIXTURE:${value}`).digest('hex');
function artificialSnapshot(stopKind?: EventKind, stopCycle = 1): Snapshot {
  const group = Object.fromEntries(['groupRef', 'datasetRef', 'splitRef', 'weightRef', 'scorerRef', 'mainPolicyRef', 'auxPolicyRef'].map(key => [key, h(key)])) as unknown as Run['comparisonGroup'];
  const identity = (index: number) => ({ candidateId: `artificial-candidate-${index}`, recipeRef: h(`recipe-${index}`), taskTemplateRef: h(`template-${index}`) });
  const run: Run = {
    sourceKind: 'ARTIFICIAL_TRANSPORT_FIXTURE', sourceGenerationId: 'artificial-source', runId: 'artificial-run',
    attemptId: 'artificial-attempt', executionId: 'artificial-execution', contextRef: h('context'), producerCodeHash: h('producer'),
    proposerKind: 'LOCAL_RULE_PROPOSER', targetCycles: 5, baselineCandidateId: 'artificial-product-reference', baselineKind: 'HISTORICAL_PRODUCT_REFERENCE',
    comparisonGroup: group, initialPlan: identity(1), budget: { modelJobs: 5, proposals: 5, providerCalls: 0, javaCalls: 0 },
    mode: 'DECLARED_EVENT_TIME_REPLAY', historicalCommitAvailabilityVerified: false, HSealed: false, adoption: false, generalizationClaim: false,
    baseline: null, cycles: [], head: { producerSeq: 0, eventHash: h('empty') }, phase: 'RUN_STARTED', status: 'IN_PROGRESS', terminalReason: null,
    counts: { registeredReferences: 0, modelReservations: 0, modelVerifications: 0, registeredCandidateScores: 0, completedCycles: 0, mainDecisions: 0, auxDecisions: 0, proposals: 0, proposalConsumptions: 0 },
    budgetObserved: { modelJobs: 0, newModelsExecutedByMonitor: 0, providerCalls: 0, javaCalls: 0 },
    quality: { inputKind: 'ARTIFICIAL_TRANSPORT_FIXTURE', actualExecutionClaim: false, verification: 'SANITIZED_JOURNAL_PINS_PRODUCER_ARTIFACT_ATTESTATION', independentArtifactVerification: false, generalizationClaim: false, adoption: false },
    events: [],
  };
  const add = (kind: EventKind, index: number) => {
    const seq = run.events.length, timestamp = new Date(Date.UTC(2030, 0, 1, 0, 0, seq)).toISOString();
    const event = { eventId: h(`event-id-${seq}`), eventHash: h(`event-hash-${seq}`), producerSeq: seq, cycleIndex: index, kind, occurredAt: timestamp, observedAt: timestamp, receivedAt: timestamp };
    run.events.push(event); run.phase = kind; run.head = { producerSeq: seq, eventHash: event.eventHash };
    const cycle = run.cycles.find(value => value.cycleIndex === index);
    if (cycle) Object.assign(cycle, { phase: kind, lastOccurredAt: timestamp, lastObservedAt: timestamp, lastReceivedAt: timestamp });
    return event;
  };
  const finish = (): Snapshot => {
    run.counts = {
      registeredReferences: run.baseline ? 1 : 0, modelReservations: run.cycles.length,
      modelVerifications: run.cycles.filter(cycle => cycle.model.state === 'VERIFIED').length,
      registeredCandidateScores: run.cycles.filter(cycle => cycle.report).length,
      completedCycles: run.cycles.filter(cycle => cycle.status === 'COMPLETED').length,
      mainDecisions: run.cycles.filter(cycle => cycle.mainDecision).length, auxDecisions: run.cycles.filter(cycle => cycle.auxDecision).length,
      proposals: run.cycles.filter(cycle => cycle.proposal).length, proposalConsumptions: run.cycles.filter(cycle => cycle.proposal?.state === 'CONSUMED').length,
    };
    run.budgetObserved.modelJobs = run.cycles.length;
    return { schemaVersion: 'real-cycle-monitor-v1', generationId: 'artificial-server-generation', cursor: run.events.length, servedAt: '2030-01-01T00:02:00Z', lastReceivedAt: run.events.at(-1)!.receivedAt, runs: [run] };
  };
  const stop = (kind: EventKind, index: number) => kind === stopKind && index === stopCycle;
  const report = (index: number, seq: number): Report => ({
    evaluationId: `artificial-evaluation-${index}`, reportRef: h(`report-${index}`), scorerReceiptRef: h(`scorer-${index}`),
    scoreArtifactRef: h(`score-artifact-${index}`), completionRef: h(`score-completion-${index}`), groupRef: group.groupRef,
    validity: 'VALID', numericSupport: 'DEFINED',
    metrics: { Brier: .3 - index * .02, MAE: .5 - index * .03, MSE: .4 - index * .02, NRPS: index ? .2 : null, ECE: null },
    metricMethods: { Brier: 'WEIGHTED_FINAL_P_FULL_BRIER', MAE: 'WEIGHTED_SCALAR_MAE', MSE: 'WEIGHTED_SCALAR_MSE', NRPS: index ? 'OWN_MODEL_DIAGNOSTIC_NRPS' : null, ECE: null },
    support: { rows: 6, groups: 3, fullGroups: 1, nonFullGroups: 2, weightSum: 3 },
    registeredSeq: seq, registrationHash: run.events[seq].eventHash, registeredAt: run.events[seq].occurredAt,
  });
  add('RUN_STARTED', 0);
  if (stop('RUN_STARTED', 0)) return finish();
  const referenceEvent = add('REFERENCE_REGISTERED', 0);
  run.baseline = { cycleIndex: 0, cycleId: 'artificial-cycle-0', candidateId: run.baselineCandidateId, kind: 'HISTORICAL_PRODUCT_REFERENCE', isExternalReference: true, verification: 'VERIFIED_SCALAR_SCORE', referenceRef: h('reference'), report: report(0, referenceEvent.producerSeq) };
  if (stop('REFERENCE_REGISTERED', 0)) return finish();
  for (let index = 1; index <= 5; index++) {
    const reservation = add('MODEL_RESERVED', index);
    const cycle: Cycle = {
      cycleIndex: index, cycleId: `artificial-cycle-${index}`, candidateId: identity(index).candidateId, kind: 'FRESH_MODEL_FIT', phase: 'MODEL_RESERVED', status: 'IN_PROGRESS',
      model: { jobId: `artificial-job-${index}`, modelId: `artificial-model-${index}`, recipeRef: identity(index).recipeRef, taskTemplateRef: identity(index).taskTemplateRef, workerCodeHash: h('worker'), reservationRef: reservation.eventHash, state: 'RESERVED', taskRef: null, modelReceiptRef: null, modelArtifactRef: null, completionRef: null, trainingRows: null, predictionRows: null, resources: null },
      report: null, mainDecision: null, auxDecision: null, proposal: null, resources: null,
      lastOccurredAt: reservation.occurredAt, lastObservedAt: reservation.observedAt, lastReceivedAt: reservation.receivedAt,
    };
    run.cycles.push(cycle);
    if (index > 1) run.cycles[index - 2].proposal!.nextReservationRef = reservation.eventHash;
    if (stop('MODEL_RESERVED', index)) return finish();
    add('MODEL_STARTED', index); cycle.model.state = 'STARTED'; cycle.model.taskRef = h(`task-${index}`);
    if (stop('MODEL_STARTED', index)) return finish();
    add('MODEL_VERIFIED', index);
    Object.assign(cycle.model, { state: 'VERIFIED', modelReceiptRef: h(`model-receipt-${index}`), modelArtifactRef: h(`model-artifact-${index}`), completionRef: h(`model-completion-${index}`), trainingRows: 12, predictionRows: 6, resources: { currentRssMiB: null, reportedPeakRssMiB: 16, reportedCpuSeconds: .01, reportedWallSeconds: .02, measurementKind: 'ARTIFICIAL_FIXTURE_VALUE' } });
    cycle.resources = cycle.model.resources;
    if (stop('MODEL_VERIFIED', index)) return finish();
    const scored = add('SCORE_REGISTERED', index);
    cycle.report = { ...report(index, scored.producerSeq), jobId: cycle.model.jobId, modelId: cycle.model.modelId, modelReceiptRef: cycle.model.modelReceiptRef! };
    if (stop('SCORE_REGISTERED', index)) return finish();
    for (const purpose of ['MAIN', 'AUX'] as const) {
      const kind = `${purpose}_DECISION_COMMITTED` as EventKind;
      add(kind, index);
      const decision: Decision = { purpose, validity: 'VALID', outcome: 'MET', revisionRef: h(`${purpose}-revision-${index}`), decisionRef: h(`${purpose}-decision-${index}`), referenceCandidateId: run.baselineCandidateId, referenceReportRef: run.baseline.report.reportRef, candidateReportRef: cycle.report.reportRef, groupRef: group.groupRef, policyRef: group[purpose === 'MAIN' ? 'mainPolicyRef' : 'auxPolicyRef'], primaryMetric: purpose === 'MAIN' ? 'Brier' : 'MAE_MSE', adoption: false, comparisonStatus: 'SAME_GROUP' };
      cycle[purpose === 'MAIN' ? 'mainDecision' : 'auxDecision'] = decision;
      if (stop(kind, index)) return finish();
    }
    const aux = run.events.at(-1)!;
    add('PROPOSAL_SEALED', index);
    cycle.proposal = {
      proposalRef: h(`proposal-${index}`), inputRef: h(`input-${index}`), outputRef: h(`output-${index}`),
      sourcePrefix: { producerSeq: aux.producerSeq, eventHash: aux.eventHash }, mainRevisionRef: cycle.mainDecision!.revisionRef, auxRevisionRef: cycle.auxDecision!.revisionRef,
      nextAction: index === 5 ? 'STOP' : 'CONTINUE', selectedCandidateId: index === 5 ? null : identity(index + 1).candidateId,
      selectedRecipeRef: index === 5 ? null : identity(index + 1).recipeRef, selectedTaskTemplateRef: index === 5 ? null : identity(index + 1).taskTemplateRef,
      stopReason: index === 5 ? 'FIVE_CYCLES_COMPLETE' : null, state: 'SEALED', consumptionRef: null, nextReservationRef: null,
    };
    if (stop('PROPOSAL_SEALED', index)) return finish();
    if (index < 5) {
      add('PROPOSAL_CONSUMED', index); cycle.proposal.state = 'CONSUMED'; cycle.proposal.consumptionRef = h(`consumption-${index}`);
      if (stop('PROPOSAL_CONSUMED', index)) return finish();
    }
    add('CYCLE_COMPLETED', index); cycle.status = 'COMPLETED';
    if (stop('CYCLE_COMPLETED', index)) return finish();
  }
  add('RUN_COMPLETED', 5);
  run.status = 'COMPLETED'; run.terminalReason = 'FIVE_CYCLES_COMPLETE';
  return finish();
}

test('actual cycles: five artificial candidate fits plus one external product reference, never six models', () => {
  const snapshot = verifySnapshot(artificialSnapshot()), run = snapshot.runs[0];
  assert.equal(run.counts.registeredReferences, 1);
  assert.equal(run.counts.modelVerifications, 5);
  assert.equal(run.budgetObserved.modelJobs, 5);
  assert.equal('model' in run.baseline!, false);
  assert.equal(run.quality.actualExecutionClaim, false);
  assert.equal(run.adoption, false);
  assert.equal(decisionLabel(run.cycles[0].mainDecision), '개발 기준 충족');
});

test('actual cycles: empty and partial states have no invented metrics or actual row counts', () => {
  verifySnapshot({ schemaVersion: 'real-cycle-monitor-v1', generationId: 'empty', cursor: 0, servedAt: '2030-01-01T00:00:00Z', lastReceivedAt: null, runs: [] });
  for (const kind of ['RUN_STARTED', 'REFERENCE_REGISTERED', 'MODEL_RESERVED', 'MODEL_STARTED', 'MODEL_VERIFIED'] as const) {
    const snapshot = verifySnapshot(artificialSnapshot(kind, kind === 'RUN_STARTED' || kind === 'REFERENCE_REGISTERED' ? 0 : 1));
    const run = snapshot.runs[0];
    assert.equal(run.cycles[0]?.report ?? null, null);
    if (kind !== 'MODEL_VERIFIED') assert.deepEqual(verifiedRows(run.cycles[0]), { trainingRows: null, predictionRows: null });
  }
});

test('actual cycles: product reference cannot carry a model or fabricated NRPS/ECE', () => {
  const invalid = artificialSnapshot();
  Object.assign(invalid.runs[0].baseline!, { model: invalid.runs[0].cycles[0].model });
  assert.throws(() => verifySnapshot(invalid));
  const badPmf = artificialSnapshot(); badPmf.runs[0].baseline!.report.metrics.NRPS = .1;
  assert.throws(() => verifySnapshot(badPmf), /reference.distributionUnavailable|report.numericSupport/);
  const group = chartGroup(verifySnapshot(artificialSnapshot()).runs[0]);
  assert.equal(referenceValue(group, 'NRPS'), null);
  assert.equal((metricTrend(group, 'NRPS', null).series as unknown[]).length, 1);
  assert.equal((metricTrend(group, 'Brier', null).series as unknown[]).length, 2);
});

test('actual cycles: registration requires verified model receipt and exactly matching evaluation population', () => {
  const before = artificialSnapshot('MODEL_STARTED');
  before.runs[0].cycles[0].report = artificialSnapshot().runs[0].cycles[0].report;
  assert.throws(() => verifySnapshot(before), /beforeVerified/);
  const wrongRows = artificialSnapshot(); wrongRows.runs[0].cycles[0].model.predictionRows = 7;
  assert.throws(() => verifySnapshot(wrongRows), /population/);
  const missingRows = artificialSnapshot(); missingRows.runs[0].cycles[0].model.trainingRows = null;
  assert.throws(() => verifySnapshot(missingRows), /verificationFields/);
  const zeroRows = artificialSnapshot(); zeroRows.runs[0].cycles[0].model.trainingRows = 0;
  assert.throws(() => verifySnapshot(zeroRows), /CONTRACT/);
});

test('actual cycles: unavailable, invalid and wrong-group scores remain chart gaps', () => {
  const snapshot = artificialSnapshot();
  snapshot.runs[0].cycles[0].report!.metrics.Brier = null;
  const run = verifySnapshot(snapshot).runs[0], group = chartGroup(run);
  const series = metricTrend(group, 'Brier', null).series as { connectNulls: boolean; data: { value: number | null }[] }[];
  assert.equal(series[0].connectNulls, false);
  assert.equal(series[0].data[0].value, null);
  assert.equal(metricValue({ ...run.cycles[1].report!, validity: 'INVALID' }, 'Brier', group.group.groupRef), null);
  assert.equal(metricValue(run.cycles[1].report, 'Brier', h('another-group')), null);
  assert.equal(metricValue(run.cycles[0].report, 'ECE', group.group.groupRef), null);
});

test('actual cycles: readable chart geometry and original tooltip values agree without changing reports', () => {
  const run = verifySnapshot(artificialSnapshot()).runs[0], group = chartGroup(run), before = JSON.stringify(run);
  const raw = run.cycles[0].report!.metrics.MSE!;
  const converted = metricTrend(group, 'MSE', run.cycles[0].cycleId, false, 'readable').series as { data: { value: number; rawValue: number; candidateId?: string }[] }[];
  const original = metricTrend(group, 'MSE', null, false, 'raw').series as { data: { value: number; rawValue: number }[] }[];
  assert.equal(converted[0].data[0].value, Math.sqrt(raw));
  assert.equal(converted[0].data[0].rawValue, raw);
  assert.equal(converted[0].data[0].candidateId, run.cycles[0].cycleId);
  assert.equal(converted[1].data[0].value, Math.sqrt(run.baseline!.report.metrics.MSE!));
  assert.equal(original[0].data[0].value, raw);
  const delta = deltaTrend(group, 'readable').series as { data: { value: number; rawValue: number }[] }[];
  assert.equal(delta[0].data[0].value, delta[0].data[0].rawValue * 1_000_000);
  assert.equal(JSON.stringify(run), before);
});

test('actual cycles: nonfinite values, false source claims and changed locked flags fail closed', () => {
  for (const value of [NaN, Infinity, -1, 1.1]) {
    const snapshot = artificialSnapshot(); snapshot.runs[0].cycles[0].report!.metrics.Brier = value;
    assert.throws(() => verifySnapshot(snapshot));
  }
  const source = artificialSnapshot(); source.runs[0].quality.actualExecutionClaim = true;
  assert.throws(() => verifySnapshot(source), /sourceClaim/);
  const adopted = artificialSnapshot(); Object.assign(adopted.runs[0], { adoption: true });
  assert.throws(() => verifySnapshot(adopted));
});

test('actual cycles: monotonic committed prefixes extend, while old scores and events cannot change', () => {
  const before = verifySnapshot(artificialSnapshot('MODEL_VERIFIED'));
  const after = verifySnapshot(artificialSnapshot('SCORE_REGISTERED'));
  assert.equal(verifyExtension(before, after), 'EXTENSION');
  const next = structuredClone(after); next.servedAt = '2030-01-01T00:03:00Z';
  assert.equal(verifyExtension(after, next), 'EXTENSION');
  next.runs[0].cycles[0].report!.metrics.Brier = .1;
  assert.throws(() => verifyExtension(after, next), /report.changed/);
  const fork = structuredClone(after); fork.runs[0].events[0].eventHash = h('fork');
  assert.throws(() => verifyExtension(after, fork), /events.fork/);
  const started = verifySnapshot(artificialSnapshot('MODEL_STARTED'));
  const replacedTask = structuredClone(before); replacedTask.runs[0].cycles[0].model.taskRef = h('replacement-task');
  assert.throws(() => verifyExtension(started, replacedTask), /model.taskChanged/);
});

test('actual cycles: generation changes resynchronize; same-generation cursor rollback is rejected', () => {
  const previous = verifySnapshot(artificialSnapshot());
  const empty: Snapshot = { schemaVersion: 'real-cycle-monitor-v1', generationId: 'next-generation', cursor: 0, servedAt: previous.servedAt, lastReceivedAt: null, runs: [] };
  assert.equal(verifyExtension(previous, verifySnapshot(empty)), 'RESYNC');
  empty.generationId = previous.generationId;
  assert.throws(() => verifyExtension(previous, empty), /cursor.rollback/);
});

test('actual cycles: decisions and proposed next fit bind to the fixed reference and exact prior proposal', () => {
  const policy = artificialSnapshot(); policy.runs[0].cycles[0].mainDecision!.policyRef = h('wrong-policy');
  assert.throws(() => verifySnapshot(policy), /decision.binding/);
  const recipe = artificialSnapshot(); recipe.runs[0].cycles[1].model.recipeRef = h('wrong-recipe');
  assert.throws(() => verifySnapshot(recipe), /model.proposalBinding/);
  const sixth = artificialSnapshot(); sixth.runs[0].cycles[4].proposal!.nextAction = 'CONTINUE';
  assert.throws(() => verifySnapshot(sixth), /proposal.stop/);
});

test('actual cycles: immutable cycle selection, actual counts, and tiny scores remain meaningful', () => {
  const run = verifySnapshot(artificialSnapshot()).runs[0];
  assert.equal(selectedCycle(run, run.cycles[2].cycleId)?.model.modelId, 'artificial-model-3');
  assert.equal(selectedCycle(run, run.baseline!.cycleId), undefined);
  assert.deepEqual(verifiedRows(run.cycles[2]), { trainingRows: 12, predictionRows: 6 });
  assert.equal(score(2.4e-6), '2.400e-6');
  assert.equal(score(null), '—');
});

test('actual cycles: SSE invalidations are closed and bounded, not score-bearing packets', () => {
  const event = { schemaVersion: 'real-cycle-event-v1', serverSeq: 1, eventId: h('event'), runId: 'run', attemptId: 'attempt', sourceGenerationId: 'source', producerSeq: 0, cycleIndex: 0, kind: 'RUN_STARTED', occurredAt: '2030-01-01T00:00:00Z', observedAt: '2030-01-01T00:00:01Z', receivedAt: '2030-01-01T00:00:02Z' };
  verifyInvalidation(event);
  assert.throws(() => verifyInvalidation({ ...event, score: .1 }));
  assert.throws(() => verifyInvalidation({ ...event, cycleIndex: 6 }), /bounds/);
});

test('actual cycles: a 503 read rejects without replacing the previously validated object', async () => {
  const originalFetch = globalThis.fetch, prior = verifySnapshot(artificialSnapshot('MODEL_VERIFIED'));
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(input, '/api/v7/real-cycles/snapshot'); assert.equal(init?.method, 'GET');
      return new Response(JSON.stringify({ error: { code: 'SOURCE_UNAVAILABLE' } }), { status: 503 });
    };
    await assert.rejects(readSnapshot(new AbortController().signal), /HTTP_503/);
    assert.equal(prior.runs[0].cycles[0].model.state, 'VERIFIED');
    assert.equal(prior.runs[0].cycles[0].report, null);
  } finally { globalThis.fetch = originalFetch; }
});
