/* UltraGame - Game: configuración, arranque asíncrono con cadena de respaldo de renderers
 * (WebGPU -> WebGL2 -> WebGL1 -> Canvas2D), bucle con paso fijo opcional (determinista), pausa,
 * captura de pantalla y destrucción completa de todos los recursos. */

var DEFAULT_GAME_CONFIG = {
  width: 800, height: 600, parent: null, canvas: null, backgroundColor: 0x000000, transparent: false,
  renderer: 'auto', antialias: true, pixelArt: false, roundPixels: false, resolution: 'auto', maxResolution: 2,
  powerPreference: 'high-performance', preserveDrawingBuffer: false, maxTextures: 0,
  scale: { mode: 'fit', autoCenter: true }, fps: { target: 0, fixedStep: 0, maxDelta: 100, forceSetTimeout: false },
  physics: null, audio: {}, input: {}, scenes: [], seed: undefined, banner: true, stats: false, loaderUI: true,
  security: {}, title: '', cull: true, pauseOnHidden: true, autoStart: true
};

function createRenderer(pref, canvas, options) {
  var order;
  if (Array.isArray(pref)) order = pref;
  else if (!pref || pref === 'auto') order = UG.defaultRendererOrder.slice();
  else order = [pref].concat(UG.defaultRendererOrder.filter(function (x) { return x !== pref; }));
  var errors = [];
  var tryNext = function (i, cv) {
    if (i >= order.length) return Promise.reject(new Error('UltraGame: ningún renderer disponible (' + errors.join('; ') + ')'));
    var kind = order[i], r;
    var opts = Object.assign({}, options);
    try {
      if (kind === 'webgpu') { if (!Capabilities.webgpu()) throw new Error('sin navigator.gpu'); r = new WebGPURenderer(opts); }
      else if (kind === 'webgl2') { opts.forceWebGL1 = false; r = new WebGLRenderer(opts); }
      else if (kind === 'webgl' || kind === 'webgl1') { opts.forceWebGL1 = true; r = new WebGLRenderer(opts); }
      else if (kind === 'canvas') r = new CanvasRenderer(opts);
      else throw new Error('renderer desconocido ' + kind);
    } catch (e) { errors.push(kind + ': ' + e.message); return tryNext(i + 1, cv); }
    return r.init(cv).then(function (ok) {
      if (kind === 'webgl2' && !r.isWebGL2) { /* devolvió WebGL1 */ }
      return ok;
    }, function (e) {
      errors.push(kind + ': ' + (e && e.message));
      try { r.destroy(); } catch (e2) { /* ignorar */ }
      // Si el canvas quedó "atado" a otro tipo de contexto, se sustituye por uno nuevo
      var fresh = cv.cloneNode ? cv.cloneNode(false) : createCanvas(cv.width, cv.height);
      if (cv.parentNode) cv.parentNode.replaceChild(fresh, cv);
      return tryNext(i + 1, fresh);
    });
  };
  return tryNext(0, canvas);
}

class GameLoop {
  constructor(game, config) {
    config = config || {};
    this.game = game;
    this.targetFps = config.target || 0;
    this.fixedStep = config.fixedStep > 0 ? config.fixedStep : 0;
    this.maxDelta = config.maxDelta || 100;
    this.forceSetTimeout = !!config.forceSetTimeout;
    this.maxSteps = config.maxSteps || 8;
    this.running = false; this.paused = false;
    this.lastTime = 0; this.time = 0; this.frame = 0;
    this.delta = 1000 / 60; this.fps = 60; this.actualFps = 60;
    this.timeScale = 1;
    this._acc = 0; this._limAcc = 0; this._id = 0; this._errors = 0;
    var self = this;
    this._tick = function (ts) { self.tick(ts); };
  }
  start() {
    if (this.running) return;
    this.running = true; this.paused = false;
    this.lastTime = nowTime();
    this._schedule();
  }
  _schedule() {
    if (!this.running) return;
    if (this.forceSetTimeout || typeof requestAnimationFrame === 'undefined') { var self = this; this._id = setTimeout(function () { self.tick(nowTime()); }, 1000 / (this.targetFps || 60)); this._timeout = true; }
    else { this._id = requestAnimationFrame(this._tick); this._timeout = false; }
  }
  tick(ts) {
    if (!this.running) return;
    this._schedule();
    if (this.paused || (this.game.config && this.game.config.pauseOnHidden && typeof document !== 'undefined' && document.hidden)) {
      this.lastTime = nowTime();
      this._acc = 0; this._limAcc = 0;
      return;
    }
    var now = nowTime(), dt = now - this.lastTime;
    this.lastTime = now;
    if (!(dt >= 0)) dt = 0;
    if (dt > this.maxDelta) dt = this.maxDelta;
    if (this.targetFps > 0 && !this._timeout) {
      this._limAcc += dt;
      var frameMs = 1000 / this.targetFps;
      if (this._limAcc < frameMs - 1) return;
      dt = Math.min(this._limAcc, this.maxDelta); this._limAcc = this._limAcc % frameMs;
    }
    this.actualFps = this.actualFps * 0.92 + (dt > 0 ? 1000 / dt : 60) * 0.08;
    this.fps = Math.round(this.actualFps);
    this.delta = dt;
    this._run(dt * this.timeScale);
  }
  _run(dt) {
    var g = this.game;
    try {
      if (this.fixedStep) {
        var stepMs = this.fixedStep * 1000, n = 0;
        this._acc += dt;
        while (this._acc >= stepMs && n < this.maxSteps) { this.time += stepMs; this.frame++; g.update(this.time, stepMs); this._acc -= stepMs; n++; }
        if (n >= this.maxSteps) this._acc = 0;
      } else { this.time += dt; this.frame++; g.update(this.time, dt); }
      g.render();
      this._errors = 0;
    } catch (e) {
      g._reportError(e);
      if (++this._errors > 30) { Log.error('Demasiados errores seguidos: bucle pausado. Revisa la consola.'); this.paused = true; }
    }
  }
  /** Avanza el juego manualmente (tests, replays deterministas, render fuera de pantalla). */
  step(deltaMs) { this._run(deltaMs === undefined ? (this.fixedStep ? this.fixedStep * 1000 : 1000 / 60) : deltaMs); }
  pause() { this.paused = true; }
  resume() { this.paused = false; this.lastTime = nowTime(); this._acc = 0; this._limAcc = 0; }
  stop() {
    this.running = false;
    if (this._id) { if (this._timeout) clearTimeout(this._id); else if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this._id); }
    this._id = 0;
  }
  setFixedStep(seconds) { this.fixedStep = seconds > 0 ? seconds : 0; this._acc = 0; }
}

