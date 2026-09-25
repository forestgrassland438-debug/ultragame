/* Sky Hopper — vista lateral de un botón. Prueba: parallax con 4 TilingSprites, spritesheet procedural
 * animado (textures.generate + frameWidth), pool de tuberías con física, ciclo día/noche con tweens de
 * color, medallas, dificultad progresiva y entrada de un solo botón (toque, clic, Espacio). */
(function () {
  'use strict';
  var W = 540, H = 960, GROUND = 110, GAP0 = 250, GAP_MIN = 175, SPEED0 = 190, SPEED_MAX = 320;
  var DAY = { top: 0x4dabf7, bottom: 0xd0ebff, clouds: 0xffffff, far: 0x91a7ff, near: 0x69db7c, ground: 0xffffff };
  var NIGHT = { top: 0x0b1032, bottom: 0x3b2a6b, clouds: 0x5c5f99, far: 0x2c2f6b, near: 0x1f5e3a, ground: 0x8a8fb8 };
  var MEDALS = [[80, 'PLATINO', 0xe5dbff], [40, 'ORO', 0xffd43b], [20, 'PLATA', 0xdee2e6], [10, 'BRONCE', 0xe8a064]];

  function makeTextures(scene) {
    var T = scene.textures;
    if (T.exists('sh-bird')) return;
    // pájaro: 3 fotogramas de 56x44 (alas arriba / centro / abajo)
    T.generate('sh-bird', 168, 44, function (c) {
      for (var f = 0; f < 3; f++) {
        var ox = f * 56 + 28, oy = 22;
        c.save(); c.translate(ox, oy);
        var g = c.createRadialGradient(-6, -8, 2, 0, 0, 22); g.addColorStop(0, '#fff3bf'); g.addColorStop(0.5, '#ffd43b'); g.addColorStop(1, '#f59f00');
        c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, 20, 16, 0, 0, Math.PI * 2); c.fill();
        c.lineWidth = 2.5; c.strokeStyle = '#8f4a00'; c.stroke();
        c.fillStyle = '#fff'; c.beginPath(); c.ellipse(-2, 7, 11, 6, 0, 0, Math.PI * 2); c.fill();
        // ojo
        c.fillStyle = '#fff'; c.beginPath(); c.arc(9, -6, 7, 0, Math.PI * 2); c.fill(); c.stroke();
        c.fillStyle = '#212529'; c.beginPath(); c.arc(11, -6, 3, 0, Math.PI * 2); c.fill();
        // pico
        c.fillStyle = '#ff6b6b'; c.beginPath(); c.moveTo(14, 1); c.lineTo(27, 4); c.lineTo(14, 9); c.closePath(); c.fill(); c.stroke();
        // ala según fotograma
        var wy = [-10, -1, 7][f], wr = [-0.6, 0, 0.5][f];
        c.save(); c.translate(-9, wy * 0.3); c.rotate(wr);
        c.fillStyle = '#fff9db'; c.beginPath(); c.ellipse(-2, 0, 12, 7, 0, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#8f4a00'; c.lineWidth = 2; c.stroke();
        c.restore(); c.restore();
      }
    }, { frameWidth: 56, frameHeight: 44 });
    // tubería (cuerpo + boca), se usa volteada para la de arriba
    T.generate('sh-pipe', 96, 700, function (c) {
      var body = c.createLinearGradient(8, 0, 88, 0); body.addColorStop(0, '#2b8a3e'); body.addColorStop(0.35, '#8ce99a'); body.addColorStop(0.6, '#51cf66'); body.addColorStop(1, '#237032');
      c.fillStyle = body; c.fillRect(10, 30, 76, 670);
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(10, 30, 76, 8);
      var cap = c.createLinearGradient(0, 0, 96, 0); cap.addColorStop(0, '#2b8a3e'); cap.addColorStop(0.35, '#b2f2bb'); cap.addColorStop(0.6, '#69db7c'); cap.addColorStop(1, '#237032');
      c.fillStyle = cap; c.fillRect(2, 2, 92, 32);
      c.strokeStyle = '#1b4d2a'; c.lineWidth = 3; c.strokeRect(2, 2, 92, 32); c.strokeRect(10, 34, 76, 670);
    });
    T.generate('sh-clouds', 512, 220, function (c) {
      var r = new UG.RNG('clouds');
      for (var i = 0; i < 9; i++) {
        var x = r.between(0, 512), y = r.between(40, 180), s = r.between(0.6, 1.3);
        for (var k = -1; k <= 1; k++) {
          var cx = x + k * 512; c.fillStyle = 'rgba(255,255,255,0.9)';
          [[0, 0, 34], [30, -12, 30], [60, 0, 28], [30, 10, 30], [-26, 6, 22], [84, 8, 20]].forEach(function (b) { c.beginPath(); c.arc(cx + b[0] * s, y + b[1] * s, b[2] * s, 0, Math.PI * 2); c.fill(); });
        }
      }
    });
    // montañas y colinas: 2 px transparentes abajo para que el filtrado del mosaico no "sangre" una línea arriba
    T.generate('sh-far', 512, 262, function (c) {
      c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, 260);
      var pts = [[0, 150], [60, 90], [110, 140], [170, 60], [240, 130], [300, 80], [360, 150], [420, 70], [470, 120], [512, 150]];
      pts.forEach(function (p) { c.lineTo(p[0], p[1]); }); c.lineTo(512, 260); c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.55)'; [[170, 60], [300, 80], [420, 70]].forEach(function (p) { c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(p[0] - 22, p[1] + 26); c.lineTo(p[0] + 22, p[1] + 26); c.closePath(); c.fill(); });
    });
    T.generate('sh-near', 512, 202, function (c) {
      c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, 200);
      for (var x = 0; x <= 512; x += 8) c.lineTo(x, 110 + Math.sin(x / 512 * Math.PI * 4) * 22 + Math.sin(x / 512 * Math.PI * 10) * 8);
      c.lineTo(512, 200); c.closePath(); c.fill();
      var r = new UG.RNG('trees');
      for (var i = 0; i < 14; i++) { var tx = r.between(0, 512), ty = 112 + Math.sin(tx / 512 * Math.PI * 4) * 22; c.beginPath(); c.arc(tx, ty - 8, r.between(12, 22), 0, Math.PI * 2); c.fill(); }
    });
    T.generate('sh-ground', 128, GROUND, function (c) {
      c.fillStyle = '#e9c46a'; c.fillRect(0, 0, 128, GROUND);
      c.fillStyle = '#74c045'; c.fillRect(0, 0, 128, 22);
      c.fillStyle = '#5a9e33'; for (var x = 0; x < 128; x += 16) { c.beginPath(); c.moveTo(x, 22); c.lineTo(x + 8, 32); c.lineTo(x + 16, 22); c.closePath(); c.fill(); }
      c.fillStyle = '#3b7a22'; c.fillRect(0, 0, 128, 4);
      c.fillStyle = 'rgba(160,110,40,0.35)'; for (var i = 0; i < 18; i++) c.fillRect((i * 37) % 128, 44 + (i * 23) % 60, 6, 4);
    });
    T.generate('sh-star', 30, 30, function (c) {
      c.fillStyle = '#fff'; c.strokeStyle = '#e67700'; c.lineWidth = 2.5; c.beginPath();
      for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i / 10 * Math.PI * 2, rr = i % 2 ? 6 : 13; c.lineTo(15 + Math.cos(a) * rr, 15 + Math.sin(a) * rr); }
      c.closePath(); var g = c.createRadialGradient(12, 11, 1, 15, 15, 14); g.addColorStop(0, '#fff9db'); g.addColorStop(1, '#fcc419'); c.fillStyle = g; c.fill(); c.stroke();
    });
    T.generate('sh-feather', 16, 8, function (c) { c.fillStyle = '#fff3bf'; c.beginPath(); c.ellipse(8, 4, 7, 3, 0, 0, Math.PI * 2); c.fill(); });
    T.generate('sh-sun', 120, 120, function (c) { var g = c.createRadialGradient(60, 60, 10, 60, 60, 60); g.addColorStop(0, 'rgba(255,255,230,1)'); g.addColorStop(0.35, 'rgba(255,236,153,1)'); g.addColorStop(0.5, 'rgba(255,212,59,0.35)'); g.addColorStop(1, 'rgba(255,212,59,0)'); c.fillStyle = g; c.fillRect(0, 0, 120, 120); });
    T.generate('sh-moon', 90, 90, function (c) { c.fillStyle = '#f1f3f5'; c.beginPath(); c.arc(45, 45, 30, 0, Math.PI * 2); c.fill(); c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(60, 36, 26, 0, Math.PI * 2); c.fill(); });
    MG.starfield(scene, 'sh-stars', 540, 600, 120, 'sky-stars');
    if (!scene.anims.exists('sh-flap')) scene.anims.create({ key: 'sh-flap', frames: scene.anims.generateFrameNumbers('sh-bird', { frames: [1, 0, 1, 2, 1] }), frameRate: 18, repeat: 0 });
    if (!scene.anims.exists('sh-glide')) scene.anims.create({ key: 'sh-glide', frames: scene.anims.generateFrameNumbers('sh-bird', { frames: [0, 1, 2, 1] }), frameRate: 8, repeat: -1 });
  }

  /** Escenario con parallax y ciclo día/noche (compartido por menú y juego) */
  function world(scene) {
    var L = {};
    L.skyDay = scene.add.graphics(); L.skyDay.fillGradientStyle(DAY.top, DAY.top, DAY.bottom, DAY.bottom, 1).fillRect(0, 0, W, H); L.skyDay.cacheAsTexture = true;
    L.skyNight = scene.add.graphics(); L.skyNight.fillGradientStyle(NIGHT.top, NIGHT.top, NIGHT.bottom, NIGHT.bottom, 1).fillRect(0, 0, W, H); L.skyNight.cacheAsTexture = true; L.skyNight.alpha = 0;
    L.stars = scene.add.image(W / 2, 300, 'sh-stars'); L.stars.alpha = 0;
    L.sun = scene.add.image(W * 0.78, 170, 'sh-sun'); L.moon = scene.add.image(W * 0.2, 150, 'sh-moon'); L.moon.alpha = 0;
    L.clouds = scene.add.tileSprite(W / 2, 250, W, 220, 'sh-clouds'); L.clouds.alpha = 0.85;
    L.far = scene.add.tileSprite(W / 2, H - GROUND - 130 - 70 + 1, W, 262, 'sh-far');
    L.near = scene.add.tileSprite(W / 2, H - GROUND - 100 + 10 + 1, W, 202, 'sh-near');
    L.ground = scene.add.tileSprite(W / 2, H - GROUND / 2, W, GROUND, 'sh-ground'); L.ground.depth = 20;
    L.night = 0;
    L.apply = function () {
      var n = L.night, lerp = UG.Color.lerp;
      L.skyNight.alpha = n; L.stars.alpha = n * 0.9; L.sun.alpha = 1 - n; L.moon.alpha = n;
      L.sun.y = 170 + n * 260; L.moon.y = 150 + (1 - n) * 260;
      L.clouds.tint = lerp(DAY.clouds, NIGHT.clouds, n); L.far.tint = lerp(DAY.far, NIGHT.far, n);
      L.near.tint = lerp(DAY.near, NIGHT.near, n); L.ground.tint = lerp(DAY.ground, NIGHT.ground, n);
    };
    // el mundo avanza hacia la izquierda: en UltraGame (como en PixiJS) restar a tilePositionX desplaza el dibujo a la izquierda
    L.scroll = function (dx) { L.clouds.tilePositionX -= dx * 0.1; L.far.tilePositionX -= dx * 0.25; L.near.tilePositionX -= dx * 0.5; L.ground.tilePositionX -= dx; };
    L.apply();
    return L;
  }

  var Play = {
    key: 'Play',
    create: function () {
      var s = this; makeTextures(this);
      this.L = world(this);
      this.state = 'ready'; this.score = 0; this.speed = SPEED0; this.gap = GAP0; this.dist = 0; this.nextPipe = 0; this.pairs = [];
      var P = this.physics;
      P.world.setBounds(0, -200, W, H + 200);
      this.pipes = P.add.group({ maxSize: 14, defaultKey: 'sh-pipe', allowGravity: false, immovable: true });
      this.stars = P.add.group({ maxSize: 8, defaultKey: 'sh-star', allowGravity: false });
      this.bird = P.add.sprite(W * 0.3, H * 0.42, 'sh-bird', 1);
      this.bird.body.setCircle(17, 11, 5).setAllowGravity(false).setMaxVelocity(1000, 760);
      this.bird.depth = 15; this.bird.play('sh-glide');
      this.tweens.add({ targets: this.bird, y: this.bird.y - 18, duration: 520, yoyo: true, repeat: -1, ease: 'sineInOut', name: 'bob' });
      this.feathers = this.add.particles('sh-feather', { lifespan: { min: 600, max: 1200 }, speed: { min: 60, max: 240 }, rotationSpeed: { min: -400, max: 400 }, gravityY: 300, scale: { start: 1.2, end: 0.6 }, alpha: { start: 1, end: 0 }, frequency: -1, maxParticles: 200 });
      this.sparkle = this.add.particles('sh-star', { lifespan: 500, speed: { min: 60, max: 200 }, scale: { start: 0.6, end: 0 }, blendMode: 'add', frequency: -1, maxParticles: 100 });
      this.feathers.depth = this.sparkle.depth = 16;
      P.add.overlap(this.bird, this.pipes, function () { s.die(); });
      P.add.overlap(this.bird, this.stars, function (b, st) { if (st.active) s.collect(st); });
      // HUD
      this.scoreT = MG.text(this, W / 2, 110, '0', 84, 0xffffff, { hud: true, stroke: 8 });
      this.hint = MG.text(this, W / 2, H * 0.58, MG.isTouch ? 'Toca para volar' : 'Clic / Espacio para volar', 34, 0xffffff, { hud: true, stroke: 6 });
      this.tweens.add({ targets: this.hint, scaleX: 1.06, scaleY: 1.06, duration: 500, yoyo: true, repeat: -1 });
      MG.hudButtons(this);
      this.input.on('pointerdown', function (p, hits) { if (!hits || !hits.length) s.flap(); });
      ['SPACE', 'UP', 'W'].forEach(function (k) { s.input.keyboard.on('keydown-' + k, function () { s.flap(); }); });
      this.sound.addMusic('sh-music', { bpm: 132, tracks: [
        { wave: 'square', volume: 0.04, notes: 'E5 - G5 E5 D5 - C5 - D5 E5 - C5 A4 - G4 -' },
        { wave: 'triangle', volume: 0.22, notes: 'C3 C3 G3 G3 A2 A2 E3 E3 F2 F2 C3 C3 G2 G2 B2 B2' },
        { drums: true, volume: 0.25, notes: 'k . h k s . h . k . h k s . h h' }] });
      this.sound.playMusic('sh-music', { volume: 0.28, fadeIn: 600 });
    },
    flap: function () {
      if (this.state === 'dead') return;
      if (this.state === 'ready') {
        this.state = 'play';
        this.tweens.killTweensOf(this.bird);
        this.bird.body.setAllowGravity(true);
        if (this.hint) { this.tweens.killTweensOf(this.hint); var h = this.hint; this.tweens.add({ targets: h, alpha: 0, duration: 200, onComplete: function () { h.destroy(); } }); this.hint = null; }
        this.nextPipe = 60;
      }
      this.bird.body.setVelocityY(-470);
      this.bird.play('sh-flap', false);
      this.bird.chain && this.bird.chain('sh-glide');
      this.sound.playSfx({ preset: 'jump', seed: 4 }, { volume: 0.18, rate: 1.4 });
    },
    spawnPair: function () {
      var margin = 130, gy = this.rng.between(margin + this.gap / 2, H - GROUND - margin - this.gap / 2);
      var top = this.pipes.get(W + 60, gy - this.gap / 2), bot = this.pipes.get(W + 60, gy + this.gap / 2);
      if (!top || !bot) return;
      top.setOrigin(0.5, 0).setFlipY(true); top.y = gy - this.gap / 2 - 700;
      bot.setOrigin(0.5, 0).setFlipY(false); bot.y = gy + this.gap / 2;
      // el volteo refleja dentro del marco: la boca de la de arriba queda abajo sin mover sus límites
      [top, bot].forEach(function (p) { p.body.setSize(84, 694, false).setOffset(6, 3).reset(p.x, p.y); p.depth = 10; p.tint = 0xffffff; });
      this.pairs.push({ top: top, bot: bot, scored: false, gy: gy });
      if (this.rng.chance(0.35)) { var st = this.stars.get(W + 60 + this.rng.between(-10, 10), gy); if (st) { st.body.setCircle(13, 2, 2).reset(st.x, st.y); st.depth = 11; st.setScale(1); } }
    },
    collect: function (st) {
      this.score += 3; this.popScore();
      this.sparkle.explode(12, st.x, st.y);
      MG.floatText(this, st.x, st.y - 20, '+3', 0xffd43b, 26);
      this.stars.killAndHide(st);
      this.sound.playSfx({ preset: 'pickup', seed: 9 }, { volume: 0.35 });
    },
    popScore: function () {
      this.scoreT.text = String(this.score);
      this.scoreT.setScale(1.25); this.tweens.killTweensOf(this.scoreT); this.tweens.add({ targets: this.scoreT, scaleX: 1, scaleY: 1, duration: 180, ease: 'backOut' });
      // dificultad y ciclo día/noche cada 15 puntos
      this.speed = Math.min(SPEED_MAX, SPEED0 + this.score * 3);
      this.gap = Math.max(GAP_MIN, GAP0 - this.score * 2);
      var phase = Math.floor(this.score / 15) % 2;
      if (phase !== this._phase) { this._phase = phase; this.tweens.killTweensOf(this.L); this.tweens.add({ targets: this.L, night: phase, duration: 2500, ease: 'sineInOut', onUpdate: this.L.apply }); }
    },
    die: function () {
      if (this.state === 'dead') return;
      var s = this, b = this.bird;
      this.state = 'dead';
      this.cameras.main.shake(260, 0.012); this.cameras.main.flash(120, 0xffffff, 0.8);
      this.feathers.explode(14, b.x, b.y);
      this.sound.playSfx({ preset: 'hurt', seed: 21 }, { volume: 0.5 });
      this.sound.stopMusic(400);
      b.anims && b.stop && b.stop(); b.setFrame(1);
      b.body.setVelocity(0, -200);
      this.pipes.getChildren().forEach(function (p) { if (p.body) p.body.setVelocityX(0); });
      this.time.delayedCall(1100, function () { s.results(); });
    },
    results: function () {
      var s = this, sc = this.score, best = MG.best('sky-hopper');
      var medal = null; for (var i = 0; i < MEDALS.length; i++) if (sc >= MEDALS[i][0]) { medal = MEDALS[i]; break; }
      var c = this.add.hud.container(W / 2, H * 0.45);
      var bg = new UG.Graphics().fillStyle(0xfff4e6, 1).fillRoundedRect(-200, -120, 400, 240, 24).lineStyle(6, 0x8f4a00, 1).strokeRoundedRect(-200, -120, 400, 240, 24);
      c.add(bg);
      var t1 = new UG.Text(-60, -70, 'PUNTOS', { fontFamily: MG.FONT, fontSize: 22, fontWeight: 'bold', fill: 0xe8590c }); t1.setOrigin(0.5); c.add(t1);
      var t2 = new UG.Text(-60, -30, String(sc), { fontFamily: MG.FONT, fontSize: 46, fontWeight: 'bold', fill: 0xffffff, stroke: 0x000000, strokeThickness: 6 }); t2.setOrigin(0.5); c.add(t2);
      var t3 = new UG.Text(-60, 30, 'RÉCORD ' + Math.max(best, sc), { fontFamily: MG.FONT, fontSize: 22, fontWeight: 'bold', fill: 0xe8590c }); t3.setOrigin(0.5); c.add(t3);
      var ring = new UG.Graphics(); ring.x = 105; ring.y = -5;
      if (medal) {
        ring.fillStyle(medal[2], 1).fillCircle(0, 0, 52).lineStyle(5, UG.Color.darken(medal[2], 0.35), 1).strokeCircle(0, 0, 52).fillStyle(0xffffff, 0.45).fillCircle(-16, -18, 12);
        var mt = new UG.Text(105, 70, medal[1], { fontFamily: MG.FONT, fontSize: 20, fontWeight: 'bold', fill: 0x8f4a00 }); mt.setOrigin(0.5); c.add(mt);
      } else ring.lineStyle(4, 0xced4da, 1).strokeCircle(0, 0, 52);
      c.add(ring);
      c.y = H + 200; this.tweens.add({ targets: c, y: H * 0.45, duration: 600, ease: 'backOut' });
      if (medal) { this.tweens.add({ targets: ring, scaleX: 1.15, scaleY: 1.15, duration: 400, yoyo: true, repeat: -1, delay: 700 }); this.sound.playSfx({ preset: 'powerup', seed: 12 }, { volume: 0.4 }); }
      this.time.delayedCall(2600, function () { s.scene.start('GameOver', { score: sc }); });
    },
    update: function (t, dt) {
      if (!this.bird) return;
      var sec = dt / 1000, b = this.bird, s = this;
      if (this.state !== 'dead') {
        var dx = this.speed * sec; this.L.scroll(dx);
        if (this.state === 'play') {
          this.dist += dx;
          if (this.dist >= this.nextPipe) { this.nextPipe = this.dist + Math.max(230, 300 - this.score * 2); this.spawnPair(); }
          var pipeTint = UG.Color.lerp(0xffffff, 0x9aa0d0, this.L.night);
          this.pipes.getChildren().forEach(function (p) { if (p.active) { p.body.setVelocityX(-s.speed); p.tint = pipeTint; } });
          this.stars.getChildren().forEach(function (st) { if (st.active) { st.body.setVelocityX(-s.speed); st.rotation += sec * 2; } });
        }
      } else if (b.y < H - GROUND - 18) b.rotation = Math.min(Math.PI / 2, b.rotation + sec * 8);
      // inclinación según velocidad vertical
      if (this.state === 'play') {
        var vy = b.body.velocity.y;
        b.rotation = UG.Math.clamp(vy / 700, -0.45, 1.3);
        if (b.y < 10) { b.y = 10; b.body.setVelocityY(Math.max(0, vy)); }
      }
      // suelo
      if (b.y > H - GROUND - 18 && this.state !== 'ready') {
        b.y = H - GROUND - 18; b.body.setVelocity(0, 0); b.body.setAllowGravity(false);
        if (this.state === 'play') this.die();
      }
      // puntos y reciclado
      for (var i = this.pairs.length - 1; i >= 0; i--) {
        var pr = this.pairs[i];
        if (!pr.scored && pr.bot.x < b.x && this.state === 'play') { pr.scored = true; this.score++; this.popScore(); this.sound.playSfx({ preset: 'coin', seed: 2 }, { volume: 0.3 }); }
        if (pr.bot.x < -70) { this.pipes.killAndHide(pr.top); this.pipes.killAndHide(pr.bot); this.pairs.splice(i, 1); }
      }
      this.stars.getChildren().forEach(function (st) { if (st.active && st.x < -40) s.stars.killAndHide(st); });
    }
  };

  MG.start({
    title: 'Sky Hopper', width: W, height: H, backgroundColor: 0x4dabf7,
    physics: { arcade: { gravity: { y: 1500 } } },
    scenes: [
      MG.menu({ id: 'sky-hopper', title: 'SKY HOPPER', subtitle: 'Vuela entre las tuberías', glow: '#1c7ed6', titleColors: [0xffffff, 0xfff3bf], buttonColor: 0xf08c00,
        help: 'Clic, toque o Espacio para aletear.\n★ = +3 puntos · cada 15 puntos cae la noche',
        background: function (s) {
          makeTextures(s); var L = world(s);
          var b = s.add.sprite(W / 2, H * 0.44, 'sh-bird').setScale(1.8); b.play('sh-glide');
          s.tweens.add({ targets: b, y: b.y - 20, duration: 600, yoyo: true, repeat: -1, ease: 'sineInOut' });
          s.tweens.add({ targets: L, night: 1, duration: 6000, yoyo: true, repeat: -1, ease: 'sineInOut', onUpdate: L.apply });
          s.events.on('update', function (t, dt) { L.scroll(dt * 0.12); });
        } }),
      Play,
      MG.gameOver({ id: 'sky-hopper', background: function (s) { makeTextures(s); world(s); } })]
  });
})();
