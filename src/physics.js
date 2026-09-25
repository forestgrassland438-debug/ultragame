/* UltraGame - física Arcade: cuerpos AABB y círculos, gravedad, aceleración, arrastre, rebote, masa,
 * inamovibles y plataformas móviles con fricción, colisión barrida contra tilemaps (sin enganches en bordes
 * internos), plataformas de un sentido, grupos con pool, broadphase por hash espacial y dibujo de depuración.
 * Paso fijo (60 Hz por defecto) => simulación estable y reproducible. */

function makeDirs(v) { return { none: v === undefined ? true : v, up: false, down: false, left: false, right: false }; }
function resetDirs(d, none) { d.none = none; d.up = false; d.down = false; d.left = false; d.right = false; }

class Body {
  constructor(world, gameObject, isStatic) {
    this.world = world;
    this.gameObject = gameObject;
    this.isStatic = !!isStatic;
    this.enable = true;
    this.isCircle = false; this.radius = 0;
    this.sourceWidth = 0; this.sourceHeight = 0;
    this.width = 1; this.height = 1;
    this.offset = new Vec2(0, 0);
    this.position = new Vec2(); this.prev = new Vec2(); this._start = new Vec2();
    this.velocity = new Vec2(); this.acceleration = new Vec2(); this.drag = new Vec2();
    this.maxVelocity = new Vec2(10000, 10000); this.maxSpeed = -1;
    this.bounce = new Vec2(); this.friction = new Vec2(1, 0); this.gravity = new Vec2();
    this.worldBounce = null;
    this.allowGravity = !isStatic; this.allowDrag = true; this.useDamping = false;
    this.immovable = !!isStatic; this.pushable = !isStatic; this.moves = !isStatic; this.mass = 1;
    this.collideWorldBounds = false; this.onWorldBounds = false; this.onCollide = false; this.onOverlap = false;
    this.checkCollision = { none: false, up: true, down: true, left: true, right: true };
    this.touching = makeDirs(); this.wasTouching = makeDirs(); this.blocked = makeDirs();
    this.angularVelocity = 0; this.angularAcceleration = 0; this.angularDrag = 0; this.maxAngular = 1000; this.allowRotation = true;
    this.debugColor = isStatic ? 0x0000ff : 0xff00ff; this.debugShowBody = true; this.debugShowVelocity = true;
    this._goX = NaN; this._goY = NaN; this._customSize = false;
    this._syncSize(); this.resetFromGameObject();
    Debug.track('PhysicsBody', 1);
  }
  get x() { return this.position.x; } set x(v) { this.position.x = v; }
  get y() { return this.position.y; } set y(v) { this.position.y = v; }
  get left() { return this.position.x; }
  get right() { return this.position.x + this.width; }
  get top() { return this.position.y; }
  get bottom() { return this.position.y + this.height; }
  get centerX() { return this.position.x + this.width / 2; }
  get centerY() { return this.position.y + this.height / 2; }
  get halfWidth() { return this.width / 2; }
  get halfHeight() { return this.height / 2; }
  get speed() { return this.velocity.length(); }
  get angle() { return Math.atan2(this.velocity.y, this.velocity.x); }
  deltaX() { return this.position.x - this._start.x; }
  deltaY() { return this.position.y - this._start.y; }
  onFloor() { return this.blocked.down; }
  onCeiling() { return this.blocked.up; }
  onWall() { return this.blocked.left || this.blocked.right; }
  _goDims() {
    var go = this.gameObject, sx = Math.abs(go.scaleX || 1), sy = Math.abs(go.scaleY || 1), w, h;
    if (go._texture && go._texture !== Texture.EMPTY) { w = go._texture.width; h = go._texture.height; }
    else if (go.zoneWidth !== undefined) { w = go.zoneWidth; h = go.zoneHeight; }
    else if (go.shapeWidth !== undefined) { w = go.shapeWidth; h = go.shapeHeight; }
    else if (go._w !== undefined) { w = go._w; h = go._h; }
    else { var lb = go.getLocalBounds ? go.getLocalBounds() : null; w = lb && lb.width ? lb.width : 16; h = lb && lb.height ? lb.height : 16; }
    return { w: w, h: h, sx: sx, sy: sy };
  }
  _syncSize() {
    var d = this._goDims();
    if (!this._customSize) { this.sourceWidth = d.w; this.sourceHeight = d.h; }
    if (this.isCircle) { this.width = this.height = this.radius * 2 * d.sx; }
    else { this.width = this.sourceWidth * d.sx; this.height = this.sourceHeight * d.sy; }
    this._dims = d;
  }
  /** Coloca el cuerpo según la posición del objeto. */
  resetFromGameObject() {
    var go = this.gameObject, d = this._dims || this._goDims();
    var ax = go.anchorX !== undefined ? go.anchorX : (go.originX !== undefined ? go.originX : 0.5), ay = go.anchorY !== undefined ? go.anchorY : (go.originY !== undefined ? go.originY : 0.5);
    var dw = d.w * d.sx, dh = d.h * d.sy;
    this.position.x = go.x - ax * dw + this.offset.x * d.sx;
    this.position.y = go.y - ay * dh + this.offset.y * d.sy;
    if (!this._customSize && !this.isCircle) { this.position.x = go.x - ax * dw + this.offset.x * d.sx; }
    this.prev.copy(this.position); this._start.copy(this.position);
    this._goX = go.x; this._goY = go.y;
  }
  setSize(w, h, center) {
    var d = this._goDims();
    this._customSize = true; this.isCircle = false;
    this.sourceWidth = w; this.sourceHeight = h === undefined ? w : h;
    if (center !== false) this.offset.set((d.w - this.sourceWidth) / 2, (d.h - this.sourceHeight) / 2);
    this._syncSize(); this.resetFromGameObject();
    return this;
  }
  setCircle(radius, offsetX, offsetY) {
    var d = this._goDims();
    this.isCircle = true; this.radius = radius; this._customSize = true;
    this.sourceWidth = this.sourceHeight = radius * 2;
    this.offset.set(offsetX === undefined ? (d.w - radius * 2) / 2 : offsetX, offsetY === undefined ? (d.h - radius * 2) / 2 : offsetY);
    this._syncSize(); this.resetFromGameObject();
    return this;
  }
  setOffset(x, y) { this.offset.set(x, y === undefined ? x : y); this.resetFromGameObject(); return this; }
  setVelocity(x, y) { this.velocity.set(x, y === undefined ? x : y); return this; }
  setVelocityX(x) { this.velocity.x = x; return this; }
  setVelocityY(y) { this.velocity.y = y; return this; }
  setAcceleration(x, y) { this.acceleration.set(x, y === undefined ? x : y); return this; }
  setAccelerationX(x) { this.acceleration.x = x; return this; }
  setAccelerationY(y) { this.acceleration.y = y; return this; }
  setDrag(x, y) { this.drag.set(x, y === undefined ? x : y); return this; }
  setDamping(v) { this.useDamping = v !== false; return this; }
  setBounce(x, y) { this.bounce.set(x, y === undefined ? x : y); return this; }
  setMaxVelocity(x, y) { this.maxVelocity.set(x, y === undefined ? x : y); return this; }
  setMaxSpeed(s) { this.maxSpeed = s; return this; }
  setGravity(x, y) { this.gravity.set(x, y === undefined ? x : y); return this; }
  setGravityY(y) { this.gravity.y = y; return this; }
  setAllowGravity(v) { this.allowGravity = v !== false; return this; }
  setImmovable(v) { this.immovable = v !== false; return this; }
  setPushable(v) { this.pushable = v !== false; return this; }
  setMass(m) { this.mass = Math.max(0.0001, m); return this; }
  setFriction(x, y) { this.friction.set(x, y === undefined ? 0 : y); return this; }
  setCollideWorldBounds(v, bx, by, onWorldBounds) { this.collideWorldBounds = v !== false; if (bx !== undefined) this.worldBounce = new Vec2(bx, by === undefined ? bx : by); if (onWorldBounds !== undefined) this.onWorldBounds = !!onWorldBounds; return this; }
  setEnable(v) { this.enable = v !== false; return this; }
  setAngularVelocity(v) { this.angularVelocity = v; return this; }
  setAllowRotation(v) { this.allowRotation = v !== false; return this; }
  stop() { this.velocity.set(0, 0); this.acceleration.set(0, 0); this.angularVelocity = 0; return this; }
  /** Reposiciona el cuerpo (y el objeto) en x,y y detiene su movimiento. */
  reset(x, y) {
    var go = this.gameObject;
    if (x !== undefined) { go.x = x; go.y = y; }
    this.enable = true;
    this.stop();
    this._syncSize(); this.resetFromGameObject();
    resetDirs(this.blocked, true); resetDirs(this.touching, true);
    return this;
  }
  /** Para cuerpos estáticos: sincroniza tras mover/escalar el objeto. */
  refreshBody() { this._syncSize(); this.resetFromGameObject(); if (this.world) this.world._staticDirty = true; return this; }
  updateFromGameObject() { return this.refreshBody(); }
  preUpdate() {
    var go = this.gameObject;
    this.wasTouching.none = this.touching.none; this.wasTouching.up = this.touching.up; this.wasTouching.down = this.touching.down; this.wasTouching.left = this.touching.left; this.wasTouching.right = this.touching.right;
    resetDirs(this.touching, true); resetDirs(this.blocked, true);
    if (!this._dims || go.scaleX !== this._lastSX || go.scaleY !== this._lastSY) { this._syncSize(); this._lastSX = go.scaleX; this._lastSY = go.scaleY; }
    if (go.x !== this._goX || go.y !== this._goY) this.resetFromGameObject();
    this.prev.copy(this.position); this._start.copy(this.position);
    this._rot0 = go.rotation;
  }
  update(dt) {
    if (!this.moves) return;
    var w = this.world, v = this.velocity, a = this.acceleration;
    var gx = this.allowGravity ? w.gravity.x + this.gravity.x : this.gravity.x;
    var gy = this.allowGravity ? w.gravity.y + this.gravity.y : this.gravity.y;
    v.x += (a.x + gx) * dt; v.y += (a.y + gy) * dt;
    if (this.allowDrag) {
      if (this.useDamping) {
        if (this.drag.x > 0) v.x *= Math.pow(this.drag.x, dt);
        if (this.drag.y > 0) v.y *= Math.pow(this.drag.y, dt);
      } else {
        if (a.x === 0 && this.drag.x > 0) { var dx = this.drag.x * dt; v.x = Math.abs(v.x) <= dx ? 0 : v.x - Math.sign(v.x) * dx; }
        if (a.y === 0 && this.drag.y > 0) { var dy = this.drag.y * dt; v.y = Math.abs(v.y) <= dy ? 0 : v.y - Math.sign(v.y) * dy; }
      }
    }
    v.x = clamp(v.x, -this.maxVelocity.x, this.maxVelocity.x);
    v.y = clamp(v.y, -this.maxVelocity.y, this.maxVelocity.y);
    if (this.maxSpeed > 0) { var sp = Math.sqrt(v.x * v.x + v.y * v.y); if (sp > this.maxSpeed) { v.x *= this.maxSpeed / sp; v.y *= this.maxSpeed / sp; } }
    this.position.x += v.x * dt; this.position.y += v.y * dt;
    if (this.allowRotation) {
      this.angularVelocity += this.angularAcceleration * dt;
      if (this.angularDrag > 0 && this.angularAcceleration === 0) { var ad = this.angularDrag * dt; this.angularVelocity = Math.abs(this.angularVelocity) <= ad ? 0 : this.angularVelocity - Math.sign(this.angularVelocity) * ad; }
      this.angularVelocity = clamp(this.angularVelocity, -this.maxAngular, this.maxAngular);
    }
    if (this.collideWorldBounds) this._checkWorldBounds();
  }
  _checkWorldBounds() {
    var b = this.world.bounds, cc = this.world.checkCollision, p = this.position, v = this.velocity;
    var bx = this.worldBounce ? this.worldBounce.x : this.bounce.x, by = this.worldBounce ? this.worldBounce.y : this.bounce.y;
    var hit = false, up = false, down = false, left = false, right = false;
    if (p.x < b.x && cc.left) { p.x = b.x; v.x = Math.abs(v.x) * bx; this.blocked.left = true; hit = left = true; }
    else if (p.x + this.width > b.x + b.width && cc.right) { p.x = b.x + b.width - this.width; v.x = -Math.abs(v.x) * bx; this.blocked.right = true; hit = right = true; }
    if (p.y < b.y && cc.up) { p.y = b.y; v.y = Math.abs(v.y) * by; this.blocked.up = true; hit = up = true; }
    else if (p.y + this.height > b.y + b.height && cc.down) { p.y = b.y + b.height - this.height; v.y = -Math.abs(v.y) * by; this.blocked.down = true; hit = down = true; }
    if (hit) { this.blocked.none = false; if (this.onWorldBounds) this.world.emit('worldbounds', this, up, down, left, right); }
  }
  postUpdate() {
    var go = this.gameObject;
    var dx = this.position.x - this._start.x, dy = this.position.y - this._start.y;
    go.x += dx; go.y += dy;
    if (this.allowRotation && this.angularVelocity) go.rotation = this._rot0 + this.angularVelocity * this.world._lastDt * DEG_TO_RAD;
    this._goX = go.x; this._goY = go.y;
  }
  hitTest(x, y) {
    if (this.isCircle) { var dx = x - this.centerX, dy = y - this.centerY, r = this.width / 2; return dx * dx + dy * dy <= r * r; }
    return x >= this.position.x && x < this.right && y >= this.position.y && y < this.bottom;
  }
  destroy() {
    if (!this.world) return;
    this.world._removeBody(this);
    if (this.gameObject && this.gameObject.body === this) this.gameObject.body = null;
    this.world = null; this.gameObject = null; this.enable = false;
    Debug.track('PhysicsBody', -1);
  }
}

