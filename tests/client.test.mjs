import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {flattenState,stateFromEntries,diffState,docKey} from '../client/state-codec.mjs';
const empty=stateFromEntries([]);
assert.equal(empty.records.length,0);assert.equal(empty.skillMap.records.length,0);
let next=structuredClone(empty);next.records.push({id:'r1',machine:'B1',day:'2026-09-28',turn:'T1',employee:'1'});
let changes=diffState(empty,next,[]);assert.equal(changes.length,1);assert.equal(changes[0].bucket,'records');assert.equal(changes[0].version,null);
const entry={...changes[0],version:1};let loaded=stateFromEntries([entry]);
assert.equal(diffState(loaded,structuredClone(loaded),[entry]).length,0);
let edit=structuredClone(loaded);edit.records[0].employee='2';assert.equal(diffState(loaded,edit,[entry])[0].version,1);
let remove=structuredClone(loaded);remove.records=[];assert.equal(diffState(loaded,remove,[entry])[0].value,null);
// Every station submits only its own addition, never a delete of unseen records.
for(let i=0;i<20;i++){let station=structuredClone(empty);station.records.push({id:'r'+i});let delta=diffState(empty,station,[]);assert.equal(delta.length,1);assert.equal(delta[0].key,'r'+i)}
assert.throws(()=>flattenState({records:[{id:'same'},{id:'same'}]}),/duplicado/);
const tombstone={bucket:'records',key:'r1',value:null,version:3};assert.equal(diffState(stateFromEntries([tombstone]),next,[tombstone])[0].version,3);
assert.equal(stateFromEntries([{bucket:'skillMap.records',key:'a',version:1,value:{id:'a',employee:'1',day:'2026-09-01',at:'1'}},{bucket:'skillMap.records',key:'b',version:1,value:{id:'b',employee:'1',day:'2026-09-02',at:'2'}}]).skillMap.currentByEmployee['1'],'b');
const parameterState=structuredClone(empty);parameterState.bevelRecords=[{id:'REC-1',notes:'Registro'}];parameterState.bevelCatalog={SKU:{raw:'3x2x1',dims:['3','2','1'],issue:''}};parameterState.accessKeys={admin:{hash:'never-send'}};
const parameterDelta=diffState(empty,parameterState,[]);assert.equal(parameterDelta.length,2);assert(!JSON.stringify(parameterDelta).includes('never-send'));const parameterRestored=stateFromEntries(parameterDelta.map(e=>({...e,version:1})));assert.deepEqual(parameterRestored.bevelRecords,parameterState.bevelRecords);assert.deepEqual(parameterRestored.bevelCatalog,parameterState.bevelCatalog);
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*)<\/script>/)[1];new vm.Script(script);
assert(!html.includes('Koide2026'));assert(!html.includes("indexedDB.open('recepcion-maquinas-v1'"));assert(!html.includes("put(next,'main')"));assert(!html.includes('Ubaldo Sanchez'));
const originalHashes=JSON.parse(fs.readFileSync(new URL('../original-hashes.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
const {createHash}=await import('node:crypto');for(const row of originalHashes)if(fs.existsSync(row.Path))assert.equal(createHash('sha256').update(fs.readFileSync(row.Path)).digest('hex').toUpperCase(),row.Hash);
// Exercise transport recovery, using an API double (not a live MySQL test).
let pending=null,requests=[],writes=0,fail=true;
const context=vm.createContext({console,URL,location:{href:'https://local.test/',origin:'https://local.test',protocol:'https:'},structuredClone,crypto:globalThis.crypto,AbortController,setTimeout,clearTimeout,document:{getElementById:()=>null},state:structuredClone(empty),flattenState,stateFromEntries,diffState});
vm.runInContext(fs.readFileSync(new URL('../client/server-storage.js',import.meta.url),'utf8'),context);
context.mockOutbox=async(write,value)=>{if(write)pending=value;return pending};
context.mockRequest=async(path,options)=>{if(path==='session')return {user:'domain\\operator',canWrite:true,csrf:'test'};if(path==='changes'){let p=JSON.parse(options.body);requests.push(p.requestId);if(!requests.slice(0,-1).includes(p.requestId))writes++;if(fail){fail=false;throw Error('Network lost after commit')}return {saved:true}}if(path==='state')return {entries:[entry]}};
vm.runInContext("outbox=mockOutbox;serverRequest=mockRequest;serverSession={user:'domain\\\\operator',canWrite:true};serverBaseline=stateFromEntries([]);",context);
context.next=next;await assert.rejects(vm.runInContext('serverCommit(next)',context),/Network lost/);assert(pending);assert.equal(writes,1);
await vm.runInContext('sendServerPending()',context);assert.equal(pending,null);assert.equal(writes,1);assert.equal(requests[0],requests[1]);
console.log('PASS: partitioned changes, versions, 20 independent additions, tombstones, retry ID after lost response, server HTML syntax, no local database fallback, originals unchanged.');

// Renew both permissions for a queued edit without changing its request ID.
const scopes=[];let cancel=true;
context.ensureParameterSaveAccess=async scope=>{scopes.push(scope);if(cancel)throw Error('Cancelado')};
pending={user:'domain\\operator',payload:{requestId:'pending-parameter-edit',changes:[{bucket:'bevelRecords',key:'REC-1',version:1,value:{id:'REC-1'}}]}};
await assert.rejects(vm.runInContext('sendServerPending()',context),/Cancelado/);assert.equal(pending.payload.requestId,'pending-parameter-edit');assert.equal(writes,1);
cancel=false;scopes.length=0;await vm.runInContext('sendServerPending()',context);assert.deepEqual(scopes,['parameters','admin']);assert.equal(pending,null);assert.equal(writes,2);assert.equal(requests.at(-1),'pending-parameter-edit');
console.log('PASS: reintento de parámetros renueva permisos y conserva envío cuando se cancela.');
