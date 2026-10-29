// Act III: the lost beloved. A moonlit terrace behind a ruined arcade, seen by a camera that drifts along it. Built like the
// exterior from layers at different depths (so the arcade, the garden and the mountains slide past one another), with a
// balustrade in front, thorn vines in the wind, drifting petals, and, now and then, the faint outline of someone standing
// in the garden who is not there.
(function (root) {
  "use strict";
  const C = typeof module === "object" && module.exports ? require("./shaders-common.js") : root.ETERNAL.glslCommon;

  const UNIFORMS = { uLight: "float", uMoon: "float", uCloud: "float", uStars: "float", uMist: "float", uFigure: "float", uPetals: "float", uDrift: "float", uGust: "float", uCrimson: "float" };

  const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec4 uCam;
uniform float uLight, uMoon, uCloud, uStars, uMist, uFigure, uPetals, uDrift, uGust, uCrimson;
out vec4 fragColor;

${C.NOISE}
${C.GEOM}
${C.SKY}

const vec2 MOON_C = vec2(.30, .17);
const float MOON_R = .20;
const vec3 SILVER = vec3(.74, .80, .92);
const vec3 PETAL = vec3(.20, .035, .06);
const float S_ARCH = .62;                 // spacing of the arcade's piers
vec2 gQ;

vec2 layerP(float depth) {
  float z = mix(1., uCam.z, depth);
  float c = cos(uCam.w), s = sin(uCam.w);
  vec2 q = vec2(c * gQ.x - s * gQ.y, s * gQ.x + c * gQ.y);
  return q / z + uCam.xy * depth;
}
float pixelAt(float depth) { return 1. / uRes.y / mix(1., uCam.z, depth); }

vec3 skyColor(vec2 p) {
  float h = smoothstep(.55, -.35, p.y);
  vec3 c = mix(vec3(.004, .007, .020), vec3(.030, .050, .095), h * h);
  return c + vec3(.040, .006, .010) * uCrimson * smoothstep(-.05, -.30, p.y);
}
float wisp(vec2 p, float speed) {
  vec2 w = vec2(uDrift * .020 * speed, uDrift * .004 * speed);
  p = p * vec2(1.3, 2.8) + w;
  vec2 q = vec2(fbm3(p + vec2(1.7, 9.2)), fbm3(p + vec2(8.3, 2.8)));
  return fbm(p + 1.6 * q - w * .6);
}
float mistBand(vec2 p, float y0, float spread, float speed, float seed) {
  float n = fbm3(vec2(p.x - uDrift * speed, p.y * 3.4) + seed);
  return smoothstep(.28, .84, n) * exp(-pow((p.y - y0) / spread, 2.));
}
vec3 mistColor(vec2 p) {
  float g = exp(-length(p - MOON_C) * 1.4);
  return mix(vec3(.040, .058, .105), SILVER * .55, g * (.3 + .7 * uMoon)) * (.45 + .55 * uLight);
}

// ---------- the garden: ground, bare trees, cypresses, one freestanding window frame ----------
float gy(float x) { return -.215 + .05 * (vnoise(vec2(x * 1.7, 4.)) - .5) + .012 * sin(x * 6.); }
float gardenTrees(vec2 p) {
  float cw = .34, cov = 0., ci = floor(p.x / cw);
  if (p.y > .30) return 0.;
  for (int k = -1; k <= 1; k++) {
    float i = ci + float(k);
    float h = hash21(vec2(i, 5.)), h2 = hash21(vec2(i, 11.)), h3 = hash21(vec2(i, 17.));
    if (h < .30) continue;
    float x0 = (i + .15 + .7 * h2) * cw, y0 = gy(x0) - .01;
    if (h3 > .66) {                                         // a cypress: tall, narrow, ragged
      vec2 e = (p - vec2(x0, y0 + .10 + .06 * h2)) / vec2(.017 + .008 * h, .11 + .06 * h2);
      cov = max(cov, smoothstep(.1, -.1, length(e) - 1. + .14 * (vnoise(vec2(p.y * 40., i)) - .5)));
    } else {                                                // a bare tree: trunk, four forking branches
      float H = .12 + .12 * h2, sway = sin(uDrift * .8 + i) * .004 * (.4 + uGust);
      float d = sdSeg(p, vec2(x0, y0), vec2(x0 + sway * .5, y0 + H)) - .0042;
      for (int b = 0; b < 4; b++) {
        float fb = float(b), hb = hash21(vec2(i, 20. + fb)), side = mod(fb, 2.) < 1. ? -1. : 1.;
        float ang = .6 + .5 * hb, len = (.05 + .05 * hb) * (1.15 - .15 * fb);
        vec2 a = vec2(x0, y0 + H * (.35 + .17 * fb)), e2 = a + vec2(side * sin(ang), cos(ang)) * len + vec2(sway, 0.);
        d = min(d, sdSeg(p, a, e2) - .0026);
        d = min(d, sdSeg(p, e2, e2 + vec2(-side * .3, 1.) * len * .55) - .0017);
      }
      cov = max(cov, smoothstep(.0015, -.0015, d));
    }
  }
  return cov;
}
float ruinArch(vec2 p) {
  vec2 q = p - vec2(.18, gy(.18) - .02);
  float d = archD(q, .075, .16);
  float frame = abs(d + .012) - .012;
  float mull = max(abs(q.x) - .0045, max(-q.y, q.y - .24));
  float circ = abs(length(q - vec2(0., .245)) - .036) - .004;
  float cut = sdBox(rot(.5) * (q - vec2(.075, .31)), vec2(.065, .03));
  return smoothstep(.0015, -.0015, max(min(min(frame, mull), circ), -cut));
}

// ---------- the one who is not there ----------
// A figure in light, in her own units (height 1), standing in the garden and eaten away by noise as uFigure falls.
float figureD(vec2 p) {
  float sway = sin(uDrift * .7) * .02 * (.4 + uGust);
  float y = clamp(p.y, 0., .9);
  float w = mix(.17, .065, smoothstep(0., .55, y)) * (1. - .45 * smoothstep(.55, .86, y)) + .035 * smoothstep(.8, .9, y) * 0.;   // gown: wide at the hem, narrow at the waist, shoulders
  float body = abs(p.x - sway * (1. - y) * .8) - w;
  body = max(body, max(-p.y, p.y - .88));
  float head = length(p - vec2(sway * .1, .94)) - .052;
  float hair = sdSeg(p, vec2(.01, .96), vec2(.13 + sway * 2., .80)) - .014;
  float arm = sdSeg(p, vec2(.07, .80), vec2(.24, .63 + sway)) - .013;      // a hand held out, to no one
  return min(min(body, head), min(hair, arm));
}
vec3 figureLight(vec2 p, vec2 foot, float scale) {
  vec2 q = (p - foot) / scale;
  if (q.y < -.1 || q.y > 1.15 || abs(q.x) > .6) return vec3(0.);
  float d = figureD(q);
  float erode = fbm(q * vec2(7., 11.) - vec2(0., uDrift * .12)) * 1.15;
  float keep = smoothstep((1. - uFigure) - .12, (1. - uFigure) + .12, erode + .1);
  float flick = .72 + .28 * sin(uTime * .8 + 2.) * (.5 + .5 * vnoise(vec2(uTime * .6, 7.)));
  float body = smoothstep(.02, -.012, d) * keep;
  float halo = exp(-max(d, 0.) * 14.) * .22 * uFigure * (.6 + .4 * keep);
  vec3 c = vec3(.60, .72, 1.) * (.45 + .55 * smoothstep(0., -.07, d)) + vec3(1., .78, .5) * .22 * smoothstep(.28, 0., length(q - vec2(0., .66)));
  return (c * body * .75 + vec3(.5, .62, .95) * halo) * flick * uFigure;
}

// ---------- the arcade: ruined, pointed, wind-worn ----------
// returns the signed distance to the wall (negative inside the stone)
float arcadeD(vec2 p, out float cellId) {
  float i = floor(p.x / S_ARCH + .5);                      // the pier nearest, arches between piers
  float ac = floor(p.x / S_ARCH) ;                         // the arch cell
  cellId = ac;
  float h = hash21(vec2(ac, 31.)), h2 = hash21(vec2(ac, 37.)), h3 = hash21(vec2(ac, 43.));
  float xc = (ac + .5) * S_ARCH, aw = .215 + .03 * h, y0 = -.30, sy = -.13 + .05 * h2;
  float dOpen = archD(vec2(p.x - xc, p.y - y0), aw, sy - y0);
  float top = sy + 1.732 * aw + .045 + .10 * (ridge(p.x * 3. + 9., 2.) - .45);
  float dW = max(-dOpen, p.y - top);
  if (h3 > .70) dW = max(dW, -sdBox(rot(.45 + .3 * h) * (p - vec2(xc + (h2 - .5) * .25, top - .02)), vec2(.11, .045)));   // a broken crown
  float oc = length(p - vec2((ac + 1.) * S_ARCH, sy + .30)) - .022;                                                  // a small round piercing above each pier
  return max(dW, -oc);
}
float thornVine(vec2 p, float x0, float yA, float yB, float seed, float amp, float scale) {
  if (p.y < yA || p.y > yB) return 0.;
  float sx = x0 + amp * sin(p.y * 28. / scale + seed * 6.28 + uDrift * .9) * (.6 + .6 * uGust);
  float e = p.x - sx, taper = 1. - .6 * smoothstep(yA, yB, p.y);
  float stem = smoothstep(.0042 * scale * taper, .0018 * scale, abs(e));
  float s = (p.y - yA) * 24. / scale, k = floor(s), f = fract(s), side = mod(k, 2.) * 2. - 1.;
  float len = (.012 + .012 * hash21(vec2(k, seed))) * scale;
  float thorn = step(0., e * side) * step(e * side, .004 * scale + len * (1. - f)) * step(abs(f - .45), .30) * step(abs(e), .02 * scale);
  return max(stem, thorn * .9);
}

// ---------- petals ----------
vec3 petals(vec2 p, float scale, float seed, float speed, float size, float amount) {
  vec2 g = p * scale + vec2(uDrift * speed, -uDrift * speed * .28 + sin(uDrift * .4 + seed) * .3);
  vec2 id = floor(g), f = fract(g);
  float h = hash21(id + seed), h2 = hash21(id + seed + 7.);
  vec2 pos = .5 + .28 * vec2(sin(uTime * (.3 + h) + h2 * 6.28), cos(uTime * (.25 + h2) + h * 6.28));
  float ang = h * 6.28 + uTime * (.5 + h2) * (.5 + uGust), flut = max(abs(cos(uTime * (.8 + h) + h2 * 9.)), .22);
  vec2 e = rot(ang) * (f - pos) / (size * vec2(1., .55 * flut));
  float m = smoothstep(1., .55, length(e)) * step(1. - amount, h);
  vec3 c = mix(PETAL, SILVER * .5, step(.88, h2) * .7);
  return c * m * (.55 + .45 * flut);
}

void main() {
  gQ = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
  float px = 1.5 / uRes.y;

  // sky: stars, the moon, thin clouds going by
  vec2 pS = layerP(.15);
  vec3 col = skyColor(pS) * uLight;
  vec2 pm = layerP(.25), dm = pm - MOON_C;
  float r = length(dm);
  vec2 pc = layerP(.35);
  float thr = mix(.78, .46, uCloud);
  float cl = smoothstep(thr - .12, thr + .12, wisp(pc, 1.)) * smoothstep(-.1, .3, pc.y) * (1. - .75 * smoothstep(.34, .0, r));
  float st = starLayer(pS, 110., .93, .26) + starLayer(pS + 4.7, 45., .975, .22) * 2.2;
  col += vec3(.85, .90, 1.) * st * uStars * smoothstep(-.05, .25, pS.y) * (1. - cl) * (1. - smoothstep(.55, 0., r) * .9);
  float halo = .5 * exp(-r * 4.5) + .3 * exp(-r * 11.) + .2 * exp(-pow(r / (MOON_R * 1.5), 3.));
  col += SILVER * halo * uLight * uMoon * .5;
  col = mix(col, moonSurface(dm, MOON_R) * .72, smoothstep(MOON_R, MOON_R - .003, r) * uMoon * (1. - cl * .65));
  vec3 cloudCol = mix(vec3(.030, .042, .078), vec3(.55, .63, .78), clamp(exp(-r * 2.) * (.4 + .6 * uMoon) * 1.2, 0., 1.)) * uLight;
  col = mix(col, cloudCol, cl * .8);

  // far mountains and their mist
  vec2 p1 = layerP(.40);
  float t1 = -.03 + .20 * pow(ridge(p1.x * 1.6 + 5., 1.9), 1.6) - .05;
  col = mix(col, vec3(.020, .032, .066) * uLight + SILVER * .02 * exp(-abs(p1.x - MOON_C.x) * 1.5) * uMoon, smoothstep(px, -px, p1.y - t1));
  col = mix(col, mistColor(p1), mistBand(p1, -.08, .09, .016, 3.) * uMist * .7);

  // the garden, a long way down the terrace
  vec2 pg = layerP(.55);
  float gTop = gy(pg.x);
  vec3 earth = vec3(.007, .011, .024) * uLight;
  float tr = gardenTrees(pg), ruin = ruinArch(pg);
  col = mix(col, earth, smoothstep(px, -px, pg.y - gTop));
  col = mix(col, earth * 1.1, max(tr, ruin));
  col += SILVER * ruin * .05 * uMoon * uLight * smoothstep(.0, .3, pg.y - gTop + .3);
  col += figureLight(pg, vec2(-.325, gy(-.325) - .005), .17);
  col = mix(col, mistColor(pg), mistBand(pg, -.205, .06, .03, 11.) * uMist * .85);

  // the arcade
  vec2 pa = layerP(.85);
  float cid;
  float dW = arcadeD(pa, cid);
  float pxa = pixelAt(.85);
  float wall = smoothstep(pxa * 1.5, -pxa * 1.5, dW);
  vec2 gN = normalize(vec2(dFdx(dW), dFdy(dW)) + 1e-7);
  vec2 toMoon = normalize(MOON_C - gQ);
  float rimK = smoothstep(.016, .0, -dW) * (.25 + .75 * clamp(dot(gN, toMoon), 0., 1.)) * uMoon * uLight;
  vec3 stone = vec3(.008, .012, .026) * (.6 + .6 * uLight) * (.8 + .3 * vnoise(pa * 14.));
  for (int k = -1; k <= 1; k++) {                                         // thorn vines climbing the piers
    float ci = floor(pa.x / S_ARCH + .5) + float(k), hv = hash21(vec2(ci, 51.));
    if (hv > .35) {
      float v = thornVine(pa, ci * S_ARCH + (hv - .2) * .05, -.30, -.05 + .55 * hv, hv * 3., .012, 1.);
      stone = mix(stone, vec3(.03, .04, .065) * uLight, v * .8);
    }
  }
  col = mix(col, stone + SILVER * rimK * .22, wall);
  col = mix(col, mistColor(pa), mistBand(pa, -.27, .05, .04, 17.) * uMist * .55);

  // petals in the middle distance
  col += petals(pg, 14., 3., .05, .24, .17) * uPetals * .35 * smoothstep(-.3, .0, pg.y);
  col += petals(pa, 8., 11., .09, .26, .12) * uPetals * .40;

  // the balustrade in front: a worn rail on little pointed arches, and thorn vines hanging from above
  vec2 pb = layerP(1.25);
  float railY = -.31;
  float dR = max(abs(pb.y - railY) - .011, 0.);
  float cell = floor(pb.x / .21 + .5);
  vec2 bl = vec2(pb.x - cell * .21, pb.y - (railY - .012 - .13));
  float bal = max(pb.y < railY - .011 ? -1. : 1., 0.);
  float arches = smoothstep(pxa, -pxa, archD(vec2(bl.x, pb.y - (railY - .132) + .0), .052, .05) - .0);
  float solid = smoothstep(px, -px, pb.y - (railY - .011)) * (1. - arches * step(railY - .25, pb.y));
  float rail = smoothstep(px, -px, abs(pb.y - railY) - .011);
  float post = smoothstep(px, -px, abs(bl.x - .105) - .016) * step(pb.y, railY) * step(railY - .26, pb.y);
  float balust = max(solid, max(rail, post));
  vec3 balCol = vec3(.004, .006, .014) * (.5 + .5 * uLight) + SILVER * smoothstep(.012, 0., abs(pb.y - railY - .011)) * .035 * uMoon * uLight;
  col = mix(col, balCol, clamp(balust, 0., 1.));
  vec2 pv = layerP(1.35);
  float vines = max(thornVine(pv, -.82, .02, .70, 1.3, .03, 2.2), max(thornVine(pv, -.52, .24, .70, 2.1, .02, 2.), thornVine(pv, .98, .10, .70, 3.7, .03, 2.4)));
  col = mix(col, vec3(.003, .005, .012), vines);

  // petals in front, soft and large; a mist that moves faster than anything else
  col += petals(pv, 4., 23., .13, .28, .08) * uPetals * .45;
  col = mix(col, mistColor(pb) * .8, mistBand(pb, -.40, .08, .07, 29.) * uMist * .5);

  fragColor = vec4(col, 1.);
}
`;

  const api = { FRAG, UNIFORMS };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.ETERNAL = root.ETERNAL || {}).glslTerrace = api;
})(typeof self !== "undefined" ? self : globalThis);
