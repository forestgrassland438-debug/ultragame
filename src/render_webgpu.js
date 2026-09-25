/* UltraGame - backend WebGPU.
 * Diseño de "codificación diferida": durante el frame solo se graban comandos ligeros y los datos
 * se acumulan en buffers de staging en CPU. Al final se hacen 3 subidas (vértices, índices, uniforms)
 * con writeBuffer y se codifica todo en un único command buffer: máximo ancho de banda, mínimo overhead. */

var WGSL_FILTER_HEAD =
  'struct FU { outClip: vec4f, inputSize: vec4f, frame: vec4f, clampv: vec4f, glob: vec4f, p: array<vec4f, 8> };\n' +
  '@group(0) @binding(0) var<uniform> u: FU;\n' +
  '@group(0) @binding(1) var uTex: texture_2d<f32>;\n' +
  '@group(0) @binding(2) var uTex2: texture_2d<f32>;\n' +
  '@group(0) @binding(3) var uSamp: sampler;\n' +
  'struct FVOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) coord: vec2f };\n' +
  '@vertex fn vs(@builtin(vertex_index) vi: u32) -> FVOut {\n' +
  '  var q = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));\n' +
  '  let a = q[vi];\n' +
  '  var o: FVOut; o.coord = a; o.uv = a * u.frame.zw * u.inputSize.zw;\n' +
  '  o.pos = vec4f(mix(u.outClip.xy, u.outClip.zw, a), 0.0, 1.0); return o;\n' +
  '}\n' +
  'fn sampleTex(uv: vec2f) -> vec4f { return textureSampleLevel(uTex, uSamp, clamp(uv, u.clampv.xy, u.clampv.zw), 0.0); }\n' +
  'fn sampleTex2(uv: vec2f) -> vec4f { return textureSampleLevel(uTex2, uSamp, clamp(uv, u.clampv.xy, u.clampv.zw), 0.0); }\n' +
  'fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }\n' +
  'fn rand(co: vec2f) -> f32 { return fract(sin(dot(co, vec2f(12.9898, 78.233))) * 43758.5453); }\n' +
  'fn texel() -> vec2f { return u.inputSize.zw; }\n' +
  'fn pixelPos(coord: vec2f) -> vec2f { return coord * u.frame.zw / u.glob.y; }\n' +
  'fn frameSize() -> vec2f { return u.frame.zw / u.glob.y; }\n';
var WGSL_FILTER_TAIL = '\n@fragment fn fs(i: FVOut) -> @location(0) vec4f { return filterMain(i.uv, i.coord); }\n';

function wgslBatch(n) {
  var s = 'struct U { proj: vec4f };\n@group(0) @binding(0) var<uniform> u: U;\n';
  for (var i = 0; i < n; i++) s += '@group(1) @binding(' + i + ') var t' + i + ': texture_2d<f32>;\n@group(1) @binding(' + (n + i) + ') var s' + i + ': sampler;\n';
  s += 'struct VIn { @location(0) pos: vec2f, @location(1) uv: vec2f, @location(2) color: vec4f, @location(3) tex: f32 };\n' +
    'struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) color: vec4f, @location(2) @interpolate(flat) tex: u32 };\n' +
    '@vertex fn vs(i: VIn) -> VOut { var o: VOut; o.pos = vec4f(i.pos * u.proj.xy + u.proj.zw, 0.0, 1.0); o.uv = i.uv; o.color = i.color; o.tex = u32(i.tex + 0.5); return o; }\n' +
    'struct QIn { @location(0) corner: vec2f, @location(1) p0: vec2f, @location(2) au: vec2f, @location(3) av: vec2f, @location(4) uvr: vec4f, @location(5) color: vec4f, @location(6) tex: f32 };\n' +
    '@vertex fn vsq(i: QIn) -> VOut { var o: VOut; let p = i.p0 + i.au * i.corner.x + i.av * i.corner.y; o.pos = vec4f(p * u.proj.xy + u.proj.zw, 0.0, 1.0); o.uv = mix(i.uvr.xy, i.uvr.zw, i.corner); o.color = i.color; o.tex = u32(i.tex + 0.5); return o; }\n' +
    '@fragment fn fs(i: VOut) -> @location(0) vec4f {\n var c: vec4f;\n switch i.tex {\n';
  for (var j = 0; j < n - 1; j++) s += '  case ' + j + 'u: { c = textureSampleLevel(t' + j + ', s' + j + ', i.uv, 0.0); }\n';
  s += '  default: { c = textureSampleLevel(t' + (n - 1) + ', s' + (n - 1) + ', i.uv, 0.0); }\n }\n return c * i.color;\n}\n';
  return s;
}

