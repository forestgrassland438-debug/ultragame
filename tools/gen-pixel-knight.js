#!/usr/bin/env node
/* Genera los recursos Tiled de Pixel Knight: tileset PNG + TSJ externo, mapa TMJ y copia embebida (level1.js)
 * para abrir el juego desde file://. Puedes abrir assets/level1.tmj directamente en el editor Tiled. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { encodePNG } = require('./png.js');
const Art = require('../minigames/pixel-knight/art.js');

const OUT = path.join(__dirname, '..', 'minigames', 'pixel-knight');
const ASSETS = path.join(OUT, 'assets');
fs.mkdirSync(ASSETS, { recursive: true });

const T = Art.TILES;
const W = 170, H = 20, TS = 16;
let seed = 1337; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const ground = new Array(W * H).fill(0), plat = new Array(W * H).fill(0), haz = new Array(W * H).fill(0), decor = new Array(W * H).fill(0);
const set = (arr, x, y, g) => { if (x >= 0 && y >= 0 && x < W && y < H) arr[y * W + x] = g; };
const tops = new Array(W).fill(-1);
const objects = []; let oid = 1;
const obj = (o) => { o.id = oid++; o.visible = true; o.rotation = 0; objects.push(o); };

// terreno por segmentos
let x = 0, top = 15;
while (x < W) {
  const last = x > W - 22;
  const len = last ? W - x : ri(7, 15);
  if (!last && x > 14) top = Math.max(11, Math.min(17, top + ri(-2, 2)));
  const stone = !last && x > 30 && rnd() < 0.2;
  for (let i = 0; i < len && x + i < W; i++) {
    const cx = x + i; tops[cx] = top;
    for (let y = top; y < H; y++) set(ground, cx, y, y === top ? (stone ? T.MOSS : T.GRASS) : (stone ? T.STONE : T.DIRT));
  }
  // decoración, pinchos, cajas y enemigos
  if (x > 10 && !last) {
    const mid = x + Math.floor(len / 2);
    if (len >= 9 && rnd() < 0.7) obj({ name: 'slime', type: 'slime', x: mid * TS, y: (top - 1) * TS, width: TS, height: TS, properties: [{ name: 'rango', type: 'int', value: (len - 2) * TS / 2 }] });
    if (rnd() < 0.35) { const sx = x + ri(1, Math.max(1, len - 4)); for (let k = 0; k < ri(1, 3); k++) set(haz, sx + k, top - 1, T.SPIKES); }
    else if (rnd() < 0.3) { const cx2 = x + ri(1, len - 2); set(ground, cx2, top - 1, T.CRATE); if (rnd() < 0.4) set(ground, cx2, top - 2, T.CRATE); }
  }
  for (let i = 0; i < len; i++) if (rnd() < 0.22 && !haz[(top - 1) * W + x + i] && !ground[(top - 1) * W + x + i]) set(decor, x + i, top - 1, rnd() < 0.6 ? T.BUSH : T.FLOWER);
  x += len;
  // hueco con agua
  if (!last && x > 14 && x < W - 24 && rnd() < 0.35) {
    const gw = ri(2, 4);
    for (let i = 0; i < gw; i++) { tops[x + i] = -1; set(haz, x + i, H - 2, T.WATER); set(haz, x + i, H - 1, T.WATER); }
    // monedas en arco sobre el hueco
    for (let i = -1; i <= gw; i++) { const ay = top - 3 - Math.round(Math.sin((i + 1) / (gw + 1) * Math.PI) * 2); obj({ name: 'moneda', type: 'coin', gid: T.COIN, x: (x + i) * TS, y: (ay + 1) * TS, width: TS, height: TS, properties: [{ name: 'valor', type: 'int', value: 10 }] }); }
    x += gw;
  }
}
// plataformas de un sentido con monedas
for (let px = 18; px < W - 26; px += ri(9, 14)) {
  const t0 = tops[px] > 0 ? tops[px] : 15, py = t0 - ri(4, 5), pl = ri(3, 5);
  for (let i = 0; i < pl; i++) set(plat, px + i, py, T.PLATFORM);
  for (let i = 0; i < pl; i++) if (rnd() < 0.7) obj({ name: 'moneda', type: 'coin', gid: T.COIN, x: (px + i) * TS, y: py * TS, width: TS, height: TS, properties: [{ name: 'valor', type: 'int', value: 10 }] });
}
// jugador y meta
obj({ name: 'jugador', type: 'player', point: true, x: 3 * TS, y: (tops[3] - 1) * TS, width: 0, height: 0 });
obj({ name: 'meta', type: 'goal', gid: T.FLAG, x: (W - 6) * TS, y: tops[W - 6] * TS, width: TS, height: TS });

// ----------------------------------------------------------------- archivos
const png = Art.tileset();
fs.writeFileSync(path.join(ASSETS, 'knight-tiles.png'), encodePNG(png.w, png.h, png.d));
const k = Art.knightSheet(); fs.writeFileSync(path.join(ASSETS, 'knight.png'), encodePNG(k.w, k.h, k.d));
const sl = Art.slimeSheet(); fs.writeFileSync(path.join(ASSETS, 'slime.png'), encodePNG(sl.w, sl.h, sl.d));

const prop = (name, type, value) => ({ name, type, value });
const tileset = {
  type: 'tileset', version: '1.10', tiledversion: '1.10.2', name: 'knight-tiles', image: 'knight-tiles.png', imagewidth: 128, imageheight: 32,
  tilewidth: 16, tileheight: 16, tilecount: 16, columns: 8, margin: 0, spacing: 0,
  tiles: [
    { id: 0, properties: [prop('collides', 'bool', true)] }, { id: 1, properties: [prop('collides', 'bool', true)] },
    { id: 2, properties: [prop('collides', 'bool', true)] }, { id: 3, properties: [prop('oneWay', 'bool', true)] },
    { id: 4, properties: [prop('hazard', 'bool', true)] }, { id: 5, properties: [prop('collides', 'bool', true)] },
    { id: 8, type: 'coin', animation: [8, 9, 10, 11].map((t) => ({ tileid: t, duration: 110 })) },
    { id: 12, properties: [prop('hazard', 'bool', true)], animation: [{ tileid: 12, duration: 420 }, { tileid: 13, duration: 420 }] },
    { id: 13, properties: [prop('hazard', 'bool', true)] },
    { id: 15, properties: [prop('collides', 'bool', true)] }
  ]
};
fs.writeFileSync(path.join(ASSETS, 'knight-tiles.tsj'), JSON.stringify(tileset, null, 1));

const u32b64z = (arr) => { const b = Buffer.alloc(arr.length * 4); arr.forEach((g, i) => b.writeUInt32LE(g >>> 0, i * 4)); return zlib.deflateSync(b).toString('base64'); };
const layer = (id, name, data, extra) => Object.assign({ id, name, type: 'tilelayer', width: W, height: H, x: 0, y: 0, opacity: 1, visible: true, data }, extra || {});
const map = {
  type: 'map', version: '1.10', tiledversion: '1.10.2', orientation: 'orthogonal', renderorder: 'right-down', width: W, height: H, tilewidth: TS, tileheight: TS,
  infinite: false, backgroundcolor: '#79c7ff', nextlayerid: 6, nextobjectid: oid,
  properties: [prop('nombre', 'string', 'Pradera Pixel'), prop('tiempo', 'int', 240)],
  tilesets: [{ firstgid: 1, source: 'knight-tiles.tsj' }],
  layers: [
    layer(1, 'Decor', decor),
    layer(2, 'Suelo', u32b64z(ground), { encoding: 'base64', compression: 'zlib' }),
    layer(3, 'Plataformas', plat),
    layer(4, 'Peligros', haz),
    { id: 5, name: 'Objetos', type: 'objectgroup', draworder: 'topdown', opacity: 1, visible: true, x: 0, y: 0, objects }
  ]
};
fs.writeFileSync(path.join(ASSETS, 'level1.tmj'), JSON.stringify(map));
// copia embebida (tileset dentro del mapa, sin rutas externas) para file://
const embedded = JSON.parse(JSON.stringify(map));
embedded.tilesets = [Object.assign({ firstgid: 1 }, tileset)]; delete embedded.tilesets[0].type;
fs.writeFileSync(path.join(OUT, 'level1.js'), '/* Generado por tools/gen-pixel-knight.js (copia embebida de assets/level1.tmj para file://) */\nwindow.PK_LEVEL = ' + JSON.stringify(embedded) + ';\n');
console.log('Pixel Knight: mapa ' + W + 'x' + H + ', ' + objects.length + ' objetos, ' + objects.filter((o) => o.type === 'coin').length + ' monedas');
