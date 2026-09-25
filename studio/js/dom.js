/* UltraGame Studio · utilidades de interfaz. Nunca se usa innerHTML: todo el texto va por textContent/atributos,
 * así un nombre de objeto o de archivo malicioso no puede inyectar HTML en el editor. */

/** h('div.cls#id', {attrs, on: {click}}, hijos...) */
export function h(sel, attrs, ...kids) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(sel || 'div');
  const el = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) m[2].replace(/([.#])([\w-]+)/g, (_, t, v) => { if (t === '.') el.classList.add(v); else el.id = v; });
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'on') { for (const ev of Object.keys(v)) el.addEventListener(ev, v[ev]); }
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c)); // se suma a las clases del selector
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'open' || k === 'draggable') el[k] = !!v;
      else if (/^on/i.test(k)) continue; // atributos de eventos en línea: nunca
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, kids);
  return el;
}
function append(el, kids) { for (const k of kids) { if (k === null || k === undefined || k === false) continue; if (Array.isArray(k)) append(el, k); else el.appendChild(k instanceof Node ? k : document.createTextNode(String(k))); } }
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function $(sel, root) { return (root || document).querySelector(sel); }
export function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

/* ---------------------------------------------------------------- avisos */
export function toast(text, kind, ms) {
  const box = document.getElementById('toasts'), t = h('div.toast' + (kind ? '.' + kind : ''), { role: kind === 'error' ? 'alert' : 'status' }, text);
  box.appendChild(t);
  setTimeout(() => t.remove(), ms || (kind === 'error' ? 6000 : 3000));
}

/* ---------------------------------------------------------------- menús */
let openMenu = null;
export function closeMenu() { if (openMenu) { openMenu.el.remove(); if (openMenu.onClose) openMenu.onClose(); document.removeEventListener('pointerdown', openMenu.away, true); document.removeEventListener('keydown', openMenu.key, true); openMenu = null; } }
/** items: [{label, icon, key, action, disabled} | '-' | {group: 'Título'}]; x/y en píxeles o un elemento ancla */
export function showMenu(items, anchor, onClose) {
  closeMenu();
  const el = h('div.menu', { role: 'menu' });
  const btns = [];
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { el.appendChild(h('div.sep')); continue; }
    if (it.group) { el.appendChild(h('div.grp', it.group)); continue; }
    const b = h('button', { type: 'button', role: 'menuitem', disabled: it.disabled, title: it.title || null }, it.icon ? h('span', it.icon) : null, h('span', it.label), it.key ? h('span.k', it.key) : null);
    b.addEventListener('click', () => { closeMenu(); if (!it.disabled && it.action) it.action(); });
    el.appendChild(b); btns.push(b);
  }
  document.body.appendChild(el);
  let x, y;
  if (anchor instanceof Element) { const r = anchor.getBoundingClientRect(); x = r.left; y = r.bottom + 2; } else { x = anchor.x; y = anchor.y; }
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  el.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  let hi = -1;
  const away = (e) => { if (!el.contains(e.target) && !(anchor instanceof Element && anchor.contains(e.target))) closeMenu(); };
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const en = btns.filter((b) => !b.disabled); if (!en.length) return; hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + en.length) % en.length; en.forEach((b, i) => b.classList.toggle('hl', i === hi)); en[hi].focus(); }
  };
  document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', key, true);
  openMenu = { el, away, key, onClose };
  return el;
}

/* ---------------------------------------------------------------- diálogos */
/* Pila de diálogos: uno nuevo (p. ej. «¿Borrar?» dentro de «Proyectos») oculta el anterior y, al cerrarse, lo vuelve
 * a mostrar. Solo el de arriba atiende al teclado y al clic fuera: un Intro o Escape nunca llega a uno oculto. */
const dialogStack = [];
/** Diálogo modal. build(body, close) rellena el cuerpo; buttons: [{label, kind, value, action}] -> promesa con el valor */
export function dialog(title, build, buttons, wide) {
  return new Promise((resolve) => {
    const ov = document.getElementById('overlay');
    ov.hidden = false;
    dialogStack.forEach((d) => { d.el.hidden = true; });
    const body = h('div.dbody'), foot = h('div.dfoot');
    const dlg = h('div.dialog' + (wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', title), body, foot);
    ov.appendChild(dlg);
    let done = false, def = null;
    const entry = { el: dlg, close: null };
    const close = (v) => {
      if (done) return; done = true;
      dlg.remove();
      const i = dialogStack.indexOf(entry); if (i >= 0) dialogStack.splice(i, 1);
      document.removeEventListener('keydown', onKey, true);
      if (dialogStack.length) dialogStack[dialogStack.length - 1].el.hidden = false; else { ov.hidden = true; clear(ov); }
      resolve(v);
    };
    entry.close = close;
    const top = () => dialogStack[dialogStack.length - 1] === entry;
    const onKey = (e) => { if (!top()) return; if (e.key === 'Escape') { e.preventDefault(); close(null); } else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && def && !def.disabled) { e.preventDefault(); def.click(); } };
    document.addEventListener('keydown', onKey, true);
    dialogStack.push(entry);
    ov.onpointerdown = (e) => { if (e.target === ov && dialogStack.length) dialogStack[dialogStack.length - 1].close(null); };
    if (build) build(body, close);
    (buttons || [{ label: 'Cerrar', value: null }]).forEach((b) => {
      const el = h('button.btn' + (b.kind ? '.' + b.kind : ''), { type: 'button' }, b.label);
      el.addEventListener('click', async () => {
        if (done) return;
        if (b.action) { el.disabled = true; let r; try { r = await b.action(); } finally { el.disabled = false; } if (r === false) return; close(r === undefined ? b.value : r); }
        else close(b.value);
      });
      foot.appendChild(el); if (b.kind === 'primary' || b.kind === 'danger') def = el;
    });
    const first = body.querySelector('input, select, textarea, button'); if (first) setTimeout(() => { if (!done) first.focus(); }, 30);
  });
}
export function prompt(title, label, value, opts) {
  let input;
  return dialog(title, (b) => {
    if (label) b.appendChild(h('label.help', label));
    input = h('input', { type: 'text', value: value || '', maxlength: (opts && opts.max) || 80, spellcheck: 'false' });
    b.appendChild(input); setTimeout(() => input.select(), 40);
  }, [{ label: 'Cancelar', value: null }, { label: (opts && opts.ok) || 'Aceptar', kind: 'primary', action: () => { const v = input.value.trim(); if (!v && !(opts && opts.allowEmpty)) { input.focus(); return false; } return v; } }]);
}
export function confirm(title, text, okLabel, danger) {
  return dialog(title, (b) => b.appendChild(h('p', { style: { margin: 0 } }, text)), [{ label: 'Cancelar', value: false }, { label: okLabel || 'Aceptar', kind: danger ? 'danger' : 'primary', value: true }]);
}

/* ---------------------------------------------------------------- varios */
export function debounce(fn, ms) { let t = 0; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = (...a) => { clearTimeout(t); fn(...a); }; d.cancel = () => clearTimeout(t); return d; }
export function fmtBytes(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
export function downloadBlob(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  // el navegador lee el Blob al empezar la descarga: con exportaciones grandes 4 s podían no bastar
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
export function safeFileName(s, ext) { const b = String(s || 'juego').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'juego'; return ext ? b + ext : b; }
