/* UltraGame Studio · editor de código reutilizable (scripts, plugins, rutas del backend, contratos Solidity, JSON).
 * Textarea transparente sobre un <pre> resaltado (solo nodos de texto y spans: nada de innerHTML), números de línea,
 * líneas con error, sangría automática, comentar con Ctrl+/, buscar con Ctrl+F y modo solo lectura. */
import { h, clear, debounce } from './dom.js';

const LANGS = {
  js: {
    kw: ['var', 'let', 'const', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'break', 'continue', 'switch', 'case', 'default', 'new', 'this', 'true', 'false', 'null', 'undefined', 'typeof', 'instanceof', 'in', 'of', 'try', 'catch', 'finally', 'throw', 'class', 'extends', 'super', 'async', 'await', 'yield', 'delete', 'void', 'NaN', 'Infinity', 'import', 'export', 'from'],
    api: ['api', 'self', 'UG', 'Math', 'console', 'req', 'res', 'db', 'ctx', 'JSON', 'Promise'],
    comment: '//'
  },
  sol: {
    kw: ['pragma', 'solidity', 'contract', 'interface', 'library', 'abstract', 'is', 'function', 'modifier', 'event', 'error', 'struct', 'enum', 'mapping', 'returns', 'return', 'if', 'else', 'for', 'while', 'do', 'break', 'continue', 'new', 'delete', 'emit', 'revert', 'require', 'assert', 'try', 'catch', 'constructor', 'receive', 'fallback', 'using', 'import', 'unchecked', 'assembly',
      'public', 'private', 'internal', 'external', 'view', 'pure', 'payable', 'constant', 'immutable', 'override', 'virtual', 'memory', 'storage', 'calldata', 'indexed', 'anonymous', 'true', 'false', 'this', 'super', 'type'],
    api: ['msg', 'block', 'tx', 'abi', 'address', 'bool', 'string', 'bytes', 'uint', 'int', 'uint8', 'uint16', 'uint32', 'uint64', 'uint128', 'uint256', 'int8', 'int16', 'int32', 'int64', 'int128', 'int256', 'bytes1', 'bytes4', 'bytes8', 'bytes16', 'bytes32', 'keccak256', 'ecrecover', 'selfdestruct', 'wei', 'gwei', 'ether', 'seconds', 'minutes', 'hours', 'days', 'weeks'],
    comment: '//'
  },
  json: { kw: ['true', 'false', 'null'], api: [], comment: null }
};
Object.keys(LANGS).forEach((k) => { LANGS[k].kwSet = new Set(LANGS[k].kw); LANGS[k].apiSet = new Set(LANGS[k].api); });
const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b|\b0x[0-9a-f]+\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/gi;

/** Texto -> fragmento DOM resaltado */
export function highlight(code, lang) {
  const L = LANGS[lang] || LANGS.js, frag = document.createDocumentFragment(); let last = 0, m;
  TOKEN.lastIndex = 0;
  const span = (cls, t) => { const s = document.createElement('span'); s.className = cls; s.textContent = t; frag.appendChild(s); };
  // textos muy largos (archivos generados): sin resaltado para no bloquear la interfaz
  if (code.length > 400000) { frag.appendChild(document.createTextNode(code + '\n')); return frag; }
  while ((m = TOKEN.exec(code))) {
    if (m.index > last) frag.appendChild(document.createTextNode(code.slice(last, m.index)));
    if (m[1]) span('tk-com', m[1]);
    else if (m[2]) span(lang === 'json' && /^\s*:/.test(code.slice(TOKEN.lastIndex, TOKEN.lastIndex + 3)) ? 'tk-fn' : 'tk-str', m[2]);
    else if (m[3]) span('tk-num', m[3]);
    else if (m[4]) span(L.kwSet.has(m[4]) ? 'tk-kw' : L.apiSet.has(m[4]) ? 'tk-api' : 'tk-fn', m[4]);
    else if (m[5]) { if (L.kwSet.has(m[5])) span('tk-kw', m[5]); else if (L.apiSet.has(m[5])) span('tk-api', m[5]); else frag.appendChild(document.createTextNode(m[5])); }
    last = TOKEN.lastIndex;
    if (m[0].length === 0) TOKEN.lastIndex++;
  }
  if (last < code.length) frag.appendChild(document.createTextNode(code.slice(last)));
  frag.appendChild(document.createTextNode('\n')); // la última línea vacía también ocupa altura
  return frag;
}

