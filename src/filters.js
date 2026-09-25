/* UltraGame - efectos (filtros de post-proceso) con shaders GLSL (WebGL) y WGSL (WebGPU).
 * Helpers disponibles en ambos: sampleTex(uv), sampleTex2(uv), luma(rgb), rand(v2), texel(),
 * pixelPos(coord) [px lógicos dentro del área], frameSize(), pxToUV(px). Parámetros: uP[i] / u.p[i].
 * uGlobal/u.glob = (tiempo s, resolución, x del área en mundo, y del área en mundo). */

// helper pxToUV añadido a los preludios
FILTER_FS_HEAD += 'vec2 pxToUV(vec2 p){ return p * uGlobal.y * uInputSize.zw; }\nconst float PI = 3.14159265;\n';
WGSL_FILTER_HEAD += 'fn pxToUV(p: vec2f) -> vec2f { return p * u.glob.y * u.inputSize.zw; }\nconst PI: f32 = 3.14159265;\n' +
  'fn gmod(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }\n';
FILTER_FS_HEAD += 'float gmod(float x, float y){ return mod(x, y); }\n';

function defParams(cls, spec) {
  // spec: { nombre: índice de componente (0..31) }
  Object.keys(spec).forEach(function (name) {
    var idx = spec[name];
    Object.defineProperty(cls.prototype, name, { get: function () { return this.uniforms[idx]; }, set: function (v) { this.uniforms[idx] = +v; }, configurable: true });
  });
}
function setColorParam(f, idx, color, alpha) {
  var c = Color.toNumber(color);
  f.uniforms[idx] = ((c >> 16) & 255) / 255; f.uniforms[idx + 1] = ((c >> 8) & 255) / 255; f.uniforms[idx + 2] = (c & 255) / 255;
  if (alpha !== undefined) f.uniforms[idx + 3] = alpha;
}
function getColorParam(f, idx) { var u = f.uniforms; return Color.fromRGB(u[idx] * 255, u[idx + 1] * 255, u[idx + 2] * 255); }
function opt(o, k, d) { return o && o[k] !== undefined ? o[k] : d; }

/* ================================================================ ColorMatrix */
class ColorMatrixFilter extends Filter {
  constructor(options) {
    super();
    this.matrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
    this._css = [];
    this.alpha = 1;
    this._load();
    if (options && options.matrix) this.setMatrix(options.matrix);
  }
  get alpha() { return this.uniforms[20]; }
  set alpha(v) { this.uniforms[20] = v; }
  _load() {
    var m = this.matrix, u = this.uniforms;
    for (var r = 0; r < 4; r++) { u[r * 4] = m[r * 5]; u[r * 4 + 1] = m[r * 5 + 1]; u[r * 4 + 2] = m[r * 5 + 2]; u[r * 4 + 3] = m[r * 5 + 3]; u[16 + r] = m[r * 5 + 4] / 255; }
    return this;
  }
  setMatrix(m) { this.matrix = m.slice(0, 20); this._css = []; return this._load(); }
  _apply(m, multiply, css) {
    if (multiply) { this.matrix = ColorMatrixFilter.multiply(m, this.matrix); if (css) this._css.push(css); else this._css = null; }
    else { this.matrix = m.slice(); this._css = css ? [css] : null; }
    return this._load();
  }
  static multiply(a, b) {
    var out = new Array(20);
    for (var r = 0; r < 4; r++) {
      for (var c = 0; c < 5; c++) {
        var v = a[r * 5] * b[c] + a[r * 5 + 1] * b[5 + c] + a[r * 5 + 2] * b[10 + c] + a[r * 5 + 3] * b[15 + c];
        if (c === 4) v += a[r * 5 + 4];
        out[r * 5 + c] = v;
      }
    }
    return out;
  }
  reset() { this._css = []; return this.setMatrix([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]); }
  brightness(b, multiply) { return this._apply([b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0], multiply, 'brightness(' + b + ')'); }
  grayscale(scale, multiply) { scale = scale === undefined ? 1 : scale; var s = 1 - scale, r = 0.3 * scale, g = 0.59 * scale, b = 0.11 * scale; return this._apply([r + s, g, b, 0, 0, r, g + s, b, 0, 0, r, g, b + s, 0, 0, 0, 0, 0, 1, 0], multiply, 'grayscale(' + scale + ')'); }
  greyscale(scale, multiply) { return this.grayscale(scale, multiply); }
  blackAndWhite(multiply) { return this._apply([0.3, 0.6, 0.1, 0, 0, 0.3, 0.6, 0.1, 0, 0, 0.3, 0.6, 0.1, 0, 0, 0, 0, 0, 1, 0], multiply, 'grayscale(1)'); }
  hue(rotation, multiply) {
    var rad = (rotation || 0) * DEG_TO_RAD, cos = Math.cos(rad), sin = Math.sin(rad), sqrt = Math.sqrt, w = 1 / 3, sqrW = sqrt(w);
    var a00 = cos + (1 - cos) / 3, a01 = w * (1 - cos) - sqrW * sin, a02 = w * (1 - cos) + sqrW * sin;
    var a10 = w * (1 - cos) + sqrW * sin, a11 = cos + w * (1 - cos), a12 = w * (1 - cos) - sqrW * sin;
    var a20 = w * (1 - cos) - sqrW * sin, a21 = w * (1 - cos) + sqrW * sin, a22 = cos + w * (1 - cos);
    return this._apply([a00, a01, a02, 0, 0, a10, a11, a12, 0, 0, a20, a21, a22, 0, 0, 0, 0, 0, 1, 0], multiply, 'hue-rotate(' + rotation + 'deg)');
  }
  contrast(amount, multiply) { var v = (amount || 0) + 1, o = -128 * (v - 1); return this._apply([v, 0, 0, 0, o, 0, v, 0, 0, o, 0, 0, v, 0, o, 0, 0, 0, 1, 0], multiply, 'contrast(' + v + ')'); }
  saturate(amount, multiply) {
    var x = (amount || 0) * 2 / 3 + 1, y = (x - 1) * -0.5;
    return this._apply([x, y, y, 0, 0, y, x, y, 0, 0, y, y, x, 0, 0, 0, 0, 0, 1, 0], multiply, 'saturate(' + (1 + (amount || 0)) + ')');
  }
  desaturate() { return this.saturate(-1); }
  negative(multiply) { return this._apply([-1, 0, 0, 1, 0, 0, -1, 0, 1, 0, 0, 0, -1, 1, 0, 0, 0, 0, 1, 0], multiply, 'invert(1)'); }
  sepia(multiply) { return this._apply([0.393, 0.7689999, 0.18899999, 0, 0, 0.349, 0.6859999, 0.16799999, 0, 0, 0.272, 0.5339999, 0.13099999, 0, 0, 0, 0, 0, 1, 0], multiply, 'sepia(1)'); }
  technicolor(multiply) { return this._apply([1.9125277891456083, -0.8545344976951645, -0.09155508482755585, 0, 11.793603434377337, -0.3087833385928097, 1.7658908555458428, -0.10601743074722245, 0, -70.35205161461398, -0.231103377548616, -0.7501899197440212, 1.847597816108189, 0, 30.950940869491138, 0, 0, 0, 1, 0], multiply); }
  polaroid(multiply) { return this._apply([1.438, -0.062, -0.062, 0, 0, -0.122, 1.378, -0.122, 0, 0, -0.016, -0.016, 1.483, 0, 0, 0, 0, 0, 1, 0], multiply); }
  kodachrome(multiply) { return this._apply([1.1285582396593525, -0.3967382283601348, -0.03992559172921793, 0, 63.72958762196502, -0.16404339962244616, 1.0835251566291304, -0.05498805115633132, 0, 24.732407896706203, -0.16786010706155763, -0.5603416277695248, 1.6014850761964943, 0, 35.62982807460946, 0, 0, 0, 1, 0], multiply); }
  browni(multiply) { return this._apply([0.5997023498159715, 0.34553243048391263, -0.2708298674538042, 0, 47.43192855600873, -0.037703249837783157, 0.8609577587992641, 0.15059552388459913, 0, -36.96841498319127, 0.24113635128153335, -0.07441037908422492, 0.44972182064877153, 0, -7.562075277591283, 0, 0, 0, 1, 0], multiply); }
  vintage(multiply) { return this._apply([0.6279345635605994, 0.3202183420819367, -0.03965408211312453, 0, 9.651285835294123, 0.02578397704808868, 0.6441188644374771, 0.03259127616149294, 0, 7.462829176470591, 0.0466055556782719, -0.0851232987247891, 0.5241648018700465, 0, 5.159190588235296, 0, 0, 0, 1, 0], multiply); }
  night(intensity, multiply) { intensity = intensity || 0.1; return this._apply([intensity * -2, -intensity, 0, 0, 0, -intensity, 0, intensity, 0, 0, 0, intensity, intensity * 2, 0, 0, 0, 0, 0, 1, 0], multiply); }
  predator(amount, multiply) { return this._apply([11.224130630493164 * amount, -4.794486999511719 * amount, -2.8746118545532227 * amount, 0 * amount, 0.40342438220977783 * amount, -3.6330697536468506 * amount, 9.193157196044922 * amount, -2.951810836791992 * amount, 0 * amount, -1.316135048866272 * amount, -3.2184197902679443 * amount, -4.2375030517578125 * amount, 7.476448059082031 * amount, 0 * amount, 0.8044459223747253 * amount, 0, 0, 0, 1, 0], multiply); }
  lsd(multiply) { return this._apply([2, -0.4, 0.5, 0, 0, -0.5, 2, -0.4, 0, 0, -0.4, -0.5, 3, 0, 0, 0, 0, 0, 1, 0], multiply); }
  toBGR(multiply) { return this._apply([0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0], multiply); }
  tint(color, multiply) { var c = Color.toNumber(color), r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255; return this._apply([r, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0], multiply); }
  colorTone(desaturation, toned, lightColor, darkColor, multiply) {
    desaturation = desaturation === undefined ? 0.2 : desaturation; toned = toned === undefined ? 0.15 : toned;
    var lc = Color.toNumber(lightColor === undefined ? 0xFFE580 : lightColor), dc = Color.toNumber(darkColor === undefined ? 0x338000 : darkColor);
    var lR = ((lc >> 16) & 255) / 255, lG = ((lc >> 8) & 255) / 255, lB = (lc & 255) / 255, dR = ((dc >> 16) & 255) / 255, dG = ((dc >> 8) & 255) / 255, dB = (dc & 255) / 255;
    return this._apply([0.3, 0.59, 0.11, 0, 0, lR, lG, lB, desaturation, 0, dR, dG, dB, toned, 0, lR - dR, lG - dG, lB - dB, 0, 0], multiply);
  }
  canvasFilter() { return this._css && this._css.length ? this._css.join(' ') : ''; }
}
ColorMatrixFilter.key = 'colormatrix';
ColorMatrixFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec4 c = sampleTex(uv); if (c.a > 0.0) c.rgb /= c.a;' +
  ' vec4 r = vec4(dot(c, uP[0]), dot(c, uP[1]), dot(c, uP[2]), dot(c, uP[3])) + uP[4]; r = clamp(r, 0.0, 1.0); r = mix(c, r, uP[5].x); return vec4(r.rgb * r.a, r.a); }';
ColorMatrixFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { var c = sampleTex(uv); if (c.a > 0.0) { c = vec4f(c.rgb / c.a, c.a); }' +
  ' var r = vec4f(dot(c, u.p[0]), dot(c, u.p[1]), dot(c, u.p[2]), dot(c, u.p[3])) + u.p[4]; r = clamp(r, vec4f(0.0), vec4f(1.0)); r = mix(c, r, u.p[5].x); return vec4f(r.rgb * r.a, r.a); }';

/** Atajos de color frecuentes */
class GrayscaleFilter extends ColorMatrixFilter { constructor(amount) { super(); this.grayscale(amount === undefined ? 1 : amount); } }
class SepiaFilter extends ColorMatrixFilter { constructor() { super(); this.sepia(); } }
class InvertFilter extends ColorMatrixFilter { constructor() { super(); this.negative(); } }
class HueRotateFilter extends ColorMatrixFilter { constructor(deg) { super(); this.hue(deg || 0); } setHue(d) { return this.hue(d); } }

/* ===================================================================== Alpha */
class AlphaFilter extends Filter {
  constructor(alpha) { super(); this.alpha = alpha === undefined ? 1 : alpha; }
  get alpha() { return this.uniforms[0]; }
  set alpha(v) { this.uniforms[0] = v; }
  canvasFilter() { return this.alpha < 1 ? 'opacity(' + this.alpha + ')' : ''; }
}
AlphaFilter.key = 'alpha';
AlphaFilter.glsl = CopyPass.glsl;
AlphaFilter.wgsl = CopyPass.wgsl;

/* ====================================================================== Blur */
var BLUR_GLSL = 'vec4 filterMain(vec2 uv, vec2 coord){ vec2 d = uP[0].xy * texel();' +
  ' vec4 c = sampleTex(uv) * 0.2270270270;' +
  ' c += (sampleTex(uv + d) + sampleTex(uv - d)) * 0.1945945946;' +
  ' c += (sampleTex(uv + d * 2.0) + sampleTex(uv - d * 2.0)) * 0.1216216216;' +
  ' c += (sampleTex(uv + d * 3.0) + sampleTex(uv - d * 3.0)) * 0.0540540541;' +
  ' c += (sampleTex(uv + d * 4.0) + sampleTex(uv - d * 4.0)) * 0.0162162162; return c; }';
var BLUR_WGSL = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let d = u.p[0].xy * texel();' +
  ' var c = sampleTex(uv) * 0.2270270270;' +
  ' c += (sampleTex(uv + d) + sampleTex(uv - d)) * 0.1945945946;' +
  ' c += (sampleTex(uv + d * 2.0) + sampleTex(uv - d * 2.0)) * 0.1216216216;' +
  ' c += (sampleTex(uv + d * 3.0) + sampleTex(uv - d * 3.0)) * 0.0540540541;' +
  ' c += (sampleTex(uv + d * 4.0) + sampleTex(uv - d * 4.0)) * 0.0162162162; return c; }';
class BlurPass extends Filter {}
BlurPass.key = 'blurpass'; BlurPass.glsl = BLUR_GLSL; BlurPass.wgsl = BLUR_WGSL;

/** Desenfoca `input` (varias pasadas H+V) y deja el resultado en `dest` (RT) o en el destino actual. */
function blurInto(renderer, input, dest, rect, strengthX, strengthY, quality, blend, scratch) {
  var pass = blurInto._pass || (blurInto._pass = new BlurPass());
  var tmp = scratch || renderer.getTempRT(rect);
  var res = renderer.resolution, q = Math.max(1, quality | 0);
  var cur = input;
  for (var i = 0; i < q; i++) {
    var last = i === q - 1;
    var k = (q - i) / q;
    pass.uniforms[0] = strengthX / 4 * res * k; pass.uniforms[1] = 0;
    renderer.filterPass(pass, cur, null, tmp, rect, 0);
    pass.uniforms[0] = 0; pass.uniforms[1] = strengthY / 4 * res * k;
    if (last) renderer.filterPass(pass, tmp, null, dest, rect, dest ? 0 : blend);
    else { if (cur === input && dest) cur = dest; renderer.filterPass(pass, tmp, null, cur, rect, 0); }
  }
  if (!scratch) renderer.releaseTempRT(tmp);
}

class BlurFilter extends Filter {
  constructor(options) {
    super();
    if (typeof options === 'number') options = { strength: options };
    this.strengthX = opt(options, 'strengthX', opt(options, 'strength', 8));
    this.strengthY = opt(options, 'strengthY', opt(options, 'strength', 8));
    this.quality = opt(options, 'quality', 2);
  }
  get strength() { return this.strengthX; }
  set strength(v) { this.strengthX = this.strengthY = v; }
  get blur() { return this.strengthX; }
  set blur(v) { this.strength = v; }
  get padding() { return Math.ceil(Math.max(this.strengthX, this.strengthY) * 2); }
  set padding(v) { /* calculado */ }
  apply(r, input, output, rect, blend) {
    if (this.strengthX <= 0 && this.strengthY <= 0) { var cp = r._copyPass || (r._copyPass = new CopyPass()); cp.uniforms[0] = 1; r.filterPass(cp, input, null, output, rect, blend); return; }
    blurInto(r, input, output, rect, this.strengthX, this.strengthY, this.quality, blend);
  }
  canvasFilter() { return 'blur(' + Math.max(this.strengthX, this.strengthY) / 2 + 'px)'; }
}
BlurFilter.key = 'blur';

/* ================================================================= TiltShift */
class TiltShiftPass extends Filter {}
TiltShiftPass.key = 'tiltshift';
TiltShiftPass.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ float dist = abs(coord.y - uP[0].z); float k = smoothstep(uP[0].w, uP[0].w + uP[1].x, dist); vec2 d = uP[0].xy * texel() * k;' +
  ' vec4 c = sampleTex(uv) * 0.2270270270; c += (sampleTex(uv + d) + sampleTex(uv - d)) * 0.1945945946; c += (sampleTex(uv + d * 2.0) + sampleTex(uv - d * 2.0)) * 0.1216216216;' +
  ' c += (sampleTex(uv + d * 3.0) + sampleTex(uv - d * 3.0)) * 0.0540540541; c += (sampleTex(uv + d * 4.0) + sampleTex(uv - d * 4.0)) * 0.0162162162; return c; }';
TiltShiftPass.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let dist = abs(coord.y - u.p[0].z); let k = smoothstep(u.p[0].w, u.p[0].w + u.p[1].x, dist); let d = u.p[0].xy * texel() * k;' +
  ' var c = sampleTex(uv) * 0.2270270270; c += (sampleTex(uv + d) + sampleTex(uv - d)) * 0.1945945946; c += (sampleTex(uv + d * 2.0) + sampleTex(uv - d * 2.0)) * 0.1216216216;' +
  ' c += (sampleTex(uv + d * 3.0) + sampleTex(uv - d * 3.0)) * 0.0540540541; c += (sampleTex(uv + d * 4.0) + sampleTex(uv - d * 4.0)) * 0.0162162162; return c; }';
class TiltShiftFilter extends Filter {
  constructor(options) { super(); this.blur = opt(options, 'blur', 12); this.focus = opt(options, 'focus', 0.5); this.focusSize = opt(options, 'focusSize', 0.12); this.gradient = opt(options, 'gradient', 0.3); this._pass = new TiltShiftPass(); }
  get padding() { return 0; } set padding(v) { /* */ }
  apply(r, input, output, rect, blend) {
    var p = this._pass, tmp = r.getTempRT(rect), res = r.resolution;
    p.uniforms[2] = this.focus; p.uniforms[3] = this.focusSize; p.uniforms[4] = this.gradient;
    p.uniforms[0] = this.blur / 4 * res; p.uniforms[1] = 0; r.filterPass(p, input, null, tmp, rect, 0);
    p.uniforms[0] = 0; p.uniforms[1] = this.blur / 4 * res; r.filterPass(p, tmp, null, output, rect, blend);
    r.releaseTempRT(tmp);
  }
}
TiltShiftFilter.key = 'tiltshift-f';

/* ====================================================================== Glow */
class GlowCombinePass extends Filter {}
GlowCombinePass.key = 'glowcombine'; GlowCombinePass.twoInputs = true;
GlowCombinePass.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec4 o = sampleTex(uv); float g = sampleTex2(uv).a;' +
  ' float outer = clamp(g * uP[0].w, 0.0, 1.0) * (1.0 - o.a) * uP[1].y; float inner = clamp((1.0 - g) * uP[1].x, 0.0, 1.0) * o.a;' +
  ' vec3 rgb = o.rgb * (1.0 - inner) + uP[0].rgb * inner; float a = o.a; if (uP[1].z > 0.5) { rgb = vec3(0.0); a = 0.0; }' +
  ' return vec4(rgb + uP[0].rgb * outer, a + outer); }';
GlowCombinePass.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let o = sampleTex(uv); let g = sampleTex2(uv).a;' +
  ' let outer = clamp(g * u.p[0].w, 0.0, 1.0) * (1.0 - o.a) * u.p[1].y; let inner = clamp((1.0 - g) * u.p[1].x, 0.0, 1.0) * o.a;' +
  ' var rgb = o.rgb * (1.0 - inner) + u.p[0].rgb * inner; var a = o.a; if (u.p[1].z > 0.5) { rgb = vec3f(0.0); a = 0.0; }' +
  ' return vec4f(rgb + u.p[0].rgb * outer, a + outer); }';
class GlowFilter extends Filter {
  constructor(options) {
    super();
    this.distance = opt(options, 'distance', 12);
    this.outerStrength = opt(options, 'outerStrength', 2);
    this.innerStrength = opt(options, 'innerStrength', 0);
    this.color = opt(options, 'color', 0xffffff);
    this.alpha = opt(options, 'alpha', 1);
    this.knockout = !!opt(options, 'knockout', false);
    this.quality = opt(options, 'quality', 2);
    this._pass = new GlowCombinePass();
  }
  get padding() { return Math.ceil(this.distance * 2); } set padding(v) { /* */ }
  apply(r, input, output, rect, blend) {
    var blurred = r.getTempRT(rect);
    blurInto(r, input, blurred, rect, this.distance, this.distance, this.quality, 0);
    var p = this._pass; setColorParam(p, 0, this.color, this.outerStrength);
    p.uniforms[4] = this.innerStrength; p.uniforms[5] = this.alpha; p.uniforms[6] = this.knockout ? 1 : 0;
    r.filterPass(p, input, blurred, output, rect, blend);
    r.releaseTempRT(blurred);
  }
  canvasFilter() { return 'drop-shadow(0 0 ' + this.distance / 2 + 'px ' + Color.toCSS(Color.toNumber(this.color), this.alpha) + ')'; }
}
GlowFilter.key = 'glow';

/* ===================================================================== Bloom */
class BloomExtractPass extends Filter {}
BloomExtractPass.key = 'bloomextract';
BloomExtractPass.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec4 c = sampleTex(uv); float l = luma(c.a > 0.0 ? c.rgb / c.a : c.rgb); float k = smoothstep(uP[0].x, uP[0].x + uP[0].y, l); return c * k; }';
BloomExtractPass.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let c = sampleTex(uv); var rgb = c.rgb; if (c.a > 0.0) { rgb = c.rgb / c.a; } let k = smoothstep(u.p[0].x, u.p[0].x + u.p[0].y, luma(rgb)); return c * k; }';
class BloomCombinePass extends Filter {}
BloomCombinePass.key = 'bloomcombine'; BloomCombinePass.twoInputs = true;
BloomCombinePass.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec4 o = sampleTex(uv) * uP[0].y; vec4 b = sampleTex2(uv) * uP[0].x; vec3 rgb = o.rgb + b.rgb * uP[1].rgb; return vec4(rgb, max(o.a, b.a * 0.5)); }';
BloomCombinePass.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let o = sampleTex(uv) * u.p[0].y; let b = sampleTex2(uv) * u.p[0].x; let rgb = o.rgb + b.rgb * u.p[1].rgb; return vec4f(rgb, max(o.a, b.a * 0.5)); }';
class BloomFilter extends Filter {
  constructor(options) {
    super();
    this.threshold = opt(options, 'threshold', 0.5);
    this.knee = opt(options, 'knee', 0.25);
    this.bloomScale = opt(options, 'bloomScale', opt(options, 'intensity', 1.2));
    this.brightness = opt(options, 'brightness', 1);
    this.blur = opt(options, 'blur', 10);
    this.quality = opt(options, 'quality', 3);
    this.color = opt(options, 'color', 0xffffff);
    this._ex = new BloomExtractPass(); this._co = new BloomCombinePass();
  }
  get padding() { return Math.ceil(this.blur * 2); } set padding(v) { /* */ }
  apply(r, input, output, rect, blend) {
    var bright = r.getTempRT(rect);
    this._ex.uniforms[0] = this.threshold; this._ex.uniforms[1] = this.knee;
    r.filterPass(this._ex, input, null, bright, rect, 0);
    var scratch = r.getTempRT(rect);
    blurInto(r, bright, bright, rect, this.blur, this.blur, this.quality, 0, scratch);
    r.releaseTempRT(scratch);
    var co = this._co; co.uniforms[0] = this.bloomScale; co.uniforms[1] = this.brightness; setColorParam(co, 4, this.color);
    r.filterPass(co, input, bright, output, rect, blend);
    r.releaseTempRT(bright);
  }
  canvasFilter() { return 'brightness(' + (1 + this.bloomScale * 0.15) + ') saturate(1.2)'; }
}
BloomFilter.key = 'bloom';

