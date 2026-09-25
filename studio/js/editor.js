/* UltraGame Studio · núcleo del editor: proyecto abierto, escena y selección actuales, cambios con deshacer/rehacer,
 * guardado automático y recursos. Toda modificación pasa por editor.edit(etiqueta, fn) para poder deshacerla. */
import { toast, debounce } from './dom.js';

const S = window.UGStudio.schema;
const MAX_UNDO = 150, MAX_UNDO_BYTES = 60 * 1024 * 1024;

export class Editor extends EventTarget {
  constructor(store) {
    super();
    this.store = store; this.projectId = null; this.project = null; this.sceneId = null; this.selection = [];
    this.undoStack = []; this.redoStack = []; this.undoBytes = 0; this.dirty = false; this.saving = false; this.saveError = null;
    this.clipboard = null; this.assetVersion = Object.create(null); this.playing = false;
    this.autosave = debounce(() => this.save(), 1500);
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail: detail || {} })); }
  on(type, fn) { const f = (e) => fn(e.detail); this.addEventListener(type, f); return () => this.removeEventListener(type, f); }

  /* ---------------------------------------------------------------- proyecto */
  async open(id) {
    const raw = await this.store.load(id);
    const p = S.cleanProject(raw); // entrada no confiable: se valida siempre
    if (this.store.releaseAll) this.store.releaseAll(); // URLs de objeto del proyecto anterior (IndexedDB): no se quedan en memoria
    this.projectId = id; this.project = p; this.undoStack = []; this.redoStack = []; this.undoBytes = 0; this.dirty = false; this.selection = []; this.assetVersion = Object.create(null);
    this.sceneId = p.startScene || (p.scenes[0] && p.scenes[0].id) || null;
    if (!p.scenes.length) { const sc = S.createScene('2d', 'Escena 1'); p.scenes.push(sc); p.startScene = sc.id; this.sceneId = sc.id; }
    try { localStorage.setItem('ugs-last-project', this.store.kind + ':' + id); } catch (e) { /* modo privado */ }
    this.emit('project'); this.emit('scene'); this.emit('selection');
  }
  close() {
    this.autosave.cancel();
    this.project = null; this.projectId = null; this.sceneId = null; this.selection = []; this.undoStack = []; this.redoStack = []; this.undoBytes = 0; this.dirty = false;
    if (this.store.releaseAll) this.store.releaseAll();
    this.emit('project'); this.emit('scene'); this.emit('selection'); this.emit('savestate');
  }
  async save() {
    if (!this.project || this.saving) { if (this.saving) this.autosave(); return; }
    this.saving = true; this.emit('savestate');
    const snapshot = JSON.parse(JSON.stringify(this.project)); const wasDirty = this.dirty; this.dirty = false;
    try { await this.store.save(this.projectId, snapshot); this.saveError = null; this.lastSaved = Date.now(); }
    catch (e) { this.dirty = this.dirty || wasDirty; this.saveError = e.message; toast('No se pudo guardar: ' + e.message, 'error'); }
    finally { this.saving = false; this.emit('savestate'); }
  }
  get scene() { return this.project ? this.project.scenes.find((s) => s.id === this.sceneId) || null : null; }
  setScene(id) { if (id === this.sceneId || !this.project.scenes.some((s) => s.id === id)) return; this.sceneId = id; this.selection = []; this.emit('scene'); this.emit('selection'); }

  /* ---------------------------------------------------------------- cambios */
  /** Aplica fn(project) guardando antes una copia para deshacer. kind: qué cambió (para refrescar solo lo necesario) */
  edit(label, fn, kind) {
    if (!this.project) return;
    const before = JSON.stringify(this.project);
    let r;
    try { r = fn(this.project); }
    catch (e) { this.project = JSON.parse(before); toast('No se pudo aplicar "' + label + '": ' + e.message, 'error'); console.error(e); return; }
    const after = JSON.stringify(this.project);
    if (after === before) return r;
    this.pushUndo({ label, data: before, sceneId: this.sceneId, sel: this.selection.slice() });
    this.redoStack = [];
    this.touched(kind || 'all');
    return r;
  }
  pushUndo(entry) {
    this.undoStack.push(entry); this.undoBytes += entry.data.length;
    while (this.undoStack.length > MAX_UNDO || (this.undoBytes > MAX_UNDO_BYTES && this.undoStack.length > 1)) this.undoBytes -= this.undoStack.shift().data.length;
  }
  touched(kind) { this.dirty = true; this.emit('change', { kind }); this.emit('savestate'); this.autosave(); }
  undo() { this._swap(this.undoStack, this.redoStack, 'Deshacer'); }
  redo() { this._swap(this.redoStack, this.undoStack, 'Rehacer'); }
  _swap(from, to, verb) {
    const e = from.pop(); if (!e || !this.project) return;
    if (from === this.undoStack) this.undoBytes -= e.data.length;
    const cur = JSON.stringify(this.project);
    const entry = { label: e.label, data: cur, sceneId: this.sceneId, sel: this.selection.slice() };
    if (to === this.undoStack) this.pushUndo(entry); else to.push(entry);
    this.project = JSON.parse(e.data);
    if (!this.project.scenes.some((s) => s.id === e.sceneId)) e.sceneId = this.project.scenes[0] && this.project.scenes[0].id;
    const sceneChanged = e.sceneId !== this.sceneId; this.sceneId = e.sceneId;
    const ids = new Set((this.scene ? this.scene.nodes : []).map((n) => n.id));
    this.selection = e.sel.filter((id) => ids.has(id));
    if (sceneChanged) this.emit('scene');
    this.emit('selection'); this.touched('all');
    toast(verb + ': ' + e.label);
  }

  /* ---------------------------------------------------------------- selección y nodos */
  node(id) { const sc = this.scene; return sc ? sc.nodes.find((n) => n.id === id) || null : null; }
  get selected() { return this.selection.length ? this.node(this.selection[0]) : null; }
  select(ids, additive) {
    ids = (Array.isArray(ids) ? ids : ids ? [ids] : []).filter((id) => this.node(id));
    if (additive) { const s = new Set(this.selection); ids.forEach((id) => { if (s.has(id)) s.delete(id); else s.add(id); }); this.selection = Array.from(s); }
    else this.selection = ids;
    this.emit('selection');
  }
  childrenOf(id) { return this.scene.nodes.filter((n) => (n.parent || null) === (id || null)); }
  descendants(id) { const out = []; const walk = (pid) => this.scene.nodes.forEach((n) => { if (n.parent === pid) { out.push(n); walk(n.id); } }); walk(id); return out; }
  uniqueName(base) {
    const names = new Set(this.scene.nodes.map((n) => n.name));
    if (!names.has(base)) return base;
    const m = /^(.*?)(\s\d+)?$/.exec(base), stem = m[1];
    let i = 2; while (names.has(stem + ' ' + i)) i++;
    return stem + ' ' + i;
  }
  addNode(type, extra, label) {
    const sc = this.scene; if (!sc) return null;
    const T = S.NODE_TYPES[type];
    if (T.kind === '3d' && sc.kind !== '3d') { toast('Los objetos 3D solo van en escenas 3D. Crea una escena 3D en el panel Escenas.', 'warn'); return null; }
    const n = S.createNode(type, sc.kind, extra);
    n.name = this.uniqueName((extra && extra.name) || T.label);
    this.edit(label || ('Añadir ' + T.label), () => { sc.nodes.push(n); }, 'nodes');
    this.select(n.id);
    return n;
  }
  removeSelected() {
    const ids = this.selection.slice(); if (!ids.length) return;
    this.edit(ids.length > 1 ? 'Borrar ' + ids.length + ' objetos' : 'Borrar "' + (this.node(ids[0]) || {}).name + '"', () => {
      const kill = new Set(); ids.forEach((id) => { kill.add(id); this.descendants(id).forEach((d) => kill.add(d.id)); });
      this.scene.nodes = this.scene.nodes.filter((n) => !kill.has(n.id));
    }, 'nodes');
    this.select([]);
  }
  /** Copia profunda de nodos (con hijos) con ids nuevos */
  cloneTree(ids) {
    const out = [], map = new Map();
    const all = []; ids.forEach((id) => { const n = this.node(id); if (n && !all.includes(n)) { all.push(n); this.descendants(id).forEach((d) => { if (!all.includes(d)) all.push(d); }); } });
    all.forEach((n) => map.set(n.id, S.uid('n')));
    all.forEach((n) => { const c = JSON.parse(JSON.stringify(n)); c.id = map.get(n.id); c.parent = map.has(n.parent) ? map.get(n.parent) : n.parent; out.push(c); });
    return { nodes: out, roots: ids.map((id) => map.get(id)).filter(Boolean) };
  }
  duplicateSelected() {
    const ids = this.selection.filter((id) => !this.selection.includes((this.node(id) || {}).parent)); if (!ids.length) return;
    const { nodes, roots } = this.cloneTree(ids), is3d = this.scene.kind === '3d';
    this.edit('Duplicar', () => {
      nodes.forEach((n) => { if (roots.includes(n.id)) { n.name = this.uniqueName(n.name); if (n.position) { n.position[0] += is3d ? 1 : 0; n.position[2] += is3d ? 1 : 0; } else { n.x += 24; n.y += 24; } } });
      this.scene.nodes.push(...nodes);
    }, 'nodes');
    this.select(roots);
  }
  copySelected() { if (!this.selection.length) return; this.clipboard = { kind: this.scene.kind, data: JSON.stringify(this.cloneTree(this.selection.filter((id) => !this.selection.includes((this.node(id) || {}).parent)))) }; toast('Copiado'); }
  paste() {
    if (!this.clipboard) return;
    const c = JSON.parse(this.clipboard.data), map = new Map();
    c.nodes.forEach((n) => map.set(n.id, S.uid('n')));
    const nodes = c.nodes.map((n) => S.cleanNode(Object.assign({}, n, { id: map.get(n.id), parent: map.has(n.parent) ? map.get(n.parent) : null }), this.scene.kind)).filter(Boolean);
    const is3dScene = this.scene.kind === '3d', ok = nodes.filter((n) => is3dScene || S.NODE_TYPES[n.type].kind === '2d');
    if (!ok.length) { toast('Esos objetos 3D no se pueden pegar en una escena 2D', 'warn'); return; }
    this.edit('Pegar', () => { ok.forEach((n) => { if (!n.parent) n.name = this.uniqueName(n.name); }); this.scene.nodes.push(...ok); }, 'nodes');
    this.select(c.roots.map((r) => map.get(r)).filter((id) => ok.some((n) => n.id === id)));
  }
  /** Cambia el padre (null = raíz) y la posición en la lista (antes de beforeId) */
  reparent(id, parentId, beforeId) {
    if (id === parentId || (parentId && this.descendants(id).some((d) => d.id === parentId))) { toast('Un objeto no puede ser hijo de sí mismo', 'warn'); return; }
    const n = this.node(id); if (!n) return;
    const p = parentId ? this.node(parentId) : null;
    if (p && S.NODE_TYPES[p.type].kind !== S.NODE_TYPES[n.type].kind) { toast('No se puede mezclar un objeto 2D con uno 3D en la misma rama', 'warn'); return; }
    this.edit('Mover en la jerarquía', () => {
      const list = this.scene.nodes, i = list.indexOf(n); list.splice(i, 1);
      n.parent = parentId || null;
      const j = beforeId ? list.findIndex((x) => x.id === beforeId) : -1;
      if (j >= 0) list.splice(j, 0, n); else list.push(n);
    }, 'nodes');
  }
  /** Cambia un campo de un nodo: path "props.color", "x", "position", "physics.type"... */
  setField(id, path, value, label) {
    const n = this.node(id); if (!n) return;
    const keys = path.split('.'); if (keys.some((k) => S.isForbiddenKey(k))) return;
    this.edit(label || 'Cambiar ' + keys[keys.length - 1], () => {
      let o = n; for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
      o[keys[keys.length - 1]] = value;
    }, path === 'x' || path === 'y' || path === 'rotation' || path === 'position' || path === 'scale' || path === 'scaleX' || path === 'scaleY' ? 'transform' : 'props');
  }
  /** Mueve varios nodos a la vez (arrastre en la vista): un solo paso de deshacer */
  setTransforms(changes, label) {
    this.edit(label || 'Mover', () => { changes.forEach((c) => { const n = this.node(c.id); if (n) Object.assign(n, JSON.parse(JSON.stringify(c.values))); }); }, 'transform');
  }

  /* ---------------------------------------------------------------- escenas */
  addScene(kind) {
    const sc = S.createScene(kind, (kind === '3d' ? 'Escena 3D ' : 'Escena 2D ') + (this.project.scenes.length + 1));
    if (kind === '3d') { const g = S.createNode('mesh3d', '3d', { name: 'Suelo', position: [0, -0.5, 0] }); Object.assign(g.props, { sizeX: 30, sizeY: 1, sizeZ: 30, color: '#6a8a5a' }); g.physics.type = 'static'; sc.nodes.push(g); const cam = S.createNode('camera3d', '3d', { name: 'Cámara', position: [0, 6, 12] }); sc.nodes.push(cam); }
    this.edit('Nueva escena', (p) => { p.scenes.push(sc); if (!p.startScene) p.startScene = sc.id; }, 'scenes');
    this.setScene(sc.id);
    return sc;
  }
  removeScene(id) {
    if (this.project.scenes.length <= 1) { toast('El proyecto necesita al menos una escena', 'warn'); return; }
    this.edit('Borrar escena', (p) => { p.scenes = p.scenes.filter((s) => s.id !== id); if (p.startScene === id) p.startScene = p.scenes[0].id; }, 'scenes');
    if (this.sceneId === id) { this.sceneId = this.project.scenes[0].id; this.selection = []; this.emit('scene'); this.emit('selection'); }
  }

  /* ---------------------------------------------------------------- recursos */
  assetById(id) { return this.project ? this.project.assets.find((a) => a.id === id) || null : null; }
  assetsOfType(type) { return this.project ? this.project.assets.filter((a) => a.type === type || (type === 'tilemap' && a.type === 'tilemap')) : []; }
  /** Importa un File/Blob: valida extensión y tamaño, nombre seguro y único, sube al almacén y lo añade al proyecto */
  async importFile(file, name, opts) {
    name = String(name || file.name || 'archivo');
    const m = /\.([A-Za-z0-9]+)$/.exec(name), ext = m ? m[1].toLowerCase() : '';
    const type = S.assetTypeOf('x.' + ext);
    if (!type) throw new Error('Tipo de archivo no permitido: .' + ext);
    if (file.size > 64 * 1024 * 1024) throw new Error('"' + name + '" supera 64 MB');
    let stem = name.slice(0, name.length - ext.length - 1).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_\- ]+/g, '_').replace(/^[^A-Za-z0-9]+/, '').slice(0, 60) || 'recurso';
    const used = new Set(this.project.assets.map((a) => a.file.toLowerCase()));
    let fileName = 'assets/' + stem + '.' + ext, n = 2;
    while (used.has(fileName.toLowerCase())) fileName = 'assets/' + stem + '-' + (n++) + '.' + ext;
    await this.store.putAsset(this.projectId, fileName, file);
    const asset = { id: S.uid('a'), name: (opts && opts.displayName) || stem, file: fileName, type, frameWidth: (opts && opts.frameWidth) || 0, frameHeight: (opts && opts.frameHeight) || 0 };
    this.edit('Importar ' + asset.name, (p) => { p.assets.push(asset); }, 'assets');
    return asset;
  }
  /** Sustituye el contenido de un recurso (editor de imágenes): mismo archivo, nueva versión; meta: { frameWidth, frameHeight } */
  async replaceAsset(id, blob, meta) {
    const a = this.assetById(id); if (!a) throw new Error('No existe el recurso');
    if (blob.size > 64 * 1024 * 1024) throw new Error('Supera 64 MB');
    await this.store.putAsset(this.projectId, a.file, blob);
    this.assetVersion[id] = (this.assetVersion[id] || 0) + 1;
    if (this.store.releaseAll && this.store._revoke) this.store._revoke(this.projectId + '/' + a.file);
    this.edit('Editar imagen «' + a.name + '»', (p) => { const x = p.assets.find((y) => y.id === id); if (x && meta) { if (meta.frameWidth !== undefined) x.frameWidth = meta.frameWidth | 0; if (meta.frameHeight !== undefined) x.frameHeight = meta.frameHeight | 0; } }, 'assets');
    this.touched('assets');
    return a;
  }
  async deleteAsset(id) {
    const a = this.assetById(id); if (!a) return;
    await this.store.deleteAsset(this.projectId, a.file);
    this.edit('Borrar recurso', (p) => { p.assets = p.assets.filter((x) => x.id !== id); }, 'assets');
  }
  /** URL para cargar el recurso en el editor (disco: /api/file con cookie; navegador: URL de objeto) */
  async assetURL(a) {
    if (this.store.kind === 'server') return this.store.assetURL(this.projectId, a.file, this.assetVersion[a.id]);
    return this.store.assetURLAsync(this.projectId, a.file);
  }
  /** Referencias a un recurso (para avisar antes de borrarlo) */
  usesOfAsset(id) {
    const out = [];
    this.project.scenes.forEach((sc) => sc.nodes.forEach((n) => { Object.keys(n.props).forEach((k) => { if (n.props[k] === id) out.push(sc.name + ' › ' + n.name); }); }));
    return out;
  }

  /* ---------------------------------------------------------------- scripts */
  addScript(name, code) {
    const s = { id: S.uid('s'), name: name || 'script', code: code || DEFAULT_SCRIPT };
    this.edit('Nuevo script', (p) => { p.scripts.push(s); }, 'scripts');
    return s;
  }
}

export const DEFAULT_SCRIPT = [
  '// Script de objeto. "self" es el objeto de UltraGame y "api" la ayuda del Studio.',
  '// Todas las funciones son opcionales: borra las que no necesites.',
  '',
  'function onStart() {',
  '  // se ejecuta una vez al empezar la escena',
  '}',
  '',
  'function onUpdate(dt) {',
  '  // se ejecuta en cada fotograma; dt = segundos desde el anterior',
  "  // if (api.key('RIGHT')) self.x += 200 * dt;",
  '}',
  '',
  'function onCollide(other) {',
  '  // al empezar a tocar otro objeto (other)',
  '}',
  ''
].join('\n');
export const DEFAULT_SCENE_SCRIPT = [
  '// Script de escena: se ejecuta mientras esta escena está activa.',
  '// Las funciones que escribas aquí se pueden llamar desde los eventos ("Llamar a una función").',
  '',
  'function onStart() {',
  "  api.log('¡Escena iniciada!');",
  '}',
  '',
  'function onUpdate(dt) {',
  '}',
  ''
].join('\n');
