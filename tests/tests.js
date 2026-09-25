/* UltraGame - suite de pruebas en navegador: unitarias, render píxel a píxel en cada backend,
 * entrada sintética, escenas, fugas de memoria y benchmarks. Resultados en window.__results. */
(function () {
  'use strict';
  var suites = [];
  var R = window.__results = { passed: 0, failed: 0, skipped: 0, failures: [], bench: [], leaks: [], done: false, backends: [] };
  function suite(name, fn, opts) { suites.push({ name: name, fn: fn, opts: opts || {} }); }
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var fmt = function (v) { try { return typeof v === 'string' ? '"' + v + '"' : JSON.stringify(v); } catch (e) { return String(v); } };
  var A = {
    ok: function (c, m) { if (!c) throw new Error(m || 'se esperaba verdadero'); },
    eq: function (a, b, m) { if (a !== b) throw new Error((m ? m + ': ' : '') + 'esperado ' + fmt(b) + ', obtenido ' + fmt(a)); },
    near: function (a, b, eps, m) { if (!(Math.abs(a - b) <= eps)) throw new Error((m ? m + ': ' : '') + 'esperado ~' + b + ' (±' + eps + '), obtenido ' + a); },
    color: function (px, rgb, tol, m) {
      tol = tol === undefined ? 4 : tol;
      if (Math.abs(px[0] - rgb[0]) > tol || Math.abs(px[1] - rgb[1]) > tol || Math.abs(px[2] - rgb[2]) > tol) throw new Error((m ? m + ': ' : '') + 'color esperado ' + fmt(rgb) + ' obtenido ' + fmt(px.slice(0, 3)));
    },
    throws: function (fn, m) { var t = false; try { fn(); } catch (e) { t = true; } if (!t) throw new Error(m || 'se esperaba excepción'); },
    deep: function (a, b, m) { var x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m ? m + ': ' : '') + 'esperado ' + y + ' obtenido ' + x); }
  };

  /* ---------------- UI ---------------- */
  var elSuites = document.getElementById('suites'), elSummary = document.getElementById('summary'), elStatus = document.getElementById('status');
  function card(name) {
    var c = document.createElement('section'); c.className = 'suite';
    var h = document.createElement('h2'); var t = document.createElement('div'); t.textContent = name; var sp = document.createElement('span'); h.appendChild(t); h.appendChild(sp);
    c.appendChild(h); elSuites.appendChild(c);
    return { el: c, count: sp };
  }
  function row(parent, name) {
    var r = document.createElement('div'); r.className = 't run';
    var s = document.createElement('span'); s.className = 's'; s.textContent = '…';
    var n = document.createElement('span'); n.textContent = name;
    r.appendChild(s); r.appendChild(n); parent.appendChild(r);
    return {
      ok: function (info) { r.className = 't ok'; s.textContent = '✓'; if (info) { var i = document.createElement('span'); i.className = 'info'; i.textContent = info; r.appendChild(i); } },
      fail: function (msg) { r.className = 't fail'; s.textContent = '✗'; var m = document.createElement('div'); m.className = 'msg'; m.textContent = msg; n.appendChild(document.createElement('br')); n.appendChild(m); },
      skip: function (msg) { r.className = 't skip'; s.textContent = '–'; var i = document.createElement('span'); i.className = 'info'; i.textContent = msg || 'omitido'; r.appendChild(i); }
    };
  }
  function summary() {
    elSummary.textContent = '';
    [['Pasadas', R.passed, 'ok'], ['Fallidas', R.failed, 'fail'], ['Omitidas', R.skipped, ''], ['Backends', R.backends.join(', ') || '—', '']].forEach(function (p) {
      var d = document.createElement('div'); d.className = 'pill ' + p[2];
      var n = document.createElement('div'); n.className = 'n'; n.textContent = p[1];
      var l = document.createElement('div'); l.textContent = p[0]; l.style.color = 'var(--muted)';
      d.appendChild(n); d.appendChild(l); elSummary.appendChild(d);
    });
  }

  /* ---------------- helpers de juego ---------------- */
  var stage = document.getElementById('stage');
  async function makeGame(kind, create, opts) {
    opts = opts || {};
    var cfg = Object.assign({
      width: opts.width || 64, height: opts.height || 64, renderer: [kind], parent: stage, scale: { mode: 'none' }, resolution: opts.resolution || 1,
      antialias: false, banner: false, autoStart: false, backgroundColor: opts.bg !== undefined ? opts.bg : 0x000000, audio: { noAudio: true }, loaderUI: false,
      physics: opts.physics, seed: 'test',
      scenes: [{ key: 'T', create: create || function () {}, preload: opts.preload || function () {} }]
    }, opts.config || {});
    var game = new UG.Game(cfg);
    await game.ready;
    game.loop.step(16);
    var sc = game.scene.getScene('T');
    for (var i = 0; i < 300 && sc.sys.status !== 'running'; i++) { await sleep(5); game.loop.step(16); }
    return game;
  }
  function loadImg(url) { return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { rej(new Error('snapshot inválido')); }; i.src = url; }); }
  async function grab(game) {
    var url = await game.snapshot();
    var img = await loadImg(url);
    var c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    var ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    var d = ctx.getImageData(0, 0, c.width, c.height);
    return { w: c.width, h: c.height, data: d.data, at: function (x, y) { var i = ((y | 0) * this.w + (x | 0)) * 4; return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]]; },
      count: function (fn) { var n = 0; for (var i = 0; i < this.data.length; i += 4) if (fn(this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3])) n++; return n; } };
  }
  async function renderTest(kind, setup, check, opts) {
    var g = await makeGame(kind, setup, opts);
    try {
      var steps = (opts && opts.steps) || 0;
      for (var i = 0; i < steps; i++) g.loop.step(16);
      var img = await grab(g);
      return await check(img, g, g.scene.getScene('T'));
    } finally { g.destroy(); }
  }
  function solid(scene, key, color, w, h) {
    if (scene.textures.exists(key)) return key;
    scene.textures.generate(key, w || 16, h || 16, function (ctx, W, H) { ctx.fillStyle = color; ctx.fillRect(0, 0, W, H); });
    return key;
  }

  /* ============================================================ UNITARIAS */
  suite('Núcleo: matemáticas, color, eventos', function (t) {
    t.test('Matrix inversa y composición', function () {
      var m = new UG.Matrix().setTransform(10, 20, 3, 4, 2, 3, 0.7, 0.1, 0.2);
      var p = m.apply(5, 7), q = m.applyInverse(p.x, p.y);
      A.near(q.x, 5, 1e-9); A.near(q.y, 7, 1e-9);
      var id = m.clone().append(m.clone().invert());
      A.near(id.a, 1, 1e-9); A.near(id.tx, 0, 1e-9);
    });
    t.test('Rectangle / Circle / Polygon', function () {
      var r = new UG.Rectangle(0, 0, 10, 10);
      A.ok(r.contains(5, 5) && !r.contains(10, 5)); A.ok(r.intersects(new UG.Rectangle(9, 9, 5, 5)));
      A.ok(new UG.Circle(0, 0, 5).contains(3, 3)); A.ok(!new UG.Circle(0, 0, 5).contains(4, 4));
      var p = new UG.Polygon([0, 0, 10, 0, 10, 10, 0, 10]); A.ok(p.contains(5, 5)); A.near(p.area, 100, 1e-9);
    });
    t.test('RNG determinista y sin sesgo', function () {
      var a = new UG.RNG('semilla'), b = new UG.RNG('semilla'), same = true;
      for (var i = 0; i < 2000; i++) if (a.next() !== b.next()) same = false;
      A.ok(same, 'misma semilla, misma secuencia');
      var r = new UG.RNG(7), h = [0, 0, 0, 0, 0, 0];
      for (var j = 0; j < 60000; j++) h[r.int(0, 5)]++;
      A.ok(h.every(function (x) { return x > 9400 && x < 10600; }), 'distribución ' + h);
      var st = r.getState(), v1 = r.float(); r.setState(st); A.eq(r.float(), v1, 'restaurar estado');
    });
    t.test('Easing: nombres flexibles', function () {
      A.eq(UG.Easing.get('Quad.easeOut'), UG.Easing.quadout); A.eq(UG.Easing.get('easeInOutBack'), UG.Easing.backinout);
      A.eq(UG.Easing.get('Power3'), UG.Easing.quartout); A.near(UG.Easing.get('bounceOut')(1), 1, 1e-9);
      UG.Easing.names.forEach(function (n) { var f = UG.Easing.get(n); A.near(f(0), 0, 1e-6, n); A.near(f(1), 1, 1e-6, n); });
    });
    t.test('Color: parseo y operaciones', function () {
      A.eq(UG.Color.toNumber('#ff8000'), 0xff8000); A.eq(UG.Color.toNumber('rgb(255, 128, 0)'), 0xff8000); A.eq(UG.Color.toNumber('orange'), 0xffa500);
      A.eq(UG.Color.toNumber('hsl(0, 100%, 50%)'), 0xff0000); A.near(UG.Color.alphaOf('rgba(0,0,0,0.25)'), 0.25, 1e-9);
      A.eq(UG.Color.lerp(0x000000, 0xffffff, 0.5), 0x7f7f7f); A.eq(UG.Color.multiply(0xff8040, 0x808080) >> 16, 0x80);
      A.eq(UG.Color.darken(0xffffff, 0.5), 0x808080); A.eq(UG.Color.darken(0x204060, 0), 0x204060);
    });
    t.test('EventEmitter: once, off durante emit, contexto', function () {
      var e = new UG.EventEmitter(), n = 0, ctx = { k: 5 };
      var f = function () { n++; e.off('x', f); };
      e.on('x', f); e.on('x', function () { n += 10; }); e.emit('x'); e.emit('x'); A.eq(n, 21);
      e.once('y', function () { n += this.k; }, ctx); e.emit('y'); e.emit('y'); A.eq(n, 26); A.eq(e.listenerCount('y'), 0);
      e.off(); A.eq(e.listenerCount(), 0);
    });
    t.test('Earcut: cóncavo y con agujero', function () {
      var area = function (pts, tr) { var s = 0; for (var i = 0; i < tr.length; i += 3) { var a = tr[i] * 2, b = tr[i + 1] * 2, c = tr[i + 2] * 2; s += Math.abs((pts[b] - pts[a]) * (pts[c + 1] - pts[a + 1]) - (pts[c] - pts[a]) * (pts[b + 1] - pts[a + 1])) / 2; } return s; };
      var p = [0, 0, 10, 0, 10, 10, 0, 10, 3, 3, 7, 3, 7, 7, 3, 7];
      A.near(area(p, UG.Earcut(p, [4])), 84, 1e-9);
    });
    t.test('Inflate zlib/gzip', function () {
      var d = TILED.zlib, g = TILED.gzip, raw = UG.Utils.base64ToBytes(TILED.raw);
      var z = UG.Inflate.zlib(UG.Utils.base64ToBytes(d)), gz = UG.Inflate.gzip(UG.Utils.base64ToBytes(g));
      A.eq(z.length, raw.length); A.eq(gz.length, raw.length);
      for (var i = 0; i < raw.length; i++) { if (z[i] !== raw[i] || gz[i] !== raw[i]) throw new Error('byte ' + i); }
    });
    t.test('SHA-256 e integridad (SRI)', async function () {
      A.eq(UG.Security.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
      if (crypto.subtle) { var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ultragame')); var hex = Array.from(new Uint8Array(buf)).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); A.eq(UG.Security.sha256('ultragame'), hex); }
      A.ok(UG.Security.verifyIntegrity('abc', 'sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0='));
      A.ok(!UG.Security.verifyIntegrity('abd', 'sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0='));
    });
  });

  suite('Seguridad', function (t) {
    t.test('Sin prototype pollution en safeMerge / Tiled props', function () {
      UG.Security.safeMerge({}, JSON.parse('{"__proto__":{"polluted":1},"a":{"constructor":{"prototype":{"p2":1}}}}'));
      var props = UG.TiledParser.props([{ name: '__proto__', type: 'string', value: 'x' }, { name: 'ok', type: 'int', value: '5' }]);
      A.eq(({}).polluted, undefined); A.eq(({}).p2, undefined); A.eq(props.ok, 5); A.ok(Object.getPrototypeOf(props) === null);
    });
    t.test('URLs peligrosas bloqueadas', function () {
      A.ok(!UG.Security.isSafeURL('javascript:alert(1)')); A.ok(!UG.Security.isSafeURL(' JaVaScRiPt:alert(1)')); A.ok(!UG.Security.isSafeURL('java\tscript:x'));
      A.ok(!UG.Security.isSafeURL('data:text/html,<script>x</script>')); A.ok(UG.Security.isSafeURL('data:image/png;base64,AAAA'));
      A.ok(UG.Security.isSafeURL('assets/a.png')); A.ok(UG.Security.isSafeURL('/x.json'));
      UG.Security.allowedOrigins = ['https://cdn.ejemplo.com'];
      A.ok(UG.Security.isSafeURL('https://cdn.ejemplo.com/a.png')); A.ok(!UG.Security.isSafeURL('https://malicioso.com/a.png'));
      UG.Security.allowedOrigins = null;
    });
    t.test('Texto de usuario saneado (bidi/control)', function () {
      A.eq(UG.Security.sanitizeText('ad‮min\u0000'), 'admin');
      A.eq(UG.Security.sanitizeText('x'.repeat(50), 10).length, 10);
    });
    t.test('Motor sin eval / Function / innerHTML', async function () {
      var src = await (await fetch('../dist/ultragame.js')).text();
      A.ok(!/\beval\s*\(/.test(src) && !/new\s+Function\s*\(/.test(src) && !/\.innerHTML\s*=/.test(src));
    });
    t.test('Mapa Tiled gigante rechazado (anti-DoS)', function () {
      A.throws(function () { UG.TiledParser.normalize({ width: 100000, height: 100000, tilewidth: 16, tileheight: 16, layers: [], tilesets: [] }); });
    });
    t.test('zip bomb limitada', function () {
      A.throws(function () { UG.Inflate.zlib(UG.Utils.base64ToBytes(TILED.zlib), 10); });
    });
    t.test('Addchild: ciclos detectados', function () {
      var a = new UG.Container(), b = new UG.Container(); a.addChild(b);
      A.throws(function () { b.addChild(a); }); A.throws(function () { a.addChild(a); });
      a.destroy();
    });
  });

  suite('Tweens y temporizadores', function (t) {
    function mgr() { return new UG.TweenManager(null); }
    function run(m, ms, step) { step = step || 16; for (var e = 0; e < ms; e += step) m.update(0, step); }
    t.test('Tween básico con ease y onComplete', function () {
      var m = mgr(), o = { x: 0 }, done = 0;
      m.add({ targets: o, x: 100, duration: 400, ease: 'linear', onComplete: function () { done++; } });
      run(m, 200); A.near(o.x, 50, 6); run(m, 400); A.eq(o.x, 100); A.eq(done, 1); A.eq(m.length, 0);
    });
    t.test('yoyo + repeat + hold', function () {
      var m = mgr(), o = { x: 0 }, reps = 0, yoyos = 0;
      m.add({ targets: o, x: 10, duration: 100, yoyo: true, hold: 50, repeat: 1, onRepeat: function () { reps++; }, onYoyo: function () { yoyos++; } });
      run(m, 1000, 10); A.eq(o.x, 0); A.eq(reps, 1); A.eq(yoyos, 2);
    });
    t.test('valores relativos, from y color', function () {
      var m = mgr(), o = { x: 10, y: 5, tint: 0x000000 };
      m.add({ targets: o, x: '+=20', y: { from: 100, to: 0 }, tint: 0xff0000, duration: 100 });
      A.eq(o.y, 100, 'from aplicado al crear'); run(m, 200); A.eq(o.x, 30); A.eq(o.y, 0); A.eq(o.tint, 0xff0000);
    });
    t.test('stagger y múltiples objetivos', function () {
      var m = mgr(), objs = [{ a: 0 }, { a: 0 }, { a: 0 }];
      m.add({ targets: objs, a: 1, duration: 100, delay: m.stagger(100) });
      run(m, 150); A.ok(objs[0].a === 1 && objs[1].a > 0 && objs[1].a < 1 && objs[2].a === 0, JSON.stringify(objs));
      run(m, 300); A.ok(objs.every(function (o) { return o.a === 1; }));
    });
    t.test('chain (timeline) y promesa finished', async function () {
      var m = mgr(), o = { x: 0, y: 0 }, order = [];
      var ch = m.chain({ targets: o, tweens: [{ x: 10, duration: 50, onComplete: function () { order.push('x'); } }, { y: 10, duration: 50, onComplete: function () { order.push('y'); } }] });
      var resolved = false; ch.finished.then(function () { resolved = true; });
      run(m, 200); await sleep(0);
      A.deep(order, ['x', 'y']); A.ok(resolved); A.eq(o.x, 10); A.eq(o.y, 10);
    });
    t.test('objetivo destruido detiene el tween (sin fugas)', function () {
      var m = mgr(), s = new UG.Container(), before = UG.Debug.live.Tween || 0;
      m.add({ targets: s, x: 100, duration: 1000, repeat: -1 });
      run(m, 50); s.destroy(); run(m, 50);
      A.eq(m.length, 0); A.eq(UG.Debug.live.Tween || 0, before);
    });
    t.test('killTweensOf y addCounter', function () {
      var m = mgr(), o = { v: 0 }, vals = [];
      m.add({ targets: o, v: 1, duration: 100 }); m.killTweensOf(o); run(m, 200); A.eq(o.v, 0);
      var c = m.addCounter({ from: 0, to: 10, duration: 100, onUpdate: function (tw) { vals.push(tw.getValue()); } }); run(m, 200);
      A.eq(vals[vals.length - 1], 10); A.ok(c.isFinished);
    });
    t.test('Clock: delayedCall, loop, repeat, remove', function () {
      var c = new UG.Clock(null), n = 0, l = 0, r = 0;
      c.delayedCall(100, function () { n++; });
      var ev = c.addEvent({ delay: 50, loop: true, callback: function () { l++; } });
      c.addEvent({ delay: 30, repeat: 2, callback: function () { r++; } });
      for (var i = 0; i < 20; i++) c.update(0, 10);
      A.eq(n, 1); A.eq(l, 4); A.eq(r, 3);
      c.removeEvent(ev); for (var j = 0; j < 20; j++) c.update(0, 10); A.eq(l, 4);
      c.shutdown(); A.eq(c.events.length, 0);
    });
  });

  suite('Física Arcade', function (t) {
    function world(g) { var w = new UG.ArcadeWorld({ game: { width: 800, height: 600 }, world: null }, { gravity: { x: 0, y: g === undefined ? 1000 : g } }); return w; }
    function box(w, x, y, size, isStatic) { var z = new UG.Zone(x, y, size, size); w.enable(z, isStatic); return z; }
    function sim(w, frames) { for (var i = 0; i < frames; i++) w.update(0, 1000 / 60); }
    t.test('Gravedad y aterrizaje sobre estático', function () {
      var w = world(), a = box(w, 100, 100, 20), floor = box(w, 100, 300, 40, true); floor.body.setSize(400, 40);
      w.collider(a, floor);
      sim(w, 120);
      A.near(a.body.bottom, floor.body.top, 0.5, 'apoyado'); A.ok(a.body.blocked.down, 'blocked.down'); A.near(a.body.velocity.y, 0, 20);
    });
    t.test('world.wrap: envoltura de pantalla (objeto, array y grupo)', function () {
      var w = world(0); w.setBounds(0, 0, 800, 600);
      var a = box(w, -30, 300, 10), b = box(w, 850, 650, 10), c = box(w, 400, -5, 10), d = box(w, 400, 300, 10);
      w.wrap(a, 10); A.near(a.x, 790, 1e-9, 'izquierda -> derecha');
      w.wrap([b, c], 10); A.near(b.x, 30, 1e-9); A.near(b.y, 30, 1e-9); A.near(c.y, -5, 1e-9, 'dentro del margen no cambia');
      var grp = new UG.Group(null, {}); grp.add(c); grp.add(d); w.wrap(grp); A.near(c.y, 595, 1e-9, 'grupo'); A.near(d.x, 400, 1e-9); A.near(d.y, 300, 1e-9);
      sim(w, 1); A.ok(a.body.x > 700 && a.body.x < 800, 'el cuerpo sigue al objeto envuelto ' + a.body.x);
    });
    t.test('Rebote con bounce', function () {
      var w = world(), a = box(w, 100, 100, 20), floor = box(w, 100, 300, 40, true); floor.body.setSize(400, 40);
      a.body.setBounce(0.8); var maxUp = 0; w.collider(a, floor);
      for (var i = 0; i < 200; i++) { w.update(0, 1000 / 60); if (a.body.velocity.y < maxUp) maxUp = a.body.velocity.y; }
      A.ok(maxUp < -300, 'rebotó hacia arriba ' + maxUp);
    });
    t.test('Choque elástico de masas iguales (intercambio de velocidad)', function () {
      var w = world(0), a = box(w, 100, 100, 20), b = box(w, 200, 100, 20);
      a.body.setVelocity(300, 0); b.body.setVelocity(0, 0); a.body.setBounce(1); b.body.setBounce(1);
      w.collider(a, b); sim(w, 30);
      A.ok(a.body.velocity.x < 20 && b.body.velocity.x > 280, 'va=' + a.body.velocity.x + ' vb=' + b.body.velocity.x);
    });
    t.test('Círculos se separan', function () {
      var w = world(0), a = box(w, 100, 100, 20), b = box(w, 110, 100, 20);
      a.body.setCircle(10); b.body.setCircle(10); w.collider(a, b); sim(w, 2);
      var dx = b.body.centerX - a.body.centerX, dy = b.body.centerY - a.body.centerY;
      A.ok(Math.sqrt(dx * dx + dy * dy) >= 19.9, 'distancia ' + Math.sqrt(dx * dx + dy * dy));
    });
    t.test('Grupo vs grupo con broadphase (sin pares duplicados)', function () {
      var w = world(0), g = new UG.Group(null, {}), hits = 0;
      for (var i = 0; i < 40; i++) { var z = new UG.Zone(i * 30, 0, 20, 20); w.enable(z); g.add(z, false); }
      for (var j = 0; j < 40; j++) { var z2 = new UG.Zone(j * 30 + 5, 0, 20, 20); w.enable(z2); g.add(z2, false); }
      w.overlap(g, g, function () { hits++; });
      w.step(1 / 60); hits = 0; w.overlap(g, g, function () { hits++; });
      A.eq(hits, 40, 'pares únicos');
    });
    function tileLayer(csv, w, h) {
      var map = UG.TiledParser.normalize({ width: w, height: h, tilewidth: 16, tileheight: 16, orientation: 'orthogonal',
        tilesets: [{ firstgid: 1, name: 't', tilewidth: 16, tileheight: 16, tilecount: 4, columns: 2, imagewidth: 32, imageheight: 32 }],
        layers: [{ type: 'tilelayer', name: 'L', width: w, height: h, data: csv }] });
      var fakeScene = { game: { cache: { tilemap: new Map() }, textures: new UG.TextureManager(null) }, textures: new UG.TextureManager(null), world: new UG.Container() };
      var tm = new UG.Tilemap(fakeScene, map), layer = new UG.TilemapLayer(tm, map.layers[0]);
      layer.setCollision([1, 2]);
      return layer;
    }
    t.test('Tiles: aterrizar y caminar sin engancharse en bordes internos', function () {
      var W = 20, H = 10, data = []; for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) data.push(y === 8 ? 1 : 0);
      var layer = tileLayer(data, W, H), w = world(), p = box(w, 40, 60, 14);
      w.collider(p, layer); sim(w, 90);
      A.near(p.body.bottom, 8 * 16, 0.5, 'sobre el suelo'); A.ok(p.body.onFloor());
      p.body.setVelocityX(200); var x0 = p.x; sim(w, 40);
      A.ok(p.x - x0 > 120, 'avanzó ' + (p.x - x0)); A.near(p.body.bottom, 8 * 16, 0.5);
    });
    t.test('Tiles: pared detiene al cuerpo', function () {
      var W = 20, H = 10, data = []; for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) data.push(y === 8 || (x === 10 && y >= 5) ? 1 : 0);
      var layer = tileLayer(data, W, H), w = world(), p = box(w, 60, 100, 14);
      w.collider(p, layer); sim(w, 60); p.body.setVelocityX(300);
      for (var i = 0; i < 90; i++) { p.body.velocity.x = 300; w.update(0, 1000 / 60); }
      A.near(p.body.right, 160, 0.5, 'tope pared'); A.ok(p.body.blocked.right);
    });
    t.test('Tiles: bala rápida no atraviesa (tunneling)', function () {
      var W = 40, H = 5, data = []; for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) data.push(x === 20 ? 1 : 0);
      var layer = tileLayer(data, W, H), w = world(0), b = box(w, 20, 40, 4);
      b.body.setVelocityX(3000); w.collider(b, layer); sim(w, 30);
      A.ok(b.body.right <= 320.5, 'bala detenida en x=' + b.body.right);
    });
    t.test('Tiles: plataforma de un sentido', function () {
      var W = 10, H = 12, data = []; for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) data.push(y === 5 ? 2 : (y === 11 ? 1 : 0));
      var layer = tileLayer(data, W, H); layer.setOneWayCollision(2);
      var w = world(), p = box(w, 50, 150, 12); w.collider(p, layer);
      sim(w, 60); A.near(p.body.bottom, 176, 0.6, 'en el suelo');
      p.body.setVelocityY(-700); sim(w, 130);
      A.near(p.body.bottom, 80, 0.6, 'atravesó desde abajo y quedó sobre la plataforma (bottom=' + p.body.bottom + ')');
    });
    t.test('Raycast DDA contra tiles', function () {
      var W = 20, H = 5, data = []; for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) data.push(x === 12 ? 1 : 0);
      var layer = tileLayer(data, W, H), w = world(0), hit = w.raycastTiles(layer, 8, 40, 300, 40);
      A.ok(hit && hit.tileX === 12, JSON.stringify(hit)); A.near(hit.x, 192, 0.01);
    });
  });

  suite('Tiled (TMJ/TMX)', function (t) {
    var base = { width: 6, height: 4, tilewidth: 8, tileheight: 8, orientation: 'orthogonal', tilesets: [{ firstgid: 1, name: 'ts', tilewidth: 8, tileheight: 8, tilecount: 4, columns: 2, imagewidth: 16, imageheight: 16, tiles: [{ id: 0, properties: [{ name: 'solid', type: 'bool', value: true }], animation: [{ tileid: 0, duration: 100 }, { tileid: 1, duration: 100 }] }] }] };
    function mk(layer) { return UG.TiledParser.normalize(Object.assign({}, base, { layers: [Object.assign({ type: 'tilelayer', name: 'L', width: 6, height: 4 }, layer)] })); }
    t.test('CSV (array)', function () { var m = mk({ data: TILED.gids }); A.deep(Array.from(m.layers[0].data), TILED.gids); });
    t.test('base64 sin comprimir', function () { var m = mk({ data: TILED.raw, encoding: 'base64' }); A.deep(Array.from(m.layers[0].data), TILED.gids); });
    t.test('base64 + zlib', function () { var m = mk({ data: TILED.zlib, encoding: 'base64', compression: 'zlib' }); A.deep(Array.from(m.layers[0].data), TILED.gids); });
    t.test('base64 + gzip', function () { var m = mk({ data: TILED.gzip, encoding: 'base64', compression: 'gzip' }); A.deep(Array.from(m.layers[0].data), TILED.gids); });
    t.test('Flags de volteo', function () { var m = mk({ data: TILED.gids }); var g = m.layers[0].data[8]; A.eq(g & UG.TiledParser.GID_MASK, 2); A.ok((g & UG.TiledParser.FLIP_H) !== 0); });
    t.test('Mapa infinito (chunks)', function () {
      var m = UG.TiledParser.normalize(Object.assign({}, base, { infinite: true, layers: [{ type: 'tilelayer', name: 'I', chunks: [{ x: -16, y: 0, width: 16, height: 1, data: new Array(16).fill(1) }, { x: 0, y: 0, width: 16, height: 1, data: new Array(16).fill(2) }] }] }));
      var l = m.layers[0]; A.eq(l.width, 32); A.eq(l.startX, -16); A.eq(l.data[0], 1); A.eq(l.data[31], 2);
    });
    t.test('Grupos: offsets y opacidad acumulados', function () {
      var m = UG.TiledParser.normalize(Object.assign({}, base, { layers: [{ type: 'group', name: 'G', offsetx: 10, opacity: 0.5, layers: [{ type: 'tilelayer', name: 'L', width: 6, height: 4, data: TILED.gids, offsetx: 5, opacity: 0.5 }] }] }));
      var l = m.layers[0]; A.eq(l.name, 'G/L'); A.eq(l.offsetX, 15); A.near(l.opacity, 0.25, 1e-9);
    });
    t.test('Propiedades, animaciones y objetos', function () {
      var m = UG.TiledParser.normalize(Object.assign({}, base, { properties: [{ name: 'nivel', type: 'int', value: 3 }, { name: 'color', type: 'color', value: '#80ff0000' }], layers: [{ type: 'objectgroup', name: 'Obj', objects: [{ id: 1, name: 'spawn', type: 'player', x: 10, y: 20, width: 0, height: 0, point: true, properties: [{ name: 'hp', type: 'int', value: 5 }] }, { id: 2, name: 'poly', x: 0, y: 0, polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }] }] }] }));
      A.eq(m.properties.nivel, 3); A.eq(m.properties.color.color, 0xff0000); A.near(m.properties.color.alpha, 128 / 255, 0.01);
      A.eq(m.tilesets[0].tiles[0].properties.solid, true); A.eq(m.tilesets[0].tiles[0].animation.length, 2);
      var o = m.layers[0].objects; A.eq(o[0].type, 'player'); A.eq(o[0].properties.hp, 5); A.eq(o[1].polygon.length, 3);
    });
    t.test('TMX XML (csv + objetos + tileset embebido)', function () {
      var xml = '<?xml version="1.0"?><map version="1.10" orientation="orthogonal" width="3" height="2" tilewidth="8" tileheight="8"><properties><property name="dificultad" type="float" value="1.5"/></properties>' +
        '<tileset firstgid="1" name="ts" tilewidth="8" tileheight="8" tilecount="4" columns="2"><image source="ts.png" width="16" height="16"/><tile id="1"><properties><property name="lava" type="bool" value="true"/></properties></tile></tileset>' +
        '<layer id="1" name="Suelo" width="3" height="2"><data encoding="csv">1,2,0,\n0,1,1</data></layer>' +
        '<objectgroup id="2" name="Obj"><object id="1" name="a" type="coin" x="4" y="4" width="8" height="8"/><object id="2" name="b" x="0" y="0"><polyline points="0,0 5,5 10,0"/></object></objectgroup></map>';
      var raw = UG.TiledParser.fromTMX(UG.LoaderUtils.parseXML(xml)), m = UG.TiledParser.normalize(raw);
      A.deep(Array.from(m.layers[0].data), [1, 2, 0, 0, 1, 1]); A.eq(m.properties.dificultad, 1.5); A.eq(m.tilesets[0].tiles[0].properties.lava, true);
      A.eq(m.layers[1].objects[0].type, 'coin'); A.eq(m.layers[1].objects[1].polyline.length, 3); A.eq(m.tilesets[0].image, 'ts.png');
    });
    t.test('TMX base64+zlib', function () {
      var xml = '<map orientation="orthogonal" width="6" height="4" tilewidth="8" tileheight="8"><tileset firstgid="1" name="ts" tilewidth="8" tileheight="8" tilecount="4" columns="2"/><layer name="L" width="6" height="4"><data encoding="base64" compression="zlib">' + TILED.zlib + '</data></layer></map>';
      var m = UG.TiledParser.normalize(UG.TiledParser.fromTMX(UG.LoaderUtils.parseXML(xml))); A.deep(Array.from(m.layers[0].data), TILED.gids);
    });
  });

  suite('Audio: sintetizador y música', function (t) {
    t.test('Sfx presets deterministas y normalizados', function () {
      UG.Sfx.presetNames.forEach(function (n) {
        var a = UG.Sfx.generate(UG.Sfx.preset(n, 3)), b = UG.Sfx.generate(UG.Sfx.preset(n, 3));
        A.ok(a.length > 100, n + ' longitud'); var peak = 0, diff = 0;
        for (var i = 0; i < a.length; i++) { peak = Math.max(peak, Math.abs(a[i])); if (a[i] !== b[i]) diff++; }
        A.ok(peak > 0.2 && peak <= 1, n + ' pico ' + peak); A.eq(diff, 0, n + ' determinista');
      });
    });
    t.test('Music.render con notas, acordes y batería', function () {
      var r = UG.Music.render({ bpm: 140, tracks: [{ wave: 'square', notes: 'C4 E4 G4 C5+E5 - . A3 .' }, { drums: true, notes: 'k . s . h h s .' }] });
      A.ok(r.channels[0].length > 44100 * 0.5); var peak = 0; r.channels[0].forEach(function (v) { peak = Math.max(peak, Math.abs(v)); });
      A.ok(peak > 0.1 && peak <= 0.951, 'pico ' + peak); A.near(UG.Music.noteToFreq('A4'), 440, 1e-9); A.near(UG.Music.noteToFreq('C#5'), 554.365, 0.01);
    });
  });

  suite('GIF, texto y utilidades', function (t) {
    t.test('GifEncoder genera un GIF válido decodificable', async function () {
      var w = 40, h = 30, enc = new UG.GifEncoder(w, h, { delay: 100 });
      for (var f = 0; f < 3; f++) { var d = new Uint8ClampedArray(w * h * 4); for (var i = 0; i < w * h; i++) { d[i * 4] = (i * 7 + f * 40) & 255; d[i * 4 + 1] = (i * 3) & 255; d[i * 4 + 2] = f * 80; d[i * 4 + 3] = 255; } enc.addFrame(d); }
      var bytes = enc.finish(); A.eq(String.fromCharCode.apply(null, bytes.subarray(0, 6)), 'GIF89a'); A.eq(bytes[bytes.length - 1], 0x3b);
      var url = URL.createObjectURL(new Blob([bytes], { type: 'image/gif' })), img = await loadImg(url); URL.revokeObjectURL(url);
      A.eq(img.naturalWidth, w); A.eq(img.naturalHeight, h);
    });
    t.test('Ajuste de línea (wordWrap) y breakWords', function () {
      var tx = new UG.Text(0, 0, 'hola mundo desde ultragame con ajuste', { fontSize: 20, wordWrap: true, wordWrapWidth: 120 });
      tx.updateText(1); A.ok(tx.lines.length >= 3, 'líneas ' + tx.lines.length);
      var tx2 = new UG.Text(0, 0, 'supercalifragilisticoespialidoso', { fontSize: 20, wordWrap: true, wordWrapWidth: 80, breakWords: true });
      tx2.updateText(1); A.ok(tx2.lines.length >= 3); tx.destroy(); tx2.destroy();
    });
    t.test('hashState determinista', function () {
      A.eq(UG.Debug.hashState({ b: 1, a: [1, 2, { c: 0.1 + 0.2 }] }), UG.Debug.hashState({ a: [1, 2, { c: 0.3 }], b: 1 }));
    });
  });

  suite('UltraCore (WebAssembly SIMD)', function (t) {
    t.test('Inicializa el núcleo y valida SIMD', async function () {
      var ok = await UG.Wasm.init();
      if (!ok) return 'sin WASM SIMD: ' + UG.Wasm.error;
      A.ok(UG.Wasm.ready && UG.Wasm.simd); return 'memoria ' + (UG.Wasm.memory.buffer.byteLength / 1024) + ' KB';
    });
    function pair(n) {
      var cfg = function () { return { x: 0, y: 0, speed: { min: 50, max: 150 }, lifespan: 5000, frequency: -1, gravityY: 300, drag: 0.5, maxParticles: n, rng: new UG.RNG('same') }; };
      var a = new UG.ParticleEmitter(UG.Texture.WHITE, cfg()), b = new UG.ParticleEmitter(UG.Texture.WHITE, cfg());
      return { js: a, wasm: b };
    }
    t.test('WASM y JS producen la misma simulación', async function () {
      if (!(await UG.Wasm.init())) return 'sin WASM SIMD';
      var p = pair(4000); UG.Wasm.attachEmitter(p.wasm); A.ok(p.wasm.usingWasm);
      p.js.explode(4000, 10, 10); p.wasm.explode(4000, 10, 10);
      for (var i = 0; i < 120; i++) { p.js.update(16); p.wasm.update(16); }
      A.eq(p.js.count, p.wasm.count, 'mismas vivas');
      var maxErr = 0; for (var k = 0; k < p.js.count; k++) maxErr = Math.max(maxErr, Math.abs(p.js.px[k] - p.wasm.px[k]), Math.abs(p.js.py[k] - p.wasm.py[k]));
      A.ok(maxErr < 0.05, 'error máx ' + maxErr);
      p.js.destroy(); p.wasm.destroy();
      return 'error máx ' + maxErr.toExponential(2) + ' px tras 120 pasos';
    });
    t.test('Crecimiento de memoria reasigna vistas sin romper datos', async function () {
      if (!(await UG.Wasm.init())) return 'sin WASM SIMD';
      var p = pair(1000); UG.Wasm.attachEmitter(p.wasm); p.wasm.explode(1000, 5, 5); p.wasm.update(16);
      var before = p.wasm.px[10], big = UG.Wasm.alloc(8 * 1024 * 1024);
      p.wasm.update(0.0001); A.ok(Math.abs(p.wasm.px[10] - before) < 1, 'dato preservado tras grow'); UG.Wasm.release(big);
      p.js.destroy(); p.wasm.destroy();
    });
    t.test('Benchmark: 200.000 partículas (actualización)', async function () {
      if (!(await UG.Wasm.init())) return 'sin WASM SIMD';
      var p = pair(200000); UG.Wasm.attachEmitter(p.wasm); p.js.explode(200000); p.wasm.explode(200000);
      var bench = function (e) { for (var w = 0; w < 5; w++) e.update(16); var t0 = performance.now(); for (var i = 0; i < 30; i++) e.update(16); return (performance.now() - t0) / 30; };
      var tj = bench(p.js), tw = bench(p.wasm);
      R.bench.push({ backend: 'cpu', particlesUpdate: 200000, jsMs: +tj.toFixed(2), wasmMs: +tw.toFixed(2) });
      p.js.destroy(); p.wasm.destroy();
      return 'JS ' + tj.toFixed(2) + ' ms · WASM SIMD ' + tw.toFixed(2) + ' ms (x' + (tj / tw).toFixed(2) + ')';
    });
  });

  /* ============================================================ RENDER POR BACKEND */
  function renderSuite(kind, label, extraCfg) {
    var baseRT = renderTest, baseMG = makeGame;
    suite('Render · ' + (label || kind), function (t) {
      var canvasK = kind === 'canvas';
      var renderTest = function (k, setup, check, opts) { opts = Object.assign({}, opts || {}); opts.config = Object.assign({}, extraCfg || {}, opts.config || {}); return baseRT(k, setup, check, opts); };
      var makeGame = function (k, create, opts) { opts = Object.assign({}, opts || {}); opts.config = Object.assign({}, extraCfg || {}, opts.config || {}); return baseMG(k, create, opts); };
      t.test('color de fondo', function () { return renderTest(kind, null, function (img) { A.color(img.at(5, 5), [0x33, 0x66, 0x99], 2); }, { bg: 0x336699 }); });
      t.test('sprite + tint', function () {
        return renderTest(kind, function () { this.add.sprite(32, 32, '__WHITE').setDisplaySize(20, 20).setTint(0xff0000); }, function (img) { A.color(img.at(32, 32), [255, 0, 0]); A.color(img.at(5, 5), [0, 0, 0]); A.color(img.at(23, 32), [255, 0, 0]); A.color(img.at(21, 32), [0, 0, 0]); });
      });
      t.test('alpha premultiplicado', function () { return renderTest(kind, function () { this.add.sprite(32, 32, '__WHITE').setDisplaySize(64, 64).setAlpha(0.5); }, function (img) { A.color(img.at(32, 32), [128, 128, 128], 3); }); });
      t.test('blend add', function () { return renderTest(kind, function () { this.add.sprite(32, 32, '__WHITE').setDisplaySize(64, 64).setTint(0x404040).setBlendMode('add'); }, function (img) { A.color(img.at(32, 32), [128, 128, 128], 3); }, { bg: 0x404040 }); });
      t.test('blend multiply', function () { return renderTest(kind, function () { this.add.sprite(32, 32, '__WHITE').setDisplaySize(64, 64).setTint(0xff0000).setBlendMode('multiply'); }, function (img) { A.color(img.at(32, 32), [128, 0, 0], 3); }, { bg: 0x808080 }); });
      t.test('blend screen', function () { return renderTest(kind, function () { this.add.sprite(32, 32, '__WHITE').setDisplaySize(64, 64).setTint(0x808080).setBlendMode('screen'); }, function (img) { A.color(img.at(32, 32), [192, 192, 192], 3); }, { bg: 0x808080 }); });
      t.test('Graphics: rect y círculo', function () {
        return renderTest(kind, function () { this.add.graphics().fillStyle(0xff0000).fillRect(8, 8, 16, 16).fillStyle(0x00ff00).fillCircle(44, 44, 10); }, function (img) {
          A.color(img.at(16, 16), [255, 0, 0]); A.color(img.at(44, 44), [0, 255, 0]); A.color(img.at(36, 36), [0, 0, 0]); A.color(img.at(56, 56), [0, 0, 0]);
        });
      });
      t.test('Trazo semitransparente sin repintado en uniones (miter)', function () {
        return renderTest(kind, function () { this.add.graphics().lineStyle({ width: 8, color: 0xffffff, alpha: 0.5, join: 'miter' }).strokePoints([{ x: 8, y: 40 }, { x: 32, y: 16 }, { x: 56, y: 40 }], false); }, function (img) {
          var mid = img.at(20, 28)[0], join = img.at(32, 18)[0];
          A.near(mid, 128, 6, 'mitad del segmento'); A.near(join, mid, 6, 'unión (sin doble mezcla)');
        });
      });
      t.test('Trazo con unión redonda sin repintado', function () {
        return renderTest(kind, function () { this.add.graphics().lineStyle({ width: 10, color: 0xffffff, alpha: 0.5, join: 'round', cap: 'round' }).strokePoints([{ x: 8, y: 50 }, { x: 32, y: 14 }, { x: 56, y: 50 }], false); }, function (img) {
          var mid = img.at(20, 32)[0], join = img.at(32, 14)[0], cap = img.at(6, 51)[0];
          A.near(mid, 128, 6); A.near(join, mid, 6, 'unión'); A.near(cap, mid, 8, 'remate redondo');
        });
      });
      t.test('Trazo cerrado sin huecos en las esquinas', function () {
        return renderTest(kind, function () { this.add.graphics().lineStyle({ width: 6, color: 0xffffff, alpha: 0.5, join: 'miter' }).strokeRect(12, 12, 40, 40); }, function (img) {
          [[10, 10], [53, 10], [53, 53], [10, 53], [12, 30], [30, 12]].forEach(function (p) { A.near(img.at(p[0], p[1])[0], 128, 7, 'esquina/borde ' + p); });
          A.color(img.at(32, 32), [0, 0, 0], 2, 'interior vacío');
        });
      });
      t.test('Texto renderizado', function () {
        return renderTest(kind, function () { this.add.text(2, 16, 'HOLA', { fontSize: 22, fontWeight: 'bold', fill: 0xffffff }); }, function (img) { var n = img.count(function (r) { return r > 200; }); A.ok(n > 40, 'píxeles de texto ' + n); });
      });
      t.test('Herencia de tint y alpha en contenedores', function () {
        return renderTest(kind, function () { var c = this.add.container(0, 0).setTint(0x00ff00).setAlpha(0.5); c.add(new UG.Sprite(32, 32, UG.Texture.WHITE).setDisplaySize(64, 64)); }, function (img) { A.color(img.at(32, 32), [0, 128, 0], 3); });
      });
      t.test('Recorte clipRect', function () {
        return renderTest(kind, function () { var c = this.add.container(0, 0).setClip(0, 0, 32, 64); c.add(new UG.Sprite(32, 32, UG.Texture.WHITE).setDisplaySize(64, 64)); }, function (img) { A.color(img.at(16, 32), [255, 255, 255]); A.color(img.at(48, 32), [0, 0, 0]); });
      });
      t.test('Máscara con Graphics (normal e invertida)', async function () {
        await renderTest(kind, function () { var s = this.add.sprite(32, 32, '__WHITE').setDisplaySize(64, 64); var m = new UG.Graphics().fillStyle(0xffffff).fillCircle(32, 32, 16); s.mask = m; }, function (img) { A.color(img.at(32, 32), [255, 255, 255], 3); A.color(img.at(4, 4), [0, 0, 0], 3); });
        await renderTest(kind, function () { var s = this.add.sprite(32, 32, '__WHITE').setDisplaySize(64, 64); var m = new UG.Graphics().fillStyle(0xffffff).fillCircle(32, 32, 16); s.mask = m; s.maskInvert = true; }, function (img) { A.color(img.at(32, 32), [0, 0, 0], 3); A.color(img.at(4, 4), [255, 255, 255], 3); });
      });
      t.test('Profundidad (depth / zIndex)', function () {
        return renderTest(kind, function () { this.add.sprite(32, 32, '__WHITE').setDisplaySize(30, 30).setTint(0xff0000).setDepth(2); this.add.sprite(32, 32, '__WHITE').setDisplaySize(30, 30).setTint(0x0000ff).setDepth(1); }, function (img) { A.color(img.at(32, 32), [255, 0, 0]); });
      });
      t.test('flipX con textura asimétrica', function () {
        return renderTest(kind, function () {
          this.textures.generate('half', 16, 8, function (c) { c.fillStyle = '#ff0000'; c.fillRect(0, 0, 8, 8); c.fillStyle = '#0000ff'; c.fillRect(8, 0, 8, 8); }, { scaleMode: 'nearest' });
          this.add.sprite(32, 32, 'half').setScale(3).setFlipX(true);
        }, function (img) { A.color(img.at(14, 32), [0, 0, 255], 6); A.color(img.at(50, 32), [255, 0, 0], 6); });
      });
      t.test('fillGradientStyle no hereda el alfa del fillStyle anterior', function () {
        return renderTest(kind, function () {
          var g = this.add.graphics();
          g.fillStyle(0x000000, 0.25).fillRect(0, 0, 64, 16);
          g.fillGradientStyle(0xff0000, 0xff0000, 0xff0000, 0xff0000, 1).fillRect(0, 20, 64, 20);
          g.fillGradientStyle(0x00ff00, 0x00ff00, 0x00ff00, 0x00ff00, 0.5).fillRect(0, 44, 64, 20);
        }, function (img) { A.color(img.at(32, 30), [255, 0, 0], 4, 'opaco'); A.color(img.at(32, 54), [0, 128, 0], 6, 'alfa propio 0.5'); });
      });
      t.test('flipX/flipY con origen 0,0 voltea dentro de sus límites (como Phaser)', function () {
        var spr;
        return renderTest(kind, function () {
          this.textures.generate('quad4', 16, 16, function (c) { c.fillStyle = '#ff0000'; c.fillRect(0, 0, 8, 8); c.fillStyle = '#00ff00'; c.fillRect(8, 0, 8, 8); c.fillStyle = '#0000ff'; c.fillRect(0, 8, 8, 8); c.fillStyle = '#ffffff'; c.fillRect(8, 8, 8, 8); }, { scaleMode: 'nearest' });
          spr = this.add.sprite(8, 8, 'quad4').setOrigin(0, 0).setScale(3).setFlip(true, true);
        }, function (img) {
          // el sprite sigue ocupando 8..56; con doble volteo el cuadrante blanco pasa arriba a la izquierda
          A.color(img.at(14, 14), [255, 255, 255], 6); A.color(img.at(50, 14), [0, 0, 255], 6); A.color(img.at(14, 50), [0, 255, 0], 6); A.color(img.at(50, 50), [255, 0, 0], 6);
          A.color(img.at(4, 4), [0, 0, 0], 6, 'nada fuera de los límites');
          var b = spr.getBounds(); A.near(b.x, 8, 0.01); A.near(b.y, 8, 0.01); A.near(b.width, 48, 0.01);
          A.ok(spr.hitTestLocal(2, 2) && !spr.hitTestLocal(-2, 2), 'hit-test sin cambios');
        });
      });
      t.test('TilingSprite repite la textura', function () {
        return renderTest(kind, function () {
          this.textures.generate('stripe', 8, 8, function (c) { c.fillStyle = '#ff0000'; c.fillRect(0, 0, 4, 8); c.fillStyle = '#0000ff'; c.fillRect(4, 0, 4, 8); }, { scaleMode: 'nearest' });
          this.add.tileSprite(32, 32, 64, 64, 'stripe');
        }, function (img) { A.color(img.at(1, 3), [255, 0, 0], 8); A.color(img.at(5, 3), [0, 0, 255], 8); A.color(img.at(9, 30), [255, 0, 0], 8); A.color(img.at(61, 50), [0, 0, 255], 8); });
      });
      t.test('NineSlice conserva bordes', function () {
        return renderTest(kind, function () {
          this.textures.generate('frame9', 30, 30, function (c) { c.fillStyle = '#ff0000'; c.fillRect(0, 0, 30, 30); c.fillStyle = '#0000ff'; c.fillRect(10, 10, 10, 10); }, { scaleMode: 'nearest' });
          this.add.nineSlice(32, 32, 'frame9', undefined, 60, 60, 10, 10, 10, 10);
        }, function (img) { A.color(img.at(5, 5), [255, 0, 0], 8); A.color(img.at(32, 32), [0, 0, 255], 8); A.color(img.at(32, 5), [255, 0, 0], 8); A.color(img.at(58, 32), [255, 0, 0], 8); });
      });
      t.test('Cámara: scroll, zoom y scrollFactor 0', async function () {
        await renderTest(kind, function () { this.add.sprite(100, 100, '__WHITE').setDisplaySize(8, 8).setTint(0xff0000); this.cameras.main.setScroll(80, 80); }, function (img) { A.color(img.at(20, 20), [255, 0, 0]); });
        await renderTest(kind, function () { this.add.sprite(32, 32, '__WHITE').setDisplaySize(8, 8).setTint(0xff0000); this.cameras.main.setZoom(2); }, function (img) { A.color(img.at(26, 32), [255, 0, 0]); A.color(img.at(20, 32), [0, 0, 0]); });
        await renderTest(kind, function () { this.add.sprite(10, 10, '__WHITE').setDisplaySize(8, 8).setTint(0x00ff00).setScrollFactor(0); this.cameras.main.setScroll(100, 100); }, function (img) { A.color(img.at(10, 10), [0, 255, 0]); });
      });
      t.test('Varias cámaras (viewport) y HUD', function () {
        return renderTest(kind, function () {
          this.cameras.main.setBackgroundColor(0x0000ff);
          var c2 = this.cameras.add(32, 0, 32, 64); c2.setBackgroundColor(0xff0000);
          this.add.hud.sprite(4, 60, '__WHITE').setDisplaySize(4, 4).setTint(0x00ff00);
          this.cameras.main.setScroll(500, 500);
        }, function (img) { A.color(img.at(16, 32), [0, 0, 255]); A.color(img.at(48, 32), [255, 0, 0]); A.color(img.at(4, 60), [0, 255, 0]); });
      });
      t.test('Culling automático', function () {
        return renderTest(kind, function () { for (var i = 0; i < 200; i++) this.add.sprite(1000 + i, 1000, '__WHITE'); }, function (img, g) { A.ok(g.renderer.stats.culled >= 200, 'culled ' + g.renderer.stats.culled); });
      });
      t.test('Partículas', function () {
        return renderTest(kind, function () { this.em = this.add.particles('__WHITE', { speed: 0, lifespan: 100000, scale: 3, frequency: -1 }); this.em.explode(40, 32, 32); }, function (img, g, s) { A.eq(s.em.count, 40); A.color(img.at(32, 32), [255, 255, 255], 4); });
      });
      t.test('BitmapText', function () {
        return renderTest(kind, function () { UG.BitmapFont.from('tfont', { fontSize: 20, fontWeight: 'bold', fill: 0xffffff }); this.add.bitmapText(2, 20, 'tfont', 'ABC 123'); }, function (img) { var n = img.count(function (r) { return r > 150; }); A.ok(n > 40, 'píxeles ' + n); });
      });
      t.test('Mesh y Rope', function () {
        return renderTest(kind, function () {
          this.add.mesh(0, 0, '__WHITE', undefined, [4, 4, 60, 4, 32, 60], [0, 0, 1, 0, 0.5, 1], [0, 1, 2]);
        }, function (img) { A.color(img.at(32, 20), [255, 255, 255], 6); A.color(img.at(4, 60), [0, 0, 0], 4); });
      });
      t.test('Tilemap: createLayer(nombre, x, y) y capa isométrica con worldToTileXY', function () {
        var L1, L2;
        return renderTest(kind, function () {
          this.textures.generate('tiles2', 16, 8, function (c) { c.fillStyle = '#ff0000'; c.fillRect(0, 0, 8, 8); c.fillStyle = '#00ff00'; c.fillRect(8, 0, 8, 8); }, { scaleMode: 'nearest' });
          var ts = [{ firstgid: 1, name: 'tiles2', tilewidth: 8, tileheight: 8, tilecount: 2, columns: 2, imagewidth: 16, imageheight: 8 }];
          var m1 = this.add.tilemap(UG.TiledParser.normalize({ width: 2, height: 1, tilewidth: 8, tileheight: 8, tilesets: ts, layers: [{ type: 'tilelayer', name: 'L', width: 2, height: 1, data: [1, 2] }] }));
          L1 = m1.createLayer('L', 40, 50);
          var m2 = this.add.tilemap(UG.TiledParser.normalize({ orientation: 'isometric', width: 2, height: 2, tilewidth: 16, tileheight: 8, tilesets: ts, layers: [{ type: 'tilelayer', name: 'I', width: 2, height: 2, data: [0, 0, 0, 0] }] }));
          L2 = m2.createLayer('I', 10, 20);
        }, function (img) {
          A.eq(L1.x, 40); A.eq(L1.y, 50, 'y no se pierde');
          A.color(img.at(44, 54), [255, 0, 0], 8, 'tile en (40,50)'); A.color(img.at(52, 54), [0, 255, 0], 8); A.color(img.at(44, 44), [0, 0, 0], 8, 'nada encima');
          // centro del rombo (1,0): x = 10 + (1-0)*8 + 2*8, y = 20 + (1+0)*4 + 4
          var t = L2.worldToTileXY(10 + 8 + 16, 20 + 4 + 4, true); A.eq(t.x, 1); A.eq(t.y, 0);
          var c = L2.tileToWorldXY(1, 1); A.near(c.x, 10 + 16 - 8, 1e-6); A.near(c.y, 20 + 8, 1e-6);
        });
      });
      t.test('Tilemap con volteos', function () {
        return renderTest(kind, function () {
          this.textures.generate('tiles', 16, 8, function (c) { c.fillStyle = '#ff0000'; c.fillRect(0, 0, 8, 8); c.fillStyle = '#00ff00'; c.fillRect(8, 0, 4, 8); c.fillStyle = '#0000ff'; c.fillRect(12, 0, 4, 8); }, { scaleMode: 'nearest' });
          var map = this.add.tilemap(UG.TiledParser.normalize({ width: 4, height: 2, tilewidth: 8, tileheight: 8, tilesets: [{ firstgid: 1, name: 'tiles', tilewidth: 8, tileheight: 8, tilecount: 2, columns: 2, imagewidth: 16, imageheight: 8 }],
            layers: [{ type: 'tilelayer', name: 'L', width: 4, height: 2, data: [1, 2, (2 | 0x80000000) >>> 0, 0, 0, 0, 0, 1] }] }));
          map.createLayer('L').setScale(2);
        }, function (img) {
          A.color(img.at(4, 4), [255, 0, 0], 8, 'tile 1'); A.color(img.at(18, 4), [0, 255, 0], 8, 'tile 2 izq'); A.color(img.at(30, 4), [0, 0, 255], 8, 'tile 2 der');
          A.color(img.at(34, 4), [0, 0, 255], 8, 'tile 2 volteado izq'); A.color(img.at(46, 4), [0, 255, 0], 8, 'tile 2 volteado der'); A.color(img.at(60, 24), [255, 0, 0], 8);
        });
      });
      t.test('RenderTexture dinámica', function () {
        return renderTest(kind, function () {
          var rt = this.add.renderTexture(32, 32, 64, 64);
          var s = new UG.Sprite(0, 0, UG.Texture.WHITE); s.setDisplaySize(16, 16); s.tint = 0xff00ff;
          rt.draw(s, 32, 32); rt.fill(0x00ff00, 1, 0, 0, 8, 8);
        }, function (img) { A.color(img.at(32, 32), [255, 0, 255], 4); A.color(img.at(3, 3), [0, 255, 0], 4); A.color(img.at(50, 50), [0, 0, 0], 4); });
      });
      t.test('cacheAsTexture equivale al render directo', function () {
        return renderTest(kind, function () {
          var c = this.add.container(0, 0); c.add(new UG.Graphics().fillStyle(0xffaa00).fillCircle(32, 32, 20)); c.cacheAsTexture = true;
        }, function (img) { A.color(img.at(32, 32), [255, 170, 0], 4); A.color(img.at(2, 2), [0, 0, 0], 3); });
      });
      t.test('Resolución 2x (nitidez retina)', function () {
        return renderTest(kind, function () { this.add.sprite(32, 32, '__WHITE').setDisplaySize(10, 10).setTint(0xff0000); }, function (img) { A.eq(img.w, 128); A.color(img.at(64, 64), [255, 0, 0]); A.color(img.at(52, 64), [0, 0, 0]); }, { resolution: 2 });
      });
      // ------- filtros -------
      var fsupport = !canvasK || document.createElement('canvas').getContext('2d').filter !== undefined;
      t.test('Filtro Grayscale', function () {
        if (!fsupport) return 'sin ctx.filter';
        return renderTest(kind, function () { var c = this.add.container(0, 0); c.add(new UG.Sprite(32, 32, UG.Texture.WHITE).setDisplaySize(40, 40).setTint(0xff0000)); c.filters = [new UG.GrayscaleFilter()]; }, function (img) { var p = img.at(32, 32); A.ok(Math.abs(p[0] - p[1]) < 12 && Math.abs(p[1] - p[2]) < 12 && p[0] > 30, 'gris ' + p); });
      });
      t.test('Filtro Invert (ColorMatrix.negative)', function () {
        if (!fsupport) return 'sin ctx.filter';
        return renderTest(kind, function () { var c = this.add.container(0, 0); c.add(new UG.Sprite(32, 32, UG.Texture.WHITE).setDisplaySize(40, 40).setTint(0xff0000)); c.filters = [new UG.InvertFilter()]; }, function (img) { A.color(img.at(32, 32), [0, 255, 255], 6); });
      });
      t.test('Filtro Blur difumina bordes', function () {
        if (!fsupport) return 'sin ctx.filter';
        return renderTest(kind, function () { var c = this.add.container(0, 0); c.add(new UG.Sprite(32, 32, UG.Texture.WHITE).setDisplaySize(16, 16)); c.filters = [new UG.BlurFilter(6)]; }, function (img) {
          var out = img.at(21, 32)[0], inn = img.at(32, 32)[0]; A.ok(out > 15, 'fuera del borde ' + out); A.ok(inn > 120, 'centro ' + inn);
        });
      });
      if (!canvasK) {
        t.test('Filtro Pixelate', function () {
          return renderTest(kind, function () { var g = this.add.graphics(); g.fillGradientStyle(0xff0000, 0x00ff00, 0x0000ff, 0xffffff, 1).fillRect(0, 0, 64, 64); g.filters = [new UG.PixelateFilter(8)]; }, function (img) { A.deep(img.at(8, 8), img.at(15, 15), 'mismo bloque'); A.ok(JSON.stringify(img.at(8, 8)) !== JSON.stringify(img.at(40, 40)), 'bloques distintos'); });
        });
        t.test('Viñeta: centro intacto, esquinas oscurecidas (independiente del aspecto)', function () {
          return renderTest(kind, function () { this.add.graphics().fillStyle(0xffffff, 1).fillRect(0, 0, 64, 64); this.cameras.main.setFilters([new UG.VignetteFilter({ radius: 0.4, softness: 0.5, strength: 1 })]); }, function (img) {
            A.color(img.at(32, 32), [255, 255, 255], 6, 'centro'); var c = img.at(1, 1); A.ok(c[0] < 40, 'esquina oscura ' + c[0]); var e = img.at(1, 32); A.ok(e[0] > 60 && e[0] < 250, 'borde a medias ' + e[0]);
          });
        });
        t.test('God rays: una escena oscura no se sobreexpone (umbral de luminancia)', function () {
          return renderTest(kind, function () { this.add.graphics().fillStyle(0x303030, 1).fillRect(0, 0, 64, 64).fillStyle(0xffffff, 1).fillCircle(32, 6, 10); this.cameras.main.setFilters([new UG.GodRaysFilter({ x: 32, y: 6, exposure: 0.5 })]); }, function (img) {
            var far = img.at(4, 60); A.ok(far[0] < 70, 'zona oscura sin quemar ' + far[0]); var ray = img.at(32, 24); A.ok(ray[0] > far[0] + 8, 'rayo bajo la luz ' + ray[0] + ' > ' + far[0]);
          });
        });
        t.test('Cadena de filtros + filtros de cámara', function () {
          return renderTest(kind, function () { var c = this.add.container(0, 0); c.add(new UG.Sprite(32, 32, UG.Texture.WHITE).setDisplaySize(40, 40).setTint(0xff0000)); c.filters = [new UG.InvertFilter(), new UG.GrayscaleFilter()]; this.cameras.main.setFilters([new UG.ColorOverlayFilter(0x0000ff, 1)]); }, function (img) { A.color(img.at(32, 32), [0, 0, 255], 6); });
        });
        t.test('Todos los filtros compilan y ejecutan', async function () {
          var names = Object.keys(UG.Filters), bad = [];
          var g = await makeGame(kind, function () {
            var c = this.add.container(0, 0);
            c.add(new UG.Graphics().fillStyle(0xff8800).fillCircle(32, 32, 16).fillStyle(0x3355ff).fillRect(4, 4, 20, 12));
            this.cont = c;
          });
          try {
            var s = g.scene.getScene('T');
            for (var i = 0; i < names.length; i++) {
              var F = UG.Filters[names[i]], f;
              try { f = new F(); } catch (e) { bad.push(names[i] + ' ctor: ' + e.message); continue; }
              s.cont.filters = [f];
              g.loop.step(16);
              var img = await grab(g);
              var n = img.count(function (r, gg, b) { return r + gg + b > 30; });
              if (n < 10) bad.push(names[i] + ' salida vacía');
            }
            await sleep(50);
          } finally { g.destroy(); }
          if (bad.length) throw new Error(bad.join('; '));
          return names.length + ' filtros';
        });
      }
    });
  }

  /* ============================================================ INTERACCIÓN / ESCENAS */
  function pointer(canvas, type, x, y, id) {
    var r = canvas.getBoundingClientRect();
    var ev = new PointerEvent(type, { clientX: r.left + x * r.width / 64, clientY: r.top + y * r.height / 64, pointerId: id || 1, pointerType: 'mouse', isPrimary: true, bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
    (type === 'pointerdown' ? canvas : window).dispatchEvent(ev);
  }
  suite('Entrada y escenas', function (t) {
    var K = null;
    t.test('Clic en sprite, tap, arrastre y hover', async function () {
      var g = await makeGame(K, function () {
        var s = this; this.log = [];
        this.box = this.add.sprite(20, 20, '__WHITE').setDisplaySize(16, 16).setInteractive({ draggable: true, cursor: 'pointer' });
        this.box.on('pointerdown', function () { s.log.push('down'); }); this.box.on('pointertap', function () { s.log.push('tap'); });
        this.box.on('pointerover', function () { s.log.push('over'); }); this.box.on('dragend', function () { s.log.push('dragend'); });
      });
      try {
        var s = g.scene.getScene('T'), cv = g.canvas;
        pointer(cv, 'pointermove', 20, 20); pointer(cv, 'pointerdown', 20, 20); pointer(cv, 'pointerup', 20, 20);
        A.ok(s.log.indexOf('down') >= 0 && s.log.indexOf('tap') >= 0 && s.log.indexOf('over') >= 0, s.log.join(','));
        pointer(cv, 'pointerdown', 20, 20); pointer(cv, 'pointermove', 30, 25); pointer(cv, 'pointermove', 44, 40); pointer(cv, 'pointerup', 44, 40);
        A.near(s.box.x, 44, 1.5, 'arrastrado x'); A.near(s.box.y, 40, 1.5); A.ok(s.log.indexOf('dragend') >= 0);
        pointer(cv, 'pointerdown', 5, 60); A.eq(s.log.filter(function (x) { return x === 'down'; }).length, 2, 'fuera no dispara');
        pointer(cv, 'pointerup', 5, 60);
      } finally { g.destroy(); }
    });
    t.test('Teclado: isDown, justPressed (1 frame) y eventos keydown-X', async function () {
      var g = await makeGame(K, function () { var s = this; this.cnt = 0; this.keys = this.input.keyboard.createCursorKeys(); this.input.keyboard.on('keydown-SPACE', function () { s.cnt++; }); });
      try {
        var s = g.scene.getScene('T');
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', key: 'ArrowLeft' }));
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
        g.loop.step(16);
        A.ok(s.keys.left.isDown); A.ok(s.keys.left.justDown, 'justDown en el frame'); A.ok(s.input.keyboard.justPressed('SPACE')); A.eq(s.cnt, 1);
        g.loop.step(16); A.ok(!s.keys.left.justDown, 'justDown solo un frame'); A.ok(s.keys.left.isDown);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft', key: 'ArrowLeft' })); g.loop.step(16);
        A.ok(!s.keys.left.isDown && s.keys.left.justUp);
        window.dispatchEvent(new Event('blur')); g.loop.step(16); A.ok(!s.input.keyboard.isDown('SPACE'), 'blur suelta teclas');
      } finally { g.destroy(); }
    });
    t.test('No captura teclas en campos de texto (formularios web3)', async function () {
      var g = await makeGame(K, function () { this.k = this.input.keyboard.addKey('A'); });
      var inp = document.createElement('input'); document.body.appendChild(inp);
      try {
        var ev = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }); inp.dispatchEvent(ev);
        A.ok(!ev.defaultPrevented, 'no preventDefault en input'); g.loop.step(16);
        A.ok(!g.scene.getScene('T').input.keyboard.isDown('SPACE'));
      } finally { inp.remove(); g.destroy(); }
    });
    t.test('Ciclo de vida de escenas y limpieza', async function () {
      var order = [];
      var g = await makeGame(K, function () { order.push('T.create'); });
      try {
        g.scene.add('B', { init: function (d) { order.push('B.init:' + d.v); }, create: function () { order.push('B.create'); this.add.sprite(0, 0, '__WHITE'); this.tweens.add({ targets: {}, x: 1, duration: 1e6 }); this.time.delayedCall(1e6, function () {}); }, update: function () { order.push('B.update'); } });
        var before = UG.Debug.snapshot();
        g.scene.launch('B', { v: 7 }); g.loop.step(16); g.loop.step(16);
        A.ok(order.indexOf('B.init:7') >= 0 && order.indexOf('B.create') >= 0 && order.indexOf('B.update') >= 0, order.join(','));
        g.scene.sleep('B'); var n = order.length; g.loop.step(16); A.eq(order.length, n, 'dormida no actualiza');
        g.scene.wake('B'); g.loop.step(16); A.ok(order.length > n);
        g.scene.stop('B'); g.loop.step(16);
        var diff = UG.Debug.diff(before, UG.Debug.snapshot());
        A.ok(!diff.DisplayObject && !diff.Tween && !diff.TimerEvent, 'recursos liberados: ' + JSON.stringify(diff));
      } finally { g.destroy(); }
    });
    t.test('Animaciones por frames (repeat, yoyo, eventos)', async function () {
      var g = await makeGame(K, function () {
        this.textures.generate('sheet', 32, 8, function (c) { ['#f00', '#0f0', '#00f', '#fff'].forEach(function (col, i) { c.fillStyle = col; c.fillRect(i * 8, 0, 8, 8); }); });
        this.textures.getEntry('sheet');
        this.textures.addSpriteSheet('sheet2', this.textures.get('sheet').source.resource, { frameWidth: 8, frameHeight: 8 });
        this.anims.create({ key: 'run', frames: this.anims.generateFrameNumbers('sheet2', { start: 0, end: 3 }), frameRate: 10, repeat: 1 });
        var s = this; this.done = 0; this.spr = this.add.sprite(10, 10, 'sheet2', 0); this.spr.on('animationcomplete', function () { s.done++; }); this.spr.play('run');
      });
      try {
        var s = g.scene.getScene('T');
        for (var i = 0; i < 3; i++) g.loop.step(50);
        A.eq(s.spr.anims.index, 1, 'frame tras 150ms');
        for (var j = 0; j < 20; j++) g.loop.step(50);
        A.eq(s.done, 1, 'animationcomplete'); A.ok(!s.spr.isPlaying);
      } finally { g.destroy(); }
    });
    t.test('Loader: data URIs, JSON, integridad y URL bloqueada', async function () {
      var png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEIGBmIBwyEgAAIBQD/pn8Y1QAAAABJRU5ErkJggg==';
      var g = await makeGame(K, function () { }, {
        preload: function () {
          this.load.image('pix', png);
          this.load.json('cfg', 'data:application/json,' + encodeURIComponent('{"vidas":3}'));
          this.load.json('bad', 'data:application/json,' + encodeURIComponent('{"x":1}'), { integrity: 'sha256-AAAA' });
          this.load.image('evil', 'javascript:alert(1)');
          this.load.sfx('beep', 'coin');
        }
      });
      try {
        A.ok(g.textures.exists('pix'), 'imagen'); A.eq(g.textures.get('pix').width, 2); A.eq(g.cache.json.get('cfg').vidas, 3);
        A.ok(!g.cache.json.has('bad'), 'integridad rechazada'); A.ok(!g.textures.exists('evil'), 'URL bloqueada'); A.ok(g.sound.exists('beep') || g.sound.disabled);
      } finally { g.destroy(); }
    });
    t.test('Tiled desde servidor: TMJ + tileset externo + imagen', async function () {
      var g = await makeGame(K, function () { }, { preload: function () { this.load.tilemapTiledJSON('lvl', '../assets/test/map.tmj'); } });
      try {
        var m = g.cache.tilemap.get('lvl'); A.ok(m, 'mapa cargado'); A.eq(m.tilesets[0].name, 'testtiles'); A.ok(g.textures.exists('testtiles'), 'imagen auto-cargada');
        var s = g.scene.getScene('T'), tm = s.add.tilemap('lvl'), layer = tm.createLayer('Suelo');
        A.ok(layer.getTileAt(0, 3).index === 1); A.eq(tm.getObjects('Objetos').length, 2);
        var coins = tm.createFromObjects('Objetos', { name: 'moneda' }); A.eq(coins.length, 1); A.eq(coins[0].data.get('valor'), 10);
      } finally { g.destroy(); }
    });
    t.test('Pérdida y restauración de contexto WebGL', async function () {
      var g = await makeGame('webgl2', function () { this.add.sprite(32, 32, '__WHITE').setDisplaySize(20, 20).setTint(0x00ff00); });
      try {
        var r = g.renderer; if (!r._extLose) return 'sin WEBGL_lose_context';
        var lost = false, restored = false; g.on('contextlost', function () { lost = true; }); g.on('contextrestored', function () { restored = true; });
        r.loseContext(); await sleep(50); A.ok(lost, 'evento contextlost'); g.loop.step(16);
        r.restoreContext(); for (var i = 0; i < 40 && !restored; i++) await sleep(25);
        A.ok(restored, 'evento contextrestored'); g.loop.step(16);
        var img = await grab(g); A.color(img.at(32, 32), [0, 255, 0], 4, 'vuelve a renderizar');
      } finally { g.destroy(); }
    });
    t.test('Audio: reproducir, pausar, reanudar, límites y limpieza de nodos', async function () {
      var g = await makeGame(K, function () { }, { config: { audio: {} } });
      try {
        var snd = g.sound, ctx = snd.context; if (!ctx) return 'sin WebAudio';
        snd.addSamples('tono', UG.Sfx.generate(UG.Sfx.preset('powerup', 2)), 44100);
        snd.maxInstancesPerKey = 3;
        var list = []; for (var i = 0; i < 6; i++) list.push(snd.play('tono', { volume: 0.01 }));
        A.ok(list[5] && list[5].isPlaying); A.ok(snd.playingCount <= 3, 'límite por clave ' + snd.playingCount);
        var s = snd.add('tono', { volume: 0.01, loop: true }); s.play(); s.pause(); A.ok(s.isPaused); s.resume(); A.ok(s.isPlaying); s.stop();
        snd.stopAll(); await sleep(10);
        A.eq(snd.playingCount, 0, 'sin instancias sonando');
        A.eq(UG.Debug.live.SoundInstance || 0, 0, 'instancias destruidas');
        g.sound.addMusic('tema', { bpm: 120, tracks: [{ notes: 'C4 E4 G4 C5' }] }); var m = g.sound.playMusic('tema', { volume: 0.01, waitForUnlock: false }); A.ok(m); g.sound.stopMusic();
        return 'estado del contexto: ' + ctx.state;
      } finally { g.destroy(); }
    });
    t.test('Rellenos convexos sin grietas con MSAA (barras tipo píldora a resolución fraccionaria)', async function () {
      var done = [], BK2 = (R.backends && R.backends.length) ? R.backends : ['webgl2'];
      for (var bi = 0; bi < BK2.length; bi++) {
        var KB = BK2[bi];
        for (var ri = 0; ri < 3; ri++) {
          var res = [0.64, 0.75, 1.33][ri];
          var g = await makeGame(KB, function () {
            var gr = this.add.graphics();
            // misma geometría que la barra de tiempo de Gem Match (mismos desplazamientos subpíxel)
            gr.fillStyle(0x000000, 1).fillRect(0, 0, 720, 240);
            gr.fillStyle(0x000000, 0.4).fillRoundedRect(150, 184, 420, 24, 12);
            gr.fillStyle(0x00ff00, 1).fillRoundedRect(153, 187, 414 * 0.9667, 18, 9);
          }, { width: 720, height: 240, resolution: res, config: { antialias: true } });
          try {
            g.loop.step(16);
            var img = await grab(g), k = img.w / 720, bad = 0;
            for (var y = Math.ceil(190 * k); y <= Math.floor(202 * k); y++) for (var x = Math.ceil(172 * k); x <= Math.floor(540 * k); x++) { var p = img.at(x, y); if (p[1] < 230) bad++; }
            A.eq(bad, 0, KB + ' @' + res + ': píxeles con grieta');
            done.push(KB + '@' + res);
          } finally { g.destroy(); }
        }
      }
      return done.join(', ');
    });
    t.test('cacheAsTexture: el contenido se dibuja una sola vez y se invalida bajo demanda', async function () {
      var done = [];
      var BACKENDS_ALL = (R.backends && R.backends.length) ? R.backends : ['webgl2', 'canvas'];
      for (var bi = 0; bi < BACKENDS_ALL.length; bi++) {
      var KB = BACKENDS_ALL[bi];
      var g = await makeGame(KB, function () {
        var gr = this.add.graphics(); gr.fillStyle(0x00ff00, 1).fillRect(0, 0, 64, 64); gr.cacheAsTexture = true; this.gr = gr;
        this.textures.generate('ct', 16, 8, function (c) { c.fillStyle = '#ff0000'; c.fillRect(0, 0, 8, 8); c.fillStyle = '#0000ff'; c.fillRect(8, 0, 8, 8); }, { scaleMode: 'nearest' });
        var map = this.add.tilemap(UG.TiledParser.normalize({ width: 2, height: 1, tilewidth: 8, tileheight: 8, tilesets: [{ firstgid: 1, name: 'ct', tilewidth: 8, tileheight: 8, tilecount: 2, columns: 2, imagewidth: 16, imageheight: 8 }], layers: [{ type: 'tilelayer', name: 'L', width: 2, height: 1, data: [1, 1] }] }));
        this.layer = map.createLayer('L', 0, 0); this.layer.setScale(4); this.layer.cacheAsTexture = true;
      });
      try {
        var s = g.scene.getScene('T'), n = 0, gr = s.gr;
        var o1 = gr._renderGPU, o2 = gr._renderCanvas;
        gr._renderGPU = function (r) { n++; return o1.call(this, r); }; gr._renderCanvas = function (r) { n++; return o2.call(this, r); };
        gr.updateCacheTexture();
        for (var i = 0; i < 5; i++) g.loop.step(16);
        A.eq(n, 1, KB + ': dibujado una vez en 5 frames');
        gr.updateCacheTexture(); g.loop.step(16); g.loop.step(16); A.eq(n, 2, 'se regenera tras updateCacheTexture');
        var img = await grab(g); A.color(img.at(8, 48), [0, 255, 0], 6, 'contenido correcto');
        A.color(img.at(4, 4), [255, 0, 0], 6, 'tile 1 cacheado');
        s.layer.putTileAt(2, 0, 0); g.loop.step(16); img = await grab(g); A.color(img.at(4, 4), [0, 0, 255], 6, 'putTileAt invalida la caché de la capa');
        done.push(g.rendererType);
      } finally { g.destroy(); }
      }
      return 'backends: ' + done.join(', ');
    });
    t.test('cacheAsTexture se regenera con el tamaño correcto al cambiar la resolución', async function () {
      var g = await makeGame(K, function () { var gr = this.add.graphics(); gr.fillStyle(0xff0000, 1).fillRect(0, 0, 64, 64); gr.cacheAsTexture = true; this.gr = gr; });
      try {
        g.loop.step(16);
        var c = g.scene.getScene('T').gr._cache, w1 = c.lb.w, h1 = c.lb.h, r = g.renderer;
        r.resize(r.width, r.height, r.resolution * 2); g.loop.step(16);
        A.near(c.lb.w, w1, 1.01, 'ancho lógico'); A.near(c.lb.h, h1, 1.01, 'alto lógico');
        var img = await grab(g); A.color(img.at(img.w - 3, img.h - 3), [255, 0, 0], 6, 'cubre todo el lienzo');
        r.resize(r.width, r.height, r.resolution / 4); g.loop.step(16); A.near(c.lb.w, w1, 1.01, 'también al reducir');
      } finally { g.destroy(); }
    });
    t.test('Texto: cambios pequeños reutilizan la textura de GPU (capacidad en pasos de 32 px)', async function () {
      var g = await makeGame(K, function () { this.t = this.add.text(2, 2, '9', { fontSize: 16, fill: 0xffffff }); });
      try {
        var t = g.scene.getScene('T').t; g.loop.step(16);
        var src = t._source, w0 = src.width, h0 = src.height, lw0 = t.width;
        t.text = '10'; g.loop.step(16); t.text = '100'; g.loop.step(16);
        A.eq(src.width, w0, 'mismo ancho de lienzo'); A.eq(src.height, h0, 'mismo alto'); A.ok(t.width > lw0, 'el ancho lógico sí crece');
        t.text = 'un texto bastante más largo que antes'; g.loop.step(16); A.ok(src.width > w0, 'crece cuando hace falta');
        t.text = '1'; g.loop.step(16); A.ok(src.width <= 64, 'y se reduce al encoger mucho (' + src.width + ')');
        var img = await grab(g); A.ok(img.count(function (r) { return r > 200; }) > 5, 'el texto se ve');
      } finally { g.destroy(); }
    });
    t.test('Audio bloqueado: playSfx descarta sin acumular instancias', async function () {
      var g = await makeGame(K, function () { }, { config: { audio: {} } });
      try {
        var snd = g.sound; if (!snd.context) return 'sin WebAudio';
        var was = snd.locked, before = UG.Debug.live.SoundInstance || 0;
        snd.locked = true;
        for (var i = 0; i < 50; i++) A.eq(snd.playSfx({ preset: 'coin', seed: i % 5 }), null, 'descartado');
        A.eq(UG.Debug.live.SoundInstance || 0, before, 'sin instancias nuevas');
        A.ok(snd.exists('__sfx:' + JSON.stringify({ preset: 'coin', seed: 1 })), 'el efecto queda generado en caché');
        var forced = snd.playSfx('blip', { force: true, volume: 0.01 }); A.ok(forced, 'force: true lo reproduce igualmente');
        snd.stopAll(); snd.locked = was; await sleep(10);
      } finally { g.destroy(); }
    });
    t.test('Joystick virtual (táctil)', async function () {
      var g = await makeGame(K, function () { this.joy = this.add.joystick({ x: 20, y: 44, radius: 16 }); });
      try {
        var s = g.scene.getScene('T'), cv = g.canvas;
        pointer(cv, 'pointerdown', 20, 44, 7); pointer(cv, 'pointermove', 36, 44, 7);
        A.ok(s.joy.isActive); A.near(s.joy.forceX, 1, 0.05); A.near(s.joy.forceY, 0, 0.05); A.ok(s.joy.right);
        pointer(cv, 'pointerup', 36, 44, 7); A.ok(!s.joy.isActive); A.eq(s.joy.force, 0);
      } finally { g.destroy(); }
    });
    t.test('Escalado FIT centra y conserva proporción', async function () {
      var box = document.createElement('div'); box.style.cssText = 'position:fixed;left:-2000px;top:0;width:400px;height:200px;'; document.body.appendChild(box);
      var game = new UG.Game({ width: 200, height: 200, parent: box, renderer: [K], scale: { mode: 'fit' }, resolution: 1, banner: false, autoStart: false, audio: { noAudio: true }, scenes: [{ key: 'T' }] });
      try {
        await game.ready; game.loop.step(16);
        var cv = game.canvas; A.eq(cv.style.width, '200px'); A.eq(cv.style.height, '200px'); A.eq(cv.style.marginLeft, '100px');
        box.style.width = '100px'; game.scale.refresh(); A.eq(cv.style.width, '100px'); A.eq(cv.width, 100, 'resolución del canvas');
      } finally { game.destroy(); box.remove(); }
    });
    t.setBackend = function (k) { K = k; };
  });

  /* ============================================================ FUGAS */
  function leakSuite(kind) {
    suite('Fugas de memoria · ' + kind, function (t) {
      t.test('Crear/destruir miles de objetos (sprites, textos, gráficos, partículas, filtros, RT)', async function () {
        var base = UG.Debug.snapshot();
        var g = await makeGame(kind, function () { });
        try {
          var s = g.scene.getScene('T'), inGame = UG.Debug.snapshot();
          for (var round = 0; round < 5; round++) {
            var objs = [];
            for (var i = 0; i < 400; i++) objs.push(s.add.sprite(i % 64, (i * 7) % 64, '__WHITE'));
            for (var j = 0; j < 20; j++) objs.push(s.add.text(0, j * 3, 'texto ' + j + ' ' + round, { fontSize: 12 }));
            for (var k = 0; k < 20; k++) objs.push(s.add.graphics().fillStyle(0xff0000).fillCircle(10, 10, 5 + k));
            var em = s.add.particles('__WHITE', { frequency: 5, lifespan: 200 }); objs.push(em);
            var c = s.add.container(0, 0); c.add(new UG.Sprite(20, 20, UG.Texture.WHITE)); c.filters = [new UG.BlurFilter(4), new UG.GlowFilter()]; objs.push(c);
            var rt = s.add.renderTexture(10, 10, 32, 32); rt.draw(objs[0], 5, 5); objs.push(rt);
            s.tweens.add({ targets: objs.slice(0, 50), x: 30, duration: 1000 });
            s.time.delayedCall(100000, function () {});
            for (var f = 0; f < 5; f++) g.loop.step(16);
            objs.forEach(function (o) { o.destroy(); });
            s.time.removeAllEvents();
            for (var f2 = 0; f2 < 3; f2++) g.loop.step(16);
          }
          var after = UG.Debug.snapshot(), d = UG.Debug.diff(inGame, after);
          delete d.RenderTexture; delete d.TextureSource; delete d.GPUTexture; // RTs del pool (reutilizables, acotados)
          A.deep(d, {}, 'objetos vivos tras destruir');
          A.ok(g.renderer.pool ? g.renderer.pool.created <= 12 : true, 'pool de RT acotado (' + (g.renderer.pool && g.renderer.pool.created) + ')');
        } finally { g.destroy(); }
        await sleep(20);
        var dd = UG.Debug.diff(base, UG.Debug.snapshot());
        A.deep(dd, {}, 'todo liberado al destruir el juego');
      });
      t.test('Reiniciar la escena 15 veces no acumula nada', async function () {
        var g = await makeGame(kind, function () {
          for (var i = 0; i < 100; i++) this.add.sprite(i, i, '__WHITE').setInteractive();
          this.add.text(0, 0, 'hola'); this.physics.add.sprite(10, 10, '__WHITE');
          this.tweens.add({ targets: this.add.graphics().fillRect(0, 0, 5, 5), alpha: 0, duration: 5000, repeat: -1 });
          this.input.keyboard.on('keydown', function () {});
        }, { physics: { arcade: { gravity: { y: 100 } } } });
        try {
          g.loop.step(16);
          var snap = UG.Debug.snapshot();
          for (var i = 0; i < 15; i++) { g.scene.getScene('T').scene.restart(); g.loop.step(16); g.loop.step(16); }
          var d = UG.Debug.diff(snap, UG.Debug.snapshot()); delete d.Camera;
          A.deep(d, {}, 'diferencia tras 15 reinicios');
        } finally { g.destroy(); }
      });
      t.test('Crear y destruir 6 juegos completos', async function () {
        var base = UG.Debug.snapshot(), heap0 = performance.memory ? performance.memory.usedJSHeapSize : 0;
        for (var i = 0; i < 6; i++) {
          var g = await makeGame(kind, function () { for (var k = 0; k < 50; k++) this.add.sprite(k, k, '__WHITE'); this.add.text(0, 0, 'x'); });
          g.loop.step(16); g.destroy();
        }
        await sleep(30);
        var d = UG.Debug.diff(base, UG.Debug.snapshot());
        A.deep(d, {}, 'contadores');
        A.eq(UG.Game.instances.length, 0, 'sin instancias vivas');
        return performance.memory ? 'heap Δ ' + ((performance.memory.usedJSHeapSize - heap0) / 1048576).toFixed(2) + ' MB (sin GC forzado)' : '';
      });
    }, { leaks: true });
  }

  /* ============================================================ BENCH */
  function benchSuite(kind) {
    suite('Benchmark · ' + kind, function (t) {
      [5000, 20000, 60000].forEach(function (N) {
        if (kind === 'canvas' && N > 5000) return;
        t.test(N + ' sprites en movimiento (CPU+GPU por frame)', async function () {
          var g = await makeGame(kind, function () {
            var cols = ['#ff6b6b', '#4dabf7', '#69db7c', '#ffd43b'];
            for (var c = 0; c < 4; c++) this.textures.generate('b' + c, 16, 16, (function (col) { return function (ctx) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(8, 8, 7, 0, 6.3); ctx.fill(); }; })(cols[c]));
            this.list = [];
            for (var i = 0; i < N; i++) { var s = this.add.sprite(Math.random() * 800, Math.random() * 600, 'b' + (i & 3)); s.vx = Math.random() * 4 - 2; s.vy = Math.random() * 4 - 2; this.list.push(s); }
            this.update = function () { var l = this.list; for (var i = 0; i < l.length; i++) { var s = l[i]; s.x += s.vx; s.y += s.vy; if (s.x < 0 || s.x > 800) s.vx = -s.vx; if (s.y < 0 || s.y > 600) s.vy = -s.vy; s.rotation += 0.01; } };
          }, { width: 800, height: 600 });
          try {
            var r = g.renderer, sync;
            if (r.gl) sync = function () { var px = new Uint8Array(4); r.gl.readPixels(0, 0, 1, 1, r.gl.RGBA, r.gl.UNSIGNED_BYTE, px); return Promise.resolve(); };
            else if (r.device) sync = function () { return r.device.queue.onSubmittedWorkDone(); };
            else sync = function () { return Promise.resolve(); };
            for (var w = 0; w < 5; w++) { g.loop.step(16); await sync(); }
            var frames = 30, t0 = performance.now();
            for (var f = 0; f < frames; f++) { g.loop.step(16); await sync(); }
            var ms = (performance.now() - t0) / frames;
            var res = { backend: kind, sprites: N, ms: +ms.toFixed(2), fps: Math.round(1000 / ms), draws: r.stats.drawCalls };
            R.bench.push(res);
            return ms.toFixed(2) + ' ms/frame · ~' + res.fps + ' fps · ' + res.draws + ' draws';
          } finally { g.destroy(); }
        });
      });
      if (kind !== 'canvas') [60000, 200000].forEach(function (N) { t.test('ParticleContainer: ' + N + ' sprites ligeros', async function () {
        var g = await makeGame(kind, function () {
          var cols = ['#ff6b6b', '#4dabf7', '#69db7c', '#ffd43b'], texs = [];
          for (var c = 0; c < 4; c++) { this.textures.generate('p' + c, 16, 16, (function (col) { return function (ctx) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(8, 8, 7, 0, 6.3); ctx.fill(); }; })(cols[c])); texs.push(this.textures.get('p' + c)); }
          var pc = this.add.particleContainer(); this.pc = pc;
          for (var i = 0; i < N; i++) { var p = new UG.Particle(texs[i & 3], Math.random() * 800, Math.random() * 600); p.vx = Math.random() * 4 - 2; p.vy = Math.random() * 4 - 2; pc.addParticle(p); }
          this.update = function () { var l = this.pc.particles; for (var i = 0; i < l.length; i++) { var p = l[i]; p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > 800) p.vx = -p.vx; if (p.y < 0 || p.y > 600) p.vy = -p.vy; p.rotation += 0.01; } };
        }, { width: 800, height: 600 });
        try {
          var r = g.renderer, sync = r.gl ? function () { var px = new Uint8Array(4); r.gl.readPixels(0, 0, 1, 1, r.gl.RGBA, r.gl.UNSIGNED_BYTE, px); return Promise.resolve(); } : function () { return r.device.queue.onSubmittedWorkDone(); };
          for (var w = 0; w < 5; w++) { g.loop.step(16); await sync(); }
          var t0 = performance.now(), frames = 20;
          for (var f = 0; f < frames; f++) { g.loop.step(16); await sync(); }
          var ms = (performance.now() - t0) / frames;
          R.bench.push({ backend: kind, particleContainer: N, ms: +ms.toFixed(2), fps: Math.round(1000 / ms), draws: r.stats.drawCalls });
          return ms.toFixed(2) + ' ms/frame · ~' + Math.round(1000 / ms) + ' fps · ' + r.stats.drawCalls + ' draws';
        } finally { g.destroy(); }
      }); });
      if (kind !== 'canvas') t.test('Partículas: 50.000 activas', async function () {
        var g = await makeGame(kind, function () { this.em = this.add.particles('__WHITE', { x: 400, y: 300, speed: { min: 20, max: 200 }, lifespan: 4000, frequency: 0, quantity: 900, maxParticles: 50000, scale: { start: 1, end: 0 }, alpha: { start: 1, end: 0 }, blendMode: 'add', gravityY: 50 }); }, { width: 800, height: 600 });
        try {
          var r = g.renderer, sync = r.gl ? function () { var px = new Uint8Array(4); r.gl.readPixels(0, 0, 1, 1, r.gl.RGBA, r.gl.UNSIGNED_BYTE, px); return Promise.resolve(); } : function () { return r.device.queue.onSubmittedWorkDone(); };
          for (var w = 0; w < 70; w++) g.loop.step(16);
          await sync();
          var s = g.scene.getScene('T'), t0 = performance.now(), frames = 30;
          for (var f = 0; f < frames; f++) { g.loop.step(16); await sync(); }
          var ms = (performance.now() - t0) / frames;
          R.bench.push({ backend: kind, particles: s.em.count, ms: +ms.toFixed(2) });
          return s.em.count + ' partículas · ' + ms.toFixed(2) + ' ms/frame';
        } finally { g.destroy(); }
      });
    }, { bench: true });
  }

  var TILED = window.TILED = { gids: [0, 0, 0, 0, 0, 0, 0, 0, 2147483650, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1], raw: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAA', zlib: 'eJxjYMAPmBgYGggoAQNGHBgAH7QAiQ==', gzip: 'H4sIAAAAAAAACmNgwA+YGBgaCCgBA0YcGADGmKdSYAAAAA==' };

  /* ============================================================ RUNNER */
  async function detect() {
    var b = [];
    if (navigator.gpu) { try { var a = await navigator.gpu.requestAdapter(); if (a) b.push('webgpu'); } catch (e) { /* */ } }
    if (UG.Capabilities.webgl2()) b.push('webgl2');
    if (UG.Capabilities.webgl()) b.push('webgl');
    b.push('canvas');
    return b;
  }
  var UNIT = suites.slice();
  async function runAll() {
    var btn = document.getElementById('run'); btn.disabled = true;
    elSuites.textContent = ''; R.passed = R.failed = R.skipped = 0; R.failures = []; R.bench = []; R.done = false;
    suites = UNIT.slice();
    var backends = await detect(); R.backends = backends;
    var qs = new URLSearchParams(location.search), only = qs.get('only'), filterB = qs.get('backend');
    var BK = filterB ? backends.filter(function (x) { return x === filterB; }) : backends;
    BK.forEach(function (k) { renderSuite(k); });
    if (BK.indexOf('webgl') >= 0) renderSuite('webgl', 'webgl1 sin instancing (legado)', { instancing: false });
    if (document.getElementById('leaks').checked && qs.get('leaks') !== '0') BK.forEach(leakSuite);
    if (document.getElementById('bench').checked && qs.get('bench') !== '0') BK.forEach(benchSuite);
    summary();
    var t0 = performance.now();
    for (var si = 0; si < suites.length; si++) {
      var s = suites[si];
      if (only && s.name.toLowerCase().indexOf(only.toLowerCase()) < 0) continue;
      var c = card(s.name), tests = [];
      var ctx = { test: function (n, fn) { tests.push({ n: n, fn: fn }); } };
      try { s.fn(ctx); } catch (e) { tests.push({ n: 'setup', fn: function () { throw e; } }); }
      if (ctx.setBackend) ctx.setBackend(BK.indexOf('webgl2') >= 0 ? 'webgl2' : BK[0]);
      var pass = 0;
      for (var ti = 0; ti < tests.length; ti++) {
        var te = tests[ti], rw = row(c.el, te.n);
        elStatus.textContent = s.name + ' → ' + te.n;
        try {
          var info = await Promise.race([Promise.resolve().then(te.fn), sleep(60000).then(function () { throw new Error('timeout 60s'); })]);
          if (typeof info === 'string' && /^sin /.test(info)) { rw.skip(info); R.skipped++; }
          else { rw.ok(typeof info === 'string' ? info : ''); R.passed++; pass++; }
        } catch (e) {
          rw.fail(e && e.message ? e.message : String(e)); R.failed++; R.failures.push(s.name + ' › ' + te.n + ': ' + (e && e.message));
          if (e && e.stack) console.error(s.name + ' › ' + te.n, e.stack);
        }
        c.count.textContent = pass + '/' + tests.length;
        summary();
        await sleep(0);
      }
    }
    elStatus.textContent = 'Terminado en ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s';
    R.done = true; btn.disabled = false; summary();
  }
  document.getElementById('run').addEventListener('click', function () { runAll(); });
  window.runTests = runAll;
  if (new URLSearchParams(location.search).get('auto') !== '0') setTimeout(runAll, 100);
})();
