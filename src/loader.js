/* UltraGame - cargador de recursos: imágenes, SVG, spritesheets, atlas, JSON, texto, XML, binarios, audio,
 * mapas Tiled (TMJ/TMX con tilesets externos e imágenes automáticas), fuentes bitmap y web fonts.
 * Seguridad: validación de URLs, límite de tamaño, timeouts, cancelación y verificación de integridad (SRI). */

class CacheManager {
  constructor() {
    this.json = new Map(); this.text = new Map(); this.xml = new Map(); this.binary = new Map();
    this.tilemap = new Map(); this.bitmapFont = new Map(); this.audio = new Map(); this.custom = new Map();
    /** Modelos 3D (glTF/GLB/OBJ): Model3D con recursos de GPU, se destruyen al cerrar el juego */
    this.models = new Map();
  }
  destroy() { this.models.forEach(function (m) { if (m && m.destroy) m.destroy(); }); for (var k in this) if (this[k] instanceof Map) this[k].clear(); }
}

var AUDIO_MIME = { mp3: 'audio/mpeg', ogg: 'audio/ogg; codecs="vorbis"', oga: 'audio/ogg', opus: 'audio/ogg; codecs="opus"', wav: 'audio/wav', m4a: 'audio/mp4; codecs="mp4a.40.2"', aac: 'audio/aac', mp4: 'audio/mp4', webm: 'audio/webm', flac: 'audio/flac' };

