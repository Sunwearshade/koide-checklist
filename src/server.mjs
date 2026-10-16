import http from 'node:http';
import fs from 'node:fs';
import {createPool} from './db.mjs';
import {read,save} from './store.mjs';
import {session,directSession,tokenFrom,cookie,login,logout,resetPassword,listUsers,createUser,changePassword,setActive,setRole} from './auth.mjs';
import {requireValue} from './rules.mjs';
const origin=new URL(process.env.PUBLIC_ORIGIN||'https://invalid.local');
// HTTP se acepta en localhost y en IPs privadas de LAN (despliegue Koide por PM2 sin IIS). Hosts publicos exigen HTTPS.
const local=origin.protocol==='http:'&&(['localhost','127.0.0.1'].includes(origin.hostname)||/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(origin.hostname));
if((origin.protocol!=='https:'&&!local)||origin.host==='invalid.local'||origin.pathname!=='/')throw Error('Configura PUBLIC_ORIGIN con la dirección HTTPS de IIS, sin subcarpeta.');
// EXTRA_ORIGINS: otras direcciones del mismo servidor (p. ej. segunda tarjeta de red), separadas por coma. Mismas reglas que PUBLIC_ORIGIN.
const isLocalHttp=u=>u.protocol==='http:'&&(['localhost','127.0.0.1'].includes(u.hostname)||/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname));
const origins=[origin,...String(process.env.EXTRA_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean).map(s=>new URL(s))];
for(const o of origins)if((o.protocol!=='https:'&&!isLocalHttp(o))||o.pathname!=='/')throw Error(`EXTRA_ORIGINS inválido: ${o.href}`);
const pool=createPool(),max=Number(process.env.BODY_LIMIT_MB||64)*1024*1024;
const page=fs.readFileSync(new URL('../public/index.html',import.meta.url));
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data))};
async function body(req,limit=max){
 requireValue((req.headers['content-type']||'').split(';')[0]==='application/json','Formato no permitido.',415);
 requireValue(!req.headers['content-length']||Number(req.headers['content-length'])<=limit,'Solicitud demasiado grande.',413);
 let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;requireValue(size<=limit,'Solicitud demasiado grande.',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Object.assign(Error('JSON inválido.'),{status:400})}
}
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');if(!local)res.setHeader('Strict-Transport-Security','max-age=31536000');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' about:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
 try{
  const path=new URL(req.url,origin).pathname;
  // IIS preserves the original Host. Node cannot be reached directly from the LAN.
  const allowed=origins.find(o=>o.host===req.headers.host);
  requireValue(allowed,'Dirección no autorizada.',403);
  if(!['GET','POST'].includes(req.method))return json(res,405,{error:'Método no permitido.'});
  if(req.method==='POST')requireValue(req.headers.origin===allowed.origin,'Origen no autorizado.',403);
  if((path==='/'||path==='/index.html')&&req.method==='GET'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(page)}
  if(path==='/login'&&req.method==='GET'){res.writeHead(302,{Location:'/'});return res.end()}
  if(path==='/restablecer'&&req.method==='GET'){res.writeHead(302,{Location:'/#restablecer'});return res.end()}
  const publicSession=user=>({user:user.user,displayName:user.displayName,role:user.role,direct:user.direct===true,csrf:user.csrf,isAdmin:user.isAdmin,canParameters:user.canParameters,canManageKeys:user.canManageKeys,canWrite:true});
  if(path==='/api/health'&&req.method==='GET'){const [rows]=await pool.execute('SELECT MAX(version) AS version FROM schema_version');requireValue(rows[0].version===3,'Esquema pendiente.',503);return json(res,200,{ok:true,database:'MySQL'})}
  // El acceso por claves compartidas quedó sustituido por usuario y contraseña; estas rutas ya no autorizan nada.
  if(['/api/access/unlock','/api/access/keys','/api/admin/unlock','/api/admin/lock'].includes(path))return json(res,410,{error:'El acceso por claves fue sustituido por usuario y contraseña.'});
  if(path==='/api/login'&&req.method==='POST')return json(res,200,publicSession(await login(pool,req,res,await body(req,8192))));
  if(path==='/api/password/reset'&&req.method==='POST'){await resetPassword(pool,req,await body(req,8192));return json(res,200,{saved:true})}
  // Fuera de la API no hay nada más que servir; así una ruta inexistente no abre una sesión directa.
  if(!path.startsWith('/api/'))return json(res,404,{error:'Recurso no encontrado.'});
  const named=await session(pool,req);
  // Una sesión de cuenta vencida avisa una vez, para no seguir sin darse cuenta con otros permisos; después queda el acceso directo.
  if(!named&&tokenFrom(req)){res.setHeader('Set-Cookie',cookie('',0));requireValue(false,'Tu sesión venció. Inicia sesión de nuevo o continúa en acceso directo.',401)}
  // Sin sesión: acceso directo para consultar y capturar en Recepción de máquinas (rol operador).
  const user=named||await directSession(pool,req,res);
  if(user.direct&&(path==='/api/logout'||path.startsWith('/api/users')))requireValue(false,'Inicia sesión para continuar.',401);
  if(path==='/api/session'&&req.method==='GET')return json(res,200,publicSession(user));
  if(req.method==='POST')requireValue(req.headers['x-csrf-token']===user.csrf,'La sesión cambió. Actualiza la página.',403);
  if(path==='/api/logout'&&req.method==='POST'){await logout(pool,user,res);return json(res,200,{closed:true})}
  if(path==='/api/users'&&req.method==='GET')return json(res,200,{users:await listUsers(pool,user)});
  if(path==='/api/users'&&req.method==='POST'){await createUser(pool,await body(req,8192),user);return json(res,200,{saved:true})}
  if(path==='/api/users/password'&&req.method==='POST'){await changePassword(pool,user,await body(req,8192));return json(res,200,{saved:true})}
  if(path==='/api/users/role'&&req.method==='POST'){await setRole(pool,user,await body(req,8192));return json(res,200,{saved:true})}
  if(path==='/api/users/active'&&req.method==='POST'){await setActive(pool,user,await body(req,8192));return json(res,200,{saved:true})}
  if(path==='/api/employees'&&req.method==='GET'){const [rows]=await pool.execute('SELECT employee_number,full_name FROM employees WHERE active=1 ORDER BY employee_number');return json(res,200,{employees:Object.fromEntries(rows.map(r=>[r.employee_number,r.full_name]))})}
  if(path==='/api/state'&&req.method==='GET'){const data=await read(pool);if(!user.isAdmin)data.entries=data.entries.filter(e=>!(e.bucket==='meta'&&e.key==='skillDeletedRecords'));if(!user.canParameters&&!user.isAdmin)data.entries=data.entries.filter(e=>e.bucket!=='bevelRecords'&&!(e.bucket==='meta'&&e.key==='bevelCatalog'));return json(res,200,data)}
  if(path==='/api/changes'&&req.method==='POST'){requireValue(user.canWrite,'La cuenta es de consulta.',403);const request=await body(req,user.isAdmin?max:Math.min(max,4*1024*1024));await save(pool,request,user.user,user.isAdmin,user.canParameters);return json(res,200,{saved:true,requestId:request.requestId})}
  json(res,404,{error:'Recurso no encontrado.'});
 }catch(error){
  if(!error.status)console.error(new Date().toISOString(),error.code||error.name); // Never log passwords or application records.
  json(res,error.status||503,{error:error.status?error.message:'El servidor no pudo confirmar la operación. Reintenta el envío pendiente.'});
 }
});
server.requestTimeout=60000;server.headersTimeout=15000;
server.listen(Number(process.env.PORT||3080),process.env.HOST||'127.0.0.1',()=>console.log(local?'Checklist MySQL listo. Abre: '+origin.origin:'Checklist MySQL listo en loopback. Acceso público: '+origin.origin));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await pool.end();process.exit(0)}));
