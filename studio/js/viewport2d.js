/* UltraGame Studio · vista de edición 2D. Usa el propio motor (mismo aspecto que en juego) con los objetos
 * construidos por el runtime en modo edición (sin comportamientos, scripts ni física). */
const S = window.UGStudio.schema, RT = window.UGStudio.runtime, UG = window.UG;
const HANDLE = 7;

export class Viewport2D {
  constructor(app, host) {
    this.app = app; this.host = host; this.kind = '2d'; this.game = null; this.scene = null; this.built = null; this.loaded = new Map();
    this.tool = 'select'; this.snap = true; this.snapStep = 16; this.drag = null; this.hover = null; this.destroyed = false;
    this.cam = { x: 0, y: 0, zoom: 1, inited: false };
    this.showColliders = true;
  }
  mount() {
    const self = this, w = Math.max(64, this.host.clientWidth), h = Math.max(64, this.host.clientHeight);
    this.game = new UG.Game({ parent: this.host, width: w, height: h, scale: { mode: 'resize' }, renderer: ['webgl2', 'webgl', 'canvas'], backgroundColor: 0x0b0d14, banner: false, audio: { noAudio: true }, pauseOnHidden: false, antialias: true,
      scenes: [{ key: 'edit', create: function () { self.scene = this; self.onCreate(); }, update: function () { self.frame(); } }] });
    this.ro = new ResizeObserver(() => { if (this.game && this.host.clientWidth > 8 && this.host.clientHeight > 8) this.game.scale.refresh(); });
    this.ro.observe(this.host);
    this.bindDom();
  }
  destroy() {
    this.destroyed = true;
    if (this.ro) this.ro.disconnect();
    this.unbindDom();
    if (this.game) { this.game.destroy(true); this.game = null; }
    this.scene = null; this.built = null; this.loaded.clear();
  }
  setActive(on) { if (!this.game) return; if (on) { if (!this.game.loop.running) this.game.loop.start(); } else this.game.loop.stop(); }
  /* ---------------------------------------------------------------- creación */
  onCreate() {
    const sc = this.scene;
    this.bg = sc.add.graphics(); this.bg.depth = -1e9;
    this.overlay = sc.add.hud.graphics(); this.overlay.depth = 1e9;
    sc.input.on('pointerdown', (p) => this.onDown(p));
    sc.input.on('pointermove', (p) => this.onMove(p));
    sc.input.on('pointerup', (p) => this.onUp(p));
    sc.input.on('wheel', (p, objs, dx, dy) => this.onWheel(p, dy));
    this.syncAssets(true);
  }
  /** Carga en esta vista los recursos del proyecto que falten (o que cambiaron) y reconstruye */
  async syncAssets(force) {
    const ed = this.app.editor, sc = this.scene; if (!sc || !ed.project) return;
    const want = ed.project.assets.filter((a) => a.type === 'image' || a.type === 'tilemap');
    const L = sc.load; let queued = 0;
    for (const a of want) {
      const sig = a.file + '|' + a.frameWidth + '|' + a.frameHeight + '|' + (ed.assetVersion[a.id] || 0);
      if (this.loaded.get(a.id) === sig) continue;
      let url; try { url = await ed.assetURL(a); } catch (e) { continue; }
      if (this.destroyed || !this.scene) return;
      if (sc.textures.exists(a.id)) { this.clearBuilt(); sc.textures.remove(a.id); } // sustituir: primero se retiran los objetos que la usan
      if (a.type === 'image') { if (a.frameWidth > 0) L.spritesheet(a.id, url, { frameWidth: a.frameWidth, frameHeight: a.frameHeight || a.frameWidth }); else if (/\.svg$/i.test(a.file)) L.svg(a.id, url); else L.image(a.id, url); }
      else { if (sc.cache.tilemap.has(a.id)) { this.clearBuilt(); sc.cache.tilemap.delete(a.id); } L.tilemapTiledJSON(a.id, url); }
      this.loaded.set(a.id, sig); queued++;
    }
    if (queued) { L.once('complete', () => this.rebuild()); L.start(); } else if (force) this.rebuild();
  }
  clearBuilt() {
    if (!this.built) return;
    this.built.rt.entities.forEach((e) => { if (e.obj && !e.obj.destroyed) e.obj.destroy(); });
    this.built.rt.shutdown();
    this.built = null;
  }
  rebuild() {
    const ed = this.app.editor; if (!this.scene || !ed.project || !ed.scene) return;
    this.clearBuilt();
    const def = ed.scene;
    this.scene.cameras.main.setBackgroundColor(0x0b0d14);
    try { this.built = RT.buildForEditor(this.scene, ed.project, def, { hudAsWorld: true, onLog: (l, t, s) => { if (l === 'error') this.app.console.log('warn', t, 'editor · ' + s); } }); }
    catch (e) { this.app.console.log('error', 'No se pudo mostrar la escena: ' + e.message, 'editor'); return; }
    this.scene.cameras.main.setFilters(null); // los efectos de pantalla se ven al jugar
    // nodos ocultos: translúcidos en el editor (para poder seleccionarlos)
    this.built.rt.entities.forEach((e) => { if (!e.node.visible && e.obj) { e.obj.visible = true; e.obj.alpha *= 0.35; } });
    if (!this.cam.inited) this.home();
    this.applyCam();
  }
  /** Solo cambió la posición/rotación/escala: se aplica sin reconstruir */
  applyTransforms() {
    if (!this.built) return this.rebuild();
    const ed = this.app.editor;
    for (const n of ed.scene.nodes) {
      const e = this.built.byNode[n.id]; if (!e || !e.obj || e.is3d) continue;
      const o = e.obj, base = e._base || (e._base = { sx: o.scaleX / (e.node.scaleX || 1), sy: o.scaleY / (e.node.scaleY || 1) });
      o.x = n.x; o.y = n.y; o.angle = n.rotation; o.scaleX = base.sx * n.scaleX; o.scaleY = base.sy * n.scaleY; o.alpha = n.alpha * (n.visible ? 1 : 0.35); o.depth = n.depth; o.visible = true;
      e.node = n;
    }
  }
  /* ---------------------------------------------------------------- cámara */
  home() {
    const ed = this.app.editor, P = ed.project.settings, W = this.game.width, H = this.game.height;
    const z = Math.min(W / (P.width * 1.1), H / (P.height * 1.1));
    this.cam = { x: P.width / 2, y: P.height / 2, zoom: Math.max(0.05, Math.min(4, z)), inited: true };
    this.applyCam();
  }
  focus() {
    const ed = this.app.editor, b = this.selBounds(); if (!b) return;
    const W = this.game.width, H = this.game.height;
    this.cam.x = (b.x0 + b.x1) / 2; this.cam.y = (b.y0 + b.y1) / 2;
    this.cam.zoom = Math.max(0.05, Math.min(8, Math.min(W / Math.max(64, (b.x1 - b.x0) * 3), H / Math.max(64, (b.y1 - b.y0) * 3))));
    this.applyCam(); void ed;
  }
  applyCam() { if (!this.scene) return; const c = this.scene.cameras.main; c.setZoom(this.cam.zoom); c.centerOn(this.cam.x, this.cam.y); }
  toWorld(sx, sy) { return this.scene.cameras.main.getWorldPoint(sx, sy); }
  toScreen(wx, wy) {
    // inversa numérica de getWorldPoint (afín): funciona con cualquier origen/zoom de la cámara
    const c = this.scene.cameras.main, o = c.getWorldPoint(0, 0), ax = c.getWorldPoint(1, 0), ay = c.getWorldPoint(0, 1);
    const a = ax.x - o.x, b = ax.y - o.y, cc = ay.x - o.x, d = ay.y - o.y, det = a * d - b * cc || 1e-9, dx = wx - o.x, dy = wy - o.y;
    return { x: (d * dx - cc * dy) / det, y: (-b * dx + a * dy) / det };
  }
  onWheel(p, dy) {
    const before = this.toWorld(p.x, p.y);
    this.cam.zoom = Math.max(0.03, Math.min(16, this.cam.zoom * Math.exp(-dy * 0.0015)));
    this.applyCam();
    const after = this.toWorld(p.x, p.y);
    this.cam.x += before.x - after.x; this.cam.y += before.y - after.y; this.applyCam();
  }
  /* ---------------------------------------------------------------- selección */
  entities() { return this.built ? this.built.rt.entities.filter((e) => e.alive && e.obj && !e.is3d) : []; }
  /** Esquinas del objeto en coordenadas de mundo (caja orientada) */
  corners(e) {
    const o = e.obj; let r;
    try { r = o.getLocalBounds(); } catch (x) { r = null; }
    if (!r || !(r.width > 0) || !(r.height > 0)) r = { x: -10, y: -10, width: 20, height: 20 };
    const m = o.getWorldMatrix();
    return [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height]].map((p) => ({ x: m.a * p[0] + m.c * p[1] + m.tx, y: m.b * p[0] + m.d * p[1] + m.ty }));
  }
  pick(wx, wy) {
    const list = this.entities().filter((e) => e.node.visible || this.app.editor.selection.includes(e.node.id));
    // de arriba abajo: profundidad y orden de creación
    list.sort((a, b) => (b.obj.depth - a.obj.depth) || (b.id - a.id));
    for (const e of list) {
      const c = this.corners(e);
      if (pointInQuad(wx, wy, c)) return e;
    }
    return null;
  }
  selBounds() {
    const ed = this.app.editor; let b = null;
    for (const id of ed.selection) { const e = this.built && this.built.byNode[id]; if (!e || !e.obj) continue; for (const p of this.corners(e)) b = b ? { x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y), x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y) } : { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; }
    return b;
  }
  /* ---------------------------------------------------------------- ratón */
  onDown(p) {
    const ed = this.app.editor; if (!this.built) return;
    this.host.focus({ preventScroll: true });
    const ev = p.event || {};
    if (p.button === 1 || p.button === 2 || (p.button === 0 && this.app.keys.has(' '))) { this.drag = { mode: 'pan', sx: p.x, sy: p.y, cx: this.cam.x, cy: this.cam.y }; return; }
    if (p.button !== 0) return;
    const w = this.toWorld(p.x, p.y);
    // asas de la herramienta activa
    const hnd = this.handleAt(p.x, p.y);
    if (hnd) { this.beginTransform(hnd, w); return; }
    const hit = this.pick(w.x, w.y);
    if (!hit) { if (!(ev.ctrlKey || ev.shiftKey)) ed.select([]); this.drag = { mode: 'box', sx: p.x, sy: p.y, ex: p.x, ey: p.y }; return; }
    const id = hit.node.id;
    if (ev.ctrlKey || ev.shiftKey) { ed.select(id, true); return; }
    if (!ed.selection.includes(id)) ed.select(id);
    this.beginTransform({ kind: this.tool === 'select' ? 'move' : this.tool === 'rotate' ? 'rotate' : 'move' }, w);
  }
  beginTransform(hnd, w) {
    const ed = this.app.editor, items = [];
    for (const id of ed.selection) { const n = ed.node(id), e = this.built.byNode[id]; if (!n || !e || !e.obj || S.NODE_TYPES[n.type].kind === '3d') continue; items.push({ id, n: JSON.parse(JSON.stringify({ x: n.x, y: n.y, rotation: n.rotation, scaleX: n.scaleX, scaleY: n.scaleY })), e, inv0: invLocal(e.obj) }); }
    if (!items.length) return;
    // un objeto hijo se mueve en coordenadas de su padre: convertimos el arrastre al espacio local de cada uno
    const b = this.selBounds(), piv = items.length === 1 ? parentToWorld(items[0].e.obj, items[0].n.x, items[0].n.y) : { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    this.drag = { mode: hnd.kind, axis: hnd.axis || null, start: w, items, pivot: piv, moved: false, a0: Math.atan2(w.y - piv.y, w.x - piv.x), d0: Math.max(1, Math.hypot(w.x - piv.x, w.y - piv.y)), hx: hnd.hx, hy: hnd.hy };
  }
  onMove(p) {
    const d = this.drag;
    if (!d) { this.hover = this.handleAt(p.x, p.y); this.host.style.cursor = this.hover ? (this.hover.kind === 'rotate' ? 'grab' : this.hover.kind === 'scale' ? 'nwse-resize' : 'move') : ''; this.updateInfo(p); return; }
    if (d.mode === 'pan') { this.cam.x = d.cx - (p.x - d.sx) / this.cam.zoom; this.cam.y = d.cy - (p.y - d.sy) / this.cam.zoom; this.applyCam(); return; }
    if (d.mode === 'box') { d.ex = p.x; d.ey = p.y; return; }
    const w = this.toWorld(p.x, p.y), ev = p.event || {}, step = this.snap && !ev.altKey ? this.snapStep : 0;
    d.moved = true;
    if (d.mode === 'move') {
      let dx = w.x - d.start.x, dy = w.y - d.start.y;
      if (d.axis === 'x') dy = 0; else if (d.axis === 'y') dx = 0;
      for (const it of d.items) {
        const o = it.e.obj, lp = worldDeltaToParent(o, dx, dy);
        let nx = it.n.x + lp.x, ny = it.n.y + lp.y;
        if (step) { if (d.axis !== 'y') nx = Math.round(nx / step) * step; if (d.axis !== 'x') ny = Math.round(ny / step) * step; }
        o.x = nx; o.y = ny; it.v = { x: round3(nx), y: round3(ny) };
      }
    } else if (d.mode === 'rotate') {
      const a = Math.atan2(w.y - d.pivot.y, w.x - d.pivot.x), da = (a - d.a0) * 180 / Math.PI;
      for (const it of d.items) { let r = it.n.rotation + da; if (ev.shiftKey || this.snap) r = Math.round(r / 15) * 15; r = ((r + 180) % 360 + 360) % 360 - 180; it.e.obj.angle = r; it.v = { rotation: round3(r) }; }
    } else if (d.mode === 'scale') {
      const it = d.items[0]; if (!it) return;
      const o = it.e.obj, ls = applyM(it.inv0, w.x, w.y), l0 = applyM(it.inv0, d.start.x, d.start.y); // inversa de la matriz inicial
      const base = it.e._base || (it.e._base = { sx: o.scaleX / (it.n.scaleX || 1), sy: o.scaleY / (it.n.scaleY || 1) });
      let fx = Math.abs(l0.x) > 1e-3 ? ls.x / l0.x : 1, fy = Math.abs(l0.y) > 1e-3 ? ls.y / l0.y : 1;
      if (d.hx === 0) fx = 1; if (d.hy === 0) fy = 1;
      // esquinas: proporcional (Mayús = libre); lados: un solo eje
      if (d.hx !== 0 && d.hy !== 0 && !ev.shiftKey) { const f = Math.max(Math.abs(fx), Math.abs(fy)); fx = fx < 0 ? -f : f; fy = fy < 0 ? -f : f; }
      let sx = it.n.scaleX * fx, sy = it.n.scaleY * fy;
      if (this.snap) { sx = Math.round(sx * 20) / 20; sy = Math.round(sy * 20) / 20; }
      sx = clampScale(sx); sy = clampScale(sy);
      o.scaleX = base.sx * sx; o.scaleY = base.sy * sy; it.v = { scaleX: round3(sx), scaleY: round3(sy) };
    }
  }
  onUp(p) {
    const d = this.drag, ed = this.app.editor; this.drag = null; if (!d) return;
    if (d.mode === 'box') {
      const x0 = Math.min(d.sx, d.ex), x1 = Math.max(d.sx, d.ex), y0 = Math.min(d.sy, d.ey), y1 = Math.max(d.sy, d.ey);
      if (x1 - x0 < 4 || y1 - y0 < 4) return;
      const a = this.toWorld(x0, y0), b = this.toWorld(x1, y1), ids = [];
      for (const e of this.entities()) { const c = this.corners(e); if (c.every((q) => q.x >= Math.min(a.x, b.x) && q.x <= Math.max(a.x, b.x) && q.y >= Math.min(a.y, b.y) && q.y <= Math.max(a.y, b.y))) ids.push(e.node.id); }
      ed.select(ids, (p.event || {}).ctrlKey);
      return;
    }
    if ((d.mode === 'move' || d.mode === 'rotate' || d.mode === 'scale') && d.moved) {
      const changes = d.items.filter((it) => it.v).map((it) => ({ id: it.id, values: it.v }));
      if (changes.length) ed.setTransforms(changes, d.mode === 'move' ? 'Mover' : d.mode === 'rotate' ? 'Rotar' : 'Escalar');
    }
  }
  /** Asas: flechas X/Y del centro (mover), anillo (rotar) o esquinas/lados (escalar) */
  handleAt(sx, sy) {
    const ed = this.app.editor; if (!this.built || !ed.selection.length) return null;
    const b = this.selBounds(); if (!b) return null;
    const one = ed.selection.length === 1 ? this.built.byNode[ed.selection[0]] : null;
    const pw = one ? parentToWorld(one.obj, ed.selected.x, ed.selected.y) : { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }, pv = this.toScreen(pw.x, pw.y);
    if (this.tool === 'select') {
      if (Math.abs(sx - (pv.x + 50)) < 10 && Math.abs(sy - pv.y) < 9) return { kind: 'move', axis: 'x' };
      if (Math.abs(sx - pv.x) < 9 && Math.abs(sy - (pv.y - 50)) < 10) return { kind: 'move', axis: 'y' };
      if (Math.abs(sx - pv.x) < 8 && Math.abs(sy - pv.y) < 8) return { kind: 'move' };
    } else if (this.tool === 'rotate') {
      const r = Math.hypot(sx - pv.x, sy - pv.y); if (Math.abs(r - 60) < 9) return { kind: 'rotate' };
    } else if (this.tool === 'scale' && one) {
      const c = this.corners(one).map((q) => this.toScreen(q.x, q.y));
      const pts = [[c[0], -1, -1], [c[1], 1, -1], [c[2], 1, 1], [c[3], -1, 1], [mid(c[0], c[1]), 0, -1], [mid(c[1], c[2]), 1, 0], [mid(c[2], c[3]), 0, 1], [mid(c[3], c[0]), -1, 0]];
      for (const q of pts) if (Math.abs(sx - q[0].x) <= HANDLE && Math.abs(sy - q[0].y) <= HANDLE) return { kind: 'scale', hx: q[1], hy: q[2] };
    }
    return null;
  }
  updateInfo(p) {
    if (!this.scene) return;
    const w = this.toWorld(p.x, p.y);
    const info = document.getElementById('vp-info'); if (info) info.textContent = 'x ' + Math.round(w.x) + '  y ' + Math.round(w.y) + '  ·  ' + Math.round(this.cam.zoom * 100) + '%';
  }
  /* ---------------------------------------------------------------- dibujo */
  frame() {
    if (!this.scene || !this.app.editor.project || !this.app.editor.scene) return;
    const ed = this.app.editor, P = ed.project.settings, def = ed.scene, g = this.bg, o = this.overlay, z = this.cam.zoom;
    // fondo de la escena (marco del juego), rejilla y ejes
    g.clear().fillStyle(S.colorNum(def.background), 1).fillRect(0, 0, P.width, P.height);
    const step = this.snapStep > 0 ? this.snapStep : 16, big = step * 8;
    const tl = this.toWorld(0, 0), br = this.toWorld(this.game.width, this.game.height);
    const minor = step * z >= 8;
    const lines = (st, alpha) => {
      g.lineStyle(1 / z, 0xffffff, alpha);
      for (let x = Math.floor(tl.x / st) * st; x <= br.x; x += st) g.lineBetween(x, tl.y, x, br.y);
      for (let y = Math.floor(tl.y / st) * st; y <= br.y; y += st) g.lineBetween(tl.x, y, br.x, y);
    };
    if ((br.x - tl.x) / step < 600 && minor) lines(step, 0.045);
    if ((br.x - tl.x) / big < 600) lines(big, 0.09);
    g.lineStyle(2 / z, 0x6d83ff, 0.9).strokeRect(0, 0, P.width, P.height);
    // selección y asas (en pantalla)
    o.clear();
    if (this.showColliders) this.drawColliders(o);
    for (const id of ed.selection) {
      const e = this.built && this.built.byNode[id]; if (!e || !e.obj || e.obj.destroyed) continue;
      const c = this.corners(e).map((q) => this.toScreen(q.x, q.y));
      o.lineStyle(1.5, 0x3fd6b4, 1).strokePoints(c, true);
      if (this.tool === 'scale' && ed.selection.length === 1) { o.fillStyle(0xffffff, 1); [c[0], c[1], c[2], c[3], mid(c[0], c[1]), mid(c[1], c[2]), mid(c[2], c[3]), mid(c[3], c[0])].forEach((q) => o.fillRect(q.x - HANDLE / 2, q.y - HANDLE / 2, HANDLE, HANDLE)); }
    }
    if (ed.selection.length) {
      const b = this.selBounds();
      if (b) {
        const one = ed.selection.length === 1 && this.built ? this.built.byNode[ed.selection[0]] : null;
        const pw = one && ed.selected ? parentToWorld(one.obj, ed.selected.x, ed.selected.y) : { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }, pv = this.toScreen(pw.x, pw.y), hv = this.hover || {};
        if (this.tool === 'select') {
          o.lineStyle(3, hv.axis === 'x' ? 0xffe066 : 0xff6b6b, 1).lineBetween(pv.x, pv.y, pv.x + 46, pv.y).fillStyle(hv.axis === 'x' ? 0xffe066 : 0xff6b6b, 1).fillTriangle(pv.x + 56, pv.y, pv.x + 44, pv.y - 6, pv.x + 44, pv.y + 6);
          o.lineStyle(3, hv.axis === 'y' ? 0xffe066 : 0x69db7c, 1).lineBetween(pv.x, pv.y, pv.x, pv.y - 46).fillStyle(hv.axis === 'y' ? 0xffe066 : 0x69db7c, 1).fillTriangle(pv.x, pv.y - 56, pv.x - 6, pv.y - 44, pv.x + 6, pv.y - 44);
          o.fillStyle(hv.kind === 'move' && !hv.axis ? 0xffe066 : 0xffffff, 0.9).fillRect(pv.x - 6, pv.y - 6, 12, 12);
        } else if (this.tool === 'rotate') { o.lineStyle(3, hv.kind === 'rotate' ? 0xffe066 : 0x74c0fc, 0.95).strokeCircle(pv.x, pv.y, 60).fillStyle(0xffffff, 1).fillCircle(pv.x, pv.y, 3); }
      }
    }
    const d = this.drag;
    if (d && d.mode === 'box') o.fillStyle(0x6d83ff, 0.12).fillRect(Math.min(d.sx, d.ex), Math.min(d.sy, d.ey), Math.abs(d.ex - d.sx), Math.abs(d.ey - d.sy)).lineStyle(1, 0x6d83ff, 0.9).strokeRect(Math.min(d.sx, d.ex), Math.min(d.sy, d.ey), Math.abs(d.ex - d.sx), Math.abs(d.ey - d.sy));
  }
  /** Cuerpos de colisión tal como los usará el juego: naranja = estático, azul = cinemático, amarillo = dinámico */
  drawColliders(o) {
    const ed = this.app.editor, rt = this.built && this.built.rt; if (!rt || !rt.colliderShape2D) return;
    for (const e of this.entities()) {
      const ph = e.node.physics; if (!ph || ph.type === 'none' || e.node.hud || e.obj.destroyed) continue;
      let s = null; try { s = rt.colliderShape2D(e); } catch (x) { s = null; }
      if (!s) continue;
      const sel = ed.selection.includes(e.node.id), col = ph.type === 'static' ? 0xff922b : ph.type === 'kinematic' ? 0x74c0fc : 0xffd43b;
      o.lineStyle(sel ? 2 : 1.25, col, sel ? 1 : 0.75);
      if (s.kind === 'circle') { const c = this.toScreen(s.x, s.y); o.strokeCircle(c.x, c.y, s.r * this.cam.zoom); continue; }
      const pts = (s.kind === 'poly' ? s.pts : [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }]).map((q) => this.toScreen(q.x, q.y));
      o.strokePoints(pts, true);
      // plataforma de un sentido: el borde que sostiene, más grueso
      if (ph.oneWay && ph.type !== 'dynamic' && pts.length === 4) o.lineStyle(4, col, 1).lineBetween(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
    }
  }
  /* ---------------------------------------------------------------- DOM: soltar recursos, teclado */
  bindDom() {
    this._dragover = (e) => { if (e.dataTransfer.types.includes('application/x-ugs-asset') || e.dataTransfer.types.includes('Files')) { e.preventDefault(); this.host.classList.add('drop'); } };
    this._dragleave = () => this.host.classList.remove('drop');
    this._drop = (e) => {
      this.host.classList.remove('drop'); if (!this.scene) return;
      const r = this.host.getBoundingClientRect(), w = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      const id = e.dataTransfer.getData('application/x-ugs-asset');
      if (id) { e.preventDefault(); const a = this.app.editor.assetById(id); if (a) this.app.placeAsset(a, { x: Math.round(w.x), y: Math.round(w.y) }); }
      else if (e.dataTransfer.files.length) { e.preventDefault(); this.app.importList(Array.from(e.dataTransfer.files), { x: Math.round(w.x), y: Math.round(w.y) }); }
    };
    this._ctx = (e) => e.preventDefault();
    this.host.addEventListener('dragover', this._dragover); this.host.addEventListener('dragleave', this._dragleave); this.host.addEventListener('drop', this._drop); this.host.addEventListener('contextmenu', this._ctx);
  }
  unbindDom() { if (!this._drop) return; this.host.removeEventListener('dragover', this._dragover); this.host.removeEventListener('dragleave', this._dragleave); this.host.removeEventListener('drop', this._drop); this.host.removeEventListener('contextmenu', this._ctx); }
  /** Flechas: mover la selección 1 px (Mayús: un paso de rejilla) */
  nudge(dx, dy, big) {
    const ed = this.app.editor, s = big ? (this.snapStep || 16) : 1;
    const ch = ed.selection.map((id) => ed.node(id)).filter((n) => n && n.x !== undefined).map((n) => ({ id: n.id, values: { x: n.x + dx * s, y: n.y + dy * s } }));
    if (ch.length) ed.setTransforms(ch, 'Mover');
  }
  /** Punto de mundo visible en el centro (para colocar objetos nuevos) */
  centerPoint() { return { x: Math.round(this.cam.x), y: Math.round(this.cam.y) }; }
}

