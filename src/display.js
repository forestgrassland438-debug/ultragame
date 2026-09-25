/* UltraGame - grafo de escena: Container, Sprite, TilingSprite, NineSlice, Mesh, Rope, Zone, Group. */

var BLEND = { INHERIT: -1, NORMAL: 0, ADD: 1, MULTIPLY: 2, SCREEN: 3, ERASE: 4, NONE: 5, LIGHTEN: 6, DARKEN: 7 };
var BLEND_NAMES = { inherit: -1, normal: 0, add: 1, additive: 1, lighter: 1, multiply: 2, screen: 3, erase: 4, none: 5, copy: 5, lighten: 6, darken: 7 };
var BLEND_LABELS = ['normal', 'add', 'multiply', 'screen', 'erase', 'none', 'lighten', 'darken'];
function resolveBlend(v) {
  if (typeof v === 'number') return v;
  if (v === undefined || v === null) return -1;
  var n = BLEND_NAMES[String(v).toLowerCase()];
  if (n === undefined) { Log.warnOnce('blend:' + v, 'Modo de mezcla desconocido: ' + v); return 0; }
  return n;
}

/** Estado global del recorrido de render (scroll de la cámara activa para scrollFactor). */
var RenderState = { camScrollX: 0, camScrollY: 0 };

/** "Padre" identidad para objetos sin padre. */
var IDENTITY_PARENT = { worldTransform: new Matrix(), worldAlpha: 1, worldTint: 0xffffff, worldBlend: 0 };

var _addOrderCounter = 0;
var QV = new Float32Array(8);   // vértices temporales de quad
var QUV = new Float32Array(8);  // uvs temporales
var _tmpVec = new Vec2();

/** Acumulador de límites AABB */
class Bounds {
  constructor() { this.reset(); }
  reset() { this.minX = Infinity; this.minY = Infinity; this.maxX = -Infinity; this.maxY = -Infinity; return this; }
  get isEmpty() { return this.minX > this.maxX || this.minY > this.maxY; }
  addPoint(x, y) { if (x < this.minX) this.minX = x; if (x > this.maxX) this.maxX = x; if (y < this.minY) this.minY = y; if (y > this.maxY) this.maxY = y; }
  addQuad(v) { for (var i = 0; i < 8; i += 2) this.addPoint(v[i], v[i + 1]); }
  addRect(x0, y0, x1, y1, m) {
    if (!m) { this.addPoint(x0, y0); this.addPoint(x1, y1); return; }
    var a = m.a, b = m.b, c = m.c, d = m.d, tx = m.tx, ty = m.ty;
    this.addPoint(a * x0 + c * y0 + tx, b * x0 + d * y0 + ty);
    this.addPoint(a * x1 + c * y0 + tx, b * x1 + d * y0 + ty);
    this.addPoint(a * x1 + c * y1 + tx, b * x1 + d * y1 + ty);
    this.addPoint(a * x0 + c * y1 + tx, b * x0 + d * y1 + ty);
  }
  addBounds(o) { if (!o.isEmpty) { this.addPoint(o.minX, o.minY); this.addPoint(o.maxX, o.maxY); } }
  toRect(out) { out = out || new Rectangle(); if (this.isEmpty) return out.set(0, 0, 0, 0); return out.set(this.minX, this.minY, this.maxX - this.minX, this.maxY - this.minY); }
}
var _tmpBounds = new Bounds();
var _chain = [];

/* =================================================================== Container */
class Container extends EventEmitter {
  constructor(x, y, children) {
    super();
    // --- campos "calientes" primero: se leen cada frame (mejor localidad de caché) ---
    this.x = x || 0; this.y = y || 0;
    this.scaleX = 1; this.scaleY = 1;
    this.rotation = 0;
    this.alpha = 1;
    this.visible = true;
    this.renderable = true;
    this.worldTransform = new Matrix();
    this.worldAlpha = 1; this.worldTint = 0xffffff; this.worldBlend = 0;
    this._tint = 0xffffff;
    this._blend = BLEND.INHERIT;
    this._rc = 0; this._skx = 0; this._sky = 0; this._ca = 1; this._sa = 0; this._cc = 0; this._cd = 1;
    this.skewX = 0; this.skewY = 0;
    this.pivotX = 0; this.pivotY = 0;
    this.scrollFactorX = 1; this.scrollFactorY = 1;
    this.children = [];
    this.parent = null;
    this._filters = null;
    this._mask = null;
    this.clipRect = null;
    this.cacheAsTexture = false;
    /** Multiplicador de resolución de la caché (p.ej. el zoom de la cámara para que no se vea borrosa) */
    this.cacheResolution = 1;
    this._isMask = false;
    this.cameraFilter = 0;
    this.sortableChildren = false;
    this._sortDirty = false;
    this._zIndex = 0;
    this._addOrder = 0;
    // campos de sprite reservados aquí (localidad de caché en el camino rápido)
    this._texture = null;
    this.anchorX = 0; this.anchorY = 0;
    this.flipX = false; this.flipY = false;
    this.roundPixels = false;
    this.cullable = true;
    this._pcTint = -1; this._pcAlpha = -1; this._pc = 0;
    // --- resto ---
    this.uid = uid();
    this.type = 'Container';
    this.name = '';
    this.interactive = false;
    this.hitArea = null;
    this.cursor = null;
    this.draggable = false;
    this._input = null;
    this.active = true;
    this.destroyed = false;
    this.scene = null;
    this.body = null;
    this._data = null;
    this._scaleProxy = null; this._posProxy = null; this._pivotProxy = null; this._skewProxy = null;
    this._cache = null;
    Debug.track('DisplayObject', 1);
    if (children) this.add(children);
  }

  /* ---------- propiedades cómodas ---------- */
  get tint() { return this._tint; }
  set tint(v) { this._tint = Color.toNumber(v); }
  get blendMode() { return this._blend < 0 ? 'inherit' : BLEND_LABELS[this._blend]; }
  set blendMode(v) { this._blend = resolveBlend(v); }
  get zIndex() { return this._zIndex; }
  set zIndex(v) { if (v !== this._zIndex) { this._zIndex = v; if (this.parent) this.parent._sortDirty = true; } }
  get depth() { return this._zIndex; }
  set depth(v) { this.zIndex = v; }
  get angle() { return this.rotation * RAD_TO_DEG; }
  set angle(v) { this.rotation = v * DEG_TO_RAD; }
  get scale() { return this._scaleProxy || (this._scaleProxy = new PointProxy(this, 'scaleX', 'scaleY')); }
  set scale(v) { if (typeof v === 'number') { this.scaleX = v; this.scaleY = v; } else { this.scaleX = v.x; this.scaleY = v.y; } }
  get position() { return this._posProxy || (this._posProxy = new PointProxy(this, 'x', 'y')); }
  set position(v) { this.x = v.x; this.y = v.y; }
  get pivot() { return this._pivotProxy || (this._pivotProxy = new PointProxy(this, 'pivotX', 'pivotY')); }
  set pivot(v) { if (typeof v === 'number') { this.pivotX = v; this.pivotY = v; } else { this.pivotX = v.x; this.pivotY = v.y; } }
  get skew() { return this._skewProxy || (this._skewProxy = new PointProxy(this, 'skewX', 'skewY')); }
  get filters() { return this._filters; }
  set filters(v) { this._filters = (v && v.length) ? (Array.isArray(v) ? v.slice() : [v]) : null; }
  get mask() { return this._mask; }
  set mask(m) {
    if (this._mask && this._mask._isMask !== undefined) this._mask._isMask = false;
    if (m instanceof Rectangle) { this.clipRect = m; this._mask = null; return; }
    this._mask = m || null;
    if (m) m._isMask = true;
  }
  get data() { return this._data || (this._data = new DataManager(this)); }
  get width() { var b = this.getLocalBounds(); return b.width * Math.abs(this.scaleX); }
  set width(v) { var w = this.getLocalBounds().width; this.scaleX = w ? v / w : 1; }
  get height() { var b = this.getLocalBounds(); return b.height * Math.abs(this.scaleY); }
  set height(v) { var h = this.getLocalBounds().height; this.scaleY = h ? v / h : 1; }
  get first() { return this.children[0]; }
  get last() { return this.children[this.children.length - 1]; }
  get length() { return this.children.length; }

