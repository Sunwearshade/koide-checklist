import {randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {hash} from './store.mjs';
import {requireValue} from './rules.mjs';
const scrypt=promisify(scryptCallback),parameters={N:32768,r:8,p:1,maxmem:64*1024*1024};
const derive=(password,salt)=>scrypt(password,salt,64,parameters);
export async function passwordHash(password){requireValue(typeof password==='string'&&password.length>=8&&password.length<=256,'La contraseña debe tener entre 8 y 256 caracteres.');const salt=randomBytes(16).toString('hex');return `scrypt:${salt}:${(await derive(password,salt)).toString('hex')}`;}
export async function verifyPassword(password,stored){const [method,salt,key]=String(stored||'').split(':');if(method!=='scrypt'||!salt||!key)return false;const actual=await derive(password,salt),expected=Buffer.from(key,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);}
export const generatePassword=()=>randomBytes(15).toString('base64url');
// 'admin' abre todo lo que antes abrían las tres claves. 'supervisor' captura y usa Actualización de parámetros (la antigua clave de parámetros). 'operator' solo captura.
export const roles={admin:'Administrador de mantenimiento',supervisor:'Supervisor',operator:'Operador'};
export const sessionHours=12;
// Sin Secure únicamente cuando PUBLIC_ORIGIN es HTTP (localhost de desarrollo; server.mjs rechaza HTTP en otros hosts).
const secure=String(process.env.PUBLIC_ORIGIN||'').startsWith('http://')?'':' Secure;';
export const cookie=(token,maxAge=sessionHours*3600)=>`checklist_session=${token}; HttpOnly;${secure} SameSite=Strict; Path=/; Max-Age=${maxAge}`;
export function tokenFrom(req){return /(?:^|;\s*)checklist_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1]||'';}
export const normalizeUsername=value=>typeof value==='string'?value.trim().toLowerCase():'';
const validUsername=name=>/^[a-z0-9][a-z0-9._-]{2,63}$/.test(name);
const account=(row,extra={})=>({user:row.username,displayName:row.display_name,role:row.role,canWrite:true,isAdmin:row.role==='admin',canParameters:row.role==='admin'||row.role==='supervisor',canManageKeys:row.role==='admin',...extra});
// Devuelve null sin sesión válida de cuenta; server.mjs usa entonces el acceso directo.
export async function session(pool,req){
 const token=tokenFrom(req);if(!token)return null;
 const [rows]=await pool.execute('SELECT s.csrf,u.username,u.display_name,u.role FROM user_sessions s JOIN users u ON u.username=s.username WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() AND u.active=1',[hash(token)]);
 return rows.length?account(rows[0],{csrf:rows[0].csrf,tokenHash:hash(token)}):null;
}
// Acceso directo: sin iniciar sesión, cualquier equipo de la planta consulta y captura en Recepción de máquinas,
// como antes de las cuentas. Nunca da permisos de administración ni de parámetros: para eso se inicia sesión.
export const directUser='acceso-directo';
export const directCookie=(token,maxAge=30*86400)=>`checklist_direct=${token}; HttpOnly;${secure} SameSite=Strict; Path=/; Max-Age=${maxAge}`;
export async function directSession(pool,req,res){
 let token=/(?:^|;\s*)checklist_direct=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1]||'',rows=[];
 if(token)[rows]=await pool.execute('SELECT csrf FROM access_sessions WHERE token_hash=? AND expires_at>UTC_TIMESTAMP()',[hash(token)]);
 if(!rows.length){
  token=randomBytes(32).toString('hex');rows=[{csrf:randomBytes(32).toString('hex')}];
  await pool.execute('DELETE FROM access_sessions WHERE expires_at<UTC_TIMESTAMP()');
  await pool.execute('INSERT INTO access_sessions(token_hash,csrf,expires_at) VALUES(?,?,UTC_TIMESTAMP()+INTERVAL 30 DAY)',[hash(token),rows[0].csrf]);
  res.setHeader('Set-Cookie',directCookie(token));
 }
 return {user:directUser,displayName:'Acceso directo',role:'operator',direct:true,canWrite:true,isAdmin:false,canParameters:false,canManageKeys:false,csrf:rows[0].csrf,tokenHash:hash(token)};
}
const wrong=()=>requireValue(false,'Usuario o contraseña incorrectos.',401);
// Hash de relleno: un usuario inexistente tarda lo mismo que una contraseña incorrecta.
const decoy=passwordHash(generatePassword());
export async function login(pool,req,res,input){
 const username=normalizeUsername(input?.username),password=input?.password;
 requireValue(username&&typeof password==='string'&&password.length>0,'Escribe tu usuario y tu contraseña.');
 if(!validUsername(username)||password.length>256)wrong();
 const attemptKey=hash('login:'+username+':'+(req.socket?.remoteAddress||''));
 await pool.execute('INSERT INTO login_attempts(attempt_key,attempts,window_start) VALUES(?,1,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE attempts=IF(window_start<UTC_TIMESTAMP()-INTERVAL 15 MINUTE,1,attempts+1),window_start=IF(window_start<UTC_TIMESTAMP()-INTERVAL 15 MINUTE,UTC_TIMESTAMP(),window_start)',[attemptKey]);
 const [attempts]=await pool.execute('SELECT attempts FROM login_attempts WHERE attempt_key=?',[attemptKey]);requireValue(attempts[0].attempts<=10,'Demasiados intentos. Espera 15 minutos.',429);
 const [rows]=await pool.execute('SELECT username,display_name,role,password_hash FROM users WHERE username=? AND active=1',[username]);
 if(!await verifyPassword(password,rows[0]?.password_hash||await decoy)||!rows.length)wrong();
 const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
 await pool.execute('DELETE FROM user_sessions WHERE expires_at<UTC_TIMESTAMP()');
 await pool.execute(`INSERT INTO user_sessions(token_hash,username,csrf,expires_at) VALUES(?,?,?,UTC_TIMESTAMP()+INTERVAL ${sessionHours} HOUR)`,[hash(token),rows[0].username,csrf]);
 await pool.execute('DELETE FROM login_attempts WHERE attempt_key=?',[attemptKey]);
 res.setHeader('Set-Cookie',cookie(token));
 return account(rows[0],{csrf,tokenHash:hash(token)});
}
export async function logout(pool,user,res){await pool.execute('DELETE FROM user_sessions WHERE token_hash=?',[user.tokenHash]);res.setHeader('Set-Cookie',cookie('',0));}
// Restablecimiento sin sesión con el PIN de RESET_PIN (.env). Sin PIN configurado queda desactivado.
export async function resetPassword(pool,req,input){
 const pin=process.env.RESET_PIN||'';requireValue(pin.length>0,'El restablecimiento con PIN no está configurado en este servidor.',503);
 const username=normalizeUsername(input?.username),given=['string','number'].includes(typeof input?.pin)?String(input.pin).trim():'';
 requireValue(username&&given,'Escribe tu usuario y el PIN.');requireValue(typeof input.password==='string'&&input.password.length>=8&&input.password.length<=256,'La contraseña debe tener entre 8 y 256 caracteres.');
 // El PIN es corto: 5 intentos fallidos por equipo o por cuenta, y 20 en total, bloquean el restablecimiento 15 minutos.
 // El límite por cuenta y el total valen aunque detrás de IIS todas las solicitudes lleguen desde la misma dirección.
 const attemptKey=hash('reset:'+(req.socket?.remoteAddress||'')),userKey=hash('reset-user:'+username),globalKey=hash('reset-global');
 for(const [key,limit] of [[attemptKey,5],[userKey,5],[globalKey,20]]){
  await pool.execute('INSERT INTO login_attempts(attempt_key,attempts,window_start) VALUES(?,1,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE attempts=IF(window_start<UTC_TIMESTAMP()-INTERVAL 15 MINUTE,1,attempts+1),window_start=IF(window_start<UTC_TIMESTAMP()-INTERVAL 15 MINUTE,UTC_TIMESTAMP(),window_start)',[key]);
  const [attempts]=await pool.execute('SELECT attempts FROM login_attempts WHERE attempt_key=?',[key]);requireValue(attempts[0].attempts<=limit,'Demasiados intentos. Espera 15 minutos.',429);
 }
 requireValue(timingSafeEqual(Buffer.from(hash(given)),Buffer.from(hash(pin))),'PIN incorrecto.',403);
 const [rows]=await pool.execute('SELECT username FROM users WHERE username=? AND active=1',[username]);requireValue(rows.length===1,'Usuario desconocido o inactivo.',404);
 await setPassword(pool,username,input.password);
 for(const key of [attemptKey,userKey])await pool.execute('DELETE FROM login_attempts WHERE attempt_key=?',[key]);
}

