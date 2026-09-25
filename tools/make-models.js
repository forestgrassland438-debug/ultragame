#!/usr/bin/env node
/**
 * Genera los modelos 3D de prueba (GLB, el mismo formato que exporta Blender) en assets3d/:
 *   humanoid.glb  - personaje con esqueleto (19 huesos) y animaciones Idle, Walk, Run, Jump, Aim, Shoot, Hit, Die, Attack, Wave, Dance
 *   robot.glb     - enemigo con el mismo esqueleto y proporciones distintas
 *   car.glb       - coche con ruedas como nodos separados (wheel_FL, wheel_FR, wheel_RL, wheel_RR)
 *   police.glb, taxi.glb - variantes de color
 *   house.glb, shop.glb  - casas con puerta, ventanas con hueco (cristales rompibles 'glass_N'), muebles y puntos 'item_N'
 *   tree.glb, pine.glb, bush.glb, rock.glb
 *   crate.glb     - caja con textura PNG incrustada (madera procedural) y mapa normal
 *   rifle.glb, pistol.glb, smg.glb, shotgun.glb, sniper.glb (armas con nodo 'muzzle')
 *   apple.glb, bread.glb, water.glb, soda.glb, medkit.glb, ammo.glb, grenade.glb (objetos para recoger)
 *   coin.glb, fruit.glb, barrel.glb, lamp.glb, fence.glb, flag.glb
 * Uso: node tools/make-models.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const UG = require('../dist/ultragame.js');
const { Vec3, Quat, Mat4, Geometry3D, Mesh3D, Group3D, Node3D, StandardMaterial, Skeleton3D, AnimationClip3D, GLTFExporter } = UG;

const OUT = path.join(__dirname, '..', 'assets3d');
fs.mkdirSync(OUT, { recursive: true });
const D = Math.PI / 180;

/* ------------------------------------------------------------ utilidades */
function srgb(hex) { return [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255]; }
function lin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
/** Geometría con color por vértice (lineal, como glTF COLOR_0) */
function colored(geo, hex, shade) {
  const n = geo.vertexCount, c = new Float32Array(n * 4), s = srgb(hex).map(lin), N = geo.attributes.normal.data;
  for (let i = 0; i < n; i++) {
    const k = shade === false ? 1 : 0.86 + 0.14 * Math.max(0, N[i * 3 + 1]); // leve oclusión en caras inferiores
    c[i * 4] = s[0] * k; c[i * 4 + 1] = s[1] * k; c[i * 4 + 2] = s[2] * k; c[i * 4 + 3] = 1;
  }
  geo.setAttribute('color', c, 4);
  return geo;
}
function part(geo, hex, pos, rot, scale) {
  const m = new Mat4().compose(pos ? new Vec3(pos[0], pos[1], pos[2]) : new Vec3(), rot ? new Quat().setFromEuler(rot[0] * D, rot[1] * D, rot[2] * D) : new Quat(), scale ? new Vec3(scale[0], scale[1], scale[2]) : new Vec3(1, 1, 1));
  return { geometry: colored(geo, hex), matrix: m };
}
function merged(parts) { return Geometry3D.merge(parts); }
function vcMat(o) { return new StandardMaterial(Object.assign({ vertexColors: true, roughness: 0.75, metalness: 0 }, o || {})); }
function save(name, root, animations) {
  const glb = GLTFExporter.exportGLB(root, { animations: animations || [], name: name });
  fs.writeFileSync(path.join(OUT, name + '.glb'), Buffer.from(glb));
  console.log('  ' + name + '.glb  ' + (glb.byteLength / 1024).toFixed(1) + ' KB' + (animations && animations.length ? '  (' + animations.map(a => a.name).join(', ') + ')' : ''));
}

