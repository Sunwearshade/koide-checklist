import {isDeepStrictEqual as equal} from 'node:util';
import fs from 'node:fs';
export const defaults=JSON.parse(fs.readFileSync(new URL('../data/defaults.json',import.meta.url),'utf8'));
export class DomainError extends Error{constructor(status,message){super(message);this.status=status}}
export const requireValue=(ok,message,status=400)=>{if(!ok)throw new DomainError(status,message)};
export const keyOf=(bucket,key)=>JSON.stringify([bucket,key]);
const arr=x=>Array.isArray(x)?x:[];
const text=x=>typeof x==='string'&&x.trim().length>0;
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-7;
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!isNaN(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
// Fotos: vacías o una imagen JPG/PNG/WebP en base64 (lo mismo que acepta la restauración de respaldo del cliente).
// Cualquier otro texto en `photo` se rechaza: se pinta como <img src> y sería una vía de XSS.
const photoOk=x=>x===undefined||x===null||x===''||typeof x==='string'&&x.length<=12*1024*1024&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(x);
const photosOk=r=>[r,...arr(r.answers),...arr(r.events)].every(x=>!x||typeof x!=='object'||photoOk(x.photo));
// Límites para cuentas sin administración (incluido el acceso directo): una captura normal es de pocos KB.
export const limits={changes:200,document:512*1024};
const buckets=['bevelRecords','records','assignments','incidents','skillExams','skillMap.records','skillMap.employees','skillMap.meta','meta'];
export function checkRequest(request){
 requireValue(request&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.requestId)&&Array.isArray(request.changes)&&request.changes.length>0&&request.changes.length<=20000,'Solicitud inválida.');
 const seen=new Set();
 for(const op of request.changes){
  requireValue(op&&buckets.includes(op.bucket)&&typeof op.key==='string'&&op.key.length<=160&&/^[A-Za-z0-9-]+$/.test(op.key)&&!seen.has(keyOf(op.bucket,op.key)),'Identificador inválido o duplicado.');seen.add(keyOf(op.bucket,op.key));
  requireValue(op.version===null||(Number.isSafeInteger(op.version)&&op.version>0),'Versión inválida.');
  requireValue(op.value===null||typeof op.value==='object'&&op.value!==undefined,'Contenido inválido.');
  if(op.bucket==='meta')requireValue(['bevelCatalog','checklistConfig','customImages','checklistChanges','skillExamCatalog','skillDeletedRecords'].includes(op.key),'Configuración desconocida.');
  if(op.bucket==='skillMap.meta')requireValue(op.key==='settings','Configuración desconocida.');
 }
}
export function authorize(op,old,admin){
 if(admin)return;
 requireValue(op.value!==null,'Eliminar requiere administración.',403);
 if(op.bucket==='skillMap.employees')return;
 if(!old&&['records','incidents','skillExams','skillMap.records'].includes(op.bucket))return;
 if(op.bucket==='records'&&old?.operation==='Sin operación programada'&&!arr(old.answers).length){
  requireValue(op.value.operation!=='Sin operación programada'&&arr(op.value.answers).length>0&&['id','machine','day','turn'].every(k=>old[k]===op.value[k])&&equal(old,op.value.initialStop),'La reactivación debe conservar el paro original.');return;
 }
 if(op.bucket==='incidents'&&old){
  if(op.value.status==='Reparada'&&!['Reparada','Cerrada','Corregida'].includes(old.status)){
   const after=op.value,allowed=['status','repairedAt','closed','repairedBy','repairEmployee','repairActivity','owner','events'];
   const a=Object.fromEntries(Object.entries(old).filter(([k])=>!allowed.includes(k))),b=Object.fromEntries(Object.entries(after).filter(([k])=>!allowed.includes(k)));
   const prior=arr(old.events),events=arr(after.events),event=events.at(-1);
   if(equal(a,b)&&text(after.repairedBy)&&text(after.repairEmployee)&&text(after.repairActivity)&&text(after.repairedAt)&&!isNaN(Date.parse(after.repairedAt))&&after.closed===after.repairedAt&&after.owner===after.repairedBy&&events.length===prior.length+1&&prior.every((e,i)=>equal(e,events[i]))&&event.action==='Reparada'&&event.by===after.repairedBy&&event.employee===after.repairEmployee&&event.comment===after.repairActivity&&event.at===after.repairedAt)return;
  }
  const {events:before=[],...a}=old,{events:after=[],...b}=op.value;
  if(equal(a,b)&&Array.isArray(after)&&after.length>before.length&&before.every((e,i)=>equal(e,after[i]))&&after.slice(before.length).every(e=>e.action==='Persiste en recepción'&&text(e.comment)))return;
 }
 throw new DomainError(403,'Esta modificación requiere administración.');
}
export function operationalTime(now=new Date()){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
 const minutes=Number(p.hour)*60+Number(p.minute),d=new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`);if(minutes<420)d.setUTCDate(d.getUTCDate()-1);
 return {day:d.toISOString().slice(0,10),turn:minutes>=420&&minutes<900?'T1':minutes>=900&&minutes<1350?'T2':'T3'};
}
export function validate(entries,changes,admin,now=new Date()){
 const get=(b,k)=>entries.get(keyOf(b,k))?.value;
 const receipts=new Set();
 for(const {bucket,key,value:r} of entries.values()){
  if(r===null)continue;
  if(['records','incidents','skillExams','skillMap.records'].includes(bucket))requireValue(r.id===key,'Identificador de registro inconsistente.');
  if(['records','incidents'].includes(bucket))requireValue(photosOk(r),'Foto inválida: solo se aceptan imágenes JPG, PNG o WebP.');
  if(bucket==='bevelRecords')requireValue(r.id===key&&/^Máquina Biseladora ([1-9]|1[0-9]|20)$/.test(r.machine)&&text(r.partNumber)&&/^[A-Za-z0-9._ /-]+$/.test(r.partNumber)&&typeof r.timestamp==='string'&&!isNaN(Date.parse(r.timestamp))&&['motorSpindle','camShaft','dimOD','dimID','dimLength'].every(k=>Number.isFinite(r[k])&&r[k]>=0)&&r.dimOD>r.dimID&&r.dimLength>0&&typeof r.notes==='string'&&r.notes.length<=2000,'Parámetros de biselado inválidos.');
  if(bucket==='meta'&&key==='bevelCatalog')requireValue(!Array.isArray(r)&&Object.entries(r).every(([sku,p])=>/^[A-Za-z0-9._ /-]+$/.test(sku)&&p&&typeof p.raw==='string'&&typeof p.issue==='string'&&Array.isArray(p.dims)&&p.dims.length===3&&p.dims.every(d=>typeof d==='string')),'Catálogo de partes inválido.');
  if(bucket==='skillMap.employees')requireValue(r.employee===key&&text(r.name),'Asociado inválido.');
  if(['records','skillExams','skillMap.records'].includes(bucket))requireValue(text(r.employee)&&text(r.name)&&day(r.day),'Fecha o asociado incompleto.');
  if(bucket==='records'){
   requireValue(defaults.machines.some(m=>m.id===r.machine)&&['T1','T2','T3'].includes(r.turn),'Máquina o turno inválido.');
   const receipt=keyOf(r.machine,r.day+'|'+r.turn);requireValue(!receipts.has(receipt),'Ya existe recepción para esa máquina, fecha y turno.',409);receipts.add(receipt);
   const answers=arr(r.answers),stopped=r.operation==='Sin operación programada';
   requireValue(stopped||['En operación / por iniciar','Detenida por anomalía'].includes(r.operation),'Situación inválida.');
   requireValue(stopped?answers.length===0&&text(r.reason)&&text(r.detail):answers.length>0,'Completa el checklist o el motivo y detalle del paro.');
   requireValue(new Set(answers.map(a=>a.pointId)).size===answers.length,'Puntos duplicados.');
   for(const a of answers){requireValue(['OK','NG'].includes(a.value),'Respuesta inválida.');if(a.value==='NG')requireValue(text(a.comment)&&get('incidents',a.incidentId)?.machine===r.machine,'Cada NG requiere comentario e incidencia de la misma máquina.');}
   if(answers.some(a=>a.pointId==='caliper'))requireValue(text(r.caliperCode),'Falta código de caliper.');
   if(r.operation==='Detenida por anomalía')requireValue(answers.some(a=>a.value==='NG'),'La anomalía requiere un punto NG.');
  }
  if(bucket==='skillExams'){
   requireValue(arr(r.questions).length>0,'Examen sin preguntas.');let earned=0,max=0;
   for(const q of r.questions){requireValue(Number.isFinite(q.points)&&Number.isFinite(q.max)&&q.max>0&&q.points>=0&&q.points<=q.max&&arr(q.options).some(o=>o.letter===q.selected&&close(o.points,q.points)),'Puntaje o respuesta inválidos.');earned+=q.points;max+=q.max;}
   requireValue(close(earned,r.earned)&&close(max,r.max)&&close(100*earned/max,r.score),'Calificación inconsistente.');
  }
  if(bucket==='skillMap.records'&&r.score!=null)requireValue(Number.isFinite(r.score)&&r.score>=0&&r.score<=100,'Calificación inválida.');
 }
 if(admin)return;
 const time=operationalTime(now);
 requireValue(changes.length<=limits.changes,'Demasiados cambios en un solo envío.',413);
 for(const op of changes){const r=op.value;if(!r)continue;
  requireValue(JSON.stringify(r).length<=limits.document,'Registro demasiado grande.',413);
  // Una incidencia nueva sin administración solo nace de un NG de una recepción nueva del mismo envío, abierta y sin historial.
  if(op.bucket==='incidents'&&op.version===null){
   const source=changes.find(c=>c.bucket==='records'&&c.value&&c.key===r.recordId),answer=arr(source?.value.answers).find(a=>a.value==='NG'&&a.incidentId===op.key);
   requireValue(source&&answer&&r.status==='Abierta'&&r.owner===''&&arr(r.events).length===0&&['machine','day','turn'].every(k=>r[k]===source.value[k])&&r.pointId===answer.pointId,'La incidencia debe nacer de un NG de esta recepción.',403);
  }
  if(op.bucket==='records'){
   requireValue(r.day===time.day&&r.turn===time.turn,'La fecha o turno no coincide con el servidor.');if(r.operation==='Sin operación programada')continue;
   const type=defaults.machines.find(m=>m.id===r.machine).type,points=get('meta','checklistConfig')?.[type]?.items??defaults.checklists[type];
   const required=points.filter(p=>p.active!==false&&(!p.shift||p.shift==='General'||p.shift===r.turn)).map(p=>p.id).sort();
   requireValue(equal(required,r.answers.map(a=>a.pointId).sort()),'El checklist cambió o faltan puntos del turno. Actualiza los datos.');
  }
  if(op.bucket==='skillExams'){
   const catalog=get('meta','skillExamCatalog')??defaults.exams,exam=arr(catalog).find(e=>e.id===r.examId);
   requireValue(exam&&exam.kind===r.kind&&exam.area===r.area&&exam.questions.length===r.questions.length&&exam.questions.length>0,'El examen cambió o no se reconoce.');
   for(let i=0;i<exam.questions.length;i++){const q=exam.questions[i],a=r.questions[i],weight=q.weight??q.max,selected=q.options.find(o=>o.letter===a.selected);requireValue(q.id===a.id&&q.text===a.text&&close(weight,a.max)&&selected,'Reactivo o ponderación modificados.');const raw=selected.points??({A:10,B:8,C:6,D:0}[selected.letter]);requireValue(close(raw/q.max*weight,a.points),'Puntaje diferente al autorizado.');}
  }
  if(op.bucket==='skillMap.records')validateMeasurement(r,get('skillMap.meta','settings')?.criteria);
 }
}
export function validateMeasurement(r,profile){
 requireValue(r.scoreBasis==='answers'&&r.origin==='captured','Importar calificaciones requiere administración.');
 requireValue(profile?.approved===true&&equal(profile,r.criteria),'Criterios no autorizados o desactualizados.');
 const definition=defaults.measurement,parts=arr(r.parts),omit=['Prensa','CNC','Corte'].includes(r.area);let ok=0,total=0;
 requireValue(parts.length===definition.parts.length,'Faltan piezas.');
 parts.forEach((p,i)=>{requireValue(p.part===definition.parts[i]&&arr(p.answers).length===definition.dimensions.length,'Pieza incompleta.');p.answers.forEach((a,j)=>{
  requireValue(a.dimension===definition.dimensions[j],'Dimensión inválida.');if(omit&&j>=4){requireValue(a.judgment==='NO APLICA','Bisel no aplica.');return;}
  requireValue(a.min===profile.bounds?.[i]?.[j]?.[0]&&a.max===profile.bounds?.[i]?.[j]?.[1]&&[a.value,a.min,a.max].every(Number.isFinite)&&a.min<=a.max,'Tolerancia o medida inválida.');
  const correct=a.value>=a.min-1e-9&&a.value<=a.max+1e-9;requireValue(a.judgment===(correct?'OK':'NG'),'Juicio de medición inconsistente.');if(correct)ok++;total++;
 })});
 requireValue(arr(r.limits).length===definition.limits.length,'Faltan ejercicios de límites.');
 r.limits.forEach((l,i)=>{const e=definition.limits[i];requireValue(l.label===e.label&&l.minExpected===e.min&&l.maxExpected===e.max,'Límites esperados inválidos.');for(const side of ['min','max']){requireValue(Number.isFinite(l[side]),'Límite inválido.');const correct=Math.abs(l[side]-e[side])<=.0001;requireValue(l[side+'Judgment']===(correct?'OK':'NG'),'Cálculo inconsistente.');if(correct)ok++;total++;}});
 requireValue(total>0&&close(100*ok/total,r.score),'Calificación inconsistente.');
}