  /* ---------- setters encadenables (estilo Phaser) ---------- */
  setPosition(x, y) { this.x = x || 0; this.y = y === undefined ? this.x : y; return this; }
  setX(x) { this.x = x; return this; }
  setY(y) { this.y = y; return this; }
  setScale(x, y) { this.scaleX = x; this.scaleY = y === undefined ? x : y; return this; }
  setRotation(r) { this.rotation = r || 0; return this; }
  setAngle(deg) { this.rotation = (deg || 0) * DEG_TO_RAD; return this; }
  setAlpha(a) { this.alpha = a; return this; }
  setVisible(v) { this.visible = !!v; return this; }
  setTint(c) { this.tint = c === undefined ? 0xffffff : c; return this; }
  clearTint() { this._tint = 0xffffff; return this; }
  setBlendMode(m) { this.blendMode = m; return this; }
  setDepth(d) { this.zIndex = d; return this; }
  setZIndex(d) { this.zIndex = d; return this; }
  setPivot(x, y) { this.pivotX = x; this.pivotY = y === undefined ? x : y; return this; }
  setSkew(x, y) { this.skewX = x; this.skewY = y === undefined ? x : y; return this; }
  setScrollFactor(x, y) { this.scrollFactorX = x; this.scrollFactorY = y === undefined ? x : y; return this; }
  setName(n) { this.name = String(n); return this; }
  setActive(a) { this.active = !!a; return this; }
  setData(key, value) { this.data.set(key, value); return this; }
  getData(key) { return this._data ? this._data.get(key) : undefined; }
  setMask(m) { this.mask = m; return this; }
  clearMask() { this.mask = null; this.clipRect = null; return this; }
  setClip(x, y, w, h) { this.clipRect = x instanceof Rectangle ? x : new Rectangle(x, y, w, h); return this; }
  setFilters(list) { this.filters = list; return this; }
  addFilter(f) { var l = this._filters ? this._filters.slice() : []; l.push(f); this._filters = l; return this; }
  removeFilter(f) { if (this._filters) { var l = this._filters.filter(function (x) { return x !== f; }); this._filters = l.length ? l : null; } return this; }
  setSortableChildren(v) { this.sortableChildren = v !== false; this._sortDirty = true; return this; }
  setCacheAsTexture(v) { this.cacheAsTexture = v !== false; if (this._cache) this._cache.dirty = true; return this; }
  updateCacheTexture() { if (this._cache) this._cache.dirty = true; return this; }

  /** Hace el objeto interactivo: {hitArea, cursor:'pointer', draggable, autoDrag, pixelPerfect} */
  setInteractive(options) {
    options = options || {};
    this.interactive = true;
    if (options.hitArea) this.hitArea = options.hitArea;
    if (options.cursor !== undefined) this.cursor = options.cursor;
    else if (options.useHandCursor) this.cursor = 'pointer';
    if (options.draggable !== undefined) this.draggable = !!options.draggable;
    this._input = { autoDrag: options.autoDrag !== false, dragStartX: 0, dragStartY: 0, over: false, down: false, dropZone: !!options.dropZone };
    return this;
  }
  disableInteractive() { this.interactive = false; return this; }
  removeInteractive() { this.interactive = false; this.hitArea = null; this._input = null; return this; }

  /* ---------- hijos ---------- */
  add(child) {
    if (Array.isArray(child)) { for (var i = 0; i < child.length; i++) this.addChild(child[i]); return this; }
    for (var j = 0; j < arguments.length; j++) this.addChild(arguments[j]);
    return this;
  }
  addChild(child) {
    if (arguments.length > 1) { for (var i = 0; i < arguments.length; i++) this.addChild(arguments[i]); return arguments[0]; }
    return this.addChildAt(child, this.children.length);
  }
  addChildAt(child, index) {
    if (!child || !(child instanceof Container)) throw new TypeError('UltraGame: addChild requiere un objeto de escena');
    if (child === this) throw new Error('UltraGame: un objeto no puede ser hijo de sí mismo');
    for (var p = this.parent; p; p = p.parent) if (p === child) throw new Error('UltraGame: ciclo en el grafo de escena');
    if (child.destroyed) { Log.warn('addChild: el objeto ya fue destruido'); return child; }
    if (child.parent) child.parent.removeChild(child);
    index = clamp(index | 0, 0, this.children.length);
    this.children.splice(index, 0, child);
    child.parent = this;
    child._addOrder = ++_addOrderCounter;
    if (this.sortableChildren) this._sortDirty = true;
    if (this.scene && child.scene !== this.scene) child._setScene(this.scene);
    child.emit('added', this);
    this.emit('childadded', child);
    return child;
  }
  _setScene(scene) {
    this.scene = scene;
    for (var i = 0; i < this.children.length; i++) this.children[i]._setScene(scene);
  }
  removeChild(child) {
    if (arguments.length > 1) { for (var i = 0; i < arguments.length; i++) this.removeChild(arguments[i]); return arguments[0]; }
    var idx = this.children.indexOf(child);
    if (idx < 0) return child;
    return this.removeChildAt(idx);
  }
  remove(child, destroy) { this.removeChild(child); if (destroy && child) child.destroy(); return this; }
  removeChildAt(index) {
    var child = this.children[index]; if (!child) return null;
    this.children.splice(index, 1);
    child.parent = null;
    child.emit('removed', this);
    this.emit('childremoved', child);
    return child;
  }
  removeChildren(begin, end) {
    begin = begin || 0; end = end === undefined ? this.children.length : end;
    var removed = this.children.splice(begin, end - begin);
    for (var i = 0; i < removed.length; i++) { removed[i].parent = null; removed[i].emit('removed', this); }
    return removed;
  }
  removeAll(destroy) { var r = this.removeChildren(); if (destroy) for (var i = 0; i < r.length; i++) r[i].destroy(); return this; }
  removeFromParent() { if (this.parent) this.parent.removeChild(this); return this; }
  getChildAt(i) { return this.children[i]; }
  getChildIndex(c) { return this.children.indexOf(c); }
  getChildByName(name, deep) {
    for (var i = 0; i < this.children.length; i++) {
      var c = this.children[i];
      if (c.name === name) return c;
      if (deep) { var f = c.getChildByName(name, true); if (f) return f; }
    }
    return null;
  }
  getByName(name) { return this.getChildByName(name, true); }
  contains(child) { for (var p = child; p; p = p.parent) if (p === this) return true; return false; }
  setChildIndex(child, index) {
    var cur = this.children.indexOf(child); if (cur < 0) return this;
    this.children.splice(cur, 1);
    this.children.splice(clamp(index, 0, this.children.length), 0, child);
    this._reorderAddOrder();
    return this;
  }
  bringToTop(child) { return this.setChildIndex(child, this.children.length); }
  sendToBack(child) { return this.setChildIndex(child, 0); }
  swapChildren(a, b) {
    var i1 = this.children.indexOf(a), i2 = this.children.indexOf(b);
    if (i1 < 0 || i2 < 0) return this;
    this.children[i1] = b; this.children[i2] = a;
    this._reorderAddOrder();
    return this;
  }
  _reorderAddOrder() { for (var i = 0; i < this.children.length; i++) this.children[i]._addOrder = ++_addOrderCounter; this._sortDirty = true; }
  sortChildren() {
    var c = this.children, n = c.length;
    if (n < 2) { this._sortDirty = false; return; }
    if (n <= 64) {
      for (var i = 1; i < n; i++) {
        var x = c[i], j = i - 1;
        while (j >= 0 && (c[j]._zIndex > x._zIndex || (c[j]._zIndex === x._zIndex && c[j]._addOrder > x._addOrder))) { c[j + 1] = c[j]; j--; }
        c[j + 1] = x;
      }
    } else {
      c.sort(sortByDepth);
    }
    this._sortDirty = false;
  }
  each(fn, ctx) { var c = this.children.slice(); for (var i = 0; i < c.length; i++) fn.call(ctx, c[i], i); return this; }
  /** Recorre todo el subárbol (incluye this) */
  walk(fn) { if (fn(this) === false) return false; for (var i = 0; i < this.children.length; i++) if (this.children[i].walk(fn) === false) return false; return true; }

