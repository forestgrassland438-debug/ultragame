/* UltraGame 3D - controles de cámara y jugador (teclado, ratón con pointer lock, táctil y mando):
 * OrbitControls3D (visores/editor), FirstPersonControls3D (FPS), ThirdPersonControls3D (TPS con colisión de cámara),
 * FollowCamera3D (coches) y FlyControls3D (vuelo libre / editor). Se registran en la vista y se actualizan solos. */

var _cv = new Vec3(), _cv2 = new Vec3(), _cq = new Quat();
var DEADZONE = 0.15;
function dz(v) { return Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE); }

class Controls3D {
  constructor(view, o) {
    this.view = view; this.options = o || {}; this.enabled = true; this.destroyed = false;
    this._dom = new DOMListeners(); this._subs = [];
    view.addControl(this);
  }
  get camera() { return this.view.camera; }
  get input() { return this.view.scene ? this.view.scene.input : null; }
  get game() { return this.view.scene ? this.view.scene.game : null; }
  get canvas() { var g = this.game; return g ? g.canvas : null; }
  _on(em, ev, fn) { if (!em) return; em.on(ev, fn); this._subs.push([em, ev, fn]); }
  key() { var kb = this.input && this.input.keyboard; if (!kb || !this.enabled) return false; for (var i = 0; i < arguments.length; i++) if (kb.isDown(arguments[i])) return true; return false; }
  pad() { var gp = this.input && this.input.gamepad; var p = gp && gp.pad1; return p && p.connected ? p : null; }
  /** ¿El puntero está sobre la vista? (para vistas que no ocupan toda la pantalla) */
  _inside(p) { var v = this.view, l = v.worldTransform.applyInverse(p.x, p.y, new Vec2()); return l.x >= 0 && l.y >= 0 && l.x <= v.viewWidth && l.y <= v.viewHeight; }
  update() { }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._subs.forEach(function (s) { s[0].off(s[1], s[2]); }); this._subs.length = 0;
    this._dom.removeAll();
    if (this._locked && typeof document !== 'undefined' && document.exitPointerLock && document.pointerLockElement === this.canvas) { try { document.exitPointerLock(); } catch (e) { /* ignorar */ } }
    var v = this.view; if (v && v.controls) { var i = v.controls.indexOf(this); if (i >= 0) v.controls.splice(i, 1); }
    this.view = null;
  }
}

/** Entrada de agacharse compartida por los controles FPS y TPS (teclas, botón B del mando o entrada externa) */
function crouchInput(ctl, ch, pad, ex) {
  if (!ch.setCrouch) return;
  var held = ctl.enabled && (ctl.crouchKeys.some(function (k) { return ctl.key(k); }) || !!(pad && pad.isDown(1)) || !!(ex && ex.crouch));
  if (ctl.crouchToggle) { if (held && !ctl._cPrev) ctl._cOn = !ctl._cOn; ctl._cPrev = held; ch.setCrouch(ctl._cOn); }
  else if (held !== ctl._cPrev || held) { ctl._cPrev = held; ch.setCrouch(held); }
}

