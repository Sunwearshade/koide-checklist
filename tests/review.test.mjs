// Avisos de revisión («Posibles checklists faltantes»): cada transición de estado y sus rechazos.
import test from 'node:test';import assert from 'node:assert/strict';
import {validate,reviewTransition,reviewKey,keyOf,REVIEW_CONDITIONS} from '../src/rules.mjs';
const now=new Date('2026-10-16T18:00:00Z'),at=now.toISOString(),user='supervisor1';
const key=reviewKey('2026-10-15','B1','T2');
const start={condition:'pending',status:'Abierto',observation:'',reviewer:'',closeNote:''};
const pick=r=>Object.fromEntries(Object.keys(start).map(k=>[k,r?.[k]??start[k]]));
// Aplica una acción como lo hace la pantalla: copia el aviso, cambia campos y agrega una entrada al historial.
function act(old,action,changes,extra={}){
 const base=old?structuredClone(old):{id:key,day:'2026-10-15',machine:'B1',turn:'T2',...start,history:[]};
 const next={...base,...changes,updatedAt:at,updatedBy:user};
 if(action==='Cerrar'){next.status='Cerrado';next.closedAt=at;next.closedBy=user}
 next.history=[...base.history,{at,account:user,by:'Supervisor Uno',action,before:pick(old),after:pick(next),comment:''}];
 return Object.assign(next,extra);
}
const ctx={user,reviewer:true,records:[],now};
const check=(old,r,c={})=>{reviewTransition(old,r,{...ctx,...c});validate(new Map([[keyOf('gapReviews',key),{bucket:'gapReviews',key,version:1,value:r}]]),[],true,now)};

