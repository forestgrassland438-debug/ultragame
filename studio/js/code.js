/* UltraGame Studio · pestaña Código: scripts de objetos, script de escena, plugins globales (puente JS), rutas del
 * backend, contratos Solidity y archivos generados (proyecto, servidor, index.html) en un mismo editor.
 * Resaltado propio (sin librerías), números de línea, errores marcados y referencia de la API con fragmentos. */
import { h, clear, prompt, confirm, debounce, toast } from './dom.js';
import { DEFAULT_SCRIPT, DEFAULT_SCENE_SCRIPT } from './editor.js';
import { CodeEditor, highlight } from './codeeditor.js';

export { highlight };

export const DEFAULT_PLUGIN = `// Plugin: código global que corre antes que el juego y sigue activo en todas las escenas.
// Aquí puedes «puentear» JavaScript propio: librerías, funciones globales, la página que contiene el juego...
// api.game, api.vars, api.bridge, api.web3, api.http(metodo, ruta, cuerpo), api.emit(nombre, datos)

function onGameStart(game) {
  api.log('Plugin listo');
  // mensajes desde la página: game.bridge.receive('nombre', datos) o postMessage({ type: 'ug-bridge', name, data })
  api.bridge.on('pausa', function () { game.pause(); });
}

function onSceneStart(scene) {
  // scene es la API de escena (igual que en los scripts): scene.find, scene.spawn, scene.set...
}

function onUpdate(dt, scene) {
}

function onBridge(name, data) {
}
`;

