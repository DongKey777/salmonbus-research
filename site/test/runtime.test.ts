import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyRuntime,verifyExtension} from '../src/runtime/contract.ts';
import {projectRuntime,signalLabel} from '../src/runtime/project.ts';
import {memoryOption,workOption} from '../src/runtime/charts.ts';
const fixture=(name='running')=>JSON.parse(readFileSync(new URL(`./fixtures/runtime/snapshot.${name}.json`,import.meta.url),'utf8'));
const view=(value:unknown)=>projectRuntime(verifyRuntime(value));
test('runtime: three closed source examples and empty source are accepted',()=>{
 for(const name of ['running','stopped','finished-verified'])assert.equal(view(fixture(name)).attempts.length,1);
 const f=fixture();f.runs=[];assert.equal(view(f).attempts.length,0);
});
test('runtime: execution finished alone never verifies the result',()=>{
 const f=fixture('finished-verified');f.runs[0].attempts[0].completionEvidence={state:'NOT_REPORTED',evidenceId:null,checkedAt:null,claimHash:null,reason:null,scope:'SYNTHETIC_INTEGER_TRANSFORM_ONLY'};
 const a=view(f).attempts[0];assert.equal(a.terminal,true);assert.equal(a.proofVerified,false);
});
test('runtime: verified receipt must bind the final worker claim',()=>{
 const f=fixture('finished-verified');f.runs[0].attempts[0].completionEvidence.claimHash='0'.repeat(64);assert.throws(()=>verifyRuntime(f),/CONTRACT/);
});
test('runtime: old worker signal and transport error do not become failed execution',()=>{
 const a=view(fixture()).attempts[0];assert.equal(a.stateLabel,'실행 중');
 assert.equal(signalLabel(a,7,false),'작업 신호 지연 · 상태 미확정');
 assert.equal(signalLabel(a,0,true),'작업 신호 확인 불가');assert.equal(a.stateLabel,'실행 중');
});
test('runtime: fresh API timestamp cannot claim a fresh old heartbeat',()=>{
 const f=fixture();f.servedAt='2030-01-01T00:00:20Z';assert.throws(()=>verifyRuntime(f),/CONTRACT/);
 f.runs[0].attempts[0].observation={state:'STALE',ageSeconds:19,staleAfterSeconds:5,basis:'LAST_WORKER_RECEIPT'};
 assert.equal(view(f).attempts[0].observationState,'STALE');
});
test('runtime: missing current RSS remains null, not peak or zero',()=>{
 const a=view(fixture()).attempts[0];const option=memoryOption(a);const series=option.series as {id:string;data:(number|null)[][]}[];
 assert.equal(series.find(s=>s.id==='currentRssMiB')!.data[0][1],null);
 assert.equal(series.find(s=>s.id==='peakRssMiB')!.data[0][1],24.5);
});
test('runtime: real data and private field escalation are rejected',()=>{
 const f=fixture();f.sourceKind='REAL_DATA';assert.throws(()=>verifyRuntime(f),/CONTRACT/);
 const g=fixture();g.runs[0].attempts[0].events[0].raw='forbidden';assert.throws(()=>verifyRuntime(g),/CONTRACT/);
 const h=fixture();h.scope.modelTraining=true;assert.throws(()=>verifyRuntime(h),/CONTRACT/);
});
test('runtime: event gap, reversed progress and changed denominator are rejected',()=>{
 const f=fixture();f.runs[0].attempts[0].events[1].producerSeq=2;assert.throws(()=>verifyRuntime(f),/CONTRACT/);
 const g=fixture();g.runs[0].attempts[0].events[1].progress.totalUnits=12;assert.throws(()=>verifyRuntime(g),/CONTRACT/);
 const h=fixture();h.runs[0].attempts[0].events[1].monotonicElapsedSeconds=-1;assert.throws(()=>verifyRuntime(h),/CONTRACT/);
});
test('runtime: accepted prefix cannot disappear or change',()=>{
 const first=verifyRuntime(fixture()),same=verifyRuntime(fixture());verifyExtension(first,same);
 const rollback=fixture();rollback.runs=[];assert.throws(()=>verifyExtension(first,verifyRuntime(rollback)),/CONTRACT/);
 const changed=fixture();changed.runs[0].attempts[0].events[0].occurredAt='2030-01-01T00:00:00.1Z';assert.throws(()=>verifyExtension(first,verifyRuntime(changed)),/CONTRACT/);
});
test('runtime: object property order is not an evidence change',()=>{
 const first=verifyRuntime(fixture()),f=fixture();f.runs[0].attempts[0].events[0].progress={unit:'INTEGER_RECORDS',totalUnits:1024,completedUnits:0};
 verifyExtension(first,verifyRuntime(f));
});
test('runtime: pacing is explicit and charts use measured monotonic time',()=>{
 const a=view(fixture()).attempts[0];assert.equal(a.paced,true);assert.equal(a.pacingMs,1000);
 const option=workOption(a);const series=option.series as {data:number[][]}[];assert.equal(series.at(-1)!.data.at(-1)![0],1);
 const f=fixture();f.runs[0].attempts[0].pacing.pacedForObservation=false;assert.throws(()=>verifyRuntime(f),/CONTRACT/);
});
