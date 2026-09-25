/* UltraGame Studio · campos del inspector generados desde el esquema.
 * field(def, valor, onCommit, ctx) -> elemento. onCommit(valor) se llama al confirmar (cambio/intro/soltar),
 * no en cada tecla: así cada edición es un solo paso de deshacer. */
import { h } from './dom.js';

const S = window.UGStudio.schema;
const fmtNum = (v) => { if (!isFinite(v)) return '0'; const r = Math.round(v * 1000) / 1000; return String(r); };

/** Etiqueta que cambia el número al arrastrar horizontalmente (como Unity/Godot) */
function dragLabel(label, input, def, commit) {
  label.classList.add('drag'); label.title = (label.title || '') + ' · arrastra para cambiar (Mayús = fino, Ctrl = rápido)';
  label.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = parseFloat(input.value) || 0, x0 = e.clientX, step = def.step || 1;
    let moved = false, v = start;
    label.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = ev.clientX - x0; if (Math.abs(dx) > 2) moved = true;
      const k = ev.shiftKey ? 0.1 : ev.ctrlKey ? 10 : 1;
      v = start + Math.round(dx / 3) * step * k;
      if (def.min !== undefined) v = Math.max(def.min, v); if (def.max !== undefined) v = Math.min(def.max, v);
      input.value = fmtNum(v);
    };
    const up = () => { label.removeEventListener('pointermove', move); label.removeEventListener('pointerup', up); label.removeEventListener('pointercancel', up); if (moved && v !== start) commit(v); else input.focus(); };
    label.addEventListener('pointermove', move); label.addEventListener('pointerup', up); label.addEventListener('pointercancel', up);
  });
}
function numInput(def, value, commit) {
  const inp = h('input', { type: 'number', value: fmtNum(value), step: def.step || 'any', min: def.min, max: def.max });
  const done = () => { let v = parseFloat(inp.value); if (!isFinite(v)) { inp.value = fmtNum(value); return; } v = S.num(v, value, def.min, def.max); inp.value = fmtNum(v); if (v !== value) { value = v; commit(v); } };
  inp.addEventListener('change', done);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); });
  return inp;
}
function options(list, value) { return list.map((o) => h('option', { value: o[0], selected: o[0] === value }, o[1])); }

