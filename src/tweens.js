/* UltraGame - tweens y temporizadores.
 * Tween: múltiples objetivos/propiedades, valores relativos ('+=10'), funciones, from/to, yoyo, repeat, hold,
 * delays escalonados (stagger), colores, easing por propiedad, cadenas, contadores, timeScale y promesas.
 * Un tween se detiene solo si su objetivo es destruido (no retiene objetos muertos => sin fugas). */

var TWEEN_RESERVED = {
  targets: 1, target: 1, duration: 1, delay: 1, ease: 1, easeParams: 1, repeat: 1, repeatDelay: 1, yoyo: 1, hold: 1, loop: 1, loopDelay: 1,
  paused: 1, persist: 1, timeScale: 1, props: 1, onStart: 1, onUpdate: 1, onComplete: 1, onYoyo: 1, onRepeat: 1, onLoop: 1, onStop: 1,
  onActive: 1, callbackScope: 1, completeDelay: 1, flipX: 1, flipY: 1, interpolation: 1, color: 1, name: 1, from: 1, to: 1, useFrames: 1
};
var COLOR_KEY = /tint|color/i;

function resolvePath(target, key) {
  if (key.indexOf('.') < 0) return { obj: target, key: key };
  var parts = key.split('.'), o = target;
  for (var i = 0; i < parts.length - 1; i++) { if (isForbiddenKey(parts[i]) || o === null || o === undefined) return null; o = o[parts[i]]; }
  var k = parts[parts.length - 1];
  if (isForbiddenKey(k) || o === null || o === undefined) return null;
  return { obj: o, key: k };
}

