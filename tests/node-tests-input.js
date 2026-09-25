#!/usr/bin/env node
'use strict';
// DOM event sequences exercise the source directly, including the pointer/mouse
// compatibility events emitted by browsers when several mouse buttons are held.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const order = fs.readFileSync(path.join(root, 'tools/build.js'), 'utf8').match(/const ORDER = \[([\s\S]*?)\];/)[1];
const source = Array.from(order.matchAll(/'([^']+\.js)'/g), m => fs.readFileSync(path.join(root, 'src', m[1]), 'utf8')).join('\n');
const engine = new vm.Script(source, { filename: 'ultragame-source.js' });

class Target {
  constructor() { this.listeners = new Map(); this.style = {}; }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  removeEventListener(type, fn) { const list = this.listeners.get(type) || []; const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); }
  fire(type, props = {}) {
    const e = Object.assign({ type, target: this, clientX: 40, clientY: 40, button: 0, buttons: 0, cancelable: true,
      defaultPrevented: false, preventDefault() { if (this.cancelable) this.defaultPrevented = true; } }, props);
    for (const fn of (this.listeners.get(type) || []).slice()) fn(e);
    return e;
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400 }; }
  focus() {}
  setPointerCapture() {}
}

function fixture(config, pointerEvents = true) {
  const window = new Target(), document = new Target(), canvas = new Target();
  if (pointerEvents) window.PointerEvent = function () {};
  document.hidden = false; document.pointerLockElement = null;
  const sandbox = { window, document, console, performance, setTimeout, clearTimeout, URL, TextEncoder, TextDecoder };
  vm.createContext(sandbox); engine.runInContext(sandbox);
  const UG = sandbox.UG;
  const game = { width: 600, height: 400, canvas, isVisibleOnPage: () => true };
  const input = game.input = new UG.InputManager(game, config);
  const scene = { game, sys: { status: 'running' }, cameras: { main: null }, world: new UG.Container(), hud: new UG.Container() };
  scene.input = new UG.InputPlugin(scene);
  game.scene = { getInputScenes: () => [scene] };
  input.boot(canvas);
  const events = [];
  for (const type of ['pointerdown', 'pointerup', 'pointercancel']) input.on(type, p => events.push([type, p.button, p.buttons, p.isDown]));
  function mouse(type, button, buttons, extra) {
    return (type === 'mousedown' ? canvas : window).fire(type, Object.assign({ button, buttons }, extra));
  }
  function view() {
    return Object.assign(new UG.EventEmitter(), { scene, camera: new UG.PerspectiveCamera(), worldTransform: new UG.Matrix(),
      viewWidth: 600, viewHeight: 400, controls: [], addControl(c) { this.controls.push(c); } });
  }
  function object() {
    const o = new UG.Container(); o.hitArea = new UG.Rectangle(0, 0, 100, 100); o.setInteractive(); scene.hud.addChild(o); return o;
  }
  return { UG, window, document, canvas, game, scene, input, mouse, view, object, events };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n' + e.stack); }
}

test('canvas blocks context menu by default, with explicit opt-out and disabled input', () => {
  const f = fixture(); assert(f.canvas.fire('contextmenu').defaultPrevented);
  f.input.enabled = false; assert(!f.canvas.fire('contextmenu').defaultPrevented);
  assert(!fixture({ disableContextMenu: false }).canvas.fire('contextmenu').defaultPrevented);
});

test('aim then fire delivers both buttons once and preserves aim when fire is released', () => {
  const f = fixture();
  f.canvas.fire('pointerdown', { pointerType: 'mouse', pointerId: 1, button: 2, buttons: 2 });
  f.mouse('mousedown', 2, 2);
  f.window.fire('pointermove', { pointerType: 'mouse', pointerId: 1, button: 0, buttons: 3 });
  f.mouse('mousedown', 0, 3);
  assert(f.input.mousePointer.leftButtonDown && f.input.mousePointer.rightButtonDown);
  f.window.fire('pointermove', { pointerType: 'mouse', pointerId: 1, button: 0, buttons: 2 });
  f.mouse('mouseup', 0, 2);
  assert(f.input.mousePointer.isDown && f.input.mousePointer.rightButtonDown);
  f.window.fire('pointerup', { pointerType: 'mouse', pointerId: 1, button: 2, buttons: 0 });
  f.mouse('mouseup', 2, 0);
  assert.deepStrictEqual(f.events, [['pointerdown', 2, 2, true], ['pointerdown', 0, 3, true], ['pointerup', 0, 2, true], ['pointerup', 2, 0, false]]);
});

test('fire then aim preserves fire when aim is released', () => {
  const f = fixture(); f.mouse('mousedown', 0, 1); f.mouse('mousedown', 2, 3); f.mouse('mouseup', 2, 1);
  assert(f.input.mousePointer.isDown && f.input.mousePointer.leftButtonDown && !f.input.mousePointer.rightButtonDown);
  f.mouse('mouseup', 0, 0); assert(!f.input.mousePointer.isDown);
});

