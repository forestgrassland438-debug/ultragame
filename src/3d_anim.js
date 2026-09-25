/* UltraGame 3D - animación: clips (glTF/Blender o por código), mezclador con fundidos, bucles y eventos.
 * Pistas por nodo: position | quaternion | scale, interpolación LINEAR, STEP o CUBICSPLINE (spline de Hermite de glTF). */

var _aq = new Float32Array(4), _aq2 = new Float32Array(4), _av = new Float32Array(4);

class AnimationClip3D {
  /** tracks: [{ target: nombre|índice de nodo, path: 'position'|'quaternion'|'scale', times: Float32Array, values: Float32Array, interpolation }] */
  constructor(name, tracks, duration) {
    this.name = String(name || 'clip'); this.tracks = [];
    var max = 0;
    for (var i = 0; i < (tracks || []).length; i++) {
      var t = tracks[i];
      if (!t || !t.times || !t.values || !t.times.length) continue;
      if (t.path !== 'position' && t.path !== 'quaternion' && t.path !== 'scale') continue;
      var stride = t.path === 'quaternion' ? 4 : 3, cubic = t.interpolation === 'CUBICSPLINE';
      if (t.values.length < t.times.length * stride * (cubic ? 3 : 1)) { Log.warnOnce('trk:' + this.name + i, 'Pista de animación con datos incompletos: se omite'); continue; }
      var tr = { target: t.target, path: t.path, times: t.times instanceof Float32Array ? t.times : new Float32Array(t.times), values: t.values instanceof Float32Array ? t.values : new Float32Array(t.values), interpolation: t.interpolation === 'STEP' || cubic ? t.interpolation : 'LINEAR', stride: stride, _last: 0 };
      this.tracks.push(tr);
      var end = tr.times[tr.times.length - 1]; if (end > max) max = end;
    }
    this.duration = duration >= 0 ? duration : max;
  }
  /**
   * Clip desde claves legibles:
   * AnimationClip3D.fromKeys('saltar', { cuerpo: { position: [[0, 0,0,0], [0.3, 0,1,0], [0.6, 0,0,0]], rotationY: [[0, 0], [0.6, 6.283]] } })
   * Admite position, scale, quaternion y rotationX/Y/Z (radianes, se convierten a cuaterniones).
   */
  static fromKeys(name, spec, interpolation) {
    var tracks = [];
    Object.keys(spec || {}).forEach(function (target) {
      if (Security.isForbiddenKey(target)) return;
      var s = spec[target];
      ['position', 'scale', 'quaternion'].forEach(function (path) {
        var keys = s[path]; if (!Array.isArray(keys) || !keys.length) return;
        var st = path === 'quaternion' ? 4 : 3, times = new Float32Array(keys.length), vals = new Float32Array(keys.length * st);
        keys.forEach(function (k, i) { times[i] = +k[0] || 0; for (var j = 0; j < st; j++) vals[i * st + j] = +k[1 + j] || 0; });
        tracks.push({ target: target, path: path, times: times, values: vals, interpolation: interpolation });
      });
      ['rotationX', 'rotationY', 'rotationZ'].forEach(function (path, ax) {
        var keys = s[path]; if (!Array.isArray(keys) || !keys.length) return;
        // se subdivide para que ángulos grandes (vueltas completas) se interpolen bien
        var times = [], vals = [], q = new Quat();
        for (var i = 0; i < keys.length; i++) {
          var a0 = +keys[i][1] || 0, t0 = +keys[i][0] || 0;
          var steps = i < keys.length - 1 ? Math.max(1, Math.ceil(Math.abs((+keys[i + 1][1] || 0) - a0) / 0.5)) : 1;
          for (var k = 0; k < steps; k++) {
            var u = k / steps, t = i < keys.length - 1 ? t0 + ((+keys[i + 1][0] || 0) - t0) * u : t0, a = i < keys.length - 1 ? a0 + ((+keys[i + 1][1] || 0) - a0) * u : a0;
            q.setFromEuler(ax === 0 ? a : 0, ax === 1 ? a : 0, ax === 2 ? a : 0);
            times.push(t); vals.push(q.x, q.y, q.z, q.w);
          }
        }
        tracks.push({ target: target, path: 'quaternion', times: times, values: vals, interpolation: interpolation });
      });
    });
    return new AnimationClip3D(name, tracks);
  }
}