class TweenData {
  constructor(tween, target, key, spec, index, total) {
    this.tween = tween; this.target = target; this.key = key; this.index = index;
    var ref = resolvePath(target, key);
    this.ref = ref;
    var t = tween.config;
    var vspec = spec, from, to;
    if (spec !== null && typeof spec === 'object' && !Array.isArray(spec)) {
      vspec = spec.value !== undefined ? spec.value : spec.to;
      from = spec.from; if (spec.start !== undefined) from = spec.start;
      if (spec.to !== undefined && spec.value === undefined) vspec = spec.to;
      this.ease = Easing.get(spec.ease || t.ease);
      this.duration = spec.duration !== undefined ? spec.duration : tween.duration;
      this.delay = spec.delay !== undefined ? tween._resolveDelay(spec.delay, target, key, index, total) : tween._resolveDelay(t.delay, target, key, index, total);
      this.yoyo = spec.yoyo !== undefined ? !!spec.yoyo : tween.yoyo;
      this.repeat = spec.repeat !== undefined ? spec.repeat : tween.repeat;
      this.hold = spec.hold !== undefined ? spec.hold : tween.hold;
      this.repeatDelay = spec.repeatDelay !== undefined ? spec.repeatDelay : tween.repeatDelay;
    } else {
      this.ease = Easing.get(t.ease);
      this.duration = tween.duration; this.delay = tween._resolveDelay(t.delay, target, key, index, total);
      this.yoyo = tween.yoyo; this.repeat = tween.repeat; this.hold = tween.hold; this.repeatDelay = tween.repeatDelay;
    }
    if (typeof vspec === 'function') vspec = vspec(target, key, ref ? ref.obj[ref.key] : 0, index, total, tween);
    if (typeof from === 'function') from = from(target, key, ref ? ref.obj[ref.key] : 0, index, total, tween);
    this.spec = vspec; this.fromSpec = from;
    this.isColor = !!t.color || COLOR_KEY.test(key);
    this.start = 0; this.end = 0;
    this.elapsed = 0; this.state = 0; this.repeatCount = this.repeat < 0 ? -1 : this.repeat;
    this.duration = Math.max(0, this.duration);
    this.progress = 0;
    if (from !== undefined && ref) { ref.obj[ref.key] = this._num(from, ref.obj[ref.key]); }
  }
  _num(v, current) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      var m = /^([+\-*/])=\s*(-?[\d.]+)$/.exec(v.trim());
      if (m) { var n = parseFloat(m[2]); switch (m[1]) { case '+': return current + n; case '-': return current - n; case '*': return current * n; default: return n !== 0 ? current / n : current; } }
      if (this.isColor) return Color.toNumber(v);
      return parseFloat(v) || 0;
    }
    return +v || 0;
  }
  _begin() {
    var ref = this.ref; if (!ref) return;
    var cur = +ref.obj[ref.key] || 0;
    if (this.fromSpec !== undefined) { this.start = this._num(this.fromSpec, cur); this.end = this.spec === undefined ? cur : this._num(this.spec, this.start); }
    else { this.start = cur; this.end = this._num(this.spec, cur); }
  }
  _apply(v) {
    var ref = this.ref; if (!ref) return;
    var val = this.isColor ? Color.lerp(this.start, this.end, clamp(v, 0, 1)) : this.start + (this.end - this.start) * v;
    ref.obj[ref.key] = val;
  }
  /** Avanza dt ms. Devuelve true cuando ha terminado. */
  update(dt) {
    var tw = this.tween, guard = 0;
    this.elapsed += dt;
    while (guard++ < 64) {
      switch (this.state) {
        case 0: // espera inicial
          if (this.elapsed < this.delay) return false;
          this.elapsed -= this.delay; this._begin(); tw._dataStarted(this); this.state = 1; break;
        case 1: { // avance
          var d = this.duration, t = d > 0 ? Math.min(1, this.elapsed / d) : 1;
          this.progress = t; this._apply(this.ease(t));
          if (t < 1) return false;
          this.elapsed -= d;
          if (this.yoyo) { this.state = this.hold > 0 ? 2 : 3; if (this.state === 3) tw._emitYoyo(this); }
          else this.state = 5;
          break;
        }
        case 2: // pausa antes del yoyo
          if (this.elapsed < this.hold) return false;
          this.elapsed -= this.hold; this.state = 3; tw._emitYoyo(this); break;
        case 3: { // retroceso (yoyo)
          var d2 = this.duration, t2 = d2 > 0 ? Math.min(1, this.elapsed / d2) : 1;
          this.progress = 1 - t2; this._apply(this.ease(1 - t2));
          if (t2 < 1) return false;
          this.elapsed -= d2; this.state = 5; break;
        }
        case 4: // espera de repetición
          if (this.elapsed < this.repeatDelay) return false;
          this.elapsed -= this.repeatDelay; this.state = 1; tw._emitRepeat(this); break;
        case 5: // fin de ciclo
          if (this.repeatCount !== 0) { if (this.repeatCount > 0) this.repeatCount--; this.state = 4; if (!this.yoyo && this.ref) this._apply(0); break; }
          this.state = 6; return true;
        default: return true;
      }
    }
    return false;
  }
  reset() { this.elapsed = 0; this.state = 0; this.repeatCount = this.repeat < 0 ? -1 : this.repeat; this.progress = 0; }
}

