/* UltraGame Studio · paneles: escenas, jerarquía, inspector, recursos, biblioteca y consola. */
import { originsField } from './backendpanel.js';
import { h, clear, showMenu, prompt, confirm, toast, fmtBytes } from './dom.js';
import { field, section } from './fields.js';
import { LIB_2D, LIB_3D, libThumb, addLibraryAsset } from './library.js';
import { DEFAULT_SCRIPT } from './editor.js';

const S = window.UGStudio.schema;
const TYPE_ICON = { image: '🖼️', audio: '🔊', model: '🗿', tilemap: '🗺️', font: '🔤', data: '📄' };
const ASSET_TYPE_LABEL = { image: 'imagen', audio: 'sonido', model: 'modelo 3D', tilemap: 'mapa', font: 'fuente', data: 'datos' };

/* =================================================================== escenas */
export class ScenesPanel {
  constructor(app) {
    this.app = app; this.el = document.getElementById('scene-list');
    const ed = app.editor;
    ['project', 'scene'].forEach((ev) => ed.on(ev, () => this.render()));
    ed.on('change', (d) => { if (d.kind === 'all' || d.kind === 'scenes') this.render(); });
    document.getElementById('btn-add-scene2d').onclick = () => ed.project && ed.addScene('2d');
    document.getElementById('btn-add-scene3d').onclick = () => ed.project && ed.addScene('3d');
  }
  render() {
    const ed = this.app.editor; clear(this.el); if (!ed.project) return;
    ed.project.scenes.forEach((sc) => {
      const li = h('li', { class: sc.id === ed.sceneId ? 'on' : null, role: 'option', 'aria-selected': sc.id === ed.sceneId ? 'true' : 'false', title: 'Clic: abrir · doble clic: renombrar · clic derecho: más opciones' },
        h('span', sc.kind === '3d' ? '🧊' : '🟦'), h('span.grow', sc.name), ed.project.startScene === sc.id ? h('span.start', '★ inicio') : null, h('span.kind', sc.kind.toUpperCase()));
      li.onclick = () => ed.setScene(sc.id);
      li.ondblclick = () => this.rename(sc);
      li.oncontextmenu = (e) => { e.preventDefault(); this.menu(sc, e); };
      this.el.appendChild(li);
    });
  }
  async rename(sc) { const v = await prompt('Renombrar escena', 'Nombre de la escena', sc.name); if (v) this.app.editor.edit('Renombrar escena', () => { sc.name = v.slice(0, 80); }, 'scenes'); }
  menu(sc, e) {
    const ed = this.app.editor;
    showMenu([
      { label: 'Abrir', icon: '📂', action: () => ed.setScene(sc.id) },
      { label: 'Renombrar…', icon: '✏️', action: () => this.rename(sc) },
      { label: 'Escena inicial', icon: '★', disabled: ed.project.startScene === sc.id, action: () => ed.edit('Escena inicial', (p) => { p.startScene = sc.id; }, 'scenes') },
      { label: 'Duplicar', icon: '⧉', action: () => { const c = JSON.parse(JSON.stringify(sc)); c.id = S.uid('s'); c.name = sc.name + ' (copia)'; const map = new Map(); c.nodes.forEach((n) => map.set(n.id, S.uid('n'))); c.nodes.forEach((n) => { n.id = map.get(n.id); if (n.parent) n.parent = map.get(n.parent) || null; }); c.events.forEach((ev) => { ev.id = S.uid('e'); }); ed.edit('Duplicar escena', (p) => { p.scenes.push(c); }, 'scenes'); ed.setScene(c.id); } },
      '-',
      { label: 'Borrar escena', icon: '🗑️', disabled: ed.project.scenes.length <= 1, action: async () => { if (await confirm('Borrar escena', '¿Borrar "' + sc.name + '" y todos sus objetos? (se puede deshacer con Ctrl+Z)', 'Borrar', true)) ed.removeScene(sc.id); } }
    ], { x: e.clientX, y: e.clientY });
  }
}

