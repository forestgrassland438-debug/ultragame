/* UltraGame Studio · pestaña Backend: crea la API de tu juego (rutas en JavaScript con base de datos clave-valor),
 * ejecútala en tu equipo (aislada, solo 127.0.0.1), pruébala, mira su registro y expórtala como servidor Node.
 * El juego la usa con la acción «Petición a tu servidor» o api.http('POST', '/api/...', datos). */
import { h, clear, toast, showMenu, prompt, confirm, downloadBlob, safeFileName } from './dom.js';
import { makeZip } from './export.js';

const S = window.UGStudio.schema, BK = window.UGStudio.backend;
const enc = new TextEncoder();

export class BackendPanel {
  constructor(app, host) {
    this.app = app; this.host = host; this.state = { running: false, logs: [], seq: 0 }; this.poll = 0; this.lastRes = null;
    const ed = app.editor;
    ed.on('project', () => { this.stopPolling(); this.state = { running: false, logs: [], seq: 0 }; this.render(); if (ed.project) this.refresh(); });
    ed.on('change', (d) => { if ((d.kind === 'all' || d.kind === 'backend' || d.kind === 'project') && this.visible && !this.typing) this.render(); });
    // código de las rutas y del servidor generado en la pestaña Código
    (app.codeSources || (app.codeSources = [])).push(() => this.codeSources());
  }
  get be() { const p = this.app.editor.project; return p ? p.backend : null; }
  codeSources() {
    const ed = this.app.editor, be = this.be; if (!be) return [];
    const out = be.routes.map((r) => ({ group: 'Backend (rutas)', id: '__route:' + r.id, name: r.method + ' ' + r.path, icon: '🌐', lang: 'js', kind: 'route',
      get: () => { const x = ed.project.backend.routes.find((y) => y.id === r.id); return x ? x.code : ''; },
      set: (v) => ed.edit('Editar ruta', (p) => { const x = p.backend.routes.find((y) => y.id === r.id); if (x) x.code = v; }, 'backend') }));
    if (be.routes.length) out.push({ group: 'Generado (solo lectura)', id: '__gen:server', name: 'backend/server.js', icon: '⚙️', lang: 'js', get: () => (this.files().find((f) => f.path === 'server.js') || {}).text || '', set: null, download: () => this.exportZip() });
    return out;
  }
  files() { return BK.files(this.app.editor.project, { dev: true }); }
  setVisible(on) { this.visible = on; if (on) { this.render(); this.refresh(); } else this.stopPolling(); }
  edit(label, fn) { this.typing = true; try { this.app.editor.edit(label, (p) => fn(p.backend), 'backend'); } finally { this.typing = false; } }

  /* ---------------------------------------------------------------- servidor local */
  async refresh() {
    const ed = this.app.editor; if (!ed.project || !ed.store.canRunBackend) return;
    try {
      const st = await ed.store.backendStatus(ed.projectId, this.state.seq);
      this.state.running = st.running; this.state.url = st.url; this.state.token = st.token; this.state.sandboxed = st.sandboxed;
      if (st.logs && st.logs.length) { this.state.logs = this.state.logs.concat(st.logs).slice(-600); this.state.seq = st.seq; this.renderLogs(); }
      this.renderStatus();
      if (st.running && this.visible) this.startPolling(); else this.stopPolling();
    } catch (e) { this.stopPolling(); }
  }
  startPolling() { if (!this.poll) this.poll = setInterval(() => this.refresh(), 1200); }
  stopPolling() { clearInterval(this.poll); this.poll = 0; }
  /** Para el reproductor: { url, token } si el backend local está en marcha */
  devInfo() { return this.state.running && this.state.url ? { url: this.state.url, token: this.state.token } : null; }
  async start() {
    const ed = this.app.editor;
    if (!ed.store.canRunBackend) { toast('Ejecutar el backend necesita el servidor del Studio (abre «UltraGame Studio.cmd»). Puedes exportarlo y ejecutarlo con Node.', 'warn', 6000); return; }
    if (!this.be.routes.length) { toast('Añade al menos una ruta', 'warn'); return; }
    this.app.code.commit.flush();
    this.state.logs = []; this.state.seq = 0; this.renderLogs();
    try {
      const r = await ed.store.backendStart(ed.projectId, this.files().map((f) => ({ path: f.path, text: f.text })));
      this.state.logs = r.logs || []; this.state.seq = r.seq || this.state.logs.length;
      if (!r.running) { this.state.running = false; toast('El backend no arrancó: ' + (r.error || 'mira el registro'), 'error'); }
      else { Object.assign(this.state, { running: true, url: r.url, token: r.token, sandboxed: r.sandboxed }); toast('Backend en marcha en ' + r.url + (r.sandboxed ? ' (aislado)' : ''), 'ok'); this.startPolling(); }
    } catch (e) { toast('No se pudo iniciar: ' + e.message, 'error'); }
    this.renderStatus(); this.renderLogs();
  }
  async stop() {
    const ed = this.app.editor; if (!ed.store.canRunBackend) return;
    try { await ed.store.backendStop(ed.projectId); } catch (e) { /* ya parado */ }
    this.state.running = false; this.stopPolling(); setTimeout(() => this.refresh(), 800); this.renderStatus();
  }
  async test(method, path, body) {
    const ed = this.app.editor;
    if (!this.state.running) { toast('Primero pulsa ▶ Ejecutar', 'warn'); return; }
    try {
      const r = await ed.store.backendRequest(ed.projectId, method, path, body);
      this.lastRes = r; this.renderResponse();
      setTimeout(() => this.refresh(), 150);
    } catch (e) { this.lastRes = { status: 0, body: e.message, ms: 0 }; this.renderResponse(); }
  }
  async exportZip() {
    const files = BK.files(this.app.editor.project).map((f) => ({ path: 'backend/' + f.path, data: enc.encode(f.text) }));
    downloadBlob(makeZip(files), safeFileName(this.app.editor.project.name, '-backend.zip'));
    toast('Servidor exportado: descomprime y ejecuta «node server.js»', 'ok');
  }

