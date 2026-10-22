export interface Pair {
  candidateId:string; reportHash:string; inputRef:string; registeredGeneration:number;
  registrationGenerationHash:string; registrationSourceId:string;
}
export interface Revision {
  reviewRevisionId:string; decisionFamilyRef:string; revisionRef:string; decisionRef:string;
  decisionContextRef:string; decisionReviewCompleteObjectRef:string; recordIndex:number;
  recordFileSha256:string; trustedAnchorFileSha256:string; revisitsSourceComparisonReceiptRef:string;
  revisionSource:'SECTION54_SAVED_REVIEW'; purpose:'MAIN'|'AUXILIARY'; policyRef:string;
  planRef:string; decisionContractFileSha256:string; sourceCohortRef:string;
  candidate:Pair; reference:Pair; monitorComparison:{cohortHash:string;comparisonContractHash:string};
  linkStatus:'LINKED_SAVED_REVIEW'; producerValidity:'VALID'|'INVALID';
  outcome:'INCONCLUSIVE'|'CRITERIA_NOT_MET'; times:Record<string,string|null>;
}
export interface ProposalFrame {
  sourceGeneration:number; sourceGenerationHash:string; sourceRecordedAt:string|null;
  proposalStatus:'HISTORICAL_DRAFT_NOT_SENT'|'REVIEW_HELD';
  originalProposalViewRef:string|null; reviewProposalViewRef:string|null;
  policyRef:string; planRef:string; contractFileSha256:string;
  reference:{candidateId:string;reportHash:string};
  registeredPrefix:{candidateId:string;reportHash:string;registeredGeneration:number;registrationGenerationHash:string}[];
  history:{candidateId:string;reportHash:string;referenceCandidateId:string;referenceReportHash:string;decisionRef:string;revisionRef:string}[];
  selectedRevisionRefs:string[]; publicHistoryBindingRef:string;
  dispatchAllowed:false; sentToProvider:false; historicalResponsesRevalidated:false;
  historicalTrajectoryAuthority:'ORIGINAL_ONLY';
}
export interface SavedReview {
  schemaVersion:'controller-saved-review-v1'; sourceKind:'SAVED_SYNTHETIC_CONTROLLER_REVIEW';
  servedAt:string; catalogRef:string;
  attachmentStatus:'NOT_CONNECTED'|'WAITING_FOR_REGISTRATION'|'LINKED_SAVED_REVIEW';
  source:{sourceResearchRunId:string;sourceContextRef:string;capturedHead:{seq:number;hash:string};
    bridgeReceiptFileSha256:string;connectionEvidenceFileSha256:string;decisionReviewCompleteObjectRef:string;
    upstreamValidation:'OWNER_VERIFIED_SECTION55_EXPORT';contextValidation:'UPSTREAM_OWNER_ATTESTED_NOT_RECHECKED'};
  monitorBinding:{namespace:'MONITOR_V2_COMPARISON';snapshotFileSha256:string;generationId:string;cursor:number;runId:string;verifiedSourcePrefix:{seq:number;hash:string}}|null;
  revisions:Revision[]; proposalFrames:ProposalFrame[];
  terminal:{sourceGeneration:number;sourceGenerationHash:string;sourcePhase:'CLOSED';proposalStatus:'CLOSED_NO_DISPATCH';proposalViewRef:null;dispatchAllowed:false}|null;
  scope:{reviewMode:'SAVED_RESULT_REVIEW';newResearchRun:false;originalResearchReexecuted:false;newFits:0;newScores:0;newProviderCalls:0;mayDeploy:false;realStatisticalCoverageValidated:false;overallEnvironment:'NOT_READY';policyAdopted:false};
}