function extOf(url) { var m = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(String(url)); return m ? m[1].toLowerCase() : ''; }
function dirOf(url) { var s = String(url).split(/[?#]/)[0]; var i = s.lastIndexOf('/'); return i >= 0 ? s.slice(0, i + 1) : ''; }
function joinURL(base, rel) {
  if (!rel) return base;
  if (/^[a-z][a-z0-9+.-]*:/i.test(rel) || rel[0] === '/') return rel;
  var parts = (base + rel).split('/'), out = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (p === '..') { if (out.length && out[out.length - 1] !== '..' && out[out.length - 1] !== '') out.pop(); else out.push(p); }
    else if (p !== '.') out.push(p);
  }
  return out.join('/');
}
function decodeText(buf) {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(buf);
  var s = '', b = new Uint8Array(buf); for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
}
function parseXML(text) {
  if (typeof DOMParser === 'undefined') throw new Error('DOMParser no disponible');
  var doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML inválido');
  return doc;
}

class Loader extends EventEmitter {
  constructor(owner) {
    super();
    this.scene = owner && owner.sys ? owner : null;
    this.game = this.scene ? this.scene.game : owner;
    this.queue = [];
    this.loading = false;
    this.path = ''; this.baseURL = '';
    this.urlResolver = null;
    this.maxParallel = 6;
    this.timeout = 60000;
    this.crossOrigin = 'anonymous';
    this.withCredentials = false;
    this.totalToLoad = 0; this.totalComplete = 0; this.totalFailed = 0;
    this.progress = 0;
    this.failed = [];
    this._active = 0;
    this._controllers = new Set();
    this._timers = new Set();
    this._resolve = null;
    this._aborted = false;
    this.showProgress = true;
  }
  get textures() { return this.game.textures; }
  get cache() { return this.game.cache; }
  setPath(p) { this.path = p ? (p.charAt(p.length - 1) === '/' ? p : p + '/') : ''; return this; }
  setBaseURL(u) { this.baseURL = u ? (u.charAt(u.length - 1) === '/' ? u : u + '/') : ''; return this; }
  /** Resuelve archivos virtuales sin perder la carpeta original de sus dependencias. */
  setURLResolver(fn) { this.urlResolver = typeof fn === 'function' ? fn : null; return this; }
  resolveURL(url) { return this.urlResolver && typeof url === 'string' ? this.urlResolver(url) : url; }
  setCORS(v) { this.crossOrigin = v; return this; }
  _url(u) {
    if (!u || typeof u !== 'string') return u;
    if (/^(data:|blob:|[a-z][a-z0-9+.-]*:\/\/|\/)/i.test(u)) return u;
    return this.baseURL + this.path + u;
  }
  _add(file) {
    if (Array.isArray(file.key)) { var self = this; file.key.forEach(function (f) { self[file.type](f.key, f.url, f); }); return this; }
    if (!file.key || typeof file.key !== 'string') throw new Error('UltraGame Loader: clave inválida');
    if (!file.overwrite && this._exists(file)) return this;
    for (var i = 0; i < this.queue.length; i++) if (this.queue[i].key === file.key && this.queue[i].type === file.type) return this;
    file.state = 'pending';
    this.queue.push(file);
    this.totalToLoad++;
    if (this.loading) this._next();
    return this;
  }
  _exists(f) {
    var g = this.game;
    switch (f.type) {
      case 'image': case 'svg': case 'spritesheet': case 'atlas': case 'bitmapFont': return g.textures.exists(f.key) && (f.type !== 'bitmapFont' || !!BitmapFont.get(f.key));
      case 'audio': return g.sound.exists(f.key);
      case 'json': return g.cache.json.has(f.key);
      case 'text': return g.cache.text.has(f.key);
      case 'xml': return g.cache.xml.has(f.key);
      case 'binary': return g.cache.binary.has(f.key);
      case 'tilemap': return g.cache.tilemap.has(f.key);
      case 'gltf': case 'obj': return g.cache.models.has(f.key);
    }
    return false;
  }
  _cfg(key, url, extra, type) {
    if (typeof key === 'object' && !Array.isArray(key)) { var o = key; return Object.assign({ type: type }, o); }
    return Object.assign({ type: type, key: key, url: url }, extra || {});
  }
  /* ------------- tipos ------------- */
  image(key, url, opts) { return this._add(this._cfg(key, url || (typeof key === 'string' ? key + '.png' : undefined), opts, 'image')); }
  svg(key, url, opts) { return this._add(this._cfg(key, url, opts, 'svg')); }
  spritesheet(key, url, frameConfig) { var c = this._cfg(key, url, {}, 'spritesheet'); c.frameConfig = c.frameConfig || frameConfig; return this._add(c); }
  atlas(key, textureURL, atlasURL, opts) { var c = this._cfg(key, textureURL, opts, 'atlas'); if (atlasURL !== undefined) c.atlasURL = atlasURL; return this._add(c); }
  json(key, url, opts) { return this._add(this._cfg(key, url, opts, 'json')); }
  text(key, url, opts) { return this._add(this._cfg(key, url, opts, 'text')); }
  xml(key, url, opts) { return this._add(this._cfg(key, url, opts, 'xml')); }
  binary(key, url, opts) { return this._add(this._cfg(key, url, opts, 'binary')); }
  audio(key, urls, opts) { return this._add(this._cfg(key, urls, opts, 'audio')); }
  audioSprite(key, jsonURL, audioURLs, opts) { var c = this._cfg(key, audioURLs, opts, 'audio'); c.spriteJSON = jsonURL; return this._add(c); }
  /** Modelo 3D glTF 2.0 (.gltf con .bin/texturas o .glb binario), p.ej. exportado desde Blender */
  gltf(key, url, opts) { return this._add(this._cfg(key, url, opts, 'gltf')); }
  glb(key, url, opts) { return this.gltf(key, url, opts); }
  /** Modelo OBJ (+ MTL opcional: si no se indica se busca el mtllib del propio OBJ) */
  obj(key, url, mtlURL, opts) { var c = this._cfg(key, url, opts, 'obj'); if (mtlURL !== undefined && typeof mtlURL === 'string') c.mtlURL = mtlURL; return this._add(c); }
  /** Detecta el formato por la extensión (.glb, .gltf, .obj) */
  model(key, url, opts) { return /\.obj(\?|#|$)/i.test(String(url)) ? this.obj(key, url, undefined, opts) : this.gltf(key, url, opts); }
  tilemapTiledJSON(key, url, opts) { return this._add(this._cfg(key, url, Object.assign({ format: 'json' }, opts), 'tilemap')); }
  tilemapTMX(key, url, opts) { return this._add(this._cfg(key, url, Object.assign({ format: 'tmx' }, opts), 'tilemap')); }
  tilemap(key, url, opts) { return this._add(this._cfg(key, url, Object.assign({ format: /\.tmx(\?|$)/i.test(String(url)) ? 'tmx' : 'json' }, opts), 'tilemap')); }
  bitmapFont(key, textureURL, fontDataURL, opts) { var c = this._cfg(key, textureURL, opts, 'bitmapFont'); if (fontDataURL) c.fontDataURL = fontDataURL; return this._add(c); }
  font(family, url, descriptors) { return this._add({ type: 'font', key: family, url: url, descriptors: descriptors || {} }); }
  /** Genera un efecto de sonido procedural (sin archivo) */
  sfx(key, spec) { return this._add({ type: 'sfx', key: key, spec: spec || key }); }
  /** Renderiza una canción del secuenciador (sin archivo) */
  music(key, def) { return this._add({ type: 'music', key: key, def: def }); }
  /** Genera una textura con canvas: load.generate('key', w, h, (ctx) => {}) */
  generate(key, w, h, draw, opts) { return this._add({ type: 'generate', key: key, w: w, h: h, draw: draw, opts: opts }); }

  /* ------------- ejecución ------------- */
  get isLoading() { return this.loading; }
  get pending() { return this.queue.length + this._active; }
  start() {
    var self = this;
    if (this.loading) return this._promise;
    this._aborted = false;
    this.loading = true;
    this.emit('start', this);
    this._promise = new Promise(function (resolve) { self._resolve = resolve; });
    if (!this.queue.length) { this._finish(); return this._promise; }
    this._next();
    return this._promise;
  }
  _next() {
    while (this._active < this.maxParallel && this.queue.length && !this._aborted) {
      var f = this.queue.shift();
      this._active++;
      f.state = 'loading';
      this._run(f);
    }
    if (this._active === 0 && !this.queue.length && this.loading) this._finish();
  }
  _run(f) {
    var self = this;
    var p;
    try { p = Promise.resolve(this._load(f)); } catch (e) { p = Promise.reject(e); }
    p.then(function (data) {
      if (self._aborted) return;
      f.state = 'done';
      self.totalComplete++;
      self.emit('filecomplete', f.key, f.type, data);
      self.emit('filecomplete-' + f.type + '-' + f.key, f.key, f.type, data);
    }, function (err) {
      if (self._aborted) return;
      f.state = 'error'; f.error = err;
      self.totalFailed++; self.failed.push(f);
      Log.warn('Error cargando ' + f.type + ' "' + f.key + '":', err && err.message ? err.message : err);
      self.emit('loaderror', f, err);
    }).then(function () {
      if (self._aborted) return;
      self._active--;
      var done = self.totalComplete + self.totalFailed;
      self.progress = self.totalToLoad ? done / self.totalToLoad : 1;
      self.emit('progress', self.progress);
      self._next();
    });
  }
  _finish() {
    this.loading = false;
    this.progress = 1;
    this.emit('complete', this, this.totalComplete, this.totalFailed);
    var r = this._resolve; this._resolve = null;
    this.totalToLoad = 0; this.totalComplete = 0; this.totalFailed = 0;
    if (r) r(this);
  }
  /** Cancela todas las cargas en curso. */
  abort() {
    this._aborted = true;
    this.queue.length = 0;
    this._controllers.forEach(function (c) { try { c.abort(); } catch (e) { /* ignorar */ } });
    this._controllers.clear();
    this._timers.forEach(function (t) { clearTimeout(t); });
    this._timers.clear();
    this._active = 0;
    var r = this._resolve; this._resolve = null;
    this.loading = false;
    this.totalToLoad = 0; this.totalComplete = 0; this.totalFailed = 0;
    if (r) r(this);
  }
  reset() { this.abort(); this.failed = []; this._aborted = false; return this; }
  destroy() { this.abort(); this.off(); this.urlResolver = null; this.game = null; this.scene = null; }

  /* ------------- red ------------- */
  fetchBytes(url, file) {
    var self = this;
    url = this.resolveURL(url);
    if (!Security.isSafeURL(url)) return Promise.reject(new Error('URL bloqueada por la política de seguridad: ' + String(url).slice(0, 80)));
    var integrity = file && file.integrity;
    var check = function (buf) {
      if (buf.byteLength > Security.maxFileSize) throw new Error('Archivo demasiado grande (' + buf.byteLength + ' bytes)');
      if (integrity && !Security.verifyIntegrity(new Uint8Array(buf), integrity)) throw new Error('Falló la verificación de integridad (hash distinto) de ' + url);
      return buf;
    };
    if (/^data:/i.test(url)) {
      var comma = url.indexOf(',');
      var meta = url.slice(5, comma), body = url.slice(comma + 1);
      var bytes = /;base64/i.test(meta) ? base64ToBytes(body) : toBytes(decodeURIComponent(body));
      return Promise.resolve(check(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    }
    var viaXHR = function () {
      return new Promise(function (resolve, reject) {
        if (typeof XMLHttpRequest === 'undefined') { reject(new Error('Sin fetch ni XHR')); return; }
        var x = new XMLHttpRequest();
        x.open('GET', url, true); x.responseType = 'arraybuffer'; x.timeout = self.timeout; x.withCredentials = self.withCredentials;
        x.onload = function () { if ((x.status >= 200 && x.status < 300) || (x.status === 0 && x.response)) { try { resolve(check(x.response)); } catch (e) { reject(e); } } else reject(new Error('HTTP ' + x.status + ' ' + url)); };
        x.onerror = function () { reject(new Error('Error de red cargando ' + url + (typeof location !== 'undefined' && location.protocol === 'file:' ? ' (en file:// usa un servidor local, p.ej. node tools/server.js)' : ''))); };
        x.ontimeout = function () { reject(new Error('Timeout cargando ' + url)); };
        x.send();
      });
    };
    if (typeof fetch !== 'function') return viaXHR();
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (ctrl) this._controllers.add(ctrl);
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, this.timeout);
    this._timers.add(timer);
    var cleanup = function () { clearTimeout(timer); self._timers.delete(timer); if (ctrl) self._controllers.delete(ctrl); };
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined, credentials: this.withCredentials ? 'include' : 'same-origin' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
      var len = +(res.headers.get('content-length') || 0);
      if (len > Security.maxFileSize) throw new Error('Archivo demasiado grande: ' + url);
      return res.arrayBuffer();
    }).then(function (buf) { cleanup(); return check(buf); }, function (err) {
      cleanup();
      if (err && err.name === 'TypeError' && typeof location !== 'undefined' && location.protocol === 'file:') return viaXHR();
      throw err;
    });
  }
  fetchText(url, file) { return this.fetchBytes(url, file).then(decodeText); }
  fetchJSON(url, file) { return this.fetchText(url, file).then(function (t) { return JSON.parse(t); }); }
  loadImageElement(url, file) {
    var self = this;
    url = this.resolveURL(url);
    if (!Security.isSafeURL(url)) return Promise.reject(new Error('URL de imagen bloqueada: ' + String(url).slice(0, 80)));
    if (typeof Image === 'undefined') {
      if (typeof createImageBitmap === 'function') return this.fetchBytes(url, file).then(function (b) { return createImageBitmap(new Blob([b])); });
      return Promise.reject(new Error('Sin soporte de imágenes'));
    }
    if (file && file.integrity) {
      return this.fetchBytes(url, file).then(function (buf) {
        var blobUrl = URL.createObjectURL(new Blob([buf]));
        return self._imgFromURL(blobUrl).then(function (img) { URL.revokeObjectURL(blobUrl); return img; }, function (e) { URL.revokeObjectURL(blobUrl); throw e; });
      });
    }
    return this._imgFromURL(url);
  }
  _imgFromURL(url) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var cross = !/^(data:|blob:)/i.test(url) && typeof location !== 'undefined' && (function () { try { return new URL(url, document.baseURI).origin !== location.origin; } catch (e) { return false; } })();
      if (cross && self.crossOrigin) img.crossOrigin = self.crossOrigin;
      var timer = setTimeout(function () { done(); reject(new Error('Timeout cargando imagen ' + url)); }, self.timeout);
      self._timers.add(timer);
      var done = function () { clearTimeout(timer); self._timers.delete(timer); img.onload = null; img.onerror = null; };
      img.onload = function () { done(); resolve(img); };
      img.onerror = function () { done(); reject(new Error('No se pudo cargar la imagen ' + String(url).slice(0, 120))); };
      img.decoding = 'async';
      img.src = url;
    });
  }
  _pickAudioURL(urls) {
    var list = Array.isArray(urls) ? urls : [urls];
    if (typeof Audio === 'undefined') return list[0];
    var a = new Audio();
    for (var i = 0; i < list.length; i++) {
      var u = typeof list[i] === 'object' ? list[i].url : list[i];
      if (/^data:audio\//i.test(u)) { var mt = /^data:(audio\/[^;,]+)/i.exec(u); if (!mt || a.canPlayType(mt[1])) return u; continue; }
      var mime = AUDIO_MIME[extOf(u)];
      if (!mime || a.canPlayType(mime) !== '') return u;
    }
    return null;
  }

  /* ------------- procesadores ------------- */
  _load(f) {
    var self = this, g = this.game, url = typeof f.url === 'string' ? this._url(f.url) : f.url;
    switch (f.type) {
      case 'image':
        return this.loadImageElement(url, f).then(function (img) {
          var opts = { scaleMode: f.scaleMode || (g.config.pixelArt ? 'nearest' : undefined), mipmap: f.mipmap };
          if (f.frameConfig) return g.textures.addSpriteSheet(f.key, img, Object.assign(opts, f.frameConfig));
          return g.textures.addImage(f.key, img, opts);
        });
      case 'svg':
        return this.loadImageElement(url, f).then(function (img) {
          var w = f.width || img.naturalWidth || img.width || 128, h = f.height || img.naturalHeight || img.height || 128, sc = f.scale || 1;
          var c = createCanvas(Math.ceil(w * sc), Math.ceil(h * sc));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          return g.textures.addCanvas(f.key, c, { resolution: sc });
        });
      case 'spritesheet':
        return this.loadImageElement(url, f).then(function (img) {
          return g.textures.addSpriteSheet(f.key, img, Object.assign({ scaleMode: g.config.pixelArt ? 'nearest' : undefined }, f.frameConfig || {}));
        });
      case 'atlas': {
        var atlasP = typeof f.atlasURL === 'object' && f.atlasURL !== null ? Promise.resolve(f.atlasURL) : this.fetchJSON(this._url(f.atlasURL || String(f.url).replace(/\.(png|jpe?g|webp)$/i, '.json')), f);
        return atlasP.then(function (json) {
          var images;
          if (Array.isArray(json.textures)) {
            var base = dirOf(self._url(f.atlasURL || ''));
            images = Promise.all(json.textures.map(function (t) { return self.loadImageElement(joinURL(base, t.image)); }));
          } else images = self.loadImageElement(url, f).then(function (i) { return [i]; });
          return images.then(function (imgs) { return g.textures.addAtlas(f.key, imgs, json, { scaleMode: g.config.pixelArt ? 'nearest' : undefined }); });
        });
      }
      case 'json':
        if (f.data !== undefined) { g.cache.json.set(f.key, f.data); return Promise.resolve(f.data); }
        return this.fetchJSON(url, f).then(function (d) { g.cache.json.set(f.key, d); return d; });
      case 'text': return this.fetchText(url, f).then(function (d) { g.cache.text.set(f.key, d); return d; });
      case 'xml': return this.fetchText(url, f).then(function (t) { var d = parseXML(t); g.cache.xml.set(f.key, d); return d; });
      case 'binary': return this.fetchBytes(url, f).then(function (d) { g.cache.binary.set(f.key, d); return d; });
      case 'audio': {
        var picked = this._pickAudioURL(f.url);
        if (!picked) return Promise.reject(new Error('Ningún formato de audio compatible para ' + f.key));
        var aurl = this._url(picked);
        var jsonP = f.spriteJSON ? (typeof f.spriteJSON === 'object' ? Promise.resolve(f.spriteJSON) : this.fetchJSON(this._url(f.spriteJSON), f)) : Promise.resolve(null);
        return jsonP.then(function (sj) {
          if (sj) g.cache.audio.set(f.key, sj);
          if (g.sound.disabled) return null;
          g.sound._ensureContext();
          if (g.sound.useHTML5 || !g.sound.ctx) {
            var resolvedAudio = self.resolveURL(aurl);
            if (!Security.isSafeURL(resolvedAudio)) throw new Error('URL de audio bloqueada');
            g.sound.addHTML5(f.key, resolvedAudio); return resolvedAudio;
          }
          return self.fetchBytes(aurl, f).then(function (buf) { return g.sound.decodeAudio(f.key, buf); });
        });
      }
      case 'sfx': g.sound.makeSfx(f.spec, f.key); return Promise.resolve(f.key);
      case 'music': g.sound.addMusic(f.key, f.def); return Promise.resolve(f.key);
      case 'generate': return Promise.resolve(g.textures.generate(f.key, f.w, f.h, f.draw, f.opts));
      case 'font': {
        if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return Promise.resolve(null);
        url = this.resolveURL(url);
        if (!Security.isSafeURL(url)) return Promise.reject(new Error('URL de fuente bloqueada'));
        var face = new FontFace(f.key, 'url("' + String(url).replace(/["\\\n\r]/g, '') + '")', f.descriptors);
        return face.load().then(function (loaded) { document.fonts.add(loaded); return loaded; });
      }
      case 'bitmapFont': {
        var imgP = this.loadImageElement(url, f);
        var dataP = this.fetchText(this._url(f.fontDataURL || String(f.url).replace(/\.(png|jpe?g|webp)$/i, '.fnt')), f);
        return Promise.all([imgP, dataP]).then(function (res) {
          var tex = g.textures.addImage(f.key, res[0], {});
          return BitmapFont.parse(f.key, res[1], tex);
        });
      }
      case 'tilemap': return this._loadTilemap(f, url);
      case 'gltf': {
        var gl = typeof f.url === 'object' && f.url !== null && !(f.url instanceof ArrayBuffer) ? Promise.resolve(f.url) : (f.url instanceof ArrayBuffer ? Promise.resolve(f.url) : this.fetchBytes(url, f));
        return gl.then(function (data) { return GLTF.parse(data, { baseURL: typeof url === 'string' ? dirOf(url) : (f.baseURL || ''), loader: self, name: f.key, lightScale: f.lightScale }); }).then(function (model) { var old = g.cache.models.get(f.key); if (old && old !== model) old.destroy(); g.cache.models.set(f.key, model); return model; });
      }
      case 'obj': {
        var op = typeof f.url === 'string' ? this.fetchText(url, f) : Promise.resolve(String(f.url));
        return op.then(function (text) { return OBJ.parse(text, { baseURL: typeof url === 'string' ? dirOf(url) : (f.baseURL || ''), loader: self, name: f.key, mtlURL: f.mtlURL ? self._url(f.mtlURL) : null }); }).then(function (model) { var old = g.cache.models.get(f.key); if (old && old !== model) old.destroy(); g.cache.models.set(f.key, model); return model; });
      }
    }
    return Promise.reject(new Error('Tipo de archivo desconocido: ' + f.type));
  }
  _loadTilemap(f, url) {
    var self = this, g = this.game;
    var rawP;
    if (f.data !== undefined) rawP = Promise.resolve(f.data);
    else if (typeof f.url === 'object' && f.url !== null) rawP = Promise.resolve(f.url);
    else if (f.format === 'tmx') rawP = this.fetchText(url, f).then(function (t) { return TiledParser.fromTMX(parseXML(t)); });
    else rawP = this.fetchJSON(url, f);
    var base = typeof f.url === 'string' ? dirOf(url) : (f.baseURL || '');
    return rawP.then(function (raw) {
      var ext = (raw.tilesets || []).filter(function (ts) { return ts && ts.source; });
      return Promise.all(ext.map(function (ts) {
        var tsURL = joinURL(base, ts.source);
        var isXML = /\.tsx(\?|$)/i.test(ts.source);
        var p = isXML ? self.fetchText(tsURL).then(function (t) { return TiledParser.tilesetFromTSX(parseXML(t).documentElement); }) : self.fetchJSON(tsURL);
        return p.then(function (data) { var fg = ts.firstgid; Object.keys(ts).forEach(function (k) { delete ts[k]; }); Object.assign(ts, data, { firstgid: fg, _baseURL: dirOf(tsURL) }); });
      })).then(function () { return raw; });
    }).then(function (raw) {
      var map = TiledParser.normalize(raw);
      map.baseURL = base;
      var loads = [];
      if (f.autoLoadImages !== false && typeof Image !== 'undefined') {
        map.tilesets.forEach(function (ts) {
          var b = ts._baseURL || base;
          if (ts.image && !g.textures.exists(ts.name) && !g.textures.exists(ts.imageKey)) {
            loads.push(self.loadImageElement(joinURL(b, ts.image)).then(function (img) { g.textures.addImage(ts.imageKey, img, { scaleMode: g.config.pixelArt ? 'nearest' : undefined }); }, function (e) { Log.warn('Tileset sin imagen (' + ts.image + '):', e.message); }));
          }
          ts.tiles.forEach(function (tile) {
            if (tile.image && !g.textures.exists(tile.imageKey)) loads.push(self.loadImageElement(joinURL(b, tile.image)).then(function (img) { g.textures.addImage(tile.imageKey, img, {}); }, function () { /* ignorar */ }));
          });
        });
        map.layers.forEach(function (l) {
          if (l.type === 'imagelayer' && l.image && !g.textures.exists(l.imageKey)) loads.push(self.loadImageElement(joinURL(base, l.image)).then(function (img) { g.textures.addImage(l.imageKey, img, {}); }, function () { /* ignorar */ }));
        });
      }
      return Promise.all(loads).then(function () { g.cache.tilemap.set(f.key, map); return map; });
    });
  }
}

UG.Loader = Loader;
UG.CacheManager = CacheManager;
UG.LoaderUtils = { joinURL: joinURL, dirOf: dirOf, extOf: extOf, parseXML: parseXML, decodeText: decodeText };