test('legacy mouse events derive right/middle masks correctly without buttons', () => {
  const f = fixture({}, false);
  f.mouse('mousedown', 2, undefined); assert.strictEqual(f.input.mousePointer.buttons, 2);
  f.mouse('mousedown', 1, undefined); assert.strictEqual(f.input.mousePointer.buttons, 6);
  f.mouse('mouseup', 2, undefined); assert.strictEqual(f.input.mousePointer.buttons, 4);
  f.mouse('mouseup', 1, undefined); assert.strictEqual(f.input.mousePointer.buttons, 0);
});

test('outside mouse releases and hover presses do not synthesize gameplay input', () => {
  const f = fixture(); f.mouse('mouseup', 0, 0);
  f.window.fire('pointermove', { pointerType: 'mouse', pointerId: 1, buttons: 1 });
  assert.strictEqual(f.events.length, 0); assert.strictEqual(f.input.mousePointer.buttons, 0);
});

test('multitouch remains independent and does not duplicate compatibility mouse input', () => {
  const f = fixture();
  f.canvas.fire('pointerdown', { pointerType: 'touch', pointerId: 7, buttons: 1 });
  f.canvas.fire('pointerdown', { pointerType: 'touch', pointerId: 8, buttons: 1 });
  f.mouse('mousedown', 0, 1, { sourceCapabilities: { firesTouchEvents: true } });
  assert.strictEqual(f.events.length, 2); assert(!f.input.mousePointer.isDown);
  f.window.fire('pointerup', { pointerType: 'touch', pointerId: 7, buttons: 0 });
  assert(!f.input.pointers[1].isDown); assert(f.input.pointers[2].isDown);
  f.window.fire('pointercancel', { pointerType: 'touch', pointerId: 8 });
  assert(!f.input.pointers[2].active);
});

test('lost touch capture cancels exactly once and ignores normal capture release', () => {
  const f = fixture(); f.canvas.fire('pointerdown', { pointerType: 'touch', pointerId: 7, buttons: 1 });
  f.canvas.fire('lostpointercapture', { pointerType: 'touch', pointerId: 7 });
  f.canvas.fire('lostpointercapture', { pointerType: 'touch', pointerId: 7 });
  assert.deepStrictEqual(f.events.map(e => e[0]), ['pointerdown', 'pointercancel']);
});

for (const reason of ['blur', 'hidden', 'pointerlock']) test(reason + ' cancels buttons and keys without a click or repeated cancel', () => {
  const f = fixture();
  if (reason === 'pointerlock') { f.document.pointerLockElement = f.canvas; f.document.fire('pointerlockchange'); }
  f.mouse('mousedown', 2, 2); f.mouse('mousedown', 0, 3); f.window.fire('keydown', { code: 'KeyW' });
  if (reason === 'blur') f.window.fire('blur');
  if (reason === 'hidden') { f.document.hidden = true; f.document.fire('visibilitychange'); }
  if (reason === 'pointerlock') { f.document.pointerLockElement = null; f.document.fire('pointerlockchange'); }
  assert(!f.input.keyboard.isDown('W')); assert(!f.input.mousePointer.isDown); assert.strictEqual(f.input.mousePointer.buttons, 0);
  assert.deepStrictEqual(f.events.map(e => e[0]), ['pointerdown', 'pointerdown', 'pointercancel']);
  f.input.releaseAll(); assert.strictEqual(f.events.length, 3);
});

test('keyup releases a key even when the keyboard is disabled while it is held', () => {
  const f = fixture(); f.window.fire('keydown', { code: 'KeyW' }); f.input.keyboard.enabled = false;
  f.window.fire('keyup', { code: 'KeyW' }); assert(!f.input.keyboard.isDown('W'));
});

test('pointer lock never clicks the HUD at the frozen cursor position', () => {
  const f = fixture(), o = f.object(); let taps = 0; o.on('pointertap', () => taps++);
  f.document.pointerLockElement = f.canvas; f.document.fire('pointerlockchange');
  f.mouse('mousedown', 0, 1); f.mouse('mouseup', 0, 0);
  assert.strictEqual(taps, 0); assert.strictEqual(f.events.length, 2);
});

test('cancelling a pressed object emits cancel, never tap or up', () => {
  const f = fixture(), o = f.object(), events = [];
  for (const type of ['pointertap', 'pointerup', 'pointercancel']) o.on(type, () => events.push(type));
  f.mouse('mousedown', 0, 1); f.window.fire('blur');
  assert.deepStrictEqual(events, ['pointercancel']); assert(!o._input.down);
});

