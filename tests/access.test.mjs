import assert from 'node:assert/strict';
import {session,unlockScope,unlockAdmin,changeKey,accessDefaults} from '../src/auth.mjs';
let csrf,admin=false,created=0,cookie,snapshot,rotateBeforeLock=false;
let keys=Object.fromEntries(['admin','parameters','management'].map(scope=>[scope,{password_hash:scope==='admin'?accessDefaults.adminPasswordHash:accessDefaults[scope+'PasswordHash'],revision:1}]));
let grants=[],attempts=new Map(),audit=[];
const pool={async getConnection(){return this},async beginTransaction(){snapshot=structuredClone({keys,grants,admin,audit})},async commit(){snapshot=null},async rollback(){if(snapshot)({keys,grants,admin,audit}=snapshot)},release(){},async execute(sql,args=[]){
 if(sql.startsWith('SELECT csrf'))return [[{csrf,is_admin:admin?1:0}]];
 if(sql.startsWith('INSERT INTO access_sessions')){created++;csrf=args[1];return [[]]}
 if(sql.startsWith('SELECT scope FROM access_grants'))return [grants.filter(g=>g.token===args[0]&&(!sql.includes("scope='management'")||g.scope==='management'))];
 if(sql.startsWith('INSERT INTO login_attempts')){attempts.set(args[0],(attempts.get(args[0])||0)+1);return [[]]}
 if(sql.startsWith('SELECT attempts'))return [[{attempts:attempts.get(args[0])}]];
 if(sql.startsWith('SELECT password_hash')){if(rotateBeforeLock&&sql.includes('FOR UPDATE')){keys[args[0]].password_hash=accessDefaults.managementPasswordHash;rotateBeforeLock=false}return [[{password_hash:keys[args[0]].password_hash}]]}
 if(sql.startsWith('SELECT revision'))return [[{revision:keys[args[0]].revision}]];
 if(sql.startsWith('UPDATE access_sessions')){admin=!sql.includes('=NULL');return [[]]}
 if(sql.startsWith('INSERT INTO access_grants')){grants=grants.filter(g=>g.token!==args[0]||g.scope!==args[1]);grants.push({token:args[0],scope:args[1]});return [[]]}
 if(sql.startsWith('DELETE FROM access_grants')){grants=[];return [[]]}
 if(sql.startsWith('DELETE FROM login_attempts')){attempts.delete(args[0]);return [[]]}
 if(sql.startsWith('UPDATE access_keys')){keys[args[1]]={password_hash:args[0],revision:keys[args[1]].revision+1};return [[]]}
 if(sql.startsWith('INSERT INTO access_key_audit')){audit.push(args);return [[]]}
 throw Error('Unexpected query: '+sql);
}};
const res={setHeader(name,value){assert.equal(name,'Set-Cookie');cookie=value}};
const guest=await session(pool,{headers:{}},res),req={headers:{cookie:cookie.split(';')[0]}};
assert.equal(created,1);assert.equal(guest.canWrite,true);assert.equal(guest.isAdmin,false);assert.equal(guest.canManageKeys,false);
assert(cookie.includes('HttpOnly; Secure; SameSite=Strict'));
await assert.rejects(unlockAdmin(pool,guest,'incorrecta'),e=>e.status===403);
await unlockScope(pool,guest,'parameters','Prod2026');let user=await session(pool,req,res);assert.equal(user.canParameters,true);assert.equal(user.isAdmin,false);assert.equal(user.canManageKeys,false);
await assert.rejects(changeKey(pool,user,{scope:'admin',version:1,password:'Cambio2026'}),e=>e.status===403);
await unlockAdmin(pool,guest,'Koide2026');assert.equal((await session(pool,req,res)).isAdmin,true);
await assert.rejects(unlockScope(pool,guest,'management','Koide2026'),e=>e.status===403);
await unlockScope(pool,guest,'management','K.oide2026');user=await session(pool,req,res);
await assert.rejects(changeKey(pool,user,{scope:'parameters',version:2,password:'Cambio2026'}),e=>e.status===409);
await changeKey(pool,user,{scope:'parameters',version:1,password:'Cambio2026'});assert.equal(keys.parameters.revision,2);assert.equal(audit.length,1);assert.equal(grants.length,0);assert.equal(admin,false);
await assert.rejects(changeKey(pool,user,{scope:'admin',version:1,password:'Cambio2026'}),e=>e.status===403);
await assert.rejects(unlockScope(pool,guest,'parameters','Prod2026'),e=>e.status===403);
await unlockScope(pool,guest,'parameters','Cambio2026');assert.equal((await session(pool,req,res)).canParameters,true);
rotateBeforeLock=true;await assert.rejects(unlockAdmin(pool,guest,'Koide2026'),e=>e.status===403);assert.equal(admin,false);
for(let i=0;i<10;i++)await assert.rejects(unlockScope(pool,guest,'management','mala'),e=>e.status===403);
await assert.rejects(unlockScope(pool,guest,'management','K.oide2026'),e=>e.status===429);
assert.equal(created,1);
console.log('PASS: acceso directo, tres claves independientes, control de intentos, cambio con versión y revocación, clave antigua rechazada y cambio concurrente. Base simulada.');
