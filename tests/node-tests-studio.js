/* Pruebas de UltraGame Studio sin navegador: esquema y saneado de proyectos (entradas maliciosas), runtime
 * (envoltura de scripts, fotogramas, terreno, efectos, guardado), ZIP de exportación y seguridad del servidor local
 * (sesión, CSRF, DNS rebinding, recorrido de rutas, extensiones, tamaños, papelera). */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const vm = require('vm');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

module.exports = async function (UG, h) {
  const { test, testAsync, A, section } = h;
  const ROOT = path.resolve(__dirname, '..');
  globalThis.UG = UG;
  const S = require(path.join(ROOT, 'studio/shared/schema.js'));
  globalThis.UGStudio = globalThis.UGStudio || {}; globalThis.UGStudio.schema = S;
  require(path.join(ROOT, 'studio/runtime/runtime.js'));
  const R = globalThis.UGStudio.runtime;

  section('Studio: esquema y saneado');
  test('cleanProject acepta un proyecto normal y rechaza lo que no lo es', () => {
    const p = S.createProject('P'), sc = S.createScene('2d'); p.scenes.push(sc); p.startScene = sc.id;
    sc.nodes.push(S.createNode('sprite', '2d'), S.createNode('text', '2d'));
    const c = S.cleanProject(JSON.parse(JSON.stringify(p)));
    A.eq(c.scenes[0].nodes.length, 2); A.eq(c.startScene, sc.id);
    ['x', null, [], { format: 'otro' }].forEach((bad) => A.throws(() => S.cleanProject(bad)));
  });
  test('Entrada maliciosa: rutas, tipos, claves prohibidas, ciclos y valores fuera de rango', () => {
    const j = JSON.parse('{"format":"ultragame-project","name":"x","vars":{"__proto__":{"polluted":1},"ok":1,"constructor":2},' +
      '"assets":[{"id":"a1","file":"assets/../../etc/passwd.png"},{"id":"a2","file":"assets/ok.png"},{"id":"a3","file":"assets/x.exe"},{"id":"a2","file":"assets/dup.png"},{"id":"<b>","file":"assets/y.png"}],' +
      '"settings":{"width":1e9,"height":-5,"renderer":"javascript:alert(1)"},' +
      '"scenes":[{"id":"s1","kind":"2d","nodes":[{"id":"n1","type":"sprite","parent":"n2","x":"NaN","props":{"tint":"red; background:url(x)"}},{"id":"n2","type":"sprite","parent":"n1"},{"id":"n3","type":"nope"},{"id":"n1","type":"text"}],' +
      '"events":[{"conditions":[{"type":"start"},{"type":"hack"}],"actions":[{"type":"setVar","params":{"variable":"__proto__","value":"1"}}]}]}]}');
    const c = S.cleanProject(j);
    A.eq(({}).polluted, undefined, 'sin contaminación del prototipo');
    A.eq(Object.keys(c.vars).join(','), 'ok');
    A.eq(c.assets.map((a) => a.file).join(','), 'assets/ok.png');
    A.eq(c.settings.width, 8192); A.eq(c.settings.height, 64); A.eq(c.settings.renderer, 'auto');
    const ns = c.scenes[0].nodes; A.eq(ns.length, 2, 'tipos desconocidos e ids repetidos fuera');
    A.ok(ns.some((n) => n.parent === null), 'ciclo de padres roto');
    A.eq(ns[0].x, 0); A.eq(ns[0].props.tint, '#ffffff');
    A.eq(c.scenes[0].events[0].conditions.length, 1);
  });
  test('sortNodes: padres antes que hijos', () => {
    const o = S.sortNodes([{ id: 'c', parent: 'b' }, { id: 'b', parent: 'a' }, { id: 'a', parent: null }]).map((n) => n.id).join('');
    A.eq(o, 'abc');
  });

  section('Studio: runtime');
  test('wrapScript genera JS válido que expone las funciones de nivel superior', () => {
    const src = R.wrapScript('sc1', 'var n = 0;\nfunction onStart() { n = 5; }\nasync function cargar() {}\nfunction onUpdate(dt) { return n + dt; }\n  function sangrada() {}');
    new vm.Script(src); // compila
    let fns = null; const ctx = { UGStudio: { runtime: { registerScript: (id, f) => { fns = f({}, {}, null); } } } };
    vm.runInNewContext(src, ctx);
    A.ok(fns && typeof fns.onStart === 'function' && typeof fns.onUpdate === 'function' && typeof fns.cargar === 'function' && typeof fns.sangrada === 'function');
    fns.onStart(); A.eq(fns.onUpdate(1), 6);
    A.throws(() => R.wrapScript('id con espacios', ''));
  });
  test('wrapScript: el nombre del id no puede romper el código generado', () => {
    A.throws(() => R.wrapScript('a");alert(1);//', 'x'));
    const src = R.wrapScript('ok_1-2', '// "); alert(1); //\nfunction onStart(){}');
    new vm.Script(src);
  });
  test('parseFrames: rangos, listas y límites', () => {
    A.eq(R.parseFrames('0-3').join(','), '0,1,2,3'); A.eq(R.parseFrames('5-2').join(','), '5,4,3,2'); A.eq(R.parseFrames('1, 4 ,x, 7').join(','), '1,4,7');
    A.ok(R.parseFrames('0-100000').length <= 513, 'limitado');
  });
  test('terrainHeight: determinista por semilla y llano en el centro', () => {
    const p = { seed: 'isla', height: 7, noiseScale: 22, flatCenter: 16 }, f = R.terrainHeight(p), g = R.terrainHeight(p), k = R.terrainHeight(Object.assign({}, p, { seed: 'otra' }));
    A.eq(f(3, 4), 0); A.eq(f(30, -40), g(30, -40)); A.ok(f(30, -40) !== k(30, -40)); A.ok(isFinite(f(1e5, 1e5)));
  });
  test('particleConfig y efectos: solo clases del esquema', () => {
    const c = R.particleConfig('fire', { rate: 2, scale: 3, useColors: true, color1: '#ff0000', color2: '#00ff00' });
    A.eq(c.color[0], 0xff0000); A.near(c.scale.start, 0.9 * 3, 1e-9);
    A.eq(R.makeFilter({ type: 'noexiste', params: {} }), null);
    A.ok(R.makeFilter({ type: 'pixelate', params: { size: 5 } }) instanceof UG.PixelateFilter);
    A.ok(R.makeFilter({ type: 'glow', params: { color: '#ff0000', distance: 8, outerStrength: 2 } }) instanceof UG.GlowFilter);
  });
  test('saveData/loadData: JSON seguro, límite de tamaño y memoria si no hay localStorage', () => {
    const ctx = { P: { name: 'Juego' }, log: () => {} };
    A.ok(R.saveData(ctx, 'record', { puntos: 42 })); A.eq(R.loadData(ctx, 'record', null).puntos, 42);
    A.eq(R.loadData(ctx, 'nada', 7), 7);
    A.eq(R.saveData(ctx, 'grande', 'x'.repeat(300000)), false);
    const cyc = {}; cyc.a = cyc; A.eq(R.saveData(ctx, 'ciclo', cyc), false);
  });

  test('Variables: una dirección 0x… o un importe en wei no se convierten en número (perdían el valor)', () => {
    const addr = '0x' + 'aB'.repeat(20);
    A.eq(R.toValue(addr), addr); A.eq(R.toValue('0xff'), '0xff');
    A.eq(R.toValue('250000000000000000000'), '250000000000000000000', 'entero enorme: texto exacto');
    A.eq(R.toValue('12'), 12); A.eq(R.toValue(' -3.5 '), -3.5); A.eq(R.toValue('1e3'), 1000);
    A.eq(R.toValue('true'), true); A.eq(R.toValue('hola'), 'hola'); A.eq(R.toValue(''), '');
  });

  section('Studio: exportación ZIP');
  await testAsync('makeZip produce un ZIP con CRC-32 correctos', async () => {
    globalThis.window = globalThis.window || { UGStudio: globalThis.UGStudio };
    const X = await import(pathToFileURL(path.join(ROOT, 'studio/js/export.js')).href);
    const enc = new TextEncoder(), files = [{ path: 'index.html', data: enc.encode('<h1>ñ</h1>') }, { path: 'assets/a.bin', data: new Uint8Array(70000).map((_, i) => i * 7) }];
    const buf = Buffer.from(await X.makeZip(files).arrayBuffer());
    A.eq(buf.readUInt32LE(0), 0x04034b50);
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); A.ok(eocd > 0); A.eq(buf.readUInt16LE(eocd + 10), 2);
    let off = buf.readUInt32LE(eocd + 16);
    for (const f of files) {
      A.eq(buf.readUInt32LE(off), 0x02014b50); const crc = buf.readUInt32LE(off + 16), n = buf.readUInt16LE(off + 28), lo = buf.readUInt32LE(off + 42);
      A.eq(buf.slice(off + 46, off + 46 + n).toString('utf8'), f.path);
      if (zlib.crc32) A.eq(crc, zlib.crc32(Buffer.from(f.data)));
      const ln = buf.readUInt16LE(lo + 26), data = buf.slice(lo + 30 + ln, lo + 30 + ln + f.data.length); A.ok(Buffer.from(f.data).equals(data));
      off += 46 + n;
    }
  });

  section('Studio: editor de imágenes (paletas)');
  await testAsync('parsePalette lee .hex, .gpl, JASC .pal, Paint.NET .txt y texto libre; sin repetidos y con tope', async () => {
    const P = await import(pathToFileURL(path.join(ROOT, 'studio/js/paintcore.js')).href);
    A.eq(P.parsePalette('ff0000\n00FF00\n\n0000ff\nff0000\n').join(','), '#ff0000,#00ff00,#0000ff');
    A.eq(P.parsePalette('GIMP Palette\nName: x\nColumns: 4\n#\n255   0   0\tRojo\n  0 128 255 Azul\n').join(','), '#ff0000,#0080ff');
    A.eq(P.parsePalette('JASC-PAL\r\n0100\r\n2\r\n1 2 3\r\n250 251 252\r\n').join(','), '#010203,#fafbfc');
    A.eq(P.parsePalette(';paint.net Palette File\n;Colores: 2\nFF112233\n80445566\n').join(','), '#112233,#445566');
    A.eq(P.parsePalette(':root { --a: #abc; --b: #102030; }').join(','), '#aabbcc,#102030');
    A.eq(P.parsePalette(Array.from({ length: 400 }, (_, i) => (i * 40503).toString(16).padStart(6, '0').slice(-6)).join('\n')).length, 256);
    A.eq(P.parsePalette('nada que ver\n12345\n').length, 0);
  });
  await testAsync('colorRamp: extremos exactos en rgb/hsl y sombras→luces ordenadas por luminosidad', async () => {
    const P = await import(pathToFileURL(path.join(ROOT, 'studio/js/paintcore.js')).href);
    const rgb = P.colorRamp('#000000', '#ffffff', 5, 'rgb'); A.eq(rgb[0], '#000000'); A.eq(rgb[4], '#ffffff'); A.eq(rgb[2], '#808080');
    const hsl = P.colorRamp('#ff0000', '#0000ff', 3, 'hsl'); A.eq(hsl[0], '#ff0000'); A.eq(hsl[2], '#0000ff'); A.eq(hsl[1], '#ff00ff', 'por el camino corto del círculo (magenta)');
    const sh = P.colorRamp('#3a7d44', null, 7, 'shades', 25), lum = sh.map((c) => { const [r, g, b] = P.hexToRgb(c); return r * 0.299 + g * 0.587 + b * 0.114; });
    A.eq(sh.length, 7); A.ok(lum.every((v, i) => i === 0 || v > lum[i - 1]), 'de oscuro a claro');
    A.eq(P.colorRamp('#123456', '#654321', 99, 'rgb').length, 32);
  });

  await testAsync('scalePixels: Scale2x/Scale3x suavizan una diagonal sin inventar colores', async () => {
    const P = await import(pathToFileURL(path.join(ROOT, 'studio/js/paintcore.js')).href);
    const hadID = 'ImageData' in globalThis;
    if (!hadID) globalThis.ImageData = class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } };
    try {
      // diagonal de 3 píxeles negros sobre blanco
      const src = new ImageData(3, 3); src.data.fill(255);
      [[0, 0], [1, 1], [2, 2]].forEach(([x, y]) => { const i = (y * 3 + x) * 4; src.data[i] = src.data[i + 1] = src.data[i + 2] = 0; });
      const px = (img, x, y) => img.data[(y * img.width + x) * 4]; // canal rojo: 0 negro, 255 blanco
      const x2 = P.scalePixels(src, 2); A.eq(x2.width, 6); A.eq(x2.height, 6);
      const row = (img, y) => Array.from({ length: img.width }, (_, x) => (px(img, x, y) ? '.' : '#')).join('');
      // la escalera de bloques 2×2 se convierte en una diagonal continua (las filas interiores no tienen huecos ni
      // escalones); en las puntas, pegadas al borde de la imagen, Scale2x recorta la esquina (reglas EPX estándar)
      A.eq([0, 1, 2, 3, 4, 5].map((y) => row(x2, y)).join('|'), '##....|#.#...|.###..|..###.|...#.#|....##');
      const colors = new Set(); for (let i = 0; i < x2.data.length; i += 4) colors.add(x2.data[i] + ',' + x2.data[i + 1] + ',' + x2.data[i + 2] + ',' + x2.data[i + 3]);
      A.eq(colors.size, 2, 'solo los colores originales');
      const x3 = P.scalePixels(src, 3); A.eq(x3.width, 9);
      const x4 = P.scalePixels(src, 4); A.eq(x4.width, 12); A.eq(x4.height, 12);
      // un píxel suelto (sin vecinos iguales) solo crece: bloque n×n
      const dot = new ImageData(3, 3); dot.data.fill(255); dot.data[16] = dot.data[17] = dot.data[18] = 0;
      A.eq([0, 1, 2, 3, 4, 5].map((y) => row(P.scalePixels(dot, 2), y)).join('|'), '......|......|..##..|..##..|......|......');
    } finally { if (!hadID) delete globalThis.ImageData; }
  });

  section('Studio: web3, eventos y backend generado');
  test('cleanWeb3: la red principal siempre es una de las permitidas y sin redes repetidas', () => {
    const w = S.cleanWeb3({ enabled: true, mode: 'wallet', chains: [84532, 84532, 'x', 11155111], defaultChain: 1, maxValue: '0.1', contracts: [] });
    A.eq(w.chains.join(','), '84532,11155111'); A.eq(w.defaultChain, 84532);
    A.eq(S.cleanWeb3({ chains: [], defaultChain: 999 }).defaultChain, 11155111);
    A.eq(S.cleanWeb3({ chains: [10, 8453], defaultChain: 8453 }).defaultChain, 8453);
  });
  test('Eventos con id repetido en un proyecto importado reciben ids únicos', () => {
    const p = S.createProject('P'), sc = S.createScene('2d'); p.scenes.push(sc); p.startScene = sc.id;
    const ev = { id: 'e1', enabled: true, conditions: [{ type: 'start', params: {} }], actions: [] };
    sc.events = [ev, Object.assign({}, ev), Object.assign({}, ev, { id: 'e2' })];
    const ids = S.cleanProject(JSON.parse(JSON.stringify(p))).scenes[0].events.map((e) => e.id);
    A.eq(ids.length, 3); A.eq(new Set(ids).size, 3); A.eq(ids[0], 'e1'); A.eq(ids[2], 'e2');
  });
  test('Solidity: muchas cabeceras «contract x» sin llaves no congelan el análisis (antes O(n²))', () => {
    require(path.join(ROOT, 'studio/shared/solidity.js')); const SOL = globalThis.UGStudio.solidity;
    const t0 = Date.now(); const r = SOL.parse('contract a '.repeat(27000)); const ms = Date.now() - t0;
    A.eq(r.contracts.length, 0); A.ok(ms < 1500, 'tardó ' + ms + ' ms');
    const abi = SOL.abiFor('contract Fwd; interface I { function f() external; } contract C is I { uint public x; }', 'C').abi;
    A.eq(abi.map((f) => f.name).sort().join(','), 'f,x');
  });
  await testAsync('Backend generado: UG_TRUST_PROXY aplica el límite por la IP real (X-Forwarded-For)', async () => {
    const Bk = require(path.join(ROOT, 'studio/shared/backend.js'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ugs-be-'));
    const project = { name: 'P', backend: { routes: [{ id: 'r1', method: 'POST', path: '/api/p', rateLimit: 1, auth: false, code: 'return { ip: ctx.ip };' }], cors: [] } };
    Bk.files(project).forEach((f) => { fs.mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true }); fs.writeFileSync(path.join(dir, f.path), f.text); });
    const run = async (env) => {
      const c = spawn(process.execPath, ['server.js'], { cwd: dir, env: Object.assign({}, process.env, { PORT: '0', HOST: '127.0.0.1' }, env), stdio: ['ignore', 'pipe', 'ignore'] });
      const port = await new Promise((res, rej) => { let out = ''; const t = setTimeout(() => rej(new Error('el backend no arrancó')), 8000); c.stdout.on('data', (d) => { out += d; const m = /UG_BACKEND_READY (\{.*\})/.exec(out); if (m) { clearTimeout(t); res(JSON.parse(m[1]).port); } }); });
      const post = (xff) => new Promise((res) => { const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/p', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff } }, (x) => { let t = ''; x.on('data', (d) => (t += d)); x.on('end', () => res({ status: x.statusCode, body: t })); }); r.end('{}'); });
      const out = [await post('1.1.1.1'), await post('2.2.2.2'), await post('9.9.9.9, 3.3.3.3')];
      c.kill(); return out;
    };
    try {
      const direct = await run({});
      A.eq(direct.map((r) => r.status).join(','), '200,429,429', 'sin proxy de confianza la cabecera se ignora');
      A.eq(JSON.parse(direct[0].body).ip, '127.0.0.1');
      const proxied = await run({ UG_TRUST_PROXY: '1' });
      A.eq(proxied.map((r) => r.status).join(','), '200,200,200');
      A.eq(proxied.map((r) => JSON.parse(r.body).ip).join(','), '1.1.1.1,2.2.2.2,3.3.3.3', 'la IP que añadió el proxy (la última)');
    } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* temporal */ } }
  });

  section('Studio: servidor local (seguridad)');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ugs-test-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'tools/studio-server.js'), '--no-open', '--port', '0', '--workspace', ws], { stdio: ['ignore', 'pipe', 'pipe'] });
  let outText = '';
  const info = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('el servidor no arrancó')), 8000);
    child.stdout.on('data', (d) => { outText += d; const m = /http:\/\/127\.0\.0\.1:(\d+)\/studio\/\?t=([0-9a-f]+)/.exec(outText); if (m) { clearTimeout(t); resolve({ port: +m[1], token: m[2] }); } });
    child.on('exit', (c) => reject(new Error('el servidor terminó: ' + c)));
  }).catch((e) => { test('arranque del servidor', () => { throw e; }); return null; });
  const req = (method, p, o) => new Promise((resolve) => {
    o = o || {};
    const headers = Object.assign({ Host: '127.0.0.1:' + info.port }, o.headers || {});
    if (o.auth !== false) headers.Cookie = 'ug_studio=' + info.token;
    if (o.api !== false) headers['X-UG-Studio'] = '1';
    if (o.origin !== false && method !== 'GET' && !headers.Origin) headers.Origin = 'http://127.0.0.1:' + info.port;
    const body = o.body === undefined ? null : (Buffer.isBuffer(o.body) ? o.body : Buffer.from(typeof o.body === 'string' ? o.body : JSON.stringify(o.body)));
    if (body) { if (!headers['Content-Length'] && !o.chunked) headers['Content-Length'] = body.length; if (o.json !== false && !headers['Content-Type']) headers['Content-Type'] = 'application/json'; }
    const r = http.request({ host: '127.0.0.1', port: info.port, method, path: p, headers }, (res) => { const ch = []; res.on('data', (c) => ch.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(ch).toString('utf8') })); });
    r.on('error', (e) => resolve({ status: 0, body: String(e) }));
    if (body) r.write(body); r.end();
  });
  if (info) {
    const proj = { format: 'ultragame-project', name: 'Prueba Ñandú', scenes: [{ kind: '2d' }] };
    await testAsync('Sesión: el token solo vale para crear la cookie; sin cookie la API responde 401', async () => {
      A.eq((await req('GET', '/studio/?t=malo', { auth: false })).status, 401);
      const ok = await req('GET', '/studio/?t=' + info.token, { auth: false }); A.eq(ok.status, 302); A.ok(/HttpOnly/.test(ok.headers['set-cookie']) && /SameSite=Strict/.test(ok.headers['set-cookie']));
      A.eq((await req('GET', '/api/projects', { auth: false })).status, 401);
      A.eq((await req('GET', '/api/projects', { headers: { Cookie: 'ug_studio=' + 'a'.repeat(48) }, auth: false })).status, 401);
    });
    await testAsync('CSRF y DNS rebinding: cabecera propia, Origin y Host obligatorios', async () => {
      A.eq((await req('GET', '/api/projects', { api: false })).status, 403);
      A.eq((await req('POST', '/api/projects', { origin: false, body: { project: proj } })).status, 403);
      A.eq((await req('POST', '/api/projects', { headers: { Origin: 'http://evil.com' }, body: { project: proj } })).status, 403);
      A.eq((await req('GET', '/api/projects', { headers: { Host: 'evil.com' } })).status, 421);
      A.eq((await req('POST', '/api/projects', { headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ project: proj }) })).status, 415);
    });
    let id = null;
    await testAsync('Proyectos: crear (nombre -> carpeta segura), listar, guardar con copia .bak', async () => {
      const r = await req('POST', '/api/projects', { body: { project: proj } }); A.eq(r.status, 200); id = JSON.parse(r.body).id; A.eq(id, 'prueba-nandu');
      A.eq((await req('POST', '/api/projects', { body: { project: { format: 'x' } } })).status, 400);
      const l = JSON.parse((await req('GET', '/api/projects')).body).projects; A.eq(l[0].name, 'Prueba Ñandú');
      A.eq((await req('PUT', '/api/project?p=' + id, { body: Object.assign({}, proj, { name: 'Otro' }) })).status, 200);
      A.ok(fs.existsSync(path.join(ws, id, 'project.json.bak')));
      A.eq((await req('GET', '/api/project?p=../etc')).status, 400); A.eq((await req('GET', '/api/project?p=__proto__')).status, 400);
    });
    await testAsync('Archivos: lista blanca de extensiones, sin recorrido de rutas, servidos con CSP sandbox', async () => {
      A.eq((await req('PUT', '/api/file?p=' + id + '&f=assets/a.png', { body: Buffer.from([137, 80, 78, 71]), json: false })).status, 200);
      for (const bad of ['assets/x.exe', 'assets/../../x.png', 'assets/a/b.png', 'assets/x.html', 'x.png', 'assets/.htaccess']) A.eq((await req('PUT', '/api/file?p=' + id + '&f=' + encodeURIComponent(bad), { body: 'x', json: false })).status, 400, bad);
      const g = await req('GET', '/api/file?p=' + id + '&f=assets/a.png', { api: false });
      A.eq(g.status, 200); A.ok(/sandbox/.test(g.headers['content-security-policy'])); A.eq(g.headers['content-disposition'], 'attachment'); A.eq(g.headers['x-content-type-options'], 'nosniff');
      A.eq((await req('GET', '/api/file?p=' + id + '&f=assets/a.png', { auth: false, api: false })).status, 401);
    });
    await testAsync('Exportación confinada a export/ y borrado a la papelera', async () => {
      for (const bad of ['../x.js', '/etc/x.js', 'x.exe', 'a//b.js', './a.js']) A.eq((await req('POST', '/api/export?p=' + id, { body: { files: [{ path: bad, data: 'eA==' }] } })).status, 400, bad);
      A.eq((await req('POST', '/api/export?p=' + id, { body: { files: [{ path: 'index.html', data: 'aG9sYQ==' }, { path: 'js/a.js', data: 'eA==' }] } })).status, 200);
      A.eq(fs.readFileSync(path.join(ws, id, 'export', 'index.html'), 'utf8'), 'hola');
      A.eq((await req('DELETE', '/api/file?p=' + id + '&f=assets/a.png')).status, 200);
      A.ok(!fs.existsSync(path.join(ws, id, 'assets', 'a.png')) && fs.readdirSync(path.join(ws, '.trash')).length >= 1);
    });
    await testAsync('Tamaños y estáticos: 413 al superar el límite; fuera de las carpetas públicas no se sirve nada', async () => {
      A.eq((await req('PUT', '/api/project?p=' + id, { headers: { 'Content-Length': '99999999' }, body: '{}' })).status, 413);
      // sin Content-Length (troceado) y más grande que el límite de 16 MB: también 413, y el servidor sigue vivo
      A.eq((await req('PUT', '/api/project?p=' + id, { chunked: true, body: Buffer.alloc(17 * 1024 * 1024, 32) })).status, 413);
      A.eq((await req('GET', '/api/info')).status, 200);
      A.eq((await req('GET', '/tools/studio-server.js', { auth: false, api: false })).status, 404);
      A.eq((await req('GET', '/studio/..%2f..%2ftools/studio-server.js', { auth: false, api: false })).status, 403);
      const st = await req('GET', '/studio/', { auth: false, api: false }); A.eq(st.status, 200); A.ok(/script-src 'self'/.test(st.headers['content-security-policy']));
      const pl = await req('GET', '/studio/player.html', { auth: false, api: false }); A.ok(/default-src 'none'/.test(pl.headers['content-security-policy']));
    });
  }
  child.kill();
  try { fs.rmSync(ws, { recursive: true, force: true }); } catch (e) { /* temporal */ }
};
