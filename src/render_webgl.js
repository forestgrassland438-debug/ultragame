/* UltraGame - backend WebGL2 / WebGL1.
 * Shaders GLSL ES 1.00 (válidos en ambos contextos), batch multi-textura, anillo de buffers
 * para evitar bloqueos de sincronización, VAO, manejo de pérdida/restauración de contexto. */

var GLSL_FS_PRECISION = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';

var BATCH_VS = 'precision highp float;\n' +
  'attribute vec2 aPos; attribute vec2 aUV; attribute vec4 aColor; attribute float aTex;\n' +
  'uniform vec4 uProj;\n' +
  'varying vec2 vUV; varying vec4 vColor; varying float vTex;\n' +
  'void main(){ vUV = aUV; vColor = aColor; vTex = aTex; gl_Position = vec4(aPos * uProj.xy + uProj.zw, 0.0, 1.0); }';

var INST_VS = 'precision highp float;\n' +
  'attribute vec2 aCorner; attribute vec2 aP0; attribute vec2 aU; attribute vec2 aV; attribute vec4 aUV; attribute vec4 aColor; attribute float aTex;\n' +
  'uniform vec4 uProj;\n' +
  'varying vec2 vUV; varying vec4 vColor; varying float vTex;\n' +
  'void main(){ vec2 p = aP0 + aU * aCorner.x + aV * aCorner.y; vUV = mix(aUV.xy, aUV.zw, aCorner); vColor = aColor; vTex = aTex; gl_Position = vec4(p * uProj.xy + uProj.zw, 0.0, 1.0); }';

function batchFS(n) {
  var s = GLSL_FS_PRECISION + 'varying vec2 vUV; varying vec4 vColor; varying float vTex;\nuniform sampler2D uTex[' + n + '];\nvoid main(){\n vec4 c;\n';
  if (n === 1) s += ' c = texture2D(uTex[0], vUV);\n';
  else {
    for (var i = 0; i < n; i++) {
      if (i === 0) s += ' if (vTex < 0.5) c = texture2D(uTex[0], vUV);\n';
      else if (i < n - 1) s += ' else if (vTex < ' + (i + 0.5).toFixed(1) + ') c = texture2D(uTex[' + i + '], vUV);\n';
      else s += ' else c = texture2D(uTex[' + i + '], vUV);\n';
    }
  }
  return s + ' gl_FragColor = c * vColor;\n}';
}

var FILTER_VS = 'precision highp float;\nattribute vec2 aPos;\nuniform vec4 uOutClip; uniform vec2 uUVScale;\n' +
  'varying vec2 vUV; varying vec2 vCoord;\n' +
  'void main(){ vCoord = aPos; vUV = aPos * uUVScale; gl_Position = vec4(mix(uOutClip.xy, uOutClip.zw, aPos), 0.0, 1.0); }';
var FILTER_FS_HEAD = GLSL_FS_PRECISION +
  'varying vec2 vUV; varying vec2 vCoord;\n' +
  'uniform sampler2D uSampler; uniform sampler2D uSampler2;\n' +
  'uniform vec4 uInputSize; uniform vec4 uFrame; uniform vec4 uClamp; uniform vec4 uGlobal; uniform vec4 uP[8];\n' +
  'vec4 sampleTex(vec2 uv){ return texture2D(uSampler, clamp(uv, uClamp.xy, uClamp.zw)); }\n' +
  'vec4 sampleTex2(vec2 uv){ return texture2D(uSampler2, clamp(uv, uClamp.xy, uClamp.zw)); }\n' +
  'float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }\n' +
  'float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }\n' +
  'vec2 texel(){ return uInputSize.zw; }\n' +
  'vec2 pixelPos(vec2 coord){ return coord * uFrame.zw / uGlobal.y; }\n' +
  'vec2 frameSize(){ return uFrame.zw / uGlobal.y; }\n';
var FILTER_FS_TAIL = '\nvoid main(){ gl_FragColor = filterMain(vUV, vCoord); }\n';

