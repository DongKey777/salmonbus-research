import type {V2Snapshot} from '../observer-contract';
import type {SavedReview} from './types';
export type ReviewMatch='MATCHED'|'WAITING'|'DIFFERENT_RUN'|'MISMATCH';
/** Attach only to matching visible registrations. Never modify the v2 snapshot. */
export function matchReview(review:SavedReview,snapshot:V2Snapshot|undefined,selectedRunId:string|undefined):ReviewMatch{
  if(!snapshot||!selectedRunId)return 'WAITING';
  if(selectedRunId!==review.source.sourceResearchRunId)return 'DIFFERENT_RUN';
  if(review.attachmentStatus!=='LINKED_SAVED_REVIEW'||!review.monitorBinding)return 'WAITING';
  const binding=review.monitorBinding;
  if(snapshot.generationId!==binding.generationId)return 'MISMATCH';
  const run=snapshot.runs.find(r=>r.runId===binding.runId);
  if(!run)return 'WAITING';
  if(run.sourceKind!=='ACTUAL_SAVED_SYNTHETIC')return 'MISMATCH';
  if(run.head.seq<review.source.capturedHead.seq)return 'WAITING';
  if(run.events[review.source.capturedHead.seq]?.sourceHash!==review.source.capturedHead.hash)return 'MISMATCH';
  for(const row of review.revisions){
    for(const side of [row.candidate,row.reference]){
      const report=run.registeredCandidates.find(r=>r.candidateId===side.candidateId),event=run.events[side.registeredGeneration];
      if(!report||!event)return 'MISMATCH';
      if(report.reportHash!==side.reportHash||report.registeredGeneration!==side.registeredGeneration||event.sourceHash!==side.registrationGenerationHash||event.sourceId!==side.registrationSourceId||event.journalEvent!=='NEW_REPORT_REGISTERED'||!event.registeredCandidateIds.includes(side.candidateId))return 'MISMATCH';
      if(report.sourceCohortHash!==row.sourceCohortRef||report.cohortHash!==row.monitorComparison.cohortHash||report.comparisonContractHash!==row.monitorComparison.comparisonContractHash)return 'MISMATCH';
    }
    if(!run.comparisonGroups.some(g=>g.cohortHash===row.monitorComparison.cohortHash&&g.comparisonContractHash===row.monitorComparison.comparisonContractHash&&g.candidateIds.includes(row.candidate.candidateId)&&g.candidateIds.includes(row.reference.candidateId)))return 'MISMATCH';
  }
  for(const f of review.proposalFrames){
    if(run.events[f.sourceGeneration]?.sourceHash!==f.sourceGenerationHash)return 'MISMATCH';
    const reports=run.registeredCandidates.filter(r=>r.registeredGeneration<=f.sourceGeneration);
    if(reports.length!==f.registeredPrefix.length)return 'MISMATCH';
    if(reports.some((r,i)=>{const p=f.registeredPrefix[i];return r.candidateId!==p.candidateId||r.reportHash!==p.reportHash||r.registeredGeneration!==p.registeredGeneration||run.events[r.registeredGeneration]?.sourceHash!==p.registrationGenerationHash;}))return 'MISMATCH';
  }
  return 'MATCHED';
}

export function catalogGate(snapshot:V2Snapshot|undefined,selectedRunId:string|undefined,catalog:{sourceRunId:string;generationId:string;head:{seq:number;hash:string}}):ReviewMatch{
  if(!snapshot||!selectedRunId)return 'WAITING';
  if(selectedRunId!==catalog.sourceRunId)return 'DIFFERENT_RUN';
  if(snapshot.generationId!==catalog.generationId)return 'MISMATCH';
  const run=snapshot.runs.find(r=>r.runId===selectedRunId);
  if(!run||run.head.seq<catalog.head.seq)return 'WAITING';
  return run.sourceKind==='ACTUAL_SAVED_SYNTHETIC'&&run.events[catalog.head.seq]?.sourceHash===catalog.head.hash?'MATCHED':'MISMATCH';
}
