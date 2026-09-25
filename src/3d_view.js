/* UltraGame 3D - View3D: objeto 2D que muestra una escena 3D.
 * Se dibuja en su propia RenderTexture (con profundidad, MSAA y sombras) y se compone como un sprite, así que
 * admite filtros 2D, cámaras 2D, máscaras, HUD encima y varias vistas a la vez (pantalla dividida, minimapa...).
 * view.add(...) añade nodos 3D; view.add.box(...), view.add.sphere(...), etc. los crean. */

var _vv = new Vec3(), _vv2 = new Vec3(), _vm = new Mat4(), _vray = new Ray();

/* ================================================================ Raycaster3D */
class Raycaster3D {
  constructor() { this.ray = new Ray(); this.near = 0; this.far = Infinity; this._inv = new Mat4(); this._lr = new Ray(); }
  /** nx, ny en -1..1 (y hacia arriba) */
  setFromCamera(nx, ny, camera) { camera.updateWorldMatrix(); camera.viewMatrix.invertFrom(camera.matrixWorld); camera.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.viewMatrix); camera.rayFromNDC(nx, ny, this.ray); return this; }
  set(origin, direction) { this.ray.set(origin, direction); return this; }
  /** Intersecciones ordenadas por distancia: [{distance, point, normal, object, faceIndex, instanceId}] */
  intersect(root, options) {
    options = options || {};
    var out = [], self = this, filter = options.filter || null, recursive = options.recursive !== false;
    var visit = function (n) {
      if (!n.visible && !options.includeHidden) return;
      if (n instanceof Mesh3D && n._geometry && (!filter || filter(n))) self._mesh(n, out, options);
      if (recursive) for (var i = 0; i < n.children.length; i++) visit(n.children[i]);
    };
    if (Array.isArray(root)) root.forEach(visit); else visit(root);
    out.sort(function (a, b) { return a.distance - b.distance; });
    if (options.first) out.length = Math.min(out.length, 1);
    return out;
  }
  _mesh(mesh, out, options) {
    if (mesh.raycast === false) return;
    mesh.updateWorldMatrix();
    var ws = mesh.getWorldSphere();
    if (ws.radius < 0) return;
    var hs = this.ray.intersectSphere(ws);
    if (hs === null || hs > this.far) return;
    var g = mesh._geometry, P = g.attributes.position; if (!P) return;
    if (options.bounds) { this._push(out, mesh, hs, this.ray.at(hs), null, -1, -1); return; }
    if (mesh.instanced) {
      for (var k = 0; k < mesh.count; k++) { _vm.fromArray(mesh.instanceMatrix, k * 16); var W = new Mat4().multiplyMatrices(mesh.matrixWorld, _vm); this._tris(mesh, g, W, out, k, options); }
    } else this._tris(mesh, g, mesh.matrixWorld, out, -1, options);
  }
  _tris(mesh, g, world, out, instanceId, options) {
    var inv = this._inv.invertFrom(world), lr = this._lr.copy(this.ray);
    // rayo en espacio local (dirección sin normalizar para conservar t en unidades de mundo)
    lr.origin.applyMat4(inv); lr.direction.copy(this.ray.direction).transformDirection(inv);
    var dl = lr.direction.length(); if (dl < 1e-12) return; lr.direction.scale(1 / dl);
    var p = g.attributes.position.data, s = g.attributes.position.size, idx = g.index;
    var n = idx ? idx.length : g.vertexCount, start = Math.max(0, g.drawRange.start | 0), end = Math.min(n, start + g.drawRange.count);
    var back = options.backfaces !== undefined ? options.backfaces : mesh.material && mesh.material.side !== 'front', best = Infinity, bestF = -1;
    for (var t = start; t + 2 < end; t += 3) {
      var a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2;
      var hit = lr.intersectTriangle(p[a * s], p[a * s + 1], p[a * s + 2], p[b * s], p[b * s + 1], p[b * s + 2], p[c * s], p[c * s + 1], p[c * s + 2], back);
      if (hit !== null && hit < best) { best = hit; bestF = t / 3; }
    }
    if (bestF < 0) return;
    var lp = lr.at(best, new Vec3()), wp = lp.clone().applyMat4(world), dist = wp.distanceTo(this.ray.origin);
    if (dist < this.near || dist > this.far) return;
    var t0 = bestF * 3, ia = idx ? idx[t0] : t0, ib = idx ? idx[t0 + 1] : t0 + 1, ic = idx ? idx[t0 + 2] : t0 + 2;
    var e1 = new Vec3(p[ib * s] - p[ia * s], p[ib * s + 1] - p[ia * s + 1], p[ib * s + 2] - p[ia * s + 2]), e2 = new Vec3(p[ic * s] - p[ia * s], p[ic * s + 1] - p[ia * s + 1], p[ic * s + 2] - p[ia * s + 2]);
    var nm = new Float32Array(12); world.normalMatrix12(nm, 0);
    var ln = e1.cross(e2), wn = new Vec3(nm[0] * ln.x + nm[4] * ln.y + nm[8] * ln.z, nm[1] * ln.x + nm[5] * ln.y + nm[9] * ln.z, nm[2] * ln.x + nm[6] * ln.y + nm[10] * ln.z).normalize();
    if (wn.dot(this.ray.direction) > 0) wn.negate();
    this._push(out, mesh, dist, wp, wn, bestF, instanceId);
  }
  _push(out, mesh, d, p, n, f, inst) { out.push({ distance: d, point: p, normal: n, object: mesh, faceIndex: f, instanceId: inst }); }
}