/* =================================================================== jerarquía */
export class TreePanel {
  constructor(app) {
    this.app = app; this.el = document.getElementById('tree'); this.filter = document.getElementById('tree-filter'); this.collapsed = new Set();
    const ed = app.editor;
    ['project', 'scene', 'selection'].forEach((ev) => ed.on(ev, () => this.render()));
    ed.on('change', (d) => { if (d.kind !== 'transform' && d.kind !== 'assets') this.render(); });
    this.filter.addEventListener('input', () => this.render());
    this.filter.addEventListener('keydown', (e) => e.stopPropagation());
    document.getElementById('btn-add-node').onclick = (e) => this.app.addNodeMenu(e.currentTarget, null);
    this.el.addEventListener('contextmenu', (e) => { if (e.target === this.el) { e.preventDefault(); this.app.addNodeMenu({ x: e.clientX, y: e.clientY }, null); } });
    this.el.addEventListener('dragover', (e) => { if (this.dragId && e.target === this.el) e.preventDefault(); });
    this.el.addEventListener('drop', (e) => { if (this.dragId && e.target === this.el) { e.preventDefault(); ed.reparent(this.dragId, null, null); this.dragId = null; } });
  }
  render() {
    const ed = this.app.editor; clear(this.el);
    const sc = ed.scene; if (!sc) return;
    const q = this.filter.value.trim().toLowerCase(), sel = new Set(ed.selection);
    let show = null;
    if (q) { show = new Set(); const byId = new Map(sc.nodes.map((n) => [n.id, n])); sc.nodes.forEach((n) => { if (n.name.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q))) { for (let p = n; p; p = byId.get(p.parent)) show.add(p.id); } }); }
    const kids = new Map(); sc.nodes.forEach((n) => { const k = n.parent || ''; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(n); });
    const build = (pid, ul, depth) => {
      (kids.get(pid) || []).forEach((n) => {
        if (show && !show.has(n.id)) return;
        const T = S.NODE_TYPES[n.type], has = kids.has(n.id), col = this.collapsed.has(n.id) && !q;
        const row = h('div.row', { class: [sel.has(n.id) ? 'on' : '', n.visible ? '' : 'hidden-node'].join(' ').trim() || null, draggable: true, title: T.label + (n.tags.length ? ' · #' + n.tags.join(' #') : '') },
          h('span.tw', has ? (col ? '▸' : '▾') : ''), h('span.ic', T.icon), h('span.name', n.name), n.prefab ? h('span.badge-prefab', 'plantilla') : null,
          n.script ? h('span', { title: 'Tiene script' }, '{ }') : null, n.behaviors.length ? h('span', { title: n.behaviors.length + ' comportamiento(s)' }, '⚙') : null,
          h('button.icon.vis', { type: 'button', title: n.visible ? 'Ocultar' : 'Mostrar' }, n.visible ? '👁' : '🚫'));
        row.querySelector('.tw').onclick = (e) => { e.stopPropagation(); if (this.collapsed.has(n.id)) this.collapsed.delete(n.id); else this.collapsed.add(n.id); this.render(); };
        row.querySelector('.vis').onclick = (e) => { e.stopPropagation(); ed.setField(n.id, 'visible', !n.visible, n.visible ? 'Ocultar' : 'Mostrar'); };
        row.onclick = (e) => ed.select(n.id, e.ctrlKey || e.metaKey);
        row.ondblclick = () => this.rename(n);
        row.oncontextmenu = (e) => { e.preventDefault(); if (!sel.has(n.id)) ed.select(n.id); this.menu(n, e); };
        row.ondragstart = (e) => { this.dragId = n.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.name); };
        row.ondragend = () => { this.dragId = null; this.el.querySelectorAll('.drop-into,.drop-before').forEach((x) => x.classList.remove('drop-into', 'drop-before')); };
        row.ondragover = (e) => { if (!this.dragId || this.dragId === n.id) return; e.preventDefault(); const r = row.getBoundingClientRect(), before = e.clientY < r.top + r.height * 0.3; row.classList.toggle('drop-before', before); row.classList.toggle('drop-into', !before); };
        row.ondragleave = () => row.classList.remove('drop-into', 'drop-before');
        row.ondrop = (e) => { if (!this.dragId) return; e.preventDefault(); e.stopPropagation(); const before = row.classList.contains('drop-before'); row.classList.remove('drop-into', 'drop-before'); if (before) ed.reparent(this.dragId, n.parent, n.id); else { this.collapsed.delete(n.id); ed.reparent(this.dragId, n.id, null); } this.dragId = null; };
        const li = h('li', { role: 'treeitem', 'aria-selected': sel.has(n.id) ? 'true' : 'false' }, row);
        if (has && !col) { const sub = h('ul', { role: 'group' }); build(n.id, sub, depth + 1); li.appendChild(sub); }
        ul.appendChild(li);
      });
    };
    build('', this.el, 0);
    if (!sc.nodes.length) this.el.appendChild(h('li.empty', 'Escena vacía: pulsa «＋ Añadir» o arrastra un recurso a la vista.'));
    const on = this.el.querySelector('.row.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }
  async rename(n) { const v = await prompt('Renombrar', 'Nombre del objeto (los eventos y scripts lo buscan por nombre)', n.name); if (v) this.app.editor.setField(n.id, 'name', v.slice(0, 80), 'Renombrar'); }
  menu(n, e) {
    const ed = this.app.editor;
    showMenu([
      { label: 'Renombrar…', icon: '✏️', key: 'F2', action: () => this.rename(n) },
      { label: 'Duplicar', icon: '⧉', key: 'Ctrl+D', action: () => ed.duplicateSelected() },
      { label: 'Copiar', icon: '📋', key: 'Ctrl+C', action: () => ed.copySelected() },
      { label: 'Pegar', icon: '📥', key: 'Ctrl+V', disabled: !ed.clipboard, action: () => ed.paste() },
      '-',
      { label: 'Añadir hijo…', icon: '＋', action: () => this.app.addNodeMenu({ x: e.clientX, y: e.clientY }, n.id) },
      { label: 'Sacar del grupo', icon: '⤴', disabled: !n.parent, action: () => ed.reparent(n.id, null, null) },
      { label: n.prefab ? 'Dejar de ser plantilla' : 'Convertir en plantilla (para «Crear copia»)', icon: '🧬', action: () => ed.setField(n.id, 'prefab', !n.prefab, 'Plantilla') },
      { label: 'Centrar la vista aquí', icon: '⌖', key: 'F', action: () => this.app.focusSelection() },
      '-',
      { label: 'Borrar', icon: '🗑️', key: 'Supr', action: () => ed.removeSelected() }
    ], { x: e.clientX, y: e.clientY });
  }
}