/* ------------------------------------------------------- personaje con esqueleto */
// huesos: [nombre, padre, posición de la articulación en el modelo (reposo)]
const BONES = [
  ['hips', null, [0, 0.95, 0]], ['spine', 'hips', [0, 1.1, 0]], ['chest', 'spine', [0, 1.3, 0]], ['neck', 'chest', [0, 1.52, 0]], ['head', 'neck', [0, 1.6, 0]],
  ['shoulder.L', 'chest', [0.2, 1.46, 0]], ['upperarm.L', 'shoulder.L', [0.24, 1.44, 0]], ['forearm.L', 'upperarm.L', [0.24, 1.16, 0]], ['hand.L', 'forearm.L', [0.24, 0.9, 0]],
  ['shoulder.R', 'chest', [-0.2, 1.46, 0]], ['upperarm.R', 'shoulder.R', [-0.24, 1.44, 0]], ['forearm.R', 'upperarm.R', [-0.24, 1.16, 0]], ['hand.R', 'forearm.R', [-0.24, 0.9, 0]],
  ['thigh.L', 'hips', [0.1, 0.92, 0]], ['shin.L', 'thigh.L', [0.1, 0.5, 0]], ['foot.L', 'shin.L', [0.1, 0.08, 0]],
  ['thigh.R', 'hips', [-0.1, 0.92, 0]], ['shin.R', 'thigh.R', [-0.1, 0.5, 0]], ['foot.R', 'shin.R', [-0.1, 0.08, 0]]
];
function buildCharacter(style) {
  const root = new Group3D(); root.name = style.name;
  const byName = {}, bones = [];
  BONES.forEach(([n, parent, p]) => {
    const b = new Node3D(); b.name = n; b.userData.rest = p; byName[n] = b; bones.push(b);
    const pp = parent ? byName[parent].userData.rest : [0, 0, 0];
    b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    (parent ? byName[parent] : root).add(b);
  });
  const S = style;
  // piezas: [hueso, caja (centro x,y,z, tamaño w,h,d), color]
  const P = [
    ['hips', [0, 0.95, 0, 0.36 * S.w, 0.22, 0.22 * S.d], S.pants],
    ['spine', [0, 1.13, 0, 0.36 * S.w, 0.2, 0.22 * S.d], S.shirt],
    ['chest', [0, 1.34, 0, 0.44 * S.w, 0.3, 0.26 * S.d], S.shirt],
    ['neck', [0, 1.55, 0, 0.12, 0.08, 0.12], S.skin],
    ['head', [0, 1.72, 0.01, 0.26 * S.head, 0.28 * S.head, 0.26 * S.head], S.skin],
    ['head', [0, 1.87 * (S.head > 1 ? 1.02 : 1), -0.01, 0.28 * S.head, 0.08, 0.28 * S.head], S.hair],
    ['head', [0.06, 1.74, 0.135 * S.head, 0.04, 0.05, 0.02], S.eye], ['head', [-0.06, 1.74, 0.135 * S.head, 0.04, 0.05, 0.02], S.eye],
    ['upperarm.L', [0.25 * S.w, 1.3, 0, 0.1 * S.limb, 0.3, 0.11 * S.limb], S.sleeve], ['forearm.L', [0.25 * S.w, 1.03, 0, 0.09 * S.limb, 0.27, 0.1 * S.limb], S.skinArm], ['hand.L', [0.25 * S.w, 0.84, 0, 0.09, 0.12, 0.1], S.glove],
    ['upperarm.R', [-0.25 * S.w, 1.3, 0, 0.1 * S.limb, 0.3, 0.11 * S.limb], S.sleeve], ['forearm.R', [-0.25 * S.w, 1.03, 0, 0.09 * S.limb, 0.27, 0.1 * S.limb], S.skinArm], ['hand.R', [-0.25 * S.w, 0.84, 0, 0.09, 0.12, 0.1], S.glove],
    ['thigh.L', [0.1, 0.71, 0, 0.14 * S.limb, 0.42, 0.15 * S.limb], S.pants], ['shin.L', [0.1, 0.3, 0, 0.12 * S.limb, 0.4, 0.13 * S.limb], S.pants], ['foot.L', [0.1, 0.05, 0.05, 0.13, 0.1, 0.26], S.shoes],
    ['thigh.R', [-0.1, 0.71, 0, 0.14 * S.limb, 0.42, 0.15 * S.limb], S.pants], ['shin.R', [-0.1, 0.3, 0, 0.12 * S.limb, 0.4, 0.13 * S.limb], S.pants], ['foot.R', [-0.1, 0.05, 0.05, 0.13, 0.1, 0.26], S.shoes]
  ];
  if (S.extra) S.extra(P);
  const pos = [], nrm = [], col = [], jnt = [], wgt = [], idx = [];
  P.forEach(([bone, b, color]) => {
    const g = Geometry3D.box(b[3], b[4], b[5]), bi = bones.indexOf(byName[bone]), c = srgb(color).map(lin), base = pos.length / 3;
    const gp = g.attributes.position.data, gn = g.attributes.normal.data;
    for (let i = 0; i < g.vertexCount; i++) {
      pos.push(gp[i * 3] + b[0], gp[i * 3 + 1] + b[1], gp[i * 3 + 2] + b[2]); nrm.push(gn[i * 3], gn[i * 3 + 1], gn[i * 3 + 2]);
      const k = 0.85 + 0.15 * Math.max(0, gn[i * 3 + 1]); col.push(c[0] * k, c[1] * k, c[2] * k, 1);
      jnt.push(bi, 0, 0, 0); wgt.push(1, 0, 0, 0);
    }
    for (let t = 0; t < g.index.length; t++) idx.push(g.index[t] + base);
  });
  const geo = new Geometry3D();
  geo.setAttribute('position', new Float32Array(pos), 3); geo.setAttribute('normal', new Float32Array(nrm), 3); geo.setAttribute('color', new Float32Array(col), 4);
  geo.setAttribute('uv', new Float32Array(pos.length / 3 * 2), 2); geo.setAttribute('joints', new Float32Array(jnt), 4); geo.setAttribute('weights', new Float32Array(wgt), 4);
  geo.setIndex(idx);
  const mesh = new Mesh3D(geo, vcMat({ name: style.name + '-mat', roughness: 0.7 })); mesh.name = style.name + '-body';
  root.add(mesh);
  const ib = new Float32Array(bones.length * 16);
  bones.forEach((b, i) => { const r = b.userData.rest, m = new Mat4().makeTranslation(-r[0], -r[1], -r[2]); ib.set(m.e, i * 16); delete b.userData.rest; });
  mesh.skeleton = new Skeleton3D(bones, ib);
  return { root, bones: byName };
}
/** Animación por huesos a partir de funciones del tiempo -> claves muestreadas (LINEAR) */
function clip(name, dur, fps, fn, loopable) {
  const n = Math.max(2, Math.round(dur * fps) + 1), tracks = {};
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) * dur, u = loopable ? (i === n - 1 ? 0 : t / dur) : t / dur, pose = fn(u, t);
    Object.keys(pose).forEach(b => {
      const r = pose[b];
      if (r.rot) { const q = new Quat().setFromEuler((r.rot[0] || 0) * D, (r.rot[1] || 0) * D, (r.rot[2] || 0) * D, 'XYZ'); (tracks[b] = tracks[b] || {}).quaternion = (tracks[b].quaternion || []); tracks[b].quaternion.push([t, q.x, q.y, q.z, q.w]); }
      if (r.pos) { (tracks[b] = tracks[b] || {}).position = (tracks[b].position || []); tracks[b].position.push([t, r.pos[0], r.pos[1], r.pos[2]]); }
    });
  }
  return AnimationClip3D.fromKeys(name, tracks);
}
const S2 = Math.PI * 2;
function humanoidClips(hipY) {
  const sin = Math.sin, cos = Math.cos;
  return [
    clip('Idle', 2.4, 20, u => ({ chest: { rot: [sin(u * S2) * 2, 0, 0] }, spine: { rot: [sin(u * S2) * 1, 0, 0] }, 'upperarm.L': { rot: [0, 0, 6 + sin(u * S2) * 2] }, 'upperarm.R': { rot: [0, 0, -6 - sin(u * S2) * 2] }, head: { rot: [0, sin(u * S2 * 0.5) * 6, 0] }, hips: { pos: [0, hipY + sin(u * S2 * 2) * 0.006, 0] } }), true),
    clip('Walk', 1.0, 24, u => { const a = sin(u * S2), b = sin(u * S2 + Math.PI); return {
      'thigh.L': { rot: [-a * 28, 0, 0] }, 'thigh.R': { rot: [-b * 28, 0, 0] }, 'shin.L': { rot: [Math.max(0, cos(u * S2 + 0.6)) * 35, 0, 0] }, 'shin.R': { rot: [Math.max(0, cos(u * S2 + Math.PI + 0.6)) * 35, 0, 0] },
      'upperarm.L': { rot: [b * 24, 0, 5] }, 'upperarm.R': { rot: [a * 24, 0, -5] }, 'forearm.L': { rot: [-12, 0, 0] }, 'forearm.R': { rot: [-12, 0, 0] },
      hips: { pos: [0, hipY + Math.abs(cos(u * S2)) * 0.03 - 0.02, 0], rot: [0, a * 6, 0] }, chest: { rot: [3, -a * 5, 0] } }; }, true),
    clip('Run', 0.66, 30, u => { const a = sin(u * S2), b = sin(u * S2 + Math.PI); return {
      'thigh.L': { rot: [-a * 48, 0, 0] }, 'thigh.R': { rot: [-b * 48, 0, 0] }, 'shin.L': { rot: [Math.max(0, cos(u * S2 + 0.5)) * 75 + 10, 0, 0] }, 'shin.R': { rot: [Math.max(0, cos(u * S2 + Math.PI + 0.5)) * 75 + 10, 0, 0] },
      'upperarm.L': { rot: [b * 45, 0, 8] }, 'upperarm.R': { rot: [a * 45, 0, -8] }, 'forearm.L': { rot: [-65, 0, 0] }, 'forearm.R': { rot: [-65, 0, 0] },
      hips: { pos: [0, hipY + Math.abs(cos(u * S2)) * 0.07 - 0.05, 0], rot: [0, a * 8, 0] }, spine: { rot: [10, 0, 0] }, chest: { rot: [4, -a * 9, 0] } }; }, true),
    clip('Jump', 0.9, 30, u => { const c = u < 0.25 ? u / 0.25 : (u < 0.45 ? 1 - (u - 0.25) / 0.2 : (u < 0.85 ? 0.2 : 0.2 + (u - 0.85) / 0.15 * 0.6)); return {
      hips: { pos: [0, hipY - c * 0.18, 0] }, 'thigh.L': { rot: [-c * 60, 0, 0] }, 'thigh.R': { rot: [-c * 60, 0, 0] }, 'shin.L': { rot: [c * 100, 0, 0] }, 'shin.R': { rot: [c * 100, 0, 0] },
      'upperarm.L': { rot: [u > 0.3 && u < 0.85 ? -150 : -20, 0, 15] }, 'upperarm.R': { rot: [u > 0.3 && u < 0.85 ? -150 : -20, 0, -15] }, spine: { rot: [c * 20, 0, 0] } }; }, false),
    clip('Aim', 1.0, 10, u => ({ 'upperarm.R': { rot: [-85, 0, 5] }, 'forearm.R': { rot: [0, 0, 0] }, 'upperarm.L': { rot: [-80, -35, 0] }, 'forearm.L': { rot: [-10, 0, 0] }, chest: { rot: [0, -8, 0] }, head: { rot: [0, 8, 0] }, hips: { pos: [0, hipY, 0] } }), true),
    clip('Shoot', 0.25, 30, u => { const k = Math.exp(-u * 8) * sin(Math.min(1, u * 4) * Math.PI); return { 'upperarm.R': { rot: [-85 - k * 18, 0, 5] }, 'upperarm.L': { rot: [-80 - k * 14, -35, 0] }, 'forearm.L': { rot: [-10, 0, 0] }, chest: { rot: [-k * 6, -8, 0] }, head: { rot: [0, 8, 0] }, hips: { pos: [0, hipY, 0] } }; }, false),
    clip('Hit', 0.45, 30, u => { const k = sin(u * Math.PI); return { chest: { rot: [-k * 18, 0, k * 6] }, head: { rot: [-k * 20, 0, 0] }, 'upperarm.L': { rot: [-k * 30, 0, 20 * k] }, 'upperarm.R': { rot: [-k * 30, 0, -20 * k] }, hips: { pos: [0, hipY, -k * 0.05] } }; }, false),
    clip('Die', 1.2, 30, u => { const e = Math.min(1, u * 1.3), f = e * e * (3 - 2 * e); return {
      hips: { pos: [0, hipY - f * (hipY - 0.17), -f * 0.5], rot: [-f * 88, 0, 0] }, 'thigh.L': { rot: [-f * 10, 0, 6 * f] }, 'thigh.R': { rot: [-f * 18, 0, -6 * f] }, 'shin.L': { rot: [f * 20, 0, 0] },
      'upperarm.L': { rot: [-f * 150, 0, f * 30] }, 'upperarm.R': { rot: [-f * 140, 0, -f * 40] }, head: { rot: [-f * 20, f * 25, 0] } }; }, false),
    clip('Attack', 0.55, 30, u => { const k = u < 0.35 ? u / 0.35 : Math.max(0, 1 - (u - 0.35) / 0.65), sw = u < 0.35 ? -150 * k : -150 + (u - 0.35) / 0.65 * 190; return {
      'upperarm.R': { rot: [u < 0.35 ? -150 * k : Math.min(40, sw), 0, -20 * k] }, 'forearm.R': { rot: [-30 * k, 0, 0] }, chest: { rot: [8 * k, u < 0.35 ? -25 * k : 30 * (1 - k), 0] },
      'upperarm.L': { rot: [-30, 0, 20] }, 'thigh.L': { rot: [-20 * k, 0, 0] }, 'shin.L': { rot: [20 * k, 0, 0] }, hips: { pos: [0, hipY - 0.04 * k, 0.06 * k] } }; }, false),
    clip('Wave', 1.2, 24, u => ({ 'upperarm.R': { rot: [0, 0, -160] }, 'forearm.R': { rot: [0, 0, sin(u * S2 * 2) * 25] }, head: { rot: [0, -10, 0] }, 'upperarm.L': { rot: [0, 0, 6] }, hips: { pos: [0, hipY, 0] } }), true),
    clip('Dance', 1.6, 24, u => { const a = sin(u * S2 * 2), b = sin(u * S2); return {
      hips: { pos: [a * 0.05, hipY - Math.abs(a) * 0.05, 0], rot: [0, b * 25, a * 6] }, chest: { rot: [0, -b * 20, -a * 8] },
      'upperarm.L': { rot: [-40 + a * 40, 0, 60 + b * 30] }, 'upperarm.R': { rot: [-40 - a * 40, 0, -60 - b * 30] }, 'forearm.L': { rot: [-60, 0, 0] }, 'forearm.R': { rot: [-60, 0, 0] },
      'thigh.L': { rot: [-Math.max(0, a) * 30, 0, 0] }, 'thigh.R': { rot: [-Math.max(0, -a) * 30, 0, 0] }, 'shin.L': { rot: [Math.max(0, a) * 45, 0, 0] }, 'shin.R': { rot: [Math.max(0, -a) * 45, 0, 0] }, head: { rot: [a * 8, 0, 0] } }; }, true)
  ];
}