/* ================================================================== Sprite3D */
/** Imagen plana que siempre mira a la cámara (billboard): árboles lejanos, partículas, barras de vida, iconos */
class Sprite3D extends Mesh3D {
  constructor(texture, width, height, options) {
    options = options || {};
    var mat = new BasicMaterial({ map: texture || null, transparent: options.transparent === true, alphaTest: options.alphaTest !== undefined ? options.alphaTest : 0.5, side: 'double', color: options.color !== undefined ? options.color : 0xffffff });
    mat.fog = options.fog !== false; mat.unlit = options.lit !== true;
    var w = width || 1, h = height || (texture && texture.width ? w * texture.height / texture.width : 1);
    super(Sprite3D._quad(), mat);
    this.type = 'Sprite3D'; this.billboard = options.billboard === 'y' ? 'y' : true;
    this.scale.set(w, h, 1); this.castShadow = options.castShadow === true;
    if (options.anchorY !== undefined) this.anchorY = options.anchorY;
  }
  static _quad() {
    // un único quad compartido (anclado abajo al centro: los pies en la posición)
    if (!Sprite3D._geo || Sprite3D._geo.disposed) { Sprite3D._geo = new Geometry3D(); var g = Sprite3D._geo; g.keep = true;
      g.setAttribute('position', new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3); g.setAttribute('normal', new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3);
      g.setAttribute('uv', new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2); g.setIndex([0, 1, 2, 0, 2, 3]); }
    return Sprite3D._geo;
  }
  _newEmpty() { return new Sprite3D(this.material.map, 1, 1); }
}

