export const ENTITY_BUCKETS={'bevelRecords':'id','records':'id','assignments':'id','incidents':'id','skillExams':'id','skillMap.records':'id','skillMap.employees':'employee'};
export const META_KEYS=['bevelCatalog','checklistConfig','customImages','checklistChanges','skillExamCatalog','skillDeletedRecords'];
export function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value)}
export function docKey(bucket,key){return JSON.stringify([bucket,String(key)])}
export function flattenState(state){
 const docs=new Map();
 for(const [bucket,idField]of Object.entries(ENTITY_BUCKETS)){
  const rows=bucket.startsWith('skillMap.')?state.skillMap?.[bucket.split('.')[1]]:state[bucket];
  if(rows!==undefined&&!Array.isArray(rows))throw Error('Lista inválida: '+bucket);
  for(const row of rows||[]){const key=String(row[idField]??'');if(!key||docs.has(docKey(bucket,key)))throw Error('Identificador faltante o duplicado: '+bucket);docs.set(docKey(bucket,key),{bucket,key,value:structuredClone(row)})}
 }
 for(const key of META_KEYS)if(state[key]!==undefined)docs.set(docKey('meta',key),{bucket:'meta',key,value:structuredClone(state[key])});
 if(state.skillMap){let settings=structuredClone(state.skillMap);delete settings.records;delete settings.employees;delete settings.currentByEmployee;docs.set(docKey('skillMap.meta','settings'),{bucket:'skillMap.meta',key:'settings',value:settings})}
 return docs;
}
export function stateFromEntries(entries){
 const result={bevelRecords:[],records:[],assignments:[],incidents:[],skillExams:[],skillMap:{version:1,records:[],employees:[],currentByEmployee:{},criteria:null}};
 for(const e of entries){if(e.value===null)continue;if(ENTITY_BUCKETS[e.bucket]){if(e.bucket.startsWith('skillMap.'))result.skillMap[e.bucket.split('.')[1]].push(structuredClone(e.value));else result[e.bucket].push(structuredClone(e.value))}else if(e.bucket==='meta'&&META_KEYS.includes(e.key))result[e.key]=structuredClone(e.value);else if(e.bucket==='skillMap.meta')Object.assign(result.skillMap,structuredClone(e.value))}
 // Current result is derived from records, never from a client's stale pointer.
 result.skillMap.currentByEmployee={};
 const latest=new Map();for(const r of result.skillMap.records){let old=latest.get(r.employee);if(!old||r.day>old.day||r.day===old.day&&String(r.at)>=String(old.at))latest.set(r.employee,r)}
 for(const [employee,r]of latest)result.skillMap.currentByEmployee[employee]=r.id;
 for(const bucket of ['records','incidents','skillExams'])result[bucket].sort((a,b)=>String(a.at||a.created||'').localeCompare(String(b.at||b.created||''))||String(a.id).localeCompare(String(b.id)));
 return result;
}
export function diffState(base,next,entries){
 const before=flattenState(base),after=flattenState(next),versions=new Map(entries.map(e=>[docKey(e.bucket,e.key),e.version])),changes=[];
 for(const key of new Set([...before.keys(),...after.keys()])){const a=before.get(key),b=after.get(key);if(canonical(a?.value??null)===canonical(b?.value??null))continue;const item=b||a;changes.push({bucket:item.bucket,key:item.key,version:versions.get(key)??null,value:b?.value??null})}
 return changes;
}
