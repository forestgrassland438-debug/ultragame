/* UltraGame - entrada: teclado, puntero (ratón/táctil/lápiz, multitouch), arrastre, hover, rueda y gamepad.
 * Los eventos del DOM se procesan inmediatamente (menor latencia y permite desbloquear audio / fullscreen
 * dentro del gesto del usuario). Todos los listeners se registran en un DOMListeners y se eliminan al destruir. */

var KEY_ALIASES = {
  LEFT: ['ArrowLeft'], RIGHT: ['ArrowRight'], UP: ['ArrowUp'], DOWN: ['ArrowDown'], SPACE: ['Space'], ENTER: ['Enter', 'NumpadEnter'],
  ESC: ['Escape'], ESCAPE: ['Escape'], SHIFT: ['ShiftLeft', 'ShiftRight'], CTRL: ['ControlLeft', 'ControlRight'], CONTROL: ['ControlLeft', 'ControlRight'],
  ALT: ['AltLeft', 'AltRight'], META: ['MetaLeft', 'MetaRight'], TAB: ['Tab'], BACKSPACE: ['Backspace'], DELETE: ['Delete'], INSERT: ['Insert'],
  HOME: ['Home'], END: ['End'], PAGEUP: ['PageUp'], PAGEDOWN: ['PageDown'], CAPSLOCK: ['CapsLock'], PLUS: ['Equal', 'NumpadAdd'], MINUS: ['Minus', 'NumpadSubtract'],
  COMMA: ['Comma'], PERIOD: ['Period'], SLASH: ['Slash'], BACKSLASH: ['Backslash'], SEMICOLON: ['Semicolon'], QUOTE: ['Quote'], BACKQUOTE: ['Backquote'],
  OPEN_BRACKET: ['BracketLeft'], CLOSE_BRACKET: ['BracketRight'],
  ZERO: ['Digit0', 'Numpad0'], ONE: ['Digit1', 'Numpad1'], TWO: ['Digit2', 'Numpad2'], THREE: ['Digit3', 'Numpad3'], FOUR: ['Digit4', 'Numpad4'],
  FIVE: ['Digit5', 'Numpad5'], SIX: ['Digit6', 'Numpad6'], SEVEN: ['Digit7', 'Numpad7'], EIGHT: ['Digit8', 'Numpad8'], NINE: ['Digit9', 'Numpad9']
};
var CODE_TO_NAME = (function () {
  var m = {};
  Object.keys(KEY_ALIASES).forEach(function (k) { KEY_ALIASES[k].forEach(function (c) { if (!m[c]) m[c] = k; }); });
  m.Escape = 'ESC'; m.ControlLeft = 'CTRL'; m.ControlRight = 'CTRL';
  return m;
})();
function resolveKeyCodes(name) {
  if (Array.isArray(name)) return name;
  var s = String(name).trim();
  var up = s.toUpperCase();
  if (KEY_ALIASES[up]) return KEY_ALIASES[up];
  if (/^[A-Z]$/.test(up)) return ['Key' + up];
  if (/^[0-9]$/.test(s)) return ['Digit' + s, 'Numpad' + s];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(up)) return [up];
  return [s];
}
function codeName(code) {
  if (CODE_TO_NAME[code]) return CODE_TO_NAME[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return code.toUpperCase();
}
function isEditableTarget(t) {
  if (!t || !t.tagName) return false;
  var tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
}
// DOM button and buttons use different orders for the middle/right buttons.
function pointerButtonMask(button) { return button === 0 ? 1 : button === 1 ? 4 : button === 2 ? 2 : button >= 3 && button <= 4 ? 1 << button : 0; }

/* ========================================================== KeyboardManager */
class KeyboardManager extends EventEmitter {
  constructor(input, config) {
    super();
    config = config || {};
    this.input = input;
    this.enabled = config.enabled !== false;
    this.keys = new Map();
    this._pending = [];
    this.capture = new Set(config.capture || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);
    this.target = config.target || (typeof window !== 'undefined' ? window : null);
  }
  _state(code) {
    var k = this.keys.get(code);
    if (!k) { k = { code: code, isDown: false, downFrame: -1, upFrame: -1, timeDown: 0, timeUp: 0, repeats: 0, _pd: false, _pu: false }; this.keys.set(code, k); }
    return k;
  }
  boot(dom) {
    if (!this.target) return;
    var self = this;
    dom.add(this.target, 'keydown', function (e) { self._onDown(e); }, false);
    dom.add(this.target, 'keyup', function (e) { self._onUp(e); }, false);
    if (typeof window !== 'undefined') dom.add(window, 'blur', function () { self.releaseAll(); }, false);
    if (typeof document !== 'undefined') dom.add(document, 'visibilitychange', function () { if (document.hidden) self.releaseAll(); }, false);
  }
  _onDown(e) {
    if (!this.enabled || !this.input.enabled) return;
    if (isEditableTarget(e.target)) return;
    var code = e.code || e.key; if (!code) return;
    var k = this._state(code);
    if (this.capture.has(code) && this.input.game.isVisibleOnPage()) e.preventDefault();
    if (k.isDown) { k.repeats++; this.input._dispatchKey('keyrepeat', k, e); return; }
    k.isDown = true; k._pd = true; k.timeDown = nowTime(); k.repeats = 0;
    this._pending.push(k);
    this.input._dispatchKey('keydown', k, e);
  }
  _onUp(e) {
    var code = e.code || e.key; if (!code) return;
    var k = this._state(code);
    if (this.capture.has(code) && !isEditableTarget(e.target) && this.input.game.isVisibleOnPage()) e.preventDefault();
    if (!k.isDown) return;
    k.isDown = false; k._pu = true; k.timeUp = nowTime();
    this._pending.push(k);
    this.input._dispatchKey('keyup', k, e);
  }
  releaseAll() {
    var self = this;
    this.keys.forEach(function (k) { if (k.isDown) { k.isDown = false; k._pu = true; k.timeUp = nowTime(); self._pending.push(k); self.input._dispatchKey('keyup', k, null); } });
  }
  preUpdate(frame) {
    var p = this._pending;
    for (var i = 0; i < p.length; i++) {
      var k = p[i];
      if (k._pd) { k.downFrame = frame; k._pd = false; }
      if (k._pu) { k.upFrame = frame; k._pu = false; }
    }
    p.length = 0;
  }
  isDown(name) { var c = resolveKeyCodes(name); for (var i = 0; i < c.length; i++) { var k = this.keys.get(c[i]); if (k && k.isDown) return true; } return false; }
  justPressed(name) { var f = this.input.frame, c = resolveKeyCodes(name); for (var i = 0; i < c.length; i++) { var k = this.keys.get(c[i]); if (k && k.downFrame === f) return true; } return false; }
  justReleased(name) { var f = this.input.frame, c = resolveKeyCodes(name); for (var i = 0; i < c.length; i++) { var k = this.keys.get(c[i]); if (k && k.upFrame === f) return true; } return false; }
  anyDown() { var any = false; this.keys.forEach(function (k) { if (k.isDown) any = true; }); return any; }
  addCapture(names) { var self = this; (Array.isArray(names) ? names : String(names).split(',')).forEach(function (n) { resolveKeyCodes(n).forEach(function (c) { self.capture.add(c); }); }); }
  removeCapture(names) { var self = this; (Array.isArray(names) ? names : String(names).split(',')).forEach(function (n) { resolveKeyCodes(n).forEach(function (c) { self.capture.delete(c); }); }); }
  clearCaptures() { this.capture.clear(); }
}

/** Tecla observable (this.input.keyboard.addKey('SPACE')) */
class Key {
  constructor(keyboard, name) { this._kb = keyboard; this.name = String(name); this.codes = resolveKeyCodes(name); this.enabled = true; }
  _k() { for (var i = 0; i < this.codes.length; i++) { var k = this._kb.keys.get(this.codes[i]); if (k && k.isDown) return k; } return this._kb.keys.get(this.codes[0]); }
  get isDown() { return this.enabled && this._kb.isDown(this.codes); }
  get isUp() { return !this.isDown; }
  get justDown() { return this.enabled && this._kb.justPressed(this.codes); }
  get justUp() { return this.enabled && this._kb.justReleased(this.codes); }
  get duration() { var k = this._k(); return k && k.isDown ? nowTime() - k.timeDown : 0; }
  get repeats() { var k = this._k(); return k ? k.repeats : 0; }
}

/* ================================================================== Pointer */
class Pointer {
  constructor(id) {
    this.id = id;
    this.pointerId = -1;
    this.type = 'mouse';
    this.x = -1; this.y = -1; this.prevX = -1; this.prevY = -1;
    this.worldX = -1; this.worldY = -1;
    this.downX = 0; this.downY = 0; this.upX = 0; this.upY = 0;
    this.downTime = 0; this.upTime = 0; this.moveTime = 0;
    this.isDown = false; this.button = 0; this.buttons = 0;
    this.active = id === 0;
    this.inside = false;
    this.pressure = 0;
    this.velocityX = 0; this.velocityY = 0;
    this.deltaX = 0; this.deltaY = 0; this.deltaZ = 0;
    this.downFrame = -1; this.upFrame = -1;
    this.event = null;
    this._over = null;
    this._down = null;
    this._downButton = 0;
    this._drag = null;
    this.primary = false;
  }
  get leftButtonDown() { return (this.buttons & 1) === 1; }
  get rightButtonDown() { return (this.buttons & 2) === 2; }
  get middleButtonDown() { return (this.buttons & 4) === 4; }
  get isDragging() { return !!(this._drag && this._drag.started); }
  get distance() { var dx = this.x - this.downX, dy = this.y - this.downY; return Math.sqrt(dx * dx + dy * dy); }
  get duration() { return this.isDown ? nowTime() - this.downTime : this.upTime - this.downTime; }
  justDown(frame) { return this.downFrame === frame; }
  justUp(frame) { return this.upFrame === frame; }
  /** Posición en mundo según una cámara */
  positionToCamera(camera, out) { out = out || new Vec2(); return camera.getWorldPoint(this.x, this.y, out); }
  getAngle() { return Math.atan2(this.y - this.downY, this.x - this.downX); }
  reset() { this.isDown = false; this.buttons = 0; this.pressure = 0; this._drag = null; this._down = null; this._over = null; this.active = this.id === 0; this.pointerId = -1; this.downFrame = this.upFrame = -1; }
}

/* ================================================================== Gamepad */
var PAD_BUTTONS = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, L1: 4, R1: 5, LT: 6, RT: 7, L2: 6, R2: 7, SELECT: 8, BACK: 8, START: 9, LS: 10, RS: 11, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16 };
class GamepadPad {
  constructor(manager, index) {
    this.manager = manager; this.index = index; this.id = ''; this.connected = false; this.raw = null;
    this.axes = new Float32Array(8); this.buttons = [];
    for (var i = 0; i < 20; i++) this.buttons.push({ value: 0, pressed: false, downFrame: -1, upFrame: -1 });
    this.deadzone = 0.15;
    this.leftStick = new Vec2(); this.rightStick = new Vec2();
  }
  _update(raw, frame) {
    if (!raw || !raw.connected) {
      this.axes.fill(0); this.leftStick.set(0, 0); this.rightStick.set(0, 0);
      for (var i = 0; i < this.buttons.length; i++) {
        var released = this.buttons[i];
        if (released.pressed) { released.upFrame = frame; this.manager.emit('up', this, i, 0); }
        released.value = 0; released.pressed = false;
      }
      if (this.connected) { this.connected = false; this.raw = null; this.manager.emit('disconnected', this); }
      return;
    }
    if (!this.connected) { this.connected = true; this.id = raw.id; this.manager.emit('connected', this); }
    this.raw = raw;
    for (var a = 0; a < Math.min(8, raw.axes.length); a++) { var v = raw.axes[a]; this.axes[a] = Math.abs(v) < this.deadzone ? 0 : v; }
    this.leftStick.set(this.axes[0], this.axes[1]); this.rightStick.set(this.axes[2], this.axes[3]);
    for (var b = 0; b < Math.min(20, raw.buttons.length); b++) {
      var rb = raw.buttons[b], st = this.buttons[b], pressed = typeof rb === 'object' ? rb.pressed : rb === 1;
      st.value = typeof rb === 'object' ? rb.value : rb;
      if (pressed && !st.pressed) { st.downFrame = frame; this.manager.emit('down', this, b, st.value); }
      else if (!pressed && st.pressed) { st.upFrame = frame; this.manager.emit('up', this, b, st.value); }
      st.pressed = pressed;
    }
  }
  _idx(b) { return typeof b === 'number' ? b : (PAD_BUTTONS[String(b).toUpperCase()] !== undefined ? PAD_BUTTONS[String(b).toUpperCase()] : -1); }
  isDown(b) { var i = this._idx(b); return i >= 0 && this.buttons[i] ? this.buttons[i].pressed : false; }
  justDown(b) { var i = this._idx(b); return i >= 0 && this.buttons[i] ? this.buttons[i].downFrame === this.manager.input.frame : false; }
  justUp(b) { var i = this._idx(b); return i >= 0 && this.buttons[i] ? this.buttons[i].upFrame === this.manager.input.frame : false; }
  value(b) { var i = this._idx(b); return i >= 0 && this.buttons[i] ? this.buttons[i].value : 0; }
  get A() { return this.isDown(0); } get B() { return this.isDown(1); } get X() { return this.isDown(2); } get Y() { return this.isDown(3); }
  get up() { return this.isDown(12) || this.axes[1] < -0.5; } get down() { return this.isDown(13) || this.axes[1] > 0.5; }
  get left() { return this.isDown(14) || this.axes[0] < -0.5; } get right() { return this.isDown(15) || this.axes[0] > 0.5; }
  vibrate(duration, strong, weak) {
    var act = this.raw && this.raw.vibrationActuator;
    if (act && act.playEffect) { try { act.playEffect('dual-rumble', { duration: duration || 200, strongMagnitude: strong === undefined ? 0.8 : strong, weakMagnitude: weak === undefined ? 0.4 : weak }); } catch (e) { /* ignorar */ } }
  }
}
class GamepadManager extends EventEmitter {
  constructor(input) {
    super();
    this.input = input; this.enabled = true;
    this.pads = [new GamepadPad(this, 0), new GamepadPad(this, 1), new GamepadPad(this, 2), new GamepadPad(this, 3)];
    this._any = false;
  }
  boot(dom) {
    var self = this;
    if (typeof window === 'undefined') return;
    this._any = true; // also discover controllers connected before the game booted
    dom.add(window, 'gamepadconnected', function () { self._any = true; }, false);
    dom.add(window, 'gamepaddisconnected', function () { self._any = true; }, false);
  }
  update(frame) {
    if (!this.enabled || !this._any || typeof navigator === 'undefined' || !navigator.getGamepads) return;
    var list;
    try { list = navigator.getGamepads(); } catch (e) { return; }
    var anyConnected = false;
    for (var i = 0; i < 4; i++) { var raw = list[i] || null; this.pads[i]._update(raw, frame); if (raw && raw.connected) anyConnected = true; }
    if (!anyConnected) { var stillAny = false; for (var j = 0; j < 4; j++) if (this.pads[j].connected) stillAny = true; this._any = stillAny; }
  }
  get pad1() { return this.pads[0]; } get pad2() { return this.pads[1]; } get pad3() { return this.pads[2]; } get pad4() { return this.pads[3]; }
  get total() { var n = 0; for (var i = 0; i < 4; i++) if (this.pads[i].connected) n++; return n; }
  getPad(i) { return this.pads[i] || null; }
}

