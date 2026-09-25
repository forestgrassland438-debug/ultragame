/* UltraGame - física 2D de cuerpos rígidos (al estilo Box2D, sin dependencias):
 * - Formas: círculos y polígonos convexos (cajas incluidas); cuerpos compuestos (varias formas) y polígonos cóncavos
 *   (se triangulan con earcut y se agrupan en el mismo cuerpo).
 * - Colisión: SAT con recorte de aristas (hasta 2 puntos de contacto), círculo-polígono y círculo-círculo.
 * - Solver: impulsos secuenciales con arranque en caliente (warm starting), fricción de Coulomb, restitución,
 *   corrección de posición (Baumgarte + pasada posicional), islas que se duermen y despiertan.
 * - Uniones: distancia (barra o muelle), bisagra (con motor y límites), soldadura, ratón (arrastrar).
 * - Sensores, filtros por categoría/máscara/grupo, eventos, rayos, consultas por punto y por caja, suelos desde tilemaps.
 * Unidades: píxeles, segundos y radianes (ángulo positivo = sentido horario en pantalla, igual que rotation). */

// RB_MARGIN: margen de contacto (los contactos persisten con un hueco pequeño: arranque en caliente estable en pilas)
var RB_MARGIN = 0.8, RB_SLOP = 0.4, RB_BAUM = 0.2, RB_MAXCORR = 6, RB_RESTVEL = 120, RB_SLEEPVEL = 6, RB_SLEEPANG = 0.05, RB_SLEEPT = 0.6;
function rbCross(ax, ay, bx, by) { return ax * by - ay * bx; }

/* ================================================================== formas */
class RigidShape2D {
  /** o: { type: 'circle'|'poly', radius, vertices: [x0,y0,x1,y1...] | [{x,y}], x, y (desplazamiento local), friction, restitution, density, sensor } */
  constructor(o) {
    this.type = o.type === 'circle' ? 'circle' : 'poly';
    this.x = +o.x || 0; this.y = +o.y || 0;
    this.radius = Math.max(0.5, +o.radius || 10);
    this.friction = o.friction === undefined ? 0.4 : +o.friction; this.restitution = o.restitution === undefined ? 0 : +o.restitution;
    this.density = o.density === undefined ? 0.001 : Math.max(0, +o.density); this.sensor = !!o.sensor;
    this.v = []; this.n = [];
    if (this.type === 'poly') this._setVerts(o.vertices || []);
    this.body = null; this.wv = []; this.wn = []; this.min = new Vec2(); this.max = new Vec2();
  }
  _setVerts(src) {
    var pts = [], i;
    if (src.length && typeof src[0] === 'number') for (i = 0; i + 1 < src.length; i += 2) pts.push({ x: +src[i], y: +src[i + 1] });
    else for (i = 0; i < src.length; i++) pts.push({ x: +src[i].x, y: +src[i].y });
    // casco convexo (monotone chain) para aceptar cualquier orden; como mínimo un triángulo
    pts.sort(function (a, b) { return a.x - b.x || a.y - b.y; });
    var hull = [], k;
    var cross = function (o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); };
    for (i = 0; i < pts.length; i++) { while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], pts[i]) <= 0) hull.pop(); hull.push(pts[i]); }
    for (i = pts.length - 2, k = hull.length + 1; i >= 0; i--) { while (hull.length >= k && cross(hull[hull.length - 2], hull[hull.length - 1], pts[i]) <= 0) hull.pop(); hull.push(pts[i]); }
    hull.pop();
    if (hull.length < 3) hull = [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }];
    if (hull.length > 32) hull.length = 32;
    // orientación con área positiva en coordenadas de pantalla (y hacia abajo): normal exterior = (e.y, -e.x)
    var area = 0; for (i = 0; i < hull.length; i++) { var a = hull[i], b = hull[(i + 1) % hull.length]; area += a.x * b.y - b.x * a.y; }
    if (area < 0) hull.reverse();
    this.v = hull.map(function (p) { return new Vec2(p.x, p.y); });
    this.n = this.v.map(function (p, j, arr) { var q = arr[(j + 1) % arr.length], ex = q.x - p.x, ey = q.y - p.y, l = Math.hypot(ex, ey) || 1; return new Vec2(ey / l, -ex / l); });
  }
  /** Área, centroide (local al cuerpo) e inercia respecto al centroide propio */
  massData() {
    if (this.type === 'circle') { var a0 = Math.PI * this.radius * this.radius; return { area: a0, cx: this.x, cy: this.y, I: a0 * this.radius * this.radius * 0.5 }; }
    var A = 0, cx = 0, cy = 0, I = 0, v = this.v, n = v.length, ox = v[0].x, oy = v[0].y;
    for (var i = 1; i + 1 < n; i++) {
      var e1x = v[i].x - ox, e1y = v[i].y - oy, e2x = v[i + 1].x - ox, e2y = v[i + 1].y - oy, d = rbCross(e1x, e1y, e2x, e2y), ta = d * 0.5;
      A += ta; cx += ta * (e1x + e2x) / 3; cy += ta * (e1y + e2y) / 3;
      var intx2 = e1x * e1x + e2x * e1x + e2x * e2x, inty2 = e1y * e1y + e2y * e1y + e2y * e2y; I += (0.25 / 3 * d) * (intx2 + inty2);
    }
    if (A < 1e-6) return { area: 0, cx: this.x, cy: this.y, I: 0 };
    cx /= A; cy /= A;
    // I respecto al centroide del polígono: I(origen v0) - A*|c|^2
    I = I - A * (cx * cx + cy * cy);
    return { area: A, cx: cx + ox + this.x, cy: cy + oy + this.y, I: Math.max(I, 1e-6) };
  }
  /** Actualiza vértices/normales en mundo y la caja envolvente */
  _world() {
    var b = this.body, c = b._cos, s = b._sin, px = b.position.x, py = b.position.y, lx = this.x - b._lc.x, ly = this.y - b._lc.y;
    if (this.type === 'circle') {
      var wx = px + c * lx - s * ly, wy = py + s * lx + c * ly; this.wc = this.wc || new Vec2(); this.wc.set(wx, wy);
      var rm = this.radius + RB_MARGIN; this.min.set(wx - rm, wy - rm); this.max.set(wx + rm, wy + rm); return;
    }
    var v = this.v, n = this.n, W = this.wv, N = this.wn, minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (var i = 0; i < v.length; i++) {
      var x = v[i].x + lx, y = v[i].y + ly, X = px + c * x - s * y, Y = py + s * x + c * y;
      if (!W[i]) { W[i] = new Vec2(); N[i] = new Vec2(); }
      W[i].set(X, Y); N[i].set(c * n[i].x - s * n[i].y, s * n[i].x + c * n[i].y);
      if (X < minx) minx = X; if (X > maxx) maxx = X; if (Y < miny) miny = Y; if (Y > maxy) maxy = Y;
    }
    W.length = N.length = v.length;
    this.min.set(minx - RB_MARGIN, miny - RB_MARGIN); this.max.set(maxx + RB_MARGIN, maxy + RB_MARGIN);
  }
}

