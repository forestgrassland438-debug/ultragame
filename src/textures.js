/* UltraGame - texturas: TextureSource (imagen en GPU), Texture (región), RenderTexture y TextureManager. */

var RendererRegistry = new Map();

/** Recurso de imagen subible a GPU: HTMLImageElement, Canvas, ImageBitmap, OffscreenCanvas, Video,
 *  datos crudos {data: Uint8Array RGBA, width, height} o null (render target). */
class TextureSource {
  constructor(resource, options) {
    options = options || {};
    this.uid = uid();
    this.resource = resource || null;
    var r = resource || {};
    this.width = Math.max(1, Math.floor(options.width || r.naturalWidth || r.videoWidth || r.displayWidth || r.width || 1));
    this.height = Math.max(1, Math.floor(options.height || r.naturalHeight || r.videoHeight || r.displayHeight || r.height || 1));
    this.resolution = options.resolution || 1;
    this.scaleMode = options.scaleMode || TextureSource.defaultScaleMode;
    this.wrapMode = options.wrapMode || 'clamp';
    this.mipmap = !!options.mipmap;
    /** true si los datos crudos ya vienen premultiplicados. Las fuentes DOM se premultiplican al subir. */
    this.premultiplied = options.premultiplied !== undefined ? !!options.premultiplied : false;
    this.isRenderTarget = !!options.renderTarget;
    /** true para canvas pequeños que cambian a menudo (textos): WebGPU los sube leyendo en CPU */
    this.dynamic = !!options.dynamic;
    this.label = options.label || '';
    this.version = 1;
    this.destroyed = false;
    this._gpu = Object.create(null);
    this._bTick = 0; this._bSlot = 0;
    this._canvasCache = null;
    Debug.track('TextureSource', 1);
  }
  get isPowerOfTwo() { return MathUtils.isPowerOfTwo(this.width) && MathUtils.isPowerOfTwo(this.height); }
  get isVideo() { return typeof HTMLVideoElement !== 'undefined' && this.resource instanceof HTMLVideoElement; }
  /** Marca el contenido como cambiado para re-subirlo a la GPU (p.ej. tras dibujar en un canvas). */
  update() { this.version++; this._canvasCache = null; return this; }
  resize(w, h) {
    w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
    if (w === this.width && h === this.height) return this;
    this.width = w; this.height = h; this.version++; return this;
  }
  setScaleMode(mode) { if (mode !== this.scaleMode) { this.scaleMode = mode; this.version++; } return this; }
  setWrapMode(mode) { if (mode !== this.wrapMode) { this.wrapMode = mode; this.version++; } return this; }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    var gpu = this._gpu;
    for (var rid in gpu) {
      var r = RendererRegistry.get(+rid);
      if (r) r.freeSource(this);
    }
    this._gpu = Object.create(null);
    if (this._canvasCache) { releaseCanvas(this._canvasCache); this._canvasCache = null; }
    this.resource = null;
    Debug.track('TextureSource', -1);
  }
}
TextureSource.defaultScaleMode = 'linear';