/* =================================================================== inspector */
export class Inspector {
  constructor(app) {
    this.app = app; this.el = document.getElementById('inspector'); this.title = document.getElementById('inspector-title'); this.assetSel = null;
    const ed = app.editor;
    ['project', 'scene', 'selection'].forEach((ev) => ed.on(ev, () => { if (ev !== 'project') this.assetSel = null; this.render(); }));
    ed.on('change', (d) => { if (!this.editing) this.renderSoon(d.kind); });
  }
  renderSoon(kind) {
    if (kind === 'transform' && this.el.querySelector('.field input:focus')) return; // no pisar lo que se está escribiendo
    clearTimeout(this._t); this._t = setTimeout(() => this.render(), 30);
  }
  ctx() { return { editor: this.app.editor, importFor: (type, cb) => this.app.importFiles(type, cb) }; }
  render() {
    const ed = this.app.editor, top = this.el.scrollTop; clear(this.el);
    if (!ed.project) { this.title.textContent = 'Inspector'; this.el.appendChild(h('div.empty', 'Abre o crea un proyecto.')); return; }
    if (this.assetSel && ed.assetById(this.assetSel)) this.renderAsset(ed.assetById(this.assetSel));
    else if (ed.selection.length > 1) { this.title.textContent = 'Inspector'; this.el.appendChild(h('div.empty', ed.selection.length + ' objetos seleccionados. Arrástralos en la vista para moverlos juntos, o Supr para borrarlos.')); }
    else if (ed.selected) this.renderNode(ed.selected);
    else this.renderScene(ed.scene);
    this.el.scrollTop = top;
  }
  /* ---------------- nodo */
  renderNode(n) {
    const ed = this.app.editor, T = S.NODE_TYPES[n.type], is3d = T.kind === '3d', ctx = this.ctx(), set = (path, label) => (v) => ed.setField(n.id, path, v, label);
    this.title.textContent = T.label;
    const name = h('input', { type: 'text', value: n.name, maxlength: 80, spellcheck: 'false', 'aria-label': 'Nombre' });
    name.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') name.blur(); });
    name.addEventListener('change', () => { const v = name.value.trim(); if (v) ed.setField(n.id, 'name', v.slice(0, 80), 'Renombrar'); else name.value = n.name; });
    this.el.appendChild(h('div.insp-head', h('span.ic', T.icon), name,
      h('label.chk', { title: 'Visible al empezar' }, h('input', { type: 'checkbox', checked: n.visible, on: { change: (e) => ed.setField(n.id, 'visible', e.target.checked) } }), '👁')));
    // transformación
    const tf = (is3d ? S.TRANSFORM_3D : S.TRANSFORM_2D).filter((f) => !(f.key === 'hud' && ed.scene.kind === '3d'));
    this.el.appendChild(section('tf', 'Transformación', tf.map((f) => field(f, n[f.key], set(f.key), ctx))));
    // propiedades del tipo
    if (T.props.length) {
      const fields = T.props.map((f) => {
        if (n.type === 'model' && f.key === 'clip') return this.clipField(n, f, set('props.clip', 'Animación'));
        return field(f, n.props[f.key], set('props.' + f.key, f.label), ctx);
      });
      if (n.type === 'sprite' && n.props.asset) { const a = ed.assetById(n.props.asset); if (a && a.frameWidth > 0) fields.push(h('div.help', 'Hoja de sprites: ' + a.frameWidth + '×' + (a.frameHeight || a.frameWidth) + ' px por fotograma.')); }
      if (n.type === 'gridlevel') fields.push(h('div.help', 'Cada carácter es una celda. Los muros ya tienen colisión.'));
      this.el.appendChild(section('props:' + n.type, T.label, fields));
    }
    // plantilla
    this.el.appendChild(section('prefab', 'Plantilla', [field({ key: 'prefab', label: 'Es plantilla (no aparece al empezar; se usa con «Crear copia»)', type: 'bool' }, n.prefab, set('prefab', 'Plantilla'), ctx)], { closed: !n.prefab }));
    // etiquetas y variables
    this.el.appendChild(section('tags', 'Etiquetas', this.tagsEditor(n), { count: n.tags.length }));
    this.el.appendChild(section('vars', 'Variables propias', this.varsEditor(n.vars, (vars) => ed.setField(n.id, 'vars', vars, 'Variables')), { count: Object.keys(n.vars).length, closed: !Object.keys(n.vars).length }));
    // comportamientos
    this.el.appendChild(section('beh', 'Comportamientos (sin código)', this.blocksEditor(n, 'behaviors', S.BEHAVIORS, is3d ? '3d' : '2d'), { count: n.behaviors.length }));
    // física
    const phys = is3d ? S.PHYSICS_3D : S.PHYSICS_2D;
    // solo los campos que aplican a este tipo de cuerpo y al motor de la escena (arcade o rígido)
    const engine = !is3d && ed.scene && ed.scene.env2d ? ed.scene.env2d.engine : 'arcade', pt = n.physics.type;
    const applies = (f) => f.key === 'type' || f.always || (pt !== 'none' && (!f.types || f.types.includes(pt)) && (!f.engine || f.engine === engine) && (!f.when || n.physics[f.when.key] === f.when.eq));
    const physFields = phys.filter(applies).map((f) => field(f, n.physics[f.key], set('physics.' + f.key, 'Física: ' + f.label), ctx));
    if (!is3d && pt !== 'none' && !n.hud) physFields.push(h('div.help', 'El recuadro naranja de la vista es el cuerpo que choca. «Ajustado al dibujo» ignora los bordes transparentes de la imagen.'));
    else if (is3d && pt !== 'none') physFields.push(h('div.help', pt === 'mesh' ? 'Choca con los triángulos del modelo (se puede entrar en casas y subir rampas). En la vista solo se marca su caja, tenue.' : pt === 'character' ? 'La cápsula azul de la vista es lo que choca: empieza en la base del modelo; ajusta el radio y la altura.' : 'Las líneas de la vista (casilla «Colisiones») son lo que choca en el juego.'));
    if (!is3d && n.hud) physFields.push(h('div.help', 'Los objetos del HUD no tienen física.'));
    this.el.appendChild(section('phys', 'Física', physFields, { closed: n.physics.type === 'none' }));
    // efectos (2D)
    if (!is3d) this.el.appendChild(section('fx', 'Efectos visuales', this.blocksEditor(n, 'effects', S.EFFECTS, null), { count: n.effects.length, closed: !n.effects.length }));
    // script
    this.el.appendChild(section('script', 'Script (código)', this.scriptEditor(n), { closed: !n.script }));
  }
  clipField(n, f, commit) {
    const clips = this.app.clipsOf ? this.app.clipsOf(n.props.asset) : [];
    if (!clips.length) return field(f, n.props.clip, commit, this.ctx());
    return field({ key: 'clip', label: f.label, type: 'select', options: [['', '— ninguna —']].concat(clips.map((c) => [c, c])) }, n.props.clip, commit, this.ctx());
  }
  tagsEditor(n) {
    const ed = this.app.editor;
    const chips = h('div.chips', n.tags.map((t) => h('span.chip', '#' + t, h('button', { type: 'button', title: 'Quitar', on: { click: () => ed.setField(n.id, 'tags', n.tags.filter((x) => x !== t), 'Quitar etiqueta') } }, '✕'))));
    const inp = h('input', { type: 'text', placeholder: 'nueva etiqueta (ej. jugador)', maxlength: 32, spellcheck: 'false' });
    const addIt = () => {
      const v = inp.value.trim().replace(/\s+/g, '-'); if (!v) return;
      if (!/^[A-Za-z0-9_\u00c0-\u024f-]{1,32}$/.test(v)) { toast('Etiqueta no válida (letras, números, - y _)', 'warn'); return; }
      if (n.tags.includes(v)) { toast('Ya tiene la etiqueta #' + v, 'warn'); inp.value = ''; return; }
      if (n.tags.length >= 16) { toast('Máximo 16 etiquetas por objeto', 'warn'); return; }
      ed.setField(n.id, 'tags', n.tags.concat([v]), 'Añadir etiqueta');
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); addIt(); } });
    return [chips, h('div.field.wide', h('div.row-actions', inp, h('button.btn.small', { type: 'button', on: { click: addIt } }, 'Añadir'))), h('div.help', 'Las etiquetas agrupan objetos: «Perseguir», «Coleccionable» o los eventos de colisión usan tag:nombre.')];
  }
  varsEditor(vars, commit) {
    const rows = Object.keys(vars).map((k) => {
      const v = h('input', { type: 'text', value: String(vars[k]), spellcheck: 'false' });
      v.addEventListener('keydown', (e) => e.stopPropagation());
      v.addEventListener('change', () => { const o = Object.assign({}, vars); const t = v.value.trim(); o[k] = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) && Number.isFinite(Number(t)) && (Number.isSafeInteger(Number(t)) || !/^[+-]?\d+$/.test(t)) ? Number(t) : t === 'true' ? true : t === 'false' ? false : v.value; commit(o); }); // 0x… y enteros enormes quedan como texto
      return h('div.field', h('label', { title: k }, k), h('div', { style: { display: 'flex', gap: '4px' } }, v, h('button.icon', { type: 'button', title: 'Borrar variable', on: { click: () => { const o = Object.assign({}, vars); delete o[k]; commit(o); } } }, '✕')));
    });
    const add = h('button.btn.small', { type: 'button', on: { click: async () => { const k = await prompt('Nueva variable', 'Nombre (letras, números y _)', ''); if (!k) return; if (!/^[A-Za-z_\u00c0-\u024f][A-Za-z0-9_\u00c0-\u024f]{0,39}$/.test(k) || S.isForbiddenKey(k)) { toast('Nombre no válido', 'warn'); return; } const o = Object.assign({}, vars); o[k] = 0; commit(o); } } }, '＋ Variable');
    return rows.concat([h('div.row-actions', add), h('div.help', 'Úsalas en textos como {nombre} y en eventos/scripts (api.get / api.set).')]);
  }
  blocksEditor(n, key, table, kind) {
    const ed = this.app.editor, ctx = this.ctx(), list = n[key];
    const cards = list.map((b, i) => {
      const T = table[b.type], upd = (params) => ed.setField(n.id, key, list.map((x, j) => (j === i ? { type: x.type, params } : x)), T.label);
      return h('div.card', h('div.card-head', h('span', T.icon || '✨'), h('span.grow', T.label),
        h('button.icon', { type: 'button', title: 'Subir', disabled: i === 0, on: { click: () => { const l = list.slice(); l.splice(i - 1, 0, l.splice(i, 1)[0]); ed.setField(n.id, key, l, 'Reordenar'); } } }, '▲'),
        h('button.icon', { type: 'button', title: 'Quitar', on: { click: () => ed.setField(n.id, key, list.filter((_, j) => j !== i), 'Quitar ' + T.label) } }, '✕')),
        T.desc ? h('div.desc', T.desc) : null,
        T.params.map((p) => field(p, b.params[p.key], (v) => upd(Object.assign({}, b.params, { [p.key]: v })), ctx)));
    });
    const addBtn = h('button.btn.small', { type: 'button' }, key === 'effects' ? '＋ Añadir efecto' : '＋ Añadir comportamiento');
    addBtn.onclick = () => {
      const items = Object.keys(table).filter((k) => !kind || table[k].kind === 'both' || table[k].kind === kind).map((k) => ({ label: table[k].label, icon: table[k].icon || '✨', title: table[k].desc, action: () => {
        const params = S.defaultsOf(table[k].params); ed.setField(n.id, key, list.concat([{ type: k, params }]), 'Añadir ' + table[k].label);
        if (key === 'behaviors') this.autoPhysics(n, k);
      } }));
      showMenu(items, addBtn);
    };
    return cards.concat([h('div.row-actions', addBtn)]);
  }
  /** Ayuda: algunos comportamientos necesitan física; se configura sola */
  autoPhysics(n, type) {
    const ed = this.app.editor, need2d = { platformer: 'dynamic' }, need3d = { fpsPlayer: 'character', tpsPlayer: 'character' };
    const want = (S.NODE_TYPES[n.type].kind === '3d' ? need3d : need2d)[type];
    const node = ed.node(n.id);
    if (want && node && node.physics.type !== want) { ed.setField(n.id, 'physics.type', want, 'Física automática'); toast('Física puesta en «' + want + '» porque este comportamiento la necesita'); }
  }
  scriptEditor(n) {
    const ed = this.app.editor, scripts = ed.project.scripts;
    const sel = h('select', { on: { change: (e) => ed.setField(n.id, 'script', e.target.value || null, 'Script') } }, h('option', { value: '' }, '— sin script —'), scripts.map((s) => h('option', { value: s.id, selected: s.id === n.script }, s.name)));
    const mk = h('button.btn.small', { type: 'button', on: { click: () => { const s = ed.addScript(n.name.toLowerCase().replace(/\s+/g, '_').slice(0, 40), DEFAULT_SCRIPT); ed.setField(n.id, 'script', s.id, 'Crear script'); this.app.openScript(s.id); } } }, '＋ Nuevo script');
    const open = h('button.btn.small', { type: 'button', disabled: !n.script, on: { click: () => this.app.openScript(n.script) } }, '✏️ Editar');
    return [h('div.field', h('label', 'Script'), sel), h('div.row-actions', mk, open), h('div.help', 'Varios objetos pueden compartir el mismo script: cada uno tiene su propia copia de las variables.')];
  }
  /* ---------------- escena */
  renderScene(sc) {
    const ed = this.app.editor, ctx = this.ctx(); if (!sc) return;
    this.title.textContent = 'Escena';
    const name = h('input', { type: 'text', value: sc.name, maxlength: 80, spellcheck: 'false', 'aria-label': 'Nombre de la escena' });
    name.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') name.blur(); });
    name.addEventListener('change', () => { const v = name.value.trim(); if (v) ed.edit('Renombrar escena', () => { sc.name = v.slice(0, 80); }, 'scenes'); });
    this.el.appendChild(h('div.insp-head', h('span.ic', sc.kind === '3d' ? '🧊' : '🟦'), name));
    const setS = (k, label) => (v) => ed.edit(label || 'Cambiar escena', () => { sc[k] = v; }, 'scene');
    const base = [field({ key: 'background', label: 'Color de fondo', type: 'color' }, sc.background, setS('background', 'Fondo'), ctx)];
    if (sc.kind === '2d') base.push(field({ key: 'gravity', label: 'Gravedad (px/s², hacia abajo)', type: 'number', step: 50 }, sc.gravity, setS('gravity', 'Gravedad'), ctx));
    base.push(h('div.row-actions', ed.project.startScene === sc.id ? h('span.help', '★ Es la escena inicial') : h('button.btn.small', { type: 'button', on: { click: () => ed.edit('Escena inicial', (p) => { p.startScene = sc.id; }, 'scenes') } }, '★ Hacer escena inicial')));
    this.el.appendChild(section('scene', 'Escena', base));
    if (sc.kind === '3d') this.el.appendChild(section('env', 'Entorno 3D (cielo, nubes, día/noche, clima)', S.SCENE_ENV.map((f) => field(f, sc.env[f.key], (v) => ed.edit('Entorno: ' + f.label, () => { sc.env[f.key] = v; }, 'scene'), ctx))));
    if (sc.kind === '2d') {
      const e2 = sc.env2d || (sc.env2d = S.defaultsOf(S.SCENE_ENV_2D));
      this.el.appendChild(section('env2d', 'Entorno 2D (física, luces, clima)', S.SCENE_ENV_2D.map((f) => field(f, e2[f.key], (v) => ed.edit('Entorno 2D: ' + f.label, () => { (sc.env2d || (sc.env2d = S.defaultsOf(S.SCENE_ENV_2D)))[f.key] = v; }, 'scene'), ctx)).concat([
        h('div.help', 'Cuerpos rígidos: los objetos giran, se apilan y ruedan (densidad, fricción en su Física). Luces 2D: añade nodos «Luz 2D» y marca «Proyecta sombra» en la Física de los objetos que tapan la luz.')])));
    }
    const fakeNode = { id: '__scene', effects: sc.effects, behaviors: [] };
    this.el.appendChild(section('scfx', 'Posproceso (efectos de pantalla)', this.sceneEffects(sc), { count: sc.effects.length }));
    this.el.appendChild(section('gvars', 'Variables globales del juego', this.varsEditor(ed.project.vars, (vars) => ed.edit('Variables globales', (p) => { p.vars = vars; }, 'project')), { count: Object.keys(ed.project.vars).length }));
    this.el.appendChild(section('scscript', 'Script de escena', [h('div.row-actions', h('button.btn.small', { type: 'button', on: { click: () => this.app.openScript('__scene') } }, sc.script.trim() ? '✏️ Editar script de escena' : '＋ Crear script de escena')), h('div.help', 'Código que corre mientras la escena está activa (onStart / onUpdate) y funciones para los eventos.')], { closed: !sc.script.trim() }));
    const P = ed.project.settings;
    const setP = (k, label) => (v) => ed.edit(label, (p) => { p.settings[k] = v; }, 'project');
    this.el.appendChild(section('proj', 'Proyecto', [
      field({ key: 'name', label: 'Nombre del juego', type: 'text' }, ed.project.name, (v) => ed.edit('Nombre del proyecto', (p) => { p.name = String(v).slice(0, 80) || p.name; }, 'project'), ctx),
      field({ key: 'width', label: 'Ancho del juego (px)', type: 'number', min: 64, max: 8192, step: 1 }, P.width, setP('width', 'Ancho'), ctx),
      field({ key: 'height', label: 'Alto del juego (px)', type: 'number', min: 64, max: 8192, step: 1 }, P.height, setP('height', 'Alto'), ctx),
      field({ key: 'scale', label: 'Ajuste a la ventana', type: 'select', options: [['fit', 'Encajar (bandas)'], ['envelop', 'Cubrir (recorta)'], ['resize', 'Redimensionar'], ['none', 'Tamaño fijo']] }, P.scale, setP('scale', 'Ajuste'), ctx),
      field({ key: 'renderer', label: 'Renderizador del juego', type: 'select', options: [['auto', 'Automático (recomendado)'], ['webgpu', 'WebGPU'], ['webgl2', 'WebGL2'], ['webgl', 'WebGL'], ['canvas', 'Canvas (solo 2D)']] }, P.renderer, setP('renderer', 'Renderizador'), ctx),
      field({ key: 'pixelArt', label: 'Pixel art (sin suavizado)', type: 'bool' }, P.pixelArt, setP('pixelArt', 'Pixel art'), ctx),
      field({ key: 'background', label: 'Color de las bandas', type: 'color' }, P.background, setP('background', 'Color de bandas'), ctx)
    ], { closed: true }));
    this.el.appendChild(section('conn', 'Conexiones (puente, APIs externas)', [
      originsField('Orígenes del puente (páginas que pueden hablar con el juego si va en un iframe)', ed.project.settings.bridgeOrigins, (list) => ed.edit('Orígenes del puente', (p) => { p.settings.bridgeOrigins = list; }, 'project')),
      originsField('Orígenes permitidos para peticiones (APIs https externas)', ed.project.settings.connectOrigins, (list) => ed.edit('Orígenes permitidos', (p) => { p.settings.connectOrigins = list; }, 'project')),
      h('div.help', 'El juego solo puede hacer peticiones a tu backend y a estos orígenes (también se añaden a la política de seguridad del HTML exportado). El puente usa postMessage solo con estos orígenes; en la misma página, escucha el evento «ug-bridge-out» y llama a game.bridge.receive(nombre, datos).')
    ], { closed: true }));
    void fakeNode;
  }
  sceneEffects(sc) {
    const ed = this.app.editor, ctx = this.ctx(), list = sc.effects;
    const cards = list.map((b, i) => { const T = S.EFFECTS[b.type]; return h('div.card', h('div.card-head', h('span', '✨'), h('span.grow', T.label), h('button.icon', { type: 'button', title: 'Quitar', on: { click: () => ed.edit('Quitar efecto', () => { sc.effects = list.filter((_, j) => j !== i); }, 'scene') } }, '✕')),
      T.params.map((p) => field(p, b.params[p.key], (v) => ed.edit(T.label, () => { sc.effects[i] = { type: b.type, params: Object.assign({}, b.params, { [p.key]: v }) }; }, 'scene'), ctx))); });
    const add = h('button.btn.small', { type: 'button' }, '＋ Añadir efecto');
    add.onclick = () => showMenu(Object.keys(S.EFFECTS).map((k) => ({ label: S.EFFECTS[k].label, icon: '✨', action: () => ed.edit('Añadir ' + S.EFFECTS[k].label, () => { if (sc.effects.length < 8) sc.effects.push({ type: k, params: S.defaultsOf(S.EFFECTS[k].params) }); }, 'scene') })), add);
    return cards.concat([h('div.row-actions', add), h('div.help', sc.kind === '3d' ? 'Se aplican a la imagen 3D (bloom, viñeta, CRT…).' : 'Se aplican a toda la pantalla de la escena.')]);
  }
  /* ---------------- recurso */
  renderAsset(a) {
    const ed = this.app.editor, ctx = this.ctx();
    this.title.textContent = 'Recurso';
    const prev = h('div.th', { style: { height: '140px', borderRadius: '8px', background: '#0b0d14', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '48px', overflow: 'hidden' } }, TYPE_ICON[a.type] || '📄');
    if (a.type === 'image') ed.assetURL(a).then((u) => { clear(prev); prev.appendChild(h('img', { src: u, alt: a.name, style: { maxWidth: '100%', maxHeight: '100%' } })); }).catch(() => {});
    const setA = (k, label) => (v) => ed.edit(label, () => { const x = ed.assetById(a.id); if (x) x[k] = v; }, 'assets');
    const body = [prev, field({ key: 'name', label: 'Nombre', type: 'text' }, a.name, (v) => setA('name', 'Renombrar recurso')(String(v).slice(0, 80) || a.name), ctx), h('div.help', a.file + ' · ' + a.type)];
    if (a.type === 'image') body.push(field({ key: 'frameWidth', label: 'Ancho de fotograma (0 = imagen única)', type: 'number', min: 0, max: 8192, step: 1 }, a.frameWidth, setA('frameWidth', 'Hoja de sprites'), ctx), field({ key: 'frameHeight', label: 'Alto de fotograma', type: 'number', min: 0, max: 8192, step: 1 }, a.frameHeight, setA('frameHeight', 'Hoja de sprites'), ctx));
    const uses = ed.usesOfAsset(a.id);
    body.push(h('div.row-actions', h('button.btn.small', { type: 'button', on: { click: () => this.app.placeAsset(a) } }, '＋ Añadir a la escena'),
      a.type === 'image' ? h('button.btn.small', { type: 'button', title: 'Abrir en el editor de imágenes / pixel art', on: { click: () => this.app.openPaint(a.id) } }, '🎨 Editar') : null, h('button.btn.small.danger', { type: 'button', on: { click: () => this.app.deleteAsset(a) } }, '🗑 Borrar')));
    body.push(h('div.help', uses.length ? 'Se usa en: ' + uses.slice(0, 8).join(', ') + (uses.length > 8 ? '…' : '') : 'No se usa en ninguna escena.'));
    this.el.appendChild(section('asset', a.name, body));
  }
}

