#!/usr/bin/env node
/* UltraGame Studio — servidor local del editor (Node puro, sin dependencias).
 *
 * Uso:  node tools/studio-server.js [--port 5210] [--workspace <carpeta>] [--no-open] [--browser <ruta>]
 *       (o haz doble clic en "UltraGame Studio.cmd" en Windows / ejecuta ./studio.sh en macOS y Linux)
 *
 * Abre el editor en una ventana de aplicación de Edge/Chrome (--app, sin barras del navegador).
 *
 * Seguridad (el editor escribe archivos en tu disco, así que todo está cerrado por defecto):
 *  - Solo escucha en 127.0.0.1 y rechaza cabeceras Host distintas de localhost/127.0.0.1 (DNS rebinding).
 *  - Token aleatorio por sesión: el enlace de arranque lo cambia por una cookie HttpOnly + SameSite=Strict,
 *    así que ninguna otra web abierta en el navegador puede usar la API (no se le envía la cookie).
 *  - La API exige además la cabecera X-UG-Studio (obliga a CORS con preflight, que nunca se aprueba) y,
 *    en escrituras, Origin igual al del propio servidor.
 *  - Rutas confinadas al espacio de trabajo (ids y nombres validados, resolución + comprobación de prefijo).
 *  - Lista blanca de extensiones, límites de tamaño, escritura atómica (temporal + rename) y copia .bak.
 *  - Los archivos de proyecto se sirven con CSP "sandbox", nosniff y como descarga: un SVG/HTML subido
 *    no puede ejecutar código en el origen del editor.
 *  - Borrar = mover a .trash (recuperable). Nada se ejecuta con shell.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { isSafePath } = require('./path-safety');
const officeConverter = require('./office-converter');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const argVal = (name, def) => { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : def; };
const PORT_ARG = Number(argVal('--port', '5210'));
const WORKSPACE = path.resolve(argVal('--workspace', path.join(ROOT, 'projects')));
const recoveryStore = require('./recovery-store')(WORKSPACE);
const NO_OPEN = args.includes('--no-open');
const BROWSER = argVal('--browser', null);
const TOKEN = crypto.randomBytes(24).toString('hex');
const COOKIE = 'ug_studio';
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '1.0.0'; } catch (e) { return '1.0.0'; } })();

const LIMITS = { project: 16 * 1024 * 1024, asset: 64 * 1024 * 1024, export: 256 * 1024 * 1024 };
/* carpetas estáticas que el editor necesita (el resto del repositorio no se sirve) */
const STATIC_DIRS = ['studio', 'dist', 'assets', 'assets3d', 'docs', 'types'];
const ASSET_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'mp3', 'ogg', 'wav', 'm4a', 'glb', 'gltf', 'bin', 'obj', 'mtl', 'json', 'tmj', 'tsj', 'tmx', 'tsx', 'txt', 'ttf', 'otf', 'woff', 'woff2', 'fnt', 'xml']);
const EXPORT_EXT = new Set([...ASSET_EXT, 'html', 'js', 'css', 'md', 'webmanifest', 'ico', 'sol']);
const MIME = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8', tmj: 'application/json; charset=utf-8', tsj: 'application/json; charset=utf-8', webmanifest: 'application/manifest+json',
  tmx: 'application/xml; charset=utf-8', tsx: 'application/xml; charset=utf-8', xml: 'application/xml; charset=utf-8', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8',
  fnt: 'text/plain; charset=utf-8', ts: 'text/plain; charset=utf-8', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  ico: 'image/x-icon', wasm: 'application/wasm', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', glb: 'model/gltf-binary', gltf: 'model/gltf+json',
  bin: 'application/octet-stream', obj: 'text/plain; charset=utf-8', mtl: 'text/plain; charset=utf-8', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2'
};
const extOf = (p) => { const m = /\.([a-z0-9]+)$/i.exec(p); return m ? m[1].toLowerCase() : ''; };

