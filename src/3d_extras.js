/* UltraGame 3D - extras: partículas 3D (billboards instanciados, 1 draw call por emisor, con presets) y
 * constructor de niveles 3D desde mapas de Tiled o rejillas de texto (FPS, laberintos, plataformas). */

/* ================================================================ Partículas */
var PARTICLE3D_PRESETS = {
  fire: { rate: 60, life: [0.5, 1.0], speed: [0.6, 1.6], spread: 0.35, direction: [0, 1, 0], gravity: 1.5, size: [0.6, 0.1], color: [0xffe08a, 0xff5a1f], alpha: [0.9, 0], blend: 'add', drag: 0.5, radius: 0.25 },
  smoke: { rate: 18, life: [1.5, 3], speed: [0.4, 1.0], spread: 0.3, direction: [0, 1, 0], gravity: 0.6, size: [0.5, 2.2], color: [0x777777, 0x333333], alpha: [0.45, 0], blend: 'normal', drag: 0.4, radius: 0.3 },
  explosion: { rate: 0, burst: 80, life: [0.4, 1.1], speed: [4, 11], spread: 1, gravity: -6, size: [1.1, 0.1], color: [0xfff1b0, 0xff3b10], alpha: [1, 0], blend: 'add', drag: 2.5, radius: 0.4 },
  sparks: { rate: 0, burst: 30, life: [0.25, 0.6], speed: [4, 9], spread: 0.7, direction: [0, 1, 0], gravity: -14, size: [0.12, 0.02], color: [0xffffff, 0xffb13b], alpha: [1, 0], blend: 'add', drag: 1 },
  dust: { rate: 0, burst: 14, life: [0.4, 0.9], speed: [0.5, 2], spread: 1, direction: [0, 0.4, 0], gravity: 0.5, size: [0.25, 0.8], color: [0xc9b79a, 0xa38f72], alpha: [0.5, 0], blend: 'normal', drag: 2 },
  magic: { rate: 40, life: [0.6, 1.4], speed: [0.2, 0.8], spread: 1, gravity: 0.8, size: [0.25, 0], color: [0x8ec5ff, 0xd07bff], alpha: [1, 0], blend: 'add', drag: 0.8, radius: 0.5 },
  blood: { rate: 0, burst: 24, life: [0.3, 0.7], speed: [2, 5], spread: 0.6, direction: [0, 1, 0], gravity: -16, size: [0.15, 0.05], color: [0xb3001b, 0x5a0010], alpha: [1, 0.6], blend: 'normal', drag: 0.5 },
  muzzle: { rate: 0, burst: 10, life: [0.04, 0.09], speed: [1, 4], spread: 0.25, direction: [0, 0, 1], gravity: 0, size: [0.35, 0.05], color: [0xfff4c2, 0xffa12e], alpha: [1, 0], blend: 'add' },
  rain: { rate: 400, life: [0.8, 1.0], speed: [18, 22], spread: 0.02, direction: [0, -1, 0], gravity: 0, size: [0.05, 0.05], stretch: 12, color: [0xaec8e8, 0xaec8e8], alpha: [0.5, 0.5], blend: 'normal', box: [30, 0, 30], offset: [0, 15, 0] },
  snow: { rate: 120, life: [5, 7], speed: [0.8, 1.4], spread: 0.3, direction: [0, -1, 0], gravity: 0, size: [0.12, 0.12], color: [0xffffff, 0xffffff], alpha: [0.9, 0.9], blend: 'normal', box: [30, 0, 30], offset: [0, 12, 0], wobble: 0.6 },
  coin: { rate: 0, burst: 16, life: [0.3, 0.6], speed: [2, 4], spread: 1, gravity: -4, size: [0.2, 0], color: [0xffe066, 0xffb700], alpha: [1, 0], blend: 'add' },
  trail: { rate: 50, life: [0.3, 0.5], speed: [0, 0.2], spread: 1, gravity: 0, size: [0.35, 0], color: [0x9be7ff, 0x3f8cff], alpha: [0.7, 0], blend: 'add' }
};
var _pxQ = new Quat(), _pxM = new Mat4(), _pxV = new Vec3(), _pxS = new Vec3(), _pxC = [0, 0, 0], _pxC2 = [0, 0, 0];

