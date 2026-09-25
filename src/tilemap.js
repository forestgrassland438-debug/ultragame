/* UltraGame - Tiled: parser TMJ/TMX (csv, base64, zlib, gzip, mapas infinitos, grupos, tilesets externos),
 * tiles animados, volteos/rotaciones, capas de imagen, objetos, orientación ortogonal/isométrica/staggered/hex
 * y colisiones por tile (incluye plataformas de un solo sentido). */

var TILE_FLIP_H = 0x80000000, TILE_FLIP_V = 0x40000000, TILE_FLIP_D = 0x20000000, TILE_ROT_HEX = 0x10000000, TILE_GID_MASK = 0x0FFFFFFF;

var TiledParser = {
  FLIP_H: TILE_FLIP_H, FLIP_V: TILE_FLIP_V, FLIP_D: TILE_FLIP_D, GID_MASK: TILE_GID_MASK,
  /** Convierte propiedades de Tiled (array o dict) a objeto plano seguro. */
  props: function (p) {
    var out = Object.create(null);
    if (!p) return out;
    if (Array.isArray(p)) {
      for (var i = 0; i < p.length; i++) {
        var it = p[i]; if (!it || typeof it.name !== 'string' || isForbiddenKey(it.name)) continue;
        out[it.name] = TiledParser.propValue(it.type, it.value);
      }
    } else if (typeof p === 'object') {
      Object.keys(p).forEach(function (k) { if (!isForbiddenKey(k)) out[k] = p[k]; });
    }
    return out;
  },
  propValue: function (type, v) {
    switch (type) {
      case 'int': return parseInt(v, 10) || 0;
      case 'float': return parseFloat(v) || 0;
      case 'bool': return v === true || v === 'true' || v === 1 || v === '1';
      case 'color': {
        var s = String(v || '').replace('#', '');
        if (s.length === 8) return { color: parseInt(s.slice(2), 16), alpha: parseInt(s.slice(0, 2), 16) / 255, toString: function () { return '#' + s; } };
        return { color: parseInt(s || '0', 16), alpha: 1, toString: function () { return '#' + s; } };
      }
      case 'class': return v && typeof v === 'object' ? Security.safeMerge(Object.create(null), v) : Object.create(null);
      case 'object': return +v || 0;
      default: return v === undefined ? '' : v;
    }
  },
  decodeData: function (data, encoding, compression, count) {
    var out;
    if (Array.isArray(data)) {
      out = new Uint32Array(data.length);
      for (var i = 0; i < data.length; i++) out[i] = (+data[i]) >>> 0;
      return out;
    }
    if (typeof data !== 'string') return new Uint32Array(count || 0);
    if (encoding === 'csv') {
      var parts = data.split(','), arr = new Uint32Array(parts.length), n = 0;
      for (var j = 0; j < parts.length; j++) { var t = parts[j].trim(); if (t.length) arr[n++] = (+t) >>> 0; }
      return n === arr.length ? arr : arr.subarray(0, n);
    }
    var bytes = base64ToBytes(data.trim());
    if (compression === 'zlib' || compression === 'gzip') bytes = compression === 'gzip' ? Inflate.gzip(bytes, Security.maxMapTiles * 4) : Inflate.zlib(bytes, Security.maxMapTiles * 4);
    else if (compression === 'zstd') throw new Error('UltraGame Tiled: compresión zstd no soportada (usa zlib, gzip o CSV)');
    var len = bytes.length >> 2;
    out = new Uint32Array(len);
    for (var k = 0; k < len; k++) { var o = k * 4; out[k] = (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0; }
    return out;
  },
  normalizeTileset: function (ts) {
    var tw = +ts.tilewidth || 0, th = +ts.tileheight || 0, margin = +ts.margin || 0, spacing = +ts.spacing || 0;
    var iw = +ts.imagewidth || 0, ih = +ts.imageheight || 0;
    var columns = +ts.columns || (iw && tw ? Math.floor((iw - margin * 2 + spacing) / (tw + spacing)) : 0);
    var rows = ih && th ? Math.floor((ih - margin * 2 + spacing) / (th + spacing)) : 0;
    var tileCount = +ts.tilecount || (columns * rows);
    var tiles = [];
    var tlist = Array.isArray(ts.tiles) ? ts.tiles : (ts.tiles && typeof ts.tiles === 'object' ? Object.keys(ts.tiles).map(function (k) { return Object.assign({ id: +k }, ts.tiles[k]); }) : []);
    for (var i = 0; i < tlist.length; i++) {
      var t = tlist[i];
      tiles.push({
        id: +t.id || 0, type: t.type || t['class'] || '', properties: TiledParser.props(t.properties), probability: t.probability,
        animation: Array.isArray(t.animation) ? t.animation.map(function (f) { return { tileid: +f.tileid || 0, duration: Math.max(1, +f.duration || 100) }; }) : null,
        objectgroup: t.objectgroup ? (t.objectgroup.objects || []).map(TiledParser.normalizeObject) : null,
        image: t.image || null, imageWidth: +t.imagewidth || 0, imageHeight: +t.imageheight || 0,
        imageKey: t.image ? 'tiled:' + t.image : null
      });
      if (t.image && tileCount <= t.id) tileCount = t.id + 1;
    }
    var off = ts.tileoffset || {};
    return {
      name: String(ts.name || 'tileset'), firstgid: +ts.firstgid || 1, image: ts.image || null, imageKey: String(ts.name || ts.image || 'tileset'),
      imageWidth: iw, imageHeight: ih, tileWidth: tw, tileHeight: th, margin: margin, spacing: spacing, columns: columns,
      tileCount: tileCount, tileOffsetX: +off.x || 0, tileOffsetY: +off.y || 0, objectAlignment: ts.objectalignment || 'unspecified',
      properties: TiledParser.props(ts.properties), tiles: tiles, _baseURL: ts._baseURL
    };
  },
  normalizeObject: function (o) {
    var raw = o.gid !== undefined ? (+o.gid >>> 0) : 0;
    var obj = {
      id: +o.id || 0, name: String(o.name || ''), type: String(o.type || o['class'] || ''), x: +o.x || 0, y: +o.y || 0,
      width: +o.width || 0, height: +o.height || 0, rotation: +o.rotation || 0, visible: o.visible !== false,
      gid: raw & TILE_GID_MASK, flippedHorizontal: !!(raw & TILE_FLIP_H), flippedVertical: !!(raw & TILE_FLIP_V),
      point: !!o.point, ellipse: !!o.ellipse, properties: TiledParser.props(o.properties), template: o.template || null
    };
    if (Array.isArray(o.polygon)) obj.polygon = o.polygon.map(function (p) { return { x: +p.x || 0, y: +p.y || 0 }; });
    if (Array.isArray(o.polyline)) obj.polyline = o.polyline.map(function (p) { return { x: +p.x || 0, y: +p.y || 0 }; });
    if (o.text) obj.text = { text: String(o.text.text || ''), fontfamily: o.text.fontfamily, pixelsize: o.text.pixelsize || 16, color: o.text.color || '#000000', halign: o.text.halign, valign: o.text.valign, wrap: !!o.text.wrap, bold: !!o.text.bold, italic: !!o.text.italic };
    return obj;
  },
  normalize: function (raw) {
    if (!raw || typeof raw !== 'object') throw new Error('UltraGame Tiled: datos de mapa inválidos');
    var W = raw.width | 0, H = raw.height | 0, tw = +raw.tilewidth, th = +raw.tileheight;
    if (!(tw > 0) || !(th > 0)) throw new Error('UltraGame Tiled: tilewidth/tileheight inválidos');
    if (!raw.infinite && (W <= 0 || H <= 0 || W * H > Security.maxMapTiles)) throw new Error('UltraGame Tiled: tamaño de mapa inválido o excesivo (' + W + 'x' + H + ')');
    var map = {
      width: W, height: H, tileWidth: tw, tileHeight: th, orientation: raw.orientation || 'orthogonal', renderOrder: raw.renderorder || 'right-down',
      infinite: !!raw.infinite, staggerAxis: raw.staggeraxis || 'y', staggerIndex: raw.staggerindex || 'odd', hexSideLength: +raw.hexsidelength || 0,
      backgroundColor: raw.backgroundcolor || null, properties: TiledParser.props(raw.properties), version: raw.version, tiledVersion: raw.tiledversion,
      tilesets: (raw.tilesets || []).map(TiledParser.normalizeTileset).sort(function (a, b) { return a.firstgid - b.firstgid; }),
      layers: []
    };
    var total = 0;
    var walk = function (layers, ox, oy, op, vis, px, py, prefix) {
      for (var i = 0; i < (layers || []).length; i++) {
        var l = layers[i]; if (!l) continue;
        var base = {
          id: l.id, name: prefix + String(l.name || ''), type: l.type, visible: vis && l.visible !== false, opacity: op * (l.opacity === undefined ? 1 : +l.opacity),
          offsetX: ox + (+l.offsetx || 0) + (+l.x || 0) * (l.type === 'tilelayer' ? tw : 1) * 0, offsetY: oy + (+l.offsety || 0),
          parallaxX: px * (l.parallaxx === undefined ? 1 : +l.parallaxx), parallaxY: py * (l.parallaxy === undefined ? 1 : +l.parallaxy),
          tint: l.tintcolor ? parseInt(String(l.tintcolor).replace('#', '').slice(-6), 16) : 0xffffff, properties: TiledParser.props(l.properties), className: l['class'] || ''
        };
        if (l.type === 'group') { walk(l.layers, base.offsetX, base.offsetY, base.opacity, base.visible, base.parallaxX, base.parallaxY, base.name + '/'); continue; }
        if (l.type === 'tilelayer') {
          var lw = l.width | 0, lh = l.height | 0, data, sx = 0, sy = 0;
          if (Array.isArray(l.chunks) && l.chunks.length) {
            var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            l.chunks.forEach(function (c) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x + c.width); y1 = Math.max(y1, c.y + c.height); });
            lw = x1 - x0; lh = y1 - y0; sx = x0; sy = y0;
            if (lw * lh > Security.maxMapTiles) throw new Error('UltraGame Tiled: capa infinita demasiado grande');
            data = new Uint32Array(lw * lh);
            l.chunks.forEach(function (c) {
              var cd = TiledParser.decodeData(c.data, l.encoding, l.compression, c.width * c.height);
              for (var yy = 0; yy < c.height; yy++) for (var xx = 0; xx < c.width; xx++) data[(c.y - y0 + yy) * lw + (c.x - x0 + xx)] = cd[yy * c.width + xx] || 0;
            });
          } else {
            data = TiledParser.decodeData(l.data, l.encoding, l.compression, lw * lh);
            if (data.length < lw * lh) { var full = new Uint32Array(lw * lh); full.set(data); data = full; }
          }
          total += lw * lh;
          if (total > Security.maxMapTiles) throw new Error('UltraGame Tiled: demasiados tiles en total');
          base.width = lw; base.height = lh; base.data = data; base.startX = sx; base.startY = sy;
        } else if (l.type === 'objectgroup') {
          base.objects = (l.objects || []).map(TiledParser.normalizeObject);
          base.color = l.color || null; base.drawOrder = l.draworder || 'topdown';
        } else if (l.type === 'imagelayer') {
          base.image = l.image || null; base.imageKey = l.image ? 'tiled:' + l.image : null;
          base.repeatX = !!l.repeatx; base.repeatY = !!l.repeaty;
        } else continue;
        map.layers.push(base);
      }
    };
    walk(raw.layers, 0, 0, 1, true, 1, 1, '');
    return map;
  },
  /* ----------------------------------------------------------- TMX (XML) */
  _attrs: function (el) {
    var o = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i]; if (isForbiddenKey(a.name)) continue;
      var v = a.value;
      o[a.name] = /^-?\d+(\.\d+)?$/.test(v) && !/^(name|type|class|source|image|tintcolor|backgroundcolor|color|version|tiledversion|encoding|compression|orientation|renderorder|staggeraxis|staggerindex|draworder|objectalignment|template|value|trans)$/.test(a.name) ? +v : v;
    }
    return o;
  },
  _children: function (el, tag) { var out = []; for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (!tag || c.tagName === tag) out.push(c); return out; },
  _props: function (el) {
    var pe = TiledParser._children(el, 'properties')[0]; if (!pe) return undefined;
    return TiledParser._children(pe, 'property').map(function (p) {
      var a = TiledParser._attrs(p);
      var val = p.hasAttribute('value') ? p.getAttribute('value') : p.textContent;
      if (a.type === 'class') { var sub = {}; var nested = TiledParser._props(p); if (nested) nested.forEach(function (n) { sub[n.name] = TiledParser.propValue(n.type, n.value); }); val = sub; }
      return { name: a.name, type: a.type || 'string', value: val };
    });
  },
  tilesetFromTSX: function (el) {
    var ts = TiledParser._attrs(el);
    var img = TiledParser._children(el, 'image')[0];
    if (img) { var ia = TiledParser._attrs(img); ts.image = ia.source; ts.imagewidth = ia.width; ts.imageheight = ia.height; }
    var off = TiledParser._children(el, 'tileoffset')[0]; if (off) ts.tileoffset = TiledParser._attrs(off);
    ts.properties = TiledParser._props(el);
    ts.tiles = TiledParser._children(el, 'tile').map(function (t) {
      var ta = TiledParser._attrs(t);
      var o = { id: ta.id, type: ta.type || ta['class'], probability: ta.probability, properties: TiledParser._props(t) };
      var ti = TiledParser._children(t, 'image')[0]; if (ti) { var tia = TiledParser._attrs(ti); o.image = tia.source; o.imagewidth = tia.width; o.imageheight = tia.height; }
      var an = TiledParser._children(t, 'animation')[0]; if (an) o.animation = TiledParser._children(an, 'frame').map(function (f) { return TiledParser._attrs(f); });
      var og = TiledParser._children(t, 'objectgroup')[0]; if (og) o.objectgroup = { objects: TiledParser._children(og, 'object').map(TiledParser._objFromXML) };
      return o;
    });
    return ts;
  },
  _objFromXML: function (el) {
    var o = TiledParser._attrs(el);
    if (o.visible !== undefined) o.visible = o.visible !== 0;
    o.properties = TiledParser._props(el);
    var pts = function (s) { return String(s || '').trim().split(/\s+/).map(function (pr) { var xy = pr.split(','); return { x: +xy[0] || 0, y: +xy[1] || 0 }; }); };
    TiledParser._children(el).forEach(function (c) {
      if (c.tagName === 'ellipse') o.ellipse = true;
      else if (c.tagName === 'point') o.point = true;
      else if (c.tagName === 'polygon') o.polygon = pts(c.getAttribute('points'));
      else if (c.tagName === 'polyline') o.polyline = pts(c.getAttribute('points'));
      else if (c.tagName === 'text') { var ta = TiledParser._attrs(c); ta.text = c.textContent; ta.wrap = ta.wrap === 1; ta.bold = ta.bold === 1; ta.italic = ta.italic === 1; o.text = ta; }
    });
    return o;
  },
  _layersFromXML: function (el) {
    var out = [];
    TiledParser._children(el).forEach(function (c) {
      var a;
      if (c.tagName === 'layer') {
        a = TiledParser._attrs(c); a.type = 'tilelayer'; a.properties = TiledParser._props(c);
        if (a.visible !== undefined) a.visible = a.visible !== 0;
        var d = TiledParser._children(c, 'data')[0];
        if (d) {
          var da = TiledParser._attrs(d);
          a.encoding = da.encoding; a.compression = da.compression;
          var chunks = TiledParser._children(d, 'chunk');
          var readData = function (node) {
            if (da.encoding) return node.textContent.trim();
            return TiledParser._children(node, 'tile').map(function (t) { return +t.getAttribute('gid') || 0; });
          };
          if (chunks.length) a.chunks = chunks.map(function (ch) { var ca = TiledParser._attrs(ch); ca.data = readData(ch); return ca; });
          else a.data = readData(d);
        }
        out.push(a);
      } else if (c.tagName === 'objectgroup') {
        a = TiledParser._attrs(c); a.type = 'objectgroup'; a.properties = TiledParser._props(c);
        if (a.visible !== undefined) a.visible = a.visible !== 0;
        a.objects = TiledParser._children(c, 'object').map(TiledParser._objFromXML);
        out.push(a);
      } else if (c.tagName === 'imagelayer') {
        a = TiledParser._attrs(c); a.type = 'imagelayer'; a.properties = TiledParser._props(c);
        if (a.visible !== undefined) a.visible = a.visible !== 0;
        var im = TiledParser._children(c, 'image')[0]; if (im) a.image = im.getAttribute('source');
        a.repeatx = a.repeatx === 1; a.repeaty = a.repeaty === 1;
        out.push(a);
      } else if (c.tagName === 'group') {
        a = TiledParser._attrs(c); a.type = 'group'; a.properties = TiledParser._props(c);
        if (a.visible !== undefined) a.visible = a.visible !== 0;
        a.layers = TiledParser._layersFromXML(c);
        out.push(a);
      }
    });
    return out;
  },
  fromTMX: function (doc) {
    var mapEl = doc.documentElement || doc;
    if (!mapEl || mapEl.tagName !== 'map') throw new Error('UltraGame Tiled: TMX sin elemento <map>');
    var m = TiledParser._attrs(mapEl);
    m.infinite = m.infinite === 1;
    m.properties = TiledParser._props(mapEl);
    m.tilesets = TiledParser._children(mapEl, 'tileset').map(function (t) {
      var a = TiledParser._attrs(t);
      if (a.source) return { firstgid: a.firstgid, source: a.source };
      var ts = TiledParser.tilesetFromTSX(t); ts.firstgid = a.firstgid; return ts;
    });
    m.layers = TiledParser._layersFromXML(mapEl);
    return m;
  }
};

