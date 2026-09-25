'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const UG = require('../dist/ultragame.js');

const context = { window: {}, location: { search: '' }, URLSearchParams, MG: {}, UG };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../games3d/common3d.js'), 'utf8'), context);
const input = new UG.EventEmitter();
input.mousePointer = { type: 'mouse', buttons: 0, button: 0 };
const scene = { input, events: new UG.EventEmitter() };
const mouse = context.window.G3.mouseButtons(scene);
function event(type, button, buttons, objects) {
  Object.assign(input.mousePointer, { button, buttons });
  input.emit(type, input.mousePointer, objects || []);
}
function state(left, right) { assert.equal(mouse.left, left); assert.equal(mouse.right, right); }

event('pointerdown', 2, 2); state(false, true);
event('pointerdown', 0, 3); state(true, true);
event('pointerup', 0, 2); state(false, true);
event('pointerdown', 0, 3); state(true, true);
event('pointerup', 2, 1); state(true, false);
event('pointerup', 0, 0); state(false, false);
event('pointerdown', 0, 1); event('pointerdown', 2, 3); state(true, true);
event('pointerup', 2, 1); state(true, false);
event('pointercancel', 0, 0); state(false, false);

// Los clics de HUD no disparan; un dedo que se levanta no suelta el ratón.
event('pointerdown', 0, 1, [{}]); state(false, false);
event('pointerup', 0, 0);
event('pointerdown', 0, 1);
input.emit('pointerup', { type: 'touch', buttons: 0 }); state(true, false);
input.emit('pointercancel', { type: 'touch', buttons: 0 }); state(true, false);
event('pointerdown', 2, 3, [{}]); state(true, false);
event('pointerup', 2, 1); state(true, false);

// Si la liberación ocurrió con la escena pausada, no queda un disparo atascado.
input.mousePointer.buttons = 0; state(false, false);
for (const lifecycle of ['pause', 'sleep', 'shutdown']) {
  event('pointerdown', 0, 1); event('pointerdown', 2, 3);
  scene.events.emit(lifecycle); state(false, false);
}
console.log('3D mouse actions: aim/fire in both orders, HUD, touch, cancellation and scene lifecycle passed');
