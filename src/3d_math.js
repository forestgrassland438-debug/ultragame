/* UltraGame 3D - matemáticas: Vec3, Vec4, Quat, Euler, Mat4, Box3, Sphere, Plane, Frustum, Ray.
 * Convenciones: mano derecha, Y hacia arriba, la cámara mira hacia -Z. Matrices en columnas (como WebGL/WGSL). */

class Vec3 {
  constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
  set(x, y, z) { this.x = x; this.y = y === undefined ? x : y; this.z = z === undefined ? x : z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vec3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  addVectors(a, b) { this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z; return this; }
  scale(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  multiply(v) { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; }
  negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v) { return this.crossVectors(this, v); }
  crossVectors(a, b) { var ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z; this.x = ay * bz - az * by; this.y = az * bx - ax * bz; this.z = ax * by - ay * bx; return this; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  normalize() { var l = this.length(); if (l > 1e-12) { this.x /= l; this.y /= l; this.z /= l; } return this; }
  setLength(len) { return this.normalize().scale(len); }
  distanceTo(v) { var dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
  distanceToSq(v) { var dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return dx * dx + dy * dy + dz * dz; }
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
  min(v) { this.x = Math.min(this.x, v.x); this.y = Math.min(this.y, v.y); this.z = Math.min(this.z, v.z); return this; }
  max(v) { this.x = Math.max(this.x, v.x); this.y = Math.max(this.y, v.y); this.z = Math.max(this.z, v.z); return this; }
  equals(v, eps) { eps = eps || 0; return Math.abs(this.x - v.x) <= eps && Math.abs(this.y - v.y) <= eps && Math.abs(this.z - v.z) <= eps; }
  applyMat4(m) {
    var e = m.e, x = this.x, y = this.y, z = this.z, w = e[3] * x + e[7] * y + e[11] * z + e[15];
    w = w !== 0 ? 1 / w : 1;
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w; this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w; this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    return this;
  }
  /** Transforma como dirección (sin traslación) y normaliza */
  transformDirection(m) { var e = m.e, x = this.x, y = this.y, z = this.z; this.x = e[0] * x + e[4] * y + e[8] * z; this.y = e[1] * x + e[5] * y + e[9] * z; this.z = e[2] * x + e[6] * y + e[10] * z; return this.normalize(); }
  applyQuat(q) {
    var x = this.x, y = this.y, z = this.z, qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    var tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    this.x = x + qw * tx + qy * tz - qz * ty; this.y = y + qw * ty + qz * tx - qx * tz; this.z = z + qw * tz + qx * ty - qy * tx;
    return this;
  }
  setFromMatrixPosition(m) { this.x = m.e[12]; this.y = m.e[13]; this.z = m.e[14]; return this; }
  setFromMatrixColumn(m, i) { var e = m.e; this.x = e[i * 4]; this.y = e[i * 4 + 1]; this.z = e[i * 4 + 2]; return this; }
  fromArray(a, o) { o = o || 0; this.x = a[o]; this.y = a[o + 1]; this.z = a[o + 2]; return this; }
  toArray(a, o) { a = a || []; o = o || 0; a[o] = this.x; a[o + 1] = this.y; a[o + 2] = this.z; return a; }
  angleTo(v) { var d = Math.sqrt(this.lengthSq() * v.lengthSq()); if (d === 0) return Math.PI / 2; return Math.acos(Math.max(-1, Math.min(1, this.dot(v) / d))); }
  projectOnPlane(n) { var d = this.dot(n) / (n.lengthSq() || 1); this.x -= n.x * d; this.y -= n.y * d; this.z -= n.z * d; return this; }
  reflect(n) { var d = 2 * this.dot(n); this.x -= n.x * d; this.y -= n.y * d; this.z -= n.z * d; return this; }
}
Vec3.UP = Object.freeze(new Vec3(0, 1, 0));

class Vec4 {
  constructor(x, y, z, w) { this.x = x || 0; this.y = y || 0; this.z = z || 0; this.w = w === undefined ? 1 : w; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; this.w = v.w; return this; }
  clone() { return new Vec4(this.x, this.y, this.z, this.w); }
}

class Quat {
  constructor(x, y, z, w) { this.x = x || 0; this.y = y || 0; this.z = z || 0; this.w = w === undefined ? 1 : w; this._onChange = null; }
  _changed() { if (this._onChange) this._onChange(); return this; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this._changed(); }
  identity() { return this.set(0, 0, 0, 1); }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this._changed(); }
  clone() { return new Quat(this.x, this.y, this.z, this.w); }
  setFromAxisAngle(axis, angle) {
    var h = angle / 2, s = Math.sin(h), l = Math.sqrt(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z) || 1;
    this.x = axis.x / l * s; this.y = axis.y / l * s; this.z = axis.z / l * s; this.w = Math.cos(h); return this._changed();
  }
  /** Ángulos de Euler en radianes; orden por defecto 'YXZ' (yaw-pitch-roll, ideal para cámaras y personajes) */
  setFromEuler(x, y, z, order) {
    var c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2), s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
    switch (order || 'YXZ') {
      case 'XYZ': this.x = s1 * c2 * c3 + c1 * s2 * s3; this.y = c1 * s2 * c3 - s1 * c2 * s3; this.z = c1 * c2 * s3 + s1 * s2 * c3; this.w = c1 * c2 * c3 - s1 * s2 * s3; break;
      case 'ZXY': this.x = s1 * c2 * c3 - c1 * s2 * s3; this.y = c1 * s2 * c3 + s1 * c2 * s3; this.z = c1 * c2 * s3 + s1 * s2 * c3; this.w = c1 * c2 * c3 - s1 * s2 * s3; break;
      case 'ZYX': this.x = s1 * c2 * c3 - c1 * s2 * s3; this.y = c1 * s2 * c3 + s1 * c2 * s3; this.z = c1 * c2 * s3 - s1 * s2 * c3; this.w = c1 * c2 * c3 + s1 * s2 * s3; break;
      case 'YZX': this.x = s1 * c2 * c3 + c1 * s2 * s3; this.y = c1 * s2 * c3 + s1 * c2 * s3; this.z = c1 * c2 * s3 - s1 * s2 * c3; this.w = c1 * c2 * c3 - s1 * s2 * s3; break;
      case 'XZY': this.x = s1 * c2 * c3 - c1 * s2 * s3; this.y = c1 * s2 * c3 - s1 * c2 * s3; this.z = c1 * c2 * s3 + s1 * s2 * c3; this.w = c1 * c2 * c3 + s1 * s2 * s3; break;
      default: /* YXZ */ this.x = s1 * c2 * c3 + c1 * s2 * s3; this.y = c1 * s2 * c3 - s1 * c2 * s3; this.z = c1 * c2 * s3 - s1 * s2 * c3; this.w = c1 * c2 * c3 + s1 * s2 * s3;
    }
    return this._changed();
  }
  setFromRotationMatrix(m) {
    var e = m.e, m11 = e[0], m12 = e[4], m13 = e[8], m21 = e[1], m22 = e[5], m23 = e[9], m31 = e[2], m32 = e[6], m33 = e[10], tr = m11 + m22 + m33, s;
    if (tr > 0) { s = 0.5 / Math.sqrt(tr + 1); this.w = 0.25 / s; this.x = (m32 - m23) * s; this.y = (m13 - m31) * s; this.z = (m21 - m12) * s; }
    else if (m11 > m22 && m11 > m33) { s = 2 * Math.sqrt(1 + m11 - m22 - m33); this.w = (m32 - m23) / s; this.x = 0.25 * s; this.y = (m12 + m21) / s; this.z = (m13 + m31) / s; }
    else if (m22 > m33) { s = 2 * Math.sqrt(1 + m22 - m11 - m33); this.w = (m13 - m31) / s; this.x = (m12 + m21) / s; this.y = 0.25 * s; this.z = (m23 + m32) / s; }
    else { s = 2 * Math.sqrt(1 + m33 - m11 - m22); this.w = (m21 - m12) / s; this.x = (m13 + m31) / s; this.y = (m23 + m32) / s; this.z = 0.25 * s; }
    return this._changed();
  }
  /** Rotación que lleva el vector unitario a al b */
  setFromUnitVectors(a, b) {
    var r = a.x * b.x + a.y * b.y + a.z * b.z + 1;
    if (r < 1e-8) { r = 0; if (Math.abs(a.x) > Math.abs(a.z)) { this.x = -a.y; this.y = a.x; this.z = 0; } else { this.x = 0; this.y = -a.z; this.z = a.y; } }
    else { this.x = a.y * b.z - a.z * b.y; this.y = a.z * b.x - a.x * b.z; this.z = a.x * b.y - a.y * b.x; }
    this.w = r; return this.normalize();
  }
  multiply(q) { return this.multiplyQuats(this, q); }
  premultiply(q) { return this.multiplyQuats(q, this); }
  multiplyQuats(a, b) {
    var ax = a.x, ay = a.y, az = a.z, aw = a.w, bx = b.x, by = b.y, bz = b.z, bw = b.w;
    this.x = ax * bw + aw * bx + ay * bz - az * by; this.y = ay * bw + aw * by + az * bx - ax * bz;
    this.z = az * bw + aw * bz + ax * by - ay * bx; this.w = aw * bw - ax * bx - ay * by - az * bz;
    return this._changed();
  }
  invert() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this._changed(); } // conjugado (unitario)
  dot(q) { return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w; }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w); }
  normalize() { var l = this.length(); if (l < 1e-12) { this.x = this.y = this.z = 0; this.w = 1; } else { this.x /= l; this.y /= l; this.z /= l; this.w /= l; } return this._changed(); }
  slerp(qb, t) {
    if (t <= 0) return this; if (t >= 1) return this.copy(qb);
    var x = this.x, y = this.y, z = this.z, w = this.w, cos = w * qb.w + x * qb.x + y * qb.y + z * qb.z, bx = qb.x, by = qb.y, bz = qb.z, bw = qb.w;
    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    if (cos > 0.9995) { this.x = x + (bx - x) * t; this.y = y + (by - y) * t; this.z = z + (bz - z) * t; this.w = w + (bw - w) * t; return this.normalize(); }
    var th = Math.acos(cos), sin = Math.sin(th), ra = Math.sin((1 - t) * th) / sin, rb = Math.sin(t * th) / sin;
    this.x = x * ra + bx * rb; this.y = y * ra + by * rb; this.z = z * ra + bz * rb; this.w = w * ra + bw * rb;
    return this._changed();
  }
  angleTo(q) { return 2 * Math.acos(Math.min(1, Math.abs(this.dot(q)))); }
  rotateTowards(q, step) { var a = this.angleTo(q); if (a === 0) return this; return this.slerp(q, Math.min(1, step / a)); }
  fromArray(a, o) { o = o || 0; this.x = a[o]; this.y = a[o + 1]; this.z = a[o + 2]; this.w = a[o + 3]; return this._changed(); }
  toArray(a, o) { a = a || []; o = o || 0; a[o] = this.x; a[o + 1] = this.y; a[o + 2] = this.z; a[o + 3] = this.w; return a; }
}

