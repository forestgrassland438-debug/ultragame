/* UltraGame Studio · arranque: conecta almacenamiento, editor, paneles, vistas, menús, atajos y proyectos. */
import { h, clear, toast, showMenu, dialog, confirm, debounce, $$ } from './dom.js';
import { openStore } from './store.js';
import { Editor } from './editor.js';
import { ScenesPanel, TreePanel, Inspector, AssetsPanel, LibraryPanel, ConsolePanel } from './panels.js';
import { EventSheet } from './events.js';
import { CodePanel } from './code.js';
import { Viewport2D } from './viewport2d.js';
import { Viewport3D } from './viewport3d.js';
import { Player } from './play.js';
import { exportZip, exportFolder, exportSingle, exportProject, readProjectFile } from './export.js';
import { TEMPLATES } from './templates.js';
import { LIB_2D, LIB_3D, libBlob } from './library.js';
import { Layout } from './layout.js';
import { attachTouch } from './touch.js';
import { BackendPanel } from './backendpanel.js';
import { Web3Panel } from './web3panel.js';
import { PaintPanel } from './paint.js';
import { validateAndTest } from './validate.js';

const S = window.UGStudio.schema;
const store = await openStore();
const editor = new Editor(store);
const app = {
  editor, store, viewport: null, keys: new Set(), tab: 'scene',
  snapSteps: { '2d': 16, '3d': 0.5 },
  rendererChoice: () => document.getElementById('sel-renderer').value
};
window.StudioApp = app; // para pruebas y depuración desde la consola

app.console = new ConsolePanel(app);
app.scenes = new ScenesPanel(app);
app.tree = new TreePanel(app);
app.inspector = new Inspector(app);
app.assets = new AssetsPanel(app);
app.library = new LibraryPanel(app);
app.events = new EventSheet(app, document.getElementById('events'));
app.codeSources = [];
app.backend = new BackendPanel(app, document.getElementById('backend-page'));
app.web3 = new Web3Panel(app, document.getElementById('web3-page'));
app.paint = new PaintPanel(app, document.getElementById('art-page'));
app.code = new CodePanel(app, document.getElementById('code-page'));
app.player = new Player(app);
app.layout = new Layout(app);
app.openPaint = (assetId) => { selectTab('art'); if (assetId) app.paint.openAsset(assetId); };

/* ================================================================ vista 2D/3D */
const vpHost = document.getElementById('viewport');
const HINTS = {
  '2d': 'Rueda: zoom · botón derecho, central o Espacio+arrastrar: desplazar · arrastra un objeto para moverlo · flechas: mover 1 px · Alt: sin rejilla',
  '3d': 'Botón derecho: orbitar (con WASD/QE vuela) · botón central: desplazar · rueda: acercar · arrastra las flechas del gizmo para mover por un eje'
};
function ensureViewport(resetCam) {
  const sc = editor.scene, kind = sc ? sc.kind : null;
  if (app.viewport && app.viewport.kind === kind) {
    if (resetCam) { if (kind === '2d') app.viewport.cam.inited = false; else app.viewport.orbit.inited = false; }
    app.viewport.syncAssets(true); return;
  }
  if (app.viewport) { app.viewport.destroy(); app.viewport = null; }
  welcome(!kind);
  if (!kind) return;
  app.viewport = kind === '3d' ? new Viewport3D(app, vpHost) : new Viewport2D(app, vpHost);
  app.viewport.tool = currentTool; app.viewport.snap = document.getElementById('chk-snap').checked; app.viewport.snapStep = app.snapSteps[kind];
  app.viewport.showColliders = document.getElementById('chk-colliders').checked;
  document.getElementById('inp-snap').value = String(app.snapSteps[kind]);
  document.getElementById('vp-hint').textContent = HINTS[kind];
  app.viewport.mount();
  if (app.untouch) app.untouch();
  app.untouch = attachTouch(app.viewport);
  app.viewport.setActive(app.tab === 'scene');
}
app.clipsOf = (assetId) => (app.viewport && app.viewport.clipsOf ? app.viewport.clipsOf(assetId) : []);
app.focusSelection = () => { if (app.viewport) app.viewport.focus(); };
const rebuildSoon = debounce(() => { if (app.viewport) app.viewport.syncAssets(true); }, 60);