/* ----------------------------------------------------------------- vehículos */
function buildCar(name, body, cabin, extra) {
  const root = new Group3D(); root.name = name;
  const parts = [
    part(Geometry3D.box(1.8, 0.5, 4.1), body, [0, 0.55, 0]), part(Geometry3D.box(1.6, 0.52, 2.0), cabin, [0, 1.05, -0.25]),
    part(Geometry3D.box(1.5, 0.42, 0.06), 0x9fd3ff, [0, 1.07, 0.76], [-28, 0, 0]), part(Geometry3D.box(1.5, 0.4, 0.06), 0x9fd3ff, [0, 1.07, -1.27], [25, 0, 0]),
    part(Geometry3D.box(0.05, 0.36, 1.6), 0x9fd3ff, [0.81, 1.06, -0.25]), part(Geometry3D.box(0.05, 0.36, 1.6), 0x9fd3ff, [-0.81, 1.06, -0.25]),
    part(Geometry3D.box(0.34, 0.14, 0.05), 0xfff3b0, [0.6, 0.62, 2.06]), part(Geometry3D.box(0.34, 0.14, 0.05), 0xfff3b0, [-0.6, 0.62, 2.06]),
    part(Geometry3D.box(0.34, 0.12, 0.05), 0xd01c1c, [0.62, 0.66, -2.06]), part(Geometry3D.box(0.34, 0.12, 0.05), 0xd01c1c, [-0.62, 0.66, -2.06]),
    part(Geometry3D.box(1.84, 0.16, 0.2), 0x2b2b2b, [0, 0.36, 2.02]), part(Geometry3D.box(1.84, 0.16, 0.2), 0x2b2b2b, [0, 0.36, -2.02])
  ];
  if (extra) extra(parts);
  const bodyMesh = new Mesh3D(merged(parts), vcMat({ roughness: 0.35, metalness: 0.25 })); bodyMesh.name = name + '-body'; root.add(bodyMesh);
  const wheelGeo = merged([part(Geometry3D.cylinder(0.36, 0.36, 0.28, 18), 0x1c1c1c, [0, 0, 0], [0, 0, 90]), part(Geometry3D.cylinder(0.2, 0.2, 0.3, 12), 0xb8b8b8, [0, 0, 0], [0, 0, 90])]);
  [['wheel_FL', 0.82, 1.3], ['wheel_FR', -0.82, 1.3], ['wheel_RL', 0.82, -1.3], ['wheel_RR', -0.82, -1.3]].forEach(([n, x, z]) => {
    const w = new Mesh3D(wheelGeo, vcMat({ roughness: 0.9 })); w.name = n; w.position.set(x, 0.36, z); root.add(w);
  });
  return root;
}

