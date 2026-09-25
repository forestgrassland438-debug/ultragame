/* UltraGame - matemáticas: Vec2, Matrix, geometría, intersecciones, RNG determinista, easing. */

/* ------------------------------------------------------------------ Vec2 */
class Vec2 {
  constructor(x, y) { this.x = x || 0; this.y = (y === undefined) ? this.x : (y || 0); }
  set(x, y) { this.x = x; this.y = y === undefined ? x : y; return this; }
  copy(v) { this.x = v.x; this.y = v.y; return this; }
  clone() { return new Vec2(this.x, this.y); }
  add(v) { this.x += v.x; this.y += v.y; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; return this; }
  scale(s, sy) { this.x *= s; this.y *= (sy === undefined ? s : sy); return this; }
  multiply(v) { this.x *= v.x; this.y *= v.y; return this; }
  dot(v) { return this.x * v.x + this.y * v.y; }
  cross(v) { return this.x * v.y - this.y * v.x; }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y); }
  lengthSq() { return this.x * this.x + this.y * this.y; }
  setLength(l) { return this.normalize().scale(l); }
  normalize() { var l = this.length(); if (l > 0) { this.x /= l; this.y /= l; } return this; }
  negate() { this.x = -this.x; this.y = -this.y; return this; }
  perp() { var t = this.x; this.x = -this.y; this.y = t; return this; }
  angle() { return Math.atan2(this.y, this.x); }
  setToPolar(angle, len) { len = len === undefined ? 1 : len; this.x = Math.cos(angle) * len; this.y = Math.sin(angle) * len; return this; }
  rotate(a) { var c = Math.cos(a), s = Math.sin(a), x = this.x; this.x = x * c - this.y * s; this.y = x * s + this.y * c; return this; }
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; return this; }
  distance(v) { var dx = v.x - this.x, dy = v.y - this.y; return Math.sqrt(dx * dx + dy * dy); }
  distanceSq(v) { var dx = v.x - this.x, dy = v.y - this.y; return dx * dx + dy * dy; }
  equals(v, eps) { eps = eps || 0; return Math.abs(this.x - v.x) <= eps && Math.abs(this.y - v.y) <= eps; }
  limit(max) { var l = this.length(); if (l > max) this.scale(max / l); return this; }
  toString() { return 'Vec2(' + this.x + ', ' + this.y + ')'; }
}

/** Punto observable (p.ej. sprite.scale.set(2)) que escribe en propiedades del objeto dueño. */
class PointProxy {
  constructor(owner, kx, ky) { this._o = owner; this._kx = kx; this._ky = ky; }
  get x() { return this._o[this._kx]; }
  set x(v) { this._o[this._kx] = v; }
  get y() { return this._o[this._ky]; }
  set y(v) { this._o[this._ky] = v; }
  set(x, y) { this._o[this._kx] = x; this._o[this._ky] = (y === undefined ? x : y); return this._o; }
  copyFrom(p) { this._o[this._kx] = p.x; this._o[this._ky] = p.y; return this._o; }
}

/* ---------------------------------------------------------------- Matrix
 * | a c tx |
 * | b d ty |
 * | 0 0 1  |                                                            */