/* ============================================================ OrbitControls3D */
class OrbitControls3D extends Controls3D {
  /** options: { target, distance, minDistance, maxDistance, minPolar, maxPolar, yaw, pitch, damping, rotateSpeed, zoomSpeed, pan, autoRotate } */
  constructor(view, o) {
    super(view, o); o = this.options;
    this.target = o.target ? new Vec3(o.target.x, o.target.y, o.target.z) : new Vec3();
    this.distance = o.distance || 10; this.minDistance = o.minDistance || 1; this.maxDistance = o.maxDistance || 500;
    this.yaw = o.yaw || 0; this.pitch = o.pitch === undefined ? 0.5 : o.pitch;
    this.minPitch = o.minPitch === undefined ? -1.45 : o.minPitch; this.maxPitch = o.maxPitch === undefined ? 1.45 : o.maxPitch;
    this.damping = o.damping === undefined ? 12 : o.damping; this.rotateSpeed = o.rotateSpeed || 0.006; this.zoomSpeed = o.zoomSpeed || 0.0015;
    this.enablePan = o.pan !== false; this.autoRotate = o.autoRotate || 0;
    this._y = this.yaw; this._p = this.pitch; this._d = this.distance; this._t = this.target.clone();
    this._ptrs = new Map(); this._pinch = 0;
    var self = this, inp = this.input;
    this._on(inp, 'pointerdown', function (p) { if (!self.enabled || !self._inside(p)) return; self._ptrs.set(p.id, { x: p.x, y: p.y, pan: p.rightButtonDown || p.middleButtonDown || self.key('SHIFT') }); self._pinch = 0; });
    this._on(inp, 'pointermove', function (p) {
      var s = self._ptrs.get(p.id); if (!s || !self.enabled) return;
      var dx = p.x - s.x, dy = p.y - s.y; s.x = p.x; s.y = p.y;
      if (self._ptrs.size >= 2) {
        var arr = Array.from(self._ptrs.values()), d = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
        if (self._pinch) self.distance = clamp(self.distance * self._pinch / Math.max(1, d), self.minDistance, self.maxDistance);
        self._pinch = d;
        if (self.enablePan) self._pan(dx * 0.5, dy * 0.5);
        return;
      }
      if (s.pan && self.enablePan) self._pan(dx, dy);
      else { self.yaw -= dx * self.rotateSpeed; self.pitch = clamp(self.pitch + dy * self.rotateSpeed, self.minPitch, self.maxPitch); }
    });
    var up = function (p) { if (!p.isDown) { self._ptrs.delete(p.id); self._pinch = 0; } else { var s = self._ptrs.get(p.id); if (s) s.pan = p.rightButtonDown || p.middleButtonDown || self.key('SHIFT'); } };
    this._on(inp, 'pointerup', up); this._on(inp, 'pointercancel', up);
    this._on(inp, 'wheel', function (p, objs, dxw, dyw) { if (!self.enabled || !self._inside(p)) return; self.distance = clamp(self.distance * Math.exp(dyw * self.zoomSpeed), self.minDistance, self.maxDistance); });
    this.update(1);
  }
  _pan(dx, dy) {
    var k = this.distance * 0.0016, cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    // derecha de la cámara y "adelante" en el plano
    this.target.x -= (cy * dx) * k; this.target.z -= (-sy * dx) * k;
    this.target.y += dy * k * Math.cos(this.pitch);
    this.target.x -= (sy * dy) * k * Math.sin(this.pitch); this.target.z -= (cy * dy) * k * Math.sin(this.pitch);
  }
  update(dt) {
    if (this.autoRotate) this.yaw += this.autoRotate * dt;
    var k = this.damping > 0 ? 1 - Math.exp(-this.damping * dt) : 1;
    this._y += (this.yaw - this._y) * k; this._p += (this.pitch - this._p) * k; this._d += (this.distance - this._d) * k; this._t.lerp(this.target, k);
    var cp = Math.cos(this._p), cam = this.camera;
    cam.position.set(this._t.x + Math.sin(this._y) * cp * this._d, this._t.y + Math.sin(this._p) * this._d, this._t.z + Math.cos(this._y) * cp * this._d);
    cam.lookAt(this._t);
  }
}

