/* UltraGame - escenas: ciclo de vida (init, preload, create, update), gestor (start, launch, pause, sleep,
 * switch, transiciones), fábricas this.add / this.make, y limpieza total al cerrar (sin fugas). */

/** Propiedades que el motor pone en cada escena: el juego no debe reasignarlas */
var RESERVED_SCENE_KEYS = ["add", "make", "load", "world", "hud", "children", "cameras", "input", "tweens", "time", "data", "scene", "sys", "game", "sound", "textures", "cache", "registry", "renderer", "rng", "scale", "anims", "events"];
class Scene {
  constructor(config) {
    this._config = typeof config === 'string' ? { key: config } : (config || {});
    this.key = this._config.key || '';
    this.sys = null;
  }
  init() {}
  preload() {}
  create() {}
  update() {}
}

/* ============================================================ RenderTextureObject */
class RenderTextureObject extends Sprite {
  constructor(scene, x, y, width, height, resolution) {
    super(x, y, new RenderTexture(width || 256, height || 256, resolution || (scene.game.renderer ? scene.game.renderer.resolution : 1)));
    this.type = 'RenderTexture';
    this.scene = scene;
    this.rt = this._texture;
    this._tmpSprite = null;
    this._drawMatrix = new Matrix();
  }
  get renderer() { return this.scene.game.renderer; }
  _asObject(obj, frame) {
    if (typeof obj === 'string' || obj instanceof Texture) {
      if (!this._tmpSprite) this._tmpSprite = new Sprite(0, 0, Texture.EMPTY);
      this._tmpSprite.scene = this.scene;
      this._tmpSprite.setTexture(obj, frame);
      this._tmpSprite.setOrigin(0.5);
      return this._tmpSprite;
    }
    return obj;
  }
  /** Dibuja un objeto (o clave de textura) en la textura en x,y. */
  draw(obj, x, y, alpha, tint) {
    if (Array.isArray(obj)) { for (var i = 0; i < obj.length; i++) this.draw(obj[i], x, y, alpha, tint); return this; }
    var o = this._asObject(obj);
    var sa = o.alpha, st = o.tint, sx = o.x, sy = o.y;
    if (alpha !== undefined) o.alpha = alpha;
    if (tint !== undefined) o.tint = tint;
    if (x !== undefined) { o.x = x; o.y = y; }
    this.renderer.render(o, { target: this.rt, clear: false, transform: this._drawMatrix.identity() });
    o.alpha = sa; o.tint = st; o.x = sx; o.y = sy;
    return this;
  }
  stamp(key, frame, x, y, config) {
    var s = this._asObject(key, frame);
    config = config || {};
    s.x = x; s.y = y; s.alpha = config.alpha !== undefined ? config.alpha : 1; s.tint = config.tint !== undefined ? config.tint : 0xffffff;
    s.rotation = config.rotation || 0; s.scaleX = config.scaleX || config.scale || 1; s.scaleY = config.scaleY || config.scale || 1; s.blendMode = config.blendMode || 'normal';
    s.setOrigin(config.originX !== undefined ? config.originX : 0.5, config.originY !== undefined ? config.originY : 0.5);
    this.renderer.render(s, { target: this.rt, clear: false, transform: this._drawMatrix.identity() });
    s.blendMode = 'inherit';
    return this;
  }
  /** Borra (pinta con modo ERASE) la forma del objeto. */
  erase(obj, x, y) {
    var o = this._asObject(obj), sb = o._blend;
    o._blend = BLEND.ERASE;
    this.draw(o, x, y);
    o._blend = sb;
    return this;
  }
  fill(color, alpha, x, y, w, h) {
    var g = this._fillG || (this._fillG = new Graphics());
    var res = this.rt.source.resolution;
    g.clear().fillStyle(color, alpha === undefined ? 1 : alpha).fillRect(x || 0, y || 0, w === undefined ? this.rt.source.width / res : w, h === undefined ? this.rt.source.height / res : h);
    this.renderer.render(g, { target: this.rt, clear: false, transform: this._drawMatrix.identity() });
    return this;
  }
  clear() { var g = this._fillG || (this._fillG = new Graphics()); g.clear(); this.renderer.render(g, { target: this.rt, clear: true }); return this; }
  resize(w, h) { this.rt.resize(w, h); return this; }
  snapshot() { return this.renderer.extract.base64(this.rt); }
  _onDestroy() {
    super._onDestroy();
    if (this.rt) this.rt.destroy();
    if (this._tmpSprite) this._tmpSprite.destroy();
    if (this._fillG) this._fillG.destroy();
    this.rt = null;
  }
}