/* ============================================================= InputManager */
var _interactiveCount = { n: 0 };
(function patchInteractiveCounting() {
  var origSet = Container.prototype.setInteractive, origRemove = Container.prototype.removeInteractive, origDisable = Container.prototype.disableInteractive, origDestroy = Container.prototype.destroy;
  Container.prototype.setInteractive = function (o) { if (!this.interactive) _interactiveCount.n++; return origSet.call(this, o); };
  Container.prototype.removeInteractive = function () { if (this.interactive) _interactiveCount.n--; return origRemove.call(this); };
  Container.prototype.disableInteractive = function () { if (this.interactive) _interactiveCount.n--; return origDisable.call(this); };
  Container.prototype.destroy = function (o) { if (!this.destroyed && this.interactive) _interactiveCount.n--; return origDestroy.call(this, o); };
})();

class InputManager extends EventEmitter {
  constructor(game, config) {
    super();
    config = config || {};
    this.game = game;
    this.config = config;
    this.enabled = config.enabled !== false;
    this.dom = new DOMListeners();
    this.frame = 0;
    this.keyboard = new KeyboardManager(this, config.keyboard);
    this.gamepad = new GamepadManager(this);
    this.maxPointers = clamp(config.maxPointers || 10, 1, 20);
    this.pointers = [];
    for (var i = 0; i < this.maxPointers + 1; i++) this.pointers.push(new Pointer(i));
    this.mousePointer = this.pointers[0];
    this.activePointer = this.pointers[0];
    this.dragThreshold = config.dragDistanceThreshold !== undefined ? config.dragDistanceThreshold : 3;
    this.disableContextMenu = config.disableContextMenu !== false;
    this.wheelPreventDefault = config.wheelPreventDefault !== false;
    this._tmpV = new Vec2();
    this._hoverTick = 0;
    this.defaultCursor = 'default';
    this._cursor = '';
    this._pointerLocked = false;
  }
  boot(canvas) {
    this.canvas = canvas;
    var self = this, dom = this.dom;
    canvas.style.touchAction = 'none';
    canvas.style.userSelect = 'none'; canvas.style.webkitUserSelect = 'none';
    canvas.style.webkitTapHighlightColor = 'rgba(0,0,0,0)';
    canvas.style.outline = 'none';
    this.keyboard.boot(dom);
    this.gamepad.boot(dom);
    var hasPE = typeof window !== 'undefined' && 'PointerEvent' in window;
    if (hasPE) {
      // Pointer Events only emit down/up for the first/last mouse button. Mouse
      // events below provide each button transition, including aim + fire.
      dom.add(canvas, 'pointerdown', function (e) { if (e.pointerType && e.pointerType !== 'mouse') self._onDown(e, e.pointerId, e.pointerType, e.clientX, e.clientY, e.button, e.buttons); }, false);
      dom.add(window, 'pointermove', function (e) { self._onMove(e, e.pointerId, e.pointerType || 'mouse', e.clientX, e.clientY, e.buttons); }, { passive: true });
      dom.add(window, 'pointerup', function (e) { if (e.pointerType && e.pointerType !== 'mouse') self._onUp(e, e.pointerId, e.pointerType, e.clientX, e.clientY, e.button, e.buttons); }, false);
      dom.add(window, 'pointercancel', function (e) { self._onUp(e, e.pointerId, e.pointerType || 'mouse', e.clientX, e.clientY, 0, 0, true); }, false);
      dom.add(canvas, 'lostpointercapture', function (e) { if (e.pointerType && e.pointerType !== 'mouse') self._onUp(e, e.pointerId, e.pointerType, undefined, undefined, 0, 0, true); }, false);
      dom.add(canvas, 'pointerleave', function (e) { if (e.pointerType === 'mouse') { self.mousePointer.inside = false; self._dispatch('pointerout', self.mousePointer); } }, false);
      dom.add(canvas, 'pointerenter', function (e) { if (e.pointerType === 'mouse') self.mousePointer.inside = true; }, false);
    } else {
      dom.add(window, 'mousemove', function (e) { self._onMove(e, 1, 'mouse', e.clientX, e.clientY, e.buttons); }, false);
      var touch = function (fn) {
        return function (e) {
          if (e.cancelable) e.preventDefault();
          for (var i = 0; i < e.changedTouches.length; i++) { var t = e.changedTouches[i]; fn(e, t.identifier + 1000, t.clientX, t.clientY); }
        };
      };
      dom.add(canvas, 'touchstart', touch(function (e, id, x, y) { self._onDown(e, id, 'touch', x, y, 0, 1); }), { passive: false });
      dom.add(canvas, 'touchmove', touch(function (e, id, x, y) { self._onMove(e, id, 'touch', x, y, 1); }), { passive: false });
      dom.add(canvas, 'touchend', touch(function (e, id, x, y) { self._onUp(e, id, 'touch', x, y, 0, 0); }), { passive: false });
      dom.add(canvas, 'touchcancel', touch(function (e, id, x, y) { self._onUp(e, id, 'touch', x, y, 0, 0, true); }), { passive: false });
    }
    dom.add(canvas, 'mousedown', function (e) { if (!(e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents)) self._onDown(e, 1, 'mouse', e.clientX, e.clientY, e.button, e.buttons); }, false);
    dom.add(window, 'mouseup', function (e) { if (!(e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents)) self._onUp(e, 1, 'mouse', e.clientX, e.clientY, e.button, e.buttons); }, false);
    if (typeof window !== 'undefined') dom.add(window, 'blur', function () { self.releaseAll(); }, false);
    if (typeof document !== 'undefined') {
      dom.add(document, 'visibilitychange', function () { if (document.hidden) self.releaseAll(); }, false);
      dom.add(document, 'pointerlockchange', function () {
        var locked = document.pointerLockElement === canvas, wasLocked = self._pointerLocked;
        self._pointerLocked = locked;
        if (wasLocked && !locked) self.releaseAll();
        if (locked) self._dispatch('pointerout', self.mousePointer, null);
      }, false);
    }
    dom.add(canvas, 'wheel', function (e) {
      var p = self.mousePointer;
      p.deltaX = e.deltaX; p.deltaY = e.deltaY; p.deltaZ = e.deltaZ;
      self._toGame(e.clientX, e.clientY, p);
      if (self.wheelPreventDefault && e.cancelable) e.preventDefault();
      self._dispatch('wheel', p, e);
    }, { passive: false });
    dom.add(canvas, 'contextmenu', function (e) { if (self.enabled && self.disableContextMenu) e.preventDefault(); }, false);
  }
  _toGame(cx, cy, p) {
    var rect = this.canvas.getBoundingClientRect();
    var sx = rect.width > 0 ? this.game.width / rect.width : 1, sy = rect.height > 0 ? this.game.height / rect.height : 1;
    p.prevX = p.x; p.prevY = p.y;
    p.x = (cx - rect.left) * sx; p.y = (cy - rect.top) * sy;
    var inside = cx >= rect.left && cx < rect.right && cy >= rect.top && cy < rect.bottom;
    return inside;
  }
  _pointerFor(pointerId, type, create) {
    if (type === 'mouse') return this.mousePointer;
    for (var i = 1; i < this.pointers.length; i++) if (this.pointers[i].active && this.pointers[i].pointerId === pointerId) return this.pointers[i];
    if (!create) return null;
    for (var j = 1; j < this.pointers.length; j++) {
      var p = this.pointers[j];
      if (!p.active) { p.reset(); p.active = true; p.pointerId = pointerId; p.type = type; return p; }
    }
    return null;
  }
  _onDown(e, pid, type, cx, cy, button, buttons) {
    if (!this.enabled) return;
    var p = this._pointerFor(pid, type, true); if (!p) return;
    this.game.sound && this.game.sound.unlock && this.game.sound.unlock();
    p.type = type; p.pointerId = pid; p.event = e;
    this._toGame(cx, cy, p); p.inside = true;
    var wasDown = p.isDown;
    p.isDown = true; p.button = button || 0; p.buttons = buttons === undefined ? p.buttons | pointerButtonMask(p.button) : buttons;
    if (!wasDown) { p.downX = p.x; p.downY = p.y; p.downTime = nowTime(); }
    p.downFrame = this.frame + 1;
    p.pressure = e && e.pressure !== undefined ? e.pressure : 0.5;
    p.primary = type === 'mouse' || !!(e && e.isPrimary);
    this.activePointer = p;
    if (e && e.pointerId !== undefined && this.canvas.setPointerCapture && type !== 'mouse') { try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignorar */ } }
    if (type !== 'mouse' && e && e.cancelable) e.preventDefault();
    if (this.canvas.focus && type === 'mouse') { try { this.canvas.focus({ preventScroll: true }); } catch (err2) { /* ignorar */ } }
    this._dispatch('pointerdown', p, e);
  }
  _onMove(e, pid, type, cx, cy, buttons) {
    if (!this.enabled) return;
    var p = this._pointerFor(pid, type, false); if (!p) return;
    var now = nowTime(), dt = Math.max(1, now - p.moveTime);
    var ox = p.x, oy = p.y;
    var inside = this._toGame(cx, cy, p);
    if (type === 'mouse') p.inside = inside;
    p.velocityX = (p.x - ox) / dt * 1000; p.velocityY = (p.y - oy) / dt * 1000; p.moveTime = now;
    // A press that began outside the canvas does not become game input on hover.
    if (buttons !== undefined && p.isDown) p.buttons = buttons;
    p.event = e;
    if (!p.isDown && type !== 'mouse') return;
    if (!inside && !p.isDown && !p._over) return;
    this.activePointer = p;
    this._dispatch('pointermove', p, e);
  }
  _onUp(e, pid, type, cx, cy, button, buttons, cancelled) {
    var p = this._pointerFor(pid, type, false); if (!p || !p.isDown) return;
    if (cx !== undefined && cy !== undefined) this._toGame(cx, cy, p);
    p.button = button || 0;
    p.buttons = cancelled ? 0 : buttons === undefined ? p.buttons & ~pointerButtonMask(p.button) : buttons;
    p.isDown = p.buttons !== 0; p.pressure = p.isDown ? p.pressure : 0;
    p.upX = p.x; p.upY = p.y; p.upTime = nowTime(); p.upFrame = this.frame + 1;
    p.event = e;
    this._dispatch(cancelled ? 'pointercancel' : 'pointerup', p, e);
    if (type !== 'mouse') { this._dispatch('pointerout', p, e); p.active = false; p._over = null; }
  }
  /** Cancela gestos activos sin convertir la pérdida de foco en un clic. */
  releaseAll() {
    this.keyboard.releaseAll();
    for (var i = 0; i < this.pointers.length; i++) {
      var p = this.pointers[i];
      if (p.isDown) this._onUp(null, p.pointerId, p.type, undefined, undefined, 0, 0, true);
    }
  }
  _dispatchKey(type, k, e) {
    var scenes = this.game.scene ? this.game.scene.getInputScenes() : [];
    var name = codeName(k.code);
    for (var i = 0; i < scenes.length; i++) {
      var kb = scenes[i].input && scenes[i].input.keyboard;
      if (!kb || !kb.enabled) continue;
      kb.emit(type, e, k.code, name);
      kb.emit(type + '-' + name, e);
      if (name !== k.code) kb.emit(type + '-' + k.code, e);
    }
    this.emit(type, e, k.code, name);
  }
  _dispatch(type, p, e) {
    var scenes = this.game.scene ? this.game.scene.getInputScenes() : [];
    var consumed = false;
    for (var i = 0; i < scenes.length; i++) {
      var ip = scenes[i].input;
      if (!ip || !ip.enabled) continue;
      if (ip._handle(type, p, e, consumed)) consumed = true;
    }
    this.emit(type, p, e);
  }
  preUpdate() {
    this.frame++;
    this.keyboard.preUpdate(this.frame);
    this.gamepad.update(this.frame);
    // re-evaluar hover cada pocos frames (objetos que se mueven bajo el cursor)
    if (_interactiveCount.n > 0 && this.mousePointer.inside && ++this._hoverTick % 4 === 0) this._dispatch('hover', this.mousePointer, null);
  }
  setCursor(c) {
    var v = (c && /^[a-z-]+$/.test(c)) ? c : this.defaultCursor;
    if (v !== this._cursor && this.canvas) { this.canvas.style.cursor = v; this._cursor = v; }
  }
  /** Vibración del dispositivo (móviles compatibles) */
  vibrate(pattern) { if (typeof navigator !== 'undefined' && navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) { /* ignorar */ } } }
  destroy() {
    this.dom.removeAll();
    this.off(); this.keyboard.off(); this.gamepad.off();
    this.keyboard.keys.clear();
    for (var i = 0; i < this.pointers.length; i++) this.pointers[i].reset();
    this.canvas = null; this.game = null;
  }
}