/* ============================================================ SpatialHash */
class SpatialHash {
  constructor(cell) { this.cell = cell || 128; this.map = new Map(); this.used = []; this._pool = []; this._stamp = 0; }
  clear() { for (var i = 0; i < this.used.length; i++) { var a = this.map.get(this.used[i]); a.length = 0; } this.used.length = 0; }
  _key(cx, cy) { return (cx + 32768) * 65536 + (cy + 32768); }
  insert(body) {
    var c = this.cell, x0 = Math.floor(body.position.x / c), y0 = Math.floor(body.position.y / c), x1 = Math.floor(body.right / c), y1 = Math.floor(body.bottom / c);
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var k = this._key(x, y), a = this.map.get(k);
      if (!a) { a = []; this.map.set(k, a); }
      if (!a.length) this.used.push(k);
      a.push(body);
    }
  }
  query(body, out) {
    var c = this.cell, x0 = Math.floor(body.position.x / c), y0 = Math.floor(body.position.y / c), x1 = Math.floor(body.right / c), y1 = Math.floor(body.bottom / c);
    var stamp = ++this._stamp;
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var a = this.map.get(this._key(x, y)); if (!a) continue;
      for (var i = 0; i < a.length; i++) { var b = a[i]; if (b._qs !== stamp) { b._qs = stamp; out.push(b); } }
    }
    return out;
  }
}

