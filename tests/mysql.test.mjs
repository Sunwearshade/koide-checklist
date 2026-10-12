// Requires a separate EMPTY schema ending in _test, initialized with init-db.
// Never deletes rows. A fresh test database is required for each run.
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createPool} from '../src/db.mjs';import {save,read} from '../src/store.mjs';import {createUser,login,logout,session} from '../src/auth.mjs';
if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw Error('Usa exclusivamente una base de pruebas con sufijo _test.');
const pool=createPool();
const request=changes=>({requestId:randomUUID(),changes});
const add=(id)=>({bucket:'assignments',key:id,version:null,value:{id,employee:'1'}});
try{
 assert.equal((await read(pool)).entries.length,0,'La base de pruebas debe estar vacía.');
 await Promise.all(Array.from({length:20},(_,i)=>save(pool,request([add('station-'+i)]),'admin',true)));
 assert.equal((await read(pool)).entries.length,20);
 const once=request([add('retry')]);await save(pool,once,'admin',true);await save(pool,once,'admin',true);assert.equal((await read(pool)).entries.filter(e=>e.key==='retry').length,1);
 await assert.rejects(save(pool,{...once,changes:[add('changed-body')]},'admin',true),e=>e.status===409);
 const edit={...add('retry'),version:1,value:{id:'retry',employee:'2'}};await save(pool,request([edit]),'admin',true);
 await assert.rejects(save(pool,request([edit]),'admin',true),e=>e.status===409);
 const fail=request([add('rollback'),edit]);await assert.rejects(save(pool,fail,'admin',true));assert(!(await read(pool)).entries.some(e=>e.key==='rollback'));
 await assert.rejects(save(pool,request([{...edit,version:2}]),'capture',false),e=>e.status===403);
 await save(pool,request([{...edit,version:2,value:null}]),'admin',true);assert.equal((await read(pool)).entries.find(e=>e.key==='retry').value,null);
 await save(pool,request([{...edit,version:3}]),'admin',true);assert.equal((await read(pool)).entries.find(e=>e.key==='retry').version,4);
 const value={id:'r1',employee:'1',name:'Persona',day:'2026-09-28',turn:'T1',machine:'B1',operation:'Sin operación programada',answers:[],reason:'Mantenimiento',detail:'Prueba de instalación'};
 await save(pool,request([{bucket:'records',key:'r1',version:null,value}]),'admin',true);
 await assert.rejects(save(pool,request([{bucket:'records',key:'r2',version:null,value:{...value,id:'r2'}}]),'admin',true),e=>e.status===409);
 const [audit]=await pool.execute('SELECT COUNT(*) AS n FROM audit WHERE entity_key=?',['retry']);assert.equal(Number(audit[0].n),4);
 const bevel={bucket:'bevelRecords',key:'REC-MYSQL-1',version:null,value:{id:'REC-MYSQL-1',machine:'Máquina Biseladora 1',partNumber:'SKU-1',timestamp:new Date().toISOString(),motorSpindle:1500,camShaft:45,dimOD:84.2,dimID:72.4,dimLength:98,notes:'Prueba de instalación'}};
 await assert.rejects(save(pool,request([bevel]),'capture',false,false),e=>e.status===403);
 await save(pool,request([bevel]),'capture',false,true);
 const changedBevel={...bevel,version:1,value:{...bevel.value,notes:'Actualizado'}};
 await assert.rejects(save(pool,request([changedBevel]),'capture',false,true),e=>e.status===403);
 await save(pool,request([changedBevel]),'admin',true,true);
 assert.equal((await read(pool)).entries.find(e=>e.key===bevel.key).value.notes,'Actualizado');
 // Usuario y contraseña contra MySQL real: init-db ya creó admin-mant una sola vez (esquema 3).
 const [initial]=await pool.execute("SELECT role,active,password_hash FROM users WHERE username='admin-mant'");assert.equal(initial.length,1);assert.equal(initial[0].role,'admin');assert(initial[0].password_hash.startsWith('scrypt:'));
 const name='prueba-'+randomUUID().slice(0,8),secret='Prueba-'+randomUUID(),pc={headers:{},socket:{remoteAddress:'127.0.0.1'}},res={setHeader(_,value){pc.headers.cookie=value.split(';')[0]}};
 await createUser(pool,{username:name,displayName:'Cuenta de prueba',role:'operator',password:secret});await assert.rejects(createUser(pool,{username:name,displayName:'Duplicada',role:'admin',password:secret}),e=>e.status===409);
 await assert.rejects(login(pool,pc,res,{username:name,password:'incorrecta'}),e=>e.status===401);assert.equal(await session(pool,pc),null);
 const opened=await login(pool,pc,res,{username:name,password:secret});assert.equal(opened.isAdmin,false);assert.equal((await session(pool,pc)).user,name);
 await logout(pool,opened,res);pc.headers.cookie=pc.headers.cookie||'';assert.equal(await session(pool,pc),null);
 console.log('PASS MySQL: 20 conexiones concurrentes, idempotencia, versiones, rollback, roles, restauración, duplicados, auditoría, parámetros y acceso por usuario.');
}finally{await pool.end()}
