/* UltraGame Studio · diseño de ventanas: paneles redimensionables (arrastra el borde), plegables, desacoplables como
 * ventanas flotantes, presets (predeterminado, código, arte, compacto), modo enfoque, tema claro/oscuro y, en móviles
 * y tabletas, cajones deslizables con barra de navegación inferior y gestos. Todo se recuerda en localStorage. */
import { h } from './dom.js';

const KEY = 'ugs-layout-v2';
const PANELS = {
  left: { id: 'panel-left', label: 'Escenas y jerarquía', icon: '🗂', size: '--left-w', def: 250, min: 160, max: 520, edge: 'e' },
  right: { id: 'panel-right', label: 'Inspector', icon: '⚙', size: '--right-w', def: 320, min: 220, max: 640, edge: 'w' },
  bottom: { id: 'bottom', label: 'Recursos y consola', icon: '📦', size: '--bottom-h', def: 210, min: 90, max: 700, edge: 'n' }
};
export const PRESETS = {
  default: { label: 'Predeterminado', left: 250, right: 320, bottom: 210, hidden: [] },
  code: { label: 'Programar (código amplio)', left: 200, right: 260, bottom: 170, hidden: [] },
  art: { label: 'Arte (lienzo grande)', left: 250, right: 300, bottom: 150, hidden: ['left'] },
  compact: { label: 'Compacto (pantallas pequeñas)', left: 200, right: 260, bottom: 150, hidden: [] },
  review: { label: 'Probar el juego', left: 220, right: 280, bottom: 240, hidden: ['left', 'right'] }
};

/** Estado guardado -> estado válido (un localStorage dañado o de otra versión no puede impedir que arranque el Studio) */
function sanitizeState(v, def) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return def;
  const num = (x, lo, hi, d) => (typeof x === 'number' && isFinite(x) ? Math.round(Math.max(lo, Math.min(hi, x))) : d);
  const s = { sizes: {}, hidden: [], floating: {}, focus: v.focus === true, theme: v.theme === 'light' ? 'light' : 'dark', blocks: {} };
  Object.keys(PANELS).forEach((k) => {
    const P = PANELS[k], sz = v.sizes && typeof v.sizes === 'object' ? v.sizes[k] : undefined;
    s.sizes[k] = num(sz, P.min, P.max, def.sizes[k]);
    if (Array.isArray(v.hidden) && v.hidden.includes(k)) s.hidden.push(k);
    const f = v.floating && typeof v.floating === 'object' ? v.floating[k] : null;
    if (f && typeof f === 'object') s.floating[k] = { x: num(f.x, -4000, 8000, 40), y: num(f.y, 0, 8000, 60), w: num(f.w, 160, 8000, 320), h: num(f.h, 90, 8000, 300) };
  });
  if (v.blocks && typeof v.blocks === 'object') Object.keys(v.blocks).slice(0, 50).forEach((id) => { if (/^[\w-]{1,60}$/.test(id) && v.blocks[id] === true) s.blocks[id] = true; });
  return s;
}