test('las cuatro condiciones existen y se distinguen de «sin determinar»',()=>{
 assert.deepEqual(Object.keys(REVIEW_CONDITIONS),['pending','no-anomalies','anomalies','not-performed','not-captured']);
});
test('Editar: crea el seguimiento sin duplicar y solo cambia observación o quién revisó',()=>{
 const edited=act(null,'Editar',{observation:'Se pidió el registro al turno 2',reviewer:'Juan Pérez'});
 assert.doesNotThrow(()=>check(null,edited));assert.equal(edited.condition,'pending');assert.equal(edited.status,'Abierto');
 assert.throws(()=>check(null,act(null,'Editar',{})),/solo cambia/,'Editar sin cambios');
 assert.throws(()=>check(null,act(null,'Editar',{condition:'no-anomalies'})),/solo cambia/,'Editar no cambia condición');
 assert.doesNotThrow(()=>check(edited,act(edited,'Editar',{reviewer:'María López'})),'segunda edición del mismo aviso');
});
test('Cambiar condición: cada una de las cuatro opciones, nunca de vuelta a «sin determinar»',()=>{
 for(const condition of ['no-anomalies','anomalies','not-performed','not-captured']){const r=act(null,'Cambiar condición',{condition});assert.doesNotThrow(()=>check(null,r),condition);}
 const first=act(null,'Cambiar condición',{condition:'anomalies'});
 assert.doesNotThrow(()=>check(first,act(first,'Cambiar condición',{condition:'not-performed'})),'corrección de condición');
 assert.throws(()=>check(first,act(first,'Cambiar condición',{condition:'pending'})),/distinta/);
 assert.throws(()=>check(first,act(first,'Cambiar condición',{condition:'anomalies'})),/distinta/,'misma condición');
 assert.throws(()=>check(null,act(null,'Cambiar condición',{condition:'revisada'})),/Condición/,'condición desconocida');
});
test('Cerrar: exige observación salvo «sin anomalías» y nunca cambia la condición',()=>{
 const pending=act(null,'Editar',{observation:'Sin respuesta del turno'});
 assert.throws(()=>check(pending,act(pending,'Cerrar',{})),/observación/,'cerrar sin determinar sin observación');
 const closedPending=act(pending,'Cerrar',{closeNote:'Se aclaró con el supervisor; no hubo captura'});
 assert.doesNotThrow(()=>check(pending,closedPending));assert.equal(closedPending.condition,'pending','cerrar no marca como revisada');
 assert.throws(()=>check(pending,act(pending,'Cerrar',{closeNote:'x',condition:'no-anomalies'})),/no cambia la condición/,'cerrar y marcar revisada a la vez');
 const ok=act(null,'Cambiar condición',{condition:'no-anomalies'});
 assert.doesNotThrow(()=>check(ok,act(ok,'Cerrar',{})),'sin anomalías se cierra sin observación');
 for(const condition of ['anomalies','not-performed','not-captured']){const c=act(null,'Cambiar condición',{condition});assert.throws(()=>check(c,act(c,'Cerrar',{})),/observación/,condition);assert.doesNotThrow(()=>check(c,act(c,'Cerrar',{closeNote:'Atendido'})),condition)}
 assert.throws(()=>check(closedPending,act(closedPending,'Editar',{observation:'después'})),/cerrado/,'aviso cerrado no se edita');
 assert.throws(()=>check(closedPending,act(closedPending,'Cambiar condición',{condition:'no-anomalies'})),/cerrado/,'aviso cerrado no cambia condición');
 assert.throws(()=>check(pending,act(pending,'Editar',{observation:'z',status:'Cerrado',closeNote:'x'},{closedAt:at,closedBy:user})),/solo cambia/,'cerrar con otra acción');
 assert.throws(()=>check(pending,act(pending,'Cambiar condición',{condition:'anomalies',status:'Cerrado',closeNote:'x'},{closedAt:at,closedBy:user})),/distinta|Cerrar/,'cerrar al cambiar condición');
});
test('Trazabilidad: historial solo de anexión, cuenta y hora del servidor, valores antes y después',()=>{
 const a=act(null,'Editar',{observation:'uno'}),b=act(a,'Cambiar condición',{condition:'anomalies'});
 assert.deepEqual(b.history.at(-1).before.condition,'pending');assert.deepEqual(b.history.at(-1).after.condition,'anomalies');
 assert.throws(()=>check(a,{...b,history:b.history.slice(1)}),/historial/i,'borrar historial');
 assert.throws(()=>check(a,{...b,history:[{...b.history[0],comment:'alterado'},b.history[1]]}),/historial/i,'alterar historial');
 assert.throws(()=>check(a,{...b,history:[...b.history.slice(0,-1),{...b.history.at(-1),account:'otra-cuenta'}]}),/tu cuenta/,'cuenta suplantada');
 assert.throws(()=>check(a,{...b,history:[...b.history.slice(0,-1),{...b.history.at(-1),at:'2026-01-01T00:00:00Z'}]}),/hora actual/,'hora falsa');
 assert.throws(()=>check(a,{...b,history:[...b.history.slice(0,-1),{...b.history.at(-1),before:{...b.history.at(-1).before,condition:'no-anomalies'}}]}),/no coincide/,'antes falso');
 assert.throws(()=>check(a,{...b,machine:'B2'}),/Solo se puede|inválido/,'cambiar máquina');
});
test('Permisos y origen del aviso',()=>{
 const r=act(null,'Editar',{observation:'x'});
 assert.throws(()=>check(null,r,{reviewer:false}),e=>e.status===403,'operador o acceso directo');
 assert.throws(()=>check(null,r,{records:[{machine:'B1',day:'2026-10-15',turn:'T2'}]}),/ya tiene recepción/,'turno con recepción');
 assert.throws(()=>check(null,r,{now:new Date('2026-10-16T04:00:00Z')}),/aún no termina/,'turno en curso (T2 termina 22:30)');
 assert.throws(()=>check(null,{...r,id:'GAP-otro'}),/inválido/,'clave distinta a fecha+máquina+turno');
});
