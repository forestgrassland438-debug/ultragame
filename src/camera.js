/* UltraGame - cámaras: scroll, zoom, rotación, límites, seguimiento suave con zona muerta, múltiples cámaras
 * (minimapas, pantalla dividida), efectos (shake, flash, fade, pan, zoomTo, rotateTo) y post-proceso por cámara. */

class Camera extends EventEmitter {
  constructor(manager, x, y, width, height, name) {
    super();
    this.manager = manager; this.scene = manager ? manager.scene : null;
    this.id = 0; this.bit = 0;
    this.name = name || '';
    this.x = x || 0; this.y = y || 0; this.width = width || 800; this.height = height || 600;
    this.scrollX = 0; this.scrollY = 0; this.zoomX = 1; this.zoomY = 1; this.rotation = 0; this.originX = 0.5; this.originY = 0.5;
    this.alpha = 1; this.visible = true;
    this.backgroundColor = null; this.backgroundAlpha = 1;
    this.bounds = null;
    this.roundPixels = false;
    this.matrix = new Matrix(); this._inv = new Matrix();
    this.worldView = new Rectangle();
    this.filters = null;
    this._follow = null; this.lerpX = 1; this.lerpY = 1; this.followOffset = new Vec2(); this.deadzone = null;
    this._shake = null; this._flash = null; this._fade = null; this._pan = null; this._zoom = null; this._rot = null;
    this._fadeHold = null;
    this._autoSize = false;
    this.shakeOffsetX = 0; this.shakeOffsetY = 0;
    this.rng = new RNG('camera');
    Debug.track('Camera', 1);
  }
  get zoom() { return this.zoomX; }
  set zoom(v) { this.zoomX = this.zoomY = Math.max(0.001, v); }
  get centerX() { return this.scrollX + this.width * this.originX; }
  get centerY() { return this.scrollY + this.height * this.originY; }
  get midPoint() { return new Vec2(this.worldView.centerX, this.worldView.centerY); }
  get displayWidth() { return this.width / this.zoomX; }
  get displayHeight() { return this.height / this.zoomY; }
  setViewport(x, y, w, h) { this.x = x; this.y = y; if (w !== undefined) { this.width = w; this.height = h; } this._autoSize = false; return this; }
  setSize(w, h) { this.width = w; this.height = h === undefined ? w : h; this._autoSize = false; return this; }
  setPosition(x, y) { this.x = x; this.y = y === undefined ? x : y; return this; }
  setScroll(x, y) { this.scrollX = x; this.scrollY = y === undefined ? x : y; return this; }
  centerOn(x, y) { this.scrollX = x - this.width * this.originX; this.scrollY = y - this.height * this.originY; return this; }
  centerOnX(x) { this.scrollX = x - this.width * this.originX; return this; }
  centerOnY(y) { this.scrollY = y - this.height * this.originY; return this; }
  centerToBounds() { if (this.bounds) this.centerOn(this.bounds.centerX, this.bounds.centerY); return this; }
  setZoom(x, y) { this.zoomX = Math.max(0.001, x); this.zoomY = Math.max(0.001, y === undefined ? x : y); return this; }
  setRotation(r) { this.rotation = r; return this; }
  setAngle(d) { this.rotation = d * DEG_TO_RAD; return this; }
  setOrigin(x, y) { this.originX = x; this.originY = y === undefined ? x : y; return this; }
  setBounds(x, y, w, h, centerOn) { this.bounds = new Rectangle(x, y, w, h); if (centerOn) this.centerToBounds(); return this; }
  removeBounds() { this.bounds = null; return this; }
  getBounds(out) { return (out || new Rectangle()).copyFrom(this.worldView); }
  setBackgroundColor(c, alpha) {
    if (c === null || c === undefined) { this.backgroundColor = null; return this; }
    this.backgroundColor = Color.toNumber(c); this.backgroundAlpha = alpha !== undefined ? alpha : Color.alphaOf(c); return this;
  }
  setRoundPixels(v) { this.roundPixels = v !== false; return this; }
  setAlpha(a) { this.alpha = a; return this; }
  setVisible(v) { this.visible = !!v; return this; }
  setName(n) { this.name = n; return this; }
  setFilters(f) { this.filters = f ? (Array.isArray(f) ? f.slice() : [f]) : null; return this; }
  addFilter(f) { (this.filters || (this.filters = [])).push(f); return this; }
  removeFilter(f) { if (this.filters) { removeFromArray(this.filters, f); if (!this.filters.length) this.filters = null; } return this; }
  setPostPipeline(f) { return this.setFilters(f); }
  /** Excluye objetos del render de esta cámara (p.ej. HUD en el minimapa). */
  ignore(obj) {
    var self = this;
    if (Array.isArray(obj)) obj.forEach(function (o) { self.ignore(o); });
    else if (obj instanceof Group) obj.children.forEach(function (o) { self.ignore(o); });
    else if (obj) obj.cameraFilter |= this.bit;
    return this;
  }
  /* ---------------- seguimiento ---------------- */
  startFollow(target, roundPixels, lerpX, lerpY, offsetX, offsetY) {
    this._follow = target;
    if (roundPixels !== undefined) this.roundPixels = !!roundPixels;
    this.lerpX = lerpX === undefined ? 1 : lerpX; this.lerpY = lerpY === undefined ? this.lerpX : lerpY;
    this.followOffset.set(offsetX || 0, offsetY || 0);
    this._snapFollow();
    return this;
  }
  stopFollow() { this._follow = null; return this; }
  setLerp(x, y) { this.lerpX = x; this.lerpY = y === undefined ? x : y; return this; }
  setFollowOffset(x, y) { this.followOffset.set(x || 0, y || 0); return this; }
  setDeadzone(w, h) { if (w === undefined) this.deadzone = null; else this.deadzone = new Rectangle(0, 0, w, h); return this; }
  _targetPos() {
    var t = this._follow;
    if (!t || t.destroyed) { this._follow = null; return null; }
    var tx = t.x, ty = t.y;
    if (t.parent && t.parent !== (this.scene && this.scene.world)) { var p = t.parent.toGlobal(t.x, t.y, _tmpVec); tx = p.x; ty = p.y; }
    return { x: tx - this.followOffset.x, y: ty - this.followOffset.y };
  }
  _snapFollow() { var p = this._targetPos(); if (p) this.centerOn(p.x, p.y); }
  _updateFollow(delta) {
    var p = this._targetPos(); if (!p) return;
    var cx = this.scrollX + this.width * this.originX, cy = this.scrollY + this.height * this.originY;
    var desiredX = p.x, desiredY = p.y;
    if (this.deadzone) {
      var hw = this.deadzone.width / 2 / this.zoomX, hh = this.deadzone.height / 2 / this.zoomY;
      desiredX = cx; desiredY = cy;
      if (p.x < cx - hw) desiredX = p.x + hw; else if (p.x > cx + hw) desiredX = p.x - hw;
      if (p.y < cy - hh) desiredY = p.y + hh; else if (p.y > cy + hh) desiredY = p.y - hh;
      this.deadzone.set(cx - hw, cy - hh, hw * 2, hh * 2);
    }
    var k = delta / (1000 / 60);
    var fx = this.lerpX >= 1 ? 1 : 1 - Math.pow(1 - this.lerpX, k), fy = this.lerpY >= 1 ? 1 : 1 - Math.pow(1 - this.lerpY, k);
    this.scrollX += (desiredX - cx) * fx;
    this.scrollY += (desiredY - cy) * fy;
  }
  /* ---------------- efectos ---------------- */
  shake(duration, intensity, force, callback) {
    if (this._shake && !force) return this;
    var ix = intensity === undefined ? 0.01 : (typeof intensity === 'number' ? intensity : intensity.x), iy = intensity === undefined ? ix : (typeof intensity === 'number' ? intensity : intensity.y);
    this._shake = { duration: duration || 100, elapsed: 0, ix: ix, iy: iy, cb: callback || null };
    this.emit('camerashakestart', this);
    return this;
  }
  flash(duration, color, alpha, force, callback) {
    if (this._flash && !force) return this;
    this._flash = { duration: duration || 250, elapsed: 0, color: Color.toNumber(color === undefined ? 0xffffff : color), alpha: alpha === undefined ? 1 : alpha, cb: callback || null };
    this.emit('cameraflashstart', this);
    return this;
  }
  fadeOut(duration, color, force, callback) { return this._fadeFx(-1, duration, color, force, callback); }
  fadeIn(duration, color, force, callback) { return this._fadeFx(1, duration, color, force, callback); }
  fade(duration, color, force, callback) { return this.fadeOut(duration, color, force, callback); }
  fadeFrom(duration, color, force, callback) { return this.fadeIn(duration, color, force, callback); }
  _fadeFx(dir, duration, color, force, callback) {
    if (this._fade && !force) return this;
    if (typeof color === 'function') { callback = color; color = undefined; }
    this._fade = { dir: dir, duration: duration || 500, elapsed: 0, color: Color.toNumber(color === undefined ? 0 : color), cb: callback || null };
    this._fadeHold = null;
    this.emit(dir < 0 ? 'camerafadeoutstart' : 'camerafadeinstart', this);
    return this;
  }
  /** Promesa: await this.cameras.main.fadeOutAsync(400) */
  fadeOutAsync(ms, color) { var self = this; return new Promise(function (r) { self.fadeOut(ms, color, true, function () { r(self); }); }); }
  fadeInAsync(ms, color) { var self = this; return new Promise(function (r) { self.fadeIn(ms, color, true, function () { r(self); }); }); }
  pan(x, y, duration, ease, force, callback) {
    if (this._pan && !force) return this;
    this._pan = { sx: this.centerX, sy: this.centerY, tx: x, ty: y, duration: duration || 1000, elapsed: 0, ease: Easing.get(ease || 'sineInOut'), cb: callback || null };
    return this;
  }
  zoomTo(zoom, duration, ease, force, callback) {
    if (this._zoom && !force) return this;
    this._zoom = { from: this.zoomX, to: zoom, duration: duration || 1000, elapsed: 0, ease: Easing.get(ease || 'sineInOut'), cb: callback || null };
    return this;
  }
  rotateTo(angle, shortest, duration, ease, force, callback) {
    if (this._rot && !force) return this;
    var to = angle;
    if (shortest) to = this.rotation + MathUtils.shortestAngle(this.rotation, angle);
    this._rot = { from: this.rotation, to: to, duration: duration || 1000, elapsed: 0, ease: Easing.get(ease || 'sineInOut'), cb: callback || null };
    return this;
  }
  resetFX() { this._shake = null; this._flash = null; this._fade = null; this._fadeHold = null; this.shakeOffsetX = this.shakeOffsetY = 0; return this; }
  get isShaking() { return !!this._shake; }
  get isFading() { return !!this._fade; }
  update(time, delta) {
    var done;
    if (this._pan) {
      var p = this._pan; p.elapsed += delta; var t = Math.min(1, p.elapsed / p.duration), e = p.ease(t);
      this.centerOn(p.sx + (p.tx - p.sx) * e, p.sy + (p.ty - p.sy) * e);
      if (t >= 1) { done = p.cb; this._pan = null; this.emit('camerapancomplete', this); if (done) done(this); }
    } else if (this._follow) this._updateFollow(delta);
    if (this._zoom) {
      var z = this._zoom; z.elapsed += delta; var tz = Math.min(1, z.elapsed / z.duration);
      this.zoom = z.from + (z.to - z.from) * z.ease(tz);
      if (tz >= 1) { done = z.cb; this._zoom = null; this.emit('camerazoomcomplete', this); if (done) done(this); }
    }
    if (this._rot) {
      var r = this._rot; r.elapsed += delta; var tr = Math.min(1, r.elapsed / r.duration);
      this.rotation = r.from + (r.to - r.from) * r.ease(tr);
      if (tr >= 1) { done = r.cb; this._rot = null; this.emit('camerarotatecomplete', this); if (done) done(this); }
    }
    if (this._shake) {
      var s = this._shake; s.elapsed += delta; var ts = s.elapsed / s.duration;
      if (ts >= 1) { done = s.cb; this._shake = null; this.shakeOffsetX = this.shakeOffsetY = 0; this.emit('camerashakecomplete', this); if (done) done(this); }
      else { var k = 1 - ts; this.shakeOffsetX = (this.rng.float() * 2 - 1) * s.ix * this.width * k; this.shakeOffsetY = (this.rng.float() * 2 - 1) * s.iy * this.height * k; }
    }
    if (this._flash) {
      var f = this._flash; f.elapsed += delta;
      if (f.elapsed >= f.duration) { done = f.cb; this._flash = null; this.emit('cameraflashcomplete', this); if (done) done(this); }
    }
    if (this._fade) {
      var fd = this._fade; fd.elapsed += delta;
      if (fd.elapsed >= fd.duration) {
        done = fd.cb; this._fade = null;
        this._fadeHold = fd.dir < 0 ? { color: fd.color } : null;
        this.emit(fd.dir < 0 ? 'camerafadeoutcomplete' : 'camerafadeincomplete', this);
        if (done) done(this);
      }
    }
  }
  /** Calcula matriz y vista (llamado por el renderer). */
  preRender() {
    var w = this.width, h = this.height, ox = w * this.originX, oy = h * this.originY;
    if (this.bounds) {
      var b = this.bounds, vw = w / this.zoomX, vh = h / this.zoomY;
      var left = this.scrollX + ox * (1 - 1 / this.zoomX), top = this.scrollY + oy * (1 - 1 / this.zoomY);
      if (vw >= b.width) left = b.x + (b.width - vw) / 2; else left = clamp(left, b.x, b.right - vw);
      if (vh >= b.height) top = b.y + (b.height - vh) / 2; else top = clamp(top, b.y, b.bottom - vh);
      this.scrollX = left - ox * (1 - 1 / this.zoomX); this.scrollY = top - oy * (1 - 1 / this.zoomY);
    }
    var m = this.matrix, c = Math.cos(this.rotation), s = Math.sin(this.rotation), zx = this.zoomX, zy = this.zoomY;
    var sx = this.scrollX + ox, sy = this.scrollY + oy;
    m.a = c * zx; m.b = s * zx; m.c = -s * zy; m.d = c * zy;
    m.tx = this.x + ox + this.shakeOffsetX - (m.a * sx + m.c * sy);
    m.ty = this.y + oy + this.shakeOffsetY - (m.b * sx + m.d * sy);
    if (this.roundPixels) { m.tx = Math.round(m.tx); m.ty = Math.round(m.ty); }
    this._inv.copyFrom(m).invert();
    // vista del mundo (AABB)
    var bnd = _tmpBounds.reset(), inv = this._inv;
    var cs = [this.x, this.y, this.x + w, this.y, this.x + w, this.y + h, this.x, this.y + h];
    for (var i = 0; i < 8; i += 2) bnd.addPoint(inv.a * cs[i] + inv.c * cs[i + 1] + inv.tx, inv.b * cs[i] + inv.d * cs[i + 1] + inv.ty);
    this.worldView.set(bnd.minX, bnd.minY, bnd.maxX - bnd.minX, bnd.maxY - bnd.minY);
    return this;
  }
  renderOverlays(r) {
    var a;
    if (this._fade) { var f = this._fade, t = Math.min(1, f.elapsed / f.duration); a = f.dir < 0 ? t : 1 - t; r.fillRect(this.x, this.y, this.width, this.height, f.color, a * this.alpha, 0); }
    else if (this._fadeHold) r.fillRect(this.x, this.y, this.width, this.height, this._fadeHold.color, this.alpha, 0);
    if (this._flash) { var fl = this._flash; a = (1 - Math.min(1, fl.elapsed / fl.duration)) * fl.alpha; r.fillRect(this.x, this.y, this.width, this.height, fl.color, a * this.alpha, 0); }
  }
  /** Pantalla -> mundo */
  getWorldPoint(x, y, out) { this.preRender(); return this._inv.apply(x, y, out || new Vec2()); }
  /** Mundo -> pantalla */
  worldToScreen(x, y, out) { this.preRender(); return this.matrix.apply(x, y, out || new Vec2()); }
  containsPoint(x, y) { return x >= this.x && y >= this.y && x < this.x + this.width && y < this.y + this.height; }
  /** ¿El objeto/rectángulo está en la vista? */
  isInView(objOrRect) { var r = objOrRect instanceof Rectangle ? objOrRect : objOrRect.getBounds(); return this.worldView.intersects(r); }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._follow = null; this.filters = null; this.off();
    if (this.manager) removeFromArray(this.manager.list, this);
    this.manager = null; this.scene = null;
    Debug.track('Camera', -1);
  }
}

