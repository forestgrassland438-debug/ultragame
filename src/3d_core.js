/* UltraGame 3D - núcleo: nodos, mallas, instancias, esqueletos, cámaras, luces, escena, geometrías y materiales.
 * Frente del modelo = +Z (convención glTF/Blender); las cámaras y luces miran hacia -Z. */

var _n3v = new Vec3(), _n3v2 = new Vec3(), _n3q = new Quat(), _n3m = new Mat4();

/* ============================================================ Color lineal */
function srgbChannelToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
/** Color 0xRRGGBB (sRGB) -> [r,g,b] lineal */
function colorToLinear(c, out, o) {
  var n = Color.toNumber(c); out = out || [0, 0, 0]; o = o || 0;
  out[o] = srgbChannelToLinear(((n >> 16) & 255) / 255); out[o + 1] = srgbChannelToLinear(((n >> 8) & 255) / 255); out[o + 2] = srgbChannelToLinear((n & 255) / 255);
  return out;
}

/* ================================================================== Node3D */
class Node3D extends EventEmitter {
  constructor() {
    super();
    this.uid = uid(); this.type = 'Node3D'; this.name = '';
    this.parent = null; this.children = [];
    this.position = new Vec3(); this.scale = new Vec3(1, 1, 1);
    this.quaternion = new Quat(); this._rotation = new Euler();
    var self = this;
    this._eulerStale = false; this._syncing = false;
    this.quaternion._onChange = function () { if (!self._syncing) self._eulerStale = true; };
    this._rotation._onChange = function () { self._syncing = true; self.quaternion.setFromEuler(self._rotation._x, self._rotation._y, self._rotation._z, self._rotation.order); self._syncing = false; self._eulerStale = false; };
    this.matrix = new Mat4(); this.matrixWorld = new Mat4();
    this.matrixAutoUpdate = true;
    this.visible = true; this.castShadow = true; this.receiveShadow = true; this.frustumCulled = true;
    this.renderOrder = 0; this.layers = 1;
    this.userData = {}; this.body = null; this.destroyed = false;
    Debug.track('Node3D', 1);
  }
  /** Rotación en ángulos de Euler (radianes, orden YXZ por defecto), sincronizada con quaternion */
  get rotation() {
    if (this._eulerStale) { _n3m.makeRotationFromQuat(this.quaternion); this._rotation.setFromRotationMatrix(_n3m, this._rotation.order, true); this._eulerStale = false; }
    return this._rotation;
  }
  set rotation(v) { this._rotation.set(v.x, v.y, v.z, v.order); }
  setPosition(x, y, z) { if (typeof x === 'object') this.position.copy(x); else this.position.set(x, y, z); return this; }
  setRotation(x, y, z) { this._rotation.set(x, y, z); return this; }
  setScale(x, y, z) { if (y === undefined) this.scale.set(x, x, x); else this.scale.set(x, y, z); return this; }
  add(child) {
    if (arguments.length > 1) { for (var i = 0; i < arguments.length; i++) this.add(arguments[i]); return this; }
    if (!child || child === this) return this;
    for (var p = this; p; p = p.parent) if (p === child) throw new Error('UltraGame 3D: ciclo en la jerarquía');
    if (child.parent) child.parent.remove(child);
    child.parent = this; this.children.push(child);
    child.emit('added', this);
    return this;
  }
  remove(child) { var i = this.children.indexOf(child); if (i >= 0) { this.children.splice(i, 1); child.parent = null; child.emit('removed', this); } return this; }
  removeFromParent() { if (this.parent) this.parent.remove(this); return this; }
  traverse(fn) { fn(this); var c = this.children; for (var i = 0; i < c.length; i++) c[i].traverse(fn); }
  traverseVisible(fn) { if (!this.visible) return; fn(this); var c = this.children; for (var i = 0; i < c.length; i++) c[i].traverseVisible(fn); }
  getObjectByName(name) { if (this.name === name) return this; for (var i = 0; i < this.children.length; i++) { var r = this.children[i].getObjectByName(name); if (r) return r; } return null; }
  find(pred) { var out = null; this.traverse(function (n) { if (!out && pred(n)) out = n; }); return out; }
  findAll(pred) { var out = []; this.traverse(function (n) { if (pred(n)) out.push(n); }); return out; }
  updateMatrix() { this.matrix.compose(this.position, this.quaternion, this.scale); }
  updateMatrixWorld(force) {
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix); else this.matrixWorld.copy(this.matrix);
    var c = this.children; for (var i = 0; i < c.length; i++) c[i].updateMatrixWorld(force);
  }
  /** Actualiza la cadena de padres (para consultas fuera del frame) */
  updateWorldMatrix() { if (this.parent) this.parent.updateWorldMatrix(); if (this.matrixAutoUpdate) this.updateMatrix(); if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix); else this.matrixWorld.copy(this.matrix); return this; }
  getWorldPosition(out) { this.updateWorldMatrix(); return (out || new Vec3()).setFromMatrixPosition(this.matrixWorld); }
  getWorldQuaternion(out) { this.updateWorldMatrix(); var s = _n3v2; this.matrixWorld.decompose(_n3v, out = out || new Quat(), s); return out; }
  /** Dirección del frente en el mundo (+Z del objeto; -Z en cámaras y luces) */
  getWorldDirection(out) { this.updateWorldMatrix(); out = (out || new Vec3()).setFromMatrixColumn(this.matrixWorld, 2).normalize(); if (this._looksNegZ) out.negate(); return out; }
  localToWorld(v) { this.updateWorldMatrix(); return v.applyMat4(this.matrixWorld); }
  worldToLocal(v) { this.updateWorldMatrix(); return v.applyMat4(_n3m.invertFrom(this.matrixWorld)); }
  translateOnAxis(axis, d) { _n3v.copy(axis).applyQuat(this.quaternion); this.position.addScaled(_n3v, d); return this; }
  translateX(d) { return this.translateOnAxis(_axX, d); }
  translateY(d) { return this.translateOnAxis(_axY, d); }
  translateZ(d) { return this.translateOnAxis(_axZ, d); }
  rotateOnAxis(axis, a) { _n3q.setFromAxisAngle(axis, a); this.quaternion.multiply(_n3q); return this; }
  rotateOnWorldAxis(axis, a) { _n3q.setFromAxisAngle(axis, a); this.quaternion.premultiply(_n3q); return this; }
  rotateX(a) { return this.rotateOnAxis(_axX, a); }
  rotateY(a) { return this.rotateOnAxis(_axY, a); }
  rotateZ(a) { return this.rotateOnAxis(_axZ, a); }
  /** Orienta el objeto hacia un punto del mundo (frente +Z; cámaras y luces con -Z) */
  lookAt(x, y, z) {
    var target = typeof x === 'object' ? _n3v2.copy(x) : _n3v2.set(x, y, z);
    var pos = this.getWorldPosition(_n3v);
    if (this._looksNegZ) _n3m.lookAt(pos, target, Vec3.UP); else _n3m.lookAt(target, pos, Vec3.UP);
    this.quaternion.setFromRotationMatrix(_n3m);
    if (this.parent) { this.parent.updateWorldMatrix(); var pq = new Quat(); this.parent.matrixWorld.decompose(new Vec3(), pq, new Vec3()); this.quaternion.premultiply(pq.invert()); }
    return this;
  }
  /** Copia superficial (las mallas comparten geometría y material) */
  clone(recursive) {
    var c = this._newEmpty();
    this._copyInto(c);
    if (recursive !== false) for (var i = 0; i < this.children.length; i++) c.add(this.children[i].clone(true));
    return c;
  }
  _newEmpty() { return new this.constructor(); }
  _copyInto(c) {
    c.name = this.name; c.position.copy(this.position); c.quaternion.copy(this.quaternion); c.scale.copy(this.scale);
    c.visible = this.visible; c.castShadow = this.castShadow; c.receiveShadow = this.receiveShadow; c.frustumCulled = this.frustumCulled;
    c.renderOrder = this.renderOrder; c.layers = this.layers; c.matrixAutoUpdate = this.matrixAutoUpdate;
    c.userData = Object.assign({}, this.userData);
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('destroy', this);
    if (this.parent) this.parent.remove(this);
    while (this.children.length) this.children[this.children.length - 1].destroy();
    if (this.body && this.body.destroy) this.body.destroy();
    this.body = null;
    this._onDestroy();
    this.removeAllListeners();
    Debug.track('Node3D', -1);
  }
  _onDestroy() { }
}
var _axX = Object.freeze(new Vec3(1, 0, 0)), _axY = Object.freeze(new Vec3(0, 1, 0)), _axZ = Object.freeze(new Vec3(0, 0, 1));
class Group3D extends Node3D { constructor() { super(); this.type = 'Group3D'; } }

