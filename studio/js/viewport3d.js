/* UltraGame Studio · vista de edición 3D: cámara orbital del editor, rejilla, iconos de luces/cámaras,
 * selección por rayo y gizmos de mover/rotar/escalar (arrastre sobre el eje exacto, como en Unity/Godot). */
import { wheelSpeed } from './navigation.js';
const S = window.UGStudio.schema, RT = window.UGStudio.runtime, UG = window.UG, V3 = UG.Vec3, DEG = Math.PI / 180;
const AXES = { x: new V3(1, 0, 0), y: new V3(0, 1, 0), z: new V3(0, 0, 1) }, AXCOL = { x: 0xff5c5c, y: 0x5ce67a, z: 0x5c9dff };

export class Viewport3D {
  constructor(app, host) {
    this.app = app; this.host = host; this.kind = '3d'; this.game = null; this.scene = null; this.built = null; this.loaded = new Map();
    this.tool = 'select'; this.snap = true; this.snapStep = 0.5; this.drag = null; this.destroyed = false; this.keys = new Set();
    this.orbit = { target: new V3(0, 0, 0), yaw: 0.7, pitch: 0.55, dist: 18, inited: false };
    this.helpers = []; this.gizmo = null; this.selBox = null; this.showColliders = true;
  }
  mount() {
    const self = this, w = Math.max(64, this.host.clientWidth), h = Math.max(64, this.host.clientHeight);
    this.game = new UG.Game({ parent: this.host, width: w, height: h, scale: { mode: 'resize' }, renderer: ['webgl2', 'webgpu', 'webgl'], backgroundColor: 0x0b0d14, banner: false, audio: { noAudio: true }, pauseOnHidden: false,
      scenes: [{ key: 'edit3d', create: function () { self.scene = this; self.onCreate(); }, update: function (t, dt) { self.frame(dt); } }] });
    this.ro = new ResizeObserver(() => { if (this.game && this.host.clientWidth > 8 && this.host.clientHeight > 8) this.game.scale.refresh(); });
    this.ro.observe(this.host);
    this.bindDom();
  }
  destroy() {
    this.destroyed = true; if (this.ro) this.ro.disconnect(); this.unbindDom();
    this.clearBuilt();
    if (this.game) { this.game.destroy(true); this.game = null; }
    this.scene = null; this.loaded.clear();
  }
  setActive(on) { if (!this.game) return; if (on) { if (!this.game.loop.running) this.game.loop.start(); } else this.game.loop.stop(); }
  onCreate() {
    const sc = this.scene;
    // capa de dibujo del editor en el mundo 2D (sin escala): el HUD se escala para encajar la pantalla del juego
    this.overlay = sc.add.graphics(); this.overlay.depth = 1e9;
    sc.input.on('pointerdown', (p) => this.onDown(p));
    sc.input.on('pointermove', (p) => this.onMove(p));
    sc.input.on('pointerup', (p) => this.onUp(p));
    sc.input.on('wheel', (p, objs, dx, dy) => { this.orbit.dist = Math.max(0.5, Math.min(2000, this.orbit.dist * Math.exp(dy * 0.0012 * wheelSpeed('scene3d')))); });
    if (!sc.textures.exists('ugs-grid')) sc.textures.generate('ugs-grid', 256, 256, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h); ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1;
      for (let i = 0; i <= 8; i++) { const v = Math.round(i * w / 8) + 0.5; ctx.beginPath(); ctx.moveTo(v, 0); ctx.lineTo(v, h); ctx.moveTo(0, v); ctx.lineTo(w, v); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(255,255,255,0.32)'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, h - 2);
    });
    this.syncAssets(true);
  }
  async syncAssets(force) {
    const ed = this.app.editor, sc = this.scene; if (!sc || !ed.project) return;
    const L = sc.load; let queued = 0;
    for (const a of ed.project.assets) {
      if (a.type !== 'image' && a.type !== 'model') continue;
      const sig = a.file + '|' + a.frameWidth + '|' + a.frameHeight + '|' + (ed.assetVersion[a.id] || 0);
      if (this.loaded.get(a.id) === sig) continue;
      let url; try { url = await ed.assetURL(a); } catch (e) { continue; }
      if (this.destroyed || !this.scene) return;
      // si se sustituye un recurso ya cargado, primero se retiran los objetos que lo usan
      const replacing = a.type === 'image' ? sc.textures.exists(a.id) : !!sc.cache.models.get(a.id);
      if (replacing) this.clearBuilt();
      if (a.type === 'image') { if (sc.textures.exists(a.id)) sc.textures.remove(a.id); if (a.frameWidth > 0) L.spritesheet(a.id, url, { frameWidth: a.frameWidth, frameHeight: a.frameHeight || a.frameWidth }); else if (/\.svg$/i.test(a.file)) L.svg(a.id, url); else L.image(a.id, url); }
      else { const old = sc.cache.models.get(a.id); if (old) { sc.cache.models.delete(a.id); if (old.destroy) old.destroy(); } if (/\.obj$/i.test(a.file)) L.obj(a.id, url); else L.gltf(a.id, url); }
      this.loaded.set(a.id, sig); queued++;
    }
    if (queued) { L.once('complete', () => this.rebuild()); L.start(); } else if (force) this.rebuild();
  }
  clipsOf(assetId) { const m = this.scene && this.scene.cache.models && this.scene.cache.models.get(assetId); return m && m.clipNames ? m.clipNames : []; }
  clearBuilt() {
    this.helpers = []; this.gizmo = null; this.selBox = null;
    if (!this.built) return;
    const rt = this.built.rt, v = rt.view;
    rt.entities.forEach((e) => { if (e.obj && !e.obj.destroyed && !e.is3d) e.obj.destroy(); });
    rt.shutdown();
    if (v && !v.destroyed) v.destroy(); // destruye la escena 3D entera (mallas, luces, partículas)
    this.built = null;
  }
  rebuild() {
    const ed = this.app.editor; if (!this.scene || !ed.project || !ed.scene || ed.scene.kind !== '3d') return;
    this.clearBuilt();
    try { this.built = RT.buildForEditor(this.scene, ed.project, ed.scene, { onLog: (l, t, s) => { if (l === 'error') this.app.console.log('warn', t, 'editor · ' + s); } }); }
    catch (e) { this.app.console.log('error', 'No se pudo mostrar la escena 3D: ' + e.message, 'editor'); console.error(e); return; }
    const v = this.built.rt.view; if (!v) return;
    v.filters = null; // los efectos de pantalla se ven al jugar
    v.camera.far = Math.max(v.camera.far || 1000, 3000); if (v.camera.updateProjectionMatrix) v.camera.updateProjectionMatrix();
    // escala del HUD: la pantalla del juego encajada en la vista
    this.fitHud();
    // rejilla y ejes
    const grid = v.add.plane(400, 400, { type: 'basic', map: 'ugs-grid', uvScale: 50, transparent: true, opacity: 1, fog: false, depthWrite: false });
    grid.position.y = 0.01; grid.castShadow = false; grid.receiveShadow = false; grid.renderOrder = 5; grid.ugsEditor = 'grid';
    ['x', 'z'].forEach((ax) => { const b = v.add.box(ax === 'x' ? 400 : 0.03, 0.03, ax === 'z' ? 400 : 0.03, { type: 'basic', color: AXCOL[ax], fog: false }); b.position.y = 0.02; b.castShadow = false; b.ugsEditor = 'grid'; });
    // iconos de objetos sin malla (luces, cámaras, grupos)
    for (const e of this.built.rt.entities) this.addHelper(e);
    // nodos ocultos: se ven translúcidos en el editor
    for (const e of this.built.rt.entities) if (!e.node.visible && e.obj) { e.obj.visible = true; if (!e.is3d) e.obj.alpha *= 0.35; else e.obj.traverse((n) => { if (n.material) { n.material = n.material.clone ? n.material.clone() : n.material; n.material.transparent = true; n.material.opacity = 0.3; } }); }
    this.buildGizmo();
    if (!this.orbit.inited) this.home();
  }
  fitHud() {
    const P = this.app.editor.project.settings, W = this.game.width, H = this.game.height, s = Math.min(W / P.width, H / P.height), hud = this.scene.hud;
    hud.scaleX = hud.scaleY = s; hud.x = (W - P.width * s) / 2; hud.y = (H - P.height * s) / 2;
    this.hudFit = { s, x: hud.x, y: hud.y, w: P.width * s, h: P.height * s };
  }
  addHelper(e) {
    const v = this.built.rt.view, n = e.node; if (!e.is3d || !e.obj) return;
    let icon = null;
    if (n.type === 'light') icon = v.add.sphere(0.22, { type: 'basic', color: n.props.light === 'directional' ? 0xffd43b : S.colorNum(n.props.color), fog: false }, 12);
    else if (n.type === 'camera3d') { icon = v.add.cone(0.35, 0.7, { type: 'basic', color: 0xe599f7, fog: false }, 4); }
    else if (n.type === 'group3d' || n.type === 'particles3d') icon = v.add.box(0.3, 0.3, 0.3, { type: 'basic', color: n.type === 'group3d' ? 0x74c0fc : 0xff922b, fog: false, opacity: 0.8, transparent: true });
    if (!icon) return;
    icon.castShadow = false; icon.ugsEditNode = n.id; icon.renderOrder = 20;
    if (n.type === 'camera3d') { icon.position.set(n.position[0], n.position[1], n.position[2]); icon.lookAt(n.props.target[0], n.props.target[1], n.props.target[2]); icon.rotateX && icon.rotateX(Math.PI / 2); }
    else if (n.type === 'light' && (n.props.light === 'directional' || n.props.light === 'hemisphere' || n.props.light === 'ambient')) icon.position.set(n.position[0], n.position[1], n.position[2]);
    else { e.obj.getWorldPosition(icon.position); }
    this.helpers.push({ icon, e });
  }
  /* ---------------------------------------------------------------- gizmo */
  buildGizmo() {
    const v = this.built.rt.view, g = new UG.Group3D(); g.name = 'gizmo'; v.scene3d.add(g); this.gizmo = { root: g, parts: [] };
    const mat = (c) => v.material({ type: 'basic', color: c, depthTest: false, depthWrite: false, fog: false });
    for (const ax of ['x', 'y', 'z']) {
      const grp = new UG.Group3D();
      if (this.tool === 'rotate') { const ring = new UG.Mesh3D(UG.Geometry3D.torus(1.1, 0.035), mat(AXCOL[ax])); ring.ugsAxis = ax; grp.add(ring); if (ax === 'x') ring.rotation.y = Math.PI / 2; else if (ax === 'y') ring.rotation.x = Math.PI / 2; }
      else {
        const shaft = new UG.Mesh3D(UG.Geometry3D.cylinder(0.025, 0.025, 1, 8), mat(AXCOL[ax])); shaft.position.y = 0.5; shaft.ugsAxis = ax;
        const head = this.tool === 'scale' ? new UG.Mesh3D(UG.Geometry3D.box(0.14, 0.14, 0.14), mat(AXCOL[ax])) : new UG.Mesh3D(UG.Geometry3D.cone(0.08, 0.24, 12), mat(AXCOL[ax]));
        head.position.y = 1.05; head.ugsAxis = ax; grp.add(shaft); grp.add(head);
        // hitbox más gruesa (invisible al ojo, pero la golpea el rayo)
        const hit = new UG.Mesh3D(UG.Geometry3D.cylinder(0.09, 0.09, 1.25, 6), v.material({ type: 'basic', color: 0xffffff, transparent: true, opacity: 0.0, depthTest: false, depthWrite: false })); hit.position.y = 0.62; hit.ugsAxis = ax; grp.add(hit);
        if (ax === 'x') grp.rotation.z = -Math.PI / 2; else if (ax === 'z') grp.rotation.x = Math.PI / 2;
      }
      grp.traverse((m) => { if (m instanceof UG.Mesh3D) { m.renderOrder = 1000; m.castShadow = false; m.receiveShadow = false; this.gizmo.parts.push(m); } });
      g.add(grp);
    }
    if (this.tool !== 'rotate') { const c = new UG.Mesh3D(UG.Geometry3D.box(0.2, 0.2, 0.2), mat(0xffffff)); c.ugsAxis = this.tool === 'scale' ? 'all' : 'plane'; c.renderOrder = 1001; c.castShadow = false; g.add(c); this.gizmo.parts.push(c); }
    this.selBox = v.add.box(1, 1, 1, { type: 'basic', color: 0x3fd6b4, transparent: true, opacity: 0.12, depthWrite: false, fog: false }); this.selBox.castShadow = false; this.selBox.renderOrder = 900; this.selBox.ugsEditor = 'sel';
    g.visible = false; this.selBox.visible = false;
  }
  setTool(t) { this.tool = t; if (this.built) { if (this.gizmo) { this.gizmo.root.destroy(); } if (this.selBox) this.selBox.destroy(); this.buildGizmo(); } }
  /* ---------------------------------------------------------------- cámara del editor */
  home() {
    const ed = this.app.editor, box = new UG.Box3().makeEmpty(), cam = ed.scene && ed.scene.nodes.find((n) => n.type === 'camera3d');
    this.orbit.inited = true;
    // 1) si la escena tiene cámara, el editor empieza mirando lo mismo que verá el jugador
    if (cam) {
      const p = cam.position, t = cam.props.target, dx = p[0] - t[0], dy = p[1] - t[1], dz = p[2] - t[2], d = Math.hypot(dx, dy, dz) || 10;
      this.orbit.target.set(t[0], t[1], t[2]); this.orbit.dist = Math.max(2, d * 1.4); this.orbit.yaw = Math.atan2(dx, dz); this.orbit.pitch = Math.max(-1.4, Math.min(1.4, Math.asin(dy / d)));
      return;
    }
    // 2) si no, encuadra los objetos (sin suelos/agua gigantes, terrenos, luces ni cámaras)
    if (this.built) for (const e of this.built.rt.entities) {
      if (!e.is3d || !e.obj || e.node.type === 'light' || e.node.type === 'camera3d' || e.node.type === 'terrain') continue;
      const b = RT.worldAABB(e.obj), sz = b.getSize(new V3()); if (Math.max(sz.x, sz.z) > 150) continue;
      box.union(b);
    }
    if (box.isEmpty) { this.orbit.target.set(0, 0, 0); this.orbit.dist = 18; }
    else { const c = box.getCenter(new V3()), sz = box.getSize(new V3()); this.orbit.target.copy(c); this.orbit.dist = Math.max(4, Math.min(300, Math.max(sz.x, sz.y, sz.z) * 1.1)); }
    void ed;
  }
  focus() {
    const b = this.selectionAABB(); if (!b) return;
    const c = b.getCenter(new V3()), sz = b.getSize(new V3());
    this.orbit.target.copy(c); this.orbit.dist = Math.max(2, Math.max(sz.x, sz.y, sz.z) * 2.2);
  }
  applyCamera(dt) {
    const v = this.built && this.built.rt.view; if (!v) return;
    const o = this.orbit, cam = v.camera;
    // vuelo con WASD mientras se mantiene el botón derecho (como Unity)
    if (this.drag && this.drag.mode === 'orbit' && this.keys.size) {
      const f = new V3(-Math.sin(o.yaw) * Math.cos(o.pitch), -Math.sin(o.pitch), -Math.cos(o.yaw) * Math.cos(o.pitch)), r = new V3(Math.cos(o.yaw), 0, -Math.sin(o.yaw)), sp = Math.max(2, o.dist * 0.8) * dt * (this.keys.has('shift') ? 3 : 1);
      if (this.keys.has('w')) o.target.addScaled(f, sp); if (this.keys.has('s')) o.target.addScaled(f, -sp);
      if (this.keys.has('d')) o.target.addScaled(r, sp); if (this.keys.has('a')) o.target.addScaled(r, -sp);
      if (this.keys.has('e')) o.target.y += sp; if (this.keys.has('q')) o.target.y -= sp;
    }
    const cp = Math.cos(o.pitch);
    cam.position.set(o.target.x + Math.sin(o.yaw) * cp * o.dist, o.target.y + Math.sin(o.pitch) * o.dist, o.target.z + Math.cos(o.yaw) * cp * o.dist);
    cam.lookAt(o.target.x, o.target.y, o.target.z);
  }
  /* ---------------------------------------------------------------- selección */
  entityOfObject(obj) {
    for (let n = obj; n; n = n.parent) { if (n.ugsEditNode) return this.built.byNode[n.ugsEditNode] || null; if (n.ugsEntity) return n.ugsEntity; }
    return null;
  }
  pick(sx, sy) {
    const v = this.built.rt.view;
    // HUD primero (objetos 2D sobre la vista)
    const hudHit = this.pickHud(sx, sy); if (hudHit) return hudHit;
    const hits = v.raycast(sx, sy, { filter: (m) => !m.ugsEditor && !m.ugsAxis });
    for (const h of hits) { const e = this.entityOfObject(h.object); if (e) return e; }
    // iconos (luces, cámaras)
    for (const hp of this.helpers) { const s = v.worldToScreen(hp.icon.position); if (s.visible && Math.hypot(s.x - sx, s.y - sy) < 12) return hp.e; }
    return null;
  }
  pickHud(sx, sy) {
    const list = this.built.rt.entities.filter((e) => !e.is3d && e.obj && e.alive);
    for (let i = list.length - 1; i >= 0; i--) { const e = list[i]; try { const b = e.obj.getBounds(); const f = this.hudFit; const x = (sx - f.x) / f.s, y = (sy - f.y) / f.s; if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return e; } catch (err) { /* sin límites */ } }
    return null;
  }
  selectionAABB() {
    const ed = this.app.editor; if (!this.built) return null;
    const box = new UG.Box3().makeEmpty();
    for (const id of ed.selection) { const e = this.built.byNode[id]; if (!e || !e.obj || !e.is3d) continue; const hp = this.helpers.find((x) => x.e === e); if (hp && (e.node.type === 'light' || e.node.type === 'camera3d' || e.node.type === 'group3d')) { const p = hp.icon.position; box.expandByPoint(new V3(p.x - 0.3, p.y - 0.3, p.z - 0.3)); box.expandByPoint(new V3(p.x + 0.3, p.y + 0.3, p.z + 0.3)); } else box.union(RT.worldAABB(e.obj)); }
    return box.isEmpty ? null : box;
  }
  pivot() {
    const ed = this.app.editor, n = ed.selected; if (!n || !this.built) return null;
    const e = this.built.byNode[n.id]; if (!e || !e.is3d || !e.obj) return null;
    if (n.type === 'gridlevel' || n.type === 'light' || n.type === 'camera3d') return new V3(n.position[0], n.position[1], n.position[2]);
    return e.obj.getWorldPosition(new V3());
  }
  /* ---------------------------------------------------------------- ratón */
  onDown(p) {
    if (!this.built) return;
    this.host.focus({ preventScroll: true });
    const ev = p.event || {};
    if (p.button === 2 || (p.button === 0 && ev.altKey)) { this.drag = { mode: 'orbit', sx: p.x, sy: p.y, yaw: this.orbit.yaw, pitch: this.orbit.pitch }; return; }
    if (p.button === 1) { this.drag = { mode: 'pan', sx: p.x, sy: p.y, t: this.orbit.target.clone() }; return; }
    if (p.button !== 0) return;
    const ed = this.app.editor, v = this.built.rt.view;
    if (this.gizmo && this.gizmo.root.visible) {
      const gh = v.raycast(p.x, p.y, { objects: this.gizmo.root, recursive: true });
      const hit = gh.find((h) => h.object.ugsAxis);
      if (hit) { this.beginGizmo(hit.object.ugsAxis, p); return; }
    }
    const e = this.pick(p.x, p.y);
    if (!e) { if (!ev.ctrlKey && !ev.shiftKey) ed.select([]); return; }
    if (ev.ctrlKey || ev.shiftKey) { ed.select(e.node.id, true); return; }
    ed.select(e.node.id);
    if (!e.is3d) this.beginHudMove(e, p); // HUD: arrastre directo
  }
  beginGizmo(axis, p) {
    const ed = this.app.editor, n = ed.selected, e = n && this.built.byNode[n.id]; if (!n || !e || !e.is3d) return;
    const v = this.built.rt.view, pv = this.pivot(), ray = v.screenToRay(p.x, p.y);
    const d = { mode: this.tool, axis, n0: JSON.parse(JSON.stringify({ position: n.position, rotation: n.rotation, scale: n.scale })), pivot: pv, sx: p.x, sy: p.y, moved: false, e };
    if (axis === 'plane') d.t0 = rayPlaneY(ray, pv.y);
    else if (axis !== 'all') d.t0 = rayAxisT(ray, pv, AXES[axis]);
    const s = v.worldToScreen(pv); d.ps = { x: s.x, y: s.y }; d.a0 = Math.atan2(p.y - s.y, p.x - s.x);
    // eje apuntando hacia la cámara o alejándose: invierte el sentido del giro en pantalla
    if (axis in AXES) { const toCam = v.camera.position.clone().sub(pv); d.flip = toCam.dot(AXES[axis]) < 0 ? -1 : 1; }
    if (e.obj.parent) { e.obj.parent.updateWorldMatrix(); d.parentInv = new UG.Mat4().invertFrom(e.obj.parent.matrixWorld); }
    this.drag = d;
  }
  beginHudMove(e, p) { const n = e.node; this.drag = { mode: 'hud', e, sx: p.x, sy: p.y, x0: n.x, y0: n.y, moved: false }; }
  onMove(p) {
    const d = this.drag; if (!d || !this.built) return;
    const ev = p.event || {}, v = this.built.rt.view, step = this.snap && !ev.altKey ? this.snapStep : 0;
    if (d.mode === 'orbit') { this.orbit.yaw = d.yaw - (p.x - d.sx) * 0.006; this.orbit.pitch = Math.max(-1.5, Math.min(1.5, d.pitch + (p.y - d.sy) * 0.006)); return; }
    if (d.mode === 'pan') {
      const k = this.orbit.dist * 0.0016, o = this.orbit, r = new V3(Math.cos(o.yaw), 0, -Math.sin(o.yaw)), u = new V3(-Math.sin(o.pitch) * Math.sin(o.yaw), Math.cos(o.pitch), -Math.sin(o.pitch) * Math.cos(o.yaw));
      o.target.copy(d.t).addScaled(r, -(p.x - d.sx) * k).addScaled(u, (p.y - d.sy) * k); return;
    }
    if (d.mode === 'hud') { const f = this.hudFit; let x = d.x0 + (p.x - d.sx) / f.s, y = d.y0 + (p.y - d.sy) / f.s; if (this.snap && !ev.altKey) { x = Math.round(x / 8) * 8; y = Math.round(y / 8) * 8; } d.e.obj.x = x; d.e.obj.y = y; d.v = { x: Math.round(x), y: Math.round(y) }; d.moved = true; return; }
    const n = this.app.editor.node(d.e.node.id); if (!n) return;
    d.moved = true;
    const ray = v.screenToRay(p.x, p.y), o = d.e.obj;
    if (d.mode === 'select') { // mover
      let delta;
      if (d.axis === 'plane') { const hitp = rayPlaneY(ray, d.pivot.y); if (!hitp || !d.t0) return; delta = hitp.clone().sub(d.t0); delta.y = 0; }
      else { const t = rayAxisT(ray, d.pivot, AXES[d.axis]); if (t === null || d.t0 === null) return; delta = AXES[d.axis].clone().scale(t - d.t0); }
      const world = d.pivot.clone().add(delta);
      if (step) { if (d.axis === 'x' || d.axis === 'plane') world.x = Math.round(world.x / step) * step; if (d.axis === 'y') world.y = Math.round(world.y / step) * step; if (d.axis === 'z' || d.axis === 'plane') world.z = Math.round(world.z / step) * step; }
      const local = d.parentInv ? world.clone().applyMat4(d.parentInv) : world;
      // gridlevel/luces: la posición del nodo es directamente el pivote
      const np = [round3(local.x), round3(local.y), round3(local.z)];
      if (d.e.node.type === 'gridlevel') o.position.set(np[0], np[1], np[2]); else if (!d.e.noTransform) o.position.set(np[0], np[1], np[2]);
      d.v = { position: np };
    } else if (d.mode === 'rotate') {
      const a = Math.atan2(p.y - d.ps.y, p.x - d.ps.x), da = (a - d.a0) / DEG * -d.flip;
      const r = d.n0.rotation.slice(), i = d.axis === 'x' ? 0 : d.axis === 'y' ? 1 : 2;
      r[i] = d.n0.rotation[i] + da; if (step || ev.shiftKey) r[i] = Math.round(r[i] / 15) * 15; r[i] = round3(((r[i] + 180) % 360 + 360) % 360 - 180);
      o.rotation.set(r[0] * DEG, r[1] * DEG, r[2] * DEG); d.v = { rotation: r };
    } else if (d.mode === 'scale') {
      const k = Math.exp((p.x - d.sx - (p.y - d.sy)) * 0.006), s = d.n0.scale.slice();
      if (d.axis === 'all') { s[0] *= k; s[1] *= k; s[2] *= k; } else { const i = d.axis === 'x' ? 0 : d.axis === 'y' ? 1 : 2; s[i] *= k; }
      for (let i = 0; i < 3; i++) { if (this.snap) s[i] = Math.round(s[i] * 20) / 20; s[i] = round3(Math.max(0.01, Math.min(1000, s[i]))); }
      o.scale.set(s[0], s[1], s[2]); d.v = { scale: s };
    }
  }
  onUp() {
    const d = this.drag; this.drag = null; if (!d || !d.moved || !d.v) return;
    this.app.editor.setTransforms([{ id: d.e.node.id, values: d.v }], d.mode === 'rotate' ? 'Rotar' : d.mode === 'scale' ? 'Escalar' : 'Mover');
  }
  /* ---------------------------------------------------------------- por fotograma */
  frame(dtMs) {
    if (!this.built || !this.built.rt.view) return;
    const dt = Math.min(0.1, (dtMs || 16) / 1000);
    this.applyCamera(dt);
    const ed = this.app.editor, v = this.built.rt.view, pv = this.pivot();
    // gizmo a tamaño constante en pantalla
    if (this.gizmo) {
      const show = !!pv && ed.selection.length === 1 && this.built.byNode[ed.selection[0]] && this.built.byNode[ed.selection[0]].is3d;
      this.gizmo.root.visible = show;
      if (show) { const dist = v.camera.position.distanceTo(pv), s = dist * 0.14; this.gizmo.root.position.copy(pv); this.gizmo.root.scale.set(s, s, s); if (this.tool === 'rotate') { const n = ed.selected; this.gizmo.root.rotation.set(0, 0, 0); void n; } }
    }
    if (this.selBox) {
      const b = this.selectionAABB();
      this.selBox.visible = !!b;
      if (b) { const c = b.getCenter(new V3()), sz = b.getSize(new V3()); this.selBox.position.copy(c); this.selBox.scale.set(Math.max(0.02, sz.x * 1.02), Math.max(0.02, sz.y * 1.02), Math.max(0.02, sz.z * 1.02)); }
    }
    // iconos siguen a sus objetos (grupos/partículas pueden estar anidados)
    for (const hp of this.helpers) if (hp.e.node.type === 'group3d' || hp.e.node.type === 'particles3d' || (hp.e.node.type === 'light' && (hp.e.node.props.light === 'point' || hp.e.node.props.light === 'spot'))) hp.e.obj.getWorldPosition(hp.icon.position);
    // HUD: marco de la pantalla del juego y selección 2D
    const o = this.overlay; o.clear();
    this.fitHud();
    const f = this.hudFit; o.lineStyle(1, 0x6d83ff, 0.5).strokeRect(f.x, f.y, f.w, f.h);
    if (this.showColliders) this.drawColliders(o, v);
    for (const id of ed.selection) { const e = this.built.byNode[id]; if (!e || e.is3d || !e.obj) continue; try { const b = e.obj.getBounds(); o.lineStyle(1.5, 0x3fd6b4, 1).strokeRect(f.x + b.x * f.s, f.y + b.y * f.s, b.width * f.s, b.height * f.s); } catch (err) { /* sin límites */ } }
    const info = document.getElementById('vp-info'); if (info && this.app.viewport === this) { const t = this.orbit.target; info.textContent = 'objetivo ' + t.x.toFixed(1) + ', ' + t.y.toFixed(1) + ', ' + t.z.toFixed(1) + '  ·  dist ' + this.orbit.dist.toFixed(1); }
  }
  /** Colisionadores 3D tal como los creará el juego: naranja estático, amarillo dinámico, azul personaje, rosa zona */
  drawColliders(g, v) {
    const ed = this.app.editor, rt = this.built.rt, sel = new Set(ed.selection);
    let seg = null;
    for (const n of ed.scene.nodes) {
      const ph = n.physics; if (!ph || ph.type === 'none') continue;
      const e = this.built.byNode[n.id]; if (!e || !e.is3d || !e.obj) continue;
      let s = null; try { s = rt.colliderShape3D(e); } catch (err) { s = null; }
      if (!s) continue;
      if (!seg) seg = RT.projector3D(v);
      const on = sel.has(n.id), exact = s.type === 'mesh';
      // malla exacta: choca con los triángulos visibles (se puede entrar en una casa); su caja solo orienta, tenue
      g.lineStyle(on ? 2 : 1, RT.COLLIDER_COLORS_3D[s.type] || 0xff9f43, exact ? (on ? 0.6 : 0.18) : (on ? 1 : 0.75));
      RT.drawShape3D(g, seg, s);
    }
  }
  applyTransforms() {
    if (!this.built) return this.rebuild();
    const ed = this.app.editor; let needRebuild = false;
    for (const n of ed.scene.nodes) {
      const e = this.built.byNode[n.id]; if (!e || !e.obj) continue;
      if (e.is3d) {
        if (n.type === 'gridlevel' || n.type === 'light' || n.type === 'camera3d') { if (JSON.stringify(e.node.position) !== JSON.stringify(n.position) || JSON.stringify(e.node.rotation) !== JSON.stringify(n.rotation)) needRebuild = true; continue; }
        e.obj.position.set(n.position[0], n.position[1], n.position[2]); e.obj.rotation.set(n.rotation[0] * DEG, n.rotation[1] * DEG, n.rotation[2] * DEG); e.obj.scale.set(n.scale[0], n.scale[1], n.scale[2]);
      } else { e.obj.x = n.x; e.obj.y = n.y; e.obj.angle = n.rotation; }
      e.node = n;
    }
    if (needRebuild) this.rebuild();
  }
  /* ---------------------------------------------------------------- DOM */
  bindDom() {
    this._dragover = (e) => { if (e.dataTransfer.types.includes('application/x-ugs-asset') || e.dataTransfer.types.includes('Files')) { e.preventDefault(); this.host.classList.add('drop'); } };
    this._dragleave = () => this.host.classList.remove('drop');
    this._drop = (e) => {
      this.host.classList.remove('drop'); if (!this.built) return;
      const r = this.host.getBoundingClientRect(), at = this.groundPoint(e.clientX - r.left, e.clientY - r.top);
      const id = e.dataTransfer.getData('application/x-ugs-asset');
      if (id) { e.preventDefault(); const a = this.app.editor.assetById(id); if (a) this.app.placeAsset(a, { position: at }); }
      else if (e.dataTransfer.files.length) { e.preventDefault(); this.app.importList(Array.from(e.dataTransfer.files), { position: at }); }
    };
    this._ctx = (e) => e.preventDefault();
    this._kd = (e) => { const k = e.key.toLowerCase(); if (this.drag && this.drag.mode === 'orbit' && 'wasdqe'.includes(k)) { e.preventDefault(); e.stopPropagation(); } this.keys.add(k === 'shift' ? 'shift' : k); };
    this._ku = (e) => { const k = e.key.toLowerCase(); this.keys.delete(k === 'shift' ? 'shift' : k); };
    this._blur = () => this.keys.clear();
    this.host.addEventListener('dragover', this._dragover); this.host.addEventListener('dragleave', this._dragleave); this.host.addEventListener('drop', this._drop); this.host.addEventListener('contextmenu', this._ctx);
    this.host.addEventListener('keydown', this._kd, true); this.host.addEventListener('keyup', this._ku, true); window.addEventListener('blur', this._blur);
  }
  unbindDom() {
    if (!this._drop) return;
    this.host.removeEventListener('dragover', this._dragover); this.host.removeEventListener('dragleave', this._dragleave); this.host.removeEventListener('drop', this._drop); this.host.removeEventListener('contextmenu', this._ctx);
    this.host.removeEventListener('keydown', this._kd, true); this.host.removeEventListener('keyup', this._ku, true); window.removeEventListener('blur', this._blur);
  }
  /** Punto del suelo (o del objeto) bajo el cursor, para colocar objetos nuevos */
  groundPoint(sx, sy) {
    const v = this.built.rt.view, hits = v.raycast(sx, sy, { filter: (m) => !m.ugsEditor && !m.ugsAxis });
    let p = hits.length ? hits[0].point : rayPlaneY(v.screenToRay(sx, sy), 0);
    if (!p) p = this.orbit.target.clone();
    const st = this.snap ? this.snapStep : 0;
    const r = (x) => (st ? Math.round(x / st) * st : Math.round(x * 100) / 100);
    return [r(p.x), Math.round(p.y * 100) / 100, r(p.z)];
  }
  centerPoint() { const t = this.orbit.target; return [Math.round(t.x * 10) / 10, Math.max(0, Math.round(t.y * 10) / 10), Math.round(t.z * 10) / 10]; }
  nudge(dx, dy, big) {
    const ed = this.app.editor, n = ed.selected; if (!n || !n.position) return;
    const s = (big ? 1 : 0.1) * (this.snapStep || 0.5) / 0.5, yaw = this.orbit.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const p = n.position.slice(); p[0] = round3(p[0] + (rx * dx - fx * dy) * s); p[2] = round3(p[2] + (rz * dx - fz * dy) * s);
    ed.setTransforms([{ id: n.id, values: { position: p } }], 'Mover');
  }
}
function round3(v) { return Math.round(v * 1000) / 1000; }
/** Parámetro t del punto del eje (pivote + A·t) más cercano al rayo */
function rayAxisT(ray, P0, A) {
  const O = ray.origin, D = ray.direction, w0 = new V3(P0.x - O.x, P0.y - O.y, P0.z - O.z);
  const b = A.dot(D), d = A.dot(w0), e = D.dot(w0), den = 1 - b * b;
  if (Math.abs(den) < 1e-4) return null;
  return (b * e - d) / den;
}
function rayPlaneY(ray, y) {
  const O = ray.origin, D = ray.direction; if (Math.abs(D.y) < 1e-5) return null;
  const t = (y - O.y) / D.y; if (t < 0) return null;
  return new V3(O.x + D.x * t, y, O.z + D.z * t);
}