/** Textura suave (círculo con degradado) en RGBA crudo: funciona en navegador y en Node */
function softParticleTexture(size) {
  size = size || 64;
  if (softParticleTexture._t && !softParticleTexture._t.source.destroyed) return softParticleTexture._t;
  var d = new Uint8Array(size * size * 4), c = (size - 1) / 2;
  for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
    var r = Math.hypot(x - c, y - c) / c, a = Math.max(0, 1 - r); a = a * a * (3 - 2 * a);
    var o = (y * size + x) * 4; d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = Math.round(a * 255);
  }
  var t = new Texture(new TextureSource({ data: d, width: size, height: size }, { width: size, height: size, mipmap: true, label: 'particle3d' }));
  Debug.track('TextureSource', -1); // textura global compartida (se crea una vez): no cuenta como fuga
  softParticleTexture._t = t;
  return t;
}

class ParticleEmitter3D extends InstancedMesh3D {
  /** preset: nombre de PARTICLE3D_PRESETS o configuración; options sobrescribe. capacity = máximo de partículas vivas */
  constructor(view, preset, options) {
    var cfg = Object.assign({}, typeof preset === 'string' ? (PARTICLE3D_PRESETS[preset] || {}) : (preset || {}), options || {});
    var cap = Math.max(1, Math.min(cfg.capacity || Math.max(64, Math.ceil((cfg.rate || 0) * (cfg.life ? cfg.life[1] : 1) * 1.3) + (cfg.burst || 0) * 2), 20000));
    var tex = cfg.texture instanceof Texture ? cfg.texture : (typeof cfg.texture === 'string' && view ? view._tex(cfg.texture) : softParticleTexture());
    var mat = new BasicMaterial({ map: tex, transparent: true, blend: cfg.blend === 'normal' ? 'normal' : (cfg.blend || 'add'), side: 'double', fog: cfg.fog !== false });
    super(Geometry3D.plane(1, 1, 1, 1, 'xy'), mat, cap);
    this.type = 'ParticleEmitter3D';
    this.view = view; this.cfg = cfg; this.castShadow = false; this.receiveShadow = false; this.frustumCulled = false; this.renderOrder = cfg.renderOrder || 10;
    this.emitting = cfg.rate > 0 && cfg.autoStart !== false; this.worldSpace = cfg.worldSpace !== false;
    this.count = 0; this.useInstanceColor = true;
    this._p = new Float32Array(cap * 12); // px py pz vx vy vz age life size0 size1 seed alive
    this._n = 0; this._acc = 0; this._rng = cfg.rng || Math.random;
    this.duration = cfg.duration || 0; this._t = 0;
    if (cfg.burst && cfg.rate === 0 && cfg.autoStart !== false) this._pendingBurst = cfg.burst;
    var cA = cfg.color || [0xffffff, 0xffffff]; this._c0 = colorToLinear(cA[0]); this._c1 = colorToLinear(cA[1] !== undefined ? cA[1] : cA[0]);
    this.autoDestroy = !!cfg.autoDestroy;
  }
  _rand(a) { if (Array.isArray(a)) return a[0] + (a[1] - a[0]) * this._rng(); return a || 0; }
  /** Emite n partículas ya (explosión, chispas, disparo). position y direction ([x,y,z]) opcionales (mundo) */
  burst(n, position, direction) { this._dirOverride = direction || null; for (var i = 0; i < n; i++) this._spawn(position); this._dirOverride = null; return this; }
  start() { this.emitting = true; this._t = 0; return this; }
  stop() { this.emitting = false; return this; }
  get alive() { return this._n; }
  _spawn(at) {
    var cap = this.capacity; if (this._n >= cap) return;
    var cfg = this.cfg, P = this._p, o = this._n * 12, r = this._rng;
    var base = at ? _pxV.copy(at) : (this.worldSpace ? this.getWorldPosition(_pxV) : _pxV.set(0, 0, 0));
    var off = cfg.offset || [0, 0, 0], rad = cfg.radius || 0, bx = cfg.box || null;
    var ox = off[0], oy = off[1], oz = off[2];
    if (bx) { ox += (r() - 0.5) * bx[0]; oy += (r() - 0.5) * bx[1]; oz += (r() - 0.5) * bx[2]; }
    else if (rad) { var a = r() * Math.PI * 2, u = r() * 2 - 1, rr = rad * Math.cbrt(r()), s = Math.sqrt(1 - u * u); ox += Math.cos(a) * s * rr; oy += u * rr; oz += Math.sin(a) * s * rr; }
    P[o] = base.x + ox; P[o + 1] = base.y + oy; P[o + 2] = base.z + oz;
    // dirección: cono alrededor de direction (spread 0..1: 1 = esfera completa)
    var dir = this._dirOverride || cfg.direction || [0, 1, 0], sp = cfg.spread === undefined ? 0.3 : cfg.spread;
    var dx = +dir[0] || 0, dy = +dir[1] || 0, dz = +dir[2] || 0;
    if (!this._dirOverride && this.worldSpace && cfg.localDirection !== false && this.parent) { _pxS.set(dx, dy, dz).transformDirection(this.matrixWorld); dx = _pxS.x; dy = _pxS.y; dz = _pxS.z; }
    var ra = r() * Math.PI * 2, ru = 1 - r() * sp * 2, rs = Math.sqrt(Math.max(0, 1 - ru * ru));
    var rx = Math.cos(ra) * rs, ry = ru, rz = Math.sin(ra) * rs;
    var dl = Math.hypot(dx, dy, dz);
    if (dl < 1e-6) { dx = rx; dy = ry; dz = rz; }
    else {
      dx /= dl; dy /= dl; dz /= dl;
      _pxQ.setFromUnitVectors(Vec3.UP, _pxS.set(dx, dy, dz)); _pxS.set(rx, ry, rz).applyQuat(_pxQ); dx = _pxS.x; dy = _pxS.y; dz = _pxS.z;
    }
    var spd = this._rand(cfg.speed || [1, 2]);
    P[o + 3] = dx * spd; P[o + 4] = dy * spd; P[o + 5] = dz * spd;
    P[o + 6] = 0; P[o + 7] = Math.max(0.01, this._rand(cfg.life || [1, 1]));
    var sz = cfg.size || [0.3, 0.1]; P[o + 8] = Array.isArray(sz) ? sz[0] : sz; P[o + 9] = Array.isArray(sz) ? (sz[1] !== undefined ? sz[1] : sz[0]) : sz;
    P[o + 10] = r() * 100; P[o + 11] = 1;
    this._n++;
  }
  _step(dt) {
    var cfg = this.cfg;
    if (this._pendingBurst) { this.burst(this._pendingBurst); this._pendingBurst = 0; }
    if (this.emitting && cfg.rate > 0) {
      this._acc += cfg.rate * dt;
      var n = Math.floor(this._acc); this._acc -= n;
      for (var i = 0; i < n; i++) this._spawn();
      if (this.duration > 0 && (this._t += dt) >= this.duration) this.emitting = false;
    }
    var P = this._p, g = cfg.gravity || 0, drag = cfg.drag || 0, k = Math.max(0, 1 - drag * dt), w = cfg.wobble || 0;
    for (var j = 0; j < this._n; j++) {
      var o = j * 12;
      P[o + 6] += dt;
      if (P[o + 6] >= P[o + 7]) {
        // compactar: la última viva ocupa este hueco
        var last = (this._n - 1) * 12; for (var q = 0; q < 12; q++) P[o + q] = P[last + q];
        this._n--; j--; continue;
      }
      P[o + 4] += g * dt; P[o + 3] *= k; P[o + 4] *= k; P[o + 5] *= k;
      P[o] += P[o + 3] * dt; P[o + 1] += P[o + 4] * dt; P[o + 2] += P[o + 5] * dt;
      if (w) { P[o] += Math.sin(P[o + 6] * 2 + P[o + 10]) * w * dt; P[o + 2] += Math.cos(P[o + 6] * 1.7 + P[o + 10]) * w * dt; }
    }
  }
  /** Construye las matrices mirando a la cámara (llamado por la vista antes de dibujar) */
  _build(cam) {
    var P = this._p, M = this.instanceMatrix, C = this.instanceColor, cfg = this.cfg, al = cfg.alpha || [1, 0], str = cfg.stretch || 0;
    cam.updateWorldMatrix(); var ce = cam.matrixWorld.e;
    // ejes de la cámara (derecha y arriba)
    var rx = ce[0], ry = ce[1], rz = ce[2], ux = ce[4], uy = ce[5], uz = ce[6];
    var inv = null;
    if (this.worldSpace) { this.updateWorldMatrix(); inv = _pxM.invertFrom(this.matrixWorld); }
    var c0 = this._c0, c1 = this._c1;
    for (var j = 0; j < this._n; j++) {
      var o = j * 12, t = P[o + 6] / P[o + 7], s = P[o + 8] + (P[o + 9] - P[o + 8]) * t, a = (Array.isArray(al) ? al[0] + (al[1] - al[0]) * t : al);
      var m = j * 16, px = P[o], py = P[o + 1], pz = P[o + 2];
      var ax = rx * s, ay = ry * s, az = rz * s, bx = ux * s, by = uy * s, bz = uz * s;
      if (str) { var vx = P[o + 3], vy = P[o + 4], vz = P[o + 5], vl = Math.hypot(vx, vy, vz); if (vl > 1e-4) { var ls = s * str; bx = vx / vl * ls; by = vy / vl * ls; bz = vz / vl * ls; } }
      if (inv) { var e = inv.e; var tx = e[0] * px + e[4] * py + e[8] * pz + e[12], ty = e[1] * px + e[5] * py + e[9] * pz + e[13], tz = e[2] * px + e[6] * py + e[10] * pz + e[14]; px = tx; py = ty; pz = tz;
        var nax = e[0] * ax + e[4] * ay + e[8] * az, nay = e[1] * ax + e[5] * ay + e[9] * az, naz = e[2] * ax + e[6] * ay + e[10] * az; ax = nax; ay = nay; az = naz;
        var nbx = e[0] * bx + e[4] * by + e[8] * bz, nby = e[1] * bx + e[5] * by + e[9] * bz, nbz = e[2] * bx + e[6] * by + e[10] * bz; bx = nbx; by = nby; bz = nbz; }
      M[m] = ax; M[m + 1] = ay; M[m + 2] = az; M[m + 3] = 0;
      M[m + 4] = bx; M[m + 5] = by; M[m + 6] = bz; M[m + 7] = 0;
      M[m + 8] = 0; M[m + 9] = 0; M[m + 10] = 0.001; M[m + 11] = 0;
      M[m + 12] = px; M[m + 13] = py; M[m + 14] = pz; M[m + 15] = 1;
      var ci = j * 4; C[ci] = c0[0] + (c1[0] - c0[0]) * t; C[ci + 1] = c0[1] + (c1[1] - c0[1]) * t; C[ci + 2] = c0[2] + (c1[2] - c0[2]) * t; C[ci + 3] = Math.max(0, a);
    }
    this.count = this._n; this.instanceVersion++; this._bounds = null;
    this.visible = this._n > 0 || this.visible;
  }
  update(dt) {
    this._step(dt);
    if (this.view && this.view.camera) this._build(this.view.camera);
    if (this.autoDestroy && !this.emitting && this._n === 0 && !this._pendingBurst) { this.destroy(); return false; }
    return true;
  }
  _onDestroy() { super._onDestroy(); if (this.view) { var l = this.view._particles; if (l) { var i = l.indexOf(this); if (i >= 0) l.splice(i, 1); } } this.view = null; }
}

