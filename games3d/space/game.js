/* Galaxia 3D — shooter espacial "sobre raíles": la nave se mueve en su plano y el universo viene hacia ella.
 * Asteroides instanciados (1 draw call), cazas enemigos con patrones, láseres reutilizados, potenciadores,
 * jefe final con barra de vida, estelas de partículas y resplandor (BloomFilter 2D aplicado a la vista 3D). */
(function () {
  'use strict';
  var V3 = UG.Vec3, rnd = new UG.RNG('galaxia');
  var BX = 9, BY = 5, FAR = -170, BOSS_T = 75;

  function shipGeometry(bodyCol, wingCol, glowCol) {
    var G = UG.Geometry3D, M = UG.Mat4, Q = UG.Quat, P = function (g, col, pos, rot, sc) { return { geometry: g, color: col, matrix: new M().compose(new V3(pos[0], pos[1], pos[2]), rot ? new Q().setFromEuler(rot[0], rot[1], rot[2]) : new Q(), sc ? new V3(sc[0], sc[1], sc[2]) : new V3(1, 1, 1)) }; };
    return G.merge([
      P(G.cone(0.45, 2.2, 10), bodyCol, [0, 0, -0.4], [-Math.PI / 2, 0, 0]),
      P(G.box(3.2, 0.12, 0.9), wingCol, [0, -0.05, 0.35]),
      P(G.box(0.12, 0.6, 0.7), wingCol, [1.5, 0.25, 0.45]), P(G.box(0.12, 0.6, 0.7), wingCol, [-1.5, 0.25, 0.45]),
      P(G.sphere(0.28, 10, 8), 0x74c0fc, [0, 0.25, -0.2], null, [1, 0.8, 1.6]),
      P(G.cylinder(0.22, 0.28, 0.4, 10), glowCol, [0.45, 0, 0.75], [Math.PI / 2, 0, 0]), P(G.cylinder(0.22, 0.28, 0.4, 10), glowCol, [-0.45, 0, 0.75], [Math.PI / 2, 0, 0])
    ]);
  }
  function rockGeometry() {
    var g = UG.Geometry3D.sphere(1, 9, 7), p = g.attributes.position.data, r = new UG.RNG('roca');
    // abolla la esfera (mismo desplazamiento para vértices coincidentes de la costura)
    var cache = {};
    for (var i = 0; i < p.length; i += 3) { var k = p[i].toFixed(3) + ',' + p[i + 1].toFixed(3) + ',' + p[i + 2].toFixed(3), f = cache[k] || (cache[k] = 0.75 + r.float() * 0.45); p[i] *= f; p[i + 1] *= f; p[i + 2] *= f; }
    g.markDirty('position'); g.computeNormals();
    return g;
  }

  class Play extends UG.Scene {
    constructor() { super('Play'); }
    create() {
      var s = this, W = this.game.width, H = this.game.height;
      this.sound.unlock(); this.sound.prewarm(['laser_gun', 'plasma', 'blast', 'grenade', 'impact_metal']);
      var v = this.view = this.add.view3d({ fov: 60, far: 260 });
      v.scene3d.background = 0x02030a; v.scene3d.setFog('linear', 0x02030a, 90, 175); v.scene3d.exposure = 1.1;
      v.add.hemisphereLight(0x8fb4ff, 0x2a1a3a, 0.6); var sun = v.add.directionalLight(0xfff1e0, 2.2); sun.setDirection(-0.5, -0.6, -0.8);
      v.filters = [new UG.BloomFilter({ threshold: 0.55, intensity: 1.3, blur: 8 })];
      // fondo: planeta y nebulosa lejanos (sin niebla)
      var planet = v.add.sphere(40, { color: 0x5f3dc4, roughness: 0.9, fog: false, emissive: 0x1a0f3a }, 48); planet.position.set(60, -30, -230);
      var ring = v.add.torus(62, 3, { color: 0xb197fc, type: 'basic', fog: false, transparent: true, opacity: 0.5 }); ring.position.copy(planet.position); ring.rotation.x = 1.2;
      this.stars = v.addParticles({ rate: 220, life: [1.2, 1.2], speed: [120, 150], spread: 0, direction: [0, 0, 1], gravity: 0, size: [0.06, 0.06], stretch: 30, color: [0xffffff, 0xaec8ff], alpha: [0.9, 0.9], blend: 'add', box: [70, 40, 10], offset: [0, 0, FAR * 0.9], fog: false, capacity: 600 });
      // nave
      this.ship = v.add.mesh(shipGeometry(0xdee2e6, 0x1c7ed6, 0x66d9e8), { vertexColors: true, metalness: 0.5, roughness: 0.35, emissive: 0x0b3040 });
      this.trail = v.addParticles({ rate: 80, life: [0.25, 0.4], speed: [4, 8], spread: 0.1, direction: [0, 0, 1], gravity: 0, size: [0.5, 0.05], color: [0x99e9f2, 0x1c7ed6], alpha: [0.9, 0], blend: 'add', capacity: 200 });
      this.pos = new V3(0, 0, 0); this.vel = new V3(); this.hp = 5; this.shield = 0; this.triple = 0; this.fireCd = 0; this.invul = 0; this.score = 0; this.combo = 0; this.comboT = 0; this.t = 0; this.over = false;
      // pools
      this.rockGeo = rockGeometry();
      this.rocks = []; this.rockMesh = v.add.instanced(this.rockGeo, { color: 0x8c7b6b, roughness: 0.95, flatShading: true }, 60); this.rockMesh.count = 0;
      this.enemies = []; this.enemyGeo = shipGeometry(0xc92a2a, 0x5c0f0f, 0xffa94d); this.enemyGeo.keep = true; // se reutiliza aunque no quede ningún enemigo
      this.lasers = []; this.laserGeo = UG.Geometry3D.box(0.1, 0.1, 1.8); this.laserGeo.keep = true;
      this.laserMat = { p: v.material({ type: 'basic', color: 0x66ffff, blend: 'add', transparent: true }), e: v.material({ type: 'basic', color: 0xff4040, blend: 'add', transparent: true }) };
      this.freeLasers = [];
      this.pickups = []; this.boss = null;
      // cámara
      v.camera.position.set(0, 2.6, 9);
      // HUD
      this.hpBar = G3.bar(this, 24, H - 48, 240, 22, 0x4dabf7, 'Casco');
      this.scoreText = G3.text(this, W / 2, 34, '0', 36, 0xffffff);
      this.info = G3.text(this, 56, 26, '', 20, 0xa5d8ff, { ox: 0 });
      this.bossBar = null;
      G3.text(this, W / 2, H - 20, G3.touch ? '' : 'WASD/flechas mover · Espacio/clic disparar (mantén) · Shift turbo', 15, 0xd0ebff, { stroke: 3 });
      this.touch = G3.touchControls(this, [{ name: 'fire', label: '●', color: 0x22b8cf, radius: 56 }]);
      MG.hudButtons(this, {});
      this.mouse = G3.mouseButtons(this);
      this.bot = G3.auto ? { t: 0 } : null;
      this.events.once('shutdown', function () { [s.laserGeo, s.enemyGeo].forEach(function (g) { if (g) { g.keep = false; g.dispose(); } }); });
      this.updateHud();
      G3.expose('space', this);
    }
    snd(k, vol) { if (!this.sound.disabled) this.sound.playSfx(k, { volume: vol || 0.4 }); }
    updateHud() { this.hpBar.set(this.hp / 5, 'Casco ' + this.hp + (this.shield > 0 ? ' 🛡' : '') + (this.triple > 0 ? ' ⋔' : '')); this.scoreText.text = String(this.score); }
    laser(from, dir, enemy) {
      var m = this.freeLasers.pop() || this.view.add.mesh(this.laserGeo, this.laserMat.p);
      m.material = enemy ? this.laserMat.e : this.laserMat.p; m.visible = true; m.castShadow = false;
      m.position.copy(from); m.lookAt(from.x + dir.x, from.y + dir.y, from.z + dir.z);
      this.lasers.push({ m: m, v: dir.clone().scale(enemy ? 38 : 90), enemy: enemy, life: 2.2 });
    }
    fire() {
      if (this.fireCd > 0) return; this.fireCd = 0.12;
      var p = this.pos, dirs = this.triple > 0 ? [[0, 0], [-0.12, 0], [0.12, 0]] : [[0, 0]];
      for (var i = 0; i < dirs.length; i++) { var d = new V3(dirs[i][0], dirs[i][1], -1).normalize(); this.laser(new V3(p.x + (i === 0 ? 0 : dirs[i][0] * 6), p.y, p.z - 1.4), d, false); }
      this.snd({ preset: 'laser_gun', seed: 1 + (this._shotN = ((this._shotN || 0) + 1) % 3) }, 0.22);
    }
    spawnRock() { if (this.rocks.length >= 60) return; var sz = rnd.float(0.8, 2.4); this.rocks.push({ p: new V3(rnd.float(-BX - 4, BX + 4), rnd.float(-BY - 2, BY + 2), FAR), r: sz, hp: Math.ceil(sz * 2), rot: new V3(rnd.float(0, 6), rnd.float(0, 6), 0), spin: new V3(rnd.float(-1, 1), rnd.float(-1, 1), 0), vz: rnd.float(18, 30) }); }
    spawnEnemy(kind) {
      var v = this.view; if (!this.enemyMat) this.enemyMat = v.material({ vertexColors: true, metalness: 0.4, roughness: 0.4, emissive: 0x401010 });
      var m = v.add.mesh(this.enemyGeo, this.enemyMat); m.rotation.y = Math.PI;
      var e = { m: m, p: new V3(rnd.float(-BX, BX), rnd.float(-BY, BY), FAR * 0.8), hp: kind === 'heavy' ? 6 : 2, kind: kind, t: rnd.float(0, 6), fireT: rnd.float(1, 2.5), vz: kind === 'heavy' ? 14 : 22, amp: rnd.float(2, 5) };
      if (kind === 'heavy') m.scale.set(1.8, 1.8, 1.8);
      this.enemies.push(e);
    }
    spawnBoss() {
      var v = this.view, g = v.add.group(), hull = new UG.Mesh3D(shipGeometry(0x495057, 0x862e9c, 0xff6b6b), v.material({ vertexColors: true, metalness: 0.6, roughness: 0.3, emissive: 0x2b0a3d }));
      hull.scale.set(5, 5, 5); hull.rotation.y = Math.PI; g.add(hull);
      var core = new UG.Mesh3D(UG.Geometry3D.sphere(1.2, 20, 14), v.material({ type: 'basic', color: 0xff8787 })); core.position.set(0, 1.4, 1); g.add(core);
      g.position.set(0, 0, FAR); this.boss = { g: g, core: core, hp: 120, max: 120, t: 0, fireT: 1.5, p: g.position };
      this.bossBar = G3.bar(this, this.game.width / 2 - 250, 70, 500, 18, 0xff6b6b, 'Nave nodriza');
      MG.floatText(this, this.game.width / 2, this.game.height * 0.3, '¡Nave nodriza!', 0xff8787, 44); this.snd('select', 0.6);
    }
    explode(p, big) { this.view.effect('explosion', p, { count: big ? 90 : 40 }); this.view.effect('sparks', p, { count: big ? 40 : 16 }); this.snd({ preset: big ? 'blast' : 'grenade', seed: 1 + ((p.x * 7 | 0) & 3) }, big ? 0.8 : 0.45); if (big) this.cameras.main.shake(350, 0.012); }
    addScore(n) { this.combo = this.comboT > 0 ? this.combo + 1 : 1; this.comboT = 2; this.score += n * Math.min(5, this.combo); this.updateHud(); }
    hurt() {
      if (this.invul > 0 || this.over) return;
      if (this.shield > 0) { this.shield = 0; this.snd({ preset: 'impact_metal', seed: 1 }, 0.55); G3.flash(this, 0x4dabf7, 0.3, 300); this.invul = 0.6; this.updateHud(); return; }
      this.hp--; this.invul = 1.2; this.snd('hurt', 0.6); G3.flash(this, 0xff0000, 0.4, 400); this.cameras.main.shake(250, 0.01); this.updateHud();
      if (this.hp <= 0) { this.over = true; this.explode(this.pos.clone(), true); this.ship.visible = false; var s = this; this.time.delayedCall(2200, function () { s.scene.start('GameOver', { score: s.score, win: false }); }); }
    }
    _botInput() {
      // bot: se alinea con el enemigo/roca más cercano, esquiva láseres y dispara siempre
      var p = this.pos, tgt = null, bd = 1e9, dodge = new V3();
      this.enemies.concat(this.boss ? [{ p: this.boss.p }] : []).forEach(function (e) { var d = Math.abs(e.p.z - p.z); if (e.p.z < p.z && d < bd) { bd = d; tgt = e.p; } });
      this.rocks.forEach(function (r) { var dz = p.z - r.p.z; if (dz > 0 && dz < 30 && Math.hypot(r.p.x - p.x, r.p.y - p.y) < r.r + 1.5) { dodge.x += p.x - r.p.x; dodge.y += p.y - r.p.y; } });
      this.lasers.forEach(function (l) { if (l.enemy && l.m.position.z < p.z && l.m.position.z > p.z - 20 && Math.hypot(l.m.position.x - p.x, l.m.position.y - p.y) < 2) { dodge.x += p.x - l.m.position.x + 0.1; dodge.y += p.y - l.m.position.y; } });
      var mx = 0, my = 0;
      if (dodge.lengthSq() > 0.01) { mx = Math.sign(dodge.x) || 1; my = Math.sign(dodge.y); }
      else if (tgt) { mx = Math.max(-1, Math.min(1, (tgt.x - p.x) * 0.8)); my = Math.max(-1, Math.min(1, (tgt.y - p.y) * 0.8)); }
      return { x: mx, y: my, fire: true, boost: false };
    }
    update(time, dtMs) {
      var dt = Math.min(dtMs, 50) / 1000, s = this, v = this.view, kb = this.input.keyboard, p = this.pos, i;
      if (!this.over) this.t += dt;
      this.fireCd -= dt; this.invul -= dt; this.shield -= dt; this.triple -= dt; this.comboT -= dt;
      // entrada
      var inp = this.bot ? this._botInput() : { x: 0, y: 0, fire: false, boost: false };
      if (!this.bot) {
        if (kb.isDown('KeyA') || kb.isDown('LEFT')) inp.x -= 1; if (kb.isDown('KeyD') || kb.isDown('RIGHT')) inp.x += 1;
        if (kb.isDown('KeyW') || kb.isDown('UP')) inp.y += 1; if (kb.isDown('KeyS') || kb.isDown('DOWN')) inp.y -= 1;
        var js = this.touch.joy; if (js && js.isActive) { inp.x += js.forceX; inp.y -= js.forceY; }
        var pad = this.input.gamepad.pad1; if (pad && pad.connected) { inp.x += Math.abs(pad.axes[0]) > 0.15 ? pad.axes[0] : 0; inp.y -= Math.abs(pad.axes[1]) > 0.15 ? pad.axes[1] : 0; if (pad.isDown(0) || pad.value(7) > 0.5) inp.fire = true; }
        inp.fire = inp.fire || this.mouse.left || kb.isDown('SPACE') || !!(this.touch.buttons.fire && this.touch.buttons.fire.isDown);
        inp.boost = kb.isDown('SHIFT');
      }
      if (!this.over) {
        var acc = 60, maxV = 13;
        this.vel.x += (Math.max(-1, Math.min(1, inp.x)) * maxV - this.vel.x) * Math.min(1, 8 * dt); this.vel.y += (Math.max(-1, Math.min(1, inp.y)) * maxV - this.vel.y) * Math.min(1, 8 * dt);
        p.x = Math.max(-BX, Math.min(BX, p.x + this.vel.x * dt)); p.y = Math.max(-BY, Math.min(BY, p.y + this.vel.y * dt));
        this.ship.position.copy(p); this.ship.rotation.set(this.vel.y * 0.03, 0, -this.vel.x * 0.05);
        this.ship.visible = this.invul <= 0 || Math.floor(this.invul * 12) % 2 === 0;
        if (inp.fire) this.fire();
        this.trail.position.set(p.x, p.y, p.z + 1);
        void acc;
      }
      var speed = inp.boost ? 1.6 : 1;
      // cámara: sigue suavemente con parallax
      v.camera.position.set(p.x * 0.55, 2.6 + p.y * 0.55, 9); v.camera.lookAt(p.x * 0.8, p.y * 0.8, -20);
      // oleadas
      var diff = 1 + this.t / 40;
      if (!this.boss && this.t < BOSS_T) {
        if (rnd.float() < dt * 1.6 * diff) this.spawnRock();
        if (rnd.float() < dt * 0.55 * diff) this.spawnEnemy(rnd.float() < 0.2 ? 'heavy' : 'fighter');
      } else if (!this.boss && this.t >= BOSS_T) this.spawnBoss();
      // asteroides (matrices de instancia)
      var rm = this.rockMesh, m4 = new UG.Mat4(), q = new UG.Quat();
      for (i = this.rocks.length - 1; i >= 0; i--) {
        var r = this.rocks[i]; r.p.z += r.vz * speed * dt; r.rot.x += r.spin.x * dt; r.rot.y += r.spin.y * dt;
        if (r.p.z > 14) { this.rocks.splice(i, 1); continue; }
        if (!this.over && r.p.distanceTo(p) < r.r * 0.85 + 0.7) { this.hurt(); this.explode(r.p.clone(), false); this.rocks.splice(i, 1); }
      }
      rm.count = this.rocks.length;
      for (i = 0; i < this.rocks.length; i++) { var rk = this.rocks[i]; rm.setMatrixAt(i, m4.compose(rk.p, q.setFromEuler(rk.rot.x, rk.rot.y, 0), new V3(rk.r, rk.r, rk.r))); }
      // enemigos
      for (i = this.enemies.length - 1; i >= 0; i--) {
        var e = this.enemies[i]; e.t += dt; e.p.z += e.vz * speed * dt; e.p.x += Math.cos(e.t * 1.3) * e.amp * dt; e.p.y += Math.sin(e.t * 1.7) * e.amp * 0.5 * dt;
        e.m.position.copy(e.p); e.m.rotation.z = Math.cos(e.t * 1.3) * 0.4;
        if ((e.fireT -= dt) <= 0 && e.p.z < -12 && !this.over) { e.fireT = e.kind === 'heavy' ? 1.1 : rnd.float(1.4, 2.4); var d = p.clone().sub(e.p).normalize(); this.laser(e.p.clone().addScaled(d, 1.5), d, true); if (e.kind === 'heavy') { this.laser(e.p.clone(), d.clone().add(new V3(0.12, 0, 0)).normalize(), true); this.laser(e.p.clone(), d.clone().add(new V3(-0.12, 0, 0)).normalize(), true); } }
        if (e.p.z > 14) { e.m.destroy(); this.enemies.splice(i, 1); continue; }
        if (!this.over && e.p.distanceTo(p) < 1.6) { this.hurt(); this.explode(e.p.clone(), false); e.m.destroy(); this.enemies.splice(i, 1); }
      }
      // jefe
      var b = this.boss;
      if (b) {
        b.t += dt; if (b.p.z < -45) b.p.z += 14 * dt; b.p.x = Math.sin(b.t * 0.6) * 6; b.p.y = Math.sin(b.t * 0.9) * 2;
        b.core.material.color = Math.floor(b.t * 4) % 2 ? 0xff8787 : 0xffc9c9;
        if ((b.fireT -= dt) <= 0 && b.p.z > -60 && !this.over) { b.fireT = b.hp < b.max / 2 ? 0.7 : 1.1; for (var k = -2; k <= 2; k++) { var dd = p.clone().sub(b.p).normalize(); dd.x += k * 0.08; this.laser(b.p.clone().add(new V3(0, 0, 4)), dd.normalize(), true); } this.snd({ preset: 'plasma', seed: 2 }, 0.3); }
      }
      // láseres
      for (i = this.lasers.length - 1; i >= 0; i--) {
        var L = this.lasers[i], lp = L.m.position; lp.addScaled(L.v, dt); L.life -= dt;
        var dead = L.life <= 0 || lp.z < FAR - 10 || lp.z > 15;
        if (!dead && L.enemy && !this.over && lp.distanceTo(p) < 0.9) { this.hurt(); dead = true; }
        if (!dead && !L.enemy) {
          for (var a = this.rocks.length - 1; a >= 0 && !dead; a--) { var rr = this.rocks[a]; if (lp.distanceTo(rr.p) < rr.r + 0.2) { dead = true; if (--rr.hp <= 0) { this.explode(rr.p.clone(), false); this.rocks.splice(a, 1); this.addScore(10); if (rnd.float() < 0.12) this.pickups.push(this.makePickup(rr.p.clone())); } else v.effect('sparks', lp.clone(), { count: 6 }); } }
          for (var c = this.enemies.length - 1; c >= 0 && !dead; c--) { var en = this.enemies[c]; if (lp.distanceTo(en.p) < (en.kind === 'heavy' ? 2.2 : 1.4)) { dead = true; if (--en.hp <= 0) { this.explode(en.p.clone(), en.kind === 'heavy'); en.m.destroy(); this.enemies.splice(c, 1); this.addScore(en.kind === 'heavy' ? 60 : 25); if (rnd.float() < 0.25) this.pickups.push(this.makePickup(en.p.clone())); } else v.effect('sparks', lp.clone(), { count: 8 }); } }
          if (!dead && b && lp.distanceTo(b.p) < 6) { dead = true; b.hp--; v.effect('sparks', lp.clone(), { count: 6 }); this.bossBar.set(b.hp / b.max); if (b.hp <= 0) this.winGame(); }
        }
        if (dead) { L.m.visible = false; this.freeLasers.push(L.m); this.lasers.splice(i, 1); }
      }
      // potenciadores
      for (i = this.pickups.length - 1; i >= 0; i--) {
        var pk = this.pickups[i]; pk.p.z += 16 * dt; pk.m.position.copy(pk.p); pk.m.rotation.y += dt * 3;
        if (pk.p.distanceTo(p) < 1.5 && !this.over) { if (pk.kind === 'shield') this.shield = 8; else if (pk.kind === 'triple') this.triple = 10; else this.hp = Math.min(5, this.hp + 1); this.snd('powerup', 0.5); this.updateHud(); pk.m.destroy(); this.pickups.splice(i, 1); continue; }
        if (pk.p.z > 14) { pk.m.destroy(); this.pickups.splice(i, 1); }
      }
      this.stars.cfg.speed = inp.boost ? [220, 260] : [120, 150];
      this.info.text = (this.combo > 1 && this.comboT > 0 ? 'Combo x' + Math.min(5, this.combo) + '   ' : '') + (this.boss ? '' : 'Nave nodriza en ' + Math.max(0, Math.ceil(BOSS_T - this.t)) + ' s');
    }
    makePickup(pos) {
      var kinds = ['shield', 'triple', 'repair'], kind = kinds[rnd.int(0, 2)], col = { shield: 0x4dabf7, triple: 0x69db7c, repair: 0xffd43b }[kind];
      var m = this.view.add.sphere(0.45, { color: col, emissive: col, emissiveIntensity: 1.5, roughness: 0.2 }, 16); m.position.copy(pos);
      return { m: m, p: pos, kind: kind };
    }
    winGame() {
      if (this.over) return; this.over = true;
      var b = this.boss, s = this; this.explode(b.p.clone(), true); this.explode(b.p.clone().add(new V3(3, 1, 0)), true); b.g.destroy(); this.boss = null;
      this.score += 1000 + this.hp * 200; this.updateHud(); this.snd('powerup', 0.8);
      MG.floatText(this, this.game.width / 2, this.game.height * 0.35, '¡Victoria!', 0x69db7c, 56);
      this.time.delayedCall(2500, function () { s.scene.start('GameOver', { score: s.score, win: true }); });
    }
  }

  var Boot = { key: 'Boot', create: function () { this.scene.start(G3.auto ? 'Play' : 'Menu'); } };
  G3.start({ title: 'Galaxia 3D', scenes: [
    Boot,
    MG.menu({ id: 'space3d', title: 'Galaxia 3D', subtitle: 'Shooter espacial · derrota a la nave nodriza', titleColors: [0xffffff, 0x66d9e8], glow: '#22b8cf', buttonColor: 0x1098ad,
      help: 'WASD/flechas mover · Espacio o clic (mantén) disparar · Shift turbo. Recoge escudos (azul), disparo triple (verde) y reparaciones (amarillo).',
      touchHelp: 'Joystick para moverte y botón ● para disparar. Recoge escudos, disparo triple y reparaciones.',
      background: function (scene) { scene.cameras.main.setBackgroundColor(0x02030a); } }),
    Play, MG.gameOver({ id: 'space3d', background: function (s) { s.add.rectangle(s.game.width / 2, s.game.height / 2, s.game.width, s.game.height, 0x02030a, 1); } })
  ] });
})();
