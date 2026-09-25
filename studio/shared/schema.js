/* UltraGame Studio · esquema compartido (editor + runtime + juegos exportados).
 * Define los tipos de nodo 2D/3D y sus propiedades, los comportamientos sin código, las condiciones y acciones
 * de las hojas de eventos, los efectos (filtros), los presets de partículas y el saneado de proyectos.
 * Todo son datos: el inspector del editor se genera a partir de aquí y el runtime valida con lo mismo. */
(function (root) {
  'use strict';
  var S = {};
  S.FORMAT = 'ultragame-project';
  S.VERSION = 1;

  /* --------------------------------------------------------------- utilidades de validación */
  var FORBIDDEN = { __proto__: 1, prototype: 1, constructor: 1 };
  S.isForbiddenKey = function (k) { return Object.prototype.hasOwnProperty.call(FORBIDDEN, k) || k === '__proto__'; };
  S.num = function (v, def, min, max) { v = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN); if (!isFinite(v)) v = def; if (min !== undefined && v < min) v = min; if (max !== undefined && v > max) v = max; return v; };
  S.str = function (v, def, max) { if (typeof v !== 'string') v = v === undefined || v === null ? def : String(v); return v.length > (max || 20000) ? v.slice(0, max || 20000) : v; };
  S.bool = function (v, def) { return typeof v === 'boolean' ? v : def; };
  S.color = function (v, def) { if (typeof v === 'number' && isFinite(v)) return '#' + ('000000' + (Math.max(0, Math.min(0xffffff, v | 0))).toString(16)).slice(-6); return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : def; };
  S.colorNum = function (c) { return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? parseInt(c.slice(1), 16) : (typeof c === 'number' ? c : 0xffffff); };
  S.id = function (v) { return typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null; };
  S.uid = function (prefix) {
    var a = new Uint8Array(6);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a); else for (var i = 0; i < 6; i++) a[i] = Math.floor(Math.random() * 256);
    return (prefix || 'n') + Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  };
  S.vec3 = function (v, def) { def = def || [0, 0, 0]; if (!Array.isArray(v) || v.length !== 3) return def.slice(); return [S.num(v[0], def[0], -1e6, 1e6), S.num(v[1], def[1], -1e6, 1e6), S.num(v[2], def[2], -1e6, 1e6)]; };

  /* --------------------------------------------------------------- propiedades comunes */
  // tipos de campo: number, text, textarea, color, bool, select (options), asset (assetType), vec3, tag
  S.TRANSFORM_2D = [
    { key: 'x', label: 'X', type: 'number', def: 0, step: 1 }, { key: 'y', label: 'Y', type: 'number', def: 0, step: 1 },
    { key: 'rotation', label: 'Rotación (°)', type: 'number', def: 0, step: 1 },
    { key: 'scaleX', label: 'Escala X', type: 'number', def: 1, step: 0.05 }, { key: 'scaleY', label: 'Escala Y', type: 'number', def: 1, step: 0.05 },
    { key: 'alpha', label: 'Opacidad', type: 'number', def: 1, min: 0, max: 1, step: 0.05 },
    { key: 'depth', label: 'Profundidad (orden)', type: 'number', def: 0, step: 1 },
    { key: 'blend', label: 'Mezcla', type: 'select', def: 'normal', options: [['normal', 'Normal'], ['add', 'Aditiva'], ['multiply', 'Multiplicar'], ['screen', 'Pantalla']] },
    { key: 'hud', label: 'En el HUD (fijo en pantalla)', type: 'bool', def: false }
  ];
  S.TRANSFORM_3D = [
    { key: 'position', label: 'Posición', type: 'vec3', def: [0, 0, 0], step: 0.1 },
    { key: 'rotation', label: 'Rotación (°)', type: 'vec3', def: [0, 0, 0], step: 1 },
    { key: 'scale', label: 'Escala', type: 'vec3', def: [1, 1, 1], step: 0.05 }
  ];
  var MAT3D = [
    { key: 'color', label: 'Color', type: 'color', def: '#8aa4c8' },
    { key: 'map', label: 'Textura', type: 'asset', assetType: 'image', def: '' },
    { key: 'uvScale', label: 'Repetir textura', type: 'number', def: 1, min: 0.01, max: 1000, step: 0.25 },
    { key: 'metalness', label: 'Metálico', type: 'number', def: 0, min: 0, max: 1, step: 0.05 },
    { key: 'roughness', label: 'Rugosidad', type: 'number', def: 0.7, min: 0, max: 1, step: 0.05 },
    { key: 'emissive', label: 'Emisión', type: 'color', def: '#000000' },
    { key: 'emissiveIntensity', label: 'Intensidad de emisión', type: 'number', def: 1, min: 0, max: 50, step: 0.1 },
    { key: 'opacity', label: 'Opacidad', type: 'number', def: 1, min: 0, max: 1, step: 0.05 },
    { key: 'shading', label: 'Sombreado', type: 'select', def: 'standard', options: [['standard', 'PBR (realista)'], ['toon', 'Cartoon'], ['unlit', 'Sin luz'], ['flat', 'Facetado']] },
    { key: 'outline', label: 'Contorno cartoon (0 = no)', type: 'number', def: 0, min: 0, max: 0.2, step: 0.005 },
    { key: 'castShadow', label: 'Proyecta sombra', type: 'bool', def: true },
    { key: 'receiveShadow', label: 'Recibe sombra', type: 'bool', def: true }
  ];

  /* --------------------------------------------------------------- tipos de nodo */
  S.NODE_TYPES = {
    /* ---- 2D (también válidos en escenas 3D como HUD) ---- */
    sprite: { kind: '2d', label: 'Sprite', icon: '🖼️', group: 'Básicos 2D', props: [
      { key: 'asset', label: 'Imagen', type: 'asset', assetType: 'image', def: '' },
      { key: 'frame', label: 'Fotograma', type: 'number', def: 0, min: 0, step: 1 },
      { key: 'width', label: 'Ancho (0 = original)', type: 'number', def: 0, min: 0, step: 1 },
      { key: 'height', label: 'Alto (0 = original)', type: 'number', def: 0, min: 0, step: 1 },
      { key: 'tint', label: 'Tinte', type: 'color', def: '#ffffff' },
      { key: 'flipX', label: 'Voltear horizontal', type: 'bool', def: false }, { key: 'flipY', label: 'Voltear vertical', type: 'bool', def: false },
      { key: 'originX', label: 'Origen X (0..1)', type: 'number', def: 0.5, min: 0, max: 1, step: 0.05 }, { key: 'originY', label: 'Origen Y (0..1)', type: 'number', def: 0.5, min: 0, max: 1, step: 0.05 },
      { key: 'anim', label: 'Animación: fotogramas (ej. 0-3 ó 0,1,2)', type: 'text', def: '' },
      { key: 'animFps', label: 'Fotogramas por segundo', type: 'number', def: 8, min: 0.1, max: 120, step: 1 },
      { key: 'animLoop', label: 'Repetir animación', type: 'bool', def: true }
    ] },
    shape: { kind: '2d', label: 'Forma', icon: '⬛', group: 'Básicos 2D', props: [
      { key: 'shape', label: 'Forma', type: 'select', def: 'rect', options: [['rect', 'Rectángulo'], ['roundrect', 'Rect. redondeado'], ['circle', 'Círculo'], ['ellipse', 'Elipse'], ['triangle', 'Triángulo'], ['star', 'Estrella']] },
      { key: 'width', label: 'Ancho', type: 'number', def: 96, min: 1, step: 1 }, { key: 'height', label: 'Alto', type: 'number', def: 96, min: 1, step: 1 },
      { key: 'radius', label: 'Radio / esquinas', type: 'number', def: 16, min: 0, step: 1 },
      { key: 'points', label: 'Puntas (estrella)', type: 'number', def: 5, min: 3, max: 40, step: 1 },
      { key: 'fill', label: 'Relleno', type: 'color', def: '#4c6ef5' }, { key: 'fillAlpha', label: 'Opacidad del relleno', type: 'number', def: 1, min: 0, max: 1, step: 0.05 },
      { key: 'stroke', label: 'Borde', type: 'color', def: '#ffffff' }, { key: 'strokeWidth', label: 'Grosor del borde', type: 'number', def: 0, min: 0, max: 64, step: 1 }
    ] },
    text: { kind: '2d', label: 'Texto', icon: '🔤', group: 'Básicos 2D', props: [
      { key: 'text', label: 'Texto ({variable} se sustituye)', type: 'textarea', def: 'Hola' },
      { key: 'size', label: 'Tamaño', type: 'number', def: 32, min: 4, max: 400, step: 1 },
      { key: 'color', label: 'Color', type: 'color', def: '#ffffff' },
      { key: 'font', label: 'Fuente', type: 'select', def: 'system-ui, sans-serif', options: [['system-ui, sans-serif', 'Sistema'], ['Georgia, serif', 'Serif'], ['ui-monospace, Consolas, monospace', 'Monoespaciada'], ['Impact, "Arial Black", sans-serif', 'Impacto'], ['"Comic Sans MS", cursive', 'Informal']] },
      { key: 'bold', label: 'Negrita', type: 'bool', def: true },
      { key: 'align', label: 'Alineación', type: 'select', def: 'center', options: [['left', 'Izquierda'], ['center', 'Centro'], ['right', 'Derecha']] },
      { key: 'strokeColor', label: 'Contorno', type: 'color', def: '#000000' }, { key: 'strokeWidth', label: 'Grosor del contorno', type: 'number', def: 4, min: 0, max: 40, step: 1 },
      { key: 'wrap', label: 'Ancho de línea (0 = sin ajuste)', type: 'number', def: 0, min: 0, step: 10 }
    ] },
    tilesprite: { kind: '2d', label: 'Fondo en mosaico', icon: '🧱', group: 'Básicos 2D', props: [
      { key: 'asset', label: 'Imagen', type: 'asset', assetType: 'image', def: '' },
      { key: 'width', label: 'Ancho', type: 'number', def: 1280, min: 1, step: 1 }, { key: 'height', label: 'Alto', type: 'number', def: 720, min: 1, step: 1 },
      { key: 'scrollX', label: 'Desplazamiento X (px/s)', type: 'number', def: 0, step: 5 }, { key: 'scrollY', label: 'Desplazamiento Y (px/s)', type: 'number', def: 0, step: 5 },
      { key: 'tileScale', label: 'Escala del mosaico', type: 'number', def: 1, min: 0.01, step: 0.1 }
    ] },
    particles: { kind: '2d', label: 'Partículas', icon: '✨', group: 'Efectos 2D', props: [
      { key: 'preset', label: 'Tipo', type: 'select', def: 'fire', options: null /* se rellena con PARTICLES_2D */ },
      { key: 'asset', label: 'Textura (opcional)', type: 'asset', assetType: 'image', def: '' },
      { key: 'color1', label: 'Color inicial', type: 'color', def: '#ffd43b' }, { key: 'color2', label: 'Color final', type: 'color', def: '#ff4d00' },
      { key: 'useColors', label: 'Usar estos colores', type: 'bool', def: false },
      { key: 'rate', label: 'Intensidad (x)', type: 'number', def: 1, min: 0.05, max: 10, step: 0.1 },
      { key: 'scale', label: 'Tamaño (x)', type: 'number', def: 1, min: 0.05, max: 20, step: 0.1 },
      { key: 'emitting', label: 'Emitiendo al empezar', type: 'bool', def: true },
      { key: 'width', label: 'Ancho de la zona (lluvia/nieve)', type: 'number', def: 0, min: 0, step: 10 }
    ] },
    button: { kind: '2d', label: 'Botón', icon: '🔘', group: 'Interfaz', props: [
      { key: 'text', label: 'Texto', type: 'text', def: 'Jugar' },
      { key: 'width', label: 'Ancho', type: 'number', def: 220, min: 20, step: 1 }, { key: 'height', label: 'Alto', type: 'number', def: 60, min: 16, step: 1 },
      { key: 'color', label: 'Color', type: 'color', def: '#4c6ef5' }, { key: 'textColor', label: 'Color del texto', type: 'color', def: '#ffffff' },
      { key: 'fontSize', label: 'Tamaño del texto', type: 'number', def: 24, min: 6, max: 200, step: 1 },
      { key: 'goto', label: 'Al pulsar ir a la escena (opcional)', type: 'scene', def: '' }
    ] },
    bar: { kind: '2d', label: 'Barra (vida, carga)', icon: '📊', group: 'Interfaz', props: [
      { key: 'width', label: 'Ancho', type: 'number', def: 240, min: 4, step: 1 }, { key: 'height', label: 'Alto', type: 'number', def: 22, min: 2, step: 1 },
      { key: 'color', label: 'Color', type: 'color', def: '#e03131' }, { key: 'back', label: 'Fondo', type: 'color', def: '#1b1e2b' },
      { key: 'variable', label: 'Variable que muestra', type: 'text', def: 'vida' }, { key: 'max', label: 'Valor máximo', type: 'number', def: 100, min: 0.0001, step: 1 }
    ] },
    container: { kind: '2d', label: 'Grupo 2D', icon: '📁', group: 'Básicos 2D', props: [] },
    light2d: { kind: '2d', label: 'Luz 2D (con sombras)', icon: '💡', group: 'Luces 2D', props: [
      { key: 'radius', label: 'Radio', type: 'number', def: 220, min: 4, max: 4000, step: 5 },
      { key: 'color', label: 'Color', type: 'color', def: '#ffe0a8' },
      { key: 'intensity', label: 'Intensidad (0..1)', type: 'number', def: 1, min: 0, max: 1, step: 0.05 },
      { key: 'shadows', label: 'Proyecta sombras', type: 'bool', def: true },
      { key: 'flicker', label: 'Parpadeo (antorcha)', type: 'number', def: 0, min: 0, max: 1, step: 0.05 }
    ] },
    clouds2d: { kind: '2d', label: 'Nubes (parallax)', icon: '☁️', group: 'Efectos 2D', props: [
      { key: 'layers', label: 'Capas', type: 'number', def: 2, min: 1, max: 5, step: 1 },
      { key: 'speed', label: 'Viento (px/s)', type: 'number', def: 12, min: -500, max: 500, step: 1 },
      { key: 'coverage', label: 'Cobertura (0..1)', type: 'number', def: 0.5, min: 0, max: 1, step: 0.05 },
      { key: 'parallax', label: 'Parallax (0..1)', type: 'number', def: 0.15, min: 0, max: 1, step: 0.05 },
      { key: 'color', label: 'Color', type: 'color', def: '#ffffff' }, { key: 'alpha', label: 'Opacidad', type: 'number', def: 0.9, min: 0, max: 1, step: 0.05 },
      { key: 'height', label: 'Alto de la franja', type: 'number', def: 170, min: 20, max: 2000, step: 10 }
    ] },
    sky2d: { kind: '2d', label: 'Cielo en degradado', icon: '🌅', group: 'Efectos 2D', props: [
      { key: 'top', label: 'Arriba', type: 'color', def: '#4dabf7' }, { key: 'bottom', label: 'Abajo', type: 'color', def: '#d0ebff' }
    ] },
    tilemap: { kind: '2d', label: 'Mapa de Tiled', icon: '🗺️', group: 'Mapas', props: [
      { key: 'asset', label: 'Mapa (.tmj/.json de Tiled)', type: 'asset', assetType: 'tilemap', def: '' },
      { key: 'tileset', label: 'Imagen del tileset', type: 'asset', assetType: 'image', def: '' },
      { key: 'collide', label: 'Capas sólidas (nombres, coma)', type: 'text', def: '' },
      { key: 'collideAll', label: 'Todas las capas son sólidas', type: 'bool', def: false }
    ] },
    /* ---- 3D ---- */
    mesh3d: { kind: '3d', label: 'Primitiva 3D', icon: '🧊', group: 'Objetos 3D', props: [
      { key: 'shape', label: 'Forma', type: 'select', def: 'box', options: [['box', 'Caja'], ['sphere', 'Esfera'], ['plane', 'Plano'], ['cylinder', 'Cilindro'], ['cone', 'Cono'], ['capsule', 'Cápsula'], ['torus', 'Toro']] },
      { key: 'sizeX', label: 'Ancho', type: 'number', def: 1, min: 0.001, step: 0.1 }, { key: 'sizeY', label: 'Alto', type: 'number', def: 1, min: 0.001, step: 0.1 }, { key: 'sizeZ', label: 'Fondo', type: 'number', def: 1, min: 0.001, step: 0.1 },
      { key: 'segments', label: 'Segmentos', type: 'number', def: 24, min: 3, max: 128, step: 1 }
    ].concat(MAT3D) },
    model: { kind: '3d', label: 'Modelo (Blender/glTF/OBJ)', icon: '🗿', group: 'Objetos 3D', props: [
      { key: 'asset', label: 'Modelo', type: 'asset', assetType: 'model', def: '' },
      { key: 'clip', label: 'Animación al empezar', type: 'text', def: '' },
      { key: 'animSpeed', label: 'Velocidad de animación', type: 'number', def: 1, min: 0, max: 10, step: 0.1 },
      { key: 'tint', label: 'Tinte (blanco = original)', type: 'color', def: '#ffffff' },
      { key: 'castShadow', label: 'Proyecta sombra', type: 'bool', def: true }, { key: 'receiveShadow', label: 'Recibe sombra', type: 'bool', def: true }
    ] },
    light: { kind: '3d', label: 'Luz', icon: '💡', group: 'Luces y cámara', props: [
      { key: 'light', label: 'Tipo', type: 'select', def: 'point', options: [['directional', 'Sol (direccional)'], ['point', 'Puntual'], ['spot', 'Foco'], ['hemisphere', 'Cielo/suelo'], ['ambient', 'Ambiente']] },
      { key: 'color', label: 'Color', type: 'color', def: '#fff4e0' }, { key: 'groundColor', label: 'Color del suelo (cielo/suelo)', type: 'color', def: '#5a4a3a' },
      { key: 'intensity', label: 'Intensidad', type: 'number', def: 2, min: 0, max: 100, step: 0.1 },
      { key: 'range', label: 'Alcance', type: 'number', def: 12, min: 0.1, max: 1000, step: 0.5 },
      { key: 'angle', label: 'Apertura del foco (°)', type: 'number', def: 35, min: 1, max: 89, step: 1 },
      { key: 'castShadow', label: 'Sombras (sol)', type: 'bool', def: true }, { key: 'shadowSize', label: 'Zona de sombras (sol)', type: 'number', def: 40, min: 2, max: 1000, step: 1 }
    ] },
    particles3d: { kind: '3d', label: 'Partículas 3D', icon: '🔥', group: 'Efectos 3D', props: [
      { key: 'preset', label: 'Tipo', type: 'select', def: 'fire', options: [['fire', 'Fuego'], ['smoke', 'Humo'], ['magic', 'Magia'], ['sparks', 'Chispas (ráfagas)'], ['rain', 'Lluvia'], ['snow', 'Nieve'], ['trail', 'Estela'], ['dust', 'Polvo'], ['explosion', 'Explosión (ráfaga)']] },
      { key: 'rate', label: 'Intensidad (x)', type: 'number', def: 1, min: 0.05, max: 10, step: 0.1 },
      { key: 'size', label: 'Tamaño (x)', type: 'number', def: 1, min: 0.05, max: 20, step: 0.1 },
      { key: 'useColors', label: 'Colores propios', type: 'bool', def: false },
      { key: 'color1', label: 'Color inicial', type: 'color', def: '#ffe08a' }, { key: 'color2', label: 'Color final', type: 'color', def: '#ff5a1f' },
      { key: 'emitting', label: 'Emitiendo al empezar', type: 'bool', def: true }
    ] },
    sprite3d: { kind: '3d', label: 'Imagen 3D (siempre de cara)', icon: '🪧', group: 'Objetos 3D', props: [
      { key: 'asset', label: 'Imagen', type: 'asset', assetType: 'image', def: '' },
      { key: 'width', label: 'Ancho', type: 'number', def: 1, min: 0.01, step: 0.1 }, { key: 'height', label: 'Alto', type: 'number', def: 1, min: 0.01, step: 0.1 }
    ] },
    terrain: { kind: '3d', label: 'Terreno', icon: '⛰️', group: 'Mapas', props: [
      { key: 'width', label: 'Ancho', type: 'number', def: 80, min: 1, max: 4000, step: 1 }, { key: 'depth', label: 'Fondo', type: 'number', def: 80, min: 1, max: 4000, step: 1 },
      { key: 'segments', label: 'Detalle', type: 'number', def: 64, min: 2, max: 256, step: 1 },
      { key: 'height', label: 'Altura de montañas', type: 'number', def: 6, min: 0, max: 500, step: 0.5 },
      { key: 'noiseScale', label: 'Tamaño de las colinas', type: 'number', def: 18, min: 1, max: 1000, step: 1 },
      { key: 'flatCenter', label: 'Centro llano (radio)', type: 'number', def: 10, min: 0, max: 2000, step: 1 },
      { key: 'seed', label: 'Semilla', type: 'text', def: 'mapa' },
      { key: 'color', label: 'Color', type: 'color', def: '#6a9a4a' }, { key: 'map', label: 'Textura', type: 'asset', assetType: 'image', def: '' },
      { key: 'uvScale', label: 'Repetir textura', type: 'number', def: 12, min: 0.01, max: 1000, step: 1 }
    ] },
    gridlevel: { kind: '3d', label: 'Nivel por rejilla (laberinto)', icon: '🏰', group: 'Mapas', props: [
      { key: 'rows', label: 'Mapa: # muro · . suelo · C caja · espacio vacío', type: 'textarea', def: '##########\n#........#\n#..C.....#\n#....##..#\n#........#\n##########' },
      { key: 'cell', label: 'Tamaño de celda', type: 'number', def: 2, min: 0.1, max: 100, step: 0.1 },
      { key: 'wallHeight', label: 'Altura de muros', type: 'number', def: 3, min: 0.1, max: 100, step: 0.1 },
      { key: 'wallColor', label: 'Color de muros', type: 'color', def: '#9a8f86' }, { key: 'floorColor', label: 'Color del suelo', type: 'color', def: '#5f6b73' },
      { key: 'crateColor', label: 'Color de cajas', type: 'color', def: '#b07a3c' },
      { key: 'wallMap', label: 'Textura de muros', type: 'asset', assetType: 'image', def: '' }, { key: 'floorMap', label: 'Textura del suelo', type: 'asset', assetType: 'image', def: '' },
      { key: 'ceiling', label: 'Con techo', type: 'bool', def: false }
    ] },
    group3d: { kind: '3d', label: 'Grupo 3D', icon: '📦', group: 'Objetos 3D', props: [] },
    grass: { kind: '3d', label: 'Hierba con viento', icon: '🌾', group: 'Naturaleza', props: [
      { key: 'width', label: 'Ancho', type: 'number', def: 40, min: 1, max: 2000, step: 1 }, { key: 'depth', label: 'Fondo', type: 'number', def: 40, min: 1, max: 2000, step: 1 },
      { key: 'density', label: 'Densidad (matas/m²)', type: 'number', def: 2.5, min: 0.1, max: 30, step: 0.1 },
      { key: 'heightMin', label: 'Altura mínima', type: 'number', def: 0.28, min: 0.02, max: 5, step: 0.02 }, { key: 'heightMax', label: 'Altura máxima', type: 'number', def: 0.6, min: 0.02, max: 5, step: 0.02 },
      { key: 'color', label: 'Color de la base', type: 'color', def: '#3f7f2e' }, { key: 'tipColor', label: 'Color de la punta', type: 'color', def: '#a9d86b' },
      { key: 'wind', label: 'Viento', type: 'number', def: 0.08, min: 0, max: 1, step: 0.01 }, { key: 'seed', label: 'Semilla', type: 'text', def: 'hierba' }
    ] },
    water: { kind: '3d', label: 'Agua con olas', icon: '🌊', group: 'Naturaleza', props: [
      { key: 'width', label: 'Ancho', type: 'number', def: 30, min: 1, max: 5000, step: 1 }, { key: 'depth', label: 'Fondo', type: 'number', def: 30, min: 1, max: 5000, step: 1 },
      { key: 'color', label: 'Color', type: 'color', def: '#1d5f93' }, { key: 'opacity', label: 'Opacidad', type: 'number', def: 0.86, min: 0.05, max: 1, step: 0.05 },
      { key: 'waveHeight', label: 'Altura de las olas', type: 'number', def: 0.12, min: 0, max: 5, step: 0.01 }
    ] },
    scatter: { kind: '3d', label: 'Bosque / dispersión de modelos', icon: '🌲', group: 'Naturaleza', props: [
      { key: 'asset', label: 'Modelo (árbol, roca, arbusto…)', type: 'asset', assetType: 'model', def: '' },
      { key: 'count', label: 'Cantidad', type: 'number', def: 40, min: 1, max: 5000, step: 1 },
      { key: 'width', label: 'Ancho de la zona', type: 'number', def: 60, min: 1, max: 5000, step: 1 }, { key: 'depth', label: 'Fondo de la zona', type: 'number', def: 60, min: 1, max: 5000, step: 1 },
      { key: 'scaleMin', label: 'Escala mínima', type: 'number', def: 0.8, min: 0.01, max: 100, step: 0.05 }, { key: 'scaleMax', label: 'Escala máxima', type: 'number', def: 1.4, min: 0.01, max: 100, step: 0.05 },
      { key: 'minDistance', label: 'Separación mínima', type: 'number', def: 2, min: 0, max: 100, step: 0.5 },
      { key: 'wind', label: 'Viento (hojas)', type: 'number', def: 0.01, min: 0, max: 0.5, step: 0.005 }, { key: 'seed', label: 'Semilla', type: 'text', def: 'bosque' }
    ] },
    camera3d: { kind: '3d', label: 'Cámara', icon: '🎥', group: 'Luces y cámara', props: [
      { key: 'fov', label: 'Campo de visión (°)', type: 'number', def: 60, min: 10, max: 150, step: 1 },
      { key: 'target', label: 'Mira hacia', type: 'vec3', def: [0, 0, 0], step: 0.1 },
      { key: 'far', label: 'Distancia máxima', type: 'number', def: 1000, min: 1, max: 100000, step: 10 }
    ] }
  };

  /* --------------------------------------------------------------- partículas 2D */
  S.PARTICLES_2D = {
    fire: { label: 'Fuego', cfg: { speed: { min: 40, max: 120 }, angle: { min: 250, max: 290 }, lifespan: { min: 400, max: 900 }, scale: { start: 0.9, end: 0.05 }, alpha: { start: 0.9, end: 0 }, color: [0xffe08a, 0xff8a1f, 0xd9480f], blendMode: 'add', frequency: 16, quantity: 2, gravityY: -60, x: { min: -10, max: 10 } } },
    smoke: { label: 'Humo', cfg: { speed: { min: 20, max: 60 }, angle: { min: 250, max: 290 }, lifespan: { min: 1200, max: 2400 }, scale: { start: 0.6, end: 2.2 }, alpha: { start: 0.45, end: 0 }, color: [0x999999, 0x444444], frequency: 60, quantity: 1, gravityY: -20 } },
    sparks: { label: 'Chispas', cfg: { speed: { min: 150, max: 380 }, lifespan: { min: 250, max: 650 }, scale: { start: 0.3, end: 0 }, alpha: { start: 1, end: 0 }, color: [0xffffff, 0xffc94d], blendMode: 'add', frequency: 30, quantity: 3, gravityY: 500 } },
    magic: { label: 'Magia', cfg: { speed: { min: 10, max: 60 }, lifespan: { min: 600, max: 1400 }, scale: { start: 0.5, end: 0 }, alpha: { start: 1, end: 0 }, color: [0x8ec5ff, 0xd07bff], blendMode: 'add', frequency: 25, quantity: 1, x: { min: -24, max: 24 }, y: { min: -24, max: 24 } } },
    rain: { label: 'Lluvia', cfg: { speedY: { min: 700, max: 900 }, speedX: { min: -40, max: -20 }, lifespan: 1200, scale: { start: 0.12, end: 0.12 }, alpha: { start: 0.5, end: 0.5 }, color: [0xaec8e8], frequency: 5, quantity: 4, stretch: 8, x: { min: -700, max: 700 } } },
    snow: { label: 'Nieve', cfg: { speedY: { min: 40, max: 90 }, speedX: { min: -20, max: 20 }, lifespan: 9000, scale: { start: 0.25, end: 0.25 }, alpha: { start: 0.9, end: 0.9 }, color: [0xffffff], frequency: 40, quantity: 2, x: { min: -700, max: 700 } } },
    confetti: { label: 'Confeti', cfg: { speed: { min: 200, max: 420 }, angle: { min: 230, max: 310 }, lifespan: { min: 1500, max: 2600 }, scale: { start: 0.35, end: 0.25 }, alpha: { start: 1, end: 0.8 }, tint: [0xff6b6b, 0xffd43b, 0x69db7c, 0x4dabf7, 0xda77f2], frequency: 30, quantity: 3, gravityY: 420, rotate: { start: 0, end: 720 } } },
    bubbles: { label: 'Burbujas', cfg: { speed: { min: 20, max: 60 }, angle: { min: 260, max: 280 }, lifespan: { min: 2000, max: 3500 }, scale: { start: 0.2, end: 0.6 }, alpha: { start: 0.6, end: 0 }, color: [0xbde0fe], frequency: 120, quantity: 1, gravityY: -30, x: { min: -40, max: 40 } } },
    stars: { label: 'Estrellas (fondo)', cfg: { speedY: { min: 60, max: 300 }, lifespan: 5000, scale: { start: 0.15, end: 0.15 }, alpha: { start: 0.9, end: 0.9 }, color: [0xffffff], frequency: 50, quantity: 1, x: { min: -700, max: 700 } } },
    explosion: { label: 'Explosión (ráfaga)', cfg: { speed: { min: 80, max: 420 }, lifespan: { min: 300, max: 900 }, scale: { start: 1.1, end: 0 }, alpha: { start: 1, end: 0 }, color: [0xfff1b0, 0xff3b10], blendMode: 'add', frequency: -1, quantity: 40 } },
    trail: { label: 'Estela', cfg: { speed: { min: 0, max: 15 }, lifespan: { min: 250, max: 450 }, scale: { start: 0.5, end: 0 }, alpha: { start: 0.7, end: 0 }, color: [0x9be7ff, 0x3f8cff], blendMode: 'add', frequency: 12, quantity: 1 } }
  };
  S.NODE_TYPES.particles.props[0].options = Object.keys(S.PARTICLES_2D).map(function (k) { return [k, S.PARTICLES_2D[k].label]; });

  /* --------------------------------------------------------------- física */
  S.PHYSICS_2D = [
    { key: 'type', label: 'Física', type: 'select', def: 'none', options: [['none', 'Ninguna'], ['dynamic', 'Dinámica (cae, choca)'], ['static', 'Estática (suelo, muro)'], ['kinematic', 'Cinemática (se mueve sin gravedad)']] },
    { key: 'gravity', label: 'Le afecta la gravedad', type: 'bool', def: true, types: ['dynamic'] },
    { key: 'bounce', label: 'Rebote', type: 'number', def: 0, min: 0, max: 1, step: 0.05 },
    { key: 'drag', label: 'Rozamiento del aire', type: 'number', def: 0, min: 0, max: 5000, step: 10, types: ['dynamic', 'kinematic'] },
    { key: 'worldBounds', label: 'Choca con los bordes', type: 'bool', def: true, types: ['dynamic', 'kinematic'] },
    // forma del cuerpo (lo que choca): por defecto se ajusta a los píxeles visibles del sprite
    { key: 'fit', label: 'Tamaño del cuerpo', type: 'select', def: 'trim', options: [['trim', 'Ajustado al dibujo (sin bordes transparentes)'], ['full', 'Toda la imagen'], ['custom', 'A medida']] },
    { key: 'bodyW', label: 'Ancho del cuerpo (0 = auto)', type: 'number', def: 0, min: 0, max: 100000, step: 1, when: { key: 'fit', eq: 'custom' } },
    { key: 'bodyH', label: 'Alto del cuerpo (0 = auto)', type: 'number', def: 0, min: 0, max: 100000, step: 1, when: { key: 'fit', eq: 'custom' } },
    { key: 'bodyX', label: 'Desplazamiento X del cuerpo', type: 'number', def: 0, min: -100000, max: 100000, step: 1, when: { key: 'fit', eq: 'custom' } },
    { key: 'bodyY', label: 'Desplazamiento Y del cuerpo', type: 'number', def: 0, min: -100000, max: 100000, step: 1, when: { key: 'fit', eq: 'custom' } },
    { key: 'circle', label: 'Cuerpo circular', type: 'bool', def: false },
    { key: 'oneWay', label: 'Plataforma de un sentido (se atraviesa desde abajo)', type: 'bool', def: false, types: ['static', 'kinematic'], engine: 'arcade' },
    { key: 'pushable', label: 'Se puede empujar', type: 'bool', def: true, types: ['dynamic'], engine: 'arcade' },
    { key: 'solid', label: 'Sólido para otros dinámicos', type: 'bool', def: false, types: ['dynamic', 'kinematic'], engine: 'arcade' },
    // solo con el motor de cuerpos rígidos (escena 2D con «Física: cuerpos rígidos»)
    { key: 'density', label: 'Densidad (rígida)', type: 'number', def: 1, min: 0.01, max: 1000, step: 0.1, engine: 'rigid' },
    { key: 'friction', label: 'Fricción (rígida)', type: 'number', def: 0.4, min: 0, max: 5, step: 0.05, engine: 'rigid' },
    { key: 'fixedRotation', label: 'No gira (rígida)', type: 'bool', def: false, engine: 'rigid' },
    // luces 2D: el objeto tapa la luz
    { key: 'shadow', label: 'Proyecta sombra (luces 2D)', type: 'bool', def: false, always: true }
  ];
  S.PHYSICS_3D = [
    { key: 'type', label: 'Física', type: 'select', def: 'none', options: [['none', 'Ninguna'], ['static', 'Estática (caja)'], ['mesh', 'Estática exacta (malla: casas, rampas)'], ['body', 'Cuerpo dinámico'], ['character', 'Personaje'], ['trigger', 'Zona (sin choque)']] },
    { key: 'shape', label: 'Forma del cuerpo', type: 'select', def: 'box', options: [['box', 'Caja'], ['sphere', 'Esfera']], types: ['body'] },
    { key: 'mass', label: 'Masa', type: 'number', def: 1, min: 0.01, max: 10000, step: 0.1, types: ['body'] },
    { key: 'bounce', label: 'Rebote', type: 'number', def: 0.2, min: 0, max: 1, step: 0.05, types: ['static', 'mesh', 'body'] },
    { key: 'radius', label: 'Radio (personaje/esfera)', type: 'number', def: 0.4, min: 0.05, max: 50, step: 0.05, types: ['character', 'body'] },
    { key: 'height', label: 'Altura (personaje)', type: 'number', def: 1.8, min: 0.1, max: 50, step: 0.05, types: ['character'] }
  ];

  /* --------------------------------------------------------------- comportamientos (sin código) */
  S.BEHAVIORS = {
    platformer: { kind: '2d', label: 'Jugador de plataformas', icon: '🏃', desc: 'Flechas/WASD para moverse, Espacio/↑/W para saltar. Necesita física dinámica.', params: [
      { key: 'speed', label: 'Velocidad', type: 'number', def: 260, min: 0, step: 10 }, { key: 'jump', label: 'Fuerza de salto', type: 'number', def: 560, min: 0, step: 10 },
      { key: 'doubleJump', label: 'Doble salto', type: 'bool', def: false }, { key: 'flip', label: 'Voltear al girar', type: 'bool', def: true }] },
    topdown: { kind: '2d', label: 'Movimiento en 8 direcciones', icon: '🕹️', desc: 'Flechas/WASD o joystick táctil (vista cenital).', params: [
      { key: 'speed', label: 'Velocidad', type: 'number', def: 240, min: 0, step: 10 }, { key: 'rotate', label: 'Girar hacia donde va', type: 'bool', def: false }] },
    bullet: { kind: '2d', label: 'Proyectil', icon: '➡️', desc: 'Avanza en la dirección de su rotación.', params: [
      { key: 'speed', label: 'Velocidad', type: 'number', def: 500, step: 10 }, { key: 'life', label: 'Vida (s, 0 = infinita)', type: 'number', def: 3, min: 0, step: 0.1 }] },
    move: { kind: 'both', label: 'Moverse en una dirección', icon: '⏩', desc: 'Velocidad constante (no depende de la rotación). En 3D: X y Z.', params: [
      { key: 'vx', label: 'Velocidad X', type: 'number', def: -200, step: 10 }, { key: 'vy', label: 'Velocidad Y (Z en 3D)', type: 'number', def: 0, step: 10 },
      { key: 'life', label: 'Vida (s, 0 = infinita)', type: 'number', def: 0, min: 0, step: 0.1 }] },
    rotate: { kind: 'both', label: 'Girar sin parar', icon: '🔄', desc: 'En 3D gira sobre el eje Y.', params: [{ key: 'speed', label: 'Grados por segundo', type: 'number', def: 90, step: 5 }] },
    sine: { kind: 'both', label: 'Oscilar (flotar)', icon: '〰️', desc: 'Sube y baja suavemente (u otra propiedad).', params: [
      { key: 'prop', label: 'Propiedad', type: 'select', def: 'y', options: [['y', 'Vertical'], ['x', 'Horizontal'], ['angle', 'Ángulo'], ['alpha', 'Opacidad'], ['scale', 'Tamaño']] },
      { key: 'amplitude', label: 'Amplitud', type: 'number', def: 12, step: 1 }, { key: 'period', label: 'Periodo (s)', type: 'number', def: 1.6, min: 0.05, step: 0.1 }] },
    wrap: { kind: '2d', label: 'Salir por un lado y entrar por el otro', icon: '🌀', params: [{ key: 'margin', label: 'Margen', type: 'number', def: 16, step: 1 }] },
    destroyOffscreen: { kind: '2d', label: 'Destruir fuera de pantalla', icon: '🗑️', params: [{ key: 'margin', label: 'Margen', type: 'number', def: 80, step: 5 }] },
    draggable: { kind: '2d', label: 'Arrastrable', icon: '✋', params: [] },
    followPointer: { kind: '2d', label: 'Seguir al ratón/dedo', icon: '🖱️', params: [{ key: 'speed', label: 'Velocidad (0 = instantáneo)', type: 'number', def: 0, min: 0, step: 10 }] },
    cameraFollow: { kind: '2d', label: 'La cámara me sigue', icon: '🎥', params: [
      { key: 'lerp', label: 'Suavidad (0..1)', type: 'number', def: 0.12, min: 0.01, max: 1, step: 0.01 }, { key: 'zoom', label: 'Zoom', type: 'number', def: 1, min: 0.05, max: 20, step: 0.05 },
      { key: 'bounds', label: 'Limitar a este tamaño de mundo (ancho×alto, vacío = sin límite)', type: 'text', def: '' }] },
    chase: { kind: 'both', label: 'Perseguir', icon: '👾', desc: 'Va hacia el objeto con la etiqueta indicada cuando está cerca.', params: [
      { key: 'target', label: 'Etiqueta del objetivo', type: 'tag', def: 'jugador' }, { key: 'speed', label: 'Velocidad', type: 'number', def: 120, step: 5 },
      { key: 'range', label: 'Distancia de detección', type: 'number', def: 400, min: 0, step: 10 }] },
    patrol: { kind: 'both', label: 'Patrullar', icon: '↔️', params: [
      { key: 'axis', label: 'Eje', type: 'select', def: 'x', options: [['x', 'Horizontal (X)'], ['y', 'Vertical (Y en 2D)'], ['z', 'Profundidad (Z en 3D)']] },
      { key: 'distance', label: 'Distancia', type: 'number', def: 160, min: 0, step: 5 }, { key: 'speed', label: 'Velocidad', type: 'number', def: 80, min: 0, step: 5 }] },
    fadeIn: { kind: '2d', label: 'Aparecer poco a poco', icon: '🌅', params: [{ key: 'duration', label: 'Duración (ms)', type: 'number', def: 600, min: 0, step: 50 }] },
    collectible: { kind: 'both', label: 'Coleccionable', icon: '🪙', desc: 'Al tocarlo el objetivo, desaparece y suma a una variable.', params: [
      { key: 'by', label: 'Lo recoge la etiqueta', type: 'tag', def: 'jugador' }, { key: 'variable', label: 'Variable que suma', type: 'text', def: 'puntos' },
      { key: 'amount', label: 'Cantidad', type: 'number', def: 1, step: 1 }, { key: 'sfx', label: 'Sonido', type: 'sfx', def: 'coin' }, { key: 'effect', label: 'Efecto', type: 'select', def: 'sparks', options: [['none', 'Ninguno'], ['sparks', 'Chispas'], ['magic', 'Magia'], ['coin', 'Monedas']] }] },
    hazard: { kind: 'both', label: 'Peligro', icon: '☠️', desc: 'Al tocarlo el objetivo: quita vida o reinicia la escena.', params: [
      { key: 'by', label: 'Afecta a la etiqueta', type: 'tag', def: 'jugador' }, { key: 'mode', label: 'Qué hace', type: 'select', def: 'damage', options: [['damage', 'Quitar vida'], ['restart', 'Reiniciar la escena'], ['destroy', 'Destruir al objetivo']] },
      { key: 'amount', label: 'Daño', type: 'number', def: 1, min: 0, step: 1 }, { key: 'variable', label: 'Variable de vida', type: 'text', def: 'vida' }] },
    health: { kind: 'both', label: 'Vida', icon: '❤️', desc: 'Tiene vida propia (acción "Dañar"). Al llegar a 0 se destruye.', params: [
      { key: 'hp', label: 'Vida', type: 'number', def: 3, min: 1, step: 1 }, { key: 'effect', label: 'Efecto al morir', type: 'select', def: 'explosion', options: [['none', 'Ninguno'], ['explosion', 'Explosión'], ['smoke', 'Humo'], ['sparks', 'Chispas']] }] },
    fpsPlayer: { kind: '3d', label: 'Jugador en primera persona', icon: '🎯', desc: 'WASD, ratón para mirar (clic captura el puntero), Shift correr, Espacio saltar.', params: [
      { key: 'speed', label: 'Velocidad', type: 'number', def: 5, min: 0, step: 0.5 }, { key: 'runSpeed', label: 'Velocidad corriendo', type: 'number', def: 9, min: 0, step: 0.5 },
      { key: 'jump', label: 'Salto', type: 'number', def: 7, min: 0, step: 0.5 }, { key: 'eyeHeight', label: 'Altura de los ojos', type: 'number', def: 1.6, min: 0.1, step: 0.05 }] },
    tpsPlayer: { kind: '3d', label: 'Jugador en tercera persona', icon: '🧍', desc: 'WASD, arrastra para girar la cámara. Anima Idle/Walk/Run/Jump si el modelo las tiene.', params: [
      { key: 'speed', label: 'Velocidad', type: 'number', def: 4.5, min: 0, step: 0.5 }, { key: 'runSpeed', label: 'Velocidad corriendo', type: 'number', def: 8, min: 0, step: 0.5 },
      { key: 'jump', label: 'Salto', type: 'number', def: 8, min: 0, step: 0.5 }, { key: 'distance', label: 'Distancia de la cámara', type: 'number', def: 5, min: 1, step: 0.5 }] },
    vehicle: { kind: '3d', label: 'Vehículo', icon: '🏎️', desc: 'W/S acelerar/frenar, A/D girar, Espacio freno de mano. Cámara de persecución.', params: [
      { key: 'power', label: 'Potencia', type: 'number', def: 1, min: 0.1, max: 5, step: 0.1 }, { key: 'camera', label: 'Cámara de persecución', type: 'bool', def: true }] },
    orbitCamera: { kind: '3d', label: 'Cámara orbital (mirar alrededor)', icon: '🌐', desc: 'La cámara orbita alrededor de este objeto con el ratón.', params: [
      { key: 'distance', label: 'Distancia', type: 'number', def: 10, min: 0.5, step: 0.5 }, { key: 'autoRotate', label: 'Giro automático', type: 'number', def: 0, step: 0.1 }] },
    followCamera: { kind: '3d', label: 'La cámara me sigue (3D)', icon: '🎬', params: [
      { key: 'distance', label: 'Distancia', type: 'number', def: 7, min: 0.5, step: 0.5 }, { key: 'height', label: 'Altura', type: 'number', def: 2.6, step: 0.1 }] },
    lookAt: { kind: '3d', label: 'Mirar hacia', icon: '👀', params: [{ key: 'target', label: 'Etiqueta del objetivo', type: 'tag', def: 'jugador' }] }
  };

  /* --------------------------------------------------------------- hojas de eventos */
  var TARGET = { key: 'target', label: 'Objeto', type: 'target', def: 'self' };
  S.CONDITIONS = {
    start: { label: 'Al empezar la escena', icon: '▶️', params: [] },
    every: { label: 'Cada X segundos', icon: '⏱️', params: [{ key: 'seconds', label: 'Segundos', type: 'number', def: 1, min: 0.016, step: 0.1 }] },
    after: { label: 'Tras X segundos (una vez)', icon: '⌛', params: [{ key: 'seconds', label: 'Segundos', type: 'number', def: 2, min: 0, step: 0.1 }] },
    keyPressed: { label: 'Al pulsar una tecla', icon: '⌨️', params: [{ key: 'key', label: 'Tecla', type: 'key', def: 'SPACE' }] },
    keyDown: { label: 'Mientras una tecla está pulsada', icon: '⌨️', params: [{ key: 'key', label: 'Tecla', type: 'key', def: 'RIGHT' }] },
    keyReleased: { label: 'Al soltar una tecla', icon: '⌨️', params: [{ key: 'key', label: 'Tecla', type: 'key', def: 'SPACE' }] },
    pointerDown: { label: 'Al hacer clic/tocar la pantalla', icon: '👆', params: [] },
    clicked: { label: 'Al hacer clic en un objeto', icon: '🖱️', params: [{ key: 'target', label: 'Objeto (etiqueta o nombre)', type: 'target', def: 'tag:boton' }] },
    collision: { label: 'Cuando se tocan dos objetos', icon: '💥', params: [{ key: 'a', label: 'Objeto A', type: 'target', def: 'tag:jugador' }, { key: 'b', label: 'Objeto B', type: 'target', def: 'tag:enemigo' }] },
    compare: { label: 'Comparar variable', icon: '🔢', params: [{ key: 'variable', label: 'Variable', type: 'text', def: 'puntos' }, { key: 'op', label: 'Es', type: 'select', def: '>=', options: [['==', 'igual a'], ['!=', 'distinta de'], ['>', 'mayor que'], ['>=', 'mayor o igual que'], ['<', 'menor que'], ['<=', 'menor o igual que']] }, { key: 'value', label: 'Valor', type: 'text', def: '10' }] },
    noneLeft: { label: 'Cuando no queda ninguno', icon: '0️⃣', params: [{ key: 'target', label: 'Objetos (etiqueta)', type: 'target', def: 'tag:enemigo' }] },
    random: { label: 'Probabilidad por segundo', icon: '🎲', params: [{ key: 'chance', label: 'Veces por segundo (media)', type: 'number', def: 0.5, min: 0, step: 0.1 }] },
    web3Connected: { label: 'La cartera está conectada (web3)', icon: '🦊', params: [] },
    web3Event: { label: 'Al ocurrir algo en la cartera (web3)', icon: '⛓️', params: [{ key: 'event', label: 'Suceso', type: 'select', def: 'connect', options: [['connect', 'Se conecta'], ['read', 'Lectura terminada'], ['signed', 'Mensaje firmado'], ['txSent', 'Transacción enviada'], ['txConfirmed', 'Transacción confirmada'], ['txFailed', 'Transacción fallida'], ['error', 'Error o cancelación'], ['accountsChanged', 'Cambia de cuenta'], ['chainChanged', 'Cambia de red']] }] },
    httpDone: { label: 'Al terminar una petición al servidor', icon: '🌐', params: [{ key: 'variable', label: 'Variable de la respuesta', type: 'text', def: 'respuesta' }] },
    bridgeMessage: { label: 'Al recibir un mensaje del puente (página)', icon: '🔌', params: [{ key: 'name', label: 'Nombre del mensaje', type: 'text', def: 'mensaje' }, { key: 'variable', label: 'Guardar los datos en la variable', type: 'text', def: 'datos' }] },
    isNight: { label: 'Es de noche (3D, día/noche)', icon: '🌙', params: [] }
  };
  S.ACTIONS = {
    setVar: { label: 'Poner variable', icon: '📝', params: [{ key: 'variable', label: 'Variable', type: 'text', def: 'puntos' }, { key: 'value', label: 'Valor', type: 'text', def: '0' }] },
    addVar: { label: 'Sumar a variable', icon: '➕', params: [{ key: 'variable', label: 'Variable', type: 'text', def: 'puntos' }, { key: 'value', label: 'Cantidad', type: 'number', def: 1, step: 1 }] },
    destroy: { label: 'Destruir', icon: '💨', params: [TARGET, { key: 'effect', label: 'Efecto', type: 'select', def: 'none', options: [['none', 'Ninguno'], ['explosion', 'Explosión'], ['smoke', 'Humo'], ['sparks', 'Chispas'], ['magic', 'Magia']] }] },
    spawn: { label: 'Crear copia de un objeto', icon: '🐣', params: [{ key: 'template', label: 'Copiar el objeto (nombre)', type: 'node', def: '' }, { key: 'at', label: 'En la posición de', type: 'target', def: 'self' }, { key: 'dx', label: 'Desplazamiento X', type: 'number', def: 0, step: 1 }, { key: 'dy', label: 'Desplazamiento Y', type: 'number', def: 0, step: 1 }, { key: 'dz', label: 'Desplazamiento Z (3D)', type: 'number', def: 0, step: 0.1 }, { key: 'randomX', label: 'Dispersión aleatoria X (±)', type: 'number', def: 0, min: 0, step: 1 }, { key: 'randomY', label: 'Dispersión aleatoria Y (±, Z en 3D)', type: 'number', def: 0, min: 0, step: 1 }] },
    move: { label: 'Mover', icon: '↗️', params: [TARGET, { key: 'dx', label: 'X', type: 'number', def: 0, step: 1 }, { key: 'dy', label: 'Y', type: 'number', def: 0, step: 1 }, { key: 'dz', label: 'Z (3D)', type: 'number', def: 0, step: 0.1 }] },
    setPosition: { label: 'Colocar en', icon: '📍', params: [TARGET, { key: 'x', label: 'X', type: 'number', def: 0, step: 1 }, { key: 'y', label: 'Y', type: 'number', def: 0, step: 1 }, { key: 'z', label: 'Z (3D)', type: 'number', def: 0, step: 0.1 }] },
    setVelocity: { label: 'Poner velocidad', icon: '💨', params: [TARGET, { key: 'x', label: 'X', type: 'number', def: 0, step: 10 }, { key: 'y', label: 'Y', type: 'number', def: -400, step: 10 }, { key: 'z', label: 'Z (3D)', type: 'number', def: 0, step: 0.5 }] },
    damage: { label: 'Dañar', icon: '🗡️', params: [TARGET, { key: 'amount', label: 'Daño', type: 'number', def: 1, min: 0, step: 1 }] },
    setVisible: { label: 'Mostrar / ocultar', icon: '👁️', params: [TARGET, { key: 'visible', label: 'Visible', type: 'bool', def: false }] },
    setText: { label: 'Cambiar texto', icon: '🔤', params: [TARGET, { key: 'text', label: 'Texto ({variable} se sustituye)', type: 'text', def: 'Puntos: {puntos}' }] },
    playSound: { label: 'Sonido', icon: '🔊', params: [{ key: 'sound', label: 'Sonido (recurso o efecto)', type: 'sound', def: 'sfx:coin' }, { key: 'volume', label: 'Volumen', type: 'number', def: 0.6, min: 0, max: 1, step: 0.05 }] },
    playMusic: { label: 'Música (en bucle)', icon: '🎵', params: [{ key: 'sound', label: 'Recurso de audio', type: 'asset', assetType: 'audio', def: '' }, { key: 'volume', label: 'Volumen', type: 'number', def: 0.4, min: 0, max: 1, step: 0.05 }] },
    stopMusic: { label: 'Parar la música', icon: '🔇', params: [] },
    effect: { label: 'Efecto de partículas', icon: '✨', params: [{ key: 'preset', label: 'Tipo', type: 'select', def: 'explosion', options: [['explosion', 'Explosión'], ['sparks', 'Chispas'], ['smoke', 'Humo'], ['magic', 'Magia'], ['confetti', 'Confeti (2D)'], ['coin', 'Monedas (3D)']] }, { key: 'at', label: 'En', type: 'target', def: 'self' }] },
    shake: { label: 'Temblor de cámara', icon: '📳', params: [{ key: 'duration', label: 'Duración (ms)', type: 'number', def: 250, min: 0, step: 50 }, { key: 'intensity', label: 'Intensidad', type: 'number', def: 0.01, min: 0, max: 0.2, step: 0.005 }] },
    flash: { label: 'Destello de pantalla', icon: '⚡', params: [{ key: 'color', label: 'Color', type: 'color', def: '#ffffff' }, { key: 'duration', label: 'Duración (ms)', type: 'number', def: 250, min: 0, step: 50 }] },
    floatText: { label: 'Texto flotante', icon: '💬', params: [{ key: 'text', label: 'Texto', type: 'text', def: '+1' }, { key: 'at', label: 'En', type: 'target', def: 'self' }, { key: 'color', label: 'Color', type: 'color', def: '#ffd43b' }] },
    playAnim: { label: 'Reproducir animación', icon: '🎞️', params: [TARGET, { key: 'clip', label: 'Animación', type: 'text', def: 'Walk' }, { key: 'loop', label: 'Repetir', type: 'bool', def: true }] },
    tween: { label: 'Animar propiedad (tween)', icon: '📈', params: [TARGET, { key: 'prop', label: 'Propiedad', type: 'select', def: 'alpha', options: [['alpha', 'Opacidad'], ['x', 'X'], ['y', 'Y'], ['angle', 'Ángulo'], ['scale', 'Escala']] }, { key: 'to', label: 'Hasta', type: 'number', def: 0, step: 0.1 }, { key: 'duration', label: 'Duración (ms)', type: 'number', def: 500, min: 0, step: 50 }, { key: 'yoyo', label: 'Ida y vuelta', type: 'bool', def: false }] },
    saveVar: { label: 'Guardar variable (persistente)', icon: '💾', params: [{ key: 'variable', label: 'Variable', type: 'text', def: 'record' }] },
    loadVar: { label: 'Cargar variable guardada', icon: '📂', params: [{ key: 'variable', label: 'Variable', type: 'text', def: 'record' }, { key: 'def', label: 'Valor si no hay nada guardado', type: 'text', def: '0' }] },
    gotoScene: { label: 'Ir a la escena', icon: '🚪', params: [{ key: 'scene', label: 'Escena', type: 'scene', def: '' }] },
    restartScene: { label: 'Reiniciar la escena', icon: '🔁', params: [] },
    callFunction: { label: 'Llamar a una función del script de escena', icon: 'ƒ', params: [{ key: 'name', label: 'Nombre de la función', type: 'text', def: 'miFuncion' }] },
    log: { label: 'Escribir en la consola', icon: '🖨️', params: [{ key: 'message', label: 'Mensaje ({variable} se sustituye)', type: 'text', def: 'Puntos: {puntos}' }] },
    impulse: { label: 'Empujar (impulso)', icon: '👊', params: [TARGET, { key: 'x', label: 'X', type: 'number', def: 0, step: 10 }, { key: 'y', label: 'Y', type: 'number', def: -300, step: 10 }, { key: 'z', label: 'Z (3D)', type: 'number', def: 0, step: 0.5 }] },
    setWeather: { label: 'Cambiar el clima', icon: '🌦️', params: [{ key: 'weather', label: 'Clima', type: 'select', def: 'rain', options: [['clear', 'Despejado'], ['cloudy', 'Nublado (3D)'], ['overcast', 'Cubierto (3D)'], ['rain', 'Lluvia'], ['storm', 'Tormenta'], ['snow', 'Nieve'], ['fog', 'Niebla (3D)']] }] },
    setTimeOfDay: { label: 'Poner la hora del día (3D)', icon: '🕒', params: [{ key: 'hour', label: 'Hora (0..24)', type: 'number', def: 20, min: 0, max: 24, step: 0.5 }] },
    addDecal: { label: 'Marca en el suelo o pared (3D)', icon: '🩸', params: [{ key: 'kind', label: 'Tipo', type: 'select', def: 'scorch', options: [['bullet', 'Agujero de bala'], ['blood', 'Sangre'], ['pool', 'Charco'], ['scorch', 'Quemadura'], ['crack', 'Grieta']] }, { key: 'at', label: 'Bajo', type: 'target', def: 'self' }, { key: 'size', label: 'Tamaño', type: 'number', def: 1.5, min: 0.05, max: 50, step: 0.1 }] },
    web3Connect: { label: 'Conectar la cartera (web3)', icon: '🦊', params: [] },
    web3Read: { label: 'Leer de un contrato (web3)', icon: '📖', params: [{ key: 'contract', label: 'Contrato (nombre)', type: 'text', def: 'MiToken' }, { key: 'fn', label: 'Función', type: 'text', def: 'balanceOf' }, { key: 'args', label: 'Argumentos (coma; {cuenta} = tu dirección)', type: 'text', def: '{cuenta}' }, { key: 'variable', label: 'Guardar en la variable', type: 'text', def: 'saldo' }, { key: 'decimals', label: 'Decimales para mostrar (0 = entero)', type: 'number', def: 0, min: 0, max: 36, step: 1 }] },
    web3Write: { label: 'Enviar transacción a un contrato (web3)', icon: '✍️', params: [{ key: 'contract', label: 'Contrato (nombre)', type: 'text', def: 'MiToken' }, { key: 'fn', label: 'Función', type: 'text', def: 'mint' }, { key: 'args', label: 'Argumentos (coma; {cuenta} = tu dirección)', type: 'text', def: '{cuenta}, 1' }, { key: 'value', label: 'Pago en ETH (0 = nada)', type: 'text', def: '0' }] },
    web3Sign: { label: 'Firmar un mensaje (iniciar sesión web3)', icon: '🔏', params: [{ key: 'message', label: 'Mensaje', type: 'text', def: 'Inicio de sesión en {juego}' }, { key: 'variable', label: 'Guardar la firma en', type: 'text', def: 'firma' }] },
    httpRequest: { label: 'Petición a tu servidor (backend/API)', icon: '🌐', params: [{ key: 'method', label: 'Método', type: 'select', def: 'GET', options: [['GET', 'GET (leer)'], ['POST', 'POST (enviar)'], ['PUT', 'PUT'], ['DELETE', 'DELETE']] }, { key: 'path', label: 'Ruta (ej. /api/puntos)', type: 'text', def: '/api/puntos' }, { key: 'body', label: 'Cuerpo JSON ({variable} se sustituye)', type: 'text', def: '{"puntos": {puntos}}' }, { key: 'variable', label: 'Guardar la respuesta en', type: 'text', def: 'respuesta' }] },
    bridgeSend: { label: 'Enviar mensaje al puente (página)', icon: '🔌', params: [{ key: 'name', label: 'Nombre', type: 'text', def: 'puntuacion' }, { key: 'data', label: 'Datos ({variable} se sustituye)', type: 'text', def: '{puntos}' }] }
  };

  /* --------------------------------------------------------------- efectos (filtros 2D; en 3D se aplican a la vista) */
  S.EFFECTS = {
    bloom: { label: 'Resplandor (bloom)', cls: 'BloomFilter', params: [{ key: 'threshold', label: 'Umbral', type: 'number', def: 0.5, min: 0, max: 1, step: 0.05 }, { key: 'intensity', label: 'Intensidad', type: 'number', def: 1.2, min: 0, max: 10, step: 0.1 }, { key: 'blur', label: 'Difuminado', type: 'number', def: 10, min: 0, max: 64, step: 1 }] },
    glow: { label: 'Brillo exterior', cls: 'GlowFilter', params: [{ key: 'color', label: 'Color', type: 'color', def: '#ffffff' }, { key: 'distance', label: 'Distancia', type: 'number', def: 12, min: 1, max: 64, step: 1 }, { key: 'outerStrength', label: 'Fuerza', type: 'number', def: 2, min: 0, max: 20, step: 0.1 }] },
    blur: { label: 'Desenfoque', cls: 'BlurFilter', params: [{ key: 'strength', label: 'Fuerza', type: 'number', def: 8, min: 0, max: 64, step: 1 }] },
    crt: { label: 'Pantalla retro (CRT)', cls: 'CRTFilter', params: [{ key: 'curvature', label: 'Curvatura', type: 'number', def: 1, min: 0, max: 10, step: 0.1 }, { key: 'lineWidth', label: 'Líneas', type: 'number', def: 3, min: 0, max: 10, step: 0.5 }, { key: 'noise', label: 'Ruido', type: 'number', def: 0.08, min: 0, max: 1, step: 0.01 }] },
    pixelate: { label: 'Pixelado', cls: 'PixelateFilter', arg: 'size', params: [{ key: 'size', label: 'Tamaño del píxel', type: 'number', def: 6, min: 1, max: 64, step: 1 }] },
    vignette: { label: 'Viñeta', cls: 'VignetteFilter', params: [{ key: 'radius', label: 'Radio', type: 'number', def: 0.45, min: 0, max: 1, step: 0.05 }, { key: 'softness', label: 'Suavidad', type: 'number', def: 0.55, min: 0, max: 1, step: 0.05 }, { key: 'strength', label: 'Fuerza', type: 'number', def: 0.9, min: 0, max: 1, step: 0.05 }] },
    grayscale: { label: 'Blanco y negro', cls: 'GrayscaleFilter', arg: 'amount', params: [{ key: 'amount', label: 'Cantidad', type: 'number', def: 1, min: 0, max: 1, step: 0.05 }] },
    sepia: { label: 'Sepia', cls: 'SepiaFilter', params: [] },
    invert: { label: 'Negativo', cls: 'InvertFilter', params: [] },
    hue: { label: 'Cambiar tono', cls: 'HueRotateFilter', arg: 'deg', params: [{ key: 'deg', label: 'Grados', type: 'number', def: 90, min: -360, max: 360, step: 5 }] },
    chromatic: { label: 'Aberración cromática', cls: 'ChromaticAberrationFilter', params: [{ key: 'offset', label: 'Separación', type: 'number', def: 3, min: 0, max: 40, step: 0.5 }] },
    noise: { label: 'Grano', cls: 'NoiseFilter', params: [{ key: 'noise', label: 'Cantidad', type: 'number', def: 0.2, min: 0, max: 1, step: 0.02 }] },
    oldfilm: { label: 'Película antigua', cls: 'OldFilmFilter', params: [{ key: 'sepia', label: 'Sepia', type: 'number', def: 0.4, min: 0, max: 1, step: 0.05 }, { key: 'noise', label: 'Ruido', type: 'number', def: 0.25, min: 0, max: 1, step: 0.05 }] },
    glitch: { label: 'Fallo digital (glitch)', cls: 'GlitchFilter', params: [{ key: 'offset', label: 'Desplazamiento', type: 'number', def: 40, min: 0, max: 400, step: 1 }, { key: 'density', label: 'Densidad', type: 'number', def: 0.3, min: 0, max: 1, step: 0.05 }] },
    wave: { label: 'Ondas', cls: 'WaveFilter', params: [{ key: 'amplitude', label: 'Amplitud', type: 'number', def: 6, min: 0, max: 100, step: 0.5 }, { key: 'speed', label: 'Velocidad', type: 'number', def: 3, min: 0, max: 50, step: 0.5 }] },
    heat: { label: 'Calor (distorsión)', cls: 'HeatHazeFilter', params: [{ key: 'strength', label: 'Fuerza', type: 'number', def: 3, min: 0, max: 40, step: 0.5 }] },
    godrays: { label: 'Rayos de luz', cls: 'GodRaysFilter', params: [{ key: 'x', label: 'Origen X', type: 'number', def: 640, step: 10 }, { key: 'y', label: 'Origen Y', type: 'number', def: 0, step: 10 }, { key: 'exposure', label: 'Exposición', type: 'number', def: 0.35, min: 0, max: 2, step: 0.05 }] },
    shadow: { label: 'Sombra', cls: 'DropShadowFilter', params: [{ key: 'color', label: 'Color', type: 'color', def: '#000000' }, { key: 'distance', label: 'Distancia', type: 'number', def: 6, min: 0, max: 100, step: 1 }, { key: 'blur', label: 'Difuminado', type: 'number', def: 4, min: 0, max: 40, step: 1 }] },
    outline: { label: 'Contorno', cls: 'OutlineFilter', params: [{ key: 'color', label: 'Color', type: 'color', def: '#000000' }, { key: 'thickness', label: 'Grosor', type: 'number', def: 2, min: 0, max: 20, step: 0.5 }] },
    posterize: { label: 'Posterizar', cls: 'PosterizeFilter', arg: 'levels', params: [{ key: 'levels', label: 'Niveles', type: 'number', def: 5, min: 2, max: 64, step: 1 }] },
    tiltshift: { label: 'Miniatura (tilt-shift)', cls: 'TiltShiftFilter', params: [{ key: 'blur', label: 'Desenfoque', type: 'number', def: 12, min: 0, max: 64, step: 1 }, { key: 'focus', label: 'Foco (0..1)', type: 'number', def: 0.5, min: 0, max: 1, step: 0.05 }] }
  };

  /* --------------------------------------------------------------- teclas y efectos de sonido */
  S.KEYS = ['SPACE', 'ENTER', 'SHIFT', 'CTRL', 'ESC', 'TAB', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
  S.SFX = ['coin', 'laser', 'explosion', 'powerup', 'hit', 'jump', 'blip', 'click', 'bounce', 'shoot', 'hurt', 'select'];
  S.ASSET_TYPES = { image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'], audio: ['mp3', 'ogg', 'wav', 'm4a'], model: ['glb', 'gltf', 'obj'], tilemap: ['tmj', 'json', 'tmx'], data: ['json', 'txt', 'mtl', 'bin', 'tsj', 'tsx'], font: ['ttf', 'otf', 'woff', 'woff2'] };
  S.assetTypeOf = function (file) { var e = (/\.([a-z0-9]+)$/i.exec(file || '') || [])[1]; e = e ? e.toLowerCase() : ''; for (var t in S.ASSET_TYPES) if (S.ASSET_TYPES[t].indexOf(e) >= 0) return t === 'data' && e === 'json' ? 'tilemap' : t; return null; };

  /* --------------------------------------------------------------- creación de nodos y proyectos */
  function defaultsOf(list) { var o = {}; (list || []).forEach(function (p) { o[p.key] = Array.isArray(p.def) ? p.def.slice() : p.def; }); return o; }
  S.defaultsOf = defaultsOf;
  /** Nodo nuevo de un tipo con todas sus propiedades por defecto */
  S.createNode = function (type, sceneKind, extra) {
    var T = S.NODE_TYPES[type]; if (!T) throw new Error('Tipo de nodo desconocido: ' + type);
    var n = { id: S.uid('n'), name: T.label, type: type, parent: null, visible: true, tags: [], vars: {}, props: defaultsOf(T.props), behaviors: [], effects: [], script: null };
    var is3d = T.kind === '3d';
    if (is3d) { n.position = [0, 0, 0]; n.rotation = [0, 0, 0]; n.scale = [1, 1, 1]; n.physics = defaultsOf(S.PHYSICS_3D); }
    else { var t = defaultsOf(S.TRANSFORM_2D); for (var k in t) n[k] = t[k]; n.physics = defaultsOf(S.PHYSICS_2D); if (sceneKind === '3d') n.hud = true; }
    if (extra) for (var e in extra) if (!S.isForbiddenKey(e)) n[e] = extra[e];
    return n;
  };
  S.createScene = function (kind, name) {
    var sc = { id: S.uid('s'), name: name || (kind === '3d' ? 'Escena 3D' : 'Escena 2D'), kind: kind === '3d' ? '3d' : '2d', background: kind === '3d' ? '#87a9d6' : '#1b1e2b', nodes: [], events: [], effects: [], script: '', vars: {} };
    if (sc.kind === '3d') sc.env = { sky: true, skyTop: '#2f6fd0', skyHorizon: '#bfdcf5', skyBottom: '#6d6a60', fog: 'none', fogColor: '#bfdcf5', fogDensity: 0.02, exposure: 1, sun: true, sunColor: '#fff1dc', sunIntensity: 1.9, sunDir: [-0.45, -1, -0.35], shadows: true, ambient: 0.65, gravity: -20, antialias: true };
    else { sc.gravity = 900; sc.env2d = defaultsOf(S.SCENE_ENV_2D); }
    return sc;
  };
  S.createProject = function (name) {
    return { format: S.FORMAT, version: S.VERSION, name: name || 'Mi juego', settings: { width: 1280, height: 720, renderer: 'auto', pixelArt: false, scale: 'fit', background: '#000000', bridgeOrigins: [], connectOrigins: [] }, startScene: null, scenes: [], assets: [], scripts: [], vars: { puntos: 0, vida: 3 }, created: Date.now(),
      web3: S.defaultWeb3(), backend: S.defaultBackend() };
  };
  S.defaultWeb3 = function () { return { enabled: false, mode: 'mock', chains: [11155111], defaultChain: 11155111, maxValue: '0.05', contracts: [] }; };
  S.defaultBackend = function () { return { enabled: false, url: '', routes: [], cors: [] }; };
  S.HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE'];
  var ORIGIN_RE = /^https?:\/\/[A-Za-z0-9.-]{1,200}(:\d{1,5})?$/, ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
  S.isOrigin = function (o) { return typeof o === 'string' && ORIGIN_RE.test(o); };
  function cleanOrigins(list) { return cleanList(list, 20, function (o) { return S.isOrigin(o) ? o : null; }); }
  function jsonText(v, max, kind) { if (typeof v !== 'string' || v.length > max) return kind === 'array' ? '[]' : '{}'; try { var x = JSON.parse(v); if (kind === 'array' ? !Array.isArray(x) : (!x || typeof x !== 'object' || Array.isArray(x))) return kind === 'array' ? '[]' : '{}'; } catch (e) { return kind === 'array' ? '[]' : '{}'; } return v; }
  S.cleanWeb3 = function (w) {
    w = w && typeof w === 'object' ? w : {};
    var d = S.defaultWeb3(), ids = {};
    var seen = {}, chains = cleanList(w.chains, 20, function (c) { c = Number(c); if (!(Number.isInteger(c) && c > 0 && c < 9007199254740991) || seen[c]) return null; seen[c] = 1; return c; });
    if (!chains.length) chains = d.chains;
    // la red principal siempre es una de las permitidas
    return { enabled: S.bool(w.enabled, false), mode: w.mode === 'wallet' ? 'wallet' : 'mock', chains: chains,
      defaultChain: chains.indexOf(Number(w.defaultChain)) >= 0 ? Number(w.defaultChain) : chains[0],
      maxValue: typeof w.maxValue === 'string' && /^\d{1,12}(\.\d{1,18})?$/.test(w.maxValue) ? w.maxValue : d.maxValue,
      contracts: cleanList(w.contracts, 50, function (c) {
        if (!c || typeof c !== 'object') return null; var id = S.id(c.id); if (!id || ids[id]) return null; ids[id] = 1;
        var name = typeof c.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(c.name) ? c.name : 'Contrato', addrs = {};
        if (c.addresses && typeof c.addresses === 'object') Object.keys(c.addresses).slice(0, 20).forEach(function (k) { if (/^\d{1,16}$/.test(k) && ADDR_RE.test(c.addresses[k])) addrs[k] = c.addresses[k]; });
        return { id: id, name: name, source: S.str(c.source, '', 300000), abi: jsonText(c.abi, 800000, 'array'), addresses: addrs, mock: jsonText(c.mock, 60000, 'object'), bytecode: typeof c.bytecode === 'string' && /^(0x)?[0-9a-fA-F]{0,2000000}$/.test(c.bytecode) ? c.bytecode : '',
          args: Array.isArray(c.args) ? c.args.slice(0, 16).map(function (a) { return typeof a === 'string' || typeof a === 'number' ? String(a).slice(0, 400) : ''; }) : [] };
      }) };
  };
  S.cleanBackend = function (b) {
    b = b && typeof b === 'object' ? b : {};
    var ids = {}, keys = {};
    return { enabled: S.bool(b.enabled, false), url: typeof b.url === 'string' && (b.url === '' || /^https?:\/\/[A-Za-z0-9.-]{1,200}(:\d{1,5})?(\/[A-Za-z0-9._~\/-]{0,200})?$/.test(b.url)) ? b.url.replace(/\/+$/, '') : '', cors: cleanOrigins(b.cors),
      routes: cleanList(b.routes, 100, function (r) {
        if (!r || typeof r !== 'object') return null; var id = S.id(r.id); if (!id || ids[id]) return null;
        var method = S.HTTP_METHODS.indexOf(r.method) >= 0 ? r.method : 'GET', path = typeof r.path === 'string' && /^\/[A-Za-z0-9_\-\/:.]{0,119}$/.test(r.path) && r.path.indexOf('..') < 0 ? r.path : null;
        if (!path || keys[method + ' ' + path]) return null; ids[id] = 1; keys[method + ' ' + path] = 1;
        return { id: id, method: method, path: path, code: S.str(r.code, '', 200000), rateLimit: S.num(r.rateLimit, 60, 1, 100000) | 0, auth: S.bool(r.auth, false) };
      }) };
  };
  S.SCENE_ENV = [
    { key: 'sky', label: 'Cielo degradado', type: 'bool', def: true }, { key: 'skyTop', label: 'Cielo arriba', type: 'color', def: '#2f6fd0' }, { key: 'skyHorizon', label: 'Horizonte', type: 'color', def: '#bfdcf5' }, { key: 'skyBottom', label: 'Suelo lejano', type: 'color', def: '#6d6a60' },
    { key: 'fog', label: 'Niebla', type: 'select', def: 'none', options: [['none', 'Sin niebla'], ['linear', 'Lineal'], ['exp2', 'Densa (exponencial)']] }, { key: 'fogColor', label: 'Color de la niebla', type: 'color', def: '#bfdcf5' }, { key: 'fogDensity', label: 'Densidad / distancia', type: 'number', def: 0.02, min: 0, max: 1000, step: 0.005 },
    { key: 'exposure', label: 'Exposición', type: 'number', def: 1, min: 0.05, max: 10, step: 0.05 },
    { key: 'sun', label: 'Sol automático', type: 'bool', def: true }, { key: 'sunColor', label: 'Color del sol', type: 'color', def: '#fff1dc' }, { key: 'sunIntensity', label: 'Intensidad del sol', type: 'number', def: 1.9, min: 0, max: 50, step: 0.1 },
    { key: 'sunDir', label: 'Dirección del sol', type: 'vec3', def: [-0.45, -1, -0.35], step: 0.05 }, { key: 'shadows', label: 'Sombras', type: 'bool', def: true }, { key: 'ambient', label: 'Luz ambiente', type: 'number', def: 0.65, min: 0, max: 20, step: 0.05 },
    { key: 'gravity', label: 'Gravedad', type: 'number', def: -20, min: -1000, max: 1000, step: 0.5 }, { key: 'antialias', label: 'Antialias', type: 'bool', def: true },
    { key: 'clouds', label: 'Nubes', type: 'bool', def: true }, { key: 'cloudCoverage', label: 'Cobertura de nubes', type: 'number', def: 0.45, min: 0, max: 1, step: 0.05 },
    { key: 'cloudSpeed', label: 'Velocidad de las nubes', type: 'number', def: 0.015, min: -1, max: 1, step: 0.005 },
    { key: 'stars', label: 'Estrellas y luna', type: 'bool', def: false },
    { key: 'dayNight', label: 'Ciclo día/noche', type: 'bool', def: false }, { key: 'timeOfDay', label: 'Hora inicial (0..24)', type: 'number', def: 12, min: 0, max: 24, step: 0.5 },
    { key: 'daySpeed', label: 'Horas de juego por segundo', type: 'number', def: 0, min: 0, max: 24, step: 0.01 },
    { key: 'weather', label: 'Clima', type: 'select', def: 'none', options: [['none', 'El del cielo'], ['clear', 'Despejado'], ['cloudy', 'Nublado'], ['overcast', 'Cubierto'], ['rain', 'Lluvia'], ['storm', 'Tormenta'], ['snow', 'Nieve'], ['fog', 'Niebla']] }
  ];
  S.SCENE_ENV_2D = [
    { key: 'engine', label: 'Física', type: 'select', def: 'arcade', options: [['arcade', 'Arcade (rápida: plataformas, naves)'], ['rigid', 'Cuerpos rígidos (giran, se apilan, uniones)']] },
    { key: 'lights', label: 'Luces 2D con sombras', type: 'bool', def: false }, { key: 'ambient', label: 'Luz ambiente (color «apagado»)', type: 'color', def: '#1a1e30' },
    { key: 'weather', label: 'Clima', type: 'select', def: 'none', options: [['none', 'Ninguno'], ['rain', 'Lluvia'], ['storm', 'Tormenta'], ['snow', 'Nieve']] }
  ];

  /* --------------------------------------------------------------- saneado (entrada no confiable: archivo, red) */
  function cleanFields(list, src, out) {
    src = src && typeof src === 'object' ? src : {};
    (list || []).forEach(function (p) {
      var v = src[p.key];
      switch (p.type) {
        case 'number': out[p.key] = S.num(v, p.def, p.min, p.max); break;
        case 'bool': out[p.key] = S.bool(v, p.def); break;
        case 'color': out[p.key] = S.color(v, p.def); break;
        case 'vec3': out[p.key] = S.vec3(v, p.def); break;
        case 'select': out[p.key] = p.options && p.options.some(function (o) { return o[0] === v; }) ? v : p.def; break;
        case 'textarea': out[p.key] = S.str(v, p.def, 20000); break;
        default: out[p.key] = S.str(v, p.def, 400);
      }
    });
    return out;
  }
  S.cleanFields = cleanFields;
  function cleanList(arr, max, fn) { var out = []; if (!Array.isArray(arr)) return out; for (var i = 0; i < arr.length && out.length < max; i++) { var r = fn(arr[i], i); if (r) out.push(r); } return out; }
  function cleanVars(v) { var o = {}; if (!v || typeof v !== 'object' || Array.isArray(v)) return o; Object.keys(v).slice(0, 200).forEach(function (k) { if (S.isForbiddenKey(k) || !/^[A-Za-z_\u00c0-\u024f][A-Za-z0-9_\u00c0-\u024f]{0,39}$/.test(k)) return; var x = v[k]; o[k] = typeof x === 'number' && isFinite(x) ? x : typeof x === 'boolean' ? x : S.str(x, '', 400); }); return o; }
  S.cleanVars = cleanVars;
  function cleanBlock(b, table) {
    if (!b || typeof b !== 'object' || !Object.prototype.hasOwnProperty.call(table, b.type)) return null;
    return { type: b.type, params: cleanFields(table[b.type].params, b.params, {}) };
  }
  S.cleanNode = function (n, sceneKind) {
    if (!n || typeof n !== 'object' || !Object.prototype.hasOwnProperty.call(S.NODE_TYPES, n.type)) return null;
    var T = S.NODE_TYPES[n.type], id = S.id(n.id); if (!id) return null;
    var o = { id: id, name: S.str(n.name, T.label, 80), type: n.type, parent: S.id(n.parent), visible: S.bool(n.visible, true),
      tags: cleanList(n.tags, 16, function (t) { return typeof t === 'string' && /^[A-Za-z0-9_\u00c0-\u024f-]{1,32}$/.test(t) ? t : null; }),
      vars: cleanVars(n.vars), props: cleanFields(T.props, n.props, {}),
      behaviors: cleanList(n.behaviors, 16, function (b) { return cleanBlock(b, S.BEHAVIORS); }),
      effects: cleanList(n.effects, 8, function (e) { return cleanBlock(e, S.EFFECTS); }),
      script: S.id(n.script), prefab: S.bool(n.prefab, false) };
    if (T.kind === '3d') { o.position = S.vec3(n.position, [0, 0, 0]); o.rotation = S.vec3(n.rotation, [0, 0, 0]); o.scale = S.vec3(n.scale, [1, 1, 1]); o.physics = cleanFields(S.PHYSICS_3D, n.physics, {}); }
    else { cleanFields(S.TRANSFORM_2D, n, o); o.physics = cleanFields(S.PHYSICS_2D, n.physics, {}); if (sceneKind === '3d') o.hud = true; }
    return o;
  };
  S.cleanScene = function (sc) {
    if (!sc || typeof sc !== 'object') return null;
    var id = S.id(sc.id); if (!id) return null;
    var kind = sc.kind === '3d' ? '3d' : '2d';
    var o = { id: id, name: S.str(sc.name, 'Escena', 80), kind: kind, background: S.color(sc.background, kind === '3d' ? '#87a9d6' : '#1b1e2b'), script: S.str(sc.script, '', 200000), vars: cleanVars(sc.vars) };
    var ids = {};
    o.nodes = cleanList(sc.nodes, 5000, function (n) { var c = S.cleanNode(n, kind); if (!c || ids[c.id]) return null; ids[c.id] = 1; return c; });
    // padres inexistentes o ciclos -> raíz
    o.nodes.forEach(function (n) { if (n.parent && !ids[n.parent]) n.parent = null; });
    var byId = {}; o.nodes.forEach(function (n) { byId[n.id] = n; });
    o.nodes.forEach(function (n) { var seen = {}, p = n.parent; while (p) { if (seen[p] || p === n.id) { n.parent = null; break; } seen[p] = 1; p = byId[p] ? byId[p].parent : null; } });
    var evIds = {};
    o.events = cleanList(sc.events, 500, function (ev) {
      if (!ev || typeof ev !== 'object') return null;
      var eid = S.id(ev.id); if (!eid || evIds[eid]) eid = S.uid('e'); evIds[eid] = 1; // ids únicos: el editor localiza cada evento por su id
      return { id: eid, enabled: S.bool(ev.enabled, true), once: S.bool(ev.once, false), comment: S.str(ev.comment, '', 200),
        conditions: cleanList(ev.conditions, 8, function (c) { var r = cleanBlock(c, S.CONDITIONS); if (r) r.not = S.bool(c.not, false); return r; }),
        actions: cleanList(ev.actions, 24, function (a) { return cleanBlock(a, S.ACTIONS); }) };
    });
    o.effects = cleanList(sc.effects, 8, function (e) { return cleanBlock(e, S.EFFECTS); });
    if (kind === '3d') o.env = cleanFields(S.SCENE_ENV, sc.env, {});
    else { o.gravity = S.num(sc.gravity, 900, -100000, 100000); o.env2d = cleanFields(S.SCENE_ENV_2D, sc.env2d, {}); }
    return o;
  };
  /** Proyecto válido y limpio (lanza Error si no es un proyecto de UltraGame) */
  S.cleanProject = function (p) {
    if (!p || typeof p !== 'object' || p.format !== S.FORMAT) throw new Error('No es un proyecto de UltraGame Studio');
    var st = p.settings || {};
    var o = { format: S.FORMAT, version: S.VERSION, name: S.str(p.name, 'Mi juego', 80),
      settings: { width: S.num(st.width, 1280, 64, 8192) | 0, height: S.num(st.height, 720, 64, 8192) | 0, renderer: ['auto', 'webgpu', 'webgl2', 'webgl', 'canvas'].indexOf(st.renderer) >= 0 ? st.renderer : 'auto',
        pixelArt: S.bool(st.pixelArt, false), scale: ['fit', 'envelop', 'resize', 'none'].indexOf(st.scale) >= 0 ? st.scale : 'fit', background: S.color(st.background, '#000000'),
        bridgeOrigins: cleanOrigins(st.bridgeOrigins), connectOrigins: cleanOrigins(st.connectOrigins) },
      vars: cleanVars(p.vars), created: S.num(p.created, Date.now()), web3: S.cleanWeb3(p.web3), backend: S.cleanBackend(p.backend) };
    var aids = {};
    o.assets = cleanList(p.assets, 2000, function (a) {
      if (!a || typeof a !== 'object') return null;
      var id = S.id(a.id), file = typeof a.file === 'string' && /^assets\/[A-Za-z0-9][A-Za-z0-9_\-. ]{0,119}$/.test(a.file) && a.file.indexOf('..') < 0 ? a.file : null;
      var type = S.assetTypeOf(file);
      if (!id || !file || !type || aids[id]) return null; aids[id] = 1;
      return { id: id, name: S.str(a.name, file.slice(7), 80), file: file, type: type, frameWidth: S.num(a.frameWidth, 0, 0, 8192) | 0, frameHeight: S.num(a.frameHeight, 0, 0, 8192) | 0 };
    });
    var sids = {};
    // plugin: se ejecuta antes que el juego (librerías, puente con la página, funciones globales)
    o.scripts = cleanList(p.scripts, 500, function (s) { if (!s || typeof s !== 'object') return null; var id = S.id(s.id); if (!id || sids[id]) return null; sids[id] = 1; return { id: id, name: S.str(s.name, 'script', 80), code: S.str(s.code, '', 500000), plugin: S.bool(s.plugin, false) }; });
    var scids = {};
    o.scenes = cleanList(p.scenes, 200, function (s) { var c = S.cleanScene(s); if (!c || scids[c.id]) return null; scids[c.id] = 1; return c; });
    // referencias rotas -> vacías
    o.scenes.forEach(function (sc) { sc.nodes.forEach(function (n) { if (n.script && !sids[n.script]) n.script = null; }); });
    o.startScene = S.id(p.startScene) && scids[p.startScene] ? p.startScene : (o.scenes[0] ? o.scenes[0].id : null);
    return o;
  };
  /** Orden padres-antes-que-hijos conservando el orden relativo */
  S.sortNodes = function (nodes) {
    var byId = {}, out = [], done = {};
    nodes.forEach(function (n) { byId[n.id] = n; });
    var visit = function (n, depth) { if (done[n.id] || depth > 64) return; if (n.parent && byId[n.parent]) visit(byId[n.parent], depth + 1); if (!done[n.id]) { done[n.id] = 1; out.push(n); } };
    nodes.forEach(function (n) { visit(n, 0); });
    return out;
  };

  root.UGStudio = root.UGStudio || {};
  root.UGStudio.schema = S;
  if (typeof module !== 'undefined' && module.exports) module.exports = S;
})(typeof window !== 'undefined' ? window : globalThis);
