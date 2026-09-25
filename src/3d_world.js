/* UltraGame 3D - mundo: ciclo día/noche, clima (lluvia, nieve, tormenta, niebla), marcas persistentes (decals:
 * agujeros de bala, sangre, quemaduras, charcos), hierba y vegetación instanciadas con viento, dispersión de modelos,
 * agua con olas y rejilla de navegación (A*) para la IA. Todo con instancias (pocas draw calls) y memoria acotada (anillos de capacidad fija). */

var _wv = new Vec3(), _wv2 = new Vec3(), _wq = new Quat(), _wq2 = new Quat(), _wm = new Mat4(), _ws = new Vec3();

/* ================================================================== día / noche */
/** Paleta del cielo por hora (0..24): [hora, arriba, horizonte, suelo, color del sol] */
var DAYNIGHT_KEYS = [
  [0, 0x05070f, 0x121a33, 0x0a0a0e, 0x9fb3ff], [4.8, 0x070a18, 0x1c2140, 0x0d0d12, 0xffb27a], [6, 0x3a4f86, 0xf2a46b, 0x3b352f, 0xffa35c],
  [7.5, 0x3f73c4, 0xe6d3b8, 0x5c5548, 0xffe0b3], [12, 0x2f6fd0, 0xbfdcf5, 0x6d6a60, 0xfff2d0], [16.5, 0x3569c0, 0xd6e1ee, 0x625d52, 0xffe7c2],
  [18.2, 0x3b4f8a, 0xf59a5a, 0x40372d, 0xff9148], [19.5, 0x10173a, 0x5a3a55, 0x14121a, 0xff7a4a], [21, 0x05070f, 0x141b35, 0x0a0a0e, 0x9fb3ff], [24, 0x05070f, 0x121a33, 0x0a0a0e, 0x9fb3ff]
];
function dayNightSample(h, idx) {
  h = ((h % 24) + 24) % 24;
  for (var i = 0; i < DAYNIGHT_KEYS.length - 1; i++) {
    var a = DAYNIGHT_KEYS[i], b = DAYNIGHT_KEYS[i + 1];
    if (h >= a[0] && h <= b[0]) { var t = (h - a[0]) / Math.max(1e-6, b[0] - a[0]); return Color.lerp(a[idx], b[idx], t * t * (3 - 2 * t)); }
  }
  return DAYNIGHT_KEYS[0][idx];
}
/**
 * Ciclo día/noche. options: { time (horas, 0..24), speed (horas de juego por segundo real; 0 = parado), sun (DirectionalLight
 * o el resultado de view.add.sunlight()), hemi, sunIntensity (1.9), hemiIntensity (0.65), azimuth (rad), fog (true: el color de
 * la niebla sigue al horizonte), stars (true), moon (true), onHour(h) }. Se actualiza solo (es un control de la vista).
 */
class DayNight3D {
  constructor(view, o) {
    o = o || {};
    this.view = view; this.enabled = true; this.destroyed = false;
    this.time = o.time === undefined ? 10 : +o.time || 0; this.speed = o.speed === undefined ? 0 : +o.speed || 0;
    var sun = o.sun || null; this.sun = sun && sun.sun ? sun.sun : sun; this.hemi = o.hemi || (sun && sun.hemi) || null;
    this.sunIntensity = o.sunIntensity === undefined ? (this.sun ? this.sun.intensity : 1.9) : o.sunIntensity;
    this.hemiIntensity = o.hemiIntensity === undefined ? (this.hemi ? this.hemi.intensity : 0.65) : o.hemiIntensity;
    this.azimuth = o.azimuth === undefined ? 0.6 : o.azimuth; this.fog = o.fog !== false; this.stars = o.stars !== false; this.moon = o.moon !== false;
    this.onHour = typeof o.onHour === 'function' ? o.onHour : null; this._lastHour = -1;
    this.daylight = 1; this.isNight = false;
    if (!view.scene3d.sky) view.scene3d.setSky({});
    view.addControl(this);
    this.update(0);
  }
  setTime(h) { this.time = ((+h || 0) % 24 + 24) % 24; this.update(0); return this; }
  update(dt) {
    if (!this.view || !this.view.scene3d) return;
    this.time = ((this.time + this.speed * dt) % 24 + 24) % 24;
    var h = this.time, sc = this.view.scene3d, sky = sc.sky || sc.setSky({}).sky;
    // elevación del sol: -1 (medianoche) .. 1 (mediodía); el sol sale a las 6 y se pone a las 18
    var ang = (h - 6) / 12 * Math.PI, el = Math.sin(ang), az = this.azimuth + (h - 12) / 12 * Math.PI;
    var ce = Math.sqrt(Math.max(0, 1 - el * el)), day = smoothstep01((el + 0.08) / 0.33);
    this.daylight = day; this.isNight = day < 0.2;
    sky.top = dayNightSample(h, 1); sky.horizon = dayNightSample(h, 2); sky.bottom = dayNightSample(h, 3); sky.sunColor = dayNightSample(h, 4);
    sky.sunIntensity = smoothstep01((el + 0.04) / 0.14);
    if (this.stars) sky.stars = 1 - smoothstep01((el + 0.15) / 0.3);
    if (this.moon) sky.moon = 1 - smoothstep01((el + 0.1) / 0.25);
    if (this.fog && sc.fog) sc.fog.color = sky.horizon;
    var wf = this.view._weather && !this.view._weather.destroyed ? this.view._weather.lightFactor : 1;
    if (this.sun) {
      // de noche la "luz del sol" es la luna (fría y tenue), en la dirección opuesta
      var night = el < -0.05, e2 = night ? -el : el, c2 = Math.sqrt(Math.max(0, 1 - e2 * e2)), a2 = night ? az + Math.PI : az;
      this.sun.setDirection(-Math.sin(a2) * c2, -Math.max(0.12, e2), -Math.cos(a2) * c2);
      this.sun.intensity = wf * (night ? this.sunIntensity * 0.12 * (1 - day) : this.sunIntensity * Math.max(0.03, smoothstep01((el + 0.02) / 0.3)));
      this.sun.color = night ? 0xaebfff : sky.sunColor;
    }
    if (this.hemi) {
      this.hemi.intensity = wf * this.hemiIntensity * (0.22 + 0.78 * day);
      this.hemi.color = Color.lerp(0x2a3560, 0xcfe4ff, day); this.hemi.groundColor = Color.lerp(0x0e0d12, 0x6b5b45, day);
    }
    var hr = Math.floor(h); if (hr !== this._lastHour) { this._lastHour = hr; if (this.onHour) { try { this.onHour(hr); } catch (e) { Log.error('dayNight.onHour:', e); } } }
    void ce;
  }
  destroy() { if (this.destroyed) return; this.destroyed = true; var v = this.view; this.view = null; this.onHour = null; if (v && v.controls) { var i = v.controls.indexOf(this); if (i >= 0) v.controls.splice(i, 1); } }
}
function smoothstep01(x) { x = x < 0 ? 0 : (x > 1 ? 1 : x); return x * x * (3 - 2 * x); }
View3D.prototype.dayNight = function (o) { if (this._dayNight && !this._dayNight.destroyed) this._dayNight.destroy(); return (this._dayNight = new DayNight3D(this, o)); };

