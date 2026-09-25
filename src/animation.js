/* UltraGame - animaciones de sprites por frames (estilo Phaser): registro global, generación de frames,
 * yoyo, repeat, delays, encadenado, eventos, velocidad y reversa. Los estados se actualizan por la escena
 * y se eliminan solos al detenerse o destruirse el sprite. */

class Animation {
  constructor(manager, key, config) {
    this.manager = manager; this.key = key;
    config = config || {};
    this.frames = this._resolveFrames(config.frames || []);
    this.frameRate = config.frameRate !== undefined ? config.frameRate : (config.duration ? this.frames.length / (config.duration / 1000) : 24);
    if (!(this.frameRate > 0)) this.frameRate = 24;
    this.repeat = config.repeat !== undefined ? config.repeat : 0;
    this.repeatDelay = config.repeatDelay || 0;
    this.yoyo = !!config.yoyo;
    this.delay = config.delay || 0;
    this.showOnStart = !!config.showOnStart;
    this.hideOnComplete = !!config.hideOnComplete;
    this.skipMissedFrames = config.skipMissedFrames !== false;
  }
  _resolveFrames(frames) {
    var tm = this.manager ? this.manager.game.textures : UG._defaultTextures, out = [];
    if (typeof frames === 'string') {
      // clave de spritesheet/atlas completo
      var names = tm ? tm.getFrameNames(frames) : [];
      frames = names.map(function (n) { return { key: frames, frame: n }; });
    }
    for (var i = 0; i < frames.length; i++) {
      var f = frames[i], tex = null, dur = 0;
      if (f instanceof Texture) tex = f;
      else if (f && f.texture instanceof Texture) { tex = f.texture; dur = f.duration || 0; }
      else if (f && tm) { tex = tm.get(f.key, f.frame); dur = f.duration || 0; }
      if (tex) out.push({ texture: tex, duration: dur, index: i, isFirst: i === 0, isLast: i === frames.length - 1 });
    }
    return out;
  }
  get duration() { return this.frames.length / this.frameRate * 1000; }
  getFrameAt(i) { return this.frames[i]; }
}

class AnimationManager extends EventEmitter {
  constructor(game) { super(); this.game = game; this.anims = new Map(); this.globalTimeScale = 1; this.paused = false; this._orphans = []; }
  /** this.anims.create({ key:'run', frames: this.anims.generateFrameNumbers('hero', {start:0, end:5}), frameRate:12, repeat:-1 }) */
  create(config) {
    if (!config || !config.key) throw new Error('UltraGame: animación sin key');
    if (this.anims.has(config.key)) { Log.warnOnce('anim:' + config.key, 'La animación "' + config.key + '" ya existe'); return this.anims.get(config.key); }
    var a = new Animation(this, config.key, config);
    this.anims.set(config.key, a);
    this.emit('add', config.key, a);
    return a;
  }
  /** Crea todas las animaciones definidas en un atlas (campo "animations" de TexturePacker/Pixi) */
  createFromAtlas(textureKey, config) {
    var e = this.game.textures.getEntry(textureKey), out = [], self = this;
    if (!e || !e.animations) return out;
    Object.keys(e.animations).forEach(function (k) {
      out.push(self.create(Object.assign({ key: k, frames: e.animations[k].map(function (n) { return { key: textureKey, frame: n }; }), frameRate: 12, repeat: -1 }, config || {})));
    });
    return out;
  }
  exists(key) { return this.anims.has(key); }
  get(key) { return this.anims.get(key) || null; }
  remove(key) { var a = this.anims.get(key); if (a) { this.anims.delete(key); this.emit('remove', key, a); } return a || null; }
  /** Frames por número de un spritesheet: {start, end, first, frames:[...]} */
  generateFrameNumbers(key, config) {
    config = config || {};
    var names = this.game.textures.getFrameNames(key), out = [];
    if (config.frames) { for (var i = 0; i < config.frames.length; i++) out.push({ key: key, frame: config.frames[i] }); return out; }
    var start = config.start || 0, end = config.end !== undefined ? config.end : names.length - 1;
    if (config.first !== undefined) out.push({ key: key, frame: config.first });
    var step = start <= end ? 1 : -1;
    for (var n = start; step > 0 ? n <= end : n >= end; n += step) out.push({ key: key, frame: n });
    return out;
  }
  /** Frames por nombre de un atlas: {prefix:'run_', start:1, end:8, zeroPad:2, suffix:'.png'} */
  generateFrameNames(key, config) {
    config = config || {};
    var out = [], prefix = config.prefix || '', suffix = config.suffix || '', pad = config.zeroPad || 0;
    if (config.frames) { config.frames.forEach(function (f) { out.push({ key: key, frame: prefix + (pad ? ('0000000000' + f).slice(-pad) : f) + suffix }); }); return out; }
    if (config.start === undefined && config.end === undefined && !prefix) return this.game.textures.getFrameNames(key).map(function (n) { return { key: key, frame: n }; });
    var start = config.start || 0, end = config.end !== undefined ? config.end : start, step = start <= end ? 1 : -1;
    for (var n = start; step > 0 ? n <= end : n >= end; n += step) out.push({ key: key, frame: prefix + (pad ? ('0000000000' + n).slice(-pad) : n) + suffix });
    return out;
  }
  pauseAll() { this.paused = true; return this; }
  resumeAll() { this.paused = false; return this; }
  _addOrphan(st) { if (this._orphans.indexOf(st) < 0) this._orphans.push(st); }
  update(delta) { updateAnimList(this._orphans, delta); }
  destroy() { this.anims.clear(); this._orphans.length = 0; this.off(); this.game = null; }
}

