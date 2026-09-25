/* UltraGame - API pública final. */

/** Orden de preferencia de renderers para renderer: 'auto'. */
UG.defaultRendererOrder = ['webgl2', 'webgpu', 'webgl', 'canvas'];
UG._defaultTextures = null;
UG._defaultGame = null;

/** Atajo: UG.create({...}) === new UG.Game({...}) */
UG.create = function (config) { return new Game(config); };
/** Crea (o devuelve) el grabador de GIF de un juego */
Game.prototype.getRecorder = function () { return this._recorder || (this._recorder = new Recorder(this)); };
Object.defineProperty(Game.prototype, 'recorder', { get: function () { return this.getRecorder(); } });

UG.RenderState = RenderState;
UG.Capabilities = Capabilities;
UG.info = function () {
  return {
    version: UG.VERSION,
    webgpu: Capabilities.webgpu(), webgl2: Capabilities.webgl2(), webgl: Capabilities.webgl(), canvas: Capabilities.canvas(),
    wasm: typeof WebAssembly !== 'undefined', wasmCore: UG.Wasm.ready,
    audio: !!(GLOBAL.AudioContext || GLOBAL.webkitAudioContext), touch: typeof window !== 'undefined' && ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0),
    gamepad: typeof navigator !== 'undefined' && !!navigator.getGamepads, devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1
  };
};
if (typeof Object.freeze === 'function') { Object.freeze(UG.BLEND); Object.freeze(UG.SCALE); }