class Tween extends EventEmitter {
  constructor(manager, config) {
    super();
    this.manager = manager;
    this.config = config;
    this.duration = config.duration !== undefined ? config.duration : 1000;
    this.yoyo = !!config.yoyo;
    this.repeat = config.loop === true || config.loop === -1 ? -1 : (config.repeat !== undefined ? config.repeat : (typeof config.loop === 'number' ? config.loop : 0));
    this.hold = config.hold || 0;
    this.repeatDelay = config.repeatDelay || 0;
    this.completeDelay = config.completeDelay || 0;
    this.timeScale = config.timeScale || 1;
    this.persist = !!config.persist;
    this.paused = !!config.paused;
    this.name = config.name || '';
    this.ctx = config.callbackScope;
    var tg = config.targets !== undefined ? config.targets : config.target;
    this.targets = tg === undefined || tg === null ? [] : (Array.isArray(tg) ? tg.slice() : [tg]);
    this.data = [];
    this.state = 'pending';
    this.elapsed = 0; this.totalElapsed = 0;
    this._started = false; this._completeWait = 0; this._promise = null; this._resolve = null;
    var props = config.props || {};
    var keys = config.props ? Object.keys(props) : Object.keys(config).filter(function (k) { return !TWEEN_RESERVED[k]; });
    var total = this.targets.length;
    for (var i = 0; i < this.targets.length; i++) {
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k]; if (isForbiddenKey(key)) continue;
        var spec = config.props ? props[key] : config[key];
        this.data.push(new TweenData(this, this.targets[i], key, spec, i, total));
      }
    }
    Debug.track('Tween', 1);
  }
  _resolveDelay(d, target, key, index, total) { if (typeof d === 'function') return +d(target, key, 0, index, total, this) || 0; return +d || 0; }
  get isPlaying() { return this.state === 'active' && !this.paused; }
  get isFinished() { return this.state === 'finished' || this.state === 'removed' || this.state === 'destroyed'; }
  get progress() { var p = 0; for (var i = 0; i < this.data.length; i++) p += this.data[i].progress; return this.data.length ? p / this.data.length : 1; }
  /** Promesa que se resuelve al completar o detener el tween. */
  get finished() {
    if (!this._promise) { var self = this; this._promise = new Promise(function (r) { self._resolve = r; if (self.isFinished) r(); }); }
    return this._promise;
  }
  then(a, b) { return this.finished.then(a, b); }
  _cb(name, a, b, c) { var fn = this.config[name]; if (typeof fn === 'function') fn.call(this.ctx || this, this, a, b, c); }
  _dataStarted() { if (!this._started) { this._started = true; this.state = 'active'; this._cb('onStart', this.targets); this.emit('start', this, this.targets); } }
  _emitYoyo(d) { this._cb('onYoyo', d.target, d.key); this.emit('yoyo', this, d.target, d.key); if (this.config.flipX && d.target.toggleFlipX) d.target.toggleFlipX(); if (this.config.flipY && d.target.toggleFlipY) d.target.toggleFlipY(); }
  _emitRepeat(d) { this._cb('onRepeat', d.target, d.key); this.emit('repeat', this, d.target, d.key); }
  play() { this.paused = false; if (this.state === 'removed') { this.state = 'pending'; this.manager._push(this); } return this; }
  pause() { this.paused = true; this.emit('pause', this); return this; }
  resume() { this.paused = false; this.emit('resume', this); return this; }
  restart() { for (var i = 0; i < this.data.length; i++) this.data[i].reset(); this._started = false; this.state = 'pending'; this.paused = false; this.totalElapsed = 0; if (this.manager.tweens.indexOf(this) < 0) this.manager._push(this); return this; }
  setTimeScale(s) { this.timeScale = s; return this; }
  /** Salta al final aplicando los valores finales. */
  complete() {
    for (var i = 0; i < this.data.length; i++) { var d = this.data[i]; if (d.state === 0) d._begin(); d._apply(d.yoyo ? d.ease(0) : d.ease(1)); d.state = 6; }
    this._finish();
    return this;
  }
  stop() {
    if (this.isFinished) return this;
    this.state = 'removed';
    this._cb('onStop');
    this.emit('stop', this);
    if (this._resolve) this._resolve();
    return this;
  }
  remove() { return this.stop(); }
  _finish() {
    if (this.isFinished) return;
    this.state = 'finished';
    this._cb('onComplete', this.targets);
    this.emit('complete', this, this.targets);
    if (this._resolve) this._resolve();
  }
  update(delta) {
    if (this.paused || this.isFinished) return this.isFinished;
    var dt = delta * this.timeScale;
    this.totalElapsed += dt;
    if (this._completeWait > 0) { this._completeWait -= dt; if (this._completeWait <= 0) this._finish(); return this.isFinished; }
    var allDone = true, updated = false;
    for (var i = 0; i < this.data.length; i++) {
      var d = this.data[i];
      if (d.state === 6) continue;
      if (d.target && d.target.destroyed === true) { d.state = 6; continue; }
      if (!d.update(dt)) allDone = false;
      if (d.state !== 0) updated = true;
    }
    if (updated) { this._cb('onUpdate', this.targets); if (this._ev) this.emit('update', this); }
    if (allDone) {
      if (!this._started) this._dataStarted();
      if (this.completeDelay > 0 && this._completeWait === 0) { this._completeWait = this.completeDelay; return false; }
      this._finish();
    }
    return this.isFinished;
  }
  destroy() {
    if (this.state === 'destroyed') return;
    if (!this.isFinished) this.stop();
    this.state = 'destroyed';
    this.off(); this.data.length = 0; this.targets.length = 0; this.config = {}; this.manager = null;
    Debug.track('Tween', -1);
  }
}
Tween.prototype.isTween = true;