/* ================================================================ Geometry3D */
class Geometry3D {
  constructor() {
    this.uid = uid(); this.attributes = Object.create(null); this.index = null;
    this.boundingBox = null; this.boundingSphere = null;
    this.drawRange = { start: 0, count: Infinity };
    this.version = 0; this._refs = 0; this.keep = false; this.disposed = false; this._gpu = Object.create(null); this.userData = {};
    Debug.track('Geometry3D', 1);
  }
  /** name: position | normal | uv | uv1 | color | joints | weights */
  setAttribute(name, data, size, normalized) {
    if (Security.isForbiddenKey(name)) return this;
    this.attributes[name] = { data: data, size: size, normalized: !!normalized, version: 0 };
    this.version++; return this;
  }
  getAttribute(name) { return this.attributes[name] || null; }
  setIndex(idx) { this.index = idx ? (idx instanceof Uint16Array || idx instanceof Uint32Array ? idx : ((arrMax(idx) > 65535) ? new Uint32Array(idx) : new Uint16Array(idx))) : null; this.version++; return this; }
  get vertexCount() { var p = this.attributes.position; return p ? p.data.length / p.size : 0; }
  /** Marca un atributo como cambiado para volver a subirlo */
  markDirty(name) { if (name) { var a = this.attributes[name]; if (a) a.version++; } else for (var k in this.attributes) this.attributes[k].version++; this.version++; this.boundingBox = null; this.boundingSphere = null; return this; }
  computeBounds() {
    var p = this.attributes.position, b = this.boundingBox || (this.boundingBox = new Box3());
    b.makeEmpty();
    if (p) { var d = p.data, s = p.size; for (var i = 0; i < d.length; i += s) b.expandByXYZ(d[i], d[i + 1], d[i + 2]); }
    var sp = this.boundingSphere || (this.boundingSphere = new Sphere());
    b.getCenter(sp.center); var r2 = 0;
    if (p) { var dd = p.data, ss = p.size, c = sp.center; for (var j = 0; j < dd.length; j += ss) { var dx = dd[j] - c.x, dy = dd[j + 1] - c.y, dz = dd[j + 2] - c.z, q = dx * dx + dy * dy + dz * dz; if (q > r2) r2 = q; } }
    sp.radius = p ? Math.sqrt(r2) : -1;
    return this;
  }
  getBoundingSphere() { if (!this.boundingSphere) this.computeBounds(); return this.boundingSphere; }
  getBoundingBox() { if (!this.boundingBox) this.computeBounds(); return this.boundingBox; }
  /** Normales suaves por vértice (promedio ponderado por área) */
  computeNormals() {
    var p = this.attributes.position; if (!p) return this;
    var pos = p.data, n = new Float32Array(pos.length / p.size * 3), idx = this.index, cnt = idx ? idx.length : pos.length / p.size;
    for (var t = 0; t + 2 < cnt; t += 3) {
      var a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2, s = p.size;
      var ax = pos[a * s], ay = pos[a * s + 1], az = pos[a * s + 2], e1x = pos[b * s] - ax, e1y = pos[b * s + 1] - ay, e1z = pos[b * s + 2] - az, e2x = pos[c * s] - ax, e2y = pos[c * s + 1] - ay, e2z = pos[c * s + 2] - az;
      var nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      n[a * 3] += nx; n[a * 3 + 1] += ny; n[a * 3 + 2] += nz; n[b * 3] += nx; n[b * 3 + 1] += ny; n[b * 3 + 2] += nz; n[c * 3] += nx; n[c * 3 + 1] += ny; n[c * 3 + 2] += nz;
    }
    for (var i = 0; i < n.length; i += 3) { var l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
    return this.setAttribute('normal', n, 3);
  }
  /** Transforma posiciones y normales (bake) */
  applyMat4(m) {
    var p = this.attributes.position, nr = this.attributes.normal, v = _n3v;
    if (p) for (var i = 0; i < p.data.length; i += p.size) { v.set(p.data[i], p.data[i + 1], p.data[i + 2]).applyMat4(m); p.data[i] = v.x; p.data[i + 1] = v.y; p.data[i + 2] = v.z; }
    if (nr) { var nm = new Float32Array(12); m.normalMatrix12(nm, 0); for (var j = 0; j < nr.data.length; j += 3) { var x = nr.data[j], y = nr.data[j + 1], z = nr.data[j + 2]; var nx = nm[0] * x + nm[4] * y + nm[8] * z, ny = nm[1] * x + nm[5] * y + nm[9] * z, nz = nm[2] * x + nm[6] * y + nm[10] * z, l = Math.hypot(nx, ny, nz) || 1; nr.data[j] = nx / l; nr.data[j + 1] = ny / l; nr.data[j + 2] = nz / l; } }
    return this.markDirty();
  }
  clone() { var g = new Geometry3D(); for (var k in this.attributes) { var a = this.attributes[k]; g.setAttribute(k, a.data.slice(), a.size, a.normalized); } if (this.index) g.setIndex(this.index.slice()); return g; }
  /** Libera la memoria de GPU en todos los renderizadores */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (var rid in this._gpu) { var r = RendererRegistry.get(+rid); if (r && r.freeGeometry) r.freeGeometry(this); }
    this._gpu = Object.create(null);
    Debug.track('Geometry3D', -1);
  }
  _retain() { this._refs++; }
  /** Vuelve a estar viva al subirse de nuevo a la GPU tras dispose() */
  _revive() { if (this.disposed) { this.disposed = false; Debug.track('Geometry3D', 1); } }
  _release() { if (--this._refs <= 0 && !this.keep) this.dispose(); }
}
function arrMax(a) { var m = 0; for (var i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }

/** Fusiona geometrías (con matrices opcionales) en una sola: menos draw calls para decorado estático */
Geometry3D.merge = function (list) {
  var total = 0, idxTotal = 0, hasUV = true, hasCol = false;
  list.forEach(function (it) { var g = it.geometry || it; total += g.vertexCount; idxTotal += g.index ? g.index.length : g.vertexCount; if (!g.attributes.uv) hasUV = false; if (g.attributes.color || it.color !== undefined) hasCol = true; });
  var pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), uv = hasUV ? new Float32Array(total * 2) : null, col = hasCol ? new Float32Array(total * 4) : null;
  var idx = total > 65535 ? new Uint32Array(idxTotal) : new Uint16Array(idxTotal), vo = 0, io = 0;
  list.forEach(function (it) {
    var g = it.geometry || it, m = it.matrix || null, vc = g.vertexCount, P = g.attributes.position, N = g.attributes.normal;
    var nm = m ? m.normalMatrix12(new Float32Array(12), 0) : null;
    for (var i = 0; i < vc; i++) {
      var x = P.data[i * P.size], y = P.data[i * P.size + 1], z = P.data[i * P.size + 2];
      if (m) { _n3v.set(x, y, z).applyMat4(m); x = _n3v.x; y = _n3v.y; z = _n3v.z; }
      pos[(vo + i) * 3] = x; pos[(vo + i) * 3 + 1] = y; pos[(vo + i) * 3 + 2] = z;
      if (N) { var a = N.data[i * 3], b = N.data[i * 3 + 1], c = N.data[i * 3 + 2]; if (nm) { var na = nm[0] * a + nm[4] * b + nm[8] * c, nb = nm[1] * a + nm[5] * b + nm[9] * c, nc = nm[2] * a + nm[6] * b + nm[10] * c, l = Math.hypot(na, nb, nc) || 1; a = na / l; b = nb / l; c = nc / l; } nrm[(vo + i) * 3] = a; nrm[(vo + i) * 3 + 1] = b; nrm[(vo + i) * 3 + 2] = c; }
      if (uv) { uv[(vo + i) * 2] = g.attributes.uv.data[i * 2]; uv[(vo + i) * 2 + 1] = g.attributes.uv.data[i * 2 + 1]; }
      // color del elemento (it.color) > color de la geometría > blanco
      if (col) { var C = g.attributes.color, cc = it.color !== undefined ? colorToLinear(it.color) : null; for (var k = 0; k < 4; k++) col[(vo + i) * 4 + k] = cc ? (k < 3 ? cc[k] : 1) : (C ? (C.size === 3 && k === 3 ? 1 : C.data[i * C.size + k]) : 1); }
    }
    if (g.index) for (var j = 0; j < g.index.length; j++) idx[io + j] = g.index[j] + vo; else for (var q = 0; q < vc; q++) idx[io + q] = vo + q;
    io += g.index ? g.index.length : vc; vo += vc;
  });
  var out = new Geometry3D(); out.setAttribute('position', pos, 3); out.setAttribute('normal', nrm, 3);
  if (uv) out.setAttribute('uv', uv, 2); if (col) out.setAttribute('color', col, 4);
  out.setIndex(idx);
  // las geometrías de origen que ninguna malla usa se liberan (siguen siendo utilizables: se vuelven a subir si hace falta)
  if (list.disposeSources !== false) list.forEach(function (it) { var g = it.geometry || it; if (g && g._refs <= 0 && !g.keep && g !== out) g.dispose(); });
  return out;
};

