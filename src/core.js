/* UltraGame - núcleo: espacio de nombres, utilidades, eventos, colores, seguridad, pools. */

var UG = {};
UG.VERSION = '__VERSION__';

var GLOBAL = (typeof globalThis !== 'undefined') ? globalThis
  : (typeof self !== 'undefined') ? self
    : (typeof window !== 'undefined') ? window : {};
var HAS_DOM = typeof document !== 'undefined' && typeof document.createElement === 'function';
var IS_LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x11223344]).buffer)[0] === 0x44;

var _uidCounter = 0;
function uid() { return ++_uidCounter; }
function noop() {}
var PI2 = Math.PI * 2;
var DEG_TO_RAD = Math.PI / 180;
var RAD_TO_DEG = 180 / Math.PI;

var nowTime = (typeof performance !== 'undefined' && performance.now)
  ? function () { return performance.now(); }
  : function () { return Date.now(); };

/* ---------------------------------------------------------------- Log */
var Log = {
  enabled: true,
  _once: new Set(),
  info: function () { if (this.enabled && typeof console !== 'undefined') console.info.apply(console, ['[UltraGame]'].concat(Array.prototype.slice.call(arguments))); },
  warn: function () { if (this.enabled && typeof console !== 'undefined') console.warn.apply(console, ['[UltraGame]'].concat(Array.prototype.slice.call(arguments))); },
  error: function () { if (typeof console !== 'undefined') console.error.apply(console, ['[UltraGame]'].concat(Array.prototype.slice.call(arguments))); },
  warnOnce: function (key) {
    if (this._once.has(key)) return;
    if (this._once.size > 2000) this._once.clear();
    this._once.add(key);
    this.warn.apply(this, Array.prototype.slice.call(arguments, 1));
  }
};

/* ------------------------------------------------ Contador de objetos vivos
 * Cada recurso (texturas, objetos de escena, tweens, sonidos, buffers GPU...) incrementa
 * su contador al crearse y lo decrementa al destruirse. Las pruebas de fugas comparan
 * instantáneas antes/después para demostrar que todo se libera. */
var Debug = {
  live: Object.create(null),
  track: function (type, d) { this.live[type] = (this.live[type] || 0) + d; },
  snapshot: function () { var o = {}; for (var k in this.live) o[k] = this.live[k]; return o; },
  diff: function (a, b) {
    var out = {}; var keys = new Set(Object.keys(a).concat(Object.keys(b)));
    keys.forEach(function (k) { var d = (b[k] || 0) - (a[k] || 0); if (d !== 0) out[k] = d; });
    return out;
  }
};

/* ------------------------------------------------------------ EventEmitter
 * Emisor sin asignaciones durante emit(): las bajas durante una emisión se marcan y
 * se compactan al terminar, así es seguro llamar off() dentro de un listener. */
