/* UltraGame - base de renderizado compartida por WebGPU y WebGL:
 * batcher multi-textura, pila de destinos (render targets), pool de RTs, filtros, máscaras,
 * recorte (scissor), caché de contenedores, cámaras y extracción de píxeles. */

var FLOATS_PER_VERTEX = 6;           // x, y, u, v, color(u32), texSlot
var BYTES_PER_VERTEX = FLOATS_PER_VERTEX * 4;
var _globalBatchTick = 1;

/* ======================================================================= Batcher
 * Dos modos por lote:
 *  - QUAD (instanciado): 40 bytes por sprite (posición, ejes U/V, rect UV unorm16, color, textura).
 *    La GPU expande cada instancia a 4 vértices => ~2.7x menos ancho de banda y escrituras que 4 vértices+6 índices.
 *  - MESH (indexado): vértices arbitrarios (Graphics, Mesh, Rope, UV rotadas...).
 * Si un lote ya está en modo MESH, los quads siguientes se escriben como malla ("modo pegajoso") para no
 * romper el lote en escenas que intercalan sprites y gráficos. */
var INST_WORDS = 10, INST_BYTES = 40;
class Batcher {
  constructor(renderer, maxTextures, maxVerts, instancing) {
    this.renderer = renderer;
    this.maxTextures = Math.max(1, maxTextures | 0);
    this.maxVerts = Math.min(65532, maxVerts || 65532);
    this.maxIndices = this.maxVerts * 3;
    this.vBuffer = new ArrayBuffer(this.maxVerts * BYTES_PER_VERTEX);
    this.f32 = new Float32Array(this.vBuffer);
    this.u32 = new Uint32Array(this.vBuffer);
    this.iData = new Uint16Array(this.maxIndices);
    this.vCount = 0; this.iCount = 0;
    this.instancing = !!instancing;
    this.maxInst = 16384;
    this.instBuf = new ArrayBuffer(this.maxInst * INST_BYTES);
    this.if32 = new Float32Array(this.instBuf);
    this.iu32 = new Uint32Array(this.instBuf);
    this.instCount = 0;
    this.mode = 0;
    this.textures = new Array(this.maxTextures);
    this.texCount = 0;
    this.blend = 0;
    this.tick = _globalBatchTick++;
    this.quads = 0;
  }
  get isEmpty() { return this.iCount === 0 && this.instCount === 0; }
  flush() {
    if (this.iCount > 0 || this.instCount > 0) this.renderer._drawBatch(this);
    this.vCount = 0; this.iCount = 0; this.instCount = 0; this.mode = 0;
    for (var i = 0; i < this.texCount; i++) this.textures[i] = null;
    this.texCount = 0;
    this.tick = _globalBatchTick++;
  }
  _slot(src) {
    if (src._bTick === this.tick) return src._bSlot;
    if (this.texCount >= this.maxTextures) this.flush();
    src._bTick = this.tick; src._bSlot = this.texCount; this.textures[this.texCount++] = src;
    return src._bSlot;
  }
  /** Quad instanciado: esquina superior-izq (x,y), ejes U (x->) y V (y->) en mundo, rect UV y color premultiplicado. */
  pushInstance(src, x, y, ux, uy, vx, vy, u0, v0, u1, v1, color, blend) {
    if (!this.instancing || this.mode === 2) {
      this._quadMesh(src, x, y, x + ux, y + uy, x + ux + vx, y + uy + vy, x + vx, y + vy, u0, v0, u1, v0, u1, v1, u0, v1, color, blend);
      return;
    }
    if (blend !== this.blend) { if (this.mode !== 0) this.flush(); this.blend = blend; }
    if (this.instCount >= this.maxInst) this.flush();
    var slot = src._bTick === this.tick ? src._bSlot : this._slot(src);
    this.mode = 1;
    var o = this.instCount * INST_WORDS, f = this.if32, u = this.iu32;
    f[o] = x; f[o + 1] = y; f[o + 2] = ux; f[o + 3] = uy; f[o + 4] = vx; f[o + 5] = vy;
    u[o + 6] = ((((v0 * 65535 + 0.5) & 0xffff) << 16) | ((u0 * 65535 + 0.5) & 0xffff)) >>> 0;
    u[o + 7] = ((((v1 * 65535 + 0.5) & 0xffff) << 16) | ((u1 * 65535 + 0.5) & 0xffff)) >>> 0;
    u[o + 8] = color; f[o + 9] = slot;
    this.instCount++; this.quads++;
  }
  /** Quad con 4 vértices en mundo v[8] (TL,TR,BR,BL) y uvs[8]; se instancia si las UV forman un rectángulo. */
  pushQuad(src, v, uvs, color, blend) {
    var u0 = uvs[0], v0 = uvs[1], u1 = uvs[4], v1 = uvs[5];
    if (this.instancing && this.mode !== 2 && uvs[2] === u1 && uvs[3] === v0 && uvs[6] === u0 && uvs[7] === v1 &&
        u0 >= 0 && u0 <= 1 && u1 >= 0 && u1 <= 1 && v0 >= 0 && v0 <= 1 && v1 >= 0 && v1 <= 1) {
      this.pushInstance(src, v[0], v[1], v[2] - v[0], v[3] - v[1], v[6] - v[0], v[7] - v[1], u0, v0, u1, v1, color, blend);
      return;
    }
    this._quadMesh(src, v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], uvs[0], uvs[1], uvs[2], uvs[3], uvs[4], uvs[5], uvs[6], uvs[7], color, blend);
  }
  _quadMesh(src, x0, y0, x1, y1, x2, y2, x3, y3, a0, b0, a1, b1, a2, b2, a3, b3, color, blend) {
    if (blend !== this.blend) { if (this.mode !== 0) this.flush(); this.blend = blend; }
    if (this.mode === 1 || this.vCount + 4 > this.maxVerts) this.flush();
    var slot = this._slot(src);
    this.mode = 2;
    var f = this.f32, u = this.u32, o = this.vCount * 6;
    f[o] = x0; f[o + 1] = y0; f[o + 2] = a0; f[o + 3] = b0; u[o + 4] = color; f[o + 5] = slot;
    f[o + 6] = x1; f[o + 7] = y1; f[o + 8] = a1; f[o + 9] = b1; u[o + 10] = color; f[o + 11] = slot;
    f[o + 12] = x2; f[o + 13] = y2; f[o + 14] = a2; f[o + 15] = b2; u[o + 16] = color; f[o + 17] = slot;
    f[o + 18] = x3; f[o + 19] = y3; f[o + 20] = a3; f[o + 21] = b3; u[o + 22] = color; f[o + 23] = slot;
    var id = this.iData, io = this.iCount, b = this.vCount;
    id[io] = b; id[io + 1] = b + 1; id[io + 2] = b + 2; id[io + 3] = b; id[io + 4] = b + 2; id[io + 5] = b + 3;
    this.vCount += 4; this.iCount += 6; this.quads++;
  }
  /** Malla indexada con vértices locales transformados por m (o null si ya están en mundo). */
  pushMesh(src, verts, uvs, colors, indices, vCount, iCount, m, blend) {
    if (vCount > this.maxVerts || iCount > this.maxIndices) { this._pushLargeMesh(src, verts, uvs, colors, indices, iCount, m, blend); return; }
    if (blend !== this.blend) { if (this.mode !== 0) this.flush(); this.blend = blend; }
    if (this.mode === 1 || this.vCount + vCount > this.maxVerts || this.iCount + iCount > this.maxIndices) this.flush();
    var slot = this._slot(src);
    this.mode = 2;
    var f = this.f32, u = this.u32, o = this.vCount * 6, single = typeof colors === 'number';
    var a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0;
    if (m) { a = m.a; b = m.b; c = m.c; d = m.d; tx = m.tx; ty = m.ty; }
    for (var k = 0; k < vCount; k++) {
      var x = verts[k * 2], y = verts[k * 2 + 1];
      f[o] = a * x + c * y + tx; f[o + 1] = b * x + d * y + ty;
      if (uvs) { f[o + 2] = uvs[k * 2]; f[o + 3] = uvs[k * 2 + 1]; } else { f[o + 2] = 0.5; f[o + 3] = 0.5; }
      u[o + 4] = single ? colors : colors[k]; f[o + 5] = slot;
      o += 6;
    }
    var id = this.iData, io = this.iCount, base = this.vCount;
    for (var j = 0; j < iCount; j++) id[io + j] = indices[j] + base;
    this.vCount += vCount; this.iCount += iCount;
  }
  /** Mallas enormes (> 65k vértices): se expanden en trozos no indexados. */
  _pushLargeMesh(src, verts, uvs, colors, indices, iCount, m, blend) {
    var chunkTris = Math.floor(this.maxVerts / 3), single = typeof colors === 'number';
    var cv = new Float32Array(chunkTris * 6), cuv = uvs ? new Float32Array(chunkTris * 6) : null, cc = single ? colors : new Uint32Array(chunkTris * 3), ci = new Uint16Array(chunkTris * 3);
    for (var i = 0; i < ci.length; i++) ci[i] = i;
    for (var t = 0; t < iCount; t += chunkTris * 3) {
      var n = Math.min(chunkTris * 3, iCount - t);
      for (var k = 0; k < n; k++) {
        var vi = indices[t + k];
        cv[k * 2] = verts[vi * 2]; cv[k * 2 + 1] = verts[vi * 2 + 1];
        if (cuv) { cuv[k * 2] = uvs[vi * 2]; cuv[k * 2 + 1] = uvs[vi * 2 + 1]; }
        if (!single) cc[k] = colors[vi];
      }
      this.pushMesh(src, cv, cuv, cc, ci, n, n, m, blend);
    }
  }
}

