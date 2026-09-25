/* UltraGame - backend Canvas2D (compatibilidad universal).
 * Implementa el mismo recorrido de escena con drawImage/paths nativos, tintes con caché LRU acotada,
 * filtros vía ctx.filter (CSS) cuando existen, máscaras por composición y mallas por mapeo afín. */

var CANVAS_BLEND = ['source-over', 'lighter', 'multiply', 'screen', 'destination-out', 'copy', 'lighten', 'darken'];

class CanvasRenderer extends BaseRenderer {
  constructor(options) {
    super(options);
    this.type = 'canvas';
    this.ctx = null;
    this._tint = new Map();
    this._tintBySrc = new Map();
    this._tintMax = this.options.tintCacheSize || 384;
    this._stack = [];
    this._offscreen = [];
    this._inFrame = false;
    this.supportsFilters = false;
    this.smoothing = this.options.pixelArt ? false : true;
    var self = this;
    this.extract = {
      pixels: function (target) { return Promise.resolve(self._extractPixels(target)); },
      canvas: function (target) { return Promise.resolve(pixelsToCanvas(self._extractPixels(target))); },
      base64: function (target, type, q) { return Promise.resolve(pixelsToCanvas(self._extractPixels(target)).toDataURL(type || 'image/png', q)); }
    };
  }
  init(canvas) {
    this.canvas = canvas;
    var ctx = null;
    try { ctx = canvas.getContext('2d', { alpha: !!this.options.transparent || true }); } catch (e) { ctx = null; }
    if (!ctx) return Promise.reject(new Error('Canvas2D no disponible'));
    this.ctx = this._mainCtx = ctx;
    this.supportsFilters = typeof ctx.filter === 'string';
    this.maxTextureSize = 16384;
    this.resize(this.width, this.height, this.resolution);
    return Promise.resolve(this);
  }
  get currentTarget() { return this._stack[this._stack.length - 1] || null; }
  _onResize() { if (this.ctx) this._applySmoothing(this.ctx); }
  _applySmoothing(ctx) { ctx.imageSmoothingEnabled = this.smoothing; if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high'; }

  /* ---------- frame y destinos ---------- */
  beginFrame(clear, color, alpha) {
    if (this.destroyed) return false;
    var s = this.stats; s.drawCalls = 0; s.quads = 0; s.culled = 0; s.filters = 0; s.targets = 0; s.frame++;
    this._inFrame = true;
    this._stack.length = 0;
    this._pushCtx(this._mainCtx, this.canvas, 0, 0, this.width, this.height, this.resolution);
    var ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter && (ctx.filter = 'none');
    if (clear !== false) {
      var a = alpha !== undefined ? alpha : this.backgroundAlpha, c = color !== undefined ? color : this.backgroundColor;
      if (a < 1) ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (a > 0) { ctx.fillStyle = Color.toCSS(c, a); ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); }
    }
    return true;
  }
  endFrame() { this._stack.length = 0; this.ctx = this._mainCtx; this._inFrame = false; }
  _pushCtx(ctx, canvas, x, y, w, h, res) {
    this._stack.push({ ctx: ctx, canvas: canvas, x: x, y: y, w: w, h: h, res: res });
    this.ctx = ctx; this.cullRect.set(x, y, w, h);
    this._applySmoothing(ctx);
  }
  _popCtx() {
    this._stack.pop();
    var t = this.currentTarget;
    if (t) { this.ctx = t.ctx; this.cullRect.set(t.x, t.y, t.w, t.h); }
    else this.ctx = this._mainCtx;
  }
  _getOffscreen(pw, ph) {
    for (var i = 0; i < this._offscreen.length; i++) {
      var o = this._offscreen[i];
      if (!o.used && o.canvas.width >= pw && o.canvas.height >= ph && o.canvas.width <= pw * 2 && o.canvas.height <= ph * 2) { o.used = true; o.ctx.setTransform(1, 0, 0, 1, 0, 0); o.ctx.globalAlpha = 1; o.ctx.globalCompositeOperation = 'source-over'; o.ctx.clearRect(0, 0, o.canvas.width, o.canvas.height); return o; }
    }
    var c = createCanvas(MathUtils.nextPowerOfTwo(Math.max(16, pw)), MathUtils.nextPowerOfTwo(Math.max(16, ph)));
    var entry = { canvas: c, ctx: c.getContext('2d'), used: true };
    if (this._offscreen.length > 16) { var old = this._offscreen.shift(); releaseCanvas(old.canvas); }
    this._offscreen.push(entry);
    return entry;
  }
  _releaseOffscreen(o) { o.used = false; }
  _setT(m) {
    var t = this.currentTarget, r = t.res;
    this.ctx.setTransform(m.a * r, m.b * r, m.c * r, m.d * r, (m.tx - t.x) * r, (m.ty - t.y) * r);
  }
  _setT6(a, b, c, d, tx, ty) {
    var t = this.currentTarget, r = t.res;
    this.ctx.setTransform(a * r, b * r, c * r, d * r, (tx - t.x) * r, (ty - t.y) * r);
  }
  _style(obj) {
    var ctx = this.ctx;
    ctx.globalAlpha = obj.worldAlpha;
    ctx.globalCompositeOperation = CANVAS_BLEND[obj.worldBlend] || 'source-over';
  }
  fillRect(x, y, w, h, color, alpha, blend) {
    if (alpha <= 0) return;
    var ctx = this.ctx; this._setT6(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = CANVAS_BLEND[blend || 0];
    ctx.fillStyle = Color.toHex(color); ctx.fillRect(x, y, w, h);
    this.stats.drawCalls++;
  }
  pushScissor(x, y, w, h) { var ctx = this.ctx; ctx.save(); this._setT6(1, 0, 0, 1, 0, 0); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); }
  popScissor() { this.ctx.restore(); }