/* ======================================================================= clima */
var WEATHER_PRESETS = {
  clear: { clouds: { coverage: 0.22, color: 0xffffff, opacity: 0.9 }, fog: 1, particles: null, light: 1 },
  cloudy: { clouds: { coverage: 0.62, color: 0xe9edf2, opacity: 0.95 }, fog: 0.8, particles: null, light: 0.8 },
  overcast: { clouds: { coverage: 0.9, color: 0xc4c9d1, opacity: 1, sharpness: 0.6 }, fog: 0.6, particles: null, light: 0.6 },
  rain: { clouds: { coverage: 0.85, color: 0x9aa3ae, opacity: 1, sharpness: 0.55 }, fog: 0.55, particles: 'rain', light: 0.55 },
  storm: { clouds: { coverage: 0.97, color: 0x6c7480, opacity: 1, sharpness: 0.7, speed: 0.05 }, fog: 0.45, particles: 'rain', rate: 900, light: 0.4, lightning: true },
  snow: { clouds: { coverage: 0.8, color: 0xdfe4ea, opacity: 1, sharpness: 0.5 }, fog: 0.5, particles: 'snow', light: 0.75 },
  fog: { clouds: { coverage: 0.7, color: 0xd8dde3, opacity: 1, sharpness: 0.6 }, fog: 0.25, particles: null, light: 0.7 }
};
/** Clima de la vista: view.weather('rain' | 'storm' | 'snow' | 'cloudy' | 'overcast' | 'fog' | 'clear', { intensity, lightning, onLightning }) */
class Weather3D {
  constructor(view, kind, o) {
    this.view = view; this.enabled = true; this.destroyed = false; this.kind = null; this._fx = null; this._flash = 0; this._next = 4; this._fog0 = null; this._base = null; this.factor = 1; this.lightFactor = 1;
    view.addControl(this); this.set(kind || 'clear', o);
  }
  set(kind, o) {
    o = o || {};
    var P = WEATHER_PRESETS[kind] || WEATHER_PRESETS.clear, v = this.view, sc = v.scene3d;
    this.kind = WEATHER_PRESETS[kind] ? kind : 'clear'; this.intensity = o.intensity === undefined ? 1 : Math.max(0, Math.min(2, +o.intensity || 0));
    this.lightning = o.lightning !== undefined ? !!o.lightning : !!P.lightning; this.onLightning = typeof o.onLightning === 'function' ? o.onLightning : null;
    sc.setClouds(P.clouds);
    // niebla: se guarda la original y se acerca según el clima
    if (sc.fog && sc.fog.type === 'linear') { if (!this._fog0) this._fog0 = { near: sc.fog.near, far: sc.fog.far }; sc.fog.near = this._fog0.near * P.fog; sc.fog.far = this._fog0.far * (0.35 + 0.65 * P.fog); }
    this.lightScale = P.light;
    if (this._fx) { this._fx.destroy(); this._fx = null; }
    if (P.particles) {
      var base = PARTICLE3D_PRESETS[P.particles], rate = (P.rate || base.rate) * this.intensity;
      this._fx = v.addParticles(P.particles, { rate: rate, capacity: Math.ceil(rate * base.life[1] * 1.4) + 32, box: [40, 0, 40], offset: [0, P.particles === 'snow' ? 14 : 18, 0], worldSpace: true });
      this._fx.name = 'weather:' + P.particles;
    }
    // luces que se atenúan con el clima (sol y cielo de la escena); la intensidad base se guarda una sola vez
    var base0 = this._base || (this._base = new Map());
    sc.traverse(function (n) { if ((n instanceof DirectionalLight || n instanceof HemisphereLight) && !base0.has(n)) base0.set(n, n.intensity); });
    if (this.factor === undefined) this.factor = 1;
    return this;
  }
  update(dt) {
    var v = this.view; if (!v || !v.scene3d) return;
    var cam = v.camera, fx = this._fx;
    if (fx && !fx.destroyed && cam) { cam.getWorldPosition(_wv); fx.position.set(_wv.x, _wv.y - 2, _wv.z); }
    // atenuación suave hacia el nivel del clima (+ destello de relámpago)
    var k = 1 - Math.exp(-2 * dt), target = this.lightScale;
    if (this.lightning) {
      if ((this._next -= dt) <= 0) { this._next = 3 + Math.random() * 9; this._flash = 1; if (this.onLightning) { try { this.onLightning(); } catch (e) { Log.error('weather.onLightning:', e); } } if (v.emit) v.emit('lightning'); }
    }
    this._flash = Math.max(0, this._flash - dt * 4);
    // factor de luz: el ciclo día/noche lo aplica si está activo; si no, lo aplica el clima a las luces
    this.factor += (target - this.factor) * k;
    var f = this.factor * (1 + this._flash * 2.5), dn = v._dayNight && !v._dayNight.destroyed;
    if (!dn) this._base.forEach(function (b, l) { if (!l.destroyed) l.intensity = b * f; });
    this.lightFactor = f;
  }
  destroy() {
    if (this.destroyed) return; this.destroyed = true;
    if (this._fx && !this._fx.destroyed) this._fx.destroy(); this._fx = null;
    if (this._base) { this._base.forEach(function (b, l) { if (!l.destroyed) l.intensity = b; }); this._base.clear(); }
    var v = this.view; this.view = null; this.onLightning = null;
    if (v && v.controls) { var i = v.controls.indexOf(this); if (i >= 0) v.controls.splice(i, 1); }
  }
}
View3D.prototype.weather = function (kind, o) { if (this._weather && !this._weather.destroyed) return this._weather.set(kind, o); return (this._weather = new Weather3D(this, kind, o)); };

