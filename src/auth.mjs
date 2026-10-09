import fs from 'node:fs';
import {randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {hash} from './store.mjs';
import {requireValue} from './rules.mjs';
const scrypt=promisify(scryptCallback),parameters={N:32768,r:8,p:1,maxmem:64*1024*1024};
const derive=(password,salt)=>scrypt(password,salt,64,parameters);
export async function passwordHash(password){requireValue(typeof password==='string'&&password.length>=8&&password.length<=256,'La contraseña debe tener entre 8 y 256 caracteres.');const salt=randomBytes(16).toString('hex');return `scrypt:${salt}:${(await derive(password,salt)).toString('hex')}`;}
export async function verifyPassword(password,stored){const [method,salt,key]=String(stored||'').split(':');if(method!=='scrypt'||!salt||!key)return false;const actual=await derive(password,salt),expected=Buffer.from(key,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);}
export const accessDefaults=JSON.parse(fs.readFileSync(new URL('../data/access-config.json',import.meta.url),'utf8'));
export const accessScopes=['admin','parameters','management'];
export const cookie=token=>`checklist_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`;
export function tokenFrom(req){return /(?:^|;\s*)checklist_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1]||'';}
export async function session(pool,req,res){
 let token=tokenFrom(req),rows=[];
 if(token)[rows]=await pool.execute('SELECT csrf,(admin_until>UTC_TIMESTAMP()) AS is_admin FROM access_sessions WHERE token_hash=? AND expires_at>UTC_TIMESTAMP()',[hash(token)]);
 if(!rows.length){
  token=randomBytes(32).toString('hex');const csrf=randomBytes(32).toString('hex');
  await pool.execute('INSERT INTO access_sessions(token_hash,csrf,expires_at) VALUES(?,?,UTC_TIMESTAMP()+INTERVAL 30 DAY)',[hash(token),csrf]);
  res.setHeader('Set-Cookie',cookie(token));rows=[{csrf,is_admin:0}];
 }
 const [grants]=await pool.execute('SELECT scope FROM access_grants WHERE token_hash=? AND expires_at>UTC_TIMESTAMP()',[hash(token)]);
 return {user:'acceso-directo',canWrite:true,isAdmin:rows[0].is_admin===1,canParameters:grants.some(g=>g.scope==='parameters'),canManageKeys:grants.some(g=>g.scope==='management'),csrf:rows[0].csrf,tokenHash:hash(token)};
}
export async function unlockAdmin(pool,user,password){return unlockScope(pool,user,'admin',password)}
export async function unlockScope(pool,user,scope,password){
 requireValue(accessScopes.includes(scope),'Acceso desconocido.');
 requireValue(typeof password==='string'&&password.length<=256,'Clave incorrecta.',403);
 const attemptKey=hash('key:'+scope+':'+user.tokenHash);
 await pool.execute('INSERT INTO login_attempts(attempt_key,attempts,window_start) VALUES(?,1,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE attempts=IF(window_start<UTC_TIMESTAMP()-INTERVAL 15 MINUTE,1,attempts+1),window_start=IF(window_start<UTC_TIMESTAMP()-INTERVAL 15 MINUTE,UTC_TIMESTAMP(),window_start)',[attemptKey]);
 const [attempts]=await pool.execute('SELECT attempts FROM login_attempts WHERE attempt_key=?',[attemptKey]);requireValue(attempts[0].attempts<=10,'Demasiados intentos. Espera 15 minutos.',429);
 const [keys]=await pool.execute('SELECT password_hash FROM access_keys WHERE scope=?',[scope]);requireValue(keys.length===1,'Sistemas debe ejecutar update-access para instalar las claves.',503);
 requireValue(await verifyPassword(password,keys[0].password_hash),'Clave incorrecta.',403);
 const c=await pool.getConnection();
 try{await c.beginTransaction();
  const [current]=await c.execute('SELECT password_hash FROM access_keys WHERE scope=? FOR UPDATE',[scope]);
  requireValue(current[0]?.password_hash===keys[0].password_hash,'La clave cambió. Vuelve a ingresar.',403);
  if(scope==='admin')await c.execute('UPDATE access_sessions SET admin_until=UTC_TIMESTAMP()+INTERVAL 15 MINUTE WHERE token_hash=?',[user.tokenHash]);
  await c.execute('INSERT INTO access_grants(token_hash,scope,expires_at) VALUES(?,?,UTC_TIMESTAMP()+INTERVAL 15 MINUTE) ON DUPLICATE KEY UPDATE expires_at=UTC_TIMESTAMP()+INTERVAL 15 MINUTE',[user.tokenHash,scope]);
  await c.execute('DELETE FROM login_attempts WHERE attempt_key=?',[attemptKey]);await c.commit();
 }catch(e){await c.rollback();throw e}finally{c.release()}
}

export async function changeKey(pool,user,input){
 requireValue(user.canManageKeys,'Se requiere la clave de Administración.',403);
 requireValue(input&&accessScopes.includes(input.scope)&&Number.isInteger(input.version),'Clave o versión inválida.');
 const hashed=await passwordHash(input.password),c=await pool.getConnection();
 try{await c.beginTransaction();const [rows]=await c.execute('SELECT revision FROM access_keys WHERE scope=? FOR UPDATE',[input.scope]);requireValue(rows.length===1&&rows[0].revision===input.version,'La clave fue modificada desde otro equipo. Vuelve a abrir Administración.',409);
  const [allowed]=await c.execute("SELECT scope FROM access_grants WHERE token_hash=? AND scope='management' AND expires_at>UTC_TIMESTAMP() FOR UPDATE",[user.tokenHash]);requireValue(allowed.length===1,'Vuelve a abrir Administración.',403);
  await c.execute('UPDATE access_keys SET password_hash=?,revision=revision+1 WHERE scope=?',[hashed,input.scope]);
  await c.execute('INSERT INTO access_key_audit(scope,revision) VALUES(?,?)',[input.scope,input.version+1]);
  await c.execute('DELETE FROM access_grants');await c.execute('UPDATE access_sessions SET admin_until=NULL');await c.commit();
 }catch(e){await c.rollback();throw e}finally{c.release()}
}
export async function installAccessKeys(pool){for(const scope of accessScopes){const hashed=scope==='admin'?accessDefaults.adminPasswordHash:accessDefaults[scope+'PasswordHash'];requireValue(!!hashed,'Falta configuración de clave '+scope,503);await pool.execute('INSERT IGNORE INTO access_keys(scope,password_hash) VALUES(?,?)',[scope,hashed])}}
