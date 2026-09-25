#!/usr/bin/env node
/**
 * Servidor de desarrollo estático de UltraGame (sin dependencias).
 *  - Solo escucha en 127.0.0.1 (no expuesto a la red).
 *  - Protegido contra path traversal.
 *  - Cabeceras de seguridad (nosniff, CSP de desarrollo opcional).
 *  - Con --allow-save acepta POST /__save para que las páginas de captura guarden GIF/PNG
 *    en docs/media, minigames/thumbs o games3d/thumbs (nombres validados, tamaño limitado, solo desde el propio origen).
 *  - Solo atiende en 127.0.0.1 y rechaza cabeceras Host ajenas (protección contra DNS rebinding).
 * Uso: node tools/server.js [--port 8080] [--allow-save]
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { isSafePath } = require('./path-safety');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const PORT = Number((args[args.indexOf('--port') + 1]) || 8080) || 8080;
const ALLOW_SAVE = args.includes('--allow-save');
const SAVE_DIRS = { media: path.join(ROOT, 'docs', 'media'), thumbs: path.join(ROOT, 'minigames', 'thumbs'), thumbs3d: path.join(ROOT, 'games3d', 'thumbs') };
const MAX_SAVE = 25 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.tmj': 'application/json; charset=utf-8',
  '.tsj': 'application/json; charset=utf-8', '.tmx': 'application/xml; charset=utf-8', '.tsx': 'application/xml; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.fnt': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.d.ts': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.obj': 'text/plain; charset=utf-8', '.mtl': 'text/plain; charset=utf-8'
};

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  res.end(body);
}

/** Host válido: solo localhost / 127.0.0.1 (una web externa no puede usar DNS rebinding para leer o escribir aquí) */
function hostOk(req) { return /^(localhost|127\.0\.0\.1)(:\d{1,5})?$/i.test(String(req.headers.host || '')); }
/** Las escrituras exigen Origin del propio servidor (otra web abierta en el navegador no puede hacer POST) */
function originOk(req) {
  const o = req.headers.origin; if (typeof o !== 'string') return false;
  try { const u = new URL(o); return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && Number(u.port || 80) === PORT; } catch (e) { return false; }
}
function handleSave(req, res, url) {
  if (!ALLOW_SAVE) return send(res, 403, 'save disabled');
  if (!originOk(req)) return send(res, 403, 'bad origin');
  const dirKey = url.searchParams.get('dir') || 'media';
  const name = url.searchParams.get('name') || '';
  // hasOwnProperty: "__proto__", "constructor"… no son carpetas válidas
  const dir = Object.prototype.hasOwnProperty.call(SAVE_DIRS, dirKey) ? SAVE_DIRS[dirKey] : null;
  if (!dir || !/^[a-z0-9_\-]{1,64}\.(gif|png|json|webp)$/i.test(name)) return send(res, 400, 'bad name');
  const chunks = []; let size = 0; let aborted = false;
  req.on('data', (c) => { size += c.length; if (size > MAX_SAVE) { aborted = true; req.destroy(); } else chunks.push(c); });
  req.on('error', () => { aborted = true; });
  req.on('end', () => {
    if (aborted) return;
    try {
      if (!isSafePath(ROOT, path.join(dir, name))) return send(res, 403, 'forbidden');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks));
    } catch (e) { return send(res, 500, 'save failed'); }
    console.log('  guardado ' + dirKey + '/' + name + ' (' + (size / 1024).toFixed(1) + ' KB)');
    send(res, 200, 'ok');
  });
}

const server = http.createServer((req, res) => {
  let url;
  if (!hostOk(req)) return send(res, 421, 'bad host');
  try { url = new URL(req.url, 'http://127.0.0.1'); } catch (e) { return send(res, 400, 'bad url'); }
  if (req.method === 'POST' && url.pathname === '/__save') return handleSave(req, res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (e) { return send(res, 400, 'bad path'); }
  if (rel.indexOf('\0') >= 0) return send(res, 400, 'bad path');
  let file = path.normalize(path.join(ROOT, rel));
  if (!isSafePath(ROOT, file)) return send(res, 403, 'forbidden');
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) { file = path.join(file, 'index.html'); }
    if (!isSafePath(ROOT, file)) return send(res, 403, 'forbidden');
    fs.readFile(file, (err2, data) => {
      if (err2) return send(res, 404, 'not found: ' + rel);
      const ext = file.endsWith('.d.ts') ? '.d.ts' : path.extname(file).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'Cross-Origin-Resource-Policy': 'same-origin'
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('UltraGame dev server -> http://127.0.0.1:' + PORT + '/' + (ALLOW_SAVE ? '  (guardado habilitado)' : ''));
});
