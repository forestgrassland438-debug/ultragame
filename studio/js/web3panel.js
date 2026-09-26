/* UltraGame Studio · pestaña Web3: contratos Solidity (plantillas ERC-20/721/1155, clasificación, tienda, recompensas),
 * ABI generado del código, direcciones por red, respuestas simuladas, despliegue con tu cartera, pruebas de funciones y
 * exportación a Hardhat/Foundry. Web3Host es el intermediario entre el juego (iframe aislado) y la cartera real:
 * lista blanca de métodos, redes permitidas, importe máximo, límite de peticiones y confirmación en el Studio. */
import { h, clear, toast, showMenu, prompt, confirm, dialog, downloadBlob, safeFileName } from './dom.js';
import { makeZip } from './export.js';

const S = window.UGStudio.schema, SOL = window.UGStudio.solidity, RT = window.UGStudio.runtime, W3 = window.UG.Web3;
const enc = new TextEncoder();
const chainName = (id) => (W3.CHAINS[id] ? W3.CHAINS[id].name : 'Red ' + id);
function parseABI(c) { try { return W3.normalizeABI(c.abi); } catch (e) { return []; } }
/** Texto legible de unos datos EIP-712 (lo que el juego pide firmar con eth_signTypedData_v4) */
function describeTypedData(raw) {
  let d = raw;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return 'Datos no legibles: ' + d.slice(0, 300); } }
  if (!d || typeof d !== 'object') return 'Datos vacíos';
  const dom = d.domain && typeof d.domain === 'object' ? d.domain : {};
  const lines = [];
  if (dom.name) lines.push('Aplicación: ' + String(dom.name).slice(0, 80));
  if (dom.chainId !== undefined) lines.push('Red: ' + chainName(Number(dom.chainId)));
  if (dom.verifyingContract) lines.push('Contrato: ' + String(dom.verifyingContract).slice(0, 60));
  lines.push('Tipo: ' + String(d.primaryType || '?').slice(0, 60));
  let body = ''; try { body = JSON.stringify(d.message === undefined ? null : d.message, null, 1); } catch (e) { body = '(no se puede mostrar)'; }
  return lines.join('\n') + '\nContenido: ' + body;
}
function fmtVal(v) { if (typeof v === 'bigint') return v.toString(); if (Array.isArray(v)) return '[' + v.map(fmtVal).join(', ') + ']'; if (v instanceof Uint8Array) return W3.bytesToHex(v); if (v && typeof v === 'object') return '{' + Object.keys(v).map((k) => k + ': ' + fmtVal(v[k])).join(', ') + '}'; return String(v); }

/* ================================================================ cartera real (página del Studio) */
async function discoverProvider() {
  const list = await W3.discover(450);
  if (!list.length) throw Object.assign(new Error('No hay ninguna cartera instalada en este navegador (MetaMask, Rabby, Coinbase Wallet…). Para probar sin cartera usa el modo «Simulado».'), { code: 4900 });
  return list[0];
}