/* ============================================================ TilesetRuntime */
class TilesetRuntime {
  constructor(map, data) {
    this.map = map; this.data = data;
    this.name = data.name; this.firstgid = data.firstgid;
    this.tileWidth = data.tileWidth || map.tileWidth; this.tileHeight = data.tileHeight || map.tileHeight;
    this.margin = data.margin; this.spacing = data.spacing; this.columns = data.columns; this.tileCount = data.tileCount;
    this.offsetX = data.tileOffsetX; this.offsetY = data.tileOffsetY;
    this.lastgid = this.firstgid + Math.max(1, this.tileCount) - 1;
    this.texture = null; this.uvs = null; this.inset = -1;
    this.tiles = new Map(); this.anims = new Map(); this.tileTextures = new Map();
    // colección de imágenes: sin imagen global pero con imagen por tile
    this.collection = !data.image && data.tiles.some(function (t) { return !!t.image; });
    for (var i = 0; i < data.tiles.length; i++) {
      var t = data.tiles[i]; this.tiles.set(t.id, t);
      if (t.animation && t.animation.length) { var tot = 0; t.animation.forEach(function (f) { tot += f.duration; }); this.anims.set(t.id, { frames: t.animation, total: tot }); }
    }
    this.properties = data.properties;
  }
  bindTexture(tex, inset) {
    this.texture = tex; this.tileTextures.clear();
    if (!tex || this.collection) return this;
    var src = tex.source, fr = tex.frame, res = src.resolution;
    var sw = src.width, sh = src.height;
    var tw = this.tileWidth * res, th = this.tileHeight * res, m = this.margin * res, sp = this.spacing * res;
    var cols = this.columns || Math.max(1, Math.floor((fr.width - m * 2 + sp) / (tw + sp)));
    this.columns = cols;
    var count = this.tileCount || cols * Math.floor((fr.height - m * 2 + sp) / (th + sp));
    this.tileCount = count; this.lastgid = this.firstgid + count - 1;
    var ins = inset !== undefined ? inset : (src.scaleMode === 'nearest' ? 0 : 0.5);
    this.inset = ins;
    var uv = new Float32Array(count * 4);
    for (var i = 0; i < count; i++) {
      var c = i % cols, r = (i / cols) | 0, px = fr.x + m + c * (tw + sp), py = fr.y + m + r * (th + sp);
      uv[i * 4] = (px + ins) / sw; uv[i * 4 + 1] = (py + ins) / sh; uv[i * 4 + 2] = (px + tw - ins) / sw; uv[i * 4 + 3] = (py + th - ins) / sh;
    }
    this.uvs = uv;
    return this;
  }
  containsGid(gid) { return gid >= this.firstgid && gid <= this.lastgid; }
  animFrame(localId, time) {
    var a = this.anims.get(localId); if (!a) return localId;
    var t = time % a.total;
    for (var i = 0; i < a.frames.length; i++) { t -= a.frames[i].duration; if (t < 0) return a.frames[i].tileid; }
    return a.frames[a.frames.length - 1].tileid;
  }
  getTileProperties(localId) { var t = this.tiles.get(localId); return t ? t.properties : null; }
  /** Textura del tile (para objetos-tile y colecciones de imágenes). */
  getTileTexture(localId, textures) {
    var cached = this.tileTextures.get(localId); if (cached) return cached;
    var tex = null;
    if (this.collection) {
      var t = this.tiles.get(localId);
      if (t && t.imageKey && textures && textures.exists(t.imageKey)) tex = textures.get(t.imageKey);
    } else if (this.texture && this.uvs) {
      var src = this.texture.source, u = this.uvs, i = localId * 4, ins = this.inset;
      var x = u[i] * src.width - ins, y = u[i + 1] * src.height - ins;
      tex = new Texture(src, new Rectangle(x, y, this.tileWidth * src.resolution, this.tileHeight * src.resolution));
    }
    if (tex) this.tileTextures.set(localId, tex);
    return tex;
  }
}