/** Sustituye [s, e) por text como si se tecleara: queda en el historial del navegador (Ctrl+Z / Ctrl+Y).
 * setRangeText no entra en ese historial: con él, cada Intro (sangría automática) rompía el deshacer. */
function replaceRange(ta, text, s, e, mode) {
  ta.focus(); ta.setSelectionRange(s, e);
  let ok = false;
  try { ok = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text); } catch (x) { ok = false; }
  if (!ok) { ta.setRangeText(text, s, e, 'end'); ta.dispatchEvent(new Event('input')); } // navegador sin insertText
  if (mode === 'select') ta.setSelectionRange(s, s + text.length);
}

/**
 * new CodeEditor({ value, lang: 'js'|'sol'|'json', readOnly, onChange(texto) (con retardo), onSave(), label })
 * .el (elemento), .value, .setValue(t), .setErrors([líneas]), .gotoLine(n), .insert(t), .flush(), .focus()
 */
export class CodeEditor {
  constructor(o) {
    o = o || {};
    this.lang = o.lang || 'js'; this.readOnly = !!o.readOnly; this.onChange = o.onChange || null; this.onSave = o.onSave || null; this.errs = new Set();
    this.gutter = h('div.gutter'); this.pre = h('pre', { 'aria-hidden': 'true' });
    this.ta = h('textarea', { spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-label': o.label || 'Código', wrap: 'off', readonly: this.readOnly ? '' : null });
    this.ta.value = o.value || '';
    this.find = h('input.code-find', { type: 'search', placeholder: 'Buscar… (Enter: siguiente)', hidden: true, 'aria-label': 'Buscar en el código' });
    this.el = h('div.editor' + (this.readOnly ? '.ro' : ''), this.gutter, h('div.area', this.pre, this.ta), this.find);
    this.changed = debounce(() => { if (this.onChange) this.onChange(this.ta.value); }, o.delay || 600);
    this.ta.addEventListener('input', () => { this.sync(); this.changed(); });
    this.ta.addEventListener('scroll', () => { this.pre.scrollTop = this.ta.scrollTop; this.pre.scrollLeft = this.ta.scrollLeft; this.gutter.scrollTop = this.ta.scrollTop; });
    this.ta.addEventListener('keydown', (e) => this.onKey(e));
    this.ta.addEventListener('blur', () => this.changed.flush && this.flush());
    this.find.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); this.findNext(this.find.value, e.shiftKey); } else if (e.key === 'Escape') { this.find.hidden = true; this.ta.focus(); } });
    this.sync();
  }
  get value() { return this.ta.value; }
  setValue(t) { if (t === this.ta.value) return; const st = this.ta.scrollTop; this.ta.value = t; this.sync(); this.ta.scrollTop = st; }
  flush() { if (this.onChange && !this.readOnly) this.changed.flush(); }
  focus() { this.ta.focus(); }
  setErrors(lines) { this.errs = new Set(lines || []); this.renderGutter(); }
  sync() {
    clear(this.pre).appendChild(highlight(this.ta.value, this.lang));
    this.pre.scrollTop = this.ta.scrollTop; this.pre.scrollLeft = this.ta.scrollLeft;
    this.renderGutter();
  }
  renderGutter() {
    const n = this.ta.value.split('\n').length;
    clear(this.gutter);
    const parts = [];
    for (let i = 1; i <= n; i++) {
      if (this.errs.has(i)) { if (parts.length) { this.gutter.appendChild(document.createTextNode(parts.join(''))); parts.length = 0; } this.gutter.appendChild(h('span.err', { title: 'Error en esta línea (ver consola)' }, '● ' + i)); parts.push('\n'); }
      else parts.push(i + '\n');
    }
    if (parts.length) this.gutter.appendChild(document.createTextNode(parts.join('')));
    this.gutter.scrollTop = this.ta.scrollTop;
  }
  gotoLine(line) {
    const ta = this.ta, lines = ta.value.split('\n'), l = Math.max(1, Math.min(lines.length, line));
    let pos = 0; for (let i = 0; i < l - 1; i++) pos += lines[i].length + 1;
    ta.focus(); ta.setSelectionRange(pos, pos + lines[l - 1].length); ta.scrollTop = Math.max(0, (l - 5) * 20);
    this.sync();
  }
  insert(text) {
    if (this.readOnly) return;
    const ta = this.ta, s = ta.selectionStart, e = ta.selectionEnd;
    replaceRange(ta, text, s, e, 'end');
  }
  findNext(q, back) {
    if (!q) return false;
    const v = this.ta.value.toLowerCase(), needle = q.toLowerCase(), from = back ? this.ta.selectionStart - 1 : this.ta.selectionEnd;
    let i = back ? v.lastIndexOf(needle, Math.max(0, from)) : v.indexOf(needle, from);
    if (i < 0) i = back ? v.lastIndexOf(needle) : v.indexOf(needle);
    if (i < 0) return false;
    this.ta.focus(); this.ta.setSelectionRange(i, i + needle.length);
    const line = this.ta.value.slice(0, i).split('\n').length; this.ta.scrollTop = Math.max(0, (line - 6) * 20);
    this.pre.scrollTop = this.ta.scrollTop; this.gutter.scrollTop = this.ta.scrollTop;
    this.find.focus();
    return true;
  }
  onKey(e) {
    const ta = e.target, ctrl = e.ctrlKey || e.metaKey, L = LANGS[this.lang] || LANGS.js;
    if (ctrl && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); this.find.hidden = false; this.find.value = ta.value.slice(ta.selectionStart, ta.selectionEnd).slice(0, 80) || this.find.value; this.find.focus(); this.find.select(); return; }
    if (ctrl && (e.key === 's' || e.key === 'S')) { e.preventDefault(); this.flush(); if (this.onSave) this.onSave(); return; }
    if (this.readOnly) { if (!ctrl) e.stopPropagation(); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
      if (s === en && !e.shiftKey) replaceRange(ta, '  ', s, en, 'end');
      else {
        const ls = v.lastIndexOf('\n', s - 1) + 1, lines = v.slice(ls, en).split('\n'), out = lines.map((l) => (e.shiftKey ? l.replace(/^ {1,2}/, '') : '  ' + l)).join('\n');
        if (out !== v.slice(ls, en)) replaceRange(ta, out, ls, en, 'select');
      }
      return;
    }
    if (e.key === 'Enter' && !ctrl) {
      e.preventDefault();
      const s = ta.selectionStart, v = ta.value, ls = v.lastIndexOf('\n', s - 1) + 1, indent = /^[ \t]*/.exec(v.slice(ls, s))[0], more = /[{([]\s*$/.test(v.slice(ls, s)) ? '  ' : '';
      replaceRange(ta, '\n' + indent + more, s, ta.selectionEnd, 'end'); return;
    }
    if (e.key === '}' && !ctrl) {
      // cerrar un bloque: quita un nivel de sangría si la línea está vacía
      const s = ta.selectionStart, v = ta.value, ls = v.lastIndexOf('\n', s - 1) + 1, before = v.slice(ls, s);
      if (/^ {2,}$/.test(before) && s === ta.selectionEnd) { e.preventDefault(); replaceRange(ta, before.slice(2) + '}', ls, s, 'end'); return; }
    }
    if (ctrl && e.key === '/' && L.comment) {
      e.preventDefault();
      const v = ta.value, s = ta.selectionStart, en = ta.selectionEnd, ls = v.lastIndexOf('\n', s - 1) + 1, le = v.indexOf('\n', en), end = le < 0 ? v.length : le;
      const lines = v.slice(ls, end).split('\n'), all = lines.every((l) => /^\s*\/\//.test(l) || !l.trim());
      replaceRange(ta, lines.map((l) => (all ? l.replace(/^(\s*)\/\/ ?/, '$1') : (l.trim() ? l.replace(/^(\s*)/, '$1// ') : l))).join('\n'), ls, end, 'select');
      return;
    }
    if (ctrl && e.key === 'd') { // duplicar línea
      e.preventDefault();
      const v = ta.value, s = ta.selectionStart, ls = v.lastIndexOf('\n', s - 1) + 1, le = v.indexOf('\n', s), end = le < 0 ? v.length : le;
      replaceRange(ta, '\n' + v.slice(ls, end), end, end, 'end'); return;
    }
    e.stopPropagation(); // el resto de teclas son para el texto (no atajos del editor)
  }
}
