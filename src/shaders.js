// GLSL sources and the uniform contract. Four programs, all compiled once at start and never again:
//   scene:    the night exterior (sky, stars, moon, clouds, mountains, castle, mist, motes, storm and lightning): acts I, IV, V
//   interior: the cathedral nave: act II
//   terrace:  the ruined terrace: act III
//   post:     bloom from the scene's mip chain, tone map, grade, vignette, film grain, fade, and the blend between two scenes
// Every uniform used by a shader is listed in UNIFORMS with its type; the renderer and the tests both read this table.
// (The exterior is called "scene" for historical reasons: it was the only scene in milestone 1.)
(function (root) {
  "use strict";
  const isNode = typeof module === "object" && module.exports;
  const C = isNode ? require("./shaders-common.js") : root.ETERNAL.glslCommon;
  const GI = isNode ? require("./shaders-interior.js") : root.ETERNAL.glslInterior;
  const GT = isNode ? require("./shaders-terrace.js") : root.ETERNAL.glslTerrace;

  const UNIFORMS = {
    shared: { uRes: "vec2", uTime: "float" },                       // set by the renderer from the canvas and the frame
    camera: { uCam: "vec4" },                                       // exterior and terrace: x, y, zoom, roll. interior: x, eye height, dolly, pitch
    scene: {
      uLight: "float", uMoon: "float", uCloud: "float", uStars: "float", uCastle: "float", uWindows: "float",
      uMist: "float", uShafts: "float", uFlash: "float", uFlashX: "float", uCrimson: "float",
      uDrift: "float", uStorm: "float", uBolt: "float", uBoltX: "float", uBoltSeed: "float", uGreat: "float",
    },
    interior: GI.UNIFORMS,
    terrace: GT.UNIFORMS,
    post: { uBloom: "float", uGrain: "float", uVignette: "float", uExposure: "float", uFade: "float" },
    transition: { uMix: "float", uTrans: "float" },                 // set by the renderer from the director's transition
  };
  const PROGRAM_UNIFORMS = {
    scene: Object.assign({}, UNIFORMS.shared, UNIFORMS.camera, UNIFORMS.scene),
    interior: Object.assign({}, UNIFORMS.shared, UNIFORMS.camera, UNIFORMS.interior),
    terrace: Object.assign({}, UNIFORMS.shared, UNIFORMS.camera, UNIFORMS.terrace),
    post: Object.assign({}, UNIFORMS.shared, UNIFORMS.post, UNIFORMS.transition),
  };

  const VERT = `#version 300 es
// one oversized triangle covers the screen
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2. - 1., 0., 1.);
}
`;

  const SCENE_FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec4 uCam;
uniform float uLight, uMoon, uCloud, uStars, uCastle, uWindows, uMist, uShafts, uFlash, uFlashX, uCrimson;
uniform float uDrift, uStorm, uBolt, uBoltX, uBoltSeed, uGreat;
out vec4 fragColor;

const vec2 MOON_C = vec2(.20, .165);
const float MOON_R = .27;
const vec3 SILVER = vec3(.74, .80, .92);
const vec3 WARM = vec3(1., .66, .28);
const vec3 CRIMSON = vec3(.95, .17, .15);
const vec2 CASTLE_O = vec2(.12, -.10);
const float CASTLE_S = .335;

vec2 gQ;   // screen position: y from -.5 to .5, x scaled by the aspect ratio

${C.NOISE}
${C.GEOM}
${C.SKY}
// ---------- camera and depth: near layers move and grow more than far ones ----------
vec2 layerP(float depth) {
  float z = mix(1., uCam.z, depth);
  float c = cos(uCam.w), s = sin(uCam.w);
  vec2 q = vec2(c * gQ.x - s * gQ.y, s * gQ.x + c * gQ.y);
  return q / z + uCam.xy * depth;
}
float pixelAt(float depth) { return 1. / uRes.y / mix(1., uCam.z, depth); }

// ---------- sky, stars, moon ----------
vec3 skyColor(vec2 p) {
  float h = smoothstep(.55, -.35, p.y);
  vec3 c = mix(vec3(.004, .007, .020), vec3(.030, .050, .095), h * h);
  c += vec3(.045, .006, .010) * uCrimson * smoothstep(-.05, -.35, p.y);
  return c;
}
// ---------- clouds ----------
float cloudRaw(vec2 p, float speed) {
  vec2 w = vec2(uDrift * .020 * speed, uDrift * .004 * speed);
  p = p * vec2(1.25, 2.6) + w;
  vec2 q = vec2(fbm(p + vec2(1.7, 9.2)), fbm(p + vec2(8.3, 2.8)));
  return fbm(p + 1.7 * q - w * .6);
}

// ---------- mist: horizontal bands that drift at their own speed ----------
float mistBand(vec2 p, float y0, float spread, float speed, float seed) {
  float n = fbm3(vec2(p.x * 1.0 - uDrift * speed, p.y * 3.6) + seed);
  float band = exp(-pow((p.y - y0) / spread, 2.));
  return smoothstep(.28, .84, n) * band;
}
vec3 mistColor(vec2 p, float shaft) {
  float g = exp(-length(p - MOON_C) * 1.5);
  vec3 c = mix(vec3(.040, .058, .105), SILVER * .55, g * (.35 + .65 * uMoon));
  return c * (.45 + .55 * uLight) + SILVER * shaft * .35;
}

// ---------- the castle, in its own units: x centred, y up from the base of the walls ----------
// pointed roof: base on y = 0, half width hw, apex at height h
float sdCone(vec2 p, float hw, float h) { p.x = abs(p.x); float k = h / hw; return max((k * p.x + p.y - h) / sqrt(1. + k * k), -p.y); }
float cbox(vec2 p, vec2 c, vec2 h) {   // box with crenellations along its top edge
  vec2 q = p - c;
  float n = sdBox(vec2(mod(q.x + h.x, .07) - .035, q.y - h.y), vec2(.0175, .03));
  return max(sdBox(q, h), -n);
}
float tower(vec2 p, float cx, float by, float hw, float hh, float spire) {
  float b = sdBox(p - vec2(cx, by + hh), vec2(hw, hh));
  float corbel = sdBox(p - vec2(cx, by + 2. * hh - .012), vec2(hw * 1.2, .016));
  float roof = sdCone(p - vec2(cx, by + 2. * hh), hw * 1.16, spire * 1.18);
  return min(min(b, corbel), roof);
}
// a flying buttress: a quarter arc leaving a wall at (xt, yt) and landing R away and R lower
float fly(vec2 p, float xt, float yt, float R, float side) {
  vec2 q = vec2((p.x - xt) * side, p.y - (yt - R));
  return max(abs(length(q) - R) - .013, max(-q.x, -q.y));
}
// a buttress pier, running down into the rock, with a small pinnacle
float pier(vec2 p, float cx, float top, float hw) {
  return min(sdBox(p - vec2(cx, (top - .15) * .5), vec2(hw, (top + .15) * .5)), sdCone(p - vec2(cx, top), hw * 1.3, hw * 4.5));
}
float sdTri(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 e0 = b - a, e1 = c - b, e2 = a - c, v0 = p - a, v1 = p - b, v2 = p - c;
  vec2 q0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0., 1.), q1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0., 1.), q2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0., 1.);
  float sg = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(q0, q0), sg * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(q1, q1), sg * (v1.x * e1.y - v1.y * e1.x))), vec2(dot(q2, q2), sg * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}

