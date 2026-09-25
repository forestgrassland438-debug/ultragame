/* UltraGame 3D - física para juegos (determinista, paso fijo, sin dependencias).
 * - Colisionadores estáticos: cajas orientadas, esferas, mallas de triángulos (rejilla espacial) y terrenos.
 * - Cuerpos dinámicos: esferas y cajas alineadas a ejes con masa, rebote, fricción y reposo (sleep).
 * - Personaje: cápsula con "collide and slide", escalones, pendiente máxima, salto, coyote time y pegado al suelo.
 * - Vehículo arcade: aceleración, frenado, derrape, suspensión por rayos, inclinación con el terreno.
 * - Rayos (disparos, línea de visión, picking), disparadores (zonas) y consultas de solapamiento. */

var _p3a = new Vec3(), _p3b = new Vec3(), _p3c = new Vec3(), _p3d = new Vec3(), _p3n = new Vec3(), _p3m = new Mat4();

/** Punto más cercano de un triángulo a p (Ericson, Real-Time Collision Detection 5.1.5) */
function closestPtTriangle(px, py, pz, t, o, out) {
  var ax = t[o], ay = t[o + 1], az = t[o + 2], bx = t[o + 3], by = t[o + 4], bz = t[o + 5], cx = t[o + 6], cy = t[o + 7], cz = t[o + 8];
  var abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az, apx = px - ax, apy = py - ay, apz = pz - az;
  var d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return out.set(ax, ay, az);
  var bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return out.set(bx, by, bz);
  var vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { var v = d1 / (d1 - d3); return out.set(ax + abx * v, ay + aby * v, az + abz * v); }
  var cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return out.set(cx, cy, cz);
  var vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { var w = d2 / (d2 - d6); return out.set(ax + acx * w, ay + acy * w, az + acz * w); }
  var va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { var w2 = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return out.set(bx + (cx - bx) * w2, by + (cy - by) * w2, bz + (cz - bz) * w2); }
  var den = 1 / (va + vb + vc), vv = vb * den, ww = vc * den;
  return out.set(ax + abx * vv + acx * ww, ay + aby * vv + acy * ww, az + abz * vv + acz * ww);
}
/** Punto del segmento [a,b] más cercano a p */
function closestPtSegment(ax, ay, az, bx, by, bz, px, py, pz, out) {
  var dx = bx - ax, dy = by - ay, dz = bz - az, l2 = dx * dx + dy * dy + dz * dz, t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  return out.set(ax + dx * t, ay + dy * t, az + dz * t);
}

