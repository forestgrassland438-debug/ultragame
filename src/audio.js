/* UltraGame - audio: WebAudio con buses (music/sfx), desbloqueo en móviles, límites de instancias,
 * fundidos, paneo estéreo, marcadores (sound sprites), respaldo HTML5, sintetizador de efectos (Sfx)
 * determinista y secuenciador de música chiptune (Music). Los nodos se desconectan al terminar: sin fugas. */

class SoundInstance extends EventEmitter {
  constructor(manager, key, buffer, config) {
    super();
    config = config || {};
    this.manager = manager; this.key = key; this.buffer = buffer;
    this.volume = config.volume !== undefined ? +config.volume : 1;
    this.rate = config.rate !== undefined ? +config.rate : 1;
    this.detune = config.detune || 0;
    this.loop = !!config.loop;
    this.pan = config.pan || 0;
    /** Sonido 3D posicional: { x, y, z, refDistance, maxDistance, rolloff, hrtf } (ver View3D.playSound) */
    this.spatial = config.spatial && typeof config.spatial === 'object' ? config.spatial : null;
    this.bus = config.bus || 'sfx';
    this.marker = config.marker || null;
    this.delay = config.delay || 0;
    this._offset = config.seek || 0;
    this.isPlaying = false; this.isPaused = false; this.destroyed = false;
    this._src = null; this._gain = null; this._panner = null; this._html = null;
    this._startedAt = 0;
    Debug.track('SoundInstance', 1);
  }
  get duration() { return this.marker ? this.marker.duration : (this.buffer ? this.buffer.duration : (this._html ? this._html.duration || 0 : 0)); }
  get seek() {
    if (this._html) return this._html.currentTime;
    if (this.isPaused || !this.isPlaying) return this._offset;
    var ctx = this.manager.ctx; if (!ctx) return 0;
    var t = (ctx.currentTime - this._startedAt) * this.rate + this._offset, d = this.duration;
    return this.loop && d > 0 ? t % d : Math.min(t, d);
  }
  set seek(v) { var was = this.isPlaying && !this.isPaused; this._offset = Math.max(0, v); if (was) { this._stopSource(); this._start(); } }
  play() {
    if (this.destroyed) return this;
    if (this.isPlaying && !this.isPaused) return this;
    this._start();
    return this;
  }
  _start() {
    var m = this.manager, ctx = m.ctx;
    if (m.useHTML5) return this._startHTML5();
    if (!ctx || !this.buffer) return;
    var src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = this.loop;
    var start = this._offset, dur;
    if (this.marker) {
      start += this.marker.start;
      if (this.loop) { src.loopStart = this.marker.start; src.loopEnd = this.marker.start + this.marker.duration; }
      else dur = Math.max(0, this.marker.duration - this._offset);
    }
    src.playbackRate.value = this.rate;
    if (src.detune) src.detune.value = this.detune;
    var gain = ctx.createGain(); gain.gain.value = this.volume;
    src.connect(gain);
    var out = gain;
    if (this.spatial && ctx.createPanner) {
      var sp = this.spatial, pn = ctx.createPanner();
      pn.panningModel = sp.hrtf ? 'HRTF' : 'equalpower'; pn.distanceModel = sp.model === 'linear' || sp.model === 'exponential' ? sp.model : 'inverse';
      pn.refDistance = sp.refDistance > 0 ? sp.refDistance : 2; pn.maxDistance = sp.maxDistance > 0 ? sp.maxDistance : 80; pn.rolloffFactor = sp.rolloff >= 0 ? sp.rolloff : 1;
      this._panner = pn; this._setPannerPos(+sp.x || 0, +sp.y || 0, +sp.z || 0);
      gain.connect(pn); out = pn;
    } else if (this.pan !== 0 && ctx.createStereoPanner) { this._panner = ctx.createStereoPanner(); this._panner.pan.value = this.pan; gain.connect(this._panner); out = this._panner; }
    out.connect(m._bus(this.bus));
    var self = this;
    src.onended = function () { if (self._src === src) self._ended(); };
    var when = ctx.currentTime + Math.max(0, this.delay);
    try { if (dur !== undefined) src.start(when, start, dur); else src.start(when, start); }
    catch (e) { Log.warnOnce('snd:' + this.key, 'No se pudo reproducir ' + this.key, e.message); }
    this._src = src; this._gain = gain;
    this._startedAt = when; this.delay = 0;
    this.isPlaying = true; this.isPaused = false;
    m._register(this);
    this.emit('play', this);
  }
  _startHTML5() {
    var entry = this.manager.buffers.get(this.key); if (!entry || !entry.url) return;
    var a = new Audio(entry.url);
    a.volume = clamp(this.volume * this.manager._effectiveVolume(this.bus), 0, 1); a.loop = this.loop; a.playbackRate = this.rate;
    try { a.currentTime = this._offset; } catch (e) { /* ignorar */ }
    var self = this;
    a.onended = function () { if (!self.loop) self._ended(); };
    var p = a.play(); if (p && p.catch) p.catch(function () { /* autoplay bloqueado */ });
    this._html = a; this.isPlaying = true; this.isPaused = false;
    this.manager._register(this);
    this.emit('play', this);
  }
  _stopSource() {
    if (this._src) {
      this._src.onended = null;
      try { this._src.stop(); } catch (e) { /* ya parado */ }
      try { this._src.disconnect(); } catch (e2) { /* */ }
      this._src = null;
    }
    if (this._gain) { try { this._gain.disconnect(); } catch (e3) { /* */ } this._gain = null; }
    if (this._panner) { try { this._panner.disconnect(); } catch (e4) { /* */ } this._panner = null; }
    if (this._html) { this._html.onended = null; try { this._html.pause(); this._html.removeAttribute('src'); this._html.load(); } catch (e5) { /* */ } this._html = null; }
  }
  _ended() {
    if (this.loop && !this.marker) return;
    this._stopSource();
    this.isPlaying = false; this.isPaused = false; this._offset = 0;
    this.manager._unregister(this);
    this.emit('complete', this);
    if (this.autoDestroy) this.destroy();
  }
  stop() {
    if (!this.isPlaying && !this.isPaused) return this;
    this._stopSource();
    this.isPlaying = false; this.isPaused = false; this._offset = 0;
    this.manager._unregister(this);
    this.emit('stop', this);
    if (this.autoDestroy) this.destroy();
    return this;
  }
  pause() {
    if (!this.isPlaying || this.isPaused) return this;
    this._offset = this.seek;
    this._stopSource();
    this.isPaused = true;
    this.emit('pause', this);
    return this;
  }
  resume() {
    if (!this.isPaused) return this;
    this.isPaused = false; this.isPlaying = false;
    this._start();
    this.emit('resume', this);
    return this;
  }
  setVolume(v) { this.volume = v; if (this._gain) this._gain.gain.setValueAtTime(v, this.manager.ctx.currentTime); if (this._html) this._html.volume = clamp(v * this.manager._effectiveVolume(this.bus), 0, 1); return this; }
  setRate(r) { this.rate = r; if (this._src) this._src.playbackRate.setValueAtTime(r, this.manager.ctx.currentTime); if (this._html) this._html.playbackRate = r; return this; }
  setDetune(d) { this.detune = d; if (this._src && this._src.detune) this._src.detune.setValueAtTime(d, this.manager.ctx.currentTime); return this; }
  setPan(p) { this.pan = clamp(p, -1, 1); if (this._panner && this._panner.pan) this._panner.pan.setValueAtTime(this.pan, this.manager.ctx.currentTime); return this; }
  /** Mueve un sonido 3D (coordenadas del mundo) */
  setPosition(x, y, z) {
    if (typeof x === 'object' && x) { z = x.z; y = x.y; x = x.x; }
    if (!this.spatial) this.spatial = {};
    this.spatial.x = +x || 0; this.spatial.y = +y || 0; this.spatial.z = +z || 0;
    this._setPannerPos(this.spatial.x, this.spatial.y, this.spatial.z);
    return this;
  }
  _setPannerPos(x, y, z) {
    var pn = this._panner; if (!pn || pn.pan) return;
    if (pn.positionX) { var t = this.manager.ctx.currentTime; pn.positionX.setValueAtTime(x, t); pn.positionY.setValueAtTime(y, t); pn.positionZ.setValueAtTime(z, t); }
    else if (pn.setPosition) pn.setPosition(x, y, z);
  }
  setLoop(l) { this.loop = !!l; if (this._src) this._src.loop = this.loop; if (this._html) this._html.loop = this.loop; return this; }
  /** Fundido a un volumen en ms. */
  fadeTo(volume, ms, stopAtEnd) {
    var ctx = this.manager.ctx, self = this;
    if (this._gain && ctx) {
      var g = this._gain.gain, t = ctx.currentTime;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(volume, t + ms / 1000);
    }
    this.volume = volume;
    if (stopAtEnd) { var tm = setTimeout(function () { self.stop(); }, ms + 20); this.once('stop', function () { clearTimeout(tm); }); }
    return this;
  }
  fadeIn(ms, volume) { var v = volume === undefined ? this.volume || 1 : volume; this.setVolume(0); if (!this.isPlaying) this.play(); return this.fadeTo(v, ms || 500); }
  fadeOut(ms) { return this.fadeTo(0, ms || 500, true); }
  destroy() {
    if (this.destroyed) return;
    this._stopSource();
    this.manager._unregister(this);
    this.isPlaying = false; this.destroyed = true;
    this.off(); this.buffer = null;
    Debug.track('SoundInstance', -1);
  }
}

