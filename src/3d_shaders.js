/* UltraGame 3D - generador de shaders. La misma descripción produce GLSL ES 1.00 (WebGL1/WebGL2) y WGSL (WebGPU)
 * con idéntica disposición de uniformes (arrays de vec4) para que ambos backends den la misma imagen.
 * Modelo de luz: PBR metal-rugosidad (GGX + Smith + Schlick), bandas toon, sin luz; cielo/hemisferio como ambiente. */

/** Disposición del bloque de frame (índices vec4). maxDir/maxPoint/maxSpot dependen de la GPU. */
function frameLayout(maxDir, maxPoint, maxSpot) {
  var D0 = 16, P0 = D0 + maxDir * 2, S0 = P0 + maxPoint * 2, K0 = S0 + maxSpot * 3;
  return { maxDir: maxDir, maxPoint: maxPoint, maxSpot: maxSpot, D0: D0, P0: P0, S0: S0, K0: K0, NF: K0 + 5, NM: 6, NO: 8 };
}
/** Clave de variante: rasgos del material + del objeto + de la pasada */
function shaderFeatures(mat, mesh, pass) {
  var f = {
    map: !!mat.map, nrm: !!mat.normalMap, mr: !!mat.metalRoughMap, em: !!mat.emissiveMap, ao: !!mat.aoMap,
    vcol: !!mat.vertexColors && !!mesh._geometry.attributes.color, alphaTest: mat.alphaTest > 0, unlit: !!mat.unlit, toon: !!mat.toon,
    fog: mat.fog !== false, flat: !!mat.flatShading, double: mat.side === 'double' && mat.flipBackfaceNormals !== false, twoSided: mat.side === 'double',
    skin: !!mesh.skeleton && !!mesh._geometry.attributes.joints && !!mesh._geometry.attributes.weights, inst: !!mesh.instanced, instColor: !!(mesh.instanced && mesh.useInstanceColor),
    pass: pass || 'main', recv: pass === 'main' && mesh.receiveShadow !== false,
    trans: pass === 'main' && (!!mat.transparent || mat.opacity < 1 || mat.blend !== 'normal'),
    water: !!mat.water, wind: !mat.water && mat.wind > 0
  };
  f.key = (f.map ? 'M' : '') + (f.nrm ? 'N' : '') + (f.mr ? 'R' : '') + (f.em ? 'E' : '') + (f.ao ? 'O' : '') + (f.vcol ? 'C' : '') + (f.alphaTest ? 'A' : '') +
    (f.unlit ? 'U' : '') + (f.toon ? 'T' : '') + (f.fog ? 'F' : '') + (f.flat ? 'S' : '') + (f.double ? 'D' : (f.twoSided ? 'd' : '')) + (f.skin ? 'K' : '') + (f.inst ? 'I' : '') + (f.instColor ? 'i' : '') +
    (f.recv ? 'r' : '') + (f.trans ? 'B' : '') + (f.water ? 'Q' : '') + (f.wind ? 'W' : '') + ':' + f.pass;
  return f;
}