/* =============================================================== Collider */
class Collider {
  constructor(world, overlapOnly, a, b, collideCb, processCb, ctx) {
    this.world = world; this.overlapOnly = overlapOnly; this.object1 = a; this.object2 = b;
    this.collideCallback = collideCb || null; this.processCallback = processCb || null; this.callbackContext = ctx;
    this.active = true; this.name = '';
  }
  setName(n) { this.name = n; return this; }
  update() { if (this.active) this.world.collideObjects(this.object1, this.object2, this.collideCallback, this.processCallback, this.callbackContext, this.overlapOnly); }
  destroy() { if (this.world) removeFromArray(this.world.colliders, this); this.world = null; this.active = false; this.object1 = this.object2 = null; this.collideCallback = this.processCallback = null; }
}

/* ================================================================ World */
class ArcadeWorld extends EventEmitter {
  constructor(scene, config) {
    super();
    config = config || {};
    this.scene = scene;
    var g = config.gravity || {};
    this.gravity = new Vec2(g.x || 0, g.y || 0);
    var gw = scene && scene.game ? scene.game.width : 800, gh = scene && scene.game ? scene.game.height : 600;
    var bd = config.bounds;
    this.bounds = bd ? new Rectangle(bd.x || 0, bd.y || 0, bd.width, bd.height) : new Rectangle(0, 0, gw, gh);
    this.checkCollision = { up: true, down: true, left: true, right: true };
    this.fps = config.fps || 60;
    this.fixedStep = config.fixedStep !== false;
    this.maxSubSteps = config.maxSubSteps || 5;
    this.timeScale = config.timeScale || 1;
    this.isPaused = false;
    this.OVERLAP_BIAS = config.overlapBias || 4;
    this.TILE_EPS = 0.001;
    this.bodies = [];
    this.staticBodies = [];
    this.colliders = [];
    this._acc = 0; this._lastDt = 1 / this.fps;
    this._hash = new SpatialHash(config.cellSize || 128);
    this._staticHash = new SpatialHash(config.cellSize || 128);
    this._staticDirty = true;
    this._tmpList = []; this._tmpList2 = []; this._tileCand = [];
    this.drawDebug = !!config.debug;
    this.debugGraphic = null;
    this.stepCount = 0;
  }
  setBounds(x, y, w, h, left, right, up, down) {
    this.bounds.set(x, y, w, h);
    if (left !== undefined) this.setBoundsCollision(left, right, up, down);
    return this;
  }
  setBoundsCollision(left, right, up, down) { this.checkCollision.left = left !== false; this.checkCollision.right = right !== false; this.checkCollision.up = up !== false; this.checkCollision.down = down !== false; return this; }
  /** Envuelve objetos (o grupos/arrays) que salen de los límites del mundo al lado opuesto (estilo Asteroids). */
  wrap(target, padding) {
    var p = padding || 0, b = this.bounds, self = this;
    if (!target) return this;
    if (target instanceof Group) target = target.children;
    if (Array.isArray(target)) { for (var i = 0; i < target.length; i++) self.wrap(target[i], p); return this; }
    if (target.destroyed || target.active === false) return this;
    var x = target.x, y = target.y;
    if (x < b.x - p) target.x = b.right + p - (b.x - p - x); else if (x > b.right + p) target.x = b.x - p + (x - b.right - p);
    if (y < b.y - p) target.y = b.bottom + p - (b.y - p - y); else if (y > b.bottom + p) target.y = b.y - p + (y - b.bottom - p);
    return this;
  }
  setGravity(x, y) { this.gravity.set(x, y); return this; }
  setFPS(fps) { this.fps = fps; return this; }
  pause() { this.isPaused = true; this.emit('pause'); return this; }
  resume() { this.isPaused = false; this.emit('resume'); return this; }
  /** Añade cuerpo(s) de física a objeto(s). */
  enable(obj, isStatic) {
    if (!obj) return obj;
    if (Array.isArray(obj)) { for (var i = 0; i < obj.length; i++) this.enable(obj[i], isStatic); return obj; }
    if (obj instanceof Group) { var self = this; obj.children.forEach(function (c) { self.enable(c, isStatic); }); return obj; }
    if (obj.body && obj.body.world) return obj;
    var body = new Body(this, obj, isStatic);
    obj.body = body;
    if (isStatic) { this.staticBodies.push(body); this._staticDirty = true; } else this.bodies.push(body);
    return obj;
  }
  disable(obj) { if (obj && obj.body) obj.body.enable = false; return this; }
  _removeBody(b) {
    if (b.isStatic) { var i = this.staticBodies.indexOf(b); if (i >= 0) { this.staticBodies.splice(i, 1); this._staticDirty = true; } }
    else { var j = this.bodies.indexOf(b); if (j >= 0) this.bodies.splice(j, 1); }
  }
  collider(a, b, collideCb, processCb, ctx) { var c = new Collider(this, false, a, b, collideCb, processCb, ctx); this.colliders.push(c); return c; }
  overlapCollider(a, b, cb, processCb, ctx) { var c = new Collider(this, true, a, b, cb, processCb, ctx); this.colliders.push(c); return c; }
  removeCollider(c) { c.destroy(); return this; }
  update(time, delta) {
    if (this.isPaused) return;
    var step = 1 / this.fps;
    if (!this.fixedStep) { this.step(Math.min(delta / 1000, 0.1) * this.timeScale); return; }
    this._acc += delta / 1000 * this.timeScale;
    var n = 0;
    while (this._acc >= step && n < this.maxSubSteps) { this.step(step); this._acc -= step; n++; }
    if (n >= this.maxSubSteps && this._acc > step) this._acc = 0;
  }
  step(dt) {
    this._lastDt = dt;
    var bodies = this.bodies, i, b;
    for (i = bodies.length - 1; i >= 0; i--) {
      b = bodies[i];
      if (!b.gameObject || b.gameObject.destroyed) { b.destroy(); continue; }
    }
    for (i = 0; i < bodies.length; i++) { b = bodies[i]; if (b.enable && b.gameObject.active !== false) b.preUpdate(); }
    for (i = 0; i < bodies.length; i++) { b = bodies[i]; if (b.enable && b.gameObject.active !== false) b.update(dt); }
    var cols = this.colliders;
    for (i = 0; i < cols.length; i++) {
      var c = cols[i];
      if (!c.active) continue;
      if ((c.object1 && c.object1.destroyed) || (c.object2 && c.object2.destroyed)) { c.destroy(); i--; continue; }
      c.update();
    }
    for (i = 0; i < bodies.length; i++) { b = bodies[i]; if (b.enable && b.gameObject && b.gameObject.active !== false) b.postUpdate(); }
    this.stepCount++;
    this.emit('worldstep', dt);
    if (this.drawDebug) this.renderDebug();
  }
  /* ---------- resolución de pares ---------- */
  _bodiesOf(obj, out) {
    out.length = 0;
    if (!obj) return out;
    if (obj instanceof TilemapLayer) return out;
    if (Array.isArray(obj)) { for (var i = 0; i < obj.length; i++) { var o = obj[i]; if (o && o.body && o.body.enable && o.active !== false && !o.destroyed) out.push(o.body); } return out; }
    if (obj instanceof Group) { var ch = obj.children; for (var j = 0; j < ch.length; j++) { var c = ch[j]; if (c.body && c.body.enable && c.active !== false && !c.destroyed) out.push(c.body); } return out; }
    if (obj instanceof Body) { if (obj.enable) out.push(obj); return out; }
    if (obj.body && obj.body.enable && obj.active !== false && !obj.destroyed) out.push(obj.body);
    return out;
  }
  /** Ejecuta colisión/solapamiento inmediato entre a y b. Devuelve true si hubo contacto. */
  collide(a, b, cb, processCb, ctx) { return this.collideObjects(a, b, cb, processCb, ctx, false); }
  overlap(a, b, cb, processCb, ctx) { return this.collideObjects(a, b === undefined ? a : b, cb, processCb, ctx, true); }
  collideObjects(a, b, cb, processCb, ctx, overlapOnly) {
    var hit = false;
    if (a instanceof TilemapLayer && !(b instanceof TilemapLayer)) { var t = a; a = b; b = t; }
    if (b instanceof TilemapLayer) {
      var list = this._bodiesOf(a, this._tmpList).slice();
      for (var i = 0; i < list.length; i++) if (this.collideTiles(list[i], b, cb, processCb, ctx, overlapOnly)) hit = true;
      return hit;
    }
    var A = this._bodiesOf(a, this._tmpList).slice();
    var B = b === a ? A : this._bodiesOf(b, this._tmpList2).slice();
    if (!A.length || !B.length) return false;
    var same = A === B;
    if (A.length * B.length > 256) {
      var hash = this._hash; hash.clear();
      for (var k = 0; k < B.length; k++) { hash.insert(B[k]); B[k]._pairIdx = k; }
      var cand = [];
      for (var m = 0; m < A.length; m++) {
        cand.length = 0; hash.query(A[m], cand);
        for (var n = 0; n < cand.length; n++) {
          if (cand[n] === A[m]) continue;
          if (same && cand[n]._pairIdx <= m) continue; // cada par una sola vez
          if (this._pair(A[m], cand[n], cb, processCb, ctx, overlapOnly)) hit = true;
        }
      }
      return hit;
    }
    for (var p = 0; p < A.length; p++) {
      for (var q = same ? p + 1 : 0; q < B.length; q++) {
        if (A[p] === B[q]) continue;
        if (this._pair(A[p], B[q], cb, processCb, ctx, overlapOnly)) hit = true;
      }
    }
    return hit;
  }
  _pair(b1, b2, cb, processCb, ctx, overlapOnly) {
    if (!b1.enable || !b2.enable || !b1.gameObject || !b2.gameObject) return false;
    if (!this.intersects(b1, b2)) return false;
    if (processCb && !processCb.call(ctx, b1.gameObject, b2.gameObject)) return false;
    var res = overlapOnly ? true : this.separate(b1, b2);
    if (res) {
      if (cb) cb.call(ctx, b1.gameObject, b2.gameObject);
      if (overlapOnly ? (b1.onOverlap || b2.onOverlap) : (b1.onCollide || b2.onCollide)) this.emit(overlapOnly ? 'overlap' : 'collide', b1.gameObject, b2.gameObject, b1, b2);
    }
    return res;
  }
  intersects(b1, b2) {
    if (b1.isCircle && b2.isCircle) {
      var dx = b1.centerX - b2.centerX, dy = b1.centerY - b2.centerY, r = b1.width / 2 + b2.width / 2;
      return dx * dx + dy * dy < r * r;
    }
    if (b1.isCircle || b2.isCircle) {
      var c = b1.isCircle ? b1 : b2, rb = b1.isCircle ? b2 : b1;
      var cx = clamp(c.centerX, rb.left, rb.right), cy = clamp(c.centerY, rb.top, rb.bottom), ex = c.centerX - cx, ey = c.centerY - cy, rr = c.width / 2;
      return ex * ex + ey * ey < rr * rr;
    }
    return b1.right > b2.left && b1.left < b2.right && b1.bottom > b2.top && b1.top < b2.bottom;
  }
  separate(b1, b2) {
    if (b1.isCircle || b2.isCircle) return this._separateCircle(b1, b2);
    var ox1 = b1.prev.x + b1.width > b2.prev.x && b1.prev.x < b2.prev.x + b2.width;
    var oy1 = b1.prev.y + b1.height > b2.prev.y && b1.prev.y < b2.prev.y + b2.height;
    var ovX = Math.min(b1.right - b2.left, b2.right - b1.left), ovY = Math.min(b1.bottom - b2.top, b2.bottom - b1.top);
    var r;
    if (ox1 && !oy1) r = this._sepY(b1, b2) || this._sepX(b1, b2);
    else if (oy1 && !ox1) r = this._sepX(b1, b2) || this._sepY(b1, b2);
    else r = ovX < ovY ? (this._sepX(b1, b2) || this._sepY(b1, b2)) : (this._sepY(b1, b2) || this._sepX(b1, b2));
    return r;
  }
  _fixed(b) { return b.immovable || !b.pushable || !b.moves; }
  _sepX(b1, b2) {
    var left = b1.centerX < b2.centerX;
    var ov = left ? b1.right - b2.left : b2.right - b1.left;
    if (ov <= 0) return false;
    if (left ? (!b1.checkCollision.right || !b2.checkCollision.left) : (!b1.checkCollision.left || !b2.checkCollision.right)) return false;
    var v1 = b1.velocity.x, v2 = b2.velocity.x, f1 = this._fixed(b1), f2 = this._fixed(b2);
    if (f1 && f2) return false;
    b1.touching.none = false; b2.touching.none = false;
    if (left) { b1.touching.right = true; b2.touching.left = true; } else { b1.touching.left = true; b2.touching.right = true; }
    var dir = left ? -1 : 1;
    var approaching = left ? v1 - v2 > 0 : v2 - v1 > 0;
    if (!f1 && !f2) {
      var m1 = b1.mass, m2 = b2.mass, t = m1 + m2;
      b1.position.x += dir * ov * m2 / t; b2.position.x -= dir * ov * m1 / t;
      if (approaching) {
        var p = m1 * v1 + m2 * v2;
        b1.velocity.x = (p + m2 * b1.bounce.x * (v2 - v1)) / t;
        b2.velocity.x = (p + m1 * b2.bounce.x * (v1 - v2)) / t;
      }
    } else if (!f1) {
      b1.position.x += dir * ov;
      if (approaching) b1.velocity.x = v2 - (v1 - v2) * b1.bounce.x;
      if (left) b1.blocked.right = true; else b1.blocked.left = true;
      b1.blocked.none = false;
    } else {
      b2.position.x -= dir * ov;
      if (approaching) b2.velocity.x = v1 - (v2 - v1) * b2.bounce.x;
      if (left) b2.blocked.left = true; else b2.blocked.right = true;
      b2.blocked.none = false;
    }
    return true;
  }
  _sepY(b1, b2) {
    var above = b1.centerY < b2.centerY;
    var ov = above ? b1.bottom - b2.top : b2.bottom - b1.top;
    if (ov <= 0) return false;
    if (above ? (!b1.checkCollision.down || !b2.checkCollision.up) : (!b1.checkCollision.up || !b2.checkCollision.down)) return false;
    var v1 = b1.velocity.y, v2 = b2.velocity.y, f1 = this._fixed(b1), f2 = this._fixed(b2);
    if (f1 && f2) return false;
    b1.touching.none = false; b2.touching.none = false;
    if (above) { b1.touching.down = true; b2.touching.up = true; } else { b1.touching.up = true; b2.touching.down = true; }
    var dir = above ? -1 : 1;
    var approaching = above ? v1 - v2 > 0 : v2 - v1 > 0;
    if (!f1 && !f2) {
      var m1 = b1.mass, m2 = b2.mass, t = m1 + m2;
      b1.position.y += dir * ov * m2 / t; b2.position.y -= dir * ov * m1 / t;
      if (approaching) {
        var p = m1 * v1 + m2 * v2;
        b1.velocity.y = (p + m2 * b1.bounce.y * (v2 - v1)) / t;
        b2.velocity.y = (p + m1 * b2.bounce.y * (v1 - v2)) / t;
      }
    } else if (!f1) {
      b1.position.y += dir * ov;
      if (approaching) b1.velocity.y = v2 - (v1 - v2) * b1.bounce.y;
      if (above) { b1.blocked.down = true; if (b2.moves && b2.friction.x) b1.position.x += b2.deltaX() * b2.friction.x; }
      else b1.blocked.up = true;
      b1.blocked.none = false;
    } else {
      b2.position.y -= dir * ov;
      if (approaching) b2.velocity.y = v1 - (v2 - v1) * b2.bounce.y;
      if (!above) { b2.blocked.down = true; if (b1.moves && b1.friction.x) b2.position.x += b1.deltaX() * b1.friction.x; }
      else b2.blocked.up = true;
      b2.blocked.none = false;
    }
    return true;
  }
  _separateCircle(b1, b2) {
    var c1x = b1.centerX, c1y = b1.centerY, c2x = b2.centerX, c2y = b2.centerY, nx, ny, pen;
    if (b1.isCircle && b2.isCircle) {
      var dx = c1x - c2x, dy = c1y - c2y, dist = Math.sqrt(dx * dx + dy * dy), rs = b1.width / 2 + b2.width / 2;
      if (dist >= rs) return false;
      if (dist === 0) { nx = 1; ny = 0; } else { nx = dx / dist; ny = dy / dist; }
      pen = rs - dist;
    } else {
      var circ = b1.isCircle ? b1 : b2, box = b1.isCircle ? b2 : b1, ccx = circ.centerX, ccy = circ.centerY, r = circ.width / 2;
      var px = clamp(ccx, box.left, box.right), py = clamp(ccy, box.top, box.bottom), ex = ccx - px, ey = ccy - py, d2 = ex * ex + ey * ey;
      if (d2 >= r * r) return false;
      if (d2 > 0) { var d = Math.sqrt(d2); nx = ex / d; ny = ey / d; pen = r - d; }
      else {
        var l = ccx - box.left, rr = box.right - ccx, t = ccy - box.top, bt = box.bottom - ccy, mn = Math.min(l, rr, t, bt);
        if (mn === l) { nx = -1; ny = 0; } else if (mn === rr) { nx = 1; ny = 0; } else if (mn === t) { nx = 0; ny = -1; } else { nx = 0; ny = 1; }
        pen = mn + r;
      }
      if (circ === b2) { nx = -nx; ny = -ny; }
    }
    // n apunta de b2 hacia b1
    var f1 = this._fixed(b1), f2 = this._fixed(b2);
    if (f1 && f2) return false;
    var im1 = f1 ? 0 : 1 / b1.mass, im2 = f2 ? 0 : 1 / b2.mass, sum = im1 + im2;
    b1.position.x += nx * pen * im1 / sum; b1.position.y += ny * pen * im1 / sum;
    b2.position.x -= nx * pen * im2 / sum; b2.position.y -= ny * pen * im2 / sum;
    var rvx = b1.velocity.x - b2.velocity.x, rvy = b1.velocity.y - b2.velocity.y, vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      var e = Math.max(f1 ? 0 : (b1.bounce.x + b1.bounce.y) / 2, f2 ? 0 : (b2.bounce.x + b2.bounce.y) / 2);
      var j = -(1 + e) * vn / sum;
      b1.velocity.x += j * im1 * nx; b1.velocity.y += j * im1 * ny;
      b2.velocity.x -= j * im2 * nx; b2.velocity.y -= j * im2 * ny;
    }
    b1.touching.none = false; b2.touching.none = false;
    if (ny < -0.5) { b1.touching.down = true; b2.touching.up = true; if (f2) b1.blocked.down = true; }
    else if (ny > 0.5) { b1.touching.up = true; b2.touching.down = true; if (f1) b2.blocked.down = true; }
    if (nx < -0.5) { b1.touching.right = true; b2.touching.left = true; } else if (nx > 0.5) { b1.touching.left = true; b2.touching.right = true; }
    return true;
  }
  /* ---------- tiles ---------- */
  collideTiles(body, layer, cb, processCb, ctx, overlapOnly) {
    if (!body.enable || !layer || layer.destroyed || !layer.visible && layer.collideWhenHidden === false) return false;
    var m = layer.getWorldMatrix(_tmpMatrix3);
    var sxl = m.a || 1, syl = m.d || 1, lx = m.tx, ly = m.ty;
    var tw = layer.tileWidth * sxl, th = layer.tileHeight * syl;
    var p = body.position, pv = body.prev, W = body.width, H = body.height;
    var minX = Math.min(p.x, pv.x), minY = Math.min(p.y, pv.y), maxX = Math.max(p.x, pv.x) + W, maxY = Math.max(p.y, pv.y) + H;
    var tx0 = Math.floor((minX - lx) / tw) - 1, ty0 = Math.floor((minY - ly) / th) - 1, tx1 = Math.floor((maxX - lx) / tw) + 1, ty1 = Math.floor((maxY - ly) / th) + 1;
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 4096) { tx1 = tx0 + 63; ty1 = ty0 + 63; }
    var cand = this._tileCand; cand.length = 0;
    for (var ty = ty0; ty <= ty1; ty++) for (var tx = tx0; tx <= tx1; tx++) { var f = layer.collidesAt(tx, ty); if (f) cand.push(tx, ty, f); }
    if (!cand.length) return false;
    var hit = false, eps = this.TILE_EPS, guard = 0;
    var ignored = null;
    while (guard++ < 6) {
      var best = -1, bestT = Infinity, bestAxis = 0, bestDir = 0;
      var dxm = p.x - pv.x, dym = p.y - pv.y;
      for (var i = 0; i < cand.length; i += 3) {
        if (ignored && ignored.has(i)) continue;
        var cx = cand[i], cy = cand[i + 1], fl = cand[i + 2];
        var x0 = lx + cx * tw, y0 = ly + cy * th, x1 = x0 + tw, y1 = y0 + th;
        if (!(p.x + W > x0 + eps && p.x < x1 - eps && p.y + H > y0 + eps && p.y < y1 - eps)) continue;
        if (overlapOnly) { best = i; bestAxis = 0; break; }
        var faceUp = layer.collidesAt(cx, cy - 1) !== 1, faceDown = fl === 1 && !layer.collidesAt(cx, cy + 1), faceLeft = fl === 1 && !layer.collidesAt(cx - 1, cy), faceRight = fl === 1 && !layer.collidesAt(cx + 1, cy);
        var tY = Infinity, dY = 0, tX = Infinity, dX = 0;
        if (faceUp && body.checkCollision.down && pv.y + H <= y0 + eps * 10 + 0.01 && dym >= 0) { tY = dym > 0 ? (y0 - (pv.y + H)) / dym : 0; dY = 1; }
        else if (faceDown && body.checkCollision.up && pv.y >= y1 - eps * 10 - 0.01 && dym <= 0) { tY = dym < 0 ? (pv.y - y1) / -dym : 0; dY = -1; }
        if (faceLeft && body.checkCollision.right && pv.x + W <= x0 + eps * 10 + 0.01 && dxm >= 0) { tX = dxm > 0 ? (x0 - (pv.x + W)) / dxm : 0; dX = 1; }
        else if (faceRight && body.checkCollision.left && pv.x >= x1 - eps * 10 - 0.01 && dxm <= 0) { tX = dxm < 0 ? (pv.x - x1) / -dxm : 0; dX = -1; }
        var axis = 0, dir = 0, t = Infinity;
        if (dY && dX) { if (tX > tY) { axis = 1; dir = dX; t = tX; } else { axis = 2; dir = dY; t = tY; } }
        else if (dY) { axis = 2; dir = dY; t = tY; }
        else if (dX) { axis = 1; dir = dX; t = tX; }
        else if (fl === 1) {
          // incrustado: salir por la cara interesante de menor penetración
          var pu = faceUp ? p.y + H - y0 : Infinity, pd = faceDown ? y1 - p.y : Infinity, pl = faceLeft ? p.x + W - x0 : Infinity, pr = faceRight ? x1 - p.x : Infinity;
          var mn = Math.min(pu, pd, pl, pr);
          if (mn === Infinity) continue;
          t = -1;
          if (mn === pu) { axis = 2; dir = 1; } else if (mn === pd) { axis = 2; dir = -1; } else if (mn === pl) { axis = 1; dir = 1; } else { axis = 1; dir = -1; }
        } else continue;
        if (t < bestT) { bestT = t; best = i; bestAxis = axis; bestDir = dir; }
      }
      if (best < 0) break;
      var bx = cand[best], by = cand[best + 1];
      var tile = null;
      if (processCb || cb) tile = layer.getTileAt(bx, by, true);
      if (processCb && !processCb.call(ctx, body.gameObject, tile)) { (ignored || (ignored = new Set())).add(best); continue; }
      if (overlapOnly) { hit = true; if (cb) cb.call(ctx, body.gameObject, tile); (ignored || (ignored = new Set())).add(best); continue; }
      var X0 = lx + bx * tw, Y0 = ly + by * th;
      var v = body.velocity;
      if (bestAxis === 2) {
        if (bestDir === 1) { p.y = Y0 - H; if (v.y > 0) v.y = -v.y * body.bounce.y; body.blocked.down = true; body.touching.down = true; }
        else { p.y = Y0 + th; if (v.y < 0) v.y = -v.y * body.bounce.y; body.blocked.up = true; body.touching.up = true; }
        if (Math.abs(v.y) < 1) v.y = 0;
      } else {
        if (bestDir === 1) { p.x = X0 - W; if (v.x > 0) v.x = -v.x * body.bounce.x; body.blocked.right = true; body.touching.right = true; }
        else { p.x = X0 + tw; if (v.x < 0) v.x = -v.x * body.bounce.x; body.blocked.left = true; body.touching.left = true; }
      }
      body.blocked.none = false; body.touching.none = false;
      hit = true;
      if (cb) cb.call(ctx, body.gameObject, tile);
    }
    return hit;
  }
  /* ---------- utilidades ---------- */
  overlapRect(x, y, w, h, includeDynamic, includeStatic) {
    var out = [], r = new Rectangle(x, y, w, h);
    var test = function (b) { if (b.enable && b.right > r.x && b.left < r.right && b.bottom > r.y && b.top < r.bottom) out.push(b); };
    if (includeDynamic !== false) this.bodies.forEach(test);
    if (includeStatic) this.staticBodies.forEach(test);
    return out;
  }
  overlapCirc(x, y, radius, includeDynamic, includeStatic) {
    var out = [];
    var test = function (b) { if (!b.enable) return; var cx = clamp(x, b.left, b.right), cy = clamp(y, b.top, b.bottom), dx = x - cx, dy = y - cy; if (dx * dx + dy * dy <= radius * radius) out.push(b); };
    if (includeDynamic !== false) this.bodies.forEach(test);
    if (includeStatic) this.staticBodies.forEach(test);
    return out;
  }
  closest(source, targets) {
    var list = targets || this.bodies.map(function (b) { return b.gameObject; }), best = null, bd = Infinity;
    for (var i = 0; i < list.length; i++) { var t = list[i]; if (!t || t === source || t.active === false) continue; var d = MathUtils.distanceSq(source.x, source.y, t.x, t.y); if (d < bd) { bd = d; best = t; } }
    return best;
  }
  furthest(source, targets) {
    var list = targets || this.bodies.map(function (b) { return b.gameObject; }), best = null, bd = -1;
    for (var i = 0; i < list.length; i++) { var t = list[i]; if (!t || t === source || t.active === false) continue; var d = MathUtils.distanceSq(source.x, source.y, t.x, t.y); if (d > bd) { bd = d; best = t; } }
    return best;
  }
  velocityFromAngle(angleDeg, speed, out) { out = out || new Vec2(); var r = angleDeg * DEG_TO_RAD; return out.set(Math.cos(r) * speed, Math.sin(r) * speed); }
  velocityFromRotation(rad, speed, out) { out = out || new Vec2(); return out.set(Math.cos(rad) * speed, Math.sin(rad) * speed); }
  /** Mueve hacia (x,y) a una velocidad (px/s) o para llegar en maxTime ms. Devuelve el ángulo. */
  moveTo(obj, x, y, speed, maxTime) {
    var ang = Math.atan2(y - obj.y, x - obj.x);
    if (maxTime > 0) speed = MathUtils.distance(obj.x, obj.y, x, y) / (maxTime / 1000);
    if (obj.body) obj.body.velocity.set(Math.cos(ang) * (speed || 60), Math.sin(ang) * (speed || 60));
    return ang;
  }
  moveToObject(obj, target, speed, maxTime) { return this.moveTo(obj, target.x, target.y, speed, maxTime); }
  accelerateTo(obj, x, y, accel, maxX, maxY) {
    var ang = Math.atan2(y - obj.y, x - obj.x);
    if (obj.body) { obj.body.acceleration.set(Math.cos(ang) * (accel || 60), Math.sin(ang) * (accel || 60)); if (maxX !== undefined) obj.body.maxVelocity.set(maxX, maxY === undefined ? maxX : maxY); }
    return ang;
  }
  accelerateToObject(obj, t, accel, maxX, maxY) { return this.accelerateTo(obj, t.x, t.y, accel, maxX, maxY); }
  /** Raycast DDA contra una capa de tiles. Devuelve {x, y, tileX, tileY, distance} o null. */
  raycastTiles(layer, x0, y0, x1, y1) {
    var m = layer.getWorldMatrix(_tmpMatrix3), tw = layer.tileWidth * (m.a || 1), th = layer.tileHeight * (m.d || 1);
    var ox = m.tx, oy = m.ty, dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return null;
    var rx = dx / len, ry = dy / len;
    var cx = Math.floor((x0 - ox) / tw), cy = Math.floor((y0 - oy) / th);
    var stepX = rx > 0 ? 1 : -1, stepY = ry > 0 ? 1 : -1;
    var tMaxX = rx !== 0 ? (((cx + (stepX > 0 ? 1 : 0)) * tw + ox) - x0) / rx : Infinity;
    var tMaxY = ry !== 0 ? (((cy + (stepY > 0 ? 1 : 0)) * th + oy) - y0) / ry : Infinity;
    var tdx = rx !== 0 ? Math.abs(tw / rx) : Infinity, tdy = ry !== 0 ? Math.abs(th / ry) : Infinity, t = 0;
    for (var i = 0; i < 4096 && t <= len; i++) {
      if (layer.collidesAt(cx, cy) === 1) return { x: x0 + rx * t, y: y0 + ry * t, tileX: cx, tileY: cy, distance: t };
      if (tMaxX < tMaxY) { t = tMaxX; tMaxX += tdx; cx += stepX; } else { t = tMaxY; tMaxY += tdy; cy += stepY; }
    }
    return null;
  }
  renderDebug() {
    if (!this.scene || !this.scene.world) return;
    var g = this.debugGraphic;
    if (!g || g.destroyed) { g = this.debugGraphic = new Graphics(); g.zIndex = 1e9; g.name = '__physicsDebug'; this.scene.world.addChild(g); }
    else if (g.parent !== this.scene.world) this.scene.world.addChild(g);
    g.clear();
    var draw = function (b) {
      if (!b.enable || !b.debugShowBody) return;
      g.lineStyle(1, b.debugColor, 1);
      if (b.isCircle) g.strokeCircle(b.centerX, b.centerY, b.width / 2); else g.strokeRect(b.left, b.top, b.width, b.height);
      if (b.debugShowVelocity && !b.isStatic) { g.lineStyle(1, 0x00ff00, 1); g.lineBetween(b.centerX, b.centerY, b.centerX + b.velocity.x / 10, b.centerY + b.velocity.y / 10); }
    };
    this.staticBodies.forEach(draw); this.bodies.forEach(draw);
  }
  shutdown() {
    this.colliders.slice().forEach(function (c) { c.destroy(); });
    this.colliders.length = 0;
    this.bodies.slice().forEach(function (b) { b.destroy(); });
    this.staticBodies.slice().forEach(function (b) { b.destroy(); });
    this.bodies.length = 0; this.staticBodies.length = 0;
    if (this.debugGraphic) { this.debugGraphic.destroy(); this.debugGraphic = null; }
    this._hash.clear(); this._staticHash.clear();
    this.off();
  }
  destroy() { this.shutdown(); this.scene = null; }
}

