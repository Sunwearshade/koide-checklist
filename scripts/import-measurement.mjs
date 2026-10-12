import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createPool} from '../src/db.mjs';
import {read,save} from '../src/store.mjs';
import {stateFromEntries,diffState} from '../client/state-codec.mjs';
import {mergeMeasurementBatch} from '../client/measurement-merge.mjs';
const pool=createPool();
try{
 const batch=JSON.parse(fs.readFileSync(new URL('../data/measurement-2026-10-09.json',import.meta.url),'utf8'));
 const {entries}=await read(pool),before=stateFromEntries(entries);
 const deleted=new Set(entries.filter(e=>e.bucket==='skillMap.records'&&e.value===null).map(e=>e.key));batch.records=batch.records.filter(r=>!deleted.has(r.id));
 const {next,changed}=mergeMeasurementBatch(before,batch);
 if(!changed)console.log('Esta actualización ya fue aplicada; no se duplicaron evaluaciones.');
 else{
  const [employees]=await pool.execute('SELECT employee_number,full_name FROM employees WHERE active=1');const names=new Map(employees.map(e=>[e.employee_number,e.full_name]));
  for(const r of [...next.skillMap.records,...next.skillMap.employees])if(names.has(r.employee))r.name=names.get(r.employee);
  const changes=diffState(before,next,entries);
  if(changes.length)await save(pool,{requestId:randomUUID(),changes},'importacion-medicion-2026-10-09',true);
  console.log('Ciclos julio–octubre actualizados. Fechas de origen conservadas; ajustes de práctica identificados con prima.');
 }
}catch(e){console.error(e.message);process.exitCode=1}finally{await pool.end()}
