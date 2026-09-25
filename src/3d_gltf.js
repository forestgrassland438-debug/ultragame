/* UltraGame 3D - cargador glTF 2.0 / GLB (formato de exportación de Blender, Maya, 3ds Max, Substance, Sketchfab...).
 * Seguro por diseño: el archivo es DATOS, nunca código. Se valida cada límite (cabecera GLB, chunks, buffers,
 * bufferViews, accessors, índices, jerarquía sin ciclos, tamaños máximos) antes de leer un solo byte, y las URLs
 * externas pasan por Security.isSafeURL. Soporta: mallas (triángulos, strips, fans), PBR metal-rugosidad, texturas
 * (PNG/JPEG/WebP), KHR_texture_transform, KHR_materials_unlit, KHR_materials_emissive_strength, KHR_mesh_quantization,
 * KHR_lights_punctual, EXT_texture_webp, cámaras, skins (esqueletos) y animaciones (LINEAR/STEP/CUBICSPLINE).
 * No soportado (se avisa): Draco, meshopt, KTX2/Basis, morph targets (se usa la forma base). */

var GLTF_COMP = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
var GLTF_NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
var GLTF_SUPPORTED_EXT = ['KHR_materials_unlit', 'KHR_texture_transform', 'KHR_mesh_quantization', 'KHR_materials_emissive_strength', 'KHR_lights_punctual', 'EXT_texture_webp'];
var GLTF_LIMITS = { maxNodes: 100000, maxAccessorCount: 1 << 25, maxImages: 2048, maxDepth: 512, maxPrimitives: 100000, maxJoints: 1024 };

function gltfError(msg) { return new Error('glTF: ' + msg); }
function gltfInt(v, name) { if (typeof v !== 'number' || !isFinite(v) || v < 0 || Math.floor(v) !== v) throw gltfError(name + ' inválido'); return v; }

/** Separa un GLB en JSON + chunk binario, validando la cabecera y los límites de cada chunk */
function parseGLB(buf) {
  if (!(buf instanceof ArrayBuffer)) throw gltfError('se esperaba un ArrayBuffer');
  if (buf.byteLength < 20) throw gltfError('GLB demasiado corto');
  var dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546C67) throw gltfError('no es un GLB (magic)');
  if (dv.getUint32(4, true) !== 2) throw gltfError('versión de GLB no soportada: ' + dv.getUint32(4, true));
  var total = dv.getUint32(8, true);
  if (total > buf.byteLength || total < 20) throw gltfError('longitud de GLB inconsistente');
  var off = 12, json = null, bin = null, first = true;
  while (off + 8 <= total) {
    var len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    off += 8;
    if (len > total - off) throw gltfError('chunk fuera de límites');
    if (first && type !== 0x4E4F534A) throw gltfError('el primer chunk debe ser JSON');
    if (type === 0x4E4F534A) { if (json !== null) throw gltfError('JSON duplicado'); json = decodeText(buf.slice(off, off + len)); }
    else if (type === 0x004E4942 && bin === null) bin = buf.slice(off, off + len);
    off += len; // la longitud del chunk ya incluye el relleno a 4 bytes
    first = false;
  }
  if (json === null) throw gltfError('GLB sin JSON');
  var parsed;
  try { parsed = JSON.parse(json.replace(/\u0000+$/, '').trim()); } catch (e) { throw gltfError('JSON inválido: ' + e.message); }
  return { json: parsed, bin: bin };
}
function isGLB(buf) { return buf instanceof ArrayBuffer && buf.byteLength >= 4 && new DataView(buf).getUint32(0, true) === 0x46546C67; }