export class Layout {
  constructor(app) {
    this.app = app; this.root = document.getElementById('app');
    this.s = { sizes: { left: 250, right: 320, bottom: 210 }, hidden: [], floating: {}, focus: false, theme: 'dark', blocks: {} };
    try { this.s = sanitizeState(JSON.parse(localStorage.getItem(KEY) || 'null'), this.s); } catch (e) { /* modo privado o datos dañados: diseño por defecto */ }
    this.homes = {};
    Object.keys(PANELS).forEach((k) => { const el = document.getElementById(PANELS[k].id); this.homes[k] = { el, parent: el.parentNode, next: el.nextSibling }; this.addResizer(k, el); this.addHeadButtons(k, el); });
    this.edgeTabs = {};
    Object.keys(PANELS).forEach((k) => { const t = h('button.edge-tab.' + k, { type: 'button', title: 'Mostrar: ' + PANELS[k].label, on: { click: () => this.toggle(k, true) } }, PANELS[k].icon); this.root.appendChild(t); this.edgeTabs[k] = t; });
    this.scrim = h('div.scrim', { on: { click: () => this.closeDrawers() } }); this.root.appendChild(this.scrim);
    this.nav = this.mobileNav(); this.root.appendChild(this.nav);
    this.collapsibleBlocks();
    this.mq = window.matchMedia('(max-width: 820px)');
    const onMq = () => { this.root.classList.toggle('mobile', this.mq.matches); if (this.mq.matches) this.dockAll(); this.apply(); };
    if (this.mq.addEventListener) this.mq.addEventListener('change', onMq); else this.mq.addListener(onMq);
    this.gestures();
    window.addEventListener('resize', () => this.clampFloats());
    onMq();
    Object.keys(this.s.floating || {}).forEach((k) => { if (!this.mq.matches && PANELS[k]) this.float(k, this.s.floating[k]); });
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch (e) { /* modo privado */ } }
  isHidden(k) { return this.s.hidden.includes(k); }
  isFloating(k) { return !!this.floats && !!this.floats[k]; }
  apply() {
    const R = this.root, mobile = this.mq && this.mq.matches;
    Object.keys(PANELS).forEach((k) => { R.style.setProperty(PANELS[k].size, (this.s.focus || this.isHidden(k) || this.isFloating(k) ? 0 : this.s.sizes[k]) + 'px'); });
    Object.keys(PANELS).forEach((k) => {
      const hide = !mobile && (this.s.focus || this.isHidden(k)) && !this.isFloating(k);
      R.classList.toggle('hide-' + k, hide);
      this.edgeTabs[k].hidden = mobile || !(hide && !this.s.focus);
    });
    R.classList.toggle('focus-center', !mobile && this.s.focus);
    document.documentElement.dataset.theme = this.s.theme === 'light' ? 'light' : 'dark';
    const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = this.s.theme === 'light' ? '#f3f5fb' : '#11141f';
    this.save();
    if (this.app.viewport && this.app.viewport.resize) requestAnimationFrame(() => this.app.viewport.resize());
    window.dispatchEvent(new Event('ugs-layout'));
  }
  toggle(k, on) {
    if (this.mq.matches) { this.drawer(k); return; }
    const i = this.s.hidden.indexOf(k), show = on === undefined ? i >= 0 : on;
    if (show && i >= 0) this.s.hidden.splice(i, 1); else if (!show && i < 0) this.s.hidden.push(k);
    if (show) this.s.focus = false;
    this.apply();
  }
  toggleFocus(on) { this.s.focus = on === undefined ? !this.s.focus : on; this.apply(); }
  preset(name) {
    const p = PRESETS[name]; if (!p) return;
    this.dockAll();
    this.s.sizes = { left: p.left, right: p.right, bottom: p.bottom }; this.s.hidden = p.hidden.slice(); this.s.focus = false;
    this.apply();
  }
  reset() { this.dockAll(); this.s.blocks = {}; document.querySelectorAll('.block.collapsed').forEach((b) => b.classList.remove('collapsed')); this.preset('default'); }
  setTheme(t) { this.s.theme = t; this.apply(); }
  /* ---------------------------------------------------------------- redimensionar */
  addResizer(k, el) {
    const P = PANELS[k], r = h('div.resizer.' + P.edge, { title: 'Arrastra para cambiar el tamaño · doble clic: tamaño original', role: 'separator', 'aria-orientation': P.edge === 'n' ? 'horizontal' : 'vertical' });
    el.appendChild(r);
    r.addEventListener('dblclick', () => { this.s.sizes[k] = P.def; this.apply(); });
    r.addEventListener('pointerdown', (e) => {
      if (this.isFloating(k)) return;
      e.preventDefault(); r.setPointerCapture(e.pointerId); r.classList.add('drag'); this.root.classList.add('resizing');
      const start = P.edge === 'n' ? e.clientY : e.clientX, s0 = this.s.sizes[k];
      const move = (ev) => {
        const d = (P.edge === 'n' ? ev.clientY : ev.clientX) - start, v = P.edge === 'e' ? s0 + d : s0 - d;
        const lim = P.edge === 'n' ? innerHeight - 160 : innerWidth - 360;
        this.s.sizes[k] = Math.round(Math.max(P.min, Math.min(P.max, lim, v)));
        this.root.style.setProperty(P.size, this.s.sizes[k] + 'px');
        if (this.app.viewport && this.app.viewport.resize) this.app.viewport.resize();
      };
      const up = () => { r.classList.remove('drag'); this.root.classList.remove('resizing'); r.removeEventListener('pointermove', move); r.removeEventListener('pointerup', up); r.removeEventListener('pointercancel', up); this.apply(); };
      r.addEventListener('pointermove', move); r.addEventListener('pointerup', up); r.addEventListener('pointercancel', up);
    });
  }
  addHeadButtons(k, el) {
    const head = k === 'bottom' ? el.querySelector('.tabs') : el.querySelector('.block-head'); if (!head) return;
    const box = h('div.dock-btns',
      h('button.icon', { type: 'button', title: 'Desacoplar (ventana flotante) / acoplar', on: { click: () => (this.isFloating(k) ? this.dock(k) : this.float(k)) } }, '⧉'),
      h('button.icon', { type: 'button', title: 'Ocultar el panel', on: { click: () => (this.isFloating(k) ? this.dock(k, true) : this.toggle(k, false)) } }, '—'));
    head.appendChild(box);
  }
  /* ---------------------------------------------------------------- ventanas flotantes */
  float(k, rect) {
    if (this.mq.matches || this.isFloating(k)) return;
    const P = PANELS[k], el = this.homes[k].el;
    const r = rect || (k === 'bottom' ? { x: 80, y: innerHeight - 320, w: Math.min(900, innerWidth - 160), h: 280 } : { x: k === 'left' ? 30 : innerWidth - 380, y: 70, w: k === 'left' ? 280 : 350, h: Math.min(640, innerHeight - 120) });
    const title = h('div.float-head', h('span', P.icon + ' ' + P.label), h('span.grow'), h('button.icon', { type: 'button', title: 'Acoplar', on: { click: () => this.dock(k) } }, '⇲'), h('button.icon', { type: 'button', title: 'Cerrar (ocultar)', on: { click: () => this.dock(k, true) } }, '✕'));
    const win = h('div.floatwin', { role: 'dialog', 'aria-label': P.label }, title, h('div.float-body'));
    win.lastChild.appendChild(el);
    document.body.appendChild(win);
    // una ventana guardada en una pantalla más grande se ajusta a la actual (siempre queda a la vista)
    const fw = Math.min(r.w, Math.max(160, innerWidth - 20)), fh = Math.min(r.h, Math.max(90, innerHeight - 40));
    Object.assign(win.style, { left: Math.max(0, Math.min(innerWidth - 80, r.x)) + 'px', top: Math.max(0, Math.min(innerHeight - 30, r.y)) + 'px', width: fw + 'px', height: fh + 'px' });
    (this.floats || (this.floats = {}))[k] = win;
    // mover por la cabecera; redimensionar con la esquina (CSS resize) y guardar al terminar
    title.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      e.preventDefault(); title.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY, x0 = win.offsetLeft, y0 = win.offsetTop;
      const mv = (ev) => { win.style.left = Math.max(-win.offsetWidth + 80, Math.min(innerWidth - 80, x0 + ev.clientX - sx)) + 'px'; win.style.top = Math.max(0, Math.min(innerHeight - 30, y0 + ev.clientY - sy)) + 'px'; };
      const up = () => { title.removeEventListener('pointermove', mv); title.removeEventListener('pointerup', up); title.removeEventListener('pointercancel', up); this.rememberFloat(k); };
      title.addEventListener('pointermove', mv); title.addEventListener('pointerup', up); title.addEventListener('pointercancel', up);
    });
    win.addEventListener('pointerdown', () => this.raise(win));
    if (typeof ResizeObserver === 'function') { win._ro = new ResizeObserver(() => this.rememberFloat(k)); win._ro.observe(win); }
    this.raise(win);
    this.s.hidden = this.s.hidden.filter((x) => x !== k);
    this.rememberFloat(k);
    this.apply();
  }
  raise(win) { this._z = (this._z || 500) + 1; win.style.zIndex = String(this._z); }
  rememberFloat(k) { const w = this.floats && this.floats[k]; if (!w) return; (this.s.floating || (this.s.floating = {}))[k] = { x: w.offsetLeft, y: w.offsetTop, w: w.offsetWidth, h: w.offsetHeight }; this.save(); }
  clampFloats() { Object.keys(this.floats || {}).forEach((k) => { const w = this.floats[k]; w.style.left = Math.max(0, Math.min(innerWidth - 80, w.offsetLeft)) + 'px'; w.style.top = Math.max(0, Math.min(innerHeight - 30, w.offsetTop)) + 'px'; }); }
  dock(k, hide) {
    const w = this.floats && this.floats[k]; if (!w) return;
    const home = this.homes[k];
    home.parent.insertBefore(home.el, home.next && home.next.parentNode === home.parent ? home.next : null);
    if (w._ro) w._ro.disconnect();
    w.remove(); delete this.floats[k]; if (this.s.floating) delete this.s.floating[k];
    if (hide && !this.s.hidden.includes(k)) this.s.hidden.push(k);
    this.apply();
  }
  dockAll() { Object.keys(this.floats || {}).forEach((k) => this.dock(k)); }
  /* ---------------------------------------------------------------- bloques plegables (Escenas, Jerarquía) */
  collapsibleBlocks() {
    document.querySelectorAll('#panel-left .block').forEach((b) => {
      const head = b.querySelector('.block-head > span'); if (!head || !b.id) return;
      head.classList.add('fold'); head.title = 'Plegar / desplegar'; head.tabIndex = 0; head.setAttribute('role', 'button');
      if (this.s.blocks[b.id]) b.classList.add('collapsed');
      head.setAttribute('aria-expanded', String(!b.classList.contains('collapsed')));
      head.addEventListener('click', () => { b.classList.toggle('collapsed'); this.s.blocks[b.id] = b.classList.contains('collapsed'); head.setAttribute('aria-expanded', String(!this.s.blocks[b.id])); this.save(); });
      head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); head.click(); } });
    });
  }
  /* ---------------------------------------------------------------- móvil: cajones y gestos */
  mobileNav() {
    const b = (icon, label, fn, cls) => h('button' + (cls || ''), { type: 'button', on: { click: fn } }, h('span.ic', icon), h('span', label));
    return h('nav.mobile-nav', { 'aria-label': 'Navegación móvil' },
      b('🗂', 'Objetos', () => this.drawer('left')),
      b('🎬', 'Vista', () => { this.closeDrawers(); this.app.selectTab && this.app.selectTab('scene'); }),
      b('⚙', 'Inspector', () => this.drawer('right')),
      b('📦', 'Recursos', () => this.drawer('bottom')),
      b('▶', 'Jugar', () => { this.closeDrawers(); if (this.app.player && this.app.player.playing) this.app.player.stop(); else if (this.app.play) this.app.play(false); }, '.play'));
  }
  drawer(k) {
    const R = this.root, cls = 'drawer-' + k, open = !R.classList.contains(cls);
    this.closeDrawers();
    if (open) { R.classList.add(cls, 'drawer-open'); }
  }
  closeDrawers() { ['left', 'right', 'bottom'].forEach((k) => this.root.classList.remove('drawer-' + k)); this.root.classList.remove('drawer-open'); }
  gestures() {
    // deslizar desde el borde izquierdo abre la jerarquía; desde el derecho, el Inspector; deslizar un cajón lo cierra
    let st = null;
    document.addEventListener('touchstart', (e) => { if (!this.mq.matches || e.touches.length !== 1) { st = null; return; } const t = e.touches[0]; st = { x: t.clientX, y: t.clientY, t: Date.now(), edge: t.clientX < 18 ? 'left' : t.clientX > innerWidth - 18 ? 'right' : null }; }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (!st || !this.mq.matches) return; const t = e.changedTouches[0], dx = t.clientX - st.x, dy = t.clientY - st.y, fast = Date.now() - st.t < 600;
      if (fast && Math.abs(dx) > 70 && Math.abs(dy) < 60) {
        if (st.edge === 'left' && dx > 0) this.drawer('left');
        else if (st.edge === 'right' && dx < 0) this.drawer('right');
        else if (this.root.classList.contains('drawer-left') && dx < 0) this.closeDrawers();
        else if (this.root.classList.contains('drawer-right') && dx > 0) this.closeDrawers();
      } else if (fast && dy > 80 && Math.abs(dx) < 60 && this.root.classList.contains('drawer-bottom') && st.y < innerHeight * 0.55) this.closeDrawers();
      st = null;
    }, { passive: true });
  }
  /** Elementos del menú «Ventana» */
  menu() {
    const ck = (on) => (on ? '✓' : ' ');
    const items = [{ group: 'Paneles' }];
    Object.keys(PANELS).forEach((k) => {
      items.push({ label: PANELS[k].label, icon: ck(!this.isHidden(k) || this.isFloating(k)), action: () => (this.isFloating(k) ? this.dock(k, true) : this.toggle(k)) });
      if (!this.mq.matches) items.push({ label: (this.isFloating(k) ? 'Acoplar ' : 'Desacoplar ') + PANELS[k].label.toLowerCase(), icon: '⧉', action: () => (this.isFloating(k) ? this.dock(k) : this.float(k)) });
    });
    items.push('-', { label: 'Modo enfoque (solo la vista)', icon: ck(this.s.focus), key: 'Ctrl+Mayús+F', action: () => this.toggleFocus() });
    items.push({ group: 'Diseños' });
    Object.keys(PRESETS).forEach((k) => items.push({ label: PRESETS[k].label, icon: '▭', action: () => this.preset(k) }));
    items.push({ label: 'Restablecer el diseño', icon: '↺', action: () => this.reset() });
    items.push({ group: 'Tema' }, { label: 'Oscuro', icon: ck(this.s.theme !== 'light'), action: () => this.setTheme('dark') }, { label: 'Claro', icon: ck(this.s.theme === 'light'), action: () => this.setTheme('light') });
    return items;
  }
}
