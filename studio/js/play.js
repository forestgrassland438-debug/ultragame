/* UltraGame Studio · modo Jugar: el juego corre en un iframe con sandbox="allow-scripts" (sin allow-same-origin),
 * así los scripts del juego no pueden tocar el editor, su cookie ni la API de archivos.
 * Vista previa en dispositivos (móviles, tabletas, plegables, consolas, monitores) con orientación, marco, zona segura
 * y zoom; modo «comparar» con varios dispositivos a la vez. Puente con la página, cartera web3 (a través de Web3Host,
 * que valida cada petición) y backend local del juego. */
import { h, clear, toast, dialog } from './dom.js';

const RT = window.UGStudio.runtime;

/** Tamaños CSS en vertical (ancho × alto) y zona segura aproximada [arriba, abajo] */
export const DEVICES = [
  { group: 'Sin dispositivo' },
  { id: 'fill', name: 'Ventana completa', w: 0, h: 0 },
  { group: 'Teléfonos' },
  { id: 'iphone-se', name: 'iPhone SE', w: 375, h: 667, safe: [20, 0], r: 28 },
  { id: 'iphone-13mini', name: 'iPhone 13 mini', w: 375, h: 812, safe: [50, 34], r: 44, notch: 'notch' },
  { id: 'iphone-15', name: 'iPhone 15 / 15 Pro', w: 393, h: 852, safe: [59, 34], r: 50, notch: 'island' },
  { id: 'iphone-15pm', name: 'iPhone 15 Pro Max', w: 430, h: 932, safe: [59, 34], r: 55, notch: 'island' },
  { id: 'pixel-8', name: 'Google Pixel 8', w: 412, h: 915, safe: [32, 16], r: 36, notch: 'hole' },
  { id: 'pixel-8pro', name: 'Google Pixel 8 Pro', w: 448, h: 998, safe: [34, 16], r: 36, notch: 'hole' },
  { id: 'galaxy-s24', name: 'Samsung Galaxy S24', w: 360, h: 780, safe: [30, 16], r: 34, notch: 'hole' },
  { id: 'galaxy-s24u', name: 'Samsung Galaxy S24 Ultra', w: 384, h: 824, safe: [30, 16], r: 22, notch: 'hole' },
  { id: 'galaxy-a54', name: 'Samsung Galaxy A54', w: 412, h: 915, safe: [30, 16], r: 34, notch: 'hole' },
  { id: 'redmi-note13', name: 'Xiaomi Redmi Note 13', w: 393, h: 873, safe: [30, 16], r: 34, notch: 'hole' },
  { id: 'android-small', name: 'Android pequeño (gama baja)', w: 360, h: 640, safe: [24, 0], r: 16 },
  { group: 'Plegables' },
  { id: 'fold-closed', name: 'Galaxy Z Fold (cerrado)', w: 344, h: 882, safe: [30, 16], r: 26, notch: 'hole' },
  { id: 'fold-open', name: 'Galaxy Z Fold (abierto, aprox.)', w: 736, h: 832, safe: [30, 16], r: 24, notch: 'hole' },
  { id: 'flip', name: 'Galaxy Z Flip', w: 412, h: 1004, safe: [30, 16], r: 36, notch: 'hole' },
  { group: 'Tabletas' },
  { id: 'ipad-mini', name: 'iPad mini', w: 744, h: 1133, safe: [24, 20], r: 26 },
  { id: 'ipad-air', name: 'iPad Air', w: 820, h: 1180, safe: [24, 20], r: 26 },
  { id: 'ipad-pro13', name: 'iPad Pro 12,9"', w: 1024, h: 1366, safe: [24, 20], r: 26 },
  { id: 'tab-s9', name: 'Galaxy Tab S9', w: 800, h: 1280, safe: [24, 0], r: 22 },
  { id: 'surface', name: 'Surface Pro', w: 912, h: 1368, safe: [0, 0], r: 12 },
  { group: 'Consolas y TV' },
  { id: 'steamdeck', name: 'Steam Deck', w: 800, h: 1280, safe: [0, 0], r: 18, land: true },
  { id: 'switch', name: 'Nintendo Switch (portátil)', w: 720, h: 1280, safe: [0, 0], r: 14, land: true },
  { id: 'tv1080', name: 'Televisor 1080p', w: 1080, h: 1920, safe: [54, 54], r: 4, land: true },
  { group: 'Ordenadores' },
  { id: 'laptop', name: 'Portátil 1366×768', w: 768, h: 1366, safe: [0, 0], r: 6, land: true },
  { id: 'laptop-hd', name: 'Portátil 1536×864', w: 864, h: 1536, safe: [0, 0], r: 6, land: true },
  { id: 'fhd', name: 'Monitor Full HD', w: 1080, h: 1920, safe: [0, 0], r: 4, land: true },
  { id: 'qhd', name: 'Monitor 1440p', w: 1440, h: 2560, safe: [0, 0], r: 4, land: true },
  { id: 'uw', name: 'Ultrapanorámico 21:9', w: 1080, h: 2560, safe: [0, 0], r: 4, land: true },
  { id: 'k4', name: 'Monitor 4K', w: 2160, h: 3840, safe: [0, 0], r: 4, land: true },
  { group: 'Otro' },
  { id: 'custom', name: 'Personalizado…', w: 400, h: 800, safe: [0, 0], r: 12 }
];
const DEV = Object.create(null); DEVICES.forEach((d) => { if (d.id) DEV[d.id] = d; });
const PREF_KEY = 'ugs-device-prefs';

