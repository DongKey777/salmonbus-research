import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyPreparation} from '../src/preparation/contract.ts';
import {projectPreparation} from '../src/preparation/project.ts';
import {freshness} from '../src/preparation/presentation.ts';
import {memoryOption,timelineOption} from '../src/preparation/charts.ts';

const fixture=(name='running')=>JSON.parse(readFileSync(new URL(`./fixtures/preparation/${name}.json`,import.meta.url),'utf8'));
const project=(value:unknown)=>projectPreparation(verifyPreparation(value));

test('all three fixed API examples satisfy the frontend contract',()=>{
 for(const name of ['running','stopped-intermediate','reported-verified-example'])assert.equal(project(fixture(name)).jobs.length,2);
});
test('stopped original keeps intermediate values separate from verified results',()=>{
 const job=project(fixture('stopped-intermediate')).jobs[0];
 assert.equal(job.status,'STOPPED');assert.equal(job.countScope,'INTERMEDIATE');assert.equal(job.counts?.groups,988235);
});
test('an original attempt may never acquire accepted counts by changing a status',()=>{
 const f=fixture('stopped-intermediate');f.attempts[0].acceptedCounts=f.attempts[0].intermediateCounts;
 assert.throws(()=>verifyPreparation(f),/CONTRACT/);
});
test('new audit success requires explicit reported proof and preserves global unreadiness',()=>{
 const f=fixture('reported-verified-example');assert.equal(project(f).jobs[1].countScope,'VERIFIED');
 f.attempts[1].proofStatus=null;assert.throws(()=>verifyPreparation(f),/CONTRACT/);
});
test('unexpected private fields and unsafe numeric counts are rejected',()=>{
 const f=fixture();f.attempts[0].privatePath='do-not-render';assert.throws(()=>verifyPreparation(f),/CONTRACT/);
 const g=fixture();g.attempts[0].inputs.evaluationRows=Number.MAX_SAFE_INTEGER+1;assert.throws(()=>verifyPreparation(g),/CONTRACT/);
});
test('duplicate attempts and non-finite measurements cannot enter charts',()=>{
 const f=fixture();f.attempts[1]=structuredClone(f.attempts[0]);assert.throws(()=>verifyPreparation(f),/CONTRACT/);
 const g=fixture();g.attempts[1].samples[0].freeGiB=Infinity;assert.throws(()=>verifyPreparation(g),/CONTRACT/);
});
test('servedAt and file update time never become a fresh job report',()=>{
 const f=fixture();const before=project(f).jobs[1];f.servedAt='2030-01-03T00:00:00Z';f.sourceUpdatedAt=f.servedAt;
 const after=project(f).jobs[1];assert.equal(after.lastReportReceivedAt,before.lastReportReceivedAt);
 assert.equal(freshness(after,Date.parse(f.servedAt)).waitingForNewReport,true);
});
test('missing memory is preserved; current and peak measurements are not substituted',()=>{
 const f=fixture();f.attempts[1].samples[0].currentRssMiB=128;
 const job=project(f).jobs[1];assert.equal(job.samples[0].peakRssMiB,null);assert.equal(job.samples[0].reportedRssMiB,null);
 const option=memoryOption(job);const series=option.series as {id:string;data:(number|null)[][]}[];
 assert.equal(series.find(s=>s.id==='peakRssMiB')!.data[0][1],null);
});
test('wall and monotonic descriptions do not double count the same resource observation',()=>{
 const f=fixture();const s=f.attempts[1].samples[0];s.elapsedBasis='WALL_REPORTED';s.elapsedSeconds=700;
 f.attempts[1].samples.push({...s,elapsedBasis:'MONOTONIC_REPORTED',elapsedSeconds:650});
 const job=project(f).jobs[1];assert.equal(job.samples.length,1);assert.equal(job.elapsedSeconds,700);
});
test('timeline uses explicit report reception time, not extrapolated elapsed progress',()=>{
 const f=fixture();const at='2030-01-02T00:00:00Z';f.attempts[1].milestones=[{phase:'E_SEQUENTIAL_MERGE',receivedAt:at,sourceReportedAt:null}];
 const job=project(f).jobs[1];const option=timelineOption(job);const series=option.series as {data:{value:number[]}[]}[];
 assert.equal(series[0].data[0].value[0],Date.parse(at));assert.equal(job.milestones[0].elapsedSeconds,null);
});
test('unverified completion remains distinct from running and verified',()=>{
 const f=fixture();f.attempts[1].status='COMPLETED_UNVERIFIED';const job=project(f).jobs[1];
 assert.equal(job.status,'UNVERIFIED');assert.equal(job.countScope,'NONE');
});
test('model-result and training claims cannot be smuggled into preparation readiness',()=>{
 const f=fixture();f.readiness.trainingReady=true;assert.throws(()=>verifyPreparation(f),/CONTRACT/);
});