editor.on('project', () => {
  document.getElementById('project-name').textContent = editor.project ? editor.project.name : 'Sin proyecto';
  document.title = editor.project ? editor.project.name + ' · UltraGame Studio' : 'UltraGame Studio';
  app.player.stop(true); app.player.clearCache(); app.console.clear();
  if (app.viewport) { app.viewport.destroy(); app.viewport = null; }
  ensureViewport(true);
  if (app.tab !== 'scene' && app.tab !== 'game') selectTab(app.tab);
});
editor.on('scene', () => { ensureViewport(true); if (app.tab === 'events') app.events.render(); if (app.tab === 'code') app.code.render(); });
editor.on('change', (d) => {
  if (!app.viewport) { ensureViewport(false); return; }
  if (editor.scene && app.viewport.kind !== editor.scene.kind) { ensureViewport(true); return; }
  if (d.kind === 'transform') app.viewport.applyTransforms();
  else if (d.kind === 'scripts' || d.kind === 'events' || d.kind === 'web3' || d.kind === 'backend') { /* no cambian la vista */ }
  else rebuildSoon();
  if (d.kind === 'project' || d.kind === 'all') document.getElementById('project-name').textContent = editor.project ? editor.project.name : '';
});
editor.on('savestate', () => {
  const el = document.getElementById('save-state');
  el.className = 'save-state' + (editor.saveError ? ' error' : editor.dirty ? ' dirty' : '');
  el.textContent = editor.saving ? 'Guardando…' : editor.saveError ? '⚠ No guardado' : editor.dirty ? '● Cambios sin guardar' : editor.project ? 'Guardado ✓' : '';
  el.title = editor.saveError || (editor.lastSaved ? 'Último guardado: ' + new Date(editor.lastSaved).toLocaleTimeString() : '');
});
let welcomeEl = null;
function welcome(show) {
  if (welcomeEl) { welcomeEl.remove(); welcomeEl = null; }
  if (!show) return;
  welcomeEl = h('div', { style: { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', color: 'var(--muted)' } },
    h('img', { src: 'icon.svg', width: 72, height: 72, alt: '' }), h('h2', { style: { margin: 0, color: 'var(--text)' } }, 'UltraGame Studio'),
    h('div', 'Crea juegos 2D y 3D con objetos, comportamientos sin código, eventos y scripts.'),
    h('div.row-actions', h('button.btn.primary', { type: 'button', on: { click: () => projectManager(true) } }, '＋ Nuevo proyecto'), h('button.btn', { type: 'button', on: { click: () => projectManager(false) } }, '📂 Abrir proyecto')));
  vpHost.appendChild(welcomeEl);
}

/* ================================================================ pestañas y barra de herramientas */
function selectTab(tab) {
  app.tab = tab;
  $$('#center-tabs > button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $$('.tab-pages > .page').forEach((p) => p.classList.toggle('on', p.dataset.page === tab));
  if (app.viewport) app.viewport.setActive(tab === 'scene');
  if (tab === 'events') app.events.render();
  if (tab === 'code') app.code.render();
  app.paint.setVisible(tab === 'art'); app.web3.setVisible(tab === 'web3'); app.backend.setVisible(tab === 'backend');
  if (app.layout) app.layout.closeDrawers();
}
app.selectTab = selectTab;
$$('#center-tabs > button[data-tab]').forEach((b) => { b.onclick = () => selectTab(b.dataset.tab); });
document.getElementById('btn-focus-mode').onclick = () => app.layout.toggleFocus();
function selectBottom(tab) {
  $$('#bottom-tabs > button[data-btab]').forEach((b) => b.classList.toggle('on', b.dataset.btab === tab));
  $$('.bottom > .bpage').forEach((p) => p.classList.toggle('on', p.dataset.bpage === tab));
  if (tab === 'library') app.library.render();
  if (tab === 'console') { app.console.errors = 0; app.console.updateBadge(); }
}
$$('#bottom-tabs > button[data-btab]').forEach((b) => { b.onclick = () => selectBottom(b.dataset.btab); });
let currentTool = 'select';
function setTool(t) {
  currentTool = t;
  $$('#tool-seg button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  if (app.viewport) { if (app.viewport.setTool) app.viewport.setTool(t); else app.viewport.tool = t; }
}
$$('#tool-seg button').forEach((b) => { b.onclick = () => setTool(b.dataset.tool); });
document.getElementById('chk-snap').onchange = (e) => { if (app.viewport) app.viewport.snap = e.target.checked; };
const chkColliders = document.getElementById('chk-colliders');
try { if (localStorage.getItem('ugs-colliders') === '0') chkColliders.checked = false; } catch (e) { /* modo privado */ }
chkColliders.onchange = () => { if (app.viewport) app.viewport.showColliders = chkColliders.checked; try { localStorage.setItem('ugs-colliders', chkColliders.checked ? '1' : '0'); } catch (e) { /* modo privado */ } };
document.getElementById('inp-snap').onchange = (e) => { const v = Math.max(0.01, Math.min(1000, parseFloat(e.target.value) || 1)); e.target.value = String(v); if (app.viewport) { app.snapSteps[app.viewport.kind] = v; app.viewport.snapStep = v; } };
document.getElementById('inp-snap').addEventListener('keydown', (e) => e.stopPropagation());
document.getElementById('btn-focus').onclick = () => app.focusSelection();
document.getElementById('btn-home').onclick = () => app.viewport && app.viewport.home();
const selR = document.getElementById('sel-renderer');
try { const r = localStorage.getItem('ugs-renderer'); if (r && Array.from(selR.options).some((o) => o.value === r)) selR.value = r; } catch (e) { /* modo privado */ }
selR.onchange = () => { try { localStorage.setItem('ugs-renderer', selR.value); } catch (e) { /* modo privado */ } };

/* ================================================================ jugar */
document.getElementById('btn-play').onclick = () => play(false);
document.getElementById('btn-play-scene').onclick = () => play(true);
document.getElementById('btn-stop').onclick = () => app.player.stop();
async function play(current, opts) {
  if (!editor.project) return;
  try { await app.player.play(current, opts); } catch (e) { toast('No se pudo iniciar el juego: ' + e.message, 'error'); console.error(e); }
}
app.play = play;
app.setPlaying = (on) => {
  document.getElementById('btn-stop').disabled = !on;
  document.getElementById('tab-game').hidden = !on;
  if (on) { selectTab('game'); selectBottom('console'); } else if (app.tab === 'game') selectTab('scene');
};
app.openScript = (id, line) => { selectTab('code'); app.code.open(id, line); };

/* ================================================================ recursos */
const fileInput = document.getElementById('file-input');
document.getElementById('btn-import').onclick = () => app.importFiles(null, null);
app.importFiles = (type, cb) => {
  if (!editor.project) { toast('Primero abre o crea un proyecto', 'warn'); return; }
  fileInput.accept = type && S.ASSET_TYPES[type] ? S.ASSET_TYPES[type].map((e) => '.' + e).join(',') : '.png,.jpg,.jpeg,.webp,.gif,.svg,.mp3,.ogg,.wav,.m4a,.glb,.gltf,.obj,.mtl,.bin,.json,.tmj,.tsj,.ttf,.otf,.woff,.woff2,.txt';
  fileInput.value = '';
  fileInput.onchange = async () => { const list = await app.importList(Array.from(fileInput.files || [])); if (cb && list.length) cb(list[0]); };
  fileInput.click();
};
app.importList = async (files, at) => {
  const out = [];
  if (!editor.project) return out;
  for (const f of files.slice(0, 200)) {
    try { const a = await editor.importFile(f); out.push(a); }
    catch (e) { toast('«' + f.name + '»: ' + e.message, 'error'); }
  }
  if (out.length) { toast(out.length === 1 ? 'Importado «' + out[0].name + '»' : out.length + ' archivos importados', 'ok'); selectBottom('assets'); }
  if (at && out.length === 1) setTimeout(() => app.placeAsset(out[0], at), 50);
  return out;
};
function propsFor(type, over) { return Object.assign(S.defaultsOf(S.NODE_TYPES[type].props), over || {}); }
app.placeAsset = (a, at) => {
  const sc = editor.scene, vp = app.viewport; if (!sc || !vp) return;
  app.inspector.assetSel = null;
  if (a.type === 'image') {
    if (sc.kind === '3d') editor.addNode('sprite3d', { name: a.name, position: (at && at.position) || vp.centerPoint(), props: propsFor('sprite3d', { asset: a.id }) });
    else { const p = at && at.x !== undefined ? at : vp.centerPoint(); editor.addNode('sprite', { name: a.name, x: p.x, y: p.y, props: propsFor('sprite', { asset: a.id }) }); }
  } else if (a.type === 'model') {
    if (sc.kind !== '3d') { toast('Los modelos 3D se colocan en escenas 3D (crea una con «＋3D»).', 'warn'); return; }
    const clips = app.clipsOf(a.id);
    editor.addNode('model', { name: a.name, position: (at && at.position) || vp.centerPoint(), props: propsFor('model', { asset: a.id, clip: clips.includes('Idle') ? 'Idle' : clips.includes('Spin') ? 'Spin' : '' }) });
  } else if (a.type === 'tilemap') {
    if (sc.kind === '3d') { toast('Los mapas de Tiled van en escenas 2D.', 'warn'); return; }
    const img = editor.project.assets.find((x) => x.type === 'image');
    editor.addNode('tilemap', { name: a.name, x: 0, y: 0, props: propsFor('tilemap', { asset: a.id, tileset: img ? img.id : '', collideAll: true }) });
    toast('Mapa añadido: elige la imagen del tileset en el Inspector si no es la correcta.');
  } else if (a.type === 'audio') toast('Los sonidos se usan en eventos («Sonido», «Música») o en scripts: api.sound(\'' + a.id + '\')');
  else toast('Recurso importado. Se usa desde scripts.');
};
app.deleteAsset = async (a) => {
  const uses = editor.usesOfAsset(a.id);
  const ok = await confirm('Borrar recurso', uses.length ? '«' + a.name + '» se usa en ' + uses.length + ' objeto(s) (' + uses.slice(0, 3).join(', ') + (uses.length > 3 ? '…' : '') + '). Se quedarán sin él. ¿Borrar?' : '¿Borrar «' + a.name + '» del proyecto?', 'Borrar', true);
  if (!ok) return;
  try { await editor.deleteAsset(a.id); if (app.inspector.assetSel === a.id) app.inspector.assetSel = null; toast('Recurso borrado' + (store.kind === 'server' ? ' (movido a projects/.trash)' : ''), 'ok'); } catch (e) { toast('No se pudo borrar: ' + e.message, 'error'); }
};
// soltar archivos en cualquier parte del editor
document.addEventListener('dragover', (e) => { if (e.dataTransfer && e.dataTransfer.types.includes('Files')) e.preventDefault(); });
document.addEventListener('drop', (e) => { if (e.defaultPrevented) return; if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); app.importList(Array.from(e.dataTransfer.files)); } });

/* ================================================================ añadir objetos */
app.addNodeMenu = (anchor, parentId) => {
  const sc = editor.scene; if (!sc) { toast('Abre un proyecto primero', 'warn'); return; }
  const parent = parentId ? editor.node(parentId) : null, pkind = parent ? S.NODE_TYPES[parent.type].kind : null;
  const groups = {};
  Object.keys(S.NODE_TYPES).forEach((k) => {
    const T = S.NODE_TYPES[k];
    if (T.kind === '3d' && sc.kind !== '3d') return;
    if (pkind && T.kind !== pkind) return;
    const g = T.kind === '2d' && sc.kind === '3d' ? 'HUD (2D sobre la vista)' : T.group;
    (groups[g] || (groups[g] = [])).push(k);
  });
  const items = [];
  Object.keys(groups).forEach((g) => { items.push({ group: g }); groups[g].forEach((k) => items.push({ label: S.NODE_TYPES[k].label, icon: S.NODE_TYPES[k].icon, action: () => addNodeAt(k, parentId) })); });
  showMenu(items, anchor);
};
function addNodeAt(type, parentId) {
  const sc = editor.scene, T = S.NODE_TYPES[type], extra = {};
  if (parentId) extra.parent = parentId;
  if (T.kind === '3d') {
    extra.position = parentId ? [0, 0, 0] : (app.viewport && app.viewport.centerPoint ? app.viewport.centerPoint() : [0, 0, 0]);
    if (type === 'mesh3d' && !parentId) extra.position[1] = Math.max(extra.position[1], 0.5);
    if (type === 'light') extra.position = [extra.position[0], extra.position[1] + 3, extra.position[2]];
    if (type === 'terrain' || type === 'gridlevel') extra.position = [0, 0, 0];
  } else if (sc.kind === '3d') { extra.x = editor.project.settings.width / 2; extra.y = editor.project.settings.height / 2; }
  else { const c = parentId ? { x: 0, y: 0 } : (app.viewport ? app.viewport.centerPoint() : { x: 0, y: 0 }); extra.x = c.x; extra.y = c.y; }
  editor.addNode(type, extra);
}

/* ================================================================ proyectos */
async function createFromTemplate(tpl, name) {
  const L = {}; tpl.assets.forEach(([, key]) => { L[key] = S.uid('a'); });
  const p = tpl.build(L); p.name = (name || p.name).slice(0, 80);
  const clean = S.cleanProject(p);
  const id = await store.create(clean);
  for (const [kind, key] of tpl.assets) {
    const blob = await libBlob(kind, key), file = 'assets/' + key + (kind === '2d' ? '.png' : '.glb'), meta = kind === '2d' ? LIB_2D[key] : LIB_3D[key];
    await store.putAsset(id, file, blob);
    clean.assets.push({ id: L[key], name: meta.label, file, type: kind === '2d' ? 'image' : 'model', frameWidth: meta.frameWidth || 0, frameHeight: meta.frameHeight || 0 });
  }
  await store.save(id, clean);
  await openProject(id);
}
async function openProject(id) {
  try { app.player.stop(true); if (editor.dirty) await editor.save(); await editor.open(id); selectTab('scene'); toast('Proyecto «' + editor.project.name + '» abierto', 'ok'); }
  catch (e) { toast('No se pudo abrir: ' + e.message, 'error'); console.error(e); }
}
async function importProjectFile(file) {
  const { project, files } = await readProjectFile(file);
  const id = await store.create(project);
  for (const f of files) await store.putAsset(id, f.file, f.blob);
  await store.save(id, project);
  await openProject(id);
}
async function projectManager(focusNew) {
  let list = [];
  try { list = await store.list(); } catch (e) { toast('No se pudo leer la lista de proyectos: ' + e.message, 'error'); }
  let chosen = TEMPLATES[0], nameInput, result = null;
  const pick = h('input', { type: 'file', accept: '.json,.ugs.json', hidden: true });
  await dialog('Proyectos', (body, close) => {
    const left = h('div', { style: { display: 'grid', gap: '8px', alignContent: 'start' } }, h('b', 'Tus proyectos'), h('div.help', store.kind === 'server' ? 'Guardados en disco: ' + store.info.workspace : 'Guardados en este navegador (IndexedDB). Para guardarlos en disco abre el Studio con «UltraGame Studio.cmd» o «npm run studio».'));
    const pl = h('div.proj-list');
    if (!list.length) pl.appendChild(h('div.empty', 'Todavía no hay proyectos.'));
    list.forEach((p) => {
      const row = h('div.proj', { title: 'Abrir' }, h('span', (p.kinds || []).includes('3d') ? '🧊' : '🟦'), h('div.grow', h('div', p.name), h('small', new Date(p.modified).toLocaleString() + ' · ' + p.scenes + ' escena(s)')),
        h('button.icon', { type: 'button', title: 'Borrar proyecto', on: { click: async (e) => { e.stopPropagation(); if (await confirm('Borrar proyecto', '¿Borrar «' + p.name + '»? ' + (store.kind === 'server' ? 'Se moverá a la carpeta projects/.trash.' : 'Se borrará de este navegador.'), 'Borrar', true)) { await store.remove(p.id); close(null); projectManager(false); } } } }, '🗑'));
      row.onclick = () => { result = { open: p.id }; close(null); };
      pl.appendChild(row);
    });
    left.appendChild(pl);
    left.appendChild(h('div.row-actions', h('button.btn.small', { type: 'button', on: { click: () => pick.click() } }, '⬆ Importar proyecto (.ugs.json)'), pick));
    pick.onchange = () => { if (pick.files && pick.files[0]) { result = { importFile: pick.files[0] }; close(null); } };
    nameInput = h('input', { type: 'text', value: '', placeholder: 'Nombre del juego', maxlength: 80 });
    const grid = h('div.tpl-grid');
    const cards = TEMPLATES.map((t) => { const c = h('button.tpl', { type: 'button', class: t === chosen ? 'on' : null }, h('span.em', t.emoji), h('b', t.name), h('span', t.desc)); c.onclick = () => { chosen = t; cards.forEach((x) => x.classList.toggle('on', x === c)); if (!nameInput.value.trim()) nameInput.placeholder = t.name; }; c.ondblclick = () => { result = { create: chosen, name: nameInput.value.trim() || chosen.name }; close(null); }; return c; });
    cards.forEach((c) => grid.appendChild(c));
    const right = h('div', { style: { display: 'grid', gap: '10px', alignContent: 'start' } }, h('b', 'Nuevo proyecto'), nameInput, h('div.help', 'Elige una plantilla (doble clic para crear):'), grid,
      h('div.row-actions', h('button.btn.primary', { type: 'button', on: { click: () => { result = { create: chosen, name: nameInput.value.trim() || chosen.name }; close(null); } } }, '＋ Crear proyecto')));
    body.appendChild(h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) 2fr', gap: '18px' } }, left, right));
    if (focusNew) setTimeout(() => nameInput.focus(), 50);
  }, [{ label: 'Cerrar', value: null }], true);
  if (!result) { if (!editor.project) welcome(true); return; }
  try {
    if (result.open) await openProject(result.open);
    else if (result.create) { toast('Creando «' + result.name + '»…'); await createFromTemplate(result.create, result.name); }
    else if (result.importFile) await importProjectFile(result.importFile);
  } catch (e) { toast('Error: ' + e.message, 'error'); console.error(e); }
}
app.projectManager = projectManager;
app.createFromTemplate = createFromTemplate; app.templates = TEMPLATES; // (también usados por las pruebas automáticas)

/* ================================================================ menús */
const MENUS = {
  'Archivo': () => [
    { label: 'Proyectos…', icon: '📂', key: 'Ctrl+O', action: () => projectManager(false) },
    { label: 'Nuevo proyecto…', icon: '＋', action: () => projectManager(true) },
    { label: 'Guardar', icon: '💾', key: 'Ctrl+S', disabled: !editor.project, action: () => editor.save() },
    '-',
    { group: 'Exportar el juego' },
    { label: 'Exportar a carpeta (disco)', icon: '📁', disabled: !editor.project || !store.canExportFolder, title: store.canExportFolder ? '' : 'Necesita el servidor del Studio', action: () => run(() => exportFolder(app)) },
    { label: 'Abrir la carpeta exportada', icon: '🗂', disabled: !editor.project || store.kind !== 'server', action: () => run(() => store.reveal(editor.projectId, 'export')) },
    { label: 'Descargar ZIP (web)', icon: '🗜', disabled: !editor.project, action: () => run(() => exportZip(app)) },
    { label: 'Descargar HTML único (doble clic)', icon: '📄', disabled: !editor.project, action: () => run(() => exportSingle(app)) },
    '-',
    { label: 'Descargar proyecto (.ugs.json)', icon: '⬇', disabled: !editor.project, action: () => run(() => exportProject(app)) },
    { label: 'Abrir la carpeta del proyecto', icon: '🗂', disabled: !editor.project || store.kind !== 'server', action: () => run(() => store.reveal(editor.projectId, 'project')) },
    '-',
    { label: 'Cerrar proyecto', icon: '✕', disabled: !editor.project, action: async () => { if (editor.dirty) await editor.save(); app.player.stop(true); editor.close(); } }
  ],
  'Editar': () => [
    { label: 'Deshacer' + (editor.undoStack.length ? ': ' + editor.undoStack[editor.undoStack.length - 1].label : ''), icon: '↶', key: 'Ctrl+Z', disabled: !editor.undoStack.length, action: () => editor.undo() },
    { label: 'Rehacer', icon: '↷', key: 'Ctrl+Y', disabled: !editor.redoStack.length, action: () => editor.redo() },
    '-',
    { label: 'Copiar', icon: '📋', key: 'Ctrl+C', disabled: !editor.selection.length, action: () => editor.copySelected() },
    { label: 'Pegar', icon: '📥', key: 'Ctrl+V', disabled: !editor.clipboard, action: () => editor.paste() },
    { label: 'Duplicar', icon: '⧉', key: 'Ctrl+D', disabled: !editor.selection.length, action: () => editor.duplicateSelected() },
    { label: 'Borrar', icon: '🗑', key: 'Supr', disabled: !editor.selection.length, action: () => editor.removeSelected() },
    { label: 'Seleccionar todo', icon: '▦', key: 'Ctrl+A', disabled: !editor.scene, action: () => editor.select(editor.scene.nodes.map((n) => n.id)) }
  ],
  'Añadir': () => { const sc = editor.scene; if (!sc) return [{ label: 'Abre un proyecto', disabled: true }]; const out = []; let last = null; Object.keys(S.NODE_TYPES).forEach((k) => { const T = S.NODE_TYPES[k]; if (T.kind === '3d' && sc.kind !== '3d') return; const g = T.kind === '2d' && sc.kind === '3d' ? 'HUD (2D)' : T.group; if (g !== last) { out.push({ group: g }); last = g; } out.push({ label: T.label, icon: T.icon, action: () => addNodeAt(k, null) }); }); return out; },
  'Escena': () => [
    { label: 'Nueva escena 2D', icon: '🟦', disabled: !editor.project, action: () => editor.addScene('2d') },
    { label: 'Nueva escena 3D', icon: '🧊', disabled: !editor.project, action: () => editor.addScene('3d') },
    '-',
    { label: 'Ajustes de la escena y del proyecto', icon: '⚙', disabled: !editor.scene, action: () => { editor.select([]); app.inspector.assetSel = null; app.inspector.render(); } },
    { label: 'Hacer escena inicial', icon: '★', disabled: !editor.scene || editor.project.startScene === editor.sceneId, action: () => editor.edit('Escena inicial', (p) => { p.startScene = editor.sceneId; }, 'scenes') },
    { label: 'Eventos de la escena', icon: '⚡', disabled: !editor.scene, action: () => selectTab('events') },
    { label: 'Script de la escena', icon: '{ }', disabled: !editor.scene, action: () => app.openScript('__scene') }
  ],
  'Ejecutar': () => [
    { label: 'Jugar', icon: '▶', key: 'F5', disabled: !editor.project, action: () => play(false) },
    { label: 'Jugar esta escena', icon: '▶', key: 'Mayús+F5', disabled: !editor.project, action: () => play(true) },
    { label: 'Detener', icon: '■', key: 'Esc', disabled: !app.player.playing, action: () => app.player.stop() },
    '-',
    { label: 'Probar en un móvil (iPhone 15)', icon: '📱', disabled: !editor.project, action: () => play(false, { device: 'iphone-15' }) },
    { label: 'Probar en una tableta (iPad Air)', icon: '📱', disabled: !editor.project, action: () => play(false, { device: 'ipad-air' }) },
    { label: 'Comparar en varios dispositivos', icon: '▦', disabled: !editor.project, action: () => play(false, { compare: true }) },
    '-',
    { label: 'Validar y probar la exportación', icon: '✅', disabled: !editor.project, action: () => run(() => validateAndTest(app)) },
    { label: 'Backend: ejecutar en local', icon: '🌐', disabled: !editor.project, action: () => { selectTab('backend'); app.backend.start(); } },
    '-',
    { label: 'Limpiar la consola', icon: '🧹', action: () => app.console.clear() }
  ],
  'Ventana': () => app.layout.menu().concat(['-', { group: 'Pestañas' }, { label: 'Escena', icon: '🎬', action: () => selectTab('scene') }, { label: 'Eventos', icon: '⚡', action: () => selectTab('events') }, { label: 'Código', icon: '{ }', action: () => selectTab('code') }, { label: 'Arte (imágenes y pixel art)', icon: '🎨', action: () => selectTab('art') }, { label: 'Web3', icon: '⛓', action: () => selectTab('web3') }, { label: 'Backend', icon: '🌐', action: () => selectTab('backend') }]),
  'Ayuda': () => [
    { label: 'Guía del Studio', icon: '📘', action: () => window.open('../docs/studio.html', '_blank', 'noopener') },
    { label: 'Documentación del motor', icon: '📚', action: () => window.open('../docs/index.html', '_blank', 'noopener') },
    { label: 'Atajos de teclado', icon: '⌨', action: shortcutsDialog },
    { label: 'Acerca de UltraGame Studio', icon: 'ℹ', action: () => dialog('UltraGame Studio', (b) => { b.appendChild(h('p', 'Editor de juegos 2D y 3D para el motor UltraGame ' + (window.UG ? window.UG.VERSION : '') + '.')); b.appendChild(h('p.help', 'Almacenamiento: ' + store.label)); b.appendChild(h('p.help', 'Los juegos se prueban en un iframe aislado (sandbox) y se exportan como HTML5 con una política de seguridad de contenido estricta.')); }) }
  ]
};
async function run(fn) { try { await fn(); } catch (e) { toast(e.message, 'error'); console.error(e); } }
const menubar = document.getElementById('menubar');
// móvil: un solo botón ☰ con todos los menús agrupados
document.getElementById('btn-hamburger').onclick = (e) => { const items = []; Object.keys(MENUS).forEach((name) => { items.push({ group: name }); MENUS[name]().forEach((it) => { if (it && !it.group) items.push(it); }); }); showMenu(items, e.currentTarget); };
Object.keys(MENUS).forEach((name) => {
  const b = h('button', { type: 'button', 'aria-haspopup': 'menu' }, name);
  b.onclick = () => { if (b.classList.contains('open')) { b.classList.remove('open'); return; } b.classList.add('open'); showMenu(MENUS[name](), b, () => b.classList.remove('open')); };
  menubar.appendChild(b);
});
function shortcutsDialog() {
  const rows = [['Ctrl+S', 'Guardar'], ['Ctrl+Z / Ctrl+Y', 'Deshacer / rehacer'], ['Ctrl+C / Ctrl+V / Ctrl+D', 'Copiar / pegar / duplicar'], ['Supr', 'Borrar la selección'], ['F2', 'Renombrar'], ['A', 'Añadir objeto'], ['Q o W / E / R', 'Mover / rotar / escalar'], ['G', 'Activar/desactivar la rejilla'], ['F', 'Centrar en la selección'], ['H', 'Ver toda la escena'], ['Flechas', 'Mover la selección (Mayús: más)'], ['F5 / Mayús+F5', 'Jugar / jugar esta escena'], ['Esc', 'Detener el juego o quitar la selección'], ['Ctrl+O', 'Proyectos'], ['Ctrl+/', 'Comentar líneas (en el editor de código)']];
  dialog('Atajos de teclado', (b) => rows.forEach((r) => b.appendChild(h('div.field', h('label', { style: { fontFamily: 'var(--mono)' } }, r[0]), h('span', r[1])))));
}

/* ================================================================ atajos de teclado */
function typing(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
document.addEventListener('keydown', (e) => {
  if (e.key === ' ') app.keys.add(' ');
  if (document.getElementById('overlay').hidden === false) return; // hay un diálogo abierto
  const k = e.key, ctrl = e.ctrlKey || e.metaKey;
  if (k === 'F5') { e.preventDefault(); play(e.shiftKey); return; }
  if (ctrl && (k === 's' || k === 'S')) { e.preventDefault(); app.code.commit.flush(); editor.save(); return; }
  if (ctrl && (k === 'o' || k === 'O')) { e.preventDefault(); projectManager(false); return; }
  if (ctrl && e.shiftKey && (k === 'f' || k === 'F')) { e.preventDefault(); app.layout.toggleFocus(); return; }
  if (app.tab === 'art') return; // el editor de imágenes tiene sus propios atajos
  if (typing(e) || !editor.project) return;
  if (k === 'Escape') { if (app.player.playing) app.player.stop(); else editor.select([]); return; }
  if (ctrl && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) editor.redo(); else editor.undo(); return; }
  if (ctrl && (k === 'y' || k === 'Y')) { e.preventDefault(); editor.redo(); return; }
  if (ctrl && (k === 'c' || k === 'C')) { editor.copySelected(); return; }
  if (ctrl && (k === 'v' || k === 'V')) { editor.paste(); return; }
  if (ctrl && (k === 'd' || k === 'D')) { e.preventDefault(); editor.duplicateSelected(); return; }
  if (ctrl && (k === 'a' || k === 'A')) { e.preventDefault(); if (editor.scene) editor.select(editor.scene.nodes.map((n) => n.id)); return; }
  if (ctrl || e.altKey) return;
  if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); editor.removeSelected(); return; }
  if (k === 'F2' && editor.selected) { e.preventDefault(); app.tree.rename(editor.selected); return; }
  if (app.tab !== 'scene') return;
  // WASD con el botón derecho pulsado es vuelo en 3D: no confundir con herramientas
  if (app.viewport && app.viewport.kind === '3d' && app.viewport.drag && app.viewport.drag.mode === 'orbit') return;
  const kl = k.toLowerCase();
  if (kl === 'q' || kl === 'w') setTool('select'); else if (kl === 'e') setTool('rotate'); else if (kl === 'r') setTool('scale');
  else if (kl === 'g') { const c = document.getElementById('chk-snap'); c.checked = !c.checked; c.onchange({ target: c }); toast('Rejilla ' + (c.checked ? 'activada' : 'desactivada')); }
  else if (kl === 'f') app.focusSelection();
  else if (kl === 'h' && app.viewport) app.viewport.home();
  else if (kl === 'a') { const r = vpHost.getBoundingClientRect(); app.addNodeMenu({ x: r.left + r.width / 2 - 100, y: r.top + 60 }, null); }
  else if (k.startsWith('Arrow') && app.viewport && editor.selection.length) { e.preventDefault(); const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k]; app.viewport.nudge(d[0], d[1], e.shiftKey); }
});
document.addEventListener('keyup', (e) => { if (e.key === ' ') app.keys.delete(' '); });
window.addEventListener('blur', () => app.keys.clear());
window.addEventListener('beforeunload', (e) => { if (editor.dirty || editor.saving) { editor.autosave.flush(); e.preventDefault(); e.returnValue = ''; } });

/* ================================================================ inicio */
const sm = document.getElementById('storage-mode');
sm.textContent = store.kind === 'server' ? '💾 Disco' : '🌐 Navegador';
sm.title = store.label;
welcome(true);
(async () => {
  let last = null; try { last = localStorage.getItem('ugs-last-project'); } catch (e) { /* modo privado */ }
  if (last && last.startsWith(store.kind + ':')) {
    const id = last.slice(store.kind.length + 1);
    try { const list = await store.list(); if (list.some((p) => p.id === id)) { await openProject(id); return; } } catch (e) { /* se muestra el gestor */ }
  }
  projectManager(false);
})();
