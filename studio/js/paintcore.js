/* UltraGame Studio · núcleo del editor de imágenes y pixel art (sin dependencias):
 * documento con capas (opacidad, modos de fusión, bloqueo), fotogramas de animación, historial con límite de memoria,
 * selecciones como máscara, relleno por inundación, filtros y ajustes sobre ImageData, paletas clásicas y un
 * codificador GIF animado (LZW) para exportar animaciones de pixel art. */

export const BLENDS = [['source-over', 'Normal'], ['multiply', 'Multiplicar'], ['screen', 'Trama'], ['overlay', 'Superponer'], ['darken', 'Oscurecer'], ['lighten', 'Aclarar'],
  ['color-dodge', 'Sobreexponer color'], ['color-burn', 'Subexponer color'], ['hard-light', 'Luz fuerte'], ['soft-light', 'Luz suave'], ['difference', 'Diferencia'], ['exclusion', 'Exclusión'],
  ['hue', 'Tono'], ['saturation', 'Saturación'], ['color', 'Color'], ['luminosity', 'Luminosidad'], ['lighter', 'Suma (aditiva)']];

export const PALETTES = {
  pico8: { label: 'PICO-8', colors: '000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa' },
  db16: { label: 'DawnBringer 16', colors: '140c1c 442434 30346d 4e4a4e 854c30 346524 d04648 757161 597dce d27d2c 8595a1 6daa2c d2aa99 6dc2ca dad45e deeed6' },
  db32: { label: 'DawnBringer 32', colors: '000000 222034 45283c 663931 8f563b df7126 d9a066 eec39a fbf236 99e550 6abe30 37946e 4b692f 524b24 323c39 3f3f74 306082 5b6ee1 639bff 5fcde4 cbdbfc ffffff 9badb7 847e87 696a6a 595652 76428a ac3232 d95763 d77bba 8f974a 8a6f30' },
  sweetie16: { label: 'Sweetie 16', colors: '1a1c2c 5d275d b13e53 ef7d57 ffcd75 a7f070 38b764 257179 29366f 3b5dc9 41a6f6 73eff7 f4f4f4 94b0c2 566c86 333c57' },
  endesga32: { label: 'Endesga 32', colors: 'be4a2f d77643 ead4aa e4a672 b86f50 733e39 3e2731 a22633 e43b44 f77622 feae34 fee761 63c74d 3e8948 265c42 193c3e 124e89 0099db 2ce8f5 ffffff c0cbdc 8b9bb4 5a6988 3a4466 262b44 181425 ff0044 68386c b55088 f6757a e8b796 c28569' },
  gameboy: { label: 'Game Boy', colors: '0f380f 306230 8bac0f 9bbc0f' },
  cga: { label: 'CGA', colors: '000000 0000aa 00aa00 00aaaa aa0000 aa00aa aa5500 aaaaaa 555555 5555ff 55ff55 55ffff ff5555 ff55ff ffff55 ffffff' },
  gray8: { label: 'Grises 8', colors: '000000 242424 494949 6d6d6d 929292 b6b6b6 dbdbdb ffffff' },
  web: { label: 'Básica', colors: '000000 ffffff ff0000 00ff00 0000ff ffff00 00ffff ff00ff 808080 c0c0c0 800000 008000 000080 808000 008080 800080 ff8000 8000ff 0080ff ff0080' }
};
Object.keys(PALETTES).forEach((k) => { PALETTES[k].list = PALETTES[k].colors.split(' ').map((c) => '#' + c); });

/* ---------------------------------------------------------------- color */
export function hexToRgb(hx) { const v = parseInt(String(hx).replace('#', ''), 16) || 0; return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
export function rgbToHex(r, g, b) { return '#' + [r, g, b].map((x) => ('0' + Math.max(0, Math.min(255, Math.round(x))).toString(16)).slice(-2)).join(''); }
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
  return [h, s, l];
}
export function hslToRgb(h, s, l) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t % 1 + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
/**
 * Lee una paleta de texto: .hex (Lospec), .gpl (GIMP/Aseprite/Inkscape), .pal (JASC, Paint Shop Pro), .txt (Paint.NET,
 * AARRGGBB) o cualquier texto con colores #rgb / #rrggbb. Devuelve hasta 256 colores '#rrggbb' sin repetir.
 */
export function parsePalette(text) {
  const out = [], seen = new Set(), add = (r, g, b) => { if (out.length >= 256) return; const c = rgbToHex(r, g, b); if (!seen.has(c)) { seen.add(c); out.push(c); } };
  const src = String(text || '').replace(/^﻿/, '').slice(0, 200000), lines = src.split(/\r?\n/);
  const head = (lines[0] || '').trim();
  if (/^GIMP Palette/i.test(head)) {
    // GIMP: «R G B nombre» tras la cabecera (Name:, Columns:, comentarios #)
    lines.slice(1).forEach((l) => { const m = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(\s|$)/.exec(l); if (m) add(+m[1], +m[2], +m[3]); });
    return out;
  }
  if (/^JASC-PAL/i.test(head)) {
    lines.slice(3).forEach((l) => { const m = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*$/.exec(l); if (m) add(+m[1], +m[2], +m[3]); });
    return out;
  }
  lines.forEach((raw) => {
    const l = raw.trim(); if (!l || l[0] === ';') return; // Paint.NET: líneas de comentario con ;
    let m = /^([0-9a-f]{2})([0-9a-f]{6})$/i.exec(l); // AARRGGBB (Paint.NET)
    if (m) { const v = parseInt(m[2], 16); add((v >> 16) & 255, (v >> 8) & 255, v & 255); return; }
    m = /^#?([0-9a-f]{6})$/i.exec(l); // RRGGBB (Lospec .hex)
    if (m) { const v = parseInt(m[1], 16); add((v >> 16) & 255, (v >> 8) & 255, v & 255); return; }
    const re = /#([0-9a-f]{6}|[0-9a-f]{3})\b/gi; let t; // texto libre (CSS, listas…)
    while ((t = re.exec(l))) { let hx = t[1]; if (hx.length === 3) hx = hx.split('').map((c) => c + c).join(''); const v = parseInt(hx, 16); add((v >> 16) & 255, (v >> 8) & 255, v & 255); }
  });
  return out;
}
/** Colores distintos de una imagen (píxeles opacos, en orden de aparición), hasta max */
export function imageColors(imgData, max) {
  const d = imgData.data, out = [], seen = new Set(), lim = Math.max(1, Math.min(256, max || 256));
  for (let i = 0; i < d.length && out.length < lim; i += 4) { if (d[i + 3] < 128) continue; const c = rgbToHex(d[i], d[i + 1], d[i + 2]); if (!seen.has(c)) { seen.add(c); out.push(c); } }
  return out;
}
/**
 * Rampa de n colores (pixel art). mode: 'rgb' o 'hsl' = de a hasta b; 'shades' = de sombra a luz del color a, con las
 * sombras hacia el azul y las luces hacia el amarillo (shift = grados de giro del tono en los extremos).
 */
