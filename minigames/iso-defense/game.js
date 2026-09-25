/* Iso Defense — defensa de torres en vista isométrica. Prueba: Tilemap isométrico con formato Tiled
 * generado en código (tileset alto con tileoffset, tiles animados), worldToTileXY para elegir casilla,
 * orden por profundidad (y) de unidades, proyectiles con parábola, daño en área, ralentización,
 * mejoras/venta, oleadas, velocidad x1/x2 (timeScale de reloj y tweens) y UI táctil. */
(function () {
  'use strict';
  var W = 960, H = 640, N = 12, TW = 64, TH = 32, OX = (W - N * TW) / 2, OY = 92;
  var G = { GRASS: 1, FLOWERS: 2, PATH: 3, WATER: 4, ROCK: 5, TREE: 6, PLAZA: 8 };
  // camino (casillas por las que pasa el enemigo, en orden)
  var ROUTE = [[0, 1], [5, 1], [5, 5], [2, 5], [2, 9], [9, 9], [9, 3], [11, 3]];
  var TOWERS = [
    { name: 'Arco', key: 'id-t0', cost: 50, range: 135, rate: 480, dmg: 11, proj: 'arrow', color: 0xffd43b, desc: 'Rápida' },
    { name: 'Cañón', key: 'id-t1', cost: 110, range: 120, rate: 1500, dmg: 36, splash: 62, proj: 'ball', color: 0xff8787, desc: 'Daño en área' },
    { name: 'Hielo', key: 'id-t2', cost: 80, range: 110, rate: 950, dmg: 5, slow: 0.45, slowTime: 1700, proj: 'frost', color: 0x74c0fc, desc: 'Ralentiza' }
  ];
  var ENEMIES = {
    slime: { hp: 40, speed: 1.05, gold: 6, key: 'id-slime', lives: 1, r: 13 },
    runner: { hp: 26, speed: 1.9, gold: 7, key: 'id-runner', lives: 1, r: 11 },
    tank: { hp: 170, speed: 0.62, gold: 16, key: 'id-tank', lives: 2, r: 17 },
    boss: { hp: 1100, speed: 0.5, gold: 150, key: 'id-boss', lives: 6, r: 26 }
  };
  var WAVES = 12;

  /** tile (u,v continuos, centro de casilla = entero + 0.5) -> pantalla */
  function iso(u, v, out) { out = out || {}; out.x = OX + (u - v) * TW / 2 + N * TW / 2; out.y = OY + (u + v) * TH / 2; return out; }
  function routeCells() {
    var cells = [];
    for (var i = 0; i < ROUTE.length - 1; i++) {
      var a = ROUTE[i], b = ROUTE[i + 1], dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]), x = a[0], y = a[1];
      while (x !== b[0] || y !== b[1]) { cells.push([x, y]); x += dx; y += dy; }
    }
    cells.push(ROUTE[ROUTE.length - 1]);
    return cells;
  }

  // ------------------------------------------------------------------ arte procedural
  function poly(c, pts, fill, stroke) { c.beginPath(); c.moveTo(pts[0], pts[1]); for (var i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath(); c.fillStyle = fill; c.fill(); if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); } }
  function block(c, ox, top, left, right, lip) {
    // cara superior en y 16..48, laterales hasta 64
    poly(c, [ox, 32, ox + 32, 48, ox + 32, 64, ox, 48], left);
    poly(c, [ox + 32, 48, ox + 64, 32, ox + 64, 48, ox + 32, 64], right);
    if (lip) { poly(c, [ox, 32, ox + 32, 48, ox + 32, 52, ox, 36], lip); poly(c, [ox + 32, 48, ox + 64, 32, ox + 64, 36, ox + 32, 52], UG.Color.toHex(UG.Color.darken(UG.Color.toNumber(lip), 0.15))); }
    poly(c, [ox + 32, 16, ox + 64, 32, ox + 32, 48, ox, 32], top, 'rgba(0,0,0,0.12)');
  }
  function speckle(c, ox, rng, color, n) {
    c.fillStyle = color;
    for (var i = 0; i < n; i++) { var u = rng.float(), v = rng.float(), x = ox + 32 + (u - v) * 30, y = 32 + (u + v - 1) * 15; c.fillRect(x, y, 2, 1.5); }
  }
  function makeTextures(scene) {
    var T = scene.textures;
    if (T.exists('iso-tiles')) return;
    T.generate('iso-tiles', 64 * 8, 64, function (c) {
      var r = new UG.RNG('iso');
      // 0 hierba, 1 hierba con flores, 2 camino, 3 agua A, 4 roca, 5 árbol, 6 agua B, 7 plaza
      block(c, 0, '#69db7c', '#8b5a2b', '#6b4423', '#40c057'); speckle(c, 0, r, '#8ce99a', 30); speckle(c, 0, r, '#37b24d', 20);
      block(c, 64, '#69db7c', '#8b5a2b', '#6b4423', '#40c057'); speckle(c, 64, r, '#8ce99a', 20);
      ['#ff8787', '#ffd43b', '#ffffff', '#da77f2'].forEach(function (col) { for (var k = 0; k < 3; k++) { var u = r.float(), v = r.float(); c.fillStyle = col; c.beginPath(); c.arc(64 + 32 + (u - v) * 26, 32 + (u + v - 1) * 12, 1.8, 0, 6.3); c.fill(); } });
      block(c, 128, '#e9c46a', '#a0703c', '#7d5530'); speckle(c, 128, r, '#c9a14e', 26); speckle(c, 128, r, '#f4dca0', 14);
      for (var w = 0; w < 2; w++) {
        var ox = w ? 384 : 192;
        block(c, ox, '#339af0', '#1c7ed6', '#1864ab');
        c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1.5;
        for (var k2 = 0; k2 < 3; k2++) { var yy = 26 + k2 * 6 + (w ? 3 : 0); c.beginPath(); c.moveTo(ox + 18 + k2 * 4, yy); c.quadraticCurveTo(ox + 26 + k2 * 4, yy - 3, ox + 34 + k2 * 4, yy); c.stroke(); }
      }
      block(c, 256, '#69db7c', '#8b5a2b', '#6b4423', '#40c057'); speckle(c, 256, r, '#8ce99a', 16);
      poly(c, [256 + 18, 34, 256 + 26, 16, 256 + 42, 14, 256 + 50, 30, 256 + 40, 40, 256 + 24, 40], '#adb5bd', '#495057');
      poly(c, [256 + 26, 16, 256 + 42, 14, 256 + 36, 24, 256 + 28, 24], '#dee2e6');
      block(c, 320, '#69db7c', '#8b5a2b', '#6b4423', '#40c057'); speckle(c, 320, r, '#8ce99a', 16);
      c.fillStyle = '#6b4423'; c.fillRect(320 + 29, 22, 6, 14);
      [[32, 18, 13, '#2b8a3e'], [26, 12, 10, '#37b24d'], [38, 10, 10, '#37b24d'], [32, 4, 9, '#51cf66']].forEach(function (b) { c.fillStyle = b[3]; c.beginPath(); c.arc(320 + b[0], b[1] + 6, b[2], 0, 6.3); c.fill(); });
      block(c, 448, '#ced4da', '#868e96', '#495057');
      c.strokeStyle = 'rgba(73,80,87,0.5)'; c.lineWidth = 1; c.beginPath(); c.moveTo(448 + 16, 24); c.lineTo(448 + 48, 40); c.moveTo(448 + 48, 24); c.lineTo(448 + 16, 40); c.stroke();
    });
    // torres: base iso + cuerpo
    var tower = function (key, draw) { T.generate(key, 64, 96, function (c) { c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); c.ellipse(32, 84, 24, 10, 0, 0, 6.3); c.fill(); draw(c); }); };
    tower('id-t0', function (c) {
      c.fillStyle = '#8b5a2b'; c.fillRect(18, 40, 28, 44); c.fillStyle = '#6b4423'; c.fillRect(32, 40, 14, 44);
      c.strokeStyle = '#4a2f17'; c.lineWidth = 2; c.strokeRect(18, 40, 28, 44);
      c.fillStyle = '#c08457'; for (var i = 0; i < 4; i++) c.fillRect(14 + i * 10, 30, 6, 12);
      c.fillStyle = '#e03131'; c.beginPath(); c.moveTo(32, 2); c.lineTo(52, 32); c.lineTo(12, 32); c.closePath(); c.fill(); c.strokeStyle = '#862e2e'; c.stroke();
      c.fillStyle = '#212529'; c.fillRect(28, 52, 8, 12);
    });
    tower('id-t1', function (c) {
      var g = c.createLinearGradient(12, 0, 52, 0); g.addColorStop(0, '#adb5bd'); g.addColorStop(0.5, '#dee2e6'); g.addColorStop(1, '#868e96');
      c.fillStyle = g; c.beginPath(); c.moveTo(12, 84); c.lineTo(16, 40); c.lineTo(48, 40); c.lineTo(52, 84); c.closePath(); c.fill(); c.strokeStyle = '#495057'; c.lineWidth = 2; c.stroke();
      c.fillStyle = '#868e96'; for (var i = 0; i < 4; i++) c.fillRect(12 + i * 11, 32, 7, 10);
      c.fillStyle = '#343a40'; c.beginPath(); c.arc(32, 34, 12, 0, 6.3); c.fill();
      c.fillStyle = '#212529'; c.save(); c.translate(32, 32); c.rotate(-0.5); c.fillRect(0, -6, 26, 12); c.restore();
      c.fillStyle = '#ff8787'; c.fillRect(20, 60, 24, 4);
    });
    tower('id-t2', function (c) {
      c.fillStyle = '#e7f5ff'; c.beginPath(); c.moveTo(14, 84); c.lineTo(20, 52); c.lineTo(44, 52); c.lineTo(50, 84); c.closePath(); c.fill(); c.strokeStyle = '#74c0fc'; c.lineWidth = 2; c.stroke();
      var g = c.createLinearGradient(20, 0, 44, 60); g.addColorStop(0, '#e7f5ff'); g.addColorStop(0.5, '#74c0fc'); g.addColorStop(1, '#1c7ed6');
      c.fillStyle = g; c.beginPath(); c.moveTo(32, 2); c.lineTo(46, 30); c.lineTo(32, 56); c.lineTo(18, 30); c.closePath(); c.fill(); c.strokeStyle = '#1864ab'; c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.7)'; c.beginPath(); c.moveTo(32, 8); c.lineTo(38, 28); c.lineTo(32, 26); c.closePath(); c.fill();
    });
    var unit = function (key, w, h, draw) { T.generate(key, w, h, function (c) { c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(w / 2, h - 5, w * 0.36, 5, 0, 0, 6.3); c.fill(); draw(c, w, h); }); };
    var eyes = function (c, x, y, s) { c.fillStyle = '#fff'; c.beginPath(); c.arc(x - s, y, s * 0.8, 0, 6.3); c.arc(x + s, y, s * 0.8, 0, 6.3); c.fill(); c.fillStyle = '#212529'; c.beginPath(); c.arc(x - s + 1, y, s * 0.4, 0, 6.3); c.arc(x + s + 1, y, s * 0.4, 0, 6.3); c.fill(); };
    unit('id-slime', 40, 36, function (c) { var g = c.createRadialGradient(16, 14, 2, 20, 20, 18); g.addColorStop(0, '#d3f9d8'); g.addColorStop(1, '#2f9e44'); c.fillStyle = g; c.beginPath(); c.moveTo(4, 30); c.quadraticCurveTo(4, 6, 20, 6); c.quadraticCurveTo(36, 6, 36, 30); c.closePath(); c.fill(); c.strokeStyle = '#1b5e2a'; c.lineWidth = 2; c.stroke(); eyes(c, 20, 18, 5); });
    unit('id-runner', 34, 40, function (c) { c.fillStyle = '#e03131'; c.beginPath(); c.ellipse(17, 22, 11, 13, 0, 0, 6.3); c.fill(); c.strokeStyle = '#7a1c1c'; c.lineWidth = 2; c.stroke(); c.fillStyle = '#ffa8a8'; c.beginPath(); c.moveTo(8, 12); c.lineTo(10, 2); c.lineTo(14, 10); c.moveTo(26, 12); c.lineTo(24, 2); c.lineTo(20, 10); c.fill(); eyes(c, 17, 20, 4); c.fillStyle = '#7a1c1c'; c.fillRect(10, 32, 5, 6); c.fillRect(19, 32, 5, 6); });
    unit('id-tank', 52, 50, function (c) { var g = c.createLinearGradient(0, 8, 0, 44); g.addColorStop(0, '#adb5bd'); g.addColorStop(1, '#495057'); c.fillStyle = g; c.beginPath(); if (c.roundRect) c.roundRect(6, 8, 40, 36, 8); else c.rect(6, 8, 40, 36); c.fill(); c.strokeStyle = '#212529'; c.lineWidth = 2.5; c.stroke(); c.fillStyle = '#ffd43b'; c.fillRect(14, 20, 8, 5); c.fillRect(30, 20, 8, 5); c.fillStyle = '#343a40'; c.fillRect(12, 34, 28, 4); });
    unit('id-boss', 76, 72, function (c) { var g = c.createRadialGradient(30, 24, 4, 38, 36, 34); g.addColorStop(0, '#e5dbff'); g.addColorStop(0.5, '#9775fa'); g.addColorStop(1, '#5f3dc4'); c.fillStyle = g; c.beginPath(); c.arc(38, 36, 28, 0, 6.3); c.fill(); c.strokeStyle = '#3b1f8c'; c.lineWidth = 3; c.stroke(); c.fillStyle = '#ffd43b'; c.beginPath(); c.moveTo(22, 12); c.lineTo(28, 2); c.lineTo(34, 10); c.lineTo(38, 0); c.lineTo(42, 10); c.lineTo(48, 2); c.lineTo(54, 12); c.closePath(); c.fill(); eyes(c, 38, 34, 7); });
    T.generate('id-arrow', 20, 4, function (c) { c.fillStyle = '#6b4423'; c.fillRect(0, 1, 16, 2); c.fillStyle = '#dee2e6'; c.beginPath(); c.moveTo(20, 2); c.lineTo(14, 0); c.lineTo(14, 4); c.closePath(); c.fill(); });
    T.generate('id-ball', 14, 14, function (c) { var g = c.createRadialGradient(5, 5, 1, 7, 7, 7); g.addColorStop(0, '#868e96'); g.addColorStop(1, '#212529'); c.fillStyle = g; c.beginPath(); c.arc(7, 7, 6.5, 0, 6.3); c.fill(); });
    MG.glowTexture(scene, 'id-frost', 18, 'rgba(165,216,255,1)');
    MG.glowTexture(scene, 'id-spark', 14, 'rgba(255,255,255,1)');
    T.generate('id-castle', 96, 110, function (c) {
      c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(48, 96, 40, 12, 0, 0, 6.3); c.fill();
      var wall = function (x, y, w, h) { var g = c.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, '#dee2e6'); g.addColorStop(1, '#868e96'); c.fillStyle = g; c.fillRect(x, y, w, h); c.strokeStyle = '#495057'; c.lineWidth = 2; c.strokeRect(x, y, w, h); for (var i = 0; i < w / 10; i++) c.fillRect(x + i * 10, y - 6, 6, 6); };
      wall(14, 50, 68, 46); wall(8, 26, 22, 70); wall(66, 26, 22, 70);
      c.fillStyle = '#495057'; c.beginPath(); c.arc(48, 96, 12, Math.PI, 0); c.fill();
      c.fillStyle = '#4263eb'; c.fillRect(47, 4, 2, 24); c.beginPath(); c.moveTo(49, 4); c.lineTo(64, 9); c.lineTo(49, 14); c.closePath(); c.fill();
    });
    T.generate('id-portal', 80, 80, function (c) {
      for (var i = 0; i < 5; i++) { c.strokeStyle = ['#7048e8', '#9775fa', '#b197fc', '#e599f7', '#ffffff'][i]; c.lineWidth = 4 - i * 0.5; c.beginPath(); c.arc(40, 40, 36 - i * 7, i, i + 4.2); c.stroke(); }
    });
  }

  function buildMapData() {
    var data = [], path = {};
    routeCells().forEach(function (p) { path[p[0] + ',' + p[1]] = true; });
    var r = new UG.RNG('iso-map');
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var g = G.GRASS;
      if (path[x + ',' + y]) g = G.PATH;
      else if ((x >= 9 && y >= 10) || (x === 11 && y === 9) || (x === 10 && y === 11)) g = G.WATER;
      else if (x === 11 && y >= 2 && y <= 4) g = G.PLAZA;
      else { var v = r.float(); g = v < 0.08 ? G.TREE : v < 0.13 ? G.ROCK : v < 0.3 ? G.FLOWERS : G.GRASS; }
      data.push(g);
    }
    return {
      type: 'map', orientation: 'isometric', renderorder: 'right-down', width: N, height: N, tilewidth: TW, tileheight: TH, infinite: false,
      tilesets: [{ firstgid: 1, name: 'iso-tiles', image: 'iso-tiles.png', imagewidth: 512, imageheight: 64, tilewidth: 64, tileheight: 64, tilecount: 8, columns: 8, margin: 0, spacing: 0,
        tileoffset: { x: 0, y: 16 }, tiles: [{ id: 3, animation: [{ tileid: 3, duration: 600 }, { tileid: 6, duration: 600 }] }] }],
      layers: [{ id: 1, type: 'tilelayer', name: 'Suelo', width: N, height: N, x: 0, y: 0, opacity: 1, visible: true, data: data }]
    };
  }

  var Play = {
    key: 'Play',
    create: function () {
      var s = this; makeTextures(this);
      this.cameras.main.setBackgroundColor(0x1d3b2a);
      var bg = this.add.graphics(); bg.fillGradientStyle(0x2f5d3a, 0x2f5d3a, 0x13261b, 0x13261b, 1).fillRect(0, 0, W, H); bg.depth = -100; bg.cacheAsTexture = true;
      this.map = this.add.tilemap(buildMapData());
      this.layer = this.map.createLayer('Suelo', OX, OY); this.layer.depth = -50;
      this.cells = routeCells();
      this.gold = 170; this.lives = 20; this.wave = 0; this.kills = 0; this.speedMul = 1; this.over = false;
      this.towers = {}; this.enemies = []; this.shots = []; this.sel = -1; this.spawnQueue = []; this.spawnT = 0; this.waveActive = false;
      // castillo y portal
      var end = this.cells[this.cells.length - 1], st = this.cells[0], p = iso(end[0] + 0.5, end[1] + 0.5);
      this.castle = this.add.image(p.x + 10, p.y - 36, 'id-castle'); this.castle.depth = p.y + 5;
      var ps = iso(st[0] + 0.5, st[1] + 0.5); this.portal = this.add.image(ps.x - 8, ps.y - 12, 'id-portal').setScale(0.9, 0.55); this.portal.blendMode = 'add'; this.portal.depth = ps.y - 1;
      this.tweens.add({ targets: this.portal, rotation: Math.PI * 2, duration: 2400, repeat: -1 });
      // capas dinámicas
      this.hover = this.add.graphics(); this.hover.depth = -40;
      this.rangeG = this.add.graphics(); this.rangeG.depth = -39;
      this.ghost = this.add.image(0, 0, 'id-t0'); this.ghost.alpha = 0.55; this.ghost.visible = false; this.ghost.setOrigin(0.5, 0.875);
      this.bars = this.add.graphics(); this.bars.depth = 5000;
      this.fx = this.add.particles('id-spark', { lifespan: { min: 250, max: 600 }, speed: { min: 40, max: 200 }, scale: { start: 1, end: 0 }, blendMode: 'add', frequency: -1, maxParticles: 1500 });
      this.smoke = this.add.particles('id-spark', { lifespan: { min: 400, max: 900 }, speed: { min: 20, max: 90 }, scale: { start: 1.8, end: 3 }, alpha: { start: 0.5, end: 0 }, frequency: -1, color: [0x495057, 0x212529], maxParticles: 400 });
      this.fx.depth = 4000; this.smoke.depth = 3999;
      this.buildUI();
      // entrada
      this.input.on('pointermove', function (p) { s.onHover(p); });
      this.input.on('pointerdown', function (p, hits) { if (!hits || !hits.length) s.onTap(p); });
      var kb = this.input.keyboard;
      ['ONE', 'TWO', 'THREE'].forEach(function (k, i) { kb.on('keydown-' + k, function () { s.selectType(s.sel === i ? -1 : i); }); });
      kb.on('keydown-N', function () { s.nextWave(); });
      kb.on('keydown-X', function () { s.toggleSpeed(); });
      this.sound.addMusic('id-music', { bpm: 104, tracks: [
        { wave: 'triangle', volume: 0.2, notes: 'D4 F4 A4 D5 C5 A4 F4 A4 Bb3 D4 F4 Bb4 A4 F4 E4 C4' },
        { wave: 'sine', volume: 0.3, notes: 'D2 - - - D2 - - - Bb1 - - - C2 - - -' },
        { drums: true, volume: 0.22, notes: 'k . . h s . . h k . k h s . . h' }] });
      this.sound.playMusic('id-music', { volume: 0.26, fadeIn: 800 });
      this.refresh();
      this.cameras.main.setZoom(1.15); this.cameras.main.zoomTo(1, 900, 'quadOut');
      this.time.delayedCall(1500, function () { if (!s.waveActive && s.wave === 0) s.nextWave(); });
    },
    // ------------------------------------------------------------------ UI
    buildUI: function () {
      var s = this, hud = this.add.hud;
      var bar = hud.graphics(); bar.fillStyle(0x0b1a12, 0.85).fillRect(0, H - 92, W, 92).lineStyle(2, 0x8ce99a, 0.35).lineBetween(0, H - 92, W, H - 92);
      this.cards = TOWERS.map(function (t, i) {
        var c = hud.container(120 + i * 170, H - 46);
        var g = new UG.Graphics(); c.add(g); c.g = g;
        var ic = new UG.Sprite(-48, 6, t.key); ic.setScale(0.62); ic.setOrigin(0.5, 0.6); c.add(ic);
        var nm = new UG.Text(-12, -18, (i + 1) + ' · ' + t.name, { fontFamily: MG.FONT, fontSize: 17, fontWeight: 'bold', fill: 0xffffff }); c.add(nm);
        var ds = new UG.Text(-12, 2, t.desc, { fontFamily: MG.FONT, fontSize: 13, fill: 0xb2f2bb }); c.add(ds);
        var cs = new UG.Text(-12, 18, '● ' + t.cost, { fontFamily: MG.FONT, fontSize: 15, fontWeight: 'bold', fill: 0xffd43b }); c.add(cs);
        c.hitArea = new UG.Rectangle(-76, -38, 152, 76); c.setInteractive({ cursor: 'pointer' });
        c.on('pointertap', function () { s.selectType(s.sel === i ? -1 : i); s.sound.playSfx('select', { volume: 0.3 }); });
        return c;
      });
      this.waveBtn = hud.button(W - 150, H - 62, { text: '▶ Oleada', width: 150, height: 40, color: 0x2f9e44, textStyle: { fontSize: 18 }, onClick: function () { s.nextWave(); } });
      this.speedBtn = hud.button(W - 150, H - 20, { text: 'Velocidad x1', width: 150, height: 32, color: 0x495057, textStyle: { fontSize: 15 }, onClick: function () { s.toggleSpeed(); } });
      this.goldT = MG.text(this, 80, 26, '', 22, 0xffd43b, { hud: true, ox: 0 });
      this.livesT = MG.text(this, 230, 26, '', 22, 0xff8787, { hud: true, ox: 0 });
      this.waveT = MG.text(this, W / 2 + 60, 26, '', 22, 0xffffff, { hud: true });
      this.msgT = MG.text(this, W / 2, 70, '', 18, 0xd3f9d8, { hud: true, stroke: 3, style: { fontWeight: 'normal' } });
      this.panel = null;
      MG.hudButtons(this);
    },
    refresh: function () {
      var s = this;
      this.goldT.text = '● ' + this.gold; this.livesT.text = '♥ ' + this.lives; this.waveT.text = 'Oleada ' + this.wave + ' / ' + WAVES;
      this.cards.forEach(function (c, i) {
        var t = TOWERS[i], can = s.gold >= t.cost, on = s.sel === i;
        c.g.clear().fillStyle(on ? 0x2b8a3e : 0x1b3325, 1).fillRoundedRect(-76, -38, 152, 76, 12).lineStyle(on ? 3 : 2, on ? 0xb2f2bb : 0x40c057, on ? 1 : 0.5).strokeRoundedRect(-76, -38, 152, 76, 12);
        c.alpha = can ? 1 : 0.5;
      });
      this.waveBtn.setEnabled(!this.waveActive && !this.over && this.wave < WAVES);
    },
    say: function (txt) { var t = this.msgT; t.text = txt; t.alpha = 1; this.tweens.killTweensOf(t); this.tweens.add({ targets: t, alpha: 0, delay: 1600, duration: 500 }); },
    selectType: function (i) {
      this.closePanel();
      if (i >= 0 && this.gold < TOWERS[i].cost) { this.say('No tienes oro suficiente (' + TOWERS[i].cost + ')'); this.sound.playSfx({ preset: 'hit', seed: 2 }, { volume: 0.2 }); i = -1; }
      this.sel = i; this.ghost.visible = false; this.hover.clear(); this.rangeG.clear();
      if (i >= 0) { this.ghost.setTexture(TOWERS[i].key); this.say('Toca una casilla de hierba para construir ' + TOWERS[i].name + ' (pulsa ' + (i + 1) + ' otra vez para cancelar)'); }
      this.refresh();
    },
    toggleSpeed: function () {
      this.speedMul = this.speedMul === 1 ? 2 : 1;
      this.time.timeScale = this.speedMul; this.tweens.timeScale = this.speedMul;
      this.speedBtn.setText('Velocidad x' + this.speedMul);
    },
    tileAt: function (p) {
      var wp = this.cameras.main.getWorldPoint(p.x, p.y);
      var t = this.layer.worldToTileXY(wp.x, wp.y, true);
      if (t.x < 0 || t.y < 0 || t.x >= N || t.y >= N) return null;
      return { x: t.x, y: t.y, gid: this.layer.getTileAt(t.x, t.y, true).index };
    },
    buildable: function (t) { return t && (t.gid === G.GRASS || t.gid === G.FLOWERS) && !this.towers[t.x + ',' + t.y]; },
    diamond: function (g, tx, ty, color, alpha) {
      var c = iso(tx + 0.5, ty + 0.5);
      g.fillStyle(color, alpha).fillPoints([{ x: c.x, y: c.y - TH / 2 }, { x: c.x + TW / 2, y: c.y }, { x: c.x, y: c.y + TH / 2 }, { x: c.x - TW / 2, y: c.y }], true);
      g.lineStyle(2, color, 0.9).strokePoints([{ x: c.x, y: c.y - TH / 2 }, { x: c.x + TW / 2, y: c.y }, { x: c.x, y: c.y + TH / 2 }, { x: c.x - TW / 2, y: c.y }], true);
    },
    onHover: function (p) {
      if (this.over) return;
      var t = this.tileAt(p);
      this.hover.clear(); this.rangeG.clear(); this.ghost.visible = false;
      if (!t) return;
      if (this.sel >= 0) {
        var ok = this.buildable(t), c = iso(t.x + 0.5, t.y + 0.5), rg = TOWERS[this.sel].range;
        this.diamond(this.hover, t.x, t.y, ok ? 0x69db7c : 0xff6b6b, 0.35);
        this.rangeG.lineStyle(2, ok ? 0xffffff : 0xff6b6b, 0.6).strokeEllipse(c.x, c.y, rg * 2, rg).fillStyle(0xffffff, 0.06).fillEllipse(c.x, c.y, rg * 2, rg);
        this.ghost.visible = true; this.ghost.x = c.x; this.ghost.y = c.y + 4; this.ghost.depth = c.y + 1; this.ghost.tint = ok ? 0xffffff : 0xff8787;
      } else if (this.towers[t.x + ',' + t.y]) this.diamond(this.hover, t.x, t.y, 0xffd43b, 0.25);
    },
    onTap: function (p) {
      if (this.over) return;
      var t = this.tileAt(p);
      if (!t) { this.closePanel(); return; }
      var tw = this.towers[t.x + ',' + t.y];
      if (tw) { this.openPanel(tw); return; }
      this.closePanel();
      if (this.sel >= 0) {
        if (!this.buildable(t)) { this.say('Ahí no se puede construir'); this.sound.playSfx({ preset: 'hit', seed: 2 }, { volume: 0.2 }); return; }
        this.build(this.sel, t.x, t.y);
        if (this.gold < TOWERS[this.sel].cost) this.selectType(-1);
        this.onHover(p);
      }
    },
    build: function (type, tx, ty) {
      var def = TOWERS[type], c = iso(tx + 0.5, ty + 0.5);
      if (this.gold < def.cost) return null;
      this.gold -= def.cost;
      var spr = this.add.image(c.x, c.y + 4, def.key); spr.setOrigin(0.5, 0.875); spr.depth = c.y;
      spr.setScale(0.2, 1.6); this.tweens.add({ targets: spr, scaleX: 1, scaleY: 1, duration: 380, ease: 'backOut' });
      var tw = { type: type, def: def, tx: tx, ty: ty, x: c.x, y: c.y, spr: spr, level: 1, cd: 0, spent: def.cost, pips: this.add.graphics() };
      tw.pips.depth = c.y + 2;
      this.towers[tx + ',' + ty] = tw;
      this.drawPips(tw);
      this.smoke.explode(12, c.x, c.y);
      this.sound.playSfx({ preset: 'powerup', seed: 3 + type }, { volume: 0.3, rate: 1.2 });
      this.refresh();
      return tw;
    },
    stat: function (tw, k) { var v = tw.def[k], L = tw.level - 1; if (k === 'dmg') return v * Math.pow(1.55, L); if (k === 'range') return v * (1 + 0.12 * L); if (k === 'rate') return v * Math.pow(0.85, L); return v; },
    upgradeCost: function (tw) { return Math.round(tw.def.cost * 0.8 * tw.level); },
    drawPips: function (tw) { var g = tw.pips.clear(); for (var i = 0; i < tw.level; i++) g.fillStyle(0xffd43b, 1).fillStar(tw.x - (tw.level - 1) * 7 + i * 14, tw.y + 16, 5, 6, 2.6); },
    openPanel: function (tw) {
      var s = this; this.closePanel(); this.selectType(-1);
      var c = this.panel = this.add.hud.container(UG.Math.clamp(tw.x, 110, W - 110), UG.Math.clamp(tw.y - 110, 110, H - 200));
      var g = new UG.Graphics().fillStyle(0x0b1a12, 0.92).fillRoundedRect(-100, -62, 200, 124, 14).lineStyle(2, 0x8ce99a, 0.6).strokeRoundedRect(-100, -62, 200, 124, 14); c.add(g);
      var t = new UG.Text(0, -44, tw.def.name + ' · nivel ' + tw.level, { fontFamily: MG.FONT, fontSize: 16, fontWeight: 'bold', fill: 0xffffff }); t.setOrigin(0.5); c.add(t);
      var cost = this.upgradeCost(tw), maxed = tw.level >= 3;
      var up = new UG.Button(this, 0, -8, { text: maxed ? 'Nivel máximo' : 'Mejorar ● ' + cost, width: 176, height: 34, color: 0x2f9e44, textStyle: { fontSize: 15 }, onClick: function () { s.upgrade(tw); } });
      up.setEnabled(!maxed && this.gold >= cost); c.add(up);
      var sell = new UG.Button(this, 0, 34, { text: 'Vender ● ' + Math.round(tw.spent * 0.6), width: 176, height: 30, color: 0xc92a2a, textStyle: { fontSize: 14 }, onClick: function () { s.sell(tw); } });
      c.add(sell);
      this.rangeG.clear().lineStyle(2, 0xffd43b, 0.7).strokeEllipse(tw.x, tw.y, this.stat(tw, 'range') * 2, this.stat(tw, 'range'));
      this.panelTower = tw;
    },
    closePanel: function () { if (this.panel) { this.panel.destroy(); this.panel = null; this.panelTower = null; this.rangeG.clear(); } },
    upgrade: function (tw) {
      var cost = this.upgradeCost(tw); if (tw.level >= 3 || this.gold < cost) return;
      this.gold -= cost; tw.spent += cost; tw.level++;
      this.drawPips(tw); this.tweens.add({ targets: tw.spr, scaleX: 1.2, scaleY: 1.2, duration: 120, yoyo: true });
      this.fx.setParticleTint([0xffd43b, 0xffffff]); this.fx.explode(20, tw.x, tw.y - 30);
      this.sound.playSfx({ preset: 'powerup', seed: 40 }, { volume: 0.35 });
      this.refresh(); this.openPanel(tw);
    },
    sell: function (tw) {
      this.gold += Math.round(tw.spent * 0.6);
      delete this.towers[tw.tx + ',' + tw.ty];
      this.smoke.explode(14, tw.x, tw.y); tw.spr.destroy(); tw.pips.destroy();
      this.sound.playSfx({ preset: 'coin', seed: 5 }, { volume: 0.3 });
      this.closePanel(); this.refresh();
    },
    // ------------------------------------------------------------------ oleadas
    nextWave: function () {
      if (this.waveActive || this.over || this.wave >= WAVES) return;
      this.wave++; this.waveActive = true;
      var w = this.wave, q = [], n = 6 + w * 2;
      for (var i = 0; i < n; i++) q.push(i % 5 === 4 && w >= 3 ? 'tank' : (i % 3 === 2 && w >= 2 ? 'runner' : 'slime'));
      if (w % 4 === 0) q.push('boss');
      if (w >= 6) for (var k = 0; k < w - 4; k++) q.push('runner');
      this.spawnQueue = q; this.spawnT = 0;
      var banner = MG.text(this, W / 2, H * 0.4, w % 4 === 0 ? '⚠ Oleada ' + w + ' · JEFE' : 'Oleada ' + w, 44, w % 4 === 0 ? 0xff8787 : 0xffffff, { hud: true, stroke: 6 });
      banner.setScale(0.5); this.tweens.chain({ targets: banner, tweens: [{ scaleX: 1, scaleY: 1, duration: 300, ease: 'backOut' }, { alpha: 0, delay: 900, duration: 400, onComplete: function () { banner.destroy(); } }] });
      this.sound.playSfx({ preset: 'powerup', seed: 90 }, { volume: 0.3, rate: 0.7 });
      this.refresh();
    },
    spawn: function (kind) {
      var d = ENEMIES[kind], hp = Math.round(d.hp * (1 + (this.wave - 1) * 0.2));
      var spr = this.add.image(0, 0, d.key); spr.setOrigin(0.5, 0.9);
      var e = { kind: kind, d: d, hp: hp, max: hp, dist: 0, slow: 0, slowT: 0, spr: spr, x: 0, y: 0, alive: true, bob: this.rng.float() * 6 };
      this.placeEnemy(e);
      spr.alpha = 0; this.tweens.add({ targets: spr, alpha: 1, duration: 300 });
      this.enemies.push(e);
    },
    placeEnemy: function (e) {
      var cells = this.cells, i = Math.min(cells.length - 2, Math.floor(e.dist)), f = Math.min(1, e.dist - i);
      var a = cells[i], b = cells[i + 1], u = a[0] + (b[0] - a[0]) * f + 0.5, v = a[1] + (b[1] - a[1]) * f + 0.5;
      iso(u, v, e); e.spr.x = e.x; e.spr.y = e.y + 2; e.spr.depth = e.y;
      e.spr.flipX = (b[0] - a[0]) - (b[1] - a[1]) < 0;
    },
    damage: function (e, dmg) {
      if (!e.alive) return;
      e.hp -= dmg;
      e.spr.tint = 0xffc9c9; var spr = e.spr; this.time.delayedCall(70, function () { if (!spr.destroyed) spr.tint = 0xffffff; });
      if (e.hp <= 0) this.kill(e);
    },
    kill: function (e) {
      e.alive = false; this.kills++;
      this.gold += e.d.gold;
      this.fx.setParticleTint([0xffffff, e.kind === 'slime' ? 0x69db7c : e.kind === 'runner' ? 0xff6b6b : e.kind === 'tank' ? 0xadb5bd : 0x9775fa]);
      this.fx.explode(e.kind === 'boss' ? 60 : 14, e.x, e.y - 12);
      MG.floatText(this, e.x, e.y - 30, '+' + e.d.gold, 0xffd43b, 16);
      var spr = e.spr; this.tweens.add({ targets: spr, scaleX: 1.4, scaleY: 0.2, alpha: 0, duration: 200, onComplete: function () { spr.destroy(); } });
      this.sound.playSfx({ preset: e.kind === 'boss' ? 'explosion' : 'coin', seed: 7 }, { volume: e.kind === 'boss' ? 0.5 : 0.18, rate: 1.3 });
      if (e.kind === 'boss') this.cameras.main.shake(300, 0.012);
      this.refresh();
    },
    leak: function (e) {
      e.alive = false; this.lives = Math.max(0, this.lives - e.d.lives);
      e.spr.destroy();
      this.cameras.main.shake(160, 0.008); this.cameras.main.flash(120, 0xff0000, 0.25);
      this.sound.playSfx({ preset: 'hurt', seed: 4 }, { volume: 0.35 });
      this.tweens.add({ targets: this.castle, x: this.castle.x + 3, duration: 40, yoyo: true, repeat: 2 });
      this.refresh();
      if (this.lives <= 0) this.finish(false);
    },
    // ------------------------------------------------------------------ disparos
    target: function (tw) {
      var best = null, bd = -1, r = this.stat(tw, 'range');
      for (var i = 0; i < this.enemies.length; i++) {
        var e = this.enemies[i]; if (!e.alive) continue;
        var dx = e.x - tw.x, dy = (e.y - tw.y) * 2;
        if (dx * dx + dy * dy <= r * r && e.dist > bd) { bd = e.dist; best = e; }
      }
      return best;
    },
    fire: function (tw, e) {
      var d = tw.def, sx = tw.x, sy = tw.y - 52;
      var spr = this.add.image(sx, sy, d.proj === 'arrow' ? 'id-arrow' : d.proj === 'ball' ? 'id-ball' : 'id-frost');
      if (d.proj === 'frost') spr.blendMode = 'add';
      spr.depth = 3000;
      var shot = { tw: tw, e: e, spr: spr, sx: sx, sy: sy, tx: e.x, ty: e.y - 14, t: 0, dur: d.proj === 'ball' ? 0.75 : d.proj === 'arrow' ? 0.22 : 0.35, dmg: this.stat(tw, 'dmg') };
      this.shots.push(shot);
      this.sound.playSfx({ preset: d.proj === 'ball' ? 'explosion' : d.proj === 'arrow' ? 'shoot' : 'laser', seed: 13 + tw.type }, { volume: d.proj === 'ball' ? 0.12 : 0.1, rate: d.proj === 'ball' ? 1.6 : 1.4 });
      if (d.proj === 'ball') this.tweens.add({ targets: tw.spr, scaleY: 0.9, duration: 80, yoyo: true });
    },
    impact: function (sh) {
      var d = sh.tw.def, s = this;
      if (d.splash) {
        this.smoke.explode(10, sh.tx, sh.ty); this.fx.setParticleTint([0xffd8a8, 0xff922b]); this.fx.explode(16, sh.tx, sh.ty);
        var ring = this.add.graphics(); ring.x = sh.tx; ring.y = sh.ty + 10; ring.depth = 3500; ring.lineStyle(3, 0xffc078, 1).strokeEllipse(0, 0, d.splash * 2, d.splash);
        ring.setScale(0.3); this.tweens.add({ targets: ring, scaleX: 1, scaleY: 1, alpha: 0, duration: 320, onComplete: function () { ring.destroy(); } });
        this.enemies.forEach(function (e) { if (!e.alive) return; var dx = e.x - sh.tx, dy = (e.y - sh.ty - 14) * 2; if (dx * dx + dy * dy <= d.splash * d.splash) s.damage(e, sh.dmg); });
      } else if (sh.e.alive) {
        this.damage(sh.e, sh.dmg);
        if (d.slow) { sh.e.slow = d.slow; sh.e.slowT = d.slowTime; if (sh.e.alive) sh.e.spr.tint = 0x74c0fc; this.fx.setParticleTint(0xa5d8ff); this.fx.explode(6, sh.tx, sh.ty); }
      }
    },
    finish: function (win) {
      if (this.over) return;
      this.over = true; var s = this;
      this.closePanel(); this.selectType(-1);
      this.sound.stopMusic(600);
      var score = this.kills * 10 + this.lives * 50 + this.gold + (win ? 1000 : 0);
      MG.text(this, W / 2, H * 0.42, win ? '¡Reino defendido!' : 'El castillo ha caído', 48, win ? 0x8ce99a : 0xff8787, { hud: true, stroke: 7 });
      this.sound.playSfx({ preset: win ? 'powerup' : 'hurt', seed: 55 }, { volume: 0.5 });
      this.time.delayedCall(2200, function () { s.scene.start('GameOver', { score: score, win: win }); });
    },
    update: function (t, dtRaw) {
      if (!this.layer || this.over) return;
      var dt = dtRaw * this.speedMul, sec = dt / 1000, s = this;
      // aparición
      if (this.spawnQueue.length) { this.spawnT -= dt; if (this.spawnT <= 0) { this.spawn(this.spawnQueue.shift()); this.spawnT = Math.max(380, 900 - this.wave * 40); } }
      // enemigos
      var last = this.cells.length - 1;
      for (var i = this.enemies.length - 1; i >= 0; i--) {
        var e = this.enemies[i];
        if (!e.alive) { this.enemies.splice(i, 1); continue; }
        if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) { e.slow = 0; e.spr.tint = 0xffffff; } }
        e.dist += e.d.speed * (1 - e.slow) * sec;
        if (e.dist >= last) { this.leak(e); this.enemies.splice(i, 1); if (this.over) return; continue; }
        this.placeEnemy(e);
        e.bob += sec * (8 + e.d.speed * 4); e.spr.scaleY = 1 + Math.sin(e.bob) * 0.06; e.spr.scaleX = 1 - Math.sin(e.bob) * 0.04;
      }
      // torres
      Object.keys(this.towers).forEach(function (k) {
        var tw = s.towers[k]; tw.cd -= dt;
        if (tw.cd <= 0) { var e = s.target(tw); if (e) { s.fire(tw, e); tw.cd = s.stat(tw, 'rate'); } }
      });
      // proyectiles
      for (var j = this.shots.length - 1; j >= 0; j--) {
        var sh = this.shots[j];
        if (sh.e.alive && sh.tw.def.proj !== 'ball') { sh.tx = sh.e.x; sh.ty = sh.e.y - 14; }
        sh.t += sec / sh.dur;
        var k2 = Math.min(1, sh.t), x = sh.sx + (sh.tx - sh.sx) * k2, y = sh.sy + (sh.ty - sh.sy) * k2;
        if (sh.tw.def.proj === 'ball') y -= Math.sin(k2 * Math.PI) * 70;
        if (sh.tw.def.proj === 'arrow') sh.spr.rotation = Math.atan2(sh.ty - sh.spr.y, sh.tx - sh.spr.x);
        sh.spr.x = x; sh.spr.y = y;
        if (k2 >= 1) { this.impact(sh); sh.spr.destroy(); this.shots.splice(j, 1); }
      }
      // barras de vida
      var g = this.bars.clear();
      this.enemies.forEach(function (e) {
        if (!e.alive || e.hp >= e.max) return;
        var w = e.kind === 'boss' ? 56 : 30, h = 5, x = e.x - w / 2, y = e.y - (e.kind === 'boss' ? 74 : e.kind === 'tank' ? 52 : 42), f = Math.max(0, e.hp / e.max);
        g.fillStyle(0x000000, 0.6).fillRect(x - 1, y - 1, w + 2, h + 2).fillStyle(f > 0.5 ? 0x51cf66 : f > 0.25 ? 0xfcc419 : 0xff6b6b, 1).fillRect(x, y, w * f, h);
      });
      // fin de oleada
      if (this.waveActive && !this.spawnQueue.length && !this.enemies.length) {
        this.waveActive = false;
        var bonus = 20 + this.wave * 5; this.gold += bonus; this.say('Oleada superada · +' + bonus + ' de oro');
        this.refresh();
        if (this.wave >= WAVES) this.finish(true);
      }
    }
  };

  MG.start({
    title: 'Iso Defense', width: W, height: H, backgroundColor: 0x1d3b2a,
    scenes: [
      MG.menu({ id: 'iso-defense', title: 'ISO DEFENSE', subtitle: 'Defiende el castillo durante ' + WAVES + ' oleadas', glow: '#40c057', titleColors: [0xffffff, 0xb2f2bb], buttonColor: 0x2f9e44,
        help: '1 Arco · 2 Cañón · 3 Hielo · clic en la hierba para construir · clic en una torre para mejorarla o venderla\nN siguiente oleada · X velocidad x2',
        touchHelp: 'Elige una torre abajo y toca la hierba · toca una torre para mejorarla',
        background: function (s) {
          makeTextures(s);
          var map = s.add.tilemap(buildMapData()), l = map.createLayer('Suelo', OX, OY + 40); l.alpha = 0.35;
          var tws = [[3, 3, 0], [7, 7, 1], [4, 7, 2], [8, 2, 0]];
          tws.forEach(function (q) { var c = iso(q[0] + 0.5, q[1] + 0.5); var t = s.add.image(c.x, c.y + 44, TOWERS[q[2]].key); t.setOrigin(0.5, 0.875); t.alpha = 0.5; });
        } }),
      Play,
      MG.gameOver({ id: 'iso-defense', background: function (s) { makeTextures(s); s.cameras.main.setBackgroundColor(0x1d3b2a); } })]
  });
})();