/** Sonido reutilizable estilo Phaser: this.sound.add('jump').play() */
class Sound extends EventEmitter {
  constructor(manager, key, config) {
    super();
    this.manager = manager; this.key = key; this.config = Object.assign({}, config || {});
    this.instance = null; this.markers = {};
    this.allowMultiple = !!this.config.allowMultiple;
  }
  get isPlaying() { return !!(this.instance && this.instance.isPlaying && !this.instance.isPaused); }
  get isPaused() { return !!(this.instance && this.instance.isPaused); }
  get volume() { return this.config.volume === undefined ? 1 : this.config.volume; }
  set volume(v) { this.config.volume = v; if (this.instance) this.instance.setVolume(v); }
  get rate() { return this.config.rate || 1; }
  set rate(v) { this.config.rate = v; if (this.instance) this.instance.setRate(v); }
  get loop() { return !!this.config.loop; }
  set loop(v) { this.config.loop = !!v; if (this.instance) this.instance.setLoop(v); }
  get seek() { return this.instance ? this.instance.seek : 0; }
  addMarker(m) { if (m && m.name && !isForbiddenKey(m.name)) this.markers[m.name] = { start: m.start || 0, duration: m.duration || 0, config: m.config || {} }; return this; }
  play(markerOrConfig, config) {
    var cfg = Object.assign({}, this.config);
    if (typeof markerOrConfig === 'string') { var mk = this.markers[markerOrConfig]; if (mk) { cfg.marker = mk; Object.assign(cfg, mk.config); } }
    else if (markerOrConfig) Object.assign(cfg, markerOrConfig);
    if (config) Object.assign(cfg, config);
    if (this.instance && !this.allowMultiple) this.instance.destroy();
    var inst = this.manager.play(this.key, cfg);
    if (inst) {
      var self = this;
      inst.on('complete', function () { self.emit('complete', self); });
      inst.on('play', function () { self.emit('play', self); });
      if (this.allowMultiple) inst.autoDestroy = true;
      else this.instance = inst;
    }
    return this;
  }
  stop() { if (this.instance) this.instance.stop(); this.emit('stop', this); return this; }
  pause() { if (this.instance) this.instance.pause(); return this; }
  resume() { if (this.instance) this.instance.resume(); return this; }
  setVolume(v) { this.volume = v; return this; }
  setRate(r) { this.rate = r; return this; }
  setLoop(l) { this.loop = l; return this; }
  setDetune(d) { this.config.detune = d; if (this.instance) this.instance.setDetune(d); return this; }
  setPan(p) { this.config.pan = p; if (this.instance) this.instance.setPan(p); return this; }
  fadeIn(ms, v) { if (!this.isPlaying) this.play({ volume: 0 }); if (this.instance) this.instance.fadeTo(v === undefined ? 1 : v, ms || 500); return this; }
  fadeOut(ms) { if (this.instance) this.instance.fadeOut(ms); return this; }
  destroy() { if (this.instance) this.instance.destroy(); this.instance = null; this.off(); this.manager._handles.delete(this); }
}