/** Cadena secuencial de tweens: this.tweens.chain({tweens:[...], loop}) */
class TweenChain extends EventEmitter {
  constructor(manager, config) {
    super();
    this.manager = manager; this.config = config;
    this.defs = (config.tweens || []).slice();
    this.loop = config.loop === true || config.loop === -1 ? -1 : (config.loop || config.repeat || 0);
    this.index = -1; this.current = null; this.state = 'active'; this.paused = false; this.persist = !!config.persist;
    this._resolve = null; this._promise = null;
    Debug.track('Tween', 1);
    this._next();
  }
  get finished() { if (!this._promise) { var self = this; this._promise = new Promise(function (r) { self._resolve = r; if (self.isFinished) r(); }); } return this._promise; }
  then(a, b) { return this.finished.then(a, b); }
  get isFinished() { return this.state === 'finished' || this.state === 'removed' || this.state === 'destroyed'; }
  get isPlaying() { return this.state === 'active' && !this.paused; }
  _next() {
    if (this.current) { this.current.destroy(); this.current = null; }
    this.index++;
    if (this.index >= this.defs.length) {
      if (this.loop !== 0 && this.defs.length) { if (this.loop > 0) this.loop--; this.index = 0; }
      else { this.state = 'finished'; if (this.config.onComplete) this.config.onComplete.call(this.config.callbackScope || this, this); this.emit('complete', this); if (this._resolve) this._resolve(); return; }
    }
    var def = Object.assign({}, this.defs[this.index]);
    if (def.targets === undefined && def.target === undefined && this.config.targets !== undefined) def.targets = this.config.targets;
    this.current = new Tween(this.manager, def);
  }
  update(delta) {
    if (this.paused || this.isFinished) return this.isFinished;
    var guard = 0, dt = delta;
    while (this.current && guard++ < 32) {
      if (!this.current.update(dt)) break;
      dt = 0;
      this._next();
    }
    return this.isFinished;
  }
  pause() { this.paused = true; return this; }
  resume() { this.paused = false; return this; }
  stop() { if (this.isFinished) return this; this.state = 'removed'; if (this.current) this.current.stop(); this.emit('stop', this); if (this._resolve) this._resolve(); return this; }
  destroy() { if (this.state === 'destroyed') return; this.stop(); if (this.current) this.current.destroy(); this.current = null; this.state = 'destroyed'; this.off(); this.defs.length = 0; Debug.track('Tween', -1); }
}

