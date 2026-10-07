import fs from 'node:fs';
import {randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {hash} from './store.mjs';
import {requireValue} from './rules.mjs';
const scrypt=promisify(scryptCallback),parameters={N:32768,r:8,p:1,maxmem:64*1024*1024};
const derive=(password,salt)=>scrypt(password,salt,64,parameters);
export async function passwordHash(password){requireValue(typeof password==='string'&&password.length>=8&&password.length<=256,'La contraseña debe tener entre 8 y 256 caracteres.');const salt=randomBytes(16).toString('hex');return `scrypt:${salt}:${(await derive(password,salt)).toString('hex')}`;}
export async function verifyPassword(password,stored){const [method,salt,key]=String(stored||'').split(':');if(method!=='scrypt'||!salt||!key)return false;const actual=await derive(password,salt),expected=Buffer.from(key,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);}
const adminHash=JSON.parse(fs.readFileSync(new URL('../data/access-config.json',import.meta.url),'utf8')).adminPasswordHash;
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
 return {user:'acceso-directo',canWrite:true,isAdmin:rows[0].is_admin===1,csrf:rows[0].csrf,tokenHash:hash(token)};
}
export async function unlockAdmin(pool,user,password){
 requireValue(typeof password==='string'&&password.length<=256,'Clave incorrecta.',403);
 const attemptKey=hash('admin:'+user.tokenHash);
 await pool.execute('INSERT INTO login_attempts(attempt_key,attempts,window_start) VALUES(?,1,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE attempts=IF(window_start<UTC_TIMESTAMP()-INTERVAL 15 MINUTE,1,attempts+1),window_start=IF(window_start<UTC_TIMESTAMP()-INTERVAL 15 MINUTE,UTC_TIMESTAMP(),window_start)',[attemptKey]);
 const [attempts]=await pool.execute('SELECT attempts FROM login_attempts WHERE attempt_key=?',[attemptKey]);requireValue(attempts[0].attempts<=10,'Demasiados intentos. Espera 15 minutos.',429);
 requireValue(await verifyPassword(password,adminHash),'Clave incorrecta.',403);
 await pool.execute('UPDATE access_sessions SET admin_until=UTC_TIMESTAMP()+INTERVAL 15 MINUTE WHERE token_hash=?',[user.tokenHash]);
 await pool.execute('DELETE FROM login_attempts WHERE attempt_key=?',[attemptKey]);
}
