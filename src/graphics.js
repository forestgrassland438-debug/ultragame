/* UltraGame - Graphics vectorial: API compatible con Phaser (fillRect...) y PixiJS v7/v8 (rect().fill()),
 * teselado de trazos con uniones miter/round/bevel SIN solapamiento de triángulos (no hay doble mezcla
 * con alfa), trazos cerrados perfectamente unidos, rellenos con agujeros (cut) y degradados. */

function circleSegments(r, quality) {
  return clamp(Math.ceil(Math.sqrt(Math.max(r, 0.5)) * 6 * (quality || 1)), 12, 512);
}
function arcSegments(r, angle, quality) {
  return Math.max(2, Math.ceil(Math.abs(angle) / PI2 * circleSegments(r, quality)));
}

function normFillStyle(a, b) {
  if (a === undefined || a === null) return { color: 0xffffff, alpha: 1, gradient: null };
  if (typeof a === 'object' && !Array.isArray(a)) {
    return {
      color: Color.toNumber(a.color !== undefined ? a.color : (a.fill !== undefined ? a.fill : 0xffffff)),
      alpha: a.alpha !== undefined ? +a.alpha : Color.alphaOf(a.color),
      gradient: a.gradient ? normGradient(a.gradient) : null
    };
  }
  return { color: Color.toNumber(a), alpha: b !== undefined ? +b : Color.alphaOf(a), gradient: null };
}
function normGradient(g) {
  var stops = (g.stops || g.colorStops || []).map(function (s) {
    if (Array.isArray(s)) return { offset: +s[0], color: Color.toNumber(s[1]), alpha: s[2] !== undefined ? +s[2] : 1 };
    return { offset: +s.offset, color: Color.toNumber(s.color), alpha: s.alpha !== undefined ? +s.alpha : 1 };
  }).sort(function (x, y) { return x.offset - y.offset; });
  if (!stops.length) stops = [{ offset: 0, color: 0xffffff, alpha: 1 }, { offset: 1, color: 0x000000, alpha: 1 }];
  return { type: g.type === 'radial' ? 'radial' : 'linear', x0: +g.x0 || 0, y0: +g.y0 || 0, x1: g.x1 !== undefined ? +g.x1 : 0, y1: g.y1 !== undefined ? +g.y1 : 100, x: +g.x || 0, y: +g.y || 0, r: +g.r || 50, stops: stops };
}
function sampleStops(stops, t, out) {
  if (t <= stops[0].offset) { out.c = stops[0].color; out.a = stops[0].alpha; return; }
  var last = stops[stops.length - 1];
  if (t >= last.offset) { out.c = last.color; out.a = last.alpha; return; }
  for (var i = 0; i < stops.length - 1; i++) {
    var s0 = stops[i], s1 = stops[i + 1];
    if (t >= s0.offset && t <= s1.offset) {
      var f = (t - s0.offset) / ((s1.offset - s0.offset) || 1);
      out.c = Color.lerp(s0.color, s1.color, f); out.a = s0.alpha + (s1.alpha - s0.alpha) * f; return;
    }
  }
}

/** Contornos (lista de {pts, closed, convex}) de una forma */
function shapeContours(s, q) {
  var pts, i, n, a;
  switch (s.type) {
    case 'rect':
      return [{ pts: [s.x, s.y, s.x + s.w, s.y, s.x + s.w, s.y + s.h, s.x, s.y + s.h], closed: true, convex: true }];
    case 'circle':
    case 'ellipse': {
      var rx = s.type === 'circle' ? s.r : s.rx, ry = s.type === 'circle' ? s.r : s.ry;
      n = circleSegments(Math.max(rx, ry), q); pts = new Array(n * 2);
      for (i = 0; i < n; i++) { a = i / n * PI2; pts[i * 2] = s.x + Math.cos(a) * rx; pts[i * 2 + 1] = s.y + Math.sin(a) * ry; }
      return [{ pts: pts, closed: true, convex: true, center: true, cx: s.x, cy: s.y }];
    }
    case 'roundRect': {
      var r = s.r, max = Math.min(s.w, s.h) / 2;
      var tl = Math.min(r.tl, max), tr = Math.min(r.tr, max), br = Math.min(r.br, max), bl = Math.min(r.bl, max);
      pts = [];
      var corner = function (cx, cy, rad, start) {
        if (rad <= 0) { pts.push(cx, cy); return; }
        var seg = arcSegments(rad, Math.PI / 2, q);
        for (var k = 0; k <= seg; k++) { var ang = start + (Math.PI / 2) * (k / seg); pts.push(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad); }
      };
      corner(s.x + tl, s.y + tl, tl, Math.PI);
      corner(s.x + s.w - tr, s.y + tr, tr, -Math.PI / 2);
      corner(s.x + s.w - br, s.y + s.h - br, br, 0);
      corner(s.x + bl, s.y + s.h - bl, bl, Math.PI / 2);
      return [{ pts: pts, closed: true, convex: true }];
    }
    case 'poly':
      return [{ pts: s.pts, closed: s.closed !== false, convex: false }];
    case 'path':
      return s.subpaths.filter(function (sp) { return sp.pts.length >= 4; }).map(function (sp) { return { pts: sp.pts, closed: sp.closed, convex: false }; });
  }
  return [];
}

