import { h, dialog, toast, downloadBlob, safeFileName } from './dom.js';
import { encodePaintDocument, decodePaintDocument } from './paintfile.js';

let dbPromise;
function db() { return dbPromise||(dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open('ugs-recovery',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);})); }
async function local(mode,fn) { const d=await db(); return new Promise((resolve,reject)=>{const t=d.transaction('drafts',mode);const r=fn(t.objectStore('drafts'));t.oncomplete=()=>resolve(r.result);t.onerror=()=>reject(t.error);}); }
async function api(path,options) {const r=await fetch('/api/recovery'+path,{...options,headers:{'X-UG-Studio':'1',...options?.headers},credentials:'same-origin'});if(!r.ok)throw new Error('Recuperación en disco: '+r.status);return r;}
export class Recovery {
  constructor(app) {
    this.app=app;this.pending=new Map();this.timers=new Map();this.status='';this.revisions=new Map();
    this.server=app.store.kind==='server';
    app.editor.on('change',()=>this.schedule('project'));
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.flush();});
    window.addEventListener('pagehide',()=>this.flush());
  }
  schedule(kind) {
    if(this.timers.has(kind))return;
    this.timers.set(kind,setTimeout(()=>{this.timers.delete(kind);this.capture(kind);},kind==='project'?300:700));
  }
  async capture(kind) {
    const app=this.app;let key,blob,name,revision,projectId=app.editor.projectId;
    try {
      if(kind==='project') {if(!app.editor.project)return;key='project-'+app.store.kind+'-'+projectId;name=app.editor.project.name;blob=new Blob([JSON.stringify(app.editor.project)],{type:'application/json'});}
      else if(kind==='art') {const p=app.paint;if(!p.doc)return;key=p.doc.recoveryKey||(p.doc.recoveryKey='art-'+crypto.randomUUID());name=p.doc.name;blob=encodePaintDocument(p.doc,p.palette);}
      else if(kind==='documents') {const p=app.documents;if(!p?.current)return;key=p.current.recoveryKey||(p.current.recoveryKey='document-'+crypto.randomUUID());name=p.current.name;revision=(this.revisions.get(key)||0)+1;this.revisions.set(key,revision);blob=await p.snapshot();if(this.revisions.get(key)!==revision)return;}
      else return;
      const entry={key,kind,name,projectId,modified:Date.now(),blob};
      // Serializar por documento: una codificación antigua no puede sobrescribir una nueva.
      const prior=this.pending.get(key)||Promise.resolve();
      const next=prior.catch(()=>{}).then(async()=>{
        if(revision&&this.revisions.get(key)!==revision)return;
        await local('readwrite',s=>s.put(entry));
        if(this.server)await api('?key='+encodeURIComponent(key)+'&kind='+kind+'&name='+encodeURIComponent(name)+'&project='+encodeURIComponent(projectId||''),{method:'PUT',body:blob});
        this.status='Copia de recuperación: '+new Date(entry.modified).toLocaleTimeString();this.paintStatus();
      });this.pending.set(key,next);await next;if(this.pending.get(key)===next)this.pending.delete(key);
    } catch(e) {this.status='⚠ No se pudo guardar la recuperación: '+e.message;this.paintStatus();if(!this.warned){toast(this.status,'error',9000);this.warned=true;}}
  }
  paintStatus(){const el=document.getElementById('recovery-state');if(el){el.textContent=this.status;el.title=this.status;}}
  flush(){for(const [kind,timer] of this.timers){clearTimeout(timer);this.timers.delete(kind);this.capture(kind);}}
  async list() {
    const rows=await local('readonly',s=>s.getAll());const byKey=new Map(rows.map(r=>[r.key,r]));
    if(this.server){try{const remote=await(await api('',{})).json();for(const row of remote.drafts)if(!byKey.has(row.key)||byKey.get(row.key).modified<row.modified)byKey.set(row.key,row);}catch{}}
    return [...byKey.values()].sort((a,b)=>b.modified-a.modified);
  }
  async body(row){return row.blob||await(await api('?key='+encodeURIComponent(row.key),{})).blob();}
  async restore(row) {
    const app=this.app,blob=await this.body(row);
    if(row.kind==='art') {
      if(!(await app.paint.confirmDiscard()))return;
      const loaded=await decodePaintDocument(blob);loaded.doc.recoveryKey=row.key;app.paint.setDoc(loaded.doc);if(loaded.palette.length)app.paint.setPalette(loaded.palette,'__custom');app.paint.doc.dirty=true;app.selectTab('art');
    } else if(row.kind==='documents') {await app.documents.restore(blob,row);app.selectTab('documents');}
    else {
      await this.capture('art');
      if(app.editor.project){app.code?.commit.flush();await app.editor.save();}
      // Reabrir el proyecto original conserva sus archivos; aplicar una copia validada conserva la revisión recuperable.
      const p=window.UGStudio.schema.cleanProject(JSON.parse(await blob.text()));
      const existing=await app.store.list();
      if(existing.some(p=>p.id===row.projectId))await app.editor.open(row.projectId);
      else {const id=await app.store.create(p);await app.editor.open(id);}
      app.editor.edit('Recuperar revisión',()=>{app.editor.project=p;},'project');app.editor.sceneId=p.startScene||p.scenes[0]?.id;app.editor.emit('project');app.editor.emit('scene');app.selectTab('scene');
    }
    toast('Copia recuperada. El archivo de recuperación sigue disponible.','ok');
  }
  async manager() {
    try {
      const rows=await this.list();
      const row=await dialog('Recuperar trabajo',b=>{
        b.append(h('p.help','Puedes restaurar estas copias ahora o más adelante. Se guardan automáticamente y no se eliminan al cerrar el estudio.'));
        if(!rows.length)b.append(h('p','Todavía no hay copias. Se crean al editar.'));
        const select=h('select',{size:Math.min(8,Math.max(2,rows.length)),'aria-label':'Copias de recuperación',style:{width:'100%'}});
        rows.forEach((r,i)=>select.append(h('option',{value:i},({art:'Arte',project:'Proyecto',documents:'Documento'}[r.kind]||r.kind)+' · '+r.name+' · '+new Date(r.modified).toLocaleString())));b.append(select);this.choice=select;
      },[{label:'Más tarde',value:null},{label:'Descargar copia',value:'download'},{label:'Recuperar',kind:'primary',value:'restore'}]);
      if(!row||!rows.length)return;const selected=rows[Number(this.choice.value)||0];
      if(row==='restore')await this.restore(selected);else downloadBlob(await this.body(selected),safeFileName(selected.name)+(selected.kind==='art'?'.ugart':selected.kind==='project'?'.ugs-recovery.json':'.ugdoc'));
    }catch(e){toast('No se pudo recuperar: '+e.message,'error');}
  }
  async announce() {try{const rows=await this.list();if(rows.length)toast('Hay '+rows.length+' copias de trabajo disponibles en Archivo → Recuperar trabajo. Puedes cargarlas cuando quieras.','ok',12000);}catch{}}
}
