/* UltraGame Studio · almacenamiento de proyectos.
 *  - ServerStore: servidor local del Studio (tools/studio-server.js): proyectos en disco, exportación a carpeta.
 *  - LocalStore: IndexedDB del navegador (cuando el Studio se abre sin su servidor, p. ej. con tools/server.js).
 * Misma interfaz: list, create, load, save, remove, listAssets, putAsset, assetData, assetURL, deleteAsset. */

const API_HEADERS = { 'X-UG-Studio': '1' };
async function api(path, opts) {
  const r = await fetch(path, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, opts || {}, { headers: Object.assign({}, API_HEADERS, (opts && opts.headers) || {}) }));
  if (!r.ok) { let msg = r.status + ' ' + r.statusText; try { const j = await r.json(); if (j && j.error) msg = j.error; } catch (e) { /* sin cuerpo */ } throw new Error(msg); }
  return r;
}
const q = (o) => Object.keys(o).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&');

export class ServerStore {
  constructor(info) { this.kind = 'server'; this.info = info; this.label = 'Disco: ' + info.workspace; }
  static async detect() {
    try { const r = await api('/api/info'); const j = await r.json(); if (j && j.app === 'UltraGame Studio') return new ServerStore(j); } catch (e) { /* sin servidor o sin sesión */ }
    return null;
  }
  async list() { return (await (await api('/api/projects')).json()).projects; }
  async create(project) { return (await (await api('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project }) })).json()).id; }
  async load(id) { return (await api('/api/project?' + q({ p: id }))).json(); }
  async save(id, project) { await api('/api/project?' + q({ p: id }), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project) }); }
  async remove(id) { await api('/api/project?' + q({ p: id }), { method: 'DELETE' }); }
  async listAssets(id) { return (await (await api('/api/assets?' + q({ p: id }))).json()).assets; }
  async putAsset(id, file, blob) { await api('/api/file?' + q({ p: id, f: file }), { method: 'PUT', body: blob }); }
  async deleteAsset(id, file) { await api('/api/file?' + q({ p: id, f: file }), { method: 'DELETE' }); }
  assetURL(id, file, version) { return '/api/file?' + q({ p: id, f: file }) + (version ? '&v=' + version : ''); }
  async assetData(id, file) { return (await fetch(this.assetURL(id, file), { credentials: 'same-origin', cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error('No se pudo leer ' + file); return r; })).arrayBuffer(); }
  get canExportFolder() { return true; }
  async exportFolder(id, files) { return (await api('/api/export?' + q({ p: id }), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) })).json(); }
  async reveal(id, what) { await api('/api/reveal?' + q({ p: id, what: what || 'project' }), { method: 'POST' }); }
  /* backend del juego en modo desarrollo (Node en 127.0.0.1, aislado) */
  get canRunBackend() { return true; }
  async backendStart(id, files) { return (await api('/api/backend/start?' + q({ p: id }), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) })).json(); }
  async backendStop(id) { return (await api('/api/backend/stop?' + q({ p: id }), { method: 'POST' })).json(); }
  async backendStatus(id, since) { return (await api('/api/backend/status?' + q({ p: id, since: since || 0 }))).json(); }
  async backendRequest(id, method, path, body) { return (await api('/api/backend/request?' + q({ p: id }), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, path, body }) })).json(); }
}

/* ---------------------------------------------------------------- IndexedDB */
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('ultragame-studio', 1);
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' }); if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'key' }); };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error || new Error('IndexedDB no disponible'));
  });
}
function tx(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode); let out;
    t.oncomplete = () => resolve(out); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error || new Error('transacción cancelada'));
    out = fn(t);
  });
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export class LocalStore {
  constructor(db) { this.kind = 'local'; this.db = db; this.label = 'Este navegador (IndexedDB)'; this.urls = new Map(); }
  static async open() { return new LocalStore(await idb()); }
  async list() {
    const all = await tx(this.db, ['projects'], 'readonly', (t) => reqP(t.objectStore('projects').getAll()));
    const rows = await all;
    return rows.map((r) => ({ id: r.id, name: r.project.name, modified: r.modified, kinds: Array.from(new Set((r.project.scenes || []).map((s) => s.kind))), scenes: (r.project.scenes || []).length })).sort((a, b) => b.modified - a.modified);
  }
  async create(project) {
    const base = String(project.name || 'proyecto').normalize('NFD').replace(/[^\w-]+/g, '-').toLowerCase().replace(/^-+|-+$/g, '').slice(0, 40) || 'proyecto';
    const existing = new Set((await this.list()).map((p) => p.id));
    let id = base, n = 2; while (existing.has(id)) id = base + '-' + (n++);
    await tx(this.db, ['projects'], 'readwrite', (t) => { t.objectStore('projects').put({ id, project, modified: Date.now() }); });
    return id;
  }
  async load(id) { const r = await (await tx(this.db, ['projects'], 'readonly', (t) => reqP(t.objectStore('projects').get(id)))); if (!r) throw new Error('No existe el proyecto'); return r.project; }
  async save(id, project) { await tx(this.db, ['projects'], 'readwrite', (t) => { t.objectStore('projects').put({ id, project, modified: Date.now() }); }); }
  async remove(id) {
    const keys = (await this.listAssets(id)).map((a) => id + '/' + a.file);
    await tx(this.db, ['projects', 'files'], 'readwrite', (t) => { t.objectStore('projects').delete(id); keys.forEach((k) => t.objectStore('files').delete(k)); });
  }
  async listAssets(id) {
    const rows = await (await tx(this.db, ['files'], 'readonly', (t) => reqP(t.objectStore('files').getAll(IDBKeyRange.bound(id + '/', id + '/\uffff')))));
    return rows.map((r) => ({ file: r.file, size: r.blob.size, modified: r.modified }));
  }
  async putAsset(id, file, blob) {
    if (blob.size > 64 * 1024 * 1024) throw new Error('Archivo demasiado grande (máx. 64 MB)');
    await tx(this.db, ['files'], 'readwrite', (t) => { t.objectStore('files').put({ key: id + '/' + file, file, blob, modified: Date.now() }); });
    this._revoke(id + '/' + file);
  }
  async deleteAsset(id, file) { await tx(this.db, ['files'], 'readwrite', (t) => { t.objectStore('files').delete(id + '/' + file); }); this._revoke(id + '/' + file); }
  async _blob(id, file) { const r = await (await tx(this.db, ['files'], 'readonly', (t) => reqP(t.objectStore('files').get(id + '/' + file)))); if (!r) throw new Error('No existe ' + file); return r.blob; }
  async assetData(id, file) { return (await this._blob(id, file)).arrayBuffer(); }
  /** URL de objeto (se cachea y se libera al cambiar/borrar el archivo) */
  async assetURLAsync(id, file) { const k = id + '/' + file; if (!this.urls.has(k)) this.urls.set(k, URL.createObjectURL(await this._blob(id, file))); return this.urls.get(k); }
  _revoke(k) { const u = this.urls.get(k); if (u) { URL.revokeObjectURL(u); this.urls.delete(k); } }
  releaseAll() { this.urls.forEach((u) => URL.revokeObjectURL(u)); this.urls.clear(); }
  get canExportFolder() { return false; }
  get canRunBackend() { return false; }
}

/** Servidor del Studio si hay sesión; si no, IndexedDB */
export async function openStore() {
  const s = await ServerStore.detect();
  if (s) return s;
  return LocalStore.open();
}
