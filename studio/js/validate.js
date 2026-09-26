/* UltraGame Studio · validar y probar la exportación: revisa el proyecto (recursos rotos, scripts con errores de
 * sintaxis, web3 y backend mal configurados, orígenes no permitidos, tamaño) y ejecuta el juego unos segundos en un
 * reproductor aislado invisible para capturar errores reales antes de publicar. */
import { h, dialog } from './dom.js';

const S = window.UGStudio.schema, SOL = window.UGStudio.solidity;

/** Comprobaciones estáticas: [{ level: 'ok'|'warn'|'error'|'info', text }] */
export function checkProject(project, sizes) {
  const out = [], add = (level, text) => out.push({ level, text });
  const P = S.cleanProject(JSON.parse(JSON.stringify(project)));
  if (!P.scenes.length) add('error', 'El proyecto no tiene escenas.');
  const assets = new Set(P.assets.map((a) => a.id));
  let broken = 0, nodes = 0;
  P.scenes.forEach((sc) => {
    nodes += sc.nodes.length;
    if (sc.nodes.length > 3000) add('warn', 'La escena «' + sc.name + '» tiene ' + sc.nodes.length + ' objetos: puede ir lenta en móviles.');
    sc.nodes.forEach((n) => {
      const T = S.NODE_TYPES[n.type];
      T.props.forEach((p) => { if (p.type === 'asset' && n.props[p.key] && !assets.has(n.props[p.key])) { broken++; if (broken <= 5) add('error', '«' + sc.name + ' › ' + n.name + '»: el recurso de «' + p.label + '» ya no existe.'); } });
      if (T.kind === '3d' && sc.kind === '2d') add('warn', '«' + n.name + '» es 3D pero está en la escena 2D «' + sc.name + '»: no se verá.');
    });
    sc.events.forEach((ev) => ev.actions.forEach((a) => {
      if ((a.type === 'gotoScene') && a.params.scene && !P.scenes.some((x) => x.id === a.params.scene || x.name === a.params.scene)) add('error', 'Evento en «' + sc.name + '»: va a una escena que no existe.');
      if (a.type.indexOf('web3') === 0 && !P.web3.enabled) add('warn', 'Evento en «' + sc.name + '» usa web3, pero web3 está desactivado (pestaña Web3).');
      if (a.type === 'httpRequest') {
        const path = String(a.params.path || '');
        if (/^https?:\/\//i.test(path)) { const o = (/^(https?:\/\/[^/?#]+)/i.exec(path) || [])[1]; if (o && !P.settings.connectOrigins.includes(o) && o !== (/^(https?:\/\/[^/?#]+)/i.exec(P.backend.url) || [])[1]) add('error', 'Evento en «' + sc.name + '» llama a ' + o + ', que no está en «Orígenes permitidos» (Escena › Proyecto › Conexiones): el juego lo bloqueará.'); }
        else if (!P.backend.enabled && !P.backend.url) add('warn', 'Evento en «' + sc.name + '» hace peticiones a ' + path + ' pero no hay backend configurado.');
      }
      if (a.type === 'bridgeSend' && !P.settings.bridgeOrigins.length) add('info', 'El puente solo avisará a la propia página (evento «ug-bridge-out»): añade «Orígenes del puente» si el juego va dentro de un iframe.');
    }));
  });
  if (broken > 5) add('error', '… y ' + (broken - 5) + ' referencias rotas más.');
  if (!broken) add('ok', 'Todos los recursos usados existen (' + P.assets.length + ' recursos, ' + nodes + ' objetos).');
  // tamaño
  if (sizes) {
    const total = Object.values(sizes).reduce((n, x) => n + x, 0);
    P.assets.forEach((a) => { const s = sizes[a.id] || 0; if (s > 15 * 1048576) add('warn', '«' + a.name + '» ocupa ' + (s / 1048576).toFixed(1) + ' MB: tarda en cargar (comprímelo).'); });
    add(total > 80 * 1048576 ? 'warn' : 'ok', 'Tamaño de los recursos: ' + (total / 1048576).toFixed(1) + ' MB' + (total > 80 * 1048576 ? ' (mucho para web; itch.io admite hasta 1 GB, pero la carga será lenta)' : '') + '.');
  }
  // web3
  const W = P.web3;
  if (W.enabled) {
    if (W.mode === 'mock') add('warn', 'Web3 está en modo SIMULADO: el juego exportado no usará una cartera real. Cámbialo a «Cartera real» antes de publicar si quieres blockchain de verdad.');
    W.contracts.forEach((c) => {
      let abi = []; try { abi = JSON.parse(c.abi); } catch (e) { /* vacío */ }
      if (!abi.length) add('error', 'El contrato «' + c.name + '» no tiene ABI.');
      if (W.mode === 'wallet' && !c.addresses[String(W.defaultChain)]) add('error', 'El contrato «' + c.name + '» no tiene dirección en la red principal (' + W.defaultChain + ').');
      if (SOL && c.source) { const r = SOL.abiFor(c.source, c.name); r.warnings.slice(0, 2).forEach((w) => add('warn', c.name + '.sol: ' + w)); }
    });
    if (Number(W.maxValue) > 1) add('warn', 'El pago máximo por transacción es ' + W.maxValue + ' ETH: ¿seguro?');
    if (W.mode === 'wallet' && W.chains.some((id) => [1, 137, 8453, 42161, 10, 56, 43114].includes(id))) add('info', 'Hay redes principales (dinero real) permitidas. Prueba antes en una red de pruebas.');
    add('ok', 'Web3: ' + W.contracts.length + ' contrato(s), redes ' + W.chains.join(', ') + '.');
  }
  // backend
  const B = P.backend;
  if (B.enabled) {
    if (!B.routes.length) add('warn', 'El backend está activado pero no tiene rutas.');
    if (!B.url) add('info', 'Backend sin URL de producción: el juego usará rutas relativas (el backend debe servir también el juego, en el mismo dominio).');
    else if (!/^https:\/\//.test(B.url) && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(B.url)) add('warn', 'La URL del backend no usa HTTPS: los navegadores bloquean peticiones http desde páginas https.');
    if (!B.cors.length && B.url) add('warn', 'El backend no tiene «Orígenes CORS»: el juego publicado en otro dominio no podrá llamarlo.');
    B.routes.forEach((r) => { if (/^\s*$/.test(r.code)) add('warn', 'La ruta ' + r.method + ' ' + r.path + ' está vacía.'); if (r.method !== 'GET' && r.rateLimit > 600) add('info', r.method + ' ' + r.path + ': límite alto (' + r.rateLimit + '/min).'); });
    add('ok', 'Backend: ' + B.routes.length + ' ruta(s).');
  }
  const plugins = P.scripts.filter((s) => s.plugin).length;
  if (plugins) add('info', plugins + ' plugin(s) global(es): corren antes que el juego en todas las escenas.');
  return out;
}

/** Ejecuta el juego en un iframe aislado invisible y recoge errores y avisos */
export function smokeRun(app, project, ms) {
  return new Promise(async (resolve) => {
    const logs = [], player = app.player;
    let files, scripts;
    try { files = await player.files(project); scripts = player.scripts(project); }
    catch (e) { resolve({ started: false, logs: [{ level: 'error', text: 'No se pudo preparar la prueba: ' + (e && e.message || e), source: 'Studio' }], why: 'failed' }); return; }
    const f = h('iframe', { sandbox: 'allow-scripts', title: 'Prueba automática', style: { position: 'fixed', left: '-10000px', top: '0', width: '640px', height: '360px', border: '0' } });
    f.src = 'player.html#origin=' + encodeURIComponent(location.origin);
    let started = false, done = false, limit = 0;
    const finish = (why) => { if (done) return; done = true; clearTimeout(limit); window.removeEventListener('message', onMsg); try { f.contentWindow.postMessage({ type: 'stop' }, '*'); } catch (e) { /* cerrado */ } setTimeout(() => f.remove(), 100); resolve({ started, logs, why }); };
    const onMsg = (e) => {
      if (e.source !== f.contentWindow) return; const m = e.data; if (!m || typeof m !== 'object') return;
      if (m.type === 'ready') f.contentWindow.postMessage({ type: 'run', project, files, scripts, renderer: 'auto', startScene: null, web3: '', backend: null }, '*');
      else if (m.type === 'log' && (m.level === 'error' || m.level === 'warn')) { if (logs.length < 60) logs.push({ level: m.level, text: String(m.text).slice(0, 400), source: String(m.source || '') }); }
      else if (m.type === 'started') { started = true; setTimeout(() => finish('ok'), ms || 3500); }
      else if (m.type === 'failed') finish('failed');
      else if (m.type === 'web3') f.contentWindow.postMessage({ type: 'web3-res', id: m.id, error: { code: 4100, message: 'Sin cartera en la prueba automática' } }, '*');
    };
    window.addEventListener('message', onMsg);
    document.body.appendChild(f);
    limit = setTimeout(() => finish(started ? 'ok' : 'timeout'), 20000);
  });
}

export async function validateAndTest(app) {
  const ed = app.editor; if (!ed.project) return;
  app.code.commit.flush();
  const project = JSON.parse(JSON.stringify(ed.project));
  const sizes = {};
  // misma clave que la caché de Jugar (proyecto|archivo|versión): lo ya leído no se vuelve a pedir al disco
  for (const a of project.assets) { try { const d = app.player.cache.get(ed.projectId + '|' + a.file + '|' + (ed.assetVersion[a.id] || 0)) || await ed.store.assetData(ed.projectId, a.file); sizes[a.id] = d.byteLength; } catch (e) { sizes[a.id] = 0; } }
  const results = checkProject(project, sizes);
  let box = null;
  const draw = (extra) => {
    if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    results.concat(extra || []).forEach((r) => box.appendChild(h('div.vrow.' + r.level, h('span', r.level === 'ok' ? '✅' : r.level === 'warn' ? '⚠️' : r.level === 'error' ? '❌' : 'ℹ️'), h('span', r.text))));
  };
  const running = [{ level: 'info', text: 'Ejecutando el juego en un reproductor aislado para buscar errores…' }];
  const dlg = dialog('Validar y probar la exportación', (b) => { box = h('div.vlist'); b.appendChild(box); draw(running); }, [{ label: 'Cerrar', value: null }], true);
  const r = await smokeRun(app, project, 3500);
  const extra = [];
  if (r.why === 'timeout' && !r.started) extra.push({ level: 'error', text: 'El juego no llegó a arrancar en 20 s (¿el navegador bloquea los iframes aislados?).' });
  else if (r.why === 'failed') extra.push({ level: 'error', text: 'El juego no pudo arrancar.' });
  else extra.push({ level: 'ok', text: 'El juego arrancó y se ejecutó 3,5 s en el reproductor aislado.' });
  const errs = r.logs.filter((l) => l.level === 'error'), warns = r.logs.filter((l) => l.level === 'warn');
  errs.slice(0, 12).forEach((l) => extra.push({ level: 'error', text: (l.source ? '[' + l.source + '] ' : '') + l.text }));
  warns.slice(0, 8).forEach((l) => extra.push({ level: 'warn', text: (l.source ? '[' + l.source + '] ' : '') + l.text }));
  if (!errs.length && r.started) extra.push({ level: 'ok', text: 'Sin errores durante la prueba' + (warns.length ? ' (' + warns.length + ' aviso/s)' : '') + '.' });
  const nErr = results.filter((x) => x.level === 'error').length + extra.filter((x) => x.level === 'error').length;
  extra.push({ level: nErr ? 'error' : 'ok', text: nErr ? nErr + ' problema(s) que conviene arreglar antes de exportar.' : 'Listo para exportar.' });
  draw(extra);
  app.console.log(nErr ? 'warn' : 'ok', 'Validación: ' + (nErr ? nErr + ' problema(s)' : 'todo correcto'), 'Studio');
  await dlg;
}