class WebGLRenderer extends GPURenderer {
  constructor(options) {
    super(options);
    this.type = 'webgl';
    this.gl = null;
    this.isWebGL2 = false;
    this._ctxVersion = 0;
    this._liveSources = new Set();
    this._programs = new Map();
    this._boundTex = [];
    this._blendMode = -2;
    this._blendEq = -1;
    this._projVer = 0;
    this._batchProjVer = -1;
    this._currentProgram = null;
    this._rtFlipY = false;
    this._dom = new DOMListeners();
  }
  init(canvas) {
    this.canvas = canvas;
    var o = this.options;
    var attrs = {
      alpha: !!o.transparent, antialias: o.antialias !== false, premultipliedAlpha: true,
      preserveDrawingBuffer: !!o.preserveDrawingBuffer, stencil: false, depth: false,
      powerPreference: o.powerPreference || 'high-performance', failIfMajorPerformanceCaveat: false,
      desynchronized: !!o.desynchronized
    };
    var gl = null;
    if (!o.forceWebGL1) { try { gl = canvas.getContext('webgl2', attrs); } catch (e) { gl = null; } }
    if (gl) this.isWebGL2 = true;
    else {
      try { gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs); } catch (e2) { gl = null; }
    }
    if (!gl) return Promise.reject(new Error('WebGL no disponible'));
    this.gl = gl;
    this.type = this.isWebGL2 ? 'webgl2' : 'webgl';
    var self = this;
    this._dom.add(canvas, 'webglcontextlost', function (e) { e.preventDefault(); self.contextLost = true; self.emit('contextlost'); Log.warn('Contexto WebGL perdido'); }, false);
    this._dom.add(canvas, 'webglcontextrestored', function () { self._restore(); }, false);
    this._setupGL();
    this.resize(this.width, this.height, this.resolution);
    return Promise.resolve(this);
  }
  _setupGL() {
    var gl = this.gl;
    this._ctxVersion++;
    this._extVAO = this.isWebGL2 ? null : gl.getExtension('OES_vertex_array_object');
    this._extMinMax = this.isWebGL2 ? { MIN_EXT: gl.MIN, MAX_EXT: gl.MAX } : gl.getExtension('EXT_blend_minmax');
    this._extLose = gl.getExtension('WEBGL_lose_context');
    this._extInst = this.isWebGL2 ? null : gl.getExtension('ANGLE_instanced_arrays');
    this.instancing = (this.isWebGL2 || !!this._extInst) && this.options.instancing !== false;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
    this.supportsNPOTRepeat = this.isWebGL2;
    var units = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) || 8;
    var n = Math.min(16, units, this.options.maxTextures || 16);
    this._batchProgram = null;
    while (n >= 1 && !this._batchProgram) {
      this._batchProgram = this._compile(BATCH_VS, batchFS(n), ['aPos', 'aUV', 'aColor', 'aTex'], true);
      if (!this._batchProgram) n = n >> 1;
    }
    if (!this._batchProgram) throw new Error('UltraGame: no se pudo compilar el shader de batch');
    var p = this._batchProgram;
    p.uProj = gl.getUniformLocation(p.p, 'uProj');
    gl.useProgram(p.p);
    var samplers = new Int32Array(n); for (var i = 0; i < n; i++) samplers[i] = i;
    gl.uniform1iv(gl.getUniformLocation(p.p, 'uTex[0]') || gl.getUniformLocation(p.p, 'uTex'), samplers);
    this.maxTextures = n;
    this._instProgram = null;
    if (this.instancing) {
      this._instProgram = this._compile(INST_VS, batchFS(n), ['aCorner', 'aP0', 'aU', 'aV', 'aUV', 'aColor', 'aTex'], true);
      if (this._instProgram) {
        var ip = this._instProgram; ip.uProj = gl.getUniformLocation(ip.p, 'uProj'); gl.useProgram(ip.p);
        gl.uniform1iv(gl.getUniformLocation(ip.p, 'uTex[0]') || gl.getUniformLocation(ip.p, 'uTex'), samplers);
      } else this.instancing = false;
    }
    if (!this.batcher || this.batcher.maxTextures !== n || this.batcher.instancing !== this.instancing) this.batcher = new Batcher(this, n, 65532, this.instancing);
    this._sets = [];
    for (var s = 0; s < 3; s++) this._sets.push(this._createBufferSet(16384));
    this._cornerBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this._isets = [];
    if (this.instancing) for (var si = 0; si < 3; si++) this._isets.push(this._createInstSet(4096));
    this._isetIdx = 0;
    var q = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, q);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this._quadBuf = q;
    this._filterVAO = this._createVAO();
    if (this._filterVAO) {
      this._bindVAO(this._filterVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, q);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this._bindVAO(null);
    }
    this._setIdx = 0;
    this._programs.clear();
    this._boundTex = new Array(Math.max(16, n)).fill(null);
    this._blendMode = -2; this._blendEq = -1; this._currentProgram = null; this._batchProjVer = -1; this._instProjVer = -1;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.STENCIL_TEST); gl.disable(gl.SCISSOR_TEST);
    gl.enable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }
  _createVAO() {
    var gl = this.gl;
    if (this.isWebGL2) return gl.createVertexArray();
    if (this._extVAO) return this._extVAO.createVertexArrayOES();
    return null;
  }
  _bindVAO(v) {
    if (this.isWebGL2) this.gl.bindVertexArray(v);
    else if (this._extVAO) this._extVAO.bindVertexArrayOES(v);
  }
  _createBufferSet(capVerts) {
    var gl = this.gl;
    var set = { vbo: gl.createBuffer(), ibo: gl.createBuffer(), vao: this._createVAO(), vCap: capVerts * BYTES_PER_VERTEX, iCap: capVerts * 3 * 2 };
    gl.bindBuffer(gl.ARRAY_BUFFER, set.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, set.vCap, gl.DYNAMIC_DRAW);
    if (set.vao) {
      this._bindVAO(set.vao);
      this._setupBatchAttribs(set);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, set.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, set.iCap, gl.DYNAMIC_DRAW);
      this._bindVAO(null);
    } else {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, set.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, set.iCap, gl.DYNAMIC_DRAW);
    }
    Debug.track('GPUBuffer', 2);
    return set;
  }
  _divisor(i, d) { if (this.isWebGL2) this.gl.vertexAttribDivisor(i, d); else if (this._extInst) this._extInst.vertexAttribDivisorANGLE(i, d); }
  _createInstSet(cap) {
    var gl = this.gl;
    var set = { buf: gl.createBuffer(), vao: this._createVAO(), cap: cap * INST_BYTES };
    gl.bindBuffer(gl.ARRAY_BUFFER, set.buf);
    gl.bufferData(gl.ARRAY_BUFFER, set.cap, gl.DYNAMIC_DRAW);
    if (set.vao) { this._bindVAO(set.vao); this._setupInstAttribs(set); this._bindVAO(null); }
    Debug.track('GPUBuffer', 1);
    return set;
  }
  _setupInstAttribs(set) {
    var gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._cornerBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); this._divisor(0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, set.buf);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, INST_BYTES, 0); this._divisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, INST_BYTES, 8); this._divisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, INST_BYTES, 16); this._divisor(3, 1);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.UNSIGNED_SHORT, true, INST_BYTES, 24); this._divisor(4, 1);
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 4, gl.UNSIGNED_BYTE, true, INST_BYTES, 32); this._divisor(5, 1);
    gl.enableVertexAttribArray(6); gl.vertexAttribPointer(6, 1, gl.FLOAT, false, INST_BYTES, 36); this._divisor(6, 1);
  }
  _resetAttribsNoVAO() {
    var gl = this.gl;
    for (var i = 1; i <= 6; i++) this._divisor(i, 0);
    for (var j = 4; j <= 6; j++) gl.disableVertexAttribArray(j);
  }
  _setupBatchAttribs(set) {
    var gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, set.vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, BYTES_PER_VERTEX, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, BYTES_PER_VERTEX, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, BYTES_PER_VERTEX, 16);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, BYTES_PER_VERTEX, 20);
  }
  _compile(vsSrc, fsSrc, attribs, quiet) {
    var gl = this.gl;
    var mk = function (type, src) {
      var sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { var log = gl.getShaderInfoLog(sh); gl.deleteShader(sh); throw new Error(log); }
      return sh;
    };
    var vs = null, fs = null;
    try {
      vs = mk(gl.VERTEX_SHADER, vsSrc); fs = mk(gl.FRAGMENT_SHADER, fsSrc);
      var p = gl.createProgram();
      gl.attachShader(p, vs); gl.attachShader(p, fs);
      for (var i = 0; i < attribs.length; i++) gl.bindAttribLocation(p, i, attribs[i]);
      gl.linkProgram(p);
      gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { var l = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error(l); }
      return { p: p };
    } catch (e) {
      if (!quiet || !gl.isContextLost()) (quiet ? Log.warn : Log.error).call(Log, 'Error compilando shader:', e.message);
      return null;
    }
  }
  _getFilterProgram(filter) {
    var key = filter.key, prog = this._programs.get(key);
    if (prog !== undefined) return prog;
    if (!filter.glsl) { Log.warnOnce('noglsl:' + key, 'El filtro ' + key + ' no tiene GLSL'); this._programs.set(key, null); return null; }
    prog = this._compile(FILTER_VS, FILTER_FS_HEAD + filter.glsl + FILTER_FS_TAIL, ['aPos']);
    if (prog) {
      var gl = this.gl, p = prog.p;
      prog.uOutClip = gl.getUniformLocation(p, 'uOutClip'); prog.uUVScale = gl.getUniformLocation(p, 'uUVScale');
      prog.uInputSize = gl.getUniformLocation(p, 'uInputSize'); prog.uFrame = gl.getUniformLocation(p, 'uFrame');
      prog.uClamp = gl.getUniformLocation(p, 'uClamp'); prog.uGlobal = gl.getUniformLocation(p, 'uGlobal');
      prog.uP = gl.getUniformLocation(p, 'uP[0]') || gl.getUniformLocation(p, 'uP');
      gl.useProgram(p);
      gl.uniform1i(gl.getUniformLocation(p, 'uSampler'), 0);
      var s2 = gl.getUniformLocation(p, 'uSampler2'); if (s2) gl.uniform1i(s2, 1);
      this._currentProgram = null;
    }
    this._programs.set(key, prog);
    return prog;
  }
  _restore() {
    Log.info('Contexto WebGL restaurado');
    var uidR = this.uid;
    this._liveSources.forEach(function (src) { delete src._gpu[uidR]; });
    this._liveSources.clear();
    this.stats.textures = 0;
    this.pool.clear();
    this._setupGL();
    this.contextLost = false;
    this.emit('contextrestored');
  }
  _onResize() { this._projVer++; }

  /* ---------- texturas ---------- */
  _bindSource(src, unit) {
    var gl = this.gl, d = src._gpu[this.uid];
    if (!d || d.version !== src.version || d.ctx !== this._ctxVersion || (d.video && d.frame !== this.stats.frame)) return this._upload(src, unit);
    if (this._boundTex[unit] !== d.tex) {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, d.tex); this._boundTex[unit] = d.tex;
    }
    return d;
  }
  _upload(src, unit) {
    var gl = this.gl, d = src._gpu[this.uid];
    if (!d || d.ctx !== this._ctxVersion) {
      d = { tex: gl.createTexture(), version: -1, w: 0, h: 0, fbo: null, ctx: this._ctxVersion, video: false, frame: -1 };
      src._gpu[this.uid] = d; this._liveSources.add(src); this.stats.textures++; Debug.track('GPUTexture', 1);
    }
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, d.tex); this._boundTex[unit] = d.tex;
    var w = src.width, h = src.height, res = src.resource;
    if (src.isRenderTarget) {
      if (d.w !== w || d.h !== h) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); d.w = w; d.h = h; }
    } else if (res) {
      try {
        if (res.data) {
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !src.premultiplied);
          var data = res.data instanceof Uint8Array ? res.data : new Uint8Array(res.data.buffer || res.data);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, res.width, res.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
          d.w = res.width; d.h = res.height;
        } else {
          var upl = res, max = this.maxTextureSize;
          if (w > max || h > max) {
            var sc = Math.min(max / w, max / h), c = createCanvas(Math.floor(w * sc), Math.floor(h * sc));
            c.getContext('2d').drawImage(res, 0, 0, c.width, c.height); upl = c;
            Log.warnOnce('downscale:' + src.uid, 'Textura ' + w + 'x' + h + ' reducida a ' + c.width + 'x' + c.height + ' (MAX_TEXTURE_SIZE=' + max + ')');
          }
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          var isVid = typeof HTMLVideoElement !== 'undefined' && res instanceof HTMLVideoElement;
          if (d.w === upl.width && d.h === upl.height && d.version > 0 && !isVid && !(res instanceof HTMLImageElementSafe())) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, upl);
          else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, upl);
          d.w = upl.width || w; d.h = upl.height || h;
          d.video = isVid; d.frame = this.stats.frame;
          if (upl !== res) releaseCanvas(upl);
        }
      } catch (e) {
        Log.warnOnce('upload:' + src.uid, 'No se pudo subir la textura (¿imagen de otro origen sin CORS?):', e.message);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 0, 255, 255]));
        d.w = 1; d.h = 1;
      }
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    }
    var nearest = src.scaleMode === 'nearest';
    var pow2 = MathUtils.isPowerOfTwo(d.w) && MathUtils.isPowerOfTwo(d.h);
    var mip = src.mipmap && !src.isRenderTarget && (this.isWebGL2 || pow2);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? (nearest ? gl.NEAREST_MIPMAP_NEAREST : gl.LINEAR_MIPMAP_LINEAR) : (nearest ? gl.NEAREST : gl.LINEAR));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
    var canRepeat = this.isWebGL2 || pow2;
    var wrap = (src.wrapMode === 'repeat' && canRepeat) ? gl.REPEAT : ((src.wrapMode === 'mirror' && canRepeat) ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    d.version = src.version;
    return d;
  }
  freeSource(src) {
    var d = src._gpu[this.uid]; if (!d) return;
    delete src._gpu[this.uid];
    this._liveSources.delete(src);
    if (this.gl && d.ctx === this._ctxVersion && !this.gl.isContextLost()) {
      for (var i = 0; i < this._boundTex.length; i++) if (this._boundTex[i] === d.tex) this._boundTex[i] = null;
      this.gl.deleteTexture(d.tex);
      if (d.fbo) this.gl.deleteFramebuffer(d.fbo);
    }
    this.stats.textures--; Debug.track('GPUTexture', -1);
  }
  _ensureRT(rt) {
    var gl = this.gl, src = rt.source;
    var unit = this.maxTextures - 1;
    var d = this._bindSource(src, unit);
    for (var i = 0; i < this._boundTex.length; i++) {
      if (this._boundTex[i] === d.tex) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, null); this._boundTex[i] = null; }
    }
    if (!d.fbo) {
      d.fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, d.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, d.tex, 0);
    }
    return d;
  }

  /* ---------- estado ---------- */
  _bindTarget(st, clear, color, alpha) {
    var gl = this.gl;
    if (st.rt) { var d = this._ensureRT(st.rt); gl.bindFramebuffer(gl.FRAMEBUFFER, d.fbo); }
    else gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, st.pw, st.ph);
    this._projVer++;
    if (clear) {
      gl.disable(gl.SCISSOR_TEST);
      var a = alpha, c = color;
      gl.clearColor(((c >> 16) & 255) / 255 * a, ((c >> 8) & 255) / 255 * a, (c & 255) / 255 * a, a);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }
  _applyScissor(sc, st) {
    var gl = this.gl;
    if (!sc) { gl.disable(gl.SCISSOR_TEST); return; }
    gl.enable(gl.SCISSOR_TEST);
    var y = st.flip ? st.ph - (sc[1] + sc[3]) : sc[1];
    gl.scissor(sc[0], y, sc[2], sc[3]);
  }
  _setBlend(mode) {
    if (mode === this._blendMode) return;
    this._blendMode = mode;
    var gl = this.gl, eq = gl.FUNC_ADD;
    if (mode === BLEND.NONE) { gl.disable(gl.BLEND); return; }
    gl.enable(gl.BLEND);
    switch (mode) {
      case BLEND.ADD: gl.blendFunc(gl.ONE, gl.ONE); break;
      case BLEND.MULTIPLY: gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); break;
      case BLEND.SCREEN: gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); break;
      case BLEND.ERASE: gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA); break;
      case BLEND.LIGHTEN: if (this._extMinMax) { eq = this._extMinMax.MAX_EXT; gl.blendFunc(gl.ONE, gl.ONE); } else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); break;
      case BLEND.DARKEN: if (this._extMinMax) { eq = this._extMinMax.MIN_EXT; gl.blendFunc(gl.ONE, gl.ONE); } else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); break;
      default: gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    if (eq !== this._blendEq) { gl.blendEquation(eq); this._blendEq = eq; }
  }
  _beginFrameBackend() { }
  _endFrameBackend() { if (this.gl) this._bindVAO(null); }

  /* ---------- dibujo ---------- */
  _drawBatch(b) {
    var gl = this.gl; if (!gl || this.contextLost) return;
    if (b.instCount > 0) { this._drawInstanced(b); return; }
    var p = this._batchProgram;
    if (this._currentProgram !== p) { gl.useProgram(p.p); this._currentProgram = p; this._batchProjVer = -1; }
    if (this._batchProjVer !== this._projVer) { gl.uniform4fv(p.uProj, this._proj); this._batchProjVer = this._projVer; }
    for (var i = 0; i < b.texCount; i++) this._bindSource(b.textures[i], i);
    this._setBlend(b.blend);
    var set = this._sets[this._setIdx]; this._setIdx = (this._setIdx + 1) % this._sets.length;
    var vBytes = b.vCount * BYTES_PER_VERTEX, iBytes = b.iCount * 2;
    if (set.vao) this._bindVAO(set.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, set.vbo);
    if (set.vCap < vBytes) { set.vCap = Math.min(b.maxVerts * BYTES_PER_VERTEX, MathUtils.nextPowerOfTwo(vBytes)); gl.bufferData(gl.ARRAY_BUFFER, set.vCap, gl.DYNAMIC_DRAW); }
    if (this.isWebGL2) gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.f32, 0, b.vCount * FLOATS_PER_VERTEX);
    else gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.f32.subarray(0, b.vCount * FLOATS_PER_VERTEX));
    if (!set.vao) { if (this.instancing) this._resetAttribsNoVAO(); this._setupBatchAttribs(set); }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, set.ibo);
    if (set.iCap < iBytes) { set.iCap = Math.min(b.maxIndices * 2, MathUtils.nextPowerOfTwo(iBytes)); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, set.iCap, gl.DYNAMIC_DRAW); }
    if (this.isWebGL2) gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, b.iData, 0, b.iCount);
    else gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, b.iData.subarray(0, b.iCount));
    gl.drawElements(gl.TRIANGLES, b.iCount, gl.UNSIGNED_SHORT, 0);
    this.stats.drawCalls++;
  }
  _drawInstanced(b) {
    var gl = this.gl, p = this._instProgram;
    if (this._currentProgram !== p) { gl.useProgram(p.p); this._currentProgram = p; this._instProjVer = -1; }
    if (this._instProjVer !== this._projVer) { gl.uniform4fv(p.uProj, this._proj); this._instProjVer = this._projVer; }
    for (var i = 0; i < b.texCount; i++) this._bindSource(b.textures[i], i);
    this._setBlend(b.blend);
    var set = this._isets[this._isetIdx]; this._isetIdx = (this._isetIdx + 1) % this._isets.length;
    var bytes = b.instCount * INST_BYTES;
    if (set.vao) this._bindVAO(set.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, set.buf);
    if (set.cap < bytes) { set.cap = Math.min(b.maxInst * INST_BYTES, MathUtils.nextPowerOfTwo(bytes)); gl.bufferData(gl.ARRAY_BUFFER, set.cap, gl.DYNAMIC_DRAW); }
    if (this.isWebGL2) gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.if32, 0, b.instCount * INST_WORDS);
    else gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.if32.subarray(0, b.instCount * INST_WORDS));
    if (!set.vao) this._setupInstAttribs(set);
    if (this.isWebGL2) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b.instCount);
    else this._extInst.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, b.instCount);
    if (!set.vao) this._resetAttribsNoVAO();
    this.stats.drawCalls++;
  }
  _filterPassBackend(filter, input, input2, u, blend) {
    var gl = this.gl; if (!gl || this.contextLost) return;
    var prog = this._getFilterProgram(filter); if (!prog) return;
    gl.useProgram(prog.p); this._currentProgram = prog;
    this._bindSource(input.source, 0);
    if (filter.twoInputs) this._bindSource(input2.source, 1);
    gl.uniform4f(prog.uOutClip, u[0], u[1], u[2], u[3]);
    gl.uniform2f(prog.uUVScale, u[10] * u[6], u[11] * u[7]);
    gl.uniform4f(prog.uInputSize, u[4], u[5], u[6], u[7]);
    gl.uniform4f(prog.uFrame, u[8], u[9], u[10], u[11]);
    gl.uniform4f(prog.uClamp, u[12], u[13], u[14], u[15]);
    gl.uniform4f(prog.uGlobal, u[16], u[17], u[18], u[19]);
    if (prog.uP) gl.uniform4fv(prog.uP, this._uPView || (this._uPView = u.subarray(20, 52)));
    this._setBlend(blend);
    if (this._filterVAO) this._bindVAO(this._filterVAO);
    else {
      this._bindVAO(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._quadBuf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2); gl.disableVertexAttribArray(3);
      if (this.instancing) this._resetAttribsNoVAO();
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!this._filterVAO) this._bindVAO(null);
  }
  _readTarget(rt) {
    var gl = this.gl;
    var self = this;
    return this._withFrame(function () {
      self.batcher.flush();
      var d = self._ensureRT(rt), w = rt.source.width, h = rt.source.height;
      gl.bindFramebuffer(gl.FRAMEBUFFER, d.fbo);
      var buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      var st = self.currentTarget;
      if (st) self._bindTarget(st, false); else gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { width: w, height: h, data: new Uint8ClampedArray(buf.buffer) };
    });
  }
  /** Lee píxeles del canvas (llamar justo tras render, p.ej. en 'postrender'). */
  readScreenPixels(x, y, w, h) {
    var gl = this.gl, buf = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(x, this.canvas.height - y - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    // voltear filas (GL tiene origen abajo)
    var row = w * 4, tmp = new Uint8Array(row);
    for (var r = 0; r < (h >> 1); r++) {
      var a = r * row, b = (h - 1 - r) * row;
      tmp.set(buf.subarray(a, a + row)); buf.copyWithin(a, b, b + row); buf.set(tmp, b);
    }
    return { width: w, height: h, data: unpremultiply(new Uint8ClampedArray(buf.buffer)) };
  }
  loseContext() { if (this._extLose) this._extLose.loseContext(); }
  restoreContext() { if (this._extLose) this._extLose.restoreContext(); }
  destroy() {
    if (this.destroyed) return;
    var self = this, gl = this.gl;
    if (this._r3d) { try { this._r3d.destroy(); } catch (e0) { /* ignorar */ } this._r3d = null; }
    Array.from(this._liveSources).forEach(function (src) { self.freeSource(src); });
    super.destroy();
    if (gl && !gl.isContextLost()) {
      this._programs.forEach(function (p) { if (p) gl.deleteProgram(p.p); });
      if (this._batchProgram) gl.deleteProgram(this._batchProgram.p);
      for (var i = 0; i < this._sets.length; i++) {
        gl.deleteBuffer(this._sets[i].vbo); gl.deleteBuffer(this._sets[i].ibo);
        if (this._sets[i].vao) { if (this.isWebGL2) gl.deleteVertexArray(this._sets[i].vao); else if (this._extVAO) this._extVAO.deleteVertexArrayOES(this._sets[i].vao); }
        Debug.track('GPUBuffer', -2);
      }
      gl.deleteBuffer(this._quadBuf);
      if (this._cornerBuf) gl.deleteBuffer(this._cornerBuf);
      if (this._instProgram) gl.deleteProgram(this._instProgram.p);
      for (var k = 0; k < this._isets.length; k++) {
        gl.deleteBuffer(this._isets[k].buf);
        if (this._isets[k].vao) { if (this.isWebGL2) gl.deleteVertexArray(this._isets[k].vao); else if (this._extVAO) this._extVAO.deleteVertexArrayOES(this._isets[k].vao); }
        Debug.track('GPUBuffer', -1);
      }
      this._isets = [];
      if (this._filterVAO) { if (this.isWebGL2) gl.deleteVertexArray(this._filterVAO); else if (this._extVAO) this._extVAO.deleteVertexArrayOES(this._filterVAO); }
      // Liberar el contexto inmediatamente: los navegadores limitan los contextos WebGL activos.
      if (this._extLose && this.options.loseContextOnDestroy !== false) { try { this._extLose.loseContext(); } catch (e) { /* ignorar */ } }
    }
    this._dom.removeAll();
    this._programs.clear();
    this._sets = [];
    this.gl = null; this.batcher = null; this.canvas = null;
  }
}
function HTMLImageElementSafe() { return typeof HTMLImageElement !== 'undefined' ? HTMLImageElement : function NoImg() {}; }

UG.WebGLRenderer = WebGLRenderer;