class SoundManager extends EventEmitter {
  constructor(game, config) {
    super();
    config = config || {};
    this.game = game;
    this.disabled = !!(config.noAudio || config.disabled);
    this.ctx = null;
    this._master = null; this._buses = {};
    this._busVolume = { music: config.musicVolume !== undefined ? config.musicVolume : 0.8, sfx: config.sfxVolume !== undefined ? config.sfxVolume : 1 };
    this.buffers = new Map();
    this.sounds = new Set();
    this._handles = new Set();
    this._volume = config.volume !== undefined ? config.volume : 1;
    this._mute = !!config.mute;
    this.locked = true;
    this.pauseOnBlur = config.pauseOnBlur !== false;
    this.maxInstancesPerKey = config.maxInstances || 12;
    this.maxTotal = config.maxTotal || 96;
    this.useHTML5 = !!config.forceHTML5;
    this.music = null;
    this._sfxCache = new Map();
    this.dom = new DOMListeners();
    this._pendingMusic = null;
  }
  boot() {
    if (this.disabled || typeof document === 'undefined') return;
    var self = this;
    var unlock = function () { self.unlock(); };
    ['pointerdown', 'touchend', 'mousedown', 'keydown', 'click'].forEach(function (t) { self.dom.add(document, t, unlock, true); });
    this.dom.add(document, 'visibilitychange', function () {
      if (!self.ctx || !self.pauseOnBlur) return;
      if (document.hidden) { if (self.ctx.state === 'running') self.ctx.suspend(); }
      else if (!self.locked) self.ctx.resume();
    }, false);
  }
  get context() { return this._ensureContext(); }
  _ensureContext() {
    if (this.ctx || this.disabled || this.useHTML5) return this.ctx;
    var AC = GLOBAL.AudioContext || GLOBAL.webkitAudioContext;
    if (!AC) { this.useHTML5 = typeof Audio !== 'undefined'; return null; }
    try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { try { this.ctx = new AC(); } catch (e2) { this.useHTML5 = true; return null; } }
    var c = this.ctx;
    this._master = c.createGain(); this._master.gain.value = this._mute ? 0 : this._volume; this._master.connect(c.destination);
    this._buses.music = c.createGain(); this._buses.music.gain.value = this._busVolume.music; this._buses.music.connect(this._master);
    this._buses.sfx = c.createGain(); this._buses.sfx.gain.value = this._busVolume.sfx; this._buses.sfx.connect(this._master);
    this.locked = c.state !== 'running';
    return c;
  }
  _bus(name) { var c = this._ensureContext(); if (!c) return null; return this._buses[name] || this._buses.sfx; }
  _effectiveVolume(bus) { return this._mute ? 0 : this._volume * (this._busVolume[bus] !== undefined ? this._busVolume[bus] : 1); }
  /** Desbloquea el audio (se llama solo en el primer gesto del usuario). */
  unlock() {
    if (this.disabled) return;
    var c = this._ensureContext();
    if (!c) { this.locked = false; return; }
    if (!this.locked && c.state === 'running') return;
    var self = this;
    if (c.state === 'suspended' || c.state === 'interrupted') {
      var p = c.resume();
      if (p && p.then) p.then(function () { self._onUnlocked(); }, function () { /* sigue bloqueado */ });
    } else if (this.locked) this._onUnlocked();
    // truco iOS antiguo: reproducir un buffer silencioso
    try { var b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); s.onended = function () { s.disconnect(); }; } catch (e) { /* ignorar */ }
  }
  _onUnlocked() {
    if (!this.locked) return;
    this.locked = false;
    this.dom.removeAll();
    this.boot2();
    this.emit('unlocked');
    if (this._pendingMusic) { var pm = this._pendingMusic; this._pendingMusic = null; this.playMusic(pm.key, pm.config); }
  }
  boot2() {
    var self = this;
    if (typeof document === 'undefined') return;
    this.dom.add(document, 'visibilitychange', function () {
      if (!self.ctx || !self.pauseOnBlur) return;
      if (document.hidden) { if (self.ctx.state === 'running') self.ctx.suspend(); } else self.ctx.resume();
    }, false);
  }
  /** Decodifica un ArrayBuffer de audio (mp3/ogg/wav/m4a) */
  decodeAudio(key, arrayBuffer) {
    var self = this, c = this._ensureContext();
    if (!c) return Promise.reject(new Error('WebAudio no disponible'));
    return new Promise(function (resolve, reject) {
      var done = false;
      var ok = function (buf) { if (done) return; done = true; self.buffers.set(key, buf); resolve(buf); };
      var fail = function (e) { if (done) return; done = true; reject(e || new Error('No se pudo decodificar ' + key)); };
      try { var p = c.decodeAudioData(arrayBuffer, ok, fail); if (p && p.then) p.then(ok, fail); } catch (e) { fail(e); }
    });
  }
  addAudioBuffer(key, buffer) { this.buffers.set(key, buffer); return this; }
  addHTML5(key, url) { this.buffers.set(key, { url: url }); return this; }
  /** Crea un AudioBuffer desde muestras (Float32Array mono o [L, R]) */
  addSamples(key, samples, sampleRate) {
    var c = this._ensureContext();
    sampleRate = sampleRate || 44100;
    if (!c) { this.buffers.set(key, { url: samplesToWavURL(Array.isArray(samples) ? samples[0] : samples, sampleRate) }); return null; }
    var chans = Array.isArray(samples) ? samples : [samples];
    var len = Math.max(1, chans[0].length);
    var buf = c.createBuffer(chans.length, len, sampleRate);
    for (var i = 0; i < chans.length; i++) {
      if (buf.copyToChannel) buf.copyToChannel(chans[i], i); else buf.getChannelData(i).set(chans[i]);
    }
    this.buffers.set(key, buf);
    return buf;
  }
  exists(key) { return this.buffers.has(key); }
  remove(key) { this.stopByKey(key); this.buffers.delete(key); return this; }
  _register(inst) {
    this.sounds.add(inst);
    if (this.sounds.size > this.maxTotal) { var oldest = this.sounds.values().next().value; if (oldest && oldest !== inst) oldest.stop(); }
    var n = 0, first = null;
    this.sounds.forEach(function (s) { if (s.key === inst.key && s.isPlaying && !s.isPaused) { n++; if (!first) first = s; } });
    if (n > this.maxInstancesPerKey && first && first !== inst) first.stop();
  }
  _unregister(inst) { this.sounds.delete(inst); }
  /** Reproduce un sonido y devuelve la instancia (se autodestruye al terminar si no hace loop). */
  play(key, config) {
    if (this.disabled) return null;
    var entry = this.buffers.get(key);
    if (!entry) { Log.warnOnce('nosnd:' + key, 'Sonido "' + key + '" no cargado'); return null; }
    this._ensureContext();
    var inst = new SoundInstance(this, key, entry.url ? null : entry, config);
    inst.autoDestroy = !(config && config.keep);
    inst.play();
    return inst;
  }
  add(key, config) { var s = new Sound(this, key, config); this._handles.add(s); return s; }
  /** Genera (y cachea) un efecto con el sintetizador: playSfx('coin') | playSfx({preset:'laser', seed: 3}) */
  playSfx(spec, config) {
    // Con el audio bloqueado (sin gesto del usuario o contexto suspendido) los efectos cortos se descartan:
    // no avanzarían nunca y se acumularían, y reproducirlos todos juntos al desbloquear sería ruido.
    if (this.locked && !(config && config.force)) { this.makeSfx(spec); return null; }
    var key = this.makeSfx(spec);
    return key ? this.play(key, Object.assign({ bus: 'sfx' }, config || {})) : null;
  }
  /**
   * Genera por adelantado efectos del sintetizador (uno por tarea, sin bloquear el juego): evita el tirón del primer
   * disparo o explosión. Devuelve una promesa que se resuelve con las claves. sound.prewarm(['rifle', 'blast', {preset: 'rifle', seed: 2}])
   */
  prewarm(list) {
    var self = this, specs = (Array.isArray(list) ? list : [list]).slice(0, 64), keys = [];
    return new Promise(function (resolve) {
      var i = 0, next = function () {
        if (i >= specs.length || self._destroyed) { resolve(keys); return; }
        try { keys.push(self.makeSfx(specs[i++])); } catch (e) { Log.warn('prewarm:', e && e.message); i++; }
        setTimeout(next, 0);
      };
      next();
    });
  }
  makeSfx(spec, key) {
    if (!spec) return null;
    var id = key || ('__sfx:' + (typeof spec === 'string' ? spec : JSON.stringify(spec)));
    if (this.buffers.has(id)) return id;
    // efectos "físicos" por capas (armas, explosiones, impactos...): 'rifle', {preset: 'rifle', seed: 2} o {layers: [...]}
    var phys = typeof spec === 'string' ? Sfx.PHYS[spec] : (spec.layers ? spec : (spec.preset && Sfx.PHYS[spec.preset] ? Sfx.PHYS[spec.preset] : null));
    if (phys) { this.addSamples(id, Sfx.render(phys, typeof spec === 'object' && spec.seed !== undefined ? spec.seed : 1, typeof spec === 'object' ? spec : null), 44100); return id; }
    var params = typeof spec === 'string' ? Sfx.preset(spec, 1) : (spec.preset ? Object.assign(Sfx.preset(spec.preset, spec.seed === undefined ? 1 : spec.seed), spec) : Object.assign(Sfx.defaults(), spec));
    this.addSamples(id, Sfx.generate(params), 44100);
    return id;
  }
  /** Renderiza una canción del secuenciador y la registra como sonido. */
  addMusic(key, def) { var r = Music.render(def); this.addSamples(key, r.channels || r.samples, r.sampleRate); return key; }
  playMusic(key, config) {
    config = Object.assign({ loop: true, volume: 1, bus: 'music', fadeIn: 0 }, config || {});
    if (this.locked && config.waitForUnlock !== false) { this._pendingMusic = { key: key, config: config }; }
    if (this.music && this.music.key === key && this.music.isPlaying) return this.music;
    this.stopMusic(config.crossFade || 0);
    var vol = config.volume;
    if (config.fadeIn > 0) config.volume = 0;
    var inst = this.play(key, Object.assign({}, config, { keep: true }));
    if (inst) { inst.autoDestroy = false; if (config.fadeIn > 0) inst.fadeTo(vol, config.fadeIn); }
    this.music = inst;
    return inst;
  }
  stopMusic(fadeMs) {
    var m = this.music; if (!m) return this;
    this.music = null;
    if (fadeMs > 0) { m.fadeTo(0, fadeMs, true); m.once('stop', function () { m.destroy(); }); }
    else m.destroy();
    this._pendingMusic = null;
    return this;
  }
  stopAll() { Array.from(this.sounds).forEach(function (s) { s.stop(); }); return this; }
  stopByKey(key) { Array.from(this.sounds).forEach(function (s) { if (s.key === key) s.stop(); }); return this; }
  pauseAll() { this.sounds.forEach(function (s) { s.pause(); }); return this; }
  resumeAll() { this.sounds.forEach(function (s) { s.resume(); }); return this; }
  get volume() { return this._volume; }
  set volume(v) { this._volume = clamp(v, 0, 1); if (this._master) this._master.gain.value = this._mute ? 0 : this._volume; }
  get mute() { return this._mute; }
  set mute(m) { this._mute = !!m; if (this._master) this._master.gain.value = this._mute ? 0 : this._volume; this.sounds.forEach(function (s) { if (s._html) s._html.muted = !!m; }); }
  setVolume(v) { this.volume = v; return this; }
  setMute(m) { this.mute = m; return this; }
  toggleMute() { this.mute = !this._mute; return this; }
  /** Oyente 3D (normalmente la cámara 3D): posición, dirección de la mirada y arriba */
  setListener(px, py, pz, fx, fy, fz, ux, uy, uz) {
    var c = this.ctx; if (!c || !c.listener) return this;
    var L = c.listener, t = c.currentTime;
    if (L.positionX) {
      L.positionX.setValueAtTime(px, t); L.positionY.setValueAtTime(py, t); L.positionZ.setValueAtTime(pz, t);
      L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(fy, t); L.forwardZ.setValueAtTime(fz, t);
      L.upX.setValueAtTime(ux === undefined ? 0 : ux, t); L.upY.setValueAtTime(uy === undefined ? 1 : uy, t); L.upZ.setValueAtTime(uz === undefined ? 0 : uz, t);
    } else { if (L.setPosition) L.setPosition(px, py, pz); if (L.setOrientation) L.setOrientation(fx, fy, fz, ux === undefined ? 0 : ux, uy === undefined ? 1 : uy, uz === undefined ? 0 : uz); }
    return this;
  }
  setBusVolume(bus, v) { this._busVolume[bus] = clamp(v, 0, 1); if (this._buses[bus]) this._buses[bus].gain.value = this._busVolume[bus]; return this; }
  get playingCount() { return this.sounds.size; }
  destroy() {
    this._destroyed = true;
    this.stopMusic(0);
    Array.from(this.sounds).forEach(function (s) { s.destroy(); });
    this.sounds.clear();
    this._handles.forEach(function (h) { h.off(); });
    this._handles.clear();
    this.dom.removeAll();
    this.buffers.clear();
    if (this.ctx) { try { this.ctx.close(); } catch (e) { /* ignorar */ } }
    this.ctx = null; this._master = null; this._buses = {};
    this.off();
  }
}