/* =============================================================== DropShadow */
class ShadowExtractPass extends Filter {}
ShadowExtractPass.key = 'shadowextract';
ShadowExtractPass.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ float a = sampleTex(uv - uP[1].xy * texel()).a * uP[0].a; return vec4(uP[0].rgb * a, a); }';
ShadowExtractPass.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let a = sampleTex(uv - u.p[1].xy * texel()).a * u.p[0].a; return vec4f(u.p[0].rgb * a, a); }';
class UnderPass extends Filter {}
UnderPass.key = 'underpass'; UnderPass.twoInputs = true;
UnderPass.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec4 o = sampleTex(uv); vec4 s = sampleTex2(uv); if (uP[0].x > 0.5) return s * (1.0 - o.a); return o + s * (1.0 - o.a); }';
UnderPass.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let o = sampleTex(uv); let s = sampleTex2(uv); if (u.p[0].x > 0.5) { return s * (1.0 - o.a); } return o + s * (1.0 - o.a); }';
class DropShadowFilter extends Filter {
  constructor(options) {
    super();
    this.color = opt(options, 'color', 0x000000);
    this.alpha = opt(options, 'alpha', 0.6);
    this.blur = opt(options, 'blur', 4);
    this.quality = opt(options, 'quality', 2);
    var off = opt(options, 'offset', null);
    var dist = opt(options, 'distance', 6), ang = opt(options, 'angle', 45) * DEG_TO_RAD;
    this.offsetX = off ? off.x : Math.cos(ang) * dist; this.offsetY = off ? off.y : Math.sin(ang) * dist;
    this.shadowOnly = !!opt(options, 'shadowOnly', false);
    this._ex = new ShadowExtractPass(); this._un = new UnderPass();
  }
  get padding() { return Math.ceil(this.blur * 2 + Math.max(Math.abs(this.offsetX), Math.abs(this.offsetY))); } set padding(v) { /* */ }
  apply(r, input, output, rect, blend) {
    var sh = r.getTempRT(rect), res = r.resolution;
    setColorParam(this._ex, 0, this.color, this.alpha); this._ex.uniforms[4] = this.offsetX * res; this._ex.uniforms[5] = this.offsetY * res;
    r.filterPass(this._ex, input, null, sh, rect, 0);
    if (this.blur > 0) { var scratch = r.getTempRT(rect); blurInto(r, sh, sh, rect, this.blur, this.blur, this.quality, 0, scratch); r.releaseTempRT(scratch); }
    this._un.uniforms[0] = this.shadowOnly ? 1 : 0;
    r.filterPass(this._un, input, sh, output, rect, blend);
    r.releaseTempRT(sh);
  }
  canvasFilter() { return 'drop-shadow(' + this.offsetX + 'px ' + this.offsetY + 'px ' + this.blur + 'px ' + Color.toCSS(Color.toNumber(this.color), this.alpha) + ')'; }
}
DropShadowFilter.key = 'dropshadow';