class Matrix {
  constructor(a, b, c, d, tx, ty) {
    this.a = a === undefined ? 1 : a; this.b = b || 0; this.c = c || 0;
    this.d = d === undefined ? 1 : d; this.tx = tx || 0; this.ty = ty || 0;
  }
  set(a, b, c, d, tx, ty) { this.a = a; this.b = b; this.c = c; this.d = d; this.tx = tx; this.ty = ty; return this; }
  identity() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.tx = 0; this.ty = 0; return this; }
  copyFrom(m) { this.a = m.a; this.b = m.b; this.c = m.c; this.d = m.d; this.tx = m.tx; this.ty = m.ty; return this; }
  clone() { return new Matrix(this.a, this.b, this.c, this.d, this.tx, this.ty); }
  apply(x, y, out) { out = out || new Vec2(); var nx = this.a * x + this.c * y + this.tx; out.y = this.b * x + this.d * y + this.ty; out.x = nx; return out; }
  applyInverse(x, y, out) {
    out = out || new Vec2();
    var det = this.a * this.d - this.b * this.c;
    if (det === 0) { out.x = 0; out.y = 0; return out; }
    var id = 1 / det, px = x - this.tx, py = y - this.ty;
    out.x = (this.d * px - this.c * py) * id;
    out.y = (this.a * py - this.b * px) * id;
    return out;
  }
  translate(x, y) { this.tx += x; this.ty += y; return this; }
  scale(x, y) { this.a *= x; this.d *= y; this.c *= x; this.b *= y; this.tx *= x; this.ty *= y; return this; }
  rotate(angle) {
    var cos = Math.cos(angle), sin = Math.sin(angle), a1 = this.a, c1 = this.c, tx1 = this.tx;
    this.a = a1 * cos - this.b * sin; this.b = a1 * sin + this.b * cos;
    this.c = c1 * cos - this.d * sin; this.d = c1 * sin + this.d * cos;
    this.tx = tx1 * cos - this.ty * sin; this.ty = tx1 * sin + this.ty * cos;
    return this;
  }
  /** this = this * m  (m se aplica primero, en espacio local) */
  append(m) {
    var a1 = this.a, b1 = this.b, c1 = this.c, d1 = this.d;
    this.a = m.a * a1 + m.b * c1; this.b = m.a * b1 + m.b * d1;
    this.c = m.c * a1 + m.d * c1; this.d = m.c * b1 + m.d * d1;
    this.tx = m.tx * a1 + m.ty * c1 + this.tx; this.ty = m.tx * b1 + m.ty * d1 + this.ty;
    return this;
  }
  /** this = m * this */
  prepend(m) {
    var tx1 = this.tx, a1 = this.a, c1 = this.c;
    this.a = a1 * m.a + this.b * m.c; this.b = a1 * m.b + this.b * m.d;
    this.c = c1 * m.a + this.d * m.c; this.d = c1 * m.b + this.d * m.d;
    this.tx = tx1 * m.a + this.ty * m.c + m.tx; this.ty = tx1 * m.b + this.ty * m.d + m.ty;
    return this;
  }
  invert() {
    var a1 = this.a, b1 = this.b, c1 = this.c, d1 = this.d, tx1 = this.tx, n = a1 * d1 - b1 * c1;
    if (n === 0) return this.identity();
    this.a = d1 / n; this.b = -b1 / n; this.c = -c1 / n; this.d = a1 / n;
    this.tx = (c1 * this.ty - d1 * tx1) / n; this.ty = -(a1 * this.ty - b1 * tx1) / n;
    return this;
  }
  setTransform(x, y, pivotX, pivotY, scaleX, scaleY, rotation, skewX, skewY) {
    this.a = Math.cos(rotation + skewY) * scaleX; this.b = Math.sin(rotation + skewY) * scaleX;
    this.c = -Math.sin(rotation - skewX) * scaleY; this.d = Math.cos(rotation - skewX) * scaleY;
    this.tx = x - (pivotX * this.a + pivotY * this.c); this.ty = y - (pivotX * this.b + pivotY * this.d);
    return this;
  }
  decompose() {
    var a = this.a, b = this.b, c = this.c, d = this.d;
    var skewX = -Math.atan2(-c, d), skewY = Math.atan2(b, a), delta = Math.abs(skewX + skewY);
    var out = { x: this.tx, y: this.ty, scaleX: Math.sqrt(a * a + b * b), scaleY: Math.sqrt(c * c + d * d), rotation: 0, skewX: 0, skewY: 0 };
    if (delta < 0.00001 || Math.abs(PI2 - delta) < 0.00001) { out.rotation = skewY; }
    else { out.skewX = skewX; out.skewY = skewY; }
    return out;
  }
  equals(m) { return this.a === m.a && this.b === m.b && this.c === m.c && this.d === m.d && this.tx === m.tx && this.ty === m.ty; }
  toArray(out) { out = out || new Float32Array(9); out[0] = this.a; out[1] = this.b; out[2] = 0; out[3] = this.c; out[4] = this.d; out[5] = 0; out[6] = this.tx; out[7] = this.ty; out[8] = 1; return out; }
}
Matrix.IDENTITY = Object.freeze(new Matrix());

