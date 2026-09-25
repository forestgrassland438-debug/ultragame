/* UltraGame Studio · exportación:
 *  - Carpeta web / ZIP: index.html + motor + runtime + project.js + scripts/*.js + assets/ (con CSP estricta).
 *  - HTML único: todo dentro de un archivo (recursos como data: URI). Se abre con doble clic, sin servidor.
 *  - Proyecto .ugs.json: para compartir o hacer copia (con los recursos incluidos). */
import { downloadBlob, safeFileName, toast } from './dom.js';

const S = window.UGStudio.schema, RT = window.UGStudio.runtime;
const enc = new TextEncoder();

/* ---------------------------------------------------------------- ZIP (sin compresión, con CRC-32) */
let CRC_T = null;
function crc32(u8) {
  if (!CRC_T) { CRC_T = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; } }
  let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function makeZip(files) {
  const parts = [], central = []; let offset = 0;
  const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.path), data = f.data, crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
}

/* ---------------------------------------------------------------- piezas */
async function text(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error('No se pudo leer ' + url); return r.text(); }
function escHTML(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
/** CSP del juego exportado: connect-src solo añade el backend y los «Orígenes permitidos» del proyecto */
export function cspFor(project) {
  const extra = [], o = (u) => (/^(https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?)/i.exec(String(u || '')) || [])[1];
  if (project && project.backend && project.backend.enabled && o(project.backend.url)) extra.push(o(project.backend.url));
  ((project && project.settings && project.settings.connectOrigins) || []).forEach((x) => { if (S.isOrigin(x) && !extra.includes(x)) extra.push(x); });
  return "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' data: blob:" + (extra.length ? ' ' + extra.join(' ') : '') + "; font-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'";
}
const STYLE = 'html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden;overscroll-behavior:none}body{height:100dvh}#game{position:relative;width:100%;height:100%;touch-action:none}#game canvas{display:block;touch-action:none}';
function b64(u8) { let s = ''; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); }
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', glb: 'application/octet-stream', gltf: 'application/json', bin: 'application/octet-stream', obj: 'text/plain', mtl: 'text/plain', json: 'application/json', tmj: 'application/json', tsj: 'application/json', tmx: 'application/xml', tsx: 'application/xml', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', txt: 'text/plain' };

function snapshot(app) {
  const ed = app.editor; app.code.commit.flush();
  return { project: S.cleanProject(JSON.parse(JSON.stringify(ed.project))), projectId: ed.projectId, store: ed.store };
}

async function gather(app) {
  const { project, projectId, store } = snapshot(app);
  if (!project.scenes.length) throw new Error('Añade una escena antes de exportar el juego');
  const [engine, schema, runtime, boot] = await Promise.all([text('../dist/ultragame.js'), text('shared/schema.js'), text('runtime/runtime.js'), text('runtime/boot.js')]);
  const scripts = app.player.scripts(project);
  const assets = [], byFile = new Map();
  for (const a of project.assets) {
    if (!byFile.has(a.file)) {
      try { byFile.set(a.file, new Uint8Array(await store.assetData(projectId, a.file))); }
      catch (e) { throw new Error('No se puede exportar: falta «' + a.file + '». Vuelve a importar ese recurso.'); }
    }
    assets.push({ a, data: byFile.get(a.file) });
  }
  return { project, projectId, engine, schema, runtime, boot, scripts, assets };
}
const README = (name) => [
  name + ' — hecho con UltraGame Studio', '',
  'Para jugar: sube esta carpeta a cualquier hosting de páginas estáticas (itch.io, GitHub Pages, Netlify…) o',
  'ábrela con un servidor local (por ejemplo: node tools/server.js en la carpeta de UltraGame, o "npx serve").',
  'Si abres index.html con doble clic, el navegador bloquea la carga de recursos: para eso usa la exportación',
  '"HTML único" del Studio.', '',
  'Parámetros: index.html?r=webgpu | webgl2 | webgl | canvas fuerza un renderizador.', ''].join('\n');