/* =================================================================== Outline */
class OutlineFilter extends Filter {
  constructor(options) {
    super();
    if (typeof options === 'number') options = { thickness: options, color: arguments[1] };
    this.thickness = opt(options, 'thickness', 2);
    setColorParam(this, 0, opt(options, 'color', 0x000000), opt(options, 'alpha', 1));
    this.knockout = !!opt(options, 'knockout', false);
  }
  get thickness() { return this._th; }
  set thickness(v) { this._th = v; this.uniforms[4] = v; }
  get color() { return getColorParam(this, 0); } set color(v) { setColorParam(this, 0, v); }
  get alpha() { return this.uniforms[3]; } set alpha(v) { this.uniforms[3] = v; }
  get knockout() { return this.uniforms[5] > 0.5; } set knockout(v) { this.uniforms[5] = v ? 1 : 0; }
  get padding() { return Math.ceil(this._th + 1); } set padding(v) { /* */ }
  apply(r, input, output, rect, blend) { this.uniforms[6] = r.resolution; r.filterPass(this, input, null, output, rect, blend); }
  canvasFilter() { var c = Color.toCSS(this.color, this.alpha), t = this._th; return 'drop-shadow(' + t + 'px 0 0 ' + c + ') drop-shadow(-' + t + 'px 0 0 ' + c + ') drop-shadow(0 ' + t + 'px 0 ' + c + ') drop-shadow(0 -' + t + 'px 0 ' + c + ')'; }
}
OutlineFilter.key = 'outline';
OutlineFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec4 o = sampleTex(uv); float m = 0.0; vec2 t = texel() * uP[1].x * uP[1].z;' +
  ' for (int i = 0; i < 16; i++) { float a = float(i) * 0.39269908; m = max(m, sampleTex(uv + vec2(cos(a), sin(a)) * t).a); m = max(m, sampleTex(uv + vec2(cos(a), sin(a)) * t * 0.5).a); }' +
  ' vec4 line = vec4(uP[0].rgb, 1.0) * uP[0].a * m * (1.0 - o.a); if (uP[1].y > 0.5) return line; return o + line; }';
OutlineFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let o = sampleTex(uv); var m = 0.0; let t = texel() * u.p[1].x * u.p[1].z;' +
  ' for (var i = 0; i < 16; i++) { let a = f32(i) * 0.39269908; let dir = vec2f(cos(a), sin(a)); m = max(m, sampleTex(uv + dir * t).a); m = max(m, sampleTex(uv + dir * t * 0.5).a); }' +
  ' let ol = vec4f(u.p[0].rgb, 1.0) * u.p[0].a * m * (1.0 - o.a); if (u.p[1].y > 0.5) { return ol; } return o + ol; }';

/* =================================================================== Pixelate */
class PixelateFilter extends Filter {
  constructor(size) { super(); this.size = size === undefined ? 8 : size; }
  get size() { return this.uniforms[0]; }
  set size(v) { if (typeof v === 'number') { this.uniforms[0] = v; this.uniforms[1] = v; } else { this.uniforms[0] = v.x; this.uniforms[1] = v.y; } }
  get sizeX() { return this.uniforms[0]; } set sizeX(v) { this.uniforms[0] = v; }
  get sizeY() { return this.uniforms[1]; } set sizeY(v) { this.uniforms[1] = v; }
}
PixelateFilter.key = 'pixelate';
PixelateFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec2 ps = max(uP[0].xy, vec2(1.0)) * uGlobal.y * texel(); vec2 p = (floor(uv / ps) + 0.5) * ps; return sampleTex(p); }';
PixelateFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let ps = max(u.p[0].xy, vec2f(1.0)) * u.glob.y * texel(); let p = (floor(uv / ps) + 0.5) * ps; return sampleTex(p); }';

/* ======================================================================== CRT */
class CRTFilter extends Filter {
  constructor(options) {
    super();
    this.curvature = opt(options, 'curvature', 1.0);
    this.lineWidth = opt(options, 'lineWidth', 3);
    this.lineContrast = opt(options, 'lineContrast', 0.25);
    this.noise = opt(options, 'noise', 0.08);
    this.vignetting = opt(options, 'vignetting', 0.3);
    this.vignettingAlpha = opt(options, 'vignettingAlpha', 1);
    this.vignettingBlur = opt(options, 'vignettingBlur', 0.3);
    this.flicker = opt(options, 'flicker', 0.5);
    this.chromatic = opt(options, 'chromatic', 1.0);
  }
}
defParams(CRTFilter, { curvature: 0, lineWidth: 1, lineContrast: 2, noise: 3, vignetting: 4, vignettingAlpha: 5, vignettingBlur: 6, flicker: 7, chromatic: 8 });
CRTFilter.key = 'crt';
CRTFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec2 c = coord - 0.5; float d = dot(c, c); vec2 cc = coord + c * d * uP[0].x * 0.25;' +
  ' if (cc.x < 0.0 || cc.x > 1.0 || cc.y < 0.0 || cc.y > 1.0) return vec4(0.0, 0.0, 0.0, 1.0);' +
  ' vec2 fs = frameSize(); vec2 uvc = pxToUV(cc * fs); vec2 ca = vec2(uP[2].x * uGlobal.y, 0.0) * texel() * (0.5 + d * 4.0);' +
  ' vec4 col = sampleTex(uvc); col.r = sampleTex(uvc + ca).r; col.b = sampleTex(uvc - ca).b;' +
  ' float line = sin(cc.y * fs.y * PI / max(uP[0].y, 1.0)); col.rgb *= 1.0 - uP[0].z * (0.5 - 0.5 * line);' +
  ' col.rgb += (rand(cc * fs + vec2(uGlobal.x * 61.0, uGlobal.x * 17.0)) - 0.5) * uP[0].w * col.a;' +
  ' col.rgb *= 1.0 + sin(uGlobal.x * 110.0) * uP[1].w * 0.02;' +
  ' float v = smoothstep(0.5 + uP[1].x * 0.5 - uP[1].z, 0.5 + uP[1].x * 0.5 + uP[1].z * 0.3, length(c) * (1.0 + uP[1].x));' +
  ' col.rgb *= 1.0 - v * uP[1].y; return col; }';
CRTFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let c = coord - 0.5; let d = dot(c, c); let cc = coord + c * d * u.p[0].x * 0.25;' +
  ' if (cc.x < 0.0 || cc.x > 1.0 || cc.y < 0.0 || cc.y > 1.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }' +
  ' let fs = frameSize(); let uvc = pxToUV(cc * fs); let ca = vec2f(u.p[2].x * u.glob.y, 0.0) * texel() * (0.5 + d * 4.0);' +
  ' let base = sampleTex(uvc); var rgb = vec3f(sampleTex(uvc + ca).r, base.g, sampleTex(uvc - ca).b);' +
  ' let ln = sin(cc.y * fs.y * PI / max(u.p[0].y, 1.0)); rgb = rgb * (1.0 - u.p[0].z * (0.5 - 0.5 * ln));' +
  ' rgb = rgb + vec3f((rand(cc * fs + vec2f(u.glob.x * 61.0, u.glob.x * 17.0)) - 0.5) * u.p[0].w * base.a);' +
  ' rgb = rgb * (1.0 + sin(u.glob.x * 110.0) * u.p[1].w * 0.02);' +
  ' let v = smoothstep(0.5 + u.p[1].x * 0.5 - u.p[1].z, 0.5 + u.p[1].x * 0.5 + u.p[1].z * 0.3, length(c) * (1.0 + u.p[1].x));' +
  ' rgb = rgb * (1.0 - v * u.p[1].y); return vec4f(rgb, base.a); }';

/* =================================================================== Vignette */
class VignetteFilter extends Filter {
  constructor(options) {
    super();
    // radius: distancia (0 = centro, 1 = esquina) donde empieza a oscurecer; softness: ancho del degradado
    this.radius = opt(options, 'radius', 0.45); this.softness = opt(options, 'softness', 0.55); this.strength = opt(options, 'strength', 0.9);
    this.color = opt(options, 'color', 0x000000);
  }
  get color() { return getColorParam(this, 4); } set color(v) { setColorParam(this, 4, v); }
}
defParams(VignetteFilter, { radius: 0, softness: 1, strength: 2 });
VignetteFilter.key = 'vignette';
VignetteFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec4 c = sampleTex(uv); float d = length(coord - 0.5) * 1.41421356;' +
  ' float v = smoothstep(uP[0].x, uP[0].x + max(uP[0].y, 0.001), d) * uP[0].z; c.rgb = mix(c.rgb, uP[1].rgb * c.a, v); return c; }';
VignetteFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let c = sampleTex(uv); let d = length(coord - 0.5) * 1.41421356;' +
  ' let v = smoothstep(u.p[0].x, u.p[0].x + max(u.p[0].y, 0.001), d) * u.p[0].z; return vec4f(mix(c.rgb, u.p[1].rgb * c.a, v), c.a); }';