/* ------------------------------------------------------------- Geometría */
class Rectangle {
  constructor(x, y, width, height) { this.x = x || 0; this.y = y || 0; this.width = width || 0; this.height = height || 0; }
  get left() { return this.x; }
  get right() { return this.x + this.width; }
  get top() { return this.y; }
  get bottom() { return this.y + this.height; }
  get centerX() { return this.x + this.width / 2; }
  get centerY() { return this.y + this.height / 2; }
  set(x, y, w, h) { this.x = x; this.y = y; this.width = w; this.height = h; return this; }
  setTo(x, y, w, h) { return this.set(x, y, w, h); }
  copyFrom(r) { this.x = r.x; this.y = r.y; this.width = r.width; this.height = r.height; return this; }
  clone() { return new Rectangle(this.x, this.y, this.width, this.height); }
  contains(x, y) { return this.width > 0 && this.height > 0 && x >= this.x && x < this.x + this.width && y >= this.y && y < this.y + this.height; }
  containsRect(r) { return r.x >= this.x && r.y >= this.y && r.right <= this.right && r.bottom <= this.bottom; }
  intersects(r) { return !(r.x >= this.x + this.width || r.x + r.width <= this.x || r.y >= this.y + this.height || r.y + r.height <= this.y); }
  intersection(r, out) {
    out = out || new Rectangle();
    var x0 = Math.max(this.x, r.x), y0 = Math.max(this.y, r.y), x1 = Math.min(this.right, r.right), y1 = Math.min(this.bottom, r.bottom);
    if (x1 <= x0 || y1 <= y0) return out.set(0, 0, 0, 0);
    return out.set(x0, y0, x1 - x0, y1 - y0);
  }
  union(r, out) {
    out = out || new Rectangle();
    var x0 = Math.min(this.x, r.x), y0 = Math.min(this.y, r.y), x1 = Math.max(this.right, r.right), y1 = Math.max(this.bottom, r.bottom);
    return out.set(x0, y0, x1 - x0, y1 - y0);
  }
  pad(px, py) { py = py === undefined ? px : py; this.x -= px; this.y -= py; this.width += px * 2; this.height += py * 2; return this; }
  isEmpty() { return this.width <= 0 || this.height <= 0; }
  equals(r) { return this.x === r.x && this.y === r.y && this.width === r.width && this.height === r.height; }
  getRandomPoint(rng, out) { rng = rng || UG.rng; out = out || new Vec2(); out.x = this.x + rng.float() * this.width; out.y = this.y + rng.float() * this.height; return out; }
  getPerimeterPoint(t, out) {
    out = out || new Vec2(); var w = this.width, h = this.height, p = 2 * (w + h), d = ((t % 1) + 1) % 1 * p;
    if (d < w) return out.set(this.x + d, this.y); d -= w;
    if (d < h) return out.set(this.x + w, this.y + d); d -= h;
    if (d < w) return out.set(this.x + w - d, this.y + h); d -= w;
    return out.set(this.x, this.y + h - d);
  }
  getBounds(out) { return (out || new Rectangle()).copyFrom(this); }
}
Rectangle.EMPTY = Object.freeze(new Rectangle(0, 0, 0, 0));

class Circle {
  constructor(x, y, radius) { this.x = x || 0; this.y = y || 0; this.radius = radius || 0; }
  contains(x, y) { var dx = x - this.x, dy = y - this.y; return this.radius > 0 && dx * dx + dy * dy <= this.radius * this.radius; }
  clone() { return new Circle(this.x, this.y, this.radius); }
  getBounds(out) { return (out || new Rectangle()).set(this.x - this.radius, this.y - this.radius, this.radius * 2, this.radius * 2); }
  getRandomPoint(rng, out) { rng = rng || UG.rng; out = out || new Vec2(); var a = rng.float() * PI2, r = Math.sqrt(rng.float()) * this.radius; out.x = this.x + Math.cos(a) * r; out.y = this.y + Math.sin(a) * r; return out; }
  getPerimeterPoint(t, out) { out = out || new Vec2(); var a = t * PI2; out.x = this.x + Math.cos(a) * this.radius; out.y = this.y + Math.sin(a) * this.radius; return out; }
}

