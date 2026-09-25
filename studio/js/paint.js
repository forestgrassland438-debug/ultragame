/* UltraGame Studio · pestaña Arte: editor de imágenes con dos modos.
 *  📷 Foto (tipo Photoshop): pincel con dureza/flujo/presión, lápiz, borrador, bote, degradado, tampón de clonar,
 *     dedo, desenfocar/enfocar, sobreexponer/subexponer, texto, formas, selección rectangular/elíptica/lazo/varita,
 *     mover, recortar, capas con opacidad y 17 modos de fusión, ajustes y filtros con vista previa.
 *  👾 Pixel art: lápiz píxel a píxel (píxel perfecto), simetría, tramado Bayer, sombreado, reemplazo de color,
 *     líneas/rectángulos/elipses exactas, paletas clásicas, rejilla, mosaico, fotogramas con papel cebolla,
 *     animación, hoja de sprites y GIF animado.
 * Guarda en el proyecto (sustituye el recurso o crea uno nuevo) y exporta PNG/JPG/WebP/GIF. Táctil: pellizcar = zoom. */
import { h, clear, toast, showMenu, dialog, confirm, downloadBlob, safeFileName } from './dom.js';
import { PaintDoc, PALETTES, BLENDS, FILTERS, makeCanvas, ctx2d, hexToRgb, rgbToHex, rgbToHsl, hslToRgb, floodMask, maskToCanvas, combineSelection, invertSelection,
  selectionBounds, selectionEdges, maskBlend, encodeGIF, bresenham, pixelEllipse, bayer, blur as blurImg } from './paintcore.js';

const TOOLS = {
  move: { icon: '✥', label: 'Mover (V)', key: 'v', modes: 'both' },
  marquee: { icon: '⬚', label: 'Selección rectangular (M)', key: 'm', modes: 'both' },
  ellipseSel: { icon: '◌', label: 'Selección elíptica', modes: 'photo' },
  lasso: { icon: '➰', label: 'Lazo (L)', key: 'l', modes: 'both' },
  wand: { icon: '🪄', label: 'Varita mágica (W)', key: 'w', modes: 'both' },
  crop: { icon: '⛶', label: 'Recortar (C)', key: 'c', modes: 'both' },
  brush: { icon: '🖌', label: 'Pincel (B)', key: 'b', modes: 'photo' },
  pencil: { icon: '✏', label: 'Lápiz (N)', key: 'n', modes: 'both' },
  eraser: { icon: '🧽', label: 'Borrador (E)', key: 'e', modes: 'both' },
  bucket: { icon: '🪣', label: 'Bote de pintura (G)', key: 'g', modes: 'both' },
  gradient: { icon: '🌈', label: 'Degradado', modes: 'photo' },
  dither: { icon: '▦', label: 'Tramado (D con Mayús)', modes: 'pixel' },
  shade: { icon: '◐', label: 'Sombrear / iluminar', modes: 'pixel' },
  replace: { icon: '⇄', label: 'Reemplazar color (todo el lienzo)', modes: 'pixel' },
  clone: { icon: '⎘', label: 'Tampón de clonar (S; Alt+clic = origen)', key: 's', modes: 'photo' },
  smudge: { icon: '👆', label: 'Dedo (difuminar)', modes: 'photo' },
  blurBrush: { icon: '💧', label: 'Desenfocar / enfocar (Alt)', modes: 'photo' },
  dodge: { icon: '☀', label: 'Sobreexponer / subexponer (Alt)', modes: 'photo' },
  line: { icon: '╱', label: 'Línea', modes: 'both' },
  rect: { icon: '▭', label: 'Rectángulo (U)', key: 'u', modes: 'both' },
  ellipse: { icon: '◯', label: 'Elipse', modes: 'both' },
  text: { icon: 'T', label: 'Texto (T)', key: 't', modes: 'both' },
  picker: { icon: '💉', label: 'Cuentagotas (I)', key: 'i', modes: 'both' },
  hand: { icon: '✋', label: 'Mano (H, o Espacio)', key: 'h', modes: 'both' },
  zoom: { icon: '🔍', label: 'Zoom (Z; Alt = alejar)', key: 'z', modes: 'both' }
};
const SIZES = [[16, 16], [32, 32], [48, 48], [64, 64], [128, 128], [256, 256], [320, 180], [512, 512], [1024, 1024], [1280, 720], [1920, 1080], [2048, 2048]];

export class PaintPanel {
  constructor(app, host) {
    this.app = app; this.host = host; this.doc = null; this.tool = 'brush'; this.visible = false;
    this.primary = '#1b1e2b'; this.secondary = '#ffffff'; this.alpha = 1; this.recent = [];
    this.o = { size: 12, hardness: 0.8, opacity: 1, flow: 1, spacing: 0.15, pressure: true, tol: 24, contiguous: true, sampleAll: false, pixelPerfect: true, symX: false, symY: false,
      ditherLevel: 8, ditherTransparent: false, shadeAmt: 8, shapeFill: false, strokeW: 2, gradType: 'linear', font: 'system-ui', fontSize: 32, bold: false, textAA: true, selMode: 'new', strength: 0.5 };
    this.view = { z: 1, x: 0, y: 0 }; this.show = { grid: false, pixelGrid: true, tile: false, onion: false, gridSize: 16 }; this.palette = PALETTES.pico8.list.slice(); this.paletteKey = 'pico8';
    this.dirtyView = true; this.playing = false; this.edges = null; this.ant = 0;
    try { const s = JSON.parse(localStorage.getItem('ugs-paint') || '{}'); Object.assign(this.o, s.o || {}); if (s.primary) this.primary = s.primary; if (s.secondary) this.secondary = s.secondary; if (Array.isArray(s.recent)) this.recent = s.recent.slice(0, 16); } catch (e) { /* modo privado */ }
    app.editor.on('project', () => { this.doc = null; if (this.visible) this.render(); });
    document.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('paste', (e) => this.onPaste(e));
  }
  savePrefs() { try { localStorage.setItem('ugs-paint', JSON.stringify({ o: this.o, primary: this.primary, secondary: this.secondary, recent: this.recent })); } catch (e) { /* modo privado */ } }
  get pixel() { return this.doc && this.doc.mode === 'pixel'; }
  setVisible(on) { this.visible = on; if (on) { if (!this.el) this.render(); this.loop(); } else { cancelAnimationFrame(this.raf); this.raf = 0; this.stopAnim(); } }

  /* ================================================================ documentos */
  async confirmDiscard() { return !this.doc || !this.doc.dirty || confirm('Cambios sin guardar', 'La imagen «' + this.doc.name + '» tiene cambios sin guardar en el proyecto. ¿Descartarlos?', 'Descartar', true); }
  async newDialog(mode) {
    if (!(await this.confirmDiscard())) return;
    let wI, hI, mSel, bgSel;
    const ok = await dialog('Nueva imagen', (b) => {
      mSel = h('select', h('option', { value: 'photo', selected: mode !== 'pixel' }, '📷 Foto / ilustración'), h('option', { value: 'pixel', selected: mode === 'pixel' }, '👾 Pixel art'));
      wI = h('input', { type: 'number', value: mode === 'pixel' ? 32 : 1024, min: 1, max: 8192 }); hI = h('input', { type: 'number', value: mode === 'pixel' ? 32 : 1024, min: 1, max: 8192 });
      bgSel = h('select', h('option', { value: '' }, 'Transparente'), h('option', { value: '#ffffff' }, 'Blanco'), h('option', { value: '#000000' }, 'Negro'), h('option', { value: 'secondary' }, 'Color secundario'));
      const presets = h('div.chips', SIZES.map(([w, hh]) => h('button.chip', { type: 'button', on: { click: () => { wI.value = w; hI.value = hh; } } }, w + '×' + hh)));
      b.appendChild(h('div.field', h('label', 'Tipo'), mSel)); b.appendChild(h('div.field', h('label', 'Ancho (px)'), wI)); b.appendChild(h('div.field', h('label', 'Alto (px)'), hI)); b.appendChild(presets); b.appendChild(h('div.field', h('label', 'Fondo'), bgSel));
    }, [{ label: 'Cancelar', value: null }, { label: 'Crear', kind: 'primary', value: true }]);
    if (!ok) return;
    const bg = bgSel.value === 'secondary' ? this.secondary : bgSel.value || null;
    this.setDoc(new PaintDoc(wI.value | 0 || 32, hI.value | 0 || 32, { mode: mSel.value, background: bg, name: 'imagen' }));
  }
  setDoc(doc) {
    this.stopAnim(); this.doc = doc; doc.dirty = false; this.edges = null;
    if (doc.mode === 'pixel' && TOOLS[this.tool].modes === 'photo') this.tool = 'pencil';
    if (doc.mode === 'pixel' && this.o.size > 8) this.o.size = 1;
    if (doc.mode === 'photo' && TOOLS[this.tool].modes === 'pixel') this.tool = 'brush';
    this.render(); requestAnimationFrame(() => this.fit());
  }
  async openAsset(id) {
    const ed = this.app.editor, a = ed.assetById(id); if (!a || a.type !== 'image') { toast('Elige una imagen', 'warn'); return; }
    if (/\.svg$/i.test(a.file)) { toast('Las imágenes SVG no se editan aquí (son vectoriales): se abrirán como una copia rasterizada.', 'warn', 5000); }
    if (!(await this.confirmDiscard())) return;
    try {
      const img = await loadImage(await ed.assetURL(a));
      const pixel = img.width <= 256 && img.height <= 256 || ed.project.settings.pixelArt;
      const fw = a.frameWidth > 0 ? a.frameWidth : 0, fh = a.frameHeight > 0 ? a.frameHeight : fw;
      let doc;
      if (fw && fh && (img.width > fw || img.height > fh)) {
        doc = new PaintDoc(fw, fh, { mode: pixel ? 'pixel' : 'photo', background: false, name: a.name, assetId: a.id });
        const cols = Math.floor(img.width / fw), rows = Math.floor(img.height / fh);
        for (let i = 0; i < Math.min(256, cols * rows); i++) { if (i > 0) doc.addFrame(false); ctx2d(doc.frames[i].cels[0]).drawImage(img, (i % cols) * fw, Math.floor(i / cols) * fh, fw, fh, 0, 0, fw, fh); }
        doc.frame = 0; doc.sheetCols = cols;
      } else {
        doc = new PaintDoc(img.width, img.height, { mode: pixel ? 'pixel' : 'photo', background: false, name: a.name, assetId: a.id });
        ctx2d(doc.cel).drawImage(img, 0, 0);
      }
      doc.layers[0].name = a.name;
      this.setDoc(doc);
      toast('Editando «' + a.name + '»' + (doc.frames.length > 1 ? ' (' + doc.frames.length + ' fotogramas)' : ''), 'ok');
    } catch (e) { toast('No se pudo abrir: ' + e.message, 'error'); }
  }
  async importFile(file) {
    if (!file || !/^image\//.test(file.type)) { toast('Elige una imagen (PNG, JPG, WebP, GIF)', 'warn'); return; }
    if (file.size > 64 * 1024 * 1024) { toast('Imagen demasiado grande', 'warn'); return; }
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      if (this.doc && await confirm('Importar imagen', '¿Añadirla como capa nueva en la imagen actual? (Cancelar = abrirla como imagen nueva)', 'Como capa')) this.pasteImage(img, file.name);
      else { if (!(await this.confirmDiscard())) return; const doc = new PaintDoc(img.width, img.height, { mode: img.width <= 256 && img.height <= 256 ? 'pixel' : 'photo', background: false, name: file.name.replace(/\.[^.]+$/, '') }); ctx2d(doc.cel).drawImage(img, 0, 0); this.setDoc(doc); }
    } catch (e) { toast('No se pudo leer la imagen', 'error'); }
    finally { URL.revokeObjectURL(url); }
  }
  pasteImage(img, name) {
    const d = this.doc; d.pushDoc('Pegar'); d.addLayer(name || 'Pegado');
    const g = ctx2d(d.cel), b = d.selection ? selectionBounds(d.selection) : null;
    g.drawImage(img, b ? b.x : Math.round((d.w - img.width) / 2), b ? b.y : Math.round((d.h - img.height) / 2));
    this.tool = 'move'; this.changed(true);
  }
  /** Imagen final: un fotograma = PNG; varios = hoja de sprites horizontal */
  output() {
    const d = this.doc, sheet = d.frames.length > 1, cols = sheet ? (d.sheetCols && d.sheetCols <= d.frames.length ? d.sheetCols : d.frames.length) : 1;
    return { canvas: sheet ? d.spritesheet(cols) : d.composite(), frameWidth: sheet ? d.w : 0, frameHeight: sheet ? d.h : 0 };
  }
  async saveToProject(asNew) {
    const ed = this.app.editor, d = this.doc; if (!d || !ed.project) return;
    const out = this.output(), blob = await canvasBlob(out.canvas, 'image/png');
    try {
      if (d.assetId && !asNew && ed.assetById(d.assetId)) {
        const a = ed.assetById(d.assetId);
        if (!/\.png$/i.test(a.file)) { toast('El recurso original no es PNG: se guarda como recurso nuevo.', 'warn'); return this.saveToProject(true); }
        await ed.replaceAsset(d.assetId, blob, { frameWidth: out.frameWidth, frameHeight: out.frameHeight });
        toast('Imagen «' + a.name + '» actualizada en el proyecto', 'ok');
      } else {
        const name = safeFileName(d.name || 'imagen') + '.png';
        const a = await ed.importFile(new File([blob], name, { type: 'image/png' }), name, { frameWidth: out.frameWidth, frameHeight: out.frameHeight, displayName: d.name });
        d.assetId = a.id; toast('Guardada como recurso «' + a.name + '»', 'ok');
      }
      d.dirty = false; this.renderBar();
    } catch (e) { toast('No se pudo guardar: ' + e.message, 'error'); }
  }
  async exportAs(kind) {
    const d = this.doc; if (!d) return;
    const base = safeFileName(d.name || 'imagen');
    if (kind === 'gif') {
      const frames = d.frames.map((fr) => ({ canvas: d.composite(fr), delay: fr.duration }));
      downloadBlob(new Blob([encodeGIF(frames, d.w, d.h, true)], { type: 'image/gif' }), base + '.gif'); return;
    }
    if (kind === 'sheet') { downloadBlob(await canvasBlob(d.spritesheet(d.frames.length), 'image/png'), base + '-hoja.png'); return; }
    if (kind === 'frames') { for (let i = 0; i < d.frames.length; i++) downloadBlob(await canvasBlob(d.composite(d.frames[i]), 'image/png'), base + '-' + String(i + 1).padStart(2, '0') + '.png'); return; }
    let scale = 1;
    if (kind === 'png-x') { const v = await pick('Exportar ampliado', 'Escala (píxeles nítidos)', ['2', '4', '8', '16']); if (!v) return; scale = +v; kind = 'png'; }
    const src = d.composite(), c = scale > 1 ? makeCanvas(d.w * scale, d.h * scale) : src;
    if (scale > 1) { const g = ctx2d(c); g.imageSmoothingEnabled = false; g.drawImage(src, 0, 0, c.width, c.height); }
    const type = kind === 'jpg' ? 'image/jpeg' : kind === 'webp' ? 'image/webp' : 'image/png';
    let cc = c; if (type === 'image/jpeg') { cc = makeCanvas(c.width, c.height); const g = ctx2d(cc); g.fillStyle = this.secondary; g.fillRect(0, 0, c.width, c.height); g.drawImage(c, 0, 0); }
    downloadBlob(await canvasBlob(cc, type, 0.92), base + (scale > 1 ? '@' + scale + 'x' : '') + '.' + (kind === 'jpg' ? 'jpg' : kind));
  }

