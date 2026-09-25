/* Pruebas sin navegador de las novedades del motor (fase 4): física 2D de cuerpos rígidos (pilas estables, uniones,
 * rayos, sensores, filtros, polígonos cóncavos), personaje 3D que se agacha y salta ventanas, rejilla de navegación A*,
 * sintetizador por capas (armas, explosiones), nubes del cielo (saneado), materiales glTF con varios materiales y
 * colores de vértice, y la casa de ejemplo (cristales sin colisión, puntos de objetos). */
'use strict';
const path = require('path');
const fs = require('fs');

module.exports = async function (UG, h) {
  const { test, testAsync, A, section } = h;
  const run = (w, secs) => { for (let i = 0; i < secs * 60; i++) w.step(1 / 60); };

  section('Física 2D de cuerpos rígidos');
  test('RigidWorld2D: pila de 8 cajas estable, alineada y dormida', () => {
    const w = new UG.RigidWorld2D({ gravity: { x: 0, y: 980 } }); w.addStatic(400, 610, 800, 20);
    const boxes = []; for (let i = 0; i < 8; i++) boxes.push(w.addBox(400, 580 - i * 41, 40, 40, { friction: 0.6 }));
    run(w, 6);
    A.ok(Math.abs(boxes[7].position.y - 300) < 4, 'altura de la pila ' + boxes[7].position.y);
    A.ok(boxes.every((b) => Math.abs(b.position.x - 400) < 1 && Math.abs(b.angle) < 0.01), 'la pila no se tuerce');
    A.ok(boxes.every((b) => b.sleeping), 'se duerme');
    w.destroy();
  });
  test('RigidWorld2D: uniones (barra conserva la longitud, motor de bisagra)', () => {
    const w = new UG.RigidWorld2D(); const anchor = w.addStatic(400, 100, 10, 10), bob = w.addCircle(550, 100, 12), j = w.addJoint({ type: 'distance', a: anchor, b: bob });
    let err = 0; for (let i = 0; i < 300; i++) { w.step(1 / 60); const pa = j.worldA(), pb = j.worldB(); err = Math.max(err, Math.abs(Math.hypot(pb.x - pa.x, pb.y - pa.y) - 150)); }
    A.ok(err < 3, 'error de longitud ' + err); A.ok(bob.position.y > 150, 'el péndulo baja');
    const w2 = new UG.RigidWorld2D({ gravity: { x: 0, y: 0 } }), base = w2.addStatic(300, 300, 10, 10), wheel = w2.addCircle(300, 300, 30);
    w2.addJoint({ type: 'revolute', a: base, b: wheel, motorSpeed: 3, maxMotorTorque: 1e7 }); run(w2, 2);
    A.ok(Math.abs(wheel.angularVelocity - 3) < 0.05, 'velocidad del motor ' + wheel.angularVelocity);
    w.destroy(); w2.destroy();
  });
  test('RigidWorld2D: rayos, consulta por punto, sensores y filtros de colisión', () => {
    const w = new UG.RigidWorld2D({ gravity: { x: 0, y: 0 } }), a = w.addBox(200, 100, 40, 40), b = w.addBox(300, 100, 40, 40);
    const r = w.raycast(0, 100, 500, 100); A.ok(r && r.body === a && Math.abs(r.point.x - 180) < 0.5);
    A.eq(w.queryPoint(300, 100)[0], b);
    const sensor = w.addBox(400, 300, 100, 100, { isStatic: true, sensor: true }); let entered = 0; sensor.on('collide', () => entered++);
    const ball = w.addCircle(400, 150, 10); ball.setVelocity(0, 300); run(w, 1);
    A.eq(entered, 1); A.ok(ball.velocity.y > 250, 'el sensor no empuja');
    const ghost = w.addBox(100, 400, 30, 30, { category: 2, mask: 0 }); w.addStatic(100, 440, 200, 20); ghost.setVelocity(0, 200); run(w, 1);
    A.ok(ghost.position.y > 460, 'mask 0 no choca');
    w.destroy();
  });
  test('RigidWorld2D: polígono cóncavo triangulado, cuerpos girados y valores finitos con 300 cuerpos', () => {
    const w = new UG.RigidWorld2D(); w.addStatic(400, 610, 800, 20);
    const L = w.addPolygon(400, 300, [0, 0, 60, 0, 60, 20, 20, 20, 20, 60, 0, 60]); A.ok(L.shapes.length >= 2);
    const t = w.addBox(250, 200, 60, 20, { angle: 0.7 }); run(w, 4);
    A.ok(Math.abs(Math.sin(t.angle)) < 0.05, 'la caja inclinada acaba plana');
    const w2 = new UG.RigidWorld2D(); w2.addStatic(600, 810, 1200, 20); w2.addStatic(0, 400, 20, 800); w2.addStatic(1200, 400, 20, 800);
    for (let i = 0; i < 300; i++) { if (i % 2) w2.addBox(40 + (i % 28) * 40, 100 + Math.floor(i / 28) * 42, 30, 30); else w2.addCircle(40 + (i % 28) * 40, 100 + Math.floor(i / 28) * 42, 15); }
    run(w2, 5);
    A.ok(w2.bodies.every((b) => isFinite(b.position.x) && isFinite(b.position.y) && isFinite(b.angle)));
    A.ok(w2.bodies.filter((b) => b.sleeping).length > 250, 'casi todos duermen');
    w.destroy(); w2.destroy();
  });

  section('Personaje 3D: agacharse y saltar ventanas');
  const V3 = UG.Vec3;
  const world3 = () => { const w = new UG.PhysicsWorld3D({ gravity: -22 }); w.addGround(0); return w; };
  test('tryVault: atraviesa una ventana agachado y vuelve a ponerse de pie', () => {
    const w = world3(), t = 0.1;
    w.addBox(new V3(-2.3, 1.5, 0), new V3(1.7, 1.5, t)); w.addBox(new V3(2.3, 1.5, 0), new V3(1.7, 1.5, t));
    w.addBox(new V3(0, 0.475, 0), new V3(0.6, 0.475, t)); w.addBox(new V3(0, 2.55, 0), new V3(0.6, 0.45, t));
    const ch = w.addCharacter(null, { radius: 0.35, height: 1.8 }); ch.teleport(0, 0, 0.75); run(w, 0.3);
    A.ok(ch.tryVault(0, -1), 'empieza el salto'); run(w, 1.7);
    A.ok(ch.position.z < -0.3 && Math.abs(ch.position.y) < 0.1, 'al otro lado: ' + ch.position.z);
    A.ok(!ch.crouching && Math.abs(ch.height - 1.8) < 1e-6, 'de pie');
  });
  test('tryVault: salta vallas y trepa a cajas; no atraviesa muros altos', () => {
    let w = world3(); w.addBox(new V3(0, 0.5, 0), new V3(3, 0.5, 0.05));
    let ch = w.addCharacter(null, { radius: 0.35, height: 1.8 }); ch.teleport(0, 0, 1); run(w, 0.2); A.ok(ch.tryVault(0, -1)); run(w, 1.5); A.ok(ch.position.z < -0.3, 'valla');
    w = world3(); w.addBox(new V3(0, 0.6, -1.5), new V3(2, 0.6, 1.2)); ch = w.addCharacter(null, { radius: 0.35, height: 1.8 }); ch.teleport(0, 0, 0.6); run(w, 0.2);
    A.ok(ch.tryVault(0, -1)); run(w, 1.5); A.ok(Math.abs(ch.position.y - 1.2) < 0.1, 'encima de la caja');
    w = world3(); w.addBox(new V3(0, 1.5, 0), new V3(3, 1.5, 0.1)); ch = w.addCharacter(null, { radius: 0.35, height: 1.8 }); ch.teleport(0, 0, 1); run(w, 0.2);
    A.ok(!ch.tryVault(0, -1), 'muro de 3 m');
  });
  test('setCrouch: bajo un techo bajo no se levanta hasta salir', () => {
    const w = world3(); w.addBox(new V3(0, 1.45, 0), new V3(2, 0.15, 2));
    const ch = w.addCharacter(null, { radius: 0.35, height: 1.8 }); ch.teleport(0, 0, 4); run(w, 0.2); ch.setCrouch(true);
    for (let i = 0; i < 120; i++) { ch.move(0, -2); w.step(1 / 60); }
    ch.setCrouch(false); run(w, 0.3); A.ok(ch.crouching, 'sigue agachado bajo el techo');
    for (let i = 0; i < 180; i++) { ch.move(0, -2); w.step(1 / 60); }
    A.ok(!ch.crouching, 'se levanta al salir');
  });

  section('Web3 (Keccak, ABI, carteras)');
  const W = UG.Web3;
  test('Keccak-256: vectores conocidos y la permutación coincide con SHA3-256 de Node en varios bloques', () => {
    A.eq(W.keccak256(''), '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    A.eq(W.keccak256('abc'), '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
    A.eq(W.keccak256('The quick brown fox jumps over the lazy dog'), '0x4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'web3.js'), 'utf8'), a = src.indexOf('var KECCAK_RC'), b = src.indexOf('var w3enc');
    // mismo código con el relleno de SHA3 (0x06): se compara con la implementación de Node
    const sha3 = new Function('PAD', src.slice(a, b).replace('buf[len] = 0x01;', 'buf[len] = PAD;') + '; return keccak256Bytes;')(0x06);
    const crypto = require('crypto');
    [0, 1, 135, 136, 137, 272, 1000].forEach((n) => { const d = Buffer.alloc(n, 97); A.eq(Buffer.from(sha3(new Uint8Array(d))).toString('hex'), crypto.createHash('sha3-256').update(d).digest('hex'), 'bytes ' + n); });
  });
  test('Direcciones EIP-55, selectores y codificación ABI (vector oficial de la documentación de Solidity)', () => {
    A.eq(W.toChecksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'), '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
    A.ok(!W.isAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD'), 'suma de control incorrecta');
    A.eq(W.selector('transfer(address,uint256)'), '0xa9059cbb'); A.eq(W.selector('balanceOf(address)'), '0x70a08231');
    A.eq(W.encodeParams(['uint256', 'uint32[]', 'bytes10', 'bytes'], [0x123, [0x456, 0x789], '0x31323334353637383930', '0x' + Buffer.from('Hello, world!').toString('hex')]),
      '0x00000000000000000000000000000000000000000000000000000000000001230000000000000000000000000000000000000000000000000000000000000080313233343536373839300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000004560000000000000000000000000000000000000000000000000000000000000789000000000000000000000000000000000000000000000000000000000000000d48656c6c6f2c20776f726c642100000000000000000000000000000000000000');
    const T = ['string', 'uint256[]', 'bytes', 'bool', 'int8', '(address,uint64)'], v = ['hola ñ', [1, 2, 3], '0xdeadbeef', true, -5, ['0x' + '3'.repeat(40), 7]];
    const d = W.decodeParams(T, W.encodeParams(T, v));
    A.ok(d[0] === 'hola ñ' && d[1].map(Number).join() === '1,2,3' && d[2] === '0xdeadbeef' && d[3] === true && d[4] === BigInt(-5) && Number(d[5][1]) === 7);
    A.throws(() => W.encodeParams(['uint8'], [256])); A.throws(() => W.encodeParams(['uint256'], [-1])); A.throws(() => W.encodeParams(['address'], ['0x123']));
    A.eq(W.formatUnits(W.parseUnits('1.5', 18), 18), '1.5'); A.throws(() => W.parseUnits('0.0000001', 6));
  });
  await testAsync('Cartera (simulada): conectar, leer, escribir, recibo, firma y protecciones', async () => {
    const abi = [{ type: 'function', name: 'balanceOf', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
      { type: 'function', name: 'mint', inputs: [{ name: 'to', type: 'address' }, { name: 'n', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
      { type: 'function', name: 'buy', inputs: [], outputs: [], stateMutability: 'payable' }];
    let sent = null; const prov = W.mock({ abi, delay: 1, calls: { balanceOf: () => BigInt(42) }, onSend: (tx, dd) => { sent = dd; } });
    const w = new W.Wallet({ provider: prov, chains: [31337], maxValue: '0.5' });
    await w.connect(); A.ok(W.isAddress(w.account)); A.eq(w.chainId, 31337);
    const c = w.contract('0x' + '2'.repeat(40), abi);
    A.eq(String(await c.read('balanceOf', w.account)), '42');
    const h = await c.write('mint', [w.account, 3]); A.eq(sent.fn, 'mint'); A.eq(String(sent.args[1]), '3');
    A.eq((await w.waitForReceipt(h, { interval: 5 })).status, '0x1');
    let blocked = 0;
    for (const f of [() => c.write('buy', [], { value: W.parseUnits('1', 18) }), () => w.request('eth_sign', []), () => c.write('mint', [w.account, 1], { value: 5 }), () => c.read('noExiste')]) { try { await f(); } catch (e) { blocked++; } }
    A.eq(blocked, 4, 'importe máximo, eth_sign, pago a función no pagable y función inexistente');
    A.ok((await w.signMessage('hola')).startsWith('0x'));
    w.destroy();
  });

  section('Navegación, sonido, cielo y modelos');
  test('NavGrid3D: A* rodea un muro en U sin atravesarlo; celdas de cobertura', () => {
    const w = new UG.PhysicsWorld3D(); w.addGround(0);
    w.addBox(new V3(0, 1.5, 0), new V3(6, 1.5, 0.3)); w.addBox(new V3(-6, 1.5, 4), new V3(0.3, 1.5, 4)); w.addBox(new V3(6, 1.5, 4), new V3(0.3, 1.5, 4));
    const g = UG.NavGrid3D.fromPhysics(w, { area: [-30, -30, 30, 30], cell: 1 });
    const p = g.findPath({ x: 0, z: 3 }, { x: 0, z: -5 }); A.ok(p && p.length >= 2);
    for (let i = 1; i < p.length; i++) A.ok(g.lineFree(p[i - 1].x, p[i - 1].z, p[i].x, p[i].z), 'tramo libre');
    const len = p.reduce((s, q, i) => i ? s + Math.hypot(q.x - p[i - 1].x, q.z - p[i - 1].z) : 0, 0); A.ok(len > 15, 'rodea: ' + len);
    A.ok(g.coverPoints({ x: 0, z: 0 }, 10).length > 10);
    A.eq(g.findPath({ x: 0, z: 3 }, { x: 5000, z: 5000 }) !== undefined, true);
  });
  test('Sfx.render: los 26 sonidos por capas son finitos, normalizados y deterministas', () => {
    A.ok(UG.Sfx.physicalNames.length >= 26);
    UG.Sfx.physicalNames.forEach((k) => {
      const s = UG.Sfx.render(UG.Sfx.PHYS[k], 1); let pk = 0; for (const v of s) { A.ok(isFinite(v), k); pk = Math.max(pk, Math.abs(v)); }
      A.ok(s.length > 100 && pk > 0.2 && pk <= 1, k + ' pico ' + pk);
    });
    const a = UG.Sfx.render(UG.Sfx.PHYS.rifle, 3), b = UG.Sfx.render(UG.Sfx.PHYS.rifle, 3), c = UG.Sfx.render(UG.Sfx.PHYS.rifle, 4);
    A.eq(a.length, b.length); A.ok(a.every((v, i) => v === b[i]), 'misma semilla = mismo sonido'); A.ok(c.length !== a.length || c.some((v, i) => v !== a[i]), 'semilla distinta = variación');
  });
  test('Cielo: nubes saneadas (valores fuera de rango), estrellas y luna', () => {
    const sc = new UG.Scene3D(); sc.setSky({ clouds: { coverage: 7, scale: -1, octaves: 99, wind: ['x', 5], speed: 'rápido' }, stars: 0.5 });
    const c = sc.sky.clouds; A.eq(c.coverage, 1); A.ok(c.scale > 0 && c.octaves === 6 && isFinite(c.wind[0]) && c.speed === 0.015);
    const out = UG.Shader3D.packSkyExtras(sc.sky, new Float32Array(16), 0); A.eq(out[0], 1); A.ok(Math.abs(out[10] - 0.5) < 1e-6);
    sc.setClouds(null); A.eq(sc.sky.clouds, null); sc.setClouds({ coverage: 0.3 }); A.ok(Math.abs(sc.sky.clouds.coverage - 0.3) < 1e-9);
    const g = UG.Shader3D.glslSky(); A.ok(/fbm/.test(g.fs) && /uSky\[10\]/.test(g.fs)); A.ok(/fn fbm/.test(UG.Shader3D.wgslSky()));
  });
  await testAsync('glTF: cada primitiva recibe SU material aunque haya variantes con color de vértice (casa: cristales transparentes)', async () => {
    const b = fs.readFileSync(path.join(__dirname, '..', 'assets3d', 'house.glb'));
    const model = await UG.GLTF.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
    const inst = model.instantiate(), mats = {};
    inst.traverse((n) => { if (n.material) mats[n.name] = n.material; });
    A.ok(mats.glass_0 && mats.glass_0.transparent && mats.glass_0.opacity < 0.5, 'cristal transparente');
    A.ok(mats['house-walls'].vertexColors && !mats['house-walls'].transparent, 'paredes opacas con color de vértice');
    let items = 0, glass = 0; inst.traverse((n) => { if (/^item_/.test(n.name)) items++; if (/^glass_/.test(n.name)) { glass++; A.ok(n.userData.noCollide, 'extras noCollide'); } });
    A.eq(glass, 6); A.ok(items >= 4);
    // la física ignora los cristales (noCollide desde los extras) pero no las paredes
    const w = new UG.PhysicsWorld3D(); inst.updateMatrixWorld(true); const col = w.addMesh(inst);
    const tris = UG.worldTriangles(inst).length / 9; let glassTris = 0; inst.traverse((n) => { if (/^glass_/.test(n.name)) glassTris += n.geometry.index.length / 3; });
    A.ok(col && tris > 100 && col.count === tris, 'sin triángulos de cristal'); A.ok(glassTris > 0);
    inst.destroy();
  });
};
