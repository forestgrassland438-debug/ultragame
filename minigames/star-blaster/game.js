/* Star Blaster — shoot'em up vertical. Prueba: física arcade con pools, partículas, bloom/shockwave,
 * shake/flash de cámara, tweens, BitmapText, TilingSprite (parallax), audio sintetizado y música. */
(function () {
  'use strict';
  var W = 540, H = 900;

  function makeTextures(scene) {
    var T = scene.textures;
    if (T.exists('ship')) return;
    T.generate('ship', 64, 72, function (c) {
      var g = c.createLinearGradient(0, 0, 0, 72); g.addColorStop(0, '#e7f5ff'); g.addColorStop(0.5, '#74c0fc'); g.addColorStop(1, '#1864ab');
      c.fillStyle = g; c.beginPath(); c.moveTo(32, 2); c.lineTo(46, 34); c.lineTo(62, 58); c.lineTo(44, 54); c.lineTo(38, 68); c.lineTo(26, 68); c.lineTo(20, 54); c.lineTo(2, 58); c.lineTo(18, 34); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 2; c.stroke();
      var k = c.createRadialGradient(32, 30, 1, 32, 32, 10); k.addColorStop(0, '#fff'); k.addColorStop(1, '#4dabf7'); c.fillStyle = k; c.beginPath(); c.ellipse(32, 32, 6, 11, 0, 0, Math.PI * 2); c.fill();
    });
    var enemy = function (key, col1, col2, shape) {
      T.generate(key, 56, 48, function (c) {
        var g = c.createLinearGradient(0, 0, 0, 48); g.addColorStop(0, col1); g.addColorStop(1, col2); c.fillStyle = g;
        c.beginPath();
        if (shape === 0) { c.moveTo(4, 6); c.lineTo(52, 6); c.lineTo(40, 30); c.lineTo(28, 44); c.lineTo(16, 30); }
        else if (shape === 1) { c.moveTo(28, 44); c.lineTo(54, 10); c.lineTo(36, 18); c.lineTo(28, 4); c.lineTo(20, 18); c.lineTo(2, 10); }
        else { c.arc(28, 24, 20, 0, Math.PI * 2); }
        c.closePath(); c.fill(); c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 2; c.stroke();
        c.fillStyle = 'rgba(255,255,255,0.9)'; c.beginPath(); c.arc(28, 20, 5, 0, Math.PI * 2); c.fill();
      });
    };
    enemy('e0', '#ffa8a8', '#c92a2a', 0); enemy('e1', '#d0bfff', '#6741d9', 1); enemy('e2', '#ffec99', '#e67700', 2);
    T.generate('boss', 200, 140, function (c) {
      var g = c.createLinearGradient(0, 0, 0, 140); g.addColorStop(0, '#ff8787'); g.addColorStop(0.6, '#862e9c'); g.addColorStop(1, '#212529'); c.fillStyle = g;
      c.beginPath(); c.moveTo(100, 136); c.lineTo(20, 70); c.lineTo(0, 10); c.lineTo(60, 30); c.lineTo(100, 4); c.lineTo(140, 30); c.lineTo(200, 10); c.lineTo(180, 70); c.closePath(); c.fill();
      c.strokeStyle = '#ffe3e3'; c.lineWidth = 3; c.stroke();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(100, 60, 16, 0, Math.PI * 2); c.fill(); c.fillStyle = '#f03e3e'; c.beginPath(); c.arc(100, 60, 9, 0, Math.PI * 2); c.fill();
    });
    T.generate('bullet', 10, 26, function (c) { var g = c.createLinearGradient(0, 0, 0, 26); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(99,230,190,0.2)'); c.fillStyle = g; c.beginPath(); c.ellipse(5, 13, 4, 12, 0, 0, Math.PI * 2); c.fill(); });
    T.generate('ebullet', 16, 16, function (c) { var g = c.createRadialGradient(8, 8, 1, 8, 8, 8); g.addColorStop(0, '#fff'); g.addColorStop(0.4, '#ff6b6b'); g.addColorStop(1, 'rgba(255,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, 16, 16); });
    MG.glowTexture(scene, 'spark', 24, 'rgba(255,255,255,1)');
    MG.glowTexture(scene, 'flame', 20, 'rgba(120,200,255,1)');
    MG.starfield(scene, 'stars1', 256, 256, 70, 'a');
    MG.starfield(scene, 'stars2', 256, 256, 25, 'b');
    ['P', 'S', 'B'].forEach(function (l, i) {
      T.generate('pow' + l, 40, 40, function (c) {
        var cols = ['#51cf66', '#339af0', '#f76707'];
        var g = c.createRadialGradient(20, 16, 2, 20, 20, 19); g.addColorStop(0, '#fff'); g.addColorStop(0.5, cols[i]); g.addColorStop(1, 'rgba(0,0,0,0.3)');
        c.fillStyle = g; c.beginPath(); c.arc(20, 20, 18, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
        c.fillStyle = '#fff'; c.font = 'bold 20px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(l, 20, 21);
      });
    });
    UG.BitmapFont.from('sb-hud', { fontFamily: MG.FONT, fontSize: 26, fontWeight: 'bold', fill: [0xffffff, 0x9fe6ff], stroke: 0x0b1a3a, strokeThickness: 4 });
  }

  var MUSIC = { bpm: 132, tracks: [
    { wave: 'square', volume: 0.12, duty: 0.25, notes: 'A3 . A3 C4 . A3 E4 . G3 . G3 B3 . G3 D4 . F3 . F3 A3 . F3 C4 . E3 . E3 G#3 . B3 E4 .' },
    { wave: 'triangle', volume: 0.28, notes: 'A1 - - - A1 - E2 - G1 - - - G1 - D2 - F1 - - - F1 - C2 - E1 - - - E1 - B1 -' },
    { drums: true, volume: 0.5, notes: 'k . h . s . h h k k h . s . h . k . h . s . h h k . h k s . h h' }
  ] };

  function background(scene) {
    scene.cameras.main.setBackgroundColor(0x05060f);
    var g = scene.add.graphics();
    g.fillGradientStyle(0x0b1030, 0x0b1030, 0x160a2a, 0x04040c, 1).fillRect(0, 0, W, H);
    g.depth = -10;
    var s1 = scene.add.tileSprite(W / 2, H / 2, W, H, 'stars1'); s1.depth = -9;
    var s2 = scene.add.tileSprite(W / 2, H / 2, W, H, 'stars2').setTileScale(1.6); s2.depth = -8; s2.alpha = 0.8;
    scene.events.on('update', function (t, dt) { s1.tilePositionY += dt * 0.03; s2.tilePositionY += dt * 0.09; });
    return [s1, s2];
  }

  var Boot = { key: 'Boot', create: function () { makeTextures(this); this.scene.start('Menu'); } };

  var Play = {
    key: 'Play',
    create: function () {
      var s = this;
      makeTextures(this);
      background(this);
      this.score = 0; this.lives = 3; this.power = 1; this.wave = 0; this.shield = 0; this.bombs = 1; this.over = false;
      this.fireTimer = 0; this.invul = 0;
      var phys = this.physics;
      phys.world.setBounds(0, 0, W, H);
      this.player = phys.add.sprite(W / 2, H - 120, 'ship');
      this.player.body.setCollideWorldBounds(true).setSize(34, 44);
      this.player.depth = 10;
      this.shieldG = this.add.graphics().lineStyle(3, 0x74c0fc, 0.8).strokeCircle(0, 0, 44).fillStyle(0x74c0fc, 0.12).fillCircle(0, 0, 44);
      this.shieldG.visible = false; this.shieldG.depth = 11;
      this.flame = this.add.particles('flame', { speed: { min: 60, max: 140 }, angle: { min: 80, max: 100 }, lifespan: 380, scale: { start: 0.9, end: 0 }, alpha: { start: 0.9, end: 0 }, color: [0xffffff, 0x74c0fc, 0x3b5bdb], blendMode: 'add', frequency: 12, quantity: 2, follow: this.player, followOffset: { x: 0, y: 34 } });
      this.flame.depth = 9;
      this.boom = this.add.particles('spark', { speed: { min: 80, max: 420 }, lifespan: { min: 300, max: 900 }, scale: { start: 1.3, end: 0 }, color: [0xffffff, 0xffe066, 0xff6b6b, 0x5f3dc4], blendMode: 'add', frequency: -1, drag: 1.5, maxParticles: 4000 });
      this.boom.depth = 20;
      this.bullets = phys.add.group({ maxSize: 160, defaultKey: 'bullet' });
      this.ebullets = phys.add.group({ maxSize: 240, defaultKey: 'ebullet' });
      this.enemies = phys.add.group({ maxSize: 80 });
      this.powerups = phys.add.group({ maxSize: 12 });
      phys.add.overlap(this.bullets, this.enemies, function (b, e) { if (b.active && e.active) { s.killBullet(b); s.hitEnemy(e, 1); } });
      phys.add.overlap(this.player, this.ebullets, function (p, b) { if (b.active) { s.ebullets.killAndHide(b); s.hitPlayer(); } });
      phys.add.overlap(this.player, this.enemies, function (p, e) { if (e.active && !e.isBoss) { s.hitEnemy(e, 99); s.hitPlayer(); } });
      phys.add.overlap(this.player, this.powerups, function (p, u) { if (u.active) s.collect(u); });
      // controles
      this.keys = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys('W,A,S,D');
      this.input.keyboard.on('keydown-X', function () { s.bomb(); });
      this.input.keyboard.on('keydown-B', function () { s.bomb(); });
      this.dragging = false;
      this.input.on('pointerdown', function (p) { s.dragging = true; s.dragOff = { x: s.player.x - p.x, y: s.player.y - p.y }; if (p.y > H - 70 && p.x < 90) s.bomb(); });
      this.input.on('pointermove', function (p) { if (s.dragging && p.isDown && !s.over) { s.player.x = UG.Math.clamp(p.x + s.dragOff.x, 20, W - 20); s.player.y = UG.Math.clamp(p.y + s.dragOff.y, 60, H - 30); } });
      this.input.on('pointerup', function () { s.dragging = false; });
      // HUD
      this.scoreT = this.add.hud.bitmapText(16, 52, 'sb-hud', 'PUNTOS 0');
      this.waveT = this.add.hud.bitmapText(W - 16, 52, 'sb-hud', 'OLEADA 1').setOrigin(1, 0);
      this.livesT = this.add.hud.bitmapText(16, H - 44, 'sb-hud', '');
      this.bombBtn = MG.text(this, 16, H - 84, '', 20, 0xffc078, { hud: true, ox: 0, oy: 0.5, stroke: 3 });
      this.bossBar = this.add.hud.graphics(); this.bossBar.visible = false;
      MG.hudButtons(this);
      this.updateHud();
      // post-proceso
      this.bloom = new UG.BloomFilter({ threshold: 0.45, blur: 8, quality: 2, bloomScale: 1.1 });
      this.wave3 = null;
      this.cameras.main.setFilters([this.bloom]);
      this.sound.addMusic('sb-music', MUSIC);
      this.sound.playMusic('sb-music', { volume: 0.32, fadeIn: 800 });
      this.time.delayedCall(800, function () { s.nextWave(); });
    },
    updateHud: function () {
      this.scoreT.text = 'PUNTOS ' + this.score;
      this.waveT.text = 'OLEADA ' + Math.max(1, this.wave);
      var hearts = ''; for (var i = 0; i < this.lives; i++) hearts += '♥ ';
      this.livesT.text = hearts + ' P' + this.power + (this.shield ? '  S' : '');
      this.bombBtn.text = '💣 x' + this.bombs + (MG.isTouch ? '' : '  (X)');
    },
    spawnEnemy: function (type, x, y, pattern, delay) {
      var s = this;
      var e = this.enemies.get(x, y);
      if (!e) return null;
      e.setTexture('e' + type); e.setOrigin(0.5); e.setScale(1); e.rotation = 0; e.tint = 0xffffff; e.alpha = 1;
      e.body.setSize(44, 36); e.body.setVelocity(0, 0);
      e.hp = [2, 3, 5][type] + Math.floor(this.wave / 4); e.type2 = type; e.pattern = pattern; e.t = -(delay || 0); e.baseX = x; e.isBoss = false; e.score = [100, 150, 250][type];
      e.fireAt = 900 + this.rng.float() * 2000;
      return e;
    },
    nextWave: function () {
      if (this.over) return;
      this.wave++;
      var s = this, w = this.wave, rng = this.rng;
      this.updateHud();
      var banner = MG.text(this, W / 2, H * 0.4, w % 5 === 0 ? '⚠ JEFE ⚠' : 'OLEADA ' + w, 46, w % 5 === 0 ? 0xff6b6b : 0x9fe6ff, { hud: true, stroke: 6 });
      banner.alpha = 0; banner.setScale(0.5);
      this.tweens.chain({ targets: banner, tweens: [{ alpha: 1, scaleX: 1, scaleY: 1, duration: 350, ease: 'backOut' }, { alpha: 0, duration: 400, delay: 700, onComplete: function () { banner.destroy(); } }] });
      if (w % 5 === 0) { this.time.delayedCall(900, function () { s.spawnBoss(); }); return; }
      var n = 6 + Math.min(10, w * 2), kind = w % 3;
      for (var i = 0; i < n; i++) {
        var type = rng.int(0, Math.min(2, Math.floor(w / 2)));
        if (kind === 0) this.spawnEnemy(type, 60 + (i % 6) * 84, -40 - Math.floor(i / 6) * 70, 'line', 0);
        else if (kind === 1) this.spawnEnemy(type, W / 2 + (i - n / 2) * 40, -40 - Math.abs(i - n / 2) * 30, 'sine', i * 90);
        else this.spawnEnemy(type, rng.between(40, W - 40), -40 - i * 60, 'dive', 0);
      }
    },
    spawnBoss: function () {
      var e = this.enemies.get(W / 2, -120);
      e.setTexture('boss'); e.setOrigin(0.5); e.tint = 0xffffff; e.alpha = 1;
      e.body.setSize(180, 110); e.isBoss = true; e.hp = e.maxHp = 60 + this.wave * 12; e.pattern = 'boss'; e.t = 0; e.fireAt = 800; e.score = 5000;
      this.boss = e; this.bossBar.visible = true;
    },
    hitEnemy: function (e, dmg) {
      e.hp -= dmg;
      if (e.hp > 0) {
        e.tint = 0xff8787; var s = this;
        this.time.delayedCall(60, function () { if (e.active) e.tint = 0xffffff; });
        this.sound.playSfx({ preset: 'hit', seed: 5 }, { volume: 0.25, rate: 1.4 });
        return;
      }
      this.boom.explode(e.isBoss ? 220 : 40, e.x, e.y);
      this.cameras.main.shake(e.isBoss ? 600 : 120, e.isBoss ? 0.02 : 0.006);
      this.sound.playSfx({ preset: 'explosion', seed: e.isBoss ? 9 : 3 }, { volume: e.isBoss ? 0.9 : 0.45 });
      this.score += e.score; MG.floatText(this, e.x, e.y, '+' + e.score, 0xffe066, e.isBoss ? 34 : 20);
      if (this.rng.chance(e.isBoss ? 1 : 0.1)) this.dropPower(e.x, e.y);
      if (e.isBoss) { this.boss = null; this.bossBar.visible = false; this.cameras.main.flash(300, 0xffffff, 0.6); this.shock(e.x, e.y); }
      this.enemies.killAndHide(e);
      this.updateHud();
    },
    dropPower: function (x, y) {
      var kinds = ['P', 'S', 'B'], k = this.rng.pick(kinds);
      var u = this.powerups.get(x, y, 'pow' + k); if (!u) return;
      u.setTexture('pow' + k); u.kind = k; u.body.setVelocity(0, 90); u.setScale(1);
      this.tweens.add({ targets: u, scaleX: 1.2, scaleY: 1.2, duration: 400, yoyo: true, repeat: -1 });
    },
    collect: function (u) {
      if (u.kind === 'P') this.power = Math.min(4, this.power + 1);
      else if (u.kind === 'S') this.shield = 1;
      else this.bombs++;
      this.sound.playSfx({ preset: 'powerup', seed: 4 }, { volume: 0.6 });
      MG.floatText(this, u.x, u.y, { P: '¡PODER!', S: '¡ESCUDO!', B: '+BOMBA' }[u.kind], 0x8ce99a);
      this.tweens.killTweensOf(u); this.powerups.killAndHide(u);
      this.updateHud();
    },
    shock: function (x, y) {
      if (this.game.rendererType === 'canvas') return;
      var f = new UG.ShockwaveFilter({ x: x, y: y, amplitude: 40, wavelength: 180, speed: 900, brightness: 1.4, radius: 900 });
      var cam = this.cameras.main, s = this;
      cam.setFilters([f, this.bloom]);
      this.time.delayedCall(1100, function () { if (s.cameras) cam.setFilters([s.bloom]); });
    },
    bomb: function () {
      if (this.over || this.bombs <= 0) return;
      this.bombs--; var s = this;
      this.shock(this.player.x, this.player.y);
      this.cameras.main.flash(250, 0xffc078, 0.8); this.cameras.main.shake(400, 0.015);
      this.sound.playSfx({ preset: 'explosion', seed: 12 });
      this.enemies.getChildren().slice().forEach(function (e) { if (e.active) s.hitEnemy(e, e.isBoss ? 25 : 99); });
      this.ebullets.getChildren().forEach(function (b) { if (b.active) s.ebullets.killAndHide(b); });
      this.updateHud();
    },
    hitPlayer: function () {
      if (this.invul > 0 || this.over) return;
      if (this.shield) { this.shield = 0; this.invul = 800; this.sound.playSfx({ preset: 'hit', seed: 8 }); this.updateHud(); return; }
      this.lives--; this.power = Math.max(1, this.power - 1); this.invul = 2000;
      this.boom.explode(60, this.player.x, this.player.y);
      this.cameras.main.shake(350, 0.02); this.cameras.main.flash(200, 0xff0000, 0.5);
      this.sound.playSfx({ preset: 'explosion', seed: 21 }, { volume: 0.8 });
      this.input.vibrate(120);
      this.updateHud();
      if (this.lives <= 0) this.gameOver();
    },
    killBullet: function (b) { this.bullets.killAndHide(b); },
    gameOver: function () {
      this.over = true; var s = this;
      this.player.visible = false; this.flame.stop(); this.sound.stopMusic(800);
      this.time.delayedCall(1600, function () { s.scene.start('GameOver', { score: s.score }); });
    },
    fire: function () {
      var p = this.player, lvl = this.power, spreads = [[0], [-8, 8], [-14, 0, 14], [-20, -7, 7, 20]][lvl - 1];
      for (var i = 0; i < spreads.length; i++) {
        var b = this.bullets.get(p.x + spreads[i], p.y - 34);
        if (!b) continue;
        b.setTexture('bullet'); b.rotation = spreads[i] * 0.012; b.body.setSize(8, 22);
        b.body.setVelocity(spreads[i] * 12, -900);
      }
      this.sound.playSfx({ preset: 'laser', seed: 2 }, { volume: 0.12 });
    },
    enemyFire: function (e, angle, speed) {
      var b = this.ebullets.get(e.x, e.y + 20); if (!b) return;
      b.setTexture('ebullet'); b.body.setCircle(6, 2, 2); b.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    },
    update: function (time, dt) {
      if (!this.player) return;
      var s = this, p = this.player, sp = 420;
      this.invul = Math.max(0, this.invul - dt);
      p.alpha = this.invul > 0 ? (Math.floor(time / 80) % 2 ? 0.35 : 1) : 1;
      if (!this.over) {
        var vx = 0, vy = 0, k = this.keys, w = this.wasd;
        if (k.left.isDown || w.A.isDown) vx -= sp; if (k.right.isDown || w.D.isDown) vx += sp;
        if (k.up.isDown || w.W.isDown) vy -= sp; if (k.down.isDown || w.S.isDown) vy += sp;
        p.body.setVelocity(vx, vy);
        p.rotation = UG.Math.damp(p.rotation, vx * 0.0006, 12, dt / 1000);
        this.fireTimer -= dt;
        if (this.fireTimer <= 0) { this.fire(); this.fireTimer = 130; }
      } else p.body.setVelocity(0, 0);
      this.shieldG.visible = !!this.shield && !this.over; this.shieldG.x = p.x; this.shieldG.y = p.y; this.shieldG.rotation += dt * 0.002;
      // balas fuera de pantalla -> pool
      this.bullets.getChildren().forEach(function (b) { if (b.active && b.y < -30) s.bullets.killAndHide(b); });
      this.ebullets.getChildren().forEach(function (b) { if (b.active && (b.y > H + 30 || b.y < -30 || b.x < -30 || b.x > W + 30)) s.ebullets.killAndHide(b); });
      this.powerups.getChildren().forEach(function (u) { if (u.active && u.y > H + 30) { s.tweens.killTweensOf(u); s.powerups.killAndHide(u); } });
      // enemigos
      var alive = 0;
      this.enemies.getChildren().forEach(function (e) {
        if (!e.active) return;
        alive++;
        e.t += dt;
        if (e.t < 0) { e.body.setVelocity(0, 0); return; }
        var t = e.t / 1000;
        if (e.pattern === 'line') e.body.setVelocity(Math.sin(t * 2 + e.baseX) * 60, 110 + s.wave * 6);
        else if (e.pattern === 'sine') e.body.setVelocity(Math.cos(t * 2.4) * 180, 130);
        else if (e.pattern === 'dive') { var dx = p.x - e.x; e.body.setVelocity(UG.Math.clamp(dx * 1.4, -220, 220), 170 + s.wave * 8); e.rotation = -e.body.velocity.x * 0.002; }
        else if (e.pattern === 'boss') {
          if (e.y < 170) e.body.setVelocity(0, 120); else e.body.setVelocity(Math.sin(t * 0.9) * 160, 0);
          e.fireAt -= dt;
          if (e.fireAt <= 0 && e.y >= 150) {
            e.fireAt = 900 - Math.min(500, s.wave * 30);
            var base = Math.atan2(p.y - e.y, p.x - e.x);
            for (var a = -3; a <= 3; a++) s.enemyFire(e, base + a * 0.16, 260);
            if (s.rng.chance(0.4)) for (var r = 0; r < 16; r++) s.enemyFire(e, r / 16 * Math.PI * 2 + t, 180);
            s.sound.playSfx({ preset: 'shoot', seed: 30 }, { volume: 0.2 });
          }
          var g = s.bossBar; g.clear().fillStyle(0x000000, 0.5).fillRoundedRect(60, 88, W - 120, 14, 7).fillGradientStyle(0xff6b6b, 0xffd43b, 0xff6b6b, 0xffd43b, 1).fillRoundedRect(62, 90, (W - 124) * Math.max(0, e.hp / e.maxHp), 10, 5);
          return;
        }
        e.fireAt -= dt;
        if (e.fireAt <= 0 && e.y > 0 && e.y < H * 0.6) { e.fireAt = 1500 + s.rng.float() * 2500 - s.wave * 40; s.enemyFire(e, Math.atan2(p.y - e.y, p.x - e.x), 220 + s.wave * 8); }
        if (e.y > H + 60) s.enemies.killAndHide(e);
      });
      if (!this.over && alive === 0 && !this._waiting) { this._waiting = true; this.time.delayedCall(900, function () { s._waiting = false; s.nextWave(); }); }
    }
  };

  MG.start({
    title: 'Star Blaster', width: W, height: H, backgroundColor: 0x05060f,
    physics: { arcade: { gravity: { y: 0 } } },
    scenes: [Boot,
      MG.menu({ id: 'star-blaster', title: 'STAR BLASTER', subtitle: 'Shoot\'em up vertical', glow: '#4dabf7', titleColors: [0xffffff, 0x74c0fc],
        help: 'Flechas / WASD para moverte · disparo automático\nX = bomba · P = pausa\nRecoge P (poder), S (escudo) y B (bombas)',
        touchHelp: 'Arrastra para mover la nave · disparo automático\nToca abajo a la izquierda para lanzar una bomba',
        background: function (s) { makeTextures(s); background(s); var sh = s.add.sprite(W / 2, H * 0.44, 'ship').setScale(1.4); s.tweens.add({ targets: sh, y: sh.y - 14, duration: 900, yoyo: true, repeat: -1, ease: 'sineInOut' }); s.cameras.main.setFilters([new UG.BloomFilter({ threshold: 0.4, blur: 8 })]); },
        music: { bpm: 100, tracks: [{ wave: 'triangle', volume: 0.25, notes: 'A2 - E3 - A3 - E3 - F2 - C3 - F3 - C3 - G2 - D3 - G3 - D3 - E2 - B2 - E3 - B2 -' }, { wave: 'square', duty: 0.2, volume: 0.07, notes: 'E5 - . . C5 - . . A4 - - . B4 - . . C5 - . . A4 - . . G4 - - . B4 - - .' }] } }),
      Play,
      MG.gameOver({ id: 'star-blaster', background: function (s) { makeTextures(s); background(s); } })]
  });
})();
