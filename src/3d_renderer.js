/* UltraGame 3D - renderizador: parte común (recolección, culling, orden, sombras, uniformes) y backend WebGL.
 * Cada View3D se dibuja en su propia textura (con profundidad y MSAA) que luego se compone como un sprite:
 * así el HUD 2D, las cámaras 2D y todos los filtros funcionan sobre el 3D. */

var TONEMAP = { none: 0, aces: 1, reinhard: 2 };
var _r3v = new Vec3(), _r3v2 = new Vec3(), _r3v3 = new Vec3(), _r3m = new Mat4(), _r3m2 = new Mat4(), _r3vp = new Mat4();
var _r3UpZ = Object.freeze(new Vec3(0, 0, 1));

class Renderer3D {
  constructor(r) {
    this.r = r;
    // clave propia en RendererRegistry: geometrías y texturas 3D avisan aquí al destruirse
    this.uid = uid(); RendererRegistry.set(this.uid, this);
    this.flipY = false;
    this.stats = { draws: 0, triangles: 0, culled: 0, shadowDraws: 0, programs: 0, frame: -1 };
    this._drawOpaque = []; this._drawTrans = []; this._casters = []; this._lights = { dir: [], point: [], spot: [], hemi: [], amb: [] };
    this._skins = new Set(); this._skinDone = new Set();
    this.destroyed = false;
    this.setLimits(4, 8, 4);
  }
  static get(r) {
    if (r._r3d) return r._r3d;
    if (r.destroyed || r.contextLost) return null;
    if (r.type === 'webgpu') { if (!r.device || typeof WebGPU3D === 'undefined') return null; r._r3d = new WebGPU3D(r); }
    else if (r.gl) r._r3d = new WebGL3D(r);
    else return null;
    return r._r3d;
  }
  setLimits(d, p, s) {
    this.L = frameLayout(d, p, s);
    this.F = new Float32Array(this.L.NF * 4); this.FS = new Float32Array(this.L.NF * 4);
    this.M = new Float32Array(24); this.O = new Float32Array(32);
  }

