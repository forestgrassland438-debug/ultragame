/* UltraGame 3D · utilidades compartidas por los juegos 3D (se apoya en ../../minigames/common.js: MG.menu, MG.gameOver,
 * MG.text, MG.best, MG.hudButtons, pausa). Añade: carga de modelos, HUD 3D (barras, mira, radar, destellos),
 * controles táctiles, fondo 3D para menús y ganchos para pruebas automáticas (?auto=1). */
(function () {
  'use strict';
  var qs = new URLSearchParams(location.search);
  var G3 = window.G3 = {
    auto: qs.get('auto') === '1',
    touch: MG.isTouch || qs.get('touch') === '1',
    ASSETS: '../../assets3d/',
    /** Crea el juego (1280x720 con escalado "fit": nítido en escritorio y móvil) */
    start: function (config) {
      return MG.start(Object.assign({ width: 1280, height: 720, backgroundColor: 0x000000, audio: G3.auto ? { noAudio: true } : undefined }, config));
    },
    /** Botones independientes: sólo se activan al pulsar sobre el juego, no sobre el HUD. */
    mouseButtons: function (scene) {
      var held = 0, input = scene.input;
      var reset = function () { held = 0; };
      input.on('pointerdown', function (p, objects) {
        if (p.type !== 'mouse' || (objects && objects.length)) return;
        if (p.button === 0) held |= 1;
        if (p.button === 2) held |= 2;
      });
      input.on('pointerup', function (p) { if (p.type === 'mouse') held &= p.buttons; });
      input.on('pointercancel', function (p) { if (p.type === 'mouse') reset(); });
      scene.events.on('pause', reset);
      scene.events.on('sleep', reset);
      scene.events.once('shutdown', reset);
      return {
        get left() { return !!(held & input.mousePointer.buttons & 1); },
        get right() { return !!(held & input.mousePointer.buttons & 2); }
      };
    },
    /** Encola modelos GLB del directorio común de assets */
    loadModels: function (scene, names) {
      // URL completa al encolar: el Loader resuelve setPath() al cargar, no al encolar
      names.forEach(function (n) { scene.load.gltf(n, G3.ASSETS + n + '.glb'); });
    },
    /** Texto de HUD (sin mover con la cámara 2D) */
    text: function (scene, x, y, str, size, color, opts) { return MG.text(scene, x, y, str, size, color, Object.assign({ hud: true }, opts || {})); },
    /** Barra de HUD: set(0..1) */
    bar: function (scene, x, y, w, h, color, label) {
      var g = scene.add.hud.graphics(), txt = label ? G3.text(scene, x + 8, y + h / 2, label, Math.round(h * 0.7), 0xffffff, { ox: 0, stroke: 3 }) : null, cur = -1;
      var o = {
        g: g, text: txt, value: 1,
        set: function (v, str) {
          v = Math.max(0, Math.min(1, v)); if (txt && str !== undefined) txt.text = str;
          if (Math.abs(v - cur) < 1e-4) return o; cur = v; o.value = v;
          g.clear().fillStyle(0x000000, 0.55).fillRoundedRect(x - 2, y - 2, w + 4, h + 4, h / 2 + 2).fillStyle(color, 0.95).fillRoundedRect(x, y, Math.max(h, w * v), h, h / 2);
          if (v <= 0) g.clear().fillStyle(0x000000, 0.55).fillRoundedRect(x - 2, y - 2, w + 4, h + 4, h / 2 + 2);
          return o;
        }
      };
      return o.set(1);
    },
    /** Mira en el centro de la pantalla; hit() la hace parpadear en rojo */
    crosshair: function (scene) {
      var W = scene.game.width, H = scene.game.height, g = scene.add.hud.graphics(), t = 0;
      var draw = function (hit) {
        var c = hit ? 0xff3b3b : 0xffffff, s = hit ? 12 : 9;
        g.clear().lineStyle(2, 0x000000, 0.5).strokeCircle(W / 2, H / 2, 3).lineStyle(2, c, 0.95)
          .lineBetween(W / 2 - s - 6, H / 2, W / 2 - 5, H / 2).lineBetween(W / 2 + 5, H / 2, W / 2 + s + 6, H / 2)
          .lineBetween(W / 2, H / 2 - s - 6, W / 2, H / 2 - 5).lineBetween(W / 2, H / 2 + 5, W / 2, H / 2 + s + 6).fillStyle(c, 1).fillCircle(W / 2, H / 2, 1.6);
      };
      draw(false);
      return { g: g, hit: function () { t = 0.15; draw(true); }, update: function (dt) { if (t > 0 && (t -= dt) <= 0) draw(false); }, set visible(v) { g.visible = v; } };
    },
    /** Destello de pantalla completa (daño, recogida) */
    flash: function (scene, color, alpha, ms) {
      var W = scene.game.width, H = scene.game.height, r = scene.add.hud.rectangle(W / 2, H / 2, W, H, color || 0xff0000, alpha || 0.35);
      scene.tweens.add({ targets: r, alpha: 0, duration: ms || 350, onComplete: function () { r.destroy(); } });
    },
    /** Radar circular: update(centro {x,z}, rumbo (rad), [{x, z, color, r}]) */
    radar: function (scene, cx, cy, radius, range) {
      var g = scene.add.hud.graphics();
      return {
        g: g,
        update: function (c, heading, items) {
          g.clear().fillStyle(0x000000, 0.45).fillCircle(cx, cy, radius).lineStyle(2, 0xffffff, 0.35).strokeCircle(cx, cy, radius).lineStyle(1, 0xffffff, 0.12).strokeCircle(cx, cy, radius * 0.5);
          var cs = Math.cos(heading), sn = Math.sin(heading), k = radius / range;
          for (var i = 0; i < items.length; i++) {
            var it = items[i], dx = it.x - c.x, dz = it.z - c.z;
            // rotar para que "adelante" quede arriba
            var rx = (dx * cs - dz * sn) * k, ry = (dx * sn + dz * cs) * k, d = Math.hypot(rx, ry);
            if (d > radius - 3) { if (!it.edge) continue; rx *= (radius - 3) / d; ry *= (radius - 3) / d; }
            g.fillStyle(it.color || 0xff4040, 1).fillCircle(cx + rx, cy + ry, it.r || 3.5);
          }
          g.fillStyle(0xffffff, 1).fillTriangle(cx, cy - 7, cx - 5, cy + 5, cx + 5, cy + 5);
        }
      };
    },
    /** Joystick + botones táctiles (solo en pantallas táctiles o con ?touch=1) */
    touchControls: function (scene, buttons) {
      if (!G3.touch) return { joy: null, buttons: {} };
      var W = scene.game.width, H = scene.game.height, out = { joy: scene.add.joystick({ x: 150, y: H - 150, radius: 80, zone: new UG.Rectangle(0, H * 0.3, W * 0.4, H * 0.7) }), buttons: {} };
      (buttons || []).forEach(function (b, i) { out.buttons[b.name] = scene.add.virtualButton({ x: W - 90 - (i % 2) * 120, y: H - 90 - Math.floor(i / 2) * 120, radius: b.radius || 46, label: b.label, color: b.color }); });
      return out;
    },
    /** Fondo 3D para el menú: builder(view) monta la escena; la cámara orbita sola */
    menuBackground: function (builder, radius, height) {
      return function (scene) {
        var v = scene.add.view3d({ shadows: true });
        builder(v, scene);
        var t = 0, r = radius || 20, h = height || 8;
        v.on('update3d', function (dt) { t += dt * 0.12; v.camera.position.set(Math.sin(t) * r, h, Math.cos(t) * r); v.camera.lookAt(0, 1, 0); });
        scene.add.rectangle(scene.game.width / 2, scene.game.height / 2, scene.game.width, scene.game.height, 0x000000, 0.35);
        return v;
      };
    },
    /**
     * Muchas copias de un modelo GLB con 1 draw call por malla: transforms = [{x, y, z, ry, s}]
     * (árboles, farolas, vallas, edificios). Devuelve un Group3D con las InstancedMesh3D.
     */
    instances: function (view, key, transforms, opts) {
      opts = opts || {};
      var model = view.scene.game.cache.models.get(key), group = new UG.Group3D(); group.name = key + '-instances';
      if (!model) { UG.Log.warn('G3.instances: modelo no cargado', key); return group; }
      var tmp = model.instantiate(); tmp.updateMatrixWorld(true);
      var inv = new UG.Mat4().invertFrom(tmp.matrixWorld), local = new UG.Mat4(), inst = new UG.Mat4(), full = new UG.Mat4();
      tmp.traverse(function (n) {
        if (!(n instanceof UG.Mesh3D) || n.skeleton) return;
        var im = new UG.InstancedMesh3D(n.geometry, n.material, transforms.length);
        im.castShadow = opts.castShadow !== false; im.receiveShadow = opts.receiveShadow !== false;
        local.multiplyMatrices(inv, n.matrixWorld);
        transforms.forEach(function (t, i) {
          var s = t.s || 1;
          inst.compose(new UG.Vec3(t.x || 0, t.y || 0, t.z || 0), new UG.Quat().setFromEuler(0, t.ry || 0, 0), new UG.Vec3(s, s, s));
          im.setMatrixAt(i, full.multiplyMatrices(inst, local));
        });
        group.add(im);
      });
      tmp.destroy();
      view.scene3d.add(group);
      return group;
    },
    /**
     * Minimapa real: el mundo se dibuja UNA vez en una textura (Canvas 2D: draw(ctx, X, Z, ppm) con X(x)/Z(z) en píxeles) y se
     * muestra en un círculo del HUD que gira con el jugador (adelante = arriba). M (o toggle()) abre el mapa grande.
     * o: { key, world: [x0, z0, x1, z1], ppm (px por metro), x, y, radius, range (m visibles), draw, legend: [[color, texto]] }
     * update(pos {x, z}, yaw, items [{x, z, color, r, edge, icon}])  — yaw como en FirstPersonControls (0 = mirando a -Z)
     */
    minimap: function (scene, o) {
      var W = scene.game.width, H = scene.game.height, wd = o.world, x0 = wd[0], z0 = wd[1], ppm = o.ppm || 2;
      var tw = Math.min(2048, Math.ceil((wd[2] - x0) * ppm)), th = Math.min(2048, Math.ceil((wd[3] - z0) * ppm)); ppm = Math.min(tw / (wd[2] - x0), th / (wd[3] - z0));
      var key = o.key || 'minimap', R = o.radius || 80, cx = o.x === undefined ? R + 20 : o.x, cy = o.y === undefined ? H - R - 20 : o.y, range = o.range || 60, k = R / range;
      if (!scene.textures.exists(key)) scene.textures.generate(key, tw, th, function (ctx) { o.draw(ctx, function (x) { return (x - x0) * ppm; }, function (z) { return (z - z0) * ppm; }, ppm); });
      var back = scene.add.hud.graphics(); back.fillStyle(0x0b0e14, 0.85).fillCircle(cx, cy, R + 3); back.depth = 900;
      var holder = scene.add.hud.container(cx, cy); holder.depth = 901;
      var map = new UG.Sprite(0, 0); map.setTexture(key); map.setOrigin(0, 0); map.scaleX = map.scaleY = k / ppm; holder.add(map);
      var dots = new UG.Graphics(); holder.add(dots);
      var mask = scene.add.hud.graphics(); mask.fillStyle(0xffffff, 1).fillCircle(cx, cy, R); holder.mask = mask;
      var ring = scene.add.hud.graphics(); ring.depth = 902;
      ring.lineStyle(3, 0xffffff, 0.55).strokeCircle(cx, cy, R + 1).fillStyle(0xffffff, 1).fillTriangle(cx, cy - 8, cx - 6, cy + 6, cx + 6, cy + 6).lineStyle(1.5, 0x000000, 0.7).strokeTriangle(cx, cy - 8, cx - 6, cy + 6, cx + 6, cy + 6);
      var north = G3.text(scene, cx, cy - R - 12, 'N', 14, 0xffd43b, { stroke: 3 }); north.depth = 903;
      // mapa grande
      var big = scene.add.hud.container(0, 0); big.visible = false; big.depth = 950;
      var bs = Math.min((W * 0.86) / tw, (H * 0.82) / th), bx = (W - tw * bs) / 2, by = (H - th * bs) / 2 + 10;
      var dim = new UG.Graphics(); dim.fillStyle(0x000000, 0.72).fillRect(0, 0, W, H); big.add(dim);
      var bmap = new UG.Sprite(bx, by); bmap.setTexture(key); bmap.setOrigin(0, 0); bmap.scaleX = bmap.scaleY = bs; big.add(bmap);
      var bdots = new UG.Graphics(); big.add(bdots);
      var bt = new UG.Text(W / 2, by - 22, (o.title || 'Mapa') + '  ·  M para cerrar', { fontFamily: MG.FONT, fontSize: 20, fontWeight: 'bold', fill: 0xffffff, stroke: 0x000000, strokeThickness: 4 }); bt.setOrigin(0.5); big.add(bt);
      (o.legend || []).forEach(function (L, i) { var g = new UG.Graphics(); g.fillStyle(L[0], 1).fillCircle(bx + 14, by + tw * 0 + th * bs - 16 - i * 22, 6); big.add(g); var t = new UG.Text(bx + 26, by + th * bs - 16 - i * 22, L[1], { fontFamily: MG.FONT, fontSize: 15, fill: 0xffffff, stroke: 0x000000, strokeThickness: 3 }); t.setOrigin(0, 0.5); big.add(t); });
      var mm = {
        big: false, holder: holder,
        toggle: function (on) { mm.big = on === undefined ? !mm.big : !!on; big.visible = mm.big; return mm; },
        update: function (p, yaw, items) {
          holder.rotation = yaw; map.x = -(p.x - x0) * k; map.y = -(p.z - z0) * k;
          dots.clear();
          for (var i = 0; i < items.length; i++) {
            var it = items[i], dx = (it.x - p.x) * k, dz = (it.z - p.z) * k, d = Math.hypot(dx, dz), lim = R - 4;
            if (d > lim) { if (!it.edge) continue; dx *= lim / d; dz *= lim / d; }
            dots.fillStyle(it.color || 0xff4040, 1).fillCircle(dx, dz, it.r || 3.5);
            if (it.ring) dots.lineStyle(1.5, 0x000000, 0.8).strokeCircle(dx, dz, (it.r || 3.5) + 1);
          }
          if (mm.big) {
            bdots.clear();
            for (var j = 0; j < items.length; j++) { var q = items[j]; if (q.big === false) continue; bdots.fillStyle(q.color || 0xff4040, 1).fillCircle(bx + (q.x - x0) * ppm * bs, by + (q.z - z0) * ppm * bs, (q.r || 3.5) * 1.3); }
            var px = bx + (p.x - x0) * ppm * bs, pz = by + (p.z - z0) * ppm * bs, fx = -Math.sin(yaw), fz = -Math.cos(yaw), sx = -fz, sz = fx;
            bdots.fillStyle(0xffffff, 1).fillTriangle(px + fx * 12, pz + fz * 12, px - fx * 7 + sx * 7, pz - fz * 7 + sz * 7, px - fx * 7 - sx * 7, pz - fz * 7 - sz * 7).lineStyle(2, 0x000000, 0.8).strokeTriangle(px + fx * 12, pz + fz * 12, px - fx * 7 + sx * 7, pz - fz * 7 + sz * 7, px - fx * 7 - sx * 7, pz - fz * 7 - sz * 7);
          }
        }
      };
      scene.input.keyboard.on('keydown-M', function () { mm.toggle(); });
      return mm;
    },
    /** Indicador de daño: arcos rojos alrededor de la mira hacia el atacante. hit(ángulo relativo: 0 = delante, +: derecha) */
    damageIndicator: function (scene) {
      var W = scene.game.width, H = scene.game.height, g = scene.add.hud.graphics(), list = []; g.depth = 880;
      return {
        hit: function (rel) { list.push({ a: rel, t: 1.4 }); if (list.length > 6) list.shift(); },
        update: function (dt) {
          g.clear();
          for (var i = list.length - 1; i >= 0; i--) {
            var e = list[i]; e.t -= dt; if (e.t <= 0) { list.splice(i, 1); continue; }
            var a = e.a - Math.PI / 2, r = 120, al = Math.min(1, e.t) * 0.85;
            g.lineStyle(9, 0xff2020, al);
            g.beginPath(); for (var s = -6; s <= 6; s++) { var aa = a + s * 0.045, x = W / 2 + Math.cos(aa) * r, y = H / 2 + Math.sin(aa) * r; if (s === -6) g.moveTo(x, y); else g.lineTo(x, y); } g.strokePath();
          }
        }
      };
    },
    /** Viñeta roja con poca vida: set(0..1) */
    vignette: function (scene) {
      var W = scene.game.width, H = scene.game.height, key = 'g3-vignette';
      if (!scene.textures.exists(key)) scene.textures.generate(key, 256, 144, function (ctx, w, h) { var gr = ctx.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, w * 0.62); gr.addColorStop(0, 'rgba(160,0,0,0)'); gr.addColorStop(1, 'rgba(160,0,0,0.95)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h); });
      var s = scene.add.hud.sprite(W / 2, H / 2, key); s.scaleX = W / 256; s.scaleY = H / 144; s.alpha = 0; s.depth = 870;
      return { set: function (v) { s.alpha = Math.max(0, Math.min(1, v)); }, sprite: s };
    },
    /** Lista de sucesos (bajas, objetos) arriba a la derecha que se desvanece */
    feed: function (scene, x, y) {
      var lines = [];
      return {
        add: function (str, color) {
          var t = G3.text(scene, x, y, str, 17, color || 0xffffff, { ox: 1, stroke: 3 }); t.depth = 860; lines.unshift({ t: t, life: 4.5 });
          while (lines.length > 6) lines.pop().t.destroy();
        },
        update: function (dt) { for (var i = lines.length - 1; i >= 0; i--) { var L = lines[i]; L.life -= dt; L.t.y = y + i * 22; L.t.alpha = Math.min(1, L.life); if (L.life <= 0) { L.t.destroy(); lines.splice(i, 1); } } },
        clear: function () { lines.forEach(function (L) { L.t.destroy(); }); lines.length = 0; }
      };
    },
    /** Estado visible para las pruebas automáticas */
    expose: function (name, obj) { window.GAME3D = window.GAME3D || {}; window.GAME3D[name] = obj; return obj; },
    /** Ángulo mínimo con signo entre dos rumbos */
    angleDiff: function (a, b) { return Math.atan2(Math.sin(b - a), Math.cos(b - a)); },
    /** Formato mm:ss.cc */
    time: function (ms) { var s = Math.max(0, ms) / 1000, m = Math.floor(s / 60); s -= m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); },
    /** Material simple por color (con cache) */
    mat: function (view, color, extra) { var k = '_m' + color + JSON.stringify(extra || {}); var c = view._g3mats || (view._g3mats = {}); return c[k] || (c[k] = view.material(Object.assign({ color: color }, extra || {}))); }
  };
  // las partidas automáticas (?auto=1, pruebas) no guardan récords: solo se leen
  if (G3.auto) { var readBest = MG.best; MG.best = function (key, value) { var cur = readBest(key); return value !== undefined ? Math.max(cur, value) : cur; }; }
})();