/* ------------------------------------------------------------------ edificios */
/**
 * Pared recta de largo len (a lo largo de X local), alto h y grosor t con huecos [{c (centro), w, y0, y1}]:
 * devuelve las piezas (cajas) entre huecos, bajo el alféizar y sobre el dintel. place(x, z, rotY) coloca la pared.
 */
function wallPieces(len, h, t, holes, color, place) {
  const P = [], hs = holes.slice().sort((a, b) => a.c - b.c);
  let x = -len / 2;
  const box = (x0, x1, y0, y1) => { if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3) return; const m = place((x0 + x1) / 2, (y0 + y1) / 2); P.push(part(Geometry3D.box(m.rot ? t : x1 - x0, y1 - y0, m.rot ? x1 - x0 : t), color, [m.x, m.y, m.z])); };
  hs.forEach((hl) => { const a = hl.c - hl.w / 2, b = hl.c + hl.w / 2; box(x, a, 0, h); box(a, b, 0, hl.y0); box(a, b, hl.y1, h); x = b; });
  box(x, len / 2, 0, h);
  return P;
}
/**
 * Casa con puerta sin hoja, ventanas con hueco real (alféizar a 0.95 m, 1.1 m de alto: se pueden saltar agachado),
 * cristales como mallas aparte ("glass_N", extras noCollide: se pueden romper a tiros), muebles con colisión
 * ("furniture") y puntos para objetos ("item_N": comida, bebida, munición, armas) sobre mesas, encimeras y estantes.
 */
