/* UltraGame - UltraCore: núcleo WebAssembly SIMD opcional (ver tools/wasm/). Integra partículas directamente
 * sobre memoria lineal compartida con JS (vistas Float32Array sin copias = puente de "gran ancho de banda").
 * Si WASM/SIMD no está disponible, el motor usa automáticamente la ruta JavaScript equivalente. */

var Wasm = {
  ready: false, supported: false, simd: false, instance: null, memory: null, exports: null, error: null,
  /** Inicializa el núcleo (idempotente). Devuelve Promise<boolean>. */
  init: function () {
    if (Wasm._p) return Wasm._p;
    Wasm._p = new Promise(function (resolve) {
      try {
        if (typeof WebAssembly === 'undefined' || !Wasm.bytes) { Wasm.error = 'WebAssembly no disponible o núcleo no incluido'; resolve(false); return; }
        Wasm.supported = true;
        var bytes = base64ToBytes(Wasm.bytes);
        if (!WebAssembly.validate(bytes)) { Wasm.error = 'El navegador no soporta WASM SIMD'; resolve(false); return; }
        Wasm.simd = true;
        WebAssembly.instantiate(bytes, {}).then(function (res) {
          Wasm.instance = res.instance; Wasm.exports = res.instance.exports; Wasm.memory = Wasm.exports.memory;
          Wasm._heapTop = 1024; Wasm.ready = true; resolve(true);
        }, function (e) { Wasm.error = e.message; resolve(false); });
      } catch (e) { Wasm.error = e.message; resolve(false); }
    });
    return Wasm._p;
  },
  /** Reserva `bytes` alineados a 16 en la memoria lineal (asignador simple con lista libre). */
  alloc: function (bytes) {
    bytes = (bytes + 15) & ~15;
    var free = Wasm._free || (Wasm._free = []);
    for (var i = 0; i < free.length; i++) if (free[i].size >= bytes) { var b = free.splice(i, 1)[0]; return b.ptr; }
    var ptr = Wasm._heapTop, need = ptr + bytes, mem = Wasm.memory;
    if (need > mem.buffer.byteLength) mem.grow(Math.ceil((need - mem.buffer.byteLength) / 65536));
    Wasm._heapTop = need;
    (Wasm._sizes || (Wasm._sizes = new Map())).set(ptr, bytes);
    return ptr;
  },
  release: function (ptr) { var s = Wasm._sizes && Wasm._sizes.get(ptr); if (s) (Wasm._free || (Wasm._free = [])).push({ ptr: ptr, size: s }); },
  f32: function (ptr, count) { return new Float32Array(Wasm.memory.buffer, ptr, count); },
  /** Activa el núcleo WASM para un ParticleEmitter (sus arrays pasan a vivir en memoria WASM). */
  attachEmitter: function (em) {
    if (!Wasm.ready || !em || em._wasm) return false;
    var cap = (em.capacity + 3) & ~3, bytes = cap * 4;
    var names = ['px', 'py', 'vx', 'vy', 'life'], ptrs = {};
    names.forEach(function (n) { ptrs[n] = Wasm.alloc(bytes); });
    var first = true;
    var rebind = function () {
      var buf = Wasm.memory.buffer;
      names.forEach(function (n) {
        var view = new Float32Array(buf, ptrs[n], cap);
        // solo en el primer enlace se copian los datos desde los arrays JS; tras un grow los datos ya están en WASM
        if (first) view.set(em[n].subarray(0, Math.min(cap, em[n].length)));
        em[n] = view;
      });
      first = false;
      em._wasmBuf = buf;
    };
    rebind();
    em._wasm = { ptrs: ptrs, cap: cap, rebind: rebind, free: function () { names.forEach(function (n) { Wasm.release(ptrs[n]); }); } };
    em._wasmUpdate = function (dt) {
      if (em._wasmBuf !== Wasm.memory.buffer) rebind();
      var gx = (em.gravityX + em.accelX), gy = (em.gravityY + em.accelY);
      var damp = em.drag > 0 ? Math.max(0, 1 - em.drag * dt) : 1;
      Wasm.exports.integrate(ptrs.px, ptrs.py, ptrs.vx, ptrs.vy, ptrs.life, (em.count + 3) & ~3, dt, gx * dt, gy * dt, damp);
      // compactar partículas muertas (swap-remove) y rotación en JS
      var life = em.life, vr = em.vrot, rot = em.rot;
      for (var i = 0; i < em.count; i++) {
        if (life[i] <= 0) { em._kill(i); i--; continue; }
        if (vr[i] !== 0) rot[i] += vr[i] * dt;
      }
    };
    var origAlloc = em._alloc;
    em._alloc = function (n) {
      if (em._wasmBuf !== Wasm.memory.buffer) rebind();
      origAlloc.call(em, n);
      em._wasm.free(); em._wasm = null; em._wasmUpdate = null; em._alloc = origAlloc;
      Wasm.attachEmitter(em);
    };
    return true;
  }
};

UG.Wasm = Wasm;
