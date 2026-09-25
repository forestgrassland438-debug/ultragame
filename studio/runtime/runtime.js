/* UltraGame Studio · runtime: convierte un proyecto (JSON) en un juego de UltraGame y lo ejecuta.
 * Lo usan el reproductor del editor (iframe aislado), los juegos exportados y las vistas del editor (modo edición).
 *
 *   UGStudio.runtime.start(proyecto, { parent, assetURL(asset) -> url, renderer, onLog(nivel, texto, origen), audio,
 *     onBridge(nombre, datos), web3Provider (EIP-1193), backendURL, backendToken })
 *
 * Extras: puente con la página (game.bridge.send/on/receive), web3 (carteras EIP-1193 o simulada), peticiones HTTP a tu
 * backend (solo rutas relativas u orígenes permitidos), scripts «plugin» globales (onGameStart, onSceneStart, onUpdate...).
 *
 * Seguridad: el proyecto se sanea con el esquema (UGStudio.schema.cleanProject) antes de usarlo; los nombres de
 * clases de efectos salen solo del esquema; las variables nunca usan claves prohibidas; los scripts del usuario son
 * código del propio autor del juego, se registran como funciones (sin eval) y cada llamada va protegida con try/catch. */
(function (root) {
  'use strict';
  var UG = root.UG, NS = root.UGStudio || (root.UGStudio = {}), S = NS.schema;
  if (!UG || !S) throw new Error('UltraGame Studio: carga dist/ultragame.js y studio/shared/schema.js antes del runtime');
  var R = NS.runtime = {};
  var DEG = Math.PI / 180, V3 = UG.Vec3, colorNum = S.colorNum;
  R.VERSION = '1.0.0';

  /* =============================================================== scripts de usuario */
  var SCRIPTS = Object.create(null);
  R.registerScript = function (id, factory) { if (S.id(id) && typeof factory === 'function') SCRIPTS[id] = factory; };
  R.resetScripts = function () { SCRIPTS = Object.create(null); };
  R.hasScript = function (id) { return !!SCRIPTS[id]; };
  R.HOOKS = ['onStart', 'onUpdate', 'onCollide', 'onClick', 'onDestroy', 'onMessage'];
  /**
   * Código de un script -> fuente JS que lo registra. El editor/exportador lo carga como archivo .js (sin eval).
   * Las funciones de nivel superior del código quedan accesibles por nombre (ganchos y "Llamar a una función").
   * La primera línea del código del usuario es la línea 2 del archivo generado.
   */
  R.wrapScript = function (id, code) {
    if (!S.id(id)) throw new Error('id de script no válido');
    code = String(code || '');
    var names = [], re = /^[ \t]*(?:async[ \t]+)?function[ \t]*\*?[ \t]*([A-Za-z_$][A-Za-z0-9_$]*)[ \t]*\(/gm, m;
    while ((m = re.exec(code)) && names.length < 300) if (names.indexOf(m[1]) < 0) names.push(m[1]);
    var map = names.map(function (n) { return JSON.stringify(n) + ': typeof ' + n + " === 'function' ? " + n + ' : null'; }).join(', ');
    return 'UGStudio.runtime.registerScript(' + JSON.stringify(id) + ', function (UG, api, self) {\n' + code + '\n;return { ' + map + ' };\n});\n';
  };

  /* =============================================================== utilidades */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function noise2(seed) {
    // ruido de valor 2D con semilla (terrenos): suave e idéntico en cada ejecución
    var rng = new UG.RNG(String(seed)), P = new Float32Array(512), i;
    for (i = 0; i < 256; i++) P[i] = rng.float();
    for (i = 0; i < 256; i++) P[256 + i] = P[i];
    var h = function (x, z) { return P[((x & 255) + P[(z & 255)] * 255 | 0) & 511]; };
    var s = function (t) { return t * t * (3 - 2 * t); };
    return function (x, z) {
      var x0 = Math.floor(x), z0 = Math.floor(z), fx = s(x - x0), fz = s(z - z0);
      var a = h(x0, z0), b = h(x0 + 1, z0), c = h(x0, z0 + 1), d = h(x0 + 1, z0 + 1);
      return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
    };
  }
  R.terrainHeight = function (p) {
    var n = noise2(p.seed || 'mapa'), sc = Math.max(1, p.noiseScale || 18), H = p.height || 0, flat = p.flatCenter || 0;
    return function (x, z) {
      var v = 0, amp = 1, f = 1 / sc, tot = 0;
      for (var o = 0; o < 4; o++) { v += n(x * f + 31.7 * o, z * f - 17.3 * o) * amp; tot += amp; amp *= 0.5; f *= 2; }
      v = v / tot - 0.35;
      var r = Math.hypot(x, z), k = flat > 0 ? clamp((r - flat) / Math.max(1, flat), 0, 1) : 1;
      return Math.max(-H * 0.2, v) * H * k * 1.6;
    };
  };
  function parseFrames(spec) {
    var out = []; String(spec || '').split(',').forEach(function (part) {
      var m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(part), n;
      if (m) { var a = +m[1], b = +m[2], st = a <= b ? 1 : -1; for (n = a; st > 0 ? n <= b : n >= b; n += st) { out.push(n); if (out.length > 512) break; } }
      else if (/^\s*\d+\s*$/.test(part)) out.push(+part);
    });
    return out;
  }
  R.parseFrames = parseFrames;
  function worldAABB(obj, out) {
    out = out || new UG.Box3(); out.makeEmpty();
    obj.updateWorldMatrix(); if (obj.updateMatrixWorld) obj.updateMatrixWorld();
    var p = new V3();
    obj.traverse(function (n) {
      if (!(n instanceof UG.Mesh3D) || !n.geometry || n.visible === false) return;
      var gb = n.geometry.getBoundingBox(); if (!gb || gb.isEmpty) return;
      for (var i = 0; i < 8; i++) { p.set(i & 1 ? gb.max.x : gb.min.x, i & 2 ? gb.max.y : gb.min.y, i & 4 ? gb.max.z : gb.min.z).applyMat4(n.matrixWorld); out.expandByPoint(p); }
    });
    if (out.isEmpty) { var c = obj.getWorldPosition(new V3()); out.min.set(c.x - 0.25, c.y - 0.25, c.z - 0.25); out.max.set(c.x + 0.25, c.y + 0.25, c.z + 0.25); }
    return out;
  }
  R.worldAABB = worldAABB;
  function makeFilter(e) {
    var E = S.EFFECTS[e.type]; if (!E || typeof UG[E.cls] !== 'function') return null;
    var o = {}; E.params.forEach(function (p) { var v = e.params[p.key]; o[p.key] = p.type === 'color' ? colorNum(v) : v; });
    try { return E.arg ? new UG[E.cls](o[E.arg]) : new UG[E.cls](o); } catch (err) { return null; }
  }
  R.makeFilter = makeFilter;
  function particleConfig(key, p) {
    var base = S.PARTICLES_2D[key] || S.PARTICLES_2D.fire, c = JSON.parse(JSON.stringify(base.cfg));
    var rate = p && p.rate > 0 ? p.rate : 1, sc = p && p.scale > 0 ? p.scale : 1;
    if (c.frequency > 0) c.frequency = Math.max(1, c.frequency / rate); else c.quantity = Math.max(1, Math.round((c.quantity || 20) * rate));
    if (c.scale) { c.scale.start *= sc; c.scale.end *= sc; }
    if (p && p.useColors) { c.color = [colorNum(p.color1), colorNum(p.color2)]; delete c.tint; }
    if (p && p.width > 0 && c.x && (key === 'rain' || key === 'snow' || key === 'stars')) c.x = { min: -p.width / 2, max: p.width / 2 };
    if (p && p.emitting === false) c.emitting = false;
    return c;
  }
  R.particleConfig = particleConfig;
  function dotTexture(scene) {
    if (!scene.textures.exists('ugs-dot')) scene.textures.generate('ugs-dot', 32, 32, function (ctx, w, h) {
      var g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
    return 'ugs-dot';
  }
  R.dotTexture = dotTexture;
  var _m2 = new UG.Matrix();
  var VAR_RE = /\{([^{}\s]{1,40})\}/g;
  function toValue(v) {
    if (typeof v !== 'string') return v;
    var t = v.trim();
    if (t !== '' && isFinite(Number(t))) return Number(t);
    if (t === 'true') return true; if (t === 'false') return false;
    return v;
  }
  function assetExists(ctx, id) { return !!(id && ctx.assetsById[id]); }
  /* Guardado persistente (récords, progreso): localStorage si existe; si no (iframe aislado del editor,
   * modo privado), memoria de la sesión. Solo JSON, con límite de tamaño y claves por proyecto. */
  var MEM_SAVE = Object.create(null);
  function saveKey(ctx, key) { return 'ugs:' + String(ctx.P.name).slice(0, 40) + ':' + String(key).slice(0, 60); }
  R.saveData = function (ctx, key, value) {
    var s; try { s = JSON.stringify(value === undefined ? null : value); } catch (e) { return false; }
    if (s.length > 262144) { ctx.log('warn', 'Dato demasiado grande para guardar (máx. 256 KB)', 'guardado'); return false; }
    var k = saveKey(ctx, key);
    try { root.localStorage.setItem(k, s); return true; } catch (e) { MEM_SAVE[k] = s; return true; }
  };
  R.loadData = function (ctx, key, def) {
    var k = saveKey(ctx, key), s = null;
    try { s = root.localStorage.getItem(k); } catch (e) { s = null; }
    if (s === null || s === undefined) s = MEM_SAVE[k];
    if (s === null || s === undefined) return def;
    try { return JSON.parse(s); } catch (e) { return def; }
  };
  function noop() { /* nada */ }
  /* Valores que vienen de fuera (red, puente, cadena): solo JSON y con tamaño limitado */
  function jsonSafe(v, max) {
    if (v === undefined) return null;
    var t; try { t = JSON.stringify(v, function (k, x) { return typeof x === 'bigint' ? x.toString() : x; }); } catch (e) { throw new Error('los datos no se pueden convertir a JSON'); }
    if (t === undefined) return null;
    if (t.length > (max || 65536)) throw new Error('datos demasiado grandes (máx. ' + Math.round((max || 65536) / 1024) + ' KB)');
    return JSON.parse(t);
  }
  R.jsonSafe = jsonSafe;
  /** "a, [1,2], 'hola, mundo'" -> ['a', '[1,2]', "'hola, mundo'"] (comas de primer nivel) */
  function splitArgs(str) {
    var out = [], cur = '', depth = 0, q = null, s = String(str || '');
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (q) { cur += ch; if (ch === q && s[i - 1] !== '\\') q = null; continue; }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
      if (ch === '[' || ch === '(') depth++; else if (ch === ']' || ch === ')') depth--;
      if (ch === ',' && depth <= 0) { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim() !== '' || out.length) out.push(cur.trim());
    return out.slice(0, 32);
  }
  R.splitArgs = splitArgs;
  /** Argumento de texto -> valor para la ABI: true/false, 'texto', [lista JSON], "1.5 eth" / "3 gwei" -> wei */
  function toArg(a) {
    if (a === 'true') return true; if (a === 'false') return false;
    if (/^(["']).*\1$/.test(a)) return a.slice(1, -1);
    if (a[0] === '[') { try { return JSON.parse(a); } catch (e) { return a; } }
    var m = /^(-?\d+(?:\.\d+)?)\s*(eth|ether|gwei)$/i.exec(a);
    if (m && UG.Web3) return UG.Web3.parseUnits(m[1], /gwei/i.test(m[2]) ? 9 : 18).toString();
    return a;
  }
  R.toArg = toArg;
  /** Resultado de la cadena (BigInt, bytes, listas, tuplas) -> valores de variable */
  function fromChain(v, dec) {
    if (typeof v === 'bigint') {
      if (dec > 0) return toValue(UG.Web3.formatUnits(v, dec, 6));
      var lim = BigInt(Number.MAX_SAFE_INTEGER); return v <= lim && v >= -lim ? Number(v) : v.toString();
    }
    if (v instanceof Uint8Array) return UG.Web3.bytesToHex(v);
    if (Array.isArray(v)) return v.slice(0, 1000).map(function (x) { return fromChain(x, dec); });
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).slice(0, 200).forEach(function (k) { if (!S.isForbiddenKey(k)) o[k] = fromChain(v[k], dec); }); return o; }
    return v;
  }
  R.fromChain = fromChain;
  /* ---------------------------------------------------------------- web3: direcciones y proveedor simulado */
  var MOCK_ACCOUNT = '0x' + '1'.repeat(40);
  /** Dirección de un contrato en una red; en modo simulado, si no tiene, una ficticia estable derivada del nombre */
  R.contractAddress = function (c, chainId, mock) {
    var a = c.addresses[String(chainId)];
    if (a) return a;
    return mock && UG.Web3 ? '0x' + UG.Web3.keccak256('ugs-mock:' + c.name).slice(-40) : null;
  };
  function mockValue(v) {
    if (Array.isArray(v)) return v.slice(0, 1000).map(mockValue);
    if (typeof v === 'number' && Number.isInteger(v)) return BigInt(v);
    if (typeof v === 'string' && /^-?\d{1,78}$/.test(v)) return BigInt(v);
    if (v === '{cuenta}') return MOCK_ACCOUNT;
    return v;
  }
  /** Proveedor EIP-1193 simulado con los contratos del proyecto: cada función responde con su valor de «respuestas simuladas» */
  R.mockProvider = function (P, o) {
    var W = P.web3, contracts = {};
    W.contracts.forEach(function (c) {
      var abi, mock; try { abi = JSON.parse(c.abi); } catch (e) { abi = []; }
      try { mock = JSON.parse(c.mock) || {}; } catch (e) { mock = {}; }
      var calls = Object.create(null);
      Object.keys(mock).forEach(function (k) { if (!S.isForbiddenKey(k)) calls[k] = mockValue(mock[k]); });
      contracts[R.contractAddress(c, W.defaultChain, true)] = { abi: abi, calls: calls };
    });
    return UG.Web3.mock(Object.assign({ chainId: W.defaultChain, contracts: contracts, balance: UG.Web3.parseUnits('10', 18), delay: 40, accounts: [MOCK_ACCOUNT] }, o || {}));
  };

  /* =============================================================== juego */
  /** Arranca un proyecto. Devuelve el UG.Game. */
  R.start = function (project, opts) {
    opts = opts || {};
    var P = S.cleanProject(project);
    if (!P.scenes.length) throw new Error('El proyecto no tiene escenas');
    var ctx = new GameCtx(P, opts);
    var game = ctx.game = new UG.Game({
      parent: opts.parent, width: P.settings.width, height: P.settings.height, backgroundColor: colorNum(P.settings.background),
      renderer: opts.renderer || P.settings.renderer, pixelArt: P.settings.pixelArt, scale: { mode: P.settings.scale, autoCenter: true },
      physics: { arcade: { gravity: { x: 0, y: 0 }, debug: !!opts.debugPhysics } }, title: P.name, banner: false, audio: opts.audio,
      scenes: [bootScene(ctx)].concat(P.scenes.map(function (sc) { return sceneConfig(ctx, sc); }))
    });
    game.on('error', function (e, scene) { ctx.log('error', (e && e.message) || String(e), scene ? 'escena ' + ctx.sceneName(scene.scene.key) : 'motor'); });
    game.ugs = ctx; game.bridge = ctx.bridge;
    game.once('destroy', function () { ctx.destroy(); });
    if (P.settings.bridgeOrigins.length) ctx.bridge._listen();
    ctx.initPlugins();
    return game;
  };

  function GameCtx(P, opts) {
    this.P = P; this.opts = opts; this.game = null;
    this.vars = Object.create(null); var self = this;
    Object.keys(P.vars).forEach(function (k) { self.vars[k] = P.vars[k]; });
    this.assetsById = Object.create(null); P.assets.forEach(function (a) { self.assetsById[a.id] = a; });
    this.scenesById = Object.create(null); this.scenesByName = Object.create(null);
    P.scenes.forEach(function (s) { self.scenesById[s.id] = s; if (!self.scenesByName[s.name]) self.scenesByName[s.name] = s; });
    this.assetURL = typeof opts.assetURL === 'function' ? opts.assetURL : function (a) { return a.file; };
    this._logCount = 0;
    this.evq = []; this.plugins = []; this.rts = []; this.destroyed = false;
    this._w3 = null; this._w3api = null; this._cc = Object.create(null); this._http = 0; this._httpT = [];
    this.bridge = new Bridge(this);
  }
  GameCtx.prototype.destroy = function () {
    if (this.destroyed) return;
    this.pluginHook('onGameEnd', []);
    this.destroyed = true; this.evq = []; this.plugins = []; this.rts = [];
    this.bridge.destroy();
    if (this._w3) { this._w3.destroy(); this._w3 = null; }
  };
  /** Sucesos asíncronos (web3, red, puente) que las hojas de eventos ven en el siguiente fotograma */
  GameCtx.prototype.pushEvent = function (ev) { if (this.destroyed) return; if (this.evq.length >= 256) this.evq.shift(); this.evq.push(ev); };
  GameCtx.prototype.setVar = function (name, value) {
    if (typeof name !== 'string' || !name || S.isForbiddenKey(name) || name.length > 40) return;
    if (typeof value === 'number' && !isFinite(value)) value = 0;
    if (!(name in this.vars) && Object.keys(this.vars).length > 2000) return;
    this.vars[name] = value;
  };
  function callHookCtx(ctx, sc, hook, args) {
    if (!sc || !sc.fns || typeof sc.fns[hook] !== 'function' || sc.failed[hook]) return undefined;
    try { return sc.fns[hook].apply(null, args); }
    catch (e) {
      sc.failed[hook] = (sc.failed[hook] || 0) + 1;
      ctx.log('error', hook + ': ' + errText(e) + ' — la función se desactiva para no repetir el error', sc.name + (sc.ent ? ' (' + sc.ent.name + ')' : ''));
      return undefined;
    }
  }
  /* ---------------------------------------------------------------- scripts plugin (globales) */
  GameCtx.prototype.initPlugins = function () {
    var ctx = this;
    this.P.scripts.forEach(function (s) {
      if (!s.plugin) return;
      var f = SCRIPTS[s.id];
      if (!f) { ctx.log('warn', 'El plugin "' + s.name + '" no se cargó (¿tiene un error de sintaxis?)', s.name); return; }
      var api = new GlobalAPI(ctx, s.name), inst;
      try { inst = f(UG, api, null) || {}; } catch (e) { ctx.log('error', 'Error al iniciar el plugin: ' + errText(e), s.name); return; }
      ctx.plugins.push({ name: s.name, fns: inst, api: api, ent: null, failed: Object.create(null) });
    });
    this.pluginHook('onGameStart', [this.game]);
  };
  GameCtx.prototype.pluginHook = function (hook, args) { for (var i = 0; i < this.plugins.length; i++) callHookCtx(this, this.plugins[i], hook, args); };
  /** API de los plugins (sin escena): api.game, api.vars, api.bridge, api.web3, api.http, api.emit, api.save/load */
  function GlobalAPI(ctx, name) { this._ctx = ctx; this.name = name; this.UG = UG; this.vars = ctx.vars; this.bridge = ctx.bridge; }
  var GP = GlobalAPI.prototype;
  Object.defineProperty(GP, 'game', { get: function () { return this._ctx.game; } });
  Object.defineProperty(GP, 'web3', { get: function () { return this._ctx.web3Api(); } });
  Object.defineProperty(GP, 'scenes', { get: function () { return this._ctx.rts.map(function (rt) { return rt.scene; }); } });
  GP.log = function () { this._ctx.log('info', Array.prototype.map.call(arguments, fmt).join(' '), this.name); };
  GP.warn = function () { this._ctx.log('warn', Array.prototype.map.call(arguments, fmt).join(' '), this.name); };
  GP.get = function (k) { return typeof k === 'string' && !S.isForbiddenKey(k) ? this._ctx.vars[k] : undefined; };
  GP.set = function (k, v) { this._ctx.setVar(k, v); };
  GP.add = function (k, n) { this._ctx.setVar(k, (Number(this.get(k)) || 0) + (n === undefined ? 1 : n)); };
  GP.save = function (key, value) { return R.saveData(this._ctx, key, value); };
  GP.load = function (key, def) { return R.loadData(this._ctx, key, def); };
  GP.http = function (method, path, body, o) { return this._ctx.http(method, path, body, o); };
  GP.emit = function (name, data) { this._ctx.rts.slice().forEach(function (rt) { rt.broadcast(String(name), data); }); };
  GP.goto = function (scene) { var rt = this._ctx.rts[this._ctx.rts.length - 1]; if (rt) rt.gotoScene(scene); };

  /* ---------------------------------------------------------------- puente con la página que contiene el juego */
  /**
   * game.bridge.send(nombre, datos) -> la página recibe window 'ug-bridge-out' (misma página) o un postMessage
   * {type: 'ug-bridge', name, data} (si el juego está en un iframe y la página está en «Orígenes del puente»).
   * La página habla al juego con game.bridge.receive(nombre, datos) o postMessage({type: 'ug-bridge', name, data}).
   * Los datos se copian como JSON (máx. 64 KB); nunca se ejecuta código recibido.
   */
  function Bridge(ctx) { this._ctx = ctx; this._h = Object.create(null); this._onMsg = null; }
  Bridge.prototype.send = function (name, data) {
    var ctx = this._ctx, d; name = String(name).slice(0, 64);
    if (ctx.destroyed) return false;
    try { d = jsonSafe(data); } catch (e) { ctx.log('warn', 'Puente: ' + e.message, 'puente'); return false; }
    if (ctx.opts.onBridge) { try { ctx.opts.onBridge(name, d); } catch (e) { /* ignorar */ } }
    else if (ctx.P.settings.bridgeOrigins.length && root.parent && root.parent !== root) ctx.P.settings.bridgeOrigins.forEach(function (o) { try { root.parent.postMessage({ type: 'ug-bridge', name: name, data: d }, o); } catch (e) { /* ignorar */ } });
    if (root.dispatchEvent && typeof CustomEvent === 'function') { try { root.dispatchEvent(new CustomEvent('ug-bridge-out', { detail: { name: name, data: d } })); } catch (e) { /* ignorar */ } }
    return true;
  };
  Bridge.prototype.on = function (name, fn) { if (typeof fn === 'function') { name = String(name); (this._h[name] || (this._h[name] = [])).push(fn); } return this; };
  Bridge.prototype.off = function (name, fn) { var l = this._h[String(name)]; if (l) { var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } return this; };
  /** Mensaje de la página (o del editor) para el juego. '*' escucha todos. */
  Bridge.prototype.receive = function (name, data) {
    var ctx = this._ctx, d; if (ctx.destroyed) return false;
    name = String(name).slice(0, 64);
    try { d = jsonSafe(data); } catch (e) { ctx.log('warn', 'Puente: ' + e.message, 'puente'); return false; }
    (this._h[name] || []).concat(this._h['*'] || []).forEach(function (fn) { try { fn(d, name); } catch (e) { ctx.log('error', 'Puente (' + name + '): ' + errText(e), 'puente'); } });
    ctx.pushEvent({ type: 'bridge', name: name, data: d });
    ctx.pluginHook('onBridge', [name, d]);
    ctx.rts.slice().forEach(function (rt) { if (rt.sceneScript) rt.callHook(rt.sceneScript, 'onBridge', [name, d]); });
    return true;
  };
  Bridge.prototype._listen = function () {
    var self = this, origins = this._ctx.P.settings.bridgeOrigins;
    if (!root.addEventListener || this._onMsg) return;
    this._onMsg = function (e) {
      var m = e.data; if (!m || typeof m !== 'object' || m.type !== 'ug-bridge' || typeof m.name !== 'string') return;
      if (e.source !== root && origins.indexOf(e.origin) < 0) return; // solo orígenes de confianza
      self.receive(m.name, m.data);
    };
    root.addEventListener('message', this._onMsg);
  };
  Bridge.prototype.destroy = function () { if (this._onMsg && root.removeEventListener) root.removeEventListener('message', this._onMsg); this._onMsg = null; this._h = Object.create(null); };

  /* ---------------------------------------------------------------- web3 */
  GameCtx.prototype.wallet = function () {
    if (this._w3) return this._w3;
    var W = this.P.web3, ctx = this;
    if (!W.enabled) { if (!this._w3warn) { this._w3warn = 1; this.log('warn', 'Web3 está desactivado: actívalo en la pestaña Web3 del proyecto', 'web3'); } return null; }
    if (!UG.Web3) { this.log('error', 'Esta versión del motor no incluye web3', 'web3'); return null; }
    var provider = this.opts.web3Provider || (W.mode === 'mock' ? R.mockProvider(this.P) : null);
    var w = this._w3 = new UG.Web3.Wallet({ provider: provider, chains: W.chains, maxValue: W.maxValue });
    w.on('accountsChanged', function (a) { ctx.setVar('cuenta', a || ''); ctx.pushEvent({ type: 'web3', event: 'accountsChanged', data: a }); });
    w.on('chainChanged', function (id) { ctx.setVar('red', id); ctx._cc = Object.create(null); ctx.pushEvent({ type: 'web3', event: 'chainChanged', data: id }); });
    return w;
  };
  GameCtx.prototype.web3Fail = function (e) {
    if (e && e._ugs) return; if (e && typeof e === 'object') e._ugs = true;
    var m = String((e && e.message) || e).slice(0, 300);
    this.setVar('web3_error', m); this.log('warn', m, 'web3'); this.pushEvent({ type: 'web3', event: 'error', data: m });
  };
  GameCtx.prototype.failFn = function () { var ctx = this; return function (e) { ctx.web3Fail(e); }; };
  /** Proveedor listo (descubre la cartera instalada si hace falta), sin pedir cuentas */
  GameCtx.prototype.web3Ready = function () {
    var w = this.wallet(); if (!w) return Promise.reject(new Error('Web3 está desactivado en este proyecto'));
    if (w.provider) return Promise.resolve(w);
    return UG.Web3.discover().then(function (list) { if (!list.length) throw new Error('No hay ninguna cartera instalada (MetaMask, Rabby, Coinbase Wallet…)'); if (!w.provider) w.provider = list[0].provider; return w; });
  };
  GameCtx.prototype.web3Connect = function () {
    var ctx = this, w = this.wallet(); if (!w) return Promise.reject(new Error('Web3 está desactivado en este proyecto'));
    if (w.connected) return Promise.resolve(w);
    if (this._w3c) return this._w3c;
    var p = this._w3c = this.web3Ready().then(function () { return w.connect({ chainId: ctx.P.web3.defaultChain }); }).then(function () {
      ctx._w3c = null; ctx.setVar('cuenta', w.account); ctx.setVar('red', w.chainId);
      ctx.log('info', 'Cartera conectada: ' + UG.Web3.shortAddress(w.account) + ' · red ' + w.chainId + (w.provider && w.provider.isMock ? ' (simulada)' : ''), 'web3');
      ctx.pushEvent({ type: 'web3', event: 'connect', data: w.account });
      return w;
    }, function (e) { ctx._w3c = null; ctx.web3Fail(e); throw e; });
    return p;
  };
  /** Contrato del proyecto por nombre (o id) en la red actual */
  GameCtx.prototype.contract = function (name) {
    var w = this.wallet(); if (!w) return null;
    var W = this.P.web3, c = W.contracts.find(function (k) { return k.name === name || k.id === name; });
    if (!c) throw new Error('No existe el contrato «' + String(name).slice(0, 60) + '» (pestaña Web3)');
    var chain = w.chainId || W.defaultChain, key = c.id + ':' + chain;
    if (this._cc[key]) return this._cc[key];
    var addr = R.contractAddress(c, chain, !!(w.provider && w.provider.isMock));
    if (!addr) throw new Error('El contrato «' + c.name + '» no tiene dirección en la red ' + chain + ' (pestaña Web3 › Direcciones)');
    var abi; try { abi = JSON.parse(c.abi); } catch (e) { abi = []; }
    return (this._cc[key] = w.contract(addr, abi));
  };
  GameCtx.prototype.web3Read = function (name, fn, args, decimals) {
    var ctx = this;
    return this.web3Ready().then(function () { var c = ctx.contract(name); return c.read.apply(c, [fn].concat(args || [])); }).then(function (v) { return fromChain(v, decimals | 0); });
  };
  GameCtx.prototype.web3Write = function (name, fn, args, value) {
    var ctx = this;
    return this.web3Connect().then(function (w) {
      var c = ctx.contract(name), v = String(value === undefined ? '' : value).trim();
      var wei = v && v !== '0' ? UG.Web3.parseUnits(v.replace(/\s*eth(er)?$/i, ''), 18) : BigInt(0);
      return c.write(fn, args || [], { value: wei }).then(function (hash) {
        ctx.setVar('web3_tx', hash); ctx.log('info', 'Transacción enviada: ' + hash.slice(0, 18) + '…', 'web3');
        ctx.pushEvent({ type: 'web3', event: 'txSent', data: hash });
        return w.waitForReceipt(hash).then(function (r) { ctx.pushEvent({ type: 'web3', event: 'txConfirmed', data: hash }); return r; },
          function (e) { ctx.pushEvent({ type: 'web3', event: 'txFailed', data: String(e.message || e) }); throw e; });
      });
    });
  };
  GameCtx.prototype.web3Sign = function (msg) { return this.web3Connect().then(function (w) { return w.signMessage(msg); }); };
  /** api.web3 de los scripts */
  GameCtx.prototype.web3Api = function () {
    if (this._w3api) return this._w3api;
    var ctx = this;
    return (this._w3api = {
      get enabled() { return ctx.P.web3.enabled; },
      get wallet() { return ctx.wallet(); },
      get account() { var w = ctx._w3; return w ? w.account : null; },
      get chainId() { var w = ctx._w3; return w ? w.chainId : null; },
      get connected() { var w = ctx._w3; return !!(w && w.connected); },
      get mock() { var w = ctx._w3; return !!(w && w.provider && w.provider.isMock); },
      utils: UG.Web3 || null,
      connect: function () { return ctx.web3Connect(); },
      contract: function (name) { try { return Promise.resolve(ctx.web3Ready()).then(function () { return ctx.contract(name); }); } catch (e) { return Promise.reject(e); } },
      read: function (name, fn) { var a = Array.prototype.slice.call(arguments, 2); return ctx.web3Ready().then(function () { var c = ctx.contract(name); return c.read.apply(c, [fn].concat(a)); }); },
      write: function (name, fn, args, value) { return ctx.web3Write(name, fn, args, value); },
      sign: function (msg) { return ctx.web3Sign(String(msg)); },
      balance: function () { return ctx.web3Connect().then(function (w) { return w.getBalance(); }).then(function (b) { return UG.Web3.formatUnits(b, 18, 6); }); },
      on: function (ev, fn) { var w = ctx.wallet(); if (w && typeof fn === 'function') w.on(ev, fn); return this; }
    });
  };

  /* ---------------------------------------------------------------- HTTP (tu backend / APIs permitidas) */
  function originOf(u) { var m = /^(https?:\/\/[^\/?#]+)/i.exec(String(u || '')); return m ? m[1].toLowerCase() : ''; }
  GameCtx.prototype.backendBase = function () { return String(this.opts.backendURL || this.P.backend.url || '').replace(/\/+$/, ''); };
  /** /ruta -> tu backend; https://... solo si su origen está en «Orígenes permitidos» (o es el del backend) */
  GameCtx.prototype.resolveURL = function (path) {
    path = String(path || '').trim();
    if (/^\/(?!\/)/.test(path)) { if (/\.\.|[\s\\]/.test(path) || path.length > 2000) throw new Error('Ruta no válida: ' + path.slice(0, 80)); return this.backendBase() + path; }
    var o = originOf(path);
    if (!o || /\s/.test(path)) throw new Error('Ruta no válida: usa /api/... o una URL https:// permitida');
    var ok = this.P.settings.connectOrigins.map(function (x) { return x.toLowerCase(); }), b = originOf(this.backendBase());
    if (b) ok.push(b);
    if (ok.indexOf(o) < 0) throw new Error('El origen ' + o + ' no está en «Orígenes permitidos» (Proyecto › Ajustes)');
    return path;
  };
  GameCtx.prototype.http = function (method, path, body, o) {
    o = o || {}; var ctx = this, url;
    method = String(method || 'GET').toUpperCase();
    if (S.HTTP_METHODS.indexOf(method) < 0) return Promise.reject(new Error('Método HTTP no permitido: ' + method.slice(0, 10)));
    try { url = this.resolveURL(path); } catch (e) { return Promise.reject(e); }
    if (typeof fetch !== 'function') return Promise.reject(new Error('Este navegador no permite peticiones'));
    var now = Date.now(); this._httpT = this._httpT.filter(function (t) { return now - t < 1000; });
    if (this._httpT.length >= 20 || this._http >= 8) return Promise.reject(new Error('Demasiadas peticiones seguidas (máx. 20 por segundo y 8 a la vez)'));
    var init = { method: method, credentials: 'omit', cache: 'no-store', headers: {} };
    try {
      if (body !== undefined && body !== null && method !== 'GET' && method !== 'DELETE') {
        if (typeof body === 'string') { init.body = body; init.headers['Content-Type'] = /^\s*[\[{]/.test(body) ? 'application/json' : 'text/plain;charset=utf-8'; }
        else { init.body = JSON.stringify(jsonSafe(body, 1048576)); init.headers['Content-Type'] = 'application/json'; }
        if (init.body.length > 1048576) throw new Error('Cuerpo demasiado grande (máx. 1 MB)');
      }
    } catch (e) { return Promise.reject(e); }
    if (this.opts.backendToken && this.backendBase() && url.indexOf(this.backendBase() + '/') === 0) init.headers['X-UG-Dev'] = String(this.opts.backendToken);
    this._httpT.push(now); this._http++;
    var ac = typeof AbortController === 'function' ? new AbortController() : null, timer = null, done = false;
    var fin = function () { if (done) return; done = true; ctx._http--; if (timer) clearTimeout(timer); };
    if (ac) { init.signal = ac.signal; timer = setTimeout(function () { ac.abort(); }, Math.max(1000, Math.min(60000, o.timeout || 15000))); }
    return fetch(url, init).then(function (res) {
      if ((+res.headers.get('content-length') || 0) > 1048576) throw new Error('Respuesta demasiado grande (máx. 1 MB)');
      return res.text().then(function (t) {
        if (t.length > 1048576) throw new Error('Respuesta demasiado grande (máx. 1 MB)');
        var data = t, ct = res.headers.get('content-type') || '';
        if (/json/i.test(ct) || /^\s*[\[{]/.test(t)) { try { data = JSON.parse(t); } catch (e) { data = t; } }
        return { ok: res.ok, status: res.status, data: data, headers: { 'content-type': ct } };
      });
    }).then(function (r) { fin(); return r; }, function (e) { fin(); throw e && e.name === 'AbortError' ? new Error('La petición tardó demasiado') : e; });
  };
  GameCtx.prototype.log = function (level, text, source) {
    if (++this._logCount > 5000) return; // un bucle de errores no debe colgar el editor
    var msg = String(text).slice(0, 2000);
    if (this.opts.onLog) { try { this.opts.onLog(level, msg, source || ''); } catch (e) { /* ignorar */ } }
    else if (root.console) (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)('[' + (source || 'juego') + '] ' + msg);
  };
  GameCtx.prototype.sceneName = function (id) { var s = this.scenesById[id]; return s ? s.name : id; };
  GameCtx.prototype.findScene = function (ref) { if (!ref) return null; return this.scenesById[ref] || this.scenesByName[ref] || null; };

  function bootScene(ctx) {
    return {
      key: '__ugs_boot',
      preload: function () {
        var L = this.load, W = this.game.width, H = this.game.height, g = this.add.graphics();
        // Mantener assets/model.gltf como base lógica: sus .bin/texturas, un MTL o
        // tilesets externos siguen resolviéndose aunque los bytes sean blob:/data:.
        var files = Object.create(null), available = Object.create(null);
        ctx.P.assets.forEach(function (a) { var u = ctx.assetURL(a); if (u) { files[a.file] = u; available[a.id] = true; } });
        if (L.setURLResolver) L.setURLResolver(function (url) {
          if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(url)) return url;
          var key = String(url).split(/[?#]/)[0];
          try { key = decodeURIComponent(key); } catch (e) { /* conserva la ruta */ }
          key = key.replace(/^\.\//, '');
          return Object.prototype.hasOwnProperty.call(files, key) ? files[key] : url;
        });
        L.on('progress', function (p) { g.clear().fillStyle(0x222638, 1).fillRoundedRect(W * 0.2, H / 2 - 8, W * 0.6, 16, 8).fillStyle(0x4c6ef5, 1).fillRoundedRect(W * 0.2, H / 2 - 8, Math.max(16, W * 0.6 * p), 16, 8); });
        L.on('loaderror', function (f) { ctx.log('error', 'No se pudo cargar el recurso "' + ((ctx.assetsById[f && f.key] || {}).name || (f && f.key)) + '"', 'carga'); });
        ctx.P.assets.forEach(function (a) {
          if (!available[a.id]) { ctx.log('error', 'Falta el recurso "' + a.name + '" (' + a.file + ')', 'carga'); return; }
          var url = L.setURLResolver ? a.file : files[a.file];
          try {
            if (a.type === 'image') {
              if (a.frameWidth > 0) L.spritesheet(a.id, url, { frameWidth: a.frameWidth, frameHeight: a.frameHeight || a.frameWidth });
              else if (/\.svg$/i.test(a.file)) L.svg(a.id, url); else L.image(a.id, url);
            } else if (a.type === 'audio') L.audio(a.id, url);
            else if (a.type === 'model') { if (/\.obj$/i.test(a.file)) L.obj(a.id, url); else L.gltf(a.id, url); }
            else if (a.type === 'tilemap') { if (/\.tmx$/i.test(a.file)) L.tilemapTMX(a.id, url); else L.tilemapTiledJSON(a.id, url); }
            else if (a.type === 'font') L.font('ugs-' + a.id, url);
          } catch (e) { ctx.log('error', 'Recurso "' + a.name + '": ' + e.message, 'carga'); }
        });
      },
      create: function () {
        var first = ctx.findScene(ctx.opts.startScene) || ctx.findScene(ctx.P.startScene) || ctx.P.scenes[0];
        this.scene.start(first.id);
      }
    };
  }
  function sceneConfig(ctx, def) {
    return {
      key: def.id,
      create: function (data) {
        var rt = this.ugs = new SceneRT(ctx, this, def, data || {}), self = this;
        this.events.once('shutdown', function () { rt.shutdown(); if (self.ugs === rt) self.ugs = null; });
        try { rt.build(); } catch (e) { ctx.log('error', 'Error al crear la escena: ' + (e && e.message), def.name); if (root.console) console.error(e); }
      },
      update: function (time, delta) { if (this.ugs) this.ugs.update(time, delta); }
    };
  }

  /* =============================================================== escena en ejecución */
  function SceneRT(ctx, scene, def, data) {
    this.ctx = ctx; this.scene = scene; this.def = def; this.is3d = def.kind === '3d'; this.data = data;
    this.entities = []; this.byTag = Object.create(null); this.defsById = Object.create(null); this.defsByName = Object.create(null);
    this.children = Object.create(null); // id de nodo -> hijos (definiciones)
    this.t = 0; this.frame = 0; this._eid = 0; this.view = null; this.world3 = null;
    this.statics = []; this.dynamics = []; this.solids = []; this.layers = [];
    this.contacts = Object.create(null); this.newContacts = []; this.watch = []; this.clicked = []; this.pointerDownFrame = -1;
    this.dyn = []; this.sceneScript = null; this._goto = null; this.sfx3d = false; this.alive = true;
    this.cam3 = null; this.controls = null; this.W = scene.game.width; this.H = scene.game.height;
    this.env2d = def.env2d || S.defaultsOf(S.SCENE_ENV_2D); this.rigid = !this.is3d && this.env2d.engine === 'rigid';
    this.lights2 = []; this._lightsOn = false; this.evNow = []; this.papi = []; this.sunlight = null;
    var self = this;
    def.nodes.forEach(function (n) { self.defsById[n.id] = n; if (!self.defsByName[n.name]) self.defsByName[n.name] = n; (self.children[n.parent || ''] || (self.children[n.parent || ''] = [])).push(n); });
  }
  SceneRT.prototype.log = function (level, msg, src) { this.ctx.log(level, msg, src || this.def.name); };

  SceneRT.prototype.build = function () {
    var sc = this.scene, def = this.def, self = this;
    sc.cameras.main.setBackgroundColor(colorNum(def.background));
    this.ctx.rts.push(this);
    if (this.is3d) this.buildView();
    else {
      sc.physics.world.setGravity(0, def.gravity);
      sc.physics.world.setBounds(0, 0, this.W, this.H);
      if (this.rigid && !this.editMode) sc.rigid.world.gravity.set(0, def.gravity);
      if (this.env2d.lights) this.enableLights();
      if (this.env2d.weather !== 'none' && !this.editMode) sc.weather2d(this.env2d.weather);
    }
    // efectos de escena (posproceso): en 2D sobre la cámara, en 3D sobre la vista
    var fx = def.effects.map(makeFilter).filter(Boolean);
    if (fx.length) { if (this.view) this.view.filters = fx; else sc.cameras.main.setFilters(fx); }
    // nodos (las plantillas "prefab" no se crean: solo sirven para "Crear copia")
    (this.children[''] || []).forEach(function (n) { if (!n.prefab) self.spawnTree(n, null, null); });
    this.setupColliders();
    if (this.rigid && !this.editMode) this.rigidBounds();
    // interacción
    sc.input.on('pointerdown', function () { self.pointerDownFrame = self.frame + 1; });
    // script de escena
    if (def.script && def.script.trim()) this.sceneScript = this.makeScript('__scene_' + def.id, null);
    // arranque: comportamientos y scripts
    this.entities.slice().forEach(function (e) { self.startEntity(e); });
    if (this.sceneScript) this.callHook(this.sceneScript, 'onStart', []);
    if (!this.editMode) this.papi = this.ctx.plugins.map(function (pl) { var a = new ScriptAPI(self, null, pl.name); callHookCtx(self.ctx, pl, 'onSceneStart', [a]); return a; });
    this.compileWatch();
  };
  /** Luces 2D (capa de luz con sombras); se activa sola al haber un nodo «Luz 2D» */
  SceneRT.prototype.enableLights = function () {
    if (this._lightsOn || this.is3d) return;
    this._lightsOn = true;
    this.scene.lights2d.enable({ ambient: colorNum(this.env2d.ambient || '#1a1e30') });
  };
  /** Bordes del mundo para el motor de cuerpos rígidos (si algún cuerpo «choca con los bordes») */
  SceneRT.prototype.rigidBounds = function () {
    var need = this.entities.some(function (e) { return e.obj && e.obj.rbody && e.node.physics.worldBounds && e.node.physics.type !== 'static'; });
    if (!need) return;
    var B = this.scene.physics.world.bounds, t = 400, w = this.scene.rigid.world, x = B.x, y = B.y, W = B.width, H = B.height;
    this.rigidWalls = [w.addStatic(x - t / 2, y + H / 2, t, H + t * 2, { friction: 0.2 }), w.addStatic(x + W + t / 2, y + H / 2, t, H + t * 2, { friction: 0.2 }),
      w.addStatic(x + W / 2, y + H + t / 2, W + t * 2, t), w.addStatic(x + W / 2, y - t / 2, W + t * 2, t)];
  };

  SceneRT.prototype.buildView = function () {
    var def = this.def, env = def.env, sc = this.scene;
    var camNode = def.nodes.find(function (n) { return n.type === 'camera3d'; });
    var v = this.view = sc.add.view3d({ shadows: env.shadows, antialias: env.antialias, fov: camNode ? camNode.props.fov : 60, far: camNode ? camNode.props.far : 1000 });
    v.scene3d.background = colorNum(def.background);
    if (env.sky) v.scene3d.setSky({ top: colorNum(env.skyTop), horizon: colorNum(env.skyHorizon), bottom: colorNum(env.skyBottom),
      clouds: env.clouds ? { coverage: env.cloudCoverage, speed: env.cloudSpeed } : null, stars: env.stars ? 1 : 0, moon: env.stars ? 1 : 0 });
    if (env.fog === 'exp2') v.scene3d.setFog('exp2', colorNum(env.fogColor), Math.min(1, env.fogDensity));
    else if (env.fog === 'linear') { var far = env.fogDensity > 1 ? env.fogDensity : 120; v.scene3d.setFog('linear', colorNum(env.fogColor), far * 0.25, far); }
    v.scene3d.exposure = env.exposure;
    if (env.sun) { var sl = this.sunlight = v.add.sunlight({ color: colorNum(env.sunColor), intensity: env.sunIntensity, direction: env.sunDir, shadows: env.shadows, ambient: env.ambient, shadowSize: 60 }); this.sun = sl.sun; }
    else if (env.ambient > 0) this.sunlight = { sun: null, hemi: v.add.hemisphereLight(0xcfe4ff, 0x6b5b45, env.ambient) };
    if (env.dayNight) v.dayNight({ time: env.timeOfDay, speed: this.editMode ? 0 : env.daySpeed, sun: this.sunlight ? this.sunlight.sun : null, hemi: this.sunlight ? this.sunlight.hemi : null, stars: env.stars || env.dayNight, moon: env.stars || env.dayNight });
    if (env.weather !== 'none') v.weather(env.weather);
    this.world3 = this.editMode ? null : v.enablePhysics({ gravity: env.gravity });
    var cam = v.camera;
    if (camNode) { cam.position.set(camNode.position[0], camNode.position[1], camNode.position[2]); cam.lookAt(camNode.props.target[0], camNode.props.target[1], camNode.props.target[2]); }
    else { cam.position.set(0, 6, 12); cam.lookAt(0, 0, 0); }
  };

  /** Crea un nodo y sus hijos. at: {x,y,z} opcional para el nodo raíz. */
  SceneRT.prototype.spawnTree = function (node, parentEnt, at) {
    var ent = this.createEntity(node, parentEnt, at), self = this;
    if (!ent) return null;
    (this.children[node.id] || []).forEach(function (c) { self.spawnTree(c, ent, null); });
    return ent;
  };

  SceneRT.prototype.createEntity = function (node, parentEnt, at) {
    if (this.entities.length > 20000) { this.log('warn', 'Demasiados objetos (máx. 20000)'); return null; }
    var T = S.NODE_TYPES[node.type], is3d = T.kind === '3d';
    if (is3d && !this.view) return null; // nodo 3D en escena 2D: se ignora
    var ent = { id: ++this._eid, node: node, name: node.name, tags: node.tags.slice(), vars: Object.create(null), alive: true, obj: null, is3d: is3d,
      parent: parentEnt && parentEnt.is3d === is3d ? parentEnt : null, behaviors: [], script: null, hp: null, deathFx: 'none', body: null, ch: null, car: null, statics: [], rt: this, _box: null, _boxFrame: -1 };
    Object.keys(node.vars).forEach(function (k) { ent.vars[k] = node.vars[k]; });
    var obj;
    try { obj = is3d ? this.make3D(node, ent) : this.make2D(node, ent); }
    catch (e) { this.log('error', 'No se pudo crear "' + node.name + '": ' + e.message); return null; }
    if (!obj) return null;
    ent.obj = obj; obj.name = node.name; obj.ugsEntity = ent;
    if (ent.parent && ent.parent.obj) { if (is3d) ent.parent.obj.add(obj); else ent.parent.obj.addChild(obj); }
    if (at) { if (is3d) obj.position.set(at.x, at.y, at.z); else { obj.x = at.x; obj.y = at.y; } }
    obj.visible = node.visible;
    this.setupPhysics(ent);
    var self = this;
    node.behaviors.forEach(function (b) { var B = BEHAVIORS[b.type]; if (!B) return; var k = S.BEHAVIORS[b.type].kind; if (k !== 'both' && (k === '3d') !== is3d) return; var inst = B(self, ent, b.params); if (inst) ent.behaviors.push(inst); });
    if (node.script) ent.script = this.makeScript(node.script, ent);
    this.entities.push(ent);
    ent.tags.forEach(function (t) { (self.byTag[t] || (self.byTag[t] = [])).push(ent); });
    if (this._started) this.startEntity(ent);
    return ent;
  };
  SceneRT.prototype.startEntity = function (ent) {
    if (ent._startedE) return; ent._startedE = true;
    for (var i = 0; i < ent.behaviors.length; i++) if (ent.behaviors[i].start) { try { ent.behaviors[i].start(); } catch (e) { this.log('error', 'Comportamiento: ' + e.message, ent.name); } }
    if (ent.script) this.callHook(ent.script, 'onStart', []);
  };

  /* ---------------------------------------------------------------- objetos 2D */
  SceneRT.prototype.make2D = function (node, ent) {
    var sc = this.scene, p = node.props, add = (node.hud || this.is3d) && !this.hudAsWorld ? sc.add.hud : sc.add, ctx = this.ctx, o, self = this;
    var hasAsset = function (id) { return assetExists(ctx, id) && sc.textures.exists(id); };
    switch (node.type) {
      case 'sprite': {
        var key = hasAsset(p.asset) ? p.asset : '__WHITE', sheet = key !== '__WHITE' && ctx.assetsById[key].frameWidth > 0;
        o = add.sprite(node.x, node.y, key, sheet ? p.frame : undefined); // imagen suelta: sin número de fotograma
        if (key === '__WHITE') o.setDisplaySize(p.width || 64, p.height || 64);
        else if (p.width > 0 || p.height > 0) o.setDisplaySize(p.width || o.width, p.height || o.height);
        o.setOrigin(p.originX, p.originY); o.setTint(colorNum(p.tint)); o.setFlip(p.flipX, p.flipY);
        var frames = sheet ? parseFrames(p.anim) : [];
        if (frames.length > 1) {
          var ak = 'ugs:' + node.id; if (!sc.anims.exists(ak)) sc.anims.create({ key: ak, frames: frames.map(function (f) { return { key: key, frame: f }; }), frameRate: p.animFps, repeat: p.animLoop ? -1 : 0 });
          o.play(ak); ent.animKey = ak;
        }
        break;
      }
      case 'shape': {
        var w = p.width, h = p.height, fill = colorNum(p.fill);
        if (p.shape === 'circle') o = add.circle(node.x, node.y, w / 2, fill, p.fillAlpha);
        else if (p.shape === 'ellipse') o = add.ellipse(node.x, node.y, w, h, fill, p.fillAlpha);
        else if (p.shape === 'roundrect') o = add.roundRectangle(node.x, node.y, w, h, Math.min(p.radius, w / 2, h / 2), fill, p.fillAlpha);
        else if (p.shape === 'triangle') o = add.triangle(node.x, node.y, 0, h, w / 2, 0, w, h, fill, p.fillAlpha);
        else if (p.shape === 'star') o = add.star(node.x, node.y, p.points, w / 4, w / 2, fill, p.fillAlpha);
        else o = add.rectangle(node.x, node.y, w, h, fill, p.fillAlpha);
        if (p.strokeWidth > 0) o.setStrokeStyle(p.strokeWidth, colorNum(p.stroke), 1);
        break;
      }
      case 'text': {
        var style = { fontFamily: p.font, fontSize: p.size, fontWeight: p.bold ? 'bold' : 'normal', fill: colorNum(p.color), align: p.align, stroke: colorNum(p.strokeColor), strokeThickness: p.strokeWidth };
        if (p.wrap > 0) { style.wordWrap = true; style.wordWrapWidth = p.wrap; }
        o = add.text(node.x, node.y, this.interp(p.text, ent), style); o.setOrigin(p.align === 'left' ? 0 : p.align === 'right' ? 1 : 0.5, 0.5);
        if (p.text.indexOf('{') >= 0) this.dyn.push({ ent: ent, tpl: p.text, last: null });
        break;
      }
      case 'tilesprite': {
        o = add.tileSprite(node.x, node.y, p.width, p.height, hasAsset(p.asset) ? p.asset : '__WHITE');
        o.tileScaleX = o.tileScaleY = p.tileScale;
        if (p.scrollX || p.scrollY) ent.scroll = [p.scrollX, p.scrollY];
        break;
      }
      case 'particles': {
        var cfg = particleConfig(p.preset, p);
        o = add.particles(node.x, node.y, hasAsset(p.asset) ? p.asset : dotTexture(sc), cfg);
        if (cfg.frequency === -1 && p.emitting) o.explode(cfg.quantity);
        break;
      }
      case 'button': {
        o = add.button(node.x, node.y, { text: this.interp(p.text, ent), width: p.width, height: p.height, color: colorNum(p.color), textStyle: { fontSize: p.fontSize, fill: colorNum(p.textColor) } });
        o.on('click', function () { self.onClick(ent); if (p.goto) self.gotoScene(p.goto); });
        break;
      }
      case 'light2d': {
        o = add.container(node.x, node.y);
        if (node.hud || this.is3d) { this.log('warn', 'Las luces 2D no funcionan en el HUD ni en escenas 3D', node.name); break; }
        this.enableLights();
        ent.light2d = sc.lights2d.addLight(node.x, node.y, p.radius, colorNum(p.color), p.intensity, { shadows: p.shadows, flicker: this.editMode ? 0 : p.flicker });
        this.lights2.push(ent);
        if (this.editMode) { var gm = new UG.Graphics(); gm.fillStyle(colorNum(p.color), 1).fillCircle(0, 0, 9).lineStyle(2, 0x000000, 0.7).strokeCircle(0, 0, 9); o.addChild(gm); }
        break;
      }
      case 'clouds2d': {
        o = add.clouds({ y: 0, layers: p.layers, speed: this.editMode ? 0 : p.speed, coverage: p.coverage, parallax: p.parallax, color: colorNum(p.color), alpha: p.alpha, height: p.height, seed: node.id });
        o.x = 0; o.y = node.y; ent.fixedX = true;
        break;
      }
      case 'sky2d': o = add.skyGradient(colorNum(p.top), colorNum(p.bottom)); ent.fixedX = true; break;
      case 'bar': {
        o = add.container(node.x, node.y); var g = new UG.Graphics(); o.addChild(g);
        ent.bar = { g: g, last: null };
        this.dyn.push({ ent: ent, bar: true });
        break;
      }
      case 'tilemap': {
        if (!assetExists(ctx, p.asset) || !sc.cache.tilemap.exists(p.asset)) { this.log('warn', 'Mapa de Tiled sin cargar', node.name); o = add.container(node.x, node.y); break; }
        var map = sc.add.tilemap(p.asset), tsets = [];
        (map.tilesets || []).forEach(function (ts) { var t = hasAsset(p.tileset) ? map.addTilesetImage(ts.name, p.tileset) : null; if (t) tsets.push(t); });
        o = add.container(node.x, node.y);
        var solidNames = p.collide.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        (map.layers || []).forEach(function (L) {
          if (L.type && L.type !== 'tilelayer') return;
          var layer = map.createLayer(L.name, tsets, 0, 0); if (!layer) return;
          o.addChild(layer);
          if (p.collideAll || solidNames.indexOf(L.name) >= 0) {
            layer.setCollisionByExclusion([-1, 0]); self.layers.push(layer);
            if (self._lightsOn || self.env2d.lights) sc.lights2d.occludeTilemap(layer);
            if (self.rigid && !self.editMode) sc.rigid.add.tilemap(layer);
          }
        });
        break;
      }
      default: o = add.container(node.x, node.y);
    }
    if (node.type !== 'button' && node.type !== 'tilemap') { o.scaleX *= node.scaleX; o.scaleY *= node.scaleY; } else { o.scaleX = node.scaleX; o.scaleY = node.scaleY; }
    o.angle = node.rotation; o.alpha = node.alpha;
    if (!(ent.fixedX && node.depth === 0)) o.depth = node.depth; // nubes y cielo: detrás de todo salvo que se pida otra cosa
    if (node.blend !== 'normal' && o.setBlendMode) o.setBlendMode(node.blend);
    var fx = node.effects.map(makeFilter).filter(Boolean); if (fx.length) o.filters = fx;
    return o;
  };

  /* ---------------------------------------------------------------- objetos 3D */
  SceneRT.prototype.material3D = function (p) {
    var m = { color: colorNum(p.color), metalness: p.metalness, roughness: p.roughness, emissive: colorNum(p.emissive), emissiveIntensity: p.emissiveIntensity };
    if (p.map && assetExists(this.ctx, p.map) && this.scene.textures.exists(p.map)) { m.map = p.map; if (p.uvScale !== 1) m.uvScale = p.uvScale; }
    if (p.opacity < 1) { m.opacity = p.opacity; m.transparent = true; }
    if (p.shading === 'toon') { m.type = 'toon'; if (p.outline > 0) m.outline = p.outline; }
    else if (p.shading === 'unlit') m.type = 'basic';
    else if (p.shading === 'flat') m.flatShading = true;
    return this.view.material(m);
  };
  SceneRT.prototype.make3D = function (node, ent) {
    var v = this.view, p = node.props, o, self = this, ctx = this.ctx, sc = this.scene;
    switch (node.type) {
      case 'mesh3d': {
        var m = this.material3D(p), x = p.sizeX, y = p.sizeY, z = p.sizeZ, seg = p.segments | 0;
        if (p.shape === 'sphere') o = v.add.sphere(x / 2, m, seg);
        else if (p.shape === 'plane') o = v.add.plane(x, z, m);
        else if (p.shape === 'cylinder') o = v.add.cylinder(x / 2, x / 2, y, m, seg);
        else if (p.shape === 'cone') o = v.add.cone(x / 2, y, m, seg);
        else if (p.shape === 'capsule') o = v.add.capsule(x / 2, Math.max(0, y - x), m);
        else if (p.shape === 'torus') o = v.add.torus(x / 2, Math.max(0.01, y / 4), m);
        else o = v.add.box(x, y, z, m);
        o.castShadow = p.castShadow; o.receiveShadow = p.receiveShadow;
        break;
      }
      case 'model': {
        var cache = sc.cache.models, tinted = p.tint !== '#ffffff';
        if (!assetExists(ctx, p.asset) || !cache || !cache.get(p.asset)) { o = v.add.box(1, 1, 1, { color: 0xff4fd8, type: 'basic' }); this.log('warn', 'Modelo sin cargar: se muestra un cubo rosa', node.name); break; }
        o = v.add.model(p.asset, { cloneMaterials: tinted });
        if (tinted) { var tc = colorNum(p.tint); o.traverse(function (n) { if (n.material && n.material.color !== undefined) n.material.color = mulColor(n.material.color, tc); }); }
        o.traverse(function (n) { if (n instanceof UG.Mesh3D) { n.castShadow = p.castShadow; n.receiveShadow = p.receiveShadow; } });
        if (p.clip && o.play) { var a = o.play(p.clip, { fade: 0 }); if (a) a.speed = p.animSpeed; else this.log('warn', 'El modelo no tiene la animación "' + p.clip + '"', node.name); }
        break;
      }
      case 'light': {
        var col = colorNum(p.color);
        if (p.light === 'directional') {
          o = v.add.directionalLight(col, p.intensity);
          var d = new V3(-node.position[0], -node.position[1], -node.position[2]); if (d.length() < 1e-6) d.set(-0.45, -1, -0.35);
          o.setDirection(d.x, d.y, d.z); if (p.castShadow) o.enableShadows({ size: p.shadowSize, mapSize: 2048 });
        }
        else if (p.light === 'spot') o = v.add.spotLight(col, p.intensity, p.range, p.angle * DEG, 0.3);
        else if (p.light === 'hemisphere') o = v.add.hemisphereLight(col, colorNum(p.groundColor), p.intensity);
        else if (p.light === 'ambient') o = v.add.ambientLight(col, p.intensity);
        else o = v.add.pointLight(col, p.intensity, p.range, 2);
        break;
      }
      case 'particles3d': {
        var base = UG.PARTICLE3D_PRESETS[p.preset] || UG.PARTICLE3D_PRESETS.fire, cfg = { autoStart: p.emitting };
        if (base.rate > 0) cfg.rate = base.rate * p.rate; else cfg.burst = Math.max(1, Math.round((base.burst || 20) * p.rate));
        if (base.size) cfg.size = [base.size[0] * p.size, base.size[1] * p.size];
        if (p.useColors) cfg.color = [colorNum(p.color1), colorNum(p.color2)];
        o = v.addParticles(p.preset, cfg);
        break;
      }
      case 'sprite3d': o = v.add.sprite(assetExists(ctx, p.asset) && sc.textures.exists(p.asset) ? p.asset : '__WHITE', p.width, p.height); break;
      case 'terrain': {
        var tm = this.material3D({ color: p.color, map: p.map, uvScale: p.uvScale, metalness: 0, roughness: 0.95, emissive: '#000000', emissiveIntensity: 1, opacity: 1, shading: 'standard', outline: 0 });
        o = v.add.terrain(p.width, p.depth, p.segments | 0, p.segments | 0, R.terrainHeight(p), tm);
        o.receiveShadow = true; o.castShadow = false;
        break;
      }
      case 'gridlevel': {
        var rows = p.rows.split('\n').map(function (r) { return r.replace(/\r/g, ''); }).filter(function (r, i, arr) { return r.length || i < arr.length - 1; }).slice(0, 256).map(function (r) { return r.slice(0, 256); });
        var mats = { wall: this.material3D({ color: p.wallColor, map: p.wallMap, uvScale: 1, metalness: 0, roughness: 0.9, emissive: '#000000', emissiveIntensity: 1, opacity: 1, shading: 'standard', outline: 0 }),
          floor: this.material3D({ color: p.floorColor, map: p.floorMap, uvScale: 1, metalness: 0, roughness: 1, emissive: '#000000', emissiveIntensity: 1, opacity: 1, shading: 'standard', outline: 0 }),
          crate: this.material3D({ color: p.crateColor, map: '', uvScale: 1, metalness: 0, roughness: 0.8, emissive: '#000000', emissiveIntensity: 1, opacity: 1, shading: 'standard', outline: 0 }), ceiling: p.ceiling ? this.view.material({ color: colorNum(p.wallColor) }) : null };
        var lv = UG.Level3D.fromGrid(v, rows, { '#': 'wall', '.': 'floor', C: 'crate', c: 'crate' }, { cell: p.cell, wallHeight: p.wallHeight, materials: mats, offset: { x: node.position[0], y: node.position[1], z: node.position[2] }, physics: !this.editMode });
        o = lv.root; ent.level = lv; ent.noTransform = true;
        break;
      }
      case 'grass': {
        var h0 = Math.min(p.heightMin, p.heightMax), h1 = Math.max(p.heightMin, p.heightMax);
        o = v.add.grass({ area: [-p.width / 2, -p.depth / 2, p.width / 2, p.depth / 2], density: p.density, height: [h0, h1], color: colorNum(p.color), tipColor: colorNum(p.tipColor), wind: p.wind, seed: p.seed, heightAt: this.groundAt(node), max: 120000 });
        break;
      }
      case 'water': o = v.add.water(p.width, p.depth, { color: colorNum(p.color), opacity: p.opacity, waveHeight: p.waveHeight }); break;
      case 'scatter': {
        if (!assetExists(ctx, p.asset) || !sc.cache.models || !sc.cache.models.get(p.asset)) { o = new UG.Group3D(); v.scene3d.add(o); if (p.asset) this.log('warn', 'Modelo sin cargar para la dispersión', node.name); break; }
        o = v.add.scatter(p.asset, { area: [-p.width / 2, -p.depth / 2, p.width / 2, p.depth / 2], count: p.count, scale: [Math.min(p.scaleMin, p.scaleMax), Math.max(p.scaleMin, p.scaleMax)], minDistance: p.minDistance, wind: p.wind, seed: p.seed, heightAt: this.groundAt(node) });
        break;
      }
      case 'camera3d': o = new UG.Group3D(); v.scene3d.add(o); break;
      default: o = new UG.Group3D(); v.scene3d.add(o);
    }
    if (!ent.noTransform) {
      o.position.set(node.position[0], node.position[1], node.position[2]);
      o.rotation.set(node.rotation[0] * DEG, node.rotation[1] * DEG, node.rotation[2] * DEG);
      o.scale.set(node.scale[0], node.scale[1], node.scale[2]);
    }
    return o;
  };
  /** Altura del suelo (terrenos de la escena) en coordenadas locales de un nodo: para plantar hierba y árboles encima */
  SceneRT.prototype.groundAt = function (node) {
    var px = node.position[0], py = node.position[1], pz = node.position[2];
    var ters = this.def.nodes.filter(function (n) { return n.type === 'terrain' && !n.prefab; }).map(function (t) { return { n: t, f: R.terrainHeight(t.props) }; });
    if (!ters.length) return null;
    return function (x, z) {
      var wx = x + px, wz = z + pz;
      for (var i = 0; i < ters.length; i++) {
        var t = ters[i].n, tp = t.props, lx = (wx - t.position[0]) / (t.scale[0] || 1), lz = (wz - t.position[2]) / (t.scale[2] || 1);
        if (Math.abs(lx) <= tp.width / 2 && Math.abs(lz) <= tp.depth / 2) return ters[i].f(lx, lz) * t.scale[1] + t.position[1] - py;
      }
      return 0;
    };
  };
  function mulColor(a, b) { var r = ((a >> 16) & 255) * ((b >> 16) & 255) / 255, g = ((a >> 8) & 255) * ((b >> 8) & 255) / 255, bl = (a & 255) * (b & 255) / 255; return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl); }

  /* ---------------------------------------------------------------- física */
  SceneRT.prototype.setupPhysics = function (ent) {
    var ph = ent.node.physics, o = ent.obj;
    if (!ent.is3d && ph && ph.shadow && !ent.node.hud && !this.is3d && ph.type === 'none') { ent.occluder = this.scene.lights2d.addOccluder(o); return; }
    if (!ph || ph.type === 'none' || this.editMode) { if (ph && ph.shadow && !ent.is3d && !ent.node.hud && !this.is3d) ent.occluder = this.scene.lights2d.addOccluder(o); return; }
    if (!ent.is3d) {
      if (ent.node.hud || this.is3d) return;
      if (this.rigid) { this.setupRigid(ent, ph, o); if (ph.shadow) ent.occluder = this.scene.lights2d.addOccluder(o.rbody || o); return; }
      if (ph.shadow) ent.occluder = this.scene.lights2d.addOccluder(o);
      var arcade = this.scene.physics;
      if (ph.type === 'static') { arcade.add.existing(o, true); this.statics.push(o); return; }
      arcade.add.existing(o, false);
      var b = o.body; if (!b) return;
      b.setAllowGravity(ph.type === 'dynamic' && ph.gravity);
      b.setBounce(ph.bounce, ph.bounce); b.setDrag(ph.drag, ph.drag); b.setCollideWorldBounds(ph.worldBounds);
      if (ph.circle) { var r = Math.min(b.width, b.height) / 2; b.setCircle(r); }
      if (ph.type === 'kinematic') { b.setImmovable(true); b.setAllowGravity(false); }
      b.pushable = ph.pushable;
      this.dynamics.push(o); if (ph.solid) this.solids.push(o);
      return;
    }
    var W = this.world3; if (!W) return;
    if (ph.type === 'static') { if (ent.level) return; var c = W.addBoxFromNode(o, { restitution: ph.bounce }); if (c) ent.statics.push(c); }
    else if (ph.type === 'mesh') { var mc = W.addMesh(o); if (mc) ent.statics.push(mc); }
    else if (ph.type === 'body') {
      var bb = worldAABB(o), half = bb.getSize(new V3()).scale(0.5);
      ent.body = W.addBody(o, { shape: ph.shape, mass: ph.mass, restitution: ph.bounce, radius: ph.shape === 'sphere' ? Math.max(half.x, half.y, half.z) : ph.radius, half: half });
    }
    else if (ph.type === 'character') ent.ch = W.addCharacter(o, { radius: ph.radius, height: ph.height });
    else if (ph.type === 'trigger') { var tb = worldAABB(o); ent.trigger = { box: tb }; }
  };
  /** Cuerpo del motor de cuerpos rígidos: gira, se apila, fricción y densidad reales */
  SceneRT.prototype.setupRigid = function (ent, ph, o) {
    var circle = ph.circle || ent.node.props.shape === 'circle', w = Math.abs(o.displayWidth || o.width * o.scaleX) || 32, h = Math.abs(o.displayHeight || o.height * o.scaleY) || 32;
    var opt = { width: w, height: h, shape: circle ? 'circle' : 'box', radius: circle ? Math.min(w, h) / 2 : undefined, friction: ph.friction, restitution: ph.bounce, density: ph.density,
      fixedRotation: ph.fixedRotation, gravityScale: ph.gravity ? 1 : 0, linearDamping: ph.drag > 0 ? Math.min(20, ph.drag / 200) : 0.02 };
    if (ph.type === 'static') opt.isStatic = true; else if (ph.type === 'kinematic') opt.type = 'kinematic';
    this.scene.rigid.add.existing(o, opt);
    ent.rb = o.rbody || null;
  };
  SceneRT.prototype.setupColliders = function () {
    if (this.is3d || this.editMode || this.rigid) return;
    var ph = this.scene.physics;
    if (this.dynamics.length && this.statics.length) ph.add.collider(this.dynamics, this.statics);
    if (this.solids.length > 1) ph.add.collider(this.solids, this.solids);
    if (this.solids.length && this.dynamics.length) ph.add.collider(this.dynamics.filter(function (d) { return this.solids.indexOf(d) < 0; }, this), this.solids);
    for (var i = 0; i < this.layers.length; i++) if (this.dynamics.length) ph.add.collider(this.dynamics, this.layers[i]);
  };
  /** Cuerpos creados después del arranque (copias): se añaden a los grupos existentes */
  SceneRT.prototype.addToColliders = function (ent) {
    if (ent.is3d || this.editMode || !ent.obj.body || this.rigid) return;
    var ph = this.scene.physics, o = ent.obj;
    if (ent.node.physics.type === 'static') { if (this.dynamics.length) ph.add.collider(this.dynamics, o); return; }
    if (this.statics.length) ph.add.collider(o, this.statics);
    if (this.solids.length) ph.add.collider(o, this.solids);
    for (var i = 0; i < this.layers.length; i++) ph.add.collider(o, this.layers[i]);
  };

  /* ---------------------------------------------------------------- scripts */
  SceneRT.prototype.makeScript = function (id, ent) {
    var self = this, name = id.indexOf('__scene_') === 0 ? 'script de escena · ' + this.def.name : ((this.ctx.P.scripts.find(function (s) { return s.id === id; }) || {}).name || id);
    var f = SCRIPTS[id];
    if (!f) { if (!this._missing || !this._missing[id]) { (this._missing || (this._missing = {}))[id] = 1; this.log('warn', 'El script "' + name + '" no se cargó (¿tiene un error de sintaxis?)', name); } return null; }
    var api = new ScriptAPI(this, ent, name), inst;
    try { inst = f(UG, api, ent ? ent.obj : null) || {}; }
    catch (e) { this.log('error', 'Error al iniciar: ' + errText(e), name + (ent ? ' (' + ent.name + ')' : '')); return null; }
    return { name: name, fns: inst, api: api, ent: ent, failed: Object.create(null) };
  };
  function errText(e) { var s = e && e.message ? e.message : String(e); var m = e && e.stack ? /:(\d+):(\d+)\)?\s*$/m.exec(String(e.stack).split('\n')[1] || '') : null; return s + (m ? ' (línea ' + Math.max(1, (+m[1]) - 1) + ')' : ''); }
  SceneRT.prototype.callHook = function (sc, hook, args) { return callHookCtx(this.ctx, sc, hook, args); };
  /** API que reciben los scripts: api.xxx (ver documentación del Studio) */
  function ScriptAPI(rt, ent, name) { this._rt = rt; this._ent = ent; this.name = name; this.UG = UG; this.game = rt.scene.game; this.scene = rt.scene; this.view = rt.view; this.self = ent ? ent.obj : null; this.entity = ent; this.vars = rt.ctx.vars; this.my = ent ? ent.vars : Object.create(null); }
  var AP = ScriptAPI.prototype;
  AP.log = function () { this._rt.ctx.log('info', Array.prototype.map.call(arguments, fmt).join(' '), this.name); };
  AP.warn = function () { this._rt.ctx.log('warn', Array.prototype.map.call(arguments, fmt).join(' '), this.name); };
  function fmt(a) { if (typeof a === 'string') return a; try { return JSON.stringify(a); } catch (e) { return String(a); } }
  AP.key = function (k) { var kb = this.scene.input.keyboard; return !!(kb && kb.isDown(k)); };
  AP.pressed = function (k) { var kb = this.scene.input.keyboard; return !!(kb && kb.justPressed(k)); };
  AP.released = function (k) { var kb = this.scene.input.keyboard; return !!(kb && kb.justReleased && kb.justReleased(k)); };
  Object.defineProperty(AP, 'pointer', { get: function () { return this.scene.input.activePointer; } });
  Object.defineProperty(AP, 'time', { get: function () { return this._rt.t; } });
  Object.defineProperty(AP, 'camera', { get: function () { return this.view ? this.view.camera : this.scene.cameras.main; } });
  Object.defineProperty(AP, 'animKey', { get: function () { return this._ent ? this._ent.animKey || null : null; } });
  Object.defineProperty(AP, 'physics', { get: function () { return this.view ? this.view.physics : this.scene.physics; } });
  AP.find = function (ref) { var l = this._rt.resolve(ref, {}); return l.length ? l[0].obj : null; };
  AP.findAll = function (ref) { return this._rt.resolve(ref, {}).map(function (e) { return e.obj; }); };
  AP.entityOf = function (obj) { return obj && obj.ugsEntity ? obj.ugsEntity : null; };
  AP.spawn = function (template, x, y, z) { var e = this._rt.spawnCopy(template, x, y, z); return e ? e.obj : null; };
  AP.destroy = function (obj, effect) { var e = obj ? this.entityOf(obj) : this._ent; if (e) this._rt.destroyEntity(e, effect); };
  AP.damage = function (obj, n) { var e = obj ? this.entityOf(obj) : this._ent; if (e) this._rt.damage(e, n === undefined ? 1 : n); };
  AP.goto = function (scene) { this._rt.gotoScene(scene); };
  AP.restart = function () { this._rt.gotoScene(this._rt.def.id); };
  AP.sfx = function (preset, volume) { this._rt.playSound('sfx:' + preset, volume); };
  AP.sound = function (assetOrSfx, volume) { this._rt.playSound(assetOrSfx, volume); };
  AP.music = function (asset, volume) { this._rt.playMusic(asset, volume); };
  AP.stopMusic = function () { this.scene.sound.stopMusic(300); };
  AP.effect = function (preset, x, y, z) { this._rt.effectAt(preset, x === undefined ? this._rt.posOf(this._ent) : { x: x, y: y, z: z || 0 }); };
  AP.shake = function (ms, intensity) { this.scene.cameras.main.shake(ms || 250, intensity === undefined ? 0.01 : intensity); };
  AP.flash = function (color, ms) { this.scene.cameras.main.flash(ms || 250, color === undefined ? 0xffffff : colorNum(color)); };
  AP.text = function (tpl) { return this._rt.interp(tpl, this._ent); };
  AP.floatText = function (str, x, y, color) { var p = x === undefined ? this._rt.posOf(this._ent) : { x: x, y: y, z: 0 }; this._rt.floatText(String(str), p, color || '#ffd43b'); };
  AP.after = function (sec, fn) { var self = this, rt = this._rt; return this.scene.time.delayedCall(Math.max(0, sec) * 1000, function () { if (rt.alive) { try { fn(); } catch (e) { rt.log('error', 'after(): ' + errText(e), self.name); } } }); };
  AP.every = function (sec, fn) { var self = this, rt = this._rt; return this.scene.time.addEvent({ delay: Math.max(16, sec * 1000), loop: true, callback: function () { if (rt.alive) { try { fn(); } catch (e) { rt.log('error', 'every(): ' + errText(e), self.name); } } } }); };
  AP.tween = function (cfg) { return this.scene.tweens.add(cfg); };
  AP.random = function (a, b) { if (a === undefined) return Math.random(); if (b === undefined) { b = a; a = 0; } return a + Math.random() * (b - a); };
  AP.chance = function (p) { return Math.random() < p; };
  AP.emit = function (name, data) { this._rt.broadcast(String(name), data); };
  AP.save = function (key, value) { return R.saveData(this._rt.ctx, key, value); };
  AP.load = function (key, def) { return R.loadData(this._rt.ctx, key, def); };
  AP.get = function (name) { return this._rt.getVar(name, this._ent); };
  AP.set = function (name, value) { this._rt.setVar(name, value, this._ent); };
  AP.add = function (name, n) { this._rt.setVar(name, (Number(this._rt.getVar(name, this._ent)) || 0) + (n === undefined ? 1 : n), this._ent); };
  Object.defineProperty(AP, 'web3', { get: function () { return this._rt.ctx.web3Api(); } });
  Object.defineProperty(AP, 'bridge', { get: function () { return this._rt.ctx.bridge; } });
  Object.defineProperty(AP, 'lights2d', { get: function () { return this.view ? null : this.scene.lights2d; } });
  Object.defineProperty(AP, 'rigid', { get: function () { return this._rt.rigid ? this.scene.rigid : null; } });
  AP.http = function (method, path, body, o) { return this._rt.ctx.http(method, path, body, o); };
  AP.weather = function (kind, o) { this._rt.setWeather(kind, o); };
  AP.timeOfDay = function (h) { if (h === undefined) { var dn = this.view && this.view._dayNight; return dn && !dn.destroyed ? dn.time : null; } this._rt.setTimeOfDay(h); return h; };
  AP.decal = function (kind, x, y, z, o) { if (!this.view) return null; return this.view.addDecal(kind, new V3(x, y, z), (o && o.normal) || new V3(0, 1, 0), o || {}); };
  AP.impulse = function (obj, x, y, z) { var e = obj ? this.entityOf(obj) : this._ent; if (e) this._rt.impulse(e, +x || 0, +y || 0, +z || 0); };
  AP.light = function (x, y, radius, color, intensity, o) { if (this.view) return null; this._rt.enableLights(); return this.scene.lights2d.addLight(x, y, radius, color === undefined ? 0xffe0a8 : colorNum(color), intensity, o); };
  AP.distance = function (a, b) { var p = this._rt.posOf(this.entityOf(a) || { obj: a }), q = this._rt.posOf(this.entityOf(b) || { obj: b }); return Math.hypot(p.x - q.x, p.y - q.y, (p.z || 0) - (q.z || 0)); };

  /* ---------------------------------------------------------------- variables y texto */
  SceneRT.prototype.getVar = function (name, ent) {
    if (typeof name !== 'string' || S.isForbiddenKey(name)) return undefined;
    if (ent && name in ent.vars) return ent.vars[name];
    if (name.indexOf('mi.') === 0 && ent) return ent.vars[name.slice(3)];
    if (name.indexOf('.') > 0 && !(name in this.ctx.vars)) {
      // respuesta.jugador.nombre: recorre objetos (respuestas JSON de la red, del puente o de web3)
      var parts = name.split('.'), v = this.getVar(parts[0], ent);
      for (var i = 1; i < parts.length; i++) {
        if (v === null || typeof v !== 'object' || S.isForbiddenKey(parts[i]) || !Object.prototype.hasOwnProperty.call(v, parts[i])) return undefined;
        v = v[parts[i]];
      }
      return v;
    }
    return this.ctx.vars[name];
  };
  SceneRT.prototype.setVar = function (name, value, ent) {
    if (typeof name !== 'string' || !name || S.isForbiddenKey(name) || name.length > 40) return;
    if (typeof value === 'number' && !isFinite(value)) value = 0;
    if (ent && (name in ent.vars)) { ent.vars[name] = value; return; }
    if (name.indexOf('mi.') === 0 && ent) { var k = name.slice(3); if (!S.isForbiddenKey(k)) ent.vars[k] = value; return; }
    if (!(name in this.ctx.vars) && Object.keys(this.ctx.vars).length > 2000) return;
    this.ctx.vars[name] = value;
  };
  SceneRT.prototype.interp = function (tpl, ent, json) {
    var self = this;
    return String(tpl).replace(VAR_RE, function (all, name) {
      var v = name === 'juego' && self.getVar(name, ent) === undefined ? self.ctx.P.name : self.getVar(name, ent);
      if (v === undefined) return all;
      if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
      if (v !== null && typeof v === 'object') return fmt(v);
      return json ? JSON.stringify(String(v)).slice(1, -1) : String(v);
    });
  };

  /* ---------------------------------------------------------------- consultas */
  /** "self" | "other" | "tag:x" | "name:x" | "all" | nombre o etiqueta -> entidades vivas */
  SceneRT.prototype.resolve = function (spec, c) {
    spec = String(spec || 'self'); c = c || {};
    var alive = function (e) { return e && e.alive; };
    if (spec === 'self') return alive(c.self) ? [c.self] : [];
    if (spec === 'other') return alive(c.other) ? [c.other] : [];
    if (spec === 'all') return this.entities.filter(alive);
    if (spec.indexOf('tag:') === 0) return (this.byTag[spec.slice(4)] || []).filter(alive);
    var nm = spec.indexOf('name:') === 0 ? spec.slice(5) : spec;
    var byName = this.entities.filter(function (e) { return e.alive && e.name === nm; });
    return byName.length ? byName : (this.byTag[nm] || []).filter(alive);
  };
  SceneRT.prototype.posOf = function (ent) {
    if (!ent || !ent.obj) return { x: 0, y: 0, z: 0 };
    var o = ent.obj;
    if (ent.is3d || o instanceof UG.Node3D) { var p = o.getWorldPosition(new V3()); return { x: p.x, y: p.y, z: p.z }; }
    if (o.parent && o.parent.name !== '__world' && o.parent.name !== '__hud') { var m = o.getWorldMatrix(_m2); return { x: m.tx, y: m.ty, z: 0 }; }
    return { x: o.x, y: o.y, z: 0 };
  };

  /* ---------------------------------------------------------------- acciones de alto nivel */
  SceneRT.prototype.spawnCopy = function (template, x, y, z) {
    var def = this.defsByName[template] || this.defsById[template];
    if (!def) { this.log('warn', 'No existe el objeto "' + template + '" para copiar'); return null; }
    var at = x === undefined ? null : { x: +x || 0, y: +y || 0, z: +z || 0 };
    var parent = def.parent ? this.entities.find(function (e) { return e.alive && e.node.id === def.parent; }) || null : null;
    var ent = this.spawnTree(def, parent, at);
    if (ent) { this.addToColliders(ent); this.compileWatch(); }
    return ent;
  };
  SceneRT.prototype.destroyEntity = function (ent, effect) {
    if (!ent || !ent.alive) return;
    if (effect && effect !== 'none') this.effectAt(effect, this.posOf(ent));
    var self = this;
    // hijos primero
    this.entities.forEach(function (e) { if (e.parent === ent) self.destroyEntity(e, null); });
    ent.alive = false;
    if (ent.script) this.callHook(ent.script, 'onDestroy', []);
    ent.behaviors.forEach(function (b) { if (b.destroy) { try { b.destroy(); } catch (e) { /* ignorar */ } } });
    this._dirtyDead = true;
  };
  SceneRT.prototype.damage = function (ent, n) {
    if (!ent || !ent.alive) return;
    if (ent.hp === null) { this.destroyEntity(ent, ent.deathFx); return; }
    ent.hp -= n;
    if (ent.obj && !ent.is3d && ent.obj.setTint) { var o = ent.obj, t0 = ent.node.props && ent.node.props.tint ? colorNum(ent.node.props.tint) : 0xffffff; o.setTint(0xff6060); this.scene.time.delayedCall(120, function () { if (!o.destroyed) o.setTint(t0); }); }
    if (ent.hp <= 0) this.destroyEntity(ent, ent.deathFx);
  };
  SceneRT.prototype.gotoScene = function (ref) {
    var s = this.ctx.findScene(ref); if (!s) { this.log('warn', 'No existe la escena "' + ref + '"'); return; }
    this._goto = s.id;
  };
  SceneRT.prototype.playSound = function (spec, volume) {
    var snd = this.scene.sound; if (!snd || snd.disabled) return;
    volume = volume === undefined ? 0.6 : clamp(+volume || 0, 0, 1);
    spec = String(spec || '');
    try {
      if (spec.indexOf('sfx:') === 0) { var k = spec.slice(4); if (S.SFX.indexOf(k) >= 0) snd.playSfx(k, { volume: volume }); }
      else if (this.ctx.assetsById[spec]) snd.play(spec, { volume: volume });
    } catch (e) { this.log('warn', 'Sonido: ' + e.message); }
  };
  SceneRT.prototype.playMusic = function (asset, volume) {
    var snd = this.scene.sound; if (!snd || snd.disabled || !this.ctx.assetsById[asset]) return;
    try { snd.playMusic(asset, { volume: volume === undefined ? 0.4 : clamp(+volume || 0, 0, 1) }); } catch (e) { this.log('warn', 'Música: ' + e.message); }
  };
  SceneRT.prototype.effectAt = function (preset, p) {
    if (!p) return;
    if (this.view) { var map = { confetti: 'magic', coin: 'coin' }, k = map[preset] || preset; if (UG.PARTICLE3D_PRESETS[k]) this.view.effect(k, new V3(p.x, p.y, p.z || 0), { count: UG.PARTICLE3D_PRESETS[k].burst || 24 }); return; }
    var key = S.PARTICLES_2D[preset] ? preset : 'explosion', cfg = particleConfig(key, { rate: 1, scale: 1 });
    cfg.frequency = -1; cfg.emitting = false; cfg.quantity = key === 'explosion' ? cfg.quantity : 24;
    var sc = this.scene, e = sc.add.particles(p.x, p.y, dotTexture(sc), cfg); e.depth = 1000;
    e.explode(cfg.quantity);
    var life = cfg.lifespan && cfg.lifespan.max ? cfg.lifespan.max : (+cfg.lifespan || 1000);
    sc.time.delayedCall(life + 200, function () { if (!e.destroyed) e.destroy(); });
  };
  SceneRT.prototype.floatText = function (str, p, color) {
    var sc = this.scene, x = p.x, y = p.y;
    if (this.view) { var s = this.view.worldToScreen(new V3(p.x, p.y + 1.5, p.z || 0)); if (!s.visible) return; x = s.x; y = s.y; }
    var t = (this.view ? sc.add.hud : sc.add).text(x, y, str, { fontFamily: 'system-ui, sans-serif', fontSize: 28, fontWeight: 'bold', fill: colorNum(color), stroke: 0x000000, strokeThickness: 5 });
    t.setOrigin(0.5); t.depth = 1000;
    sc.tweens.add({ targets: t, y: y - 60, alpha: { from: 1, to: 0 }, duration: 900, ease: 'quadOut', onComplete: function () { t.destroy(); } });
  };
  SceneRT.prototype.onClick = function (ent) { this.clicked.push(ent); if (ent.script) this.callHook(ent.script, 'onClick', [this.scene.input.activePointer]); };
  SceneRT.prototype.broadcast = function (name, data) {
    var self = this;
    this.entities.forEach(function (e) { if (e.alive && e.script) self.callHook(e.script, 'onMessage', [name, data]); });
    if (this.sceneScript) this.callHook(this.sceneScript, 'onMessage', [name, data]);
  };

  /* ---------------------------------------------------------------- contactos (por etiquetas) */
  /** Pares a vigilar: eventos de colisión, coleccionables/peligros y scripts con onCollide */
  SceneRT.prototype.compileWatch = function () {
    var w = [], self = this;
    this.def.events.forEach(function (ev) { if (!ev.enabled) return; ev.conditions.forEach(function (c) { if (c.type === 'collision') w.push({ a: c.params.a, b: c.params.b }); }); });
    this.entities.forEach(function (e) {
      if (!e.alive) return;
      e.node.behaviors.forEach(function (b) { if (b.type === 'collectible' || b.type === 'hazard') w.push({ self: e, b: 'tag:' + b.params.by }); });
      if (e.script && e.script.fns && typeof e.script.fns.onCollide === 'function') w.push({ self: e, b: 'all' });
      if (e.node.type === 'button' || (e.script && e.script.fns && typeof e.script.fns.onClick === 'function') || self.clickRefs(e)) self.makeClickable(e);
    });
    this.watch = w;
  };
  SceneRT.prototype.clickRefs = function (e) {
    var self = this;
    return this.def.events.some(function (ev) { return ev.conditions.some(function (c) { return c.type === 'clicked' && self.resolve(c.params.target, {}).indexOf(e) >= 0; }); });
  };
  SceneRT.prototype.makeClickable = function (e) {
    if (e._click || e.is3d || e.node.type === 'button' || !e.obj.setInteractive) { if (e.is3d && !e._click) e._click = 'ray'; return; }
    var self = this; e._click = true;
    e.obj.setInteractive({ cursor: 'pointer' });
    e.obj.on('pointertap', function () { if (e.alive) self.onClick(e); });
  };
  SceneRT.prototype.boxOf = function (e) {
    if (e._boxFrame === this.frame && e._box) return e._box;
    e._boxFrame = this.frame;
    if (!e.is3d) {
      var o = e.obj, b = o.body;
      if (b && b.enable) { e._box = { x0: b.left - 1, y0: b.top - 1, x1: b.right + 1, y1: b.bottom + 1 }; }
      else { var r = o.getBounds(); e._box = { x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height }; }
      return e._box;
    }
    var src = e.ch || e.body || e.car;
    if (src && src.min) { e._box = { x0: src.min.x - 0.05, y0: src.min.y - 0.05, z0: src.min.z - 0.05, x1: src.max.x + 0.05, y1: src.max.y + 0.05, z1: src.max.z + 0.05 }; return e._box; }
    var bb = worldAABB(e.obj, e._bb || (e._bb = new UG.Box3()));
    e._box = { x0: bb.min.x, y0: bb.min.y, z0: bb.min.z, x1: bb.max.x, y1: bb.max.y, z1: bb.max.z };
    return e._box;
  };
  function overlap(a, b, is3d) { return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0 && (!is3d || (a.z0 <= b.z1 && a.z1 >= b.z0)); }
  SceneRT.prototype.detectContacts = function () {
    var now = Object.create(null), fresh = [], self = this, checked = 0;
    for (var i = 0; i < this.watch.length; i++) {
      var w = this.watch[i], A = w.self ? (w.self.alive ? [w.self] : []) : this.resolve(w.a, {}), B = this.resolve(w.b, {});
      for (var a = 0; a < A.length; a++) for (var b = 0; b < B.length; b++) {
        var ea = A[a], eb = B[b]; if (ea === eb || ea.is3d !== eb.is3d || ea.node.hud || eb.node.hud) continue;
        if (++checked > 60000) break;
        if (!overlap(self.boxOf(ea), self.boxOf(eb), ea.is3d)) continue;
        var key = ea.id < eb.id ? ea.id + ':' + eb.id : eb.id + ':' + ea.id;
        if (now[key]) continue;
        now[key] = 1;
        if (!this.contacts[key]) fresh.push([ea, eb]);
      }
    }
    this.contacts = now; this.newContacts = fresh;
    // reacciones integradas
    for (var k = 0; k < fresh.length; k++) {
      var p = fresh[k]; this.react(p[0], p[1]); this.react(p[1], p[0]);
    }
  };
  SceneRT.prototype.react = function (e, other) {
    if (!e.alive || !other.alive) return;
    var self = this;
    e.node.behaviors.forEach(function (b) {
      var pr = b.params;
      if ((b.type === 'collectible' || b.type === 'hazard') && other.tags.indexOf(pr.by) < 0) return;
      if (b.type === 'collectible') {
        self.setVar(pr.variable, (Number(self.getVar(pr.variable, null)) || 0) + pr.amount, null);
        if (pr.sfx) self.playSound('sfx:' + pr.sfx, 0.6);
        self.destroyEntity(e, pr.effect);
      } else if (b.type === 'hazard') {
        if (pr.mode === 'restart') { self.gotoScene(self.def.id); return; }
        if (pr.mode === 'destroy') { self.destroyEntity(other, 'explosion'); return; }
        if (other._invul > self.t) return; // invulnerable un momento tras cada golpe
        other._invul = self.t + 0.8;
        if (other.hp !== null) self.damage(other, pr.amount);
        else { self.setVar(pr.variable, (Number(self.getVar(pr.variable, null)) || 0) - pr.amount, null); self.scene.cameras.main.shake(150, 0.008); self.playSound('sfx:hurt', 0.5); }
        // retroceso: aleja al objetivo del peligro
        var a = self.posOf(e), q = self.posOf(other);
        if (!other.is3d && other.obj && (other.obj.body || other.obj.rbody)) setVel2(other.obj, (q.x < a.x ? -1 : 1) * 260, -340);
        else if (other.is3d && other.ch) { var dx = q.x - a.x, dz = q.z - a.z, l = Math.hypot(dx, dz) || 1; other.ch.velocity.set(dx / l * 6, 5, dz / l * 6); }
        if (!other.is3d && other.obj && other.obj.setAlpha) { var oo = other.obj; self.scene.tweens.add({ targets: oo, alpha: 0.35, duration: 100, yoyo: true, repeat: 3, onComplete: function () { if (!oo.destroyed) oo.alpha = 1; } }); }
      }
    });
    if (e.script) this.callHook(e.script, 'onCollide', [other.obj, other]);
  };

  /* ---------------------------------------------------------------- hojas de eventos */
  function cmp(a, op, b) {
    var na = Number(a), nb = Number(b), numeric = isFinite(na) && isFinite(nb) && a !== '' && b !== '';
    if (numeric) { a = na; b = nb; } else { a = String(a); b = String(b); }
    switch (op) { case '==': return a === b; case '!=': return a !== b; case '>': return a > b; case '>=': return a >= b; case '<': return a < b; case '<=': return a <= b; }
    return false;
  }
  SceneRT.prototype.runEvents = function (dt) {
    var evs = this.def.events, kb = this.scene.input.keyboard;
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i]; if (!ev.enabled) continue;
      var st = ev._st || (ev._st = {}); // estado por escena (se reinicia en shutdown)
      if (ev.once && st.done) continue;
      var ctxs = [{ self: null, other: null }], ok = true;
      for (var c = 0; c < ev.conditions.length && ok; c++) {
        var cd = ev.conditions[c], p = cd.params, r = true, k = 'c' + c;
        switch (cd.type) {
          case 'start': r = this.frame === 1; break;
          case 'every': st[k] = (st[k] || 0) + dt; r = st[k] >= p.seconds; if (r) st[k] = st[k] % p.seconds; break;
          case 'after': r = !st[k] && this.t >= p.seconds; if (r) st[k] = 1; break;
          case 'keyPressed': r = !!(kb && kb.justPressed(p.key)); break;
          case 'keyDown': r = !!(kb && kb.isDown(p.key)); break;
          case 'keyReleased': r = !!(kb && kb.justReleased && kb.justReleased(p.key)); break;
          case 'pointerDown': r = this.pointerDownFrame === this.frame; break;
          case 'random': r = Math.random() < p.chance * dt; break;
          case 'compare': {
            var self0 = this;
            ctxs = ctxs.filter(function (cx) { return cmp(self0.getVar(p.variable, cx.self), p.op, self0.interp(p.value, cx.self)) !== !!cd.not; });
            r = ctxs.length > 0; break;
          }
          case 'noneLeft': { var n = this.resolve(p.target, {}).length, prev = st[k] === undefined ? n : st[k]; st[k] = n; r = n === 0 && prev > 0; break; }
          case 'clicked': {
            var self1 = this, targets = this.resolve(p.target, {});
            var hits = this.clicked.filter(function (e) { return targets.indexOf(e) >= 0; });
            ctxs = combine(ctxs, hits.map(function (e) { return { self: e, other: null }; })); r = ctxs.length > 0; break;
          }
          case 'collision': {
            var A = this.resolve(p.a, {}), B = this.resolve(p.b, {}), pairs = [];
            for (var q = 0; q < this.newContacts.length; q++) {
              var x = this.newContacts[q][0], y = this.newContacts[q][1];
              if (A.indexOf(x) >= 0 && B.indexOf(y) >= 0) pairs.push({ self: x, other: y });
              else if (A.indexOf(y) >= 0 && B.indexOf(x) >= 0) pairs.push({ self: y, other: x });
            }
            ctxs = combine(ctxs, pairs); r = ctxs.length > 0; break;
          }
          case 'web3Connected': { var w3 = this.ctx._w3; r = !!(w3 && w3.connected); break; }
          case 'web3Event': r = this.evNow.some(function (e) { return e.type === 'web3' && e.event === p.event; }); break;
          case 'httpDone': r = this.evNow.some(function (e) { return e.type === 'http' && e.variable === p.variable; }); break;
          case 'bridgeMessage': {
            var bm = null; for (var bi = 0; bi < this.evNow.length; bi++) if (this.evNow[bi].type === 'bridge' && this.evNow[bi].name === p.name) bm = this.evNow[bi];
            r = !!bm; if (bm && p.variable) this.setVar(p.variable, bm.data, null); break;
          }
          case 'isNight': { var dn = this.view && this.view._dayNight; r = !!(dn && !dn.destroyed && dn.isNight); break; }
          default: r = false;
        }
        if (cd.not && cd.type !== 'compare') r = !r;
        ok = r;
      }
      if (!ok || !ctxs.length) continue;
      st.done = true;
      for (var j = 0; j < ctxs.length && j < 200; j++) for (var a = 0; a < ev.actions.length; a++) this.runAction(ev.actions[a], ctxs[j]);
    }
  };
  function combine(ctxs, list) {
    // la primera condición con objetos define el contexto; las siguientes filtran por "self"
    if (ctxs.length === 1 && !ctxs[0].self) return list;
    return ctxs.filter(function (c) { return list.some(function (l) { return l.self === c.self; }); });
  }
  SceneRT.prototype.runAction = function (a, cx) {
    var p = a.params, self = this, targets = function () { return self.resolve(p.target, cx); };
    try {
      switch (a.type) {
        case 'setVar': this.setVar(p.variable, toValue(this.interp(p.value, cx.self)), cx.self); break;
        case 'addVar': this.setVar(p.variable, (Number(this.getVar(p.variable, cx.self)) || 0) + p.value, cx.self); break;
        case 'destroy': targets().forEach(function (e) { self.destroyEntity(e, p.effect); }); break;
        case 'spawn': {
          var at = this.resolve(p.at, cx)[0], pos = at ? this.posOf(at) : { x: 0, y: 0, z: 0 }, rx = (Math.random() * 2 - 1) * p.randomX, ry = (Math.random() * 2 - 1) * p.randomY;
          if (this.is3d) this.spawnCopy(p.template, pos.x + p.dx + rx, pos.y + p.dy, (pos.z || 0) + p.dz + ry); else this.spawnCopy(p.template, pos.x + p.dx + rx, pos.y + p.dy + ry, 0);
          break;
        }
        case 'move': targets().forEach(function (e) { if (e.is3d) { if (e.ch) e.ch.teleport(e.ch.position.x + p.dx, e.ch.position.y + p.dy, e.ch.position.z + p.dz); else if (e.body) { e.body.position.x += p.dx; e.body.position.y += p.dy; e.body.position.z += p.dz; } else { e.obj.position.x += p.dx; e.obj.position.y += p.dy; e.obj.position.z += p.dz; } } else if (e.obj.rbody) e.obj.rbody.setPosition(e.obj.x + p.dx, e.obj.y + p.dy); else { e.obj.x += p.dx; e.obj.y += p.dy; } }); break;
        case 'setPosition': targets().forEach(function (e) { if (e.is3d) { if (e.ch) e.ch.teleport(p.x, p.y, p.z); else if (e.body) { e.body.position.set(p.x, p.y, p.z); e.body.velocity.set(0, 0, 0); } else e.obj.position.set(p.x, p.y, p.z); } else if (e.obj.rbody) { e.obj.rbody.setPosition(p.x, p.y); e.obj.rbody.setVelocity(0, 0); e.obj.rbody.angularVelocity = 0; } else { e.obj.x = p.x; e.obj.y = p.y; if (e.obj.body) e.obj.body.reset(p.x, p.y); } }); break;
        case 'setVelocity': targets().forEach(function (e) { if (e.is3d) { var v = e.body ? e.body.velocity : e.ch ? e.ch.velocity : null; if (v) v.set(p.x, p.y, p.z); } else if (e.obj.rbody) e.obj.rbody.setVelocity(p.x, p.y); else if (e.obj.body) e.obj.body.setVelocity(p.x, p.y); }); break;
        case 'damage': targets().forEach(function (e) { self.damage(e, p.amount); }); break;
        case 'setVisible': targets().forEach(function (e) { e.obj.visible = p.visible; }); break;
        case 'setText': targets().forEach(function (e) { var t = self.interp(p.text, cx.self || e); if (e.obj.setText) e.obj.setText(t); else if (e.obj.label && e.obj.label.setText) e.obj.label.setText(t); self.dyn = self.dyn.filter(function (d) { return d.ent !== e || d.bar; }); }); break;
        case 'playSound': this.playSound(p.sound, p.volume); break;
        case 'playMusic': this.playMusic(p.sound, p.volume); break;
        case 'stopMusic': this.scene.sound.stopMusic(300); break;
        case 'effect': { var ats = this.resolve(p.at, cx); if (ats.length) ats.slice(0, 50).forEach(function (e) { self.effectAt(p.preset, self.posOf(e)); }); else this.effectAt(p.preset, { x: this.W / 2, y: this.H / 2, z: 0 }); break; }
        case 'shake': this.scene.cameras.main.shake(p.duration, p.intensity); break;
        case 'flash': this.scene.cameras.main.flash(p.duration, colorNum(p.color)); break;
        case 'floatText': { var fe = this.resolve(p.at, cx)[0]; this.floatText(this.interp(p.text, cx.self), fe ? this.posOf(fe) : { x: this.W / 2, y: this.H / 2 }, p.color); break; }
        case 'playAnim': targets().forEach(function (e) { if (e.is3d) { if (e.obj.play) e.obj.play(p.clip, { loop: p.loop ? 'repeat' : 'once' }); } else if (e.obj.play && self.scene.anims.exists(p.clip)) e.obj.play(p.clip); }); break;
        case 'tween': targets().forEach(function (e) { self.tweenProp(e, p); }); break;
        case 'saveVar': R.saveData(this.ctx, 'var:' + p.variable, this.getVar(p.variable, cx.self)); break;
        case 'loadVar': this.setVar(p.variable, R.loadData(this.ctx, 'var:' + p.variable, toValue(p.def)), cx.self); break;
        case 'gotoScene': this.gotoScene(p.scene); break;
        case 'restartScene': this.gotoScene(this.def.id); break;
        case 'callFunction': if (this.sceneScript && this.sceneScript.fns && typeof this.sceneScript.fns[p.name] === 'function') this.callHook(this.sceneScript, p.name, [cx.self ? cx.self.obj : null, cx.other ? cx.other.obj : null]); else this.log('warn', 'El script de escena no tiene la función "' + p.name + '"'); break;
        case 'log': this.ctx.log('info', this.interp(p.message, cx.self), this.def.name); break;
        case 'impulse': targets().forEach(function (e) { self.impulse(e, p.x, p.y, p.z); }); break;
        case 'setWeather': this.setWeather(p.weather); break;
        case 'setTimeOfDay': this.setTimeOfDay(p.hour); break;
        case 'addDecal': this.resolve(p.at, cx).slice(0, 20).forEach(function (e) { self.decalUnder(e, p.kind, p.size); }); break;
        case 'web3Connect': this.ctx.web3Connect().catch(noop); break;
        case 'web3Read': {
          var ra = splitArgs(this.interp(p.args, cx.self)).map(toArg), rv = p.variable;
          this.ctx.web3Read(p.contract, p.fn, ra, p.decimals).then(function (v) { self.ctx.setVar(rv, v); self.ctx.pushEvent({ type: 'web3', event: 'read', data: rv }); }, this.ctx.failFn());
          break;
        }
        case 'web3Write': this.ctx.web3Write(p.contract, p.fn, splitArgs(this.interp(p.args, cx.self)).map(toArg), this.interp(p.value, cx.self)).catch(this.ctx.failFn()); break;
        case 'web3Sign': { var sv = p.variable; this.ctx.web3Sign(this.interp(p.message, cx.self)).then(function (sig) { self.ctx.setVar(sv, sig); self.ctx.pushEvent({ type: 'web3', event: 'signed', data: sv }); }, this.ctx.failFn()); break; }
        case 'httpRequest': {
          var hv = p.variable, hb = p.method === 'GET' || p.method === 'DELETE' ? undefined : this.interp(p.body, cx.self, true), hp = this.interp(p.path, cx.self);
          this.ctx.http(p.method, hp, hb).then(function (res) {
            self.ctx.setVar(hv, res.data); self.ctx.setVar(hv + '_estado', res.status);
            if (!res.ok) self.ctx.log('warn', 'El servidor respondió ' + res.status + ' a ' + p.method + ' ' + hp, 'red');
            self.ctx.pushEvent({ type: 'http', variable: hv, ok: res.ok, status: res.status });
          }, function (e) {
            self.ctx.setVar(hv + '_estado', 0); self.ctx.setVar('error_red', String(e.message || e).slice(0, 300));
            self.ctx.log('warn', p.method + ' ' + hp + ': ' + (e.message || e), 'red');
            self.ctx.pushEvent({ type: 'http', variable: hv, ok: false, status: 0 });
          });
          break;
        }
        case 'bridgeSend': { var bd = this.interp(p.data, cx.self); if (/^\s*[\[{]/.test(bd)) { try { bd = JSON.parse(bd); } catch (x) { /* texto */ } } else bd = toValue(bd); this.ctx.bridge.send(p.name, bd); break; }
      }
    } catch (e) { this.log('error', 'Acción "' + (S.ACTIONS[a.type] || {}).label + '": ' + e.message); }
  };
  /** Empuje: cambio de velocidad instantáneo (en rígidos, impulso proporcional a la masa) */
  SceneRT.prototype.impulse = function (e, x, y, z) {
    if (!e || !e.alive) return;
    if (e.is3d) { var v = e.body ? e.body.velocity : e.ch ? e.ch.velocity : null; if (v) { v.x += x; v.y += y; v.z += z; if (e.body && e.body.wake) e.body.wake(); } return; }
    var o = e.obj;
    if (o.rbody) { var b = o.rbody; if (b.invMass > 0) b.applyImpulse(x * b.mass, y * b.mass); }
    else if (o.body) o.body.setVelocity(o.body.velocity.x + x, o.body.velocity.y + y);
  };
  SceneRT.prototype.setWeather = function (kind, o) {
    kind = String(kind || 'clear');
    if (this.view) { this.view.weather(kind === 'none' ? 'clear' : kind, o); return; }
    if (!this.is3d) this.scene.weather2d(kind === 'rain' || kind === 'storm' || kind === 'snow' ? kind : 'clear', o);
  };
  SceneRT.prototype.setTimeOfDay = function (h) {
    if (!this.view) return;
    var dn = this.view._dayNight, sl = this.sunlight;
    if (!dn || dn.destroyed) this.view.dayNight({ time: +h || 0, speed: 0, sun: sl ? sl.sun : null, hemi: sl ? sl.hemi : null });
    else dn.setTime(+h || 0);
  };
  /** Marca (bala, sangre, quemadura…) en el suelo o la pared bajo un objeto 3D */
  SceneRT.prototype.decalUnder = function (e, kind, size) {
    if (!this.view || !e.is3d) return;
    var p = this.posOf(e), pt = new V3(p.x, p.y, p.z), n = new V3(0, 1, 0), hit = null;
    if (this.world3) hit = this.world3.raycast(new V3(p.x, p.y + 0.5, p.z), new V3(0, -1, 0), 50, { bodies: false, ignore: e.body || null });
    if (hit) { pt.copy(hit.point || pt); if (hit.normal) n.copy(hit.normal); }
    else pt.y = Math.max(0, p.y - 0.9);
    this.view.addDecal(kind, pt, n, { size: size, life: 0 });
  };
  SceneRT.prototype.tweenProp = function (e, p) {
    var o = e.obj, cfg = { duration: p.duration, yoyo: p.yoyo, ease: 'sineInOut' };
    if (!e.is3d) { if (p.prop === 'scale') { cfg.targets = o; cfg.scaleX = p.to; cfg.scaleY = p.to; } else { cfg.targets = o; cfg[p.prop] = p.to; } }
    else if (p.prop === 'x' || p.prop === 'y') { cfg.targets = o.position; cfg[p.prop] = p.to; }
    else if (p.prop === 'angle') { cfg.targets = o.rotation; cfg.y = p.to * DEG; }
    else if (p.prop === 'scale') { cfg.targets = o.scale; cfg.x = cfg.y = cfg.z = p.to; }
    else return;
    this.scene.tweens.add(cfg);
  };

  /* ---------------------------------------------------------------- bucle */
  SceneRT.prototype.update = function (time, delta) {
    if (!this.alive) return;
    var dt = Math.min(Math.max(delta, 0), 100) / 1000, i, self = this;
    if (!this._started) this._started = true;
    this.t += dt; this.frame++;
    this.evNow = this.ctx.evq.length ? this.ctx.evq.splice(0, this.ctx.evq.length) : EMPTY;
    var list = this.entities;
    for (i = 0; i < list.length; i++) {
      var e = list[i]; if (!e.alive) continue;
      for (var b = 0; b < e.behaviors.length; b++) { var B = e.behaviors[b]; if (B.update) { try { B.update(dt); } catch (err) { this.log('error', 'Comportamiento: ' + err.message, e.name); e.behaviors.splice(b--, 1); } } }
      if (e.scroll) { e.obj.tilePositionX += e.scroll[0] * dt; e.obj.tilePositionY += e.scroll[1] * dt; }
      if (e.script) this.callHook(e.script, 'onUpdate', [dt]);
    }
    if (this.sceneScript) this.callHook(this.sceneScript, 'onUpdate', [dt]);
    for (i = 0; i < this.papi.length; i++) callHookCtx(this.ctx, this.ctx.plugins[i], 'onUpdate', [dt, this.papi[i]]);
    for (i = 0; i < this.lights2.length; i++) { var le = this.lights2[i]; if (!le.alive || !le.light2d) continue; var lp = this.posOf(le); le.light2d.x = lp.x; le.light2d.y = lp.y; le.light2d.enabled = le.obj.visible !== false; }
    if (this.view) this.pick3DClicks();
    if (this.watch.length) this.detectContacts(); else this.newContacts = [];
    this.runEvents(dt);
    this.clicked.length = 0;
    // textos con {variables} y barras
    for (i = 0; i < this.dyn.length; i++) {
      var d = this.dyn[i]; if (!d.ent.alive) continue;
      if (d.bar) {
        var pr = d.ent.node.props, val = Number(this.getVar(pr.variable, d.ent)) || 0, fr = clamp(val / pr.max, 0, 1);
        if (fr !== d.ent.bar.last) { d.ent.bar.last = fr; d.ent.bar.g.clear().fillStyle(colorNum(pr.back), 0.85).fillRoundedRect(-pr.width / 2 - 2, -pr.height / 2 - 2, pr.width + 4, pr.height + 4, pr.height / 2 + 2).fillStyle(colorNum(pr.color), 1).fillRoundedRect(-pr.width / 2, -pr.height / 2, Math.max(fr > 0 ? pr.height : 0, pr.width * fr), pr.height, pr.height / 2); }
        continue;
      }
      var txt = this.interp(d.tpl, d.ent); if (txt !== d.last) { d.last = txt; if (d.ent.obj.setText) d.ent.obj.setText(txt); }
    }
    if (this._dirtyDead) this.flushDead();
    if (this._goto) { var g = this._goto; this._goto = null; this.alive = false; this.scene.scene.start(g); }
  };
  var EMPTY = [];
  SceneRT.prototype.pick3DClicks = function () {
    if (this.pointerDownFrame !== this.frame) return;
    var clickable = this.entities.filter(function (e) { return e.alive && e._click === 'ray'; });
    if (!clickable.length) return;
    var p = this.scene.input.activePointer, hit = this.view.pick(p.x, p.y);
    if (!hit || !hit.object) return;
    for (var n = hit.object; n; n = n.parent) if (n.ugsEntity && n.ugsEntity._click === 'ray') { this.onClick(n.ugsEntity); break; }
  };
  SceneRT.prototype.flushDead = function () {
    this._dirtyDead = false;
    var keep = [], self = this, W = this.world3;
    this.entities.forEach(function (e) {
      if (e.alive) { keep.push(e); return; }
      if (W) { if (e.body) W.remove(e.body); if (e.ch) W.remove(e.ch); if (e.car) W.remove(e.car); e.statics.forEach(function (c) { W.removeStatic(c); }); }
      if (e.light2d) { self.scene.lights2d.removeLight(e.light2d); e.light2d = null; }
      if (e.occluder) { self.scene.lights2d.removeOccluder(e.occluder); e.occluder = null; }
      if (e.obj && !e.obj.destroyed) { if (e.obj.body && e.obj.body.destroy) { /* el cuerpo 2D se destruye con el objeto */ } e.obj.destroy(); }
      e.obj = null; e.behaviors = []; e.script = null;
    });
    this.entities = keep;
    Object.keys(this.byTag).forEach(function (t) { self.byTag[t] = self.byTag[t].filter(function (e) { return e.alive; }); });
    ['dynamics', 'statics', 'solids'].forEach(function (k) { self[k] = self[k].filter(function (o) { return !o.destroyed; }); });
    this.dyn = this.dyn.filter(function (d) { return d.ent.alive; });
    this.lights2 = this.lights2.filter(function (e) { return e.alive; });
  };
  SceneRT.prototype.shutdown = function () {
    var self = this;
    this.papi.forEach(function (a, i) { if (self.ctx.plugins[i]) callHookCtx(self.ctx, self.ctx.plugins[i], 'onSceneEnd', [a]); });
    this.papi = []; this.lights2 = []; this.evNow = EMPTY; this.rigidWalls = null;
    var ri = this.ctx.rts.indexOf(this); if (ri >= 0) this.ctx.rts.splice(ri, 1);
    this.alive = false;
    this.def.events.forEach(function (ev) { ev._st = null; });
    this.entities.forEach(function (e) { e.behaviors.forEach(function (b) { if (b.destroy) { try { b.destroy(); } catch (x) { /* ignorar */ } } }); e.behaviors = []; e.script = null; e.obj = null; });
    this.entities = []; this.byTag = Object.create(null); this.dyn = []; this.watch = []; this.sceneScript = null; this.view = null; this.world3 = null;
  };

  /* =============================================================== comportamientos */
  var BEHAVIORS = R.behaviors = {};
  function keyAxis(kb, neg, pos) { var v = 0; for (var i = 0; i < neg.length; i++) if (kb.isDown(neg[i])) { v -= 1; break; } for (var j = 0; j < pos.length; j++) if (kb.isDown(pos[j])) { v += 1; break; } return v; }
  function padAxis(sc, i) { var g = sc.input.gamepad; if (!g || !g.axis) return 0; var v = g.axis(i) || 0; return Math.abs(v) < 0.2 ? 0 : v; }
  /** Velocidad de un objeto 2D con cuerpo arcade o rígido (vx/vy null = no cambiar) */
  function setVel2(o, vx, vy) {
    if (o.rbody) { var b = o.rbody; b.setVelocity(vx === null ? b.velocity.x : vx, vy === null ? b.velocity.y : vy); return true; }
    if (o.body) { if (vx !== null && vy !== null) o.body.setVelocity(vx, vy); else if (vx !== null) o.body.setVelocityX(vx); else if (vy !== null) o.body.setVelocityY(vy); return true; }
    return false;
  }
  function place2(o, x, y) { if (o.rbody) o.rbody.setPosition(x, y); else { o.x = x; o.y = y; } }
  /** ¿Pisa algo? (cuerpo rígido: rayos cortos bajo los pies) */
  function rigidGrounded(rt, b) {
    var w = rt.scene.rigid.world, y0 = b.max.y - 2, hw = (b.max.x - b.min.x) * 0.4, cx = (b.min.x + b.max.x) / 2;
    for (var k = -1; k <= 1; k++) { var hit = w.raycast(cx + k * hw, y0, cx + k * hw, y0 + 6, { ignore: b }); if (hit && !(hit.body && hit.body.shapes.every(function (s) { return s.sensor; }))) return true; }
    return false;
  }
  function nearestTagged(rt, ent, tag, range) {
    var list = rt.byTag[tag] || [], p = rt.posOf(ent), best = null, bd = range > 0 ? range : Infinity;
    for (var i = 0; i < list.length; i++) { var e = list[i]; if (!e.alive || e === ent) continue; var q = rt.posOf(e), d = Math.hypot(q.x - p.x, q.y - p.y, (q.z || 0) - (p.z || 0)); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  BEHAVIORS.platformer = function (rt, ent, p) {
    var o = ent.obj, kb = rt.scene.input.keyboard, jumps = 0;
    if (rt.rigid) {
      if (!o.rbody) { rt.log('warn', '"Jugador de plataformas" necesita física dinámica: se le añade', ent.name); rt.setupRigid(ent, Object.assign({}, ent.node.physics, { type: 'dynamic', gravity: true, fixedRotation: true }), o); }
      var rb = o.rbody; if (!rb) return null;
      if (!rb.fixedRotation) { rb.fixedRotation = true; rb.angle = 0; rb.angularVelocity = 0; rb._mass(); } // un personaje no rueda
    } else if (!o.body) { rt.log('warn', '"Jugador de plataformas" necesita física dinámica: se le añade', ent.name); rt.scene.physics.add.existing(o, false); o.body.setCollideWorldBounds(true); o.body.setAllowGravity(true); rt.dynamics.push(o); rt.addToColliders(ent); }
    return { update: function () {
      var b = o.rbody || o.body; if (!b) return;
      var ax = keyAxis(kb, ['LEFT', 'A'], ['RIGHT', 'D']) || Math.sign(padAxis(rt.scene, 0));
      setVel2(o, ax * p.speed, null);
      if (p.flip && ax !== 0 && o.setFlipX) o.setFlipX(ax < 0);
      var floor = o.rbody ? rigidGrounded(rt, b) && b.velocity.y > -60 : (b.blocked.down || b.touching.down);
      if (floor) jumps = 0;
      if (kb.justPressed('SPACE') || kb.justPressed('UP') || kb.justPressed('W') || (rt.scene.input.gamepad && rt.scene.input.gamepad.justDown && rt.scene.input.gamepad.justDown(0))) {
        if (floor || (p.doubleJump && jumps < 2)) { setVel2(o, null, -p.jump); jumps = floor ? 1 : jumps + 1; if (rt.scene.sound && !rt.scene.sound.disabled) rt.scene.sound.playSfx('jump', { volume: 0.35 }); }
      }
    } };
  };
  BEHAVIORS.topdown = function (rt, ent, p) {
    var o = ent.obj, kb = rt.scene.input.keyboard;
    return { update: function (dt) {
      var ax = keyAxis(kb, ['LEFT', 'A'], ['RIGHT', 'D']) || padAxis(rt.scene, 0), ay = keyAxis(kb, ['UP', 'W'], ['DOWN', 'S']) || padAxis(rt.scene, 1), l = Math.hypot(ax, ay);
      if (l > 1) { ax /= l; ay /= l; }
      if (!setVel2(o, ax * p.speed, ay * p.speed)) { o.x += ax * p.speed * dt; o.y += ay * p.speed * dt; }
      if (p.rotate && l > 0.1) { if (o.rbody) o.rbody.angle = Math.atan2(ay, ax); else o.angle = Math.atan2(ay, ax) / DEG; }
    } };
  };
  BEHAVIORS.bullet = function (rt, ent, p) {
    var o = ent.obj, life = p.life;
    return { update: function (dt) {
      var a = o.angle * DEG, vx = Math.cos(a) * p.speed, vy = Math.sin(a) * p.speed;
      if (!setVel2(o, vx, vy)) { o.x += vx * dt; o.y += vy * dt; }
      if (p.life > 0 && (life -= dt) <= 0) rt.destroyEntity(ent, null);
    } };
  };
  BEHAVIORS.move = function (rt, ent, p) {
    var o = ent.obj, life = p.life;
    return { update: function (dt) {
      if (ent.is3d) { var s = Math.abs(p.vx) > 50 || Math.abs(p.vy) > 50 ? 1 / 40 : 1; if (ent.body) { ent.body.velocity.x = p.vx * s; ent.body.velocity.z = p.vy * s; } else { o.position.x += p.vx * s * dt; o.position.z += p.vy * s * dt; } }
      else if (!setVel2(o, p.vx, p.vy)) { o.x += p.vx * dt; o.y += p.vy * dt; }
      if (p.life > 0 && (life -= dt) <= 0) rt.destroyEntity(ent, null);
    } };
  };
  BEHAVIORS.rotate = function (rt, ent, p) {
    return { update: function (dt) { if (ent.is3d) ent.obj.rotation.y += p.speed * DEG * dt; else ent.obj.angle += p.speed * dt; } };
  };
  BEHAVIORS.sine = function (rt, ent, p) {
    var o = ent.obj, t = 0, base;
    var get = function () { if (ent.is3d) return p.prop === 'x' ? o.position.x : p.prop === 'angle' ? o.rotation.y : p.prop === 'scale' ? o.scale.x : o.position.y; return p.prop === 'scale' ? o.scaleX : o[p.prop]; };
    var set = function (v) { if (ent.is3d) { if (p.prop === 'x') o.position.x = v; else if (p.prop === 'angle') o.rotation.y = v; else if (p.prop === 'scale') o.scale.set(v, v, v); else if (p.prop !== 'alpha') o.position.y = v; } else if (p.prop === 'scale') { o.scaleX = v; o.scaleY = v * (o.scaleY / (o.scaleX || 1)); } else o[p.prop] = v; };
    return { start: function () { base = get(); }, update: function (dt) {
      if (base === undefined) base = get(); t += dt;
      var amp = p.amplitude * (ent.is3d ? (p.prop === 'angle' ? DEG : 0.05) : (p.prop === 'angle' ? 1 : p.prop === 'alpha' || p.prop === 'scale' ? 0.02 : 1));
      set(base + Math.sin(t * Math.PI * 2 / p.period) * amp);
    } };
  };
  BEHAVIORS.wrap = function (rt, ent, p) {
    var o = ent.obj;
    return { update: function () { var B = rt.scene.physics.world.bounds, m = p.margin, x = o.x, y = o.y; if (x < B.x - m) x = B.x + B.width + m; else if (x > B.x + B.width + m) x = B.x - m; if (y < B.y - m) y = B.y + B.height + m; else if (y > B.y + B.height + m) y = B.y - m; if (x !== o.x || y !== o.y) place2(o, x, y); } };
  };
  BEHAVIORS.destroyOffscreen = function (rt, ent, p) {
    var o = ent.obj;
    return { update: function () { var B = rt.scene.physics.world.bounds, m = p.margin; if (o.x < B.x - m || o.x > B.x + B.width + m || o.y < B.y - m || o.y > B.y + B.height + m) rt.destroyEntity(ent, null); } };
  };
  BEHAVIORS.draggable = function (rt, ent) {
    if (rt.rigid && ent.obj.rbody) { rt.scene.rigid.drag(true); return null; } // los cuerpos rígidos se arrastran con un muelle
    if (ent.obj.setInteractive) ent.obj.setInteractive({ draggable: true, cursor: 'grab' }); return null;
  };
  BEHAVIORS.followPointer = function (rt, ent, p) {
    var o = ent.obj;
    return { update: function (dt) {
      var q = rt.scene.input.activePointer, tx = ent.node.hud ? q.x : q.worldX, ty = ent.node.hud ? q.y : q.worldY;
      if (!p.speed) { o.x = tx; o.y = ty; return; }
      var dx = tx - o.x, dy = ty - o.y, d = Math.hypot(dx, dy), s = Math.min(d, p.speed * dt); if (d > 0.5) { o.x += dx / d * s; o.y += dy / d * s; }
    } };
  };
  BEHAVIORS.cameraFollow = function (rt, ent, p) {
    var cam = rt.scene.cameras.main;
    var m = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/.exec(p.bounds || '');
    if (m) { var w = Math.min(+m[1], 100000), h = Math.min(+m[2], 100000); cam.setBounds(0, 0, w, h); rt.scene.physics.world.setBounds(0, 0, w, h); }
    cam.setZoom(p.zoom); cam.startFollow(ent.obj, false, p.lerp, p.lerp);
    return { destroy: function () { if (cam._follow === ent.obj) cam.stopFollow && cam.stopFollow(); } };
  };
  BEHAVIORS.chase = function (rt, ent, p) {
    var o = ent.obj;
    return { update: function (dt) {
      var tgt = nearestTagged(rt, ent, p.target, p.range);
      if (!ent.is3d) {
        var grav = o.rbody ? o.rbody.gravityScale !== 0 && rt.def.gravity !== 0 : !!(o.body && o.body.allowGravity);
        if (!tgt) { setVel2(o, 0, grav ? null : 0); return; }
        var q = rt.posOf(tgt), dx = q.x - o.x, dy = q.y - o.y, d = Math.hypot(dx, dy) || 1;
        if (!setVel2(o, dx / d * p.speed, grav ? null : dy / d * p.speed)) { o.x += dx / d * p.speed * dt; o.y += dy / d * p.speed * dt; }
        return;
      }
      var sp = p.speed > 20 ? p.speed / 40 : p.speed; // valores 2D (px/s) en 3D -> m/s razonables
      if (!tgt) { if (ent.ch) ent.ch.move(0, 0); return; }
      var a = rt.posOf(ent), b = rt.posOf(tgt), x = b.x - a.x, z = b.z - a.z, l = Math.hypot(x, z);
      if (l < 0.8) { if (ent.ch) ent.ch.move(0, 0); return; }
      o.rotation.y = Math.atan2(x, z);
      if (ent.ch) ent.ch.move(x / l * sp, z / l * sp); else if (ent.body) { ent.body.velocity.x = x / l * sp; ent.body.velocity.z = z / l * sp; } else { o.position.x += x / l * sp * dt; o.position.z += z / l * sp * dt; }
      if (o.play && !ent._walk) { ent._walk = true; o.play('Walk', { fade: 0.2 }); }
    } };
  };
  BEHAVIORS.patrol = function (rt, ent, p) {
    var o = ent.obj, t = 0, axis = p.axis, origin = null;
    return { update: function (dt) {
      if (!origin) origin = ent.is3d ? o.position.clone() : { x: o.x, y: o.y };
      t += dt; var span = Math.max(1e-3, p.distance), sp = ent.is3d ? (p.speed > 20 ? p.speed / 40 : p.speed) : p.speed;
      var period = 2 * span / Math.max(1e-3, sp), ph = (t % period) / period, off = (ph < 0.5 ? ph * 2 : 2 - ph * 2) * span - span / 2;
      if (ent.is3d) { var dist = ent.is3d && p.distance > 20 ? off / 40 : off; if (axis === 'z') o.position.z = origin.z + dist; else if (axis === 'y') o.position.y = origin.y + dist; else o.position.x = origin.x + dist; }
      else if ((o.body && o.body.moves) || (o.rbody && o.rbody.type !== 'static')) { var v = (ph < 0.5 ? 1 : -1) * sp; if (axis === 'y') setVel2(o, null, v); else setVel2(o, v, null); if (o.setFlipX && axis === 'x') o.setFlipX(v < 0); }
      else { if (axis === 'y') o.y = origin.y + off; else o.x = origin.x + off; }
    } };
  };
  BEHAVIORS.fadeIn = function (rt, ent, p) { var o = ent.obj, a = o.alpha; o.alpha = 0; rt.scene.tweens.add({ targets: o, alpha: a, duration: p.duration }); return null; };
  BEHAVIORS.collectible = function () { return null; }; // se resuelve en los contactos
  BEHAVIORS.hazard = function () { return null; };
  BEHAVIORS.health = function (rt, ent, p) { ent.hp = p.hp; ent.deathFx = p.effect; return null; };
  function needCharacter(rt, ent) {
    if (ent.ch || !rt.world3) return ent.ch;
    var ph = ent.node.physics; ent.ch = rt.world3.addCharacter(ent.obj, { radius: ph.radius || 0.4, height: ph.height || 1.8 });
    return ent.ch;
  }
  BEHAVIORS.fpsPlayer = function (rt, ent, p) {
    var ch = needCharacter(rt, ent); if (!ch) return null;
    ch.jumpSpeed = p.jump; ent.obj.visible = false; // en primera persona no se ve el propio cuerpo
    var c = rt.view.firstPersonControls({ character: ch, speed: p.speed, runSpeed: p.runSpeed, eyeHeight: p.eyeHeight });
    rt.controls = c;
    return { destroy: function () { c.destroy(); } };
  };
  BEHAVIORS.tpsPlayer = function (rt, ent, p) {
    var ch = needCharacter(rt, ent); if (!ch) return null;
    ch.jumpSpeed = p.jump;
    var o = ent.obj, c = rt.view.thirdPersonControls({ target: o, character: ch, distance: p.distance, speed: p.speed, runSpeed: p.runSpeed });
    rt.controls = c;
    var names = o.animations ? o.animations.map(function (a) { return a.name; }) : [], cur = null;
    var pick = function () { var want = !ch.onGround && names.indexOf('Jump') >= 0 ? 'Jump' : c.moving ? (c.running && names.indexOf('Run') >= 0 ? 'Run' : 'Walk') : 'Idle'; if (names.indexOf(want) < 0) return; if (want !== cur) { cur = want; o.play(want, { fade: 0.15 }); } };
    return { update: function () { if (o.play && names.length) pick(); }, destroy: function () { c.destroy(); } };
  };
  BEHAVIORS.vehicle = function (rt, ent, p) {
    if (!rt.world3) return null;
    var o = ent.obj, wheels = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'].map(function (n) { return o.getObjectByName ? o.getObjectByName(n) : null; });
    var car = ent.car = rt.world3.addVehicle(o, { maxSpeed: 32 * p.power, accel: 18 * p.power, wheels: wheels.every(Boolean) ? wheels : undefined, rideHeight: wheels.every(Boolean) ? 0 : 0.35 });
    var kb = rt.scene.input.keyboard, cam = p.camera ? rt.view.followCamera({ target: o }) : null;
    if (cam) rt.controls = cam;
    return { update: function () {
      var th = keyAxis(kb, ['S', 'DOWN'], ['W', 'UP']) || -padAxis(rt.scene, 1), st = keyAxis(kb, ['D', 'RIGHT'], ['A', 'LEFT']) || -padAxis(rt.scene, 0);
      car.setInput(th, st, kb.isDown('S') && car.speed > 1, kb.isDown('SPACE'));
    }, destroy: function () { if (cam) cam.destroy(); } };
  };
  BEHAVIORS.orbitCamera = function (rt, ent, p) {
    var target = rt.posOf(ent), c = rt.view.orbitControls({ target: target, distance: p.distance, autoRotate: p.autoRotate });
    rt.controls = c;
    return { update: function () { var q = rt.posOf(ent); c.target.set(q.x, q.y, q.z); }, destroy: function () { c.destroy(); } };
  };
  BEHAVIORS.followCamera = function (rt, ent, p) { var c = rt.view.followCamera({ target: ent.obj, distance: p.distance, height: p.height }); rt.controls = c; return { destroy: function () { c.destroy(); } }; };
  BEHAVIORS.lookAt = function (rt, ent, p) {
    return { update: function () { var t = nearestTagged(rt, ent, p.target, 0); if (!t) return; var a = rt.posOf(ent), b = rt.posOf(t); ent.obj.rotation.y = Math.atan2(b.x - a.x, b.z - a.z); } };
  };

  /* =============================================================== modo edición (vistas del Studio) */
  /**
   * Construye una escena para editar: mismos objetos que en juego, sin comportamientos, scripts, eventos ni física.
   * Devuelve { rt, byNode: {idNodo: entidad} }. La escena UG la crea el editor.
   */
  R.buildForEditor = function (scene, project, sceneDef, opts) {
    var ctx = new GameCtx(project, opts || {});
    ctx.game = scene.game;
    var def = JSON.parse(JSON.stringify(sceneDef));
    def.nodes.forEach(function (n) { n.behaviors = []; n.script = null; n.prefab = false; });
    def.events = []; def.script = '';
    var rt = new SceneRT(ctx, scene, def, {});
    rt.editMode = true; rt.hudAsWorld = !!(opts && opts.hudAsWorld);
    rt.build();
    var byNode = Object.create(null);
    rt.entities.forEach(function (e) { byNode[e.node.id] = e; });
    return { rt: rt, byNode: byNode };
  };
  R.SceneRT = SceneRT;
})(typeof window !== 'undefined' ? window : globalThis);
