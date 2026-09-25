/* UltraGame Studio · arranque de un juego exportado.
 * index.html carga: ultragame.js, schema.js, runtime.js, project.js (window.UGS_PROJECT), scripts/*.js y este archivo.
 * Abierto con doble clic (file://) el navegador trata cada imagen o modelo de la carpeta como de «otro origen» y no deja
 * usarlo: entonces se carga assets-inline.js (los mismos recursos como data: URI) antes de empezar.
 * El HTML único trae los recursos en un bloque <script type="application/json" id="ugs-assets">.
 * ?r=webgpu|webgl2|webgl|canvas fuerza un renderizador. */
(function () {
  'use strict';
  function fail(text) {
    var previous = document.getElementById('ugs-start-error'); if (previous) return;
    var d = document.createElement('div');
    d.id = 'ugs-start-error'; d.setAttribute('role', 'alert');
    d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#ffd8d8;background:#1a0b0b;font:16px system-ui,sans-serif;padding:24px;text-align:center;white-space:pre-line;z-index:10';
    d.textContent = text; document.body.appendChild(d);
  }
  /** Recursos embebidos: bloque JSON del HTML único o assets-inline.js (window.UGS_ASSETS) */
  function embeddedAssets() {
    if (window.UGS_ASSETS && typeof window.UGS_ASSETS === 'object') return window.UGS_ASSETS;
    var el = document.getElementById('ugs-assets');
    if (!el) return null;
    try { var o = JSON.parse(el.textContent || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch (e) { return null; }
  }
  function start() {
    try {
      var p = window.UGS_PROJECT;
      if (!p) { fail('Falta project.js: vuelve a exportar el juego desde UltraGame Studio.'); return; }
      if (!window.UGStudio || !window.UGStudio.runtime || !window.UG) { fail('Faltan archivos del juego (ultragame.js, schema.js o runtime.js): vuelve a exportarlo desde UltraGame Studio.'); return; }
      var embedded = embeddedAssets();
      var q = new URLSearchParams(location.search), r = q.get('r');
      window.ugsGame = UGStudio.runtime.start(p, {
        parent: 'game', renderer: /^(webgpu|webgl2|webgl|canvas)$/.test(r || '') ? r : undefined,
        assetURL: function (a) {
          if (!embedded) return a.file;
          return Object.prototype.hasOwnProperty.call(embedded, a.id) && typeof embedded[a.id] === 'string' ? embedded[a.id] : null;
        }
      });
      window.ugsGame.ready.catch(function (e) { fail('No se pudo iniciar el juego: ' + (e && e.message || String(e))); });
    } catch (e) { fail('No se pudo iniciar el juego: ' + (e && e.message || String(e))); }
  }
  var needsInline = location.protocol === 'file:' && !embeddedAssets() && window.UGS_PROJECT && window.UGS_PROJECT.assets && window.UGS_PROJECT.assets.length;
  if (!needsInline) { start(); return; }
  var s = document.createElement('script');
  s.src = 'assets-inline.js';
  s.onload = start;
  s.onerror = function () { fail('Este juego se ha abierto desde el disco y le falta assets-inline.js.\nSúbelo a un servidor web, o vuelve a exportarlo desde UltraGame Studio (Descargar ZIP o HTML único).'); };
  document.body.appendChild(s);
})();
