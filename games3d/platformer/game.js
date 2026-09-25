/* Bandicrash — plataformas 3D estilo Crash Bandicoot: pasillo selvático hacia el fondo, saltos, giro que rompe
 * cajas y derriba enemigos, frutas (1 draw call para todas), cajas TNT con cuenta atrás, cajas de rebote,
 * plataformas móviles, puntos de control y vidas. */
(function () {
  'use strict';
  var V3 = UG.Vec3, rnd = new UG.RNG('selva');
  var MODELS = ['hero', 'crate', 'fruit', 'tree', 'pine', 'bush', 'rock'];
  // plataformas: [x, alto (y de la superficie), z centro, ancho, largo]
  // saltos máximos ~5.5 m (jumpSpeed 10.5, gravedad 28, 7.5 m/s): todos los huecos son <= 2 m
  var PLATS = [[0, 0, -15, 8, 32], [0, 0, -42, 8, 16], [0, 1, -58, 8, 14], [0, 1, -89, 8, 20], [0, 2, -106, 6, 8], [0, 3, -114, 6, 8], [0, 3, -132, 3, 28],
    [0, 2, -158, 8, 20], [0, 4, -186, 8, 24], [-2, 4, -201, 3, 3], [2, 4.5, -205.5, 3, 3], [-1, 5, -210, 3, 3], [0, 5, -224, 10, 24], [0, 5, -245, 8, 14]];
  // plataformas móviles: [x, y, z, ancho, largo, eje, amplitud, velocidad]
  var MOVERS = [[0, 1, -69, 4, 4, 'x', 3, 1.3], [0, 1, -75, 4, 4, 'x', -3, 1.3], [0, 2.5, -171, 4, 4, 'y', 1.5, 1.1]];
  // cajas: [x, z, tipo, altura en la pila]  tipos: n normal, t TNT, b rebote, c checkpoint, v vida
  var CRATES = [[2, -12, 'n', 0], [-2, -18, 'n', 0], [-2, -18, 'n', 1], [2.5, -26, 'b', 0], [0, -40, 'n', 0], [1.5, -44, 'n', 0], [-1.5, -44, 'n', 0], [0, -56, 'c', 0], [-2.5, -85, 'n', 0], [2.5, -91, 'n', 0], [2.5, -91, 'n', 1], [0, -96, 't', 0],
    [0, -126, 'n', 0], [0, -138, 'n', 0], [-2, -152, 'n', 0], [2, -164, 't', 0], [0, -178, 'c', 0], [-2.5, -190, 'n', 0], [2.5, -194, 'v', 0], [0, -216, 'n', 0], [2, -220, 't', 0], [-2, -220, 't', 0], [0, -226, 'n', 0], [0, -226, 'n', 1], [-3, -230, 'b', 0], [3, -232, 'n', 0]];
  var CRABS = [[0, -48, 2.5], [0, -90, 3], [0, -155, 3], [2, -162, 2], [0, -245, 3.5]];

  function tex(scene, key, w, h, draw) { if (!scene.textures.exists(key)) scene.textures.generate(key, w, h, draw); return scene.textures.get(key); }
  function buildJungle(v, scene, withPhysics) {
    var ph = withPhysics ? v.physics : null, sc = v.scene3d;
    sc.setSky({ top: 0x2b6cb0, horizon: 0xffd8a8, bottom: 0x2f6b4f, sunColor: 0xfff0c0, sunSize: 0.05, sunIntensity: 1.2 });
    sc.setFog('linear', 0xffd8a8, 40, 140); sc.exposure = 1.1;
    var grass = tex(scene, 'grass3d', 64, 64, function (ctx, w, h) { ctx.fillStyle = '#5e9e3a'; ctx.fillRect(0, 0, w, h); for (var i = 0; i < 500; i++) { ctx.fillStyle = Math.random() < 0.5 ? '#4f8a2f' : '#72b347'; ctx.fillRect(Math.random() * w, Math.random() * h, 2, 3); } });
    grass.source.setWrapMode('repeat');
    var side = tex(scene, 'dirt3d', 64, 64, function (ctx, w, h) { ctx.fillStyle = '#8a5a3b'; ctx.fillRect(0, 0, w, h); for (var i = 0; i < 300; i++) { ctx.fillStyle = Math.random() < 0.5 ? '#6f4630' : '#a06d4a'; ctx.fillRect(Math.random() * w, Math.random() * h, 3, 2); } });
    side.source.setWrapMode('repeat');
    var topMat = v.material({ map: grass, roughness: 1, uvScale: 2 }), dirtMat = v.material({ map: side, roughness: 1, uvScale: 1.5 });
    PLATS.forEach(function (p) {
      var depth = 8, top = v.add.box(p[3], 0.3, p[4], topMat); top.position.set(p[0], p[1] - 0.15, p[2]);
      var body = v.add.box(p[3] * 0.96, depth, p[4] * 0.96, dirtMat); body.position.set(p[0], p[1] - 0.3 - depth / 2, p[2]);
      if (ph) ph.addBox(new V3(p[0], p[1] - depth / 2, p[2]), new V3(p[3] / 2, depth / 2, p[4] / 2));
    });
    // agua, paredes de acantilado y vegetación
    v.add.plane(400, 500, { color: 0x1c7ed6, roughness: 0.15, metalness: 0.1, opacity: 0.85, transparent: true }).setPosition(0, -7, -140);
    [-1, 1].forEach(function (s) { var cliff = v.add.box(20, 30, 320, { color: 0x6b8f47, roughness: 1 }); cliff.position.set(s * 20, 0, -140); });
    var trees = [];
    for (var i = 0; i < 90; i++) { var s2 = i % 2 ? 1 : -1; trees.push({ x: s2 * rnd.float(11, 16), y: 15, z: -rnd.float(0, 280), ry: rnd.float(0, 6.28), s: rnd.float(1.2, 2.2) }); }
    G3.instances(v, 'tree', trees.filter(function (t, k) { return k % 3; })); G3.instances(v, 'pine', trees.filter(function (t, k) { return !(k % 3); }));
    var bushes = []; PLATS.forEach(function (p) { for (var b = 0; b < 3; b++) bushes.push({ x: p[0] + (b % 2 ? 1 : -1) * (p[3] / 2 - 0.4), y: p[1], z: p[2] + rnd.float(-p[4] / 2 + 1, p[4] / 2 - 1), ry: rnd.float(0, 6.28), s: rnd.float(0.6, 1) }); });
    G3.instances(v, 'bush', bushes, { castShadow: false });
    return {};
  }

  /* ================================================================ Juego */
  class Play extends UG.Scene {
    constructor() { super('Play'); }
    preload() { G3.loadModels(this, MODELS); }
    create() {
      var s = this, W = this.game.width, H = this.game.height;
      this.sound.unlock(); this.sound.prewarm(['grenade', 'punch']);
      var v = this.view = this.add.view3d({ fov: 58, far: 300 });
      var ph = v.enablePhysics({ gravity: -28, killY: -12 });
      buildJungle(v, this, true);
      v.add.sunlight({ shadowSize: 40, direction: new V3(-0.35, -1, 0.25), ambient: 0.75 });
      // jugador
      this.hero = v.add.model('hero'); this.hero.position.set(0, 0.1, -3); this.hero.rotation.y = Math.PI;
      this.ch = ph.addCharacter(this.hero, { radius: 0.35, height: 1.7, jumpSpeed: 10.5, coyoteTime: 0.1, airControl: 0.85 });
      this.hero.play('Idle');
      this.spawn = new V3(0, 0.1, -3); this.lives = 3; this.fruits = 0; this.cratesBroken = 0; this.spinT = 0; this.spinCd = 0; this.dead = false; this.won = false; this.facing = Math.PI; this.invul = 0;
      // plataformas móviles
      this.movers = MOVERS.map(function (m) {
        var node = v.add.box(m[3], 0.5, m[4], { color: 0xa47148, roughness: 0.8 }); node.position.set(m[0], m[1] - 0.25, m[2]);
        var col = ph.addBox(new V3(m[0], m[1] - 0.25, m[2]), new V3(m[3] / 2, 0.25, m[4] / 2));
        return { def: m, node: node, col: col, t: 0, last: new V3(m[0], m[1] - 0.25, m[2]) };
      });
      // cajas
      var crateModel = this.game.cache.models.get('crate'), cm = null; crateModel.template.traverse(function (n) { if (n instanceof UG.Mesh3D) cm = n; });
      this.crateGeo = cm.geometry;
      var mats = { n: cm.material, t: v.material({ color: 0xe03131, emissive: 0x3d0000, roughness: 0.6 }), b: v.material({ color: 0x4dabf7, emissive: 0x0b2a4a, roughness: 0.6 }), c: v.material({ color: 0x51cf66, emissive: 0x0a3312, roughness: 0.6 }), v: v.material({ color: 0xfab005, emissive: 0x3d2e00, roughness: 0.4 }) };
      this.crates = CRATES.map(function (c) {
        var plat = s.platAt(c[0], c[1]), y = (plat ? plat[1] : 0) + 0.5 + c[3];
        var m = v.add.mesh(s.crateGeo, mats[c[2]]); m.position.set(c[0], y, c[1]);
        var col = ph.addBox(new V3(c[0], y, c[1]), new V3(0.5, 0.5, 0.5));
        return { type: c[2], node: m, col: col, pos: new V3(c[0], y, c[1]), alive: true, fuse: -1 };
      });
      // frutas: todas en una InstancedMesh3D (se ocultan con escala 0 al recogerlas)
      var fruitPos = [];
      PLATS.forEach(function (p, i) { if (i === 0 || i % 2 === 0) for (var k = -1; k <= 1; k++) fruitPos.push(new V3(p[0] + k * 1.2, p[1] + 1.1, p[2] + (i % 3 - 1) * 2)); });
      for (var z = -6; z > -30; z -= 3) fruitPos.push(new V3(Math.sin(z) * 2, 1.1, z));
      for (var z2 = -118; z2 > -145; z2 -= 3) fruitPos.push(new V3(0, 4.1, z2));
      var fruitModel = this.game.cache.models.get('fruit'), fm = null; fruitModel.template.traverse(function (n) { if (n instanceof UG.Mesh3D) fm = n; });
      this.fruitMesh = v.add.instanced(fm.geometry, fm.material, fruitPos.length); this.fruitMesh.castShadow = false;
      this.fruitPos = fruitPos; this.fruitAlive = fruitPos.map(function () { return true; });
      // cangrejos
      this.crabs = CRABS.map(function (c) {
        var plat = s.platAt(c[0], c[1]), y = plat ? plat[1] : 0;
        var g = v.add.group(), body = new UG.Mesh3D(UG.Geometry3D.sphere(0.5, 14, 10), v.material({ color: 0xff6b1a, roughness: 0.5 })); body.scale.set(1.3, 0.6, 1); body.position.y = 0.35; g.add(body);
        [-1, 1].forEach(function (sd) { var eye = new UG.Mesh3D(UG.Geometry3D.sphere(0.12, 8, 6), v.material({ color: 0xffffff, type: 'basic' })); eye.position.set(sd * 0.22, 0.75, 0.25); g.add(eye); var claw = new UG.Mesh3D(UG.Geometry3D.box(0.3, 0.25, 0.4), v.material({ color: 0xe8590c })); claw.position.set(sd * 0.75, 0.35, 0.3); g.add(claw); });
        g.position.set(c[0], y, c[1]);
        return { node: g, base: new V3(c[0], y, c[1]), range: c[2], t: rnd.float(0, 6), alive: true };
      });
      // portal final
      var last = PLATS[PLATS.length - 1];
      this.portal = v.add.torus(1.4, 0.18, { color: 0x9775fa, emissive: 0x7048e8, emissiveIntensity: 2.5, type: 'basic' }); this.portal.position.set(last[0], last[1] + 1.8, last[2] - 3);
      this.portalFx = v.addParticles('magic', { rate: 30 }); this.portalFx.position.copy(this.portal.position);
      this.trail = v.addParticles('trail', { rate: 0, autoStart: false, color: [0xfff3bf, 0xff922b] });
      // cámara detrás, mirando al fondo del pasillo
      this.camPos = new V3(0, 3.5, 5); v.camera.position.copy(this.camPos);
      // HUD
      this.fruitText = G3.text(this, 60, 28, '', 32, 0xffa94d, { ox: 0 });
      this.livesText = G3.text(this, W - 30, 72, '', 32, 0xffffff, { ox: 1 });
      this.crateText = G3.text(this, W / 2, 36, '', 26, 0xe9b872);
      this.help = G3.text(this, W / 2, H - 24, G3.touch ? '' : 'WASD/flechas moverse · Espacio saltar · F / Shift / clic girar', 16, 0xffffff, { stroke: 3 });
      this.touch = G3.touchControls(this, [{ name: 'jump', label: '⤒', color: 0x4dabf7, radius: 54 }, { name: 'spin', label: '↻', color: 0xff922b, radius: 48 }]);
      MG.hudButtons(this, {});
      var kb = this.input.keyboard;
      kb.on('keydown-F', function () { s.spin(); }); kb.on('keydown-SHIFT', function () { s.spin(); });
      this.input.on('pointerdown', function (p) { if (p.type === 'mouse') s.spin(); });
      this.ch.on('land', function (h) { if (h > 1) v.effect('dust', s.ch.position.clone(), { count: 8 }); });
      this.bot = G3.auto ? { t: 0 } : null;
      this.updateHud();
      G3.expose('platformer', this);
    }
    snd(k, vol, pos) { if (this.sound.disabled) return; if (pos) this.view.playSfx(k, pos, { volume: vol || 0.5 }); else this.sound.playSfx(k, { volume: vol || 0.5 }); }
    platAt(x, z) { for (var i = 0; i < PLATS.length; i++) { var p = PLATS[i]; if (Math.abs(x - p[0]) <= p[3] / 2 && Math.abs(z - p[2]) <= p[4] / 2) return p; } return null; }
    updateHud() { this.fruitText.text = '🍑 ' + this.fruits; this.livesText.text = '♥ ' + this.lives; this.crateText.text = '📦 ' + this.cratesBroken + ' / ' + this.crates.length; }
    spin() { if (this.spinCd > 0 || this.dead || this.won) return; this.spinT = 0.45; this.spinCd = 0.7; this.snd('blip', 0.4); }
    breakCrate(c, byJump) {
      if (!c.alive) return;
      if (c.type === 'b' && !byJump) return; // la de rebote solo se activa saltando encima
      var v = this.view, s = this;
      if (c.type === 't') { if (c.fuse < 0) { c.fuse = 3; this.snd('select', 0.5, c.pos); if (byJump) this.ch.velocity.y = 9; } return; }
      c.alive = false; c.node.destroy(); v.physics.removeStatic(c.col); this.cratesBroken++;
      v.effect('dust', c.pos, { count: 14 }); v.effect('sparks', c.pos, { count: 10, color: [0xe9b872, 0x8a5a3b] });
      this.snd('hit', 0.5, c.pos);
      if (c.type === 'n') { this.fruits += 3; this.snd('coin', 0.4); }
      if (c.type === 'v') { this.lives++; this.snd('powerup', 0.6); MG.floatText(this, this.game.width / 2, this.game.height * 0.3, '¡Vida extra!', 0xfab005, 34); }
      if (c.type === 'c') { this.spawn.copy(c.pos).y -= 0.4; this.snd('powerup', 0.5); MG.floatText(this, this.game.width / 2, this.game.height * 0.3, 'Punto de control', 0x69db7c, 30); }
      if (byJump) this.ch.velocity.y = c.type === 'b' ? 16 : 9;
      // cajas apiladas encima caen
      this.crates.forEach(function (o) { if (o.alive && o !== c && Math.abs(o.pos.x - c.pos.x) < 0.1 && Math.abs(o.pos.z - c.pos.z) < 0.1 && o.pos.y > c.pos.y) { o.pos.y -= 1; o.node.position.y -= 1; o.col.setTransform(o.pos); } });
      this.updateHud(); void s;
    }
    explodeTNT(c) {
      c.alive = false; c.node.destroy(); this.view.physics.removeStatic(c.col); this.cratesBroken++;
      this.view.effect('explosion', c.pos); this.view.effect('smoke', c.pos, { count: 16 }); this.snd({ preset: 'grenade', seed: 3 }, 0.8, c.pos); this.cameras.main.shake(300, 0.012);
      var s = this;
      this.crates.forEach(function (o) { if (o.alive && o.pos.distanceTo(c.pos) < 2.6) { if (o.type === 't') o.fuse = Math.min(o.fuse < 0 ? 0.25 : o.fuse, 0.25); else s.breakCrate(o, false); } });
      this.crabs.forEach(function (k) { if (k.alive && k.node.position.distanceTo(c.pos) < 3) s.killCrab(k); });
      if (this.ch.position.distanceTo(c.pos) < 2.8) this.die();
      this.updateHud();
    }
    killCrab(k) { k.alive = false; this.view.effect('sparks', k.node.position.clone().add(new V3(0, 0.5, 0)), { count: 16 }); this.snd({ preset: 'punch', seed: 3 }, 0.6, k.node.position); k.node.destroy(); this.fruits += 2; this.updateHud(); }
    die() {
      if (this.dead || this.invul > 0) return;
      this.dead = true; this.lives--; this.updateHud(); this.snd('hurt', 0.8); G3.flash(this, 0xff0000, 0.4, 500);
      this.hero.play('Die', { loop: 'once', fade: 0.1 });
      var s = this;
      this.time.delayedCall(1300, function () {
        if (s.lives < 0) { s.scene.start('GameOver', { score: s.fruits * 10 + s.cratesBroken * 50, win: false }); return; }
        s.ch.teleport(s.spawn); s.dead = false; s.invul = 1.5; s.hero.play('Idle', { fade: 0.1 });
        MG.floatText(s, s.game.width / 2, s.game.height * 0.35, s.lives > 0 ? 'Vuelves al último punto · vidas: ' + s.lives : '¡Última vida!', 0xffd43b, 30);
      });
    }
    win() { if (this.won) return; this.won = true; this.snd('powerup', 0.9); var s = this; MG.floatText(this, this.game.width / 2, this.game.height * 0.35, '¡Nivel completado!', 0x9775fa, 46); this.hero.play('Dance'); var bonus = this.cratesBroken === this.crates.length ? 2000 : 0; this.time.delayedCall(2500, function () { s.scene.start('GameOver', { score: s.fruits * 10 + s.cratesBroken * 50 + bonus + s.lives * 300, win: true }); }); }
    _botInput(dt) {
      // bot de pruebas: va al borde cercano de la siguiente plataforma (estática o móvil), sondea el suelo en esa
      // dirección, salta cuando hay dónde caer al alcance y espera si no; gira junto a cajas y cangrejos
      var p = this.ch.position, ph = this.view.physics, s = this, down = new V3(0, -1, 0);
      var tx = null, tz = null, lead = 0, best = -Infinity;
      PLATS.forEach(function (pl) { var zn = pl[2] + pl[4] / 2; if (zn < p.z - 0.6 && zn > best) { best = zn; tx = pl[0]; tz = zn - Math.min(1.2, pl[4] / 2); } });
      this.movers.forEach(function (m) { var zn = m.last.z + m.def[4] / 2; if (zn < p.z - 0.6 && zn >= best - 0.01 && !(Math.abs(p.z - m.last.z) < m.def[4] / 2)) { best = zn; tx = m.last.x; tz = m.last.z; lead = m.def[5] === 'x' ? Math.cos(m.t * m.def[7]) * m.def[6] * m.def[7] * 0.45 : 0; } });
      var onMover = null; this.movers.forEach(function (m) { if (Math.abs(p.z - m.last.z) < m.def[4] / 2 + 0.2 && Math.abs(p.x - m.last.x) < m.def[3] / 2 + 0.3) onMover = m; });
      if (tx === null) return { f: 1, s: 0, jump: false };
      var dx = tx + lead - p.x, dz = tz - p.z, len = Math.hypot(dx, dz) || 1, ux = dx / len, uz = dz / len;
      var f = -uz, sx = ux, jump = false;
      var edge = ph.raycast(new V3(p.x + ux * 1.1, p.y + 1, p.z + uz * 1.1), down, 2.2, { bodies: false });
      if (!edge && this.ch.onGround) {
        var land = false;
        for (var d = 2; d <= 5; d += 0.5) { var h = ph.raycast(new V3(p.x + ux * d, p.y + 1.8, p.z + uz * d), down, 3.5, { bodies: false }); if (h && h.point.y > p.y - 1.2 && h.point.y < p.y + 1.6) { land = true; break; } }
        if (land) jump = true; else { f = 0; sx = 0; }
      }
      // sobre una plataforma móvil sin salto a la vista: quedarse en su centro
      if (onMover && !jump && f === 0) sx = Math.max(-1, Math.min(1, (onMover.last.x - p.x) * 1.5));
      this.crates.forEach(function (c) { if (c.alive && c.type !== 't' && c.type !== 'b' && c.pos.distanceTo(p) < 1.6) s.spin(); });
      this.crabs.forEach(function (k) { if (k.alive && k.node.position.distanceTo(p) < 2.2) s.spin(); });
      if (this.ch.hitWall && this.ch.onGround) jump = true;
      return { f: f, s: sx, jump: jump };
    }
    update(t, dtMs) {
      var dt = Math.min(dtMs, 50) / 1000, s = this, v = this.view, ch = this.ch, p = ch.position, kb = this.input.keyboard, tb = this.touch.buttons;
      this.spinCd -= dt; this.invul -= dt;
      // plataformas móviles (el jugador encima se mueve con ellas)
      this.movers.forEach(function (m) {
        m.t += dt; var d = m.def, off = Math.sin(m.t * d[7]) * d[6], np = new V3(d[0] + (d[5] === 'x' ? off : 0), d[1] - 0.25 + (d[5] === 'y' ? off : 0), d[2]);
        var delta = np.clone().sub(m.last);
        // ¿está encima? (con la posición anterior de la plataforma, que es la que vio la física)
        var on = ch.onGround && Math.abs(p.x - m.last.x) < d[3] / 2 + 0.3 && Math.abs(p.z - m.last.z) < d[4] / 2 + 0.3 && Math.abs(p.y - (m.last.y + 0.25)) < 0.35;
        m.col.setTransform(np); m.node.position.copy(np); m.last.copy(np);
        if (on) { p.add(delta); ch._aabb(); }
      });
      if (!this.dead && !this.won) {
        var inp = this.bot ? this._botInput(dt) : { f: 0, s: 0, jump: false };
        if (!this.bot) {
          if (kb.isDown('KeyW') || kb.isDown('UP')) inp.f += 1; if (kb.isDown('KeyS') || kb.isDown('DOWN')) inp.f -= 1;
          if (kb.isDown('KeyA') || kb.isDown('LEFT')) inp.s -= 1; if (kb.isDown('KeyD') || kb.isDown('RIGHT')) inp.s += 1;
          var js = this.touch.joy; if (js && js.isActive) { inp.f -= js.forceY; inp.s += js.forceX; }
          var pad = this.input.gamepad.pad1; if (pad && pad.connected) { inp.f -= Math.abs(pad.axes[1]) > 0.15 ? pad.axes[1] : 0; inp.s += Math.abs(pad.axes[0]) > 0.15 ? pad.axes[0] : 0; if (pad.justDown(0)) inp.jump = true; if (pad.justDown(2)) this.spin(); }
          if (kb.justPressed('SPACE') || (tb.jump && tb.jump.justDown)) inp.jump = true;
          if (tb.spin && tb.spin.justDown) this.spin();
        }
        var len = Math.hypot(inp.f, inp.s); if (len > 1) { inp.f /= len; inp.s /= len; }
        var speed = 7.5;
        ch.move(inp.s * speed, -inp.f * speed);
        if (inp.jump && ch.jump()) this.snd('jump', 0.4);
        if (len > 0.1) this.facing += G3.angleDiff(this.facing, Math.atan2(inp.s, -inp.f)) * Math.min(1, 14 * dt);
        // animación
        var anim = !ch.onGround ? 'Jump' : (len > 0.1 ? 'Run' : 'Idle');
        if (this.spinT > 0) { this.spinT -= dt; this.hero.rotation.y = this.facing + (0.45 - this.spinT) * 30; this.trail.burst(2, p.clone().add(new V3(0, 0.9, 0))); }
        else this.hero.rotation.y = this.facing;
        if (anim !== this._anim) { this._anim = anim; this.hero.play(anim, { fade: 0.12 }); }
        // cajas: saltar encima o girar al lado
        this.crates.forEach(function (c) {
          if (!c.alive) return;
          var dx = Math.abs(p.x - c.pos.x), dz = Math.abs(p.z - c.pos.z), top = c.pos.y + 0.5;
          if (ch.velocity.y <= 0.5 && dx < 0.75 && dz < 0.75 && p.y >= top - 0.12 && p.y <= top + 0.35 && !ch._jump) s.breakCrate(c, true);
          else if (s.spinT > 0 && c.pos.distanceTo(new V3(p.x, p.y + 0.8, p.z)) < 1.5) s.breakCrate(c, false);
        });
        // cangrejos: pisarlos o girar; tocarlos de lado hace daño
        this.crabs.forEach(function (k) {
          if (!k.alive) return;
          var kp = k.node.position, d = Math.hypot(p.x - kp.x, p.z - kp.z);
          if (d < 1.2 && Math.abs(p.y - kp.y) < 1.3) {
            if (s.spinT > 0 || (ch.velocity.y < 0 && p.y > kp.y + 0.5)) { s.killCrab(k); if (!s.spinT) ch.velocity.y = 9; }
            else s.die();
          }
        });
        // frutas
        for (var i = 0; i < this.fruitPos.length; i++) if (this.fruitAlive[i] && this.fruitPos[i].distanceTo(new V3(p.x, p.y + 0.9, p.z)) < 1.0) { this.fruitAlive[i] = false; this.fruits++; this.snd('coin', 0.3); this.updateHud(); }
        if (p.y < -8) this.die();
        if (this.portal.position.distanceTo(new V3(p.x, p.y + 1, p.z)) < 1.8) this.win();
      }
      // TNT
      this.crates.forEach(function (c) { if (c.alive && c.fuse >= 0) { c.fuse -= dt; c.node.visible = Math.floor(c.fuse * 6) % 2 === 0; if (c.fuse <= 0) s.explodeTNT(c); } });
      // cangrejos andan de lado a lado
      this.crabs.forEach(function (k) { if (!k.alive) return; k.t += dt; k.node.position.x = k.base.x + Math.sin(k.t * 1.3) * k.range; k.node.rotation.y = Math.sin(k.t * 8) * 0.15; });
      // frutas giran (matrices de instancia)
      var fm = this.fruitMesh, rot = t * 0.003;
      for (var j = 0; j < this.fruitPos.length; j++) { var fp = this.fruitPos[j]; fm.setTransformAt(j, new V3(fp.x, fp.y + Math.sin(rot * 2 + j) * 0.12, fp.z), rot + j, this.fruitAlive[j] ? 1.4 : 0); }
      this.portal.rotation.y += dt * 1.5;
      // cámara
      var want = new V3(p.x * 0.6, p.y + 3.6, p.z + 7.2);
      this.camPos.lerp(want, 1 - Math.exp(-6 * dt)); v.camera.position.copy(this.camPos); v.camera.lookAt(p.x * 0.8, p.y + 1, p.z - 5);
    }
  }

  var Boot = { key: 'Boot', preload: function () { G3.loadModels(this, MODELS); }, create: function () { this.scene.start(G3.auto ? 'Play' : 'Menu'); } };
  G3.start({ title: 'Bandicrash', scenes: [
    Boot,
    MG.menu({ id: 'crash3d', title: 'Bandicrash', subtitle: 'Plataformas 3D · rompe todas las cajas', titleColors: [0xffe066, 0xff922b], glow: '#ff922b', buttonColor: 0xe8590c,
      help: 'WASD/flechas moverse · Espacio saltar · F, Shift o clic: girar (rompe cajas y derriba cangrejos). Salta sobre las cajas; cuidado con las TNT rojas.',
      touchHelp: 'Joystick para moverte, ⤒ saltar y ↻ girar. Salta sobre las cajas; cuidado con las TNT rojas.',
      background: G3.menuBackground(function (v, scene) { buildJungle(v, scene, false); v.add.sunlight({ shadowSize: 50 }); var h = v.add.model('hero'); h.position.set(0, 0, -6); h.play('Dance'); }, 10, 4) }),
    Play, MG.gameOver({ id: 'crash3d', background: function (s) { s.add.rectangle(s.game.width / 2, s.game.height / 2, s.game.width, s.game.height, 0x2b1a0e, 1); } })
  ] });
})();
