import schema from './snapshot.schema.json' with {type:'json'};
import type {SavedReview} from './types';
type Shape={type?:string;properties?:Record<string,Shape>;required?:string[];additionalProperties?:boolean;items?:Shape;anyOf?:Shape[];const?:unknown;enum?:unknown[];minimum?:number;maximum?:number;minLength?:number;maxLength?:number;minItems?:number;maxItems?:number;pattern?:string;format?:string;};
const keywords=new Set(['$schema','type','properties','required','additionalProperties','items','anyOf','const','enum','minimum','maximum','minLength','maxLength','minItems','maxItems','pattern','format']);
function need(ok:unknown):asserts ok {if(!ok)throw Error('SAVED_REVIEW_CONTRACT_MISMATCH');}
/** Only the subset used by this pinned schema; unknown schema vocabulary fails closed. */
function validate(value:unknown,s:Shape):void{
  need(Object.keys(s).every(k=>keywords.has(k)));
  if(s.anyOf){need(s.anyOf.some(branch=>{try{validate(value,branch);return true;}catch{return false;}}));return;}
  if(Object.hasOwn(s,'const'))need(value===s.const);
  if(s.enum)need(s.enum.includes(value));
  if(s.type==='null'){need(value===null);return;}
  if(s.type==='boolean'){need(typeof value==='boolean');return;}
  if(s.type==='object'){
    need(typeof value==='object'&&value!==null&&!Array.isArray(value));const v=value as Record<string,unknown>;
    need(s.required?.every(k=>Object.hasOwn(v,k))??true);
    if(s.additionalProperties===false)need(Object.keys(v).every(k=>Object.hasOwn(s.properties??{},k)));
    for(const [key,shape] of Object.entries(s.properties??{}))if(Object.hasOwn(v,key))validate(v[key],shape);
    return;
  }
  if(s.type==='array'){
    need(Array.isArray(value)&&value.length>=(s.minItems??0)&&value.length<=(s.maxItems??Number.MAX_SAFE_INTEGER));
    if(s.items)for(const item of value)validate(item,s.items);return;
  }
  if(s.type==='string'){
    need(typeof value==='string'&&value.length>=(s.minLength??0)&&value.length<=(s.maxLength??Number.MAX_SAFE_INTEGER));
    if(s.pattern)need(new RegExp(s.pattern).test(value));
    if(s.format){need(s.format==='date-time');need(/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value)));}return;
  }
  if(s.type==='number'||s.type==='integer'){
    need(typeof value==='number'&&Number.isFinite(value)&&value>=(s.minimum??-Number.MAX_SAFE_INTEGER)&&value<=(s.maximum??Number.MAX_SAFE_INTEGER));
    if(s.type==='integer')need(Number.isSafeInteger(value));return;
  }
  need(s.type===undefined&&(Object.hasOwn(s,'const')||s.enum!==undefined));
}
export function verifyReview(value:unknown):SavedReview{
  validate(value,schema as Shape);const v=value as SavedReview;
  if(v.attachmentStatus!=='LINKED_SAVED_REVIEW')need(v.revisions.length===0&&v.proposalFrames.length===0&&v.terminal===null);
  else {
    need(v.monitorBinding!==null&&v.terminal!==null);
    need(v.monitorBinding.runId===v.source.sourceResearchRunId&&v.monitorBinding.verifiedSourcePrefix.seq===v.source.capturedHead.seq&&v.monitorBinding.verifiedSourcePrefix.hash===v.source.capturedHead.hash);
    need(v.terminal.sourceGeneration===v.source.capturedHead.seq&&v.terminal.sourceGenerationHash===v.source.capturedHead.hash);
    const revisions=new Map(v.revisions.map(r=>[r.revisionRef,r]));need(revisions.size===v.revisions.length);
    for(const r of v.revisions)need(r.decisionReviewCompleteObjectRef===v.source.decisionReviewCompleteObjectRef&&r.times.decisionOccurredAt===null&&r.times.monitorReceivedAt===null);
    for(const f of v.proposalFrames){
      need(f.sourceGeneration<v.source.capturedHead.seq&&f.registeredPrefix.every(r=>r.registeredGeneration<=f.sourceGeneration));
      need(new Set(f.registeredPrefix.map(r=>r.candidateId)).size===f.registeredPrefix.length);
      if(f.proposalStatus==='REVIEW_HELD')need(f.reviewProposalViewRef===null&&f.history.length===0&&f.selectedRevisionRefs.length===0);
      else need(f.reviewProposalViewRef!==null);
      need(f.history.length===f.selectedRevisionRefs.length);
      f.history.forEach((h,i)=>{const r=revisions.get(h.revisionRef);need(r&&r.purpose==='MAIN'&&h.revisionRef===f.selectedRevisionRefs[i]&&r.decisionRef===h.decisionRef);
        need(r.policyRef===f.policyRef&&r.planRef===f.planRef&&r.decisionContractFileSha256===f.contractFileSha256);
        need(h.candidateId===r.candidate.candidateId&&h.reportHash===r.candidate.reportHash&&h.referenceCandidateId===r.reference.candidateId&&h.referenceReportHash===r.reference.reportHash);
        need(f.reference.candidateId===h.referenceCandidateId&&f.reference.reportHash===h.referenceReportHash);
        for(const side of [r.candidate,r.reference])need(f.registeredPrefix.some(p=>p.candidateId===side.candidateId&&p.reportHash===side.reportHash&&p.registeredGeneration===side.registeredGeneration&&p.registrationGenerationHash===side.registrationGenerationHash));
      });
    }
  }
  return v;
}
