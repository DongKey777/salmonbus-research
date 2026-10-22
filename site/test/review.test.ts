import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifyReview} from '../src/review/contract.ts';
import {matchReview,catalogGate} from '../src/review/join.ts';
import {REVIEW_CATALOG} from '../src/review/catalog.ts';
import {verifyV2} from '../src/observer-contract.ts';
import {frontierOption} from '../src/review/charts.ts';
const read=(p:string)=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
const actual=()=>read('../retired-synthetic-20261021/public/data/controller-saved-review.json');
const monitor=()=>read('./fixtures/review/monitor-registration-snapshot.json');
const artificial=(kind:string)=>{const f=read(`./fixtures/review/${kind}.artificial.json`);assert.equal(f.fixtureKind,'ARTIFICIAL_CONTRACT_EXAMPLE');assert.equal(f.notActualSavedResearch,true);return f.projection;};

test('review: pinned copied bytes and both separately labelled artificial examples pass schema',()=>{
 const bytes=readFileSync(new URL('../retired-synthetic-20261021/public/data/controller-saved-review.json',import.meta.url));
 assert.equal(bytes.length,REVIEW_CATALOG.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),REVIEW_CATALOG.sha256);
 assert.equal(verifyReview(actual()).revisions.length,6);
 for(const k of ['linked','waiting'])verifyReview(artificial(k));
});
test('review: exact stored registration and reviewed pairs match without mutating v2',()=>{
 const r=verifyReview(actual()),s=verifyV2(monitor()),before=JSON.stringify(s);
 assert.equal(catalogGate(s,r.source.sourceResearchRunId,REVIEW_CATALOG),'MATCHED');
 assert.equal(matchReview(r,s,r.source.sourceResearchRunId),'MATCHED');assert.equal(JSON.stringify(s),before);
 assert.equal(s.runs[0].decisionStatus,'NOT_CONNECTED');assert.equal(s.cursor,43);
});
test('review: early source frontier forbids catalog loading',()=>{
 const s=monitor();s.runs[0].head.seq=16;
 assert.equal(catalogGate(s,s.runs[0].runId,REVIEW_CATALOG),'WAITING');
 assert.equal(matchReview(verifyReview(actual()),s,s.runs[0].runId),'WAITING');
});
test('review: different generation and run never inherit the saved review',()=>{
 const s=monitor(),r=verifyReview(actual());s.generationId='different';
 assert.equal(matchReview(r,s,r.source.sourceResearchRunId),'MISMATCH');
 assert.equal(catalogGate(s,'unrelated',REVIEW_CATALOG),'DIFFERENT_RUN');
});
test('review: different report or explicit reference is rejected',()=>{
 const r=verifyReview(actual()),s=monitor();s.runs[0].registeredCandidates[0].reportHash='0'.repeat(64);
 assert.equal(matchReview(r,s,r.source.sourceResearchRunId),'MISMATCH');
});
test('review: registration identity and both cohort namespaces are checked',()=>{
 const r=verifyReview(actual());
 for(const kind of ['sourceId','sourceCohortHash','comparisonContractHash']){
  const s=monitor();if(kind==='sourceId')s.runs[0].events[13].sourceId='0'.repeat(64);else s.runs[0].registeredCandidates[1][kind]='0'.repeat(64);
  assert.equal(matchReview(r,s,r.source.sourceResearchRunId),'MISMATCH');
 }
});
test('review: new metric, deployment and provider-dispatch claims are rejected',()=>{
 const metric=actual();metric.metrics={Brier:0};assert.throws(()=>verifyReview(metric),/CONTRACT/);
 const deploy=actual();deploy.scope.mayDeploy=true;assert.throws(()=>verifyReview(deploy),/CONTRACT/);
 const dispatch=actual();dispatch.proposalFrames[0].sentToProvider=true;assert.throws(()=>verifyReview(dispatch),/CONTRACT/);
});
test('review: auxiliary revision cannot replace the main proposal history',()=>{
 const r=actual(),f=r.proposalFrames[0],aux=r.revisions.find((x:{purpose:string})=>x.purpose==='AUXILIARY');
 f.history[0].revisionRef=aux.revisionRef;f.history[0].decisionRef=aux.decisionRef;f.selectedRevisionRefs[0]=aux.revisionRef;
 assert.throws(()=>verifyReview(r),/CONTRACT/);
});
test('review: future registration, wrong plan and terminal dispatch are rejected',()=>{
 const future=actual();future.proposalFrames[0].registeredPrefix[1].registeredGeneration=39;assert.throws(()=>verifyReview(future),/CONTRACT/);
 const plan=actual();plan.proposalFrames[0].planRef='0'.repeat(64);assert.throws(()=>verifyReview(plan),/CONTRACT/);
 const terminal=actual();terminal.terminal.dispatchAllowed=true;assert.throws(()=>verifyReview(terminal),/CONTRACT/);
});
test('review: missing source cannot expose revision or frame counts',()=>{
 const r=artificial('waiting');assert.equal(verifyReview(r).revisions.length,0);assert.equal(r.proposalFrames.length,0);
 r.revisions=actual().revisions;assert.throws(()=>verifyReview(r),/CONTRACT/);
});
test('review: missing historical times stay null, adapter read is not decision time',()=>{
 const r=verifyReview(actual());assert.ok(r.revisions.every(x=>x.times.decisionOccurredAt===null&&x.times.monitorReceivedAt===null));
 const changed=actual();changed.revisions[0].times.decisionOccurredAt=changed.servedAt;assert.throws(()=>verifyReview(changed),/CONTRACT/);
});
test('review: proposal graph contains only each historical registered prefix',()=>{
 const r=verifyReview(actual());const a=frontierOption(r.proposalFrames[0],{}),b=frontierOption(r.proposalFrames[1],{});
 assert.equal((a.series as {data:unknown[]}[])[0].data.length,2);assert.equal((b.series as {data:unknown[]}[])[0].data.length,3);
 assert.equal(r.proposalFrames[0].history.length,1);assert.equal(r.proposalFrames[1].history.length,2);
 assert.ok(r.proposalFrames[0].registeredPrefix.every(x=>x.registeredGeneration<=17));
});