/* ---------------------------------------------------------------- validación */
const PROJECT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9_\-. ]{0,119}$/;
/** id de proyecto -> carpeta (o null si no es válido) */
function projectDir(id) {
  if (typeof id !== 'string' || !PROJECT_ID.test(id)) return null;
  const dir = path.resolve(WORKSPACE, id);
  return isSafePath(WORKSPACE, dir) ? dir : null;
}
/** "assets/archivo.ext" dentro del proyecto (o null) */
function assetPath(dir, rel) {
  if (typeof rel !== 'string' || !rel.startsWith('assets/')) return null;
  const name = rel.slice(7);
  if (!ASSET_NAME.test(name) || name.includes('..') || !ASSET_EXT.has(extOf(name))) return null;
  const full = path.resolve(dir, 'assets', name);
  return isSafePath(WORKSPACE, full) ? full : null;
}
/** ruta relativa de un archivo exportado (subcarpetas permitidas, sin "..") */
function exportPath(dir, rel) {
  if (typeof rel !== 'string' || rel.length > 200 || !/^[A-Za-z0-9_\-][A-Za-z0-9_\-./ ]*$/.test(rel) || rel.split('/').some((s) => s === '' || s === '.' || s === '..')) return null;
  if (!EXPORT_EXT.has(extOf(rel))) return null;
  const base = path.join(dir, 'export'), full = path.resolve(base, rel);
  return isSafePath(WORKSPACE, full) ? full : null;
}
/** Nombre visible -> id de carpeta ("Mi Juego 2" -> "mi-juego-2"), único en el espacio de trabajo */
function slugify(name) {
  let s = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'proyecto';
  if (!/^[a-z0-9]/.test(s)) s = 'p-' + s;
  let id = s, n = 2;
  while (fs.existsSync(path.join(WORKSPACE, id))) id = s + '-' + (n++);
  return id;
}
function timingSafeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function cookieOf(req) {
  const c = String(req.headers.cookie || '');
  for (const part of c.split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim(); }
  return null;
}
let PORT = 0;
const hostOk = (req) => { const m = /^(localhost|127\.0\.0\.1)(?::(\d{1,5}))?$/i.exec(String(req.headers.host || '')); return !!m && Number(m[2] || 80) === PORT; };
function originOk(req, required) {
  const o = req.headers.origin;
  if (o === undefined) return !required;
  try { const u = new URL(o); return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && Number(u.port || 80) === PORT; } catch (e) { return false; }
}