/* ========================================================= FirstPersonControls3D */
class FirstPersonControls3D extends Controls3D {
  /** options: { character, eyeHeight, speed, runSpeed, sensitivity, pointerLock, joystick, lookZone, invertY, bob } */
  constructor(view, o) {
    super(view, o); o = this.options;
    this.character = o.character || null; this.eyeHeight = o.eyeHeight === undefined ? 1.6 : o.eyeHeight;
    this.speed = o.speed || 5; this.runSpeed = o.runSpeed || 9; this.sensitivity = o.sensitivity || 0.0022; this.invertY = !!o.invertY;
    this.yaw = o.yaw || 0; this.pitch = 0; this.maxPitch = 1.5; this.joystick = o.joystick || null; this.bob = o.bob === undefined ? 0.04 : o.bob;
    this.position = o.position ? new Vec3(o.position.x, o.position.y, o.position.z) : (this.character ? this.character.position.clone() : this.camera.position.clone());
    this._bobT = 0; this._lookP = null; this._locked = false; this.moving = false; this.running = false;
    /** C agacha (mantener; crouchToggle: pulsar para alternar). No se usa Ctrl: Ctrl+W cierra la pestaña y el navegador no deja impedirlo.
     *  Espacio contra un obstáculo (valla, caja, alféizar de ventana) lo salta (vault) en vez de un salto normal. */
    this.crouchKeys = o.crouchKeys || ['KeyC']; this.crouchToggle = !!o.crouchToggle; this.vault = o.vault !== false; this.crouchSpeed = o.crouchSpeed || 0.5;
    this._eye = this.eyeHeight; this._cPrev = false; this._cOn = false;
    this.usePointerLock = o.pointerLock !== false;
    var self = this, inp = this.input;
    if (typeof document !== 'undefined') {
      this._dom.add(document, 'pointerlockchange', function () { self._locked = document.pointerLockElement === self.canvas; self.view && self.view.emit('pointerlock', self._locked); });
      this._dom.add(document, 'mousemove', function (e) { if (!self._locked || !self.enabled) return; self._look(e.movementX || 0, e.movementY || 0); });
    }
    this._on(inp, 'pointerdown', function (p) {
      if (!self.enabled || !self._inside(p)) return;
      if (p.type === 'mouse') { if (self.usePointerLock && !self._locked) self.lock(); else if (!self.usePointerLock) self._lookP = { id: p.id, x: p.x, y: p.y }; }
      // táctil: arrastrar en la mitad derecha de la pantalla mira alrededor
      else if (!self._lookP && p.x > (self.game ? self.game.width : 800) * 0.4) self._lookP = { id: p.id, x: p.x, y: p.y };
    });
    this._on(inp, 'pointermove', function (p) { var l = self._lookP; if (!self.enabled || !l || l.id !== p.id) return; self._look((p.x - l.x) * 1.6, (p.y - l.y) * 1.6); l.x = p.x; l.y = p.y; });
    var up = function (p) { if (!p.isDown && self._lookP && self._lookP.id === p.id) self._lookP = null; };
    this._on(inp, 'pointerup', up); this._on(inp, 'pointercancel', up);
  }
  get isLocked() { return this._locked; }
  lock() { var c = this.canvas; if (c && c.requestPointerLock) { try { var r = c.requestPointerLock(); if (r && r.catch) r.catch(function () { /* el usuario lo rechazó */ }); } catch (e) { /* ignorar */ } } return this; }
  unlock() { if (typeof document !== 'undefined' && document.exitPointerLock && this._locked) document.exitPointerLock(); return this; }
  _look(dx, dy) { this.yaw -= dx * this.sensitivity; this.pitch = clamp(this.pitch - dy * this.sensitivity * (this.invertY ? -1 : 1), -this.maxPitch, this.maxPitch); }
  /** Entrada externa (IA, bots, cinemáticas, UI táctil propia): { forward, strafe (-1..1), run, jump } */
  setExternal(o) { this.external = o || null; return this; }
  /** Dirección de la mirada (unitaria) */
  getDirection(out) { var cp = Math.cos(this.pitch); return (out || new Vec3()).set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp); }
  update(dt) {
    var f = 0, s = 0;
    if (this.key('KeyW', 'ArrowUp')) f += 1; if (this.key('KeyS', 'ArrowDown')) f -= 1;
    if (this.key('KeyD', 'ArrowRight')) s += 1; if (this.key('KeyA', 'ArrowLeft')) s -= 1;
    var js = this.joystick; if (js && js.isActive) { f -= js.forceY; s += js.forceX; }
    var ex = this.external; if (ex) { f += +ex.forward || 0; s += +ex.strafe || 0; }
    var pad = this.pad(); if (pad) { f -= dz(pad.axes[1] || 0); s += dz(pad.axes[0] || 0); this._look(dz(pad.axes[2] || 0) * 900 * dt, dz(pad.axes[3] || 0) * 700 * dt); }
    var len = Math.hypot(f, s); if (len > 1) { f /= len; s /= len; }
    this.running = this.key('SHIFT') || !!(pad && pad.isDown(10)) || !!(ex && ex.run);
    var sp = this.enabled ? (this.running ? this.runSpeed : this.speed) : 0, sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    var vx = (-sy * f + cy * s) * sp, vz = (-cy * f - sy * s) * sp;
    this.moving = len > 0.1;
    var ch = this.character;
    if (ch) {
      crouchInput(this, ch, pad, ex);
      if (ch.crouching) { vx *= this.crouchSpeed; vz *= this.crouchSpeed; this.running = false; }
      ch.move(vx, vz);
      var jump = this.enabled && (this.key('SPACE') || (pad && pad.justDown(0)) || (ex && ex.jump));
      // saltar la ventana/valla que hay delante en vez de un salto normal
      if (jump && !(this.vault && f > 0.3 && ch.tryVault && ch.tryVault(-sy, -cy))) ch.jump();
      this.position.copy(ch.position);
    } else { this.position.x += vx * dt; this.position.z += vz * dt; }
    this._bobT += this.moving && (!ch || ch.onGround) ? dt * (this.running ? 13 : 9) : 0;
    var cam = this.camera, bob = this.bob > 0 && this.moving ? Math.sin(this._bobT) * this.bob : 0;
    // la altura de los ojos sigue suavemente a la de la cápsula (agacharse, saltar ventanas)
    var eyeWant = ch && ch.standHeight ? this.eyeHeight * (ch.height / ch.standHeight) : this.eyeHeight;
    this._eye += (eyeWant - this._eye) * Math.min(1, 12 * dt);
    cam.position.set(this.position.x, this.position.y + this._eye + bob, this.position.z);
    cam.quaternion.setFromEuler(this.pitch, this.yaw, 0, 'YXZ');
  }
}