class Ellipse {
  constructor(x, y, width, height) { this.x = x || 0; this.y = y || 0; this.width = width || 0; this.height = height || 0; }
  contains(x, y) {
    if (this.width <= 0 || this.height <= 0) return false;
    var nx = (x - this.x) / (this.width / 2), ny = (y - this.y) / (this.height / 2);
    return nx * nx + ny * ny <= 1;
  }
  clone() { return new Ellipse(this.x, this.y, this.width, this.height); }
  getBounds(out) { return (out || new Rectangle()).set(this.x - this.width / 2, this.y - this.height / 2, this.width, this.height); }
  getRandomPoint(rng, out) { rng = rng || UG.rng; out = out || new Vec2(); var a = rng.float() * PI2, r = Math.sqrt(rng.float()); out.x = this.x + Math.cos(a) * r * this.width / 2; out.y = this.y + Math.sin(a) * r * this.height / 2; return out; }
  getPerimeterPoint(t, out) { out = out || new Vec2(); var a = t * PI2; out.x = this.x + Math.cos(a) * this.width / 2; out.y = this.y + Math.sin(a) * this.height / 2; return out; }
}

class Polygon {
  /** points: [x0,y0,x1,y1...] o [{x,y}...] */
  constructor(points) { this.points = []; this.closed = true; if (points) this.setTo(points); }
  setTo(points) {
    var p = this.points; p.length = 0;
    if (points.length && typeof points[0] === 'object') { for (var i = 0; i < points.length; i++) p.push(points[i].x, points[i].y); }
    else for (var j = 0; j < points.length; j++) p.push(+points[j]);
    return this;
  }
  contains(x, y) {
    var p = this.points, n = p.length / 2, inside = false;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xi = p[i * 2], yi = p[i * 2 + 1], xj = p[j * 2], yj = p[j * 2 + 1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  clone() { var c = new Polygon(this.points); c.closed = this.closed; return c; }
  getBounds(out) {
    out = out || new Rectangle(); var p = this.points; if (!p.length) return out.set(0, 0, 0, 0);
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < p.length; i += 2) { if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i]; if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1]; }
    return out.set(x0, y0, x1 - x0, y1 - y0);
  }
  get area() {
    var p = this.points, n = p.length / 2, s = 0;
    for (var i = 0, j = n - 1; i < n; j = i++) s += (p[j * 2] + p[i * 2]) * (p[j * 2 + 1] - p[i * 2 + 1]);
    return Math.abs(s / 2);
  }
  getRandomPoint(rng, out) {
    rng = rng || UG.rng; out = out || new Vec2(); var b = this.getBounds();
    for (var k = 0; k < 64; k++) { b.getRandomPoint(rng, out); if (this.contains(out.x, out.y)) return out; }
    return out.set(this.points[0] || 0, this.points[1] || 0);
  }
}

class Line {
  constructor(x1, y1, x2, y2) { this.x1 = x1 || 0; this.y1 = y1 || 0; this.x2 = x2 || 0; this.y2 = y2 || 0; }
  get length() { var dx = this.x2 - this.x1, dy = this.y2 - this.y1; return Math.sqrt(dx * dx + dy * dy); }
  get angle() { return Math.atan2(this.y2 - this.y1, this.x2 - this.x1); }
  getPoint(t, out) { out = out || new Vec2(); out.x = this.x1 + (this.x2 - this.x1) * t; out.y = this.y1 + (this.y2 - this.y1) * t; return out; }
  getRandomPoint(rng, out) { return this.getPoint((rng || UG.rng).float(), out); }
  getPerimeterPoint(t, out) { return this.getPoint(t, out); }
  getBounds(out) { return (out || new Rectangle()).set(Math.min(this.x1, this.x2), Math.min(this.y1, this.y2), Math.abs(this.x2 - this.x1), Math.abs(this.y2 - this.y1)); }
  clone() { return new Line(this.x1, this.y1, this.x2, this.y2); }
  contains() { return false; }
}