const requireAdmin=user=>requireValue(user?.isAdmin===true,'Se requiere una cuenta de administrador de mantenimiento.',403);
export async function listUsers(pool,user){requireAdmin(user);const [rows]=await pool.execute('SELECT username,display_name,role,active FROM users ORDER BY username');return rows.map(r=>({username:r.username,displayName:r.display_name,role:r.role,active:!!r.active}));}
// Sin sesión (scripts de Sistemas) o con sesión de administrador. Nunca sobrescribe una cuenta existente.
export async function createUser(pool,input,user){
 if(user!==undefined)requireAdmin(user);
 const username=normalizeUsername(input?.username),displayName=typeof input?.displayName==='string'?input.displayName.trim():'';
 requireValue(validUsername(username),'El usuario debe tener de 3 a 64 caracteres: letras, números, punto, guion o guion bajo.');requireValue(username!==directUser,'Ese nombre está reservado para el acceso directo.',409);
 requireValue(Object.hasOwn(roles,input?.role),'Rol desconocido.');requireValue(displayName.length>0&&displayName.length<=120,'Escribe el nombre de la persona o del puesto.');
 const hashed=await passwordHash(input.password);
 const [result]=await pool.execute('INSERT IGNORE INTO users(username,display_name,role,password_hash) VALUES(?,?,?,?)',[username,displayName,input.role,hashed]);
 requireValue(result.affectedRows===1,'Ese usuario ya existe.',409);return username;
}
// Un administrador cambia cualquier contraseña; cada cuenta cambia la suya confirmando la actual.
export async function changePassword(pool,user,input){
 const username=normalizeUsername(input?.username),own=username===user.user;if(!own)requireAdmin(user);
 const [rows]=await pool.execute('SELECT password_hash FROM users WHERE username=?',[username]);requireValue(rows.length===1,'Usuario desconocido.',404);
 if(own)requireValue(typeof input.currentPassword==='string'&&input.currentPassword.length<=256&&await verifyPassword(input.currentPassword,rows[0].password_hash),'La contraseña actual es incorrecta.',403);
 await setPassword(pool,username,input.password,user.tokenHash);
}
export async function setPassword(pool,username,password,keepTokenHash=''){
 const [result]=await pool.execute('UPDATE users SET password_hash=? WHERE username=?',[await passwordHash(password),normalizeUsername(username)]);requireValue(result.affectedRows===1,'Usuario desconocido.',404);
 await pool.execute('DELETE FROM user_sessions WHERE username=? AND token_hash<>?',[normalizeUsername(username),keepTokenHash]);
}
export async function setRole(pool,user,input){
 requireAdmin(user);const username=normalizeUsername(input?.username);requireValue(Object.hasOwn(roles,input?.role),'Rol desconocido.');
 requireValue(username!==user.user,'No puedes cambiar tu propio rol.',409);
 const [result]=await pool.execute('UPDATE users SET role=? WHERE username=?',[input.role,username]);requireValue(result.affectedRows===1,'Usuario desconocido.',404);
 await pool.execute('DELETE FROM user_sessions WHERE username=?',[username]);
}
export async function setActive(pool,user,input){
 requireAdmin(user);const username=normalizeUsername(input?.username);requireValue(typeof input?.active==='boolean','Estado inválido.');
 requireValue(username!==user.user,'No puedes desactivar tu propia cuenta.',409);
 const [result]=await pool.execute('UPDATE users SET active=? WHERE username=?',[input.active?1:0,username]);requireValue(result.affectedRows===1,'Usuario desconocido.',404);
 if(!input.active)await pool.execute('DELETE FROM user_sessions WHERE username=?',[username]);
}
