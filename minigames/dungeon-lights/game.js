/* Dungeon Lights — mazmorra procedural cenital. Prueba: generación con semilla (salas + pasillos, BFS),
 * Tilemap generado en código con colisiones, luz dinámica en RenderTexture (ambiente + luces aditivas
 * con sombras reales: polígono de visibilidad por raycast DDA contra tiles, dibujado como Mesh en abanico),
 * composición multiply, niebla de guerra en una RenderTexture de baja resolución (erase), cámara que sigue
 * con lerp, minimapa con segunda cámara (ignore), IA con línea de visión, combate y pisos encadenados. */
(function () {
  'use strict';
  var W = 960, H = 600, TS = 24, MW = 56, MH = 36, ZOOM = 1.5;
  var T = { F1: 1, F2: 2, F3: 3, WF: 4, WT: 5, VOID: 6, RUNE: 7 };
  var qs = new URLSearchParams(location.search);

  // ------------------------------------------------------------------ arte
  function makeTextures(scene) {
    var X = scene.textures;
    if (X.exists('dl-tiles')) return;
    X.generate('dl-tiles', TS * 7, TS, function (c) {
      var r = new UG.RNG('dl-tiles');
      var floor = function (ox, base, moss, crack) {
        c.fillStyle = base; c.fillRect(ox, 0, TS, TS);
        c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(ox, 11, TS, 1); c.fillRect(ox + 11, 0, 1, 11); c.fillRect(ox + 4, 12, 1, 12); c.fillRect(ox + 18, 12, 1, 12);
        c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(ox, 0, TS, 1);
        for (var i = 0; i < 14; i++) { c.fillStyle = r.chance(0.5) ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)'; c.fillRect(ox + r.int(0, TS - 2), r.int(0, TS - 2), 2, 2); }
        if (moss) { c.fillStyle = 'rgba(64,192,87,0.35)'; for (var m = 0; m < 10; m++) c.fillRect(ox + r.int(0, TS - 3), r.int(0, TS - 3), 3, 2); }
        if (crack) { c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 1; c.beginPath(); c.moveTo(ox + 3, 4); c.lineTo(ox + 9, 10); c.lineTo(ox + 8, 16); c.lineTo(ox + 15, 21); c.stroke(); }
      };
      floor(0, '#4a4e69', false, false); floor(TS, '#4a4e69', true, false); floor(TS * 2, '#43465e', false, true);
      // pared (cara de ladrillo)
      var ox = TS * 3; c.fillStyle = '#6d597a'; c.fillRect(ox, 0, TS, TS);
      c.fillStyle = '#544461'; for (var y = 0; y < TS; y += 6) { c.fillRect(ox, y + 5, TS, 1); for (var x = (y / 6) % 2 ? 6 : 0; x < TS; x += 12) c.fillRect(ox + x, y, 1, 6); }
      c.fillStyle = '#8e7a9e'; c.fillRect(ox, 0, TS, 2); c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(ox, TS - 3, TS, 3);
      // techo de pared y vacío
      ox = TS * 4; c.fillStyle = '#231b2e'; c.fillRect(ox, 0, TS, TS); c.fillStyle = '#2e2440'; c.fillRect(ox + 2, 2, TS - 4, TS - 4); c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(ox + 2, 2, TS - 4, 1);
      c.fillStyle = '#07060b'; c.fillRect(TS * 5, 0, TS, TS);
      // runa
      floor(TS * 6, '#4a4e69', false, false); c.strokeStyle = 'rgba(151,117,250,0.7)'; c.lineWidth = 1.5; c.beginPath(); c.arc(TS * 6 + 12, 12, 7, 0, 6.3); c.moveTo(TS * 6 + 12, 4); c.lineTo(TS * 6 + 12, 20); c.moveTo(TS * 6 + 5, 12); c.lineTo(TS * 6 + 19, 12); c.stroke();
    });
    // héroe: 4 fotogramas 20x26
    X.generate('dl-hero', 80, 26, function (c) {
      for (var f = 0; f < 4; f++) {
        var ox = f * 20, b = f % 2 ? 1 : 0, leg = [0, 2, 0, -2][f];
        c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(ox + 10, 24, 7, 2.5, 0, 0, 6.3); c.fill();
        c.fillStyle = '#343a40'; c.fillRect(ox + 6 + leg * 0.5, 18, 3, 6); c.fillRect(ox + 11 - leg * 0.5, 18, 3, 6);
        c.fillStyle = '#1971c2'; c.fillRect(ox + 5, 10 + b, 10, 9);
        c.fillStyle = '#a5d8ff'; c.fillRect(ox + 5, 10 + b, 10, 2);
        c.fillStyle = '#ffd8a8'; c.fillRect(ox + 6, 3 + b, 8, 7);
        c.fillStyle = '#862e9c'; c.fillRect(ox + 5, 1 + b, 10, 3); c.fillRect(ox + 4, 3 + b, 2, 3);
        c.fillStyle = '#212529'; c.fillRect(ox + 11, 5 + b, 2, 2);
        c.fillStyle = '#ced4da'; c.fillRect(ox + 15, 8 + b, 2, 9); c.fillStyle = '#fab005'; c.fillRect(ox + 14, 15 + b, 4, 2);
      }
    }, { frameWidth: 20, frameHeight: 26 });
    X.generate('dl-skel', 40, 24, function (c) {
      for (var f = 0; f < 2; f++) {
        var ox = f * 20, b = f;
        c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(ox + 10, 22, 7, 2.5, 0, 0, 6.3); c.fill();
        c.fillStyle = '#e9ecef'; c.beginPath(); c.arc(ox + 10, 6 + b, 5, 0, 6.3); c.fill();
        c.fillRect(ox + 9, 10 + b, 2, 8); for (var i = 0; i < 3; i++) c.fillRect(ox + 6, 11 + i * 2 + b, 8, 1);
        c.fillRect(ox + 6 + b, 18, 2, 4); c.fillRect(ox + 12 - b, 18, 2, 4);
        c.fillStyle = '#e03131'; c.fillRect(ox + 7, 5 + b, 2, 2); c.fillRect(ox + 11, 5 + b, 2, 2);
      }
    }, { frameWidth: 20, frameHeight: 24 });
    X.generate('dl-bat', 48, 16, function (c) {
      for (var f = 0; f < 2; f++) {
        var ox = f * 24;
        c.fillStyle = '#5f3dc4'; c.beginPath(); c.moveTo(ox + 12, 8); c.lineTo(ox + 1, f ? 2 : 12); c.lineTo(ox + 6, 9); c.lineTo(ox + 12, 12); c.lineTo(ox + 18, 9); c.lineTo(ox + 23, f ? 2 : 12); c.closePath(); c.fill();
        c.fillStyle = '#7950f2'; c.beginPath(); c.arc(ox + 12, 8, 4, 0, 6.3); c.fill();
        c.fillStyle = '#ffd43b'; c.fillRect(ox + 10, 7, 1.5, 1.5); c.fillRect(ox + 13, 7, 1.5, 1.5);
      }
    }, { frameWidth: 24, frameHeight: 16 });
    X.generate('dl-key', 16, 16, function (c) { c.strokeStyle = '#fcc419'; c.lineWidth = 2.5; c.beginPath(); c.arc(5, 8, 3.5, 0, 6.3); c.stroke(); c.fillStyle = '#fcc419'; c.fillRect(8, 7, 7, 2.5); c.fillRect(12, 9, 2, 3); c.fillRect(14, 9, 1.5, 2); });
    X.generate('dl-potion', 14, 16, function (c) { c.fillStyle = '#ced4da'; c.fillRect(5, 1, 4, 4); var g = c.createRadialGradient(6, 9, 1, 7, 10, 6); g.addColorStop(0, '#b2f2bb'); g.addColorStop(1, '#2b8a3e'); c.fillStyle = g; c.beginPath(); c.arc(7, 10, 5.5, 0, 6.3); c.fill(); c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillRect(4, 7, 2, 2); });
    X.generate('dl-coin', 10, 10, function (c) { c.fillStyle = '#fab005'; c.beginPath(); c.arc(5, 5, 4.5, 0, 6.3); c.fill(); c.fillStyle = '#fff3bf'; c.fillRect(3, 2, 2, 2); });
    X.generate('dl-torch', 12, 20, function (c) { c.fillStyle = '#6b4423'; c.fillRect(5, 8, 3, 11); c.fillStyle = '#495057'; c.fillRect(3, 7, 7, 3); var g = c.createRadialGradient(6, 5, 0, 6, 5, 6); g.addColorStop(0, '#fff3bf'); g.addColorStop(0.5, '#ff922b'); g.addColorStop(1, 'rgba(255,80,0,0)'); c.fillStyle = g; c.beginPath(); c.arc(6, 5, 6, 0, 6.3); c.fill(); });
    X.generate('dl-stairs', 24, 24, function (c) { for (var i = 0; i < 5; i++) { c.fillStyle = ['#868e96', '#6c757d', '#495057', '#343a40', '#212529'][i]; c.fillRect(2 + i, 2 + i * 4, 20 - i * 2, 4); } c.strokeStyle = '#adb5bd'; c.strokeRect(1.5, 1.5, 21, 21); });
    X.generate('dl-lock', 24, 24, function (c) { c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(0, 0, 24, 24); c.strokeStyle = '#fcc419'; c.lineWidth = 2.5; c.beginPath(); c.arc(12, 9, 4.5, Math.PI, 0); c.stroke(); c.fillStyle = '#fcc419'; c.fillRect(6, 10, 12, 9); c.fillStyle = '#212529'; c.fillRect(11, 13, 2, 4); });
    X.generate('dl-slash', 36, 36, function (c) { c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 4; c.lineCap = 'round'; c.beginPath(); c.arc(8, 18, 20, -1.1, 1.1); c.stroke(); c.strokeStyle = 'rgba(165,216,255,0.6)'; c.lineWidth = 8; c.beginPath(); c.arc(8, 18, 16, -0.9, 0.9); c.stroke(); });
    // luz radial (se usa como textura del polígono de visibilidad)
    X.generate('dl-light', 256, 256, function (c) { var g = c.createRadialGradient(128, 128, 0, 128, 128, 128); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.12, 'rgba(255,255,255,0.9)'); g.addColorStop(0.4, 'rgba(255,255,255,0.42)'); g.addColorStop(0.72, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 256, 256); });
    X.generate('dl-reveal', 12, 12, function (c) { var g = c.createRadialGradient(6, 6, 0, 6, 6, 6); g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(0.6, 'rgba(0,0,0,0.2)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, 12, 12); });
    MG.glowTexture(scene, 'dl-glow', 64, 'rgba(255,255,255,1)');
    MG.glowTexture(scene, 'dl-spark', 8, 'rgba(255,255,255,1)');
    X.generate('dl-dot', 8, 8, function (c) { c.fillStyle = '#fff'; c.beginPath(); c.arc(4, 4, 4, 0, 6.3); c.fill(); });
    // con pixelArt todo se filtra 'nearest': las luces, brillos y la niebla deben ser suaves
    ['dl-light', 'dl-reveal', 'dl-glow', 'dl-spark', 'dl-dot'].forEach(function (k) { X.get(k).source.setScaleMode('linear'); });
    var A = scene.anims;
    if (!A.exists('dl-walk')) {
      A.create({ key: 'dl-walk', frames: A.generateFrameNumbers('dl-hero', { start: 0, end: 3 }), frameRate: 10, repeat: -1 });
      A.create({ key: 'dl-idle', frames: A.generateFrameNumbers('dl-hero', { frames: [0] }), frameRate: 1 });
      A.create({ key: 'dl-skel', frames: A.generateFrameNumbers('dl-skel', { start: 0, end: 1 }), frameRate: 5, repeat: -1 });
      A.create({ key: 'dl-bat', frames: A.generateFrameNumbers('dl-bat', { start: 0, end: 1 }), frameRate: 12, repeat: -1 });
    }
  }

  // ------------------------------------------------------------------ generación
  function generate(seed, floor) {
    var rng = new UG.RNG(seed + ':' + floor), grid = new Uint8Array(MW * MH), rooms = [];
    var target = 9 + Math.min(4, floor);
    for (var tries = 0; tries < 400 && rooms.length < target; tries++) {
      var w = rng.int(6, 12), h = rng.int(5, 8), x = rng.int(2, MW - w - 3), y = rng.int(2, MH - h - 3), ok = true;
      for (var k = 0; k < rooms.length; k++) { var o = rooms[k]; if (x < o.x + o.w + 2 && x + w + 2 > o.x && y < o.y + o.h + 2 && y + h + 2 > o.y) { ok = false; break; } }
      if (ok) rooms.push({ x: x, y: y, w: w, h: h, cx: Math.floor(x + w / 2), cy: Math.floor(y + h / 2) });
    }
    var carve = function (x, y) { if (x > 0 && y > 0 && x < MW - 1 && y < MH - 1) grid[y * MW + x] = 1; };
    rooms.forEach(function (r) { for (var yy = r.y; yy < r.y + r.h; yy++) for (var xx = r.x; xx < r.x + r.w; xx++) carve(xx, yy); });
    var corridor = function (a, b) {
      var x = a.cx, y = a.cy, horizFirst = rng.chance(0.5);
      var stepX = function () { while (x !== b.cx) { carve(x, y); carve(x, y + 1); x += x < b.cx ? 1 : -1; } };
      var stepY = function () { while (y !== b.cy) { carve(x, y); carve(x + 1, y); y += y < b.cy ? 1 : -1; } };
      if (horizFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
      carve(x, y); carve(x + 1, y + 1);
    };
    rooms.sort(function (a, b) { return a.cx - b.cx; });
    for (var i = 1; i < rooms.length; i++) corridor(rooms[i - 1], rooms[i]);
    for (var e = 0; e < 2; e++) corridor(rooms[rng.int(0, rooms.length - 1)], rooms[rng.int(0, rooms.length - 1)]);
    // tiles visibles
    var data = new Array(MW * MH), floorAt = function (x, y) { return x >= 0 && y >= 0 && x < MW && y < MH && grid[y * MW + x] === 1; };
    for (var ty = 0; ty < MH; ty++) for (var tx = 0; tx < MW; tx++) {
      var id;
      if (floorAt(tx, ty)) { var v = rng.float(); id = v < 0.02 ? T.RUNE : v < 0.1 ? T.F3 : v < 0.25 ? T.F2 : T.F1; }
      else if (floorAt(tx, ty + 1)) id = T.WF;
      else { var near = false; for (var dy = -1; dy <= 1 && !near; dy++) for (var dx = -1; dx <= 1; dx++) if (floorAt(tx + dx, ty + dy)) { near = true; break; } id = near ? T.WT : T.VOID; }
      data[ty * MW + tx] = id;
    }
    // BFS desde la sala inicial para elegir la salida más lejana
    var start = rooms[0], dist = new Int32Array(MW * MH).fill(-1), q = [start.cy * MW + start.cx]; dist[q[0]] = 0;
    while (q.length) { var c = q.shift(), cx = c % MW, cy = (c / MW) | 0; [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { var nx = cx + d[0], ny = cy + d[1], n = ny * MW + nx; if (floorAt(nx, ny) && dist[n] < 0) { dist[n] = dist[c] + 1; q.push(n); } }); }
    var exit = rooms.reduce(function (best, r) { return dist[r.cy * MW + r.cx] > dist[best.cy * MW + best.cx] ? r : best; }, rooms[1] || start);
    var spot = function (r) { return { x: rng.int(r.x + 1, r.x + r.w - 2), y: rng.int(r.y + 1, r.y + r.h - 2) }; };
    var others = rooms.filter(function (r) { return r !== start && r !== exit; });
    rng.shuffle(others);
    var items = [];
    for (var kk = 0; kk < 3; kk++) { var kr = others[kk % others.length]; var ks = spot(kr); items.push({ type: 'key', x: ks.x, y: ks.y }); }
    for (var p = 0; p < 2 + (floor % 2); p++) { var ps = spot(others[(p + 3) % others.length]); items.push({ type: 'potion', x: ps.x, y: ps.y }); }
    rooms.forEach(function (r) { if (r === start) return; for (var cc = 0; cc < 2; cc++) { var cs = spot(r); items.push({ type: 'coin', x: cs.x, y: cs.y }); } });
    var torches = [];
    rooms.forEach(function (r) { for (var t2 = 0; t2 < 2; t2++) { var tx2 = r.x + 1 + Math.floor((r.w - 2) * (t2 ? 0.8 : 0.2)); if (data[(r.y - 1) * MW + tx2] === T.WF) torches.push({ x: tx2, y: r.y - 1 }); } });
    var enemies = [];
    var ne = 3 + floor * 2;
    for (var en = 0; en < ne; en++) { var er = others.length ? others[en % others.length] : exit; var es = spot(er); enemies.push({ type: (en % 3 === 2 || floor >= 3 && en % 2) ? 'bat' : 'skel', x: es.x, y: es.y }); }
    return { data: data, rooms: rooms, start: start, exit: exit, items: items, torches: torches, enemies: enemies, grid: grid };
  }
  function mapJSON(d) {
    return { orientation: 'orthogonal', width: MW, height: MH, tilewidth: TS, tileheight: TS,
      tilesets: [{ firstgid: 1, name: 'dl-tiles', tilewidth: TS, tileheight: TS, tilecount: 7, columns: 7, imagewidth: TS * 7, imageheight: TS }],
      layers: [{ type: 'tilelayer', name: 'Mazmorra', width: MW, height: MH, data: d.data }] };
  }

  var Play = {
    key: 'Play',
    init: function (data) { this.floorN = (data && data.floor) || 1; this.carry = data || {}; },
    create: function () {
      var s = this; makeTextures(this);
      this.seed = qs.get('seed') || (this.carry.seed || String(Date.now() % 100000));
      var D = this.dungeon = generate(this.seed, this.floorN);
      this.cameras.main.setBackgroundColor(0x07060b);
      this.map = this.add.tilemap(mapJSON(D));
      this.layer = this.map.createLayer('Mazmorra'); this.layer.setCollision([T.WF, T.WT, T.VOID]);
      this.layer.cacheAsTexture = true; this.layer.cacheResolution = ZOOM; // capa estática: 1 textura en vez de ~2000 tiles por frame (clave para el minimapa y Canvas2D)
      this.hp = this.carry.hp || 5; this.maxHp = 5; this.gold = this.carry.gold || 0; this.keys = 0; this.over = false; this.invuln = 0; this.attackCd = 0; this.facing = { x: 1, y: 0 };
      var P = this.physics; P.world.setBounds(0, 0, MW * TS, MH * TS);
      // objetos
      this.items = P.add.group(); this.foes = P.add.group();
      D.items.forEach(function (it) {
        var o = s.items.create(it.x * TS + TS / 2, it.y * TS + TS / 2, 'dl-' + it.type); o.kind = it.type; o.body.setAllowGravity(false); o.depth = 5;
        s.tweens.add({ targets: o, y: o.y - 3, duration: 700 + s.rng.int(0, 300), yoyo: true, repeat: -1, ease: 'sineInOut' });
      });
      this.torches = D.torches.map(function (t) { var spr = s.add.image(t.x * TS + TS / 2, t.y * TS + 12, 'dl-torch'); spr.depth = 4; return { x: spr.x, y: (t.y + 1) * TS + 3, spr: spr, ph: s.rng.float() * 10 }; });
      var ex = D.exit;
      this.exit = this.add.image(ex.cx * TS + TS / 2, ex.cy * TS + TS / 2, 'dl-stairs'); this.exit.depth = 3;
      this.lock = this.add.image(this.exit.x, this.exit.y, 'dl-lock'); this.lock.depth = 3;
      D.enemies.forEach(function (e) {
        var o = s.foes.create(e.x * TS + TS / 2, e.y * TS + TS / 2, e.type === 'bat' ? 'dl-bat' : 'dl-skel', 0);
        o.kind = e.type; o.hp = e.type === 'bat' ? 1 : 2 + Math.floor(s.floorN / 2); o.stun = 0; o.wander = s.rng.angle(); o.t = s.rng.float() * 5; o.depth = 6;
        o.body.setAllowGravity(false).setSize(e.type === 'bat' ? 14 : 12, e.type === 'bat' ? 10 : 10, false).setOffset(e.type === 'bat' ? 5 : 4, e.type === 'bat' ? 3 : 12);
        o.play(e.type === 'bat' ? 'dl-bat' : 'dl-skel');
      });
      var st = D.start;
      this.hero = P.add.sprite(st.cx * TS + TS / 2, st.cy * TS + TS / 2, 'dl-hero', 0); this.hero.depth = 7;
      this.hero.body.setSize(12, 9, false).setOffset(4, 16).setCollideWorldBounds(true);
      P.add.collider(this.hero, this.layer);
      P.add.collider(this.foes, this.layer, null, function (f) { return f.kind !== 'bat'; });
      P.add.overlap(this.hero, this.items, function (h, it) { if (it.active) s.pick(it); });
      P.add.overlap(this.hero, this.foes, function (h, f) { if (f.active && f.stun <= 0) s.hurt(f); });
      this.slash = this.add.image(0, 0, 'dl-slash'); this.slash.visible = false; this.slash.blendMode = 'add'; this.slash.depth = 8;
      this.sparks = this.add.particles('dl-spark', { lifespan: { min: 300, max: 700 }, speed: { min: 30, max: 140 }, scale: { start: 1.2, end: 0 }, blendMode: 'add', frequency: -1, maxParticles: 600 }); this.sparks.depth = 9;
      this.embers = this.add.particles('dl-spark', { lifespan: { min: 500, max: 1100 }, speedY: { min: -40, max: -15 }, speedX: { min: -8, max: 8 }, scale: { start: 0.9, end: 0 }, color: [0xfff3bf, 0xff922b, 0xe8590c], blendMode: 'add', frequency: -1, maxParticles: 300 }); this.embers.depth = 9;
      // niebla de guerra: 1 píxel por tile, escalada x TS con filtrado lineal (bordes suaves)
      this.fog = this.add.renderTexture(0, 0, MW, MH, 1); this.fog.setOrigin(0, 0).setScale(TS); this.fog.depth = 50;
      this.fog.fill(0x000000, 1);
      this.explored = new Uint8Array(MW * MH);
      // luz: textura del tamaño de la vista, ambiente + luces aditivas, compuesta con multiply
      var cam = this.cameras.main; cam.setZoom(ZOOM).setBounds(0, 0, MW * TS, MH * TS).startFollow(this.hero, false, 0.14, 0.14);
      this.lowFx = this.game.rendererType === 'canvas';
      this.light = this.add.renderTexture(0, 0, Math.ceil(W / ZOOM) + 4, Math.ceil(H / ZOOM) + 4, this.lowFx ? 0.5 : 0.75);
      this.light.setOrigin(0, 0); this.light.depth = 60; this.light.blendMode = 'multiply';
      this.rays = this.lowFx ? 72 : 160;
      // todas las luces se dibujan en UNA pasada: un contenedor con mallas (antorchas + héroe) y brillos
      var lightTex = this.textures.get('dl-light'), mk = function (n) { var m = new UG.Mesh(lightTex, new Float32Array((n + 2) * 2), new Float32Array((n + 2) * 2)); m.blendMode = 'add'; return m; };
      this.lightBatch = new UG.Container();
      this.torches.forEach(function (tc) { tc.n = s.lowFx ? 24 : 40; tc.mesh = s.lightBatch.addChild(mk(tc.n)); tc.mesh.tint = 0xff8a2a; tc.dists = s.castDists(tc.x, tc.y, 150, tc.n); });
      this.lightMesh = this.lightBatch.addChild(mk(this.rays)); this.lightMesh.tint = 0xffd7a0;
      this.heroDists = new Float32Array(this.rays + 1);
      this.glows = [];
      if (!this.lowFx) cam.setFilters([new UG.VignetteFilter({ radius: 0.85, strength: 0.6 })]);
      // minimapa: segunda cámara que no ve la luz
      var mw = 196, mh = Math.round(mw * MH / MW);
      this.mini = this.cameras.add(W - mw - 14, 56, mw, mh, false, 'mini').setZoom(mw / (MW * TS)).setBackgroundColor(0x000000);
      this.mini.centerOn(MW * TS / 2, MH * TS / 2);
      this.mini.ignore([this.light, this.slash, this.sparks, this.embers]);
      this.marker = this.add.image(0, 0, 'dl-dot').setScale(3.5); this.marker.tint = 0x74c0fc; this.marker.depth = 70; cam.ignore(this.marker);
      this.exitMark = this.add.image(this.exit.x, this.exit.y, 'dl-dot').setScale(4); this.exitMark.tint = 0xfcc419; this.exitMark.depth = 70; this.exitMark.visible = false; cam.ignore(this.exitMark);
      var frame = this.add.hud.graphics(); frame.lineStyle(2, 0x9775fa, 0.8).strokeRect(W - mw - 15, 55, mw + 2, mh + 2);
      // HUD y controles
      this.hudT = MG.text(this, 70, 26, '', 20, 0xffffff, { hud: true, ox: 0 });
      this.floorT = MG.text(this, W / 2, 26, 'Piso ' + this.floorN, 22, 0xd0bfff, { hud: true });
      this.msgT = MG.text(this, W / 2, H - 40, '', 18, 0xfff3bf, { hud: true, stroke: 3, style: { fontWeight: 'normal' } });
      MG.hudButtons(this);
      this.keysIn = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys('W,A,S,D,J,K');
      this.input.keyboard.on('keydown-SPACE', function () { s.attack(); });
      this.input.keyboard.on('keydown-J', function () { s.attack(); });
      if (MG.isTouch) {
        this.joy = this.add.joystick({ x: 110, y: H - 110, radius: 58 });
        this.btnA = this.add.virtualButton({ x: W - 100, y: H - 100, radius: 46, label: '⚔', color: 0x7048e8 });
        this.btnA.on('down', function () { s.attack(); });
      }
      this.onPre = function () { s.buildLight(); };
      this.game.on('prerender', this.onPre);
      this.events.once('shutdown', function () { s.game.off('prerender', s.onPre); s.lightBatch.destroy({ children: true }); s.lightBatch = null; });
      this.refresh();
      this.say(this.floorN === 1 ? 'Encuentra las 3 llaves y baja por la escalera' : 'Piso ' + this.floorN + ': la oscuridad se espesa…');
      this.sound.addMusic('dl-music', { bpm: 72, tracks: [
        { wave: 'triangle', volume: 0.16, notes: 'A3 - C4 - E4 - D4 - C4 - B3 - G3 - A3 -' },
        { wave: 'sine', volume: 0.3, notes: 'A1 - - - - - - - F1 - - - - - - - G1 - - - - - - - E1 - - - - - - -' },
        { drums: true, volume: 0.12, notes: 'k . . . . . h . k . . . . . h .' }] });
      this.sound.playMusic('dl-music', { volume: 0.3, fadeIn: 1200 });
      cam.fadeIn(500);
    },
    say: function (t) { var m = this.msgT; m.text = t; m.alpha = 1; this.tweens.killTweensOf(m); this.tweens.add({ targets: m, alpha: 0, delay: 2600, duration: 600 }); },
    refresh: function () {
      var h = ''; for (var i = 0; i < this.maxHp; i++) h += i < this.hp ? '♥' : '♡';
      this.hudT.text = h + '   🗝 ' + this.keys + '/3   ● ' + this.gold;
    },
    // ---------------------------------------------------------------- luz y sombras
    /** Distancia libre en cada una de n+1 direcciones desde (x,y) hasta el primer muro (raycast DDA). */
    castDists: function (x, y, r, n, out) {
      out = out || new Float32Array(n + 1);
      var L = this.layer, W2 = this.physics.world;
      for (var i = 0; i <= n; i++) {
        var a = (i / n) * Math.PI * 2, hit = W2.raycastTiles(L, x, y, x + Math.cos(a) * r, y + Math.sin(a) * r);
        out[i] = hit ? Math.min(r, hit.distance + 6) : r; // penetra 6 px para iluminar la cara del muro
      }
      return out;
    },
    /** Rellena una Mesh en abanico (polígono de visibilidad) con UV radiales sobre la textura de luz. */
    fan: function (mesh, x, y, r, dists, n, ox, oy) {
      var v = mesh.vertices, uv = mesh.uvs;
      v[0] = x - ox; v[1] = y - oy; uv[0] = 0.5; uv[1] = 0.5;
      for (var i = 0; i <= n; i++) {
        var a = (i / n) * Math.PI * 2, d = Math.min(dists[i], r), cx = Math.cos(a) * d, cy = Math.sin(a) * d, k = (i + 1) * 2;
        v[k] = x + cx - ox; v[k + 1] = y + cy - oy; uv[k] = 0.5 + cx / (2 * r); uv[k + 1] = 0.5 + cy / (2 * r);
      }
      mesh.dirty = true; mesh.visible = true;
      return mesh;
    },
    glow: function (i, x, y, tint, scale, alpha) {
      var g = this.glows[i];
      if (!g) { g = this.glows[i] = this.lightBatch.addChild(new UG.Sprite(0, 0, 'dl-glow')); g.blendMode = 'add'; }
      g.visible = true; g.x = x; g.y = y; g.tint = tint; g.setScale(scale); g.alpha = alpha;
      return i + 1;
    },
    buildLight: function () {
      if (!this.light || this.light.destroyed || !this.lightBatch) return;
      var cam = this.cameras.main; cam.preRender(this.game.renderer);
      var wv = cam.worldView, ox = Math.floor(wv.x) - 2, oy = Math.floor(wv.y) - 2, L = this.light, t = this.time.now;
      L.x = ox; L.y = oy;
      L.fill(0x0f0d1e, 1);
      // antorchas: polígono precalculado (son fijas), solo cambia el radio con el parpadeo
      for (var i = 0; i < this.torches.length; i++) {
        var tc = this.torches[i];
        if (tc.x < wv.x - 160 || tc.x > wv.right + 160 || tc.y < wv.y - 160 || tc.y > wv.bottom + 160) { tc.mesh.visible = false; continue; }
        var fl = 1 + Math.sin(t / 90 + tc.ph) * 0.05 + Math.sin(t / 37 + tc.ph * 2) * 0.03;
        this.fan(tc.mesh, tc.x, tc.y, 135 * fl, tc.dists, tc.n, ox, oy);
      }
      // antorcha del héroe: raycast cada frame
      var h = this.hero, rad = 175 + Math.sin(t / 120) * 4 + Math.sin(t / 47) * 2, hy = h.y - 4;
      this.castDists(h.x, hy, rad, this.rays, this.heroDists);
      this.fan(this.lightMesh, h.x, hy, rad, this.heroDists, this.rays, ox, oy);
      // brillos pequeños sin sombra: llaves, pociones, ojos de enemigos, escalera
      var n = 0, self = this;
      this.items.getChildren().forEach(function (it) { if (it.active) n = self.glow(n, it.x - ox, it.y - oy, it.kind === 'key' ? 0xfcc419 : it.kind === 'potion' ? 0x69db7c : 0xffd43b, it.kind === 'coin' ? 0.5 : 0.9, 0.7); });
      this.foes.getChildren().forEach(function (f) { if (f.active) n = self.glow(n, f.x - ox, f.y - 6 - oy, f.kind === 'bat' ? 0x9775fa : 0xff6b6b, 0.45, 0.6); });
      n = this.glow(n, this.exit.x - ox, this.exit.y - oy, this.keys >= 3 ? 0x74c0fc : 0x5c7cfa, 1.4, 0.8);
      for (var j = n; j < this.glows.length; j++) this.glows[j].visible = false;
      L.draw(this.lightBatch);
    },
    // ---------------------------------------------------------------- juego
    pick: function (it) {
      var k = it.kind;
      if (k === 'coin') { this.gold += 10; this.sound.playSfx({ preset: 'coin', seed: 3 }, { volume: 0.25 }); }
      else if (k === 'potion') { if (this.hp >= this.maxHp) return; this.hp = Math.min(this.maxHp, this.hp + 2); this.sound.playSfx({ preset: 'powerup', seed: 8 }, { volume: 0.35 }); MG.floatText(this, it.x, it.y - 10, '+2 ♥', 0x69db7c, 12); }
      else if (k === 'key') {
        this.keys++; this.sound.playSfx({ preset: 'pickup', seed: 17 }, { volume: 0.4 });
        this.say(this.keys >= 3 ? '¡Tienes las 3 llaves! Busca la escalera' : 'Llave ' + this.keys + ' de 3');
        if (this.keys >= 3) { this.tweens.add({ targets: this.lock, alpha: 0, scaleX: 2, scaleY: 2, duration: 500 }); this.exitMark.visible = true; }
      }
      this.sparks.setParticleTint(k === 'potion' ? 0x69db7c : 0xfcc419); this.sparks.explode(10, it.x, it.y);
      this.tweens.killTweensOf(it); it.destroy();
      this.refresh();
    },
    attack: function () {
      if (this.attackCd > 0 || this.over) return;
      this.attackCd = 320;
      var h = this.hero, f = this.facing, s = this, ax = h.x + f.x * 16, ay = h.y - 4 + f.y * 16;
      this.slash.visible = true; this.slash.x = ax; this.slash.y = ay; this.slash.rotation = Math.atan2(f.y, f.x); this.slash.alpha = 1; this.slash.setScale(0.6);
      this.tweens.killTweensOf(this.slash);
      this.tweens.add({ targets: this.slash, alpha: 0, scaleX: 1.1, scaleY: 1.1, duration: 180, onComplete: function () { s.slash.visible = false; } });
      this.sound.playSfx({ preset: 'shoot', seed: 40 }, { volume: 0.22, rate: 0.7 });
      this.foes.getChildren().slice().forEach(function (e) {
        if (!e.active) return;
        var dx = e.x - ax, dy = (e.y - 6) - ay;
        if (dx * dx + dy * dy > 26 * 26) return;
        e.hp--; e.stun = 350; e.tint = 0xff8787;
        var d = Math.hypot(e.x - h.x, e.y - h.y) || 1; e.body.setVelocity((e.x - h.x) / d * 260, (e.y - h.y) / d * 260);
        s.sparks.setParticleTint([0xffffff, e.kind === 'bat' ? 0x9775fa : 0xe9ecef]); s.sparks.explode(8, e.x, e.y - 6);
        s.cameras.main.shake(70, 0.004);
        if (e.hp <= 0) {
          s.sparks.explode(18, e.x, e.y - 6);
          s.gold += e.kind === 'bat' ? 5 : 15;
          s.sound.playSfx({ preset: 'explosion', seed: 22 }, { volume: 0.25, rate: 1.6 });
          if (s.rng.chance(0.25)) { var c = s.items.create(e.x, e.y, 'dl-coin'); c.kind = 'coin'; c.body.setAllowGravity(false); c.depth = 5; }
          e.destroy(); s.refresh();
        } else s.sound.playSfx({ preset: 'hit', seed: 31 }, { volume: 0.25 });
      });
    },
    hurt: function (f) {
      if (this.invuln > 0 || this.over) return;
      this.hp--; this.invuln = 1100; this.refresh();
      var h = this.hero, d = Math.hypot(h.x - f.x, h.y - f.y) || 1;
      h.body.setVelocity((h.x - f.x) / d * 240, (h.y - f.y) / d * 240); this.knock = 160;
      this.cameras.main.shake(220, 0.012); this.cameras.main.flash(150, 0xff0000, 0.35);
      this.sound.playSfx({ preset: 'hurt', seed: 5 }, { volume: 0.45 });
      if (this.hp <= 0) {
        this.over = true; var s = this;
        h.tint = 0xff6b6b; h.body.setVelocity(0, 0); this.tweens.add({ targets: h, rotation: Math.PI / 2, alpha: 0.4, duration: 600 });
        this.sound.stopMusic(800);
        this.say('Has caído en el piso ' + this.floorN);
        this.time.delayedCall(1800, function () { s.scene.start('GameOver', { score: s.gold + (s.floorN - 1) * 250 }); });
      }
    },
    descend: function () {
      if (this.over || this.keys < 3) return;
      this.over = true; var s = this;
      this.sound.playSfx({ preset: 'powerup', seed: 64 }, { volume: 0.5, rate: 0.8 });
      this.hero.body.setVelocity(0, 0);
      this.tweens.add({ targets: this.hero, x: this.exit.x, y: this.exit.y, scaleX: 0.3, scaleY: 0.3, rotation: 6, duration: 700 });
      this.cameras.main.fadeOut(800, 0x000000, true, function () { s.scene.restart({ floor: s.floorN + 1, hp: s.hp, gold: s.gold + 100, seed: s.seed }); });
    },
    update: function (t, dt) {
      if (!this.hero || this.over) return;
      var s = this, h = this.hero, k = this.keysIn, w = this.wasd, j = this.joy, sec = dt / 1000;
      this.attackCd -= dt; this.invuln -= dt; if (this.knock > 0) this.knock -= dt;
      // movimiento 8 direcciones
      var mx = 0, my = 0;
      if (k.left.isDown || w.A.isDown) mx -= 1; if (k.right.isDown || w.D.isDown) mx += 1;
      if (k.up.isDown || w.W.isDown) my -= 1; if (k.down.isDown || w.S.isDown) my += 1;
      if (j && j.force > 0.15) { mx = j.forceX; my = j.forceY; }
      var len = Math.hypot(mx, my);
      if (!(this.knock > 0)) {
        if (len > 0.1) { mx /= Math.max(1, len); my /= Math.max(1, len); h.body.setVelocity(mx * 130, my * 130); this.facing = { x: mx / (len > 1 ? 1 : len || 1), y: my / (len > 1 ? 1 : len || 1) }; h.play('dl-walk', true); if (Math.abs(mx) > 0.2) h.flipX = mx < 0; }
        else { h.body.setVelocity(0, 0); h.play('dl-idle', true); }
      }
      h.alpha = this.invuln > 0 ? (Math.floor(t / 80) % 2 ? 0.35 : 1) : 1;
      // niebla y minimapa
      var ptx = Math.floor(h.x / TS), pty = Math.floor(h.y / TS);
      this.fog.stamp('dl-reveal', undefined, h.x / TS, h.y / TS, { blendMode: 'erase', scale: 1.2 });
      for (var dy = -5; dy <= 5; dy++) for (var dx = -5; dx <= 5; dx++) { var ex = ptx + dx, ey = pty + dy; if (ex >= 0 && ey >= 0 && ex < MW && ey < MH && dx * dx + dy * dy <= 25) this.explored[ey * MW + ex] = 1; }
      this.marker.x = h.x; this.marker.y = h.y;
      if (!this.exitMark.visible && this.explored[Math.floor(this.exit.y / TS) * MW + Math.floor(this.exit.x / TS)]) this.exitMark.visible = true;
      // enemigos: deambulan y persiguen con línea de visión
      var L = this.layer, world = this.physics.world;
      this.foes.getChildren().forEach(function (e) {
        if (!e.active) return;
        e.t += sec;
        if (e.stun > 0) { e.stun -= dt; if (e.stun <= 0) e.tint = 0xffffff; return; }
        var dx2 = h.x - e.x, dy2 = h.y - e.y, d = Math.hypot(dx2, dy2), sees = false;
        if (d < (e.kind === 'bat' ? 170 : 220)) sees = !world.raycastTiles(L, e.x, e.y - 6, h.x, h.y - 6);
        var sp;
        if (sees) { sp = e.kind === 'bat' ? 105 : 72 + s.floorN * 4; var wob = e.kind === 'bat' ? Math.sin(e.t * 9) * 0.6 : 0; var a = Math.atan2(dy2, dx2) + wob; e.body.setVelocity(Math.cos(a) * sp, Math.sin(a) * sp); }
        else {
          sp = e.kind === 'bat' ? 60 : 32;
          if (e.body.blocked.left || e.body.blocked.right || e.body.blocked.up || e.body.blocked.down || s.rng.chance(0.01)) e.wander = s.rng.angle();
          e.body.setVelocity(Math.cos(e.wander) * sp, Math.sin(e.wander) * sp);
        }
        if (e.kind === 'bat') { var tx = Math.floor(e.x / TS), ty = Math.floor(e.y / TS); if (L.collidesAt(tx, ty)) { e.wander += Math.PI; e.body.setVelocity(-e.body.velocity.x, -e.body.velocity.y); } }
        e.flipX = e.body.velocity.x < 0;
      });
      // brasas de antorchas visibles
      var cam = this.cameras.main;
      if (this.rng.chance(0.5)) { var tc = this.torches[this.rng.int(0, this.torches.length - 1)]; if (tc && cam.worldView.contains(tc.x, tc.y)) this.embers.emitParticle(1, tc.x + this.rng.between(-2, 2), tc.spr.y - 6); }
      this.torches.forEach(function (tc2) { tc2.spr.scaleY = 1 + Math.sin(t / 70 + tc2.ph) * 0.08; });
      // escalera
      if (this.keys >= 3 && Math.hypot(h.x - this.exit.x, h.y - this.exit.y) < 14) this.descend();
      else if (this.keys < 3 && Math.hypot(h.x - this.exit.x, h.y - this.exit.y) < 16 && !this._lockMsg) { this._lockMsg = true; this.say('La escalera está cerrada: faltan ' + (3 - this.keys) + ' llaves'); var s2 = this; this.time.delayedCall(3000, function () { s2._lockMsg = false; }); }
    }
  };

  MG.start({
    title: 'Dungeon Lights', width: W, height: H, backgroundColor: 0x050508, pixelArt: true,
    physics: { arcade: { gravity: { y: 0 } } },
    scenes: [
      MG.menu({ id: 'dungeon-lights', title: 'DUNGEON LIGHTS', subtitle: 'Explora la mazmorra con tu antorcha', glow: '#fd7e14', titleColors: [0xfff3bf, 0xff922b], buttonColor: 0x7048e8,
        help: 'WASD / flechas para moverte · Espacio o J para atacar\nReúne 3 llaves en cada piso y baja por la escalera. Cada piso es nuevo.',
        touchHelp: 'Joystick para moverte · ⚔ para atacar · 3 llaves abren la escalera',
        background: function (s) {
          makeTextures(s); s.cameras.main.setBackgroundColor(0x050508);
          var D = generate('menu', 1), map = s.add.tilemap(mapJSON(D)), l = map.createLayer('Mazmorra'); l.alpha = 0.25; l.setScale(0.72); l.x = (W - MW * TS * 0.72) / 2; l.y = 40;
          var glow = s.add.image(W / 2, H * 0.44, 'dl-glow').setScale(6); glow.tint = 0xff922b; glow.alpha = 0.35; glow.blendMode = 'add';
          s.tweens.add({ targets: glow, alpha: 0.2, scaleX: 5.4, scaleY: 5.4, duration: 900, yoyo: true, repeat: -1, ease: 'sineInOut' });
          var hero = s.add.sprite(W / 2, H * 0.44, 'dl-hero').setScale(3); hero.play('dl-walk');
        } }),
      Play,
      MG.gameOver({ id: 'dungeon-lights', background: function (s) { makeTextures(s); s.cameras.main.setBackgroundColor(0x050508); } })]
  });
})();
