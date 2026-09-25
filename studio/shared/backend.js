/* UltraGame Studio · generador de backends (APIs) para los juegos: un servidor Node sin dependencias con tus rutas,
 * una base de datos clave-valor en disco, límites de peticiones, CORS con lista blanca y validación de entradas.
 *   UGStudio.backend.files(proyecto, { dev }) -> [{ path, text }]   (server.js, routes/*.js, package.json, README.md)
 *   UGStudio.backend.ROUTE_TEMPLATES                                  rutas de ejemplo (clasificación, guardado…)
 * El código de cada ruta es del autor del juego: se escribe en su propio archivo routes/<id>.js (un error de sintaxis
 * solo desactiva esa ruta). Nada se evalúa en el Studio: el servidor generado lo ejecuta Node. */
(function (root) {
  'use strict';
  var B = {};

  B.ROUTE_TEMPLATES = {
    hello: { label: 'Hola mundo', method: 'GET', path: '/api/hola', code: "// GET /api/hola -> { mensaje, hora }\nreturn { mensaje: 'Hola desde tu backend', hora: new Date().toISOString() };\n" },
    scoresGet: { label: 'Clasificación: leer', method: 'GET', path: '/api/puntuaciones', code: "// Las 10 mejores puntuaciones\nconst lista = db.get('puntuaciones', []);\nreturn lista.slice(0, ctx.int(ctx.query.n || 10, 1, 100));\n" },
    scoresPost: { label: 'Clasificación: enviar', method: 'POST', path: '/api/puntuaciones', rateLimit: 10, code: "// Cuerpo: { \"nombre\": \"ana\", \"puntos\": 120 }\nconst nombre = ctx.text(ctx.body.nombre, 20) || 'anónimo';\nconst puntos = ctx.int(ctx.body.puntos, 0, 1000000000);\nconst lista = db.get('puntuaciones', []);\nlista.push({ nombre, puntos, fecha: Date.now() });\nlista.sort((a, b) => b.puntos - a.puntos);\ndb.set('puntuaciones', lista.slice(0, 100));\nreturn { posicion: lista.findIndex((x) => x.nombre === nombre && x.puntos === puntos) + 1 };\n" },
    saveGet: { label: 'Partida guardada: leer', method: 'GET', path: '/api/partida/:jugador', code: "// GET /api/partida/ana -> la partida guardada (o null)\nconst id = ctx.text(ctx.params.jugador, 40);\nif (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return ctx.fail(400, 'Jugador no válido');\nreturn db.get('partida:' + id, null);\n" },
    savePut: { label: 'Partida guardada: escribir', method: 'PUT', path: '/api/partida/:jugador', rateLimit: 20, code: "// PUT /api/partida/ana con el JSON de la partida\nconst id = ctx.text(ctx.params.jugador, 40);\nif (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return ctx.fail(400, 'Jugador no válido');\ndb.set('partida:' + id, { datos: ctx.body, fecha: Date.now() });\nreturn { ok: true };\n" },
    counter: { label: 'Contador de visitas', method: 'POST', path: '/api/visitas', code: "return { visitas: db.incr('visitas', 1) };\n" },
    status: { label: 'Estado del servidor', method: 'GET', path: '/api/estado', code: "return { ok: true, claves: db.list('').length, arranque: ctx.started };\n" }
  };

  function js(v) { return JSON.stringify(v); }
  function routeFile(r) { return 'routes/' + r.id + '.js'; }

  /** Archivos del servidor. o: { dev: true } añade el modo de desarrollo (token del Studio, origen del reproductor) */
  B.files = function (project, o) {
    o = o || {};
    var be = project.backend || { routes: [], cors: [] }, routes = be.routes || [];
    var table = routes.map(function (r) { return '  { id: ' + js(r.id) + ', method: ' + js(r.method) + ', path: ' + js(r.path) + ', rateLimit: ' + (r.rateLimit | 0 || 60) + ', auth: ' + (r.auth ? 'true' : 'false') + ', file: ' + js('./' + routeFile(r)) + ' }'; }).join(',\n');
    var files = [];
    var safeName = String(project.name || 'juego').replace(/[^\w áéíóúñÁÉÍÓÚÑ.-]/g, '').slice(0, 80);
    var slug = safeName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'juego';
    // reemplazos con función: un "$" en los datos no se interpreta como patrón
    files.push({ path: 'server.js', text: SERVER.replace('/*NAME*/', function () { return safeName; }).replace('/*CORS*/', function () { return js(be.cors || []); }).replace('/*ROUTES*/', function () { return table; }) });
    routes.forEach(function (r) {
      files.push({ path: routeFile(r), text: "// Ruta " + r.method + ' ' + r.path + " — generada por UltraGame Studio (edítala en el Studio o aquí)\n'use strict';\n" +
        'module.exports = async function (ctx, db) {\n' + String(r.code || '').replace(/\r\n?/g, '\n') + '\n};\n' });
    });
    files.push({ path: 'package.json', text: JSON.stringify({ name: slug + '-backend', private: true, version: '1.0.0', description: 'Backend del juego «' + project.name + '» (UltraGame Studio)', main: 'server.js', scripts: { start: 'node server.js', 'start:seguro': 'node --permission --allow-fs-read=. --allow-fs-write=./data server.js' }, engines: { node: '>=18' } }, null, 2) + '\n' });
    var routeList = routes.map(function (r) { return '- `' + r.method + ' ' + r.path + '`' + (r.auth ? ' (requiere `X-API-Key`)' : '') + ' — ' + (r.rateLimit || 60) + ' peticiones/min por IP'; }).join('\n') || '- (sin rutas)';
    files.push({ path: 'README.md', text: README.replace(/\/\*NAME\*\//g, function () { return safeName; }).replace('/*ROUTES*/', function () { return routeList; }) });
    files.push({ path: 'data/LEEME.txt', text: 'Aquí se guarda la base de datos del backend (db.json). Haz copias de seguridad de esta carpeta.\n' });
    void o;
    return files;
  };

  var SERVER = String.raw`#!/usr/bin/env node
/* Backend del juego «/*NAME*/» — generado por UltraGame Studio. Node 18+ sin dependencias.
 *   node server.js                (HOST=127.0.0.1 PORT=8787 por defecto)
 *   HOST=0.0.0.0 PORT=8080 UG_API_KEY=clave-larga node server.js     (producción, detrás de un proxy HTTPS)
 * Seguridad: CORS con lista blanca, JSON obligatorio en escrituras (bloquea CSRF), límite de peticiones por IP y ruta,
 * cuerpos de 256 KB como máximo, claves peligrosas (__proto__...) eliminadas, errores internos ocultos al cliente,
 * base de datos con escritura atómica y tiempo máximo por petición. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT === undefined ? 8787 : process.env.PORT);
const DEV_TOKEN = process.env.UG_DEV_TOKEN || '';       // lo pone el Studio al ejecutarlo en tu equipo
const API_KEY = process.env.UG_API_KEY || '';           // para rutas marcadas «requiere clave»
// detrás de un proxy (Caddy, nginx…) todas las peticiones llegan desde el proxy: UG_TRUST_PROXY=1 (o el número de proxies
// encadenados) toma la IP real de X-Forwarded-For. Sin proxy déjalo vacío: si no, cualquiera podría falsear su IP.
const TRUST_PROXY = Math.max(0, Math.min(10, parseInt(process.env.UG_TRUST_PROXY || '0', 10) || (/^(true|yes|si|sí)$/i.test(process.env.UG_TRUST_PROXY || '') ? 1 : 0)));
const CORS = /*CORS*/.concat((process.env.UG_CORS || '').split(',').map((s) => s.trim()).filter(Boolean));
const DATA = path.join(__dirname, 'data');
const LIMIT = { body: 262144, value: 262144, db: 32 * 1048576, keys: 200000, time: 10000 };
const STARTED = new Date().toISOString();

const ROUTES = [
/*ROUTES*/
];

/* ---------------------------------------------------------------- utilidades */
class HttpError extends Error { constructor(code, msg) { super(msg); this.status = code; } }
const BAD = new Set(['__proto__', 'constructor', 'prototype']);
function safeParse(text) { return JSON.parse(text, (k, v) => (BAD.has(k) ? undefined : v)); }
function log(level, ...a) { const line = new Date().toISOString() + ' [' + level + '] ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); (level === 'error' ? console.error : console.log)(line); }
function eq(a, b) { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); }

/* ---------------------------------------------------------------- base de datos clave-valor (data/db.json) */
const db = (() => {
  const file = path.join(DATA, 'db.json');
  let data = Object.create(null), timer = null;
  try { fs.mkdirSync(DATA, { recursive: true }); } catch (e) { /* solo lectura */ }
  try { const raw = safeParse(fs.readFileSync(file, 'utf8')); if (raw && typeof raw === 'object') for (const k of Object.keys(raw)) data[k] = raw[k]; } catch (e) { if (e.code !== 'ENOENT') log('warn', 'db.json no se pudo leer (se empieza vacía):', e.message); }
  const save = () => {
    timer = null;
    try { const tmp = file + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, file); } catch (e) { log('error', 'no se pudo guardar la base de datos:', e.message); }
  };
  const later = () => { if (!timer) timer = setTimeout(save, 250); };
  const key = (k) => { if (typeof k !== 'string' || !k || k.length > 200 || BAD.has(k)) throw new HttpError(400, 'clave no válida'); return k; };
  const copy = (v) => (v === undefined ? undefined : safeParse(JSON.stringify(v)));
  const put = (k, v) => {
    const s = JSON.stringify(v);
    if (s === undefined) { delete data[k]; later(); return; }
    if (s.length > LIMIT.value) throw new HttpError(413, 'dato demasiado grande');
    if (!(k in data) && Object.keys(data).length >= LIMIT.keys) throw new HttpError(507, 'base de datos llena');
    data[k] = safeParse(s); later();
  };
  return {
    get(k, def) { key(k); return k in data ? copy(data[k]) : def; },
    set(k, v) { key(k); put(k, v); return v; },
    del(k) { key(k); const had = k in data; delete data[k]; later(); return had; },
    has(k) { key(k); return k in data; },
    list(prefix, max) { prefix = String(prefix || ''); return Object.keys(data).filter((k) => k.startsWith(prefix)).slice(0, max || 1000); },
    push(k, v, max) { key(k); const l = Array.isArray(data[k]) ? copy(data[k]) : []; l.push(v); while (l.length > (max || 1000)) l.shift(); put(k, l); return l.length; },
    incr(k, n) { key(k); const v = (Number(data[k]) || 0) + (n === undefined ? 1 : Number(n) || 0); put(k, v); return v; },
    flush() { if (timer) { clearTimeout(timer); save(); } }
  };
})();

/* ---------------------------------------------------------------- rutas */
const compiled = ROUTES.map((r) => {
  const names = [], rx = new RegExp('^' + r.path.split('/').map((seg) => { if (seg[0] === ':') { names.push(seg.slice(1)); return '([^/]{1,200})'; } return seg.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&'); }).join('/') + '$');
  let fn = null, err = null;
  try { fn = require(r.file); if (typeof fn !== 'function') throw new Error('el archivo no exporta una función'); } catch (e) { err = e; log('error', 'ruta ' + r.method + ' ' + r.path + ' desactivada: ' + e.message); }
  return Object.assign({}, r, { rx, names, fn, err });
});

/* ---------------------------------------------------------------- límite de peticiones (por IP y ruta, ventana de 1 min) */
const hits = new Map();
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (now - v.t > 60000) hits.delete(k); }, 30000).unref();
function limited(ip, r) {
  const k = ip + '|' + r.id, now = Date.now(); let h = hits.get(k);
  if (!h || now - h.t > 60000) {
    h = { t: now, n: 0 };
    // tabla llena: se descartan las entradas más antiguas (vaciarla entera reiniciaría el límite de todos)
    if (hits.size >= 100000) { let n = 0; for (const old of hits.keys()) { hits.delete(old); if (++n >= 10000) break; } }
    hits.delete(k); hits.set(k, h);
  }
  return ++h.n > r.rateLimit;
}
/** IP del cliente: la del socket o, con UG_TRUST_PROXY, la que añadió el último proxy de confianza */
function clientIP(req) {
  const direct = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!TRUST_PROXY) return direct;
  const list = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
  const ip = list[list.length - TRUST_PROXY];
  return ip && /^[0-9A-Fa-f:.]{2,45}$/.test(ip) ? ip.replace(/^::ffff:/, '') : direct;
}

/* ---------------------------------------------------------------- CORS */
function allowOrigin(o) {
  if (!o) return null;
  if (CORS.includes(o)) return o;
  if (DEV_TOKEN && (o === 'null' || /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/.test(o))) return o; // reproductor aislado del Studio
  return null;
}
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer' };
function reply(res, status, data, origin, extra) {
  const body = data === undefined ? '' : JSON.stringify(data);
  const h = Object.assign({}, SEC, extra || {});
  if (body) h['Content-Type'] = 'application/json; charset=utf-8';
  if (origin) { h['Access-Control-Allow-Origin'] = origin; h['Vary'] = 'Origin'; }
  res.writeHead(status, h); res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    // al pasarse del límite se deja de guardar (se descarta el resto) para poder responder 413 antes de cerrar
    let size = 0, over = false; const chunks = [];
    if (Number(req.headers['content-length'] || 0) > LIMIT.body) { over = true; reject(new HttpError(413, 'cuerpo demasiado grande')); }
    req.on('data', (c) => { if (over) return; size += c.length; if (size > LIMIT.body) { over = true; chunks.length = 0; reject(new HttpError(413, 'cuerpo demasiado grande')); } else chunks.push(c); });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

/* ---------------------------------------------------------------- servidor */
const server = http.createServer(async (req, res) => {
  const origin = allowOrigin(req.headers.origin), ip = clientIP(req);
  let url; try { url = new URL(req.url, 'http://localhost'); } catch (e) { return reply(res, 400, { error: 'url no válida' }, origin); }
  if (req.method === 'OPTIONS') {
    if (!origin) return reply(res, 403, undefined, null);
    return reply(res, 204, undefined, origin, { 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE', 'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-UG-Dev', 'Access-Control-Max-Age': '600' });
  }
  if (req.headers.origin && !origin) return reply(res, 403, { error: 'origen no permitido' }, null);
  if (DEV_TOKEN && !eq(req.headers['x-ug-dev'] || '', DEV_TOKEN)) return reply(res, 401, { error: 'falta el token del Studio (modo desarrollo)' }, origin);
  if (url.pathname === '/__ug/health') return reply(res, 200, { ok: true, routes: compiled.length }, origin);
  const route = compiled.find((r) => r.method === req.method && r.rx.test(url.pathname));
  if (!route) return reply(res, compiled.some((r) => r.rx.test(url.pathname)) ? 405 : 404, { error: 'ruta desconocida' }, origin);
  if (!route.fn) return reply(res, 500, { error: 'esta ruta tiene un error (mira el registro del servidor)' }, origin);
  if (limited(ip, route)) return reply(res, 429, { error: 'demasiadas peticiones, espera un poco' }, origin, { 'Retry-After': '60' });
  if (route.auth && (!API_KEY || !eq(req.headers['x-api-key'] || '', API_KEY))) return reply(res, API_KEY ? 401 : 503, { error: API_KEY ? 'clave no válida' : 'define UG_API_KEY en el servidor' }, origin);
  const t0 = Date.now();
  let timer = null;
  try {
    let body = null;
    if (req.method !== 'GET' && req.method !== 'DELETE') {
      // escrituras solo con JSON: un formulario de otra web no puede llamarte sin permiso de CORS
      if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'envía JSON (Content-Type: application/json)');
      const text = await readBody(req);
      try { body = text ? safeParse(text) : null; } catch (e) { throw new HttpError(400, 'JSON no válido'); }
    }
    const m = route.rx.exec(url.pathname), params = Object.create(null), query = Object.create(null);
    route.names.forEach((n, i) => { try { params[n] = decodeURIComponent(m[i + 1]); } catch (e) { throw new HttpError(400, 'ruta no válida'); } });
    let nq = 0; for (const [k, v] of url.searchParams) { if (BAD.has(k) || ++nq > 50) continue; query[k] = v.slice(0, 2000); }
    const headers = Object.create(null); for (const k of ['user-agent', 'content-type', 'accept-language']) if (req.headers[k]) headers[k] = String(req.headers[k]).slice(0, 300);
    const ctx = {
      method: req.method, path: url.pathname, body: body === null ? Object.create(null) : body, query, params, headers, ip, started: STARTED,
      fail(code, msg) { throw new HttpError(code >= 400 && code < 600 ? code : 400, String(msg || 'error')); },
      text(v, max) { return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max || 200); },
      int(v, min, max) { const n = Number(v); if (!Number.isInteger(n) || (min !== undefined && n < min) || (max !== undefined && n > max)) throw new HttpError(400, 'número no válido'); return n; },
      num(v, min, max) { const n = Number(v); if (!Number.isFinite(n) || (min !== undefined && n < min) || (max !== undefined && n > max)) throw new HttpError(400, 'número no válido'); return n; },
      bool(v) { return v === true || v === 'true' || v === 1 || v === '1'; },
      log: (level, ...a) => log(level, route.method + ' ' + route.path + ':', ...a)
    };
    const out = await Promise.race([Promise.resolve().then(() => route.fn(ctx, db)), new Promise((_, rej) => { timer = setTimeout(() => rej(new HttpError(504, 'la ruta tardó demasiado')), LIMIT.time); })]);
    reply(res, out === undefined ? 204 : 200, out, origin);
    log('info', req.method + ' ' + url.pathname + ' ' + (out === undefined ? 204 : 200) + ' ' + (Date.now() - t0) + 'ms');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) log('error', req.method + ' ' + url.pathname + ':', e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
    else log('warn', req.method + ' ' + url.pathname + ' ' + status + ': ' + e.message);
    if (status === 413) { res.setHeader('Connection', 'close'); res.on('finish', () => { req.resume(); const t = setTimeout(() => req.destroy(), 2000); req.once('end', () => { clearTimeout(t); req.destroy(); }); }); }
    if (!res.headersSent) reply(res, status, { error: status === 500 ? 'error interno del servidor' : e.message }, origin);
  } finally { clearTimeout(timer); }
});
server.headersTimeout = 15000; server.requestTimeout = 30000; server.keepAliveTimeout = 5000;
server.listen(PORT, HOST, () => { const a = server.address(); log('info', 'backend listo en http://' + HOST + ':' + a.port + ' (' + compiled.filter((r) => r.fn).length + '/' + compiled.length + ' rutas)'); console.log('UG_BACKEND_READY ' + JSON.stringify({ port: a.port })); });
server.on('error', (e) => { log('error', 'no se pudo iniciar:', e.message); process.exit(1); });
const stop = () => { db.flush(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
process.on('uncaughtException', (e) => log('error', 'excepción no controlada:', e && e.message));
process.on('unhandledRejection', (e) => log('error', 'promesa rechazada:', e && e.message));
// el Studio cierra el backend escribiendo "stop" en su entrada
if (DEV_TOKEN && process.stdin) { process.stdin.on('data', (d) => { if (String(d).trim() === 'stop') stop(); }); process.stdin.on('end', stop); }
`;

  var README = '# Backend de «/*NAME*/»\n\nGenerado por UltraGame Studio. Solo necesita Node.js 18 o superior (sin dependencias).\n\n' +
    '## Ejecutar\n\n```\nnode server.js\n```\n\nEscucha en `http://127.0.0.1:8787`. Variables de entorno:\n\n' +
    '- `HOST` / `PORT`: dirección y puerto (en un servidor: `HOST=0.0.0.0`).\n- `UG_CORS`: orígenes extra permitidos, separados por comas (ej. `https://mijuego.com`).\n- `UG_API_KEY`: clave para las rutas marcadas «requiere clave» (cabecera `X-API-Key`).\n- `UG_TRUST_PROXY`: ponlo a `1` si el servidor está detrás de un proxy (Caddy, nginx, un balanceador): así el límite de peticiones se aplica a la IP real de cada jugador y no a la del proxy. Sin proxy, déjalo vacío.\n\n' +
    'Modo reforzado (Node 22+): `npm run start:seguro` limita el acceso a disco a esta carpeta.\n\n' +
    '## Rutas\n\n/*ROUTES*/\n\n## Datos\n\n`data/db.json` (clave-valor, escritura atómica). Haz copias de seguridad de esa carpeta.\n\n' +
    '## Publicar\n\nPonlo detrás de un proxy con HTTPS (Caddy, nginx) con `UG_TRUST_PROXY=1`, o en cualquier servicio que ejecute Node. Añade el dominio del juego en «Orígenes CORS» del Studio (o en `UG_CORS`) y la URL del backend en el Studio (pestaña Backend › URL de producción).\n';

  root.UGStudio = root.UGStudio || {};
  root.UGStudio.backend = B;
  if (typeof module !== 'undefined' && module.exports) module.exports = B;
})(typeof window !== 'undefined' ? window : globalThis);