/* ========================================================= ThirdPersonControls3D */
class ThirdPersonControls3D extends Controls3D {
  /** options: { target (nodo), character, distance, height, minDistance, maxDistance, speed, runSpeed, turnSpeed, collide (true), joystick, pointerLock, shoulder } */
  constructor(view, o) {
    super(view, o); o = this.options;
    this.target = o.target || null; this.character = o.character || null;
    this.distance = o.distance || 5; this.height = o.height === undefined ? 1.6 : o.height; this.minDistance = o.minDistance || 1.5; this.maxDistance = o.maxDistance || 12;
    this.speed = o.speed || 4.5; this.runSpeed = o.runSpeed || 8; this.turnSpeed = o.turnSpeed || 12; this.collide = o.collide !== false;
    this.yaw = o.yaw || 0; this.pitch = o.pitch === undefined ? 0.35 : o.pitch; this.sensitivity = o.sensitivity || 0.005;
    this.joystick = o.joystick || null; this.shoulder = o.shoulder || 0; this.aiming = false; this.aimDistance = o.aimDistance || 2.2; this.aimShoulder = o.aimShoulder === undefined ? 0.7 : o.aimShoulder;
    this.usePointerLock = !!o.pointerLock; this.moving = false; this.running = false; this.facing = 0; this.autoFace = o.autoFace !== false;
    this._d = this.distance; this._sh = this.shoulder; this._drag = null; this._locked = false;
    this.crouchKeys = o.crouchKeys || ['KeyC']; this.crouchToggle = !!o.crouchToggle; this.vault = o.vault !== false; this.crouchSpeed = o.crouchSpeed || 0.5;
    this._hgt = this.height; this._cPrev = false; this._cOn = false;
    var self = this, inp = this.input;
    if (typeof document !== 'undefined') {
      this._dom.add(document, 'pointerlockchange', function () { self._locked = document.pointerLockElement === self.canvas; });
      this._dom.add(document, 'mousemove', function (e) { if (!self._locked || !self.enabled) return; self._look(e.movementX || 0, e.movementY || 0); });
    }
    this._on(inp, 'pointerdown', function (p) {
      if (!self.enabled || !self._inside(p)) return;
      if (p.type === 'mouse' && self.usePointerLock) { if (!self._locked && self.canvas && self.canvas.requestPointerLock) { try { var r = self.canvas.requestPointerLock(); if (r && r.catch) r.catch(function () { }); } catch (e) { /* ignorar */ } } return; }
      if (p.type !== 'mouse' && p.x < (self.game ? self.game.width : 800) * 0.4) return; // la izquierda es del joystick
      self._drag = { id: p.id, x: p.x, y: p.y };
    });
    this._on(inp, 'pointermove', function (p) { var d = self._drag; if (!self.enabled || !d || d.id !== p.id) return; self._look((p.x - d.x) * (p.type === 'mouse' ? 1 : 1.5), (p.y - d.y) * (p.type === 'mouse' ? 1 : 1.5)); d.x = p.x; d.y = p.y; });
    var up = function (p) { if (!p.isDown && self._drag && self._drag.id === p.id) self._drag = null; };
    this._on(inp, 'pointerup', up); this._on(inp, 'pointercancel', up);
    this._on(inp, 'wheel', function (p, objs, dxw, dyw) { if (!self.enabled || !self._inside(p)) return; self.distance = clamp(self.distance * Math.exp(dyw * 0.0015), self.minDistance, self.maxDistance); });
  }
  get isLocked() { return this._locked; }
  _look(dx, dy) { this.yaw -= dx * this.sensitivity; this.pitch = clamp(this.pitch + dy * this.sensitivity, -0.9, 1.3); }
  setExternal(o) { this.external = o || null; return this; }
  /** Dirección en la que mira la cámara (para disparar hacia la mira) */
  getAimDirection(out) { return this.camera.getWorldDirection(out || new Vec3()); }
  update(dt) {
    var f = 0, s = 0;
    if (this.key('KeyW', 'ArrowUp')) f += 1; if (this.key('KeyS', 'ArrowDown')) f -= 1;
    if (this.key('KeyD', 'ArrowRight')) s += 1; if (this.key('KeyA', 'ArrowLeft')) s -= 1;
    var js = this.joystick; if (js && js.isActive) { f -= js.forceY; s += js.forceX; }
    var ex = this.external; if (ex) { f += +ex.forward || 0; s += +ex.strafe || 0; }
    var pad = this.pad(); if (pad) { f -= dz(pad.axes[1] || 0); s += dz(pad.axes[0] || 0); this._look(dz(pad.axes[2] || 0) * 500 * dt, dz(pad.axes[3] || 0) * 350 * dt); }
    var len = Math.hypot(f, s); if (len > 1) { f /= len; s /= len; }
    this.running = !this.aiming && (this.key('SHIFT') || !!(pad && pad.isDown(10)) || !!(ex && ex.run));
    var sp = this.enabled ? (this.running ? this.runSpeed : (this.aiming ? this.speed * 0.6 : this.speed)) : 0, sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // ejes relativos a la cámara (la cámara mira hacia -Z rotado por yaw)
    var vx = (-sy * f + cy * s) * sp, vz = (-cy * f - sy * s) * sp;
    this.moving = len > 0.1 && sp > 0;
    var ch = this.character, tg = this.target;
    if (ch) {
      crouchInput(this, ch, pad, ex);
      if (ch.crouching) { vx *= this.crouchSpeed; vz *= this.crouchSpeed; this.running = false; }
      ch.move(vx, vz);
      var jmp = this.enabled && (this.key('SPACE') || (pad && pad.justDown(0)) || (ex && ex.jump));
      var ml = Math.hypot(vx, vz);
      if (jmp && !(this.vault && ml > 0.5 && ch.tryVault && ch.tryVault(vx / ml, vz / ml))) ch.jump();
    }
    else if (tg) { tg.position.x += vx * dt; tg.position.z += vz * dt; }
    if (tg && this.autoFace) {
      var want = this.aiming ? Math.atan2(-sy, -cy) : (this.moving ? Math.atan2(vx, vz) : this.facing);
      var diff = Math.atan2(Math.sin(want - this.facing), Math.cos(want - this.facing));
      this.facing += diff * Math.min(1, this.turnSpeed * dt);
      tg.quaternion.setFromEuler(0, this.facing, 0);
    }
    // cámara
    var dist = this.aiming ? this.aimDistance : this.distance, sh = this.aiming ? this.aimShoulder : this.shoulder, k = 1 - Math.exp(-10 * dt);
    this._sh += (sh - this._sh) * k;
    var base = tg ? tg.getWorldPosition(_cv) : (ch ? _cv.copy(ch.position) : _cv.set(0, 0, 0));
    var hWant = ch && ch.standHeight ? this.height * (0.55 + 0.45 * ch.height / ch.standHeight) : this.height;
    this._hgt += (hWant - this._hgt) * Math.min(1, 10 * dt);
    var pivot = _cv2.set(base.x + cy * this._sh, base.y + this._hgt, base.z - sy * this._sh);
    var cp = Math.cos(this.pitch), dir = new Vec3(sy * cp, Math.sin(this.pitch), cy * cp);
    var want2 = dist, world = this.view.physics;
    if (this.collide && world) {
      var hit = world.raycast(pivot, dir, dist + 0.3, { bodies: false });
      if (hit) want2 = Math.max(0.3, hit.distance - 0.3);
    }
    // acercar al instante (no atravesar paredes), alejar suave
    this._d = want2 < this._d ? want2 : this._d + (want2 - this._d) * k;
    var cam = this.camera;
    cam.position.set(pivot.x + dir.x * this._d, pivot.y + dir.y * this._d, pivot.z + dir.z * this._d);
    cam.lookAt(pivot);
  }
}

