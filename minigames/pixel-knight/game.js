/* Pixel Knight — plataformas con mapa Tiled (TMJ + tileset externo TSJ + PNG, capa zlib, tiles animados,
 * objetos, plataformas de un sentido, peligros). Prueba: tilemaps, física con tiles, cámara con zona muerta y
 * límites, parallax multi-escena, animaciones por frames, pixel art nítido, controles táctiles. */
(function () {
  'use strict';
  var W = 960, H = 540, ZOOM = 3;
  var fromFile = location.protocol === 'file:';

  function bufToCanvas(buf) {
    var c = document.createElement('canvas'); c.width = buf.w; c.height = buf.h;
    var ctx = c.getContext('2d'), img = ctx.createImageData(buf.w, buf.h); img.data.set(buf.d); ctx.putImageData(img, 0, 0);
    return c;
  }
  function makeArt(scene) {
    var T = scene.textures;
    if (!T.exists('knight')) T.addSpriteSheet('knight', bufToCanvas(KnightArt.knightSheet()), { frameWidth: 16, frameHeight: 16, scaleMode: 'nearest' });
    if (!T.exists('slime')) T.addSpriteSheet('slime', bufToCanvas(KnightArt.slimeSheet()), { frameWidth: 16, frameHeight: 16, scaleMode: 'nearest' });
    if (fromFile && !T.exists('knight-tiles')) T.addCanvas('knight-tiles', bufToCanvas(KnightArt.tileset()), { scaleMode: 'nearest' });
    if (!T.exists('pk-mount')) T.generate('pk-mount', 320, 120, function (c) {
      c.fillStyle = '#5c7cfa'; c.beginPath(); c.moveTo(0, 120);
      for (var x = 0; x <= 320; x += 16) c.lineTo(x, 50 + Math.sin(x * 0.03) * 22 + Math.sin(x * 0.11) * 8); c.lineTo(320, 120); c.fill();
      c.fillStyle = '#e7f5ff'; for (var i = 0; i < 5; i++) { var mx = 30 + i * 64, my = 50 + Math.sin(mx * 0.03) * 22 + Math.sin(mx * 0.11) * 8; c.beginPath(); c.moveTo(mx - 10, my + 8); c.lineTo(mx, my - 2); c.lineTo(mx + 10, my + 8); c.fill(); }
    }, { scaleMode: 'nearest' });
    if (!T.exists('pk-hills')) T.generate('pk-hills', 256, 80, function (c) {
      c.fillStyle = '#40c057'; c.beginPath(); c.moveTo(0, 80); for (var x = 0; x <= 256; x += 8) c.lineTo(x, 30 + Math.sin(x * 0.05) * 12); c.lineTo(256, 80); c.fill();
      c.fillStyle = '#2f9e44'; for (var i = 0; i < 12; i++) c.fillRect(i * 22 + 4, 40 + Math.sin(i) * 6, 6, 40);
    }, { scaleMode: 'nearest' });
    if (!T.exists('pk-cloud')) T.generate('pk-cloud', 256, 64, function (c) {
      c.fillStyle = 'rgba(255,255,255,0.9)';
      [[30, 30, 14], [46, 24, 18], [64, 32, 13], [160, 22, 12], [176, 16, 16], [194, 24, 11]].forEach(function (p) { c.beginPath(); c.arc(p[0], p[1], p[2], 0, Math.PI * 2); c.fill(); });
    }, { scaleMode: 'nearest' });
    MG.glowTexture(scene, 'pk-dust', 8, 'rgba(255,255,255,1)');
  }

  var BG = {
    key: 'BG',
    create: function () {
      makeArt(this);
      var g = this.add.graphics(); g.fillGradientStyle(0x74c0fc, 0x74c0fc, 0xd0ebff, 0xd0ebff, 1).fillRect(0, 0, W, H);
      this.clouds = this.add.tileSprite(W / 2, 110, W / 2, 64, 'pk-cloud').setScale(2);
      this.mount = this.add.tileSprite(W / 2, 205, W / 2, 120, 'pk-mount').setScale(2);
      this.hills = this.add.tileSprite(W / 2, 290, W / 2, 80, 'pk-hills').setScale(2);
      this.hills.tint = 0xd8f5a2;
    },
    update: function (t, dt) {
      var play = this.game.scene.getScene('Play'), cam = play && play.cameras && play.cameras.main;
      var sx = cam ? cam.scrollX : 0;
      // parallax: al avanzar la cámara, el fondo se desplaza a la izquierda (tilePositionX negativo), más lento cuanto más lejos
      this.clouds.tilePositionX = -sx * 0.05 + t * 0.004;
      this.mount.tilePositionX = -sx * 0.12;
      this.hills.tilePositionX = -sx * 0.25;
    }
  };

  var Play = {
    key: 'Play',
    preload: function () {
      if (fromFile) this.load.tilemapTiledJSON('pk-level', window.PK_LEVEL);
      else this.load.tilemapTiledJSON('pk-level', 'assets/level1.tmj');
    },
    create: function () {
      var s = this;
      makeArt(this);
      this.scene.launch('BG'); this.scene.sendToBack('BG');
      this.events.once('shutdown', function () { s.game.scene.stop('BG'); });
      var map = this.map = this.add.tilemap('pk-level');
      this.mapW = map.widthInPixels; this.mapH = map.heightInPixels;
      map.createLayer('Decor');
      this.ground = map.createLayer('Suelo'); this.plat = map.createLayer('Plataformas'); this.haz = map.createLayer('Peligros');
      this.ground.setCollisionByProperty({ collides: true });
      this.plat.setCollisionByProperty({ oneWay: true });
      this.haz.setCollisionByProperty({ hazard: true });
      // animaciones
      var A = this.anims;
      if (!A.exists('k-idle')) {
        A.create({ key: 'k-idle', frames: A.generateFrameNumbers('knight', { start: 0, end: 1 }), frameRate: 3, repeat: -1 });
        A.create({ key: 'k-run', frames: A.generateFrameNumbers('knight', { start: 2, end: 5 }), frameRate: 12, repeat: -1 });
        A.create({ key: 'k-jump', frames: A.generateFrameNumbers('knight', { frames: [6] }), frameRate: 1 });
        A.create({ key: 'k-fall', frames: A.generateFrameNumbers('knight', { frames: [7] }), frameRate: 1 });
        A.create({ key: 'slime', frames: A.generateFrameNumbers('slime', { start: 0, end: 1 }), frameRate: 4, repeat: -1 });
      }
      var ts = map.getTileset('knight-tiles');
      if (!A.exists('coin')) A.create({ key: 'coin', frames: [8, 9, 10, 11].map(function (id) { return { texture: ts.getTileTexture(id, s.textures) }; }), frameRate: 9, repeat: -1 });
      // objetos del mapa
      var spawn = map.findObject('Objetos', function (o) { return o.type === 'player'; });
      this.spawnX = spawn.x; this.spawnY = spawn.y; this.safeX = spawn.x; this.safeY = spawn.y;
      var P = this.physics;
      P.world.setBounds(0, 0, this.mapW, this.mapH + 200);
      P.world.gravity.y = 900;
      this.player = P.add.sprite(this.spawnX, this.spawnY, 'knight', 0);
      this.player.body.setSize(8, 14).setMaxVelocity(140, 420);
      this.player.body.setCollideWorldBounds(true);
      this.player.play('k-idle'); this.player.depth = 10;
      this.coins = P.add.staticGroup();
      map.createFromObjects('Objetos', { type: 'coin' }).forEach(function (c) { c.play('coin'); s.coins.add(c); c.body.setSize(10, 10); c.body.refreshBody(); });
      this.slimes = P.add.group();
      map.createFromObjects('Objetos', { type: 'slime' }).forEach(function (o) {
        o.setTexture('slime', 0); o.setScale(1); o.play('slime'); s.slimes.add(o);
        o.body.setSize(12, 9).setOffset(2, 7); o.body.refreshBody(); o.dir = s.rng.sign(); o.body.setVelocityX(28 * o.dir); o.homeX = o.x;
      });
      var goal = map.createFromObjects('Objetos', { type: 'goal' })[0];
      this.goal = goal; P.add.existing(goal, true); goal.body.setSize(8, 16); goal.body.refreshBody();
      P.add.collider(this.player, this.ground); P.add.collider(this.player, this.plat);
      P.add.collider(this.slimes, this.ground); P.add.collider(this.slimes, this.plat);
      P.add.overlap(this.player, this.haz, function () { s.die(); });
      P.add.overlap(this.player, this.coins, function (p, c) { s.collect(c); });
      P.add.overlap(this.player, this.slimes, function (p, e) { s.touchSlime(e); });
      P.add.overlap(this.player, goal, function () { s.win(); });
      // cámara
      var cam = this.cameras.main;
      cam.setZoom(ZOOM).setBounds(0, 0, this.mapW, this.mapH).setRoundPixels(true);
      cam.startFollow(this.player, true, 0.12, 0.12, 0, 10);
      cam.setDeadzone(90, 60);
      // partículas de polvo
      this.dust = this.add.particles('pk-dust', { speed: { min: 10, max: 40 }, angle: { min: 200, max: 340 }, lifespan: 350, scale: { start: 1, end: 0 }, alpha: { start: 0.8, end: 0 }, frequency: -1, gravityY: 60 });
      this.sparkle = this.add.particles('pk-dust', { speed: { min: 30, max: 90 }, lifespan: 500, scale: { start: 1.2, end: 0 }, color: [0xfff3bf, 0xfcc419], blendMode: 'add', frequency: -1 });
      // estado
      this.lives = 3; this.coinsN = 0; this.timeLeft = (map.properties.tiempo || 240) * 1000; this.over = false;
      this.coyote = 0; this.jumpBuf = 0; this.jumps = 0; this.hurt = 0;
      // controles
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys('W,A,D,SPACE,Z');
      if (MG.isTouch) { this.joy = this.add.joystick({ x: 120, y: H - 110, radius: 64, mode: '8dir' }); this.btnA = this.add.virtualButton({ x: W - 100, y: H - 110, radius: 50, label: 'A', color: 0x40c057 }); }
      // HUD
      this.coinIcon = this.add.hud.sprite(76, 28, ts.getTileTexture(8, this.textures)).setScale(3).play('coin');
      this.coinT = MG.text(this, 100, 28, 'x 0', 28, 0xffffff, { hud: true, ox: 0 });
      this.livesT = MG.text(this, 210, 28, '', 28, 0xff6b6b, { hud: true, ox: 0 });
      this.timeT = MG.text(this, W / 2, 28, '', 28, 0xffffff, { hud: true });
      MG.hudButtons(this);
      this.refreshHud();
      this.sound.addMusic('pk-music', { bpm: 140, tracks: [
        { wave: 'square', duty: 0.5, volume: 0.1, notes: 'C5 . G4 . E4 . G4 . A4 . B4 . A#4 A4 . . G4 E5 G5 A5 . F5 G5 . E5 . C5 D5 B4 . . .' },
        { wave: 'triangle', volume: 0.3, notes: 'C3 . . C3 G2 . . G2 F2 . . F2 G2 . G2 . C3 . . C3 A2 . . A2 D3 . . D3 G2 . G2 .' },
        { drums: true, volume: 0.4, notes: 'k . h . s . h . k . h . s . h h' }] });
      this.sound.playMusic('pk-music', { volume: 0.3 });
    },
    refreshHud: function () {
      this.coinT.text = 'x ' + this.coinsN;
      var h = ''; for (var i = 0; i < this.lives; i++) h += '♥'; this.livesT.text = h;
      var sec = Math.max(0, Math.ceil(this.timeLeft / 1000)); this.timeT.text = '⏱ ' + Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
    },
    collect: function (c) {
      if (!c.active) return;
      this.coinsN++; this.sparkle.explode(10, c.x, c.y);
      this.sound.playSfx({ preset: 'coin', seed: 7 }, { volume: 0.45 });
      this.coins.killAndHide(c);
      this.refreshHud();
    },
    touchSlime: function (e) {
      if (!e.active || this.over) return;
      var pb = this.player.body;
      if (pb.velocity.y > 20 && pb.bottom - e.body.top < 8) {
        e.active = false; e.body.enable = false; e.stop();
        this.tweens.add({ targets: e, scaleY: 0.2, scaleX: 1.5, alpha: 0, duration: 250, onComplete: function () { e.destroy(); } });
        pb.setVelocityY(-230); this.jumps = 1;
        this.coinsN += 5; MG.floatText(this, e.x, e.y - 10, '+5', 0xfff3bf, 10);
        this.sound.playSfx({ preset: 'bounce', seed: 2 }, { volume: 0.5 });
        this.refreshHud();
      } else this.die();
    },
    die: function () {
      if (this.hurt > 0 || this.over) return;
      var s = this;
      this.lives--; this.hurt = 1500;
      this.cameras.main.shake(250, 0.01); this.cameras.main.flash(180, 0xff0000, 0.4);
      this.sound.playSfx({ preset: 'hurt', seed: 3 }, { volume: 0.6 });
      this.input.vibrate(100);
      this.refreshHud();
      if (this.lives <= 0) { this.over = true; this.sound.stopMusic(600); this.player.body.enable = false; this.tweens.add({ targets: this.player, y: this.player.y - 30, alpha: 0, angle: 180, duration: 800 }); this.time.delayedCall(1200, function () { s.scene.stop('BG'); s.scene.start('GameOver', { score: s.coinsN * 10 }); }); return; }
      this.player.body.reset(this.safeX, this.safeY - 4);
    },
    win: function () {
      if (this.over) return;
      this.over = true; var s = this;
      this.player.body.setVelocity(0, 0); this.player.body.enable = false;
      this.sound.stopMusic(400); this.sound.playSfx({ preset: 'powerup', seed: 11 });
      this.sparkle.explode(60, this.goal.x, this.goal.y);
      this.cameras.main.zoomTo(4.5, 900, 'sineInOut');
      var bonus = Math.ceil(this.timeLeft / 1000) * 5;
      this.time.delayedCall(1400, function () { s.scene.stop('BG'); s.scene.start('GameOver', { score: s.coinsN * 10 + bonus + s.lives * 100, win: true }); });
    },
    update: function (time, dt) {
      if (!this.player || this.over) return;
      var p = this.player, b = p.body, k = this.cursors, w = this.wasd, j = this.joy;
      this.hurt = Math.max(0, this.hurt - dt); p.alpha = this.hurt > 0 ? (Math.floor(time / 90) % 2 ? 0.3 : 1) : 1;
      this.timeLeft -= dt; if (this.timeLeft <= 0) { this.timeLeft = 0; this.lives = 1; this.hurt = 0; this.die(); }
      if (Math.floor(this.timeLeft / 1000) !== this._lastSec) { this._lastSec = Math.floor(this.timeLeft / 1000); this.refreshHud(); }
      var onFloor = b.blocked.down;
      if (onFloor) { this.coyote = 90; this.jumps = 0; if (!this.haz.collidesAt(Math.floor(p.x / 16), Math.floor((p.y + 8) / 16)) && time - (this._safeT || 0) > 500) { this.safeX = p.x; this.safeY = p.y; this._safeT = time; } }
      else this.coyote -= dt;
      var dir = 0;
      if (k.left.isDown || w.A.isDown || (j && j.left)) dir -= 1;
      if (k.right.isDown || w.D.isDown || (j && j.right)) dir += 1;
      var target = dir * 105, accel = onFloor ? 1400 : 900;
      b.velocity.x = UG.Math.approach(b.velocity.x, target, accel * dt / 1000);
      var jumpPressed = k.up.justDown || w.W.justDown || w.SPACE.justDown || w.Z.justDown || (this.btnA && this.btnA.justDown);
      var jumpHeld = k.up.isDown || w.W.isDown || w.SPACE.isDown || w.Z.isDown || (this.btnA && this.btnA.isDown);
      if (jumpPressed) this.jumpBuf = 130; else this.jumpBuf -= dt;
      if (this.jumpBuf > 0 && (this.coyote > 0 || this.jumps < 2)) {
        var first = this.coyote > 0;
        b.setVelocityY(first ? -290 : -245); this.jumps = first ? 1 : 2; this.coyote = 0; this.jumpBuf = 0;
        this.dust.explode(6, p.x, p.y + 7);
        this.sound.playSfx({ preset: 'jump', seed: first ? 4 : 9 }, { volume: 0.35 });
      }
      if (!jumpHeld && b.velocity.y < -110) b.velocity.y = -110;
      if (dir !== 0) p.flipX = dir < 0;
      var anim = !onFloor ? (b.velocity.y < 0 ? 'k-jump' : 'k-fall') : (Math.abs(b.velocity.x) > 10 ? 'k-run' : 'k-idle');
      p.play(anim, true);
      if (onFloor && !this._wasOnFloor) this.dust.explode(5, p.x, p.y + 7);
      this._wasOnFloor = onFloor;
      if (p.y > this.mapH + 20) this.die();
      // enemigos patrullan y giran en bordes
      var s = this;
      this.slimes.getChildren().forEach(function (e) {
        if (!e.active || !e.body) return;
        var eb = e.body, ahead = Math.floor((e.x + e.dir * 9) / 16), below = Math.floor((e.y + 9) / 16);
        if (eb.blocked.left) e.dir = 1; else if (eb.blocked.right) e.dir = -1;
        else if (eb.blocked.down && !s.ground.collidesAt(ahead, below) && !s.plat.collidesAt(ahead, below)) e.dir = -e.dir;
        eb.setVelocityX(28 * e.dir); e.flipX = e.dir > 0;
      });
    }
  };

  MG.start({
    title: 'Pixel Knight', width: W, height: H, backgroundColor: 0x79c7ff, pixelArt: true,
    physics: { arcade: { gravity: { y: 900 } } },
    scenes: [
      MG.menu({ id: 'pixel-knight', title: 'PIXEL KNIGHT', subtitle: 'Plataformas con mapa de Tiled', glow: '#40c057', titleColors: [0xffffff, 0xb2f2bb], buttonColor: 0x2f9e44,
        help: '← → / A D para moverte · ↑ / W / Espacio para saltar (doble salto)\nPisa a los slimes, evita pinchos y agua, llega a la bandera',
        touchHelp: 'Joystick para moverte · botón A para saltar (doble salto)\nPisa a los slimes y llega a la bandera',
        background: function (s) { makeArt(s); var g = s.add.graphics(); g.fillGradientStyle(0x74c0fc, 0x74c0fc, 0xd0ebff, 0xd0ebff, 1).fillRect(0, 0, W, H); s.add.tileSprite(W / 2, H - 60, W / 3, 80, 'pk-hills').setScale(3); var k = s.add.sprite(W / 2, H * 0.44, 'knight', 0).setScale(5); if (!s.anims.exists('k-run-menu')) s.anims.create({ key: 'k-run-menu', frames: s.anims.generateFrameNumbers('knight', { start: 2, end: 5 }), frameRate: 10, repeat: -1 }); k.play('k-run-menu'); } }),
      Play, BG,
      MG.gameOver({ id: 'pixel-knight', background: function (s) { var g = s.add.graphics(); g.fillGradientStyle(0x74c0fc, 0x74c0fc, 0x1c7ed6, 0x1c7ed6, 1).fillRect(0, 0, W, H); } })]
  });
})();