  /* ---------- texturas ---------- */
  _drawable(src) {
    if (!src || src.destroyed) return null;
    if (src.isRenderTarget) {
      if (!src._rtCanvas) { src._rtCanvas = createCanvas(src.width, src.height); src._rtCtx = src._rtCanvas.getContext('2d'); }
      else if (src._rtCanvas.width !== src.width || src._rtCanvas.height !== src.height) { src._rtCanvas.width = src.width; src._rtCanvas.height = src.height; }
      return src._rtCanvas;
    }
    var r = src.resource;
    if (r && r.data) {
      if (!src._canvasCache || src._canvasVersion !== src.version) {
        var c = createCanvas(r.width, r.height), cx = c.getContext('2d'), img = cx.createImageData(r.width, r.height);
        var d = img.data, sd = r.data;
        for (var i = 0; i < d.length; i += 4) {
          var a = sd[i + 3];
          if (src.premultiplied && a > 0 && a < 255) { var f = 255 / a; d[i] = sd[i] * f; d[i + 1] = sd[i + 1] * f; d[i + 2] = sd[i + 2] * f; }
          else { d[i] = sd[i]; d[i + 1] = sd[i + 1]; d[i + 2] = sd[i + 2]; }
          d[i + 3] = a;
        }
        cx.putImageData(img, 0, 0);
        src._canvasCache = c; src._canvasVersion = src.version;
      }
      return src._canvasCache;
    }
    return r;
  }
  _tinted(src, fx, fy, fw, fh, tint) {
    tint = tint & 0xfcfcfc;
    var key = src.uid + ':' + fx + ',' + fy + ',' + fw + ',' + fh + ':' + tint + ':' + src.version;
    var c = this._tint.get(key);
    if (c) { this._tint.delete(key); this._tint.set(key, c); return c; }
    var img = this._drawable(src); if (!img) return null;
    var w = Math.max(1, Math.ceil(fw)), h = Math.max(1, Math.ceil(fh));
    c = createCanvas(w, h);
    var x = c.getContext('2d');
    x.drawImage(img, fx, fy, fw, fh, 0, 0, w, h);
    x.globalCompositeOperation = 'multiply'; x.fillStyle = Color.toHex(tint); x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'destination-in'; x.drawImage(img, fx, fy, fw, fh, 0, 0, w, h);
    this._tint.set(key, c);
    var set = this._tintBySrc.get(src.uid); if (!set) { set = new Set(); this._tintBySrc.set(src.uid, set); } set.add(key);
    if (!src._gpu[this.uid]) src._gpu[this.uid] = true;
    while (this._tint.size > this._tintMax) {
      var oldKey = this._tint.keys().next().value, oc = this._tint.get(oldKey);
      this._tint.delete(oldKey); releaseCanvas(oc);
      var su = +oldKey.split(':')[0], s2 = this._tintBySrc.get(su); if (s2) { s2.delete(oldKey); if (!s2.size) this._tintBySrc.delete(su); }
    }
    return c;
  }
  freeSource(src) {
    var set = this._tintBySrc.get(src.uid);
    if (set) { var self = this; set.forEach(function (k) { var c = self._tint.get(k); if (c) releaseCanvas(c); self._tint.delete(k); }); this._tintBySrc.delete(src.uid); }
    if (src._rtCanvas) { releaseCanvas(src._rtCanvas); src._rtCanvas = null; src._rtCtx = null; }
    if (src._canvasCache) { releaseCanvas(src._canvasCache); src._canvasCache = null; }
    delete src._gpu[this.uid];
  }
  /** Dibuja una región de textura (frame/uv) en el rectángulo local (x,y,w,h) con la transformación m. */
  _drawTex(tex, m, x, y, w, h, tint, flipX, flipY, uvRect) {
    var src = tex.source, img = this._drawable(src); if (!img) return;
    var f = tex.frame, fx = f.x, fy = f.y, fw = f.width, fh = f.height;
    if (uvRect) { fx = uvRect[0] * src.width; fy = uvRect[1] * src.height; fw = (uvRect[2] - uvRect[0]) * src.width; fh = (uvRect[3] - uvRect[1]) * src.height; }
    if (fw <= 0 || fh <= 0) return;
    var sa = flipX ? -1 : 1, sd = flipY ? -1 : 1;
    this._setT6(m.a * sa, m.b * sa, m.c * sd, m.d * sd, m.tx, m.ty);
    var ctx = this.ctx;
    if (tex.rotate && !uvRect) { ctx.transform(0, -1, 1, 0, x, y + h); var t = w; w = h; h = t; x = 0; y = 0; fw = f.width; fh = f.height; }
    if (tint !== 0xffffff) {
      var tc = this._tinted(src, fx, fy, fw, fh, tint);
      if (tc) ctx.drawImage(tc, 0, 0, tc.width, tc.height, x, y, w, h);
    } else ctx.drawImage(img, fx, fy, fw, fh, x, y, w, h);
    this.stats.drawCalls++;
  }