  /* ---------- transformaciones ---------- */
  _updateTransform(p) {
    var sx = this.scaleX, sy = this.scaleY;
    if (this.rotation !== this._rc || this.skewX !== this._skx || this.skewY !== this._sky) {
      var r = this.rotation; this._rc = r; this._skx = this.skewX; this._sky = this.skewY;
      if (this.skewX === 0 && this.skewY === 0) {
        if (r === 0) { this._ca = 1; this._sa = 0; this._cc = 0; this._cd = 1; }
        else { var cr = Math.cos(r), sr = Math.sin(r); this._ca = cr; this._sa = sr; this._cc = -sr; this._cd = cr; }
      } else {
        this._ca = Math.cos(r + this.skewY); this._sa = Math.sin(r + this.skewY);
        this._cc = -Math.sin(r - this.skewX); this._cd = Math.cos(r - this.skewX);
      }
    }
    var la = this._ca * sx, lb = this._sa * sx, lc = this._cc * sy, ld = this._cd * sy;
    var ltx = this.x - (this.pivotX * la + this.pivotY * lc);
    var lty = this.y - (this.pivotX * lb + this.pivotY * ld);
    if (this.scrollFactorX !== 1) ltx += RenderState.camScrollX * (1 - this.scrollFactorX);
    if (this.scrollFactorY !== 1) lty += RenderState.camScrollY * (1 - this.scrollFactorY);
    var pt = p.worldTransform, wt = this.worldTransform;
    wt.a = la * pt.a + lb * pt.c; wt.b = la * pt.b + lb * pt.d;
    wt.c = lc * pt.a + ld * pt.c; wt.d = lc * pt.b + ld * pt.d;
    wt.tx = ltx * pt.a + lty * pt.c + pt.tx; wt.ty = ltx * pt.b + lty * pt.d + pt.ty;
    this.worldAlpha = this.alpha * p.worldAlpha;
    var t = this._tint, ptint = p.worldTint;
    this.worldTint = t === 0xffffff ? ptint : (ptint === 0xffffff ? t : Color.multiply(t, ptint));
    this.worldBlend = this._blend < 0 ? p.worldBlend : this._blend;
  }
  /** Matriz local en `out` (con desplazamiento de scrollFactor opcional). */
  getLocalMatrix(out, camScrollX, camScrollY) {
    out = out || new Matrix();
    out.setTransform(this.x, this.y, this.pivotX, this.pivotY, this.scaleX, this.scaleY, this.rotation, this.skewX, this.skewY);
    if (camScrollX && this.scrollFactorX !== 1) out.tx += camScrollX * (1 - this.scrollFactorX);
    if (camScrollY && this.scrollFactorY !== 1) out.ty += camScrollY * (1 - this.scrollFactorY);
    return out;
  }
  /** Matriz mundo (sin cámara) calculada al vuelo; independiente del último render. */
  getWorldMatrix(out, camScrollX, camScrollY) {
    out = out || new Matrix();
    _chain.length = 0;
    for (var p = this; p; p = p.parent) _chain.push(p);
    out.identity();
    var m = _tmpMatrix;
    for (var i = _chain.length - 1; i >= 0; i--) { _chain[i].getLocalMatrix(m, camScrollX, camScrollY); out.append(m); }
    _chain.length = 0;
    return out;
  }
  /** Convierte un punto local a coordenadas de mundo. */
  toGlobal(x, y, out) { if (typeof x === 'object') { out = y; y = x.y; x = x.x; } return this.getWorldMatrix(_tmpMatrix2).apply(x, y, out || new Vec2()); }
  /** Convierte un punto de mundo a coordenadas locales. */
  toLocal(x, y, out) { if (typeof x === 'object') { out = y; y = x.y; x = x.x; } return this.getWorldMatrix(_tmpMatrix2).applyInverse(x, y, out || new Vec2()); }
  isVisibleInTree() { for (var p = this; p; p = p.parent) if (!p.visible || p.alpha <= 0) return false; return true; }

  /* ---------- límites ---------- */
  _updateTransformUpward() {
    if (this.parent) { this.parent._updateTransformUpward(); this._updateTransform(this.parent); }
    else this._updateTransform(IDENTITY_PARENT);
  }
  /** Límites en coordenadas de mundo (sin cámara). */
  getBounds(out) {
    var sx = RenderState.camScrollX, sy = RenderState.camScrollY;
    RenderState.camScrollX = 0; RenderState.camScrollY = 0;
    this._updateTransformUpward();
    var b = new Bounds();
    this._accumBounds(b, false);
    RenderState.camScrollX = sx; RenderState.camScrollY = sy;
    return b.toRect(out);
  }
  /** Límites en coordenadas locales (sin la transformación propia). */
  getLocalBounds(out) {
    var saveWT = _tmpMatrix3.copyFrom(this.worldTransform);
    var sa = this.worldAlpha, st = this.worldTint, sbl = this.worldBlend;
    var sx = RenderState.camScrollX, sy = RenderState.camScrollY; RenderState.camScrollX = 0; RenderState.camScrollY = 0;
    this.worldTransform.identity();
    var b = new Bounds();
    this._accumBounds(b, true);
    this.worldTransform.copyFrom(saveWT); this.worldAlpha = sa; this.worldTint = st; this.worldBlend = sbl;
    RenderState.camScrollX = sx; RenderState.camScrollY = sy;
    return b.toRect(out);
  }
  /** Acumula límites del subárbol usando worldTransform actual (se actualizan los hijos). */
  _accumBounds(b, skipSelfUpdate) {
    if (!this.visible) return;
    this._addSelfBounds(b);
    var ch = this.children;
    for (var i = 0; i < ch.length; i++) {
      var c = ch[i];
      if (!c.visible || c._isMask) continue;
      c._updateTransform(this);
      c._accumBounds(b);
    }
  }
  _addSelfBounds(b) { if (this.hitArea && this.hitArea.getBounds && !this.children.length && this.type === 'Zone') { var r = this.hitArea.getBounds(_tmpRect); b.addRect(r.x, r.y, r.right, r.bottom, this.worldTransform); } }

  /** Test de impacto en coordenadas locales */
  hitTestLocal(lx, ly) {
    if (this.hitArea) return this.hitArea.contains(lx, ly);
    return this._hitTestSelf(lx, ly);
  }
  _hitTestSelf() { return false; }

  /* ---------- render (sobrescrito por subclases) ---------- */
  _renderGPU() {}
  _renderCanvas() {}

