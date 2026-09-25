/* UltraGame Studio · gestos táctiles en las vistas de edición (móviles y tabletas):
 *  2D: un dedo selecciona y mueve · dos dedos: arrastrar = desplazar, pellizcar = zoom
 *  3D: un dedo selecciona y mueve con el gizmo · dos dedos: arrastrar = orbitar, pellizcar = acercar · tres dedos = desplazar
 * Mientras hay dos o más dedos, los eventos no llegan al motor (así no se mueve un objeto por accidente). */

export function attachTouch(vp) {
  const host = vp.host, pts = new Map();
  let g = null;
  const centroid = () => { let x = 0, y = 0; pts.forEach((p) => { x += p.x; y += p.y; }); return { x: x / pts.size, y: y / pts.size }; };
  const spread = () => { const a = Array.from(pts.values()); if (a.length < 2) return 1; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1; };
  const local = (e) => { const r = host.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const begin = () => {
    // cancela lo que empezó el primer dedo (mover un objeto, rectángulo de selección) y vuelve a lo guardado
    if (vp.drag) { vp.drag = null; if (vp.applyTransforms) vp.applyTransforms(); if (vp.drawOverlay) vp.drawOverlay(); }
    const c = centroid(); g = { cx: c.x, cy: c.y, d: spread(), n: pts.size };
  };
  const down = (e) => {
    if (e.pointerType !== 'touch') return;
    pts.set(e.pointerId, local(e));
    if (pts.size >= 2) { begin(); e.stopPropagation(); e.preventDefault(); }
  };
  const move = (e) => {
    if (e.pointerType !== 'touch' || !pts.has(e.pointerId)) return;
    pts.set(e.pointerId, local(e));
    if (!g || pts.size < 2) return;
    e.stopPropagation(); e.preventDefault();
    if (pts.size !== g.n) { begin(); return; }
    const c = centroid(), d = spread(), dx = c.x - g.cx, dy = c.y - g.cy, k = d / g.d;
    if (vp.kind === '2d') {
      const cam = vp.cam, before = vp.toWorld(c.x, c.y);
      cam.zoom = Math.max(0.03, Math.min(16, cam.zoom * k));
      vp.applyCam();
      const after = vp.toWorld(c.x, c.y);
      cam.x += before.x - after.x - dx / cam.zoom; cam.y += before.y - after.y - dy / cam.zoom;
      vp.applyCam();
    } else if (vp.orbit) {
      const o = vp.orbit;
      if (pts.size >= 3 && vp.panBy) vp.panBy(dx, dy);
      else { o.yaw -= dx * 0.008; o.pitch = Math.max(-1.45, Math.min(1.45, o.pitch + dy * 0.006)); }
      o.dist = Math.max(0.5, Math.min(2000, o.dist / k));
    }
    g.cx = c.x; g.cy = c.y; g.d = d;
  };
  const up = (e) => {
    if (e.pointerType !== 'touch') return;
    const had = !!g; pts.delete(e.pointerId);
    if (pts.size < 2) g = null; else begin();
    if (had) { e.stopPropagation(); e.preventDefault(); }
  };
  host.addEventListener('pointerdown', down, true);
  host.addEventListener('pointermove', move, true);
  host.addEventListener('pointerup', up, true);
  host.addEventListener('pointercancel', up, true);
  host.style.touchAction = 'none';
  return () => {
    host.removeEventListener('pointerdown', down, true); host.removeEventListener('pointermove', move, true);
    host.removeEventListener('pointerup', up, true); host.removeEventListener('pointercancel', up, true);
  };
}