export class Web3Host {
  constructor(app) { this.app = app; this.provider = null; this.name = ''; this.times = []; this.frame = null; this.onAcc = null; this.onChain = null; this.project = null; }
  /** Empieza una partida: frame = contentWindow del reproductor, project = copia que se está jugando */
  attach(frameWin, project) { this.detach(); this.frame = frameWin; this.project = project; }
  detach() {
    if (this.provider && this.provider.removeListener && this.onAcc) { try { this.provider.removeListener('accountsChanged', this.onAcc); this.provider.removeListener('chainChanged', this.onChain); } catch (e) { /* cartera cerrada */ } }
    this.onAcc = this.onChain = null; this.frame = null; this.project = null;
  }
  async ensure() {
    if (!this.provider) { const d = await discoverProvider(); this.provider = d.provider; this.name = d.info.name; }
    if (!this.onAcc && this.provider.on) {
      this.onAcc = (a) => this.emit('accountsChanged', a); this.onChain = (c) => this.emit('chainChanged', c);
      this.provider.on('accountsChanged', this.onAcc); this.provider.on('chainChanged', this.onChain);
    }
    return this.provider;
  }
  emit(event, data) { if (this.frame) { try { this.frame.postMessage({ type: 'web3-event', event, data: JSON.parse(JSON.stringify(data === undefined ? null : data)) }, '*'); } catch (e) { /* juego cerrado */ } } }
  /** Petición del juego -> validada -> cartera. Devuelve el resultado o lanza {code, message} */
  async handle(method, params) {
    const frame = this.frame, P = (this.project || this.app.editor.project).web3;
    // tras cada espera (confirmación, cartera): si el juego se detuvo o se reinició, la petición ya no sigue
    const alive = () => { if (this.frame !== frame) throw { code: 4100, message: 'El juego se detuvo antes de terminar la petición' }; };
    if (!P.enabled || P.mode !== 'wallet') throw { code: 4100, message: 'Web3 con cartera real no está activado en este proyecto' };
    if (typeof method !== 'string' || W3.ALLOWED_METHODS.indexOf(method) < 0) throw { code: 4200, message: 'Método no permitido por seguridad: ' + String(method).slice(0, 40) };
    if (!Array.isArray(params)) params = [];
    const now = Date.now(); this.times = this.times.filter((t) => now - t < 1000);
    if (this.times.length >= 15) throw { code: 4900, message: 'Demasiadas peticiones seguidas' };
    this.times.push(now);
    if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
      const id = parseInt(params[0] && params[0].chainId, 16);
      if (!P.chains.includes(id)) throw { code: 4901, message: 'La red ' + id + ' no está permitida en este proyecto' };
    }
    if (method === 'eth_sendTransaction') {
      const tx = params[0];
      if (!tx || typeof tx !== 'object' || !W3.isAddress(String(tx.to || ''))) throw { code: 4200, message: 'Transacción no válida (el juego no puede desplegar contratos)' };
      let value; try { value = BigInt(tx.value || '0x0'); } catch (e) { throw { code: 4200, message: 'Importe no válido' }; }
      if (value > W3.parseUnits(P.maxValue, 18)) throw { code: 4200, message: 'Importe por encima del máximo del proyecto (' + P.maxValue + ' ETH)' };
      if (value < BigInt(0)) throw { code: 4200, message: 'Importe no válido' };
      const fn = this.describeCall(tx, P), known = this.isProjectContract(tx.to, P);
      const ok = await confirm('El juego quiere enviar una transacción', 'Contrato: ' + tx.to + (known ? '' : '\n⚠ Esta dirección no es de ningún contrato del proyecto.') + (fn ? '\nFunción: ' + fn : '') + '\nPago: ' + W3.formatUnits(value, 18) + ' ETH\n\nSi aceptas, tu cartera te la mostrará para que la confirmes.', 'Pasar a la cartera');
      if (!ok) throw { code: 4001, message: 'Cancelado en el Studio' };
      alive();
    }
    if (method === 'personal_sign' || method === 'eth_signTypedData_v4') {
      // personal_sign: [mensaje, cuenta] · eth_signTypedData_v4: [cuenta, datos tipados]: se enseña siempre lo que se firma
      let msg;
      if (method === 'personal_sign') {
        msg = String(params[0] || '');
        if (/^0x[0-9a-f]*$/i.test(msg)) { try { msg = new TextDecoder('utf-8', { fatal: true }).decode(W3.hexToBytes(msg)); } catch (e) { /* binario: se muestra en hexadecimal */ } }
      } else msg = describeTypedData(params[1]);
      const ok = await confirm('El juego quiere que firmes ' + (method === 'personal_sign' ? 'un mensaje' : 'datos estructurados (EIP-712)'), '«' + msg.slice(0, 900) + (msg.length > 900 ? '…' : '') + '»\n\nFirmar no mueve dinero por sí solo, pero una firma puede autorizar acciones: firma solo lo que entiendas y en lo que confíes.', 'Pasar a la cartera');
      if (!ok) throw { code: 4001, message: 'Cancelado en el Studio' };
      alive();
    }
    const prov = await this.ensure();
    alive();
    return prov.request({ method, params });
  }
  isProjectContract(to, P) {
    const t = String(to || '').toLowerCase();
    return P.contracts.some((c) => Object.values(c.addresses).some((a) => String(a).toLowerCase() === t));
  }
  describeCall(tx, P) {
    const data = String(tx.data || ''); if (data.length < 10) return '';
    for (const c of P.contracts) {
      if (!Object.values(c.addresses).some((a) => a.toLowerCase() === String(tx.to).toLowerCase())) continue;
      const f = parseABI(c).find((x) => x.type === 'function' && W3.selector(x) === data.slice(0, 10));
      if (f) { let args = ''; try { args = W3.decodeParams(f.inputs, '0x' + data.slice(10)).map(fmtVal).join(', '); } catch (e) { /* no decodifica */ } return c.name + '.' + f.name + '(' + args.slice(0, 300) + ')'; }
    }
    return 'selector ' + data.slice(0, 10);
  }
}

