/* UltraGame - depuración y herramientas: panel de estadísticas, codificador GIF (cuantización median-cut +
 * LZW), grabador de gameplay a GIF, inspector del grafo de escena y hash de estado (verificación web3). */

class StatsPanel {
  constructor(game) {
    this.game = game;
    var el = document.createElement('div');
    var st = el.style;
    st.position = 'fixed'; st.left = '8px'; st.top = '8px'; st.zIndex = '99999'; st.pointerEvents = 'none';
    st.font = '12px/1.35 ui-monospace, Consolas, monospace'; st.color = '#d8f5ff'; st.background = 'rgba(10,14,30,0.78)';
    st.padding = '6px 9px'; st.borderRadius = '8px'; st.border = '1px solid rgba(120,160,255,0.35)'; st.whiteSpace = 'pre'; st.minWidth = '150px';
    st.boxShadow = '0 4px 18px rgba(0,0,0,0.35)';
    document.body.appendChild(el);
    this.el = el;
    var self = this;
    this._last = 0;
    this._onRender = function () { var t = nowTime(); if (t - self._last > 400) { self._last = t; self.update(); } };
    game.on('postrender', this._onRender);
  }
  update() {
    var g = this.game, r = g.renderer; if (!r) return;
    var s = r.stats, live = Debug.live;
    var mem = (typeof performance !== 'undefined' && performance.memory) ? (performance.memory.usedJSHeapSize / 1048576).toFixed(1) + ' MB' : 'n/d';
    this.el.textContent = 'UltraGame ' + UG.VERSION + '\n' +
      'FPS   ' + g.loop.fps + '   (' + g.loop.delta.toFixed(1) + ' ms)\n' +
      'GPU   ' + r.type + '  @' + r.resolution.toFixed(2) + 'x\n' +
      'draws ' + s.drawCalls + '   quads ' + s.quads + '\n' +
      'culled ' + s.culled + '   fx ' + s.filters + '\n' +
      'objs  ' + (live.DisplayObject || 0) + '   tex ' + (s.textures || 0) + '\n' +
      'heap  ' + mem;
  }
  destroy() { if (this.game) this.game.off('postrender', this._onRender); if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el); this.el = null; this.game = null; }
}