/* ============================================================ RenderTargetPool */
class RenderTargetPool {
  constructor(renderer) { this.renderer = renderer; this.free = new Map(); this.frame = 0; this.created = 0; this.inUse = 0; }
  get(pw, ph) {
    var max = this.renderer.maxTextureSize || 4096;
    var w = Math.min(max, MathUtils.nextPowerOfTwo(Math.max(16, Math.ceil(pw))));
    var h = Math.min(max, MathUtils.nextPowerOfTwo(Math.max(16, Math.ceil(ph))));
    var key = w * 65536 + h;
    var list = this.free.get(key), rt = list && list.length ? list.pop() : null;
    if (!rt) { rt = new RenderTexture(w, h, 1, { label: 'pool' }); rt._poolKey = key; this.created++; }
    rt._lastUsed = this.frame;
    this.inUse++;
    return rt;
  }
  release(rt) {
    if (!rt || rt.destroyed) return;
    var list = this.free.get(rt._poolKey);
    if (!list) { list = []; this.free.set(rt._poolKey, list); }
    rt._lastUsed = this.frame;
    list.push(rt);
    this.inUse--;
  }
  gc() {
    this.frame++;
    if (this.frame % 120 !== 0) return;
    var frame = this.frame, self = this;
    this.free.forEach(function (list) {
      for (var i = list.length - 1; i >= 0; i--) {
        if (frame - list[i]._lastUsed > 600) { list[i].destroy(); list.splice(i, 1); self.created--; }
      }
    });
  }
  get size() { var n = 0; this.free.forEach(function (l) { n += l.length; }); return n; }
  clear() {
    this.free.forEach(function (list) { for (var i = 0; i < list.length; i++) list[i].destroy(); });
    this.free.clear(); this.created = 0;
  }
}