/* ---------------------------------------------------------------- primitivas */
function geoFromArrays(pos, nrm, uv, idx) {
  var g = new Geometry3D(); g.setAttribute('position', new Float32Array(pos), 3); g.setAttribute('normal', new Float32Array(nrm), 3); g.setAttribute('uv', new Float32Array(uv), 2); g.setIndex(idx); return g;
}
/** Caja centrada (w,h,d) con segmentos opcionales */
Geometry3D.box = function (w, h, d, seg) {
  w = w === undefined ? 1 : w; h = h === undefined ? w : h; d = d === undefined ? w : d; seg = Math.max(1, seg | 0 || 1);
  var pos = [], nrm = [], uv = [], idx = [];
  var face = function (u, v, wv, uDir, vDir, uw, vh, depth, nx, ny, nz) {
    var base = pos.length / 3;
    for (var iy = 0; iy <= seg; iy++) for (var ix = 0; ix <= seg; ix++) {
      var p = [0, 0, 0], x = (ix / seg - 0.5) * uw, y = (iy / seg - 0.5) * vh;
      p[u] = x * uDir; p[v] = y * vDir; p[wv] = depth / 2;
      pos.push(p[0], p[1], p[2]); nrm.push(nx, ny, nz); uv.push(ix / seg, 1 - iy / seg);
    }
    for (var jy = 0; jy < seg; jy++) for (var jx = 0; jx < seg; jx++) {
      var a = base + jx + (seg + 1) * jy, b = base + jx + (seg + 1) * (jy + 1), c = base + jx + 1 + (seg + 1) * (jy + 1), e = base + jx + 1 + (seg + 1) * jy;
      idx.push(a, e, b, b, e, c);
    }
  };
  face(2, 1, 0, -1, 1, d, h, w, 1, 0, 0);   // +X
  face(2, 1, 0, 1, 1, d, h, -w, -1, 0, 0);  // -X
  face(0, 2, 1, 1, -1, w, d, h, 0, 1, 0);   // +Y
  face(0, 2, 1, 1, 1, w, d, -h, 0, -1, 0);  // -Y
  face(0, 1, 2, 1, 1, w, h, d, 0, 0, 1);    // +Z
  face(0, 1, 2, -1, 1, w, h, -d, 0, 0, -1); // -Z
  return geoFromArrays(pos, nrm, uv, idx);
};
/** Plano horizontal (XZ, normal +Y): suelos, agua. Con orient 'xy' queda vertical mirando a +Z */
Geometry3D.plane = function (w, d, sx, sz, orient) {
  w = w === undefined ? 1 : w; d = d === undefined ? w : d; sx = Math.max(1, sx | 0 || 1); sz = Math.max(1, sz | 0 || sx);
  var pos = [], nrm = [], uv = [], idx = [], xy = orient === 'xy';
  for (var iz = 0; iz <= sz; iz++) for (var ix = 0; ix <= sx; ix++) {
    var x = (ix / sx - 0.5) * w, z = (iz / sz - 0.5) * d;
    if (xy) { pos.push(x, -z, 0); nrm.push(0, 0, 1); } else { pos.push(x, 0, z); nrm.push(0, 1, 0); }
    uv.push(ix / sx, iz / sz);
  }
  for (var jz = 0; jz < sz; jz++) for (var jx = 0; jx < sx; jx++) { var a = jx + (sx + 1) * jz, b = jx + (sx + 1) * (jz + 1), c = b + 1, e = a + 1; idx.push(a, b, e, e, b, c); }
  return geoFromArrays(pos, nrm, uv, idx);
};
Geometry3D.sphere = function (r, ws, hs) {
  r = r === undefined ? 0.5 : r; ws = Math.max(3, ws | 0 || 24); hs = Math.max(2, hs | 0 || 16);
  var pos = [], nrm = [], uv = [], idx = [];
  for (var iy = 0; iy <= hs; iy++) {
    var v = iy / hs, th = v * Math.PI;
    for (var ix = 0; ix <= ws; ix++) {
      var u = ix / ws, ph = u * Math.PI * 2, x = -Math.cos(ph) * Math.sin(th), y = Math.cos(th), z = Math.sin(ph) * Math.sin(th);
      pos.push(x * r, y * r, z * r); nrm.push(x, y, z); uv.push(u, v);
    }
  }
  for (var jy = 0; jy < hs; jy++) for (var jx = 0; jx < ws; jx++) {
    var a = jy * (ws + 1) + jx + 1, b = jy * (ws + 1) + jx, c = (jy + 1) * (ws + 1) + jx, e = (jy + 1) * (ws + 1) + jx + 1;
    if (jy !== 0) idx.push(a, b, e); if (jy !== hs - 1) idx.push(b, c, e);
  }
  return geoFromArrays(pos, nrm, uv, idx);
};
/** Cilindro / cono (radioArriba, radioAbajo, alto, segmentos) con tapas */
Geometry3D.cylinder = function (rt, rb, h, rs, open) {
  rt = rt === undefined ? 0.5 : rt; rb = rb === undefined ? rt : rb; h = h === undefined ? 1 : h; rs = Math.max(3, rs | 0 || 20);
  var pos = [], nrm = [], uv = [], idx = [], slope = (rb - rt) / h;
  for (var y = 0; y <= 1; y++) for (var i = 0; i <= rs; i++) {
    var u = i / rs, a = u * Math.PI * 2, r = y ? rt : rb, sx = Math.sin(a), cz = Math.cos(a);
    pos.push(r * sx, (y - 0.5) * h, r * cz); var l = Math.hypot(sx, slope, cz); nrm.push(sx / l, slope / l, cz / l); uv.push(u, 1 - y);
  }
  for (var j = 0; j < rs; j++) { var a0 = j, b0 = j + rs + 1, c0 = j + rs + 2, d0 = j + 1; idx.push(a0, d0, b0, b0, d0, c0); }
  if (!open) [1, -1].forEach(function (s) {
    var r = s > 0 ? rt : rb; if (r <= 0) return;
    var center = pos.length / 3; pos.push(0, s * h / 2, 0); nrm.push(0, s, 0); uv.push(0.5, 0.5);
    for (var k = 0; k <= rs; k++) { var an = k / rs * Math.PI * 2; pos.push(r * Math.sin(an), s * h / 2, r * Math.cos(an)); nrm.push(0, s, 0); uv.push(0.5 + Math.sin(an) / 2, 0.5 - s * Math.cos(an) / 2); }
    for (var q = 0; q < rs; q++) { if (s > 0) idx.push(center, center + 1 + q, center + 2 + q); else idx.push(center, center + 2 + q, center + 1 + q); }
  });
  return geoFromArrays(pos, nrm, uv, idx);
};
Geometry3D.cone = function (r, h, rs) { return Geometry3D.cylinder(0, r === undefined ? 0.5 : r, h, rs); };
/** Cápsula vertical (radio, alto del tramo recto) */
Geometry3D.capsule = function (r, len, rs, hs) {
  r = r === undefined ? 0.5 : r; len = len === undefined ? 1 : len; rs = Math.max(4, rs | 0 || 16); hs = Math.max(2, hs | 0 || 8);
  var pos = [], nrm = [], uv = [], idx = [], rows = hs * 2 + 1;
  for (var iy = 0; iy <= rows; iy++) {
    var top = iy <= hs, t = top ? iy / hs : (iy - hs - 1) / hs, th = t * Math.PI / 2 + (top ? 0 : Math.PI / 2), yOff = top ? len / 2 : -len / 2;
    for (var ix = 0; ix <= rs; ix++) {
      var u = ix / rs, ph = u * Math.PI * 2, x = Math.sin(th) * Math.sin(ph), y = Math.cos(th), z = Math.sin(th) * Math.cos(ph);
      pos.push(x * r, y * r + yOff, z * r); nrm.push(x, y, z); uv.push(u, iy / rows);
    }
  }
  for (var jy = 0; jy < rows; jy++) for (var jx = 0; jx < rs; jx++) { var a = jy * (rs + 1) + jx, b = a + rs + 1, c = b + 1, e = a + 1; idx.push(a, b, e, e, b, c); }
  return geoFromArrays(pos, nrm, uv, idx);
};
Geometry3D.torus = function (R, r, rs, ts) {
  R = R === undefined ? 0.5 : R; r = r === undefined ? 0.2 : r; rs = Math.max(3, rs | 0 || 16); ts = Math.max(3, ts | 0 || 32);
  var pos = [], nrm = [], uv = [], idx = [];
  for (var j = 0; j <= rs; j++) for (var i = 0; i <= ts; i++) {
    var u = i / ts * Math.PI * 2, v = j / rs * Math.PI * 2, cx = R * Math.cos(u), cz = R * Math.sin(u);
    var x = (R + r * Math.cos(v)) * Math.cos(u), y = r * Math.sin(v), z = (R + r * Math.cos(v)) * Math.sin(u);
    pos.push(x, y, z); var nx = x - cx, nz = z - cz, l = Math.hypot(nx, y, nz) || 1; nrm.push(nx / l, y / l, nz / l); uv.push(i / ts, j / rs);
  }
  for (var b = 1; b <= rs; b++) for (var a = 1; a <= ts; a++) { var p0 = (ts + 1) * b + a - 1, p1 = (ts + 1) * (b - 1) + a - 1, p2 = (ts + 1) * (b - 1) + a, p3 = (ts + 1) * b + a; idx.push(p0, p3, p1, p1, p3, p2); }
  return geoFromArrays(pos, nrm, uv, idx);
};
/** Terreno desde una función de altura h(x,z) o un array (filas de n+1 × m+1) */
Geometry3D.heightfield = function (w, d, sx, sz, heights) {
  var g = Geometry3D.plane(w, d, sx, sz), p = g.attributes.position.data, get = typeof heights === 'function' ? heights : function (x, z, ix, iz) { return heights[iz * (sx + 1) + ix] || 0; };
  for (var iz = 0; iz <= sz; iz++) for (var ix = 0; ix <= sx; ix++) { var k = (iz * (sx + 1) + ix) * 3; p[k + 1] = get(p[k], p[k + 2], ix, iz); }
  g.computeNormals(); g.userData = { heightfield: { w: w, d: d, sx: sx, sz: sz } };
  return g;
};
/** Prisma a partir de un polígono 2D (x,z) extruido en altura: muros, casas, plataformas */
Geometry3D.extrude = function (points, height) {
  // admite [[x, z], ...], [{x, z}], [{x, y}] (y como z) o [x0, z0, x1, z1, ...]
  var flat;
  if (points && points.length && Array.isArray(points[0])) { flat = []; for (var pi = 0; pi < points.length; pi++) flat.push(+points[pi][0] || 0, +points[pi][1] || 0); }
  else if (points && points.length && points[0] && typeof points[0] === 'object' && points[0].z !== undefined) { flat = []; for (var pj = 0; pj < points.length; pj++) flat.push(+points[pj].x || 0, +points[pj].z || 0); }
  else flat = flattenPoints(points).map(function (v) { return isFinite(v) ? v : 0; });
  if (flat.length < 6) throw new Error('Geometry3D.extrude: se necesitan al menos 3 puntos');
  var n = flat.length / 2, h = height === undefined ? 1 : height, pos = [], nrm = [], uv = [], idx = [];
  var area = 0; for (var i = 0; i < n; i++) { var j = (i + 1) % n; area += flat[i * 2] * flat[j * 2 + 1] - flat[j * 2] * flat[i * 2 + 1]; }
  var ccw = area > 0, tris = Earcut(flat, null, 2);
  [h, 0].forEach(function (y, capI) {
    var base = pos.length / 3;
    for (var k = 0; k < n; k++) { pos.push(flat[k * 2], y, flat[k * 2 + 1]); nrm.push(0, capI ? -1 : 1, 0); uv.push(flat[k * 2], flat[k * 2 + 1]); }
    // la tapa de arriba mira a +Y y la de abajo a -Y, sea cual sea la orientación que devuelva earcut
    for (var t = 0; t < tris.length; t += 3) { var a = tris[t], b = tris[t + 1], c = tris[t + 2], cr = (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]) - (flat[b * 2 + 1] - flat[a * 2 + 1]) * (flat[c * 2] - flat[a * 2]); if ((capI === 0) === (cr < 0)) idx.push(base + a, base + b, base + c); else idx.push(base + a, base + c, base + b); }
  });
  var perim = 0;
  for (var s = 0; s < n; s++) {
    var s2 = (s + 1) % n, x0 = flat[s * 2], z0 = flat[s * 2 + 1], x1 = flat[s2 * 2], z1 = flat[s2 * 2 + 1], len = Math.hypot(x1 - x0, z1 - z0) || 1;
    var nx = (z1 - z0) / len, nz = -(x1 - x0) / len; if (!ccw) { nx = -nx; nz = -nz; }
    var b0 = pos.length / 3;
    pos.push(x0, 0, z0, x1, 0, z1, x1, h, z1, x0, h, z0); for (var q = 0; q < 4; q++) nrm.push(nx, 0, nz);
    uv.push(perim, 1, perim + len, 1, perim + len, 0, perim, 0); perim += len;
    if (ccw) idx.push(b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2); else idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
  }
  return geoFromArrays(pos, nrm, uv, idx);
};