/* ================================================================== GLSL ES 1.00 */
function glslVertex(f, L) {
  var s = 'precision highp float;\n' +
    'attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUV;\n' +
    (f.vcol ? 'attribute vec4 aCol;\n' : '') +
    (f.skin ? 'attribute vec4 aJoints; attribute vec4 aWeights; uniform sampler2D tJoints;\n' : '') +
    (f.inst ? 'attribute vec4 aI0; attribute vec4 aI1; attribute vec4 aI2; attribute vec4 aI3; attribute vec4 aIC;\n' : '') +
    'uniform vec4 uF[' + L.NF + ']; uniform vec4 uM[6]; uniform vec4 uO[8];\n' +
    'varying vec3 vW; varying vec3 vN; varying vec2 vUV; varying vec4 vC;\n';
  if (f.skin) s += 'mat4 joint(float i){ float w = uO[7].x, h = uO[7].y, px = i * 4.0, y = floor(px / w), x = px - y * w; vec2 b = vec2((x + 0.5) / w, (y + 0.5) / h), d = vec2(1.0 / w, 0.0);\n' +
    ' return mat4(texture2D(tJoints, b), texture2D(tJoints, b + d), texture2D(tJoints, b + 2.0 * d), texture2D(tJoints, b + 3.0 * d)); }\n';
  s += 'void main(){\n mat4 M = mat4(uO[0], uO[1], uO[2], uO[3]); mat3 NM = mat3(uO[4].xyz, uO[5].xyz, uO[6].xyz);\n vec4 p = vec4(aPos, 1.0); vec3 n = aNrm;\n';
  if (f.skin) s += ' mat4 S = joint(aJoints.x) * aWeights.x + joint(aJoints.y) * aWeights.y + joint(aJoints.z) * aWeights.z + joint(aJoints.w) * aWeights.w;\n p = S * p; n = mat3(S[0].xyz, S[1].xyz, S[2].xyz) * n;\n';
  if (f.inst) s += ' mat4 I = mat4(aI0, aI1, aI2, aI3); p = I * p; n = mat3(aI0.xyz, aI1.xyz, aI2.xyz) * n;\n';
  // viento: balanceo que crece con la altura local del vértice (la base queda fija); fase según la posición en el mundo
  if (f.wind) s += ' { vec4 w0 = M * p; float hg = max(aPos.y, 0.0); float tw = uF[4].w; float ph = tw * 1.8 + w0.x * 0.37 + w0.z * 0.29; float gu = (0.6 + 0.4 * sin(tw * 0.35 + w0.x * 0.05)) * uM[5].w * hg * hg; p.x += sin(ph) * gu; p.z += sin(ph * 0.83 + 1.3) * 0.6 * gu; }\n';
  // agua: suma de 3 ondas (altura y normal analítica) evaluadas en coordenadas de mundo
  if (f.water) s += ' { vec4 w0 = M * p; vec2 q = w0.xz; float tw = uF[4].w; float A = uM[5].w; vec2 d1 = vec2(0.8, 0.6); vec2 d2 = vec2(-0.45, 0.89); vec2 d3 = vec2(0.95, -0.31);\n'+
    '  float x1 = dot(d1, q) * 0.35 + tw * 1.1; float x2 = dot(d2, q) * 0.62 + tw * 1.7; float x3 = dot(d3, q) * 1.13 + tw * 2.3;\n' +
    '  p.y += A * (sin(x1) + 0.5 * sin(x2) + 0.25 * sin(x3)); vec2 g = A * (d1 * 0.35 * cos(x1) + d2 * 0.31 * cos(x2) + d3 * 0.2825 * cos(x3)); n = vec3(-g.x, 1.0, -g.y); }\n';
  if (f.pass === 'outline') s += ' p.xyz += normalize(n) * uO[7].z;\n';
  s += ' vec4 w = M * p; vW = w.xyz; vN = NM * n;\n' +
    ' vec2 uv = aUV * uM[3].zw; float c = cos(uM[4].x), sn = sin(uM[4].x); vUV = uM[3].xy + vec2(c * uv.x - sn * uv.y, sn * uv.x + c * uv.y);\n' +
    ' vC = ' + (f.vcol ? 'aCol' : 'vec4(1.0)') + (f.instColor ? ' * aIC' : '') + ';\n' +
    ' gl_Position = mat4(uF[0], uF[1], uF[2], uF[3]) * w;\n}\n';
  return s;
}
function glslFragment(f, L, caps) {
  var deriv = (f.nrm || f.flat) && caps.derivatives;
  // también en WebGL2: los shaders GLSL ES 1.00 necesitan la directiva para usar dFdx/dFdy
  var s = (deriv ? '#extension GL_OES_standard_derivatives : enable\n' : '') +
    '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
    'uniform vec4 uF[' + L.NF + ']; uniform vec4 uM[6];\n' +
    'uniform sampler2D tMap; uniform sampler2D tNrm; uniform sampler2D tMR; uniform sampler2D tEm; uniform sampler2D tAO; uniform sampler2D tShadow;\n' +
    'varying vec3 vW; varying vec3 vN; varying vec2 vUV; varying vec4 vC;\n' +
    'const float PI = 3.14159265;\n';
  if (f.pass === 'shadow') {
    s += 'void main(){\n';
    if (f.alphaTest) s += ' float a = uM[0].a' + (f.map ? ' * texture2D(tMap, vUV).a' : '') + '; if (a < uM[1].w) discard;\n';
    return s + ' gl_FragColor = vec4(1.0);\n}\n';
  }
  if (f.pass === 'outline') return s + 'void main(){ gl_FragColor = vec4(uM[5].rgb, 1.0) * uM[0].a; }\n';
  s += 'vec3 toLin(vec3 c){ return c * (c * (c * 0.305306011 + 0.682171111) + 0.012522878); }\n' +
    'vec3 toSRGB(vec3 c){ c = max(c, vec3(0.0)); return max(1.055 * pow(c, vec3(0.416666667)) - 0.055, vec3(0.0)); }\n' +
    'vec3 tonemap(vec3 x){ x *= uF[6].w; if (uF[7].w > 1.5) return x / (1.0 + x); if (uF[7].w > 0.5) return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); return clamp(x, 0.0, 1.0); }\n' +
    'vec3 skyLin(vec3 d){ vec3 top = toLin(uF[' + L.K0 + '].rgb), hor = toLin(uF[' + (L.K0 + 1) + '].rgb), bot = toLin(uF[' + (L.K0 + 2) + '].rgb);\n' +
    ' return d.y > 0.0 ? mix(hor, top, sqrt(clamp(d.y, 0.0, 1.0))) : mix(hor, bot, sqrt(clamp(-d.y, 0.0, 1.0))); }\n' +
    'float D_GGX(float NoH, float a){ float a2 = a * a; float f = (NoH * a2 - NoH) * NoH + 1.0; return a2 / (PI * f * f + 1e-7); }\n' +
    'float V_Smith(float NoV, float NoL, float a){ float a2 = a * a; float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2); float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2); return 0.5 / max(gv + gl, 1e-5); }\n' +
    'vec3 F_Schlick(vec3 f0, float VoH){ float k = pow(1.0 - VoH, 5.0); return f0 + (1.0 - f0) * k; }\n';
  if (f.recv) s += 'float shadowF(vec3 wp, vec3 n){\n' +
    ' if (uF[9].w < 0.5) return 1.0;\n' +
    ' vec4 sc = mat4(uF[10], uF[11], uF[12], uF[13]) * vec4(wp + n * uF[14].y, 1.0); vec3 c = sc.xyz / sc.w; vec2 uv = c.xy * 0.5 + 0.5; float z = c.z * 0.5 + 0.5 - uF[14].x;\n' +
    ' if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || z > 1.0) return 1.0;\n' +
    ' float t = uF[14].z * uF[14].w, sum = 0.0;\n' +
    ' for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) sum += step(z, texture2D(tShadow, uv + vec2(float(x), float(y)) * t).r);\n' +
    ' return sum / 9.0; }\n';
  s += 'vec3 light(vec3 N, vec3 V, vec3 L, vec3 rad, vec3 base, float metal, float rough){\n' +
    ' float NoL = max(dot(N, L), 0.0); if (NoL <= 0.0) return vec3(0.0);\n';
  if (f.unlit) s += ' return vec3(0.0);\n';
  else if (f.toon) s += ' float st = max(uM[4].z, 1.0); float band = floor(NoL * st + 0.5) / st; vec3 H = normalize(L + V); float sp = step(0.96 - rough * 0.3, max(dot(N, H), 0.0)) * (1.0 - rough);\n return (base * band + vec3(sp) * 0.6) * rad;\n';
  else s += ' vec3 H = normalize(L + V); float NoV = max(dot(N, V), 1e-4), NoH = max(dot(N, H), 0.0), VoH = max(dot(V, H), 0.0); float a = max(rough * rough, 0.002);\n' +
    ' vec3 f0 = mix(vec3(0.04), base, metal); vec3 F = F_Schlick(f0, VoH);\n' +
    ' vec3 spec = D_GGX(NoH, a) * V_Smith(NoV, NoL, a) * F; vec3 kd = (1.0 - F) * (1.0 - metal);\n' +
    ' return (kd * base / PI + spec) * rad * NoL * PI;\n';
  s += '}\n';
  s += 'void main(){\n';
  // muestras de textura al principio (flujo uniforme)
  s += ' vec4 base = uM[0] * vC; float fy = uF[15].w;\n';
  if (f.map) s += ' vec4 tm = texture2D(tMap, vUV); if (tm.a > 0.0) tm.rgb /= tm.a; base *= vec4(toLin(tm.rgb), tm.a);\n';
  if (f.alphaTest) s += ' if (base.a < uM[1].w) discard;\n';
  s += ' vec3 N = normalize(vN);\n';
  if (f.flat && deriv) s += ' N = normalize(cross(dFdx(vW), dFdy(vW) * fy));\n';
  if (f.double) s += ' if (!gl_FrontFacing) N = -N;\n';
  // uF[15].w: signo de la derivada vertical de pantalla (-1 al renderizar a textura en WebGL y en WebGPU); v de glTF hacia abajo => verde invertido
  if (f.nrm && deriv) s += ' vec3 tn = texture2D(tNrm, vUV).xyz * 2.0 - 1.0; tn.xy *= vec2(uM[2].z, -uM[2].z);\n' +
    ' vec3 dp1 = dFdx(vW), dp2 = dFdy(vW) * fy; vec2 du1 = dFdx(vUV), du2 = dFdy(vUV) * fy;\n' +
    ' vec3 dp2p = cross(dp2, N), dp1p = cross(N, dp1); vec3 T = dp2p * du1.x + dp1p * du2.x, B = dp2p * du1.y + dp1p * du2.y;\n' +
    ' float im = inversesqrt(max(dot(T, T), dot(B, B)) + 1e-12); N = normalize(mat3(T * im, B * im, N) * tn);\n';
  s += ' float metal = uM[2].x, rough = uM[2].y;\n';
  if (f.mr) s += ' vec4 mr = texture2D(tMR, vUV); rough *= mr.g; metal *= mr.b;\n';
  s += ' rough = clamp(rough, 0.04, 1.0);\n vec3 V = normalize(uF[4].xyz - vW);\n';
  if (f.unlit) s += ' vec3 col = base.rgb;\n';
  else {
    s += ' vec3 col = vec3(0.0); float sh = ' + (f.recv ? 'shadowF(vW, N)' : '1.0') + ';\n' +
      ' int nD = int(uF[9].x + 0.5), nP = int(uF[9].y + 0.5), nS = int(uF[9].z + 0.5);\n' +
      ' for (int i = 0; i < ' + L.maxDir + '; i++) { if (i >= nD) break; vec4 a = uF[' + L.D0 + ' + i * 2], b = uF[' + (L.D0 + 1) + ' + i * 2]; float s0 = (i == 0) ? sh : 1.0; col += light(N, V, -a.xyz, b.rgb * s0, base.rgb, metal, rough); }\n' +
      ' for (int i = 0; i < ' + L.maxPoint + '; i++) { if (i >= nP) break; vec4 a = uF[' + L.P0 + ' + i * 2], b = uF[' + (L.P0 + 1) + ' + i * 2]; vec3 d = a.xyz - vW; float dist = length(d), r = dist / max(a.w, 1e-4), fall = clamp(1.0 - r * r * r * r, 0.0, 1.0); fall = fall * fall / (dist * dist + 1.0); col += light(N, V, d / max(dist, 1e-5), b.rgb * fall, base.rgb, metal, rough); }\n' +
      ' for (int i = 0; i < ' + L.maxSpot + '; i++) { if (i >= nS) break; vec4 a = uF[' + L.S0 + ' + i * 3], b = uF[' + (L.S0 + 1) + ' + i * 3], c = uF[' + (L.S0 + 2) + ' + i * 3]; vec3 d = a.xyz - vW; float dist = length(d); vec3 Ld = d / max(dist, 1e-5); float r = dist / max(a.w, 1e-4), fall = clamp(1.0 - r * r * r * r, 0.0, 1.0); fall = fall * fall / (dist * dist + 1.0);\n' +
      '  float cone = smoothstep(b.w, c.w, dot(-Ld, b.xyz)); col += light(N, V, Ld, c.rgb * fall * cone, base.rgb, metal, rough); }\n' +
      // ambiente: hemisferio + reflejo aproximado del cielo
      ' float hemi = N.y * 0.5 + 0.5; vec3 amb = mix(uF[8].rgb, uF[7].rgb, hemi) + uF[15].rgb;\n' +
      ' float ao = 1.0;' + (f.ao ? ' ao = mix(1.0, texture2D(tAO, vUV).r, uM[2].w);' : '') + '\n';
    if (f.toon) s += ' col += base.rgb * amb * ao; float rim = pow(1.0 - max(dot(N, V), 0.0), uM[4].w); col += uM[5].rgb * rim * sh;\n';
    else s += ' vec3 f0 = mix(vec3(0.04), base.rgb, metal); float NoV = max(dot(N, V), 1e-4);\n' +
      ' vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022), c1 = vec4(1.0, 0.0425, 1.04, -0.04); vec4 rr = rough * c0 + c1; float a004 = min(rr.x * rr.x, exp2(-9.28 * NoV)) * rr.x + rr.y; vec2 AB = vec2(-1.04, 1.04) * a004 + rr.zw;\n' +
      ' vec3 R = reflect(-V, N); vec3 env = mix(skyLin(R), mix(uF[8].rgb, uF[7].rgb, 0.5) / max(PI * 0.35, 1e-3), rough * rough) * uF[8].w * uM[4].y;\n' +
      ' col += base.rgb * (1.0 - metal) * amb * ao + env * (f0 * AB.x + AB.y) * ao;\n';
  }
  s += ' col += uM[1].rgb' + (f.em ? ' * toLin(texture2D(tEm, vUV).rgb)' : '') + ';\n';
  s += ' vec3 outc = toSRGB(tonemap(col));\n';
  if (f.fog) s += ' if (uF[5].w > 0.5) { float dist = length(vW - uF[4].xyz); float ff = uF[5].w < 1.5 ? clamp((uF[6].y - dist) / max(uF[6].y - uF[6].x, 1e-4), 0.0, 1.0) : exp(-uF[6].z * uF[6].z * dist * dist); outc = mix(uF[5].rgb, outc, ff); }\n';
  s += f.trans ? ' gl_FragColor = vec4(outc * base.a, base.a);\n}\n' : ' gl_FragColor = vec4(outc, 1.0);\n}\n';
  return s;
}
/**
 * Cielo: triángulo a pantalla completa con degradado, sol, luna, estrellas y nubes procedurales (fbm de ruido de valor,
 * sin texturas). En sRGB, igual que la niebla. uSky: 0 arriba, 1 horizonte, 2 suelo, 3 dir. sol + tamaño, 4 color sol +
 * intensidad, 5 cámara + tiempo, 6 nubes (cobertura, nitidez, escala, velocidad), 7 color nubes + opacidad,
 * 8 viento (x, z) + estrellas + luna, 9 octavas + sombreado de nubes.
 */