  /* ---------------------------------------------------------------- recolección */
  _collect(scene, cam) {
    var ops = this._drawOpaque, trs = this._drawTrans, casters = this._casters, L = this._lights, st = this.stats, self = this;
    ops.length = 0; trs.length = 0; casters.length = 0; L.dir.length = 0; L.point.length = 0; L.spot.length = 0; L.hemi.length = 0; L.amb.length = 0;
    this._skins.clear();
    var fr = cam.frustum, cme = cam.matrixWorld.e, cx = cme[12], cy = cme[13], cz = cme[14];
    var fx = -cme[8], fyv = -cme[9], fz = -cme[10], mask = cam.cullMask === undefined ? -1 : cam.cullMask;
    var walk = function (n) {
      if (!n.visible) return;
      if (n.billboard) self._faceCamera(n, cam);
      if (n instanceof Light3D) {
        if (n.intensity > 0) {
          if (n instanceof DirectionalLight) { if (n.useNodeDirection) { var le = n.matrixWorld.e; n.direction.set(-le[8], -le[9], -le[10]).normalize(); } L.dir.push(n); }
          else if (n instanceof PointLight) L.point.push(n);
          else if (n instanceof SpotLight) L.spot.push(n); else if (n instanceof HemisphereLight) L.hemi.push(n); else if (n instanceof AmbientLight) L.amb.push(n);
        }
      } else if (n instanceof Mesh3D && n._geometry && n.material && n._geometry.vertexCount > 0 && (!n.instanced || n.count > 0) && (n.layers & mask) !== 0) {
        if (n.skeleton) self._skins.add(n);
        var ws = n.getWorldSphere();
        if (n.castShadow) casters.push(n);
        if (n.frustumCulled && ws.radius >= 0 && !fr.intersectsSphere(ws)) st.culled++;
        else {
          var m = n.material, trans = m.transparent || m.opacity < 1 || m.blend !== 'normal';
          var depth = (ws.center.x - cx) * fx + (ws.center.y - cy) * fyv + (ws.center.z - cz) * fz;
          var f = self._features(n, 'main');
          var item = { mesh: n, f: f, depth: depth, key: f.key, mat: m.uid, geo: n._geometry.uid };
          if (trans) trs.push(item); else ops.push(item);
        }
      }
      var c = n.children; for (var i = 0; i < c.length; i++) walk(c[i]);
    };
    walk(scene);
    ops.sort(function (a, b) { return (a.mesh.renderOrder - b.mesh.renderOrder) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) || (a.mat - b.mat) || (a.geo - b.geo) || (a.depth - b.depth); });
    trs.sort(function (a, b) { return (a.mesh.renderOrder - b.mesh.renderOrder) || (b.depth - a.depth); });
    // skinning: una vez por esqueleto y frame
    var done = this._skinDone; done.clear();
    this._skins.forEach(function (m) { if (!done.has(m.skeleton)) { m.skeleton.update(m.matrixWorld); done.add(m.skeleton); } });
    // luces puntuales/foco: si hay más que el máximo, las más cercanas a la cámara
    var cp = _r3v3.set(cx, cy, cz);
    var byDist = function (a, b) { return a.getWorldPosition(_r3v).distanceToSq(cp) - b.getWorldPosition(_r3v2).distanceToSq(cp); };
    if (L.point.length > this.L.maxPoint) L.point.sort(byDist);
    if (L.spot.length > this.L.maxSpot) L.spot.sort(byDist);
    // la luz direccional con sombra va primero (solo la 0 proyecta sombra)
    L.dir.sort(function (x, y) { return (y.shadow.enabled ? 1 : 0) - (x.shadow.enabled ? 1 : 0); });
  }
  /** Orienta un billboard hacia la cámara (true: de frente; 'y': gira solo en Y, como árboles lejanos) */
  _faceCamera(n, cam) {
    var e = n.matrixWorld.e, px = e[12], pz = e[14];
    var sx = Math.hypot(e[0], e[1], e[2]), sy = Math.hypot(e[4], e[5], e[6]), sz = Math.hypot(e[8], e[9], e[10]);
    var c = cam.matrixWorld.e;
    if (n.billboard === 'y') {
      var dx = c[12] - px, dz = c[14] - pz, l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      e[0] = dz * sx; e[1] = 0; e[2] = -dx * sx; e[4] = 0; e[5] = sy; e[6] = 0; e[8] = dx * sz; e[9] = 0; e[10] = dz * sz;
    } else {
      e[0] = c[0] * sx; e[1] = c[1] * sx; e[2] = c[2] * sx; e[4] = c[4] * sy; e[5] = c[5] * sy; e[6] = c[6] * sy; e[8] = c[8] * sz; e[9] = c[9] * sz; e[10] = c[10] * sz;
    }
  }
  /** Rasgos de shader cacheados por malla (se recalculan si cambia el material o la geometría) */
  _features(mesh, pass) {
    var m = mesh.material, g = mesh._geometry;
    var sig = m.uid + ':' + m.version + ':' + g.uid + ':' + g.version + ':' + (mesh.receiveShadow ? 1 : 0) + (mesh.useInstanceColor ? 1 : 0) + (mesh.skeleton ? 1 : 0);
    var c = mesh._fc || (mesh._fc = {});
    var e = c[pass];
    if (e && e.sig === sig) return e.f;
    var f = shaderFeatures(m, mesh, pass);
    c[pass] = { sig: sig, f: f };
    return f;
  }

  /* ---------------------------------------------------------------- uniformes */
  _packFrame(scene, cam, viewProj, time) {
    var F = this.F, L = this.L, Ls = this._lights, i, o, k;
    F.fill(0);
    F.set(viewProj.e, 0);
    var cm = cam.matrixWorld.e;
    F[16] = cm[12]; F[17] = cm[13]; F[18] = cm[14]; F[19] = time;
    var fog = scene.fog;
    if (fog) { var fc = Color.toNumber(fog.color); F[20] = ((fc >> 16) & 255) / 255; F[21] = ((fc >> 8) & 255) / 255; F[22] = (fc & 255) / 255; F[23] = fog.type === 'exp2' ? 2 : 1; F[24] = fog.near || 0; F[25] = fog.far || 0; F[26] = fog.density || 0; }
    F[27] = scene.exposure > 0 ? scene.exposure : 1;
    var sky = [0, 0, 0], gnd = [0, 0, 0], amb = [0, 0, 0];
    for (i = 0; i < Ls.hemi.length; i++) { var h = Ls.hemi[i]; for (k = 0; k < 3; k++) { sky[k] += h.linearColor[k] * h.intensity; gnd[k] += h.linearGround[k] * h.intensity; } }
    for (i = 0; i < Ls.amb.length; i++) { var a = Ls.amb[i]; for (k = 0; k < 3; k++) amb[k] += a.linearColor[k] * a.intensity; }
    var tm = TONEMAP[scene.toneMapping];
    F[28] = sky[0]; F[29] = sky[1]; F[30] = sky[2]; F[31] = tm !== undefined ? tm : 1;
    F[32] = gnd[0]; F[33] = gnd[1]; F[34] = gnd[2]; F[35] = scene.envIntensity;
    var nD = Math.min(Ls.dir.length, L.maxDir), nP = Math.min(Ls.point.length, L.maxPoint), nS = Math.min(Ls.spot.length, L.maxSpot);
    F[36] = nD; F[37] = nP; F[38] = nS; F[39] = 0;
    F[60] = amb[0]; F[61] = amb[1]; F[62] = amb[2];
    F[63] = -1; // signo de dFdy: siempre renderizamos a textura con la fila 0 arriba (WebGL volteado y WebGPU)
    for (i = 0; i < nD; i++) { var d = Ls.dir[i], lc = d.linearColor; o = (L.D0 + i * 2) * 4; F[o] = d.direction.x; F[o + 1] = d.direction.y; F[o + 2] = d.direction.z; F[o + 4] = lc[0] * d.intensity; F[o + 5] = lc[1] * d.intensity; F[o + 6] = lc[2] * d.intensity; }
    for (i = 0; i < nP; i++) { var p = Ls.point[i], pc = p.linearColor; p.getWorldPosition(_r3v); o = (L.P0 + i * 2) * 4; F[o] = _r3v.x; F[o + 1] = _r3v.y; F[o + 2] = _r3v.z; F[o + 3] = p.range; F[o + 4] = pc[0] * p.intensity; F[o + 5] = pc[1] * p.intensity; F[o + 6] = pc[2] * p.intensity; F[o + 7] = p.decay; }
    for (i = 0; i < nS; i++) {
      var s = Ls.spot[i], sc = s.linearColor; s.getWorldPosition(_r3v); s.getWorldDirection(_r3v2); o = (L.S0 + i * 3) * 4;
      F[o] = _r3v.x; F[o + 1] = _r3v.y; F[o + 2] = _r3v.z; F[o + 3] = s.range;
      F[o + 4] = _r3v2.x; F[o + 5] = _r3v2.y; F[o + 6] = _r3v2.z; F[o + 7] = Math.cos(s.angle);
      F[o + 8] = sc[0] * s.intensity; F[o + 9] = sc[1] * s.intensity; F[o + 10] = sc[2] * s.intensity; F[o + 11] = Math.cos(s.angle * (1 - Math.min(0.999, Math.max(0, s.penumbra))));
    }
    // cielo (sRGB) para el fondo y los reflejos
    o = L.K0 * 4;
    var sk = scene.sky, hl = Ls.hemi[0], bg = Color.toNumber(scene.background === null ? 0 : scene.background);
    var put = function (idx, c) { c = Color.toNumber(c); F[o + idx * 4] = ((c >> 16) & 255) / 255; F[o + idx * 4 + 1] = ((c >> 8) & 255) / 255; F[o + idx * 4 + 2] = (c & 255) / 255; };
    if (sk) { put(0, sk.top); put(1, sk.horizon); put(2, sk.bottom); }
    else if (hl) { put(0, hl.color); put(1, Color.lerp(hl.color, hl.groundColor, 0.4)); put(2, hl.groundColor); }
    else { put(0, bg); put(1, bg); put(2, bg); }
    var sun = Ls.dir[0];
    if (sun) { F[o + 12] = sun.direction.x; F[o + 13] = sun.direction.y; F[o + 14] = sun.direction.z; }
    else { F[o + 12] = 0; F[o + 13] = -1; F[o + 14] = 0; }
    F[o + 15] = sk ? sk.sunSize : 0;
    if (sk) put(4, sk.sunColor);
    F[o + 19] = sk && sun ? sk.sunIntensity : 0;
    return F;
  }
  /** Cámara de sombra estable (ajustada a la rejilla de texels para que la sombra no "tiemble") */
  _shadowSetup(light, cam) {
    var sh = light.shadow, dir = light.direction, center = _r3v;
    if (sh.follow && sh.follow.getWorldPosition) sh.follow.getWorldPosition(center);
    else { cam.getWorldPosition(center); cam.getWorldDirection(_r3v2); center.addScaled(_r3v2, sh.size * 0.35); }
    var sc = sh.camera; sc.size = sh.size; sc.aspect = 1; sc.near = sh.near; sc.far = sh.far; sc.updateProjection();
    var dist = sh.far * 0.5;
    sc.position.copy(center).addScaled(dir, -dist);
    _r3m.lookAt(sc.position, center, Math.abs(dir.y) > 0.99 ? _r3UpZ : Vec3.UP); sc.quaternion.setFromRotationMatrix(_r3m);
    sc.parent = null; sc.updateMatrixWorld();
    sc.viewMatrix.invertFrom(sc.matrixWorld);
    var texel = sh.size / Math.max(1, sh.mapSize), lv = sc.viewMatrix, ox = lv.e[12], oy = lv.e[13];
    _r3m2.makeTranslation(Math.round(ox / texel) * texel - ox, Math.round(oy / texel) * texel - oy, 0); sc.viewMatrix.premultiply(_r3m2);
    sc.viewProjection.multiplyMatrices(sc.projectionMatrix, sc.viewMatrix); sc.frustum.setFromMatrix(sc.viewProjection);
    sh.matrix.copy(sc.viewProjection);
    return sc;
  }
  /** ¿El material pide repetir la textura? (tiling) */
  _tiles(m) { return m.uvScale.x !== 1 || m.uvScale.y !== 1 || m.uvOffset.x !== 0 || m.uvOffset.y !== 0 || m.uvRotation !== 0 || m.wrap === 'repeat'; }
  _packMaterial(m, pass) {
    var M = this.M, c = m.linearColor, e = m.linearEmissive, ei = m.emissiveIntensity;
    M[0] = c[0]; M[1] = c[1]; M[2] = c[2]; M[3] = m.opacity;
    M[4] = e[0] * ei; M[5] = e[1] * ei; M[6] = e[2] * ei; M[7] = m.alphaTest;
    M[8] = m.metalness; M[9] = m.roughness; M[10] = m.normalScale; M[11] = m.aoStrength;
    var ox = m.uvOffset.x, oy = m.uvOffset.y, sx = m.uvScale.x, sy = m.uvScale.y, tex = m.map;
    // frame de atlas: se mapea [0,1] al sub-rectángulo (sin repetición)
    if (tex && tex.source && tex.frame && !tex.isFullSource && !tex.rotate) { var fw = tex.source.width, fh = tex.source.height, fr = tex.frame; ox = fr.x / fw + ox * fr.width / fw; oy = fr.y / fh + oy * fr.height / fh; sx *= fr.width / fw; sy *= fr.height / fh; }
    M[12] = ox; M[13] = oy; M[14] = sx; M[15] = sy;
    M[16] = m.uvRotation; M[17] = m.envIntensity; M[18] = m.toonSteps; M[19] = m.rimPower;
    var rc = pass === 'outline' ? m.linearOutline : m.linearRim; M[20] = rc[0]; M[21] = rc[1]; M[22] = rc[2]; M[23] = m.water ? +m.waveHeight || 0 : (+m.wind || 0);
    return M;
  }
  _packObject(mat, jw, jh, outline) {
    var O = this.O; O.set(mat.e, 0); mat.normalMatrix12(O, 16);
    O[28] = jw || 0; O[29] = jh || 0; O[30] = outline || 0; O[31] = 0;
    return O;
  }
  /** Punto de entrada: dibuja una View3D en su textura */
  renderView(view) {
    var scene = view.scene3d, cam = view.camera, st = this.stats;
    if (!scene || !cam || this.destroyed) return;
    if (st.frame !== this.r.stats.frame) { st.frame = this.r.stats.frame; st.draws = 0; st.triangles = 0; st.culled = 0; st.shadowDraws = 0; }
    if (view.autoAspect !== false && cam.aspect !== undefined) { var asp = view.viewWidth / Math.max(1, view.viewHeight); if (Math.abs(cam.aspect - asp) > 1e-6) { cam.aspect = asp; cam.updateProjection(); } }
    scene.updateMatrixWorld();
    cam.updateWorldMatrix(); // cámara dentro o fuera de la escena, con o sin padre
    cam.viewMatrix.invertFrom(cam.matrixWorld);
    cam.viewProjection.multiplyMatrices(cam.projectionMatrix, cam.viewMatrix); cam.frustum.setFromMatrix(cam.viewProjection);
    this._collect(scene, cam);
    var vp = _r3vp.copy(cam.viewProjection);
    if (this.flipY) { var e = vp.e; e[1] = -e[1]; e[5] = -e[5]; e[9] = -e[9]; e[13] = -e[13]; }
    var F = this._packFrame(scene, cam, vp, (this.r.time || 0) / 1000);
    var sun = this._lights.dir[0], shadowOn = !!(sun && sun.shadow.enabled && this.shadowsSupported !== false && view.shadows !== false);
    this._begin(view);
    if (shadowOn) {
      var sc = this._shadowSetup(sun, cam), sh = sun.shadow;
      F.set(sh.matrix.e, 40); F[39] = 1;
      F[56] = sh.bias; F[57] = sh.normalBias; F[58] = 1 / Math.max(1, sh.mapSize); F[59] = sh.softness;
      var FS = this.FS; FS.set(F); FS.set(sc.viewProjection.e, 0);
      var casters = this._casters, list = [], fr = sc.frustum;
      for (var i = 0; i < casters.length; i++) {
        var cm = casters[i], mt = cm.material;
        if ((mt.transparent || mt.opacity < 1 || mt.blend !== 'normal') && !(mt.alphaTest > 0)) continue;
        if (!cm.frustumCulled || fr.intersectsSphere(cm.getWorldSphere())) list.push(cm);
      }
      if (!this._shadowPass(view, sh, FS, list)) F[39] = 0;
    }
    this._mainPass(view, scene, cam, F);
    this._end(view);
  }
  _begin() { }
  _end() { }
  /** Libera todo lo asociado a una View3D en este renderizador */
  freeView() { }
  freeGeometry() { }
  freeSource() { }
  freeSkeleton() { }
  destroy() { this.destroyed = true; RendererRegistry.delete(this.uid); }
}

