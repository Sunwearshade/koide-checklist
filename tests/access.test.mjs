import assert from 'node:assert/strict';
import {session,login,logout,resetPassword,listUsers,createUser,changePassword,setPassword,setActive,setRole,sessionHours} from '../src/auth.mjs';
// Base simulada: usuarios, sesiones e intentos en memoria. Falla ante cualquier consulta no prevista.
let users=new Map(),sessions=new Map(),attempts=new Map(),queries=[];
const pool={async execute(sql,args=[]){
 queries.push(sql);
 if(sql.startsWith('INSERT IGNORE INTO users')){if(users.has(args[0]))return [{affectedRows:0}];users.set(args[0],{username:args[0],display_name:args[1],role:args[2],password_hash:args[3],active:1});return [{affectedRows:1}]}
 if(sql.startsWith('SELECT username,display_name,role,password_hash FROM users')){const u=users.get(args[0]);return [u&&u.active?[u]:[]]}
 if(sql.startsWith('SELECT username,display_name,role,active FROM users'))return [[...users.values()]];
 if(sql.startsWith('SELECT username FROM users WHERE username=? AND active=1')){const u=users.get(args[0]);return [u&&u.active?[u]:[]]}
 if(sql.startsWith('SELECT password_hash FROM users')){const u=users.get(args[0]);return [u?[u]:[]]}
 if(sql.startsWith('UPDATE users SET password_hash')){const u=users.get(args[1]);if(u)u.password_hash=args[0];return [{affectedRows:u?1:0}]}
 if(sql.startsWith('UPDATE users SET role')){const u=users.get(args[1]);if(u)u.role=args[0];return [{affectedRows:u?1:0}]}
 if(sql.startsWith('UPDATE users SET active')){const u=users.get(args[1]);if(u)u.active=args[0];return [{affectedRows:u?1:0}]}
 if(sql.startsWith('INSERT INTO login_attempts')){attempts.set(args[0],(attempts.get(args[0])||0)+1);return [[]]}
 if(sql.startsWith('SELECT attempts'))return [[{attempts:attempts.get(args[0])}]];
 if(sql.startsWith('DELETE FROM login_attempts')){attempts.delete(args[0]);return [[]]}
 if(sql.startsWith('DELETE FROM user_sessions WHERE expires_at'))return [[]];
 if(sql.startsWith('INSERT INTO user_sessions')){assert(sql.includes(`INTERVAL ${sessionHours} HOUR`));sessions.set(args[0],{username:args[1],csrf:args[2]});return [[]]}
 if(sql.startsWith('SELECT s.csrf')){const s=sessions.get(args[0]),u=s&&users.get(s.username);return [u&&u.active?[{csrf:s.csrf,username:u.username,display_name:u.display_name,role:u.role}]:[]]}
 if(sql.startsWith('DELETE FROM user_sessions WHERE token_hash')){sessions.delete(args[0]);return [[]]}
 if(sql.startsWith('DELETE FROM user_sessions WHERE username=? AND token_hash<>?')){for(const [k,s] of sessions)if(s.username===args[0]&&k!==args[1])sessions.delete(k);return [[]]}
 if(sql.startsWith('DELETE FROM user_sessions WHERE username')){for(const [k,s] of sessions)if(s.username===args[0])sessions.delete(k);return [[]]}
 throw Error('Unexpected query: '+sql);
}};
const browser=(address='10.0.0.5')=>{const b={cookie:'',req:{headers:{},socket:{remoteAddress:address}},res:{setHeader(name,value){assert.equal(name,'Set-Cookie');b.cookie=value;b.req.headers.cookie=value.split(';')[0]}}};return b};
const enter=(b,username,password)=>login(pool,b.req,b.res,{username,password});
const adminPassword='Inicial-segura-2026',operatorPassword='Operador-2026';

// 8. La cuenta inicial se crea una vez; repetir la inicialización no la duplica ni cambia su contraseña.
await createUser(pool,{username:'admin-mant',displayName:'Administrador de mantenimiento',role:'admin',password:adminPassword});
await assert.rejects(createUser(pool,{username:'Admin-Mant',displayName:'Otro',role:'admin',password:'Distinta-2026'}),e=>e.status===409);
assert.equal(users.size,1);assert(users.get('admin-mant').password_hash.startsWith('scrypt:'));assert(!JSON.stringify([...users.values()]).includes(adminPassword));

// 4. Sin sesión no hay cuenta: el servidor responde 401 a cualquier ruta privada.
const pc=browser();assert.equal(await session(pool,pc.req),null);
pc.req.headers.cookie='checklist_session='+'a'.repeat(64);assert.equal(await session(pool,pc.req),null);pc.req.headers.cookie='';