/* ================================================================ Materiales */
var MATERIAL_SIDES = { front: 0, back: 1, double: 2 };
class Material3D {
  constructor(o) {
    o = o || {};
    this.uid = uid(); this.type = 'Material3D'; this.name = o.name || '';
    this._color = 0xffffff; this.linearColor = [1, 1, 1]; this.opacity = 1;
    this.map = null; this.emissiveMap = null; this.normalMap = null; this.metalRoughMap = null; this.aoMap = null;
    this._emissive = 0x000000; this.linearEmissive = [0, 0, 0]; this.emissiveIntensity = 1;
    this.metalness = 0; this.roughness = 0.8; this.normalScale = 1; this.aoStrength = 1; this.envIntensity = 1;
    this.transparent = false; this.alphaTest = 0; this.side = 'front'; this.depthWrite = true; this.depthTest = true; this.blend = 'normal';
    this.vertexColors = false; this.fog = true; this.flatShading = false; this.unlit = false; this.toon = false; this.toonSteps = 3;
    this.rimColor = 0x000000; this.linearRim = [0, 0, 0]; this.rimPower = 3;
    this.outline = 0; this._outlineColor = 0x000000; this.linearOutline = [0, 0, 0];
    this.uvOffset = new Vec2(0, 0); this.uvScale = new Vec2(1, 1); this.uvRotation = 0;
    /** wind > 0: la malla se mece con el viento (hierba, hojas, banderas); crece con la altura local (y) del vértice */
    this.wind = 0;
    /** water: superficie de agua con olas (desplazamiento + normales en el vértice); waveHeight en metros */
    this.water = false; this.waveHeight = 0.12;
    /** con side 'double': false = la cara trasera usa la misma normal (hierba, hojas: se iluminan igual por ambos lados) */
    this.flipBackfaceNormals = true;
    this.shadowSide = null; this.version = 0;
    this.set(o);
  }
  get color() { return this._color; } set color(v) { this._color = Color.toNumber(v); colorToLinear(this._color, this.linearColor); }
  get emissive() { return this._emissive; } set emissive(v) { this._emissive = Color.toNumber(v); colorToLinear(this._emissive, this.linearEmissive); }
  get outlineColor() { return this._outlineColor; } set outlineColor(v) { this._outlineColor = Color.toNumber(v); colorToLinear(this._outlineColor, this.linearOutline); }
  get rim() { return this.rimColor; } set rim(v) { this.rimColor = Color.toNumber(v); colorToLinear(this.rimColor, this.linearRim); }
  /** Asigna varias propiedades a la vez (desde objeto de configuración) */
  set(o) {
    for (var k in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k) || Security.isForbiddenKey(k) || k === 'type' || k === 'uid') continue;
      if (k === 'uvScale' || k === 'uvOffset') { var v = o[k]; if (typeof v === 'number') this[k].set(v, v); else if (v) this[k].set(v.x !== undefined ? v.x : v[0], v.y !== undefined ? v.y : v[1]); continue; }
      if (k === 'rimColor') { this.rim = o[k]; continue; }
      this[k] = o[k];
    }
    this.version++;
    return this;
  }
  /** Firma de variante de shader (lo que cambia el código generado) */
  get featureKey() {
    return (this.map ? 'M' : '') + (this.normalMap ? 'N' : '') + (this.metalRoughMap ? 'R' : '') + (this.emissiveMap ? 'E' : '') + (this.aoMap ? 'O' : '') +
      (this.vertexColors ? 'C' : '') + (this.alphaTest > 0 ? 'A' : '') + (this.unlit ? 'U' : '') + (this.toon ? 'T' : '') + (this.fog ? 'F' : '') + (this.flatShading ? 'S' : '') + (this.side === 'double' ? (this.flipBackfaceNormals === false ? 'd' : 'D') : '') + (this.water ? 'Q' : (this.wind > 0 ? 'W' : ''));
  }
  clone() { var m = new this.constructor(), self = this; Object.keys(this).forEach(function (k) { if (k === 'uid' || k === 'version') return; var v = self[k]; m[k] = v instanceof Vec2 ? v.clone() : (Array.isArray(v) ? v.slice() : v); }); return m; }
  dispose() { this.version++; }
}
/** PBR metal-rugosidad (el modelo de glTF / Blender Principled BSDF) */
class StandardMaterial extends Material3D { constructor(o) { super(o); this.type = 'StandardMaterial'; } }
/** Sin iluminación: color × textura (HUD 3D, cielos, efectos, low-poly plano) */
class BasicMaterial extends Material3D { constructor(o) { super(Object.assign({ unlit: true }, o || {})); this.type = 'BasicMaterial'; } }
/** Sombreado cartoon por bandas con borde (rim) y contorno opcional */
class ToonMaterial extends Material3D { constructor(o) { super(Object.assign({ toon: true, roughness: 1, rimColor: 0xffffff, rimPower: 4 }, o || {})); this.type = 'ToonMaterial'; } }