  /* ================================================================ cambios y vista */
  changed(structure) { if (this.doc) this.doc.dirty = true; this.dirtyView = true; if (structure) { this.renderLayers(); this.renderFrames(); } else this.thumbsSoon(); this.renderBar(); }
  thumbsSoon() { clearTimeout(this._th); this._th = setTimeout(() => { this.renderLayers(); this.renderFrames(); }, 250); }
  loop() {
    cancelAnimationFrame(this.raf);
    const tick = (t) => {
      if (!this.visible) return;
      if (this.doc && this.doc.selection && t - this.ant > 120) { this.ant = t; this.antOff = ((this.antOff || 0) + 1) % 8; this.dirtyView = true; }
      if (this.playing) this.stepAnim(t);
      if (this.dirtyView) { this.dirtyView = false; this.draw(); }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  fit() {
    const d = this.doc, c = this.canvas; if (!d || !c) return;
    const W = c.clientWidth, H = c.clientHeight; if (!W || !H) return;
    let z = Math.min((W - 40) / d.w, (H - 40) / d.h);
    if (this.pixel) z = Math.max(1, Math.floor(z)); else z = z >= 1 ? Math.min(8, Math.floor(z)) : z;
    this.view.z = Math.max(0.01, Math.min(64, z)); this.view.x = Math.round((W - d.w * this.view.z) / 2); this.view.y = Math.round((H - d.h * this.view.z) / 2);
    this.dirtyView = true; this.renderStatus();
  }
  zoomAt(k, sx, sy) {
    const v = this.view, z0 = v.z; let z = Math.max(0.02, Math.min(80, z0 * k));
    if (this.pixel && z >= 1) z = k > 1 ? Math.ceil(z) : Math.floor(z) || 1;
    if (sx === undefined) { sx = this.canvas.clientWidth / 2; sy = this.canvas.clientHeight / 2; }
    v.x = sx - (sx - v.x) * z / z0; v.y = sy - (sy - v.y) * z / z0; v.z = z;
    this.dirtyView = true; this.renderStatus();
  }
  zoomTo(z) { this.zoomAt(z / this.view.z); }
  toDoc(e) { const r = this.canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - this.view.x) / this.view.z, y: (e.clientY - r.top - this.view.y) / this.view.z, sx: e.clientX - r.left, sy: e.clientY - r.top }; }
  draw() {
    const c = this.canvas, d = this.doc; if (!c) return;
    const dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = getComputedStyle(c).getPropertyValue('--paint-bg') || '#1a1d29'; g.fillRect(0, 0, W, H);
    if (!d) return;
    const v = this.view, dw = d.w * v.z, dh = d.h * v.z;
    // tablero de transparencia
    if (!this.checker) { const pc = makeCanvas(16, 16), pg = ctx2d(pc); pg.fillStyle = '#f1f2f6'; pg.fillRect(0, 0, 16, 16); pg.fillStyle = '#c9ccd6'; pg.fillRect(0, 0, 8, 8); pg.fillRect(8, 8, 8, 8); this.checker = g.createPattern(pc, 'repeat'); }
    g.fillStyle = this.checker; g.fillRect(Math.max(0, v.x), Math.max(0, v.y), Math.min(W, v.x + dw) - Math.max(0, v.x), Math.min(H, v.y + dh) - Math.max(0, v.y));
    g.imageSmoothingEnabled = !this.pixel && v.z < 1.5; g.imageSmoothingQuality = 'high';
    const comp = this.comp = d.composite(null, true, this.comp && this.comp.width === d.w && this.comp.height === d.h ? this.comp : null);
    if (this.show.tile && this.pixel) { g.globalAlpha = 0.45; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (i || j) g.drawImage(comp, v.x + i * dw, v.y + j * dh, dw, dh); g.globalAlpha = 1; }
    if (this.show.onion && d.frames.length > 1 && !this.playing) {
      [d.frame - 1, d.frame + 1].forEach((f) => { if (f < 0 || f >= d.frames.length) return; g.globalAlpha = 0.28; g.drawImage(d.composite(d.frames[f]), v.x, v.y, dw, dh); });
      g.globalAlpha = 1;
    }
    g.drawImage(this.playing ? d.composite(d.frames[this.animFrame || 0]) : comp, v.x, v.y, dw, dh);
    // rejillas
    if (this.pixel && this.show.pixelGrid && v.z >= 6) { g.strokeStyle = 'rgba(0,0,0,0.13)'; g.lineWidth = 1; g.beginPath(); for (let x = 0; x <= d.w; x++) { const X = Math.round(v.x + x * v.z) + 0.5; g.moveTo(X, v.y); g.lineTo(X, v.y + dh); } for (let y = 0; y <= d.h; y++) { const Y = Math.round(v.y + y * v.z) + 0.5; g.moveTo(v.x, Y); g.lineTo(v.x + dw, Y); } g.stroke(); }
    if (this.show.grid && this.show.gridSize * v.z >= 4) { const s = this.show.gridSize; g.strokeStyle = 'rgba(80,120,255,0.45)'; g.beginPath(); for (let x = 0; x <= d.w; x += s) { const X = Math.round(v.x + x * v.z) + 0.5; g.moveTo(X, v.y); g.lineTo(X, v.y + dh); } for (let y = 0; y <= d.h; y += s) { const Y = Math.round(v.y + y * v.z) + 0.5; g.moveTo(v.x, Y); g.lineTo(v.x + dw, Y); } g.stroke(); }
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.strokeRect(Math.round(v.x) - 0.5, Math.round(v.y) - 0.5, Math.round(dw) + 1, Math.round(dh) + 1);
    // simetría
    if (this.pixel && (this.o.symX || this.o.symY)) { g.strokeStyle = 'rgba(255,80,200,0.8)'; g.setLineDash([4, 4]); g.beginPath(); if (this.o.symX) { g.moveTo(v.x + dw / 2, v.y); g.lineTo(v.x + dw / 2, v.y + dh); } if (this.o.symY) { g.moveTo(v.x, v.y + dh / 2); g.lineTo(v.x + dw, v.y + dh / 2); } g.stroke(); g.setLineDash([]); }
    // selección
    if (d.selection) {
      if (!this.edges) this.edges = selectionEdges(d.selection);
      const E = this.edges; g.lineWidth = 1;
      [['#000', 0], ['#fff', 4]].forEach(([col, off]) => { g.strokeStyle = col; g.setLineDash([4, 4]); g.lineDashOffset = -(this.antOff || 0) + off; g.beginPath(); for (let i = 0; i < E.length; i += 4) { g.moveTo(Math.round(v.x + E[i] * v.z) + 0.5, Math.round(v.y + E[i + 1] * v.z) + 0.5); g.lineTo(Math.round(v.x + E[i + 2] * v.z) + 0.5, Math.round(v.y + E[i + 3] * v.z) + 0.5); } g.stroke(); });
      g.setLineDash([]);
    }
    if (this.preview) this.preview(g, v);
    // cursor del pincel
    if (this.hoverPt && ['brush', 'eraser', 'clone', 'smudge', 'blurBrush', 'dodge', 'pencil', 'dither', 'shade'].includes(this.tool)) {
      const s = this.brushSize(), p = this.hoverPt;
      g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1;
      if (this.pixel || this.tool === 'pencil') { const x0 = Math.floor(p.x - (s - 1) / 2), y0 = Math.floor(p.y - (s - 1) / 2); g.strokeRect(v.x + x0 * v.z + 0.5, v.y + y0 * v.z + 0.5, s * v.z - 1, s * v.z - 1); g.strokeStyle = 'rgba(0,0,0,0.6)'; g.strokeRect(v.x + x0 * v.z - 0.5, v.y + y0 * v.z - 0.5, s * v.z + 1, s * v.z + 1); }
      else { g.beginPath(); g.arc(v.x + p.x * v.z, v.y + p.y * v.z, Math.max(1.5, s / 2 * v.z), 0, Math.PI * 2); g.stroke(); g.strokeStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.arc(v.x + p.x * v.z, v.y + p.y * v.z, Math.max(1.5, s / 2 * v.z) + 1, 0, Math.PI * 2); g.stroke(); }
    }
    if (this.cloneSrc && this.tool === 'clone') { const p = this.cloneSrc; g.strokeStyle = '#ff6'; g.beginPath(); g.moveTo(v.x + p.x * v.z - 6, v.y + p.y * v.z); g.lineTo(v.x + p.x * v.z + 6, v.y + p.y * v.z); g.moveTo(v.x + p.x * v.z, v.y + p.y * v.z - 6); g.lineTo(v.x + p.x * v.z, v.y + p.y * v.z + 6); g.stroke(); }
    if (this.miniCanvas) this.drawMini();
  }