// A gothic cathedral-castle in profile. Nothing is symmetrical on purpose: the west tower is taller than the east, the
// nave and transept have their own roofs at their own heights, one outer tower is broken and leans, and buttresses
// carry the weight from the walls to piers set into the rock. The central structure is the twin-towered west front.
float castleSDF(vec2 p) {
  vec2 m = vec2(abs(p.x), p.y);
  // the plinth and uneven curtain walls, set into the rock
  float d = sdBox(p - vec2(0., -.045), vec2(1.05, .105));
  d = min(d, cbox(p, vec2(-.72, .12), vec2(.34, .12)));
  d = min(d, cbox(p, vec2(.80, .09), vec2(.26, .09)));

  // west front: a tall gabled face between two towers
  d = min(d, sdBox(p - vec2(0., .38), vec2(.19, .38)));
  d = min(d, sdCone(p - vec2(0., .76), .215, .42));
  d = min(d, sdBox(m - vec2(.205, .22), vec2(.022, .22)));                // face buttresses
  d = min(d, sdCone(m - vec2(.205, .44), .03, .10));
  d = min(d, sdCone(p - vec2(0., 1.18), .012, .08));                      // gable finial

  // twin towers, unequal. The taller carries an open belfry: the moon shows through it.
  d = min(d, sdBox(p - vec2(-.34, .45), vec2(.075, .45)));
  d = min(d, sdBox(p - vec2(-.34, .89), vec2(.095, .014)));
  d = min(d, sdCone(p - vec2(-.34, .90), .092, .56));
  d = min(d, sdCone(p - vec2(-.425, .90), .02, .13));
  d = min(d, sdCone(p - vec2(-.255, .90), .02, .13));
  d = max(d, -archD(p - vec2(-.34, .58), .03, .10));
  d = min(d, sdBox(p - vec2(.34, .38), vec2(.075, .38)));
  d = min(d, sdBox(p - vec2(.34, .75), vec2(.095, .014)));
  d = min(d, sdCone(p - vec2(.34, .76), .092, .46));
  d = min(d, sdCone(p - vec2(.255, .76), .02, .11));
  d = min(d, sdCone(p - vec2(.425, .76), .02, .11));
  d = max(d, -archD(p - vec2(.34, .50), .022, .07));

  // the flèche: a slender spire over the crossing, rising behind the front
  d = min(d, sdCone(p - vec2(.07, .92), .042, .50));
  d = min(d, sdBox(p - vec2(.07, 1.44), vec2(.004, .05)));

  // nave to the east in three layers: a low aisle under a lean-to roof, a higher clerestory under a steep gable,
  // and a flying buttress arching over the aisle to a pier set in the rock
  d = min(d, sdBox(p - vec2(.70, .17), vec2(.28, .17)));
  d = min(d, sdTri(p, vec2(.74, .54), vec2(1.0, .33), vec2(.74, .33)));
  d = min(d, sdBox(p - vec2(.58, .50), vec2(.16, .22)));
  d = min(d, sdCone(p - vec2(.58, .72), .175, .38));
  d = min(d, sdCone(p - vec2(.41, .72), .02, .12));
  d = min(d, sdCone(p - vec2(.75, .72), .02, .12));
  d = min(d, fly(p, .745, .66, .26, 1.));
  d = min(d, pier(p, 1.005, .47, .028));

  // transept to the west, lower, built the same way but not the same size
  d = min(d, sdBox(p - vec2(-.70, .16), vec2(.26, .16)));
  d = min(d, sdTri(p, vec2(-.76, .48), vec2(-.96, .32), vec2(-.76, .32)));
  d = min(d, sdBox(p - vec2(-.62, .46), vec2(.15, .20)));
  d = min(d, sdCone(p - vec2(-.62, .66), .165, .34));
  d = min(d, sdCone(p - vec2(-.47, .66), .018, .10));
  d = min(d, sdCone(p - vec2(-.77, .66), .018, .10));
  d = min(d, fly(p, -.77, .58, .16, -1.));
  d = min(d, pier(p, -.93, .46, .024));

  // a ruined outer tower: it leans, and its top has been broken away
  vec2 lp = rot(.05) * (p - vec2(-.98, 0.));
  d = min(d, sdBox(lp - vec2(0., .34), vec2(.06, .34)));
  d = max(d, -sdBox(rot(-.55) * (lp - vec2(.01, .72)), vec2(.09, .03)));

  // an arcade of pointed arches in the walls
  d = max(d, -archD(p - vec2(-.80, .07), .03, .06));
  d = max(d, -archD(p - vec2(-.60, .07), .03, .06));
  d = max(d, -archD(p - vec2(.60, .06), .03, .05));
  d = max(d, -archD(p - vec2(.78, .06), .03, .05));
  return d;
}
// the rock the castle stands on: a plateau under the walls, narrowing downwards into a ragged pinnacle
float cragMask(vec2 p, float aa) {
  float top = .06 + .10 * (ridge(p.x * 2.6 + 4., .7) - .45);
  float side = p.x > 0. ? 13. : 3.;
  float below = clamp(-p.y, 0., 3.);
  float w = .97 + 1.15 * pow(below, .85) + .26 * smoothstep(0., .25, below) * (ridge(p.y * 3.4 + side, side) - .45) + .03 * sin(p.y * 22.);
  return smoothstep(aa, -aa, p.y - top) * smoothstep(aa, -aa, abs(p.x) - w);
}
float cragTop(float x) { return .06 + .10 * (ridge(x * 2.6 + 4., .7) - .45); }
float lancet(vec2 f) {   // a pointed window in cell units
  vec2 w = vec2(abs(f.x), f.y);
  return max(w.x - .11, max(-w.y - .2, (w.y + 1.6 * w.x - .316) * .6));
}
// one window of a column or row; id decides whether it kindles, when, and in which colour
vec3 windowAt(vec2 f, vec2 id, float aa) {
  float h1 = hash21(id + 3.1), h2 = hash21(id + 17.7), h3 = hash21(id + 41.3);
  float on = smoothstep(h1 * .82, h1 * .82 + .14, uWindows) * step(.34, h2);
  float flick = .78 + .22 * sin(uTime * (1.2 + h3 * 2.2) + h3 * 6.28) * (.6 + .4 * vnoise(vec2(uTime * 1.7, h1 * 40.)));
  float m = smoothstep(aa, -aa, lancet(f));
  vec3 c = mix(WARM, CRIMSON * .55, step(1. - .10 * uCrimson, h3));
  float halo = exp(-max(lancet(f), 0.) * 6.) * .12;
  return c * (m * .50 + halo) * on * flick;
}
const float WIN_K = 9.;   // window size: the lancet is defined in cell units, this scales it down to the masonry
vec3 windowColumn(vec2 cp, float cx, float y0, float y1, float s, float k, float aa) {
  if (cp.y < y0 || cp.y > y1) return vec3(0.);
  vec2 f = vec2(cp.x - cx, mod(cp.y - y0, s) - s * .5);
  return windowAt(f * WIN_K, vec2(floor((cp.y - y0) / s), k), aa * WIN_K);
}
vec3 windowRow(vec2 cp, float x0, float x1, float y, float s, float k, float aa) {
  if (cp.x < x0 || cp.x > x1) return vec3(0.);
  vec2 f = vec2(mod(cp.x - x0, s) - s * .5, cp.y - y);
  return windowAt(f * WIN_K, vec2(floor((cp.x - x0) / s), k), aa * WIN_K);
}
// the great west window (a tall lancet) and the rose above it: lit last, the warmest things in the picture
vec3 greatWindow(vec2 cp, float aa) {
  float on = smoothstep(.55, .85, uWindows) * uGreat;
  if (on <= 0.) return vec3(0.);
  vec2 q = cp - vec2(0., .20);
  float lan = smoothstep(aa, -aa, archD(q, .052, .19));
  lan *= 1. - smoothstep(.005, .002, min(abs(q.x), abs(abs(q.x) - .026) * step(.0, q.y - .08)));   // mullions
  lan *= .65 + .5 * smoothstep(.0, .45, 1. - q.y * 1.4);
  vec2 r = cp - vec2(0., .62);
  float rl = length(r);
  float rose = smoothstep(aa, -aa, rl - .062);
  rose *= 1. - smoothstep(.005, .002, min(abs(r.x), abs(r.y)));
  rose *= 1. - smoothstep(.005, .002, abs(rl - .032));
  rose *= 1. - smoothstep(.005, .002, abs(abs(r.x) - abs(r.y)) * .7) * step(rl, .062);
  float flick = .86 + .14 * sin(uTime * 1.3 + 2.) * (.7 + .3 * vnoise(vec2(uTime * 1.1, 3.)));
  vec3 gold = mix(WARM, vec3(1., .80, .5), .3);
  vec3 rosec = mix(gold, CRIMSON * .85, .55 * uCrimson);
  float halo = exp(-max(archD(q, .052, .19), 0.) * 18.) * .10 + exp(-max(rl - .062, 0.) * 18.) * .12;
  return (gold * lan * .85 + rosec * rose * .95 + gold * halo) * on * flick;
}
vec3 castleWindows(vec2 cp, float aa) {
  vec3 w = windowColumn(cp, -.34, .12, .60, .13, 1., aa);        // west tower, below the belfry
  w += windowColumn(cp, .34, .12, .52, .12, 2., aa);              // east tower
  w += windowRow(cp, .46, .72, .52, .10, 3., aa);                 // nave clerestory
  w += windowRow(cp, .46, .94, .16, .12, 9., aa);                 // nave aisle
  w += windowRow(cp, -.74, -.50, .46, .10, 4., aa);               // transept clerestory
  w += windowRow(cp, -.92, -.48, .15, .12, 10., aa);              // transept aisle
  w += windowColumn(cp, -.98, .14, .56, .13, 5., aa);             // the ruined tower
  w += greatWindow(cp, aa);
  return w;
}

