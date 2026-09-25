/* UltraGame 3D - backend WebGPU.
 * Se integra en la "codificación diferida" del renderizador 2D: cada View3D graba un comando (t = 6) que,
 * al enviar el frame, cierra la pasada 2D en curso, codifica sus pasadas 3D (sombra + principal con MSAA)
 * y reabre la pasada 2D con loadOp 'load'. Uniformes en un anillo con offsets dinámicos (bloques de 256 B),
 * subido con un único writeBuffer por frame. Texturas propias con mipmaps generados en GPU. */

var WGSL_MIP = '@group(0) @binding(0) var t: texture_2d<f32>; @group(0) @binding(1) var s: sampler;\n' +
  'struct VO { @builtin(position) p: vec4f, @location(0) uv: vec2f };\n' +
  '@vertex fn vs(@builtin(vertex_index) i: u32) -> VO { var P = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0)); var o: VO; let q = P[i]; o.p = vec4f(q, 0.0, 1.0); o.uv = vec2f(q.x * 0.5 + 0.5, 0.5 - q.y * 0.5); return o; }\n' +
  '@fragment fn fs(v: VO) -> @location(0) vec4f { return textureSampleLevel(t, s, v.uv, 0.0); }\n';
var GPU3D_BLEND = {
  normal: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } },
  add: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } },
  multiply: { color: { srcFactor: 'dst', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } }
};
var GPU3D_ATTR_NAMES = ['position', 'normal', 'uv', 'color', 'joints', 'weights'];