/* =================================================================== Tilemap */
class Tilemap extends EventEmitter {
  constructor(scene, keyOrData) {
    super();
    this.scene = scene;
    var data = typeof keyOrData === 'string' ? scene.game.cache.tilemap.get(keyOrData) : keyOrData;
    if (!data) throw new Error('UltraGame: mapa "' + keyOrData + '" no cargado');
    if (!data.layers || !data.tilesets || data.tileWidth === undefined) data = TiledParser.normalize(data);
    this.key = typeof keyOrData === 'string' ? keyOrData : '';
    this.data = data;
    this.width = data.width; this.height = data.height; this.tileWidth = data.tileWidth; this.tileHeight = data.tileHeight;
    this.orientation = data.orientation; this.properties = data.properties;
    this.tilesets = data.tilesets.map(function (ts) { return new TilesetRuntime(data, ts); });
    this.layers = [];
    this.destroyed = false;
    this._resolveTextures();
    this._buildLookup();
  }
  get widthInPixels() { return this.orientation === 'isometric' ? (this.width + this.height) * this.tileWidth / 2 : this.width * this.tileWidth; }
  get heightInPixels() { return this.orientation === 'isometric' ? (this.width + this.height) * this.tileHeight / 2 : this.height * this.tileHeight; }
  get backgroundColor() { return this.data.backgroundColor ? Color.toNumber(this.data.backgroundColor) : null; }
  _textures() { return this.scene.textures || this.scene.game.textures; }
  _resolveTextures() {
    var tm = this._textures();
    for (var i = 0; i < this.tilesets.length; i++) {
      var ts = this.tilesets[i]; if (ts.texture || ts.collection) continue;
      var d = ts.data, cands = [d.name, d.imageKey];
      if (d.image) { var base = String(d.image).split('/').pop(); cands.push(base, base.replace(/\.[a-z0-9]+$/i, ''), d.image); }
      for (var c = 0; c < cands.length; c++) if (cands[c] && tm.exists(cands[c])) { ts.bindTexture(tm.get(cands[c])); break; }
    }
  }
  _buildLookup() {
    var maxGid = 0; for (var i = 0; i < this.tilesets.length; i++) maxGid = Math.max(maxGid, this.tilesets[i].lastgid);
    this.maxGid = maxGid;
    if (maxGid < 1 << 20) {
      var lk = new Int16Array(maxGid + 1).fill(-1);
      for (var t = 0; t < this.tilesets.length; t++) { var ts = this.tilesets[t]; for (var g = ts.firstgid; g <= ts.lastgid && g <= maxGid; g++) lk[g] = t; }
      this._lookup = lk;
    } else this._lookup = null;
    this.maxTileW = this.tileWidth; this.maxTileH = this.tileHeight;
    for (var j = 0; j < this.tilesets.length; j++) { this.maxTileW = Math.max(this.maxTileW, this.tilesets[j].tileWidth); this.maxTileH = Math.max(this.maxTileH, this.tilesets[j].tileHeight); }
  }
  /** Asocia un tileset de Tiled a una textura cargada: addTilesetImage('tiles', 'claveTextura') */
  addTilesetImage(tilesetName, key, tileWidth, tileHeight, margin, spacing) {
    var ts = this.getTileset(tilesetName) || (this.tilesets.length === 1 ? this.tilesets[0] : null);
    if (!ts) { Log.warn('Tileset "' + tilesetName + '" no existe en el mapa'); return null; }
    if (tileWidth) ts.tileWidth = tileWidth; if (tileHeight) ts.tileHeight = tileHeight;
    if (margin !== undefined) ts.margin = margin; if (spacing !== undefined) ts.spacing = spacing;
    ts.bindTexture(this._textures().get(key || tilesetName));
    this._buildLookup();
    return ts;
  }
  getTileset(name) { for (var i = 0; i < this.tilesets.length; i++) if (this.tilesets[i].name === name) return this.tilesets[i]; return null; }
  tilesetForGid(gid) {
    if (this._lookup) { var i = gid < this._lookup.length ? this._lookup[gid] : -1; return i >= 0 ? this.tilesets[i] : null; }
    for (var k = this.tilesets.length - 1; k >= 0; k--) if (gid >= this.tilesets[k].firstgid) return this.tilesets[k];
    return null;
  }
  getTileProperties(gid) { gid &= TILE_GID_MASK; var ts = this.tilesetForGid(gid); return ts ? ts.getTileProperties(gid - ts.firstgid) : null; }
  getLayerData(nameOrIndex) {
    if (typeof nameOrIndex === 'number') return this.data.layers[nameOrIndex] || null;
    for (var i = 0; i < this.data.layers.length; i++) if (this.data.layers[i].name === nameOrIndex) return this.data.layers[i];
    return null;
  }
  getLayer(name) { for (var i = 0; i < this.layers.length; i++) if (this.layers[i].name === name) return this.layers[i]; return null; }
  createLayer(nameOrIndex, parentOrX, x, y) {
    var ld = this.getLayerData(nameOrIndex);
    if (!ld || ld.type !== 'tilelayer') { Log.warn('Capa de tiles "' + nameOrIndex + '" no encontrada'); return null; }
    this._resolveTextures();
    var layer = new TilemapLayer(this, ld);
    var parent = parentOrX instanceof Container ? parentOrX : this.scene.world;
    if (typeof parentOrX === 'number') { y = x; x = parentOrX; } // createLayer(nombre, x, y)
    if (typeof x === 'number') layer.x += x;
    if (typeof y === 'number') layer.y += y;
    parent.addChild(layer);
    this.layers.push(layer);
    return layer;
  }
  /** Crea todas las capas de tiles e imágenes en orden. */
  createAllLayers(parent) {
    var out = [], self = this, p = parent || this.scene.world, tm = this._textures();
    this.data.layers.forEach(function (ld) {
      if (ld.type === 'tilelayer') out.push(self.createLayer(ld.name, p));
      else if (ld.type === 'imagelayer' && ld.imageKey && tm.exists(ld.imageKey)) {
        var tex = tm.get(ld.imageKey), spr;
        if (ld.repeatX || ld.repeatY) spr = new TilingSprite(ld.offsetX, ld.offsetY, ld.repeatX ? self.widthInPixels : tex.width, ld.repeatY ? self.heightInPixels : tex.height, tex);
        else spr = new Sprite(ld.offsetX, ld.offsetY, tex);
        spr.setOrigin(0, 0); spr.alpha = ld.opacity; spr.visible = ld.visible; spr.name = ld.name; spr.tint = ld.tint;
        spr.setScrollFactor(ld.parallaxX, ld.parallaxY);
        spr.scene = self.scene; p.addChild(spr); out.push(spr);
      }
    });
    return out;
  }
  getObjectLayer(name) { var l = this.getLayerData(name); return l && l.type === 'objectgroup' ? l : null; }
  getObjects(layerName) { var l = this.getObjectLayer(layerName); return l ? l.objects : []; }
  findObject(layerName, fn) { var o = this.getObjects(layerName); for (var i = 0; i < o.length; i++) if (typeof fn === 'function' ? fn(o[i]) : o[i].name === fn) return o[i]; return null; }
  filterObjects(layerName, fn) { return this.getObjects(layerName).filter(fn); }
  /** Crea sprites a partir de objetos: createFromObjects('Monedas', {name:'coin', key:'coin'}) */
  createFromObjects(layerName, config) {
    config = config || {};
    var objs = this.getObjects(layerName), out = [], tm = this._textures(), scene = this.scene;
    var Cls = config.classType || Sprite, parent = config.container || scene.world;
    for (var i = 0; i < objs.length; i++) {
      var o = objs[i];
      if (config.name !== undefined && o.name !== config.name) continue;
      if (config.type !== undefined && o.type !== config.type) continue;
      if (config.gid !== undefined && o.gid !== config.gid) continue;
      if (config.id !== undefined && o.id !== config.id) continue;
      if (config.filter && !config.filter(o)) continue;
      var tex = null;
      if (config.key) tex = tm.get(config.key, config.frame);
      else if (o.gid) { var ts = this.tilesetForGid(o.gid); if (ts) tex = ts.getTileTexture(o.gid - ts.firstgid, tm); }
      var s = new Cls(0, 0, tex || Texture.WHITE);
      s.scene = scene;
      var w = o.width || (tex ? tex.width : 0), h = o.height || (tex ? tex.height : 0);
      if (o.gid) { s.x = o.x + w / 2; s.y = o.y - h / 2; if (tex && tex.width) { s.scaleX = w / tex.width; s.scaleY = h / tex.height; } }
      else { s.x = o.x + w / 2; s.y = o.y + h / 2; if (!tex && s.setDisplaySize) s.setDisplaySize(w || 16, h || 16); }
      if (o.rotation) {
        // Tiled rota alrededor del origen del objeto (arriba-izq en rectángulos, abajo-izq en objetos-tile)
        var rad = o.rotation * DEG_TO_RAD, offX = w / 2, offY = o.gid ? -h / 2 : h / 2;
        s.x = o.x + offX * Math.cos(rad) - offY * Math.sin(rad); s.y = o.y + offX * Math.sin(rad) + offY * Math.cos(rad);
        s.rotation = rad;
      }
      if (o.flippedHorizontal && s.setFlipX) s.setFlipX(true);
      if (o.flippedVertical && s.setFlipY) s.setFlipY(true);
      s.visible = o.visible; s.name = o.name;
      var props = o.properties;
      Object.keys(props).forEach(function (k) { s.data.set(k, props[k]); });
      s.data.set('tiledObject', o);
      parent.addChild(s);
      out.push(s);
    }
    return out;
  }
  tileToWorldXY(tx, ty, out, layer) { return (layer || this.layers[0] || new TilemapLayer(this, this.data.layers.filter(function (l) { return l.type === 'tilelayer'; })[0])).tileToWorldXY(tx, ty, out); }
  worldToTileXY(wx, wy, snap, out, layer) { return (layer || this.layers[0]).worldToTileXY(wx, wy, snap, out); }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (var i = 0; i < this.layers.length; i++) this.layers[i].destroy();
    this.layers.length = 0;
    this.tilesets.forEach(function (ts) { ts.tileTextures.clear(); ts.texture = null; });
    this.off(); this.scene = null;
  }
}

