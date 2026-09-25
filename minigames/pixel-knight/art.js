/* Pixel Knight — arte pixel procedural compartido (Node genera el PNG para Tiled; el navegador lo dibuja si
 * se abre desde file://). Todo es determinista: mismo resultado en ambos lados. */
(function (root) {
  'use strict';
  function rng(seed) { var s = seed >>> 0 || 1; return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1000) / 1000; }; }
  function hex(c) { return [(c >> 16) & 255, (c >> 8) & 255, c & 255]; }
  function Buf(w, h) { this.w = w; this.h = h; this.d = new Uint8Array(w * h * 4); }
  Buf.prototype.px = function (x, y, c, a) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; var i = (y * this.w + x) * 4, k = hex(c); this.d[i] = k[0]; this.d[i + 1] = k[1]; this.d[i + 2] = k[2]; this.d[i + 3] = a === undefined ? 255 : a; };
  Buf.prototype.rect = function (x, y, w, h, c, a) { for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) this.px(x + i, y + j, c, a); };
  Buf.prototype.pattern = function (ox, oy, rows, pal) {
    for (var y = 0; y < rows.length; y++) for (var x = 0; x < rows[y].length; x++) { var ch = rows[y][x]; if (pal[ch] !== undefined) this.px(ox + x, oy + y, pal[ch]); }
  };

  var P = { grass: 0x51cf66, grassHi: 0x8ce99a, grassDk: 0x2b8a3e, dirt: 0x8b5a2b, dirtDk: 0x6b4423, dirtHi: 0xa9713d, stone: 0x868e96, stoneDk: 0x495057, stoneHi: 0xadb5bd,
    wood: 0xc08457, woodDk: 0x8b5a2b, woodHi: 0xe0a872, metal: 0xdee2e6, metalDk: 0x868e96, gold: 0xfcc419, goldHi: 0xfff3bf, goldDk: 0xe67700, water: 0x339af0, waterHi: 0xa5d8ff, leaf: 0x37b24d, red: 0xfa5252, white: 0xffffff };

  /** Tileset 8x2 de 16px = 128x32. ids locales: 0 hierba, 1 tierra, 2 piedra, 3 plataforma, 4 pinchos, 5 caja, 6 arbusto, 7 flor,
   *  8-11 moneda (animada), 12-13 agua (animada), 14 bandera, 15 piedra con musgo */
  function tileset() {
    var b = new Buf(128, 32), r = rng(7);
    var tile = function (id) { return { x: (id % 8) * 16, y: Math.floor(id / 8) * 16 }; };
    var dirt = function (o, yStart) { for (var y = yStart; y < 16; y++) for (var x = 0; x < 16; x++) { var v = r(); b.px(o.x + x, o.y + y, v < 0.12 ? P.dirtDk : (v > 0.93 ? P.dirtHi : P.dirt)); } };
    var t = tile(0); dirt(t, 4);
    for (var x = 0; x < 16; x++) { b.px(t.x + x, t.y, P.grassHi); b.px(t.x + x, t.y + 1, P.grass); b.px(t.x + x, t.y + 2, P.grass); b.px(t.x + x, t.y + 3, r() < 0.5 ? P.grassDk : P.grass); if (r() < 0.35) b.px(t.x + x, t.y + 4, P.grassDk); }
    dirt(tile(1), 0);
    t = tile(2); b.rect(t.x, t.y, 16, 16, P.stone);
    for (var yy = 0; yy < 16; yy += 5) { b.rect(t.x, t.y + yy, 16, 1, P.stoneDk); }
    [[0, 1], [8, 1], [4, 6], [12, 6], [0, 11], [8, 11]].forEach(function (p) { b.rect(t.x + p[0], t.y + p[1], 1, 4, P.stoneDk); b.rect(t.x + p[0] + 1, t.y + p[1], 6, 1, P.stoneHi); });
    t = tile(3); b.rect(t.x, t.y, 16, 5, P.wood); b.rect(t.x, t.y, 16, 1, P.woodHi); b.rect(t.x, t.y + 4, 16, 1, P.woodDk); b.rect(t.x + 7, t.y, 1, 5, P.woodDk); b.rect(t.x + 2, t.y + 5, 2, 3, P.woodDk); b.rect(t.x + 12, t.y + 5, 2, 3, P.woodDk);
    t = tile(4);
    for (var s = 0; s < 4; s++) for (var h = 0; h < 8; h++) { var w = Math.max(1, 4 - Math.floor(h / 2)); for (var k = 0; k < w; k++) b.px(t.x + s * 4 + 2 - Math.floor(w / 2) + k, t.y + 15 - h, h > 5 ? P.white : (k === 0 ? P.metalDk : P.metal)); }
    t = tile(5); b.rect(t.x + 1, t.y + 1, 14, 14, P.wood); b.rect(t.x + 1, t.y + 1, 14, 2, P.woodDk); b.rect(t.x + 1, t.y + 13, 14, 2, P.woodDk); b.rect(t.x + 1, t.y + 1, 2, 14, P.woodDk); b.rect(t.x + 13, t.y + 1, 2, 14, P.woodDk);
    for (var d = 0; d < 10; d++) { b.px(t.x + 3 + d, t.y + 3 + d, P.woodDk); b.px(t.x + 12 - d, t.y + 3 + d, P.woodDk); }
    t = tile(6); b.pattern(t.x, t.y, ['', '', '', '', '', '', '', '     gggg       ', '   gghhhggg     ', '  gghhgggggg    ', ' ggggggggggggg  ', ' gggggGgggGggg  ', 'ggGgggggggggggg ', 'gggggGggggggGgg ', 'GgggggggGgggggGg', 'GGGGGGGGGGGGGGGG'], { g: P.leaf, h: P.grassHi, G: P.grassDk });
    t = tile(7); b.pattern(t.x, t.y, ['', '', '', '', '', '', '', '', '      rrr       ', '     rryrr      ', '      rrr       ', '       g        ', '      gg  g     ', '       g gg     ', '       gg       ', '       g        '], { r: P.red, y: P.gold, g: P.grassDk });
    var coin = [['   oooooo   ', '  oyyyyyyo  ', ' oyyhhyyyyo ', ' oyhyyyyyyo ', ' oyhyyyyyyo ', ' oyyyyyyyyo ', ' oyyyyyyydo ', ' oyyyyyyydo ', '  oyyyyydo  ', '   oooooo   '],
      ['    oooo    ', '   oyyyyo   ', '  oyhyyyyo  ', '  oyhyyyyo  ', '  oyyyyyyo  ', '  oyyyyyyo  ', '  oyyyyydo  ', '  oyyyyydo  ', '   oyyydo   ', '    oooo    '],
      ['     oo     ', '    oyho    ', '    oyyo    ', '    oyyo    ', '    oyyo    ', '    oyyo    ', '    oyyo    ', '    oydo    ', '    oydo    ', '     oo     '],
      ['    oooo    ', '   oyyyyo   ', '  oyyyyhyo  ', '  oyyyyhyo  ', '  oyyyyyyo  ', '  oyyyyyyo  ', '  odyyyyyo  ', '  odyyyyyo  ', '   odyyyo   ', '    oooo    ']];
    for (var f = 0; f < 4; f++) { t = tile(8 + f); b.pattern(t.x + 2, t.y + 3, coin[f], { o: P.goldDk, y: P.gold, h: P.goldHi, d: 0xf08c00 }); }
    for (var wv = 0; wv < 2; wv++) {
      t = tile(12 + wv);
      for (var yw = 0; yw < 16; yw++) for (var xw = 0; xw < 16; xw++) {
        var top = 2 + Math.round(Math.sin((xw + wv * 4) / 16 * Math.PI * 2) * 1.2);
        if (yw < top) continue;
        b.px(t.x + xw, t.y + yw, yw === top ? P.waterHi : P.water, yw === top ? 230 : 190);
      }
    }
    t = tile(14); b.rect(t.x + 3, t.y + 1, 2, 15, P.metalDk); b.rect(t.x + 3, t.y + 1, 1, 15, P.metal);
    b.pattern(t.x + 5, t.y + 2, ['rrrrrrrr', 'rwrrrrrr', 'rrrrrrr ', 'rrrrrr  ', 'rrrrrrr ', 'rrrrrrrr'], { r: P.red, w: P.white });
    t = tile(15); b.rect(t.x, t.y, 16, 16, P.stone); for (var ym = 0; ym < 16; ym += 5) b.rect(t.x, t.y + ym, 16, 1, P.stoneDk);
    for (var xm = 0; xm < 16; xm++) { b.px(t.x + xm, t.y, P.grass); b.px(t.x + xm, t.y + 1, r() < 0.6 ? P.grassDk : P.grass); if (r() < 0.3) b.px(t.x + xm, t.y + 2, P.grassDk); }
    return b;
  }

  /** Caballero 8 frames de 16x16: 0-1 reposo, 2-5 correr, 6 salto, 7 caída */
  function knightSheet() {
    var b = new Buf(128, 16);
    var pal = { h: 0xdee2e6, H: 0x868e96, v: 0x212529, s: 0xffd8a8, b: 0x4263eb, B: 0x364fc7, l: 0x495057, g: 0xfcc419, r: 0xfa5252 };
    var head = ['     rr     ', '    hhhh    ', '   hhhhhh   ', '   hvvvvh   ', '   hhhhhH   ', '    HHHH    '];
    var body = ['  gbbbbbbg  ', '  bbbBbbbB  ', ' sbbbBbbbbs ', '  bbbBbbbb  ', '   BBBBBB   '];
    var legs = [
      ['   ll  ll   ', '   ll  ll   ', '   ll  ll   ', '  lll  lll  '],
      ['   ll  ll   ', '   ll  ll   ', '   ll  ll   ', '  lll  lll  '],
      ['  ll    ll  ', '  ll    ll  ', ' ll      ll ', ' ll       l '],
      ['   ll ll    ', '   ll  ll   ', '   ll   ll  ', '  lll   ll  '],
      ['    llll    ', '    llll    ', '    ll ll   ', '   lll ll   '],
      ['    ll ll   ', '   ll  ll   ', '  ll   ll   ', '  ll  lll   '],
      ['  ll    ll  ', '   ll  ll   ', '            ', '            '],
      ['   ll  ll   ', '  ll    ll  ', '  l      l  ', '            ']
    ];
    for (var f = 0; f < 8; f++) {
      var bob = (f === 1 || f === 3 || f === 5) ? 1 : 0;
      b.pattern(f * 16 + 2, 1 + bob, head, pal);
      b.pattern(f * 16 + 2, 7 + bob, body, pal);
      b.pattern(f * 16 + 2, 12, legs[f], pal);
    }
    return b;
  }
  /** Slime 2 frames */
  function slimeSheet() {
    var b = new Buf(32, 16), pal = { o: 0x2b8a3e, g: 0x69db7c, h: 0xd3f9d8, e: 0x212529 };
    var f0 = ['', '', '', '', '', '      oooo      ', '    oogggghoo   ', '   ogggggghgo   ', '  ogggggggggo   ', '  oggeggggego   ', '  oggeggggego   ', ' ogggggggggggo  ', ' ogggggggggggo  ', ' oggggggggggggo ', ' oooooooooooooo ', ''];
    var f1 = ['', '', '', '', '', '', '', '     oooooo     ', '   ooggggghhoo  ', '  oggeggggeggo  ', '  oggeggggeggo  ', ' ogggggggggggggo', ' ogggggggggggggo', 'ooggggggggggggoo', 'oooooooooooooooo', ''];
    b.pattern(0, 0, f0, pal); b.pattern(16, 0, f1, pal);
    return b;
  }
  var api = { tileset: tileset, knightSheet: knightSheet, slimeSheet: slimeSheet, Buf: Buf, TILES: { GRASS: 1, DIRT: 2, STONE: 3, PLATFORM: 4, SPIKES: 5, CRATE: 6, BUSH: 7, FLOWER: 8, COIN: 9, WATER: 13, FLAG: 15, MOSS: 16 } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KnightArt = api;
})(this);
