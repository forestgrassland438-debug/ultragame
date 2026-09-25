/* UltraGame Studio · Solidity sin compilador: extrae el ABI de un contrato leyendo su código (funciones y variables
 * públicas, eventos, errores, constructor, structs, enums, herencia dentro del mismo archivo) y plantillas de contratos
 * para juegos (ERC-20, ERC-721, ERC-1155, clasificación, tienda, recompensas firmadas).
 * Solo genera el ABI (la interfaz). Para desplegar hace falta el bytecode de un compilador (Remix, Hardhat, Foundry).
 *   UGStudio.solidity.parse(fuente) -> { contracts: [{ name, kind, bases, abi, warnings }], errors }
 *   UGStudio.solidity.abiFor(fuente, nombre?) -> { name, abi, warnings } */
(function (root) {
  'use strict';
  var Sol = {};

  /* ---------------------------------------------------------------- lectura */
  /** Quita comentarios y deja las cadenas vacías (mismas longitudes no hacen falta) */
  function strip(src) {
    var out = '', i = 0, n = src.length;
    while (i < n) {
      var c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; out += ' '; continue; }
      if (c === '"' || c === "'") { var q = c; i++; while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; out += '""'; continue; }
      out += c; i++;
    }
    return out;
  }
  /** Índice del cierre que empareja con la apertura en s[i] */
  function matchClose(s, i) {
    var open = s[i], close = open === '(' ? ')' : open === '{' ? '}' : ']', depth = 0;
    for (var k = i; k < s.length; k++) { if (s[k] === open) depth++; else if (s[k] === close) { depth--; if (depth === 0) return k; } }
    return -1;
  }
  /** Divide por un separador en el primer nivel (fuera de paréntesis, llaves y corchetes) */
  function splitTop(s, sep) {
    var out = [], depth = 0, cur = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === '(' || c === '[' || c === '{') depth++; else if (c === ')' || c === ']' || c === '}') depth--;
      if (c === sep && depth === 0) { out.push(cur); cur = ''; } else cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out.map(function (x) { return x.trim(); }).filter(Boolean);
  }
  var ELEM = /^(address|bool|string|bytes([1-9]|[12]\d|3[0-2])?|u?int(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?|byte|function)$/;
  var LOCS = { memory: 1, storage: 1, calldata: 1, indexed: 1, payable: 1 };

  /* ---------------------------------------------------------------- tipos */
  function Ctx(file, contract) { this.file = file; this.c = contract; }
  Ctx.prototype.struct = function (name) { var n = name.split('.').pop(); return (this.c && this.c.structs[n]) || this.file.structs[n] || this.fromBases('structs', n); };
  Ctx.prototype.isEnum = function (name) { var n = name.split('.').pop(); return !!((this.c && this.c.enums[n]) || this.file.enums[n] || this.fromBases('enums', n)); };
  Ctx.prototype.udvt = function (name) { var n = name.split('.').pop(); return (this.c && this.c.udvt[n]) || this.file.udvt[n] || null; };
  Ctx.prototype.fromBases = function (kind, n) {
    var file = this.file, seen = {}, stack = this.c ? this.c.bases.slice() : [];
    while (stack.length) { var b = file.byName[stack.shift()]; if (!b || seen[b.name]) continue; seen[b.name] = 1; if (b[kind][n]) return b[kind][n]; stack = stack.concat(b.bases); }
    // structs/enums de cualquier contrato del archivo (Otro.MiStruct)
    for (var k in file.byName) if (file.byName[k][kind][n]) return file.byName[k][kind][n];
    return null;
  };
  Ctx.prototype.isContract = function (name) { var n = name.split('.').pop(); return !!this.file.byName[n]; };
  /** Tipo de Solidity -> { type, components? } del ABI */
  Ctx.prototype.abiType = function (t, depth) {
    t = t.replace(/\s+/g, ' ').trim();
    if ((depth || 0) > 16) throw new Error('tipo demasiado anidado: ' + t);
    var m = /^(.*)\[(\d*)\]$/.exec(t.replace(/\s+\[/g, '['));
    if (m) { var inner = this.abiType(m[1], (depth || 0) + 1); return { type: inner.type + '[' + m[2] + ']', components: inner.components }; }
    if (t === 'address payable') return { type: 'address' };
    if (t === 'uint') return { type: 'uint256' }; if (t === 'int') return { type: 'int256' }; if (t === 'byte') return { type: 'bytes1' };
    if (ELEM.test(t)) return { type: t };
    if (/^mapping\s*\(/.test(t)) throw new Error('mapping no permitido aquí');
    var st = this.struct(t);
    if (st) { var self = this; return { type: 'tuple', components: st.members.map(function (mm) { var at = self.abiType(mm.type, (depth || 0) + 1), o = { name: mm.name, type: at.type }; if (at.components) o.components = at.components; return o; }), internalType: 'struct ' + t }; }
    if (this.isEnum(t)) return { type: 'uint8' };
    var u = this.udvt(t); if (u) return this.abiType(u, (depth || 0) + 1);
    if (this.isContract(t) || /^I[A-Z]\w*$/.test(t)) return { type: 'address' }; // contratos e interfaces -> dirección
    throw new Error('tipo desconocido «' + t + '» (¿importado de otro archivo?)');
  };
  /** "uint256 amount" / "address indexed from" / "string memory s" -> { type, name, indexed } */
  Ctx.prototype.param = function (p, i, isEvent) {
    var words = p.replace(/\s+/g, ' ').trim();
    // separa el nombre final (si lo hay) y las palabras de ubicación
    var parts = [], depth = 0, cur = '';
    for (var k = 0; k < words.length; k++) { var c = words[k]; if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--; if (c === ' ' && depth === 0) { if (cur) parts.push(cur); cur = ''; } else cur += c; }
    if (cur) parts.push(cur);
    var indexed = false, typeParts = [], name = '';
    // "address payable" es un tipo de dos palabras
    for (var j = 0; j < parts.length; j++) {
      var w = parts[j];
      if (w === 'indexed') { indexed = true; continue; }
      if (w === 'payable' && typeParts.length && typeParts[typeParts.length - 1] === 'address') { typeParts.push('payable'); continue; }
      if (LOCS[w]) continue;
      if (typeParts.length && j === parts.length - 1 && /^[A-Za-z_$][\w$]*$/.test(w) && !/^\[/.test(w)) { name = w; continue; }
      typeParts.push(w);
    }
    var at = this.abiType(typeParts.join(' ').replace(/ \[/g, '['));
    var o = { name: name, type: at.type }; if (at.components) o.components = at.components; if (at.internalType) o.internalType = at.internalType;
    if (isEvent) o.indexed = indexed;
    void i;
    return o;
  };
  Ctx.prototype.params = function (list, isEvent) { var self = this; return splitTop(list, ',').map(function (p, i) { return self.param(p, i, isEvent); }); };
  /** Getter automático de una variable pública */
  Ctx.prototype.getter = function (typeStr, name) {
    var inputs = [], t = typeStr.replace(/\s+/g, ' ').trim(), guard = 0;
    for (;;) {
      if (++guard > 20) throw new Error('mapping demasiado anidado');
      var mm = /^mapping\s*\(/.exec(t);
      if (mm) {
        var open = t.indexOf('('), close = matchClose(t, open), inner = t.slice(open + 1, close), arrow = inner.indexOf('=>');
        var key = inner.slice(0, arrow).trim().split(' ')[0], val = inner.slice(arrow + 2).trim();
        // Solidity 0.8.18+: mapping(address jugador => uint256 puntos)
        if (/^mapping\s*\(/.test(val) === false) { var vp = val.split(' '); if (vp.length > 1 && /^[a-z_]\w*$/i.test(vp[vp.length - 1]) && !/\]$/.test(vp[vp.length - 1])) { vp.pop(); val = vp.join(' '); } }
        inputs.push({ name: '', type: this.abiType(key).type });
        t = val; continue;
      }
      var ma = /^(.*)\[(\d*)\]$/.exec(t);
      if (ma) { inputs.push({ name: '', type: 'uint256' }); t = ma[1].trim(); continue; }
      break;
    }
    var st = this.struct(t), outputs;
    if (st) {
      // un struct público devuelve sus miembros (sin listas ni mappings)
      var self = this;
      outputs = st.members.filter(function (m) { return !/^mapping/.test(m.type) && !/\]$/.test(m.type); }).map(function (m) { var at = self.abiType(m.type), o = { name: m.name, type: at.type }; if (at.components) o.components = at.components; return o; });
    } else { var at = this.abiType(t); outputs = [{ name: '', type: at.type }]; if (at.components) outputs[0].components = at.components; }
    return { type: 'function', name: name, inputs: inputs, outputs: outputs, stateMutability: 'view' };
  };

  /* ---------------------------------------------------------------- declaraciones */
  /** Miembros de un bloque: [{ text, body }] separados por ; o por un bloque {...} */
  function members(body) {
    var out = [], i = 0, start = 0, depth = 0;
    while (i < body.length) {
      var c = body[i];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === '{' && depth === 0) {
        var end = matchClose(body, i); if (end < 0) end = body.length - 1;
        var head = body.slice(start, i).trim();
        // struct/enum: el bloque es parte de la declaración; función/modificador/constructor: cuerpo
        out.push({ text: head, body: body.slice(i + 1, end) });
        i = end + 1; start = i;
        continue;
      } else if (c === ';' && depth === 0) { var t = body.slice(start, i).trim(); if (t) out.push({ text: t, body: null }); start = i + 1; }
      i++;
    }
    var rest = body.slice(start).trim(); if (rest) out.push({ text: rest, body: null });
    return out;
  }
  function collectTypes(list, into) {
    list.forEach(function (m) {
      var ms = /^struct\s+([A-Za-z_]\w*)$/.exec(m.text);
      if (ms && m.body !== null) { into.structs[ms[1]] = { name: ms[1], members: splitTop(m.body, ';').map(function (d) { d = d.replace(/\s+/g, ' ').trim(); var k = d.lastIndexOf(' '); return { type: d.slice(0, k).trim(), name: d.slice(k + 1).trim() }; }) }; return; }
      var me = /^enum\s+([A-Za-z_]\w*)$/.exec(m.text);
      if (me && m.body !== null) { into.enums[me[1]] = splitTop(m.body, ','); return; }
      var mu = /^type\s+([A-Za-z_]\w*)\s+is\s+([A-Za-z0-9_]+)$/.exec(m.text);
      if (mu) into.udvt[mu[1]] = mu[2];
    });
  }
  /** Lista de parámetros "(...)" que empieza en s[i]: { inner, end } */
  function parenAt(s, i) { while (i < s.length && s[i] !== '(') i++; var e = matchClose(s, i); return e < 0 ? null : { inner: s.slice(i + 1, e), end: e + 1 }; }

  function parseMember(ctx, m, kind, out, warnings) {
    var t = m.text.replace(/\s+/g, ' ').trim(), r;
    if (!t) return;
    if (/^(struct|enum|modifier|using|type|pragma|import)\b/.test(t)) return;
    if (/^event\b/.test(t)) {
      var en = /^event\s+([A-Za-z_]\w*)/.exec(t); if (!en) return;
      r = parenAt(t, en[0].length); if (!r) return;
      out.push({ type: 'event', name: en[1], inputs: ctx.params(r.inner, true), anonymous: /\banonymous\b/.test(t.slice(r.end)) });
      return;
    }
    if (/^error\b/.test(t)) {
      var er = /^error\s+([A-Za-z_]\w*)/.exec(t); if (!er) return;
      r = parenAt(t, er[0].length); if (!r) return;
      out.push({ type: 'error', name: er[1], inputs: ctx.params(r.inner) });
      return;
    }
    if (/^constructor\b/.test(t)) {
      r = parenAt(t, 11); if (!r) return;
      out.push({ type: 'constructor', inputs: ctx.params(r.inner), stateMutability: /\bpayable\b/.test(t.slice(r.end)) ? 'payable' : 'nonpayable' });
      return;
    }
    if (/^receive\s*\(/.test(t)) { out.push({ type: 'receive', stateMutability: 'payable' }); return; }
    if (/^fallback\s*\(/.test(t)) { out.push({ type: 'fallback', stateMutability: /\bpayable\b/.test(t) ? 'payable' : 'nonpayable' }); return; }
    if (/^function\b/.test(t)) {
      var fn = /^function\s+([A-Za-z_]\w*)/.exec(t); if (!fn) return;
      r = parenAt(t, fn[0].length); if (!r) return;
      var rest = t.slice(r.end), outputs = [];
      var ri = rest.search(/\breturns\s*\(/);
      if (ri >= 0) { var rr = parenAt(rest, ri + 7); if (rr) { outputs = ctx.params(rr.inner); rest = rest.slice(0, ri) + rest.slice(rr.end); } }
      var vis = /\b(public|external|internal|private)\b/.exec(rest);
      var visibility = vis ? vis[1] : (kind === 'interface' ? 'external' : 'public');
      if (visibility !== 'public' && visibility !== 'external') return;
      var mut = /\b(view|pure|payable)\b/.exec(rest);
      out.push({ type: 'function', name: fn[1], inputs: ctx.params(r.inner), outputs: outputs, stateMutability: mut ? mut[1] : 'nonpayable' });
      return;
    }
    if (m.body !== null) return; // otros bloques (assembly suelto, etc.)
    // variable de estado: TIPO [modificadores] NOMBRE [= valor]
    var decl = t, dq = 0;
    for (var qi = 0; qi < t.length; qi++) { var ch = t[qi]; if (ch === '(' || ch === '[') dq++; else if (ch === ')' || ch === ']') dq--; else if (ch === '=' && dq === 0 && t[qi + 1] !== '>' && t[qi + 1] !== '=') { decl = t.slice(0, qi); break; } }
    decl = decl.trim();
    if (!/\bpublic\b/.test(decl)) return;
    var mname = /([A-Za-z_]\w*)\s*$/.exec(decl); if (!mname) return;
    var typeStr = decl.slice(0, decl.length - mname[0].length).replace(/\b(public|private|internal|constant|immutable|override(\s*\([^)]*\))?|transient)\b/g, ' ').trim();
    try { out.push(ctx.getter(typeStr, mname[1])); } catch (e) { warnings.push('Variable «' + mname[1] + '»: ' + e.message); }
  }
  function sig(f) { return f.type + ':' + (f.name || '') + '(' + (f.inputs || []).map(function (i) { return i.type; }).join(',') + ')'; }

  /** Analiza un archivo de Solidity */
  Sol.parse = function (source) {
    var src = strip(String(source || '')), file = { byName: {}, structs: {}, enums: {}, udvt: {}, order: [] }, errors = [];
    if (src.length > 1000000) return { contracts: [], errors: ['El archivo es demasiado grande (máx. 1 MB)'] };
    // declaraciones de primer nivel
    // la cabecera va hasta la primera { o ; (tabla precalculada: con una expresión «[^{;]*\{» un texto con muchos
    // «contract x» sin llaves costaba O(n²) y congelaba el editor varios segundos)
    var nextStop = new Int32Array(src.length + 1); nextStop[src.length] = -1;
    for (var si = src.length - 1; si >= 0; si--) { var sc = src.charCodeAt(si); nextStop[si] = sc === 123 || sc === 59 ? si : nextStop[si + 1]; }
    var re = /\b(abstract\s+contract|contract|interface|library)\s+([A-Za-z_]\w*)/g, m, spans = [];
    while ((m = re.exec(src))) {
      var stop = nextStop[m.index + m[0].length];
      if (stop < 0) break;
      if (src.charCodeAt(stop) !== 123) { re.lastIndex = stop + 1; continue; } // declaración sin cuerpo
      m[3] = src.slice(m.index + m[0].length, stop);
      var open = stop, close = matchClose(src, open);
      if (close < 0) { errors.push('Falta una llave de cierre en «' + m[2] + '»'); break; }
      var bases = [], bm = /\bis\b([\s\S]*)$/.exec(m[3]);
      if (bm) bases = splitTop(bm[1], ',').map(function (b) { return b.replace(/\(.*$/, '').trim(); }).filter(Boolean);
      var c = { name: m[2], kind: m[1].indexOf('abstract') === 0 ? 'abstract' : m[1], bases: bases, body: src.slice(open + 1, close), structs: {}, enums: {}, udvt: {}, own: [], warnings: [] };
      file.byName[c.name] = c; file.order.push(c); spans.push([m.index, close + 1]);
      re.lastIndex = close + 1;
    }
    // structs/enums de nivel de archivo (fuera de los contratos)
    var outside = ''; var last = 0; spans.forEach(function (sp) { outside += src.slice(last, sp[0]) + ';'; last = sp[1]; }); outside += src.slice(last);
    collectTypes(members(outside), file);
    file.order.forEach(function (c) { c.mem = members(c.body); collectTypes(c.mem, c); });
    file.order.forEach(function (c) {
      var ctx = new Ctx(file, c);
      c.mem.forEach(function (mm) { try { parseMember(ctx, mm, c.kind, c.own, c.warnings); } catch (e) { c.warnings.push((mm.text.slice(0, 60) || 'declaración') + ': ' + e.message); } });
    });
    // herencia (solo dentro del archivo): primero las bases, lo propio sustituye a lo heredado con la misma firma
    var resolved = {};
    var resolve = function (c, depth) {
      if (resolved[c.name]) return resolved[c.name];
      if (depth > 32) return c.own;
      var map = {}, order = [];
      c.bases.forEach(function (bn) {
        var b = file.byName[bn];
        if (!b) { c.warnings.push('No se encontró «' + bn + '» en este archivo (¿import?): sus funciones no están en el ABI'); return; }
        resolve(b, depth + 1).forEach(function (f) { if (f.type === 'constructor') return; var k = sig(f); if (!map[k]) order.push(k); map[k] = f; });
      });
      c.own.forEach(function (f) { var k = sig(f); if (!map[k]) order.push(k); map[k] = f; });
      return (resolved[c.name] = order.map(function (k) { return map[k]; }));
    };
    var contracts = file.order.map(function (c) { return { name: c.name, kind: c.kind, bases: c.bases, abi: resolve(c, 0), warnings: c.warnings }; });
    if (!contracts.length && src.trim()) errors.push('No se encontró ningún «contract» en el código');
    return { contracts: contracts, errors: errors };
  };
  /** ABI del contrato principal (el nombrado, o el último contrato no abstracto) */
  Sol.abiFor = function (source, name) {
    var r = Sol.parse(source), list = r.contracts;
    var c = (name && list.find(function (x) { return x.name === name; })) || list.filter(function (x) { return x.kind === 'contract'; }).pop() || list[list.length - 1];
    if (!c) return { name: null, abi: [], warnings: r.errors };
    return { name: c.name, abi: c.abi, warnings: r.errors.concat(c.warnings), kind: c.kind };
  };
  /** Nombre del primer contrato (para renombrar al crear desde una plantilla) */
  Sol.contractNames = function (source) { return Sol.parse(source).contracts.map(function (c) { return c.name; }); };

  /* ---------------------------------------------------------------- plantillas */
  var HEAD = '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n\n';
  var OWNABLE = '    address public owner;\n\n    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);\n    error NotOwner();\n    error ZeroAddress();\n\n' +
    '    modifier onlyOwner() {\n        if (msg.sender != owner) revert NotOwner();\n        _;\n    }\n\n' +
    '    function transferOwnership(address newOwner) external onlyOwner {\n        if (newOwner == address(0)) revert ZeroAddress();\n        emit OwnershipTransferred(owner, newOwner);\n        owner = newOwner;\n    }\n\n';
  Sol.TEMPLATES = {
    erc20: { label: 'Token ERC-20 (monedas del juego)', icon: '🪙', name: 'Oro', args: ['1000000'], mock: { name: 'Oro', symbol: 'ORO', decimals: 18, totalSupply: '1000000000000000000000000', balanceOf: '250000000000000000000', allowance: '0', owner: '{cuenta}', transfer: true, approve: true },
      source: function (N) { return HEAD + '/// ' + N + ': token ERC-20 sin dependencias. El dueño (tu cuenta o tu backend) puede acuñar recompensas.\ncontract ' + N + ' {\n' +
        '    string public name = "' + N + '";\n    string public symbol = "' + N.slice(0, 4).toUpperCase() + '";\n    uint8 public constant decimals = 18;\n    uint256 public totalSupply;\n' +
        '    mapping(address => uint256) public balanceOf;\n    mapping(address => mapping(address => uint256)) public allowance;\n\n' +
        '    event Transfer(address indexed from, address indexed to, uint256 value);\n    event Approval(address indexed owner, address indexed spender, uint256 value);\n' +
        '    error InsufficientBalance(uint256 available, uint256 required);\n    error InsufficientAllowance(uint256 available, uint256 required);\n\n' + OWNABLE +
        '    constructor(uint256 initialSupply) {\n        owner = msg.sender;\n        emit OwnershipTransferred(address(0), msg.sender);\n        _mint(msg.sender, initialSupply * 10 ** uint256(decimals));\n    }\n\n' +
        '    function transfer(address to, uint256 value) external returns (bool) {\n        _transfer(msg.sender, to, value);\n        return true;\n    }\n\n' +
        '    function approve(address spender, uint256 value) external returns (bool) {\n        if (spender == address(0)) revert ZeroAddress();\n        allowance[msg.sender][spender] = value;\n        emit Approval(msg.sender, spender, value);\n        return true;\n    }\n\n' +
        '    function transferFrom(address from, address to, uint256 value) external returns (bool) {\n        uint256 allowed = allowance[from][msg.sender];\n        if (allowed != type(uint256).max) {\n            if (allowed < value) revert InsufficientAllowance(allowed, value);\n            unchecked { allowance[from][msg.sender] = allowed - value; }\n        }\n        _transfer(from, to, value);\n        return true;\n    }\n\n' +
        '    /// Recompensas: solo el dueño puede crear monedas nuevas.\n    function mint(address to, uint256 value) external onlyOwner {\n        _mint(to, value);\n    }\n\n' +
        '    function burn(uint256 value) external {\n        uint256 bal = balanceOf[msg.sender];\n        if (bal < value) revert InsufficientBalance(bal, value);\n        unchecked {\n            balanceOf[msg.sender] = bal - value;\n            totalSupply -= value;\n        }\n        emit Transfer(msg.sender, address(0), value);\n    }\n\n' +
        '    function _transfer(address from, address to, uint256 value) internal {\n        if (to == address(0)) revert ZeroAddress();\n        uint256 bal = balanceOf[from];\n        if (bal < value) revert InsufficientBalance(bal, value);\n        unchecked {\n            balanceOf[from] = bal - value;\n            balanceOf[to] += value;\n        }\n        emit Transfer(from, to, value);\n    }\n\n' +
        '    function _mint(address to, uint256 value) internal {\n        if (to == address(0)) revert ZeroAddress();\n        totalSupply += value;\n        unchecked { balanceOf[to] += value; }\n        emit Transfer(address(0), to, value);\n    }\n}\n'; } },
    erc721: { label: 'NFT ERC-721 (objetos únicos, skins)', icon: '🖼️', name: 'Reliquias', args: ['https://mi-juego.example/nft/'], mock: { name: 'Reliquias', symbol: 'RELI', balanceOf: 2, ownerOf: '{cuenta}', totalSupply: 12, tokenURI: 'https://mi-juego.example/nft/1.json', supportsInterface: true, mint: 13 },
      source: function (N) { return HEAD + 'interface IERC721Receiver {\n    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);\n}\n\n' +
        '/// ' + N + ': NFT ERC-721 sin dependencias (objetos únicos del juego). El dueño acuña; los jugadores los intercambian.\ncontract ' + N + ' {\n' +
        '    string public name = "' + N + '";\n    string public symbol = "' + N.slice(0, 4).toUpperCase() + '";\n    uint256 public totalSupply;\n    string private baseURI;\n' +
        '    mapping(uint256 => address) private _owners;\n    mapping(address => uint256) private _balances;\n    mapping(uint256 => address) public getApproved;\n    mapping(address => mapping(address => bool)) public isApprovedForAll;\n\n' +
        '    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);\n    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);\n    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);\n' +
        '    error NotAuthorized();\n    error InvalidToken(uint256 tokenId);\n    error UnsafeRecipient();\n\n' + OWNABLE +
        '    constructor(string memory baseURI_) {\n        owner = msg.sender;\n        baseURI = baseURI_;\n        emit OwnershipTransferred(address(0), msg.sender);\n    }\n\n' +
        '    function supportsInterface(bytes4 id) external pure returns (bool) {\n        return id == 0x01ffc9a7 || id == 0x80ac58cd || id == 0x5b5e139f; // ERC-165, ERC-721, metadatos\n    }\n\n' +
        '    function balanceOf(address account) external view returns (uint256) {\n        if (account == address(0)) revert ZeroAddress();\n        return _balances[account];\n    }\n\n' +
        '    function ownerOf(uint256 tokenId) public view returns (address o) {\n        o = _owners[tokenId];\n        if (o == address(0)) revert InvalidToken(tokenId);\n    }\n\n' +
        '    function tokenURI(uint256 tokenId) external view returns (string memory) {\n        ownerOf(tokenId);\n        return string(abi.encodePacked(baseURI, _toString(tokenId), ".json"));\n    }\n\n' +
        '    function approve(address to, uint256 tokenId) external {\n        address o = ownerOf(tokenId);\n        if (msg.sender != o && !isApprovedForAll[o][msg.sender]) revert NotAuthorized();\n        getApproved[tokenId] = to;\n        emit Approval(o, to, tokenId);\n    }\n\n' +
        '    function setApprovalForAll(address operator, bool approved) external {\n        isApprovedForAll[msg.sender][operator] = approved;\n        emit ApprovalForAll(msg.sender, operator, approved);\n    }\n\n' +
        '    function transferFrom(address from, address to, uint256 tokenId) public {\n        address o = ownerOf(tokenId);\n        if (o != from) revert NotAuthorized();\n        if (to == address(0)) revert ZeroAddress();\n        if (msg.sender != o && msg.sender != getApproved[tokenId] && !isApprovedForAll[o][msg.sender]) revert NotAuthorized();\n        delete getApproved[tokenId];\n        unchecked {\n            _balances[from] -= 1;\n            _balances[to] += 1;\n        }\n        _owners[tokenId] = to;\n        emit Transfer(from, to, tokenId);\n    }\n\n' +
        '    function safeTransferFrom(address from, address to, uint256 tokenId) external {\n        safeTransferFrom(from, to, tokenId, "");\n    }\n\n' +
        '    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {\n        transferFrom(from, to, tokenId);\n        if (to.code.length > 0) {\n            try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) returns (bytes4 r) {\n                if (r != IERC721Receiver.onERC721Received.selector) revert UnsafeRecipient();\n            } catch {\n                revert UnsafeRecipient();\n            }\n        }\n    }\n\n' +
        '    /// Acuña un objeto nuevo para un jugador. Devuelve su número.\n    function mint(address to) external onlyOwner returns (uint256 tokenId) {\n        if (to == address(0)) revert ZeroAddress();\n        tokenId = ++totalSupply;\n        _owners[tokenId] = to;\n        unchecked { _balances[to] += 1; }\n        emit Transfer(address(0), to, tokenId);\n    }\n\n' +
        '    function setBaseURI(string calldata uri) external onlyOwner {\n        baseURI = uri;\n    }\n\n' +
        '    function _toString(uint256 v) internal pure returns (string memory) {\n        if (v == 0) return "0";\n        uint256 len;\n        for (uint256 t = v; t != 0; t /= 10) len++;\n        bytes memory b = new bytes(len);\n        while (v != 0) {\n            len--;\n            b[len] = bytes1(uint8(48 + (v % 10)));\n            v /= 10;\n        }\n        return string(b);\n    }\n}\n'; } },
    erc1155: { label: 'Multi-token ERC-1155 (inventario: pociones, espadas…)', icon: '🎒', name: 'Inventario', args: ['https://mi-juego.example/items/{id}.json'], mock: { balanceOf: 3, balanceOfBatch: [3, 0, 12], uri: 'https://mi-juego.example/items/{id}.json', isApprovedForAll: false, supportsInterface: true },
      source: function (N) { return HEAD + 'interface IERC1155Receiver {\n    function onERC1155Received(address operator, address from, uint256 id, uint256 value, bytes calldata data) external returns (bytes4);\n    function onERC1155BatchReceived(address operator, address from, uint256[] calldata ids, uint256[] calldata values, bytes calldata data) external returns (bytes4);\n}\n\n' +
        '/// ' + N + ': ERC-1155 sin dependencias. Cada id es un tipo de objeto (1 = poción, 2 = espada…) con cantidades.\ncontract ' + N + ' {\n' +
        '    string private _uri;\n    mapping(uint256 => mapping(address => uint256)) private _balances;\n    mapping(address => mapping(address => bool)) public isApprovedForAll;\n\n' +
        '    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);\n    event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values);\n    event ApprovalForAll(address indexed account, address indexed operator, bool approved);\n    event URI(string value, uint256 indexed id);\n' +
        '    error NotAuthorized();\n    error LengthMismatch();\n    error InsufficientBalance(uint256 id, uint256 available, uint256 required);\n    error UnsafeRecipient();\n\n' + OWNABLE +
        '    constructor(string memory uri_) {\n        owner = msg.sender;\n        _uri = uri_;\n        emit OwnershipTransferred(address(0), msg.sender);\n    }\n\n' +
        '    function supportsInterface(bytes4 id) external pure returns (bool) {\n        return id == 0x01ffc9a7 || id == 0xd9b67a26 || id == 0x0e89341c;\n    }\n\n' +
        '    function uri(uint256) external view returns (string memory) {\n        return _uri;\n    }\n\n' +
        '    function balanceOf(address account, uint256 id) public view returns (uint256) {\n        if (account == address(0)) revert ZeroAddress();\n        return _balances[id][account];\n    }\n\n' +
        '    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids) external view returns (uint256[] memory out) {\n        if (accounts.length != ids.length) revert LengthMismatch();\n        out = new uint256[](accounts.length);\n        for (uint256 i = 0; i < accounts.length; i++) out[i] = balanceOf(accounts[i], ids[i]);\n    }\n\n' +
        '    function setApprovalForAll(address operator, bool approved) external {\n        isApprovedForAll[msg.sender][operator] = approved;\n        emit ApprovalForAll(msg.sender, operator, approved);\n    }\n\n' +
        '    function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes calldata data) external {\n        if (from != msg.sender && !isApprovedForAll[from][msg.sender]) revert NotAuthorized();\n        if (to == address(0)) revert ZeroAddress();\n        _move(from, to, id, value);\n        emit TransferSingle(msg.sender, from, to, id, value);\n        if (to.code.length > 0) {\n            try IERC1155Receiver(to).onERC1155Received(msg.sender, from, id, value, data) returns (bytes4 r) {\n                if (r != IERC1155Receiver.onERC1155Received.selector) revert UnsafeRecipient();\n            } catch {\n                revert UnsafeRecipient();\n            }\n        }\n    }\n\n' +
        '    function safeBatchTransferFrom(address from, address to, uint256[] calldata ids, uint256[] calldata values, bytes calldata data) external {\n        if (from != msg.sender && !isApprovedForAll[from][msg.sender]) revert NotAuthorized();\n        if (to == address(0)) revert ZeroAddress();\n        if (ids.length != values.length) revert LengthMismatch();\n        for (uint256 i = 0; i < ids.length; i++) _move(from, to, ids[i], values[i]);\n        emit TransferBatch(msg.sender, from, to, ids, values);\n        if (to.code.length > 0) {\n            try IERC1155Receiver(to).onERC1155BatchReceived(msg.sender, from, ids, values, data) returns (bytes4 r) {\n                if (r != IERC1155Receiver.onERC1155BatchReceived.selector) revert UnsafeRecipient();\n            } catch {\n                revert UnsafeRecipient();\n            }\n        }\n    }\n\n' +
        '    /// Da objetos a un jugador (recompensas, compras validadas por tu backend).\n    function mint(address to, uint256 id, uint256 value) external onlyOwner {\n        if (to == address(0)) revert ZeroAddress();\n        _balances[id][to] += value;\n        emit TransferSingle(msg.sender, address(0), to, id, value);\n    }\n\n' +
        '    function burn(uint256 id, uint256 value) external {\n        uint256 bal = _balances[id][msg.sender];\n        if (bal < value) revert InsufficientBalance(id, bal, value);\n        unchecked { _balances[id][msg.sender] = bal - value; }\n        emit TransferSingle(msg.sender, msg.sender, address(0), id, value);\n    }\n\n' +
        '    function setURI(string calldata uri_) external onlyOwner {\n        _uri = uri_;\n    }\n\n' +
        '    function _move(address from, address to, uint256 id, uint256 value) internal {\n        uint256 bal = _balances[id][from];\n        if (bal < value) revert InsufficientBalance(id, bal, value);\n        unchecked { _balances[id][from] = bal - value; }\n        _balances[id][to] += value;\n    }\n}\n'; } },
    leaderboard: { label: 'Clasificación en cadena (top 10)', icon: '🏆', name: 'Clasificacion', args: [], mock: { count: 3, best: 1200, nameOf: 'jugador', topScores: [['{cuenta}', 1200, 1700000000]] },
      source: function (N) { return HEAD + '/// ' + N + ': las 10 mejores puntuaciones guardadas en la cadena.\n/// Ojo: cualquiera puede enviar cualquier número. Para un juego serio, que tu servidor firme las puntuaciones (ver la plantilla de recompensas).\ncontract ' + N + ' {\n' +
        '    struct Entry {\n        address player;\n        uint256 score;\n        uint64 time;\n    }\n\n    uint256 public constant MAX = 10;\n    Entry[] private top;\n    mapping(address => uint256) public best;\n    mapping(address => string) public nameOf;\n\n' +
        '    event NewScore(address indexed player, uint256 score, uint256 rank);\n    error NameTooLong();\n\n' +
        '    function setName(string calldata n) external {\n        if (bytes(n).length > 24) revert NameTooLong();\n        nameOf[msg.sender] = n;\n    }\n\n' +
        '    function submitScore(uint256 score) external {\n        if (score <= best[msg.sender]) return;\n        best[msg.sender] = score;\n        for (uint256 i = 0; i < top.length; i++) {\n            if (top[i].player == msg.sender) {\n                for (uint256 j = i; j + 1 < top.length; j++) top[j] = top[j + 1];\n                top.pop();\n                break;\n            }\n        }\n        uint256 pos = top.length;\n        while (pos > 0 && top[pos - 1].score < score) pos--;\n        if (pos >= MAX) return;\n        Entry memory e = Entry(msg.sender, score, uint64(block.timestamp));\n        top.push(e);\n        for (uint256 k = top.length - 1; k > pos; k--) top[k] = top[k - 1];\n        top[pos] = e;\n        if (top.length > MAX) top.pop();\n        emit NewScore(msg.sender, score, pos + 1);\n    }\n\n' +
        '    function topScores() external view returns (Entry[] memory) {\n        return top;\n    }\n\n    function count() external view returns (uint256) {\n        return top.length;\n    }\n}\n'; } },
    shop: { label: 'Tienda de objetos (pagos en ETH)', icon: '🛒', name: 'Tienda', args: [], mock: { itemCount: 2, items: ['Espada', '10000000000000000', 50, true], owned: 1, owner: '{cuenta}' },
      source: function (N) { return HEAD + '/// ' + N + ': tienda con precios en ETH. Protegida contra reentrada; el dueño retira lo recaudado.\ncontract ' + N + ' {\n' +
        '    struct Item {\n        string name;\n        uint256 price;\n        uint256 stock;\n        bool active;\n    }\n\n    uint256 public itemCount;\n    mapping(uint256 => Item) public items;\n    mapping(address => mapping(uint256 => uint256)) public owned;\n    bool private locked;\n\n' +
        '    event ItemAdded(uint256 indexed id, string name, uint256 price, uint256 stock);\n    event Purchased(address indexed buyer, uint256 indexed id, uint256 amount, uint256 paid);\n    event Withdrawn(address indexed to, uint256 amount);\n' +
        '    error InactiveItem(uint256 id);\n    error SoldOut(uint256 id);\n    error WrongPayment(uint256 expected, uint256 sent);\n    error TransferFailed();\n    error Reentrancy();\n\n' + OWNABLE +
        '    modifier nonReentrant() {\n        if (locked) revert Reentrancy();\n        locked = true;\n        _;\n        locked = false;\n    }\n\n' +
        '    constructor() {\n        owner = msg.sender;\n        emit OwnershipTransferred(address(0), msg.sender);\n    }\n\n' +
        '    function addItem(string calldata itemName, uint256 price, uint256 stock) external onlyOwner returns (uint256 id) {\n        id = ++itemCount;\n        items[id] = Item(itemName, price, stock, true);\n        emit ItemAdded(id, itemName, price, stock);\n    }\n\n' +
        '    function setItem(uint256 id, uint256 price, uint256 stock, bool active) external onlyOwner {\n        Item storage it = items[id];\n        it.price = price;\n        it.stock = stock;\n        it.active = active;\n    }\n\n' +
        '    function buy(uint256 id, uint256 amount) external payable nonReentrant {\n        Item storage it = items[id];\n        if (!it.active) revert InactiveItem(id);\n        if (it.stock < amount) revert SoldOut(id);\n        uint256 cost = it.price * amount;\n        if (msg.value != cost) revert WrongPayment(cost, msg.value);\n        it.stock -= amount;\n        owned[msg.sender][id] += amount;\n        emit Purchased(msg.sender, id, amount, msg.value);\n    }\n\n' +
        '    function withdraw(address payable to) external onlyOwner nonReentrant {\n        if (to == address(0)) revert ZeroAddress();\n        uint256 amount = address(this).balance;\n        (bool ok, ) = to.call{value: amount}("");\n        if (!ok) revert TransferFailed();\n        emit Withdrawn(to, amount);\n    }\n}\n'; } },
    rewards: { label: 'Recompensas firmadas por tu servidor', icon: '🎁', name: 'Recompensas', args: ['0x0000000000000000000000000000000000000001'], mock: { signer: '0x0000000000000000000000000000000000000001', nonces: 0, claimed: 0, totalClaimed: 0 },
      source: function (N) { return HEAD + '/// ' + N + ': premios en ETH que el jugador reclama con una firma de TU servidor (así nadie puede inventarse premios).\n/// El servidor firma keccak256(jugador, cantidad, nonce, caducidad, contrato, chainId) con personal_sign (EIP-191).\ncontract ' + N + ' {\n' +
        '    address public signer;\n    mapping(address => uint256) public nonces;\n    mapping(address => uint256) public claimed;\n    uint256 public totalClaimed;\n\n' +
        '    event Claimed(address indexed player, uint256 amount, uint256 nonce);\n    error BadSignature();\n    error Expired();\n    error InsufficientFunds();\n    error TransferFailed();\n\n' + OWNABLE +
        '    constructor(address signer_) payable {\n        if (signer_ == address(0)) revert ZeroAddress();\n        owner = msg.sender;\n        signer = signer_;\n        emit OwnershipTransferred(address(0), msg.sender);\n    }\n\n' +
        '    receive() external payable {}\n\n' +
        '    function setSigner(address s) external onlyOwner {\n        if (s == address(0)) revert ZeroAddress();\n        signer = s;\n    }\n\n' +
        '    function claim(uint256 amount, uint256 deadline, bytes calldata signature) external {\n        if (block.timestamp > deadline) revert Expired();\n        uint256 nonce = nonces[msg.sender];\n        bytes32 h = keccak256(abi.encodePacked(msg.sender, amount, nonce, deadline, address(this), block.chainid));\n        bytes32 digest = keccak256(abi.encodePacked("\\x19Ethereum Signed Message:\\n32", h));\n        if (_recover(digest, signature) != signer) revert BadSignature();\n        if (address(this).balance < amount) revert InsufficientFunds();\n        nonces[msg.sender] = nonce + 1;\n        claimed[msg.sender] += amount;\n        totalClaimed += amount;\n        (bool ok, ) = payable(msg.sender).call{value: amount}("");\n        if (!ok) revert TransferFailed();\n        emit Claimed(msg.sender, amount, nonce);\n    }\n\n' +
        '    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {\n        if (sig.length != 65) return address(0);\n        bytes32 r;\n        bytes32 s;\n        uint8 v;\n        assembly {\n            r := calldataload(sig.offset)\n            s := calldataload(add(sig.offset, 32))\n            v := byte(0, calldataload(add(sig.offset, 64)))\n        }\n        // firmas maleables (s alto) no válidas\n        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);\n        if (v < 27) v += 27;\n        return ecrecover(digest, v, r, s);\n    }\n}\n'; } },
    blank: { label: 'Contrato vacío', icon: '📄', name: 'MiContrato', args: [], mock: { value: 42 },
      source: function (N) { return HEAD + 'contract ' + N + ' {\n    uint256 public value;\n\n    event Changed(address indexed by, uint256 value);\n\n    function set(uint256 v) external {\n        value = v;\n        emit Changed(msg.sender, v);\n    }\n}\n'; } }
  };

  /* ---------------------------------------------------------------- exportar a Hardhat / Foundry */
  /** Archivos de un proyecto Hardhat: [{ path, text }] */
  Sol.hardhatFiles = function (contracts, chainName) {
    var files = [];
    files.push({ path: 'package.json', text: JSON.stringify({ name: 'contratos-del-juego', private: true, scripts: { compile: 'hardhat compile', test: 'hardhat test', deploy: 'hardhat run scripts/deploy.js --network sepolia', node: 'hardhat node' }, devDependencies: { hardhat: '^2.22.0', '@nomicfoundation/hardhat-toolbox': '^5.0.0' } }, null, 2) + '\n' });
    files.push({ path: 'hardhat.config.js', text: "require('@nomicfoundation/hardhat-toolbox');\n\n// Claves en variables de entorno (NUNCA en el código): SEPOLIA_RPC_URL y DEPLOYER_KEY\nmodule.exports = {\n  solidity: { version: '0.8.24', settings: { optimizer: { enabled: true, runs: 200 } } },\n  networks: {\n    sepolia: { url: process.env.SEPOLIA_RPC_URL || '', accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [] }\n  }\n};\n" });
    var deploy = "const hre = require('hardhat');\n\nasync function main() {\n";
    contracts.forEach(function (c) {
      files.push({ path: 'contracts/' + c.name + '.sol', text: c.source });
      var args = (c.args || []).map(function (a) { return JSON.stringify(String(a)); }).join(', ');
      deploy += "  const " + c.name + " = await hre.ethers.deployContract('" + c.name + "'" + (args ? ', [' + args + ']' : '') + ");\n  await " + c.name + ".waitForDeployment();\n  console.log('" + c.name + ":', await " + c.name + ".getAddress());\n";
    });
    deploy += "}\n\nmain().catch((e) => { console.error(e); process.exitCode = 1; });\n";
    files.push({ path: 'scripts/deploy.js', text: deploy });
    files.push({ path: 'README.md', text: '# Contratos del juego (Hardhat)\n\n1. `npm install`\n2. `npx hardhat compile`\n3. Define `SEPOLIA_RPC_URL` y `DEPLOYER_KEY` (una cuenta de pruebas) y ejecuta `npm run deploy`.\n4. Copia las direcciones en la pestaña Web3 del Studio (red ' + (chainName || 'Sepolia') + ').\n\nEl bytecode compilado está en `artifacts/contracts/<Nombre>.sol/<Nombre>.json` (campo `bytecode`): pégalo en el Studio si quieres desplegar desde allí.\n' });
    return files;
  };
  Sol.foundryFiles = function (contracts) {
    var files = [{ path: 'foundry.toml', text: '[profile.default]\nsrc = "src"\nout = "out"\nlibs = ["lib"]\nsolc_version = "0.8.24"\noptimizer = true\noptimizer_runs = 200\n' }];
    var script = '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n\nimport {Script, console} from "forge-std/Script.sol";\n';
    contracts.forEach(function (c) { files.push({ path: 'src/' + c.name + '.sol', text: c.source }); script += 'import {' + c.name + '} from "../src/' + c.name + '.sol";\n'; });
    script += '\ncontract Deploy is Script {\n    function run() external {\n        vm.startBroadcast();\n';
    contracts.forEach(function (c) {
      var args = (c.args || []).map(function (a) { a = String(a); return /^0x[0-9a-fA-F]{40}$/.test(a) ? a : /^\d+$/.test(a) ? a : JSON.stringify(a); }).join(', ');
      script += '        ' + c.name + ' c' + c.name + ' = new ' + c.name + '(' + args + ');\n        console.log("' + c.name + '", address(c' + c.name + '));\n';
    });
    script += '        vm.stopBroadcast();\n    }\n}\n';
    files.push({ path: 'script/Deploy.s.sol', text: script });
    files.push({ path: 'README.md', text: '# Contratos del juego (Foundry)\n\n1. `forge install foundry-rs/forge-std`\n2. `forge build`\n3. `forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --account <tu-cuenta> --broadcast`\n\nEl bytecode está en `out/<Nombre>.sol/<Nombre>.json` (`bytecode.object`).\n' });
    return files;
  };

  root.UGStudio = root.UGStudio || {};
  root.UGStudio.solidity = Sol;
  if (typeof module !== 'undefined' && module.exports) module.exports = Sol;
})(typeof window !== 'undefined' ? window : globalThis);