/* ================================================================== Factory3D */
function makeFactory3D(view) {
  /** view.add(nodo3D, ...) añade a la escena 3D; view.add(objeto2D) añade como hijo 2D de la vista */
  var f = function () {
    for (var i = 0; i < arguments.length; i++) {
      var o = arguments[i];
      if (o instanceof Node3D) view.scene3d.add(o);
      else if (o instanceof Container) Container.prototype.add.call(view, o);
      else if (Array.isArray(o)) f.apply(null, o);
    }
    return arguments[0];
  };
  var S = function () { return view.scene3d; };
  var M = function (m) { return view.material(m); };
  var put = function (mesh) { S().add(mesh); return mesh; };
  f.mesh = function (geometry, material) { return put(new Mesh3D(geometry, M(material))); };
  f.box = function (w, h, d, material) { if (typeof w === 'object' && w !== null && !(w instanceof Material3D)) { material = w; w = 1; } w = w === undefined ? 1 : w; return put(new Mesh3D(Geometry3D.box(w, h === undefined ? w : h, d === undefined ? w : d), M(material))); };
  f.cube = function (size, material) { return f.box(size || 1, size || 1, size || 1, material); };
  f.sphere = function (radius, material, segments) { return put(new Mesh3D(Geometry3D.sphere(radius || 0.5, segments || 32, Math.max(8, (segments || 32) >> 1)), M(material))); };
  f.plane = function (w, d, material, segX, segZ) { return put(new Mesh3D(Geometry3D.plane(w || 10, d === undefined ? (w || 10) : d, segX || 1, segZ || segX || 1), M(material))); };
  f.cylinder = function (rTop, rBottom, h, material, segments) { return put(new Mesh3D(Geometry3D.cylinder(rTop === undefined ? 0.5 : rTop, rBottom === undefined ? (rTop === undefined ? 0.5 : rTop) : rBottom, h || 1, segments || 24), M(material))); };
  f.cone = function (r, h, material, segments) { return put(new Mesh3D(Geometry3D.cone(r || 0.5, h || 1, segments || 24), M(material))); };
  f.capsule = function (r, len, material) { return put(new Mesh3D(Geometry3D.capsule(r || 0.4, len === undefined ? 1 : len), M(material))); };
  f.torus = function (R, r, material) { return put(new Mesh3D(Geometry3D.torus(R || 1, r || 0.3), M(material))); };
  f.extrude = function (points, height, material) { return put(new Mesh3D(Geometry3D.extrude(points, height || 1), M(material))); };
  /** Terreno: heights = función (x, z) => y  o  array de (segX+1)*(segZ+1) alturas */
  f.terrain = function (w, d, segX, segZ, heights, material) { return put(new Mesh3D(Geometry3D.heightfield(w || 100, d || 100, segX || 64, segZ || segX || 64, heights || null), M(material))); };
  f.instanced = function (geometry, material, count) { return put(new InstancedMesh3D(geometry, M(material), count || 16)); };
  f.group = function () { var g = new Group3D(); for (var i = 0; i < arguments.length; i++) g.add(arguments[i]); return put(g); };
  f.sprite = function (texture, w, h, options) { return put(new Sprite3D(view._tex(texture), w, h, options)); };
  f.ambientLight = function (color, intensity) { return put(new AmbientLight(color, intensity)); };
  f.hemisphereLight = function (sky, ground, intensity) { return put(new HemisphereLight(sky, ground, intensity)); };
  f.directionalLight = function (color, intensity) { return put(new DirectionalLight(color, intensity)); };
  f.pointLight = function (color, intensity, range, decay) { return put(new PointLight(color, intensity, range, decay)); };
  f.spotLight = function (color, intensity, range, angle, penumbra) { return put(new SpotLight(color, intensity, range, angle, penumbra)); };
  /** Iluminación exterior completa en 1 línea: sol con sombras + cielo/suelo */
  f.sunlight = function (o) {
    o = o || {};
    var hemi = put(new HemisphereLight(o.sky !== undefined ? o.sky : 0xcfe4ff, o.ground !== undefined ? o.ground : 0x6b5b45, o.ambient !== undefined ? o.ambient : 0.65));
    var sun = put(new DirectionalLight(o.color !== undefined ? o.color : 0xfff1dc, o.intensity !== undefined ? o.intensity : 1.9));
    if (o.direction) sun.setDirection(o.direction); else sun.setDirection(-0.45, -1, -0.35);
    if (o.shadows !== false) sun.enableShadows({ size: o.shadowSize || 40, mapSize: o.shadowMapSize || 2048, follow: o.follow || null });
    return { sun: sun, hemi: hemi };
  };
  /** Instancia un modelo glTF/GLB u OBJ ya cargado (this.load.gltf / this.load.obj) */
  f.model = function (key, options) {
    var sc = view.scene, cache = sc && sc.cache && sc.cache.models ? sc.cache.models : (UG._models || null);
    var asset = cache && cache.get ? cache.get(key) : null;
    if (!asset) { Log.warnOnce('model:' + key, 'Modelo 3D "' + key + '" no cargado'); return put(new Group3D()); }
    return put(asset.instantiate(options));
  };
  // mundo (definidas en 3d_world.js): hierba con viento, dispersión de modelos, instancias de un modelo y agua con olas
  f.grass = function (o) { return addGrass(view, o); };
  f.scatter = function (source, o) { return addScatter(view, source, o); };
  f.instances = function (key, transforms, o) { return addModelInstances(view, key, transforms || [], o); };
  f.water = function (w, d, o) { return addWater(view, w, d, o); };
  return f;
}