export function colorRamp(a, b, n, mode, shift) {
  n = Math.max(2, Math.min(32, n | 0)); const out = [], A = hexToRgb(a), B = hexToRgb(b);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    if (mode === 'rgb') { out.push(rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t)); continue; }
    if (mode === 'hsl') {
      const [h0, s0, l0] = rgbToHsl(A[0], A[1], A[2]), [h1, s1, l1] = rgbToHsl(B[0], B[1], B[2]);
      let dh = h1 - h0; if (dh > 0.5) dh -= 1; if (dh < -0.5) dh += 1; // por el camino corto del círculo de tonos
      const hh = s0 < 0.02 ? h1 : s1 < 0.02 ? h0 : h0 + dh * t; // un gris no tiene tono: se usa el del otro color
      out.push(rgbToHex(...hslToRgb(((hh % 1) + 1) % 1, s0 + (s1 - s0) * t, l0 + (l1 - l0) * t)));
      continue;
    }
    const [h, s] = rgbToHsl(A[0], A[1], A[2]), k = t * 2 - 1, sh = Math.max(0, Math.min(180, shift === undefined ? 20 : shift)) / 360;
    const target = k < 0 ? 0.66 : 0.16; let d = target - h; if (d > 0.5) d -= 1; if (d < -0.5) d += 1;
    const hh = s < 0.02 ? h : h + Math.sign(d) * Math.min(Math.abs(d), sh * Math.abs(k));
    const S = Math.max(0, Math.min(1, s * (1 - 0.2 * Math.abs(k)) + (k < 0 ? 0.06 * -k : 0)));
    out.push(rgbToHex(...hslToRgb(((hh % 1) + 1) % 1, S, 0.1 + t * 0.8)));
  }
  return out;
}
/**
 * Amplía pixel art con Scale2x / Scale3x (EPX, AdvMAME): suaviza las diagonales y las curvas sin mezclar colores (cada
 * píxel nuevo es uno de los originales). factor 2, 3 o 4 (= Scale2x dos veces). src y el resultado: ImageData.
 */
export function scalePixels(src, factor) {
  if (factor === 4) return scalePixels(scalePixels(src, 2), 2);
  const n = factor === 3 ? 3 : 2, w = src.width, h = src.height, W = w * n, H = h * n;
  const S = new Uint32Array(src.data.buffer.slice(src.data.byteOffset, src.data.byteOffset + w * h * 4)), out = new ImageData(W, H), D = new Uint32Array(out.data.buffer);
  const at = (x, y) => S[(y < 0 ? 0 : y >= h ? h - 1 : y) * w + (x < 0 ? 0 : x >= w ? w - 1 : x)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const A = at(x - 1, y - 1), B = at(x, y - 1), C = at(x + 1, y - 1), Dd = at(x - 1, y), E = at(x, y), F = at(x + 1, y), G = at(x - 1, y + 1), Hh = at(x, y + 1), I = at(x + 1, y + 1);
    const o = y * n * W + x * n;
    if (n === 2) {
      let e0 = E, e1 = E, e2 = E, e3 = E;
      if (B !== Hh && Dd !== F) { e0 = Dd === B ? Dd : E; e1 = B === F ? F : E; e2 = Dd === Hh ? Dd : E; e3 = Hh === F ? F : E; }
      D[o] = e0; D[o + 1] = e1; D[o + W] = e2; D[o + W + 1] = e3;
    } else {
      let e = [E, E, E, E, E, E, E, E, E];
      if (B !== Hh && Dd !== F) {
        e = [Dd === B ? Dd : E, (Dd === B && E !== C) || (B === F && E !== A) ? B : E, B === F ? F : E,
          (Dd === B && E !== G) || (Dd === Hh && E !== A) ? Dd : E, E, (B === F && E !== I) || (Hh === F && E !== C) ? F : E,
          Dd === Hh ? Dd : E, (Dd === Hh && E !== I) || (Hh === F && E !== G) ? Hh : E, Hh === F ? F : E];
      }
      for (let j = 0; j < 3; j++) { D[o + j * W] = e[j * 3]; D[o + j * W + 1] = e[j * 3 + 1]; D[o + j * W + 2] = e[j * 3 + 2]; }
    }
  }
  return out;
}
export function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; }
export function ctx2d(c) { return c.getContext('2d', { willReadFrequently: true }); }

