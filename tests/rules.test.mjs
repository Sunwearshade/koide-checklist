import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {checkRequest,authorize,validate,keyOf,defaults,operationalTime} from '../src/rules.mjs';
import {passwordHash,verifyPassword,cookie} from '../src/auth.mjs';
const op=(value,bucket='records')=>({bucket,key:value.id,version:null,value});
const snapshot=ops=>new Map(ops.map(o=>[keyOf(o.bucket,o.key),{...o,version:1}]));
const stop={id:'r1',employee:'1',name:'Persona',machine:'B1',day:'2026-09-28',turn:'T1',operation:'Sin operación programada',answers:[],reason:'Mantenimiento',detail:'Cambio de herramienta'};
test('solicitudes rechazan versión, claves duplicadas y configuración no permitida',()=>{
 const good={requestId:randomUUID(),changes:[op(stop)]};assert.doesNotThrow(()=>checkRequest(good));
 assert.throws(()=>checkRequest({...good,changes:[op(stop),op(stop)]}));assert.throws(()=>checkRequest({...good,changes:[{...op(stop),version:0}]}));assert.throws(()=>checkRequest({...good,changes:[{bucket:'meta',key:'arbitrary',version:null,value:{}}]}));
});
test('turnos y fecha operativa de México: 07:00, 15:00 y 22:30',()=>{
 assert.deepEqual(operationalTime(new Date('2026-09-28T12:59:00Z')),{day:'2026-09-27',turn:'T3'});
 assert.deepEqual(operationalTime(new Date('2026-09-28T13:00:00Z')),{day:'2026-09-28',turn:'T1'});
 assert.equal(operationalTime(new Date('2026-09-28T21:00:00Z')).turn,'T2');assert.equal(operationalTime(new Date('2026-09-29T04:30:00Z')).turn,'T3');
});
test('recepciones únicas y reactivación conservando paro',()=>{
 assert.doesNotThrow(()=>validate(snapshot([op(stop)]),[],true));assert.throws(()=>validate(snapshot([op(stop),op({...stop,id:'r2'})]),[],true),/Ya existe/);
 const resumed={...stop,operation:'En operación / por iniciar',answers:[{pointId:'1',value:'OK'}],initialStop:stop};assert.doesNotThrow(()=>authorize(op(resumed),stop,false));assert.throws(()=>authorize(op({...resumed,initialStop:{}}),stop,false));assert.throws(()=>authorize({...op(stop),value:null},stop,false));
});
test('puntos comunes y de turno se validan en el servidor',()=>{
 const r={...stop,operation:'En operación / por iniciar',answers:[{pointId:'1',value:'OK'},{pointId:'2',value:'OK'}]};
 const config={bucket:'meta',key:'checklistConfig',version:1,value:{B:{items:[{id:'1',shift:'General'},{id:'2',shift:'T1'},{id:'3',shift:'T2'}]}}};
 assert.doesNotThrow(()=>validate(snapshot([op(r),config]),[op(r)],false,new Date('2026-09-28T14:00:00Z')));
 r.answers.pop();assert.throws(()=>validate(snapshot([op(r),config]),[op(r)],false,new Date('2026-09-28T14:00:00Z')),/faltan/);
});
test('captura sin administración: fotos solo como imagen, incidencias nacen de un NG y límites de tamaño',()=>{
 const at=new Date('2026-09-28T14:00:00Z'),config={bucket:'meta',key:'checklistConfig',version:1,value:{B:{items:[{id:'1',shift:'General'}]}}};
 const ng={...stop,id:'r9',operation:'Detenida por anomalía',answers:[{pointId:'1',value:'NG',comment:'Fuga',incidentId:'i9',photo:''}]};
 const inc={id:'i9',machine:'B1',type:'B',pointId:'1',title:'Punto',comment:'Fuga',photo:'',created:'2026-09-28T14:00:00Z',day:'2026-09-28',turn:'T1',status:'Abierta',owner:'',recordId:'r9',events:[]};
 const run=(r,i)=>validate(snapshot([op(r),op(i,'incidents'),config]),[op(r),op(i,'incidents')],false,at);
 assert.doesNotThrow(()=>run(ng,inc));
 // XSS en photo (se pinta como <img src>): rechazado en registro, incidencia o evento.
 const xss='x" onerror="alert(1)';
 assert.throws(()=>run({...ng,answers:[{...ng.answers[0],photo:xss}]},inc),/Foto inválida/);
 assert.throws(()=>run(ng,{...inc,photo:xss}),/Foto inválida/);
 assert.throws(()=>run(ng,{...inc,events:[{action:'x',photo:'javascript:alert(1)'}]}),/Foto inválida/);
 assert.doesNotThrow(()=>run(ng,{...inc,photo:'data:image/png;base64,iVBORw0KGgo='}));
 // La incidencia debe ser abierta, sin historial y de la misma recepción, máquina y punto.
 for(const bad of [{status:'Cerrada'},{owner:'Alguien'},{events:[{action:'Reparada'}]},{recordId:'otro'},{pointId:'2'},{day:'2026-09-27'}])assert.throws(()=>run(ng,{...inc,...bad}),/nacer de un NG/,JSON.stringify(bad));
 assert.throws(()=>validate(snapshot([op(inc,'incidents')]),[op(inc,'incidents')],false,at),/nacer de un NG/);
 // Límites: documento enorme o demasiados cambios.
 assert.throws(()=>run({...ng,extra:'x'.repeat(600*1024)},inc),/demasiado grande/);
 assert.throws(()=>validate(new Map(),Array.from({length:201},(_,i)=>({bucket:'records',key:'k'+i,version:null,value:null})),false,at),/Demasiados/);
 // Administración no tiene estos límites de flujo (correcciones, restauración).
 assert.doesNotThrow(()=>validate(snapshot([op(ng),op({...inc,status:'Cerrada'},'incidents'),config]),[],true,at));
});
test('examen ponderado: captura válida y rechazo de score manipulado',()=>{
 const exam=defaults.exams[0],questions=exam.questions.map(q=>{const option=q.options[0];return {...q,selected:option.letter,points:option.points}}),earned=questions.reduce((s,q)=>s+q.points,0),max=questions.reduce((s,q)=>s+q.max,0);
 const r={id:'exam-1',employee:'1',name:'Persona',day:'2026-09-28',examId:exam.id,kind:exam.kind,area:exam.area,questions,earned,max,score:100*earned/max};
 assert.doesNotThrow(()=>validate(snapshot([op(r,'skillExams')]),[op(r,'skillExams')],false));r.score=0;assert.throws(()=>validate(snapshot([op(r,'skillExams')]),[],false),/Calificación/);
});
test('contraseñas hash con sal y cookie protegida',async()=>{
 const a=await passwordHash('Contraseña-larga-123'),b=await passwordHash('Contraseña-larga-123');assert.notEqual(a,b);assert(await verifyPassword('Contraseña-larga-123',a));assert(!await verifyPassword('Incorrecta',a));assert(cookie('x').includes('HttpOnly; Secure; SameSite=Strict'));await assert.rejects(passwordHash('corta'));
});

