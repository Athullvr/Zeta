// GLSL shared by every scene program: noise that agrees on every GPU, and a few shape helpers.
// Kept free of uniforms so any program can include it without declaring anything.
(function (root) {
  "use strict";

  const NOISE = `
// ---------- noise (hash without sin, so every GPU agrees) ----------
float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash31(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x), mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x), mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
const mat2 ROT = mat2(.8, .6, -.6, .8);
float fbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = ROT * p * 2.02 + 17.3; a *= .5; } return s; }
float fbm3(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = ROT * p * 2.02 + 17.3; a *= .5; } return s; }
// jagged ridge profile, 0..1
float ridge(float x, float seed) {
  float h = 0., a = .5, f = 1.;
  for (int i = 0; i < 5; i++) { h += a * (1. - abs(2. * vnoise(vec2(x * f, seed)) - 1.)); a *= .5; f *= 2.1; }
  return h;
}
float craters(vec2 p) {
  vec2 i = floor(p), f = fract(p); float md = 8.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)); md = min(md, length(g + hash22(i + g) - f));
  }
  return md;
}
`;

  const GEOM = `
// ---------- shapes ----------
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.)) + min(max(d.x, d.y), 0.); }
// a pointed (two-centred) arch opening: base on y = 0, half width w, straight up to the springing height s
float archD(vec2 p, float w, float s) {
  vec2 q = vec2(abs(p.x), p.y);
  float top = q.y > s ? length(q - vec2(-w, s)) - 2. * w : -1.;
  return max(max(q.x - w, -q.y), top);
}
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0., 1.)); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
`;


  const SKY = `
// ---------- stars and moon (need uTime and the noise chunk) ----------
float starLayer(vec2 p, float scale, float thresh, float size) {
  vec2 g = p * scale, id = floor(g), f = fract(g) - .5;
  float h = hash21(id);
  float d = length(f - (hash22(id + 7.) - .5) * .6);
  float tw = .65 + .35 * sin(uTime * (1. + h * 3.) + h * 40.);
  return step(thresh, h) * smoothstep(size, 0., d) * tw * (.5 + .5 * hash21(id + 3.));
}
vec3 moonSurface(vec2 d, float R) {
  vec2 n = d / R;
  float z = sqrt(max(0., 1. - dot(n, n)));
  float maria = smoothstep(.40, .60, fbm(n * 1.7 + 7.)) * .85 + smoothstep(.45, .75, fbm(n * 3.4 + 2.)) * .25;
  float grain = fbm(n * 11.) - .5;
  float c = craters(n * 3.6);
  float pit = smoothstep(.12, .0, c) * .10;
  float albedo = (.92 - .46 * maria) * (1. + .34 * grain) - pit;
  float light = .68 + .32 * dot(vec3(n, z), normalize(vec3(-.4, .35, .85)));
  return vec3(.84, .89, 1.) * albedo * light * pow(z, .26) * 1.0;
}
`;

  const api = { NOISE, GEOM, SKY };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.ETERNAL = root.ETERNAL || {}).glslCommon = api;
})(typeof self !== "undefined" ? self : globalThis);
