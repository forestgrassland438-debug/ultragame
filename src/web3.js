/* UltraGame - web3 sin dependencias: Keccak-256, direcciones EIP-55, ABI de Solidity (codificar/decodificar llamadas,
 * eventos y errores), unidades (wei <-> ether con BigInt), carteras EIP-1193 (MetaMask, Rabby, Coinbase...) con
 * descubrimiento EIP-6963 y un proveedor simulado para pruebas.
 * Seguridad: nunca maneja claves privadas; solo permite una lista cerrada de métodos RPC (eth_sign está prohibido);
 * valida direcciones, redes permitidas y un importe máximo por transacción; limita la frecuencia de peticiones. */

/* ================================================================ Keccak-256 */
var KECCAK_RC = [1, 0, 32898, 0, 32906, 2147483648, 2147516416, 2147483648, 32907, 0, 2147483649, 0, 2147516545, 2147483648, 32777, 2147483648, 138, 0, 136, 0, 2147516425, 0, 2147483658, 0,
  2147516555, 0, 139, 2147483648, 32905, 2147483648, 32771, 2147483648, 32770, 2147483648, 128, 2147483648, 32778, 0, 2147483658, 2147483648, 2147516545, 2147483648, 32896, 2147483648, 2147483649, 0, 2147516424, 2147483648];
var KECCAK_ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
function keccakF(s) {
  var C = new Uint32Array(10), B = new Uint32Array(50), x, y, i, r, lo, hi, n;
  for (r = 0; r < 24; r++) {
    for (x = 0; x < 5; x++) { C[x * 2] = s[x * 2] ^ s[x * 2 + 10] ^ s[x * 2 + 20] ^ s[x * 2 + 30] ^ s[x * 2 + 40]; C[x * 2 + 1] = s[x * 2 + 1] ^ s[x * 2 + 11] ^ s[x * 2 + 21] ^ s[x * 2 + 31] ^ s[x * 2 + 41]; }
    for (x = 0; x < 5; x++) {
      var p = ((x + 4) % 5) * 2, q = ((x + 1) % 5) * 2, dlo = C[p] ^ ((C[q] << 1) | (C[q + 1] >>> 31)), dhi = C[p + 1] ^ ((C[q + 1] << 1) | (C[q] >>> 31));
      for (y = 0; y < 25; y += 5) { s[(y + x) * 2] ^= dlo; s[(y + x) * 2 + 1] ^= dhi; }
    }
    // rho + pi: B[y, 2x+3y] = rot(A[x, y])
    for (i = 0; i < 25; i++) {
      x = i % 5; y = (i / 5) | 0; lo = s[i * 2]; hi = s[i * 2 + 1]; n = KECCAK_ROT[i];
      var nl, nh;
      if (n === 0) { nl = lo; nh = hi; } else if (n < 32) { nl = (lo << n) | (hi >>> (32 - n)); nh = (hi << n) | (lo >>> (32 - n)); }
      else if (n === 32) { nl = hi; nh = lo; } else { var m = n - 32; nl = (hi << m) | (lo >>> (32 - m)); nh = (lo << m) | (hi >>> (32 - m)); }
      var j = y + ((2 * x + 3 * y) % 5) * 5; B[j * 2] = nl; B[j * 2 + 1] = nh;
    }
    for (y = 0; y < 25; y += 5) for (x = 0; x < 5; x++) {
      var a = (y + x) * 2, b1 = (y + (x + 1) % 5) * 2, b2 = (y + (x + 2) % 5) * 2;
      s[a] = B[a] ^ (~B[b1] & B[b2]); s[a + 1] = B[a + 1] ^ (~B[b1 + 1] & B[b2 + 1]);
    }
    s[0] ^= KECCAK_RC[r * 2]; s[1] ^= KECCAK_RC[r * 2 + 1];
  }
}
/** Keccak-256 (la variante de Ethereum, no SHA3-256) de bytes; devuelve Uint8Array(32) */
function keccak256Bytes(bytes) {
  var rate = 136, s = new Uint32Array(50), len = bytes.length, blocks = Math.floor(len / rate) + 1, buf = new Uint8Array(blocks * rate);
  buf.set(bytes); buf[len] = 0x01; buf[buf.length - 1] |= 0x80;
  for (var b = 0; b < blocks; b++) {
    for (var i = 0; i < rate; i += 4) { var o = b * rate + i, w = buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24); s[i >> 2] ^= w; }
    keccakF(s);
  }
  var out = new Uint8Array(32);
  for (var k = 0; k < 32; k++) out[k] = (s[k >> 2] >>> ((k & 3) * 8)) & 255;
  return out;
}
var w3enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null, w3dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
function w3utf8(str) {
  str = String(str);
  if (w3enc) return w3enc.encode(str);
  var s = unescape(encodeURIComponent(str)), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u;
}
function w3fromUtf8(u8) { if (w3dec) return w3dec.decode(u8); var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); try { return decodeURIComponent(escape(s)); } catch (e) { return s; } }
function w3hex(u8) { var s = '0x'; for (var i = 0; i < u8.length; i++) s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16); return s; }
function w3bytes(hex) {
  if (hex instanceof Uint8Array) return hex;
  var h = String(hex); if (h.slice(0, 2).toLowerCase() === '0x') h = h.slice(2);
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error('Web3: hexadecimal no válido');
  if (h.length % 2) h = '0' + h;
  var u = new Uint8Array(h.length / 2); for (var i = 0; i < u.length; i++) u[i] = parseInt(h.substr(i * 2, 2), 16); return u;
}
/** keccak256(texto | Uint8Array | {hex: '0x..'}) -> '0x…' */
function keccak256(data) { var b = data instanceof Uint8Array ? data : (data && typeof data === 'object' && data.hex !== undefined ? w3bytes(data.hex) : w3utf8(data)); return w3hex(keccak256Bytes(b)); }

