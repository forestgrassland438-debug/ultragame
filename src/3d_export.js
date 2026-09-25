/* UltraGame 3D - exportador glTF 2.0 / GLB + codificador PNG mínimo.
 * Exporta nodos, mallas, materiales PBR, texturas, esqueletos, animaciones, cámaras y luces (KHR_lights_punctual)
 * para abrirlos en Blender, en otros motores o volver a cargarlos con this.load.gltf. Funciona también en Node. */

var _crcTable = null;
function crc32(bytes, start, end, crc) {
  if (!_crcTable) { _crcTable = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; _crcTable[n] = c >>> 0; } }
  crc = crc === undefined ? 0xFFFFFFFF : crc;
  for (var i = start; i < end; i++) crc = _crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return crc;
}
/** PNG RGBA 8 bits (deflate "stored": sin compresión, siempre válido y rápido) */
function encodePNG(width, height, rgba) {
  width = width | 0; height = height | 0;
  if (width < 1 || height < 1 || rgba.length < width * height * 4) throw new Error('encodePNG: datos inválidos');
  var row = width * 4 + 1, raw = new Uint8Array(row * height);
  for (var y = 0; y < height; y++) { raw[y * row] = 0; raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * row + 1); }
  var blocks = Math.ceil(raw.length / 65535) || 1, zlen = 2 + raw.length + blocks * 5 + 4, z = new Uint8Array(zlen), o = 0;
  z[o++] = 0x78; z[o++] = 0x01;
  var a = 1, b = 0;
  for (var bi = 0; bi < blocks; bi++) {
    var s = bi * 65535, len = Math.min(65535, raw.length - s);
    z[o++] = bi === blocks - 1 ? 1 : 0; z[o++] = len & 255; z[o++] = len >> 8; z[o++] = ~len & 255; z[o++] = (~len >> 8) & 255;
    z.set(raw.subarray(s, s + len), o); o += len;
    for (var i = s; i < s + len; i++) { a = (a + raw[i]) % 65521; b = (b + a) % 65521; }
  }
  var ad = ((b << 16) | a) >>> 0; z[o++] = ad >>> 24; z[o++] = (ad >>> 16) & 255; z[o++] = (ad >>> 8) & 255; z[o++] = ad & 255;
  var chunks = [], total = 8;
  var chunk = function (type, data) {
    var c = new Uint8Array(12 + data.length), dv = new DataView(c.buffer);
    dv.setUint32(0, data.length); for (var k = 0; k < 4; k++) c[4 + k] = type.charCodeAt(k);
    c.set(data, 8); dv.setUint32(8 + data.length, (crc32(c, 4, 8 + data.length) ^ 0xFFFFFFFF) >>> 0);
    chunks.push(c); total += c.length;
  };
  var ihdr = new Uint8Array(13), hv = new DataView(ihdr.buffer); hv.setUint32(0, width); hv.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 6;
  chunk('IHDR', ihdr); chunk('IDAT', z); chunk('IEND', new Uint8Array(0));
  var out = new Uint8Array(total); out.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  var p = 8; chunks.forEach(function (c) { out.set(c, p); p += c.length; });
  return out;
}

