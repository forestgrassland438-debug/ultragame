/* UltraGame - UI de juego: botones, joystick virtual y botones táctiles para móviles, barra de progreso, panel. */

class Button extends Container {
  constructor(scene, x, y, options) {
    super(x, y);
    this.type = 'Button';
    options = options || {};
    this.scene = scene;
    this.opts = Object.assign({
      text: 'Botón', width: 0, height: 0, padding: 16, radius: 12, color: 0x3b5bdb, hoverColor: null, pressColor: null, disabledColor: 0x555566,
      strokeColor: 0xffffff, strokeAlpha: 0.25, strokeWidth: 2, textStyle: {}, sound: 'click', shadow: true
    }, options);
    this.enabled = true;
    this._state = 'normal';
    this.bg = new Graphics();
    this.label = new Text(0, 0, this.opts.text, Object.assign({ fontFamily: 'system-ui, Segoe UI, Arial, sans-serif', fontSize: 22, fontWeight: 'bold', fill: 0xffffff }, this.opts.textStyle));
    this.label.setOrigin(0.5);
    this.addChild(this.bg); this.addChild(this.label);
    this._layout();
    var self = this;
    this.setInteractive({ cursor: 'pointer' });
    this.on('pointerover', function () { if (self.enabled) self._setState('hover'); });
    this.on('pointerout', function () { if (self.enabled) self._setState('normal'); });
    this.on('pointerdown', function (p) { if (self.enabled && (p.type !== 'mouse' || p.button === 0)) { self._setState('press'); } });
    this.on('pointerupoutside', function () { if (self.enabled) self._setState('normal'); });
    this.on('pointercancel', function () { if (self.enabled) self._setState('normal'); });
    this.on('pointertap', function (p) {
      if (!self.enabled || (p.type === 'mouse' && p.button !== 0)) return;
      self._setState('hover');
      if (self.opts.sound && self.scene && self.scene.sound) self.scene.sound.playSfx(self.opts.sound, { volume: 0.6 });
      self.emit('click', self, p);
      if (self.opts.onClick) self.opts.onClick.call(self, self, p);
    });
  }
  _layout() {
    var o = this.opts, lw = this.label.width, lh = this.label.height;
    this.bw = o.width || Math.max(120, lw + o.padding * 2);
    this.bh = o.height || Math.max(44, lh + o.padding);
    this.hitArea = new Rectangle(-this.bw / 2, -this.bh / 2, this.bw, this.bh);
    this._draw();
  }
  _draw() {
    var o = this.opts, g = this.bg, w = this.bw, h = this.bh;
    var base = !this.enabled ? o.disabledColor : (this._state === 'press' ? (o.pressColor !== null ? o.pressColor : Color.brighten(o.color, -0.25)) : (this._state === 'hover' ? (o.hoverColor !== null ? o.hoverColor : Color.brighten(o.color, 0.15)) : o.color));
    g.clear();
    if (o.shadow) g.fillStyle(0x000000, 0.28).fillRoundedRect(-w / 2 + 2, -h / 2 + 4, w, h, o.radius);
    g.fillGradientStyle(Color.brighten(base, 0.18), Color.brighten(base, 0.18), Color.brighten(base, -0.12), Color.brighten(base, -0.12), 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, o.radius);
    if (o.strokeWidth > 0) g.lineStyle(o.strokeWidth, o.strokeColor, o.strokeAlpha).strokeRoundedRect(-w / 2 + o.strokeWidth / 2, -h / 2 + o.strokeWidth / 2, w - o.strokeWidth, h - o.strokeWidth, Math.max(0, o.radius - o.strokeWidth / 2));
    this.label.y = this._state === 'press' ? 2 : 0;
  }
  _setState(s) {
    if (s === this._state) return;
    this._state = s; this._draw();
    var sc = s === 'press' ? 0.96 : (s === 'hover' ? 1.04 : 1);
    if (this.scene && this.scene.tweens) { this.scene.tweens.killTweensOf(this); this.scene.tweens.add({ targets: this, scaleX: sc, scaleY: sc, duration: 110, ease: 'quadOut' }); }
    else { this.scaleX = this.scaleY = sc; }
  }
  setText(t) { this.label.text = t; this._layout(); return this; }
  setEnabled(v) { this.enabled = v !== false; this.cursor = this.enabled ? 'pointer' : 'default'; this._state = 'normal'; this._draw(); return this; }
  onClick(fn) { return this.on('click', fn); }
}