  /* ---------- ciclo de vida ---------- */
  destroy(options) {
    if (this.destroyed) return;
    var destroyChildren = !(options === false || (options && options.children === false));
    this.emit('destroy', this);
    if (this.parent) this.parent.removeChild(this);
    if (destroyChildren) {
      while (this.children.length) this.children[this.children.length - 1].destroy(options);
    } else this.removeChildren();
    if (this.body && this.body.destroy) this.body.destroy();
    this.body = null;
    if (this._mask) { this._mask._isMask = false; this._mask = null; }
    if (this._cache) { if (this._cache.rt) this._cache.rt.destroy(); if (this._cache.canvas) releaseCanvas(this._cache.canvas); this._cache = null; }
    this._filters = null; this.clipRect = null; this.hitArea = null; this._input = null;
    if (this._data) { this._data.destroy(); this._data = null; }
    this.off();
    this.scene = null;
    this.destroyed = true; this.active = false; this.visible = false; this.interactive = false;
    this._onDestroy(options);
    Debug.track('DisplayObject', -1);
  }
  _onDestroy() {}
}
function sortByDepth(a, b) { return (a._zIndex - b._zIndex) || (a._addOrder - b._addOrder); }
var _tmpMatrix = new Matrix(), _tmpMatrix2 = new Matrix(), _tmpMatrix3 = new Matrix();
var _tmpRect = new Rectangle();

/* ========================================================================= Sprite */
class Sprite extends Container {
  constructor(x, y, texture, frame) {
    // Firma flexible: new Sprite(texture) | new Sprite(x, y, texture, frame)
    if (typeof x !== 'number' && x !== undefined) { frame = y; texture = x; x = 0; y = 0; }
    super(x, y);
    this.type = 'Sprite';
    this._texture = Texture.EMPTY;
    this.anchorX = 0.5; this.anchorY = 0.5;
    this.textureKey = null;
    this.anims = null;
    this._anchorProxy = null;
    if (texture !== undefined && texture !== null) this.setTexture(texture, frame);
  }
  get texture() { return this._texture; }
  set texture(t) { this.setTexture(t); }
  get frame() { return this._texture; }
  get anchor() { return this._anchorProxy || (this._anchorProxy = new PointProxy(this, 'anchorX', 'anchorY')); }
  set anchor(v) { if (typeof v === 'number') { this.anchorX = v; this.anchorY = v; } else { this.anchorX = v.x; this.anchorY = v.y; } }
  get originX() { return this.anchorX; } set originX(v) { this.anchorX = v; }
  get originY() { return this.anchorY; } set originY(v) { this.anchorY = v; }
  get width() { return Math.abs(this.scaleX) * this._texture.width; }
  set width(v) { var w = this._texture.width; this.scaleX = (w ? v / w : 1) * (this.scaleX < 0 ? -1 : 1); }
  get height() { return Math.abs(this.scaleY) * this._texture.height; }
  set height(v) { var h = this._texture.height; this.scaleY = (h ? v / h : 1) * (this.scaleY < 0 ? -1 : 1); }
  get displayWidth() { return this.width; } set displayWidth(v) { this.width = v; }
  get displayHeight() { return this.height; } set displayHeight(v) { this.height = v; }
  _textures() { return (this.scene && this.scene.textures) || UG._defaultTextures; }
  /** setTexture(Texture) | setTexture('clave', frame) */
  setTexture(t, frame) {
    if (typeof t === 'string') {
      var tm = this._textures();
      if (!tm) throw new Error('UltraGame: no hay TextureManager para resolver "' + t + '" (crea antes un UG.Game)');
      this.textureKey = t;
      t = tm.get(t, frame);
    } else if (t && t.key) this.textureKey = t.key;
    if (!(t instanceof Texture)) t = Texture.EMPTY;
    this._texture = t;
    if (t.defaultAnchor && !this._anchorSetByUser) { this.anchorX = t.defaultAnchor.x; this.anchorY = t.defaultAnchor.y; }
    return this;
  }
  setFrame(frame) {
    if (this.textureKey) return this.setTexture(this.textureKey, frame);
    return this;
  }
  setOrigin(x, y) { this.anchorX = x === undefined ? 0.5 : x; this.anchorY = y === undefined ? this.anchorX : y; this._anchorSetByUser = true; return this; }
  setAnchor(x, y) { return this.setOrigin(x, y); }
  setFlip(x, y) { this.flipX = !!x; this.flipY = !!y; return this; }
  setFlipX(v) { this.flipX = !!v; return this; }
  setFlipY(v) { this.flipY = !!v; return this; }
  toggleFlipX() { this.flipX = !this.flipX; return this; }
  toggleFlipY() { this.flipY = !this.flipY; return this; }
  setDisplaySize(w, h) { this.width = w; this.height = h; return this; }
  setSize(w, h) { return this.setDisplaySize(w, h); }
  setRoundPixels(v) { this.roundPixels = v !== false; return this; }
  /** Reproduce una animación registrada en scene.anims / game.anims */
  play(key, ignoreIfPlaying) { if (!this.anims) this.anims = new AnimationState(this); this.anims.play(key, ignoreIfPlaying); return this; }
  playReverse(key, ignoreIfPlaying) { if (!this.anims) this.anims = new AnimationState(this); this.anims.play(key, ignoreIfPlaying, true); return this; }
  stop() { if (this.anims) this.anims.stop(); return this; }
  chain(key) { if (!this.anims) this.anims = new AnimationState(this); this.anims.chain(key); return this; }
  get isPlaying() { return !!(this.anims && this.anims.isPlaying); }

