'use strict';
const assert=require('node:assert/strict'),UG=require('../dist/ultragame.js');
for(const fps of [30,60,144]){
  const world=new UG.RigidWorld2D({gravity:{x:0,y:0}}),sprite={x:0,y:0,rotation:0,active:true},body=world.addBox(0,0,20,20,{gameObject:sprite,linearDamping:0});body._syncObject();
  for(let i=0;i<fps*2;i++){sprite.x+=120/fps;const expected=sprite.x;world.step(1/fps);assert.ok(Math.abs(sprite.x-expected)<1e-7,`El movimiento directo retrocedió a ${fps} FPS: ${expected} → ${sprite.x}`);}
  assert.ok(Math.abs(body.originX-240)<1e-6);body.setPosition(600,20);world.step(1/fps);assert.ok(Math.abs(sprite.x-600)<1e-6,'La sincronización anuló setPosition');world.destroy();
}
console.log('Movimiento rígido 2D: 30, 60 y 144 FPS, sin retrocesos; teletransporte conservado.');
