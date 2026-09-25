#!/usr/bin/env node
/* Pruebas sin navegador (Node): lógica pura del motor — matemáticas, RNG, color, seguridad, Tiled,
 * descompresión, triangulación, física, tweens, reloj, GIF y ausencia de eval. Ideal para CI.
 * Uso: node tests/node-tests.js   (sale con código 1 si algo falla) */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const UG = require('../dist/ultragame.js');

let passed = 0, failed = 0;
const fails = [];
function test(name, fn) {
  try { fn(); passed++; process.stdout.write('  ✓ ' + name + '\n'); }
  catch (e) { failed++; fails.push(name + ': ' + e.message); process.stdout.write('  ✗ ' + name + ' — ' + e.message + '\n'); }
}
const A = {
  ok: (v, m) => { if (!v) throw new Error(m || 'se esperaba verdadero'); },
  eq: (a, b, m) => { if (a !== b) throw new Error((m ? m + ': ' : '') + 'esperado ' + JSON.stringify(b) + ', obtenido ' + JSON.stringify(a)); },
  near: (a, b, eps, m) => { if (!(Math.abs(a - b) <= eps)) throw new Error((m ? m + ': ' : '') + 'esperado ~' + b + ' (±' + eps + '), obtenido ' + a); },
  throws: (fn, m) => { let t = false; try { fn(); } catch (e) { t = true; } if (!t) throw new Error(m || 'se esperaba una excepción'); }
};
const section = (s) => process.stdout.write('\n' + s + '\n');
async function testAsync(name, fn) {
  try { await fn(); passed++; process.stdout.write('  ✓ ' + name + '\n'); }
  catch (e) { failed++; fails.push(name + ': ' + e.message); process.stdout.write('  ✗ ' + name + ' — ' + e.message + '\n'); }
}

section('Núcleo');
test('versión y exportaciones', () => { A.eq(UG.VERSION, require('../package.json').version); A.ok(Object.keys(UG).length > 150); });
test('Matrix: inversa y composición', () => {
  const m = new UG.Matrix().setTransform(10, 20, 3, 4, 2, 3, 0.7, 0.1, 0.2);
  const p = m.apply(5, 7), q = m.applyInverse(p.x, p.y); A.near(q.x, 5, 1e-9); A.near(q.y, 7, 1e-9);
});
test('RNG determinista, uniforme y con estado restaurable', () => {
  const a = new UG.RNG('semilla'), b = new UG.RNG('semilla');
  for (let i = 0; i < 5000; i++) A.eq(a.next(), b.next());
  const r = new UG.RNG(7), h = [0, 0, 0, 0, 0, 0]; for (let j = 0; j < 60000; j++) h[r.int(0, 5)]++;
  A.ok(h.every((x) => x > 9400 && x < 10600), 'distribución ' + h);
  const st = r.getState(), v = r.float(); r.setState(st); A.eq(r.float(), v);
});
test('Color: parseo y operaciones', () => {
  A.eq(UG.Color.toNumber('#ff8000'), 0xff8000); A.eq(UG.Color.toNumber('hsl(0, 100%, 50%)'), 0xff0000);
  A.eq(UG.Color.lerp(0x000000, 0xffffff, 0.5), 0x7f7f7f); A.eq(UG.Color.darken(0xffffff, 0.5), 0x808080);
});
test('Easing: extremos 0→0 y 1→1 en las ' + UG.Easing.names.length + ' curvas', () => {
  UG.Easing.names.forEach((n) => { const f = UG.Easing.get(n); A.near(f(0), 0, 1e-6, n); A.near(f(1), 1, 1e-6, n); });
});
test('Math: wrap, damp, shortestAngle', () => {
  A.eq(UG.Math.wrap(-1, 0, 10), 9); A.near(UG.Math.shortestAngle(3, -3), 2 * Math.PI - 6, 1e-9); A.ok(UG.Math.damp(0, 10, 5, 0.1) > 0);
});
test('Earcut: polígono con agujero cubre el área exacta', () => {
  const pts = [0, 0, 10, 0, 10, 10, 0, 10, 3, 3, 7, 3, 7, 7, 3, 7], tr = UG.Earcut(pts, [4]);
  let s = 0; for (let i = 0; i < tr.length; i += 3) { const a = tr[i] * 2, b = tr[i + 1] * 2, c = tr[i + 2] * 2; s += Math.abs((pts[b] - pts[a]) * (pts[c + 1] - pts[a + 1]) - (pts[c] - pts[a]) * (pts[b + 1] - pts[a + 1])) / 2; }
  A.near(s, 84, 1e-9);
});