/* ============================================================ GameObjectFactory */
class GameObjectFactory {
  constructor(scene, target, isHud) {
    this.scene = scene; this.target = target;
    this.hud = isHud ? null : new GameObjectFactory(scene, null, true);
    this._isHud = !!isHud;
  }
  get _parent() { return this._isHud ? this.scene.hud : (this.target || this.scene.world); }
  _add(obj) { obj._setScene(this.scene); this._parent.addChild(obj); if (obj.preUpdate) this.scene.sys.updateList.push(obj); return obj; }
  existing(obj) { if (obj instanceof Group) { this.scene.sys.updateList.push(obj); return obj; } return this._add(obj); }
  container(x, y, children) { return this._add(new Container(x, y, children)); }
  sprite(x, y, key, frame) { var s = this._add(new Sprite(x, y)); s.setTexture(key === undefined ? '__WHITE' : key, frame); return s; }
  image(x, y, key, frame) { return this.sprite(x, y, key, frame); }
  animatedSprite(x, y, textures, options) { var s = new AnimatedSprite(textures, options); s.x = x; s.y = y; return this._add(s); }
  text(x, y, text, style) { return this._add(new Text(x, y, text, style)); }
  bitmapText(x, y, font, text, size, align) { return this._add(new BitmapText(x, y, font, text, size, align)); }
  graphics(config) { return this._add(new Graphics(config)); }
  rectangle(x, y, w, h, fillColor, fillAlpha) { return this._add(new ShapeObject('rectangle', x, y, { width: w || 128, height: h || 128 }, fillColor, fillAlpha)); }
  roundRectangle(x, y, w, h, radius, fillColor, fillAlpha) { return this._add(new ShapeObject('roundrect', x, y, { width: w || 128, height: h || 64, radius: radius || 12 }, fillColor, fillAlpha)); }
  circle(x, y, r, fillColor, fillAlpha) { r = r || 64; return this._add(new ShapeObject('circle', x, y, { radius: r, width: r * 2, height: r * 2 }, fillColor, fillAlpha)); }
  ellipse(x, y, w, h, fillColor, fillAlpha) { return this._add(new ShapeObject('ellipse', x, y, { width: w || 128, height: h || 64 }, fillColor, fillAlpha)); }
  triangle(x, y, x1, y1, x2, y2, x3, y3, fillColor, fillAlpha) {
    x1 = x1 || 0; y1 = y1 === undefined ? 128 : y1; x2 = x2 === undefined ? 64 : x2; y2 = y2 || 0; x3 = x3 === undefined ? 128 : x3; y3 = y3 === undefined ? 128 : y3;
    var minX = Math.min(x1, x2, x3), minY = Math.min(y1, y2, y3), w = Math.max(x1, x2, x3) - minX, h = Math.max(y1, y2, y3) - minY;
    return this._add(new ShapeObject('triangle', x, y, { x1: x1 - minX, y1: y1 - minY, x2: x2 - minX, y2: y2 - minY, x3: x3 - minX, y3: y3 - minY, width: w, height: h }, fillColor, fillAlpha));
  }
  star(x, y, points, innerRadius, outerRadius, fillColor, fillAlpha) {
    outerRadius = outerRadius || 64; innerRadius = innerRadius || outerRadius / 2;
    return this._add(new ShapeObject('star', x, y, { points: points || 5, innerRadius: innerRadius, outerRadius: outerRadius, width: outerRadius * 2, height: outerRadius * 2 }, fillColor, fillAlpha));
  }
  polygon(x, y, points, fillColor, fillAlpha) {
    var pts = flattenPoints(points), minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < pts.length; i += 2) { minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]); minY = Math.min(minY, pts[i + 1]); maxY = Math.max(maxY, pts[i + 1]); }
    var norm = pts.map(function (v, k) { return v - (k % 2 ? minY : minX); });
    return this._add(new ShapeObject('polygon', x, y, { points: norm, width: maxX - minX, height: maxY - minY }, fillColor, fillAlpha));
  }
  line(x, y, x1, y1, x2, y2, strokeColor, strokeAlpha) {
    var minX = Math.min(x1, x2), minY = Math.min(y1, y2);
    var s = new ShapeObject('line', x, y, { x1: x1 - minX, y1: y1 - minY, x2: x2 - minX, y2: y2 - minY, width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }, strokeColor === undefined ? 0xffffff : strokeColor, strokeAlpha);
    return this._add(s);
  }
  tileSprite(x, y, w, h, key, frame) { var s = this._add(new TilingSprite(x, y, w, h)); s.setTexture(key, frame); return s; }
  tilingSprite(x, y, w, h, key, frame) { return this.tileSprite(x, y, w, h, key, frame); }
  nineSlice(x, y, key, frame, w, h, l, r, t, b) {
    var ns = new NineSlice(x, y, undefined, undefined, w, h, l, r, t, b);
    ns.scene = this.scene; ns.setTexture(key, frame);
    var tw = ns._texture.width, th = ns._texture.height;
    ns._w = w || tw; ns._h = h || th;
    if (l === undefined) { ns.leftWidth = ns.rightWidth = Math.floor(tw / 3); ns.topHeight = ns.bottomHeight = Math.floor(th / 3); }
    return this._add(ns);
  }
  /** particles(key, config) | particles(x, y, key, config) | particles(key, frame, config) */
  particles(a, b, c, d) {
    var x = 0, y = 0, key, frame, config;
    if (typeof a === 'number') { x = a; y = b; key = c; config = d || {}; }
    else if (d !== undefined || (typeof b === 'string' || typeof b === 'number') && c !== undefined) { key = a; frame = b; config = c || {}; }
    else { key = a; config = b || {}; }
    var tm = this.scene.textures, tex;
    if (Array.isArray(config.frame) || Array.isArray(config.frames)) tex = (config.frame || config.frames).map(function (f) { return tm.get(key, f); });
    else if (key instanceof Texture) tex = key;
    else tex = tm.get(key === undefined ? '__WHITE' : key, config.frame !== undefined ? config.frame : frame);
    var cfg = Object.assign({}, config); if (!cfg.rng) cfg.rng = this.scene.rng;
    var e = new ParticleEmitter(tex, cfg);
    e.x = x; e.y = y;
    return this._add(e);
  }
  /** Contenedor de partículas ligeras para cantidades masivas (UG.Particle) */
  particleContainer(options) { return this._add(new ParticleContainer(options)); }
  mesh(x, y, key, frame, vertices, uvs, indices) { var m = new Mesh(this.scene.textures.get(key, frame), vertices, uvs, indices); m.x = x; m.y = y; return this._add(m); }
  rope(x, y, key, frame, points, options) { var r = new Rope(this.scene.textures.get(key, frame), points, options); r.x = x; r.y = y; return this._add(r); }
  zone(x, y, w, h) { return this._add(new Zone(x, y, w, h)); }
  renderTexture(x, y, w, h, resolution) { var rt = new RenderTextureObject(this.scene, x, y, w, h, resolution); return this._add(rt); }
  button(x, y, options) { if (typeof options === 'string') options = { text: options }; return this._add(new Button(this.scene, x, y, options)); }
  panel(x, y, w, h, options) { return this._add(new Panel(x, y, w, h, options)); }
  progressBar(x, y, w, h, options) { return this._add(new ProgressBar(x, y, w, h, options)); }
  joystick(config) { var j = new VirtualJoystick(this.scene, config); j._setScene(this.scene); this.scene.hud.addChild(j); return j; }
  virtualButton(config) { var b = new VirtualButton(this.scene, config); b._setScene(this.scene); this.scene.hud.addChild(b); return b; }
  group(config) { var g = new Group(this.scene, Object.assign({ container: this._parent }, config || {})); this.scene.sys.updateList.push(g); return g; }
  tilemap(key) { var m = new Tilemap(this.scene, key); this.scene.sys._tilemaps.push(m); return m; }
  tween(config) { return this.scene.tweens.add(config); }
  timeline(config) { return this.scene.tweens.chain(config); }
}