// 3. Campos vacíos.  2. Contraseña incorrecta y usuario inexistente dan el mismo mensaje.
for(const input of [{},{username:'admin-mant'},{username:'',password:adminPassword},{username:'admin-mant',password:''}])await assert.rejects(login(pool,pc.req,pc.res,input),e=>e.status===400);
await assert.rejects(login(pool,pc.req,pc.res,null),e=>e.status===400);
let messages=[];for(const [u,p] of [['admin-mant','incorrecta'],['no-existe','incorrecta'],['admin mant',adminPassword],["' OR 1=1 --",adminPassword]])await assert.rejects(enter(pc,u,p),e=>{messages.push(e.message);return e.status===401});
assert.equal(new Set(messages).size,1);assert.equal(pc.cookie,'');assert.equal(sessions.size,0);
// 12. Las claves compartidas anteriores no abren ninguna cuenta.
for(const key of ['Koide2026','Prod2026','K.oide2026'])await assert.rejects(enter(pc,'admin-mant',key),e=>e.status===401);

// 1. Acceso correcto con admin-mant; el usuario no distingue mayúsculas ni espacios alrededor.
const admin=await enter(pc,' Admin-Mant ',adminPassword);
assert.deepEqual([admin.user,admin.role,admin.isAdmin,admin.canParameters,admin.canManageKeys,admin.canWrite],['admin-mant','admin',true,true,true,true]);
assert(pc.cookie.includes('HttpOnly; Secure; SameSite=Strict'));assert(pc.cookie.includes('Max-Age='+sessionHours*3600));
// 7. La sesión se conserva entre solicitudes con la misma cookie y el mismo CSRF.
for(let i=0;i<3;i++){const again=await session(pool,pc.req);assert.equal(again.user,'admin-mant');assert.equal(again.csrf,admin.csrf);assert.equal(again.isAdmin,true)}
assert.equal(sessions.size,1);assert(!sessions.has(pc.req.headers.cookie.split('=')[1]),'La base guarda el hash del token, no el token.');

// 5. Un operador entra y captura, pero no ejecuta operaciones administrativas.
await createUser(pool,{username:'operador1',displayName:'Línea 1',role:'operator',password:operatorPassword},admin);
const tablet=browser('10.0.0.9'),operator=await enter(tablet,'operador1',operatorPassword);
assert.deepEqual([operator.role,operator.isAdmin,operator.canParameters,operator.canManageKeys,operator.canWrite],['operator',false,false,false,true]);
await assert.rejects(listUsers(pool,operator),e=>e.status===403);
await assert.rejects(createUser(pool,{username:'intruso',displayName:'X',role:'admin',password:'Intruso-2026'},operator),e=>e.status===403);
await assert.rejects(setActive(pool,operator,{username:'admin-mant',active:false}),e=>e.status===403);
await assert.rejects(changePassword(pool,operator,{username:'admin-mant',password:'Robada-2026'}),e=>e.status===403);
assert.equal(users.size,2);assert(!users.has('intruso'));
// Supervisor: captura y Actualización de parámetros; ni administración ni gestión de usuarios.
await createUser(pool,{username:'supervisor1',displayName:'Supervisor T1',role:'supervisor',password:'Supervisor-2026'},admin);
const office=browser('10.0.0.11'),supervisor=await enter(office,'supervisor1','Supervisor-2026');
assert.deepEqual([supervisor.role,supervisor.isAdmin,supervisor.canParameters,supervisor.canManageKeys,supervisor.canWrite],['supervisor',false,true,false,true]);
await assert.rejects(listUsers(pool,supervisor),e=>e.status===403);await assert.rejects(setRole(pool,supervisor,{username:'supervisor1',role:'admin'}),e=>e.status===403);
await assert.rejects(setRole(pool,operator,{username:'operador1',role:'admin'}),e=>e.status===403);await assert.rejects(createUser(pool,{username:'intruso2',displayName:'X',role:'admin',password:'Intruso-2026'},supervisor),e=>e.status===403);
// El rol sale de la base en cada solicitud: cambiarlo cierra la sesión y la siguiente entrada usa el rol nuevo. Nadie cambia su propio rol.
await assert.rejects(setRole(pool,admin,{username:'admin-mant',role:'operator'}),e=>e.status===409);await assert.rejects(setRole(pool,admin,{username:'supervisor1',role:'jefe'}),e=>e.status===400);
await setRole(pool,admin,{username:'supervisor1',role:'operator'});assert.equal(await session(pool,office.req),null);assert.equal((await enter(office,'supervisor1','Supervisor-2026')).canParameters,false);
await setRole(pool,admin,{username:'supervisor1',role:'supervisor'});assert.equal((await enter(office,'supervisor1','Supervisor-2026')).canParameters,true);
// Validaciones al crear: rol, usuario, nombre y contraseña.
for(const bad of [{role:'root'},{username:'ab'},{username:'con espacio'},{displayName:' '},{password:'corta'}])await assert.rejects(createUser(pool,{username:'nuevo1',displayName:'Nuevo',role:'operator',password:'Valida-2026',...bad},admin),e=>e.status===400);
// Más administradores de mantenimiento, creados por un administrador.
await createUser(pool,{username:'admin-mant2',displayName:'Segundo administrador',role:'admin',password:'Segundo-2026'},admin);
assert.equal((await enter(browser('10.0.0.7'),'admin-mant2','Segundo-2026')).isAdmin,true);
assert.deepEqual((await listUsers(pool,admin)).map(u=>u.username).sort(),['admin-mant','admin-mant2','operador1','supervisor1']);assert(!JSON.stringify(await listUsers(pool,admin)).includes('scrypt'));