/** Evalúa una pista en t (segundos) y escribe en out */
function sampleTrack3D(tr, t, out) {
  var times = tr.times, n = times.length, st = tr.stride, v = tr.values, cubic = tr.interpolation === 'CUBICSPLINE', j;
  var val = function (k, o) { var base = cubic ? (k * 3 + 1) * st : k * st; for (var q = 0; q < st; q++) o[q] = v[base + q]; };
  if (n === 1 || t <= times[0]) { val(0, out); return out; }
  if (t >= times[n - 1]) { val(n - 1, out); return out; }
  var i = tr._last;
  if (i >= n - 1 || times[i] > t || times[i + 1] <= t) {
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
    i = lo; tr._last = i;
  }
  var t0 = times[i], t1 = times[i + 1], dt = t1 - t0, s = dt > 0 ? (t - t0) / dt : 0;
  if (tr.interpolation === 'STEP') { val(i, out); return out; }
  if (cubic) {
    var s2 = s * s, s3 = s2 * s, h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    var p0 = (i * 3 + 1) * st, m0 = (i * 3 + 2) * st, p1 = ((i + 1) * 3 + 1) * st, m1 = ((i + 1) * 3) * st;
    for (j = 0; j < st; j++) out[j] = h00 * v[p0 + j] + h10 * dt * v[m0 + j] + h01 * v[p1 + j] + h11 * dt * v[m1 + j];
    if (st === 4) normQ(out);
    return out;
  }
  var a = i * st, b = (i + 1) * st;
  if (st === 4) {
    // slerp por el camino corto
    var ax = v[a], ay = v[a + 1], az = v[a + 2], aw = v[a + 3], bx = v[b], by = v[b + 1], bz = v[b + 2], bw = v[b + 3];
    var cos = ax * bx + ay * by + az * bz + aw * bw;
    if (cos < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; cos = -cos; }
    var k0, k1;
    if (cos > 0.9995) { k0 = 1 - s; k1 = s; }
    else { var th = Math.acos(Math.min(1, cos)), sn = Math.sin(th); k0 = Math.sin((1 - s) * th) / sn; k1 = Math.sin(s * th) / sn; }
    out[0] = ax * k0 + bx * k1; out[1] = ay * k0 + by * k1; out[2] = az * k0 + bz * k1; out[3] = aw * k0 + bw * k1;
    normQ(out);
    return out;
  }
  for (j = 0; j < st; j++) out[j] = v[a + j] + (v[b + j] - v[a + j]) * s;
  return out;
}
function normQ(q) { var l = Math.hypot(q[0], q[1], q[2], q[3]); if (l > 1e-9) { q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l; } else { q[0] = q[1] = q[2] = 0; q[3] = 1; } }

class AnimationAction3D {
  constructor(mixer, clip) {
    this.mixer = mixer; this.clip = clip;
    this.time = 0; this.speed = 1; this.weight = 1; this.loop = 'repeat'; this.repetitions = Infinity;
    this.playing = false; this.paused = false; this.clampWhenFinished = true;
    this._fade = null; this._eff = 0; this._loops = 0; this._dir = 1; this._bindings = null;
  }
  get name() { return this.clip.name; }
  get isRunning() { return this.playing && !this.paused; }
  get progress() { return this.clip.duration > 0 ? this.time / this.clip.duration : 0; }
  play() { if (!this.playing) { this.playing = true; this._fade = null; this._eff = this.weight; } this.paused = false; return this; }
  stop() { this.playing = false; this._fade = null; this._eff = 0; this.time = 0; this._loops = 0; this._dir = 1; return this; }
  reset() { this.time = this.speed < 0 ? this.clip.duration : 0; this._loops = 0; this._dir = 1; this.paused = false; return this; }
  setLoop(mode, repetitions) { this.loop = mode === 'once' || mode === 'pingpong' ? mode : 'repeat'; this.repetitions = repetitions > 0 ? repetitions : Infinity; return this; }
  fadeIn(d) { if (!this.playing) { this.playing = true; this.paused = false; this._eff = 0; } this._fade = { from: this._eff, to: this.weight, t: 0, d: Math.max(1e-4, d || 0.25) }; return this; }
  fadeOut(d) { if (this.playing) this._fade = { from: this._eff, to: 0, t: 0, d: Math.max(1e-4, d || 0.25), stop: true }; return this; }
  crossFadeTo(other, d) { this.fadeOut(d); other.reset().fadeIn(d); return other; }
  _advance(dt) {
    if (!this.playing) return;
    if (this._fade) {
      var f = this._fade; f.t += dt; var k = Math.min(1, f.t / f.d);
      this._eff = f.from + (f.to - f.from) * k;
      if (k >= 1) { this._fade = null; if (f.stop) { this.stop(); return; } }
    } else this._eff = this.weight;
    if (this.paused) return;
    var D = this.clip.duration, step = dt * this.speed * this.mixer.timeScale * this._dir;
    if (D <= 0) { this.time = 0; return; }
    this.time += step;
    if (this.loop === 'once') {
      if (this.time >= D || this.time <= 0) {
        this.time = this.time >= D ? D : 0;
        if (this.clampWhenFinished) this.paused = true; else this.stop();
        this.mixer.emit('finished', this);
      }
      return;
    }
    var wrapped = false, wraps = 1;
    if (this.loop === 'pingpong') {
      if (Math.abs(this.time) > D * 64) this.time = this.time % (2 * D); // evita bucles largos con dt enormes
      wraps = 0;
      while (this.time > D || this.time < 0) { if (this.time > D) { this.time = 2 * D - this.time; this._dir = -this._dir; } else { this.time = -this.time; this._dir = -this._dir; } wrapped = true; wraps++; }
    } else {
      if (this.time >= D || this.time < 0) { wraps = Math.floor(this.time / D); this.time = ((this.time % D) + D) % D; wrapped = true; }
    }
    if (wrapped) {
      // un paso grande puede dar varias vueltas: se cuentan todas
      this._loops += Math.max(1, Math.abs(wraps));
      if (this._loops >= this.repetitions) { this.time = step > 0 ? D : 0; if (this.clampWhenFinished) this.paused = true; else this.stop(); this.mixer.emit('finished', this); }
      else for (var le = Math.min(64, Math.max(1, Math.abs(wraps))); le > 0; le--) this.mixer.emit('loop', this);
    }
  }
}

