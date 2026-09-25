/* UltraGame Minijuegos - utilidades compartidas: arranque, menús, HUD, récords, pausa, audio, pantalla completa. */
(function () {
  'use strict';
  var qs = new URLSearchParams(location.search);
  var FONT = 'system-ui, "Segoe UI", Roboto, Arial, sans-serif';

  var MG = window.MG = {
    FONT: FONT,
    isTouch: ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0,
    renderer: qs.get('r') || 'auto',
    /** Crea el juego con valores por defecto de la colección. */
    start: function (config) {
      var cfg = Object.assign({
        parent: 'game', width: 960, height: 540, backgroundColor: 0x0b0e1a, renderer: MG.renderer,
        scale: { mode: 'fit', autoCenter: true }, antialias: true, stats: qs.get('stats') === '1', title: config.title || 'UltraGame'
      }, config);
      var game = new UG.Game(cfg);
      window.game = game;
      game.on('error', function (e) { console.error(e); });
      return game;
    },
    /** Récord persistente (localStorage con try/catch: modo privado, cookies bloqueadas...). */
    best: function (key, value) {
      var k = 'ug-mg-' + key;
      try {
        var cur = +(localStorage.getItem(k) || 0);
        if (value !== undefined && value > cur) { localStorage.setItem(k, String(value)); return value; }
        return cur;
      } catch (e) { return value || 0; }
    },
    text: function (scene, x, y, str, size, color, opts) {
      opts = opts || {};
      var t = (opts.hud ? scene.add.hud : scene.add).text(x, y, str, Object.assign({ fontFamily: FONT, fontSize: size || 24, fontWeight: 'bold', fill: color === undefined ? 0xffffff : color, stroke: 0x000000, strokeThickness: opts.stroke === undefined ? 4 : opts.stroke, align: 'center' }, opts.style || {}));
      t.setOrigin(opts.ox === undefined ? 0.5 : opts.ox, opts.oy === undefined ? 0.5 : opts.oy);
      return t;
    },
    /** Botones de HUD: pausa, sonido, pantalla completa, volver a la colección. */
    hudButtons: function (scene, opts) {
      opts = opts || {};
      var g = scene.game, W = g.width, s = 34, y = 26, items = [];
      var mk = function (x, label, fn) {
        var c = scene.add.hud.container(x, y);
        var bg = new UG.Graphics().fillStyle(0x000000, 0.45).fillRoundedRect(-s / 2, -s / 2, s, s, 9).lineStyle(2, 0xffffff, 0.35).strokeRoundedRect(-s / 2, -s / 2, s, s, 9);
        var t = new UG.Text(0, 0, label, { fontFamily: FONT, fontSize: 17, fill: 0xffffff }); t.setOrigin(0.5);
        c.add(bg); c.add(t); c.hitArea = new UG.Rectangle(-s / 2, -s / 2, s, s); c.setInteractive({ cursor: 'pointer' });
        c.on('pointertap', function (p) {
          if (p && p.type === 'mouse' && p.button !== 0) return;
          scene.sound.playSfx('click', { volume: 0.5 }); fn(c, t);
        });
        c.depth = 1000; items.push(c); return c;
      };
      mk(W - 26, '⏸', function () { MG.togglePause(scene); });
      mk(W - 66, g.sound.mute ? '🔇' : '🔊', function (c, t) { g.sound.toggleMute(); t.text = g.sound.mute ? '🔇' : '🔊'; });
      mk(W - 106, '⛶', function () { g.scale.toggleFullscreen(); });
      // ⌂: en el menú vuelve a la colección; durante la partida abre la pausa (allí se confirma la salida)
      if (opts.back !== false) mk(26, '⌂', function () { if (scene.scene.key === 'Menu' || scene.scene.key === 'GameOver') location.href = '../index.html'; else if (!g.scene.isActive('Pausa')) MG.togglePause(scene); });
      scene.input.keyboard.on('keydown-P', function () { MG.togglePause(scene); });
      scene.input.keyboard.on('keydown-ESC', function () { MG.togglePause(scene); });
      return items;
    },
    togglePause: function (scene) {
      var g = scene.game;
      if (g.scene.isActive('Pausa')) { var pause = g.scene.getScene('Pausa'); if (pause.resumeGame) pause.resumeGame(); return; }
      // pause() es inmediata y launch() se procesa al siguiente frame. Una
      // segunda petición en ese intervalo no debe volver a lanzar la pausa.
      if (!g.scene.isActive(scene.scene.key)) return;
      if (!g.scene.getScene('Pausa')) g.scene.add('Pausa', MG.PauseScene);
      g.scene.pause(scene.scene.key);
      g.scene.launch('Pausa', { from: scene.scene.key });
    },
    PauseScene: {
      create: function (data) {
        var s = this, W = this.game.width, H = this.game.height, confirmBox = [];
        var resuming = false;
        var resume = this.resumeGame = function () {
          if (resuming) return;
          resuming = true;
          s.game.scene.stop('Pausa'); s.game.scene.resume(data.from);
        };
        this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55);
        var main = [this.add.panel(W / 2, H / 2 + 20, 380, 290, { title: 'Pausa' }),
          this.add.button(W / 2, H / 2 + 0, { text: 'Continuar', width: 240, onClick: resume }),
          this.add.button(W / 2, H / 2 + 60, { text: 'Menú del juego', width: 240, color: 0x495057, onClick: function () { ask('¿Salir al menú? Se perderá la partida.', function () { s.game.scene.stop(data.from); s.game.scene.stop('Pausa'); s.game.scene.start('Menu'); }); } }),
          this.add.button(W / 2, H / 2 + 120, { text: 'Colección de juegos', width: 240, color: 0x343a40, onClick: function () { ask('¿Salir a la colección? Se perderá la partida.', function () { location.href = '../index.html'; }); } })];
        // confirmación: nada se pierde con un clic sin querer
        var ask = function (text, yes) {
          main.forEach(function (o) { o.visible = false; });
          confirmBox.forEach(function (o) { o.destroy(); }); confirmBox.length = 0;
          confirmBox.push(s.add.panel(W / 2, H / 2 + 20, 460, 220, { title: 'Confirmar' }), MG.text(s, W / 2, H / 2 - 5, text, 20, 0xffffff, { stroke: 3, style: { wordWrap: true, wordWrapWidth: 400 } }),
            s.add.button(W / 2 - 105, H / 2 + 70, { text: 'Sí, salir', width: 190, color: 0xc92a2a, onClick: yes }),
            s.add.button(W / 2 + 105, H / 2 + 70, { text: 'No, seguir', width: 190, color: 0x2f9e44, onClick: function () { confirmBox.forEach(function (o) { o.destroy(); }); confirmBox.length = 0; main.forEach(function (o) { o.visible = true; }); } }));
        };
        this.input.keyboard.on('keydown-P', resume);
        this.input.keyboard.on('keydown-ESC', resume);
      }
    },
    /** Escena de menú reutilizable con título, instrucciones y botón Jugar. */
    menu: function (o) {
      return {
        key: 'Menu',
        create: function () {
          var s = this, W = this.game.width, H = this.game.height;
          var starting = false;
          var startPlay = function () {
            if (starting) return;
            starting = true;
            s.sound.unlock(); s.scene.start(o.play || 'Play');
          };
          if (o.background) o.background(this);
          var title = MG.text(this, W / 2, H * 0.26, o.title, 64, 0xffffff, { style: { fill: o.titleColors || [0xffffff, 0x9fb4ff], dropShadow: { color: o.glow || '#5c7cfa', blur: 18, distance: 0 } }, stroke: 6 });
          this.tweens.add({ targets: title, y: title.y - 8, duration: 1400, ease: 'sineInOut', yoyo: true, repeat: -1 });
          MG.text(this, W / 2, H * 0.26 + 58, o.subtitle || '', 22, 0xcdd6ff, { stroke: 3 });
          var help = MG.isTouch ? (o.touchHelp || o.help) : o.help;
          MG.text(this, W / 2, H * 0.62, help || '', 18, 0xaab4d9, { stroke: 3, style: { fontWeight: 'normal', wordWrap: true, wordWrapWidth: W * 0.8, lineHeight: 26 } });
          var best = MG.best(o.id);
          if (best) MG.text(this, W / 2, H * 0.52, 'Récord: ' + best, 22, 0xffd43b, { stroke: 3 });
          this.add.button(W / 2, H * 0.8, { text: '▶  Jugar', width: 240, height: 58, color: o.buttonColor || 0x4c6ef5, textStyle: { fontSize: 26 }, onClick: startPlay });
          this.input.keyboard.on('keydown-ENTER', startPlay);
          this.input.keyboard.on('keydown-SPACE', startPlay);
          MG.hudButtons(this, {});
          if (o.music) { this.sound.addMusic('menu-' + o.id, o.music); this.sound.playMusic('menu-' + o.id, { volume: 0.35, fadeIn: 600 }); }
        }
      };
    },
    /** Escena de fin de partida. data: {score, win} */
    gameOver: function (o) {
      return {
        key: 'GameOver',
        create: function (data) {
          var s = this, W = this.game.width, H = this.game.height;
          var leaving = false;
          var go = function (key) { if (leaving) return; leaving = true; s.scene.start(key); };
          if (o.background) o.background(this);
          var best = MG.best(o.id, data.score || 0), isRecord = (data.score || 0) >= best && data.score > 0;
          this.add.panel(W / 2, H / 2, 440, 330, { title: data.win ? '¡Victoria!' : 'Fin de la partida' });
          MG.text(this, W / 2, H / 2 - 40, 'Puntos: ' + (data.score || 0), 36, 0xffffff);
          MG.text(this, W / 2, H / 2 + 6, isRecord ? '★ ¡Nuevo récord! ★' : 'Récord: ' + best, 22, isRecord ? 0xffd43b : 0xaab4d9, { stroke: 3 });
          this.add.button(W / 2, H / 2 + 70, { text: 'Reintentar', width: 220, color: 0x2f9e44, onClick: function () { go(o.play || 'Play'); } });
          this.add.button(W / 2, H / 2 + 128, { text: 'Menú', width: 220, color: 0x495057, onClick: function () { go('Menu'); } });
          this.input.keyboard.on('keydown-ENTER', function () { go(o.play || 'Play'); });
          if (isRecord) this.sound.playSfx('powerup');
        }
      };
    },
    /** Texto flotante (puntos, combos) */
    floatText: function (scene, x, y, str, color, size) {
      var t = scene.add.text(x, y, str, { fontFamily: FONT, fontSize: size || 22, fontWeight: 'bold', fill: color || 0xffffff, stroke: 0x000000, strokeThickness: 4 });
      t.setOrigin(0.5); t.depth = 500;
      scene.tweens.add({ targets: t, y: y - 50, alpha: { from: 1, to: 0 }, scaleX: { from: 0.6, to: 1.2 }, scaleY: { from: 0.6, to: 1.2 }, duration: 800, ease: 'quadOut', onComplete: function () { t.destroy(); } });
      return t;
    },
    /** Textura de brillo radial reutilizable */
    glowTexture: function (scene, key, size, color) {
      if (scene.textures.exists(key)) return key;
      scene.textures.generate(key, size, size, function (ctx, w, h) {
        var g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g.addColorStop(0, color || 'rgba(255,255,255,1)'); g.addColorStop(0.35, (color || 'rgba(255,255,255,1)').replace(/[\d.]+\)$/, '0.55)')); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      });
      return key;
    },
    /** Fondo de estrellas procedural */
    starfield: function (scene, key, w, h, n, seed) {
      if (scene.textures.exists(key)) return key;
      var rng = new UG.RNG(seed || key);
      scene.textures.generate(key, w, h, function (ctx) {
        for (var i = 0; i < n; i++) {
          var x = rng.float() * w, y = rng.float() * h, r = rng.float() * 1.4 + 0.3, a = rng.float() * 0.8 + 0.2;
          ctx.fillStyle = 'rgba(' + (200 + rng.int(0, 55)) + ',' + (200 + rng.int(0, 55)) + ',255,' + a.toFixed(2) + ')';
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        }
      });
      return key;
    }
  };
})();