var SKY_GLSL_BODY =
  'float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }\n' +
  'float vn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); float a = h21(i); float b = h21(i + vec2(1.0, 0.0)); float c = h21(i + vec2(0.0, 1.0)); float d = h21(i + vec2(1.0, 1.0)); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }\n' +
  'float fbm(vec2 p, float oct){ float s = 0.0; float a = 0.5; float n = 0.0; for (int i = 0; i < 6; i++) { if (float(i) >= oct) break; s += a * vn(p); n += a; p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return s / max(n, 1e-4); }\n' +
  'void main(){ vec3 d = normalize(vDir - uSky[5].xyz); vec3 c = d.y > 0.0 ? mix(uSky[1].rgb, uSky[0].rgb, sqrt(clamp(d.y, 0.0, 1.0))) : mix(uSky[1].rgb, uSky[2].rgb, sqrt(clamp(-d.y, 0.0, 1.0)));\n' +
  ' vec3 L = normalize(-uSky[3].xyz); float s = max(dot(d, L), 0.0); float t = uSky[5].w; float dayL = clamp(uSky[4].w, 0.0, 1.0) * smoothstep(-0.12, 0.18, L.y);\n' +
  ' if (uSky[8].z > 0.0 && d.y > 0.0 && dayL < 0.9) { vec2 sp = d.xz / (1.0 + d.y) * 240.0; vec2 cell = floor(sp); float h = h21(cell);\n' +
  '  if (h > 0.982) { vec2 o = vec2(h21(cell + 7.13), h21(cell + 3.71)) - 0.5; float dd = length(fract(sp) - 0.5 - o * 0.6); float tw = 0.65 + 0.35 * sin(t * (1.5 + h * 5.0) + h * 91.0);\n' +
  '   c += vec3(0.9, 0.93, 1.0) * (1.0 - smoothstep(0.0, 0.16, dd)) * tw * uSky[8].z * (1.0 - dayL) * smoothstep(0.0, 0.3, d.y) * (0.4 + (h - 0.982) / 0.018 * 0.6); } }\n' +
  ' if (uSky[8].w > 0.0) { float m = max(dot(d, -L), 0.0); c += vec3(0.86, 0.9, 1.0) * (smoothstep(0.99955, 0.99975, m) + pow(m, 300.0) * 0.18) * uSky[8].w; }\n' +
  ' float disk = uSky[3].w > 0.0 ? smoothstep(1.0 - uSky[3].w, 1.0 - uSky[3].w * 0.6, s) : 0.0; c += uSky[4].rgb * (disk + pow(s, 64.0) * 0.35) * uSky[4].w;\n' +
  ' if (uSky[6].x > 0.0 && uSky[7].w > 0.0 && d.y > 0.0) {\n' +
  '  vec2 uv = d.xz / (d.y + 0.14) * uSky[6].z + uSky[8].xy * (uSky[6].w * t); float oct = uSky[9].x; float n = fbm(uv, oct);\n' +
  '  float a = smoothstep(1.0 - uSky[6].x, 1.0 - uSky[6].x + uSky[6].y, n);\n' +
  '  if (a > 0.001) { float n2 = fbm(uv + L.xz * 0.3, oct); float lit = clamp(1.0 - max(n2 - n, 0.0) * 4.0 * uSky[9].y, 0.0, 1.0);\n' +
  '   float day = clamp(uSky[4].w, 0.0, 1.0) * smoothstep(-0.12, 0.18, L.y); vec3 amb = mix(uSky[1].rgb, uSky[0].rgb, 0.5);\n' +
  '   vec3 cc = mix(amb * 0.55, uSky[7].rgb * mix(vec3(1.0), uSky[4].rgb, 0.35), day) * mix(0.55, 1.0, lit) + uSky[4].rgb * pow(s, 10.0) * (1.0 - a) * 0.5 * day;\n' +
  '   cc = mix(uSky[1].rgb, cc, smoothstep(0.0, 0.35, d.y)); c = mix(c, cc, a * smoothstep(0.0, 0.1, d.y) * uSky[7].w); } }\n' +
  ' gl_FragColor = vec4(c, 1.0); }\n';