/* ============================================================== InputPlugin
 * this.input dentro de una escena. Los listeners se eliminan automáticamente al cerrar la escena. */
var _hitMats = [];
function hitMat(depth) { var m = _hitMats[depth]; if (!m) { m = new Matrix(); _hitMats[depth] = m; } return m; }
var _hitLocal = new Matrix();

class SceneKeyboard extends EventEmitter {
  constructor(plugin) { super(); this.plugin = plugin; this.enabled = true; this._keys = []; }
  get manager() { return this.plugin.manager.keyboard; }
  addKey(name) { var k = new Key(this.manager, name); this._keys.push(k); return k; }
  addKeys(spec) {
    var out = {}, self = this;
    if (typeof spec === 'string') spec.split(',').forEach(function (n) { n = n.trim(); if (n && !isForbiddenKey(n)) out[n] = self.addKey(n); });
    else Object.keys(spec).forEach(function (k) { if (!isForbiddenKey(k)) out[k] = self.addKey(spec[k]); });
    return out;
  }
  createCursorKeys() { return { up: this.addKey('UP'), down: this.addKey('DOWN'), left: this.addKey('LEFT'), right: this.addKey('RIGHT'), space: this.addKey('SPACE'), shift: this.addKey('SHIFT') }; }
  /** WASD + flechas combinadas: {up, down, left, right} */
  createWASD() { return { up: this.addKey(['KeyW', 'ArrowUp']), down: this.addKey(['KeyS', 'ArrowDown']), left: this.addKey(['KeyA', 'ArrowLeft']), right: this.addKey(['KeyD', 'ArrowRight']) }; }
  isDown(n) { return this.enabled && this.manager.isDown(n); }
  justPressed(n) { return this.enabled && this.manager.justPressed(n); }
  justReleased(n) { return this.enabled && this.manager.justReleased(n); }
  anyDown() { return this.enabled && this.manager.anyDown(); }
  addCapture(n) { this.manager.addCapture(n); return this; }
  removeCapture(n) { this.manager.removeCapture(n); return this; }
  shutdown() { this.off(); this._keys.length = 0; }
}