/* ======================================================================== Filter
 * Base de efectos de post-proceso. Un filtro define su shader en GLSL (WebGL) y WGSL (WebGPU)
 * como una función `filterMain(uv, coord)`, y opcionalmente un equivalente CSS para Canvas2D.
 * Parámetros: this.uniforms (8 vec4 -> uP[0..7] / u.p[0..7]). */
class Filter {
  constructor(options) {
    options = options || {};
    this.uid = uid();
    this.glsl = options.glsl || this.constructor.glsl || null;
    this.wgsl = options.wgsl || this.constructor.wgsl || null;
    this.key = options.key || this.constructor.key || ('custom:' + this.uid);
    this.uniforms = new Float32Array(32);
    this.padding = options.padding || 0;
    this.enabled = true;
    this.blendMode = null;
    this.twoInputs = !!(options.twoInputs || this.constructor.twoInputs);
    if (options.uniforms) this.uniforms.set(options.uniforms.slice(0, 32));
  }
  /** Asigna un parámetro por índice de componente (0..31) */
  setParam(i, v) { this.uniforms[i] = v; return this; }
  setEnabled(v) { this.enabled = v !== false; return this; }
  /** Aplica el filtro: input -> output (null = destino actual en rect). */
  apply(renderer, input, output, rect, blend) { renderer.filterPass(this, input, null, output, rect, blend); }
  /** Filtro CSS equivalente para el renderer Canvas2D ('' si no hay). */
  canvasFilter() { return ''; }
  update() {}
  destroy() { this.enabled = false; }
}
Filter.key = 'filter:base';

/** Pasada interna de mezcla para máscaras (alfa del segundo input). */
class MaskPass extends Filter {}
MaskPass.key = 'internal:mask';
MaskPass.twoInputs = true;
MaskPass.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec4 c = sampleTex(uv); float m = sampleTex2(uv).a; m = mix(m, 1.0 - m, uP[0].x); return c * m; }';
MaskPass.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let c = sampleTex(uv); var m = sampleTex2(uv).a; m = mix(m, 1.0 - m, u.p[0].x); return c * m; }';
/** Pasada de copia */
class CopyPass extends Filter {}
CopyPass.key = 'internal:copy';
CopyPass.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ return sampleTex(uv) * uP[0].x; }';
CopyPass.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { return sampleTex(uv) * u.p[0].x; }';

/* ================================================================= BaseRenderer */
class BaseRenderer extends EventEmitter {
  constructor(options) {
    super();
    this.uid = uid();
    this.type = 'base';
    this.options = options || {};
    this.canvas = null;
    this.width = this.options.width || 800;
    this.height = this.options.height || 600;
    this.resolution = this.options.resolution || 1;
    this.backgroundColor = this.options.backgroundColor !== undefined ? Color.toNumber(this.options.backgroundColor) : 0x000000;
    this.backgroundAlpha = this.options.transparent ? 0 : (this.options.backgroundAlpha !== undefined ? this.options.backgroundAlpha : 1);
    this.stats = { drawCalls: 0, quads: 0, culled: 0, filters: 0, targets: 0, textures: 0, frame: 0 };
    this.cull = this.options.cull !== false;
    this.cullRect = new Rectangle(0, 0, this.width, this.height);
    this.time = 0;
    this.contextLost = false;
    this.destroyed = false;
    this.maxTextureSize = 4096;
    this.supportsNPOTRepeat = true;
    this._camBit = 0;
    this._camParent = { worldTransform: new Matrix(), worldAlpha: 1, worldTint: 0xffffff, worldBlend: 0 };
    RendererRegistry.set(this.uid, this);
  }
  get pixelWidth() { return this.canvas ? this.canvas.width : Math.round(this.width * this.resolution); }
  get pixelHeight() { return this.canvas ? this.canvas.height : Math.round(this.height * this.resolution); }
  /** Cambia el tamaño lógico y la resolución (píxeles por unidad). */
  resize(width, height, resolution) {
    this.width = Math.max(1, width); this.height = Math.max(1, height);
    if (resolution) this.resolution = resolution;
    if (this.canvas) {
      var pw = Math.max(1, Math.round(this.width * this.resolution)), ph = Math.max(1, Math.round(this.height * this.resolution));
      if (this.canvas.width !== pw) this.canvas.width = pw;
      if (this.canvas.height !== ph) this.canvas.height = ph;
    }
    this._onResize();
    this.emit('resize', this.width, this.height, this.resolution);
  }
  _onResize() {}
  setBackgroundColor(c, alpha) { this.backgroundColor = Color.toNumber(c); if (alpha !== undefined) this.backgroundAlpha = alpha; return this; }
  freeSource() {}
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    RendererRegistry.delete(this.uid);
    this.off();
  }
}