/* ========================================================== ChromaticAberration */
class ChromaticAberrationFilter extends Filter {
  constructor(options) {
    super();
    var off = opt(options, 'offset', 3);
    this.redX = opt(options, 'redX', -off); this.redY = opt(options, 'redY', 0);
    this.greenX = opt(options, 'greenX', 0); this.greenY = opt(options, 'greenY', 0);
    this.blueX = opt(options, 'blueX', off); this.blueY = opt(options, 'blueY', 0);
    this.radial = opt(options, 'radial', false) ? 1 : 0;
    this.padding = Math.abs(off) + 2;
  }
  apply(r, input, output, rect, blend) { this.uniforms[7] = r.resolution; r.filterPass(this, input, null, output, rect, blend); }
}
defParams(ChromaticAberrationFilter, { redX: 0, redY: 1, greenX: 2, greenY: 3, blueX: 4, blueY: 5, radial: 6 });
ChromaticAberrationFilter.key = 'rgbsplit';
ChromaticAberrationFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ float k = uP[1].z > 0.5 ? length(coord - 0.5) * 2.0 : 1.0; vec2 t = texel() * uP[1].w * k;' +
  ' vec4 r = sampleTex(uv + uP[0].xy * t); vec4 g = sampleTex(uv + uP[0].zw * t); vec4 b = sampleTex(uv + uP[1].xy * t);' +
  ' return vec4(r.r, g.g, b.b, max(max(r.a, g.a), b.a)); }';
ChromaticAberrationFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { var k = 1.0; if (u.p[1].z > 0.5) { k = length(coord - 0.5) * 2.0; } let t = texel() * u.p[1].w * k;' +
  ' let r = sampleTex(uv + u.p[0].xy * t); let g = sampleTex(uv + u.p[0].zw * t); let b = sampleTex(uv + u.p[1].xy * t);' +
  ' return vec4f(r.r, g.g, b.b, max(max(r.a, g.a), b.a)); }';
var RGBSplitFilter = ChromaticAberrationFilter;

/* ================================================================== Shockwave */
class ShockwaveFilter extends Filter {
  constructor(options) {
    super();
    this.centerX = opt(options, 'x', opt(options, 'centerX', 400)); this.centerY = opt(options, 'y', opt(options, 'centerY', 300));
    this.amplitude = opt(options, 'amplitude', 30); this.wavelength = opt(options, 'wavelength', 160);
    this.speed = opt(options, 'speed', 500); this.brightness = opt(options, 'brightness', 1.2);
    this.radius = opt(options, 'radius', -1); this.time = opt(options, 'time', 0);
    this.autoPlay = opt(options, 'autoPlay', true);
    this.loop = !!opt(options, 'loop', false);
    this._start = -1;
    this.padding = 0;
  }
  /** Reinicia la onda (opcionalmente en otra posición) */
  play(x, y) { if (x !== undefined) { this.centerX = x; this.centerY = y; } this._start = -1; this.autoPlay = true; this.time = 0; this.enabled = true; return this; }
  apply(r, input, output, rect, blend) {
    if (this.autoPlay) {
      var now = r.time / 1000; if (this._start < 0) this._start = now;
      this.time = now - this._start;
      var maxT = this.radius > 0 ? this.radius / this.speed : (Math.max(r.width, r.height) * 1.5) / this.speed;
      if (this.time > maxT) { if (this.loop) this._start = now; else this.time = maxT + 1; }
    }
    r.filterPass(this, input, null, output, rect, blend);
  }
}
defParams(ShockwaveFilter, { centerX: 0, centerY: 1, amplitude: 2, wavelength: 3, speed: 4, brightness: 5, radius: 6, time: 7 });
ShockwaveFilter.key = 'shockwave';
ShockwaveFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec2 P = pixelPos(coord); vec2 C = uP[0].xy - uGlobal.zw; float hw = uP[0].w * 0.5; float curR = uP[1].w * uP[1].x;' +
  ' float fade = 1.0; if (uP[1].z > 0.0) { if (curR > uP[1].z) return sampleTex(uv); fade = 1.0 - pow(curR / uP[1].z, 2.0); }' +
  ' vec2 dir = P - C; float dist = length(dir); if (dist <= 0.0 || dist < curR - hw || dist > curR + hw) return sampleTex(uv);' +
  ' float diff = (dist - curR) / hw; float p = 1.0 - diff * diff; float pw = 1.25 * sin(diff * PI) * p * uP[0].z * fade;' +
  ' vec4 col = sampleTex(pxToUV(P + normalize(dir) * pw)); col.rgb *= 1.0 + (uP[1].y - 1.0) * p * fade; return col; }';
ShockwaveFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let P = pixelPos(coord); let C = u.p[0].xy - u.glob.zw; let hw = u.p[0].w * 0.5; let curR = u.p[1].w * u.p[1].x;' +
  ' var fade = 1.0; if (u.p[1].z > 0.0) { if (curR > u.p[1].z) { return sampleTex(uv); } fade = 1.0 - pow(curR / u.p[1].z, 2.0); }' +
  ' let dir = P - C; let dist = length(dir); if (dist <= 0.0 || dist < curR - hw || dist > curR + hw) { return sampleTex(uv); }' +
  ' let diff = (dist - curR) / hw; let p = 1.0 - diff * diff; let pw = 1.25 * sin(diff * PI) * p * u.p[0].z * fade;' +
  ' let col = sampleTex(pxToUV(P + normalize(dir) * pw)); return vec4f(col.rgb * (1.0 + (u.p[1].y - 1.0) * p * fade), col.a); }';

/* ======================================================================= Wave */
class WaveFilter extends Filter {
  constructor(options) {
    super();
    this.amplitudeX = opt(options, 'amplitudeX', opt(options, 'amplitude', 6)); this.amplitudeY = opt(options, 'amplitudeY', opt(options, 'amplitude', 4));
    this.frequencyX = opt(options, 'frequencyX', 0.05); this.frequencyY = opt(options, 'frequencyY', 0.04);
    this.speed = opt(options, 'speed', 3);
    this.padding = Math.ceil(Math.max(this.amplitudeX, this.amplitudeY));
  }
}
defParams(WaveFilter, { amplitudeX: 0, amplitudeY: 1, frequencyX: 2, frequencyY: 3, speed: 4 });
WaveFilter.key = 'wave';
WaveFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec2 P = pixelPos(coord); vec2 W = P + uGlobal.zw; float t = uGlobal.x * uP[1].x;' +
  ' vec2 off = vec2(sin(W.y * uP[0].w + t) * uP[0].x, sin(W.x * uP[0].z + t * 1.3) * uP[0].y); return sampleTex(pxToUV(P + off)); }';
WaveFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let P = pixelPos(coord); let W = P + u.glob.zw; let t = u.glob.x * u.p[1].x;' +
  ' let off = vec2f(sin(W.y * u.p[0].w + t) * u.p[0].x, sin(W.x * u.p[0].z + t * 1.3) * u.p[0].y); return sampleTex(pxToUV(P + off)); }';

/* ================================================================== HeatHaze */
class HeatHazeFilter extends Filter {
  constructor(options) { super(); this.strength = opt(options, 'strength', 3); this.scale = opt(options, 'scale', 0.08); this.speed = opt(options, 'speed', 2); this.padding = 4; }
}
defParams(HeatHazeFilter, { strength: 0, scale: 1, speed: 2 });
HeatHazeFilter.key = 'heathaze';
HeatHazeFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec2 P = pixelPos(coord); vec2 W = (P + uGlobal.zw) * uP[0].y; float t = uGlobal.x * uP[0].z;' +
  ' vec2 off = vec2(sin(W.y * 1.7 + t) + sin(W.y * 3.1 - t * 1.4) * 0.5, cos(W.x * 1.3 + t * 0.8) + sin(W.x * 2.7 + t) * 0.5) * uP[0].x * 0.5; return sampleTex(pxToUV(P + off)); }';
HeatHazeFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let P = pixelPos(coord); let W = (P + u.glob.zw) * u.p[0].y; let t = u.glob.x * u.p[0].z;' +
  ' let off = vec2f(sin(W.y * 1.7 + t) + sin(W.y * 3.1 - t * 1.4) * 0.5, cos(W.x * 1.3 + t * 0.8) + sin(W.x * 2.7 + t) * 0.5) * u.p[0].x * 0.5; return sampleTex(pxToUV(P + off)); }';

/* ===================================================================== Glitch */
class GlitchFilter extends Filter {
  constructor(options) {
    super();
    this.slices = opt(options, 'slices', 24); this.offset = opt(options, 'offset', 40); this.density = opt(options, 'density', 0.3);
    this.speed = opt(options, 'speed', 12); this.rgbSplit = opt(options, 'rgbSplit', 4); this.seed = opt(options, 'seed', 0.5);
    this.padding = Math.ceil(this.offset);
  }
}
defParams(GlitchFilter, { slices: 0, offset: 1, density: 2, speed: 3, rgbSplit: 4, seed: 5 });
GlitchFilter.key = 'glitch';
GlitchFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec2 fs = frameSize(); float t = floor(uGlobal.x * uP[0].w) + uP[1].y; float sl = floor(coord.y * uP[0].x);' +
  ' float r = rand(vec2(sl, t)); float sh = r > 1.0 - uP[0].z ? (rand(vec2(sl + 7.0, t)) - 0.5) * uP[0].y : 0.0; vec2 P = pixelPos(coord) + vec2(sh, 0.0);' +
  ' vec2 sp = vec2(uP[1].x * (r > 1.0 - uP[0].z ? 1.5 : 0.3), 0.0); vec4 c = sampleTex(pxToUV(P)); c.r = sampleTex(pxToUV(P + sp)).r; c.b = sampleTex(pxToUV(P - sp)).b; return c; }';
GlitchFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let t = floor(u.glob.x * u.p[0].w) + u.p[1].y; let sl = floor(coord.y * u.p[0].x);' +
  ' let r = rand(vec2f(sl, t)); var sh = 0.0; var k = 0.3; if (r > 1.0 - u.p[0].z) { sh = (rand(vec2f(sl + 7.0, t)) - 0.5) * u.p[0].y; k = 1.5; } let P = pixelPos(coord) + vec2f(sh, 0.0);' +
  ' let sp = vec2f(u.p[1].x * k, 0.0); let c = sampleTex(pxToUV(P)); return vec4f(sampleTex(pxToUV(P + sp)).r, c.g, sampleTex(pxToUV(P - sp)).b, c.a); }';

/* ====================================================================== Noise */
class NoiseFilter extends Filter {
  constructor(options) { super(); if (typeof options === 'number') options = { noise: options }; this.noise = opt(options, 'noise', 0.25); this.seed = opt(options, 'seed', Math.random()); this.animated = opt(options, 'animated', true) ? 1 : 0; }
}
defParams(NoiseFilter, { noise: 0, seed: 1, animated: 2 });
NoiseFilter.key = 'noise';
NoiseFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec4 c = sampleTex(uv); float n = rand(pixelPos(coord) * 0.37 + vec2(uP[0].y + uGlobal.x * uP[0].z * 3.7, uP[0].y * 2.1)) - 0.5; c.rgb += n * uP[0].x * c.a; return c; }';
NoiseFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let c = sampleTex(uv); let n = rand(pixelPos(coord) * 0.37 + vec2f(u.p[0].y + u.glob.x * u.p[0].z * 3.7, u.p[0].y * 2.1)) - 0.5; return vec4f(c.rgb + vec3f(n * u.p[0].x * c.a), c.a); }';

