/* Neon Asteroids — vista cenital 360°. Prueba: rotación/empuje con amortiguación, envoltura de pantalla
 * (physics.world.wrap), división de asteroides, pools, OVNI con disparo apuntado, hiperespacio, cadena de
 * post-proceso en cámara (Bloom + Aberración cromática + CRT + Shockwave), partículas dirigidas, joystick 360°. */
(function () {
  'use strict';
  var W = 960, H = 600;
  var SIZES = [{ r: 54, score: 20, speed: [40, 90] }, { r: 30, score: 50, speed: [70, 140] }, { r: 16, score: 100, speed: [110, 200] }];
  var ROCK_COLORS = ['#ff4fd8', '#ffb238', '#3dff9c', '#7a8cff'];

  function neon(c, color, width, blur) { c.strokeStyle = color; c.lineWidth = width; c.shadowColor = color; c.shadowBlur = blur; c.lineJoin = 'round'; c.lineCap = 'round'; }
  function makeTextures(scene) {
    var T = scene.textures;
    if (T.exists('na-ship')) return;
    T.generate('na-ship', 52, 52, function (c) {
      neon(c, '#5ff7ff', 3, 10);
      c.beginPath(); c.moveTo(46, 26); c.lineTo(8, 9); c.lineTo(16, 26); c.lineTo(8, 43); c.closePath(); c.stroke();
      c.fillStyle = 'rgba(95,247,255,0.12)'; c.fill();
      neon(c, '#ffffff', 1.5, 4); c.beginPath(); c.moveTo(34, 26); c.lineTo(22, 21); c.lineTo(22, 31); c.closePath(); c.stroke();
    });
    T.generate('na-shield', 80, 80, function (c) {
      neon(c, 'rgba(95,247,255,0.9)', 2, 12); c.beginPath(); c.arc(40, 40, 32, 0, Math.PI * 2); c.stroke();
      var g = c.createRadialGradient(40, 40, 10, 40, 40, 34); g.addColorStop(0, 'rgba(95,247,255,0)'); g.addColorStop(1, 'rgba(95,247,255,0.25)'); c.fillStyle = g; c.fill();
    });
    // 3 tamaños x 4 variantes de roca poligonal (deterministas)
    var rng = new UG.RNG('neon-rocks');
    SIZES.forEach(function (sz, si) {
      for (var v = 0; v < 4; v++) {
        var size = sz.r * 2 + 16;
        T.generate('na-rock' + si + v, size, size, function (c, w, h) {
          var n = 9 + rng.int(0, 4), cx = w / 2, cy = h / 2;
          neon(c, ROCK_COLORS[v], si === 2 ? 2 : 2.6, 9);
          c.beginPath();
          for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2, r = sz.r * (0.72 + rng.float() * 0.3); if (i) c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else c.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
          c.closePath(); c.fillStyle = 'rgba(10,6,30,0.85)'; c.fill(); c.stroke();
          // cráteres
          c.shadowBlur = 0; c.lineWidth = 1; c.strokeStyle = 'rgba(255,255,255,0.25)';
          for (var k = 0; k < 3 - si; k++) { c.beginPath(); c.arc(cx + rng.between(-sz.r * 0.35, sz.r * 0.35), cy + rng.between(-sz.r * 0.35, sz.r * 0.35), sz.r * rng.between(0.1, 0.2), 0, Math.PI * 2); c.stroke(); }
        });
      }
    });
    T.generate('na-ufo', 64, 36, function (c) {
      neon(c, '#ff5f6d', 2.5, 10);
      c.beginPath(); c.ellipse(32, 22, 28, 9, 0, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(32, 17, 11, Math.PI, 0); c.closePath(); c.stroke();
      c.fillStyle = 'rgba(255,95,109,0.18)'; c.fill();
      c.shadowBlur = 6; c.fillStyle = '#fff3bf'; for (var i = 0; i < 5; i++) { c.beginPath(); c.arc(12 + i * 10, 23, 2, 0, 6.3); c.fill(); }
    });
    MG.glowTexture(scene, 'na-bullet', 14, 'rgba(180,255,255,1)');
    MG.glowTexture(scene, 'na-ebullet', 14, 'rgba(255,120,130,1)');
    MG.glowTexture(scene, 'na-spark', 12, 'rgba(255,255,255,1)');
    T.generate('na-line', 4, 18, function (c) { c.fillStyle = '#fff'; c.fillRect(0, 0, 4, 18); });
    MG.starfield(scene, 'na-stars', 512, 512, 140, 'neon-stars');
  }

  function background(scene) {
    scene.cameras.main.setBackgroundColor(0x02030a);
    var st = scene.add.tileSprite(W / 2, H / 2, W, H, 'na-stars'); st.alpha = 0.7; st.depth = -20;
    var g = scene.add.graphics();
    // rejilla de neón con perspectiva en la parte inferior
    g.lineStyle(1, 0x7a3cff, 0.28);
    for (var i = 0; i <= 24; i++) { var x = i / 24 * W; g.lineBetween(W / 2 + (x - W / 2) * 0.35, H * 0.62, x, H); }
    for (var j = 0; j < 8; j++) { var t = j / 7, y = H * 0.62 + (H * 0.38) * t * t; g.lineBetween(0, y, W, y); }
    g.depth = -19; g.alpha = 0.6; g.cacheAsTexture = true;
    scene.tweens.add({ targets: st, tilePositionX: 512, duration: 60000, repeat: -1 });
    return st;
  }

  function postFx(scene, strong) {
    var cam = scene.cameras.main;
    if (scene.game.rendererType === 'canvas') { cam.setFilters([new UG.BloomFilter({ bloomScale: 1 })]); return {}; }
    var fx = {
      bloom: new UG.BloomFilter({ threshold: 0.28, knee: 0.3, blur: 9, quality: 2, bloomScale: 1.5 }),
      rgb: new UG.ChromaticAberrationFilter({ offset: 1.5, radial: true }),
      crt: new UG.CRTFilter({ curvature: 0.6, lineWidth: 2, lineContrast: 0.18, noise: 0.05, vignetting: 0.32, flicker: 0.25, chromatic: 0 }),
      shock: new UG.ShockwaveFilter({ amplitude: 18, wavelength: 120, speed: 700, radius: 420, autoPlay: false })
    };
    fx.shock.enabled = false;
    cam.setFilters(strong === false ? [fx.bloom] : [fx.bloom, fx.shock, fx.rgb, fx.crt]);
    return fx;
  }

  var Play = {
    key: 'Play',
    create: function () {
      var s = this; makeTextures(this); this.stars = background(this);
      this.fxLevel = MG.isTouch ? 1 : 2;
      this.fx = postFx(this, this.fxLevel === 2);
      this.score = 0; this.lives = 3; this.wave = 0; this.over = false; this.fireCd = 0; this.invuln = 0; this.hyperCd = 0; this.ufoTimer = 14000;
      var P = this.physics;
      P.world.setBounds(0, 0, W, H); P.world.setBoundsCollision(false, false, false, false);
      this.rocks = P.add.group({ maxSize: 64 });
      this.bullets = P.add.group({ maxSize: 24, defaultKey: 'na-bullet' });
      this.ebullets = P.add.group({ maxSize: 24, defaultKey: 'na-ebullet' });
      this.ship = P.add.image(W / 2, H / 2, 'na-ship');
      this.ship.body.setCircle(14, 12, 12).setDamping(true).setDrag(0.55, 0.55).setMaxSpeed(430);
      this.ship.rotation = -Math.PI / 2;
      this.shield = this.add.image(W / 2, H / 2, 'na-shield'); this.shield.blendMode = 'add'; this.shield.visible = false;
      this.ufo = null;
      // partículas: motor (emisión manual dirigida), explosiones y líneas de chispa estiradas
      this.flame = this.add.particles('na-spark', { lifespan: { min: 180, max: 380 }, speed: { min: 120, max: 260 }, scale: { start: 1, end: 0 }, blendMode: 'add', frequency: -1, color: [0xffffff, 0x5ff7ff, 0x7a3cff], maxParticles: 600 });
      this.boom = this.add.particles('na-spark', { lifespan: { min: 300, max: 900 }, speed: { min: 40, max: 320 }, scale: { start: 1.3, end: 0 }, blendMode: 'add', frequency: -1, drag: 0.6, maxParticles: 2500 });
      this.debris = this.add.particles('na-line', { lifespan: { min: 400, max: 1100 }, speed: { min: 60, max: 240 }, scale: { start: 0.6, end: 0.1 }, alpha: { start: 1, end: 0 }, rotationSpeed: { min: -360, max: 360 }, blendMode: 'add', frequency: -1, maxParticles: 800 });
      P.add.overlap(this.bullets, this.rocks, function (b, r) { if (b.active && r.active) { s.bullets.killAndHide(b); s.splitRock(r, b.body.velocity); } });
      P.add.overlap(this.ship, this.rocks, function (sh, r) { if (r.active && s.invuln <= 0 && !s.over && s.ship.visible) { s.splitRock(r, null); s.shipHit(); } });
      P.add.overlap(this.ship, this.ebullets, function (sh, b) { if (b.active && s.invuln <= 0 && s.ship.visible) { s.ebullets.killAndHide(b); s.shipHit(); } });
      P.add.overlap(this.bullets, this.ebullets, function (a, b) { if (a.active && b.active) { s.bullets.killAndHide(a); s.ebullets.killAndHide(b); s.boom.setParticleTint([0xffffff, 0xff5f6d]); s.boom.explode(6, b.x, b.y); } });
      // controles
      this.keys = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys('W,A,D,SPACE,SHIFT,H,F');
      this.input.keyboard.on('keydown-F', function () { s.cycleFx(); });
      if (MG.isTouch) {
        this.joy = this.add.joystick({ x: 120, y: H - 110, radius: 62 });
        this.btnFire = this.add.virtualButton({ x: W - 100, y: H - 110, radius: 48, label: '●', color: 0x1098ad });
        this.btnHyper = this.add.virtualButton({ x: W - 200, y: H - 70, radius: 34, label: 'H', color: 0x7048e8 });
      }
      // HUD
      this.scoreT = MG.text(this, 70, 26, '', 24, 0x5ff7ff, { hud: true, ox: 0 });
      this.infoT = MG.text(this, W / 2, 26, '', 22, 0xffffff, { hud: true });
      this.livesG = this.add.hud.graphics();
      this.hyperT = MG.text(this, 70, 56, '', 15, 0xb197fc, { hud: true, ox: 0, stroke: 3, style: { fontWeight: 'normal' } });
      MG.hudButtons(this);
      this.refresh();
      this.sound.addMusic('na-music', { bpm: 128, tracks: [
        { wave: 'saw', volume: 0.05, notes: 'A2 A3 A2 A3 G2 G3 G2 G3 F2 F3 F2 F3 E2 E3 E2 E3' },
        { wave: 'square', volume: 0.035, notes: 'A4 - C5 - E5 - C5 - G4 - B4 - D5 - B4 - F4 - A4 - C5 - A4 - E4 - G#4 - B4 - G#4 -' },
        { drums: true, volume: 0.32, notes: 'k . h . s . h k k . h . s . h h' }] });
      this.sound.playMusic('na-music', { volume: 0.3, fadeIn: 800 });
      this.nextWave();
    },
    cycleFx: function () {
      if (!this.fx.bloom) return;
      this.fxLevel = (this.fxLevel + 1) % 3;
      var f = this.fx;
      this.cameras.main.setFilters(this.fxLevel === 0 ? null : this.fxLevel === 1 ? [f.bloom] : [f.bloom, f.shock, f.rgb, f.crt]);
      MG.floatText(this, W / 2, H - 60, ['Efectos: apagados', 'Efectos: bloom', 'Efectos: bloom + CRT + RGB'][this.fxLevel], 0xb197fc, 18);
    },
    nextWave: function () {
      this.wave++;
      var n = Math.min(3 + this.wave, 11), s = this;
      for (var i = 0; i < n; i++) {
        // aparecen lejos de la nave
        var a = this.rng.angle(), d = this.rng.between(260, 420);
        this.spawnRock(0, W / 2 + Math.cos(a) * d, H / 2 + Math.sin(a) * d * 0.7);
      }
      var banner = MG.text(this, W / 2, H * 0.36, 'OLEADA ' + this.wave, 46, 0xff4fd8, { hud: true, stroke: 5 });
      banner.alpha = 0;
      this.tweens.chain({ targets: banner, tweens: [{ alpha: 1, duration: 300 }, { alpha: 0, delay: 900, duration: 500, onComplete: function () { banner.destroy(); } }] });
      this.invuln = Math.max(this.invuln, 1500);
      this.refresh();
      this.sound.playSfx({ preset: 'powerup', seed: 30 + this.wave }, { volume: 0.3 });
      return s;
    },
    spawnRock: function (size, x, y, baseVel) {
      var r = this.rocks.get(x, y, 'na-rock' + size + this.rng.int(0, 3));
      if (!r) return null;
      var sz = SIZES[size], a = this.rng.angle(), sp = this.rng.between(sz.speed[0], sz.speed[1]) * (1 + this.wave * 0.04);
      r.setTexture('na-rock' + size + this.rng.int(0, 3)); r.alpha = 1; r.setScale(1);
      r.size = size;
      r.body.setCircle(sz.r * 0.82, (r.width - sz.r * 1.64) / 2, (r.height - sz.r * 1.64) / 2);
      r.body.reset(x, y);
      r.body.setVelocity(Math.cos(a) * sp + (baseVel ? baseVel.x * 0.25 : 0), Math.sin(a) * sp + (baseVel ? baseVel.y * 0.25 : 0));
      r.body.setAngularVelocity(this.rng.between(-90, 90));
      return r;
    },
    splitRock: function (r, hitVel) {
      var size = r.size, x = r.x, y = r.y, col = [0xff4fd8, 0xffb238, 0x3dff9c, 0x7a8cff][+r.texture.key.slice(-1)] || 0xffffff;
      this.rocks.killAndHide(r);
      this.score += SIZES[size].score;
      this.boom.setParticleTint([0xffffff, col]); this.boom.explode(10 + (2 - size) * 12, x, y);
      this.debris.setParticleTint(col); this.debris.explode(6 + (2 - size) * 4, x, y);
      if (size < 2) { var v = hitVel || { x: 0, y: 0 }; this.spawnRock(size + 1, x, y, v); this.spawnRock(size + 1, x, y, v); }
      this.cameras.main.shake(size === 0 ? 180 : 80, size === 0 ? 0.008 : 0.004);
      if (size === 0 && this.fx.shock && this.fxLevel === 2) { this.fx.shock.enabled = true; this.fx.shock.play(x, y); }
      this.sound.playSfx({ preset: 'explosion', seed: 7 + size }, { volume: 0.32 - size * 0.06, rate: 0.8 + size * 0.25 });
      this.refresh();
    },
    fire: function () {
      if (this.fireCd > 0 || !this.ship.visible) return;
      var b = this.bullets.get(); if (!b) return;
      var sh = this.ship, c = Math.cos(sh.rotation), sn = Math.sin(sh.rotation);
      b.setTexture('na-bullet'); b.setScale(1); b.body.setCircle(4, 3, 3);
      b.body.reset(sh.x + c * 24, sh.y + sn * 24);
      b.body.setVelocity(c * 640 + sh.body.velocity.x * 0.5, sn * 640 + sh.body.velocity.y * 0.5);
      b.life = 850;
      this.fireCd = 150;
      this.sound.playSfx({ preset: 'laser', seed: 21 }, { volume: 0.18 });
    },
    hyperspace: function () {
      if (this.hyperCd > 0 || !this.ship.visible || this.over) return;
      var s = this, sh = this.ship;
      this.hyperCd = 4000;
      this.boom.setParticleTint([0xb197fc, 0xffffff]); this.boom.explode(24, sh.x, sh.y);
      sh.visible = false; sh.body.enable = false;
      this.sound.playSfx({ preset: 'jump', seed: 99 }, { volume: 0.4, rate: 0.6 });
      this.time.delayedCall(420, function () {
        if (s.over) return;
        // busca un punto libre de rocas
        var best = null, bestD = -1;
        for (var k = 0; k < 12; k++) {
          var x = s.rng.between(60, W - 60), y = s.rng.between(80, H - 60), dmin = 1e9;
          s.rocks.getChildren().forEach(function (r) { if (r.active) dmin = Math.min(dmin, UG.Math.distance(x, y, r.x, r.y)); });
          if (dmin > bestD) { bestD = dmin; best = { x: x, y: y }; }
        }
        sh.visible = true; sh.body.enable = true; sh.body.reset(best.x, best.y);
        sh.setScale(0.2); s.tweens.add({ targets: sh, scaleX: 1, scaleY: 1, duration: 260, ease: 'backOut' });
        s.boom.explode(18, best.x, best.y); s.invuln = 900;
      });
    },
    spawnUfo: function () {
      var fromLeft = this.rng.chance(0.5), y = this.rng.between(90, H - 90);
      var u = this.physics.add.image(fromLeft ? -40 : W + 40, y, 'na-ufo');
      u.body.setSize(52, 22, 6, 8).setVelocity(fromLeft ? 110 : -110, 0);
      u.hp = 3; u.shootAt = 900; u.t = 0; u.dir = fromLeft ? 1 : -1;
      this.ufo = u;
      var s = this;
      this.physics.add.overlap(this.bullets, u, function (b) { if (b.active && u.active) { s.bullets.killAndHide(b); s.hitUfo(u); } });
      this.physics.add.overlap(this.ship, u, function () { if (s.invuln <= 0 && s.ship.visible && u.active) { s.hitUfo(u, true); s.shipHit(); } });
      this.sound.playSfx({ preset: 'blip', seed: 77 }, { volume: 0.2, rate: 0.5 });
    },
    hitUfo: function (u, kill) {
      u.hp = kill ? 0 : u.hp - 1;
      this.tweens.add({ targets: u, alpha: 0.3, duration: 60, yoyo: true });
      if (u.hp > 0) { this.sound.playSfx({ preset: 'hit', seed: 5 }, { volume: 0.3 }); return; }
      this.score += 500; MG.floatText(this, u.x, u.y - 20, '+500', 0xff5f6d, 22);
      this.boom.setParticleTint([0xffffff, 0xff5f6d, 0xfff3bf]); this.boom.explode(50, u.x, u.y);
      this.debris.setParticleTint(0xff5f6d); this.debris.explode(14, u.x, u.y);
      if (this.fx.shock && this.fxLevel === 2) { this.fx.shock.enabled = true; this.fx.shock.play(u.x, u.y); }
      this.sound.playSfx({ preset: 'explosion', seed: 3 }, { volume: 0.5 });
      u.destroy(); this.ufo = null; this.refresh();
    },
    shipHit: function () {
      if (this.over) return;
      var s = this, sh = this.ship;
      this.lives--;
      this.boom.setParticleTint([0xffffff, 0x5ff7ff]); this.boom.explode(60, sh.x, sh.y);
      this.debris.setParticleTint(0x5ff7ff); this.debris.explode(16, sh.x, sh.y);
      this.cameras.main.shake(400, 0.018); this.cameras.main.flash(180, 0xff4fd8, 0.4);
      this.sound.playSfx({ preset: 'hurt', seed: 12 }, { volume: 0.5 });
      if (this.fx.rgb) { this.fx.rgb.redX = -8; this.fx.rgb.blueX = 8; this.tweens.add({ targets: this.fx.rgb, redX: -1.5, blueX: 1.5, duration: 700, ease: 'quadOut' }); }
      sh.visible = false; sh.body.enable = false; this.refresh();
      if (this.lives <= 0) { this.over = true; this.sound.stopMusic(800); this.time.delayedCall(1400, function () { s.scene.start('GameOver', { score: s.score }); }); return; }
      this.time.delayedCall(1200, function () { if (s.over) return; sh.visible = true; sh.body.enable = true; sh.body.reset(W / 2, H / 2); sh.rotation = -Math.PI / 2; s.invuln = 2200; });
    },
    refresh: function () {
      this.scoreT.text = String(this.score).padStart(6, '0');
      this.infoT.text = 'OLEADA ' + this.wave + '   ROCAS ' + this.rocks.countActive();
      var g = this.livesG.clear();
      g.lineStyle(2, 0x5ff7ff, 1);
      for (var i = 0; i < Math.min(this.lives, 6); i++) { var x = W - 150 - i * 26, y = 26; g.strokePoints([{ x: x, y: y - 10 }, { x: x + 8, y: y + 9 }, { x: x, y: y + 4 }, { x: x - 8, y: y + 9 }], true); }
    },
    update: function (t, dt) {
      if (!this.ship) return;
      var s = this, sh = this.ship, k = this.keys, w = this.wasd, j = this.joy, sec = dt / 1000;
      this.fireCd -= dt; this.hyperCd -= dt; this.invuln -= dt;
      var thrust = false;
      if (sh.visible && !this.over) {
        if (j && j.force > 0.2) {
          // joystick: gira hacia el ángulo del stick y empuja con su fuerza
          var diff = UG.Math.shortestAngle(sh.rotation, j.angle);
          sh.rotation += UG.Math.clamp(diff, -7 * sec, 7 * sec);
          if (Math.abs(diff) < 0.9 && j.force > 0.45) thrust = true;
        }
        if (k.left.isDown || w.A.isDown) sh.rotation -= 4.6 * sec;
        if (k.right.isDown || w.D.isDown) sh.rotation += 4.6 * sec;
        if (k.up.isDown || w.W.isDown) thrust = true;
        var c = Math.cos(sh.rotation), sn = Math.sin(sh.rotation);
        sh.body.setAcceleration(thrust ? c * 460 : 0, thrust ? sn * 460 : 0);
        if (thrust) {
          var deg = sh.rotation * UG.Math.RAD_TO_DEG + 180;
          this.flame.angleRange.min = deg - 14; this.flame.angleRange.max = deg + 14;
          this.flame.emitParticle(2, sh.x - c * 16, sh.y - sn * 16);
          if (!this._thrustSnd || t - this._thrustSnd > 110) { this._thrustSnd = t; this.sound.playSfx({ preset: 'hit', seed: 61 }, { volume: 0.05, rate: 0.4 }); }
        }
        if (k.space.isDown || w.SPACE.isDown || (this.btnFire && this.btnFire.isDown)) this.fire();
        if (w.SHIFT.justDown || w.H.justDown || (this.btnHyper && this.btnHyper.justDown)) this.hyperspace();
      } else sh.body.setAcceleration(0, 0);
      // parpadeo de invulnerabilidad + escudo
      this.shield.visible = sh.visible && this.invuln > 0;
      this.shield.x = sh.x; this.shield.y = sh.y; this.shield.alpha = 0.5 + Math.sin(t / 60) * 0.3;
      // balas con vida limitada
      this.bullets.getChildren().forEach(function (b) { if (b.active) { b.life -= dt; if (b.life <= 0) s.bullets.killAndHide(b); } });
      this.ebullets.getChildren().forEach(function (b) { if (b.active) { b.life -= dt; if (b.life <= 0) s.ebullets.killAndHide(b); } });
      // OVNI
      this.ufoTimer -= dt;
      if (!this.ufo && this.ufoTimer <= 0 && !this.over) { this.ufoTimer = this.rng.between(15000, 25000); this.spawnUfo(); }
      var u = this.ufo;
      if (u && u.active) {
        u.t += dt; u.body.velocity.y = Math.sin(u.t / 500) * 90;
        u.shootAt -= dt;
        if (u.shootAt <= 0 && sh.visible) {
          u.shootAt = Math.max(600, 1500 - this.wave * 80);
          var eb = this.ebullets.get(); if (eb) {
            var aim = Math.atan2(sh.y - u.y, sh.x - u.x) + this.rng.between(-0.25, 0.25);
            eb.setTexture('na-ebullet'); eb.body.setCircle(4, 3, 3); eb.body.reset(u.x, u.y); eb.body.setVelocity(Math.cos(aim) * 300, Math.sin(aim) * 300); eb.life = 1800;
            this.sound.playSfx({ preset: 'shoot', seed: 14 }, { volume: 0.15, rate: 0.7 });
          }
        }
        if ((u.dir > 0 && u.x > W + 60) || (u.dir < 0 && u.x < -60)) { u.destroy(); this.ufo = null; }
      }
      // envoltura de pantalla (ship, rocas y balas aparecen por el lado opuesto)
      var world = this.physics.world;
      world.wrap(sh, 16); world.wrap(this.rocks, 40); world.wrap(this.bullets, 4); world.wrap(this.ebullets, 4);
      if (!this.over && this.rocks.countActive() === 0) this.nextWave();
      this.stars.tilePositionY -= sh.body.velocity.y * sec * 0.05;
      var sw = this.fx.shock; if (sw && sw.enabled && sw.time > sw.radius / sw.speed) sw.enabled = false;
    }
  };

  MG.start({
    title: 'Neon Asteroids', width: W, height: H, backgroundColor: 0x02030a,
    physics: { arcade: { gravity: { y: 0 } } },
    scenes: [
      MG.menu({ id: 'neon-asteroids', title: 'NEON ASTEROIDS', subtitle: 'Sobrevive al campo de asteroides', glow: '#ff4fd8', titleColors: [0xffffff, 0xff9ff3], buttonColor: 0xae3ec9,
        help: '← → / A D girar · ↑ / W propulsar · Espacio disparar · Shift/H hiperespacio · F efectos',
        touchHelp: 'Joystick para girar y propulsar · ● disparar · H hiperespacio',
        background: function (s) {
          makeTextures(s); background(s); postFx(s, !MG.isTouch);
          for (var i = 0; i < 7; i++) { var r = s.add.image(s.rng.between(60, W - 60), s.rng.between(60, H - 60), 'na-rock' + s.rng.int(0, 2) + s.rng.int(0, 3)); r.depth = -5; s.tweens.add({ targets: r, rotation: s.rng.pick([-1, 1]) * Math.PI * 2, duration: s.rng.between(9000, 16000), repeat: -1 }); }
        } }),
      Play,
      MG.gameOver({ id: 'neon-asteroids', background: function (s) { makeTextures(s); background(s); postFx(s, false); } })]
  });
})();
