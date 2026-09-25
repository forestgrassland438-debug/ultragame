#!/usr/bin/env node
/**
 * UltraCore: ensambla el núcleo WebAssembly SIMD de UltraGame sin dependencias externas.
 * Emite src/wasm_core.js (bytes en base64, embebidos en el bundle => funciona también en file://).
 * El código equivalente en texto WAT está en tools/wasm/ultracore.wat (documentación).
 *
 * Exporta:
 *   memory                      memoria lineal compartida con JS (vistas Float32Array sin copia)
 *   integrate(px,py,vx,vy,life,count,dt,gxdt,gydt,damp)   integra 4 partículas por instrucción (f32x4)
 *   bounds(px,py,vx,vy,count,x0,y0,x1,y1,bounce)          rebote en rectángulo (f32x4 + select por máscara)
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* ------------------------- utilidades de codificación ------------------------- */
function uleb(n) { const out = []; do { let b = n & 0x7f; n >>>= 7; if (n !== 0) b |= 0x80; out.push(b); } while (n !== 0); return out; }
function sleb(n) { const out = []; let more = true; while (more) { let b = n & 0x7f; n >>= 7; if ((n === 0 && (b & 0x40) === 0) || (n === -1 && (b & 0x40) !== 0)) more = false; else b |= 0x80; out.push(b); } return out; }
function str(s) { const b = Buffer.from(s, 'utf8'); return [...uleb(b.length), ...b]; }
function vec(items) { return [...uleb(items.length), ...items.flat()]; }
function section(id, bytes) { return [id, ...uleb(bytes.length), ...bytes]; }
const T = { i32: 0x7f, f32: 0x7d, v128: 0x7b };

/* ------------------------------- opcodes -------------------------------------- */
const op = {
  get: (i) => [0x20, ...uleb(i)], set: (i) => [0x21, ...uleb(i)], tee: (i) => [0x22, ...uleb(i)],
  i32c: (v) => [0x41, ...sleb(v)], i32add: [0x6a], i32shl: [0x74], i32geu: [0x4f],
  block: [0x02, 0x40], loop: [0x03, 0x40], br: (d) => [0x0c, ...uleb(d)], brif: (d) => [0x0d, ...uleb(d)], end: [0x0b],
  simd: (code, ...imm) => [0xfd, ...uleb(code), ...imm],
};
const v128load = op.simd(0x00, 4, 0);   // align 2^4, offset 0
const v128store = op.simd(0x0b, 4, 0);
const f32x4splat = op.simd(0x13);
const f32x4add = op.simd(0xe4), f32x4sub = op.simd(0xe5), f32x4mul = op.simd(0xe6), f32x4min = op.simd(0xe8), f32x4max = op.simd(0xe9);
const f32x4lt = op.simd(0x43), f32x4gt = op.simd(0x44);
const f32x4neg = op.simd(0xe1);
const v128bitselect = op.simd(0x52);

