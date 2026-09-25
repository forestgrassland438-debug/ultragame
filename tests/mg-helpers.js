/* Utilidades de prueba para los minijuegos (se inyectan desde la consola o desde tests/minigames.html).
 * No forman parte del motor ni de los juegos. */
(function () {
  'use strict';
  var H = window.MGTest = {
    errors: [],
    /** Captura errores del juego y promesas rechazadas */
    watch: function () {
      H.errors = [];
      if (window.game) window.game.on('error', function (e) { H.errors.push(String(e && e.stack || e)); });
      window.addEventListener('error', function (e) { H.errors.push(String(e.message)); });
      window.addEventListener('unhandledrejection', function (e) { H.errors.push('rechazo: ' + String(e.reason && e.reason.stack || e.reason)); });
    },
    steps: function (n, dt) { for (var i = 0; i < n; i++) window.game.loop.step(dt || 16); },
    live: function () { return Object.assign({}, UG.Debug.live); },
    diff: function (a, b, ignore) {
      var d = {}; ignore = ignore || ['SoundInstance'];
      Object.keys(Object.assign({}, a, b)).forEach(function (k) { if (ignore.indexOf(k) < 0 && (a[k] || 0) !== (b[k] || 0)) d[k] = [a[k] || 0, b[k] || 0]; });
      return d;
    },
    /** Muestra una región del juego ampliada (captura a otra resolución) sobre la página */
    zoom: async function (res, sx, sy, sw, sh) {
      var game = window.game, r = game.renderer, old = r.resolution;
      game.loop.stop(); r.resize(r.width, r.height, res); game.loop.step(16); game.loop.step(16);
      var url = await game.snapshot(), img = new Image(); img.src = url; await img.decode();
      r.resize(r.width, r.height, old); game.loop.step(16);
      var c = document.getElementById('__zoom'); if (!c) { c = document.createElement('canvas'); c.id = '__zoom'; document.body.appendChild(c); }
      c.width = innerWidth; c.height = innerHeight; c.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#000';
      var x = c.getContext('2d'), k = img.width / game.width, sc = Math.min(innerWidth / (sw * k), innerHeight / (sh * k));
      x.drawImage(img, sx * k, sy * k, sw * k, sh * k, 0, 0, sw * k * sc, sh * k * sc);
      return [img.width, img.height];
    },
    unzoom: function () { var c = document.getElementById('__zoom'); if (c) c.remove(); window.game.loop.start(); },
    /** Bot de Dungeon Lights: BFS hasta las llaves y la escalera, ataca a los enemigos cercanos */
    dungeonBot: function (P, maxFrames) {
      var TS = 24, MW = 56, MH = 36, log = { frames: 0, attacks: 0 }, joy = P.joy = { force: 0, forceX: 0, forceY: 0 };
      var bfs = function (sx, sy, tx, ty) {
        var G = P.dungeon.grid, prev = new Int32Array(MW * MH).fill(-2), q = [sy * MW + sx]; prev[q[0]] = -1;
        while (q.length) { var c = q.shift(); if (c === ty * MW + tx) break; var cx = c % MW, cy = (c / MW) | 0; [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { var nx = cx + d[0], ny = cy + d[1], n = ny * MW + nx; if (nx >= 0 && ny >= 0 && nx < MW && ny < MH && G[n] === 1 && prev[n] === -2) { prev[n] = c; q.push(n); } }); }
        var path = [], c2 = ty * MW + tx; if (prev[c2] === -2) return null; while (c2 !== -1) { path.push(c2); c2 = prev[c2]; } return path.reverse();
      };
      for (var f = 0; f < maxFrames; f++) {
        if (window.game.scene.getScene('Play') !== P || P.over || !P.hero || P.sys.status !== 'running') break;
        var h = P.hero, fx = h.x, fy = h.y + 7.5, target = null;
        if (P.keys < 3) { var bd = 1e9; P.items.getChildren().forEach(function (it) { if (it.active && it.kind === 'key') { var d = Math.hypot(it.x - fx, it.y - fy); if (d < bd) { bd = d; target = it; } } }); } else target = P.exit;
        P.foes.getChildren().forEach(function (e) { var d = Math.hypot(e.x - h.x, e.y - h.y); if (e.active && d < 34) { P.facing = { x: (e.x - h.x) / (d || 1), y: (e.y - h.y) / (d || 1) }; if (P.attackCd <= 0) { P.attack(); log.attacks++; } } });
        if (target && f % 4 === 0) {
          var path = bfs(Math.floor(fx / TS), Math.floor(fy / TS), Math.floor(target.x / TS), Math.floor(target.y / TS)), wx, wy;
          if (path && path.length > 1) { var n = path[1]; wx = (n % MW) * TS + TS / 2; wy = ((n / MW) | 0) * TS + TS / 2; } else { wx = target.x; wy = target.y; }
          var dx = wx - fx, dy = wy - fy, dd = Math.hypot(dx, dy) || 1; joy.force = 1; joy.forceX = dx / dd; joy.forceY = dy / dd;
        }
        window.game.loop.step(16); log.frames++;
      }
      joy.force = 0; return log;
    }
  };
})();