/** this.make.* crea sin añadir (config: {x, y, key, frame, add: true, ...propiedades}) */
class GameObjectCreator {
  constructor(scene) { this.scene = scene; }
  _apply(obj, c) {
    if (!c) return obj;
    var keys = Object.keys(c), skip = { key: 1, frame: 1, add: 1, text: 1, style: 1, children: 1, config: 1 };
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i]; if (skip[k] || isForbiddenKey(k)) continue;
      var v = c[k];
      if (k === 'scale' && typeof v === 'number') { obj.scaleX = obj.scaleY = v; continue; }
      if (k === 'origin' || k === 'anchor') { if (obj.setOrigin) obj.setOrigin(typeof v === 'number' ? v : v.x, typeof v === 'number' ? v : v.y); continue; }
      if (k === 'interactive' && v) { obj.setInteractive(typeof v === 'object' ? v : {}); continue; }
      if (k in obj) obj[k] = v;
    }
    if (c.children) for (var j = 0; j < c.children.length; j++) obj.addChild(this.fromJSON(c.children[j], false));
    obj._setScene(this.scene);
    if (c.add) { this.scene.world.addChild(obj); if (obj.preUpdate) this.scene.sys.updateList.push(obj); }
    return obj;
  }
  sprite(c) { return this._apply(new Sprite(0, 0, c.key === undefined ? '__WHITE' : this.scene.textures.get(c.key, c.frame)), c); }
  image(c) { return this.sprite(c); }
  text(c) { return this._apply(new Text(0, 0, c.text || '', c.style), c); }
  graphics(c) { return this._apply(new Graphics(c), c); }
  container(c) { return this._apply(new Container(), c); }
  bitmapText(c) { return this._apply(new BitmapText(0, 0, c.font, c.text, c.size, c.align), c); }
  tileSprite(c) { return this._apply(new TilingSprite(0, 0, c.width || 100, c.height || 100, this.scene.textures.get(c.key, c.frame)), c); }
  particles(c) { return this._apply(new ParticleEmitter(this.scene.textures.get(c.key || '__WHITE', c.frame), c.config || {}), c); }
  /** Construye un árbol de objetos desde una descripción JSON: {type:'sprite', key, x, y, children:[...]} */
  fromJSON(def, add) {
    if (!def || typeof def !== 'object') throw new Error('fromJSON: definición inválida');
    var t = String(def.type || 'container').toLowerCase();
    var map = { sprite: 'sprite', image: 'sprite', text: 'text', graphics: 'graphics', container: 'container', bitmaptext: 'bitmapText', tilesprite: 'tileSprite', particles: 'particles' };
    var m = map[t]; if (!m) throw new Error('fromJSON: tipo no soportado ' + t);
    var c = Object.assign({}, def); delete c.type; if (add !== undefined) c.add = add;
    return this[m](c);
  }
}

