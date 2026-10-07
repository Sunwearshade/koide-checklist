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
test('examen ponderado: captura válida y rechazo de score manipulado',()=>{
 const exam=defaults.exams[0],questions=exam.questions.map(q=>{const option=q.options[0];return {...q,selected:option.letter,points:option.points}}),earned=questions.reduce((s,q)=>s+q.points,0),max=questions.reduce((s,q)=>s+q.max,0);
 const r={id:'exam-1',employee:'1',name:'Persona',day:'2026-09-28',examId:exam.id,kind:exam.kind,area:exam.area,questions,earned,max,score:100*earned/max};
 assert.doesNotThrow(()=>validate(snapshot([op(r,'skillExams')]),[op(r,'skillExams')],false));r.score=0;assert.throws(()=>validate(snapshot([op(r,'skillExams')]),[],false),/Calificación/);
});
test('contraseñas hash con sal y cookie protegida',async()=>{
 const a=await passwordHash('Contraseña-larga-123'),b=await passwordHash('Contraseña-larga-123');assert.notEqual(a,b);assert(await verifyPassword('Contraseña-larga-123',a));assert(!await verifyPassword('Incorrecta',a));assert(cookie('x').includes('HttpOnly; Secure; SameSite=Strict'));await assert.rejects(passwordHash('corta'));
});