/* ---------------------------------------------------------------- geometría */
function pointInQuad(x, y, c) { let inside = false; for (let i = 0, j = 3; i < 4; j = i++) { const a = c[i], b = c[j]; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside; } return inside; }
function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function round3(v) { return Math.round(v * 1000) / 1000; }
function clampScale(v) { if (Math.abs(v) < 0.01) return v < 0 ? -0.01 : 0.01; return Math.max(-1000, Math.min(1000, v)); }
function parentToWorld(o, x, y) { const p = o.parent; if (!p || p.name === '__world' || p.name === '__hud') return { x, y }; const m = p.getWorldMatrix(); return { x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty }; }
function worldDeltaToParent(o, dx, dy) { const p = o.parent; if (!p || p.name === '__world' || p.name === '__hud') return { x: dx, y: dy }; const m = p.getWorldMatrix(), det = m.a * m.d - m.b * m.c || 1e-9; return { x: (m.d * dx - m.c * dy) / det, y: (-m.b * dx + m.a * dy) / det }; }
function invLocal(o) { const m = o.getWorldMatrix(), det = m.a * m.d - m.b * m.c || 1e-9; return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, tx: (m.c * m.ty - m.d * m.tx) / det, ty: (m.b * m.tx - m.a * m.ty) / det }; }
function applyM(m, x, y) { return { x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty }; }
