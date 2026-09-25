/* Brick Breaker — arcade frontal. Prueba: física de círculos vs AABB, grupos estáticos, colisión con
 * callbacks, Rope (estela), GlowFilter, tweens escalonados (stagger en rejilla), partículas, combos, niveles. */
(function () {
  'use strict';
  var W = 960, H = 640;
  var LEVELS = [
    ['..........', '.11111111.', '.12222221.', '.12333321.', '.12222221.', '.11111111.'],
    ['1.1.1.1.1.', '.2.2.2.2.2', '3.3.3.3.3.', '.2.2.2.2.2', '1.1.1.1.1.', 'xx......xx'],
    ['4444444444', '3........3', '3.222222.3', '3.2x11x2.3', '3.222222.3', '3........3', '4444444444'],
    ['x1x1x1x1x1', '2222222222', '.33333333.', '..444444..', '...3333...', '....22....', '....11....']
  ];
  var COLORS = { 1: [0x69db7c, 0x2b8a3e], 2: [0x4dabf7, 0x1864ab], 3: [0xda77f2, 0x862e9c], 4: [0xffa94d, 0xd9480f], x: [0xced4da, 0x495057] };

  function makeTextures(scene) {
    var T = scene.textures;
    if (T.exists('bb-ball')) return;
    Object.keys(COLORS).forEach(function (k) {
      T.generate('brick' + k, 80, 30, function (c) {
        var col = COLORS[k], g = c.createLinearGradient(0, 0, 0, 30);
        g.addColorStop(0, UG.Color.toHex(UG.Color.brighten(col[0], 0.3))); g.addColorStop(0.5, UG.Color.toHex(col[0])); g.addColorStop(1, UG.Color.toHex(col[1]));
        c.fillStyle = g; c.beginPath(); if (c.roundRect) c.roundRect(2, 2, 76, 26, 7); else c.rect(2, 2, 76, 26); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(8, 5, 64, 5);
        c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 1.5; c.stroke();
        if (k === 'x') { c.fillStyle = 'rgba(0,0,0,0.25)'; for (var i = 0; i < 4; i++) { c.beginPath(); c.arc(12 + i * 19, 15, 3, 0, 6.3); c.fill(); } }
      });
    });
    T.generate('bb-ball', 24, 24, function (c) { var g = c.createRadialGradient(9, 8, 1, 12, 12, 12); g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#fff3bf'); g.addColorStop(1, '#fab005'); c.fillStyle = g; c.beginPath(); c.arc(12, 12, 11, 0, 6.3); c.fill(); });
    T.generate('bb-paddle', 160, 28, function (c) {
      var g = c.createLinearGradient(0, 0, 0, 28); g.addColorStop(0, '#e7f5ff'); g.addColorStop(0.4, '#4dabf7'); g.addColorStop(1, '#1c4fbd');
      c.fillStyle = g; c.beginPath(); if (c.roundRect) c.roundRect(2, 2, 156, 24, 12); else c.rect(2, 2, 156, 24); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.5)'; c.fillRect(16, 6, 128, 4);
    });
    T.generate('bb-trail', 32, 8, function (c) { var g = c.createLinearGradient(0, 0, 32, 0); g.addColorStop(0, 'rgba(255,212,59,0)'); g.addColorStop(1, 'rgba(255,243,191,0.9)'); c.fillStyle = g; c.fillRect(0, 0, 32, 8); });
    ['M', 'W', 'S', '+'].forEach(function (l, i) {
      T.generate('bb-pow' + l, 44, 24, function (c) {
        var cols = ['#ff6b6b', '#4dabf7', '#69db7c', '#ffd43b'];
        c.fillStyle = cols[i]; c.beginPath(); if (c.roundRect) c.roundRect(1, 1, 42, 22, 11); else c.rect(1, 1, 42, 22); c.fill();
        c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke(); c.fillStyle = '#fff'; c.font = 'bold 16px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(l, 22, 13);
      });
    });
    MG.glowTexture(scene, 'bb-spark', 16, 'rgba(255,255,255,1)');
  }
  function background(scene) {
    var g = scene.add.graphics();
    g.fillGradientStyle(0x0c1330, 0x0c1330, 0x1a0b2e, 0x1a0b2e, 1).fillRect(0, 0, W, H);
    g.lineStyle(1, 0x3b5bdb, 0.18);
    for (var x = 0; x <= W; x += 40) g.lineBetween(x, 0, x, H);
    for (var y = 0; y <= H; y += 40) g.lineBetween(0, y, W, y);
    g.depth = -10; g.cacheAsTexture = true;
  }

  var Play = {
    key: 'Play',
    create: function (data) {
      var s = this; makeTextures(this); background(this);
      this.level = (data && data.level) || 0; this.score = (data && data.score) || 0; this.lives = (data && data.lives) || 3;
      this.combo = 0; this.over = false;
      var P = this.physics;
      P.world.setBounds(0, 0, W, H); P.world.setBoundsCollision(true, true, true, false);
      this.paddle = P.add.image(W / 2, H - 50, 'bb-paddle'); this.paddle.body.setImmovable(true).setAllowGravity(false);
      this.paddle.targetX = W / 2;
      this.balls = P.add.group(); this.bricks = P.add.staticGroup(); this.pows = P.add.group();
      this.sparks = this.add.particles('bb-spark', { speed: { min: 60, max: 260 }, lifespan: 600, scale: { start: 1.2, end: 0 }, blendMode: 'add', frequency: -1, gravityY: 400, maxParticles: 3000 });
      this.buildLevel();
      this.newBall(true);
      P.add.collider(this.balls, this.bricks, function (ball, brick) { s.hitBrick(brick, ball); });
      P.add.collider(this.balls, this.paddle, function (ball) { s.bouncePaddle(ball); });
      P.add.overlap(this.paddle, this.pows, function (p, u) { s.powerUp(u); });
      this.input.on('pointermove', function (p) { s.paddle.targetX = p.x; });
      this.input.on('pointerdown', function (p) { s.paddle.targetX = p.x; s.launch(); });
      this.keys = this.input.keyboard.createCursorKeys();
      this.input.keyboard.on('keydown-SPACE', function () { s.launch(); });
      this.scoreT = MG.text(this, 70, 28, '', 24, 0xffffff, { hud: true, ox: 0 });
      this.infoT = MG.text(this, W / 2, 28, '', 22, 0xcdd6ff, { hud: true });
      this.comboT = MG.text(this, W / 2, H * 0.62, '', 34, 0xffd43b, { hud: true }); this.comboT.alpha = 0;
      this.hint = MG.text(this, W / 2, H * 0.72, MG.isTouch ? 'Toca para lanzar' : 'Clic o Espacio para lanzar', 24, 0xffffff, { hud: true });
      this.tweens.add({ targets: this.hint, alpha: 0.3, duration: 700, yoyo: true, repeat: -1 });
      MG.hudButtons(this);
      this.refresh();
      this.sound.addMusic('bb-music', { bpm: 118, tracks: [{ wave: 'saw', volume: 0.06, notes: 'E3 E3 G3 E3 A3 E3 B3 A3 E3 E3 G3 E3 D4 C4 B3 A3' }, { wave: 'triangle', volume: 0.25, notes: 'E2 - - - E2 - - - C2 - - - D2 - - -' }, { drums: true, volume: 0.35, notes: 'k . h . s . h . k k h . s . h h' }] });
      this.sound.playMusic('bb-music', { volume: 0.28 });
    },
    buildLevel: function () {
      var s = this, pat = LEVELS[this.level % LEVELS.length], cols = pat[0].length, bw = 84, bh = 32;
      var ox = (W - cols * bw) / 2 + bw / 2, oy = 110, list = [];
      pat.forEach(function (row, r) {
        for (var c = 0; c < row.length; c++) {
          var ch = row[c]; if (ch === '.') continue;
          var b = s.bricks.create(ox + c * bw, oy + r * bh, 'brick' + ch);
          b.kind = ch; b.hp = ch === 'x' ? Infinity : +ch + Math.floor(s.level / 4); b.col = c; b.row = r;
          b.body.refreshBody();
          b.alpha = 0; b.scaleX = 0.2; b.scaleY = 0.2; list.push(b);
        }
      });
      this.tweens.add({ targets: list, alpha: 1, scaleX: 1, scaleY: 1, duration: 420, ease: 'backOut', delay: this.tweens.stagger(40, { grid: [cols, pat.length], from: 'center' }) });
    },
    newBall: function (stuck) {
      var b = this.physics.add.image(this.paddle.x, this.paddle.y - 30, 'bb-ball');
      this.balls.add(b);
      b.body.setCircle(11, 1, 1).setBounce(1).setCollideWorldBounds(true).setAllowGravity(false);
      b.stuck = !!stuck; b.speed = 460 + this.level * 40;
      b.trailPts = []; for (var i = 0; i < 14; i++) b.trailPts.push(new UG.Vec2(b.x, b.y));
      b.trail = this.add.rope(0, 0, 'bb-trail', undefined, b.trailPts, { width: 14, taper: 1 }); b.trail.blendMode = 'add'; b.trail.depth = -1;
      if (this.game.rendererType !== 'canvas') b.filters = [new UG.GlowFilter({ distance: 10, outerStrength: 1.6, color: 0xffd43b })];
      return b;
    },
    launch: function () {
      var s = this;
      this.balls.getChildren().forEach(function (b) { if (b.stuck) { b.stuck = false; var a = -Math.PI / 2 + s.rng.between(-0.35, 0.35); b.body.setVelocity(Math.cos(a) * b.speed, Math.sin(a) * b.speed); } });
      if (this.hint) { this.tweens.killTweensOf(this.hint); this.hint.destroy(); this.hint = null; }
    },
    bouncePaddle: function (ball) {
      var off = UG.Math.clamp((ball.x - this.paddle.x) / (this.paddle.displayWidth / 2), -1, 1);
      var a = -Math.PI / 2 + off * 1.1;
      ball.body.setVelocity(Math.cos(a) * ball.speed, Math.sin(a) * ball.speed);
      this.combo = 0;
      this.tweens.add({ targets: this.paddle, scaleY: 0.8, duration: 70, yoyo: true });
      this.sound.playSfx({ preset: 'blip', seed: 3 }, { volume: 0.35 });
    },
    hitBrick: function (brick, ball) {
      if (brick.kind === 'x') { this.sound.playSfx({ preset: 'hit', seed: 44 }, { volume: 0.2 }); this.tweens.add({ targets: brick, x: brick.x + 2, duration: 40, yoyo: true, repeat: 1 }); return; }
      brick.hp--;
      this.combo++;
      if (brick.hp > 0) {
        brick.setTexture('brick' + Math.max(1, Math.min(4, brick.hp)));
        this.sound.playSfx({ preset: 'hit', seed: 13 }, { volume: 0.3, rate: 1.2 });
        return;
      }
      var pts = 50 * Math.min(8, this.combo);
      this.score += pts;
      this.sparks.setParticleTint([COLORS[brick.kind][0], 0xffffff]); this.sparks.explode(18, brick.x, brick.y);
      MG.floatText(this, brick.x, brick.y, '+' + pts, COLORS[brick.kind][0], 20);
      this.sound.playSfx({ preset: 'coin', seed: brick.row + 1 }, { volume: 0.3, rate: 0.9 + this.combo * 0.05 });
      if (this.combo >= 4) { this.comboT.text = 'COMBO x' + this.combo; this.comboT.alpha = 1; this.comboT.setScale(1.3); this.tweens.killTweensOf(this.comboT); this.tweens.add({ targets: this.comboT, alpha: 0, scaleX: 1, scaleY: 1, duration: 900, ease: 'quadOut' }); }
      if (this.rng.chance(0.14)) this.dropPow(brick.x, brick.y);
      this.cameras.main.shake(80, 0.003);
      brick.destroy();
      this.refresh();
      if (this.bricks.getChildren().filter(function (b) { return b.kind !== 'x'; }).length === 0) this.levelClear();
    },
    dropPow: function (x, y) {
      var k = this.rng.pick(['M', 'W', 'S', '+']);
      var u = this.physics.add.image(x, y, 'bb-pow' + k); this.pows.add(u); u.kind = k; u.body.setVelocityY(140).setAllowGravity(false);
    },
    powerUp: function (u) {
      var s = this;
      if (u.kind === 'M') { this.balls.getChildren().slice(0, 1).forEach(function (b) { for (var i = 0; i < 2; i++) { var nb = s.newBall(false); nb.x = b.x; nb.y = b.y; nb.body.reset(b.x, b.y); var a = -Math.PI / 2 + (i ? 0.6 : -0.6); nb.body.setVelocity(Math.cos(a) * nb.speed, Math.sin(a) * nb.speed); } }); }
      else if (u.kind === 'W') { this.tweens.add({ targets: this.paddle, scaleX: 1.5, duration: 250, ease: 'backOut' }); this.time.delayedCall(12000, function () { if (s.paddle && s.paddle.active) s.tweens.add({ targets: s.paddle, scaleX: 1, duration: 250 }); }); }
      else if (u.kind === 'S') { this.balls.getChildren().forEach(function (b) { b.speed *= 0.75; b.body.velocity.scale(0.75); }); }
      else { this.lives++; }
      this.sound.playSfx({ preset: 'powerup', seed: 6 }, { volume: 0.5 });
      MG.floatText(this, u.x, u.y - 20, { M: 'MULTIBOLA', W: 'PALETA ANCHA', S: 'LENTA', '+': '+1 VIDA' }[u.kind], 0xffffff, 18);
      u.destroy(); this.refresh();
    },
    levelClear: function () {
      if (this.over) return;
      this.over = true; var s = this;
      this.sound.playSfx({ preset: 'powerup', seed: 20 });
      MG.text(this, W / 2, H / 2, '¡NIVEL ' + (this.level + 1) + ' COMPLETADO!', 44, 0x8ce99a, { hud: true, stroke: 6 });
      this.balls.getChildren().forEach(function (b) { b.body.setVelocity(0, 0); });
      this.time.delayedCall(1600, function () {
        if (s.level + 1 >= LEVELS.length) s.scene.start('GameOver', { score: s.score + s.lives * 500, win: true });
        else s.scene.restart({ level: s.level + 1, score: s.score, lives: s.lives });
      });
    },
    refresh: function () {
      this.scoreT.text = 'PUNTOS ' + this.score;
      var h = ''; for (var i = 0; i < Math.min(this.lives, 8); i++) h += '♥';
      this.infoT.text = 'NIVEL ' + (this.level + 1) + '   ' + h;
    },
    update: function (t, dt) {
      if (!this.paddle) return;
      var s = this, p = this.paddle, k = this.keys;
      if (k.left.isDown) p.targetX -= 900 * dt / 1000; if (k.right.isDown) p.targetX += 900 * dt / 1000;
      var hw = p.displayWidth / 2; p.targetX = UG.Math.clamp(p.targetX, hw, W - hw);
      p.x = UG.Math.damp(p.x, p.targetX, 22, dt / 1000);
      var alive = 0;
      this.balls.getChildren().slice().forEach(function (b) {
        if (!b.active) return;
        if (b.stuck) { b.x = p.x; b.y = p.y - 28; b.body.reset(b.x, b.y); }
        else {
          // velocidad constante y ángulo mínimo (evita rebotes casi horizontales)
          var v = b.body.velocity, sp = v.length() || 1;
          if (Math.abs(v.y) < b.speed * 0.25) v.y = (v.y < 0 ? -1 : 1) * b.speed * 0.25;
          sp = v.length(); v.scale(b.speed / sp);
        }
        var pts = b.trailPts, n = pts.length; for (var i = 0; i < n - 1; i++) pts[i].copy(pts[i + 1]); pts[n - 1].set(b.x, b.y);
        if (b.y > H + 30) { b.trail.destroy(); b.destroy(); return; }
        alive++;
      });
      this.pows.getChildren().slice().forEach(function (u) { if (u.y > H + 20) u.destroy(); });
      if (alive === 0 && !this.over) {
        this.lives--; this.refresh();
        this.cameras.main.shake(300, 0.012); this.sound.playSfx({ preset: 'hurt', seed: 1 });
        if (this.lives <= 0) { this.over = true; this.sound.stopMusic(500); this.time.delayedCall(900, function () { s.scene.start('GameOver', { score: s.score }); }); }
        else this.newBall(true);
      }
    }
  };

  MG.start({
    title: 'Brick Breaker', width: W, height: H, backgroundColor: 0x0c1330,
    physics: { arcade: { gravity: { y: 0 } } },
    scenes: [
      MG.menu({ id: 'brick-breaker', title: 'BRICK BREAKER', subtitle: 'Rompe todos los ladrillos', glow: '#fab005', titleColors: [0xffffff, 0xffe066], buttonColor: 0xe67700,
        help: 'Ratón o ← → para mover la paleta · Clic/Espacio para lanzar\nPower-ups: M multibola · W paleta ancha · S lenta · + vida',
        touchHelp: 'Desliza el dedo para mover la paleta · toca para lanzar',
        background: function (s) { makeTextures(s); background(s); var row = ['1', '2', '3', '4', 'x']; for (var i = 0; i < 10; i++) { var b = s.add.image(W / 2 - 378 + i * 84, H * 0.44, 'brick' + row[i % 5]); s.tweens.add({ targets: b, y: b.y - 10, duration: 700, yoyo: true, repeat: -1, delay: i * 70, ease: 'sineInOut' }); } } }),
      Play,
      MG.gameOver({ id: 'brick-breaker', background: function (s) { makeTextures(s); background(s); } })]
  });
})();