function shapeContains(s, contours, x, y) {
  switch (s.type) {
    case 'rect': return x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
    case 'circle': { var dx = x - s.x, dy = y - s.y; return dx * dx + dy * dy <= s.r * s.r; }
    case 'ellipse': { var nx = (x - s.x) / s.rx, ny = (y - s.y) / s.ry; return nx * nx + ny * ny <= 1; }
  }
  for (var i = 0; i < contours.length; i++) if (pointInPoly(contours[i].pts, x, y)) return true;
  return false;
}
function pointInPoly(p, x, y) {
  var n = p.length >> 1, inside = false;
  for (var i = 0, j = n - 1; i < n; j = i++) {
    var xi = p[i * 2], yi = p[i * 2 + 1], xj = p[j * 2], yj = p[j * 2 + 1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/* ---------------------------------------------------------------- Trazos
 * Genera una tira de triángulos sin solapamiento. Para caminos cerrados, el último segmento
 * se une con la unión del primer punto (sin líneas abiertas). */
function buildStroke(src, closed, st, out, quality) {
  var P = [], i, n = src.length >> 1;
  for (i = 0; i < n; i++) {
    var x = src[i * 2], y = src[i * 2 + 1];
    if (P.length && Math.abs(x - P[P.length - 2]) < 1e-7 && Math.abs(y - P[P.length - 1]) < 1e-7) continue;
    P.push(x, y);
  }
  if (closed && P.length >= 4 && Math.abs(P[0] - P[P.length - 2]) < 1e-7 && Math.abs(P[1] - P[P.length - 1]) < 1e-7) P.length -= 2;
  n = P.length >> 1;
  var w = st.width;
  if (!(w > 0)) return;
  var verts = out.verts, idx = out.idx;
  function V(vx, vy) { verts.push(vx, vy); return (verts.length >> 1) - 1; }
  function tri(a, b, c) { idx.push(a, b, c); }
  function quad(a0, b0, a1, b1) { idx.push(a0, b0, a1, b0, b1, a1); }
  if (n < 2) {
    if (n === 1 && st.cap === 'round') {
      var seg = circleSegments(w / 2, quality), c0 = V(P[0], P[1]), f = -1, prv = -1;
      for (i = 0; i < seg; i++) { var aa = i / seg * PI2, vi = V(P[0] + Math.cos(aa) * w / 2, P[1] + Math.sin(aa) * w / 2); if (prv >= 0) tri(c0, prv, vi); else f = vi; prv = vi; }
      tri(c0, prv, f);
    }
    return;
  }
  if (n < 3) closed = false;
  var wA = w / 2, wB = w / 2, align = st.alignment === undefined ? 0.5 : st.alignment;
  if (closed && align !== 0.5) {
    var area = 0;
    for (i = 0; i < n; i++) { var j2 = (i + 1) % n; area += P[i * 2] * P[j2 * 2 + 1] - P[j2 * 2] * P[i * 2 + 1]; }
    var outer = w * align, inner = w * (1 - align);
    if (area > 0) { wA = inner; wB = outer; } else { wA = outer; wB = inner; }
  }
  var join = st.join || 'miter', cap = st.cap || 'butt', miterLimit = st.miterLimit || 10;
  var prevA = -1, prevB = -1, closeA = -1, closeB = -1;

  function roundCap(px, py, nx, ny, dx, dy, va, vb, r) {
    var c = V(px, py), a0 = Math.atan2(ny, nx);
    var sweep = (nx * dy - ny * dx) > 0 ? Math.PI : -Math.PI;
    var steps = arcSegments(r, Math.PI, quality), prev = va;
    for (var k = 1; k < steps; k++) {
      var ang = a0 + sweep * k / steps, v = V(px + Math.cos(ang) * r, py + Math.sin(ang) * r);
      tri(c, prev, v); prev = v;
    }
    tri(c, prev, vb);
  }

  for (i = 0; i < n; i++) {
    var px = P[i * 2], py = P[i * 2 + 1];
    var hasPrev = closed || i > 0, hasNext = closed || i < n - 1;
    var ip = (i - 1 + n) % n, inx = (i + 1) % n;
    var d0x = 0, d0y = 0, d1x = 0, d1y = 0, len0 = 0, len1 = 0;
    if (hasPrev) { d0x = px - P[ip * 2]; d0y = py - P[ip * 2 + 1]; len0 = Math.sqrt(d0x * d0x + d0y * d0y); d0x /= len0; d0y /= len0; }
    if (hasNext) { d1x = P[inx * 2] - px; d1y = P[inx * 2 + 1] - py; len1 = Math.sqrt(d1x * d1x + d1y * d1y); d1x /= len1; d1y /= len1; }
    var a, b, nx, ny;
    if (!hasPrev) {
      nx = -d1y; ny = d1x;
      var sx = px, sy = py;
      if (cap === 'square') { sx -= d1x * w / 2; sy -= d1y * w / 2; }
      a = V(sx + nx * wA, sy + ny * wA); b = V(sx - nx * wB, sy - ny * wB);
      if (cap === 'round') roundCap(px, py, nx, ny, -d1x, -d1y, a, b, wA);
      prevA = a; prevB = b;
      continue;
    }
    if (!hasNext) {
      nx = -d0y; ny = d0x;
      var ex = px, ey = py;
      if (cap === 'square') { ex += d0x * w / 2; ey += d0y * w / 2; }
      a = V(ex + nx * wA, ey + ny * wA); b = V(ex - nx * wB, ey - ny * wB);
      quad(prevA, prevB, a, b);
      if (cap === 'round') roundCap(px, py, nx, ny, d0x, d0y, a, b, wA);
      continue;
    }
    var n0x = -d0y, n0y = d0x, n1x = -d1y, n1y = d1x;
    var cross = d0x * d1y - d0y * d1x, dot = d0x * d1x + d0y * d1y;
    var ja, jb, ja2, jb2;
    if (Math.abs(cross) < 1e-9 && dot > 0) {
      ja = ja2 = V(px + n0x * wA, py + n0y * wA);
      jb = jb2 = V(px - n0x * wB, py - n0y * wB);
    } else {
      var reversal = Math.abs(cross) < 1e-9 && dot <= 0;
      var innerIsA = cross > 0;
      var wIn = innerIsA ? wA : wB, wOut = innerIsA ? wB : wA, sIn = innerIsA ? 1 : -1;
      var mx, my, miterLen, inX, inY;
      if (reversal) { mx = 0; my = 0; miterLen = Infinity; inX = px; inY = py; innerIsA = true; sIn = 1; wIn = wA; wOut = wA; }
      else {
        mx = n0x + n1x; my = n0y + n1y;
        var mlen = Math.sqrt(mx * mx + my * my); mx /= mlen; my /= mlen;
        var cosHalf = mx * n0x + my * n0y;
        miterLen = 1 / cosHalf;
        var innerDist = wIn * miterLen, minLen = Math.min(len0, len1);
        var maxInner = Math.sqrt(minLen * minLen + wIn * wIn);
        if (innerDist > maxInner) innerDist = maxInner;
        inX = px + sIn * mx * innerDist; inY = py + sIn * my * innerDist;
      }
      if (join === 'miter' && miterLen <= miterLimit) {
        var outX = px - sIn * mx * wOut * miterLen, outY = py - sIn * my * wOut * miterLen;
        var vIn = V(inX, inY), vOut = V(outX, outY);
        if (innerIsA) { ja = ja2 = vIn; jb = jb2 = vOut; } else { ja = ja2 = vOut; jb = jb2 = vIn; }
      } else {
        var o0x = px - sIn * n0x * wOut, o0y = py - sIn * n0y * wOut;
        var o1x = px - sIn * n1x * wOut, o1y = py - sIn * n1y * wOut;
        var vin = V(inX, inY), vo0 = V(o0x, o0y), vo1 = V(o1x, o1y);
        if (join === 'round') {
          var a0 = Math.atan2(o0y - py, o0x - px), a1 = Math.atan2(o1y - py, o1x - px);
          var delta = a1 - a0;
          while (delta > Math.PI) delta -= PI2;
          while (delta < -Math.PI) delta += PI2;
          if (reversal) {
            var testX = Math.cos(a0 + Math.PI / 2), testY = Math.sin(a0 + Math.PI / 2);
            delta = (testX * d0x + testY * d0y) > 0 ? Math.PI : -Math.PI;
          }
          var steps = arcSegments(wOut, delta, quality), prevV = vo0;
          for (var k = 1; k < steps; k++) {
            var ang = a0 + delta * k / steps, vk = V(px + Math.cos(ang) * wOut, py + Math.sin(ang) * wOut);
            tri(vin, prevV, vk); prevV = vk;
          }
          tri(vin, prevV, vo1);
        } else {
          tri(vin, vo0, vo1);
        }
        if (innerIsA) { ja = vin; jb = vo0; ja2 = vin; jb2 = vo1; }
        else { ja = vo0; jb = vin; ja2 = vo1; jb2 = vin; }
      }
    }
    if (i === 0) { closeA = ja; closeB = jb; }
    else quad(prevA, prevB, ja, jb);
    prevA = ja2; prevB = jb2;
  }
  if (closed) quad(prevA, prevB, closeA, closeB);
}

/* ---------------------------------------------------------------- Rellenos */
function buildFill(contour, holes, out) {
  var verts = out.verts, idx = out.idx, pts = contour.pts, n = pts.length >> 1, base = verts.length >> 1, i;
  if (n < 3) return;
  if (contour.center && !holes.length) {
    verts.push(contour.cx, contour.cy);
    for (i = 0; i < n; i++) verts.push(pts[i * 2], pts[i * 2 + 1]);
    for (i = 0; i < n; i++) idx.push(base, base + 1 + i, base + 1 + ((i + 1) % n));
    return;
  }
  if (contour.convex && !holes.length) {
    for (i = 0; i < n; i++) verts.push(pts[i * 2], pts[i * 2 + 1]);
    // tira en zig-zag entre los dos lados del contorno: triángulos bien proporcionados. Un abanico desde un
    // vértice crea astillas finísimas (p.ej. en píldoras/barras) que con MSAA dejan grietas visibles.
    var lo = 0, hi = n - 1, up = true;
    while (hi - lo > 1) {
      if (up) { idx.push(base + lo, base + lo + 1, base + hi); lo++; }
      else { idx.push(base + lo, base + hi - 1, base + hi); hi--; }
      up = !up;
    }
    return;
  }
  var data = pts.slice(), holeIdx = [];
  for (var h = 0; h < holes.length; h++) {
    for (var c = 0; c < holes[h].length; c++) {
      holeIdx.push(data.length >> 1);
      var hp = holes[h][c].pts;
      for (i = 0; i < hp.length; i++) data.push(hp[i]);
    }
  }
  var tris = Earcut(data, holeIdx.length ? holeIdx : null, 2);
  for (i = 0; i < data.length; i++) verts.push(data[i]);
  for (i = 0; i < tris.length; i++) idx.push(base + tris[i]);
}

/* ======================================================================= Graphics */
class Graphics extends Container {
  constructor(options) {
    super();
    this.type = 'Graphics';
    this._instr = [];
    this._pending = [];
    this._last = [];
    this._path = null;
    this._fillStyle = { color: 0xffffff, alpha: 1, gradient: null };
    this._lineStyle = { width: 0, color: 0xffffff, alpha: 1, alignment: 0.5, join: 'miter', cap: 'butt', miterLimit: 10 };
    this._corner = null;
    this._v7fill = null;
    this.curveQuality = 1;
    this._dirty = true;
    this._geom = null;
    this._packed = null; this._pkT = -1; this._pkA = -1;
    if (options) {
      if (options.fillStyle) this.fillStyle(options.fillStyle.color, options.fillStyle.alpha);
      if (options.lineStyle) this.lineStyle(options.lineStyle);
      if (options.x !== undefined) this.x = options.x;
      if (options.y !== undefined) this.y = options.y;
    }
  }
  get instructions() { return this._instr; }
  get isEmpty() { return this._instr.length === 0; }
  _invalidate() { this._dirty = true; return this; }

  /* ------------ estilos ------------ */
  fillStyle(color, alpha) { this._fillStyle = normFillStyle(color, alpha); this._corner = null; return this; }
  setFillStyle(color, alpha) { return this.fillStyle(color, alpha); }
  lineStyle(width, color, alpha) {
    var prev = this._lineStyle;
    if (typeof width === 'object' && width !== null) {
      var o = width;
      this._lineStyle = {
        width: o.width !== undefined ? +o.width : 1, color: Color.toNumber(o.color !== undefined ? o.color : 0xffffff),
        alpha: o.alpha !== undefined ? +o.alpha : Color.alphaOf(o.color), alignment: o.alignment !== undefined ? +o.alignment : 0.5,
        join: o.join || prev.join, cap: o.cap || prev.cap, miterLimit: o.miterLimit || prev.miterLimit
      };
    } else {
      this._lineStyle = { width: +width || 0, color: Color.toNumber(color === undefined ? 0xffffff : color), alpha: alpha === undefined ? 1 : +alpha, alignment: prev.alignment, join: prev.join, cap: prev.cap, miterLimit: prev.miterLimit };
    }
    return this;
  }
  setLineJoin(j) { this._lineStyle = Object.assign({}, this._lineStyle, { join: j }); return this; }
  setLineCap(c) { this._lineStyle = Object.assign({}, this._lineStyle, { cap: c }); return this; }
  /** Degradado por esquinas estilo Phaser: tl, tr, bl, br */
  fillGradientStyle(tl, tr, bl, br, alphaTL, alphaTR, alphaBL, alphaBR) {
    var aTL = alphaTL === undefined ? 1 : alphaTL;
    this._corner = { tl: Color.toNumber(tl), tr: Color.toNumber(tr), bl: Color.toNumber(bl), br: Color.toNumber(br), atl: aTL, atr: alphaTR === undefined ? aTL : alphaTR, abl: alphaBL === undefined ? aTL : alphaBL, abr: alphaBR === undefined ? aTL : alphaBR };
    return this;
  }
  // el degradado por esquinas lleva sus propios alfas: no hereda el alfa del último fillStyle (como Phaser)
  _currentFill() { var f = Object.assign({}, this._fillStyle); if (this._corner) { f.corner = this._corner; f.alpha = 1; } return f; }
  _currentStroke() { return Object.assign({}, this._lineStyle); }

  /* ------------ API inmediata (Phaser) ------------ */
  _add(shape, fill, stroke) { this._instr.push({ shape: shape, fill: fill || null, stroke: stroke || null, holes: [], _contours: null }); this._dirty = true; return this; }
  fillRect(x, y, w, h) { return this._add(rectShape(x, y, w, h), this._currentFill()); }
  strokeRect(x, y, w, h) { return this._add(rectShape(x, y, w, h), null, this._currentStroke()); }
  fillRoundedRect(x, y, w, h, radius) { return this._add(roundRectShape(x, y, w, h, radius === undefined ? 20 : radius), this._currentFill()); }
  strokeRoundedRect(x, y, w, h, radius) { return this._add(roundRectShape(x, y, w, h, radius === undefined ? 20 : radius), null, this._currentStroke()); }
  fillCircle(x, y, r) { return this._add({ type: 'circle', x: x, y: y, r: Math.abs(r) }, this._currentFill()); }
  strokeCircle(x, y, r) { return this._add({ type: 'circle', x: x, y: y, r: Math.abs(r) }, null, this._currentStroke()); }
  fillEllipse(x, y, w, h) { return this._add({ type: 'ellipse', x: x, y: y, rx: Math.abs(w) / 2, ry: Math.abs(h) / 2 }, this._currentFill()); }
  strokeEllipse(x, y, w, h) { return this._add({ type: 'ellipse', x: x, y: y, rx: Math.abs(w) / 2, ry: Math.abs(h) / 2 }, null, this._currentStroke()); }
  fillTriangle(x0, y0, x1, y1, x2, y2) { return this._add({ type: 'poly', pts: [x0, y0, x1, y1, x2, y2], closed: true }, this._currentFill()); }
  strokeTriangle(x0, y0, x1, y1, x2, y2) { return this._add({ type: 'poly', pts: [x0, y0, x1, y1, x2, y2], closed: true }, null, this._currentStroke()); }
  fillPoints(points, closeShape) { return this._add({ type: 'poly', pts: flattenPoints(points), closed: closeShape !== false }, this._currentFill()); }
  strokePoints(points, closeShape) { return this._add({ type: 'poly', pts: flattenPoints(points), closed: !!closeShape }, null, this._currentStroke()); }
  /** Estrella rellena / contorneada (puntas, radio exterior, radio interior, rotación) */
  fillStar(x, y, points, radius, inner, rotation) { return this._add({ type: 'poly', pts: starPoints(x, y, points, radius, inner, rotation), closed: true }, this._currentFill()); }
  strokeStar(x, y, points, radius, inner, rotation) { return this._add({ type: 'poly', pts: starPoints(x, y, points, radius, inner, rotation), closed: true }, null, this._currentStroke()); }
  lineBetween(x1, y1, x2, y2) { return this._add({ type: 'poly', pts: [x1, y1, x2, y2], closed: false }, null, this._currentStroke()); }
  fillPoint(x, y, size) { size = size || 1; return this.fillRect(x - size / 2, y - size / 2, size, size); }
  /** Porción circular (pastel) */
  slice(x, y, radius, startAngle, endAngle, anticlockwise) {
    this.beginPath(); this.moveTo(x, y); this.arc(x, y, radius, startAngle, endAngle, anticlockwise); this.closePath();
    return this;
  }

  /* ------------ caminos ------------ */
  beginPath() { this._pending = []; this._path = null; return this; }
  _ensurePath() {
    if (!this._path) { this._path = { type: 'path', subpaths: [] }; this._pending.push(this._path); }
    return this._path;
  }
  _curSub() {
    var p = this._ensurePath(), sp = p.subpaths[p.subpaths.length - 1];
    if (!sp || sp.closed) { var start = sp ? [sp.pts[0], sp.pts[1]] : [0, 0]; sp = { pts: start, closed: false }; p.subpaths.push(sp); }
    return sp;
  }
  moveTo(x, y) { var p = this._ensurePath(); p.subpaths.push({ pts: [x, y], closed: false }); return this; }
  lineTo(x, y) { var sp = this._curSub(); sp.pts.push(x, y); return this; }
  closePath() { var p = this._path; if (p && p.subpaths.length) p.subpaths[p.subpaths.length - 1].closed = true; return this; }
  arc(x, y, radius, startAngle, endAngle, anticlockwise, overshoot) {
    var sweep = endAngle - startAngle;
    if (anticlockwise) { if (sweep > 0) sweep = sweep - PI2 * Math.ceil(sweep / PI2); if (sweep === 0 && endAngle !== startAngle) sweep = -PI2; }
    else { if (sweep < 0) sweep = sweep + PI2 * Math.ceil(-sweep / PI2); if (sweep === 0 && endAngle !== startAngle) sweep = PI2; }
    if (Math.abs(sweep) > PI2) sweep = sweep > 0 ? PI2 : -PI2;
    var seg = arcSegments(radius, sweep, this.curveQuality);
    var p = this._ensurePath(), sp = p.subpaths[p.subpaths.length - 1];
    if (!sp || sp.closed) { sp = { pts: [], closed: false }; p.subpaths.push(sp); }
    for (var i = 0; i <= seg; i++) { var a = startAngle + sweep * (i / seg); sp.pts.push(x + Math.cos(a) * radius, y + Math.sin(a) * radius); }
    return this;
  }
  arcTo(x1, y1, x2, y2, radius) {
    var sp = this._curSub(), x0 = sp.pts[sp.pts.length - 2], y0 = sp.pts[sp.pts.length - 1];
    var a1 = y0 - y1, b1 = x0 - x1, a2 = y2 - y1, b2 = x2 - x1, mm = Math.abs(a1 * b2 - b1 * a2);
    if (mm < 1e-8 || radius === 0) { sp.pts.push(x1, y1); return this; }
    var dd = a1 * a1 + b1 * b1, cc = a2 * a2 + b2 * b2, tt = a1 * a2 + b1 * b2;
    var k1 = radius * Math.sqrt(dd) / mm, k2 = radius * Math.sqrt(cc) / mm;
    var j1 = k1 * tt / dd, j2 = k2 * tt / cc;
    var cx = k1 * b2 + k2 * b1, cy = k1 * a2 + k2 * a1;
    var px = b1 * (k2 + j1), py = a1 * (k2 + j1), qx = b2 * (k1 + j2), qy = a2 * (k1 + j2);
    var sa = Math.atan2(py - cy, px - cx), ea = Math.atan2(qy - cy, qx - cx);
    sp.pts.push(px + x1, py + y1);
    return this.arc(cx + x1, cy + y1, radius, sa, ea, b1 * a2 > b2 * a1);
  }
  quadraticCurveTo(cpx, cpy, x, y) {
    var sp = this._curSub(), x0 = sp.pts[sp.pts.length - 2], y0 = sp.pts[sp.pts.length - 1];
    var len = Math.sqrt((cpx - x0) * (cpx - x0) + (cpy - y0) * (cpy - y0)) + Math.sqrt((x - cpx) * (x - cpx) + (y - cpy) * (y - cpy));
    var seg = clamp(Math.ceil(len / 6 * this.curveQuality), 4, 256);
    for (var i = 1; i <= seg; i++) {
      var t = i / seg, mt = 1 - t;
      sp.pts.push(mt * mt * x0 + 2 * mt * t * cpx + t * t * x, mt * mt * y0 + 2 * mt * t * cpy + t * t * y);
    }
    return this;
  }
  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
    var sp = this._curSub(), x0 = sp.pts[sp.pts.length - 2], y0 = sp.pts[sp.pts.length - 1];
    var len = Math.sqrt((c1x - x0) * (c1x - x0) + (c1y - y0) * (c1y - y0)) + Math.sqrt((c2x - c1x) * (c2x - c1x) + (c2y - c1y) * (c2y - c1y)) + Math.sqrt((x - c2x) * (x - c2x) + (y - c2y) * (y - c2y));
    var seg = clamp(Math.ceil(len / 6 * this.curveQuality), 6, 256);
    for (var i = 1; i <= seg; i++) {
      var t = i / seg, mt = 1 - t, a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
      sp.pts.push(a * x0 + b * c1x + c * c2x + d * x, a * y0 + b * c1y + c * c2y + d * y);
    }
    return this;
  }
  fillPath() { return this.fill(); }
  strokePath() { return this.stroke(); }

  /* ------------ API por formas (PixiJS v8) ------------ */
  rect(x, y, w, h) { this._path = null; this._pending.push(rectShape(x, y, w, h)); return this; }
  roundRect(x, y, w, h, r) { this._path = null; this._pending.push(roundRectShape(x, y, w, h, r === undefined ? 10 : r)); return this; }
  circle(x, y, r) { this._path = null; this._pending.push({ type: 'circle', x: x, y: y, r: Math.abs(r) }); return this; }
  ellipse(x, y, rx, ry) { this._path = null; this._pending.push({ type: 'ellipse', x: x, y: y, rx: Math.abs(rx), ry: Math.abs(ry === undefined ? rx : ry) }); return this; }
  poly(points, close) { this._path = null; this._pending.push({ type: 'poly', pts: flattenPoints(points), closed: close !== false }); return this; }
  star(x, y, points, radius, innerRadius, rotation) { return this.poly(starPoints(x, y, points, radius, innerRadius, rotation), true); }
  regularPoly(x, y, radius, sides, rotation) {
    sides = Math.max(3, sides | 0); rotation = rotation || 0;
    var pts = [];
    for (var i = 0; i < sides; i++) { var a = rotation - Math.PI / 2 + i / sides * PI2; pts.push(x + Math.cos(a) * radius, y + Math.sin(a) * radius); }
    return this.poly(pts, true);
  }
  /** Rellena las formas pendientes (o las últimas si no hay pendientes). */
  fill(style, alpha) {
    var f = style === undefined ? this._currentFill() : normFillStyle(style, alpha);
    var shapes = this._pending.length ? this._pending : this._last;
    for (var i = 0; i < shapes.length; i++) this._add(shapes[i], f);
    this._lastFillIdx = this._instr.length - shapes.length;
    this._lastFillCount = shapes.length;
    this._last = shapes; this._pending = []; this._path = null;
    return this;
  }
  /** Traza las formas pendientes (o las últimas rellenadas). */
  stroke(style) {
    var s;
    if (style === undefined) s = this._currentStroke();
    else if (typeof style === 'object') { var prev = this._lineStyle; this.lineStyle(style); s = this._currentStroke(); this._lineStyle = prev; }
    else { s = Object.assign({}, this._lineStyle, { color: Color.toNumber(style) }); if (!(s.width > 0)) s.width = 1; }
    if (!(s.width > 0)) s.width = 1;
    var shapes = this._pending.length ? this._pending : this._last;
    for (var i = 0; i < shapes.length; i++) this._add(shapes[i], null, s);
    this._last = shapes; this._pending = []; this._path = null;
    return this;
  }
  /** Recorta las formas pendientes como agujeros de las últimas formas rellenadas. */
  cut() {
    var holes = this._pending.map(function (s) { return shapeContours(s, 1); });
    if (this._lastFillCount && holes.length) {
      for (var i = this._lastFillIdx; i < this._lastFillIdx + this._lastFillCount; i++) {
        var ins = this._instr[i]; if (ins) { ins.holes = ins.holes.concat(holes); ins._contours = null; }
      }
      this._dirty = true;
    }
    this._pending = []; this._path = null;
    return this;
  }

  /* ------------ API PixiJS v7 ------------ */
  beginFill(color, alpha) { this._v7fill = normFillStyle(color === undefined ? 0 : color, alpha === undefined ? 1 : alpha); return this; }
  endFill() { this._v7fill = null; return this; }
  _v7(shape) { var st = this._lineStyle.width > 0 ? this._currentStroke() : null; if (!this._v7fill && !st) return this; return this._add(shape, this._v7fill, st); }
  drawRect(x, y, w, h) { return this._v7(rectShape(x, y, w, h)); }
  drawRoundedRect(x, y, w, h, r) { return this._v7(roundRectShape(x, y, w, h, r)); }
  drawCircle(x, y, r) { return this._v7({ type: 'circle', x: x, y: y, r: Math.abs(r) }); }
  drawEllipse(x, y, rx, ry) { return this._v7({ type: 'ellipse', x: x, y: y, rx: Math.abs(rx), ry: Math.abs(ry) }); }
  drawPolygon(points) { var pts = Array.isArray(points) ? points : Array.prototype.slice.call(arguments); return this._v7({ type: 'poly', pts: flattenPoints(pts), closed: true }); }
  drawStar(x, y, points, radius, inner, rotation) { this.star(x, y, points, radius, inner, rotation); var s = this._pending.pop(); return this._v7(s); }

  clear() { this._instr = []; this._pending = []; this._last = []; this._path = null; this._lastFillCount = 0; this._dirty = true; return this; }

  /* ------------ geometría ------------ */
  _build() {
    var verts = [], idx = [], rgb = [], alp = [], q = this.curveQuality;
    var out = { verts: verts, idx: idx };
    var tmpC = { c: 0, a: 1 };
    for (var i = 0; i < this._instr.length; i++) {
      var ins = this._instr[i];
      var contours = ins._contours || (ins._contours = shapeContours(ins.shape, q));
      if (ins.fill && contours.length) {
        var start = verts.length >> 1;
        for (var c = 0; c < contours.length; c++) {
          var holes = [];
          for (var h = 0; h < ins.holes.length; h++) {
            var hc = ins.holes[h];
            if (hc.length && hc[0].pts.length >= 2 && (contours.length === 1 || pointInPoly(contours[c].pts, hc[0].pts[0], hc[0].pts[1]))) holes.push(hc);
          }
          buildFill(contours[c], holes, out);
        }
        this._colorRange(ins.fill, start, verts, rgb, alp, tmpC);
      }
      if (ins.stroke && ins.stroke.width > 0) {
        var s0 = verts.length >> 1;
        for (var c2 = 0; c2 < contours.length; c2++) buildStroke(contours[c2].pts, contours[c2].closed, ins.stroke, out, q);
        for (var k = s0; k < (verts.length >> 1); k++) { rgb.push(ins.stroke.color); alp.push(ins.stroke.alpha); }
      }
    }
    var vCount = verts.length >> 1;
    var g = this._geom || (this._geom = {});
    g.verts = new Float32Array(verts);
    g.rgb = new Uint32Array(rgb);
    g.alpha = new Float32Array(alp);
    g.indices = vCount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
    g.vCount = vCount; g.iCount = idx.length;
    var b = new Bounds();
    for (var v = 0; v < verts.length; v += 2) b.addPoint(verts[v], verts[v + 1]);
    g.bounds = b;
    this._packed = new Uint32Array(vCount); this._pkT = -1; this._pkA = -1;
    this._dirty = false;
  }
  _colorRange(fill, start, verts, rgb, alp, tmp) {
    var end = verts.length >> 1, k;
    if (fill.corner) {
      var cr = fill.corner, bx = Infinity, by = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (k = start; k < end; k++) { var x = verts[k * 2], y = verts[k * 2 + 1]; if (x < bx) bx = x; if (x > bx1) bx1 = x; if (y < by) by = y; if (y > by1) by1 = y; }
      var bw = (bx1 - bx) || 1, bh = (by1 - by) || 1;
      for (k = start; k < end; k++) {
        var tx = (verts[k * 2] - bx) / bw, ty = (verts[k * 2 + 1] - by) / bh;
        rgb.push(Color.lerp(Color.lerp(cr.tl, cr.tr, tx), Color.lerp(cr.bl, cr.br, tx), ty));
        alp.push(((cr.atl + (cr.atr - cr.atl) * tx) * (1 - ty) + (cr.abl + (cr.abr - cr.abl) * tx) * ty) * fill.alpha);
      }
      return;
    }
    if (fill.gradient) {
      var gr = fill.gradient;
      for (k = start; k < end; k++) {
        var px = verts[k * 2], py = verts[k * 2 + 1], t;
        if (gr.type === 'radial') { var dx = px - gr.x, dy = py - gr.y; t = Math.sqrt(dx * dx + dy * dy) / (gr.r || 1); }
        else { var gx = gr.x1 - gr.x0, gy = gr.y1 - gr.y0, gl = gx * gx + gy * gy || 1; t = ((px - gr.x0) * gx + (py - gr.y0) * gy) / gl; }
        sampleStops(gr.stops, t, tmp);
        rgb.push(tmp.c); alp.push(tmp.a * fill.alpha);
      }
      return;
    }
    for (k = start; k < end; k++) { rgb.push(fill.color); alp.push(fill.alpha); }
  }
  get geometry() { if (this._dirty || !this._geom) this._build(); return this._geom; }
  _packColors() {
    var g = this._geom, t = this.worldTint, a = this.worldAlpha;
    if (t === this._pkT && a === this._pkA) return this._packed;
    this._pkT = t; this._pkA = a;
    var out = this._packed, rgb = g.rgb, al = g.alpha, white = t === 0xffffff;
    var lastC = -1, lastA = -1, lastP = 0;
    for (var i = 0; i < g.vCount; i++) {
      var c = rgb[i], va = al[i];
      if (c !== lastC || va !== lastA) { lastC = c; lastA = va; lastP = packColor(white ? c : Color.multiply(c, t), va * a); }
      out[i] = lastP;
    }
    return out;
  }
  _renderGPU(r) {
    if (this._dirty || !this._geom) this._build();
    var g = this._geom; if (!g.iCount) return;
    if (r.cull && this.cullable) {
      var b = g.bounds, m = this.worldTransform;
      _tmpBounds.reset(); _tmpBounds.addRect(b.minX, b.minY, b.maxX, b.maxY, m);
      var cr = r.cullRect;
      if (_tmpBounds.maxX < cr.x || _tmpBounds.maxY < cr.y || _tmpBounds.minX > cr.x + cr.width || _tmpBounds.minY > cr.y + cr.height) { r.stats.culled++; return; }
    }
    r.batcher.pushMesh(Texture.WHITE.source, g.verts, null, this._packColors(), g.indices, g.vCount, g.iCount, this.worldTransform, this.worldBlend);
  }
  _renderCanvas(r) { r.drawGraphics(this); }
  _addSelfBounds(b) {
    if (this._dirty || !this._geom) this._build();
    var gb = this._geom.bounds; if (gb.isEmpty) return;
    b.addRect(gb.minX, gb.minY, gb.maxX, gb.maxY, this.worldTransform);
  }
  _hitTestSelf(lx, ly) {
    for (var i = this._instr.length - 1; i >= 0; i--) {
      var ins = this._instr[i], contours = ins._contours || (ins._contours = shapeContours(ins.shape, this.curveQuality));
      if (ins.fill && shapeContains(ins.shape, contours, lx, ly)) {
        var inHole = false;
        for (var h = 0; h < ins.holes.length; h++) for (var c = 0; c < ins.holes[h].length; c++) if (pointInPoly(ins.holes[h][c].pts, lx, ly)) inHole = true;
        if (!inHole) return true;
      }
      if (ins.stroke) {
        var hw = ins.stroke.width / 2 + 0.5;
        for (var k = 0; k < contours.length; k++) {
          var p = contours[k].pts, n = p.length >> 1, segs = contours[k].closed ? n : n - 1;
          for (var s = 0; s < segs; s++) {
            var j = (s + 1) % n;
            if (Intersect.pointToSegmentDistance(lx, ly, p[s * 2], p[s * 2 + 1], p[j * 2], p[j * 2 + 1]) <= hw) return true;
          }
        }
      }
    }
    return false;
  }
  /** Genera una textura con el contenido (requiere game). */
  generateTexture(key, game) {
    var g = game || (this.scene && this.scene.game) || UG._defaultGame;
    if (!g || !g.renderer) throw new Error('UltraGame: generateTexture requiere un juego iniciado');
    if (key) return g.textures.fromDisplayObject(key, this);
    return g.renderer.generateTexture(this);
  }
  _onDestroy() { this._instr = []; this._pending = []; this._last = []; this._geom = null; this._packed = null; }
}

function rectShape(x, y, w, h) {
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  return { type: 'rect', x: x, y: y, w: w, h: h };
}
function roundRectShape(x, y, w, h, r) {
  var rs = typeof r === 'number' ? { tl: r, tr: r, br: r, bl: r } : { tl: r.tl || 0, tr: r.tr || 0, br: r.br || 0, bl: r.bl || 0 };
  var s = rectShape(x, y, w, h);
  return { type: 'roundRect', x: s.x, y: s.y, w: s.w, h: s.h, r: rs };
}
function starPoints(x, y, points, radius, innerRadius, rotation) {
  points = Math.max(2, points | 0); innerRadius = innerRadius === undefined ? radius / 2 : innerRadius; rotation = rotation || 0;
  var pts = [], total = points * 2;
  for (var i = 0; i < total; i++) { var r = i % 2 ? innerRadius : radius, a = rotation - Math.PI / 2 + i / total * PI2; pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  return pts;
}
function flattenPoints(points) {
  if (!points) return [];
  if (points instanceof Polygon) return points.points.slice();
  if (points.length && typeof points[0] === 'object') { var o = []; for (var i = 0; i < points.length; i++) o.push(points[i].x, points[i].y); return o; }
  return Array.prototype.slice.call(points).map(Number);
}

/* ================================================================ Formas-objeto
 * this.add.rectangle / circle / ellipse / triangle / star / polygon / line (estilo Phaser) */
class ShapeObject extends Graphics {
  constructor(kind, x, y, params, fillColor, fillAlpha) {
    super();
    this.type = 'Shape';
    this.shapeType = kind;
    this.x = x || 0; this.y = y || 0;
    this._p = params;
    this.originX = 0.5; this.originY = 0.5;
    this.isFilled = fillColor !== undefined && fillColor !== null;
    this.fillColor = this.isFilled ? Color.toNumber(fillColor) : 0xffffff;
    this.fillAlpha = fillAlpha === undefined ? 1 : fillAlpha;
    this.isStroked = false; this.strokeColor = 0xffffff; this.strokeAlpha = 1; this.lineWidth = 1;
    this._shapeDirty = true;
  }
  setFillStyle(color, alpha) { if (color === undefined) this.isFilled = false; else { this.isFilled = true; this.fillColor = Color.toNumber(color); this.fillAlpha = alpha === undefined ? 1 : alpha; } this._shapeDirty = true; return this; }
  setStrokeStyle(width, color, alpha) { if (width === undefined) this.isStroked = false; else { this.isStroked = true; this.lineWidth = width; this.strokeColor = Color.toNumber(color === undefined ? 0xffffff : color); this.strokeAlpha = alpha === undefined ? 1 : alpha; } this._shapeDirty = true; return this; }
  setOrigin(x, y) { this.originX = x; this.originY = y === undefined ? x : y; this._shapeDirty = true; return this; }
  setSize(w, h) { this._p.width = w; this._p.height = h; this._shapeDirty = true; return this; }
  get shapeWidth() { return this._p.width || (this._p.radius ? this._p.radius * 2 : 0); }
  get shapeHeight() { return this._p.height || (this._p.radius ? this._p.radius * 2 : 0); }
  get radius() { return this._p.radius; }
  set radius(v) { this._p.radius = v; this._p.width = v * 2; this._p.height = v * 2; this._shapeDirty = true; }
  get width() { return this.shapeWidth * Math.abs(this.scaleX); }
  set width(v) { this._p.width = v; this._shapeDirty = true; }
  get height() { return this.shapeHeight * Math.abs(this.scaleY); }
  set height(v) { this._p.height = v; this._shapeDirty = true; }
  _redraw() {
    this.clear();
    var p = this._p, w = this.shapeWidth, h = this.shapeHeight, ox = -this.originX * w, oy = -this.originY * h;
    switch (this.shapeType) {
      case 'rectangle': this.rect(ox, oy, w, h); break;
      case 'roundrect': this.roundRect(ox, oy, w, h, p.radius || 8); break;
      case 'circle': this.circle(ox + w / 2, oy + h / 2, p.radius); break;
      case 'ellipse': this.ellipse(ox + w / 2, oy + h / 2, w / 2, h / 2); break;
      case 'triangle': this.poly([p.x1 + ox, p.y1 + oy, p.x2 + ox, p.y2 + oy, p.x3 + ox, p.y3 + oy]); break;
      case 'star': this.star(ox + w / 2, oy + h / 2, p.points, p.outerRadius, p.innerRadius); break;
      case 'polygon': this.poly(p.points.map(function (v, i) { return v + (i % 2 ? oy : ox); })); break;
      case 'line': this.poly([p.x1 + ox, p.y1 + oy, p.x2 + ox, p.y2 + oy], false); break;
    }
    if (this.isFilled && this.shapeType !== 'line') this.fill(this.fillColor, this.fillAlpha);
    if (this.isStroked || this.shapeType === 'line') this.stroke({ width: this.lineWidth, color: this.isStroked ? this.strokeColor : this.fillColor, alpha: this.isStroked ? this.strokeAlpha : this.fillAlpha });
    this._shapeDirty = false;
  }
  _renderGPU(r) { if (this._shapeDirty) this._redraw(); super._renderGPU(r); }
  _renderCanvas(r) { if (this._shapeDirty) this._redraw(); super._renderCanvas(r); }
  _addSelfBounds(b) { if (this._shapeDirty) this._redraw(); super._addSelfBounds(b); }
  _hitTestSelf(x, y) { if (this._shapeDirty) this._redraw(); return super._hitTestSelf(x, y); }
}

UG.Graphics = Graphics;
UG.ShapeObject = ShapeObject;
UG.GraphicsUtils = { buildStroke: buildStroke, buildFill: buildFill, shapeContours: shapeContours, circleSegments: circleSegments };
