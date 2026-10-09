import {createHash} from 'node:crypto';
import {checkRequest,authorize,validate,keyOf,requireValue} from './rules.mjs';
export const hash=value=>createHash('sha256').update(value).digest('hex');
function version(value){const n=Number(value);if(!Number.isSafeInteger(n))throw Error('Versión fuera de rango.');return n;}
export async function entries(connection){const [rows]=await connection.execute('SELECT bucket,entity_key AS `key`,version,value FROM documents ORDER BY bucket,entity_key');return rows.map(r=>({...r,version:version(r.version),value:typeof r.value==='string'?JSON.parse(r.value):r.value}));}
export async function read(pool){return {entries:await entries(pool)}}
export async function save(pool,request,user,admin,parameterAccess=false){
 checkRequest(request);const fingerprint=hash(JSON.stringify(request));const c=await pool.getConnection();
 try{
  await c.beginTransaction();
  // A single InnoDB row lock protects cross-record checks and global NG numbering.
  const [locks]=await c.execute('SELECT ng_number FROM save_lock WHERE id=1 FOR UPDATE');requireValue(locks.length===1,'Esquema no inicializado.',503);
  const [requests]=await c.execute('SELECT username,payload_hash FROM requests WHERE request_id=?',[request.requestId]);
  if(requests.length){requireValue(requests[0].username===user&&requests[0].payload_hash===fingerprint,'Identificador de envío reutilizado con otro contenido.',409);await c.commit();return;}
  const before=await entries(c),next=new Map(before.map(e=>[keyOf(e.bucket,e.key),e]));let ng=BigInt(locks[0].ng_number);
  for(const op of request.changes){const old=next.get(keyOf(op.bucket,op.key));
   requireValue((old?.version??null)===op.version,'Otro equipo modificó el registro. No se guardó ningún cambio. Actualiza y revisa tu captura.',409);
   const parameter=op.bucket==='bevelRecords'||op.bucket==='meta'&&op.key==='bevelCatalog';
   if(parameter){requireValue(parameterAccess||admin,'Autoriza Actualización de parámetros.',403);if(op.bucket==='meta'||old&&op.value!==null)requireValue(admin,'Modificar parámetros existentes o su catálogo requiere la clave administrativa.',403);}
   else{requireValue(admin||!old||old.value!==null,'Restaurar requiere administración.',403);authorize(op,old?.value,admin);}
   const value=structuredClone(op.value);if(op.bucket==='incidents'&&value&&!old?.value)value.folio='NG-S-'+String(++ng).padStart(8,'0');
   next.set(keyOf(op.bucket,op.key),{bucket:op.bucket,key:op.key,version:(old?.version??0)+1,value});
  }
  validate(next,request.changes,admin);
  const prior=new Map(before.map(e=>[keyOf(e.bucket,e.key),e]));
  for(const op of request.changes){const saved=next.get(keyOf(op.bucket,op.key)),old=prior.get(keyOf(op.bucket,op.key))?.value??null,json=saved.value===null?null:JSON.stringify(saved.value);
   await c.execute('INSERT INTO audit(request_id,bucket,entity_key,username,before_value,after_value) VALUES(?,?,?,?,?,?)',[request.requestId,op.bucket,op.key,user,old===null?null:JSON.stringify(old),json]);
   await c.execute('INSERT INTO documents(bucket,entity_key,value,version,updated_by) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE value=?,version=?,updated_by=?',[op.bucket,op.key,json,saved.version,user,json,saved.version,user]);
  }
  await c.execute('UPDATE save_lock SET ng_number=? WHERE id=1',[String(ng)]);
  await c.execute('INSERT INTO requests(request_id,username,payload_hash) VALUES(?,?,?)',[request.requestId,user,fingerprint]);
  await c.commit();
 }catch(error){await c.rollback().catch(()=>{});if(error.code==='ER_DUP_ENTRY'){error.status=409;error.message='Registro duplicado; no se guardó ningún cambio.';}throw error;}finally{c.release();}
}