export class Player {
  constructor(app) {
    this.app = app; this.frames = []; this.cache = new Map(); this.onMsg = null; this.playing = false; this.project = null;
    this.host = document.getElementById('game-host');
    this.prefs = { device: 'fill', landscape: null, zoom: 'fit', bezel: true, safe: true, compare: false, compareIds: ['iphone-15', 'pixel-8', 'ipad-air', 'fhd'], customW: 400, customH: 800 };
    try { Object.assign(this.prefs, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); } catch (e) { /* modo privado */ }
    if (!DEV[this.prefs.device]) this.prefs.device = 'fill';
    this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.layout()) : null;
  }
  savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(this.prefs)); } catch (e) { /* modo privado */ } }
  /** Scripts del proyecto (y de cada escena) envueltos para registrarse en el runtime */
  scripts(project) {
    const out = [];
    // los plugins primero: pueden preparar librerías que usen los demás scripts
    const ordered = project.scripts.filter((s) => s.plugin).concat(project.scripts.filter((s) => !s.plugin));
    ordered.forEach((s) => { try { out.push({ id: s.id, name: s.name, source: RT.wrapScript(s.id, s.code) }); } catch (e) { /* id inválido: el esquema ya lo impide */ } });
    project.scenes.forEach((sc) => { if (sc.script && sc.script.trim()) out.push({ id: '__scene_' + sc.id, name: 'script de escena · ' + sc.name, source: RT.wrapScript('__scene_' + sc.id, sc.script) }); });
    return out;
  }
  async files(project) {
    const ed = this.app.editor, out = [];
    for (const a of project.assets) {
      const key = a.file + '|' + (ed.assetVersion[a.id] || 0);
      let data = this.cache.get(key);
      if (!data) { try { data = await ed.store.assetData(ed.projectId, a.file); this.cache.set(key, data); } catch (e) { this.app.console.log('warn', 'No se pudo leer ' + a.file + ': ' + e.message, 'Jugar'); continue; } }
      out.push({ id: a.id, file: a.file, data: data.slice(0) }); // copia: el original se queda en la caché
    }
    return out;
  }
  async play(currentScene, opts) {
    const ed = this.app.editor; if (!ed.project) return;
    opts = opts || {};
    this.stop(true);
    this.app.code.commit.flush();
    const project = this.project = JSON.parse(JSON.stringify(ed.project));
    this.run = { project, files: await this.files(project), scripts: this.scripts(project), startScene: currentScene ? ed.sceneId : null };
    this.app.console.clear();
    this.app.code.errors.clear();
    this.app.console.log('ok', '▶ Jugando «' + project.name + '»' + (currentScene ? ' desde la escena «' + ed.scene.name + '»' : ''), 'Studio');
    const be = this.app.backend && this.app.backend.devInfo();
    if (project.backend.enabled && be) this.app.console.log('info', '🌐 Backend local: ' + be.url, 'Studio');
    if (project.web3.enabled) this.app.console.log('info', '⛓ Web3 ' + (project.web3.mode === 'mock' ? 'simulado' : 'con cartera real (cada firma o transacción pasa por una confirmación)'), 'Studio');
    if (opts.device) { this.prefs.device = opts.device; this.prefs.compare = false; }
    if (opts.compare) this.prefs.compare = true;
    this.onMsg = (e) => this.message(e);
    window.addEventListener('message', this.onMsg);
    this.playing = true; ed.playing = true;
    this.buildStage();
    this.app.setPlaying(true);
    this.layout(); // la pestaña Juego ya es visible: ahora sí hay tamaño
    if (this.ro) this.ro.observe(this.host);
  }
  /** Mensajes de los iframes del juego */
  message(e) {
    const fr = this.frames.find((f) => f.el.contentWindow === e.source); if (!fr) return; // solo nuestros iframes
    const m = e.data; if (!m || typeof m !== 'object') return;
    const primary = fr === this.frames[0];
    if (m.type === 'ready') {
      fr.ready = true;
      const P = this.run.project;
      fr.el.contentWindow.postMessage({ type: 'run', project: P, files: primary ? this.run.files : this.run.files.map((f) => ({ id: f.id, file: f.file, data: f.data.slice(0) })), scripts: this.run.scripts, renderer: this.app.rendererChoice(), startScene: this.run.startScene,
        web3: P.web3.enabled && P.web3.mode === 'wallet' && primary ? 'studio' : '', backend: P.backend.enabled ? (this.app.backend && this.app.backend.devInfo()) : null }, '*');
      if (primary && this.app.web3) this.app.web3.hostProxy.attach(fr.el.contentWindow, P);
    }
    else if (m.type === 'log') { if (primary || m.level === 'error') this.onLog(String(m.level), (primary ? '' : '[' + fr.dev.name + '] ') + String(m.text), String(m.source || '')); }
    else if (m.type === 'started') { if (primary) this.app.console.log('ok', 'Renderizador: ' + String(m.renderer), 'Studio'); }
    else if (m.type === 'failed') { if (primary) toast('El juego no pudo arrancar: mira la consola', 'error'); }
    else if (m.type === 'bridge-out') {
      let d = ''; try { d = JSON.stringify(m.data); } catch (x) { d = String(m.data); }
      if (primary) this.app.console.log('info', '🔌 juego → página: «' + String(m.name).slice(0, 64) + '» ' + d.slice(0, 500), 'puente');
    }
    else if (m.type === 'web3') {
      const id = m.id, reply = (x) => { try { fr.el.contentWindow.postMessage(Object.assign({ type: 'web3-res', id }, x), '*'); } catch (err) { /* juego cerrado */ } };
      if (!primary || !this.app.web3) { reply({ error: { code: 4100, message: 'La cartera solo está disponible en el dispositivo principal' } }); return; }
      this.app.web3.hostProxy.handle(String(m.method), m.params).then((result) => reply({ result: JSON.parse(JSON.stringify(result === undefined ? null : result)) }), (err) => reply({ error: { code: (err && err.code) | 0, message: String((err && err.message) || err).slice(0, 300) } }));
    }
  }
  /** Envía un mensaje del puente al juego (como si lo mandara la página que lo contiene) */
  sendBridge(name, data) {
    if (!this.frames.length) return;
    this.frames.forEach((f) => { try { f.el.contentWindow.postMessage({ type: 'bridge-in', name: String(name).slice(0, 64), data }, '*'); } catch (e) { /* juego cerrado */ } });
    this.app.console.log('info', '🔌 página → juego: «' + name + '» ' + JSON.stringify(data).slice(0, 300), 'puente');
  }
  /* ---------------------------------------------------------------- escenario y dispositivos */
  buildStage() {
    clear(this.host);
    this.frames.forEach((f) => f.el.remove()); this.frames = [];
    this.bar = this.toolbar();
    this.stage = h('div.game-stage');
    this.host.appendChild(this.bar); this.host.appendChild(this.stage);
    const ids = this.prefs.compare ? this.prefs.compareIds.filter((id) => DEV[id]).slice(0, 4) : [this.prefs.device];
    ids.forEach((id, i) => this.addFrame(DEV[id], i));
    this.layout();
    clearTimeout(this.watch);
    this.watch = setTimeout(() => { if (this.frames[0] && !this.frames[0].ready) this.app.console.log('warn', 'El reproductor no responde. Si tu navegador o una extensión bloquea los iframes aislados (sandbox), abre el Studio en Edge o Chrome, o prueba con Archivo › Descargar HTML único.', 'Studio'); }, 8000);
    setTimeout(() => { if (this.frames[0]) this.frames[0].el.focus(); }, 300);
  }
  addFrame(dev, i) {
    const f = h('iframe', { sandbox: 'allow-scripts allow-pointer-lock', allow: 'autoplay; fullscreen; gamepad', referrerpolicy: 'no-referrer', title: 'Juego en ejecución · ' + dev.name });
    f.src = 'player.html#origin=' + encodeURIComponent(location.origin);
    const screen = h('div.dev-screen', f), wrap = h('div.dev-wrap' + (dev.id === 'fill' ? '.fill' : ''), h('div.dev-body', screen), dev.id !== 'fill' ? h('div.dev-label', dev.name) : null);
    this.stage.appendChild(wrap);
    this.frames.push({ el: f, dev, wrap, screen, ready: false, i });
  }
  sizeOf(dev) {
    if (dev.id === 'custom') return { w: this.prefs.customW, h: this.prefs.customH };
    const land = this.prefs.landscape === null || this.prefs.landscape === undefined ? !!dev.land : !!this.prefs.landscape;
    return land ? { w: dev.h, h: dev.w, land: true } : { w: dev.w, h: dev.h, land: false };
  }
  layout() {
    if (!this.stage || !this.frames.length) return;
    const W = this.stage.clientWidth, H = this.stage.clientHeight, n = this.frames.length;
    if (!W || !H) return;
    const cols = n <= 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : (W > H * 1.6 ? 4 : 2), rows = Math.ceil(n / cols);
    this.frames.forEach((fr) => {
      const dev = fr.dev, body = fr.wrap.firstChild;
      if (dev.id === 'fill') { Object.assign(fr.screen.style, { width: '100%', height: '100%', transform: '' }); body.style.cssText = ''; return; }
      const s = this.sizeOf(dev), bez = this.prefs.bezel ? Math.round(Math.min(s.w, s.h) * 0.035) + 6 : 0, bw = s.w + bez * 2, bh = s.h + bez * 2;
      const cw = W / cols - 24, ch = H / rows - 44;
      let k = this.prefs.zoom === 'fit' ? Math.min(cw / bw, ch / bh, 1) : Number(this.prefs.zoom);
      if (!(k > 0)) k = 1;
      fr.k = k;
      body.style.cssText = 'width:' + (bw * k) + 'px;height:' + (bh * k) + 'px';
      body.className = 'dev-body' + (this.prefs.bezel ? ' bezel' : '');
      Object.assign(fr.screen.style, { width: s.w + 'px', height: s.h + 'px', transform: 'scale(' + k + ')', left: (bez * k) + 'px', top: (bez * k) + 'px', borderRadius: this.prefs.bezel ? (dev.r || 0) + 'px' : '0' });
      body.style.borderRadius = this.prefs.bezel ? ((dev.r || 0) + bez) * k + 'px' : '0';
      // zona segura (muesca, isla, barra de gestos) y cámara
      fr.screen.querySelectorAll('.safe').forEach((x) => x.remove());
      if (this.prefs.safe && dev.safe && (dev.safe[0] || dev.safe[1])) {
        const [t, b] = dev.safe;
        const bars = s.land ? [['left', t], ['right', b]] : [['top', t], ['bottom', b]];
        bars.forEach(([side, px]) => { if (px) fr.screen.appendChild(h('div.safe.' + side, { style: { [side === 'left' || side === 'right' ? 'width' : 'height']: px + 'px' }, title: 'Zona segura (muesca / barra del sistema): evita poner botones aquí' })); });
        if (dev.notch) fr.screen.appendChild(h('div.safe.cam.' + dev.notch + (s.land ? '.land' : '')));
      }
      const lbl = fr.wrap.querySelector('.dev-label'); if (lbl) lbl.textContent = dev.name + ' · ' + s.w + '×' + s.h + (k !== 1 ? ' · ' + Math.round(k * 100) + '%' : '');
    });
  }
  toolbar() {
    const P = this.prefs;
    const sel = h('select', { title: 'Dispositivo', 'aria-label': 'Dispositivo' });
    let og = null;
    DEVICES.forEach((d) => { if (d.group) { og = h('optgroup', { label: d.group }); sel.appendChild(og); return; } og.appendChild(h('option', { value: d.id, selected: d.id === P.device }, d.name + (d.w ? ' · ' + (d.land ? d.h + '×' + d.w : d.w + '×' + d.h) : ''))); });
    sel.onchange = () => { P.device = sel.value; P.compare = false; P.landscape = null; this.savePrefs(); if (P.device === 'custom') this.askCustom(); else this.restart(); };
    const rot = h('button.btn.small', { type: 'button', title: 'Girar (vertical / horizontal)', on: { click: () => { const d = DEV[P.device]; if (P.device === 'custom') { const t = P.customW; P.customW = P.customH; P.customH = t; } else P.landscape = !(this.sizeOf(d).land); this.savePrefs(); this.layout(); } } }, '⟳ Girar');
    const zoom = h('select', { title: 'Zoom', 'aria-label': 'Zoom', on: { change: (e) => { P.zoom = e.target.value; this.savePrefs(); this.layout(); } } }, [['fit', 'Ajustar'], ['0.5', '50 %'], ['0.75', '75 %'], ['1', '100 %']].map(([v, t]) => h('option', { value: v, selected: String(P.zoom) === v }, t)));
    const chk = (key, label, title) => h('label.chk', { title }, h('input', { type: 'checkbox', checked: P[key], on: { change: (e) => { P[key] = e.target.checked; this.savePrefs(); this.layout(); } } }), ' ' + label);
    const cmp = h('button.btn.small', { type: 'button', class: P.compare ? 'on' : null, title: 'Jugar en varios dispositivos a la vez', on: { click: () => this.compareDialog() } }, '▦ Comparar');
    const bName = h('input.bridge-name', { type: 'text', placeholder: 'mensaje', value: 'comando', spellcheck: 'false', 'aria-label': 'Nombre del mensaje del puente', on: { keydown: (e) => e.stopPropagation() } });
    const bData = h('input.bridge-data', { type: 'text', placeholder: 'datos (JSON o texto)', spellcheck: 'false', 'aria-label': 'Datos del mensaje del puente', on: { keydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') send(); } } });
    const send = () => { let d = bData.value.trim(); try { d = d === '' ? null : JSON.parse(d); } catch (e) { /* texto */ } this.sendBridge(bName.value.trim() || 'mensaje', d); };
    return h('div.game-bar', sel, rot, zoom, chk('bezel', 'Marco', 'Dibujar el marco del dispositivo'), chk('safe', 'Zona segura', 'Mostrar muesca, isla y barras del sistema'), cmp,
      h('span.grow'), h('span.help', '🔌'), bName, bData, h('button.btn.small', { type: 'button', title: 'Enviar el mensaje al juego (como la página que lo contiene)', on: { click: send } }, 'Enviar'),
      h('button.btn.small', { type: 'button', title: 'Reiniciar la partida', on: { click: () => this.restart() } }, '↻'));
  }
  restart() { if (!this.playing) return; this.buildStage(); }
  askCustom() {
    {
      let wi, hi;
      dialog('Tamaño personalizado', (b) => { wi = h('input', { type: 'number', value: this.prefs.customW, min: 200, max: 4000 }); hi = h('input', { type: 'number', value: this.prefs.customH, min: 200, max: 4000 }); b.appendChild(h('div.field', h('label', 'Ancho (px CSS)'), wi)); b.appendChild(h('div.field', h('label', 'Alto (px CSS)'), hi)); },
        [{ label: 'Cancelar', value: null }, { label: 'Aplicar', kind: 'primary', value: true }]).then((ok) => {
        if (ok) { this.prefs.customW = Math.max(200, Math.min(4000, wi.value | 0 || 400)); this.prefs.customH = Math.max(200, Math.min(4000, hi.value | 0 || 800)); this.savePrefs(); }
        this.restart();
      });
    }
  }
  compareDialog() {
    {
      const chosen = new Set(this.prefs.compareIds);
      dialog('Comparar en varios dispositivos (hasta 4)', (b) => {
        b.appendChild(h('div.help', 'Cada dispositivo ejecuta su propia copia del juego (consume más CPU). La cartera web3 solo funciona en el primero.'));
        const grid = h('div.dev-pick');
        DEVICES.forEach((d) => { if (d.group) { grid.appendChild(h('div.grp', d.group)); return; } if (d.id === 'fill' || d.id === 'custom') return; grid.appendChild(h('label.chk', h('input', { type: 'checkbox', checked: chosen.has(d.id), on: { change: (e) => { if (e.target.checked) { if (chosen.size >= 4) { e.target.checked = false; toast('Máximo 4', 'warn'); return; } chosen.add(d.id); } else chosen.delete(d.id); } } }), ' ' + d.name)); });
        b.appendChild(grid);
      }, [{ label: 'Un solo dispositivo', value: 'single' }, { label: 'Comparar', kind: 'primary', value: 'ok' }], true).then((v) => {
        if (v === 'ok' && chosen.size) { this.prefs.compareIds = Array.from(chosen); this.prefs.compare = true; }
        else if (v === 'single') this.prefs.compare = false;
        else return;
        this.savePrefs(); this.restart();
      });
    }
  }
  onLog(level, text, source) {
    this.app.console.log(level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info', text, source);
    // marca la línea con error en el editor de código
    const m = /\(línea (\d+)\)/.exec(text); if (!m || level !== 'error') return;
    const ed = this.app.editor, line = +m[1];
    const s = ed.project.scripts.find((x) => source.startsWith(x.name));
    const sc = source.startsWith('script de escena · ') ? ed.project.scenes.find((x) => source === 'script de escena · ' + x.name) : null;
    const id = s ? s.id : sc && sc.id === ed.sceneId ? '__scene' : null;
    if (id) { const prev = this.app.code.errors.get(id) || []; if (!prev.includes(line)) this.app.code.setErrors(id, prev.concat([line])); }
  }
  stop(silent) {
    clearTimeout(this.watch);
    if (this.ro) this.ro.disconnect();
    if (this.onMsg) { window.removeEventListener('message', this.onMsg); this.onMsg = null; }
    this.frames.forEach((f) => { f.el.src = 'about:blank'; f.el.remove(); }); this.frames = [];
    if (this.app.web3) this.app.web3.hostProxy.detach();
    clear(this.host); this.stage = null; this.run = null;
    if (this.playing) { this.playing = false; this.app.editor.playing = false; this.app.setPlaying(false); if (!silent) this.app.console.log('info', '■ Juego detenido', 'Studio'); }
  }
  get frame() { return this.frames[0] ? this.frames[0].el : null; }
  clearCache() { this.cache.clear(); }
}