function EventEmitter() { this._ev = null; this._evDepth = 0; this._evDirty = false; }
EventEmitter.prototype.on = function (name, fn, ctx) {
  if (typeof fn !== 'function') throw new TypeError('UltraGame: el listener de "' + String(name) + '" debe ser una función');
  var ev = this._ev || (this._ev = new Map());
  var list = ev.get(name);
  if (!list) { list = []; ev.set(name, list); }
  list.push({ fn: fn, ctx: ctx === undefined ? this : ctx, once: false });
  return this;
};
EventEmitter.prototype.addListener = EventEmitter.prototype.on;
EventEmitter.prototype.once = function (name, fn, ctx) {
  this.on(name, fn, ctx);
  var list = this._ev.get(name); list[list.length - 1].once = true;
  return this;
};
EventEmitter.prototype.off = function (name, fn, ctx) {
  var ev = this._ev; if (!ev) return this;
  var self = this;
  if (name === undefined) {
    if (this._evDepth > 0) { ev.forEach(function (list) { for (var i = 0; i < list.length; i++) list[i].fn = null; }); this._evDirty = true; }
    else ev.clear();
    return this;
  }
  var list = ev.get(name); if (!list) return this;
  for (var i = list.length - 1; i >= 0; i--) {
    var l = list[i];
    if (l.fn === null) continue;
    if (fn === undefined || (l.fn === fn && (ctx === undefined || l.ctx === ctx))) {
      if (self._evDepth > 0) { l.fn = null; self._evDirty = true; } else list.splice(i, 1);
    }
  }
  if (list.length === 0 && this._evDepth === 0) ev.delete(name);
  return this;
};
EventEmitter.prototype.removeListener = EventEmitter.prototype.off;
EventEmitter.prototype.removeAllListeners = function (name) { return this.off(name); };
EventEmitter.prototype.emit = function (name, a, b, c, d, e) {
  var ev = this._ev; if (!ev) return false;
  var list = ev.get(name); if (!list || list.length === 0) return false;
  this._evDepth++;
  var n = list.length;
  try {
    for (var i = 0; i < n; i++) {
      var l = list[i]; var fn = l.fn; if (fn === null) continue;
      if (l.once) { l.fn = null; this._evDirty = true; }
      fn.call(l.ctx, a, b, c, d, e);
    }
  } finally {
    if (--this._evDepth === 0 && this._evDirty) this._compactEvents();
  }
  return true;
};
EventEmitter.prototype._compactEvents = function () {
  this._evDirty = false;
  var ev = this._ev; if (!ev) return;
  var dead = [];
  ev.forEach(function (list, key) {
    var j = 0;
    for (var i = 0; i < list.length; i++) if (list[i].fn !== null) list[j++] = list[i];
    list.length = j;
    if (j === 0) dead.push(key);
  });
  for (var k = 0; k < dead.length; k++) ev.delete(dead[k]);
};
EventEmitter.prototype.listenerCount = function (name) {
  var ev = this._ev; if (!ev) return 0;
  if (name === undefined) { var t = 0; ev.forEach(function (l) { for (var i = 0; i < l.length; i++) if (l[i].fn) t++; }); return t; }
  var list = ev.get(name); if (!list) return 0;
  var c = 0; for (var i = 0; i < list.length; i++) if (list[i].fn) c++;
  return c;
};
EventEmitter.prototype.eventNames = function () { return this._ev ? Array.from(this._ev.keys()) : []; };

/* Helper para registrar listeners del DOM y poder quitarlos todos de una vez (evita fugas). */
function DOMListeners() { this._list = []; }
DOMListeners.prototype.add = function (target, type, fn, opts) {
  if (!target || !target.addEventListener) return;
  target.addEventListener(type, fn, opts);
  this._list.push([target, type, fn, opts]);
};
DOMListeners.prototype.removeAll = function () {
  for (var i = 0; i < this._list.length; i++) {
    var l = this._list[i];
    try { l[0].removeEventListener(l[1], l[2], l[3]); } catch (e) { /* ignorar */ }
  }
  this._list.length = 0;
};

/* ------------------------------------------------------------------ Color */
var NAMED_COLORS = {
  black: 0x000000, white: 0xffffff, red: 0xff0000, green: 0x008000, lime: 0x00ff00, blue: 0x0000ff, yellow: 0xffff00,
  cyan: 0x00ffff, aqua: 0x00ffff, magenta: 0xff00ff, fuchsia: 0xff00ff, gray: 0x808080, grey: 0x808080, silver: 0xc0c0c0,
  maroon: 0x800000, olive: 0x808000, purple: 0x800080, teal: 0x008080, navy: 0x000080, orange: 0xffa500, pink: 0xffc0cb,
  gold: 0xffd700, brown: 0xa52a2a, violet: 0xee82ee, indigo: 0x4b0082, coral: 0xff7f50, crimson: 0xdc143c, turquoise: 0x40e0d0,
  salmon: 0xfa8072, khaki: 0xf0e68c, orchid: 0xda70d6, skyblue: 0x87ceeb, transparent: 0x000000
};