/* ---------------------------------------------------------------- documento */
let LID = 0;
export class PaintDoc {
  constructor(w, h, o) {
    o = o || {};
    this.w = Math.max(1, Math.min(8192, w | 0)); this.h = Math.max(1, Math.min(8192, h | 0));
    this.mode = o.mode === 'pixel' ? 'pixel' : 'photo';
    this.layers = []; this.frames = [{ cels: [], duration: 100 }]; this.frame = 0; this.layer = 0;
    this.selection = null; // canvas máscara (blanco = seleccionado)
    this.undo = []; this.redo = []; this.bytes = 0; this.maxBytes = 320 * 1048576; this.maxSteps = 80;
    this.name = o.name || 'imagen'; this.assetId = o.assetId || null; this.dirty = false; this.fps = 10;
    this.addLayer(o.background === false ? 'Capa 1' : 'Fondo', o.background === undefined ? null : o.background);
  }
  get cel() { return this.frames[this.frame].cels[this.layer]; }
  celOf(f, l) { return this.frames[f].cels[l]; }
  get curLayer() { return this.layers[this.layer]; }
  addLayer(name, fill, at) {
    const L = { id: ++LID, name: name || 'Capa ' + (this.layers.length + 1), visible: true, opacity: 1, blend: 'source-over', locked: false, alphaLock: false };
    const idx = at === undefined ? this.layers.length : at;
    this.layers.splice(idx, 0, L);
    this.frames.forEach((fr) => { const c = makeCanvas(this.w, this.h); if (fill) { const g = ctx2d(c); g.fillStyle = fill; g.fillRect(0, 0, this.w, this.h); } fr.cels.splice(idx, 0, c); });
    this.layer = idx;
    return L;
  }
  removeLayer(i) { if (this.layers.length <= 1) return false; this.layers.splice(i, 1); this.frames.forEach((fr) => fr.cels.splice(i, 1)); this.layer = Math.max(0, Math.min(this.layers.length - 1, this.layer >= i ? this.layer - 1 : this.layer)); return true; }
  duplicateLayer(i) {
    const src = this.layers[i], L = Object.assign({}, src, { id: ++LID, name: src.name + ' copia' });
    this.layers.splice(i + 1, 0, L);
    this.frames.forEach((fr) => { const c = makeCanvas(this.w, this.h); ctx2d(c).drawImage(fr.cels[i], 0, 0); fr.cels.splice(i + 1, 0, c); });
    this.layer = i + 1;
  }
  moveLayer(i, d) { const j = i + d; if (j < 0 || j >= this.layers.length) return false; [this.layers[i], this.layers[j]] = [this.layers[j], this.layers[i]]; this.frames.forEach((fr) => { [fr.cels[i], fr.cels[j]] = [fr.cels[j], fr.cels[i]]; }); this.layer = j; return true; }
  mergeDown(i) {
    if (i <= 0) return false;
    const L = this.layers[i];
    this.frames.forEach((fr) => { const g = ctx2d(fr.cels[i - 1]); g.save(); g.globalAlpha = L.opacity; g.globalCompositeOperation = L.blend; if (L.visible) g.drawImage(fr.cels[i], 0, 0); g.restore(); });
    this.layers.splice(i, 1); this.frames.forEach((fr) => fr.cels.splice(i, 1)); this.layer = i - 1;
    return true;
  }
  flatten() {
    this.frames.forEach((fr) => { const c = this.composite(fr, false); fr.cels = [c]; });
    this.layers = [{ id: ++LID, name: 'Fondo', visible: true, opacity: 1, blend: 'source-over', locked: false, alphaLock: false }]; this.layer = 0;
  }
  addFrame(dup, at) {
    const src = this.frames[this.frame], idx = at === undefined ? this.frame + 1 : at;
    const fr = { cels: this.layers.map((_, i) => { const c = makeCanvas(this.w, this.h); if (dup) ctx2d(c).drawImage(src.cels[i], 0, 0); return c; }), duration: src.duration };
    this.frames.splice(idx, 0, fr); this.frame = idx;
  }
  removeFrame(i) { if (this.frames.length <= 1) return false; this.frames.splice(i, 1); this.frame = Math.max(0, Math.min(this.frames.length - 1, this.frame >= i ? this.frame - 1 : this.frame)); return true; }
  moveFrame(i, d) { const j = i + d; if (j < 0 || j >= this.frames.length) return false; [this.frames[i], this.frames[j]] = [this.frames[j], this.frames[i]]; this.frame = j; return true; }
  /** Imagen compuesta de un fotograma (capas visibles con opacidad y fusión) */
  composite(fr, onlyVisible, out) {
    fr = fr || this.frames[this.frame];
    const c = out || makeCanvas(this.w, this.h), g = ctx2d(c);
    if (out) g.clearRect(0, 0, c.width, c.height);
    this.layers.forEach((L, i) => { if (onlyVisible !== false && !L.visible) return; g.globalAlpha = L.opacity; g.globalCompositeOperation = L.blend; g.drawImage(fr.cels[i], 0, 0); });
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    return c;
  }
  /* ---------------------------------------------------------------- historial */
  _size(e) { return e.kind === 'cel' ? e.data.data.length : e.cels.reduce((n, x) => n + x.data.length, 0); }
  /** Guarda el estado de un cel (antes de pintar) */
  pushCel(label, f, l) {
    f = f === undefined ? this.frame : f; l = l === undefined ? this.layer : l;
    const c = this.celOf(f, l), e = { kind: 'cel', label, f, l, data: ctx2d(c).getImageData(0, 0, this.w, this.h), layerId: this.layers[l].id };
    this._push(e);
  }
  /** Guarda todo el documento (antes de cambios de estructura: capas, fotogramas, tamaño) */
  pushDoc(label) { this._push(this.snapshot(label)); }
  snapshot(label) {
    const cels = [];
    this.frames.forEach((fr) => fr.cels.forEach((c) => cels.push(ctx2d(c).getImageData(0, 0, this.w, this.h))));
    return { kind: 'doc', label, w: this.w, h: this.h, layers: JSON.parse(JSON.stringify(this.layers)), frames: this.frames.map((fr) => ({ duration: fr.duration, n: fr.cels.length })), cels, frame: this.frame, layer: this.layer };
  }
  restore(s) {
    this.w = s.w; this.h = s.h; this.layers = JSON.parse(JSON.stringify(s.layers)); let k = 0;
    this.frames = s.frames.map((fr) => ({ duration: fr.duration, cels: Array.from({ length: fr.n }, () => { const c = makeCanvas(s.w, s.h); ctx2d(c).putImageData(s.cels[k++], 0, 0); return c; }) }));
    this.frame = Math.min(s.frame, this.frames.length - 1); this.layer = Math.min(s.layer, this.layers.length - 1);
    if (this.selection && (this.selection.width !== this.w || this.selection.height !== this.h)) this.selection = null;
  }
  _push(e) {
    this.undo.push(e); this.bytes += this._size(e); this.redo = []; this.dirty = true;
    while (this.undo.length > this.maxSteps || (this.bytes > this.maxBytes && this.undo.length > 1)) this.bytes -= this._size(this.undo.shift());
  }
  _swap(from, to) {
    const e = from.pop(); if (!e) return null;
    if (from === this.undo) this.bytes -= this._size(e);
    let back;
    if (e.kind === 'cel') {
      const l = this.layers.findIndex((L) => L.id === e.layerId), f = Math.min(e.f, this.frames.length - 1);
      if (l < 0 || e.data.width !== this.w || e.data.height !== this.h) return this._swap(from, to); // la capa ya no existe: se salta
      const c = this.celOf(f, l), g = ctx2d(c);
      back = { kind: 'cel', label: e.label, f, l, layerId: e.layerId, data: g.getImageData(0, 0, this.w, this.h) };
      g.putImageData(e.data, 0, 0); this.frame = f; this.layer = l;
    } else { back = this.snapshot(e.label); this.restore(e); }
    to.push(back); if (to === this.undo) this.bytes += this._size(back);
    this.dirty = true;
    return e.label;
  }
  undoStep() { return this._swap(this.undo, this.redo); }
  redoStep() { return this._swap(this.redo, this.undo); }
  /* ---------------------------------------------------------------- tamaño */
  resizeCanvas(w, h, ax, ay) {
    w = Math.max(1, Math.min(8192, w | 0)); h = Math.max(1, Math.min(8192, h | 0));
    const dx = Math.round((w - this.w) * (ax === undefined ? 0.5 : ax)), dy = Math.round((h - this.h) * (ay === undefined ? 0.5 : ay));
    this.frames.forEach((fr) => { fr.cels = fr.cels.map((c) => { const n = makeCanvas(w, h); ctx2d(n).drawImage(c, dx, dy); return n; }); });
    this.w = w; this.h = h; this.selection = null;
  }
  resizeImage(w, h, smooth) {
    w = Math.max(1, Math.min(8192, w | 0)); h = Math.max(1, Math.min(8192, h | 0));
    this.frames.forEach((fr) => { fr.cels = fr.cels.map((c) => { const n = makeCanvas(w, h), g = ctx2d(n); g.imageSmoothingEnabled = !!smooth; g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, w, h); return n; }); });
    this.w = w; this.h = h; this.selection = null;
  }
  /** Amplía todas las capas y fotogramas con Scale2x (2), Scale3x (3) o Scale4x (4) */
  scalePixelArt(factor) {
    const f = factor === 3 ? 3 : factor === 4 ? 4 : 2;
    if (this.w * f > 8192 || this.h * f > 8192) throw new Error('El resultado pasaría de 8192 px');
    this.frames.forEach((fr) => { fr.cels = fr.cels.map((c) => { const img = scalePixels(ctx2d(c).getImageData(0, 0, this.w, this.h), f), n = makeCanvas(img.width, img.height); ctx2d(n).putImageData(img, 0, 0); return n; }); });
    this.w *= f; this.h *= f; this.selection = null;
  }
  crop(x, y, w, h) {
    x = Math.round(x); y = Math.round(y); w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    this.frames.forEach((fr) => { fr.cels = fr.cels.map((c) => { const n = makeCanvas(w, h); ctx2d(n).drawImage(c, -x, -y); return n; }); });
    this.w = w; this.h = h; this.selection = null;
  }
  transformAll(fn) { // voltear/rotar todo el documento: fn(g, w, h, src) dibuja en el nuevo lienzo
    const swap = fn.swap;
    const w = swap ? this.h : this.w, h = swap ? this.w : this.h;
    this.frames.forEach((fr) => { fr.cels = fr.cels.map((c) => { const n = makeCanvas(w, h), g = ctx2d(n); fn(g, w, h, c); return n; }); });
    this.w = w; this.h = h; this.selection = null;
  }
  /** Caja del contenido no transparente (todas las capas y fotogramas) o null */
  contentBounds() {
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
    this.frames.forEach((fr) => fr.cels.forEach((c) => {
      const d = ctx2d(c).getImageData(0, 0, this.w, this.h).data;
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (d[(y * this.w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }));
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  /* ---------------------------------------------------------------- exportar */
  spritesheet(cols) {
    const n = this.frames.length; cols = Math.max(1, Math.min(n, cols || n));
    const rows = Math.ceil(n / cols), c = makeCanvas(this.w * cols, this.h * rows), g = ctx2d(c);
    this.frames.forEach((fr, i) => g.drawImage(this.composite(fr), (i % cols) * this.w, Math.floor(i / cols) * this.h));
    return c;
  }
}

/* ---------------------------------------------------------------- selección */
export function selectionBounds(mask) {
  if (!mask) return null;
  const w = mask.width, h = mask.height, d = ctx2d(mask).getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
/** Combina una forma (función de dibujo) con la selección actual: mode 'new' | 'add' | 'sub' | 'inter' */
export function combineSelection(doc, draw, mode) {
  const shape = makeCanvas(doc.w, doc.h), g = ctx2d(shape); g.fillStyle = '#fff'; draw(g);
  if (!doc.selection || mode === 'new' || !mode) { doc.selection = shape; return; }
  const s = ctx2d(doc.selection);
  s.globalCompositeOperation = mode === 'sub' ? 'destination-out' : mode === 'inter' ? 'destination-in' : 'source-over';
  s.drawImage(shape, 0, 0); s.globalCompositeOperation = 'source-over';
  if (!selectionBounds(doc.selection)) doc.selection = null;
}
export function invertSelection(doc) {
  const m = makeCanvas(doc.w, doc.h), g = ctx2d(m); g.fillStyle = '#fff'; g.fillRect(0, 0, doc.w, doc.h);
  if (doc.selection) { g.globalCompositeOperation = 'destination-out'; g.drawImage(doc.selection, 0, 0); }
  doc.selection = selectionBounds(m) ? m : null;
}
/** Contorno de la selección (segmentos entre píxeles dentro/fuera) para las «hormigas» */
export function selectionEdges(mask) {
  const w = mask.width, h = mask.height, d = ctx2d(mask).getImageData(0, 0, w, h).data, on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 127, segs = [];
  if (w * h > 4194304) return segs; // enorme: sin contorno
  for (let y = 0; y <= h; y++) for (let x = 0; x < w; x++) if (on(x, y) !== on(x, y - 1)) segs.push(x, y, x + 1, y);
  for (let x = 0; x <= w; x++) for (let y = 0; y < h; y++) if (on(x, y) !== on(x - 1, y)) segs.push(x, y, x, y + 1);
  return segs;
}
/** Aplica «nuevo» sobre «antes» solo dentro de la máscara (ImageData del mismo tamaño) */
export function maskBlend(before, after, mask) {
  if (!mask) return after;
  const m = ctx2d(mask).getImageData(0, 0, mask.width, mask.height).data, a = after.data, b = before.data;
  for (let i = 0; i < a.length; i += 4) { const k = m[i + 3] / 255; if (k >= 1) continue; for (let c = 0; c < 4; c++) a[i + c] = b[i + c] + (a[i + c] - b[i + c]) * k; }
  return after;
}

/* ---------------------------------------------------------------- relleno */
/** Máscara (Uint8Array w*h) de los píxeles parecidos al de (x, y): contiguos o en toda la imagen */
export function floodMask(img, x, y, tol, contiguous) {
  const w = img.width, h = img.height, d = img.data, out = new Uint8Array(w * h);
  if (x < 0 || y < 0 || x >= w || y >= h) return out;
  const i0 = (y * w + x) * 4, r0 = d[i0], g0 = d[i0 + 1], b0 = d[i0 + 2], a0 = d[i0 + 3], t = Math.max(0, tol) * 4;
  const like = (i) => { const p = i * 4; return Math.abs(d[p] - r0) + Math.abs(d[p + 1] - g0) + Math.abs(d[p + 2] - b0) + Math.abs(d[p + 3] - a0) <= t; };
  if (!contiguous) { for (let i = 0; i < w * h; i++) if (like(i)) out[i] = 1; return out; }
  const stack = [x, y];
  while (stack.length) {
    const cy = stack.pop(), cx0 = stack.pop();
    let lx = cx0; while (lx >= 0 && !out[cy * w + lx] && like(cy * w + lx)) lx--; lx++;
    let rx = cx0; while (rx < w && !out[cy * w + rx] && like(cy * w + rx)) rx++;
    for (let xx = lx; xx < rx; xx++) {
      out[cy * w + xx] = 1;
      if (cy > 0 && !out[(cy - 1) * w + xx] && like((cy - 1) * w + xx)) stack.push(xx, cy - 1);
      if (cy < h - 1 && !out[(cy + 1) * w + xx] && like((cy + 1) * w + xx)) stack.push(xx, cy + 1);
    }
    if (stack.length > 8e6) break;
  }
  return out;
}
export function maskToCanvas(m, w, h) {
  const c = makeCanvas(w, h), g = ctx2d(c), id = g.createImageData(w, h);
  for (let i = 0; i < m.length; i++) if (m[i]) { const p = i * 4; id.data[p] = id.data[p + 1] = id.data[p + 2] = id.data[p + 3] = 255; }
  g.putImageData(id, 0, 0); return c;
}

/* ---------------------------------------------------------------- filtros (sobre ImageData, en sitio) */
function clamp8(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
function each(img, fn) { const d = img.data; for (let i = 0; i < d.length; i += 4) { if (d[i + 3] === 0) continue; fn(d, i); } return img; }
function boxBlurH(src, dst, w, h, r) { const n = r * 2 + 1; for (let y = 0; y < h; y++) { for (let c = 0; c < 4; c++) { let acc = 0; for (let k = -r; k <= r; k++) acc += src[(y * w + Math.min(w - 1, Math.max(0, k))) * 4 + c]; for (let x = 0; x < w; x++) { dst[(y * w + x) * 4 + c] = acc / n; const a = Math.max(0, x - r), b = Math.min(w - 1, x + r + 1); acc += src[(y * w + b) * 4 + c] - src[(y * w + a) * 4 + c]; } } } }
function boxBlurV(src, dst, w, h, r) { const n = r * 2 + 1; for (let x = 0; x < w; x++) { for (let c = 0; c < 4; c++) { let acc = 0; for (let k = -r; k <= r; k++) acc += src[(Math.min(h - 1, Math.max(0, k)) * w + x) * 4 + c]; for (let y = 0; y < h; y++) { dst[(y * w + x) * 4 + c] = acc / n; const a = Math.max(0, y - r), b = Math.min(h - 1, y + r + 1); acc += src[(b * w + x) * 4 + c] - src[(a * w + x) * 4 + c]; } } } }
/** Desenfoque aproximadamente gaussiano (3 pasadas de caja), con alfa premultiplicado para no oscurecer bordes */
export function blur(img, radius) {
  const r = Math.max(0, Math.min(200, Math.round(radius))); if (!r) return img;
  const w = img.width, h = img.height, d = img.data, a = new Float32Array(d.length), b = new Float32Array(d.length);
  for (let i = 0; i < d.length; i += 4) { const al = d[i + 3] / 255; a[i] = d[i] * al; a[i + 1] = d[i + 1] * al; a[i + 2] = d[i + 2] * al; a[i + 3] = d[i + 3]; }
  const rr = Math.max(1, Math.round(r / 1.7));
  for (let k = 0; k < 3; k++) { boxBlurH(a, b, w, h, rr); boxBlurV(b, a, w, h, rr); }
  for (let i = 0; i < d.length; i += 4) { const al = a[i + 3] / 255; d[i + 3] = clamp8(a[i + 3]); if (al > 0.001) { d[i] = clamp8(a[i] / al); d[i + 1] = clamp8(a[i + 1] / al); d[i + 2] = clamp8(a[i + 2] / al); } }
  return img;
}
function convolve(img, k, div, bias) {
  const w = img.width, h = img.height, s = new Uint8ClampedArray(img.data), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const p = ((Math.min(h - 1, Math.max(0, y + j))) * w + Math.min(w - 1, Math.max(0, x + i))) * 4, kk = k[(j + 1) * 3 + i + 1]; r += s[p] * kk; g += s[p + 1] * kk; b += s[p + 2] * kk; }
    const o = (y * w + x) * 4; d[o] = clamp8(r / div + bias); d[o + 1] = clamp8(g / div + bias); d[o + 2] = clamp8(b / div + bias);
  }
  return img;
}
function hash(x, y, s) { let n = (x * 374761393 + y * 668265263 + s * 144269) | 0; n = (n ^ (n >>> 13)) * 1274126177; return ((n ^ (n >>> 16)) >>> 0) / 4294967295; }
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (x, y) => (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

/** Filtros: { id: { label, group, params: [{key, label, min, max, step, def, type}], apply(img, p, ctx) } } */
export const FILTERS = {
  brightness: { label: 'Brillo y contraste', group: 'Ajustes', params: [{ key: 'b', label: 'Brillo', min: -100, max: 100, def: 0 }, { key: 'c', label: 'Contraste', min: -100, max: 100, def: 0 }],
    apply: (img, p) => { const f = (259 * (p.c * 2.55 + 255)) / (255 * (259 - p.c * 2.55)), bb = p.b * 2.55; return each(img, (d, i) => { for (let c = 0; c < 3; c++) d[i + c] = clamp8(f * (d[i + c] - 128) + 128 + bb); }); } },
  hsl: { label: 'Tono, saturación y luminosidad', group: 'Ajustes', params: [{ key: 'h', label: 'Tono (°)', min: -180, max: 180, def: 0 }, { key: 's', label: 'Saturación', min: -100, max: 100, def: 0 }, { key: 'l', label: 'Luminosidad', min: -100, max: 100, def: 0 }, { key: 'colorize', label: 'Colorear', type: 'bool', def: false }],
    apply: (img, p) => each(img, (d, i) => { let [hh, ss, ll] = rgbToHsl(d[i], d[i + 1], d[i + 2]); if (p.colorize) { hh = ((p.h + 180) / 360); ss = Math.max(0, Math.min(1, 0.5 + p.s / 200)); } else { hh += p.h / 360; ss = Math.max(0, Math.min(1, ss * (1 + p.s / 100))); } ll = Math.max(0, Math.min(1, ll + p.l / 200)); const c = hslToRgb(hh, ss, ll); d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; }) },
  levels: { label: 'Niveles', group: 'Ajustes', params: [{ key: 'lo', label: 'Negro', min: 0, max: 254, def: 0 }, { key: 'hi', label: 'Blanco', min: 1, max: 255, def: 255 }, { key: 'g', label: 'Gamma', min: 0.1, max: 4, step: 0.01, def: 1 }],
    apply: (img, p) => { const lo = Math.min(p.lo, p.hi - 1), rng = Math.max(1, p.hi - lo), lut = new Uint8ClampedArray(256); for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(Math.max(0, Math.min(1, (v - lo) / rng)), 1 / p.g); return each(img, (d, i) => { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }); } },
  balance: { label: 'Equilibrio de color', group: 'Ajustes', params: [{ key: 'r', label: 'Cian ↔ Rojo', min: -100, max: 100, def: 0 }, { key: 'g', label: 'Magenta ↔ Verde', min: -100, max: 100, def: 0 }, { key: 'b', label: 'Amarillo ↔ Azul', min: -100, max: 100, def: 0 }],
    apply: (img, p) => each(img, (d, i) => { d[i] = clamp8(d[i] + p.r * 1.5); d[i + 1] = clamp8(d[i + 1] + p.g * 1.5); d[i + 2] = clamp8(d[i + 2] + p.b * 1.5); }) },
  vibrance: { label: 'Intensidad (vibrance)', group: 'Ajustes', params: [{ key: 'v', label: 'Intensidad', min: -100, max: 100, def: 30 }],
    apply: (img, p) => each(img, (d, i) => { const mx = Math.max(d[i], d[i + 1], d[i + 2]), avg = (d[i] + d[i + 1] + d[i + 2]) / 3, amt = ((Math.abs(mx - avg) * 2 / 255) * -p.v) / 100 * 3; for (let c = 0; c < 3; c++) if (d[i + c] !== mx) d[i + c] = clamp8(d[i + c] + (mx - d[i + c]) * amt); }) },
  temperature: { label: 'Temperatura', group: 'Ajustes', params: [{ key: 't', label: 'Frío ↔ Cálido', min: -100, max: 100, def: 20 }],
    apply: (img, p) => each(img, (d, i) => { d[i] = clamp8(d[i] + p.t * 0.8); d[i + 2] = clamp8(d[i + 2] - p.t * 0.8); }) },
  invert: { label: 'Invertir (negativo)', group: 'Ajustes', params: [], apply: (img) => each(img, (d, i) => { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }) },
  gray: { label: 'Blanco y negro', group: 'Ajustes', params: [], apply: (img) => each(img, (d, i) => { const v = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; d[i] = d[i + 1] = d[i + 2] = v; }) },
  sepia: { label: 'Sepia', group: 'Ajustes', params: [{ key: 'a', label: 'Cantidad', min: 0, max: 100, def: 100 }], apply: (img, p) => each(img, (d, i) => { const r = d[i], g = d[i + 1], b = d[i + 2], k = p.a / 100; d[i] = clamp8(r + (r * 0.393 + g * 0.769 + b * 0.189 - r) * k); d[i + 1] = clamp8(g + (r * 0.349 + g * 0.686 + b * 0.168 - g) * k); d[i + 2] = clamp8(b + (r * 0.272 + g * 0.534 + b * 0.131 - b) * k); }) },
  threshold: { label: 'Umbral', group: 'Ajustes', params: [{ key: 't', label: 'Umbral', min: 0, max: 255, def: 128 }], apply: (img, p) => each(img, (d, i) => { const v = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 >= p.t ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; }) },
  posterize: { label: 'Posterizar', group: 'Ajustes', params: [{ key: 'n', label: 'Niveles', min: 2, max: 32, def: 5 }], apply: (img, p) => { const s = 255 / (p.n - 1); return each(img, (d, i) => { for (let c = 0; c < 3; c++) d[i + c] = Math.round(d[i + c] / s) * s; }); } },
  blur: { label: 'Desenfoque gaussiano', group: 'Desenfocar y enfocar', params: [{ key: 'r', label: 'Radio', min: 1, max: 60, def: 4 }], apply: (img, p) => blur(img, p.r) },
  motion: { label: 'Desenfoque de movimiento', group: 'Desenfocar y enfocar', params: [{ key: 'd', label: 'Distancia', min: 1, max: 60, def: 10 }], apply: (img, p) => { const w = img.width, h = img.height, s = new Uint8ClampedArray(img.data), d = img.data, n = p.d | 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let r = 0, g = 0, b = 0, a = 0; for (let k = 0; k <= n; k++) { const q = (y * w + Math.min(w - 1, x + k - (n >> 1))) * 4; r += s[q]; g += s[q + 1]; b += s[q + 2]; a += s[q + 3]; } const o = (y * w + x) * 4; d[o] = r / (n + 1); d[o + 1] = g / (n + 1); d[o + 2] = b / (n + 1); d[o + 3] = a / (n + 1); } return img; } },
  sharpen: { label: 'Enfocar (máscara de enfoque)', group: 'Desenfocar y enfocar', params: [{ key: 'a', label: 'Cantidad', min: 0, max: 300, def: 80 }, { key: 'r', label: 'Radio', min: 1, max: 10, def: 2 }],
    apply: (img, p) => { const orig = new Uint8ClampedArray(img.data), bl = blur(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), p.r).data, d = img.data, k = p.a / 100; for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = clamp8(orig[i + c] + (orig[i + c] - bl[i + c]) * k); return img; } },
  noise: { label: 'Añadir ruido', group: 'Ruido y textura', params: [{ key: 'a', label: 'Cantidad', min: 0, max: 100, def: 15 }, { key: 'mono', label: 'Monocromático', type: 'bool', def: true }],
    apply: (img, p) => { const w = img.width, seed = 7; return each(img, (d, i) => { const px = (i >> 2) % w, py = ((i >> 2) / w) | 0; if (p.mono) { const n = (hash(px, py, seed) - 0.5) * p.a * 5.1; d[i] = clamp8(d[i] + n); d[i + 1] = clamp8(d[i + 1] + n); d[i + 2] = clamp8(d[i + 2] + n); } else for (let c = 0; c < 3; c++) d[i + c] = clamp8(d[i + c] + (hash(px, py, seed + c) - 0.5) * p.a * 5.1); }); } },
  pixelate: { label: 'Pixelar', group: 'Ruido y textura', params: [{ key: 's', label: 'Tamaño del bloque', min: 2, max: 64, def: 6 }],
    apply: (img, p) => { const w = img.width, h = img.height, d = img.data, s = p.s | 0; for (let by = 0; by < h; by += s) for (let bx = 0; bx < w; bx += s) { let r = 0, g = 0, b = 0, a = 0, n = 0; for (let y = by; y < Math.min(h, by + s); y++) for (let x = bx; x < Math.min(w, bx + s); x++) { const q = (y * w + x) * 4; r += d[q]; g += d[q + 1]; b += d[q + 2]; a += d[q + 3]; n++; } for (let y = by; y < Math.min(h, by + s); y++) for (let x = bx; x < Math.min(w, bx + s); x++) { const q = (y * w + x) * 4; d[q] = r / n; d[q + 1] = g / n; d[q + 2] = b / n; d[q + 3] = a / n; } } return img; } },
  emboss: { label: 'Relieve', group: 'Estilizar', params: [], apply: (img) => convolve(img, [-2, -1, 0, -1, 1, 1, 0, 1, 2], 1, 0) },
  edges: { label: 'Detectar bordes', group: 'Estilizar', params: [], apply: (img) => convolve(img, [-1, -1, -1, -1, 8, -1, -1, -1, -1], 1, 0) },
  vignette: { label: 'Viñeta', group: 'Estilizar', params: [{ key: 'a', label: 'Fuerza', min: 0, max: 100, def: 60 }, { key: 'r', label: 'Radio', min: 10, max: 100, def: 70 }],
    apply: (img, p) => { const w = img.width, h = img.height, cx = w / 2, cy = h / 2, R = Math.hypot(cx, cy); return each(img, (d, i) => { const x = (i >> 2) % w, y = ((i >> 2) / w) | 0, t = Math.max(0, Math.hypot(x - cx, y - cy) / R - p.r / 100) / Math.max(0.01, 1 - p.r / 100), k = 1 - Math.min(1, t * t) * p.a / 100; d[i] *= k; d[i + 1] *= k; d[i + 2] *= k; }); } },
  outline: { label: 'Contorno (sprites)', group: 'Estilizar', params: [{ key: 'color', label: 'Color', type: 'color', def: '#000000' }, { key: 't', label: 'Grosor', min: 1, max: 8, def: 1 }, { key: 'diag', label: 'Esquinas', type: 'bool', def: false }],
    apply: (img, p) => { const w = img.width, h = img.height, s = new Uint8ClampedArray(img.data), d = img.data, [cr, cg, cb] = hexToRgb(p.color), t = p.t | 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; if (s[o + 3] > 0) continue; let hit = false; for (let j = -t; j <= t && !hit; j++) for (let i = -t; i <= t && !hit; i++) { if (!p.diag && Math.abs(i) + Math.abs(j) > t) continue; const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < w && yy < h && s[(yy * w + xx) * 4 + 3] > 127) hit = true; } if (hit) { d[o] = cr; d[o + 1] = cg; d[o + 2] = cb; d[o + 3] = 255; } } return img; } },
  shadow: { label: 'Sombra paralela', group: 'Estilizar', params: [{ key: 'dx', label: 'Desplaz. X', min: -50, max: 50, def: 4 }, { key: 'dy', label: 'Desplaz. Y', min: -50, max: 50, def: 4 }, { key: 'r', label: 'Desenfoque', min: 0, max: 30, def: 4 }, { key: 'o', label: 'Opacidad', min: 0, max: 100, def: 60 }, { key: 'color', label: 'Color', type: 'color', def: '#000000' }],
    apply: (img, p) => { const w = img.width, h = img.height, c = makeCanvas(w, h), g = ctx2d(c), src = makeCanvas(w, h); ctx2d(src).putImageData(img, 0, 0); const sh = makeCanvas(w, h), sg = ctx2d(sh); sg.drawImage(src, p.dx, p.dy); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = p.color; sg.fillRect(0, 0, w, h); const si = blur(sg.getImageData(0, 0, w, h), p.r); sg.globalCompositeOperation = 'source-over'; sg.putImageData(si, 0, 0); g.globalAlpha = p.o / 100; g.drawImage(sh, 0, 0); g.globalAlpha = 1; g.drawImage(src, 0, 0); return g.getImageData(0, 0, w, h); } },
  glow: { label: 'Resplandor exterior', group: 'Estilizar', params: [{ key: 'r', label: 'Radio', min: 1, max: 40, def: 8 }, { key: 'o', label: 'Intensidad', min: 0, max: 300, def: 120 }, { key: 'color', label: 'Color', type: 'color', def: '#ffe066' }],
    apply: (img, p) => { const w = img.width, h = img.height, src = makeCanvas(w, h); ctx2d(src).putImageData(img, 0, 0); const gl = makeCanvas(w, h), gg = ctx2d(gl); gg.drawImage(src, 0, 0); gg.globalCompositeOperation = 'source-in'; gg.fillStyle = p.color; gg.fillRect(0, 0, w, h); const bi = blur(gg.getImageData(0, 0, w, h), p.r); for (let i = 3; i < bi.data.length; i += 4) bi.data[i] = clamp8(bi.data[i] * p.o / 100); gg.globalCompositeOperation = 'source-over'; gg.putImageData(bi, 0, 0); const out = makeCanvas(w, h), og = ctx2d(out); og.drawImage(gl, 0, 0); og.drawImage(src, 0, 0); return og.getImageData(0, 0, w, h); } },
  replace: { label: 'Reemplazar color', group: 'Color', params: [{ key: 'from', label: 'Color a cambiar', type: 'color', def: '#ffffff' }, { key: 'to', label: 'Nuevo color', type: 'color', def: '#ff0000' }, { key: 't', label: 'Tolerancia', min: 0, max: 255, def: 24 }],
    apply: (img, p) => { const [fr, fg, fb] = hexToRgb(p.from), [tr, tg, tb] = hexToRgb(p.to); return each(img, (d, i) => { if (Math.abs(d[i] - fr) + Math.abs(d[i + 1] - fg) + Math.abs(d[i + 2] - fb) <= p.t * 3) { d[i] = tr; d[i + 1] = tg; d[i + 2] = tb; } }); } },
  chroma: { label: 'Quitar fondo (croma)', group: 'Color', params: [{ key: 'color', label: 'Color de fondo', type: 'color', def: '#00ff00' }, { key: 't', label: 'Tolerancia', min: 0, max: 255, def: 60 }, { key: 'soft', label: 'Suavizado', min: 0, max: 100, def: 20 }],
    apply: (img, p) => { const [kr, kg, kb] = hexToRgb(p.color), t = p.t * 1.732, s = Math.max(1, p.soft * 1.5); return each(img, (d, i) => { const dist = Math.hypot(d[i] - kr, d[i + 1] - kg, d[i + 2] - kb); if (dist <= t) d[i + 3] = 0; else if (dist < t + s) d[i + 3] = clamp8(d[i + 3] * (dist - t) / s); }); } },
  palette: { label: 'Reducir a la paleta', group: 'Color', params: [{ key: 'dither', label: 'Tramado (Bayer)', type: 'bool', def: false }],
    apply: (img, p, ctx) => { const pal = (ctx && ctx.palette && ctx.palette.length ? ctx.palette : PALETTES.pico8.list).map(hexToRgb), w = img.width; return each(img, (d, i) => { const x = (i >> 2) % w, y = ((i >> 2) / w) | 0, off = p.dither ? (bayer(x, y) - 0.5) * 48 : 0; let best = 0, bd = Infinity; for (let k = 0; k < pal.length; k++) { const c = pal[k], e = (d[i] + off - c[0]) ** 2 * 0.3 + (d[i + 1] + off - c[1]) ** 2 * 0.59 + (d[i + 2] + off - c[2]) ** 2 * 0.11; if (e < bd) { bd = e; best = k; } } d[i] = pal[best][0]; d[i + 1] = pal[best][1]; d[i + 2] = pal[best][2]; d[i + 3] = d[i + 3] > 127 ? 255 : 0; }); } },
  alphaHard: { label: 'Alfa duro (sin semitransparencia)', group: 'Color', params: [{ key: 't', label: 'Umbral', min: 1, max: 254, def: 128 }], apply: (img, p) => { const d = img.data; for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= p.t ? 255 : 0; return img; } }
};