/* ---------------------------------------------------------------- utilidades */
const SEC_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' };
function send(res, code, body, type, extra) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(code, Object.assign({ 'Content-Type': type || (typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8'), 'Content-Length': buf.length, 'Cache-Control': 'no-store' }, SEC_HEADERS, extra || {}));
  res.end(buf);
}
const fail = (res, code, msg) => send(res, code, { error: msg });
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length'] || 0);
    if (len > max) { reject(Object.assign(new Error('demasiado grande'), { code: 413 })); req.resume(); return; }
    const chunks = []; let size = 0, done = false;
    // al pasarse del límite se deja de guardar (sin cortar la conexión aún, para poder responder 413)
    req.on('data', (c) => { if (done) return; size += c.length; if (size > max) { done = true; chunks.length = 0; reject(Object.assign(new Error('demasiado grande'), { code: 413 })); } else chunks.push(c); });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}
async function readJSON(req, max) {
  const ct = String(req.headers['content-type'] || '');
  if (!/^application\/json\b/i.test(ct)) throw Object.assign(new Error('se esperaba JSON'), { code: 415 });
  const buf = await readBody(req, max);
  try { return JSON.parse(buf.toString('utf8')); } catch (e) { throw Object.assign(new Error('JSON no válido'), { code: 400 }); }
}
/** Escritura atómica: temporal en la misma carpeta + rename (nunca deja un archivo a medias) */
function writeAtomic(file, data) {
  if (!isSafePath(WORKSPACE, file)) throw Object.assign(new Error('ruta no permitida'), { code: 403 });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
/** "Borrar" = mover a <workspace>/.trash (recuperable a mano) */
function toTrash(full, label) {
  const trash = path.join(WORKSPACE, '.trash');
  if (!isSafePath(WORKSPACE, full) || !isSafePath(WORKSPACE, trash)) throw Object.assign(new Error('ruta no permitida'), { code: 403 });
  fs.mkdirSync(trash, { recursive: true });
  const dest = path.join(trash, new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex') + '-' + label.replace(/[^A-Za-z0-9_.-]/g, '_'));
  fs.renameSync(full, dest);
  return dest;
}
function listAssets(dir) {
  const ad = path.join(dir, 'assets'); if (!isSafePath(WORKSPACE, ad) || !fs.existsSync(ad)) return [];
  return fs.readdirSync(ad, { withFileTypes: true }).filter((d) => d.isFile() && ASSET_NAME.test(d.name) && ASSET_EXT.has(extOf(d.name)))
    .map((d) => { const st = fs.statSync(path.join(ad, d.name)); return { file: 'assets/' + d.name, size: st.size, modified: st.mtimeMs }; });
}
function readProjectMeta(id) {
  const dir = projectDir(id); if (!dir) return null;
  const f = path.join(dir, 'project.json'); if (!isSafePath(WORKSPACE, f) || !fs.existsSync(f)) return null;
  try {
    const st = fs.statSync(f); if (st.size > LIMITS.project) return null;
    const p = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!p || p.format !== 'ultragame-project') return null;
    const kinds = Array.isArray(p.scenes) ? Array.from(new Set(p.scenes.map((s) => (s && s.kind === '3d' ? '3d' : '2d')))) : [];
    return { id, name: String(p.name || id).slice(0, 80), modified: st.mtimeMs, kinds, scenes: Array.isArray(p.scenes) ? p.scenes.length : 0 };
  } catch (e) { return null; }
}
function validProject(p) { return p && typeof p === 'object' && !Array.isArray(p) && p.format === 'ultragame-project' && Array.isArray(p.scenes) && p.scenes.length <= 500; }

/* ---------------------------------------------------------------- backend del juego (modo desarrollo)
 * El editor genera server.js + routes/*.js (studio/shared/backend.js) y aquí se escriben en <proyecto>/backend y se
 * ejecutan con Node: solo en 127.0.0.1, con un token por ejecución (el juego lo envía en X-UG-Dev), sin shell y, si
 * Node lo permite, con el modelo de permisos (solo lee su carpeta, solo escribe en data/, sin procesos hijos). */
const BACKEND_FILE = /^(server\.js|package\.json|README\.md|data\/LEEME\.txt|routes\/[A-Za-z0-9_-]{1,64}\.js)$/;
const HAS_PERMISSION = (() => { try { return process.allowedNodeEnvironmentFlags.has('--permission'); } catch (e) { return false; } })();
const backends = new Map(); // id de proyecto -> { child, port, token, logs, seq, started, exited }
function backendLog(b, level, text) {
  String(text).split(/\r?\n/).forEach((line) => {
    if (!line.trim() || line.startsWith('UG_BACKEND_READY ')) return;
    b.logs.push({ n: ++b.seq, t: Date.now(), level: /\[error\]/.test(line) ? 'error' : /\[warn\]/.test(line) ? 'warn' : level, text: line.slice(0, 2000) });
  });
  if (b.logs.length > 600) b.logs.splice(0, b.logs.length - 600);
}
function stopBackend(id) {
  const b = backends.get(id); if (!b) return false;
  backends.delete(id);
  try { b.child.stdin.write('stop\n'); } catch (e) { /* ya cerrado */ }
  setTimeout(() => { if (b.child.exitCode === null) { try { b.child.kill(); } catch (e) { /* ya terminó */ } } }, 1500);
  return true;
}
function startBackend(id, dir, files) {
  stopBackend(id);
  const bdir = path.join(dir, 'backend');
  fs.mkdirSync(path.join(bdir, 'data'), { recursive: true });
  // las rutas se regeneran enteras (las viejas van a la papelera); data/ se conserva
  const rdir = path.join(bdir, 'routes');
  if (fs.existsSync(rdir)) toTrash(rdir, id + '-backend-routes');
  for (const f of files) writeAtomic(path.join(bdir, f.path), Buffer.from(f.text, 'utf8'));
  const token = crypto.randomBytes(18).toString('hex');
  const args = HAS_PERMISSION ? ['--permission', '--allow-fs-read=' + bdir, '--allow-fs-write=' + path.join(bdir, 'data'), 'server.js'] : ['server.js'];
  const env = { PORT: '0', HOST: '127.0.0.1', UG_DEV_TOKEN: token, UG_API_KEY: token, NODE_ENV: 'development' };
  ['SystemRoot', 'windir', 'TEMP', 'TMP'].forEach((k) => { if (process.env[k]) env[k] = process.env[k]; });
  const child = spawn(process.execPath, args, { cwd: bdir, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true });
  const b = { child, port: 0, token, logs: [], seq: 0, started: Date.now(), exited: null, sandboxed: HAS_PERMISSION };
  backends.set(id, b);
  let buf = '';
  child.stdout.on('data', (d) => { buf += d; const m = /UG_BACKEND_READY (\{[^\n]*\})/.exec(buf); if (m && !b.port) { try { b.port = JSON.parse(m[1]).port | 0; } catch (e) { /* ignorar */ } } if (buf.length > 65536) buf = buf.slice(-4096); backendLog(b, 'info', d); });
  child.stderr.on('data', (d) => backendLog(b, 'error', d));
  child.on('error', (e) => { backendLog(b, 'error', 'no se pudo ejecutar Node: ' + e.message); b.exited = -1; });
  child.on('exit', (code) => { b.exited = code === null ? -1 : code; backendLog(b, code ? 'error' : 'info', 'el backend se ha detenido (código ' + code + ')'); });
  backendLog(b, 'info', 'Iniciando backend' + (HAS_PERMISSION ? ' (aislado: --permission)' : ' (Node sin --permission: sin aislamiento de disco)') + '…');
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => { if (b.port || b.exited !== null || Date.now() - t0 > 8000) resolve(b); else setTimeout(tick, 60); };
    tick();
  });
}
function backendRequest(b, method, rel, body) {
  return new Promise((resolve) => {
    const t0 = Date.now(), data = body === undefined || body === null || body === '' ? null : Buffer.from(String(body), 'utf8');
    const headers = { 'X-UG-Dev': b.token, 'X-API-Key': b.token };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = data.length; }
    const r = http.request({ host: '127.0.0.1', port: b.port, path: rel, method, headers, timeout: 15000 }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size <= 1048576) chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, type: String(res.headers['content-type'] || ''), body: Buffer.concat(chunks).toString('utf8'), truncated: size > 1048576, ms: Date.now() - t0 }));
    });
    r.on('timeout', () => r.destroy(new Error('tiempo agotado')));
    r.on('error', (e) => resolve({ status: 0, type: '', body: String(e.message), ms: Date.now() - t0 }));
    if (data) r.write(data);
    r.end();
  });
}
process.on('exit', () => { for (const b of backends.values()) { try { b.child.kill(); } catch (e) { /* ya terminó */ } } });