function glslSky() {
  return {
    vs: 'precision highp float;\nattribute vec2 aPos; uniform mat4 uInvVP; varying vec3 vDir;\nvoid main(){ vec4 w = uInvVP * vec4(aPos, 1.0, 1.0); vDir = w.xyz / w.w; gl_Position = vec4(aPos, 0.9999, 1.0); }\n',
    fs: '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
      'uniform vec4 uSky[10]; varying vec3 vDir;\n' + SKY_GLSL_BODY
  };
}
/** Rellena out[o..o+15] (uSky[6..9]) con nubes, viento, estrellas y luna de scene.sky */
function packSkyExtras(sky, out, o) {
  for (var i = 0; i < 16; i++) out[o + i] = 0;
  if (!sky) return out;
  var c = sky.clouds;
  if (c) {
    var col = Color.toNumber(c.color === undefined ? 0xffffff : c.color);
    out[o] = +c.coverage || 0; out[o + 1] = Math.max(0.02, +c.sharpness || 0.3); out[o + 2] = +c.scale || 0.55; out[o + 3] = +c.speed || 0;
    out[o + 4] = ((col >> 16) & 255) / 255; out[o + 5] = ((col >> 8) & 255) / 255; out[o + 6] = (col & 255) / 255; out[o + 7] = c.opacity === undefined ? 0.95 : +c.opacity;
    out[o + 8] = c.wind ? +c.wind[0] || 0 : 1; out[o + 9] = c.wind ? +c.wind[1] || 0 : 0;
    out[o + 12] = c.octaves || 5; out[o + 13] = c.shadow === undefined ? 0.6 : +c.shadow;
  }
  out[o + 10] = Math.max(0, Math.min(1, +sky.stars || 0)); out[o + 11] = Math.max(0, Math.min(1, +sky.moon || 0));
  return out;
}

