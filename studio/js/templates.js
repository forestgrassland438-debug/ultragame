/* UltraGame Studio · plantillas de proyecto. Cada plantilla declara qué recursos de la biblioteca usa
 * (se copian al proyecto) y construye escenas con comportamientos, eventos y algún script de ejemplo. */
const S = window.UGStudio.schema;

function N(type, kind, o) {
  const n = S.createNode(type, kind);
  Object.keys(o || {}).forEach((k) => { if (k === 'props' || k === 'physics') Object.assign(n[k], o[k]); else n[k] = o[k]; });
  return n;
}
const B = (type, params) => ({ type, params: Object.assign(S.defaultsOf(S.BEHAVIORS[type].params), params || {}) });
const C = (type, params, not) => ({ type, not: !!not, params: Object.assign(S.defaultsOf(S.CONDITIONS[type].params), params || {}) });
const A = (type, params) => ({ type, params: Object.assign(S.defaultsOf(S.ACTIONS[type].params), params || {}) });
const EV = (conditions, actions, o) => Object.assign({ id: S.uid('e'), enabled: true, once: false, comment: '', conditions, actions }, o || {});
function project(name, scenes, vars) { const p = S.createProject(name); p.scenes = scenes; p.startScene = scenes[0].id; if (vars) p.vars = vars; return p; }
function hudText(text, x, y, o) { return N('text', '2d', Object.assign({ name: o && o.name || 'Texto', x, y, hud: true, props: Object.assign({ text, size: 26, align: 'left' }, (o && o.props) || {}) }, o && o.extra)); }
function endScene(title, lines, buttonText, gotoId, color) {
  const sc = S.createScene('2d', title); sc.background = '#141726';
  sc.nodes.push(N('particles', '2d', { name: 'Confeti', x: 640, y: 740, props: { preset: 'confetti' } }));
  sc.nodes.push(N('text', '2d', { name: 'Título', x: 640, y: 250, props: { text: title, size: 60, color: color || '#ffd43b' } }));
  lines.forEach((l, i) => sc.nodes.push(N('text', '2d', { name: 'Texto ' + (i + 1), x: 640, y: 330 + i * 40, props: { text: l, size: 28, bold: false } })));
  sc.nodes.push(N('button', '2d', { name: 'Botón', x: 640, y: 470, props: { text: buttonText, goto: gotoId, width: 260 } }));
  return sc;
}