View3D.prototype.addParticles = function (preset, options) {
  var e = new ParticleEmitter3D(this, preset, options);
  (this._particles || (this._particles = [])).push(e);
  this.scene3d.add(e);
  if (!this._particleHook) {
    var self = this; this._particleHook = true;
    this.on('update3d', function (dt) { var l = self._particles; for (var i = l.length - 1; i >= 0; i--) { var p = l[i]; if (!p || p.destroyed) { l.splice(i, 1); continue; } p.update(dt); } });
  }
  return e;
};
/**
 * Efecto puntual: view.effect('explosion', pos, { count, direction: [x,y,z] }).
 * Reutiliza un emisor por tipo de efecto (sin crear geometría ni buffers nuevos en cada disparo).
 */
View3D.prototype.effect = function (preset, position, options) {
  options = options || {};
  var rest = {}, extra = false;
  Object.keys(options).forEach(function (k) { if (k !== 'count' && k !== 'direction' && !Security.isForbiddenKey(k)) { rest[k] = options[k]; extra = true; } });
  var key = (typeof preset === 'string' ? preset : JSON.stringify(preset)) + (extra ? '|' + JSON.stringify(rest) : '');
  var fx = this._fx || (this._fx = new Map()), e = fx.get(key);
  if (!e || e.destroyed) {
    var base = typeof preset === 'string' ? (PARTICLE3D_PRESETS[preset] || {}) : (preset || {});
    e = this.addParticles(preset, Object.assign({}, rest, { rate: 0, autoStart: false, autoDestroy: false, capacity: Math.max(96, (base.burst || 20) * 8) }));
    e.name = 'fx:' + key; fx.set(key, e);
  }
  var cfg = e.cfg, n = Math.max(1, Math.min(options.count || cfg.burst || 20, e.capacity));
  e.burst(n, position instanceof Vec3 ? position : new Vec3(position.x, position.y, position.z), options.direction);
  return e;
};