/* =============================================================== FollowCamera3D */
class FollowCamera3D extends Controls3D {
  /** Cámara de persecución (coches, naves). options: { target, distance, height, lookHeight, stiffness, lookAhead, collide } */
  constructor(view, o) {
    super(view, o); o = this.options;
    this.target = o.target || null; this.distance = o.distance || 7; this.height = o.height === undefined ? 2.6 : o.height; this.lookHeight = o.lookHeight === undefined ? 1 : o.lookHeight;
    this.stiffness = o.stiffness || 5; this.lookAhead = o.lookAhead === undefined ? 4 : o.lookAhead; this.collide = o.collide !== false; this.yawOffset = 0;
    this._pos = null;
  }
  update(dt) {
    var t = this.target; if (!t) return;
    var tp = t.getWorldPosition(new Vec3()), fwd = t.getWorldDirection(new Vec3()); fwd.y = 0; if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1); fwd.normalize();
    if (this.yawOffset) fwd.applyQuat(_cq.setFromAxisAngle(Vec3.UP, this.yawOffset));
    var want = new Vec3(tp.x - fwd.x * this.distance, tp.y + this.height, tp.z - fwd.z * this.distance);
    var world = this.view.physics, look = new Vec3(tp.x + fwd.x * this.lookAhead, tp.y + this.lookHeight, tp.z + fwd.z * this.lookAhead);
    if (this.collide && world) { var from = new Vec3(tp.x, tp.y + this.lookHeight + 0.5, tp.z), d = want.clone().sub(from), l = d.length(), h = world.raycast(from, d, l, { bodies: false }); if (h) want.copy(from).addScaled(d.normalize(), Math.max(0.5, h.distance - 0.4)); }
    if (!this._pos) this._pos = want.clone();
    var k = 1 - Math.exp(-this.stiffness * dt); this._pos.lerp(want, k);
    var cam = this.camera; cam.position.copy(this._pos); cam.lookAt(look);
  }
  /** Coloca la cámara de golpe (tras teletransportes) */
  snap() { this._pos = null; this.update(1); return this; }
}