function buildHouse(name, wall, roof, w, d, h, kind) {
  const root = new Group3D(); root.name = name;
  const t = 0.2, doorW = 1.1, doorH = 2.1, WW = 1.2, SY = 0.95, TY = 2.05, P = [], windows = [], frame = 0xf0f0f0;
  const hole = (c, ww) => ({ c, w: ww || WW, y0: SY, y1: TY });
  // frontal (+Z): puerta en el centro y una ventana a cada lado
  const fx = w * 0.3, front = [{ c: 0, w: doorW, y0: 0, y1: doorH }, hole(-fx), hole(fx)];
  P.push(...wallPieces(w, h, t, front, wall, (x, y) => ({ x, y, z: d / 2 - t / 2 })));
  // trasera (-Z): dos ventanas
  const bx = w * 0.25, back = [hole(-bx), hole(bx)];
  P.push(...wallPieces(w, h, t, back, wall, (x, y) => ({ x, y, z: -d / 2 + t / 2 })));
  // laterales (±X): una ventana centrada (la pared va a lo largo de Z)
  const side = [hole(0)];
  P.push(...wallPieces(d - 2 * t, h, t, side, wall, (x, y) => ({ x: w / 2 - t / 2, y, z: x, rot: true })));
  P.push(...wallPieces(d - 2 * t, h, t, side, wall, (x, y) => ({ x: -w / 2 + t / 2, y, z: x, rot: true })));
  // marcos blancos de ventanas y puerta
  const wins = [[-fx, d / 2 - t / 2, 'z'], [fx, d / 2 - t / 2, 'z'], [-bx, -d / 2 + t / 2, 'z'], [bx, -d / 2 + t / 2, 'z'], [w / 2 - t / 2, 0, 'x'], [-w / 2 + t / 2, 0, 'x']];
  wins.forEach(([cx, cz, ax]) => {
    const alongX = ax === 'z', sx = alongX ? WW + 0.16 : t + 0.06, sz = alongX ? t + 0.06 : WW + 0.16;
    P.push(part(Geometry3D.box(sx, 0.08, sz), frame, [cx, SY - 0.04, cz]), part(Geometry3D.box(sx, 0.08, sz), frame, [cx, TY + 0.04, cz]));
    windows.push({ x: cx, y: (SY + TY) / 2, z: cz, width: WW, height: TY - SY, sill: SY, normal: alongX ? [0, 0, Math.sign(cz)] : [Math.sign(cx), 0, 0] });
  });
  P.push(part(Geometry3D.box(w - 2 * t, 0.06, d - 2 * t), 0x8a6a4a, [0, 0.03, 0]), part(Geometry3D.box(doorW + 0.3, 0.12, 0.5), 0x9a9a9a, [0, 0.06, d / 2 + 0.25]));
  const fz = d / 2 - t / 2;
  P.push(part(Geometry3D.box(0.12, doorH, 0.26), frame, [-doorW / 2 - 0.06, doorH / 2, fz]), part(Geometry3D.box(0.12, doorH, 0.26), frame, [doorW / 2 + 0.06, doorH / 2, fz]), part(Geometry3D.box(doorW + 0.24, 0.12, 0.26), frame, [0, doorH + 0.06, fz]));
  const walls = new Mesh3D(merged(P), vcMat({ roughness: 0.9 })); walls.name = name + '-walls'; root.add(walls);
  // cristales: una malla por ventana (se pueden romper por separado)
  const glassMat = new StandardMaterial({ color: 0xbfe3ff, roughness: 0.05, metalness: 0.1, opacity: 0.32, transparent: true, side: 'double' });
  windows.forEach((wn, i) => {
    const alongX = wn.normal[2] !== 0, g = new Mesh3D(Geometry3D.box(alongX ? WW : 0.03, TY - SY, alongX ? 0.03 : WW), glassMat); g.name = 'glass_' + i;
    g.position.set(wn.x, wn.y, wn.z); g.userData = { noCollide: true, glass: true, window: i }; g.castShadow = false; root.add(g);
  });
  // muebles (colisión normal) y puntos de objetos
  const F = [], items = [], wood = 0x8b5a3c, dark = 0x5c3b27, cloth = kind === 'shop' ? 0x4c6ef5 : 0xc0392b;
  const table = (x, z, tw, td, th) => { F.push(part(Geometry3D.box(tw, 0.05, td), wood, [x, th - 0.025, z])); [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, b]) => F.push(part(Geometry3D.box(0.06, th - 0.05, 0.06), dark, [x + a * (tw / 2 - 0.06), (th - 0.05) / 2, z + b * (td / 2 - 0.06)]))); };
  const chair = (x, z) => { F.push(part(Geometry3D.box(0.42, 0.05, 0.42), wood, [x, 0.45, z]), part(Geometry3D.box(0.42, 0.45, 0.05), wood, [x, 0.7, z - 0.19])); [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, b]) => F.push(part(Geometry3D.box(0.04, 0.45, 0.04), dark, [x + a * 0.18, 0.225, z + b * 0.18]))); };
  const shelf = (x, z, sw, sd, rot) => { const W2 = rot ? sd : sw, D2 = rot ? sw : sd; F.push(part(Geometry3D.box(W2, 1.8, 0.04), dark, [x, 0.9, z - (rot ? 0 : sd / 2)]));
    [0.08, 0.5, 0.95, 1.4, 1.78].forEach((y) => F.push(part(Geometry3D.box(W2, 0.04, D2), wood, [x, y, z]))); F.push(part(Geometry3D.box(0.04, 1.8, D2), dark, [x - W2 / 2, 0.9, z]), part(Geometry3D.box(0.04, 1.8, D2), dark, [x + W2 / 2, 0.9, z])); };
  const itemAt = (x, y, z) => { const n = new Node3D(); n.name = 'item_' + items.length; n.position.set(x, y, z); items.push([x, y, z]); root.add(n); };
  const ix = w / 2 - t;
  if (kind === 'shop') {
    // mostrador delante del fondo y estanterías en los laterales
    F.push(part(Geometry3D.box(3.2, 1.0, 0.6), 0x6c757d, [0, 0.5, -d / 2 + 1.4]), part(Geometry3D.box(3.3, 0.05, 0.7), 0xdee2e6, [0, 1.02, -d / 2 + 1.4]));
    shelf(-ix + 0.25, 1.4, 1.6, 0.45, true); shelf(ix - 0.25, 1.4, 1.6, 0.45, true);
    itemAt(-0.9, 1.06, -d / 2 + 1.4); itemAt(0, 1.06, -d / 2 + 1.4); itemAt(0.9, 1.06, -d / 2 + 1.4);
    itemAt(-ix + 0.25, 0.99, 1.0); itemAt(-ix + 0.25, 1.44, 1.8); itemAt(ix - 0.25, 0.99, 1.8); itemAt(ix - 0.25, 1.44, 1.0);
  } else {
    table(0.9, -0.9, 1.2, 0.8, 0.76); chair(0.9, -0.25); chair(0.9, -1.55);
    // cama con cabecero
    F.push(part(Geometry3D.box(1.0, 0.3, 2.0), dark, [-ix + 0.55, 0.2, -1.4]), part(Geometry3D.box(0.96, 0.14, 1.94), 0xf1f3f5, [-ix + 0.55, 0.42, -1.4]), part(Geometry3D.box(0.9, 0.08, 1.2), cloth, [-ix + 0.55, 0.52, -1.1]), part(Geometry3D.box(1.0, 0.8, 0.06), dark, [-ix + 0.55, 0.5, -2.4]));
    // encimera de cocina (lado izquierdo, hacia delante) y estantería (lado derecho)
    F.push(part(Geometry3D.box(0.6, 0.88, 1.5), 0xdee2e6, [-ix + 0.3, 0.44, 1.35]), part(Geometry3D.box(0.64, 0.04, 1.54), 0x495057, [-ix + 0.3, 0.9, 1.35]));
    shelf(ix - 0.22, 1.55, 1.0, 0.4, true);
    itemAt(0.55, 0.8, -0.9); itemAt(1.25, 0.8, -0.9); itemAt(-ix + 0.3, 0.94, 0.9); itemAt(-ix + 0.3, 0.94, 1.8); itemAt(ix - 0.22, 0.99, 1.55); itemAt(ix - 0.22, 1.44, 1.55);
  }
  const furn = new Mesh3D(merged(F), vcMat({ roughness: 0.8 })); furn.name = name + '-furniture'; root.add(furn);
  // tejado a dos aguas (prisma extruido)
  const rh = 1.4, prism = Geometry3D.extrude([[-w / 2 - 0.35, 0], [w / 2 + 0.35, 0], [0, rh]], d + 0.6);
  // el perfil (x, z) se extruye en Y: se gira -90º en X para que el perfil quede en vertical y la extrusión a lo largo de Z
  const rp = colored(prism, roof); rp.applyMat4(new Mat4().compose(new Vec3(0, h, (d + 0.6) / 2), new Quat().setFromEuler(-Math.PI / 2, 0, 0), new Vec3(1, 1, 1)));
  const roofMesh = new Mesh3D(rp, vcMat({ roughness: 0.8 })); roofMesh.name = name + '-roof'; root.add(roofMesh);
  // techo interior (para que de dentro no se vea el tejado hueco)
  const ceil = new Mesh3D(colored(Geometry3D.box(w - 2 * t, 0.06, d - 2 * t), 0xf1ece0), vcMat({ roughness: 0.95 })); ceil.name = name + '-ceiling'; ceil.position.set(0, h - 0.03, 0); root.add(ceil);
  root.userData = { width: w, depth: d, height: h, door: { x: 0, z: d / 2, width: doorW, height: doorH }, windows, items };
  return root;
}