/* =================================================================== WebGL */
var GL3D_ATTRS = ['aPos', 'aNrm', 'aUV', 'aCol', 'aJoints', 'aWeights', 'aI0', 'aI1', 'aI2', 'aI3', 'aIC'];
var GL3D_ATTR_NAMES = ['position', 'normal', 'uv', 'color', 'joints', 'weights'];
class WebGL3D extends Renderer3D {
  constructor(r) {
    super(r);
    this.flipY = true;
    this._progs = new Map(); this._geoms = new Set(); this._views = new Set(); this._insts = new Set();
    this._jointTex = new Map();
    this._ctxVersion = -1;
    this._setup();
  }
  _setup() {
    var r = this.r, gl = r.gl, self = this;
    // tras perder el contexto los objetos GL viejos ya no existen: solo se olvidan (y se cuadran los contadores)
    this._geoms.forEach(function (g) { if (g._gpu[self.uid]) { delete g._gpu[self.uid]; Debug.track('GPUBuffer3D', -1); } }); this._geoms.clear();
    this._views.forEach(function (v) { if (v._gl3) { v._gl3 = null; Debug.track('GPUTarget3D', -1); } }); this._views.clear();
    this._insts.forEach(function (m) { if (m._glInst && m._glInst[self.uid]) { delete m._glInst[self.uid]; Debug.track('GPUBuffer3D', -1); } }); this._insts.clear();
    this._jointTex.forEach(function () { Debug.track('GPUTexture3D', -1); }); this._jointTex.clear();
    if (this._shadowRT) { this._shadowRT = null; Debug.track('GPUTexture3D', -1); }
    this._ctxVersion = r._ctxVersion;
    this.webgl2 = r.isWebGL2;
    this._extDepth = this.webgl2 ? true : !!gl.getExtension('WEBGL_depth_texture');
    this._extUint = this.webgl2 ? true : !!gl.getExtension('OES_element_index_uint');
    this._extDeriv = this.webgl2 ? true : !!gl.getExtension('OES_standard_derivatives');
    this._extFloat = this.webgl2 ? true : !!gl.getExtension('OES_texture_float');
    this.shadowsSupported = this._extDepth;
    this.maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) || 8;
    this.maxSamples = this.webgl2 ? Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0) : 0;
    this._instOK = !!r.instancing && this.maxAttribs >= 11;
    this._skinOK = this._extFloat && (gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) || 0) > 0;
    var hp = gl.getShaderPrecisionFormat ? gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT) : null;
    this._fragHigh = !hp || hp.precision > 0;
    var fu = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) || 64;
    if (fu < 100) this.setLimits(2, 3, 1); else if (fu < 200) this.setLimits(3, 6, 2); else this.setLimits(4, 8, 4);
    this._progs.clear(); this._curProg = null;
    this._skyProg = null; this._skyBuf = null; this._skyVAO = null;
    this._white = gl.createTexture();
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this._white); r._boundTex[5] = this._white;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this._frameVer = 0; this._shadowOn = false; this._tick = this._tick || 0;
  }
  _alive() { var gl = this.r.gl; return !!gl && !gl.isContextLost(); }
  _check() { if (this._ctxVersion !== this.r._ctxVersion) this._setup(); }
  /* ---------- programas ---------- */
  _program(f) {
    var p = this._progs.get(f.key);
    if (p !== undefined) return p;
    var gl = this.r.gl, caps = { webgl2: this.webgl2, derivatives: this._extDeriv };
    var feat = Object.assign({}, f);
    if (!this._extDeriv) { feat.nrm = false; feat.flat = false; }
    if (feat.skin && !this._skinOK) feat.skin = false;
    if (feat.inst && !this._instOK) { feat.inst = false; feat.instColor = false; feat.instLoop = true; }
    var vs = glslVertex(feat, this.L), fs = glslFragment(feat, this.L, caps);
    if (!this._fragHigh) vs = vs.replace('uniform vec4 uF[', 'uniform mediump vec4 uF[').replace('uniform vec4 uM[', 'uniform mediump vec4 uM[');
    var prog = this._link(vs, fs, feat.key);
    if (!prog) { this._progs.set(f.key, null); return null; }
    var P = { p: prog, f: feat, frameVer: -1, matKey: '' };
    P.uF = gl.getUniformLocation(prog, 'uF'); P.uM = gl.getUniformLocation(prog, 'uM'); P.uO = gl.getUniformLocation(prog, 'uO');
    gl.useProgram(prog); this._curProg = null; this.r._currentProgram = null;
    var units = { tMap: 0, tNrm: 1, tMR: 2, tEm: 3, tAO: 4, tShadow: 5, tJoints: 6 };
    for (var k in units) { var loc = gl.getUniformLocation(prog, k); if (loc) gl.uniform1i(loc, units[k]); }
    this._progs.set(f.key, P); this.stats.programs = this._progs.size;
    return P;
  }
  _link(vs, fs, label) {
    var gl = this.r.gl, max = this.maxAttribs;
    if (this.webgl2) { vs = glslToES3(vs, false); fs = glslToES3(fs, true); }
    var mk = function (type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { if (!gl.isContextLost()) Log.error('Shader 3D (' + label + '): ' + gl.getShaderInfoLog(s)); gl.deleteShader(s); return null; }
      return s;
    };
    var v = mk(gl.VERTEX_SHADER, vs), f = mk(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) { if (v) gl.deleteShader(v); if (f) gl.deleteShader(f); return null; }
    var p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f);
    for (var a = 0; a < GL3D_ATTRS.length && a < max; a++) gl.bindAttribLocation(p, a, GL3D_ATTRS[a]);
    gl.linkProgram(p); gl.deleteShader(v); gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { if (!gl.isContextLost()) Log.error('Programa 3D (' + label + '): ' + gl.getProgramInfoLog(p)); gl.deleteProgram(p); return null; }
    return p;
  }
  /* ---------- geometría ---------- */
  _geometry(g) {
    var gl = this.r.gl, d = g._gpu[this.uid];
    if (d && d.version === g.version && d.attrVer === attrVersionSum(g)) return d;
    ensureBasicAttributes(g);
    if (!d) { d = g._gpu[this.uid] = { buffers: {}, vaos: new Map(), ibo: null, version: -1, attrVer: -1, layout: '', idxSrc: null, idxVer: -1 }; this._geoms.add(g); g._revive(); Debug.track('GPUBuffer3D', 1); }
    var layout = '';
    for (var i = 0; i < GL3D_ATTR_NAMES.length; i++) {
      var nm = GL3D_ATTR_NAMES[i], a = g.attributes[nm], b = d.buffers[nm];
      if (!a) { if (b) { gl.deleteBuffer(b.buf); delete d.buffers[nm]; } continue; }
      layout += nm + a.size + ',';
      if (!b) b = d.buffers[nm] = { buf: gl.createBuffer(), ver: -1, len: -1, size: a.size, src: null };
      if (b.ver !== a.version || b.len !== a.data.length || b.src !== a.data) {
        var data = a.data instanceof Float32Array ? a.data : new Float32Array(a.data);
        gl.bindBuffer(gl.ARRAY_BUFFER, b.buf); gl.bufferData(gl.ARRAY_BUFFER, data, a.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
        b.ver = a.version; b.len = a.data.length; b.size = a.size; b.src = a.data;
      }
    }
    if (g.index) {
      if (!d.ibo) d.ibo = gl.createBuffer();
      if (d.idxSrc !== g.index || d.idxVer !== g.version) {
        // ELEMENT_ARRAY_BUFFER forma parte del estado del VAO: se sube con el VAO por defecto
        this.r._bindVAO(null);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, d.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.index, gl.STATIC_DRAW);
        d.idxSrc = g.index; d.idxVer = g.version;
      }
      d.idxType = g.index instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT; d.idxBytes = g.index instanceof Uint32Array ? 4 : 2; d.count = g.index.length;
      layout += 'i';
    } else { d.count = g.vertexCount; d.idxType = 0; if (d.ibo) { gl.deleteBuffer(d.ibo); d.ibo = null; d.idxSrc = null; } }
    if (layout !== d.layout) { this._dropVAOs(g, d); d.layout = layout; }
    d.version = g.version; d.attrVer = attrVersionSum(g);
    return d;
  }
  _dropVAOs(g, d) {
    var self = this;
    d.vaos.forEach(function (v) { self._deleteVAO(v); }); d.vaos.clear();
    this._insts.forEach(function (m) { var ib = m._glInst && m._glInst[self.uid]; if (!ib) return; ib.vaos.forEach(function (v, key) { if (key.indexOf(g.uid + ':') === 0) { self._deleteVAO(v); ib.vaos.delete(key); } }); });
  }
  _deleteVAO(v) { if (!v || !this._alive()) return; if (this.webgl2) this.r.gl.deleteVertexArray(v); else if (this.r._extVAO) this.r._extVAO.deleteVertexArrayOES(v); }
  _useVAO() { return !!(this.webgl2 || this.r._extVAO); }
  /** Enlaza los atributos de una malla (VAO cacheado por geometría y, con instancias, por malla) */
  _bindGeometry(g, d, mesh, instOn) {
    var r = this.r;
    var ib = instOn ? this._instBuffer(mesh) : null;
    if (this._useVAO()) {
      var map = instOn ? ib.vaos : d.vaos, key = instOn ? g.uid + ':' + d.layout : 'v';
      var vao = map.get(key);
      if (!vao) { vao = r._createVAO(); map.set(key, vao); r._bindVAO(vao); this._setupAttribs(d, ib); }
      else r._bindVAO(vao);
    } else { r._bindVAO(null); this._setupAttribs(d, ib); }
  }
  _setupAttribs(d, ib) {
    var gl = this.r.gl, r = this.r, n = Math.min(11, this.maxAttribs);
    for (var l = 0; l < n; l++) { gl.disableVertexAttribArray(l); if (r.instancing) r._divisor(l, 0); }
    for (var i = 0; i < GL3D_ATTR_NAMES.length; i++) {
      var b = d.buffers[GL3D_ATTR_NAMES[i]]; if (!b || i >= n) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, b.buf); gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, b.size, gl.FLOAT, false, 0, 0);
    }
    if (ib) {
      gl.bindBuffer(gl.ARRAY_BUFFER, ib.buf);
      for (var k = 0; k < 5; k++) { var loc = 6 + k; gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 80, k * 16); r._divisor(loc, 1); }
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, d.ibo || null);
  }
  _instBuffer(mesh) {
    var gl = this.r.gl;
    var all = mesh._glInst || (mesh._glInst = {}), ib = all[this.uid];
    if (!ib) {
      ib = all[this.uid] = { buf: gl.createBuffer(), ver: -1, cap: 0, vaos: new Map(), data: null };
      this._insts.add(mesh); Debug.track('GPUBuffer3D', 1);
      if (!mesh._glInstHook) {
        mesh._glInstHook = true;
        mesh.once('destroy', function () { var reg = mesh._glInst; mesh._glInst = null; for (var rid in reg) { var R = RendererRegistry.get(+rid); if (R && R._freeInst) R._freeInst(mesh, reg[rid]); } });
      }
    }
    if (ib.ver !== mesh.instanceVersion) {
      var n = mesh.capacity, m = mesh.instanceMatrix, c = mesh.instanceColor;
      if (!ib.data || ib.data.length !== n * 20) ib.data = new Float32Array(n * 20);
      var data = ib.data;
      for (var i = 0; i < n; i++) { var o = i * 20, s = i * 16; for (var j = 0; j < 16; j++) data[o + j] = m[s + j]; data[o + 16] = c[i * 4]; data[o + 17] = c[i * 4 + 1]; data[o + 18] = c[i * 4 + 2]; data[o + 19] = c[i * 4 + 3]; }
      gl.bindBuffer(gl.ARRAY_BUFFER, ib.buf);
      if (ib.cap !== n) { gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); ib.cap = n; } else gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
      ib.ver = mesh.instanceVersion;
    }
    return ib;
  }
  _freeInst(mesh, ib) {
    if (!this._insts.has(mesh)) return;
    this._insts.delete(mesh);
    if (this._alive()) { this.r.gl.deleteBuffer(ib.buf); var self = this; ib.vaos.forEach(function (v) { self._deleteVAO(v); }); }
    ib.vaos.clear();
    Debug.track('GPUBuffer3D', -1);
  }
  freeGeometry(g) {
    var d = g._gpu[this.uid]; if (!d) return;
    var gl = this.r.gl;
    if (this._alive()) {
      for (var k in d.buffers) gl.deleteBuffer(d.buffers[k].buf);
      if (d.ibo) gl.deleteBuffer(d.ibo);
      this._dropVAOs(g, d);
    }
    delete g._gpu[this.uid]; this._geoms.delete(g); Debug.track('GPUBuffer3D', -1);
  }
  /* ---------- texturas ---------- */
  _bindTex(tex, unit, m, view) {
    if (!tex || !tex.source || tex.source.destroyed) { this._bindWhite(unit); return; }
    var src = tex.source;
    // nunca muestrear la textura en la que se está dibujando (bucle de realimentación)
    if (view && view.rt && src === view.rt.source) { this._bindWhite(unit); return; }
    if (!src._3dMip && !src.isRenderTarget) { src._3dMip = true; if (!src.mipmap) { src.mipmap = true; src.version++; } }
    if (m && src.wrapMode === 'clamp' && tex.isFullSource && this._tiles(m)) src.setWrapMode('repeat');
    this.r._bindSource(src, unit);
  }
  _bindWhite(unit) {
    var gl = this.r.gl;
    if (this.r._boundTex[unit] !== this._white) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, this._white); this.r._boundTex[unit] = this._white; }
  }
  _jointTexture(skel) {
    var gl = this.r.gl, t = this._jointTex.get(skel);
    var n = skel.count, W = Math.min(1024, Math.max(4, n * 4)), H = Math.ceil(n * 4 / W);
    if (!t) { t = { tex: gl.createTexture(), w: 0, h: 0, ver: -1, data: null }; this._jointTex.set(skel, t); Debug.track('GPUTexture3D', 1); if (skel._gpu) skel._gpu[this.uid] = 1; }
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, t.tex); this.r._boundTex[6] = t.tex;
    if (t.w !== W || t.h !== H) {
      t.w = W; t.h = H; t.data = new Float32Array(W * H * 4);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (this.webgl2) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, null); else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.FLOAT, null);
      t.ver = -1;
    }
    if (t.ver !== skel.version) { t.data.set(skel.jointMatrices); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, t.data); t.ver = skel.version; }
    t.used = this._tick;
    return t;
  }
  /** Libera la textura de huesos de un esqueleto que ya no se usa */
  freeSkeleton(skel) {
    var t = this._jointTex.get(skel); if (!t) return;
    if (this._alive()) { this.r.gl.deleteTexture(t.tex); for (var i = 0; i < this.r._boundTex.length; i++) if (this.r._boundTex[i] === t.tex) this.r._boundTex[i] = null; }
    this._jointTex.delete(skel); Debug.track('GPUTexture3D', -1);
    if (skel._gpu) delete skel._gpu[this.uid];
  }
  /* ---------- destinos ---------- */
  _viewTarget(view, pw, ph) {
    var r = this.r, gl = r.gl, v = view._gl3;
    var rtd = r._ensureRT(view.rt);
    var samples = view.antialias !== false ? this.maxSamples : 0;
    if (v && v.w === pw && v.h === ph && v.colorFbo === rtd.fbo && v.req === samples) return v;
    if (v) this._freeViewTarget(view);
    v = view._gl3 = { w: pw, h: ph, colorFbo: rtd.fbo, msaa: 0, req: samples, fbo: null, color: null, depth: null };
    this._views.add(view);
    if (samples > 1) {
      v.msaa = samples; v.fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, v.fbo);
      v.color = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, v.color); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, pw, ph);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, v.color);
      v.depth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, v.depth); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, pw, ph);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, v.depth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        // sin MSAA en esta GPU: se sigue sin multimuestreo
        gl.deleteFramebuffer(v.fbo); gl.deleteRenderbuffer(v.color); gl.deleteRenderbuffer(v.depth);
        v.msaa = 0; v.color = null; v.depth = null; this.maxSamples = 0; v.req = 0;
      }
    }
    if (!v.msaa) {
      v.fbo = rtd.fbo; gl.bindFramebuffer(gl.FRAMEBUFFER, v.fbo);
      v.depth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, v.depth); gl.renderbufferStorage(gl.RENDERBUFFER, this.webgl2 ? gl.DEPTH_COMPONENT24 : gl.DEPTH_COMPONENT16, pw, ph);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, v.depth);
    }
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    Debug.track('GPUTarget3D', 1);
    return v;
  }
  _freeViewTarget(view) {
    var v = view._gl3; if (!v) return;
    var gl = this.r.gl;
    if (this._alive()) {
      if (v.msaa) { gl.deleteFramebuffer(v.fbo); gl.deleteRenderbuffer(v.color); }
      else if (v.colorFbo) { gl.bindFramebuffer(gl.FRAMEBUFFER, v.colorFbo); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null); }
      if (v.depth) gl.deleteRenderbuffer(v.depth);
      var st = this.r.currentTarget; if (st && this.r._inFrame) this.r._bindTarget(st, false, 0, 0); else gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    view._gl3 = null; this._views.delete(view); Debug.track('GPUTarget3D', -1);
  }
  _shadowTarget(size) {
    var gl = this.r.gl, s = this._shadowRT;
    if (s && s.size === size) return s;
    if (s) this._freeShadow();
    s = this._shadowRT = { size: size, tex: gl.createTexture(), fbo: gl.createFramebuffer(), color: null };
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, s.tex); this.r._boundTex[5] = s.tex;
    if (this.webgl2) gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, s.tex, 0);
    if (this.webgl2) { gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); }
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && !this.webgl2) {
      // algunas GPU WebGL1 exigen un color adjunto: se añade uno mínimo
      s.color = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, s.color); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA4, size, size);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, s.color); gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    }
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { Log.warnOnce('shadowfbo', 'Mapa de sombras no soportado en esta GPU: sombras desactivadas'); this.shadowsSupported = false; }
    Debug.track('GPUTexture3D', 1);
    return s;
  }
  _freeShadow() {
    var s = this._shadowRT; if (!s) return;
    if (this._alive()) { var gl = this.r.gl; gl.deleteTexture(s.tex); gl.deleteFramebuffer(s.fbo); if (s.color) gl.deleteRenderbuffer(s.color); for (var i = 0; i < this.r._boundTex.length; i++) if (this.r._boundTex[i] === s.tex) this.r._boundTex[i] = null; }
    this._shadowRT = null; Debug.track('GPUTexture3D', -1);
  }
  /* ---------- estado ---------- */
  _begin() {
    var r = this.r;
    this._check();
    r.batcher.flush();
    var gl = r.gl;
    r._bindVAO(null);
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND); r._blendMode = -2;
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    this._curProg = null;
  }
  _end() {
    var r = this.r, gl = r.gl;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.depthMask(true); gl.frontFace(gl.CCW); gl.colorMask(true, true, true, true);
    gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); r._blendMode = -2; r._blendEq = gl.FUNC_ADD;
    r._bindVAO(null);
    if (!this._useVAO()) { var n = Math.min(11, this.maxAttribs); for (var l = 0; l < n; l++) { gl.disableVertexAttribArray(l); if (r.instancing) r._divisor(l, 0); } }
    gl.useProgram(null); r._currentProgram = null; this._curProg = null;
    var st = r.currentTarget;
    if (st) { r._bindTarget(st, false, 0, 0); r._applyScissor(st.scissor, st); }
    else gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    r._batchProjVer = -1; r._instProjVer = -1; r._projVer++;
    // esqueletos que ya no se dibujan: se libera su textura (no retener modelos destruidos)
    if ((++this._tick & 127) === 0) { var self = this, tk = this._tick; Array.from(this._jointTex.keys()).forEach(function (sk) { if (tk - self._jointTex.get(sk).used > 240) self.freeSkeleton(sk); }); }
  }
  _useProgram(P) { if (this._curProg !== P) { this.r.gl.useProgram(P.p); this._curProg = P; } }
  _setCull(side, flip) {
    var gl = this.r.gl;
    if (side === 'double') { gl.disable(gl.CULL_FACE); return; }
    gl.enable(gl.CULL_FACE); gl.cullFace(side === 'back' ? gl.FRONT : gl.BACK);
    gl.frontFace(flip ? gl.CW : gl.CCW);
  }
  _setBlend3D(m) {
    var gl = this.r.gl;
    gl.enable(gl.BLEND);
    if (m.blend === 'add') gl.blendFunc(gl.ONE, gl.ONE);
    else if (m.blend === 'multiply') gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  _drawMesh(mesh, f, pass, F, view) {
    var gl = this.r.gl, st = this.stats;
    var P = this._program(f); if (!P) return;
    var g = mesh._geometry, d = this._geometry(g);
    if (d.idxType === gl.UNSIGNED_INT && !this._extUint) { Log.warnOnce('noUint', 'Geometría con índices de 32 bits sin OES_element_index_uint: se omite'); return; }
    var start = Math.max(0, g.drawRange.start | 0), count = Math.min(d.count - start, g.drawRange.count);
    count -= count % 3;
    if (!(count > 0)) return;
    this._useProgram(P);
    if (P.frameVer !== this._frameVer) { gl.uniform4fv(P.uF, F); P.frameVer = this._frameVer; P.matKey = ''; }
    var m = mesh.material, mk = m.uid + ':' + m.version + ':' + pass;
    if (P.matKey !== mk) { gl.uniform4fv(P.uM, this._packMaterial(m, pass)); P.matKey = mk; }
    var jw = 0, jh = 0;
    if (P.f.skin && mesh.skeleton) { var jt = this._jointTexture(mesh.skeleton); jw = jt.w; jh = jt.h; }
    var ol = pass === 'outline' ? m.outline : 0;
    if (pass === 'main') {
      if (P.f.map) this._bindTex(m.map, 0, m, view);
      if (P.f.nrm) this._bindTex(m.normalMap, 1, m, view);
      if (P.f.mr) this._bindTex(m.metalRoughMap, 2, m, view);
      if (P.f.em) this._bindTex(m.emissiveMap, 3, m, view);
      if (P.f.ao) this._bindTex(m.aoMap, 4, m, view);
      if (P.f.recv) {
        if (this._shadowRT && this._shadowOn) { if (this.r._boundTex[5] !== this._shadowRT.tex) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this._shadowRT.tex); this.r._boundTex[5] = this._shadowRT.tex; } }
        else this._bindWhite(5);
      }
    } else if (pass === 'shadow' && P.f.map && P.f.alphaTest) this._bindTex(m.map, 0, m, view);
    var tris = count / 3;
    if (mesh.instanced && P.f.instLoop) {
      // sin instanciado por hardware: un draw por instancia (mismo resultado, más lento)
      this._bindGeometry(g, d, mesh, false);
      var im = mesh.instanceMatrix, Mi = _r3m2, W = _r3m;
      for (var k = 0; k < mesh.count; k++) {
        Mi.fromArray(im, k * 16); W.multiplyMatrices(mesh.matrixWorld, Mi);
        gl.uniform4fv(P.uO, this._packObject(W, jw, jh, ol));
        if (d.idxType) gl.drawElements(gl.TRIANGLES, count, d.idxType, start * d.idxBytes); else gl.drawArrays(gl.TRIANGLES, start, count);
      }
      if (pass === 'shadow') st.shadowDraws += mesh.count; else { st.draws += mesh.count; st.triangles += tris * mesh.count; }
      return;
    }
    gl.uniform4fv(P.uO, this._packObject(mesh.matrixWorld, jw, jh, ol));
    var inst = mesh.instanced ? Math.min(mesh.count, mesh.capacity) : 0;
    this._bindGeometry(g, d, mesh, inst > 0);
    if (inst > 0) {
      if (this.webgl2) { if (d.idxType) gl.drawElementsInstanced(gl.TRIANGLES, count, d.idxType, start * d.idxBytes, inst); else gl.drawArraysInstanced(gl.TRIANGLES, start, count, inst); }
      else { var ext = this.r._extInst; if (d.idxType) ext.drawElementsInstancedANGLE(gl.TRIANGLES, count, d.idxType, start * d.idxBytes, inst); else ext.drawArraysInstancedANGLE(gl.TRIANGLES, start, count, inst); }
    } else if (d.idxType) gl.drawElements(gl.TRIANGLES, count, d.idxType, start * d.idxBytes);
    else gl.drawArrays(gl.TRIANGLES, start, count);
    if (pass === 'shadow') st.shadowDraws++; else { st.draws++; st.triangles += tris * Math.max(1, inst); }
  }
  /* ---------- pasadas ---------- */
  _shadowPass(view, sh, FS, list) {
    var gl = this.r.gl, s = this._shadowTarget(Math.max(16, Math.min(sh.mapSize | 0 || 1024, this.r.maxTextureSize || 4096)));
    if (!this.shadowsSupported) { this._shadowOn = false; return false; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo); gl.viewport(0, 0, s.size, s.size);
    gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT); gl.colorMask(false, false, false, false);
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST);
    this._frameVer++;
    for (var i = 0; i < list.length; i++) {
      var mesh = list[i], f = this._features(mesh, 'shadow');
      this._setCull(mesh.material.side === 'double' ? 'double' : 'front', false);
      this._drawMesh(mesh, f, 'shadow', FS, view);
    }
    gl.colorMask(true, true, true, true);
    this._shadowOn = true;
    return true;
  }
  _mainPass(view, scene, cam, F) {
    var gl = this.r.gl, pw = view.rt.source.width, ph = view.rt.source.height;
    if (!F[39]) this._shadowOn = false;
    var v = this._viewTarget(view, pw, ph);
    gl.bindFramebuffer(gl.FRAMEBUFFER, v.fbo); gl.viewport(0, 0, pw, ph);
    var bg = Color.toNumber(scene.background === null ? 0 : scene.background), a = scene.background === null ? 0 : scene.backgroundAlpha;
    gl.clearColor(((bg >> 16) & 255) / 255 * a, ((bg >> 8) & 255) / 255 * a, (bg & 255) / 255 * a, a);
    gl.depthMask(true); gl.colorMask(true, true, true, true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this._frameVer++;
    if (scene.sky) this._drawSky(cam, F, scene);
    var ops = this._drawOpaque, trs = this._drawTrans, i, it, m;
    gl.disable(gl.BLEND);
    for (i = 0; i < ops.length; i++) {
      it = ops[i]; m = it.mesh.material; this._setCull(m.side, this.flipY);
      gl.depthMask(m.depthWrite !== false); if (m.depthTest !== false) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
      this._drawMesh(it.mesh, it.f, 'main', F, view);
    }
    // contornos toon: caras traseras extruidas por la normal
    for (i = 0; i < ops.length; i++) {
      it = ops[i]; m = it.mesh.material;
      if (m.outline > 0) { this._setCull('back', this.flipY); gl.depthMask(true); gl.enable(gl.DEPTH_TEST); this._drawMesh(it.mesh, this._features(it.mesh, 'outline'), 'outline', F, view); }
    }
    // transparentes: de atrás hacia delante, sin escribir profundidad
    for (i = 0; i < trs.length; i++) {
      it = trs[i]; m = it.mesh.material; this._setCull(m.side, this.flipY); this._setBlend3D(m);
      gl.depthMask(false); if (m.depthTest !== false) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
      this._drawMesh(it.mesh, it.f, 'main', F, view);
    }
    gl.disable(gl.BLEND); gl.depthMask(true);
    if (v.msaa) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, v.fbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, v.colorFbo);
      gl.blitFramebuffer(0, 0, pw, ph, 0, 0, pw, ph, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }
  }
  _drawSky(cam, F, scene) {
    var gl = this.r.gl, r = this.r;
    if (this._skyProg === null) {
      var sk = glslSky(), p = this._link(sk.vs, sk.fs, 'sky');
      if (!p) { this._skyProg = false; return; }
      this._skyProg = { p: p, uInv: gl.getUniformLocation(p, 'uInvVP'), uSky: gl.getUniformLocation(p, 'uSky') };
      r._bindVAO(null);
      this._skyBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this._skyBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      if (this._useVAO()) { this._skyVAO = r._createVAO(); r._bindVAO(this._skyVAO); gl.bindBuffer(gl.ARRAY_BUFFER, this._skyBuf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); r._bindVAO(null); }
    }
    if (!this._skyProg) return;
    var S = this._skyProg, K = this.L.K0 * 4;
    gl.useProgram(S.p); this._curProg = null;
    var inv = _r3m2.copy(cam.viewProjection);
    if (this.flipY) { var e = inv.e; e[1] = -e[1]; e[5] = -e[5]; e[9] = -e[9]; e[13] = -e[13]; }
    inv.invert();
    gl.uniformMatrix4fv(S.uInv, false, inv.e);
    var sky = this._skyU || (this._skyU = new Float32Array(40));
    sky.set(F.subarray(K, K + 20)); sky[20] = F[16]; sky[21] = F[17]; sky[22] = F[18]; sky[23] = scene ? scene.time || 0 : 0;
    packSkyExtras(scene ? scene.sky : null, sky, 24);
    gl.uniform4fv(S.uSky, sky);
    if (this._skyVAO) r._bindVAO(this._skyVAO);
    else { r._bindVAO(null); var n = Math.min(11, this.maxAttribs); for (var l = 0; l < n; l++) { gl.disableVertexAttribArray(l); if (r.instancing) r._divisor(l, 0); } gl.bindBuffer(gl.ARRAY_BUFFER, this._skyBuf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); }
    gl.disable(gl.CULL_FACE); gl.depthMask(false); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
  }
  freeView(view) { this._freeViewTarget(view); }
  destroy() {
    if (this.destroyed) return;
    var self = this, gl = this.r.gl, alive = this._alive();
    Array.from(this._geoms).forEach(function (g) { self.freeGeometry(g); });
    Array.from(this._views).forEach(function (v) { self._freeViewTarget(v); });
    Array.from(this._insts).forEach(function (m) { var ib = m._glInst && m._glInst[self.uid]; if (ib) { self._freeInst(m, ib); delete m._glInst[self.uid]; } });
    this._jointTex.forEach(function (t) { if (alive) gl.deleteTexture(t.tex); Debug.track('GPUTexture3D', -1); });
    this._jointTex.clear(); this._freeShadow();
    if (alive) {
      this._progs.forEach(function (P) { if (P) gl.deleteProgram(P.p); });
      if (this._skyProg) gl.deleteProgram(this._skyProg.p);
      if (this._skyBuf) gl.deleteBuffer(this._skyBuf);
      if (this._skyVAO) this._deleteVAO(this._skyVAO);
      if (this._white) gl.deleteTexture(this._white);
    }
    this._progs.clear();
    super.destroy();
  }
}
/** GLSL ES 1.00 -> 3.00 (WebGL2): derivadas y texturas en el núcleo, sin extensiones */
function glslToES3(src, frag) {
  var s = src.replace(/#extension GL_OES_standard_derivatives : enable\n/g, '');
  s = s.replace(/\battribute\b/g, 'in').replace(/\btexture2D\(/g, 'texture(');
  if (frag) { s = s.replace(/\bvarying\b/g, 'in').replace(/\bgl_FragColor\b/g, 'ugFragColor'); var i = s.indexOf('#endif\n'); s = i >= 0 ? s.slice(0, i + 7) + 'out vec4 ugFragColor;\n' + s.slice(i + 7) : 'out vec4 ugFragColor;\n' + s; }
  else s = s.replace(/\bvarying\b/g, 'out');
  return '#version 300 es\n' + s;
}
/** Suma de versiones de atributos (detecta markDirty de un atributo concreto) */
function attrVersionSum(g) { var s = 0, a = g.attributes; for (var k in a) s += a[k].version + 1; return s; }
/** Los shaders siempre leen normal y uv: se generan si faltan */
function ensureBasicAttributes(g) {
  if (!g.attributes.position) return;
  if (!g.attributes.normal) g.computeNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new Float32Array(g.vertexCount * 2), 2);
}

UG.Renderer3D = Renderer3D; UG.WebGL3D = WebGL3D;