/* ================================================================== cuerpos */
class RigidBody2D extends EventEmitter {
  constructor(world, o) {
    super();
    o = o || {};
    this.world = world; this.id = uid(); this.label = o.label || '';
    this.type = o.isStatic || o.type === 'static' ? 'static' : (o.type === 'kinematic' ? 'kinematic' : 'dynamic');
    this.position = new Vec2(+o.x || 0, +o.y || 0); this.angle = +o.angle || 0;
    this.velocity = new Vec2(o.vx || 0, o.vy || 0); this.angularVelocity = +o.angularVelocity || 0;
    this.force = new Vec2(); this.torque = 0;
    this.linearDamping = o.linearDamping === undefined ? 0.02 : +o.linearDamping; this.angularDamping = o.angularDamping === undefined ? 0.05 : +o.angularDamping;
    this.gravityScale = o.gravityScale === undefined ? 1 : +o.gravityScale; this.fixedRotation = !!o.fixedRotation; this.bullet = !!o.bullet;
    this.category = o.category === undefined ? 1 : o.category | 0; this.mask = o.mask === undefined ? -1 : o.mask | 0; this.group = o.group | 0;
    this.sleeping = false; this.canSleep = o.canSleep !== false; this._sleepT = 0;
    this.shapes = []; this.mass = 0; this.invMass = 0; this.inertia = 0; this.invI = 0; this._lc = new Vec2(); this._cos = Math.cos(this.angle); this._sin = Math.sin(this.angle);
    this.gameObject = o.gameObject || null; this.userData = o.userData || {}; this.enabled = true; this.destroyed = false;
    this.min = new Vec2(); this.max = new Vec2();
  }
  get isStatic() { return this.type === 'static'; }
  addShape(o) { var s = o instanceof RigidShape2D ? o : new RigidShape2D(o); s.body = this; this.shapes.push(s); this._mass(); this._sync(); return s; }
  _mass() {
    var m = 0, cx = 0, cy = 0, I = 0, md = [], i;
    for (i = 0; i < this.shapes.length; i++) { var d = this.shapes[i].massData(), dm = d.area * this.shapes[i].density; md.push([d, dm]); m += dm; cx += d.cx * dm; cy += d.cy * dm; }
    var oldLc = this._lc.clone();
    if (this.type !== 'dynamic' || m <= 0) { this.mass = 0; this.invMass = 0; this.inertia = 0; this.invI = 0; this._lc.set(0, 0); }
    else {
      cx /= m; cy /= m;
      for (i = 0; i < md.length; i++) { var dd = md[i][0], dmm = md[i][1], ox = dd.cx - cx, oy = dd.cy - cy; I += dd.I * this.shapes[i].density + dmm * (ox * ox + oy * oy); }
      this.mass = m; this.invMass = 1 / m; this.inertia = I; this.invI = this.fixedRotation || I <= 0 ? 0 : 1 / I; this._lc.set(cx, cy);
    }
    // mantiene el origen del cuerpo en el mismo sitio del mundo al cambiar el centro de masas
    var dx = this._lc.x - oldLc.x, dy = this._lc.y - oldLc.y;
    this.position.x += this._cos * dx - this._sin * dy; this.position.y += this._sin * dx + this._cos * dy;
  }
  /** Posición del origen de las formas (lo que se ve), no del centro de masas */
  get originX() { return this.position.x - (this._cos * this._lc.x - this._sin * this._lc.y); }
  get originY() { return this.position.y - (this._sin * this._lc.x + this._cos * this._lc.y); }
  setPosition(x, y) { this.position.set(x + (this._cos * this._lc.x - this._sin * this._lc.y), y + (this._sin * this._lc.x + this._cos * this._lc.y)); this._sync(); this.wake(); return this; }
  setAngle(a) { var ox = this.originX, oy = this.originY; this.angle = a; this._cos = Math.cos(a); this._sin = Math.sin(a); this.setPosition(ox, oy); return this; }
  setVelocity(x, y) { this.velocity.set(x, y); this.wake(); return this; }
  setAngularVelocity(w) { this.angularVelocity = w; this.wake(); return this; }
  applyForce(fx, fy, px, py) { this.force.x += fx; this.force.y += fy; if (px !== undefined) this.torque += rbCross(px - this.position.x, py - this.position.y, fx, fy); this.wake(); return this; }
  applyImpulse(ix, iy, px, py) {
    if (this.type !== 'dynamic') return this;
    this.velocity.x += ix * this.invMass; this.velocity.y += iy * this.invMass;
    if (px !== undefined) this.angularVelocity += this.invI * rbCross(px - this.position.x, py - this.position.y, ix, iy);
    this.wake(); return this;
  }
  applyTorque(t) { this.torque += t; this.wake(); return this; }
  wake() { if (this.sleeping) { this.sleeping = false; this._sleepT = 0; } return this; }
  /** Velocidad de un punto del mundo sobre el cuerpo */
  velocityAt(x, y) { var rx = x - this.position.x, ry = y - this.position.y; return new Vec2(this.velocity.x - this.angularVelocity * ry, this.velocity.y + this.angularVelocity * rx); }
  _sync() {
    this._cos = Math.cos(this.angle); this._sin = Math.sin(this.angle);
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (var i = 0; i < this.shapes.length; i++) { var s = this.shapes[i]; s._world(); if (s.min.x < minx) minx = s.min.x; if (s.min.y < miny) miny = s.min.y; if (s.max.x > maxx) maxx = s.max.x; if (s.max.y > maxy) maxy = s.max.y; }
    if (minx === Infinity) { minx = maxx = this.position.x; miny = maxy = this.position.y; }
    this.min.set(minx, miny); this.max.set(maxx, maxy);
  }
  _syncObject() {
    var g = this.gameObject; if (!g || g.destroyed) return;
    var ox = this.originX, oy = this.originY;
    if (g.parent && g.parent.worldTransform && g.parent !== (g.scene && g.scene.world)) { var p = g.parent.worldTransform.applyInverse(ox, oy, new Vec2()); g.x = p.x; g.y = p.y; }
    else { g.x = ox; g.y = oy; }
    if (!this.fixedRotation || this.angle) g.rotation = this.angle;
  }
  destroy() { if (this.destroyed) return; this.destroyed = true; if (this.world) this.world.remove(this); this.removeAllListeners(); this.gameObject = null; }
}

/* ================================================================ colisión */
function rbCollide(sa, sb) {
  if (sa.type === 'circle' && sb.type === 'circle') return rbCircles(sa, sb);
  if (sa.type === 'poly' && sb.type === 'circle') return rbPolyCircle(sa, sb, false);
  if (sa.type === 'circle' && sb.type === 'poly') return rbPolyCircle(sb, sa, true);
  return rbPolys(sa, sb);
}
function rbCircles(a, b) {
  var dx = b.wc.x - a.wc.x, dy = b.wc.y - a.wc.y, d2 = dx * dx + dy * dy, r = a.radius + b.radius;
  if (d2 >= (r + RB_MARGIN) * (r + RB_MARGIN)) return null;
  var d = Math.sqrt(d2), nx = d > 1e-6 ? dx / d : 0, ny = d > 1e-6 ? dy / d : 1;
  return { nx: nx, ny: ny, pts: [{ x: a.wc.x + nx * (a.radius - (r - d) * 0.5), y: a.wc.y + ny * (a.radius - (r - d) * 0.5), sep: d - r, id: 0 }] };
}
/** poly contra círculo; flip: el círculo era A (la normal debe ir de A a B) */
function rbPolyCircle(p, c, flip) {
  var W = p.wv, N = p.wn, cx = c.wc.x, cy = c.wc.y, r = c.radius, best = -Infinity, bi = 0, n = W.length, i;
  for (i = 0; i < n; i++) { var s = N[i].x * (cx - W[i].x) + N[i].y * (cy - W[i].y); if (s > r + RB_MARGIN) return null; if (s > best) { best = s; bi = i; } }
  var v1 = W[bi], v2 = W[(bi + 1) % n], nx, ny, px, py, sep;
  if (best < 1e-6) { nx = N[bi].x; ny = N[bi].y; sep = best - r; px = cx - nx * r; py = cy - ny * r; }
  else {
    var u1 = (cx - v1.x) * (v2.x - v1.x) + (cy - v1.y) * (v2.y - v1.y), u2 = (cx - v2.x) * (v1.x - v2.x) + (cy - v2.y) * (v1.y - v2.y), q;
    if (u1 <= 0) q = v1; else if (u2 <= 0) q = v2; else q = null;
    if (q) { var dx = cx - q.x, dy = cy - q.y, dd = Math.hypot(dx, dy); if (dd > r + RB_MARGIN) return null; nx = dd > 1e-6 ? dx / dd : N[bi].x; ny = dd > 1e-6 ? dy / dd : N[bi].y; sep = dd - r; }
    else { nx = N[bi].x; ny = N[bi].y; sep = best - r; }
    px = cx - nx * r; py = cy - ny * r;
  }
  var m = { nx: nx, ny: ny, pts: [{ x: px - nx * sep * 0.5, y: py - ny * sep * 0.5, sep: sep, id: bi }] };
  if (flip) { m.nx = -m.nx; m.ny = -m.ny; }
  return m;
}
function rbMaxSep(A, B) {
  var best = -Infinity, bi = 0, WA = A.wv, NA = A.wn, WB = B.wv;
  for (var i = 0; i < WA.length; i++) {
    var nx = NA[i].x, ny = NA[i].y, vx = WA[i].x, vy = WA[i].y, mn = Infinity;
    for (var j = 0; j < WB.length; j++) { var d = nx * (WB[j].x - vx) + ny * (WB[j].y - vy); if (d < mn) mn = d; }
    if (mn > best) { best = mn; bi = i; }
  }
  return [best, bi];
}
function rbPolys(A, B) {
  var sa = rbMaxSep(A, B); if (sa[0] > RB_MARGIN) return null;
  var sb = rbMaxSep(B, A); if (sb[0] > RB_MARGIN) return null;
  var ref, inc, edge, flip;
  if (sb[0] > sa[0] + 0.1) { ref = B; inc = A; edge = sb[1]; flip = true; } else { ref = A; inc = B; edge = sa[1]; flip = false; }
  var RW = ref.wv, RN = ref.wn, IW = inc.wv, IN = inc.wn, n = RW.length;
  var rnx = RN[edge].x, rny = RN[edge].y, v1 = RW[edge], v2 = RW[(edge + 1) % n];
  // arista incidente: la más opuesta a la normal de referencia
  var mi = 0, md = Infinity; for (var i = 0; i < IN.length; i++) { var d = rnx * IN[i].x + rny * IN[i].y; if (d < md) { md = d; mi = i; } }
  var c0 = { x: IW[mi].x, y: IW[mi].y, id: mi }, c1 = { x: IW[(mi + 1) % IW.length].x, y: IW[(mi + 1) % IW.length].y, id: (mi + 1) % IW.length };
  // recorte contra los planos laterales de la arista de referencia
  var tx = v2.x - v1.x, ty = v2.y - v1.y, tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
  var clip = function (p0, p1, nx, ny, off) {
    var E = 1e-3, d0 = nx * p0.x + ny * p0.y - off, d1 = nx * p1.x + ny * p1.y - off, out = [];
    if (d0 <= E) out.push(p0); if (d1 <= E) out.push(p1);
    if ((d0 > E && d1 < -E) || (d0 < -E && d1 > E)) { var t = d0 / (d0 - d1); out.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t, id: (d0 > 0 ? p0.id : p1.id) + 16 }); }
    return out;
  };
  var cl = clip(c0, c1, -tx, -ty, -(tx * v1.x + ty * v1.y)); if (cl.length < 2) return null;
  cl = clip(cl[0], cl[1], tx, ty, tx * v2.x + ty * v2.y); if (cl.length < 2) return null;
  var pts = [], front = rnx * v1.x + rny * v1.y;
  for (var k = 0; k < 2; k++) { var sep = rnx * cl[k].x + rny * cl[k].y - front; if (sep <= RB_MARGIN) pts.push({ x: cl[k].x - rnx * sep * 0.5, y: cl[k].y - rny * sep * 0.5, sep: sep, id: edge * 64 + cl[k].id + (flip ? 4096 : 0) }); }
  if (!pts.length) return null;
  return { nx: flip ? -rnx : rnx, ny: flip ? -rny : rny, pts: pts };
}