/** Joystick virtual para pantallas táctiles (también funciona con ratón). Se añade al HUD. */
class VirtualJoystick extends Container {
  constructor(scene, config) {
    config = config || {};
    super(config.x !== undefined ? config.x : 110, config.y !== undefined ? config.y : scene.game.height - 110);
    this.type = 'VirtualJoystick';
    this.scene = scene;
    this.radius = config.radius || 60;
    this.knobRadius = config.knobRadius || this.radius * 0.45;
    this.deadzone = config.deadzone !== undefined ? config.deadzone : 0.12;
    this.fixed = config.fixed !== false;
    this.zone = config.zone || null;
    this.mode = config.mode || '360';
    this.autoHide = !!config.autoHide;
    this.homeX = this.x; this.homeY = this.y;
    this.forceX = 0; this.forceY = 0; this.force = 0; this.angle = 0; this.isActive = false;
    this._pid = -1;
    var baseColor = config.baseColor !== undefined ? config.baseColor : 0xffffff, knobColor = config.knobColor !== undefined ? config.knobColor : 0xffffff;
    this.base = new Graphics().fillStyle(baseColor, 0.12).fillCircle(0, 0, this.radius).lineStyle(3, baseColor, 0.45).strokeCircle(0, 0, this.radius);
    this.knob = new Graphics().fillStyle(knobColor, 0.5).fillCircle(0, 0, this.knobRadius).lineStyle(2, knobColor, 0.9).strokeCircle(0, 0, this.knobRadius);
    this.addChild(this.base); this.addChild(this.knob);
    this.alpha = config.alpha !== undefined ? config.alpha : 0.9;
    if (this.autoHide) this.visible = false;
    var inp = scene.input, self = this; this._inp = inp; // referencia propia: destroy() anula this.scene antes de _onDestroy
    this._onDown = function (p) { self._down(p); };
    this._onMove = function (p) { self._move(p); };
    this._onUp = function (p) { self._up(p); };
    inp.on('pointerdown', this._onDown); inp.on('pointermove', this._onMove); inp.on('pointerup', this._onUp); inp.on('pointercancel', this._onUp);
    this.cursors = {
      up: { get isDown() { return self.forceY < -0.4; } }, down: { get isDown() { return self.forceY > 0.4; } },
      left: { get isDown() { return self.forceX < -0.4; } }, right: { get isDown() { return self.forceX > 0.4; } }
    };
  }
  get up() { return this.forceY < -0.4; }
  get down() { return this.forceY > 0.4; }
  get left() { return this.forceX < -0.4; }
  get right() { return this.forceX > 0.4; }
  createCursorKeys() { return this.cursors; }
  _inZone(x, y) {
    if (this.zone) return this.zone.contains(x, y);
    if (this.fixed) { var dx = x - this.homeX, dy = y - this.homeY; return dx * dx + dy * dy <= this.radius * this.radius * 2.2; }
    return x < this.scene.game.width / 2;
  }
  _down(p) {
    if (this._pid >= 0 || !this._inZone(p.x, p.y)) return;
    this._pid = p.id; this.isActive = true;
    if (!this.fixed) { this.x = p.x; this.y = p.y; }
    this.visible = true;
    this._move(p);
    this.emit('start', this);
  }
  _move(p) {
    if (p.id !== this._pid) return;
    var dx = p.x - this.x, dy = p.y - this.y, d = Math.sqrt(dx * dx + dy * dy), r = this.radius;
    if (d > r) { dx *= r / d; dy *= r / d; d = r; }
    var f = d / r;
    this.angle = Math.atan2(dy, dx);
    if (f < this.deadzone) { this.forceX = 0; this.forceY = 0; this.force = 0; }
    else {
      var nf = (f - this.deadzone) / (1 - this.deadzone);
      var a = this.angle;
      if (this.mode === '4dir') a = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
      else if (this.mode === '8dir') a = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
      this.forceX = Math.cos(a) * nf; this.forceY = Math.sin(a) * nf; this.force = nf;
    }
    this.knob.x = dx; this.knob.y = dy;
    this.emit('move', this);
  }
  _up(p) {
    if (p.id !== this._pid) return;
    this._pid = -1; this.isActive = false; this.forceX = this.forceY = this.force = 0;
    this.knob.x = 0; this.knob.y = 0;
    if (!this.fixed) { this.x = this.homeX; this.y = this.homeY; }
    if (this.autoHide) this.visible = false;
    this.emit('end', this);
  }
  _onDestroy() {
    var inp = this._inp; this._inp = null;
    if (inp) { inp.off('pointerdown', this._onDown); inp.off('pointermove', this._onMove); inp.off('pointerup', this._onUp); inp.off('pointercancel', this._onUp); }
  }
}

