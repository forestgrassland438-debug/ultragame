/* UltraGame - escalado: fit (letterbox), envelop (recorte), fill (estirar), resize (tamaño dinámico), none.
 * Renderiza a la resolución física real (nítido en pantallas retina) con tope configurable para rendimiento
 * en móviles, pantalla completa, orientación y centrado. */

var SCALE = { NONE: 'none', FIT: 'fit', ENVELOP: 'envelop', FILL: 'fill', RESIZE: 'resize' };

class ScaleManager extends EventEmitter {
  constructor(game, config) {
    super();
    config = config || {};
    this.game = game;
    this.mode = config.mode || 'fit';
    this.autoCenter = config.autoCenter !== false;
    this.zoom = config.zoom || 1;
    this.min = config.min || null; this.max = config.max || null;
    this.resolution = config.resolution || game.config.resolution || 'auto';
    this.maxResolution = config.maxResolution || game.config.maxResolution || 2;
    this.maxPixels = config.maxPixels || 3840 * 2160;
    this.fullscreenTarget = config.fullscreenTarget || null;
    this.parent = null; this.canvas = null;
    this.displaySize = { width: game.width, height: game.height };
    this.gameSize = { width: game.width, height: game.height };
    this.dom = new DOMListeners();
    this._raf = 0; this._ro = null;
    this.isFullscreen = false;
  }
  boot(parent, canvas) {
    this.parent = parent; this.canvas = canvas;
    var self = this, sched = function () { self.scheduleRefresh(); };
    if (typeof window !== 'undefined') {
      this.dom.add(window, 'resize', sched, false);
      this.dom.add(window, 'orientationchange', function () { setTimeout(sched, 120); }, false);
      if (window.visualViewport) this.dom.add(window.visualViewport, 'resize', sched, false);
      var fsc = function () { self.isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement); self.emit(self.isFullscreen ? 'enterfullscreen' : 'leavefullscreen'); sched(); };
      this.dom.add(document, 'fullscreenchange', fsc, false);
      this.dom.add(document, 'webkitfullscreenchange', fsc, false);
    }
    if (typeof ResizeObserver !== 'undefined' && parent && parent !== document.body) {
      try { this._ro = new ResizeObserver(sched); this._ro.observe(parent); } catch (e) { this._ro = null; }
    }
    canvas.style.display = 'block';
    this.refresh();
  }
  scheduleRefresh() {
    if (this._raf || typeof requestAnimationFrame === 'undefined') { if (!this._raf) this.refresh(); return; }
    var self = this;
    this._raf = requestAnimationFrame(function () { self._raf = 0; self.refresh(); });
  }
  getParentSize() {
    var p = this.parent;
    if (!p || typeof window === 'undefined') return { width: this.game.width, height: this.game.height };
    if (p === document.body || p === document.documentElement || this.isFullscreen) {
      var vv = window.visualViewport;
      return { width: vv ? vv.width : window.innerWidth, height: vv ? vv.height : window.innerHeight };
    }
    var r = p.getBoundingClientRect();
    var cs = window.getComputedStyle ? window.getComputedStyle(p) : null;
    var padX = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0, padY = cs ? (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) : 0;
    var w = r.width - padX, h = r.height - padY;
    if (h < 2) h = this.game.height * (w / this.game.width);
    return { width: Math.max(1, w), height: Math.max(1, h) };
  }
  refresh() {
    var g = this.game, c = this.canvas; if (!c) return;
    var ps = this.getParentSize(), gw = g.width, gh = g.height, dw, dh, s;
    switch (this.mode) {
      case 'none': dw = gw * this.zoom; dh = gh * this.zoom; break;
      case 'envelop': s = Math.max(ps.width / gw, ps.height / gh); dw = gw * s; dh = gh * s; break;
      case 'fill': dw = ps.width; dh = ps.height; break;
      case 'resize': {
        var nw = Math.floor(ps.width), nh = Math.floor(ps.height);
        if (this.min) { nw = Math.max(nw, this.min.width || 0); nh = Math.max(nh, this.min.height || 0); }
        if (this.max) { nw = Math.min(nw, this.max.width || nw); nh = Math.min(nh, this.max.height || nh); }
        gw = nw; gh = nh; dw = nw; dh = nh;
        if (gw !== g.width || gh !== g.height) g._setSize(gw, gh);
        break;
      }
      default: s = Math.min(ps.width / gw, ps.height / gh); if (!(s > 0)) s = 1; dw = gw * s; dh = gh * s;
    }
    dw = Math.max(1, Math.floor(dw)); dh = Math.max(1, Math.floor(dh));
    var dpr = typeof this.resolution === 'number' ? this.resolution : Math.min(this.maxResolution, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    var res = dpr * Math.max(dw / gw, dh / gh);
    if (this.game.config.pixelArt && this.mode !== 'fill') res = Math.max(1, res);
    var px = gw * res * gh * res;
    if (px > this.maxPixels) res *= Math.sqrt(this.maxPixels / px);
    var max = g.renderer ? g.renderer.maxTextureSize : 8192;
    if (gw * res > max) res = max / gw;
    if (gh * res > max) res = Math.min(res, max / gh);
    c.style.width = dw + 'px'; c.style.height = dh + 'px';
    if (this.autoCenter && this.mode !== 'resize') {
      c.style.marginLeft = Math.floor((ps.width - dw) / 2) + 'px';
      c.style.marginTop = Math.max(0, Math.floor((ps.height - dh) / 2)) + 'px';
    } else { c.style.marginLeft = '0px'; c.style.marginTop = '0px'; }
    if (this.game.config.pixelArt) c.style.imageRendering = 'pixelated';
    var changed = dw !== this.displaySize.width || dh !== this.displaySize.height || !g.renderer || g.renderer.resolution !== res;
    this.displaySize.width = dw; this.displaySize.height = dh;
    this.gameSize.width = gw; this.gameSize.height = gh;
    if (g.renderer) g.renderer.resize(gw, gh, res);
    if (changed) this.emit('resize', this.gameSize, this.displaySize, res);
  }
  setMode(mode) { this.mode = mode; this.refresh(); return this; }
  setGameSize(w, h) { this.game._setSize(w, h); this.refresh(); return this; }
  get isPortrait() { return typeof window !== 'undefined' && window.innerHeight > window.innerWidth; }
  get isLandscape() { return !this.isPortrait; }
  get orientation() { return this.isPortrait ? 'portrait' : 'landscape'; }
  /** Debe llamarse desde un gesto del usuario (click/tap). */
  startFullscreen(options) {
    var el = this.fullscreenTarget || this.parent || this.canvas, self = this;
    if (!el || typeof document === 'undefined') return Promise.resolve(false);
    var req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (!req) { this.emit('fullscreenunsupported'); return Promise.resolve(false); }
    try {
      var p = req.call(el, options || { navigationUI: 'hide' });
      return Promise.resolve(p).then(function () { return true; }, function (e) { self.emit('fullscreenfailed', e); return false; });
    } catch (e) { this.emit('fullscreenfailed', e); return Promise.resolve(false); }
  }
  stopFullscreen() {
    if (typeof document === 'undefined') return;
    var ex = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (ex && (document.fullscreenElement || document.webkitFullscreenElement)) { try { var p = ex.call(document); if (p && p.catch) p.catch(noop); } catch (e) { /* ignorar */ } }
  }
  toggleFullscreen() { if (this.isFullscreen) this.stopFullscreen(); else this.startFullscreen(); }
  lockOrientation(o) {
    var so = typeof screen !== 'undefined' ? screen.orientation : null;
    if (so && so.lock) { try { var p = so.lock(o); if (p && p.catch) p.catch(noop); return true; } catch (e) { return false; } }
    return false;
  }
  destroy() {
    this.dom.removeAll();
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    if (this._raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this._raf);
    this.off(); this.canvas = null; this.parent = null; this.game = null;
  }
}

UG.SCALE = SCALE;
UG.Scale = SCALE;
UG.ScaleManager = ScaleManager;