/* ------------------------------ integrate ------------------------------------- */
// params: 0 px 1 py 2 vx 3 vy 4 life (i32 ptr bytes) 5 count (i32) 6 dt 7 gxdt 8 gydt 9 damp (f32)
// locals: 10 off 11 end (i32) | 12 dtv 13 gxv 14 gyv 15 dampv 16 nvx 17 nvy (v128)
function addr(ptrLocal) { return [...op.get(ptrLocal), ...op.get(10), ...op.i32add]; }
const integrateBody = [
  ...op.get(6), ...f32x4splat, ...op.set(12),
  ...op.get(7), ...f32x4splat, ...op.set(13),
  ...op.get(8), ...f32x4splat, ...op.set(14),
  ...op.get(9), ...f32x4splat, ...op.set(15),
  ...op.get(5), ...op.i32c(2), ...op.i32shl, ...op.set(11),
  ...op.i32c(0), ...op.set(10),
  ...op.block, ...op.loop,
  ...op.get(10), ...op.get(11), ...op.i32geu, ...op.brif(1),
  // vx = (vx + gx*dt) * damp
  ...addr(2), ...addr(2), ...v128load, ...op.get(13), ...f32x4add, ...op.get(15), ...f32x4mul, ...op.tee(16), ...v128store,
  // vy = (vy + gy*dt) * damp
  ...addr(3), ...addr(3), ...v128load, ...op.get(14), ...f32x4add, ...op.get(15), ...f32x4mul, ...op.tee(17), ...v128store,
  // px += vx * dt
  ...addr(0), ...addr(0), ...v128load, ...op.get(16), ...op.get(12), ...f32x4mul, ...f32x4add, ...v128store,
  // py += vy * dt
  ...addr(1), ...addr(1), ...v128load, ...op.get(17), ...op.get(12), ...f32x4mul, ...f32x4add, ...v128store,
  // life -= dt
  ...addr(4), ...addr(4), ...v128load, ...op.get(12), ...f32x4sub, ...v128store,
  ...op.get(10), ...op.i32c(16), ...op.i32add, ...op.set(10),
  ...op.br(0),
  ...op.end, ...op.end,
  ...op.end
];
const integrateLocals = vec([[...uleb(2), T.i32], [...uleb(6), T.v128]]);

/* -------------------------------- bounds -------------------------------------- */
// params: 0 px 1 py 2 vx 3 vy (ptr) 4 count (i32) 5 x0 6 y0 7 x1 8 y1 9 bounce (f32)
// locals: 10 off 11 end (i32) | 12 X0 13 Y0 14 X1 15 Y1 16 B 17 p 18 v 19 mlo 20 mhi (v128)
function a2(ptr) { return [...op.get(ptr), ...op.get(10), ...op.i32add]; }
function axis(pPtr, vPtr, lo, hi) {
  return [
    ...a2(pPtr), ...v128load, ...op.set(17),
    ...a2(vPtr), ...v128load, ...op.set(18),
    // máscaras: p < lo, p > hi
    ...op.get(17), ...op.get(lo), ...f32x4lt, ...op.set(19),
    ...op.get(17), ...op.get(hi), ...f32x4gt, ...op.set(20),
    // p = clamp(p, lo, hi)
    ...a2(pPtr), ...op.get(17), ...op.get(lo), ...f32x4max, ...op.get(hi), ...f32x4min, ...v128store,
    // v = (mlo|mhi) ? -v*bounce : v    => bitselect(-v*B, v, mask)
    ...a2(vPtr),
    ...op.get(18), ...f32x4neg, ...op.get(16), ...f32x4mul,
    ...op.get(18),
    ...op.get(19), ...op.get(20), ...op.simd(0x50), // v128.or
    ...v128bitselect, ...v128store,
  ];
}
const boundsBody = [
  ...op.get(5), ...f32x4splat, ...op.set(12), ...op.get(6), ...f32x4splat, ...op.set(13),
  ...op.get(7), ...f32x4splat, ...op.set(14), ...op.get(8), ...f32x4splat, ...op.set(15),
  ...op.get(9), ...f32x4splat, ...op.set(16),
  ...op.get(4), ...op.i32c(2), ...op.i32shl, ...op.set(11),
  ...op.i32c(0), ...op.set(10),
  ...op.block, ...op.loop,
  ...op.get(10), ...op.get(11), ...op.i32geu, ...op.brif(1),
  ...axis(0, 2, 12, 14),
  ...axis(1, 3, 13, 15),
  ...op.get(10), ...op.i32c(16), ...op.i32add, ...op.set(10),
  ...op.br(0),
  ...op.end, ...op.end,
  ...op.end
];
const boundsLocals = vec([[...uleb(2), T.i32], [...uleb(9), T.v128]]);