  /** Calcula las 4 esquinas en mundo en v[8] (TL, TR, BR, BL). */
  _calcVerts(v) {
    var tex = this._texture, wt = this.worldTransform;
    var a = wt.a, b = wt.b, c = wt.c, d = wt.d, tx = wt.tx, ty = wt.ty;
    var res = tex.source.resolution, orig = tex.orig, trim = tex.trim;
    var ow = orig.width / res, oh = orig.height / res, w0, w1, h0, h1;
    if (trim) {
      w1 = trim.x / res - this.anchorX * ow; w0 = w1 + trim.width / res;
      h1 = trim.y / res - this.anchorY * oh; h0 = h1 + trim.height / res;
    } else {
      w1 = -this.anchorX * ow; w0 = w1 + ow;
      h1 = -this.anchorY * oh; h0 = h1 + oh;
    }
    // volteo dentro del propio marco (como Phaser): los límites, la física y el hit-test no cambian
    if (this.flipX) { var fx2 = ow * (1 - 2 * this.anchorX); w1 = fx2 - w1; w0 = fx2 - w0; }
    if (this.flipY) { var fy2 = oh * (1 - 2 * this.anchorY); h1 = fy2 - h1; h0 = fy2 - h0; }
    v[0] = a * w1 + c * h1 + tx; v[1] = d * h1 + b * w1 + ty;
    v[2] = a * w0 + c * h1 + tx; v[3] = d * h1 + b * w0 + ty;
    v[4] = a * w0 + c * h0 + tx; v[5] = d * h0 + b * w0 + ty;
    v[6] = a * w1 + c * h0 + tx; v[7] = d * h0 + b * w1 + ty;
    if (this.roundPixels) { for (var i = 0; i < 8; i++) v[i] = Math.round(v[i]); }
  }
  _packedColor() {
    if (this.worldTint !== this._pcTint || this.worldAlpha !== this._pcAlpha) {
      this._pcTint = this.worldTint; this._pcAlpha = this.worldAlpha; this._pc = packColor(this.worldTint, this.worldAlpha);
    }
    return this._pc;
  }
  _renderGPU(r) {
    var tex = this._texture;
    if (tex === Texture.EMPTY) return;
    var src = tex.source;
    if (!src || src.destroyed) return;
    if (tex.rotate) {
      this._calcVerts(QV);
      if (r.cull && this.cullable && quadOutside(QV, r.cullRect)) { r.stats.culled++; return; }
      r.batcher.pushQuad(src, QV, tex.uvs, this._packedColor(), this.worldBlend);
      return;
    }
    // Camino rápido: esquina + ejes (sin vértices intermedios) directo al lote instanciado
    var wt = this.worldTransform, a = wt.a, b = wt.b, c = wt.c, d = wt.d;
    var res = src.resolution, orig = tex.orig, trim = tex.trim;
    var ow = orig.width / res, oh = orig.height / res, w1, h1, dw, dh;
    if (trim === null) { w1 = -this.anchorX * ow; dw = ow; h1 = -this.anchorY * oh; dh = oh; }
    else { w1 = trim.x / res - this.anchorX * ow; dw = trim.width / res; h1 = trim.y / res - this.anchorY * oh; dh = trim.height / res; }
    if (this.flipX) { w1 = ow * (1 - 2 * this.anchorX) - w1; dw = -dw; }
    if (this.flipY) { h1 = oh * (1 - 2 * this.anchorY) - h1; dh = -dh; }
    var x = a * w1 + c * h1 + wt.tx, y = b * w1 + d * h1 + wt.ty;
    var ux = a * dw, uy = b * dw, vx = c * dh, vy = d * dh;
    if (this.roundPixels) { x = Math.round(x); y = Math.round(y); }
    if (r.cull && this.cullable) {
      var cr = r.cullRect;
      var minX = x + (ux < 0 ? ux : 0) + (vx < 0 ? vx : 0), maxX = x + (ux > 0 ? ux : 0) + (vx > 0 ? vx : 0);
      var minY = y + (uy < 0 ? uy : 0) + (vy < 0 ? vy : 0), maxY = y + (uy > 0 ? uy : 0) + (vy > 0 ? vy : 0);
      if (maxX < cr.x || maxY < cr.y || minX > cr.x + cr.width || minY > cr.y + cr.height) { r.stats.culled++; return; }
    }
    var col = (this.worldTint === this._pcTint && this.worldAlpha === this._pcAlpha) ? this._pc : this._packedColor();
    var bt = r.batcher, blend = this.worldBlend;
    if (bt.mode === 1 && blend === bt.blend && src._bTick === bt.tick && bt.instCount < bt.maxInst) {
      // escritura directa (sin llamada) cuando el lote ya está abierto con esta textura
      var o = bt.instCount * 10, f = bt.if32, w = bt.iu32;
      f[o] = x; f[o + 1] = y; f[o + 2] = ux; f[o + 3] = uy; f[o + 4] = vx; f[o + 5] = vy;
      w[o + 6] = tex._uvA; w[o + 7] = tex._uvB; w[o + 8] = col; f[o + 9] = src._bSlot;
      bt.instCount++; bt.quads++;
      return;
    }
    var uv = tex.uvs;
    bt.pushInstance(src, x, y, ux, uy, vx, vy, uv[0], uv[1], uv[4], uv[5], col, blend);
  }
  _renderCanvas(r) { r.drawSprite(this); }
  _addSelfBounds(b) {
    if (this._texture === Texture.EMPTY) return;
    this._calcVerts(QV); b.addQuad(QV);
  }
  _hitTestSelf(lx, ly) {
    var t = this._texture, w = t.width, h = t.height;
    var x0 = -this.anchorX * w, y0 = -this.anchorY * h;
    return lx >= x0 && lx < x0 + w && ly >= y0 && ly < y0 + h;
  }
  _onDestroy() { if (this.anims) { this.anims.destroy(); this.anims = null; } this._texture = Texture.EMPTY; }
}
/** true si el quad v[8] está completamente fuera del rectángulo */
function quadOutside(v, r) {
  var minX = v[0], maxX = v[0], minY = v[1], maxY = v[1];
  for (var i = 2; i < 8; i += 2) {
    var x = v[i], y = v[i + 1];
    if (x < minX) minX = x; else if (x > maxX) maxX = x;
    if (y < minY) minY = y; else if (y > maxY) maxY = y;
  }
  return maxX < r.x || maxY < r.y || minX > r.x + r.width || minY > r.y + r.height;
}

/* ================================================================= AnimatedSprite
 * Estilo PixiJS: new AnimatedSprite([tex1, tex2...], {frameRate: 12, loop: true}) */
class AnimatedSprite extends Sprite {
  constructor(textures, options) {
    super(textures && textures[0] ? textures[0] : Texture.EMPTY);
    this.type = 'AnimatedSprite';
    options = options || {};
    this._animDef = new Animation(null, '__inline_' + this.uid, {
      frames: (textures || []).map(function (t) { return { texture: t }; }),
      frameRate: options.frameRate || (options.animationSpeed ? options.animationSpeed * 60 : 12),
      repeat: options.loop === false ? 0 : -1, yoyo: !!options.yoyo
    });
    if (options.autoPlay !== false) this.play(this._animDef);
  }
  get textures() { return this._animDef.frames.map(function (f) { return f.texture; }); }
  gotoAndPlay(frame) { this.play(this._animDef); if (this.anims) this.anims.setFrame(frame); return this; }
  gotoAndStop(frame) { this.play(this._animDef); if (this.anims) { this.anims.setFrame(frame); this.anims.pause(); } return this; }
  playAnim() { return this.play(this._animDef); }
}

