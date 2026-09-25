/* Bloques — sandbox de vóxeles 3D: terreno por ruido con semilla, árboles, trozos (chunks) con solo las caras
 * visibles, primera persona, romper/poner bloques con un rayo DDA, barra de bloques, colisión por trozo que se
 * reconstruye al editar y guardado/carga en localStorage con validación estricta. */
(function () {
  'use strict';
  var V3 = UG.Vec3;
  var SX = 64, SY = 32, SZ = 64, CS = 16, SEA = 7;
  // id: [nombre, color arriba, color lados]
  var BLOCKS = [null, ['Hierba', 0x5da13f, 0x7a5a3a], ['Tierra', 0x7a5a3a, 0x7a5a3a], ['Piedra', 0x8a8d91, 0x8a8d91], ['Arena', 0xe0cf8a, 0xd8c47c], ['Tronco', 0x9c7a50, 0x6b4a2b],
    ['Hojas', 0x3c8a3a, 0x357a33], ['Tablas', 0xc0925c, 0xb88a55], ['Ladrillo', 0xa84a3a, 0x9c4535], ['Cristal', 0xbfe6ff, 0xbfe6ff], ['Nieve', 0xf1f3f5, 0xdee2e6], ['Oro', 0xffd43b, 0xfab005]];
  var HOTBAR = [1, 2, 3, 4, 5, 7, 8, 9, 11];
  var SAVE_KEY = 'ug-bloques-v1', AUTO_KEY = 'ug-bloques-auto-v1';

  /* ------------------------------------------------------------ mundo */
  function World(seed) {
    this.data = new Uint8Array(SX * SY * SZ);
    var rng = new UG.RNG(seed), P = 256, perm = [], grad = [];
    for (var i = 0; i < P; i++) { perm[i] = i; grad[i] = rng.float(-1, 1); }
    for (var j = P - 1; j > 0; j--) { var k = rng.int(0, j), t = perm[j]; perm[j] = perm[k]; perm[k] = t; }
    var hash = function (x, z) { return grad[perm[(perm[x & 255] + z) & 255]]; };
    var smooth = function (t) { return t * t * (3 - 2 * t); };
    var noise = function (x, z) { var x0 = Math.floor(x), z0 = Math.floor(z), fx = smooth(x - x0), fz = smooth(z - z0); var a = hash(x0, z0), b = hash(x0 + 1, z0), c = hash(x0, z0 + 1), d = hash(x0 + 1, z0 + 1); return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz; };
    this.height = function (x, z) { var n = noise(x / 22, z / 22) * 0.6 + noise(x / 9, z / 9) * 0.3 + noise(x / 4, z / 4) * 0.1; return Math.max(2, Math.min(SY - 8, Math.round(9 + n * 10))); };
    for (var x = 0; x < SX; x++) for (var z = 0; z < SZ; z++) {
      var h = this.height(x, z);
      for (var y = 0; y <= h; y++) {
        var id = y < h - 3 ? 3 : (y < h ? 2 : (h <= SEA ? 4 : (h > 17 ? 10 : 1)));
        this.set(x, y, z, id);
      }
    }
    // árboles
    for (var n = 0; n < 45; n++) {
      var tx = rng.int(3, SX - 4), tz = rng.int(3, SZ - 4), th = this.height(tx, tz);
      if (th <= SEA || th > 16 || this.get(tx, th, tz) !== 1) continue;
      var tall = rng.int(4, 5);
      for (var q = 1; q <= tall; q++) this.set(tx, th + q, tz, 5);
      for (var lx = -2; lx <= 2; lx++) for (var lz = -2; lz <= 2; lz++) for (var ly = tall - 1; ly <= tall + 1; ly++) {
        if (Math.abs(lx) + Math.abs(lz) + Math.max(0, ly - tall) * 2 > 3 || (lx === 0 && lz === 0 && ly < tall + 1)) continue;
        if (this.get(tx + lx, th + ly, tz + lz) === 0) this.set(tx + lx, th + ly, tz + lz, 6);
      }
    }
  }
  World.prototype.idx = function (x, y, z) { return (y * SZ + z) * SX + x; };
  World.prototype.inside = function (x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < SX && y < SY && z < SZ; };
  World.prototype.get = function (x, y, z) { return this.inside(x, y, z) ? this.data[this.idx(x, y, z)] : 0; };
  World.prototype.set = function (x, y, z, v) { if (this.inside(x, y, z)) this.data[this.idx(x, y, z)] = v; };
  /** RLE para guardar (pares valor,repeticiones) */
  World.prototype.serialize = function () { var out = [], d = this.data, i = 0; while (i < d.length) { var v = d[i], n = 1; while (i + n < d.length && d[i + n] === v && n < 65535) n++; out.push(v, n); i += n; } return JSON.stringify({ v: 1, sx: SX, sy: SY, sz: SZ, rle: out }); };
  /** Carga validando TODO (tamaños, ids, longitud total): un guardado manipulado se rechaza sin tocar el mundo */
  World.prototype.load = function (text) {
    var o; try { o = JSON.parse(text); } catch (e) { return false; }
    if (!o || o.v !== 1 || o.sx !== SX || o.sy !== SY || o.sz !== SZ || !Array.isArray(o.rle) || o.rle.length % 2) return false;
    var tmp = new Uint8Array(SX * SY * SZ), p = 0;
    for (var i = 0; i < o.rle.length; i += 2) {
      var v = o.rle[i], n = o.rle[i + 1];
      if (!Number.isInteger(v) || v < 0 || v >= BLOCKS.length || !Number.isInteger(n) || n < 1 || p + n > tmp.length) return false;
      tmp.fill(v, p, p + n); p += n;
    }
    if (p !== tmp.length) return false;
    this.data.set(tmp); return true;
  };

  /* ------------------------------------------------------------ mallado */
  var FACES = [ // normal, 4 esquinas (orden CCW visto desde fuera), sombreado
    { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], k: 1.0, top: true },
    { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], k: 0.55 },
    { n: [1, 0, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], k: 0.8 },
    { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], k: 0.8 },
    { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], k: 0.9 },
    { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], k: 0.7 }
  ];
  var LIN = BLOCKS.map(function (b) { return b ? [UG.colorToLinear(b[1]), UG.colorToLinear(b[2])] : null; });
  function meshChunk(w, cx, cz) {
    var pos = [], nrm = [], col = [], idx = [];
    for (var y = 0; y < SY; y++) for (var z = cz * CS; z < (cz + 1) * CS; z++) for (var x = cx * CS; x < (cx + 1) * CS; x++) {
      var id = w.get(x, y, z); if (!id) continue;
      for (var f = 0; f < 6; f++) {
        var F = FACES[f], nb = w.get(x + F.n[0], y + F.n[1], z + F.n[2]);
        if (nb && nb !== 9 || (nb === 9 && id === 9)) continue; // cara oculta (el cristal deja ver)
        if (y === 0 && f === 1) continue;
        var base = pos.length / 3, c = LIN[id][F.top ? 0 : 1], jitter = 0.94 + ((x * 73 + y * 37 + z * 19) % 7) * 0.01;
        for (var q = 0; q < 4; q++) { var p = F.v[q]; pos.push(x + p[0], y + p[1], z + p[2]); nrm.push(F.n[0], F.n[1], F.n[2]); col.push(c[0] * F.k * jitter, c[1] * F.k * jitter, c[2] * F.k * jitter, 1); }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    var g = new UG.Geometry3D();
    g.setAttribute('position', new Float32Array(pos), 3); g.setAttribute('normal', new Float32Array(nrm), 3); g.setAttribute('color', new Float32Array(col), 4);
    g.setAttribute('uv', new Float32Array(pos.length / 3 * 2), 2); g.setIndex(idx);
    return g;
  }

  class Play extends UG.Scene {
    constructor() { super('Play'); }
    init(data) { this._initData = data || {}; this._fresh = false; }
    create() {
      var s = this, W = this.game.width, H = this.game.height;
      this.sound.unlock();
      this.vox = new World('bloques-' + (G3.auto ? 'auto' : 'semilla'));
      var v = this.view = this.add.view3d({ fov: 75, near: 0.05, far: 180 });
      this.ph = v.enablePhysics({ gravity: -24 });
      v.scene3d.setSky({ top: 0x3d7fd6, horizon: 0xcfe6fa, bottom: 0x6d8f5a, sunSize: 0.045, clouds: { coverage: 0.5, speed: 0.012, scale: 0.4, sharpness: 0.22 } }); v.scene3d.setFog('linear', 0xcfe6fa, 45, 110);
      v.add.sunlight({ shadowSize: 48, direction: new V3(-0.4, -1, -0.25), ambient: 0.8 });
      var water = v.add.plane(SX + 200, SZ + 200, { color: 0x3b83d6, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.7 }); water.position.set(SX / 2, SEA + 0.85, SZ / 2); water.castShadow = false;
      this.mat = v.material({ vertexColors: true, roughness: 0.92 });
      this.chunks = [];
      for (var cx = 0; cx < SX / CS; cx++) for (var cz = 0; cz < SZ / CS; cz++) this.chunks.push({ cx: cx, cz: cz, mesh: null, col: null });
      this.chunks.forEach(function (c) { s.rebuild(c); });
      // jugador
      var sx = SX / 2, sz = SZ / 2, sy = this.vox.height(sx, sz) + 2;
      this.ch = this.ph.addCharacter(null, { radius: 0.3, height: 1.7, stepHeight: 0.35, jumpSpeed: 8.2 }); this.ch.teleport(sx + 0.5, sy, sz + 0.5);
      this.touch = G3.touchControls(this, [{ name: 'dig', label: '⛏', color: 0xfa5252, radius: 50 }, { name: 'place', label: '■', color: 0x40c057, radius: 50 }, { name: 'jump', label: '⤒', color: 0x4dabf7 }, { name: 'next', label: '↻', color: 0xfab005 }]);
      this.ctrl = v.firstPersonControls({ character: this.ch, eyeHeight: 1.55, speed: 4.6, runSpeed: 7.5, joystick: this.touch.joy, pointerLock: !G3.auto, bob: 0.02 });
      // selección
      this.sel = v.add.box(1.02, 1.02, 1.02, { type: 'basic', color: 0xffffff, transparent: true, opacity: 0.18, blend: 'add', depthTest: true }); this.sel.castShadow = false; this.sel.visible = false;
      this.slot = 0; this.hit = null; this.cd = 0; this.dirty = new Set();
      // HUD: barra de bloques y mira
      this.crosshair = G3.crosshair(this);
      this.bar = this.add.hud.graphics(); this.barLabel = G3.text(this, W / 2, H - 100, '', 20, 0xffffff);
      this.drawBar();
      this.msg = G3.text(this, W / 2, 40, G3.touch ? '' : 'Clic: romper · clic derecho: poner · 1-9 / rueda: bloque · G guardar · L cargar · N (dos veces) mundo nuevo', 16, 0xffffff, { stroke: 3 });
      MG.hudButtons(this, {});
      this.input.on('pointerdown', function (p) { if (p.type !== 'mouse' || !s.ctrl.isLocked) return; if (p.button === 2) s.place(); else if (p.button === 0) s.dig(); });
      this.input.on('wheel', function (p, o, dx, dy) { s.select((s.slot + (dy > 0 ? 1 : HOTBAR.length - 1)) % HOTBAR.length); });
      var kb = this.input.keyboard;
      for (var d = 1; d <= 9; d++) (function (n) { kb.on('keydown-' + n, function () { s.select(n - 1); }); })(d);
      kb.on('keydown-G', function () { s.save(); }); kb.on('keydown-L', function () { s.loadSave(); });
      // mundo nuevo: hay que pulsar N dos veces (antes se borraba todo de un toque); se autoguarda primero
      kb.on('keydown-N', function () {
        if (s._confirmN && s.time.now - s._confirmN < 3000) { s._confirmN = 0; s.autosave(true); try { localStorage.removeItem(AUTO_KEY); } catch (e) { /* modo privado */ } s._fresh = true; s.scene.restart({ fresh: true }); return; }
        s._confirmN = s.time.now; MG.floatText(s, s.game.width / 2, s.game.height * 0.3, 'Pulsa N otra vez para crear un mundo nuevo', 0xffd43b, 26);
      });
      // autoguardado cada minuto y al salir; al entrar se recupera el último mundo (salvo en las pruebas automáticas)
      this.autoT = 60;
      this.events.once('shutdown', function () { if (!s._fresh) s.autosave(true); });
      if (!G3.auto && !(this._initData && this._initData.fresh)) { var txt0 = null; try { txt0 = localStorage.getItem(AUTO_KEY); } catch (e) { txt0 = null; } if (txt0 && this.vox.load(txt0)) { this.chunks.forEach(function (c) { s.rebuild(c); }); this.time.delayedCall(300, function () { MG.floatText(s, s.game.width / 2, s.game.height * 0.3, 'Mundo recuperado (autoguardado)', 0x69db7c, 28); }); } }
      this.bot = G3.auto ? { t: 0, n: 0 } : null;
      G3.expose('voxel', this);
    }
    snd(k, vol) { if (!this.sound.disabled) this.sound.playSfx(k, { volume: vol || 0.4 }); }
    chunkAt(x, z) { var cx = Math.floor(x / CS), cz = Math.floor(z / CS); return this.chunks.find(function (c) { return c.cx === cx && c.cz === cz; }) || null; }
    rebuild(c) {
      var g = meshChunk(this.vox, c.cx, c.cz);
      if (!c.mesh) { c.mesh = this.view.add.mesh(g, this.mat); c.mesh.name = 'chunk' + c.cx + '_' + c.cz; }
      else c.mesh.geometry = g; // la geometría anterior se libera sola (recuento de referencias)
      if (c.col) this.ph.removeStatic(c.col);
      c.col = g.index && g.index.length ? this.ph.addMesh(c.mesh, { cell: 4 }) : null;
    }
    /** Rayo DDA por la rejilla (Amanatides & Woo): primer bloque sólido y la cara de entrada */
    raycast(o, d, max) {
      var x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z), sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
      var tdx = sx ? Math.abs(1 / d.x) : Infinity, tdy = sy ? Math.abs(1 / d.y) : Infinity, tdz = sz ? Math.abs(1 / d.z) : Infinity;
      var tmx = sx > 0 ? (x + 1 - o.x) * tdx : sx < 0 ? (o.x - x) * tdx : Infinity, tmy = sy > 0 ? (y + 1 - o.y) * tdy : sy < 0 ? (o.y - y) * tdy : Infinity, tmz = sz > 0 ? (z + 1 - o.z) * tdz : sz < 0 ? (o.z - z) * tdz : Infinity;
      var n = [0, 0, 0], t = 0;
      for (var i = 0; i < 64 && t <= max; i++) {
        if (this.vox.get(x, y, z)) return { x: x, y: y, z: z, n: n, t: t };
        if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; n = [-sx, 0, 0]; } else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; n = [0, -sy, 0]; } else { z += sz; t = tmz; tmz += tdz; n = [0, 0, -sz]; }
      }
      return null;
    }
    edit(x, y, z, id) {
      this.vox.set(x, y, z, id);
      var s = this; [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { var c = s.chunkAt(x + d[0], z + d[1]); if (c) s.dirty.add(c); });
    }
    dig() {
      if (this.cd > 0 || !this.hit) return; this.cd = 0.2;
      var h = this.hit; if (h.y === 0) return; // la base es indestructible
      this.edit(h.x, h.y, h.z, 0); this.snd('hit', 0.35);
      this.view.effect('dust', new V3(h.x + 0.5, h.y + 0.5, h.z + 0.5), { count: 10 });
    }
    place() {
      if (this.cd > 0 || !this.hit) return; this.cd = 0.2;
      var h = this.hit, x = h.x + h.n[0], y = h.y + h.n[1], z = h.z + h.n[2];
      if (!this.vox.inside(x, y, z) || this.vox.get(x, y, z)) return;
      // no poner un bloque donde está el jugador
      var p = this.ch.position; if (x + 1 > p.x - 0.3 && x < p.x + 0.3 && z + 1 > p.z - 0.3 && z < p.z + 0.3 && y + 1 > p.y && y < p.y + 1.7) return;
      this.edit(x, y, z, HOTBAR[this.slot]); this.snd('click', 0.45);
    }
    select(i) { this.slot = i; this.drawBar(); this.snd('blip', 0.2); }
    drawBar() {
      var g = this.bar, W = this.game.width, H = this.game.height, n = HOTBAR.length, sz = 52, x0 = W / 2 - n * sz / 2;
      g.clear();
      for (var i = 0; i < n; i++) { var b = BLOCKS[HOTBAR[i]]; g.fillStyle(0x000000, 0.5).fillRoundedRect(x0 + i * sz + 2, H - 70, sz - 4, sz - 4, 8).fillStyle(b[1], 1).fillRoundedRect(x0 + i * sz + 10, H - 62, sz - 20, sz - 20, 5); if (i === this.slot) g.lineStyle(3, 0xffffff, 1).strokeRoundedRect(x0 + i * sz + 2, H - 70, sz - 4, sz - 4, 8); }
      this.barLabel.text = (this.slot + 1) + ' · ' + BLOCKS[HOTBAR[this.slot]][0];
    }
    autosave(quiet) { if (G3.auto) return; try { localStorage.setItem(AUTO_KEY, this.vox.serialize()); if (!quiet) MG.floatText(this, this.game.width - 160, 90, 'Autoguardado', 0x69db7c, 18); } catch (e) { /* sin espacio o modo privado */ } }
    save() { try { localStorage.setItem(SAVE_KEY, this.vox.serialize()); MG.floatText(this, this.game.width / 2, this.game.height * 0.3, 'Mundo guardado', 0x69db7c, 30); } catch (e) { MG.floatText(this, this.game.width / 2, this.game.height * 0.3, 'No se pudo guardar', 0xff8787, 30); } }
    loadSave() {
      var txt = null; try { txt = localStorage.getItem(SAVE_KEY); } catch (e) { txt = null; }
      var s = this;
      if (txt && this.vox.load(txt)) { this.chunks.forEach(function (c) { s.rebuild(c); }); MG.floatText(this, this.game.width / 2, this.game.height * 0.3, 'Mundo cargado', 0x69db7c, 30); }
      else MG.floatText(this, this.game.width / 2, this.game.height * 0.3, txt ? 'Guardado no válido (ignorado)' : 'No hay guardado', 0xff8787, 30);
    }
    update(t, dtMs) {
      var dt = Math.min(dtMs, 50) / 1000, s = this, v = this.view, tb = this.touch.buttons;
      this.cd -= dt;
      if (tb.dig && tb.dig.isDown) this.dig(); if (tb.place && tb.place.justDown) this.place(); if (tb.jump && tb.jump.justDown) this.ch.jump(); if (tb.next && tb.next.justDown) this.select((this.slot + 1) % HOTBAR.length);
      if (this.bot) {
        var b = this.bot; b.t += dt;
        this.ctrl.setExternal({ forward: 1, strafe: 0, run: false, jump: this.ch.hitWall });
        this.ctrl.yaw += dt * 0.25; this.ctrl.pitch = -0.35;
        if (b.t > 0.7) { b.t = 0; b.n++; if (b.n % 2) this.dig(); else { this.select(b.n % HOTBAR.length); this.place(); } }
      }
      // rayo desde la cámara
      var cam = v.camera, o = cam.getWorldPosition(new V3()), d = cam.getWorldDirection(new V3());
      this.hit = this.raycast(o, d, 6);
      if (this.hit) { this.sel.visible = true; this.sel.position.set(this.hit.x + 0.5, this.hit.y + 0.5, this.hit.z + 0.5); } else this.sel.visible = false;
      // reconstruir los trozos modificados (una vez por frame)
      if (this.dirty.size) { this.dirty.forEach(function (c) { s.rebuild(c); }); this.dirty.clear(); }
      // caer al vacío: volver arriba
      if (this.ch.position.y < -10) { var cx = SX / 2, cz = SZ / 2; this.ch.teleport(cx + 0.5, this.vox.height(cx, cz) + 3, cz + 0.5); }
      this.crosshair.update(dt);
      if ((this.autoT -= dt) <= 0) { this.autoT = 60; this.autosave(false); }
    }
  }

  var Boot = { key: 'Boot', create: function () { this.scene.start(G3.auto ? 'Play' : 'Menu'); } };
  G3.start({ title: 'Bloques', scenes: [
    Boot,
    MG.menu({ id: 'voxel3d', title: 'Bloques', subtitle: 'Sandbox de vóxeles · construye lo que quieras', titleColors: [0xffffff, 0x8ce99a], glow: '#40c057', buttonColor: 0x2f9e44,
      help: 'Clic para capturar el ratón. WASD moverse · Espacio saltar · clic romper · clic derecho poner · 1-9 o rueda: bloque · G guardar · L cargar · N mundo nuevo.',
      touchHelp: 'Joystick para moverte, arrastra a la derecha para mirar. ⛏ romper, ■ poner, ↻ cambiar bloque.',
      background: function (scene) { scene.cameras.main.setBackgroundColor(0x3d7fd6); } }),
    Play, MG.gameOver({ id: 'voxel3d' })
  ] });
  window.UGVoxel = { World: World, meshChunk: meshChunk, BLOCKS: BLOCKS }; // para pruebas
})();