/* ================================================================ panel */
export class Web3Panel {
  constructor(app, host) {
    this.app = app; this.host = host; this.sel = null; this.wallet = null; this.results = new Map();
    this.hostProxy = new Web3Host(app);
    const ed = app.editor;
    ed.on('project', () => { this.sel = null; this.results.clear(); this._mockW = null; this._mockVer = null; if (this.visible) this.render(); });
    // cualquier cambio de web3 (también los de este panel: renombrar, borrar, modo, redes…) se ve al momento
    ed.on('change', (d) => { if ((d.kind === 'all' || d.kind === 'web3') && this.visible) this.render(); });
    (app.codeSources || (app.codeSources = [])).push(() => this.codeSources());
  }
  get w3() { const p = this.app.editor.project; return p ? p.web3 : null; }
  setVisible(on) { this.visible = on; if (on) this.render(); }
  edit(label, fn) { this.app.editor.edit(label, (p) => fn(p.web3), 'web3'); }
  contract(id) { return this.w3 ? this.w3.contracts.find((c) => c.id === id) || null : null; }
  codeSources() {
    const ed = this.app.editor, w = this.w3; if (!w) return [];
    return w.contracts.map((c) => ({ group: 'Contratos (Solidity)', id: '__sol:' + c.id, name: c.name + '.sol', icon: '⛓', lang: 'sol',
      get: () => { const x = this.contract(c.id); return x ? x.source : ''; },
      set: (v) => this.setSource(c.id, v), download: () => downloadBlob(new Blob([this.contract(c.id).source], { type: 'text/plain' }), c.name + '.sol') }));
  }
  /** Guarda el código y regenera el ABI (si se puede leer) */
  setSource(id, src) {
    let warn = null;
    this.edit('Editar contrato', (w) => {
      const c = w.contracts.find((x) => x.id === id); if (!c) return;
      c.source = src;
      const r = SOL.abiFor(src, c.name);
      if (r.name && r.name !== c.name && /^[A-Za-z_]\w{0,63}$/.test(r.name) && !SOL.contractNames(src).includes(c.name)) c.name = r.name;
      if (r.abi.length) c.abi = JSON.stringify(r.abi);
      warn = r.warnings;
    });
    this.lastWarnings = warn;
  }