/** Archivos de la exportación web */
export async function buildWebFiles(app) {
  const g = await gather(app), files = [], paths = new Set(), add = (path, data) => {
    if (paths.has(path)) throw new Error('Dos archivos de la exportación tienen la misma ruta: ' + path);
    paths.add(path); files.push({ path, data: typeof data === 'string' ? enc.encode(data) : data });
  };
  const tags = ['ultragame.js', 'schema.js', 'runtime.js', 'project.js'].concat(g.scripts.map((s) => 'scripts/' + s.id + '.js'), ['boot.js']);
  add('index.html', '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">\n<meta http-equiv="Content-Security-Policy" content="' + cspFor(g.project) + '">\n<title>' + escHTML(g.project.name) + '</title>\n<style>' + STYLE + '</style>\n</head>\n<body>\n<div id="game"></div>\n' + tags.map((t) => '<script src="' + t + '"></script>').join('\n') + '\n</body>\n</html>\n');
  add('ultragame.js', g.engine); add('schema.js', g.schema); add('runtime.js', g.runtime); add('boot.js', g.boot);
  add('project.js', 'window.UGS_PROJECT = ' + JSON.stringify(g.project) + ';\n');
  g.scripts.forEach((s) => add('scripts/' + s.id + '.js', s.source));
  g.assets.forEach((x) => { if (!paths.has(x.a.file)) add(x.a.file, x.data); });
  // backend (servidor Node) y contratos: se incluyen para publicarlos aparte
  const BK = window.UGStudio.backend, SOL = window.UGStudio.solidity;
  if (BK && g.project.backend.enabled && g.project.backend.routes.length) BK.files(g.project).forEach((f) => add('backend/' + f.path, f.text));
  if (g.project.web3.contracts.length) {
    g.project.web3.contracts.forEach((c) => { add('contracts/' + c.name + '.sol', c.source || ''); add('contracts/' + c.name + '.abi.json', c.abi || '[]'); });
    if (SOL) SOL.hardhatFiles(g.project.web3.contracts.map((c) => ({ name: c.name, source: c.source, args: c.args || [] }))).forEach((f) => add('contracts/hardhat/' + f.path, f.text));
  }
  add('LEEME.txt', README(g.project.name) + (g.project.backend.enabled ? '\nbackend/: servidor de tu API (Node 18+, sin dependencias): node backend/server.js — ver backend/README.md.\n' : '') + (g.project.web3.contracts.length ? '\ncontracts/: código Solidity y ABI de tus contratos (y un proyecto Hardhat para compilarlos y desplegarlos).\n' : ''));
  return { files, project: g.project, projectId: g.projectId };
}
/** Un solo HTML con todo dentro (se abre con doble clic) */
export async function buildSingleHTML(app) {
  const g = await gather(app), embedded = {};
  g.assets.forEach((x) => { const ext = (/\.([a-z0-9]+)$/i.exec(x.a.file) || [])[1] || ''; embedded[x.a.id] = 'data:' + (MIME[ext.toLowerCase()] || 'application/octet-stream') + ';base64,' + b64(x.data); });
  // data: conserva exactamente el código: escapar </script o <!-- alteraba
  // plantillas String.raw, comentarios HTML válidos y literales del proyecto.
  const sc = (src) => '<script src="data:text/javascript;charset=utf-8;base64,' + b64(enc.encode(src)) + '"></script>';
  const html = '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">\n<title>' + escHTML(g.project.name) + '</title>\n<style>' + STYLE + '</style>\n</head>\n<body>\n<div id="game"></div>\n' +
    [g.engine, g.schema, g.runtime, 'window.UGS_PROJECT = ' + JSON.stringify(g.project) + ';\nwindow.UGS_ASSETS = ' + JSON.stringify(embedded) + ';'].map(sc).join('\n') + '\n' +
    g.scripts.map((s) => sc(s.source)).join('\n') + '\n' + sc(g.boot) + '\n</body>\n</html>\n';
  return new Blob([html], { type: 'text/html' });
}
/** Proyecto completo en un JSON (recursos en base64) */
export async function buildProjectFile(app) {
  const { project, projectId, store } = snapshot(app), files = {};
  for (const a of project.assets) if (!Object.prototype.hasOwnProperty.call(files, a.file)) files[a.file] = b64(new Uint8Array(await store.assetData(projectId, a.file)));
  return new Blob([JSON.stringify({ format: 'ultragame-project-bundle', version: 1, project, files })], { type: 'application/json' });
}
/** Lee un .ugs.json (o un project.json suelto): valida TODO antes de crear nada */
export async function readProjectFile(file) {
  if (file.size > 300 * 1024 * 1024) throw new Error('Archivo demasiado grande');
  let data; try { data = JSON.parse(await file.text()); } catch (e) { throw new Error('No es un JSON válido'); }
  let project, files = {}; const bundled = data && data.format === 'ultragame-project-bundle';
  if (bundled) {
    if (data.version !== 1 || !data.files || typeof data.files !== 'object' || Array.isArray(data.files)) throw new Error('Paquete de proyecto no válido o versión no compatible');
    project = data.project; files = data.files;
  }
  else project = data;
  project = S.cleanProject(project);
  const out = [], seen = new Set();
  for (const a of project.assets) {
    if (seen.has(a.file)) continue; seen.add(a.file);
    const b = files[a.file];
    if (typeof b !== 'string') { if (bundled) throw new Error('El paquete no contiene el recurso «' + a.file + '»'); continue; }
    let bin; try { bin = atob(b); } catch (e) { throw new Error('Recurso dañado en el paquete: «' + a.file + '»'); }
    if (bin.length > 64 * 1024 * 1024) throw new Error('Recurso demasiado grande en el paquete: «' + a.file + '» (máximo 64 MB)');
    const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    out.push({ file: a.file, blob: new Blob([u8]) });
  }
  return { project, files: out };
}

/* ---------------------------------------------------------------- acciones del menú */
export async function exportZip(app) {
  toast('Preparando el ZIP…');
  const { files, project } = await buildWebFiles(app);
  downloadBlob(makeZip(files), safeFileName(project.name, '-web.zip'));
  toast('ZIP listo: descomprímelo y súbelo a cualquier hosting web', 'ok');
}
export async function exportFolder(app) {
  const ed = app.editor;
  if (!ed.store.canExportFolder) { toast('La exportación a carpeta necesita el servidor del Studio. Usa «Descargar ZIP» o «HTML único».', 'warn'); return; }
  toast('Exportando…');
  const { files, projectId } = await buildWebFiles(app);
  const r = await ed.store.exportFolder(projectId, files.map((f) => ({ path: f.path, data: b64(f.data) })));
  toast('Exportado en ' + r.dir, 'ok', 6000);
  return r;
}
export async function exportSingle(app) {
  toast('Creando el HTML único…');
  const name = app.editor.project.name;
  const blob = await buildSingleHTML(app);
  downloadBlob(blob, safeFileName(name, '.html'));
  toast('HTML listo: ábrelo con doble clic o compártelo', 'ok');
}
export async function exportProject(app) {
  const name = app.editor.project.name;
  const blob = await buildProjectFile(app);
  downloadBlob(blob, safeFileName(name, '.ugs.json'));
}
