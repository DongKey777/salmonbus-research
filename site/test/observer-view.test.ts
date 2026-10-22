import test from 'node:test';
import assert from 'node:assert/strict';
import {comparisonGroups,comparisonSeries,supportLabel} from '../src/observer-view.ts';
import type {ObservedReport,ObservedRun} from '../src/observer-view.ts';

const report=(id:string,key:string|null,role:ObservedReport['role'],generation:number,loss=1):ObservedReport=>({id,label:id,reportHash:id.repeat(64).slice(0,64),registeredGeneration:generation,comparisonKey:key,role,metrics:{Brier:loss,NRPS:loss,MAE:loss},support:{questions:16,scored:12,weight:16}});
const run=(reports:ObservedReport[]):ObservedRun=>({id:'fixture',label:'fixture',origin:'SYNTHETIC_TEST_FIXTURE',historical:true,phase:'CLOSED',stopReason:null,headSequence:42,headHash:'a'.repeat(64),lastSourceAt:null,observedAt:null,receivedAt:null,observerStatus:'OK',reports,events:[],decision:{connected:false,revision:null,label:'미연결'}});

test('different comparison conditions cannot enter the same improvement line',()=>{
  const groups=comparisonGroups(run([report('a','cohort1','BASELINE',0),report('b','cohort2','CANDIDATE',1,.5)]));
  assert.equal(groups.length,2);assert.equal(groups[1].reason,'REFERENCE_MISSING');
  assert.equal(comparisonSeries(groups[1],'COMPOSITE')[0].value,null);
});
test('a new cohort must not silently borrow the first run baseline',()=>{
  const groups=comparisonGroups(run([report('a','one','BASELINE',0,2),report('b','two','BASELINE',1,4),report('c','two','CANDIDATE',2,2)]));
  assert.equal(comparisonSeries(groups[1],'COMPOSITE')[1].value,50);
});
test('missing comparison identity keeps reports separate',()=>{
  const groups=comparisonGroups(run([report('a',null,'BASELINE',0),report('b',null,'CANDIDATE',1)]));
  assert.equal(groups.length,2);assert.ok(groups.every(g=>g.reason==='COMPARISON_UNSPECIFIED'));
});
test('ambiguous reference never produces a composite score',()=>{
  const group=comparisonGroups(run([report('a','same','BASELINE',0),report('b','same','BASELINE',1)]))[0];
  assert.equal(group.reason,'REFERENCE_AMBIGUOUS');assert.ok(comparisonSeries(group,'COMPOSITE').every(p=>p.value===null));
});
test('eventual best observation does not rewrite earlier candidate values or acceptance',()=>{
  const input=run([report('a','x','BASELINE',0),report('c','x','CANDIDATE',4,.8),report('b','x','CANDIDATE',2,.5)]);
  const points=comparisonSeries(comparisonGroups(input)[0],'COMPOSITE');
  assert.deepEqual(points.map(p=>p.id),['a','b','c']);
  assert.deepEqual(points.map(p=>Math.round(p.value!)),[0,50,20]);
  assert.deepEqual(points.map(p=>p.bestObserved),[0,50,50]);
  assert.equal(input.decision.connected,false);
});
test('missing metric remains missing; no carry-forward score is fabricated',()=>{
  const c=report('b','x','CANDIDATE',1);delete c.metrics.NRPS;
  const points=comparisonSeries(comparisonGroups(run([report('a','x','BASELINE',0),c]))[0],'COMPOSITE');
  assert.equal(points[1].value,null);assert.equal(points[1].bestObserved,0);
});
test('support distinguishes scored questions and evaluation weights',()=>{
  assert.equal(supportLabel(report('a','x','BASELINE',0)),'12 / 16 질문 · 가중치 합 16');
  const r=report('a','x','BASELINE',0);r.support={questions:null,scored:null,weight:null};
  assert.equal(supportLabel(r),'평가 분모 미확인');
});
