/* UltraGame - luces 2D, nubes, cielo y clima para juegos 2D.
 * - Luces: capa de luz (RenderTexture a baja resolución) que empieza con el color ambiente, suma cada luz con una
 *   textura radial y se multiplica sobre el mundo. Sombras reales: polígono de visibilidad de cada luz contra los
 *   oclusores (rectángulos, polígonos, capas de tilemap, cuerpos rígidos, objetos). Funciona en todos los backends.
 * - Nubes procedurales en capas con parallax (ruido periódico: se repiten sin costuras), cielo en degradado.
 * - Clima 2D: lluvia, nieve y tormenta (con relámpagos) sobre la vista. */

var _l2v = new Vec2();
function lightGradientTexture() {
  if (lightGradientTexture._t && !lightGradientTexture._t.source.destroyed) return lightGradientTexture._t;
  var S = 128, d = new Uint8Array(S * S * 4), c = (S - 1) / 2;
  for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
    var r = Math.hypot(x - c, y - c) / c, a = r >= 1 ? 0 : (1 - r * r); a = a * a;
    var o = (y * S + x) * 4; d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = Math.round(a * 255);
  }
  var t = new Texture(new TextureSource({ data: d, width: S, height: S }, { width: S, height: S, label: 'light2d' }));
  Debug.track('TextureSource', -1); // compartida y permanente
  lightGradientTexture._t = t;
  return t;
}