/* ============================================================= decals (marcas) */
/** Texturas procedurales RGBA (sin canvas: funcionan en Node) */
function decalTexture(kind) {
  var cache = decalTexture._c || (decalTexture._c = {});
  if (cache[kind] && !cache[kind].source.destroyed) return cache[kind];
  var S = kind === 'blood' || kind === 'pool' || kind === 'scorch' ? 128 : 64, d = new Uint8Array(S * S * 4), rng = new RNG('decal:' + kind), c = (S - 1) / 2, x, y, o;
  var put = function (x2, y2, r, g, b, a) { var i = (y2 * S + x2) * 4, na = a + d[i + 3] * (1 - a / 255); if (na <= 0) return; d[i] = (r * a + d[i] * d[i + 3] * (1 - a / 255)) / na; d[i + 1] = (g * a + d[i + 1] * d[i + 3] * (1 - a / 255)) / na; d[i + 2] = (b * a + d[i + 2] * d[i + 3] * (1 - a / 255)) / na; d[i + 3] = Math.min(255, na); };
  var blob = function (cx, cy, rad, r, g, b, a, soft) { for (var yy = Math.max(0, Math.floor(cy - rad - 2)); yy <= Math.min(S - 1, Math.ceil(cy + rad + 2)); yy++) for (var xx = Math.max(0, Math.floor(cx - rad - 2)); xx <= Math.min(S - 1, Math.ceil(cx + rad + 2)); xx++) { var dd = Math.hypot(xx - cx, yy - cy); if (dd <= rad + soft) put(xx, yy, r, g, b, a * (dd <= rad ? 1 : 1 - (dd - rad) / soft)); } };
  if (kind === 'bullet') {
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
      var r0 = Math.hypot(x - c, y - c) / c, ang = Math.atan2(y - c, x - c), crack = Math.pow(Math.abs(Math.sin(ang * 5 + 1.3) * Math.sin(ang * 3.1)), 12);
      o = (y * S + x) * 4;
      if (r0 < 0.16) { d[o] = d[o + 1] = d[o + 2] = 8; d[o + 3] = 255; }
      else if (r0 < 0.34) { var k = (r0 - 0.16) / 0.18; d[o] = d[o + 1] = d[o + 2] = 20 + k * 40; d[o + 3] = 235 * (1 - k * 0.45); }
      else if (r0 < 1) { var k2 = (r0 - 0.34) / 0.66, a2 = Math.max(crack * (1 - k2) * 200, (1 - k2) * (1 - k2) * 70); d[o] = d[o + 1] = d[o + 2] = 45; d[o + 3] = a2; }
    }
  } else if (kind === 'blood' || kind === 'pool') {
    var main = kind === 'pool' ? 0.62 : 0.3;
    blob(c, c, c * main, 110, 4, 12, 235, 3);
    var n = kind === 'pool' ? 9 : 26;
    for (var i = 0; i < n; i++) {
      var a3 = rng.float(0, Math.PI * 2), dist = kind === 'pool' ? rng.float(0.35, 0.72) * c : rng.float(0.2, 0.95) * c, rr = kind === 'pool' ? rng.float(0.12, 0.26) * c : rng.float(0.02, 0.12) * c;
      blob(c + Math.cos(a3) * dist, c + Math.sin(a3) * dist, rr, 95 + rng.int(0, 40), 2, 8, 225, 2);
      if (kind === 'blood' && rng.float() < 0.5) { for (var s2 = 0; s2 < 6; s2++) { var dd2 = dist * (0.4 + s2 * 0.1); blob(c + Math.cos(a3) * dd2, c + Math.sin(a3) * dd2, rr * 0.45, 100, 3, 10, 210, 1.5); } }
    }
  } else if (kind === 'scorch') {
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) { var rs = Math.hypot(x - c, y - c) / c, nz = rng.float(0.75, 1); o = (y * S + x) * 4; d[o] = 18; d[o + 1] = 14; d[o + 2] = 12; d[o + 3] = Math.max(0, 1 - rs) * Math.max(0, 1 - rs) * 245 * nz; }
  } else { // crack / genérica
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) { var rc = Math.hypot(x - c, y - c) / c, an = Math.atan2(y - c, x - c), line = Math.pow(Math.abs(Math.cos(an * 4.5)), 30) + Math.pow(Math.abs(Math.cos(an * 7 + 1)), 60); o = (y * S + x) * 4; d[o] = d[o + 1] = d[o + 2] = 235; d[o + 3] = rc < 1 ? Math.min(255, line * 255 * (1 - rc)) : 0; }
  }
  // alfa premultiplicado no: el sombreador divide por alfa (texturas en RGBA recto)
  var t = new Texture(new TextureSource({ data: d, width: S, height: S }, { width: S, height: S, mipmap: true, label: 'decal-' + kind }));
  Debug.track('TextureSource', -1); // compartida y permanente (una por tipo)
  cache[kind] = t;
  return t;
}
var DECAL_TYPES = {
  bullet: { size: 0.13, capacity: 160, color: 0xffffff, roughness: 0.9 },
  blood: { size: 0.9, capacity: 96, color: 0xffffff, roughness: 0.35 },
  pool: { size: 1.6, capacity: 32, color: 0xffffff, roughness: 0.15, grow: 6 },
  scorch: { size: 2.6, capacity: 32, color: 0xffffff, roughness: 1 },
  crack: { size: 0.5, capacity: 48, color: 0xdfe8ee, roughness: 0.5 }
};
/**
 * Marcas pegadas a superficies con un anillo por tipo (la más antigua se reutiliza): 1 draw call por tipo.
 * view.decals.add(tipo, punto, normal, { size, color, rotation, life (s, 0 = permanente), fade (s), grow (s) })
 */