/* ================================================================ Mallas */
class Mesh3D extends Node3D {
  constructor(geometry, material) {
    super();
    this.type = 'Mesh3D';
    this._geometry = null; this.material = material === undefined ? new StandardMaterial() : material;
    this.geometry = geometry === undefined ? Geometry3D.box(1) : geometry;
    this._wSphere = new Sphere();
    this.skeleton = null; this.instanced = false;
  }
  get geometry() { return this._geometry; }
  set geometry(g) { if (g === this._geometry) return; if (this._geometry) this._geometry._release(); this._geometry = g; if (g) g._retain(); }
  /** Esfera envolvente en el mundo (para culling y picking) */
  getWorldSphere() { var s = this._geometry.getBoundingSphere(); this._wSphere.copy(s).applyMat4(this.matrixWorld); return this._wSphere; }
  _newEmpty() { return new this.constructor(null, null); }
  _copyInto(c) { super._copyInto(c); c.geometry = this._geometry; c.material = this.material; c.skeleton = this.skeleton; }
  _onDestroy() { if (this._geometry) this._geometry._release(); this._geometry = null; if (this.skeleton && this.skeleton.releaseGPU) this.skeleton.releaseGPU(); }
}
/** Muchas copias de la misma malla en 1 draw call (árboles, balas, edificios, hierba) */
class InstancedMesh3D extends Mesh3D {
  constructor(geometry, material, capacity) {
    super(geometry, material);
    this.type = 'InstancedMesh3D'; this.instanced = true;
    this.capacity = Math.max(1, capacity | 0 || 16); this.count = this.capacity;
    this.instanceMatrix = new Float32Array(this.capacity * 16); this.instanceColor = new Float32Array(this.capacity * 4).fill(1);
    for (var i = 0; i < this.capacity; i++) { var o = i * 16; this.instanceMatrix[o] = this.instanceMatrix[o + 5] = this.instanceMatrix[o + 10] = this.instanceMatrix[o + 15] = 1; }
    this.instanceVersion = 1; this._bounds = null; this.useInstanceColor = false;
  }
  setMatrixAt(i, m) { if (i < 0 || i >= this.capacity) return this; this.instanceMatrix.set(m.e, i * 16); this.instanceVersion++; this._bounds = null; return this; }
  getMatrixAt(i, out) { return (out || new Mat4()).fromArray(this.instanceMatrix, i * 16); }
  /** Atajo: posición, rotación en Y (o Quat) y escala */
  setTransformAt(i, pos, rot, scale) {
    if (typeof rot === 'number') _n3q.setFromEuler(0, rot, 0); else if (rot) _n3q.copy(rot); else _n3q.identity();
    var s = typeof scale === 'number' ? _n3v2.set(scale, scale, scale) : (scale || _v3one);
    _n3m.compose(pos, _n3q, s); return this.setMatrixAt(i, _n3m);
  }
  setColorAt(i, c) { if (i < 0 || i >= this.capacity) return this; colorToLinear(c, this.instanceColor, i * 4); this.instanceColor[i * 4 + 3] = 1; this.useInstanceColor = true; this.instanceVersion++; return this; }
  /** Esfera que envuelve todas las instancias activas (en espacio del objeto) */
  getLocalBounds() {
    if (this._bounds && this._bounds.count === this.count) return this._bounds.sphere;
    var gs = this._geometry.getBoundingSphere(), b = new Box3(), c = new Vec3(), maxR = 0, m = this.instanceMatrix;
    for (var i = 0; i < this.count; i++) {
      var o = i * 16; c.copy(gs.center); var x = c.x, y = c.y, z = c.z;
      var px = m[o] * x + m[o + 4] * y + m[o + 8] * z + m[o + 12], py = m[o + 1] * x + m[o + 5] * y + m[o + 9] * z + m[o + 13], pz = m[o + 2] * x + m[o + 6] * y + m[o + 10] * z + m[o + 14];
      b.expandByXYZ(px, py, pz);
      var sc = Math.sqrt(Math.max(m[o] * m[o] + m[o + 1] * m[o + 1] + m[o + 2] * m[o + 2], m[o + 4] * m[o + 4] + m[o + 5] * m[o + 5] + m[o + 6] * m[o + 6], m[o + 8] * m[o + 8] + m[o + 9] * m[o + 9] + m[o + 10] * m[o + 10]));
      if (gs.radius * sc > maxR) maxR = gs.radius * sc;
    }
    var sp = new Sphere().setFromBox(b); sp.radius += maxR; if (this.count === 0) sp.radius = -1;
    this._bounds = { count: this.count, sphere: sp };
    return sp;
  }
  getWorldSphere() { this._wSphere.copy(this.getLocalBounds()).applyMat4(this.matrixWorld); return this._wSphere; }
  _newEmpty() { return new InstancedMesh3D(null, null, this.capacity); }
  _copyInto(c) { super._copyInto(c); c.count = this.count; c.instanceMatrix.set(this.instanceMatrix); c.instanceColor.set(this.instanceColor); c.useInstanceColor = this.useInstanceColor; c.instanceVersion++; }
}