/* ===================================================================== luces */
class Light2D {
  constructor(x, y, radius, color, intensity, o) {
    o = o || {};
    this.x = +x || 0; this.y = +y || 0; this.radius = Math.max(4, +radius || 200); this.color = color === undefined ? 0xffe9c4 : color; this.intensity = intensity === undefined ? 1 : +intensity;
    this.shadows = o.shadows !== false; this.follow = o.follow || null; this.offsetX = o.offsetX || 0; this.offsetY = o.offsetY || 0;
    this.flicker = o.flicker || 0; this.enabled = true; this._t = Math.random() * 100; this.mesh = null;
  }
  setPosition(x, y) { this.x = x; this.y = y; return this; }
}
/** Capa visible de la luz (se dibuja en el HUD con mezcla MULTIPLY y renderiza sus luces justo antes) */
class LightLayer2D extends Sprite {
  constructor(sys) { super(0, 0); this.type = 'LightLayer2D'; this.sys = sys; this.setOrigin(0, 0); this.blendMode = 'multiply'; this.depth = -1e6; }
  _renderGPU(r) { if (this.sys._draw(r)) super._renderGPU(r); }
  _renderCanvas(r) { if (this.sys._draw(r)) super._renderCanvas(r); }
}
class Lights2D {
  constructor(scene) { this.scene = scene; this.enabled = false; this.ambient = 0x202433; this.lights = []; this.occluders = []; this.resolution = 0.5; this.layer = null; this.rt = null; this._root = new Container(); this._segs = []; }
  /** Activa las luces. o: { ambient (color del "apagado"), resolution (0.25..1) } */
  enable(o) {
    o = o || {};
    if (o.ambient !== undefined) this.ambient = o.ambient;
    if (o.resolution) this.resolution = Math.max(0.2, Math.min(1, +o.resolution));
    if (!this.layer) { this.layer = new LightLayer2D(this); this.layer._setScene(this.scene); this.scene.hud.addChild(this.layer); }
    this.layer.visible = true; this.enabled = true;
    return this;
  }
  disable() { this.enabled = false; if (this.layer) this.layer.visible = false; return this; }
  addLight(x, y, radius, color, intensity, o) { var l = new Light2D(x, y, radius, color, intensity, o); this.lights.push(l); if (!this.enabled) this.enable(); return l; }
  removeLight(l) { var i = this.lights.indexOf(l); if (i >= 0) { this.lights.splice(i, 1); if (l.mesh) { l.mesh.destroy(); l.mesh = null; } } return this; }
  /** Oclusor: {x, y, width, height} (rectángulo en el mundo), {points: [x0,y0,...]} (polígono), un objeto del juego (sus límites) o un RigidBody2D */
  addOccluder(o) { if (o) this.occluders.push(o); return o; }
  removeOccluder(o) { var i = this.occluders.indexOf(o); if (i >= 0) this.occluders.splice(i, 1); return this; }
  /** Tiles sólidos de una capa como oclusores (fusionados por filas). o.tiles: índices sólidos (por defecto todos > 0) */
  occludeTilemap(layer, o) {
    o = o || {};
    var data = layer.data || layer.layer && layer.layer.data, tw = layer.tileWidth || (layer.map && layer.map.tileWidth) || 32, th = layer.tileHeight || (layer.map && layer.map.tileHeight) || 32, solid = o.tiles ? new Set(o.tiles) : null, n = 0;
    if (!data) return 0;
    for (var y = 0; y < data.length; y++) {
      var row = data[y], x = 0;
      while (x < row.length) {
        var t = row[x], idx = t && typeof t === 'object' ? t.index : t; if (!(solid ? solid.has(idx) : idx > 0)) { x++; continue; }
        var x0 = x; while (x < row.length) { var t2 = row[x], i2 = t2 && typeof t2 === 'object' ? t2.index : t2; if (!(solid ? solid.has(i2) : i2 > 0)) break; x++; }
        this.occluders.push({ x: (layer.x || 0) + x0 * tw, y: (layer.y || 0) + y * th, width: (x - x0) * tw, height: th }); n++;
      }
    }
    return n;
  }
  /** Cuerpos de un RigidWorld2D como oclusores (estáticos; con dynamic: true también los que se mueven) */
  occludeRigid(world, o) { o = o || {}; this._rigid = { world: world, dynamic: !!o.dynamic }; return this; }
  _collectSegs(x0, y0, x1, y1) {
    var S = this._segs; S.length = 0;
    var pushPoly = function (P) { for (var i = 0; i < P.length; i += 2) { var j = (i + 2) % P.length; S.push(P[i], P[i + 1], P[j], P[j + 1]); } };
    var inBox = function (mnx, mny, mxx, mxy) { return !(mxx < x0 || mnx > x1 || mxy < y0 || mny > y1); };
    for (var i = 0; i < this.occluders.length; i++) {
      var oc = this.occluders[i];
      if (oc.points) { var P = oc.points, mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity; for (var k = 0; k < P.length; k += 2) { mnx = Math.min(mnx, P[k]); mxx = Math.max(mxx, P[k]); mny = Math.min(mny, P[k + 1]); mxy = Math.max(mxy, P[k + 1]); } if (inBox(mnx, mny, mxx, mxy)) pushPoly(P); continue; }
      if (oc instanceof RigidBody2D) { this._bodySegs(oc, pushPoly, inBox); continue; }
      var r = oc.width !== undefined && oc.getBounds === undefined ? oc : (oc.getBounds ? oc.getBounds() : null); if (!r || oc.destroyed || oc.visible === false) continue;
      if (inBox(r.x, r.y, r.x + r.width, r.y + r.height)) pushPoly([r.x, r.y, r.x + r.width, r.y, r.x + r.width, r.y + r.height, r.x, r.y + r.height]);
    }
    if (this._rigid && !this._rigid.world.destroyed) { var self = this, rw = this._rigid; rw.world.bodies.forEach(function (b) { if (b.type === 'static' || rw.dynamic) self._bodySegs(b, pushPoly, inBox); }); }
    return S;
  }
  _bodySegs(b, pushPoly, inBox) {
    if (!b.enabled || !inBox(b.min.x, b.min.y, b.max.x, b.max.y)) return;
    for (var s = 0; s < b.shapes.length; s++) {
      var sh = b.shapes[s]; if (sh.sensor) continue;
      if (sh.type === 'poly') { var W = sh.wv, P = []; for (var i = 0; i < W.length; i++) P.push(W[i].x, W[i].y); pushPoly(P); }
      else { var C = [], n = 10; for (var k = 0; k < n; k++) { var a = k / n * Math.PI * 2; C.push(sh.wc.x + Math.cos(a) * sh.radius, sh.wc.y + Math.sin(a) * sh.radius); } pushPoly(C); }
    }
  }
  /** Polígono de visibilidad de una luz (abanico de puntos en el mundo) */
  _visibility(lx, ly, R, segs) {
    var S = segs.slice(), x0 = lx - R, y0 = ly - R, x1 = lx + R, y1 = ly + R, angs = [], pts = [];
    S.push(x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0);
    for (var i = 0; i < S.length; i += 2) { var a = Math.atan2(S[i + 1] - ly, S[i] - lx); angs.push(a - 1e-4, a, a + 1e-4); }
    angs.sort(function (p, q) { return p - q; });
    var last = null;
    for (var k = 0; k < angs.length; k++) {
      if (last !== null && angs[k] - last < 1e-5) continue; last = angs[k];
      var dx = Math.cos(angs[k]), dy = Math.sin(angs[k]), best = Infinity;
      for (var s2 = 0; s2 < S.length; s2 += 4) {
        var ax = S[s2], ay = S[s2 + 1], bx = S[s2 + 2], by = S[s2 + 3], ex = bx - ax, ey = by - ay, den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) continue;
        var t = ((ax - lx) * ey - (ay - ly) * ex) / den, u = ((ax - lx) * dy - (ay - ly) * dx) / den;
        if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
      }
      if (best === Infinity) best = R * 1.5;
      pts.push(lx + dx * best, ly + dy * best);
    }
    return pts;
  }
  _draw(r) {
    if (!this.enabled || !this.scene || !this.scene.cameras) return false;
    var g = this.scene.game, W = g.width, H = g.height, cam = this.scene.cameras.main; if (!cam) return false;
    cam.preRender();
    if (!this.rt || this.rt.width !== W || this.rt.height !== H || Math.abs(this.rt.source.resolution - this.resolution) > 1e-6) {
      if (this.rt) this.rt.destroy();
      this.rt = new RenderTexture(W, H, this.resolution, { label: 'Lights2D' }); this.layer.setTexture(this.rt);
    }
    var tex = lightGradientTexture(), view = cam.worldView, now = g.loop ? g.loop.time / 1000 : 0, used = 0;
    for (var i = 0; i < this.lights.length; i++) {
      var L = this.lights[i];
      if (L.follow && !L.follow.destroyed) { L.x = L.follow.x + L.offsetX; L.y = L.follow.y + L.offsetY; }
      var R = L.radius, vis = L.enabled && L.intensity > 0 && !(L.x + R < view.x || L.x - R > view.x + view.width || L.y + R < view.y || L.y - R > view.y + view.height);
      if (!L.mesh) { L.mesh = new Mesh(tex, [], [], null); L.mesh.blendMode = 'add'; this._root.addChild(L.mesh); }
      L.mesh.visible = vis; if (!vis) continue;
      var pts, segs = L.shadows ? this._collectSegs(L.x - R, L.y - R, L.x + R, L.y + R) : null;
      if (segs && segs.length) { var poly = this._visibility(L.x, L.y, R, segs); pts = [L.x, L.y].concat(poly, poly[0], poly[1]); }
      else pts = [L.x, L.y, L.x - R, L.y - R, L.x + R, L.y - R, L.x + R, L.y + R, L.x - R, L.y + R, L.x - R, L.y - R];
      var m = L.mesh, n = pts.length;
      if (m.vertices.length !== n) { m.vertices = new Float32Array(n); m.uvs = new Float32Array(n); m.indices = null; }
      for (var k = 0; k < n; k += 2) { m.vertices[k] = pts[k]; m.vertices[k + 1] = pts[k + 1]; m.uvs[k] = 0.5 + (pts[k] - L.x) / (2 * R); m.uvs[k + 1] = 0.5 + (pts[k + 1] - L.y) / (2 * R); }
      m.dirty = true;
      var fl = L.flicker ? 1 - L.flicker * (0.5 + 0.5 * Math.sin(now * 23 + L._t) * Math.sin(now * 7.7 + L._t * 2)) : 1;
      m.tint = L.color; m.alpha = Math.min(1, L.intensity * fl);
      used++;
    }
    var amb = Color.toNumber(this.ambient);
    r.render(this._root, { target: this.rt, clear: true, clearColor: amb, clearAlpha: 1, transform: cam.matrix });
    // intensidades > 1: segunda pasada solo de esas luces
    void used;
    return true;
  }
  destroy() {
    this.lights.forEach(function (l) { if (l.mesh) l.mesh.destroy(); l.mesh = null; }); this.lights.length = 0; this.occluders.length = 0;
    this._root.destroy(); if (this.rt) { this.rt.destroy(); this.rt = null; }
    if (this.layer && !this.layer.destroyed) this.layer.destroy(); this.layer = null; this.scene = null; this._rigid = null;
  }
}