  /* ---------------------------------------------------------------- acciones */
  async addContract(key) {
    const T = SOL.TEMPLATES[key];
    let name = await prompt('Nuevo contrato · ' + T.label, 'Nombre del contrato (sin espacios; también será su nombre en Solidity)', T.name);
    if (!name) return;
    name = name.replace(/[^A-Za-z0-9_]/g, '').replace(/^[0-9]+/, '').slice(0, 64) || T.name;
    if (this.w3.contracts.some((c) => c.name === name)) { toast('Ya hay un contrato con ese nombre', 'warn'); return; }
    const src = T.source(name), r = SOL.abiFor(src, name), id = S.uid('k');
    this.edit('Añadir contrato', (w) => { if (w.contracts.length < 50) w.contracts.push({ id, name, source: src, abi: JSON.stringify(r.abi), addresses: {}, mock: JSON.stringify(T.mock || {}, null, 1), bytecode: '', args: (T.args || []).slice() }); if (!w.enabled) w.enabled = true; });
    this.sel = id; this.render();
    toast('Contrato «' + name + '» creado. En modo simulado ya se puede usar desde el juego.', 'ok');
  }
  studioWallet() {
    if (!this.wallet) this.wallet = new W3.Wallet({ chains: this.w3.chains, maxValue: '1000000' });
    this.wallet.chains = this.w3.chains.map(Number); // redes del proyecto abierto (pueden cambiar tras crear la cartera)
    return this.wallet;
  }
  async connectStudio() {
    try {
      const w = this.studioWallet();
      if (!w.provider) { const d = await discoverProvider(); w.provider = d.provider; this.walletName = d.info.name; }
      await w.connect({ chainId: this.w3.defaultChain });
      toast('Cartera conectada: ' + W3.shortAddress(w.account) + ' · ' + chainName(w.chainId), 'ok');
      try { this.balance = W3.formatUnits(await w.getBalance(), 18, 5); } catch (e) { this.balance = null; }
    } catch (e) { toast(e.message, 'error', 7000); }
    this.render();
  }
  /** Proveedor para probar funciones: simulado (con las respuestas del proyecto) o la cartera real conectada */
  testWallet() {
    if (this.w3.mode === 'mock') {
      if (!this._mockW || this._mockVer !== this.w3) { this._mockW = new W3.Wallet({ provider: RT.mockProvider(this.app.editor.project), chains: this.w3.chains }); this._mockVer = this.w3; }
      return this._mockW;
    }
    return this.studioWallet();
  }
  async callFn(c, f, args, value) {
    const key = c.id + ':' + W3.signature(f), ro = f.stateMutability === 'view' || f.stateMutability === 'pure';
    // al volver a pulsar se ve que está pendiente (antes el resultado anterior seguía ahí y parecía la respuesta nueva)
    this.results.set(key, { ok: true, pending: true, text: ro ? 'Leyendo…' : 'Enviando…' }); this.renderResults();
    try {
      const w = this.testWallet(), mock = this.w3.mode === 'mock';
      if (!w.provider) throw new Error('Conecta tu cartera primero (arriba)');
      if (!mock && !w.connected) await w.connect({ chainId: this.w3.defaultChain });
      if (mock && !w.connected) await w.connect({});
      const addr = RT.contractAddress(c, mock ? this.w3.defaultChain : w.chainId, mock);
      if (!addr) throw new Error('Este contrato no tiene dirección en ' + chainName(w.chainId) + ': despliégalo o escribe su dirección');
      const k = w.contract(addr, parseABI(c)), parsed = args.map((a) => RT.toArg(a.split('{cuenta}').join(w.account || '')));
      let out;
      if (f.stateMutability === 'view' || f.stateMutability === 'pure') out = await k.read.apply(k, [W3.signature(f)].concat(parsed));
      else {
        const hash = await k.write(W3.signature(f), parsed, { value: value ? W3.parseUnits(value, 18) : BigInt(0) });
        this.results.set(key, { ok: true, pending: true, text: 'Enviada: ' + hash + ' · esperando confirmación…' }); this.renderResults();
        const rc = await w.waitForReceipt(hash); out = 'Confirmada en el bloque ' + parseInt(rc.blockNumber, 16);
      }
      // saldos e importes de tokens en wei: también en unidades (lo habitual en ERC-20 son 18 decimales)
      let txt = fmtVal(out);
      if (typeof out === 'bigint' && out >= BigInt(1e15) && /balance|supply|allowance|price|amount|value|reward|saldo|precio|premio/i.test(f.name)) txt += '   (≈ ' + W3.formatUnits(out, 18, 6) + ' con 18 decimales)';
      this.results.set(key, { ok: true, text: txt });
    } catch (e) { this.results.set(key, { ok: false, text: e.message }); }
    this.renderResults();
  }
  async deploy(c) {
    const b = String(c.bytecode || '').trim();
    if (!/^(0x)?[0-9a-fA-F]{10,}$/.test(b)) { toast('Pega primero el bytecode compilado (Remix: Compilar › Bytecode · Hardhat: artifacts/…json › bytecode)', 'warn', 7000); return; }
    const ctor = parseABI(c).find((x) => x.type === 'constructor');
    let data = (b.startsWith('0x') ? b : '0x' + b);
    try { if (ctor && ctor.inputs.length) data += W3.encodeParams(ctor.inputs, (c.args || []).slice(0, ctor.inputs.length).map(RT.toArg)).slice(2); }
    catch (e) { toast('Argumentos del constructor: ' + e.message, 'error'); return; }
    const w = this.studioWallet();
    try {
      if (!w.provider) { const d = await discoverProvider(); w.provider = d.provider; }
      if (!w.connected) await w.connect({ chainId: this.w3.defaultChain });
      if (!(await confirm('Desplegar «' + c.name + '»', 'Red: ' + chainName(w.chainId) + '\nCuenta: ' + w.account + '\n\nTu cartera te mostrará el coste (gas). ¿Continuar?', 'Desplegar'))) return;
      toast('Confirma el despliegue en tu cartera…');
      const hash = await w.request('eth_sendTransaction', [{ from: w.account, data, value: '0x0' }]);
      toast('Desplegando… (' + hash.slice(0, 12) + '…)');
      const rc = await w.waitForReceipt(hash, { timeout: 300000 });
      if (!rc.contractAddress || !W3.isAddress(rc.contractAddress)) throw new Error('El recibo no trae dirección de contrato');
      const addr = W3.toChecksumAddress(rc.contractAddress), chain = String(w.chainId);
      this.edit('Dirección del contrato', (ww) => { const x = ww.contracts.find((y) => y.id === c.id); if (x) x.addresses[chain] = addr; });
      toast('«' + c.name + '» desplegado en ' + addr, 'ok', 8000); this.render();
    } catch (e) { toast('Despliegue: ' + e.message, 'error', 8000); }
  }
  exportTool(kind) {
    const list = this.w3.contracts.map((c) => ({ name: c.name, source: c.source, args: c.args || [] }));
    if (!list.length) { toast('No hay contratos', 'warn'); return; }
    const files = (kind === 'foundry' ? SOL.foundryFiles(list) : SOL.hardhatFiles(list, chainName(this.w3.defaultChain))).map((f) => ({ path: 'contratos/' + f.path, data: enc.encode(f.text) }));
    downloadBlob(makeZip(files), safeFileName(this.app.editor.project.name, '-' + kind + '.zip'));
    toast('Proyecto ' + (kind === 'foundry' ? 'Foundry' : 'Hardhat') + ' descargado (compila y despliega desde ahí)', 'ok');
  }

