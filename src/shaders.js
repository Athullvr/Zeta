// GLSL sources and the uniform contract. Two programs only:
//   scene: draws the whole picture (sky, stars, moon, clouds, mountains, castle, mist, motes) into an offscreen texture
//   post:  bloom from that texture's mip chain, tone map, grade, vignette, film grain, fade
// Every uniform used by a shader is listed in UNIFORMS with its type; the renderer and the tests both read this table.
(function (root) {
  "use strict";

  const UNIFORMS = {
    shared: { uRes: "vec2", uTime: "float" },                       // set by the renderer from the canvas and the frame
    camera: { uCam: "vec4" },                                       // x, y, zoom, roll
    scene: {
      uLight: "float", uMoon: "float", uCloud: "float", uStars: "float", uCastle: "float", uWindows: "float",
      uMist: "float", uShafts: "float", uFlash: "float", uFlashX: "float", uCrimson: "float",
    },
    post: { uBloom: "float", uGrain: "float", uVignette: "float", uExposure: "float", uFade: "float" },
  };
  const PROGRAM_UNIFORMS = {
    scene: Object.assign({}, UNIFORMS.shared, UNIFORMS.camera, UNIFORMS.scene),
    post: Object.assign({}, UNIFORMS.shared, UNIFORMS.post),
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
out vec4 fragColor;

const vec2 MOON_C = vec2(.20, .165);
const float MOON_R = .27;
const vec3 SILVER = vec3(.74, .80, .92);
const vec3 WARM = vec3(1., .66, .28);
const vec3 CRIMSON = vec3(.95, .17, .15);
const vec2 CASTLE_O = vec2(.12, -.085);
const float CASTLE_S = .33;

vec2 gQ;   // screen position: y from -.5 to .5, x scaled by the aspect ratio

// ---------- noise (hash without sin, so every GPU agrees) ----------
float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
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
float starLayer(vec2 p, float scale, float thresh, float size) {
  vec2 g = p * scale, id = floor(g), f = fract(g) - .5;
  float h = hash21(id);
  float d = length(f - (hash22(id + 7.) - .5) * .6);
  float tw = .65 + .35 * sin(uTime * (1. + h * 3.) + h * 40.);
  return step(thresh, h) * smoothstep(size, 0., d) * tw * (.5 + .5 * hash21(id + 3.));
}
vec3 moonSurface(vec2 d) {
  vec2 n = d / MOON_R;
  float z = sqrt(max(0., 1. - dot(n, n)));
  float maria = smoothstep(.40, .60, fbm(n * 1.7 + 7.)) * .85 + smoothstep(.45, .75, fbm(n * 3.4 + 2.)) * .25;
  float grain = fbm(n * 11.) - .5;
  float c = craters(n * 3.6);
  float pit = smoothstep(.12, .0, c) * .10;
  float albedo = (.92 - .46 * maria) * (1. + .34 * grain) - pit;
  float light = .68 + .32 * dot(vec3(n, z), normalize(vec3(-.4, .35, .85)));
  return vec3(.84, .89, 1.) * albedo * light * pow(z, .26) * 1.0;
}

// ---------- clouds ----------
float cloudRaw(vec2 p, float speed) {
  vec2 w = vec2(uTime * .020 * speed, uTime * .004 * speed);
  p = p * vec2(1.25, 2.6) + w;
  vec2 q = vec2(fbm(p + vec2(1.7, 9.2)), fbm(p + vec2(8.3, 2.8)));
  return fbm(p + 1.7 * q - w * .6);
}

// ---------- mist: horizontal bands that drift at their own speed ----------
float mistBand(vec2 p, float y0, float spread, float speed, float seed) {
  float n = fbm3(vec2(p.x * 1.0 - uTime * speed, p.y * 3.6) + seed);
  float band = exp(-pow((p.y - y0) / spread, 2.));
  return smoothstep(.28, .84, n) * band;
}
vec3 mistColor(vec2 p, float shaft) {
  float g = exp(-length(p - MOON_C) * 1.5);
  vec3 c = mix(vec3(.040, .058, .105), SILVER * .55, g * (.35 + .65 * uMoon));
  return c * (.45 + .55 * uLight) + SILVER * shaft * .35;
}

// ---------- the castle, in its own units: x centred, y up from the base of the walls ----------
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.)) + min(max(d.x, d.y), 0.); }
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
float castleSDF(vec2 p) {
  float d = cbox(p, vec2(0., .13), vec2(.98, .13));                        // curtain wall
  d = min(d, tower(p, .22, .24, .12, .30, .52));                           // the keep, tallest, with a slender spire
  d = min(d, tower(p, .22 - .15, .74, .028, .06, .15));                    // its corner turrets
  d = min(d, tower(p, .22 + .15, .74, .028, .06, .15));
  d = min(d, tower(p, -.46, .24, .06, .38, .36));                          // the tall west tower
  d = min(d, cbox(p, vec2(.62, .50), vec2(.08, .26)));                     // east tower, flat-topped
  d = min(d, tower(p, .62 - .045, .76, .022, .05, .12));
  d = min(d, sdBox(p - vec2(.62 + .05, .83), vec2(.012, .03)));
  d = min(d, cbox(p, vec2(-.80, .42), vec2(.07, .18)));                    // a broken tower: no roof
  d = max(d, -sdBox(p - vec2(-.77, .60), vec2(.034, .05)));
  d = min(d, tower(p, .92, .24, .05, .17, .22));
  d = min(d, cbox(p, vec2(-.20, .34), vec2(.24, .10)));                    // great hall
  d = min(d, sdCone(p - vec2(-.20, .44), .20, .56));                       // its steep roof
  d = min(d, tower(p, -.20 + .20, .44, .02, .05, .12));                    // roof ridge turret
  d = min(d, tower(p, .40, .24, .045, .14, .24));                          // chapel tower between keep and east tower
  d = min(d, sdBox(p - vec2(.22, 1.40), vec2(.004, .07)));                 // finials
  d = min(d, sdBox(p - vec2(-.46, 1.17), vec2(.004, .06)));
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
vec3 castleWindows(vec2 cp, float aa) {
  vec3 w = windowColumn(cp, .22, .34, .86, .13, 1., aa);        // keep
  w += windowColumn(cp, -.46, .36, .98, .14, 2., aa);           // west tower
  w += windowColumn(cp, .62, .34, .70, .12, 3., aa);            // east tower
  w += windowColumn(cp, -.80, .34, .54, .11, 4., aa);
  w += windowColumn(cp, .40, .32, .56, .11, 5., aa);            // chapel tower
  w += windowColumn(cp, .92, .34, .56, .11, 6., aa);
  w += windowRow(cp, -.44, .04, .32, .10, 7., aa);              // great hall
  w += windowRow(cp, -.88, .88, .125, .17, 8., aa);             // curtain wall
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
  vec2 g = p * scale + vec2(uTime * speed * .6, -uTime * speed * .25);
  vec2 id = floor(g), f = fract(g);
  float h = hash21(id + seed);
  vec2 pos = .5 + .30 * sin(uTime * (.25 + h * .5) + hash22(id + seed) * 6.28);
  float d = length(f - pos), s = .012 + .014 * hash21(id + seed + 4.);
  float tw = .45 + .55 * sin(uTime * (.6 + h * 1.5) + h * 30.);
  float m = step(.84, h) * (exp(-d * d / (s * s)) + .12 * exp(-d * d / (s * s * 14.))) * max(tw, 0.);
  return mix(SILVER, vec3(1., .74, .40), step(.8, hash21(id + seed + 9.))) * m;
}

void main() {
  gQ = (gl_FragCoord.xy - .5 * uRes) / uRes.y;

  // sky
  vec2 pS = layerP(.15);
  vec3 col = skyColor(pS) * uLight;
  vec2 pm = layerP(.30);
  vec2 dm = pm - MOON_C;
  float r = length(dm);
  col += SILVER * exp(-r * 3.2) * uLight * .10;                              // the first, formless silver light

  // cloud density (needed before the moon is composited, since the clouds sit in front of it)
  vec2 pc = layerP(.42);
  float cThr = mix(.74, .32, uCloud);
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
  vec3 moonCol = moonSurface(dm);
  float disc = smoothstep(MOON_R, MOON_R - .003, r);
  col += SILVER * halo * uLight * uMoon * .55;
  col = mix(col, moonCol, disc * uMoon);

  // lightning inside the cloud sheet
  float pulse = uFlash * (.35 + .65 * smoothstep(.30, .80, fbm3(pc * 3.2 + floor(uTime * 18.) * .37)));
  float lightAt = exp(-length(pc - vec2(uFlashX, .26)) * 1.3);
  vec3 flashCol = vec3(.62, .70, .95);

  // clouds, lit from behind by the moon: silver edges, dark bellies
  float broad = exp(-r * 1.9) * (.35 + .65 * uMoon);
  float lit = clamp(broad * (1.15 - .85 * thick) * 1.0 + cA * (1. - cA) * 2.0 * broad + halo * .15 * (1. - thick), 0., 1.) * uLight;
  vec3 cloudCol = mix(vec3(.030, .042, .078), vec3(.62, .70, .84), lit) * (.55 + .45 * uLight) + flashCol * pulse * lightAt * 1.1;
  col = mix(col, cloudCol, cA * (.95 - .55 * disc * uMoon * (1. - thick)));
  vec3 wispCol = mix(vec3(.035, .048, .085), vec3(.58, .66, .80), clamp(halo * 1.3 + exp(-r * 1.6) * .3, 0., 1.) * uLight) + flashCol * pulse * lightAt * .5;
  col = mix(col, wispCol, cB);
  col += flashCol * uFlash * .045 * (1. - cA);

  // moonlight shafts: radial streaks from the moon, seen mostly through the mist
  vec2 ps = layerP(.40);
  vec2 ds = ps - MOON_C;
  vec2 dir = ds / max(length(ds), 1e-4);   // noise over the unit circle: periodic, so no seam behind the moon
  float rays = pow(vnoise(dir * 3.2 + uTime * .03) * .6 + vnoise(dir * 8. + 5. - uTime * .02) * .4, 2.2) * exp(-length(ds) * 1.1) * uShafts;
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
uniform vec2 uRes;
uniform float uTime, uBloom, uGrain, uVignette, uExposure, uFade;
out vec4 fragColor;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.); }

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = texture(uScene, uv).rgb;

  // bloom: only what is bright, read from blurred mip levels
  vec3 b = vec3(0.);
  b += max(textureLod(uScene, uv, 2.).rgb - .30, 0.) * .30;
  b += max(textureLod(uScene, uv, 3.).rgb - .26, 0.) * .30;
  b += max(textureLod(uScene, uv, 4.).rgb - .22, 0.) * .26;
  b += max(textureLod(uScene, uv, 5.).rgb - .18, 0.) * .22;
  b += max(textureLod(uScene, uv, 6.).rgb - .14, 0.) * .20;
  c += b * uBloom * vec3(.92, .96, 1.06);

  c = aces(c * uExposure);

  // grade: shadows lean midnight blue, highlights stay silver
  float l = dot(c, vec3(.299, .587, .114));
  c = mix(c * vec3(.90, .97, 1.10) + vec3(.0, .004, .012) * (1. - l), c, smoothstep(.0, .6, l));

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

  const api = { UNIFORMS, PROGRAM_UNIFORMS, VERT, SCENE_FRAG, POST_FRAG };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.ETERNAL = root.ETERNAL || {}).shaders = api;
})(typeof self !== "undefined" ? self : globalThis);