class InputPlugin extends EventEmitter {
  constructor(scene) {
    super();
    this.scene = scene;
    this.manager = scene.game.input;
    this.enabled = true;
    this.topOnly = true;
    this.keyboard = new SceneKeyboard(this);
    this.dragThreshold = null;
  }
  get gamepad() { return this.manager.gamepad; }
  get activePointer() { return this.manager.activePointer; }
  get mousePointer() { return this.manager.mousePointer; }
  get pointers() { return this.manager.pointers; }
  get pointer1() { return this.manager.pointers[1]; }
  get pointer2() { return this.manager.pointers[2]; }
  get x() { return this.manager.activePointer.x; }
  get y() { return this.manager.activePointer.y; }
  get worldX() { var c = this.scene.cameras.main; return c ? c.getWorldPoint(this.x, this.y, _tmpVec).x : this.x; }
  get worldY() { var c = this.scene.cameras.main; return c ? c.getWorldPoint(this.x, this.y, _tmpVec).y : this.y; }
  get frame() { return this.manager.frame; }
  isDown() { var ps = this.manager.pointers; for (var i = 0; i < ps.length; i++) if (ps[i].isDown) return true; return false; }
  justDown() { var ps = this.manager.pointers, f = this.manager.frame; for (var i = 0; i < ps.length; i++) if (ps[i].downFrame === f) return true; return false; }
  justUp() { var ps = this.manager.pointers, f = this.manager.frame; for (var i = 0; i < ps.length; i++) if (ps[i].upFrame === f) return true; return false; }
  setTopOnly(v) { this.topOnly = v !== false; return this; }
  setDraggable(objs, value) { (Array.isArray(objs) ? objs : [objs]).forEach(function (o) { if (!o.interactive) o.setInteractive(); o.draggable = value !== false; }); return this; }
  setDefaultCursor(c) { this.manager.defaultCursor = c; this.manager.setCursor(c); return this; }
  setPollAlways() { return this; }
  vibrate(p) { this.manager.vibrate(p); return this; }