/* ================================================================ Colisionadores */
class Collider3D {
  constructor(type) { this.type = type; this.id = uid(); this.enabled = true; this.layer = 1; this.userData = {}; this.node = null; this.world = null; this.friction = 0.8; this.restitution = 0; this.min = new Vec3(); this.max = new Vec3(); }
}
/** Caja orientada estática (paredes, suelos, cajas, edificios) */
class BoxCollider3D extends Collider3D {
  constructor(center, half, quat) {
    super('box'); this.center = center.clone(); this.half = half.clone(); this.quat = quat ? quat.clone() : new Quat();
    this._m = new Mat4(); this._inv = new Mat4(); this._update();
  }
  _update() {
    this._m.compose(this.center, this.quat, _v3one); this._inv.invertFrom(this._m);
    var e = this._m.e, hx = this.half.x, hy = this.half.y, hz = this.half.z;
    var ex = Math.abs(e[0]) * hx + Math.abs(e[4]) * hy + Math.abs(e[8]) * hz, ey = Math.abs(e[1]) * hx + Math.abs(e[5]) * hy + Math.abs(e[9]) * hz, ez = Math.abs(e[2]) * hx + Math.abs(e[6]) * hy + Math.abs(e[10]) * hz;
    this.min.set(this.center.x - ex, this.center.y - ey, this.center.z - ez); this.max.set(this.center.x + ex, this.center.y + ey, this.center.z + ez);
  }
  setTransform(center, quat) { this.center.copy(center); if (quat) this.quat.copy(quat); this._update(); if (this.world) this.world._rehash(this); return this; }
  /** Punto más cercano (en mundo) a p */
  closest(p, out) {
    var l = _p3a.copy(p).applyMat4(this._inv);
    l.x = clamp(l.x, -this.half.x, this.half.x); l.y = clamp(l.y, -this.half.y, this.half.y); l.z = clamp(l.z, -this.half.z, this.half.z);
    return out.copy(l).applyMat4(this._m);
  }
  contains(p) { var l = _p3a.copy(p).applyMat4(this._inv); return Math.abs(l.x) <= this.half.x && Math.abs(l.y) <= this.half.y && Math.abs(l.z) <= this.half.z; }
  /** Normal de salida para un punto interior (cara más cercana) */
  insideNormal(p, out) {
    var l = _p3a.copy(p).applyMat4(this._inv), dx = this.half.x - Math.abs(l.x), dy = this.half.y - Math.abs(l.y), dz = this.half.z - Math.abs(l.z), e = this._m.e;
    if (dx <= dy && dx <= dz) out.set(e[0], e[1], e[2]).scale(l.x < 0 ? -1 : 1);
    else if (dy <= dz) out.set(e[4], e[5], e[6]).scale(l.y < 0 ? -1 : 1);
    else out.set(e[8], e[9], e[10]).scale(l.z < 0 ? -1 : 1);
    return Math.min(dx, dy, dz);
  }
  raycast(o, d, max) {
    var lo = _p3a.copy(o).applyMat4(this._inv), ld = _p3b.copy(d).transformDirection(this._inv);
    var tmin = 0, tmax = max, axis = -1, sign = 1, comps = ['x', 'y', 'z'];
    for (var i = 0; i < 3; i++) {
      var c = comps[i], h = this.half[c];
      if (Math.abs(ld[c]) < 1e-12) { if (lo[c] < -h || lo[c] > h) return null; continue; }
      var inv = 1 / ld[c], t1 = (-h - lo[c]) * inv, t2 = (h - lo[c]) * inv, s = -1;
      if (t1 > t2) { var t = t1; t1 = t2; t2 = t; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (axis < 0) return null; // origen dentro
    var e = this._m.e, n = new Vec3(e[axis * 4] * sign, e[axis * 4 + 1] * sign, e[axis * 4 + 2] * sign).normalize();
    return { distance: tmin, normal: n };
  }
}
class SphereCollider3D extends Collider3D {
  constructor(center, radius) { super('sphere'); this.center = center.clone(); this.radius = radius; this._update(); }
  _update() { var r = this.radius; this.min.set(this.center.x - r, this.center.y - r, this.center.z - r); this.max.set(this.center.x + r, this.center.y + r, this.center.z + r); }
  closest(p, out) { out.subVectors(p, this.center); var l = out.length(); if (l > this.radius) out.scale(this.radius / l); return out.add(this.center); }
  raycast(o, d, max) { var s = _sphTmp; s.center.copy(this.center); s.radius = this.radius; _rayTmp.origin.copy(o); _rayTmp.direction.copy(d); var t = _rayTmp.intersectSphere(s); if (t === null || t > max) return null; var n = _rayTmp.at(t, new Vec3()).sub(this.center).normalize(); return { distance: t, normal: n }; }
}
var _sphTmp = new Sphere(), _rayTmp = new Ray();
/** Malla de triángulos estática (escenarios de Blender, casas, circuitos) con rejilla espacial */
class MeshCollider3D extends Collider3D {
  constructor(tris, cell) {
    super('mesh'); this.tris = tris; this.count = tris.length / 9; this.cell = cell || 4; this.grid = new Map(); this._stamp = new Uint32Array(this.count); this._tick = 0;
    this.min.set(Infinity, Infinity, Infinity); this.max.set(-Infinity, -Infinity, -Infinity);
    for (var i = 0; i < tris.length; i += 3) { this.min.x = Math.min(this.min.x, tris[i]); this.min.y = Math.min(this.min.y, tris[i + 1]); this.min.z = Math.min(this.min.z, tris[i + 2]); this.max.x = Math.max(this.max.x, tris[i]); this.max.y = Math.max(this.max.y, tris[i + 1]); this.max.z = Math.max(this.max.z, tris[i + 2]); }
    var cs = this.cell;
    for (var t = 0; t < this.count; t++) {
      var o = t * 9, x0 = Math.min(tris[o], tris[o + 3], tris[o + 6]), x1 = Math.max(tris[o], tris[o + 3], tris[o + 6]), y0 = Math.min(tris[o + 1], tris[o + 4], tris[o + 7]), y1 = Math.max(tris[o + 1], tris[o + 4], tris[o + 7]), z0 = Math.min(tris[o + 2], tris[o + 5], tris[o + 8]), z1 = Math.max(tris[o + 2], tris[o + 5], tris[o + 8]);
      for (var gx = Math.floor(x0 / cs); gx <= Math.floor(x1 / cs); gx++) for (var gy = Math.floor(y0 / cs); gy <= Math.floor(y1 / cs); gy++) for (var gz = Math.floor(z0 / cs); gz <= Math.floor(z1 / cs); gz++) {
        var k = gx + ',' + gy + ',' + gz, l = this.grid.get(k); if (!l) { l = []; this.grid.set(k, l); } l.push(t);
      }
    }
  }
  /** Triángulos cuyas celdas tocan la caja [min,max] */
  query(x0, y0, z0, x1, y1, z1, fn) {
    var cs = this.cell, tick = ++this._tick;
    if (tick >= 0xFFFFFFF0) { this._stamp.fill(0); this._tick = tick = 1; }
    var ax = Math.floor(x0 / cs), bx = Math.floor(x1 / cs), ay = Math.floor(y0 / cs), by = Math.floor(y1 / cs), az = Math.floor(z0 / cs), bz = Math.floor(z1 / cs);
    if ((bx - ax + 1) * (by - ay + 1) * (bz - az + 1) > 4096) { for (var q = 0; q < this.count; q++) fn(q * 9); return; }
    for (var gx = ax; gx <= bx; gx++) for (var gy = ay; gy <= by; gy++) for (var gz = az; gz <= bz; gz++) {
      var l = this.grid.get(gx + ',' + gy + ',' + gz); if (!l) continue;
      for (var i = 0; i < l.length; i++) { var t = l[i]; if (this._stamp[t] === tick) continue; this._stamp[t] = tick; fn(t * 9); }
    }
  }
  raycast(o, d, max) {
    var best = null, T = this.tris, self = this;
    // recorre las celdas a lo largo del rayo en tramos
    var step = this.cell, len = Math.min(max, 1e5), dist = 0;
    while (dist <= len && !best) {
      var e = Math.min(len, dist + step * 4), sx = o.x + d.x * dist, sy = o.y + d.y * dist, sz = o.z + d.z * dist, ex = o.x + d.x * e, ey = o.y + d.y * e, ez = o.z + d.z * e;
      var bt = Infinity, bo = -1;
      _rayTmp.origin.copy(o); _rayTmp.direction.copy(d);
      this.query(Math.min(sx, ex), Math.min(sy, ey), Math.min(sz, ez), Math.max(sx, ex), Math.max(sy, ey), Math.max(sz, ez), function (off) {
        var t = _rayTmp.intersectTriangle(T[off], T[off + 1], T[off + 2], T[off + 3], T[off + 4], T[off + 5], T[off + 6], T[off + 7], T[off + 8], true);
        if (t !== null && t < bt && t <= max) { bt = t; bo = off; }
      });
      if (bo >= 0 && bt <= e + 1e-6) { best = { distance: bt, normal: triNormal(T, bo, new Vec3()) }; if (best.normal.dot(d) > 0) best.normal.negate(); }
      dist = e;
      if (e >= len) break;
    }
    void self;
    return best;
  }
}
function triNormal(T, o, out) { var ux = T[o + 3] - T[o], uy = T[o + 4] - T[o + 1], uz = T[o + 5] - T[o + 2], vx = T[o + 6] - T[o], vy = T[o + 7] - T[o + 1], vz = T[o + 8] - T[o + 2]; return out.set(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx).normalize(); }
/** Triángulos en mundo de un Mesh3D (o de todas las mallas de un nodo). Se omiten las mallas con noCollide (o userData.noCollide, p. ej. desde los extras de Blender/glTF) */
function worldTriangles(node, out) {
  out = out || [];
  // ancestros y TODO el subárbol (los grupos intermedios de un glTF también deben estar al día)
  node.updateWorldMatrix(); node.updateMatrixWorld();
  node.traverse(function (n) {
    if (!(n instanceof Mesh3D) || !n._geometry || !n._geometry.attributes.position || n.noCollide || (n.userData && n.userData.noCollide)) return;
    var g = n._geometry, P = g.attributes.position.data, s = g.attributes.position.size, idx = g.index, cnt = idx ? idx.length : g.vertexCount;
    var mats = [];
    if (n.instanced) { for (var k = 0; k < n.count; k++) mats.push(new Mat4().multiplyMatrices(n.matrixWorld, new Mat4().fromArray(n.instanceMatrix, k * 16))); }
    else mats.push(n.matrixWorld);
    mats.forEach(function (m) {
      for (var t = 0; t + 2 < cnt; t += 3) for (var j = 0; j < 3; j++) {
        var vi = idx ? idx[t + j] : t + j;
        _p3a.set(P[vi * s], P[vi * s + 1], P[vi * s + 2]).applyMat4(m); out.push(_p3a.x, _p3a.y, _p3a.z);
      }
    });
  });
  return out;
}

/* ================================================================ Cuerpos */
class Body3D extends EventEmitter {
  constructor(world, node, o) {
    super();
    o = o || {};
    this.world = world; this.node = node || null; this.id = uid();
    this.shape = o.shape === 'box' ? 'box' : 'sphere';
    this.radius = o.radius || 0.5; this.half = o.half ? new Vec3(o.half.x, o.half.y, o.half.z) : new Vec3(0.5, 0.5, 0.5);
    this.position = node ? node.getWorldPosition(new Vec3()) : (o.position ? new Vec3(o.position.x, o.position.y, o.position.z) : new Vec3());
    this.velocity = new Vec3(); this.mass = o.mass === undefined ? 1 : Math.max(0, o.mass); this.invMass = this.mass > 0 ? 1 / this.mass : 0;
    this.restitution = o.restitution === undefined ? 0.2 : o.restitution; this.friction = o.friction === undefined ? 0.6 : o.friction;
    this.gravityScale = o.gravityScale === undefined ? 1 : o.gravityScale; this.linearDamping = o.damping === undefined ? 0.02 : o.damping;
    this.sleeping = false; this._still = 0; this.onGround = false; this.enabled = true; this.layer = o.layer || 1; this.mask = o.mask === undefined ? -1 : o.mask;
    this.roll = o.roll !== false && this.shape === 'sphere'; // la malla de la esfera rueda visualmente
    this.userData = o.userData || {};
    this.min = new Vec3(); this.max = new Vec3(); this._aabb();
    this.destroyed = false;
  }
  _aabb() { if (this.shape === 'sphere') { var r = this.radius; this.min.set(this.position.x - r, this.position.y - r, this.position.z - r); this.max.set(this.position.x + r, this.position.y + r, this.position.z + r); } else { this.min.subVectors(this.position, this.half); this.max.addVectors(this.position, this.half); } }
  applyImpulse(x, y, z) { if (typeof x === 'object') { z = x.z; y = x.y; x = x.x; } this.velocity.x += x * this.invMass; this.velocity.y += y * this.invMass; this.velocity.z += z * this.invMass; this.wake(); return this; }
  setVelocity(x, y, z) { this.velocity.set(x, y, z); this.wake(); return this; }
  setPosition(x, y, z) { if (typeof x === 'object') this.position.copy(x); else this.position.set(x, y, z); this._aabb(); this.wake(); this._sync(0); return this; }
  wake() { this.sleeping = false; this._still = 0; return this; }
  _sync(dt) {
    var n = this.node; if (!n) return;
    if (n.parent) { n.parent.updateWorldMatrix(); _p3m.invertFrom(n.parent.matrixWorld); n.position.copy(this.position).applyMat4(_p3m); } else n.position.copy(this.position);
    if (this.roll && dt > 0) { var vx = this.velocity.x, vz = this.velocity.z, sp = Math.hypot(vx, vz); if (sp > 1e-4 && this.onGround) { var ax = _p3n.set(vz / sp, 0, -vx / sp); n.rotateOnWorldAxis(ax, sp * dt / this.radius); } }
  }
  destroy() { if (this.destroyed) return; this.destroyed = true; if (this.world) this.world.remove(this); this.removeAllListeners(); this.node = null; }
}

/** Controlador de personaje (cápsula vertical). La posición es la de los pies. */
class CharacterController3D extends EventEmitter {
  constructor(world, node, o) {
    super();
    o = o || {};
    this.world = world; this.node = node || null; this.id = uid();
    this.radius = o.radius || 0.35; this.height = Math.max(o.height || 1.8, this.radius * 2 + 0.01);
    this.stepHeight = o.stepHeight === undefined ? 0.4 : o.stepHeight; this.maxSlope = (o.maxSlope === undefined ? 50 : o.maxSlope) * DEG_TO_RAD;
    this.gravity = o.gravity === undefined ? null : o.gravity; this.jumpSpeed = o.jumpSpeed || 8; this.coyoteTime = o.coyoteTime === undefined ? 0.12 : o.coyoteTime;
    this.pushForce = o.pushForce === undefined ? 2 : o.pushForce;
    this.position = node ? node.getWorldPosition(new Vec3()) : new Vec3();
    this.velocity = new Vec3(); this.onGround = false; this.groundNormal = new Vec3(0, 1, 0); this.hitCeiling = false; this.hitWall = false;
    this._move = new Vec3(); this._jump = false; this._air = 0; this.enabled = true; this.layer = o.layer || 1; this.mask = o.mask === undefined ? -1 : o.mask;
    this.userData = o.userData || {}; this.min = new Vec3(); this.max = new Vec3(); this._aabb(); this.destroyed = false;
    this.airControl = o.airControl === undefined ? 0.6 : o.airControl;
    // agacharse: altura reducida (se vuelve a levantar solo si hay sitio encima)
    this.standHeight = this.height; this.crouchHeight = Math.max(this.radius * 2 + 0.02, Math.min(this.height, o.crouchHeight || this.height * 0.52));
    this.crouching = false; this._wantStand = false;
    // saltar obstáculos y ventanas (vault) o trepar a bordes (mantle)
    this.vaultHeight = o.vaultHeight === undefined ? 1.35 : o.vaultHeight; this.vaulting = null;
  }
  /** Agacharse (true) o levantarse (false; si hay techo encima se queda agachado hasta que haya sitio) */
  setCrouch(on) {
    if (on) { if (!this.crouching) { this.crouching = true; this.height = this.crouchHeight; this._aabb(); this.emit('crouch', true); } this._wantStand = false; }
    else if (this.crouching) this._wantStand = true;
    return this;
  }
  /**
   * Intenta saltar por encima del obstáculo que tiene delante en la dirección (dx, dz): vallas, cajas, alféizares de
   * ventanas (pasando agachado por el hueco) o trepar a un borde de hasta vaultHeight. Devuelve true si empieza.
   */
  tryVault(dx, dz, o) {
    var w = this.world; if (!w || this.vaulting || !this.enabled) return false;
    return w._tryVault(this, dx, dz, o || {});
  }
  _aabb() { var r = this.radius; this.min.set(this.position.x - r, this.position.y, this.position.z - r); this.max.set(this.position.x + r, this.position.y + this.height, this.position.z + r); }
  /** Velocidad horizontal deseada (unidades/s) para este paso */
  move(vx, vz) { this._move.set(vx || 0, 0, vz || 0); return this; }
  jump(speed) { if (this.onGround || this._air <= this.coyoteTime) { this._jump = speed || this.jumpSpeed; return true; } return false; }
  teleport(x, y, z) { if (typeof x === 'object') this.position.copy(x); else this.position.set(x, y, z); this.velocity.set(0, 0, 0); this.vaulting = null; this._aabb(); this._sync(); return this; }
  _sync() { var n = this.node; if (!n) return; if (n.parent) { n.parent.updateWorldMatrix(); _p3m.invertFrom(n.parent.matrixWorld); n.position.copy(this.position).applyMat4(_p3m); } else n.position.copy(this.position); }
  destroy() { if (this.destroyed) return; this.destroyed = true; if (this.world) this.world.remove(this); this.removeAllListeners(); this.node = null; }
}

/** Coche arcade: node es la carrocería (frente +Z) */
class Vehicle3D extends EventEmitter {
  constructor(world, node, o) {
    super();
    o = o || {};
    this.world = world; this.node = node; this.id = uid();
    this.position = node ? node.getWorldPosition(new Vec3()) : new Vec3();
    this.heading = o.heading !== undefined ? o.heading : (node ? Math.atan2(node.getWorldDirection(new Vec3()).x, node.getWorldDirection(new Vec3()).z) : 0);
    this.speed = 0; this.vy = 0; this.maxSpeed = o.maxSpeed || 32; this.reverseSpeed = o.reverseSpeed || 10; this.accel = o.accel || 18; this.brake = o.brake || 30; this.drag = o.drag === undefined ? 0.6 : o.drag;
    this.turnRate = o.turnRate || 2.2; this.grip = o.grip === undefined ? 6 : o.grip; this.radius = o.radius || 1.0; this.length = o.length || 3.6; this.width = o.width || 1.8; this.rideHeight = o.rideHeight === undefined ? 0.35 : o.rideHeight;
    this.side = 0; // velocidad lateral (derrape)
    this.throttle = 0; this.steer = 0; this.braking = false; this.handbrake = false;
    this.onGround = false; this.pitch = 0; this.roll = 0; this.wheels = o.wheels || null; this.wheelRadius = o.wheelRadius || 0.35; this._spin = 0;
    this.enabled = true; this.layer = o.layer || 1; this.mask = o.mask === undefined ? -1 : o.mask; this.userData = o.userData || {};
    this.min = new Vec3(); this.max = new Vec3(); this._aabb(); this.destroyed = false; this.drifting = false;
  }
  _aabb() { var r = Math.max(this.length, this.width) * 0.55; this.min.set(this.position.x - r, this.position.y, this.position.z - r); this.max.set(this.position.x + r, this.position.y + 1.8, this.position.z + r); }
  /** throttle -1..1, steer -1..1 (positivo = izquierda), brake bool */
  setInput(throttle, steer, brake, handbrake) { this.throttle = clamp(+throttle || 0, -1, 1); this.steer = clamp(+steer || 0, -1, 1); this.braking = !!brake; this.handbrake = !!handbrake; return this; }
  get forward() { return new Vec3(Math.sin(this.heading), 0, Math.cos(this.heading)); }
  get kmh() { return Math.abs(this.speed) * 3.6; }
  teleport(p, heading) { this.position.copy(p); if (heading !== undefined) this.heading = heading; this.speed = 0; this.side = 0; this.vy = 0; this._aabb(); return this; }
  destroy() { if (this.destroyed) return; this.destroyed = true; if (this.world) this.world.remove(this); this.removeAllListeners(); this.node = null; }
}

/** Zona que avisa al entrar/salir (checkpoints, monedas, puertas, muerte por caída) */
class Trigger3D extends EventEmitter {
  constructor(world, o) {
    super();
    this.world = world; this.id = uid(); this.enabled = true; this.once = !!o.once; this.userData = o.userData || {};
    this.center = o.center ? new Vec3(o.center.x, o.center.y, o.center.z) : new Vec3();
    this.radius = o.radius || 0; this.half = o.half ? new Vec3(o.half.x, o.half.y, o.half.z) : null;
    this.node = o.node || null; this.inside = new Set(); this.destroyed = false;
    if (o.onEnter) this.on('enter', o.onEnter); if (o.onExit) this.on('exit', o.onExit);
  }
  _test(obj) {
    var c = this.center; if (this.node) c = this.node.getWorldPosition(_p3d);
    var cx = clamp(c.x, obj.min.x, obj.max.x), cy = clamp(c.y, obj.min.y, obj.max.y), cz = clamp(c.z, obj.min.z, obj.max.z);
    if (this.half) return Math.abs(cx - c.x) <= this.half.x && Math.abs(cy - c.y) <= this.half.y && Math.abs(cz - c.z) <= this.half.z;
    var dx = cx - c.x, dy = cy - c.y, dz = cz - c.z; return dx * dx + dy * dy + dz * dz <= this.radius * this.radius;
  }
  destroy() { if (this.destroyed) return; this.destroyed = true; if (this.world) this.world.remove(this); this.removeAllListeners(); this.inside.clear(); this.node = null; }
}

/* ================================================================== Mundo */
class PhysicsWorld3D extends EventEmitter {
  constructor(o) {
    super();
    o = o || {};
    this.gravity = new Vec3(0, o.gravity === undefined ? -20 : o.gravity, 0);
    this.fixedStep = 1 / (o.fps || 60); this.maxSubSteps = o.maxSubSteps || 5; this._acc = 0;
    this.statics = []; this.bodies = []; this.characters = []; this.vehicles = []; this.triggers = [];
    this.cell = o.cell || 8; this._sgrid = new Map(); this._big = []; this.time = 0; this.destroyed = false; this.paused = false;
    this.killY = o.killY === undefined ? -200 : o.killY;
    Debug.track('PhysicsWorld3D', 1);
  }
  /* ---------- estáticos ---------- */
  _hashAdd(c) {
    var cs = this.cell, ax = Math.floor(c.min.x / cs), bx = Math.floor(c.max.x / cs), az = Math.floor(c.min.z / cs), bz = Math.floor(c.max.z / cs);
    c._cells = [];
    if ((bx - ax + 1) * (bz - az + 1) > 1024) { this._big.push(c); c._big = true; return; }
    for (var x = ax; x <= bx; x++) for (var z = az; z <= bz; z++) { var k = x + ',' + z, l = this._sgrid.get(k); if (!l) { l = []; this._sgrid.set(k, l); } l.push(c); c._cells.push(k); }
  }
  _hashRemove(c) {
    if (c._big) { removeFromArray(this._big, c); c._big = false; }
    var self = this;
    (c._cells || []).forEach(function (k) { var l = self._sgrid.get(k); if (l) { removeFromArray(l, c); if (!l.length) self._sgrid.delete(k); } });
    c._cells = [];
  }
  _rehash(c) { this._hashRemove(c); this._hashAdd(c); }
  _addStatic(c, o) { o = o || {}; c.world = this; if (o.friction !== undefined) c.friction = o.friction; if (o.restitution !== undefined) c.restitution = o.restitution; if (o.layer) c.layer = o.layer; if (o.userData) c.userData = o.userData; this.statics.push(c); this._hashAdd(c); return c; }
  /** Caja estática: center (Vec3), half (Vec3 medias dimensiones), quat opcional */
  addBox(center, half, quat, o) { return this._addStatic(new BoxCollider3D(center, half, quat), o); }
  addSphere(center, radius, o) { return this._addStatic(new SphereCollider3D(center, radius), o); }
  /** Suelo infinito (caja enorme) a la altura y */
  addGround(y, o) { return this.addBox(new Vec3(0, (y || 0) - 50, 0), new Vec3(1e5, 50, 1e5), null, o); }
  /** Colisionador de triángulos desde un nodo (todas sus mallas, en su posición actual) */
  addMesh(node, o) { var tris = new Float32Array(worldTriangles(node)); if (!tris.length) return null; var c = new MeshCollider3D(tris, (o && o.cell) || 4); c.node = node; return this._addStatic(c, o); }
  /** Caja estática ajustada a la caja envolvente (en mundo) de un nodo: lo más barato para edificios y cajas */
  addBoxFromNode(node, o) {
    var b = new Box3(); node.updateWorldMatrix(); node.updateMatrixWorld();
    node.traverse(function (n) { if (n instanceof Mesh3D && n._geometry) { var gb = n._geometry.getBoundingBox(); if (gb.isEmpty) return; for (var i = 0; i < 8; i++) { _p3a.set(i & 1 ? gb.max.x : gb.min.x, i & 2 ? gb.max.y : gb.min.y, i & 4 ? gb.max.z : gb.min.z).applyMat4(n.matrixWorld); b.expandByPoint(_p3a); } } });
    if (b.isEmpty) return null;
    var c = this.addBox(b.getCenter(new Vec3()), b.getSize(new Vec3()).scale(0.5), null, o); c.node = node; return c;
  }
  removeStatic(c) { if (removeFromArray(this.statics, c)) { this._hashRemove(c); c.world = null; } return this; }
  _staticsIn(minx, minz, maxx, maxz, fn) {
    var cs = this.cell, ax = Math.floor(minx / cs), bx = Math.floor(maxx / cs), az = Math.floor(minz / cs), bz = Math.floor(maxz / cs), seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (var i = 0; i < this._big.length; i++) { var bc = this._big[i]; if (bc.enabled) fn(bc); }
    if ((bx - ax + 1) * (bz - az + 1) > 4096) { for (var s = 0; s < this.statics.length; s++) if (!this.statics[s]._big && this.statics[s].enabled) fn(this.statics[s]); return; }
    for (var x = ax; x <= bx; x++) for (var z = az; z <= bz; z++) {
      var l = this._sgrid.get(x + ',' + z); if (!l) continue;
      for (var j = 0; j < l.length; j++) { var c = l[j]; if (!c.enabled || seen.has(c)) continue; seen.add(c); fn(c); }
    }
  }
  /* ---------- dinámicos ---------- */
  addBody(node, o) { var b = new Body3D(this, node, o); this.bodies.push(b); return b; }
  addCharacter(node, o) { var c = new CharacterController3D(this, node, o); this.characters.push(c); return c; }
  addVehicle(node, o) { var v = new Vehicle3D(this, node, o); this.vehicles.push(v); return v; }
  addTrigger(o) { var t = new Trigger3D(this, o || {}); this.triggers.push(t); return t; }
  remove(obj) {
    if (obj instanceof Collider3D) return this.removeStatic(obj);
    removeFromArray(this.bodies, obj) || removeFromArray(this.characters, obj) || removeFromArray(this.vehicles, obj) || removeFromArray(this.triggers, obj);
    this.triggers.forEach(function (t) { t.inside.delete(obj); });
    obj.world = null;
    return this;
  }
  /* ---------- contactos de esfera ---------- */
  /** Empuja una esfera (centro c, radio r) fuera de la geometría estática. Llama onHit(normal, depth, collider) por contacto. */
  _resolveSphere(c, r, onHit, mask) {
    var self = this, hit = false;
    this._staticsIn(c.x - r, c.z - r, c.x + r, c.z + r, function (col) {
      if (mask !== undefined && (col.layer & mask) === 0) return;
      if (c.x + r < col.min.x || c.x - r > col.max.x || c.y + r < col.min.y || c.y - r > col.max.y || c.z + r < col.min.z || c.z - r > col.max.z) return;
      if (col.type === 'mesh') {
        var T = col.tris;
        col.query(c.x - r, c.y - r, c.z - r, c.x + r, c.y + r, c.z + r, function (o) {
          var p = closestPtTriangle(c.x, c.y, c.z, T, o, _p3b), dx = c.x - p.x, dy = c.y - p.y, dz = c.z - p.z, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= r * r) return;
          var d = Math.sqrt(d2), n;
          if (d > 1e-6) n = _p3n.set(dx / d, dy / d, dz / d);
          else { n = triNormal(T, o, _p3n); }
          var depth = r - d; c.x += n.x * depth; c.y += n.y * depth; c.z += n.z * depth; hit = true;
          if (onHit) onHit(n, depth, col);
        });
      } else if (col.type === 'box') {
        var q = col.closest(c, _p3b), dx2 = c.x - q.x, dy2 = c.y - q.y, dz2 = c.z - q.z, dd = dx2 * dx2 + dy2 * dy2 + dz2 * dz2, n2, dep;
        if (dd > 1e-12) { if (dd >= r * r) return; var dl = Math.sqrt(dd); n2 = _p3n.set(dx2 / dl, dy2 / dl, dz2 / dl); dep = r - dl; }
        else { dep = col.insideNormal(c, _p3n) + r; n2 = _p3n; }
        c.x += n2.x * dep; c.y += n2.y * dep; c.z += n2.z * dep; hit = true;
        if (onHit) onHit(n2, dep, col);
      } else if (col.type === 'sphere') {
        var sx = c.x - col.center.x, sy = c.y - col.center.y, sz = c.z - col.center.z, sd = Math.sqrt(sx * sx + sy * sy + sz * sz), rr = r + col.radius;
        if (sd >= rr) return;
        var n3 = sd > 1e-6 ? _p3n.set(sx / sd, sy / sd, sz / sd) : _p3n.set(0, 1, 0), dp = rr - sd;
        c.x += n3.x * dp; c.y += n3.y * dp; c.z += n3.z * dp; hit = true;
        if (onHit) onHit(n3, dp, col);
      }
    });
    void self;
    return hit;
  }
  /* ---------- paso ---------- */
  step(dt) {
    if (this.destroyed || this.paused || !(dt > 0)) return;
    this._acc += Math.min(dt, this.fixedStep * this.maxSubSteps);
    var n = 0;
    while (this._acc >= this.fixedStep - 1e-9 && n < this.maxSubSteps) { this._fixed(this.fixedStep); this._acc -= this.fixedStep; n++; }
    if (n === this.maxSubSteps) this._acc = 0;
    // sincroniza nodos
    for (var i = 0; i < this.bodies.length; i++) { var b = this.bodies[i]; if (b.node && !b.sleeping) b._sync(dt); }
    for (var c = 0; c < this.characters.length; c++) this.characters[c]._sync();
    for (var v = 0; v < this.vehicles.length; v++) this._syncVehicle(this.vehicles[v], dt);
  }
  _fixed(h) {
    this.time += h;
    for (var i = 0; i < this.characters.length; i++) if (this.characters[i].enabled) this._stepCharacter(this.characters[i], h);
    for (var v = 0; v < this.vehicles.length; v++) if (this.vehicles[v].enabled) this._stepVehicle(this.vehicles[v], h);
    this._vehicleContacts();
    this._stepBodies(h);
    this._stepTriggers();
    this.emit('step', h);
  }
  /* ---------- personaje ---------- */
  _capsuleResolve(ch, pos, info) {
    // la cápsula se aproxima con esferas apiladas (pies ... cabeza): robusto y barato
    var r = ch.radius, n = Math.max(2, Math.ceil((ch.height - 2 * r) / r) + 1), minY = Math.cos(ch.maxSlope);
    var c = _p3c, k = 0;
    var cb = function (nrm, depth) {
      if (k === 0 && nrm.y >= minY) {
        // suelo transitable: se separa en vertical (así no resbala en pendientes suaves ni se desvía al andar)
        info.ground = true; info.gn.copy(nrm);
        // separación vertical exacta de una esfera sobre un punto de contacto (sin rebotes en esquinas)
        var d = r - depth, dxz = d * Math.sqrt(Math.max(0, 1 - nrm.y * nrm.y)), up = Math.sqrt(Math.max(0, r * r - dxz * dxz)) - d * nrm.y;
        c.x -= nrm.x * depth; c.z -= nrm.z * depth; c.y += up - nrm.y * depth;
      } else if (nrm.y < -0.5) info.ceiling = true;
      else if (nrm.y < minY) { info.wall = true; info.wn.copy(nrm); }
    };
    for (var it = 0; it < 3; it++) {
      var any = false;
      for (k = 0; k < n; k++) {
        var y = r + (ch.height - 2 * r) * (k / (n - 1));
        c.set(pos.x, pos.y + y, pos.z);
        var ox = c.x, oy = c.y, oz = c.z;
        this._resolveSphere(c, r, cb, ch.mask);
        var dx = c.x - ox, dy = c.y - oy, dz = c.z - oz;
        if (dx || dy || dz) { any = true; pos.x += dx; pos.y += dy; pos.z += dz; }
      }
      if (!any) break;
    }
  }
  /** ¿Cabe una cápsula (pies en x,y,z) sin tocar geometría estática? (margen: tolerancia de contacto) */
  capsuleFree(x, y, z, radius, height, mask, margin) {
    var r = radius, n = Math.max(2, Math.ceil((height - 2 * r) / r) + 1), c = _vs3, free = true, tol = margin === undefined ? 0.01 : margin;
    for (var k = 0; k < n && free; k++) {
      c.set(x, y + r + (height - 2 * r) * (k / (n - 1)), z);
      this._resolveSphere(c, r, function (nrm, depth) { if (depth > tol) free = false; }, mask);
    }
    return free;
  }
  _tryVault(ch, dx, dz, o) {
    var l = Math.hypot(dx, dz); if (l < 1e-6) return false; dx /= l; dz /= l;
    var p = ch.position, maxH = o.maxHeight || ch.vaultHeight, reach = ch.radius + (o.reach || 0.7), mask = ch.mask, self = this;
    var ray = function (ox, oy, oz, rx, ry, rz, d) { return self.raycast(_vr3.set(ox, oy, oz), _vr4.set(rx, ry, rz), d, { bodies: false, mask: mask }); };
    // 1) pared u obstáculo delante (a la altura de las rodillas o de la cintura)
    var hit = ray(p.x, p.y + 0.4, p.z, dx, 0, dz, reach) || ray(p.x, p.y + 0.75, p.z, dx, 0, dz, reach);
    if (!hit || Math.abs(hit.normal.y) > 0.5) return false;
    var d = hit.distance;
    // 2) altura del borde superior (alféizar, valla, caja)
    var top = ray(p.x + dx * (d + 0.03), p.y + maxH + 0.15, p.z + dz * (d + 0.03), 0, -1, 0, maxH + 0.15);
    if (!top || top.normal.y < 0.7) return false;
    var ty = top.point.y, hgt = ty - p.y;
    if (hgt < 0.3 || hgt > maxH) return false;
    var cr = ch.crouchHeight, r = ch.radius;
    // 3a) saltar por encima (obstáculo fino: valla, ventana): suelo más bajo al otro lado y hueco libre para pasar agachado
    for (var t = 0.2; t <= 0.9; t += 0.175) {
      var qx = p.x + dx * (d + t + r), qz = p.z + dz * (d + t + r);
      if (!this.capsuleFree(p.x + dx * (d + t * 0.5 + 0.05), ty + 0.03, p.z + dz * (d + t * 0.5 + 0.05), r * 0.85, cr * 0.95, mask)) continue;
      var g = ray(qx, ty + 0.05, qz, 0, -1, 0, hgt + 1.6);
      if (!g || g.normal.y < 0.7 || g.point.y > ty - 0.25) continue;
      if (!this.capsuleFree(qx, g.point.y + 0.02, qz, r, cr, mask)) continue;
      return this._startVault(ch, 'vault', dx, dz, new Vec3(qx, g.point.y + 0.02, qz), ty, d, 0.42 + hgt * 0.1);
    }
    // 3b) trepar al borde (encima hay sitio para la cápsula agachada)
    var mx = p.x + dx * (d + r + 0.18), mz = p.z + dz * (d + r + 0.18);
    if (this.capsuleFree(mx, ty + 0.02, mz, r, cr, mask)) return this._startVault(ch, 'mantle', dx, dz, new Vec3(mx, ty + 0.02, mz), ty, d, 0.45 + hgt * 0.25);
    return false;
  }
  _startVault(ch, kind, dx, dz, to, ty, d, dur) {
    var from = ch.position.clone(), mid = new Vec3(from.x + dx * (d + 0.15), ty + 0.35, from.z + dz * (d + 0.15));
    ch.vaulting = { kind: kind, t: 0, dur: Math.max(0.2, dur), from: from, mid: mid, to: to, dx: dx, dz: dz, wasCrouching: ch.crouching };
    ch.crouching = true; ch.height = ch.crouchHeight; ch._wantStand = true; ch.velocity.set(0, 0, 0); ch.onGround = false; ch._aabb();
    ch.emit(kind, to.y - from.y);
    return true;
  }
  _stepVault(ch, h) {
    var V = ch.vaulting; V.t += h;
    var u = Math.min(1, V.t / V.dur), a = 1 - u, p = ch.position;
    // Bézier cuadrática: desde los pies, por encima del borde, hasta el aterrizaje
    p.x = a * a * V.from.x + 2 * a * u * V.mid.x + u * u * V.to.x; p.y = a * a * V.from.y + 2 * a * u * V.mid.y + u * u * V.to.y; p.z = a * a * V.from.z + 2 * a * u * V.mid.z + u * u * V.to.z;
    ch._aabb();
    if (u >= 1) {
      ch.vaulting = null; ch.onGround = true; ch._air = 0; ch.velocity.set(V.dx * 2.2, 0, V.dz * 2.2);
      if (!V.wasCrouching) ch._wantStand = true;
      ch.emit('vaultEnd', V.kind);
    }
  }
  _stepCharacter(ch, h) {
    if (ch.vaulting) { this._stepVault(ch, h); ch._move.set(0, 0, 0); return; }
    // levantarse cuando haya sitio encima
    if (ch.crouching && ch._wantStand && this.capsuleFree(ch.position.x, ch.position.y + 0.02, ch.position.z, ch.radius * 0.95, ch.standHeight, ch.mask)) { ch.crouching = false; ch._wantStand = false; ch.height = ch.standHeight; ch._aabb(); ch.emit('crouch', false); }
    var g = ch.gravity !== null ? ch.gravity : this.gravity.y, pos = ch.position, v = ch.velocity;
    var wasGround = ch.onGround;
    // velocidad horizontal: control total en suelo, parcial en el aire
    var ctrl = ch.onGround ? 1 : ch.airControl, k = Math.min(1, (ch.onGround ? 14 : 4) * h);
    v.x += (ch._move.x - v.x) * k * ctrl; v.z += (ch._move.z - v.z) * k * ctrl;
    if (ch._jump) { v.y = ch._jump; ch._jump = false; ch._air = ch.coyoteTime + 1; ch.onGround = false; ch.emit('jump'); }
    v.y += g * h;
    if (v.y < -60) v.y = -60;
    var dx = v.x * h, dy = v.y * h, dz = v.z * h;
    var dist = Math.sqrt(dx * dx + dy * dy + dz * dz), sub = Math.max(1, Math.ceil(dist / (ch.radius * 0.5)));
    var info = { ground: false, ceiling: false, wall: false, gn: new Vec3(0, 1, 0), wn: new Vec3() };
    var startY = pos.y;
    for (var s = 0; s < sub; s++) {
      pos.x += dx / sub; pos.y += dy / sub; pos.z += dz / sub;
      var wallBefore = info.wall; info.wall = false;
      this._capsuleResolve(ch, pos, info);
      // escalón: bloqueado por una pared estando en el suelo -> sondeo hacia delante y hacia abajo;
      // solo se sube si arriba hay suelo transitable a menos de stepHeight (las rampas empinadas no cuentan)
      if (info.wall && (wasGround || info.ground) && ch.stepHeight > 0) {
        var hx = dx, hz = dz, hl = Math.hypot(hx, hz);
        if (hl > 1e-6) {
          hx /= hl; hz /= hl;
          if (hx * info.wn.x + hz * info.wn.z < -0.2) {
            var reach = ch.radius + 0.12, top = pos.y + ch.stepHeight + 0.05;
            var sh = this.raycast(_vs1.set(pos.x + hx * reach, top, pos.z + hz * reach), _vs2.set(0, -1, 0), ch.stepHeight + 0.05, { bodies: false, mask: ch.mask });
            if (sh && sh.normal.y >= Math.cos(ch.maxSlope) && sh.point.y > pos.y + 0.005) {
              var test = _vs3.set(pos.x + hx * 0.04, sh.point.y + 0.005, pos.z + hz * 0.04), ti = { ground: false, ceiling: false, wall: false, gn: new Vec3(), wn: new Vec3() };
              this._capsuleResolve(ch, test, ti);
              if (!ti.ceiling && test.y >= sh.point.y - 0.02) { pos.copy(test); info.ground = true; info.wall = false; info.gn.set(0, 1, 0); if (v.y < 0) v.y = 0; ch.emit('step', sh.point.y - startY); }
            }
          }
        }
      }
      if (wallBefore) info.wall = true;
    }
    // pegarse al suelo al bajar escaleras/pendientes (sin saltar)
    if (!info.ground && wasGround && v.y <= 0) {
      var probe = new Vec3(pos.x, pos.y - ch.stepHeight - 0.05, pos.z), pinfo = { ground: false, ceiling: false, wall: false, gn: new Vec3(), wn: new Vec3() };
      this._capsuleResolve(ch, probe, pinfo);
      if (pinfo.ground && probe.y < pos.y) { pos.y = probe.y; info.ground = true; info.gn.copy(pinfo.gn); }
    }
    if (info.ground) { if (v.y < 0) v.y = 0; ch._air = 0; }
    else ch._air += h;
    if (info.ceiling && v.y > 0) v.y = 0;
    if (info.wall) { var wn = info.wn, vd = v.x * wn.x + v.z * wn.z; if (vd < 0) { v.x -= wn.x * vd; v.z -= wn.z * vd; } }
    var landed = info.ground && !wasGround;
    ch.onGround = info.ground; ch.groundNormal.copy(info.gn); ch.hitCeiling = info.ceiling; ch.hitWall = info.wall;
    if (landed) ch.emit('land', startY - pos.y);
    // empujar cuerpos dinámicos
    for (var b = 0; b < this.bodies.length; b++) {
      var bd = this.bodies[b]; if (!bd.enabled || bd.invMass === 0) continue;
      var cx = clamp(bd.position.x, pos.x - ch.radius, pos.x + ch.radius), cz = clamp(bd.position.z, pos.z - ch.radius, pos.z + ch.radius), cy = clamp(bd.position.y, pos.y, pos.y + ch.height);
      var rr = bd.shape === 'sphere' ? bd.radius : Math.max(bd.half.x, bd.half.z);
      var ex = bd.position.x - pos.x, ez = bd.position.z - pos.z, ed = Math.hypot(ex, ez), lim = ch.radius + rr;
      if (ed < lim && ed > 1e-5 && Math.abs(cy - bd.position.y) < (bd.shape === 'sphere' ? bd.radius : bd.half.y) + 0.05) {
        var push = (lim - ed); bd.position.x += ex / ed * push; bd.position.z += ez / ed * push; bd.velocity.x += ex / ed * ch.pushForce * bd.invMass; bd.velocity.z += ez / ed * ch.pushForce * bd.invMass; bd.wake(); bd._aabb();
        ch.emit('push', bd);
      }
      void cx; void cz;
    }
    if (pos.y < this.killY) ch.emit('fall');
    ch._move.set(0, 0, 0);
    ch._aabb();
  }
  /* ---------- vehículo ---------- */
  _groundAt(x, y, z, maxDown, mask) {
    var hit = this.raycast(_p3d.set(x, y, z), _p3a.set(0, -1, 0), maxDown, { mask: mask, statics: true, bodies: false });
    return hit;
  }
  _stepVehicle(car, h) {
    var fwdX = Math.sin(car.heading), fwdZ = Math.cos(car.heading);
    // tracción / frenado / resistencia
    if (car.onGround) {
      if (car.braking) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), car.brake * h);
      if (car.throttle > 0) car.speed += car.accel * car.throttle * h * (car.speed < 0 ? 2 : 1);
      else if (car.throttle < 0) car.speed += car.accel * car.throttle * h * (car.speed > 0 ? 2 : 0.7);
      car.speed -= car.speed * car.drag * 0.1 * h * (car.throttle === 0 ? 3 : 1);
      car.speed = clamp(car.speed, -car.reverseSpeed, car.maxSpeed);
      // giro proporcional a la velocidad (a baja velocidad gira menos)
      var sf = clamp(Math.abs(car.speed) / 6, 0, 1) * (car.speed >= 0 ? 1 : -1);
      var turn = car.steer * car.turnRate * sf * (car.handbrake ? 1.6 : 1) * (1 - 0.35 * clamp(Math.abs(car.speed) / car.maxSpeed, 0, 1));
      car.heading += turn * h;
      // derrape: la velocidad lateral decae según el agarre
      car.side += -turn * car.speed * 0.25 * h * (car.handbrake ? 3 : 1);
      car.side -= car.side * Math.min(1, car.grip * (car.handbrake ? 0.25 : 1) * h);
      car.drifting = Math.abs(car.side) > 2.5;
    } else car.side *= 1 - Math.min(1, 0.5 * h);
    fwdX = Math.sin(car.heading); fwdZ = Math.cos(car.heading);
    var rx = fwdZ, rz = -fwdX; // lateral izquierdo del coche (frente +Z => izquierda +X)
    var p = car.position;
    var mx = (fwdX * car.speed + rx * car.side) * h, mz = (fwdZ * car.speed + rz * car.side) * h;
    // colisión horizontal: dos esferas (morro y cola) a media altura
    var steps = Math.max(1, Math.ceil(Math.hypot(mx, mz) / (car.radius * 0.5))), info = { hit: false, n: new Vec3() };
    for (var s = 0; s < steps; s++) {
      p.x += mx / steps; p.z += mz / steps;
      for (var e = -1; e <= 1; e += 2) {
        var off = (car.length * 0.5 - car.radius * 0.9) * e, c = _p3c.set(p.x + fwdX * off, p.y + car.radius + 0.25, p.z + fwdZ * off), ox = c.x, oz = c.z;
        this._resolveSphere(c, car.radius, function (n) { if (Math.abs(n.y) < 0.6) { info.hit = true; info.n.copy(n); } }, car.mask);
        // solo empuje horizontal (el suelo lo gestiona la suspensión)
        p.x += c.x - ox; p.z += c.z - oz;
      }
    }
    if (info.hit) {
      var nd = fwdX * info.n.x + fwdZ * info.n.z, impact = Math.abs(car.speed * nd);
      if (nd < -0.3) car.speed *= 0.5; else car.speed *= 0.97;
      car.side *= 0.5;
      if (impact > 3) car.emit('crash', impact);
    }
    // suspensión: rayos en las 4 ruedas
    var hl = car.length * 0.4, hw = car.width * 0.45, top = p.y + 2, hs = [], gsum = 0, gn = 0;
    for (var wi = 0; wi < 4; wi++) {
      var fx = wi < 2 ? hl : -hl, sx = wi % 2 ? hw : -hw;
      var wx = p.x + fwdX * fx + rx * sx, wz = p.z + fwdZ * fx + rz * sx;
      var hit = this._groundAt(wx, top, wz, 2 + car.rideHeight + 1.5, car.mask);
      hs.push(hit ? top - hit.distance : null);
      if (hit) { gsum += top - hit.distance; gn++; }
    }
    car.vy += this.gravity.y * h;
    var target = gn ? gsum / gn : -Infinity;
    if (gn && p.y + car.vy * h <= target + 0.05) { p.y = target; if (car.vy < -8) car.emit('land', -car.vy); car.vy = 0; car.onGround = true; }
    else { p.y += car.vy * h; car.onGround = gn > 0 && p.y - target < 0.3; }
    // inclinación a partir de las alturas de las ruedas
    // ruedas 0,1 delante; impares a la izquierda (el lateral (rx, rz) apunta a la izquierda del coche)
    var hFront = avgDefined(hs[0], hs[1], p.y), hBack = avgDefined(hs[2], hs[3], p.y), hLeft = avgDefined(hs[1], hs[3], p.y), hRight = avgDefined(hs[0], hs[2], p.y);
    var tp = Math.atan2(hBack - hFront, hl * 2), tr = Math.atan2(hLeft - hRight, hw * 2);
    car.pitch += (tp - car.pitch) * Math.min(1, 10 * h); car.roll += (tr - car.roll) * Math.min(1, 10 * h);
    car._spin += car.speed * h / car.wheelRadius;
    if (p.y < this.killY) car.emit('fall');
    car._aabb();
  }
  /** Coche contra coche (dos círculos por coche: morro y cola) y coche contra personaje (atropello/empujón) */
  _vehicleContacts() {
    var V = this.vehicles, C = this.characters, i, j, a, b;
    for (i = 0; i < V.length; i++) for (j = i + 1; j < V.length; j++) {
      a = V[i]; b = V[j];
      if (!a.enabled || !b.enabled || (a.layer & b.mask) === 0 || (b.layer & a.mask) === 0) continue;
      if (Math.abs(a.position.y - b.position.y) > 2.5) continue;
      var dx0 = b.position.x - a.position.x, dz0 = b.position.z - a.position.z, reach = (a.length + b.length) * 0.55;
      if (dx0 * dx0 + dz0 * dz0 > reach * reach) continue;
      var best = null;
      for (var ea = -1; ea <= 1; ea += 2) for (var eb = -1; eb <= 1; eb += 2) {
        var oa = (a.length * 0.5 - a.radius * 0.9) * ea, ob = (b.length * 0.5 - b.radius * 0.9) * eb;
        var ax = a.position.x + Math.sin(a.heading) * oa, az = a.position.z + Math.cos(a.heading) * oa, bx = b.position.x + Math.sin(b.heading) * ob, bz = b.position.z + Math.cos(b.heading) * ob;
        var dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz), rr = a.radius + b.radius;
        if (d < rr && (!best || rr - d > best.pen)) best = { pen: rr - d, nx: d > 1e-6 ? dx / d : 1, nz: d > 1e-6 ? dz / d : 0 };
      }
      if (!best) continue;
      a.position.x -= best.nx * best.pen * 0.5; a.position.z -= best.nz * best.pen * 0.5; b.position.x += best.nx * best.pen * 0.5; b.position.z += best.nz * best.pen * 0.5;
      // intercambio de velocidad a lo largo de la normal (masas iguales)
      var va = Math.sin(a.heading) * a.speed * best.nx + Math.cos(a.heading) * a.speed * best.nz, vb = Math.sin(b.heading) * b.speed * best.nx + Math.cos(b.heading) * b.speed * best.nz;
      var rel = va - vb;
      if (rel > 0) {
        a.speed -= rel * 0.5 * (Math.sin(a.heading) * best.nx + Math.cos(a.heading) * best.nz); b.speed += rel * 0.5 * (Math.sin(b.heading) * best.nx + Math.cos(b.heading) * best.nz);
        if (rel > 3) { a.emit('crash', rel, b); b.emit('crash', rel, a); }
      }
      a._aabb(); b._aabb();
    }
    for (i = 0; i < V.length; i++) {
      a = V[i]; if (!a.enabled) continue;
      for (j = 0; j < C.length; j++) {
        var ch = C[j]; if (!ch.enabled || (a.layer & ch.mask) === 0 || (ch.layer & a.mask) === 0) continue;
        if (ch.position.y > a.position.y + 1.6 || ch.position.y + ch.height < a.position.y) continue;
        // caja orientada del coche contra el círculo del personaje
        var lx = ch.position.x - a.position.x, lz = ch.position.z - a.position.z, s = Math.sin(a.heading), c = Math.cos(a.heading);
        var fwd = lx * s + lz * c, side = lx * c - lz * s, hl = a.length / 2, hw = a.width / 2;
        var qf = clamp(fwd, -hl, hl), qs = clamp(side, -hw, hw), ex = fwd - qf, es = side - qs, dist = Math.hypot(ex, es);
        if (dist >= ch.radius) continue;
        var nf, ns, pen;
        if (dist > 1e-6) { nf = ex / dist; ns = es / dist; pen = ch.radius - dist; }
        else { var pf = hl - Math.abs(fwd), ps = hw - Math.abs(side); if (pf < ps) { nf = Math.sign(fwd) || 1; ns = 0; pen = pf + ch.radius; } else { nf = 0; ns = Math.sign(side) || 1; pen = ps + ch.radius; } }
        var wx = nf * s + ns * c, wz = nf * c - ns * s;
        ch.position.x += wx * pen; ch.position.z += wz * pen; ch._aabb();
        var impact = Math.abs(a.speed) * Math.abs(nf) + Math.abs(a.side) * Math.abs(ns);
        // un impacto por personaje cada 0.6 s (si no, un coche que lo alcanza lo lanzaría cada frame)
        if (impact > 2 && this.time - (ch._vhitT === undefined ? -1 : ch._vhitT) > 0.6) {
          ch._vhitT = this.time;
          var k = Math.min(impact, 25) * 0.8;
          ch.velocity.x = wx * k + a.speed * s * 0.5; ch.velocity.z = wz * k + a.speed * c * 0.5; ch.velocity.y = Math.min(7, 2 + impact * 0.25);
          a.emit('hit', ch, impact); ch.emit('hitByVehicle', a, impact); a.speed *= 0.85;
        }
      }
    }
  }
  _syncVehicle(car, dt) {
    var n = car.node; if (!n) return;
    var q = _vq1.setFromEuler(car.pitch, car.heading, car.roll, 'YXZ');
    n.quaternion.copy(q);
    if (n.parent) { n.parent.updateWorldMatrix(); _p3m.invertFrom(n.parent.matrixWorld); n.position.copy(car.position).applyMat4(_p3m); } else n.position.copy(car.position);
    n.position.y += car.rideHeight;
    if (car.wheels) for (var i = 0; i < car.wheels.length; i++) { var w = car.wheels[i]; if (!w) continue; w.rotation.x = car._spin; if (i < 2) w.rotation.y = car.steer * 0.5; }
    void dt;
  }
  /* ---------- cuerpos ---------- */
  _stepBodies(h) {
    var B = this.bodies, g = this.gravity, i, j;
    for (i = 0; i < B.length; i++) {
      var b = B[i]; if (!b.enabled || b.sleeping || b.invMass === 0) continue;
      b.velocity.x += g.x * b.gravityScale * h; b.velocity.y += g.y * b.gravityScale * h; b.velocity.z += g.z * b.gravityScale * h;
      var damp = Math.max(0, 1 - b.linearDamping * h); b.velocity.scale(damp);
      var dx = b.velocity.x * h, dy = b.velocity.y * h, dz = b.velocity.z * h, ext = b.shape === 'sphere' ? b.radius : Math.min(b.half.x, b.half.y, b.half.z);
      var sub = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy + dz * dz) / (ext * 0.5)));
      b.onGround = false;
      for (var s = 0; s < sub; s++) {
        b.position.x += dx / sub; b.position.y += dy / sub; b.position.z += dz / sub;
        this._bodyVsStatic(b);
      }
      if (b.position.y < this.killY) { b.emit('fall'); b.sleeping = true; }
      b._aabb();
    }
    // cuerpo contra cuerpo
    for (i = 0; i < B.length; i++) for (j = i + 1; j < B.length; j++) {
      var a = B[i], c = B[j];
      if (!a.enabled || !c.enabled || (a.sleeping && c.sleeping) || (a.invMass + c.invMass === 0)) continue;
      if ((a.layer & c.mask) === 0 || (c.layer & a.mask) === 0) continue;
      if (a.max.x < c.min.x || a.min.x > c.max.x || a.max.y < c.min.y || a.min.y > c.max.y || a.max.z < c.min.z || a.min.z > c.max.z) continue;
      this._bodyPair(a, c);
    }
    // reposo
    for (i = 0; i < B.length; i++) {
      var d = B[i]; if (d.sleeping || d.invMass === 0) continue;
      if (d.velocity.lengthSq() < 0.01 && d.onGround) { if ((d._still += h) > 0.5) { d.sleeping = true; d.velocity.set(0, 0, 0); d.emit('sleep'); } } else d._still = 0;
    }
  }
  _bodyVsStatic(b) {
    var self = this;
    var onHit = function (n, depth, col) {
      var vn = b.velocity.dot(n);
      if (vn < 0) {
        var e = Math.max(b.restitution, col.restitution || 0), f = Math.min(1, (b.friction + (col.friction || 0)) * 0.5);
        b.velocity.addScaled(n, -(1 + (Math.abs(vn) > 1 ? e : 0)) * vn);
        // fricción tangencial
        var tx = b.velocity.x - n.x * b.velocity.dot(n), ty = b.velocity.y - n.y * b.velocity.dot(n), tz = b.velocity.z - n.z * b.velocity.dot(n);
        var k = Math.max(0, 1 - f * 0.15); b.velocity.x -= tx * (1 - k); b.velocity.y -= ty * (1 - k); b.velocity.z -= tz * (1 - k);
        if (Math.abs(vn) > 2) b.emit('collide', col, -vn);
      }
      if (n.y > 0.6) b.onGround = true;
      void depth;
    };
    if (b.shape === 'sphere') this._resolveSphere(b.position, b.radius, onHit, b.mask);
    else {
      // caja AABB: se aproxima con esferas en las esquinas inferiores + centro (estable sobre suelos y rampas)
      var hx = b.half.x, hy = b.half.y, hz = b.half.z, r = Math.min(hx, hy, hz), p = b.position;
      var pts = [[0, 0, 0], [hx - r, -(hy - r), hz - r], [-(hx - r), -(hy - r), hz - r], [hx - r, -(hy - r), -(hz - r)], [-(hx - r), -(hy - r), -(hz - r)], [hx - r, hy - r, hz - r], [-(hx - r), hy - r, -(hz - r)]];
      for (var i = 0; i < pts.length; i++) {
        var c = _p3c.set(p.x + pts[i][0], p.y + pts[i][1], p.z + pts[i][2]), ox = c.x, oy = c.y, oz = c.z;
        this._resolveSphere(c, r, onHit, b.mask);
        p.x += c.x - ox; p.y += c.y - oy; p.z += c.z - oz;
      }
    }
    void self;
  }
  _bodyPair(a, c) {
    var n = _p3n, depth = 0;
    if (a.shape === 'sphere' && c.shape === 'sphere') {
      n.subVectors(c.position, a.position); var d = n.length(), rr = a.radius + c.radius;
      if (d >= rr) return; if (d < 1e-6) n.set(0, 1, 0); else n.scale(1 / d); depth = rr - d;
    } else if (a.shape === 'box' && c.shape === 'box') {
      var ox = Math.min(a.max.x, c.max.x) - Math.max(a.min.x, c.min.x), oy = Math.min(a.max.y, c.max.y) - Math.max(a.min.y, c.min.y), oz = Math.min(a.max.z, c.max.z) - Math.max(a.min.z, c.min.z);
      if (ox <= 0 || oy <= 0 || oz <= 0) return;
      if (ox <= oy && ox <= oz) { n.set(c.position.x > a.position.x ? 1 : -1, 0, 0); depth = ox; } else if (oy <= oz) { n.set(0, c.position.y > a.position.y ? 1 : -1, 0); depth = oy; } else { n.set(0, 0, c.position.z > a.position.z ? 1 : -1); depth = oz; }
    } else {
      var sph = a.shape === 'sphere' ? a : c, box = sph === a ? c : a;
      var px = clamp(sph.position.x, box.min.x, box.max.x), py = clamp(sph.position.y, box.min.y, box.max.y), pz = clamp(sph.position.z, box.min.z, box.max.z);
      n.set(sph.position.x - px, sph.position.y - py, sph.position.z - pz); var dl = n.length();
      if (dl >= sph.radius) return;
      if (dl < 1e-6) n.set(0, 1, 0); else n.scale(1 / dl);
      depth = sph.radius - dl;
      if (sph === a) n.negate(); // n siempre de a hacia c
    }
    var tot = a.invMass + c.invMass; if (tot <= 0) return;
    a.position.addScaled(n, -depth * a.invMass / tot); c.position.addScaled(n, depth * c.invMass / tot);
    var rv = (c.velocity.x - a.velocity.x) * n.x + (c.velocity.y - a.velocity.y) * n.y + (c.velocity.z - a.velocity.z) * n.z;
    if (rv < 0) {
      var e = Math.min(a.restitution, c.restitution), j = -(1 + e) * rv / tot;
      a.velocity.addScaled(n, -j * a.invMass); c.velocity.addScaled(n, j * c.invMass);
      if (-rv > 2) { a.emit('collide', c, -rv); c.emit('collide', a, -rv); }
    }
    if (n.y < -0.6) a.onGround = true; else if (n.y > 0.6) c.onGround = true;
    a.wake(); c.wake(); a._aabb(); c._aabb();
  }
  _stepTriggers() {
    var all = this._trigObjs || (this._trigObjs = []);
    all.length = 0;
    Array.prototype.push.apply(all, this.characters); Array.prototype.push.apply(all, this.bodies); Array.prototype.push.apply(all, this.vehicles);
    for (var i = 0; i < this.triggers.length; i++) {
      var t = this.triggers[i]; if (!t.enabled || t.destroyed) continue;
      for (var k = 0; k < all.length; k++) {
        var o = all[k]; if (!o.enabled) continue;
        var inn = t._test(o), was = t.inside.has(o);
        if (inn && !was) { t.inside.add(o); t.emit('enter', o); if (t.once) { t.enabled = false; break; } }
        else if (!inn && was) { t.inside.delete(o); t.emit('exit', o); }
      }
    }
  }
  /* ---------- consultas ---------- */
  /**
   * Rayo contra el mundo. options: { mask, statics (true), bodies (true), characters (false), vehicles (false), ignore }
   * Devuelve { point, normal, distance, collider|body|character|vehicle } o null
   */
  raycast(origin, dir, maxDist, options) {
    options = options || {};
    var d = _vr1.copy(dir); var dl = d.length(); if (dl < 1e-12) return null; d.scale(1 / dl);
    var max = maxDist > 0 ? maxDist : 1000, best = null, mask = options.mask === undefined ? -1 : options.mask, ign = options.ignore || null, o = _vr2.copy(origin);
    var consider = function (r, extra) { if (r && r.distance >= 0 && r.distance <= max && (!best || r.distance < best.distance)) { best = r; for (var k in extra) best[k] = extra[k]; } };
    if (options.statics !== false) {
      var ex = o.x + d.x * max, ez = o.z + d.z * max;
      this._staticsIn(Math.min(o.x, ex), Math.min(o.z, ez), Math.max(o.x, ex), Math.max(o.z, ez), function (c) {
        if ((c.layer & mask) === 0 || c === ign) return;
        consider(c.raycast(o, d, best ? best.distance : max), { collider: c });
      });
    }
    var sphereHit = function (p, r) { _sphTmp.center.copy(p); _sphTmp.radius = r; _rayTmp.origin.copy(o); _rayTmp.direction.copy(d); var t = _rayTmp.intersectSphere(_sphTmp); if (t === null) return null; return { distance: t, normal: _rayTmp.at(t, new Vec3()).sub(p).normalize() }; };
    var boxHit = function (mn, mxv) { _box3Tmp.min.copy(mn); _box3Tmp.max.copy(mxv); _rayTmp.origin.copy(o); _rayTmp.direction.copy(d); var t = _rayTmp.intersectBox(_box3Tmp); if (t === null) return null; var p = _rayTmp.at(t, new Vec3()), c = new Vec3().addVectors(mn, mxv).scale(0.5), hsz = new Vec3().subVectors(mxv, mn).scale(0.5), l = p.clone().sub(c); var ax = Math.abs(l.x / hsz.x), ay = Math.abs(l.y / hsz.y), az = Math.abs(l.z / hsz.z); var n = ax >= ay && ax >= az ? new Vec3(Math.sign(l.x), 0, 0) : (ay >= az ? new Vec3(0, Math.sign(l.y), 0) : new Vec3(0, 0, Math.sign(l.z))); return { distance: t, normal: n }; };
    if (options.bodies !== false) for (var i = 0; i < this.bodies.length; i++) { var b = this.bodies[i]; if (!b.enabled || (b.layer & mask) === 0 || b === ign) continue; consider(b.shape === 'sphere' ? sphereHit(b.position, b.radius) : boxHit(b.min, b.max), { body: b }); }
    if (options.characters) for (var c2 = 0; c2 < this.characters.length; c2++) {
      var ch = this.characters[c2]; if (!ch.enabled || (ch.layer & mask) === 0 || ch === ign) continue;
      // cápsula aproximada por su segmento: rayo vs cilindro+esferas mediante 3 esferas
      var bestC = null;
      for (var s = 0; s < 3; s++) { var r = sphereHit(_p3c.set(ch.position.x, ch.position.y + ch.radius + (ch.height - 2 * ch.radius) * s / 2, ch.position.z), ch.radius); if (r && (!bestC || r.distance < bestC.distance)) bestC = r; }
      consider(bestC, { character: ch });
    }
    if (options.vehicles) for (var v = 0; v < this.vehicles.length; v++) { var car = this.vehicles[v]; if (!car.enabled || (car.layer & mask) === 0 || car === ign) continue; consider(boxHit(car.min, car.max), { vehicle: car }); }
    if (best) best.point = new Vec3().copy(o).addScaled(d, best.distance);
    return best;
  }
  /** ¿Hay línea de visión entre a y b? (solo estáticos) */
  lineOfSight(a, b, mask) { var d = _vr3.subVectors(b, a), l = d.length(); if (l < 1e-6) return true; var h = this.raycast(a, d, l, { mask: mask, bodies: false }); return !h || h.distance >= l - 1e-3; }
  /** Altura del suelo bajo (x, z) buscando desde y hacia abajo (o null) */
  groundHeight(x, z, fromY, maxDown) { var h = this.raycast(_vr3.set(x, fromY === undefined ? 1000 : fromY, z), _vr4.set(0, -1, 0), maxDown || 2000, { bodies: false }); return h ? h.point.y : null; }
  /** Objetos (cuerpos/personajes/vehículos) dentro de una esfera */
  overlapSphere(center, radius) {
    var out = [], r2 = radius * radius, test = function (o) { var cx = clamp(center.x, o.min.x, o.max.x), cy = clamp(center.y, o.min.y, o.max.y), cz = clamp(center.z, o.min.z, o.max.z), dx = cx - center.x, dy = cy - center.y, dz = cz - center.z; if (dx * dx + dy * dy + dz * dz <= r2) out.push(o); };
    this.bodies.forEach(test); this.characters.forEach(test); this.vehicles.forEach(test);
    return out;
  }
  /** Explosión: impulso radial a los cuerpos dinámicos */
  explode(center, radius, force) {
    var self = this;
    this.overlapSphere(center, radius).forEach(function (o) {
      var d = new Vec3().subVectors(o.position, center), l = d.length() || 1, k = force * (1 - l / radius);
      if (k <= 0) return;
      d.scale(1 / l); d.y += 0.5;
      if (o instanceof Body3D) o.applyImpulse(d.x * k, d.y * k, d.z * k);
      else if (o instanceof CharacterController3D) { o.velocity.addScaled(d, k * 0.3); }
      self.emit('explosion-hit', o, k);
    });
  }
  clear() {
    var all = [].concat(this.bodies, this.characters, this.vehicles, this.triggers);
    all.forEach(function (o) { o.destroy(); });
    this.statics.forEach(function (c) { c.world = null; });
    this.statics.length = 0; this._sgrid.clear(); this._big.length = 0;
    return this;
  }
  destroy() { if (this.destroyed) return; this.clear(); this.destroyed = true; this.removeAllListeners(); Debug.track('PhysicsWorld3D', -1); }
}
var _vs1 = new Vec3(), _vs2 = new Vec3(), _vs3 = new Vec3(), _vq1 = new Quat(), _vr1 = new Vec3(), _vr2 = new Vec3(), _vr3 = new Vec3(), _vr4 = new Vec3(), _box3Tmp = new Box3();
function avgDefined(a, b, def) { if (a !== null && b !== null) return (a + b) / 2; if (a !== null) return a; if (b !== null) return b; return def; }

/** view.enablePhysics(opciones): crea el mundo físico de la vista (se actualiza solo) */
View3D.prototype.enablePhysics = function (o) { if (!this.physics) this.physics = new PhysicsWorld3D(o); return this.physics; };

UG.PhysicsWorld3D = PhysicsWorld3D; UG.Body3D = Body3D; UG.CharacterController3D = CharacterController3D; UG.Vehicle3D = Vehicle3D; UG.Trigger3D = Trigger3D;
UG.Collider3D = Collider3D; UG.BoxCollider3D = BoxCollider3D; UG.SphereCollider3D = SphereCollider3D; UG.MeshCollider3D = MeshCollider3D; UG.worldTriangles = worldTriangles; UG.closestPtTriangle = closestPtTriangle;
void closestPtSegment;
