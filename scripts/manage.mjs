import fs from 'node:fs';
import {installAccessKeys} from '../src/auth.mjs';
import {createPool} from '../src/db.mjs';
const pool=createPool(),command=process.argv[2];
async function updateKeys(){const sql=fs.readFileSync(new URL('../sql/003-access-keys.sql',import.meta.url),'utf8');for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await pool.query(statement);await installAccessKeys(pool)}
try{
 if(command==='init'){
  const [tables]=await pool.execute('SHOW TABLES');if(tables.length)throw Error('La instalación requiere una base vacía. No se modificó ninguna tabla.');
  const sql=fs.readFileSync(new URL('../sql/001-create.sql',import.meta.url),'utf8').replace(/^--.*$/gm,'');const c=await pool.getConnection();
  try{for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await c.query(statement)}finally{c.release()}
  await updateKeys();console.log('Esquema 2 instalado.');
 }else if(command==='access'){
  const sql=fs.readFileSync(new URL('../sql/002-direct-access.sql',import.meta.url),'utf8').replace(/^--.*$/gm,'');
  for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await pool.query(statement);
  await updateKeys();console.log('Módulos y claves actualizados. Registros existentes conservados.');
 }else if(command==='employees'){
  const data=JSON.parse(fs.readFileSync(process.argv[3]||new URL('../data/employees.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
  const rows=Object.entries(data);if(!rows.length||rows.some(([id,name])=>!/^\d{1,40}$/.test(id)||typeof name!=='string'||!name.trim()||name.length>250))throw Error('Catálogo inválido. Usa un objeto JSON número: nombre.');
  const c=await pool.getConnection();try{await c.beginTransaction();for(const [id,name]of rows)await c.execute('INSERT INTO employees(employee_number,full_name) VALUES(?,?) ON DUPLICATE KEY UPDATE full_name=?,active=1',[id,name,name]);await c.commit()}catch(e){await c.rollback();throw e}finally{c.release()}
  console.log(`${rows.length} empleados importados. No se eliminaron empleados ausentes del archivo.`);
 }else throw Error('Comandos: init, access, employees [archivo.json]');
}catch(e){console.error(e.message);process.exitCode=1}finally{await pool.end()}