const REF = [
  { group: 'Funciones del script (ganchos)' },
  { t: 'function onStart() {\n  \n}\n', k: 'onStart()', d: 'Una vez, al empezar la escena.' },
  { t: 'function onUpdate(dt) {\n  \n}\n', k: 'onUpdate(dt)', d: 'Cada fotograma. dt = segundos desde el anterior.' },
  { t: 'function onCollide(other) {\n  \n}\n', k: 'onCollide(other)', d: 'Al empezar a tocar otro objeto.' },
  { t: 'function onClick(pointer) {\n  \n}\n', k: 'onClick(pointer)', d: 'Al hacer clic/tocar este objeto.' },
  { t: 'function onDestroy() {\n  \n}\n', k: 'onDestroy()', d: 'Justo antes de destruirse.' },
  { t: 'function onMessage(name, data) {\n  \n}\n', k: 'onMessage(name, data)', d: 'Mensajes enviados con api.emit().' },
  { t: 'function onBridge(name, data) {\n  \n}\n', k: 'onBridge(name, data)', d: 'Script de escena o plugin: mensajes de la página (puente).' },
  { group: 'Plugins (scripts globales)' },
  { t: 'function onGameStart(game) {\n  \n}\n', k: 'onGameStart(game)', d: 'Al arrancar el juego (antes de la primera escena).' },
  { t: 'function onSceneStart(scene) {\n  \n}\n', k: 'onSceneStart(scene)', d: 'Cada escena que empieza (API de escena).' },
  { t: 'function onUpdate(dt, scene) {\n  \n}\n', k: 'onUpdate(dt, scene)', d: 'Cada fotograma de cada escena.' },
  { t: 'function onSceneEnd(scene) {\n  \n}\n', k: 'onSceneEnd(scene)', d: 'Al cerrarse una escena.' },
  { group: 'Entrada' },
  { t: "api.key('RIGHT')", k: "api.key('RIGHT')", d: 'true mientras la tecla está pulsada (LEFT, UP, SPACE, A…).' },
  { t: "api.pressed('SPACE')", k: "api.pressed('SPACE')", d: 'true solo en el fotograma en que se pulsa.' },
  { t: 'api.pointer.x', k: 'api.pointer', d: 'Ratón/dedo: x, y, worldX, worldY, isDown.' },
  { group: 'Objetos' },
  { t: "api.find('name:Jugador')", k: 'api.find(ref)', d: 'Primer objeto por nombre o "tag:etiqueta".' },
  { t: "api.findAll('tag:enemigo')", k: 'api.findAll(ref)', d: 'Lista de objetos.' },
  { t: "api.spawn('Bala', self.x, self.y)", k: 'api.spawn(plantilla, x, y, z)', d: 'Crea una copia de un objeto (o plantilla).' },
  { t: 'api.destroy()', k: 'api.destroy(obj, efecto)', d: 'Destruye (sin argumentos: este objeto).' },
  { t: 'api.damage(other, 1)', k: 'api.damage(obj, n)', d: 'Quita vida (comportamiento «Vida»).' },
  { t: 'api.velocity().x', k: 'api.velocity(obj)', d: 'Velocidad { x, y, z } (sin argumento: este objeto). Funciona con arcade, rígidos y 3D.' },
  { t: 'api.setVelocity(200, null)', k: 'api.setVelocity(x, y, z, obj)', d: 'Cambia la velocidad (null = no tocar ese eje).' },
  { t: 'api.onGround()', k: 'api.onGround(obj)', d: 'true si está apoyado en el suelo o en una plataforma.' },
  { t: 'api.impulse(self, 0, -400)', k: 'api.impulse(obj, x, y, z)', d: 'Empuje instantáneo (arcade, rígidos y 3D).' },
  { t: 'api.distance(self, other)', k: 'api.distance(a, b)', d: 'Distancia entre dos objetos.' },
  { group: 'Variables' },
  { t: "api.get('puntos')", k: 'api.get(nombre)', d: 'Lee una variable (propia o global). Admite rutas: "respuesta.jugador.nombre".' },
  { t: "api.set('puntos', 0)", k: 'api.set(nombre, valor)', d: 'Escribe una variable.' },
  { t: "api.add('puntos', 1)", k: 'api.add(nombre, n)', d: 'Suma a una variable.' },
  { t: 'api.my.vida', k: 'api.my', d: 'Variables propias de este objeto.' },
  { t: "api.save('record', api.get('puntos'))", k: 'api.save(clave, valor)', d: 'Guarda un dato entre partidas (récords, progreso).' },
  { t: "api.load('record', 0)", k: 'api.load(clave, porDefecto)', d: 'Lee un dato guardado.' },
  { group: 'Efectos, sonido y escenas' },
  { t: "api.sfx('coin')", k: "api.sfx('coin')", d: 'Efecto: coin, laser, explosion, jump, hit, powerup…' },
  { t: "api.effect('explosion')", k: 'api.effect(tipo, x, y, z)', d: 'Partículas: explosion, sparks, smoke, magic…' },
  { t: 'api.shake(250, 0.01)', k: 'api.shake(ms, fuerza)', d: 'Temblor de cámara.' },
  { t: "api.floatText('+10')", k: 'api.floatText(texto)', d: 'Texto flotante sobre este objeto.' },
  { t: "api.goto('Nivel 2')", k: 'api.goto(escena)', d: 'Cambia de escena (por nombre).' },
  { t: 'api.after(1.5, function () {\n  \n});', k: 'api.after(seg, fn)', d: 'Ejecuta algo más tarde.' },
  { t: "api.tween({ targets: self, alpha: 0, duration: 400 })", k: 'api.tween(cfg)', d: 'Animación de propiedades.' },
  { t: "api.log('hola', self.x)", k: 'api.log(...)', d: 'Escribe en la consola del Studio.' },
  { group: 'Mundo: clima, hora, luces, marcas' },
  { t: "api.weather('rain')", k: 'api.weather(tipo)', d: 'clear, cloudy, overcast, rain, storm, snow, fog (en 2D: rain, storm, snow, fog y clear).' },
  { t: 'api.timeOfDay(20)', k: 'api.timeOfDay(hora)', d: '3D: pone la hora (0..24); sin argumento la devuelve.' },
  { t: "api.decal('blood', x, y, z)", k: 'api.decal(tipo, x, y, z)', d: '3D: bullet, blood, pool, scorch, crack.' },
  { t: 'api.light(self.x, self.y, 200, 0xffcc88, 1)', k: 'api.light(x, y, radio, color, i)', d: '2D: luz con sombras (api.lights2d para más).' },
  { t: 'api.rigid.world', k: 'api.rigid', d: '2D: motor de cuerpos rígidos (uniones, rayos, explosiones).' },
  { group: 'Red, web3 y puente' },
  { t: "api.http('GET', '/api/puntos').then(function (r) {\n  api.log(r.status, r.data);\n});", k: 'api.http(método, ruta, cuerpo)', d: 'Petición a tu backend (o a orígenes permitidos). Promesa {ok, status, data}.' },
  { t: 'api.web3.connect().then(function () {\n  api.log(api.web3.account);\n});', k: 'api.web3.connect()', d: 'Conecta la cartera (o la simulada).' },
  { t: "api.web3.read('MiToken', 'balanceOf', api.web3.account).then(function (v) {\n  api.log(v.toString());\n});", k: 'api.web3.read(c, fn, ...args)', d: 'Lectura gratuita de un contrato.' },
  { t: "api.web3.write('MiToken', 'mint', [api.web3.account, 1]);", k: 'api.web3.write(c, fn, args, eth)', d: 'Transacción (la confirma el jugador).' },
  { t: "api.web3.sign('Hola ' + api.web3.account)", k: 'api.web3.sign(texto)', d: 'Firma un mensaje (inicio de sesión sin contraseña).' },
  { t: "api.bridge.send('puntos', api.get('puntos'))", k: 'api.bridge.send(nombre, datos)', d: 'Mensaje a la página que contiene el juego.' },
  { t: "api.bridge.on('comando', function (data) {\n  \n});", k: 'api.bridge.on(nombre, fn)', d: 'Mensajes que llegan de la página.' },
  { group: '2D (self es un objeto del motor)' },
  { t: 'self.x += 200 * dt;', k: 'self.x / self.y', d: 'Posición.' },
  { t: 'self.angle += 90 * dt;', k: 'self.angle', d: 'Rotación en grados.' },
  { t: 'self.body.setVelocity(0, -400);', k: 'self.body', d: 'Cuerpo arcade (si tiene física arcade; con cuerpos rígidos es self.rbody). Para que valga con los dos: api.setVelocity / api.velocity.' },
  { t: 'self.rbody.applyImpulse(0, -500);', k: 'self.rbody', d: 'Cuerpo rígido (escenas con «cuerpos rígidos»).' },
  { t: 'self.setTint(0xff0000);', k: 'self.setTint(color)', d: 'Colorea un sprite.' },
  { group: '3D' },
  { t: 'self.position.y += dt;', k: 'self.position', d: 'Posición (Vec3).' },
  { t: 'self.rotation.y += dt;', k: 'self.rotation', d: 'Rotación en radianes.' },
  { t: "self.play('Walk');", k: "self.play('Clip')", d: 'Animación de un modelo glTF.' },
  { t: 'api.physics.raycast(origen, direccion, 50)', k: 'api.physics.raycast', d: 'Rayo en el mundo físico 3D.' }
];
const REF_BACKEND = [
  { group: 'Rutas del backend (Node, sin dependencias)' },
  { t: 'return { ok: true };', k: 'return valor', d: 'Lo que devuelves se envía como JSON (código 200).' },
  { t: "return ctx.fail(400, 'Datos no válidos');", k: 'ctx.fail(código, mensaje)', d: 'Respuesta de error.' },
  { t: 'ctx.body', k: 'ctx.body', d: 'Cuerpo JSON recibido (ya validado y sin claves peligrosas).' },
  { t: 'ctx.query.pagina', k: 'ctx.query', d: 'Parámetros de la URL (?pagina=2).' },
  { t: 'ctx.params.id', k: 'ctx.params', d: 'Partes de la ruta (/api/jugador/:id).' },
  { t: "db.get('puntos', [])", k: 'db.get(clave, porDefecto)', d: 'Base de datos clave-valor (data/db.json).' },
  { t: "db.set('puntos', lista)", k: 'db.set(clave, valor)', d: 'Guarda (se escribe en disco de forma atómica).' },
  { t: "db.push('puntos', { nombre: 'ana', puntos: 10 }, 100)", k: 'db.push(clave, valor, max)', d: 'Añade a una lista (máximo de elementos).' },
  { t: "db.incr('visitas', 1)", k: 'db.incr(clave, n)', d: 'Contador.' },
  { t: "db.list('jugador:')", k: 'db.list(prefijo)', d: 'Claves que empiezan por un prefijo.' },
  { t: "ctx.text(ctx.body.nombre, 20)", k: 'ctx.text(valor, max)', d: 'Texto limpio (sin caracteres de control), recortado.' },
  { t: 'ctx.int(ctx.body.puntos, 0, 1e9)', k: 'ctx.int(valor, min, max)', d: 'Entero validado (o error 400).' },
  { t: "ctx.log('info', 'mensaje')", k: 'ctx.log(...)', d: 'Registro del servidor (se ve en la pestaña Backend).' }
];

