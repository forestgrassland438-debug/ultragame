/* UltraGame 3D - cargador OBJ + MTL (Wavefront): el formato más universal (Blender, MagicaVoxel, SketchUp, ZBrush...).
 * Caras poligonales (se triangulan en abanico), índices negativos, grupos/objetos, usemtl, colores por vértice
 * (extensión "v x y z r g b"), materiales MTL (Kd, d/Tr, Ns, Ke, Pr/Pm, map_Kd, map_Bump/norm, map_Ke).
 * Seguro: solo se interpretan números y nombres; límites de tamaño y de vértices. */

var OBJ_LIMITS = { maxVertices: 8000000, maxFaces: 8000000 };

var OBJ = {
  /** Texto OBJ -> estructura intermedia (sin GPU). Útil también en Node. */
  parseText: function (text) {
    if (typeof text !== 'string') throw new Error('OBJ: se esperaba texto');
    if (text.length > Security.maxFileSize) throw new Error('OBJ: archivo demasiado grande');
    var P = [], T = [], N = [], C = [], groups = [], mtllibs = [];
    var cur = null, objName = 'default', matName = '';
    var start = function () { cur = { name: objName, material: matName, idx: [] }; groups.push(cur); };
    var lines = text.replace(/\\\r?\n/g, ' ').split(/\r?\n/), faces = 0;
    var num = function (s) { var v = parseFloat(s); return isFinite(v) ? v : 0; };
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li].trim();
      if (!line || line.charCodeAt(0) === 35) continue; // '#'
      var parts = line.split(/\s+/), k = parts[0];
      if (k === 'v') {
        P.push(num(parts[1]), num(parts[2]), num(parts[3]));
        if (parts.length >= 7) C.push(num(parts[4]), num(parts[5]), num(parts[6])); else if (C.length) C.push(1, 1, 1);
        if (P.length / 3 > OBJ_LIMITS.maxVertices) throw new Error('OBJ: demasiados vértices');
      } else if (k === 'vt') T.push(num(parts[1]), parts.length > 2 ? num(parts[2]) : 0);
      else if (k === 'vn') N.push(num(parts[1]), num(parts[2]), num(parts[3]));
      else if (k === 'f') {
        if (!cur) start();
        var poly = [];
        for (var i = 1; i < parts.length; i++) {
          var r = parts[i].split('/'), vi = parseInt(r[0], 10), ti = r.length > 1 && r[1] !== '' ? parseInt(r[1], 10) : 0, ni = r.length > 2 && r[2] !== '' ? parseInt(r[2], 10) : 0;
          if (!isFinite(vi) || vi === 0) continue;
          vi = vi < 0 ? P.length / 3 + vi : vi - 1; ti = ti < 0 ? T.length / 2 + ti : ti - 1; ni = ni < 0 ? N.length / 3 + ni : ni - 1;
          if (vi < 0 || vi >= P.length / 3) continue;
          if (ti >= T.length / 2) ti = -1; if (ni >= N.length / 3) ni = -1;
          poly.push(vi, ti, ni);
        }
        for (var t = 1; t + 1 < poly.length / 3; t++) { cur.idx.push(poly[0], poly[1], poly[2], poly[t * 3], poly[t * 3 + 1], poly[t * 3 + 2], poly[t * 3 + 3], poly[t * 3 + 4], poly[t * 3 + 5]); faces++; }
        if (faces > OBJ_LIMITS.maxFaces) throw new Error('OBJ: demasiadas caras');
      } else if (k === 'o' || k === 'g') { objName = Security.sanitizeText(parts.slice(1).join(' ') || 'default', 128); start(); }
      else if (k === 'usemtl') { matName = Security.sanitizeText(parts.slice(1).join(' '), 128); start(); }
      else if (k === 'mtllib') mtllibs.push(parts.slice(1).join(' '));
    }
    return { positions: P, uvs: T, normals: N, colors: C.length === P.length ? C : null, groups: groups.filter(function (g) { return g.idx.length; }), mtllibs: mtllibs };
  },
  /** Texto MTL -> { nombre: {color, opacity, roughness, metalness, emissive, map, normalMap, emissiveMap} } */
  parseMTL: function (text) {
    var out = Object.create(null), cur = null;
    var num = function (s, d) { var v = parseFloat(s); return isFinite(v) ? v : d; };
    var col = function (p) { var c = function (x) { return Math.round(clamp(num(x, 0), 0, 1) * 255); }; return (c(p[1]) << 16) | (c(p[2] !== undefined ? p[2] : p[1]) << 8) | c(p[3] !== undefined ? p[3] : p[1]); };
    var file = function (p) { return p.length > 1 ? p[p.length - 1] : null; }; // descarta opciones tipo "-bm 1.0"
    String(text).split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim(); if (!line || line[0] === '#') return;
      var p = line.split(/\s+/), k = p[0].toLowerCase();
      if (k === 'newmtl') { var nm = Security.sanitizeText(p.slice(1).join(' '), 128); if (Security.isForbiddenKey(nm)) { cur = null; return; } cur = out[nm] = { color: 0xcccccc, opacity: 1 }; return; }
      if (!cur) return;
      if (k === 'kd') cur.color = col(p);
      else if (k === 'ke') cur.emissive = col(p);
      else if (k === 'd') cur.opacity = clamp(num(p[1], 1), 0, 1);
      else if (k === 'tr') cur.opacity = clamp(1 - num(p[1], 0), 0, 1);
      else if (k === 'ns') cur.roughness = clamp(Math.sqrt(2 / (num(p[1], 32) + 2)), 0.04, 1);
      else if (k === 'pr') cur.roughness = clamp(num(p[1], 0.8), 0, 1);
      else if (k === 'pm') cur.metalness = clamp(num(p[1], 0), 0, 1);
      else if (k === 'map_kd') cur.map = file(p);
      else if (k === 'map_bump' || k === 'bump' || k === 'norm' || k === 'map_kn') cur.normalMap = file(p);
      else if (k === 'map_ke') cur.emissiveMap = file(p);
    });
    return out;
  },
  /** Construye un Model3D. options: { loader, baseURL, mtlURL, name, materials (objeto MTL ya parseado) } */
  parse: function (text, options) {
    options = options || {};
    var data;
    try { data = OBJ.parseText(text); } catch (e) { return Promise.reject(e); }
    var L = options.loader, base = options.baseURL || '';
    var mtlP;
    if (options.materials) mtlP = Promise.resolve({ mats: options.materials, base: base });
    else if (L && (options.mtlURL || data.mtllibs.length)) {
      var mu = options.mtlURL || joinURL(base, data.mtllibs[0]);
      mtlP = L.fetchText(mu).then(function (t) { return { mats: OBJ.parseMTL(t), base: dirOf(mu) }; }, function (e) { Log.warn('OBJ: no se pudo cargar el MTL', e && e.message); return { mats: {}, base: base }; });
    } else mtlP = Promise.resolve({ mats: {}, base: base });
    return mtlP.then(function (mt) {
      var model = new Model3D(options.name), matCache = Object.create(null), texCache = Object.create(null), loads = [];
      var getTex = function (file) {
        if (!file || !L) return null;
        if (texCache[file] !== undefined) return texCache[file];
        var tex = new Texture(new TextureSource(null, { width: 1, height: 1, mipmap: true, wrapMode: 'repeat', label: file }));
        texCache[file] = tex; model.textures.push(tex);
        loads.push(L.loadImageElement(joinURL(mt.base, file)).then(function (img) { var s = tex.source; s.resource = img; s.width = img.naturalWidth || img.width; s.height = img.naturalHeight || img.height; tex.frame.set(0, 0, s.width, s.height); tex.orig.set(0, 0, s.width, s.height); tex.updateUvs(); s.update(); }, function (e) { Log.warn('OBJ: textura no cargada ' + file + ':', e && e.message); }));
        return tex;
      };
      var getMat = function (name, vcol) {
        var key = name + (vcol ? '|c' : '');
        if (matCache[key]) return matCache[key];
        var d = mt.mats[name] || null, m = new StandardMaterial({ name: name || 'default', color: d ? d.color : 0xcccccc, roughness: d && d.roughness !== undefined ? d.roughness : 0.8, metalness: d && d.metalness !== undefined ? d.metalness : 0 });
        if (d) {
          if (d.opacity < 1) { m.opacity = d.opacity; m.transparent = true; }
          if (d.emissive) m.emissive = d.emissive;
          if (d.map) m.map = getTex(d.map);
          if (d.normalMap) m.normalMap = getTex(d.normalMap);
          if (d.emissiveMap) { m.emissiveMap = getTex(d.emissiveMap); if (!d.emissive) m.emissive = 0xffffff; }
        }
        if (vcol) m.vertexColors = true;
        m.version++;
        matCache[key] = m; model.materials.push(m);
        return m;
      };
      var P = data.positions, T = data.uvs, N = data.normals, C = data.colors;
      data.groups.forEach(function (g) {
        var map = new Map(), pos = [], uv = [], nrm = [], colr = [], idx = [], hasN = false, hasT = false;
        for (var i = 0; i < g.idx.length; i += 3) {
          var key = g.idx[i] + '/' + g.idx[i + 1] + '/' + g.idx[i + 2], v = map.get(key);
          if (v === undefined) {
            v = pos.length / 3; map.set(key, v);
            var pi = g.idx[i] * 3, ti = g.idx[i + 1], ni = g.idx[i + 2];
            pos.push(P[pi], P[pi + 1], P[pi + 2]);
            if (ti >= 0) { uv.push(T[ti * 2], 1 - T[ti * 2 + 1]); hasT = true; } else uv.push(0, 0);
            if (ni >= 0) { nrm.push(N[ni * 3], N[ni * 3 + 1], N[ni * 3 + 2]); hasN = true; } else nrm.push(0, 0, 0);
            if (C) colr.push(C[pi], C[pi + 1], C[pi + 2], 1);
          }
          idx.push(v);
        }
        var geo = new Geometry3D();
        geo.setAttribute('position', new Float32Array(pos), 3);
        if (hasT) geo.setAttribute('uv', new Float32Array(uv), 2);
        if (C) geo.setAttribute('color', new Float32Array(colr), 4);
        geo.setIndex(idx);
        if (hasN) geo.setAttribute('normal', new Float32Array(nrm), 3); else geo.computeNormals();
        var mesh = new Mesh3D(geo, getMat(g.material, !!C));
        mesh.name = g.name;
        model.template.add(mesh);
      });
      model.nodes = model.template.children.slice();
      return Promise.all(loads).then(function () {
        // texturas que no se pudieron cargar: se quitan del material (si no, saldría negro)
        model.materials.forEach(function (m) { ['map', 'normalMap', 'emissiveMap'].forEach(function (k) { if (m[k] && !m[k].source.resource) { m[k] = null; m.version++; } }); });
        return model;
      });
    });
  }
};

UG.OBJ = OBJ;