/* ==================================================================== OldFilm */
class OldFilmFilter extends Filter {
  constructor(options) {
    super();
    this.sepia = opt(options, 'sepia', 0.4); this.noise = opt(options, 'noise', 0.25); this.scratch = opt(options, 'scratch', 0.5);
    this.vignetting = opt(options, 'vignetting', 0.35); this.flicker = opt(options, 'flicker', 0.15);
  }
}
defParams(OldFilmFilter, { sepia: 0, noise: 1, scratch: 2, vignetting: 3, flicker: 4 });
OldFilmFilter.key = 'oldfilm';
OldFilmFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec4 c = sampleTex(uv); vec3 rgb = c.a > 0.0 ? c.rgb / c.a : c.rgb; float t = uGlobal.x;' +
  ' vec3 sep = vec3(dot(rgb, vec3(0.393, 0.769, 0.189)), dot(rgb, vec3(0.349, 0.686, 0.168)), dot(rgb, vec3(0.272, 0.534, 0.131))); rgb = mix(rgb, sep, uP[0].x);' +
  ' rgb += (rand(coord * 431.0 + vec2(t * 13.0, t)) - 0.5) * uP[0].y; float sx = rand(vec2(floor(t * 6.0), 3.1));' +
  ' if (rand(vec2(floor(t * 6.0), 1.7)) < uP[0].z && abs(coord.x - sx) < 0.0012 * uP[0].z * 2.0) rgb *= 0.35 + rand(vec2(coord.y * 40.0, t)) * 0.4;' +
  ' float v = smoothstep(0.35, 0.95, length(coord - 0.5) * 1.4); rgb *= 1.0 - v * uP[0].w; rgb *= 1.0 + (rand(vec2(floor(t * 24.0), 0.3)) - 0.5) * uP[1].x;' +
  ' return vec4(clamp(rgb, 0.0, 1.0) * c.a, c.a); }';
OldFilmFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let c = sampleTex(uv); var rgb = c.rgb; if (c.a > 0.0) { rgb = c.rgb / c.a; } let t = u.glob.x;' +
  ' let sep = vec3f(dot(rgb, vec3f(0.393, 0.769, 0.189)), dot(rgb, vec3f(0.349, 0.686, 0.168)), dot(rgb, vec3f(0.272, 0.534, 0.131))); rgb = mix(rgb, sep, u.p[0].x);' +
  ' rgb = rgb + vec3f(rand(coord * 431.0 + vec2f(t * 13.0, t)) - 0.5) * u.p[0].y; let sx = rand(vec2f(floor(t * 6.0), 3.1));' +
  ' if (rand(vec2f(floor(t * 6.0), 1.7)) < u.p[0].z && abs(coord.x - sx) < 0.0012 * u.p[0].z * 2.0) { rgb = rgb * (0.35 + rand(vec2f(coord.y * 40.0, t)) * 0.4); }' +
  ' let v = smoothstep(0.35, 0.95, length(coord - 0.5) * 1.4); rgb = rgb * (1.0 - v * u.p[0].w); rgb = rgb * (1.0 + (rand(vec2f(floor(t * 24.0), 0.3)) - 0.5) * u.p[1].x);' +
  ' return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)) * c.a, c.a); }';

/* ================================================================ BulgePinch */
class BulgePinchFilter extends Filter {
  constructor(options) { super(); this.centerX = opt(options, 'x', 400); this.centerY = opt(options, 'y', 300); this.radius = opt(options, 'radius', 120); this.strength = opt(options, 'strength', 0.8); }
}
defParams(BulgePinchFilter, { centerX: 0, centerY: 1, radius: 2, strength: 3 });
BulgePinchFilter.key = 'bulgepinch';
BulgePinchFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec2 P = pixelPos(coord); vec2 C = uP[0].xy - uGlobal.zw; vec2 d = P - C; float dist = length(d); float R = uP[0].z;' +
  ' if (dist < R && dist > 0.0) { float pct = dist / R; float e = max(0.05, 1.0 + uP[0].w); P = C + d / dist * R * pow(pct, e); } return sampleTex(pxToUV(P)); }';
BulgePinchFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { var P = pixelPos(coord); let C = u.p[0].xy - u.glob.zw; let d = P - C; let dist = length(d); let R = u.p[0].z;' +
  ' if (dist < R && dist > 0.0) { let pct = dist / R; let e = max(0.05, 1.0 + u.p[0].w); P = C + d / dist * R * pow(pct, e); } return sampleTex(pxToUV(P)); }';

/* ===================================================================== Twist */
class TwistFilter extends Filter {
  constructor(options) { super(); this.centerX = opt(options, 'x', 400); this.centerY = opt(options, 'y', 300); this.radius = opt(options, 'radius', 200); this.angle = opt(options, 'angle', 4); }
}
defParams(TwistFilter, { centerX: 0, centerY: 1, radius: 2, angle: 3 });
TwistFilter.key = 'twist';
TwistFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec2 P = pixelPos(coord); vec2 C = uP[0].xy - uGlobal.zw; vec2 d = P - C; float dist = length(d);' +
  ' if (dist < uP[0].z) { float pct = (uP[0].z - dist) / uP[0].z; float th = pct * pct * uP[0].w; float s = sin(th), c = cos(th); d = vec2(d.x * c - d.y * s, d.x * s + d.y * c); } return sampleTex(pxToUV(C + d)); }';
TwistFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let P = pixelPos(coord); let C = u.p[0].xy - u.glob.zw; var d = P - C; let dist = length(d);' +
  ' if (dist < u.p[0].z) { let pct = (u.p[0].z - dist) / u.p[0].z; let th = pct * pct * u.p[0].w; let s = sin(th); let c = cos(th); d = vec2f(d.x * c - d.y * s, d.x * s + d.y * c); } return sampleTex(pxToUV(C + d)); }';

/* ================================================================== ZoomBlur */
class ZoomBlurFilter extends Filter {
  constructor(options) { super(); this.centerX = opt(options, 'x', 400); this.centerY = opt(options, 'y', 300); this.strength = opt(options, 'strength', 0.1); this.innerRadius = opt(options, 'innerRadius', 0); }
}
defParams(ZoomBlurFilter, { centerX: 0, centerY: 1, strength: 2, innerRadius: 3 });
ZoomBlurFilter.key = 'zoomblur';
ZoomBlurFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec2 P = pixelPos(coord); vec2 C = uP[0].xy - uGlobal.zw; vec2 dir = C - P; float dist = length(dir);' +
  ' float s = uP[0].z * max(0.0, dist - uP[0].w) / max(dist, 0.0001); vec4 acc = vec4(0.0); float jit = rand(coord * 97.0) / 16.0;' +
  ' for (int i = 0; i < 16; i++) { float t = (float(i) + jit) / 16.0; acc += sampleTex(pxToUV(P + dir * s * t)); } return acc / 16.0; }';
ZoomBlurFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let P = pixelPos(coord); let C = u.p[0].xy - u.glob.zw; let dir = C - P; let dist = length(dir);' +
  ' let s = u.p[0].z * max(0.0, dist - u.p[0].w) / max(dist, 0.0001); var acc = vec4f(0.0); let jit = rand(coord * 97.0) / 16.0;' +
  ' for (var i = 0; i < 16; i++) { let t = (f32(i) + jit) / 16.0; acc += sampleTex(pxToUV(P + dir * s * t)); } return acc / 16.0; }';

/* ================================================================ MotionBlur */
class MotionBlurFilter extends Filter {
  constructor(options) { super(); this.velocityX = opt(options, 'x', opt(options, 'velocityX', 20)); this.velocityY = opt(options, 'y', opt(options, 'velocityY', 0)); this.padding = 24; }
  setVelocity(x, y) { this.velocityX = x; this.velocityY = y; this.padding = Math.ceil(Math.max(Math.abs(x), Math.abs(y))) + 2; return this; }
}
defParams(MotionBlurFilter, { velocityX: 0, velocityY: 1 });
MotionBlurFilter.key = 'motionblur';
MotionBlurFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec2 v = uP[0].xy * uGlobal.y * texel(); vec4 acc = vec4(0.0);' +
  ' for (int i = 0; i < 13; i++) { float t = float(i) / 12.0 - 0.5; acc += sampleTex(uv + v * t); } return acc / 13.0; }';
MotionBlurFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let v = u.p[0].xy * u.glob.y * texel(); var acc = vec4f(0.0);' +
  ' for (var i = 0; i < 13; i++) { let t = f32(i) / 12.0 - 0.5; acc += sampleTex(uv + v * t); } return acc / 13.0; }';

/* =================================================================== GodRays */
class GodRaysFilter extends Filter {
  constructor(options) {
    super();
    this.lightX = opt(options, 'x', 400); this.lightY = opt(options, 'y', 0);
    this.exposure = opt(options, 'exposure', 0.35); this.decay = opt(options, 'decay', 0.96); this.density = opt(options, 'density', 0.8); this.weight = opt(options, 'weight', 0.5);
    /** solo emiten rayos los píxeles con luminancia por encima de este umbral (el cielo, el sol, las luces) */
    this.threshold = opt(options, 'threshold', 0.6);
    this.color = opt(options, 'color', 0xfff2cc);
  }
  get color() { return getColorParam(this, 8); } set color(v) { setColorParam(this, 8, v); }
}
defParams(GodRaysFilter, { lightX: 0, lightY: 1, exposure: 2, decay: 3, density: 4, weight: 5, threshold: 6 });
GodRaysFilter.key = 'godrays';
GodRaysFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec4 o = sampleTex(uv); vec2 P = pixelPos(coord); vec2 L = uP[0].xy - uGlobal.zw; vec2 delta = (P - L) / 40.0 * uP[1].x;' +
  ' vec2 p = P; float ill = 1.0; vec3 acc = vec3(0.0); float th = uP[1].z;' +
  ' for (int i = 0; i < 40; i++) { p -= delta; vec4 s = sampleTex(pxToUV(p)); float b = max(luma(s.rgb) - th, 0.0) / max(1.0 - th, 0.001); acc += s.rgb * b * ill * uP[1].y; ill *= uP[0].w; }' +
  ' acc *= uP[0].z * 0.1;' +
  ' return vec4(o.rgb + acc * uP[2].rgb, max(o.a, clamp(luma(acc), 0.0, 1.0))); }';
GodRaysFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let o = sampleTex(uv); let P = pixelPos(coord); let L = u.p[0].xy - u.glob.zw; let delta = (P - L) / 40.0 * u.p[1].x;' +
  ' var p = P; var ill = 1.0; var acc = vec3f(0.0); let th = u.p[1].z;' +
  ' for (var i = 0; i < 40; i++) { p -= delta; let s = sampleTex(pxToUV(p)); let b = max(luma(s.rgb) - th, 0.0) / max(1.0 - th, 0.001); acc += s.rgb * b * ill * u.p[1].y; ill *= u.p[0].w; }' +
  ' acc *= u.p[0].z * 0.1;' +
  ' return vec4f(o.rgb + acc * u.p[2].rgb, max(o.a, clamp(luma(acc), 0.0, 1.0))); }';

/* =================================================================== Posterize / Dither */
class PosterizeFilter extends Filter { constructor(levels) { super(); this.levels = levels || 5; } }
defParams(PosterizeFilter, { levels: 0 });
PosterizeFilter.key = 'posterize';
PosterizeFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec4 c = sampleTex(uv); if (c.a <= 0.0) return c; vec3 rgb = c.rgb / c.a; float n = max(uP[0].x, 2.0) - 1.0; rgb = floor(rgb * n + 0.5) / n; return vec4(rgb * c.a, c.a); }';
PosterizeFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let c = sampleTex(uv); if (c.a <= 0.0) { return c; } let n = max(u.p[0].x, 2.0) - 1.0; let rgb = floor(c.rgb / c.a * n + 0.5) / n; return vec4f(rgb * c.a, c.a); }';
class DitherFilter extends Filter { constructor(options) { super(); this.levels = opt(options, 'levels', 4); this.scale = opt(options, 'scale', 2); } }
defParams(DitherFilter, { levels: 0, scale: 1 });
DitherFilter.key = 'dither';
DitherFilter.glsl = 'float b2(vec2 a){ a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); } float b4(vec2 a){ return b2(0.5 * a) * 0.25 + b2(a); } float b8(vec2 a){ return b4(0.5 * a) * 0.25 + b2(a); }' +
  'vec4 filterMain(vec2 uv, vec2 coord){ vec4 c = sampleTex(uv); if (c.a <= 0.0) return c; vec3 rgb = c.rgb / c.a; float n = max(uP[0].x, 2.0) - 1.0; float d = b8(pixelPos(coord) / max(uP[0].y, 1.0)) - 0.5; rgb = floor(rgb * n + 0.5 + d) / n; return vec4(clamp(rgb, 0.0, 1.0) * c.a, c.a); }';
DitherFilter.wgsl = 'fn b2(a0: vec2f) -> f32 { let a = floor(a0); return fract(dot(a, vec2f(0.5, a.y * 0.75))); } fn b4(a: vec2f) -> f32 { return b2(0.5 * a) * 0.25 + b2(a); } fn b8(a: vec2f) -> f32 { return b4(0.5 * a) * 0.25 + b2(a); }' +
  'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let c = sampleTex(uv); if (c.a <= 0.0) { return c; } let n = max(u.p[0].x, 2.0) - 1.0; let d = b8(pixelPos(coord) / max(u.p[0].y, 1.0)) - 0.5; let rgb = floor(c.rgb / c.a * n + 0.5 + d) / n; return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)) * c.a, c.a); }';

/* ================================================================= Threshold */
class ThresholdFilter extends Filter { constructor(t) { super(); this.threshold = t === undefined ? 0.5 : t; } }
defParams(ThresholdFilter, { threshold: 0 });
ThresholdFilter.key = 'threshold';
ThresholdFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec4 c = sampleTex(uv); float l = luma(c.a > 0.0 ? c.rgb / c.a : c.rgb); return vec4(vec3(step(uP[0].x, l)) * c.a, c.a); }';
ThresholdFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let c = sampleTex(uv); var rgb = c.rgb; if (c.a > 0.0) { rgb = c.rgb / c.a; } return vec4f(vec3f(step(u.p[0].x, luma(rgb))) * c.a, c.a); }';

/* =============================================================== Convolution */
class ConvolutionFilter extends Filter {
  constructor(matrix, options) {
    super();
    this.setMatrix(matrix || [0, 0, 0, 0, 1, 0, 0, 0, 0]);
    this.strength = opt(options, 'strength', 1);
    this.padding = 2;
  }
  setMatrix(m) { for (var i = 0; i < 9; i++) this.uniforms[i] = m[i]; return this; }
  get strength() { return this.uniforms[12]; } set strength(v) { this.uniforms[12] = v; }
  apply(r, input, output, rect, blend) { this.uniforms[13] = r.resolution; r.filterPass(this, input, null, output, rect, blend); }
  static emboss(strength) { var s = strength || 2; return new ConvolutionFilter([-s, -1, 0, -1, 1, 1, 0, 1, s]); }
  static sharpen(amount) { var a = amount || 1; return new ConvolutionFilter([0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0]); }
  static edgeDetect() { return new ConvolutionFilter([-1, -1, -1, -1, 8, -1, -1, -1, -1]); }
  static boxBlur() { return new ConvolutionFilter([1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9]); }
}
ConvolutionFilter.key = 'convolution';
ConvolutionFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec2 t = texel() * uP[3].y; vec4 o = sampleTex(uv); vec3 acc = vec3(0.0);' +
  ' acc += sampleTex(uv + vec2(-1.0, -1.0) * t).rgb * uP[0].x; acc += sampleTex(uv + vec2(0.0, -1.0) * t).rgb * uP[0].y; acc += sampleTex(uv + vec2(1.0, -1.0) * t).rgb * uP[0].z;' +
  ' acc += sampleTex(uv + vec2(-1.0, 0.0) * t).rgb * uP[0].w; acc += o.rgb * uP[1].x; acc += sampleTex(uv + vec2(1.0, 0.0) * t).rgb * uP[1].y;' +
  ' acc += sampleTex(uv + vec2(-1.0, 1.0) * t).rgb * uP[1].z; acc += sampleTex(uv + vec2(0.0, 1.0) * t).rgb * uP[1].w; acc += sampleTex(uv + vec2(1.0, 1.0) * t).rgb * uP[2].x;' +
  ' vec3 rgb = mix(o.rgb, clamp(acc, 0.0, o.a), uP[3].x); return vec4(rgb, o.a); }';
ConvolutionFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let t = texel() * u.p[3].y; let o = sampleTex(uv); var acc = vec3f(0.0);' +
  ' acc += sampleTex(uv + vec2f(-1.0, -1.0) * t).rgb * u.p[0].x; acc += sampleTex(uv + vec2f(0.0, -1.0) * t).rgb * u.p[0].y; acc += sampleTex(uv + vec2f(1.0, -1.0) * t).rgb * u.p[0].z;' +
  ' acc += sampleTex(uv + vec2f(-1.0, 0.0) * t).rgb * u.p[0].w; acc += o.rgb * u.p[1].x; acc += sampleTex(uv + vec2f(1.0, 0.0) * t).rgb * u.p[1].y;' +
  ' acc += sampleTex(uv + vec2f(-1.0, 1.0) * t).rgb * u.p[1].z; acc += sampleTex(uv + vec2f(0.0, 1.0) * t).rgb * u.p[1].w; acc += sampleTex(uv + vec2f(1.0, 1.0) * t).rgb * u.p[2].x;' +
  ' let rgb = mix(o.rgb, clamp(acc, vec3f(0.0), vec3f(o.a)), u.p[3].x); return vec4f(rgb, o.a); }';

/* ======================================================================= Dot */
class DotScreenFilter extends Filter { constructor(options) { super(); this.scale = opt(options, 'scale', 1); this.angle = opt(options, 'angle', 5); this.grayscale = opt(options, 'grayscale', 1); } }
defParams(DotScreenFilter, { scale: 0, angle: 1, grayscale: 2 });
DotScreenFilter.key = 'dotscreen';
DotScreenFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec4 c = sampleTex(uv); vec2 P = pixelPos(coord); float s = sin(uP[0].y), co = cos(uP[0].y);' +
  ' vec2 pt = vec2(co * P.x - s * P.y, s * P.x + co * P.y) * uP[0].x; float pattern = sin(pt.x) * sin(pt.y) * 4.0; vec3 rgb = c.a > 0.0 ? c.rgb / c.a : c.rgb;' +
  ' vec3 res = uP[0].z > 0.5 ? vec3(luma(rgb) * 10.0 - 5.0 + pattern) : rgb * 10.0 - 5.0 + pattern; return vec4(clamp(res, 0.0, 1.0) * c.a, c.a); }';
DotScreenFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let c = sampleTex(uv); let P = pixelPos(coord); let s = sin(u.p[0].y); let co = cos(u.p[0].y);' +
  ' let pt = vec2f(co * P.x - s * P.y, s * P.x + co * P.y) * u.p[0].x; let pattern = sin(pt.x) * sin(pt.y) * 4.0; var rgb = c.rgb; if (c.a > 0.0) { rgb = c.rgb / c.a; }' +
  ' var res = rgb * 10.0 - 5.0 + pattern; if (u.p[0].z > 0.5) { res = vec3f(luma(rgb) * 10.0 - 5.0 + pattern); } return vec4f(clamp(res, vec3f(0.0), vec3f(1.0)) * c.a, c.a); }';

/* ================================================================ Reflection */
class ReflectionFilter extends Filter {
  constructor(options) { super(); this.boundary = opt(options, 'boundary', 0.6); this.amplitude = opt(options, 'amplitude', 3); this.wavelength = opt(options, 'wavelength', 40); this.alphaStart = opt(options, 'alphaStart', 0.9); this.alphaEnd = opt(options, 'alphaEnd', 0.2); this.speed = opt(options, 'speed', 2); this.mirror = opt(options, 'mirror', 1); }
}
defParams(ReflectionFilter, { boundary: 0, amplitude: 1, wavelength: 2, alphaStart: 3, alphaEnd: 4, speed: 5, mirror: 6 });
ReflectionFilter.key = 'reflection';
ReflectionFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ float b = uP[0].x; if (coord.y < b) return sampleTex(uv); vec2 fs = frameSize(); float k = (coord.y - b) / max(1.0 - b, 0.0001);' +
  ' float ry = uP[1].z > 0.5 ? b - (coord.y - b) : coord.y; float off = sin((coord.y * fs.y) / max(uP[0].z, 1.0) + uGlobal.x * uP[1].y) * uP[0].y * (0.3 + k);' +
  ' vec4 c = sampleTex(pxToUV(vec2(coord.x * fs.x + off, ry * fs.y))); return c * mix(uP[0].w, uP[1].x, k); }';
ReflectionFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let b = u.p[0].x; if (coord.y < b) { return sampleTex(uv); } let fs = frameSize(); let k = (coord.y - b) / max(1.0 - b, 0.0001);' +
  ' var ry = coord.y; if (u.p[1].z > 0.5) { ry = b - (coord.y - b); } let off = sin((coord.y * fs.y) / max(u.p[0].z, 1.0) + u.glob.x * u.p[1].y) * u.p[0].y * (0.3 + k);' +
  ' let c = sampleTex(pxToUV(vec2f(coord.x * fs.x + off, ry * fs.y))); return c * mix(u.p[0].w, u.p[1].x, k); }';

/* ============================================================== ColorOverlay / Tint flash */
class ColorOverlayFilter extends Filter {
  constructor(color, alpha) { super(); this.color = color === undefined ? 0xffffff : color; this.alpha = alpha === undefined ? 0.5 : alpha; }
  get color() { return getColorParam(this, 0); } set color(v) { setColorParam(this, 0, v); }
  get alpha() { return this.uniforms[3]; } set alpha(v) { this.uniforms[3] = v; }
}
ColorOverlayFilter.key = 'coloroverlay';
ColorOverlayFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec4 c = sampleTex(uv); return vec4(mix(c.rgb, uP[0].rgb * c.a, uP[0].a), c.a); }';
ColorOverlayFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let c = sampleTex(uv); return vec4f(mix(c.rgb, u.p[0].rgb * c.a, u.p[0].a), c.a); }';

/* ============================================================== Lut-like gradient map */
class GradientMapFilter extends Filter {
  /** Mapea la luminancia a una rampa de hasta 4 colores (duotono, mapas de calor, visión térmica) */
  constructor(colors, amount) { super(); this.setColors(colors || [0x000000, 0xffffff]); this.amount = amount === undefined ? 1 : amount; }
  setColors(cs) { var n = Math.min(4, cs.length); this.uniforms[19] = n; for (var i = 0; i < 4; i++) setColorParam(this, i * 4, cs[Math.min(i, n - 1)], 1); return this; }
  get amount() { return this.uniforms[16]; } set amount(v) { this.uniforms[16] = v; }
}
GradientMapFilter.key = 'gradientmap';
GradientMapFilter.glsl = 'vec4 filterMain(vec2 uv, vec2 coord){ vec4 c = sampleTex(uv); vec3 rgb = c.a > 0.0 ? c.rgb / c.a : c.rgb; float l = luma(rgb); float n = uP[4].w - 1.0; float f = l * n; vec3 g;' +
  ' if (f < 1.0) g = mix(uP[0].rgb, uP[1].rgb, f); else if (f < 2.0) g = mix(uP[1].rgb, uP[2].rgb, f - 1.0); else g = mix(uP[2].rgb, uP[3].rgb, f - 2.0);' +
  ' return vec4(mix(rgb, g, uP[4].x) * c.a, c.a); }';
GradientMapFilter.wgsl = 'fn filterMain(uv: vec2f, coord: vec2f) -> vec4f { let c = sampleTex(uv); var rgb = c.rgb; if (c.a > 0.0) { rgb = c.rgb / c.a; } let f = luma(rgb) * (u.p[4].w - 1.0); var g: vec3f;' +
  ' if (f < 1.0) { g = mix(u.p[0].rgb, u.p[1].rgb, f); } else if (f < 2.0) { g = mix(u.p[1].rgb, u.p[2].rgb, f - 1.0); } else { g = mix(u.p[2].rgb, u.p[3].rgb, f - 2.0); }' +
  ' return vec4f(mix(rgb, g, u.p[4].x) * c.a, c.a); }';

/** Catálogo de efectos (para inspectores y la galería) */
var Filters = {
  ColorMatrixFilter: ColorMatrixFilter, GrayscaleFilter: GrayscaleFilter, SepiaFilter: SepiaFilter, InvertFilter: InvertFilter, HueRotateFilter: HueRotateFilter,
  AlphaFilter: AlphaFilter, BlurFilter: BlurFilter, TiltShiftFilter: TiltShiftFilter, GlowFilter: GlowFilter, BloomFilter: BloomFilter, DropShadowFilter: DropShadowFilter,
  OutlineFilter: OutlineFilter, PixelateFilter: PixelateFilter, CRTFilter: CRTFilter, VignetteFilter: VignetteFilter, ChromaticAberrationFilter: ChromaticAberrationFilter,
  RGBSplitFilter: RGBSplitFilter, ShockwaveFilter: ShockwaveFilter, WaveFilter: WaveFilter, HeatHazeFilter: HeatHazeFilter, GlitchFilter: GlitchFilter,
  NoiseFilter: NoiseFilter, OldFilmFilter: OldFilmFilter, BulgePinchFilter: BulgePinchFilter, TwistFilter: TwistFilter, ZoomBlurFilter: ZoomBlurFilter,
  MotionBlurFilter: MotionBlurFilter, GodRaysFilter: GodRaysFilter, PosterizeFilter: PosterizeFilter, DitherFilter: DitherFilter, ThresholdFilter: ThresholdFilter,
  ConvolutionFilter: ConvolutionFilter, DotScreenFilter: DotScreenFilter, ReflectionFilter: ReflectionFilter, ColorOverlayFilter: ColorOverlayFilter, GradientMapFilter: GradientMapFilter
};
Object.keys(Filters).forEach(function (k) { UG[k] = Filters[k]; });
UG.Filters = Filters;