/* --------------------------------------------------------------- vegetación */
function buildTree(name, kind) {
  const root = new Group3D(); root.name = name;
  let P;
  if (kind === 'pine') P = [part(Geometry3D.cylinder(0.14, 0.2, 1.2, 8), 0x6b4a2b, [0, 0.6, 0]), part(Geometry3D.cone(1.2, 1.6, 10), 0x2f6b3a, [0, 1.8, 0]), part(Geometry3D.cone(0.95, 1.4, 10), 0x357a42, [0, 2.6, 0]), part(Geometry3D.cone(0.65, 1.2, 10), 0x3b8a4b, [0, 3.3, 0])];
  else if (kind === 'bush') P = [part(Geometry3D.sphere(0.6, 10, 8), 0x4f8f3a, [0, 0.45, 0], null, [1.2, 0.8, 1]), part(Geometry3D.sphere(0.45, 10, 8), 0x5da244, [0.4, 0.55, 0.1])];
  else if (kind === 'rock') P = [part(Geometry3D.sphere(0.7, 7, 5), 0x8a8a86, [0, 0.35, 0], [10, 20, 5], [1.3, 0.7, 1])];
  else P = [part(Geometry3D.cylinder(0.16, 0.24, 1.6, 8), 0x6b4a2b, [0, 0.8, 0]), part(Geometry3D.sphere(1.0, 10, 8), 0x3d8b3d, [0, 2.2, 0]), part(Geometry3D.sphere(0.7, 10, 8), 0x4aa04a, [0.5, 2.6, 0.2]), part(Geometry3D.sphere(0.65, 10, 8), 0x378237, [-0.45, 2.5, -0.25])];
  const m = new Mesh3D(merged(P), vcMat({ roughness: 0.95, flatShading: kind === 'rock' })); m.name = name; root.add(m);
  return root;
}

/* ------------------------------------------------ texturas procedurales (RGBA) */
function woodTexture(size) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const plank = Math.floor(x / (size / 4)), edge = (x % (size / 4)) < 2 || (y % (size / 2)) < 1;
    const grain = Math.sin((y * 0.35 + plank * 13) + Math.sin(x * 0.15 + plank) * 2) * 0.5 + 0.5, border = x < 6 || x >= size - 6 || y < 6 || y >= size - 6;
    let r = 150 + grain * 50 + plank * 6, g = 100 + grain * 35 + plank * 4, b = 55 + grain * 20;
    if (edge) { r *= 0.6; g *= 0.6; b *= 0.6; }
    if (border) { r = 92; g = 64; b = 36; }
    const o = (y * size + x) * 4; d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
  }
  return new UG.Texture(new UG.TextureSource({ data: d, width: size, height: size }, { width: size, height: size, label: 'wood' }));
}
function normalTexture(size) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const gx = (x % (size / 4)) < 2 ? -0.6 : ((x % (size / 4)) > size / 4 - 3 ? 0.6 : 0), gy = Math.sin(y * 0.35 + Math.floor(x / (size / 4)) * 13) * 0.12;
    const l = Math.hypot(gx, gy, 1), o = (y * size + x) * 4;
    d[o] = (gx / l * 0.5 + 0.5) * 255; d[o + 1] = (gy / l * 0.5 + 0.5) * 255; d[o + 2] = (1 / l * 0.5 + 0.5) * 255; d[o + 3] = 255;
  }
  return new UG.Texture(new UG.TextureSource({ data: d, width: size, height: size }, { width: size, height: size, label: 'wood-normal' }));
}

/* ======================================================================= main */
console.log('Generando modelos en ' + OUT);
const human = buildCharacter({ name: 'humanoid', w: 1, d: 1, head: 1, limb: 1, skin: 0xf1c27d, skinArm: 0xf1c27d, hair: 0x3b2a1a, eye: 0x1a1a1a, shirt: 0x2f6fd0, sleeve: 0x2f6fd0, pants: 0x3b3b52, shoes: 0x2a1d12, glove: 0xf1c27d });
save('humanoid', human.root, humanoidClips(0.95));
const robot = buildCharacter({ name: 'robot', w: 1.25, d: 1.2, head: 1.15, limb: 1.25, skin: 0x9aa3ad, skinArm: 0x7c8590, hair: 0xd62828, eye: 0xff2d2d, shirt: 0x5b646e, sleeve: 0x6c757d, pants: 0x495057, shoes: 0x343a40, glove: 0x343a40,
  extra: P => { P.push(['chest', [0, 1.36, 0.14, 0.2, 0.12, 0.03], 0xffb703]); P.push(['head', [0, 2.0, 0, 0.03, 0.2, 0.03], 0xadb5bd]); } });
save('robot', robot.root, humanoidClips(0.95));
const hero = buildCharacter({ name: 'hero', w: 0.95, d: 0.95, head: 1.35, limb: 0.9, skin: 0xe8a15a, skinArm: 0xe8a15a, hair: 0xd9480f, eye: 0x1b4332, shirt: 0xf1f3f5, sleeve: 0xe8a15a, pants: 0x1971c2, shoes: 0xc92a2a, glove: 0xf8f9fa });
save('hero', hero.root, humanoidClips(0.95));

save('car', buildCar('car', 0xd62828, 0xd62828));
save('police', buildCar('police', 0xf8f9fa, 0x212529, P => { P.push(part(Geometry3D.box(0.5, 0.12, 0.25), 0x1c7ed6, [0.3, 1.37, -0.25]), part(Geometry3D.box(0.5, 0.12, 0.25), 0xe03131, [-0.3, 1.37, -0.25]), part(Geometry3D.box(1.82, 0.12, 1.2), 0x212529, [0, 0.62, 0.2])); }));
save('taxi', buildCar('taxi', 0xfcc419, 0xfcc419, P => { P.push(part(Geometry3D.box(0.6, 0.2, 0.3), 0x212529, [0, 1.41, -0.25])); }));
save('kart', (() => { const r = buildCar('kart', 0x2b8a3e, 0x2b8a3e); r.children[0].scale.set(0.7, 0.55, 0.6); r.children.slice(1).forEach(w => { w.position.x *= 0.8; w.position.z *= 0.62; }); return r; })());

