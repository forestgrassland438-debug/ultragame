/* Laberinto Inclinado — inclina el tablero para llevar la canica a la meta. La gravedad se inclina de verdad
 * (física de la esfera) y la cámara acompaña la inclinación. Teclas, arrastre del ratón, joystick o el
 * sensor de inclinación del móvil. 3 niveles, agujeros, monedas y cronómetro. */
(function () {
  'use strict';
  var V3 = UG.Vec3;
  var LEVELS = [
    ['###########', '#S..#.....#', '#.#.#.###.#', '#.#...#o..#', '#.#####.#.#', '#...o...#G#', '###########'],
    ['#############', '#S....#.....#', '####.##.###.#', '#o...O..#o..#', '#.######.##.#', '#......O....#', '#.##.####.#.#', '#..#..o...#G#', '#############'],
    ['###############', '#S....#.....o.#', '####..#.###.#.#', '#o.#.O#...#.#.#', '#..#..###.#.#.#', '#.###.....#...#', '#.....#O#.#####', '#####.#.#.....#', '#o.O..#.###.#.#', '#.#.....#...#G#', '###############']
  ];
  // más inclinación y gravedad que antes: la canica responde rápido (antes iba muy lenta)
  var CELL = 2, TILT = 0.34, G = 30, VMAX = 13;

  class Play extends UG.Scene {
    constructor() { super('Play'); }
    init(data) { this.levelIdx = data && data.level !== undefined ? data.level : 0; this.totalTime = data && data.time || 0; this.score = data && data.score || 0; }
    create() {
      var s = this, W = this.game.width, H = this.game.height;
      this.sound.unlock();
      var v = this.view = this.add.view3d({ fov: 50, far: 200 });
      var ph = v.enablePhysics({ gravity: -G, killY: -20 });
      v.scene3d.setSky({ top: 0x1b1f3b, horizon: 0x6c5b9e, bottom: 0x14172b, sunSize: 0 }); v.scene3d.exposure = 1.15;
      v.add.sunlight({ shadowSize: 40, direction: new V3(-0.3, -1, -0.45), sky: 0xd0c4ff, ground: 0x3a2f5a, ambient: 0.8 });
      var rows = LEVELS[this.levelIdx], R = rows.length, C = rows[0].length, ox = -C * CELL / 2, oz = -R * CELL / 2;
      this.rows = rows; this.coins = []; this.holes = [];
      var floorT = [], wallT = [], holeT = [];
      var pos = function (x, z) { return new V3(ox + (x + 0.5) * CELL, 0, oz + (z + 0.5) * CELL); };
      for (var z = 0; z < R; z++) for (var x = 0; x < C; x++) {
        var ch = rows[z][x], p = pos(x, z);
        if (ch === '#') wallT.push(p); else if (ch === 'O') holeT.push(p); else floorT.push(p);
        if (ch === 'S') this.start = p.clone().add(new V3(0, 1, 0));
        if (ch === 'G') this.goal = p.clone();
        if (ch === 'o') this.coins.push({ p: p.clone().add(new V3(0, 0.6, 0)), alive: true });
      }
      var tile = UG.Geometry3D.box(CELL, 0.4, CELL), wallG = UG.Geometry3D.box(CELL, 1.2, CELL);
      var floor = v.add.instanced(tile, { color: 0xe9e4ff, roughness: 0.5 }, floorT.length + wallT.length);
      floorT.concat(wallT).forEach(function (p, i) { floor.setTransformAt(i, new V3(p.x, -0.2, p.z), 0, 1); floor.setColorAt(i, (Math.round((p.x - ox) / CELL) + Math.round((p.z - oz) / CELL)) % 2 ? 0xd0c8ff : 0xf1eeff); });
      var walls = v.add.instanced(wallG, { color: 0x7048e8, roughness: 0.35, metalness: 0.2 }, wallT.length);
      wallT.forEach(function (p, i) { walls.setTransformAt(i, new V3(p.x, 0.6, p.z), 0, 1); });
      // física: suelo por baldosas (los agujeros no tienen), muros como cajas
      floorT.forEach(function (p) { ph.addBox(new V3(p.x, -0.2, p.z), new V3(CELL / 2, 0.2, CELL / 2)); });
      // agujero: hueco de 0.9 m en el centro de la baldosa, con 4 franjas alrededor (se puede bordear con cuidado)
      var HOLE = 0.9, strip = (CELL - HOLE) / 2, rimMat = v.material({ color: 0x3b2f6b, roughness: 0.6 });
      holeT.forEach(function (p) {
        [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(function (d) {
          var w = d[0] ? strip : HOLE, dd = d[0] ? CELL : strip, cx = p.x + d[0] * (HOLE / 2 + strip / 2), cz = p.z + d[1] * (HOLE / 2 + strip / 2);
          if (d[1]) { w = HOLE; }
          var m = v.add.box(w, 0.4, dd, rimMat); m.position.set(cx, -0.2, cz);
          ph.addBox(new V3(cx, -0.2, cz), new V3(w / 2, 0.2, dd / 2));
        });
      });
      wallT.forEach(function (p) { ph.addBox(new V3(p.x, 0.6, p.z), new V3(CELL / 2, 0.6, CELL / 2)); });
      holeT.forEach(function (p) { var ring = v.add.torus(HOLE / 2 + 0.04, 0.05, { color: 0x111111, roughness: 0.3 }, 24); ring.position.set(p.x, 0.01, p.z); ring.rotation.x = Math.PI / 2; s.holes.push(p); });
      // meta y monedas
      this.goalRing = v.add.torus(0.7, 0.1, { type: 'basic', color: 0x63e6be }); this.goalRing.position.set(this.goal.x, 0.2, this.goal.z); this.goalRing.rotation.x = Math.PI / 2;
      this.goalFx = v.addParticles('magic', { rate: 25, color: [0x63e6be, 0x3bc9db] }); this.goalFx.position.copy(this.goal);
      var coinGeo = UG.Geometry3D.cylinder(0.3, 0.3, 0.08, 20);
      this.coinMesh = v.add.instanced(coinGeo, { color: 0xffd43b, metalness: 0.9, roughness: 0.25, emissive: 0x332200 }, Math.max(1, this.coins.length));
      if (!this.coins.length) this.coinMesh.count = 0;
      // canica
      this.ballNode = v.add.sphere(0.4, { color: 0xdee2e6, metalness: 1, roughness: 0.12 }, 32); this.ballNode.position.copy(this.start);
      this.ball = ph.addBody(this.ballNode, { shape: 'sphere', radius: 0.4, mass: 1, restitution: 0.25, friction: 0.3, damping: 0.06 });
      this.safe = this.start.clone(); this.safeT = 0;
      this.ball.on('collide', function (o, speed) { if (speed > 3) s.snd('bounce', Math.min(0.5, speed / 20)); });
      this.tilt = { x: 0, z: 0 }; this.t = 0; this.won = false; this.falls = 0; this.drag = null;
      // entrada: arrastre del ratón / dedo y sensor de inclinación
      this.input.on('pointerdown', function (p) { s.drag = { x: p.x, y: p.y, tx: s.tilt.x, tz: s.tilt.z, id: p.id }; });
      this.input.on('pointermove', function (p) { var d = s.drag; if (!d || d.id !== p.id) return; s.tilt.x = UG.MathUtils.clamp(d.tx + (p.x - d.x) / 260 * TILT, -TILT, TILT); s.tilt.z = UG.MathUtils.clamp(d.tz + (p.y - d.y) / 260 * TILT, -TILT, TILT); });
      this.input.on('pointerup', function () { s.drag = null; });
      this.orient = null;
      if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window && G3.touch) {
        this._onOrient = function (e) { if (e.gamma === null) return; s.orient = { x: UG.MathUtils.clamp(e.gamma / 30, -1, 1) * TILT, z: UG.MathUtils.clamp((e.beta - 35) / 30, -1, 1) * TILT }; };
        window.addEventListener('deviceorientation', this._onOrient);
        this.events.once('shutdown', function () { window.removeEventListener('deviceorientation', s._onOrient); });
      }
      this.touch = G3.touchControls(this, []);
      this.timeText = G3.text(this, W / 2, 34, '', 32, 0xffffff);
      this.levelText = G3.text(this, 58, 26, 'Nivel ' + (this.levelIdx + 1) + ' / ' + LEVELS.length, 24, 0xd0bfff, { ox: 0 });
      this.coinText = G3.text(this, W - 30, 70, '', 24, 0xffd43b, { ox: 1 });
      G3.text(this, W / 2, H - 24, G3.touch ? 'Inclina el móvil, arrastra o usa el joystick' : 'Flechas/WASD o arrastra con el ratón para inclinar el tablero', 16, 0xe5dbff, { stroke: 3 });
      MG.hudButtons(this, {});
      this.camTarget = this.start.clone();
      this.bot = G3.auto ? { path: this.solve(), k: 0 } : null;
      G3.expose('marble', this);
    }
    snd(k, vol) { if (!this.sound.disabled) this.sound.playSfx(k, { volume: vol || 0.5 }); }
    cellOf(p) { var R = this.rows.length, C = this.rows[0].length; return { x: Math.floor((p.x + C * CELL / 2) / CELL), z: Math.floor((p.z + R * CELL / 2) / CELL) }; }
    cellPos(x, z) { var R = this.rows.length, C = this.rows[0].length; return new V3(-C * CELL / 2 + (x + 0.5) * CELL, 0, -R * CELL / 2 + (z + 0.5) * CELL); }
    /** BFS de S a G evitando muros y agujeros (lo usa el bot de pruebas) */
    solve() {
      var rows = this.rows, R = rows.length, C = rows[0].length, sx = 0, sz = 0, q = [], prev = {}, seen = {};
      for (var z = 0; z < R; z++) for (var x = 0; x < C; x++) if (rows[z][x] === 'S') { sx = x; sz = z; }
      q.push([sx, sz]); seen[sx + ',' + sz] = 1; var end = null;
      while (q.length) { var c = q.shift(); if (rows[c[1]][c[0]] === 'G') { end = c; break; } [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { var nx = c[0] + d[0], nz = c[1] + d[1], k = nx + ',' + nz; if (nx < 0 || nz < 0 || nx >= C || nz >= R || seen[k] || rows[nz][nx] === '#' || rows[nz][nx] === 'O') return; seen[k] = 1; prev[k] = c; q.push([nx, nz]); }); }
      var path = []; for (var e = end; e; e = prev[e[0] + ',' + e[1]]) path.unshift(e);
      return path;
    }
    fall() {
      this.falls++; this.t += 5; this.snd('hurt', 0.6); G3.flash(this, 0xff0000, 0.3, 400);
      MG.floatText(this, this.game.width / 2, this.game.height * 0.35, '¡Al agujero! +5 s', 0xff8787, 36);
      // vuelve al último punto seguro (no al principio del nivel)
      this.ball.setPosition(this.safe.clone().add(new V3(0, 0.6, 0))); this.ball.setVelocity(0, 0, 0); this.tilt.x = this.tilt.z = 0;
      if (this.bot) this.bot.k = 0;
    }
    win() {
      if (this.won) return; this.won = true; this.snd('powerup', 0.8);
      var s = this, next = this.levelIdx + 1, total = this.totalTime + this.t, score = this.score + Math.max(0, Math.round(1500 - this.t * 20)) + this.coins.filter(function (c) { return !c.alive; }).length * 100;
      MG.floatText(this, this.game.width / 2, this.game.height * 0.4, next < LEVELS.length ? '¡Nivel superado!' : '¡Todos los niveles!', 0x63e6be, 44);
      this.time.delayedCall(1800, function () { if (next < LEVELS.length) s.scene.restart({ level: next, time: total, score: score }); else s.scene.start('GameOver', { score: score, win: true }); });
    }
    update(t, dtMs) {
      var dt = Math.min(dtMs, 50) / 1000, kb = this.input.keyboard, v = this.view, s = this;
      if (!this.won) this.t += dt;
      // inclinación deseada (teclado, joystick, sensor, bot)
      var ix = 0, iz = 0;
      if (kb.isDown('LEFT') || kb.isDown('KeyA')) ix -= 1; if (kb.isDown('RIGHT') || kb.isDown('KeyD')) ix += 1; if (kb.isDown('UP') || kb.isDown('KeyW')) iz -= 1; if (kb.isDown('DOWN') || kb.isDown('KeyS')) iz += 1;
      var js = this.touch.joy; if (js && js.isActive) { ix += js.forceX; iz += js.forceY; }
      var pad = this.input.gamepad.pad1; if (pad && pad.connected) { ix += Math.abs(pad.axes[0]) > 0.15 ? pad.axes[0] : 0; iz += Math.abs(pad.axes[1]) > 0.15 ? pad.axes[1] : 0; }
      if (this.bot && this.bot.path.length) {
        var b = this.bot, cell = this.cellOf(this.ball.position), path = b.path;
        for (var q = path.length - 1; q > b.k; q--) if (path[q][0] === cell.x && path[q][1] === cell.z) { b.k = q; break; }
        var nx = path[Math.min(path.length - 1, b.k + 1)], tp = this.cellPos(nx[0], nx[1]), bp = this.ball.position, bv = this.ball.velocity;
        // controlador PD: apunta al centro de la celda siguiente y frena la velocidad
        ix = UG.MathUtils.clamp((tp.x - bp.x) * 0.9 - bv.x * 0.45, -1, 1); iz = UG.MathUtils.clamp((tp.z - bp.z) * 0.9 - bv.z * 0.45, -1, 1);
      }
      var hasKeys = ix !== 0 || iz !== 0;
      if (this.orient && !hasKeys && !this.drag) { this.tilt.x += (this.orient.x - this.tilt.x) * Math.min(1, 8 * dt); this.tilt.z += (this.orient.z - this.tilt.z) * Math.min(1, 8 * dt); }
      else if (!this.drag) { var k = Math.min(1, 10 * dt); this.tilt.x += (UG.MathUtils.clamp(ix, -1, 1) * TILT - this.tilt.x) * k; this.tilt.z += (UG.MathUtils.clamp(iz, -1, 1) * TILT - this.tilt.z) * k; }
      // gravedad inclinada (la física de la canica es real) y cámara que "inclina" el mundo
      var gx = Math.sin(this.tilt.x) * G, gz = Math.sin(this.tilt.z) * G;
      v.physics.gravity.set(gx, -Math.sqrt(Math.max(0, G * G - gx * gx - gz * gz)), gz);
      this.ball.wake();
      var bp2 = this.ball.position, bv2 = this.ball.velocity, sp2 = Math.hypot(bv2.x, bv2.z);
      if (sp2 > VMAX) { bv2.x *= VMAX / sp2; bv2.z *= VMAX / sp2; }
      // punto seguro: sobre el suelo, lejos de los agujeros y sin ir disparada
      if ((this.safeT -= dt) <= 0 && bp2.y > 0.3 && bp2.y < 0.6) { var nearHole = this.holes.some(function (h) { return Math.abs(bp2.x - h.x) < 1.6 && Math.abs(bp2.z - h.z) < 1.6; }); if (!nearHole) { var c = this.cellOf(bp2); this.safe.copy(this.cellPos(c.x, c.z)); this.safeT = 0.25; } }
      this.camTarget.lerp(bp2, 1 - Math.exp(-4 * dt));
      var cam = v.camera, ct = this.camTarget;
      cam.position.set(ct.x - this.tilt.x * 14, 17, ct.z + 11 - this.tilt.z * 14); cam.lookAt(ct.x, 0, ct.z);
      cam.rotateZ(this.tilt.x * 0.6);
      // monedas, agujeros y meta
      var cm = this.coinMesh;
      this.coins.forEach(function (c, i) {
        if (c.alive && c.p.distanceTo(bp2) < 0.75) { c.alive = false; s.snd('coin', 0.5); v.effect('coin', c.p); }
        cm.setTransformAt(i, c.p, t * 0.004 + i, c.alive ? 1 : 0);
        if (c.alive) { var m = new UG.Mat4().compose(c.p, new UG.Quat().setFromEuler(Math.PI / 2, 0, t * 0.004 + i), new V3(1, 1, 1)); cm.setMatrixAt(i, m); }
      });
      // cerca del borde del agujero la canica "cae dentro" un poco (sensación de hueco)
      this.holes.forEach(function (h) { var dx = bp2.x - h.x, dz = bp2.z - h.z; if (Math.abs(dx) < 0.45 && Math.abs(dz) < 0.45 && bp2.y < 0.6) s.ball.velocity.y -= 12 * dt; });
      if (bp2.y < -3) this.fall();
      if (!this.won && Math.hypot(bp2.x - this.goal.x, bp2.z - this.goal.z) < 0.7 && bp2.y < 1) this.win();
      this.goalRing.rotation.z += dt * 2;
      this.timeText.text = G3.time((this.totalTime + this.t) * 1000);
      this.coinText.text = '● ' + this.coins.filter(function (c) { return !c.alive; }).length + ' / ' + this.coins.length;
    }
  }

  var Boot = { key: 'Boot', create: function () { this.scene.start(G3.auto ? 'Play' : 'Menu'); } };
  G3.start({ title: 'Laberinto Inclinado', scenes: [
    Boot, MG.menu({ id: 'marble3d', title: 'Laberinto Inclinado', subtitle: 'Física 3D · lleva la canica a la meta', titleColors: [0xffffff, 0xb197fc], glow: '#7950f2', buttonColor: 0x7048e8,
      help: 'Inclina el tablero con las flechas/WASD o arrastrando el ratón. Evita los agujeros negros (+5 s) y recoge las monedas. 3 niveles.',
      touchHelp: 'Inclina el móvil (o arrastra / usa el joystick). Evita los agujeros y recoge las monedas.',
      background: function (scene) { scene.cameras.main.setBackgroundColor(0x1b1f3b); } }),
    Play, MG.gameOver({ id: 'marble3d', background: function (s) { s.add.rectangle(s.game.width / 2, s.game.height / 2, s.game.width, s.game.height, 0x14172b, 1); } })
  ] });
})();