/** Resolución conjunta de los 2 impulsos normales (LCP 2x2 de Box2D): pilas estables sin temblores */
function rbBlockSolve(c, A, B, nx, ny) {
  var p1 = c.pts[0], p2 = c.pts[1], K = c.K, iK = c.iK;
  var vel = function (p) { var dvx = B.velocity.x - B.angularVelocity * p.rby - A.velocity.x + A.angularVelocity * p.ray, dvy = B.velocity.y + B.angularVelocity * p.rbx - A.velocity.y - A.angularVelocity * p.rax; return dvx * nx + dvy * ny; };
  var a1 = p1.jn, a2 = p2.jn, vn1 = vel(p1), vn2 = vel(p2);
  // b = vn - bias - K a
  var b1 = vn1 - p1.bias - (K[0] * a1 + K[1] * a2), b2 = vn2 - p2.bias - (K[1] * a1 + K[2] * a2), x1, x2;
  for (;;) {
    x1 = -(iK[0] * b1 + iK[1] * b2); x2 = -(iK[1] * b1 + iK[2] * b2); if (x1 >= 0 && x2 >= 0) break;
    x1 = -b1 / K[0]; x2 = 0; if (x1 >= 0 && K[1] * x1 + b2 >= 0) break;
    x1 = 0; x2 = -b2 / K[2]; if (x2 >= 0 && K[1] * x2 + b1 >= 0) break;
    x1 = 0; x2 = 0; if (b1 >= 0 && b2 >= 0) break;
    return; // sin solución (no debería ocurrir): se deja como estaba
  }
  var d1 = x1 - a1, d2 = x2 - a2; p1.jn = x1; p2.jn = x2;
  var i1x = nx * d1, i1y = ny * d1, i2x = nx * d2, i2y = ny * d2;
  A.velocity.x -= (i1x + i2x) * A.invMass; A.velocity.y -= (i1y + i2y) * A.invMass; A.angularVelocity -= A.invI * (rbCross(p1.rax, p1.ray, i1x, i1y) + rbCross(p2.rax, p2.ray, i2x, i2y));
  B.velocity.x += (i1x + i2x) * B.invMass; B.velocity.y += (i1y + i2y) * B.invMass; B.angularVelocity += B.invI * (rbCross(p1.rbx, p1.rby, i1x, i1y) + rbCross(p2.rbx, p2.rby, i2x, i2y));
}

/* =================================================================== uniones */
class RigidJoint2D {
  /** o: { type: 'distance'|'spring'|'revolute'|'weld'|'mouse', a, b, anchorA:{x,y} (local), anchorB, length, stiffness (Hz), damping (0..1), motorSpeed, maxMotorTorque, lower, upper, target, maxForce } */
  constructor(world, o) {
    this.world = world; this.id = uid(); this.type = o.type || 'distance'; this.a = o.a || null; this.b = o.b || null; this.enabled = true; this.destroyed = false; this.userData = o.userData || {};
    this.la = new Vec2(o.anchorA ? o.anchorA.x : 0, o.anchorA ? o.anchorA.y : 0); this.lb = new Vec2(o.anchorB ? o.anchorB.x : 0, o.anchorB ? o.anchorB.y : 0);
    this.stiffness = o.stiffness === undefined ? (this.type === 'spring' ? 4 : 0) : +o.stiffness; this.damping = o.damping === undefined ? 0.5 : +o.damping;
    this.motorSpeed = +o.motorSpeed || 0; this.maxMotorTorque = +o.maxMotorTorque || 0; this.motor = this.maxMotorTorque > 0;
    this.lower = o.lower === undefined ? null : +o.lower; this.upper = o.upper === undefined ? null : +o.upper;
    this.target = o.target ? new Vec2(o.target.x, o.target.y) : null; this.maxForce = o.maxForce || 1e9;
    var pa = this.worldA(), pb = this.worldB();
    this.length = o.length === undefined ? Math.hypot(pb.x - pa.x, pb.y - pa.y) : +o.length;
    this.refAngle = (this.b ? this.b.angle : 0) - (this.a ? this.a.angle : 0);
    this._ji = new Vec2(); this._ja = 0; this._jm = 0;
  }
  /** Ancla en mundo (las anclas son locales al origen de cada cuerpo) */
  worldA() { return rbLocalToWorld(this.a, this.la); }
  worldB() { return this.type === 'mouse' ? this.target.clone() : rbLocalToWorld(this.b, this.lb); }
  destroy() { if (this.destroyed) return; this.destroyed = true; if (this.world) this.world.removeJoint(this); }
}
function rbLocalToWorld(b, l) { if (!b) return l.clone(); var x = l.x - b._lc.x, y = l.y - b._lc.y; return new Vec2(b.position.x + b._cos * x - b._sin * y, b.position.y + b._sin * x + b._cos * y); }

