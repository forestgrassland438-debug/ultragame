/* Turbo Circuito — carreras 3D: circuito generado con una spline cerrada (carretera, pianos, muros), 3 rivales
 * con IA que planifica la velocidad según las curvas, puntos de control, 3 vueltas, turbos, derrapes y minimapa. */
(function () {
  'use strict';
  var V3 = UG.Vec3, rnd = new UG.RNG('circuito');
  var MODELS = ['car', 'police', 'taxi', 'kart', 'tree', 'pine', 'bush', 'flag', 'fence', 'rock'];
  var LAPS = 3, HALF = 7, SAMPLES = 320;
  // puntos de control del circuito (x, z): curvas rápidas, horquilla y chicane
  var CTRL = [[-40, 0], [0, 0], [60, 0], [115, 15], [150, 60], [140, 110], [95, 130], [60, 110], [20, 125], [-20, 150], [-80, 145], [-125, 105], [-135, 55], [-115, 18], [-80, 3]]; // radio mínimo ~16 m

  /* ------------------------------------------------------------ circuito */
  function buildTrack() {
    var n = CTRL.length, pts = [];
    var cr = function (p0, p1, p2, p3, t) { var t2 = t * t, t3 = t2 * t; return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); };
    for (var i = 0; i < SAMPLES; i++) {
      var f = i / SAMPLES * n, k = Math.floor(f), t = f - k;
      var a = CTRL[(k - 1 + n) % n], b = CTRL[k % n], c = CTRL[(k + 1) % n], d = CTRL[(k + 2) % n];
      pts.push(new V3(cr(a[0], b[0], c[0], d[0], t), 0, cr(a[1], b[1], c[1], d[1], t)));
    }
    var dir = [], left = [], dist = [0], curv = [];
    for (var j = 0; j < SAMPLES; j++) {
      var nx = pts[(j + 1) % SAMPLES], pv = pts[(j - 1 + SAMPLES) % SAMPLES], dd = nx.clone().sub(pv).normalize();
      dir.push(dd); left.push(new V3(dd.z, 0, -dd.x));
      if (j > 0) dist.push(dist[j - 1] + pts[j].distanceTo(pts[j - 1]));
    }
    for (var q = 0; q < SAMPLES; q++) { var d1 = dir[q], d2 = dir[(q + 4) % SAMPLES]; curv.push(Math.acos(Math.max(-1, Math.min(1, d1.dot(d2))))); }
    var length = dist[SAMPLES - 1] + pts[SAMPLES - 1].distanceTo(pts[0]);
    return { pts: pts, dir: dir, left: left, dist: dist, curv: curv, length: length,
      /** índice de muestra más cercano (búsqueda local desde hint para que sea O(1)) */
      nearest: function (p, hint) {
        var best = hint || 0, bd = Infinity, from = hint === undefined ? 0 : hint - 20, to = hint === undefined ? SAMPLES : hint + 20;
        for (var i = from; i < to; i++) { var k = ((i % SAMPLES) + SAMPLES) % SAMPLES, dx = pts[k].x - p.x, dz = pts[k].z - p.z, dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = k; } }
        return best;
      } };
  }
  /** Textura procedural cacheada (se genera una sola vez por juego) */
  function tex(scene, key, w, h, draw) { if (!scene.textures.exists(key)) scene.textures.generate(key, w, h, draw); return scene.textures.get(key); }
  function roadTexture(scene) {
    return tex(scene, 'road3d', 128, 256, function (ctx, w, h) {
      ctx.fillStyle = '#3d3f44'; ctx.fillRect(0, 0, w, h);
      for (var i = 0; i < 900; i++) { var g = 50 + Math.random() * 30 | 0; ctx.fillStyle = 'rgba(' + g + ',' + g + ',' + (g + 4) + ',0.6)'; ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
      ctx.fillStyle = '#f1f3f5'; ctx.fillRect(3, 0, 4, h); ctx.fillRect(w - 7, 0, 4, h);
      ctx.fillStyle = '#ffd43b'; ctx.fillRect(w / 2 - 2, 0, 4, h * 0.5);
    });
  }
  function buildWorld(v, scene, withPhysics) {
    var T = buildTrack(), ph = withPhysics ? v.physics : null, sc = v.scene3d;
    sc.setSky({ top: 0x2a64c8, horizon: 0xcfe3f5, bottom: 0x4f6b3a, sunSize: 0.03 });
    sc.setFog('linear', 0xcfe3f5, 120, 420); sc.exposure = 1.08;
    v.add.plane(700, 700, { color: 0x5b8c3e, roughness: 1 });
    // carretera: tira de triángulos a lo largo de la spline (v = distancia / 16 para repetir la textura)
    var pos = [], uv = [], nrm = [], idx = [];
    for (var i = 0; i <= SAMPLES; i++) {
      var k = i % SAMPLES, p = T.pts[k], l = T.left[k], vv = (i === SAMPLES ? T.length : T.dist[k]) / 16;
      pos.push(p.x + l.x * HALF, 0.03, p.z + l.z * HALF, p.x - l.x * HALF, 0.03, p.z - l.z * HALF); uv.push(0, vv, 1, vv); nrm.push(0, 1, 0, 0, 1, 0);
      if (i < SAMPLES) { var b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); } // normales hacia arriba (CCW visto desde arriba)
    }
    var geo = new UG.Geometry3D(); geo.setAttribute('position', new Float32Array(pos), 3); geo.setAttribute('normal', new Float32Array(nrm), 3); geo.setAttribute('uv', new Float32Array(uv), 2); geo.setIndex(idx);
    var rt = roadTexture(scene); rt.source.setWrapMode('repeat');
    var road = v.add.mesh(geo, { map: rt, roughness: 0.9 }); road.name = 'road';
    // pianos (rojo/blanco) y muros de neumáticos en ambos lados
    var curbT = [], wallT = [], cols = [];
    for (var s = 0; s < SAMPLES; s += 1) {
      var P = T.pts[s], L = T.left[s], D = T.dir[s], ry = Math.atan2(D.x, D.z);
      [1, -1].forEach(function (side) {
        curbT.push({ x: P.x + L.x * (HALF + 0.6) * side, y: 0.05, z: P.z + L.z * (HALF + 0.6) * side, ry: ry, red: (s >> 1) % 2 === 0 });
        var wx = P.x + L.x * (HALF + 3.2) * side, wz = P.z + L.z * (HALF + 3.2) * side, ok = true;
        // seguridad: nunca un muro dentro de otra parte de la pista (interior de curvas cerradas, cruces)
        for (var q = 0; q < SAMPLES && ok; q += 2) { var dx = T.pts[q].x - wx, dz = T.pts[q].z - wz; if (dx * dx + dz * dz < (HALF + 2) * (HALF + 2)) ok = false; }
        if (ok) wallT.push({ x: wx, y: 0.5, z: wz, ry: ry });
      });
    }
    var curbGeo = UG.Geometry3D.box(1.2, 0.1, T.length / SAMPLES + 0.05), curb = v.add.instanced(curbGeo, { color: 0xffffff, roughness: 0.6 }, curbT.length);
    curbT.forEach(function (t, i2) { curb.setTransformAt(i2, new V3(t.x, t.y, t.z), t.ry, 1); curb.setColorAt(i2, t.red ? 0xe03131 : 0xf8f9fa); });
    var wallGeo = UG.Geometry3D.box(0.8, 1.0, T.length / SAMPLES + 0.3), wall = v.add.instanced(wallGeo, { color: 0xffffff, roughness: 0.9 }, wallT.length);
    wallT.forEach(function (t, i3) { wall.setTransformAt(i3, new V3(t.x, t.y, t.z), t.ry, 1); wall.setColorAt(i3, (i3 >> 2) % 2 ? 0x1c7ed6 : 0xf1f3f5); });
    if (ph) {
      ph.addGround(0);
      wallT.forEach(function (t) { cols.push(ph.addBox(new V3(t.x, 0.6, t.z), new V3(0.4, 0.6, T.length / SAMPLES * 0.5 + 0.2), new UG.Quat().setFromEuler(0, t.ry, 0))); });
    }
    // meta: franja a cuadros + arco
    var startP = T.pts[0], startL = T.left[0], startD = T.dir[0], sry = Math.atan2(startD.x, startD.z);
    var chk = tex(scene, 'checker3d', 64, 16, function (ctx) { for (var y = 0; y < 2; y++) for (var x = 0; x < 8; x++) { ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff'; ctx.fillRect(x * 8, y * 8, 8, 8); } });
    var line = v.add.plane(HALF * 2, 2, { map: chk, roughness: 0.8 }); line.position.set(startP.x, 0.04, startP.z); line.rotation.y = sry;
    [1, -1].forEach(function (side) { var post = v.add.box(0.6, 6, 0.6, { color: 0xe03131, metalness: 0.3 }); post.position.set(startP.x + startL.x * (HALF + 1.5) * side, 3, startP.z + startL.z * (HALF + 1.5) * side); if (ph) ph.addBoxFromNode(post); });
    var beam = v.add.box(HALF * 2 + 4, 1.2, 0.8, { color: 0x212529, emissive: 0x3b0a0a }); beam.position.set(startP.x, 6.2, startP.z); beam.rotation.y = sry;
    // árboles y vallas (instanciados: 2-3 draw calls para cientos)
    var trees = [], bushes = [];
    for (var ti = 0; ti < 260; ti++) {
      var x = rnd.float(-300, 300), z = rnd.float(-300, 300), kk = T.nearest(new V3(x, 0, z)), dd = T.pts[kk].distanceTo(new V3(x, 0, z));
      if (dd < HALF + 9) continue;
      (ti % 3 ? trees : bushes).push({ x: x, z: z, ry: rnd.float(0, 6.28), s: rnd.float(0.8, 1.7) });
    }
    G3.instances(v, 'pine', trees.filter(function (t, i4) { return i4 % 2; })); G3.instances(v, 'tree', trees.filter(function (t, i5) { return !(i5 % 2); })); G3.instances(v, 'bush', bushes);
    // gradas junto a la recta
    for (var g2 = 0; g2 < 6; g2++) { var gs = T.pts[6 + g2 * 5], gl = T.left[6 + g2 * 5], st = v.add.box(8, 2.5, 4, { color: [0x495057, 0x1971c2, 0xe03131][g2 % 3] }); st.position.set(gs.x + gl.x * (HALF + 9), 1.25, gs.z + gl.z * (HALF + 9)); st.rotation.y = Math.atan2(T.dir[6 + g2 * 5].x, T.dir[6 + g2 * 5].z); }
    return T;
  }

  /* ---------------------------------------------------------------- coches */
  var CARS = [{ key: 'car', name: 'Tú', color: 0xd62828 }, { key: 'police', name: 'Patrulla', color: 0xf8f9fa }, { key: 'taxi', name: 'Taxi', color: 0xfcc419 }, { key: 'kart', name: 'Kart', color: 0x2b8a3e }];
  class Racer {
    constructor(scene, i, T, ai) {
      var v = scene.view, def = CARS[i];
      this.scene = scene; this.def = def; this.ai = ai; this.T = T; this.idx = 0; this.lap = 0; this.cp = 0; this.finished = false; this.finishTime = 0; this.lapStart = 0; this.bestLap = 0;
      this.node = v.add.model(def.key);
      var s0 = (SAMPLES - 3 - Math.floor(i / 2) * 3), P = T.pts[s0], L = T.left[s0], D = T.dir[s0];
      var wheels = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'].map(function (w) { return this.node.getObjectByName(w); }, this);
      this.car = v.physics.addVehicle(this.node, { heading: Math.atan2(D.x, D.z), maxSpeed: ai ? 34 + i * 0.8 : 36, accel: ai ? 15 : 17, wheels: wheels, rideHeight: 0, turnRate: 2.1, grip: 7 });
      this.car.teleport(new V3(P.x + L.x * (i % 2 ? -3 : 3), 0.2, P.z + L.z * (i % 2 ? -3 : 3)), Math.atan2(D.x, D.z));
      this.idx = s0; this.offset = ai ? rnd.float(-3, 3) : 0; this.skill = ai ? 0.86 + i * 0.03 : 1;
      var self = this;
      this.car.on('crash', function (imp) { if (!self.ai) { scene.snd({ preset: 'impact_metal', seed: 1 + ((imp * 3 | 0) & 3) }, Math.min(0.7, 0.25 + imp * 0.02)); scene.cameras.main.shake(120, Math.min(0.01, imp * 0.0008)); } });
    }
    /** avance total; antes de cruzar la meta por primera vez (cp 0 y en la segunda mitad) cuenta como vuelta -1 */
    get progress() { var lap = this.lap - (this.cp === 0 && this.idx > SAMPLES / 2 ? 1 : 0); return lap * SAMPLES + this.idx + (this.finished ? 1e6 - this.finishTime : 0); }
    drive(dt) {
      // IA: punto objetivo por delante; velocidad objetivo según la curvatura que viene
      var T = this.T, c = this.car, ahead = Math.round(6 + Math.abs(c.speed) * 0.35), k = (this.idx + ahead) % SAMPLES;
      var tgt = T.pts[k].clone().addScaled(T.left[k], this.offset);
      var want = Math.atan2(tgt.x - c.position.x, tgt.z - c.position.z), diff = G3.angleDiff(c.heading, want);
      var curve = 0; for (var q = 0; q < 14; q++) curve = Math.max(curve, T.curv[(this.idx + 4 + q * 2) % SAMPLES]);
      var vmax = c.maxSpeed * this.skill * Math.max(0.42, 1 - curve * 1.6);
      var thr = c.speed < vmax ? 1 : (c.speed > vmax + 4 ? -0.6 : 0.1);
      c.setInput(thr, Math.max(-1, Math.min(1, diff * 2.8)), false, false);
    }
    update(dt, raceT) {
      var T = this.T, c = this.car, prev = this.idx;
      this.idx = T.nearest(c.position, this.idx);
      // puntos de control: 8 repartidos; la vuelta solo cuenta si se pasó por todos en orden.
      // Primero se comprueba el cruce de meta (con el checkpoint anterior) y después se actualiza el checkpoint.
      var crossed = prev > SAMPLES - 20 && this.idx < 20;
      if (crossed && this.cp === 7) {
        this.lap++; this.cp = 0;
        var lt = raceT - this.lapStart; if (!this.bestLap || lt < this.bestLap) this.bestLap = lt;
        this.lapStart = raceT;
        if (this.lap >= LAPS && !this.finished) { this.finished = true; this.finishTime = raceT; }
        if (this === this.scene.player) this.scene.onLap(this);
      }
      var cpIdx = Math.floor(this.idx / (SAMPLES / 8));
      if (cpIdx === (this.cp + 1) % 8 && !(cpIdx === 0 && !crossed)) this.cp = cpIdx;
      // fuera de pista: si cae o se aleja mucho, se recoloca
      // fuera de pista: la IA se recoloca al momento; el jugador tras 1.5 s (con aviso) o cuando pulsa R
      var off = c.position.y < -5 || T.pts[this.idx].distanceTo(new V3(c.position.x, 0, c.position.z)) > HALF + 12;
      if (!off) this.offT = 0;
      else if (this.ai || c.position.y < -5 || (this.offT = (this.offT || 0) + 1 / 60) > 1.5) { this.respawn(); this.offT = 0; if (!this.ai) MG.floatText(this.scene, this.scene.game.width / 2, this.scene.game.height * 0.35, 'Recolocado en la pista', 0xffd43b, 30); }
    }
    respawn() { var T = this.T, P = T.pts[this.idx], D = T.dir[this.idx]; this.car.teleport(new V3(P.x, 0.5, P.z), Math.atan2(D.x, D.z)); }
  }

  /* ================================================================ Carrera */
  class Race extends UG.Scene {
    constructor() { super('Play'); }
    preload() { G3.loadModels(this, MODELS); }
    create() {
      var s = this, W = this.game.width, H = this.game.height;
      this.sound.unlock(); this.sound.prewarm(['impact_metal']);
      var v = this.view = this.add.view3d({ fov: 62, far: 800 });
      v.enablePhysics({ gravity: -22 });
      var T = this.T = buildWorld(v, this, true);
      this.racers = CARS.map(function (d, i) { return new Racer(s, i, T, i > 0 || G3.auto); });
      this.player = this.racers[0];
      v.add.sunlight({ shadowSize: 70, follow: this.player.node, direction: new V3(-0.4, -1, 0.35) });
      this.cam = v.followCamera({ target: this.player.node, distance: 7.5, height: 2.8, lookHeight: 1, lookAhead: 5, stiffness: 6 });
      this.cam.snap();
      this.camMode = 0;
      this.touch = G3.touchControls(this, [{ name: 'gas', label: '▲', color: 0x40c057, radius: 56 }, { name: 'brake', label: '▼', color: 0xfa5252, radius: 50 }]);
      if (G3.touch) { this.leftBtn = this.add.virtualButton({ x: 90, y: H - 90, radius: 52, label: '◀', color: 0x4dabf7 }); this.rightBtn = this.add.virtualButton({ x: 220, y: H - 90, radius: 52, label: '▶', color: 0x4dabf7 }); if (this.touch.joy) this.touch.joy.visible = false; }
      // turbos
      [40, 120, 200, 270].forEach(function (k) {
        var P = T.pts[k], D = T.dir[k], pad = v.add.plane(5, 5, { color: 0xffd43b, emissive: 0xffa000, emissiveIntensity: 1.5, roughness: 0.4 }); pad.position.set(P.x, 0.05, P.z); pad.rotation.y = Math.atan2(D.x, D.z);
        var tr = v.physics.addTrigger({ center: new V3(P.x, 0.8, P.z), half: new V3(2.6, 1.5, 2.6) });
        tr.on('enter', function (o) { s.racers.forEach(function (r) { if (r.car === o) { o.speed = Math.min(o.maxSpeed * 1.35, o.speed + 14); if (r === s.player) { s.snd('powerup', 0.4); G3.flash(s, 0xffd43b, 0.18, 250); } } }); });
      });
      this.smoke = v.addParticles('dust', { capacity: 400, color: [0xdee2e6, 0x868e96], alpha: [0.35, 0], size: [0.5, 1.8], life: [0.5, 1.1] });
      // HUD
      this.speedText = G3.text(this, W - 40, H - 60, '0', 64, 0xffffff, { ox: 1 }); G3.text(this, W - 40, H - 22, 'km/h', 20, 0xadb5bd, { ox: 1 });
      this.lapText = G3.text(this, 58, 27, '', 30, 0xffffff, { ox: 0 });
      this.posText = G3.text(this, 58, 70, '', 40, 0xffd43b, { ox: 0 });
      this.timeText = G3.text(this, 58, 110, '', 20, 0xdee2e6, { ox: 0 });
      this.center = G3.text(this, W / 2, H * 0.35, '', 110, 0xffffff);
      this.map = this.add.hud.graphics(); this.mapDots = this.add.hud.graphics(); this._drawMap();
      MG.hudButtons(this, {});
      this.input.keyboard.on('keydown-C', function () { s.toggleCam(); });
      this.input.keyboard.on('keydown-R', function () { if (s.state === 'race') { s.player.respawn(); MG.floatText(s, s.game.width / 2, s.game.height * 0.35, 'Recolocado en la pista', 0xffd43b, 30); } });
      this.raceT = -3; this.state = 'countdown'; this.lastCount = 4; this.done = false;
      this.events.once('shutdown', function () { s.view = null; });
      G3.expose('racing', this);
    }
    snd(k, vol) { if (!this.sound.disabled) this.sound.playSfx(k, { volume: vol || 0.5 }); }
    toggleCam() { this.camMode = (this.camMode + 1) % 2; this.cam.distance = this.camMode ? 0.1 : 7.5; this.cam.height = this.camMode ? 1.2 : 2.8; this.cam.lookAhead = this.camMode ? 12 : 5; this.cam.stiffness = this.camMode ? 30 : 6; this.player.node.visible = !this.camMode; }
    _drawMap() {
      var T = this.T, g = this.map, W = this.game.width, H = this.game.height, S = 150, ox = W - S - 30, oy = H - S - 110;
      var minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
      T.pts.forEach(function (p) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); minz = Math.min(minz, p.z); maxz = Math.max(maxz, p.z); });
      var k = S / Math.max(maxx - minx, maxz - minz); this._mapT = { ox: ox + (S - (maxx - minx) * k) / 2 - minx * k, oy: oy + (S - (maxz - minz) * k) / 2 - minz * k, k: k };
      g.fillStyle(0x000000, 0.45).fillRoundedRect(ox - 12, oy - 12, S + 24, S + 24, 14).lineStyle(5, 0xffffff, 0.8);
      var m = this._mapT, pts = T.pts.map(function (p) { return { x: m.ox + p.x * m.k, y: m.oy + p.z * m.k }; }); pts.push(pts[0]);
      g.strokePoints(pts, true);
    }
    onLap(r) {
      if (r.finished) { this.finish(); return; }
      this.snd('coin', 0.6);
      MG.floatText(this, this.game.width / 2, this.game.height * 0.3, r.lap === LAPS - 1 ? '¡Última vuelta!' : 'Vuelta ' + (r.lap + 1), 0xffd43b, 42);
    }
    finish() {
      if (this.done) return; this.done = true;
      var pos = this.position(this.player), s = this;
      this.snd(pos === 1 ? 'powerup' : 'select', 0.7);
      this.center.text = pos === 1 ? '¡1º!' : pos + 'º'; this.center.setStyle({ fontSize: 90 });
      var score = Math.max(0, Math.round((5 - pos) * 1000 + Math.max(0, 300 - this.player.finishTime) * 10));
      this.time.delayedCall(3000, function () { s.scene.start('GameOver', { score: score, win: pos === 1 }); });
    }
    position(r) { var list = this.racers.slice().sort(function (a, b) { return b.progress - a.progress; }); return list.indexOf(r) + 1; }
    update(t, dtMs) {
      var dt = Math.min(dtMs, 50) / 1000, s = this, p = this.player, kb = this.input.keyboard, W = this.game.width;
      this.raceT += dt;
      if (this.state === 'countdown') {
        var c = Math.ceil(-this.raceT);
        if (c !== this.lastCount && c >= 0) { this.lastCount = c; this.center.text = c > 0 ? String(c) : '¡YA!'; this.snd(c > 0 ? 'blip' : 'powerup', 0.6); }
        this.racers.forEach(function (r) { r.car.setInput(0, 0, true); r.car.speed = 0; });
        if (this.raceT >= 0) { this.state = 'race'; this.racers.forEach(function (r) { r.lapStart = 0; }); this.time.delayedCall(700, function () { if (s.center.text === '¡YA!') s.center.text = ''; }); }
      } else {
        this.racers.forEach(function (r) { if (r.ai || r.finished) r.drive(dt); r.update(dt, s.raceT); if (r.finished && r.ai) r.car.maxSpeed = 20; });
        if (!p.ai && !p.finished) {
          var pad = this.input.gamepad.pad1, tb = this.touch.buttons;
          var thr = (kb.isDown('KeyW') || kb.isDown('UP') ? 1 : 0) - (kb.isDown('KeyS') || kb.isDown('DOWN') ? 1 : 0), st = (kb.isDown('KeyA') || kb.isDown('LEFT') ? 1 : 0) - (kb.isDown('KeyD') || kb.isDown('RIGHT') ? 1 : 0);
          if (pad && pad.connected) { thr += pad.value(7) - pad.value(6); st -= Math.abs(pad.axes[0]) > 0.15 ? pad.axes[0] : 0; }
          if (tb.gas && tb.gas.isDown) thr = 1; if (tb.brake && tb.brake.isDown) thr = -1;
          if (this.leftBtn && this.leftBtn.isDown) st = 1; if (this.rightBtn && this.rightBtn.isDown) st = -1;
          p.car.setInput(Math.max(-1, Math.min(1, thr)), Math.max(-1, Math.min(1, st)), false, kb.isDown('SPACE'));
        }
      }
      // humo al derrapar
      this.racers.forEach(function (r) { var c = r.car; if (c.drifting && Math.abs(c.speed) > 10 && rnd.float() < 0.6) { var back = new V3(c.position.x - Math.sin(c.heading) * 1.6, 0.3, c.position.z - Math.cos(c.heading) * 1.6); s.smoke.burst(1, back); } });
      // HUD
      var kmh = Math.round(p.car.kmh), pos = this.position(p);
      this.speedText.text = String(kmh);
      this.lapText.text = 'Vuelta ' + Math.min(LAPS, p.lap + 1) + ' / ' + LAPS;
      this.posText.text = pos + 'º / ' + this.racers.length;
      this.timeText.text = 'Tiempo ' + G3.time(Math.max(0, this.raceT) * 1000) + (p.bestLap ? '   Mejor vuelta ' + G3.time(p.bestLap * 1000) : '');
      var m = this._mapT, g = this.mapDots; g.clear();
      this.racers.forEach(function (r, i) { g.fillStyle(CARS[i].color, 1).lineStyle(2, 0x000000, 0.8).fillCircle(m.ox + r.car.position.x * m.k, m.oy + r.car.position.z * m.k, r === p ? 6 : 4.5).strokeCircle(m.ox + r.car.position.x * m.k, m.oy + r.car.position.z * m.k, r === p ? 6 : 4.5); });
      // sensación de velocidad: FOV
      this.view.camera.fov = 62 + Math.min(14, Math.abs(p.car.speed) * 0.35); this.view.camera.updateProjection();
      void W;
    }
  }

  var Boot = { key: 'Boot', preload: function () { G3.loadModels(this, MODELS); }, create: function () { this.scene.start(G3.auto ? 'Play' : 'Menu'); } };
  G3.start({ title: 'Turbo Circuito', scenes: [
    Boot,
    MG.menu({ id: 'racing3d', title: 'Turbo Circuito', subtitle: 'Carreras 3D · 3 vueltas contra 3 rivales', titleColors: [0xffffff, 0xffd43b], glow: '#fab005', buttonColor: 0xe67700,
      help: 'W/↑ acelerar · S/↓ frenar y marcha atrás · A/D girar · Espacio freno de mano (derrape) · C cambiar cámara · R volver a la pista. Pasa por los turbos amarillos.',
      touchHelp: 'Botones ◀ ▶ para girar, ▲ acelerar y ▼ frenar. Pasa por los turbos amarillos.',
      background: G3.menuBackground(function (v, scene) { buildWorld(v, scene, false); v.add.sunlight({ shadowSize: 80 }); var c = v.add.model('car'); c.position.set(0, 0, 0); c.rotation.y = 1.3; }, 16, 5) }),
    Race, MG.gameOver({ id: 'racing3d', background: function (s) { s.add.rectangle(s.game.width / 2, s.game.height / 2, s.game.width, s.game.height, 0x10141c, 1); } })
  ] });
})();