class WebGPU3D extends Renderer3D {
  constructor(r) {
    super(r);
    this.flipY = false;
    this._dev = -1;
    this._geoms = new Set(); this._views = new Set(); this._insts = new Set(); this._skinBufs = new Map(); this._tex = new Map();
    this._shadow = null; this._tick = 0;
    this._setup();
  }
  _setup() {
    var r = this.r, dev = r.device, self = this, GS = GLOBAL.GPUShaderStage, TU = GLOBAL.GPUTextureUsage;
    // dispositivo nuevo (o recuperado): todo lo anterior dejó de existir; solo se olvida y se cuadran contadores
    this._geoms.forEach(function (g) { if (g._gpu[self.uid]) { delete g._gpu[self.uid]; Debug.track('GPUBuffer3D', -1); } }); this._geoms.clear();
    this._views.forEach(function (v) { if (v._gpu3) { v._gpu3 = null; Debug.track('GPUTarget3D', -1); } }); this._views.clear();
    this._insts.forEach(function (m) { if (m._gpuInst && m._gpuInst[self.uid]) { delete m._gpuInst[self.uid]; Debug.track('GPUBuffer3D', -1); } }); this._insts.clear();
    this._skinBufs.forEach(function () { Debug.track('GPUBuffer3D', -1); }); this._skinBufs.clear();
    this._tex.forEach(function (e, src) { delete src._gpu[self.uid]; Debug.track('GPUTexture3D', -1); }); this._tex.clear();
    if (this._shadow) { this._shadow = null; Debug.track('GPUTexture3D', -1); }
    this._dev = r._devVersion; this.device = dev;
    this.setLimits(4, 8, 4);
    this.shadowsSupported = true;
    var L = this.L;
    this._frameBGL = dev.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GS.VERTEX | GS.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: L.NF * 16 } },
      { binding: 1, visibility: GS.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: GS.FRAGMENT, sampler: { type: 'comparison' } }] });
    var me = [{ binding: 0, visibility: GS.VERTEX | GS.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 96 } }];
    for (var i = 0; i < 5; i++) { me.push({ binding: 1 + i * 2, visibility: GS.FRAGMENT, texture: { sampleType: 'float' } }); me.push({ binding: 2 + i * 2, visibility: GS.FRAGMENT, sampler: { type: 'filtering' } }); }
    this._matBGL = dev.createBindGroupLayout({ entries: me });
    this._objBGL = dev.createBindGroupLayout({ entries: [{ binding: 0, visibility: GS.VERTEX, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 128 } }] });
    this._objSkinBGL = dev.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GS.VERTEX, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 128 } },
      { binding: 1, visibility: GS.VERTEX, buffer: { type: 'read-only-storage' } }] });
    this._layout = dev.createPipelineLayout({ bindGroupLayouts: [this._frameBGL, this._matBGL, this._objBGL] });
    this._layoutSkin = dev.createPipelineLayout({ bindGroupLayouts: [this._frameBGL, this._matBGL, this._objSkinBGL] });
    this._skyBGL = dev.createBindGroupLayout({ entries: [{ binding: 0, visibility: GS.VERTEX | GS.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 224 } }] });
    this._skyLayout = dev.createPipelineLayout({ bindGroupLayouts: [this._skyBGL] });
    this._skyModule = dev.createShaderModule({ code: wgslSky(), label: 'ug3d-sky' }); r._checkModule(this._skyModule, 'sky3d');
    this._mipModule = null; this._mipPipe = null; this._mipBGL = null;
    this._modules = new Map(); this._pipes = new Map(); this._samplers = new Map();
    this._bgMat = new Map(); this._bgFrame = new Map(); this._bgSkin = new Map(); this._bgObj = null; this._bgSky = null;
    this._u = new Float32Array(64 * 256); this._uUsed = 0; this._uBuf = null; this._uBufSize = 0; this._uGen = 0;
    this._white = dev.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: TU.TEXTURE_BINDING | TU.COPY_DST, label: 'ug3d-white' });
    dev.queue.writeTexture({ texture: this._white }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, { width: 1, height: 1 });
    this._whiteView = this._white.createView();
    this._dummyDepth = dev.createTexture({ size: [1, 1], format: 'depth32float', usage: TU.TEXTURE_BINDING | TU.RENDER_ATTACHMENT, label: 'ug3d-nodepth' });
    this._dummyDepthView = this._dummyDepth.createView();
    this._cmpSampler = dev.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this._job = null;
  }
  _check() { if (this._dev !== this.r._devVersion) this._setup(); }
  /* ---------- anillo de uniformes ---------- */
  _alloc(floats) {
    var blocks = Math.ceil(floats / 64), b = this._uUsed;
    this._uUsed += blocks;
    if (this._uUsed * 64 > this._u.length) { var n = new Float32Array(MathUtils.nextPowerOfTwo(this._uUsed * 64)); n.set(this._u.subarray(0, b * 64)); this._u = n; }
    return b;
  }
  _put(data, n) { var b = this._alloc(n || data.length); if (n && n < data.length) this._u.set(data.subarray(0, n), b * 64); else this._u.set(data, b * 64); return b; }
  /** Sube los uniformes del frame (llamado por WebGPURenderer._submit antes de codificar) */
  _flush() {
    if (!this._uUsed || this._dev !== this.r._devVersion) return;
    var bytes = this._uUsed * 256;
    if (!this._uBuf || this._uBufSize < bytes) {
      if (this._uBuf) this.r._pending.push(this._uBuf); else Debug.track('GPUBuffer3D', 1);
      this._uBufSize = MathUtils.nextPowerOfTwo(Math.max(bytes, 1 << 16));
      this._uBuf = this.device.createBuffer({ size: this._uBufSize, usage: GLOBAL.GPUBufferUsage.UNIFORM | GLOBAL.GPUBufferUsage.COPY_DST, label: 'ug3d-uniforms' });
      this._uGen++; this._bgMat.clear(); this._bgFrame.clear(); this._bgSkin.clear(); this._bgObj = null; this._bgSky = null;
    }
    this.device.queue.writeBuffer(this._uBuf, 0, this._u.buffer, 0, bytes);
  }
  _afterSubmit() {
    this._uUsed = 0;
    // esqueletos que ya no se dibujan: se libera su buffer (evita retener modelos destruidos)
    if ((++this._tick & 127) === 0) { var self = this, t = this._tick; this._skinBufs.forEach(function (e, sk) { if (t - e.used > 240) self.freeSkeleton(sk); }); }
  }
  /* ---------- recursos ---------- */
  _geometry(g) {
    var d = g._gpu[this.uid], dev = this.device, BU = GLOBAL.GPUBufferUsage, r = this.r;
    if (d && d.version === g.version && d.attrVer === attrVersionSum(g)) return d;
    ensureBasicAttributes(g);
    if (!d) { d = g._gpu[this.uid] = { bufs: {}, ibuf: null, ibufSize: 0, version: -1, attrVer: -1, idxSrc: null, idxVer: -1, count: 0, idxFormat: null }; this._geoms.add(g); g._revive(); Debug.track('GPUBuffer3D', 1); }
    for (var i = 0; i < GPU3D_ATTR_NAMES.length; i++) {
      var nm = GPU3D_ATTR_NAMES[i], a = g.attributes[nm], b = d.bufs[nm];
      if (!a) { if (b) { r._pending.push(b.buf); delete d.bufs[nm]; } continue; }
      var data = a.data instanceof Float32Array ? a.data : new Float32Array(a.data), bytes = Math.max(16, data.byteLength);
      if (!b || b.cap < bytes) { if (b) r._pending.push(b.buf); b = d.bufs[nm] = { buf: dev.createBuffer({ size: bytes, usage: BU.VERTEX | BU.COPY_DST, label: 'ug3d-' + nm }), cap: bytes, ver: -1, src: null, len: -1 }; }
      if (b.ver !== a.version || b.src !== a.data || b.len !== data.length) { if (data.byteLength) dev.queue.writeBuffer(b.buf, 0, data); b.ver = a.version; b.src = a.data; b.len = data.length; }
      b.size = a.size;
    }
    if (g.index) {
      var idx = g.index, u32 = idx instanceof Uint32Array;
      if (d.idxSrc !== idx || d.idxVer !== g.version) {
        var up = idx;
        if (!u32 && (idx.length & 1)) { up = new Uint16Array(idx.length + 1); up.set(idx); } // writeBuffer exige múltiplos de 4 bytes
        var ib = Math.max(16, up.byteLength);
        if (!d.ibuf || d.ibufSize < ib) { if (d.ibuf) r._pending.push(d.ibuf); d.ibuf = dev.createBuffer({ size: ib, usage: BU.INDEX | BU.COPY_DST, label: 'ug3d-index' }); d.ibufSize = ib; }
        if (up.byteLength) dev.queue.writeBuffer(d.ibuf, 0, up);
        d.idxSrc = idx; d.idxVer = g.version;
      }
      d.idxFormat = u32 ? 'uint32' : 'uint16'; d.count = idx.length;
    } else { if (d.ibuf) { r._pending.push(d.ibuf); d.ibuf = null; d.ibufSize = 0; d.idxSrc = null; } d.idxFormat = null; d.count = g.vertexCount; }
    d.version = g.version; d.attrVer = attrVersionSum(g);
    return d;
  }
  freeGeometry(g) {
    var d = g._gpu[this.uid]; if (!d) return;
    for (var k in d.bufs) this.r._pending.push(d.bufs[k].buf);
    if (d.ibuf) this.r._pending.push(d.ibuf);
    if (!this.r._inFrame) this.r._flushPending();
    delete g._gpu[this.uid]; this._geoms.delete(g); Debug.track('GPUBuffer3D', -1);
  }
  _instBuffer(mesh) {
    var all = mesh._gpuInst || (mesh._gpuInst = {}), ib = all[this.uid], dev = this.device;
    var n = mesh.capacity, bytes = n * 80;
    if (!ib) {
      ib = all[this.uid] = { buf: null, cap: 0, ver: -1, data: null };
      this._insts.add(mesh); Debug.track('GPUBuffer3D', 1);
      if (!mesh._gpuInstHook) {
        mesh._gpuInstHook = true;
        mesh.once('destroy', function () { var reg = mesh._gpuInst; mesh._gpuInst = null; for (var rid in reg) { var R = RendererRegistry.get(+rid); if (R && R._freeInst) R._freeInst(mesh, reg[rid]); } });
      }
    }
    if (ib.cap < bytes) { if (ib.buf) this.r._pending.push(ib.buf); ib.buf = dev.createBuffer({ size: bytes, usage: GLOBAL.GPUBufferUsage.VERTEX | GLOBAL.GPUBufferUsage.COPY_DST, label: 'ug3d-instances' }); ib.cap = bytes; ib.ver = -1; }
    if (ib.ver !== mesh.instanceVersion) {
      if (!ib.data || ib.data.length !== n * 20) ib.data = new Float32Array(n * 20);
      var data = ib.data, m = mesh.instanceMatrix, c = mesh.instanceColor;
      for (var i = 0; i < n; i++) { var o = i * 20, s = i * 16; for (var j = 0; j < 16; j++) data[o + j] = m[s + j]; data[o + 16] = c[i * 4]; data[o + 17] = c[i * 4 + 1]; data[o + 18] = c[i * 4 + 2]; data[o + 19] = c[i * 4 + 3]; }
      dev.queue.writeBuffer(ib.buf, 0, data);
      ib.ver = mesh.instanceVersion;
    }
    return ib;
  }
  _freeInst(mesh, ib) {
    if (!this._insts.has(mesh)) return;
    this._insts.delete(mesh);
    if (ib.buf) { this.r._pending.push(ib.buf); if (!this.r._inFrame) this.r._flushPending(); }
    Debug.track('GPUBuffer3D', -1);
  }
  _skinBuffer(skel) {
    var e = this._skinBufs.get(skel), bytes = Math.max(64, skel.count * 64);
    if (!e) { e = { buf: null, cap: 0, ver: -1, used: 0 }; this._skinBufs.set(skel, e); Debug.track('GPUBuffer3D', 1); if (skel._gpu) skel._gpu[this.uid] = 1; }
    if (e.cap < bytes) { if (e.buf) this.r._pending.push(e.buf); e.buf = this.device.createBuffer({ size: bytes, usage: GLOBAL.GPUBufferUsage.STORAGE | GLOBAL.GPUBufferUsage.COPY_DST, label: 'ug3d-joints' }); e.cap = bytes; e.ver = -1; this._bgSkin.delete(skel); }
    if (e.ver !== skel.version) { this.device.queue.writeBuffer(e.buf, 0, skel.jointMatrices); e.ver = skel.version; }
    e.used = this._tick;
    return e;
  }
  freeSkeleton(skel) {
    var e = this._skinBufs.get(skel); if (!e) return;
    if (e.buf) this.r._pending.push(e.buf);
    this._skinBufs.delete(skel); this._bgSkin.delete(skel); Debug.track('GPUBuffer3D', -1);
    if (skel._gpu) delete skel._gpu[this.uid];
  }
  /* ---------- texturas (con mipmaps) ---------- */
  _sampler(nearest, repeat, mips) {
    var key = (nearest ? 'n' : 'l') + (repeat ? 'r' : 'c') + (mips ? 'm' : ''), s = this._samplers.get(key);
    if (!s) {
      var f = nearest ? 'nearest' : 'linear', am = repeat ? 'repeat' : 'clamp-to-edge';
      var desc = { magFilter: f, minFilter: f, mipmapFilter: mips ? (nearest ? 'nearest' : 'linear') : 'nearest', addressModeU: am, addressModeV: am };
      if (mips && !nearest) desc.maxAnisotropy = 8;
      s = this.device.createSampler(desc); this._samplers.set(key, s);
    }
    return s;
  }
  /** Devuelve {view, sampler, id} para una textura de material */
  _texRes(tex, m, view) {
    if (!tex || !tex.source || tex.source.destroyed) return null;
    var src = tex.source;
    if (view && view.rt && src === view.rt.source) return null; // nunca leer el destino actual
    var repeat = (src.wrapMode === 'repeat' || (tex.isFullSource && this._tiles(m))), nearest = src.scaleMode === 'nearest';
    if (src.isRenderTarget || src.dynamic || src.isVideo || !src.resource) {
      var d = this.r._ensureTexture(src);
      return { view: d.view, sampler: this._sampler(nearest, repeat, false), id: 'r' + d.id + (repeat ? 'r' : '') + (nearest ? 'n' : '') };
    }
    var e = this._tex.get(src);
    if (!e || e.version !== src.version) e = this._upload(src, e);
    if (!e) return null;
    return { view: e.view, sampler: this._sampler(nearest, repeat, e.levels > 1), id: 't' + e.id + (repeat ? 'r' : '') + (nearest ? 'n' : '') };
  }
  _upload(src, e) {
    var dev = this.device, TU = GLOBAL.GPUTextureUsage, res = src.resource, w, h, upl = res, scaled = false;
    if (res.data) { w = res.width; h = res.height; } else { w = src.width; h = src.height; }
    var max = this.r.maxTextureSize || 8192;
    if (!res.data && (w > max || h > max)) {
      var sc = Math.min(max / w, max / h), cv = createCanvas(Math.floor(w * sc), Math.floor(h * sc));
      cv.getContext('2d').drawImage(res, 0, 0, cv.width, cv.height); upl = cv; w = cv.width; h = cv.height; scaled = true;
    }
    var levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    if (!e) { e = { tex: null, view: null, version: -1, w: 0, h: 0, levels: 1, id: 0 }; this._tex.set(src, e); src._gpu[this.uid] = e; Debug.track('GPUTexture3D', 1); }
    if (!e.tex || e.w !== w || e.h !== h) {
      if (e.tex) this.r._pending.push(e.tex);
      e.tex = dev.createTexture({ size: [w, h], format: 'rgba8unorm', mipLevelCount: levels, usage: TU.TEXTURE_BINDING | TU.COPY_DST | TU.RENDER_ATTACHMENT, label: src.label || 'ug3d-texture' });
      e.view = e.tex.createView(); e.w = w; e.h = h; e.levels = levels; e.id = ++_gpuTexId;
      this._bgMat.clear();
    }
    try {
      if (res.data) {
        var data = res.data instanceof Uint8Array ? res.data : new Uint8Array(res.data.buffer || res.data);
        if (!src.premultiplied) { data = new Uint8Array(data); for (var i = 0; i < data.length; i += 4) { var a = data[i + 3] / 255; data[i] = data[i] * a + 0.5; data[i + 1] = data[i + 1] * a + 0.5; data[i + 2] = data[i + 2] * a + 0.5; } }
        dev.queue.writeTexture({ texture: e.tex }, data, { bytesPerRow: w * 4, rowsPerImage: h }, { width: w, height: h });
      } else {
        try { dev.queue.copyExternalImageToTexture({ source: upl }, { texture: e.tex, premultipliedAlpha: true }, { width: w, height: h }); }
        catch (e1) { var c2 = createCanvas(w, h); c2.getContext('2d').drawImage(upl, 0, 0, w, h); dev.queue.copyExternalImageToTexture({ source: c2 }, { texture: e.tex, premultipliedAlpha: true }, { width: w, height: h }); releaseCanvas(c2); }
      }
      if (levels > 1) this._genMips(e.tex, levels);
    } catch (err) {
      Log.warnOnce('upload3d:' + src.uid, 'No se pudo subir la textura 3D a WebGPU (¿CORS?):', err && err.message);
    }
    if (scaled) releaseCanvas(upl);
    e.version = src.version;
    return e;
  }
  _genMips(tex, levels) {
    var dev = this.device;
    if (!this._mipPipe) {
      this._mipModule = dev.createShaderModule({ code: WGSL_MIP, label: 'ug3d-mip' });
      this._mipBGL = dev.createBindGroupLayout({ entries: [{ binding: 0, visibility: GLOBAL.GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }, { binding: 1, visibility: GLOBAL.GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }] });
      this._mipPipe = dev.createRenderPipeline({ layout: dev.createPipelineLayout({ bindGroupLayouts: [this._mipBGL] }), vertex: { module: this._mipModule, entryPoint: 'vs' }, fragment: { module: this._mipModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' }, label: 'ug3d-mip' });
      this._mipSampler = dev.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    }
    var enc = dev.createCommandEncoder({ label: 'ug3d-mips' });
    for (var l = 1; l < levels; l++) {
      var bg = dev.createBindGroup({ layout: this._mipBGL, entries: [{ binding: 0, resource: tex.createView({ baseMipLevel: l - 1, mipLevelCount: 1 }) }, { binding: 1, resource: this._mipSampler }] });
      var pass = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView({ baseMipLevel: l, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
      pass.setPipeline(this._mipPipe); pass.setBindGroup(0, bg); pass.draw(3); pass.end();
    }
    dev.queue.submit([enc.finish()]);
  }
  freeSource(src) {
    var e = this._tex.get(src); if (!e) return;
    this._tex.delete(src); delete src._gpu[this.uid];
    if (e.tex) { this.r._pending.push(e.tex); if (!this.r._inFrame) this.r._flushPending(); }
    this._bgMat.clear(); Debug.track('GPUTexture3D', -1);
  }
  /* ---------- pipelines ---------- */
  _module(f) {
    var m = this._modules.get(f.key);
    if (!m) { m = this.device.createShaderModule({ code: wgslShader(f, this.L), label: 'ug3d-' + f.key }); this.r._checkModule(m, '3d ' + f.key); this._modules.set(f.key, m); }
    return m;
  }
  _pipeline(f, g, mesh, pass, samples) {
    var m = mesh.material, colSize = f.vcol ? g.attributes.color.size : 0;
    var side = pass === 'outline' ? 'back' : (pass === 'shadow' ? (m.side === 'double' ? 'double' : 'front') : m.side);
    var trans = pass === 'main' && f.trans;
    var dw = pass === 'main' ? (!trans && m.depthWrite !== false) : true;
    var dt = pass === 'main' ? m.depthTest !== false : true;
    var blend = trans ? (GPU3D_BLEND[m.blend] ? m.blend : 'normal') : '';
    var key = f.key + '|' + colSize + '|' + side + '|' + (dw ? 1 : 0) + (dt ? 1 : 0) + '|' + blend + '|' + samples;
    var p = this._pipes.get(key);
    if (p) return p;
    var mod = this._module(f);
    var bufs = [
      { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
      { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
      { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] }];
    if (f.vcol) bufs.push({ arrayStride: colSize * 4, attributes: [{ shaderLocation: 3, offset: 0, format: colSize === 1 ? 'float32' : 'float32x' + colSize }] });
    if (f.skin) { bufs.push({ arrayStride: 16, attributes: [{ shaderLocation: 4, offset: 0, format: 'float32x4' }] }); bufs.push({ arrayStride: 16, attributes: [{ shaderLocation: 5, offset: 0, format: 'float32x4' }] }); }
    if (f.inst) bufs.push({ arrayStride: 80, stepMode: 'instance', attributes: [0, 1, 2, 3, 4].map(function (k) { return { shaderLocation: 6 + k, offset: k * 16, format: 'float32x4' }; }) });
    var desc = {
      layout: f.skin ? this._layoutSkin : this._layout,
      vertex: { module: mod, entryPoint: 'vs', buffers: bufs },
      primitive: { topology: 'triangle-list', frontFace: 'ccw', cullMode: side === 'double' ? 'none' : (side === 'back' ? 'front' : 'back') },
      depthStencil: { format: pass === 'shadow' ? 'depth32float' : 'depth24plus', depthWriteEnabled: dw, depthCompare: dt ? 'less-equal' : 'always' },
      multisample: { count: samples },
      label: 'ug3d-' + key
    };
    if (pass === 'shadow') { if (f.alphaTest) desc.fragment = { module: mod, entryPoint: 'fs', targets: [] }; }
    else { var target = { format: this.r.format }; if (blend) target.blend = GPU3D_BLEND[blend]; desc.fragment = { module: mod, entryPoint: 'fs', targets: [target] }; }
    p = this.device.createRenderPipeline(desc);
    this._pipes.set(key, p);
    this.stats.programs = this._pipes.size;
    return p;
  }
  _skyPipeline(samples) {
    var key = 'sky|' + samples, p = this._pipes.get(key);
    if (p) return p;
    p = this.device.createRenderPipeline({
      layout: this._skyLayout, vertex: { module: this._skyModule, entryPoint: 'vs' },
      fragment: { module: this._skyModule, entryPoint: 'fs', targets: [{ format: this.r.format }] },
      primitive: { topology: 'triangle-list' }, depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
      multisample: { count: samples }, label: 'ug3d-sky'
    });
    this._pipes.set(key, p);
    return p;
  }
  /* ---------- destinos ---------- */
  _viewTarget(view) {
    var d = this.r._ensureTexture(view.rt.source), w = d.w, h = d.h, samples = view.antialias !== false ? 4 : 1, v = view._gpu3, TU = GLOBAL.GPUTextureUsage;
    if (v && v.w === w && v.h === h && v.samples === samples) { v.rtView = d.view; return v; }
    if (v) this._freeViewTarget(view);
    v = view._gpu3 = { w: w, h: h, samples: samples, msaaTex: null, msaaView: null, depthTex: null, depthView: null, rtView: d.view };
    if (samples > 1) { v.msaaTex = this.device.createTexture({ size: [w, h], sampleCount: samples, format: this.r.format, usage: TU.RENDER_ATTACHMENT, label: 'ug3d-msaa' }); v.msaaView = v.msaaTex.createView(); }
    v.depthTex = this.device.createTexture({ size: [w, h], sampleCount: samples, format: 'depth24plus', usage: TU.RENDER_ATTACHMENT, label: 'ug3d-depth' }); v.depthView = v.depthTex.createView();
    this._views.add(view); Debug.track('GPUTarget3D', 1);
    return v;
  }
  _freeViewTarget(view) {
    var v = view._gpu3; if (!v) return;
    if (v.msaaTex) this.r._pending.push(v.msaaTex);
    if (v.depthTex) this.r._pending.push(v.depthTex);
    if (!this.r._inFrame) this.r._flushPending();
    view._gpu3 = null; this._views.delete(view); Debug.track('GPUTarget3D', -1);
  }
  freeView(view) { this._freeViewTarget(view); }
  _shadowTarget(size) {
    var s = this._shadow;
    if (s && s.size === size) return s;
    if (s) { this.r._pending.push(s.tex); Debug.track('GPUTexture3D', -1); }
    var tex = this.device.createTexture({ size: [size, size], format: 'depth32float', usage: GLOBAL.GPUTextureUsage.RENDER_ATTACHMENT | GLOBAL.GPUTextureUsage.TEXTURE_BINDING, label: 'ug3d-shadow' });
    s = this._shadow = { size: size, tex: tex, view: tex.createView(), id: ++_gpuTexId };
    this._bgFrame.clear(); Debug.track('GPUTexture3D', 1);
    return s;
  }
  /* ---------- grabación ---------- */
  _begin(view) {
    this._check();
    this.r.batcher.flush();
    this._job = { shadow: null, main: null, view: view };
  }
  _matRes(m, pass, f, view, cache) {
    var key = m.uid + ':' + m.version + ':' + pass, e = cache.get(key);
    if (e) return e;
    var block = this._put(this._packMaterial(m, pass), 24), res = [], tk = '';
    var maps = pass === 'main' ? [f.map ? m.map : null, f.nrm ? m.normalMap : null, f.mr ? m.metalRoughMap : null, f.em ? m.emissiveMap : null, f.ao ? m.aoMap : null]
      : [(pass === 'shadow' && f.alphaTest && f.map) ? m.map : null, null, null, null, null];
    for (var i = 0; i < 5; i++) { var t = maps[i] ? this._texRes(maps[i], m, view) : null; res.push(t); tk += (t ? t.id : 'w') + ','; }
    e = { block: block, res: res, key: tk };
    cache.set(key, e);
    return e;
  }
  _record(list, mesh, f, pass, view, samples, matCache) {
    var g = mesh._geometry, d = this._geometry(g), st = this.stats;
    var P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    if (P.size !== 3 || N.size !== 3 || U.size !== 2 || (f.skin && (g.attributes.joints.size !== 4 || g.attributes.weights.size !== 4))) { Log.warnOnce('geo3dsize:' + g.uid, 'Geometría 3D con atributos de tamaño no soportado (position 3, normal 3, uv 2, joints/weights 4): se omite'); return; }
    var start = Math.max(0, g.drawRange.start | 0), count = Math.min(d.count - start, g.drawRange.count);
    count -= count % 3;
    if (!(count > 0)) return;
    var m = mesh.material, inst = mesh.instanced ? Math.min(mesh.count, mesh.capacity) : 0;
    if (mesh.instanced && inst <= 0) return;
    var pipe = this._pipeline(f, g, mesh, pass, samples);
    var vb = [d.bufs.position.buf, d.bufs.normal.buf, d.bufs.uv.buf];
    if (f.vcol) vb.push(d.bufs.color.buf);
    if (f.skin) { vb.push(d.bufs.joints.buf); vb.push(d.bufs.weights.buf); }
    if (f.inst) vb.push(this._instBuffer(mesh).buf);
    var skin = null, jw = 0;
    if (f.skin && mesh.skeleton) { skin = mesh.skeleton; this._skinBuffer(skin); jw = 1; }
    var ob = this._put(this._packObject(mesh.matrixWorld, jw, 0, pass === 'outline' ? m.outline : 0), 32);
    list.push({ pipe: pipe, mat: this._matRes(m, pass, f, view, matCache), obj: ob, skin: skin, vb: vb, ib: d.idxFormat ? d.ibuf : null, fmt: d.idxFormat, count: count, first: start, inst: Math.max(1, inst) });
    var tris = count / 3;
    if (pass === 'shadow') st.shadowDraws++; else { st.draws++; st.triangles += tris * Math.max(1, inst); }
  }
  _shadowPass(view, sh, FS, list) {
    var s = this._shadowTarget(Math.max(16, Math.min(sh.mapSize | 0 || 1024, this.r.maxTextureSize || 4096)));
    var job = this._job, draws = [], cache = new Map();
    for (var i = 0; i < list.length; i++) this._record(draws, list[i], this._features(list[i], 'shadow'), 'shadow', view, 1, cache);
    job.shadow = { target: s, frame: this._put(FS), draws: draws };
    return true;
  }
  _mainPass(view, scene, cam, F) {
    var job = this._job, v = this._viewTarget(view), samples = v.samples, draws = [], cache = new Map(), i, it;
    var bg = Color.toNumber(scene.background === null ? 0 : scene.background), a = scene.background === null ? 0 : scene.backgroundAlpha;
    var main = job.main = { target: v, rtView: v.rtView, samples: samples, frame: this._put(F), clear: { r: ((bg >> 16) & 255) / 255 * a, g: ((bg >> 8) & 255) / 255 * a, b: (bg & 255) / 255 * a, a: a }, sky: -1, draws: draws, shadowOn: F[39] > 0 && !!job.shadow };
    if (scene.sky) {
      var su = this._skyU || (this._skyU = new Float32Array(56)), K = this.L.K0 * 4;
      su.set(_r3m2.copy(cam.viewProjection).invert().e, 0);
      su.set(F.subarray(K, K + 20), 16); su[36] = F[16]; su[37] = F[17]; su[38] = F[18]; su[39] = scene.time || 0;
      packSkyExtras(scene.sky, su, 40);
      main.sky = this._put(su);
    }
    var ops = this._drawOpaque, trs = this._drawTrans;
    for (i = 0; i < ops.length; i++) { it = ops[i]; this._record(draws, it.mesh, it.f, 'main', view, samples, cache); }
    for (i = 0; i < ops.length; i++) { it = ops[i]; if (it.mesh.material.outline > 0) this._record(draws, it.mesh, this._features(it.mesh, 'outline'), 'outline', view, samples, cache); }
    for (i = 0; i < trs.length; i++) { it = trs[i]; this._record(draws, it.mesh, it.f, 'main', view, samples, cache); }
  }
  _end() {
    var job = this._job; this._job = null;
    if (!job || !job.main) return;
    var self = this, c = this.r._cmd();
    c.t = 6; c.run = function (enc) { self._encode(enc, job); };
  }
  /* ---------- codificación (dentro de WebGPURenderer._submit) ---------- */
  _frameBG(shadowView, shadowId) {
    var key = this._uGen + ':' + shadowId, bg = this._bgFrame.get(key);
    if (!bg) {
      bg = this.device.createBindGroup({ layout: this._frameBGL, entries: [{ binding: 0, resource: { buffer: this._uBuf, offset: 0, size: this.L.NF * 16 } }, { binding: 1, resource: shadowView }, { binding: 2, resource: this._cmpSampler }] });
      this._bgFrame.set(key, bg);
    }
    return bg;
  }
  _matBG(mat) {
    var key = this._uGen + '|' + mat.key, bg = this._bgMat.get(key);
    if (!bg) {
      var entries = [{ binding: 0, resource: { buffer: this._uBuf, offset: 0, size: 96 } }], wsamp = this._sampler(false, false, false);
      for (var i = 0; i < 5; i++) { var t = mat.res[i]; entries.push({ binding: 1 + i * 2, resource: t ? t.view : this._whiteView }); entries.push({ binding: 2 + i * 2, resource: t ? t.sampler : wsamp }); }
      bg = this.device.createBindGroup({ layout: this._matBGL, entries: entries });
      if (this._bgMat.size > 512) this._bgMat.clear();
      this._bgMat.set(key, bg);
    }
    return bg;
  }
  _objBG(skel) {
    if (!skel) { if (!this._bgObj) this._bgObj = this.device.createBindGroup({ layout: this._objBGL, entries: [{ binding: 0, resource: { buffer: this._uBuf, offset: 0, size: 128 } }] }); return this._bgObj; }
    var e = this._skinBufs.get(skel); if (!e) return null;
    var cached = this._bgSkin.get(skel);
    if (cached && cached.gen === this._uGen && cached.buf === e.buf) return cached.bg;
    var bg = this.device.createBindGroup({ layout: this._objSkinBGL, entries: [{ binding: 0, resource: { buffer: this._uBuf, offset: 0, size: 128 } }, { binding: 1, resource: { buffer: e.buf } }] });
    this._bgSkin.set(skel, { gen: this._uGen, buf: e.buf, bg: bg });
    return bg;
  }
  _drawList(pass, draws, frameBG, frameOff) {
    var cur = null, lastMat = null, lastObjBG = null;
    pass.setBindGroup(0, frameBG, [frameOff * 256]);
    for (var i = 0; i < draws.length; i++) {
      var d = draws[i];
      var obg = this._objBG(d.skin); if (!obg) continue;
      if (d.pipe !== cur) { pass.setPipeline(d.pipe); cur = d.pipe; lastMat = null; lastObjBG = null; pass.setBindGroup(0, frameBG, [frameOff * 256]); }
      if (d.mat !== lastMat) { pass.setBindGroup(1, this._matBG(d.mat), [d.mat.block * 256]); lastMat = d.mat; }
      pass.setBindGroup(2, obg, [d.obj * 256]); lastObjBG = obg;
      for (var k = 0; k < d.vb.length; k++) pass.setVertexBuffer(k, d.vb[k]);
      if (d.ib) { pass.setIndexBuffer(d.ib, d.fmt); pass.drawIndexed(d.count, d.inst, d.first, 0, 0); }
      else pass.draw(d.count, d.inst, d.first, 0);
    }
    void lastObjBG;
  }
  _encode(enc, job) {
    if (!this._uBuf || this._dev !== this.r._devVersion) return;
    var sh = job.shadow, main = job.main, pass;
    if (sh) {
      pass = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: sh.target.view, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' }, label: 'ug3d-shadow' });
      if (sh.draws.length) this._drawList(pass, sh.draws, this._frameBG(this._dummyDepthView, 'none'), sh.frame);
      pass.end();
    }
    var t = main.target, att = { view: t.msaaView || main.rtView, loadOp: 'clear', storeOp: t.msaaView ? 'discard' : 'store', clearValue: main.clear };
    if (t.msaaView) att.resolveTarget = main.rtView;
    pass = enc.beginRenderPass({ colorAttachments: [att], depthStencilAttachment: { view: t.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' }, label: 'ug3d-main' });
    if (main.sky >= 0) {
      if (!this._bgSky) this._bgSky = this.device.createBindGroup({ layout: this._skyBGL, entries: [{ binding: 0, resource: { buffer: this._uBuf, offset: 0, size: 224 } }] });
      pass.setPipeline(this._skyPipeline(main.samples)); pass.setBindGroup(0, this._bgSky, [main.sky * 256]); pass.draw(3);
    }
    var fbg = main.shadowOn && sh ? this._frameBG(sh.target.view, sh.target.id) : this._frameBG(this._dummyDepthView, 'none');
    if (main.draws.length) this._drawList(pass, main.draws, fbg, main.frame);
    pass.end();
  }
  destroy() {
    if (this.destroyed) return;
    var self = this, r = this.r;
    Array.from(this._geoms).forEach(function (g) { self.freeGeometry(g); });
    Array.from(this._views).forEach(function (v) { self._freeViewTarget(v); });
    Array.from(this._insts).forEach(function (m) { var ib = m._gpuInst && m._gpuInst[self.uid]; if (ib) { self._freeInst(m, ib); delete m._gpuInst[self.uid]; } });
    Array.from(this._skinBufs.keys()).forEach(function (s) { self.freeSkeleton(s); });
    Array.from(this._tex.keys()).forEach(function (s) { self.freeSource(s); });
    if (this._shadow) { r._pending.push(this._shadow.tex); this._shadow = null; Debug.track('GPUTexture3D', -1); }
    if (this._uBuf) { r._pending.push(this._uBuf); this._uBuf = null; Debug.track('GPUBuffer3D', -1); }
    if (this._white) r._pending.push(this._white);
    if (this._dummyDepth) r._pending.push(this._dummyDepth);
    r._flushPending();
    this._pipes.clear(); this._modules.clear(); this._samplers.clear(); this._bgMat.clear(); this._bgFrame.clear(); this._bgSkin.clear();
    super.destroy();
  }
}

UG.WebGPU3D = WebGPU3D;