/** Región rectangular de un TextureSource (frame de atlas, spritesheet, etc.). */
class Texture {
  constructor(source, frame, orig, trim, rotate, anchor) {
    this.uid = uid();
    this.source = source;
    this.frame = frame || new Rectangle(0, 0, source.width, source.height);
    this.orig = orig || new Rectangle(0, 0, this.frame.width, this.frame.height);
    this.trim = trim || null;
    this.rotate = rotate || 0;
    this.defaultAnchor = anchor || null;
    this.uvs = new Float32Array(8);
    this.key = ''; this.frameName = '';
    this.customData = null;
    this.destroyed = false;
    this.updateUvs();
  }
  /** Tamaño lógico (en unidades del juego) */
  get width() { return this.orig.width / this.source.resolution; }
  get height() { return this.orig.height / this.source.resolution; }
  get realWidth() { return this.frame.width / this.source.resolution; }
  get realHeight() { return this.frame.height / this.source.resolution; }
  get isFullSource() { var f = this.frame; return !this.rotate && f.x === 0 && f.y === 0 && f.width === this.source.width && f.height === this.source.height; }
  updateUvs() {
    var tw = this.source.width, th = this.source.height, f = this.frame, u = this.uvs;
    var x0 = f.x / tw, y0 = f.y / th, x1 = (f.x + f.width) / tw, y1 = (f.y + f.height) / th;
    if (this.rotate) {
      // Frame rotado 90° en horario dentro del atlas (TexturePacker "rotated": true)
      u[0] = x1; u[1] = y0; u[2] = x1; u[3] = y1; u[4] = x0; u[5] = y1; u[6] = x0; u[7] = y0;
    } else {
      u[0] = x0; u[1] = y0; u[2] = x1; u[3] = y0; u[4] = x1; u[5] = y1; u[6] = x0; u[7] = y1;
    }
    // UV empaquetadas unorm16 para el lote instanciado (se calculan una vez, no por sprite y frame)
    var cl = function (v) { return v < 0 ? 0 : (v > 1 ? 1 : v); };
    this._uvA = ((((cl(u[1]) * 65535 + 0.5) & 0xffff) << 16) | ((cl(u[0]) * 65535 + 0.5) & 0xffff)) >>> 0;
    this._uvB = ((((cl(u[5]) * 65535 + 0.5) & 0xffff) << 16) | ((cl(u[4]) * 65535 + 0.5) & 0xffff)) >>> 0;
    return this;
  }
  setFrame(x, y, w, h) {
    this.frame.set(x, y, w, h);
    if (!this.trim) this.orig.set(0, 0, w, h);
    return this.updateUvs();
  }
  clone() { var t = new Texture(this.source, this.frame.clone(), this.orig.clone(), this.trim ? this.trim.clone() : null, this.rotate, this.defaultAnchor); t.key = this.key; t.frameName = this.frameName; return t; }
  destroy(destroySource) { if (this.destroyed) return; this.destroyed = true; if (destroySource && this.source) this.source.destroy(); }

  static fromCanvas(canvas, options) { return new Texture(new TextureSource(canvas, options)); }
  static fromImage(img, options) { return new Texture(new TextureSource(img, options)); }
  static fromPixels(data, width, height, options) {
    var o = Object.assign({ width: width, height: height }, options || {});
    return new Texture(new TextureSource({ data: data instanceof Uint8Array ? data : new Uint8Array(data.buffer || data), width: width, height: height }, o));
  }
}

function makeSolidTexture(rgba, size, label) {
  var n = size * size * 4, d = new Uint8Array(n);
  for (var i = 0; i < n; i += 4) { d[i] = rgba[0]; d[i + 1] = rgba[1]; d[i + 2] = rgba[2]; d[i + 3] = rgba[3]; }
  var src = new TextureSource({ data: d, width: size, height: size }, { width: size, height: size, premultiplied: true, label: label });
  Debug.track('TextureSource', -1); // texturas globales permanentes: no cuentan como fuga
  var t = new Texture(src); t.key = label;
  return t;
}
/** Textura blanca 4x4 usada para Graphics y rellenos sólidos. */
Texture.WHITE = makeSolidTexture([255, 255, 255, 255], 4, '__WHITE');
/** Textura transparente 1x1 */
Texture.EMPTY = makeSolidTexture([0, 0, 0, 0], 1, '__EMPTY');

/** Textura de destino de render (render-to-texture). */
class RenderTexture extends Texture {
  constructor(width, height, resolution, options) {
    options = options || {};
    resolution = resolution || 1;
    var src = new TextureSource(null, {
      width: Math.max(1, Math.ceil(width * resolution)), height: Math.max(1, Math.ceil(height * resolution)),
      resolution: resolution, renderTarget: true, scaleMode: options.scaleMode || 'linear', label: options.label || 'RenderTexture'
    });
    super(src);
    this.isRenderTexture = true;
    Debug.track('RenderTexture', 1);
  }
  /** Redimensiona (en unidades lógicas) y, opcionalmente, cambia la resolución. El contenido se pierde. */
  resize(width, height, resolution) {
    if (resolution > 0) this.source.resolution = resolution;
    var res = this.source.resolution;
    this.source.resize(Math.ceil(width * res), Math.ceil(height * res));
    this.frame.set(0, 0, this.source.width, this.source.height);
    this.orig.set(0, 0, this.source.width, this.source.height);
    this.updateUvs();
    return this;
  }
  destroy() {
    if (this.destroyed) return;
    Texture.prototype.destroy.call(this, true);
    Debug.track('RenderTexture', -1);
  }
  static create(width, height, resolution) { return new RenderTexture(width, height, resolution); }
}