section('Seguridad');
test('SHA-256 coincide con Node crypto', () => {
  for (const s of ['', 'abc', 'ultragame', 'x'.repeat(1000)]) A.eq(UG.Security.sha256(s), crypto.createHash('sha256').update(s).digest('hex'), JSON.stringify(s.slice(0, 8)));
});
test('Integridad SRI', () => {
  const sri = 'sha256-' + crypto.createHash('sha256').update('abc').digest('base64');
  A.ok(UG.Security.verifyIntegrity('abc', sri)); A.ok(!UG.Security.verifyIntegrity('abd', sri));
});
test('Sin prototype pollution', () => {
  UG.Security.safeMerge({}, JSON.parse('{"__proto__":{"polluted":1},"a":{"constructor":{"prototype":{"p2":1}}}}'));
  const props = UG.TiledParser.props([{ name: '__proto__', type: 'string', value: 'x' }, { name: 'ok', type: 'int', value: '5' }]);
  A.eq(({}).polluted, undefined); A.eq(({}).p2, undefined); A.eq(props.ok, 5);
});
test('URLs peligrosas bloqueadas', () => {
  ['javascript:alert(1)', ' JaVaScRiPt:x', 'java\tscript:x', 'data:text/html,<script>x</script>', 'vbscript:x'].forEach((u) => A.ok(!UG.Security.isSafeURL(u), u));
  ['assets/a.png', '/x.json', 'data:image/png;base64,AAAA'].forEach((u) => A.ok(UG.Security.isSafeURL(u), u));
});
test('Texto saneado (bidi/control) y longitud máxima', () => {
  A.eq(UG.Security.sanitizeText('ad‮min\u0000'), 'admin'); A.eq(UG.Security.sanitizeText('x'.repeat(50), 10).length, 10);
});
test('secureRandom en [0,1) y secureRandomInt en rango', () => {
  for (let i = 0; i < 1000; i++) { const v = UG.Security.secureRandom(); A.ok(v >= 0 && v < 1); const n = UG.Security.secureRandomInt(3, 9); A.ok(n >= 3 && n <= 9 && (n | 0) === n); }
});
test('Bundle sin eval / new Function / innerHTML', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'dist', 'ultragame.js'), 'utf8');
  A.ok(!/\beval\s*\(/.test(src) && !/new\s+Function\s*\(/.test(src) && !/\.innerHTML\s*=/.test(src) && !/document\.write\s*\(/.test(src));
});

section('Tiled y descompresión');
const gids = [0, 0, 1, 2, (3 | 0x80000000) >>> 0, 0];
const raw = Buffer.alloc(gids.length * 4); gids.forEach((g, i) => raw.writeUInt32LE(g, i * 4));
const base = { width: 3, height: 2, tilewidth: 8, tileheight: 8, orientation: 'orthogonal', tilesets: [{ firstgid: 1, name: 'ts', tilewidth: 8, tileheight: 8, tilecount: 4, columns: 2, imagewidth: 16, imageheight: 16 }] };
const mk = (layer) => UG.TiledParser.normalize(Object.assign({}, base, { layers: [Object.assign({ type: 'tilelayer', name: 'L', width: 3, height: 2 }, layer)] }));
test('CSV, base64, base64+zlib y base64+gzip dan los mismos GIDs', () => {
  const variants = [{ data: gids }, { data: raw.toString('base64'), encoding: 'base64' }, { data: zlib.deflateSync(raw).toString('base64'), encoding: 'base64', compression: 'zlib' }, { data: zlib.gzipSync(raw).toString('base64'), encoding: 'base64', compression: 'gzip' }];
  variants.forEach((v, k) => { const d = Array.from(mk(v).layers[0].data); A.eq(JSON.stringify(d), JSON.stringify(gids), 'variante ' + k); });
});
test('Inflate propio == zlib de Node (1 MB aleatorio comprimible)', () => {
  const r = new UG.RNG(3), big = Buffer.alloc(1 << 20); for (let i = 0; i < big.length; i++) big[i] = (r.int(0, 3) * 50 + (i % 7));
  const out = UG.Inflate.zlib(new Uint8Array(zlib.deflateSync(big, { level: 9 })));
  A.eq(out.length, big.length); for (let i = 0; i < big.length; i += 997) A.eq(out[i], big[i], 'byte ' + i);
});
test('Límites anti-DoS: mapa gigante y zip bomb', () => {
  A.throws(() => UG.TiledParser.normalize({ width: 100000, height: 100000, tilewidth: 16, tileheight: 16, layers: [], tilesets: [] }));
  A.throws(() => UG.Inflate.zlib(new Uint8Array(zlib.deflateSync(Buffer.alloc(100000))), 10));
});
test('Mapa infinito (chunks) y banderas de volteo', () => {
  const m = UG.TiledParser.normalize(Object.assign({}, base, { infinite: true, layers: [{ type: 'tilelayer', name: 'I', chunks: [{ x: -16, y: 0, width: 16, height: 1, data: new Array(16).fill(1) }, { x: 0, y: 0, width: 16, height: 1, data: new Array(16).fill(2) }] }] }));
  A.eq(m.layers[0].width, 32); A.eq(m.layers[0].startX, -16);
  const g = mk({ data: gids }).layers[0].data[4]; A.eq(g & UG.TiledParser.GID_MASK, 3); A.ok((g & UG.TiledParser.FLIP_H) !== 0);
});

section('Física Arcade');
const world = (gy) => new UG.ArcadeWorld({ game: { width: 800, height: 600 }, world: null }, { gravity: { x: 0, y: gy === undefined ? 1000 : gy } });
const box = (w, x, y, s, st) => { const z = new UG.Zone(x, y, s, s); w.enable(z, st); return z; };
const sim = (w, n) => { for (let i = 0; i < n; i++) w.update(0, 1000 / 60); };
test('Gravedad y aterrizaje estable', () => {
  const w = world(), a = box(w, 100, 100, 20), floor = box(w, 100, 300, 40, true); floor.body.setSize(400, 40); w.collider(a, floor); sim(w, 120);
  A.near(a.body.bottom, floor.body.top, 0.5); A.ok(a.body.blocked.down);
});
test('Choque elástico de masas iguales intercambia velocidad', () => {
  const w = world(0), a = box(w, 100, 100, 20), b = box(w, 200, 100, 20);
  a.body.setVelocity(300, 0); a.body.setBounce(1); b.body.setBounce(1); w.collider(a, b); sim(w, 30);
  A.near(a.body.velocity.x, 0, 1); A.near(b.body.velocity.x, 300, 1);
});
test('world.wrap envuelve al lado opuesto', () => {
  const w = world(0); w.setBounds(0, 0, 800, 600); const a = box(w, -30, 300, 10); w.wrap(a, 10); A.near(a.x, 790, 1e-9);
});
test('Determinismo: dos simulaciones idénticas', () => {
  const run = () => { const w = world(), a = box(w, 50, 50, 16), f = box(w, 300, 400, 20, true); f.body.setSize(600, 20); a.body.setVelocity(180, -300).setBounce(0.6); w.collider(a, f); sim(w, 300); return [a.body.x, a.body.y, a.body.velocity.x]; };
  A.eq(JSON.stringify(run()), JSON.stringify(run()));
});

section('Tweens, reloj y utilidades');
test('Tween con yoyo y onComplete', () => {
  const m = new UG.TweenManager(null), o = { x: 0 }; let done = 0;
  m.add({ targets: o, x: 100, duration: 100, yoyo: true, onComplete: () => done++ });
  for (let i = 0; i < 30; i++) m.update(0, 10);
  A.near(o.x, 0, 1e-6); A.eq(done, 1);
});
test('Stagger y valores relativos', () => {
  const m = new UG.TweenManager(null), os = [{ x: 0 }, { x: 0 }, { x: 0 }];
  m.add({ targets: os, x: '+=10', duration: 50, delay: m.stagger(50) });
  m.update(0, 60); A.near(os[0].x, 10, 1e-6); A.ok(os[2].x === 0, 'el último aún espera');
});
test('Clock: delayedCall y bucle con repeticiones', () => {
  const c = new UG.Clock(null); let a = 0, b = 0;
  c.delayedCall(100, () => a++); c.addEvent({ delay: 50, repeat: 3, callback: () => b++ });
  for (let i = 0; i < 40; i++) c.update(0, 10);
  A.eq(a, 1); A.eq(b, 4);
});
test('GifEncoder produce un GIF válido', () => {
  const g = new UG.GifEncoder(4, 4); const px = new Uint8Array(64).fill(255); g.addFrame(px); g.addFrame(px.map((v, i) => (i % 4 === 3 ? 255 : i * 3)));
  const bytes = g.finish(); A.eq(Buffer.from(bytes.slice(0, 6)).toString('ascii'), 'GIF89a'); A.eq(bytes[bytes.length - 1], 0x3b);
});
test('EventEmitter: once y off durante emit', () => {
  const e = new UG.EventEmitter(); let n = 0; const f = () => { n++; e.off('x', f); };
  e.on('x', f); e.on('x', () => { n += 10; }); e.emit('x'); e.emit('x'); A.eq(n, 21);
});

// pruebas 3D (algunas asíncronas: carga de glTF) y resumen final
require('./node-tests-3d.js')(UG, { test, testAsync, A, section }).then(() => require('./node-tests-engine2.js')(UG, { test, testAsync, A, section })).then(() => require('./node-tests-lifecycle.js')(UG, { test, testAsync, A, section })).then(() => require('./node-tests-studio.js')(UG, { test, testAsync, A, section })).then(() => {
  process.stdout.write('\n' + passed + ' correctas, ' + failed + ' fallidas\n');
  if (failed) { fails.forEach((f) => process.stdout.write('  - ' + f + '\n')); process.exit(1); }
});