save('house', buildHouse('house', 0xe9d8a6, 0xae2012, 6, 6, 3, 'house'));
save('shop', buildHouse('shop', 0xa8dadc, 0x264653, 8, 6, 3.4, 'shop'));
save('tree', buildTree('tree', 'tree')); save('pine', buildTree('pine', 'pine')); save('bush', buildTree('bush', 'bush')); save('rock', buildTree('rock', 'rock'));

const crate = new Group3D(); crate.name = 'crate';
const cm = new Mesh3D(Geometry3D.box(1, 1, 1), new StandardMaterial({ name: 'wood', map: woodTexture(128), normalMap: normalTexture(128), roughness: 0.8 })); cm.name = 'crate'; cm.position.y = 0.5; crate.add(cm);
save('crate', crate);

const gunParts = (big) => [part(Geometry3D.box(0.08, 0.12, big ? 0.7 : 0.22), 0x2b2b2b, [0, 0, big ? 0.15 : 0.05]), part(Geometry3D.box(0.07, big ? 0.16 : 0.14, 0.09), 0x4a3423, [0, -0.1, big ? -0.12 : -0.04], [-15, 0, 0]),
  part(Geometry3D.cylinder(0.022, 0.022, big ? 0.5 : 0.12, 8), 0x111111, [0, 0.02, big ? 0.72 : 0.22], [90, 0, 0])].concat(big ? [part(Geometry3D.box(0.06, 0.1, 0.25), 0x4a3423, [0, -0.02, -0.33]), part(Geometry3D.box(0.05, 0.05, 0.18), 0x111111, [0, 0.09, 0.05])] : []);
[['rifle', true], ['pistol', false]].forEach(([n, big]) => { const g = new Group3D(); g.name = n; const m = new Mesh3D(merged(gunParts(big)), vcMat({ roughness: 0.4, metalness: 0.5 })); m.name = n; g.add(m); const muzzle = new Node3D(); muzzle.name = 'muzzle'; muzzle.position.set(0, 0.02, big ? 0.98 : 0.3); g.add(muzzle); save(n, g); });


/* ------------------------------------------------ armas nuevas y objetos para recoger */
function gun(name, P, muzzleZ) { const g = new Group3D(); g.name = name; const m = new Mesh3D(merged(P), vcMat({ roughness: 0.4, metalness: 0.5 })); m.name = name; g.add(m); const mz = new Node3D(); mz.name = 'muzzle'; mz.position.set(0, 0.02, muzzleZ); g.add(mz); save(name, g); }
const BLK = 0x2b2b2b, MET = 0x111111, WOOD = 0x6b4526, OLV = 0x4b5320;
gun('smg', [part(Geometry3D.box(0.07, 0.11, 0.36), BLK, [0, 0, 0.08]), part(Geometry3D.box(0.05, 0.2, 0.05), MET, [0, -0.14, 0.12]), part(Geometry3D.box(0.06, 0.13, 0.07), BLK, [0, -0.1, -0.04], [-15, 0, 0]),
  part(Geometry3D.cylinder(0.018, 0.018, 0.14, 8), MET, [0, 0.02, 0.32], [90, 0, 0]), part(Geometry3D.box(0.04, 0.05, 0.18), BLK, [0, 0.01, -0.18]), part(Geometry3D.box(0.02, 0.03, 0.05), MET, [0, 0.07, 0.02])], 0.4);
gun('shotgun', [part(Geometry3D.cylinder(0.024, 0.024, 0.72, 10), MET, [0, 0.03, 0.42], [90, 0, 0]), part(Geometry3D.cylinder(0.02, 0.02, 0.6, 10), MET, [0, -0.02, 0.38], [90, 0, 0]),
  part(Geometry3D.box(0.065, 0.1, 0.3), BLK, [0, 0, 0.0]), part(Geometry3D.box(0.07, 0.07, 0.2), WOOD, [0, -0.02, 0.36]), part(Geometry3D.box(0.06, 0.13, 0.34), WOOD, [0, -0.05, -0.3], [8, 0, 0])], 0.8);
gun('sniper', [part(Geometry3D.cylinder(0.02, 0.02, 0.85, 10), MET, [0, 0.02, 0.62], [90, 0, 0]), part(Geometry3D.box(0.07, 0.11, 0.5), OLV, [0, 0, 0.05]), part(Geometry3D.box(0.06, 0.14, 0.38), OLV, [0, -0.04, -0.38], [6, 0, 0]),
  part(Geometry3D.cylinder(0.032, 0.032, 0.34, 12), MET, [0, 0.1, 0.08], [90, 0, 0]), part(Geometry3D.cylinder(0.04, 0.04, 0.04, 12), MET, [0, 0.1, 0.26], [90, 0, 0]), part(Geometry3D.cylinder(0.04, 0.04, 0.04, 12), MET, [0, 0.1, -0.1], [90, 0, 0]),
  part(Geometry3D.box(0.04, 0.12, 0.05), MET, [0, -0.1, 0.1]), part(Geometry3D.box(0.02, 0.1, 0.02), MET, [0.03, -0.1, 0.55]), part(Geometry3D.box(0.02, 0.1, 0.02), MET, [-0.03, -0.1, 0.55])], 1.06);