  /* ---------------------------------------------------------------- interfaz */
  render() {
    const host = this.host, ed = this.app.editor; clear(host);
    if (!ed.project) return;
    const be = this.be, canRun = ed.store.canRunBackend;
    const head = h('div.pane-head', h('h3', '🌐 Backend / API del juego'), h('span.grow'),
      h('label.chk', h('input', { type: 'checkbox', checked: be.enabled, on: { change: (e) => this.edit(e.target.checked ? 'Activar backend' : 'Desactivar backend', (b) => { b.enabled = e.target.checked; }) } }), ' Usar en el juego'),
      h('button.btn.small', { type: 'button', on: { click: () => this.exportZip() } }, '⬇ Exportar servidor'),
      h('button.btn.small', { type: 'button', disabled: !be.routes.length, on: { click: () => this.app.openScript('__gen:server') } }, '📄 Ver server.js'));
    this.statusEl = h('div.be-status');
    const run = h('div.row-actions', h('button.btn.play.small', { type: 'button', disabled: !canRun, on: { click: () => this.start() } }, '▶ Ejecutar / reiniciar'), h('button.btn.stop.small', { type: 'button', disabled: !canRun, on: { click: () => this.stop() } }, '■ Detener'), this.statusEl);
    const cfg = h('div.card',
      h('div.field', h('label', 'URL de producción'), h('input', { type: 'url', value: be.url, placeholder: 'https://api.mijuego.com (vacío = el mismo sitio que el juego)', spellcheck: 'false',
        on: { change: (e) => { const v = e.target.value.trim(); const c = S.cleanBackend({ url: v }); if (v && !c.url) { toast('URL no válida (http(s)://dominio[:puerto][/ruta])', 'warn'); e.target.value = be.url; return; } this.edit('URL del backend', (b) => { b.url = c.url; }); }, keydown: (e) => e.stopPropagation() } })),
      originsField('Orígenes CORS (webs donde se publica el juego)', be.cors, (list) => this.edit('Orígenes CORS', (b) => { b.cors = list; })),
      h('div.help', canRun ? 'Al jugar desde el Studio, el juego usa el backend local si está en marcha. Al exportar, usa la URL de producción (o rutas relativas si el backend sirve también el juego).' : 'Sin el servidor del Studio no se puede ejecutar aquí: exporta el servidor y ejecútalo con Node 18+.'));
    const routes = h('div.be-routes');
    be.routes.forEach((r) => routes.appendChild(this.routeRow(r)));
    if (!be.routes.length) routes.appendChild(h('div.empty', 'Sin rutas. Añade una desde una plantilla (clasificación, partidas guardadas…) o vacía.'));
    const add = h('button.btn.small.primary', { type: 'button' }, '＋ Añadir ruta');
    add.onclick = () => showMenu([{ group: 'Plantillas' }].concat(Object.keys(BK.ROUTE_TEMPLATES).map((k) => ({ label: BK.ROUTE_TEMPLATES[k].method + ' ' + BK.ROUTE_TEMPLATES[k].path + ' · ' + BK.ROUTE_TEMPLATES[k].label, icon: '🌐', action: () => this.addRoute(BK.ROUTE_TEMPLATES[k]) })), ['-', { label: 'Ruta vacía…', icon: '＋', action: async () => { const pth = await prompt('Nueva ruta', 'Ruta (ej. /api/tienda/:id)', '/api/nueva'); if (pth) this.addRoute({ method: 'GET', path: pth, code: 'return { ok: true };\n' }); } }]), add);
    // probar
    const mSel = h('select', { 'aria-label': 'Método' }, S.HTTP_METHODS.map((m) => h('option', { value: m }, m)));
    const pIn = h('input', { type: 'text', value: be.routes[0] ? be.routes[0].path.replace(/:(\w+)/g, 'ejemplo') : '/api/hola', spellcheck: 'false', 'aria-label': 'Ruta', on: { keydown: (e) => e.stopPropagation() } });
    const bIn = h('textarea', { rows: 3, spellcheck: 'false', placeholder: '{"nombre": "ana", "puntos": 120}', 'aria-label': 'Cuerpo JSON', on: { keydown: (e) => e.stopPropagation() } });
    this.testIn = { mSel, pIn, bIn };
    if (be.routes[0]) mSel.value = be.routes[0].method;
    this.resEl = h('pre.be-res');
    const tester = h('div.card', h('b', '🧪 Probar una petición'), h('div.be-test', mSel, pIn, h('button.btn.small', { type: 'button', on: { click: () => this.test(mSel.value, pIn.value.trim(), bIn.value) } }, 'Enviar')), bIn, this.resEl);
    this.logEl = h('div.be-log', { role: 'log' });
    const logs = h('div.card', h('div.card-head', h('b.grow', '📜 Registro del servidor'), h('button.icon', { type: 'button', title: 'Limpiar', on: { click: () => { this.state.logs = []; this.renderLogs(); } } }, '🧹')), this.logEl);
    const help = h('div.card.help-card', h('b', 'Cómo lo usa el juego'),
      h('div.help', 'Evento: acción «Petición a tu servidor» (método, ruta, cuerpo con {variables}); la respuesta queda en la variable y «Al terminar una petición» se activa. En scripts: api.http(\'POST\', \'/api/puntuaciones\', { nombre, puntos }).then(r => …).'),
      h('div.help', 'Seguridad del servidor generado: JSON obligatorio en escrituras (bloquea CSRF), CORS con lista blanca, límite por IP y ruta, 256 KB por petición, 10 s por ruta, claves __proto__ eliminadas, errores internos ocultos. En desarrollo exige el token del Studio.'));
    host.appendChild(h('div.pane', head, run, h('div.pane-cols', h('div.pane-col', cfg, h('div.card', h('div.card-head', h('b.grow', 'Rutas'), add), routes), help), h('div.pane-col', tester, logs))));
    this.renderStatus(); this.renderLogs(); this.renderResponse();
  }
  routeRow(r) {
    const setR = (label, fn) => this.edit(label, (b) => { const x = b.routes.find((y) => y.id === r.id); if (x) fn(x); });
    const m = h('select', { 'aria-label': 'Método', on: { change: (e) => setR('Método', (x) => { x.method = e.target.value; }) } }, S.HTTP_METHODS.map((mm) => h('option', { value: mm, selected: mm === r.method }, mm)));
    const p = h('input', { type: 'text', value: r.path, spellcheck: 'false', 'aria-label': 'Ruta', on: { keydown: (e) => e.stopPropagation(), change: (e) => {
      const v = e.target.value.trim(), c = S.cleanBackend({ routes: [{ id: r.id, method: r.method, path: v }] });
      if (!c.routes.length) { toast('Ruta no válida: empieza por / y usa letras, números, - _ . : /', 'warn'); e.target.value = r.path; return; }
      if (this.be.routes.some((x) => x.id !== r.id && x.method === r.method && x.path === v)) { toast('Ya existe ' + r.method + ' ' + v, 'warn'); e.target.value = r.path; return; }
      setR('Ruta', (x) => { x.path = v; });
    } } });
    const rl = h('input', { type: 'number', value: r.rateLimit, min: 1, max: 100000, title: 'Peticiones por minuto y por IP', 'aria-label': 'Límite por minuto', on: { keydown: (e) => e.stopPropagation(), change: (e) => setR('Límite', (x) => { x.rateLimit = Math.max(1, Math.min(100000, e.target.value | 0 || 60)); }) } });
    const auth = h('label.chk', { title: 'Exige la cabecera X-API-Key (UG_API_KEY en el servidor). Para herramientas o tu otro servidor, no para el juego (la clave sería pública).' }, h('input', { type: 'checkbox', checked: r.auth, on: { change: (e) => setR('Clave', (x) => { x.auth = e.target.checked; }) } }), '🔑');
    return h('div.be-route', m, p, h('span.help', '/min'), rl, auth,
      h('button.icon', { type: 'button', title: 'Editar el código', on: { click: () => this.app.openScript('__route:' + r.id) } }, '✏️'),
      h('button.icon', { type: 'button', title: 'Probar', on: { click: () => { if (this.testIn) { this.testIn.mSel.value = r.method; this.testIn.pIn.value = r.path.replace(/:(\w+)/g, 'ejemplo'); } this.test(r.method, r.path.replace(/:(\w+)/g, 'ejemplo'), this.testIn ? this.testIn.bIn.value : ''); } } }, '🧪'),
      h('button.icon', { type: 'button', title: 'Borrar', on: { click: async () => { if (await confirm('Borrar ruta', '¿Borrar ' + r.method + ' ' + r.path + '?', 'Borrar', true)) this.edit('Borrar ruta', (b) => { b.routes = b.routes.filter((x) => x.id !== r.id); }); } } }, '🗑'));
  }
  addRoute(t) {
    const be = this.be; let path = t.path, n = 2;
    while (be.routes.some((x) => x.method === t.method && x.path === path)) path = t.path + '-' + (n++);
    const id = S.uid('r');
    this.edit('Añadir ruta', (b) => { if (b.routes.length < 100) b.routes.push({ id, method: t.method, path, code: t.code, rateLimit: t.rateLimit || 60, auth: false }); });
    this.render();
  }
  renderStatus() {
    const el = this.statusEl; if (!el) return; clear(el);
    const ed = this.app.editor;
    if (!ed.store.canRunBackend) { el.appendChild(h('span.help', 'Modo navegador: solo exportar')); return; }
    el.appendChild(this.state.running ? h('span.pill.ok', '● En marcha · ' + this.state.url + (this.state.sandboxed ? ' · aislado' : ' · sin aislamiento (Node antiguo)')) : h('span.pill', '○ Detenido'));
  }
  renderLogs() {
    const el = this.logEl; if (!el) return; clear(el);
    const logs = this.state.logs.slice(-300);
    if (!logs.length) { el.appendChild(h('div.help', 'Sin mensajes todavía.')); return; }
    logs.forEach((l) => el.appendChild(h('div.ln.' + (l.level === 'error' ? 'error' : l.level === 'warn' ? 'warn' : 'info'), l.text)));
    el.scrollTop = el.scrollHeight;
  }
  renderResponse() {
    const el = this.resEl; if (!el) return;
    const r = this.lastRes; if (!r) { el.textContent = 'La respuesta aparecerá aquí.'; el.className = 'be-res'; return; }
    let body = r.body; try { if (/json/.test(r.type || '') || /^\s*[[{]/.test(body)) body = JSON.stringify(JSON.parse(body), null, 2); } catch (e) { /* texto */ }
    el.textContent = (r.status ? 'HTTP ' + r.status : 'Sin respuesta') + ' · ' + (r.ms | 0) + ' ms' + (r.truncated ? ' · (recortada a 1 MB)' : '') + '\n\n' + String(body || '(vacía)').slice(0, 20000);
    el.className = 'be-res ' + (r.status >= 200 && r.status < 300 ? 'ok' : 'bad');
  }
}

/** Lista de orígenes (https://dominio[:puerto]) editable como chips */
export function originsField(label, list, onChange) {
  const chips = h('div.chips');
  const draw = () => { clear(chips); list.forEach((o, i) => chips.appendChild(h('span.chip', o, h('button', { type: 'button', title: 'Quitar', on: { click: () => onChange(list.filter((_, j) => j !== i)) } }, '✕')))); };
  draw();
  const inp = h('input', { type: 'text', placeholder: 'https://mijuego.com', spellcheck: 'false', on: { keydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); addIt(); } } } });
  const addIt = () => {
    const v = inp.value.trim().replace(/\/+$/, ''); if (!v) return;
    if (!S.isOrigin(v)) { toast('Origen no válido: protocolo + dominio (+ puerto), sin ruta. Ej.: https://mijuego.itch.io', 'warn'); return; }
    if (list.includes(v)) { inp.value = ''; return; }
    if (list.length >= 20) { toast('Máximo 20 orígenes', 'warn'); return; }
    onChange(list.concat([v]));
  };
  return h('div.field.wide', h('label', label), chips, h('div.row-actions', inp, h('button.btn.small', { type: 'button', on: { click: addIt } }, 'Añadir')));
}