/* ================================================================== TilingSprite */
class TilingSprite extends Sprite {
  constructor(x, y, width, height, texture, frame) {
    super(x, y, texture, frame);
    this.type = 'TilingSprite';
    this._w = width || 100; this._h = height || 100;
    this.tilePositionX = 0; this.tilePositionY = 0;
    this.tileScaleX = 1; this.tileScaleY = 1;
    this.tileRotation = 0;
    this._tilePosProxy = null; this._tileScaleProxy = null;
    this._ensureRepeat();
  }
  setTexture(t, frame) { super.setTexture(t, frame); this._ensureRepeat(); return this; }
  _ensureRepeat() { var t = this._texture; if (t && t.isFullSource && t !== Texture.EMPTY && t !== Texture.WHITE) t.source.setWrapMode('repeat'); }
  get width() { return this._w * Math.abs(this.scaleX); }
  set width(v) { this._w = v; }
  get height() { return this._h * Math.abs(this.scaleY); }
  set height(v) { this._h = v; }
  get tilePosition() { return this._tilePosProxy || (this._tilePosProxy = new PointProxy(this, 'tilePositionX', 'tilePositionY')); }
  get tileScale() { return this._tileScaleProxy || (this._tileScaleProxy = new PointProxy(this, 'tileScaleX', 'tileScaleY')); }
  setTilePosition(x, y) { this.tilePositionX = x; this.tilePositionY = y === undefined ? x : y; return this; }
  setTileScale(x, y) { this.tileScaleX = x; this.tileScaleY = y === undefined ? x : y; return this; }
  setSize(w, h) { this._w = w; this._h = h; return this; }
  _localRect() { var x0 = -this.anchorX * this._w, y0 = -this.anchorY * this._h; return [x0, y0, x0 + this._w, y0 + this._h]; }
  _addSelfBounds(b) { var r = this._localRect(); b.addRect(r[0], r[1], r[2], r[3], this.worldTransform); }
  _hitTestSelf(lx, ly) { var r = this._localRect(); return lx >= r[0] && lx < r[2] && ly >= r[1] && ly < r[3]; }
  _renderGPU(r) {
    var tex = this._texture;
    if (tex === Texture.EMPTY || !tex.source || tex.source.destroyed || this._w <= 0 || this._h <= 0) return;
    var rect = this._localRect(), wt = this.worldTransform;
    var x0 = rect[0], y0 = rect[1], x1 = rect[2], y1 = rect[3];
    var a = wt.a, b = wt.b, c = wt.c, d = wt.d, tx = wt.tx, ty = wt.ty;
    var color = this._packedColor(), blend = this.worldBlend;
    var tw = tex.width * this.tileScaleX, th = tex.height * this.tileScaleY;
    if (tw <= 0.0001 || th <= 0.0001) return;
    var src = tex.source;
    var canRepeat = tex.isFullSource && (r.supportsNPOTRepeat || src.isPowerOfTwo);
    if (canRepeat) {
      if (src.wrapMode !== 'repeat') src.setWrapMode('repeat');
      QV[0] = a * x0 + c * y0 + tx; QV[1] = b * x0 + d * y0 + ty;
      QV[2] = a * x1 + c * y0 + tx; QV[3] = b * x1 + d * y0 + ty;
      QV[4] = a * x1 + c * y1 + tx; QV[5] = b * x1 + d * y1 + ty;
      QV[6] = a * x0 + c * y1 + tx; QV[7] = b * x0 + d * y1 + ty;
      if (r.cull && this.cullable && quadOutside(QV, r.cullRect)) return;
      var cr = Math.cos(-this.tileRotation), sr = Math.sin(-this.tileRotation);
      var tpx = this.tilePositionX, tpy = this.tilePositionY, W = this._w, H = this._h;
      var uvAt = function (px, py, o) {
        var dx = px - tpx, dy = py - tpy;
        var rx = dx * cr - dy * sr, ry = dx * sr + dy * cr;
        QUV[o] = rx / tw; QUV[o + 1] = ry / th;
      };
      uvAt(0, 0, 0); uvAt(W, 0, 2); uvAt(W, H, 4); uvAt(0, H, 6);
      r.batcher.pushQuad(src, QV, QUV, color, blend);
      return;
    }
    // Ruta en rejilla (frames de atlas o NPOT en WebGL1): un quad por celda recortado
    var fu = tex.uvs, u0 = fu[0], v0 = fu[1], u1 = fu[4], v1 = fu[5];
    var ox = ((this.tilePositionX % tw) + tw) % tw, oy = ((this.tilePositionY % th) + th) % th;
    var startX = ox > 0 ? ox - tw : 0, startY = oy > 0 ? oy - th : 0;
    var W2 = this._w, H2 = this._h;
    var maxCells = 20000, cells = 0;
    for (var cy = startY; cy < H2 && cells < maxCells; cy += th) {
      for (var cx = startX; cx < W2 && cells < maxCells; cx += tw) {
        cells++;
        var qx0 = Math.max(cx, 0), qy0 = Math.max(cy, 0), qx1 = Math.min(cx + tw, W2), qy1 = Math.min(cy + th, H2);
        if (qx1 <= qx0 || qy1 <= qy0) continue;
        var fx0 = (qx0 - cx) / tw, fy0 = (qy0 - cy) / th, fx1 = (qx1 - cx) / tw, fy1 = (qy1 - cy) / th;
        var lx0 = x0 + qx0, ly0 = y0 + qy0, lx1 = x0 + qx1, ly1 = y0 + qy1;
        QV[0] = a * lx0 + c * ly0 + tx; QV[1] = b * lx0 + d * ly0 + ty;
        QV[2] = a * lx1 + c * ly0 + tx; QV[3] = b * lx1 + d * ly0 + ty;
        QV[4] = a * lx1 + c * ly1 + tx; QV[5] = b * lx1 + d * ly1 + ty;
        QV[6] = a * lx0 + c * ly1 + tx; QV[7] = b * lx0 + d * ly1 + ty;
        if (r.cull && quadOutside(QV, r.cullRect)) continue;
        var uu0 = u0 + (u1 - u0) * fx0, uu1 = u0 + (u1 - u0) * fx1, vv0 = v0 + (v1 - v0) * fy0, vv1 = v0 + (v1 - v0) * fy1;
        QUV[0] = uu0; QUV[1] = vv0; QUV[2] = uu1; QUV[3] = vv0; QUV[4] = uu1; QUV[5] = vv1; QUV[6] = uu0; QUV[7] = vv1;
        r.batcher.pushQuad(src, QV, QUV, color, blend);
      }
    }
  }
  _renderCanvas(r) { r.drawTilingSprite(this); }
}

/* ===================================================================== NineSlice */
class NineSlice extends Sprite {
  constructor(x, y, texture, frame, width, height, left, right, top, bottom) {
    super(x, y, texture, frame);
    this.type = 'NineSlice';
    var tw = this._texture.width, th = this._texture.height;
    this._w = width || tw; this._h = height || th;
    this.leftWidth = left !== undefined ? left : Math.floor(tw / 3);
    this.rightWidth = right !== undefined ? right : this.leftWidth;
    this.topHeight = top !== undefined ? top : Math.floor(th / 3);
    this.bottomHeight = bottom !== undefined ? bottom : this.topHeight;
    var bd = this._texture.customData && this._texture.customData.borders;
    if (bd && left === undefined) { this.leftWidth = bd.left || bd.x || 0; this.topHeight = bd.top || bd.y || 0; this.rightWidth = bd.right || 0; this.bottomHeight = bd.bottom || 0; }
  }
  get width() { return this._w * Math.abs(this.scaleX); }
  set width(v) { this._w = v; }
  get height() { return this._h * Math.abs(this.scaleY); }
  set height(v) { this._h = v; }
  setSize(w, h) { this._w = w; this._h = h; return this; }
  setSlices(l, r, t, b) { this.leftWidth = l; this.rightWidth = r === undefined ? l : r; this.topHeight = t === undefined ? l : t; this.bottomHeight = b === undefined ? this.topHeight : b; return this; }
  _localRect() { var x0 = -this.anchorX * this._w, y0 = -this.anchorY * this._h; return [x0, y0, x0 + this._w, y0 + this._h]; }
  _addSelfBounds(b) { var r = this._localRect(); b.addRect(r[0], r[1], r[2], r[3], this.worldTransform); }
  _hitTestSelf(lx, ly) { var r = this._localRect(); return lx >= r[0] && lx < r[2] && ly >= r[1] && ly < r[3]; }
  /** Devuelve las 3 columnas y 3 filas: {xs:[4], ys:[4], us:[4], vs:[4]} */
  _slices() {
    var t = this._texture, W = this._w, H = this._h;
    var L = this.leftWidth, R = this.rightWidth, T = this.topHeight, B = this.bottomHeight;
    var sx = (L + R) > W ? W / (L + R) : 1, sy = (T + B) > H ? H / (T + B) : 1;
    var r = this._localRect();
    var xs = [r[0], r[0] + L * sx, r[2] - R * sx, r[2]], ys = [r[1], r[1] + T * sy, r[3] - B * sy, r[3]];
    var u = t.uvs, tw = t.width, th = t.height, u0 = u[0], v0 = u[1], u1 = u[4], v1 = u[5];
    var us = [u0, u0 + (u1 - u0) * (L / tw), u1 - (u1 - u0) * (R / tw), u1];
    var vs = [v0, v0 + (v1 - v0) * (T / th), v1 - (v1 - v0) * (B / th), v1];
    return { xs: xs, ys: ys, us: us, vs: vs };
  }
  _renderGPU(r) {
    var tex = this._texture;
    if (tex === Texture.EMPTY || !tex.source || tex.source.destroyed) return;
    var s = this._slices(), wt = this.worldTransform, a = wt.a, b = wt.b, c = wt.c, d = wt.d, tx = wt.tx, ty = wt.ty;
    var color = this._packedColor(), blend = this.worldBlend;
    for (var j = 0; j < 3; j++) {
      for (var i = 0; i < 3; i++) {
        var lx0 = s.xs[i], lx1 = s.xs[i + 1], ly0 = s.ys[j], ly1 = s.ys[j + 1];
        if (lx1 - lx0 <= 0 || ly1 - ly0 <= 0) continue;
        QV[0] = a * lx0 + c * ly0 + tx; QV[1] = b * lx0 + d * ly0 + ty;
        QV[2] = a * lx1 + c * ly0 + tx; QV[3] = b * lx1 + d * ly0 + ty;
        QV[4] = a * lx1 + c * ly1 + tx; QV[5] = b * lx1 + d * ly1 + ty;
        QV[6] = a * lx0 + c * ly1 + tx; QV[7] = b * lx0 + d * ly1 + ty;
        QUV[0] = s.us[i]; QUV[1] = s.vs[j]; QUV[2] = s.us[i + 1]; QUV[3] = s.vs[j]; QUV[4] = s.us[i + 1]; QUV[5] = s.vs[j + 1]; QUV[6] = s.us[i]; QUV[7] = s.vs[j + 1];
        r.batcher.pushQuad(tex.source, QV, QUV, color, blend);
      }
    }
  }
  _renderCanvas(r) { r.drawNineSlice(this); }
}