/* ------------------------------- módulo ---------------------------------------- */
function funcType(params, results) { return [0x60, ...vec(params.map((p) => [p])), ...vec(results.map((r) => [r]))]; }
const types = vec([
  funcType([T.i32, T.i32, T.i32, T.i32, T.i32, T.i32, T.f32, T.f32, T.f32, T.f32], []),
  funcType([T.i32, T.i32, T.i32, T.i32, T.i32, T.f32, T.f32, T.f32, T.f32, T.f32], [])
]);
const funcs = vec([uleb(0), uleb(1)]);
const memory = vec([[0x00, ...uleb(16)]]); // 16 páginas = 1 MiB iniciales, crece bajo demanda
const exportsSec = vec([[...str('memory'), 0x02, ...uleb(0)], [...str('integrate'), 0x00, ...uleb(0)], [...str('bounds'), 0x00, ...uleb(1)]]);
function codeEntry(locals, body) { const b = [...locals, ...body]; return [...uleb(b.length), ...b]; }
const code = vec([codeEntry(integrateLocals, integrateBody), codeEntry(boundsLocals, boundsBody)]);
const wasmModule = Buffer.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  ...section(1, types), ...section(3, funcs), ...section(5, memory), ...section(7, exportsSec), ...section(10, code)
]);

/* ------------------------ validación numérica vs JS ---------------------------- */
async function verify() {
  if (!WebAssembly.validate(wasmModule)) throw new Error('módulo WASM inválido');
  const { instance } = await WebAssembly.instantiate(wasmModule, {});
  const e = instance.exports, N = 1024, B = N * 4;
  const mem = new Float32Array(e.memory.buffer);
  const P = { px: 1024, py: 1024 + B, vx: 1024 + 2 * B, vy: 1024 + 3 * B, life: 1024 + 4 * B };
  const view = (k) => new Float32Array(e.memory.buffer, P[k], N);
  const ref = {};
  for (const k of Object.keys(P)) { const v = view(k); for (let i = 0; i < N; i++) v[i] = Math.fround(Math.sin(i * 12.9898 + k.length) * 100); ref[k] = Float32Array.from(v); }
  const dt = 1 / 60, gx = 0.5, gy = 9.8 * dt, damp = 0.99;
  e.integrate(P.px, P.py, P.vx, P.vy, P.life, N, dt, gx, gy, damp);
  let maxErr = 0;
  for (let i = 0; i < N; i++) {
    const nvx = Math.fround(Math.fround(ref.vx[i] + gx) * damp), nvy = Math.fround(Math.fround(ref.vy[i] + gy) * damp);
    const epx = Math.fround(ref.px[i] + Math.fround(nvx * dt)), epy = Math.fround(ref.py[i] + Math.fround(nvy * dt)), el = Math.fround(ref.life[i] - dt);
    maxErr = Math.max(maxErr, Math.abs(view('vx')[i] - nvx), Math.abs(view('vy')[i] - nvy), Math.abs(view('px')[i] - epx), Math.abs(view('py')[i] - epy), Math.abs(view('life')[i] - el));
  }
  if (maxErr > 1e-4) throw new Error('integrate difiere de JS: ' + maxErr);
  // bounds
  const px = view('px'), vx = view('vx');
  px[0] = -5; vx[0] = -10; px[1] = 50; vx[1] = 3; px[2] = 900; vx[2] = 7;
  e.bounds(P.px, P.py, P.vx, P.vy, N, 0, -1e9, 800, 1e9, 0.5);
  if (px[0] !== 0 || vx[0] !== 5 || px[1] !== 50 || vx[1] !== 3 || px[2] !== 800 || vx[2] !== -3.5) throw new Error('bounds incorrecto: ' + [px[0], vx[0], px[1], vx[1], px[2], vx[2]]);
  void mem;
  return maxErr;
}

verify().then((err) => {
  const b64 = wasmModule.toString('base64');
  const out = '/* Generado por tools/wasm/build-core.js — NO editar a mano. UltraCore WASM SIMD (' + wasmModule.length + ' bytes). */\nWasm.bytes = \'' + b64 + '\';\n';
  fs.writeFileSync(path.join(__dirname, '..', '..', 'src', 'wasm_core.js'), out);
  console.log('UltraCore OK: ' + wasmModule.length + ' bytes, error máx vs JS = ' + err);
}).catch((e) => { console.error('UltraCore FALLÓ:', e.message); process.exit(1); });