/* =================================================================== recursos */
export class AssetsPanel {
  constructor(app) {
    this.app = app; this.el = document.getElementById('assets');
    const ed = app.editor;
    ed.on('project', () => this.render());
    ed.on('change', (d) => { if (d.kind === 'all' || d.kind === 'assets') this.render(); });
    this.el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); this.el.classList.add('drop'); } });
    this.el.addEventListener('dragleave', () => this.el.classList.remove('drop'));
    this.el.addEventListener('drop', (e) => { this.el.classList.remove('drop'); if (e.dataTransfer.files.length) { e.preventDefault(); app.importList(Array.from(e.dataTransfer.files)); } });
  }
  async render() {
    const ed = this.app.editor, token = (this._tok = (this._tok || 0) + 1); clear(this.el);
    if (!ed.project) return;
    if (!ed.project.assets.length) { this.el.appendChild(h('div.drop-note', 'Arrastra aquí imágenes, sonidos, modelos GLB/glTF/OBJ (Blender: Archivo › Exportar › glTF 2.0 .glb) o mapas de Tiled. También puedes usar la pestaña Biblioteca.')); return; }
    for (const a of ed.project.assets) {
      const th = h('div.th', TYPE_ICON[a.type] || '📄');
      const card = h('div.asset', { draggable: true, title: a.name + ' (' + a.file + ')', class: this.app.inspector.assetSel === a.id ? 'on' : null }, th, h('div.nm', a.name), h('div.tp', (ASSET_TYPE_LABEL[a.type] || a.type) + (a.frameWidth ? ' · hoja ' + a.frameWidth + 'px' : '')),
        h('button.icon.del', { type: 'button', title: 'Borrar', on: { click: (e) => { e.stopPropagation(); this.app.deleteAsset(a); } } }, '✕'));
      card.ondragstart = (e) => { e.dataTransfer.setData('application/x-ugs-asset', a.id); e.dataTransfer.effectAllowed = 'copy'; };
      card.onclick = () => { this.app.inspector.assetSel = a.id; this.app.inspector.render(); this.el.querySelectorAll('.asset.on').forEach((x) => x.classList.remove('on')); card.classList.add('on'); };
      card.ondblclick = () => this.app.placeAsset(a);
      this.el.appendChild(card);
      if (a.type === 'image') ed.assetURL(a).then((u) => { if (token !== this._tok) return; clear(th); th.appendChild(h('img', { src: u, alt: '', loading: 'lazy' })); }).catch(() => {});
    }
  }
}