/* ============================================================== PhysicsGroup */
class PhysicsGroup extends Group {
  constructor(world, scene, config, isStatic) {
    config = config || {};
    var defaults = config;
    super(scene, Object.assign({}, config, { quantity: 0, repeat: 0 }));
    this.world = world; this.isStatic = !!isStatic;
    this.bodyDefaults = defaults;
    var qty = config.quantity || config.repeat || 0;
    if (qty > 0) this.createMultiple({ quantity: qty, key: this.defaultKey, frame: this.defaultFrame, active: config.active !== false, visible: config.visible !== false, setXY: config.setXY });
  }
  add(obj, addToContainer) {
    super.add(obj, addToContainer);
    if (!obj.body) this.world.enable(obj, this.isStatic);
    var d = this.bodyDefaults, b = obj.body;
    if (b && d) {
      if (d.velocityX !== undefined || d.velocityY !== undefined) b.setVelocity(d.velocityX || 0, d.velocityY || 0);
      if (d.bounceX !== undefined || d.bounceY !== undefined) b.setBounce(d.bounceX || 0, d.bounceY || 0);
      if (d.bounce !== undefined) b.setBounce(d.bounce);
      if (d.collideWorldBounds) b.setCollideWorldBounds(true);
      if (d.allowGravity !== undefined) b.setAllowGravity(d.allowGravity);
      if (d.immovable !== undefined) b.setImmovable(d.immovable);
      if (d.gravityY !== undefined) b.setGravityY(d.gravityY);
      if (d.dragX !== undefined || d.dragY !== undefined) b.setDrag(d.dragX || 0, d.dragY || 0);
      if (d.maxVelocityX !== undefined) b.setMaxVelocity(d.maxVelocityX, d.maxVelocityY);
      if (d.circle) b.setCircle(d.circle);
    }
    return obj;
  }
  refresh() { this.children.forEach(function (c) { if (c.body) c.body.refreshBody(); }); return this; }
  setVelocity(x, y) { this.children.forEach(function (c) { if (c.body) c.body.setVelocity(x, y); }); return this; }
  setVelocityX(x) { this.children.forEach(function (c) { if (c.body) c.body.setVelocityX(x); }); return this; }
  setVelocityY(y) { this.children.forEach(function (c) { if (c.body) c.body.setVelocityY(y); }); return this; }
}

