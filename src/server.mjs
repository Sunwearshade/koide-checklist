import http from 'node:http';
import fs from 'node:fs';
import {createPool} from './db.mjs';
import {read,save} from './store.mjs';
import {session,unlockAdmin} from './auth.mjs';
import {requireValue} from './rules.mjs';
const origin=new URL(process.env.PUBLIC_ORIGIN||'https://invalid.local');
if(origin.protocol!=='https:'||origin.host==='invalid.local'||origin.pathname!=='/')throw Error('Configura PUBLIC_ORIGIN con la dirección HTTPS de IIS, sin subcarpeta.');
const pool=createPool(),max=Number(process.env.BODY_LIMIT_MB||64)*1024*1024;
const page=fs.readFileSync(new URL('../public/index.html',import.meta.url));
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data))};
async function body(req,limit=max){
 requireValue((req.headers['content-type']||'').split(';')[0]==='application/json','Formato no permitido.',415);
 requireValue(!req.headers['content-length']||Number(req.headers['content-length'])<=limit,'Solicitud demasiado grande.',413);
 let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;requireValue(size<=limit,'Solicitud demasiado grande.',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Object.assign(Error('JSON inválido.'),{status:400})}
}
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Strict-Transport-Security','max-age=31536000');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
 try{
  const path=new URL(req.url,origin).pathname;
  // IIS preserves the original Host. Node cannot be reached directly from the LAN.
  requireValue(req.headers.host===origin.host,'Dirección no autorizada.',403);
  if(!['GET','POST'].includes(req.method))return json(res,405,{error:'Método no permitido.'});
  if(req.method==='POST')requireValue(req.headers.origin===origin.origin,'Origen no autorizado.',403);
  if((path==='/'||path==='/index.html')&&req.method==='GET'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(page)}
  if(path==='/login'&&req.method==='GET'){res.writeHead(302,{Location:'/'});return res.end()}
  const user=await session(pool,req,res);
  const publicSession=()=>({user:user.user,csrf:user.csrf,isAdmin:user.isAdmin,canWrite:true});
  if(path==='/api/session'&&req.method==='GET')return json(res,200,publicSession());
  if(req.method==='POST')requireValue(req.headers['x-csrf-token']===user.csrf,'La sesión cambió. Actualiza la página.',403);
  if(path==='/api/admin/unlock'&&req.method==='POST'){const input=await body(req,8192);await unlockAdmin(pool,user,input.password);return json(res,200,{...publicSession(),isAdmin:true})}
  if(path==='/api/admin/lock'&&req.method==='POST'){await pool.execute('UPDATE access_sessions SET admin_until=NULL WHERE token_hash=?',[user.tokenHash]);return json(res,200,{...publicSession(),isAdmin:false})}
  if(path==='/api/health'&&req.method==='GET'){const [rows]=await pool.execute('SELECT MAX(version) AS version FROM schema_version');requireValue(rows[0].version===1,'Esquema pendiente.',503);return json(res,200,{ok:true,database:'MySQL'})}
  if(path==='/api/employees'&&req.method==='GET'){const [rows]=await pool.execute('SELECT employee_number,full_name FROM employees WHERE active=1 ORDER BY employee_number');return json(res,200,{employees:Object.fromEntries(rows.map(r=>[r.employee_number,r.full_name]))})}
  if(path==='/api/state'&&req.method==='GET')return json(res,200,await read(pool));
  if(path==='/api/changes'&&req.method==='POST'){requireValue(user.canWrite,'La cuenta es de consulta.',403);const request=await body(req);await save(pool,request,user.user,user.isAdmin);return json(res,200,{saved:true,requestId:request.requestId})}
  json(res,404,{error:'Recurso no encontrado.'});
 }catch(error){
  if(!error.status)console.error(new Date().toISOString(),error.code||error.name); // Never log passwords or application records.
  json(res,error.status||503,{error:error.status?error.message:'El servidor no pudo confirmar la operación. Reintenta el envío pendiente.'});
 }
});
server.requestTimeout=60000;server.headersTimeout=15000;
server.listen(Number(process.env.PORT||3080),'127.0.0.1',()=>console.log('Checklist MySQL listo en loopback. Acceso público: '+origin.origin));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await pool.end();process.exit(0)}));