/* =================================================================== biblioteca */
export class LibraryPanel {
  constructor(app) { this.app = app; this.el = document.getElementById('library'); this.rendered = false; }
  render() {
    if (this.rendered) return; this.rendered = true; clear(this.el);
    this.el.appendChild(h('div.drop-note', { style: { padding: '8px' } }, 'Recursos incluidos con UltraGame. Clic: añadir al proyecto y colocar en la escena actual. Los sonidos no hacen falta: hay efectos sintetizados (moneda, láser, salto…).'));
    Object.keys(LIB_2D).forEach((k) => {
      const c = libThumb(k); c.style.maxWidth = '100%'; c.style.maxHeight = '100%';
      const card = h('div.asset', { title: LIB_2D[k].label }, h('div.th', c), h('div.nm', LIB_2D[k].label), h('div.tp', 'imagen 2D'));
      card.onclick = () => this.add('2d', k); this.el.appendChild(card);
    });
    Object.keys(LIB_3D).forEach((k) => {
      const card = h('div.asset', { title: LIB_3D[k].label }, h('div.th', LIB_3D[k].icon), h('div.nm', LIB_3D[k].label), h('div.tp', 'modelo 3D (GLB)'));
      card.onclick = () => this.add('3d', k); this.el.appendChild(card);
    });
  }
  async add(kind, key) {
    const ed = this.app.editor; if (!ed.project) return;
    try {
      const a = await addLibraryAsset(ed, kind, key);
      const sc = ed.scene;
      if (a.type === 'model' && sc.kind !== '3d') { toast('Añadido al proyecto. Los modelos 3D se colocan en escenas 3D.'); return; }
      this.app.placeAsset(a);
    } catch (e) { toast('No se pudo añadir: ' + e.message, 'error'); }
  }
}

