#!/usr/bin/env node
/**
 * UltraGame build script (sin dependencias).
 * Concatena los módulos de /src dentro de un envoltorio UMD y genera:
 *   dist/ultragame.js      -> <script> clásico (window.UltraGame / window.UG), CommonJS y AMD
 *   dist/ultragame.esm.js  -> import UG from './ultragame.esm.js'
 *   dist/ultragame.d.ts    -> tipos TypeScript (copiados de types/)
 * Además valida la sintaxis del resultado y verifica que no se use eval/new Function.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const ORDER = [
  'core.js',
  'math.js',
  'earcut.js',
  'inflate.js',
  'textures.js',
  'display.js',
  'graphics.js',
  'text.js',
  'particles.js',
  'render_base.js',
  'render_webgl.js',
  'render_webgpu.js',
  'render_canvas.js',
  'filters.js',
  'input.js',
  'audio.js',
  'loader.js',
  'tilemap.js',
  'physics.js',
  'physics_rigid.js',
  'tweens.js',
  'animation.js',
  'camera.js',
  'ui.js',
  'scene.js',
  'lights2d.js',
  'scale.js',
  'game.js',
  'web3.js',
  'debug.js',
  '3d_math.js',
  '3d_core.js',
  '3d_shaders.js',
  '3d_renderer.js',
  '3d_webgpu.js',
  '3d_view.js',
  '3d_anim.js',
  '3d_gltf.js',
  '3d_obj.js',
  '3d_export.js',
  '3d_physics.js',
  '3d_controls.js',
  '3d_extras.js',
  '3d_world.js',
  'wasm.js',
  'wasm_core.js',
  'exports.js'
];

function build() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  let body = '';
  for (const f of ORDER) {
    const p = path.join(SRC, f);
    if (!fs.existsSync(p)) { console.warn('  (omitido, no existe) ' + f); continue; }
    const code = fs.readFileSync(p, 'utf8');
    body += '\n/* ======================= ' + f + ' ======================= */\n' + code + '\n';
  }
  body = body.replace(/__VERSION__/g, pkg.version);

  const banner = '/*!\n * UltraGame v' + pkg.version + ' - Motor 2D y 3D de alto rendimiento (WebGPU / WebGL2 / WebGL / Canvas)\n * (c) ' + new Date().getFullYear() + ' UltraGame - Licencia MIT\n */\n';

  const umd = banner +
    '(function (root, factory) {\n' +
    '  if (typeof define === "function" && define.amd) { define([], factory); }\n' +
    '  else if (typeof module === "object" && module.exports) { module.exports = factory(); }\n' +
    '  else { var UG = factory(); root.UltraGame = UG; root.UG = UG; }\n' +
    '}(typeof self !== "undefined" ? self : this, function () {\n"use strict";\n' +
    body + '\nreturn UG;\n}));\n';

  const esm = banner + 'const UG = (function () {\n"use strict";\n' + body + '\nreturn UG;\n})();\nexport default UG;\nexport { UG };\n';

  // Validación de sintaxis
  try { new vm.Script(umd, { filename: 'ultragame.js' }); }
  catch (e) { console.error('ERROR de sintaxis en el bundle:', e.message); console.error(e.stack.split('\n').slice(0, 6).join('\n')); process.exit(1); }

  // Reglas de seguridad: el motor no debe usar evaluación dinámica de código
  const banned = [/\beval\s*\(/, /new\s+Function\s*\(/, /\.innerHTML\s*=/, /document\.write\s*\(/];
  for (const re of banned) {
    const m = body.match(re);
    if (m) { console.error('ERROR de seguridad: patrón prohibido encontrado en el motor: ' + m[0]); process.exit(1); }
  }

  if (!fs.existsSync(DIST)) fs.mkdirSync(DIST);
  fs.writeFileSync(path.join(DIST, 'ultragame.js'), umd);
  fs.writeFileSync(path.join(DIST, 'ultragame.esm.js'), esm);
  // tipos TypeScript (escritos a mano en types/): se copian con la versión actual
  const types = path.join(ROOT, 'types', 'ultragame.d.ts');
  if (fs.existsSync(types)) fs.writeFileSync(path.join(DIST, 'ultragame.d.ts'), '// UltraGame ' + pkg.version + '\n' + fs.readFileSync(types, 'utf8'));
  const kb = (Buffer.byteLength(umd) / 1024).toFixed(1);
  const lines = umd.split('\n').length;
  console.log('UltraGame ' + pkg.version + ' -> dist/ultragame.js (' + kb + ' KB, ' + lines + ' líneas)');
}

build();
if (process.argv.includes('--watch')) {
  console.log('Observando cambios en src/ ...');
  let t = null;
  fs.watch(SRC, () => { clearTimeout(t); t = setTimeout(() => { try { build(); } catch (e) { console.error(e); } }, 120); });
}