/* ================================================================== mundo */
class RigidWorld2D extends EventEmitter {
  constructor(o) {
    super();
    o = o || {};
    this.gravity = new Vec2(o.gravity ? +o.gravity.x || 0 : 0, o.gravity ? (o.gravity.y === undefined ? 980 : +o.gravity.y) : 980);
    this.iterations = Math.max(1, Math.min(30, o.iterations || 10)); this.positionIterations = Math.max(0, Math.min(10, o.positionIterations === undefined ? 3 : o.positionIterations));
    this.fixedStep = 1 / (o.fps || 60); this.maxSubSteps = o.maxSubSteps || 4; this._acc = 0; this.time = 0;
    this.bodies = []; this.joints = []; this.contacts = new Map(); this._pairsPrev = new Map(); this.paused = false; this.destroyed = false;
    this.cell = o.cell || 128; this.maxBodies = o.maxBodies || 4000; this.maxSpeed = o.maxSpeed || 6000;
    this.enableSleep = o.sleep !== false;
    Debug.track('RigidWorld2D', 1);
  }
  /* ---------- creación ---------- */
  addBody(o) {
    if (this.bodies.length >= this.maxBodies) { Log.warnOnce('rb-max', 'RigidWorld2D: límite de cuerpos (' + this.maxBodies + ')'); return null; }
    var b = new RigidBody2D(this, o || {});
    (o && o.shapes || []).forEach(function (s) { b.addShape(s); });
    this.bodies.push(b); b._sync(); return b;
  }
  /** Caja (centro x, y) */
  addBox(x, y, w, h, o) { o = Object.assign({ x: x, y: y }, o || {}); var hw = Math.max(0.5, w / 2), hh = Math.max(0.5, h / 2); var b = this.addBody(o); if (b) b.addShape(Object.assign({}, o, { type: 'poly', vertices: [-hw, -hh, hw, -hh, hw, hh, -hw, hh], x: 0, y: 0 })); return b; }
  addCircle(x, y, r, o) { o = Object.assign({ x: x, y: y }, o || {}); var b = this.addBody(o); if (b) b.addShape(Object.assign({}, o, { type: 'circle', radius: r, x: 0, y: 0 })); return b; }
  /** Polígono (vértices locales respecto a x, y). Si es cóncavo se triangula y se crean varias formas en el mismo cuerpo */
  addPolygon(x, y, verts, o) {
    o = Object.assign({ x: x, y: y }, o || {});
    var flat = []; (verts || []).forEach(function (p) { if (typeof p === 'number') flat.push(p); else flat.push(+p.x, +p.y); });
    var b = this.addBody(o); if (!b || flat.length < 6) return b;
    if (rbIsConvex(flat)) b.addShape(Object.assign({}, o, { type: 'poly', vertices: flat, x: 0, y: 0 }));
    else { var tri = Earcut(flat); for (var i = 0; i < tri.length; i += 3) b.addShape(Object.assign({}, o, { type: 'poly', vertices: [flat[tri[i] * 2], flat[tri[i] * 2 + 1], flat[tri[i + 1] * 2], flat[tri[i + 1] * 2 + 1], flat[tri[i + 2] * 2], flat[tri[i + 2] * 2 + 1]], x: 0, y: 0 })); }
    return b;
  }
  /** Suelo, paredes o plataformas estáticas: caja estática */
  addStatic(x, y, w, h, o) { return this.addBox(x, y, w, h, Object.assign({ isStatic: true }, o || {})); }
  /** Cajas estáticas a partir de una capa de tilemap (fusiona tiles contiguos por filas). tiles: índices sólidos (por defecto todos > 0) */
  addTilemapLayer(layer, o) {
    o = o || {};
    var tw = layer.tileWidth || (layer.map && layer.map.tileWidth) || 32, th = layer.tileHeight || (layer.map && layer.map.tileHeight) || 32, out = [];
    var solid = o.tiles ? new Set(o.tiles) : null, W, H, sx = 0, sy = 0, isSolid;
    if (typeof layer.collidesAt === 'function' && layer.tileData) {
      // TilemapLayer del motor: datos planos; sólido = colisión activada en la capa (o índices de o.tiles)
      W = layer.layerWidth; H = layer.layerHeight; sx = layer.startX || 0; sy = layer.startY || 0;
      isSolid = solid ? function (x, y) { return solid.has(layer.gidAt(x + sx, y + sy) & TILE_GID_MASK); } : function (x, y) { return layer.collidesAt(x + sx, y + sy) !== 0; };
    } else {
      // datos por filas (array de arrays de índices o de {index})
      var data = layer.data || layer.layer && layer.layer.data; if (!data || !data.length || !Array.isArray(data[0]) && typeof data[0] !== 'object') return out;
      H = data.length; W = 0; for (var r = 0; r < H; r++) W = Math.max(W, data[r] ? data[r].length : 0);
      isSolid = function (x, y) { var row = data[y], t = row ? row[x] : 0, idx = t && typeof t === 'object' ? t.index : t; return solid ? solid.has(idx) : idx > 0; };
    }
    // posición y escala reales de la capa (puede estar dentro de un grupo desplazado o escalado)
    var m = layer.getWorldMatrix ? layer.getWorldMatrix(new Matrix(), 0, 0) : null;
    var ox = m ? m.tx : (layer.x || 0), oy = m ? m.ty : (layer.y || 0);
    if (m) { tw *= Math.hypot(m.a, m.b) || 1; th *= Math.hypot(m.c, m.d) || 1; }
    ox += sx * tw; oy += sy * th;
    // tiles contiguos de cada fila en una sola caja (menos cuerpos y sin enganches entre tiles)
    for (var y = 0; y < H && out.length < 20000; y++) {
      var x = 0;
      while (x < W) {
        if (!isSolid(x, y)) { x++; continue; }
        var x0 = x; while (x < W && isSolid(x, y)) x++;
        var b = this.addStatic(ox + (x0 + x) / 2 * tw, oy + (y + 0.5) * th, (x - x0) * tw, th, o); if (b) out.push(b);
      }
    }
    return out;
  }
  addJoint(o) { var j = new RigidJoint2D(this, o || {}); this.joints.push(j); if (j.a) j.a.wake(); if (j.b) j.b.wake(); return j; }
  remove(b) {
    if (removeFromArray(this.bodies, b)) {
      var self = this;
      this.joints.slice().forEach(function (j) { if (j.a === b || j.b === b) self.removeJoint(j); });
      this.contacts.forEach(function (c, k) { if (c.a.body === b || c.b.body === b) { self.contacts.delete(k); } });
      b.world = null;
    }
    return this;
  }
  removeJoint(j) { if (removeFromArray(this.joints, j)) { j.world = null; j.destroyed = true; } return this; }
  /* ---------- paso ---------- */
  step(dt) {
    if (this.destroyed || this.paused || !(dt > 0)) return;
    this._acc += Math.min(dt, this.fixedStep * this.maxSubSteps);
    var n = 0;
    while (this._acc >= this.fixedStep - 1e-9 && n < this.maxSubSteps) { this._fixed(this.fixedStep); this._acc -= this.fixedStep; n++; }
    if (n === this.maxSubSteps) this._acc = 0;
    for (var i = 0; i < this.bodies.length; i++) { var b = this.bodies[i]; if (b.gameObject && !b.sleeping) b._syncObject(); }
  }
  _fixed(h) {
    this.time += h;
    var B = this.bodies, i, b, g = this.gravity;
    // integrar fuerzas
    for (i = 0; i < B.length; i++) {
      b = B[i]; if (!b.enabled || b.type !== 'dynamic' || b.sleeping) continue;
      b.velocity.x += (g.x * b.gravityScale + b.force.x * b.invMass) * h; b.velocity.y += (g.y * b.gravityScale + b.force.y * b.invMass) * h;
      b.angularVelocity += b.torque * b.invI * h;
      var ld = 1 / (1 + h * b.linearDamping), ad = 1 / (1 + h * b.angularDamping); b.velocity.x *= ld; b.velocity.y *= ld; b.angularVelocity *= ad;
      var sp = b.velocity.length(); if (sp > this.maxSpeed) b.velocity.scale(this.maxSpeed / sp);
    }
    this._broadphase();
    this._prestep(h);
    for (var it = 0; it < this.iterations; it++) { this._solveVel(); this._solveJointsVel(h); }
    // integrar posiciones
    for (i = 0; i < B.length; i++) {
      b = B[i]; b.force.set(0, 0); b.torque = 0;
      if (!b.enabled || b.type === 'static' || b.sleeping) continue;
      b.position.x += b.velocity.x * h; b.position.y += b.velocity.y * h; b.angle += b.angularVelocity * h; b._sync();
    }
    for (var pi = 0; pi < this.positionIterations; pi++) if (this._solvePos()) break;
    this._events();
    if (this.enableSleep) this._sleep(h);
    this.emit('step', h);
  }
  _canCollide(a, b) {
    if (a === b || !a.enabled || !b.enabled) return false;
    if (a.type !== 'dynamic' && b.type !== 'dynamic') return false;
    if (a.sleeping && b.sleeping) return false;
    if (a.group !== 0 && a.group === b.group) return a.group > 0;
    if ((a.category & b.mask) === 0 || (b.category & a.mask) === 0) return false;
    for (var i = 0; i < this.joints.length; i++) { var j = this.joints[i]; if (!j.collideConnected && ((j.a === a && j.b === b) || (j.a === b && j.b === a))) return false; }
    return true;
  }
  _broadphase() {
    var B = this.bodies, cs = this.cell, grid = this._grid || (this._grid = new Map()), pairs = this._pairs || (this._pairs = new Set());
    grid.clear(); pairs.clear();
    var found = this._found || (this._found = []); found.length = 0;
    for (var i = 0; i < B.length; i++) {
      var b = B[i]; if (!b.enabled || !b.shapes.length) continue;
      var x0 = Math.floor(b.min.x / cs), x1 = Math.floor(b.max.x / cs), y0 = Math.floor(b.min.y / cs), y1 = Math.floor(b.max.y / cs);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256) { x1 = x0 + 15; y1 = y0 + 15; b._big = true; } else b._big = false;
      for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) {
        var k = x * 73856093 ^ y * 19349663, l = grid.get(k);
        if (!l) { l = []; grid.set(k, l); }
        for (var q = 0; q < l.length; q++) {
          var o = l[q]; if (o.max.x < b.min.x || o.min.x > b.max.x || o.max.y < b.min.y || o.min.y > b.max.y) continue;
          var pk = o.id < b.id ? o.id * 1e7 + b.id : b.id * 1e7 + o.id; if (pairs.has(pk)) continue; pairs.add(pk);
          if (this._canCollide(o, b)) found.push(o, b);
        }
        l.push(b);
      }
    }
    // cuerpos enormes (suelos): contra todos
    for (var z = 0; z < B.length; z++) if (B[z]._big) for (var w = 0; w < B.length; w++) {
      var a = B[z], c = B[w]; if (a === c || c._big && c.id < a.id) continue;
      if (a.max.x < c.min.x || a.min.x > c.max.x || a.max.y < c.min.y || a.min.y > c.max.y) continue;
      var pk2 = a.id < c.id ? a.id * 1e7 + c.id : c.id * 1e7 + a.id; if (pairs.has(pk2)) continue; pairs.add(pk2);
      if (this._canCollide(a, c)) found.push(a, c);
    }
    // estrecha: contactos por par de formas (se conservan los impulsos de los puntos que persisten)
    var old = this.contacts, fresh = new Map();
    for (var f = 0; f < found.length; f += 2) {
      var A = found[f], Bd = found[f + 1];
      for (var sa = 0; sa < A.shapes.length; sa++) for (var sb = 0; sb < Bd.shapes.length; sb++) {
        var s1 = A.shapes[sa], s2 = Bd.shapes[sb];
        if (s1.max.x < s2.min.x || s1.min.x > s2.max.x || s1.max.y < s2.min.y || s1.min.y > s2.max.y) continue;
        var m = rbCollide(s1, s2); if (!m) continue;
        var key = A.id + ':' + sa + '|' + Bd.id + ':' + sb, prev = old.get(key);
        var c2 = { a: s1, b: s2, nx: m.nx, ny: m.ny, pts: m.pts, sensor: s1.sensor || s2.sensor, key: key, friction: Math.sqrt(s1.friction * s2.friction), restitution: Math.max(s1.restitution, s2.restitution), isNew: !prev };
        if (prev && !c2.sensor) for (var p = 0; p < c2.pts.length; p++) { var pp = prev.pts.find(function (x) { return x.id === c2.pts[p].id; }); if (pp) { c2.pts[p].jn = pp.jn; c2.pts[p].jt = pp.jt; } }
        fresh.set(key, c2);
        if (!c2.sensor && (A.sleeping || Bd.sleeping)) {
          var other = A.sleeping ? Bd : A;
          if (other.type !== 'static' && !other.sleeping) { A.wake(); Bd.wake(); } else c2.inactive = true;
        }
      }
    }
    this._ended = []; var self = this;
    old.forEach(function (c, k) { if (!fresh.has(k)) self._ended.push(c); });
    this.contacts = fresh;
  }
  _prestep(h) {
    var inv = 1 / h, self = this;
    this.contacts.forEach(function (c) {
      if (c.sensor || c.inactive) return;
      var A = c.a.body, B = c.b.body, nx = c.nx, ny = c.ny, tx = -ny, ty = nx;
      for (var i = 0; i < c.pts.length; i++) {
        var p = c.pts[i], rax = p.x - A.position.x, ray = p.y - A.position.y, rbx = p.x - B.position.x, rby = p.y - B.position.y;
        var rna = rbCross(rax, ray, nx, ny), rnb = rbCross(rbx, rby, nx, ny), kn = A.invMass + B.invMass + A.invI * rna * rna + B.invI * rnb * rnb;
        var rta = rbCross(rax, ray, tx, ty), rtb = rbCross(rbx, rby, tx, ty), kt = A.invMass + B.invMass + A.invI * rta * rta + B.invI * rtb * rtb;
        p.rax = rax; p.ray = ray; p.rbx = rbx; p.rby = rby; p.mn = kn > 0 ? 1 / kn : 0; p.mt = kt > 0 ? 1 / kt : 0;
        var dvx = B.velocity.x - B.angularVelocity * rby - A.velocity.x + A.angularVelocity * ray, dvy = B.velocity.y + B.angularVelocity * rbx - A.velocity.y - A.angularVelocity * rax, vn = dvx * nx + dvy * ny;
        // contacto anticipado (aún hay hueco, sep > 0): se deja acercar hasta cerrarlo en este paso; si penetra, Baumgarte con holgura
        p.bias = (p.sep > 0 ? -p.sep * inv : -RB_BAUM * inv * Math.min(0, p.sep + RB_SLOP)) + (vn < -RB_RESTVEL && p.sep <= RB_SLOP && c.restitution > 0 ? -c.restitution * vn : 0);
        p.jn = p.jn || 0; p.jt = p.jt || 0;
        // arranque en caliente
        var ix = nx * p.jn + tx * p.jt, iy = ny * p.jn + ty * p.jt;
        A.velocity.x -= ix * A.invMass; A.velocity.y -= iy * A.invMass; A.angularVelocity -= A.invI * rbCross(rax, ray, ix, iy);
        B.velocity.x += ix * B.invMass; B.velocity.y += iy * B.invMass; B.angularVelocity += B.invI * rbCross(rbx, rby, ix, iy);
      }
      c.block = false;
      if (c.pts.length === 2) {
        var p1 = c.pts[0], p2 = c.pts[1];
        var r1a = rbCross(p1.rax, p1.ray, nx, ny), r1b = rbCross(p1.rbx, p1.rby, nx, ny), r2a = rbCross(p2.rax, p2.ray, nx, ny), r2b = rbCross(p2.rbx, p2.rby, nx, ny);
        var k11 = A.invMass + B.invMass + A.invI * r1a * r1a + B.invI * r1b * r1b, k22 = A.invMass + B.invMass + A.invI * r2a * r2a + B.invI * r2b * r2b, k12 = A.invMass + B.invMass + A.invI * r1a * r2a + B.invI * r1b * r2b;
        var det = k11 * k22 - k12 * k12;
        if (k11 * k11 < 1000 * det && det > 1e-12) { c.block = true; c.K = [k11, k12, k22]; c.iK = [k22 / det, -k12 / det, k11 / det]; }
      }
    });
    this.joints.forEach(function (j) { if (j.enabled) self._prestepJoint(j, h); });
  }
  _solveVel() {
    this.contacts.forEach(function (c) {
      if (c.sensor || c.inactive) return;
      var A = c.a.body, B = c.b.body, nx = c.nx, ny = c.ny, tx = -ny, ty = nx, i, p, dvx, dvy, ix, iy;
      // tangente (fricción) primero, en todos los puntos
      for (i = 0; i < c.pts.length; i++) {
        p = c.pts[i];
        dvx = B.velocity.x - B.angularVelocity * p.rby - A.velocity.x + A.angularVelocity * p.ray; dvy = B.velocity.y + B.angularVelocity * p.rbx - A.velocity.y - A.angularVelocity * p.rax;
        var vt = dvx * tx + dvy * ty, djt = -vt * p.mt, maxF = c.friction * p.jn, jt0 = p.jt;
        p.jt = Math.max(-maxF, Math.min(maxF, jt0 + djt)); djt = p.jt - jt0;
        ix = tx * djt; iy = ty * djt;
        A.velocity.x -= ix * A.invMass; A.velocity.y -= iy * A.invMass; A.angularVelocity -= A.invI * rbCross(p.rax, p.ray, ix, iy);
        B.velocity.x += ix * B.invMass; B.velocity.y += iy * B.invMass; B.angularVelocity += B.invI * rbCross(p.rbx, p.rby, ix, iy);
      }
      if (c.block) { rbBlockSolve(c, A, B, nx, ny); return; }
      for (i = 0; i < c.pts.length; i++) {
        p = c.pts[i];
        // normal
        dvx = B.velocity.x - B.angularVelocity * p.rby - A.velocity.x + A.angularVelocity * p.ray; dvy = B.velocity.y + B.angularVelocity * p.rbx - A.velocity.y - A.angularVelocity * p.rax;
        var vn = dvx * nx + dvy * ny, djn = p.mn * (-vn + p.bias), jn0 = p.jn;
        p.jn = Math.max(0, jn0 + djn); djn = p.jn - jn0;
        ix = nx * djn; iy = ny * djn;
        A.velocity.x -= ix * A.invMass; A.velocity.y -= iy * A.invMass; A.angularVelocity -= A.invI * rbCross(p.rax, p.ray, ix, iy);
        B.velocity.x += ix * B.invMass; B.velocity.y += iy * B.invMass; B.angularVelocity += B.invI * rbCross(p.rbx, p.rby, ix, iy);
      }
    });
  }
  /** Corrección posicional directa (evita que las pilas se hundan poco a poco). true = ya está bien */
  _solvePos() {
    var worst = 0;
    this.contacts.forEach(function (c) {
      if (c.sensor || c.inactive) return;
      var A = c.a.body, B = c.b.body; if (A.invMass + B.invMass <= 0) return;
      var m = rbCollide(c.a, c.b); if (!m) return;
      for (var i = 0; i < m.pts.length; i++) {
        var p = m.pts[i], C = Math.max(-RB_MAXCORR, Math.min(0, p.sep + RB_SLOP)); if (C >= 0) continue;
        worst = Math.min(worst, p.sep);
        var rax = p.x - A.position.x, ray = p.y - A.position.y, rbx = p.x - B.position.x, rby = p.y - B.position.y;
        var rna = rbCross(rax, ray, m.nx, m.ny), rnb = rbCross(rbx, rby, m.nx, m.ny), k = A.invMass + B.invMass + A.invI * rna * rna + B.invI * rnb * rnb;
        var imp = k > 0 ? -0.2 * C / k : 0, ix = m.nx * imp, iy = m.ny * imp;
        A.position.x -= ix * A.invMass; A.position.y -= iy * A.invMass; A.angle -= A.invI * rbCross(rax, ray, ix, iy);
        B.position.x += ix * B.invMass; B.position.y += iy * B.invMass; B.angle += B.invI * rbCross(rbx, rby, ix, iy);
        A._sync(); B._sync();
      }
    });
    return worst > -RB_SLOP * 3;
  }
  /* ---------- uniones ---------- */
  _prestepJoint(j, h) {
    var A = j.a, B = j.type === 'mouse' ? null : j.b;
    var pa = j.worldA(), pb = j.worldB(); j._pa = pa; j._pb = pb;
    j._ra = A ? new Vec2(pa.x - A.position.x, pa.y - A.position.y) : new Vec2(); j._rb = B ? new Vec2(pb.x - B.position.x, pb.y - B.position.y) : new Vec2();
    var mA = A ? A.invMass : 0, mB = B ? B.invMass : 0, iA = A ? A.invI : 0, iB = B ? B.invI : 0;
    j._mA = mA; j._mB = mB; j._iA = iA; j._iB = iB;
    var ra = j._ra, rb = j._rb;
    if (j.type === 'distance' || j.type === 'spring') {
      var dx = pb.x - pa.x, dy = pb.y - pa.y, L = Math.hypot(dx, dy) || 1e-6; j._u = new Vec2(dx / L, dy / L);
      var cra = rbCross(ra.x, ra.y, j._u.x, j._u.y), crb = rbCross(rb.x, rb.y, j._u.x, j._u.y), k = mA + mB + iA * cra * cra + iB * crb * crb;
      j._mass = k > 0 ? 1 / k : 0; var C = L - j.length;
      if (j.stiffness > 0) { var om = 2 * Math.PI * j.stiffness, m = j._mass, d = 2 * m * j.damping * om, kk = m * om * om; j._gamma = h * (d + h * kk); j._gamma = j._gamma > 0 ? 1 / j._gamma : 0; j._bias = C * h * kk * j._gamma; j._mass = k + j._gamma > 0 ? 1 / (k + j._gamma) : 0; }
      else { j._gamma = 0; j._bias = 0.2 / h * C; }
    } else {
      // punto (bisagra, soldadura, ratón): matriz efectiva 2x2
      var K11 = mA + mB + iA * ra.y * ra.y + iB * rb.y * rb.y, K12 = -iA * ra.x * ra.y - iB * rb.x * rb.y, K22 = mA + mB + iA * ra.x * ra.x + iB * rb.x * rb.x;
      var gam = 0;
      if (j.type === 'mouse') {
        // unión blanda hacia el objetivo (Box2D b2MouseJoint): C = pA - objetivo
        var mm = A ? A.mass : 1, omg = 2 * Math.PI * (j.stiffness || 5), dd = 2 * mm * (j.damping === undefined ? 0.7 : j.damping) * omg, kp = mm * omg * omg;
        gam = h * (dd + h * kp); gam = gam > 0 ? 1 / gam : 0; var beta = h * kp * gam; K11 += gam; K22 += gam;
        j._bias2 = new Vec2((pa.x - pb.x) * beta, (pa.y - pb.y) * beta);
      } else j._bias2 = new Vec2((pb.x - pa.x) * 0.2 / h, (pb.y - pa.y) * 0.2 / h);
      var det = K11 * K22 - K12 * K12; det = det !== 0 ? 1 / det : 0;
      j._K = [K22 * det, -K12 * det, K11 * det]; j._gamma = gam;
      var ki = iA + iB; j._am = ki > 0 ? 1 / ki : 0;
      j._angle = (B ? B.angle : 0) - (A ? A.angle : 0) - j.refAngle;
    }
    j._ji.set(0, 0); j._ja = 0; j._jm = 0;
  }
  _solveJointsVel(h) {
    for (var q = 0; q < this.joints.length; q++) {
      var j = this.joints[q]; if (!j.enabled) continue;
      var A = j.a, B = j.type === 'mouse' ? null : j.b, ra = j._ra, rb = j._rb, mA = j._mA, mB = j._mB, iA = j._iA, iB = j._iB;
      var vA = A ? A.velocity : new Vec2(), wA = A ? A.angularVelocity : 0, vB = B ? B.velocity : new Vec2(), wB = B ? B.angularVelocity : 0;
      if (j.type === 'distance' || j.type === 'spring') {
        var dvx = vB.x - wB * rb.y - vA.x + wA * ra.y, dvy = vB.y + wB * rb.x - vA.y - wA * ra.x, Cdot = dvx * j._u.x + dvy * j._u.y;
        var imp = -j._mass * (Cdot + j._bias + j._gamma * j._jm); j._jm += imp;
        var px = j._u.x * imp, py = j._u.y * imp;
        if (A) { A.velocity.x -= px * mA; A.velocity.y -= py * mA; A.angularVelocity -= iA * rbCross(ra.x, ra.y, px, py); }
        if (B) { B.velocity.x += px * mB; B.velocity.y += py * mB; B.angularVelocity += iB * rbCross(rb.x, rb.y, px, py); }
        continue;
      }
      // motor y límites angulares de la bisagra; ángulo fijo de la soldadura
      if ((j.type === 'revolute' && (j.motor || j.lower !== null)) || j.type === 'weld') {
        var wr = (B ? B.angularVelocity : 0) - (A ? A.angularVelocity : 0), ia = 0;
        if (j.type === 'weld') ia = -j._am * (wr + 0.2 / h * j._angle);
        else if (j.motor) { ia = j._am * (j.motorSpeed - wr); var mx = j.maxMotorTorque * h; var old = j._ja; j._ja = Math.max(-mx, Math.min(mx, old + ia)); ia = j._ja - old; }
        if (j.type === 'revolute' && j.lower !== null && j.upper !== null) { if (j._angle <= j.lower && wr < 0) ia -= j._am * wr * 1.0; else if (j._angle >= j.upper && wr > 0) ia -= j._am * wr * 1.0; }
        if (A) A.angularVelocity -= iA * ia; if (B) B.angularVelocity += iB * ia;
        wA = A ? A.angularVelocity : 0; wB = B ? B.angularVelocity : 0;
      }
      if (j.type === 'mouse') {
        if (!A) continue;
        var mcx = vA.x - wA * ra.y + j._bias2.x + j._gamma * j._ji.x, mcy = vA.y + wA * ra.x + j._bias2.y + j._gamma * j._ji.y;
        var mix = -(j._K[0] * mcx + j._K[1] * mcy), miy = -(j._K[1] * mcx + j._K[2] * mcy);
        var nj = new Vec2(j._ji.x + mix, j._ji.y + miy), ml = j.maxForce * h, nl = nj.length(); if (nl > ml) nj.scale(ml / nl);
        mix = nj.x - j._ji.x; miy = nj.y - j._ji.y; j._ji.copy(nj);
        A.velocity.x += mix * mA; A.velocity.y += miy * mA; A.angularVelocity += iA * rbCross(ra.x, ra.y, mix, miy);
        continue;
      }
      var cx = vB.x - wB * rb.y - vA.x + wA * ra.y, cy = vB.y + wB * rb.x - vA.y - wA * ra.x;
      var bx = cx + j._bias2.x, by = cy + j._bias2.y;
      var ix = -(j._K[0] * bx + j._K[1] * by), iy = -(j._K[1] * bx + j._K[2] * by);
      j._ji.x += ix; j._ji.y += iy;
      if (A) { A.velocity.x -= ix * mA; A.velocity.y -= iy * mA; A.angularVelocity -= iA * rbCross(ra.x, ra.y, ix, iy); }
      if (B) { B.velocity.x += ix * mB; B.velocity.y += iy * mB; B.angularVelocity += iB * rbCross(rb.x, rb.y, ix, iy); }
    }
  }
  /* ---------- sueño por islas ---------- */
  _sleep(h) {
    var B = this.bodies, i, parent = new Map();
    var find = function (x) { var p = parent.get(x); if (p === undefined || p === x) return x; var r = find(p); parent.set(x, r); return r; };
    var unite = function (a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    for (i = 0; i < B.length; i++) { var b = B[i]; if (b.type !== 'dynamic') continue; parent.set(b, b); var slow = b.velocity.lengthSq() < RB_SLEEPVEL * RB_SLEEPVEL && Math.abs(b.angularVelocity) < RB_SLEEPANG; b._sleepT = slow && b.canSleep ? b._sleepT + h : 0; }
    this.contacts.forEach(function (c) { if (c.sensor) return; var a = c.a.body, bb = c.b.body; if (a.type === 'dynamic' && bb.type === 'dynamic') unite(a, bb); });
    this.joints.forEach(function (j) { if (j.a && j.b && j.a.type === 'dynamic' && j.b.type === 'dynamic') unite(j.a, j.b); if (j.type === 'mouse' && j.a) j.a._sleepT = 0; });
    var minT = new Map();
    for (i = 0; i < B.length; i++) { var d = B[i]; if (d.type !== 'dynamic') continue; var r = find(d), m = minT.get(r); minT.set(r, m === undefined ? d._sleepT : Math.min(m, d._sleepT)); }
    for (i = 0; i < B.length; i++) {
      var e = B[i]; if (e.type !== 'dynamic') continue;
      var t = minT.get(find(e));
      if (t >= RB_SLEEPT && !e.sleeping) { e.sleeping = true; e.velocity.set(0, 0); e.angularVelocity = 0; e.emit('sleep'); }
      else if (t < RB_SLEEPT && e.sleeping) e.wake();
    }
  }
  _events() {
    var self = this;
    this.contacts.forEach(function (c) {
      if (!c.isNew) return;
      var A = c.a.body, B = c.b.body, jn = 0; for (var i = 0; i < c.pts.length; i++) jn += c.pts[i].jn || 0;
      var ev = { bodyA: A, bodyB: B, shapeA: c.a, shapeB: c.b, normal: new Vec2(c.nx, c.ny), points: c.pts.map(function (p) { return new Vec2(p.x, p.y); }), impulse: jn, sensor: c.sensor };
      self.emit('collisionstart', ev); A.emit('collide', B, ev); B.emit('collide', A, ev);
    });
    for (var k = 0; k < this._ended.length; k++) { var c2 = this._ended[k], e2 = { bodyA: c2.a.body, bodyB: c2.b.body, sensor: c2.sensor }; this.emit('collisionend', e2); c2.a.body.emit('separate', c2.b.body, e2); c2.b.body.emit('separate', c2.a.body, e2); }
  }
  /* ---------- consultas ---------- */
  /** Primer cuerpo que corta el segmento (x0,y0)-(x1,y1): { body, shape, point, normal, fraction } o null */
  raycast(x0, y0, x1, y1, o) {
    o = o || {};
    var dx = x1 - x0, dy = y1 - y0, best = null, bt = 1, mask = o.mask === undefined ? -1 : o.mask;
    for (var i = 0; i < this.bodies.length; i++) {
      var b = this.bodies[i]; if (!b.enabled || (b.category & mask) === 0 || b === o.ignore) continue;
      if (Math.max(x0, x1) < b.min.x || Math.min(x0, x1) > b.max.x || Math.max(y0, y1) < b.min.y || Math.min(y0, y1) > b.max.y) continue;
      for (var s = 0; s < b.shapes.length; s++) {
        var sh = b.shapes[s]; if (sh.sensor && !o.sensors) continue;
        var r = sh.type === 'circle' ? rbRayCircle(x0, y0, dx, dy, sh) : rbRayPoly(x0, y0, dx, dy, sh);
        if (r && r.t < bt) { bt = r.t; best = { body: b, shape: sh, point: new Vec2(x0 + dx * r.t, y0 + dy * r.t), normal: new Vec2(r.nx, r.ny), fraction: r.t }; }
      }
    }
    return best;
  }
  /** Cuerpos que contienen el punto */
  queryPoint(x, y) {
    var out = [];
    for (var i = 0; i < this.bodies.length; i++) {
      var b = this.bodies[i]; if (!b.enabled || x < b.min.x || x > b.max.x || y < b.min.y || y > b.max.y) continue;
      for (var s = 0; s < b.shapes.length; s++) { var sh = b.shapes[s]; if (sh.type === 'circle' ? (x - sh.wc.x) * (x - sh.wc.x) + (y - sh.wc.y) * (y - sh.wc.y) <= sh.radius * sh.radius : rbInPoly(x, y, sh)) { out.push(b); break; } }
    }
    return out;
  }
  queryAABB(x0, y0, x1, y1) { return this.bodies.filter(function (b) { return b.enabled && !(b.max.x < x0 || b.min.x > x1 || b.max.y < y0 || b.min.y > y1); }); }
  /** Explosión: impulso radial */
  explode(x, y, radius, force) { var self = this; this.bodies.forEach(function (b) { if (b.type !== 'dynamic') return; var dx = b.position.x - x, dy = b.position.y - y, d = Math.hypot(dx, dy); if (d > radius || d < 1e-6) return; var k = force * (1 - d / radius); b.applyImpulse(dx / d * k, dy / d * k, b.position.x + (x - b.position.x) * 0.2, b.position.y + (y - b.position.y) * 0.2); }); void self; return this; }
  /** Dibujo de depuración en un Graphics */
  debugDraw(g, o) {
    o = o || {}; g.clear();
    for (var i = 0; i < this.bodies.length; i++) {
      var b = this.bodies[i], col = b.type === 'static' ? 0x51cf66 : (b.sleeping ? 0x868e96 : (b.type === 'kinematic' ? 0x74c0fc : 0xffd43b));
      for (var s = 0; s < b.shapes.length; s++) {
        var sh = b.shapes[s]; g.lineStyle(1.5, sh.sensor ? 0xff6bcb : col, 0.9);
        if (sh.type === 'circle') { g.strokeCircle(sh.wc.x, sh.wc.y, sh.radius); g.lineBetween(sh.wc.x, sh.wc.y, sh.wc.x + Math.cos(b.angle) * sh.radius, sh.wc.y + Math.sin(b.angle) * sh.radius); }
        else { var W = sh.wv; g.beginPath(); g.moveTo(W[0].x, W[0].y); for (var k = 1; k < W.length; k++) g.lineTo(W[k].x, W[k].y); g.closePath(); g.strokePath(); }
      }
    }
    if (o.contacts !== false) this.contacts.forEach(function (c) { c.pts.forEach(function (p) { g.fillStyle(0xff4040, 1).fillCircle(p.x, p.y, 2.5); }); });
    this.joints.forEach(function (j) { var a = j.worldA(), b = j.worldB(); g.lineStyle(1.5, 0x9775fa, 0.9).lineBetween(a.x, a.y, b.x, b.y); });
    return g;
  }
  clear() { var self = this; this.bodies.slice().forEach(function (b) { b.destroy(); }); this.joints.slice().forEach(function (j) { self.removeJoint(j); }); this.contacts.clear(); return this; }
  destroy() { if (this.destroyed) return; this.clear(); this.destroyed = true; this.removeAllListeners(); Debug.track('RigidWorld2D', -1); }
}
function rbIsConvex(flat) {
  var n = flat.length / 2, sign = 0;
  for (var i = 0; i < n; i++) { var ax = flat[i * 2], ay = flat[i * 2 + 1], bx = flat[((i + 1) % n) * 2], by = flat[((i + 1) % n) * 2 + 1], cx = flat[((i + 2) % n) * 2], cy = flat[((i + 2) % n) * 2 + 1]; var cr = rbCross(bx - ax, by - ay, cx - bx, cy - by); if (Math.abs(cr) < 1e-9) continue; var s = cr > 0 ? 1 : -1; if (!sign) sign = s; else if (s !== sign) return false; }
  return true;
}
function rbInPoly(x, y, sh) { var W = sh.wv, N = sh.wn; for (var i = 0; i < W.length; i++) if (N[i].x * (x - W[i].x) + N[i].y * (y - W[i].y) > 0) return false; return true; }
function rbRayCircle(x0, y0, dx, dy, sh) {
  var fx = x0 - sh.wc.x, fy = y0 - sh.wc.y, a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - sh.radius * sh.radius, disc = b * b - 4 * a * c;
  if (disc < 0 || a < 1e-12) return null; var t = (-b - Math.sqrt(disc)) / (2 * a); if (t < 0 || t > 1) return null;
  var px = x0 + dx * t - sh.wc.x, py = y0 + dy * t - sh.wc.y, l = Math.hypot(px, py) || 1; return { t: t, nx: px / l, ny: py / l };
}
function rbRayPoly(x0, y0, dx, dy, sh) {
  var lo = 0, hi = 1, W = sh.wv, N = sh.wn, bi = -1;
  for (var i = 0; i < W.length; i++) {
    var num = N[i].x * (W[i].x - x0) + N[i].y * (W[i].y - y0), den = N[i].x * dx + N[i].y * dy;
    if (Math.abs(den) < 1e-12) { if (num < 0) return null; continue; }
    var t = num / den;
    if (den < 0) { if (t > lo) { lo = t; bi = i; } } else if (t < hi) hi = t;
    if (lo > hi) return null;
  }
  if (bi < 0) return null;
  return { t: lo, nx: N[bi].x, ny: N[bi].y };
}