class DecalManager3D {
  constructor(view) { this.view = view; this.sets = {}; this.enabled = true; this.destroyed = false; this.offset = 0.02; this._live = 0; view.addControl(this); }
  _set(type) {
    var s = this.sets[type]; if (s && !s.mesh.destroyed) return s;
    var T = DECAL_TYPES[type] || DECAL_TYPES.bullet, tex = decalTexture(DECAL_TYPES[type] ? type : 'crack');
    var mat = new StandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: T.roughness, metalness: 0, color: T.color, side: 'double' });
    var mesh = new InstancedMesh3D(Geometry3D.plane(1, 1, 1, 1, 'xy'), mat, T.capacity);
    mesh.name = 'decals:' + type; mesh.count = 0; mesh.castShadow = false; mesh.receiveShadow = true; mesh.useInstanceColor = true; mesh.renderOrder = 5; mesh.raycast = false;
    this.view.scene3d.add(mesh);
    s = this.sets[type] = { mesh: mesh, next: 0, items: new Array(T.capacity), T: T };
    return s;
  }
  add(type, point, normal, o) {
    if (this.destroyed || !point) return -1;
    o = o || {};
    var s = this._set(type), T = s.T, i = s.next, cap = s.mesh.capacity;
    s.next = (i + 1) % cap; if (s.mesh.count < cap) s.mesh.count = Math.max(s.mesh.count, i + 1);
    var n = _wv.set(normal ? normal.x : 0, normal ? normal.y : 1, normal ? normal.z : 0); if (n.lengthSq() < 1e-8) n.set(0, 1, 0); n.normalize();
    var size = (o.size || T.size) * (o.scale || 1), rot = o.rotation === undefined ? Math.random() * Math.PI * 2 : o.rotation;
    var it = s.items[i] || (s.items[i] = { p: new Vec3(), q: new Quat(), size: 0, age: 0, life: 0, fade: 0, grow: 0, color: 0xffffff });
    it.p.set(point.x + n.x * this.offset, point.y + n.y * this.offset, point.z + n.z * this.offset);
    _wq.setFromUnitVectors(_wv2.set(0, 0, 1), n); _wq2.setFromAxisAngle(_wv2.set(0, 0, 1), rot); it.q.copy(_wq).multiply(_wq2);
    it.size = size; it.age = 0; it.life = o.life || 0; it.fade = o.fade === undefined ? 1 : o.fade; it.grow = o.grow === undefined ? (T.grow || 0) : o.grow;
    it.color = o.color === undefined ? 0xffffff : o.color; it.alive = true;
    colorToLinear(it.color, s.mesh.instanceColor, i * 4); s.mesh.instanceColor[i * 4 + 3] = 1;
    this._write(s, i, it);
    if (it.life > 0 || it.grow > 0) this._live++;
    return i;
  }
  _write(s, i, it) {
    var k = it.grow > 0 ? 0.25 + 0.75 * smoothstep01(it.age / it.grow) : 1, sz = it.size * k;
    _wm.compose(it.p, it.q, _ws.set(sz, sz, 1)); s.mesh.setMatrixAt(i, _wm);
  }
  /** Borra todas las marcas (o las de un tipo) */
  clear(type) { var self = this; Object.keys(this.sets).forEach(function (k) { if (type && k !== type) return; var s = self.sets[k]; s.mesh.count = 0; s.next = 0; s.items.forEach(function (it) { if (it) it.alive = false; }); s.mesh.instanceVersion++; }); this._live = 0; return this; }
  get count() { var n = 0, self = this; Object.keys(this.sets).forEach(function (k) { n += self.sets[k].mesh.count; }); return n; }
  update(dt) {
    if (!this._live) return;
    var live = 0, self = this;
    Object.keys(this.sets).forEach(function (k) {
      var s = self.sets[k], C = s.mesh.instanceColor, touched = false;
      for (var i = 0; i < s.mesh.count; i++) {
        var it = s.items[i]; if (!it || !it.alive || (it.life <= 0 && it.grow <= 0)) continue;
        it.age += dt; live++;
        if (it.grow > 0 && it.age <= it.grow + dt) { self._write(s, i, it); touched = true; }
        if (it.life > 0) {
          var left = it.life - it.age;
          if (left <= 0) { it.alive = false; C[i * 4 + 3] = 0; touched = true; }
          else if (left < it.fade) { C[i * 4 + 3] = left / it.fade; touched = true; }
        } else if (it.grow > 0 && it.age > it.grow) it.grow = 0;
      }
      if (touched) s.mesh.instanceVersion++;
    });
    this._live = live;
  }
  destroy() {
    if (this.destroyed) return; this.destroyed = true;
    var self = this; Object.keys(this.sets).forEach(function (k) { var m = self.sets[k].mesh; if (!m.destroyed) m.destroy(); }); this.sets = {};
    var v = this.view; this.view = null; if (v && v.controls) { var i = v.controls.indexOf(this); if (i >= 0) v.controls.splice(i, 1); }
  }
}
Object.defineProperty(View3D.prototype, 'decals', { get: function () { if (!this._decals || this._decals.destroyed) this._decals = new DecalManager3D(this); return this._decals; }, configurable: true });
/** Atajo: view.addDecal('bullet', hit.point, hit.normal, opciones) */
View3D.prototype.addDecal = function (type, point, normal, o) { return this.decals.add(type, point, normal, o); };