var Color = {
  /** Convierte número, '#rgb', '#rrggbb', '#rrggbbaa', '0xRRGGBB', 'rgb()', 'rgba()', 'hsl()', nombre o {r,g,b} a 0xRRGGBB. */
  toNumber: function (v) {
    if (typeof v === 'number') return (v >>> 0) & 0xffffff;
    if (v === null || v === undefined) return 0xffffff;
    if (typeof v === 'object') {
      if (Array.isArray(v)) {
        var big = v[0] > 1 || v[1] > 1 || v[2] > 1;
        var m = big ? 1 : 255;
        return ((Math.round(v[0] * m) & 255) << 16) | ((Math.round(v[1] * m) & 255) << 8) | (Math.round(v[2] * m) & 255);
      }
      if ('r' in v) return ((v.r & 255) << 16) | ((v.g & 255) << 8) | (v.b & 255);
      return 0xffffff;
    }
    var s = String(v).trim().toLowerCase();
    if (s in NAMED_COLORS) return NAMED_COLORS[s];
    if (s[0] === '#') s = s.slice(1);
    else if (s.indexOf('0x') === 0) s = s.slice(2);
    else if (s.indexOf('rgb') === 0 || s.indexOf('hsl') === 0) {
      var nums = s.replace(/[^\d.,%\s-]/g, ' ').split(/[\s,]+/).filter(function (x) { return x.length; });
      var isHsl = s.indexOf('hsl') === 0;
      var p = function (x, max) { return x.indexOf('%') >= 0 ? parseFloat(x) / 100 * max : parseFloat(x); };
      if (isHsl) return Color.fromHSL((parseFloat(nums[0] || '0') % 360) / 360, parseFloat(nums[1] || '0') / 100, parseFloat(nums[2] || '0') / 100);
      return Color.fromRGB(p(nums[0] || '0', 255), p(nums[1] || '0', 255), p(nums[2] || '0', 255));
    }
    if (/^[0-9a-f]{3,4}$/.test(s)) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (/^[0-9a-f]{8}$/.test(s)) s = s.slice(0, 6);
    if (/^[0-9a-f]{6}$/.test(s)) return parseInt(s, 16);
    Log.warnOnce('color:' + s, 'Color no reconocido:', v);
    return 0xffffff;
  },
  /** Alfa contenido en un valor de color (strings rgba/#rrggbbaa); 1 si no lo tiene. */
  alphaOf: function (v) {
    if (typeof v !== 'string') return 1;
    var s = v.trim().toLowerCase();
    if (s === 'transparent') return 0;
    if (s[0] === '#' && (s.length === 9 || s.length === 5)) return parseInt(s.length === 9 ? s.slice(7, 9) : s[4] + s[4], 16) / 255;
    if (s.indexOf('rgba') === 0 || s.indexOf('hsla') === 0) {
      var nums = s.replace(/[^\d.,%\s]/g, ' ').split(/[\s,]+/).filter(function (x) { return x.length; });
      if (nums.length >= 4) { var a = nums[3]; return a.indexOf('%') >= 0 ? parseFloat(a) / 100 : parseFloat(a); }
    }
    return 1;
  },
  fromRGB: function (r, g, b) { return ((clampInt(r, 0, 255)) << 16) | ((clampInt(g, 0, 255)) << 8) | clampInt(b, 0, 255); },
  toRGB: function (n, out) { out = out || {}; out.r = (n >> 16) & 255; out.g = (n >> 8) & 255; out.b = n & 255; return out; },
  toHex: function (n) { return '#' + ('000000' + (n & 0xffffff).toString(16)).slice(-6); },
  toCSS: function (n, a) {
    if (a === undefined || a >= 1) return Color.toHex(n);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + Math.max(0, a).toFixed(3) + ')';
  },
  lerp: function (c1, c2, t) {
    var r1 = (c1 >> 16) & 255, g1 = (c1 >> 8) & 255, b1 = c1 & 255;
    var r2 = (c2 >> 16) & 255, g2 = (c2 >> 8) & 255, b2 = c2 & 255;
    return ((r1 + (r2 - r1) * t) << 16) | ((g1 + (g2 - g1) * t) << 8) | ((b1 + (b2 - b1) * t) | 0);
  },
  /** Interpola en una rampa de colores [c0, c1, c2...] con t en 0..1 */
  ramp: function (colors, t) {
    var n = colors.length; if (n === 0) return 0xffffff; if (n === 1 || t <= 0) return colors[0]; if (t >= 1) return colors[n - 1];
    var f = t * (n - 1); var i = f | 0; return Color.lerp(colors[i], colors[i + 1], f - i);
  },
  multiply: function (a, b) {
    return ((((a >> 16) & 255) * ((b >> 16) & 255) / 255) << 16) | ((((a >> 8) & 255) * ((b >> 8) & 255) / 255) << 8) | (((a & 255) * (b & 255) / 255) | 0);
  },
  fromHSV: function (h, s, v) {
    h = ((h % 1) + 1) % 1; var i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    var r, g, b;
    switch (i % 6) { case 0: r = v; g = t; b = p; break; case 1: r = q; g = v; b = p; break; case 2: r = p; g = v; b = t; break; case 3: r = p; g = q; b = v; break; case 4: r = t; g = p; b = v; break; default: r = v; g = p; b = q; }
    return Color.fromRGB(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
  },
  fromHSL: function (h, s, l) {
    h = ((h % 1) + 1) % 1;
    if (s === 0) { var c = Math.round(l * 255); return Color.fromRGB(c, c, c); }
    var hue2rgb = function (p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return Color.fromRGB(Math.round(hue2rgb(p, q, h + 1 / 3) * 255), Math.round(hue2rgb(p, q, h) * 255), Math.round(hue2rgb(p, q, h - 1 / 3) * 255));
  },
  toHSV: function (n) {
    var r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d !== 0) { if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; if (h < 0) h += 1; }
    return { h: h, s: max === 0 ? 0 : d / max, v: max };
  },
  brighten: function (n, amount) {
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amount >= 0) { r += (255 - r) * amount; g += (255 - g) * amount; b += (255 - b) * amount; }
    else { r *= 1 + amount; g *= 1 + amount; b *= 1 + amount; }
    return Color.fromRGB(Math.round(r), Math.round(g), Math.round(b));
  },
  /** Oscurece un color (0..1) */
  darken: function (n, amount) { return Color.brighten(n, -Math.abs(amount)); },
  random: function (rng, min, max) {
    var R = rng || UG.rng; min = min === undefined ? 0 : min; max = max === undefined ? 255 : max;
    return Color.fromRGB(R.int(min, max), R.int(min, max), R.int(min, max));
  }
};

