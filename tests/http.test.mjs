// Prueba de extremo a extremo: levanta el servidor real en un puerto libre contra la base configurada en .env.
// Solo crea dos cuentas temporales «prueba-http-…» y las retira al terminar. No escribe capturas ni modifica otras cuentas.
import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import net from 'node:net';
import {createPool} from '../src/db.mjs';import {createUser} from '../src/auth.mjs';import {hash} from '../src/store.mjs';
if(!process.env.MYSQL_DATABASE?.endsWith('_test')&&process.env.CHECKLIST_HTTP_TEST!=='si')throw Error('Usa una base de pruebas con sufijo _test, o define CHECKLIST_HTTP_TEST=si en una base de desarrollo.');
const port=await new Promise(resolve=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})}),origin='http://localhost:'+port;
const pool=createPool(),tag=randomUUID().slice(0,8),adminName='prueba-http-a'+tag,operatorName='prueba-http-o'+tag,supervisorName='prueba-http-s'+tag,supervisorPassword='Super-'+randomUUID(),adminPassword='Admin-'+randomUUID(),operatorPassword='Oper-'+randomUUID();
const server=spawn(process.execPath,['src/server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,RESET_PIN:'9911'},stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
const directTokens=new Set();
function client(){let cookie='';return async(path,{method='GET',data,csrf,headers={}}={})=>{
 const r=await fetch(origin+path,{method,redirect:'manual',headers:{...(cookie?{Cookie:cookie}:{}),...(method==='POST'?{Origin:origin}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
 const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];if(/^checklist_direct=[a-f0-9]{64}$/.test(cookie))directTokens.add(cookie.split('=')[1]);return {status:r.status,body:await r.json().catch(()=>null),set,cookie}}}
const privateGets=['/api/session','/api/state','/api/employees','/api/users'];
try{
 await createUser(pool,{username:adminName,displayName:'Prueba HTTP administrador',role:'admin',password:adminPassword});
 await createUser(pool,{username:operatorName,displayName:'Prueba HTTP operador',role:'operator',password:operatorPassword});
 await createUser(pool,{username:supervisorName,displayName:'Prueba HTTP supervisor',role:'supervisor',password:supervisorPassword});
 for(let i=0;;i++){try{if((await fetch(origin+'/api/health')).ok)break}catch{}if(i>60)throw Error('El servidor no inició:\n'+logs);await new Promise(r=>setTimeout(r,250))}
 const [before]=await pool.execute('SELECT COUNT(*) AS n FROM documents');

 // 4. Sin sesión: acceso directo. Cualquier equipo consulta y captura (rol operador) sin iniciar sesión; nada administrativo.
 const guest=client();assert.equal((await fetch(origin+'/')).status,200);
 const direct=await guest('/api/session');assert.equal(direct.status,200);assert(/^checklist_direct=[a-f0-9]{64}$/.test(direct.cookie));assert(/HttpOnly;.*SameSite=Strict/.test(direct.set));
 assert.deepEqual([direct.body.user,direct.body.role,direct.body.direct,direct.body.canWrite,direct.body.isAdmin,direct.body.canParameters,direct.body.canManageKeys],['acceso-directo','operator',true,true,false,false,false]);
 for(const path of ['/api/state','/api/employees','/api/session']){const r=await guest(path);assert.equal(r.status,200,path);assert.equal(r.set,null,path)}
 assert.equal((await guest('/api/session')).body.csrf,direct.body.csrf);
 assert(!(await guest('/api/state')).body.entries.some(e=>e.bucket==='bevelRecords'||e.bucket==='meta'&&e.key==='bevelCatalog'),'El acceso directo no recibe parámetros.');
 assert.equal((await guest('/api/users')).status,401);
 for(const path of ['/api/users','/api/users/password','/api/users/role','/api/users/active','/api/logout'])assert.equal((await guest(path,{method:'POST',data:{},csrf:direct.body.csrf})).status,401,path);
 // Origen y CSRF también protegen la captura directa; con token llega a la validación de la captura (400).
 assert.equal((await guest('/api/changes',{method:'POST',data:{}})).status,403);
 assert.equal((await guest('/api/changes',{method:'POST',data:{},csrf:direct.body.csrf,headers:{Origin:'http://otro.sitio'}})).status,403);
 assert.equal((await guest('/api/changes',{method:'POST',data:{},csrf:direct.body.csrf})).status,400);
 // Fuera de la API no se abre sesión directa; el acceso directo tiene tope de tamaño y `photo` solo acepta imágenes (XSS).
 const nobody=client(),miss=await nobody('/no-existe');assert.equal(miss.status,404);assert.equal(miss.set,null);
 assert.equal((await guest('/api/changes',{method:'POST',csrf:direct.body.csrf,data:{requestId:randomUUID(),changes:[{bucket:'records',key:'grande',version:null,value:{relleno:'x'.repeat(5*1024*1024)}}]}})).status,413);
 const xss=await guest('/api/changes',{method:'POST',csrf:direct.body.csrf,data:{requestId:randomUUID(),changes:[{bucket:'incidents',key:'xss1',version:null,value:{id:'xss1',photo:'x" onerror="alert(1)'}}]}});assert.equal(xss.status,400);assert.match(xss.body.error,/Foto inválida/);
 // Una cookie de cuenta inválida o vencida responde 401 una vez y se borra; después sigue el acceso directo.
 const expired=client(),stale=await expired('/api/state',{headers:{Cookie:'checklist_session='+'a'.repeat(64)}});assert.equal(stale.status,401);assert(/^checklist_session=;.*Max-Age=0/.test(stale.set));
 assert.equal((await expired('/api/state')).status,200);

 // 12. Las rutas de claves ya no autorizan nada, con o sin las claves anteriores.
 for(const [path,data] of [['/api/admin/unlock',{password:'Koide2026'}],['/api/access/unlock',{scope:'admin',password:'Koide2026'}],['/api/access/unlock',{scope:'parameters',password:'Prod2026'}],['/api/access/unlock',{scope:'management',password:'K.oide2026'}],['/api/access/keys',{scope:'admin',password:'Nueva-2026',version:1}]]){const r=await guest(path,{method:'POST',data});assert.equal(r.status,410,path);assert.equal(r.set,null)}
 assert.equal((await guest('/api/session')).body.isAdmin,false);

 // 2 y 3. Credenciales incorrectas y campos vacíos. Otro origen no puede enviar el formulario.
 assert.equal((await guest('/api/login',{method:'POST',data:{username:adminName,password:'incorrecta'}})).status,401);
 assert.equal((await guest('/api/login',{method:'POST',data:{username:'no-existe-'+tag,password:adminPassword}})).status,401);
 for(const data of [{},{username:adminName},{username:'',password:''},{username:adminName,password:''}])assert.equal((await guest('/api/login',{method:'POST',data})).status,400);
 for(const key of ['Koide2026','Prod2026','K.oide2026'])assert.equal((await guest('/api/login',{method:'POST',data:{username:adminName,password:key}})).status,401);
 assert.equal((await guest('/api/login',{method:'POST',data:{username:adminName,password:adminPassword},headers:{Origin:'http://otro.sitio'}})).status,403);
 assert.equal((await guest('/api/session')).body.direct,true);

 // 1 y 7. Acceso correcto; la sesión se conserva entre módulos y al recargar.
 const admin=client(),opened=await admin('/api/login',{method:'POST',data:{username:adminName.toUpperCase(),password:adminPassword}});
 assert.equal(opened.status,200);assert(/HttpOnly;.*SameSite=Strict/.test(opened.set));assert(!JSON.stringify(opened.body).includes('scrypt'));
 assert.deepEqual([opened.body.user,opened.body.role,opened.body.isAdmin,opened.body.canParameters,opened.body.canManageKeys,opened.body.canWrite],[adminName,'admin',true,true,true,true]);
 for(let i=0;i<3;i++)for(const path of privateGets){const r=await admin(path);assert.equal(r.status,200,path);if(path==='/api/session')assert.equal(r.body.csrf,opened.body.csrf)}
 // 9 y 10. Los datos existentes siguen disponibles con el mismo contrato.
 const state=await admin('/api/state');assert(Array.isArray(state.body.entries));assert.equal(state.body.entries.length,Number(before[0].n));
 assert.equal(typeof (await admin('/api/employees')).body.employees,'object');
 assert((await admin('/api/users')).body.users.some(u=>u.username===operatorName&&u.role==='operator'&&u.active));
 // CSRF: un POST con sesión pero sin el token se rechaza; con token llega a la validación de la captura (400, no 401/403).
 assert.equal((await admin('/api/changes',{method:'POST',data:{}})).status,403);
 assert.equal((await admin('/api/changes',{method:'POST',data:{},csrf:opened.body.csrf})).status,400);

 // 5. Un operador captura pero no ejecuta operaciones administrativas ni ve parámetros.
 const operator=client(),worker=await operator('/api/login',{method:'POST',data:{username:operatorName,password:operatorPassword}});
 assert.deepEqual([worker.body.role,worker.body.isAdmin,worker.body.canParameters,worker.body.canManageKeys,worker.body.canWrite],['operator',false,false,false,true]);
 assert.equal((await operator('/api/users')).status,403);
 assert.equal((await operator('/api/users',{method:'POST',csrf:worker.body.csrf,data:{username:'prueba-http-x'+tag,displayName:'X',role:'admin',password:'Intruso-2026'}})).status,403);
 assert.equal((await operator('/api/users/active',{method:'POST',csrf:worker.body.csrf,data:{username:adminName,active:false}})).status,403);
 assert.equal((await operator('/api/users/password',{method:'POST',csrf:worker.body.csrf,data:{username:adminName,password:'Robada-2026'}})).status,403);
 const visible=await operator('/api/state');assert.equal(visible.status,200);assert(!visible.body.entries.some(e=>e.bucket==='bevelRecords'||e.bucket==='meta'&&e.key==='bevelCatalog'));
 assert.equal((await operator('/api/changes',{method:'POST',data:{},csrf:worker.body.csrf})).status,400);
 const bevel={requestId:randomUUID(),changes:[{bucket:'bevelRecords',key:'REC-HTTP-'+tag,version:null,value:{id:'REC-HTTP-'+tag}}]};
 assert.equal((await operator('/api/changes',{method:'POST',data:bevel,csrf:worker.body.csrf})).status,403);
 // Historial y checklist: modificar un registro existente o la configuración del checklist exige administrador, también por HTTP directo.
 const existing=visible.body.entries.find(e=>e.value!==null&&['records','skillMap.records','skillExams'].includes(e.bucket)),config=visible.body.entries.find(e=>e.bucket==='meta'&&e.key==='checklistConfig');
 const forbidden=[{bucket:'meta',key:'checklistConfig',version:config?.version??null,value:{B:{items:[],revision:99}}}];
 if(existing)forbidden.push({bucket:existing.bucket,key:existing.key,version:existing.version,value:{...existing.value,name:'Alterado'}},{bucket:existing.bucket,key:existing.key,version:existing.version,value:null});
 // Supervisor: mismas restricciones que el operador, salvo Actualización de parámetros.
 const supervisor=client(),chief=await supervisor('/api/login',{method:'POST',data:{username:supervisorName,password:supervisorPassword}});
 assert.deepEqual([chief.body.role,chief.body.isAdmin,chief.body.canParameters,chief.body.canManageKeys,chief.body.canWrite],['supervisor',false,true,false,true]);
 for(const [who,csrf] of [[operator,worker.body.csrf],[supervisor,chief.body.csrf]])for(const change of forbidden)assert.equal((await who('/api/changes',{method:'POST',csrf,data:{requestId:randomUUID(),changes:[change]}})).status,403,change.bucket);
 assert.equal((await supervisor('/api/users')).status,403);
 for(const [path,data] of [['/api/users',{username:'prueba-http-x'+tag,displayName:'X',role:'admin',password:'Intruso-2026'}],['/api/users/role',{username:supervisorName,role:'admin'}],['/api/users/active',{username:adminName,active:false}],['/api/users/password',{username:adminName,password:'Robada-2026'}]])assert.equal((await supervisor(path,{method:'POST',csrf:chief.body.csrf,data})).status,403,path);
 // El mismo registro de parámetros que al operador se le niega (403) pasa la autorización del supervisor y llega a la validación de datos (400); no se guarda.
 assert.equal((await supervisor('/api/changes',{method:'POST',data:{...bevel,requestId:randomUUID()},csrf:chief.body.csrf})).status,400);
 // El rol no se puede enviar desde el cliente: se ignora cualquier valor ajeno a la sesión.
 assert.equal((await operator('/api/users',{headers:{'X-Role':'admin'}})).status,403);assert.equal((await operator('/api/session?role=admin')).body.role,'operator');
 // Cambiar el rol desde administración surte efecto en el servidor de inmediato y cierra la sesión de esa cuenta.
 assert.equal((await admin('/api/users/role',{method:'POST',csrf:opened.body.csrf,data:{username:supervisorName,role:'operator'}})).status,200);assert.equal((await supervisor('/api/state')).status,401);
 assert.equal((await supervisor('/api/login',{method:'POST',data:{username:supervisorName,password:supervisorPassword}})).body.canParameters,false);
 assert.equal((await admin('/api/users/role',{method:'POST',csrf:opened.body.csrf,data:{username:adminName,role:'operator'}})).status,409);

 // El administrador restablece la contraseña del operador: su sesión abierta deja de servir.
 assert.equal((await admin('/api/users/password',{method:'POST',csrf:opened.body.csrf,data:{username:operatorName,password:'Restablecida-'+tag}})).status,200);
 assert.equal((await operator('/api/state')).status,401);
 assert.equal((await admin('/api/users/active',{method:'POST',csrf:opened.body.csrf,data:{username:adminName,active:false}})).status,409);

 // Restablecer con PIN sin sesión: PIN incorrecto no cambia nada; el correcto cambia la contraseña y cierra las sesiones.
 assert.equal((await fetch(origin+'/restablecer',{redirect:'manual'})).headers.get('location'),'/#restablecer');
 const again=client();await again('/api/login',{method:'POST',data:{username:operatorName,password:'Restablecida-'+tag}});assert.equal((await again('/api/state')).status,200);
 assert.equal((await guest('/api/password/reset',{method:'POST',data:{username:operatorName,pin:'0000',password:'Con-pin-'+tag}})).status,403);
 assert.equal((await guest('/api/password/reset',{method:'POST',data:{username:operatorName,pin:'9911',password:'corta'}})).status,400);
 assert.equal((await again('/api/state')).status,200);
 const done=await guest('/api/password/reset',{method:'POST',data:{username:operatorName,pin:'9911',password:'Con-pin-'+tag}});assert.equal(done.status,200);assert.equal(done.set,null);
 assert.equal((await again('/api/state')).status,401);assert.equal((await guest('/api/session')).body.direct,true);
 assert.equal((await again('/api/login',{method:'POST',data:{username:operatorName,password:'Restablecida-'+tag}})).status,401);
 assert.equal((await again('/api/login',{method:'POST',data:{username:operatorName,password:'Con-pin-'+tag}})).status,200);

 // 6. Cerrar sesión invalida la cookie en el servidor, aunque alguien la haya copiado.
 const copied=(await admin('/api/session')).cookie;
 const closed=await admin('/api/logout',{method:'POST',csrf:opened.body.csrf});assert.equal(closed.status,200);assert(/Max-Age=0/.test(closed.set));
 assert.equal((await guest('/api/state',{headers:{Cookie:copied}})).status,401);assert.equal((await guest('/api/session',{headers:{Cookie:copied}})).status,401);

 const [after]=await pool.execute('SELECT COUNT(*) AS n FROM documents');assert.equal(Number(after[0].n),Number(before[0].n),'La prueba no debe escribir capturas.');
 assert(!/Admin-|Oper-|scrypt:/.test(logs),'El servidor no debe registrar contraseñas ni hashes.');
 console.log('PASS HTTP: acceso directo para captura sin sesión y sin administración, sesión vencida con 401 una vez, claves antiguas con 410, credenciales incorrectas y campos vacíos, origen y CSRF, sesión persistente, operador y supervisor sin administración de checklist, edición de historial ni usuarios, supervisor con parámetros, cambio de rol, restablecer contraseña (administrador y PIN) cierra sesiones y cierre de sesión. Servidor y MySQL reales.');
}finally{
 for(const token of directTokens)await pool.execute('DELETE FROM access_sessions WHERE token_hash=?',[hash(token)]);
 server.kill();
 for(const name of [adminName,operatorName,supervisorName]){await pool.execute('DELETE FROM user_sessions WHERE username=?',[name]);await pool.execute('DELETE FROM users WHERE username=?',[name]);
  for(const address of ['127.0.0.1','::1','::ffff:127.0.0.1'])for(const key of ['login:'+name+':'+address,'reset:'+address])await pool.execute('DELETE FROM login_attempts WHERE attempt_key=?',[hash(key)])}
 await pool.end();
}
