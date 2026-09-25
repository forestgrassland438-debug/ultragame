/* UltraGame - sistema de partículas de alto rendimiento.
 * Datos en arrays tipados (Structure of Arrays), sin objetos por partícula ni basura para el GC.
 * Opcionalmente usa el núcleo WASM SIMD (UG.Wasm) para integrar la física de cientos de miles de partículas. */

function parseRange(v, def) {
  if (v === undefined || v === null) return { min: def, max: def };
  if (typeof v === 'number') return { min: v, max: v };
  if (Array.isArray(v)) return { min: +v[0], max: +(v[1] === undefined ? v[0] : v[1]), list: v.length > 2 ? v.slice() : null };
  if (typeof v === 'object') {
    if ('min' in v || 'max' in v) { var mn = v.min !== undefined ? +v.min : def; return { min: mn, max: v.max !== undefined ? +v.max : mn }; }
    if ('start' in v) return { min: +v.start, max: +v.start };
  }
  return { min: def, max: def };
}
function parseStartEnd(v, def) {
  if (v === undefined || v === null) return { start: def, end: def, ease: null, random: null };
  if (typeof v === 'number') return { start: v, end: v, ease: null, random: null };
  if (typeof v === 'object' && !Array.isArray(v)) {
    if ('start' in v || 'end' in v) { var s = v.start !== undefined ? +v.start : def; return { start: s, end: v.end !== undefined ? +v.end : s, ease: v.ease ? Easing.get(v.ease) : null, random: v.random ? parseRange(v.random, 0) : null }; }
    if ('min' in v || 'max' in v) { var r = parseRange(v, def); return { start: r.min, end: r.min, ease: null, random: r }; }
  }
  return { start: def, end: def, ease: null, random: null };
}