/* =================================================================== GifEncoder */
class GifEncoder {
  constructor(width, height, options) {
    options = options || {};
    this.width = width | 0; this.height = height | 0;
    this.delay = options.delay !== undefined ? options.delay : 50;
    this.repeat = options.repeat !== undefined ? options.repeat : 0;
    this.dither = !!options.dither;
    this.chunks = [];
    this._size = 0;
    this.frames = 0;
    this._table = new Int32Array(1 << 20);
    this._stamp = new Int32Array(1 << 20);
    this._gen = 0;
    this._header();
  }
  _push(arr) { this.chunks.push(arr); this._size += arr.length; }
  _header() {
    var h = [];
    var s = 'GIF89a'; for (var i = 0; i < 6; i++) h.push(s.charCodeAt(i));
    h.push(this.width & 255, this.width >> 8, this.height & 255, this.height >> 8, 0x00, 0, 0);
    // NETSCAPE2.0 (bucle)
    h.push(0x21, 0xff, 0x0b); s = 'NETSCAPE2.0'; for (var j = 0; j < 11; j++) h.push(s.charCodeAt(j));
    h.push(0x03, 0x01, this.repeat & 255, (this.repeat >> 8) & 255, 0x00);
    this._push(new Uint8Array(h));
  }
  /** Cuantiza a 256 colores (median-cut sobre histograma de 15 bits). */
  _quantize(rgba) {
    var n = this.width * this.height, hist = new Uint32Array(32768), keys = new Uint16Array(n), i;
    for (i = 0; i < n; i++) { var o = i * 4, k = ((rgba[o] >> 3) << 10) | ((rgba[o + 1] >> 3) << 5) | (rgba[o + 2] >> 3); keys[i] = k; hist[k]++; }
    var colors = [];
    for (i = 0; i < 32768; i++) if (hist[i]) colors.push(i);
    var boxes = [{ c: colors, lo: 0, hi: colors.length }];
    var comp = function (k, ch) { return ch === 0 ? (k >> 10) & 31 : (ch === 1 ? (k >> 5) & 31 : k & 31); };
    while (boxes.length < 256) {
      var best = -1, bestRange = 0, bestCh = 0;
      for (var b = 0; b < boxes.length; b++) {
        var bx = boxes[b]; if (bx.hi - bx.lo < 2) continue;
        for (var ch = 0; ch < 3; ch++) {
          var mn = 32, mx = -1;
          for (var q = bx.lo; q < bx.hi; q++) { var v = comp(colors[q], ch); if (v < mn) mn = v; if (v > mx) mx = v; }
          var rg = (mx - mn) * (ch === 1 ? 1.2 : 1);
          if (rg > bestRange) { bestRange = rg; best = b; bestCh = ch; }
        }
      }
      if (best < 0) break;
      var box = boxes[best], sub = colors.slice(box.lo, box.hi), chs = bestCh;
      sub.sort(function (a, c2) { return comp(a, chs) - comp(c2, chs); });
      var total = 0; for (var s1 = 0; s1 < sub.length; s1++) total += hist[sub[s1]];
      var acc = 0, cut = 1;
      for (var s2 = 0; s2 < sub.length - 1; s2++) { acc += hist[sub[s2]]; if (acc >= total / 2) { cut = s2 + 1; break; } cut = s2 + 1; }
      for (var s3 = 0; s3 < sub.length; s3++) colors[box.lo + s3] = sub[s3];
      boxes.splice(best, 1, { c: colors, lo: box.lo, hi: box.lo + cut }, { c: colors, lo: box.lo + cut, hi: box.hi });
    }
    var palette = new Uint8Array(256 * 3), lut = new Uint8Array(32768);
    for (var p = 0; p < boxes.length; p++) {
      var bb = boxes[p], r = 0, g = 0, bl = 0, w = 0;
      for (var t = bb.lo; t < bb.hi; t++) { var key = colors[t], cnt = hist[key]; r += ((key >> 10) & 31) * cnt; g += ((key >> 5) & 31) * cnt; bl += (key & 31) * cnt; w += cnt; lut[key] = p; }
      if (w) { palette[p * 3] = Math.round(r / w * 255 / 31); palette[p * 3 + 1] = Math.round(g / w * 255 / 31); palette[p * 3 + 2] = Math.round(bl / w * 255 / 31); }
    }
    var idx = new Uint8Array(n);
    for (i = 0; i < n; i++) idx[i] = lut[keys[i]];
    return { palette: palette, indices: idx };
  }
  addFrame(rgba, delayMs) {
    var q = this._quantize(rgba), d = Math.round((delayMs !== undefined ? delayMs : this.delay) / 10);
    var h = [0x21, 0xf9, 0x04, 0x04, d & 255, (d >> 8) & 255, 0x00, 0x00];
    h.push(0x2c, 0, 0, 0, 0, this.width & 255, this.width >> 8, this.height & 255, this.height >> 8, 0x87);
    this._push(new Uint8Array(h));
    this._push(q.palette);
    this._push(this._lzw(8, q.indices));
    this.frames++;
    return this;
  }
  _lzw(minCode, index) {
    var out = [minCode], block = [], cur = 0, shift = 0;
    var clear = 1 << minCode, eoi = clear + 1, next = eoi + 1, size = minCode + 1;
    var table = this._table, stamp = this._stamp, gen = ++this._gen;
    var emitByte = function (b) { block.push(b); if (block.length === 255) { out.push(255); for (var i = 0; i < 255; i++) out.push(block[i]); block.length = 0; } };
    var emit = function (c) { cur |= c << shift; shift += size; while (shift >= 8) { emitByte(cur & 255); cur >>>= 8; shift -= 8; } };
    emit(clear);
    var prefix = index[0];
    for (var i = 1; i < index.length; i++) {
      var k = index[i], key = (prefix << 8) | k;
      if (stamp[key] === gen) { prefix = table[key]; continue; }
      emit(prefix);
      if (next === 4096) { emit(clear); next = eoi + 1; size = minCode + 1; gen = ++this._gen; }
      else { if (next >= (1 << size)) size++; table[key] = next++; stamp[key] = gen; }
      prefix = k;
    }
    emit(prefix); emit(eoi);
    if (shift > 0) emitByte(cur & 255);
    if (block.length) { out.push(block.length); for (var j = 0; j < block.length; j++) out.push(block[j]); }
    out.push(0);
    return new Uint8Array(out);
  }
  finish() {
    this._push(new Uint8Array([0x3b]));
    var all = new Uint8Array(this._size), o = 0;
    for (var i = 0; i < this.chunks.length; i++) { all.set(this.chunks[i], o); o += this.chunks[i].length; }
    this.chunks = [all];
    return all;
  }
}