/* ================================================================== Systems */
class Systems {
  constructor(scene, game, manager, config) {
    this.scene = scene; this.game = game; this.manager = manager; this.config = config || {};
    this.status = 'pending';
    this.visible = true;
    this.events = new EventEmitter();
    this.updateList = [];
    this.anims = [];
    this._tilemaps = [];
    this.data = null;
    this._createData = undefined;
    this.time = 0;
  }
  install() {
    var scene = this.scene, game = this.game, self = this;
    scene.sys = this;
    scene.game = game;
    scene.events = this.events;
    scene.world = new Container(); scene.world.name = '__world'; scene.world.sortableChildren = true; scene.world._setScene(scene);
    scene.children = scene.world;
    scene.hud = new Container(); scene.hud.name = '__hud'; scene.hud.sortableChildren = true; scene.hud._setScene(scene);
    scene.add = new GameObjectFactory(scene, null, false);
    scene.make = new GameObjectCreator(scene);
    scene.load = new Loader(scene);
    if (this.config.loader) { if (this.config.loader.path) scene.load.setPath(this.config.loader.path); if (this.config.loader.baseURL) scene.load.setBaseURL(this.config.loader.baseURL); if (this.config.loader.showProgress === false) scene.load.showProgress = false; }
    scene.cameras = new CameraManager(scene);
    scene.input = new InputPlugin(scene);
    scene.tweens = new TweenManager(scene);
    scene.time = new Clock(scene);
    scene.sound = game.sound;
    scene.textures = game.textures;
    scene.cache = game.cache;
    scene.anims = game.anims;
    scene.registry = game.registry;
    scene.data = new DataManager(this.events);
    scene.rng = new RNG(this.config.seed !== undefined ? this.config.seed : (game.config.seed !== undefined ? String(game.config.seed) + ':' + scene.key : undefined));
    scene.scale = game.scale;
    scene.renderer = game.renderer;
    scene.scene = new ScenePlugin(scene);
    var physCfg = this.config.physics || game.config.physics;
    this._physics = null;
    Object.defineProperty(scene, 'physics', {
      configurable: true, enumerable: false,
      get: function () { if (!self._physics) self._physics = new ArcadePhysics(scene, (physCfg && (physCfg.arcade || physCfg)) || {}); return self._physics; }
    });
    // física de cuerpos rígidos (physics: { rigid: {...} }): se crea al usarla por primera vez
    this._rigid = null;
    // luces 2D con sombras (this.lights2d.enable(), addLight, addOccluder...): se crean al usarlas
    this._lights2d = null; this._weather2d = null;
    Object.defineProperty(scene, 'lights2d', {
      configurable: true, enumerable: false,
      get: function () { if (!self._lights2d) self._lights2d = new Lights2D(scene); return self._lights2d; }
    });
    Object.defineProperty(scene, 'rigid', {
      configurable: true, enumerable: false,
      get: function () { if (!self._rigid) self._rigid = new RigidPhysics2D(scene, (physCfg && physCfg.rigid) || {}); return self._rigid; }
    });
  }
  step(time, delta) {
    var scene = this.scene;
    this.time += delta;
    this.events.emit('preupdate', time, delta);
    scene.time.update(time, delta);
    scene.tweens.update(time, delta);
    if (this._physics) this._physics.update(time, delta);
    if (this._rigid) this._rigid.update(time, delta);
    var ul = this.updateList, j = 0, n = ul.length, i;
    for (i = 0; i < n; i++) {
      var o = ul[i];
      if (o.destroyed) continue;
      if (o.active !== false && o.preUpdate) o.preUpdate(time, delta);
      ul[j++] = o;
    }
    for (i = n; i < ul.length; i++) ul[j++] = ul[i];
    ul.length = j;
    updateAnimList(this.anims, delta);
    this.events.emit('update', time, delta);
    scene.update(time, delta);
    this.events.emit('postupdate', time, delta);
    scene.cameras.update(time, delta);
  }
  shutdown(destroying) {
    var scene = this.scene;
    this.events.emit('shutdown', scene);
    if (scene.load) scene.load.abort();
    if (scene.tweens) scene.tweens.shutdown();
    if (scene.time) scene.time.shutdown();
    if (this._physics) { this._physics.destroy(); this._physics = null; }
    if (this._rigid) { this._rigid.destroy(); this._rigid = null; }
    if (this._weather2d) { this._weather2d.destroy(); this._weather2d = null; }
    if (this._lights2d) { this._lights2d.destroy(); this._lights2d = null; }
    for (var t = 0; t < this._tilemaps.length; t++) this._tilemaps[t].destroy();
    this._tilemaps.length = 0;
    if (scene.input) scene.input.shutdown();
    this.updateList.forEach(function (o) { if (o instanceof Group) o.destroy(false); });
    this.updateList.length = 0;
    this.anims.length = 0;
    if (scene.world) scene.world.destroy();
    if (scene.hud) scene.hud.destroy();
    if (scene.cameras) scene.cameras.destroy();
    if (scene.data) scene.data.destroy();
    this.events.off();
    this.status = destroying ? 'destroyed' : 'shutdown';
  }
}