/* ======================================================= vegetación con viento */
/** Mata de hierba: 3 briznas cruzadas (9 triángulos), color de la base a la punta, normales hacia arriba */
function grassTuftGeometry(base, tip) {
  var pos = [], nrm = [], uv = [], col = [], idx = [], cb = colorToLinear(base), ct = colorToLinear(tip);
  for (var b = 0; b < 3; b++) {
    var a = b * Math.PI / 3 + 0.3, ca = Math.cos(a), sa = Math.sin(a), ox = Math.cos(a * 2.3) * 0.06, oz = Math.sin(a * 1.7) * 0.06, w = 0.045, lean = 0.08 * (b - 1);
    var v0 = pos.length / 3;
    // base (2), mitad (2), punta (1)
    pos.push(ox - ca * w, 0, oz - sa * w, ox + ca * w, 0, oz + sa * w, ox - ca * w * 0.6 + lean * sa, 0.55, oz - sa * w * 0.6 - lean * ca, ox + ca * w * 0.6 + lean * sa, 0.55, oz + sa * w * 0.6 - lean * ca, ox + lean * 1.8 * sa, 1, oz - lean * 1.8 * ca);
    for (var k = 0; k < 5; k++) { nrm.push(0, 1, 0); var t = k < 2 ? 0 : (k < 4 ? 0.55 : 1); col.push(cb[0] + (ct[0] - cb[0]) * t, cb[1] + (ct[1] - cb[1]) * t, cb[2] + (ct[2] - cb[2]) * t, 1); uv.push(k % 2, 1 - t); }
    idx.push(v0, v0 + 1, v0 + 3, v0, v0 + 3, v0 + 2, v0 + 2, v0 + 3, v0 + 4);
  }
  var g = new Geometry3D(); g.setAttribute('position', new Float32Array(pos), 3); g.setAttribute('normal', new Float32Array(nrm), 3); g.setAttribute('uv', new Float32Array(uv), 2); g.setAttribute('color', new Float32Array(col), 4); g.setIndex(idx);
  return g;
}
function areaOf(o) {
  var a = o.area || [-25, -25, 25, 25];
  if (!Array.isArray(a)) a = [a.x - (a.width || 50) / 2, a.z - (a.depth || a.height || 50) / 2, a.x + (a.width || 50) / 2, a.z + (a.depth || a.height || 50) / 2];
  return [Math.min(a[0], a[2]), Math.min(a[1], a[3]), Math.max(a[0], a[2]), Math.max(a[1], a[3])];
}
/**
 * Hierba instanciada por trozos (culling por trozo). options: { area: [x0, z0, x1, z1] | {x, z, width, depth}, density (matas/m², 3),
 * height: [min, max], color, tipColor, wind (0.08), heightAt(x, z), where(x, z) -> bool, seed, chunk (m, 16), max (instancias, 60000) }
 */