/** Euler vinculado a un cuaternión (node.rotation): al cambiar x/y/z se actualiza el cuaternión */
class Euler {
  constructor(x, y, z, order) { this._x = x || 0; this._y = y || 0; this._z = z || 0; this.order = order || 'YXZ'; this._onChange = null; }
  get x() { return this._x; } set x(v) { this._x = v; if (this._onChange) this._onChange(); }
  get y() { return this._y; } set y(v) { this._y = v; if (this._onChange) this._onChange(); }
  get z() { return this._z; } set z(v) { this._z = v; if (this._onChange) this._onChange(); }
  set(x, y, z, order) { this._x = x; this._y = y; this._z = z; if (order) this.order = order; if (this._onChange) this._onChange(); return this; }
  copy(e) { return this.set(e._x, e._y, e._z, e.order); }
  /** Descompone una matriz de rotación pura según el orden */
  setFromRotationMatrix(m, order, silent) {
    var e = m.e, m11 = e[0], m12 = e[4], m13 = e[8], m21 = e[1], m22 = e[5], m23 = e[9], m31 = e[2], m32 = e[6], m33 = e[10], cl = function (v) { return v < -1 ? -1 : (v > 1 ? 1 : v); };
    order = order || this.order;
    if (order === 'XYZ') { this._y = Math.asin(cl(m13)); if (Math.abs(m13) < 0.9999999) { this._x = Math.atan2(-m23, m33); this._z = Math.atan2(-m12, m11); } else { this._x = Math.atan2(m32, m22); this._z = 0; } }
    else { /* YXZ */ this._x = Math.asin(-cl(m23)); if (Math.abs(m23) < 0.9999999) { this._y = Math.atan2(m13, m33); this._z = Math.atan2(m21, m22); } else { this._y = Math.atan2(-m31, m11); this._z = 0; } }
    this.order = order;
    if (!silent && this._onChange) this._onChange();
    return this;
  }
}