test('reparar incidencia conserva origen, responsable e historial',()=>{
 const before={id:'ng1',machine:'B1',status:'Abierta',comment:'Sin placa',events:[]},at='2026-10-08T12:00:00Z';
 const repaired={...before,status:'Reparada',repairedAt:at,closed:at,repairedBy:'Persona',repairEmployee:'70',repairActivity:'Colocó placa',owner:'Persona',events:[{action:'Reparada',at,by:'Persona',employee:'70',comment:'Colocó placa'}]};
 assert.doesNotThrow(()=>authorize(op(repaired,'incidents'),before,false));assert.throws(()=>authorize(op({...repaired,machine:'B2'},'incidents'),before,false));assert.throws(()=>authorize(op({...repaired,repairEmployee:''},'incidents'),before,false));
});
test('parámetros: campos numéricos y dimensiones coherentes',()=>{
 const r={id:'REC-1',machine:'Máquina Biseladora 1',partNumber:'SKU-1',timestamp:'2026-10-08T12:00:00Z',motorSpindle:1500,camShaft:45,dimOD:84.2,dimID:72.4,dimLength:98,notes:''};
 assert.doesNotThrow(()=>validate(snapshot([op(r,'bevelRecords')]),[],false));
 for(const bad of [{dimID:90},{motorSpindle:-1},{dimLength:0},{machine:'Otra'},{timestamp:'ayer'},{partNumber:'<script>'}])assert.throws(()=>validate(snapshot([op({...r,...bad},'bevelRecords')]),[],false));
});