export const TEMPLATES = [
  {
    id: 'empty2d', name: 'Vacío 2D', emoji: '🟦', desc: 'Una escena 2D en blanco para empezar desde cero.', assets: [],
    build() {
      const sc = S.createScene('2d', 'Escena 1');
      sc.nodes.push(N('text', '2d', { name: 'Saludo', x: 640, y: 300, props: { text: '¡Hola, UltraGame!', size: 56, color: '#ffd43b' } }));
      sc.nodes.push(N('shape', '2d', { name: 'Cuadrado', x: 640, y: 440, props: { shape: 'roundrect', width: 120, height: 120, radius: 24, fill: '#4c6ef5' }, behaviors: [B('rotate', { speed: 45 })] }));
      return project('Mi juego 2D', [sc]);
    }
  },
  {
    id: 'empty3d', name: 'Vacío 3D', emoji: '🧊', desc: 'Suelo, luz, cámara y un cubo que gira.', assets: [],
    build() {
      const sc = S.createScene('3d', 'Escena 3D');
      sc.nodes.push(N('mesh3d', '3d', { name: 'Suelo', position: [0, -0.5, 0], props: { sizeX: 30, sizeY: 1, sizeZ: 30, color: '#6a8a5a' }, physics: { type: 'static' } }));
      sc.nodes.push(N('mesh3d', '3d', { name: 'Cubo', position: [0, 1, 0], props: { color: '#4c6ef5', metalness: 0.3, roughness: 0.4 }, behaviors: [B('rotate', { speed: 60 }), B('sine', { amplitude: 6, period: 2 })] }));
      sc.nodes.push(N('camera3d', '3d', { name: 'Cámara', position: [0, 4, 8], props: { target: [0, 1, 0] } }));
      return project('Mi juego 3D', [sc]);
    }
  },
  {
    id: 'platformer', name: 'Plataformas 2D', emoji: '🏃', desc: 'Salta entre plataformas, recoge monedas, esquiva slimes y llega a la puerta.', assets: [['2d', 'hero-sheet'], ['2d', 'coin'], ['2d', 'enemy'], ['2d', 'platform'], ['2d', 'bg-sky'], ['2d', 'spikes'], ['2d', 'door']],
    build(L) {
      const sc = S.createScene('2d', 'Nivel 1'); sc.gravity = 1300; sc.background = '#9fd3ff';
      const win = endScene('¡Nivel completado!', ['Monedas: {puntos}'], 'Jugar otra vez', sc.id);
      sc.nodes.push(N('tilesprite', '2d', { name: 'Fondo', x: 1280, y: 360, depth: -10, props: { asset: L['bg-sky'], width: 2560, height: 720, tileScale: 2.8125 } }));
      sc.nodes.push(N('tilesprite', '2d', { name: 'Suelo', x: 1280, y: 688, props: { asset: L.platform, width: 2560, height: 64 }, physics: { type: 'static' } }));
      [[420, 540, 192], [700, 440, 160], [980, 360, 192], [1300, 480, 256], [1650, 400, 192], [1950, 300, 160], [2250, 450, 224]].forEach((p, i) =>
        sc.nodes.push(N('tilesprite', '2d', { name: 'Plataforma ' + (i + 1), x: p[0], y: p[1], props: { asset: L.platform, width: p[2], height: 32 }, physics: { type: 'static' } })));
      const player = N('sprite', '2d', { name: 'Jugador', x: 90, y: 560, tags: ['jugador'], props: { asset: L['hero-sheet'], anim: '0-3', animFps: 10 }, physics: { type: 'dynamic' },
        behaviors: [B('platformer', { speed: 280, jump: 660 }), B('cameraFollow', { bounds: '2560x720' })] });
      sc.nodes.push(player);
      [[420, 490], [700, 390], [980, 310], [1300, 430], [1370, 430], [1650, 350], [1950, 250], [2250, 400]].forEach((p, i) =>
        sc.nodes.push(N('sprite', '2d', { name: 'Moneda ' + (i + 1), x: p[0], y: p[1], tags: ['moneda'], props: { asset: L.coin }, behaviors: [B('collectible', { by: 'jugador', variable: 'puntos', amount: 1 }), B('sine', { amplitude: 6, period: 1.4 })] })));
      [[1100, 630], [1800, 630], [2320, 630]].forEach((p, i) =>
        sc.nodes.push(N('sprite', '2d', { name: 'Slime ' + (i + 1), x: p[0], y: p[1], tags: ['enemigo'], props: { asset: L.enemy }, physics: { type: 'dynamic', worldBounds: true },
          behaviors: [B('patrol', { axis: 'x', distance: 200, speed: 90 }), B('hazard', { by: 'jugador', mode: 'damage', variable: 'vida', amount: 1 })] })));
      [1520, 2080].forEach((x, i) => sc.nodes.push(N('sprite', '2d', { name: 'Pinchos ' + (i + 1), x, y: 640, props: { asset: L.spikes }, behaviors: [B('hazard', { by: 'jugador', mode: 'damage', variable: 'vida', amount: 1 })] })));
      sc.nodes.push(N('sprite', '2d', { name: 'Puerta', x: 2490, y: 620, tags: ['meta'], props: { asset: L.door } }));
      sc.nodes.push(hudText('❤ {vida}     🪙 {puntos}', 56, 30, { name: 'Marcador', props: { size: 30 } }));
      sc.nodes.push(hudText('Flechas/WASD: moverse · Espacio: saltar · llega a la puerta', 640, 690, { name: 'Ayuda', props: { size: 18, align: 'center', color: '#1b1e2b', strokeWidth: 0 } }));
      sc.events.push(EV([C('start')], [A('setVar', { variable: 'vida', value: '3' }), A('setVar', { variable: 'puntos', value: '0' })], { comment: 'Empezar con 3 vidas y 0 monedas' }));
      sc.events.push(EV([C('collision', { a: 'tag:jugador', b: 'tag:meta' })], [A('playSound', { sound: 'sfx:powerup' }), A('gotoScene', { scene: win.id })], { comment: 'Tocar la puerta = ganar' }));
      sc.events.push(EV([C('compare', { variable: 'vida', op: '<=', value: '0' })], [A('restartScene')], { comment: 'Sin vidas: se reinicia el nivel' }));
      const p = project('Plataformas', [sc, win], { vida: 3, puntos: 0 });
      p.scripts.push({ id: S.uid('s'), name: 'animar héroe', code: [
        '// Anima al héroe solo cuando se mueve (la hoja "hero-sheet" tiene 4 fotogramas).',
        '// "self" es el sprite y "api" la ayuda del Studio (ver referencia a la derecha).',
        'function onUpdate(dt) {',
        '  var moving = Math.abs(api.velocity().x) > 10; // vale para física arcade y de cuerpos rígidos',
        '  if (moving && !self.isPlaying) self.play(api.animKey);',
        '  if (!moving && self.isPlaying) { self.stop(); self.setFrame(0); }',
        '}', ''].join('\n') });
      player.script = p.scripts[0].id;
      return p;
    }
  },
  {
    id: 'shooter2d', name: 'Naves 2D', emoji: '🚀', desc: 'Shooter espacial: mantén Espacio para disparar a los asteroides.', assets: [['2d', 'ship'], ['2d', 'asteroid'], ['2d', 'bullet'], ['2d', 'bg-space']],
    build(L) {
      const sc = S.createScene('2d', 'Espacio'); sc.gravity = 0; sc.background = '#060818';
      const fin = endScene('Fin de la partida', ['Puntos: {puntos}'], 'Reintentar', sc.id, '#ff8787');
      sc.nodes.push(N('tilesprite', '2d', { name: 'Fondo', x: 640, y: 360, depth: -10, props: { asset: L['bg-space'], width: 1280, height: 720, scrollX: 60 } }));
      sc.nodes.push(N('sprite', '2d', { name: 'Nave', x: 160, y: 360, tags: ['jugador'], props: { asset: L.ship }, physics: { type: 'dynamic', gravity: false }, behaviors: [B('topdown', { speed: 340 })] }));
      sc.nodes.push(N('sprite', '2d', { name: 'Bala', x: -100, y: -100, prefab: true, tags: ['bala'], props: { asset: L.bullet }, behaviors: [B('move', { vx: 820, vy: 0, life: 1.6 })] }));
      sc.nodes.push(N('sprite', '2d', { name: 'Asteroide', x: -100, y: -100, prefab: true, tags: ['asteroide'], props: { asset: L.asteroid },
        behaviors: [B('move', { vx: -230, vy: 0 }), B('rotate', { speed: 70 }), B('destroyOffscreen', { margin: 140 }), B('hazard', { by: 'jugador', mode: 'damage', variable: 'vida', amount: 1 })] }));
      sc.nodes.push(N('container', '2d', { name: 'Generador', x: 1360, y: 360 }));
      sc.nodes.push(hudText('Vida {vida}   ·   Puntos {puntos}', 56, 30, { name: 'Marcador' }));
      sc.nodes.push(hudText('Flechas/WASD: mover · mantén Espacio: disparar', 640, 690, { name: 'Ayuda', props: { size: 18, align: 'center', color: '#adb5bd' } }));
      sc.events.push(EV([C('start')], [A('setVar', { variable: 'vida', value: '3' }), A('setVar', { variable: 'puntos', value: '0' })]));
      sc.events.push(EV([C('keyDown', { key: 'SPACE' }), C('every', { seconds: 0.16 })], [A('spawn', { template: 'Bala', at: 'name:Nave', dx: 36 }), A('playSound', { sound: 'sfx:laser', volume: 0.25 })], { comment: 'Disparo automático mientras se mantiene Espacio' }));
      sc.events.push(EV([C('every', { seconds: 0.8 })], [A('spawn', { template: 'Asteroide', at: 'name:Generador', randomY: 320 })], { comment: 'Aparece un asteroide cada 0,8 s' }));
      sc.events.push(EV([C('collision', { a: 'tag:bala', b: 'tag:asteroide' })], [A('destroy', { target: 'other', effect: 'explosion' }), A('destroy', { target: 'self' }), A('addVar', { variable: 'puntos', value: 10 }), A('playSound', { sound: 'sfx:explosion', volume: 0.35 })]));
      sc.events.push(EV([C('collision', { a: 'tag:asteroide', b: 'tag:jugador' })], [A('destroy', { target: 'self', effect: 'explosion' })]));
      sc.events.push(EV([C('compare', { variable: 'vida', op: '<=', value: '0' })], [A('gotoScene', { scene: fin.id })]));
      return project('Naves', [sc, fin], { vida: 3, puntos: 0 });
    }
  },
  {
    id: 'adventure3d', name: 'Aventura 3D', emoji: '🏝️', desc: 'Tercera persona en una isla: encuentra las 10 monedas.', assets: [['3d', 'humanoid'], ['3d', 'coin'], ['3d', 'tree'], ['3d', 'pine'], ['3d', 'rock'], ['3d', 'house']],
    build(L) {
      const sc = S.createScene('3d', 'Isla');
      const fin = endScene('¡Isla explorada!', ['Encontraste {puntos} monedas'], 'Volver a jugar', sc.id);
      const terr = { width: 140, depth: 140, segments: 70, height: 7, noiseScale: 22, flatCenter: 16, seed: 'isla', color: '#5f9a48' };
      const hAt = window.UGStudio.runtime.terrainHeight(terr);
      sc.nodes.push(N('terrain', '3d', { name: 'Terreno', props: terr, physics: { type: 'mesh' } }));
      sc.nodes.push(N('mesh3d', '3d', { name: 'Agua', position: [0, -0.9, 0], props: { shape: 'plane', sizeX: 420, sizeZ: 420, color: '#3b82c4', opacity: 0.85, metalness: 0.2, roughness: 0.15, castShadow: false } }));
      sc.nodes.push(N('model', '3d', { name: 'Jugador', position: [0, hAt(0, 6), 6], tags: ['jugador'], props: { asset: L.humanoid, clip: 'Idle' }, physics: { type: 'character', radius: 0.35, height: 1.8 }, behaviors: [B('tpsPlayer')] }));
      sc.nodes.push(N('model', '3d', { name: 'Casa', position: [-9, hAt(-9, -7), -7], rotation: [0, 30, 0], props: { asset: L.house }, physics: { type: 'mesh' } }));
      sc.nodes.push(N('particles3d', '3d', { name: 'Fogata', position: [5, hAt(5, -3) + 0.2, -3], props: { preset: 'fire' } }));
      sc.nodes.push(N('light', '3d', { name: 'Luz de la fogata', position: [5, hAt(5, -3) + 1.2, -3], props: { light: 'point', color: '#ffa94d', intensity: 4, range: 10 } }));
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 + 0.3, r = 6 + (i % 3) * 3.2, x = Math.cos(a) * r, z = Math.sin(a) * r;
        sc.nodes.push(N('model', '3d', { name: 'Moneda ' + (i + 1), position: [x, hAt(x, z) + 1, z], tags: ['moneda'], props: { asset: L.coin, clip: 'Spin' }, behaviors: [B('collectible', { by: 'jugador', variable: 'puntos', amount: 1, effect: 'coin' })] })); }
      for (let i = 0; i < 26; i++) { const a = i * 2.39996, r = 19 + (i * 7.3) % 24, x = Math.cos(a) * r, z = Math.sin(a) * r;
        sc.nodes.push(N('model', '3d', { name: (i % 2 ? 'Pino ' : 'Árbol ') + (i + 1), position: [x, hAt(x, z) - 0.1, z], rotation: [0, (i * 47) % 360, 0], scale: [1 + (i % 3) * 0.2, 1 + (i % 3) * 0.2, 1 + (i % 3) * 0.2], props: { asset: i % 2 ? L.pine : L.tree } })); }
      for (let i = 0; i < 8; i++) { const a = i * 0.785 + 0.4, r = 13 + (i % 2) * 5, x = Math.cos(a) * r, z = Math.sin(a) * r;
        sc.nodes.push(N('model', '3d', { name: 'Roca ' + (i + 1), position: [x, hAt(x, z) - 0.2, z], rotation: [0, i * 40, 0], props: { asset: L.rock }, physics: { type: 'static' } })); }
      sc.nodes.push(hudText('Monedas: {puntos} / 10', 56, 30, { name: 'Marcador', props: { size: 30 } }));
      sc.nodes.push(hudText('WASD: andar · Shift: correr · Espacio: saltar · arrastra el ratón para girar la cámara', 640, 690, { name: 'Ayuda', props: { size: 18, align: 'center', color: '#e9ecef' } }));
      sc.events.push(EV([C('start')], [A('setVar', { variable: 'puntos', value: '0' }), A('setVar', { variable: 'ganado', value: '0' })]));
      sc.events.push(EV([C('compare', { variable: 'puntos', op: '>=', value: '10' })], [A('floatText', { text: '¡Todas!', at: 'tag:jugador' }), A('playSound', { sound: 'sfx:powerup' }), A('setVar', { variable: 'ganado', value: '1' })], { once: true }));
      sc.events.push(EV([C('compare', { variable: 'ganado', op: '==', value: '1' }), C('every', { seconds: 2 })], [A('gotoScene', { scene: fin.id })]));
      return project('Aventura 3D', [sc, fin], { puntos: 0, ganado: 0 });
    }
  },
  {
    id: 'fps3d', name: 'Shooter en primera persona', emoji: '🎯', desc: 'Laberinto con robots que te persiguen. Clic para disparar (script de ejemplo).', assets: [['3d', 'robot']],
    build(L) {
      const sc = S.createScene('3d', 'Base'); sc.env.fog = 'exp2'; sc.env.fogDensity = 0.018; sc.env.fogColor = '#9fb4cc';
      const win = endScene('¡Base despejada!', ['Has derrotado a todos los robots'], 'Jugar otra vez', sc.id), lose = endScene('Has caído', ['Los robots ganaron esta vez'], 'Reintentar', sc.id, '#ff8787');
      const rows = ['################', '#......#.......#', '#..C...#...C...#', '#......#.......#', '#...####...##..#', '#..............#', '###..C....C..###', '#......##......#', '#......##......#', '#..C.........C.#', '#....####......#', '#..............#', '#..##....C..##.#', '#..............#', '#..............#', '################'];
      sc.nodes.push(N('gridlevel', '3d', { name: 'Nivel', props: { rows: rows.join('\n'), cell: 3, wallHeight: 3.5, wallColor: '#8d99ae', floorColor: '#495057', crateColor: '#b07a3c' } }));
      const cellW = (x, z) => [(x - 8 + 0.5) * 3, 0, (z - 8 + 0.5) * 3];
      sc.nodes.push(N('mesh3d', '3d', { name: 'Jugador', position: [cellW(7, 14)[0], 0.1, cellW(7, 14)[2]], tags: ['jugador'], props: { shape: 'capsule', sizeX: 0.7, sizeY: 1.8, color: '#4dabf7' }, physics: { type: 'character', radius: 0.35, height: 1.8 }, behaviors: [B('fpsPlayer')] }));
      [[2, 2], [12, 2], [5, 9], [12, 9], [8, 6]].forEach((c, i) => sc.nodes.push(N('model', '3d', { name: 'Robot ' + (i + 1), position: cellW(c[0], c[1]), tags: ['enemigo'], props: { asset: L.robot, clip: 'Idle' }, physics: { type: 'character', radius: 0.45, height: 1.9 },
        behaviors: [B('chase', { target: 'jugador', speed: 2.4, range: 30 }), B('health', { hp: 3, effect: 'explosion' }), B('hazard', { by: 'jugador', mode: 'damage', variable: 'vida', amount: 1 })] })));
      sc.nodes.push(N('light', '3d', { name: 'Luz', position: [0, 3, 0], props: { light: 'point', intensity: 3, range: 18 } }));
      sc.nodes.push(N('text', '3d', { name: 'Mira', x: 640, y: 360, props: { text: '+', size: 34, strokeWidth: 3 } }));
      sc.nodes.push(hudText('Vida {vida}', 56, 30, { name: 'Marcador', props: { size: 30, color: '#ff8787' } }));
      sc.nodes.push(hudText('Clic: capturar ratón y disparar · WASD: moverse · Shift: correr · Espacio: saltar · Esc: soltar ratón', 640, 690, { name: 'Ayuda', props: { size: 17, align: 'center', color: '#e9ecef' } }));
      sc.events.push(EV([C('start')], [A('setVar', { variable: 'vida', value: '5' })]));
      sc.events.push(EV([C('compare', { variable: 'vida', op: '<=', value: '0' })], [A('gotoScene', { scene: lose.id })]));
      sc.events.push(EV([C('noneLeft', { target: 'tag:enemigo' })], [A('gotoScene', { scene: win.id })]));
      sc.script = [
        '// Disparo con rayo desde la cámara: mantén el clic izquierdo.',
        '// api.physics es el mundo físico 3D; api.damage() quita vida al robot (comportamiento "Vida").',
        'var cd = 0;',
        'function onUpdate(dt) {',
        '  cd -= dt;',
        '  if (!api.pointer.isDown || cd > 0) return;',
        '  cd = 0.22;',
        "  api.sfx('laser', 0.3);",
        '  var cam = api.camera, from = cam.getWorldPosition(new UG.Vec3()), dir = cam.getWorldDirection(new UG.Vec3());',
        "  var me = api.entityOf(api.find('tag:jugador'));",
        '  var hit = api.physics.raycast(from, dir, 80, { characters: true, ignore: me && me.ch });',
        '  if (!hit) return;',
        "  api.effect('sparks', hit.point.x, hit.point.y, hit.point.z);",
        '  if (hit.character && hit.character.node) api.damage(hit.character.node, 1);',
        '}', ''].join('\n');
      return project('Shooter FPS', [sc, win, lose], { vida: 5 });
    }
  },
  {
    id: 'racing3d', name: 'Carreras 3D', emoji: '🏎️', desc: 'Da 3 vueltas al circuito con física de coche y cámara de persecución.', assets: [['3d', 'car'], ['3d', 'pine']],
    build(L) {
      const sc = S.createScene('3d', 'Circuito');
      const fin = endScene('¡Carrera terminada!', ['Has completado las 3 vueltas'], 'Otra carrera', sc.id);
      sc.nodes.push(N('mesh3d', '3d', { name: 'Césped', position: [0, -0.5, 0], props: { sizeX: 400, sizeY: 1, sizeZ: 400, color: '#4f7a3a', castShadow: false }, physics: { type: 'static' } }));
      sc.nodes.push(N('mesh3d', '3d', { name: 'Asfalto', position: [0, 0.01, 0], props: { shape: 'cylinder', sizeX: 132, sizeY: 0.02, sizeZ: 132, segments: 96, color: '#3a3f47', roughness: 0.9, castShadow: false } }));
      sc.nodes.push(N('mesh3d', '3d', { name: 'Isla central', position: [0, 0.02, 0], props: { shape: 'cylinder', sizeX: 76, sizeY: 0.04, sizeZ: 76, segments: 96, color: '#4f7a3a', castShadow: false } }));
      const ring = (r, n, name, color) => { for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
        sc.nodes.push(N('mesh3d', '3d', { name: name + ' ' + (i + 1), position: [x, 0.5, z], rotation: [0, -a / Math.PI * 180 + 90, 0], props: { sizeX: 2 * Math.PI * r / n + 0.2, sizeY: 1, sizeZ: 0.6, color: i % 2 ? '#f8f9fa' : color }, physics: { type: 'mesh' } })); } };
      ring(66.5, 48, 'Muro exterior', '#e03131'); ring(37.5, 28, 'Muro interior', '#1971c2');
      sc.nodes.push(N('model', '3d', { name: 'Coche', position: [52, 0, 0], rotation: [0, 180, 0], tags: ['coche'], props: { asset: L.car }, behaviors: [B('vehicle', { power: 1, camera: true })] }));
      sc.nodes.push(N('mesh3d', '3d', { name: 'Meta', position: [52, 1.5, -4], tags: ['meta'], props: { sizeX: 28, sizeY: 3, sizeZ: 1, color: '#ffd43b', opacity: 0.25, shading: 'unlit', castShadow: false }, physics: { type: 'trigger' } }));
      sc.nodes.push(N('mesh3d', '3d', { name: 'Mitad', position: [-52, 1.5, 0], tags: ['mitad'], props: { sizeX: 28, sizeY: 3, sizeZ: 1, color: '#ffffff', opacity: 0.12, shading: 'unlit', castShadow: false }, physics: { type: 'trigger' } }));
      for (let i = 0; i < 30; i++) { const a = i * 2.39996, r = 76 + (i * 5.7) % 30, x = Math.cos(a) * r, z = Math.sin(a) * r; sc.nodes.push(N('model', '3d', { name: 'Pino ' + (i + 1), position: [x, 0, z], props: { asset: L.pine } })); }
      sc.nodes.push(hudText('Vuelta {vueltas} / 3', 56, 30, { name: 'Marcador', props: { size: 32 } }));
      sc.nodes.push(hudText('W/S: acelerar/frenar · A/D: girar · Espacio: freno de mano', 640, 690, { name: 'Ayuda', props: { size: 18, align: 'center', color: '#e9ecef' } }));
      sc.events.push(EV([C('start')], [A('setVar', { variable: 'vueltas', value: '0' }), A('setVar', { variable: 'mitad', value: '0' })]));
      sc.events.push(EV([C('collision', { a: 'tag:coche', b: 'tag:mitad' })], [A('setVar', { variable: 'mitad', value: '1' })], { comment: 'Hay que pasar por la mitad del circuito para que cuente la vuelta' }));
      sc.events.push(EV([C('collision', { a: 'tag:coche', b: 'tag:meta' }), C('compare', { variable: 'mitad', op: '==', value: '1' })], [A('addVar', { variable: 'vueltas', value: 1 }), A('setVar', { variable: 'mitad', value: '0' }), A('floatText', { text: 'Vuelta {vueltas}', at: 'self' }), A('playSound', { sound: 'sfx:powerup' })]));
      sc.events.push(EV([C('compare', { variable: 'vueltas', op: '>=', value: '3' })], [A('gotoScene', { scene: fin.id })]));
      return project('Carreras', [sc, fin], { vueltas: 0, mitad: 0 });
    }
  }
];
