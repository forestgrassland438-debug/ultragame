/* Mazmorra — RPG de mazmorras 3D: plantas generadas (salas y pasillos), antorchas con un grupo de 8 luces que
 * sigue al jugador, niebla oscura, caballero en tercera persona con espada (animación Attack), esqueletos con IA,
 * cofres, pociones, experiencia y niveles, minimapa con niebla de guerra, 3 plantas y un jefe final. */
(function () {
  'use strict';
  var V3 = UG.Vec3;
  var MODELS = ['humanoid', 'robot', 'crate', 'barrel', 'coin'];
  var GW = 41, CELL = 3, FLOORS = 3;

  /** Genera la planta: salas unidas por pasillos en L (siempre conectada) */
  function generate(seed) {
    var rng = new UG.RNG(seed), g = [], rooms = [];
    for (var z = 0; z < GW; z++) { g.push([]); for (var x = 0; x < GW; x++) g[z].push('#'); }
    for (var tries = 0; tries < 200 && rooms.length < 9; tries++) {
      var w = rng.int(4, 8), h = rng.int(4, 8), rx = rng.int(1, GW - w - 2), rz = rng.int(1, GW - h - 2);
      if (rooms.some(function (r) { return rx < r.x + r.w + 2 && rx + w + 2 > r.x && rz < r.z + r.h + 2 && rz + h + 2 > r.z; })) continue;
      rooms.push({ x: rx, z: rz, w: w, h: h, cx: rx + (w >> 1), cz: rz + (h >> 1) });
      for (var a = rz; a < rz + h; a++) for (var b = rx; b < rx + w; b++) g[a][b] = '.';
    }
    rooms.sort(function (p, q) { return (p.cx + p.cz) - (q.cx + q.cz); });
    for (var i = 1; i < rooms.length; i++) {
      var A = rooms[i - 1], B = rooms[i], xx, zz;
      for (xx = Math.min(A.cx, B.cx); xx <= Math.max(A.cx, B.cx); xx++) g[A.cz][xx] = '.';
      for (zz = Math.min(A.cz, B.cz); zz <= Math.max(A.cz, B.cz); zz++) g[zz][B.cx] = '.';
    }
    // con muy pocas salas la planta sería trivial: se reintenta con otra semilla (determinista)
    if (rooms.length < 5) return generate(seed + '+');
    return { grid: g, rooms: rooms, rng: rng };
  }
  window.UGDungeon = { generate: generate, GW: GW };

  /** Texturas procedurales (canvas, semilla fija): ladrillo para muros y losas para suelo/techo. Se generan una vez. */
  function makeTextures(scene) {
    var T = scene.textures;
    if (!T.exists('dg-wall')) T.generate('dg-wall', 256, 256, function (ctx, w, h) {
      var r = new UG.RNG('dg-wall'), rows = 6, bh = h / rows, bw = w / 3;
      ctx.fillStyle = '#3e3832'; ctx.fillRect(0, 0, w, h);
      for (var y = 0; y < rows; y++) {
        var off = (y % 2) * 0.5, tone = [r.int(-14, 14), r.int(-14, 14), r.int(-14, 14)];
        // x = -1 y x = 2 comparten tono: la textura encaja sin costura al repetirse en muros contiguos
        for (var x = -1; x < 4; x++) { var l = tone[(x + 3) % 3]; ctx.fillStyle = 'rgb(' + (126 + l) + ',' + (116 + l) + ',' + (104 + l) + ')'; ctx.fillRect((x + off) * bw + 3, y * bh + 3, bw - 6, bh - 6); }
      }
      for (var i = 0; i < 1400; i++) { ctx.fillStyle = 'rgba(0,0,0,' + r.float(0.04, 0.18).toFixed(3) + ')'; ctx.fillRect(r.int(0, w - 2), r.int(0, h - 2), r.int(1, 3), r.int(1, 3)); }
    });
    if (!T.exists('dg-floor')) T.generate('dg-floor', 256, 256, function (ctx, w, h) {
      var r = new UG.RNG('dg-floor'), n = 2, s = w / n;
      ctx.fillStyle = '#2e2a26'; ctx.fillRect(0, 0, w, h);
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) { var l = r.int(-12, 12); ctx.fillStyle = 'rgb(' + (104 + l) + ',' + (98 + l) + ',' + (90 + l) + ')'; ctx.fillRect(x * s + 4, y * s + 4, s - 8, s - 8); }
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
      for (var c = 0; c < 6; c++) { var px = r.int(10, w - 10), py = r.int(10, h - 10); ctx.beginPath(); ctx.moveTo(px, py); for (var k = 0; k < 4; k++) { px += r.int(-18, 18); py += r.int(-18, 18); ctx.lineTo(px, py); } ctx.stroke(); }
      for (var i = 0; i < 1600; i++) { ctx.fillStyle = 'rgba(0,0,0,' + r.float(0.04, 0.16).toFixed(3) + ')'; ctx.fillRect(r.int(0, w - 2), r.int(0, h - 2), 2, 2); }
    });
  }

  class Play extends UG.Scene {
    constructor() { super('Play'); }
    preload() { G3.loadModels(this, MODELS); }
    init(data) { data = data || {}; this.floor = data.floor || 1; this.stats = data.stats || { hp: 100, maxHp: 100, xp: 0, level: 1, gold: 0, potions: 2, dmg: 22 }; }
    create() {
      var s = this, W = this.game.width, H = this.game.height;
      this.sound.unlock(); this.sound.prewarm(['punch', 'impact_metal']);
      // semilla fija en modo automático (reproducible); aleatoria al jugar (cada partida es distinta)
      if (!this.stats.seed) this.stats.seed = G3.auto ? 'auto' : String(Math.floor(Math.random() * 1e9));
      var gen = this.gen = generate('mazmorra-' + this.stats.seed + '-' + this.floor);
      var v = this.view = this.add.view3d({ fov: 60, far: 90 });
      var ph = v.enablePhysics({ gravity: -22 });
      v.scene3d.background = 0x050608; v.scene3d.setFog('exp2', 0x050608, 0.055); v.scene3d.exposure = 1.25;
      v.add.hemisphereLight(0x6c7a99, 0x1a140f, 0.35);
      var rows = gen.grid.map(function (r) { return r.join(''); });
      makeTextures(this);
      this.level = UG.Level3D.fromGrid(v, rows, { '#': 'wall', '.': 'floor' }, { cell: CELL, wallHeight: 3.4, center: false, materials: {
        wall: v.material({ color: 0xffffff, map: 'dg-wall', roughness: 0.95 }), floor: v.material({ color: 0xd0c8c0, map: 'dg-floor', roughness: 1 }), ceiling: v.material({ color: 0x6a625a, map: 'dg-floor', roughness: 1 }) } });
      var toW = function (x, z) { return new V3((x + 0.5) * CELL, 0, (z + 0.5) * CELL); };
      this.toW = toW;
      // antorchas en paredes junto a salas + 8 luces reales que se colocan en las más cercanas
      this.torches = [];
      gen.rooms.forEach(function (r) {
        [[r.x - 1, r.cz, 1, 0], [r.x + r.w, r.cz, -1, 0], [r.cx, r.z - 1, 0, 1], [r.cx, r.z + r.h, 0, -1]].forEach(function (t) {
          if (t[0] < 0 || t[1] < 0 || t[0] >= GW || t[1] >= GW || gen.grid[t[1]][t[0]] !== '#') return;
          var p = toW(t[0], t[1]); p.x += t[2] * (CELL / 2 + 0.12); p.z += t[3] * (CELL / 2 + 0.12); p.y = 2.1;
          s.torches.push(p);
        });
      });
      // soportes de antorcha: 1 draw call para todos
      var sticks = v.add.instanced(UG.Geometry3D.box(0.12, 0.5, 0.12), { color: 0x5c3b1e, roughness: 1 }, Math.max(1, this.torches.length));
      sticks.count = this.torches.length;
      this.torches.forEach(function (p, i) { sticks.setTransformAt(i, new V3(p.x, p.y - 0.3, p.z), 0, 1); });
      this.fire = v.addParticles('fire', { rate: 0, autoStart: false, capacity: 900, size: [0.35, 0.05], life: [0.3, 0.6], radius: 0.05 });
      this.lights = []; for (var l = 0; l < 7; l++) this.lights.push(v.add.pointLight(0xffa24a, 0, 11, 2));
      this.playerLight = v.add.pointLight(0xffd8a8, 1.4, 7, 2);
      // jugador
      var st = this.stats, start = gen.rooms[0];
      this.body = v.add.model('humanoid'); this.body.position.copy(toW(start.cx, start.cz));
      this.ch = ph.addCharacter(this.body, { radius: 0.35, height: 1.8 });
      var hand = this.body.getObjectByName('hand.R');
      var sword = v.add.group(); var blade = new UG.Mesh3D(UG.Geometry3D.box(0.06, 0.95, 0.12), v.material({ color: 0xdee2e6, metalness: 0.9, roughness: 0.25 })); blade.position.y = -0.55; sword.add(blade);
      var guard = new UG.Mesh3D(UG.Geometry3D.box(0.3, 0.06, 0.1), v.material({ color: 0xc9a227, metalness: 0.8 })); guard.position.y = -0.06; sword.add(guard);
      // la hoja se construye hacia -Y; girada -1.9 rad en X apunta hacia delante (+Z) y un poco arriba
      if (hand) { hand.add(sword); sword.position.set(0, -0.06, 0.03); sword.rotation.x = -1.9; }
      this.touch = G3.touchControls(this, [{ name: 'attack', label: '⚔', color: 0xfa5252, radius: 54 }, { name: 'potion', label: '♥', color: 0x40c057 }]);
      this.ctrl = v.thirdPersonControls({ target: this.body, character: this.ch, distance: 4.2, height: 1.7, speed: 4.2, runSpeed: 7, joystick: this.touch.joy, pitch: 0.45 });
      this.body.play('Idle');
      this.atkT = 0; this.atkHit = false; this.dead = false; this.won = false;
      // enemigos, cofres y escaleras
      this.enemies = []; this.chests = [];
      var rng = gen.rng;
      gen.rooms.forEach(function (r, i) {
        if (i === 0) return;
        var n = s.floor === FLOORS && i === gen.rooms.length - 1 ? 0 : rng.int(1, 1 + s.floor);
        for (var k = 0; k < n; k++) s.spawnEnemy(toW(rng.int(r.x, r.x + r.w - 1), rng.int(r.z, r.z + r.h - 1)), false);
        if (rng.float() < 0.6) {
          // cofre en una esquina de la sala, pegado a las paredes (nunca bloquea el paso: la celda mide 3 m)
          var sx = rng.float() < 0.5 ? -1 : 1, sz = rng.float() < 0.5 ? -1 : 1, cp = toW(sx < 0 ? r.x : r.x + r.w - 1, sz < 0 ? r.z : r.z + r.h - 1);
          cp.x += sx * 0.9; cp.z += sz * 0.9; s.spawnChest(cp, rng);
        }
      });
      var last = gen.rooms[gen.rooms.length - 1];
      this.exit = toW(last.cx, last.cz);
      if (this.floor === FLOORS) { this.boss = this.spawnEnemy(this.exit.clone(), true); }
      this.stairs = v.add.cylinder(1.1, 1.1, 0.2, { color: 0x9775fa, emissive: 0x7048e8, emissiveIntensity: 2 }, 24); this.stairs.position.set(this.exit.x, 0.1, this.exit.z);
      this.portalFx = v.addParticles('magic', { rate: 20, color: [0xb197fc, 0x7048e8] }); this.portalFx.position.copy(this.exit);
      this.stairs.visible = this.floor < FLOORS;
      // HUD
      // barras arriba a la izquierda: abajo quedan libres para el joystick táctil
      this.hpBar = G3.bar(this, 24, 50, 260, 22, 0xe03131, 'Vida');
      this.xpBar = G3.bar(this, 24, 80, 260, 10, 0x4dabf7);
      this.info = G3.text(this, 56, 26, '', 22, 0xffd43b, { ox: 0 });
      this.help = G3.text(this, W / 2, H - 22, G3.touch ? '' : 'WASD moverse · arrastrar ratón: mirar · clic/F atacar · H poción · llega al portal morado', 15, 0xdee2e6, { stroke: 3 });
      this.map = this.add.hud.graphics(); this.seen = new Uint8Array(GW * GW);
      MG.hudButtons(this, {});
      var kb = this.input.keyboard;
      kb.on('keydown-F', function () { s.attack(); }); kb.on('keydown-H', function () { s.drink(); });
      // clic en el mundo = atacar (no al pulsar los botones del HUD)
      this.input.on('pointerdown', function (p, objs) { if (p.type === 'mouse' && p.button === 0 && !(objs && objs.length)) s.attack(); });
      this.bot = G3.auto ? { t: 0 } : null;
      this.updateHud();
      MG.floatText(this, W / 2, H * 0.3, 'Planta ' + this.floor + (this.floor === FLOORS ? ' · ¡el jefe te espera!' : ''), 0xd0bfff, 40);
      G3.expose('dungeon', this);
    }
    snd(k, vol, pos) { if (this.sound.disabled) return; if (pos) this.view.playSfx(k, pos, { volume: vol || 0.5, refDistance: 3 }); else this.sound.playSfx(k, { volume: vol || 0.5 }); }
    spawnEnemy(pos, boss) {
      var v = this.view, node = v.add.model('robot', { cloneMaterials: true }), f = this.floor;
      node.traverse(function (n) { if (n.material) { n.material.color = boss ? 0xb197fc : 0xc8d3c0; n.material.emissive = boss ? 0x2b0a3d : 0x0a140a; } });
      if (boss) node.scale.set(1.6, 1.6, 1.6);
      node.position.copy(pos);
      var ch = v.physics.addCharacter(node, { radius: boss ? 0.6 : 0.38, height: boss ? 3 : 1.9 });
      var e = { node: node, ch: ch, hp: boss ? 260 : 36 + f * 14, max: boss ? 260 : 36 + f * 14, state: 'idle', atkT: 0, cd: 0, boss: boss, facing: 0, dmg: boss ? 18 : 6 + f * 3, speed: boss ? 2.6 : 3.1 };
      ch.userData.enemy = e; node.play('Idle');
      this.enemies.push(e);
      return e;
    }
    spawnChest(pos, rng) {
      var v = this.view, box = v.add.box(1, 0.7, 0.7, { color: 0x8a5a2b, roughness: 0.8 }); box.position.set(pos.x, 0.35, pos.z);
      var lid = v.add.box(1.04, 0.2, 0.74, { color: 0xc9a227, metalness: 0.6, roughness: 0.4 }); lid.position.set(pos.x, 0.8, pos.z);
      var col = v.physics.addBox(new V3(pos.x, 0.45, pos.z), new V3(0.5, 0.45, 0.35));
      this.chests.push({ box: box, lid: lid, col: col, pos: pos, open: false, gold: rng.int(10, 40) * this.floor, potion: rng.float() < 0.45 });
    }
    updateHud() {
      var st = this.stats, need = st.level * 60;
      this.hpBar.set(st.hp / st.maxHp, 'Vida ' + Math.ceil(st.hp) + ' / ' + st.maxHp);
      this.xpBar.set(st.xp / need);
      this.info.text = 'Planta ' + this.floor + '/' + FLOORS + '   Nv ' + st.level + '   Oro ' + st.gold + '   Pociones ' + st.potions;
    }
    attack() {
      if (this.atkT > 0 || this.dead || this.won) return;
      this.atkT = 0.55; this.atkHit = false;
      // ayuda al apuntar: gira hacia el enemigo vivo más cercano a distancia de espada
      var p = this.ch.position, best = null, bd = 3;
      this.enemies.forEach(function (e) { if (e.state === 'dead') return; var d = Math.hypot(e.ch.position.x - p.x, e.ch.position.z - p.z); if (d < bd) { bd = d; best = e; } });
      if (best) { this.ctrl.facing = Math.atan2(best.ch.position.x - p.x, best.ch.position.z - p.z); this.body.quaternion.setFromEuler(0, this.ctrl.facing, 0); }
      this.body.play('Attack', { fade: 0.05, loop: 'once', restart: true, speed: 1.3 });
      this._anim = null; // al terminar el golpe se vuelve a elegir Idle/Walk/Run
      this.snd({ preset: 'punch', seed: 2 }, 0.35);
    }
    drink() { var st = this.stats; if (st.potions <= 0 || st.hp >= st.maxHp) return; st.potions--; st.hp = Math.min(st.maxHp, st.hp + 45); this.snd('powerup', 0.5); G3.flash(this, 0x40c057, 0.2, 300); this.updateHud(); }
    gainXp(n) {
      var st = this.stats; st.xp += n;
      while (st.xp >= st.level * 60) { st.xp -= st.level * 60; st.level++; st.maxHp += 15; st.hp = st.maxHp; st.dmg += 6; this.snd('powerup', 0.7); MG.floatText(this, this.game.width / 2, this.game.height * 0.35, '¡Nivel ' + st.level + '!', 0x74c0fc, 40); }
      this.updateHud();
    }
    hurt(n) {
      if (this.dead) return;
      var st = this.stats; st.hp -= n; this.snd('hurt', 0.5); G3.flash(this, 0xff0000, 0.3, 300); this.cameras.main.shake(120, 0.006); this.updateHud();
      if (st.hp <= 0) { st.hp = 0; this.dead = true; this.body.play('Die', { loop: 'once', fade: 0.1 }); this.ctrl.enabled = false; var s = this; this.time.delayedCall(2500, function () { s.scene.start('GameOver', { score: st.gold + st.level * 100 + (s.floor - 1) * 300, win: false }); }); }
    }
    _bot(dt) {
      // bot: BFS por la rejilla hacia el enemigo vivo, cofre o portal más cercano; ataca al estar cerca
      var p = this.ch.position, s = this, g = this.gen.grid, cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL), B = this.bot;
      if ((B.plan = (B.plan || 0) - dt) <= 0) {
        B.plan = 0.2;
        var goals = this.enemies.filter(function (e) { return e.state !== 'dead'; }).map(function (e) { return e.ch.position; });
        if (!goals.length) goals = this.chests.filter(function (c) { return !c.open; }).map(function (c) { return c.pos; });
        if (!goals.length || (this.floor < FLOORS && B.t > 90)) goals = [this.exit];
        var N = GW * GW, prev = B.prev || (B.prev = new Int32Array(N)), tgt = new Map(), qu = B.qu || (B.qu = new Int32Array(N)), head = 0, tail = 0, end = -1, start = cz * GW + cx;
        goals.forEach(function (q) { tgt.set(Math.floor(q.z / CELL) * GW + Math.floor(q.x / CELL), q); });
        prev.fill(-2); prev[start] = -1; qu[tail++] = start;
        while (head < tail) {
          var c = qu[head++]; if (tgt.has(c)) { end = c; break; }
          var x0 = c % GW, z0 = (c - x0) / GW;
          for (var d = 0; d < 4; d++) {
            var nx = x0 + (d === 0 ? 1 : d === 1 ? -1 : 0), nz = z0 + (d === 2 ? 1 : d === 3 ? -1 : 0), n = nz * GW + nx;
            if (nx < 0 || nz < 0 || nx >= GW || nz >= GW || prev[n] !== -2 || g[nz][nx] === '#') continue;
            prev[n] = c; qu[tail++] = n;
          }
        }
        B.step = null;
        if (end >= 0) { var e2 = end; while (prev[e2] >= 0 && prev[e2] !== start) e2 = prev[e2]; B.step = e2 === start ? tgt.get(end) : this.toW(e2 % GW, Math.floor(e2 / GW)); }
      }
      var ext = { forward: 0, strafe: 0, run: false, jump: false }, step = B.step;
      // detector de atasco: si quiere avanzar y en 0.8 s no se ha movido, se aparta de lado un momento
      B.chk = (B.chk || 0) + dt;
      if (B.chk > 0.8) { var moved = B.lp ? Math.hypot(p.x - B.lp.x, p.z - B.lp.z) : 1; if (moved < 0.25 && B.wantMove) B.side = 0.6; B.lp = { x: p.x, z: p.z }; B.chk = 0; }
      B.wantMove = false;
      if (B.side > 0) { B.side -= dt; ext.strafe = (Math.floor(B.t / 3) % 2) ? 1 : -1; }
      if (step) { var dx = step.x - p.x, dz = step.z - p.z; if (Math.hypot(dx, dz) > 0.6) { this.ctrl.yaw = Math.atan2(-dx, -dz); ext.forward = 1; B.wantMove = true; } else B.plan = 0; }
      this.enemies.forEach(function (e) { if (e.state !== 'dead' && e.ch.position.distanceTo(p) < 2) { var ddx = e.ch.position.x - p.x, ddz = e.ch.position.z - p.z; s.ctrl.yaw = Math.atan2(-ddx, -ddz); ext.forward = 0; ext.strafe = 0; B.wantMove = false; s.attack(); } });
      if (this.stats.hp < this.stats.maxHp * 0.4) this.drink();
      this.ctrl.setExternal(ext);
    }
    update(t, dtMs) {
      var dt = Math.min(dtMs, 50) / 1000, s = this, v = this.view, p = this.ch.position, st = this.stats, tb = this.touch.buttons;
      if (tb.attack && tb.attack.justDown) this.attack(); if (tb.potion && tb.potion.justDown) this.drink();
      if (this.bot) { this.bot.t += dt; if (!this.dead && !this.won) this._bot(dt); }
      // ataque del jugador: golpe a mitad de la animación, en un arco delante
      if (this.atkT > 0) {
        this.atkT -= dt;
        if (!this.atkHit && this.atkT < 0.3) {
          this.atkHit = true;
          var fwd = new V3(Math.sin(this.ctrl.facing), 0, Math.cos(this.ctrl.facing));
          this.enemies.forEach(function (e) {
            if (e.state === 'dead') return; var d = e.ch.position.clone().sub(p); d.y = 0; var dist = d.length();
            if (dist < (e.boss ? 2.6 : 2) && d.normalize().dot(fwd) > 0.35) { e.hp -= st.dmg * (0.85 + Math.random() * 0.3); e.state = 'chase'; s.snd({ preset: 'impact_metal', seed: 1 + ((st.dmg | 0) & 3) }, 0.5, e.ch.position); v.effect('sparks', e.ch.position.clone().add(new V3(0, 1.2, 0)), { count: 10 }); e.node.play('Hit', { fade: 0.05, loop: 'once', exclusive: false, weight: 0.7, restart: true }); if (e.hp <= 0) s.killEnemy(e); }
          });
        }
      } else if (!this.dead) {
        var anim = this.ctrl.moving ? (this.ctrl.running ? 'Run' : 'Walk') : 'Idle';
        if (anim !== this._anim) { this._anim = anim; this.body.play(anim, { fade: 0.15 }); }
      }
      // enemigos
      this.enemies.forEach(function (e) {
        if (e.state === 'dead') return;
        var ep = e.ch.position, d = Math.hypot(p.x - ep.x, p.z - ep.z);
        if (e.state === 'idle' && d < 11 && v.physics.lineOfSight(ep.clone().add(new V3(0, 1.5, 0)), p.clone().add(new V3(0, 1.5, 0)))) { e.state = 'chase'; s.snd('select', 0.25, ep); }
        e.cd -= dt;
        if (e.state === 'chase' && !s.dead) {
          var want = Math.atan2(p.x - ep.x, p.z - ep.z); e.facing += G3.angleDiff(e.facing, want) * Math.min(1, 8 * dt); e.node.rotation.y = e.facing;
          if (d > (e.boss ? 2.2 : 1.5)) { e.ch.move(Math.sin(want) * e.speed, Math.cos(want) * e.speed); if (e._a !== 'Walk' && e.atkT <= 0) { e._a = 'Walk'; e.node.play('Walk', { fade: 0.2 }); } }
          else if (e.cd <= 0) { e.cd = e.boss ? 1.6 : 1.3; e.atkT = 0.55; e._a = 'Attack'; e.node.play('Attack', { fade: 0.05, loop: 'once', restart: true }); }
          else if (e.atkT <= 0 && e._a !== 'Idle') { e._a = 'Idle'; e.node.play('Idle', { fade: 0.2 }); }
        } else if (s.dead && e._a !== 'Idle' && e.atkT <= 0) { e._a = 'Idle'; e.node.play('Idle', { fade: 0.3 }); }
        if (e.atkT > 0) { var before = e.atkT; e.atkT -= dt; if (before >= 0.25 && e.atkT < 0.25 && d < (e.boss ? 3 : 2.2) && !s.dead) s.hurt(e.dmg); if (e.atkT <= 0) e._a = null; }
      });
      // cofres
      this.chests.forEach(function (c) {
        if (c.open || Math.hypot(p.x - c.pos.x, p.z - c.pos.z) > 1.6) return;
        c.open = true; st.gold += c.gold; if (c.potion) st.potions++; s.snd('coin', 0.6, c.pos); v.effect('coin', c.pos.clone().add(new V3(0, 1, 0)), { count: 20 });
        c.lid.rotation.x = -1.2; c.lid.position.y = 1.05; c.lid.position.z -= 0.35;
        MG.floatText(s, s.game.width / 2, s.game.height * 0.38, '+' + c.gold + ' oro' + (c.potion ? ' · +1 poción' : ''), 0xffd43b, 28); s.updateHud();
      });
      // portal (o victoria en la última planta)
      if (!this.dead && !this.won && this.stairs.visible && Math.hypot(p.x - this.exit.x, p.z - this.exit.z) < 1.3) { this.won = true; this.snd('powerup', 0.8); var nf = this.floor + 1; this.time.delayedCall(700, function () { s.scene.restart({ floor: nf, stats: st }); }); }
      // luces: las antorchas más cercanas; fuego en ellas
      var near = this.torches.slice().sort(function (a, b) { return a.distanceToSq(p) - b.distanceToSq(p); });
      for (var i = 0; i < this.lights.length; i++) { var L = this.lights[i]; if (near[i]) { L.position.copy(near[i]); L.intensity = 3.2 + Math.sin(t * 0.013 + i * 7) * 0.4; } else L.intensity = 0; }
      for (var j = 0; j < Math.min(8, near.length); j++) if (Math.random() < dt * 18) this.fire.burst(1, near[j]);
      this.playerLight.position.set(p.x, p.y + 2.2, p.z);
      // minimapa con niebla de guerra
      var cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL), g = this.gen.grid, R = 4, changed = false;
      for (var dz = -R; dz <= R; dz++) for (var dx = -R; dx <= R; dx++) { var X = cx + dx, Z = cz + dz; if (X >= 0 && Z >= 0 && X < GW && Z < GW && !this.seen[Z * GW + X]) { this.seen[Z * GW + X] = 1; changed = true; } }
      if (changed || (this._mapT = (this._mapT || 0) + dt) > 0.25) {
        this._mapT = 0;
        var m = this.map, S = 4, ox = this.game.width - GW * S - 20, oy = 56;
        m.clear().fillStyle(0x000000, 0.55).fillRect(ox - 4, oy - 4, GW * S + 8, GW * S + 8);
        for (var zz = 0; zz < GW; zz++) for (var xx = 0; xx < GW; xx++) if (this.seen[zz * GW + xx]) m.fillStyle(g[zz][xx] === '#' ? 0x5c5448 : 0x9c9286, 1).fillRect(ox + xx * S, oy + zz * S, S, S);
        this.enemies.forEach(function (e) { if (e.state === 'dead') return; var ex = Math.floor(e.ch.position.x / CELL), ez = Math.floor(e.ch.position.z / CELL); if (s.seen[ez * GW + ex]) m.fillStyle(e.boss ? 0xda77f2 : 0xff4040, 1).fillRect(ox + ex * S, oy + ez * S, S, S); });
        var ex2 = Math.floor(this.exit.x / CELL), ez2 = Math.floor(this.exit.z / CELL); if (this.seen[ez2 * GW + ex2] && this.stairs.visible) m.fillStyle(0x9775fa, 1).fillRect(ox + ex2 * S - 1, oy + ez2 * S - 1, S + 2, S + 2);
        m.fillStyle(0x69db7c, 1).fillCircle(ox + (p.x / CELL) * S, oy + (p.z / CELL) * S, 3);
      }
      if (st.hp < st.maxHp && !this.dead) { st.hp = Math.min(st.maxHp, st.hp + dt * 0.6); if (Math.random() < dt) this.updateHud(); }
    }
    killEnemy(e) {
      var s = this; e.state = 'dead'; e.ch.enabled = false; e.node.play('Die', { loop: 'once', fade: 0.1 });
      this.gainXp(e.boss ? 400 : 20 + this.floor * 8); this.stats.gold += e.boss ? 200 : 5; this.updateHud();
      this.view.effect('smoke', e.ch.position.clone().add(new V3(0, 1, 0)), { count: 12 });
      if (e.boss) { this.won = true; MG.floatText(this, this.game.width / 2, this.game.height * 0.35, '¡Has derrotado al jefe!', 0xb197fc, 44); this.time.delayedCall(2500, function () { s.scene.start('GameOver', { score: s.stats.gold + s.stats.level * 100 + 1500, win: true }); }); }
      else this.time.delayedCall(6000, function () { if (e.node && !e.node.destroyed) { e.ch.destroy(); e.node.destroy(); } });
    }
  }

  var Boot = { key: 'Boot', preload: function () { G3.loadModels(this, MODELS); }, create: function () { this.scene.start(G3.auto ? 'Play' : 'Menu'); } };
  G3.start({ title: 'Mazmorra', scenes: [
    Boot,
    MG.menu({ id: 'dungeon3d', title: 'Mazmorra', subtitle: 'RPG 3D · 3 plantas y un jefe', titleColors: [0xffe8cc, 0xff922b], glow: '#e8590c', buttonColor: 0xa61e4d,
      help: 'WASD moverse · arrastra el ratón para mirar · clic o F atacar · H beber poción. Abre cofres, sube de nivel y cruza el portal morado de cada planta.',
      touchHelp: 'Joystick para moverte, arrastra a la derecha para mirar. ⚔ atacar, ♥ poción.',
      background: G3.menuBackground(function (v, scene) {
        makeTextures(scene);
        // cripta pequeña: suelo, pilares, 2 antorchas con fuego, el caballero frente a un esqueleto
        v.scene3d.background = 0x050608; v.scene3d.setFog('exp2', 0x050608, 0.06);
        v.add.hemisphereLight(0x6c7a99, 0x1a140f, 0.3);
        var fl = v.add.box(16, 0.2, 16, { color: 0xd0c8c0, map: 'dg-floor', roughness: 1, uvScale: 5 }); fl.position.y = -0.1;
        [[-4, -4], [4, -4], [-4, 4], [4, 4]].forEach(function (c) { v.add.box(1, 4, 1, { color: 0xffffff, map: 'dg-wall', roughness: 0.95 }).position.set(c[0], 2, c[1]); });
        [[-3.4, -4], [3.4, 4]].forEach(function (c) { var p = new V3(c[0], 2.2, c[1]); v.add.pointLight(0xffa24a, 3.5, 12, 2).position.copy(p); v.addParticles('fire', { rate: 30, size: [0.35, 0.05], life: [0.3, 0.6], radius: 0.05 }).position.copy(p); });
        var hero = v.add.model('humanoid'); hero.position.set(-1, 0, 0); hero.rotation.y = Math.PI / 2; hero.play('Idle');
        var foe = v.add.model('robot'); foe.position.set(1.2, 0, 0); foe.rotation.y = -Math.PI / 2; foe.play('Idle');
      }, 7, 3) }),
    Play, MG.gameOver({ id: 'dungeon3d', background: function (s) { s.add.rectangle(s.game.width / 2, s.game.height / 2, s.game.width, s.game.height, 0x050608, 1); } })
  ] });
})();