class TweenManager {
  constructor(scene) { this.scene = scene; this.tweens = []; this.timeScale = 1; this.paused = false; }
  _push(t) { this.tweens.push(t); return t; }
  /** this.tweens.add({ targets, x: 300, alpha: {from: 0, to: 1}, duration, ease, yoyo, repeat, delay, onComplete }) */
  add(config) {
    if (Array.isArray(config)) { var self = this; return config.map(function (c) { return self.add(c); }); }
    if (config && config.tweens) return this.chain(config);
    return this._push(new Tween(this, config || {}));
  }
  create(config) { var t = new Tween(this, config || {}); t.paused = true; return t; }
  /** Tween numérico sin objetivo: onUpdate(tween) con tween.getValue() */
  addCounter(config) {
    var holder = { value: config.from !== undefined ? config.from : 0 };
    var c = Object.assign({}, config, { targets: holder, value: config.to !== undefined ? config.to : 1 });
    delete c.from; delete c.to;
    var t = this.add(c);
    t.getValue = function () { return holder.value; };
    return t;
  }
  chain(config) { return this._push(new TweenChain(this, config || {})); }
  timeline(config) { return this.chain(config); }
  /** Retardo escalonado: delay: this.tweens.stagger(100, {from: 'center'}) */
  stagger(value, options) {
    options = options || {};
    var start = options.start || 0, from = options.from || 'first', ease = options.ease ? Easing.get(options.ease) : null, grid = options.grid;
    return function (target, key, v, index, total) {
      var pos;
      if (grid) {
        var gw = grid[0], gh = grid[1], ix = index % gw, iy = Math.floor(index / gw);
        var fx = from === 'center' ? (gw - 1) / 2 : (from === 'last' ? gw - 1 : 0), fy = from === 'center' ? (gh - 1) / 2 : (from === 'last' ? gh - 1 : 0);
        pos = Math.sqrt((ix - fx) * (ix - fx) + (iy - fy) * (iy - fy));
        var maxD = Math.sqrt(Math.max(fx, gw - 1 - fx) * Math.max(fx, gw - 1 - fx) + Math.max(fy, gh - 1 - fy) * Math.max(fy, gh - 1 - fy)) || 1;
        if (ease) pos = ease(pos / maxD) * maxD;
      } else {
        var origin = from === 'last' ? total - 1 : (from === 'center' ? (total - 1) / 2 : (typeof from === 'number' ? from : 0));
        pos = Math.abs(index - origin);
        if (ease) { var mx = Math.max(origin, total - 1 - origin) || 1; pos = ease(pos / mx) * mx; }
      }
      if (Array.isArray(value)) return start + value[0] + (value[1] - value[0]) * (total > 1 ? pos / (total - 1) : 0);
      return start + pos * value;
    };
  }
  getTweensOf(target) {
    return this.tweens.filter(function (t) { return !t.isFinished && t.targets && t.targets.indexOf(target) >= 0; });
  }
  isTweening(target) { return this.getTweensOf(target).length > 0; }
  killTweensOf(target) {
    var list = Array.isArray(target) ? target : [target];
    for (var i = 0; i < this.tweens.length; i++) { var t = this.tweens[i]; if (!t.targets) continue; for (var k = 0; k < list.length; k++) if (t.targets.indexOf(list[k]) >= 0) { t.stop(); break; } }
    return this;
  }
  killAll() { for (var i = 0; i < this.tweens.length; i++) this.tweens[i].stop(); return this; }
  pauseAll() { this.paused = true; return this; }
  resumeAll() { this.paused = false; return this; }
  setGlobalTimeScale(s) { this.timeScale = s; return this; }
  get length() { return this.tweens.length; }
  update(time, delta) {
    if (this.paused) return;
    var list = this.tweens, n = list.length, dt = delta * this.timeScale;
    for (var i = 0; i < n; i++) { var t = list[i]; if (!t.isFinished) t.update(dt); }
    var j = 0;
    for (var k = 0; k < list.length; k++) {
      var tw = list[k];
      if (tw.isFinished && !(tw.persist && tw.state === 'finished')) { tw.destroy(); continue; }
      list[j++] = tw;
    }
    list.length = j;
  }
  shutdown() { var l = this.tweens.slice(); this.tweens.length = 0; for (var i = 0; i < l.length; i++) l[i].destroy(); }
  destroy() { this.shutdown(); this.scene = null; }
}