  /** Lista de objetos bajo el puntero (del más cercano al fondo). */
  hitTestPointer(p, all) {
    var out = [];
    // Pointer lock freezes client coordinates. They must not activate old HUD
    // buttons underneath that invisible cursor while the player aims/shoots.
    if (p.type === 'mouse' && typeof document !== 'undefined' && document.pointerLockElement === this.manager.canvas) return out;
    if (_interactiveCount.n <= 0) return out;
    var scene = this.scene, cam = scene.cameras ? scene.cameras.main : null;
    var topOnly = this.topOnly && !all;
    var root = hitMat(0).identity();
    if (scene.hud) this._hit(scene.hud, root, 0, 0, p.x, p.y, out, topOnly, 1);
    if (topOnly && out.length) return out;
    if (cam) {
      if (!cam.containsPoint(p.x, p.y)) return out;
      cam.preRender();
      root.copyFrom(cam.matrix);
      this._hit(scene.world, root, cam.scrollX, cam.scrollY, p.x, p.y, out, topOnly, 1);
    } else this._hit(scene.world, root, 0, 0, p.x, p.y, out, topOnly, 1);
    return out;
  }
  _hit(obj, parentM, csx, csy, px, py, out, topOnly, depth) {
    if (!obj.visible || obj._isMask || obj.destroyed) return;
    var m = hitMat(depth);
    obj.getLocalMatrix(_hitLocal, csx, csy);
    m.copyFrom(parentM).append(_hitLocal);
    if (obj.clipRect) { var cl = m.applyInverse(px, py, _tmpVec); if (!obj.clipRect.contains(cl.x, cl.y)) return; }
    var ch = obj.children;
    if (ch.length) {
      if (obj.sortableChildren && obj._sortDirty) obj.sortChildren();
      for (var i = ch.length - 1; i >= 0; i--) {
        this._hit(ch[i], m, csx, csy, px, py, out, topOnly, depth + 1);
        if (topOnly && out.length) return;
        m = hitMat(depth);
      }
    }
    if (obj.interactive && obj.active !== false) {
      var l = m.applyInverse(px, py, new Vec2());
      if (obj.hitTestLocal(l.x, l.y)) out.push({ object: obj, localX: l.x, localY: l.y });
    }
  }
  /** Coordenadas del puntero en el espacio local del padre de obj (para arrastre). */
  _parentLocal(obj, p, out) {
    var scene = this.scene, cam = scene.cameras ? scene.cameras.main : null;
    var inHud = false; for (var q = obj; q; q = q.parent) if (q === scene.hud) inHud = true;
    var m = new Matrix();
    if (!inHud && cam) { cam.preRender(); m.copyFrom(cam.matrix); }
    if (obj.parent) m.append(obj.parent.getWorldMatrix(new Matrix(), inHud || !cam ? 0 : cam.scrollX, inHud || !cam ? 0 : cam.scrollY));
    return m.applyInverse(p.x, p.y, out);
  }
  _emitObj(obj, type, p, lx, ly, e, extra) {
    var stopped = false;
    var ev = { stopPropagation: function () { stopped = true; }, event: e, pointer: p };
    obj.emit(type, p, lx, ly, ev, extra);
    this.emit('gameobject' + type.replace('pointer', ''), p, obj, ev);
    return stopped;
  }
  _handle(type, p, e, consumed) {
    if (this.scene.sys.status !== 'running') return false;
    var hits = consumed ? [] : this.hitTestPointer(p);
    var top = hits[0] || null;
    var gotHit = !!top;
    var m = this.manager;
    switch (type) {
      case 'pointerdown': {
        if (p.type === 'mouse' && p._down && p.button !== p._downButton) {
          this.emit(type, p, hits.map(function (x) { return x.object; }));
          break;
        }
        for (var i = 0; i < hits.length; i++) {
          var h = hits[i]; if (h.object._input) h.object._input.down = true;
          if (this._emitObj(h.object, 'pointerdown', p, h.localX, h.localY, e)) break;
        }
        if (!p._down) { p._down = top ? top.object : null; p._downButton = p.button; }
        if (top && top.object.draggable && !p._drag) {
          var pl = this._parentLocal(top.object, p, new Vec2());
          p._drag = { obj: top.object, scene: this, offX: top.object.x - pl.x, offY: top.object.y - pl.y, started: false, startX: top.object.x, startY: top.object.y };
          if (top.object._input) { top.object._input.dragStartX = top.object.x; top.object._input.dragStartY = top.object.y; }
        }
        this.emit('pointerdown', p, hits.map(function (x) { return x.object; }));
        break;
      }
      case 'pointermove': case 'hover': {
        this._updateOver(p, top, e);
        var d = p._drag;
        if (d && d.scene === this && p.isDown && !d.obj.destroyed) {
          var thr = this.dragThreshold !== null ? this.dragThreshold : m.dragThreshold;
          if (!d.started && p.distance >= thr) {
            d.started = true;
            d.obj.emit('dragstart', p, d.obj.x, d.obj.y);
            this.emit('dragstart', p, d.obj);
          }
          if (d.started && type === 'pointermove') {
            var lp = this._parentLocal(d.obj, p, new Vec2());
            var dx = lp.x + d.offX, dy = lp.y + d.offY;
            if (!d.obj._input || d.obj._input.autoDrag !== false) { d.obj.x = dx; d.obj.y = dy; }
            d.obj.emit('drag', p, dx, dy);
            this.emit('drag', p, d.obj, dx, dy);
          }
        }
        if (type === 'pointermove') {
          if (top) this._emitObj(top.object, 'pointermove', p, top.localX, top.localY, e);
          this.emit('pointermove', p, hits.map(function (x) { return x.object; }));
        }
        break;
      }
      case 'pointerup': case 'pointercancel': {
        var downObj = p._down;
        if (type === 'pointerup' && p.type === 'mouse' && downObj && p.button !== p._downButton) {
          this.emit(type, p, hits.map(function (x) { return x.object; }));
          break;
        }
        for (var j = 0; j < hits.length; j++) {
          var hu = hits[j]; if (hu.object._input) hu.object._input.down = false;
          if (this._emitObj(hu.object, type, p, hu.localX, hu.localY, e)) break;
        }
        if (downObj && !downObj.destroyed) {
          if (top && top.object === downObj && type === 'pointerup' && !(p._drag && p._drag.started)) downObj.emit('pointertap', p, top.localX, top.localY);
          else if (!top || top.object !== downObj) downObj.emit('pointerupoutside', p);
          if (downObj._input) downObj._input.down = false;
        }
        var dr = p._drag;
        if (dr && dr.scene === this) {
          if (dr.started && !dr.obj.destroyed) {
            var dropHits = type === 'pointercancel' ? [] : this.hitTestPointer(p, true), zone = null;
            for (var k = 0; k < dropHits.length; k++) if (dropHits[k].object !== dr.obj && dropHits[k].object._input && dropHits[k].object._input.dropZone) { zone = dropHits[k].object; break; }
            if (zone) { dr.obj.emit('drop', p, zone); this.emit('drop', p, dr.obj, zone); }
            dr.obj.emit('dragend', p, dr.obj.x, dr.obj.y, !!zone);
            this.emit('dragend', p, dr.obj, !!zone);
          }
          p._drag = null;
        }
        p._down = null;
        this.emit(type, p, hits.map(function (x) { return x.object; }));
        break;
      }
      case 'pointerout': {
        this._updateOver(p, null, e);
        break;
      }
      case 'wheel': {
        if (top) top.object.emit('wheel', p, p.deltaX, p.deltaY, p.deltaZ);
        this.emit('wheel', p, hits.map(function (x) { return x.object; }), p.deltaX, p.deltaY, p.deltaZ);
        break;
      }
    }
    return gotHit && this.topOnly;
  }
  _updateOver(p, top, e) {
    var old = p._over && p._over.scene === this ? p._over.obj : null;
    var neu = top ? top.object : null;
    if (old && old.destroyed) old = null;
    if (old === neu) return;
    if (old) { if (old._input) old._input.over = false; old.emit('pointerout', p, e); this.emit('gameobjectout', p, old); }
    if (neu) { if (neu._input) neu._input.over = true; neu.emit('pointerover', p, top.localX, top.localY, e); this.emit('gameobjectover', p, neu); }
    p._over = neu ? { obj: neu, scene: this } : null;
    if (p.type === 'mouse') this.manager.setCursor(neu && neu.cursor ? neu.cursor : null);
  }
  shutdown() {
    this.off();
    this.keyboard.shutdown();
    var ps = this.manager.pointers;
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (p._drag && p._drag.scene === this) p._drag = null;
      if (p._over && p._over.scene === this) p._over = null;
      if (p._down && p._down.scene === this.scene) p._down = null;
    }
    this.manager.setCursor(null);
  }
  destroy() { this.shutdown(); this.scene = null; }
}

UG.Key = Key;
UG.Pointer = Pointer;
UG.InputManager = InputManager;
UG.InputPlugin = InputPlugin;
UG.GamepadManager = GamepadManager;
UG.KeyCodes = KEY_ALIASES;
UG.resolveKeyCodes = resolveKeyCodes;