function updateAnimList(list, delta) {
  var j = 0;
  for (var i = 0; i < list.length; i++) {
    var st = list[i];
    if (!st.sprite || st.sprite.destroyed || !st.isPlaying) { st._registered = false; continue; }
    st.update(delta);
    if (st.isPlaying) list[j++] = st; else st._registered = false;
  }
  list.length = j;
}

class AnimationState {
  constructor(sprite) {
    this.sprite = sprite;
    this.currentAnim = null; this.currentFrame = null; this.index = 0;
    this.isPlaying = false; this.isPaused = false;
    this.timeScale = 1; this.forward = true; this.inReverse = false;
    this.repeatCounter = 0; this.accumulator = 0; this.nextTick = 0; this.delayCounter = 0;
    this._chain = [];
    this._registered = false;
    this.yoyo = false; this.repeat = 0; this.frameRate = 24; this.repeatDelay = 0; this._pendingRepeat = 0;
  }
  get manager() { var s = this.sprite.scene; return s && s.game ? s.game.anims : (UG._defaultGame ? UG._defaultGame.anims : null); }
  getName() { return this.currentAnim ? this.currentAnim.key : ''; }
  getProgress() { var a = this.currentAnim; if (!a || a.frames.length < 2) return 0; var p = this.index / (a.frames.length - 1); return this.inReverse ? 1 - p : p; }
  _register() {
    if (this._registered) return;
    this._registered = true;
    var sc = this.sprite.scene;
    if (sc && sc.sys && sc.sys.anims) sc.sys.anims.push(this);
    else if (this.manager) this.manager._addOrphan(this);
    else this._registered = false;
  }
  play(key, ignoreIfPlaying, reverse) {
    var anim = key instanceof Animation ? key : null, cfg = null;
    if (!anim) {
      if (key && typeof key === 'object') { cfg = key; key = key.key; }
      var m = this.manager; anim = m ? m.get(key) : null;
      if (!anim) { Log.warnOnce('noanim:' + key, 'Animación "' + key + '" no encontrada'); return this; }
    }
    if (ignoreIfPlaying && this.isPlaying && this.currentAnim === anim) return this;
    this.currentAnim = anim;
    this.frameRate = cfg && cfg.frameRate ? cfg.frameRate : anim.frameRate;
    this.repeat = cfg && cfg.repeat !== undefined ? cfg.repeat : anim.repeat;
    this.yoyo = cfg && cfg.yoyo !== undefined ? cfg.yoyo : anim.yoyo;
    this.repeatDelay = cfg && cfg.repeatDelay !== undefined ? cfg.repeatDelay : anim.repeatDelay;
    this.delayCounter = cfg && cfg.delay !== undefined ? cfg.delay : anim.delay;
    this.timeScale = cfg && cfg.timeScale ? cfg.timeScale : this.timeScale;
    this.repeatCounter = this.repeat < 0 ? -1 : this.repeat;
    this.inReverse = !!reverse; this.forward = !reverse;
    this.index = reverse ? anim.frames.length - 1 : (cfg && cfg.startFrame ? cfg.startFrame : 0);
    this.accumulator = 0; this._pendingRepeat = 0;
    this.isPlaying = anim.frames.length > 0; this.isPaused = false;
    this._setFrame();
    if (anim.showOnStart) this.sprite.visible = true;
    this.sprite.emit('animationstart', anim, this.currentFrame, this.sprite);
    this._register();
    return this;
  }
  playReverse(key, ignore) { return this.play(key, ignore, true); }
  chain(key) { if (key === undefined) this._chain.length = 0; else this._chain = this._chain.concat(key); return this; }
  pause() { this.isPaused = true; return this; }
  resume() { this.isPaused = false; return this; }
  stop() {
    var was = this.isPlaying;
    this.isPlaying = false;
    if (was && this.currentAnim) this.sprite.emit('animationstop', this.currentAnim, this.currentFrame, this.sprite);
    this._runChain();
    return this;
  }
  stopAfterDelay(ms) { var self = this; setTimeout(function () { if (self.sprite && !self.sprite.destroyed) self.stop(); }, ms); return this; }
  setFrame(i) { if (!this.currentAnim) return this; this.index = clamp(i | 0, 0, this.currentAnim.frames.length - 1); this._setFrame(); return this; }
  nextFrame() { return this.setFrame(this.index + 1); }
  previousFrame() { return this.setFrame(this.index - 1); }
  _setFrame() {
    var f = this.currentAnim.frames[this.index]; if (!f) return;
    this.currentFrame = f;
    var s = this.sprite;
    var ax = s.anchorX, ay = s.anchorY;
    s._texture = f.texture;
    if (f.texture.defaultAnchor && !s._anchorSetByUser) { s.anchorX = f.texture.defaultAnchor.x; s.anchorY = f.texture.defaultAnchor.y; } else { s.anchorX = ax; s.anchorY = ay; }
  }
  _runChain() {
    if (this._chain.length) { var next = this._chain.shift(); this.play(next); }
  }
  update(delta) {
    if (!this.isPlaying || this.isPaused || !this.currentAnim) return;
    var m = this.manager;
    if (m && m.paused) return;
    var dt = delta * this.timeScale * (m ? m.globalTimeScale : 1);
    if (this.delayCounter > 0) { this.delayCounter -= dt; if (this.delayCounter > 0) return; dt = -this.delayCounter; this.delayCounter = 0; }
    if (this._pendingRepeat > 0) { this._pendingRepeat -= dt; if (this._pendingRepeat > 0) return; dt = -this._pendingRepeat; this._pendingRepeat = 0; }
    this.accumulator += dt;
    var anim = this.currentAnim, frames = anim.frames, guard = 0;
    while (this.isPlaying && guard++ < 256) {
      var fr = frames[this.index], frameMs = 1000 / this.frameRate + (fr && fr.duration ? fr.duration : 0);
      if (this.accumulator < frameMs) break;
      this.accumulator -= frameMs;
      this._advance();
      if (!anim.skipMissedFrames) { this.accumulator = Math.min(this.accumulator, frameMs); }
      if (this._pendingRepeat > 0) break;
    }
  }
  _advance() {
    var anim = this.currentAnim, n = anim.frames.length;
    var step = this.forward !== this.inReverse ? 1 : -1;
    var ni = this.index + step;
    if (ni >= 0 && ni < n) { this.index = ni; this._setFrame(); this.sprite.emit('animationupdate', anim, this.currentFrame, this.sprite); return; }
    // fin del recorrido
    if (this.yoyo && this.forward) { this.forward = false; if (n > 1) { this.index += -step; this._setFrame(); } this.sprite.emit('animationupdate', anim, this.currentFrame, this.sprite); return; }
    if (this.repeatCounter !== 0) {
      if (this.repeatCounter > 0) this.repeatCounter--;
      this.forward = true;
      if (!this.yoyo) { this.index = this.inReverse ? n - 1 : 0; this._setFrame(); }
      this._pendingRepeat = this.repeatDelay;
      this.sprite.emit('animationrepeat', anim, this.currentFrame, this.sprite);
      return;
    }
    this.isPlaying = false;
    if (anim.hideOnComplete) this.sprite.visible = false;
    this.sprite.emit('animationcomplete', anim, this.currentFrame, this.sprite);
    this.sprite.emit('animationcomplete-' + anim.key, anim, this.currentFrame, this.sprite);
    this._runChain();
  }
  destroy() { this.isPlaying = false; this.currentAnim = null; this.currentFrame = null; this._chain.length = 0; this.sprite = null; }
}

UG.Animation = Animation;
UG.AnimationManager = AnimationManager;
UG.AnimationState = AnimationState;