/** Esqueleto: huesos (nodos) + matrices de ligadura inversa (glTF) */
class Skeleton3D {
  constructor(bones, inverseBind) {
    this.bones = bones; this.count = bones.length;
    this.inverseBind = inverseBind || new Float32Array(bones.length * 16);
    if (!inverseBind) for (var i = 0; i < bones.length; i++) { var o = i * 16; this.inverseBind[o] = this.inverseBind[o + 5] = this.inverseBind[o + 10] = this.inverseBind[o + 15] = 1; }
    this.jointMatrices = new Float32Array(bones.length * 16); this.version = 0;
    this._inv = new Mat4(); this._tmp = new Mat4(); this._ib = new Mat4();
    this._gpu = Object.create(null); // renderizadores con textura/buffer de huesos para este esqueleto
  }
  /** Libera ya la memoria de GPU de este esqueleto (se vuelve a crear sola si se sigue dibujando) */
  releaseGPU() { for (var rid in this._gpu) { var r = RendererRegistry.get(+rid); if (r && r.freeSkeleton) r.freeSkeleton(this); } this._gpu = Object.create(null); }
  /** jointMatrix[i] = inverse(meshWorld) * boneWorld[i] * inverseBind[i] */
  update(meshWorld) {
    this._inv.invertFrom(meshWorld);
    for (var i = 0; i < this.count; i++) {
      this._ib.fromArray(this.inverseBind, i * 16);
      this._tmp.multiplyMatrices(this._inv, this.bones[i].matrixWorld).multiply(this._ib);
      this.jointMatrices.set(this._tmp.e, i * 16);
    }
    this.version++;
  }
}

