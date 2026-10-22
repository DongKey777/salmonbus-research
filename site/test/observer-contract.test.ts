import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyV2,asObservedRun} from '../src/observer-contract.ts';
import {comparisonGroups,comparisonSeries,supportLabel} from '../src/observer-view.ts';
const fixture=(name:string)=>JSON.parse(readFileSync(new URL(`./fixtures/v2/snapshot.${name}.json`,import.meta.url),'utf8'));
for(const name of ['empty','registration-pending','registered-artificial','multirun-artificial','actual-saved'])test(`v2 shared-projection fixture ${name} obeys semantic identity`,()=>{assert.ok(verifyV2(fixture(name)));});
test('SCORE phase without journal report registration has no score',()=>{const s=verifyV2(fixture('registration-pending'));assert.equal(s.runs[0].candidateCount,0);assert.equal(asObservedRun(s.runs[0]).reports.length,0);});
test('actual source exposes four registered reports without inventing a selection decision',()=>{
 const s=verifyV2(fixture('actual-saved')),run=asObservedRun(s.runs[0]);
 assert.equal(s.cursor,43);assert.equal(run.reports.length,4);assert.equal(run.origin,'ACTUAL_SAVED_SYNTHETIC');assert.equal(run.decision.connected,false);
 assert.ok(run.reports.every(r=>r.role==='UNKNOWN'));assert.ok(comparisonSeries(comparisonGroups(run)[0],'COMPOSITE').every(p=>p.value===null));
 assert.ok(supportLabel(run.reports[0]).includes('전체 대상 미제공'));
});
test('actual committed metric reports exactly match approved historical display values',()=>{
 const s=verifyV2(fixture('actual-saved'));const archived=JSON.parse(readFileSync(new URL('../retired-synthetic-20261021/public/archive.json',import.meta.url),'utf8')).projection.recordedSnapshot;
 for(const r of s.runs[0].registeredCandidates){const old=archived.models.find((m:{id:string})=>m.id===r.candidateId);assert.equal(old.reportRef,r.reportHash);for(const k of ['Brier','NRPS','MAE'])assert.ok(Math.abs(old.metrics[k]-r.metrics[k])<1e-12);}
});
test('global receiver count and per-run source heads cannot contradict events',()=>{
 const s=fixture('actual-saved');s.cursor++;assert.throws(()=>verifyV2(s),/OBSERVER_CONTRACT_MISMATCH/);
 const t=fixture('actual-saved');t.runs[0].head.hash='0'.repeat(64);assert.throws(()=>verifyV2(t));
 const u=fixture('actual-saved');u.runs[0].phase='HELD';assert.throws(()=>verifyV2(u));
});
test('a report cannot be presented before the exact registration generation',()=>{const s=fixture('actual-saved');s.runs[0].registeredCandidates[0].registeredGeneration--;assert.throws(()=>verifyV2(s));});
test('comparison groups must cover each report once under matching conditions',()=>{
 const s=fixture('registered-artificial');s.runs[0].registeredCandidates[1].cohortHash='0'.repeat(64);assert.throws(()=>verifyV2(s));
 const t=fixture('registered-artificial');t.runs[0].comparisonGroups[0].candidateIds.push(t.runs[0].comparisonGroups[0].candidateIds[0]);assert.throws(()=>verifyV2(t));
});
test('decision injection and additional raw payload fields fail closed',()=>{
 const s=fixture('actual-saved');s.runs[0].decisionStatus='PASS';assert.throws(()=>verifyV2(s));
 const t=fixture('actual-saved');t.runs[0].registeredCandidates[0].truths=[];assert.throws(()=>verifyV2(t));
});
test('nonfinite metrics and invalid denominator fields cannot reach charts',()=>{
 const s=fixture('actual-saved');s.runs[0].registeredCandidates[0].metrics.Brier=Infinity;assert.throws(()=>verifyV2(s));
 const t=fixture('actual-saved');t.runs[0].registeredCandidates[0].support.positiveRows=10000;assert.throws(()=>verifyV2(t));
});
test('different artificial runs with the same local seq retain distinct source identities',()=>{
 const s=verifyV2(fixture('multirun-artificial'));assert.equal(s.runs.length,2);assert.equal(s.runs[1].phase,'HELD');assert.equal(s.runs[0].events[0].sourceSeq,s.runs[1].events[0].sourceSeq);assert.notEqual(s.runs[0].events[0].sourceId,s.runs[1].events[0].sourceId);
 const altered=structuredClone(s);altered.runs[1].events[0].sourceId=altered.runs[0].events[0].sourceId;assert.throws(()=>verifyV2(altered));
});