/* ===================================================================== View3D */
class View3D extends Sprite {
  /** new View3D(x, y, ancho, alto, opciones) — sin tamaño ocupa toda la pantalla y sigue sus cambios */
  constructor(x, y, width, height, options) {
    if (x !== null && typeof x === 'object') { options = x; x = options.x || 0; y = options.y || 0; width = options.width; height = options.height; }
    options = options || {};
    super(x || 0, y || 0);
    this.type = 'View3D';
    this.fullscreen = !(width > 0 && height > 0);
    this.viewWidth = width > 0 ? width : 800; this.viewHeight = height > 0 ? height : 600;
    this.renderScale = options.renderScale > 0 ? Math.min(options.renderScale, 4) : 1;
    this.antialias = options.antialias !== false;
    this.shadows = options.shadows !== false;
    this.autoAspect = options.autoAspect !== false;
    this.autoRender = true;
    this.timeScale = 1; this.paused = false;
    this.scene3d = options.scene3d instanceof Scene3D ? options.scene3d : new Scene3D();
    this._ownScene = !(options.scene3d instanceof Scene3D);
    if (options.background !== undefined) this.scene3d.background = options.background;
    this.camera = options.camera instanceof Camera3D ? options.camera : new PerspectiveCamera(options.fov || 60, this.viewWidth / this.viewHeight, options.near || 0.1, options.far || 1000);
    this._ownCamera = !(options.camera instanceof Camera3D);
    this.rt = new RenderTexture(this.viewWidth, this.viewHeight, 1, { label: 'View3D' });
    this.setTexture(this.rt); this.setOrigin(0, 0);
    this.add = makeFactory3D(this);
    this.controls = [];
    this.physics = null;
    this.raycaster = new Raycaster3D();
    /** Esta vista actualiza el oyente de audio 3D con su cámara */
    this.audioListener = options.audioListener !== false;
    this._sounds = [];
    this._frame = -1; this._rid = -1; this._dirty = true; this._users = new Set();
    Debug.track('View3D', 1);
  }
  get mixers() { return this.scene3d.mixers; }
  /** Tamaño lógico (px 2D) de la vista */
  setSize(w, h) {
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    if (w === this.viewWidth && h === this.viewHeight) return this;
    this.viewWidth = w; this.viewHeight = h; this._dirty = true;
    this.rt.resize(w, h, this.rt.source.resolution);
    this.setTexture(this.rt);
    return this;
  }
  setBackground(color, alpha) { this.scene3d.background = color; if (alpha !== undefined) this.scene3d.backgroundAlpha = alpha; return this; }
  /** Fuerza el render del próximo dibujado aunque ya se haya dibujado este frame */
  invalidate() { this._dirty = true; return this; }
  /* ---------- materiales y texturas ---------- */
  _tex(t) {
    if (!t) return null;
    if (t instanceof Texture) return t;
    if (typeof t === 'string') { var tm = (this.scene && this.scene.textures) || UG._defaultTextures; return tm ? tm.get(t) : null; }
    return null;
  }
  /** Normaliza: undefined | color | Material3D | {type:'toon'|'basic'|'standard', color, map:'clave', ...} */
  material(m) {
    if (m instanceof Material3D) return m;
    if (m === undefined || m === null) return new StandardMaterial();
    if (typeof m === 'number' || typeof m === 'string') return new StandardMaterial({ color: m });
    if (typeof m === 'object') {
      var o = {}, self = this;
      Object.keys(m).forEach(function (k) {
        if (Security.isForbiddenKey(k) || k === 'type') return;
        var v = m[k];
        if ((k === 'map' || /Map$/.test(k)) && v !== null && v !== undefined && !(v instanceof Texture)) v = self._tex(v);
        o[k] = v;
      });
      var type = String(m.type || 'standard').toLowerCase();
      if (type === 'toon') return new ToonMaterial(o);
      if (type === 'basic' || type === 'unlit') return new BasicMaterial(o);
      return new StandardMaterial(o);
    }
    return new StandardMaterial();
  }
  /* ---------- actualización ---------- */
  preUpdate(time, delta) {
    if (this.fullscreen) {
      var g = this.scene && this.scene.game;
      if (g && (g.width !== this.viewWidth || g.height !== this.viewHeight)) this.setSize(g.width, g.height);
    }
    if (this.paused) return;
    var dt = Math.min(Math.max(delta, 0), 100) / 1000 * this.timeScale;
    this.scene3d.time = (this.scene3d.time + dt) % 36000; // acotado: precisión de float32 en los shaders
    var mx = this.scene3d.mixers, i;
    for (i = 0; i < mx.length; i++) mx[i].update(dt);
    for (i = 0; i < this.controls.length; i++) { var c = this.controls[i]; if (c.enabled !== false && c.update) c.update(dt, this); }
    if (this.physics) this.physics.step(dt);
    this._updateAudio();
    this.emit('update3d', dt);
  }
  /* ---------- audio 3D ---------- */
  /**
   * Reproduce un sonido en una posición 3D (Vec3/{x,y,z}) o pegado a un nodo que se mueve.
   * config: las opciones de sound.play + { refDistance (2), maxDistance (80), rolloff (1), hrtf (false) }
   */
  playSound(key, where, config) {
    var g = this.scene && this.scene.game; if (!g || !g.sound) return null;
    config = config || {};
    var node = where instanceof Node3D ? where : null, p = node ? node.getWorldPosition(new Vec3()) : (where || this.camera.position);
    var sp = { x: p.x, y: p.y, z: p.z, refDistance: config.refDistance, maxDistance: config.maxDistance, rolloff: config.rolloff, hrtf: config.hrtf, model: config.distanceModel };
    var inst = config.sfx ? g.sound.playSfx(config.sfx, Object.assign({}, config, { spatial: sp })) : g.sound.play(key, Object.assign({}, config, { spatial: sp }));
    if (inst && node) this._sounds.push({ inst: inst, node: node });
    this._updateAudio(true);
    return inst;
  }
  /** Efecto sintetizado (sound.playSfx) en una posición 3D */
  playSfx(spec, where, config) { return this.playSound(null, where, Object.assign({}, config || {}, { sfx: spec })); }
  _updateAudio(force) {
    var g = this.scene && this.scene.game, snd = g && g.sound;
    if (!snd || !snd.ctx) return;
    for (var i = this._sounds.length - 1; i >= 0; i--) {
      var s = this._sounds[i];
      if (s.inst.destroyed || !s.inst.isPlaying || s.node.destroyed) { this._sounds.splice(i, 1); continue; }
      var wp = s.node.getWorldPosition(_vv2); s.inst.setPosition(wp.x, wp.y, wp.z);
    }
    if (this.audioListener && (force || this.visible)) {
      var c = this.camera; c.updateWorldMatrix(); var e = c.matrixWorld.e;
      snd.setListener(e[12], e[13], e[14], -e[8], -e[9], -e[10], e[4], e[5], e[6]);
    }
  }
  addControl(c) { if (c && this.controls.indexOf(c) < 0) this.controls.push(c); return c; }
  removeControl(c) { var i = this.controls.indexOf(c); if (i >= 0) { this.controls.splice(i, 1); if (c.destroy) c.destroy(); } return this; }
  /* ---------- render ---------- */
  _renderGPU(r) {
    if (this.autoRender && (this._dirty || this._frame !== r.stats.frame || this._rid !== r.uid)) {
      var R = Renderer3D.get(r);
      if (R) {
        var max = r.maxTextureSize || 4096, res = r.resolution * this.renderScale;
        res = Math.min(res, (max - 2) / this.viewWidth, (max - 2) / this.viewHeight);
        var src = this.rt.source;
        if (Math.abs(src.resolution - res) > 1e-6 || src.width !== Math.ceil(this.viewWidth * res) || src.height !== Math.ceil(this.viewHeight * res)) { this.rt.resize(this.viewWidth, this.viewHeight, res); this.setTexture(this.rt); }
        this._users.add(R.uid);
        R.renderView(this);
      }
      this._frame = r.stats.frame; this._rid = r.uid; this._dirty = false;
    }
    super._renderGPU(r);
  }
  _renderCanvas(r) {
    Log.warnOnce('view3d-canvas', 'View3D necesita WebGL o WebGPU (el backend Canvas 2D no tiene 3D).');
    void r;
  }
  get stats() { var r = this.scene && this.scene.game && this.scene.game.renderer; return r && r._r3d ? r._r3d.stats : null; }
  /* ---------- coordenadas y picking ---------- */
  /** Coordenadas de pantalla (o de mundo 2D) -> NDC de la vista */
  toNDC(x, y, out) {
    var p = this.worldTransform.applyInverse(x, y, new Vec2());
    out = out || new Vec2();
    out.x = p.x / this.viewWidth * 2 - 1; out.y = 1 - p.y / this.viewHeight * 2;
    return out;
  }
  /** Rayo 3D bajo un punto de pantalla */
  screenToRay(x, y, out) { var n = this.toNDC(x, y); this.raycaster.setFromCamera(n.x, n.y, this.camera); return (out || new Ray()).copy(this.raycaster.ray); }
  /** Objetos 3D bajo un punto de pantalla (ordenados por distancia). options: {filter, recursive, first, bounds, objects} */
  raycast(x, y, options) {
    options = options || {};
    var n = this.toNDC(x, y);
    if (n.x < -1 || n.x > 1 || n.y < -1 || n.y > 1) return [];
    this.scene3d.updateMatrixWorld();
    this.raycaster.setFromCamera(n.x, n.y, this.camera);
    return this.raycaster.intersect(options.objects || this.scene3d, options);
  }
  /** El objeto más cercano bajo el punto (o null) */
  pick(x, y, options) { var h = this.raycast(x, y, Object.assign({}, options || {}, { first: true })); return h.length ? h[0] : null; }
  /** Punto 3D -> coordenadas de pantalla {x, y, visible, depth} (para etiquetas y barras del HUD) */
  worldToScreen(v, out) {
    var c = this.camera; c.updateWorldMatrix(); c.viewMatrix.invertFrom(c.matrixWorld); c.viewProjection.multiplyMatrices(c.projectionMatrix, c.viewMatrix);
    var p = _vv.copy(v).applyMat4(c.viewProjection);
    var lx = (p.x * 0.5 + 0.5) * this.viewWidth, ly = (0.5 - p.y * 0.5) * this.viewHeight;
    var s = this.worldTransform.apply(lx, ly, new Vec2());
    out = out || {};
    out.x = s.x; out.y = s.y; out.depth = p.z; out.visible = p.z > -1 && p.z < 1 && p.x >= -1 && p.x <= 1 && p.y >= -1 && p.y <= 1;
    return out;
  }
  /* ---------- ciclo de vida ---------- */
  _onDestroy() {
    var self = this, skels = [];
    // texturas/buffers de huesos de los personajes de esta escena: se liberan ya (sin esperar al barrido periódico,
    // que no llega a ejecutarse si después solo hay escenas 2D)
    if (this._ownScene && this.scene3d) this.scene3d.traverse(function (n) { if (n.skeleton && skels.indexOf(n.skeleton) < 0) skels.push(n.skeleton); });
    this._users.forEach(function (rid) {
      var R = RendererRegistry.get(rid); if (!R) return; // R = Renderer3D (WebGL3D / WebGPU3D), registrado con su propio uid
      if (R.freeSkeleton) for (var k = 0; k < skels.length; k++) R.freeSkeleton(skels[k]);
      if (R.freeView) R.freeView(self);
    });
    this._users.clear();
    for (var i = 0; i < this.controls.length; i++) if (this.controls[i].destroy) this.controls[i].destroy();
    this.controls.length = 0;
    this._sounds.forEach(function (s) { if (!s.inst.destroyed && s.inst.loop) s.inst.stop(); });
    this._sounds.length = 0;
    if (this.physics && this.physics.destroy) this.physics.destroy();
    this.physics = null;
    if (this._ownScene && this.scene3d) this.scene3d.destroy();
    if (this._ownCamera && this.camera && !this.camera.destroyed) this.camera.destroy();
    this.scene3d = null; this.camera = null;
    super._onDestroy();
    if (this.rt) { this.rt.destroy(); this.rt = null; }
    Debug.track('View3D', -1);
  }
}

GameObjectFactory.prototype.view3d = function (x, y, width, height, options) { return this._add(new View3D(x, y, width, height, options)); };

UG.View3D = View3D; UG.Raycaster3D = Raycaster3D; UG.Sprite3D = Sprite3D;