/* ================================================================ Cámaras */
class Camera3D extends Node3D {
  constructor() {
    super(); this.type = 'Camera3D'; this._looksNegZ = true;
    this.projectionMatrix = new Mat4(); this.viewMatrix = new Mat4(); this.viewProjection = new Mat4(); this.frustum = new Frustum();
    this.near = 0.1; this.far = 1000; this.aspect = 1; this.castShadow = false;
  }
  updateProjection() { }
  updateView() {
    this.updateWorldMatrix(); this.viewMatrix.invertFrom(this.matrixWorld);
    this.viewProjection.multiplyMatrices(this.projectionMatrix, this.viewMatrix); this.frustum.setFromMatrix(this.viewProjection);
    return this;
  }
  /** Rayo desde coordenadas normalizadas (-1..1, y hacia arriba) */
  rayFromNDC(nx, ny, out) {
    out = out || new Ray(); this.updateView();
    var inv = new Mat4().invertFrom(this.viewProjection), a = new Vec3(nx, ny, -1).applyMat4(inv), b = new Vec3(nx, ny, 1).applyMat4(inv);
    return out.set(a, b.sub(a));
  }
  /** Proyecta un punto del mundo a NDC (x,y en -1..1; z > 1 = detrás/fuera) */
  project(v, out) { this.updateView(); return (out || new Vec3()).copy(v).applyMat4(this.viewProjection); }
}
class PerspectiveCamera extends Camera3D {
  constructor(fov, aspect, near, far) { super(); this.type = 'PerspectiveCamera'; this.fov = fov || 60; this.aspect = aspect || 1; this.near = near || 0.1; this.far = far || 1000; this.zoom = 1; this.updateProjection(); }
  updateProjection() { var f = 2 * Math.atan(Math.tan(this.fov * DEG_TO_RAD / 2) / (this.zoom || 1)); this.projectionMatrix.perspective(f, this.aspect, this.near, this.far); return this; }
  _copyInto(c) { super._copyInto(c); c.fov = this.fov; c.near = this.near; c.far = this.far; c.aspect = this.aspect; c.zoom = this.zoom; c.updateProjection(); }
}
class OrthographicCamera extends Camera3D {
  constructor(size, aspect, near, far) { super(); this.type = 'OrthographicCamera'; this.size = size || 10; this.aspect = aspect || 1; this.near = near === undefined ? 0.1 : near; this.far = far || 1000; this.updateProjection(); }
  updateProjection() { var h = this.size / 2, w = h * this.aspect; this.projectionMatrix.orthographic(-w, w, h, -h, this.near, this.far); return this; }
}