/* ---------------------------------------------------------------- GIF animado (GIF89a, LZW) */
/** Cuantiza (hasta 255 colores + transparente) y codifica. frames: [{ canvas, delay(ms) }] */
export function encodeGIF(frames, w, h, loop) {
  // paleta global: colores exactos si caben (pixel art); si no, cubo 6x7x6
  const counts = new Map(); let exact = true;
  frames.forEach((f) => { const d = ctx2d(f.canvas).getImageData(0, 0, w, h).data; for (let i = 0; i < d.length && exact; i += 4) { if (d[i + 3] < 128) continue; const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; counts.set(k, (counts.get(k) || 0) + 1); if (counts.size > 255) exact = false; } });
  let pal = [];
  if (exact) pal = Array.from(counts.keys());
  else for (let r = 0; r < 6; r++) for (let g = 0; g < 7; g++) for (let b = 0; b < 6; b++) pal.push((Math.round(r * 51) << 16) | (Math.round(g * 42.5) << 8) | Math.round(b * 51));
  const TR = pal.length; pal.push(0); // índice transparente
  let bits = 1; while ((1 << bits) < pal.length) bits++;
  const size = 1 << bits, lookup = new Map(pal.slice(0, TR).map((c, i) => [c, i]));
  const out = [], byte = (b) => out.push(b & 255), word = (v) => { byte(v); byte(v >> 8); }, str = (s) => { for (let i = 0; i < s.length; i++) byte(s.charCodeAt(i)); };
  str('GIF89a'); word(w); word(h); byte(0xf0 | (bits - 1)); byte(0); byte(0);
  for (let i = 0; i < size; i++) { const c = pal[i] || 0; byte(c >> 16); byte(c >> 8); byte(c); }
  if (loop !== false) { byte(0x21); byte(0xff); byte(11); str('NETSCAPE2.0'); byte(3); byte(1); word(0); byte(0); }
  const nearest = (r, g, b) => { if (exact) return lookup.get((r << 16) | (g << 8) | b); return Math.round(r / 51) * 42 + Math.round(g / 42.5) * 6 + Math.round(b / 51); };
  frames.forEach((f) => {
    const d = ctx2d(f.canvas).getImageData(0, 0, w, h).data, idx = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) idx[p] = d[i + 3] < 128 ? TR : nearest(d[i], d[i + 1], d[i + 2]);
    byte(0x21); byte(0xf9); byte(4); byte(0x09); word(Math.max(2, Math.round((f.delay || 100) / 10))); byte(TR); byte(0); // disposición: restaurar al fondo
    byte(0x2c); word(0); word(0); word(w); word(h); byte(0);
    lzw(idx, Math.max(2, bits), out);
  });
  byte(0x3b);
  return new Uint8Array(out);
}
function lzw(idx, minSize, out) {
  out.push(minSize);
  const clear = 1 << minSize, eoi = clear + 1; let codeSize = minSize + 1, next = eoi + 1, dict = new Map(), cur = 0, nbits = 0, block = [];
  const emit = (code) => { cur |= code << nbits; nbits += codeSize; while (nbits >= 8) { block.push(cur & 255); cur >>>= 8; nbits -= 8; if (block.length === 255) { out.push(255); for (let i = 0; i < 255; i++) out.push(block[i]); block = []; } } };
  emit(clear);
  let prefix = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i], key = prefix * 4096 + k, v = dict.get(key);
    if (v !== undefined) { prefix = v; continue; }
    emit(prefix);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << codeSize) && codeSize < 12) codeSize++; }
    else { emit(clear); dict = new Map(); codeSize = minSize + 1; next = eoi + 1; }
    prefix = k;
  }
  emit(prefix); emit(eoi);
  if (nbits > 0) block.push(cur & 255);
  if (block.length) { out.push(block.length); for (let i = 0; i < block.length; i++) out.push(block[i]); }
  out.push(0);
}

/* ---------------------------------------------------------------- líneas y formas en píxeles */
export function bresenham(x0, y0, x1, y1, plot) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy, n = 0;
  for (;;) { plot(x0, y0); if ((x0 === x1 && y0 === y1) || ++n > 20000) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
}
/** Elipse en píxeles dentro de la caja (x0,y0)-(x1,y1) */
export function pixelEllipse(x0, y0, x1, y1, fill, plot) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2 + 0.5, ry = Math.abs(y1 - y0) / 2 + 0.5, X0 = Math.min(x0, x1), X1 = Math.max(x0, x1), Y0 = Math.min(y0, y1), Y1 = Math.max(y0, y1);
  const inside = (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) { if (!inside(x, y)) continue; if (fill || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) plot(x, y); }
}