var GPU_BLEND_STATES = (function () {
  var c = function (src, dst, op) { return { srcFactor: src, dstFactor: dst, operation: op || 'add' }; };
  var s = {};
  s[BLEND.NORMAL] = { color: c('one', 'one-minus-src-alpha'), alpha: c('one', 'one-minus-src-alpha') };
  s[BLEND.ADD] = { color: c('one', 'one'), alpha: c('one', 'one') };
  s[BLEND.MULTIPLY] = { color: c('dst', 'one-minus-src-alpha'), alpha: c('one', 'one-minus-src-alpha') };
  s[BLEND.SCREEN] = { color: c('one', 'one-minus-src'), alpha: c('one', 'one-minus-src-alpha') };
  s[BLEND.ERASE] = { color: c('zero', 'one-minus-src-alpha'), alpha: c('zero', 'one-minus-src-alpha') };
  s[BLEND.NONE] = null;
  s[BLEND.LIGHTEN] = { color: c('one', 'one', 'max'), alpha: c('one', 'one', 'max') };
  s[BLEND.DARKEN] = { color: c('one', 'one', 'min'), alpha: c('one', 'one', 'min') };
  return s;
})();

var _gpuTexId = 0;

class WebGPURenderer extends GPURenderer {
  constructor(options) {
    super(options);
    this.type = 'webgpu';
    this.device = null; this.context = null; this.format = 'bgra8unorm';
    this._devVersion = 0;
    this._liveSources = new Set();
    this._rtFlipY = true;
    this._cmds = []; this._cmdN = 0;
    this._pending = [];
    this._bgCache = new Map();
    this._pipes = new Map();
    this._samplers = new Map();
    this._msaa = this.options.antialias !== false;
    this._curPassMSAA = false;
  }
  init(canvas) {
    this.canvas = canvas;
    var self = this, nav = GLOBAL.navigator;
    if (!nav || !nav.gpu) return Promise.reject(new Error('WebGPU no disponible'));
    return nav.gpu.requestAdapter({ powerPreference: this.options.powerPreference || 'high-performance' }).then(function (adapter) {
      if (!adapter) throw new Error('No hay adaptador WebGPU');
      self.adapter = adapter;
      return adapter.requestDevice();
    }).then(function (device) {
      self._setupDevice(device);
      self.resize(self.width, self.height, self.resolution);
      return self;
    });
  }
  _setupDevice(device) {
    var self = this;
    this.device = device;
    this._devVersion++;
    device.lost.then(function (info) {
      if (self.destroyed || self.device !== device) return;
      self.contextLost = true; self.emit('contextlost', info);
      Log.warn('Dispositivo WebGPU perdido:', info && info.message);
      if (info && info.reason !== 'destroyed') self._reinit();
    });
    if (device.addEventListener) device.addEventListener('uncapturederror', function (ev) { Log.warnOnce('gpuerr:' + (ev.error && ev.error.message), 'WebGPU:', ev.error && ev.error.message); });
    this.context = this.canvas.getContext('webgpu');
    if (!this.context) throw new Error('No se pudo obtener el contexto webgpu del canvas');
    this.format = GLOBAL.navigator.gpu.getPreferredCanvasFormat ? GLOBAL.navigator.gpu.getPreferredCanvasFormat() : 'bgra8unorm';
    this.context.configure({ device: device, format: this.format, alphaMode: this.options.transparent ? 'premultiplied' : 'opaque' });
    var lim = device.limits;
    this.maxTextureSize = lim.maxTextureDimension2D || 8192;
    this.supportsNPOTRepeat = true;
    var n = Math.min(8, lim.maxSampledTexturesPerShaderStage || 8, lim.maxSamplersPerShaderStage || 8, this.options.maxTextures || 8);
    this.maxTextures = n;
    this.instancing = this.options.instancing !== false;
    if (!this.batcher || this.batcher.maxTextures !== n || this.batcher.instancing !== this.instancing) this.batcher = new Batcher(this, n, 65532, this.instancing);
    var GS = GLOBAL.GPUShaderStage, GB = GLOBAL.GPUBufferUsage;
    this._batchModule = device.createShaderModule({ code: wgslBatch(n), label: 'ug-batch' });
    this._checkModule(this._batchModule, 'batch');
    this._uBGL = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GS.VERTEX, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 16 } }] });
    var texEntries = [];
    for (var i = 0; i < n; i++) texEntries.push({ binding: i, visibility: GS.FRAGMENT, texture: { sampleType: 'float' } });
    for (var j = 0; j < n; j++) texEntries.push({ binding: n + j, visibility: GS.FRAGMENT, sampler: { type: 'filtering' } });
    this._tBGL = device.createBindGroupLayout({ entries: texEntries });
    this._batchLayout = device.createPipelineLayout({ bindGroupLayouts: [this._uBGL, this._tBGL] });
    this._fBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GS.VERTEX | GS.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 208 } },
        { binding: 1, visibility: GS.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GS.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GS.FRAGMENT, sampler: { type: 'filtering' } }
      ]
    });
    this._filterLayout = device.createPipelineLayout({ bindGroupLayouts: [this._fBGL] });
    this._filterModules = new Map();
    this._pipes.clear(); this._bgCache.clear(); this._samplers.clear();
    // staging CPU
    this._vStage = new ArrayBuffer(1 << 22); this._vF32 = new Float32Array(this._vStage); this._vUsed = 0;
    this._iStage = new Uint16Array(1 << 20); this._iUsed = 0;
    this._uStage = new Float32Array(64 * 64); this._uUsed = 0;
    this._qStage = new ArrayBuffer(1 << 21); this._qF32 = new Float32Array(this._qStage); this._qUsed = 0;
    this._qBuf = null; this._qBufSize = 0;
    this._cornerBuf = device.createBuffer({ size: 32, usage: GLOBAL.GPUBufferUsage.VERTEX | GLOBAL.GPUBufferUsage.COPY_DST, label: 'ug-corners' });
    device.queue.writeBuffer(this._cornerBuf, 0, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]));
    this._vBuf = null; this._iBuf = null; this._uBuf = null; this._vBufSize = 0; this._iBufSize = 0; this._uBufSize = 0;
    this._ensureGPUBuffers(1 << 20, 1 << 18, 256 * 64);
    this._dummy = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GLOBAL.GPUTextureUsage.TEXTURE_BINDING | GLOBAL.GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: this._dummy }, new Uint8Array([0, 0, 0, 0]), { bytesPerRow: 4 }, { width: 1, height: 1 });
    this._dummyView = this._dummy.createView();
    this._msaaTex = null; this._msaaView = null;
    this._cmdN = 0;
    void GB;
  }
  _checkModule(mod, label) {
    if (mod.getCompilationInfo) mod.getCompilationInfo().then(function (info) {
      for (var i = 0; i < info.messages.length; i++) { var m = info.messages[i]; if (m.type === 'error') Log.error('WGSL (' + label + ') línea ' + m.lineNum + ': ' + m.message); }
    });
  }
  _reinit() {
    var self = this;
    var uidR = this.uid;
    this._liveSources.forEach(function (src) { delete src._gpu[uidR]; });
    this._liveSources.clear(); this.stats.textures = 0;
    this.pool.clear();
    GLOBAL.navigator.gpu.requestAdapter().then(function (a) { return a.requestDevice(); }).then(function (dev) {
      if (self.destroyed) { dev.destroy(); return; }
      self._setupDevice(dev); self._onResize(); self.contextLost = false; self.emit('contextrestored');
      Log.info('Dispositivo WebGPU recreado');
    }).catch(function (e) { Log.error('No se pudo recuperar WebGPU:', e && e.message); });
  }
  _ensureGPUBuffers(vBytes, iBytes, uBytes, qBytes) {
    var d = this.device, GB = GLOBAL.GPUBufferUsage;
    if (!this._qBuf || this._qBufSize < (qBytes || 0)) {
      if (this._qBuf) this._pending.push(this._qBuf); else Debug.track('GPUBuffer', 1);
      this._qBufSize = MathUtils.nextPowerOfTwo(Math.max(qBytes || 0, 1 << 16));
      this._qBuf = d.createBuffer({ size: this._qBufSize, usage: GB.VERTEX | GB.COPY_DST, label: 'ug-instances' });
    }
    if (!this._vBuf || this._vBufSize < vBytes) {
      if (this._vBuf) this._pending.push(this._vBuf); else Debug.track('GPUBuffer', 1);
      this._vBufSize = MathUtils.nextPowerOfTwo(Math.max(vBytes, 1 << 16));
      this._vBuf = d.createBuffer({ size: this._vBufSize, usage: GB.VERTEX | GB.COPY_DST, label: 'ug-vertices' });
    }
    if (!this._iBuf || this._iBufSize < iBytes) {
      if (this._iBuf) this._pending.push(this._iBuf); else Debug.track('GPUBuffer', 1);
      this._iBufSize = MathUtils.nextPowerOfTwo(Math.max(iBytes, 1 << 14));
      this._iBuf = d.createBuffer({ size: this._iBufSize, usage: GB.INDEX | GB.COPY_DST, label: 'ug-indices' });
    }
    if (!this._uBuf || this._uBufSize < uBytes) {
      if (this._uBuf) this._pending.push(this._uBuf); else Debug.track('GPUBuffer', 1);
      this._uBufSize = MathUtils.nextPowerOfTwo(Math.max(uBytes, 256 * 16));
      this._uBuf = d.createBuffer({ size: this._uBufSize, usage: GB.UNIFORM | GB.COPY_DST, label: 'ug-uniforms' });
      this._uBG = d.createBindGroup({ layout: this._uBGL, entries: [{ binding: 0, resource: { buffer: this._uBuf, offset: 0, size: 16 } }] });
    }
  }
  _onResize() {
    if (!this.device || !this.canvas) return;
    if (this._msaaTex) { this._pending.push(this._msaaTex); this._msaaTex = null; this._msaaView = null; }
    if (this._msaa) {
      this._msaaTex = this.device.createTexture({ size: [this.canvas.width, this.canvas.height], sampleCount: 4, format: this.format, usage: GLOBAL.GPUTextureUsage.RENDER_ATTACHMENT, label: 'ug-msaa' });
      this._msaaView = this._msaaTex.createView();
    }
  }
  _cmd() { var c = this._cmds[this._cmdN]; if (!c) { c = {}; this._cmds[this._cmdN] = c; } this._cmdN++; return c; }
  _uSlot(n) {
    var slot = this._uUsed++;
    if ((slot + 1) * 64 > this._uStage.length) { var ns = new Float32Array(this._uStage.length * 2); ns.set(this._uStage); this._uStage = ns; }
    return slot;
  }

  /* ---------- texturas ---------- */
  _sampler(scale, wrap) {
    var key = scale + '|' + wrap, s = this._samplers.get(key);
    if (!s) {
      var am = wrap === 'repeat' ? 'repeat' : (wrap === 'mirror' ? 'mirror-repeat' : 'clamp-to-edge');
      var f = scale === 'nearest' ? 'nearest' : 'linear';
      s = this.device.createSampler({ magFilter: f, minFilter: f, addressModeU: am, addressModeV: am });
      this._samplers.set(key, s);
    }
    return s;
  }
  _ensureTexture(src) {
    var d = src._gpu[this.uid];
    if (d && d.version === src.version && d.dev === this._devVersion && !(d.video && d.frame !== this.stats.frame)) return d;
    return this._upload(src, d);
  }
  _upload(src, d) {
    var dev = this.device, TU = GLOBAL.GPUTextureUsage, res = src.resource;
    var w = src.width, h = src.height;
    if (res && res.data) { w = res.width; h = res.height; }
    var max = this.maxTextureSize, upl = res, scaled = false;
    if (!src.isRenderTarget && res && !res.data && (w > max || h > max)) {
      var sc = Math.min(max / w, max / h), cv = createCanvas(Math.floor(w * sc), Math.floor(h * sc));
      cv.getContext('2d').drawImage(res, 0, 0, cv.width, cv.height); upl = cv; w = cv.width; h = cv.height; scaled = true;
    }
    if (!d || d.dev !== this._devVersion) {
      d = { tex: null, view: null, version: -1, w: 0, h: 0, dev: this._devVersion, id: 0, video: false, frame: -1 };
      src._gpu[this.uid] = d; this._liveSources.add(src); this.stats.textures++; Debug.track('GPUTexture', 1);
    }
    if (!d.tex || d.w !== w || d.h !== h) {
      if (d.tex) { this._pending.push(d.tex); this._bgCache.clear(); }
      var usage = TU.TEXTURE_BINDING | TU.COPY_DST | TU.RENDER_ATTACHMENT | (src.isRenderTarget ? TU.COPY_SRC : 0);
      d.tex = dev.createTexture({ size: [w, h], format: src.isRenderTarget ? this.format : 'rgba8unorm', usage: usage, label: src.label || 'ug-texture' });
      d.view = d.tex.createView();
      d.w = w; d.h = h; d.id = ++_gpuTexId;
      d.format = src.isRenderTarget ? this.format : 'rgba8unorm';
    }
    if (!src.isRenderTarget && res) {
      try {
        if (res.data) {
          var data = res.data instanceof Uint8Array ? res.data : new Uint8Array(res.data.buffer || res.data);
          if (!src.premultiplied) {
            data = new Uint8Array(data);
            for (var i = 0; i < data.length; i += 4) { var a = data[i + 3] / 255; data[i] = data[i] * a + 0.5; data[i + 1] = data[i + 1] * a + 0.5; data[i + 2] = data[i + 2] * a + 0.5; }
          }
          dev.queue.writeTexture({ texture: d.tex }, data, { bytesPerRow: w * 4, rowsPerImage: h }, { width: w, height: h });
        } else if (src.dynamic && !scaled && upl.getContext && w * h <= 262144) {
          // canvas pequeño y cambiante (textos): leer en CPU + writeTexture evita la sincronización costosa
          // de copyExternalImageToTexture (en Chrome ~2 ms por llamada, independiente del tamaño)
          var px = upl.getContext('2d').getImageData(0, 0, w, h).data;
          for (var q = 0; q < px.length; q += 4) { var al = px[q + 3]; if (al !== 255) { var f = al / 255; px[q] *= f; px[q + 1] *= f; px[q + 2] *= f; } } // Uint8ClampedArray ya redondea
          dev.queue.writeTexture({ texture: d.tex }, px, { bytesPerRow: w * 4, rowsPerImage: h }, { width: w, height: h });
        } else {
          try { dev.queue.copyExternalImageToTexture({ source: upl }, { texture: d.tex, premultipliedAlpha: true }, { width: w, height: h }); }
          catch (e1) {
            // Algunos navegadores no aceptan HTMLImageElement: pasar por un canvas
            var c2 = createCanvas(w, h); c2.getContext('2d').drawImage(upl, 0, 0, w, h);
            dev.queue.copyExternalImageToTexture({ source: c2 }, { texture: d.tex, premultipliedAlpha: true }, { width: w, height: h });
            releaseCanvas(c2);
          }
          d.video = typeof HTMLVideoElement !== 'undefined' && res instanceof HTMLVideoElement; d.frame = this.stats.frame;
        }
      } catch (e) {
        Log.warnOnce('upload:' + src.uid, 'No se pudo subir la textura a WebGPU (¿CORS?):', e.message);
        var mag = new Uint8Array(w * h * 4); for (var k = 0; k < mag.length; k += 4) { mag[k] = 255; mag[k + 2] = 255; mag[k + 3] = 255; }
        dev.queue.writeTexture({ texture: d.tex }, mag, { bytesPerRow: w * 4 }, { width: w, height: h });
      }
      if (scaled) releaseCanvas(upl);
    }
    d.sampler = this._sampler(src.scaleMode, src.wrapMode);
    d.skey = src.scaleMode === 'nearest' ? (src.wrapMode === 'repeat' ? 1 : (src.wrapMode === 'mirror' ? 2 : 0)) : (src.wrapMode === 'repeat' ? 4 : (src.wrapMode === 'mirror' ? 5 : 3));
    d.version = src.version;
    return d;
  }
  freeSource(src) {
    var d = src._gpu[this.uid]; if (!d) return;
    delete src._gpu[this.uid];
    this._liveSources.delete(src);
    if (d.tex && d.dev === this._devVersion) { this._pending.push(d.tex); this._bgCache.clear(); }
    if (!this._inFrame) this._flushPending();
    this.stats.textures--; Debug.track('GPUTexture', -1);
  }
  _flushPending() {
    for (var i = 0; i < this._pending.length; i++) { try { this._pending[i].destroy(); } catch (e) { /* ignorar */ } }
    this._pending.length = 0;
  }
  _texBindGroup(b) {
    var n = this.maxTextures, key = '';
    var views = this._tmpViews || (this._tmpViews = []), samps = this._tmpSamps || (this._tmpSamps = []);
    for (var i = 0; i < n; i++) {
      if (i < b.texCount) { var d = this._ensureTexture(b.textures[i]); views[i] = d.view; samps[i] = d.sampler; key += d.id + '.' + d.skey + ','; }
      else { views[i] = this._dummyView; samps[i] = this._sampler('linear', 'clamp'); key += 'e,'; }
    }
    var bg = this._bgCache.get(key);
    if (!bg) {
      var entries = [];
      for (var j = 0; j < n; j++) entries.push({ binding: j, resource: views[j] });
      for (var k = 0; k < n; k++) entries.push({ binding: n + k, resource: samps[k] });
      bg = this.device.createBindGroup({ layout: this._tBGL, entries: entries });
      if (this._bgCache.size > 1024) this._bgCache.clear();
      this._bgCache.set(key, bg);
    }
    return bg;
  }

  /* ---------- pipelines ---------- */
  _batchPipeline(blend, msaa) {
    var key = 'b' + blend + (msaa ? 'm' : ''), p = this._pipes.get(key);
    if (p) return p;
    var bs = GPU_BLEND_STATES[blend]; if (bs === undefined) bs = GPU_BLEND_STATES[BLEND.NORMAL];
    var target = { format: this.format }; if (bs) target.blend = bs;
    p = this.device.createRenderPipeline({
      layout: this._batchLayout,
      vertex: {
        module: this._batchModule, entryPoint: 'vs',
        buffers: [{ arrayStride: BYTES_PER_VERTEX, attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x2' }, { shaderLocation: 1, offset: 8, format: 'float32x2' },
          { shaderLocation: 2, offset: 16, format: 'unorm8x4' }, { shaderLocation: 3, offset: 20, format: 'float32' }] }]
      },
      fragment: { module: this._batchModule, entryPoint: 'fs', targets: [target] },
      primitive: { topology: 'triangle-list' },
      multisample: { count: msaa ? 4 : 1 },
      label: 'ug-batch-' + key
    });
    this._pipes.set(key, p);
    return p;
  }
  _quadPipeline(blend, msaa) {
    var key = 'q' + blend + (msaa ? 'm' : ''), p = this._pipes.get(key);
    if (p) return p;
    var bs = GPU_BLEND_STATES[blend]; if (bs === undefined) bs = GPU_BLEND_STATES[BLEND.NORMAL];
    var target = { format: this.format }; if (bs) target.blend = bs;
    p = this.device.createRenderPipeline({
      layout: this._batchLayout,
      vertex: {
        module: this._batchModule, entryPoint: 'vsq',
        buffers: [
          { arrayStride: 8, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
          { arrayStride: INST_BYTES, stepMode: 'instance', attributes: [
            { shaderLocation: 1, offset: 0, format: 'float32x2' }, { shaderLocation: 2, offset: 8, format: 'float32x2' }, { shaderLocation: 3, offset: 16, format: 'float32x2' },
            { shaderLocation: 4, offset: 24, format: 'unorm16x4' }, { shaderLocation: 5, offset: 32, format: 'unorm8x4' }, { shaderLocation: 6, offset: 36, format: 'float32' }] }
        ]
      },
      fragment: { module: this._batchModule, entryPoint: 'fs', targets: [target] },
      primitive: { topology: 'triangle-strip' },
      multisample: { count: msaa ? 4 : 1 },
      label: 'ug-quads-' + key
    });
    this._pipes.set(key, p);
    return p;
  }
  _filterPipeline(filter, blend, msaa) {
    var key = 'f:' + filter.key + ':' + blend + (msaa ? 'm' : ''), p = this._pipes.get(key);
    if (p !== undefined) return p;
    var mod = this._filterModules.get(filter.key);
    if (mod === undefined) {
      if (!filter.wgsl) { Log.warnOnce('nowgsl:' + filter.key, 'El filtro ' + filter.key + ' no tiene WGSL'); this._filterModules.set(filter.key, null); mod = null; }
      else { mod = this.device.createShaderModule({ code: WGSL_FILTER_HEAD + filter.wgsl + WGSL_FILTER_TAIL, label: 'ug-filter-' + filter.key }); this._checkModule(mod, filter.key); this._filterModules.set(filter.key, mod); }
    }
    if (!mod) { this._pipes.set(key, null); return null; }
    var bs = GPU_BLEND_STATES[blend]; if (bs === undefined) bs = GPU_BLEND_STATES[BLEND.NORMAL];
    var target = { format: this.format }; if (bs) target.blend = bs;
    p = this.device.createRenderPipeline({
      layout: this._filterLayout,
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [target] },
      primitive: { topology: 'triangle-list' },
      multisample: { count: msaa ? 4 : 1 },
      label: 'ug-' + key
    });
    this._pipes.set(key, p);
    return p;
  }

  /* ---------- grabación ---------- */
  _beginFrameBackend() { this._canvasView = null; }
  _bindTarget(st, clear, color, alpha) {
    var slot = this._uSlot(), o = slot * 64, us = this._uStage, p = this._proj;
    us[o] = p[0]; us[o + 1] = p[1]; us[o + 2] = p[2]; us[o + 3] = p[3];
    var c = this._cmd();
    c.t = 1; c.rtView = null; c.load = !clear; c.uOff = slot * 256; c.pw = st.pw; c.ph = st.ph;
    c.r = ((color >> 16) & 255) / 255 * alpha; c.g = ((color >> 8) & 255) / 255 * alpha; c.b = (color & 255) / 255 * alpha; c.a = alpha;
    if (st.rt) { var d = this._ensureTexture(st.rt.source); c.rtView = d.view; }
    this._curPassMSAA = !st.rt && this._msaa;
  }
  _applyScissor(sc, st) {
    var c = this._cmd(); c.t = 3;
    if (!sc) { c.x = 0; c.y = 0; c.w = st.pw; c.h = st.ph; }
    else { c.x = Math.min(sc[0], st.pw); c.y = Math.min(sc[1], st.ph); c.w = Math.max(0, Math.min(sc[2], st.pw - c.x)); c.h = Math.max(0, Math.min(sc[3], st.ph - c.y)); }
  }
  _drawBatch(b) {
    if (!this.device || this.contextLost) return;
    if (b.instCount > 0) {
      var qf = b.instCount * INST_WORDS;
      if (this._qUsed + qf > this._qF32.length) {
        var nq = new ArrayBuffer(MathUtils.nextPowerOfTwo((this._qUsed + qf) * 4));
        new Float32Array(nq).set(this._qF32.subarray(0, this._qUsed)); this._qStage = nq; this._qF32 = new Float32Array(nq);
      }
      this._qF32.set(b.if32.subarray(0, qf), this._qUsed);
      var cq = this._cmd();
      cq.t = 5; cq.blend = b.blend; cq.bg = this._texBindGroup(b); cq.first = this._qUsed / INST_WORDS; cq.count = b.instCount;
      this._qUsed += qf;
      this.stats.drawCalls++;
      return;
    }
    var vFloats = b.vCount * FLOATS_PER_VERTEX;
    if (this._vUsed + vFloats > this._vF32.length) {
      var nb = new ArrayBuffer(MathUtils.nextPowerOfTwo((this._vUsed + vFloats) * 4));
      new Float32Array(nb).set(this._vF32.subarray(0, this._vUsed)); this._vStage = nb; this._vF32 = new Float32Array(nb);
    }
    if (this._iUsed + b.iCount + 2 > this._iStage.length) {
      var ni = new Uint16Array(MathUtils.nextPowerOfTwo(this._iUsed + b.iCount + 2)); ni.set(this._iStage.subarray(0, this._iUsed)); this._iStage = ni;
    }
    this._vF32.set(b.f32.subarray(0, vFloats), this._vUsed);
    this._iStage.set(b.iData.subarray(0, b.iCount), this._iUsed);
    var c = this._cmd();
    c.t = 2; c.blend = b.blend; c.bg = this._texBindGroup(b);
    c.first = this._iUsed; c.count = b.iCount; c.base = this._vUsed / FLOATS_PER_VERTEX;
    this._vUsed += vFloats; this._iUsed += b.iCount;
    this.stats.drawCalls++;
  }
  _filterPassBackend(filter, input, input2, u, blend) {
    if (!this.device || this.contextLost) return;
    var slot = this._uSlot();
    this._uStage.set(u, slot * 64);
    var d1 = this._ensureTexture(input.source), d2 = input2 === input ? d1 : this._ensureTexture(input2.source);
    var c = this._cmd();
    c.t = 4; c.filter = filter; c.blend = blend; c.v1 = d1.view; c.v2 = d2.view; c.uOff = slot * 256; c.msaa = this._curPassMSAA;
  }
  /** Codifica y envía todos los comandos grabados. */
  _submit() {
    var n = this._cmdN; if (!n || !this.device) { this._cmdN = 0; if (this._r3d) this._r3d._afterSubmit(); return; }
    if (this._iUsed & 1) this._iStage[this._iUsed++] = 0;
    this._ensureGPUBuffers(this._vUsed * 4, this._iUsed * 2, this._uUsed * 256, this._qUsed * 4);
    var q = this.device.queue;
    if (this._qUsed) q.writeBuffer(this._qBuf, 0, this._qStage, 0, this._qUsed * 4);
    if (this._vUsed) q.writeBuffer(this._vBuf, 0, this._vStage, 0, this._vUsed * 4);
    if (this._iUsed) q.writeBuffer(this._iBuf, 0, this._iStage.buffer, 0, this._iUsed * 2);
    if (this._uUsed) q.writeBuffer(this._uBuf, 0, this._uStage.buffer, 0, this._uUsed * 256);
    if (this._r3d) this._r3d._flush();
    var enc = this.device.createCommandEncoder({ label: 'ug-frame' });
    var pass = null, curPipe = null, kind = 0, passU = 0, msaa = false, linear = this._sampler('linear', 'clamp'), vbKind = 0;
    var lastAtt = null, scOn = false, scX = 0, scY = 0, scW = 0, scH = 0;
    for (var i = 0; i < n; i++) {
      var c = this._cmds[i];
      if (c.t === 6) {
        // pasadas 3D (View3D): se cierra la pasada 2D, se codifican y se reabre conservando lo dibujado
        if (pass) { pass.end(); pass = null; }
        var run = c.run; c.run = null;
        if (run) { try { run(enc); } catch (e3d) { Log.warnOnce('r3d:' + (e3d && e3d.message), 'Error en el render 3D (WebGPU):', e3d && e3d.message); } }
        if (lastAtt) {
          lastAtt.loadOp = 'load';
          pass = enc.beginRenderPass({ colorAttachments: [lastAtt] });
          pass.setIndexBuffer(this._iBuf, 'uint16');
          curPipe = null; kind = 0; vbKind = 0;
          if (scOn) pass.setScissorRect(scX, scY, scW, scH);
        }
        continue;
      }
      if (c.t === 1) {
        if (pass) pass.end();
        var view, resolve;
        if (c.rtView) { view = c.rtView; resolve = undefined; msaa = false; }
        else {
          if (!this._canvasView) this._canvasView = this.context.getCurrentTexture().createView();
          if (this._msaa && this._msaaView) { view = this._msaaView; resolve = this._canvasView; msaa = true; } else { view = this._canvasView; resolve = undefined; msaa = false; }
        }
        var att = { view: view, loadOp: c.load ? 'load' : 'clear', storeOp: 'store', clearValue: { r: c.r, g: c.g, b: c.b, a: c.a } };
        if (resolve) att.resolveTarget = resolve;
        pass = enc.beginRenderPass({ colorAttachments: [att] });
        lastAtt = att; scOn = false;
        pass.setIndexBuffer(this._iBuf, 'uint16');
        curPipe = null; kind = 0; passU = c.uOff; vbKind = 0;
      } else if (!pass) {
        continue;
      } else if (c.t === 3) {
        pass.setScissorRect(c.x, c.y, c.w, c.h);
        scOn = true; scX = c.x; scY = c.y; scW = c.w; scH = c.h;
      } else if (c.t === 5) {
        var qp = this._quadPipeline(c.blend, msaa);
        if (qp !== curPipe) { pass.setPipeline(qp); curPipe = qp; }
        if (vbKind !== 2) { pass.setVertexBuffer(0, this._cornerBuf); pass.setVertexBuffer(1, this._qBuf); vbKind = 2; }
        if (kind !== 1) { pass.setBindGroup(0, this._uBG, [passU]); kind = 1; }
        pass.setBindGroup(1, c.bg);
        pass.draw(4, c.count, 0, c.first);
        c.bg = null;
      } else if (c.t === 2) {
        var bp = this._batchPipeline(c.blend, msaa);
        if (bp !== curPipe) { pass.setPipeline(bp); curPipe = bp; }
        if (vbKind !== 1) { pass.setVertexBuffer(0, this._vBuf); vbKind = 1; }
        if (kind !== 1) { pass.setBindGroup(0, this._uBG, [passU]); kind = 1; }
        pass.setBindGroup(1, c.bg);
        pass.drawIndexed(c.count, 1, c.first, c.base, 0);
      } else if (c.t === 4) {
        var fp = this._filterPipeline(c.filter, c.blend, msaa);
        if (!fp) continue;
        var bg = this.device.createBindGroup({ layout: this._fBGL, entries: [
          { binding: 0, resource: { buffer: this._uBuf, offset: 0, size: 208 } },
          { binding: 1, resource: c.v1 }, { binding: 2, resource: c.v2 }, { binding: 3, resource: linear }] });
        if (fp !== curPipe) { pass.setPipeline(fp); curPipe = fp; }
        pass.setBindGroup(0, bg, [c.uOff]); kind = 2;
        pass.draw(6);
        c.v1 = null; c.v2 = null; c.filter = null;
      }
      if (c.t === 2) c.bg = null;
      else if (c.t === 1) c.rtView = null;
    }
    if (pass) pass.end();
    q.submit([enc.finish()]);
    this._cmdN = 0; this._vUsed = 0; this._iUsed = 0; this._uUsed = 0; this._qUsed = 0;
    if (this._r3d) this._r3d._afterSubmit();
    this._flushPending();
  }
  _endFrameBackend() { this._submit(); this._canvasView = null; }
  /** Envía lo grabado a mitad de frame y reabre el destino actual (para lecturas). */
  _flushMidFrame() {
    this.batcher.flush();
    var keepCanvas = this._canvasView;
    this._submit();
    this._canvasView = keepCanvas;
    var st = this.currentTarget;
    if (st) { this._bindTarget(st, false, 0, 0); this._applyScissor(st.scissor, st); }
  }
  _readTarget(rt) {
    var self = this, dev = this.device;
    if (this._inFrame) this._flushMidFrame();
    else this._submit();
    var d = this._ensureTexture(rt.source), w = d.w, h = d.h;
    var bpr = Math.ceil(w * 4 / 256) * 256;
    var buf = dev.createBuffer({ size: bpr * h, usage: GLOBAL.GPUBufferUsage.COPY_DST | GLOBAL.GPUBufferUsage.MAP_READ });
    var enc = dev.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: d.tex }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: h }, { width: w, height: h });
    dev.queue.submit([enc.finish()]);
    var bgra = d.format === 'bgra8unorm';
    return buf.mapAsync(GLOBAL.GPUMapMode.READ).then(function () {
      var src = new Uint8Array(buf.getMappedRange()), out = new Uint8ClampedArray(w * h * 4);
      for (var y = 0; y < h; y++) {
        var so = y * bpr, doff = y * w * 4;
        if (bgra) { for (var x = 0; x < w * 4; x += 4) { out[doff + x] = src[so + x + 2]; out[doff + x + 1] = src[so + x + 1]; out[doff + x + 2] = src[so + x]; out[doff + x + 3] = src[so + x + 3]; } }
        else out.set(src.subarray(so, so + w * 4), doff);
      }
      buf.unmap(); buf.destroy();
      void self;
      return { width: w, height: h, data: out };
    });
  }
  destroy() {
    if (this.destroyed) return;
    var self = this;
    if (this._r3d) { try { this._r3d.destroy(); } catch (e0) { /* ignorar */ } this._r3d = null; }
    Array.from(this._liveSources).forEach(function (src) { self.freeSource(src); });
    super.destroy();
    this._flushPending();
    var bufs = [this._vBuf, this._iBuf, this._uBuf, this._qBuf];
    if (this._cornerBuf) { try { this._cornerBuf.destroy(); } catch (e0) { /* */ } }
    for (var i = 0; i < bufs.length; i++) if (bufs[i]) { try { bufs[i].destroy(); } catch (e) { /* ignorar */ } Debug.track('GPUBuffer', -1); }
    if (this._msaaTex) this._msaaTex.destroy();
    if (this._dummy) this._dummy.destroy();
    this._bgCache.clear(); this._pipes.clear(); this._samplers.clear();
    if (this._filterModules) this._filterModules.clear();
    try { if (this.context) this.context.unconfigure(); } catch (e2) { /* ignorar */ }
    var dev = this.device; this.device = null;
    if (dev) { try { dev.destroy(); } catch (e3) { /* ignorar */ } }
    this.batcher = null; this.canvas = null; this.context = null;
  }
}

UG.WebGPURenderer = WebGPURenderer;