/* ============================================================== ScenePlugin */
class ScenePlugin {
  constructor(scene) { this.scene = scene; this.key = scene.key; }
  get manager() { return this.scene.game.scene; }
  get settings() { return this.scene.sys.config; }
  start(key, data) { this.manager.start(key || this.key, data, key && key !== this.key ? this.key : null); return this; }
  restart(data) { this.manager.start(this.key, data); return this; }
  launch(key, data) { this.manager.launch(key, data); return this; }
  run(key, data) { this.manager.run(key, data); return this; }
  stop(key) { this.manager.stop(key || this.key); return this; }
  pause(key) { this.manager.pause(key || this.key); return this; }
  resume(key) { this.manager.resume(key || this.key); return this; }
  sleep(key) { this.manager.sleep(key || this.key); return this; }
  wake(key, data) { this.manager.wake(key || this.key, data); return this; }
  switch(key, data) { this.manager.switch(this.key, key, data); return this; }
  bringToTop(key) { this.manager.bringToTop(key || this.key); return this; }
  sendToBack(key) { this.manager.sendToBack(key || this.key); return this; }
  get(key) { return this.manager.getScene(key); }
  isActive(key) { return this.manager.isActive(key || this.key); }
  isPaused(key) { return this.manager.isPaused(key || this.key); }
  isSleeping(key) { return this.manager.isSleeping(key || this.key); }
  /** Transición con fundido: this.scene.transition({target:'Juego', duration: 600, data}) */
  transition(config) {
    config = config || {};
    var self = this, dur = config.duration || 600, cam = this.scene.cameras.main;
    if (!cam || this._transitioning) return false;
    this._transitioning = true;
    cam.fadeOut(dur / 2, config.color || 0, true, function () {
      self._transitioning = false;
      self.manager.start(config.target, config.data, self.key);
      var target = self.manager.getScene(config.target);
      if (target) target.events.once('create', function () { if (target.cameras.main) target.cameras.main.fadeIn(dur / 2, config.color || 0); });
    });
    return true;
  }
}