/* ========================================================================== Mesh
 * Malla texturizada: vertices [x,y...] locales, uvs [u,v...] 0..1 relativos al frame, indices. */
class Mesh extends Container {
  constructor(texture, vertices, uvs, indices, colors) {
    super();
    this.type = 'Mesh';
    this.texture = texture instanceof Texture ? texture : Texture.WHITE;
    this.vertices = vertices instanceof Float32Array ? vertices : new Float32Array(vertices || []);
    this.uvs = uvs instanceof Float32Array ? uvs : new Float32Array(uvs || []);
    this.indices = indices ? (indices instanceof Uint16Array || indices instanceof Uint32Array ? indices : new Uint32Array(indices)) : null;
    this.colors = colors ? (colors instanceof Uint32Array ? colors : new Uint32Array(colors)) : null;
    this._atlasUvs = null; this._uvVersion = -1; this.dirty = true;
    this._packed = null; this._pkT = -1; this._pkA = -1;
  }
  get vertexCount() { return this.vertices.length >> 1; }
  _buildIndices() {
    if (this.indices) return this.indices;
    var n = this.vertexCount, idx = new Uint32Array(Math.max(0, n - 2) * 3);
    for (var i = 0; i + 2 < n; i++) { idx[i * 3] = 0; idx[i * 3 + 1] = i + 1; idx[i * 3 + 2] = i + 2; }
    this.indices = idx; return idx;
  }
  _getAtlasUvs() {
    var t = this.texture;
    if (!this._atlasUvs || this._atlasUvs.length !== this.uvs.length || this.dirty || this._uvTex !== t) {
      var src = this.uvs, out = this._atlasUvs && this._atlasUvs.length === src.length ? this._atlasUvs : new Float32Array(src.length);
      var u = t.uvs, u0 = u[0], v0 = u[1], u1 = u[4], v1 = u[5];
      for (var i = 0; i < src.length; i += 2) { out[i] = u0 + (u1 - u0) * src[i]; out[i + 1] = v0 + (v1 - v0) * src[i + 1]; }
      this._atlasUvs = out; this._uvTex = t; this.dirty = false;
    }
    return this._atlasUvs;
  }
  _getColors() {
    var t = this.worldTint, a = this.worldAlpha;
    if (!this.colors) {
      if (t !== this._pkT || a !== this._pkA) { this._pkT = t; this._pkA = a; this._pc1 = packColor(t, a); }
      return this._pc1;
    }
    var n = this.vertexCount;
    if (!this._packed || this._packed.length !== n) this._packed = new Uint32Array(n);
    for (var i = 0; i < n; i++) {
      var c = this.colors[i];
      this._packed[i] = packColor(Color.multiply(c & 0xffffff, t), (((c >>> 24) & 255) / 255 || 1) * a);
    }
    return this._packed;
  }
  _renderGPU(r) {
    var n = this.vertexCount; if (n < 3 || !this.texture.source || this.texture.source.destroyed) return;
    var idx = this._buildIndices();
    r.batcher.pushMesh(this.texture.source, this.vertices, this._getAtlasUvs(), this._getColors(), idx, n, idx.length, this.worldTransform, this.worldBlend);
  }
  _renderCanvas(r) { r.drawMesh(this); }
  _addSelfBounds(b) {
    var v = this.vertices, m = this.worldTransform;
    for (var i = 0; i < v.length; i += 2) b.addPoint(m.a * v[i] + m.c * v[i + 1] + m.tx, m.b * v[i] + m.d * v[i + 1] + m.ty);
  }
  _hitTestSelf(lx, ly) {
    var v = this.vertices, idx = this._buildIndices();
    for (var i = 0; i < idx.length; i += 3) {
      var a = idx[i] * 2, b = idx[i + 1] * 2, c = idx[i + 2] * 2;
      var d1 = (lx - v[b]) * (v[a + 1] - v[b + 1]) - (v[a] - v[b]) * (ly - v[b + 1]);
      var d2 = (lx - v[c]) * (v[b + 1] - v[c + 1]) - (v[b] - v[c]) * (ly - v[c + 1]);
      var d3 = (lx - v[a]) * (v[c + 1] - v[a + 1]) - (v[c] - v[a]) * (ly - v[a + 1]);
      var neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(neg && pos)) return true;
    }
    return false;
  }
}

/* ========================================================================== Rope
 * Tira texturizada a lo largo de puntos (estelas, serpientes, látigos, cuerdas). */
class Rope extends Mesh {
  constructor(texture, points, options) {
    super(texture);
    this.type = 'Rope';
    options = options || {};
    this.points = points || [];
    this.ropeWidth = options.width || (texture ? texture.height : 10);
    this.textureScale = options.textureScale || 0;
    this.taper = options.taper || 0;
  }
  _rebuild() {
    var pts = this.points, n = pts.length;
    if (n < 2) { this.vertices = new Float32Array(0); return; }
    if (this.vertices.length !== n * 4) { this.vertices = new Float32Array(n * 4); this.uvs = new Float32Array(n * 4); this.indices = null; this._atlasUvs = null; }
    var v = this.vertices, uv = this.uvs, total = 0, i;
    for (i = 1; i < n; i++) total += Math.sqrt((pts[i].x - pts[i - 1].x) * (pts[i].x - pts[i - 1].x) + (pts[i].y - pts[i - 1].y) * (pts[i].y - pts[i - 1].y));
    var acc = 0, tw = this.texture.width || 1;
    for (i = 0; i < n; i++) {
      var p = pts[i], prev = pts[i > 0 ? i - 1 : 0], next = pts[i < n - 1 ? i + 1 : n - 1];
      var dx = next.x - prev.x, dy = next.y - prev.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / len, ny = dx / len;
      var hw = this.ropeWidth / 2;
      if (this.taper) hw *= 1 - this.taper * (1 - i / (n - 1));
      if (i > 0) acc += Math.sqrt((p.x - pts[i - 1].x) * (p.x - pts[i - 1].x) + (p.y - pts[i - 1].y) * (p.y - pts[i - 1].y));
      v[i * 4] = p.x + nx * hw; v[i * 4 + 1] = p.y + ny * hw;
      v[i * 4 + 2] = p.x - nx * hw; v[i * 4 + 3] = p.y - ny * hw;
      var u = this.textureScale > 0 ? acc / (tw * this.textureScale) : (total > 0 ? acc / total : 0);
      if (this.textureScale > 0) u = u - Math.floor(u);
      uv[i * 4] = u; uv[i * 4 + 1] = 0; uv[i * 4 + 2] = u; uv[i * 4 + 3] = 1;
    }
    if (!this.indices || this.indices.length !== (n - 1) * 6) {
      var idx = new Uint32Array((n - 1) * 6);
      for (i = 0; i < n - 1; i++) { var b = i * 2; idx[i * 6] = b; idx[i * 6 + 1] = b + 1; idx[i * 6 + 2] = b + 2; idx[i * 6 + 3] = b + 1; idx[i * 6 + 4] = b + 3; idx[i * 6 + 5] = b + 2; }
      this.indices = idx;
    }
    this.dirty = true;
  }
  _renderGPU(r) { this._rebuild(); super._renderGPU(r); }
  _renderCanvas(r) { this._rebuild(); super._renderCanvas(r); }
  _addSelfBounds(b) { this._rebuild(); super._addSelfBounds(b); }
}

/* ========================================================================== Zone
 * Área invisible interactiva (botones invisibles, triggers). */