class ParticleEmitter extends Container {
  constructor(texture, config) {
    super();
    this.type = 'ParticleEmitter';
    config = config || {};
    this.frames = Array.isArray(texture) ? texture.slice() : [texture || Texture.WHITE];
    this.texture = this.frames[0];
    this.capacity = 0;
    this.count = 0;
    this.rng = config.rng || UG.rng;
    this._acc = 0;
    this._elapsed = 0;
    this._emitted = 0;
    this.followTarget = null; this.followOffsetX = 0; this.followOffsetY = 0;
    this.timeScale = 1;
    this._wasm = null;
    this.setConfig(config);
    this._alloc(Math.min(Security.maxParticles, config.maxParticles || 2000));
    if (config.wasm) this.useWasm();
  }
  /** Activa el núcleo WebAssembly SIMD para la simulación (asíncrono; mientras tanto usa JS). */
  useWasm() {
    var self = this;
    Wasm.init().then(function (ok) { if (ok && !self.destroyed) Wasm.attachEmitter(self); });
    return this;
  }
  get usingWasm() { return !!this._wasm; }
  _wasmCheck() { if (this._wasm && this._wasmBuf !== Wasm.memory.buffer) this._wasm.rebind(); }
  setConfig(c) {
    this.config = c;
    this.emitX = parseRange(c.x, 0); this.emitY = parseRange(c.y, 0);
    this.lifespan = parseRange(c.lifespan, 1000);
    this.speed = parseRange(c.speed !== undefined ? c.speed : (c.speedX === undefined && c.speedY === undefined ? 100 : 0), 0);
    this.speedX = c.speedX !== undefined ? parseRange(c.speedX, 0) : null;
    this.speedY = c.speedY !== undefined ? parseRange(c.speedY, 0) : null;
    this.angleRange = parseRange(c.angle, 0);
    if (c.angle === undefined) this.angleRange = { min: 0, max: 360 };
    this.gravityX = +c.gravityX || 0; this.gravityY = +c.gravityY || 0;
    this.accelX = +c.accelerationX || 0; this.accelY = +c.accelerationY || 0;
    this.drag = c.drag !== undefined ? +c.drag : 0;
    this.scaleCfg = parseStartEnd(c.scale, 1);
    this.alphaCfg = parseStartEnd(c.alpha, 1);
    this.rotateCfg = parseStartEnd(c.rotate, 0);
    this.rotSpeed = c.rotationSpeed !== undefined ? parseRange(c.rotationSpeed, 0) : null;
    this.angleAlign = !!c.angleAlign;
    this.stretch = +c.stretch || 0;
    this.tintRamp = null;
    if (Array.isArray(c.color)) this.tintRamp = c.color.map(Color.toNumber);
    else if (c.tint !== undefined) {
      if (typeof c.tint === 'object' && !Array.isArray(c.tint) && 'start' in c.tint) this.tintRamp = [Color.toNumber(c.tint.start), Color.toNumber(c.tint.end !== undefined ? c.tint.end : c.tint.start)];
      else if (Array.isArray(c.tint)) this._tintList = c.tint.map(Color.toNumber);
      else this.tintRamp = [Color.toNumber(c.tint)];
    }
    this.colorEase = c.colorEase ? Easing.get(c.colorEase) : null;
    this.blendMode = c.blendMode || 'normal';
    this.frequency = c.frequency !== undefined ? +c.frequency : 0;
    this.quantity = c.quantity !== undefined ? parseRange(c.quantity, 1) : { min: 1, max: 1 };
    this.emitting = c.emitting !== undefined ? !!c.emitting : !(c.frequency === -1);
    if (this.frequency < 0) this.emitting = false;
    this.duration = c.duration || 0;
    this.stopAfter = c.stopAfter || 0;
    this.emitZone = c.emitZone || null;
    this.deathZone = c.deathZone || null;
    this.bounds = c.bounds || null;
    this.bounce = c.bounce !== undefined ? +c.bounce : 0.5;
    this.radial = c.radial !== false;
    this.randomFrame = c.randomFrame !== false;
    this.onEmit = c.onEmit || null;
    this.onDeath = c.onDeath || null;
    this.particleBringToTop = c.particleBringToTop !== false;
    if (c.follow) this.startFollow(c.follow, c.followOffset ? c.followOffset.x : 0, c.followOffset ? c.followOffset.y : 0);
    return this;
  }
  _alloc(n) {
    n = Math.max(1, n | 0);
    var old = this.capacity ? this._arrays() : null;
    this.capacity = n;
    this.px = new Float32Array(n); this.py = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n);
    this.life = new Float32Array(n); this.invLife = new Float32Array(n);
    this.rot = new Float32Array(n); this.vrot = new Float32Array(n);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n);
    this.a0 = new Float32Array(n); this.a1 = new Float32Array(n);
    this.pTint = new Uint32Array(n); this.frame = new Uint16Array(n);
    if (old) {
      var keep = Math.min(this.count, n), names = ['px', 'py', 'vx', 'vy', 'life', 'invLife', 'rot', 'vrot', 's0', 's1', 'a0', 'a1', 'pTint', 'frame'];
      for (var i = 0; i < names.length; i++) this[names[i]].set(old[names[i]].subarray(0, keep));
      this.count = keep;
    }
  }
  _arrays() { return { px: this.px, py: this.py, vx: this.vx, vy: this.vy, life: this.life, invLife: this.invLife, rot: this.rot, vrot: this.vrot, s0: this.s0, s1: this.s1, a0: this.a0, a1: this.a1, pTint: this.pTint, frame: this.frame }; }
  setMaxParticles(n) { this._alloc(Math.min(Security.maxParticles, n)); return this; }
  get maxParticles() { return this.capacity; }
  get alive() { return this.count; }
  getAliveParticleCount() { return this.count; }
  start() { this.emitting = true; this._elapsed = 0; this._emitted = 0; return this; }
  stop(kill) { this.emitting = false; if (kill) this.killAll(); return this; }
  pause() { this._paused = true; return this; }
  resume() { this._paused = false; return this; }
  killAll() { this.count = 0; return this; }
  /** Color de las nuevas partículas (uno o lista aleatoria); no afecta a las ya emitidas. */
  setParticleTint(c) { this.tintRamp = null; this._tintList = (Array.isArray(c) ? c : [c]).map(Color.toNumber); return this; }
  /** Rampa de color durante la vida (afecta a todas). */
  setColorRamp(list) { this.tintRamp = list.map(Color.toNumber); this._tintList = null; return this; }
  setFrequency(f, q) { this.frequency = f; if (q !== undefined) this.quantity = parseRange(q, 1); if (f >= 0) this.emitting = true; return this; }
  startFollow(target, ox, oy) { this.followTarget = target; this.followOffsetX = ox || 0; this.followOffsetY = oy || 0; return this; }
  stopFollow() { this.followTarget = null; return this; }
  setEmitterPosition(x, y) { this.emitX = parseRange(x, 0); this.emitY = parseRange(y, 0); return this; }
  /** Emite n partículas de golpe (en x,y locales si se indican). */
  explode(n, x, y) { this.emitParticle(n === undefined ? 20 : n, x, y); return this; }
  emitParticleAt(x, y, n) { return this.emitParticle(n || 1, x, y); }
  emitParticle(n, x, y) {
    n = n === undefined ? 1 : n | 0;
    if (this._wasm) this._wasmCheck();
    var rng = this.rng;
    var baseX, baseY;
    if (this.followTarget) { baseX = this.followTarget.x + this.followOffsetX; baseY = this.followTarget.y + this.followOffsetY; }
    for (var k = 0; k < n; k++) {
      if (this.count >= this.capacity) {
        if (!this.particleBringToTop) return this;
        this._kill(0); // recicla la más antigua
      }
      var i = this.count++;
      var ox = x !== undefined ? x : (baseX !== undefined ? baseX : this.emitX.min + (this.emitX.max - this.emitX.min) * rng.float());
      var oy = y !== undefined ? y : (baseY !== undefined ? baseY : this.emitY.min + (this.emitY.max - this.emitY.min) * rng.float());
      if (this.emitZone) {
        var z = this.emitZone, src = z.source || z, pt = _tmpVec;
        if (z.type === 'edge' && src.getPerimeterPoint) src.getPerimeterPoint(z.quantity ? ((this._emitted % z.quantity) / z.quantity) : rng.float(), pt);
        else if (src.getRandomPoint) src.getRandomPoint(rng, pt);
        else pt.set(0, 0);
        ox += pt.x; oy += pt.y;
      }
      this.px[i] = ox; this.py[i] = oy;
      var life = this.lifespan.min + (this.lifespan.max - this.lifespan.min) * rng.float();
      if (life <= 0) life = 1;
      this.life[i] = life / 1000; this.invLife[i] = 1000 / life;
      if (this.speedX || this.speedY) {
        var sX = this.speedX || { min: 0, max: 0 }, sY = this.speedY || { min: 0, max: 0 };
        this.vx[i] = sX.min + (sX.max - sX.min) * rng.float();
        this.vy[i] = sY.min + (sY.max - sY.min) * rng.float();
      } else {
        var ang = (this.angleRange.min + (this.angleRange.max - this.angleRange.min) * rng.float()) * DEG_TO_RAD;
        var sp = this.speed.min + (this.speed.max - this.speed.min) * rng.float();
        this.vx[i] = Math.cos(ang) * sp; this.vy[i] = Math.sin(ang) * sp;
      }
      var sc = this.scaleCfg, al = this.alphaCfg;
      var sStart = sc.random ? sc.random.min + (sc.random.max - sc.random.min) * rng.float() : sc.start;
      this.s0[i] = sStart; this.s1[i] = sc.random ? sStart : sc.end;
      var aStart = al.random ? al.random.min + (al.random.max - al.random.min) * rng.float() : al.start;
      this.a0[i] = aStart; this.a1[i] = al.random ? aStart : al.end;
      this.rot[i] = this.rotateCfg.start * DEG_TO_RAD;
      this.vrot[i] = this.rotSpeed ? (this.rotSpeed.min + (this.rotSpeed.max - this.rotSpeed.min) * rng.float()) * DEG_TO_RAD : 0;
      this.pTint[i] = this._tintList ? this._tintList[rng.int(0, this._tintList.length - 1)] : (this.tintRamp ? this.tintRamp[0] : 0xffffff);
      this.frame[i] = this.frames.length > 1 ? (this.randomFrame ? rng.int(0, this.frames.length - 1) : (this._emitted % this.frames.length)) : 0;
      this._emitted++;
      if (this.onEmit) this.onEmit(this, i);
    }
    return this;
  }
  _kill(i) {
    if (this.onDeath) this.onDeath(this, i);
    var last = --this.count;
    if (i !== last) {
      this.px[i] = this.px[last]; this.py[i] = this.py[last]; this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last];
      this.life[i] = this.life[last]; this.invLife[i] = this.invLife[last]; this.rot[i] = this.rot[last]; this.vrot[i] = this.vrot[last];
      this.s0[i] = this.s0[last]; this.s1[i] = this.s1[last]; this.a0[i] = this.a0[last]; this.a1[i] = this.a1[last];
      this.pTint[i] = this.pTint[last]; this.frame[i] = this.frame[last];
    }
  }
  preUpdate(time, delta) { this.update(delta); }
  update(deltaMs) {
    if (this._paused || this.destroyed) return;
    var dtMs = deltaMs * this.timeScale, dt = dtMs / 1000;
    if (dt <= 0) return;
    // emisión
    if (this.emitting) {
      this._elapsed += dtMs;
      if (this.frequency === 0) this.emitParticle(this._qty());
      else if (this.frequency > 0) {
        this._acc += dtMs;
        var guard = 0;
        while (this._acc >= this.frequency && guard++ < 1000) { this._acc -= this.frequency; this.emitParticle(this._qty()); }
      }
      if ((this.duration > 0 && this._elapsed >= this.duration) || (this.stopAfter > 0 && this._emitted >= this.stopAfter)) { this.emitting = false; this.emit('stop', this); }
    }
    // simulación
    if (this._wasmUpdate && UG.Wasm && UG.Wasm.ready && !this.deathZone && !this.bounds && !this.onDeath) this._wasmUpdate(dt);
    else this._jsUpdate(dt);
    if (!this.emitting && this.count === 0 && this._wasActive) { this._wasActive = false; this.emit('complete', this); }
    if (this.count > 0) this._wasActive = true;
  }
  _qty() { var q = this.quantity; return q.min === q.max ? q.min : Math.round(q.min + (q.max - q.min) * this.rng.float()); }
  _jsUpdate(dt) {
    var gx = (this.gravityX + this.accelX) * dt, gy = (this.gravityY + this.accelY) * dt;
    var damp = this.drag > 0 ? Math.max(0, 1 - this.drag * dt) : 1;
    var px = this.px, py = this.py, vx = this.vx, vy = this.vy, life = this.life, rot = this.rot, vrot = this.vrot;
    var dz = this.deathZone, bnd = this.bounds, bounce = this.bounce;
    for (var i = 0; i < this.count; i++) {
      var l = life[i] - dt;
      if (l <= 0) { this._kill(i); i--; continue; }
      life[i] = l;
      var nvx = (vx[i] + gx) * damp, nvy = (vy[i] + gy) * damp;
      vx[i] = nvx; vy[i] = nvy;
      px[i] += nvx * dt; py[i] += nvy * dt;
      if (vrot[i] !== 0) rot[i] += vrot[i] * dt;
      if (bnd) {
        if (px[i] < bnd.x) { px[i] = bnd.x; vx[i] = -vx[i] * bounce; } else if (px[i] > bnd.x + bnd.width) { px[i] = bnd.x + bnd.width; vx[i] = -vx[i] * bounce; }
        if (py[i] < bnd.y) { py[i] = bnd.y; vy[i] = -vy[i] * bounce; } else if (py[i] > bnd.y + bnd.height) { py[i] = bnd.y + bnd.height; vy[i] = -vy[i] * bounce; }
      }
      if (dz) {
        var inside = (dz.source || dz).contains(px[i], py[i]);
        if ((dz.type === 'onLeave') ? !inside : inside) { this._kill(i); i--; }
      }
    }
  }
  _renderGPU(r) {
    var n = this.count; if (!n) return;
    if (this._wasm) this._wasmCheck();
    var wt = this.worldTransform, A = wt.a, B = wt.b, C = wt.c, D = wt.d, TX = wt.tx, TY = wt.ty;
    var batcher = r.batcher, blend = this.worldBlend;
    var frames = this.frames, multi = frames.length > 1;
    var tex = frames[0], src = tex.source, uvs = tex.uvs, hw = tex.width / 2, hh = tex.height / 2;
    var px = this.px, py = this.py, life = this.life, inv = this.invLife, s0 = this.s0, s1 = this.s1, a0 = this.a0, a1 = this.a1, rot = this.rot, tintA = this.pTint, fr = this.frame;
    var sEase = this.scaleCfg.ease, aEase = this.alphaCfg.ease, ramp = this.tintRamp, rampN = ramp ? ramp.length : 0, cEase = this.colorEase;
    var worldAlpha = this.worldAlpha, worldTint = this.worldTint;
    var align = this.angleAlign, stretch = this.stretch, vx = this.vx, vy = this.vy;
    var rotStart = this.rotateCfg.start * DEG_TO_RAD, rotEnd = this.rotateCfg.end * DEG_TO_RAD, rotAnim = this.rotateCfg.start !== this.rotateCfg.end;
    var cull = r.cull, cr = r.cullRect, cx0 = cr.x, cy0 = cr.y, cx1 = cr.x + cr.width, cy1 = cr.y + cr.height;
    for (var i = 0; i < n; i++) {
      var t = 1 - life[i] * inv[i]; if (t < 0) t = 0; else if (t > 1) t = 1;
      var st = sEase ? sEase(t) : t, at = aEase ? aEase(t) : t;
      var scale = s0[i] + (s1[i] - s0[i]) * st;
      var alpha = (a0[i] + (a1[i] - a0[i]) * at) * worldAlpha;
      if (alpha <= 0.002 || scale === 0) continue;
      if (multi) { tex = frames[fr[i]] || frames[0]; src = tex.source; uvs = tex.uvs; hw = tex.width / 2; hh = tex.height / 2; }
      var color;
      if (rampN > 1) { var ct = cEase ? cEase(t) : t; var f = ct * (rampN - 1), ci = f | 0; if (ci >= rampN - 1) { ci = rampN - 2; f = rampN - 1; } color = Color.lerp(ramp[ci], ramp[ci + 1], f - ci); }
      else color = tintA[i];
      if (worldTint !== 0xffffff) color = Color.multiply(color, worldTint);
      var packed = packColor(color, alpha);
      var angle;
      if (align) angle = Math.atan2(vy[i], vx[i]);
      else angle = rotAnim ? rotStart + (rotEnd - rotStart) * t + rot[i] - rotStart : rot[i];
      var sx = hw * scale, sy = hh * scale;
      if (stretch > 0 && align) { var spd = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]); sx *= 1 + spd * stretch / 100; }
      var lx = px[i], ly = py[i];
      var cxw = A * lx + C * ly + TX, cyw = B * lx + D * ly + TY;
      var ux, uy, vx2, vy2;
      if (angle !== 0) {
        var co = Math.cos(angle), si = Math.sin(angle);
        ux = (A * co + C * si) * sx; uy = (B * co + D * si) * sx;
        vx2 = (-A * si + C * co) * sy; vy2 = (-B * si + D * co) * sy;
      } else { ux = A * sx; uy = B * sx; vx2 = C * sy; vy2 = D * sy; }
      if (cull) {
        var ex = Math.abs(ux) + Math.abs(vx2), ey = Math.abs(uy) + Math.abs(vy2);
        if (cxw + ex < cx0 || cxw - ex > cx1 || cyw + ey < cy0 || cyw - ey > cy1) continue;
      }
      if (tex.rotate) {
        QV[0] = cxw - ux - vx2; QV[1] = cyw - uy - vy2; QV[2] = cxw + ux - vx2; QV[3] = cyw + uy - vy2;
        QV[4] = cxw + ux + vx2; QV[5] = cyw + uy + vy2; QV[6] = cxw - ux + vx2; QV[7] = cyw - uy + vy2;
        batcher.pushQuad(src, QV, uvs, packed, blend);
      } else batcher.pushInstance(src, cxw - ux - vx2, cyw - uy - vy2, ux * 2, uy * 2, vx2 * 2, vy2 * 2, uvs[0], uvs[1], uvs[4], uvs[5], packed, blend);
    }
  }
  _renderCanvas(r) { r.drawParticles(this); }
  _addSelfBounds(b) {
    var m = this.worldTransform, hw = this.texture.width, hh = this.texture.height;
    for (var i = 0; i < this.count; i++) b.addRect(this.px[i] - hw, this.py[i] - hh, this.px[i] + hw, this.py[i] + hh, m);
  }
  _onDestroy() {
    this.followTarget = null; this.onEmit = null; this.onDeath = null; this.count = 0;
    if (this._wasm && this._wasm.free) this._wasm.free();
    this._wasm = null;
  }
}