function addGrass(view, o) {
  o = o || {};
  var A = areaOf(o), rng = new RNG(o.seed === undefined ? 'grass' : o.seed), dens = Math.max(0, Math.min(40, o.density === undefined ? 3 : +o.density));
  var hMin = o.height ? +o.height[0] || 0.3 : 0.28, hMax = o.height ? +o.height[1] || 0.6 : 0.6, chunk = Math.max(4, +o.chunk || 16), max = Math.max(1, Math.min(250000, o.max || 60000));
  var geo = grassTuftGeometry(o.color === undefined ? 0x3f7f2e : o.color, o.tipColor === undefined ? 0xa9d86b : o.tipColor);
  var mat = new StandardMaterial({ vertexColors: true, roughness: 0.95, side: 'double', flipBackfaceNormals: false, wind: o.wind === undefined ? 0.08 : o.wind });
  var group = new Group3D(); group.name = o.name || 'grass'; group.chunks = [];
  var total = Math.min(max, Math.round((A[2] - A[0]) * (A[3] - A[1]) * dens)), used = 0;
  for (var cz = A[1]; cz < A[3]; cz += chunk) for (var cx = A[0]; cx < A[2]; cx += chunk) {
    var w = Math.min(chunk, A[2] - cx), d = Math.min(chunk, A[3] - cz), n = Math.min(total - used, Math.round(w * d * dens));
    if (n <= 0) continue;
    var list = [];
    for (var i = 0; i < n * 3 && list.length < n; i++) {
      var x = cx + rng.float() * w, z = cz + rng.float() * d;
      if (o.where && !o.where(x, z)) continue;
      list.push([x, o.heightAt ? +o.heightAt(x, z) || 0 : (o.y || 0), z]);
    }
    if (!list.length) continue;
    var im = new InstancedMesh3D(geo, mat, list.length);
    im.castShadow = false; im.receiveShadow = true; im.raycast = false; im.useInstanceColor = true; im.name = 'grass-chunk';
    for (var k = 0; k < list.length; k++) {
      var s = hMin + rng.float() * (hMax - hMin), q = _wq.setFromEuler(0, rng.float() * Math.PI * 2, 0);
      _wm.compose(_wv.set(list[k][0], list[k][1], list[k][2]), q, _ws.set(s * rng.float(0.8, 1.2), s, s * rng.float(0.8, 1.2)));
      im.setMatrixAt(k, _wm);
      var tint = 0.82 + rng.float() * 0.3; im.instanceColor[k * 4] = tint * rng.float(0.9, 1.05); im.instanceColor[k * 4 + 1] = tint; im.instanceColor[k * 4 + 2] = tint * rng.float(0.85, 1); im.instanceColor[k * 4 + 3] = 1;
    }
    group.add(im); group.chunks.push(im); used += list.length;
  }
  group.instances = used;
  view.scene3d.add(group);
  return group;
}
/** Instancias de un modelo cargado (una InstancedMesh3D por malla del modelo). transforms: [{x, y, z, ry, s}] */
function addModelInstances(view, key, transforms, opts) {
  opts = opts || {};
  var sc = view.scene, cache = sc && sc.cache && sc.cache.models ? sc.cache.models : (UG._models || null), model = cache && cache.get ? cache.get(key) : null;
  var group = new Group3D(); group.name = key + '-instances';
  if (!model) { Log.warnOnce('inst:' + key, 'Modelo 3D "' + key + '" no cargado'); view.scene3d.add(group); return group; }
  var tmp = model.instantiate(); tmp.updateMatrixWorld(true);
  var inv = new Mat4().invertFrom(tmp.matrixWorld), local = new Mat4(), inst = new Mat4(), full = new Mat4();
  tmp.traverse(function (n) {
    if (!(n instanceof Mesh3D) || n.skeleton || n.instanced) return;
    var im = new InstancedMesh3D(n.geometry, n.material, Math.max(1, transforms.length));
    im.castShadow = opts.castShadow !== false; im.receiveShadow = opts.receiveShadow !== false; im.count = transforms.length;
    if (opts.wind) { var m2 = n.material.clone(); m2.wind = opts.wind; m2.version++; im.material = m2; }
    local.multiplyMatrices(inv, n.matrixWorld);
    transforms.forEach(function (t, i) {
      var s = t.s || 1;
      inst.compose(_wv.set(t.x || 0, t.y || 0, t.z || 0), _wq.setFromEuler(0, t.ry || 0, 0), _ws.set(s, s, s));
      im.setMatrixAt(i, full.multiplyMatrices(inst, local));
    });
    group.add(im);
  });
  tmp.destroy();
  view.scene3d.add(group);
  return group;
}
/**
 * Dispersa un modelo (clave) o una geometría por un área: árboles, rocas, flores. options: { area, count, scale: [a, b],
 * heightAt, where, seed, minDistance (entre copias), castShadow, wind }. Devuelve el grupo con .transforms.
 */
