/* Gem Match — puzle match-3 en rejilla. Prueba: entrada táctil (arrastrar o tocar), teclado accesible,
 * flujo asíncrono con promesas de tweens, cascadas, gemas especiales (línea, bomba, arcoíris), recorte
 * del tablero (clipRect), RNG con semilla (?seed=), pistas, barajado sin callejones y contrarreloj. */
(function () {
  'use strict';
  var W = 720, H = 1000, N = 8, CELL = 80, BX = (W - N * CELL) / 2, BY = 250, KINDS = 6, TIME = 90;
  var COLORS = [[0xff6b6b, 0xc92a2a], [0xffa94d, 0xd9480f], [0xffe066, 0xe67700], [0x69db7c, 0x2b8a3e], [0x4dabf7, 0x1864ab], [0xda77f2, 0x862e9c]];
  var SHAPES = ['circle', 'hex', 'star', 'square', 'diamond', 'tri'];
  var qs = new URLSearchParams(location.search);
  var hx = function (c) { return UG.Color.toHex(c); };

  function rrect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function shapePath(c, shape, cx, cy, r) {
    if (shape === 'circle') { c.beginPath(); c.arc(cx, cy, r * 0.92, 0, Math.PI * 2); return; }
    if (shape === 'square') { rrect(c, cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6, r * 0.28); return; }
    var n = { hex: 6, tri: 3, diamond: 4, star: 10 }[shape], rot = shape === 'hex' ? Math.PI / 6 : -Math.PI / 2;
    c.beginPath();
    for (var i = 0; i < n; i++) {
      var a = rot + i / n * Math.PI * 2, rr = shape === 'star' ? (i % 2 ? r * 0.52 : r) : (shape === 'tri' ? r * 1.12 : r);
      var x = cx + Math.cos(a) * rr * (shape === 'diamond' ? 0.86 : 1), y = cy + Math.sin(a) * rr + (shape === 'tri' ? r * 0.22 : 0);
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.closePath();
  }
  function drawGem(c, k, S) {
    var cx = S / 2, cy = S / 2, r = S * 0.4, col = COLORS[k], sh = SHAPES[k];
    c.save(); c.translate(0, 3); shapePath(c, sh, cx, cy, r); c.fillStyle = 'rgba(0,0,0,0.35)'; c.fill(); c.restore();
    var g = c.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.1, cx, cy, r * 1.15);
    g.addColorStop(0, hx(UG.Color.brighten(col[0], 0.55))); g.addColorStop(0.45, hx(col[0])); g.addColorStop(1, hx(col[1]));
    shapePath(c, sh, cx, cy, r); c.fillStyle = g; c.fill();
    c.lineWidth = 2.5; c.strokeStyle = hx(UG.Color.darken(col[1], 0.3)); c.lineJoin = 'round'; c.stroke();
    c.save(); shapePath(c, sh, cx, cy, r); c.clip();
    c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.ellipse(cx - r * 0.25, cy - r * 0.45, r * 0.6, r * 0.32, -0.4, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.12)'; c.beginPath(); c.ellipse(cx + r * 0.3, cy + r * 0.55, r * 0.8, r * 0.35, -0.4, 0, Math.PI * 2); c.fill();
    c.restore();
    // destello
    c.fillStyle = '#fff'; c.beginPath(); var sx = cx - r * 0.42, sy = cy - r * 0.42;
    c.moveTo(sx, sy - 6); c.lineTo(sx + 1.6, sy - 1.6); c.lineTo(sx + 6, sy); c.lineTo(sx + 1.6, sy + 1.6); c.lineTo(sx, sy + 6); c.lineTo(sx - 1.6, sy + 1.6); c.lineTo(sx - 6, sy); c.lineTo(sx - 1.6, sy - 1.6); c.closePath(); c.fill();
  }
  function drawSpecial(c, k, sp, S) {
    var cx = S / 2, cy = S / 2, r = S * 0.4;
    c.save(); shapePath(c, SHAPES[k], cx, cy, r); c.clip();
    c.fillStyle = 'rgba(255,255,255,0.75)';
    if (sp === 'h') for (var i = -1; i <= 1; i++) c.fillRect(0, cy + i * 11 - 3, S, 5);
    if (sp === 'v') for (var j = -1; j <= 1; j++) c.fillRect(cx + j * 11 - 3, 0, 5, S);
    c.restore();
    if (sp === 'b') {
      c.save(); c.shadowColor = '#fff'; c.shadowBlur = 12; c.strokeStyle = '#fff'; c.lineWidth = 4; c.beginPath(); c.arc(cx, cy, r * 0.55, 0, Math.PI * 2); c.stroke(); c.restore();
      c.fillStyle = 'rgba(255,255,255,0.9)'; c.beginPath(); c.arc(cx, cy, r * 0.18, 0, Math.PI * 2); c.fill();
    }
  }
  function makeTextures(scene) {
    var T = scene.textures, S = 72;
    if (T.exists('gm0')) return;
    for (var k = 0; k < KINDS; k++) {
      (function (k) {
        T.generate('gm' + k, S, S, function (c) { drawGem(c, k, S); });
        ['h', 'v', 'b'].forEach(function (sp) { T.generate('gm' + k + sp, S, S, function (c) { drawGem(c, k, S); drawSpecial(c, k, sp, S); }); });
      })(k);
    }
    T.generate('gm-rainbow', S, S, function (c) {
      var cx = S / 2, cy = S / 2, r = S * 0.38;
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.arc(cx, cy + 3, r, 0, Math.PI * 2); c.fill();
      for (var i = 0; i < 12; i++) { c.fillStyle = hx(COLORS[i % 6][0]); c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, r, i / 12 * Math.PI * 2, (i + 1) / 12 * Math.PI * 2 + 0.02); c.closePath(); c.fill(); }
      var g = c.createRadialGradient(cx - 6, cy - 8, 2, cx, cy, r); g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(40,0,60,0.35)');
      c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#fff'; c.lineWidth = 2.5; c.stroke();
    });
    T.generate('gm-beam', 64, 16, function (c) { var g = c.createLinearGradient(0, 0, 0, 16); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 16); });
    MG.glowTexture(scene, 'gm-spark', 20, 'rgba(255,255,255,1)');
    T.generate('gm-star', 24, 24, function (c) { c.fillStyle = '#fff'; c.beginPath(); for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i / 10 * Math.PI * 2, rr = i % 2 ? 4.5 : 11; c.lineTo(12 + Math.cos(a) * rr, 12 + Math.sin(a) * rr); } c.closePath(); c.fill(); });
  }
  function background(scene) {
    var g = scene.add.graphics();
    g.fillGradientStyle(0x2b1055, 0x2b1055, 0x0d0629, 0x120a3a, 1).fillRect(0, 0, W, H);
    g.depth = -20; g.cacheAsTexture = true;
    var bokeh = scene.add.particles('gm-spark', { emitZone: { source: new UG.Rectangle(0, 0, W, H), type: 'random' }, lifespan: { min: 4000, max: 8000 }, speedY: { min: -18, max: -6 }, speedX: { min: -6, max: 6 }, scale: { start: 1.6, end: 2.6 }, alpha: { start: 0.0, end: 0.35 }, color: [0xda77f2, 0x74c0fc, 0xffffff], blendMode: 'add', frequency: 180, maxParticles: 60 });
    bokeh.depth = -19;
    for (var i = 0; i < 40; i++) bokeh.update(180);
  }

  var Play = {
    key: 'Play',
    create: function () {
      var s = this; makeTextures(this); background(this);
      this.gen = (this.gen || 0) + 1;
      this.rngB = new UG.RNG(qs.get('seed') || undefined);
      this.score = 0; this.shown = 0; this.timeLeft = TIME; this.busy = true; this.over = false; this.idle = 0; this.selected = -1; this.cursor = { r: 3, c: 3 }; this.moves = 0; this.bestCascade = 0;
      // tablero
      var bg = this.add.graphics();
      bg.fillStyle(0x000000, 0.35).fillRoundedRect(BX - 14, BY - 14, N * CELL + 28, N * CELL + 28, 26);
      bg.lineStyle(3, 0xffffff, 0.18).strokeRoundedRect(BX - 14, BY - 14, N * CELL + 28, N * CELL + 28, 26);
      for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) bg.fillStyle((r + c) % 2 ? 0x8f6bff : 0xb197fc, (r + c) % 2 ? 0.12 : 0.2).fillRoundedRect(BX + c * CELL + 3, BY + r * CELL + 3, CELL - 6, CELL - 6, 14);
      bg.cacheAsTexture = true;
      this.board = this.add.container(BX, BY);
      this.board.setClip(-6, -6, N * CELL + 12, N * CELL + 12);
      this.sel = this.add.graphics(); this.sel.lineStyle(4, 0xffffff, 0.95).strokeRoundedRect(-CELL / 2 + 4, -CELL / 2 + 4, CELL - 8, CELL - 8, 16); this.sel.visible = false; this.sel.depth = 5;
      this.cur = this.add.graphics(); this.cur.lineStyle(3, 0xffe066, 0.9).strokeRoundedRect(-CELL / 2 + 2, -CELL / 2 + 2, CELL - 4, CELL - 4, 18); this.cur.visible = false; this.cur.depth = 5;
      this.tweens.add({ targets: this.sel, alpha: 0.35, duration: 380, yoyo: true, repeat: -1 });
      this.sparks = this.add.particles('gm-spark', { lifespan: { min: 300, max: 700 }, speed: { min: 80, max: 320 }, scale: { start: 1.1, end: 0 }, blendMode: 'add', frequency: -1, gravityY: 500, maxParticles: 2000 });
      this.stars = this.add.particles('gm-star', { lifespan: { min: 500, max: 900 }, speed: { min: 40, max: 180 }, scale: { start: 0.9, end: 0 }, rotationSpeed: { min: -300, max: 300 }, frequency: -1, maxParticles: 400 });
      this.sparks.depth = 10; this.stars.depth = 10;
      // rejilla lógica
      this.grid = new Array(N * N);
      this.fillBoard();
      // HUD
      this.scoreT = MG.text(this, W / 2, 128, '0', 58, 0xffffff, { hud: true, stroke: 6, style: { fill: [0xffffff, 0xffe066] } });
      MG.text(this, W / 2, 82, 'PUNTOS', 18, 0xd0bfff, { hud: true, stroke: 3 });
      this.timeBar = this.add.hud.graphics();
      this.timeT = MG.text(this, W / 2, 196, '', 20, 0xffffff, { hud: true, stroke: 3 });
      this.comboT = MG.text(this, W / 2, BY + N * CELL + 70, '', 40, 0xffe066, { hud: true, stroke: 6 }); this.comboT.alpha = 0;
      MG.text(this, W / 2, H - 50, MG.isTouch ? 'Desliza una gema para intercambiarla' : 'Arrastra o haz clic en dos gemas · Flechas + Espacio', 17, 0xb9a8ff, { hud: true, stroke: 3, style: { fontWeight: 'normal' } });
      MG.hudButtons(this);
      // entrada
      this.input.on('pointerdown', function (p) { s.onDown(p); });
      this.input.on('pointermove', function (p) { s.onMove(p); });
      this.input.on('pointerup', function (p) { s.onUp(p); });
      var kb = this.input.keyboard;
      [['LEFT', 0, -1], ['RIGHT', 0, 1], ['UP', -1, 0], ['DOWN', 1, 0]].forEach(function (d) { kb.on('keydown-' + d[0], function () { s.onArrow(d[1], d[2]); }); });
      kb.on('keydown-SPACE', function () { s.onKeySelect(); }); kb.on('keydown-ENTER', function () { s.onKeySelect(); });
      this.sound.addMusic('gm-music', { bpm: 96, tracks: [
        { wave: 'triangle', volume: 0.18, notes: 'C4 E4 G4 B4 A4 G4 E4 G4 F4 A4 C5 A4 G4 E4 D4 E4' },
        { wave: 'sine', volume: 0.3, notes: 'C3 - - - A2 - - - F2 - - - G2 - - -' },
        { drums: true, volume: 0.22, notes: 'k . h . s . h . k . h k s . h .' }] });
      this.sound.playMusic('gm-music', { volume: 0.3, fadeIn: 800 });
      this.drawTime();
      // entrada animada del tablero
      var list = this.grid.map(function (g) { return g.spr; });
      list.forEach(function (sp) { sp.targetY = sp.y; sp.y -= N * CELL + 60; });
      this.tweens.add({ targets: list, y: function (t) { return t.targetY; }, duration: 520, ease: 'bounceOut', delay: this.tweens.stagger(22, { grid: [N, N], from: 'last' }), onComplete: function () { s.busy = false; } });
    },
    alive: function (gen) { return this.gen === gen && this.sys.status !== 'shutdown' && !this.over; },
    cellPos: function (i) { return { x: (i % N) * CELL + CELL / 2, y: Math.floor(i / N) * CELL + CELL / 2 }; },
    kindAt: function (i) { var g = this.grid[i]; return g && g.sp !== 'r' ? g.kind : -1; },
    makeGem: function (i, kind, sp) {
      var p = this.cellPos(i), key = sp === 'r' ? 'gm-rainbow' : 'gm' + kind + (sp || '');
      var spr = this.add.image(p.x, p.y, key); this.board.add(spr);
      var g = { kind: sp === 'r' ? -1 : kind, sp: sp || '', spr: spr };
      if (sp === 'r') this.tweens.add({ targets: spr, rotation: Math.PI * 2, duration: 3000, repeat: -1 });
      this.grid[i] = g; return g;
    },
    fillBoard: function () {
      for (var i = 0; i < N * N; i++) {
        var r = Math.floor(i / N), c = i % N, k, tries = 0;
        do { k = this.rngB.int(0, KINDS - 1); tries++; }
        while (tries < 50 && ((c >= 2 && this.kindAt(i - 1) === k && this.kindAt(i - 2) === k) || (r >= 2 && this.kindAt(i - N) === k && this.kindAt(i - 2 * N) === k)));
        this.makeGem(i, k);
      }
      if (!this.findMove()) { this.grid.forEach(function (g) { g.spr.destroy(); }); this.fillBoard(); }
    },
    toCell: function (x, y) { var c = Math.floor((x - BX) / CELL), r = Math.floor((y - BY) / CELL); return c >= 0 && r >= 0 && c < N && r < N ? r * N + c : -1; },
    adjacent: function (a, b) { var ra = Math.floor(a / N), rb = Math.floor(b / N); return (ra === rb && Math.abs(a - b) === 1) || Math.abs(a - b) === N; },
    // ---------------------------------------------------------------- entrada
    onDown: function (p) { if (this.busy || this.over) return; var i = this.toCell(p.x, p.y); if (i < 0) return; this.down = { i: i, x: p.x, y: p.y }; this.idle = 0; this.cur.visible = false; },
    onMove: function (p) {
      var d = this.down; if (!d || !p.isDown || this.busy) return;
      var dx = p.x - d.x, dy = p.y - d.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 26) return;
      var r = Math.floor(d.i / N), c = d.i % N;
      if (Math.abs(dx) > Math.abs(dy)) c += dx > 0 ? 1 : -1; else r += dy > 0 ? 1 : -1;
      this.down = null;
      if (r >= 0 && c >= 0 && r < N && c < N) this.trySwap(d.i, r * N + c);
    },
    onUp: function (p) {
      var d = this.down; this.down = null;
      if (!d || this.busy) return;
      this.tapCell(d.i);
    },
    tapCell: function (i) {
      if (this.selected >= 0 && this.adjacent(this.selected, i)) { var a = this.selected; this.select(-1); this.trySwap(a, i); return; }
      this.select(this.selected === i ? -1 : i);
      this.sound.playSfx('select', { volume: 0.25 });
    },
    select: function (i) {
      this.selected = i; this.sel.visible = i >= 0;
      if (i >= 0) { var p = this.cellPos(i); this.sel.x = BX + p.x; this.sel.y = BY + p.y; }
    },
    onArrow: function (dr, dc) {
      if (this.over) return;
      var cu = this.cursor; this.idle = 0;
      if (this.selected >= 0 && !this.busy) {
        var r = Math.floor(this.selected / N) + dr, c = this.selected % N + dc;
        if (r >= 0 && c >= 0 && r < N && c < N) { var a = this.selected; this.select(-1); cu.r = r; cu.c = c; this.placeCursor(); this.trySwap(a, r * N + c); }
        return;
      }
      cu.r = UG.Math.clamp(cu.r + dr, 0, N - 1); cu.c = UG.Math.clamp(cu.c + dc, 0, N - 1); this.placeCursor();
    },
    placeCursor: function () { var p = this.cellPos(this.cursor.r * N + this.cursor.c); this.cur.visible = true; this.cur.x = BX + p.x; this.cur.y = BY + p.y; },
    onKeySelect: function () { if (this.busy || this.over) return; this.placeCursor(); this.tapCell(this.cursor.r * N + this.cursor.c); },
    // ---------------------------------------------------------------- lógica
    tw: function (cfg) { return this.tweens.add(cfg).finished; },
    swapData: function (a, b) { var t = this.grid[a]; this.grid[a] = this.grid[b]; this.grid[b] = t; },
    animSwap: function (a, b, dur) {
      var pa = this.cellPos(a), pb = this.cellPos(b), ga = this.grid[a], gb = this.grid[b];
      return Promise.all([this.tw({ targets: ga.spr, x: pa.x, y: pa.y, duration: dur, ease: 'quadInOut' }), this.tw({ targets: gb.spr, x: pb.x, y: pb.y, duration: dur, ease: 'quadInOut' })]);
    },
    trySwap: async function (a, b) {
      if (this.busy || this.over || !this.adjacent(a, b)) return;
      var gen = this.gen; this.busy = true; this.idle = 0; this.stopHint();
      var ga = this.grid[a], gb = this.grid[b];
      this.swapData(a, b);
      this.sound.playSfx({ preset: 'blip', seed: 8 }, { volume: 0.2, rate: 1.4 });
      await this.animSwap(a, b, 150);
      if (!this.alive(gen)) return;
      if (ga.sp === 'r' || gb.sp === 'r') {
        this.moves++;
        var set = new Set(), other = ga.sp === 'r' ? gb : ga;
        if (ga.sp === 'r' && gb.sp === 'r') for (var q = 0; q < N * N; q++) set.add(q);
        else { var ri = ga.sp === 'r' ? b : a; set.add(ri); for (var j = 0; j < N * N; j++) if (this.kindAt(j) === other.kind) set.add(j); if (other.sp) set.add(ga.sp === 'r' ? a : b); }
        this.rainbowFx(ga.sp === 'r' ? b : a, set);
        await this.resolve(gen, { cells: set, runs: [] }, null);
        return;
      }
      var m = this.findMatches();
      if (!m.cells.size) {
        this.swapData(a, b);
        this.sound.playSfx({ preset: 'hit', seed: 2 }, { volume: 0.2 });
        await this.animSwap(a, b, 150);
        if (this.alive(gen)) this.busy = false;
        return;
      }
      this.moves++;
      await this.resolve(gen, m, [a, b]);
    },
    findMatches: function () {
      var runs = [], cells = new Set(), self = this;
      var scan = function (dir) {
        for (var o = 0; o < N; o++) {
          var t = 0;
          while (t < N) {
            var i0 = dir === 'h' ? o * N + t : t * N + o, k = self.kindAt(i0), len = 1;
            while (t + len < N && k >= 0 && self.kindAt(dir === 'h' ? o * N + t + len : (t + len) * N + o) === k) len++;
            if (k >= 0 && len >= 3) { var run = { dir: dir, cells: [] }; for (var q = 0; q < len; q++) { var ci = dir === 'h' ? o * N + t + q : (t + q) * N + o; run.cells.push(ci); cells.add(ci); } runs.push(run); }
            t += len;
          }
        }
      };
      scan('h'); scan('v');
      return { runs: runs, cells: cells };
    },
    /** Decide qué gemas especiales nacen de las combinaciones */
    specials: function (m, swap) {
      var out = [], count = {}, taken = new Set();
      m.runs.forEach(function (r) { r.cells.forEach(function (c) { count[c] = (count[c] || 0) + 1; }); });
      var self = this;
      Object.keys(count).forEach(function (c) { if (count[c] > 1) { c = +c; out.push({ i: c, kind: self.kindAt(c), sp: 'b' }); taken.add(c); } });
      m.runs.forEach(function (r) {
        if (r.cells.some(function (c) { return taken.has(c); })) return;
        if (r.cells.length < 4) return;
        var pivot = r.cells[Math.floor(r.cells.length / 2)];
        if (swap) r.cells.forEach(function (c) { if (swap.indexOf(c) >= 0) pivot = c; });
        out.push({ i: pivot, kind: self.kindAt(pivot), sp: r.cells.length >= 5 ? 'r' : r.dir });
        taken.add(pivot);
      });
      return out;
    },
    /** Expande especiales afectados (reacciones en cadena) */
    expand: function (cells) {
      var queue = Array.from(cells), seen = new Set(cells), fx = [], self = this;
      var add = function (i) { if (i >= 0 && i < N * N && !seen.has(i) && self.grid[i]) { seen.add(i); queue.push(i); } };
      while (queue.length) {
        var i = queue.shift(), g = this.grid[i]; if (!g) continue;
        var r = Math.floor(i / N), c = i % N, q;
        if (g.sp === 'h') { fx.push({ t: 'h', i: i }); for (q = 0; q < N; q++) add(r * N + q); }
        else if (g.sp === 'v') { fx.push({ t: 'v', i: i }); for (q = 0; q < N; q++) add(q * N + c); }
        else if (g.sp === 'b') { fx.push({ t: 'b', i: i }); for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) if (r + dr >= 0 && r + dr < N && c + dc >= 0 && c + dc < N) add((r + dr) * N + c + dc); }
        else if (g.sp === 'r' && !cells.has(i)) { var k = this.rngB.int(0, KINDS - 1); fx.push({ t: 'r', i: i }); for (q = 0; q < N * N; q++) if (this.kindAt(q) === k) add(q); }
      }
      return { cells: seen, fx: fx };
    },
    resolve: async function (gen, m, swap) {
      var cascade = 0;
      while (m.cells.size && this.alive(gen)) {
        cascade++;
        var born = this.specials(m, swap), ex = this.expand(m.cells);
        born.forEach(function (b) { ex.cells.delete(b.i); });
        this.playFx(ex.fx);
        await this.clearCells(ex.cells, cascade, born);
        if (!this.alive(gen)) return;
        await this.gravity();
        if (!this.alive(gen)) return;
        swap = null; m = this.findMatches();
      }
      if (!this.alive(gen)) return;
      this.bestCascade = Math.max(this.bestCascade, cascade);
      if (!this.findMove()) await this.shuffle(gen);
      if (!this.alive(gen)) return;
      this.busy = false;
      if (this.timeLeft <= 0) this.finish();
    },
    clearCells: async function (cells, cascade, born) {
      var self = this, n = 0, bs = this.board;
      cells.forEach(function (i) {
        var g = self.grid[i]; if (!g) return;
        self.grid[i] = null; n++;
        var wx = bs.x + g.spr.x, wy = bs.y + g.spr.y, col = g.kind >= 0 ? COLORS[g.kind][0] : 0xffffff;
        self.sparks.setParticleTint([col, 0xffffff]); self.sparks.explode(g.sp ? 14 : 7, wx, wy);
        self.tweens.killTweensOf(g.spr);
        self.tweens.add({ targets: g.spr, scaleX: 1.35, scaleY: 1.35, alpha: 0, duration: 200, ease: 'quadOut', onComplete: function () { g.spr.destroy(); } });
      });
      // nacen las especiales: la gema pivote se transforma
      born.forEach(function (b) {
        var g = self.grid[b.i]; if (g) { self.tweens.killTweensOf(g.spr); g.spr.destroy(); }
        var ng = self.makeGem(b.i, b.kind, b.sp); ng.spr.setScale(0.2);
        self.tweens.add({ targets: ng.spr, scaleX: 1, scaleY: 1, duration: 300, ease: 'backOut' });
        var p = self.cellPos(b.i); self.stars.explode(10, bs.x + p.x, bs.y + p.y);
        self.sound.playSfx({ preset: 'powerup', seed: 11 }, { volume: 0.3, rate: 1.3 });
      });
      var pts = n * 10 * cascade + born.length * 50;
      this.score += pts;
      if (n >= 5 || cascade > 1) this.timeLeft = Math.min(TIME, this.timeLeft + Math.min(3, (n >= 5 ? 1 : 0) + (cascade - 1)));
      this.sound.playSfx({ preset: 'coin', seed: 4 }, { volume: 0.3, rate: 0.9 + cascade * 0.12 });
      if (cascade >= 2) {
        this.comboT.text = ['', '', '¡Bien!', '¡Genial!', '¡Increíble!', '¡Imparable!'][Math.min(5, cascade)] + '  x' + cascade;
        this.comboT.alpha = 1; this.comboT.setScale(0.6); this.tweens.killTweensOf(this.comboT);
        this.tweens.add({ targets: this.comboT, scaleX: 1, scaleY: 1, duration: 260, ease: 'backOut' });
        this.tweens.add({ targets: this.comboT, alpha: 0, delay: 700, duration: 400 });
      }
      if (n >= 8) this.cameras.main.shake(180, 0.006);
      await this.time.wait(190);
    },
    gravity: async function () {
      var self = this, longest = null, maxD = -1;
      for (var c = 0; c < N; c++) {
        var write = N - 1;
        for (var r = N - 1; r >= 0; r--) {
          var i = r * N + c, g = this.grid[i];
          if (!g) continue;
          if (r !== write) { var to = write * N + c; this.grid[to] = g; this.grid[i] = null; }
          write--;
        }
        var missing = write + 1;
        for (var rr = write; rr >= 0; rr--) { var ng = this.makeGem(rr * N + c, this.rngB.int(0, KINDS - 1)); ng.spr.y = -(missing - rr) * CELL + CELL / 2 - 20; }
      }
      for (var k = 0; k < N * N; k++) {
        var gg = this.grid[k], p = this.cellPos(k);
        if (!gg || Math.abs(gg.spr.y - p.y) < 0.5) continue;
        var d = p.y - gg.spr.y, tw = this.tweens.add({ targets: gg.spr, y: p.y, x: p.x, duration: 180 + d * 0.55, ease: 'bounceOut' });
        if (d > maxD) { maxD = d; longest = tw; }
      }
      if (longest) { await longest.finished; this.sound.playSfx({ preset: 'bounce', seed: 3 }, { volume: 0.12 }); }
      return self;
    },
    /** Busca un intercambio válido (para pistas y detección de bloqueo) */
    findMove: function () {
      for (var i = 0; i < N * N; i++) {
        var c = i % N, cand = [];
        if (c < N - 1) cand.push(i + 1); if (i + N < N * N) cand.push(i + N);
        for (var q = 0; q < cand.length; q++) {
          var j = cand[q], a = this.grid[i], b = this.grid[j];
          if (!a || !b) continue;
          if (a.sp === 'r' || b.sp === 'r') return [i, j];
          this.swapData(i, j);
          var ok = this.matchAt(i) || this.matchAt(j);
          this.swapData(i, j);
          if (ok) return [i, j];
        }
      }
      return null;
    },
    matchAt: function (i) {
      var k = this.kindAt(i); if (k < 0) return false;
      var r = Math.floor(i / N), c = i % N, h = 1, v = 1, t;
      for (t = c - 1; t >= 0 && this.kindAt(r * N + t) === k; t--) h++;
      for (t = c + 1; t < N && this.kindAt(r * N + t) === k; t++) h++;
      for (t = r - 1; t >= 0 && this.kindAt(t * N + c) === k; t--) v++;
      for (t = r + 1; t < N && this.kindAt(t * N + c) === k; t++) v++;
      return h >= 3 || v >= 3;
    },
    shuffle: async function (gen) {
      var self = this, tries = 0;
      MG.floatText(this, W / 2, BY + N * CELL / 2, 'Sin movimientos · barajando', 0xffffff, 26);
      do {
        var list = this.grid.slice(); this.rngB.shuffle(list); this.grid = list; tries++;
      } while (tries < 100 && (this.findMatches().cells.size || !this.findMove()));
      var pr = this.grid.map(function (g, i) { var p = self.cellPos(i); return self.tw({ targets: g.spr, x: p.x, y: p.y, duration: 500, ease: 'backInOut' }); });
      await Promise.all(pr);
      return gen;
    },
    playFx: function (fx) {
      var self = this, bs = this.board;
      fx.forEach(function (f) {
        var p = self.cellPos(f.i), wx = bs.x + p.x, wy = bs.y + p.y;
        if (f.t === 'h' || f.t === 'v') {
          var beam = self.add.image(f.t === 'h' ? bs.x + N * CELL / 2 : wx, f.t === 'h' ? wy : bs.y + N * CELL / 2, 'gm-beam');
          beam.blendMode = 'add'; beam.depth = 9; beam.setDisplaySize(N * CELL, 40); if (f.t === 'v') beam.rotation = Math.PI / 2;
          self.tweens.add({ targets: beam, scaleY: 0, alpha: 0, duration: 380, ease: 'quadIn', onComplete: function () { beam.destroy(); } });
          self.sound.playSfx({ preset: 'laser', seed: 31 }, { volume: 0.3, rate: 0.7 });
        } else if (f.t === 'b') {
          var ring = self.add.graphics(); ring.x = wx; ring.y = wy; ring.depth = 9; ring.lineStyle(8, 0xffffff, 1).strokeCircle(0, 0, CELL * 0.6);
          ring.blendMode = 'add';
          self.tweens.add({ targets: ring, scaleX: 2.6, scaleY: 2.6, alpha: 0, duration: 420, ease: 'quadOut', onComplete: function () { ring.destroy(); } });
          self.cameras.main.shake(220, 0.01);
          self.sound.playSfx({ preset: 'explosion', seed: 9 }, { volume: 0.35 });
        }
      });
    },
    rainbowFx: function (at, set) {
      var self = this, bs = this.board, p = this.cellPos(at), g = this.add.graphics(); g.depth = 9; g.blendMode = 'add';
      set.forEach(function (i) { var q = self.cellPos(i); g.lineStyle(3, 0xffffff, 0.8).lineBetween(bs.x + p.x, bs.y + p.y, bs.x + q.x, bs.y + q.y); });
      this.tweens.add({ targets: g, alpha: 0, duration: 450, onComplete: function () { g.destroy(); } });
      this.cameras.main.flash(160, 0xffffff, 0.35);
      this.sound.playSfx({ preset: 'powerup', seed: 50 }, { volume: 0.45 });
    },
    showHint: function () {
      var mv = this.findMove(); if (!mv) return;
      var self = this;
      this.hintTargets = mv.map(function (i) { return self.grid[i].spr; });
      this.hintTw = this.tweens.add({ targets: this.hintTargets, scaleX: 1.18, scaleY: 1.18, duration: 260, yoyo: true, repeat: 3, ease: 'sineInOut', onComplete: function () { self.hintTw = null; } });
    },
    stopHint: function () { if (this.hintTw) { this.hintTw.stop(); this.hintTargets.forEach(function (s) { if (!s.destroyed) s.setScale(1); }); this.hintTw = null; } },
    drawTime: function () {
      var g = this.timeBar.clear(), w = 420, x = W / 2 - w / 2, y = 184, f = UG.Math.clamp(this.timeLeft / TIME, 0, 1);
      g.fillStyle(0x000000, 0.4).fillRoundedRect(x, y, w, 24, 12);
      var col = f > 0.5 ? 0x69db7c : f > 0.25 ? 0xffd43b : 0xff6b6b;
      if (f > 0.02) g.fillStyle(col, 1).fillRoundedRect(x + 3, y + 3, (w - 6) * f, 18, 9);
      g.lineStyle(2, 0xffffff, 0.35).strokeRoundedRect(x, y, w, 24, 12);
      this.timeT.text = Math.ceil(Math.max(0, this.timeLeft)) + ' s';
    },
    finish: function () {
      if (this.over) return;
      this.over = true; this.select(-1); this.stopHint();
      var s = this;
      this.sound.stopMusic(600);
      this.sound.playSfx({ preset: 'powerup', seed: 70 }, { volume: 0.4, rate: 0.7 });
      var t = MG.text(this, W / 2, BY + N * CELL / 2, '¡TIEMPO!', 72, 0xffffff, { hud: true, stroke: 8, style: { fill: [0xffffff, 0xffa8a8] } });
      t.setScale(0.3); this.tweens.add({ targets: t, scaleX: 1, scaleY: 1, duration: 500, ease: 'backOut' });
      // las gemas caen del tablero
      this.grid.forEach(function (g, i) { if (g) s.tweens.add({ targets: g.spr, y: g.spr.y + H, rotation: s.rng.between(-3, 3), duration: 900, delay: (N - Math.floor(i / N)) * 40 + s.rng.int(0, 120), ease: 'quadIn' }); });
      this.time.delayedCall(1800, function () { s.scene.start('GameOver', { score: s.score, win: true }); });
    },
    update: function (t, dt) {
      if (!this.grid) return;
      if (!this.over) {
        this.timeLeft -= dt / 1000;
        if (this.timeLeft <= 0 && !this.busy) this.finish();
        this.drawTime();
        this.idle += dt;
        if (this.idle > 5000 && !this.busy) { this.idle = 0; this.showHint(); }
      }
      if (this.shown !== this.score) { this.shown = Math.min(this.score, this.shown + Math.max(1, Math.ceil((this.score - this.shown) * 0.15))); this.scoreT.text = String(this.shown); }
    }
  };

  MG.start({
    title: 'Gem Match', width: W, height: H, backgroundColor: 0x1b1035,
    scenes: [
      MG.menu({ id: 'gem-match', title: 'GEM MATCH', subtitle: 'Contrarreloj de ' + TIME + ' segundos', glow: '#da77f2', titleColors: [0xffffff, 0xe599f7], buttonColor: 0x9c36b5,
        help: 'Intercambia gemas vecinas para alinear 3 o más.\n4 en línea = gema rayada · L o T = bomba · 5 = arcoíris\nLas cascadas suman tiempo extra.',
        background: function (s) {
          makeTextures(s); background(s);
          for (var i = 0; i < 6; i++) { var g = s.add.image(W / 2 - 250 + i * 100, H * 0.44, 'gm' + i); s.tweens.add({ targets: g, y: g.y - 16, duration: 600, yoyo: true, repeat: -1, delay: i * 90, ease: 'sineInOut' }); }
        } }),
      Play,
      MG.gameOver({ id: 'gem-match', background: function (s) { makeTextures(s); background(s); } })]
  });
})();