/* ======================================================================== WGSL */
function wgslShader(f, L) {
  var s = 'struct Frame { v: array<vec4f, ' + L.NF + '> };\n@group(0) @binding(0) var<uniform> F: Frame;\n' +
    '@group(0) @binding(1) var tShadow: texture_depth_2d;\n@group(0) @binding(2) var sShadow: sampler_comparison;\n' +
    'struct Mat { v: array<vec4f, 6> };\n@group(1) @binding(0) var<uniform> M: Mat;\n' +
    '@group(1) @binding(1) var tMap: texture_2d<f32>; @group(1) @binding(2) var sMap: sampler;\n' +
    '@group(1) @binding(3) var tNrm: texture_2d<f32>; @group(1) @binding(4) var sNrm: sampler;\n' +
    '@group(1) @binding(5) var tMR: texture_2d<f32>; @group(1) @binding(6) var sMR: sampler;\n' +
    '@group(1) @binding(7) var tEm: texture_2d<f32>; @group(1) @binding(8) var sEm: sampler;\n' +
    '@group(1) @binding(9) var tAO: texture_2d<f32>; @group(1) @binding(10) var sAO: sampler;\n' +
    'struct Obj { v: array<vec4f, 8> };\n@group(2) @binding(0) var<uniform> O: Obj;\n' +
    (f.skin ? '@group(2) @binding(1) var<storage, read> J: array<mat4x4f>;\n' : '') +
    'const PI: f32 = 3.14159265;\n' +
    'struct VIn { @location(0) pos: vec3f, @location(1) nrm: vec3f, @location(2) uv: vec2f' +
    (f.vcol ? ', @location(3) col: vec4f' : '') + (f.skin ? ', @location(4) jnt: vec4f, @location(5) wgt: vec4f' : '') +
    (f.inst ? ', @location(6) i0: vec4f, @location(7) i1: vec4f, @location(8) i2: vec4f, @location(9) i3: vec4f, @location(10) ic: vec4f' : '') + ' };\n' +
    'struct VOut { @builtin(position) pos: vec4f, @location(0) w: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f, @location(3) c: vec4f };\n' +
    '@vertex fn vs(i: VIn) -> VOut {\n var o: VOut;\n let Mo = mat4x4f(O.v[0], O.v[1], O.v[2], O.v[3]); let NM = mat3x3f(O.v[4].xyz, O.v[5].xyz, O.v[6].xyz);\n var p = vec4f(i.pos, 1.0); var n = i.nrm;\n';
  if (f.skin) s += ' let S = J[u32(i.jnt.x)] * i.wgt.x + J[u32(i.jnt.y)] * i.wgt.y + J[u32(i.jnt.z)] * i.wgt.z + J[u32(i.jnt.w)] * i.wgt.w;\n p = S * p; n = mat3x3f(S[0].xyz, S[1].xyz, S[2].xyz) * n;\n';
  if (f.inst) s += ' let I = mat4x4f(i.i0, i.i1, i.i2, i.i3); p = I * p; n = mat3x3f(i.i0.xyz, i.i1.xyz, i.i2.xyz) * n;\n';
  if (f.wind) s += ' { let w0 = Mo * p; let hg = max(i.pos.y, 0.0); let tw = F.v[4].w; let ph = tw * 1.8 + w0.x * 0.37 + w0.z * 0.29; let gu = (0.6 + 0.4 * sin(tw * 0.35 + w0.x * 0.05)) * M.v[5].w * hg * hg; p = vec4f(p.x + sin(ph) * gu, p.y, p.z + sin(ph * 0.83 + 1.3) * 0.6 * gu, p.w); }\n';
  if (f.water) s += ' { let w0 = Mo * p; let q = w0.xz; let tw = F.v[4].w; let A = M.v[5].w; let d1 = vec2f(0.8, 0.6); let d2 = vec2f(-0.45, 0.89); let d3 = vec2f(0.95, -0.31);\n' +
    '  let x1 = dot(d1, q) * 0.35 + tw * 1.1; let x2 = dot(d2, q) * 0.62 + tw * 1.7; let x3 = dot(d3, q) * 1.13 + tw * 2.3;\n' +
    '  p = vec4f(p.x, p.y + A * (sin(x1) + 0.5 * sin(x2) + 0.25 * sin(x3)), p.z, p.w); let g = A * (d1 * 0.35 * cos(x1) + d2 * 0.31 * cos(x2) + d3 * 0.2825 * cos(x3)); n = vec3f(-g.x, 1.0, -g.y); }\n';
  if (f.pass === 'outline') s += ' p = vec4f(p.xyz + normalize(n) * O.v[7].z, 1.0);\n';
  s += ' let w = Mo * p; o.w = w.xyz; o.n = NM * n;\n' +
    ' let uv = i.uv * M.v[3].zw; let c = cos(M.v[4].x); let sn = sin(M.v[4].x); o.uv = M.v[3].xy + vec2f(c * uv.x - sn * uv.y, sn * uv.x + c * uv.y);\n' +
    ' o.c = ' + (f.vcol ? 'i.col' : 'vec4f(1.0)') + (f.instColor ? ' * i.ic' : '') + ';\n' +
    ' var cp = mat4x4f(F.v[0], F.v[1], F.v[2], F.v[3]) * w; cp.z = (cp.z + cp.w) * 0.5; o.pos = cp;\n return o;\n}\n';
  if (f.pass === 'shadow') {
    // pasada de profundidad: sin salida de color (el mapa de sombras solo tiene profundidad)
    s += '@fragment fn fs(v: VOut) {\n';
    if (f.alphaTest) s += ' let a = M.v[0].a' + (f.map ? ' * textureSample(tMap, sMap, v.uv).a' : '') + '; if (a < M.v[1].w) { discard; }\n';
    return s + '}\n';
  }
  if (f.pass === 'outline') return s + '@fragment fn fs(v: VOut) -> @location(0) vec4f { return vec4f(M.v[5].rgb, 1.0) * M.v[0].a; }\n';
  s += 'fn toLin(c: vec3f) -> vec3f { return c * (c * (c * 0.305306011 + 0.682171111) + 0.012522878); }\n' +
    'fn toSRGB(ci: vec3f) -> vec3f { let c = max(ci, vec3f(0.0)); return max(1.055 * pow(c, vec3f(0.416666667)) - 0.055, vec3f(0.0)); }\n' +
    'fn tonemap(xi: vec3f) -> vec3f { let x = xi * F.v[6].w; if (F.v[7].w > 1.5) { return x / (1.0 + x); } if (F.v[7].w > 0.5) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); } return clamp(x, vec3f(0.0), vec3f(1.0)); }\n' +
    'fn skyLin(d: vec3f) -> vec3f { let top = toLin(F.v[' + L.K0 + '].rgb); let hor = toLin(F.v[' + (L.K0 + 1) + '].rgb); let bot = toLin(F.v[' + (L.K0 + 2) + '].rgb);\n' +
    ' if (d.y > 0.0) { return mix(hor, top, sqrt(clamp(d.y, 0.0, 1.0))); } return mix(hor, bot, sqrt(clamp(-d.y, 0.0, 1.0))); }\n' +
    'fn D_GGX(NoH: f32, a: f32) -> f32 { let a2 = a * a; let f = (NoH * a2 - NoH) * NoH + 1.0; return a2 / (PI * f * f + 1e-7); }\n' +
    'fn V_Smith(NoV: f32, NoL: f32, a: f32) -> f32 { let a2 = a * a; let gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2); let gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2); return 0.5 / max(gv + gl, 1e-5); }\n' +
    'fn F_Schlick(f0: vec3f, VoH: f32) -> vec3f { let k = pow(1.0 - VoH, 5.0); return f0 + (1.0 - f0) * k; }\n';
  if (f.recv) s += 'fn shadowF(wp: vec3f, n: vec3f) -> f32 {\n' +
    ' if (F.v[9].w < 0.5) { return 1.0; }\n' +
    ' let sc = mat4x4f(F.v[10], F.v[11], F.v[12], F.v[13]) * vec4f(wp + n * F.v[14].y, 1.0); let c = sc.xyz / sc.w; let uv = vec2f(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5); let z = c.z * 0.5 + 0.5 - F.v[14].x;\n' +
    ' if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || z > 1.0) { return 1.0; }\n' +
    ' let t = F.v[14].z * F.v[14].w; var sum = 0.0;\n' +
    ' for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) { sum += textureSampleCompareLevel(tShadow, sShadow, uv + vec2f(f32(x), f32(y)) * t, z); } }\n' +
    ' return sum / 9.0; }\n';
  s += 'fn light(N: vec3f, V: vec3f, L: vec3f, rad: vec3f, base: vec3f, metal: f32, rough: f32) -> vec3f {\n let NoL = max(dot(N, L), 0.0); if (NoL <= 0.0) { return vec3f(0.0); }\n';
  if (f.unlit) s += ' return vec3f(0.0);\n';
  else if (f.toon) s += ' let st = max(M.v[4].z, 1.0); let band = floor(NoL * st + 0.5) / st; let H = normalize(L + V); let sp = step(0.96 - rough * 0.3, max(dot(N, H), 0.0)) * (1.0 - rough);\n return (base * band + vec3f(sp) * 0.6) * rad;\n';
  else s += ' let H = normalize(L + V); let NoV = max(dot(N, V), 1e-4); let NoH = max(dot(N, H), 0.0); let VoH = max(dot(V, H), 0.0); let a = max(rough * rough, 0.002);\n' +
    ' let f0 = mix(vec3f(0.04), base, metal); let Fr = F_Schlick(f0, VoH);\n' +
    ' let spec = D_GGX(NoH, a) * V_Smith(NoV, NoL, a) * Fr; let kd = (1.0 - Fr) * (1.0 - metal);\n' +
    ' return (kd * base / PI + spec) * rad * NoL * PI;\n';
  s += '}\n@fragment fn fs(v: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {\n';
  // todas las muestras y derivadas antes de cualquier rama o discard (uniformidad de WGSL)
  s += ' var base = M.v[0] * v.c;\n';
  if (f.map) s += ' var tm = textureSample(tMap, sMap, v.uv); if (tm.a > 0.0) { tm = vec4f(tm.rgb / tm.a, tm.a); } base = base * vec4f(toLin(tm.rgb), tm.a);\n';
  if (f.nrm) s += ' let tnS = textureSample(tNrm, sNrm, v.uv).xyz; let dp1 = dpdx(v.w); let dp2 = dpdy(v.w) * F.v[15].w; let du1 = dpdx(v.uv); let du2 = dpdy(v.uv) * F.v[15].w;\n';
  if (f.flat && !f.nrm) s += ' let dp1 = dpdx(v.w); let dp2 = dpdy(v.w) * F.v[15].w;\n';
  if (f.mr) s += ' let mrS = textureSample(tMR, sMR, v.uv);\n';
  if (f.ao) s += ' let aoS = textureSample(tAO, sAO, v.uv).r;\n';
  if (f.em) s += ' let emS = textureSample(tEm, sEm, v.uv).rgb;\n';
  if (f.alphaTest) s += ' if (base.a < M.v[1].w) { discard; }\n';
  s += ' var N = normalize(v.n);\n';
  if (f.flat) s += ' N = normalize(cross(dp1, dp2));\n';
  if (f.double) s += ' if (!ff) { N = -N; }\n';
  if (f.nrm) s += ' var tn = tnS * 2.0 - 1.0; tn = vec3f(tn.x * M.v[2].z, -tn.y * M.v[2].z, tn.z);\n' +
    ' let dp2p = cross(dp2, N); let dp1p = cross(N, dp1); let T = dp2p * du1.x + dp1p * du2.x; let B = dp2p * du1.y + dp1p * du2.y;\n' +
    ' let im = inverseSqrt(max(dot(T, T), dot(B, B)) + 1e-12); N = normalize(mat3x3f(T * im, B * im, N) * tn);\n';
  s += ' var metal = M.v[2].x; var rough = M.v[2].y;\n';
  if (f.mr) s += ' rough = rough * mrS.g; metal = metal * mrS.b;\n';
  s += ' rough = clamp(rough, 0.04, 1.0);\n let V = normalize(F.v[4].xyz - v.w);\n';
  if (f.unlit) s += ' var col = base.rgb;\n';
  else {
    s += ' var col = vec3f(0.0); let sh = ' + (f.recv ? 'shadowF(v.w, N)' : '1.0') + ';\n' +
      ' let nD = i32(F.v[9].x + 0.5); let nP = i32(F.v[9].y + 0.5); let nS = i32(F.v[9].z + 0.5);\n' +
      ' for (var i = 0; i < ' + L.maxDir + '; i++) { if (i >= nD) { break; } let a = F.v[' + L.D0 + ' + i * 2]; let b = F.v[' + (L.D0 + 1) + ' + i * 2]; var s0 = 1.0; if (i == 0) { s0 = sh; } col += light(N, V, -a.xyz, b.rgb * s0, base.rgb, metal, rough); }\n' +
      ' for (var i = 0; i < ' + L.maxPoint + '; i++) { if (i >= nP) { break; } let a = F.v[' + L.P0 + ' + i * 2]; let b = F.v[' + (L.P0 + 1) + ' + i * 2]; let d = a.xyz - v.w; let dist = length(d); let r = dist / max(a.w, 1e-4); var fall = clamp(1.0 - r * r * r * r, 0.0, 1.0); fall = fall * fall / (dist * dist + 1.0); col += light(N, V, d / max(dist, 1e-5), b.rgb * fall, base.rgb, metal, rough); }\n' +
      ' for (var i = 0; i < ' + L.maxSpot + '; i++) { if (i >= nS) { break; } let a = F.v[' + L.S0 + ' + i * 3]; let b = F.v[' + (L.S0 + 1) + ' + i * 3]; let c = F.v[' + (L.S0 + 2) + ' + i * 3]; let d = a.xyz - v.w; let dist = length(d); let Ld = d / max(dist, 1e-5); let r = dist / max(a.w, 1e-4); var fall = clamp(1.0 - r * r * r * r, 0.0, 1.0); fall = fall * fall / (dist * dist + 1.0);\n' +
      '  let cone = smoothstep(b.w, c.w, dot(-Ld, b.xyz)); col += light(N, V, Ld, c.rgb * fall * cone, base.rgb, metal, rough); }\n' +
      ' let hemi = N.y * 0.5 + 0.5; let amb = mix(F.v[8].rgb, F.v[7].rgb, hemi) + F.v[15].rgb;\n' +
      ' var ao = 1.0;' + (f.ao ? ' ao = mix(1.0, aoS, M.v[2].w);' : '') + '\n';
    if (f.toon) s += ' col += base.rgb * amb * ao; let rim = pow(1.0 - max(dot(N, V), 0.0), M.v[4].w); col += M.v[5].rgb * rim * sh;\n';
    else s += ' let f0 = mix(vec3f(0.04), base.rgb, metal); let NoV = max(dot(N, V), 1e-4);\n' +
      ' let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022); let c1 = vec4f(1.0, 0.0425, 1.04, -0.04); let rr = rough * c0 + c1; let a004 = min(rr.x * rr.x, exp2(-9.28 * NoV)) * rr.x + rr.y; let AB = vec2f(-1.04, 1.04) * a004 + rr.zw;\n' +
      ' let R = reflect(-V, N); let env = mix(skyLin(R), mix(F.v[8].rgb, F.v[7].rgb, 0.5) / max(PI * 0.35, 1e-3), rough * rough) * F.v[8].w * M.v[4].y;\n' +
      ' col += base.rgb * (1.0 - metal) * amb * ao + env * (f0 * AB.x + AB.y) * ao;\n';
  }
  s += ' col += M.v[1].rgb' + (f.em ? ' * toLin(emS)' : '') + ';\n';
  s += ' var outc = toSRGB(tonemap(col));\n';
  if (f.fog) s += ' if (F.v[5].w > 0.5) { let dist = length(v.w - F.v[4].xyz); var fg = exp(-F.v[6].z * F.v[6].z * dist * dist); if (F.v[5].w < 1.5) { fg = clamp((F.v[6].y - dist) / max(F.v[6].y - F.v[6].x, 1e-4), 0.0, 1.0); } outc = mix(F.v[5].rgb, outc, fg); }\n';
  s += f.trans ? ' return vec4f(outc * base.a, base.a);\n}\n' : ' return vec4f(outc, 1.0);\n}\n';
  return s;
}
function wgslSky() {
  return 'struct Sky { invVP: mat4x4f, p: array<vec4f, 10> };\n@group(0) @binding(0) var<uniform> U: Sky;\n' +
    'struct VO { @builtin(position) pos: vec4f, @location(0) d: vec3f };\n' +
    '@vertex fn vs(@builtin(vertex_index) i: u32) -> VO { var P = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0)); var o: VO; let q = P[i]; let w = U.invVP * vec4f(q, 1.0, 1.0); o.d = w.xyz / w.w; o.pos = vec4f(q, 0.9999, 1.0); return o; }\n' +
    'fn h21(pi: vec2f) -> f32 { var p = fract(pi * vec2f(123.34, 456.21)); p = p + dot(p, p + 45.32); return fract(p.x * p.y); }\n' +
    'fn vn(p: vec2f) -> f32 { let i = floor(p); var f = fract(p); f = f * f * (3.0 - 2.0 * f); let a = h21(i); let b = h21(i + vec2f(1.0, 0.0)); let c = h21(i + vec2f(0.0, 1.0)); let d = h21(i + vec2f(1.0, 1.0)); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }\n' +
    'fn fbm(pi: vec2f, oct: f32) -> f32 { var p = pi; var s = 0.0; var a = 0.5; var n = 0.0; for (var i = 0; i < 6; i++) { if (f32(i) >= oct) { break; } s += a * vn(p); n += a; p = p * 2.03 + vec2f(17.1, 9.2); a *= 0.5; } return s / max(n, 1e-4); }\n' +
    '@fragment fn fs(v: VO) -> @location(0) vec4f { let d = normalize(v.d - U.p[5].xyz); var c = mix(U.p[1].rgb, U.p[2].rgb, sqrt(clamp(-d.y, 0.0, 1.0))); if (d.y > 0.0) { c = mix(U.p[1].rgb, U.p[0].rgb, sqrt(clamp(d.y, 0.0, 1.0))); }\n' +
    ' let L = normalize(-U.p[3].xyz); let s = max(dot(d, L), 0.0); let t = U.p[5].w; let dayL = clamp(U.p[4].w, 0.0, 1.0) * smoothstep(-0.12, 0.18, L.y);\n' +
    ' if (U.p[8].z > 0.0 && d.y > 0.0 && dayL < 0.9) { let sp = d.xz / (1.0 + d.y) * 240.0; let cell = floor(sp); let h = h21(cell);\n' +
    '  if (h > 0.982) { let o = vec2f(h21(cell + 7.13), h21(cell + 3.71)) - 0.5; let dd = length(fract(sp) - 0.5 - o * 0.6); let tw = 0.65 + 0.35 * sin(t * (1.5 + h * 5.0) + h * 91.0);\n' +
    '   c += vec3f(0.9, 0.93, 1.0) * (1.0 - smoothstep(0.0, 0.16, dd)) * tw * U.p[8].z * (1.0 - dayL) * smoothstep(0.0, 0.3, d.y) * (0.4 + (h - 0.982) / 0.018 * 0.6); } }\n' +
    ' if (U.p[8].w > 0.0) { let m = max(dot(d, -L), 0.0); c += vec3f(0.86, 0.9, 1.0) * (smoothstep(0.99955, 0.99975, m) + pow(m, 300.0) * 0.18) * U.p[8].w; }\n' +
    ' var disk = 0.0; if (U.p[3].w > 0.0) { disk = smoothstep(1.0 - U.p[3].w, 1.0 - U.p[3].w * 0.6, s); } c += U.p[4].rgb * (disk + pow(s, 64.0) * 0.35) * U.p[4].w;\n' +
    ' if (U.p[6].x > 0.0 && U.p[7].w > 0.0 && d.y > 0.0) {\n' +
    '  let uv = d.xz / (d.y + 0.14) * U.p[6].z + U.p[8].xy * (U.p[6].w * t); let oct = U.p[9].x; let n = fbm(uv, oct);\n' +
    '  let a = smoothstep(1.0 - U.p[6].x, 1.0 - U.p[6].x + U.p[6].y, n);\n' +
    '  if (a > 0.001) { let n2 = fbm(uv + L.xz * 0.3, oct); let lit = clamp(1.0 - max(n2 - n, 0.0) * 4.0 * U.p[9].y, 0.0, 1.0);\n' +
    '   let day = clamp(U.p[4].w, 0.0, 1.0) * smoothstep(-0.12, 0.18, L.y); let amb = mix(U.p[1].rgb, U.p[0].rgb, 0.5);\n' +
    '   var cc = mix(amb * 0.55, U.p[7].rgb * mix(vec3f(1.0), U.p[4].rgb, 0.35), day) * mix(0.55, 1.0, lit) + U.p[4].rgb * pow(s, 10.0) * (1.0 - a) * 0.5 * day;\n' +
    '   cc = mix(U.p[1].rgb, cc, smoothstep(0.0, 0.35, d.y)); c = mix(c, cc, a * smoothstep(0.0, 0.1, d.y) * U.p[7].w); } }\n' +
    ' return vec4f(c, 1.0); }\n';
}

UG.Shader3D = { frameLayout: frameLayout, features: shaderFeatures, glslVertex: glslVertex, glslFragment: glslFragment, wgsl: wgslShader, glslSky: glslSky, wgslSky: wgslSky, packSkyExtras: packSkyExtras };