test('secondary release does not activate or end a primary drag', () => {
  const f = fixture(), o = f.object(); o.draggable = true; let taps = 0, ends = 0;
  o.on('pointertap', () => taps++); o.on('dragend', () => ends++);
  f.mouse('mousedown', 0, 1); f.mouse('mousedown', 2, 3); f.mouse('mouseup', 2, 1);
  assert.strictEqual(taps, 0); assert(f.input.mousePointer._drag);
  f.window.fire('pointermove', { pointerType: 'mouse', pointerId: 1, button: -1, buttons: 1, clientX: 60 });
  f.mouse('mouseup', 0, 0, { clientX: 60 });
  assert.strictEqual(taps, 0); assert.strictEqual(ends, 1);
});

test('cancelled drag never drops onto a drop zone', () => {
  const f = fixture(), o = f.object(); o.draggable = true; let drops = 0;
  o.on('drop', () => drops++);
  f.mouse('mousedown', 0, 1);
  f.window.fire('pointermove', { pointerType: 'mouse', pointerId: 1, button: -1, buttons: 1, clientX: 60 });
  const zone = f.object(); zone._input.dropZone = true;
  f.window.fire('blur'); assert.strictEqual(drops, 0); assert.strictEqual(f.input.mousePointer._drag, null);
});

test('UI Button only clicks on the primary mouse button and recovers on cancel', () => {
  const f = fixture(); let clicks = 0;
  f.UG.Button.prototype._layout = function () { this.hitArea = new f.UG.Rectangle(0, 0, 100, 100); };
  f.UG.Button.prototype._setState = function (state) { this._state = state; };
  const button = new f.UG.Button(f.scene, 0, 0, { sound: false, onClick: () => clicks++ }); f.scene.hud.addChild(button);
  f.mouse('mousedown', 2, 2); f.mouse('mouseup', 2, 0); assert.strictEqual(clicks, 0);
  f.mouse('mousedown', 0, 1); f.mouse('mouseup', 0, 0); assert.strictEqual(clicks, 1);
  f.mouse('mousedown', 0, 1); f.window.fire('blur'); assert.strictEqual(button._state, 'normal'); assert.strictEqual(clicks, 1);
});

for (const kind of ['FirstPersonControls3D', 'ThirdPersonControls3D', 'FlyControls3D', 'OrbitControls3D']) test(kind + ' keeps looking after firing while right button remains held', () => {
  const f = fixture(), control = new f.UG[kind](f.view(), { pointerLock: false });
  f.mouse('mousedown', 2, 2); f.mouse('mousedown', 0, 3); f.mouse('mouseup', 0, 2);
  const before = control.yaw, targetBefore = control.target && control.target.x;
  f.window.fire('pointermove', { pointerType: 'mouse', pointerId: 1, button: -1, buttons: 2, clientX: 70 });
  assert(control.yaw !== before || control.target && control.target.x !== targetBefore);
  f.window.fire('blur');
  const after = control.yaw, targetAfter = control.target && control.target.x;
  f.window.fire('pointermove', { pointerType: 'mouse', pointerId: 1, button: -1, buttons: 0, clientX: 90 });
  assert.strictEqual(control.yaw, after); if (control.target) assert.strictEqual(control.target.x, targetAfter);
  control.destroy();
});

test('FlyControls supports the configured middle button and ignores movement while disabled', () => {
  const f = fixture(), control = new f.UG.FlyControls3D(f.view(), { button: 1 });
  f.mouse('mousedown', 1, 4);
  f.window.fire('pointermove', { pointerType: 'mouse', pointerId: 1, buttons: 4, clientX: 60 }); assert.notStrictEqual(control.yaw, 0);
  const before = control.yaw; control.enabled = false;
  f.window.fire('pointermove', { pointerType: 'mouse', pointerId: 1, buttons: 4, clientX: 80 }); assert.strictEqual(control.yaw, before);
  control.destroy();
});

test('gamepad disconnect releases buttons and zeroes sticks', () => {
  const f = fixture(), pad = f.input.gamepad.pad1; let releases = 0; f.input.gamepad.on('up', () => releases++);
  pad._update({ connected: true, id: 'test', axes: [1, -1, 1, 1], buttons: [{ pressed: true, value: 1 }] }, 1);
  pad._update(null, 2);
  assert(!pad.isDown(0)); assert.strictEqual(pad.value(0), 0); assert.strictEqual(pad.leftStick.x, 0); assert.strictEqual(pad.axes[3], 0); assert.strictEqual(releases, 1);
  pad._update(null, 3); assert.strictEqual(releases, 1);
});

test('destroy removes every input DOM listener', () => {
  const f = fixture(); f.input.destroy();
  for (const target of [f.window, f.document, f.canvas]) assert(Array.from(target.listeners.values()).every(list => !list.length));
});

console.log('\nInput: ' + passed + ' passed, ' + failed + ' failed.');
if (failed) process.exitCode = 1;