/* ============================================================== SceneManager */
class SceneManager {
  constructor(game, sceneDefs) {
    this.game = game;
    this.scenes = [];
    this.keys = new Map();
    this._queue = [];
    this._defs = sceneDefs ? (Array.isArray(sceneDefs) ? sceneDefs : [sceneDefs]) : [];
    this.booted = false;
    this._processing = false;
  }
  boot() {
    var self = this;
    this._defs.forEach(function (d, i) { self.add(null, d, i === 0 || (d && d.active === true)); });
    this._defs = null;
    this.booted = true;
    this._processQueue();
  }
  _instantiate(def, key) {
    var scene;
    if (typeof def === 'function') scene = new def();
    else if (def instanceof Scene) scene = def;
    else if (def && typeof def === 'object') {
      scene = new Scene(def);
      // todos los métodos definidos en el objeto pasan a la escena (update, create y métodos propios)
      Object.keys(def).forEach(function (k) { if (typeof def[k] === 'function' && !isForbiddenKey(k)) scene[k] = def[k]; });
      if (def.extend) Object.keys(def.extend).forEach(function (k) { if (!isForbiddenKey(k)) scene[k] = def.extend[k]; });
    } else throw new Error('UltraGame: definición de escena inválida');
    if (key) scene.key = key;
    if (!scene.key) scene.key = (scene._config && scene._config.key) || (def && def.name) || ('scene' + (this.scenes.length + 1));
    return scene;
  }
  add(key, def, autoStart, data) {
    var scene = this._instantiate(def, key);
    if (this.keys.has(scene.key)) { Log.warn('La escena "' + scene.key + '" ya existe'); return this.keys.get(scene.key); }
    var sys = new Systems(scene, this.game, this, Object.assign({}, scene._config || {}, (def && typeof def === 'object' && !(def instanceof Scene) && typeof def !== 'function') ? def : {}));
    scene.sys = sys;
    this.scenes.push(scene);
    this.keys.set(scene.key, scene);
    if (autoStart) this._queueOp('start', scene.key, data);
    return scene;
  }
  remove(key) { var s = this.getScene(key); if (!s) return this; this._queueOp('remove', key); return this; }
  getScene(key) { if (key instanceof Scene) return key; return this.keys.get(key) || null; }
  getScenes(active) { return this.scenes.filter(function (s) { return !active || s.sys.status === 'running'; }); }
  isActive(key) { var s = this.getScene(key); return !!s && s.sys.status === 'running'; }
  isPaused(key) { var s = this.getScene(key); return !!s && s.sys.status === 'paused'; }
  isSleeping(key) { var s = this.getScene(key); return !!s && s.sys.status === 'sleeping'; }
  isVisible(key) { var s = this.getScene(key); return !!s && s.sys.visible; }
  getInputScenes() {
    var out = [];
    for (var i = this.scenes.length - 1; i >= 0; i--) { var s = this.scenes[i]; if (s.sys.status === 'running' && s.sys.visible && s.input) out.push(s); }
    return out;
  }
  /** Las operaciones se aplican al inicio del siguiente frame (nunca a mitad de un update o de un evento). */
  _queueOp(op, key, data, extra) { this._queue.push({ op: op, key: key, data: data, extra: extra }); }
  start(key, data, stopKey) { if (stopKey) this._queueOp('stop', stopKey); this._queueOp('start', key, data); return this; }
  launch(key, data) { this._queueOp('start', key, data); return this; }
  run(key, data) {
    var s = this.getScene(key); if (!s) return this;
    var st = s.sys.status;
    if (st === 'paused') this.resume(key); else if (st === 'sleeping') this.wake(key, data); else if (st !== 'running' && st !== 'loading' && st !== 'creating') this.start(key, data);
    return this;
  }
  stop(key) { this._queueOp('stop', key); return this; }
  pause(key) { var s = this.getScene(key); if (s && s.sys.status === 'running') { s.sys.status = 'paused'; s.events.emit('pause', s); } return this; }
  resume(key) { var s = this.getScene(key); if (s && s.sys.status === 'paused') { s.sys.status = 'running'; s.events.emit('resume', s); } return this; }
  sleep(key) { var s = this.getScene(key); if (s && (s.sys.status === 'running' || s.sys.status === 'paused')) { s.sys.status = 'sleeping'; s.sys.visible = false; s.events.emit('sleep', s); } return this; }
  wake(key, data) { var s = this.getScene(key); if (s && s.sys.status === 'sleeping') { s.sys.status = 'running'; s.sys.visible = true; s.events.emit('wake', s, data); } return this; }
  switch(from, to, data) { this.sleep(from); var t = this.getScene(to); if (t && t.sys.status === 'sleeping') this.wake(to, data); else this.start(to, data); return this; }
  bringToTop(key) { var s = this.getScene(key); if (s) { removeFromArray(this.scenes, s); this.scenes.push(s); } return this; }
  sendToBack(key) { var s = this.getScene(key); if (s) { removeFromArray(this.scenes, s); this.scenes.unshift(s); } return this; }
  moveUp(key) { var s = this.getScene(key), i = this.scenes.indexOf(s); if (i >= 0 && i < this.scenes.length - 1) { this.scenes[i] = this.scenes[i + 1]; this.scenes[i + 1] = s; } return this; }
  moveDown(key) { var s = this.getScene(key), i = this.scenes.indexOf(s); if (i > 0) { this.scenes[i] = this.scenes[i - 1]; this.scenes[i - 1] = s; } return this; }
  setVisible(key, v) { var s = this.getScene(key); if (s) s.sys.visible = v !== false; return this; }
  _processQueue() {
    if (this._processing) return;
    this._processing = true;
    try {
      var guard = 0;
      while (this._queue.length && guard++ < 100) {
        var q = this._queue.shift(), s = this.getScene(q.key);
        if (!s) { Log.warn('Escena "' + q.key + '" no existe'); continue; }
        if (q.op === 'start') this._startScene(s, q.data);
        else if (q.op === 'stop') this._stopScene(s);
        else if (q.op === 'remove') { this._stopScene(s, true); removeFromArray(this.scenes, s); this.keys.delete(s.key); }
      }
    } finally { this._processing = false; }
  }
  _startScene(scene, data) {
    var sys = scene.sys, self = this;
    if (sys.status !== 'pending' && sys.status !== 'shutdown') this._stopScene(scene);
    sys.install();
    sys.status = 'init';
    sys.visible = true;
    sys._createData = data;
    sys.time = 0;
    this.game.emit('scenestart', scene);
    sys._reserved = {};
    RESERVED_SCENE_KEYS.forEach(function (k) { sys._reserved[k] = scene[k]; });
    try { scene.init(data); } catch (e) { Log.error('Error en ' + scene.key + '.init():', e); }
    this._checkReserved(scene, 'init');
    sys.status = 'loading';
    try { scene.preload(); } catch (e2) { Log.error('Error en ' + scene.key + '.preload():', e2); }
    var ld = scene.load;
    if (ld.queue.length) {
      var bar = null, txt = null;
      if (ld.showProgress && this.game.config.loaderUI !== false) {
        var g = this.game;
        bar = new ProgressBar(g.width / 2, g.height / 2, Math.min(420, g.width * 0.6), 18);
        txt = new Text(g.width / 2, g.height / 2 - 34, 'Cargando 0%', { fontFamily: 'system-ui, Segoe UI, Arial', fontSize: 18, fill: 0xdfe6ff });
        txt.setOrigin(0.5);
        scene.hud.addChild(bar); scene.hud.addChild(txt);
        ld.on('progress', function (p) { if (!bar.destroyed) { bar.value = p; txt.text = 'Cargando ' + Math.round(p * 100) + '%'; } });
      }
      ld.start().then(function () {
        if (bar) { bar.destroy(); txt.destroy(); }
        // abort() también resuelve la promesa: una carga anterior no puede crear
        // una escena que ya se ha reiniciado y está esperando otro Loader.
        if (scene.load === ld && !ld._aborted && sys.status === 'loading') self._createScene(scene);
      });
    } else this._createScene(scene);
  }
  _createScene(scene) {
    var sys = scene.sys;
    sys.status = 'creating';
    try { scene.create(sys._createData); } catch (e) { Log.error('Error en ' + scene.key + '.create():', e); }
    this._checkReserved(scene, 'create');
    if (sys.status === 'creating') sys.status = 'running';
    scene.events.emit('create', scene);
    this.game.emit('scenecreate', scene);
  }
  /** Detecta (y deshace) que el código del juego pise propiedades del motor como this.world o this.hud */
  _checkReserved(scene, where) {
    var r = scene.sys && scene.sys._reserved; if (!r) return;
    RESERVED_SCENE_KEYS.forEach(function (k) {
      if (scene[k] !== r[k]) {
        Log.error('La escena "' + scene.key + '" asignó this.' + k + ' en ' + where + '(): "' + k + '" es una propiedad reservada de la escena (' + RESERVED_SCENE_KEYS.join(', ') + '). Usa otro nombre (p. ej. this.mi' + k.charAt(0).toUpperCase() + k.slice(1) + '). Se restaura el valor del motor.');
        scene[k] = r[k];
      }
    });
  }
  _stopScene(scene, destroying) {
    var sys = scene.sys;
    if (sys.status === 'pending' || sys.status === 'shutdown' || sys.status === 'destroyed') { if (destroying) sys.status = 'destroyed'; return; }
    sys.shutdown(destroying);
    this.game.emit('scenestop', scene);
    // limpiar referencias de la escena
    ['world', 'hud', 'children', 'add', 'make', 'load', 'cameras', 'input', 'tweens', 'time', 'data', 'scene'].forEach(function (k) { scene[k] = null; });
  }
  update(time, delta) {
    this._processQueue();
    for (var i = 0; i < this.scenes.length; i++) {
      var s = this.scenes[i];
      if (s.sys.status !== 'running') continue;
      try { s.sys.step(time, delta); }
      catch (e) { this.game._reportError(e, s); }
    }
    this._processQueue();
  }
  render(renderer) {
    for (var i = 0; i < this.scenes.length; i++) {
      var s = this.scenes[i], st = s.sys.status;
      if (!s.sys.visible || !(st === 'running' || st === 'paused' || st === 'loading' || st === 'creating')) continue;
      if (!s.world) continue;
      renderer.renderScene(s);
    }
  }
  destroy() {
    for (var i = this.scenes.length - 1; i >= 0; i--) this._stopScene(this.scenes[i], true);
    this.scenes.length = 0; this.keys.clear(); this._queue.length = 0;
    this.game = null;
  }
}

UG.Scene = Scene;
UG.SceneManager = SceneManager;
UG.Systems = Systems;
UG.ScenePlugin = ScenePlugin;
UG.GameObjectFactory = GameObjectFactory;
UG.GameObjectCreator = GameObjectCreator;
UG.RenderTextureObject = RenderTextureObject;
