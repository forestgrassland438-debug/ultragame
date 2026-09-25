/* UltraGame Studio · reproductor (se ejecuta dentro de un iframe con sandbox="allow-scripts", sin allow-same-origin).
 * Origen opaco: el juego no puede leer la cookie del editor, ni llamar a su API, ni tocar su DOM.
 * El editor le envía por postMessage el proyecto, los recursos (ArrayBuffer) y los scripts ya envueltos;
 * el reproductor responde solo con mensajes de consola/estado, del puente (bridge-out) y peticiones web3 que el editor
 * revisa (lista blanca, importe máximo, confirmación) antes de pasarlas a la cartera real. */
(function () {
  'use strict';
  var parentWin = window.parent;
  var m = /(?:^#|&)origin=([^&]+)/.exec(location.hash || '');
  var parentOrigin = m ? decodeURIComponent(m[1]) : '';
  if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(parentOrigin)) parentOrigin = '';
  var game = null, urls = [], scriptNames = Object.create(null), sentLogs = 0, runId = 0;
  /* proveedor EIP-1193 que reenvía al editor (la cartera real vive en la página del Studio, no en este iframe) */
  var w3pending = Object.create(null), w3seq = 0, w3listeners = { accountsChanged: [], chainChanged: [] };
  var proxyProvider = {
    isStudioProxy: true,
    request: function (a) {
      var id = ++w3seq, method = a && typeof a.method === 'string' ? a.method : '', params = a && Array.isArray(a.params) ? a.params : [];
      return new Promise(function (resolve, reject) {
        var t = setTimeout(function () { if (w3pending[id]) { delete w3pending[id]; reject(new Error('La cartera no respondió a tiempo')); } }, 300000);
        w3pending[id] = { resolve: resolve, reject: reject, t: t };
        post({ type: 'web3', id: id, method: method, params: JSON.parse(JSON.stringify(params)) });
      });
    },
    on: function (ev, fn) { if (w3listeners[ev] && typeof fn === 'function') w3listeners[ev].push(fn); },
    removeListener: function (ev, fn) { var l = w3listeners[ev]; if (l) { var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } }
  };

  function post(msg) { if (!parentOrigin || parentWin === window) return; try { parentWin.postMessage(msg, parentOrigin); } catch (e) { /* editor cerrado */ } }
  function log(level, text, source) {
    if (++sentLogs > 3000) { if (sentLogs === 3001) post({ type: 'log', level: 'warn', text: 'Demasiados mensajes: la consola deja de recibirlos en esta ejecución.', source: 'reproductor' }); return; }
    post({ type: 'log', level: level, text: String(text).slice(0, 2000), source: String(source || '').slice(0, 120) });
  }
  function fmt(a) { if (typeof a === 'string') return a; if (a instanceof Error) return a.message; try { return JSON.stringify(a); } catch (e) { return String(a); } }
  // console.* del juego -> consola del Studio
  ['log', 'info', 'warn', 'error'].forEach(function (k) {
    var orig = console[k] ? console[k].bind(console) : function () {};
    console[k] = function () { orig.apply(null, arguments); log(k === 'info' ? 'info' : k === 'log' ? 'info' : k, Array.prototype.map.call(arguments, fmt).join(' '), 'consola'); };
  });
  window.addEventListener('error', function (e) {
    var src = e.filename && scriptNames[e.filename] ? scriptNames[e.filename] : '';
    // los scripts se envuelven con 1 línea al principio: línea real = línea - 1
    var line = src && e.lineno ? ' (línea ' + Math.max(1, e.lineno - 1) + ')' : '';
    log('error', (e.message || 'Error') + line, src || 'juego');
  });
  window.addEventListener('unhandledrejection', function (e) { var r = e.reason; log('error', 'Promesa rechazada: ' + (r && r.message ? r.message : fmt(r)), 'juego'); });

  function cleanup() {
    if (game) { try { game.destroy(true); } catch (e) { /* ya destruido */ } game = null; window.ugsGame = null; }
    Object.keys(w3pending).forEach(function (k) { clearTimeout(w3pending[k].t); w3pending[k].reject(new Error('Juego detenido')); }); w3pending = Object.create(null);
    w3listeners = { accountsChanged: [], chainChanged: [] };
    urls.forEach(function (u) { URL.revokeObjectURL(u); }); urls = [];
    Array.prototype.slice.call(document.querySelectorAll('script[data-ugs]')).forEach(function (s) { s.remove(); });
    scriptNames = Object.create(null);
    if (window.UGStudio && UGStudio.runtime) UGStudio.runtime.resetScripts();
    var g = document.getElementById('game'); while (g.firstChild) g.removeChild(g.firstChild);
  }
  var MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
    glb: 'application/octet-stream', gltf: 'application/json', bin: 'application/octet-stream', obj: 'text/plain', mtl: 'text/plain', json: 'application/json', tmj: 'application/json', tsj: 'application/json', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
  function loadScript(id, name, source, myRun) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' })); urls.push(url); scriptNames[url] = name;
      var s = document.createElement('script'); s.src = url; s.dataset.ugs = id;
      s.onload = function () { resolve(myRun === runId); }; s.onerror = function () { log('error', 'No se pudo cargar el script', name); resolve(false); };
      document.body.appendChild(s);
    });
  }
  function run(msg) {
    cleanup();
    var myRun = ++runId; sentLogs = 0;
    var files = Array.isArray(msg.files) ? msg.files : [], map = Object.create(null);
    files.forEach(function (f) {
      if (!f || typeof f.id !== 'string' || !(f.data instanceof ArrayBuffer)) return;
      var ext = (/\.([a-z0-9]+)$/i.exec(f.file || '') || [])[1];
      var u = URL.createObjectURL(new Blob([f.data], { type: MIME[(ext || '').toLowerCase()] || 'application/octet-stream' })); urls.push(u); map[f.id] = u;
    });
    var scripts = Array.isArray(msg.scripts) ? msg.scripts : [];
    // cada script en su propio archivo: un error de sintaxis solo desactiva ese script
    var chain = Promise.resolve();
    scripts.forEach(function (s) { chain = chain.then(function () { if (myRun === runId && s && typeof s.source === 'string') return loadScript(String(s.id), String(s.name || s.id), s.source, myRun); }); });
    chain.then(function () {
      if (myRun !== runId) return;
      try {
        game = UGStudio.runtime.start(msg.project, {
          parent: 'game', renderer: /^(webgpu|webgl2|webgl|canvas)$/.test(msg.renderer) ? msg.renderer : undefined, startScene: msg.startScene || null,
          assetURL: function (a) { return map[a.id] || null; }, onLog: log, debugPhysics: msg.debugPhysics === true,
          onBridge: function (name, data) { post({ type: 'bridge-out', name: name, data: data }); },
          web3Provider: msg.web3 === 'studio' ? proxyProvider : null,
          backendURL: msg.backend && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(msg.backend.url) ? msg.backend.url : '',
          backendToken: msg.backend && typeof msg.backend.token === 'string' ? msg.backend.token.slice(0, 100) : ''
        });
        window.ugsGame = game; // accesible desde la consola del iframe (depuración)
        var startedGame = game;
        game.ready.then(function () {
          if (myRun !== runId || game !== startedGame) return;
          post({ type: 'started', renderer: startedGame.rendererType }); window.focus();
        }, function (e) {
          if (myRun !== runId || game !== startedGame) return;
          log('error', 'No se pudo iniciar: ' + (e && e.message || String(e)), 'reproductor'); post({ type: 'failed' });
        });
      } catch (e) { log('error', 'No se pudo iniciar: ' + e.message, 'reproductor'); post({ type: 'failed' }); }
    });
  }
  window.addEventListener('message', function (e) {
    if (e.source !== parentWin || e.origin !== parentOrigin) return; // solo el editor que nos abrió
    var msg = e.data; if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'run') run(msg);
    else if (msg.type === 'stop') { runId++; cleanup(); post({ type: 'stopped' }); }
    else if (msg.type === 'debug' && game && UGStudio.runtime.setDebugPhysics) UGStudio.runtime.setDebugPhysics(game, msg.physics === true);
    else if (msg.type === 'pause' && game) game.pause();
    else if (msg.type === 'resume' && game) game.resume();
    else if (msg.type === 'bridge-in' && game && game.bridge && typeof msg.name === 'string') game.bridge.receive(msg.name, msg.data);
    else if (msg.type === 'web3-res' && w3pending[msg.id]) {
      var pd = w3pending[msg.id]; delete w3pending[msg.id]; clearTimeout(pd.t);
      if (msg.error) pd.reject(Object.assign(new Error(String(msg.error.message || 'Error de la cartera').slice(0, 300)), { code: msg.error.code | 0 })); else pd.resolve(msg.result);
    }
    else if (msg.type === 'web3-event' && w3listeners[msg.event]) w3listeners[msg.event].slice().forEach(function (fn) { try { fn(msg.data); } catch (x) { /* ignorar */ } });
    else if (msg.type === 'vars' && game && game.ugs) {
      // solo valores clonables: una función o un objeto del motor en una variable no debe vaciar todo el panel
      var out = {}; Object.keys(game.ugs.vars).slice(0, 200).forEach(function (k) {
        var v = game.ugs.vars[k];
        if (v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out[k] = v;
        else if (typeof v === 'undefined') out[k] = null;
        else { try { var j = JSON.stringify(v); out[k] = j === undefined ? String(v) : j.length > 2000 ? j.slice(0, 2000) + '…' : JSON.parse(j); } catch (x) { out[k] = '[' + (typeof v) + ']'; } }
      });
      var scenes = (game.ugs.rts || []).filter(function (rt) { return rt.alive && rt.def; }).map(function (rt) { return String(rt.def.name).slice(0, 60); });
      post({ type: 'vars', vars: out, fps: game.loop ? Math.round(game.loop.actualFps) : 0, scene: scenes.join(', '), paused: !!(game.loop && game.loop.paused) });
    }
    // el panel de variables del Studio cambia un valor (para probar: vida, puntos, nivel…)
    else if (msg.type === 'setVar' && game && game.ugs && typeof msg.name === 'string') game.ugs.setVar(msg.name.slice(0, 40), msg.value);
  });
  window.addEventListener('pointerdown', function () { window.focus(); });
  post({ type: 'ready' });
})();