// a row of firs: slender, concave-sided, each its own height
float firLine(float x, float scale, float seed, float hmax) {
  float tx = x * scale, id = floor(tx);
  float tri = 1. - abs(fract(tx + hash21(vec2(id, seed)) * .6) - .5) * 2.;
  float h = hmax * (.35 + .65 * hash21(vec2(id, seed + 3.))) * (.6 + .8 * vnoise(vec2(x * 3. + seed, 0.)));
  return h * pow(tri, 1.7);
}

// ---------- drifting motes ----------
vec3 motes(vec2 p, float scale, float seed, float speed) {
  vec2 g = p * scale + vec2(uDrift * speed * .6, -uDrift * speed * .25);
  vec2 id = floor(g), f = fract(g);
  float h = hash21(id + seed);
  vec2 pos = .5 + .30 * sin(uTime * (.25 + h * .5) + hash22(id + seed) * 6.28);
  float d = length(f - pos), s = .012 + .014 * hash21(id + seed + 4.);
  float tw = .45 + .55 * sin(uTime * (.6 + h * 1.5) + h * 30.);
  float m = step(.84, h) * (exp(-d * d / (s * s)) + .12 * exp(-d * d / (s * s * 14.))) * max(tw, 0.);
  return mix(SILVER, vec3(1., .74, .40), step(.8, hash21(id + seed + 9.))) * m;
}