/* ============================================================ ParticleContainer
 * Contenedor para CANTIDADES MASIVAS de sprites simples (hasta cientos de miles): cada Particle es un objeto
 * ligero (~12 campos) y el contenedor escribe directamente en el lote instanciado, sin recorrer el grafo. */
class Particle {
  constructor(texture, x, y) {
    this.x = x || 0; this.y = y || 0;
    this.scaleX = 1; this.scaleY = 1; this.rotation = 0;
    this.anchorX = 0.5; this.anchorY = 0.5;
    this.tint = 0xffffff; this.alpha = 1;
    this.texture = texture || Texture.WHITE;
    this.visible = true;
    this._c = 0; this._ct = -1; this._ca = -1; this._r = 0; this._cos = 1; this._sin = 0;
  }
  setPosition(x, y) { this.x = x; this.y = y === undefined ? x : y; return this; }
  setScale(x, y) { this.scaleX = x; this.scaleY = y === undefined ? x : y; return this; }
}
class ParticleContainer extends Container {
  constructor(options) {
    super();
    this.type = 'ParticleContainer';
    options = options || {};
    this.particles = [];
    this.roundPixels = !!options.roundPixels;
    if (options.blendMode) this.blendMode = options.blendMode;
  }
  get particleCount() { return this.particles.length; }
  addParticle(p) { this.particles.push(p); return p; }
  addParticles(list) { for (var i = 0; i < list.length; i++) this.particles.push(list[i]); return this; }
  removeParticle(p) { removeFromArray(this.particles, p); return p; }
  removeParticles(begin, end) { return this.particles.splice(begin || 0, (end === undefined ? this.particles.length : end) - (begin || 0)); }
  _renderGPU(r) {
    var ps = this.particles, n = ps.length; if (!n) return;
    var wt = this.worldTransform, A = wt.a, B = wt.b, C = wt.c, D = wt.d, TX = wt.tx, TY = wt.ty;
    var bt = r.batcher, blend = this.worldBlend, wa = this.worldAlpha, wtint = this.worldTint, cull = r.cull, cr = r.cullRect;
    var cx0 = cr.x, cy0 = cr.y, cx1 = cr.x + cr.width, cy1 = cr.y + cr.height, round = this.roundPixels;
    var lastTex = null, src = null, tw = 0, th = 0, uvA = 0, uvB = 0;
    for (var i = 0; i < n; i++) {
      var p = ps[i];
      if (!p.visible || p.alpha <= 0) continue;
      var tex = p.texture;
      if (tex !== lastTex) { lastTex = tex; src = tex.source; tw = tex.width; th = tex.height; uvA = tex._uvA; uvB = tex._uvB; }
      if (p.rotation !== p._r) { p._r = p.rotation; p._cos = Math.cos(p.rotation); p._sin = Math.sin(p.rotation); }
      var co = p._cos, si = p._sin, sw = tw * p.scaleX, sh = th * p.scaleY;
      // ejes locales
      var lux = co * sw, luy = si * sw, lvx = -si * sh, lvy = co * sh;
      var lx = p.x - p.anchorX * lux - p.anchorY * lvx, ly = p.y - p.anchorX * luy - p.anchorY * lvy;
      var x = A * lx + C * ly + TX, y = B * lx + D * ly + TY;
      var ux = A * lux + C * luy, uy = B * lux + D * luy, vx = A * lvx + C * lvy, vy = B * lvx + D * lvy;
      if (round) { x = Math.round(x); y = Math.round(y); }
      if (cull) {
        var minX = x + (ux < 0 ? ux : 0) + (vx < 0 ? vx : 0), maxX = x + (ux > 0 ? ux : 0) + (vx > 0 ? vx : 0);
        var minY = y + (uy < 0 ? uy : 0) + (vy < 0 ? vy : 0), maxY = y + (uy > 0 ? uy : 0) + (vy > 0 ? vy : 0);
        if (maxX < cx0 || maxY < cy0 || minX > cx1 || minY > cy1) continue;
      }
      var a = p.alpha * wa;
      if (p.tint !== p._ct || a !== p._ca) { p._ct = p.tint; p._ca = a; p._c = packColor(wtint === 0xffffff ? p.tint : Color.multiply(p.tint, wtint), a); }
      if (bt.mode === 1 && blend === bt.blend && src._bTick === bt.tick && bt.instCount < bt.maxInst) {
        var o = bt.instCount * 10, f = bt.if32, w = bt.iu32;
        f[o] = x; f[o + 1] = y; f[o + 2] = ux; f[o + 3] = uy; f[o + 4] = vx; f[o + 5] = vy;
        w[o + 6] = uvA; w[o + 7] = uvB; w[o + 8] = p._c; f[o + 9] = src._bSlot;
        bt.instCount++; bt.quads++;
      } else {
        var uv = tex.uvs;
        bt.pushInstance(src, x, y, ux, uy, vx, vy, uv[0], uv[1], uv[4], uv[5], p._c, blend);
      }
    }
  }
  _renderCanvas(r) {
    var ps = this.particles, ctx = r.ctx, wt = this.worldTransform, m = _tmpMatrix;
    ctx.globalCompositeOperation = CANVAS_BLEND[this.worldBlend] || 'source-over';
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i]; if (!p.visible || p.alpha <= 0) continue;
      var tex = p.texture, co = Math.cos(p.rotation), si = Math.sin(p.rotation);
      var la = co * p.scaleX, lb = si * p.scaleX, lc = -si * p.scaleY, ld = co * p.scaleY;
      m.a = la * wt.a + lb * wt.c; m.b = la * wt.b + lb * wt.d; m.c = lc * wt.a + ld * wt.c; m.d = lc * wt.b + ld * wt.d;
      m.tx = p.x * wt.a + p.y * wt.c + wt.tx; m.ty = p.x * wt.b + p.y * wt.d + wt.ty;
      ctx.globalAlpha = p.alpha * this.worldAlpha;
      r._drawTex(tex, m, -p.anchorX * tex.width, -p.anchorY * tex.height, tex.width, tex.height, p.tint === 0xffffff ? this.worldTint : Color.multiply(p.tint, this.worldTint), false, false);
    }
  }
  _addSelfBounds(b) { var ps = this.particles; for (var i = 0; i < ps.length; i++) { var p = ps[i], t = p.texture; b.addRect(p.x - t.width * p.anchorX * p.scaleX, p.y - t.height * p.anchorY * p.scaleY, p.x + t.width * (1 - p.anchorX) * p.scaleX, p.y + t.height * (1 - p.anchorY) * p.scaleY, this.worldTransform); } }
  _onDestroy() { this.particles.length = 0; }
}

UG.ParticleEmitter = ParticleEmitter;
UG.Particle = Particle;
UG.ParticleContainer = ParticleContainer;
UG.Particles = ParticleEmitter;