/* ============================================================ ArcadePhysics
 * this.physics dentro de una escena. */
class ArcadePhysics {
  constructor(scene, config) {
    this.scene = scene;
    this.world = new ArcadeWorld(scene, config);
    var self = this, w = this.world;
    var mk = function (x, y, key, frame, isStatic) {
      var s = new Sprite(x, y, key !== undefined ? key : '__WHITE', frame);
      s.scene = scene; scene.world.addChild(s);
      w.enable(s, isStatic);
      return s;
    };
    this.add = {
      sprite: function (x, y, key, frame) { return mk(x, y, key, frame, false); },
      image: function (x, y, key, frame) { return mk(x, y, key, frame, false); },
      staticSprite: function (x, y, key, frame) { return mk(x, y, key, frame, true); },
      staticImage: function (x, y, key, frame) { return mk(x, y, key, frame, true); },
      existing: function (obj, isStatic) { if (!obj.parent) { obj.scene = scene; scene.world.addChild(obj); } w.enable(obj, isStatic); return obj; },
      group: function (config) { return new PhysicsGroup(w, scene, config, false); },
      staticGroup: function (config) { return new PhysicsGroup(w, scene, config, true); },
      collider: function (a, b, cb, pcb, ctx) { return w.collider(a, b, cb, pcb, ctx); },
      overlap: function (a, b, cb, pcb, ctx) { return w.overlapCollider(a, b, cb, pcb, ctx); },
      body: function (x, y, width, height) { var z = new Zone(x, y, width || 32, height || 32); z.scene = scene; scene.world.addChild(z); w.enable(z); return z.body; }
    };
    void self;
  }
  collide(a, b, cb, pcb, ctx) { return this.world.collide(a, b, cb, pcb, ctx); }
  overlap(a, b, cb, pcb, ctx) { return this.world.overlap(a, b, cb, pcb, ctx); }
  pause() { this.world.pause(); return this; }
  resume() { this.world.resume(); return this; }
  moveTo(o, x, y, s, t) { return this.world.moveTo(o, x, y, s, t); }
  moveToObject(o, t, s, mt) { return this.world.moveToObject(o, t, s, mt); }
  accelerateTo(o, x, y, a, mx, my) { return this.world.accelerateTo(o, x, y, a, mx, my); }
  accelerateToObject(o, t, a, mx, my) { return this.world.accelerateToObject(o, t, a, mx, my); }
  velocityFromAngle(a, s, out) { return this.world.velocityFromAngle(a, s, out); }
  velocityFromRotation(r, s, out) { return this.world.velocityFromRotation(r, s, out); }
  closest(s, t) { return this.world.closest(s, t); }
  furthest(s, t) { return this.world.furthest(s, t); }
  overlapRect(x, y, w, h, d, s) { return this.world.overlapRect(x, y, w, h, d, s); }
  overlapCirc(x, y, r, d, s) { return this.world.overlapCirc(x, y, r, d, s); }
  raycast(layer, x0, y0, x1, y1) { return this.world.raycastTiles(layer, x0, y0, x1, y1); }
  update(time, delta) { this.world.update(time, delta); }
  shutdown() { this.world.shutdown(); }
  destroy() { this.world.destroy(); this.scene = null; }
}

UG.Body = Body;
UG.ArcadeWorld = ArcadeWorld;
UG.ArcadePhysics = ArcadePhysics;
UG.PhysicsGroup = PhysicsGroup;
UG.Collider = Collider;
UG.SpatialHash = SpatialHash;