/* ==================================================================== Model3D */
/** Recurso de modelo cargado: plantilla + clips + texturas. instantiate() crea copias baratas que comparten geometría. */
class Model3D {
  constructor(name) {
    this.name = name || ''; this.template = new Group3D(); this.template.name = name || 'model';
    this.nodes = []; this.animations = []; this.textures = []; this.materials = []; this.skins = []; this.cameras = []; this.lights = [];
    this.extras = null; this.destroyed = false;
    Debug.track('Model3D', 1);
  }
  get clipNames() { return this.animations.map(function (c) { return c.name; }); }
  /** Crea una instancia lista para añadir a una escena. options: { castShadow, receiveShadow, cloneMaterials, scale } */
  instantiate(options) {
    if (this.destroyed) throw new Error('Model3D destruido');
    options = options || {};
    var map = new Map(), matMap = options.cloneMaterials ? new Map() : null;
    var cloneNode = function (src) {
      var c = src.clone(false);
      if (c instanceof Mesh3D && matMap && src.material) { var m = matMap.get(src.material); if (!m) { m = src.material.clone(); matMap.set(src.material, m); } c.material = m; }
      if (c instanceof Mesh3D) { if (options.castShadow !== undefined) c.castShadow = !!options.castShadow; if (options.receiveShadow !== undefined) c.receiveShadow = !!options.receiveShadow; }
      map.set(src, c);
      for (var i = 0; i < src.children.length; i++) c.add(cloneNode(src.children[i]));
      return c;
    };
    var root = cloneNode(this.template);
    root._nodeMap = this.nodes.map(function (n) { return map.get(n) || null; });
    var byName = Object.create(null);
    root._nodeMap.forEach(function (n) { if (n && n.name && !(n.name in byName)) byName[n.name] = n; });
    root._nodeByName = byName;
    // esqueletos propios de la instancia (los huesos son los nodos clonados)
    var skelCache = new Map();
    map.forEach(function (clone, src) {
      if (!(clone instanceof Mesh3D) || src._skinIndex === undefined) return;
      var skin = this.skins[src._skinIndex]; if (!skin) return;
      var sk = skelCache.get(skin);
      if (!sk) { sk = new Skeleton3D(skin.joints.map(function (j) { return root._nodeMap[j] || new Node3D(); }), skin.inverseBind); skelCache.set(skin, sk); }
      clone.skeleton = sk; clone.frustumCulled = false;
    }, this);
    if (options.scale) root.scale.multiply(typeof options.scale === 'number' ? new Vec3(options.scale, options.scale, options.scale) : options.scale);
    root.animations = this.animations;
    root.model = this;
    if (this.animations.length) {
      var mixer = null;
      Object.defineProperty(root, 'mixer', { configurable: true, enumerable: false, get: function () { if (!mixer || mixer.destroyed) mixer = new AnimationMixer3D(root, root.animations); return mixer; } });
      /** Reproduce una animación (se registra sola en la escena al primer play) */
      root.play = function (name, opts) {
        var mx = root.mixer;
        if (!mx._scene) { var s = root.findScene3D(); if (s) mx.attach(s); else Log.warnOnce('mixnoscene', 'model.play(): añade el modelo a una View3D antes de reproducir animaciones'); }
        return mx.play(name, opts);
      };
    }
    return root;
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.template.destroy();
    this.textures.forEach(function (t) { if (t && t.source) t.source.destroy(); });
    // arrays nuevos (no truncar): las instancias vivas comparten la lista de animaciones
    this.textures = []; this.nodes = []; this.animations = []; this.materials = []; this.skins = [];
    Debug.track('Model3D', -1);
  }
}
/** Sube por los padres hasta la Scene3D (o null) */
Node3D.prototype.findScene3D = function () { for (var p = this; p; p = p.parent) if (p instanceof Scene3D) return p; return null; };

