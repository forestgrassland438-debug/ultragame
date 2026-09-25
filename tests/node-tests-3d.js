/* Pruebas 3D sin navegador: matemáticas, escena, geometría, shaders, animación, glTF/GLB (incluida la
 * validación de archivos maliciosos), OBJ, exportador, PNG, física y ausencia de fugas (contadores Debug). */
'use strict';
const zlib = require('zlib');

module.exports = async function (UG, h) {
  const { test, testAsync, A, section } = h;
  const { Vec3, Quat, Euler, Mat4, Frustum, Sphere, Box3, Ray, Plane, Geometry3D, Mesh3D, Group3D, Node3D, StandardMaterial } = UG;
  const near3 = (a, b, eps, m) => { A.near(a.x, b.x, eps, m + '.x'); A.near(a.y, b.y, eps, m + '.y'); A.near(a.z, b.z, eps, m + '.z'); };
  const live = () => UG.Debug.snapshot();
  const leakCheck = (before, keys) => { const d = UG.Debug.diff(before, live()); keys.forEach((k) => { if (d[k]) throw new Error('fuga de ' + k + ': ' + d[k]); }); };

  section('RNG: float con rango (compatible)');
  test('RNG.float(), float(max) y float(min, max) respetan sus rangos y la secuencia', () => {
    const a = new UG.RNG('x'), b = new UG.RNG('x');
    for (let i = 0; i < 2000; i++) { const f = a.float(), g = b.float(-3, 5); A.ok(f >= 0 && f < 1, 'float ' + f); A.ok(g >= -3 && g < 5, 'rango ' + g); A.near(g, -3 + 8 * f, 1e-9, 'misma secuencia'); }
    const c = new UG.RNG(1); for (let j = 0; j < 500; j++) { const h = c.float(10); A.ok(h >= 0 && h < 10); }
  });

  section('3D: matemáticas');
  test('Mat4 compose/decompose ida y vuelta', () => {
    const p = new Vec3(1, -2, 3), q = new Quat().setFromEuler(0.3, -1.1, 0.7), s = new Vec3(2, 0.5, 3);
    const m = new Mat4().compose(p, q, s), p2 = new Vec3(), q2 = new Quat(), s2 = new Vec3();
    m.decompose(p2, q2, s2); near3(p2, p, 1e-5, 'pos'); near3(s2, s, 1e-5, 'escala');
    A.ok(Math.abs(Math.abs(q.dot(q2)) - 1) < 1e-5, 'cuaternión');
  });
  test('Mat4 inversa: M·M⁻¹ = I (incluida escala no uniforme)', () => {
    const m = new Mat4().compose(new Vec3(5, 1, -3), new Quat().setFromEuler(1, 2, 0.5), new Vec3(3, 1, 0.2)), inv = new Mat4().invertFrom(m), I = new Mat4().multiplyMatrices(m, inv);
    for (let i = 0; i < 16; i++) A.near(I.e[i], i % 5 === 0 ? 1 : 0, 1e-5, 'e' + i);
    const sing = new Mat4().fromArray(new Array(16).fill(0)).invert(); A.ok(Array.from(sing.e).every((v) => v === 0), 'singular -> ceros (sin NaN)');
  });
  test('Euler YXZ/XYZ <-> cuaternión <-> matriz', () => {
    ['YXZ', 'XYZ'].forEach((o) => {
      const e = new Euler(0.4, -0.9, 0.25, o), q = new Quat().setFromEuler(e.x, e.y, e.z, o), m = new Mat4().makeRotationFromQuat(q), e2 = new Euler().setFromRotationMatrix(m, o);
      A.near(e2.x, 0.4, 1e-5, o + ' x'); A.near(e2.y, -0.9, 1e-5, o + ' y'); A.near(e2.z, 0.25, 1e-5, o + ' z');
    });
  });
  test('Quat slerp y camino corto', () => {
    const a = new Quat(), b = new Quat().setFromAxisAngle(new Vec3(0, 1, 0), Math.PI / 2), c = a.clone().slerp(b, 0.5);
    A.near(c.angleTo(a), Math.PI / 4, 1e-5); const nb = new Quat(-b.x, -b.y, -b.z, -b.w); A.near(a.clone().slerp(nb, 0.5).angleTo(a), Math.PI / 4, 1e-5, 'hemisferio opuesto');
  });
  test('Proyección perspectiva: near -> -1, far -> +1; lookAt mira a -Z', () => {
    const P = new Mat4().perspective(Math.PI / 3, 1.5, 0.5, 100);
    A.near(new Vec3(0, 0, -0.5).applyMat4(P).z, -1, 1e-5); A.near(new Vec3(0, 0, -100).applyMat4(P).z, 1, 1e-4);
    const cam = new UG.PerspectiveCamera(60, 1, 0.1, 100); cam.position.set(3, 4, 5); cam.lookAt(0, 0, 0);
    near3(cam.getWorldDirection(new Vec3()), new Vec3(-3, -4, -5).normalize(), 1e-5, 'dirección');
  });
  test('Frustum: esferas dentro/fuera y caja', () => {
    const cam = new UG.PerspectiveCamera(60, 1, 0.1, 50); cam.position.set(0, 0, 10); cam.updateMatrixWorld(); cam.updateView();
    A.ok(cam.frustum.intersectsSphere(new Sphere(new Vec3(0, 0, 0), 1))); A.ok(!cam.frustum.intersectsSphere(new Sphere(new Vec3(0, 0, 20), 1)), 'detrás');
    A.ok(!cam.frustum.intersectsSphere(new Sphere(new Vec3(50, 0, 0), 1)), 'a un lado'); A.ok(cam.frustum.intersectsSphere(new Sphere(new Vec3(0, 0, -39), 1)), 'cerca del far');
    A.ok(cam.frustum.intersectsBox(new Box3(new Vec3(-1, -1, -1), new Vec3(1, 1, 1))));
  });
  test('Ray: triángulo, caja, esfera y plano', () => {
    const r = new Ray(new Vec3(0.2, 0.2, 5), new Vec3(0, 0, -1));
    A.near(r.intersectTriangle(0, 0, 0, 1, 0, 0, 0, 1, 0), 5, 1e-6); A.eq(r.intersectTriangle(0, 0, 0, 0, 1, 0, 1, 0, 0, false), null, 'cara trasera');
    A.near(r.intersectBox(new Box3(new Vec3(-1, -1, -1), new Vec3(1, 1, 1))), 4, 1e-6); A.near(r.intersectSphere(new Sphere(new Vec3(0.2, 0.2, 0), 2)), 3, 1e-6);
    A.near(r.intersectPlane(new Plane(new Vec3(0, 0, 1), 0)), 5, 1e-6); A.eq(new Ray(new Vec3(5, 5, 5), new Vec3(0, 1, 0)).intersectSphere(new Sphere(new Vec3(), 1)), null);
  });
  test('Matriz normal con escala no uniforme', () => {
    const m = new Mat4().compose(new Vec3(), new Quat(), new Vec3(4, 1, 1)), nm = new Float32Array(12); m.normalMatrix12(nm, 0);
    // la normal (1,1,0)/√2 de una superficie escalada 4x en X debe inclinarse hacia Y
    const n = new Vec3(nm[0] + nm[4], nm[1] + nm[5], nm[2] + nm[6]).normalize(); A.ok(n.y > n.x * 3, 'normal corregida ' + JSON.stringify(n));
  });

  section('3D: escena y geometría');
  test('Jerarquía: mundo, ciclos prohibidos, find', () => {
    const a = new Group3D(), b = new Node3D(), c = new Node3D(); a.add(b); b.add(c); a.position.set(1, 0, 0); b.position.set(0, 2, 0); b.rotation.y = Math.PI / 2; c.position.set(0, 0, 3); a.updateMatrixWorld();
    near3(c.getWorldPosition(new Vec3()), new Vec3(4, 2, 0), 1e-5, 'posición');
    A.throws(() => c.add(a), 'ciclo'); c.name = 'x'; A.eq(a.getObjectByName('x'), c); a.destroy(); A.ok(c.destroyed);
  });
  test('Primitivas: tamaños, normales unitarias y límites', () => {
    const chk = (g, name) => { const n = g.attributes.normal.data; for (let i = 0; i < n.length; i += 3) A.near(Math.hypot(n[i], n[i + 1], n[i + 2]), 1, 1e-4, name + ' normal'); A.ok(!Array.from(g.attributes.position.data).some(isNaN), name + ' NaN'); g.dispose(); };
    const box = Geometry3D.box(2, 4, 6); A.eq(box.vertexCount, 24); A.eq(box.index.length, 36); const bb = box.getBoundingBox(); near3(bb.max, new Vec3(1, 2, 3), 1e-6, 'caja'); chk(box, 'box');
    const s = Geometry3D.sphere(2, 16, 8); A.near(s.getBoundingSphere().radius, 2, 1e-3); chk(s, 'sphere');
    ['plane', 'cylinder', 'cone', 'capsule', 'torus'].forEach((k) => chk(Geometry3D[k](), k));
    chk(Geometry3D.heightfield(10, 10, 8, 8, (x, z) => Math.sin(x) + z * 0.1), 'heightfield');
    chk(Geometry3D.extrude([[-1, -1], [1, -1], [1, 1], [-1, 1]], 2), 'extrude');
    A.throws(() => Geometry3D.extrude([[0, 0], [1, 0]], 1), 'extrude con 2 puntos');
  });
  test('Geometry3D.merge conserva colores, índices y aplica matrices', () => {
    const a = Geometry3D.box(1, 1, 1), b = Geometry3D.box(1, 1, 1), m = Geometry3D.merge([{ geometry: a, color: 0xff0000 }, { geometry: b, matrix: new Mat4().makeTranslation(5, 0, 0), color: 0x00ff00 }]);
    A.eq(m.vertexCount, 48); A.eq(m.index.length, 72); A.near(m.getBoundingBox().max.x, 5.5, 1e-6); A.near(m.attributes.color.data[0], 1, 1e-6); A.near(m.attributes.color.data[24 * 4 + 1], 1, 1e-6);
    A.ok(a.disposed && b.disposed, 'las fuentes sin mallas se liberan'); m.dispose();
    const before = live(), kept = Geometry3D.box(1), used = Geometry3D.box(1), mesh = new Mesh3D(used, null);
    kept.keep = true; Geometry3D.merge([kept, used, Geometry3D.sphere(1)]).dispose();
    A.ok(!kept.disposed && !used.disposed, 'no toca las que se usan o se conservan'); mesh.destroy(); kept.keep = false; kept.dispose();
    leakCheck(before, ['Geometry3D']);
  });
  test('Recuento de referencias: geometría compartida se libera con la última malla', () => {
    const before = live(), g = Geometry3D.box(1), m1 = new Mesh3D(g, null), m2 = m1.clone();
    A.eq(m2.geometry, g); m1.destroy(); A.ok(!g.disposed, 'aún en uso'); m2.destroy(); A.ok(g.disposed, 'liberada');
    leakCheck(before, ['Node3D', 'Geometry3D']);
    const k = Geometry3D.box(1); k.keep = true; new Mesh3D(k, null).destroy(); A.ok(!k.disposed, 'keep=true no se libera'); k.keep = false; k.dispose();
  });
  test('Material.set ignora claves peligrosas y cambia la variante', () => {
    const m = new StandardMaterial(JSON.parse('{"color":"#ff0000","__proto__":{"polluted":1},"constructor":{"x":1}}'));
    A.eq(m.color, 0xff0000); A.eq(({}).polluted, undefined); const k1 = m.featureKey; m.set({ unlit: true }); A.ok(m.featureKey !== k1);
    near3({ x: m.linearColor[0], y: m.linearColor[1], z: m.linearColor[2] }, new Vec3(1, 0, 0), 1e-6, 'lineal');
  });
  test('InstancedMesh3D: transformaciones, colores y límites', () => {
    const im = new UG.InstancedMesh3D(Geometry3D.box(1), null, 3); im.setTransformAt(0, new Vec3(10, 0, 0), 0, 1); im.setTransformAt(2, new Vec3(-10, 0, 0), Math.PI, 2); im.setColorAt(1, 0x00ff00);
    const b = im.getLocalBounds(); A.ok(b.radius >= 10, 'radio ' + b.radius); A.ok(im.useInstanceColor); im.setMatrixAt(99, new Mat4()); im.destroy();
  });
  test('Skeleton3D: en la pose de ligadura las matrices son identidad', () => {
    const root = new Group3D(), b0 = new Node3D(), b1 = new Node3D(); b1.position.set(0, 1, 0); root.add(b0); b0.add(b1); root.updateMatrixWorld();
    const ib = new Float32Array(32); ib.set(new Mat4().e, 0); ib.set(new Mat4().makeTranslation(0, -1, 0).e, 16);
    const sk = new UG.Skeleton3D([b0, b1], ib), mesh = new Mesh3D(Geometry3D.box(1), null); root.add(mesh); root.updateMatrixWorld(); sk.update(mesh.matrixWorld);
    for (let i = 0; i < 32; i++) A.near(sk.jointMatrices[i], i % 16 % 5 === 0 ? 1 : 0, 1e-6, 'j' + i);
    root.destroy();
  });

  section('3D: shaders');
  test('Todas las variantes GLSL/WGSL se generan (1ª/3ª pasada, 17 rasgos)', () => {
    const S = UG.Shader3D, L = S.frameLayout(4, 8, 4), keys = ['map', 'nrm', 'mr', 'em', 'ao', 'vcol', 'alphaTest', 'unlit', 'toon', 'fog', 'flat', 'double', 'skin', 'inst', 'instColor', 'recv', 'trans'];
    let n = 0;
    for (const pass of ['main', 'shadow', 'outline']) for (let mask = 0; mask < (1 << keys.length); mask += 331) {
      const f = { pass, key: 'k' }; keys.forEach((k, i) => { f[k] = !!(mask & (1 << i)); });
      const vs = S.glslVertex(f, L), fs = S.glslFragment(f, L, { webgl2: true, derivatives: true }), w = S.wgsl(f, L);
      A.ok(/void main\(\)/.test(vs) && /void main\(\)/.test(fs), 'main'); A.ok(/@vertex/.test(w) && /@fragment/.test(w), 'wgsl');
      if (pass === 'shadow') A.ok(!/-> @location\(0\) vec4f \{\n var base/.test(w), 'sombra sin color');
      n++;
    }
    A.ok(n > 400, 'variantes ' + n);
  });
  test('Disposición de uniformes: tamaños por límites de GPU', () => {
    const L = UG.Shader3D.frameLayout(4, 8, 4); A.eq(L.D0, 16); A.eq(L.NF, 16 + 8 + 16 + 12 + 5); const L2 = UG.Shader3D.frameLayout(2, 3, 1); A.ok(L2.NF < 64, 'cabe en GPUs pequeñas');
  });

  section('3D: animación');
  test('sampleTrack3D: LINEAR, STEP y CUBICSPLINE', () => {
    const lin = { path: 'position', stride: 3, times: new Float32Array([0, 1]), values: new Float32Array([0, 0, 0, 10, 20, 30]), interpolation: 'LINEAR', _last: 0 }, o = [0, 0, 0];
    UG.sampleTrack3D(lin, 0.25, o); A.near(o[0], 2.5, 1e-6); A.near(o[2], 7.5, 1e-6); UG.sampleTrack3D(lin, 5, o); A.eq(o[1], 20, 'después del final');
    const st = Object.assign({}, lin, { interpolation: 'STEP' }); UG.sampleTrack3D(st, 0.9, o); A.eq(o[0], 0);
    // spline con tangentes nulas: s=0.5 -> punto medio
    const cu = { path: 'position', stride: 3, times: new Float32Array([0, 2]), values: new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 0, 0, 0]), interpolation: 'CUBICSPLINE', _last: 0 };
    UG.sampleTrack3D(cu, 1, o); A.near(o[0], 2, 1e-6);
  });
  test('Mezclador: fundido cruzado, bucles y eventos', () => {
    const root = new Group3D(), n = new Node3D(); n.name = 'n'; root.add(n);
    const a = UG.AnimationClip3D.fromKeys('a', { n: { position: [[0, 0, 0, 0], [1, 10, 0, 0]] } }), b = UG.AnimationClip3D.fromKeys('b', { n: { position: [[0, 0, 5, 0], [1, 0, 5, 0]] } });
    const mx = new UG.AnimationMixer3D(root, [a, b]); let fin = 0, loops = 0; mx.on('finished', () => fin++); mx.on('loop', () => loops++);
    mx.play('a', { fade: 0 }); mx.update(0.5); A.near(n.position.x, 5, 1e-5);
    mx.play('b', { fade: 0.5 }); mx.update(0.25); A.ok(n.position.y > 0.5 && n.position.y < 5, 'mezcla ' + n.position.y); mx.update(0.5); A.near(n.position.y, 5, 1e-5, 'fundido terminado');
    mx.play('a', { fade: 0, loop: 'once' }); mx.update(2); A.eq(fin, 1); A.near(n.position.x, 10, 1e-5, 'se queda al final');
    mx.play('b', { fade: 0, loop: 'repeat' }); mx.update(3.5); A.ok(loops >= 3, 'loops ' + loops);
    A.eq(mx.play('noexiste'), null); root.destroy(); A.ok(mx.destroyed, 'se destruye con la raíz');
  });
  test('fromKeys: rotaciones grandes se subdividen (vuelta completa)', () => {
    const c = UG.AnimationClip3D.fromKeys('spin', { n: { rotationY: [[0, 0], [1, Math.PI * 2]] } }), tr = c.tracks[0], o = [0, 0, 0, 0];
    UG.sampleTrack3D(tr, 0.5, o); A.near(Math.abs(o[3]), 0, 1e-3, 'media vuelta = 180º');
  });

  section('3D: glTF / GLB (validación y seguridad)');
  const glbOf = (json, bin) => UG.GLTFExporter.toGLB(json, bin || new Uint8Array(0));
  const rejects = async (data, re, msg) => { let err = null; try { await UG.GLTF.parse(data); } catch (e) { err = e; } A.ok(err, msg + ': no falló'); if (re) A.ok(re.test(err.message), msg + ': ' + err.message); };
  await testAsync('GLB con cabecera o chunks corruptos se rechaza', async () => {
    const short = new ArrayBuffer(10); new DataView(short).setUint32(0, 0x46546C67, true); await rejects(short, /corto/, 'corto');
    await rejects(new ArrayBuffer(10), /JSON/, 'binario sin cabecera GLB');
    const good = glbOf({ asset: { version: '2.0' } }), bad = good.slice(0); new DataView(bad).setUint32(8, 99999, true); await rejects(bad, /inconsistente/, 'longitud');
    const bad2 = good.slice(0); new DataView(bad2).setUint32(12, 99999, true); await rejects(bad2, /límites/, 'chunk');
    await rejects({ asset: { version: '1.0' } }, /2\.x/, 'versión');
  });
  const tri = () => { const b = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]); return { bin: new Uint8Array(b.buffer), json: { asset: { version: '2.0' }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }] } }; };
  await testAsync('Accessor fuera de su bufferView se rechaza (sin leer memoria ajena)', async () => {
    const t = tri(); t.json.accessors[0].count = 1000; await rejects(glbOf(t.json, t.bin), /fuera de/, 'count');
    const t2 = tri(); t2.json.bufferViews[0].byteLength = 1 << 20; await rejects(glbOf(t2.json, t2.bin), /fuera de su buffer/, 'bufferView');
    const t3 = tri(); t3.json.accessors[0].byteOffset = -4; await rejects(glbOf(t3.json, t3.bin), /inválido/, 'offset negativo');
  });
  await testAsync('Índices fuera de rango, ciclos y extensiones no soportadas se rechazan', async () => {
    const t = tri(), idx = new Uint16Array([0, 1, 7, 0]), bin = new Uint8Array(44); bin.set(t.bin, 0); bin.set(new Uint8Array(idx.buffer), 36);
    t.json.buffers[0].byteLength = 44; t.json.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: 6 }); t.json.accessors.push({ bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }); t.json.meshes[0].primitives[0].indices = 1;
    await rejects(glbOf(t.json, bin), /fuera de rango/, 'índice');
    const c = tri(); c.json.nodes = [{ children: [1] }, { children: [0] }]; await rejects(glbOf(c.json, c.bin), /ciclos/, 'ciclo');
    const c2 = tri(); c2.json.nodes = [{ children: [1] }, {}, { children: [1] }]; await rejects(glbOf(c2.json, c2.bin), /padre/, 'dos padres');
    const c3 = tri(); c3.json.nodes = [{ children: [0] }]; await rejects(glbOf(c3.json, c3.bin), /propio hijo/, 'autohijo');
    const d = tri(); d.json.extensionsRequired = ['KHR_draco_mesh_compression']; await rejects(glbOf(d.json, d.bin), /Draco/, 'draco');
    const e = tri(); e.json.buffers[0] = { byteLength: 36, uri: 'javascript:alert(1)' }; await rejects(e.json, null, 'uri javascript');
    const f = tri(); f.json.buffers[0] = { byteLength: 36, uri: 'data:text/html;base64,AAAA' }; await rejects(f.json, /no permitido/, 'data uri html');
  });
  await testAsync('Valores NaN se sanean y nombres/extras no contaminan prototipos', async () => {
    const t = tri(); new Float32Array(t.bin.buffer)[4] = NaN; t.json.nodes[0].name = '__proto__'; t.json.nodes[0].extras = JSON.parse('{"__proto__":{"polluted":2},"hp":5}');
    const m = await UG.GLTF.parse(glbOf(t.json, t.bin)); const g = m.nodes[0].geometry; A.ok(!Array.from(g.attributes.position.data).some(isNaN), 'sin NaN'); A.eq(({}).polluted, undefined); A.eq(m.nodes[0].userData.hp, 5); m.destroy();
  });
  await testAsync('Exportar e importar: jerarquía, materiales, textura PNG, esqueleto, animación, luces y cámara', async () => {
    const before = live();
    const root = new Group3D(); root.name = 'r';
    const px = new Uint8Array(4 * 4 * 4).map((v, i) => (i % 4 === 3 ? 255 : (i * 37) & 255));
    const tex = new UG.Texture(new UG.TextureSource({ data: px, width: 4, height: 4 }, { width: 4, height: 4 }));
    const mat = new StandardMaterial({ color: 0x3366ff, roughness: 0.3, metalness: 0.7, map: tex, emissive: 0x112233, emissiveIntensity: 4, alphaTest: 0.5, side: 'double', uvScale: 2 });
    const body = new Mesh3D(Geometry3D.box(1), mat); body.name = 'body'; root.add(body);
    const bone = new Node3D(); bone.name = 'bone'; root.add(bone);
    const g = body.geometry, n = g.vertexCount; g.setAttribute('joints', new Float32Array(n * 4), 4); g.setAttribute('weights', new Float32Array(n * 4).map((v, i) => (i % 4 === 0 ? 1 : 0)), 4);
    body.skeleton = new UG.Skeleton3D([bone]);
    const sun = new UG.DirectionalLight(0xffeedd, 3); sun.setDirection(0, -1, -1); sun.name = 'sun'; root.add(sun);
    const cam = new UG.PerspectiveCamera(50, 1.5, 0.2, 300); cam.name = 'cam'; root.add(cam);
    const clip = UG.AnimationClip3D.fromKeys('mover', { bone: { position: [[0, 0, 0, 0], [1, 0, 2, 0]] } });
    const exp = UG.GLTFExporter.export(root, { animations: [clip] });
    A.eq(exp.json.images.length, 1); A.eq(exp.json.images[0].mimeType, 'image/png');
    const bv = exp.json.bufferViews[exp.json.images[0].bufferView], pngBytes = exp.bin.subarray(bv.byteOffset, bv.byteOffset + 4);
    A.eq(pngBytes[1], 0x50, 'PNG incrustado'); A.eq(pngBytes[2], 0x4E);
    const glb = UG.GLTFExporter.toGLB(exp.json, exp.bin);
    const model = await UG.GLTF.parse(glb, { name: 't' }), inst = model.instantiate(), b2 = inst.getObjectByName('body'), m2 = b2.material;
    A.eq(m2.color, 0x3366ff); A.near(m2.roughness, 0.3, 1e-6); A.near(m2.metalness, 0.7, 1e-6); A.eq(m2.side, 'double'); A.near(m2.alphaTest, 0.5, 1e-6); A.near(m2.uvScale.x, 2, 1e-6);
    // la emisión total (color lineal × intensidad) se conserva aunque se reparta distinto
    for (let k = 0; k < 3; k++) A.near(m2.linearEmissive[k] * m2.emissiveIntensity, mat.linearEmissive[k] * 4, 1e-5, 'emisión ' + k);
    // en Node no hay decodificador de imágenes: la textura se omite (en el navegador se prueba en tests/3d-models.html)
    A.eq(m2.map, null);
    A.ok(b2.skeleton && b2.skeleton.bones[0] === inst.getObjectByName('bone'), 'hueso de la instancia');
    const s2 = inst.getObjectByName('sun'); A.ok(s2, 'nodo de luz'); const L = s2.children.find((c) => c instanceof UG.DirectionalLight); A.ok(L && L.useNodeDirection, 'luz direccional');
    inst.updateMatrixWorld(); const le = L.matrixWorld.e; near3(new Vec3(-le[8], -le[9], -le[10]).normalize(), new Vec3(0, -1, -1).normalize(), 1e-4, 'dirección de la luz');
    const c2 = inst.getObjectByName('cam').children[0]; A.ok(c2 instanceof UG.PerspectiveCamera); A.near(c2.fov, 50, 1e-3);
    inst.mixer.play('mover', { fade: 0 }); inst.mixer.update(0.5); A.near(inst.getObjectByName('bone').position.y, 1, 1e-5);
    inst.destroy(); model.destroy(); root.destroy(); tex.source.destroy();
    leakCheck(before, ['Node3D', 'Geometry3D', 'Model3D', 'AnimationMixer3D', 'TextureSource']);
  });

  section('3D: OBJ / MTL');
  test('OBJ: índices negativos, polígonos, grupos, colores por vértice', () => {
    const txt = 'mtllib a.mtl\no caja\nv 0 0 0 1 0 0\nv 1 0 0 0 1 0\nv 1 1 0 0 0 1\nv 0 1 0 1 1 1\nvt 0 0\nvt 1 1\nusemtl rojo\nf -4/1 -3/1 -2/2 -1/2\ng otro\nf 1 2 3\nf 1 x 9999\n';
    const d = UG.OBJ.parseText(txt); A.eq(d.groups.length, 2); A.eq(d.groups[0].idx.length / 3, 6, '2 triángulos del quad'); A.eq(d.groups[0].material, 'rojo'); A.ok(d.colors && d.colors.length === 12); A.eq(d.mtllibs[0], 'a.mtl');
    A.throws(() => UG.OBJ.parseText(null));
  });
  test('MTL: colores, opacidad, rugosidad y claves prohibidas', () => {
    const m = UG.OBJ.parseMTL('newmtl rojo\nKd 1 0 0\nd 0.5\nNs 98\nmap_Kd -bm 1 tex/ladrillo.png\nnewmtl __proto__\nKd 0 1 0\n');
    A.eq(m.rojo.color, 0xff0000); A.near(m.rojo.opacity, 0.5, 1e-6); A.ok(m.rojo.roughness < 0.2); A.eq(m.rojo.map, 'tex/ladrillo.png'); A.eq(({}).Kd, undefined); A.ok(!Object.prototype.hasOwnProperty.call(m, '__proto__'));
  });
  await testAsync('OBJ -> Model3D (sin cargador: sin texturas)', async () => {
    const model = await UG.OBJ.parse('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n', { name: 'o' }); A.eq(model.template.children.length, 1); const g = model.template.children[0].geometry; A.eq(g.vertexCount, 3); A.ok(g.attributes.normal); model.destroy();
  });

  section('3D: PNG');
  test('encodePNG produce un PNG válido (CRC y datos descomprimibles)', () => {
    const w = 3, h = 2, px = new Uint8Array(w * h * 4).map((v, i) => i * 11 & 255), png = Buffer.from(UG.encodePNG(w, h, px));
    A.eq(png.slice(1, 4).toString('ascii'), 'PNG'); let o = 8, idat = [];
    while (o < png.length) { const len = png.readUInt32BE(o), type = png.slice(o + 4, o + 8).toString('ascii'), data = png.slice(o + 8, o + 8 + len); if (type === 'IDAT') idat.push(data); o += 12 + len; }
    const raw = zlib.inflateSync(Buffer.concat(idat)); A.eq(raw.length, (w * 4 + 1) * h); A.eq(raw[1], px[0]); A.eq(raw[(w * 4 + 1) + 4], px[w * 4 + 3]);
  });

  section('3D: física');
  const W = () => { const w = new UG.PhysicsWorld3D({ gravity: -20 }); w.addGround(0); return w; };
  test('Personaje: cae, escalones de 0.3 y 0.6, bloqueo a >stepHeight y pared', () => {
    const w = W(); w.addBox(new Vec3(5, 0.15, 0), new Vec3(1, 0.15, 3)); w.addBox(new Vec3(7, 0.45, 0), new Vec3(1, 0.15, 3)); w.addBox(new Vec3(9, 1, 0), new Vec3(1, 0.2, 3));
    const ch = w.addCharacter(null, {}); ch.teleport(0, 3, 0); for (let i = 0; i < 90; i++) w.step(1 / 60); A.near(ch.position.y, 0, 1e-3); A.ok(ch.onGround);
    let maxY = 0; for (let i = 0; i < 200; i++) { ch.move(4, 0); w.step(1 / 60); maxY = Math.max(maxY, ch.position.y); }
    A.near(maxY, 0.6, 0.02, 'sube al segundo escalón'); A.ok(ch.position.x < 7.7 && ch.position.x > 7.5, 'se detiene ante el escalón alto x=' + ch.position.x); w.destroy();
  });
  test('Personaje: rampa 20º transitable sin resbalar; 60º no', () => {
    const w = W(), g = new Group3D(), r1 = new Mesh3D(Geometry3D.box(10, 0.2, 4), null); r1.rotation.z = 20 * Math.PI / 180; r1.position.set(0, 0, 20); g.add(r1);
    const r2 = new Mesh3D(Geometry3D.box(10, 0.2, 4), null); r2.rotation.z = 60 * Math.PI / 180; r2.position.set(0, 0, 40); g.add(r2); w.addMesh(g);
    const ch = w.addCharacter(null, {}); ch.teleport(-4, 0.5, 20); for (let i = 0; i < 30; i++) w.step(1 / 60);
    for (let i = 0; i < 150; i++) { ch.move(3, 0); w.step(1 / 60); } A.ok(ch.position.y > 0.6, 'sube la rampa y=' + ch.position.y);
    for (let i = 0; i < 60; i++) w.step(1 / 60); // frena (inercia)
    const x0 = ch.position.x, y0 = ch.position.y; for (let i = 0; i < 180; i++) w.step(1 / 60); A.near(ch.position.x, x0, 1e-3, 'no resbala'); A.near(ch.position.y, y0, 1e-3, 'no se hunde');
    ch.teleport(-6, 0.5, 40); for (let i = 0; i < 200; i++) { ch.move(3, 0); w.step(1 / 60); } A.ok(ch.position.y < 0.3, 'no escala 60º y=' + ch.position.y);
    w.destroy(); g.destroy();
  });
  test('Cuerpos: reposo, apilado de cajas, empuje del personaje, explosión', () => {
    const w = W(), b = w.addBody(null, { shape: 'sphere', radius: 0.5, position: new Vec3(0, 5, 0), restitution: 0.4 });
    const c1 = w.addBody(null, { shape: 'box', half: new Vec3(0.5, 0.5, 0.5), position: new Vec3(5, 0.6, 0) }), c2 = w.addBody(null, { shape: 'box', half: new Vec3(0.5, 0.5, 0.5), position: new Vec3(5, 2, 0) });
    for (let i = 0; i < 300; i++) w.step(1 / 60);
    A.near(b.position.y, 0.5, 0.02); A.ok(b.sleeping, 'duerme'); A.near(c1.position.y, 0.5, 0.03); A.near(c2.position.y, 1.5, 0.05, 'apilada');
    w.explode(new Vec3(5, 0, 1), 5, 30); A.ok(!c1.sleeping && c1.velocity.lengthSq() > 1, 'explosión despierta y empuja');
    w.destroy();
  });
  test('Coche: acelera, gira, choca contra pared y dispara triggers', () => {
    const w = W(); w.addBox(new Vec3(0, 1, 40), new Vec3(10, 1, 0.5)); const car = w.addVehicle(new Group3D(), {}); car.teleport(new Vec3(0, 0.5, 0), 0);
    let crash = 0, trig = 0; car.on('crash', () => crash++); w.addTrigger({ center: new Vec3(0, 1, 20), half: new Vec3(4, 3, 2), onEnter: () => trig++ });
    for (let i = 0; i < 300; i++) { car.setInput(1, 0); w.step(1 / 60); }
    A.ok(car.position.z > 30 && car.position.z < 40, 'se detiene en la pared z=' + car.position.z); A.ok(crash >= 1, 'choque'); A.eq(trig, 1);
    const h0 = car.heading; for (let i = 0; i < 60; i++) { car.setInput(-1, 1); w.step(1 / 60); } A.ok(car.heading !== h0, 'gira');
    w.destroy();
  });
  test('Coche contra coche y atropello: se separan, se transfiere velocidad y se avisa', () => {
    const w = W(), a = w.addVehicle(new Group3D(), {}), b = w.addVehicle(new Group3D(), {});
    a.teleport(new Vec3(0, 0.3, 0), 0); b.teleport(new Vec3(0, 0.3, 8), 0);
    let crash = 0; a.on('crash', () => crash++);
    for (let i = 0; i < 120; i++) { a.setInput(1, 0); b.setInput(0, 0); w.step(1 / 60); }
    A.ok(b.position.z - a.position.z > 3.4, 'no se atraviesan: ' + (b.position.z - a.position.z)); A.ok(b.speed > 1, 'empujado ' + b.speed); A.ok(crash >= 1, 'choque');
    const ped = w.addCharacter(null, {}); ped.teleport(20, 0, 0); a.teleport(new Vec3(20, 0.3, -15), 0); let hits = 0; a.on('hit', () => hits++);
    for (let i = 0; i < 120; i++) { a.setInput(1, 0); w.step(1 / 60); }
    A.ok(hits >= 1, 'atropello detectado'); A.ok(hits <= 3, 'sin impactos en cadena: ' + hits); A.ok(ped.position.y < 8, 'no sale volando sin fin: y=' + ped.position.y);
    const lz = ped.position.z - a.position.z, lx = ped.position.x - a.position.x;
    A.ok(Math.abs(lz) > a.length / 2 || Math.abs(lx) > a.width / 2 || ped.position.y > a.position.y + 1.6, 'el peatón no queda dentro del coche');
    w.destroy();
  });
  test('Rayos, línea de visión, altura del suelo y determinismo', () => {
    const run = () => { const w = W(); w.addBox(new Vec3(0, 1, 5), new Vec3(1, 1, 1)); const b = w.addBody(null, { position: new Vec3(0.3, 8, 5.2), radius: 0.4 }); const ch = w.addCharacter(null, {}); ch.teleport(-3, 0, 0);
      for (let i = 0; i < 240; i++) { ch.move(1, 0.5); w.step(1 / 60); } const r = [b.position.x, b.position.y, b.position.z, ch.position.x, ch.position.z]; w.destroy(); return r; };
    const a = run(), c = run(); for (let i = 0; i < a.length; i++) A.eq(a[i], c[i], 'determinista ' + i);
    const w = W(); w.addBox(new Vec3(0, 1, 5), new Vec3(1, 1, 1));
    const hit = w.raycast(new Vec3(0, 1, 0), new Vec3(0, 0, 1), 100); A.near(hit.distance, 4, 1e-5); near3(hit.normal, new Vec3(0, 0, -1), 1e-6, 'normal');
    A.ok(!w.lineOfSight(new Vec3(0, 1, 0), new Vec3(0, 1, 10))); A.ok(w.lineOfSight(new Vec3(5, 1, 0), new Vec3(5, 1, 10))); A.near(w.groundHeight(0, 5), 2, 1e-5); w.destroy();
  });
  test('Colisionador de malla con grupos intermedios recién creados (como un glTF) está en coordenadas de mundo', () => {
    const sc = new UG.Scene3D(), root = new Group3D(), inner = new Group3D(), mesh = new Mesh3D(Geometry3D.box(1), null);
    sc.add(root); root.add(inner); inner.add(mesh); root.position.set(-16, 0, -18); inner.position.set(0, 2, 0);
    const w = new UG.PhysicsWorld3D(), c = w.addMesh(root); near3(c.min, new Vec3(-16.5, 1.5, -18.5), 1e-5, 'min'); w.destroy(); sc.destroy();
  });
  test('Mundo: destroy libera todo (sin fugas)', () => {
    const before = live(), w = W(), n = new Node3D(); w.addBody(n, {}); w.addCharacter(new Node3D(), {}); w.addVehicle(new Group3D(), {}); w.addTrigger({ radius: 2 }); w.destroy();
    A.eq(w.bodies.length + w.characters.length + w.vehicles.length + w.triggers.length + w.statics.length, 0); leakCheck(before, ['PhysicsWorld3D']);
  });

  section('3D: niveles');
  test('Level3D.fromGrid: paredes fusionadas, spawns y celdas sólidas', () => {
    const view = { scene3d: new UG.Scene3D(), physics: new UG.PhysicsWorld3D(), material: (m) => new StandardMaterial(typeof m === 'number' ? { color: m } : m || {}) };
    const lv = UG.Level3D.fromGrid(view, ['#####', '#.P.#', '#.C.#', '#####'], { '#': 'wall', '.': 'floor', P: 'spawn:player', C: 'crate' });
    A.eq(lv.spawns.player.length, 1); A.ok(lv.solid(0, 0) && !lv.solid(1, 1)); A.ok(lv.colliders.length >= 6 && lv.colliders.length < 20, 'colisionadores ' + lv.colliders.length);
    const c = lv.toCell(lv.spawns.player[0]); A.eq(c.x, 2); A.eq(c.z, 1);
    view.physics.destroy(); view.scene3d.destroy();
  });
  test('Level3D.fromGrid con offset: mallas, colisionadores y spawns desplazados juntos', () => {
    const mk = () => ({ scene3d: new UG.Scene3D(), physics: new UG.PhysicsWorld3D(), material: (m) => new StandardMaterial(typeof m === 'number' ? { color: m } : m || {}) });
    const rows = ['#####', '#.P.#', '#####'], leg = { '#': 'wall', '.': 'floor', P: 'spawn:player' };
    const v0 = mk(), v1 = mk(), a = UG.Level3D.fromGrid(v0, rows, leg), b = UG.Level3D.fromGrid(v1, rows, leg, { offset: { x: 100, y: 2, z: -50 } });
    A.eq(b.root.position.x, 100); A.eq(b.root.position.z, -50);
    A.near(b.spawns.player[0].x - a.spawns.player[0].x, 100, 1e-9); A.near(b.spawns.player[0].y - a.spawns.player[0].y, 2, 1e-9);
    A.eq(b.colliders.length, a.colliders.length);
    // el suelo del nivel desplazado detiene un rayo en su nueva posición
    const hitA = v0.physics.raycast(new UG.Vec3(a.spawns.player[0].x, 5, a.spawns.player[0].z), new UG.Vec3(0, -1, 0), 20);
    const hitB = v1.physics.raycast(new UG.Vec3(b.spawns.player[0].x, 7, b.spawns.player[0].z), new UG.Vec3(0, -1, 0), 20);
    A.ok(hitA && hitB, 'hay suelo'); A.near(hitB.point.y - hitA.point.y, 2, 1e-6);
    const cb = b.toCell(b.spawns.player[0]); A.eq(cb.x, 2); A.eq(cb.z, 1);
    [v0, v1].forEach((v) => { v.physics.destroy(); v.scene3d.destroy(); });
  });
};