/* ================================================================== Level3D */
/**
 * Constructor de niveles:
 *  - Level3D.fromGrid(view, filas, leyenda, opciones): ['#####', '#.P.#'] con leyenda { '#': 'wall', '.': 'floor', P: 'spawn:player' }
 *    opciones: { cell, wallHeight, center (true), offset: {x, y, z} (desplaza mallas, colisionadores y spawns), materials, physics, name }
 *  - Level3D.fromTiled(view, mapa, opciones): capas de tiles -> suelos/paredes (altura por propiedad "height" de capa o tile),
 *    capas de objetos -> entidades con sus propiedades.
 * Devuelve { root, spawns: {nombre: [Vec3]}, objects: [...], colliders: [...], cell } y crea colisionadores si hay física.
 */
var Level3D = {
  fromGrid: function (view, rows, legend, o) {
    o = o || {};
    var cell = o.cell || 2, wallH = o.wallHeight || 3, root = new Group3D(); root.name = o.name || 'level';
    var mats = Object.assign({ wall: 0x9a8f86, floor: 0x5f6b73, ceiling: null, crate: 0xb07a3c }, o.materials || {});
    var M = function (k) { var m = mats[k]; return m instanceof Material3D ? m : view.material(m); };
    var H = rows.length, W = rows.reduce(function (a, r) { return Math.max(a, r.length); }, 0);
    var ox = o.center !== false ? -W * cell / 2 : 0, oz = o.center !== false ? -H * cell / 2 : 0;
    // desplazamiento opcional del nivel entero: las mallas cuelgan de root (movido) y colisionadores/spawns se suman
    var off = o.offset ? new Vec3(+o.offset.x || 0, +o.offset.y || 0, +o.offset.z || 0) : new Vec3();
    root.position.copy(off);
    var walls = [], floors = [], crates = [], out = { root: root, spawns: Object.create(null), objects: [], colliders: [], cell: cell, width: W, height: H, origin: new Vec3(ox + off.x, off.y, oz + off.z) };
    var pos = function (x, z) { return new Vec3(ox + (x + 0.5) * cell, 0, oz + (z + 0.5) * cell); };
    out.toWorld = function (x, z) { return pos(x, z).add(off); }; out.toCell = function (p) { return { x: Math.floor((p.x - off.x - ox) / cell), z: Math.floor((p.z - off.z - oz) / cell) }; };
    out.solid = function (x, z) { if (z < 0 || z >= H || x < 0 || x >= W) return true; var t = legend[rows[z][x]]; return t === 'wall'; };
    for (var z = 0; z < H; z++) for (var x = 0; x < W; x++) {
      var ch = rows[z][x] || ' ', t = legend[ch]; if (t === undefined || t === null) continue;
      var p = pos(x, z);
      if (t === 'wall') walls.push(p);
      else { if (t !== 'void') floors.push(p); if (t === 'crate') crates.push(p); if (typeof t === 'string' && t.indexOf('spawn:') === 0) { var nm = t.slice(6); (out.spawns[nm] || (out.spawns[nm] = [])).push(p.clone().add(off)); } if (typeof t === 'object') out.objects.push(Object.assign({ position: p.clone().add(off), cell: { x: x, z: z }, char: ch }, t)); }
    }
    // sin elementos: la geometría recién creada no la usará nadie -> se libera ya (evita una fuga por nivel)
    var inst = function (geo, mat, list, y, name) { if (!list.length) { geo.dispose(); return null; } var im = new InstancedMesh3D(geo, mat, list.length); im.name = name; list.forEach(function (p, i) { im.setTransformAt(i, new Vec3(p.x, y, p.z), 0, 1); }); root.add(im); return im; };
    var wallMesh = inst(Geometry3D.box(cell, wallH, cell), M('wall'), walls, wallH / 2, 'walls');
    inst(Geometry3D.box(cell, 0.2, cell), M('floor'), floors.concat(walls), -0.1, 'floor');
    if (mats.ceiling !== null) inst(Geometry3D.box(cell, 0.2, cell), M('ceiling'), floors, wallH + 0.1, 'ceiling');
    var crateMesh = inst(Geometry3D.box(cell * 0.7, cell * 0.7, cell * 0.7), M('crate'), crates, cell * 0.35, 'crates');
    view.scene3d.add(root);
    var ph = view.physics;
    if (ph && o.physics !== false) {
      // paredes contiguas en fila se fusionan en una sola caja (menos colisionadores)
      for (var zz = 0; zz < H; zz++) {
        var run = -1;
        for (var xx = 0; xx <= W; xx++) {
          var isW = xx < W && legend[rows[zz][xx]] === 'wall';
          if (isW && run < 0) run = xx;
          if (!isW && run >= 0) { var len = xx - run, c = new Vec3(ox + (run + len / 2) * cell, wallH / 2, oz + (zz + 0.5) * cell).add(off); out.colliders.push(ph.addBox(c, new Vec3(len * cell / 2, wallH / 2, cell / 2))); run = -1; }
        }
      }
      out.colliders.push(ph.addBox(new Vec3(ox + W * cell / 2, -0.5, oz + H * cell / 2).add(off), new Vec3(W * cell / 2 + cell, 0.5, H * cell / 2 + cell)));
      crates.forEach(function (p) { out.colliders.push(ph.addBox(new Vec3(p.x, cell * 0.35, p.z).add(off), new Vec3(cell * 0.35, cell * 0.35, cell * 0.35))); });
      if (mats.ceiling !== null) out.colliders.push(ph.addBox(new Vec3(ox + W * cell / 2, wallH + 0.5, oz + H * cell / 2).add(off), new Vec3(W * cell / 2, 0.5, H * cell / 2)));
    }
    out.walls = wallMesh; out.crates = crateMesh;
    return out;
  },
  /** Desde un mapa de Tiled ya cargado (this.load.tilemapTiledJSON) o normalizado */
  fromTiled: function (view, map, o) {
    o = o || {};
    if (typeof map === 'string') { var sc = view.scene; map = sc && sc.cache ? sc.cache.tilemap.get(map) : null; }
    if (!map || !map.layers) throw new Error('Level3D.fromTiled: mapa no válido');
    var cell = o.cell || 2, root = new Group3D(); root.name = o.name || 'tiled-level';
    var W = map.width, H = map.height, ox = o.center !== false ? -W * cell / 2 : 0, oz = o.center !== false ? -H * cell / 2 : 0;
    var out = { root: root, spawns: Object.create(null), objects: [], colliders: [], cell: cell, width: W, height: H, origin: new Vec3(ox, 0, oz) };
    var ph = view.physics, palette = o.colors || [0x8d99ae, 0x6c757d, 0xb08968, 0x588157, 0x9d4edd, 0xe09f3e, 0x3a86ff, 0xef476f];
    var tileProps = function (gid) {
      if (!gid) return null;
      for (var i = map.tilesets.length - 1; i >= 0; i--) { var ts = map.tilesets[i]; if (gid >= ts.firstgid) { var t = ts.tiles ? ts.tiles.find(function (tt) { return tt.id === gid - ts.firstgid; }) : null; return t && t.properties ? t.properties : {}; } }
      return {};
    };
    var byKey = new Map();
    map.layers.forEach(function (layer, li) {
      var lp = layer.properties || {};
      if (layer.type === 'tilelayer' && layer.data && layer.visible !== false) {
        var baseY = +lp.elevation || 0, lh = lp.height !== undefined ? +lp.height : (li === 0 ? 0.2 : cell);
        for (var z = 0; z < layer.height; z++) for (var x = 0; x < layer.width; x++) {
          var gid = layer.data[z * layer.width + x] & 0x1FFFFFFF; if (!gid) continue;
          var tp = tileProps(gid) || {}, h = tp.height !== undefined ? +tp.height : lh, solid = tp.solid !== undefined ? !!tp.solid : (lp.solid !== undefined ? !!lp.solid : h > 0.5);
          var key = gid + '|' + h + '|' + baseY, e = byKey.get(key);
          if (!e) { e = { gid: gid, h: Math.max(0.05, h), y: baseY, list: [], solid: solid, color: tp.color !== undefined ? tp.color : palette[gid % palette.length] }; byKey.set(key, e); }
          e.list.push({ x: ox + (x + 0.5) * cell, z: oz + (z + 0.5) * cell });
        }
      } else if (layer.type === 'objectgroup' && layer.objects) {
        layer.objects.forEach(function (ob) {
          var tw = map.tilewidth || 32, th = map.tileheight || 32;
          var wx = ox + (ob.x + (ob.width || 0) / 2) / tw * cell, wz = oz + (ob.y + (ob.height || 0) / 2) / th * cell;
          var props = ob.properties || {}, p = new Vec3(wx, +props.y || 0, wz);
          var rec = { name: ob.name || '', type: ob.type || ob.class || '', position: p, width: (ob.width || 0) / tw * cell, depth: (ob.height || 0) / th * cell, rotation: -(ob.rotation || 0) * DEG_TO_RAD, properties: props };
          out.objects.push(rec);
          var kind = rec.type || rec.name; if (kind) (out.spawns[kind] || (out.spawns[kind] = [])).push(p.clone());
        });
      }
    });
    byKey.forEach(function (e) {
      var mat = o.materials && o.materials[e.gid] ? view.material(o.materials[e.gid]) : view.material({ color: e.color, roughness: 0.85 });
      var im = new InstancedMesh3D(Geometry3D.box(cell, e.h, cell), mat, e.list.length); im.name = 'tiles-' + e.gid;
      e.list.forEach(function (p, i) { im.setTransformAt(i, new Vec3(p.x, e.y + e.h / 2, p.z), 0, 1); });
      root.add(im);
      if (ph && e.solid && o.physics !== false) e.list.forEach(function (p) { out.colliders.push(ph.addBox(new Vec3(p.x, e.y + e.h / 2, p.z), new Vec3(cell / 2, e.h / 2, cell / 2))); });
      else if (ph && o.physics !== false && e.y === 0) e.list.forEach(function (p) { out.colliders.push(ph.addBox(new Vec3(p.x, e.y + e.h / 2, p.z), new Vec3(cell / 2, e.h / 2, cell / 2))); });
    });
    view.scene3d.add(root);
    return out;
  }
};

UG.ParticleEmitter3D = ParticleEmitter3D; UG.PARTICLE3D_PRESETS = PARTICLE3D_PRESETS; UG.Level3D = Level3D; UG.softParticleTexture = softParticleTexture;