/* ================================================================ GLTFParser */
class GLTFParser {
  /** options: { baseURL, loader (Loader para recursos externos), name, lightScale } */
  constructor(json, bin, options) {
    this.json = json; this.bin = bin || null; this.options = options || {};
    this.baseURL = this.options.baseURL || ''; this.loader = this.options.loader || null;
    this.buffers = []; this.images = []; this.textures = []; this.materials = []; this._matByIndex = []; this._texCache = new Map(); this._matVariants = new Map();
  }
  /** Punto de entrada: devuelve Promise<Model3D> */
  parse() {
    var self = this, j = this.json;
    try { this._validateTop(); } catch (e) { return Promise.reject(e); }
    return Promise.all((j.buffers || []).map(function (b, i) { return self._loadBuffer(b, i); })).then(function (bufs) {
      self.buffers = bufs;
      var used = new Set();
      (j.textures || []).forEach(function (t) { var s = self._texSource(t); if (s !== undefined) used.add(s); });
      return Promise.all((j.images || []).map(function (im, i) { return used.has(i) ? self._loadImage(im, i) : Promise.resolve(null); }));
    }).then(function (imgs) {
      self.images = imgs;
      return self._build();
    });
  }
  _validateTop() {
    var j = this.json;
    if (!j || typeof j !== 'object') throw gltfError('documento vacío');
    if (!j.asset || String(j.asset.version || '').charAt(0) !== '2') throw gltfError('solo se admite glTF 2.x (asset.version = ' + (j.asset && j.asset.version) + ')');
    (j.extensionsRequired || []).forEach(function (e) {
      if (GLTF_SUPPORTED_EXT.indexOf(e) < 0) throw gltfError('extensión requerida no soportada: ' + e + (e === 'KHR_draco_mesh_compression' ? ' (exporta desde Blender sin compresión Draco)' : ''));
    });
    (j.extensionsUsed || []).forEach(function (e) { if (GLTF_SUPPORTED_EXT.indexOf(e) < 0) Log.warnOnce('gltfext:' + e, 'glTF: extensión no soportada (se ignora): ' + e); });
    ['nodes', 'meshes', 'accessors', 'bufferViews', 'buffers', 'materials', 'textures', 'images', 'samplers', 'skins', 'animations', 'scenes', 'cameras'].forEach(function (k) {
      if (j[k] !== undefined && !Array.isArray(j[k])) throw gltfError('"' + k + '" debe ser un array');
    });
    if ((j.nodes || []).length > GLTF_LIMITS.maxNodes) throw gltfError('demasiados nodos');
    if ((j.images || []).length > GLTF_LIMITS.maxImages) throw gltfError('demasiadas imágenes');
  }
  _loadBuffer(b, i) {
    var self = this;
    if (!b || typeof b !== 'object') return Promise.reject(gltfError('buffer ' + i + ' inválido'));
    var len = gltfInt(b.byteLength, 'buffer.byteLength');
    var check = function (ab) { if (!(ab instanceof ArrayBuffer) || ab.byteLength < len) throw gltfError('buffer ' + i + ' más corto que su byteLength'); return ab; };
    if (b.uri === undefined) {
      if (i !== 0 || !this.bin) return Promise.reject(gltfError('buffer ' + i + ' sin uri ni chunk binario'));
      return Promise.resolve(check(this.bin));
    }
    if (typeof b.uri !== 'string') return Promise.reject(gltfError('uri de buffer inválida'));
    var m = /^data:application\/(octet-stream|gltf-buffer);base64,/i.exec(b.uri.slice(0, 64));
    if (m) { try { var bytes = base64ToBytes(b.uri.slice(m[0].length)); return Promise.resolve(check(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))); } catch (e) { return Promise.reject(gltfError('base64 inválido en buffer ' + i)); } }
    if (/^data:/i.test(b.uri)) return Promise.reject(gltfError('data URI de buffer con tipo no permitido'));
    if (!this.loader) return Promise.reject(gltfError('buffer externo sin cargador: ' + b.uri.slice(0, 60)));
    return this.loader.fetchBytes(joinURL(this.baseURL, b.uri)).then(check);
  }
  _texSource(t) {
    if (!t) return undefined;
    var ex = t.extensions || {};
    if (ex.EXT_texture_webp && typeof ex.EXT_texture_webp.source === 'number') return ex.EXT_texture_webp.source;
    return typeof t.source === 'number' ? t.source : undefined;
  }
  _loadImage(im, i) {
    var self = this, L = this.loader;
    var fail = function (e) { Log.warn('glTF: no se pudo cargar la imagen ' + i + (im && im.name ? ' (' + im.name + ')' : '') + ':', e && e.message ? e.message : e); return null; };
    try {
      if (!im || typeof im !== 'object') throw gltfError('imagen inválida');
      if (im.bufferView !== undefined) {
        var mime = String(im.mimeType || '').toLowerCase();
        if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp') throw gltfError('tipo de imagen no soportado: ' + mime + (mime === 'image/ktx2' ? ' (KTX2/Basis no soportado)' : ''));
        var bytes = this._viewBytes(im.bufferView);
        if (!L) throw gltfError('sin Loader para decodificar imágenes (usa this.load.gltf o pasa options.loader)');
        if (typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) throw gltfError('entorno sin Blob/URL');
        var url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        return L._imgFromURL(url).then(function (img) { URL.revokeObjectURL(url); return img; }, function (e) { URL.revokeObjectURL(url); return fail(e); });
      }
      if (typeof im.uri !== 'string') throw gltfError('imagen sin uri ni bufferView');
      if (!L) throw gltfError('imagen externa sin cargador');
      if (/^data:/i.test(im.uri) && !/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(im.uri.slice(0, 40))) throw gltfError('data URI de imagen no permitida');
      return L.loadImageElement(/^data:/i.test(im.uri) ? im.uri : joinURL(this.baseURL, im.uri)).then(function (img) { return img; }, fail);
    } catch (e) { return Promise.resolve(fail(e)); }
  }
  /* ---------- lectura validada ---------- */
  _viewBytes(vi) {
    var j = this.json, bv = (j.bufferViews || [])[gltfInt(vi, 'bufferView')];
    if (!bv) throw gltfError('bufferView ' + vi + ' no existe');
    var buf = this.buffers[gltfInt(bv.buffer, 'bufferView.buffer')];
    if (!buf) throw gltfError('buffer ' + bv.buffer + ' no existe');
    var off = bv.byteOffset === undefined ? 0 : gltfInt(bv.byteOffset, 'byteOffset'), len = gltfInt(bv.byteLength, 'byteLength');
    if (off + len > buf.byteLength) throw gltfError('bufferView ' + vi + ' fuera de su buffer');
    return new Uint8Array(buf, off, len);
  }
  /** Lee un accessor como Float32Array (o Uint32Array con asInt), aplicando normalización y sparse */
  accessor(ai, asInt) {
    var j = this.json, acc = (j.accessors || [])[gltfInt(ai, 'accessor')];
    if (!acc) throw gltfError('accessor ' + ai + ' no existe');
    var nc = GLTF_NCOMP[acc.type], C = GLTF_COMP[acc.componentType];
    if (!nc || !C) throw gltfError('accessor ' + ai + ' con tipo no válido');
    var count = gltfInt(acc.count, 'accessor.count');
    if (count > GLTF_LIMITS.maxAccessorCount) throw gltfError('accessor demasiado grande');
    if (nc > 4 && C[0] !== Float32Array) throw gltfError('matrices no float no soportadas');
    var out = asInt ? new Uint32Array(count * nc) : new Float32Array(count * nc);
    var norm = !!acc.normalized && C[0] !== Float32Array && C[0] !== Uint32Array;
    var readAll = function (bytes, stride, base, n, target) {
      var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), sz = C[1], T = C[0];
      for (var i = 0; i < n; i++) for (var k = 0; k < nc; k++) {
        var o = base + i * stride + k * sz, v;
        if (T === Float32Array) v = dv.getFloat32(o, true); else if (T === Uint8Array) v = dv.getUint8(o); else if (T === Int8Array) v = dv.getInt8(o);
        else if (T === Uint16Array) v = dv.getUint16(o, true); else if (T === Int16Array) v = dv.getInt16(o, true); else v = dv.getUint32(o, true);
        if (norm) { if (T === Uint8Array) v /= 255; else if (T === Uint16Array) v /= 65535; else if (T === Int8Array) v = Math.max(v / 127, -1); else if (T === Int16Array) v = Math.max(v / 32767, -1); }
        target[i * nc + k] = v;
      }
    };
    var elem = C[1] * nc;
    if (acc.bufferView !== undefined && count > 0) {
      var bv = j.bufferViews[acc.bufferView], bytes = this._viewBytes(acc.bufferView);
      var stride = bv.byteStride !== undefined ? gltfInt(bv.byteStride, 'byteStride') : elem;
      if (stride < elem || stride > 252) throw gltfError('byteStride inválido');
      var aoff = acc.byteOffset === undefined ? 0 : gltfInt(acc.byteOffset, 'accessor.byteOffset');
      if (aoff + stride * (count - 1) + elem > bytes.byteLength) throw gltfError('accessor ' + ai + ' fuera de su bufferView');
      readAll(bytes, stride, aoff, count, out);
    }
    if (acc.sparse) {
      var sp = acc.sparse, sc = gltfInt(sp.count, 'sparse.count');
      if (sc > count) throw gltfError('sparse.count > count');
      var ic = GLTF_COMP[sp.indices && sp.indices.componentType];
      if (!ic || (ic[0] !== Uint8Array && ic[0] !== Uint16Array && ic[0] !== Uint32Array)) throw gltfError('índices sparse inválidos');
      var ib = this._viewBytes(sp.indices.bufferView), io = sp.indices.byteOffset ? gltfInt(sp.indices.byteOffset, 'sparse.byteOffset') : 0;
      if (io + sc * ic[1] > ib.byteLength) throw gltfError('índices sparse fuera de límites');
      var vb = this._viewBytes(sp.values.bufferView), vo = sp.values.byteOffset ? gltfInt(sp.values.byteOffset, 'sparse.values.byteOffset') : 0;
      if (vo + sc * elem > vb.byteLength) throw gltfError('valores sparse fuera de límites');
      var idv = new DataView(ib.buffer, ib.byteOffset, ib.byteLength), tmp = asInt ? new Uint32Array(sc * nc) : new Float32Array(sc * nc);
      readAll(vb, elem, vo, sc, tmp);
      for (var s = 0; s < sc; s++) {
        var ix = ic[0] === Uint8Array ? idv.getUint8(io + s) : ic[0] === Uint16Array ? idv.getUint16(io + s * 2, true) : idv.getUint32(io + s * 4, true);
        if (ix >= count) throw gltfError('índice sparse fuera de rango');
        for (var q = 0; q < nc; q++) out[ix * nc + q] = tmp[s * nc + q];
      }
    }
    // valores no finitos -> 0 (evita NaN que envenenen la GPU o la física)
    if (!asInt) for (var z = 0; z < out.length; z++) if (!isFinite(out[z])) out[z] = 0;
    out.itemSize = nc;
    return out;
  }
  /* ---------- construcción ---------- */
  _texture(info, srgbHint) {
    var j = this.json;
    if (!info || typeof info.index !== 'number') return null;
    var t = (j.textures || [])[info.index]; if (!t) return null;
    var src = this._texSource(t); if (src === undefined) return null;
    var img = this.images[src]; if (!img) return null;
    var smp = t.sampler !== undefined ? (j.samplers || [])[t.sampler] || {} : {};
    var wrap = function (w) { return w === 33071 ? 'clamp' : (w === 33648 ? 'mirror' : 'repeat'); };
    var key = src + '|' + (smp.magFilter || 0) + '|' + (smp.wrapS || 10497);
    var tex = this._texCache.get(key);
    if (!tex) {
      var ts = new TextureSource(img, { scaleMode: smp.magFilter === 9728 ? 'nearest' : 'linear', wrapMode: wrap(smp.wrapS), mipmap: true, label: (j.images[src] && j.images[src].name) || ('gltf-' + src) });
      tex = new Texture(ts); this._texCache.set(key, tex); this.textures.push(tex);
    }
    void srgbHint;
    return tex;
  }
  _material(mi) {
    var j = this.json;
    if (mi === undefined) { if (!this._defaultMat) this._defaultMat = new StandardMaterial({ name: 'default', roughness: 1, metalness: 0 }); return this._defaultMat; }
    // caché por índice del glTF aparte de la lista (las variantes se añaden a la lista y no deben ocupar índices)
    if (this._matByIndex[mi]) return this._matByIndex[mi];
    var d = (j.materials || [])[mi] || {}, ex = d.extensions || {}, pbr = d.pbrMetallicRoughness || {};
    var m = ex.KHR_materials_unlit ? new BasicMaterial() : new StandardMaterial();
    m.name = typeof d.name === 'string' ? Security.sanitizeText(d.name, 128) : '';
    var bc = Array.isArray(pbr.baseColorFactor) ? pbr.baseColorFactor : [1, 1, 1, 1];
    setLinearColor3D(m, 'color', +bc[0], +bc[1], +bc[2]); m.opacity = clamp(+bc[3], 0, 1);
    m.metalness = pbr.metallicFactor !== undefined ? clamp(+pbr.metallicFactor, 0, 1) : 1;
    m.roughness = pbr.roughnessFactor !== undefined ? clamp(+pbr.roughnessFactor, 0, 1) : 1;
    var ef = Array.isArray(d.emissiveFactor) ? d.emissiveFactor : [0, 0, 0];
    setLinearColor3D(m, 'emissive', +ef[0], +ef[1], +ef[2]);
    if (ex.KHR_materials_emissive_strength && ex.KHR_materials_emissive_strength.emissiveStrength > 0) m.emissiveIntensity = +ex.KHR_materials_emissive_strength.emissiveStrength;
    m.map = this._texture(pbr.baseColorTexture, true);
    m.metalRoughMap = this._texture(pbr.metallicRoughnessTexture);
    m.normalMap = this._texture(d.normalTexture);
    if (d.normalTexture && d.normalTexture.scale !== undefined) m.normalScale = +d.normalTexture.scale;
    m.aoMap = this._texture(d.occlusionTexture);
    if (d.occlusionTexture && d.occlusionTexture.strength !== undefined) m.aoStrength = clamp(+d.occlusionTexture.strength, 0, 1);
    m.emissiveMap = this._texture(d.emissiveTexture, true);
    var tt = pbr.baseColorTexture && pbr.baseColorTexture.extensions && pbr.baseColorTexture.extensions.KHR_texture_transform;
    if (tt) {
      if (Array.isArray(tt.offset)) m.uvOffset.set(+tt.offset[0] || 0, +tt.offset[1] || 0);
      if (Array.isArray(tt.scale)) m.uvScale.set(+tt.scale[0] || 1, +tt.scale[1] || 1);
      if (tt.rotation) m.uvRotation = -(+tt.rotation || 0); // glTF gira en sentido contrario a nuestra convención
      if (m.map && m.map.source.wrapMode === 'clamp' && (m.uvScale.x !== 1 || m.uvScale.y !== 1)) m.map.source.setWrapMode('repeat');
    }
    var mode = d.alphaMode || 'OPAQUE';
    if (mode === 'MASK') m.alphaTest = d.alphaCutoff !== undefined ? clamp(+d.alphaCutoff, 0, 1) : 0.5;
    else if (mode === 'BLEND') m.transparent = true;
    if (d.doubleSided) m.side = 'double';
    m.version++;
    this._matByIndex[mi] = m; this.materials.push(m);
    return m;
  }
  /** Variante del material (colores de vértice / normales planas) sin tocar el original */
  _variant(m, vcol, flat) {
    if (!vcol && !flat) return m;
    var key = m.uid + ':' + (vcol ? 1 : 0) + (flat ? 1 : 0), v = this._matVariants.get(key);
    if (!v) { v = m.clone(); if (vcol) v.vertexColors = true; if (flat) v.flatShading = true; v.version++; this._matVariants.set(key, v); this.materials.push(v); }
    return v;
  }
  _primitive(p, mi, pi) {
    var a = p.attributes || {};
    if (a.POSITION === undefined) throw gltfError('primitiva sin POSITION');
    var mode = p.mode === undefined ? 4 : p.mode;
    if (mode !== 4 && mode !== 5 && mode !== 6) { Log.warnOnce('gltfmode' + mode, 'glTF: primitivas de puntos/líneas no soportadas (se omiten)'); return null; }
    if (p.targets && p.targets.length) Log.warnOnce('gltfmorph', 'glTF: morph targets / shape keys no soportados todavía; se usa la forma base');
    if (p.extensions && p.extensions.KHR_draco_mesh_compression) throw gltfError('malla comprimida con Draco (no soportado)');
    var pos = this.accessor(a.POSITION), vc = pos.length / 3;
    if (pos.itemSize !== 3) throw gltfError('POSITION debe ser VEC3');
    var g = new Geometry3D();
    g.setAttribute('position', pos, 3);
    if (a.NORMAL !== undefined) { var n = this.accessor(a.NORMAL); if (n.length === vc * 3) g.setAttribute('normal', n, 3); }
    if (a.TEXCOORD_0 !== undefined) { var uv = this.accessor(a.TEXCOORD_0); if (uv.length === vc * 2) g.setAttribute('uv', uv, 2); }
    var vcol = false;
    if (a.COLOR_0 !== undefined) { var c = this.accessor(a.COLOR_0); if (c.length === vc * c.itemSize && (c.itemSize === 3 || c.itemSize === 4)) { g.setAttribute('color', c, c.itemSize); vcol = true; } }
    if (a.JOINTS_0 !== undefined && a.WEIGHTS_0 !== undefined) {
      var jn = this.accessor(a.JOINTS_0), w = this.accessor(a.WEIGHTS_0);
      if (jn.length === vc * 4 && w.length === vc * 4) {
        for (var k = 0; k < vc; k++) { var s = w[k * 4] + w[k * 4 + 1] + w[k * 4 + 2] + w[k * 4 + 3]; if (s > 1e-6) { w[k * 4] /= s; w[k * 4 + 1] /= s; w[k * 4 + 2] /= s; w[k * 4 + 3] /= s; } else { w[k * 4] = 1; } }
        g.setAttribute('joints', jn, 4); g.setAttribute('weights', w, 4);
      }
    }
    var idx = null;
    if (p.indices !== undefined) {
      idx = this.accessor(p.indices, true);
      for (var q = 0; q < idx.length; q++) if (idx[q] >= vc) throw gltfError('índice fuera de rango en malla ' + mi + ' primitiva ' + pi);
    }
    if (mode !== 4) {
      var src = idx || (function () { var t = new Uint32Array(vc); for (var i = 0; i < vc; i++) t[i] = i; return t; })(), tri = [];
      if (mode === 5) for (var s5 = 0; s5 + 2 < src.length; s5++) { if (s5 & 1) tri.push(src[s5 + 1], src[s5], src[s5 + 2]); else tri.push(src[s5], src[s5 + 1], src[s5 + 2]); }
      else for (var s6 = 1; s6 + 1 < src.length; s6++) tri.push(src[0], src[s6], src[s6 + 1]);
      idx = new Uint32Array(tri);
    }
    if (idx) { var mx = 0; for (var z = 0; z < idx.length; z++) if (idx[z] > mx) mx = idx[z]; g.setIndex(mx < 65536 ? new Uint16Array(idx) : idx); }
    var flat = !g.attributes.normal;
    if (flat) g.computeNormals();
    return { geometry: g, material: this._variant(this._material(p.material), vcol, flat) };
  }
  _build() {
    var j = this.json, self = this, model = new Model3D(this.options.name);
    model.extras = j.asset && j.asset.extras ? j.asset.extras : null;
    var nodesJ = j.nodes || [], meshesJ = j.meshes || [];
    // mallas -> lista de primitivas (geometría + material), compartidas entre nodos
    var meshCache = [];
    var primCount = 0;
    var meshPrims = function (mi) {
      if (meshCache[mi]) return meshCache[mi];
      var mj = meshesJ[gltfInt(mi, 'mesh')]; if (!mj) throw gltfError('malla ' + mi + ' no existe');
      var list = [];
      (mj.primitives || []).forEach(function (p, pi) { if (++primCount > GLTF_LIMITS.maxPrimitives) throw gltfError('demasiadas primitivas'); var r = self._primitive(p, mi, pi); if (r) list.push(r); });
      meshCache[mi] = list;
      return list;
    };
    // nodos
    var parentOf = new Int32Array(nodesJ.length).fill(-1);
    nodesJ.forEach(function (nj, i) {
      (nj.children || []).forEach(function (c) {
        c = gltfInt(c, 'node.children');
        if (c >= nodesJ.length) throw gltfError('hijo ' + c + ' no existe');
        if (parentOf[c] !== -1 || c === i) throw gltfError('el nodo ' + c + ' tiene más de un padre o es su propio hijo');
        parentOf[c] = i;
      });
    });
    // ciclos (0 -> 1 -> 0) y profundidad acotada, antes de construir nada
    var state = new Uint8Array(nodesJ.length);
    for (var ci = 0; ci < nodesJ.length; ci++) {
      if (state[ci] === 2) continue;
      var path = [], p = ci, depth = 0;
      while (p !== -1 && state[p] !== 2) {
        if (state[p] === 1) throw gltfError('la jerarquía de nodos tiene ciclos');
        state[p] = 1; path.push(p); p = parentOf[p];
        if (++depth > GLTF_LIMITS.maxDepth) throw gltfError('jerarquía de nodos demasiado profunda');
      }
      for (var k2 = 0; k2 < path.length; k2++) state[path[k2]] = 2;
    }
    var nodes = nodesJ.map(function (nj, i) {
      var n;
      var prims = nj.mesh !== undefined ? meshPrims(nj.mesh) : null;
      if (prims && prims.length === 1) n = new Mesh3D(prims[0].geometry, prims[0].material);
      else {
        n = new Group3D();
        if (prims) prims.forEach(function (pr) { var mm = new Mesh3D(pr.geometry, pr.material); mm.name = (nj.name || 'mesh') + '_prim'; n.add(mm); });
      }
      n.name = typeof nj.name === 'string' ? Security.sanitizeText(nj.name, 128) : '';
      if (Array.isArray(nj.matrix) && nj.matrix.length === 16) { var M = new Mat4().fromArray(nj.matrix.map(Number)); M.decompose(n.position, n.quaternion, n.scale); }
      else {
        if (Array.isArray(nj.translation)) n.position.set(+nj.translation[0] || 0, +nj.translation[1] || 0, +nj.translation[2] || 0);
        if (Array.isArray(nj.rotation)) n.quaternion.set(+nj.rotation[0] || 0, +nj.rotation[1] || 0, +nj.rotation[2] || 0, nj.rotation[3] === undefined ? 1 : +nj.rotation[3]).normalize();
        if (Array.isArray(nj.scale)) n.scale.set(nj.scale[0] === undefined ? 1 : +nj.scale[0], nj.scale[1] === undefined ? 1 : +nj.scale[1], nj.scale[2] === undefined ? 1 : +nj.scale[2]);
      }
      if (nj.skin !== undefined) {
        var sIdx = gltfInt(nj.skin, 'node.skin');
        n.traverse(function (x) { if (x instanceof Mesh3D) x._skinIndex = sIdx; });
      }
      if (nj.camera !== undefined) { var cam = self._camera(nj.camera); if (cam) { n.add(cam); model.cameras.push(cam); } }
      var lp = nj.extensions && nj.extensions.KHR_lights_punctual;
      if (lp && typeof lp.light === 'number') { var li = self._light(lp.light); if (li) { n.add(li); model.lights.push(li); } }
      if (nj.extras && typeof nj.extras === 'object') n.userData = Security.safeMerge({}, nj.extras);
      return n;
    });
    nodes.forEach(function (n, i) { (nodesJ[i].children || []).forEach(function (c) { n.add(nodes[c]); }); });
    model.nodes = nodes;
    // skins
    (j.skins || []).forEach(function (sj, si) {
      var joints = (sj.joints || []).map(function (x) { x = gltfInt(x, 'skin.joints'); if (x >= nodes.length) throw gltfError('hueso ' + x + ' no existe'); return x; });
      if (!joints.length || joints.length > GLTF_LIMITS.maxJoints) throw gltfError('skin ' + si + ' con un número de huesos no válido');
      var ib;
      if (sj.inverseBindMatrices !== undefined) { ib = self.accessor(sj.inverseBindMatrices); if (ib.length < joints.length * 16) throw gltfError('inverseBindMatrices incompletas'); ib = ib.subarray(0, joints.length * 16); }
      else { ib = new Float32Array(joints.length * 16); for (var k = 0; k < joints.length; k++) ib[k * 16] = ib[k * 16 + 5] = ib[k * 16 + 10] = ib[k * 16 + 15] = 1; }
      model.skins.push({ joints: joints, inverseBind: new Float32Array(ib) });
    });
    // animaciones
    (j.animations || []).forEach(function (aj, ai) {
      var tracks = [];
      (aj.channels || []).forEach(function (ch) {
        var tg = ch.target || {}, path = tg.path === 'translation' ? 'position' : tg.path === 'rotation' ? 'quaternion' : tg.path === 'scale' ? 'scale' : null;
        if (!path) { if (tg.path === 'weights') Log.warnOnce('gltfweights', 'glTF: animaciones de morph targets no soportadas'); return; }
        if (typeof tg.node !== 'number' || tg.node < 0 || tg.node >= nodes.length) return;
        var smp = (aj.samplers || [])[ch.sampler]; if (!smp) return;
        var times = self.accessor(smp.input), vals = self.accessor(smp.output);
        tracks.push({ target: tg.node, path: path, times: times, values: vals, interpolation: smp.interpolation || 'LINEAR' });
      });
      var nm = typeof aj.name === 'string' && aj.name ? Security.sanitizeText(aj.name, 128) : 'anim' + ai;
      model.animations.push(new AnimationClip3D(nm, tracks));
    });
    // escena
    var sceneIdx = typeof j.scene === 'number' ? j.scene : 0, sc = (j.scenes || [])[sceneIdx];
    var roots = sc && Array.isArray(sc.nodes) ? sc.nodes : nodes.map(function (n, i) { return i; }).filter(function (i) { return parentOf[i] === -1; });
    roots.forEach(function (r) { r = gltfInt(r, 'scene.nodes'); if (r < nodes.length && !nodes[r].parent) model.template.add(nodes[r]); });
    model.textures = this.textures.slice();
    model.materials = this.materials.filter(Boolean);
    return model;
  }
  _camera(ci) {
    var c = (this.json.cameras || [])[ci]; if (!c) return null;
    var cam;
    if (c.type === 'orthographic' && c.orthographic) { var o = c.orthographic; cam = new OrthographicCamera(Math.abs(+o.ymag || 1) * 2, Math.abs(+o.xmag || 1) / Math.abs(+o.ymag || 1), +o.znear || 0.1, +o.zfar || 1000); }
    else { var p = c.perspective || {}; cam = new PerspectiveCamera((+p.yfov || 0.8) * RAD_TO_DEG, +p.aspectRatio || 1, +p.znear || 0.1, +p.zfar || 1000); }
    cam.name = typeof c.name === 'string' ? Security.sanitizeText(c.name, 128) : 'camera';
    return cam;
  }
  _light(li) {
    var ext = this.json.extensions && this.json.extensions.KHR_lights_punctual, d = ext && Array.isArray(ext.lights) ? ext.lights[li] : null;
    if (!d) return null;
    var col = Array.isArray(d.color) ? d.color : [1, 1, 1], scale = this.options.lightScale !== undefined ? +this.options.lightScale : 1;
    var I = (d.intensity !== undefined ? +d.intensity : 1) * scale, light;
    // glTF usa candelas (punto/foco) y lux (direccional); se llevan a la escala de UltraGame
    if (d.type === 'directional') { light = new DirectionalLight(0xffffff, Math.min(I, 20)); light.useNodeDirection = true; }
    else if (d.type === 'spot') { var sp = d.spot || {}; light = new SpotLight(0xffffff, I / (4 * Math.PI), d.range > 0 ? +d.range : 20, +sp.outerConeAngle || Math.PI / 4, sp.outerConeAngle ? 1 - (+sp.innerConeAngle || 0) / +sp.outerConeAngle : 0.2); }
    else light = new PointLight(0xffffff, I / (4 * Math.PI), d.range > 0 ? +d.range : 20);
    setLinearColor3D(light, 'light', +col[0], +col[1], +col[2]);
    light.name = typeof d.name === 'string' ? Security.sanitizeText(d.name, 128) : '';
    return light;
  }
}
/** Asigna un color lineal (glTF) sin pasar por 8 bits sRGB */
function setLinearColor3D(obj, which, r, g, b) {
  r = isFinite(r) ? Math.max(0, r) : 0; g = isFinite(g) ? Math.max(0, g) : 0; b = isFinite(b) ? Math.max(0, b) : 0;
  var toS = function (c) { c = Math.min(1, c); return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255); };
  var hex = (toS(r) << 16) | (toS(g) << 8) | toS(b);
  if (which === 'color') { obj._color = hex; obj.linearColor = [r, g, b]; }
  else if (which === 'emissive') { obj._emissive = hex; obj.linearEmissive = [r, g, b]; }
  else { obj._color = hex; obj.linearColor = [r, g, b]; }
}

/** API de alto nivel */
var GLTF = {
  /** Parsea un ArrayBuffer (GLB) o un objeto/texto JSON (glTF). Devuelve Promise<Model3D> */
  parse: function (data, options) {
    try {
      var json, bin = null;
      if (data instanceof ArrayBuffer) { if (isGLB(data)) { var g = parseGLB(data); json = g.json; bin = g.bin; } else json = JSON.parse(decodeText(data)); }
      else if (typeof data === 'string') json = JSON.parse(data);
      else if (data && typeof data === 'object') json = data;
      else throw gltfError('datos no reconocidos');
      return new GLTFParser(json, bin, options).parse();
    } catch (e) { return Promise.reject(e instanceof Error && /^glTF/.test(e.message) ? e : gltfError(e && e.message ? e.message : String(e))); }
  },
  isGLB: isGLB, parseGLB: parseGLB, limits: GLTF_LIMITS
};

UG.GLTF = GLTF; UG.GLTFParser = GLTFParser; UG.Model3D = Model3D;