/* ------------------------------------------------------- Intersecciones */
var Intersect = {
  rectRect: function (a, b) { return a.intersects(b); },
  circleCircle: function (a, b) { var dx = a.x - b.x, dy = a.y - b.y, r = a.radius + b.radius; return dx * dx + dy * dy <= r * r; },
  circleRect: function (c, r) {
    var cx = clamp(c.x, r.x, r.x + r.width), cy = clamp(c.y, r.y, r.y + r.height), dx = c.x - cx, dy = c.y - cy;
    return dx * dx + dy * dy <= c.radius * c.radius;
  },
  /** Intersección de segmentos; devuelve Vec2 o null */
  lineLine: function (l1, l2, out) {
    var x1 = l1.x1, y1 = l1.y1, x2 = l1.x2, y2 = l1.y2, x3 = l2.x1, y3 = l2.y1, x4 = l2.x2, y4 = l2.y2;
    var den = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    if (den === 0) return null;
    var ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / den, ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / den;
    if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;
    out = out || new Vec2(); out.x = x1 + ua * (x2 - x1); out.y = y1 + ua * (y2 - y1); return out;
  },
  lineRect: function (l, r) {
    if (r.contains(l.x1, l.y1) || r.contains(l.x2, l.y2)) return true;
    var e = [new Line(r.x, r.y, r.right, r.y), new Line(r.right, r.y, r.right, r.bottom), new Line(r.right, r.bottom, r.x, r.bottom), new Line(r.x, r.bottom, r.x, r.y)];
    for (var i = 0; i < 4; i++) if (Intersect.lineLine(l, e[i])) return true;
    return false;
  },
  lineCircle: function (l, c) {
    var dx = l.x2 - l.x1, dy = l.y2 - l.y1, len2 = dx * dx + dy * dy;
    var t = len2 > 0 ? clamp(((c.x - l.x1) * dx + (c.y - l.y1) * dy) / len2, 0, 1) : 0;
    var px = l.x1 + dx * t - c.x, py = l.y1 + dy * t - c.y;
    return px * px + py * py <= c.radius * c.radius;
  },
  pointToSegmentDistance: function (px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    var t = len2 > 0 ? clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1) : 0;
    var ex = x1 + dx * t - px, ey = y1 + dy * t - py;
    return Math.sqrt(ex * ex + ey * ey);
  }
};

