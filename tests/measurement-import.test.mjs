import fs from 'node:fs';import assert from 'node:assert/strict';
import {mergeMeasurementBatch} from '../client/measurement-merge.mjs';
import {stateFromEntries,diffState,flattenState} from '../client/state-codec.mjs';
import {validate,keyOf} from '../src/rules.mjs';
const batch=JSON.parse(fs.readFileSync(new URL('../data/measurement-2026-10-09.json',import.meta.url),'utf8'));
assert.equal(batch.newIds.length,14);assert.equal(new Set(batch.records.map(r=>r.id)).size,129);
const empty=stateFromEntries([]),first=mergeMeasurementBatch(empty,batch);assert(first.changed);assert.equal(first.next.skillMap.records.length,129);
assert.equal(mergeMeasurementBatch(first.next,batch).changed,false);
for(const r of batch.records){assert.equal(r.parts.length,3);assert(r.parts.every(p=>p.answers.length===6&&p.answers.every(a=>a.value!==null&&a.value!==undefined||a.judgment==='NO APLICA')));assert.equal(r.limits.length,4);assert(r.limits.every(l=>Number.isFinite(l.min)&&Number.isFinite(l.max)))}
const newRecords=batch.records.filter(r=>batch.newIds.includes(r.id));assert(newRecords.every(r=>r.day>='2026-10-05'&&r.day<='2026-10-08'&&r.practice&&r.score===r.reported.score));
assert.equal(newRecords.find(r=>r.employee==='2001').score,50.3);
for(const r of newRecords){assert(batch.records.some(p=>p.id===r.previousRecordId));assert.equal(first.next.skillMap.currentByEmployee[r.employee],r.id)}
const old=batch.records.find(r=>!r.practice),existing=structuredClone(empty);existing.records=[{id:'receipt-stays'}];existing.bevelRecords=[{id:'parameter-stays'}];existing.skillExams=[{id:'process-stays'}];
existing.skillMap.records=[{...structuredClone(old),name:'Nombre corregido',score:99,parts:[{part:old.parts[0].part,answers:[{dimension:'DE',value:123,judgment:'NG'}]}],limits:[]}];
existing.skillDeletedRecords=[{source:'measurement',record:newRecords[0]}];
const merged=mergeMeasurementBatch(existing,batch).next;const retained=merged.skillMap.records.find(r=>r.id===old.id);
assert.equal(retained.parts[0].answers[0].value,123);assert.equal(retained.score,99);assert.equal(retained.name,'Nombre corregido');assert(!merged.skillMap.records.some(r=>r.id===newRecords[0].id));
for(const key of ['records','bevelRecords','skillExams'])assert.deepEqual(merged[key],existing[key]);
const changes=diffState(empty,first.next,[]);const entries=new Map([...flattenState(first.next).values()].map(e=>[keyOf(e.bucket,e.key),{...e,version:1}]));assert.doesNotThrow(()=>validate(entries,changes,true));
for(const cycle of batch.cycles){
 const series=cycle.ids.map(id=>batch.records.find(r=>r.id===id));assert.deepEqual(series.map(r=>r.measurementCycle.round),[1,2,3,4]);
 for(let i=0;i<4;i++){const r=series[i],dt=new Date(r.day+'T12:00:00Z');assert(dt.getUTCDay()>0&&dt.getUTCDay()<6);if(i){const gap=(Date.parse(r.day)-Date.parse(series[i-1].day))/86400000;assert(gap>=28&&gap<=32);assert(r.score>series[i-1].score)}}
}
const prior=structuredClone(empty);prior.skillMap.records=batch.records.filter(r=>!r.id.startsWith('sm-cycle-')).map(r=>{let c=structuredClone(r);const revision=batch.revisions.find(x=>x.id===r.id);if(revision){Object.assign(c,structuredClone(c.scheduleOriginal));for(const k of ['scheduleOriginal','schedulePractice','measurementCycle','gradePractice'])delete c[k]}return c});prior.skillMap.importBatches=['measurement-2026-10-09'];
const upgrade=mergeMeasurementBatch(prior,batch);assert.equal(upgrade.next.skillMap.records.length,129);assert.equal(mergeMeasurementBatch(upgrade.next,batch).changed,false);
for(const cycle of batch.cycles)for(const id of cycle.ids){assert.equal(upgrade.next.skillMap.records.find(r=>r.id===id).day,batch.records.find(r=>r.id===id).day)}
const altered=structuredClone(prior);const changed=altered.skillMap.records.find(r=>r.id===batch.revisions[0].id);changed.score=98;assert.throws(()=>mergeMeasurementBatch(altered,batch),/cambió/);assert.equal(changed.score,98);
console.log('PASS: 14 ciclos julio–octubre, días hábiles, intervalos 29–31 días, mejoras graduales, actualización sin duplicados y protección de cambios ajenos.');