/** Genera un canvas de tablero para texturas faltantes. */
function makeMissingCanvas() {
  var c = createCanvas(32, 32), ctx = c.getContext('2d');
  ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 16, 16); ctx.fillRect(16, 16, 16, 16);
  return c;
}

/* ------------------------------------------------------ TextureManager
 * Registro de texturas por clave (estilo Phaser): imágenes, spritesheets, atlas, canvas generados. */
class TextureEntry {
  constructor(key, sources) {
    this.key = key; this.sources = sources; this.frames = new Map(); this.frameNames = [];
    this.animations = null; this.data = null;
  }
  add(name, texture) {
    texture.key = this.key; texture.frameName = String(name);
    if (!this.frames.has(String(name))) this.frameNames.push(String(name));
    this.frames.set(String(name), texture);
    return texture;
  }
  get(frame) {
    if (frame === undefined || frame === null) return this.frames.get('__BASE') || this.frames.get(this.frameNames[0]);
    return this.frames.get(String(frame));
  }
  destroy() {
    this.frames.forEach(function (t) { t.destroy(false); });
    for (var i = 0; i < this.sources.length; i++) this.sources[i].destroy();
    this.frames.clear(); this.frameNames.length = 0; this.sources.length = 0;
  }
}

class TextureManager extends EventEmitter {
  constructor(game) {
    super();
    this.game = game || null;
    this.list = new Map();
    this._missing = null;
  }
  exists(key) { return this.list.has(key); }
  _checkKey(key) {
    if (typeof key !== 'string' || !key.length) throw new Error('UltraGame: clave de textura inválida');
    if (this.list.has(key)) { Log.warn('La textura "' + key + '" ya existe; se reemplaza'); this.remove(key); }
  }
  _entry(key, source, options) {
    this._checkKey(key);
    var e = new TextureEntry(key, [source]);
    var base = new Texture(source);
    e.add('__BASE', base);
    this.list.set(key, e);
    this.emit('add', key, e);
    return e;
  }
  /** Imagen, canvas, ImageBitmap o video */
  addImage(key, image, options) {
    var src = new TextureSource(image, options);
    this._checkSize(src, key);
    this._entry(key, src, options);
    return this.get(key);
  }
  addCanvas(key, canvas, options) { return this.addImage(key, canvas, options); }
  addSource(key, source) { this._entry(key, source); return this.get(key); }
  addTexture(key, texture) {
    this._checkKey(key);
    var e = new TextureEntry(key, [texture.source]); e.add('__BASE', texture);
    this.list.set(key, e); this.emit('add', key, e); return texture;
  }
  _checkSize(src, key) {
    var max = Security.maxTextureSize;
    if (src.width > max || src.height > max) Log.warn('Textura "' + key + '" (' + src.width + 'x' + src.height + ') supera maxTextureSize=' + max + '; algunos móviles no podrán mostrarla');
  }
  /** Spritesheet en rejilla: {frameWidth, frameHeight, margin, spacing, startFrame, endFrame} */
  addSpriteSheet(key, image, config) {
    var src = new TextureSource(image, config);
    this._checkSize(src, key);
    var e = this._entry(key, src);
    var fw = config.frameWidth | 0, fh = (config.frameHeight || config.frameWidth) | 0;
    if (fw <= 0 || fh <= 0) throw new Error('UltraGame: spritesheet "' + key + '" requiere frameWidth/frameHeight > 0');
    var margin = config.margin | 0, spacing = config.spacing | 0;
    var cols = Math.floor((src.width - margin * 2 + spacing) / (fw + spacing));
    var rows = Math.floor((src.height - margin * 2 + spacing) / (fh + spacing));
    var total = cols * rows, start = config.startFrame | 0, end = config.endFrame !== undefined && config.endFrame >= 0 ? Math.min(config.endFrame, total - 1) : total - 1;
    var idx = 0;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++, idx++) {
        if (idx < start || idx > end) continue;
        var x = margin + c * (fw + spacing), y = margin + r * (fh + spacing);
        e.add(idx - start, new Texture(src, new Rectangle(x, y, fw, fh)));
      }
    }
    e.data = { frameWidth: fw, frameHeight: fh, columns: cols, rows: rows };
    return e;
  }
  /** Atlas TexturePacker (JSON Hash / JSON Array) o multiatlas de Phaser. images: imagen o array de imágenes. */
  addAtlas(key, images, json, options) {
    if (!json || typeof json !== 'object') throw new Error('UltraGame: atlas "' + key + '" sin datos JSON');
    var imgs = Array.isArray(images) ? images : [images];
    var sources = imgs.map(function (im) { return new TextureSource(im, options); });
    this._checkKey(key);
    var e = new TextureEntry(key, sources);
    var self = this;
    var groups = [];
    if (Array.isArray(json.textures)) {
      json.textures.forEach(function (t, i) { groups.push({ source: sources[Math.min(i, sources.length - 1)], frames: t.frames, meta: t }); });
    } else {
      groups.push({ source: sources[0], frames: json.frames, meta: json.meta || {} });
    }
    groups.forEach(function (g) {
      var scale = parseFloat(g.meta && g.meta.scale) || 1;
      var frames = g.frames || {};
      var list = Array.isArray(frames) ? frames : Object.keys(frames).map(function (k) { var f = frames[k]; return Object.assign({ filename: k }, f); });
      for (var i = 0; i < list.length; i++) {
        var fd = list[i], name = fd.filename;
        if (name === undefined || isForbiddenKey(String(name))) continue;
        var tex = self._frameFromData(g.source, fd, scale);
        if (tex) e.add(name, tex);
      }
    });
    e.add('__BASE', new Texture(sources[0]));
    if (json.animations && typeof json.animations === 'object') {
      e.animations = {};
      Object.keys(json.animations).forEach(function (k) { if (!isForbiddenKey(k) && Array.isArray(json.animations[k])) e.animations[k] = json.animations[k].map(String); });
    }
    this.list.set(key, e);
    this.emit('add', key, e);
    return e;
  }
  _frameFromData(source, fd, scale) {
    var fr = fd.frame; if (!fr) return null;
    var num = function (v) { v = +v; return isFinite(v) ? v : 0; };
    var rw = num(fr.w), rh = num(fr.h);
    if (rw <= 0 || rh <= 0) return null;
    var frame = fd.rotated ? new Rectangle(num(fr.x), num(fr.y), rh, rw) : new Rectangle(num(fr.x), num(fr.y), rw, rh);
    if (frame.x + frame.width > source.width + 0.5 || frame.y + frame.height > source.height + 0.5) {
      Log.warnOnce('atlasbounds:' + fd.filename, 'Frame de atlas fuera de la imagen: ' + fd.filename);
      frame.width = Math.max(1, Math.min(frame.width, source.width - frame.x));
      frame.height = Math.max(1, Math.min(frame.height, source.height - frame.y));
    }
    var trimmed = fd.trimmed !== false && fd.spriteSourceSize && fd.sourceSize;
    var orig = trimmed ? new Rectangle(0, 0, num(fd.sourceSize.w), num(fd.sourceSize.h)) : new Rectangle(0, 0, rw, rh);
    var trim = trimmed ? new Rectangle(num(fd.spriteSourceSize.x), num(fd.spriteSourceSize.y), rw, rh) : null;
    var anchor = fd.pivot ? { x: num(fd.pivot.x), y: num(fd.pivot.y) } : (fd.anchor ? { x: num(fd.anchor.x), y: num(fd.anchor.y) } : null);
    var t = new Texture(source, frame, orig, trim, fd.rotated ? 2 : 0, anchor);
    if (scale !== 1) { /* atlas escalados: se interpreta vía resolution del source */ source.resolution = scale; }
    if (fd.borders) t.customData = { borders: fd.borders };
    return t;
  }
  /** Añade un frame manual a una textura existente */
  addFrame(key, name, x, y, w, h) {
    var e = this.list.get(key); if (!e) throw new Error('UltraGame: textura "' + key + '" no existe');
    return e.add(name, new Texture(e.sources[0], new Rectangle(x, y, w, h)));
  }
  /** Crea una textura dibujando en un canvas 2D: generate('estrella', 64, 64, (ctx, w, h) => {...}) */
  generate(key, width, height, draw, options) {
    options = options || {};
    var res = options.resolution || 1;
    var c = createCanvas(Math.ceil(width * res), Math.ceil(height * res));
    var ctx = c.getContext('2d');
    if (res !== 1) ctx.scale(res, res);
    draw(ctx, width, height);
    // con frameWidth se registra como spritesheet (fotogramas en rejilla, en píxeles lógicos)
    if (options.frameWidth) return this.addSpriteSheet(key, c, { frameWidth: options.frameWidth * res, frameHeight: (options.frameHeight || options.frameWidth) * res, margin: (options.margin || 0) * res, spacing: (options.spacing || 0) * res, resolution: res, scaleMode: options.scaleMode });
    return this.addCanvas(key, c, { resolution: res, scaleMode: options.scaleMode });
  }
  /** Canvas editable: devuelve {canvas, context, texture, refresh()} */
  createCanvas(key, width, height, options) {
    var c = createCanvas(width, height), tex = this.addCanvas(key, c, options);
    return { canvas: c, context: c.getContext('2d'), texture: tex, refresh: function () { tex.source.update(); } };
  }
  /** Genera una textura a partir de un objeto de escena (Graphics, Container...) usando el renderer. */
  fromDisplayObject(key, obj, options) {
    if (!this.game || !this.game.renderer) throw new Error('UltraGame: fromDisplayObject requiere un Game con renderer iniciado');
    var rt = this.game.renderer.generateTexture(obj, options);
    return this.addTexture(key, rt);
  }
  /** Textura procedural de patrón pixel-art desde una matriz de strings y una paleta. */
  fromPixelArt(key, rows, palette, pixelSize) {
    pixelSize = pixelSize || 1;
    var h = rows.length, w = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    return this.generate(key, w * pixelSize, h * pixelSize, function (ctx) {
      for (var y = 0; y < h; y++) for (var x = 0; x < rows[y].length; x++) {
        var ch = rows[y][x], col = palette[ch];
        if (col === undefined || col === null || ch === '.' || ch === ' ') continue;
        ctx.fillStyle = typeof col === 'number' ? Color.toHex(col) : col;
        ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
      }
    }, { scaleMode: 'nearest' });
  }
  get(key, frame) {
    if (key instanceof Texture) return key;
    var e = this.list.get(key);
    if (!e) {
      if (key === '__WHITE') return Texture.WHITE;
      if (key === '__EMPTY' || key === undefined || key === null) return Texture.EMPTY;
      Log.warnOnce('tex:' + key, 'Textura "' + key + '" no encontrada');
      return this.getMissing();
    }
    var t = e.get(frame);
    if (!t) { Log.warnOnce('frame:' + key + ':' + frame, 'Frame "' + frame + '" no existe en "' + key + '"'); return e.get(); }
    return t;
  }
  getEntry(key) { return this.list.get(key) || null; }
  getFrameNames(key, includeBase) {
    var e = this.list.get(key); if (!e) return [];
    return e.frameNames.filter(function (n) { return includeBase || n !== '__BASE'; });
  }
  getMissing() {
    if (!this._missing || this._missing.source.destroyed) this._missing = new Texture(new TextureSource(makeMissingCanvas(), { label: '__MISSING' }));
    return this._missing;
  }
  remove(key) {
    var e = this.list.get(key); if (!e) return false;
    this.list.delete(key);
    e.destroy();
    this.emit('remove', key);
    return true;
  }
  keys() { return Array.from(this.list.keys()); }
  destroy() {
    var self = this;
    this.list.forEach(function (e) { e.destroy(); });
    this.list.clear();
    if (this._missing) { this._missing.source.destroy(); this._missing = null; }
    this.off();
    self.game = null;
  }
}

UG.TextureSource = TextureSource;
UG.Texture = Texture;
UG.RenderTexture = RenderTexture;
UG.TextureManager = TextureManager;
