import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {save} from '../src/store.mjs';
let docs=[],written=0,commits=0,rollbacks=0;
const pool={async getConnection(){return this},async beginTransaction(){},async commit(){commits++},async rollback(){rollbacks++},release(){},async execute(sql,args=[]){
 if(sql.startsWith('SELECT ng_number'))return [[{ng_number:0}]];
 if(sql.startsWith('SELECT username'))return [[]];
 if(sql.startsWith('SELECT bucket'))return [structuredClone(docs)];
 if(sql.startsWith('INSERT INTO documents')){written++;return [[]]}
 if(sql.startsWith('INSERT INTO audit')||sql.startsWith('UPDATE save_lock')||sql.startsWith('INSERT INTO requests'))return [[]];
 throw Error(sql);
}};
const r={id:'REC-1',machine:'Máquina Biseladora 1',partNumber:'SKU-1',timestamp:'2026-10-08T12:00:00Z',motorSpindle:1500,camShaft:45,dimOD:84.2,dimID:72.4,dimLength:98,notes:''};
const op={bucket:'bevelRecords',key:r.id,version:null,value:r};
const run=(change,admin=false,parameters=false)=>save(pool,{requestId:randomUUID(),changes:[change]},'acceso-directo',admin,parameters);
await assert.rejects(run(op),e=>e.status===403);assert.equal(written,0);
await run(op,false,true);assert.equal(written,1);assert.equal(commits,1);
docs=[{...op,version:1}];const edited={...op,version:1,value:{...r,notes:'Editado'}};
await assert.rejects(run(edited,false,true),e=>e.status===403);assert.equal(written,1);
await run(edited,true,true);assert.equal(written,2);
await assert.rejects(run({...edited,version:2},true,true),e=>e.status===409);assert.equal(written,2);
await run({...edited,value:null},false,true);assert.equal(written,3);
const catalog={bucket:'meta',key:'bevelCatalog',version:null,value:{SKU:{raw:'3x2x1',dims:['3','2','1'],issue:''}}};
await assert.rejects(run(catalog,false,true),e=>e.status===403);await run(catalog,true,true);assert.equal(written,4);
assert.equal(rollbacks,4);
console.log('PASS: parámetros exigen acceso, edición/catálogo exigen administración, versiones y rollback. Adaptador SQL simulado.');
