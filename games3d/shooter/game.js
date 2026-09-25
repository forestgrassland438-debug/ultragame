/* Operación Tormenta — shooter 3D en primera y tercera persona (V cambia la vista).
 * Pueblo con casas en las que se entra por la puerta o saltando por las ventanas (agachado), cristales que se rompen,
 * comida/bebida/botiquines y armas sobre mesas y estantes (E para cogerlos), 5 armas (1-5, rueda, Q), apuntar con el botón
 * derecho (mira telescópica en el francotirador), sangre y agujeros de bala persistentes, barriles explosivos, hierba y
 * árboles con viento, nubes, minimapa real (M: mapa grande) y enemigos con IA: rutas A* por una rejilla de navegación,
 * coberturas, asomarse y disparar en ráfagas, flanqueo, oído (disparos y explosiones), avisos entre ellos, granadas y
 * láser de aviso del francotirador. 5 oleadas con descanso para saquear las casas. */
(function () {
  'use strict';
  var V3 = UG.Vec3, rnd = new UG.RNG('tormenta');
  var MODELS = ['humanoid', 'robot', 'house', 'shop', 'tree', 'pine', 'bush', 'rock', 'crate', 'barrel', 'fence', 'lamp', 'car', 'police', 'taxi',
    'pistol', 'rifle', 'smg', 'shotgun', 'sniper', 'apple', 'bread', 'water', 'soda', 'medkit', 'ammo', 'grenade'];
  var AREA = 68;
  /* ------------------------------------------------------------------ datos */
  var WEAPONS = {
    pistol: { name: 'Pistola', model: 'pistol', slot: 1, dmg: 28, rate: 0.2, auto: false, mag: 12, reserve: 72, reload: 1.1, spread: 0.014, ads: 60, sfx: 'pistol', recoil: 0.02, range: 120, head: 2.2, fp: [0.2, -0.19, -0.4] },
    rifle: { name: 'Fusil', model: 'rifle', slot: 2, dmg: 31, rate: 0.1, auto: true, mag: 30, reserve: 180, reload: 1.6, spread: 0.012, ads: 52, sfx: 'rifle', recoil: 0.013, range: 220, head: 2.2, fp: [0.22, -0.22, -0.45] },
    smg: { name: 'Subfusil', model: 'smg', slot: 3, dmg: 20, rate: 0.066, auto: true, mag: 35, reserve: 210, reload: 1.35, spread: 0.024, ads: 60, sfx: 'smg', recoil: 0.009, range: 110, head: 2, fp: [0.2, -0.2, -0.4] },
    shotgun: { name: 'Escopeta', model: 'shotgun', slot: 4, dmg: 17, pellets: 9, rate: 0.85, auto: false, mag: 6, reserve: 36, reload: 2.1, spread: 0.075, ads: 62, sfx: 'shotgun', recoil: 0.06, range: 45, head: 1.6, pump: true, fp: [0.22, -0.23, -0.5] },
    sniper: { name: 'Francotirador', model: 'sniper', slot: 5, dmg: 105, rate: 1.1, auto: false, mag: 5, reserve: 25, reload: 2.4, spread: 0.002, hipSpread: 0.06, ads: 17, scope: true, sfx: 'sniper', recoil: 0.07, range: 400, head: 3, fp: [0.22, -0.22, -0.55] }
  };
  var ORDER = ['pistol', 'rifle', 'smg', 'shotgun', 'sniper'];
  var ITEMS = {
    apple: { label: 'Comer manzana (+12)', heal: 12, sfx: 'eat', model: 'apple', scale: 1.6, color: 0x69db7c },
    bread: { label: 'Comer pan (+25)', heal: 25, sfx: 'eat', model: 'bread', scale: 1.5, color: 0x69db7c },
    water: { label: 'Beber agua (+10, aguante)', heal: 10, stamina: true, sfx: 'drink', model: 'water', scale: 1.4, color: 0x74c0fc },
    soda: { label: 'Beber refresco (+8, velocidad)', heal: 8, boost: 12, sfx: 'drink', model: 'soda', scale: 1.7, color: 0x74c0fc },
    medkit: { label: 'Usar botiquín (+55)', heal: 55, sfx: 'pickup_weapon', model: 'medkit', scale: 1.3, color: 0xff6b6b },
    ammo: { label: 'Coger munición', ammo: true, sfx: 'pickup_weapon', model: 'ammo', scale: 1.3, color: 0xfab005 },
    grenade: { label: 'Coger granada', grenade: 1, sfx: 'pickup_weapon', model: 'grenade', scale: 2, color: 0x40c057 },
    w_smg: { label: 'Coger subfusil', weapon: 'smg', model: 'smg', scale: 1.1, color: 0xe599f7 },
    w_shotgun: { label: 'Coger escopeta', weapon: 'shotgun', model: 'shotgun', scale: 1.1, color: 0xe599f7 },
    w_sniper: { label: 'Coger rifle de francotirador', weapon: 'sniper', model: 'sniper', scale: 1, color: 0xe599f7 },
    w_rifle: { label: 'Coger fusil', weapon: 'rifle', model: 'rifle', scale: 1.1, color: 0xe599f7 },
    w_pistol: { label: 'Coger pistola', weapon: 'pistol', model: 'pistol', scale: 1.4, color: 0xe599f7 }
  };
  var ENEMY_TYPES = {
    soldier: { name: 'Soldado', model: 'humanoid', tint: 0x86956c, hp: 100, weapon: 'rifle', speed: 3.2, acc: 0.6, burst: [3, 5], dmg: [6, 10], range: 44, keep: [9, 22], score: 100, blood: true, react: 0.55 },
    shotgunner: { name: 'Escopetero', model: 'humanoid', tint: 0x9a7358, hp: 120, weapon: 'shotgun', speed: 3.9, acc: 0.7, burst: [1, 1], dmg: [16, 26], range: 15, keep: [2, 7], score: 150, blood: true, rush: true, react: 0.45 },
    sniper: { name: 'Francotirador', model: 'humanoid', tint: 0x5f7389, hp: 70, weapon: 'sniper', speed: 2.8, acc: 0.85, burst: [1, 1], dmg: [30, 42], range: 95, keep: [26, 60], score: 200, blood: true, laser: true, react: 0.7 },
    heavy: { name: 'Robot pesado', model: 'robot', tint: 0xffffff, hp: 340, weapon: 'smg', speed: 2.3, acc: 0.48, burst: [8, 14], dmg: [4, 7], range: 36, keep: [7, 20], score: 400, blood: false, scale: 1.15, react: 0.6 }
  };
  var WAVE_DEF = [
    ['soldier', 'soldier', 'soldier', 'soldier'],
    ['soldier', 'shotgunner', 'soldier', 'shotgunner', 'soldier'],
    ['soldier', 'sniper', 'shotgunner', 'soldier', 'soldier', 'sniper'],
    ['heavy', 'soldier', 'soldier', 'shotgunner', 'sniper', 'soldier', 'shotgunner'],
    ['heavy', 'heavy', 'soldier', 'soldier', 'sniper', 'shotgunner', 'soldier', 'shotgunner', 'sniper']
  ];
  var WAVES = WAVE_DEF.length;
  var HOUSES = [[-16, -18, 0], [-16, 16, Math.PI], [16, -18, 0], [16, 16, Math.PI], [-38, -18, 0], [38, 16, Math.PI], [-38, 16, Math.PI], [38, -18, 0], [-16, 42, Math.PI], [16, -44, 0]];
  var POND = { x: -40, z: 42, w: 16, d: 11 };
  var CARS = [[-6.8, -26, 0, 'car'], [6.8, 24, Math.PI, 'taxi'], [-26, 6.8, Math.PI / 2, 'police'], [30, -6.8, -Math.PI / 2, 'car']];
  var SANDBAGS = [[0, -9.5, 0], [0, 9.5, 0], [-9.5, 0, Math.PI / 2], [9.5, 0, Math.PI / 2], [-30, -30, 0.6], [30, 30, 0.6]];

  function houseAt(i) { var h = HOUSES[i]; return { x: h[0], z: h[1], r: h[2], shop: i % 3 === 1, w: i % 3 === 1 ? 8 : 6, d: 6 }; }
  function inHouse(x, z, pad) { for (var i = 0; i < HOUSES.length; i++) { var h = houseAt(i); if (Math.abs(x - h.x) < h.w / 2 + pad && Math.abs(z - h.z) < h.d / 2 + pad) return true; } return false; }
  function onRoad(x, z) { return Math.abs(x) < 6.5 || Math.abs(z) < 6.5; }
  function inPond(x, z, pad) { return Math.abs(x - POND.x) < POND.w / 2 + pad && Math.abs(z - POND.z) < POND.d / 2 + pad; }

  /* ------------------------------------------------------------ el pueblo */
  function buildVillage(v, scene, withPhysics) {
    var ph = withPhysics ? v.physics : null, sc = v.scene3d, r2 = new UG.RNG('pueblo'), out = { houses: [], glass: [], barrels: [], items: [] };
    sc.setSky({ top: 0x3b6fb6, horizon: 0xd9e6f2, bottom: 0x5a5144, sunSize: 0.035, clouds: { coverage: 0.5, speed: 0.012, scale: 0.5 } });
    sc.setFog('linear', 0xd9e6f2, 60, 200); sc.exposure = 1.05;
    v.add.plane(320, 320, { color: 0x6f8f4a, roughness: 1 }, 1, 1);
    // calles y aceras
    v.add.plane(12, 150, { color: 0x5f5a55, roughness: 1 }).setPosition(0, 0.01, 0);
    v.add.plane(150, 12, { color: 0x5f5a55, roughness: 1 }).setPosition(0, 0.012, 0);
    [[-6.6, 0, 1.2, 150], [6.6, 0, 1.2, 150], [0, -6.6, 150, 1.2], [0, 6.6, 150, 1.2]].forEach(function (s2) { v.add.plane(s2[2], s2[3], { color: 0xa39c91, roughness: 1 }).setPosition(s2[0], 0.02, s2[1]); });
    for (var ln = -70; ln < 70; ln += 6) { v.add.plane(0.25, 2.6, { color: 0xe9e3c8, roughness: 1 }).setPosition(0, 0.021, ln); v.add.plane(2.6, 0.25, { color: 0xe9e3c8, roughness: 1 }).setPosition(ln, 0.022, 0); }
    // casas (colisión por triángulos; los cristales llevan noCollide desde el GLB)
    HOUSES.forEach(function (h, i) {
      var H = houseAt(i), m = v.add.model(H.shop ? 'shop' : 'house'); m.position.set(h[0], 0, h[1]); m.rotation.y = h[2]; m.updateMatrixWorld(true);
      if (ph) ph.addMesh(m);
      var rec = { node: m, x: h[0], z: h[1], r: h[2], shop: H.shop, glass: [], items: [] };
      m.traverse(function (n) {
        if (/^glass_/.test(n.name)) { var b = new UG.Box3(), gb = n.geometry.getBoundingBox(); for (var c = 0; c < 8; c++) b.expandByPoint(new V3(c & 1 ? gb.max.x : gb.min.x, c & 2 ? gb.max.y : gb.min.y, c & 4 ? gb.max.z : gb.min.z).applyMat4(n.matrixWorld)); var g = { mesh: n, box: b, broken: false, house: i }; rec.glass.push(g); out.glass.push(g); }
        if (/^item_/.test(n.name)) rec.items.push(n.getWorldPosition(new V3()));
      });
      out.houses.push(rec);
    });
    // coches aparcados, sacos terreros, cajas y barriles (cobertura)
    CARS.forEach(function (c) { var m = v.add.model(c[3]); m.position.set(c[0], 0, c[1]); m.rotation.y = c[2]; if (ph) ph.addBoxFromNode(m); });
    SANDBAGS.forEach(function (s2) { var sb = v.add.box(4.2, 1.05, 0.7, { color: 0xb5a37a, roughness: 1 }); sb.position.set(s2[0], 0.525, s2[1]); sb.rotation.y = s2[2]; if (ph) ph.addBox(sb.position.clone(), new V3(2.1, 0.525, 0.35), new UG.Quat().setFromEuler(0, s2[2], 0)); });
    for (var i = 0; i < 30; i++) {
      var kind = ['crate', 'barrel', 'crate', 'rock', 'barrel'][i % 5], x = r2.float(-60, 60), z = r2.float(-60, 60);
      if (onRoad(x, z) || inHouse(x, z, 2.5) || inPond(x, z, 2)) continue;
      var p = v.add.model(kind); p.position.set(x, 0, z); p.rotation.y = r2.float(0, 6.28);
      if (ph) ph.addBoxFromNode(p);
      if (kind === 'barrel' && i % 2 === 0) out.barrels.push({ node: p, hp: 40, pos: p.position.clone(), dead: false });
    }
    // estanque con rocas alrededor
    v.add.water(POND.w, POND.d, { waveHeight: 0.05 }).setPosition(POND.x, 0.05, POND.z);
    v.add.plane(POND.w + 1.6, POND.d + 1.6, { color: 0x6b5a45, roughness: 1 }).setPosition(POND.x, 0.03, POND.z);
    if (ph) ph.addBox(new V3(POND.x, -0.4, POND.z), new V3(POND.w / 2, 0.45, POND.d / 2));
    // vegetación: hierba con viento, árboles dentro y fuera del pueblo, arbustos y flores
    v.add.grass({ area: [-AREA, -AREA, AREA, AREA], density: withPhysics ? 1.5 : 0.9, seed: 'hierba', where: function (x2, z2) { return !onRoad(x2, z2) && !inHouse(x2, z2, 0.6) && !inPond(x2, z2, 0.9) && Math.abs(x2) < AREA - 1 && Math.abs(z2) < AREA - 1; } });
    var trees = [], pines = [], bushes = [];
    for (var t = 0; t < 110; t++) {
      var a = r2.float(0, Math.PI * 2), rr = t < 40 ? r2.float(14, 64) : r2.float(72, 125), tx = Math.cos(a) * rr, tz = Math.sin(a) * rr;
      if (onRoad(tx, tz) || inHouse(tx, tz, 3) || inPond(tx, tz, 2)) continue;
      (t % 2 ? pines : trees).push({ x: tx, z: tz, ry: r2.float(0, 6.28), s: r2.float(0.9, 1.6) });
    }
    for (var b2 = 0; b2 < 60; b2++) { var bx = r2.float(-62, 62), bz = r2.float(-62, 62); if (onRoad(bx, bz) || inHouse(bx, bz, 1.5) || inPond(bx, bz, 1)) continue; bushes.push({ x: bx, z: bz, ry: r2.float(0, 6.28), s: r2.float(0.8, 1.4) }); }
    v.add.instances('tree', trees, { wind: 0.012 }); v.add.instances('pine', pines, { wind: 0.008 }); v.add.instances('bush', bushes, { wind: 0.02 });
    if (ph) trees.concat(pines).forEach(function (tr) { if (Math.hypot(tr.x, tr.z) < 70) ph.addBox(new V3(tr.x, 1.2, tr.z), new V3(0.25 * tr.s, 1.2, 0.25 * tr.s)); });
    var flower = UG.Geometry3D.sphere(0.07, 6, 4);
    [0xff6b6b, 0xffd43b, 0xf8f9fa, 0xcc5de8].forEach(function (col, k) {
      v.add.scatter({ geometry: flower, material: { color: col, roughness: 0.6, emissive: col, emissiveIntensity: 0.08 } }, { area: [-60, -60, 60, 60], count: 90, scale: [0.8, 1.5], y: 0.42, seed: 'flor' + k, castShadow: false, where: function (fx, fz) { return !onRoad(fx, fz) && !inHouse(fx, fz, 1) && !inPond(fx, fz, 1); } });
    });
    for (var f = -3; f <= 3; f++) { var fe = v.add.model('fence'); fe.position.set(f * 2, 0, 8.5 + 3); if (ph) ph.addBoxFromNode(fe); }
    [[-7.4, -7.4], [7.4, 7.4], [-7.4, 30], [7.4, -32]].forEach(function (l) { var lp = v.add.model('lamp'); lp.position.set(l[0], 0, l[1]); lp.rotation.y = l[0] < 0 ? Math.PI / 2 : -Math.PI / 2; if (ph) ph.addBox(new V3(l[0], 2, l[1]), new V3(0.15, 2, 0.15)); });
    if (ph) {
      ph.addGround(0);
      [[0, -AREA - 2, AREA + 2, 0.5], [0, AREA + 2, AREA + 2, 0.5], [-AREA - 2, 0, 0.5, AREA + 2], [AREA + 2, 0, 0.5, AREA + 2]].forEach(function (w2) { ph.addBox(new V3(w2[0], 3, w2[1]), new V3(w2[2], 3, w2[3])); });
    }
    out.trees = trees.concat(pines);
    return out;
  }
  /** Dibujo del mapa (una vez, en Canvas 2D) */
  function drawMap(ctx, X, Z, ppm) {
    ctx.fillStyle = '#5f7f45'; ctx.fillRect(0, 0, X(AREA) + 10, Z(AREA) + 10);
    ctx.fillStyle = '#4c4a47'; ctx.fillRect(X(-6), Z(-AREA), 12 * ppm, AREA * 2 * ppm); ctx.fillRect(X(-AREA), Z(-6), AREA * 2 * ppm, 12 * ppm);
    ctx.fillStyle = '#e9e3c8'; for (var i = -AREA; i < AREA; i += 6) { ctx.fillRect(X(-0.2), Z(i), 0.4 * ppm, 2.5 * ppm); ctx.fillRect(X(i), Z(-0.2), 2.5 * ppm, 0.4 * ppm); }
    ctx.fillStyle = '#2b6cb0'; ctx.fillRect(X(POND.x - POND.w / 2), Z(POND.z - POND.d / 2), POND.w * ppm, POND.d * ppm);
    HOUSES.forEach(function (h, k) { var H = houseAt(k); ctx.fillStyle = H.shop ? '#2e4a55' : '#9e2a1c'; ctx.fillRect(X(h[0] - H.w / 2), Z(h[1] - H.d / 2), H.w * ppm, H.d * ppm); ctx.strokeStyle = '#f1ece0'; ctx.lineWidth = 2; ctx.strokeRect(X(h[0] - H.w / 2), Z(h[1] - H.d / 2), H.w * ppm, H.d * ppm);
      ctx.fillStyle = '#f1ece0'; var dz = h[2] === 0 ? H.d / 2 : -H.d / 2; ctx.fillRect(X(h[0] - 0.6), Z(h[1] + dz - 0.3), 1.2 * ppm, 0.6 * ppm); });
    CARS.forEach(function (c) { ctx.fillStyle = '#d0d4da'; var hor = Math.abs(Math.sin(c[2])) > 0.5; ctx.fillRect(X(c[0] - (hor ? 2 : 0.9)), Z(c[1] - (hor ? 0.9 : 2)), (hor ? 4 : 1.8) * ppm, (hor ? 1.8 : 4) * ppm); });
    SANDBAGS.forEach(function (s2) { ctx.save(); ctx.translate(X(s2[0]), Z(s2[1])); ctx.rotate(-s2[2]); ctx.fillStyle = '#c9b58a'; ctx.fillRect(-2.1 * ppm, -0.35 * ppm, 4.2 * ppm, 0.7 * ppm); ctx.restore(); });
    var r2 = new UG.RNG('mapa'); ctx.fillStyle = 'rgba(28,70,32,0.9)'; for (var t = 0; t < 70; t++) { var x = r2.float(-66, 66), z = r2.float(-66, 66); if (onRoad(x, z) || inHouse(x, z, 2) || inPond(x, z, 1)) continue; ctx.beginPath(); ctx.arc(X(x), Z(z), 1.3 * ppm, 0, Math.PI * 2); ctx.fill(); }
  }

  /* ================================================================ Jugador */
  class Player {
    constructor(scene) {
      var v = scene.view, ph = v.physics;
      this.scene = scene; this.hp = 100; this.stamina = 100; this.alive = true; this.kills = 0; this.score = 0; this.grenades = 3; this.boost = 0; this.headshots = 0;
      this.owned = { pistol: true, rifle: true }; this.ammo = {};
      var self = this; ORDER.forEach(function (k) { self.ammo[k] = { mag: WEAPONS[k].mag, reserve: k === 'pistol' ? 48 : (k === 'rifle' ? 120 : 0) }; });
      this.weapon = 'rifle'; this.prevWeapon = 'pistol'; this.switchT = 0; this.reloading = 0; this.cooldown = 0; this.bloom = 0; this.kick = 0; this.bob = 0; this.aim = 0; this.stepT = 0;
      this.body = v.add.model('humanoid'); this.body.position.set(0, 0, 4);
      this.ch = ph.addCharacter(this.body, { radius: 0.35, height: 1.8, jumpSpeed: 7.5, crouchHeight: 0.95 });
      this.ch.userData.player = this;
      this.hand = this.body.getObjectByName('hand.R');
      v.scene3d.add(v.camera);
      this.fpGuns = {}; this.tpGun = null;
      this.mode = 'fps';
      this._setMode('fps');
      this._equip(this.weapon, true);
      this.body.play('Idle');
      this.ch.on('vault', function () { scene.snd('footstep', null, 0.6); });
      this.ch.on('land', function (d) { if (d > 1.2) scene.snd('footstep', null, 0.7); });
    }
    get W() { return WEAPONS[this.weapon]; }
    get A() { return this.ammo[this.weapon]; }
    _setMode(mode) {
      var v = this.scene.view, yaw = this.ctrl ? this.ctrl.yaw : Math.PI, pitch = this.ctrl ? this.ctrl.pitch : 0;
      if (this.ctrl) v.removeControl(this.ctrl);
      this.mode = mode;
      var joy = this.scene.touch.joy;
      if (mode === 'fps') { this.ctrl = v.firstPersonControls({ character: this.ch, eyeHeight: 1.62, speed: 5.2, runSpeed: 8.8, joystick: joy, pointerLock: !G3.auto, bob: 0.03 }); this.ctrl.pitch = pitch; }
      else { this.ctrl = v.thirdPersonControls({ target: this.body, character: this.ch, distance: 4.2, height: 1.55, shoulder: 0.55, speed: 4.8, runSpeed: 8.4, joystick: joy, pointerLock: !G3.auto }); this.ctrl.pitch = 0.2; this.ctrl.facing = yaw; }
      this.ctrl.yaw = yaw; this.baseSens = this.ctrl.sensitivity;
      this.body.visible = mode !== 'fps';
      for (var k in this.fpGuns) this.fpGuns[k].visible = mode === 'fps' && k === this.weapon;
      this._fov();
    }
    toggleView() { this._setMode(this.mode === 'fps' ? 'tps' : 'fps'); }
    _fov() { var c = this.scene.view.camera, base = this.mode === 'fps' ? 75 : 62, want = base + (this.W.ads - base) * this.aim; if (Math.abs(c.fov - want) > 0.05) { c.fov = want; c.updateProjection(); } }
    _equip(key, instant) {
      var v = this.scene.view;
      if (!this.fpGuns[key]) {
        var g = v.add.model(WEAPONS[key].model, { castShadow: false }); v.camera.add(g); g.rotation.y = Math.PI; g.traverse(function (n) { n.castShadow = false; });
        this.fpGuns[key] = g;
      }
      for (var k in this.fpGuns) this.fpGuns[k].visible = this.mode === 'fps' && k === key;
      if (this.tpGun) this.tpGun.destroy();
      this.tpGun = v.add.model(WEAPONS[key].model); if (this.hand) { this.hand.add(this.tpGun); this.tpGun.position.set(0, -0.06, 0.04); this.tpGun.rotation.x = Math.PI / 2; }
      if (key !== this.weapon) this.prevWeapon = this.weapon;
      this.weapon = key; this.reloading = 0; this.switchT = instant ? 0 : 0.35; this.bloom = 0;
      this.scene.hudDirty = true;
    }
    select(key) { if (!this.owned[key] || key === this.weapon || !this.alive) return; this._equip(key); this.scene.snd('pickup_weapon', null, 0.35); }
    cycle(dir) { var list = ORDER.filter(function (k) { return this.owned[k]; }, this), i = list.indexOf(this.weapon); this.select(list[(i + dir + list.length) % list.length]); }
    give(key) {
      var W = WEAPONS[key], a = this.ammo[key];
      if (this.owned[key]) { a.reserve = Math.min(W.reserve, a.reserve + W.mag * 2); this.scene.feed.add('+ munición de ' + W.name, 0xfab005); }
      else { this.owned[key] = true; a.mag = W.mag; a.reserve = Math.max(a.reserve, W.mag * 2); this.scene.feed.add('Nueva arma: ' + W.name + ' (' + W.slot + ')', 0xe599f7); this._equip(key); }
      this.scene.hudDirty = true;
    }
    aimRay() { var c = this.scene.view.camera, o = c.getWorldPosition(new V3()), d = c.getWorldDirection(new V3()); return { o: o, d: d }; }
    muzzle() { var g = this.mode === 'fps' ? this.fpGuns[this.weapon] : this.tpGun, m = g && g.getObjectByName('muzzle'); return (m || g || this.body).getWorldPosition(new V3()); }
    get spread() {
      var W = this.W, base = this.aim > 0.8 ? W.spread : (W.hipSpread || W.spread * 2.2), ch = this.ch;
      var mv = Math.hypot(ch.velocity.x, ch.velocity.z);
      return base * (1 + mv * 0.18 + (ch.onGround ? 0 : 2.5) - (ch.crouching ? 0.35 : 0)) + this.bloom;
    }
    update(dt, input) {
      if (!this.alive) return;
      var W = this.W, A = this.A, s = this.scene, ch = this.ch, ctl = this.ctrl;
      this.cooldown -= dt; this.switchT = Math.max(0, this.switchT - dt); this.bloom = Math.max(0, this.bloom - dt * 0.12); this.boost = Math.max(0, this.boost - dt);
      if (this.reloading > 0 && (this.reloading -= dt) <= 0) { var n = Math.min(W.mag - A.mag, A.reserve); A.mag += n; A.reserve -= n; s.hudDirty = true; }
      // apuntar (botón derecho): menos dispersión, zoom y menos sensibilidad
      var wantAim = input.aim && !ctl.running && this.reloading <= 0 && this.switchT <= 0 ? 1 : 0;
      this.aim += (wantAim - this.aim) * Math.min(1, dt * (wantAim ? 9 : 12));
      ctl.sensitivity = this.baseSens * (1 - this.aim * (W.scope ? 0.78 : 0.4));
      this._fov();
      // correr gasta aguante (el agua lo rellena); el refresco da velocidad
      if (ctl.running && ctl.moving && ch.onGround) { this.stamina = Math.max(0, this.stamina - dt * 22); if (this.stamina <= 0) ctl.running = false; }
      else this.stamina = Math.min(100, this.stamina + dt * 14);
      ctl.runSpeed = this.stamina > 3 ? (this.mode === 'fps' ? 8.8 : 8.4) * (this.boost > 0 ? 1.25 : 1) : ctl.speed;
      ctl.speed = (this.mode === 'fps' ? 5.2 : 4.8) * (this.boost > 0 ? 1.25 : 1) * (1 - this.aim * 0.35);
      // disparo
      var trig = input.fire && (W.auto || !this._trigHeld);
      if (trig && this.cooldown <= 0 && this.reloading <= 0 && this.switchT <= 0) { if (A.mag > 0) this.fire(); else { if (!this._trigHeld) s.snd('dryfire', null, 0.6); this.reload(); } }
      this._trigHeld = input.fire;
      // animaciones del cuerpo (se ven en 3ª persona)
      var moving = ctl.moving, anim = ch.vaulting ? 'Jump' : (!ch.onGround ? 'Jump' : (input.fire ? 'Shoot' : (moving ? (ctl.running ? 'Run' : 'Walk') : 'Aim')));
      if (anim !== this._anim) { this._anim = anim; this.body.play(anim, { fade: 0.15 }); }
      if (this.mode === 'tps') ctl.aiming = input.fire || input.aim;
      // pasos
      if (moving && ch.onGround && !ch.vaulting) { this.stepT -= dt * (ctl.running ? 1.6 : 1) * (ch.crouching ? 0.6 : 1); if (this.stepT <= 0) { this.stepT = 0.45; s.snd({ preset: 'footstep', seed: rnd.int(1, 4) }, null, ch.crouching ? 0.12 : 0.25); if (!ch.crouching) s.noise(ch.position, ctl.running ? 9 : 4); } }
      // arma de vista: balanceo, retroceso, recarga, cambio y apuntado (al centro)
      this.kick = Math.max(0, this.kick - dt * 7);
      this.bob += dt * (moving ? (ctl.running ? 14 : 10) : 2);
      var g = this.fpGuns[this.weapon];
      if (g) {
        var fp = W.fp || [0.22, -0.22, -0.45], am = 1 - this.aim, sw = this.switchT > 0 ? this.switchT / 0.35 : 0, bb = moving ? 1 : 0.25;
        g.position.set(fp[0] * am + Math.sin(this.bob * 0.5) * 0.012 * bb * am, (fp[1] * am - 0.13 * this.aim) + Math.abs(Math.cos(this.bob * 0.5)) * 0.01 * bb * am - (this.reloading > 0 ? 0.13 : 0) - sw * 0.25, fp[2] + this.kick * 0.07);
        g.rotation.x = this.kick * 0.28 + (this.reloading > 0 ? -0.6 : 0) - sw * 0.8;
        g.visible = this.mode === 'fps' && !(W.scope && this.aim > 0.85);
      }
      if (ch.position.y < -20) this.damage(999, null);
    }
    fire() {
      var s = this.scene, v = s.view, W = this.W, A = this.A;
      this.cooldown = W.rate; A.mag--; this.kick = 1; s.hudDirty = true;
      var r = this.aimRay(), mz = this.muzzle(), sp = this.spread, pellets = W.pellets || 1;
      for (var k = 0; k < pellets; k++) {
        var d = r.d.clone(); d.x += rnd.float(-sp, sp); d.y += rnd.float(-sp, sp); d.z += rnd.float(-sp, sp); d.normalize();
        s.shoot(r.o, d, W.range, { from: this, dmg: W.dmg, head: W.head, falloff: W.pellets ? 14 : 0, tracer: k < 3 ? mz : null, color: 0xffe8a3 });
      }
      v.effect('muzzle', mz, { direction: [r.d.x, r.d.y, r.d.z], count: W.pellets ? 12 : 6 }); s.flashLight(mz);
      s.snd({ preset: W.sfx, seed: rnd.int(1, 4) }, mz, 0.55);
      s.noise(this.ch.position, W.sfx === 'sniper' ? 70 : 48);
      // retroceso de cámara (se recupera en parte) y apertura del cono
      var rk = W.recoil * (this.aim > 0.8 ? 0.6 : 1);
      if (this.mode === 'fps') this.ctrl.pitch = Math.min(this.ctrl.maxPitch || 1.4, this.ctrl.pitch + rk); else this.ctrl.pitch = Math.max(-0.9, this.ctrl.pitch - rk * 0.6); // en 3ª persona el ángulo va al revés
      this.ctrl.yaw += rnd.float(-W.recoil, W.recoil) * 0.35;
      this.bloom = Math.min(0.06, this.bloom + W.recoil * 0.35);
      if (W.pump) s.time.delayedCall(320, function () { if (s.view && !s.over) s.snd('pump', null, 0.4); });
      if (A.mag === 0 && A.reserve > 0) { var self = this; s.time.delayedCall(250, function () { if (self.alive) self.reload(); }); }
    }
    reload() {
      var W = this.W, A = this.A;
      if (this.reloading > 0 || A.mag >= W.mag || A.reserve <= 0 || this.switchT > 0) return;
      this.reloading = W.reload; this.scene.snd(W.pump ? 'pump' : 'reload', null, 0.55); this.scene.hudDirty = true;
    }
    throwGrenade() {
      if (this.grenades <= 0 || !this.alive) return;
      this.grenades--; this.scene.hudDirty = true;
      var r = this.aimRay(); this.scene.grenade(r.o.clone().addScaled(r.d, 0.8), new V3(r.d.x * 16 + this.ch.velocity.x, r.d.y * 16 + 4, r.d.z * 16 + this.ch.velocity.z), this);
    }
    heal(n) { this.hp = Math.min(100, this.hp + n); this.scene.hudDirty = true; }
    damage(n, from) {
      if (!this.alive) return;
      var s = this.scene;
      this.hp = Math.max(0, this.hp - n); s.hudDirty = true;
      G3.flash(s, 0xff0000, Math.min(0.45, 0.12 + n / 70), 350); s.snd('flesh', null, 0.5);
      s.cameras.main.shake(160, Math.min(0.012, 0.004 + n * 0.0003));
      if (from) { var dx = from.x - this.ch.position.x, dz = from.z - this.ch.position.z, yaw = this.ctrl.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw); s.dmgInd.hit(Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz)); }
      if (s.view && n >= 6) s.view.addDecal('blood', new V3(this.ch.position.x + rnd.float(-0.6, 0.6), 0.01, this.ch.position.z + rnd.float(-0.6, 0.6)), new V3(0, 1, 0), { size: 0.4 + n * 0.015 });
      if (this.hp <= 0) { this.alive = false; this.body.visible = true; this.body.play('Die', { loop: 'once', fade: 0.1 }); this.ctrl.enabled = false; s.lose(); }
    }
  }

  /* ================================================================= Enemigo */
  var _matCache = {};
  class Enemy {
    constructor(scene, type, pos) {
      var v = scene.view, T = this.T = ENEMY_TYPES[type], sc = T.scale || 1;
      this.scene = scene; this.type = type; this.hp = this.maxHp = T.hp; this.dead = false; this.state = 'patrol'; this.t = 0; this.id = Enemy.count = (Enemy.count || 0) + 1;
      this.node = v.add.model(T.model); this.node.position.copy(pos); this.node.scale.set(sc, sc, sc);
      if (T.tint !== 0xffffff) { var key = type; this.node.traverse(function (n) { if (n instanceof UG.Mesh3D && n.material) { var ck = key + ':' + n.material.uid; if (!_matCache[ck] || _matCache[ck].disposed) { var m = n.material.clone(); m.color = T.tint; m.version++; _matCache[ck] = m; } n.material = _matCache[ck]; } }); }
      this.ch = v.physics.addCharacter(this.node, { radius: 0.4 * sc, height: 1.85 * sc }); this.ch.userData.enemy = this;
      var hand = this.node.getObjectByName('hand.R'); if (hand) { var g = v.add.model(WEAPONS[T.weapon].model); hand.add(g); g.position.set(0, -0.06, 0.04); g.rotation.x = Math.PI / 2; this.gun = g; }
      this.W = WEAPONS[T.weapon]; this.mag = this.W.mag; this.reloadT = 0; this.burst = 0; this.fireT = rnd.float(0.5, 1.2); this.reactT = T.react;
      this.facing = rnd.float(0, 6.28); this.path = null; this.pi = 0; this.goal = null; this.run = false; this.repathT = 0; this.stuck = 0;
      this.seeT = rnd.float(0, 0.2); this.sees = false; this.lastSeen = null; this.lostT = 99; this.cover = null; this.coverT = 0; this.peekT = rnd.float(1, 2); this.peek = null;
      this.grenadeT = rnd.float(6, 12); this.aimT = 0; this.laser = null; this.strafe = rnd.bool() ? 1 : -1; this.home = pos.clone(); this.flanker = false; this.lookT = 0;
      this.node.play('Walk');
    }
    eye() { var p = this.ch.position; return new V3(p.x, p.y + this.ch.height * 0.9, p.z); }
    muzzle() { return this.gun ? (this.gun.getObjectByName('muzzle') || this.gun).getWorldPosition(new V3()) : this.eye(); }
    _anim(n, o) { if (this._a !== n) { this._a = n; this.node.play(n, Object.assign({ fade: 0.2 }, o || {})); } }
    setGoal(p, run) { if (!p) return; this.goal = new V3(p.x, 0, p.z); this.run = !!run; this.scene.requestPath(this); }
    /** Visibilidad del jugador: 0 (nada), 0.4 (cabeza), 0.6 (pecho), 1 (ambos) */
    exposure(eye) {
      var P = this.scene.player, pc = P.ch, ph = this.scene.view.physics, e = eye || this.eye(), hh = pc.height;
      var head = ph.lineOfSight(e, new V3(pc.position.x, pc.position.y + hh * 0.9, pc.position.z)), chest = ph.lineOfSight(e, new V3(pc.position.x, pc.position.y + hh * 0.62, pc.position.z));
      return (head ? 0.4 : 0) + (chest ? 0.6 : 0);
    }
    perceive() {
      var P = this.scene.player; if (!P.alive) return false;
      var me = this.ch.position, pp = P.ch.position, dx = pp.x - me.x, dz = pp.z - me.z, dist = Math.hypot(dx, dz);
      if (dist > this.T.range * 1.6) return false;
      var fx = Math.sin(this.facing), fz = Math.cos(this.facing), inFov = (dx * fx + dz * fz) / Math.max(dist, 1e-3) > 0.35 || dist < 7 || this.state === 'combat';
      if (!inFov) return false;
      // agachado y quieto entre la hierba se ve peor de lejos
      if (P.ch.crouching && !P.ctrl.moving && dist > 18 && this.state !== 'combat') return false;
      return this.exposure() > 0.3;
    }
    pickCover() {
      var s = this.scene, P = s.player, pp = P.ch.position, me = this.ch.position, ph = s.view.physics, cells = s.coverCells, best = null, bs = -1e9, T = this.T;
      var pe = new V3(pp.x, pp.y + 1.5, pp.z), flankDir = null;
      if (this.flanker && s.enemyCentroid) { var cx = s.enemyCentroid.x - pp.x, cz = s.enemyCentroid.z - pp.z, cl = Math.hypot(cx, cz) || 1; flankDir = { x: -cz / cl * this.strafe, z: cx / cl * this.strafe }; }
      for (var n = 0; n < 26; n++) {
        var c = cells[rnd.int(0, cells.length - 1)]; if (!c) break;
        var dm = Math.hypot(c.x - me.x, c.z - me.z); if (dm > 18) continue;
        var dp = Math.hypot(c.x - pp.x, c.z - pp.z); if (dp < T.keep[0] || dp > T.keep[1] + 8) continue;
        if (s.coverTaken(c, this)) continue;
        var hidden = !ph.lineOfSight(pe, new V3(c.x, 1.0, c.z));
        var sc2 = (hidden ? 10 : 0) - dm * 0.35 - Math.abs(dp - (T.keep[0] + T.keep[1]) / 2) * 0.2;
        if (flankDir) sc2 += ((c.x - pp.x) * flankDir.x + (c.z - pp.z) * flankDir.z) / Math.max(dp, 1) * 6;
        if (sc2 > bs) { bs = sc2; best = c; }
      }
      return best;
    }
    update(dt) {
      var s = this.scene, P = s.player, ph = s.view.physics, me = this.ch.position, T = this.T;
      if (this.dead) { if ((this.t += dt) > 14) this.remove(); return; }
      this.reactT -= dt; this.coverT -= dt; this.grenadeT -= dt; this.repathT -= dt; this.lostT += dt; this.peekT -= dt;
      // percepción (escalonada: cada 0.2 s)
      if ((this.seeT -= dt) <= 0) {
        this.seeT = 0.2;
        var saw = this.sees; this.sees = this.perceive();
        var pq = P.ch.position; this.coverExposed = !!(this.cover && this.lostT < 1 && !this.peek && ph.lineOfSight(new V3(pq.x, pq.y + 1.5, pq.z), new V3(this.cover.x, 1.0, this.cover.z)));
        if (this.sees) { this.lastSeen = P.ch.position.clone(); this.lostT = 0; if (!saw) { this.reactT = T.react * rnd.float(0.8, 1.3); if (this.state !== 'combat') { this.state = 'combat'; this.cover = null; s.alertAllies(this); } } }
      }
      var pp = P.ch.position, dx = pp.x - me.x, dz = pp.z - me.z, dist = Math.hypot(dx, dz);
      // decisiones
      if (this.state === 'combat') {
        if (this.lostT > 7) { this.state = 'search'; this.setGoal(this.lastSeen, true); }
        else if (T.rush && (this.sees || this.lostT < 3) && dist > T.keep[1]) { if (this.repathT <= 0) { this.repathT = 0.8; this.setGoal(this.lastSeen || pp, true); } }
        else {
          var exposed = this.coverExposed;
          if (!this.cover || this.coverT <= 0 || exposed || this.hp < this.maxHp * 0.35 && !this.hurtMoved) {
            if (this.hp < this.maxHp * 0.35) this.hurtMoved = true;
            this.cover = this.pickCover(); this.coverT = rnd.float(6, 10); this.peek = null;
            if (this.cover) this.setGoal(this.cover, true); else if (this.lastSeen) this.setGoal(this.lastSeen, false);
          } else if (!this.sees && this.atGoal() && this.peekT <= 0 && this.lastSeen) {
            // asomarse: un paso a un lado desde la cobertura hacia donde se vio al jugador
            this.peekT = rnd.float(2.5, 4.5);
            var ax = this.lastSeen.x - me.x, az = this.lastSeen.z - me.z, al = Math.hypot(ax, az) || 1, side = rnd.bool() ? 1 : -1;
            var pk = s.grid.nearestFree(me.x + (-az / al) * 1.6 * side + ax / al * 0.8, me.z + (ax / al) * 1.6 * side + az / al * 0.8, 2);
            if (pk) { this.peek = pk; this.setGoal(pk, false); s.time.delayedCall(2200, () => { if (!this.dead && this.cover && this.state === 'combat') { this.peek = null; this.setGoal(this.cover, false); } }); }
          }
          // granada si el jugador se esconde
          if (!this.sees && this.lostT > 2 && this.lostT < 6 && this.lastSeen && this.grenadeT <= 0 && dist > 7 && dist < 30 && s.grenadeCd <= 0) { this.grenadeT = rnd.float(12, 18); s.grenadeCd = 5; this.throwGrenade(this.lastSeen); }
        }
      } else if (this.state === 'investigate' || this.state === 'search') {
        if (!this.goal || this.atGoal()) { if ((this.lookT += dt) > 3) { this.lookT = 0; this.state = 'patrol'; this.goal = null; } else this.facing += dt * 1.5; }
      } else if (!this.goal || this.atGoal() || this.repathT < -12) { this.repathT = 0; this.setGoal(s.grid.randomFree(rnd, this.home, 26), false); }
      // movimiento por la ruta
      var vx = 0, vz = 0, spd = this.run ? T.speed * 1.55 : T.speed;
      if (this.path && this.pi < this.path.length) {
        var wp = this.path[this.pi], wx = wp.x - me.x, wz = wp.z - me.z, wl = Math.hypot(wx, wz);
        if (wl < 0.55) this.pi++; else { vx = wx / wl * spd; vz = wz / wl * spd; }
        if (this.ch.hitWall) { if ((this.stuck += dt) > 1.2) { this.stuck = 0; s.requestPath(this); } } else this.stuck = Math.max(0, this.stuck - dt);
      }
      // en combate sin cobertura: se mueve de lado mientras dispara
      if (this.state === 'combat' && this.sees && (!this.path || this.pi >= this.path.length) && !T.laser) { var sl = dist || 1; vx += -dz / sl * this.strafe * T.speed * 0.5; vz += dx / sl * this.strafe * T.speed * 0.5; if (rnd.float() < dt * 0.4 || this.ch.hitWall) this.strafe *= -1; }
      if (this.aimT > 0) { vx *= 0.2; vz *= 0.2; }
      this.ch.move(vx, vz);
      var want = (this.state === 'combat' && (this.sees || this.lostT < 1.5)) ? Math.atan2(dx, dz) : (vx || vz ? Math.atan2(vx, vz) : this.facing);
      this.facing += G3.angleDiff(this.facing, want) * Math.min(1, 7 * dt); this.node.rotation.y = this.facing;
      // disparo
      if (this.reloadT > 0) { if ((this.reloadT -= dt) <= 0) this.mag = this.W.mag; }
      var canShoot = this.state === 'combat' && this.sees && this.reactT <= 0 && dist < T.range && this.reloadT <= 0 && P.alive;
      if (T.laser) this._sniper(dt, canShoot, dist);
      else if (canShoot) {
        if ((this.fireT -= dt) <= 0) {
          if (this.burst <= 0) { this.burst = rnd.int(T.burst[0], T.burst[1]); }
          this.shoot(dist); this.burst--; this.mag--;
          this.fireT = this.burst > 0 ? this.W.rate * 1.5 : rnd.float(0.7, 1.5);
          if (this.mag <= 0) { this.reloadT = this.W.reload * 1.3; s.snd('reload', this.node.getWorldPosition(new V3()), 0.35); this.burst = 0; if (rnd.float() < 0.6) s.floatAt(this, '¡Recargando!', 0xffd43b); }
        }
      }
      var moving = vx || vz;
      if (canShoot || this.aimT > 0) this._anim(this.fireT < 0.15 ? 'Shoot' : 'Aim');
      else this._anim(moving ? (this.run ? 'Run' : 'Walk') : 'Idle');
    }
    atGoal() { return !this.goal || Math.hypot(this.goal.x - this.ch.position.x, this.goal.z - this.ch.position.z) < 0.9; }
    _sniper(dt, canShoot, dist) {
      var s = this.scene;
      if (canShoot) {
        if (this.aimT <= 0 && (this.fireT -= dt) <= 0) this.aimT = 1.3; // apunta 1.3 s con el láser visible
        if (this.aimT > 0) {
          this.aimT -= dt;
          var P = s.player, tgt = new V3(P.ch.position.x, P.ch.position.y + P.ch.height * 0.8, P.ch.position.z);
          s.laserLine(this, this.muzzle(), tgt);
          if (this.aimT <= 0) { this.shoot(dist); this.mag--; this.fireT = rnd.float(2.2, 3.4); if (this.mag <= 0) { this.reloadT = this.W.reload * 1.2; } }
        }
      } else if (this.aimT > 0) { this.aimT = 0; }
      if (this.aimT <= 0) s.laserLine(this, null);
    }
    shoot(dist) {
      var s = this.scene, P = s.player, T = this.T, mz = this.muzzle(), pc = P.ch;
      var ex = this.exposure(), mv = Math.hypot(pc.velocity.x, pc.velocity.z);
      var chance = T.acc * ex * Math.max(0.25, 1 - dist / (T.range * 1.4)) * (mv > 6 ? 0.55 : (mv > 2 ? 0.75 : 1)) * (pc.onGround ? 1 : 0.6) * (pc.crouching ? 0.8 : 1) * (this.burst === 1 ? 1 : 0.9);
      var pellets = this.W.pellets ? 5 : 1, tgt = new V3(pc.position.x, pc.position.y + pc.height * 0.7, pc.position.z), dmg = 0;
      for (var k = 0; k < pellets; k++) {
        var hit = rnd.float() < chance, aimP = tgt.clone();
        if (!hit) aimP.add(new V3(rnd.float(-1.6, 1.6), rnd.float(-0.8, 1.2), rnd.float(-1.6, 1.6)));
        else dmg += rnd.int(T.dmg[0], T.dmg[1]) * (this.W.pellets ? Math.max(0.3, 1 - dist / 18) / 2.2 : 1);
        if (k < 2) s.tracer(mz, aimP, T.laser ? 0xff8787 : 0xff9f6b);
        if (!hit) { var d = aimP.clone().sub(mz).normalize(), h = s.view.physics.raycast(mz, d, 90, { bodies: false, characters: false }); if (h) s.impact(h, d, true); }
      }
      s.view.effect('muzzle', mz, { count: 5 }); s.flashLight(mz);
      s.snd({ preset: this.W.sfx, seed: rnd.int(1, 4) }, mz, 0.5);
      if (dmg > 0) P.damage(Math.round(dmg), this.ch.position);
      else if (dist < 25) s.snd({ preset: 'ricochet', seed: rnd.int(1, 3) }, pc.position.clone().add(new V3(rnd.float(-2, 2), 1.5, rnd.float(-2, 2))), 0.25);
    }
    throwGrenade(at) {
      var s = this.scene, e = this.eye(), d = new V3(at.x - e.x, 0, at.z - e.z), l = d.length() || 1, t = Math.min(1.6, 0.35 + l / 16);
      var vel = new V3(d.x / t, (at.y + 0.3 - e.y - 0.5 * s.view.physics.gravity.y * t * t) / t, d.z / t);
      s.grenade(e.clone().add(new V3(d.x / l * 0.6, 0.2, d.z / l * 0.6)), vel, this);
      s.floatAt(this, '¡Granada!', 0xff8787); this.node.play('Attack', { fade: 0.1, loop: 'once', exclusive: false, weight: 0.8, restart: true });
    }
    damage(n, dir, head) {
      if (this.dead) return;
      var s = this.scene;
      this.hp -= n; if (this.state !== 'combat') { this.state = 'combat'; this.cover = null; s.alertAllies(this); }
      this.lastSeen = s.player.ch.position.clone(); this.lostT = 0; this.reactT = Math.min(this.reactT, 0.25);
      this._a = null; this.node.play('Hit', { fade: 0.05, loop: 'once', exclusive: false, weight: 0.8, clamp: false, restart: true });
      if (this.hp <= 0) this.kill(dir, head);
      else if (this.hp < this.maxHp * 0.35 && !this.hurtMoved) this.coverT = 0;
    }
    kill(dir, head) {
      var s = this.scene, T = this.T, p = this.ch.position.clone(); this.dead = true; this.t = 0;
      this.node.play('Die', { loop: 'once', fade: 0.1 });
      this.ch.enabled = false; s.laserLine(this, null);
      s.player.kills++; s.player.score += T.score + (head ? 50 : 0); if (head) s.player.headshots++; s.hudDirty = true;
      s.feed.add((head ? '☠ ' : '✖ ') + T.name + (head ? ' (tiro a la cabeza)' : '') + '  +' + (T.score + (head ? 50 : 0)), head ? 0xff8787 : 0xffffff);
      if (T.blood) { s.view.addDecal('pool', new V3(p.x + (dir ? dir.x * 0.6 : 0), 0.012, p.z + (dir ? dir.z * 0.6 : 0)), new V3(0, 1, 0), { size: 1.4 * rnd.float(0.8, 1.2), grow: 5 }); }
      else { s.view.effect('sparks', p.clone().add(new V3(0, 1, 0)), { count: 30 }); s.view.effect('smoke', p.clone().add(new V3(0, 1, 0)), { count: 12 }); s.snd('grenade', p, 0.4); }
      // botín
      var roll = rnd.float();
      if (roll < 0.3) s.spawnPickup(p.clone(), 'ammo'); else if (roll < 0.45) s.spawnPickup(p.clone(), 'medkit'); else if (roll < 0.6) s.spawnPickup(p.clone(), 'w_' + T.weapon); else if (roll < 0.7) s.spawnPickup(p.clone(), 'grenade');
    }
    remove() { if (this.removed) return; this.removed = true; this.scene.laserLine(this, null); this.ch.destroy(); this.node.destroy(); }
  }

  /* ================================================================== Escena */
  class Play extends UG.Scene {
    constructor() { super('Play'); }
    preload() { G3.loadModels(this, MODELS); }
    create() {
      var s = this, W = this.game.width, H = this.game.height;
      this.sound.unlock();
      this.sound.prewarm(['rifle', 'pistol', 'smg', 'shotgun', 'sniper', 'impact', 'flesh', 'reload', 'dryfire', 'grenade', 'glass', 'footstep', 'eat', 'drink', 'pickup_weapon', 'pump', 'ricochet', 'impact_metal', 'heartbeat']);
      var v = this.view = this.add.view3d({ fov: 75, near: 0.05, far: 420 });
      v.enablePhysics({ gravity: -22 });
      this.village = buildVillage(v, this, true);
      this.touch = G3.touchControls(this, [{ name: 'fire', label: '●', color: 0xff4d4d, radius: 54 }, { name: 'jump', label: '⤒', color: 0x4dabf7 }, { name: 'reload', label: 'R', color: 0xfab005 }, { name: 'use', label: 'E', color: 0x40c057 }, { name: 'aim', label: '◎', color: 0x845ef7 }, { name: 'crouch', label: 'C', color: 0x868e96 }]);
      this.player = new Player(this);
      this.sun = v.add.sunlight({ shadowSize: 60, follow: this.player.body, direction: new V3(-0.5, -1, -0.3) });
      this.muzzleLight = v.add.pointLight(0xffc27a, 0, 7, 2); this.flashT = 0;
      // navegación para la IA (desde la física: casas, coches, sacos, cajas...)
      var t0 = performance.now();
      this.grid = UG.NavGrid3D.fromPhysics(v.physics, { area: [-AREA, -AREA, AREA, AREA], cell: 1, radius: 0.42, height: 1.8 });
      this.coverCells = this.grid.coverPoints();
      this.navMs = Math.round(performance.now() - t0);
      this.pathQueue = [];
      this.enemies = []; this.pickups = []; this.grenades = []; this.wave = 0; this.over = false; this.waveT = 4; this.grenadeCd = 0; this.lasers = new Map();
      this.fillHouses();
      // HUD
      this.cross = this.add.hud.graphics(); this.cross.depth = 890; this.crossHit = 0;
      this.scope = this.add.hud.graphics(); this.scope.depth = -5; this.scope.visible = false; // bajo el resto del HUD (vida y munición siguen visibles)
      this.scope.lineStyle(W, 0x000000, 1).strokeCircle(W / 2, H / 2, H * 0.44 + W / 2).lineStyle(2, 0x000000, 0.9).lineBetween(W / 2 - H * 0.44, H / 2, W / 2 + H * 0.44, H / 2).lineBetween(W / 2, H / 2 - H * 0.44, W / 2, H / 2 + H * 0.44).lineStyle(3, 0x111111, 1).strokeCircle(W / 2, H / 2, H * 0.44);
      this.vign = G3.vignette(this); this.dmgInd = G3.damageIndicator(this);
      this.hpBar = G3.bar(this, 24, H - 76, 260, 24, 0x51cf66, 'Vida');
      this.stBar = G3.bar(this, 24, H - 44, 200, 10, 0x74c0fc);
      this.ammoText = G3.text(this, W - 30, H - 50, '', 34, 0xffffff, { ox: 1 });
      this.wText = G3.text(this, W - 30, H - 86, '', 18, 0xdde3ff, { ox: 1, stroke: 3 });
      this.slots = G3.text(this, W - 30, H - 112, '', 15, 0xadb5bd, { ox: 1, stroke: 3 });
      this.info = G3.text(this, W / 2, 30, '', 24, 0xffffff);
      this.kills = G3.text(this, 56, 26, '', 20, 0xffd43b, { ox: 0 });
      this.prompt = G3.text(this, W / 2, H / 2 + 90, '', 22, 0xfff3bf); this.prompt.depth = 885;
      this.feed = G3.feed(this, W - 30, 230);
      this.map = G3.minimap(this, { key: 'shooter-map', world: [-AREA - 2, -AREA - 2, AREA + 2, AREA + 2], ppm: 5, x: W - 110, y: 120, radius: 85, range: 45, draw: drawMap, title: 'Mapa del pueblo',
        legend: [[0xff4040, 'Enemigo visto'], [0x69db7c, 'Comida y bebida'], [0xff6b6b, 'Botiquín'], [0xfab005, 'Munición'], [0xe599f7, 'Arma']] });
      this.help = G3.text(this, W / 2, H - 12, G3.touch ? '' : 'Clic disparar · botón dcho. apuntar · 1-5/rueda/Q armas · R recargar · E coger · C agacharse · Espacio saltar/ventanas · G granada · V vista · M mapa', 14, 0xdde3ff, { stroke: 3 });
      this.hint = G3.text(this, W / 2, H / 2 + 60, G3.auto || G3.touch ? '' : 'Haz clic para apuntar con el ratón', 22, 0xffffff);
      MG.hudButtons(this, {});
      this.hudDirty = true;
      var kb = this.input.keyboard, P = this.player;
      kb.on('keydown-R', function () { P.reload(); });
      kb.on('keydown-G', function () { P.throwGrenade(); });
      kb.on('keydown-V', function () { P.toggleView(); });
      kb.on('keydown-E', function () { s.interact(); });
      kb.on('keydown-Q', function () { P.select(P.prevWeapon); });
      ORDER.forEach(function (k, i) { kb.on('keydown-' + (i + 1), function () { P.select(k); }); });
      this.input.on('wheel', function (p, o, dx, dy) { P.cycle(dy > 0 ? 1 : -1); });
      this.mouse = G3.mouseButtons(this);
      this.input.on('pointerdown', function (p, objects) { if (p.type === 'mouse' && !(objects && objects.length) && s.hint.text) s.hint.text = ''; });
      this.bot = G3.auto ? { t: 0, path: null, pi: 0, repath: 0 } : null;
      this.events.once('shutdown', function () { if (s._trGeo) { s._trGeo.keep = false; s._trGeo.dispose(); s._trGeo = null; } _matCache = {}; });
      G3.expose('shooter', this);
    }
    snd(spec, pos, vol) { if (!this.sound || this.sound.disabled) return; if (pos) this.view.playSfx(spec, pos, { volume: vol || 0.5, refDistance: 5 }); else this.sound.playSfx(spec, { volume: vol || 0.5 }); }
    floatAt(e, str, color) { var sp = this.view.worldToScreen(e.eye().add(new V3(0, 0.5, 0))); if (sp.visible) MG.floatText(this, sp.x, sp.y, str, color, 18); }
    flashLight(p) { this.muzzleLight.position.copy(p); this.muzzleLight.intensity = 6; this.flashT = 0.05; }
    /** Ruido (disparos, pasos, explosiones): los enemigos cercanos que no combaten van a investigar */
    noise(pos, radius) { var s = this; this.enemies.forEach(function (e) { if (e.dead || e.state === 'combat') return; if (e.ch.position.distanceTo(pos) < radius) { e.state = 'investigate'; e.lookT = 0; e.setGoal(new V3(pos.x + rnd.float(-3, 3), 0, pos.z + rnd.float(-3, 3)), true); } }); void s; }
    alertAllies(src) { var s = this; this.enemies.forEach(function (e) { if (e === src || e.dead || e.state === 'combat') return; if (e.ch.position.distanceTo(src.ch.position) < 35) { e.state = 'combat'; e.lastSeen = src.lastSeen ? src.lastSeen.clone() : s.player.ch.position.clone(); e.lostT = 0.5; e.cover = null; } }); }
    coverTaken(c, me) { for (var i = 0; i < this.enemies.length; i++) { var e = this.enemies[i]; if (e !== me && !e.dead && e.cover && Math.abs(e.cover.x - c.x) < 1.5 && Math.abs(e.cover.z - c.z) < 1.5) return true; } return false; }
    requestPath(e) { if (this.pathQueue.indexOf(e) < 0) this.pathQueue.push(e); }
    _paths() {
      for (var n = 0; n < 3 && this.pathQueue.length; n++) {
        var e = this.pathQueue.shift(); if (e.dead || !e.goal) continue;
        var p = this.grid.findPath(e.ch.position, e.goal); e.path = p; e.pi = p && p.length > 1 ? 1 : 0; e.repathT = 0;
      }
    }
    /** Trazadora de bala: geometría y materiales compartidos, mallas reutilizadas */
    _trInit() { if (!this._trGeo) { this._trGeo = UG.Geometry3D.box(0.02, 0.02, 1); this._trGeo.keep = true; this._trMats = {}; this._trFree = []; this._tracers = []; } }
    tracer(a, b, color) {
      var v = this.view, d = b.clone().sub(a), len = d.length(); if (len < 0.1) return;
      this._trInit();
      var mat = this._trMats[color] || (this._trMats[color] = v.material({ type: 'basic', color: color, transparent: true, blend: 'add' }));
      var m = this._trFree.pop() || v.add.mesh(this._trGeo, mat);
      m.material = mat; m.visible = true; m.castShadow = false;
      m.position.copy(a).addScaled(d, 0.5); m.scale.set(1, 1, len); m.lookAt(b);
      this._tracers.push({ m: m, life: 0.05 });
    }
    /** Láser del francotirador (una malla por enemigo, reutilizada) */
    laserLine(e, a, b) {
      var m = this.lasers.get(e);
      if (!a) { if (m) m.visible = false; return; }
      this._trInit();
      if (!m) { m = this.view.add.mesh(this._trGeo, this.view.material({ type: 'basic', color: 0xff2020, transparent: true, opacity: 0.55, blend: 'add' })); m.castShadow = false; this.lasers.set(e, m); }
      var d = b.clone().sub(a), len = d.length(); m.visible = true; m.position.copy(a).addScaled(d, 0.5); m.scale.set(0.5, 0.5, len); m.lookAt(b);
    }
    /** Impacto de bala en el escenario: agujero persistente, chispas/polvo y sonido */
    impact(h, d, quiet) {
      var v = this.view;
      if (h.collider || (!h.character && !h.body)) { v.addDecal('bullet', h.point, h.normal); v.effect('sparks', h.point, { direction: [h.normal.x, h.normal.y, h.normal.z], count: 8 }); if (h.normal.y > 0.7) v.effect('dust', h.point, { count: 5 }); }
      if (!quiet || rnd.float() < 0.5) this.snd({ preset: 'impact', seed: rnd.int(1, 4) }, h.point, 0.3);
    }
    /** Disparo del jugador: cristales en el camino, barriles, enemigos (cabeza) y escenario */
    shoot(o, d, range, opt) {
      var ph = this.view.physics, hit = ph.raycast(o, d, range, { characters: true, bodies: true, ignore: this.player.ch });
      var end = hit ? hit.distance : range, v = this.view;
      // cristales atravesados antes del impacto (se rompen y la bala sigue)
      var ray = new UG.Ray(o.clone(), d.clone());
      for (var i = 0; i < this.village.glass.length; i++) { var g = this.village.glass[i]; if (g.broken) continue; var t = ray.intersectBox(g.box); if (t !== null && t < end) this.breakGlass(g, ray.at(t, new V3())); }
      // barriles explosivos (su caja estática es la del modelo)
      if (opt.tracer) this.tracer(opt.tracer, hit ? hit.point : o.clone().addScaled(d, range), opt.color);
      if (!hit) return;
      if (hit.character && hit.character.userData.enemy) {
        var e = hit.character.userData.enemy, head = hit.point.y - hit.character.position.y > hit.character.height * 0.8;
        var dmg = opt.dmg * (head ? opt.head : 1) * (opt.falloff ? Math.max(0.25, 1 - Math.max(0, hit.distance - opt.falloff) / 30) : 1);
        e.damage(Math.round(dmg), d, head); this.crossHit = 0.18;
        if (e.T.blood) {
          v.effect('blood', hit.point, { direction: [d.x, 0.4, d.z], count: head ? 40 : 26 });
          this.snd({ preset: 'flesh', seed: rnd.int(1, 4) }, hit.point, 0.45);
          // salpicadura en la pared o el suelo de detrás
          var bh = ph.raycast(hit.point.clone().addScaled(d, 0.5), new V3(d.x, d.y - 0.35, d.z).normalize(), 4, { bodies: false });
          if (bh) v.addDecal('blood', bh.point, bh.normal, { size: rnd.float(0.6, 1.2) });
          else v.addDecal('blood', new V3(hit.point.x + d.x * 1.2, 0.012, hit.point.z + d.z * 1.2), new V3(0, 1, 0), { size: rnd.float(0.5, 0.9) });
        } else { v.effect('sparks', hit.point, { direction: [-d.x, 0.3, -d.z], count: 14 }); this.snd({ preset: 'impact_metal', seed: rnd.int(1, 4) }, hit.point, 0.45); }
        if (head) MG.floatText(this, this.game.width / 2, this.game.height / 2 - 44, '¡Cabeza!', 0xff6b6b, 20);
        return;
      }
      var bar = hit.collider && this.village.barrels.find(function (b) { return !b.dead && b.node.position.distanceTo(hit.point) < 1.2; });
      if (bar) { bar.hp -= opt.dmg; v.effect('sparks', hit.point, { count: 10 }); if (bar.hp <= 0) this.explodeBarrel(bar); else v.effect('fire', hit.point, { count: 6 }); return; }
      if (hit.body) hit.body.applyImpulse(d.x * 3, d.y * 3 + 1, d.z * 3);
      this.impact(hit, d);
    }
    breakGlass(g, p) {
      g.broken = true; g.mesh.visible = false; this.snd({ preset: 'glass', seed: rnd.int(1, 4) }, p, 0.6);
      this.view.effect({ rate: 0, burst: 30, life: [0.5, 1.1], speed: [1.5, 4], spread: 0.8, direction: [0, 0.4, 0], gravity: -14, size: [0.09, 0.05], color: [0xe7f5ff, 0xa5d8ff], alpha: [0.9, 0.4], blend: 'normal' }, p, { count: 30 });
      this.view.addDecal('crack', new V3(p.x, 0.012, p.z), new V3(0, 1, 0), { size: 0.9 });
      this.noise(p, 20);
    }
    explodeBarrel(b) { b.dead = true; var p = b.node.position.clone().add(new V3(0, 0.6, 0)); b.node.visible = false; var cols = this.view.physics.statics.filter(function (c) { return c.node === b.node; }); var ph = this.view.physics; cols.forEach(function (c) { ph.removeStatic(c); }); this.explode(p, 1.3); }
    grenade(pos, vel, owner) {
      var v = this.view, node = v.add.model('grenade'); node.scale.set(1.6, 1.6, 1.6); node.position.copy(pos);
      var b = v.physics.addBody(node, { shape: 'sphere', radius: 0.1, restitution: 0.35, mass: 0.6 }); b.setVelocity(vel.x, vel.y, vel.z);
      var s = this, rec = { b: b, node: node, t: 2.3, owner: owner };
      b.on('collide', function (o, sp) { if (sp > 2) s.snd({ preset: 'impact_metal', seed: 2 }, b.position.clone(), 0.2); });
      this.grenades.push(rec);
    }
    explode(p, power) {
      power = power || 1;
      var v = this.view, s = this, R = 7 * power;
      v.effect('explosion', p); v.effect('smoke', p, { count: 24 }); v.physics.explode(p, R, 30); this.snd({ preset: power > 1 ? 'blast' : 'grenade', seed: rnd.int(1, 3) }, p, 1);
      v.addDecal('scorch', new V3(p.x, 0.013, p.z), new V3(0, 1, 0), { size: 2.6 * power });
      this.cameras.main.shake(320, 0.012 * Math.min(1.6, 30 / Math.max(6, this.player.ch.position.distanceTo(p))));
      this.enemies.forEach(function (e) { if (e.dead) return; var d = e.ch.position.distanceTo(p); if (d < R && v.physics.lineOfSight(p.clone().add(new V3(0, 0.5, 0)), e.eye())) e.damage(Math.round(170 * power * (1 - d / R)), new V3(e.ch.position.x - p.x, 0, e.ch.position.z - p.z).normalize()); });
      var dp = this.player.ch.position.distanceTo(p); if (dp < R * 0.85 && v.physics.lineOfSight(p.clone().add(new V3(0, 0.5, 0)), this.player.ch.position.clone().add(new V3(0, 1.2, 0)))) this.player.damage(Math.round(70 * power * (1 - dp / (R * 0.85))), p);
      this.village.glass.forEach(function (g) { if (!g.broken && g.box.getCenter(new V3()).distanceTo(p) < R * 0.8) s.breakGlass(g, g.box.getCenter(new V3())); });
      this.village.barrels.forEach(function (b) { if (!b.dead && b.pos.distanceTo(p) < R * 0.6) s.time.delayedCall(150, function () { if (!b.dead && s.view) s.explodeBarrel(b); }); });
      this.noise(p, 60);
    }
    /** Coloca comida, bebida, munición y armas en las mesas, encimeras y estantes de las casas */
    fillHouses() {
      var s = this, pool = ['apple', 'bread', 'water', 'soda', 'apple', 'bread', 'ammo', 'water', 'medkit', 'grenade', 'soda', 'ammo'];
      var weaponIn = { 1: 'w_smg', 3: 'w_shotgun', 6: 'w_sniper', 8: 'w_smg', 9: 'w_shotgun' };
      this.village.houses.forEach(function (h, i) {
        var spots = h.items.slice(), n = Math.min(spots.length, 3 + (i % 2));
        for (var k = 0; k < n; k++) {
          var at = spots.splice(rnd.int(0, spots.length - 1), 1)[0], kind = k === 0 && weaponIn[i] ? weaponIn[i] : pool[rnd.int(0, pool.length - 1)];
          s.spawnPickup(at, kind, true);
        }
      });
    }
    spawnPickup(pos, kind, onFurniture) {
      var I = ITEMS[kind]; if (!I) return;
      var node = this.view.add.model(I.model); node.scale.set(I.scale, I.scale, I.scale);
      node.position.set(pos.x, onFurniture ? pos.y : 0.02, pos.z); node.rotation.y = rnd.float(0, 6.28);
      if (I.weapon) { node.rotation.z = Math.PI / 2; node.position.y += 0.06; }
      this.pickups.push({ node: node, kind: kind, I: I, pos: node.position.clone().add(new V3(0, 0.12, 0)), t: onFurniture ? 1e9 : 60 });
    }
    /** Objeto al que se apunta (a menos de 2.6 m, cerca del centro de la mira) */
    lookedPickup() {
      var r = this.player.aimRay(), best = null, bd = 1e9, eye = this.player.ch.position.clone().add(new V3(0, 1.5, 0));
      for (var i = 0; i < this.pickups.length; i++) {
        var pk = this.pickups[i], dv = pk.pos.clone().sub(r.o), dist = dv.length();
        if (dist > 2.6 && pk.pos.distanceTo(eye) > 2.6) continue;
        var ang = dv.normalize().dot(r.d);
        if (ang > 0.93 || pk.pos.distanceTo(this.player.ch.position) < 1.0) { var sc = dist - ang * 2; if (sc < bd) { bd = sc; best = pk; } }
      }
      return best;
    }
    interact() {
      var pk = this.lookedPickup(), P = this.player; if (!pk || !P.alive) return;
      var I = pk.I;
      if (I.heal) { if (P.hp >= 100 && !I.stamina && !I.boost) { this.feed.add('Ya tienes la vida completa', 0xadb5bd); return; } P.heal(I.heal); }
      if (I.stamina) P.stamina = 100;
      if (I.boost) P.boost = I.boost;
      if (I.ammo) { ORDER.forEach(function (k) { if (P.owned[k]) P.ammo[k].reserve = Math.min(WEAPONS[k].reserve, P.ammo[k].reserve + WEAPONS[k].mag); }); }
      if (I.grenade) P.grenades = Math.min(6, P.grenades + I.grenade);
      if (I.weapon) P.give(I.weapon);
      this.snd(I.sfx || 'pickup_weapon', null, 0.6);
      if (!I.weapon) this.feed.add(I.label.replace(/^(Comer|Beber|Usar|Coger) /, '✔ '), I.color);
      if (I.heal) G3.flash(this, 0x40c057, 0.18, 250);
      pk.node.destroy(); this.pickups.splice(this.pickups.indexOf(pk), 1); this.hudDirty = true;
    }
    nextWave() {
      this.wave++; this.hudDirty = true;
      if (this.wave > WAVES) { this.win(); return; }
      var list = WAVE_DEF[this.wave - 1], spawns = [[-60, -60], [60, -60], [-60, 60], [60, 60], [0, -62], [0, 62], [-62, 0], [62, 0]], P = this.player.ch.position, s = this;
      var far = spawns.filter(function (sp) { return Math.hypot(sp[0] - P.x, sp[1] - P.z) > 40; }); if (!far.length) far = spawns;
      list.forEach(function (type, i) {
        var sp = far[(i + s.wave) % far.length], p = s.grid.nearestFree(sp[0] + rnd.float(-4, 4), sp[1] + rnd.float(-4, 4), 8) || new V3(sp[0], 0, sp[1]);
        var e = new Enemy(s, type, p); s.enemies.push(e);
        if (s.wave >= 2 && rnd.float() < 0.5) { e.state = 'investigate'; e.setGoal(s.grid.randomFree(rnd, new V3(0, 0, 0), 25), true); }
      });
      MG.floatText(this, this.game.width / 2, this.game.height * 0.35, 'Oleada ' + this.wave + ' / ' + WAVES, 0xffd43b, 40);
      this.snd('select', null, 0.5);
    }
    lose() { if (this.over) return; this.over = true; var s = this; this.time.delayedCall(2500, function () { s.scene.start('GameOver', { score: s.player.score, win: false }); }); }
    win() { if (this.over) return; this.over = true; var s = this; this.player.score += 1000 + this.player.hp * 5; this.snd('powerup'); MG.floatText(this, this.game.width / 2, this.game.height / 2, '¡Pueblo liberado!', 0x63e6be, 48); this.time.delayedCall(2500, function () { s.scene.start('GameOver', { score: s.player.score, win: true }); }); }
    _botInput(dt) {
      // bot para pruebas: apunta al enemigo visible más cercano, dispara, recoge objetos y va hacia el enemigo por la rejilla
      var p = this.player, ph = this.view.physics, eye = this.view.camera.getWorldPosition(new V3()), best = null, bd = 1e9, near = null, nd = 1e9, b = this.bot;
      this.enemies.forEach(function (e) { if (e.dead) return; var d = e.ch.position.distanceTo(p.ch.position); if (d < nd) { nd = d; near = e; } if (d < 50 && d < bd && ph.lineOfSight(eye, e.eye())) { bd = d; best = e; } });
      var ext = p.ctrl.external || (p.ctrl.external = {}); ext.forward = 0; ext.strafe = 0; ext.run = false; ext.jump = false; ext.crouch = false;
      var fire = false;
      if (best) {
        var d = best.ch.position.clone().add(new V3(0, best.ch.height * 0.65, 0)).sub(eye), len = d.length();
        p.ctrl.yaw = Math.atan2(-d.x, -d.z); p.ctrl.pitch = p.mode === 'fps' ? Math.asin(d.y / len) : -Math.asin(d.y / len);
        fire = true; ext.strafe = Math.sin(this.time.now * 0.002);
        p.ctrl.update(0); this.view.camera.updateWorldMatrix();
      } else if (near) {
        if ((b.repath -= dt) <= 0) { b.repath = 1; b.path = this.grid.findPath(p.ch.position, near.ch.position); b.pi = 1; }
        var tgt = b.path && b.path[b.pi] ? b.path[b.pi] : near.ch.position, dn = tgt.clone().sub(p.ch.position);
        if (b.path && b.pi < b.path.length - 1 && Math.hypot(dn.x, dn.z) < 1) b.pi++;
        p.ctrl.yaw += G3.angleDiff(p.ctrl.yaw, Math.atan2(-dn.x, -dn.z)) * Math.min(1, 6 * dt); p.ctrl.pitch = 0;
        ext.forward = 1; ext.run = nd > 20; if (p.ch.hitWall) ext.jump = true;
      }
      if ((b.t += dt) > 3) { b.t = 0; if (best && bd < 25 && rnd.float() < 0.3) p.throwGrenade(); if (rnd.float() < 0.15) p.toggleView(); if (rnd.float() < 0.4) p.cycle(1); }
      if (p.A.mag === 0) p.reload();
      if (p.A.reserve < 30) p.A.reserve += 90; // munición infinita en modo prueba
      if (p.hp < 40) p.hp += 30;
      var pk = this.lookedPickup(); if (pk) this.interact();
      return { fire: fire, aim: !!best && bd > 15 };
    }
    update(t, dtMs) {
      var dt = Math.min(dtMs, 50) / 1000, p = this.player, tc = this.touch.buttons, i, s = this, W = this.game.width, H = this.game.height;
      var input = this.bot ? this._botInput(dt) : { fire: this.mouse.left || !!(tc.fire && tc.fire.isDown) || !!(this.input.gamepad.pad1 && this.input.gamepad.pad1.value(7) > 0.5), aim: this.mouse.right || !!(tc.aim && tc.aim.isDown) || !!(this.input.gamepad.pad1 && this.input.gamepad.pad1.value(6) > 0.5) };
      if (tc.jump && tc.jump.justDown) { if (!p.ch.tryVault(-Math.sin(p.ctrl.yaw), -Math.cos(p.ctrl.yaw))) p.ch.jump(); }
      if (tc.reload && tc.reload.justDown) p.reload(); if (tc.use && tc.use.justDown) this.interact(); if (tc.crouch && tc.crouch.justDown) p.ch.setCrouch(!p.ch.crouching);
      if (!this.over) p.update(dt, input);
      this._paths();
      var alive = 0, cx = 0, cz = 0, eng = [];
      for (i = 0; i < this.enemies.length; i++) { var e = this.enemies[i]; e.update(dt); if (!e.dead) { alive++; if (e.state === 'combat') { cx += e.ch.position.x; cz += e.ch.position.z; eng.push(e); } } }
      this.enemyCentroid = eng.length ? new V3(cx / eng.length, 0, cz / eng.length) : null;
      if ((this._flankT = (this._flankT || 0) - dt) <= 0) { this._flankT = 3; eng.forEach(function (e2, k) { e2.flanker = eng.length >= 2 && k === eng.length - 1; }); }
      this.enemies = this.enemies.filter(function (e2) { return !e2.removed; });
      if (!this.over && alive === 0) {
        if (this.wave > 0 && this.waveT > 3 && !this._restMsg && this.wave < WAVES) { this._restMsg = true; this.feed.add('Oleada superada: registra las casas (E)', 0x63e6be); }
        if ((this.waveT -= dt) <= 0) { this.waveT = 14; this._restMsg = false; this.nextWave(); }
      }
      this.grenadeCd -= dt;
      // granadas
      this.grenades = this.grenades.filter(function (g) { if ((g.t -= dt) <= 0) { var gp = g.b.position.clone(); g.b.destroy(); g.node.destroy(); s.explode(gp); return false; } return true; });
      // trazadoras, destello
      var free = this._trFree;
      if (this._tracers) this._tracers = this._tracers.filter(function (tr) { if ((tr.life -= dt) <= 0) { tr.m.visible = false; free.push(tr.m); return false; } return true; });
      if (this.flashT > 0 && (this.flashT -= dt) <= 0) this.muzzleLight.intensity = 0;
      // objetos: los del suelo giran y caducan
      this.pickups = this.pickups.filter(function (pk) { if (pk.node.destroyed) return false; if (pk.t < 1e8) { pk.node.rotation.y += dt * 1.5; if ((pk.t -= dt) <= 0) { pk.node.destroy(); return false; } } return true; });
      var look = this.lookedPickup(); this.prompt.text = look && p.alive ? 'E: ' + look.I.label : '';
      // mira dinámica (se abre con la dispersión), marca de impacto y visor telescópico
      var gap = 6 + p.spread * 700, c = this.crossHit > 0 ? 0xff3b3b : 0xffffff, cg = this.cross; this.crossHit -= dt;
      cg.clear(); var showX = p.alive && !(p.W.scope && p.aim > 0.85) && p.mode === 'fps' || p.mode === 'tps';
      if (showX) { cg.lineStyle(2, 0x000000, 0.45).strokeCircle(W / 2, H / 2, 2.5).lineStyle(2, c, 0.95).lineBetween(W / 2 - gap - 9, H / 2, W / 2 - gap, H / 2).lineBetween(W / 2 + gap, H / 2, W / 2 + gap + 9, H / 2).lineBetween(W / 2, H / 2 - gap - 9, W / 2, H / 2 - gap).lineBetween(W / 2, H / 2 + gap, W / 2, H / 2 + gap + 9); if (this.crossHit > 0) cg.lineStyle(2.5, 0xff3b3b, 1).lineBetween(W / 2 - 10, H / 2 - 10, W / 2 - 4, H / 2 - 4).lineBetween(W / 2 + 10, H / 2 - 10, W / 2 + 4, H / 2 - 4).lineBetween(W / 2 - 10, H / 2 + 10, W / 2 - 4, H / 2 + 4).lineBetween(W / 2 + 10, H / 2 + 10, W / 2 + 4, H / 2 + 4); }
      this.scope.visible = p.W.scope && p.aim > 0.85 && p.mode === 'fps';
      this.vign.set(p.hp < 45 ? (45 - p.hp) / 45 * 0.9 : 0);
      if (p.alive && p.hp < 30) { if ((this._hb = (this._hb || 0) - dt) <= 0) { this._hb = 1.1; this.snd('heartbeat', null, 0.5); } }
      this.dmgInd.update(dt); this.feed.update(dt);
      // HUD
      if (this.hudDirty) {
        this.hudDirty = false;
        this.hpBar.set(p.hp / 100, 'Vida ' + p.hp);
        var A = p.A; this.ammoText.text = p.reloading > 0 ? 'Recargando…' : A.mag + ' / ' + A.reserve;
        this.wText.text = p.W.name + '   💣' + p.grenades;
        this.slots.text = ORDER.map(function (k, j) { return (p.owned[k] ? (k === p.weapon ? '▣' : '▢') : '·') + (j + 1); }).join('  ');
        this.kills.text = 'Bajas: ' + p.kills + '   Puntos: ' + p.score;
      }
      this.stBar.set(p.stamina / 100);
      this.info.text = this.wave > 0 && this.wave <= WAVES ? (alive ? 'Oleada ' + this.wave + '/' + WAVES + ' · enemigos: ' + alive : (this.wave < WAVES ? 'Siguiente oleada en ' + Math.ceil(this.waveT) + ' s' : '')) : (this.wave === 0 ? 'Prepárate: ' + Math.ceil(this.waveT) + ' s' : '');
      // minimapa: enemigos que se ven (o se oyen disparar), objetos cercanos
      var items = [];
      this.enemies.forEach(function (e2) { if (!e2.dead && (e2.sees || e2.fireT < 0.3 || e2.ch.position.distanceTo(p.ch.position) < 12)) items.push({ x: e2.ch.position.x, z: e2.ch.position.z, color: 0xff4040, r: 4, ring: true }); });
      this.pickups.forEach(function (pk) { items.push({ x: pk.pos.x, z: pk.pos.z, color: pk.I.color, r: 2.6 }); });
      this.map.update(p.ch.position, p.mode === 'fps' ? p.ctrl.yaw : Math.atan2(-this.view.camera.getWorldDirection(new V3()).x, -this.view.camera.getWorldDirection(new V3()).z), items);
    }
  }

  // arranque: carga los modelos (el menú ya los usa de fondo)
  var Boot = { key: 'Boot', preload: function () { G3.loadModels(this, MODELS); }, create: function () { this.scene.start(G3.auto ? 'Play' : 'Menu'); } };
  var game = G3.start({ title: 'Operación Tormenta', scenes: [
    Boot, MG.menu({ id: 'shooter3d', title: 'Operación Tormenta', subtitle: 'Shooter 3D · primera y tercera persona', titleColors: [0xffffff, 0xffc078], glow: '#ff922b',
      help: 'Libera el pueblo de 5 oleadas. Clic disparar · botón derecho apuntar · 1-5/rueda armas · R recargar · E coger comida, bebida y armas de las casas · C agacharse · Espacio saltar (y por las ventanas) · G granada · V vista · M mapa',
      touchHelp: 'Joystick para moverte, arrastra a la derecha para mirar. Botones: disparo, apuntar, salto, recarga, coger (E) y agacharse.',
      background: function (scene) {
        return G3.menuBackground(function (v) { buildVillage(v, scene, false); v.add.sunlight({ shadowSize: 70 }); for (var i = 0; i < 4; i++) { var r = v.add.model(i === 3 ? 'robot' : 'humanoid'); r.position.set(i * 3 - 4.5, 0, 4); r.rotation.y = 0.4; r.play(['Idle', 'Aim', 'Dance', 'Wave'][i]); } }, 22, 7)(scene);
      }, buttonColor: 0xe8590c }),
    Play, MG.gameOver({ id: 'shooter3d', background: function (s) { s.add.rectangle(s.game.width / 2, s.game.height / 2, s.game.width, s.game.height, 0x1a0f08, 1); } })
  ] });
  void game;
})();