class Zone extends Container {
  constructor(x, y, width, height) {
    super(x, y);
    this.type = 'Zone';
    this.zoneWidth = width || 1; this.zoneHeight = height || 1;
    this.hitArea = new Rectangle(-this.zoneWidth / 2, -this.zoneHeight / 2, this.zoneWidth, this.zoneHeight);
  }
  setSize(w, h) { this.zoneWidth = w; this.zoneHeight = h; this.hitArea = new Rectangle(-w / 2, -h / 2, w, h); return this; }
}

/* ========================================================================= Group
 * Colección lógica con pool de reutilización (balas, enemigos...). No es un contenedor visual. */
class Group extends EventEmitter {
  constructor(scene, config) {
    super();
    config = config || {};
    this.scene = scene || null;
    this.children = [];
    this.classType = config.classType || Sprite;
    this.defaultKey = config.defaultKey || config.key || null;
    this.defaultFrame = config.defaultFrame !== undefined ? config.defaultFrame : config.frame;
    this.maxSize = config.maxSize !== undefined ? config.maxSize : -1;
    this.runChildUpdate = !!config.runChildUpdate;
    this.container = config.container || (scene ? scene.world : null);
    this.createCallback = config.createCallback || null;
    this.removeCallback = config.removeCallback || null;
    this.destroyed = false;
    var qty = config.quantity || config.repeat || 0;
    if (qty > 0) this.createMultiple({ quantity: qty, key: this.defaultKey, frame: this.defaultFrame, active: config.active !== false, visible: config.visible !== false });
  }
  get length() { return this.children.length; }
  isFull() { return this.maxSize >= 0 && this.children.length >= this.maxSize; }
  add(obj, addToContainer) {
    if (this.children.indexOf(obj) >= 0) return obj;
    this.children.push(obj);
    if (addToContainer !== false && this.container && !obj.parent) this.container.addChild(obj);
    var self = this;
    obj.once('destroy', function () { removeFromArray(self.children, obj); if (self.removeCallback) self.removeCallback(obj); });
    if (this.createCallback) this.createCallback(obj);
    return obj;
  }
  addMultiple(list) { for (var i = 0; i < list.length; i++) this.add(list[i]); return this; }
  remove(obj, destroy) { if (removeFromArray(this.children, obj)) { if (this.removeCallback) this.removeCallback(obj); if (destroy) obj.destroy(); } return this; }
  create(x, y, key, frame, visible, active) {
    if (this.isFull()) return null;
    var Cls = this.classType;
    var obj = new Cls(x || 0, y || 0, key !== undefined ? key : this.defaultKey, frame !== undefined ? frame : this.defaultFrame);
    if (this.scene) obj.scene = this.scene;
    obj.visible = visible !== false; obj.active = active !== false;
    return this.add(obj);
  }
  createMultiple(cfg) {
    var out = [], n = cfg.quantity || 1;
    for (var i = 0; i < n; i++) {
      var o = this.create(cfg.x || 0, cfg.y || 0, cfg.key, cfg.frame, cfg.visible, cfg.active);
      if (!o) break;
      if (cfg.setXY) { o.x = (cfg.setXY.x || 0) + (cfg.setXY.stepX || 0) * i; o.y = (cfg.setXY.y || 0) + (cfg.setXY.stepY || 0) * i; }
      out.push(o);
    }
    return out;
  }
  getFirst(active, createIfNull, x, y, key, frame) {
    for (var i = 0; i < this.children.length; i++) { var c = this.children[i]; if (c.active === active) { if (x !== undefined) { c.x = x; c.y = y; } return c; } }
    return createIfNull ? this.create(x, y, key, frame) : null;
  }
  getFirstAlive() { return this.getFirst(true); }
  getFirstDead(createIfNull, x, y, key, frame) { return this.getFirst(false, createIfNull, x, y, key, frame); }
  /** Obtiene un miembro inactivo (o crea uno) y lo activa: patrón de pool. */
  get(x, y, key, frame) {
    var o = this.getFirst(false, true, x, y, key, frame);
    if (o) { o.active = true; o.visible = true; if (x !== undefined) { o.x = x; o.y = y; } if (o.body && o.body.reset) o.body.reset(o.x, o.y); }
    return o;
  }
  /** Desactiva y oculta (vuelve al pool). */
  killAndHide(obj) { obj.active = false; obj.visible = false; if (obj.body) { obj.body.enable = false; obj.body.stop && obj.body.stop(); } return this; }
  kill(obj) { obj.active = false; if (obj.body) obj.body.enable = false; return this; }
  countActive(value) { value = value === undefined ? true : value; var n = 0; for (var i = 0; i < this.children.length; i++) if (this.children[i].active === value) n++; return n; }
  getChildren() { return this.children; }
  getMatching(prop, value) { return this.children.filter(function (c) { return c[prop] === value; }); }
  contains(obj) { return this.children.indexOf(obj) >= 0; }
  each(fn, ctx) { var c = this.children.slice(); for (var i = 0; i < c.length; i++) fn.call(ctx, c[i], i); return this; }
  setVisible(v) { for (var i = 0; i < this.children.length; i++) this.children[i].visible = v; return this; }
  setAlpha(a) { for (var i = 0; i < this.children.length; i++) this.children[i].alpha = a; return this; }
  setTint(t) { for (var i = 0; i < this.children.length; i++) this.children[i].tint = t; return this; }
  setDepth(d) { for (var i = 0; i < this.children.length; i++) this.children[i].zIndex = d; return this; }
  preUpdate(time, delta) {
    if (!this.runChildUpdate) return;
    var c = this.children;
    for (var i = 0; i < c.length; i++) if (c[i].active && c[i].update) c[i].update(time, delta);
  }
  clear(removeFromScene, destroyChild) {
    var list = this.children.slice(); this.children.length = 0;
    for (var i = 0; i < list.length; i++) { if (destroyChild) list[i].destroy(); else if (removeFromScene) list[i].removeFromParent(); }
    return this;
  }
  destroy(destroyChildren) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clear(false, !!destroyChildren);
    this.off(); this.scene = null; this.container = null;
  }
}

/* ================================================================== DataManager */
class DataManager {
  constructor(owner) { this.owner = owner || null; this.map = new Map(); this.events = owner && owner.emit ? owner : null; }
  set(key, value) {
    if (typeof key === 'object') { var self = this; Object.keys(key).forEach(function (k) { if (!isForbiddenKey(k)) self.set(k, key[k]); }); return this; }
    var had = this.map.has(key), old = this.map.get(key);
    this.map.set(key, value);
    if (this.events) { if (had) this.events.emit('changedata', key, value, old); else this.events.emit('setdata', key, value); this.events.emit('changedata-' + key, value, old); }
    return this;
  }
  get(key) { return this.map.get(key); }
  has(key) { return this.map.has(key); }
  inc(key, amount) { var v = (+this.map.get(key) || 0) + (amount === undefined ? 1 : amount); this.set(key, v); return v; }
  toggle(key) { this.set(key, !this.map.get(key)); return this.map.get(key); }
  remove(key) { var v = this.map.get(key); this.map.delete(key); if (this.events) this.events.emit('removedata', key, v); return this; }
  each(fn) { this.map.forEach(function (v, k) { fn(k, v); }); return this; }
  getAll() { var o = {}; this.map.forEach(function (v, k) { if (!isForbiddenKey(String(k))) o[k] = v; }); return o; }
  reset() { this.map.clear(); return this; }
  destroy() { this.map.clear(); this.owner = null; this.events = null; }
}

UG.BLEND = BLEND;
UG.BlendModes = BLEND;
UG.Bounds = Bounds;
UG.Container = Container;
UG.DisplayObject = Container;
UG.Sprite = Sprite;
UG.Image = Sprite;
UG.AnimatedSprite = AnimatedSprite;
UG.TilingSprite = TilingSprite;
UG.TileSprite = TilingSprite;
UG.NineSlice = NineSlice;
UG.Mesh = Mesh;
UG.Rope = Rope;
UG.Zone = Zone;
UG.Group = Group;
UG.DataManager = DataManager;