/* ================================================================ direcciones */
function w3isAddress(a) { return typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a) && (a === a.toLowerCase() || a.slice(2) === a.slice(2).toUpperCase() || w3checksum(a) === a); }
/** EIP-55 (mayúsculas según el hash): detecta erratas al copiar direcciones */
function w3checksum(a) {
  if (typeof a !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error('Web3: dirección no válida: ' + String(a).slice(0, 50));
  var low = a.slice(2).toLowerCase(), h = keccak256(low).slice(2), out = '0x';
  for (var i = 0; i < 40; i++) out += parseInt(h[i], 16) >= 8 ? low[i].toUpperCase() : low[i];
  return out;
}
function w3short(a) { return typeof a === 'string' && a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : String(a || ''); }

/* ================================================================ unidades */
function w3big(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') { if (!isFinite(v) || Math.floor(v) !== v) throw new Error('Web3: número no entero (usa parseUnits para decimales): ' + v); if (Math.abs(v) > Number.MAX_SAFE_INTEGER) throw new Error('Web3: número demasiado grande para ser exacto; usa texto o BigInt'); return BigInt(v); }
  if (typeof v === 'boolean') return v ? BigInt(1) : BigInt(0);
  var s = String(v).trim(); if (!/^-?(0x[0-9a-fA-F]+|[0-9]+)$/.test(s)) throw new Error('Web3: entero no válido: ' + s.slice(0, 40));
  return s[0] === '-' ? -BigInt(s.slice(1)) : BigInt(s);
}
/** '1.5', 18 -> BigInt(1500000000000000000) (sin errores de coma flotante) */
function w3parseUnits(value, decimals) {
  decimals = decimals === undefined ? 18 : decimals | 0; if (decimals < 0 || decimals > 77) throw new Error('Web3: decimales fuera de rango');
  var s = String(value).trim(), neg = s[0] === '-'; if (neg) s = s.slice(1);
  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') throw new Error('Web3: cantidad no válida: ' + String(value).slice(0, 40));
  var parts = s.split('.'), frac = (parts[1] || ''); if (frac.length > decimals) { if (/[1-9]/.test(frac.slice(decimals))) throw new Error('Web3: demasiados decimales (' + decimals + ' como máximo)'); frac = frac.slice(0, decimals); }
  var n = BigInt((parts[0] || '0') + frac.padEnd(decimals, '0'));
  return neg ? -n : n;
}
function w3formatUnits(value, decimals, maxFrac) {
  decimals = decimals === undefined ? 18 : decimals | 0;
  var v = w3big(value), neg = v < BigInt(0); if (neg) v = -v;
  var s = v.toString().padStart(decimals + 1, '0'), int = s.slice(0, s.length - decimals), frac = decimals ? s.slice(s.length - decimals).replace(/0+$/, '') : '';
  if (maxFrac !== undefined && frac.length > maxFrac) frac = frac.slice(0, maxFrac).replace(/0+$/, '');
  return (neg ? '-' : '') + int + (frac ? '.' + frac : '');
}

/* ================================================================ ABI */
function abiParse(t) {
  t = String(t).replace(/\s+/g, '');
  var m = /^(.*)\[(\d*)\]$/.exec(t);
  if (m) return { kind: 'array', base: abiParse(m[1]), len: m[2] === '' ? -1 : +m[2] };
  if (t[0] === '(' && t[t.length - 1] === ')') { // tupla escrita en línea: (uint256,address)
    var inner = t.slice(1, -1), parts = [], depth = 0, cur = '';
    for (var i = 0; i < inner.length; i++) { var c = inner[i]; if (c === '(') depth++; if (c === ')') depth--; if (c === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += c; }
    if (cur) parts.push(cur);
    return { kind: 'tuple', comps: parts.map(abiParse) };
  }
  var u = /^(u?)int(\d*)$/.exec(t);
  if (u) { var bits = u[2] === '' ? 256 : +u[2]; if (bits < 8 || bits > 256 || bits % 8) throw new Error('ABI: tipo no válido ' + t); return { kind: u[1] ? 'uint' : 'int', bits: bits }; }
  if (t === 'address') return { kind: 'address' };
  if (t === 'bool') return { kind: 'bool' };
  if (t === 'string') return { kind: 'string' };
  if (t === 'bytes') return { kind: 'bytes' };
  var b = /^bytes(\d+)$/.exec(t); if (b && +b[1] >= 1 && +b[1] <= 32) return { kind: 'fixedbytes', size: +b[1] };
  throw new Error('ABI: tipo no soportado: ' + t);
}
/** Tipo ABI desde un parámetro JSON ({type, components}) */
function abiTypeOf(p) {
  if (typeof p === 'string') return abiParse(p);
  var t = String(p.type || '');
  if (/^tuple/.test(t)) { var tup = { kind: 'tuple', comps: (p.components || []).map(abiTypeOf) }, suf = t.slice(5); while (suf) { var mm = /^\[(\d*)\]/.exec(suf); if (!mm) throw new Error('ABI: tipo no válido ' + t); tup = { kind: 'array', base: tup, len: mm[1] === '' ? -1 : +mm[1] }; suf = suf.slice(mm[0].length); } return tup; }
  return abiParse(t);
}
function abiCanon(p) { if (typeof p === 'string') return abiCanonT(abiParse(p)); return abiCanonT(abiTypeOf(p)); }
function abiCanonT(T) { switch (T.kind) { case 'uint': return 'uint' + T.bits; case 'int': return 'int' + T.bits; case 'fixedbytes': return 'bytes' + T.size; case 'array': return abiCanonT(T.base) + '[' + (T.len < 0 ? '' : T.len) + ']'; case 'tuple': return '(' + T.comps.map(abiCanonT).join(',') + ')'; default: return T.kind; } }
function abiDynamic(T) { return T.kind === 'string' || T.kind === 'bytes' || (T.kind === 'array' && (T.len < 0 || abiDynamic(T.base))) || (T.kind === 'tuple' && T.comps.some(abiDynamic)); }
var TWO256 = BigInt(1) << BigInt(256);
function word(v) { var h = v.toString(16); if (h.length > 64) throw new Error('ABI: valor demasiado grande'); return h.padStart(64, '0'); }
function padRight(hex) { var n = Math.ceil(hex.length / 64) * 64; return hex.padEnd(Math.max(n, 64), '0'); }
function abiEncodeOne(T, v) {
  switch (T.kind) {
    case 'uint': { var n = w3big(v); if (n < BigInt(0) || n >= (BigInt(1) << BigInt(T.bits))) throw new Error('ABI: uint' + T.bits + ' fuera de rango: ' + String(v).slice(0, 40)); return word(n); }
    case 'int': { var m = w3big(v), lim = BigInt(1) << BigInt(T.bits - 1); if (m < -lim || m >= lim) throw new Error('ABI: int' + T.bits + ' fuera de rango'); return word(m < BigInt(0) ? TWO256 + m : m); }
    case 'address': { if (!w3isAddress(v)) throw new Error('ABI: dirección no válida: ' + String(v).slice(0, 50)); return v.slice(2).toLowerCase().padStart(64, '0'); }
    case 'bool': return word(v === true || v === 'true' || v === 1 || v === '1' ? BigInt(1) : BigInt(0));
    case 'fixedbytes': { var fb = w3bytes(v); if (fb.length > T.size) throw new Error('ABI: bytes' + T.size + ' demasiado largo'); return w3hex(fb).slice(2).padEnd(64, '0'); }
    case 'bytes': case 'string': { var by = T.kind === 'string' ? w3utf8(v) : w3bytes(v); return word(BigInt(by.length)) + (by.length ? padRight(w3hex(by).slice(2)) : ''); }
    case 'array': {
      if (!Array.isArray(v)) throw new Error('ABI: se esperaba una lista');
      if (T.len >= 0 && v.length !== T.len) throw new Error('ABI: la lista debe tener ' + T.len + ' elementos');
      if (v.length > 10000) throw new Error('ABI: lista demasiado larga');
      var body = abiEncodeList(v.map(function () { return T.base; }), v);
      return T.len < 0 ? word(BigInt(v.length)) + body : body;
    }
    case 'tuple': { var vals = Array.isArray(v) ? v : T.comps.map(function (c, i) { return v && typeof v === 'object' ? v[i] : undefined; }); return abiEncodeList(T.comps, vals); }
  }
  throw new Error('ABI: tipo desconocido');
}
function abiEncodeList(types, values) {
  if (values.length !== types.length) throw new Error('ABI: se esperaban ' + types.length + ' valores y hay ' + values.length);
  var heads = [], tails = [], headLen = 0;
  types.forEach(function (T) { headLen += abiDynamic(T) ? 32 : abiStaticSize(T); });
  var off = headLen;
  types.forEach(function (T, i) {
    var enc = abiEncodeOne(T, values[i]);
    if (abiDynamic(T)) { heads.push(word(BigInt(off))); tails.push(enc); off += enc.length / 2; }
    else heads.push(enc);
  });
  return heads.join('') + tails.join('');
}
function abiStaticSize(T) { if (T.kind === 'array') return T.len * abiStaticSize(T.base); if (T.kind === 'tuple') return T.comps.reduce(function (s, c) { return s + abiStaticSize(c); }, 0); return 32; }
function abiDecodeOne(T, hex, pos, base) {
  var at = function (p) { var s = hex.substr(p * 2, 64); if (s.length < 64) throw new Error('ABI: datos cortados'); return s; };
  switch (T.kind) {
    case 'uint': return BigInt('0x' + at(pos));
    case 'int': { var n = BigInt('0x' + at(pos)); return n >= (TWO256 >> BigInt(1)) ? n - TWO256 : n; }
    case 'address': return w3checksum('0x' + at(pos).slice(24));
    case 'bool': return BigInt('0x' + at(pos)) !== BigInt(0);
    case 'fixedbytes': return '0x' + at(pos).slice(0, T.size * 2);
    case 'bytes': case 'string': {
      var len = Number(BigInt('0x' + at(pos))); if (len > 10 * 1024 * 1024) throw new Error('ABI: bytes demasiado largos');
      var data = hex.substr((pos + 32) * 2, len * 2); if (data.length < len * 2) throw new Error('ABI: datos cortados');
      return T.kind === 'string' ? w3fromUtf8(w3bytes(data)) : '0x' + data;
    }
    case 'array': {
      var cnt = T.len, start = pos; if (cnt < 0) { cnt = Number(BigInt('0x' + at(pos))); start = pos + 32; if (cnt > 100000) throw new Error('ABI: lista demasiado larga'); }
      return abiDecodeList(Array.from({ length: cnt }, function () { return T.base; }), hex, start);
    }
    case 'tuple': return abiDecodeList(T.comps, hex, pos);
  }
  void base;
  throw new Error('ABI: tipo desconocido');
}
function abiDecodeList(types, hex, start) {
  var out = [], p = start || 0;
  types.forEach(function (T) {
    if (abiDynamic(T)) { var off = Number(BigInt('0x' + hex.substr(p * 2, 64))); out.push(abiDecodeOne(T, hex, (start || 0) + off)); p += 32; }
    else { out.push(abiDecodeOne(T, hex, p)); p += abiStaticSize(T); }
  });
  return out;
}
function abiEncodeParams(types, values) { return '0x' + abiEncodeList(types.map(abiTypeOf), values || []); }
function abiDecodeParams(types, data) { var h = String(data || '0x'); if (h.slice(0, 2) === '0x') h = h.slice(2); return abiDecodeList(types.map(abiTypeOf), h, 0); }
/** 'transfer(address,uint256)' o una entrada del ABI -> firma canónica */
function abiSignature(item) { if (typeof item === 'string') { var m = /^\s*([A-Za-z_$][\w$]*)\s*\((.*)\)\s*$/.exec(item); if (!m) throw new Error('ABI: firma no válida'); var ps = m[2].trim() ? abiParse('(' + m[2] + ')').comps : []; return m[1] + '(' + ps.map(abiCanonT).join(',') + ')'; } return item.name + '(' + (item.inputs || []).map(abiCanon).join(',') + ')'; }
function abiSelector(item) { return keccak256(abiSignature(item)).slice(0, 10); }
function abiEventTopic(item) { return keccak256(abiSignature(item)); }
/** Lee un ABI (JSON texto o lista) validándolo: solo funciones, eventos, errores y constructor bien formados */
function abiNormalize(abi) {
  var list = typeof abi === 'string' ? JSON.parse(abi) : abi;
  if (list && !Array.isArray(list) && Array.isArray(list.abi)) list = list.abi; // artefactos de Hardhat/Foundry
  if (!Array.isArray(list)) throw new Error('ABI: se esperaba una lista');
  return list.slice(0, 500).filter(function (it) { return it && typeof it === 'object' && ['function', 'event', 'error', 'constructor', 'fallback', 'receive'].indexOf(it.type || 'function') >= 0; }).map(function (it) {
    var io = function (arr) { return (Array.isArray(arr) ? arr : []).slice(0, 64).map(function (p) { abiTypeOf(p); return { name: typeof p.name === 'string' ? p.name.slice(0, 64) : '', type: String(p.type), components: p.components, indexed: !!p.indexed, internalType: p.internalType }; }); };
    return { type: it.type || 'function', name: typeof it.name === 'string' ? it.name.slice(0, 64) : '', inputs: io(it.inputs), outputs: io(it.outputs), stateMutability: it.stateMutability || (it.constant ? 'view' : 'nonpayable'), anonymous: !!it.anonymous };
  });
}
/** Decodifica un log (topics + data) con el ABI del evento */
function abiDecodeLog(ev, log) {
  var idx = ev.inputs.filter(function (p) { return p.indexed; }), non = ev.inputs.filter(function (p) { return !p.indexed; }), out = {}, t = (log.topics || []).slice(ev.anonymous ? 0 : 1);
  idx.forEach(function (p, i) { var T = abiTypeOf(p); out[p.name || i] = abiDynamic(T) ? t[i] : abiDecodeOne(T, String(t[i] || '').slice(2), 0); });
  var vals = abiDecodeParams(non, log.data); non.forEach(function (p, i) { out[p.name || ('arg' + i)] = vals[i]; });
  return out;
}

/* ================================================================ carteras */
var WEB3_ALLOWED = ['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'net_version', 'eth_call', 'eth_estimateGas', 'eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4',
  'wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_watchAsset', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getBalance', 'eth_blockNumber', 'eth_gasPrice', 'eth_getLogs', 'eth_getCode'];
/** Redes conocidas (para mostrar y para añadirlas a la cartera) */
var WEB3_CHAINS = {
  1: { name: 'Ethereum', symbol: 'ETH', explorer: 'https://etherscan.io' }, 11155111: { name: 'Sepolia (pruebas)', symbol: 'ETH', explorer: 'https://sepolia.etherscan.io', rpc: 'https://rpc.sepolia.org' },
  137: { name: 'Polygon', symbol: 'POL', explorer: 'https://polygonscan.com', rpc: 'https://polygon-rpc.com' }, 80002: { name: 'Polygon Amoy (pruebas)', symbol: 'POL', explorer: 'https://amoy.polygonscan.com', rpc: 'https://rpc-amoy.polygon.technology' },
  8453: { name: 'Base', symbol: 'ETH', explorer: 'https://basescan.org', rpc: 'https://mainnet.base.org' }, 84532: { name: 'Base Sepolia (pruebas)', symbol: 'ETH', explorer: 'https://sepolia.basescan.org', rpc: 'https://sepolia.base.org' },
  42161: { name: 'Arbitrum One', symbol: 'ETH', explorer: 'https://arbiscan.io', rpc: 'https://arb1.arbitrum.io/rpc' }, 10: { name: 'Optimism', symbol: 'ETH', explorer: 'https://optimistic.etherscan.io', rpc: 'https://mainnet.optimism.io' },
  56: { name: 'BNB Chain', symbol: 'BNB', explorer: 'https://bscscan.com', rpc: 'https://bsc-dataseed.binance.org' }, 43114: { name: 'Avalanche C', symbol: 'AVAX', explorer: 'https://snowtrace.io', rpc: 'https://api.avax.network/ext/bc/C/rpc' },
  31337: { name: 'Local (Hardhat/Anvil)', symbol: 'ETH', explorer: '', rpc: 'http://127.0.0.1:8545' }
};
function w3chainHex(id) { return '0x' + Number(id).toString(16); }
/** Descubre carteras instaladas (EIP-6963). Devuelve [{ info: {uuid, name, icon, rdns}, provider }] */
function web3Discover(ms) {
  return new Promise(function (resolve) {
    if (typeof window === 'undefined' || !window.addEventListener) { resolve([]); return; }
    var found = [], seen = {};
    var on = function (e) { var d = e && e.detail; if (!d || !d.info || !d.provider || typeof d.provider.request !== 'function' || seen[d.info.uuid]) return; seen[d.info.uuid] = 1; found.push({ info: { uuid: String(d.info.uuid), name: Security.sanitizeText(String(d.info.name || 'Cartera'), 60), icon: /^data:image\/(png|svg\+xml|webp|jpeg);/.test(String(d.info.icon || '')) ? d.info.icon : '', rdns: String(d.info.rdns || '').slice(0, 100) }, provider: d.provider }); };
    window.addEventListener('eip6963:announceProvider', on);
    try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch (e) { /* navegador antiguo */ }
    setTimeout(function () {
      window.removeEventListener('eip6963:announceProvider', on);
      if (!found.length && window.ethereum && typeof window.ethereum.request === 'function') found.push({ info: { uuid: 'legacy', name: window.ethereum.isMetaMask ? 'MetaMask' : 'Cartera del navegador', icon: '', rdns: '' }, provider: window.ethereum });
      resolve(found);
    }, ms || 350);
  });
}
/**
 * Cartera conectada (EventEmitter: 'connect', 'accountsChanged', 'chainChanged', 'disconnect', 'tx', 'txConfirmed', 'txFailed').
 * o: { provider (EIP-1193), chains: [ids permitidos], maxValue ('0.5' en ether o BigInt en wei), rateLimit (peticiones/s) }
 */
class Web3Wallet extends EventEmitter {
  constructor(o) {
    super();
    o = o || {};
    this.provider = o.provider || null; this.account = null; this.chainId = null; this.connected = false;
    this.chains = Array.isArray(o.chains) ? o.chains.map(Number).filter(function (n) { return n > 0; }) : null;
    this.maxValue = o.maxValue === undefined ? null : (typeof o.maxValue === 'bigint' ? o.maxValue : w3parseUnits(String(o.maxValue), 18));
    this.rateLimit = o.rateLimit || 12; this._times = []; this._pending = 0; this.maxPending = o.maxPending || 3;
    this._onAcc = null; this._onChain = null; this.destroyed = false;
  }
  /** Petición RPC (solo métodos de la lista blanca) */
  request(method, params) {
    var self = this;
    if (this.destroyed) return Promise.reject(new Error('Web3: cartera destruida'));
    if (WEB3_ALLOWED.indexOf(method) < 0) return Promise.reject(new Error('Web3: método no permitido por seguridad: ' + String(method).slice(0, 40)));
    if (!this.provider) return Promise.reject(new Error('Web3: no hay ninguna cartera (instala MetaMask u otra compatible)'));
    var now = Date.now(); this._times = this._times.filter(function (t) { return now - t < 1000; });
    if (this._times.length >= this.rateLimit) return Promise.reject(new Error('Web3: demasiadas peticiones seguidas'));
    this._times.push(now);
    return Promise.resolve(this.provider.request({ method: method, params: params || [] })).catch(function (e) { throw self._err(e); });
  }
  _err(e) { var code = e && e.code, msg = e && e.message ? String(e.message).slice(0, 300) : String(e); var err = new Error(code === 4001 ? 'Cancelado por el usuario en la cartera' : (code === 4902 ? 'La red no está añadida en la cartera' : msg)); err.code = code; return err; }
  /** Conecta (pide permiso al usuario). o: { chainId (red deseada), chains } */
  connect(o) {
    o = o || {}; var self = this;
    if (o.provider) this.provider = o.provider;
    if (o.chains) this.chains = o.chains.map(Number);
    return this.request('eth_requestAccounts').then(function (acc) {
      if (!Array.isArray(acc) || !acc.length || !w3isAddress(acc[0])) throw new Error('Web3: la cartera no devolvió ninguna cuenta');
      self.account = w3checksum(acc[0]);
      return self.request('eth_chainId');
    }).then(function (cid) {
      self.chainId = parseInt(cid, 16) || Number(cid);
      self.connected = true; self._listen();
      if (o.chainId && self.chainId !== Number(o.chainId)) return self.switchChain(o.chainId).then(function () { return self; });
      return self;
    }).then(function () { self.emit('connect', { account: self.account, chainId: self.chainId }); return self; });
  }
  _listen() {
    var p = this.provider, self = this; if (!p || !p.on || this._onAcc) return;
    this._onAcc = function (acc) { self.account = Array.isArray(acc) && acc[0] && w3isAddress(acc[0]) ? w3checksum(acc[0]) : null; if (!self.account) { self.connected = false; self.emit('disconnect'); } self.emit('accountsChanged', self.account); };
    this._onChain = function (cid) { self.chainId = parseInt(cid, 16) || Number(cid); self.emit('chainChanged', self.chainId); };
    p.on('accountsChanged', this._onAcc); p.on('chainChanged', this._onChain);
  }
  /** Cambia de red (y la añade si la cartera no la tiene y se conoce su RPC) */
  switchChain(id) {
    var self = this, hex = w3chainHex(id);
    return this.request('wallet_switchEthereumChain', [{ chainId: hex }]).catch(function (e) {
      var C = WEB3_CHAINS[Number(id)];
      if (e.code === 4902 && C && C.rpc) return self.request('wallet_addEthereumChain', [{ chainId: hex, chainName: C.name, nativeCurrency: { name: C.symbol, symbol: C.symbol, decimals: 18 }, rpcUrls: [C.rpc], blockExplorerUrls: C.explorer ? [C.explorer] : [] }]);
      throw e;
    }).then(function () { self.chainId = Number(id); self.emit('chainChanged', self.chainId); });
  }
  _checkChain() { if (this.chains && this.chains.length && this.chainId && this.chains.indexOf(this.chainId) < 0) throw new Error('Web3: red no permitida (' + this.chainId + '). Cambia a: ' + this.chains.join(', ')); }
  /** Firma un mensaje de texto (EIP-191, personal_sign): para iniciar sesión sin contraseña */
  signMessage(text) {
    if (!this.account) return Promise.reject(new Error('Web3: conecta la cartera primero'));
    var msg = String(text).slice(0, 4000);
    return this.request('personal_sign', [w3hex(w3utf8(msg)), this.account]);
  }
  getBalance(addr) { var a = addr || this.account; if (!w3isAddress(a)) return Promise.reject(new Error('Web3: dirección no válida')); return this.request('eth_getBalance', [a, 'latest']).then(function (h) { return BigInt(h); }); }
  /** Envía una transacción (la cartera la muestra y el usuario la aprueba). tx: { to, value (wei BigInt | '0.1 eth'), data } */
  sendTransaction(tx) {
    var self = this;
    try {
      if (!this.account) throw new Error('Web3: conecta la cartera primero');
      this._checkChain();
      if (tx.to !== undefined && tx.to !== null && !w3isAddress(tx.to)) throw new Error('Web3: dirección de destino no válida');
      var value = tx.value === undefined ? BigInt(0) : (typeof tx.value === 'string' && /eth$/i.test(tx.value) ? w3parseUnits(tx.value.replace(/\s*eth$/i, ''), 18) : w3big(tx.value));
      if (value < BigInt(0)) throw new Error('Web3: importe negativo');
      if (this.maxValue !== null && value > this.maxValue) throw new Error('Web3: importe por encima del máximo permitido por el juego (' + w3formatUnits(this.maxValue, 18) + ')');
      if (this._pending >= this.maxPending) throw new Error('Web3: hay demasiadas transacciones pendientes');
    } catch (e) { return Promise.reject(e); }
    var params = { from: this.account, value: '0x' + value.toString(16) };
    if (tx.to) params.to = tx.to; if (tx.data) params.data = w3hex(w3bytes(tx.data)); if (tx.gas) params.gas = '0x' + w3big(tx.gas).toString(16);
    this._pending++;
    return this.request('eth_sendTransaction', [params]).then(function (hash) { self._pending--; self.emit('tx', hash); return hash; }, function (e) { self._pending--; throw e; });
  }
  /** Espera el recibo (confirmación) de una transacción */
  waitForReceipt(hash, o) {
    o = o || {}; var self = this, timeout = o.timeout || 180000, every = o.interval || 1500, t0 = Date.now();
    return new Promise(function (resolve, reject) {
      var tick = function () {
        if (self.destroyed) { reject(new Error('Web3: cartera destruida')); return; }
        self.request('eth_getTransactionReceipt', [hash]).then(function (r) {
          if (r && r.blockNumber) { var ok = r.status === undefined || parseInt(r.status, 16) === 1; self.emit(ok ? 'txConfirmed' : 'txFailed', hash, r); if (ok) resolve(r); else reject(new Error('Web3: la transacción falló (revertida)')); return; }
          if (Date.now() - t0 > timeout) { reject(new Error('Web3: tiempo de espera agotado')); return; }
          setTimeout(tick, every);
        }, function (e) { if (Date.now() - t0 > timeout) reject(e); else setTimeout(tick, every * 2); });
      };
      tick();
    });
  }
  /** Contrato: address + ABI (JSON o lista) */
  contract(address, abi) { return new Web3Contract(this, address, abi); }
  disconnect() { var p = this.provider; if (p && p.removeListener && this._onAcc) { p.removeListener('accountsChanged', this._onAcc); p.removeListener('chainChanged', this._onChain); } this._onAcc = this._onChain = null; this.connected = false; this.account = null; this.emit('disconnect'); return this; }
  destroy() { if (this.destroyed) return; this.disconnect(); this.destroyed = true; this.removeAllListeners(); this.provider = null; }
}
class Web3Contract {
  constructor(wallet, address, abi) {
    if (!w3isAddress(address)) throw new Error('Web3: dirección de contrato no válida: ' + String(address).slice(0, 50));
    this.wallet = wallet; this.address = w3checksum(address); this.abi = abiNormalize(abi || []);
  }
  _fn(name, n) {
    var list = this.abi.filter(function (f) { return f.type === 'function' && (f.name === name || abiSignature(f) === name); });
    if (list.length > 1 && n !== undefined) list = list.filter(function (f) { return f.inputs.length === n; });
    if (!list.length) throw new Error('Web3: el contrato no tiene la función «' + String(name).slice(0, 60) + '»');
    return list[0];
  }
  encode(name, args) { var f = this._fn(name, (args || []).length); return abiSelector(f) + abiEncodeParams(f.inputs, args || []).slice(2); }
  /** Lectura gratuita (eth_call): devuelve el valor (o la lista si hay varias salidas) */
  read(name) {
    var args = Array.prototype.slice.call(arguments, 1), self = this;
    try { var f = this._fn(name, args.length), data = this.encode(name, args); } catch (e) { return Promise.reject(e); }
    void self;
    return this.wallet.request('eth_call', [{ to: this.address, data: data }, 'latest']).then(function (res) { var out = abiDecodeParams(f.outputs, res); return f.outputs.length === 1 ? out[0] : out; });
  }
  /** Escritura (transacción que el usuario confirma en su cartera). opts: { value } */
  write(name, args, opts) {
    opts = opts || {};
    try { var f = this._fn(name, (args || []).length); if (f.stateMutability !== 'payable' && opts.value && w3big(opts.value) > BigInt(0)) throw new Error('Web3: «' + name + '» no acepta pagos'); var data = this.encode(name, args || []); } catch (e) { return Promise.reject(e); }
    return this.wallet.sendTransaction({ to: this.address, data: data, value: opts.value || BigInt(0), gas: opts.gas });
  }
  /** Eventos del contrato en un rango de bloques (eth_getLogs) */
  events(name, o) {
    o = o || {}; var ev = this.abi.find(function (e) { return e.type === 'event' && e.name === name; }); if (!ev) return Promise.reject(new Error('Web3: evento desconocido ' + name));
    return this.wallet.request('eth_getLogs', [{ address: this.address, topics: [abiEventTopic(ev)], fromBlock: o.fromBlock || 'earliest', toBlock: o.toBlock || 'latest' }]).then(function (logs) { return (logs || []).slice(0, 5000).map(function (l) { return { args: abiDecodeLog(ev, l), tx: l.transactionHash, block: parseInt(l.blockNumber, 16) }; }); });
  }
}
/**
 * Proveedor simulado (EIP-1193) para probar sin cartera ni blockchain: cuentas, red, saldos y respuestas de funciones.
 * o: { accounts, chainId, balance (wei), calls: { 'balanceOf': BigInt(100) | function (args, tx) {...} }, abi, delay (ms), autoConfirm (true) }
 */
function web3Mock(o) {
  o = o || {};
  var ee = new EventEmitter(), accounts = (o.accounts || ['0x' + '1'.repeat(40)]).map(function (a) { return w3checksum(a.toLowerCase()); }), chainId = o.chainId || 31337, txs = {}, n = 0, delay = o.delay === undefined ? 30 : o.delay;
  var abi = o.abi ? abiNormalize(o.abi) : [], sel = {}, per = {};
  abi.forEach(function (f) { if (f.type === 'function') sel[abiSelector(f)] = f; });
  // varios contratos: { direccion: { abi, calls } } (cada dirección responde con su propio ABI)
  if (o.contracts) Object.keys(o.contracts).slice(0, 50).forEach(function (addr) {
    if (!w3isAddress(addr)) return; var c = o.contracts[addr], m = {};
    abiNormalize(c.abi || []).forEach(function (f) { if (f.type === 'function') m[abiSelector(f)] = f; });
    per[addr.toLowerCase()] = { sel: m, calls: c.calls || {} };
  });
  var respond = function (tx) {
    var pc = tx.to ? per[String(tx.to).toLowerCase()] : null, S2 = pc ? pc.sel : sel, calls = pc ? pc.calls : (o.calls || {});
    var s = String(tx.data || '').slice(0, 10), f = S2[s], args = f ? abiDecodeParams(f.inputs, '0x' + String(tx.data).slice(10)) : [];
    var h = f ? calls[f.name] : calls[s];
    var v = typeof h === 'function' ? h(args, tx) : h;
    if (!f) return '0x';
    if (f.outputs.length === 0) return '0x';
    return abiEncodeParams(f.outputs, f.outputs.length === 1 ? [v === undefined ? (f.outputs[0].type === 'bool' ? false : (f.outputs[0].type === 'string' ? '' : (f.outputs[0].type === 'address' ? accounts[0] : BigInt(0)))) : v] : (v || []));
  };
  var wait = function (v) { return new Promise(function (res) { setTimeout(function () { res(v); }, delay); }); };
  var p = {
    isMock: true, requests: [],
    request: function (a) {
      var m = a && a.method, pr = (a && a.params) || []; p.requests.push(m);
      switch (m) {
        case 'eth_requestAccounts': case 'eth_accounts': return wait(accounts.slice());
        case 'eth_chainId': return wait(w3chainHex(chainId));
        case 'net_version': return wait(String(chainId));
        case 'wallet_switchEthereumChain': chainId = parseInt(pr[0].chainId, 16); ee.emit('chainChanged', w3chainHex(chainId)); return wait(null);
        case 'eth_getBalance': return wait('0x' + w3big(o.balance || BigInt(10) ** BigInt(18)).toString(16));
        case 'eth_call': return wait(respond(pr[0]));
        case 'eth_estimateGas': return wait('0x5208');
        case 'eth_blockNumber': return wait('0x' + (100 + n).toString(16));
        case 'personal_sign': return wait('0x' + keccak256({ hex: pr[0] }).slice(2) + keccak256(String(pr[1])).slice(2) + '1b');
        case 'eth_sendTransaction': { var hash = keccak256('tx' + (++n) + JSON.stringify(pr[0])); txs[hash] = { tx: pr[0], block: 100 + n }; if (o.onSend) { var pcs = pr[0].to && per[String(pr[0].to).toLowerCase()]; try { o.onSend(pr[0], abiDecodeSafe(pcs ? pcs.sel : sel, pr[0])); } catch (e) { /* ignorar */ } } return wait(hash); }
        case 'eth_getTransactionReceipt': { var t = txs[pr[0]]; return wait(t && o.autoConfirm !== false ? { transactionHash: pr[0], blockNumber: '0x' + t.block.toString(16), status: '0x1', logs: [] } : null); }
        case 'eth_getLogs': return wait([]);
        default: return Promise.reject(Object.assign(new Error('Método no simulado: ' + m), { code: 4200 }));
      }
    },
    on: function (ev, fn) { ee.on(ev, fn); }, removeListener: function (ev, fn) { ee.off(ev, fn); }
  };
  return p;
}
function abiDecodeSafe(sel, tx) { try { var f = sel[String(tx.data || '').slice(0, 10)]; return f ? { fn: f.name, args: abiDecodeParams(f.inputs, '0x' + String(tx.data).slice(10)) } : null; } catch (e) { return null; } }

var Web3 = {
  keccak256: keccak256, keccak256Bytes: keccak256Bytes, isAddress: w3isAddress, toChecksumAddress: w3checksum, shortAddress: w3short,
  parseUnits: w3parseUnits, formatUnits: w3formatUnits, toBigInt: w3big, hexToBytes: w3bytes, bytesToHex: w3hex, utf8: w3utf8,
  encodeParams: abiEncodeParams, decodeParams: abiDecodeParams, signature: abiSignature, selector: abiSelector, eventTopic: abiEventTopic, normalizeABI: abiNormalize, decodeLog: abiDecodeLog, canonicalType: abiCanon,
  encodeCall: function (fn, args) { var f = typeof fn === 'string' && fn.indexOf('(') > 0 ? { name: fn.slice(0, fn.indexOf('(')), inputs: abiParse('(' + fn.slice(fn.indexOf('(') + 1, fn.lastIndexOf(')')) + ')').comps.map(function (T) { return abiCanonT(T); }) } : fn; return abiSelector(f) + abiEncodeParams(f.inputs, args || []).slice(2); },
  CHAINS: WEB3_CHAINS, ALLOWED_METHODS: WEB3_ALLOWED.slice(),
  discover: web3Discover, Wallet: Web3Wallet, Contract: Web3Contract, mock: web3Mock,
  /** Atajo: conecta con la primera cartera disponible (o la simulada) */
  connect: function (o) { o = o || {}; var w = new Web3Wallet(o); if (o.provider) return w.connect(o); return web3Discover().then(function (list) { if (!list.length) throw new Error('No hay ninguna cartera instalada (MetaMask, Rabby, Coinbase Wallet...)'); w.provider = list[0].provider; return w.connect(o); }); }
};
UG.Web3 = Web3;