/* ----------------------------------------------------------- MathUtils */
var MathUtils = {
  PI2: PI2, DEG_TO_RAD: DEG_TO_RAD, RAD_TO_DEG: RAD_TO_DEG,
  clamp: clamp,
  lerp: function (a, b, t) { return a + (b - a) * t; },
  inverseLerp: function (a, b, v) { return a === b ? 0 : (v - a) / (b - a); },
  remap: function (v, a1, b1, a2, b2) { return a2 + (b2 - a2) * ((v - a1) / (b1 - a1)); },
  wrap: function (v, min, max) { var r = max - min; if (r <= 0) return min; return min + ((((v - min) % r) + r) % r); },
  wrapAngle: function (a) { return MathUtils.wrap(a, -Math.PI, Math.PI); },
  degToRad: function (d) { return d * DEG_TO_RAD; },
  radToDeg: function (r) { return r * RAD_TO_DEG; },
  distance: function (x1, y1, x2, y2) { var dx = x2 - x1, dy = y2 - y1; return Math.sqrt(dx * dx + dy * dy); },
  distanceSq: function (x1, y1, x2, y2) { var dx = x2 - x1, dy = y2 - y1; return dx * dx + dy * dy; },
  angleBetween: function (x1, y1, x2, y2) { return Math.atan2(y2 - y1, x2 - x1); },
  shortestAngle: function (from, to) { return MathUtils.wrapAngle(to - from); },
  rotateTo: function (current, target, step) { var d = MathUtils.shortestAngle(current, target); if (Math.abs(d) <= step) return target; return current + Math.sign(d) * step; },
  approach: function (current, target, step) { return current < target ? Math.min(current + step, target) : Math.max(current - step, target); },
  damp: function (current, target, lambda, dt) { return current + (target - current) * (1 - Math.exp(-lambda * dt)); },
  snapTo: function (v, gap, start) { if (!gap) return v; start = start || 0; return start + Math.round((v - start) / gap) * gap; },
  snapFloor: function (v, gap) { return gap ? Math.floor(v / gap) * gap : v; },
  smoothstep: function (e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); },
  smootherstep: function (e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); },
  fract: function (v) { return v - Math.floor(v); },
  pingPong: function (t, len) { var l2 = len * 2, m = ((t % l2) + l2) % l2; return m <= len ? m : l2 - m; },
  fuzzyEqual: function (a, b, eps) { return Math.abs(a - b) < (eps || 0.0001); },
  isPowerOfTwo: function (v) { return v > 0 && (v & (v - 1)) === 0; },
  nextPowerOfTwo: function (v) { v = Math.max(1, Math.ceil(v)) - 1; v |= v >> 1; v |= v >> 2; v |= v >> 4; v |= v >> 8; v |= v >> 16; return v + 1; },
  sign: function (v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); },
  average: function (arr) { if (!arr.length) return 0; var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i]; return s / arr.length; }
};

/* ------------------------------------------------------------------ RNG
 * xoshiro128** determinista con semilla numérica o de texto.
 * Imprescindible en juegos web3 para replays verificables: misma semilla + mismas entradas = mismo resultado. */
function cyrb128(str) {
  var h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (var i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067); h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213); h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067); h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213); h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}