/* ============================================================ nubes y cielo */
/** Textura de nubes que se repite en horizontal sin costuras (ruido de valor periódico) */
function cloudTexture2D(textures, key, o) {
  if (textures.exists(key)) return key;
  var w = o.width || 512, h = o.height || 160, cov = o.coverage === undefined ? 0.5 : o.coverage, rng = new RNG(o.seed || key), P = 256, perm = [];
  for (var i = 0; i < P; i++) perm[i] = rng.float();
  var val = function (x, y, px) { var ix = ((x % px) + px) % px, iy = y & 255; return perm[(ix * 37 + iy * 91 + ((ix * iy) & 63)) & 255]; };
  var noise = function (x, y, px) { var x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    var a = val(x0, y0, px), b = val(x0 + 1, y0, px), c = val(x0, y0 + 1, px), d = val(x0 + 1, y0 + 1, px); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; };
  textures.generate(key, w, h, function (ctx) {
    var img = ctx.createImageData(w, h), D = img.data;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var s = 0, amp = 0.5, f = 4, norm = 0;
      for (var oc = 0; oc < 5; oc++) { s += amp * noise(x / w * f, y / h * f * (h / w) * 3 + oc * 17, f); norm += amp; amp *= 0.5; f *= 2; }
      s /= norm;
      var edge = Math.sin(y / h * Math.PI); // se desvanece arriba y abajo
      var a = Math.max(0, Math.min(1, (s - (1 - cov)) / 0.22)) * edge;
      var shade = 0.82 + 0.18 * (1 - y / h), o2 = (y * w + x) * 4;
      D[o2] = D[o2 + 1] = D[o2 + 2] = Math.round(255 * shade); D[o2 + 3] = Math.round(a * 235);
    }
    ctx.putImageData(img, 0, 0);
  });
  return key;
}
/**
 * Nubes en capas con parallax (fijas a la cámara y desplazadas según su scroll y el viento).
 * o: { y, height, layers (2), speed (px/s del viento), parallax (0.05..0.5), color, alpha, coverage, seed, depth }
 */