/** Empaqueta color+alfa en un uint32 premultiplicado (orden de bytes RGBA en memoria). */
function packColor(rgb, alpha) {
  var a = alpha < 0 ? 0 : (alpha > 1 ? 1 : alpha);
  var r = (((rgb >> 16) & 255) * a + 0.5) | 0, g = (((rgb >> 8) & 255) * a + 0.5) | 0, b = ((rgb & 255) * a + 0.5) | 0, A = (a * 255 + 0.5) | 0;
  return IS_LITTLE_ENDIAN ? ((A << 24) | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | A) >>> 0;
}

function clampInt(v, lo, hi) { v = Math.round(+v || 0); return v < lo ? lo : (v > hi ? hi : v); }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* --------------------------------------------------------------- Seguridad */
var SAFE_DATA_URI = /^data:(image\/(png|jpeg|jpg|gif|webp|avif|bmp|svg\+xml)|audio\/[a-z0-9.+-]+|application\/(json|octet-stream|xml)|text\/(plain|xml|csv)|font\/[a-z0-9.+-]+)[;,]/i;
var BIDI_CONTROL = /[‪-‮⁦-⁩‎‏؜]/g;
var CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
/* Nota: un literal { '__proto__': 1 } NO crea la clave (cambia el prototipo), por eso se usa una función. */
function isForbiddenKey(k) { return k === '__proto__' || k === 'constructor' || k === 'prototype'; }