/* ============================================================ plugin de escena */
/**
 * this.rigid dentro de una escena (config del juego o de la escena: physics: { rigid: { gravity: {x, y}, iterations, debug } }).
 * add.sprite/image/rectangle/circle/polygon crean el objeto visible y su cuerpo; add.existing(obj, forma) añade cuerpo a
 * un objeto; add.static(x, y, w, h); add.joint({...}); drag() activa arrastrar cuerpos con el ratón o el dedo.
 */
class RigidPhysics2D {
  constructor(scene, config) {
    this.scene = scene; config = config || {};
    this.world = new RigidWorld2D(config);
    var self = this, w = this.world;
    var link = function (obj, o) {
      o = o || {};
      var shape = o.shape || (obj.type === 'Graphics' ? 'box' : 'box'), bw = o.width || (obj.width ? obj.width : 32), bh = o.height || (obj.height ? obj.height : 32);
      var cx = obj.x + (0.5 - (obj.originX === undefined ? 0.5 : obj.originX)) * bw, cy = obj.y + (0.5 - (obj.originY === undefined ? 0.5 : obj.originY)) * bh;
      var opt = Object.assign({}, o, { gameObject: obj, angle: obj.rotation || 0 });
      var b = shape === 'circle' ? w.addCircle(cx, cy, o.radius || Math.min(bw, bh) / 2, opt) : (shape === 'polygon' && o.vertices ? w.addPolygon(cx, cy, o.vertices, opt) : w.addBox(cx, cy, bw, bh, opt));
      if (!b) return obj;
      obj.rbody = b; if (obj.setOrigin && shape !== 'polygon') obj.setOrigin(0.5, 0.5);
      b._syncObject();
      obj.once && obj.once('destroy', function () { if (!b.destroyed) b.destroy(); });
      return obj;
    };
    this.add = {
      existing: function (obj, o) { if (!obj.parent) { obj.scene = scene; scene.world.addChild(obj); } return link(obj, o); },
      sprite: function (x, y, key, frame, o) { if (frame && typeof frame === 'object') { o = frame; frame = undefined; } var s = new Sprite(x, y, scene.textures.get(key === undefined ? '__WHITE' : key, frame)); s.textureKey = typeof key === 'string' ? key : null; s.scene = scene; scene.world.addChild(s); return link(s, o); },
      image: function (x, y, key, frame, o) { return self.add.sprite(x, y, key, frame, o); },
      rectangle: function (x, y, wd, ht, color, o) { var r = new ShapeObject('rectangle', x, y, { width: wd, height: ht }, color === undefined ? 0xffd43b : color, 1); r.scene = scene; scene.world.addChild(r); return link(r, Object.assign({ width: wd, height: ht }, o || {})); },
      circle: function (x, y, rad, color, o) { var c = new ShapeObject('circle', x, y, { radius: rad, width: rad * 2, height: rad * 2 }, color === undefined ? 0x74c0fc : color, 1); c.scene = scene; scene.world.addChild(c); return link(c, Object.assign({ shape: 'circle', radius: rad, width: rad * 2, height: rad * 2 }, o || {})); },
      polygon: function (x, y, verts, color, o) {
        var g = new Graphics(); g.x = x; g.y = y; g.scene = scene; scene.world.addChild(g);
        var flat = []; verts.forEach(function (p) { if (typeof p === 'number') flat.push(p); else flat.push(p.x, p.y); });
        g.fillStyle(color === undefined ? 0x63e6be : color, 1).fillPoints(flat.reduce(function (a, v, i) { if (i % 2 === 0) a.push({ x: v, y: flat[i + 1] }); return a; }, []), true);
        var b = w.addPolygon(x, y, flat, Object.assign({}, o || {}, { gameObject: g })); if (b) { g.rbody = b; b._syncObject(); g.once('destroy', function () { if (!b.destroyed) b.destroy(); }); }
        return g;
      },
      static: function (x, y, wd, ht, o) { return w.addStatic(x, y, wd, ht, o); },
      joint: function (o) { return w.addJoint(o); },
      tilemap: function (layer, o) { return w.addTilemapLayer(layer, o); }
    };
    this._drag = null; this._dbg = null;
    if (config.debug) this.debug(true);
  }
  /** Arrastrar cuerpos con el puntero (unión de ratón) */
  drag(on) {
    var self = this, inp = this.scene.input;
    if (on === false) { if (this._dragOn) { inp.off('pointerdown', this._pd); inp.off('pointermove', this._pm); inp.off('pointerup', this._pu); this._dragOn = false; } return this; }
    if (this._dragOn) return this; this._dragOn = true;
    var cam = function (p) { var c = self.scene.cameras.main; return c ? c.getWorldPoint(p.x, p.y) : { x: p.x, y: p.y }; };
    this._pd = function (p) {
      var wp = cam(p), hit = self.world.queryPoint(wp.x, wp.y).filter(function (b) { return b.type === 'dynamic'; })[0]; if (!hit) return;
      // ancla en coordenadas locales del cuerpo (respecto a su origen, sin girar)
      var dx = wp.x - hit.originX, dy = wp.y - hit.originY, c = Math.cos(-hit.angle), s = Math.sin(-hit.angle);
      self._drag = self.world.addJoint({ type: 'mouse', a: hit, anchorA: { x: dx * c - dy * s, y: dx * s + dy * c }, target: wp, stiffness: 6, damping: 0.8, maxForce: hit.mass * 6000 }); self._drag.pid = p.id;
    };
    this._pm = function (p) { if (self._drag && self._drag.pid === p.id) { var wp = cam(p); self._drag.target.set(wp.x, wp.y); if (self._drag.a) self._drag.a.wake(); } };
    this._pu = function (p) { if (self._drag && self._drag.pid === p.id) { self._drag.destroy(); self._drag = null; } };
    inp.on('pointerdown', this._pd); inp.on('pointermove', this._pm); inp.on('pointerup', this._pu);
    return this;
  }
  debug(on) { if (on === false) { if (this._dbg) { this._dbg.destroy(); this._dbg = null; } return this; } if (!this._dbg) { this._dbg = this.scene.add.graphics(); this._dbg.depth = 1e6; } return this; }
  update(time, delta) { this.world.step(delta / 1000); if (this._dbg) this.world.debugDraw(this._dbg); }
  destroy() { this.drag(false); this.world.destroy(); if (this._dbg && !this._dbg.destroyed) this._dbg.destroy(); this._dbg = null; this.scene = null; }
}

UG.RigidWorld2D = RigidWorld2D; UG.RigidBody2D = RigidBody2D; UG.RigidShape2D = RigidShape2D; UG.RigidJoint2D = RigidJoint2D; UG.RigidPhysics2D = RigidPhysics2D;