/* ================================================================ Luces */
class Light3D extends Node3D {
  constructor(color, intensity) { super(); this.type = 'Light3D'; this._looksNegZ = true; this.castShadow = false; this.receiveShadow = false; this.color = color === undefined ? 0xffffff : color; this.intensity = intensity === undefined ? 1 : intensity; }
  get color() { return this._color; } set color(v) { this._color = Color.toNumber(v); this.linearColor = colorToLinear(this._color); }
  _newEmpty() { return new this.constructor(); }
  _copyInto(c) {
    super._copyInto(c);
    c._color = this._color; c.linearColor = this.linearColor.slice(); c.intensity = this.intensity;
    var self = this;
    ['range', 'decay', 'angle', 'penumbra', 'useNodeDirection'].forEach(function (k) { if (self[k] !== undefined) c[k] = self[k]; });
    if (this.direction) c.direction.copy(this.direction);
    if (this._ground !== undefined) c.groundColor = this._ground;
    if (this.shadow) { var s = this.shadow; Object.assign(c.shadow, { enabled: s.enabled, mapSize: s.mapSize, size: s.size, near: s.near, far: s.far, bias: s.bias, normalBias: s.normalBias, softness: s.softness, follow: s.follow }); }
  }
}
class AmbientLight extends Light3D { constructor(color, intensity) { super(color, intensity === undefined ? 0.3 : intensity); this.type = 'AmbientLight'; } }
/** Luz de cielo/suelo: la forma más barata de una iluminación ambiental convincente */
class HemisphereLight extends Light3D {
  constructor(sky, ground, intensity) { super(sky === undefined ? 0xbfd8ff : sky, intensity === undefined ? 0.6 : intensity); this.type = 'HemisphereLight'; this.groundColor = ground === undefined ? 0x5a4a3a : ground; }
  get groundColor() { return this._ground; } set groundColor(v) { this._ground = Color.toNumber(v); this.linearGround = colorToLinear(this._ground); }
}
/** Sol: dirección paralela; la sombra sigue a un objetivo (normalmente la cámara o el jugador) */
class DirectionalLight extends Light3D {
  constructor(color, intensity) {
    super(color, intensity === undefined ? 2 : intensity); this.type = 'DirectionalLight';
    this.direction = new Vec3(-0.4, -1, -0.3).normalize();
    this.shadow = { enabled: false, mapSize: 2048, size: 40, near: 0.5, far: 200, bias: 0.0015, normalBias: 0.03, softness: 1, follow: null, matrix: new Mat4(), camera: new OrthographicCamera(40, 1, 0.5, 200) };
  }
  setDirection(x, y, z) { if (typeof x === 'object') this.direction.copy(x); else this.direction.set(x, y, z); this.direction.normalize(); return this; }
  lookAt(x, y, z) { var t = typeof x === 'object' ? x : new Vec3(x, y, z); this.direction.subVectors(t, this.getWorldPosition(new Vec3())).normalize(); return this; }
  enableShadows(opts) { Object.assign(this.shadow, opts || {}); this.shadow.enabled = true; this.castShadow = true; return this; }
  /** La cámara interna de la sombra es un nodo propio: se destruye con la luz */
  _onDestroy() { if (this.shadow && this.shadow.camera && !this.shadow.camera.destroyed) this.shadow.camera.destroy(); this.shadow.follow = null; }
}
class PointLight extends Light3D {
  constructor(color, intensity, range, decay) { super(color, intensity === undefined ? 3 : intensity); this.type = 'PointLight'; this.range = range || 10; this.decay = decay === undefined ? 2 : decay; }
}
class SpotLight extends Light3D {
  constructor(color, intensity, range, angle, penumbra) { super(color, intensity === undefined ? 4 : intensity); this.type = 'SpotLight'; this.range = range || 15; this.angle = angle || Math.PI / 5; this.penumbra = penumbra === undefined ? 0.3 : penumbra; }
}

/* ================================================================ Escena */
class Scene3D extends Node3D {
  constructor() {
    super(); this.type = 'Scene3D';
    this.background = 0x87b5e6; this.backgroundAlpha = 1;
    /** Cielo procedural: { top, horizon, bottom, sunColor, sunSize } o null para color liso */
    this.sky = null;
    this.fog = null; // { type: 'linear'|'exp2', color, near, far, density }
    this.exposure = 1; this.toneMapping = 'aces';
    this.envIntensity = 1;
    this.mixers = [];
    /** segundos de simulación de esta escena (lo avanza la vista): mueve nubes y estrellas */
    this.time = 0;
  }
  setFog(type, color, a, b) { this.fog = type ? { type: type, color: color === undefined ? 0xa0b4c8 : color, near: type === 'linear' ? (a || 10) : 0, far: type === 'linear' ? (b || 100) : 0, density: type === 'exp2' ? (a || 0.02) : 0 } : null; return this; }
  /**
   * Cielo procedural. o: { top, horizon, bottom, sunColor, sunSize, sunIntensity,
   *   clouds: true | { coverage 0..1, sharpness, scale, speed, color, opacity, wind: [x, z], octaves 1..6, shadow 0..1 },
   *   stars: 0..1 (estrellas, para la noche), moon: 0..1 (luna opuesta al sol) }
   * Los valores se leen en cada frame: se pueden cambiar en caliente (scene3d.sky.clouds.coverage = 0.8).
   */
  setSky(o) {
    if (!o) { this.sky = null; return this; }
    var s = Object.assign({ top: 0x2f6fd0, horizon: 0xbfdcf5, bottom: 0x6d6a60, sunColor: 0xfff2d0, sunSize: 0.04, sunIntensity: 1, stars: 0, moon: 0 }, o);
    s.clouds = normalizeClouds(o.clouds);
    this.sky = s;
    return this;
  }
  /** Activa, cambia (objeto parcial) o quita (null/false) las nubes del cielo */
  setClouds(c) {
    if (!this.sky) this.setSky({});
    if (!c) { this.sky.clouds = null; return this; }
    this.sky.clouds = normalizeClouds(Object.assign({}, this.sky.clouds || {}, c === true ? {} : c));
    return this;
  }
}
function cloudNum(v, def, lo, hi) { v = +v; if (!isFinite(v)) v = def; return v < lo ? lo : (v > hi ? hi : v); }
/** Normaliza (y acota) la configuración de nubes: valores fuera de rango o no numéricos se sustituyen */
function normalizeClouds(c) {
  if (!c) return null;
  if (c === true) c = {};
  var w = Array.isArray(c.wind) ? c.wind : [1, 0.35], wl = Math.hypot(+w[0] || 0, +w[1] || 0) || 1;
  return {
    coverage: cloudNum(c.coverage, 0.45, 0, 1), sharpness: cloudNum(c.sharpness, 0.3, 0.02, 1), scale: cloudNum(c.scale, 0.55, 0.02, 20),
    speed: cloudNum(c.speed, 0.015, -5, 5), color: c.color === undefined ? 0xffffff : c.color, opacity: cloudNum(c.opacity, 0.95, 0, 1),
    wind: [(+w[0] || 0) / wl, (+w[1] || 0) / wl], octaves: Math.round(cloudNum(c.octaves, 5, 1, 6)), shadow: cloudNum(c.shadow, 0.6, 0, 1)
  };
}

UG.Node3D = Node3D; UG.Group3D = Group3D; UG.Geometry3D = Geometry3D; UG.Material3D = Material3D; UG.StandardMaterial = StandardMaterial; UG.BasicMaterial = BasicMaterial; UG.ToonMaterial = ToonMaterial;
UG.Mesh3D = Mesh3D; UG.InstancedMesh3D = InstancedMesh3D; UG.Skeleton3D = Skeleton3D; UG.Camera3D = Camera3D; UG.PerspectiveCamera = PerspectiveCamera; UG.OrthographicCamera = OrthographicCamera;
UG.Light3D = Light3D; UG.AmbientLight = AmbientLight; UG.HemisphereLight = HemisphereLight; UG.DirectionalLight = DirectionalLight; UG.PointLight = PointLight; UG.SpotLight = SpotLight; UG.Scene3D = Scene3D;
UG.colorToLinear = colorToLinear; UG.normalizeClouds = normalizeClouds;