/** Botón táctil circular (A, B, disparo...). isDown y justDown por frame. */
class VirtualButton extends Container {
  constructor(scene, config) {
    config = config || {};
    super(config.x !== undefined ? config.x : scene.game.width - 90, config.y !== undefined ? config.y : scene.game.height - 100);
    this.type = 'VirtualButton';
    this.scene = scene;
    this.radius = config.radius || 42;
    this.isDown = false; this._downFrame = -1; this._upFrame = -1; this._pid = -1;
    var col = config.color !== undefined ? config.color : 0xff4d6d;
    this.g = new Graphics();
    this.addChild(this.g);
    this._col = col;
    this._draw(false);
    if (config.label) { var t = new Text(0, 0, config.label, { fontFamily: 'system-ui, Arial', fontSize: Math.round(this.radius * 0.7), fontWeight: 'bold', fill: 0xffffff }); t.setOrigin(0.5); this.addChild(t); }
    this.alpha = config.alpha !== undefined ? config.alpha : 0.85;
    var inp = scene.input, self = this; this._inp = inp;
    this._d = function (p) { var dx = p.x - self.x, dy = p.y - self.y; if (self._pid < 0 && dx * dx + dy * dy <= self.radius * self.radius * 1.4) { self._pid = p.id; self.isDown = true; self._downFrame = inp.frame; self._draw(true); self.emit('down', self); } };
    this._u = function (p) { if (p.id === self._pid) { self._pid = -1; self.isDown = false; self._upFrame = inp.frame; self._draw(false); self.emit('up', self); } };
    inp.on('pointerdown', this._d); inp.on('pointerup', this._u); inp.on('pointercancel', this._u);
  }
  get justDown() { return this._downFrame === this.scene.input.frame; }
  get justUp() { return this._upFrame === this.scene.input.frame; }
  _draw(pressed) {
    var g = this.g, r = this.radius, c = this._col;
    g.clear().fillStyle(c, pressed ? 0.75 : 0.4).fillCircle(0, 0, r).lineStyle(3, 0xffffff, pressed ? 0.95 : 0.6).strokeCircle(0, 0, r);
    this.scaleX = this.scaleY = pressed ? 0.92 : 1;
  }
  _onDestroy() { var inp = this._inp; this._inp = null; if (inp) { inp.off('pointerdown', this._d); inp.off('pointerup', this._u); inp.off('pointercancel', this._u); } }
}

/** Barra de progreso (también usada por el cargador por defecto). */
class ProgressBar extends Container {
  constructor(x, y, width, height, options) {
    super(x, y);
    this.type = 'ProgressBar';
    options = options || {};
    this.barWidth = width || 300; this.barHeight = height || 18;
    this.color = options.color !== undefined ? options.color : 0x4dabf7;
    this.color2 = options.color2 !== undefined ? options.color2 : 0x9775fa;
    this.bgColor = options.bgColor !== undefined ? options.bgColor : 0x1b1f2e;
    this.radius = options.radius !== undefined ? options.radius : this.barHeight / 2;
    this.g = new Graphics(); this.addChild(this.g);
    this._value = -1;
    this.value = options.value || 0;
  }
  get value() { return this._value; }
  set value(v) {
    v = clamp(v, 0, 1); if (v === this._value) return; this._value = v;
    var g = this.g, w = this.barWidth, h = this.barHeight, x = -w / 2, y = -h / 2;
    g.clear().fillStyle(this.bgColor, 1).fillRoundedRect(x, y, w, h, this.radius).lineStyle(2, 0xffffff, 0.15).strokeRoundedRect(x, y, w, h, this.radius);
    var fw = Math.max(0, (w - 6) * v);
    if (fw > 1) g.fillGradientStyle(this.color, this.color2, this.color, this.color2, 1).fillRoundedRect(x + 3, y + 3, fw, h - 6, Math.max(0, Math.min(this.radius - 3, fw / 2)));
  }
  setValue(v) { this.value = v; return this; }
}

/** Panel redondeado con título opcional (menús, diálogos). */
class Panel extends Container {
  constructor(x, y, width, height, options) {
    super(x, y);
    this.type = 'Panel';
    options = options || {};
    this.panelWidth = width; this.panelHeight = height;
    var g = new Graphics(), r = options.radius !== undefined ? options.radius : 18;
    g.fillStyle(0x000000, 0.35).fillRoundedRect(-width / 2 + 4, -height / 2 + 8, width, height, r);
    g.fillGradientStyle(options.color || 0x232a44, options.color || 0x232a44, options.color2 || 0x141829, options.color2 || 0x141829, options.alpha !== undefined ? options.alpha : 0.96);
    g.fillRoundedRect(-width / 2, -height / 2, width, height, r);
    g.lineStyle(2, options.borderColor || 0x7c8cff, 0.45).strokeRoundedRect(-width / 2 + 1, -height / 2 + 1, width - 2, height - 2, r - 1);
    this.addChild(g); this.bg = g;
    if (options.title) {
      this.title = new Text(0, -height / 2 + 34, options.title, Object.assign({ fontFamily: 'system-ui, Segoe UI, Arial', fontSize: 30, fontWeight: 'bold', fill: [0xffffff, 0xb4c0ff] }, options.titleStyle || {}));
      this.title.setOrigin(0.5); this.addChild(this.title);
    }
  }
}

UG.Button = Button;
UG.VirtualJoystick = VirtualJoystick;
UG.VirtualButton = VirtualButton;
UG.ProgressBar = ProgressBar;
UG.Panel = Panel;
