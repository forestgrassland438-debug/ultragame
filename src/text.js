/* UltraGame - texto: Text (render a canvas, nítido a cualquier resolución) y BitmapText (fuentes bitmap). */

var GENERIC_FONTS = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong'];

var TEXT_DEFAULTS = {
  fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 26, fontWeight: 'normal', fontStyle: 'normal', fontVariant: 'normal',
  fill: 0xffffff, fillGradientStops: null, stroke: 0x000000, strokeThickness: 0, lineJoin: 'round', miterLimit: 10,
  align: 'left', wordWrap: false, wordWrapWidth: 300, breakWords: false, lineHeight: 0, leading: 0, letterSpacing: 0,
  padding: 0, dropShadow: null, backgroundColor: null, backgroundAlpha: 1, maxLines: 0, fixedWidth: 0, fixedHeight: 0,
  resolution: 0, trim: false
};

function normalizeTextStyle(style) {
  style = style || {};
  var s = {};
  for (var k in TEXT_DEFAULTS) s[k] = TEXT_DEFAULTS[k];
  var keys = Object.keys(style);
  for (var i = 0; i < keys.length; i++) { var key = keys[i]; if (!isForbiddenKey(key)) s[key] = style[key]; }
  // Alias estilo Phaser
  if (style.font && typeof style.font === 'string') {
    var m = /(\d+(?:\.\d+)?)px\s+(.+)$/.exec(style.font);
    if (m) { s.fontSize = parseFloat(m[1]); s.fontFamily = m[2]; }
    if (/bold/.test(style.font)) s.fontWeight = 'bold';
    if (/italic/.test(style.font)) s.fontStyle = 'italic';
  }
  if (style.color !== undefined && style.fill === undefined) s.fill = style.color;
  if (typeof s.fontSize === 'string') s.fontSize = parseFloat(s.fontSize) || 26;
  if (style.stroke && typeof style.stroke === 'object' && !Array.isArray(style.stroke)) {
    s.strokeThickness = style.stroke.width !== undefined ? style.stroke.width : 2; s.stroke = style.stroke.color !== undefined ? style.stroke.color : 0;
  }
  if (style.shadow && !style.dropShadow) {
    var sh = style.shadow;
    s.dropShadow = { color: sh.color || '#000', blur: sh.blur || 0, offsetX: sh.offsetX || 0, offsetY: sh.offsetY || 0, alpha: sh.alpha !== undefined ? sh.alpha : 1 };
  } else if (style.dropShadow === true) {
    s.dropShadow = { color: '#000', blur: 4, offsetX: 3, offsetY: 3, alpha: 0.8 };
  } else if (style.dropShadow && typeof style.dropShadow === 'object') {
    var d = style.dropShadow, dist = d.distance !== undefined ? d.distance : 4, ang = d.angle !== undefined ? d.angle : Math.PI / 6;
    s.dropShadow = { color: d.color !== undefined ? d.color : '#000', blur: d.blur || 0, offsetX: d.offsetX !== undefined ? d.offsetX : Math.cos(ang) * dist, offsetY: d.offsetY !== undefined ? d.offsetY : Math.sin(ang) * dist, alpha: d.alpha !== undefined ? d.alpha : 1 };
  }
  if (style.wordWrap && typeof style.wordWrap === 'object') { s.wordWrapWidth = style.wordWrap.width || s.wordWrapWidth; s.wordWrap = true; s.breakWords = !!style.wordWrap.useAdvancedWrap || s.breakWords; }
  if (style.lineSpacing !== undefined) s.leading = style.lineSpacing;
  return s;
}
function fontString(s) {
  var fam = String(s.fontFamily).split(',').map(function (f) {
    f = f.trim();
    if (!f) return '';
    if (/^["']/.test(f) || GENERIC_FONTS.indexOf(f.toLowerCase()) >= 0 || !/[\s\d]/.test(f)) return f;
    return '"' + f.replace(/["\\]/g, '') + '"';
  }).filter(Boolean).join(', ');
  return s.fontStyle + ' ' + s.fontVariant + ' ' + s.fontWeight + ' ' + s.fontSize + 'px ' + fam;
}

var TextMetrics = {
  _canvas: null, _ctx: null, _fontCache: new Map(),
  ctx: function () {
    if (!this._ctx) { this._canvas = createCanvas(16, 16); this._ctx = this._canvas.getContext('2d'); }
    return this._ctx;
  },
  measureFont: function (font, fontSize) {
    var c = this._fontCache.get(font); if (c) return c;
    var ctx = this.ctx(); ctx.font = font;
    var m = ctx.measureText('|ÉqÅgjy');
    var ascent = m.fontBoundingBoxAscent || m.actualBoundingBoxAscent || fontSize * 0.8;
    var descent = m.fontBoundingBoxDescent || m.actualBoundingBoxDescent || fontSize * 0.2;
    if (!(ascent > 0)) ascent = fontSize * 0.8;
    if (!(descent >= 0)) descent = fontSize * 0.2;
    c = { ascent: ascent, descent: descent, fontSize: ascent + descent };
    if (this._fontCache.size > 256) this._fontCache.clear();
    this._fontCache.set(font, c);
    return c;
  },
  width: function (text, font, letterSpacing) {
    var ctx = this.ctx(); ctx.font = font;
    var w = ctx.measureText(text).width;
    if (letterSpacing) w += letterSpacing * Math.max(0, Array.from(text).length - 1);
    return w;
  },
  wrap: function (text, font, maxWidth, letterSpacing, breakWords) {
    var self = this, out = [];
    var paras = text.split(/\r?\n/);
    for (var p = 0; p < paras.length; p++) {
      var words = paras[p].split(/( +)/), line = '';
      for (var i = 0; i < words.length; i++) {
        var wd = words[i]; if (wd === '') continue;
        var test = line + wd;
        if (self.width(test, font, letterSpacing) <= maxWidth || line === '') {
          if (line === '' && self.width(wd, font, letterSpacing) > maxWidth && breakWords && /\S/.test(wd)) {
            var chars = Array.from(wd), cur = '';
            for (var c = 0; c < chars.length; c++) {
              if (self.width(cur + chars[c], font, letterSpacing) > maxWidth && cur) { out.push(cur); cur = chars[c]; }
              else cur += chars[c];
            }
            line = cur;
          } else line = test;
        } else {
          out.push(line.replace(/ +$/, ''));
          line = /^ +$/.test(wd) ? '' : wd;
          if (breakWords && self.width(line, font, letterSpacing) > maxWidth) {
            var chs = Array.from(line), cr = '';
            for (var k = 0; k < chs.length; k++) {
              if (self.width(cr + chs[k], font, letterSpacing) > maxWidth && cr) { out.push(cr); cr = chs[k]; }
              else cr += chs[k];
            }
            line = cr;
          }
        }
      }
      out.push(line.replace(/ +$/, ''));
    }
    return out;
  }
};

function cssColor(v, alpha) {
  if (typeof v === 'string' && !/^(#|0x|rgb|hsl)/i.test(v.trim()) && !(v.trim().toLowerCase() in NAMED_COLORS)) return 'rgba(255,255,255,1)';
  return Color.toCSS(Color.toNumber(v), alpha === undefined ? Color.alphaOf(v) : alpha);
}

/* ========================================================================= Text */
class Text extends Sprite {
  constructor(x, y, text, style) {
    if (typeof x !== 'number') { style = y; text = x; x = 0; y = 0; }
    super(x, y);
    this.type = 'Text';
    this.anchorX = 0; this.anchorY = 0;
    this._text = '';
    this._style = normalizeTextStyle(style);
    this._canvas = createCanvas(4, 4);
    // canvas en CPU: los textos cambian a menudo y leer sus píxeles para subirlos es mucho más barato así
    this._ctx = this._canvas.getContext('2d', { willReadFrequently: true }) || this._canvas.getContext('2d');
    this._source = new TextureSource(this._canvas, { label: 'Text', dynamic: true });
    this._texture = new Texture(this._source);
    this._res = 1;
    this._dirty = true;
    this.lines = [];
    this.text = text === undefined ? '' : text;
  }
  get text() { return this._text; }
  set text(v) {
    v = v === undefined || v === null ? '' : String(v);
    if (v.length > Security.maxTextLength) v = v.slice(0, Security.maxTextLength);
    if (v !== this._text) { this._text = v; this._dirty = true; }
  }
  get style() { return this._style; }
  set style(s) { this._style = normalizeTextStyle(s); this._dirty = true; }
  setText(v) { this.text = Array.isArray(v) ? v.join('\n') : v; return this; }
  setStyle(s) { var merged = Object.assign({}, this._style, s || {}); if (s && s.fill === undefined && s.color !== undefined) merged.fill = s.color; this._style = normalizeTextStyle(merged); this._dirty = true; return this; }
  setFontSize(size) { return this.setStyle({ fontSize: size }); }
  setFontFamily(f) { return this.setStyle({ fontFamily: f }); }
  setColor(c) { return this.setStyle({ fill: c }); }
  setFill(c) { return this.setStyle({ fill: c }); }
  setStroke(color, thickness) { return this.setStyle({ stroke: color, strokeThickness: thickness }); }
  setShadow(offsetX, offsetY, color, blur) { return this.setStyle({ dropShadow: { offsetX: offsetX || 0, offsetY: offsetY || 0, color: color || '#000', blur: blur || 0 } }); }
  setAlign(a) { return this.setStyle({ align: a }); }
  setWordWrapWidth(w) { return this.setStyle({ wordWrap: !!w, wordWrapWidth: w || 300 }); }
  setPadding(p) { return this.setStyle({ padding: p }); }
  setResolution(r) { return this.setStyle({ resolution: r }); }
  setLetterSpacing(v) { return this.setStyle({ letterSpacing: v }); }
  setLineSpacing(v) { return this.setStyle({ leading: v }); }
  setBackgroundColor(c) { return this.setStyle({ backgroundColor: c }); }
  get width() { this.updateText(); return Math.abs(this.scaleX) * this._texture.width; }
  set width(v) { this.updateText(); var w = this._texture.width; this.scaleX = w ? v / w : 1; }
  get height() { this.updateText(); return Math.abs(this.scaleY) * this._texture.height; }
  set height(v) { this.updateText(); var h = this._texture.height; this.scaleY = h ? v / h : 1; }
  setTexture() { return this; }

  /** Re-renderiza el canvas si el texto o el estilo cambiaron. */
  updateText(resolution) {
    var s = this._style;
    var res = s.resolution || resolution || this._res || 1;
    if (!this._dirty && res === this._res) return this;
    this._res = res;
    var font = fontString(s), metrics = TextMetrics.measureFont(font, s.fontSize);
    var ls = +s.letterSpacing || 0;
    var lines = s.wordWrap ? TextMetrics.wrap(this._text, font, s.wordWrapWidth, ls, s.breakWords) : this._text.split(/\r?\n/);
    if (s.maxLines > 0 && lines.length > s.maxLines) lines.length = s.maxLines;
    this.lines = lines;
    var lineWidths = [], maxW = 0;
    for (var i = 0; i < lines.length; i++) { var lw = TextMetrics.width(lines[i], font, ls); lineWidths.push(lw); if (lw > maxW) maxW = lw; }
    var st = +s.strokeThickness || 0;
    var lineHeight = (s.lineHeight || metrics.fontSize) + st;
    var leading = +s.leading || 0;
    var sh = s.dropShadow, shX = sh ? Math.abs(sh.offsetX) + sh.blur * 2 : 0, shY = sh ? Math.abs(sh.offsetY) + sh.blur * 2 : 0;
    var pad = (+s.padding || 0) + (sh ? sh.blur : 0);
    var contentW = maxW + st, contentH = lineHeight * lines.length + leading * Math.max(0, lines.length - 1) + (s.lineHeight ? 0 : 0);
    if (!lines.length || (lines.length === 1 && lines[0] === '')) contentW = Math.max(contentW, 1);
    var W = Math.max(1, (s.fixedWidth || contentW) + pad * 2 + shX), H = Math.max(1, (s.fixedHeight || contentH) + pad * 2 + shY);
    var maxDim = Security.maxTextureSize;
    if (W * res > maxDim || H * res > maxDim) { var fit = Math.min(maxDim / (W * res), maxDim / (H * res)); res = Math.max(0.1, res * fit); Log.warnOnce('textsize', 'Texto demasiado grande; se reduce su resolución'); }
    var cw = Math.max(1, Math.ceil(W * res)), ch = Math.max(1, Math.ceil(H * res));
    // capacidad en pasos de 32 px: si el texto cambia un poco de tamaño (marcadores, contadores) se reutiliza
    // la misma textura de GPU y solo se vuelve a subir su contenido (recrearla es caro, sobre todo en WebGPU)
    var canvas = this._canvas, ctx = this._ctx, capW = canvas.width, capH = canvas.height;
    if (cw > capW || ch > capH || capW > cw * 2 + 64 || capH > ch * 2 + 64) {
      capW = Math.min(maxDim, Math.ceil(cw / 32) * 32); capH = Math.min(maxDim, Math.ceil(ch / 32) * 32);
      canvas.width = capW; canvas.height = capH;
    } else ctx.clearRect(0, 0, capW, capH);
    ctx.setTransform(res, 0, 0, res, 0, 0);
    if (s.backgroundColor !== null && s.backgroundColor !== undefined) {
      ctx.fillStyle = cssColor(s.backgroundColor, s.backgroundAlpha);
      ctx.fillRect(0, 0, W, H);
    }
    ctx.font = font;
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = s.lineJoin; ctx.miterLimit = s.miterLimit;
    var useNativeLS = ls !== 0 && ('letterSpacing' in ctx);
    if ('letterSpacing' in ctx) ctx.letterSpacing = useNativeLS ? ls + 'px' : '0px';
    var fillStyle;
    if (Array.isArray(s.fill)) {
      var grad = ctx.createLinearGradient(0, pad, 0, pad + contentH);
      var stops = s.fillGradientStops || s.fill.map(function (_, k) { return s.fill.length > 1 ? k / (s.fill.length - 1) : 0; });
      for (var g = 0; g < s.fill.length; g++) grad.addColorStop(clamp(+stops[g] || 0, 0, 1), cssColor(s.fill[g]));
      fillStyle = grad;
    } else fillStyle = cssColor(s.fill);
    var baseX = pad + st / 2 + (sh && sh.offsetX < 0 ? -sh.offsetX + sh.blur : 0);
    var baseY = pad + st / 2 + (sh && sh.offsetY < 0 ? -sh.offsetY + sh.blur : 0);
    var areaW = s.fixedWidth ? s.fixedWidth - st : maxW;
    var self = this;
    var drawLine = function (txt, x, y, mode) {
      if (!useNativeLS && ls !== 0) {
        var chars = Array.from(txt), cx = x;
        for (var c = 0; c < chars.length; c++) {
          if (mode === 1) ctx.strokeText(chars[c], cx, y); else ctx.fillText(chars[c], cx, y);
          cx += ctx.measureText(chars[c]).width + ls;
        }
      } else if (mode === 1) ctx.strokeText(txt, x, y); else ctx.fillText(txt, x, y);
    };
    var passes = sh ? [true, false] : [false];
    for (var pIdx = 0; pIdx < passes.length; pIdx++) {
      var shadowPass = passes[pIdx];
      if (shadowPass) {
        ctx.shadowColor = cssColor(sh.color, sh.alpha); ctx.shadowBlur = sh.blur * res;
        ctx.shadowOffsetX = sh.offsetX * res; ctx.shadowOffsetY = sh.offsetY * res;
      } else { ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }
      for (var li = 0; li < lines.length; li++) {
        var lx = baseX, lwid = lineWidths[li];
        if (s.align === 'center') lx += (areaW - lwid) / 2;
        else if (s.align === 'right') lx += areaW - lwid;
        var ly = baseY + li * (lineHeight + leading) + metrics.ascent + (lineHeight - st - metrics.fontSize) / 2;
        if (st > 0) { ctx.strokeStyle = cssColor(s.stroke); ctx.lineWidth = st; drawLine(lines[li], lx, ly, 1); }
        if (s.fill !== null && s.fill !== undefined) { ctx.fillStyle = fillStyle; drawLine(lines[li], lx, ly, 0); }
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this._source.resolution = res;
    this._source.resize(capW, capH);
    this._source.update();
    this._texture.frame.set(0, 0, cw, ch);
    this._texture.orig.set(0, 0, cw, ch);
    this._texture.updateUvs();
    this._dirty = false;
    self._layoutW = W; self._layoutH = H;
    return this;
  }
  _renderGPU(r) { this.updateText(r.resolution); super._renderGPU(r); }
  _renderCanvas(r) { this.updateText(r.resolution); super._renderCanvas(r); }
  _addSelfBounds(b) { this.updateText(); super._addSelfBounds(b); }
  _hitTestSelf(lx, ly) { this.updateText(); return super._hitTestSelf(lx, ly); }
  _onDestroy() {
    super._onDestroy();
    if (this._source) this._source.destroy();
    releaseCanvas(this._canvas);
    this._canvas = null; this._ctx = null; this._source = null;
  }
}

/* =================================================================== BitmapFont */
var DEFAULT_BITMAP_CHARS = (function () {
  var s = ''; for (var i = 32; i < 127; i++) s += String.fromCharCode(i);
  return s + 'ñÑáéíóúÁÉÍÓÚüÜ¿¡€°·çÇàèìòùâêîôûäëïöÿ♥★☆♦♣♠•→←↑↓✓✗…×÷±';
})();

class BitmapFont {
  constructor(name, data) {
    this.name = name;
    this.size = data.size;
    this.lineHeight = data.lineHeight;
    this.base = data.base || data.lineHeight;
    this.chars = data.chars;
    this.pages = data.pages || [];
    this.distanceField = null;
  }
  getChar(code) { return this.chars.get(code) || this.chars.get(63) || null; }
  destroy() { for (var i = 0; i < this.pages.length; i++) this.pages[i].destroy(); this.pages.length = 0; this.chars.clear(); }

  /** Genera una fuente bitmap dinámica a partir de una fuente del sistema/web y un estilo. */
  static from(name, style, options) {
    options = options || {};
    var s = normalizeTextStyle(style || {});
    var res = options.resolution || 2, padding = options.padding !== undefined ? options.padding : 4;
    var chars = Array.from(options.chars || DEFAULT_BITMAP_CHARS);
    var font = fontString(s), metrics = TextMetrics.measureFont(font, s.fontSize);
    var st = +s.strokeThickness || 0, sh = s.dropShadow;
    var extra = st + (sh ? sh.blur * 2 + Math.max(Math.abs(sh.offsetX), Math.abs(sh.offsetY)) : 0);
    var lineH = Math.ceil(metrics.fontSize + st);
    var cellH = Math.ceil(lineH + padding * 2 + extra);
    var texSize = options.textureSize || 1024;
    var pages = [], charMap = new Map();
    var canvas = null, ctx = null, px = 0, py = 0, rowH = 0;
    var newPage = function () {
      canvas = createCanvas(texSize * res, texSize * res); ctx = canvas.getContext('2d');
      ctx.scale(res, res); ctx.font = font; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
      pages.push({ canvas: canvas, source: null }); px = 0; py = 0; rowH = 0;
    };
    newPage();
    var fillStyle = null;
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i], w = TextMetrics.width(ch, font, 0);
      var cellW = Math.ceil(w + padding * 2 + extra);
      if (px + cellW > texSize) { px = 0; py += rowH; rowH = 0; }
      if (py + cellH > texSize) newPage();
      if (!fillStyle || pages.length) {
        if (Array.isArray(s.fill)) {
          var gr = ctx.createLinearGradient(0, py + padding, 0, py + padding + lineH);
          for (var g = 0; g < s.fill.length; g++) gr.addColorStop(s.fill.length > 1 ? g / (s.fill.length - 1) : 0, cssColor(s.fill[g]));
          fillStyle = gr;
        } else fillStyle = cssColor(s.fill);
      }
      var dx = px + padding + st / 2, dy = py + padding + st / 2 + metrics.ascent;
      if (sh) {
        ctx.save(); ctx.shadowColor = cssColor(sh.color, sh.alpha); ctx.shadowBlur = sh.blur * res; ctx.shadowOffsetX = sh.offsetX * res; ctx.shadowOffsetY = sh.offsetY * res;
        ctx.fillStyle = fillStyle; ctx.fillText(ch, dx, dy); ctx.restore();
      }
      if (st > 0) { ctx.strokeStyle = cssColor(s.stroke); ctx.lineWidth = st; ctx.strokeText(ch, dx, dy); }
      ctx.fillStyle = fillStyle; ctx.fillText(ch, dx, dy);
      charMap.set(ch.codePointAt(0), { page: pages.length - 1, x: px, y: py, w: cellW, h: cellH, xOffset: -padding - st / 2, yOffset: -padding - st / 2, xAdvance: w, kerning: null });
      px += cellW; if (cellH > rowH) rowH = cellH;
    }
    var sources = pages.map(function (p) { var src = new TextureSource(p.canvas, { resolution: res, label: 'BitmapFont:' + name }); p.source = src; return src; });
    var map = new Map();
    charMap.forEach(function (c, code) {
      var src = sources[c.page];
      c.texture = new Texture(src, new Rectangle(c.x * res, c.y * res, Math.max(1, c.w * res), Math.max(1, c.h * res)));
      map.set(code, c);
    });
    var f = new BitmapFont(name, { size: s.fontSize, lineHeight: lineH, base: metrics.ascent, chars: map, pages: sources });
    BitmapFont.install(name, f);
    return f;
  }
  /** Parsea un BMFont (.fnt en texto o XML) con sus texturas de página (Texture o TextureSource). */
  static parse(name, fntData, pageTextures) {
    var info = { size: 32, lineHeight: 32, base: 26, pages: [], chars: [], kernings: [] };
    var text = typeof fntData === 'string' ? fntData : '';
    var xml = null;
    if (typeof fntData !== 'string' && fntData && fntData.getElementsByTagName) xml = fntData;
    else if (/^\s*<\?xml|^\s*<font/.test(text) && typeof DOMParser !== 'undefined') xml = new DOMParser().parseFromString(text, 'application/xml');
    if (xml) {
      var gi = function (el, a) { return parseInt(el.getAttribute(a), 10) || 0; };
      var infoEl = xml.getElementsByTagName('info')[0], common = xml.getElementsByTagName('common')[0];
      if (infoEl) info.size = Math.abs(gi(infoEl, 'size')) || 32;
      if (common) { info.lineHeight = gi(common, 'lineHeight'); info.base = gi(common, 'base'); }
      var chs = xml.getElementsByTagName('char');
      for (var i = 0; i < chs.length; i++) { var c = chs[i]; info.chars.push({ id: gi(c, 'id'), x: gi(c, 'x'), y: gi(c, 'y'), width: gi(c, 'width'), height: gi(c, 'height'), xoffset: gi(c, 'xoffset'), yoffset: gi(c, 'yoffset'), xadvance: gi(c, 'xadvance'), page: gi(c, 'page') }); }
      var ks = xml.getElementsByTagName('kerning');
      for (var k = 0; k < ks.length; k++) info.kernings.push({ first: gi(ks[k], 'first'), second: gi(ks[k], 'second'), amount: gi(ks[k], 'amount') });
    } else {
      var lines = text.split(/\r?\n/);
      var attrs = function (line) { var o = {}; var re = /(\w+)=("[^"]*"|\S+)/g, m; while ((m = re.exec(line))) { if (!isForbiddenKey(m[1])) o[m[1]] = m[2].replace(/^"|"$/g, ''); } return o; };
      for (var l = 0; l < lines.length; l++) {
        var ln = lines[l], tag = ln.split(/\s+/)[0], a = attrs(ln);
        if (tag === 'info') info.size = Math.abs(parseInt(a.size, 10)) || 32;
        else if (tag === 'common') { info.lineHeight = parseInt(a.lineHeight, 10) || 32; info.base = parseInt(a.base, 10) || 26; }
        else if (tag === 'char') info.chars.push({ id: +a.id, x: +a.x, y: +a.y, width: +a.width, height: +a.height, xoffset: +a.xoffset, yoffset: +a.yoffset, xadvance: +a.xadvance, page: +a.page || 0 });
        else if (tag === 'kerning') info.kernings.push({ first: +a.first, second: +a.second, amount: +a.amount });
      }
    }
    var pages = (Array.isArray(pageTextures) ? pageTextures : [pageTextures]).map(function (t) { return t instanceof Texture ? t : new Texture(t); });
    var map = new Map();
    for (var j = 0; j < info.chars.length; j++) {
      var cd = info.chars[j], pg = pages[cd.page] || pages[0];
      if (!pg) continue;
      var fr = pg.frame;
      var tex = cd.width > 0 && cd.height > 0 ? new Texture(pg.source, new Rectangle(fr.x + cd.x, fr.y + cd.y, cd.width, cd.height)) : null;
      map.set(cd.id, { texture: tex, xOffset: cd.xoffset, yOffset: cd.yoffset, xAdvance: cd.xadvance, kerning: null, w: cd.width, h: cd.height });
    }
    for (var q = 0; q < info.kernings.length; q++) {
      var kr = info.kernings[q], target = map.get(kr.second);
      if (target) { if (!target.kerning) target.kerning = new Map(); target.kerning.set(kr.first, kr.amount); }
    }
    var f = new BitmapFont(name, { size: info.size, lineHeight: info.lineHeight, base: info.base, chars: map, pages: [] });
    BitmapFont.install(name, f);
    return f;
  }
  static install(name, font) { var old = BitmapFont.registry.get(name); if (old && old !== font) old.destroy(); BitmapFont.registry.set(name, font); return font; }
  static uninstall(name) { var f = BitmapFont.registry.get(name); if (f) { f.destroy(); BitmapFont.registry.delete(name); } }
  static get(name) { return BitmapFont.registry.get(name) || null; }
}
BitmapFont.registry = new Map();

/* =================================================================== BitmapText
 * Texto ultrarrápido (marcadores, HUD que cambia cada frame): cada letra es un quad batcheado. */
class BitmapText extends Container {
  constructor(x, y, font, text, size, align) {
    super(x, y);
    this.type = 'BitmapText';
    this._fontName = font;
    this._text = '';
    this._size = size || 0;
    this._align = align || 'left';
    this.anchorX = 0; this.anchorY = 0;
    this.letterSpacing = 0;
    this.maxWidth = 0;
    this.lineSpacing = 0;
    this._glyphs = [];
    this._dirty = true;
    this._w = 0; this._h = 0;
    this._pcT = -1; this._pcA = -1; this._pc = 0;
    this.text = text === undefined ? '' : text;
  }
  get font() { return BitmapFont.get(this._fontName); }
  get text() { return this._text; }
  set text(v) { v = v === undefined || v === null ? '' : String(v); if (v.length > Security.maxTextLength) v = v.slice(0, Security.maxTextLength); if (v !== this._text) { this._text = v; this._dirty = true; } }
  get fontSize() { var f = this.font; return this._size || (f ? f.size : 32); }
  set fontSize(v) { this._size = v; this._dirty = true; }
  get align() { return this._align; }
  set align(v) { this._align = v; this._dirty = true; }
  setText(v) { this.text = v; return this; }
  setFont(name, size) { this._fontName = name; if (size) this._size = size; this._dirty = true; return this; }
  setFontSize(s) { this.fontSize = s; return this; }
  setLetterSpacing(v) { this.letterSpacing = v; this._dirty = true; return this; }
  setMaxWidth(w) { this.maxWidth = w; this._dirty = true; return this; }
  setCenterAlign() { this.align = 'center'; return this; }
  setOrigin(x, y) { this.anchorX = x; this.anchorY = y === undefined ? x : y; return this; }
  setAnchor(x, y) { return this.setOrigin(x, y); }
  get textWidth() { this._layout(); return this._w; }
  get textHeight() { this._layout(); return this._h; }
  get width() { this._layout(); return this._w * Math.abs(this.scaleX); }
  get height() { this._layout(); return this._h * Math.abs(this.scaleY); }
  _layout() {
    var font = this.font;
    if (!font) { if (this._text) Log.warnOnce('bmfont:' + this._fontName, 'BitmapFont "' + this._fontName + '" no instalada'); this._glyphs.length = 0; this._w = this._h = 0; return; }
    if (!this._dirty && this._layoutFont === font) return;
    this._layoutFont = font;
    var scale = this.fontSize / font.size, glyphs = this._glyphs; glyphs.length = 0;
    var lineH = font.lineHeight * scale + this.lineSpacing;
    var chars = Array.from(this._text), penX = 0, penY = 0, lineStart = 0, lineWidths = [], prev = -1;
    var lastSpace = -1, lastSpaceX = 0;
    for (var i = 0; i < chars.length; i++) {
      var code = chars[i].codePointAt(0);
      if (code === 10) { lineWidths.push(penX); penX = 0; penY += lineH; prev = -1; lastSpace = -1; lineStart = glyphs.length; continue; }
      if (code === 13) continue;
      var c = font.getChar(code); if (!c) continue;
      if (prev >= 0 && c.kerning && c.kerning.has(prev)) penX += c.kerning.get(prev) * scale;
      if (code === 32) { lastSpace = glyphs.length; lastSpaceX = penX; }
      if (c.texture) glyphs.push({ tex: c.texture, x: penX + c.xOffset * scale, y: penY + c.yOffset * scale, w: c.texture.width * scale, h: c.texture.height * scale, line: lineWidths.length });
      penX += c.xAdvance * scale + this.letterSpacing;
      prev = code;
      if (this.maxWidth > 0 && penX > this.maxWidth && lastSpace >= 0) {
        // Salto de línea en el último espacio
        var shift = glyphs[lastSpace] ? glyphs[lastSpace].x : lastSpaceX;
        var spaceAdv = (font.getChar(32) ? font.getChar(32).xAdvance * scale : 0) + this.letterSpacing;
        lineWidths.push(lastSpaceX);
        penY += lineH;
        for (var g = lastSpace; g < glyphs.length; g++) { glyphs[g].x -= lastSpaceX + spaceAdv; glyphs[g].y += lineH; glyphs[g].line = lineWidths.length; }
        penX -= lastSpaceX + spaceAdv; lastSpace = -1;
        if (shift < 0) shift = 0;
      }
    }
    lineWidths.push(penX);
    var maxW = 0; for (var l = 0; l < lineWidths.length; l++) if (lineWidths[l] > maxW) maxW = lineWidths[l];
    if (this._align !== 'left') {
      for (var k = 0; k < glyphs.length; k++) {
        var gl = glyphs[k], lw = lineWidths[gl.line] || 0;
        gl.x += this._align === 'center' ? (maxW - lw) / 2 : (maxW - lw);
      }
    }
    this._w = maxW; this._h = (lineWidths.length) * lineH - this.lineSpacing;
    this._dirty = false;
  }
  _renderGPU(r) {
    this._layout();
    var gs = this._glyphs; if (!gs.length) return;
    var wt = this.worldTransform, a = wt.a, b = wt.b, c = wt.c, d = wt.d, tx = wt.tx, ty = wt.ty;
    var ox = -this.anchorX * this._w, oy = -this.anchorY * this._h;
    if (this.worldTint !== this._pcT || this.worldAlpha !== this._pcA) { this._pcT = this.worldTint; this._pcA = this.worldAlpha; this._pc = packColor(this.worldTint, this.worldAlpha); }
    var color = this._pc, blend = this.worldBlend;
    for (var i = 0; i < gs.length; i++) {
      var g = gs[i], x0 = g.x + ox, y0 = g.y + oy, x1 = x0 + g.w, y1 = y0 + g.h;
      QV[0] = a * x0 + c * y0 + tx; QV[1] = b * x0 + d * y0 + ty;
      QV[2] = a * x1 + c * y0 + tx; QV[3] = b * x1 + d * y0 + ty;
      QV[4] = a * x1 + c * y1 + tx; QV[5] = b * x1 + d * y1 + ty;
      QV[6] = a * x0 + c * y1 + tx; QV[7] = b * x0 + d * y1 + ty;
      r.batcher.pushQuad(g.tex.source, QV, g.tex.uvs, color, blend);
    }
  }
  _renderCanvas(r) { this._layout(); r.drawBitmapText(this); }
  _addSelfBounds(b) { this._layout(); var ox = -this.anchorX * this._w, oy = -this.anchorY * this._h; if (this._w > 0) b.addRect(ox, oy, ox + this._w, oy + this._h, this.worldTransform); }
  _hitTestSelf(lx, ly) { this._layout(); var ox = -this.anchorX * this._w, oy = -this.anchorY * this._h; return lx >= ox && lx < ox + this._w && ly >= oy && ly < oy + this._h; }
  _onDestroy() { this._glyphs.length = 0; }
}

UG.Text = Text;
UG.TextMetrics = TextMetrics;
UG.BitmapFont = BitmapFont;
UG.BitmapText = BitmapText;