class Clouds2D extends Container {
  constructor(scene, o) {
    super(0, 0);
    o = o || {};
    this.type = 'Clouds2D'; this.scene = scene; this.layers = [];
    var W = scene.game.width, n = Math.max(1, Math.min(5, o.layers || 2)), baseY = o.y === undefined ? 60 : o.y, hgt = o.height || 170;
    for (var i = 0; i < n; i++) {
      var key = cloudTexture2D(scene.textures, '__clouds2d:' + (o.seed || 'nubes') + ':' + i + ':' + (o.coverage === undefined ? 0.5 : o.coverage), { coverage: o.coverage, seed: (o.seed || 'nubes') + i });
      var k = (i + 1) / n, ts = new TilingSprite(W / 2, baseY + i * hgt * 0.35, W, hgt * (0.7 + 0.3 * k)); ts.setTexture(key);
      ts.tint = o.color === undefined ? 0xffffff : o.color; ts.alpha = (o.alpha === undefined ? 0.9 : o.alpha) * (0.55 + 0.45 * k);
      ts.tileScaleX = ts.tileScaleY = 0.8 + 0.5 * k; ts.setScrollFactor(0);
      this.addChild(ts);
      this.layers.push({ s: ts, speed: (o.speed === undefined ? 12 : o.speed) * (0.5 + k), parallax: (o.parallax === undefined ? 0.15 : o.parallax) * (0.4 + k) });
    }
    this.depth = o.depth === undefined ? -1000 : o.depth; this._t = 0;
  }
  preUpdate(time, delta) {
    this._t += delta / 1000;
    var cam = this.scene && this.scene.cameras ? this.scene.cameras.main : null, sx = cam ? cam.scrollX : 0;
    for (var i = 0; i < this.layers.length; i++) { var L = this.layers[i]; L.s.tilePositionX = -sx * L.parallax - this._t * L.speed; }
  }
}
GameObjectFactory.prototype.clouds = function (o) { return this._add(new Clouds2D(this.scene, o)); };
/** Cielo en degradado vertical a pantalla completa (fijo a la cámara, detrás de todo) */
GameObjectFactory.prototype.skyGradient = function (top, bottom, o) {
  o = o || {};
  var g = this.scene.game, gr = new Graphics(); gr.fillGradientStyle(top === undefined ? 0x4dabf7 : top, top === undefined ? 0x4dabf7 : top, bottom === undefined ? 0xd0ebff : bottom, bottom === undefined ? 0xd0ebff : bottom, 1).fillRect(0, 0, g.width, g.height);
  gr.setScrollFactor(0); gr.depth = o.depth === undefined ? -2000 : o.depth;
  return this._add(gr);
};