  /* ---------- objetos ---------- */
  drawSprite(s) {
    var tex = s._texture; if (tex === Texture.EMPTY || !tex.source || tex.source.destroyed) return;
    if (this.cull && s.cullable) { s._calcVerts(QV); if (quadOutside(QV, this.cullRect)) { this.stats.culled++; return; } }
    this._style(s);
    var res = tex.source.resolution, ow = tex.orig.width / res, oh = tex.orig.height / res, tr = tex.trim;
    var x = -s.anchorX * ow, y = -s.anchorY * oh, w = ow, h = oh;
    if (tr) { x += tr.x / res; y += tr.y / res; w = tr.width / res; h = tr.height / res; }
    // volteo dentro del marco: con escala -1 el rectángulo x..x+w acaba en -x-w..-x; se compensa el centro
    if (s.flipX) x -= ow * (1 - 2 * s.anchorX);
    if (s.flipY) y -= oh * (1 - 2 * s.anchorY);
    this._drawTex(tex, s.worldTransform, x, y, w, h, s.worldTint, s.flipX, s.flipY);
  }
  drawTilingSprite(s) {
    var tex = s._texture; if (tex === Texture.EMPTY || !tex.source) return;
    var r = s._localRect(), ctx = this.ctx;
    this._style(s);
    var src = tex.source, f = tex.frame;
    var key = '_pat_' + this.uid;
    var patSrc;
    if (s.worldTint !== 0xffffff) patSrc = this._tinted(src, f.x, f.y, f.width, f.height, s.worldTint);
    else if (tex.isFullSource) patSrc = this._drawable(src);
    else {
      if (!s[key + 'c'] || s[key + 'v'] !== src.version || s[key + 't'] !== tex) {
        var c = s[key + 'c'] || createCanvas(f.width, f.height); c.width = f.width; c.height = f.height;
        c.getContext('2d').drawImage(this._drawable(src), f.x, f.y, f.width, f.height, 0, 0, f.width, f.height);
        s[key + 'c'] = c; s[key + 'v'] = src.version; s[key + 't'] = tex;
      }
      patSrc = s[key + 'c'];
    }
    if (!patSrc) return;
    var pat = ctx.createPattern(patSrc, 'repeat'); if (!pat) return;
    this._setT(s.worldTransform);
    var sx = s.tileScaleX * tex.width / patSrc.width, sy = s.tileScaleY * tex.height / patSrc.height;
    if (pat.setTransform && typeof DOMMatrix !== 'undefined') {
      var mm = new DOMMatrix();
      mm = mm.translate(r[0] + s.tilePositionX, r[1] + s.tilePositionY).rotate(s.tileRotation * RAD_TO_DEG).scale(sx, sy);
      pat.setTransform(mm);
      ctx.fillStyle = pat; ctx.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
    } else {
      ctx.save(); ctx.beginPath(); ctx.rect(r[0], r[1], r[2] - r[0], r[3] - r[1]); ctx.clip();
      ctx.translate(r[0] + s.tilePositionX, r[1] + s.tilePositionY); ctx.scale(sx, sy);
      ctx.fillStyle = pat;
      var pw = patSrc.width, ph = patSrc.height;
      var fx0 = Math.floor(-s.tilePositionX / sx / pw) * pw - pw, fy0 = Math.floor(-s.tilePositionY / sy / ph) * ph - ph;
      ctx.fillRect(fx0, fy0, (r[2] - r[0]) / sx + pw * 3, (r[3] - r[1]) / sy + ph * 3);
      ctx.restore();
    }
    this.stats.drawCalls++;
  }
  drawNineSlice(s) {
    var tex = s._texture; if (tex === Texture.EMPTY || !tex.source) return;
    this._style(s);
    var sl = s._slices();
    for (var j = 0; j < 3; j++) for (var i = 0; i < 3; i++) {
      var x0 = sl.xs[i], x1 = sl.xs[i + 1], y0 = sl.ys[j], y1 = sl.ys[j + 1];
      if (x1 - x0 <= 0 || y1 - y0 <= 0) continue;
      this._drawTex(tex, s.worldTransform, x0, y0, x1 - x0, y1 - y0, s.worldTint, false, false, [sl.us[i], sl.vs[j], sl.us[i + 1], sl.vs[j + 1]]);
    }
  }
  drawGraphics(g) {
    var gm = g.geometry; if (!gm) return;
    if (this.cull && g.cullable && !gm.bounds.isEmpty) {
      var b = _tmpBounds.reset(); b.addRect(gm.bounds.minX, gm.bounds.minY, gm.bounds.maxX, gm.bounds.maxY, g.worldTransform);
      var cr = this.cullRect; if (b.maxX < cr.x || b.maxY < cr.y || b.minX > cr.x + cr.width || b.minY > cr.y + cr.height) { this.stats.culled++; return; }
    }
    var ctx = this.ctx; this._style(g); this._setT(g.worldTransform);
    var tint = g.worldTint, baseAlpha = g.worldAlpha;
    for (var i = 0; i < g._instr.length; i++) {
      var ins = g._instr[i], contours = ins._contours || (ins._contours = shapeContours(ins.shape, g.curveQuality));
      ctx.beginPath();
      this._shapePath(ins.shape, contours);
      for (var h = 0; h < ins.holes.length; h++) for (var hc = 0; hc < ins.holes[h].length; hc++) this._polyPath(ins.holes[h][hc].pts, true);
      if (ins.fill) {
        var f = ins.fill;
        ctx.globalAlpha = baseAlpha * (f.corner ? 1 : f.alpha);
        ctx.fillStyle = this._fillStyleFor(f, contours, tint);
        ctx.fill(ins.holes.length ? 'evenodd' : 'nonzero');
      }
      if (ins.stroke && ins.stroke.width > 0) {
        var st = ins.stroke;
        ctx.globalAlpha = baseAlpha * st.alpha;
        ctx.strokeStyle = Color.toHex(tint === 0xffffff ? st.color : Color.multiply(st.color, tint));
        ctx.lineWidth = st.width; ctx.lineJoin = st.join; ctx.lineCap = st.cap; ctx.miterLimit = st.miterLimit;
        ctx.stroke();
      }
    }
    this.stats.drawCalls++;
  }
  _fillStyleFor(f, contours, tint) {
    var ctx = this.ctx, mt = function (c) { return tint === 0xffffff ? c : Color.multiply(c, tint); };
    if (f.gradient) {
      var gr = f.gradient, cg = gr.type === 'radial' ? ctx.createRadialGradient(gr.x, gr.y, 0, gr.x, gr.y, gr.r) : ctx.createLinearGradient(gr.x0, gr.y0, gr.x1, gr.y1);
      for (var i = 0; i < gr.stops.length; i++) cg.addColorStop(clamp(gr.stops[i].offset, 0, 1), Color.toCSS(mt(gr.stops[i].color), gr.stops[i].alpha * f.alpha));
      return cg;
    }
    if (f.corner) {
      var b = new Bounds(); for (var c = 0; c < contours.length; c++) for (var k = 0; k < contours[c].pts.length; k += 2) b.addPoint(contours[c].pts[k], contours[c].pts[k + 1]);
      var cr = f.corner, lg = ctx.createLinearGradient(0, b.minY, 0, b.maxY);
      lg.addColorStop(0, Color.toCSS(mt(Color.lerp(cr.tl, cr.tr, 0.5)), (cr.atl + cr.atr) / 2 * f.alpha));
      lg.addColorStop(1, Color.toCSS(mt(Color.lerp(cr.bl, cr.br, 0.5)), (cr.abl + cr.abr) / 2 * f.alpha));
      return lg;
    }
    return Color.toHex(mt(f.color));
  }
  _shapePath(s, contours) {
    var ctx = this.ctx;
    if (s.type === 'rect') { ctx.rect(s.x, s.y, s.w, s.h); return; }
    if (s.type === 'circle') { ctx.moveTo(s.x + s.r, s.y); ctx.arc(s.x, s.y, s.r, 0, PI2); ctx.closePath(); return; }
    if (s.type === 'ellipse' && ctx.ellipse) { ctx.moveTo(s.x + s.rx, s.y); ctx.ellipse(s.x, s.y, s.rx, s.ry, 0, 0, PI2); ctx.closePath(); return; }
    for (var i = 0; i < contours.length; i++) this._polyPath(contours[i].pts, contours[i].closed);
  }
  _polyPath(p, closed) {
    if (p.length < 2) return;
    var ctx = this.ctx; ctx.moveTo(p[0], p[1]);
    for (var i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    if (closed) ctx.closePath();
  }
  drawBitmapText(t) {
    var gs = t._glyphs; if (!gs.length) return;
    this._style(t);
    var ox = -t.anchorX * t._w, oy = -t.anchorY * t._h;
    for (var i = 0; i < gs.length; i++) { var g = gs[i]; this._drawTex(g.tex, t.worldTransform, g.x + ox, g.y + oy, g.w, g.h, t.worldTint, false, false); }
  }
  drawParticles(e) {
    var n = e.count; if (!n) return;
    var ctx = this.ctx, wt = e.worldTransform;
    ctx.globalCompositeOperation = CANVAS_BLEND[e.worldBlend] || 'source-over';
    var ramp = e.tintRamp, rampN = ramp ? ramp.length : 0;
    for (var i = 0; i < n; i++) {
      var t = 1 - e.life[i] * e.invLife[i]; t = t < 0 ? 0 : (t > 1 ? 1 : t);
      var st = e.scaleCfg.ease ? e.scaleCfg.ease(t) : t, at = e.alphaCfg.ease ? e.alphaCfg.ease(t) : t;
      var scale = e.s0[i] + (e.s1[i] - e.s0[i]) * st, alpha = (e.a0[i] + (e.a1[i] - e.a0[i]) * at) * e.worldAlpha;
      if (alpha <= 0.002 || scale === 0) continue;
      var tex = e.frames[e.frame[i]] || e.frames[0];
      var color = rampN > 1 ? Color.ramp(ramp, e.colorEase ? e.colorEase(t) : t) : e.pTint[i];
      if (e.worldTint !== 0xffffff) color = Color.multiply(color, e.worldTint);
      var ang = e.angleAlign ? Math.atan2(e.vy[i], e.vx[i]) : e.rot[i] + (e.rotateCfg.end - e.rotateCfg.start) * DEG_TO_RAD * t;
      var co = Math.cos(ang) * scale, si = Math.sin(ang) * scale;
      var la = co, lb = si, lc = -si, ld = co, lx = e.px[i], ly = e.py[i];
      var m = _tmpMatrix;
      m.a = la * wt.a + lb * wt.c; m.b = la * wt.b + lb * wt.d; m.c = lc * wt.a + ld * wt.c; m.d = lc * wt.b + ld * wt.d;
      m.tx = lx * wt.a + ly * wt.c + wt.tx; m.ty = lx * wt.b + ly * wt.d + wt.ty;
      var hw = tex.width / 2, hh = tex.height / 2;
      if (this.cull) { var cx = m.tx, cy = m.ty, ex = (Math.abs(m.a) + Math.abs(m.c)) * Math.max(hw, hh); var cr = this.cullRect; if (cx + ex < cr.x || cx - ex > cr.x + cr.width || cy + ex < cr.y || cy - ex > cr.y + cr.height) continue; }
      ctx.globalAlpha = alpha;
      this._drawTex(tex, m, -hw, -hh, hw * 2, hh * 2, color, false, false);
    }
  }
  drawMesh(mesh) {
    var n = mesh.vertexCount; if (n < 3) return;
    var tex = mesh.texture, src = tex.source, img = this._drawable(src); if (!img) return;
    var ctx = this.ctx, idx = mesh._buildIndices(), v = mesh.vertices, uv = mesh._getAtlasUvs();
    this._style(mesh); this._setT(mesh.worldTransform);
    if (mesh.worldTint !== 0xffffff && tex !== Texture.WHITE) { var tc = this._tinted(src, 0, 0, src.width, src.height, mesh.worldTint); if (tc) img = tc; }
    var W = src.width, H = src.height, white = tex === Texture.WHITE;
    if (white) ctx.fillStyle = Color.toHex(mesh.worldTint);
    for (var i = 0; i < idx.length; i += 3) {
      var a = idx[i], b = idx[i + 1], c = idx[i + 2];
      var x0 = v[a * 2], y0 = v[a * 2 + 1], x1 = v[b * 2], y1 = v[b * 2 + 1], x2 = v[c * 2], y2 = v[c * 2 + 1];
      ctx.save(); ctx.beginPath();
      var cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3, ex = 0.6;
      var e0x = x0 + Math.sign(x0 - cx) * ex, e0y = y0 + Math.sign(y0 - cy) * ex, e1x = x1 + Math.sign(x1 - cx) * ex, e1y = y1 + Math.sign(y1 - cy) * ex, e2x = x2 + Math.sign(x2 - cx) * ex, e2y = y2 + Math.sign(y2 - cy) * ex;
      ctx.moveTo(e0x, e0y); ctx.lineTo(e1x, e1y); ctx.lineTo(e2x, e2y); ctx.closePath(); ctx.clip();
      if (white) { ctx.fill(); ctx.restore(); continue; }
      var u0 = uv[a * 2] * W, v0 = uv[a * 2 + 1] * H, u1 = uv[b * 2] * W, v1 = uv[b * 2 + 1] * H, u2 = uv[c * 2] * W, v2 = uv[c * 2 + 1] * H;
      var det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
      if (Math.abs(det) > 1e-9) {
        var ma = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det, mb = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det;
        var mc = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / det, md = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / det;
        var me = x0 - ma * u0 - mc * v0, mf = y0 - mb * u0 - md * v0;
        ctx.transform(ma, mb, mc, md, me, mf);
        ctx.drawImage(img, 0, 0);
      }
      ctx.restore();
    }
    this.stats.drawCalls++;
  }

  /* ---------- recorrido ---------- */
  _renderNode(obj, parent, force) {
    if (!obj.visible || obj.alpha <= 0 || (obj._isMask && !force)) return;
    if (obj.cameraFilter !== 0 && (obj.cameraFilter & this._camBit) !== 0) return;
    obj._updateTransform(parent);
    if (obj._filters !== null || obj._mask !== null || obj.clipRect !== null || obj.cacheAsTexture) { this._renderEffects(obj); return; }
    this._renderContent(obj);
  }
  _renderContent(obj) {
    if (obj.renderable) obj._renderCanvas(this);
    var ch = obj.children;
    if (ch.length) {
      if (obj.sortableChildren && obj._sortDirty) obj.sortChildren();
      for (var i = 0; i < ch.length; i++) this._renderNode(ch[i], obj);
    }
  }
  _cssFilters(obj) {
    var f = obj._filters; if (!f || !this.supportsFilters) return '';
    var s = '';
    for (var i = 0; i < f.length; i++) if (f[i] && f[i].enabled) { var c = f[i].canvasFilter(this); if (c) s += (s ? ' ' : '') + c; }
    return s;
  }
  /** cacheAsTexture real en Canvas2D: el contenido se dibuja una vez en un canvas propio y se reutiliza
   *  mientras no cambie (updateCacheTexture / cambio de resolución). */
  _ensureCache(obj) {
    var cache = obj._cache || (obj._cache = { dirty: true });
    var want = this.resolution * (obj.cacheResolution || 1), res = want;
    if (!cache.dirty && cache.canvas && cache.want === want) return cache;
    var saveWT = new Matrix().copyFrom(obj.worldTransform), sa = obj.worldAlpha, stt = obj.worldTint, sb = obj.worldBlend, saveCam = this._camBit;
    obj.worldTransform.identity(); obj.worldAlpha = 1; obj.worldTint = 0xffffff; obj.worldBlend = 0;
    var lb = new Bounds(); obj._accumBounds(lb); var ok = !lb.isEmpty;
    if (ok) {
      var lx = Math.floor(lb.minX) - 1, ly = Math.floor(lb.minY) - 1, lw = Math.ceil(lb.maxX) + 1 - lx, lh = Math.ceil(lb.maxY) + 1 - ly;
      var maxPx = 8190; if (lw * res > maxPx || lh * res > maxPx) res = Math.min(maxPx / lw, maxPx / lh);
      var pw = Math.max(1, Math.ceil(lw * res)), ph = Math.max(1, Math.ceil(lh * res));
      if (!cache.canvas) { cache.canvas = createCanvas(pw, ph); cache.ctx = cache.canvas.getContext('2d'); }
      else if (cache.canvas.width !== pw || cache.canvas.height !== ph) { cache.canvas.width = pw; cache.canvas.height = ph; }
      var cx = cache.ctx; cx.setTransform(1, 0, 0, 1, 0, 0); cx.globalAlpha = 1; cx.globalCompositeOperation = 'source-over'; cx.clearRect(0, 0, pw, ph);
      this._pushCtx(cx, cache.canvas, lx, ly, pw / res, ph / res, res);
      this._camBit = 0; this._renderContent(obj); this._camBit = saveCam;
      this._popCtx();
      cache.lb = { x: lx, y: ly, w: pw / res, h: ph / res }; cache.pw = pw; cache.ph = ph; cache.res = res; cache.want = want; cache.dirty = false;
    }
    obj.worldTransform.copyFrom(saveWT); obj.worldAlpha = sa; obj.worldTint = stt; obj.worldBlend = sb;
    return ok ? cache : null;
  }
  /** Dibuja la caché con la transformación, alfa y mezcla actuales del objeto */
  _drawCache(obj, cache) {
    var ctx = this.ctx, l = cache.lb;
    this._setT(obj.worldTransform);
    ctx.globalAlpha = obj.worldAlpha; ctx.globalCompositeOperation = CANVAS_BLEND[obj.worldBlend] || 'source-over';
    ctx.drawImage(cache.canvas, 0, 0, cache.pw, cache.ph, l.x, l.y, l.w, l.h);
    this.stats.drawCalls++;
  }
  _renderEffects(obj) {
    var ctx = this.ctx;
    var clip = obj.clipRect;
    var css = this._cssFilters(obj), mask = obj._mask;
    var cache = obj.cacheAsTexture ? this._ensureCache(obj) : null;
    if (obj.cacheAsTexture && !cache) return;
    if (cache && !css && !mask && !clip) { ctx.save(); this._drawCache(obj, cache); ctx.restore(); return; }
    if (!css && !mask && !obj.cacheAsTexture) {
      if (clip) {
        ctx.save(); this._setT(obj.worldTransform); ctx.beginPath(); ctx.rect(clip.x, clip.y, clip.width, clip.height); ctx.clip();
        this._renderContent(obj); ctx.restore();
      } else this._renderContent(obj);
      return;
    }
    var b = new Bounds(); obj._accumBounds(b);
    if (b.isEmpty) return;
    var pad = 0; if (obj._filters) for (var i = 0; i < obj._filters.length; i++) pad += obj._filters[i].padding || 0;
    var t = this.currentTarget;
    var rect = new Rectangle(Math.floor(b.minX - pad), Math.floor(b.minY - pad), 0, 0);
    rect.width = Math.ceil(b.maxX + pad) - rect.x; rect.height = Math.ceil(b.maxY + pad) - rect.y;
    rect.intersection(new Rectangle(t.x - pad, t.y - pad, t.w + pad * 2, t.h + pad * 2), rect);
    if (rect.width < 1 || rect.height < 1) return;
    var res = t.res, pw = Math.ceil(rect.width * res), ph = Math.ceil(rect.height * res);
    var off = this._getOffscreen(pw, ph);
    this._pushCtx(off.ctx, off.canvas, rect.x, rect.y, rect.width, rect.height, res);
    if (cache) { var sbb = obj.worldBlend; obj.worldBlend = 0; this._drawCache(obj, cache); obj.worldBlend = sbb; }
    else this._renderContent(obj);
    this._popCtx();
    if (mask) {
      var moff = this._getOffscreen(pw, ph);
      this._pushCtx(moff.ctx, moff.canvas, rect.x, rect.y, rect.width, rect.height, res);
      this._renderNode(mask, mask.parent || (this._camBit ? this._camParent : IDENTITY_PARENT), true);
      this._popCtx();
      off.ctx.setTransform(1, 0, 0, 1, 0, 0); off.ctx.globalAlpha = 1;
      off.ctx.globalCompositeOperation = obj.maskInvert ? 'destination-out' : 'destination-in';
      off.ctx.drawImage(moff.canvas, 0, 0);
      off.ctx.globalCompositeOperation = 'source-over';
      this._releaseOffscreen(moff);
    }
    ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = CANVAS_BLEND[obj.worldBlend] || 'source-over';
    if (css) ctx.filter = css;
    if (clip) { this._setT(obj.worldTransform); ctx.beginPath(); ctx.rect(clip.x, clip.y, clip.width, clip.height); ctx.clip(); ctx.setTransform(1, 0, 0, 1, 0, 0); }
    ctx.drawImage(off.canvas, 0, 0, pw, ph, (rect.x - t.x) * res, (rect.y - t.y) * res, pw, ph);
    ctx.restore();
    this._releaseOffscreen(off);
    this.stats.filters++;
  }
  renderScene(scene) {
    var cams = scene.cameras ? scene.cameras.list : null, main = scene.cameras ? scene.cameras.main : null;
    var ctx = this.ctx;
    if (cams) {
      for (var i = 0; i < cams.length; i++) {
        var cam = cams[i]; if (!cam.visible || cam.alpha <= 0) continue;
        cam.preRender(this);
        var cp = this._camParent; cp.worldTransform.copyFrom(cam.matrix); cp.worldAlpha = cam.alpha;
        RenderState.camScrollX = cam.scrollX; RenderState.camScrollY = cam.scrollY; this._camBit = cam.bit;
        ctx.save(); this._setT6(1, 0, 0, 1, 0, 0); ctx.beginPath(); ctx.rect(cam.x, cam.y, cam.width, cam.height); ctx.clip();
        var css = '';
        if (this.supportsFilters && cam.filters) for (var f = 0; f < cam.filters.length; f++) if (cam.filters[f].enabled) { var c = cam.filters[f].canvasFilter(this); if (c) css += (css ? ' ' : '') + c; }
        if (cam.backgroundColor !== null && cam.backgroundAlpha > 0) this.fillRect(cam.x, cam.y, cam.width, cam.height, cam.backgroundColor, cam.backgroundAlpha);
        if (css) {
          var res = this.resolution, pw = Math.ceil(cam.width * res), ph = Math.ceil(cam.height * res), off = this._getOffscreen(pw, ph);
          this._pushCtx(off.ctx, off.canvas, cam.x, cam.y, cam.width, cam.height, res);
          this._renderNode(scene.world, cp);
          this._popCtx();
          ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = css;
          ctx.drawImage(off.canvas, 0, 0, pw, ph, cam.x * res, cam.y * res, pw, ph);
          ctx.filter = 'none';
          this._releaseOffscreen(off);
        } else this._renderNode(scene.world, cp);
        if (cam !== main) cam.renderOverlays(this);
        ctx.restore();
      }
    } else this._renderNode(scene.world, IDENTITY_PARENT);
    RenderState.camScrollX = 0; RenderState.camScrollY = 0; this._camBit = 0;
    if (scene.hud && scene.hud.children.length) this._renderNode(scene.hud, IDENTITY_PARENT);
    if (main && main.visible) main.renderOverlays(this);
  }

  /* ---------- API pública ---------- */
  render(obj, options) {
    options = options || {};
    var rt = options.target || null, self = this;
    var wasInFrame = this._inFrame;
    if (!wasInFrame) { this._stack.length = 0; }
    if (rt) {
      var src = rt.source, cv = this._drawable(src), cx = src._rtCtx, res = src.resolution || 1;
      cx.setTransform(1, 0, 0, 1, 0, 0);
      if (options.clear !== false) {
        cx.clearRect(0, 0, cv.width, cv.height);
        // igual que en WebGL/WebGPU: clearColor rellena el destino (con clearAlpha, 1 por defecto)
        if (options.clearColor !== undefined) { cx.globalAlpha = options.clearAlpha !== undefined ? Math.max(0, Math.min(1, +options.clearAlpha)) : 1; cx.globalCompositeOperation = 'source-over'; cx.fillStyle = Color.toHex(Color.toNumber(options.clearColor)); cx.fillRect(0, 0, cv.width, cv.height); cx.globalAlpha = 1; }
      }
      this._pushCtx(cx, cv, 0, 0, cv.width / res, cv.height / res, res);
    } else if (!this._stack.length) this._pushCtx(this._mainCtx, this.canvas, 0, 0, this.width, this.height, this.resolution);
    var parent = IDENTITY_PARENT;
    if (options.transform) parent = { worldTransform: options.transform, worldAlpha: 1, worldTint: 0xffffff, worldBlend: 0 };
    else if (obj.parent) parent = { worldTransform: obj.parent.getWorldMatrix(new Matrix()), worldAlpha: 1, worldTint: 0xffffff, worldBlend: 0 };
    var sv = obj.visible; obj.visible = true;
    self._renderNode(obj, parent, true);
    obj.visible = sv;
    if (rt) { this._popCtx(); src.version++; src._canvasCache = null; }
    if (!wasInFrame) { this._stack.length = 0; this.ctx = this._mainCtx; }
  }
  generateTexture(obj, options) {
    options = options || {};
    var res = options.resolution || this.resolution, b = options.region || obj.getBounds(), pad = options.padding || 0;
    var w = Math.max(1, Math.ceil(b.width + pad * 2)), h = Math.max(1, Math.ceil(b.height + pad * 2));
    var rt = new RenderTexture(w, h, res);
    var pm = obj.parent ? obj.parent.getWorldMatrix(new Matrix()) : new Matrix();
    this.render(obj, { target: rt, transform: new Matrix(1, 0, 0, 1, -b.x + pad, -b.y + pad).append(pm) });
    return rt;
  }
  _extractPixels(target) {
    var rt = target, own = false;
    if (target instanceof Container) { rt = this.generateTexture(target); own = true; }
    var cv = this._drawable(rt.source);
    var data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
    var out = { width: cv.width, height: cv.height, data: data.data };
    if (own) rt.destroy();
    return out;
  }
  readScreenPixels(x, y, w, h) { var d = this._mainCtx.getImageData(x, y, w, h); return { width: w, height: h, data: d.data }; }
  destroy() {
    if (this.destroyed) return;
    this._tint.forEach(function (c) { releaseCanvas(c); });
    this._tint.clear(); this._tintBySrc.clear();
    for (var i = 0; i < this._offscreen.length; i++) releaseCanvas(this._offscreen[i].canvas);
    this._offscreen.length = 0;
    super.destroy();
    this.ctx = null; this._mainCtx = null; this.canvas = null;
  }
}

UG.CanvasRenderer = CanvasRenderer;