var Security = {
  /** null = cualquier origen http(s) (como el propio navegador) además de rutas relativas, data: seguros y blob:.
   *  Array = solo el propio origen y los listados, p.ej. ['https://cdn.mijuego.com'] (recomendado en producción / web3). */
  allowedOrigins: null,
  maxFileSize: 128 * 1024 * 1024,
  maxTextureSize: 8192,
  maxMapTiles: 16 * 1024 * 1024,
  maxTextLength: 100000,
  maxParticles: 500000,

  isSafeURL: function (url) {
    if (typeof url !== 'string' || url.length === 0) return false;
    var head = url.slice(0, 64).replace(/[\u0000- ]/g, '').toLowerCase();
    if (/^(javascript|vbscript):/.test(head)) return false;
    if (head.indexOf('data:') === 0) return SAFE_DATA_URI.test(url.slice(0, 80)) && url.length <= this.maxFileSize * 1.4;
    if (head.indexOf('blob:') === 0) return true;
    if (!HAS_DOM || typeof URL === 'undefined') return /^(https?:|\.{0,2}\/|[a-z0-9_\-])/i.test(head);
    var abs;
    try { abs = new URL(url, document.baseURI); } catch (e) { return false; }
    var proto = abs.protocol;
    if (proto === 'file:') return typeof location !== 'undefined' && location.protocol === 'file:';
    if (proto !== 'http:' && proto !== 'https:') return false;
    if (typeof location !== 'undefined' && abs.origin === location.origin) return true;
    if (this.allowedOrigins === null) return true;
    return this.allowedOrigins.indexOf(abs.origin) >= 0;
  },
  /** Limpia texto de usuario (nombres de jugador, chat, metadatos NFT): quita controles y overrides bidi usados para suplantación. */
  sanitizeText: function (str, maxLength) {
    var s = String(str === undefined || str === null ? '' : str);
    s = s.replace(CONTROL_CHARS, '').replace(BIDI_CONTROL, '');
    var max = maxLength || this.maxTextLength;
    if (s.length > max) s = s.slice(0, max);
    return s;
  },
  isForbiddenKey: isForbiddenKey,
  /** Mezcla profunda a prueba de "prototype pollution". */
  safeMerge: function (target, source, depth) {
    depth = depth === undefined ? 8 : depth;
    if (!source || typeof source !== 'object' || depth < 0) return target;
    var keys = Object.keys(source);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i]; if (isForbiddenKey(k)) continue;
      var v = source[k];
      if (isPlainObject(v) && isPlainObject(target[k])) Security.safeMerge(target[k], v, depth - 1);
      else if (isPlainObject(v)) target[k] = Security.safeMerge({}, v, depth - 1);
      else target[k] = v;
    }
    return target;
  },
  deepFreeze: function (obj) {
    if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
      Object.freeze(obj);
      Object.keys(obj).forEach(function (k) { Security.deepFreeze(obj[k]); });
    }
    return obj;
  },
  secureRandom: function () {
    var c = GLOBAL.crypto;
    if (c && c.getRandomValues) { var a = new Uint32Array(1); c.getRandomValues(a); return a[0] / 4294967296; }
    Log.warnOnce('nocrypto', 'crypto.getRandomValues no disponible; usando Math.random (no seguro)');
    return Math.random();
  },
  secureRandomInt: function (min, max) {
    var range = max - min + 1; if (range <= 0) return min;
    var c = GLOBAL.crypto;
    if (c && c.getRandomValues) {
      var lim = Math.floor(4294967296 / range) * range, a = new Uint32Array(1);
      do { c.getRandomValues(a); } while (a[0] >= lim);
      return min + (a[0] % range);
    }
    return min + Math.floor(Math.random() * range);
  },
  /** SHA-256 síncrono en JS puro (para hash de estado/replays y verificación de integridad sin contexto seguro). */
  sha256: function (data) {
    var bytes = toBytes(data);
    var K = SHA256_K, H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var l = bytes.length, bitLenHi = Math.floor(l / 0x20000000), bitLenLo = (l << 3) >>> 0;
    var withPad = ((l + 9 + 63) >> 6) << 6;
    var m = new Uint8Array(withPad); m.set(bytes); m[l] = 0x80;
    var dv = new DataView(m.buffer); dv.setUint32(withPad - 8, bitLenHi); dv.setUint32(withPad - 4, bitLenLo);
    var w = new Uint32Array(64);
    for (var off = 0; off < withPad; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (i = 16; i < 64; i++) {
        var x = w[i - 15], y = w[i - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var hex = '';
    for (i = 0; i < 8; i++) hex += ('00000000' + H[i].toString(16)).slice(-8);
    return hex;
  },
  /** Verifica integridad estilo SRI ('sha256-BASE64') o hex ('sha256:abcd...' o solo hex). */
  verifyIntegrity: function (data, integrity) {
    if (!integrity) return true;
    var hex = Security.sha256(data);
    var s = String(integrity).trim();
    if (s.indexOf('sha256-') === 0) return hexToBase64(hex) === s.slice(7);
    if (s.indexOf('sha256:') === 0) s = s.slice(7);
    return s.toLowerCase() === hex;
  }
};
var SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  var s = String(data);
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  var out = []; var u = unescape(encodeURIComponent(s));
  for (var i = 0; i < u.length; i++) out.push(u.charCodeAt(i));
  return new Uint8Array(out);
}
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function bytesToBase64(bytes) {
  var out = '', i;
  for (i = 0; i + 2 < bytes.length; i += 3) {
    var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  var rem = bytes.length - i;
  if (rem === 1) { var n1 = bytes[i] << 16; out += B64[(n1 >> 18) & 63] + B64[(n1 >> 12) & 63] + '=='; }
  else if (rem === 2) { var n2 = (bytes[i] << 16) | (bytes[i + 1] << 8); out += B64[(n2 >> 18) & 63] + B64[(n2 >> 12) & 63] + B64[(n2 >> 6) & 63] + '='; }
  return out;
}
function base64ToBytes(str) {
  var s = String(str).replace(/[^A-Za-z0-9+/]/g, '');
  var len = (s.length * 3) >> 2, out = new Uint8Array(len), j = 0, buf = 0, bits = 0;
  for (var i = 0; i < s.length; i++) {
    buf = (buf << 6) | B64.indexOf(s[i]); bits += 6;
    if (bits >= 8) { bits -= 8; if (j < len) out[j++] = (buf >> bits) & 255; }
  }
  return j === len ? out : out.subarray(0, j);
}
function hexToBase64(hex) {
  var b = new Uint8Array(hex.length / 2);
  for (var i = 0; i < b.length; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytesToBase64(b);
}

/* ---------------------------------------------------------------- Utils */
function isPlainObject(o) {
  if (o === null || typeof o !== 'object') return false;
  var p = Object.getPrototypeOf(o);
  return p === Object.prototype || p === null;
}
/** Lee config con valor por defecto; soporta rutas "a.b.c". */
function getValue(obj, key, def) {
  if (!obj) return def;
  if (key.indexOf('.') < 0) return (obj[key] !== undefined) ? obj[key] : def;
  var parts = key.split('.'), cur = obj;
  for (var i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || isForbiddenKey(parts[i])) return def;
    cur = cur[parts[i]];
  }
  return cur === undefined ? def : cur;
}
function removeFromArray(arr, item) { var i = arr.indexOf(item); if (i >= 0) arr.splice(i, 1); return i >= 0; }
function createCanvas(w, h) {
  var c;
  if (HAS_DOM) { c = document.createElement('canvas'); }
  else if (typeof OffscreenCanvas !== 'undefined') { c = new OffscreenCanvas(w || 1, h || 1); }
  else throw new Error('UltraGame: no hay canvas disponible en este entorno');
  c.width = w || 1; c.height = h || 1;
  return c;
}
/** Libera la memoria de un canvas (importante en Safari/iOS, que limita la memoria total de canvas). */
function releaseCanvas(c) { if (c) { try { c.width = 0; c.height = 0; } catch (e) { /* ignorar */ } } }

/* --------------------------------------------------------------- Pool
 * Pool genérico de objetos reutilizables para evitar presión en el GC. */
function Pool(create, reset, max) {
  this._create = create; this._reset = reset || null; this._max = max || 4096; this._items = [];
}
Pool.prototype.get = function () { var o = this._items.length ? this._items.pop() : this._create(); return o; };
Pool.prototype.release = function (o) { if (this._reset) this._reset(o); if (this._items.length < this._max) this._items.push(o); };
Pool.prototype.clear = function () { this._items.length = 0; };
Object.defineProperty(Pool.prototype, 'size', { get: function () { return this._items.length; } });

/** Valor aleatorio desde: número | {min,max} | [opciones] | función */
function resolveRandom(spec, rng, def) {
  if (spec === undefined || spec === null) return def;
  if (typeof spec === 'number') return spec;
  if (typeof spec === 'function') return spec();
  if (Array.isArray(spec)) return spec.length ? spec[(rng.next() % spec.length)] : def;
  if (typeof spec === 'object') {
    if ('min' in spec || 'max' in spec) {
      var lo = spec.min !== undefined ? spec.min : 0, hi = spec.max !== undefined ? spec.max : lo;
      return spec.int ? rng.int(lo, hi) : lo + (hi - lo) * rng.float();
    }
    if ('start' in spec) return spec.start;
  }
  return def;
}

UG.Log = Log;
UG.Debug = Debug;
UG.EventEmitter = EventEmitter;
UG.Color = Color;
UG.Security = Security;
UG.Pool = Pool;
UG.Utils = {
  uid: uid, clamp: clamp, isPlainObject: isPlainObject, getValue: getValue, removeFromArray: removeFromArray,
  createCanvas: createCanvas, releaseCanvas: releaseCanvas, packColor: packColor, now: nowTime,
  bytesToBase64: bytesToBase64, base64ToBytes: base64ToBytes, toBytes: toBytes, DOMListeners: DOMListeners
};