/* ============================================================== TilemapLayer */
class Tile {
  constructor(layer, gid, x, y) {
    this.layer = layer; this.raw = gid; this.index = gid & TILE_GID_MASK; this.x = x; this.y = y;
    this.flipX = !!(gid & TILE_FLIP_H); this.flipY = !!(gid & TILE_FLIP_V); this.flipDiagonal = !!(gid & TILE_FLIP_D);
    this.width = layer.tileWidth; this.height = layer.tileHeight;
    this.pixelX = x * layer.tileWidth; this.pixelY = y * layer.tileHeight;
    this.tileset = this.index ? layer.tilemap.tilesetForGid(this.index) : null;
    this.properties = this.tileset ? (this.tileset.getTileProperties(this.index - this.tileset.firstgid) || {}) : {};
    this.collides = layer.collidesAt(x, y);
  }
  get centerX() { return this.pixelX + this.width / 2; }
  get centerY() { return this.pixelY + this.height / 2; }
}

class TilemapLayer extends Container {
  constructor(tilemap, layerData) {
    super(layerData.offsetX, layerData.offsetY);
    this.type = 'TilemapLayer';
    this.tilemap = tilemap;
    this.layer = layerData;
    this.name = layerData.name;
    this.tileData = new Uint32Array(layerData.data);
    this.layerWidth = layerData.width; this.layerHeight = layerData.height;
    this.startX = layerData.startX || 0; this.startY = layerData.startY || 0;
    this.tileWidth = tilemap.tileWidth; this.tileHeight = tilemap.tileHeight;
    this.alpha = layerData.opacity; this.visible = layerData.visible; this.tint = layerData.tint;
    this.setScrollFactor(layerData.parallaxX, layerData.parallaxY);
    this.properties = layerData.properties;
    this.scene = tilemap.scene;
    this.cullPaddingX = 1; this.cullPaddingY = 1;
    this.collisionFlags = new Uint8Array(Math.max(1, tilemap.maxGid + 1));
    this.tilesDrawn = 0;
    this._pc = 0; this._pcT = -1; this._pcA = -1;
  }
  get orientation() { return this.tilemap.orientation; }
  get widthInPixels() { return this.layerWidth * this.tileWidth; }
  get heightInPixels() { return this.layerHeight * this.tileHeight; }
  inBounds(tx, ty) { tx -= this.startX; ty -= this.startY; return tx >= 0 && ty >= 0 && tx < this.layerWidth && ty < this.layerHeight; }
  gidAt(tx, ty) { tx -= this.startX; ty -= this.startY; if (tx < 0 || ty < 0 || tx >= this.layerWidth || ty >= this.layerHeight) return 0; return this.tileData[ty * this.layerWidth + tx]; }
  /** 0 = no colisiona, 1 = sólido, 2 = plataforma de un sentido (solo por arriba) */
  collidesAt(tx, ty) { var g = this.gidAt(tx, ty) & TILE_GID_MASK; return g && g < this.collisionFlags.length ? this.collisionFlags[g] : 0; }
  hasTileAt(tx, ty) { return (this.gidAt(tx, ty) & TILE_GID_MASK) !== 0; }
  getTileAt(tx, ty, nonNull) {
    var g = this.gidAt(tx, ty);
    if (!g && !nonNull) return null;
    return new Tile(this, g, tx, ty);
  }
  /** Coordenadas de mundo -> tile (considera la transformación de la capa, sin cámara). */
  worldToTileXY(wx, wy, snap, out) {
    out = out || new Vec2();
    var l = this.toLocal(wx, wy, _tmpVec);
    var tw = this.tileWidth, th = this.tileHeight, o = this.tilemap.orientation;
    if (o === 'isometric') {
      var ox = this.tilemap.height * tw / 2, lx = l.x - ox, ly = l.y;
      out.x = (lx / (tw / 2) + ly / (th / 2)) / 2; out.y = (ly / (th / 2) - lx / (tw / 2)) / 2;
    } else { out.x = l.x / tw; out.y = l.y / th; }
    if (snap !== false) { out.x = Math.floor(out.x); out.y = Math.floor(out.y); }
    return out;
  }
  worldToTileX(wx, snap) { return this.worldToTileXY(wx, 0, snap).x; }
  worldToTileY(wy, snap) { return this.worldToTileXY(0, wy, snap).y; }
  /** Esquina superior-izquierda del tile en mundo (en iso: vértice superior del rombo). */
  tileToWorldXY(tx, ty, out) {
    out = out || new Vec2();
    var p = this._tilePos(tx, ty);
    return this.toGlobal(p.x, p.y, out);
  }
  _tilePos(tx, ty) {
    var tm = this.tilemap, tw = this.tileWidth, th = this.tileHeight, o = tm.orientation, d = tm.data;
    if (o === 'isometric') return { x: (tx - ty) * tw / 2 + tm.height * tw / 2 - tw / 2, y: (tx + ty) * th / 2 };
    if (o === 'staggered' || o === 'hexagonal') {
      var hs = o === 'hexagonal' ? d.hexSideLength : 0, odd = d.staggerIndex === 'odd';
      if (d.staggerAxis === 'x') { var colW = (tw + hs) / 2, st = odd ? (tx & 1) : !(tx & 1); return { x: tx * colW, y: ty * th + (st ? th / 2 : 0) }; }
      var rowH = (th + hs) / 2, st2 = odd ? (ty & 1) : !(ty & 1);
      return { x: tx * tw + (st2 ? tw / 2 : 0), y: ty * rowH };
    }
    return { x: tx * tw, y: ty * th };
  }
  getTileAtWorldXY(wx, wy, nonNull) { var t = this.worldToTileXY(wx, wy, true, new Vec2()); return this.getTileAt(t.x, t.y, nonNull); }
  putTileAt(gid, tx, ty) {
    if (gid instanceof Tile) gid = gid.raw;
    var x = tx - this.startX, y = ty - this.startY;
    if (x < 0 || y < 0 || x >= this.layerWidth || y >= this.layerHeight) return null;
    this.tileData[y * this.layerWidth + x] = gid >>> 0;
    if (this._cache) this._cache.dirty = true; // capa cacheada (cacheAsTexture): se regenera
    return this.getTileAt(tx, ty, true);
  }
  putTileAtWorldXY(gid, wx, wy) { var t = this.worldToTileXY(wx, wy, true, new Vec2()); return this.putTileAt(gid, t.x, t.y); }
  removeTileAt(tx, ty) { var old = this.getTileAt(tx, ty); this.putTileAt(0, tx, ty); return old; }
  removeTileAtWorldXY(wx, wy) { var t = this.worldToTileXY(wx, wy, true, new Vec2()); return this.removeTileAt(t.x, t.y); }
  fill(gid, x, y, w, h) {
    x = x === undefined ? this.startX : x; y = y === undefined ? this.startY : y; w = w === undefined ? this.layerWidth : w; h = h === undefined ? this.layerHeight : h;
    for (var ty = y; ty < y + h; ty++) for (var tx = x; tx < x + w; tx++) this.putTileAt(gid, tx, ty);
    return this;
  }
  replaceByIndex(find, replace) { var d = this.tileData; for (var i = 0; i < d.length; i++) if ((d[i] & TILE_GID_MASK) === find) d[i] = (d[i] & ~TILE_GID_MASK) | replace; if (this._cache) this._cache.dirty = true; return this; }
  forEachTile(cb, x, y, w, h, onlyNonEmpty) {
    x = x === undefined ? this.startX : x; y = y === undefined ? this.startY : y; w = w === undefined ? this.layerWidth : w; h = h === undefined ? this.layerHeight : h;
    for (var ty = y; ty < y + h; ty++) for (var tx = x; tx < x + w; tx++) { var g = this.gidAt(tx, ty); if (onlyNonEmpty !== false && !g) continue; cb(new Tile(this, g, tx, ty)); }
    return this;
  }
  getTilesWithin(x, y, w, h, filter) {
    var out = [];
    filter = filter || {};
    this.forEachTile(function (t) {
      if (filter.isColliding && !t.collides) return;
      if (filter.isNotEmpty !== false && !t.index) return;
      out.push(t);
    }, x, y, w, h, filter.isNotEmpty !== false);
    return out;
  }
  getTilesWithinWorldXY(wx, wy, ww, wh, filter) {
    var a = this.worldToTileXY(wx, wy, true, new Vec2()), b = this.worldToTileXY(wx + ww, wy + wh, true, new Vec2());
    return this.getTilesWithin(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x) + 1, Math.abs(b.y - a.y) + 1, filter);
  }
  findTile(fn) { var found = null; this.forEachTile(function (t) { if (!found && fn(t)) found = t; }); return found; }
  filterTiles(fn) { var out = []; this.forEachTile(function (t) { if (fn(t)) out.push(t); }); return out; }
  /* ---------- colisión ---------- */
  _flag(gid, v) { if (gid > 0 && gid < this.collisionFlags.length) this.collisionFlags[gid] = v; }
  setCollision(indexes, collides) { var v = collides === false ? 0 : 1, self = this; (Array.isArray(indexes) ? indexes : [indexes]).forEach(function (g) { self._flag(g, v); }); return this; }
  setCollisionBetween(start, stop, collides) { var v = collides === false ? 0 : 1; for (var g = start; g <= stop; g++) this._flag(g, v); return this; }
  setCollisionByExclusion(indexes, collides) {
    var ex = new Set(Array.isArray(indexes) ? indexes : [indexes]), v = collides === false ? 0 : 1;
    for (var g = 1; g < this.collisionFlags.length; g++) if (!ex.has(g)) this.collisionFlags[g] = v;
    return this;
  }
  setCollisionByProperty(props, collides) {
    var v = collides === false ? 0 : 1, tm = this.tilemap, keys = Object.keys(props);
    for (var g = 1; g < this.collisionFlags.length; g++) {
      var p = tm.getTileProperties(g); if (!p) continue;
      var ok = true; for (var k = 0; k < keys.length; k++) if (p[keys[k]] !== props[keys[k]]) { ok = false; break; }
      if (ok) this.collisionFlags[g] = p.oneWay === true || p.oneway === true ? (v ? 2 : 0) : v;
    }
    return this;
  }
  setCollisionFromCollisionGroup(collides) {
    var v = collides === false ? 0 : 1, tm = this.tilemap;
    for (var t = 0; t < tm.tilesets.length; t++) { var ts = tm.tilesets[t]; ts.tiles.forEach(function (tile, id) { if (tile.objectgroup && tile.objectgroup.length) { var g = ts.firstgid + id; if (g < this.collisionFlags.length) this.collisionFlags[g] = v; } }, this); }
    return this;
  }
  /** Marca tiles como plataformas de un solo sentido (se atraviesan desde abajo). */
  setOneWayCollision(indexes) { var self = this; (Array.isArray(indexes) ? indexes : [indexes]).forEach(function (g) { self._flag(g, 2); }); return this; }
  setCullPadding(x, y) { this.cullPaddingX = x; this.cullPaddingY = y === undefined ? x : y; return this; }

  /* ---------- render ---------- */
  _viewTileRange(cr) {
    var wt = this.worldTransform, id = 1 / ((wt.a * wt.d - wt.b * wt.c) || 1);
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var pts = [cr.x, cr.y, cr.x + cr.width, cr.y, cr.x + cr.width, cr.y + cr.height, cr.x, cr.y + cr.height];
    for (var i = 0; i < 8; i += 2) {
      var px = pts[i] - wt.tx, py = pts[i + 1] - wt.ty;
      var lx = (wt.d * px - wt.c * py) * id, ly = (wt.a * py - wt.b * px) * id;
      if (lx < minX) minX = lx; if (lx > maxX) maxX = lx; if (ly < minY) minY = ly; if (ly > maxY) maxY = ly;
    }
    var tm = this.tilemap, tw = this.tileWidth, th = this.tileHeight;
    var extraX = Math.ceil(tm.maxTileW / tw) - 1, extraY = Math.ceil(tm.maxTileH / th) - 1;
    return [Math.floor(minX / tw) - this.cullPaddingX - extraX, Math.floor(minY / th) - this.cullPaddingY, Math.floor(maxX / tw) + this.cullPaddingX, Math.floor(maxY / th) + this.cullPaddingY + extraY];
  }
  _renderGPU(r) { this._render(r, true); }
  _renderCanvas(r) { this._render(r, false); }
  _render(r, gpu) {
    var tm = this.tilemap, o = tm.orientation;
    if (this.worldTint !== this._pcT || this.worldAlpha !== this._pcA) { this._pcT = this.worldTint; this._pcA = this.worldAlpha; this._pc = packColor(this.worldTint, this.worldAlpha); }
    var time = r.time, W = this.layerWidth, H = this.layerHeight, sx = this.startX, sy = this.startY;
    var x0, y0, x1, y1;
    if (o === 'orthogonal') {
      var rg = this._viewTileRange(r.cullRect);
      x0 = Math.max(rg[0], sx); y0 = Math.max(rg[1], sy); x1 = Math.min(rg[2], sx + W - 1); y1 = Math.min(rg[3], sy + H - 1);
    } else { x0 = sx; y0 = sy; x1 = sx + W - 1; y1 = sy + H - 1; }
    var drawn = 0, ctxMode = !gpu;
    if (ctxMode) { r._style(this); }
    for (var ty = y0; ty <= y1; ty++) {
      var row = (ty - sy) * W;
      for (var tx = x0; tx <= x1; tx++) {
        var raw = this.tileData[row + (tx - sx)];
        if (raw === 0) continue;
        var gid = raw & TILE_GID_MASK; if (!gid) continue;
        var ts = tm.tilesetForGid(gid); if (!ts) continue;
        var local = gid - ts.firstgid;
        if (ts.anims.size) local = ts.animFrame(local, time);
        var tex = null, u0, v0, u1, v1, src;
        if (ts.collection) {
          tex = ts.getTileTexture(local, tm._textures()); if (!tex) continue;
          src = tex.source; u0 = tex.uvs[0]; v0 = tex.uvs[1]; u1 = tex.uvs[4]; v1 = tex.uvs[5];
        } else {
          if (!ts.texture || !ts.uvs || local >= ts.tileCount) continue;
          src = ts.texture.source; var ui = local * 4, uv = ts.uvs; u0 = uv[ui]; v0 = uv[ui + 1]; u1 = uv[ui + 2]; v1 = uv[ui + 3];
        }
        var tw = tex ? tex.width : ts.tileWidth, th = tex ? tex.height : ts.tileHeight;
        var pos = o === 'orthogonal' ? null : this._tilePos(tx, ty);
        var px = (pos ? pos.x : tx * this.tileWidth) + ts.offsetX;
        var py = (pos ? pos.y : ty * this.tileHeight) + this.tileHeight - th + ts.offsetY;
        if (o === 'isometric') px += (this.tileWidth - tw) / 2;
        // uv por esquina con volteos (D, luego H, luego V)
        var tlu = u0, tlv = v0, tru = u1, trv = v0, bru = u1, brv = v1, blu = u0, blv = v1, t1, t2;
        if (raw & TILE_FLIP_D) { t1 = tru; t2 = trv; tru = blu; trv = blv; blu = t1; blv = t2; }
        if (raw & TILE_FLIP_H) { t1 = tlu; t2 = tlv; tlu = tru; tlv = trv; tru = t1; trv = t2; t1 = blu; t2 = blv; blu = bru; blv = brv; bru = t1; brv = t2; }
        if (raw & TILE_FLIP_V) { t1 = tlu; t2 = tlv; tlu = blu; tlv = blv; blu = t1; blv = t2; t1 = tru; t2 = trv; tru = bru; trv = brv; bru = t1; brv = t2; }
        var wt = this.worldTransform, a = wt.a, b = wt.b, c = wt.c, d = wt.d, ex = wt.tx, ey = wt.ty;
        var qx0 = px, qy0 = py, qx1 = px + tw, qy1 = py + th;
        QV[0] = a * qx0 + c * qy0 + ex; QV[1] = b * qx0 + d * qy0 + ey;
        QV[2] = a * qx1 + c * qy0 + ex; QV[3] = b * qx1 + d * qy0 + ey;
        QV[4] = a * qx1 + c * qy1 + ex; QV[5] = b * qx1 + d * qy1 + ey;
        QV[6] = a * qx0 + c * qy1 + ex; QV[7] = b * qx0 + d * qy1 + ey;
        if (o !== 'orthogonal' && r.cull && quadOutside(QV, r.cullRect)) continue;
        if (gpu) {
          QUV[0] = tlu; QUV[1] = tlv; QUV[2] = tru; QUV[3] = trv; QUV[4] = bru; QUV[5] = brv; QUV[6] = blu; QUV[7] = blv;
          r.batcher.pushQuad(src, QV, QUV, this._pc, this.worldBlend);
        } else this._drawTileCanvas(r, src, u0, v0, u1, v1, raw, qx0, qy0, tw, th);
        drawn++;
      }
    }
    this.tilesDrawn = drawn;
  }
  _drawTileCanvas(r, src, u0, v0, u1, v1, raw, x, y, w, h) {
    var img = r._drawable(src); if (!img) return;
    var wt = this.worldTransform, sw = src.width, sh = src.height;
    var fx = u0 * sw, fy = v0 * sh, fw = (u1 - u0) * sw, fh = (v1 - v0) * sh;
    var m = _tmpMatrix.copyFrom(wt);
    var cx = x + w / 2, cy = y + h / 2;
    var la = 1, lb = 0, lc = 0, ld = 1;
    if (raw & TILE_FLIP_D) { la = 0; lb = 1; lc = 1; ld = 0; }
    if (raw & TILE_FLIP_H) { la = -la; lb = -lb; }
    if (raw & TILE_FLIP_V) { lc = -lc; ld = -ld; }
    var loc = _tmpMatrix2.set(la, lb, lc, ld, cx, cy);
    m.append(loc);
    var ctx = r.ctx;
    r._setT(m);
    if (this.worldTint !== 0xffffff) { var tc = r._tinted(src, fx, fy, fw, fh, this.worldTint); if (tc) ctx.drawImage(tc, 0, 0, tc.width, tc.height, -w / 2, -h / 2, w, h); }
    else ctx.drawImage(img, fx, fy, fw, fh, -w / 2, -h / 2, w, h);
    r.stats.drawCalls++;
  }
  _addSelfBounds(b) {
    var tm = this.tilemap;
    b.addRect(this.startX * this.tileWidth, this.startY * this.tileHeight, (this.startX + this.layerWidth) * this.tileWidth, (this.startY + this.layerHeight) * this.tileHeight, this.worldTransform);
    void tm;
  }
  _hitTestSelf(lx, ly) { return lx >= 0 && ly >= 0 && lx < this.widthInPixels && ly < this.heightInPixels; }
  _onDestroy() { removeFromArray(this.tilemap.layers, this); this.tileData = null; this.collisionFlags = null; }
}

UG.TiledParser = TiledParser;
UG.Tilemap = Tilemap;
UG.TilemapLayer = TilemapLayer;
UG.Tile = Tile;
UG.TilesetRuntime = TilesetRuntime;