function splitmix32(a) {
  return function () { a |= 0; a = a + 0x9e3779b9 | 0; var t = a ^ a >>> 16; t = Math.imul(t, 0x21f0aaad); t = t ^ t >>> 15; t = Math.imul(t, 0x735a2d97); return ((t = t ^ t >>> 15) >>> 0); };
}
class RNG {
  constructor(seed) { this.s = new Uint32Array(4); this._gauss = null; this.setSeed(seed === undefined ? Math.floor(Security.secureRandom() * 4294967296) : seed); }
  setSeed(seed) {
    var st;
    if (typeof seed === 'string') st = cyrb128(seed);
    else { var sm = splitmix32(Math.floor(+seed || 0)); st = [sm(), sm(), sm(), sm()]; }
    if ((st[0] | st[1] | st[2] | st[3]) === 0) st[0] = 1;
    this.s[0] = st[0]; this.s[1] = st[1]; this.s[2] = st[2]; this.s[3] = st[3];
    this.seed = seed; this._gauss = null;
    return this;
  }
  /** uint32 */
  next() {
    var s = this.s;
    var result = Math.imul(rotl32(Math.imul(s[1], 5), 7), 9) >>> 0;
    var t = s[1] << 9;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t; s[3] = rotl32(s[3], 11);
    return result;
  }
  /** float() -> [0, 1) con 32 bits · float(max) -> [0, max) · float(min, max) -> [min, max) */
  float(min, max) {
    var f = this.next() / 4294967296;
    if (min === undefined) return f;
    return max === undefined ? f * min : min + (max - min) * f;
  }
  frac() { return this.next() / 4294967296; }
  /** [min, max) */
  between(min, max) { return min + (max - min) * (this.next() / 4294967296); }
  realInRange(min, max) { return this.between(min, max); }
  /** entero [min, max] sin sesgo */
  int(min, max) {
    if (max === undefined) { max = min; min = 0; }
    min = Math.ceil(min); max = Math.floor(max);
    var range = max - min + 1; if (range <= 1) return min;
    var lim = Math.floor(4294967296 / range) * range, v;
    do { v = this.next(); } while (v >= lim);
    return min + (v % range);
  }
  integerInRange(min, max) { return this.int(min, max); }
  chance(p) { return this.float() < p; }
  bool() { return (this.next() & 1) === 1; }
  sign() { return (this.next() & 1) ? 1 : -1; }
  pick(arr) { return arr.length ? arr[this.int(0, arr.length - 1)] : undefined; }
  weightedPick(arr, weights) {
    var total = 0, i; for (i = 0; i < weights.length; i++) total += weights[i];
    var r = this.float() * total;
    for (i = 0; i < arr.length; i++) { r -= weights[i]; if (r < 0) return arr[i]; }
    return arr[arr.length - 1];
  }
  shuffle(arr) { for (var i = arr.length - 1; i > 0; i--) { var j = this.int(0, i), t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
  angle() { return this.float() * PI2 - Math.PI; }
  rotation() { return this.angle(); }
  /** Normal (Box-Muller) */
  gaussian(mean, std) {
    mean = mean || 0; std = std === undefined ? 1 : std;
    if (this._gauss !== null) { var g = this._gauss; this._gauss = null; return mean + g * std; }
    var u, v, s;
    do { u = this.float() * 2 - 1; v = this.float() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    var m = Math.sqrt(-2 * Math.log(s) / s);
    this._gauss = v * m;
    return mean + u * m * std;
  }
  uuid() {
    var h = ''; for (var i = 0; i < 4; i++) h += ('00000000' + this.next().toString(16)).slice(-8);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-' + ((parseInt(h[16], 16) & 3) | 8).toString(16) + h.slice(17, 20) + '-' + h.slice(20, 32);
  }
  getState() { return [this.s[0], this.s[1], this.s[2], this.s[3]]; }
  setState(st) { this.s[0] = st[0] >>> 0; this.s[1] = st[1] >>> 0; this.s[2] = st[2] >>> 0; this.s[3] = st[3] >>> 0; this._gauss = null; return this; }
  clone() { var r = new RNG(0); r.setState(this.getState()); return r; }
}
function rotl32(x, k) { return ((x << k) | (x >>> (32 - k))) >>> 0; }

/* ---------------------------------------------------------------- Easing */
var EC1 = 1.70158, EC2 = EC1 * 1.525, EC3 = EC1 + 1, EC4 = PI2 / 3, EC5 = PI2 / 4.5;
function bounceOut(t) {
  var n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75; }
  if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }
  t -= 2.625 / d1; return n1 * t * t + 0.984375;
}
var Easing = {
  linear: function (t) { return t; },
  quadin: function (t) { return t * t; },
  quadout: function (t) { return t * (2 - t); },
  quadinout: function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; },
  cubicin: function (t) { return t * t * t; },
  cubicout: function (t) { return 1 - Math.pow(1 - t, 3); },
  cubicinout: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
  quartin: function (t) { return t * t * t * t; },
  quartout: function (t) { return 1 - Math.pow(1 - t, 4); },
  quartinout: function (t) { return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2; },
  quintin: function (t) { return t * t * t * t * t; },
  quintout: function (t) { return 1 - Math.pow(1 - t, 5); },
  quintinout: function (t) { return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2; },
  sinein: function (t) { return 1 - Math.cos(t * Math.PI / 2); },
  sineout: function (t) { return Math.sin(t * Math.PI / 2); },
  sineinout: function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; },
  expoin: function (t) { return t === 0 ? 0 : Math.pow(2, 10 * t - 10); },
  expoout: function (t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); },
  expoinout: function (t) { return t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2; },
  circin: function (t) { return 1 - Math.sqrt(1 - t * t); },
  circout: function (t) { return Math.sqrt(1 - (t - 1) * (t - 1)); },
  circinout: function (t) { return t < 0.5 ? (1 - Math.sqrt(1 - 4 * t * t)) / 2 : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2; },
  backin: function (t) { return EC3 * t * t * t - EC1 * t * t; },
  backout: function (t) { return 1 + EC3 * Math.pow(t - 1, 3) + EC1 * Math.pow(t - 1, 2); },
  backinout: function (t) { return t < 0.5 ? (Math.pow(2 * t, 2) * ((EC2 + 1) * 2 * t - EC2)) / 2 : (Math.pow(2 * t - 2, 2) * ((EC2 + 1) * (t * 2 - 2) + EC2) + 2) / 2; },
  elasticin: function (t) { return t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * EC4); },
  elasticout: function (t) { return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * EC4) + 1; },
  elasticinout: function (t) { return t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * EC5)) / 2 : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * EC5)) / 2 + 1; },
  bouncein: function (t) { return 1 - bounceOut(1 - t); },
  bounceout: bounceOut,
  bounceinout: function (t) { return t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2; },
  steps: function (n) { n = Math.max(1, n | 0); return function (t) { return t >= 1 ? 1 : Math.floor(t * n) / n; }; },
  /** Curva bézier cúbica estilo CSS */
  cubicBezier: function (x1, y1, x2, y2) {
    var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    function sx(t) { return ((ax * t + bx) * t + cx) * t; }
    function sy(t) { return ((ay * t + by) * t + cy) * t; }
    function dx(t) { return (3 * ax * t + 2 * bx) * t + cx; }
    return function (x) {
      if (x <= 0) return 0; if (x >= 1) return 1;
      var t = x;
      for (var i = 0; i < 8; i++) { var e = sx(t) - x; if (Math.abs(e) < 1e-6) return sy(t); var d = dx(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
      var lo = 0, hi = 1; t = x;
      for (var j = 0; j < 30; j++) { var v = sx(t); if (Math.abs(v - x) < 1e-6) break; if (x > v) lo = t; else hi = t; t = (lo + hi) / 2; }
      return sy(t);
    };
  },
  /** Obtiene una función de easing tolerando muchos formatos de nombre:
   *  'quadOut', 'Quad.easeOut', 'easeOutQuad', 'Cubic.InOut', 'Power2', 'Sine', 'linear'... */
  get: function (name) {
    if (typeof name === 'function') return name;
    if (!name) return Easing.linear;
    var key = String(name).toLowerCase().replace(/[^a-z0-9]/g, '').replace(/ease/g, '');
    if (Easing._cache[key]) return Easing._cache[key];
    var fn = null;
    var power = /^power([0-4])(in|out|inout)?$/.exec(key);
    if (power) {
      var fam = ['linear', 'quad', 'cubic', 'quart', 'quint'][+power[1]];
      key = fam === 'linear' ? 'linear' : fam + (power[2] || 'out');
    }
    if (EASING_FAMILIES.indexOf(key) >= 0) key = key + 'out';
    var m = /^(inout|in|out)([a-z]+)$/.exec(key);
    if (m && !Easing[key] && EASING_FAMILIES.indexOf(m[2]) >= 0) key = m[2] + m[1];
    if (key === 'linear' || key === 'none') fn = Easing.linear;
    else if (typeof Easing[key] === 'function' && key !== 'get' && key !== 'steps' && key !== 'cubicbezier') fn = Easing[key];
    if (!fn) { Log.warnOnce('ease:' + name, 'Easing desconocido "' + name + '", usando linear'); fn = Easing.linear; }
    Easing._cache[key] = fn;
    return fn;
  },
  _cache: Object.create(null)
};
var EASING_FAMILIES = ['quad', 'cubic', 'quart', 'quint', 'sine', 'expo', 'circ', 'back', 'elastic', 'bounce'];
Easing.names = ['linear'].concat([].concat.apply([], EASING_FAMILIES.map(function (f) { return [f + 'In', f + 'Out', f + 'InOut']; })));

UG.Vec2 = Vec2;
UG.Point = Vec2;
UG.PointProxy = PointProxy;
UG.Matrix = Matrix;
UG.Rectangle = Rectangle;
UG.Circle = Circle;
UG.Ellipse = Ellipse;
UG.Polygon = Polygon;
UG.Line = Line;
UG.Intersect = Intersect;
UG.Math = MathUtils; UG.MathUtils = MathUtils; // alias con el nombre interno
UG.RNG = RNG;
UG.Easing = Easing;
UG.rng = new RNG();