/* ---------------------------------------------------------------- API */
async function api(req, res, url) {
  // autenticación: cookie de sesión + cabecera propia (la cabecera no es necesaria para leer archivos con <img>/fetch simple)
  const isFileGet = req.method === 'GET' && url.pathname === '/api/file';
  if (!timingSafeEq(cookieOf(req) || '', TOKEN)) return fail(res, 401, 'sesión no válida: abre el editor con el enlace que muestra la consola');
  if (!isFileGet && req.headers['x-ug-studio'] !== '1') return fail(res, 403, 'falta la cabecera X-UG-Studio');
  if (!originOk(req, req.method !== 'GET' && req.method !== 'HEAD')) return fail(res, 403, 'origen no permitido');
  const q = url.searchParams, route = req.method + ' ' + url.pathname;
  switch (route) {
    case 'GET /api/recovery':
      return q.has('key') ? send(res,200,recoveryStore.load(q.get('key')),'application/octet-stream') : send(res,200,{drafts:recoveryStore.list()});
    case 'PUT /api/recovery': {
      const bytes=await readBody(req,64*1024*1024);
      return send(res,200,recoveryStore.save(q.get('key'),{kind:q.get('kind'),name:q.get('name'),projectId:q.get('project')},bytes));
    }
    case 'GET /api/office':
      return send(res, 200, officeConverter.status());
    case 'POST /api/office/convert': {
      const bytes = await readBody(req, 64 * 1024 * 1024);
      const result = await officeConverter.convert(bytes, q.get('from'), q.get('to'));
      return send(res, 200, result, 'application/octet-stream', { 'Content-Disposition': 'attachment' });
    }
    case 'GET /api/info':
      return send(res, 200, { app: 'UltraGame Studio', version: VERSION, workspace: WORKSPACE, platform: process.platform, limits: LIMITS });
    case 'GET /api/projects': {
      fs.mkdirSync(WORKSPACE, { recursive: true });
      const list = fs.readdirSync(WORKSPACE, { withFileTypes: true }).filter((d) => d.isDirectory() && PROJECT_ID.test(d.name)).map((d) => readProjectMeta(d.name)).filter(Boolean);
      list.sort((a, b) => b.modified - a.modified);
      return send(res, 200, { projects: list });
    }
    case 'POST /api/projects': {
      const body = await readJSON(req, LIMITS.project);
      if (!body || !validProject(body.project)) return fail(res, 400, 'proyecto no válido');
      fs.mkdirSync(WORKSPACE, { recursive: true });
      const id = slugify(body.project.name), dir = projectDir(id);
      if (!dir) return fail(res, 400, 'nombre no válido');
      fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
      writeAtomic(path.join(dir, 'project.json'), JSON.stringify(body.project, null, 1));
      return send(res, 200, { id });
    }
    case 'GET /api/project': {
      const dir = projectDir(q.get('p')); if (!dir) return fail(res, 400, 'proyecto no válido');
      const f = path.join(dir, 'project.json'); if (!fs.existsSync(f)) return fail(res, 404, 'no existe');
      if (!isSafePath(WORKSPACE, f)) return fail(res, 403, 'ruta no permitida');
      return send(res, 200, fs.readFileSync(f), 'application/json; charset=utf-8');
    }
    case 'PUT /api/project': {
      const dir = projectDir(q.get('p')); if (!dir || !fs.existsSync(dir)) return fail(res, 404, 'no existe');
      const p = await readJSON(req, LIMITS.project);
      if (!validProject(p)) return fail(res, 400, 'proyecto no válido');
      const f = path.join(dir, 'project.json');
      if (!isSafePath(WORKSPACE, f) || !isSafePath(WORKSPACE, f + '.bak')) return fail(res, 403, 'ruta no permitida');
      if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak');
      writeAtomic(f, JSON.stringify(p, null, 1));
      return send(res, 200, { ok: true, saved: Date.now() });
    }
    case 'DELETE /api/project': {
      const id = q.get('p'), dir = projectDir(id); if (!dir || !fs.existsSync(dir)) return fail(res, 404, 'no existe');
      return send(res, 200, { ok: true, trash: path.basename(toTrash(dir, id)) });
    }
    case 'GET /api/assets': {
      const dir = projectDir(q.get('p')); if (!dir || !fs.existsSync(dir)) return fail(res, 404, 'no existe');
      return send(res, 200, { assets: listAssets(dir) });
    }
    case 'GET /api/file': {
      const dir = projectDir(q.get('p')), f = dir && assetPath(dir, q.get('f'));
      if (!f) return fail(res, 400, 'archivo no válido');
      if (!fs.existsSync(f)) return fail(res, 404, 'no existe');
      // CSP sandbox + descarga: aunque sea SVG/HTML, abrirlo directamente no ejecuta nada en este origen
      return send(res, 200, fs.readFileSync(f), MIME[extOf(f)] || 'application/octet-stream', { 'Content-Security-Policy': "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'", 'Content-Disposition': 'attachment' });
    }
    case 'PUT /api/file': {
      const dir = projectDir(q.get('p')), f = dir && assetPath(dir, q.get('f'));
      if (!f || !fs.existsSync(dir)) return fail(res, 400, 'archivo no válido (nombre o extensión no permitidos)');
      const data = await readBody(req, LIMITS.asset);
      writeAtomic(f, data);
      return send(res, 200, { ok: true, file: q.get('f'), size: data.length });
    }
    case 'DELETE /api/file': {
      const dir = projectDir(q.get('p')), f = dir && assetPath(dir, q.get('f'));
      if (!f || !fs.existsSync(f)) return fail(res, 404, 'no existe');
      toTrash(f, q.get('p') + '-' + path.basename(f));
      return send(res, 200, { ok: true });
    }
    case 'POST /api/export': {
      const dir = projectDir(q.get('p')); if (!dir || !fs.existsSync(dir)) return fail(res, 404, 'no existe');
      const body = await readJSON(req, LIMITS.export);
      if (!body || !Array.isArray(body.files) || body.files.length > 5000) return fail(res, 400, 'exportación no válida');
      const planned = [];
      for (const it of body.files) {
        const full = it && exportPath(dir, it.path);
        if (!full || typeof it.data !== 'string') return fail(res, 400, 'ruta no permitida: ' + String(it && it.path).slice(0, 80));
        planned.push([full, Buffer.from(it.data, 'base64')]);
      }
      // la carpeta export/ la genera el editor: se sustituye entera (la anterior va a .trash)
      const out = path.join(dir, 'export');
      if (fs.existsSync(out)) toTrash(out, q.get('p') + '-export');
      for (const [full, data] of planned) writeAtomic(full, data);
      return send(res, 200, { ok: true, dir: out, files: planned.length });
    }
    case 'POST /api/reveal': {
      const dir = projectDir(q.get('p')); if (!dir || !fs.existsSync(dir)) return fail(res, 404, 'no existe');
      const target = q.get('what') === 'export' ? path.join(dir, 'export') : dir;
      if (!isSafePath(WORKSPACE, target)) return fail(res, 403, 'ruta no permitida');
      if (!fs.existsSync(target)) return fail(res, 404, q.get('what') === 'export' ? 'Todavía no has exportado este proyecto: usa primero Archivo › Exportar a carpeta (disco)' : 'La carpeta del proyecto no existe');
      const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      try { const ch = spawn(cmd, [target], { detached: true, stdio: 'ignore', shell: false }); ch.on('error', () => {}); ch.unref(); } catch (e) { return fail(res, 500, 'no se pudo abrir'); }
      return send(res, 200, { ok: true });
    }
    case 'POST /api/backend/start': {
      const id = q.get('p'), dir = projectDir(id); if (!dir || !fs.existsSync(dir)) return fail(res, 404, 'no existe');
      const body = await readJSON(req, 8 * 1024 * 1024);
      if (!body || !Array.isArray(body.files) || !body.files.length || body.files.length > 120) return fail(res, 400, 'archivos no válidos');
      let total = 0;
      for (const f of body.files) {
        if (!f || typeof f.path !== 'string' || !BACKEND_FILE.test(f.path) || typeof f.text !== 'string') return fail(res, 400, 'archivo no permitido: ' + String(f && f.path).slice(0, 80));
        total += f.text.length;
      }
      if (total > 6 * 1024 * 1024) return fail(res, 413, 'backend demasiado grande');
      if (!body.files.some((f) => f.path === 'server.js')) return fail(res, 400, 'falta server.js');
      const b = await startBackend(id, dir, body.files);
      if (!b.port) return send(res, 200, { running: false, error: b.exited !== null ? 'el backend terminó al arrancar (mira el registro)' : 'el backend no respondió a tiempo', logs: b.logs });
      return send(res, 200, { running: true, port: b.port, url: 'http://127.0.0.1:' + b.port, token: b.token, sandboxed: b.sandboxed, logs: b.logs, seq: b.seq });
    }
    case 'POST /api/backend/stop': {
      const id = q.get('p'); if (!projectDir(id)) return fail(res, 400, 'proyecto no válido');
      return send(res, 200, { ok: stopBackend(id) });
    }
    case 'GET /api/backend/status': {
      const id = q.get('p'); if (!projectDir(id)) return fail(res, 400, 'proyecto no válido');
      const b = backends.get(id), since = Number(q.get('since') || 0);
      if (!b) return send(res, 200, { running: false, logs: [] });
      const running = b.exited === null && !!b.port;
      return send(res, 200, { running, port: b.port, url: running ? 'http://127.0.0.1:' + b.port : '', token: running ? b.token : '', sandboxed: b.sandboxed, exited: b.exited, logs: b.logs.filter((l) => l.n > since), seq: b.seq });
    }
    case 'POST /api/backend/request': {
      const id = q.get('p'), b = backends.get(id); if (!projectDir(id)) return fail(res, 400, 'proyecto no válido');
      if (!b || !b.port || b.exited !== null) return fail(res, 409, 'el backend no está en marcha');
      const body = await readJSON(req, 1024 * 1024);
      const method = String(body.method || 'GET').toUpperCase(), rel = String(body.path || '/');
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) return fail(res, 400, 'método no permitido');
      if (!/^\/[A-Za-z0-9_\-\/:.?=&%+~,]{0,500}$/.test(rel) || rel.includes('..')) return fail(res, 400, 'ruta no válida');
      return send(res, 200, await backendRequest(b, method, rel, method === 'GET' || method === 'DELETE' ? null : body.body));
    }
    default:
      return fail(res, 404, 'ruta desconocida');
  }
}

