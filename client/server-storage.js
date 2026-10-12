let serverEntries=[],serverBaseline=null,serverSession=null,serverOutbox=null,serverBusy=false;
const apiURL=path=>new URL('api/'+path,location.href.endsWith('/')?location.href:new URL('.',location.href));
async function serverRequest(path,options={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
 try{let response=await fetch(apiURL(path),{credentials:'same-origin',cache:'no-store',...options,signal:controller.signal});let data=await response.json().catch(()=>({}));if(!response.ok){let error=Error(data.error||(response.status===401?'Actualiza la conexión al servidor.':'No se pudo completar la operación en el servidor.'));error.status=response.status;throw error}return data}
 catch(error){if(error.status)throw error;throw Error('No se pudo confirmar la conexión. Conserva la captura o reintenta el envío pendiente.')}finally{clearTimeout(timer)}
}
async function serverOpen(){
 if(location.protocol==='file:')throw Error('Esta versión requiere abrir la dirección HTTPS del servidor. No guarda registros al abrir el archivo directamente.');
 serverSession=await serverRequest('session');
 const directory=await serverRequest('employees');for(const key of Object.keys(ASSOCIATE_DIRECTORY))delete ASSOCIATE_DIRECTORY[key];Object.assign(ASSOCIATE_DIRECTORY,directory.employees);
 serverOutbox=await new Promise((resolve,reject)=>{let request=indexedDB.open('checklist-server-outbox-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('pending');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(Error('No se pudo preparar la recuperación de envíos. Habilita el almacenamiento del navegador.'))});
 return null;
}
function outbox(write,value){return new Promise((resolve,reject)=>{const tx=serverOutbox.transaction('pending',write?'readwrite':'readonly'),store=tx.objectStore('pending');let req=write?(value===null?store.delete(location.origin):store.put(value,location.origin)):store.get(location.origin);let result;req.onsuccess=()=>{result=req.result};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(Error('No se pudo conservar el envío en este equipo. No se envió la captura.'));tx.onabort=tx.onerror})}
async function serverRead(){let snapshot=await serverRequest('state');serverEntries=snapshot.entries;serverBaseline=stateFromEntries(serverEntries);return structuredClone(serverBaseline)}
async function serverCommit(next){
 if(serverBusy)throw Error('Hay un envío en curso. Espera a que termine.');
 if(!serverSession?.canWrite)throw Error('Tu cuenta no tiene permiso de captura.');
 serverBusy=true;
 try{if(await outbox(false))throw Error('Existe un envío pendiente. Usa «Reintentar envío» antes de guardar otro registro.');const changes=diffState(serverBaseline,next,serverEntries);if(!changes.length)return;const payload={requestId:crypto.randomUUID(),changes};await outbox(true,{user:serverSession.user,payload,created:new Date().toISOString()});await sendServerPending()}
 finally{serverBusy=false;await drawServerStatus()}
}
async function sendServerPending(){
 const pending=await outbox(false);if(!pending)return;
 serverSession=await serverRequest('session');if(pending.user!==serverSession.user)throw Error('El envío pendiente pertenece a otra cuenta del sistema. Debe reintentarlo la misma cuenta.');
 const parameters=pending.payload.changes.filter(op=>op.bucket==='bevelRecords'||op.bucket==='meta'&&op.key==='bevelCatalog');
 if(parameters.length){await ensureParameterSaveAccess('parameters');if(parameters.some(op=>op.bucket==='meta'||op.version!==null&&op.value!==null))await ensureParameterSaveAccess('admin');}
 await serverRequest('changes',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-TOKEN':serverSession.csrf},body:JSON.stringify(pending.payload)});
 // Keep the outbox until the fresh snapshot is fetched. A retry uses the same ID.
 const fresh=await serverRead();state=fresh;await outbox(true,null);
}
async function drawServerStatus(){let el=document.getElementById('serverStatus');if(!el)return;let pending=await outbox(false);el.innerHTML=`<span>Servidor · ${serverSession?.isAdmin?'Administración habilitada':'Acceso directo'} ${pending?'· Envío pendiente':''}</span><div class="actions"><button type="button" id="serverRefresh">Actualizar datos</button>${serverSession?.isAdmin?'<button type="button" id="serverLock">Bloquear administración</button>':''}${pending?'<button type="button" class="primary" id="serverRetry">Reintentar envío</button><button type="button" id="serverReview">Revisar pendiente</button>':''}</div>`;
 if($('serverLock'))$('serverLock').onclick=async()=>{try{serverSession=await serverRequest('admin/lock',{method:'POST',headers:{'X-CSRF-TOKEN':serverSession.csrf}});accessGrants={};adminKey='';await drawServerStatus();toast('Administración bloqueada.')}catch(e){toast(e.message)}};
 $('serverRefresh').onclick=()=>modal('Actualizar datos','<p>Se recargarán los registros del servidor. Los campos que aún no hayas guardado se perderán.</p><button id="serverRefreshConfirm" class="primary">Actualizar</button>')||null;
 const originalRefresh=$('serverRefresh').onclick;$('serverRefresh').onclick=()=>{originalRefresh();$('serverRefreshConfirm').onclick=()=>location.reload()};
 if(pending){$('serverRetry').onclick=async()=>{if(serverBusy)return;serverBusy=true;try{await sendServerPending();applyChecklistConfig();show(activeView);toast('El servidor confirmó el guardado.')}catch(e){toast(e.message)}finally{serverBusy=false;await drawServerStatus()}};
 $('serverReview').onclick=()=>{modal('Envío pendiente',`<p>Si hubo un cambio desde otro equipo, conserva una copia antes de retirar este envío y recargar los datos.</p><div class="actions"><button id="serverExportPending">Descargar copia del envío</button><button id="serverRemovePending" class="danger">Retirar envío pendiente</button></div>`);$('serverExportPending').onclick=()=>download('envio-pendiente-'+pending.payload.requestId+'.json',JSON.stringify(pending),'application/json');$('serverRemovePending').onclick=()=>{modal('Confirmar retiro','<p>Esto retira el reintento de este equipo; no elimina registros del servidor. Conserva la copia descargada para revisar o recuperar la captura.</p><button id="serverRemoveConfirm" class="danger">Retirar y recargar</button>');$('serverRemoveConfirm').onclick=async()=>{await outbox(true,null);location.reload()}}}}
}
function installServerControls(){let main=document.querySelector('.main');if(!document.getElementById('serverStatus'))main.insertAdjacentHTML('afterbegin','<section class="card" id="serverStatus" aria-live="polite"></section>');drawServerStatus().catch(e=>toast(e.message))}
async function serverInit(){try{await serverOpen();state=await serverRead();applyChecklistConfig();show('capture');installServerControls()}catch(error){$('view').innerHTML='<section class="card"><h2>No se inició la conexión al servidor</h2><p>'+esc(error.message)+'</p><p>No se guardarán registros hasta restablecer la conexión.</p><button onclick="location.reload()">Reintentar</button></section>'}}
function serverAccess(action,callback){
 modal('Acceso de administrador',`<form id="serverAdminForm"><p>${esc(action||'Introduce la clave para continuar.')}</p><label>Clave de acceso<input id="serverAdminPassword" type="password" autocomplete="current-password" required maxlength="256"></label><p id="serverAdminError" role="alert"></p><button class="primary" id="serverAdminSubmit">Continuar</button></form>`);
 $('serverAdminPassword').focus();
 $('serverAdminForm').onsubmit=async event=>{event.preventDefault();const button=$('serverAdminSubmit');button.disabled=true;try{serverSession=await serverRequest('session');serverSession=await serverRequest('admin/unlock',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-TOKEN':serverSession.csrf},body:JSON.stringify({password:$('serverAdminPassword').value})});$('serverAdminPassword').value='';$('modal').close();await drawServerStatus();callback('server-authorized')}catch(error){if($('serverAdminError'))$('serverAdminError').textContent=error.message}finally{if(button.isConnected)button.disabled=false}};
}
