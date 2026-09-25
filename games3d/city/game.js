/* Ciudad Libre — mundo abierto 3D estilo GTA: ciudad en cuadrícula con tráfico que sigue carriles, peatones,
 * robo de coches (E), policía según el nivel de búsqueda (los agentes BAJAN del coche, te persiguen a pie por la
 * rejilla de navegación, disparan y te detienen si te alcanzan), vida con reaparición en el hospital o la comisaría,
 * misiones de reparto con tiempo, ciclo día/noche con nubes y estrellas, parques con hierba, disparos con sonido
 * realista y minimapa real (M: mapa grande). */
(function () {
  'use strict';
  var V3 = UG.Vec3, rnd = new UG.RNG('ciudad');
  var MODELS = ['humanoid', 'robot', 'car', 'taxi', 'police', 'kart', 'tree', 'pine', 'bush', 'lamp', 'pistol', 'shop', 'house', 'barrel'];
  var N = 6, B = 52, HALFR = 6, LANE = 3, SIZE = N * B;
  var DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  function inter(i, j) { return new V3(i * B, 0, j * B); }
  function tex(scene, key, w, h, draw) { if (!scene.textures.exists(key)) scene.textures.generate(key, w, h, draw); return scene.textures.get(key); }

  /* ------------------------------------------------------------------ ciudad */
  function buildCity(v, scene, withPhysics) {
    var ph = withPhysics ? v.physics : null, sc = v.scene3d, city = { buildings: [], lamps: [], parks: [] };
    sc.setSky({ top: 0x3872c4, horizon: 0xd6e4f0, bottom: 0x555555, clouds: { coverage: 0.42, speed: 0.01, scale: 0.45 } }); sc.setFog('linear', 0xd6e4f0, 90, 260);
    // fachada + mapa emisivo con el MISMO patrón (RNG con semilla): de noche solo brillan las ventanas encendidas
    var pattern = function (emissive) { return function (ctx, w, h) {
      var r = new UG.RNG('ventanas'); ctx.fillStyle = emissive ? '#000000' : '#9aa5b1'; ctx.fillRect(0, 0, w, h);
      for (var y = 6; y < h - 4; y += 16) for (var x = 5; x < w - 4; x += 14) { var lit = r.float() < 0.55; ctx.fillStyle = emissive ? (lit ? '#ffe8a3' : '#000000') : (lit ? '#ffe8a3' : '#2b3440'); ctx.fillRect(x, y, 8, 10); }
    }; };
    var winTex = tex(scene, 'windows3d', 64, 128, pattern(false)), winEm = tex(scene, 'windowsEm3d', 64, 128, pattern(true));
    winTex.source.setWrapMode('repeat'); winEm.source.setWrapMode('repeat');
    var road = tex(scene, 'cityroad3d', 64, 64, function (ctx, w, h) { ctx.fillStyle = '#3a3c40'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#e9ecef'; ctx.fillRect(w / 2 - 1, 4, 2, h / 2 - 8); });
    road.source.setWrapMode('repeat');
    v.add.plane(SIZE + 200, SIZE + 200, { color: 0x8a8f94, roughness: 1 }).setPosition(SIZE / 2, 0, SIZE / 2);
    // calles: tiras con la textura repetida a lo largo
    // mismo plano largo para ambas direcciones: la línea central de la textura va a lo largo (eje v)
    var roadMat = v.material({ map: road, roughness: 0.95, uvScale: [1, (SIZE + HALFR * 2) / 8] });
    for (var k = 0; k <= N; k++) {
      var sz = v.add.plane(HALFR * 2, SIZE + HALFR * 2, roadMat); sz.position.set(k * B, 0.02, SIZE / 2);
      var sx = v.add.plane(HALFR * 2, SIZE + HALFR * 2, roadMat); sx.position.set(SIZE / 2, 0.021, k * B); sx.rotation.y = Math.PI / 2;
    }
    for (var ii = 0; ii <= N; ii++) for (var jj = 0; jj <= N; jj++) { var cross = v.add.plane(HALFR * 2, HALFR * 2, { color: 0x3a3c40, roughness: 0.95 }); cross.position.set(ii * B, 0.03, jj * B); }
    // manzanas: edificios (4 alturas = 4 InstancedMesh, 1 draw call cada una) o parques
    var classes = [12, 24, 38, 56].map(function (hgt) { return { h: hgt, list: [] }; });
    var treeT = [];
    for (var bi = 0; bi < N; bi++) for (var bj = 0; bj < N; bj++) {
      var x0 = bi * B + HALFR + 3, z0 = bj * B + HALFR + 3, span = B - HALFR * 2 - 6;
      var curb = v.add.box(B - HALFR * 2, 0.18, B - HALFR * 2, { color: 0xb8bcc2, roughness: 1 }); curb.position.set(bi * B + B / 2, 0.09, bj * B + B / 2); curb.receiveShadow = true;
      if ((bi * 7 + bj * 3) % 9 === 4) {
        var park = v.add.box(span, 0.2, span, { color: 0x4f8a3a, roughness: 1 }); park.position.set(x0 + span / 2, 0.12, z0 + span / 2);
        city.parks.push(new V3(x0 + span / 2, 0, z0 + span / 2));
        v.add.grass({ area: [x0 + 0.5, z0 + 0.5, x0 + span - 0.5, z0 + span - 0.5], density: withPhysics ? 2 : 1, y: 0.22, seed: 'parque' + bi + '_' + bj });
        for (var t = 0; t < 10; t++) treeT.push({ x: x0 + 3 + rnd.float(span - 6), y: 0.2, z: z0 + 3 + rnd.float(span - 6), ry: rnd.float(6.28), s: rnd.float(1, 1.6) });
        continue;
      }
      var cells = 2, cs = span / cells;
      for (var cx = 0; cx < cells; cx++) for (var cz = 0; cz < cells; cz++) {
        var cls = classes[rnd.int(0, 3)], w = cs - rnd.float(2, 5), d = cs - rnd.float(2, 5), bx = x0 + (cx + 0.5) * cs, bz = z0 + (cz + 0.5) * cs;
        cls.list.push({ x: bx, z: bz, w: w, d: d });
        city.buildings.push({ x: bx, z: bz, w: w, d: d, h: cls.h });
        if (ph) ph.addBox(new V3(bx, cls.h / 2, bz), new V3(w / 2, cls.h / 2, d / 2));
      }
    }
    city.winMats = [];
    classes.forEach(function (c, ci) {
      if (!c.list.length) return;
      var mat = v.material({ map: winTex, emissiveMap: winEm, emissive: 0x000000, color: [0xc9d1d9, 0xe7c9a9, 0xa9c4e7, 0xd8d8d8][ci], roughness: 0.6, metalness: 0.1, uvScale: [1.5, c.h / 12] });
      var im = v.add.instanced(UG.Geometry3D.box(1, 1, 1), mat, c.list.length);
      c.list.forEach(function (b, i) { var m = new UG.Mat4().compose(new V3(b.x, c.h / 2, b.z), new UG.Quat(), new V3(b.w, c.h, b.d)); im.setMatrixAt(i, m); });
      city.winMats.push(mat);
    });
    G3.instances(v, 'tree', treeT);
    // farolas en las esquinas
    var lampT = [];
    for (var li = 0; li <= N; li++) for (var lj = 0; lj <= N; lj++) { if ((li + lj) % 2) continue; lampT.push({ x: li * B + HALFR + 0.8, z: lj * B + HALFR + 0.8, ry: -Math.PI * 0.75 }); city.lamps.push(new V3(li * B + HALFR + 0.8 - 0.7, 3.8, lj * B + HALFR + 0.8 - 0.7)); }
    G3.instances(v, 'lamp', lampT);
    if (ph) {
      ph.addGround(0); lampT.forEach(function (l) { ph.addBox(new V3(l.x, 2, l.z), new V3(0.15, 2, 0.15)); });
      // límites de la ciudad (muros invisibles): ni coches ni personas salen del mapa
      var E = HALFR + 4; [[SIZE / 2, -E, SIZE / 2 + E, 0.5], [SIZE / 2, SIZE + E, SIZE / 2 + E, 0.5], [-E, SIZE / 2, 0.5, SIZE / 2 + E], [SIZE + E, SIZE / 2, 0.5, SIZE / 2 + E]].forEach(function (w) { ph.addBox(new V3(w[0], 4, w[1]), new V3(w[2], 4, w[3])); });
    }
    return city;
  }

  /* -------------------------------------------------------- conducción (IA) */
  /** Conductor que sigue carriles de la cuadrícula; route() opcional hacia un destino */
  class Driver {
    constructor(scene, car, i, j, dir) { this.scene = scene; this.car = car; this.i = i; this.j = j; this.dir = dir; this.cruise = rnd.float(9, 13); this.dest = null; this.stuck = 0; }
    lanePoint(i, j, dir) { var c = inter(i, j), d = DIRS[dir]; return new V3(c.x - d[1] * LANE, 0, c.z + d[0] * LANE); } // derecha de la marcha
    choose() {
      var ni = this.i + DIRS[this.dir][0], nj = this.j + DIRS[this.dir][1], opts = [];
      for (var d = 0; d < 4; d++) { if (d === (this.dir + 2) % 4) continue; var ti = ni + DIRS[d][0], tj = nj + DIRS[d][1]; if (ti >= 0 && tj >= 0 && ti <= N && tj <= N) opts.push(d); }
      if (!opts.length) opts.push((this.dir + 2) % 4);
      if (this.dest) { var best = opts[0], bd = Infinity; opts.forEach(function (d) { var ti = ni + DIRS[d][0], tj = nj + DIRS[d][1], dd = Math.abs(ti * B - this.dest.x) + Math.abs(tj * B - this.dest.z); if (dd < bd) { bd = dd; best = d; } }, this); return { i: ni, j: nj, dir: best }; }
      return { i: ni, j: nj, dir: opts[rnd.int(0, opts.length - 1)] };
    }
    update(dt, obstacles) {
      var c = this.car, ni = this.i + DIRS[this.dir][0], nj = this.j + DIRS[this.dir][1], target = this.lanePoint(ni, nj, this.dir);
      var dist = Math.hypot(target.x - c.position.x, target.z - c.position.z);
      if (dist < 7 || ni < 0 || nj < 0 || ni > N || nj > N) { var nx = this.choose(); this.i = nx.i; this.j = nx.j; this.dir = nx.dir; }
      var aim = this.lanePoint(this.i + DIRS[this.dir][0], this.j + DIRS[this.dir][1], this.dir);
      var want = Math.atan2(aim.x - c.position.x, aim.z - c.position.z), diff = G3.angleDiff(c.heading, want);
      // freno si hay algo delante (coches, personas, el jugador)
      var fx = Math.sin(c.heading), fz = Math.cos(c.heading), blocked = false;
      for (var k = 0; k < obstacles.length; k++) {
        var o = obstacles[k]; if (o === c) continue;
        var dx = o.position.x - c.position.x, dz = o.position.z - c.position.z, d = Math.hypot(dx, dz);
        if (d < 0.5 || d > 11 || (dx * fx + dz * fz) / d < 0.85) continue;
        if (o instanceof UG.Vehicle3D) {
          // misma dirección: hacer cola; tráfico cruzado u opuesto: cede el de id mayor (evita bloqueos mutuos en los cruces)
          var same = Math.cos(o.heading - c.heading) > 0.3;
          if (same || (d < 7 && c.id > o.id)) { blocked = true; break; }
        } else { blocked = true; break; }
      }
      var vmax = Math.abs(diff) > 0.5 ? 5 : this.cruise;
      c.setInput(blocked ? 0 : (c.speed < vmax ? 1 : 0), Math.max(-1, Math.min(1, diff * 2)), blocked || c.speed > vmax + 3, false);
      // atasco largo: marcha atrás un momento
      if (!blocked && Math.abs(c.speed) < 0.5 && c.throttle > 0) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt);
      if (this.stuck > 2) { c.setInput(-1, -Math.sign(diff), false, false); if (this.stuck > 3.5) this.stuck = 0; }
    }
  }

  /* ======================================================== policía a pie */
  var _copMat = null;
  class Officer {
    constructor(scene, car, side) {
      var v = scene.view, c = car.car, lx = Math.cos(c.heading) * side, lz = -Math.sin(c.heading) * side;
      this.scene = scene; this.carRec = car; this.hp = 60; this.dead = false; this.state = 'exit'; this.t = 0.5; this.fireT = rnd.float(0.8, 1.4); this.path = null; this.pi = 0; this.repath = 0; this.facing = c.heading;
      this.node = v.add.model('humanoid'); this.node.position.set(c.position.x + lx * 1.6, 0, c.position.z + lz * 1.6);
      if (!_copMat || _copMat.disposed) { var src = null; this.node.traverse(function (n) { if (!src && n instanceof UG.Mesh3D && n.material) src = n.material; }); _copMat = src.clone(); _copMat.color = 0x4a6fa5; _copMat.version++; }
      this.node.traverse(function (n) { if (n instanceof UG.Mesh3D && n.material) n.material = _copMat; });
      var hand = this.node.getObjectByName('hand.R'); if (hand) { var g = v.add.model('pistol'); hand.add(g); g.position.set(0, -0.06, 0.04); g.rotation.x = Math.PI / 2; this.gun = g; }
      this.ch = v.physics.addCharacter(this.node, { radius: 0.34, height: 1.8 }); this.ch.userData.officer = this;
      this.node.play('Run');
      var self = this; this.ch.on('hitByVehicle', function (veh, imp) { if (imp > 6) self.damage(80, true); });
    }
    eye() { var p = this.ch.position; return new V3(p.x, p.y + 1.6, p.z); }
    _anim(n) { if (this._a !== n) { this._a = n; this.node.play(n, { fade: 0.2 }); } }
    update(dt) {
      var s = this.scene, me = this.ch.position, P = s.playerPos(), dx = P.x - me.x, dz = P.z - me.z, dist = Math.hypot(dx, dz), vx = 0, vz = 0;
      if (this.dead) { if ((this.t += dt) > 10) this.remove(); return; }
      var onFoot = !s.driving, sees = onFoot && dist < 30 && s.view.physics.lineOfSight(this.eye(), new V3(P.x, 1.3, P.z));
      if (this.state === 'exit') { if ((this.t -= dt) <= 0) this.state = 'chase'; }
      else if (s.wanted === 0 || (s.driving && dist > 45)) this.state = 'return';
      else if (onFoot && dist < 1.9) this.state = 'arrest';
      else if (sees && dist < 20) this.state = 'shoot';
      else this.state = 'chase';
      var goal = this.state === 'return' ? this.carRec.car.position : P;
      if (this.state === 'chase' || this.state === 'return') {
        if ((this.repath -= dt) <= 0) { this.repath = 0.9; this.path = s.grid ? s.grid.findPath(me, goal) : null; this.pi = this.path && this.path.length > 1 ? 1 : 0; }
        var wp = this.path && this.path[this.pi] ? this.path[this.pi] : goal, wx = wp.x - me.x, wz = wp.z - me.z, wl = Math.hypot(wx, wz);
        if (this.path && wl < 1.2 && this.pi < this.path.length - 1) this.pi++;
        if (wl > 0.3) { vx = wx / wl * 6.2; vz = wz / wl * 6.2; }
        if (this.state === 'return' && Math.hypot(goal.x - me.x, goal.z - me.z) < 2.6) { this.enterCar(); return; }
      }
      if (this.state === 'shoot') {
        if ((this.fireT -= dt) <= 0) { this.fireT = rnd.float(0.8, 1.5); this.shoot(dist); }
        if (dist > 8) { vx = dx / dist * 2.2; vz = dz / dist * 2.2; }
      }
      if (this.state === 'arrest') { s.arrestT += dt * 2; s.hint.text = '¡Te están deteniendo! Aléjate o sube a un coche'; }
      this.ch.move(vx, vz);
      var want = (this.state === 'shoot' || this.state === 'arrest') ? Math.atan2(dx, dz) : (vx || vz ? Math.atan2(vx, vz) : this.facing);
      this.facing += G3.angleDiff(this.facing, want) * Math.min(1, 8 * dt); this.node.rotation.y = this.facing;
      this._anim(this.state === 'shoot' ? (this.fireT < 0.15 ? 'Shoot' : 'Aim') : (this.state === 'arrest' ? 'Attack' : ((vx || vz) ? 'Run' : 'Idle')));
    }
    shoot(dist) {
      var s = this.scene, P = s.playerPos(), mz = this.gun ? (this.gun.getObjectByName('muzzle') || this.gun).getWorldPosition(new V3()) : this.eye();
      var mv = s.driving ? 0 : Math.hypot(s.ch.velocity.x, s.ch.velocity.z), chance = Math.max(0.12, 0.62 - dist / 38 - (mv > 5 ? 0.22 : 0));
      var tgt = new V3(P.x, 1.2, P.z), hit = rnd.float() < chance; if (!hit) tgt.add(new V3(rnd.float(-1.5, 1.5), rnd.float(-0.6, 1), rnd.float(-1.5, 1.5)));
      s.tracer(mz, tgt, 0xffd08a); s.view.effect('muzzle', mz, { count: 5 }); s.snd({ preset: 'pistol', seed: rnd.int(1, 4) }, 0.45, mz);
      if (hit) s.hurt(rnd.int(6, 11), this.ch.position);
      else { var d = tgt.clone().sub(mz).normalize(), h = s.view.physics.raycast(mz, d, 60, { characters: false }); if (h) { s.view.addDecal('bullet', h.point, h.normal); s.view.effect('sparks', h.point, { count: 6 }); } }
    }
    damage(n, byCar) {
      if (this.dead) return; var s = this.scene;
      this.hp -= n; s.view.effect('blood', this.eye().add(new V3(0, -0.4, 0)), { count: 22 }); s.snd({ preset: 'flesh', seed: 2 }, 0.5, this.ch.position);
      if (this.hp <= 0) { this.dead = true; this.t = 0; this.ch.enabled = false; this.node.play('Die', { loop: 'once', fade: 0.1 }); s.view.addDecal('pool', new V3(this.ch.position.x, 0.02, this.ch.position.z), new V3(0, 1, 0), { size: 1.3, grow: 5 }); s.addWanted(byCar ? 1 : 2); s.feed.add('Agente abatido: +2 ★', 0x74c0fc); }
      else s.addWanted(1);
    }
    enterCar() { this.remove(); this.carRec.officers = Math.max(0, (this.carRec.officers || 1) - 1); if (!this.carRec.officers) { this.carRec.deployed = false; this.carRec.deployCd = 12; } }
    remove() { if (this.removed) return; this.removed = true; this.ch.destroy(); this.node.destroy(); }
  }

  /* ================================================================== Juego */
  class Play extends UG.Scene {
    constructor() { super('Play'); }
    preload() { G3.loadModels(this, MODELS); }
    create() {
      var s = this, W = this.game.width, H = this.game.height;
      this.sound.unlock();
      var v = this.view = this.add.view3d({ fov: 62, far: 420 });
      var ph = v.enablePhysics({ gravity: -22 });
      this.city = buildCity(v, this, true);
      this.sun = v.add.sunlight({ shadowSize: 80, ambient: 0.7 });
      this.money = 0; this.wanted = 0; this.wantedT = 0; this.clock = 9; this.over = false; this.hp = 100; this.arrestT = 0; this.officers = []; this.deaths = 0; this.busts = 0; this.respawnT = 0;
      this.sound.prewarm(['pistol', 'flesh', 'impact', 'engine_start']);
      // jugador a pie
      this.body = v.add.model('humanoid'); this.body.position.set(B * 2 + 8, 0, B * 2 + 8);
      this.ch = ph.addCharacter(this.body, { radius: 0.35, height: 1.8 }); this.ch.userData.player = true;
      this.pistol = v.add.model('pistol'); var hand = this.body.getObjectByName('hand.R'); if (hand) { hand.add(this.pistol); this.pistol.position.set(0, -0.06, 0.04); this.pistol.rotation.x = Math.PI / 2; }
      this.touch = G3.touchControls(this, [{ name: 'enter', label: 'E', color: 0xfab005, radius: 50 }, { name: 'fire', label: '●', color: 0xff4d4d }, { name: 'jump', label: '⤒', color: 0x4dabf7 }]);
      this.onFoot();
      // tráfico
      var models = ['car', 'taxi', 'kart', 'car', 'taxi'];
      this.traffic = [];
      for (var t = 0; t < 14; t++) this.spawnTraffic(models[t % models.length], rnd.int(0, N), rnd.int(0, N));
      // peatones
      this.peds = [];
      for (var p = 0; p < 12; p++) this.spawnPed();
      this.police = [];
      // farolas: 6 luces reales que se colocan en las farolas más cercanas por la noche
      this.lampLights = []; for (var l = 0; l < 6; l++) { var pl = v.add.pointLight(0xffd59e, 0, 16, 2); this.lampLights.push(pl); }
      this.headlight = v.add.spotLight(0xfff4d6, 0, 40, 0.55, 0.4);
      // misiones
      this.marker = v.add.cylinder(1.6, 1.6, 30, { type: 'basic', color: 0xffd43b, transparent: true, opacity: 0.35, blend: 'add', side: 'double' }, 24); this.marker.castShadow = false;
      this.newMission();
      // HUD
      this.moneyText = G3.text(this, W - 30, 70, '', 30, 0x69db7c, { ox: 1 });
      this.starText = G3.text(this, W - 30, 106, '', 30, 0xffd43b, { ox: 1 });
      this.clockText = G3.text(this, W - 30, 140, '', 20, 0xffffff, { ox: 1 });
      this.missionText = G3.text(this, W / 2, 34, '', 22, 0xffffff);
      this.speedText = G3.text(this, W - 30, H - 36, '', 30, 0xffffff, { ox: 1 });
      this.hint = G3.text(this, W / 2, H - 70, '', 20, 0xfff3bf);
      this.help = G3.text(this, W / 2, H - 24, G3.touch ? '' : 'WASD moverse/conducir · ratón (arrastrar) mirar · E subir/bajar del coche · clic disparar · Espacio saltar/freno de mano', 15, 0xdee2e6, { stroke: 3 });
      // rejilla de navegación de la ciudad (aceras, calles y parques) para los agentes a pie
      this.grid = UG.NavGrid3D.fromPhysics(ph, { area: [-8, -8, SIZE + 8, SIZE + 8], cell: 2, radius: 0.4, height: 1.8 });
      var city = this.city;
      this.map = G3.minimap(this, { key: 'city-map', world: [-10, -10, SIZE + 10, SIZE + 10], ppm: 3, x: 115, y: H - 130, radius: 95, range: 90, title: 'Mapa de la ciudad',
        legend: [[0xffd43b, 'Recoger paquete'], [0x51cf66, 'Entregar'], [0x4dabf7, 'Policía'], [0xadb5bd, 'Tráfico']],
        draw: function (ctx, X, Z, ppm) {
          ctx.fillStyle = '#8a8f94'; ctx.fillRect(0, 0, X(SIZE + 10), Z(SIZE + 10));
          ctx.fillStyle = '#3a3c40'; for (var k2 = 0; k2 <= N; k2++) { ctx.fillRect(X(k2 * B - HALFR), Z(-HALFR), HALFR * 2 * ppm, (SIZE + HALFR * 2) * ppm); ctx.fillRect(X(-HALFR), Z(k2 * B - HALFR), (SIZE + HALFR * 2) * ppm, HALFR * 2 * ppm); }
          ctx.fillStyle = '#e9ecef'; for (var k3 = 0; k3 <= N; k3++) for (var q = 0; q < SIZE; q += 8) { ctx.fillRect(X(k3 * B - 0.2), Z(q), 0.4 * ppm, 4 * ppm); ctx.fillRect(X(q), Z(k3 * B - 0.2), 4 * ppm, 0.4 * ppm); }
          ctx.fillStyle = '#4f8a3a'; city.parks.forEach(function (pk) { var sp = B - HALFR * 2 - 6; ctx.fillRect(X(pk.x - sp / 2), Z(pk.z - sp / 2), sp * ppm, sp * ppm); });
          city.buildings.forEach(function (b) { var sh = Math.min(1, b.h / 56); ctx.fillStyle = 'rgb(' + Math.round(70 + 60 * sh) + ',' + Math.round(80 + 55 * sh) + ',' + Math.round(100 + 50 * sh) + ')'; ctx.fillRect(X(b.x - b.w / 2), Z(b.z - b.d / 2), b.w * ppm, b.d * ppm); ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(X(b.x - b.w / 2), Z(b.z - b.d / 2), b.w * ppm, b.d * ppm); });
        } });
      this.hpBar = G3.bar(this, W - 290, H - 80, 260, 22, 0x51cf66, 'Vida');
      this.dmgInd = G3.damageIndicator(this); this.vign = G3.vignette(this); this.feed = G3.feed(this, W - 30, 180);
      this.bigMsg = G3.text(this, W / 2, H * 0.4, '', 56, 0xff6b6b, { stroke: 6 });
      this.crosshair = G3.crosshair(this);
      MG.hudButtons(this, {});
      this.input.keyboard.on('keydown-E', function () { s.toggleCar(); });
      this.mouse = G3.mouseButtons(this);
      this.fireCd = 0;
      this.bot = G3.auto ? { t: 0, phase: 'walk' } : null;
      this.events.once('shutdown', function () { s.traffic = []; s.peds = []; s.police = []; s.officers = []; if (s._trGeo) { s._trGeo.keep = false; s._trGeo.dispose(); s._trGeo = null; } _copMat = null; });
      this.updateHud();
      G3.expose('city', this);
    }
    snd(k, vol, pos) { if (this.sound.disabled) return; if (pos) this.view.playSfx(k, pos, { volume: vol || 0.5, refDistance: 5 }); else this.sound.playSfx(k, { volume: vol || 0.5 }); }
    spawnTraffic(key, i, j) {
      var v = this.view, dir = rnd.int(0, 3), node = v.add.model(key), s = this;
      var wheels = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'].map(function (w) { return node.getObjectByName(w); });
      var car = v.physics.addVehicle(node, { maxSpeed: 26, rideHeight: 0, wheels: wheels });
      var drv = new Driver(this, car, i, j, dir), lp = drv.lanePoint(i, j, dir);
      car.teleport(new V3(lp.x + DIRS[dir][0] * 12, 0.3, lp.z + DIRS[dir][1] * 12), Math.atan2(DIRS[dir][0], DIRS[dir][1]));
      var rec = { node: node, car: car, driver: drv, key: key, police: key === 'police' };
      car.on('hit', function (ch) { if (s.driving === rec) { s.addWanted(1); var pd = s.peds.find(function (x) { return x.ch === ch; }); if (pd) s.killPed(pd); } });
      car.on('crash', function (imp, other) { if (s.driving === rec && imp > 6) { s.snd('hit', 0.5); s.cameras.main.shake(120, 0.006); if (other && s.police.some(function (pc) { return pc.car === other; })) s.addWanted(1); } });
      this.traffic.push(rec);
      return rec;
    }
    spawnPed() {
      var v = this.view, bi = rnd.int(0, N - 1), bj = rnd.int(0, N - 1), inset = HALFR + 1.6;
      var corners = [[bi * B + inset, bj * B + inset], [(bi + 1) * B - inset, bj * B + inset], [(bi + 1) * B - inset, (bj + 1) * B - inset], [bi * B + inset, (bj + 1) * B - inset]];
      if (rnd.float() < 0.5) corners.reverse();
      var start = rnd.int(0, 3), node = v.add.model(rnd.float() < 0.25 ? 'robot' : 'humanoid');
      node.position.set(corners[start][0], 0, corners[start][1]);
      var ch = v.physics.addCharacter(node, { radius: 0.32, height: 1.75 });
      var ped = { node: node, ch: ch, corners: corners, k: (start + 1) % 4, speed: rnd.float(1.2, 1.7), state: 'walk', t: 0, facing: 0 };
      node.play('Walk');
      var s = this; ch.on('hitByVehicle', function () { if (ped.state !== 'dead') s.killPed(ped); });
      this.peds.push(ped);
    }
    killPed(ped) { if (ped.state === 'dead') return; ped.state = 'dead'; ped.t = 0; ped.node.play('Die', { loop: 'once', fade: 0.1 }); ped.ch.enabled = false; this.view.effect('blood', ped.ch.position.clone().add(new V3(0, 1, 0)), { count: 30 }); this.view.addDecal('pool', new V3(ped.ch.position.x, 0.2, ped.ch.position.z), new V3(0, 1, 0), { size: 1.2, grow: 5 }); this.snd({ preset: 'flesh', seed: 3 }, 0.5, ped.ch.position); }
    /** Trazadora de bala (mallas reutilizadas) */
    tracer(a, b, color) {
      var v = this.view, d = b.clone().sub(a), len = d.length(); if (len < 0.1) return;
      if (!this._trGeo) { this._trGeo = UG.Geometry3D.box(0.02, 0.02, 1); this._trGeo.keep = true; this._trMats = {}; this._trFree = []; this._tracers = []; }
      var mat = this._trMats[color] || (this._trMats[color] = v.material({ type: 'basic', color: color, transparent: true, blend: 'add' }));
      var m = this._trFree.pop() || v.add.mesh(this._trGeo, mat); m.material = mat; m.visible = true; m.castShadow = false;
      m.position.copy(a).addScaled(d, 0.5); m.scale.set(1, 1, len); m.lookAt(b); this._tracers.push({ m: m, life: 0.05 });
    }
    /** Daño al jugador (a pie o en el coche) */
    hurt(n, from) {
      if (this.over || this.respawnT > 0) return;
      this.hp = Math.max(0, this.hp - n); G3.flash(this, 0xff0000, Math.min(0.4, 0.12 + n / 70), 300); this.snd({ preset: 'flesh', seed: 1 }, 0.45);
      if (from) { var pp = this.playerPos(), dx = from.x - pp.x, dz = from.z - pp.z, yaw = this.driving ? Math.PI + this.driving.car.heading : this.ctrl.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw); this.dmgInd.hit(Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz)); }
      if (this.hp <= 0) this.respawn('muerto');
    }
    /** Reaparición: hospital (muerto) o comisaría (detenido), con multa y aviso claro; la partida sigue */
    respawn(why) {
      if (this.respawnT > 0) return;
      var s = this, fine = Math.round(this.money * (why === 'muerto' ? 0.2 : 0.3)); this.respawnT = 3.2;
      if (why === 'muerto') { this.deaths++; if (!this.driving) this.body.play('Die', { loop: 'once', fade: 0.1 }); } else this.busts++;
      this.bigMsg.text = why === 'muerto' ? '¡HAS MUERTO!' : '¡DETENIDO!'; this.bigMsg.setColor ? this.bigMsg.setColor(why === 'muerto' ? 0xff6b6b : 0x4dabf7) : null;
      this.feed.add((why === 'muerto' ? 'Hospital' : 'Comisaría') + ': multa de $' + fine, 0xffd43b);
      this.money -= fine; this.updateHud(); if (this.ctrl) this.ctrl.enabled = false;
      this.time.delayedCall(3000, function () {
        if (!s.view) return;
        if (s.driving) s.toggleCar();
        // en la acera, mirando a lo largo de la calle
        var spot = why === 'muerto' ? new V3(B * 1 + HALFR + 1.6, 0.25, B * 3 + B / 2) : new V3(B * 4 + HALFR + 1.6, 0.25, B * 2 + B / 2);
        s.ch.enabled = true; s.body.visible = true; s.ch.teleport(spot); if (s.ctrl) { s.ctrl.yaw = 0; s.ctrl.pitch = 0.3; } s.hp = 100; s.wanted = 0; s.arrestT = 0; s.bigMsg.text = ''; s.respawnT = 0;
        s.officers.forEach(function (o) { o.remove(); }); s.officers = []; s.police.forEach(function (r) { r.deployed = false; r.officers = 0; });
        if (s.ctrl) s.ctrl.enabled = true; s.body.play('Idle', { fade: 0.2 }); s.updateHud();
      });
    }
    addWanted(n) { this.wanted = Math.min(5, this.wanted + n); this.wantedT = 0; this.updateHud(); }
    newMission() {
      var pick = function () { var i = rnd.int(0, N - 1), j = rnd.int(0, N - 1), side = rnd.int(0, 3), c = inter(i, j); return side === 0 ? new V3(c.x + B / 2, 0, c.z + HALFR + 1.5) : side === 1 ? new V3(c.x + HALFR + 1.5, 0, c.z + B / 2) : side === 2 ? new V3(c.x + B / 2, 0, c.z + B - HALFR - 1.5) : new V3(c.x + B - HALFR - 1.5, 0, c.z + B / 2); };
      var from = this.mission && this.mission.to ? this.mission.to : null;
      this.mission = { stage: 'pickup', at: pick(), to: null, timeLeft: 0, reward: 0 };
      if (from && from.distanceTo(this.mission.at) < 40) this.mission.at = pick();
      this.marker.position.set(this.mission.at.x, 15, this.mission.at.z); this.marker.material.color = 0xffd43b; this.marker.material.version++;
    }
    playerPos() { return this.driving ? this.driving.car.position : this.ch.position; }
    onFoot() {
      var v = this.view;
      if (this.ctrl) v.removeControl(this.ctrl);
      this.ctrl = v.thirdPersonControls({ target: this.body, character: this.ch, distance: 5, height: 1.6, shoulder: 0.4, speed: 4.5, runSpeed: 8, joystick: this.touch.joy });
      this.body.play('Idle');
    }
    toggleCar() {
      var s = this, v = this.view;
      if (this.driving) {
        // bajar por la izquierda del coche
        var rec = this.driving, c = rec.car, lx = Math.cos(c.heading), lz = -Math.sin(c.heading);
        this.ch.enabled = true; this.body.visible = true; this.ch.teleport(new V3(c.position.x + lx * 2.2, 0.2, c.position.z + lz * 2.2));
        c.setInput(0, 0, true); rec.driver = null; this.driving = null;
        if (this.follow) { v.removeControl(this.follow); this.follow = null; }
        this.onFoot(); this.snd('click', 0.5);
        return;
      }
      var p = this.ch.position, best = null, bd = 3.5;
      this.traffic.concat(this.police).forEach(function (r) { var d = r.car.position.distanceTo(p); if (d < bd) { bd = d; best = r; } });
      if (!best) return;
      if (best.driver) { // robar el coche: el conductor sale corriendo
        if (best.police) this.addWanted(2); else if (this.wanted === 0 && rnd.float() < 0.5) this.addWanted(1);
        best.driver = null;
      }
      var pi = this.police.indexOf(best); if (pi >= 0) { this.police.splice(pi, 1); this.traffic.push(best); best.police = false; }
      this.driving = best; this.ch.enabled = false; this.body.visible = false;
      if (this.ctrl) { v.removeControl(this.ctrl); this.ctrl = null; }
      this.follow = v.followCamera({ target: best.node, distance: 8, height: 3, lookAhead: 5 }); this.follow.snap();
      this.snd('click', 0.5);
    }
    fire() {
      if (this.fireCd > 0 || this.driving) return;
      this.fireCd = 0.3;
      var v = this.view, cam = v.camera, o = cam.getWorldPosition(new V3()), d = cam.getWorldDirection(new V3());
      var hit = v.physics.raycast(o, d, 120, { characters: true, vehicles: true, ignore: this.ch });
      var mz = (this.pistol.getObjectByName('muzzle') || this.pistol).getWorldPosition(new V3());
      v.effect('muzzle', mz, { count: 5, direction: [d.x, d.y, d.z] }); this.snd({ preset: 'pistol', seed: rnd.int(1, 4) }, 0.5, mz);
      this.tracer(mz, hit ? hit.point : o.clone().addScaled(d, 120), 0xffe8a3);
      this.body.play('Shoot', { fade: 0.05, loop: 'once', clamp: false, exclusive: false, weight: 0.9, restart: true });
      if (hit) {
        var cop = hit.character && hit.character.userData.officer;
        if (cop) { cop.damage(34); this.crosshair.hit(); return; }
        if (!hit.character && !hit.vehicle) { v.addDecal('bullet', hit.point, hit.normal); v.effect('sparks', hit.point, { count: 8 }); this.snd({ preset: 'impact', seed: rnd.int(1, 3) }, 0.3, hit.point); }
        else if (hit.vehicle) { v.effect('sparks', hit.point, { count: 8 }); this.snd({ preset: 'impact_metal', seed: rnd.int(1, 3) }, 0.35, hit.point); }
        var pd = hit.character && this.peds.find(function (x) { return x.ch === hit.character; });
        if (pd) { this.killPed(pd); this.addWanted(1); this.crosshair.hit(); }
        else if (hit.vehicle) { var pc = this.police.find(function (x) { return x.car === hit.vehicle; }); if (pc) this.addWanted(1); }
      }
      // los peatones cercanos huyen
      this.peds.forEach(function (x) { if (x.state === 'walk' && x.ch.position.distanceTo(o) < 25) { x.state = 'flee'; x.t = 6; x.node.play('Run', { fade: 0.2 }); } });
      if (this.wanted === 0) this.addWanted(1);
    }
    updateHud() {
      this.moneyText.text = '$ ' + this.money;
      var st = ''; for (var i = 0; i < 5; i++) st += i < this.wanted ? '★' : '☆'; this.starText.text = st;
    }
    _bot(dt) {
      // bot: va al coche más cercano, lo conduce hacia el objetivo de la misión por la cuadrícula y repite
      var b = this.bot, tgt = this.mission.stage === 'pickup' ? this.mission.at : this.mission.to, ext = { forward: 0, strafe: 0, run: false, jump: false };
      var nearTgt = tgt && Math.hypot(this.ch.position.x - tgt.x, this.ch.position.z - tgt.z) < 30;
      if (!this.driving && nearTgt) { var ddx = tgt.x - this.ch.position.x, ddz = tgt.z - this.ch.position.z; this.ctrl.yaw = Math.atan2(-ddx, -ddz); ext.forward = 1; ext.run = true; this.ctrl.setExternal(ext); return; }
      if (!this.driving) {
        var p = this.ch.position, best = null, bd = 1e9;
        this.traffic.forEach(function (r) { var d = r.car.position.distanceTo(p); if (d < bd) { bd = d; best = r; } });
        if (best) {
          var dx = best.car.position.x - p.x, dz = best.car.position.z - p.z;
          this.ctrl.yaw = Math.atan2(-dx, -dz); ext.forward = 1; ext.run = true;
          if (bd < 3.2) this.toggleCar();
        }
        if (this.ctrl) this.ctrl.setExternal(ext);
      } else {
        var rec = this.driving;
        if (!rec.botDriver) { var c = rec.car, ci = Math.round(c.position.x / B), cj = Math.round(c.position.z / B), dir = 0, bestDot = -2; for (var d = 0; d < 4; d++) { var dot = Math.sin(c.heading) * DIRS[d][0] + Math.cos(c.heading) * DIRS[d][1]; if (dot > bestDot) { bestDot = dot; dir = d; } } rec.botDriver = new Driver(this, c, Math.max(0, Math.min(N, ci - DIRS[dir][0])), Math.max(0, Math.min(N, cj - DIRS[dir][1])), dir); rec.botDriver.cruise = 15; }
        rec.botDriver.dest = tgt;
        var obst = this.traffic.map(function (r) { return r.car; }).concat(this.peds.filter(function (x) { return x.state !== 'dead'; }).map(function (x) { return x.ch; }));
        rec.botDriver.update(dt, obst);
        // al llegar, se baja a pie hasta el marcador si está en la acera
        if (tgt && rec.car.position.distanceTo(tgt) < 14) { rec.car.setInput(0, 0, true); if (Math.abs(rec.car.speed) < 1) this.toggleCar(); }
      }
      void b;
    }
    update(t, dtMs) {
      var dt = Math.min(dtMs, 50) / 1000, s = this, v = this.view, kb = this.input.keyboard, tb = this.touch.buttons;
      this.fireCd -= dt;
      if (tb.enter && tb.enter.justDown) this.toggleCar();
      if (this.bot) this._bot(dt);
      // jugador
      if (this.driving) {
        var c = this.driving.car;
        if (!this.bot) {
          var thr = (kb.isDown('KeyW') || kb.isDown('UP') ? 1 : 0) - (kb.isDown('KeyS') || kb.isDown('DOWN') ? 1 : 0), st = (kb.isDown('KeyA') || kb.isDown('LEFT') ? 1 : 0) - (kb.isDown('KeyD') || kb.isDown('RIGHT') ? 1 : 0);
          var js = this.touch.joy; if (js && js.isActive) { thr -= js.forceY; st -= js.forceX; }
          var pad = this.input.gamepad.pad1; if (pad && pad.connected) { thr += pad.value(7) - pad.value(6); st -= Math.abs(pad.axes[0]) > 0.15 ? pad.axes[0] : 0; }
          c.setInput(Math.max(-1, Math.min(1, thr)), Math.max(-1, Math.min(1, st)), false, kb.isDown('SPACE'));
        }
        this.speedText.text = Math.round(c.kmh) + ' km/h';
        this.hint.text = '';
      } else {
        if ((this.mouse.left || (tb.fire && tb.fire.isDown)) && !this.bot) this.fire();
        if (tb.jump && tb.jump.justDown) this.ch.jump();
        var anim = !this.ch.onGround ? 'Jump' : (this.ctrl.moving ? (this.ctrl.running ? 'Run' : 'Walk') : 'Idle');
        if (anim !== this._anim) { this._anim = anim; this.body.play(anim, { fade: 0.15 }); }
        this.speedText.text = '';
        var near = this.traffic.concat(this.police).some(function (r) { return r.car.position.distanceTo(s.ch.position) < 3.5; });
        this.hint.text = near ? 'E: subir al coche' : '';
      }
      // tráfico y policía
      var obst = this.traffic.map(function (r) { return r.car; }).concat(this.police.map(function (r) { return r.car; })).concat(this.peds.filter(function (x) { return x.state !== 'dead'; }).map(function (x) { return x.ch; }));
      if (!this.driving) obst.push(this.ch);
      this.traffic.forEach(function (r) { if (r.driver && r !== s.driving) r.driver.update(dt, obst); else if (r !== s.driving && !r.driver) r.car.setInput(0, 0, true); });
      this.updatePolice(dt, obst);
      // peatones
      this.peds.forEach(function (x) {
        if (x.state === 'dead') { if ((x.t += dt) > 8) { x.dead = true; x.ch.destroy(); x.node.destroy(); } return; }
        var target = x.corners[x.k], dx = target[0] - x.ch.position.x, dz = target[1] - x.ch.position.z, d = Math.hypot(dx, dz);
        if (d < 0.8) { x.k = (x.k + 1) % 4; return; }
        var sp = x.state === 'flee' ? 4.5 : x.speed;
        if (x.state === 'flee' && (x.t -= dt) <= 0) { x.state = 'walk'; x.node.play('Walk', { fade: 0.3 }); }
        x.ch.move(dx / d * sp, dz / d * sp);
        x.facing += G3.angleDiff(x.facing, Math.atan2(dx, dz)) * Math.min(1, 6 * dt); x.node.rotation.y = x.facing;
      });
      this.peds = this.peds.filter(function (x) { return !x.dead; });
      while (this.peds.length < 12) this.spawnPed();
      // misiones
      var m = this.mission, pp = this.playerPos();
      if (m.stage === 'pickup') {
        this.missionText.text = '📦 Recoge el paquete (marcador amarillo)';
        if (Math.hypot(pp.x - m.at.x, pp.z - m.at.z) < 3.5) {
          m.stage = 'deliver'; var pick = function () { var i = rnd.int(0, N - 1), j = rnd.int(0, N - 1), c2 = inter(i, j); return new V3(c2.x + B / 2, 0, c2.z + HALFR + 1.5); };
          do { m.to = pick(); } while (m.to.distanceTo(m.at) < 80);
          var dist = Math.abs(m.to.x - m.at.x) + Math.abs(m.to.z - m.at.z); m.timeLeft = 20 + dist / 7; m.reward = Math.round(dist * 2);
          this.marker.position.set(m.to.x, 15, m.to.z); this.marker.material.color = 0x51cf66; this.marker.material.version++;
          this.snd('coin', 0.6); MG.floatText(this, this.game.width / 2, this.game.height * 0.3, '¡Paquete recogido!', 0xffd43b, 30);
        }
      } else {
        m.timeLeft -= dt;
        this.missionText.text = '🚚 Entrega el paquete (verde) · ' + Math.max(0, m.timeLeft).toFixed(0) + ' s · $' + m.reward;
        if (Math.hypot(pp.x - m.to.x, pp.z - m.to.z) < 4) { this.money += m.reward; this.updateHud(); this.snd('powerup', 0.7); MG.floatText(this, this.game.width / 2, this.game.height * 0.3, '+$' + m.reward, 0x69db7c, 40); this.newMission(); }
        else if (m.timeLeft <= 0) { this.snd('hurt', 0.5); MG.floatText(this, this.game.width / 2, this.game.height * 0.3, 'Entrega fallida', 0xff6b6b, 34); this.newMission(); }
      }
      this.marker.rotation.y += dt;
      // día / noche
      this.dayNight(dt);
      // nivel de búsqueda: baja si no hay policía cerca durante un rato
      if (this.wanted > 0) {
        var close = this.police.some(function (r) { return r.car.position.distanceTo(pp) < 70; });
        this.wantedT = close ? 0 : this.wantedT + dt;
        if (this.wantedT > 18) { this.wanted--; this.wantedT = 0; this.updateHud(); }
      }
      this.crosshair.visible = !this.driving;
      this.crosshair.update(dt);
      // radar
      var items = [{ x: this.marker.position.x, z: this.marker.position.z, color: m.stage === 'pickup' ? 0xffd43b : 0x51cf66, r: 5, edge: true }];
      this.police.forEach(function (r) { items.push({ x: r.car.position.x, z: r.car.position.z, color: 0x4dabf7, r: 4 }); });
      this.traffic.forEach(function (r) { items.push({ x: r.car.position.x, z: r.car.position.z, color: 0xadb5bd, r: 2 }); });
      this.officers.forEach(function (o) { if (!o.dead) items.push({ x: o.ch.position.x, z: o.ch.position.z, color: 0x4dabf7, r: 3, ring: true }); });
      var heading = this.driving ? Math.PI + this.driving.car.heading : (this.ctrl ? this.ctrl.yaw : 0);
      this.map.update(pp, heading, items);
      this.hpBar.set(this.hp / 100, 'Vida ' + this.hp);
      this.vign.set(this.hp < 45 ? (45 - this.hp) / 45 * 0.8 : 0);
      this.dmgInd.update(dt); this.feed.update(dt);
      if (this.hp < 100 && this.respawnT <= 0 && this.wanted === 0) this.hp = Math.min(100, this.hp + dt * 2); // se recupera sin policía
      var free = this._trFree; if (this._tracers) this._tracers = this._tracers.filter(function (tr) { if ((tr.life -= dt) <= 0) { tr.m.visible = false; free.push(tr.m); return false; } return true; });
    }
    updatePolice(dt, obst) {
      var s = this, pp = this.playerPos(), want = Math.min(4, this.wanted);
      while (this.police.length < want) {
        // aparecen lejos, en una intersección
        var i = rnd.int(0, N), j = rnd.int(0, N); if (inter(i, j).distanceTo(pp) < 70) continue;
        var rec = this.spawnTraffic('police', i, j); this.traffic.splice(this.traffic.indexOf(rec), 1); rec.police = true; rec.car.maxSpeed = 30; rec.driver.cruise = 22; this.police.push(rec);
      }
      // sobran patrullas: se retiran las que no tienen agentes fuera (las otras esperan a que vuelvan)
      while (this.police.length > want) { var idx = -1; for (var q = this.police.length - 1; q >= 0; q--) if (!this.police[q].deployed) { idx = q; break; } if (idx < 0) break; var r = this.police.splice(idx, 1)[0]; r.car.destroy(); r.node.destroy(); }
      this.police.forEach(function (r) {
        if (!r.driver) return;
        r.deployCd = Math.max(0, (r.deployCd || 0) - dt);
        var c = r.car, d = c.position.distanceTo(pp);
        if (r.deployed) { c.setInput(0, 0, true); return; } // aparcado mientras los agentes van a pie
        r.driver.dest = pp;
        // con el jugador a pie y cerca: frena y bajan dos agentes
        if (!s.driving && d < 22 && r.deployCd <= 0 && s.officers.length < 6) {
          c.setInput(0, 0, true);
          if (Math.abs(c.speed) < 2) { r.deployed = true; r.officers = 2; s.officers.push(new Officer(s, r, 1), new Officer(s, r, -1)); s.snd('door', 0.5, c.position); if (!s._copMsg) { s._copMsg = true; s.feed.add('¡La policía baja del coche!', 0x74c0fc); } }
          return;
        }
        if (d < 35 && s.driving) {
          // persecución directa en coche
          var wantH = Math.atan2(pp.x - c.position.x, pp.z - c.position.z), diff = G3.angleDiff(c.heading, wantH);
          c.setInput(1, Math.max(-1, Math.min(1, diff * 2.5)), false, false);
        } else r.driver.update(dt, obst);
      });
      // agentes a pie
      this.arrestT = Math.max(0, this.arrestT - dt);
      this.officers.forEach(function (o) { o.update(dt); });
      this.officers = this.officers.filter(function (o) { return !o.removed; });
      if (this.arrestT > 2.5) { this.arrestT = 0; this.busted(); }
    }
    busted() { this.snd('hurt', 0.8); this.respawn('detenido'); }
    dayNight(dt) {
      this.clock = (this.clock + dt / 60 * 1.5) % 24; // 1 hora de juego = 40 s
      var h = this.clock, day = Math.max(0, Math.sin((h - 6) / 12 * Math.PI)), sc = this.view.scene3d;
      var ang = (h - 6) / 12 * Math.PI; this.sun.sun.setDirection(-Math.cos(ang), -Math.max(0.15, Math.sin(ang)), -0.35);
      this.sun.sun.intensity = 0.1 + day * 1.9; this.sun.hemi.intensity = 0.18 + day * 0.55;
      var lerp = function (a, b, k) { return UG.Color.lerp(a, b, k); };
      sc.sky.top = lerp(0x0b1026, 0x3872c4, day); sc.sky.horizon = lerp(0x2a2f45, h > 17 || h < 7 ? 0xff9e6b : 0xd6e4f0, Math.min(1, day * 1.6)); sc.sky.sunIntensity = day;
      sc.fog.color = sc.sky.horizon; sc.sky.stars = 1 - Math.min(1, day * 3); sc.sky.moon = sc.sky.stars;
      var night = 1 - Math.min(1, day * 2.5);
      if (Math.abs((this._night || 0) - night) > 0.02) { this._night = night; this.city.winMats.forEach(function (m) { m.emissive = 0xffe8a3; m.emissiveIntensity = night * 1.4; }); }
      this.clockText.text = (h < 10 ? '0' : '') + Math.floor(h) + ':' + ('0' + Math.floor((h % 1) * 60)).slice(-2);
      // luces de farola: las 6 más cercanas al jugador
      var pp = this.playerPos(), lamps = this.city.lamps.slice().sort(function (a, b) { return a.distanceToSq(pp) - b.distanceToSq(pp); });
      for (var i = 0; i < this.lampLights.length; i++) { var L = this.lampLights[i]; if (lamps[i]) L.position.copy(lamps[i]); L.intensity = night * 5; }
      // faro del coche que conduce el jugador
      if (this.driving && night > 0.1) { var c = this.driving.car; this.headlight.position.set(c.position.x + Math.sin(c.heading) * 2.2, 1, c.position.z + Math.cos(c.heading) * 2.2); this.headlight.lookAt(c.position.x + Math.sin(c.heading) * 12, 0, c.position.z + Math.cos(c.heading) * 12); this.headlight.intensity = night * 12; }
      else this.headlight.intensity = 0;
    }
  }

  var Boot = { key: 'Boot', preload: function () { G3.loadModels(this, MODELS); }, create: function () { this.scene.start(G3.auto ? 'Play' : 'Menu'); } };
  G3.start({ title: 'Ciudad Libre', scenes: [
    Boot,
    MG.menu({ id: 'city3d', title: 'Ciudad Libre', subtitle: 'Mundo abierto 3D · conduce, reparte y escapa de la policía', titleColors: [0xffffff, 0x69db7c], glow: '#40c057', buttonColor: 0x2b8a3e,
      help: 'WASD moverse o conducir · E subir/bajar de un coche · arrastra el ratón para mirar · clic disparar · Espacio saltar / freno de mano. Recoge paquetes (amarillo) y entrégalos (verde) a tiempo.',
      touchHelp: 'Joystick para moverte o conducir, arrastra a la derecha para mirar. E sube y baja del coche. Recoge paquetes y entrégalos a tiempo.',
      background: G3.menuBackground(function (v, scene) { buildCity(v, scene, false); v.add.sunlight({ shadowSize: 120 }); }, 60, 30) }),
    Play, MG.gameOver({ id: 'city3d', background: function (s) { s.add.rectangle(s.game.width / 2, s.game.height / 2, s.game.width, s.game.height, 0x0e1a12, 1); } })
  ] });
})();