  /* ---------------------------------------------------------------- interfaz */
  render() {
    const host = this.host, ed = this.app.editor;
    // al redibujar se conservan las secciones abiertas y el desplazamiento (si no, cada cambio las cerraba)
    const opened = new Set(Array.from(host.querySelectorAll('details')).filter((d) => d.open).map((d) => ((d.querySelector('summary') || {}).textContent || '').replace(/\d+/g, '#')));
    const scrolls = Array.from(host.querySelectorAll('.pane-col')).map((c) => c.scrollTop), top = host.scrollTop;
    clear(host);
    if (!ed.project) return;
    const w = this.w3;
    if (this.sel && !this.contract(this.sel)) this.sel = null;
    if (!this.sel && w.contracts[0]) this.sel = w.contracts[0].id;
    const head = h('div.pane-head', h('h3', '⛓ Web3 · contratos y cartera'), h('span.grow'),
      h('label.chk', h('input', { type: 'checkbox', checked: w.enabled, on: { change: (e) => this.edit(e.target.checked ? 'Activar web3' : 'Desactivar web3', (x) => { x.enabled = e.target.checked; }) } }), ' Activado en el juego'),
      h('button.btn.small', { type: 'button', on: { click: (e) => showMenu([{ label: 'Proyecto Hardhat (.zip)', icon: '⛑', action: () => this.exportTool('hardhat') }, { label: 'Proyecto Foundry (.zip)', icon: '⚒', action: () => this.exportTool('foundry') }, '-', { label: 'Abrir Remix (compilar en la web)', icon: '🌐', action: () => window.open('https://remix.ethereum.org/', '_blank', 'noopener,noreferrer') }], e.currentTarget) } }, '⬇ Exportar ▾'));
    const modeSel = h('select', { on: { change: (e) => this.edit('Modo web3', (x) => { x.mode = e.target.value; }) } }, h('option', { value: 'mock', selected: w.mode === 'mock' }, 'Simulado (sin cartera ni blockchain)'), h('option', { value: 'wallet', selected: w.mode === 'wallet' }, 'Cartera real (MetaMask, Rabby…)'));
    const chains = h('div.chain-list', Object.keys(W3.CHAINS).map((id) => { id = Number(id); return h('label.chk', h('input', { type: 'checkbox', checked: w.chains.includes(id), on: { change: (e) => this.edit('Redes', (x) => { const s = new Set(x.chains); if (e.target.checked) s.add(id); else s.delete(id); x.chains = Array.from(s); if (!x.chains.length) x.chains = [id]; if (!x.chains.includes(x.defaultChain)) x.defaultChain = x.chains[0]; }) } }), ' ' + chainName(id)); }));
    const defSel = h('select', { on: { change: (e) => this.edit('Red principal', (x) => { x.defaultChain = Number(e.target.value); }) } }, w.chains.map((id) => h('option', { value: id, selected: id === w.defaultChain }, chainName(id) + ' (' + id + ')')));
    const maxIn = h('input', { type: 'text', value: w.maxValue, spellcheck: 'false', on: { keydown: (e) => e.stopPropagation(), change: (e) => { const v = e.target.value.trim(); if (!/^\d{1,12}(\.\d{1,18})?$/.test(v)) { toast('Importe no válido (ej. 0.05)', 'warn'); e.target.value = w.maxValue; return; } this.edit('Importe máximo', (x) => { x.maxValue = v; }); } } });
    const sw = this.wallet;
    const walletBox = h('div.card', h('b', '🦊 Tu cartera (para desplegar y probar)'),
      sw && sw.connected ? h('div', h('span.pill.ok', '● ' + W3.shortAddress(sw.account)), ' ', chainName(sw.chainId), this.balance ? ' · ' + this.balance + ' ' + ((W3.CHAINS[sw.chainId] || {}).symbol || 'ETH') : '') : h('div.help', 'No conectada. Las pruebas en modo simulado no la necesitan.'),
      h('div.row-actions', h('button.btn.small', { type: 'button', on: { click: () => this.connectStudio() } }, sw && sw.connected ? '↻ Reconectar' : '🔌 Conectar cartera'),
        sw && sw.connected && sw.chainId !== w.defaultChain ? h('button.btn.small', { type: 'button', on: { click: async () => { try { await sw.switchChain(w.defaultChain); this.render(); } catch (e) { toast(e.message, 'error'); } } } }, 'Cambiar a ' + chainName(w.defaultChain)) : null));
    const settings = h('div.card', h('b', 'Ajustes'),
      h('div.field', h('label', 'Modo al jugar'), modeSel), h('div.field', h('label', 'Red principal'), defSel), h('div.field', h('label', 'Pago máximo por transacción (ETH)'), maxIn),
      h('details.sub', h('summary', 'Redes permitidas (' + w.chains.length + ')'), chains),
      h('div.help', w.mode === 'mock' ? 'Simulado: cuenta 0x1111…1111 con 10 ETH; cada función devuelve lo que pongas en «Respuestas simuladas». Ideal para diseñar el juego sin gastar nada.' : 'Cartera real: al jugar desde el Studio, cada transacción o firma pasa primero por una confirmación del Studio y después por tu cartera. Usa redes de pruebas (Sepolia, Base Sepolia, Amoy).'));
    // contratos
    const list = h('ul.list.k-list');
    w.contracts.forEach((c) => { const li = h('li', { class: c.id === this.sel ? 'on' : null }, h('span', '⛓'), h('span.grow', c.name), h('small', Object.keys(c.addresses).length ? Object.keys(c.addresses).length + ' red(es)' : 'sin desplegar')); li.onclick = () => { this.sel = c.id; this.render(); }; list.appendChild(li); });
    if (!w.contracts.length) list.appendChild(h('li.empty', 'Sin contratos'));
    const add = h('button.btn.small.primary', { type: 'button' }, '＋ Contrato');
    add.onclick = () => showMenu([{ group: 'Plantillas (Solidity 0.8.24, sin dependencias)' }].concat(Object.keys(SOL.TEMPLATES).map((k) => ({ label: SOL.TEMPLATES[k].label, icon: SOL.TEMPLATES[k].icon, action: () => this.addContract(k) }))), add);
    const left = h('div.pane-col.narrow', h('div.card', h('div.card-head', h('b.grow', 'Contratos'), add), list), settings, walletBox, this.helpCard());
    const right = h('div.pane-col', this.sel ? this.contractView(this.contract(this.sel)) : h('div.empty', 'Crea un contrato desde una plantilla: ERC-20 (monedas), ERC-721 (NFT únicos), ERC-1155 (inventario), clasificación, tienda o recompensas firmadas.'));
    host.appendChild(h('div.pane', head, h('div.pane-cols', left, right)));
    if (this._renderedSel === this.sel) {
      host.querySelectorAll('details').forEach((d) => { const t = ((d.querySelector('summary') || {}).textContent || '').replace(/\d+/g, '#'); if (opened.has(t)) d.open = true; });
      host.querySelectorAll('.pane-col').forEach((c, i) => { if (scrolls[i]) c.scrollTop = scrolls[i]; }); host.scrollTop = top;
    }
    this._renderedSel = this.sel;
    this.renderResults();
  }
  helpCard() {
    return h('div.card.help-card', h('b', 'Cómo lo usa el juego'),
      h('div.help', 'Eventos: «Conectar la cartera», «Leer de un contrato» (guarda el resultado en una variable), «Enviar transacción», «Firmar un mensaje»; condiciones «La cartera está conectada» y «Al ocurrir algo en la cartera». Tras conectar, {cuenta} es tu dirección y {red} la red.'),
      h('div.help', 'Scripts: api.web3.connect(), api.web3.read(\'Oro\', \'balanceOf\', api.web3.account), api.web3.write(\'Tienda\', \'buy\', [1, 1], \'0.01\'), api.web3.sign(texto).'),
      h('div.help', 'Seguridad: el juego nunca ve claves privadas; solo puede usar una lista cerrada de métodos (eth_sign está prohibido), las redes permitidas y un pago máximo por transacción.'));
  }
  contractView(c) {
    const abi = parseABI(c), fns = abi.filter((f) => f.type === 'function'), evs = abi.filter((f) => f.type === 'event'), ctor = abi.find((f) => f.type === 'constructor');
    const setC = (label, fn) => this.edit(label, (w) => { const x = w.contracts.find((y) => y.id === c.id); if (x) fn(x); });
    const warns = SOL.abiFor(c.source, c.name).warnings;
    const head = h('div.card', h('div.card-head', h('span', '⛓'), h('b.grow', c.name),
      h('button.btn.small', { type: 'button', on: { click: () => this.app.openScript('__sol:' + c.id) } }, '✏️ Editar Solidity'),
      h('button.btn.small', { type: 'button', on: { click: async () => { const n = await prompt('Renombrar contrato', 'Nombre (también cambia el nombre en el código)', c.name); if (!n) return; const nn = n.replace(/[^A-Za-z0-9_]/g, '').replace(/^[0-9]+/, '').slice(0, 64); if (!nn || this.w3.contracts.some((x) => x.name === nn && x.id !== c.id)) { toast('Nombre no válido o repetido', 'warn'); return; } setC('Renombrar contrato', (x) => { x.source = x.source.replace(new RegExp('\\bcontract\\s+' + x.name + '\\b'), 'contract ' + nn); x.name = nn; }); } } }, 'Renombrar'),
      h('button.btn.small.danger', { type: 'button', on: { click: async () => { if (await confirm('Borrar contrato', '¿Borrar «' + c.name + '» del proyecto? (No afecta a contratos ya desplegados.)', 'Borrar', true)) this.edit('Borrar contrato', (w) => { w.contracts = w.contracts.filter((x) => x.id !== c.id); }); } } }, '🗑')),
      h('div.help', fns.length + ' funciones · ' + evs.length + ' eventos' + (ctor ? ' · constructor(' + ctor.inputs.map((i) => i.type + ' ' + i.name).join(', ') + ')' : '')),
      warns.length ? h('div.warnbox', '⚠ ' + warns.slice(0, 4).join(' · ')) : null);
    // direcciones
    const addrs = h('div.card', h('b', '📍 Direcciones por red'),
      this.w3.chains.map((id) => h('div.field', h('label', chainName(id)), h('input', { type: 'text', value: c.addresses[String(id)] || '', placeholder: this.w3.mode === 'mock' && id === this.w3.defaultChain ? 'simulada: ' + RT.contractAddress(c, id, true) : '0x… (sin desplegar)', spellcheck: 'false',
        on: { keydown: (e) => e.stopPropagation(), change: (e) => { const v = e.target.value.trim(); if (v && !W3.isAddress(v)) { toast('Dirección no válida (o con mayúsculas EIP-55 incorrectas)', 'warn'); e.target.value = c.addresses[String(id)] || ''; return; } setC('Dirección', (x) => { if (v) x.addresses[String(id)] = W3.toChecksumAddress(v); else delete x.addresses[String(id)]; }); } } }))));
    // desplegar
    const argsIns = ctor ? ctor.inputs.map((inp, i) => h('div.field', h('label', inp.name + ' (' + inp.type + ')'), h('input', { type: 'text', value: (c.args || [])[i] || '', spellcheck: 'false', on: { keydown: (e) => e.stopPropagation(), change: (e) => setC('Argumentos', (x) => { const a = (x.args || []).slice(); a[i] = e.target.value.slice(0, 400); x.args = a; }) } }))) : [];
    const bc = h('textarea', { rows: 3, spellcheck: 'false', placeholder: '0x6080604052… (bytecode de Remix/Hardhat/Foundry)', value: c.bytecode, on: { keydown: (e) => e.stopPropagation(), change: (e) => { const v = e.target.value.trim().replace(/\s+/g, ''); if (v && !/^(0x)?[0-9a-fA-F]+$/.test(v)) { toast('El bytecode debe ser hexadecimal', 'warn'); return; } setC('Bytecode', (x) => { x.bytecode = v; }); } } });
    const deploy = h('details.card', { open: !Object.keys(c.addresses).length && this.w3.mode === 'wallet' }, h('summary', h('b', '🚀 Desplegar con tu cartera')),
      h('div.help', 'El Studio no incluye compilador de Solidity: compila en Remix (remix.ethereum.org) o con el proyecto Hardhat/Foundry exportado y pega aquí el bytecode.'),
      argsIns, bc, h('div.row-actions', h('button.btn.small.primary', { type: 'button', on: { click: () => this.deploy(this.contract(c.id)) } }, '🚀 Desplegar en ' + chainName(this.w3.defaultChain))));
    // probar funciones
    const tests = h('div.card', h('b', '🧪 Probar funciones ' + (this.w3.mode === 'mock' ? '(simulado)' : '(cartera real)')));
    fns.forEach((f) => {
      const ro = f.stateMutability === 'view' || f.stateMutability === 'pure', ins = f.inputs.map((p) => h('input', { type: 'text', placeholder: (p.name || 'arg') + ': ' + p.type, spellcheck: 'false', on: { keydown: (e) => e.stopPropagation() } }));
      const val = f.stateMutability === 'payable' ? h('input', { type: 'text', placeholder: 'ETH', style: { width: '70px' }, on: { keydown: (e) => e.stopPropagation() } }) : null;
      const key = c.id + ':' + W3.signature(f), out = h('div.fn-out', { dataset: { key } });
      tests.appendChild(h('div.fn-row', h('code', { class: ro ? 'ro' : 'rw', title: W3.signature(f) + ' · ' + W3.selector(f) }, f.name), ins, val,
        h('button.btn.small', { type: 'button', on: { click: () => this.callFn(this.contract(c.id), f, ins.map((i) => i.value.trim()), val ? val.value.trim() : '') } }, ro ? 'Leer' : 'Enviar'), out));
    });
    if (!fns.length) tests.appendChild(h('div.help', 'El ABI no tiene funciones: revisa el código Solidity.'));
    // simulado y ABI
    const mock = h('textarea', { rows: 6, spellcheck: 'false', value: c.mock, on: { keydown: (e) => e.stopPropagation(), change: (e) => { try { const o = JSON.parse(e.target.value || '{}'); if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('debe ser un objeto'); setC('Respuestas simuladas', (x) => { x.mock = JSON.stringify(o, null, 1); }); this._mockW = null; } catch (err) { toast('JSON no válido: ' + err.message, 'warn'); } } } });
    const abiTa = h('textarea', { rows: 6, spellcheck: 'false', value: JSON.stringify(abi, null, 1), on: { keydown: (e) => e.stopPropagation(), change: (e) => { try { const n = W3.normalizeABI(e.target.value); setC('ABI', (x) => { x.abi = JSON.stringify(n); }); } catch (err) { toast('ABI no válido: ' + err.message, 'warn'); } } } });
    const adv = h('details.card', h('summary', h('b', '🎭 Respuestas simuladas y ABI')),
      h('div.help', 'Qué devuelve cada función en modo simulado: { "balanceOf": "1000000000000000000", "name": "Oro", "ownerOf": "{cuenta}" }. Enteros grandes como texto.'), mock,
      h('div.help', 'ABI (se regenera al editar el Solidity; también puedes pegar el de un artefacto de Hardhat/Foundry o Etherscan).'), abiTa,
      h('div.row-actions', h('button.btn.small', { type: 'button', on: { click: () => { const r = SOL.abiFor(c.source, c.name); if (!r.abi.length) { toast('No se pudo leer el ABI del código', 'warn'); return; } setC('Regenerar ABI', (x) => { x.abi = JSON.stringify(r.abi); }); toast('ABI regenerado', 'ok'); } } }, '↻ Regenerar ABI del código'),
        h('button.btn.small', { type: 'button', on: { click: () => downloadBlob(new Blob([JSON.stringify(abi, null, 2)], { type: 'application/json' }), c.name + '.abi.json') } }, '⬇ ABI')));
    const events = evs.length ? h('details.card', h('summary', h('b', '📣 Eventos (' + evs.length + ')')), evs.map((e) => h('div.help', h('code', W3.signature(e)), ' · topic ' + W3.eventTopic(e).slice(0, 18) + '…'))) : null;
    return [head, addrs, tests, deploy, adv, events];
  }
  renderResults() {
    this.host.querySelectorAll('.fn-out').forEach((el) => { const r = this.results.get(el.dataset.key); el.textContent = r ? r.text : ''; el.className = 'fn-out' + (r ? (r.pending ? ' pending' : r.ok ? ' ok' : ' bad') : ''); });
  }
}
