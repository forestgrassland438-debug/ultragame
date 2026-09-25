;; UltraCore — núcleo WebAssembly SIMD de UltraGame (texto equivalente al binario de build-core.js)
;; Memoria lineal compartida con JavaScript: los arrays de partículas son vistas Float32Array sobre
;; esta memoria (cero copias entre JS y WASM).
(module
  (memory (export "memory") 16)

  ;; integra 4 partículas por instrucción:
  ;;   vx = (vx + gx*dt) * damp ; vy = (vy + gy*dt) * damp ; px += vx*dt ; py += vy*dt ; life -= dt
  (func (export "integrate")
    (param $px i32) (param $py i32) (param $vx i32) (param $vy i32) (param $life i32) (param $count i32)
    (param $dt f32) (param $gxdt f32) (param $gydt f32) (param $damp f32)
    (local $off i32) (local $end i32)
    (local $dtv v128) (local $gxv v128) (local $gyv v128) (local $dampv v128) (local $nvx v128) (local $nvy v128)
    (local.set $dtv (f32x4.splat (local.get $dt)))
    (local.set $gxv (f32x4.splat (local.get $gxdt)))
    (local.set $gyv (f32x4.splat (local.get $gydt)))
    (local.set $dampv (f32x4.splat (local.get $damp)))
    (local.set $end (i32.shl (local.get $count) (i32.const 2)))
    (local.set $off (i32.const 0))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (local.get $off) (local.get $end)))
        (v128.store (i32.add (local.get $vx) (local.get $off))
          (local.tee $nvx (f32x4.mul (f32x4.add (v128.load (i32.add (local.get $vx) (local.get $off))) (local.get $gxv)) (local.get $dampv))))
        (v128.store (i32.add (local.get $vy) (local.get $off))
          (local.tee $nvy (f32x4.mul (f32x4.add (v128.load (i32.add (local.get $vy) (local.get $off))) (local.get $gyv)) (local.get $dampv))))
        (v128.store (i32.add (local.get $px) (local.get $off))
          (f32x4.add (v128.load (i32.add (local.get $px) (local.get $off))) (f32x4.mul (local.get $nvx) (local.get $dtv))))
        (v128.store (i32.add (local.get $py) (local.get $off))
          (f32x4.add (v128.load (i32.add (local.get $py) (local.get $off))) (f32x4.mul (local.get $nvy) (local.get $dtv))))
        (v128.store (i32.add (local.get $life) (local.get $off))
          (f32x4.sub (v128.load (i32.add (local.get $life) (local.get $off))) (local.get $dtv)))
        (local.set $off (i32.add (local.get $off) (i32.const 16)))
        (br $next))))

  ;; rebote contra un rectángulo con máscaras SIMD (sin ramas)
  (func (export "bounds")
    (param $px i32) (param $py i32) (param $vx i32) (param $vy i32) (param $count i32)
    (param $x0 f32) (param $y0 f32) (param $x1 f32) (param $y1 f32) (param $bounce f32)
    ;; ... (ver build-core.js: clamp con f32x4.min/max y v128.bitselect(-v*bounce, v, lt|gt))
  )
)
