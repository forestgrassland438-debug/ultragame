#!/usr/bin/env node
'use strict';
/* node --test tests/node-tests-export.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
const UG = require('../dist/ultragame.js');
const S = require('../studio/shared/schema.js');
globalThis.window = globalThis;
globalThis.UG = UG;
globalThis.UGStudio = { schema: S };
require('../studio/runtime/runtime.js');
const R = globalThis.UGStudio.runtime;
const X = import(pathToFileURL(path.join(ROOT, 'studio/js/export.js')).href);
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const buffer = (s) => Uint8Array.from(Buffer.from(s)).buffer;
function appFixture(assets = [], data = async (_id, name) => buffer(name)) {
  const p = S.createProject('Juego exportado'); const sc = S.createScene('2d'); p.scenes.push(sc); p.startScene = sc.id;
  p.assets = assets;
  const app = { editor: { project: p, projectId: 'first', store: { assetData: data } }, code: { commit: { flush() {} } },
    player: { scripts(project) { return project.scripts.map((s) => ({ id: s.id, source: R.wrapScript(s.id, s.code) })); } } };
  return app;
}
const asset = (id, file) => ({ id, file, name: id });
async function withSources(fn) {
  const old = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, text: async () => '// ' + url });
  try { return await fn(); } finally { globalThis.fetch = old; }
}

test('HTML único conserva scripts con comentarios HTML y String.raw sin romper etiquetas', async () => withSources(async () => {
  const x = await X, app = appFixture([asset('a', 'assets/a.bin')]);
  app.editor.project.scripts.push({ id: 'raw', name: 'Raw', code: '<!-- comentario válido en JS clásico\nvar literal = String.raw`</script><!--`;\nfunction onStart() { return literal; }' });
  const html = await (await x.buildSingleHTML(app)).text();
  assert.ok(html.includes('height:100dvh')); assert.ok(html.includes('touch-action:none'));
  const scripts = Array.from(html.matchAll(/<script src="data:text\/javascript;charset=utf-8;base64,([^"]+)"><\/script>/g), (m) => Buffer.from(m[1], 'base64').toString('utf8'));
  assert.equal(scripts.length, 6);
  let hooks; const context = { window: {}, UGStudio: { runtime: { registerScript: (_id, fn) => { hooks = fn({}, {}, null); } } } };
  scripts.forEach((s) => vm.runInNewContext(s, context));
  assert.equal(hooks.onStart(), '</script><!--');
  // los recursos van en un bloque JSON (no ejecutable) y no dentro de un script
  const block = /<script type="application\/json" id="ugs-assets">([^<]*)<\/script>/.exec(html);
  assert.ok(block, 'falta el bloque de recursos');
  assert.equal(Buffer.from(JSON.parse(block[1]).a.split(',')[1], 'base64').toString(), 'assets/a.bin');
}));

test('La exportación fija proyecto y almacén aunque cambie el editor durante await', async () => withSources(async () => {
  const x = await X, d = deferred(), ids = [];
  const app = appFixture([asset('a', 'assets/a.bin'), asset('b', 'assets/b.bin')], async (id, file) => { ids.push(id); if (ids.length === 1) await d.promise; return buffer(file); });
  const pending = x.buildWebFiles(app);
  while (!ids.length) await Promise.resolve();
  app.editor.projectId = 'second'; app.editor.project.name = 'Otro'; d.resolve();
  const result = await pending;
  assert.deepEqual(ids, ['first', 'first']); assert.equal(result.projectId, 'first'); assert.equal(result.project.name, 'Juego exportado');
}));

test('Una ruta de recurso compartida solo se lee y se escribe una vez en el ZIP', async () => withSources(async () => {
  const x = await X; let reads = 0;
  const app = appFixture([asset('a', 'assets/a.png'), asset('b', 'assets/a.png')], async () => { reads++; return buffer('image'); });
  const { files } = await x.buildWebFiles(app);
  assert.equal(reads, 1); assert.equal(files.filter((f) => f.path === 'assets/a.png').length, 1);
  assert.equal(new DataView(await x.makeZip(files).arrayBuffer()).getUint32(0, true), 0x04034b50);
}));

test('Exportar informa el nombre del archivo perdido y rechaza juegos sin escenas', async () => withSources(async () => {
  const x = await X, app = appFixture([asset('a', 'assets/missing.png')], async () => { throw new Error('404'); });
  await assert.rejects(x.buildWebFiles(app), /assets\/missing\.png/);
  app.editor.project.scenes = []; await assert.rejects(x.buildSingleHTML(app), /escena/);
}));

test('Importar un bundle dañado no elimina sus recursos silenciosamente', async () => {
  const x = await X, app = appFixture([asset('a', 'assets/a.bin')]);
  const bundle = (files, version = 1) => new Blob([JSON.stringify({ format: 'ultragame-project-bundle', version, project: app.editor.project, files })]);
  await assert.rejects(x.readProjectFile(bundle({})), /no contiene/);
  await assert.rejects(x.readProjectFile(bundle({ 'assets/a.bin': '*invalid*' })), /dañado/);
  await assert.rejects(x.readProjectFile(bundle({}, 2)), /versión/);
  const valid = await x.readProjectFile(bundle({ 'assets/a.bin': 'aG9sYQ==' }));
  assert.equal(await valid.files[0].blob.text(), 'hola'); assert.equal(valid.project.assets.length, 1);
});

test('Exportar proyecto también fija el id y permite importar todos sus bytes', async () => {
  const x = await X, d = deferred(), ids = [];
  const app = appFixture([asset('a', 'assets/a.bin'), asset('b', 'assets/b.bin')], async (id, f) => { ids.push(id); if (ids.length === 1) await d.promise; return buffer(f); });
  const pending = x.buildProjectFile(app); app.editor.projectId = 'second'; d.resolve();
  const restored = await x.readProjectFile(await pending);
  assert.deepEqual(ids, ['first', 'first']); assert.equal(restored.files.length, 2);
});

test('Hardhat recibe los contratos dentro de su propia carpeta contracts', async () => withSources(async () => {
  const x = await X, app = appFixture();
  app.editor.project.web3.contracts = [{ id: 'token', name: 'Token', source: 'contract Token {}', abi: '[]' }];
  const previous = globalThis.UGStudio.solidity;
  globalThis.UGStudio.solidity = { hardhatFiles: () => [{ path: 'contracts/Token.sol', text: 'contract Token {}' }, { path: 'hardhat.config.js', text: 'module.exports={};' }] };
  try {
    const { files } = await x.buildWebFiles(app);
    assert.ok(files.some((f) => f.path === 'contracts/Token.sol'));
    assert.ok(files.some((f) => f.path === 'contracts/hardhat/contracts/Token.sol'));
  } finally { globalThis.UGStudio.solidity = previous; }
}));

test('El arranque exportado muestra los errores asíncronos del motor', async () => {
  const d = deferred(), elements = [];
  const document = { getElementById: (id) => elements.find((e) => e.id === id), createElement: () => ({ style: {}, setAttribute() {} }), body: { appendChild: (e) => elements.push(e) } };
  const window = { UGS_PROJECT: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'studio/runtime/boot.js'), 'utf8'), { window, document, URLSearchParams, location: { search: '' }, UGStudio: { runtime: { start: () => ({ ready: d.promise }) } } });
  d.resolve(); await Promise.resolve(); assert.equal(elements.length, 0);
  const failed = deferred();
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'studio/runtime/boot.js'), 'utf8'), { window, document, URLSearchParams, location: { search: '' }, UGStudio: { runtime: { start: () => ({ ready: failed.promise }) } } });
  failed.promise.catch(() => {}); // La promesa se rechaza intencionadamente para comprobar la UI.
  // deferred de este test solo expone resolve; resolver con una promesa rechazada adopta el fallo.
  failed.resolve(Promise.reject(new Error('Sin GPU disponible')));
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(elements.length, 1); assert.match(elements[0].textContent, /Sin GPU disponible/);
});

function sourceLoader(extra = {}) {
  const context = Object.assign({ UG: {}, EventEmitter: UG.EventEmitter, Security: UG.Security, Log: { warn() {} }, TextDecoder, Uint8Array, ArrayBuffer, Blob,
    base64ToBytes: (s) => Uint8Array.from(Buffer.from(s, 'base64')), toBytes: (s) => Uint8Array.from(Buffer.from(s)), setTimeout, clearTimeout, AbortController, fetch }, extra);
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src/loader.js'), 'utf8'), context);
  const game = { config: {}, cache: new context.UG.CacheManager(), textures: { exists: () => false }, sound: {} };
  return { L: new context.UG.Loader(game), game, context };
}

test('Loader conserva la base lógica de glTF y resuelve su binario desde data:', async () => {
  const h = sourceLoader({ GLTF: { async parse(bytes, opts) {
    assert.equal(opts.baseURL, 'assets/'); assert.equal(Buffer.from(bytes).toString(), 'model');
    assert.equal(Buffer.from(await opts.loader.fetchBytes(opts.baseURL + 'mesh.bin')).toString(), 'vertices');
    return { name: 'mesh' };
  } } });
  const urls = { 'assets/model.gltf': 'data:application/json;base64,bW9kZWw=', 'assets/mesh.bin': 'data:application/octet-stream;base64,dmVydGljZXM=' };
  h.L.setURLResolver((u) => urls[u] || u);
  await h.L._load({ type: 'gltf', key: 'm', url: 'assets/model.gltf' });
  assert.equal(h.game.cache.models.get('m').name, 'mesh');
});

test('Loader resuelve imágenes, fuentes y audio HTML5 sin descargar rutas inexistentes', async () => {
  const images = [], fonts = [], audio = [];
  class Image { set src(value) { images.push(value); queueMicrotask(() => this.onload()); } }
  class FontFace { constructor(_name, source) { fonts.push(source); } load() { return Promise.resolve(this); } }
  const h = sourceLoader({ Image, FontFace, document: { fonts: { add() {} } } });
  h.game.sound = { disabled: false, useHTML5: true, _ensureContext() {}, addHTML5(_key, url) { audio.push(url); } };
  h.L.setURLResolver((url) => ({ 'assets/a.png': 'data:image/png;base64,eA==', 'assets/a.woff': 'data:font/woff;base64,eA==', 'assets/a.wav': 'data:audio/wav;base64,eA==' })[url] || url);
  await h.L.loadImageElement('assets/a.png');
  await h.L._load({ type: 'font', key: 'font', url: 'assets/a.woff' });
  await h.L._load({ type: 'audio', key: 'audio', url: 'assets/a.wav' });
  assert.deepEqual(images, ['data:image/png;base64,eA==']); assert.match(fonts[0], /^url\("data:font\/woff/); assert.deepEqual(audio, ['data:audio/wav;base64,eA==']);
});

test('Loader vuelve a validar URLs después del resolvedor', async () => {
  const h = sourceLoader(); h.L.setURLResolver(() => 'javascript:alert(1)');
  await assert.rejects(h.L.fetchBytes('assets/a.bin'), /bloqueada/);
  await assert.rejects(h.L.loadImageElement('assets/a.png'), /bloqueada/);
});

test('Integración: un glTF real con .bin externo carga desde recursos embebidos', async () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const json = { asset: { version: '2.0' }, buffers: [{ uri: 'mesh.bin', byteLength: positions.byteLength }], bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };
  const h = sourceLoader({ GLTF: UG.GLTF });
  const urls = { 'assets/model.gltf': 'data:application/json;base64,' + Buffer.from(JSON.stringify(json)).toString('base64'), 'assets/mesh.bin': 'data:application/octet-stream;base64,' + Buffer.from(positions.buffer).toString('base64') };
  h.L.setURLResolver((u) => urls[u] || u);
  const model = await h.L._load({ type: 'gltf', key: 'm', url: 'assets/model.gltf' });
  assert.equal(model.nodes[0].geometry.vertexCount, 3); model.destroy();
});

test('Integración: OBJ obtiene su MTL externo y conserva el material', async () => {
  const h = sourceLoader({ OBJ: UG.OBJ });
  const files = { 'assets/model.obj': 'mtllib model.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl red\nf 1 2 3\n', 'assets/model.mtl': 'newmtl red\nKd 1 0 0\n' };
  h.L.setURLResolver((u) => Object.hasOwn(files, u) ? 'data:text/plain;base64,' + Buffer.from(files[u]).toString('base64') : u);
  const model = await h.L._load({ type: 'obj', key: 'm', url: 'assets/model.obj' });
  assert.equal(model.materials[0].color, 0xff0000); model.destroy();
});

test('Integración: Tiled obtiene un tileset externo embebido', async () => {
  const h = sourceLoader({ TiledParser: UG.TiledParser });
  const files = { 'assets/map.tmj': { type: 'map', orientation: 'orthogonal', width: 1, height: 1, tilewidth: 16, tileheight: 16, tilesets: [{ firstgid: 1, source: 'tiles.tsj' }], layers: [{ type: 'tilelayer', name: 'Ground', width: 1, height: 1, data: [1] }] },
    'assets/tiles.tsj': { name: 'Tiles', tilewidth: 16, tileheight: 16, tilecount: 1, columns: 1, image: 'tiles.png', imagewidth: 16, imageheight: 16 } };
  h.L.setURLResolver((u) => Object.hasOwn(files, u) ? 'data:application/json;base64,' + Buffer.from(JSON.stringify(files[u])).toString('base64') : u);
  const map = await h.L._load({ type: 'tilemap', format: 'json', key: 'm', url: 'assets/map.tmj' });
  assert.equal(map.tilesets[0].name, 'Tiles'); assert.equal(map.baseURL, 'assets/');
});

test('El runtime configura el resolvedor con los nombres originales del proyecto', () => {
  const original = UG.Game; let config;
  UG.Game = class { constructor(c) { config = c; } on() {} once() {} };
  const app = appFixture([asset('m', 'assets/model.gltf'), asset('b', 'assets/mesh.bin'), asset('p', 'assets/photo one.png')]);
  const h = sourceLoader();
  try {
    R.start(app.editor.project, { assetURL: (a) => 'data:application/octet-stream;base64,' + Buffer.from(a.id).toString('base64') });
    config.scenes[0].preload.call({ game: { width: 800, height: 600 }, load: h.L, add: { graphics: () => ({}) } });
    assert.equal(h.L.queue.find((f) => f.key === 'm').url, 'assets/model.gltf');
    assert.equal(h.L.resolveURL('assets/mesh.bin'), 'data:application/octet-stream;base64,Yg==');
    assert.equal(h.L.resolveURL('assets/photo%20one.png'), 'data:application/octet-stream;base64,cA==');
    assert.equal(h.L.resolveURL('https://other.test/photo.png'), 'https://other.test/photo.png');
  } finally { UG.Game = original; }
});