/* ================================================================= FlyControls3D */
class FlyControls3D extends Controls3D {
  /** Vuelo libre: WASD + Q/E, clic derecho (o arrastre táctil) para mirar, Shift = rápido. options: { speed, fastSpeed, sensitivity } */
  constructor(view, o) {
    super(view, o); o = this.options;
    this.speed = o.speed || 8; this.fastSpeed = o.fastSpeed || 30; this.sensitivity = o.sensitivity || 0.004;
    var e = new Euler().setFromRotationMatrix(new Mat4().makeRotationFromQuat(this.camera.quaternion), 'YXZ');
    this.yaw = e.y; this.pitch = e.x; this._drag = null; this.button = o.button === undefined ? 2 : o.button;
    var self = this, inp = this.input;
    this._on(inp, 'pointerdown', function (p) { if (!self.enabled || !self._inside(p)) return; if (p.type !== 'mouse' || p.button === self.button) self._drag = { id: p.id, x: p.x, y: p.y }; });
    this._on(inp, 'pointermove', function (p) { var d = self._drag; if (!self.enabled || !d || d.id !== p.id) return; self.yaw -= (p.x - d.x) * self.sensitivity; self.pitch = clamp(self.pitch - (p.y - d.y) * self.sensitivity, -1.55, 1.55); d.x = p.x; d.y = p.y; });
    var up = function (p) { if (self._drag && self._drag.id === p.id && (p.type !== 'mouse' || !(p.buttons & pointerButtonMask(self.button)))) self._drag = null; };
    this._on(inp, 'pointerup', up); this._on(inp, 'pointercancel', up);
  }
  update(dt) {
    var cam = this.camera, sp = (this.key('SHIFT') ? this.fastSpeed : this.speed) * dt, f = 0, s = 0, u = 0;
    if (this.key('KeyW')) f += 1; if (this.key('KeyS')) f -= 1; if (this.key('KeyD')) s += 1; if (this.key('KeyA')) s -= 1; if (this.key('KeyE')) u += 1; if (this.key('KeyQ')) u -= 1;
    cam.quaternion.setFromEuler(this.pitch, this.yaw, 0, 'YXZ');
    if (f || s || u) { cam.translateZ(-f * sp); cam.translateX(s * sp); cam.position.y += u * sp; }
  }
}

View3D.prototype.orbitControls = function (o) { return new OrbitControls3D(this, o); };
View3D.prototype.firstPersonControls = function (o) { return new FirstPersonControls3D(this, o); };
View3D.prototype.thirdPersonControls = function (o) { return new ThirdPersonControls3D(this, o); };
View3D.prototype.followCamera = function (o) { return new FollowCamera3D(this, o); };
View3D.prototype.flyControls = function (o) { return new FlyControls3D(this, o); };

UG.Controls3D = Controls3D; UG.OrbitControls3D = OrbitControls3D; UG.FirstPersonControls3D = FirstPersonControls3D; UG.ThirdPersonControls3D = ThirdPersonControls3D; UG.FollowCamera3D = FollowCamera3D; UG.FlyControls3D = FlyControls3D;