class AnimationMixer3D extends EventEmitter {
  /** root: nodo raíz del modelo; clips: lista de AnimationClip3D (por defecto root.animations) */
  constructor(root, clips) {
    super();
    this.root = root; this.clips = clips || (root && root.animations) || [];
    this.actions = []; this.timeScale = 1;
    this._binds = new Map(); this._list = []; this._scene = null; this.destroyed = false;
    var self = this;
    this._onRootDestroy = function () { self.destroy(); };
    if (root && root.once) root.once('destroy', this._onRootDestroy);
    Debug.track('AnimationMixer3D', 1);
  }
  /** Registra el mezclador en una Scene3D para que la View3D lo actualice sola */
  attach(scene3d) { if (this._scene === scene3d) return this; this.detach(); this._scene = scene3d; if (scene3d && scene3d.mixers.indexOf(this) < 0) scene3d.mixers.push(this); return this; }
  detach() { if (this._scene) { var i = this._scene.mixers.indexOf(this); if (i >= 0) this._scene.mixers.splice(i, 1); this._scene = null; } return this; }
  getClip(name) { if (name instanceof AnimationClip3D) return name; for (var i = 0; i < this.clips.length; i++) if (this.clips[i].name === name) return this.clips[i]; return null; }
  get clipNames() { return this.clips.map(function (c) { return c.name; }); }
  clipAction(clip) {
    clip = this.getClip(clip); if (!clip) return null;
    for (var i = 0; i < this.actions.length; i++) if (this.actions[i].clip === clip) return this.actions[i];
    var a = new AnimationAction3D(this, clip); this.actions.push(a); return a;
  }
  /**
   * Reproduce un clip. options: { fade (s, por defecto 0.2), loop: 'repeat'|'once'|'pingpong', speed, weight, restart, exclusive (true) }
   * Con exclusive, las demás acciones se desvanecen (transición suave caminar → correr).
   */
  play(name, options) {
    options = options || {};
    var a = this.clipAction(name);
    if (!a) { Log.warnOnce('clip:' + name, 'Animación "' + name + '" no encontrada. Disponibles: ' + this.clipNames.join(', ')); return null; }
    var fade = options.fade !== undefined ? options.fade : 0.2;
    if (options.loop) a.setLoop(options.loop, options.repetitions);
    if (options.speed !== undefined) a.speed = options.speed;
    if (options.weight !== undefined) a.weight = options.weight;
    if (options.clamp !== undefined) a.clampWhenFinished = !!options.clamp;
    if (options.exclusive !== false) for (var i = 0; i < this.actions.length; i++) { var o = this.actions[i]; if (o !== a && o.playing) { if (fade > 0) o.fadeOut(fade); else o.stop(); } }
    var wasRunning = a.isRunning && !(a._fade && a._fade.stop);
    if (options.restart || !wasRunning) a.reset();
    if (fade > 0 && !wasRunning) a.fadeIn(fade); else { a._fade = null; a.play(); }
    this.current = a;
    return a;
  }
  stop(name) { if (name === undefined) { this.actions.forEach(function (a) { a.stop(); }); return this; } var a = this.clipAction(name); if (a) a.stop(); return this; }
  isPlaying(name) { var a = this.clipAction(name); return !!(a && a.isRunning); }
  _node(target) {
    var r = this.root;
    if (typeof target === 'number') return r && r._nodeMap ? r._nodeMap[target] || null : null;
    if (r && r._nodeByName && r._nodeByName[target]) return r._nodeByName[target];
    return r ? (r.name === target ? r : r.getObjectByName(target)) : null;
  }
  _binding(node) {
    var b = this._binds.get(node);
    if (!b) {
      b = { node: node, rest: { p: node.position.clone(), q: node.quaternion.clone(), s: node.scale.clone() }, p: new Float32Array(3), q: new Float32Array(4), s: new Float32Array(3), wp: 0, wq: 0, ws: 0, used: false };
      this._binds.set(node, b);
    }
    return b;
  }
  update(dt) {
    if (this.destroyed || !(dt >= 0)) return;
    var list = this._list, i, j, k;
    list.length = 0;
    for (i = 0; i < this.actions.length; i++) {
      var a = this.actions[i];
      a._advance(dt);
      if (!a.playing || a._eff <= 0) continue;
      if (!a._bindings) { var self = this; a._bindings = a.clip.tracks.map(function (tr) { var n = self._node(tr.target); return n ? self._binding(n) : null; }); }
      for (j = 0; j < a.clip.tracks.length; j++) {
        var b = a._bindings[j]; if (!b) continue;
        var tr = a.clip.tracks[j], w = a._eff;
        if (!b.used) { b.used = true; b.wp = b.wq = b.ws = 0; b.p.fill(0); b.q.fill(0); b.s.fill(0); list.push(b); }
        if (tr.path === 'quaternion') {
          var q = sampleTrack3D(tr, a.time, _aq);
          if (b.wq > 0 && (b.q[0] * q[0] + b.q[1] * q[1] + b.q[2] * q[2] + b.q[3] * q[3]) < 0) w = -w; // mismo hemisferio
          for (k = 0; k < 4; k++) b.q[k] += q[k] * w;
          b.wq += Math.abs(w);
        } else {
          var v = sampleTrack3D(tr, a.time, _av), acc = tr.path === 'position' ? b.p : b.s;
          for (k = 0; k < 3; k++) acc[k] += v[k] * w;
          if (tr.path === 'position') b.wp += w; else b.ws += w;
        }
      }
    }
    // aplicar: si el peso total < 1 se completa con la pose de reposo
    for (i = 0; i < list.length; i++) {
      var B = list[i], n = B.node, r = B.rest, rw;
      B.used = false;
      if (B.wp > 0) { rw = Math.max(0, 1 - B.wp); var ip = 1 / Math.max(1, B.wp); n.position.set((B.p[0] + r.p.x * rw) * ip, (B.p[1] + r.p.y * rw) * ip, (B.p[2] + r.p.z * rw) * ip); }
      if (B.ws > 0) { rw = Math.max(0, 1 - B.ws); var is = 1 / Math.max(1, B.ws); n.scale.set((B.s[0] + r.s.x * rw) * is, (B.s[1] + r.s.y * rw) * is, (B.s[2] + r.s.z * rw) * is); }
      if (B.wq > 0) {
        rw = Math.max(0, 1 - B.wq);
        if (rw > 0) { var d = B.q[0] * r.q.x + B.q[1] * r.q.y + B.q[2] * r.q.z + B.q[3] * r.q.w, sg = d < 0 ? -rw : rw; B.q[0] += r.q.x * sg; B.q[1] += r.q.y * sg; B.q[2] += r.q.z * sg; B.q[3] += r.q.w * sg; }
        _aq2[0] = B.q[0]; _aq2[1] = B.q[1]; _aq2[2] = B.q[2]; _aq2[3] = B.q[3]; normQ(_aq2);
        n.quaternion.set(_aq2[0], _aq2[1], _aq2[2], _aq2[3]);
      }
    }
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.detach();
    if (this.root && this.root.off) this.root.off('destroy', this._onRootDestroy);
    this.actions.length = 0; this._binds.clear(); this._list.length = 0;
    this.removeAllListeners(); this.root = null; this.clips = [];
    Debug.track('AnimationMixer3D', -1);
  }
}

UG.AnimationClip3D = AnimationClip3D; UG.AnimationAction3D = AnimationAction3D; UG.AnimationMixer3D = AnimationMixer3D; UG.sampleTrack3D = sampleTrack3D;
