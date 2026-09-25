#!/usr/bin/env node
'use strict';
/* Run with: node --test tests/node-tests-studio-regressions.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function playerHarness(assets = [], assetData = async () => new ArrayBuffer(1)) {
  const listeners = new Map(), frames = [], sent = [], logs = [], timers = new Map();
  const host = { appendChild(f) { frames.push(f); } };
  const window = { UGStudio: { runtime: { wrapScript: () => '' } },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); }
  };
  const document = { getElementById: () => host, createElement: () => ({ setAttribute() {}, contentWindow: { postMessage: (m) => sent.push(m) }, focus() {}, remove() { frames.splice(frames.indexOf(this), 1); } }) };
  const app = { editor: { projectId: 'one', project: { name: 'One', scripts: [], scenes: [], assets }, assetVersion: {}, sceneId: 'first', scene: { name: 'First' }, store: { assetData } },
    code: { commit: { flush() {} }, errors: new Map() }, console: { clear() {}, log(...a) { logs.push(a); } }, setPlaying() {}, rendererChoice: () => 'canvas' };
  const context = { window, document, location: { origin: 'http://127.0.0.1:5210' }, toast() {},
    setTimeout(fn) { const id = timers.size + 1; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } };
  const src = fs.readFileSync(path.join(ROOT, 'studio/js/play.js'), 'utf8').replace(/^import .*;\r?\n/m, '').replace('export class Player', 'class Player');
  vm.runInNewContext(src + '\nglobalThis.Player = Player;', context);
  const player = new context.Player(app);
  return { player, app, frames, sent, listeners, message(m) { for (const fn of listeners.get('message') || []) fn({ source: player.frame.contentWindow, data: m }); } };
}

test('Studio: Detener cancela la carga pendiente antes de crear el iframe', async () => {
  const d = deferred(), h = playerHarness([{ id: 'a', file: 'assets/a.png' }], () => d.promise);
  const pending = h.player.play(false); h.player.stop(); d.resolve(new ArrayBuffer(1)); await pending;
  assert.equal(h.frames.length, 0); assert.equal(h.player.playing, false);
});

test('Studio: dos solicitudes Jugar solapadas conservan solo la más reciente', async () => {
  const a = deferred(), b = deferred(); let calls = 0;
  const h = playerHarness([{ id: 'a', file: 'assets/a.png' }], () => (++calls === 1 ? a.promise : b.promise));
  const first = h.player.play(false), second = h.player.play(false);
  b.resolve(new ArrayBuffer(1)); await second; const newest = h.player.frame;
  a.resolve(new ArrayBuffer(1)); await first;
  assert.equal(h.frames.length, 1); assert.equal(h.player.frame, newest); assert.equal(h.listeners.get('message').size, 1);
});

test('Studio: un ready duplicado no reinicia la partida', async () => {
  const h = playerHarness(); await h.player.play(false);
  h.message({ type: 'ready' }); h.message({ type: 'ready' });
  assert.equal(h.sent.length, 1); assert.equal(h.sent[0].type, 'run');
});

test('Studio: la escena y el proyecto se fijan antes de la carga asíncrona', async () => {
  const d = deferred(), h = playerHarness([{ id: 'a', file: 'assets/a.png' }], () => d.promise);
  const pending = h.player.play(true); h.app.editor.sceneId = 'second'; d.resolve(new ArrayBuffer(1)); await pending;
  h.message({ type: 'ready' }); assert.equal(h.sent[0].startScene, 'first');
  h.player.clearCache(); const switched = h.player.play(false); h.app.editor.projectId = 'two'; await switched;
  assert.equal(h.frames.length, 0);
});

test('Studio: los recursos de dos proyectos con el mismo nombre no comparten caché', async () => {
  const ids = [], h = playerHarness([{ id: 'a', file: 'assets/a.png' }], async (id) => { ids.push(id); return new ArrayBuffer(1); });
  await h.player.play(false); h.app.editor.projectId = 'two'; await h.player.play(false);
  assert.deepEqual(ids, ['one', 'two']);
});

function runtimeHarness() {
  const messages = [], listeners = new Map(), games = [];
  const parent = { postMessage: (m) => messages.push(m) };
  const window = { parent, focus() {}, addEventListener(type, fn) { listeners.set(type, fn); } };
  const UGStudio = { runtime: { resetScripts() {}, start() { const d = deferred(); const game = { ready: d.promise, rendererType: 'canvas', destroy() {} }; games.push({ game, ...d }); return game; } } };
  window.UGStudio = UGStudio;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'studio/runtime/player.js'), 'utf8'), {
    window, UGStudio, location: { hash: '#origin=http%3A%2F%2F127.0.0.1%3A5210' }, console: { log() {}, info() {}, warn() {}, error() {} },
    document: { querySelectorAll: () => [], getElementById: () => ({ firstChild: null }) }, URL: { revokeObjectURL() {} }, setTimeout, clearTimeout, ArrayBuffer
  });
  return { games, messages, message(m) { listeners.get('message')({ source: parent, origin: 'http://127.0.0.1:5210', data: m }); } };
}

test('Studio runtime: una promesa ready vieja no anuncia otra partida', async () => {
  const h = runtimeHarness(); h.message({ type: 'run' }); await Promise.resolve();
  h.message({ type: 'run' }); await Promise.resolve();
  h.games[0].resolve(); await Promise.resolve(); assert.equal(h.messages.filter((m) => m.type === 'started').length, 0);
  h.games[1].resolve(); await Promise.resolve(); assert.equal(h.messages.filter((m) => m.type === 'started').length, 1);
});

test('Studio runtime: un fallo asíncrono de arranque se comunica como failed', async () => {
  const h = runtimeHarness(); h.message({ type: 'run' }); await Promise.resolve();
  h.games[0].reject(new Error('renderer unavailable')); await Promise.resolve();
  assert.equal(h.messages.filter((m) => m.type === 'failed').length, 1);
});

function request(port, route, opts = {}) {
  return new Promise((resolve, reject) => {
    const body = opts.body === undefined ? null : Buffer.from(opts.body);
    const headers = Object.assign({ Host: '127.0.0.1:' + port }, opts.headers);
    if (body) headers['Content-Length'] = body.length;
    const req = http.request({ host: '127.0.0.1', port, path: route, method: opts.method || 'GET', headers }, (res) => {
      const chunks = []; res.on('data', (d) => chunks.push(d)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end(body);
  });
}
async function freePort() {
  const s = net.createServer(); await new Promise((r) => s.listen(0, '127.0.0.1', r)); const port = s.address().port;
  await new Promise((r) => s.close(r)); return port;
}
async function startServer(file, args, pattern) {
  const child = spawn(process.execPath, [file, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  try {
    const match = await new Promise((resolve, reject) => {
      let output = ''; const timer = setTimeout(() => reject(new Error('Servidor no inició: ' + output)), 8000);
      child.stdout.on('data', (d) => { output += d; const m = pattern.exec(output); if (m) { clearTimeout(timer); resolve(m); } });
      child.stderr.on('data', (d) => { output += d; }); child.once('exit', (code) => { clearTimeout(timer); reject(new Error('Servidor terminó: ' + code + ' ' + output)); });
    });
    return { child, match };
  } catch (e) { child.kill(); throw e; }
}
async function stopServer(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((r) => child.once('exit', r)); child.kill(); await exited;
}

test('Servidores: los enlaces y junctions no permiten salir de sus carpetas', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-studio-regressions-'));
  const app = path.join(base, 'app'), ws = path.join(base, 'projects'), outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(app, 'tools'), { recursive: true }); fs.mkdirSync(path.join(app, 'assets')); fs.mkdirSync(path.join(app, 'docs'));
  fs.mkdirSync(path.join(ws, 'normal', 'assets'), { recursive: true }); fs.mkdirSync(outside);
  for (const name of ['studio-server.js', 'server.js', 'path-safety.js']) fs.copyFileSync(path.join(ROOT, 'tools', name), path.join(app, 'tools', name));
  const proj = { format: 'ultragame-project', name: 'Normal', scenes: [] };
  fs.writeFileSync(path.join(ws, 'normal', 'project.json'), JSON.stringify(proj));
  fs.writeFileSync(path.join(outside, 'project.json'), JSON.stringify(proj)); fs.writeFileSync(path.join(outside, 'proof.png'), 'PRIVATE');
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(outside, path.join(app, 'assets', 'linked'), linkType);
  fs.symlinkSync(outside, path.join(app, 'docs', 'media'), linkType);
  fs.symlinkSync(outside, path.join(ws, 'linked'), linkType);
  let studio, dev;
  try {
    studio = await startServer(path.join(app, 'tools/studio-server.js'), ['--no-open', '--port', '0', '--workspace', ws], /http:\/\/127\.0\.0\.1:(\d+)\/studio\/\?t=([0-9a-f]+)/);
    const port = +studio.match[1], token = studio.match[2];
    const api = (route, method = 'GET', body) => request(port, route, { method, body, headers: { Cookie: 'ug_studio=' + token, 'X-UG-Studio': '1', Origin: 'http://127.0.0.1:' + port, 'Content-Type': 'application/json' } });
    await t.test('Studio rechaza tokens Unicode incorrectos y JSON null con códigos de cliente', async () => {
      assert.equal((await request(port, '/studio/?t=' + encodeURIComponent('é'.repeat(48)))).status, 401);
      assert.equal((await api('/api/projects', 'POST', 'null')).status, 400);
    });
    await t.test('Studio no sirve archivos estáticos ni proyectos enlazados fuera del workspace', async () => {
      assert.equal((await request(port, '/assets/linked/proof.png')).status, 403);
      assert.equal((await api('/api/project?p=linked')).status, 400);
      assert.equal((await api('/api/project?p=linked', 'PUT', JSON.stringify(proj))).status, 404);
    });
    await t.test('Studio bloquea lectura y escritura por una carpeta assets enlazada', async () => {
      fs.rmdirSync(path.join(ws, 'normal', 'assets')); fs.symlinkSync(outside, path.join(ws, 'normal', 'assets'), linkType);
      assert.equal((await api('/api/file?p=normal&f=assets/proof.png')).status, 400);
      assert.equal((await api('/api/file?p=normal&f=assets/proof.png', 'PUT', 'CHANGED')).status, 400);
      assert.equal(fs.readFileSync(path.join(outside, 'proof.png'), 'utf8'), 'PRIVATE');
    });
    await t.test('Studio no mueve proyectos a una papelera enlazada fuera del workspace', async () => {
      fs.symlinkSync(outside, path.join(ws, '.trash'), linkType);
      assert.equal((await api('/api/project?p=normal', 'DELETE')).status, 403);
      assert.ok(fs.existsSync(path.join(ws, 'normal', 'project.json')));
    });
    const devPort = await freePort();
    dev = await startServer(path.join(app, 'tools/server.js'), ['--port', String(devPort), '--allow-save'], /dev server ->/);
    await t.test('El servidor de juegos tampoco permite lectura ni guardado por junctions', async () => {
      assert.equal((await request(devPort, '/assets/linked/proof.png')).status, 403);
      assert.equal((await request(devPort, '/__save?dir=media&name=proof.png', { method: 'POST', body: 'CHANGED', headers: { Origin: 'http://127.0.0.1:' + devPort } })).status, 403);
      assert.equal(fs.readFileSync(path.join(outside, 'proof.png'), 'utf8'), 'PRIVATE');
    });
  } finally {
    if (studio) await stopServer(studio.child); if (dev) await stopServer(dev.child);
    // Solo se borra el temporal creado arriba; rm no sigue los enlaces de directorio.
    assert.equal(path.dirname(base), path.resolve(os.tmpdir())); assert.ok(path.basename(base).startsWith('ug-studio-regressions-'));
    fs.rmSync(base, { recursive: true, force: true });
  }
});