export function field(def, value, commit, ctx) {
  const id = 'f' + Math.random().toString(36).slice(2, 9);
  const label = h('label', { for: id, title: def.label }, def.label);
  let control, wide = false;
  const stop = (el) => { el.addEventListener('keydown', (e) => e.stopPropagation()); return el; };
  switch (def.type) {
    case 'number': control = numInput(def, value, commit); dragLabel(label, control, def, (v) => { value = v; commit(v); }); break;
    case 'bool': control = h('input', { type: 'checkbox', checked: !!value, on: { change: (e) => commit(e.target.checked) } }); break;
    case 'color': {
      const pick = h('input', { type: 'color', value: value || '#ffffff' }), hex = stop(h('input', { type: 'text', value: value || '#ffffff', maxlength: 7, spellcheck: 'false' }));
      pick.addEventListener('input', () => { hex.value = pick.value; });
      pick.addEventListener('change', () => commit(pick.value));
      hex.addEventListener('change', () => { const v = S.color(hex.value.trim(), null); if (v) { pick.value = v; commit(v); } else hex.value = pick.value; });
      control = h('div.color-row', pick, hex); pick.id = id; break;
    }
    case 'select': control = h('select', { on: { change: (e) => commit(e.target.value) } }, options(def.options || [], value)); break;
    case 'textarea': wide = true; control = stop(h('textarea', { spellcheck: 'false', rows: 5, value: value || '' })); control.addEventListener('change', () => commit(control.value)); break;
    case 'vec3': {
      const v = Array.isArray(value) ? value.slice() : [0, 0, 0];
      const parts = ['x', 'y', 'z'].map((ax, i) => {
        const inp = numInput({ step: def.step || 0.1 }, v[i], (nv) => { v[i] = nv; commit(v.slice()); });
        const l = h('label.' + ax, ax.toUpperCase()); dragLabel(l, inp, { step: def.step || 0.1 }, (nv) => { v[i] = nv; commit(v.slice()); });
        return h('div', { style: { display: 'flex', alignItems: 'center', gap: '2px' } }, l, inp);
      });
      control = h('div.vec', parts); break;
    }
    case 'asset': {
      const list = ctx.editor.assetsOfType(def.assetType);
      control = h('div', { style: { display: 'flex', gap: '4px' } },
        h('select', { style: { flex: 1, minWidth: 0 }, on: { change: (e) => commit(e.target.value) } }, h('option', { value: '' }, '— ninguno —'), list.map((a) => h('option', { value: a.id, selected: a.id === value }, a.name))),
        h('button.icon', { type: 'button', title: 'Importar un archivo nuevo', on: { click: () => ctx.importFor && ctx.importFor(def.assetType, (a) => commit(a.id)) } }, '⬆'));
      break;
    }
    case 'scene': control = h('select', { on: { change: (e) => commit(e.target.value) } }, h('option', { value: '' }, '— ninguna —'), ctx.editor.project.scenes.map((s) => h('option', { value: s.id, selected: s.id === value }, s.name + (s.kind === '3d' ? ' (3D)' : '')))); break;
    case 'key': control = h('select', { on: { change: (e) => commit(e.target.value) } }, S.KEYS.map((k) => h('option', { value: k, selected: k === value }, keyLabel(k)))); break;
    case 'sfx': control = h('select', { on: { change: (e) => commit(e.target.value) } }, h('option', { value: '' }, '— silencio —'), S.SFX.map((k) => h('option', { value: k, selected: k === value }, 'Efecto: ' + k))); break;
    case 'sound': {
      const audio = ctx.editor.assetsOfType('audio');
      control = h('select', { on: { change: (e) => commit(e.target.value) } }, S.SFX.map((k) => h('option', { value: 'sfx:' + k, selected: 'sfx:' + k === value }, 'Efecto: ' + k)), audio.map((a) => h('option', { value: a.id, selected: a.id === value }, 'Audio: ' + a.name)));
      break;
    }
    case 'node': {
      const names = Array.from(new Set(ctx.editor.scene.nodes.map((n) => n.name)));
      control = h('select', { on: { change: (e) => commit(e.target.value) } }, h('option', { value: '' }, '— elige un objeto —'), names.map((n) => h('option', { value: n, selected: n === value }, n)));
      break;
    }
    case 'tag': case 'target': {
      const dl = h('datalist', { id: id + 'dl' }, suggestions(def.type, ctx).map((s) => h('option', { value: s })));
      const inp = stop(h('input', { type: 'text', value: value || '', list: id + 'dl', spellcheck: 'false', maxlength: 60, placeholder: def.type === 'target' ? 'self, other, tag:x, name:x' : 'etiqueta' }));
      inp.addEventListener('change', () => commit(inp.value.trim()));
      control = h('div', inp, dl); break;
    }
    default: control = stop(h('input', { type: 'text', value: value === undefined ? '' : value, maxlength: 400, spellcheck: 'false' })); control.addEventListener('change', () => commit(control.value));
  }
  if (control.tagName && control.tagName !== 'DIV') control.id = id;
  return h('div.field' + (wide ? '.wide' : '') + (def.type === 'vec3' ? '.vec3' : ''), label, control);
}
export function keyLabel(k) { const map = { SPACE: 'Espacio', ENTER: 'Intro', SHIFT: 'Mayús', CTRL: 'Ctrl', ESC: 'Esc', TAB: 'Tab', UP: '↑ Arriba', DOWN: '↓ Abajo', LEFT: '← Izquierda', RIGHT: '→ Derecha', ZERO: '0', ONE: '1', TWO: '2', THREE: '3', FOUR: '4', FIVE: '5', SIX: '6', SEVEN: '7', EIGHT: '8', NINE: '9' }; return map[k] || k; }
function suggestions(type, ctx) {
  const tags = new Set(), names = new Set();
  ctx.editor.project.scenes.forEach((s) => s.nodes.forEach((n) => { n.tags.forEach((t) => tags.add(t)); names.add(n.name); }));
  if (type === 'tag') return Array.from(tags);
  return ['self', 'other', 'all'].concat(Array.from(tags).map((t) => 'tag:' + t), Array.from(names).slice(0, 200).map((n) => 'name:' + n));
}
/** Sección plegable del inspector (recuerda si estaba abierta) */
const openState = new Map();
export function section(key, title, content, opts) {
  const open = openState.has(key) ? openState.get(key) : !(opts && opts.closed);
  const d = h('details.sec', { open }, h('summary', title, opts && opts.count !== undefined ? h('span.count', String(opts.count)) : null), h('div.body', content));
  d.addEventListener('toggle', () => openState.set(key, d.open));
  return d;
}
