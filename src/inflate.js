/* UltraGame - descompresor DEFLATE/zlib/gzip síncrono y sin dependencias (para mapas Tiled comprimidos).
 * Incluye límites de salida para evitar "zip bombs". */
var Inflate = (function () {
  function Tree() { this.table = new Uint16Array(16); this.trans = new Uint16Array(288); }
  var sltree = new Tree(), sdtree = new Tree();
  var lengthBits = new Uint8Array(30), lengthBase = new Uint16Array(30);
  var distBits = new Uint8Array(30), distBase = new Uint16Array(30);
  var clcidx = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
  var codeTree = new Tree();
  var lengths = new Uint8Array(288 + 32);
  var offs = new Uint16Array(16);

  function buildBitsBase(bits, base, delta, first) {
    var i, sum;
    for (i = 0; i < delta; ++i) bits[i] = 0;
    for (i = 0; i < 30 - delta; ++i) bits[i + delta] = (i / delta) | 0;
    for (sum = first, i = 0; i < 30; ++i) { base[i] = sum; sum += 1 << bits[i]; }
  }
  function buildFixedTrees(lt, dt) {
    var i;
    for (i = 0; i < 7; ++i) lt.table[i] = 0;
    lt.table[7] = 24; lt.table[8] = 152; lt.table[9] = 112;
    for (i = 0; i < 24; ++i) lt.trans[i] = 256 + i;
    for (i = 0; i < 144; ++i) lt.trans[24 + i] = i;
    for (i = 0; i < 8; ++i) lt.trans[24 + 144 + i] = 280 + i;
    for (i = 0; i < 112; ++i) lt.trans[24 + 144 + 8 + i] = 144 + i;
    for (i = 0; i < 5; ++i) dt.table[i] = 0;
    dt.table[5] = 32;
    for (i = 0; i < 32; ++i) dt.trans[i] = i;
  }
  function buildTree(t, lens, off, num) {
    var i, sum;
    for (i = 0; i < 16; ++i) t.table[i] = 0;
    for (i = 0; i < num; ++i) t.table[lens[off + i]]++;
    t.table[0] = 0;
    for (sum = 0, i = 0; i < 16; ++i) { offs[i] = sum; sum += t.table[i]; }
    for (i = 0; i < num; ++i) if (lens[off + i]) t.trans[offs[lens[off + i]]++] = i;
  }

  function Data(source, maxOut) {
    this.source = source; this.index = 0; this.tag = 0; this.bitcount = 0;
    this.dest = new Uint8Array(Math.max(1024, Math.min(maxOut, source.length * 4))); this.destLen = 0;
    this.maxOut = maxOut; this.ltree = new Tree(); this.dtree = new Tree();
  }
  function ensure(d, extra) {
    var need = d.destLen + extra;
    if (need > d.maxOut) throw new Error('UltraGame Inflate: la salida excede el límite permitido (' + d.maxOut + ' bytes)');
    if (need > d.dest.length) {
      var n = new Uint8Array(Math.min(d.maxOut, Math.max(need, d.dest.length * 2)));
      n.set(d.dest.subarray(0, d.destLen)); d.dest = n;
    }
  }
  function nextByte(d) {
    if (d.index >= d.source.length) { d.overrun = (d.overrun || 0) + 1; if (d.overrun > 8) throw new Error('UltraGame Inflate: datos truncados'); return 0; }
    return d.source[d.index++];
  }
  function getBit(d) {
    if (!d.bitcount--) { d.tag = nextByte(d); d.bitcount = 7; }
    var bit = d.tag & 1; d.tag >>>= 1; return bit;
  }
  function readBits(d, num, base) {
    if (!num) return base;
    while (d.bitcount < 24) { d.tag |= nextByte(d) << d.bitcount; d.bitcount += 8; }
    var val = d.tag & (0xffff >>> (16 - num));
    d.tag >>>= num; d.bitcount -= num;
    return val + base;
  }
  function decodeSymbol(d, t) {
    while (d.bitcount < 24) { d.tag |= nextByte(d) << d.bitcount; d.bitcount += 8; }
    var sum = 0, cur = 0, len = 0, tag = d.tag;
    do {
      cur = 2 * cur + (tag & 1); tag >>>= 1; ++len;
      if (len > 15) throw new Error('UltraGame Inflate: código Huffman inválido');
      sum += t.table[len]; cur -= t.table[len];
    } while (cur >= 0);
    d.tag = tag; d.bitcount -= len;
    return t.trans[sum + cur];
  }
  function decodeTrees(d, lt, dt) {
    var i, num, length;
    var hlit = readBits(d, 5, 257), hdist = readBits(d, 5, 1), hclen = readBits(d, 4, 4);
    for (i = 0; i < 19; ++i) lengths[i] = 0;
    for (i = 0; i < hclen; ++i) lengths[clcidx[i]] = readBits(d, 3, 0);
    buildTree(codeTree, lengths, 0, 19);
    for (num = 0; num < hlit + hdist;) {
      var sym = decodeSymbol(d, codeTree);
      switch (sym) {
        case 16: { var prev = lengths[num - 1]; for (length = readBits(d, 2, 3); length; --length) lengths[num++] = prev; break; }
        case 17: for (length = readBits(d, 3, 3); length; --length) lengths[num++] = 0; break;
        case 18: for (length = readBits(d, 7, 11); length; --length) lengths[num++] = 0; break;
        default: lengths[num++] = sym; break;
      }
      if (num > 320) throw new Error('UltraGame Inflate: tabla dinámica inválida');
    }
    buildTree(lt, lengths, 0, hlit);
    buildTree(dt, lengths, hlit, hdist);
  }
  function inflateBlockData(d, lt, dt) {
    for (;;) {
      var sym = decodeSymbol(d, lt);
      if (sym === 256) return;
      if (sym < 256) { ensure(d, 1); d.dest[d.destLen++] = sym; }
      else {
        sym -= 257;
        if (sym >= 29) throw new Error('UltraGame Inflate: longitud inválida');
        var length = readBits(d, lengthBits[sym], lengthBase[sym]);
        var dist = decodeSymbol(d, dt);
        if (dist >= 30) throw new Error('UltraGame Inflate: distancia inválida');
        var start = d.destLen - readBits(d, distBits[dist], distBase[dist]);
        if (start < 0) throw new Error('UltraGame Inflate: referencia fuera de rango');
        ensure(d, length);
        var dest = d.dest;
        for (var i = start; i < start + length; ++i) dest[d.destLen++] = dest[i];
      }
    }
  }
  function inflateUncompressedBlock(d) {
    while (d.bitcount > 8) { if (d.overrun) d.overrun--; else d.index--; d.bitcount -= 8; }
    var src = d.source;
    if (d.index + 4 > src.length) throw new Error('UltraGame Inflate: bloque truncado');
    var length = 256 * src[d.index + 1] + src[d.index];
    var invlength = 256 * src[d.index + 3] + src[d.index + 2];
    if (length !== (~invlength & 0x0000ffff)) throw new Error('UltraGame Inflate: bloque sin comprimir inválido');
    d.index += 4;
    if (d.index + length > src.length) throw new Error('UltraGame Inflate: bloque truncado');
    ensure(d, length);
    d.dest.set(src.subarray(d.index, d.index + length), d.destLen);
    d.destLen += length; d.index += length;
    d.bitcount = 0; d.tag = 0;
  }

  function inflateRaw(source, maxOut) {
    var d = new Data(source, maxOut || 256 * 1024 * 1024);
    var bfinal, btype;
    do {
      bfinal = getBit(d);
      btype = readBits(d, 2, 0);
      if (btype === 0) inflateUncompressedBlock(d);
      else if (btype === 1) inflateBlockData(d, sltree, sdtree);
      else if (btype === 2) { decodeTrees(d, d.ltree, d.dtree); inflateBlockData(d, d.ltree, d.dtree); }
      else throw new Error('UltraGame Inflate: tipo de bloque inválido');
    } while (!bfinal);
    return d.dest.slice(0, d.destLen);
  }
  function zlib(src, maxOut) {
    if (src.length < 2) throw new Error('UltraGame Inflate: zlib truncado');
    var cmf = src[0], flg = src[1];
    if ((cmf & 0x0f) !== 8 || ((cmf << 8) + flg) % 31 !== 0) throw new Error('UltraGame Inflate: cabecera zlib inválida');
    if (flg & 0x20) throw new Error('UltraGame Inflate: diccionario zlib no soportado');
    return inflateRaw(src.subarray(2), maxOut);
  }
  function gzip(src, maxOut) {
    if (src.length < 18 || src[0] !== 0x1f || src[1] !== 0x8b || src[2] !== 8) throw new Error('UltraGame Inflate: cabecera gzip inválida');
    var flg = src[3], p = 10;
    if (flg & 4) { p += 2 + (src[p] | (src[p + 1] << 8)); }
    if (flg & 8) { while (p < src.length && src[p] !== 0) p++; p++; }
    if (flg & 16) { while (p < src.length && src[p] !== 0) p++; p++; }
    if (flg & 2) p += 2;
    return inflateRaw(src.subarray(p), maxOut);
  }
  function auto(src, maxOut) {
    if (src[0] === 0x1f && src[1] === 0x8b) return gzip(src, maxOut);
    if ((src[0] & 0x0f) === 8 && ((src[0] << 8) + src[1]) % 31 === 0) return zlib(src, maxOut);
    return inflateRaw(src, maxOut);
  }

  buildFixedTrees(sltree, sdtree);
  buildBitsBase(lengthBits, lengthBase, 4, 3);
  buildBitsBase(distBits, distBase, 2, 1);
  lengthBits[28] = 0; lengthBase[28] = 258;

  return { inflate: inflateRaw, zlib: zlib, gzip: gzip, auto: auto };
})();
UG.Inflate = Inflate;