class Mat4 {
  constructor() { this.e = new Float32Array(16); this.e[0] = this.e[5] = this.e[10] = this.e[15] = 1; }
  identity() { var e = this.e; e.fill(0); e[0] = e[5] = e[10] = e[15] = 1; return this; }
  copy(m) { this.e.set(m.e); return this; }
  clone() { return new Mat4().copy(this); }
  fromArray(a, o) { o = o || 0; for (var i = 0; i < 16; i++) this.e[i] = a[o + i]; return this; }
  multiply(m) { return this.multiplyMatrices(this, m); }
  premultiply(m) { return this.multiplyMatrices(m, this); }
  multiplyMatrices(a, b) {
    var ae = a.e, be = b.e, te = this.e;
    var a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12], a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
    var a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14], a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];
    var b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12], b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
    var b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14], b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
    te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41; te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42; te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43; te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
    te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41; te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42; te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43; te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
    te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41; te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42; te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43; te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
    te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41; te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42; te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43; te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
    return this;
  }
  compose(p, q, s) {
    var e = this.e, x = q.x, y = q.y, z = q.z, w = q.w, x2 = x + x, y2 = y + y, z2 = z + z;
    var xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2, sx = s.x, sy = s.y, sz = s.z;
    e[0] = (1 - (yy + zz)) * sx; e[1] = (xy + wz) * sx; e[2] = (xz - wy) * sx; e[3] = 0;
    e[4] = (xy - wz) * sy; e[5] = (1 - (xx + zz)) * sy; e[6] = (yz + wx) * sy; e[7] = 0;
    e[8] = (xz + wy) * sz; e[9] = (yz - wx) * sz; e[10] = (1 - (xx + yy)) * sz; e[11] = 0;
    e[12] = p.x; e[13] = p.y; e[14] = p.z; e[15] = 1;
    return this;
  }
  decompose(p, q, s) {
    var e = this.e, sx = Math.hypot(e[0], e[1], e[2]), sy = Math.hypot(e[4], e[5], e[6]), sz = Math.hypot(e[8], e[9], e[10]);
    if (this.determinant() < 0) sx = -sx;
    p.x = e[12]; p.y = e[13]; p.z = e[14];
    var m = _m4tmp.copy(this), me = m.e, ix = sx ? 1 / sx : 0, iy = sy ? 1 / sy : 0, iz = sz ? 1 / sz : 0;
    me[0] *= ix; me[1] *= ix; me[2] *= ix; me[4] *= iy; me[5] *= iy; me[6] *= iy; me[8] *= iz; me[9] *= iz; me[10] *= iz;
    q.setFromRotationMatrix(m);
    s.x = sx; s.y = sy; s.z = sz;
    return this;
  }
  determinant() {
    var e = this.e, n11 = e[0], n12 = e[4], n13 = e[8], n14 = e[12], n21 = e[1], n22 = e[5], n23 = e[9], n24 = e[13], n31 = e[2], n32 = e[6], n33 = e[10], n34 = e[14], n41 = e[3], n42 = e[7], n43 = e[11], n44 = e[15];
    return n41 * (n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34) +
      n42 * (n11 * n23 * n34 - n11 * n24 * n33 + n14 * n21 * n33 - n13 * n21 * n34 + n13 * n24 * n31 - n14 * n23 * n31) +
      n43 * (n11 * n24 * n32 - n11 * n22 * n34 - n14 * n21 * n32 + n12 * n21 * n34 + n14 * n22 * n31 - n12 * n24 * n31) +
      n44 * (-n13 * n22 * n31 - n11 * n23 * n32 + n11 * n22 * n33 + n13 * n21 * n32 - n12 * n21 * n33 + n12 * n23 * n31);
  }
  invert() { return this.invertFrom(this); }
  invertFrom(m) {
    var me = m.e, te = this.e;
    var n11 = me[0], n21 = me[1], n31 = me[2], n41 = me[3], n12 = me[4], n22 = me[5], n32 = me[6], n42 = me[7];
    var n13 = me[8], n23 = me[9], n33 = me[10], n43 = me[11], n14 = me[12], n24 = me[13], n34 = me[14], n44 = me[15];
    var t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
    var t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
    var t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
    var t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
    var det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
    if (det === 0) { te.fill(0); return this; }
    var d = 1 / det;
    te[0] = t11 * d; te[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d;
    te[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d;
    te[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d;
    te[4] = t12 * d; te[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d;
    te[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d;
    te[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d;
    te[8] = t13 * d; te[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d;
    te[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d;
    te[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d;
    te[12] = t14 * d; te[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d;
    te[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d;
    te[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d;
    return this;
  }
  transpose() { var e = this.e, t; t = e[1]; e[1] = e[4]; e[4] = t; t = e[2]; e[2] = e[8]; e[8] = t; t = e[6]; e[6] = e[9]; e[9] = t; t = e[3]; e[3] = e[12]; e[12] = t; t = e[7]; e[7] = e[13]; e[13] = t; t = e[11]; e[11] = e[14]; e[14] = t; return this; }
  makeTranslation(x, y, z) { this.identity(); this.e[12] = x; this.e[13] = y; this.e[14] = z; return this; }
  makeScale(x, y, z) { this.identity(); this.e[0] = x; this.e[5] = y; this.e[10] = z; return this; }
  makeRotationFromQuat(q) { return this.compose(_v3zero, q, _v3one); }
  /** Proyección perspectiva (fovY en radianes). Profundidad de clip -1..1 (WebGL); el backend WebGPU la remapea a 0..1. */
  perspective(fovY, aspect, near, far) {
    var f = 1 / Math.tan(fovY / 2), e = this.e, nf = 1 / (near - far);
    e.fill(0); e[0] = f / aspect; e[5] = f; e[10] = (far + near) * nf; e[11] = -1; e[14] = 2 * far * near * nf;
    return this;
  }
  orthographic(left, right, top, bottom, near, far) {
    var e = this.e, w = 1 / (right - left), h = 1 / (top - bottom), p = 1 / (far - near);
    e.fill(0); e[0] = 2 * w; e[5] = 2 * h; e[10] = -2 * p; e[12] = -(right + left) * w; e[13] = -(top + bottom) * h; e[14] = -(far + near) * p; e[15] = 1;
    return this;
  }
  /** Orienta el eje -Z de la matriz desde eye hacia target (rotación pura en la parte 3x3) */
  lookAt(eye, target, up) {
    var e = this.e, zx = eye.x - target.x, zy = eye.y - target.y, zz = eye.z - target.z, l = Math.hypot(zx, zy, zz);
    if (l === 0) zz = 1; else { zx /= l; zy /= l; zz /= l; }
    var ux = up.x, uy = up.y, uz = up.z, xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx, xl = Math.hypot(xx, xy, xz);
    if (xl === 0) { if (Math.abs(uz) === 1) zx += 0.0001; else zz += 0.0001; l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l; xx = uy * zz - uz * zy; xy = uz * zx - ux * zz; xz = ux * zy - uy * zx; xl = Math.hypot(xx, xy, xz); }
    xx /= xl; xy /= xl; xz /= xl;
    var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    e[0] = xx; e[4] = yx; e[8] = zx; e[1] = xy; e[5] = yy; e[9] = zy; e[2] = xz; e[6] = yz; e[10] = zz;
    return this;
  }
  /** Matriz normal (inversa transpuesta 3x3) empaquetada en 12 floats (3 columnas vec4) */
  normalMatrix12(out, o) {
    var e = this.e, a00 = e[0], a01 = e[1], a02 = e[2], a10 = e[4], a11 = e[5], a12 = e[6], a20 = e[8], a21 = e[9], a22 = e[10];
    var b01 = a22 * a11 - a12 * a21, b11 = -a22 * a10 + a12 * a20, b21 = a21 * a10 - a11 * a20, det = a00 * b01 + a01 * b11 + a02 * b21;
    var id = det ? 1 / det : 0;
    // inversa transpuesta: columnas
    out[o] = b01 * id; out[o + 1] = (-a22 * a01 + a02 * a21) * id; out[o + 2] = (a12 * a01 - a02 * a11) * id; out[o + 3] = 0;
    out[o + 4] = b11 * id; out[o + 5] = (a22 * a00 - a02 * a20) * id; out[o + 6] = (-a12 * a00 + a02 * a10) * id; out[o + 7] = 0;
    out[o + 8] = b21 * id; out[o + 9] = (-a21 * a00 + a01 * a20) * id; out[o + 10] = (a11 * a00 - a01 * a10) * id; out[o + 11] = 0;
    // arriba queda la inversa en columnas; la matriz normal es su transpuesta
    var t = out[o + 1]; out[o + 1] = out[o + 4]; out[o + 4] = t;
    t = out[o + 2]; out[o + 2] = out[o + 8]; out[o + 8] = t;
    t = out[o + 6]; out[o + 6] = out[o + 9]; out[o + 9] = t;
    return out;
  }
  getMaxScale() { var e = this.e; return Math.sqrt(Math.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2], e[4] * e[4] + e[5] * e[5] + e[6] * e[6], e[8] * e[8] + e[9] * e[9] + e[10] * e[10])); }
}
var _m4tmp = new Mat4(), _v3zero = Object.freeze(new Vec3(0, 0, 0)), _v3one = Object.freeze(new Vec3(1, 1, 1));

class Box3 {
  constructor(min, max) { this.min = min || new Vec3(Infinity, Infinity, Infinity); this.max = max || new Vec3(-Infinity, -Infinity, -Infinity); }
  makeEmpty() { this.min.set(Infinity, Infinity, Infinity); this.max.set(-Infinity, -Infinity, -Infinity); return this; }
  get isEmpty() { return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z; }
  set(min, max) { this.min.copy(min); this.max.copy(max); return this; }
  copy(b) { this.min.copy(b.min); this.max.copy(b.max); return this; }
  clone() { return new Box3(this.min.clone(), this.max.clone()); }
  expandByPoint(p) { this.min.min(p); this.max.max(p); return this; }
  expandByXYZ(x, y, z) { if (x < this.min.x) this.min.x = x; if (y < this.min.y) this.min.y = y; if (z < this.min.z) this.min.z = z; if (x > this.max.x) this.max.x = x; if (y > this.max.y) this.max.y = y; if (z > this.max.z) this.max.z = z; return this; }
  union(b) { this.min.min(b.min); this.max.max(b.max); return this; }
  getCenter(out) { return (out || new Vec3()).addVectors(this.min, this.max).scale(0.5); }
  getSize(out) { return (out || new Vec3()).subVectors(this.max, this.min); }
  containsPoint(p) { return p.x >= this.min.x && p.x <= this.max.x && p.y >= this.min.y && p.y <= this.max.y && p.z >= this.min.z && p.z <= this.max.z; }
  intersectsBox(b) { return !(b.max.x < this.min.x || b.min.x > this.max.x || b.max.y < this.min.y || b.min.y > this.max.y || b.max.z < this.min.z || b.min.z > this.max.z); }
  /** Caja envolvente tras aplicar una matriz (8 esquinas) */
  applyMat4(m) {
    if (this.isEmpty) return this;
    var mn = this.min, mx = this.max, xs = [mn.x, mx.x], ys = [mn.y, mx.y], zs = [mn.z, mx.z], p = _v3a;
    this.makeEmpty();
    for (var i = 0; i < 8; i++) { p.set(xs[i & 1], ys[(i >> 1) & 1], zs[(i >> 2) & 1]).applyMat4(m); this.expandByPoint(p); }
    return this;
  }
  distanceToPoint(p) { var dx = Math.max(this.min.x - p.x, 0, p.x - this.max.x), dy = Math.max(this.min.y - p.y, 0, p.y - this.max.y), dz = Math.max(this.min.z - p.z, 0, p.z - this.max.z); return Math.sqrt(dx * dx + dy * dy + dz * dz); }
}

class Sphere {
  constructor(center, radius) { this.center = center || new Vec3(); this.radius = radius === undefined ? -1 : radius; }
  copy(s) { this.center.copy(s.center); this.radius = s.radius; return this; }
  clone() { return new Sphere(this.center.clone(), this.radius); }
  get isEmpty() { return this.radius < 0; }
  setFromBox(b) { b.getCenter(this.center); this.radius = b.isEmpty ? -1 : this.center.distanceTo(b.max); return this; }
  applyMat4(m) { this.center.applyMat4(m); this.radius *= m.getMaxScale(); return this; }
  containsPoint(p) { return p.distanceToSq(this.center) <= this.radius * this.radius; }
  intersectsSphere(s) { var r = this.radius + s.radius; return this.center.distanceToSq(s.center) <= r * r; }
}

class Plane {
  constructor(normal, constant) { this.normal = normal || new Vec3(0, 1, 0); this.constant = constant || 0; }
  set(nx, ny, nz, c) { this.normal.set(nx, ny, nz); this.constant = c; return this; }
  normalize() { var l = this.normal.length() || 1; this.normal.scale(1 / l); this.constant /= l; return this; }
  distanceToPoint(p) { return this.normal.dot(p) + this.constant; }
  setFromNormalAndPoint(n, p) { this.normal.copy(n); this.constant = -p.dot(n); return this; }
}

class Frustum {
  constructor() { this.planes = [new Plane(), new Plane(), new Plane(), new Plane(), new Plane(), new Plane()]; }
  /** A partir de proyección * vista (planos normalizados apuntando hacia dentro) */
  setFromMatrix(m) {
    var e = m.e, p = this.planes;
    var m0 = e[0], m1 = e[1], m2 = e[2], m3 = e[3], m4 = e[4], m5 = e[5], m6 = e[6], m7 = e[7], m8 = e[8], m9 = e[9], m10 = e[10], m11 = e[11], m12 = e[12], m13 = e[13], m14 = e[14], m15 = e[15];
    p[0].set(m3 - m0, m7 - m4, m11 - m8, m15 - m12).normalize();
    p[1].set(m3 + m0, m7 + m4, m11 + m8, m15 + m12).normalize();
    p[2].set(m3 + m1, m7 + m5, m11 + m9, m15 + m13).normalize();
    p[3].set(m3 - m1, m7 - m5, m11 - m9, m15 - m13).normalize();
    p[4].set(m3 - m2, m7 - m6, m11 - m10, m15 - m14).normalize();
    p[5].set(m3 + m2, m7 + m6, m11 + m10, m15 + m14).normalize();
    return this;
  }
  intersectsSphere(s) { var p = this.planes; for (var i = 0; i < 6; i++) if (p[i].distanceToPoint(s.center) < -s.radius) return false; return true; }
  intersectsSphereXYZ(x, y, z, r) { var p = this.planes; for (var i = 0; i < 6; i++) { var n = p[i].normal; if (n.x * x + n.y * y + n.z * z + p[i].constant < -r) return false; } return true; }
  intersectsBox(b) {
    var p = this.planes;
    for (var i = 0; i < 6; i++) { var n = p[i].normal; var x = n.x > 0 ? b.max.x : b.min.x, y = n.y > 0 ? b.max.y : b.min.y, z = n.z > 0 ? b.max.z : b.min.z; if (n.x * x + n.y * y + n.z * z + p[i].constant < 0) return false; }
    return true;
  }
  containsPoint(v) { var p = this.planes; for (var i = 0; i < 6; i++) if (p[i].distanceToPoint(v) < 0) return false; return true; }
}

class Ray {
  constructor(origin, direction) { this.origin = origin || new Vec3(); this.direction = direction || new Vec3(0, 0, -1); }
  set(o, d) { this.origin.copy(o); this.direction.copy(d).normalize(); return this; }
  copy(r) { this.origin.copy(r.origin); this.direction.copy(r.direction); return this; }
  at(t, out) { return (out || new Vec3()).copy(this.direction).scale(t).add(this.origin); }
  applyMat4(m) { var end = _v3b.copy(this.origin).add(this.direction).applyMat4(m); this.origin.applyMat4(m); this.direction.subVectors(end, this.origin).normalize(); return this; }
  /** Distancia al punto de entrada en la caja o null */
  intersectBox(b) {
    var o = this.origin, d = this.direction, tmin = -Infinity, tmax = Infinity, axes = ['x', 'y', 'z'];
    for (var i = 0; i < 3; i++) {
      var a = axes[i], inv = 1 / d[a], t1 = (b.min[a] - o[a]) * inv, t2 = (b.max[a] - o[a]) * inv;
      if (inv < 0) { var t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
      if (tmax < tmin) return null;
    }
    if (tmax < 0) return null;
    return tmin >= 0 ? tmin : tmax;
  }
  intersectSphere(s) {
    var ox = this.origin.x - s.center.x, oy = this.origin.y - s.center.y, oz = this.origin.z - s.center.z, d = this.direction;
    var b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - s.radius * s.radius, disc = b * b - c;
    if (disc < 0) return null;
    var sq = Math.sqrt(disc), t0 = -b - sq, t1 = -b + sq;
    if (t1 < 0) return null;
    return t0 >= 0 ? t0 : t1;
  }
  intersectPlane(p) { var den = p.normal.dot(this.direction); if (Math.abs(den) < 1e-12) return p.distanceToPoint(this.origin) === 0 ? 0 : null; var t = -(this.origin.dot(p.normal) + p.constant) / den; return t >= 0 ? t : null; }
  /** Möller–Trumbore. Devuelve t o null (backface true = también caras traseras) */
  intersectTriangle(ax, ay, az, bx, by, bz, cx, cy, cz, backface) {
    var d = this.direction, o = this.origin;
    var e1x = bx - ax, e1y = by - ay, e1z = bz - az, e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    var px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x, det = e1x * px + e1y * py + e1z * pz;
    if (backface !== false ? Math.abs(det) < 1e-12 : det < 1e-12) return null;
    var inv = 1 / det, tx = o.x - ax, ty = o.y - ay, tz = o.z - az, u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return null;
    var qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (d.x * qx + d.y * qy + d.z * qz) * inv;
    if (v < 0 || u + v > 1) return null;
    var t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return t >= 0 ? t : null;
  }
}
var _v3a = new Vec3(), _v3b = new Vec3();

UG.Vec3 = Vec3; UG.Vec4 = Vec4; UG.Quat = Quat; UG.Euler = Euler; UG.Mat4 = Mat4;
UG.Box3 = Box3; UG.Sphere = Sphere; UG.Plane = Plane; UG.Frustum = Frustum; UG.Ray = Ray;