var GLTFExporter = {
  /** Exporta un nodo (y su jerarquía). options: { animations: [AnimationClip3D], name }. Devuelve { json, bin: Uint8Array } */
  export: function (root, options) {
    options = options || {};
    var json = { asset: { version: '2.0', generator: 'UltraGame ' + (UG.VERSION || '') }, scene: 0, scenes: [{ name: options.name || root.name || 'Scene', nodes: [] }], nodes: [], meshes: [], materials: [], textures: [], images: [], samplers: [], accessors: [], bufferViews: [], buffers: [] };
    var parts = [], byteLen = 0, nodeIdx = new Map(), meshCache = new Map(), matCache = new Map(), texCache = new Map(), usedExt = new Set(), skinned = [];
    var align = function () { var pad = (4 - (byteLen % 4)) % 4; if (pad) { parts.push(new Uint8Array(pad)); byteLen += pad; } };
    var view = function (bytes, target, stride) {
      align();
      var v = { buffer: 0, byteOffset: byteLen, byteLength: bytes.byteLength }; if (target) v.target = target; if (stride) v.byteStride = stride;
      parts.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)); byteLen += bytes.byteLength;
      json.bufferViews.push(v); return json.bufferViews.length - 1;
    };
    var accessor = function (arr, type, compType, opts) {
      opts = opts || {};
      var nc = GLTF_NCOMP[type], count = arr.length / nc, acc = { bufferView: view(arr, opts.target), componentType: compType, count: count, type: type };
      if (opts.normalized) acc.normalized = true;
      if (opts.minmax) { var mn = [], mx = []; for (var k = 0; k < nc; k++) { mn[k] = Infinity; mx[k] = -Infinity; } for (var i = 0; i < count; i++) for (var q = 0; q < nc; q++) { var v = arr[i * nc + q]; if (v < mn[q]) mn[q] = v; if (v > mx[q]) mx[q] = v; } if (!count) { mn = mn.map(function () { return 0; }); mx = mx.map(function () { return 0; }); } acc.min = mn; acc.max = mx; }
      json.accessors.push(acc); return json.accessors.length - 1;
    };
    // glTF exige valores finitos: NaN/Infinity se exportan como 0
    var f32 = function (d) { var a = d instanceof Float32Array ? d : new Float32Array(d), bad = false; for (var i = 0; i < a.length; i++) if (!isFinite(a[i])) { bad = true; break; } if (!bad) return a; var c = new Float32Array(a); for (var j = 0; j < c.length; j++) if (!isFinite(c[j])) c[j] = 0; return c; };
    var imageBytes = function (src) {
      var res = src.resource;
      if (!res) return null;
      if (res.data) { var d = res.data instanceof Uint8Array ? res.data : new Uint8Array(res.data.buffer || res.data); if (src.premultiplied) { d = new Uint8Array(d); for (var i = 0; i < d.length; i += 4) { var a = d[i + 3]; if (a > 0 && a < 255) { d[i] = Math.min(255, d[i] * 255 / a); d[i + 1] = Math.min(255, d[i + 1] * 255 / a); d[i + 2] = Math.min(255, d[i + 2] * 255 / a); } } } return encodePNG(res.width, res.height, d); }
      if (!HAS_DOM) return null;
      try {
        var c = createCanvas(src.width, src.height); c.getContext('2d').drawImage(res, 0, 0, src.width, src.height);
        var url = c.toDataURL('image/png'); releaseCanvas(c);
        return base64ToBytes(url.slice(url.indexOf(',') + 1));
      } catch (e) { Log.warnOnce('exportimg', 'Exportar: textura no legible (¿de otro origen sin CORS?)'); return null; }
    };
    var texture = function (tex) {
      if (!tex || !tex.source || tex.source.destroyed) return undefined;
      var src = tex.source, k = texCache.get(src);
      if (k !== undefined) return k === -1 ? undefined : { index: k };
      var bytes = imageBytes(src);
      if (!bytes) { texCache.set(src, -1); return undefined; }
      var wrap = src.wrapMode === 'repeat' ? 10497 : (src.wrapMode === 'mirror' ? 33648 : 33071), filt = src.scaleMode === 'nearest' ? 9728 : 9729;
      json.samplers.push({ magFilter: filt, minFilter: filt === 9728 ? 9984 : 9987, wrapS: wrap, wrapT: wrap });
      json.images.push({ bufferView: view(bytes), mimeType: 'image/png', name: src.label || undefined });
      json.textures.push({ sampler: json.samplers.length - 1, source: json.images.length - 1 });
      texCache.set(src, json.textures.length - 1);
      return { index: json.textures.length - 1 };
    };
    var material = function (m) {
      if (!m) return undefined;
      if (matCache.has(m)) return matCache.get(m);
      var c = m.linearColor, e = m.linearEmissive, ei = m.emissiveIntensity || 1;
      var d = { name: m.name || undefined, pbrMetallicRoughness: { baseColorFactor: [c[0], c[1], c[2], m.opacity], metallicFactor: m.metalness, roughnessFactor: m.roughness } };
      var bt = texture(m.map); if (bt) { d.pbrMetallicRoughness.baseColorTexture = bt; if (m.uvScale.x !== 1 || m.uvScale.y !== 1 || m.uvOffset.x || m.uvOffset.y || m.uvRotation) { bt.extensions = { KHR_texture_transform: { offset: [m.uvOffset.x, m.uvOffset.y], scale: [m.uvScale.x, m.uvScale.y], rotation: -m.uvRotation } }; usedExt.add('KHR_texture_transform'); } }
      var mr = texture(m.metalRoughMap); if (mr) d.pbrMetallicRoughness.metallicRoughnessTexture = mr;
      var nt = texture(m.normalMap); if (nt) { nt.scale = m.normalScale; d.normalTexture = nt; }
      var ot = texture(m.aoMap); if (ot) { ot.strength = m.aoStrength; d.occlusionTexture = ot; }
      var et = texture(m.emissiveMap); if (et) d.emissiveTexture = et;
      var em = Math.max(e[0], e[1], e[2]) * ei;
      if (em > 0) { var sc = em > 1 ? em : 1; d.emissiveFactor = [e[0] * ei / sc, e[1] * ei / sc, e[2] * ei / sc]; if (sc > 1) { d.extensions = { KHR_materials_emissive_strength: { emissiveStrength: sc } }; usedExt.add('KHR_materials_emissive_strength'); } }
      if (m.transparent || m.opacity < 1) d.alphaMode = 'BLEND'; else if (m.alphaTest > 0) { d.alphaMode = 'MASK'; d.alphaCutoff = m.alphaTest; }
      if (m.side === 'double') d.doubleSided = true;
      if (m.unlit) { d.extensions = d.extensions || {}; d.extensions.KHR_materials_unlit = {}; usedExt.add('KHR_materials_unlit'); }
      json.materials.push(d); matCache.set(m, json.materials.length - 1);
      return json.materials.length - 1;
    };
    var mesh = function (msh) {
      var g = msh._geometry; if (!g || !g.attributes.position) return undefined;
      var key = g.uid + ':' + (msh.material ? msh.material.uid : 0), k = meshCache.get(key);
      if (k !== undefined) return k;
      var A = g.attributes, prim = { attributes: {}, mode: 4 };
      prim.attributes.POSITION = accessor(f32(A.position.data), 'VEC3', 5126, { minmax: true, target: 34962 });
      if (A.normal) prim.attributes.NORMAL = accessor(f32(A.normal.data), 'VEC3', 5126, { target: 34962 });
      if (A.uv) prim.attributes.TEXCOORD_0 = accessor(f32(A.uv.data), 'VEC2', 5126, { target: 34962 });
      if (A.color) prim.attributes.COLOR_0 = accessor(f32(A.color.data), A.color.size === 3 ? 'VEC3' : 'VEC4', 5126, { target: 34962 });
      if (A.joints && A.weights) { prim.attributes.JOINTS_0 = accessor(new Uint16Array(A.joints.data), 'VEC4', 5123, { target: 34962 }); prim.attributes.WEIGHTS_0 = accessor(f32(A.weights.data), 'VEC4', 5126, { target: 34962 }); }
      if (g.index) prim.indices = accessor(g.index instanceof Uint32Array ? g.index : new Uint16Array(g.index), 'SCALAR', g.index instanceof Uint32Array ? 5125 : 5123, { target: 34963 });
      var mi = material(msh.material); if (mi !== undefined) prim.material = mi;
      json.meshes.push({ name: msh.name || undefined, primitives: [prim] });
      meshCache.set(key, json.meshes.length - 1);
      return json.meshes.length - 1;
    };
    var trs = function (nd, n) {
      var p = n.position, q = n.quaternion, s = n.scale;
      if (p.x || p.y || p.z) nd.translation = [p.x, p.y, p.z];
      if (q.x || q.y || q.z || q.w !== 1) nd.rotation = [q.x, q.y, q.z, q.w];
      if (s.x !== 1 || s.y !== 1 || s.z !== 1) nd.scale = [s.x, s.y, s.z];
    };
    var extras = function (nd, n) { try { var s = JSON.stringify(n.userData); if (s && s !== '{}') nd.extras = JSON.parse(s); } catch (e) { /* userData no serializable: se omite */ } };
    var lights = [];
    var visit = function (n) {
      var nd = { name: n.name || undefined }, idx = json.nodes.length;
      json.nodes.push(nd); nodeIdx.set(n, idx); trs(nd, n); extras(nd, n);
      if (n instanceof InstancedMesh3D) {
        var tmp = new Mat4(), P = new Vec3(), Q = new Quat(), S = new Vec3(), mi = mesh(n);
        nd.children = [];
        for (var i = 0; i < n.count; i++) {
          tmp.fromArray(n.instanceMatrix, i * 16); tmp.decompose(P, Q, S);
          var ci = json.nodes.length; json.nodes.push({ mesh: mi, translation: [P.x, P.y, P.z], rotation: [Q.x, Q.y, Q.z, Q.w], scale: [S.x, S.y, S.z] }); nd.children.push(ci);
        }
      } else if (n instanceof Mesh3D) {
        var m = mesh(n); if (m !== undefined) nd.mesh = m;
        if (n.billboard) nd.extras = Object.assign(nd.extras || {}, { billboard: n.billboard });
        if (n.skeleton) skinned.push({ node: nd, mesh: n });
      } else if (n instanceof PerspectiveCamera || n instanceof OrthographicCamera) {
        json.cameras = json.cameras || [];
        json.cameras.push(n instanceof PerspectiveCamera ? { type: 'perspective', perspective: { yfov: n.fov * DEG_TO_RAD, aspectRatio: n.aspect, znear: n.near, zfar: n.far } } : { type: 'orthographic', orthographic: { xmag: n.size / 2 * n.aspect, ymag: n.size / 2, znear: n.near, zfar: n.far } });
        nd.camera = json.cameras.length - 1;
      } else if (n instanceof DirectionalLight || n instanceof PointLight || n instanceof SpotLight) {
        var lc = n.linearColor, ld = { color: [lc[0], lc[1], lc[2]], intensity: n instanceof DirectionalLight ? n.intensity : n.intensity * 4 * Math.PI };
        if (n instanceof DirectionalLight) {
          ld.type = 'directional';
          // la luz de UltraGame usa "direction": se orienta el nodo para que su -Z apunte ahí
          var dq = new Quat(), lm = new Mat4().lookAt(new Vec3(0, 0, 0), n.direction.clone(), Math.abs(n.direction.y) > 0.99 ? new Vec3(0, 0, 1) : Vec3.UP); dq.setFromRotationMatrix(lm);
          nd.rotation = [dq.x, dq.y, dq.z, dq.w];
        } else if (n instanceof SpotLight) { ld.type = 'spot'; ld.range = n.range; ld.spot = { outerConeAngle: n.angle, innerConeAngle: n.angle * (1 - n.penumbra) }; }
        else { ld.type = 'point'; ld.range = n.range; }
        lights.push(ld); nd.extensions = { KHR_lights_punctual: { light: lights.length - 1 } }; usedExt.add('KHR_lights_punctual');
      }
      var kids = [];
      for (var c = 0; c < n.children.length; c++) kids.push(visit(n.children[c]));
      if (kids.length) nd.children = (nd.children || []).concat(kids);
      return idx;
    };
    json.scenes[0].nodes.push(visit(root));
    // esqueletos
    var skinCache = new Map();
    skinned.forEach(function (s) {
      var sk = s.mesh.skeleton, si = skinCache.get(sk);
      if (si === undefined) {
        var joints = sk.bones.map(function (b) { return nodeIdx.get(b); });
        if (joints.some(function (j) { return j === undefined; })) { Log.warnOnce('exportskin', 'Exportar: huesos fuera de la jerarquía exportada; se omite el esqueleto'); return; }
        json.skins = json.skins || [];
        json.skins.push({ joints: joints, inverseBindMatrices: accessor(new Float32Array(sk.inverseBind), 'MAT4', 5126) });
        si = json.skins.length - 1; skinCache.set(sk, si);
      }
      s.node.skin = si;
    });
    // animaciones
    var clips = options.animations || root.animations || [];
    clips.forEach(function (clip) {
      var an = { name: clip.name, channels: [], samplers: [] };
      clip.tracks.forEach(function (tr) {
        var node = typeof tr.target === 'number' ? (root._nodeMap ? root._nodeMap[tr.target] : null) : (root.name === tr.target ? root : root.getObjectByName(tr.target));
        var ni = node ? nodeIdx.get(node) : undefined; if (ni === undefined) return;
        var inp = accessor(f32(tr.times), 'SCALAR', 5126, { minmax: true }), out = accessor(f32(tr.values), tr.path === 'quaternion' ? 'VEC4' : 'VEC3', 5126);
        an.samplers.push({ input: inp, output: out, interpolation: tr.interpolation || 'LINEAR' });
        an.channels.push({ sampler: an.samplers.length - 1, target: { node: ni, path: tr.path === 'position' ? 'translation' : tr.path === 'quaternion' ? 'rotation' : 'scale' } });
      });
      if (an.channels.length) { json.animations = json.animations || []; json.animations.push(an); }
    });
    if (lights.length) json.extensions = { KHR_lights_punctual: { lights: lights } };
    if (usedExt.size) json.extensionsUsed = Array.from(usedExt);
    ['meshes', 'materials', 'textures', 'images', 'samplers', 'accessors', 'bufferViews'].forEach(function (k) { if (!json[k].length) delete json[k]; });
    align();
    var bin = new Uint8Array(byteLen), o = 0;
    parts.forEach(function (p) { bin.set(p, o); o += p.length; });
    if (byteLen) json.buffers = [{ byteLength: byteLen }]; else delete json.buffers;
    return { json: json, bin: bin };
  },
  /** Empaqueta en GLB (ArrayBuffer) */
  toGLB: function (json, bin) {
    var enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
    var js = JSON.stringify(json), jb = enc ? enc.encode(js) : toBytes(unescape(encodeURIComponent(js)));
    var jpad = (4 - (jb.length % 4)) % 4, blen = bin ? bin.length : 0, bpad = (4 - (blen % 4)) % 4;
    var total = 12 + 8 + jb.length + jpad + (blen ? 8 + blen + bpad : 0), out = new ArrayBuffer(total), dv = new DataView(out), u8 = new Uint8Array(out);
    dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, jb.length + jpad, true); dv.setUint32(16, 0x4E4F534A, true); u8.set(jb, 20); for (var i = 0; i < jpad; i++) u8[20 + jb.length + i] = 0x20;
    if (blen) { var o = 20 + jb.length + jpad; dv.setUint32(o, blen + bpad, true); dv.setUint32(o + 4, 0x004E4942, true); u8.set(bin, o + 8); }
    return out;
  },
  /** Atajo: nodo -> ArrayBuffer GLB */
  exportGLB: function (root, options) { var r = GLTFExporter.export(root, options); return GLTFExporter.toGLB(r.json, r.bin); }
};

UG.GLTFExporter = GLTFExporter; UG.encodePNG = encodePNG;