/* ================================================================== GPURenderer */
class GPURenderer extends BaseRenderer {
  constructor(options) {
    super(options);
    this.batcher = null;
    this.pool = new RenderTargetPool(this);
    this._stack = [];
    this._scissorStack = [];
    this._proj = new Float32Array(4);
    this._inFrame = false;
    this._rtFlipY = false;
    this._effBoundsPool = [];
    var self = this;
    this.extract = {
      pixels: function (target) { return self._extractPixels(target); },
      canvas: function (target) { return self._extractPixels(target).then(pixelsToCanvas); },
      base64: function (target, type, quality) { return self._extractPixels(target).then(function (p) { return pixelsToCanvas(p).toDataURL(type || 'image/png', quality); }); }
    };
  }
  get currentTarget() { return this._stack[this._stack.length - 1] || null; }

  /* ---------- frame ---------- */
  beginFrame(clear, color, alpha) {
    if (this.contextLost || this.destroyed) return false;
    var s = this.stats; s.drawCalls = 0; s.quads = 0; s.culled = 0; s.filters = 0; s.targets = 0; s.frame++;
    if (this.batcher) this.batcher.quads = 0;
    this._inFrame = true;
    this._beginFrameBackend();
    this.pushTarget(null, 0, 0, this.width, this.height, clear !== false, color !== undefined ? color : this.backgroundColor, alpha !== undefined ? alpha : this.backgroundAlpha);
    return true;
  }
  endFrame() {
    if (!this._inFrame) return;
    this.batcher.flush();
    while (this._stack.length) this.popTarget();
    this.stats.quads = this.batcher.quads;
    this._endFrameBackend();
    this._inFrame = false;
    this.pool.gc();
  }
  /** Asegura un frame activo para renders fuera del bucle (renderToTexture en create(), extract...). */
  _withFrame(fn) {
    if (this._inFrame) return fn();
    this._inFrame = true;
    this._beginFrameBackend(true);
    var result;
    try { result = fn(); }
    finally {
      this.batcher.flush();
      while (this._stack.length) this.popTarget();
      this._endFrameBackend(true);
      this._inFrame = false;
    }
    return result;
  }

  /* ---------- destinos ---------- */
  pushTarget(rt, x, y, w, h, clear, color, alpha) {
    if (this.batcher) this.batcher.flush();
    var st = {
      rt: rt, x: x, y: y, w: w, h: h,
      res: rt ? this.resolution : this.resolution,
      pw: rt ? rt.source.width : this.pixelWidth, ph: rt ? rt.source.height : this.pixelHeight,
      flip: rt ? this._rtFlipY : true, scissor: null
    };
    if (rt && rt._targetRes) st.res = rt._targetRes;
    this._stack.push(st);
    this.stats.targets++;
    this._activateTarget(st, !!clear, color === undefined ? 0 : color, alpha === undefined ? 0 : alpha);
    return st;
  }
  popTarget() {
    if (this.batcher) this.batcher.flush();
    var st = this._stack.pop();
    var top = this._stack[this._stack.length - 1];
    if (top) this._activateTarget(top, false, 0, 0);
    return st;
  }
  _activateTarget(st, clear, color, alpha) {
    var sx = 2 * st.res / st.pw, sy = 2 * st.res / st.ph;
    var p = this._proj;
    p[0] = sx; p[2] = -st.x * sx - 1;
    if (st.flip) { p[1] = -sy; p[3] = st.y * sy + 1; } else { p[1] = sy; p[3] = -st.y * sy - 1; }
    this.cullRect.set(st.x, st.y, st.w, st.h);
    this._bindTarget(st, clear, color, alpha);
    this._applyScissor(st.scissor, st);
  }
  /** Rect lógico -> clip (x0,y0,x1,y1) con la proyección actual */
  _rectToClip(x, y, w, h, out) {
    var p = this._proj;
    out[0] = x * p[0] + p[2]; out[1] = y * p[1] + p[3];
    out[2] = (x + w) * p[0] + p[2]; out[3] = (y + h) * p[1] + p[3];
    return out;
  }
  /** Recorte rectangular en coordenadas lógicas del destino actual (se intersecta con el anterior). */
  pushScissor(x, y, w, h) {
    this.batcher.flush();
    var st = this.currentTarget;
    var px0 = Math.max(0, Math.floor((x - st.x) * st.res)), py0 = Math.max(0, Math.floor((y - st.y) * st.res));
    var px1 = Math.min(st.pw, Math.ceil((x + w - st.x) * st.res)), py1 = Math.min(st.ph, Math.ceil((y + h - st.y) * st.res));
    var prev = st.scissor;
    if (prev) { px0 = Math.max(px0, prev[0]); py0 = Math.max(py0, prev[1]); px1 = Math.min(px1, prev[0] + prev[2]); py1 = Math.min(py1, prev[1] + prev[3]); }
    this._scissorStack.push(prev);
    st.scissor = [px0, py0, Math.max(0, px1 - px0), Math.max(0, py1 - py0)];
    this._applyScissor(st.scissor, st);
  }
  popScissor() {
    this.batcher.flush();
    var st = this.currentTarget;
    st.scissor = this._scissorStack.pop() || null;
    this._applyScissor(st.scissor, st);
  }
  /** Rellena un rectángulo lógico con color sólido (fondos de cámara, flash, fade). */
  fillRect(x, y, w, h, color, alpha, blend) {
    if (alpha <= 0) return;
    QV[0] = x; QV[1] = y; QV[2] = x + w; QV[3] = y; QV[4] = x + w; QV[5] = y + h; QV[6] = x; QV[7] = y + h;
    this.batcher.pushQuad(Texture.WHITE.source, QV, Texture.WHITE.uvs, packColor(color, alpha), blend || 0);
  }