  /* ================================================================ herramientas */
  brushSize() { return Math.max(1, Math.round(this.pixel && this.tool !== 'eraser' && this.o.size > 64 ? 1 : this.o.size)); }
  colorWithAlpha(hex, a) { const [r, g, b] = hexToRgb(hex); return 'rgba(' + r + ',' + g + ',' + b + ',' + (a === undefined ? this.alpha : a) + ')'; }
  pushRecent(c) { this.recent = [c].concat(this.recent.filter((x) => x !== c)).slice(0, 16); this.savePrefs(); this.renderColors(); }
  locked() { if (this.doc.curLayer.locked) { toast('La capa está bloqueada 🔒', 'warn'); return true; } if (!this.doc.curLayer.visible) { toast('La capa está oculta', 'warn'); return true; } return false; }
  onDown(e) {
    const d = this.doc; if (!d) return;
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.toDoc(e);
    if (e.button === 1 || this.space || this.tool === 'hand') { this.drag = { kind: 'pan', sx: p.sx, sy: p.sy, vx: this.view.x, vy: this.view.y }; return; }
    if (this.tool === 'zoom') { this.zoomAt(e.altKey || e.button === 2 ? 0.5 : 2, p.sx, p.sy); return; }
    const right = e.button === 2, alt = e.altKey;
    if (this.tool === 'picker' || (alt && ['brush', 'pencil', 'bucket', 'dither'].includes(this.tool))) { this.pick(p, right); this.drag = { kind: 'pick', right }; return; }
    const selTool = ['marquee', 'ellipseSel', 'lasso', 'wand', 'crop'].includes(this.tool);
    if (!selTool && this.tool !== 'hand' && this.locked()) return;
    const mode = e.shiftKey ? 'add' : alt ? 'sub' : (e.ctrlKey || e.metaKey) && e.shiftKey ? 'inter' : this.o.selMode;
    const color = right ? this.secondary : this.primary;
    this.stroke = null;
    switch (this.tool) {
      case 'brush': case 'eraser': case 'pencil': case 'clone': case 'dither': case 'shade': case 'smudge': case 'blurBrush': case 'dodge':
        if (this.tool === 'clone' && alt) { this.cloneSrc = { x: p.x, y: p.y }; this.cloneOff = null; toast('Origen del tampón fijado'); return; }
        if (this.tool === 'clone' && !this.cloneSrc) { toast('Alt+clic para elegir el origen del tampón', 'warn'); return; }
        this.beginStroke(p, color, e, right || (alt && (this.tool === 'blurBrush' || this.tool === 'dodge')));
        return;
      case 'bucket': this.fill(p, color); return;
      case 'replace': this.replaceColor(p, color); return;
      case 'wand': {
        const x = Math.floor(p.x), y = Math.floor(p.y); if (x < 0 || y < 0 || x >= d.w || y >= d.h) return;
        const src = this.o.sampleAll ? this.comp : d.cel, m = floodMask(ctx2d(src).getImageData(0, 0, d.w, d.h), x, y, this.o.tol, this.o.contiguous);
        const mc = maskToCanvas(m, d.w, d.h); combineSelection(d, (g) => g.drawImage(mc, 0, 0), mode); this.edges = null; this.dirtyView = true; this.renderStatus(); return;
      }
      case 'text': this.textAt(p, color); return;
      case 'move': this.beginMove(p); return;
      default: this.drag = { kind: this.tool, p0: p, p1: p, mode, color, pts: [p] };
    }
  }
  onMove(e) {
    const p = this.toDoc(e); this.hoverPt = p; this.renderStatus(p);
    const dr = this.drag;
    if (!dr && !this.stroke) { this.dirtyView = true; return; }
    if (this.stroke) {
      // eventos agrupados (trazos suaves a alta frecuencia); algunos navegadores devuelven una lista vacía
      let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null; if (!evs || !evs.length) evs = [e];
      evs.forEach((ev) => this.strokeTo(this.toDoc(ev), ev)); this.dirtyView = true; return;
    }
    if (dr.kind === 'pan') { this.view.x = dr.vx + p.sx - dr.sx; this.view.y = dr.vy + p.sy - dr.sy; this.dirtyView = true; return; }
    if (dr.kind === 'pick') { this.pick(p, dr.right); return; }
    if (dr.kind === 'moving') { this.moveTo(p, e.shiftKey); return; }
    dr.p1 = p; if (dr.kind === 'lasso') dr.pts.push(p);
    if (e.shiftKey && ['marquee', 'ellipseSel', 'rect', 'ellipse', 'crop'].includes(dr.kind)) { const s = Math.max(Math.abs(p.x - dr.p0.x), Math.abs(p.y - dr.p0.y)); dr.p1 = { x: dr.p0.x + Math.sign(p.x - dr.p0.x || 1) * s, y: dr.p0.y + Math.sign(p.y - dr.p0.y || 1) * s }; }
    if (e.shiftKey && dr.kind === 'line') { const dx = p.x - dr.p0.x, dy = p.y - dr.p0.y, a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, l = Math.hypot(dx, dy); dr.p1 = { x: dr.p0.x + Math.cos(a) * l, y: dr.p0.y + Math.sin(a) * l }; }
    this.preview = (g, v) => this.drawDragPreview(g, v, dr);
    this.dirtyView = true;
  }
  onUp(e) {
    try { this.canvas.releasePointerCapture(e.pointerId); } catch (x) { /* ya liberado */ }
    if (this.stroke) { this.endStroke(); return; }
    const dr = this.drag; this.drag = null; this.preview = null; this.dirtyView = true;
    if (!dr) return;
    if (dr.kind === 'pick' && dr.right === false) this.pushRecent(this.primary);
    if (dr.kind === 'moving') { this.endMove(); return; }
    const d = this.doc, r = normRect(dr.p0, dr.p1, this.pixel);
    const tiny = Math.abs(dr.p1.x - dr.p0.x) < 1 && Math.abs(dr.p1.y - dr.p0.y) < 1;
    switch (dr.kind) {
      case 'marquee': case 'ellipseSel':
        if (tiny) { if (dr.mode === 'new') { d.selection = null; this.edges = null; } break; }
        combineSelection(d, (g) => { if (dr.kind === 'marquee') g.fillRect(r.x, r.y, r.w, r.h); else { g.beginPath(); g.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); g.fill(); } }, dr.mode); this.edges = null; break;
      case 'lasso':
        if (dr.pts.length < 3) { if (dr.mode === 'new') { d.selection = null; this.edges = null; } break; }
        combineSelection(d, (g) => { g.beginPath(); dr.pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath(); g.fill(); }, dr.mode); this.edges = null; break;
      case 'crop': if (!tiny) { this.cropRect = r; this.renderOpts(); this.preview = (g, v) => this.drawCropPreview(g, v); } break;
      case 'line': case 'rect': case 'ellipse': this.commitShape(dr); break;
      case 'gradient': if (!tiny) this.commitGradient(dr); break;
    }
    this.renderStatus();
  }
  /* ---------------- trazos */
  beginStroke(p, color, e, alt) {
    const d = this.doc, t = this.tool;
    d.pushCel(TOOLS[t].label.replace(/ \(.*/, ''));
    const base = makeCanvas(d.w, d.h); ctx2d(base).drawImage(d.cel, 0, 0);
    this.stroke = { tool: t, color, alt, base, buf: makeCanvas(d.w, d.h), last: null, dist: 0, plotted: new Set(), pts: [], dirty: null };
    if (t === 'brush' || t === 'eraser' || t === 'clone') this.stroke.tip = this.makeTip(color, t === 'eraser' || t === 'clone');
    if (t === 'clone') { if (!this.cloneOff) this.cloneOff = { x: this.cloneSrc.x - p.x, y: this.cloneSrc.y - p.y }; }
    this.strokeTo(p, e, true);
  }
  makeTip(color, white) {
    const s = Math.max(1, Math.round(this.o.size)), c = makeCanvas(s + 2, s + 2), g = ctx2d(c), r = s / 2, cx = (s + 2) / 2;
    const [R, G, B] = white ? [255, 255, 255] : hexToRgb(color), hard = Math.max(0, Math.min(0.99, this.o.hardness));
    if (s <= 2) { g.fillStyle = 'rgb(' + R + ',' + G + ',' + B + ')'; g.fillRect(1, 1, s, s); return c; }
    const gr = g.createRadialGradient(cx, cx, 0, cx, cx, r);
    gr.addColorStop(0, 'rgba(' + R + ',' + G + ',' + B + ',1)'); gr.addColorStop(hard, 'rgba(' + R + ',' + G + ',' + B + ',1)'); gr.addColorStop(1, 'rgba(' + R + ',' + G + ',' + B + ',0)');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.fill();
    return c;
  }
  strokeTo(p, e, first) {
    const st = this.stroke, d = this.doc, t = st.tool;
    const pr = e && e.pointerType === 'pen' && this.o.pressure ? Math.max(0.05, e.pressure || 0.5) : 1;
    if (this.pixel || t === 'pencil' || t === 'dither' || t === 'shade') { this.pixelStroke(p, first); return; }
    const size = Math.max(1, this.o.size * (t === 'brush' || t === 'eraser' ? pr : 1)), step = Math.max(0.5, size * this.o.spacing);
    // sellos cada «step» píxeles a lo largo del recorrido; st.dist = distancia recorrida desde el último sello
    const from = st.last || p, dx = p.x - from.x, dy = p.y - from.y, len = Math.hypot(dx, dy);
    const stamps = [];
    if (first) { stamps.push(p); st.dist = 0; }
    else if (len > 0) {
      let pos = step - st.dist;
      while (pos <= len) { stamps.push({ x: from.x + dx * pos / len, y: from.y + dy * pos / len }); pos += step; }
      st.dist = len - (pos - step);
    }
    st.last = p;
    const g = ctx2d(st.buf), s = Math.max(1, Math.round(size));
    stamps.forEach((q) => {
      const r = s / 2 + 1; this.grow(st, q.x - r, q.y - r, r * 2, r * 2);
      if (t === 'brush' || t === 'eraser') { g.globalAlpha = this.o.flow * (t === 'brush' && pr < 1 ? 0.5 + pr / 2 : 1); g.drawImage(st.tip, q.x - (st.tip.width / 2) * (s / Math.max(1, st.tip.width - 2)), q.y - (st.tip.height / 2) * (s / Math.max(1, st.tip.height - 2)), st.tip.width * s / Math.max(1, st.tip.width - 2), st.tip.height * s / Math.max(1, st.tip.height - 2)); g.globalAlpha = 1; }
      else if (t === 'clone') this.cloneStamp(st, q, s);
      else if (t === 'smudge') this.smudgeStamp(st, q, s);
      else if (t === 'blurBrush') this.filterStamp(q, s, st.alt ? 'sharpen' : 'blur');
      else if (t === 'dodge') this.filterStamp(q, s, st.alt ? 'burn' : 'dodge');
    });
    if (t === 'brush' || t === 'eraser' || t === 'clone') this.composeStroke();
  }
  grow(st, x, y, w, hh) { const r = st.dirty; if (!r) st.dirty = { x0: x, y0: y, x1: x + w, y1: y + hh }; else { r.x0 = Math.min(r.x0, x); r.y0 = Math.min(r.y0, y); r.x1 = Math.max(r.x1, x + w); r.y1 = Math.max(r.y1, y + hh); } }
  /** Cel = base + trazo (con la opacidad del trazo, recortado a la selección y respetando el bloqueo de alfa) */
  composeStroke() {
    const st = this.stroke, d = this.doc, r = st.dirty; if (!r) return;
    const x = Math.max(0, Math.floor(r.x0)), y = Math.max(0, Math.floor(r.y0)), w = Math.min(d.w, Math.ceil(r.x1)) - x, hh = Math.min(d.h, Math.ceil(r.y1)) - y; if (w <= 0 || hh <= 0) return;
    let src = st.buf;
    if (d.selection) { const tmp = this._tmp = this._tmp && this._tmp.width === d.w && this._tmp.height === d.h ? this._tmp : makeCanvas(d.w, d.h), tg = ctx2d(tmp); tg.clearRect(x, y, w, hh); tg.drawImage(st.buf, x, y, w, hh, x, y, w, hh); tg.globalCompositeOperation = 'destination-in'; tg.drawImage(d.selection, x, y, w, hh, x, y, w, hh); tg.globalCompositeOperation = 'source-over'; src = tmp; }
    const g = ctx2d(d.cel);
    g.save(); g.beginPath(); g.rect(x, y, w, hh); g.clip(); g.clearRect(x, y, w, hh); g.drawImage(st.base, 0, 0);
    g.globalAlpha = this.o.opacity; g.globalCompositeOperation = st.tool === 'eraser' ? 'destination-out' : d.curLayer.alphaLock ? 'source-atop' : 'source-over';
    g.drawImage(src, 0, 0); g.restore();
  }
  cloneStamp(st, q, s) {
    const off = this.cloneOff, sx = q.x + off.x, sy = q.y + off.y, r = s / 2;
    const tmp = makeCanvas(s + 2, s + 2), tg = ctx2d(tmp);
    tg.drawImage(st.base, sx - r - 1, sy - r - 1, s + 2, s + 2, 0, 0, s + 2, s + 2);
    tg.globalCompositeOperation = 'destination-in'; tg.drawImage(st.tip, 0, 0, s + 2, s + 2);
    const g = ctx2d(st.buf); g.globalAlpha = this.o.flow; g.drawImage(tmp, q.x - r - 1, q.y - r - 1); g.globalAlpha = 1;
  }
  smudgeStamp(st, q, s) {
    const d = this.doc, g = ctx2d(d.cel), r = s / 2, prev = st.prevQ || q; st.prevQ = q;
    const tip = st.softTip || (st.softTip = this.makeTip('#ffffff', true));
    const tmp = makeCanvas(s + 2, s + 2), tg = ctx2d(tmp);
    tg.drawImage(d.cel, prev.x - r - 1, prev.y - r - 1, s + 2, s + 2, 0, 0, s + 2, s + 2);
    tg.globalCompositeOperation = 'destination-in'; tg.drawImage(tip, 0, 0, s + 2, s + 2);
    g.save(); if (d.selection) { g.beginPath(); const b = selectionBounds(d.selection); if (b) g.rect(b.x, b.y, b.w, b.h); g.clip(); }
    g.globalAlpha = this.o.strength; g.globalCompositeOperation = d.curLayer.alphaLock ? 'source-atop' : 'source-over'; g.drawImage(tmp, q.x - r - 1, q.y - r - 1); g.restore();
  }
  filterStamp(q, s, kind) {
    const d = this.doc, r = Math.ceil(s / 2) + 2, x = Math.max(0, Math.floor(q.x - r)), y = Math.max(0, Math.floor(q.y - r)), w = Math.min(d.w, Math.ceil(q.x + r)) - x, hh = Math.min(d.h, Math.ceil(q.y + r)) - y;
    if (w <= 0 || hh <= 0) return;
    const g = ctx2d(d.cel), img = g.getImageData(x, y, w, hh), orig = new Uint8ClampedArray(img.data), k = this.o.strength;
    let out = img;
    if (kind === 'blur') out = blurImg(img, 2);
    else if (kind === 'sharpen') out = FILTERS.sharpen.apply(img, { a: 60, r: 1 });
    const o = out.data, sel = d.selection ? ctx2d(d.selection).getImageData(x, y, w, hh).data : null;
    for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) {
      const dist = Math.hypot(x + i + 0.5 - q.x, y + j + 0.5 - q.y) / (s / 2); if (dist > 1) { const p0 = (j * w + i) * 4; o[p0] = orig[p0]; o[p0 + 1] = orig[p0 + 1]; o[p0 + 2] = orig[p0 + 2]; o[p0 + 3] = orig[p0 + 3]; continue; }
      const p = (j * w + i) * 4, wgt = (1 - dist * dist) * k * (sel ? sel[p + 3] / 255 : 1);
      if (kind === 'dodge' || kind === 'burn') { for (let c = 0; c < 3; c++) { const v = orig[p + c], t = kind === 'dodge' ? v + (255 - v) * 0.25 : v * 0.75; o[p + c] = v + (t - v) * wgt; } o[p + 3] = orig[p + 3]; }
      else for (let c = 0; c < 4; c++) o[p + c] = orig[p + c] + (o[p + c] - orig[p + c]) * wgt;
    }
    g.putImageData(out, x, y);
  }
  /** Lápiz, borrador, tramado y sombreado en modo píxel (con simetría y píxel perfecto) */
  pixelStroke(p, first) {
    const st = this.stroke, d = this.doc, g = ctx2d(d.cel), t = st.tool, s = this.brushSize(), sel = d.selection ? ctx2d(d.selection) : null;
    const selData = sel ? (st.selData || (st.selData = sel.getImageData(0, 0, d.w, d.h).data)) : null;
    const baseData = st.baseData || (st.baseData = ctx2d(st.base).getImageData(0, 0, d.w, d.h).data);
    const [pr, pg, pb] = hexToRgb(st.color), [sr, sg, sb] = hexToRgb(this.secondary);
    const plot1 = (x, y) => {
      if (x < 0 || y < 0 || x >= d.w || y >= d.h) return;
      if (selData && selData[(y * d.w + x) * 4 + 3] < 128) return;
      const key = y * d.w + x; if (st.plotted.has(key) && t !== 'eraser') return; st.plotted.add(key);
      const bi = key * 4;
      if (d.curLayer.alphaLock && baseData[bi + 3] === 0) return;
      if (t === 'eraser') { g.clearRect(x, y, 1, 1); return; }
      let col;
      if (t === 'dither') { const on = bayer(x, y) < this.o.ditherLevel / 16; if (!on && this.o.ditherTransparent) { return; } col = on ? [pr, pg, pb] : [sr, sg, sb]; }
      else if (t === 'shade') { if (!baseData[bi + 3]) return; col = this.shadeColor(baseData[bi], baseData[bi + 1], baseData[bi + 2], st.alt); }
      else col = [pr, pg, pb];
      if (t === 'shade') { g.clearRect(x, y, 1, 1); g.fillStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + baseData[bi + 3] / 255 + ')'; }
      else g.fillStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + this.alpha * this.o.opacity + ')';
      g.fillRect(x, y, 1, 1);
    };
    // bloque entero de una vez (lápiz/borrador grandes sin selección ni bloqueo): mucho más rápido que píxel a píxel
    const fast = (t === 'pencil' || t === 'eraser') && s > 1 && !selData && !d.curLayer.alphaLock;
    const plotBrush = (cx, cy) => {
      const x0 = Math.floor(cx - (s - 1) / 2), y0 = Math.floor(cy - (s - 1) / 2);
      const pts = [[x0, y0]];
      if (this.o.symX) pts.push([d.w - s - x0, y0]);
      if (this.o.symY) pts.push([x0, d.h - s - y0]);
      if (this.o.symX && this.o.symY) pts.push([d.w - s - x0, d.h - s - y0]);
      pts.forEach(([ax, ay]) => {
        if (fast) { if (t === 'eraser') g.clearRect(ax, ay, s, s); else { g.fillStyle = 'rgba(' + pr + ',' + pg + ',' + pb + ',' + this.alpha * this.o.opacity + ')'; g.fillRect(ax, ay, s, s); } return; }
        for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) plot1(ax + i, ay + j);
      });
    };
    const cur = { x: Math.floor(p.x), y: Math.floor(p.y) };
    if (first || !st.lastPx) { plotBrush(cur.x, cur.y); st.lastPx = cur; st.pts = [cur]; return; }
    const prev = st.lastPx; if (prev.x === cur.x && prev.y === cur.y) return;
    bresenham(prev.x, prev.y, cur.x, cur.y, (x, y) => {
      const L = st.pts[st.pts.length - 1]; if (L && L.x === x && L.y === y) return;
      // píxel perfecto: quita las esquinas en L (se restaura el píxel de debajo)
      if (this.o.pixelPerfect && s === 1 && t !== 'eraser' && st.pts.length >= 2) {
        const A = st.pts[st.pts.length - 2], B = L;
        if (Math.abs(A.x - x) === 1 && Math.abs(A.y - y) === 1 && ((B.x === A.x && B.y === y) || (B.y === A.y && B.x === x))) {
          const keys = [[B.x, B.y]];
          if (this.o.symX) keys.push([d.w - 1 - B.x, B.y]); if (this.o.symY) keys.push([B.x, d.h - 1 - B.y]); if (this.o.symX && this.o.symY) keys.push([d.w - 1 - B.x, d.h - 1 - B.y]);
          keys.forEach(([kx, ky]) => { const k = ky * d.w + kx, bi = k * 4; st.plotted.delete(k); g.clearRect(kx, ky, 1, 1); g.putImageData(new ImageData(new Uint8ClampedArray([baseData[bi], baseData[bi + 1], baseData[bi + 2], baseData[bi + 3]]), 1, 1), kx, ky); });
          st.pts.pop();
        }
      }
      plotBrush(x, y); st.pts.push({ x, y });
    });
    st.lastPx = cur;
  }
  shadeColor(r, g, b, darken) {
    // si el color está en la paleta, salta al vecino más claro/oscuro de la paleta; si no, cambia la luminosidad
    const pal = this.palette.map(hexToRgb), lum = (c) => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114, i = pal.findIndex((c) => c[0] === r && c[1] === g && c[2] === b);
    if (i >= 0) {
      const L = lum(pal[i]); let best = null, bd = Infinity;
      pal.forEach((c) => { const dl = lum(c) - L; if (darken ? dl >= -1 : dl <= 1) return; const [h1] = rgbToHsl(c[0], c[1], c[2]), [h0] = rgbToHsl(r, g, b), score = Math.abs(dl) + Math.min(Math.abs(h1 - h0), 1 - Math.abs(h1 - h0)) * 300; if (score < bd) { bd = score; best = c; } });
      if (best) return best;
    }
    const [hh, ss, ll] = rgbToHsl(r, g, b), c = hslToRgb(hh, ss, Math.max(0, Math.min(1, ll + (darken ? -1 : 1) * this.o.shadeAmt / 100)));
    return c.map(Math.round);
  }
  endStroke() {
    const st = this.stroke; this.stroke = null;
    if (st && st.tool !== 'eraser' && st.tool !== 'shade' && st.tool !== 'smudge' && st.tool !== 'blurBrush' && st.tool !== 'dodge' && st.tool !== 'clone') this.pushRecent(st.color);
    this.changed();
  }
  /* ---------------- relleno, reemplazo, cuentagotas */
  fill(p, color) {
    const d = this.doc, x = Math.floor(p.x), y = Math.floor(p.y); if (x < 0 || y < 0 || x >= d.w || y >= d.h) return;
    d.pushCel('Bote de pintura');
    const g = ctx2d(d.cel), img = g.getImageData(0, 0, d.w, d.h), src = this.o.sampleAll ? ctx2d(this.comp).getImageData(0, 0, d.w, d.h) : img;
    const m = floodMask(src, x, y, this.o.tol, this.o.contiguous), sel = d.selection ? ctx2d(d.selection).getImageData(0, 0, d.w, d.h).data : null;
    const [r, gg, b] = hexToRgb(color), a = Math.round(255 * this.alpha * this.o.opacity), D = img.data, lock = d.curLayer.alphaLock;
    for (let i = 0; i < m.length; i++) {
      if (!m[i]) continue; const q = i * 4; if (sel && sel[q + 3] < 128) continue; if (lock && !D[q + 3]) continue;
      if (a >= 255) { D[q] = r; D[q + 1] = gg; D[q + 2] = b; D[q + 3] = 255; }
      else { const k = a / 255, oa = D[q + 3] / 255, na = k + oa * (1 - k); D[q] = (r * k + D[q] * oa * (1 - k)) / (na || 1); D[q + 1] = (gg * k + D[q + 1] * oa * (1 - k)) / (na || 1); D[q + 2] = (b * k + D[q + 2] * oa * (1 - k)) / (na || 1); D[q + 3] = na * 255; }
    }
    g.putImageData(img, 0, 0); this.pushRecent(color); this.changed();
  }
  replaceColor(p, color) {
    const d = this.doc, x = Math.floor(p.x), y = Math.floor(p.y); if (x < 0 || y < 0 || x >= d.w || y >= d.h) return;
    const px = ctx2d(d.cel).getImageData(x, y, 1, 1).data, from = rgbToHex(px[0], px[1], px[2]);
    d.pushDoc('Reemplazar color');
    d.frames.forEach((fr) => { const g = ctx2d(fr.cels[d.layer]), img = g.getImageData(0, 0, d.w, d.h); FILTERS.replace.apply(img, { from, to: color, t: this.o.tol / 3 }); g.putImageData(img, 0, 0); });
    this.changed(true);
  }
  pick(p, secondary) {
    const d = this.doc, x = Math.floor(p.x), y = Math.floor(p.y); if (x < 0 || y < 0 || x >= d.w || y >= d.h) return;
    const px = ctx2d(this.o.sampleAll || this.tool === 'picker' ? (this.comp || d.composite()) : d.cel).getImageData(x, y, 1, 1).data;
    if (!px[3]) return;
    const c = rgbToHex(px[0], px[1], px[2]);
    if (secondary) this.secondary = c; else { this.primary = c; this.alpha = px[3] / 255; }
    this.renderColors();
  }
  /* ---------------- mover */
  beginMove(p) {
    const d = this.doc; d.pushCel('Mover');
    const base = makeCanvas(d.w, d.h); ctx2d(base).drawImage(d.cel, 0, 0);
    let floating = base, hole = null;
    if (d.selection) {
      floating = makeCanvas(d.w, d.h); const fg = ctx2d(floating); fg.drawImage(base, 0, 0); fg.globalCompositeOperation = 'destination-in'; fg.drawImage(d.selection, 0, 0);
      hole = makeCanvas(d.w, d.h); const hg = ctx2d(hole); hg.drawImage(base, 0, 0); hg.globalCompositeOperation = 'destination-out'; hg.drawImage(d.selection, 0, 0);
    }
    this.drag = { kind: 'moving', p0: p, floating, hole, sel0: d.selection, dx: 0, dy: 0 };
  }
  moveTo(p, axis) {
    const d = this.doc, dr = this.drag; let dx = p.x - dr.p0.x, dy = p.y - dr.p0.y;
    if (axis) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    dx = Math.round(dx); dy = Math.round(dy); if (dx === dr.dx && dy === dr.dy) return; dr.dx = dx; dr.dy = dy;
    const g = ctx2d(d.cel); g.clearRect(0, 0, d.w, d.h); if (dr.hole) g.drawImage(dr.hole, 0, 0); g.drawImage(dr.floating, dx, dy);
    if (dr.sel0) { const m = makeCanvas(d.w, d.h); ctx2d(m).drawImage(dr.sel0, dx, dy); d.selection = m; this.edges = null; }
    this.dirtyView = true;
  }
  endMove() { this.changed(); }
  /* ---------------- formas y degradados */
  drawDragPreview(g, v, dr) {
    const r = normRect(dr.p0, dr.p1, this.pixel), X = (x) => v.x + x * v.z, Y = (y) => v.y + y * v.z;
    g.save(); g.lineWidth = 1;
    if (dr.kind === 'lasso') { g.strokeStyle = '#fff'; g.setLineDash([4, 3]); g.beginPath(); dr.pts.forEach((q, i) => (i ? g.lineTo(X(q.x), Y(q.y)) : g.moveTo(X(q.x), Y(q.y)))); g.stroke(); }
    else if (dr.kind === 'marquee' || dr.kind === 'crop') { g.strokeStyle = '#fff'; g.setLineDash([5, 4]); g.strokeRect(X(r.x) + 0.5, Y(r.y) + 0.5, r.w * v.z, r.h * v.z); }
    else if (dr.kind === 'ellipseSel') { g.strokeStyle = '#fff'; g.setLineDash([5, 4]); g.beginPath(); g.ellipse(X(r.x + r.w / 2), Y(r.y + r.h / 2), Math.max(0.5, r.w * v.z / 2), Math.max(0.5, r.h * v.z / 2), 0, 0, Math.PI * 2); g.stroke(); }
    else if (dr.kind === 'gradient') { g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(X(dr.p0.x), Y(dr.p0.y)); g.lineTo(X(dr.p1.x), Y(dr.p1.y)); g.stroke(); g.fillStyle = dr.color; g.beginPath(); g.arc(X(dr.p0.x), Y(dr.p0.y), 4, 0, 7); g.fill(); }
    else if (dr.kind === 'rect' || dr.kind === 'ellipse' || dr.kind === 'line') {
      const tmp = makeCanvas(this.doc.w, this.doc.h); this.drawShape(ctx2d(tmp), dr, true);
      g.imageSmoothingEnabled = !this.pixel && v.z < 1.5; g.drawImage(tmp, v.x, v.y, this.doc.w * v.z, this.doc.h * v.z);
    }
    g.restore();
  }
  drawShape(g, dr) {
    const d = this.doc, col = this.colorWithAlpha(dr.color, this.alpha * this.o.opacity), fillCol = this.colorWithAlpha(this.secondary, this.alpha * this.o.opacity);
    if (this.pixel) {
      g.fillStyle = col; const plot = (x, y) => g.fillRect(x, y, 1, 1);
      const x0 = Math.floor(dr.p0.x), y0 = Math.floor(dr.p0.y), x1 = Math.floor(dr.p1.x), y1 = Math.floor(dr.p1.y);
      if (dr.kind === 'line') bresenham(x0, y0, x1, y1, plot);
      else if (dr.kind === 'rect') { const X0 = Math.min(x0, x1), X1 = Math.max(x0, x1), Y0 = Math.min(y0, y1), Y1 = Math.max(y0, y1); if (this.o.shapeFill) { g.fillStyle = fillCol; g.fillRect(X0, Y0, X1 - X0 + 1, Y1 - Y0 + 1); g.fillStyle = col; } for (let x = X0; x <= X1; x++) { plot(x, Y0); plot(x, Y1); } for (let y = Y0; y <= Y1; y++) { plot(X0, y); plot(X1, y); } }
      else { if (this.o.shapeFill) { g.fillStyle = fillCol; pixelEllipse(x0, y0, x1, y1, true, plot); g.fillStyle = col; } pixelEllipse(x0, y0, x1, y1, false, plot); }
      return;
    }
    const r = normRect(dr.p0, dr.p1, false);
    g.lineWidth = this.o.strokeW; g.strokeStyle = col; g.fillStyle = fillCol; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    if (dr.kind === 'line') { g.moveTo(dr.p0.x, dr.p0.y); g.lineTo(dr.p1.x, dr.p1.y); g.stroke(); return; }
    if (dr.kind === 'rect') g.rect(r.x, r.y, r.w, r.h); else g.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    if (this.o.shapeFill) g.fill();
    if (this.o.strokeW > 0) g.stroke();
  }
  commitShape(dr) {
    const d = this.doc; d.pushCel(TOOLS[dr.kind].label.replace(/ \(.*/, ''));
    const tmp = makeCanvas(d.w, d.h), tg = ctx2d(tmp); this.drawShape(tg, dr);
    this.commitLayer(tmp); this.pushRecent(dr.color);
  }
  commitGradient(dr) {
    const d = this.doc; d.pushCel('Degradado');
    const tmp = makeCanvas(d.w, d.h), g = ctx2d(tmp), p0 = dr.p0, p1 = dr.p1;
    const gr = this.o.gradType === 'radial' ? g.createRadialGradient(p0.x, p0.y, 0, p0.x, p0.y, Math.hypot(p1.x - p0.x, p1.y - p0.y)) : g.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
    gr.addColorStop(0, this.colorWithAlpha(this.primary)); gr.addColorStop(1, this.o.gradTransparent ? this.colorWithAlpha(this.primary, 0) : this.colorWithAlpha(this.secondary, 1));
    g.fillStyle = gr; g.fillRect(0, 0, d.w, d.h);
    this.commitLayer(tmp);
  }
  /** Pega un lienzo temporal sobre el cel actual (selección, opacidad, bloqueo de alfa) */
  commitLayer(tmp) {
    const d = this.doc;
    if (d.selection) { const tg = ctx2d(tmp); tg.globalCompositeOperation = 'destination-in'; tg.drawImage(d.selection, 0, 0); }
    const g = ctx2d(d.cel); g.save(); g.globalCompositeOperation = d.curLayer.alphaLock ? 'source-atop' : 'source-over'; g.drawImage(tmp, 0, 0); g.restore();
    this.changed();
  }
  async textAt(p, color) {
    let ta, sz, fnt, bold, aa;
    const ok = await dialog('Texto', (b) => {
      ta = h('textarea', { rows: 3, placeholder: 'Escribe el texto', on: { keydown: (e) => e.stopPropagation() } });
      sz = h('input', { type: 'number', value: this.o.fontSize, min: 4, max: 1000 });
      fnt = h('select', ['system-ui', 'Georgia', 'Impact', 'Courier New', 'Comic Sans MS', 'Trebuchet MS', 'Verdana', 'Arial Black'].map((f) => h('option', { value: f, selected: f === this.o.font }, f)));
      bold = h('input', { type: 'checkbox', checked: this.o.bold }); aa = h('input', { type: 'checkbox', checked: this.pixel ? false : this.o.textAA });
      b.appendChild(ta); b.appendChild(h('div.field', h('label', 'Tamaño'), sz)); b.appendChild(h('div.field', h('label', 'Fuente'), fnt));
      b.appendChild(h('label.chk', bold, ' Negrita')); b.appendChild(h('label.chk', aa, ' Suavizado (desactívalo para pixel art)'));
    }, [{ label: 'Cancelar', value: null }, { label: 'Añadir', kind: 'primary', value: true }]);
    if (!ok || !ta.value.trim()) return;
    Object.assign(this.o, { fontSize: sz.value | 0 || 32, font: fnt.value, bold: bold.checked, textAA: aa.checked }); this.savePrefs();
    const d = this.doc; d.pushCel('Texto');
    const tmp = makeCanvas(d.w, d.h), g = ctx2d(tmp);
    g.font = (this.o.bold ? 'bold ' : '') + this.o.fontSize + 'px "' + this.o.font + '", sans-serif'; g.fillStyle = this.colorWithAlpha(color); g.textBaseline = 'top';
    ta.value.split('\n').forEach((line, i) => g.fillText(line, Math.round(p.x), Math.round(p.y + i * this.o.fontSize * 1.2)));
    if (!this.o.textAA) { const img = g.getImageData(0, 0, d.w, d.h); FILTERS.alphaHard.apply(img, { t: 110 }); g.putImageData(img, 0, 0); }
    this.commitLayer(tmp);
  }
  drawCropPreview(g, v) {
    const r = this.cropRect; if (!r) return;
    g.fillStyle = 'rgba(0,0,0,0.5)'; const X = v.x + r.x * v.z, Y = v.y + r.y * v.z, W = r.w * v.z, H = r.h * v.z, DW = this.doc.w * v.z, DH = this.doc.h * v.z;
    g.fillRect(v.x, v.y, DW, Y - v.y); g.fillRect(v.x, Y + H, DW, v.y + DH - Y - H); g.fillRect(v.x, Y, X - v.x, H); g.fillRect(X + W, Y, v.x + DW - X - W, H);
    g.strokeStyle = '#fff'; g.strokeRect(X + 0.5, Y + 0.5, W, H);
  }
  applyCrop() { const r = this.cropRect, d = this.doc; if (!r) return; d.pushDoc('Recortar'); d.crop(Math.max(0, r.x), Math.max(0, r.y), Math.min(r.w, d.w - Math.max(0, r.x)), Math.min(r.h, d.h - Math.max(0, r.y))); this.cropRect = null; this.preview = null; this.edges = null; this.changed(true); this.fit(); this.renderOpts(); }

  /* ================================================================ selección, portapapeles, filtros */
  selectAll() { const d = this.doc; if (!d) return; combineSelection(d, (g) => g.fillRect(0, 0, d.w, d.h), 'new'); this.edges = null; this.dirtyView = true; }
  deselect() { if (!this.doc) return; this.doc.selection = null; this.edges = null; this.dirtyView = true; }
  invert() { if (!this.doc) return; invertSelection(this.doc); this.edges = null; this.dirtyView = true; }
  clearSel() {
    const d = this.doc; if (!d || this.locked()) return; d.pushCel('Borrar');
    const g = ctx2d(d.cel);
    if (d.selection) { g.save(); g.globalCompositeOperation = 'destination-out'; g.drawImage(d.selection, 0, 0); g.restore(); } else g.clearRect(0, 0, d.w, d.h);
    this.changed();
  }
  fillSel(color) {
    const d = this.doc; if (!d || this.locked()) return; d.pushCel('Rellenar');
    const tmp = makeCanvas(d.w, d.h), g = ctx2d(tmp); g.fillStyle = this.colorWithAlpha(color); g.fillRect(0, 0, d.w, d.h); this.commitLayer(tmp);
  }
  async copy(cut) {
    const d = this.doc; if (!d) return;
    const c = makeCanvas(d.w, d.h), g = ctx2d(c); g.drawImage(d.cel, 0, 0);
    if (d.selection) { g.globalCompositeOperation = 'destination-in'; g.drawImage(d.selection, 0, 0); }
    const b = d.selection ? selectionBounds(d.selection) : { x: 0, y: 0, w: d.w, h: d.h }; if (!b) return;
    const out = makeCanvas(b.w, b.h); ctx2d(out).drawImage(c, -b.x, -b.y);
    this.clip = out;
    try { if (navigator.clipboard && window.ClipboardItem) { const blob = await canvasBlob(out, 'image/png'); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); } } catch (e) { /* solo portapapeles interno */ }
    if (cut) this.clearSel();
    toast(cut ? 'Cortado' : 'Copiado');
  }
  paste() { if (this.clip && this.doc) this.pasteImage(this.clip, 'Pegado'); }
  onPaste(e) {
    if (!this.visible || !this.doc || isTyping(e)) return;
    const items = e.clipboardData ? Array.from(e.clipboardData.items || []) : [], it = items.find((x) => /^image\//.test(x.type));
    if (!it) { if (this.clip) { e.preventDefault(); this.paste(); } return; }
    e.preventDefault();
    const f = it.getAsFile(); const url = URL.createObjectURL(f);
    loadImage(url).then((img) => this.pasteImage(img, 'Pegado')).catch(() => toast('No se pudo pegar la imagen', 'warn')).finally(() => URL.revokeObjectURL(url));
  }
  async filterDialog(id) {
    const d = this.doc, F = FILTERS[id]; if (!d || !F || this.locked()) return;
    const p = {}; F.params.forEach((q) => { p[q.key] = q.def; });
    const g = ctx2d(d.cel), before = g.getImageData(0, 0, d.w, d.h), big = d.w * d.h > 1400000;
    const run = () => { const img = new ImageData(new Uint8ClampedArray(before.data), d.w, d.h); const out = F.apply(img, p, { palette: this.palette }) || img; g.putImageData(maskBlend(before, out, d.selection), 0, 0); this.dirtyView = true; };
    let t = 0; const later = () => { clearTimeout(t); t = setTimeout(run, big ? 250 : 40); };
    if (!F.params.length) { d.pushCel(F.label); run(); this.changed(); return; }
    run();
    const ok = await dialog(F.label, (b) => {
      F.params.forEach((q) => {
        let inp;
        if (q.type === 'bool') inp = h('input', { type: 'checkbox', checked: p[q.key], on: { change: (e) => { p[q.key] = e.target.checked; later(); } } });
        else if (q.type === 'color') inp = h('input', { type: 'color', value: p[q.key], on: { input: (e) => { p[q.key] = e.target.value; later(); } } });
        else { const num = h('span.help', String(p[q.key])); inp = h('div.range', h('input', { type: 'range', min: q.min, max: q.max, step: q.step || 1, value: p[q.key], on: { input: (e) => { p[q.key] = +e.target.value; num.textContent = e.target.value; later(); } } }), num); }
        b.appendChild(h('div.field', h('label', q.label), inp));
      });
      b.appendChild(h('div.help', d.selection ? 'Se aplica dentro de la selección.' : 'Se aplica a la capa «' + d.curLayer.name + '».'));
    }, [{ label: 'Cancelar', value: false }, { label: 'Aplicar', kind: 'primary', value: true }]);
    clearTimeout(t);
    if (ok) { g.putImageData(before, 0, 0); d.pushCel(F.label); run(); this.changed(); }
    else { g.putImageData(before, 0, 0); this.dirtyView = true; }
  }
  async imageSize(canvasOnly) {
    const d = this.doc; if (!d) return;
    let wI, hI, keep, anchor;
    const ok = await dialog(canvasOnly ? 'Tamaño del lienzo' : 'Tamaño de la imagen', (b) => {
      wI = h('input', { type: 'number', value: d.w, min: 1, max: 8192 }); hI = h('input', { type: 'number', value: d.h, min: 1, max: 8192 }); keep = h('input', { type: 'checkbox', checked: !canvasOnly });
      const ratio = d.w / d.h; wI.oninput = () => { if (keep.checked) hI.value = Math.max(1, Math.round(wI.value / ratio)); }; hI.oninput = () => { if (keep.checked) wI.value = Math.max(1, Math.round(hI.value * ratio)); };
      b.appendChild(h('div.field', h('label', 'Ancho'), wI)); b.appendChild(h('div.field', h('label', 'Alto'), hI)); b.appendChild(h('label.chk', keep, ' Mantener proporción'));
      if (canvasOnly) { anchor = h('select', [['0.5,0.5', 'Centro'], ['0,0', 'Arriba izquierda'], ['0.5,0', 'Arriba'], ['1,0', 'Arriba derecha'], ['0,0.5', 'Izquierda'], ['1,0.5', 'Derecha'], ['0,1', 'Abajo izquierda'], ['0.5,1', 'Abajo'], ['1,1', 'Abajo derecha']].map(([v, t]) => h('option', { value: v }, t))); b.appendChild(h('div.field', h('label', 'Anclaje'), anchor)); }
    }, [{ label: 'Cancelar', value: null }, { label: 'Aplicar', kind: 'primary', value: true }]);
    if (!ok) return;
    const w = wI.value | 0, hh = hI.value | 0; if (w < 1 || hh < 1) return;
    d.pushDoc(canvasOnly ? 'Tamaño del lienzo' : 'Tamaño de la imagen');
    if (canvasOnly) { const [ax, ay] = anchor.value.split(',').map(Number); d.resizeCanvas(w, hh, ax, ay); } else d.resizeImage(w, hh, !this.pixel);
    this.edges = null; this.changed(true); this.fit();
  }
  transform(kind) {
    const d = this.doc; if (!d) return;
    const fns = {
      flipH: (g, w, hh, c) => { g.translate(w, 0); g.scale(-1, 1); g.drawImage(c, 0, 0); },
      flipV: (g, w, hh, c) => { g.translate(0, hh); g.scale(1, -1); g.drawImage(c, 0, 0); },
      rot180: (g, w, hh, c) => { g.translate(w, hh); g.rotate(Math.PI); g.drawImage(c, 0, 0); },
      rotCW: Object.assign((g, w, hh, c) => { g.translate(w, 0); g.rotate(Math.PI / 2); g.drawImage(c, 0, 0); }, { swap: true }),
      rotCCW: Object.assign((g, w, hh, c) => { g.translate(0, hh); g.rotate(-Math.PI / 2); g.drawImage(c, 0, 0); }, { swap: true })
    };
    d.pushDoc('Transformar'); d.transformAll(fns[kind]); this.edges = null; this.changed(true); this.fit();
  }
  flipLayer(vertical) {
    const d = this.doc; if (!d || this.locked()) return; d.pushCel('Voltear capa');
    const c = d.cel, tmp = makeCanvas(d.w, d.h); ctx2d(tmp).drawImage(c, 0, 0);
    const g = ctx2d(c); g.save(); g.clearRect(0, 0, d.w, d.h); if (vertical) { g.translate(0, d.h); g.scale(1, -1); } else { g.translate(d.w, 0); g.scale(-1, 1); } g.drawImage(tmp, 0, 0); g.restore();
    this.changed();
  }
  trim() { const d = this.doc, b = d && d.contentBounds(); if (!b) { toast('La imagen está vacía', 'warn'); return; } d.pushDoc('Recortar al contenido'); d.crop(b.x, b.y, b.w, b.h); this.changed(true); this.fit(); }
  cropToSel() { const d = this.doc, b = d && d.selection && selectionBounds(d.selection); if (!b) { toast('Primero haz una selección', 'warn'); return; } d.pushDoc('Recortar a la selección'); d.crop(b.x, b.y, b.w, b.h); this.edges = null; this.changed(true); this.fit(); }
  undo() { const d = this.doc; if (!d) return; const l = d.undoStep(); if (l) { toast('Deshacer: ' + l); this.edges = null; this.changed(true); } }
  redo() { const d = this.doc; if (!d) return; const l = d.redoStep(); if (l) { toast('Rehacer: ' + l); this.edges = null; this.changed(true); } }

  /* ================================================================ animación */
  play() { const d = this.doc; if (!d || d.frames.length < 2) { toast('Añade fotogramas para animar', 'warn'); return; } this.playing = true; this.animFrame = d.frame; this.animT = 0; this.renderFrames(); }
  stopAnim() { if (!this.playing) return; this.playing = false; this.dirtyView = true; this.renderFrames(); }
  stepAnim(t) { const d = this.doc; if (!d) return; if (!this.animT) this.animT = t; const fr = d.frames[this.animFrame] || d.frames[0]; if (t - this.animT >= (fr.duration || 100)) { this.animT = t; this.animFrame = (this.animFrame + 1) % d.frames.length; this.dirtyView = true; } }
  frameOp(op) {
    const d = this.doc; if (!d) return; this.stopAnim();
    d.pushDoc('Fotogramas');
    if (op === 'add') d.addFrame(false); else if (op === 'dup') d.addFrame(true); else if (op === 'del') { if (!d.removeFrame(d.frame)) toast('Tiene que quedar un fotograma', 'warn'); } else if (op === 'left') d.moveFrame(d.frame, -1); else if (op === 'right') d.moveFrame(d.frame, 1);
    this.changed(true);
  }
  layerOp(op) {
    const d = this.doc; if (!d) return;
    d.pushDoc('Capas');
    if (op === 'add') d.addLayer(); else if (op === 'dup') d.duplicateLayer(d.layer); else if (op === 'del') { if (!d.removeLayer(d.layer)) toast('Tiene que quedar una capa', 'warn'); } else if (op === 'up') d.moveLayer(d.layer, 1); else if (op === 'down') d.moveLayer(d.layer, -1); else if (op === 'merge') { if (!d.mergeDown(d.layer)) toast('No hay capa debajo', 'warn'); } else if (op === 'flatten') d.flatten();
    this.changed(true);
  }

  /* ================================================================ teclado */
  onKey(e) {
    if (!this.visible || !this.doc || isTyping(e) || document.getElementById('overlay').hidden === false) return;
    const k = e.key, ctrl = e.ctrlKey || e.metaKey, kl = k.toLowerCase();
    if (k === ' ') { this.space = true; const up = (ev) => { if (ev.key === ' ') { this.space = false; document.removeEventListener('keyup', up); } }; document.addEventListener('keyup', up); e.preventDefault(); return; }
    let handled = true;
    if (ctrl && kl === 'z') { if (e.shiftKey) this.redo(); else this.undo(); }
    else if (ctrl && kl === 'y') this.redo();
    else if (ctrl && kl === 'a') this.selectAll();
    else if (ctrl && kl === 'd') this.deselect();
    else if (ctrl && e.shiftKey && kl === 'i') this.invert();
    else if (ctrl && kl === 'c') this.copy(false);
    else if (ctrl && kl === 'x') this.copy(true);
    else if (ctrl && kl === 's') this.saveToProject(false);
    else if (ctrl && kl === 'v') handled = false; // lo gestiona el evento paste
    else if (ctrl) handled = false;
    else if (k === 'Delete' || k === 'Backspace') this.clearSel();
    else if (k === 'Enter' && this.cropRect) this.applyCrop();
    else if (k === 'Escape') { this.cropRect = null; this.preview = null; this.drag = null; this.deselect(); this.renderOpts(); }
    else if (k === '[') { this.o.size = Math.max(1, Math.round(this.o.size / 1.25)); this.renderOpts(); this.dirtyView = true; }
    else if (k === ']') { this.o.size = Math.min(500, Math.max(this.o.size + 1, Math.round(this.o.size * 1.25))); this.renderOpts(); this.dirtyView = true; }
    else if (k === '+' || k === '=') this.zoomAt(this.pixel ? 2 : 1.25);
    else if (k === '-') this.zoomAt(this.pixel ? 0.5 : 0.8);
    else if (k === '0') this.fit();
    else if (k === '1') this.zoomTo(1);
    else if (kl === 'x') { const t = this.primary; this.primary = this.secondary; this.secondary = t; this.renderColors(); }
    else if (kl === 'd' && e.shiftKey && this.pixel) this.setTool('dither');
    else if (kl === 'd') { this.primary = '#000000'; this.secondary = '#ffffff'; this.alpha = 1; this.renderColors(); }
    else if (k === ',' && this.pixel) { this.doc.frame = Math.max(0, this.doc.frame - 1); this.changed(true); }
    else if (k === '.' && this.pixel) { this.doc.frame = Math.min(this.doc.frames.length - 1, this.doc.frame + 1); this.changed(true); }
    else { const t = Object.keys(TOOLS).find((id) => TOOLS[id].key === kl && this.toolOk(id)); if (t) this.setTool(t); else handled = false; }
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }
  toolOk(id) { const m = TOOLS[id].modes; return m === 'both' || m === (this.pixel ? 'pixel' : 'photo'); }
  setTool(t) { this.tool = t; if (t !== 'crop') { this.cropRect = null; this.preview = null; } this.renderTools(); this.renderOpts(); this.dirtyView = true; }

  /* ================================================================ interfaz */
  render() {
    const host = this.host; clear(host);
    const ed = this.app.editor;
    this.el = h('div.paint' + (this.pixel ? '.pixel' : ''));
    this.barEl = h('div.paint-bar'); this.optsEl = h('div.paint-opts'); this.toolsEl = h('div.paint-tools');
    this.canvas = h('canvas.paint-canvas', { tabindex: '0', 'aria-label': 'Lienzo' });
    this.statusEl = h('div.paint-status');
    this.sideEl = h('div.paint-side'); this.framesEl = h('div.paint-frames');
    const center = h('div.paint-center', h('div.paint-view', this.canvas, this.doc ? null : this.emptyState(ed)), this.framesEl, this.statusEl);
    this.el.appendChild(this.barEl); this.el.appendChild(this.optsEl);
    this.el.appendChild(h('div.paint-main', this.toolsEl, center, this.sideEl));
    host.appendChild(this.el);
    this.bindCanvas();
    this.renderBar(); this.renderOpts(); this.renderTools(); this.renderSide(); this.renderFrames(); this.renderStatus();
    this.dirtyView = true;
    if (this.ro) this.ro.disconnect();
    this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { this.dirtyView = true; }) : null;
    if (this.ro) this.ro.observe(this.canvas);
  }
  emptyState(ed) {
    const imgs = ed.project ? ed.project.assets.filter((a) => a.type === 'image') : [];
    return h('div.paint-empty', h('h2', '🎨 Arte'), h('div.help', 'Editor de imágenes tipo Photoshop y editor de pixel art con animación.'),
      h('div.row-actions', h('button.btn.primary', { type: 'button', on: { click: () => this.newDialog('pixel') } }, '👾 Nuevo pixel art'), h('button.btn.primary', { type: 'button', on: { click: () => this.newDialog('photo') } }, '📷 Nueva imagen'),
        h('button.btn', { type: 'button', on: { click: () => this.pickFile() } }, '⬆ Abrir archivo…')),
      imgs.length ? h('div.help', 'O edita una imagen del proyecto:') : null,
      imgs.length ? h('div.chips', imgs.slice(0, 40).map((a) => h('button.chip', { type: 'button', on: { click: () => this.openAsset(a.id) } }, '🖼 ' + a.name))) : null);
  }
  pickFile() { const inp = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' }); inp.onchange = () => { if (inp.files[0]) this.importFile(inp.files[0]); }; inp.click(); }
  bindCanvas() {
    const c = this.canvas, pts = new Map(); let pinch = null;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.focus();
      if (e.pointerType === 'touch') { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { if (this.stroke) { this.doc.undoStep(); this.doc.redo = []; this.stroke = null; this.changed(); } this.drag = null; this.preview = null; const a = Array.from(pts.values()); pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), cx: (a[0].x + a[1].x) / 2, cy: (a[0].y + a[1].y) / 2 }; return; } if (pts.size > 2) return; }
      this.onDown(e);
    });
    c.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' && pts.has(e.pointerId)) { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pinch && pts.size >= 2) { const a = Array.from(pts.values()), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), cx = (a[0].x + a[1].x) / 2, cy = (a[0].y + a[1].y) / 2, r = c.getBoundingClientRect(); this.view.x += cx - pinch.cx; this.view.y += cy - pinch.cy; this.zoomAt(d / pinch.d, cx - r.left, cy - r.top); pinch = { d, cx, cy }; return; } }
      if (pinch) return;
      this.onMove(e);
    });
    const up = (e) => { if (e.pointerType === 'touch') { pts.delete(e.pointerId); if (pinch) { if (pts.size < 2) pinch = null; return; } } this.onUp(e); };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { this.hoverPt = null; this.dirtyView = true; });
    c.addEventListener('wheel', (e) => { e.preventDefault(); if (!this.doc) return; const r = c.getBoundingClientRect(); if (e.ctrlKey || e.altKey || !e.shiftKey) this.zoomAt(Math.exp(-e.deltaY * (this.pixel ? 0.004 : 0.0018)), e.clientX - r.left, e.clientY - r.top); else { this.view.x -= e.deltaY; this.dirtyView = true; } }, { passive: false });
    c.addEventListener('dblclick', () => { if (this.cropRect) this.applyCrop(); });
  }
  renderBar() {
    const el = this.barEl; if (!el) return; clear(el);
    const d = this.doc, ed = this.app.editor;
    const menu = (label, items) => { const b = h('button.btn.small', { type: 'button' }, label + ' ▾'); b.onclick = () => showMenu(items(), b); return b; };
    el.appendChild(h('div.seg', h('button', { type: 'button', class: d && !this.pixel ? 'on' : null, title: 'Modo foto / ilustración', on: { click: () => this.switchMode('photo') } }, '📷 Foto'), h('button', { type: 'button', class: this.pixel ? 'on' : null, title: 'Modo pixel art', on: { click: () => this.switchMode('pixel') } }, '👾 Pixel art')));
    el.appendChild(menu('Archivo', () => [
      { label: 'Nueva imagen…', icon: '＋', action: () => this.newDialog(this.pixel ? 'pixel' : 'photo') },
      { label: 'Abrir archivo…', icon: '⬆', action: () => this.pickFile() },
      { group: 'Imágenes del proyecto' }].concat((ed.project ? ed.project.assets.filter((a) => a.type === 'image') : []).slice(0, 30).map((a) => ({ label: a.name, icon: '🖼', action: () => this.openAsset(a.id) })), ['-',
      { label: d && d.assetId ? 'Guardar en el proyecto' : 'Guardar como recurso nuevo', icon: '💾', key: 'Ctrl+S', disabled: !d, action: () => this.saveToProject(false) },
      { label: 'Guardar como recurso nuevo', icon: '📄', disabled: !d, action: () => this.saveToProject(true) },
      { group: 'Exportar' },
      { label: 'PNG', icon: '⬇', disabled: !d, action: () => this.exportAs('png') }, { label: 'PNG ampliado (2x, 4x…)', icon: '⬇', disabled: !d, action: () => this.exportAs('png-x') },
      { label: 'JPG', icon: '⬇', disabled: !d, action: () => this.exportAs('jpg') }, { label: 'WebP', icon: '⬇', disabled: !d, action: () => this.exportAs('webp') },
      { label: 'GIF animado', icon: '🎞', disabled: !d, action: () => this.exportAs('gif') }, { label: 'Hoja de sprites (PNG)', icon: '▦', disabled: !d, action: () => this.exportAs('sheet') }, { label: 'Cada fotograma (PNG)', icon: '🗂', disabled: !d || d.frames.length < 2, action: () => this.exportAs('frames') }])));
    el.appendChild(menu('Editar', () => [
      { label: 'Deshacer', icon: '↶', key: 'Ctrl+Z', disabled: !d || !d.undo.length, action: () => this.undo() }, { label: 'Rehacer', icon: '↷', key: 'Ctrl+Y', disabled: !d || !d.redo.length, action: () => this.redo() }, '-',
      { label: 'Cortar', icon: '✂', key: 'Ctrl+X', disabled: !d, action: () => this.copy(true) }, { label: 'Copiar', icon: '📋', key: 'Ctrl+C', disabled: !d, action: () => this.copy(false) }, { label: 'Pegar como capa', icon: '📥', key: 'Ctrl+V', disabled: !d || !this.clip, action: () => this.paste() }, '-',
      { label: 'Rellenar con el color principal', icon: '🪣', disabled: !d, action: () => this.fillSel(this.primary) }, { label: 'Borrar (selección o capa)', icon: '🗑', key: 'Supr', disabled: !d, action: () => this.clearSel() }]));
    el.appendChild(menu('Imagen', () => [
      { label: 'Tamaño de la imagen…', icon: '⤢', disabled: !d, action: () => this.imageSize(false) }, { label: 'Tamaño del lienzo…', icon: '▣', disabled: !d, action: () => this.imageSize(true) },
      { label: 'Recortar a la selección', icon: '⛶', disabled: !d, action: () => this.cropToSel() }, { label: 'Recortar al contenido', icon: '⛶', disabled: !d, action: () => this.trim() }, '-',
      { label: 'Voltear horizontal', icon: '⇋', disabled: !d, action: () => this.transform('flipH') }, { label: 'Voltear vertical', icon: '⇵', disabled: !d, action: () => this.transform('flipV') },
      { label: 'Girar 90° derecha', icon: '↻', disabled: !d, action: () => this.transform('rotCW') }, { label: 'Girar 90° izquierda', icon: '↺', disabled: !d, action: () => this.transform('rotCCW') }, { label: 'Girar 180°', icon: '⟲', disabled: !d, action: () => this.transform('rot180') }, '-',
      { label: 'Voltear la capa horizontal', icon: '⇋', disabled: !d, action: () => this.flipLayer(false) }, { label: 'Voltear la capa vertical', icon: '⇵', disabled: !d, action: () => this.flipLayer(true) }]));
    el.appendChild(menu('Filtros', () => { const out = []; let g = null; Object.keys(FILTERS).forEach((k) => { const F = FILTERS[k]; if (F.group !== g) { out.push({ group: F.group }); g = F.group; } out.push({ label: F.label + (F.params.length ? '…' : ''), icon: '✨', disabled: !d, action: () => this.filterDialog(k) }); }); return out; }));
    el.appendChild(menu('Selección', () => [
      { label: 'Todo', icon: '▦', key: 'Ctrl+A', disabled: !d, action: () => this.selectAll() }, { label: 'Nada', icon: '▢', key: 'Ctrl+D', disabled: !d, action: () => this.deselect() }, { label: 'Invertir', icon: '◩', key: 'Ctrl+Mayús+I', disabled: !d, action: () => this.invert() },
      { label: 'Seleccionar el contenido de la capa', icon: '◼', disabled: !d, action: () => { const dd = this.doc; combineSelection(dd, (g) => { const m = makeCanvas(dd.w, dd.h), mg = ctx2d(m); mg.drawImage(dd.cel, 0, 0); mg.globalCompositeOperation = 'source-in'; mg.fillStyle = '#fff'; mg.fillRect(0, 0, dd.w, dd.h); g.drawImage(m, 0, 0); }, 'new'); this.edges = null; this.dirtyView = true; } }]));
    el.appendChild(menu('Vista', () => [
      { label: 'Ajustar a la ventana', icon: '⤢', key: '0', disabled: !d, action: () => this.fit() }, { label: 'Tamaño real (100 %)', icon: '1:1', key: '1', disabled: !d, action: () => this.zoomTo(1) },
      { label: 'Acercar', icon: '＋', key: '+', disabled: !d, action: () => this.zoomAt(this.pixel ? 2 : 1.25) }, { label: 'Alejar', icon: '－', key: '-', disabled: !d, action: () => this.zoomAt(this.pixel ? 0.5 : 0.8) }, '-',
      { label: 'Rejilla de píxeles', icon: this.show.pixelGrid ? '✓' : ' ', action: () => { this.show.pixelGrid = !this.show.pixelGrid; this.dirtyView = true; } },
      { label: 'Cuadrícula de ' + this.show.gridSize + ' px', icon: this.show.grid ? '✓' : ' ', action: () => { this.show.grid = !this.show.grid; this.dirtyView = true; } },
      { label: 'Tamaño de la cuadrícula…', icon: '#', action: async () => { const v = await pick('Cuadrícula', 'Tamaño (px)', ['4', '8', '16', '32', '64']); if (v) { this.show.gridSize = +v; this.show.grid = true; this.dirtyView = true; } } },
      { label: 'Mosaico (ver repetido 3×3)', icon: this.show.tile ? '✓' : ' ', disabled: !this.pixel, action: () => { this.show.tile = !this.show.tile; this.dirtyView = true; } },
      { label: 'Papel cebolla (fotogramas vecinos)', icon: this.show.onion ? '✓' : ' ', disabled: !this.pixel, action: () => { this.show.onion = !this.show.onion; this.dirtyView = true; } }]));
    el.appendChild(h('button.btn.small', { type: 'button', title: 'Deshacer (Ctrl+Z)', disabled: !d || !d.undo.length, on: { click: () => this.undo() } }, '↶'));
    el.appendChild(h('button.btn.small', { type: 'button', title: 'Rehacer (Ctrl+Y)', disabled: !d || !d.redo.length, on: { click: () => this.redo() } }, '↷'));
    el.appendChild(h('span.grow'));
    el.appendChild(h('button.btn.small.paint-side-toggle', { type: 'button', title: 'Colores, paleta y capas', on: { click: () => this.el.classList.toggle('side-open') } }, '🎨 Capas'));
    if (d) el.appendChild(h('span.help', (d.dirty ? '● ' : '') + d.name + ' · ' + d.w + '×' + d.h + (d.frames.length > 1 ? ' · ' + d.frames.length + ' fotogramas' : '')));
    el.appendChild(h('button.btn.small.primary', { type: 'button', disabled: !d, title: 'Guardar en el proyecto (Ctrl+S)', on: { click: () => this.saveToProject(false) } }, '💾 Guardar'));
  }
  switchMode(mode) {
    if (!this.doc) { this.newDialog(mode); return; }
    if (this.doc.mode === mode) return;
    this.doc.mode = mode;
    if (!this.toolOk(this.tool)) this.tool = mode === 'pixel' ? 'pencil' : 'brush';
    if (mode === 'pixel' && this.o.size > 8) this.o.size = 1;
    this.render(); this.fit();
  }
  renderTools() {
    const el = this.toolsEl; if (!el) return; clear(el);
    Object.keys(TOOLS).forEach((id) => { if (!this.toolOk(id)) return; const T = TOOLS[id]; el.appendChild(h('button', { type: 'button', class: id === this.tool ? 'on' : null, title: T.label, 'aria-label': T.label, on: { click: () => this.setTool(id) } }, T.icon)); });
  }
  renderOpts() {
    const el = this.optsEl; if (!el) return; clear(el);
    const t = this.tool, o = this.o;
    const num = (key, label, min, max, step, fmt) => { const val = h('span.val', fmt ? fmt(o[key]) : String(o[key])); return h('label.opt', label, h('input', { type: 'range', min, max, step: step || 1, value: o[key], on: { input: (e) => { o[key] = +e.target.value; val.textContent = fmt ? fmt(o[key]) : String(o[key]); this.dirtyView = true; this.savePrefs(); } } }), val); };
    const chk = (key, label, title) => h('label.chk', { title }, h('input', { type: 'checkbox', checked: !!o[key], on: { change: (e) => { o[key] = e.target.checked; this.savePrefs(); this.dirtyView = true; } } }), ' ' + label);
    const pct = (v) => Math.round(v * 100) + '%';
    el.appendChild(h('b', TOOLS[t].icon + ' ' + TOOLS[t].label.replace(/ \(.*/, '')));
    if (['brush', 'eraser', 'clone', 'smudge', 'blurBrush', 'dodge'].includes(t) && !this.pixel) el.appendChild(num('size', 'Tamaño', 1, 500));
    if (['pencil', 'eraser', 'dither', 'shade'].includes(t) && (this.pixel || t === 'pencil')) el.appendChild(num('size', 'Tamaño', 1, this.pixel ? 16 : 100));
    if (['brush', 'eraser', 'clone'].includes(t) && !this.pixel) { el.appendChild(num('hardness', 'Dureza', 0, 1, 0.05, pct)); el.appendChild(num('flow', 'Flujo', 0.02, 1, 0.02, pct)); el.appendChild(num('spacing', 'Espaciado', 0.02, 1, 0.02, pct)); el.appendChild(chk('pressure', 'Presión del lápiz', 'Tabletas y lápices: la presión cambia el tamaño')); }
    if (['brush', 'eraser', 'pencil', 'clone', 'bucket', 'dither', 'rect', 'ellipse', 'line', 'gradient'].includes(t)) el.appendChild(num('opacity', 'Opacidad', 0.02, 1, 0.02, pct));
    if (['smudge', 'blurBrush', 'dodge'].includes(t)) el.appendChild(num('strength', 'Fuerza', 0.05, 1, 0.05, pct));
    if (['bucket', 'wand', 'replace'].includes(t)) { el.appendChild(num('tol', 'Tolerancia', 0, 255)); if (t !== 'replace') { el.appendChild(chk('contiguous', 'Contiguo')); el.appendChild(chk('sampleAll', 'Todas las capas', 'Mira la imagen compuesta, no solo la capa actual')); } }
    if (['marquee', 'ellipseSel', 'lasso', 'wand'].includes(t)) el.appendChild(h('div.seg', [['new', 'Nueva'], ['add', '＋ Añadir'], ['sub', '－ Restar'], ['inter', '∩ Intersecar']].map(([v, lbl]) => h('button', { type: 'button', class: o.selMode === v ? 'on' : null, on: { click: () => { o.selMode = v; this.renderOpts(); } } }, lbl))), h('span.help', 'Mayús: añadir · Alt: restar'));
    if (t === 'pencil' && this.pixel) el.appendChild(chk('pixelPerfect', 'Píxel perfecto', 'Quita las esquinas dobles al dibujar líneas a mano'));
    if (this.pixel && ['pencil', 'eraser', 'dither', 'shade'].includes(t)) { el.appendChild(chk('symX', 'Simetría ↔')); el.appendChild(chk('symY', 'Simetría ↕')); }
    if (t === 'dither') { el.appendChild(num('ditherLevel', 'Densidad', 1, 15, 1, (v) => v + '/16')); el.appendChild(chk('ditherTransparent', 'Secundario transparente')); }
    if (t === 'shade') { el.appendChild(num('shadeAmt', 'Cantidad', 1, 40, 1, (v) => v + '%')); el.appendChild(h('span.help', 'Clic: iluminar · clic derecho: oscurecer (usa la paleta si el color está en ella)')); }
    if (['rect', 'ellipse'].includes(t)) { el.appendChild(chk('shapeFill', 'Relleno (color secundario)')); if (!this.pixel) el.appendChild(num('strokeW', 'Borde', 0, 60)); }
    if (t === 'line' && !this.pixel) el.appendChild(num('strokeW', 'Grosor', 1, 60));
    if (t === 'gradient') { el.appendChild(h('div.seg', [['linear', 'Lineal'], ['radial', 'Radial']].map(([v, lbl]) => h('button', { type: 'button', class: o.gradType === v ? 'on' : null, on: { click: () => { o.gradType = v; this.renderOpts(); } } }, lbl)))); el.appendChild(chk('gradTransparent', 'Hacia transparente')); }
    if (t === 'blurBrush') el.appendChild(h('span.help', 'Alt o clic derecho: enfocar'));
    if (t === 'dodge') el.appendChild(h('span.help', 'Alt o clic derecho: subexponer (oscurecer)'));
    if (t === 'clone') el.appendChild(h('span.help', this.cloneSrc ? 'Origen fijado · Alt+clic para cambiarlo' : 'Alt+clic para elegir el origen'));
    if (t === 'crop') { el.appendChild(h('span.help', this.cropRect ? this.cropRect.w + '×' + this.cropRect.h + ' px' : 'Arrastra el área a conservar')); if (this.cropRect) { el.appendChild(h('button.btn.small.primary', { type: 'button', on: { click: () => this.applyCrop() } }, '✓ Recortar (Intro)')); el.appendChild(h('button.btn.small', { type: 'button', on: { click: () => { this.cropRect = null; this.preview = null; this.renderOpts(); this.dirtyView = true; } } }, 'Cancelar')); } }
    if (t === 'move') el.appendChild(h('span.help', 'Arrastra para mover la capa (o la selección) · Mayús: en un eje'));
    if (t === 'picker') el.appendChild(h('span.help', 'Clic: color principal · clic derecho: secundario · Alt con pincel/lápiz también toma color'));
  }
  renderSide() {
    const el = this.sideEl; if (!el) return; clear(el);
    this.colorsEl = h('div.card.paint-colors'); this.paletteEl = h('div.card.paint-palette'); this.layersEl = h('div.card.paint-layers');
    el.appendChild(this.colorsEl);
    if (this.pixel) { this.miniCanvas = h('canvas.paint-mini'); el.appendChild(h('div.card', h('b', 'Vista previa'), this.miniCanvas)); } else this.miniCanvas = null;
    el.appendChild(this.paletteEl); el.appendChild(this.layersEl);
    this.renderColors(); this.renderPalette(); this.renderLayers();
  }
  drawMini() {
    const d = this.doc, c = this.miniCanvas; if (!d || !c) return;
    const k = Math.max(1, Math.min(4, Math.floor(160 / Math.max(d.w, d.h)))), W = d.w * k, H = d.h * k;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, W, H);
    g.drawImage(this.playing ? d.composite(d.frames[this.animFrame || 0]) : this.comp || d.composite(), 0, 0, W, H);
  }
  renderColors() {
    const el = this.colorsEl; if (!el) return; clear(el);
    const pI = h('input', { type: 'color', value: this.primary, title: 'Color principal', on: { input: (e) => { this.primary = e.target.value; hex.value = this.primary; }, change: () => this.pushRecent(this.primary) } });
    const sI = h('input', { type: 'color', value: this.secondary, title: 'Color secundario', on: { input: (e) => { this.secondary = e.target.value; } } });
    const hex = h('input', { type: 'text', value: this.primary, maxlength: 7, spellcheck: 'false', 'aria-label': 'Hexadecimal', on: { keydown: (e) => e.stopPropagation(), change: (e) => { const v = e.target.value.trim(); if (/^#?[0-9a-f]{6}$/i.test(v)) { this.primary = (v[0] === '#' ? v : '#' + v).toLowerCase(); this.renderColors(); } } } });
    const al = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: this.alpha, title: 'Opacidad del color', on: { input: (e) => { this.alpha = +e.target.value; } } });
    el.appendChild(h('div.card-head', h('b.grow', 'Color'), h('button.icon', { type: 'button', title: 'Intercambiar (X)', on: { click: () => { const t = this.primary; this.primary = this.secondary; this.secondary = t; this.renderColors(); } } }, '⇄'), h('button.icon', { type: 'button', title: 'Negro y blanco (D)', on: { click: () => { this.primary = '#000000'; this.secondary = '#ffffff'; this.alpha = 1; this.renderColors(); } } }, '◐')));
    el.appendChild(h('div.color-pair', pI, sI, hex));
    el.appendChild(h('label.opt', 'Alfa', al));
    if (this.recent.length) el.appendChild(h('div.swatches', this.recent.map((c) => h('button.sw', { type: 'button', title: c, style: { background: c }, on: { click: () => { this.primary = c; this.renderColors(); }, contextmenu: (e) => { e.preventDefault(); this.secondary = c; this.renderColors(); } } }))));
  }
  renderPalette() {
    const el = this.paletteEl; if (!el) return; clear(el);
    const sel = h('select', { 'aria-label': 'Paleta', on: { change: (e) => { const k = e.target.value; if (k === '__doc') this.palette = this.docColors(); else if (PALETTES[k]) this.palette = PALETTES[k].list.slice(); this.paletteKey = k; this.renderPalette(); } } },
      Object.keys(PALETTES).map((k) => h('option', { value: k, selected: k === this.paletteKey }, PALETTES[k].label + ' (' + PALETTES[k].list.length + ')')), h('option', { value: '__doc', selected: this.paletteKey === '__doc' }, 'Colores de la imagen'), h('option', { value: '__custom', selected: this.paletteKey === '__custom' }, 'Personalizada'));
    el.appendChild(h('div.card-head', h('b.grow', 'Paleta'), sel));
    el.appendChild(h('div.swatches.pal', this.palette.map((c, i) => h('button.sw', { type: 'button', title: c + ' · clic: principal · clic derecho: secundario · Mayús+clic: quitar', class: c === this.primary ? 'on' : null, style: { background: c },
      on: { click: (e) => { if (e.shiftKey) { this.palette.splice(i, 1); this.paletteKey = '__custom'; this.renderPalette(); return; } this.primary = c; this.alpha = 1; this.renderColors(); this.renderPalette(); }, contextmenu: (e) => { e.preventDefault(); this.secondary = c; this.renderColors(); } } }))));
    el.appendChild(h('div.row-actions', h('button.btn.small', { type: 'button', title: 'Añadir el color principal', on: { click: () => { if (!this.palette.includes(this.primary) && this.palette.length < 256) { this.palette.push(this.primary); this.paletteKey = '__custom'; this.renderPalette(); } } } }, '＋ Color'),
      h('button.btn.small', { type: 'button', title: 'Reducir la capa a esta paleta', disabled: !this.doc, on: { click: () => this.filterDialog('palette') } }, 'Aplicar a la capa'),
      h('button.btn.small', { type: 'button', title: 'Descargar como .hex (Lospec/Aseprite)', on: { click: () => downloadBlob(new Blob([this.palette.map((c) => c.slice(1)).join('\n') + '\n'], { type: 'text/plain' }), 'paleta.hex') } }, '⬇ .hex')));
  }
  docColors() {
    const d = this.doc; if (!d) return [];
    const img = ctx2d(d.composite()).getImageData(0, 0, d.w, d.h).data, set = new Map();
    for (let i = 0; i < img.length && set.size < 256; i += 4) { if (img[i + 3] < 128) continue; const c = rgbToHex(img[i], img[i + 1], img[i + 2]); set.set(c, (set.get(c) || 0) + 1); }
    return Array.from(set.entries()).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  }
  renderLayers() {
    const el = this.layersEl, d = this.doc; if (!el) return; clear(el);
    el.appendChild(h('div.card-head', h('b.grow', 'Capas'),
      h('button.icon', { type: 'button', title: 'Nueva capa', disabled: !d, on: { click: () => this.layerOp('add') } }, '＋'), h('button.icon', { type: 'button', title: 'Duplicar', disabled: !d, on: { click: () => this.layerOp('dup') } }, '⧉'),
      h('button.icon', { type: 'button', title: 'Combinar hacia abajo', disabled: !d, on: { click: () => this.layerOp('merge') } }, '⤓'), h('button.icon', { type: 'button', title: 'Subir', disabled: !d, on: { click: () => this.layerOp('up') } }, '▲'),
      h('button.icon', { type: 'button', title: 'Bajar', disabled: !d, on: { click: () => this.layerOp('down') } }, '▼'), h('button.icon', { type: 'button', title: 'Borrar capa', disabled: !d, on: { click: () => this.layerOp('del') } }, '🗑')));
    if (!d) return;
    const L = d.curLayer;
    el.appendChild(h('div.layer-props', h('select', { title: 'Modo de fusión', on: { change: (e) => { d.pushDoc('Fusión'); L.blend = e.target.value; this.changed(true); } } }, BLENDS.map(([v, t]) => h('option', { value: v, selected: v === L.blend }, t))),
      h('label.opt', 'Opacidad', h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: L.opacity, on: { pointerdown: () => d.pushDoc('Opacidad de capa'), input: (e) => { L.opacity = +e.target.value; this.dirtyView = true; d.dirty = true; }, change: () => this.renderLayers() } })),
      h('label.chk', { title: 'Pintar solo sobre lo que ya tiene color' }, h('input', { type: 'checkbox', checked: L.alphaLock, on: { change: (e) => { L.alphaLock = e.target.checked; } } }), ' Bloquear alfa')));
    const list = h('div.layer-list');
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const ly = d.layers[i], th = makeCanvas(40, 40), tg = ctx2d(th), k = Math.min(40 / d.w, 40 / d.h);
      tg.imageSmoothingEnabled = !this.pixel; tg.drawImage(d.cel && d.frames[d.frame].cels[i], (40 - d.w * k) / 2, (40 - d.h * k) / 2, d.w * k, d.h * k);
      th.className = 'layer-th';
      const row = h('div.layer', { class: i === d.layer ? 'on' : null },
        h('button.icon', { type: 'button', title: ly.visible ? 'Ocultar' : 'Mostrar', on: { click: (e) => { e.stopPropagation(); ly.visible = !ly.visible; d.dirty = true; this.dirtyView = true; this.renderLayers(); } } }, ly.visible ? '👁' : '◌'),
        th, h('span.grow', { title: 'Doble clic: renombrar' }, ly.name + (ly.blend !== 'source-over' ? ' · ' + (BLENDS.find((b) => b[0] === ly.blend) || [0, ''])[1] : '') + (ly.opacity < 1 ? ' · ' + Math.round(ly.opacity * 100) + '%' : '')),
        h('button.icon', { type: 'button', title: ly.locked ? 'Desbloquear' : 'Bloquear', on: { click: (e) => { e.stopPropagation(); ly.locked = !ly.locked; this.renderLayers(); } } }, ly.locked ? '🔒' : '🔓'));
      row.onclick = () => { d.layer = i; this.renderLayers(); };
      row.ondblclick = async () => { const n = await pick('Renombrar capa', 'Nombre', null, ly.name); if (n) { ly.name = n.slice(0, 40); this.renderLayers(); } };
      list.appendChild(row);
    }
    el.appendChild(list);
  }
  renderFrames() {
    const el = this.framesEl, d = this.doc; if (!el) return; clear(el);
    el.hidden = !d || !this.pixel;
    if (!d || !this.pixel) return;
    const bar = h('div.frame-bar', h('b', '🎞 Fotogramas'),
      h('button.btn.small', { type: 'button', title: 'Reproducir / parar', on: { click: () => (this.playing ? this.stopAnim() : this.play()) } }, this.playing ? '■' : '▶'),
      h('button.icon', { type: 'button', title: 'Nuevo (vacío)', on: { click: () => this.frameOp('add') } }, '＋'), h('button.icon', { type: 'button', title: 'Duplicar', on: { click: () => this.frameOp('dup') } }, '⧉'),
      h('button.icon', { type: 'button', title: 'Mover a la izquierda', on: { click: () => this.frameOp('left') } }, '◀'), h('button.icon', { type: 'button', title: 'Mover a la derecha', on: { click: () => this.frameOp('right') } }, '▶'),
      h('button.icon', { type: 'button', title: 'Borrar', on: { click: () => this.frameOp('del') } }, '🗑'),
      h('label.opt', 'ms', h('input', { type: 'number', min: 10, max: 5000, value: d.frames[d.frame].duration, title: 'Duración de este fotograma', on: { keydown: (e) => e.stopPropagation(), change: (e) => { d.frames[d.frame].duration = Math.max(10, Math.min(5000, e.target.value | 0 || 100)); d.dirty = true; } } })),
      h('button.btn.small', { type: 'button', title: 'Poner la misma duración a todos', on: { click: () => { const v = d.frames[d.frame].duration; d.frames.forEach((f) => { f.duration = v; }); toast('Todos a ' + v + ' ms (' + Math.round(1000 / v) + ' fps)'); } } }, '= todos'),
      h('label.chk', h('input', { type: 'checkbox', checked: this.show.onion, on: { change: (e) => { this.show.onion = e.target.checked; this.dirtyView = true; } } }), ' Cebolla'));
    const strip = h('div.frame-strip');
    d.frames.forEach((fr, i) => {
      const th = makeCanvas(48, 48), tg = ctx2d(th), k = Math.min(48 / d.w, 48 / d.h); tg.imageSmoothingEnabled = false; tg.drawImage(d.composite(fr), (48 - d.w * k) / 2, (48 - d.h * k) / 2, d.w * k, d.h * k);
      const b = h('button.frame', { type: 'button', class: i === d.frame ? 'on' : null, title: 'Fotograma ' + (i + 1) + ' · ' + fr.duration + ' ms' }, th, h('span', String(i + 1)));
      b.onclick = () => { this.stopAnim(); d.frame = i; this.changed(true); };
      strip.appendChild(b);
    });
    el.appendChild(bar); el.appendChild(strip);
  }
  renderStatus(p) {
    const el = this.statusEl; if (!el) return;
    const d = this.doc; if (!d) { el.textContent = ''; return; }
    let s = Math.round(this.view.z * 100) + ' %';
    if (p && p.x >= 0 && p.y >= 0 && p.x < d.w && p.y < d.h) { const x = Math.floor(p.x), y = Math.floor(p.y), px = ctx2d(this.comp || d.cel).getImageData(x, y, 1, 1).data; s = x + ', ' + y + ' · ' + (px[3] ? rgbToHex(px[0], px[1], px[2]) + (px[3] < 255 ? ' α' + px[3] : '') : 'transparente') + ' · ' + s; }
    const b = d.selection && selectionBounds(d.selection); if (b) s += ' · selección ' + b.w + '×' + b.h;
    el.textContent = s;
  }
}