class Game extends EventEmitter {
  constructor(config) {
    super();
    config = config || {};
    var c = Security.safeMerge(JSON.parse(JSON.stringify(Object.assign({}, DEFAULT_GAME_CONFIG, { scenes: [] }))), Object.assign({}, config, { scenes: undefined, scene: undefined, parent: undefined, canvas: undefined }));
    c.parent = config.parent || null; c.canvas = config.canvas || null;
    var scenes = config.scenes || config.scene || [];
    this.config = c;
    this.width = Math.max(1, c.width | 0); this.height = Math.max(1, c.height | 0);
    var sec = c.security || {};
    if (sec.allowedOrigins !== undefined) Security.allowedOrigins = sec.allowedOrigins;
    if (sec.maxFileSize) Security.maxFileSize = sec.maxFileSize;
    if (sec.maxTextureSize) Security.maxTextureSize = sec.maxTextureSize;
    if (sec.maxMapTiles) Security.maxMapTiles = sec.maxMapTiles;
    if (c.pixelArt) { TextureSource.defaultScaleMode = 'nearest'; c.antialias = false; c.roundPixels = true; }
    this.textures = new TextureManager(this);
    this.cache = new CacheManager();
    this.anims = new AnimationManager(this);
    this.sound = new SoundManager(this, c.audio);
    this.input = new InputManager(this, c.input);
    this.scale = new ScaleManager(this, c.scale);
    this.scene = new SceneManager(this, scenes);
    this.loop = new GameLoop(this, c.fps);
    this.registry = new DataManager();
    this.rng = new RNG(c.seed);
    this.renderer = null;
    this.canvas = null;
    this.isBooted = false; this.destroyed = false; this.frame = 0; this.time = 0;
    this._inStep = false;
    this.dom = new DOMListeners();
    if (!UG._defaultTextures) UG._defaultTextures = this.textures;
    if (!UG._defaultGame) UG._defaultGame = this;
    Game.instances.push(this);
    Debug.track('Game', 1);
    this.ready = this._boot();
  }
  _resolveParent() {
    var p = this.config.parent;
    if (typeof p === 'string') p = document.getElementById(p) || document.querySelector(p);
    if (!p && HAS_DOM) p = document.body;
    return p;
  }
  _boot() {
    var self = this, c = this.config;
    if (!HAS_DOM) return Promise.reject(new Error('UltraGame necesita un documento (navegador)'));
    var parent = this._resolveParent();
    var canvas = c.canvas || createCanvas(this.width, this.height);
    if (!canvas.parentNode && parent) parent.appendChild(canvas);
    if (c.title) canvas.setAttribute('aria-label', String(c.title));
    canvas.setAttribute('role', 'img');
    this.canvas = canvas;
    var options = {
      width: this.width, height: this.height, resolution: 1, backgroundColor: c.backgroundColor, transparent: c.transparent,
      antialias: c.antialias, powerPreference: c.powerPreference, preserveDrawingBuffer: c.preserveDrawingBuffer, pixelArt: c.pixelArt,
      maxTextures: c.maxTextures || undefined, cull: c.cull, instancing: c.instancing
    };
    return createRenderer(c.renderer, canvas, options).then(function (r) {
      if (self.destroyed) { r.destroy(); return self; }
      self.renderer = r; self.canvas = r.canvas;
      if (c.backgroundColor !== undefined) r.setBackgroundColor(c.backgroundColor, c.transparent ? 0 : 1);
      self.input.boot(r.canvas);
      self.sound.boot();
      self.scale.boot(r.canvas.parentNode || parent, r.canvas);
      if (c.pauseOnHidden) self.dom.add(document, 'visibilitychange', function () { if (document.hidden) self.emit('hidden'); else { self.loop.lastTime = nowTime(); self.emit('visible'); } }, false);
      r.on('contextlost', function () { self.emit('contextlost'); });
      r.on('contextrestored', function () { self.emit('contextrestored'); });
      self.isBooted = true;
      if (c.banner !== false) Log.info('UltraGame ' + UG.VERSION + ' | ' + r.type.toUpperCase() + ' | ' + self.width + 'x' + self.height + ' @' + r.resolution.toFixed(2) + 'x');
      if (c.stats) self.showStats(true);
      self.scene.boot();
      self.emit('ready', self);
      if (c.autoStart !== false) self.loop.start();
      return self;
    }, function (e) {
      Log.error(e.message);
      self.emit('error', e);
      throw e;
    });
  }
  _setSize(w, h) {
    this.width = Math.max(1, w | 0); this.height = Math.max(1, h | 0);
    var sc = this.scene ? this.scene.scenes : [];
    for (var i = 0; i < sc.length; i++) if (sc[i].cameras) sc[i].cameras.resize(this.width, this.height);
    this.emit('resize', this.width, this.height);
  }
  get rendererType() { return this.renderer ? this.renderer.type : 'none'; }
  get fps() { return this.loop.fps; }
  update(time, delta) {
    if (this.destroyed) return;
    this._inStep = true;
    try {
      this.time = time; this.frame++;
      this.input.preUpdate();
      this.emit('prestep', time, delta);
      this.scene.update(time, delta);
      this.anims.update(delta);
      this.emit('step', time, delta);
      this.emit('poststep', time, delta);
    } finally { this._inStep = false; }
  }
  render() {
    var r = this.renderer;
    if (!r || r.contextLost || this.destroyed) return;
    r.time = this.time;
    this.emit('prerender', r);
    if (r.beginFrame()) {
      this.scene.render(r);
      r.endFrame();
    }
    this.emit('postrender', r);
  }
  isVisibleOnPage() { return !(typeof document !== 'undefined' && document.hidden) && !!(this.canvas && this.canvas.isConnected !== false); }
  pause() { this.loop.pause(); this.sound.pauseAll(); this.emit('pause'); return this; }
  resume() { this.loop.resume(); this.sound.resumeAll(); this.emit('resume'); return this; }
  get isPaused() { return this.loop.paused; }
  /** Captura la pantalla tras el siguiente render: Promise<dataURL> */
  snapshot(type, quality) {
    var self = this;
    return new Promise(function (resolve, reject) {
      self.once('postrender', function () { try { resolve(self.canvas.toDataURL(type || 'image/png', quality)); } catch (e) { reject(e); } });
      if (self.loop.paused || !self.loop.running) self.render();
    });
  }
  showStats(v) {
    if (v === false) { if (this._stats) { this._stats.destroy(); this._stats = null; } return this; }
    if (!this._stats) this._stats = new StatsPanel(this);
    return this;
  }
  _reportError(e, scene) {
    Log.error('Error' + (scene ? ' en la escena "' + scene.key + '"' : '') + ':', e && e.stack ? e.stack : e);
    this.emit('error', e, scene);
  }
  /** Destruye el juego y libera TODO (GPU, audio, listeners, texturas, escenas). */
  destroy(removeCanvas) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('destroy', this);
    this.loop.stop();
    if (this._stats) { this._stats.destroy(); this._stats = null; }
    this.scene.destroy();
    this.anims.destroy();
    this.input.destroy();
    this.sound.destroy();
    this.scale.destroy();
    this.textures.destroy();
    this.cache.destroy();
    this.registry.destroy();
    this.dom.removeAll();
    if (this.renderer) { this.renderer.destroy(); this.renderer = null; }
    if (removeCanvas !== false && this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.canvas = null;
    removeFromArray(Game.instances, this);
    if (UG._defaultGame === this) { UG._defaultGame = Game.instances[0] || null; UG._defaultTextures = UG._defaultGame ? UG._defaultGame.textures : null; }
    this.off();
    Debug.track('Game', -1);
  }
}
Game.instances = [];

UG.Game = Game;
UG.GameLoop = GameLoop;
UG.createRenderer = createRenderer;
UG.DEFAULT_GAME_CONFIG = DEFAULT_GAME_CONFIG;