export class CodePanel {
  constructor(app, host) {
    this.app = app; this.host = host; this.current = null; this.errors = new Map(); this.editor = null;
    const ed = app.editor;
    ['project', 'scene'].forEach((ev) => ed.on(ev, () => { if (this.current === '__scene' || !this.exists(this.current)) this.current = null; this.render(); }));
    ed.on('change', (d) => { if ((d.kind === 'all' || d.kind === 'scripts' || d.kind === 'web3' || d.kind === 'backend') && !this.typing) this.renderSoon(); });
    this.commit = { flush: () => { if (this.editor) this.editor.flush(); } };
  }
  /** Fuentes de código de otros módulos: [{ group, id, name, icon, lang, get(), set(v) | null, sub }] */
  sources() {
    const out = []; (this.app.codeSources || []).forEach((fn) => { try { (fn() || []).forEach((s) => out.push(s)); } catch (e) { /* módulo sin proyecto */ } });
    return out;
  }
  source(id) {
    const ed = this.app.editor;
    if (!id || !ed.project) return null;
    if (id === '__scene') return ed.scene ? { id, name: 'Script de escena · ' + ed.scene.name, lang: 'js', get: () => ed.scene.script, set: (v) => ed.edit('Editar script de escena', () => { ed.scene.script = v; }, 'scripts'), kind: 'scene' } : null;
    const s = ed.project.scripts.find((x) => x.id === id);
    if (s) return { id, name: s.name, lang: 'js', script: s, get: () => s.code, set: (v) => ed.edit('Editar script', (p) => { const x = p.scripts.find((y) => y.id === id); if (x) x.code = v; }, 'scripts'), kind: 'script' };
    return this.sources().find((x) => x.id === id) || null;
  }
  exists(id) { return !!this.source(id); }
  renderSoon() { clearTimeout(this._t); this._t = setTimeout(() => this.render(), 30); }
  open(id, line) {
    const ed = this.app.editor;
    if (id === '__scene' && ed.scene && !ed.scene.script.trim()) ed.edit('Crear script de escena', () => { ed.scene.script = DEFAULT_SCENE_SCRIPT; }, 'scripts');
    this.commit.flush(); this.current = id; this.render();
    if (line && this.editor) setTimeout(() => this.editor.gotoLine(line), 30);
  }
  gotoLine(line) { if (this.editor) this.editor.gotoLine(line); }
  setErrors(scriptId, lines) { this.errors.set(scriptId, lines); if (scriptId === this.current && this.editor) this.editor.setErrors(lines); }
  get ta() { return this.editor ? this.editor.ta : null; }
  render() {
    const ed = this.app.editor, host = this.host; clear(host); this.editor = null;
    if (!ed.project) return;
    const list = h('ul');
    const item = (id, icon, name, sub) => { const li = h('li', { class: id === this.current ? 'on' : null, title: name }, h('span', icon), h('span.grow', name), sub ? h('small', { style: { color: 'var(--dim)' } }, sub) : null); li.onclick = () => this.open(id); return li; };
    list.appendChild(h('li.grp', 'Juego'));
    list.appendChild(item('__scene', '🎬', 'Script de escena', ed.scene ? ed.scene.name : ''));
    ed.project.scripts.forEach((s) => {
      const uses = ed.project.scenes.reduce((n, sc) => n + sc.nodes.filter((x) => x.script === s.id).length, 0);
      list.appendChild(item(s.id, s.plugin ? '🔌' : '{ }', s.name, s.plugin ? 'plugin' : uses ? uses + ' obj.' : 'sin usar'));
    });
    let lastGroup = null;
    this.sources().forEach((s) => { if (s.group !== lastGroup) { list.appendChild(h('li.grp', s.group)); lastGroup = s.group; } list.appendChild(item(s.id, s.icon || '📄', s.name, s.sub || (s.set ? '' : 'solo lectura'))); });
    const newScript = async (plugin) => { const n = await prompt(plugin ? 'Nuevo plugin' : 'Nuevo script', 'Nombre', plugin ? 'mi_plugin' : 'mi_script'); if (!n) return; const s = ed.addScript(n.slice(0, 60), plugin ? DEFAULT_PLUGIN : DEFAULT_SCRIPT); if (plugin) ed.edit('Plugin', (p) => { const x = p.scripts.find((y) => y.id === s.id); if (x) x.plugin = true; }, 'scripts'); this.open(s.id); };
    const side = h('div.code-list', h('div.block-head', h('span', 'Código'), h('div.head-actions',
      h('button.icon', { type: 'button', title: 'Nuevo script', on: { click: () => newScript(false) } }, '＋'),
      h('button.icon', { type: 'button', title: 'Nuevo plugin global (puente JS)', on: { click: () => newScript(true) } }, '🔌'))), list);
    const main = h('div.code-main'), src = this.source(this.current);
    if (!src) {
      main.appendChild(h('div.empty', 'Elige un archivo a la izquierda. Los scripts se asignan a objetos en el Inspector; los plugins (🔌) son código global que corre en todas las escenas y puede hablar con la página que contiene el juego.'));
    } else {
      const s = src.script;
      const bar = h('div.code-bar', h('span.title', src.name), src.lang !== 'js' ? h('span.chip', src.lang === 'sol' ? 'Solidity' : src.lang.toUpperCase()) : null, h('span.grow'),
        s ? h('label.chk', { title: 'Un plugin corre siempre (onGameStart, onSceneStart, onUpdate, onBridge) sin asignarlo a objetos' }, h('input', { type: 'checkbox', checked: s.plugin, on: { change: (e) => ed.edit(e.target.checked ? 'Convertir en plugin' : 'Quitar plugin', (p) => { const x = p.scripts.find((y) => y.id === s.id); if (x) x.plugin = e.target.checked; }, 'scripts') } }), ' Plugin global') : null,
        s ? h('button.btn.small', { type: 'button', on: { click: async () => { const n = await prompt('Renombrar script', 'Nombre', s.name); if (n) ed.edit('Renombrar script', () => { s.name = n.slice(0, 60); }, 'scripts'); } } }, '✏️ Renombrar') : null,
        s ? h('button.btn.small.danger', { type: 'button', on: { click: async () => { if (await confirm('Borrar script', '¿Borrar "' + s.name + '"? Los objetos que lo usan se quedan sin script.', 'Borrar', true)) { ed.edit('Borrar script', (p) => { p.scripts = p.scripts.filter((x) => x.id !== s.id); p.scenes.forEach((sc) => sc.nodes.forEach((n) => { if (n.script === s.id) n.script = null; })); }, 'scripts'); this.current = null; this.render(); } } } }, '🗑') : null,
        src.download ? h('button.btn.small', { type: 'button', on: { click: () => src.download() } }, '⬇ Descargar') : null,
        h('button.btn.small', { type: 'button', title: 'Copiar todo', on: { click: () => { navigator.clipboard && navigator.clipboard.writeText(this.editor ? this.editor.value : '').then(() => toast('Copiado'), () => toast('No se pudo copiar', 'warn')); } } }, '📋'),
        h('span.help', src.set ? 'Se guarda solo · Ctrl+F buscar · Ctrl+/ comentar' : 'Solo lectura (se genera al exportar)'));
      let text = ''; try { text = src.get() || ''; } catch (e) { text = '// ' + e.message; }
      this.editor = new CodeEditor({ value: text, lang: src.lang || 'js', readOnly: !src.set, label: src.name,
        onChange: (v) => { if (!src.set) return; let cur = ''; try { cur = src.get(); } catch (e) { /* nada */ } if (v === cur) return; this.typing = true; try { src.set(v); } finally { this.typing = false; } },
        onSave: () => ed.save() });
      this.editor.setErrors(this.errors.get(this.current) || []);
      main.appendChild(bar); main.appendChild(this.editor.el);
    }
    const ref = h('div.code-ref', h('b', 'Referencia'), h('div.help', 'Clic para insertar en el cursor.'));
    const refs = src && src.kind === 'route' ? REF_BACKEND : src && src.lang === 'sol' ? [] : REF;
    if (src && src.lang === 'sol') ref.appendChild(h('div.help', 'Solidity: el ABI se genera solo al guardar (pestaña Web3). Para compilar usa Remix, Hardhat o Foundry y pega el bytecode en la pestaña Web3 para desplegar.'));
    refs.forEach((r) => { if (r.group) { ref.appendChild(h('h4', r.group)); return; } const sn = h('div.snip', h('b', r.k), h('div', r.d)); sn.onclick = () => { if (this.editor) this.editor.insert(r.t); else toast('Abre un archivo primero'); }; ref.appendChild(sn); });
    host.appendChild(side); host.appendChild(main); host.appendChild(ref);
  }
}