// a forked bolt: a jagged line from the cloud to behind the ridge, only drawn while uBolt is up
vec3 boltLight(vec2 p) {
  float y = p.y, top = .62, bot = -.03, k = clamp((top - y) / (top - bot), 0., 1.);
  float wob = (vnoise(vec2(y * 6., uBoltSeed)) - .5) * .10 + (vnoise(vec2(y * 26., uBoltSeed + 3.)) - .5) * .028;
  float d = abs(p.x - (uBoltX + wob));
  float inRange = step(bot, y) * step(y, top);
  float core = smoothstep(.0035 * (1. - .5 * k), .0, d) * inRange;
  float glow = exp(-d * 38.) * inRange * .22;
  float yb = .26 - y, fork = step(0., yb) * step(yb, .30);
  float xb = uBoltX + (vnoise(vec2(1.56, uBoltSeed)) - .5) * .10 + yb * (uBoltSeed > 5. ? -.32 : .32) + (vnoise(vec2(y * 30., uBoltSeed + 9.)) - .5) * .02;
  float db = abs(p.x - xb);
  return vec3(.80, .88, 1.) * (core + glow + (smoothstep(.0022, .0, db) * .6 + exp(-db * 50.) * .08) * fork);
}

void main() {
  gQ = (gl_FragCoord.xy - .5 * uRes) / uRes.y;

  // sky
  vec2 pS = layerP(.15);
  vec3 col = skyColor(pS) * uLight * (1. - .4 * uStorm);
  vec2 pm = layerP(.30);
  vec2 dm = pm - MOON_C;
  float r = length(dm);
  col += SILVER * exp(-r * 3.2) * uLight * .10;                              // the first, formless silver light

  // cloud density (needed before the moon is composited, since the clouds sit in front of it)
  vec2 pc = layerP(.42);
  float cThr = mix(.74, .32, uCloud) + .20 * uMoon * (1. - smoothstep(.0, .46, r));   // an opening in the cloud around the moon
  float fldA = cloudRaw(pc, 1.);
  float cA = smoothstep(cThr - .12, cThr + .10, fldA) * smoothstep(-.28, .12, pc.y);
  float thick = clamp((fldA - cThr) * 3.2, 0., 1.);
  vec2 pw = layerP(.60);
  float cB = smoothstep(.50, .86, cloudRaw(pw + 3.1, 1.9)) * .55 * smoothstep(-.1, .25, pw.y);

  // stars, hidden by cloud and by the glare of the moon
  float st = starLayer(pS, 110., .93, .26) * 1.0 + starLayer(pS + 4.7, 45., .975, .22) * 2.2;
  st *= uStars * smoothstep(-.12, .22, pS.y) * (1. - smoothstep(.6, .0, r) * .9) * (1. - cA) * (1. - cB);
  col += vec3(.85, .90, 1.) * st;

  // moon
  float halo = .55 * exp(-r * 4.2) + .30 * exp(-r * 10.) + .22 * exp(-pow(r / (MOON_R * 1.5), 3.));
  vec3 moonCol = moonSurface(dm, MOON_R);
  float disc = smoothstep(MOON_R, MOON_R - .003 - .06 * cA, r);   // seen through cloud, the rim goes soft
  col += SILVER * halo * uLight * uMoon * .55;
  col = mix(col, moonCol, disc * uMoon);

  // lightning inside the cloud sheet
  float pulse = uFlash * (.35 + .65 * smoothstep(.30, .80, fbm3(pc * 3.2 + floor(uTime * 18.) * .37)));
  float lightAt = exp(-length(pc - vec2(uFlashX, .26)) * 1.3);
  vec3 flashCol = vec3(.62, .70, .95);

  // clouds, lit from behind by the moon: silver edges, dark bellies
  float broad = exp(-r * 1.9) * (.35 + .65 * uMoon);
  float lit = clamp(broad * (1.15 - .85 * thick) * 1.0 + cA * (1. - cA) * 2.0 * broad + halo * .15 * (1. - thick), 0., 1.) * uLight;
  vec3 cloudCol = mix(vec3(.030, .042, .078) * (1. - .45 * uStorm), vec3(.62, .70, .84), lit * (1. - .35 * uStorm)) * uLight + flashCol * pulse * lightAt * 1.1;
  col = mix(col, cloudCol, cA * (.94 - .30 * (1. - thick)));
  vec3 wispCol = mix(vec3(.035, .048, .085), vec3(.58, .66, .80), clamp(halo * 1.3 + exp(-r * 1.6) * .3, 0., 1.)) * uLight + flashCol * pulse * lightAt * .5;
  col = mix(col, wispCol, cB);
  col += flashCol * uFlash * .045 * (1. - cA);

  if (uBolt > .01) col += boltLight(layerP(.35)) * uBolt;

  // moonlight shafts: radial streaks from the moon, seen mostly through the mist
  vec2 ps = layerP(.40);
  vec2 ds = ps - MOON_C;
  vec2 dir = ds / max(length(ds), 1e-4);   // noise over the unit circle: periodic, so no seam behind the moon
  float rays = pow(vnoise(dir * 3.2 + uDrift * .03) * .6 + vnoise(dir * 8. + 5. - uDrift * .02) * .4, 2.2) * exp(-length(ds) * 1.1) * uShafts;
  col += SILVER * rays * .16 * (1. - cA * .7);

  // far mountains
  float px = 1.5 / uRes.y;
  vec2 p1 = layerP(.50);
  float t1 = -.06 + .26 * pow(ridge(p1.x * 1.5 + 3., 1.3), 1.6) - .07;
  float m1 = smoothstep(px, -px, p1.y - t1);
  vec3 far = vec3(.020, .032, .066) * uLight + SILVER * .02 * exp(-abs(p1.x - MOON_C.x) * 1.5) * uMoon;
  far += flashCol * uFlash * .03;
  col = mix(col, far, m1);
  float mi = mistBand(p1, -.10, .10, .018, 3.) * uMist;
  col = mix(col, mistColor(p1, rays), mi * .75);

  // middle mountains
  vec2 p2 = layerP(.64);
  float t2 = -.17 + .24 * pow(ridge(p2.x * 2. + 11., 4.1), 1.7) - .05;
  float m2 = smoothstep(px, -px, p2.y - t2);
  vec3 mid = vec3(.010, .016, .036) * uLight + flashCol * uFlash * .02;
  col = mix(col, mid, m2);
  float mi2 = mistBand(p2, -.19, .09, .030, 8.) * uMist;
  col = mix(col, mistColor(p2, rays), mi2 * .8);

  // the crag and the castle
  float depthC = .80;
  vec2 pk = layerP(depthC);
  vec2 cp = (pk - CASTLE_O) / CASTLE_S;
  float pxl = pixelAt(depthC) / CASTLE_S;
  float rock = cragMask(cp, pxl * 1.5);
  float cd = castleSDF(cp);
  float body = smoothstep(pxl * 1.5, -pxl * 1.5, cd);
  // the castle rises out of the mist: low walls first, then towers, eroded by noise
  float reveal = smoothstep(0., .6, uCastle * 2.7 - .25 - fbm(cp * 2.2 + 2.) * .30 - max(cp.y, 0.) * .55);
  body *= reveal;
  vec3 stone = (vec3(.005, .008, .017) + SILVER * .010 * uMoon) * uLight + flashCol * uFlash * .035;
  vec3 rockCol = vec3(.004, .006, .014) * uLight + flashCol * uFlash * .02;
  float moonSide = exp(-length(pk - MOON_C) * 2.2) * uMoon * uLight;
  float rim = smoothstep(-.02, 0., cd) * (1. - smoothstep(0., .01, cd));
  col = mix(col, stone + SILVER * rim * moonSide * .07, body);
  if (uFlash > .02 && body > .01) {   // lightning reveals the masonry: lit faces, courses of stone, bright edges
    vec2 e = vec2(.005, 0.);
    vec2 g = vec2(castleSDF(cp + e.xy) - castleSDF(cp - e.xy), castleSDF(cp + e.yx) - castleSDF(cp - e.yx));
    vec2 nrm = g / max(length(g), 1e-4);
    float facing = clamp(dot(nrm, normalize(vec2(uFlashX * .6, .9))) * .5 + .5, 0., 1.);
    vec2 cell = cp * vec2(15., 28.);
    float row = floor(cell.y);
    vec2 f = vec2(fract(cell.x + mod(row, 2.) * .5), fract(cell.y));
    float joint = max(smoothstep(.09, .0, f.x), smoothstep(.12, .0, f.y));
    float block = hash21(vec2(floor(cell.x + mod(row, 2.) * .5), row));
    float edge = smoothstep(-.03, 0., cd);
    col += flashCol * uFlash * (facing * (.14 + .12 * block) * (1. - .75 * joint) + edge * .22) * reveal * body;
  }
  vec3 win = castleWindows(cp, pxl) * smoothstep(0., .08, -cd - .01) * reveal;
  col += win * (.85 + .5 * uCrimson * .2);
  float rimR = exp(-max(cragTop(cp.x) - cp.y, 0.) * 40.) * rock;
  col = mix(col, rockCol + SILVER * rimR * moonSide * .10, rock);

  // mist around the castle's foot
  float mi3 = mistBand(pk, -.21, .075, .040, 14.) * uMist;
  col = mix(col, mistColor(pk, rays), mi3 * .9);

  // foreground hills and a line of firs
  vec2 p4 = layerP(1.15);
  float hill = -.405 + .09 * (ridge(p4.x * .9 + 21., 7.7) - .4);
  float fir = max(max(firLine(p4.x, 21., 1., .050), firLine(p4.x + .37, 33., 7., .042)), firLine(p4.x + .11, 13., 3., .070))
            * smoothstep(.30, .60, vnoise(vec2(p4.x * 2.3 + 40., 1.)));
  col = mix(col, mistColor(p4, rays * .5), mistBand(p4, -.31, .10, .045, 30.) * uMist * .8);
  float m4 = smoothstep(px, -px, p4.y - (hill + fir));
  col = mix(col, vec3(.002, .003, .007) * uLight + flashCol * uFlash * .012, m4);
  float mi4 = mistBand(p4, -.40, .09, .060, 22.) * uMist;
  col = mix(col, mistColor(p4, rays * .5), mi4 * .55);

  // motes of light: two depths, parallax with the camera
  col += motes(layerP(.90), 9., 1., .05) * .8 * uStars;
  col += motes(layerP(1.30), 5., 9., .08) * .9 * uStars;

  fragColor = vec4(col, 1.);
}
`;

  const POST_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uSceneB;
uniform vec2 uRes;
uniform float uTime, uBloom, uGrain, uVignette, uExposure, uFade, uMix, uTrans;
out vec4 fragColor;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.); }

// bloom: only what is bright, read from blurred mip levels
vec3 glow(sampler2D s, vec2 uv) {
  vec3 b = max(textureLod(s, uv, 2.).rgb - .30, 0.) * .30;
  b += max(textureLod(s, uv, 3.).rgb - .26, 0.) * .30;
  b += max(textureLod(s, uv, 4.).rgb - .22, 0.) * .26;
  b += max(textureLod(s, uv, 5.).rgb - .18, 0.) * .22;
  b += max(textureLod(s, uv, 6.).rgb - .14, 0.) * .20;
  return b;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;

  // between two scenes: how much of each, and anything the transition adds on top
  float wa = 1., wb = 0.;
  vec3 add = vec3(0.);
  if (uMix > 0.) {
    if (uTrans < 1.5) {                       // 1: fog. The next scene condenses out of drifting fog, patch by patch.
      float n = vn(uv * vec2(3., 2.) + uTime * .03) * .55 + vn(uv * vec2(8., 5.) - uTime * .02) * .30 + vn(uv * 17.) * .15;
      wb = smoothstep(n - .16, n + .16, uMix * 1.32 - .16);
      wa = 1. - wb;
      add = vec3(.20, .25, .36) * pow(1. - abs(2. * uMix - 1.), 2.) * (.10 + .22 * vn(uv * 4. + uTime * .05));
    } else if (uTrans < 2.5) {                // 2: bloom. The light swells until it is all there is, and the next scene is lit by it.
      wb = smoothstep(.40, .60, uMix);
      wa = 1. - wb;
      add = vec3(.62, .70, .92) * exp(-pow((uMix - .5) * 3.4, 2.)) * (1.15 - .5 * length(uv - .5));
    } else {                                  // 3: darkness. Fade to black, then up from black.
      wa = 1. - smoothstep(0., .5, uMix);
      wb = smoothstep(.5, 1., uMix);
    }
  }
  vec3 c = vec3(0.), b = vec3(0.);
  if (wa > 0.) { c += texture(uScene, uv).rgb * wa; b += glow(uScene, uv) * wa; }
  if (wb > 0.) { c += texture(uSceneB, uv).rgb * wb; b += glow(uSceneB, uv) * wb; }
  c += add + b * uBloom * vec3(.92, .96, 1.06);

  c = aces(c * uExposure);

  // grade: shadows lean midnight blue, highlights stay silver
  float l = dot(c, vec3(.299, .587, .114));
  c = mix(c * vec3(.90, .97, 1.10) + vec3(.0, .004, .012) * (1. - l) * smoothstep(.0, .02, l), c, smoothstep(.0, .6, l));

  // vignette, corrected for the wide aspect ratio
  vec2 d = (uv - .5) * vec2(uRes.x / uRes.y * .62, 1.);
  c *= 1. - uVignette * smoothstep(.30, .95, length(d));

  // film grain at 24 frames a second, plus a hair of dither against banding in the dark gradients
  float g = hash12(gl_FragCoord.xy + floor(uTime * 24.) * vec2(37., 17.)) - .5;
  float live = smoothstep(.0, .03, l);   // pure black stays pure black: grain needs something to sit on
  c += g * uGrain * (.55 + .9 * (1. - l)) * .45 * live;
  c += (hash12(gl_FragCoord.xy * 1.7 + 11.) - .5) / 255. * live;

  c *= 1. - uFade;
  fragColor = vec4(max(c, 0.), 1.);
}
`;

  const FRAGS = { scene: SCENE_FRAG, interior: GI.FRAG, terrace: GT.FRAG, post: POST_FRAG };
  const api = { UNIFORMS, PROGRAM_UNIFORMS, VERT, SCENE_FRAG, POST_FRAG, FRAGS };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.ETERNAL = root.ETERNAL || {}).shaders = api;
})(typeof self !== "undefined" ? self : globalThis);