function item(name, P, o) { const g = new Group3D(); g.name = name; const m = new Mesh3D(merged(P), vcMat(Object.assign({ roughness: 0.6 }, o || {}))); m.name = name; g.add(m); save(name, g); }
item('apple', [part(Geometry3D.sphere(0.075, 14, 10), 0xd62828, [0, 0.075, 0], null, [1, 0.92, 1]), part(Geometry3D.cylinder(0.006, 0.008, 0.04, 6), 0x5c3b1e, [0, 0.16, 0]), part(Geometry3D.sphere(0.02, 6, 4), 0x2f9e44, [0.018, 0.165, 0], null, [1.6, 0.3, 0.8])], { roughness: 0.35 });
item('bread', [part(Geometry3D.capsule(0.06, 0.16, 10, 6), 0xc68642, [0, 0.06, 0], [0, 0, 90], [1, 1, 1.1]), ...[-0.06, 0, 0.06].map((x) => part(Geometry3D.box(0.012, 0.02, 0.09), 0xe0b27a, [x, 0.115, 0], [0, 25, 0]))], { roughness: 0.9 });
item('water', [part(Geometry3D.cylinder(0.035, 0.035, 0.2, 12), 0x74c0fc, [0, 0.1, 0]), part(Geometry3D.cylinder(0.018, 0.03, 0.04, 12), 0x74c0fc, [0, 0.22, 0]), part(Geometry3D.cylinder(0.016, 0.016, 0.02, 10), 0x1c7ed6, [0, 0.25, 0]), part(Geometry3D.cylinder(0.036, 0.036, 0.06, 12), 0x1971c2, [0, 0.1, 0])], { roughness: 0.15 });
item('soda', [part(Geometry3D.cylinder(0.033, 0.033, 0.12, 14), 0xc92a2a, [0, 0.06, 0]), part(Geometry3D.cylinder(0.03, 0.033, 0.012, 14), 0xced4da, [0, 0.126, 0]), part(Geometry3D.cylinder(0.034, 0.034, 0.03, 14), 0xf8f9fa, [0, 0.06, 0])], { roughness: 0.25, metalness: 0.6 });
item('medkit', [part(Geometry3D.box(0.34, 0.14, 0.24), 0xf8f9fa, [0, 0.07, 0]), part(Geometry3D.box(0.2, 0.012, 0.06), 0xe03131, [0, 0.146, 0]), part(Geometry3D.box(0.06, 0.012, 0.2), 0xe03131, [0, 0.146, 0]), part(Geometry3D.box(0.12, 0.03, 0.03), 0x868e96, [0, 0.16, 0])]);
item('ammo', [part(Geometry3D.box(0.3, 0.14, 0.16), OLV, [0, 0.07, 0]), part(Geometry3D.box(0.31, 0.03, 0.17), 0x3b4219, [0, 0.12, 0]), part(Geometry3D.box(0.1, 0.05, 0.005), 0xffd43b, [0, 0.07, 0.083]), part(Geometry3D.box(0.12, 0.02, 0.03), 0x222222, [0, 0.15, 0])]);
item('grenade', [part(Geometry3D.sphere(0.05, 10, 8), 0x3a5a2a, [0, 0.06, 0], null, [1, 1.15, 1]), part(Geometry3D.cylinder(0.015, 0.015, 0.03, 8), 0x868e96, [0, 0.125, 0]), part(Geometry3D.box(0.012, 0.06, 0.02), 0x868e96, [0.03, 0.1, 0], [0, 0, -20])]);

const coin = new Group3D(); coin.name = 'coin';
coin.add(Object.assign(new Mesh3D(merged([part(Geometry3D.cylinder(0.3, 0.3, 0.06, 20), 0xffd43b, [0, 0, 0], [90, 0, 0]), part(Geometry3D.cylinder(0.2, 0.2, 0.07, 20), 0xfab005, [0, 0, 0], [90, 0, 0])]), vcMat({ metalness: 0.9, roughness: 0.3, emissive: 0x332200 })), { name: 'coin' }));
save('coin', coin, [AnimationClip3D.fromKeys('Spin', { coin: { rotationY: [[0, 0], [1.2, Math.PI * 2]], position: [[0, 0, 0, 0], [0.6, 0, 0.15, 0], [1.2, 0, 0, 0]] } })]);
const fruit = new Group3D(); fruit.name = 'fruit';
fruit.add(Object.assign(new Mesh3D(merged([part(Geometry3D.sphere(0.25, 12, 10), 0xff7b00, [0, 0, 0], null, [1, 1.1, 1]), part(Geometry3D.cylinder(0.02, 0.03, 0.1, 6), 0x5c940d, [0, 0.3, 0]), part(Geometry3D.sphere(0.07, 6, 5), 0x74b816, [0.05, 0.33, 0], null, [1.4, 0.4, 0.8])]), vcMat({ roughness: 0.45, emissive: 0x2a1000 })), { name: 'fruit' }));
save('fruit', fruit, [AnimationClip3D.fromKeys('Spin', { fruit: { rotationY: [[0, 0], [2, Math.PI * 2]], position: [[0, 0, 0, 0], [1, 0, 0.12, 0], [2, 0, 0, 0]] } })]);
const barrel = new Group3D(); barrel.name = 'barrel';
barrel.add(Object.assign(new Mesh3D(merged([part(Geometry3D.cylinder(0.4, 0.4, 1.1, 16), 0xc92a2a, [0, 0.55, 0]), part(Geometry3D.cylinder(0.42, 0.42, 0.06, 16), 0x495057, [0, 0.25, 0]), part(Geometry3D.cylinder(0.42, 0.42, 0.06, 16), 0x495057, [0, 0.85, 0])]), vcMat({ roughness: 0.5, metalness: 0.3 })), { name: 'barrel' }));
save('barrel', barrel);
const lamp = new Group3D(); lamp.name = 'lamp';
lamp.add(Object.assign(new Mesh3D(merged([part(Geometry3D.cylinder(0.07, 0.1, 4.2, 8), 0x343a40, [0, 2.1, 0]), part(Geometry3D.box(0.12, 0.1, 1.1), 0x343a40, [0, 4.2, 0.5]), part(Geometry3D.box(0.34, 0.16, 0.5), 0x212529, [0, 4.12, 1.0])]), vcMat({ metalness: 0.6, roughness: 0.4 })), { name: 'post' }));
lamp.add(Object.assign(new Mesh3D(colored(Geometry3D.box(0.3, 0.04, 0.44), 0xfff3bf, false), vcMat({ emissive: 0xffe8a3, emissiveIntensity: 3 })), { name: 'bulb' }));
lamp.children[1].position.set(0, 4.03, 1.0);
const pl = new UG.PointLight(0xffe8a3, 4, 9); pl.name = 'light'; pl.position.set(0, 3.8, 1.0); lamp.add(pl);
save('lamp', lamp);
const fence = new Group3D(); fence.name = 'fence';
fence.add(Object.assign(new Mesh3D(merged([0, 1, 2, 3].map(i => part(Geometry3D.box(0.1, 1, 0.1), 0x8d6e4c, [-0.9 + i * 0.6, 0.5, 0])).concat([part(Geometry3D.box(2, 0.1, 0.06), 0x9c7b58, [0, 0.75, 0]), part(Geometry3D.box(2, 0.1, 0.06), 0x9c7b58, [0, 0.35, 0])])), vcMat()), { name: 'fence' }));
save('fence', fence);
const flag = new Group3D(); flag.name = 'flag';
const pole = new Mesh3D(colored(Geometry3D.cylinder(0.05, 0.05, 3, 8), 0xdee2e6), vcMat({ metalness: 0.6 })); pole.name = 'pole'; pole.position.y = 1.5; flag.add(pole);
const cloth = new Mesh3D(colored(Geometry3D.box(1.0, 0.6, 0.03), 0x2f9e44), vcMat({ side: 'double' })); cloth.name = 'cloth'; cloth.position.set(0.5, 2.65, 0); flag.add(cloth);
save('flag', flag, [AnimationClip3D.fromKeys('Wave', { cloth: { rotationY: [[0, -0.15], [0.5, 0.15], [1, -0.15]] } })]);
console.log('Listo.');
