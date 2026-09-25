/* UltraGame Studio · hojas de eventos (programación sin código): "Cuando [condiciones] → [acciones]". */
import { h, clear, showMenu, confirm } from './dom.js';
import { field } from './fields.js';

const S = window.UGStudio.schema;
const NEGATABLE = { keyDown: 1, compare: 1, noneLeft: 0, random: 1 };

export class EventSheet {
  constructor(app, host) {
    this.app = app; this.host = host;
    const ed = app.editor;
    ['project', 'scene'].forEach((ev) => ed.on(ev, () => this.render()));
    ed.on('change', (d) => { if ((d.kind === 'all' || d.kind === 'events' || d.kind === 'nodes') && this.visible()) this.renderSoon(); });
  }
  visible() { return this.host.closest('.page').classList.contains('on'); }
  renderSoon() { clearTimeout(this._t); this._t = setTimeout(() => this.render(), 20); }
  ctx() { return { editor: this.app.editor, importFor: (type, cb) => this.app.importFiles(type, cb) }; }
  mutate(label, fn) { const sc = this.app.editor.scene; this.app.editor.edit(label, () => fn(sc.events), 'events'); }
  render() {
    const ed = this.app.editor, host = this.host, top = host.scrollTop; clear(host);
    const sc = ed.scene; if (!sc) { host.appendChild(h('div.empty', 'Abre un proyecto.')); return; }
    host.appendChild(h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
      h('b', 'Eventos de «' + sc.name + '»'),
      h('button.btn.primary', { type: 'button', on: { click: () => this.addEvent() } }, '＋ Nuevo evento'),
      h('span.help', 'Cada evento: cuando se cumplen TODAS sus condiciones, hace sus acciones en orden. «self» es el objeto de la condición (el que se toca/pulsa) y «other» el otro.')));
    if (!sc.events.length) host.appendChild(h('div.empty', 'Sin eventos. Ejemplos: «Al pulsar Espacio → Crear copia de Bala», «Cuando se tocan jugador y moneda → Sumar 1 a puntos y Destruir other».'));
    sc.events.forEach((ev, i) => host.appendChild(this.renderEvent(sc, ev, i)));
    host.scrollTop = top;
  }
  addEvent() {
    const ev = { id: S.uid('e'), enabled: true, once: false, comment: '', conditions: [{ type: 'start', not: false, params: {} }], actions: [] };
    this.mutate('Nuevo evento', (list) => list.push(ev));
  }
  renderEvent(sc, ev, i) {
    const ctx = this.ctx();
    const upd = (label, fn) => this.mutate(label, (list) => { const e = list.find((x) => x.id === ev.id); if (e) fn(e, list); });
    const comment = h('input', { type: 'text', value: ev.comment, placeholder: 'Comentario (opcional): qué hace este evento', maxlength: 200 });
    comment.addEventListener('keydown', (e) => e.stopPropagation());
    comment.addEventListener('change', () => upd('Comentario', (e) => { e.comment = comment.value.slice(0, 200); }));
    const conds = ev.conditions.map((c, j) => this.block('cond', S.CONDITIONS, c, ctx, {
      onParam: (k, v) => upd('Condición', (e) => { e.conditions[j].params[k] = v; }),
      onNot: NEGATABLE[c.type] ? (v) => upd('Negar condición', (e) => { e.conditions[j].not = v; }) : null,
      onDelete: () => upd('Quitar condición', (e) => { e.conditions.splice(j, 1); })
    }));
    const acts = ev.actions.map((a, j) => this.block('act', S.ACTIONS, a, ctx, {
      onParam: (k, v) => upd('Acción', (e) => { e.actions[j].params[k] = v; }),
      onUp: j > 0 ? () => upd('Reordenar acción', (e) => { e.actions.splice(j - 1, 0, e.actions.splice(j, 1)[0]); }) : null,
      onDelete: () => upd('Quitar acción', (e) => { e.actions.splice(j, 1); })
    }));
    const addCond = h('button.btn.small', { type: 'button', disabled: ev.conditions.length >= 8 }, '＋ Condición');
    addCond.onclick = () => showMenu(Object.keys(S.CONDITIONS).map((k) => ({ label: S.CONDITIONS[k].label, icon: S.CONDITIONS[k].icon, action: () => upd('Añadir condición', (e) => { e.conditions.push({ type: k, not: false, params: S.defaultsOf(S.CONDITIONS[k].params) }); }) })), addCond);
    const addAct = h('button.btn.small', { type: 'button', disabled: ev.actions.length >= 24 }, '＋ Acción');
    addAct.onclick = () => showMenu(Object.keys(S.ACTIONS).map((k) => ({ label: S.ACTIONS[k].label, icon: S.ACTIONS[k].icon, action: () => upd('Añadir acción', (e) => { e.actions.push({ type: k, params: S.defaultsOf(S.ACTIONS[k].params) }); }) })), addAct);
    const tools = h('div.tools',
      h('button.icon', { type: 'button', title: 'Subir', disabled: i === 0, on: { click: () => this.mutate('Mover evento', (l) => { l.splice(i - 1, 0, l.splice(i, 1)[0]); }) } }, '▲'),
      h('button.icon', { type: 'button', title: 'Bajar', disabled: i === sc.events.length - 1, on: { click: () => this.mutate('Mover evento', (l) => { l.splice(i + 1, 0, l.splice(i, 1)[0]); }) } }, '▼'),
      h('button.icon', { type: 'button', title: 'Duplicar', on: { click: () => this.mutate('Duplicar evento', (l) => { const c = JSON.parse(JSON.stringify(ev)); c.id = S.uid('e'); l.splice(i + 1, 0, c); }) } }, '⧉'),
      h('button.icon', { type: 'button', title: 'Borrar', on: { click: async () => { if (await confirm('Borrar evento', '¿Borrar este evento?', 'Borrar', true)) this.mutate('Borrar evento', (l) => { l.splice(i, 1); }); } } }, '🗑'));
    const card = h('div.ev' + (ev.enabled ? '' : '.off'),
      h('input', { type: 'checkbox', checked: ev.enabled, title: 'Activado', 'aria-label': 'Evento activado', on: { change: (e) => upd(e.target.checked ? 'Activar evento' : 'Desactivar evento', (x) => { x.enabled = e.target.checked; }) } }),
      h('div.col', h('div.col-title', 'Cuando'), conds.length ? conds : h('div.help', 'Sin condiciones: se cumple en cada fotograma.'), h('div.row-actions', addCond, h('label.chk', { title: 'Solo la primera vez que se cumpla' }, h('input', { type: 'checkbox', checked: ev.once, on: { change: (e) => upd('Una vez', (x) => { x.once = e.target.checked; }) } }), 'Solo una vez'))),
      h('div.col', h('div.col-title', 'Hacer'), acts.length ? acts : h('div.help', 'Añade al menos una acción.'), h('div.row-actions', addAct)),
      tools,
      h('div.ev-comment', comment));
    return card;
  }
  block(kind, table, b, ctx, cb) {
    const T = table[b.type];
    if (!T) return h('div.blockrow', 'Tipo desconocido');
    return h('div.blockrow' + (kind === 'cond' ? '.cond' : ''),
      h('div.t', h('span', T.icon), h('span.grow', (b.not ? 'NO: ' : '') + T.label),
        cb.onNot ? h('label.chk', { title: 'Invertir (cuando NO se cumple)' }, h('input', { type: 'checkbox', checked: !!b.not, on: { change: (e) => cb.onNot(e.target.checked) } }), 'no') : null,
        cb.onUp ? h('button.icon', { type: 'button', title: 'Subir', on: { click: cb.onUp } }, '▲') : null,
        h('button.icon', { type: 'button', title: 'Quitar', on: { click: cb.onDelete } }, '✕')),
      T.params.length ? h('div.params', T.params.map((p) => field(p, b.params[p.key], (v) => cb.onParam(p.key, v), ctx))) : null);
  }
}