  /* ---------- recorrido ---------- */
  _renderNode(obj, parent, force) {
    if (!obj.visible || obj.alpha <= 0 || (obj._isMask && !force)) return;
    if (obj.cameraFilter !== 0 && (obj.cameraFilter & this._camBit) !== 0) return;
    obj._updateTransform(parent);
    if (obj._filters !== null || obj._mask !== null || obj.clipRect !== null || obj.cacheAsTexture) { this._renderEffects(obj); return; }
    if (obj.renderable) obj._renderGPU(this);
    var ch = obj.children;
    if (ch.length) {
      if (obj.sortableChildren && obj._sortDirty) obj.sortChildren();
      for (var i = 0; i < ch.length; i++) this._renderNode(ch[i], obj);
    }
  }
  _renderContent(obj) {
    if (obj.renderable) obj._renderGPU(this);
    var ch = obj.children;
    if (ch.length) {
      if (obj.sortableChildren && obj._sortDirty) obj.sortChildren();
      for (var i = 0; i < ch.length; i++) this._renderNode(ch[i], obj);
    }
  }
  _activeFilters(obj) {
    var f = obj._filters; if (!f) return null;
    var n = 0; for (var i = 0; i < f.length; i++) if (f[i] && f[i].enabled) n++;
    if (!n) return null;
    if (n === f.length) return f;
    return f.filter(function (x) { return x && x.enabled; });
  }
  _clipAABB(obj, out) {
    var c = obj.clipRect, b = _tmpBounds.reset();
    b.addRect(c.x, c.y, c.x + c.width, c.y + c.height, obj.worldTransform);
    return out.set(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
  }
  _renderEffects(obj) {
    if (obj.cacheAsTexture) { this._renderCached(obj); return; }
    var filters = this._activeFilters(obj), mask = obj._mask;
    var clip = obj.clipRect ? this._clipAABB(obj, new Rectangle()) : null;
    if (!filters && !mask) {
      if (clip) { this.pushScissor(clip.x, clip.y, clip.width, clip.height); this._renderContent(obj); this.popScissor(); }
      else this._renderContent(obj);
      return;
    }
    // Límites del contenido en coordenadas del destino actual
    var b = new Bounds();
    obj._accumBounds(b);
    if (mask) {
      var mb = new Bounds();
      mask._updateTransform(mask.parent || this._maskParent());
      mask._accumBounds(mb);
      if (!obj.maskInvert) { b.minX = Math.max(b.minX, mb.minX); b.minY = Math.max(b.minY, mb.minY); b.maxX = Math.min(b.maxX, mb.maxX); b.maxY = Math.min(b.maxY, mb.maxY); }
    }
    if (b.isEmpty) return;
    var pad = 0;
    if (filters) for (var i = 0; i < filters.length; i++) pad += filters[i].padding || 0;
    var rect = new Rectangle(Math.floor(b.minX - pad), Math.floor(b.minY - pad), 0, 0);
    rect.width = Math.ceil(b.maxX + pad) - rect.x; rect.height = Math.ceil(b.maxY + pad) - rect.y;
    var st = this.currentTarget;
    var view = new Rectangle(st.x - pad, st.y - pad, st.w + pad * 2, st.h + pad * 2);
    rect.intersection(view, rect);
    if (clip) rect.intersection(clip, rect);
    if (rect.width < 1 || rect.height < 1) return;
    var maxLogical = (this.maxTextureSize - 2) / this.resolution;
    if (rect.width > maxLogical) rect.width = maxLogical;
    if (rect.height > maxLogical) rect.height = maxLogical;
    var pw = Math.ceil(rect.width * this.resolution), ph = Math.ceil(rect.height * this.resolution);
    var input = this.pool.get(pw, ph);
    this.pushTarget(input, rect.x, rect.y, rect.width, rect.height, true, 0, 0);
    this._renderContent(obj);
    this.popTarget();
    var blend = obj.worldBlend;
    if (mask) {
      var mrt = this.pool.get(pw, ph);
      this.pushTarget(mrt, rect.x, rect.y, rect.width, rect.height, true, 0, 0);
      this._renderNode(mask, mask.parent || this._maskParent(), true);
      this.popTarget();
      var mp = this._maskPass || (this._maskPass = new MaskPass());
      mp.uniforms[0] = obj.maskInvert ? 1 : 0;
      if (!filters) {
        this.filterPass(mp, input, mrt, null, rect, blend);
        this.pool.release(input); this.pool.release(mrt);
        return;
      }
      var out0 = this.pool.get(pw, ph);
      this.filterPass(mp, input, mrt, out0, rect, 0);
      this.pool.release(input); this.pool.release(mrt);
      input = out0;
    }
    this._applyFilterChain(filters, input, rect, blend);
  }
  _maskParent() { return this._camBit ? this._camParent : IDENTITY_PARENT; }
  _applyFilterChain(filters, input, rect, blend) {
    var pw = Math.ceil(rect.width * this.resolution), ph = Math.ceil(rect.height * this.resolution);
    for (var i = 0; i < filters.length; i++) {
      var f = filters[i], last = i === filters.length - 1;
      this.stats.filters++;
      if (last) f.apply(this, input, null, rect, f.blendMode !== null ? resolveBlend(f.blendMode) : blend);
      else {
        var out = this.pool.get(pw, ph);
        f.apply(this, input, out, rect, 0);
        this.pool.release(input);
        input = out;
      }
    }
    this.pool.release(input);
  }
  /** RT temporal del tamaño de rect (para filtros multi-pasada). Liberar con releaseTempRT. */
  getTempRT(rect) { return this.pool.get(Math.ceil(rect.width * this.resolution), Math.ceil(rect.height * this.resolution)); }
  releaseTempRT(rt) { this.pool.release(rt); }
  /**
   * Ejecuta una pasada de filtro: lee input (y input2), escribe en output (RT, se limpia)
   * o, si output es null, en el destino actual dentro de rect con el modo de mezcla dado.
   */
  filterPass(filter, input, input2, output, rect, blend) {
    this.batcher.flush();
    var res = this.resolution;
    var fw = Math.ceil(rect.width * res), fh = Math.ceil(rect.height * res);
    var src = input.source, rtW = src.width, rtH = src.height;
    var u = this._filterUniforms || (this._filterUniforms = new Float32Array(52));
    if (output) this.pushTarget(output, rect.x, rect.y, rect.width, rect.height, true, 0, 0);
    this._rectToClip(rect.x, rect.y, fw / res, fh / res, u);
    u[4] = rtW; u[5] = rtH; u[6] = 1 / rtW; u[7] = 1 / rtH;
    u[8] = 0; u[9] = 0; u[10] = fw; u[11] = fh;
    u[12] = 0.5 / rtW; u[13] = 0.5 / rtH; u[14] = (fw - 0.5) / rtW; u[15] = (fh - 0.5) / rtH;
    u[16] = this.time / 1000; u[17] = res; u[18] = rect.x; u[19] = rect.y;
    u.set(filter.uniforms, 20);
    this._filterPassBackend(filter, input, input2 || input, u, output ? 0 : blend);
    this.stats.drawCalls++;
    if (output) this.popTarget();
  }
  _renderCached(obj) {
    var cache = obj._cache || (obj._cache = { rt: null, dirty: true, lb: null });
    var want = this.resolution * (obj.cacheResolution || 1), res = want;
    if (cache.dirty || !cache.rt || cache.want !== want) {
      var saveWT = new Matrix().copyFrom(obj.worldTransform), sa = obj.worldAlpha, stt = obj.worldTint, sb = obj.worldBlend;
      var saveCam = this._camBit;
      obj.worldTransform.identity(); obj.worldAlpha = 1; obj.worldTint = 0xffffff; obj.worldBlend = 0;
      var lb = new Bounds(); obj._accumBounds(lb);
      if (lb.isEmpty) { obj.worldTransform.copyFrom(saveWT); obj.worldAlpha = sa; obj.worldTint = stt; obj.worldBlend = sb; return; }
      var lx = Math.floor(lb.minX) - 1, ly = Math.floor(lb.minY) - 1, lw = Math.ceil(lb.maxX) + 1 - lx, lh = Math.ceil(lb.maxY) + 1 - ly;
      // objetos enormes (p.ej. una capa de tiles entera): baja la resolución de la caché para no pasar del máximo de la GPU
      var maxPx = (this.maxTextureSize || 4096) - 2;
      if (lw * res > maxPx || lh * res > maxPx) res = Math.min(maxPx / lw, maxPx / lh);
      if (!cache.rt) cache.rt = new RenderTexture(lw, lh, res, { label: 'cacheAsTexture', scaleMode: TextureSource.defaultScaleMode });
      else cache.rt.resize(lw, lh, res); // con la resolución nueva: si no, el tamaño lógico quedaría mal tras un resize
      cache.rt._targetRes = res;
      obj.worldTransform.set(1, 0, 0, 1, 0, 0);
      this.pushTarget(cache.rt, lx, ly, cache.rt.source.width / res, cache.rt.source.height / res, true, 0, 0);
      var saveFilters = obj._filters, saveMask = obj._mask, saveClip = obj.clipRect;
      this._camBit = 0;
      this._renderContent(obj);
      this._camBit = saveCam;
      this.popTarget();
      obj._filters = saveFilters; obj._mask = saveMask; obj.clipRect = saveClip;
      obj.worldTransform.copyFrom(saveWT); obj.worldAlpha = sa; obj.worldTint = stt; obj.worldBlend = sb;
      cache.lb = { x: lx, y: ly, w: cache.rt.source.width / res, h: cache.rt.source.height / res };
      cache.dirty = false; cache.res = res; cache.want = want;
    }
    var l = cache.lb, m = obj.worldTransform;
    var x0 = l.x, y0 = l.y, x1 = l.x + l.w, y1 = l.y + l.h;
    QV[0] = m.a * x0 + m.c * y0 + m.tx; QV[1] = m.b * x0 + m.d * y0 + m.ty;
    QV[2] = m.a * x1 + m.c * y0 + m.tx; QV[3] = m.b * x1 + m.d * y0 + m.ty;
    QV[4] = m.a * x1 + m.c * y1 + m.tx; QV[5] = m.b * x1 + m.d * y1 + m.ty;
    QV[6] = m.a * x0 + m.c * y1 + m.tx; QV[7] = m.b * x0 + m.d * y1 + m.ty;
    var filters = this._activeFilters(obj);
    if (!filters) {
      this.batcher.pushQuad(cache.rt.source, QV, cache.rt.uvs, packColor(obj.worldTint, obj.worldAlpha), obj.worldBlend);
      return;
    }
    // Caché + filtros: se usa el sprite cacheado como contenido de la cadena de filtros
    var b = _tmpBounds.reset(); b.addQuad(QV);
    var pad = 0; for (var i = 0; i < filters.length; i++) pad += filters[i].padding || 0;
    var st = this.currentTarget;
    var rect = new Rectangle(Math.floor(b.minX - pad), Math.floor(b.minY - pad), 0, 0);
    rect.width = Math.ceil(b.maxX + pad) - rect.x; rect.height = Math.ceil(b.maxY + pad) - rect.y;
    rect.intersection(new Rectangle(st.x - pad, st.y - pad, st.w + pad * 2, st.h + pad * 2), rect);
    if (rect.width < 1 || rect.height < 1) return;
    var input = this.getTempRT(rect);
    this.pushTarget(input, rect.x, rect.y, rect.width, rect.height, true, 0, 0);
    this.batcher.pushQuad(cache.rt.source, QV, cache.rt.uvs, packColor(obj.worldTint, obj.worldAlpha), 0);
    this.popTarget();
    this._applyFilterChain(filters, input, rect, obj.worldBlend);
  }

  /* ---------- API pública de render ---------- */
  /** Renderiza un objeto (con su subárbol) en el destino actual o en una RenderTexture. */
  render(obj, options) {
    options = options || {};
    var self = this;
    return this._withFrame(function () {
      var rt = options.target || options.renderTexture || null;
      if (rt) {
        var res = rt.source.resolution || 1;
        rt._targetRes = res;
        self.pushTarget(rt, 0, 0, rt.source.width / res, rt.source.height / res, options.clear !== false, options.clearColor || 0, options.clearColor !== undefined ? (options.clearAlpha !== undefined ? options.clearAlpha : 1) : 0);
      }
      var parent = IDENTITY_PARENT;
      if (options.transform) parent = { worldTransform: options.transform, worldAlpha: 1, worldTint: 0xffffff, worldBlend: 0 };
      else if (obj.parent && options.useParentTransform !== false) parent = { worldTransform: obj.parent.getWorldMatrix(new Matrix()), worldAlpha: 1, worldTint: 0xffffff, worldBlend: 0 };
      var saveVisible = obj.visible; obj.visible = true;
      var saveMask = obj._isMask;
      self._renderNode(obj, parent, true);
      obj.visible = saveVisible; obj._isMask = saveMask;
      if (rt) self.popTarget();
    });
  }
  /** Crea una RenderTexture con el contenido de obj (recortado a sus límites). */
  generateTexture(obj, options) {
    options = options || {};
    var res = options.resolution || this.resolution;
    var b = options.region || obj.getBounds();
    var pad = options.padding || 0;
    var w = Math.max(1, Math.ceil(b.width + pad * 2)), h = Math.max(1, Math.ceil(b.height + pad * 2));
    var rt = new RenderTexture(w, h, res, { scaleMode: options.scaleMode });
    var pm = obj.parent ? obj.parent.getWorldMatrix(new Matrix()) : new Matrix();
    var m = new Matrix(1, 0, 0, 1, -b.x + pad, -b.y + pad).append(pm);
    this.render(obj, { target: rt, transform: m, clear: true });
    return rt;
  }
  _extractPixels(target) {
    var self = this;
    var rt = null, own = false;
    if (target instanceof RenderTexture) rt = target;
    else if (target instanceof Container) { rt = this.generateTexture(target); own = true; }
    else if (target && target.source && target.source.isRenderTarget) rt = target;
    if (!rt) return Promise.reject(new Error('extract: se requiere un objeto de escena o RenderTexture'));
    return Promise.resolve(this._readTarget(rt)).then(function (px) {
      if (own) rt.destroy();
      unpremultiply(px.data);
      return px;
    }, function (e) { if (own) rt.destroy(); throw e; });
  }

  /* ---------- cámaras / escenas ---------- */
  renderScene(scene) {
    var cams = scene.cameras ? scene.cameras.list : null;
    var main = scene.cameras ? scene.cameras.main : null;
    if (cams) {
      for (var i = 0; i < cams.length; i++) {
        var cam = cams[i];
        if (!cam.visible || cam.alpha <= 0) continue;
        this._renderCamera(scene, cam, cam !== main);
      }
    } else this._renderNode(scene.world, IDENTITY_PARENT);
    RenderState.camScrollX = 0; RenderState.camScrollY = 0; this._camBit = 0;
    if (scene.hud && scene.hud.children.length) this._renderNode(scene.hud, IDENTITY_PARENT);
    if (main && main.visible) main.renderOverlays(this);
  }
  _renderCamera(scene, cam, drawOverlays) {
    cam.preRender(this);
    var vx = cam.x, vy = cam.y, vw = cam.width, vh = cam.height;
    var cp = this._camParent;
    cp.worldTransform.copyFrom(cam.matrix); cp.worldAlpha = cam.alpha; cp.worldTint = 0xffffff; cp.worldBlend = 0;
    RenderState.camScrollX = cam.scrollX; RenderState.camScrollY = cam.scrollY;
    this._camBit = cam.bit;
    var filters = cam.filters && cam.filters.length ? cam.filters.filter(function (f) { return f && f.enabled; }) : null;
    if (filters && !filters.length) filters = null;
    var full = vx <= 0 && vy <= 0 && vx + vw >= this.width && vy + vh >= this.height;
    var rect = null, input = null;
    if (filters) {
      rect = new Rectangle(vx, vy, vw, vh).intersection(new Rectangle(0, 0, this.width, this.height));
      if (rect.width < 1 || rect.height < 1) return;
      input = this.getTempRT(rect);
      this.pushTarget(input, rect.x, rect.y, rect.width, rect.height, true, 0, 0);
    } else if (!full) this.pushScissor(vx, vy, vw, vh);
    if (cam.backgroundColor !== null && cam.backgroundAlpha > 0) this.fillRect(vx, vy, vw, vh, cam.backgroundColor, cam.backgroundAlpha);
    cam._rendered = 0;
    this._renderNode(scene.world, cp);
    if (drawOverlays) cam.renderOverlays(this);
    if (filters) { this.popTarget(); this._applyFilterChain(filters, input, rect, 0); }
    else if (!full) this.popScissor();
  }
  destroy() {
    if (this.destroyed) return;
    this.pool.clear();
    super.destroy();
  }
}

function unpremultiply(d) {
  for (var i = 0; i < d.length; i += 4) {
    var a = d[i + 3];
    if (a > 0 && a < 255) { var f = 255 / a; d[i] = Math.min(255, d[i] * f + 0.5); d[i + 1] = Math.min(255, d[i + 1] * f + 0.5); d[i + 2] = Math.min(255, d[i + 2] * f + 0.5); }
  }
  return d;
}
function pixelsToCanvas(px) {
  var c = createCanvas(px.width, px.height), ctx = c.getContext('2d');
  var img = ctx.createImageData(px.width, px.height);
  img.data.set(px.data);
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Detección de capacidades para elegir backend. */
var Capabilities = {
  webgpu: function () { return !!(GLOBAL.navigator && GLOBAL.navigator.gpu); },
  webgl2: function () { try { var c = createCanvas(1, 1); var ok = !!c.getContext('webgl2'); return ok; } catch (e) { return false; } },
  webgl: function () { try { var c = createCanvas(1, 1); return !!(c.getContext('webgl') || c.getContext('experimental-webgl')); } catch (e) { return false; } },
  canvas: function () { return HAS_DOM || typeof OffscreenCanvas !== 'undefined'; }
};

UG.Batcher = Batcher;
UG.RenderTargetPool = RenderTargetPool;
UG.Filter = Filter;
UG.GPURenderer = GPURenderer;
UG.BaseRenderer = BaseRenderer;
UG.Capabilities = Capabilities;
UG.RendererRegistry = RendererRegistry;