/* ===================================================================== Recorder */
class Recorder {
  constructor(game) { this.game = game; this.recording = false; this.frames = []; this._cv = null; }
  /** Graba el canvas: start({fps: 20, scale: 0.5, maxFrames: 120}) */
  start(options) {
    options = options || {};
    var g = this.game, self = this;
    this.fps = options.fps || 20; this.scale = options.scale || 0.5; this.maxFrames = options.maxFrames || 150;
    var w = Math.max(1, Math.round(g.width * this.scale)), h = Math.max(1, Math.round(g.height * this.scale));
    this._cv = createCanvas(w, h); this._ctx = this._cv.getContext('2d', { willReadFrequently: true });
    this.encoder = new GifEncoder(w, h, { delay: 1000 / this.fps });
    this.recording = true; this._acc = 1e9; this.frames = 0;
    this._onRender = function () {
      if (!self.recording) return;
      self._acc += g.loop.delta;
      if (self._acc < 1000 / self.fps) return;
      self._acc = 0;
      self._ctx.drawImage(g.canvas, 0, 0, w, h);
      self.encoder.addFrame(self._ctx.getImageData(0, 0, w, h).data);
      if (++self.frames >= self.maxFrames) self.stop();
    };
    g.on('postrender', this._onRender);
    return this;
  }
  /** Captura manual de un frame (útil con loop.step()). */
  capture() { var w = this._cv.width, h = this._cv.height; this._ctx.drawImage(this.game.canvas, 0, 0, w, h); this.encoder.addFrame(this._ctx.getImageData(0, 0, w, h).data); this.frames++; return this; }
  stop() {
    if (!this.encoder) return null;
    this.recording = false;
    this.game.off('postrender', this._onRender);
    var bytes = this.encoder.finish();
    this.encoder = null; releaseCanvas(this._cv); this._cv = null; this._ctx = null;
    this.lastGif = bytes;
    return typeof Blob !== 'undefined' ? new Blob([bytes], { type: 'image/gif' }) : bytes;
  }
}

/** Utilidades de depuración/verificación */
Debug.inspect = function (obj, depth) {
  depth = depth === undefined ? 4 : depth;
  var walk = function (o, d) {
    var n = { type: o.type, name: o.name, x: Math.round(o.x * 100) / 100, y: Math.round(o.y * 100) / 100, visible: o.visible, children: o.children.length };
    if (d > 0 && o.children.length) n.kids = o.children.slice(0, 64).map(function (c) { return walk(c, d - 1); });
    return n;
  };
  return walk(obj, depth);
};
/** Hash SHA-256 determinista de un estado (p.ej. para verificar partidas en servidor / blockchain). */
Debug.hashState = function (state) {
  var norm = function (v) {
    if (v === null || typeof v !== 'object') return typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v;
    if (Array.isArray(v)) return v.map(norm);
    var o = {}; Object.keys(v).sort().forEach(function (k) { if (!isForbiddenKey(k)) o[k] = norm(v[k]); }); return o;
  };
  return Security.sha256(JSON.stringify(norm(state)));
};
/** Grabador de entradas por frame + semilla => replays deterministas (usar con fps.fixedStep). */
class InputLog {
  constructor(game) { this.game = game; this.events = []; this.active = false; }
  start() {
    var self = this, g = this.game;
    this.active = true; this.events = []; this.startFrame = g.frame;
    this._k = function (e, code) { self.events.push([g.frame - self.startFrame, 'k', code]); };
    this._ku = function (e, code) { self.events.push([g.frame - self.startFrame, 'ku', code]); };
    this._p = function (p) { self.events.push([g.frame - self.startFrame, 'pd', Math.round(p.x), Math.round(p.y)]); };
    this._pu = function (p) { self.events.push([g.frame - self.startFrame, 'pu', Math.round(p.x), Math.round(p.y)]); };
    g.input.on('keydown', this._k); g.input.on('keyup', this._ku); g.input.on('pointerdown', this._p); g.input.on('pointerup', this._pu);
    return this;
  }
  stop() { var g = this.game; this.active = false; g.input.off('keydown', this._k); g.input.off('keyup', this._ku); g.input.off('pointerdown', this._p); g.input.off('pointerup', this._pu); return this.events.slice(); }
  toJSON() { return { seed: this.game.config.seed, events: this.events }; }
}

UG.StatsPanel = StatsPanel;
UG.GifEncoder = GifEncoder;
UG.Recorder = Recorder;
UG.InputLog = InputLog;
