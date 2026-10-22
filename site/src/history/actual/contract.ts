import { verifyPoint } from '../contract.ts';
import type { Counts, MetricPoint } from '../types.ts';
import * as schemas from './schemas.ts';
import { validateSchema } from './schema-validator.ts';
import { ACTUAL_METRICS, METHODS } from './types.ts';
import type { ActualCatalogRequest, ActualGroup, ActualRangeRequest, ActualTrial, Anchor, CatalogResponse, GroupsResponse, InvalidationResponse, ModelResponse, Provenance, RangeResponse, ReferenceResponse, TrialResponse } from './types.ts';

function fail(path: string): never { throw new Error(`HISTORY_ACTUAL_SEMANTICS:${path}`); }
function anchorRules(value: Anchor, expected: Anchor) {
  if (value.historyGenerationId !== expected.historyGenerationId || value.snapshotCursor !== expected.snapshotCursor) fail('snapshotMismatch');
}
function countRules(counts: Counts) {
  if (counts.validCount + counts.nullCount + counts.invalidCount + counts.unregisteredCount !== counts.totalTrials ||
    counts.failedCount + counts.heldCount + counts.runningCount > counts.totalTrials) fail('countPartition');
}
function supportRules(support: ActualTrial['support'], provenance: Provenance) {
  if (support.rows !== null && provenance.validationRows !== null && support.rows !== provenance.validationRows) fail('validationPopulation');
  if (support.groups !== null && support.fullGroups !== null && support.nonFullGroups !== null &&
    support.fullGroups + support.nonFullGroups !== support.groups) fail('groupPartition');
}
function trialRules(trial: ActualTrial, provenance: Provenance) {
  if (trial.cycleIndex < 1 || trial.cycleIndex > 5 || trial.trialOrdinal < 1 || trial.role !== 'CANDIDATE') fail('candidateIdentity');
  if (trial.metrics.ECE !== null) fail('unavailableECE');
  for (const metric of ACTUAL_METRICS) {
    if ((trial.numericValidity !== 'DEFINED' || trial.registrationState !== 'REGISTERED_VERIFIED') && trial.metrics[metric] !== null) fail('unregisteredScore');
  }
  if (trial.numericValidity === 'DEFINED' && (!trial.reportId || !trial.reportRef)) fail('reportIdentity');
  supportRules(trial.support, provenance);
  for (const decision of [trial.decisions.MAIN, trial.decisions.AUX]) {
    if (decision.validity === 'INVALID' ? decision.outcome !== 'INVALID' : decision.outcome === 'INVALID') fail('decisionValidity');
  }
}
export function verifyActualGroups(value: unknown): GroupsResponse {
  validateSchema(value, schemas.groupsSchema, 'groups');
  const result = value as GroupsResponse, extent = result.data.trialExtent;
  if ((extent.fromOrdinal === null) !== (extent.toOrdinal === null) ||
    (extent.fromOrdinal !== null && (extent.fromOrdinal < 1 || extent.toOrdinal! < extent.fromOrdinal))) fail('extent');
  if (new Set(result.data.groups.map(group => group.groupRef)).size !== result.data.groups.length) fail('duplicateGroup');
  return result;
}
export function verifyActualCatalog(value: unknown, expected?: ActualCatalogRequest): CatalogResponse {
  validateSchema(value, schemas.catalogSchema, 'catalog');
  const result = value as CatalogResponse, { rows, page, scope } = result.data;
  rows.forEach(trial => trialRules(trial, result.provenance));
  if (rows.length > page.limit || page.hasMore !== (page.nextCursor !== null) ||
    new Set(rows.map(trial => trial.trialId)).size !== rows.length) fail('page');
  rows.forEach((trial, index) => {
    if (index && (scope.direction === 'DESC' ? rows[index - 1].trialOrdinal <= trial.trialOrdinal : rows[index - 1].trialOrdinal >= trial.trialOrdinal)) fail('catalogOrder');
    for (const key of ['runId', 'attemptId', 'groupRef', 'status'] as const) if (scope[key] !== null && trial[key] !== scope[key]) fail('catalogScope');
  });
  if (expected) {
    anchorRules(result, expected);
    if (page.limit !== expected.limit || scope.direction !== 'DESC' || scope.groupRef !== (expected.groupRef || null) ||
      scope.status !== (expected.status || null) || scope.runId !== null || scope.attemptId !== null) fail('catalogRequest');
  }
  return result;
}
export function verifyActualRange(value: unknown, expected?: ActualRangeRequest): RangeResponse {
  validateSchema(value, schemas.rangeSchema, 'range');
  const result = value as RangeResponse, range = result.data;
  if (range.method !== METHODS[range.metric] || range.fromOrdinal < 1 || range.toOrdinal < range.fromOrdinal ||
    range.toOrdinal - range.fromOrdinal >= 10000) fail('rangeDefinition');
  if (range.mode === 'RAW' ? range.buckets.length !== 0 : range.points.length !== 0) fail('rangeMode');
  const checkPoint = (point: MetricPoint, from: number, to: number) => {
    verifyPoint(point);
    if (point.trialOrdinal < from || point.trialOrdinal > to || (range.method === null && point.value !== null)) fail('rangePoint');
  };
  range.points.forEach((point, index) => {
    checkPoint(point, range.fromOrdinal, range.toOrdinal);
    if (index && range.points[index - 1].trialOrdinal >= point.trialOrdinal) fail('pointOrder');
  });
  range.buckets.forEach((bucket, index) => {
    if (bucket.fromOrdinal < range.fromOrdinal || bucket.toOrdinal > range.toOrdinal || bucket.toOrdinal < bucket.fromOrdinal ||
      (index && range.buckets[index - 1].toOrdinal >= bucket.fromOrdinal)) fail('bucketOrder');
    countRules(bucket.counts);
    const samples = [bucket.first, bucket.last, bucket.min, bucket.max];
    if (bucket.counts.validCount === 0 ? samples.some(Boolean) || bucket.continuity !== 'NO_VALID' :
      samples.some(point => point === null) || bucket.continuity !== (bucket.counts.validCount === bucket.counts.totalTrials ? 'ALL_VALID' : 'HAS_GAPS')) fail('bucketContinuity');
    for (const point of samples) if (point) { checkPoint(point, bucket.fromOrdinal, bucket.toOrdinal); if (point.metricState !== 'VALID') fail('invalidSample'); }
    if (bucket.min && bucket.max && (bucket.min.value! > bucket.max.value! ||
      [bucket.first!, bucket.last!].some(point => point.value! < bucket.min!.value! || point.value! > bucket.max!.value!))) fail('bucketExtrema');
  });
  countRules(range.counts);
  const derived: Counts = { totalTrials: 0, validCount: 0, nullCount: 0, invalidCount: 0, unregisteredCount: 0, failedCount: 0, heldCount: 0, runningCount: 0 };
  if (range.mode === 'RAW') {
    for (const point of range.points) {
      derived.totalTrials++;
      derived[({ VALID: 'validCount', NULL: 'nullCount', INVALID: 'invalidCount', UNREGISTERED: 'unregisteredCount' } as const)[point.metricState]]++;
      if (point.status === 'FAILED') derived.failedCount++;
      if (point.status === 'HELD') derived.heldCount++;
      if (point.status === 'RUNNING') derived.runningCount++;
    }
  } else for (const bucket of range.buckets) for (const key of Object.keys(derived) as (keyof Counts)[]) derived[key] += bucket.counts[key];
  for (const key of Object.keys(derived) as (keyof Counts)[]) if (derived[key] !== range.counts[key]) fail('rangeCounts');
  const { carryIn, end } = range.observedBestSoFar;
  for (const point of [carryIn, end]) if (point) { verifyPoint(point); if (point.metricState !== 'VALID' || range.method === null) fail('bestValidity'); }
  if (carryIn && carryIn.trialOrdinal >= range.fromOrdinal || end && end.trialOrdinal > range.toOrdinal ||
    carryIn && (!end || end.value! > carryIn.value!) || range.counts.validCount > 0 && !end) fail('bestPrefix');
  if (expected) {
    anchorRules(result, expected);
    if (range.groupRef !== expected.groupRef || range.metric !== expected.metric || range.mode !== expected.mode ||
      range.fromOrdinal !== expected.fromOrdinal || range.toOrdinal !== expected.toOrdinal) fail('rangeRequest');
  }
  return result;
}
export function verifyActualTrial(value: unknown, expected: Anchor & { trialId: string; group: ActualGroup }): TrialResponse {
  validateSchema(value, schemas.trialSchema, 'trial');
  const result = value as TrialResponse, { trial, evaluation } = result.data;
  anchorRules(result, expected); trialRules(trial, result.provenance);
  if (trial.trialId !== expected.trialId || trial.groupRef !== expected.group.groupRef ||
    evaluation.evaluationId !== trial.evaluationId || evaluation.evaluationRevisionRef !== trial.evaluationRevisionRef ||
    evaluation.modelId !== trial.modelId || evaluation.modelRevisionRef !== trial.modelRevisionRef ||
    evaluation.sourceReportRef !== trial.reportRef || evaluation.groupRef !== trial.groupRef ||
    evaluation.comparisonRef !== expected.group.comparisonRef || evaluation.sourceGroupRef !== expected.group.sourceGroupRef ||
    evaluation.registration.eventHash !== trial.sourceRegistration.eventHash || evaluation.registration.producerSeq !== trial.sourceRegistration.producerSeq) fail('evaluationBinding');
  for (const purpose of ['MAIN', 'AUX'] as const) {
    const detail = evaluation[purpose === 'MAIN' ? 'mainDecision' : 'auxDecision'], compact = trial.decisions[purpose];
    if (detail.purpose !== purpose || detail.candidateReportRef !== trial.reportRef ||
      detail.referenceReportRef !== expected.group.conditions.referenceReportRef || detail.comparisonRef !== expected.group.comparisonRef ||
      detail.policyRef !== expected.group.conditions[purpose === 'MAIN' ? 'mainPolicyRef' : 'auxPolicyRef'] ||
      (['outcome', 'validity', 'revisionRef', 'policyRef'] as const).some(key => detail[key] !== compact[key])) fail('decisionBinding');
  }
  const proposal = evaluation.proposal;
  if (proposal.mainRevisionRef !== evaluation.mainDecision.revisionRef || proposal.auxRevisionRef !== evaluation.auxDecision.revisionRef ||
    proposal.sourcePrefix.eventHash !== evaluation.auxDecision.event.eventHash || proposal.sourcePrefix.producerSeq !== evaluation.auxDecision.event.producerSeq ||
    proposal.proposalEvent.producerSeq !== proposal.sourcePrefix.producerSeq + 1) fail('proposalBinding');
  const next = [proposal.selectedCandidateId, proposal.selectedRecipeRef, proposal.selectedTaskTemplateRef, proposal.consumptionRef, proposal.nextReservationRef, proposal.consumptionEvent];
  if (proposal.nextAction === 'STOP' ? next.some(value => value !== null) : next.some(value => value === null)) fail('proposalStop');
  return result;
}
export function verifyActualModel(value: unknown, expected: Anchor & { trial: ActualTrial; group: ActualGroup }): ModelResponse {
  validateSchema(value, schemas.modelSchema, 'model');
  const result = value as ModelResponse, model = result.data.model, trial = expected.trial;
  anchorRules(result, expected);
  if (result.data.requestedModelRevisionRef !== trial.modelRevisionRef ||
    (['modelId', 'modelRevisionRef', 'modelDefinitionId', 'candidateId', 'cycleIndex'] as const).some(key => model[key] !== trial[key])) fail('modelSelection');
  if (model.weightsRef !== model.pins.modelStateSha256 || model.recipeRef !== model.pins.recipeRef ||
    (trial.support.rows !== null && model.counts.predictionRows !== trial.support.rows) ||
    (result.provenance.trainingRows !== null && model.counts.trainingRows !== result.provenance.trainingRows) ||
    model.pins.scorerRef !== expected.group.conditions.scorerRef || model.pins.mainPolicyRef !== expected.group.conditions.mainPolicyRef ||
    model.pins.auxPolicyRef !== expected.group.conditions.auxPolicyRef) fail('modelPins');
  return result;
}
export function verifyActualReference(value: unknown, expected: Anchor & { group: ActualGroup }): ReferenceResponse {
  validateSchema(value, schemas.referenceSchema, 'reference');
  const result = value as ReferenceResponse, reference = result.data.reference;
  anchorRules(result, expected); supportRules(reference.support, result.provenance);
  if (reference.groupRef !== expected.group.groupRef || reference.comparisonRef !== expected.group.comparisonRef ||
    reference.sourceGroupRef !== expected.group.sourceGroupRef || reference.referenceReportRef !== expected.group.conditions.referenceReportRef ||
    reference.metrics.NRPS !== null || reference.metrics.ECE !== null) fail('externalReference');
  return result;
}
export function verifyActualInvalidation(value: unknown): InvalidationResponse {
  validateSchema(value, schemas.invalidationSchema, 'invalidation');
  const event = value as InvalidationResponse;
  if (event.commitCursor < 1 || event.fromTrialOrdinal < 1 || event.toTrialOrdinal < event.fromTrialOrdinal ||
    event.modelCount !== event.evaluationCount || event.modelCount !== event.toTrialOrdinal - event.fromTrialOrdinal + 1) fail('bundleCounts');
  return event;
}