/* =================================================================== consola */
export class ConsolePanel {
  constructor(app) {
    this.app = app; this.el = document.getElementById('console'); this.badge = document.getElementById('console-badge'); this.errors = 0; this.count = 0;
  }
  clear() { clear(this.el); this.errors = 0; this.count = 0; this.updateBadge(); }
  updateBadge() { this.badge.hidden = !this.errors; this.badge.textContent = String(this.errors); }
  log(level, text, source) {
    if (++this.count > 2000) { if (this.el.firstChild) this.el.removeChild(this.el.firstChild); }
    const m = /\(línea (\d+)\)/.exec(text);
    const script = source ? this.app.editor.project && this.app.editor.project.scripts.find((s) => source.startsWith(s.name)) : null;
    const isScene = source && source.startsWith('script de escena');
    const ln = h('div.ln.' + (level === 'error' ? 'error' : level === 'warn' ? 'warn' : level === 'ok' ? 'ok' : 'info'), h('span.src', new Date().toLocaleTimeString() + (source ? ' · ' + source : '')), h('span', text));
    if ((script || isScene) && m) { ln.classList.add('link'); ln.title = 'Ir a la línea ' + m[1]; ln.onclick = () => this.app.openScript(isScene ? '__scene' : script.id, +m[1]); }
    this.el.appendChild(ln); this.el.scrollTop = this.el.scrollHeight;
    if (level === 'error') { this.errors++; this.updateBadge(); }
  }
}
export function fmtAssetSize(n) { return fmtBytes(n); }