class CameraManager {
  constructor(scene) {
    this.scene = scene; this.list = []; this.main = null; this._nextId = 0;
    var g = scene.game;
    var cam = this.add(0, 0, g.width, g.height, true, 'main');
    cam._autoSize = true;
  }
  get default() { return this.main; }
  add(x, y, width, height, makeMain, name) {
    var g = this.scene.game;
    if (this._nextId >= 31) throw new Error('UltraGame: máximo 31 cámaras por escena');
    var cam = new Camera(this, x || 0, y || 0, width === undefined ? g.width : width, height === undefined ? g.height : height, name);
    cam.id = this._nextId++; cam.bit = 1 << cam.id;
    this.list.push(cam);
    if (makeMain || !this.main) this.main = cam;
    return cam;
  }
  addExisting(cam, makeMain) { cam.manager = this; cam.scene = this.scene; cam.id = this._nextId++; cam.bit = 1 << cam.id; this.list.push(cam); if (makeMain) this.main = cam; return cam; }
  remove(cam) { removeFromArray(this.list, cam); if (this.main === cam) this.main = this.list[0] || null; cam.destroy(); return this; }
  getCamera(name) { for (var i = 0; i < this.list.length; i++) if (this.list[i].name === name) return this.list[i]; return null; }
  getCamerasBelowPointer(p) { return this.list.filter(function (c) { return c.visible && c.containsPoint(p.x, p.y); }).reverse(); }
  resize(w, h) { for (var i = 0; i < this.list.length; i++) if (this.list[i]._autoSize) { this.list[i].width = w; this.list[i].height = h; } }
  resetAll() { this.list.slice().forEach(function (c) { c.destroy(); }); this.list.length = 0; this.main = null; this._nextId = 0; var g = this.scene.game; var c = this.add(0, 0, g.width, g.height, true, 'main'); c._autoSize = true; return c; }
  update(time, delta) { for (var i = 0; i < this.list.length; i++) this.list[i].update(time, delta); }
  shutdown() { this.list.slice().forEach(function (c) { c.destroy(); }); this.list.length = 0; this.main = null; }
  destroy() { this.shutdown(); this.scene = null; }
}

UG.Camera = Camera;
UG.CameraManager = CameraManager;