/* ================================================================ clima 2D */
var WEATHER2D = {
  rain: { tex: 'rain', freq: 12, qty: [2, 4], speedY: [760, 980], speedX: [-90, -40], life: 1100, scale: 1, alpha: 0.55 },
  storm: { tex: 'rain', freq: 6, qty: [4, 7], speedY: [900, 1150], speedX: [-220, -120], life: 950, scale: 1.2, alpha: 0.65, lightning: true },
  snow: { tex: 'snow', freq: 40, qty: [1, 3], speedY: [40, 90], speedX: [-25, 25], life: 9000, scale: [0.4, 1.1], alpha: 0.9 }
};
class Weather2D {
  /** scene.weather2d('rain' | 'storm' | 'snow' | 'clear', { intensity (0..2), onLightning }) */
  constructor(scene, kind, o) { this.scene = scene; this.emitter = null; this.kind = null; this.destroyed = false; this.set(kind, o); }
  set(kind, o) {
    o = o || {};
    var s = this.scene, W = s.game.width, H = s.game.height, P = WEATHER2D[kind];
    if (this.emitter) { this.emitter.destroy(); this.emitter = null; }
    if (this._lt) { this._lt.remove(); this._lt = null; }
    this.kind = P ? kind : 'clear';
    if (!P) return this;
    var T = s.textures;
    if (!T.exists('__rain2d')) T.generate('__rain2d', 2, 18, function (c) { var g = c.createLinearGradient(0, 0, 0, 18); g.addColorStop(0, 'rgba(200,220,255,0)'); g.addColorStop(1, 'rgba(200,220,255,1)'); c.fillStyle = g; c.fillRect(0, 0, 2, 18); });
    if (!T.exists('__snow2d')) T.generate('__snow2d', 12, 12, function (c) { var g = c.createRadialGradient(6, 6, 0, 6, 6, 6); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 12, 12); });
    var k = o.intensity === undefined ? 1 : Math.max(0.05, Math.min(2, +o.intensity));
    this.emitter = s.add.hud.particles(P.tex === 'rain' ? '__rain2d' : '__snow2d', {
      x: [-W * 0.2, W * 1.2], y: [-40, -10], speedX: P.speedX, speedY: P.speedY, lifespan: P.tex === 'snow' ? P.life : Math.round((H + 80) / P.speedY[0] * 1000), frequency: P.freq / k,
      quantity: P.qty, scale: P.scale, alpha: P.alpha, maxParticles: Math.round(1200 * k) + 50, angleAlign: P.tex === 'rain'
    });
    this.emitter.depth = -500;
    if (P.lightning) {
      var self = this, strike = function () {
        if (self.destroyed || !s.cameras) return;
        s.cameras.main.flash(160, 0xe6ebff, 0.85);
        if (s.sound && !s.sound.disabled) s.sound.playSfx({ preset: 'thunder', seed: 1 + Math.floor(Math.random() * 3) }, { volume: 0.5 });
        if (o.onLightning) { try { o.onLightning(); } catch (e) { Log.error('weather2d.onLightning:', e); } }
        self._lt = s.time.delayedCall(4000 + Math.random() * 9000, strike);
      };
      this._lt = s.time.delayedCall(2500 + Math.random() * 4000, strike);
    }
    return this;
  }
  destroy() { if (this.destroyed) return; this.destroyed = true; if (this.emitter && !this.emitter.destroyed) this.emitter.destroy(); this.emitter = null; if (this._lt) this._lt.remove(); this._lt = null; this.scene = null; }
}

/** this.weather2d('rain' | 'storm' | 'snow' | 'clear', opciones) en cualquier escena */
Scene.prototype.weather2d = function (kind, o) { var sys = this.sys; if (sys._weather2d && !sys._weather2d.destroyed) return sys._weather2d.set(kind, o); return (sys._weather2d = new Weather2D(this, kind, o)); };

UG.Lights2D = Lights2D; UG.Light2D = Light2D; UG.LightLayer2D = LightLayer2D; UG.Clouds2D = Clouds2D; UG.Weather2D = Weather2D; UG.cloudTexture2D = cloudTexture2D;
