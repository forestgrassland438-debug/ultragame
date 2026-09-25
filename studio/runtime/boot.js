/* UltraGame Studio · arranque de un juego exportado.
 * index.html carga: ultragame.js, schema.js, runtime.js, project.js (window.UGS_PROJECT), scripts/*.js y este archivo.
 * ?r=webgpu|webgl2|webgl|canvas fuerza un renderizador. */
(function () {
  'use strict';
  function fail(text) {
    var previous = document.getElementById('ugs-start-error'); if (previous) return;
    var d = document.createElement('div');
    d.id = 'ugs-start-error'; d.setAttribute('role', 'alert');
    d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#ffd8d8;background:#1a0b0b;font:16px system-ui,sans-serif;padding:24px;text-align:center';
    d.textContent = text; document.body.appendChild(d);
  }
  try {
    var p = window.UGS_PROJECT;
    if (!p) { fail('Falta project.js: vuelve a exportar el juego desde UltraGame Studio.'); return; }
    var embedded = window.UGS_ASSETS || null; // exportación "un solo archivo": recursos como data: URI
    var q = new URLSearchParams(location.search), r = q.get('r');
    window.ugsGame = UGStudio.runtime.start(p, {
      parent: 'game', renderer: /^(webgpu|webgl2|webgl|canvas)$/.test(r || '') ? r : undefined,
      assetURL: function (a) { return embedded ? embedded[a.id] || null : a.file; }
    });
    window.ugsGame.ready.catch(function (e) { fail('No se pudo iniciar el juego: ' + (e && e.message || String(e))); });
  } catch (e) { fail('No se pudo iniciar el juego: ' + e.message); }
})();
