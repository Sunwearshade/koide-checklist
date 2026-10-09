export function mergeMeasurementBatch(state,batch){
 const next=structuredClone(state),d=next.skillMap??={version:1,records:[],employees:[],currentByEmployee:{},criteria:null};
 if((d.importBatches||[]).includes(batch.id))return {next,changed:false};
 const deleted=new Set((next.skillDeletedRecords||[]).filter(x=>x.source==='measurement').map(x=>x.record.id));
 for(const change of batch.revisions||[]){
  const old=d.records.find(r=>r.id===change.id);if(!old||old.origin==='captured'||deleted.has(change.id))continue;
  if(!Object.entries(change.expected).every(([key,value])=>(old[key]??null)===value))throw Error('La evaluación '+old.employee+' del '+old.day+' cambió después de preparar el ajuste. No se modificó el lote; revisa ese registro antes de importar.');
  Object.assign(old,structuredClone(change.set));for(const key of change.remove)delete old[key];
 }
 for(const incoming of batch.records){
  if(deleted.has(incoming.id))continue;
  const old=d.records.find(r=>r.id===incoming.id||r.employee===incoming.employee&&r.at===incoming.at);
  if(!old){d.records.push(structuredClone(incoming));continue}
  if(old.origin==='captured')continue;
  old.parts??=[];old.limits??=[];let changed=false;
  for(const p of incoming.parts){let part=old.parts.find(x=>x.part===p.part);if(!part){old.parts.push(structuredClone(p));changed=true;continue}part.answers??=[];
   for(const a of p.answers){let answer=part.answers.find(x=>x.dimension===a.dimension);if(!answer){part.answers.push(structuredClone(a));changed=true}else if(answer.value==null&&answer.judgment!=='NO APLICA'){Object.assign(answer,structuredClone(a));changed=true}}
  }
  for(const l of incoming.limits){let item=old.limits.find(x=>x.label===l.label);if(!item){old.limits.push(structuredClone(l));changed=true;continue}for(const side of ['min','max'])if(item[side]==null){for(const key of [side,side+'Judgment',side+'Practice'])if(l[key]!==undefined)item[key]=l[key];changed=true}}
  if(changed){old.detailComplete=incoming.detailComplete;old.practiceCompletion=incoming.practiceCompletion}
 }
 d.currentByEmployee={};const latest=new Map();
 for(const r of d.records){const old=latest.get(r.employee);if(!old||r.day>old.day||r.day===old.day&&String(r.at)>String(old.at))latest.set(r.employee,r);if(!d.employees.some(e=>e.employee===r.employee))d.employees.push({employee:r.employee,name:r.name,area:r.area,group:r.group})}
 for(const [employee,r] of latest)d.currentByEmployee[employee]=r.id;
 (d.importBatches??=[]).push(batch.id);for(const id of batch.supersedes||[])if(!d.importBatches.includes(id))d.importBatches.push(id);return {next,changed:true};
}
