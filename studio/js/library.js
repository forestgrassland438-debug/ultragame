/* UltraGame Studio · biblioteca integrada: sprites 2D generados con Canvas (sin descargas) y los modelos GLB
 * que trae el motor (assets3d/, hechos con tools/make-models.js). Todo se copia al proyecto al añadirlo. */

function cv(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h); return c; }
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function lg(g, y0, y1, stops) { const gr = g.createLinearGradient(0, y0, 0, y1); stops.forEach((s, i) => gr.addColorStop(i / (stops.length - 1), s)); return gr; }
function rnd(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; }; }

/** Personaje de plataformas: frame 0..3 = ciclo de andar */
function hero(g, ox, f) {
  const leg = [0, 5, 0, -5][f], arm = [0, -4, 0, 4][f], bob = f % 2 ? -1 : 0;
  g.save(); g.translate(ox, bob);
  g.fillStyle = '#26324f'; rr(g, 14 + leg * 0.4, 44, 8, 18, 3); g.fill(); rr(g, 26 - leg * 0.4, 44, 8, 18, 3); g.fill();
  g.fillStyle = '#2f6fd0'; rr(g, 11, 26, 26, 22, 7); g.fill();
  g.fillStyle = '#f1c27d'; rr(g, 6, 28 + arm, 7, 14, 3); g.fill(); rr(g, 35, 28 - arm, 7, 14, 3); g.fill();
  g.fillStyle = '#f1c27d'; g.beginPath(); g.arc(24, 16, 12, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#3b2a1a'; g.beginPath(); g.arc(24, 12, 12, Math.PI, 0); g.fill(); g.fillRect(12, 10, 5, 7);
  g.fillStyle = '#1a1a1a'; g.fillRect(26, 14, 3, 5); g.fillRect(32, 14, 3, 5);
  g.fillStyle = '#e03131'; rr(g, 11, 26, 26, 5, 2); g.fill();
  g.restore();
}
export const LIB_2D = {
  hero: { label: 'Héroe', w: 48, h: 64, draw: (g) => hero(g, 0, 0) },
  'hero-sheet': { label: 'Héroe (andar, 4 fotogramas)', w: 192, h: 64, frameWidth: 48, frameHeight: 64, draw: (g) => { for (let f = 0; f < 4; f++) hero(g, f * 48, f); } },
  enemy: { label: 'Slime (enemigo)', w: 48, h: 40, draw: (g) => {
    g.fillStyle = '#e03131'; g.beginPath(); g.moveTo(4, 38); g.quadraticCurveTo(0, 6, 24, 4); g.quadraticCurveTo(48, 6, 44, 38); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(16, 14, 6, 4, -0.5, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(17, 22, 5, 0, 7); g.arc(31, 22, 5, 0, 7); g.fill(); g.fillStyle = '#111'; g.beginPath(); g.arc(18, 23, 2.4, 0, 7); g.arc(30, 23, 2.4, 0, 7); g.fill(); } },
  coin: { label: 'Moneda', w: 32, h: 32, draw: (g) => { g.fillStyle = '#e8a300'; g.beginPath(); g.arc(16, 16, 15, 0, 7); g.fill(); g.fillStyle = '#ffd43b'; g.beginPath(); g.arc(16, 16, 12, 0, 7); g.fill(); g.fillStyle = '#e8a300'; g.fillRect(14, 8, 4, 16); g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.arc(11, 11, 3, 0, 7); g.fill(); } },
  gem: { label: 'Gema', w: 32, h: 32, draw: (g) => { g.fillStyle = '#4dabf7'; g.beginPath(); g.moveTo(16, 2); g.lineTo(30, 12); g.lineTo(16, 30); g.lineTo(2, 12); g.closePath(); g.fill(); g.fillStyle = '#a5d8ff'; g.beginPath(); g.moveTo(16, 2); g.lineTo(22, 12); g.lineTo(10, 12); g.closePath(); g.fill(); g.fillStyle = '#1971c2'; g.beginPath(); g.moveTo(16, 30); g.lineTo(22, 12); g.lineTo(30, 12); g.closePath(); g.fill(); } },
  heart: { label: 'Corazón', w: 32, h: 32, draw: (g) => { g.fillStyle = '#fa5252'; g.beginPath(); g.moveTo(16, 29); g.bezierCurveTo(-6, 14, 6, -4, 16, 8); g.bezierCurveTo(26, -4, 38, 14, 16, 29); g.fill(); g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(10, 11, 3, 0, 7); g.fill(); } },
  star: { label: 'Estrella', w: 48, h: 48, draw: (g) => { g.fillStyle = '#ffd43b'; g.strokeStyle = '#e8a300'; g.lineWidth = 3; g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 9 : 21; g.lineTo(24 + Math.cos(a) * r, 25 + Math.sin(a) * r); } g.closePath(); g.fill(); g.stroke(); } },
  platform: { label: 'Suelo con hierba (mosaico)', w: 64, h: 64, draw: (g) => {
    g.fillStyle = '#8b5a2b'; g.fillRect(0, 0, 64, 64); const r = rnd(7); g.fillStyle = '#6f4520'; for (let i = 0; i < 26; i++) g.fillRect(Math.floor(r() * 60), 14 + Math.floor(r() * 48), 4, 3);
    g.fillStyle = '#51cf66'; g.fillRect(0, 0, 64, 12); g.fillStyle = '#2f9e44'; for (let x = 0; x < 64; x += 8) { g.beginPath(); g.moveTo(x, 12); g.lineTo(x + 4, 17); g.lineTo(x + 8, 12); g.fill(); } g.fillStyle = '#8ce99a'; g.fillRect(0, 0, 64, 3); } },
  brick: { label: 'Ladrillo (mosaico)', w: 64, h: 64, draw: (g) => { g.fillStyle = '#5c3a2e'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#b5543c'; for (let y = 0; y < 4; y++) for (let x = -1; x < 3; x++) g.fillRect(x * 32 + (y % 2) * 16 + 2, y * 16 + 2, 28, 12); } },
  crate2d: { label: 'Caja', w: 64, h: 64, draw: (g) => { g.fillStyle = '#b07a3c'; g.fillRect(0, 0, 64, 64); g.strokeStyle = '#6e4a22'; g.lineWidth = 6; g.strokeRect(3, 3, 58, 58); g.beginPath(); g.moveTo(6, 6); g.lineTo(58, 58); g.moveTo(58, 6); g.lineTo(6, 58); g.stroke(); } },
  spikes: { label: 'Pinchos', w: 64, h: 32, draw: (g) => { g.fillStyle = '#adb5bd'; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(i * 16, 32); g.lineTo(i * 16 + 8, 2); g.lineTo(i * 16 + 16, 32); g.fill(); } g.fillStyle = '#e9ecef'; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(i * 16 + 8, 2); g.lineTo(i * 16 + 10, 32); g.lineTo(i * 16 + 6, 32); g.fill(); } } },
  door: { label: 'Puerta (meta)', w: 48, h: 72, draw: (g) => { g.fillStyle = '#5f3dc4'; rr(g, 2, 2, 44, 70, 18); g.fill(); g.fillStyle = '#9775fa'; rr(g, 8, 8, 32, 64, 14); g.fill(); g.fillStyle = '#ffd43b'; g.beginPath(); g.arc(34, 42, 3, 0, 7); g.fill(); } },
  ship: { label: 'Nave (mira a la derecha)', w: 64, h: 48, draw: (g) => {
    g.fillStyle = '#495057'; g.beginPath(); g.moveTo(10, 4); g.lineTo(30, 20); g.lineTo(10, 20); g.fill(); g.beginPath(); g.moveTo(10, 44); g.lineTo(30, 28); g.lineTo(10, 28); g.fill();
    g.fillStyle = '#dee2e6'; g.beginPath(); g.moveTo(62, 24); g.lineTo(14, 12); g.lineTo(6, 24); g.lineTo(14, 36); g.closePath(); g.fill();
    g.fillStyle = '#4dabf7'; g.beginPath(); g.ellipse(38, 24, 9, 5, 0, 0, 7); g.fill(); g.fillStyle = '#ff922b'; g.beginPath(); g.moveTo(6, 19); g.lineTo(0, 24); g.lineTo(6, 29); g.fill(); } },
  asteroid: { label: 'Asteroide', w: 64, h: 64, draw: (g) => { const r = rnd(11); g.fillStyle = '#868e96'; g.beginPath(); for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, d = 24 + r() * 7; g.lineTo(32 + Math.cos(a) * d, 32 + Math.sin(a) * d); } g.closePath(); g.fill(); g.fillStyle = '#5c636a'; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(18 + r() * 28, 18 + r() * 28, 3 + r() * 5, 0, 7); g.fill(); } } },
  bullet: { label: 'Disparo', w: 20, h: 8, draw: (g) => { const gr = g.createLinearGradient(0, 0, 20, 0); gr.addColorStop(0, 'rgba(255,212,59,0)'); gr.addColorStop(1, '#fff3bf'); g.fillStyle = gr; rr(g, 0, 1, 20, 6, 3); g.fill(); } },
  cloud: { label: 'Nube', w: 128, h: 64, draw: (g) => { g.fillStyle = '#ffffff'; [[34, 40, 22], [58, 30, 28], [86, 38, 22], [104, 44, 16], [20, 48, 14]].forEach((c) => { g.beginPath(); g.arc(c[0], c[1], c[2], 0, 7); g.fill(); }); g.fillRect(20, 44, 90, 16); } },
  tree2d: { label: 'Árbol', w: 64, h: 96, draw: (g) => { g.fillStyle = '#6f4520'; g.fillRect(27, 58, 10, 36); g.fillStyle = '#2f9e44'; [[32, 30, 26], [18, 46, 16], [46, 46, 16]].forEach((c) => { g.beginPath(); g.arc(c[0], c[1], c[2], 0, 7); g.fill(); }); g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.arc(24, 22, 9, 0, 7); g.fill(); } },
  'bg-sky': { label: 'Fondo: cielo con colinas', w: 512, h: 256, draw: (g, w, h) => {
    g.fillStyle = lg(g, 0, h, ['#4dabf7', '#a5d8ff', '#e7f5ff']); g.fillRect(0, 0, w, h);
    g.fillStyle = '#b2f2bb'; g.beginPath(); g.moveTo(0, h); for (let x = 0; x <= w; x += 8) g.lineTo(x, h * 0.7 + Math.sin(x / w * Math.PI * 4) * 18); g.lineTo(w, h); g.fill();
    g.fillStyle = '#8ce99a'; g.beginPath(); g.moveTo(0, h); for (let x = 0; x <= w; x += 8) g.lineTo(x, h * 0.82 + Math.sin(x / w * Math.PI * 6 + 1) * 12); g.lineTo(w, h); g.fill(); } },
  'bg-space': { label: 'Fondo: espacio (mosaico)', w: 512, h: 512, draw: (g, w, h) => {
    g.fillStyle = '#060818'; g.fillRect(0, 0, w, h); const r = rnd(3);
    for (let i = 0; i < 260; i++) { const s = r() < 0.9 ? 1 : 2; g.fillStyle = 'rgba(255,255,255,' + (0.3 + r() * 0.7).toFixed(2) + ')'; g.fillRect(Math.floor(r() * w), Math.floor(r() * h), s, s); }
    const neb = g.createRadialGradient(w * 0.3, h * 0.4, 0, w * 0.3, h * 0.4, w * 0.35); neb.addColorStop(0, 'rgba(132,94,247,0.25)'); neb.addColorStop(1, 'rgba(132,94,247,0)'); g.fillStyle = neb; g.fillRect(0, 0, w, h); } }
};
/** Modelos 3D del motor (assets3d/*.glb) */
export const LIB_3D = {
  humanoid: { label: 'Personaje (animado)', icon: '🧍' }, hero: { label: 'Héroe cartoon (animado)', icon: '🦸' }, robot: { label: 'Robot (animado)', icon: '🤖' },
  car: { label: 'Coche', icon: '🚗' }, police: { label: 'Policía', icon: '🚓' }, taxi: { label: 'Taxi', icon: '🚕' }, kart: { label: 'Kart', icon: '🏎️' },
  house: { label: 'Casa (se puede entrar)', icon: '🏠' }, shop: { label: 'Tienda', icon: '🏪' }, tree: { label: 'Árbol', icon: '🌳' }, pine: { label: 'Pino', icon: '🌲' },
  bush: { label: 'Arbusto', icon: '🌿' }, rock: { label: 'Roca', icon: '🪨' }, crate: { label: 'Caja de madera', icon: '📦' }, barrel: { label: 'Barril', icon: '🛢️' },
  fence: { label: 'Valla', icon: '🚧' }, lamp: { label: 'Farola', icon: '💡' }, flag: { label: 'Bandera (animada)', icon: '🚩' },
  coin: { label: 'Moneda (gira)', icon: '🪙' }, fruit: { label: 'Fruta (gira)', icon: '🍎' }, rifle: { label: 'Rifle', icon: '🔫' }, pistol: { label: 'Pistola', icon: '🔫' }
};
export function libThumb(key) { const L = LIB_2D[key]; if (!L) return null; return cv(L.w, L.h, L.draw); }
/** Blob del recurso de biblioteca (PNG generado o GLB del motor) */
export async function libBlob(kind, key) {
  if (kind === '2d') {
    const L = LIB_2D[key]; if (!L) throw new Error('No existe ' + key);
    const c = cv(L.w, L.h, L.draw);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo generar la imagen'))), 'image/png'));
  }
  if (!LIB_3D[key]) throw new Error('No existe ' + key);
  const r = await fetch('../assets3d/' + key + '.glb');
  if (!r.ok) throw new Error('No se encontró el modelo ' + key);
  return r.blob();
}
/** Añade (una sola vez) un recurso de biblioteca al proyecto y devuelve el asset */
export async function addLibraryAsset(editor, kind, key) {
  const file = 'assets/' + key + (kind === '2d' ? '.png' : '.glb');
  const existing = editor.project.assets.find((a) => a.file === file);
  if (existing) return existing;
  const L = kind === '2d' ? LIB_2D[key] : LIB_3D[key];
  const blob = await libBlob(kind, key);
  return editor.importFile(blob, key + (kind === '2d' ? '.png' : '.glb'), { displayName: L.label, frameWidth: L.frameWidth || 0, frameHeight: L.frameHeight || 0 });
}
