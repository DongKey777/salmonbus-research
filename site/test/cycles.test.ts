import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifySnapshot,verifyExtension} from '../src/cycles/contract.ts';
import {groups} from '../src/cycles/project.ts';
import {metricTrend,deltaTrend} from '../src/cycles/charts.ts';
const fixture=(n:string)=>JSON.parse(readFileSync(new URL(`./fixtures/cycles/${n}.json`,import.meta.url),'utf8'));
test('cycles: all four owner fixtures meet the pinned schema',()=>{for(const n of ['empty','pending.artificial','five.artificial','groups.artificial'])verifySnapshot(fixture(n));});
test('cycles: completed transport fixture stays artificial with no quality claim',()=>{
 const r=verifySnapshot(fixture('five.artificial')).runs[0];
 assert.equal(r.sourceKind,'ARTIFICIAL_TRANSPORT_FIXTURE');assert.equal(r.counts.completedCycles,5);assert.equal(r.quality.actualQualityClaim,false);assert.equal(r.budgetObserved.newModelsExecutedByMonitor,0);
});
test('cycles: unregistered score has no plot point',()=>{
 const r=verifySnapshot(fixture('pending.artificial')).runs[0];
 assert.equal(r.counts.registeredCandidates,0);assert.equal(groups(r).reduce((n,g)=>n+g.points.length+(g.baseline?1:0),0),0);
});
test('cycles: changed comparison conditions never share a curve or baseline',()=>{
 const gs=groups(verifySnapshot(fixture('groups.artificial')).runs[0]);
 assert.equal(gs.length,2);assert.equal(gs[1].baseline,null);assert.ok(gs.every(g=>g.points.every(p=>p.groupRef===g.ref)));
 const series=deltaTrend(gs[1]).series as {data:{value:number|null}[]}[];assert.ok(series[0].data.every(p=>p.value===null));
});
test('cycles: null ECE remains a gap without filling or connecting',()=>{
 const g=groups(verifySnapshot(fixture('five.artificial')).runs[0])[0];
 const o=metricTrend(g,'ECE',3),ss=o.series as {connectNulls:boolean;data:{value:number|null}[]}[];
 assert.equal(ss[0].connectNulls,false);assert.equal(ss[0].data.find((_,i)=>i===3)?.value,null);
});
test('cycles: missing or non-finite metrics rejected by contract',()=>{
 for(const v of [Infinity,NaN,-.1]){const s=fixture('five.artificial');s.runs[0].cycles[0].report.metrics.Brier=v;assert.throws(()=>verifySnapshot(s));}
});
test('cycles: ECE method cannot disappear under a value',()=>{
 const s=fixture('five.artificial');s.runs[0].cycles[0].report.metricMethods.ECE=null;assert.throws(()=>verifySnapshot(s));
});
test('cycles: report cannot be promoted before model/score receipts',()=>{
 const s=fixture('five.artificial');s.runs[0].cycles[0].score.state='NOT_REPORTED';assert.throws(()=>verifySnapshot(s));
});
test('cycles: outcome and policy mismatch remain invalid',()=>{
 for(const field of ['producerValidity','policyRef']){const s=fixture('five.artificial');s.runs[0].cycles[0].mainDecision[field]=field==='producerValidity'?'INVALID':'0'.repeat(64);assert.throws(()=>verifySnapshot(s));}
});
test('cycles: reread time can change, committed events and old scores cannot',()=>{
 const a=verifySnapshot(fixture('five.artificial'));const b=fixture('five.artificial');b.servedAt='2030-01-02T01:00:00+00:00';verifyExtension(a,verifySnapshot(b));
 b.runs[0].cycles[0].report.metrics.Brier=.123;assert.throws(()=>verifyExtension(a,verifySnapshot(b)));
});
test('cycles: cursor rollback and incomplete CLOSED are rejected',()=>{
 const a=verifySnapshot(fixture('five.artificial'));const b=fixture('five.artificial');b.cursor--;assert.throws(()=>verifySnapshot(b));
 b.cursor++;b.runs[0].cycles[2].status='IN_PROGRESS';assert.throws(()=>verifySnapshot(b));
 const c=fixture('empty');c.generationId=a.generationId;assert.throws(()=>verifyExtension(a,verifySnapshot(c)));
});