// Cambio de contraseña: la propia exige la actual; la de otra cuenta cierra sus sesiones.
await assert.rejects(changePassword(pool,operator,{username:'operador1',password:'Nueva-operador-1',currentPassword:'equivocada'}),e=>e.status===403);
await changePassword(pool,operator,{username:'operador1',password:'Nueva-operador-1',currentPassword:operatorPassword});assert.equal((await session(pool,tablet.req)).user,'operador1');
await changePassword(pool,admin,{username:'operador1',password:'Restablecida-2026'});assert.equal(await session(pool,tablet.req),null);
await assert.rejects(enter(tablet,'operador1','Nueva-operador-1'),e=>e.status===401);await enter(tablet,'operador1','Restablecida-2026');
await assert.rejects(setPassword(pool,'no-existe','Cualquiera-2026'),e=>e.status===404);
// Desactivar una cuenta cierra su sesión e impide entrar; un administrador no puede desactivarse a sí mismo.
await assert.rejects(setActive(pool,admin,{username:'admin-mant',active:false}),e=>e.status===409);
await setActive(pool,admin,{username:'operador1',active:false});assert.equal(await session(pool,tablet.req),null);await assert.rejects(enter(tablet,'operador1','Restablecida-2026'),e=>e.status===401);
await setActive(pool,admin,{username:'operador1',active:true});await enter(tablet,'operador1','Restablecida-2026');

// 6. Cerrar sesión invalida la cookie en el servidor.
const stolen=pc.req.headers.cookie;await logout(pool,await session(pool,pc.req),pc.res);
assert(pc.cookie.includes('Max-Age=0'));assert.equal(await session(pool,{headers:{cookie:stolen}}),null);

// Intentos repetidos: 10 fallos por usuario y equipo bloquean 15 minutos, incluso con la contraseña correcta; otro equipo no se bloquea.
const attacker=browser('10.0.0.66');for(let i=0;i<10;i++)await assert.rejects(enter(attacker,'admin-mant','mala'),e=>e.status===401);
await assert.rejects(enter(attacker,'admin-mant',adminPassword),e=>e.status===429);
assert.equal((await enter(pc,'admin-mant',adminPassword)).user,'admin-mant');

// Restablecer con PIN: desactivado sin RESET_PIN; con PIN correcto cambia la contraseña y cierra las sesiones de la cuenta.
const kiosk=browser('10.0.0.20'),reset=(b,input)=>resetPassword(pool,b.req,input);
delete process.env.RESET_PIN;await assert.rejects(reset(kiosk,{username:'operador1',pin:'4477',password:'Con-pin-2026'}),e=>e.status===503);
process.env.RESET_PIN='4477';
for(const bad of [{pin:''},{username:''},{password:'corta'},{pin:undefined}])await assert.rejects(reset(kiosk,{username:'operador1',pin:'4477',password:'Con-pin-2026',...bad}),e=>e.status===400);
for(const pin of ['0000','447','44777',' '])await assert.rejects(reset(kiosk,{username:'operador1',pin,password:'Con-pin-2026'}),e=>e.status===(pin.trim()?403:400));
assert.equal((await session(pool,tablet.req)).user,'operador1');await assert.rejects(enter(tablet,'operador1','Con-pin-2026'),e=>e.status===401);
await assert.rejects(reset(kiosk,{username:'no-existe',pin:'4477',password:'Con-pin-2026'}),e=>e.status===404);
await reset(kiosk,{username:' Operador1 ',pin:4477,password:'Con-pin-2026'});assert.equal(await session(pool,tablet.req),null);
await assert.rejects(enter(tablet,'operador1','Restablecida-2026'),e=>e.status===401);assert.equal((await enter(tablet,'operador1','Con-pin-2026')).user,'operador1');
// PIN corto: al sexto intento fallido desde un equipo se bloquea, incluso con el PIN correcto; otro equipo no.
const guesser=browser('10.0.0.67');for(let i=0;i<5;i++)await assert.rejects(reset(guesser,{username:'admin-mant',pin:String(1000+i),password:'Robada-2026x'}),e=>e.status===403);
await assert.rejects(reset(guesser,{username:'admin-mant',pin:'4477',password:'Robada-2026x'}),e=>e.status===429);await assert.rejects(enter(browser('10.0.0.68'),'admin-mant','Robada-2026x'),e=>e.status===401);
await reset(kiosk,{username:'admin-mant',pin:'4477',password:adminPassword});
assert(!queries.some(q=>/access_keys|access_grants|access_sessions/.test(q)),'Ninguna consulta usa las tablas de claves anteriores.');
console.log('PASS: usuario y contraseña, cuenta inicial sin duplicar, campos vacíos, credenciales incorrectas, claves antiguas rechazadas, sesión persistente, operador y supervisor sin funciones administrativas, cambio de rol, alta de usuarios, cambio de contraseña, desactivación, cierre de sesión, restablecimiento con PIN y control de intentos. Base simulada.');
