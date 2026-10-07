import assert from 'node:assert/strict';
import {session,unlockAdmin} from '../src/auth.mjs';
let csrf,admin=false,created=0,attempts=0,cookie;
const pool={async execute(sql,args=[]){
 if(sql.startsWith('SELECT csrf'))return [[{csrf,is_admin:admin?1:0}]];
 if(sql.startsWith('INSERT INTO access_sessions')){created++;csrf=args[1];return [[]]}
 if(sql.startsWith('INSERT INTO login_attempts')){attempts++;return [[]]}
 if(sql.startsWith('SELECT attempts'))return [[{attempts}]];
 if(sql.startsWith('UPDATE access_sessions')){admin=true;return [[]]}
 if(sql.startsWith('DELETE FROM login_attempts')){attempts=0;return [[]]}
 throw Error('Unexpected query');
}};
const res={setHeader(name,value){assert.equal(name,'Set-Cookie');cookie=value}};
const guest=await session(pool,{headers:{}},res);
assert.equal(created,1);assert.equal(guest.canWrite,true);assert.equal(guest.isAdmin,false);
assert(cookie.includes('HttpOnly; Secure; SameSite=Strict'));
await assert.rejects(unlockAdmin(pool,guest,'incorrecta'),e=>e.status===403);assert.equal(admin,false);
await unlockAdmin(pool,guest,'Koide2026');assert.equal(admin,true);
const req={headers:{cookie:cookie.split(';')[0]}};
assert.equal((await session(pool,req,res)).isAdmin,true);assert.equal(created,1);
admin=false;assert.equal((await session(pool,req,res)).isAdmin,false);
console.log('PASS: acceso directo sin credenciales, clave incorrecta rechazada, Koide2026 autorizada y bloqueo administrativo. Adaptador de base simulado.');