/* ---------------------------------------------------------------- estáticos */
function serveStatic(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (e) { return fail(res, 400, 'ruta no válida'); }
  if (rel.includes('\0')) return fail(res, 400, 'ruta no válida');
  const top = rel.split('/')[1] || '';
  if (!STATIC_DIRS.includes(top)) return fail(res, 404, 'no encontrado');
  let file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(path.join(ROOT, top) + path.sep) && file !== path.join(ROOT, top)) return fail(res, 403, 'prohibido');
  if (!isSafePath(ROOT, file)) return fail(res, 403, 'prohibido');
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    if (!isSafePath(ROOT, file)) return fail(res, 403, 'prohibido');
    fs.readFile(file, (err2, data) => {
      if (err2) return fail(res, 404, 'no encontrado');
      const ext = file.endsWith('.d.ts') ? 'ts' : extOf(file);
      // código público del motor/editor: CORP cross-origin para que el reproductor (origen opaco) pueda cargarlo
      const extra = { 'Cache-Control': 'no-cache', 'Cross-Origin-Resource-Policy': 'cross-origin' };
      // el editor: CSP estricta (sin eval, sin scripts de terceros). El reproductor (player.html) vive en un iframe
      // sandbox sin allow-same-origin: origen opaco, sin acceso a la cookie ni a la API; sus scripts de usuario son blob:
      const self = 'http://127.0.0.1:' + PORT + ' http://localhost:' + PORT;
      if (ext === 'html' && top === 'studio' && path.basename(file) === 'player.html') extra['Content-Security-Policy'] = "default-src 'none'; script-src 'self' " + self + " blob: 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src blob: data:; media-src blob: data:; connect-src blob: data: https: http://127.0.0.1:* http://localhost:*; font-src blob: data:; worker-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'";
      // (connect-src: el backend local del juego y APIs https. La API del editor sigue cerrada: la cookie es
      // SameSite=Strict, no viaja desde el origen opaco del iframe, y X-UG-Studio exige un preflight que nunca se aprueba)
      else if (ext === 'html' && top === 'studio') extra['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";
      res.writeHead(200, Object.assign({ 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': data.length }, SEC_HEADERS, extra));
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
}

/* ---------------------------------------------------------------- servidor */
const server = http.createServer(async (req, res) => {
  try {
    if (!hostOk(req)) return fail(res, 421, 'host no permitido');
    let url; try { url = new URL(req.url, 'http://127.0.0.1'); } catch (e) { return fail(res, 400, 'url no válida'); }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'método no permitido');
    if (url.pathname === '/' || url.pathname === '/studio') return send(res, 302, '', 'text/plain', { Location: '/studio/' });
    // enlace de arranque: /studio/?t=TOKEN -> cookie de sesión y URL limpia
    if (url.pathname === '/studio/' && url.searchParams.has('t')) {
      if (!timingSafeEq(url.searchParams.get('t'), TOKEN)) return fail(res, 401, 'enlace caducado: vuelve a abrir el Studio');
      return send(res, 302, '', 'text/plain', { Location: '/studio/', 'Set-Cookie': COOKIE + '=' + TOKEN + '; HttpOnly; SameSite=Strict; Path=/' });
    }
    return serveStatic(req, res, url);
  } catch (e) {
    // cuerpo demasiado grande: se responde y después se cierra la conexión (no se sigue leyendo)
    // (se descarta el resto de la subida un momento antes de cerrar: cortar de golpe hace que algunos clientes,
    // sobre todo en Windows, pierdan la respuesta 413 por el RST)
    if (e && e.code === 413 && !res.headersSent) { res.setHeader('Connection', 'close'); res.on('finish', () => { req.resume(); const t = setTimeout(() => req.destroy(), 2000); req.once('end', () => { clearTimeout(t); req.destroy(); }); }); }
    if (!res.headersSent) fail(res, e && e.code >= 400 && e.code < 600 ? e.code : 500, e && e.code ? e.message : 'error interno');
    if (!(e && e.code)) console.error('[studio] error:', e);
  }
});
server.headersTimeout = 30000; server.requestTimeout = 120000;

/* abre la URL en una ventana de aplicación (Edge/Chrome --app) o, si no hay, en el navegador por defecto */
function openApp(url) {
  const env = process.env, cands = [];
  if (BROWSER) cands.push(BROWSER);
  if (process.platform === 'win32') {
    [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean).forEach((b) => {
      cands.push(path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    });
  } else if (process.platform === 'darwin') {
    cands.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    (env.PATH || '').split(':').forEach((d) => ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge'].forEach((n) => cands.push(path.join(d, n))));
  }
  const exe = cands.find((c) => { try { return fs.statSync(c).isFile(); } catch (e) { return false; } });
  const fallback = () => {
    const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    try { const ch = spawn(cmd, [url], { detached: true, stdio: 'ignore' }); ch.on('error', () => {}); ch.unref(); } catch (e) { /* abrir a mano */ }
  };
  if (!exe) return fallback();
  try { const ch = spawn(exe, ['--app=' + url, '--window-size=1600,960', '--new-window'], { detached: true, stdio: 'ignore' }); ch.on('error', fallback); ch.unref(); } catch (e) { fallback(); }
}

function start(port) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && port !== 0) { console.log('[studio] el puerto ' + port + ' está ocupado; uso uno libre'); start(0); }
    else { console.error('[studio] no se pudo iniciar:', e.message); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {
    PORT = server.address().port;
    fs.mkdirSync(WORKSPACE, { recursive: true });
    const url = 'http://127.0.0.1:' + PORT + '/studio/?t=' + TOKEN;
    console.log('UltraGame Studio ' + VERSION);
    console.log('  proyectos: ' + WORKSPACE);
    console.log('  abre:      ' + url);
    console.log('  (el enlace es privado de esta sesión; cierra esta ventana para salir)');
    if (!NO_OPEN) openApp(url);
  });
}
if (require.main === module) start(Number.isFinite(PORT_ARG) && PORT_ARG >= 0 && PORT_ARG < 65536 ? PORT_ARG : 5210);
module.exports = { server, start, TOKEN, _test: { projectDir, assetPath, exportPath, slugify, WORKSPACE } };