/* ---------------------------------------------------------------- utilidades */
function normRect(a, b, pixel) {
  if (pixel) { const x0 = Math.floor(Math.min(a.x, b.x)), y0 = Math.floor(Math.min(a.y, b.y)), x1 = Math.floor(Math.max(a.x, b.x)), y1 = Math.floor(Math.max(a.y, b.y)); return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }; }
  const x = Math.round(Math.min(a.x, b.x)), y = Math.round(Math.min(a.y, b.y)); return { x, y, w: Math.max(1, Math.round(Math.max(a.x, b.x)) - x), h: Math.max(1, Math.round(Math.max(a.y, b.y)) - y) };
}
function isTyping(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
function loadImage(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('imagen no válida')); i.src = url; }); }
function canvasBlob(c, type, q) { return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo codificar la imagen'))), type || 'image/png', q)); }
/** Pequeño diálogo de elección o texto */
async function pick(title, label, options, value) {
  let inp;
  const ok = await dialog(title, (b) => { b.appendChild(h('label.help', label)); inp = options ? h('select', options.map((o) => h('option', { value: o }, o))) : h('input', { type: 'text', value: value || '', maxlength: 60 }); b.appendChild(inp); }, [{ label: 'Cancelar', value: null }, { label: 'Aceptar', kind: 'primary', value: true }]);
  return ok ? inp.value.trim() : null;
}