function addScatter(view, source, o) {
  o = o || {};
  var A = areaOf(o), rng = new RNG(o.seed === undefined ? 'scatter' : o.seed), count = Math.max(0, Math.min(20000, o.count === undefined ? 50 : o.count | 0));
  var sc = o.scale || [0.8, 1.3], minD = o.minDistance || 0, pts = [], tries = count * 20;
  while (pts.length < count && tries-- > 0) {
    var x = A[0] + rng.float() * (A[2] - A[0]), z = A[1] + rng.float() * (A[3] - A[1]);
    if (o.where && !o.where(x, z)) continue;
    if (minD > 0 && pts.some(function (p) { return (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < minD * minD; })) continue;
    pts.push({ x: x, y: o.heightAt ? +o.heightAt(x, z) || 0 : (o.y || 0), z: z, ry: rng.float() * Math.PI * 2, s: sc[0] + rng.float() * (sc[1] - sc[0]) });
  }
  var g;
  if (typeof source === 'string') g = addModelInstances(view, source, pts, o);
  else {
    var geo = source && source.geometry ? source.geometry : source, mat = view.material(source && source.material ? source.material : o.material);
    if (o.wind) { mat.wind = o.wind; mat.version++; }
    var im = new InstancedMesh3D(geo, mat, Math.max(1, pts.length)); im.count = pts.length; im.castShadow = o.castShadow !== false;
    pts.forEach(function (t, i) { im.setTransformAt(i, _wv.set(t.x, t.y, t.z), t.ry, t.s); });
    g = new Group3D(); g.name = 'scatter'; g.add(im); view.scene3d.add(g);
  }
  g.transforms = pts;
  return g;
}
/** Agua con olas: view.add.water(ancho, fondo, { color, opacity, waveHeight, roughness, segments }) */
function addWater(view, w, d, o) {
  o = o || {};
  var seg = Math.max(2, Math.min(256, o.segments || Math.round(Math.max(w, d) / 1.5)));
  var mat = new StandardMaterial({ water: true, waveHeight: o.waveHeight === undefined ? 0.12 : o.waveHeight, color: o.color === undefined ? 0x1d5f93 : o.color, opacity: o.opacity === undefined ? 0.86 : o.opacity,
    transparent: true, roughness: o.roughness === undefined ? 0.06 : o.roughness, metalness: 0, envIntensity: o.envIntensity === undefined ? 1.25 : o.envIntensity });
  var m = new Mesh3D(Geometry3D.plane(w || 50, d || w || 50, seg, seg), mat);
  m.name = o.name || 'water'; m.castShadow = false; m.receiveShadow = true; m.raycast = o.raycast === true;
  view.scene3d.add(m);
  return m;
}
/* =================================================================== navegación */
/**
 * Rejilla de navegación sobre el suelo (x, z) para IA: A* con 8 vecinos (sin cortar esquinas), rutas suavizadas por
 * línea de visión en la rejilla, celda libre más cercana, puntos de cobertura (celdas libres junto a obstáculos).
 * NavGrid3D.fromPhysics(world, { area: [x0, z0, x1, z1], cell (1), radius (0.4), height (1.7), y (0) | heightAt(x, z), mask }).
 */
class NavGrid3D {
  constructor(o) {
    o = o || {};
    var A = areaOf(o);
    this.cell = Math.max(0.1, +o.cell || 1); this.x0 = A[0]; this.z0 = A[1];
    this.w = Math.max(1, Math.min(2048, Math.ceil((A[2] - A[0]) / this.cell))); this.h = Math.max(1, Math.min(2048, Math.ceil((A[3] - A[1]) / this.cell)));
    this.blocked = new Uint8Array(this.w * this.h); this.cost = new Float32Array(this.w * this.h).fill(1);
    this.maxNodes = o.maxNodes || 40000;
    this._g = null; this._f = null; this._from = null; this._open = null; this._stamp = null; this._tick = 0;
  }
  static fromPhysics(world, o) {
    o = o || {};
    var g = new NavGrid3D(o), r = o.radius || 0.4, hgt = o.height || 1.7, c = g.cell;
    for (var j = 0; j < g.h; j++) for (var i = 0; i < g.w; i++) {
      var x = g.x0 + (i + 0.5) * c, z = g.z0 + (j + 0.5) * c, y = o.heightAt ? +o.heightAt(x, z) || 0 : (o.y || 0);
      if (!world.capsuleFree(x, y + 0.06, z, r, hgt, o.mask, 0.02)) g.blocked[j * g.w + i] = 1;
    }
    return g;
  }
  index(i, j) { return i < 0 || j < 0 || i >= this.w || j >= this.h ? -1 : j * this.w + i; }
  cellOf(x, z) { return [Math.floor((x - this.x0) / this.cell), Math.floor((z - this.z0) / this.cell)]; }
  centerOf(i, j, out) { return (out || new Vec3()).set(this.x0 + (i + 0.5) * this.cell, 0, this.z0 + (j + 0.5) * this.cell); }
  isFree(x, z) { var c = this.cellOf(x, z), k = this.index(c[0], c[1]); return k >= 0 && !this.blocked[k]; }
  setBlocked(x, z, on) { var c = this.cellOf(x, z), k = this.index(c[0], c[1]); if (k >= 0) this.blocked[k] = on ? 1 : 0; return this; }
  /** Celda libre más cercana (búsqueda en anillos) o null */
  nearestFree(x, z, maxR) {
    var c = this.cellOf(x, z), R = Math.ceil((maxR || 12) / this.cell);
    var k0 = this.index(c[0], c[1]); if (k0 >= 0 && !this.blocked[k0]) return this.centerOf(c[0], c[1]);
    for (var r = 1; r <= R; r++) {
      var best = null, bd = Infinity;
      for (var dj = -r; dj <= r; dj++) for (var di = -r; di <= r; di++) {
        if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
        var k = this.index(c[0] + di, c[1] + dj); if (k < 0 || this.blocked[k]) continue;
        var d = di * di + dj * dj; if (d < bd) { bd = d; best = [c[0] + di, c[1] + dj]; }
      }
      if (best) return this.centerOf(best[0], best[1]);
    }
    return null;
  }
  /** ¿Se puede ir en línea recta entre dos puntos por celdas libres? (recorrido de la rejilla, con el radio de 1 celda en diagonales) */
  lineFree(ax, az, bx, bz) {
    var c = this.cell, x = (ax - this.x0) / c, z = (az - this.z0) / c, ex = (bx - this.x0) / c, ez = (bz - this.z0) / c;
    var dx = ex - x, dz = ez - z, n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) * 2) + 1;
    for (var s = 0; s <= n; s++) { var t = s / n, i = Math.floor(x + dx * t), j = Math.floor(z + dz * t), k = this.index(i, j); if (k < 0 || this.blocked[k]) return false; }
    return true;
  }
  /**
   * Ruta de from a to ({x, z}): lista de Vec3 (centros de celda, suavizada) o null. Si el destino está bloqueado se usa la
   * celda libre más cercana. options: { smooth (true), maxNodes }
   */
  findPath(from, to, o) {
    o = o || {};
    var W = this.w, H = this.h, N = W * H, B = this.blocked, C = this.cost;
    if (!this._g || this._g.length !== N) { this._g = new Float32Array(N); this._from = new Int32Array(N); this._stamp = new Uint32Array(N); this._closed = new Uint32Array(N); this._tick = 0; }
    var sPt = this.isFree(from.x, from.z) ? from : this.nearestFree(from.x, from.z, 4), tPt = this.isFree(to.x, to.z) ? to : this.nearestFree(to.x, to.z, 8);
    if (!sPt || !tPt) return null;
    var sc = this.cellOf(sPt.x, sPt.z), tc = this.cellOf(tPt.x, tPt.z), s = this.index(sc[0], sc[1]), t = this.index(tc[0], tc[1]);
    if (s < 0 || t < 0) return null;
    var tick = ++this._tick; if (tick > 0xFFFFFFF0) { this._stamp.fill(0); this._closed.fill(0); this._tick = tick = 1; }
    var G = this._g, F = this._from, ST = this._stamp, CL = this._closed, heap = [], hf = [];
    var push = function (k, f) { heap.push(k); hf.push(f); var i = heap.length - 1; while (i > 0) { var p = (i - 1) >> 1; if (hf[p] <= hf[i]) break; var tk = heap[p]; heap[p] = heap[i]; heap[i] = tk; var tf = hf[p]; hf[p] = hf[i]; hf[i] = tf; i = p; } };
    var pop = function () { var top = heap[0], lk = heap.pop(), lf = hf.pop(); if (heap.length) { heap[0] = lk; hf[0] = lf; var i = 0, L = heap.length; for (;;) { var l = i * 2 + 1, r = l + 1, m = i; if (l < L && hf[l] < hf[m]) m = l; if (r < L && hf[r] < hf[m]) m = r; if (m === i) break; var tk = heap[m]; heap[m] = heap[i]; heap[i] = tk; var tf = hf[m]; hf[m] = hf[i]; hf[i] = tf; i = m; } } return top; };
    var ti = t % W, tj = (t / W) | 0, hEst = function (k) { var dx = Math.abs(k % W - ti), dz = Math.abs(((k / W) | 0) - tj); return (dx + dz) + (1.41421356 - 2) * Math.min(dx, dz); };
    G[s] = 0; F[s] = -1; ST[s] = tick; push(s, hEst(s));
    var nodes = 0, max = o.maxNodes || this.maxNodes, found = false;
    var DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
    while (heap.length) {
      var k = pop(); if (CL[k] === tick) continue; CL[k] = tick;
      if (k === t) { found = true; break; }
      if (++nodes > max) break;
      var ki = k % W, kj = (k / W) | 0;
      for (var d = 0; d < 8; d++) {
        var ni = ki + DI[d], nj = kj + DJ[d]; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        var nk = nj * W + ni; if (B[nk] || CL[nk] === tick) continue;
        if (d >= 4 && (B[kj * W + ni] || B[nj * W + ki])) continue; // sin cortar esquinas
        var ng = G[k] + (d >= 4 ? 1.41421356 : 1) * C[nk];
        if (ST[nk] !== tick || ng < G[nk]) { ST[nk] = tick; G[nk] = ng; F[nk] = k; push(nk, ng + hEst(nk)); }
      }
    }
    if (!found) return null;
    var cells = []; for (var q = t; q >= 0; q = F[q]) cells.push(q);
    cells.reverse();
    var pts = cells.map(function (c2) { return this.centerOf(c2 % W, (c2 / W) | 0); }, this);
    if (o.smooth !== false && pts.length > 2) {
      var out = [pts[0]], a = 0;
      for (var b = 2; b < pts.length; b++) if (!this.lineFree(pts[a].x, pts[a].z, pts[b].x, pts[b].z)) { out.push(pts[b - 1]); a = b - 1; }
      out.push(pts[pts.length - 1]); pts = out;
    }
    pts[pts.length - 1] = new Vec3(tPt.x, 0, tPt.z);
    return pts;
  }
  /** Celdas libres junto a un obstáculo (para ponerse a cubierto), dentro de un radio opcional */
  coverPoints(center, radius) {
    var out = [], W = this.w, B = this.blocked, r2 = radius ? radius * radius : Infinity;
    for (var j = 1; j < this.h - 1; j++) for (var i = 1; i < W - 1; i++) {
      var k = j * W + i; if (B[k]) continue;
      if (!(B[k - 1] || B[k + 1] || B[k - W] || B[k + W])) continue;
      var p = this.centerOf(i, j); if (center && (p.x - center.x) * (p.x - center.x) + (p.z - center.z) * (p.z - center.z) > r2) continue;
      out.push(p);
    }
    return out;
  }
  /** Punto libre aleatorio (opcionalmente cerca de un centro) */
  randomFree(rng, center, radius) {
    var R = rng && rng.float ? function () { return rng.float(); } : Math.random;
    for (var n = 0; n < 200; n++) {
      var x, z;
      if (center) { var a = R() * Math.PI * 2, d = Math.sqrt(R()) * (radius || 10); x = center.x + Math.cos(a) * d; z = center.z + Math.sin(a) * d; }
      else { x = this.x0 + R() * this.w * this.cell; z = this.z0 + R() * this.h * this.cell; }
      if (this.isFree(x, z)) { var c = this.cellOf(x, z); return this.centerOf(c[0], c[1]); }
    }
    return null;
  }
  get freeCount() { var n = 0; for (var i = 0; i < this.blocked.length; i++) if (!this.blocked[i]) n++; return n; }
}

UG.NavGrid3D = NavGrid3D; UG.DayNight3D = DayNight3D; UG.Weather3D = Weather3D; UG.DecalManager3D = DecalManager3D; UG.DECAL_TYPES = DECAL_TYPES; UG.WEATHER_PRESETS = WEATHER_PRESETS;
UG.grassTuftGeometry = grassTuftGeometry; UG.decalTexture = decalTexture;