/* ===================================================================== Clock */
class TimerEvent {
  constructor(clock, config) {
    this.clock = clock;
    this.delay = Math.max(0, config.delay || 0);
    this.repeat = config.loop ? -1 : (config.repeat || 0);
    this.repeatCount = this.repeat;
    this.callback = config.callback || noop;
    this.args = config.args || [];
    this.scope = config.callbackScope || this;
    this.elapsed = config.startAt || 0;
    this.paused = !!config.paused;
    this.timeScale = config.timeScale || 1;
    this.hasDispatched = false;
    this.done = false;
    Debug.track('TimerEvent', 1);
  }
  getProgress() { return this.delay > 0 ? clamp(this.elapsed / this.delay, 0, 1) : 1; }
  getElapsed() { return this.elapsed; }
  getRemaining() { return Math.max(0, this.delay - this.elapsed); }
  getRemainingSeconds() { return this.getRemaining() / 1000; }
  getRepeatCount() { return this.repeatCount; }
  remove(dispatch) { if (dispatch && !this.done) this.callback.apply(this.scope, this.args); this.done = true; return this; }
  reset(config) { Object.assign(this, new TimerEvent(this.clock, config)); Debug.track('TimerEvent', -1); return this; }
  _destroy() { this.callback = noop; this.args = []; this.scope = null; this.clock = null; Debug.track('TimerEvent', -1); }
}

class Clock {
  constructor(scene) { this.scene = scene; this.now = 0; this.events = []; this.timeScale = 1; this.paused = false; this.startTime = 0; }
  addEvent(config) { var e = new TimerEvent(this, config || {}); this.events.push(e); return e; }
  /** Llama a callback tras delay ms */
  delayedCall(delay, callback, args, scope) { return this.addEvent({ delay: delay, callback: callback, args: args, callbackScope: scope }); }
  /** Repite cada `delay` ms (repeat veces, o infinito con loop) */
  loop(delay, callback, scope) { return this.addEvent({ delay: delay, callback: callback, callbackScope: scope, loop: true }); }
  /** Promesa que se resuelve tras ms (tiempo de escena, respeta pausa y timeScale) */
  wait(ms) { var self = this; return new Promise(function (resolve) { self.delayedCall(ms, resolve); }); }
  removeEvent(e) { if (Array.isArray(e)) { e.forEach(function (x) { x.done = true; }); } else if (e) e.done = true; return this; }
  removeAllEvents() { for (var i = 0; i < this.events.length; i++) this.events[i].done = true; return this; }
  update(time, delta) {
    if (this.paused) return;
    var dt = delta * this.timeScale;
    this.now += dt;
    var list = this.events, n = list.length;
    for (var i = 0; i < n; i++) {
      var e = list[i];
      if (e.done || e.paused) continue;
      e.elapsed += dt * e.timeScale;
      var guard = 0;
      while (e.elapsed >= e.delay && !e.done && guard++ < 100) {
        e.elapsed -= e.delay;
        e.hasDispatched = true;
        try { e.callback.apply(e.scope, e.args); } catch (err) { Log.error('Error en TimerEvent:', err); }
        if (e.repeatCount === 0) { e.done = true; break; }
        if (e.repeatCount > 0) e.repeatCount--;
        if (e.delay === 0) break;
      }
    }
    var j = 0;
    for (var k = 0; k < list.length; k++) { var ev = list[k]; if (ev.done) { ev._destroy(); continue; } list[j++] = ev; }
    list.length = j;
  }
  shutdown() { var l = this.events.slice(); this.events.length = 0; for (var i = 0; i < l.length; i++) l[i]._destroy(); }
  destroy() { this.shutdown(); this.scene = null; }
}

UG.Tween = Tween;
UG.TweenChain = TweenChain;
UG.TweenManager = TweenManager;
UG.Clock = Clock;
UG.TimerEvent = TimerEvent;
