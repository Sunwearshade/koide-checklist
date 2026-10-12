import fs from 'node:fs';
import {createUser,setPassword,generatePassword,normalizeUsername} from '../src/auth.mjs';
import {createPool} from '../src/db.mjs';
const pool=createPool(),command=process.argv[2];
const initialAdmin='admin-mant';
async function run(file){const sql=fs.readFileSync(new URL('../sql/'+file,import.meta.url),'utf8').replace(/^--.*$/gm,'');for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await pool.query(statement)}
// La contraseña se muestra una sola vez en esta consola; en MySQL solo queda su hash scrypt.
function chosenPassword(){const given=process.env.CHECKLIST_PASSWORD;if(given)return {password:given,shown:'(la indicada en CHECKLIST_PASSWORD)'};const password=generatePassword();return {password,shown:password}}
// Idempotente: crea las tablas si faltan y la cuenta inicial solo cuando no existe. Nunca cambia una cuenta existente.
async function updateUsers(){
 await run('003-access-keys.sql');await run('004-users.sql');await run('005-initial-users.sql');
 const [rows]=await pool.execute('SELECT username FROM users WHERE username=?',[initialAdmin]);
 if(rows.length){console.log(`La cuenta ${initialAdmin} ya existe; no se modificó. Para cambiar su contraseña: npm run set-password -- ${initialAdmin}`);return}
 const {password,shown}=chosenPassword();await createUser(pool,{username:initialAdmin,displayName:'Mantenimiento',role:'admin',password});
 console.log(`Cuenta creada. Usuario: ${initialAdmin}  Contraseña inicial: ${shown}\nGuárdala ahora: no se volverá a mostrar. Cámbiala al entrar, en Administración > Usuarios.`);
}
try{
 if(command==='init'){
  const [tables]=await pool.execute('SHOW TABLES');if(tables.length)throw Error('La instalación requiere una base vacía. No se modificó ninguna tabla.');
  const sql=fs.readFileSync(new URL('../sql/001-create.sql',import.meta.url),'utf8').replace(/^--.*$/gm,'');const c=await pool.getConnection();
  try{for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await c.query(statement)}finally{c.release()}
  await updateUsers();console.log('Esquema 3 instalado.');
 }else if(command==='access'){
  const sql=fs.readFileSync(new URL('../sql/002-direct-access.sql',import.meta.url),'utf8').replace(/^--.*$/gm,'');
  for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await pool.query(statement);
  await updateUsers();console.log('Acceso por usuario y contraseña instalado (esquema 3). Registros existentes conservados.');
 }else if(command==='employees'){
  const data=JSON.parse(fs.readFileSync(process.argv[3]||new URL('../data/employees.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
  const rows=Object.entries(data);if(!rows.length||rows.some(([id,name])=>!/^\d{1,40}$/.test(id)||typeof name!=='string'||!name.trim()||name.length>250))throw Error('Catálogo inválido. Usa un objeto JSON número: nombre.');
  const c=await pool.getConnection();try{await c.beginTransaction();for(const [id,name]of rows)await c.execute('INSERT INTO employees(employee_number,full_name) VALUES(?,?) ON DUPLICATE KEY UPDATE full_name=?,active=1',[id,name,name]);await c.commit()}catch(e){await c.rollback();throw e}finally{c.release()}
  console.log(`${rows.length} empleados importados. No se eliminaron empleados ausentes del archivo.`);
 }else if(command==='password'){
  const username=normalizeUsername(process.argv[3]);if(!username)throw Error('Indica el usuario: npm run set-password -- usuario');
  const {password,shown}=chosenPassword();await setPassword(pool,username,password);
  console.log(`Contraseña actualizada y sesiones cerradas. Usuario: ${username}  Contraseña nueva: ${shown}`);
 }else throw Error('Comandos: init, access, password <usuario>, employees [archivo.json]');
}catch(e){console.error(e.message);process.exitCode=1}finally{await pool.end()}