function samplesToWavURL(samples, sampleRate) {
  var n = samples.length, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  var w = function (o, s) { for (var i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true);
  for (var i = 0; i < n; i++) dv.setInt16(44 + i * 2, clamp(samples[i], -1, 1) * 32767, true);
  var bytes = new Uint8Array(buf);
  return 'data:audio/wav;base64,' + bytesToBase64(bytes);
}

/* ======================================================================== Sfx
 * Sintetizador procedural (inspirado en sfxr): efectos 8-bit sin archivos, deterministas por semilla. */
var Sfx = {
  defaults: function () {
    return { wave: 0, attack: 0, sustain: 0.3, punch: 0, decay: 0.4, freq: 0.3, freqLimit: 0, slide: 0, deltaSlide: 0, vibDepth: 0, vibSpeed: 0,
      arpMod: 0, arpSpeed: 0, duty: 0, dutySweep: 0, repeatSpeed: 0, phaserOffset: 0, phaserSweep: 0, lpfCutoff: 1, lpfSweep: 0, lpfResonance: 0,
      hpfCutoff: 0, hpfSweep: 0, volume: 0.5 };
  },
  presetNames: ['coin', 'laser', 'explosion', 'powerup', 'hit', 'jump', 'blip', 'click', 'bounce', 'shoot', 'hurt', 'select', 'random'], // + Sfx.physicalNames (armas, explosiones...)
  preset: function (name, seed) {
    var r = new RNG(seed === undefined ? name : seed + ':' + name), p = Sfx.defaults(), f = function () { return r.float(); };
    switch (name) {
      case 'coin': case 'pickup':
        p.freq = 0.4 + f() * 0.5; p.sustain = f() * 0.1; p.decay = 0.1 + f() * 0.4; p.punch = 0.3 + f() * 0.3;
        if (r.bool()) { p.arpSpeed = 0.5 + f() * 0.2; p.arpMod = 0.2 + f() * 0.4; }
        break;
      case 'laser': case 'shoot':
        p.wave = r.int(0, 2); if (p.wave === 2 && r.bool()) p.wave = r.int(0, 1);
        p.freq = 0.5 + f() * 0.5; p.freqLimit = p.freq - 0.2 - f() * 0.6; if (p.freqLimit < 0.2) p.freqLimit = 0.2; p.slide = -0.15 - f() * 0.2;
        if (r.int(0, 2) === 0) { p.freq = 0.3 + f() * 0.6; p.freqLimit = f() * 0.1; p.slide = -0.35 - f() * 0.3; }
        if (r.bool()) { p.duty = f() * 0.5; p.dutySweep = f() * 0.2; } else { p.duty = 0.4 + f() * 0.5; p.dutySweep = -f() * 0.7; }
        p.sustain = 0.1 + f() * 0.2; p.decay = f() * 0.4; if (r.bool()) p.punch = f() * 0.3;
        if (r.int(0, 2) === 0) { p.phaserOffset = f() * 0.2; p.phaserSweep = -f() * 0.2; }
        if (r.bool()) p.hpfCutoff = f() * 0.3;
        if (name === 'shoot') { p.sustain *= 0.6; p.decay *= 0.6; }
        break;
      case 'explosion':
        p.wave = 3;
        if (r.bool()) { p.freq = Math.pow(0.1 + f() * 0.4, 2); p.slide = -0.1 + f() * 0.4; } else { p.freq = Math.pow(0.2 + f() * 0.7, 2); p.slide = -0.2 - f() * 0.2; }
        if (r.int(0, 4) === 0) p.slide = 0;
        if (r.int(0, 2) === 0) p.repeatSpeed = 0.3 + f() * 0.5;
        p.sustain = 0.1 + f() * 0.3; p.decay = 0.2 + f() * 0.4;
        if (r.bool()) { p.phaserOffset = -0.3 + f() * 0.9; p.phaserSweep = -f() * 0.3; }
        p.punch = 0.2 + f() * 0.6;
        if (r.bool()) { p.vibDepth = f() * 0.7; p.vibSpeed = f() * 0.6; }
        if (r.int(0, 2) === 0) { p.arpSpeed = 0.6 + f() * 0.3; p.arpMod = 0.8 - f() * 1.6; }
        break;
      case 'powerup':
        if (r.bool()) p.wave = 1; else p.duty = f() * 0.6;
        if (r.bool()) { p.freq = 0.2 + f() * 0.3; p.slide = 0.1 + f() * 0.4; p.repeatSpeed = 0.4 + f() * 0.4; }
        else { p.freq = 0.2 + f() * 0.3; p.slide = 0.05 + f() * 0.2; if (r.bool()) { p.vibDepth = f() * 0.7; p.vibSpeed = f() * 0.6; } }
        p.sustain = f() * 0.4; p.decay = 0.1 + f() * 0.4;
        break;
      case 'hit': case 'hurt':
        p.wave = r.int(0, 2); if (p.wave === 2) p.wave = 3; if (p.wave === 0) p.duty = f() * 0.6;
        p.freq = 0.2 + f() * 0.6; p.slide = -0.3 - f() * 0.4; p.sustain = f() * 0.1; p.decay = 0.1 + f() * 0.2;
        if (r.bool()) p.hpfCutoff = f() * 0.3;
        break;
      case 'jump': case 'bounce':
        p.wave = 0; p.duty = f() * 0.6; p.freq = 0.3 + f() * 0.3; p.slide = 0.1 + f() * 0.2; p.sustain = 0.1 + f() * 0.3; p.decay = 0.1 + f() * 0.2;
        if (r.bool()) p.hpfCutoff = f() * 0.3; if (r.bool()) p.lpfCutoff = 1 - f() * 0.6;
        if (name === 'bounce') { p.sustain *= 0.5; p.freq += 0.1; }
        break;
      case 'blip': case 'select':
        p.wave = r.int(0, 1); if (p.wave === 0) p.duty = f() * 0.6; p.freq = 0.2 + f() * 0.4; p.sustain = 0.1 + f() * 0.1; p.decay = f() * 0.2; p.hpfCutoff = 0.1;
        break;
      case 'click':
        p.wave = 0; p.duty = 0.5; p.freq = 0.7 + f() * 0.2; p.sustain = 0.02; p.decay = 0.06; p.hpfCutoff = 0.2; p.volume = 0.35;
        break;
      default: {
        p.wave = r.int(0, 4); p.freq = Math.pow(f() * 2 - 1, 2); if (r.bool()) p.freq = Math.pow(f() * 2 - 1, 3) + 0.5;
        p.slide = Math.pow(f() * 2 - 1, 5); p.deltaSlide = Math.pow(f() * 2 - 1, 3); p.duty = f() * 2 - 1; p.dutySweep = Math.pow(f() * 2 - 1, 3);
        p.vibDepth = Math.pow(f() * 2 - 1, 3); p.vibSpeed = f() * 2 - 1; p.attack = Math.pow(f() * 2 - 1, 3); p.sustain = Math.pow(f() * 2 - 1, 2);
        p.decay = f() * 2 - 1; p.punch = Math.pow(f() * 0.8, 2); if (p.attack + p.sustain + p.decay < 0.2) { p.sustain += 0.2 + f() * 0.3; p.decay += 0.2 + f() * 0.3; }
        p.lpfResonance = f() * 2 - 1; p.lpfCutoff = 1 - Math.pow(f(), 3); p.lpfSweep = Math.pow(f() * 2 - 1, 3); p.hpfCutoff = Math.pow(f(), 5);
        p.phaserOffset = Math.pow(f() * 2 - 1, 3); p.phaserSweep = Math.pow(f() * 2 - 1, 3); p.repeatSpeed = f() * 2 - 1; p.arpSpeed = f() * 2 - 1; p.arpMod = f() * 2 - 1;
        ['attack', 'sustain', 'decay', 'freq', 'duty'].forEach(function (k) { p[k] = Math.abs(p[k]); });
      }
    }
    return p;
  },
  /** Genera las muestras (Float32Array a 44100 Hz). */
  generate: function (p, seed) {
    p = Object.assign(Sfx.defaults(), p || {});
    var rng = new RNG(seed === undefined ? 12345 : seed);
    var fperiod, fmaxperiod, fslide, fdslide, period, squareDuty, squareSlide, arpMod, arpTime, arpLimit;
    var reset = function () {
      fperiod = 100 / (p.freq * p.freq + 0.001);
      fmaxperiod = 100 / (p.freqLimit * p.freqLimit + 0.001);
      fslide = 1 - Math.pow(p.slide, 3) * 0.01;
      fdslide = -Math.pow(p.deltaSlide, 3) * 0.000001;
      squareDuty = 0.5 - p.duty * 0.5;
      squareSlide = -p.dutySweep * 0.00005;
      arpMod = p.arpMod >= 0 ? 1 - Math.pow(p.arpMod, 2) * 0.9 : 1 + Math.pow(p.arpMod, 2) * 10;
      arpTime = 0;
      arpLimit = Math.floor(Math.pow(1 - p.arpSpeed, 2) * 20000 + 32);
      if (p.arpSpeed === 1) arpLimit = 0;
    };
    reset();
    var fltp = 0, fltdp = 0, fltw = Math.pow(p.lpfCutoff, 3) * 0.1, fltwd = 1 + p.lpfSweep * 0.0001;
    var fltdmp = 5 / (1 + Math.pow(p.lpfResonance, 2) * 20) * (0.01 + fltw); if (fltdmp > 0.8) fltdmp = 0.8;
    var fltphp = 0, flthp = Math.pow(p.hpfCutoff, 2) * 0.1, flthpd = 1 + p.hpfSweep * 0.0003;
    var vibPhase = 0, vibSpeed = Math.pow(p.vibSpeed, 2) * 0.01, vibAmp = p.vibDepth * 0.5;
    var envVol = 0, envStage = 0, envTime = 0;
    var envLength = [Math.floor(p.attack * p.attack * 100000), Math.floor(p.sustain * p.sustain * 100000), Math.floor(p.decay * p.decay * 100000)];
    var total = Math.min(envLength[0] + envLength[1] + envLength[2] + 1, 44100 * 6);
    var phase = 0, fphase = Math.pow(p.phaserOffset, 2) * 1020 * (p.phaserOffset < 0 ? -1 : 1), fdphase = Math.pow(p.phaserSweep, 2) * (p.phaserSweep < 0 ? -1 : 1);
    var iphase = Math.abs(Math.floor(fphase)), ipp = 0;
    var phaserBuffer = new Float32Array(1024), noiseBuffer = new Float32Array(32), i;
    for (i = 0; i < 32; i++) noiseBuffer[i] = rng.float() * 2 - 1;
    var repTime = 0, repLimit = Math.floor(Math.pow(1 - p.repeatSpeed, 2) * 20000 + 32); if (p.repeatSpeed === 0) repLimit = 0;
    var out = new Float32Array(total), len = total;
    while (envStage < 3 && envLength[envStage] === 0) envStage++;
    for (var t = 0; t < total; t++) {
      repTime++; if (repLimit !== 0 && repTime >= repLimit) { repTime = 0; reset(); }
      arpTime++; if (arpLimit !== 0 && arpTime >= arpLimit) { arpLimit = 0; fperiod *= arpMod; }
      fslide += fdslide; fperiod *= fslide;
      if (fperiod > fmaxperiod) { fperiod = fmaxperiod; if (p.freqLimit > 0) { len = t; break; } }
      var rfperiod = fperiod;
      if (vibAmp > 0) { vibPhase += vibSpeed; rfperiod = fperiod * (1 + Math.sin(vibPhase) * vibAmp); }
      period = Math.floor(rfperiod); if (period < 8) period = 8;
      squareDuty += squareSlide; if (squareDuty < 0) squareDuty = 0; if (squareDuty > 0.5) squareDuty = 0.5;
      envTime++;
      if (envStage < 3 && envTime > envLength[envStage]) { envTime = 0; envStage++; while (envStage < 3 && envLength[envStage] === 0) envStage++; }
      if (envStage >= 3) { len = t; break; }
      if (envStage === 0) envVol = envTime / envLength[0];
      else if (envStage === 1) envVol = 1 + (1 - envTime / envLength[1]) * 2 * p.punch;
      else envVol = 1 - envTime / envLength[2];
      fphase += fdphase; iphase = Math.abs(Math.floor(fphase)); if (iphase > 1023) iphase = 1023;
      if (flthpd !== 0) { flthp *= flthpd; if (flthp < 0.00001) flthp = 0.00001; if (flthp > 0.1) flthp = 0.1; }
      var ssample = 0;
      for (var si = 0; si < 8; si++) {
        var sample = 0;
        phase++;
        if (phase >= period) { phase %= period; if (p.wave === 3) for (i = 0; i < 32; i++) noiseBuffer[i] = rng.float() * 2 - 1; }
        var fp = phase / period;
        switch (p.wave) {
          case 0: sample = fp < squareDuty ? 0.5 : -0.5; break;
          case 1: sample = 1 - fp * 2; break;
          case 2: sample = Math.sin(fp * PI2); break;
          case 3: sample = noiseBuffer[Math.floor(phase * 32 / period) & 31]; break;
          default: sample = Math.abs(1 - fp * 2) * 2 - 1;
        }
        var pp = fltp;
        fltw *= fltwd; if (fltw < 0) fltw = 0; if (fltw > 0.1) fltw = 0.1;
        if (p.lpfCutoff !== 1) { fltdp += (sample - fltp) * fltw; fltdp -= fltdp * fltdmp; } else { fltp = sample; fltdp = 0; }
        fltp += fltdp;
        fltphp += fltp - pp; fltphp -= fltphp * flthp;
        sample = fltphp;
        phaserBuffer[ipp & 1023] = sample;
        sample += phaserBuffer[(ipp - iphase + 1024) & 1023];
        ipp = (ipp + 1) & 1023;
        ssample += sample * envVol;
      }
      out[t] = ssample / 8;
    }
    out = out.subarray(0, Math.max(1, len));
    var peak = 0; for (i = 0; i < out.length; i++) { var a = Math.abs(out[i]); if (a > peak) peak = a; }
    var gain = peak > 0 ? (0.9 * Math.min(1, p.volume * 2)) / peak : 0;
    var fade = Math.min(out.length, 220);
    for (i = 0; i < out.length; i++) {
      var v = out[i] * gain;
      if (i > out.length - fade) v *= (out.length - i) / fade;
      out[i] = v > 1 ? 1 : (v < -1 ? -1 : v);
    }
    return out;
  }
};

/* ============================================================ Sfx por capas
 * Síntesis "física" para sonidos realistas sin archivos: cada capa es ruido (blanco/rosa/marrón) u oscilador con barrido
 * exponencial de frecuencia, envolvente (ataque + caída exponencial), filtros biquad paso-bajo/alto (con barrido),
 * saturación, ecos discretos y una reverberación de Schroeder (4 peines + 2 pasa-todo). Determinista por semilla. */
var SR_PHYS = 44100;
function biquadCoefs(type, f, q) {
  var w = 2 * Math.PI * Math.max(10, Math.min(f, SR_PHYS * 0.45)) / SR_PHYS, cs = Math.cos(w), al = Math.sin(w) / (2 * (q || 0.707)), b0, b1, b2, a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
  if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; } else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; } else { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
Sfx.render = function (def, seed, over) {
  def = def || {};
  var rng = new RNG('phys:' + (seed === undefined ? 1 : seed)), sr = SR_PHYS;
  // variación natural por semilla (tono y duración ±), para que 4 disparos seguidos no suenen idénticos
  var vary = def.vary === undefined ? 0.06 : def.vary, pitch = (over && over.pitch) || (1 + (rng.float() * 2 - 1) * vary), slow = 1 + (rng.float() * 2 - 1) * vary * 0.5;
  var layers = Array.isArray(def.layers) ? def.layers.slice(0, 16) : [];
  var tail = Math.max(0, Math.min(4, (def.reverb && def.reverb.time) || 0)), len = 0;
  layers.forEach(function (L) { var d = (L.delay || 0) + (L.attack || 0) + (L.decay || 0.1) * 6 * slow; if (d > len) len = d; });
  len = Math.min(6, len + tail + ((def.echoes || []).reduce(function (m, e) { return Math.max(m, e[0] || 0); }, 0)) + 0.02);
  var n = Math.max(1, Math.ceil(len * sr)), out = new Float32Array(n);
  layers.forEach(function (L) {
    var t0 = Math.floor((L.delay || 0) * sr), att = Math.max(1, Math.floor((L.attack || 0.0005) * sr)), dec = Math.max(1e-4, (L.decay || 0.1) * slow), gain = L.gain === undefined ? 1 : L.gain;
    var dur = Math.min(n - t0, Math.ceil((L.attack || 0) * sr + dec * 7 * sr)), type = L.type || 'noise';
    var f0 = (L.f0 || L.freq || 440) * pitch, f1 = (L.f1 || L.f0 || L.freq || 440) * pitch, sweep = Math.max(1e-4, L.sweep || dec * 3), ph = 0, brown = 0, p0 = 0, p1 = 0, p2 = 0;
    var lp = L.lp ? biquadCoefs('lp', L.lp * pitch, L.q) : null, hp = L.hp ? biquadCoefs('hp', L.hp * pitch, L.q) : null, bp = L.bp ? biquadCoefs('bp', L.bp * pitch, L.q || 2) : null;
    var lz = [0, 0, 0, 0], hz = [0, 0, 0, 0], bz = [0, 0, 0, 0], drive = L.drive || 0, crackle = L.crackle || 0;
    var biq = function (c, z, x) { var y = c[0] * x + c[1] * z[0] + c[2] * z[1] - c[3] * z[2] - c[4] * z[3]; z[1] = z[0]; z[0] = x; z[3] = z[2]; z[2] = y; return y; };
    for (var i = 0; i < dur; i++) {
      var t = i / sr, env = i < att ? i / att : Math.exp(-(i - att) / sr / dec);
      if (L.lpEnd && lp && (i & 31) === 0) lp = biquadCoefs('lp', (L.lp + (L.lpEnd - L.lp) * Math.min(1, t / sweep)) * pitch, L.q);
      var x;
      if (type === 'noise' || type === 'white') x = rng.float() * 2 - 1;
      else if (type === 'pink') { var w = rng.float() * 2 - 1; p0 = 0.99765 * p0 + w * 0.099046; p1 = 0.963 * p1 + w * 0.2965164; p2 = 0.57 * p2 + w * 1.0526913; x = (p0 + p1 + p2 + w * 0.1848) * 0.2; }
      else if (type === 'brown') { brown = (brown + (rng.float() * 2 - 1) * 0.06) * 0.996; x = brown * 3; }
      else {
        var f = f0 * Math.pow(f1 / f0, Math.min(1, t / sweep)); ph += f / sr; ph -= Math.floor(ph);
        x = type === 'sine' ? Math.sin(ph * PI2) : (type === 'square' ? (ph < 0.5 ? 1 : -1) : (type === 'saw' ? ph * 2 - 1 : 1 - 4 * Math.abs(ph - 0.5)));
      }
      if (crackle && rng.float() < crackle) x += (rng.float() * 2 - 1) * 2;
      if (hp) x = biq(hp, hz, x); if (lp) x = biq(lp, lz, x); if (bp) x = biq(bp, bz, x);
      if (drive) x = Math.tanh(x * drive) / Math.tanh(drive);
      out[t0 + i] += x * env * gain;
    }
  });
  // saturación global (pegada) y ecos discretos (paredes, montañas)
  var drv = def.drive || 0, i2;
  if (drv) for (i2 = 0; i2 < n; i2++) out[i2] = Math.tanh(out[i2] * drv) / Math.tanh(drv);
  var dry = out;
  if (def.echoes && def.echoes.length) {
    var e2 = new Float32Array(n); e2.set(dry);
    def.echoes.slice(0, 8).forEach(function (e) { var d = Math.floor((e[0] || 0) * sr), g = e[1] || 0.2, lpz = 0; for (var k = 0; k + d < n; k++) { lpz += (dry[k] - lpz) * 0.35; e2[k + d] += lpz * g; } });
    out = e2;
  }
  // reverberación de Schroeder
  if (def.reverb && def.reverb.mix > 0) {
    var rv = def.reverb, mix = Math.min(1, rv.mix), damp = rv.damp === undefined ? 0.35 : rv.damp, fb = Math.min(0.97, 0.7 + (tail / 4) * 0.28), wet = new Float32Array(n);
    [1557, 1617, 1491, 1422].forEach(function (L0) {
      var Ld = Math.floor(L0 * (rv.size || 1)), buf = new Float32Array(Ld), bi = 0, flt = 0;
      for (var k = 0; k < n; k++) { var y = buf[bi]; flt = y * (1 - damp) + flt * damp; buf[bi] = out[k] + flt * fb; bi = (bi + 1) % Ld; wet[k] += y * 0.25; }
    });
    [225, 556].forEach(function (L1) { var buf = new Float32Array(L1), bi = 0; for (var k = 0; k < n; k++) { var b = buf[bi], y = -wet[k] * 0.5 + b; buf[bi] = wet[k] + b * 0.5; bi = (bi + 1) % L1; wet[k] = y; } });
    for (var k2 = 0; k2 < n; k2++) out[k2] = out[k2] * (1 - mix * 0.5) + wet[k2] * mix;
  }
  // normaliza al volumen pedido y suaviza el final (sin clics)
  var peak = 0; for (i2 = 0; i2 < n; i2++) { var a = Math.abs(out[i2]); if (a > peak) peak = a; }
  var vol = def.volume === undefined ? 0.9 : def.volume, gn = peak > 0 ? vol / peak : 0;
  var end = n; while (end > 1 && Math.abs(out[end - 1]) * gn < 0.0004) end--; end = Math.min(n, end + 64);
  var res = out.subarray(0, Math.max(1, end)), fade = Math.max(1, Math.min(2200, Math.floor(res.length * 0.25)));
  for (i2 = 0; i2 < res.length; i2++) { var v = res[i2] * gn; if (i2 > res.length - fade) v *= (res.length - i2) / fade; res[i2] = v > 1 ? 1 : (v < -1 ? -1 : v); }
  return res;
};
/** Presets por capas: armas, explosiones, impactos y sonidos cotidianos */
Sfx.PHYS = {
  pistol: { drive: 1.6, layers: [{ type: 'noise', hp: 1800, lp: 9000, decay: 0.012, gain: 1 }, { type: 'noise', lp: 2200, lpEnd: 380, decay: 0.05, gain: 0.9 }, { type: 'sine', f0: 170, f1: 55, decay: 0.045, gain: 0.8 }, { type: 'square', freq: 2600, hp: 1500, decay: 0.004, gain: 0.15, delay: 0.001 }], echoes: [[0.085, 0.22], [0.19, 0.12]], reverb: { time: 0.7, mix: 0.28 } },
  rifle: { drive: 2.2, layers: [{ type: 'noise', hp: 1500, lp: 11000, decay: 0.016, gain: 1.1 }, { type: 'noise', lp: 3000, lpEnd: 420, decay: 0.085, gain: 1 }, { type: 'sine', f0: 140, f1: 42, decay: 0.07, gain: 1 }, { type: 'brown', lp: 600, decay: 0.12, gain: 0.5, delay: 0.004 }, { type: 'square', freq: 3100, hp: 2000, decay: 0.004, gain: 0.12, delay: 0.002 }], echoes: [[0.11, 0.26], [0.24, 0.15], [0.41, 0.08]], reverb: { time: 1.1, mix: 0.34 } },
  smg: { drive: 1.8, vary: 0.08, layers: [{ type: 'noise', hp: 2200, lp: 10000, decay: 0.009, gain: 1 }, { type: 'noise', lp: 2600, lpEnd: 500, decay: 0.035, gain: 0.85 }, { type: 'sine', f0: 190, f1: 70, decay: 0.03, gain: 0.7 }], echoes: [[0.07, 0.18]], reverb: { time: 0.5, mix: 0.22 } },
  shotgun: { drive: 2.6, layers: [{ type: 'noise', hp: 900, lp: 8000, decay: 0.02, gain: 1.1 }, { type: 'noise', lp: 2400, lpEnd: 260, decay: 0.16, gain: 1.1 }, { type: 'sine', f0: 105, f1: 34, decay: 0.13, gain: 1.1 }, { type: 'brown', lp: 400, decay: 0.2, gain: 0.8 }], echoes: [[0.12, 0.3], [0.27, 0.16], [0.46, 0.08]], reverb: { time: 1.3, mix: 0.36 } },
  sniper: { drive: 2.4, layers: [{ type: 'noise', hp: 2500, lp: 14000, decay: 0.01, gain: 1.2 }, { type: 'noise', lp: 3600, lpEnd: 300, decay: 0.11, gain: 1 }, { type: 'sine', f0: 120, f1: 36, decay: 0.1, gain: 1 }, { type: 'brown', lp: 350, decay: 0.3, gain: 0.7 }], echoes: [[0.18, 0.3], [0.38, 0.22], [0.66, 0.14], [1.0, 0.07]], reverb: { time: 1.8, mix: 0.4 } },
  laser_gun: { drive: 1.4, layers: [{ type: 'saw', f0: 2400, f1: 260, sweep: 0.16, decay: 0.07, lp: 6000, gain: 0.8 }, { type: 'sine', f0: 900, f1: 120, sweep: 0.12, decay: 0.06, gain: 0.7 }, { type: 'noise', hp: 3000, decay: 0.01, gain: 0.4 }], reverb: { time: 0.6, mix: 0.25 } },
  plasma: { drive: 1.8, layers: [{ type: 'square', f0: 700, f1: 90, sweep: 0.25, decay: 0.09, lp: 3000, gain: 0.7 }, { type: 'brown', lp: 900, decay: 0.12, gain: 0.8 }, { type: 'sine', f0: 220, f1: 60, decay: 0.1, gain: 0.8 }], reverb: { time: 0.9, mix: 0.3 } },
  blast: { drive: 2.8, vary: 0.1, layers: [{ type: 'noise', hp: 600, lp: 7000, decay: 0.03, gain: 1 }, { type: 'brown', lp: 1400, lpEnd: 120, sweep: 1.2, decay: 0.55, gain: 1.4 }, { type: 'sine', f0: 72, f1: 24, sweep: 0.8, decay: 0.45, gain: 1.3 }, { type: 'noise', lp: 2500, lpEnd: 300, decay: 0.25, gain: 0.7, crackle: 0.002, delay: 0.03 }], echoes: [[0.22, 0.3], [0.5, 0.2], [0.9, 0.1]], reverb: { time: 2.2, mix: 0.42 } },
  grenade: { drive: 2.6, vary: 0.1, layers: [{ type: 'noise', hp: 700, lp: 8000, decay: 0.025, gain: 1 }, { type: 'brown', lp: 1600, lpEnd: 150, sweep: 0.9, decay: 0.4, gain: 1.3 }, { type: 'sine', f0: 85, f1: 28, sweep: 0.6, decay: 0.35, gain: 1.2 }, { type: 'noise', lp: 3000, decay: 0.15, gain: 0.5, crackle: 0.003, delay: 0.05 }], echoes: [[0.2, 0.28], [0.45, 0.16]], reverb: { time: 1.8, mix: 0.4 } },
  reload: { layers: [{ type: 'noise', hp: 1800, lp: 7000, decay: 0.006, gain: 0.8 }, { type: 'square', freq: 1700, hp: 1200, decay: 0.004, gain: 0.3 }, { type: 'noise', hp: 1200, lp: 5000, decay: 0.012, gain: 0.9, delay: 0.32 }, { type: 'noise', hp: 900, lp: 4000, decay: 0.018, gain: 1, delay: 0.55 }, { type: 'sine', f0: 900, f1: 500, decay: 0.012, gain: 0.3, delay: 0.55 }], reverb: { time: 0.2, mix: 0.12 }, volume: 0.6 },
  pump: { layers: [{ type: 'noise', hp: 700, lp: 3500, decay: 0.03, gain: 1 }, { type: 'noise', hp: 900, lp: 4500, decay: 0.025, gain: 1, delay: 0.16 }], reverb: { time: 0.25, mix: 0.12 }, volume: 0.65 },
  dryfire: { layers: [{ type: 'noise', hp: 2500, lp: 9000, decay: 0.004, gain: 1 }, { type: 'square', freq: 2200, hp: 1500, decay: 0.003, gain: 0.3 }], volume: 0.45 },
  ricochet: { layers: [{ type: 'sine', f0: 4200, f1: 1300, sweep: 0.28, decay: 0.09, gain: 0.7 }, { type: 'noise', hp: 3000, decay: 0.01, gain: 0.6 }], reverb: { time: 0.5, mix: 0.25 }, volume: 0.5 },
  impact: { vary: 0.12, layers: [{ type: 'noise', lp: 1600, decay: 0.02, gain: 1 }, { type: 'noise', hp: 3000, decay: 0.004, gain: 0.5 }, { type: 'sine', f0: 260, f1: 110, decay: 0.02, gain: 0.5 }], volume: 0.55 },
  impact_metal: { vary: 0.1, layers: [{ type: 'noise', hp: 2500, decay: 0.006, gain: 0.8 }, { type: 'sine', f0: 2900, decay: 0.06, gain: 0.35 }, { type: 'sine', f0: 4100, decay: 0.04, gain: 0.25 }, { type: 'sine', f0: 1700, decay: 0.08, gain: 0.25 }], reverb: { time: 0.4, mix: 0.2 }, volume: 0.5 },
  flesh: { vary: 0.12, layers: [{ type: 'noise', lp: 900, decay: 0.035, gain: 1 }, { type: 'sine', f0: 190, f1: 80, decay: 0.04, gain: 0.8 }, { type: 'noise', bp: 600, q: 3, decay: 0.05, gain: 0.5, delay: 0.01 }], volume: 0.6 },
  glass: { vary: 0.1, layers: [{ type: 'noise', hp: 3000, lp: 12000, decay: 0.09, gain: 0.9, crackle: 0.01 }, { type: 'sine', f0: 3700, decay: 0.12, gain: 0.3 }, { type: 'sine', f0: 5200, decay: 0.08, gain: 0.25, delay: 0.02 }, { type: 'sine', f0: 2600, decay: 0.15, gain: 0.25, delay: 0.05 }, { type: 'noise', hp: 4000, decay: 0.05, gain: 0.5, delay: 0.12, crackle: 0.02 }], reverb: { time: 0.6, mix: 0.25 }, volume: 0.6 },
  footstep: { vary: 0.15, layers: [{ type: 'noise', lp: 700, decay: 0.025, gain: 1 }, { type: 'noise', hp: 2000, lp: 5000, decay: 0.01, gain: 0.25 }], volume: 0.35 },
  punch: { vary: 0.1, layers: [{ type: 'sine', f0: 140, f1: 55, decay: 0.05, gain: 1 }, { type: 'noise', lp: 1500, decay: 0.04, gain: 0.8 }], volume: 0.65 },
  eat: { layers: [0, 0.14, 0.3].map(function (d) { return { type: 'noise', bp: 2400, q: 1.5, decay: 0.03, gain: 0.8, delay: d, crackle: 0.02 }; }), volume: 0.5 },
  drink: { layers: [0, 0.22, 0.44].map(function (d, i) { return { type: 'sine', f0: 330 + i * 30, f1: 520 + i * 40, sweep: 0.08, decay: 0.05, gain: 0.7, delay: d, lp: 1500 }; }), volume: 0.5 },
  heartbeat: { layers: [{ type: 'sine', f0: 60, f1: 40, decay: 0.07, gain: 1 }, { type: 'sine', f0: 55, f1: 38, decay: 0.08, gain: 0.8, delay: 0.24 }], volume: 0.6 },
  pickup_weapon: { layers: [{ type: 'noise', hp: 1200, lp: 6000, decay: 0.015, gain: 1 }, { type: 'sine', f0: 1800, decay: 0.05, gain: 0.3 }, { type: 'noise', hp: 900, lp: 4000, decay: 0.02, gain: 0.8, delay: 0.09 }], reverb: { time: 0.3, mix: 0.15 }, volume: 0.6 },
  door: { layers: [{ type: 'saw', f0: 110, f1: 90, decay: 0.2, lp: 800, gain: 0.6 }, { type: 'noise', lp: 600, decay: 0.08, gain: 0.8, delay: 0.25 }], reverb: { time: 0.5, mix: 0.2 }, volume: 0.55 },
  thunder: { drive: 2, vary: 0.2, layers: [{ type: 'noise', hp: 400, lp: 5000, decay: 0.05, gain: 0.8, crackle: 0.004 }, { type: 'brown', lp: 500, lpEnd: 90, sweep: 2, decay: 1.2, gain: 1.5, delay: 0.05 }, { type: 'brown', lp: 300, decay: 1.6, gain: 1, delay: 0.5 }], reverb: { time: 3, mix: 0.5 }, volume: 0.85 },
  engine_start: { layers: [{ type: 'saw', f0: 40, f1: 90, sweep: 0.8, decay: 0.4, lp: 700, gain: 1, drive: 2 }, { type: 'noise', lp: 400, decay: 0.3, gain: 0.5 }], volume: 0.6 }
};
Sfx.physicalNames = Object.keys(Sfx.PHYS);

/* ====================================================================== Music
 * Secuenciador de patrones: notas 'C4 E4 G4 . - C5+E5', batería 'k . s . h h s .' */
var NOTE_BASE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
var Music = {
  noteToFreq: function (tok, octaveShift) {
    var m = /^([A-Ga-g])([#b]?)(-?\d)?$/.exec(tok); if (!m) return 0;
    var n = NOTE_BASE[m[1].toLowerCase()] + (m[2] === '#' ? 1 : (m[2] === 'b' ? -1 : 0));
    var oct = (m[3] !== undefined ? parseInt(m[3], 10) : 4) + (octaveShift || 0);
    var midi = 12 * (oct + 1) + n;
    return 440 * Math.pow(2, (midi - 69) / 12);
  },
  render: function (def) {
    def = def || {};
    var sr = def.sampleRate || 44100, bpm = clamp(def.bpm || 120, 20, 400), spb = def.stepsPerBeat || 4;
    var stepSec = 60 / bpm / spb, stepLen = Math.round(stepSec * sr);
    var tracks = (def.tracks || []).map(function (t) {
      var toks = String(t.notes || '').replace(/\|/g, ' ').trim().split(/\s+/).filter(function (x) { return x.length; });
      return { def: t, toks: toks };
    });
    var steps = def.steps || tracks.reduce(function (m, t) { return Math.max(m, t.toks.length); }, 0) || 16;
    var loops = Math.max(1, def.loops || 1);
    var totalSteps = steps * loops;
    var total = totalSteps * stepLen + Math.round(sr * 0.5);
    if (total > sr * 600) throw new Error('UltraGame Music: canción demasiado larga');
    var L = new Float32Array(total), R = new Float32Array(total);
    var rng = new RNG(def.seed || 'music');
    tracks.forEach(function (tr) {
      var t = tr.def, toks = tr.toks; if (!toks.length) return;
      var vol = t.volume !== undefined ? t.volume : 0.25, wave = t.wave || 'square', pan = clamp(t.pan || 0, -1, 1);
      var gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
      var A = t.attack !== undefined ? t.attack : 0.005, D = t.decay !== undefined ? t.decay : 0.08, S = t.sustain !== undefined ? t.sustain : 0.6, Rl = t.release !== undefined ? t.release : 0.06;
      var duty = t.duty !== undefined ? t.duty : 0.5, oct = t.octave || 0, vib = t.vibrato || 0, det = Math.pow(2, (t.detune || 0) / 1200);
      // eventos
      var events = [];
      for (var s = 0; s < totalSteps; s++) {
        var tok = toks[s % toks.length];
        if (tok === '.' || tok === '-') { if (tok === '-' && events.length) events[events.length - 1].len++; continue; }
        if (wave === 'drums' || t.drums) { events.push({ start: s, len: 1, drum: tok.toLowerCase() }); continue; }
        var freqs = tok.split('+').map(function (x) { return Music.noteToFreq(x, oct) * det; }).filter(function (f) { return f > 0; });
        if (freqs.length) events.push({ start: s, len: 1, freqs: freqs });
      }
      for (var e = 0; e < events.length; e++) {
        var ev = events[e], s0 = ev.start * stepLen;
        if (ev.drum !== undefined) { renderDrum(ev.drum, L, R, s0, sr, vol, gl, gr, rng); continue; }
        var noteLen = ev.len * stepLen, relLen = Math.round(Rl * sr), n = noteLen + relLen;
        var aL = Math.max(1, Math.round(A * sr)), dL = Math.max(1, Math.round(D * sr));
        for (var fi = 0; fi < ev.freqs.length; fi++) {
          var f = ev.freqs[fi], ph = 0, amp = vol / Math.sqrt(ev.freqs.length);
          for (var k = 0; k < n && s0 + k < total; k++) {
            var env;
            if (k < aL) env = k / aL;
            else if (k < aL + dL) env = 1 - (1 - S) * ((k - aL) / dL);
            else env = S;
            if (k >= noteLen) env *= 1 - (k - noteLen) / relLen;
            var ff = vib ? f * (1 + Math.sin(k / sr * PI2 * 5.5) * vib * 0.01) : f;
            ph += ff / sr; ph -= Math.floor(ph);
            var smp;
            switch (wave) {
              case 'sine': smp = Math.sin(ph * PI2); break;
              case 'triangle': smp = 1 - 4 * Math.abs(ph - 0.5); break;
              case 'saw': smp = 2 * ph - 1; break;
              case 'noise': smp = rng.float() * 2 - 1; break;
              default: smp = ph < duty ? 0.6 : -0.6;
            }
            var v = smp * env * amp;
            L[s0 + k] += v * gl; R[s0 + k] += v * gr;
          }
        }
      }
    });
    var peak = 0;
    for (var i = 0; i < total; i++) { var a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (a > peak) peak = a; }
    if (peak > 0.95) { var g = 0.95 / peak; for (var j = 0; j < total; j++) { L[j] *= g; R[j] *= g; } }
    var loopLen = def.trimTail === false ? total : steps * loops * stepLen;
    return { channels: [L.subarray(0, loopLen), R.subarray(0, loopLen)], sampleRate: sr, duration: loopLen / sr, stepSeconds: stepSec };
  }
};
function renderDrum(kind, L, R, s0, sr, vol, gl, gr, rng) {
  var n, k, v, total = L.length;
  var add = function (i, val) { if (s0 + i < total) { L[s0 + i] += val * gl; R[s0 + i] += val * gr; } };
  switch (kind) {
    case 'k': { n = Math.round(sr * 0.25); var ph = 0; for (k = 0; k < n; k++) { var t = k / sr, f = 150 * Math.exp(-t * 18) + 45; ph += f / sr; v = Math.sin(ph * PI2) * Math.exp(-t * 9) * vol * 1.6; add(k, v); } break; }
    case 's': { n = Math.round(sr * 0.2); var ph2 = 0, lp = 0; for (k = 0; k < n; k++) { var t2 = k / sr; ph2 += 185 / sr; var nz = rng.float() * 2 - 1; lp += (nz - lp) * 0.6; v = (lp * 0.8 + Math.sin(ph2 * PI2) * 0.4 * Math.exp(-t2 * 30)) * Math.exp(-t2 * 16) * vol * 1.1; add(k, v); } break; }
    case 'c': { n = Math.round(sr * 0.18); for (k = 0; k < n; k++) { var t3 = k / sr, burst = (t3 % 0.012) < 0.006 && t3 < 0.036 ? 1 : 0.5; v = (rng.float() * 2 - 1) * Math.exp(-t3 * 20) * burst * vol; add(k, v); } break; }
    case 't': { n = Math.round(sr * 0.3); var p3 = 0; for (k = 0; k < n; k++) { var t4 = k / sr; p3 += (110 * Math.exp(-t4 * 6) + 60) / sr; v = Math.sin(p3 * PI2) * Math.exp(-t4 * 7) * vol * 1.2; add(k, v); } break; }
    case 'o': case 'h': default: {
      var dec = kind === 'o' ? 7 : 45; n = Math.round(sr * (kind === 'o' ? 0.35 : 0.06)); var prev = 0;
      for (k = 0; k < n; k++) { var t5 = k / sr, nz2 = rng.float() * 2 - 1, hp = nz2 - prev; prev = nz2; v = hp * Math.exp(-t5 * dec) * vol * 0.45; add(k, v); }
    }
  }
}

UG.SoundManager = SoundManager;
UG.Sound = Sound;
UG.SoundInstance = SoundInstance;
UG.Sfx = Sfx;
UG.Music = Music;
