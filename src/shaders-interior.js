// Act II: the memory. The inside of an abandoned cathedral, seen down its nave from a slowly advancing eye.
// Not a model: one ray per pixel is intersected with four analytic surfaces (floor, side walls, a pointed rib vault and the
// west wall) and each is shaded by procedural patterns in its own coordinates. Moonlight shafts are marched through the haze
// and dust is a pair of slowly drifting sheets, both visible only where the light is.
(function (root) {
  "use strict";
  const C = typeof module === "object" && module.exports ? require("./shaders-common.js") : root.ETERNAL.glslCommon;

  // uCam: x = sideways offset, y = eye height, z = how far down the nave we have come, w = pitch (radians, up)
  const UNIFORMS = { uLight: "float", uBeams: "float", uDust: "float", uGlass: "float", uFog: "float", uCrimson: "float" };

  const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec4 uCam;
uniform float uLight, uBeams, uDust, uGlass, uFog, uCrimson;
out vec4 fragColor;

${C.NOISE}
${C.GEOM}

const float W = 3., B = 4.6, ZE = 38., YS = 12.2, YA = 17.2, PH = .55, F = .92;
const vec3 SILVER = vec3(.74, .80, .92);
const vec3 BEAM = vec3(.50, .64, .95);
const vec2 LDIR = vec2(.4851, -.8745);    // a moon shaft: inward and down, 29 degrees off the vertical

// the vault: a pointed profile, steep at the springing and rising to a ridge down the middle
float vaultY(float x) { return YS + (YA - YS) * pow(1. - clamp(abs(x) / W, 0., 1.), .62); }

// ---------- stained glass: muted jewel tones in lead ----------
vec3 glassPal(float h) {
  vec3 blue = vec3(.07, .17, .50), crimson = vec3(.52, .07, .12), amber = vec3(.80, .50, .15), teal = vec3(.05, .30, .38), silver = vec3(.52, .62, .82);
  vec3 c = h < .36 ? blue : h < .55 ? mix(crimson, blue, .35 * (1. - uCrimson)) : h < .70 ? amber : h < .86 ? teal : silver;
  return mix(c, vec3(.34, .44, .66) * dot(c, vec3(.33)) * 2., .22);   // pulled a little towards moonlit silver-blue
}
vec3 roseGlass(vec2 p) {
  float r = length(p), a = fract(atan(p.y, p.x) / 6.2831853);
  float ring = r < .42 ? 0. : r < 1. ? 1. : r < 1.62 ? 2. : 3.;
  float nS = ring == 0. ? 1. : ring == 3. ? 24. : 12.;
  float f = fract(a * nS), sec = floor(a * nS);
  vec3 c = glassPal(hash21(vec2(ring * 7. + sec, 3.)));
  float rb = min(min(abs(r - .42), abs(r - 1.)), min(abs(r - 1.62), abs(r - 2.3)));
  float lead = smoothstep(.05, .02, rb);
  if (ring > 0.) lead = max(lead, smoothstep(.045, .016, min(f, 1. - f) / nS * 6.2831853 * r));
  if (ring == 2.) {                                   // foils: a small circle in every cell of the third ring
    float ac = (sec + .5) / nS * 6.2831853;
    vec2 pc = 1.31 * vec2(cos(ac), sin(ac));
    float dc = length(p - pc);
    c = mix(c, glassPal(fract(hash21(vec2(sec, 9.)) * 7.3)), step(dc, .21));
    lead = max(lead, smoothstep(.035, .012, abs(dc - .21)));
  }
  if (ring == 0.) { c = vec3(.80, .52, .16); lead = max(lead, smoothstep(.04, .015, abs(r - .2))); }
  return mix(c * (.55 + .65 * smoothstep(2.4, .0, r)), vec3(.008, .01, .02), lead);
}
vec3 lancetGlass(vec2 p, float id) {
  vec2 q = vec2(p.x * 3.4 + p.y * 1.7, p.x * 3.4 - p.y * 1.7), cid = floor(q), cf = fract(q);
  float lead = max(smoothstep(.08, .02, min(cf.x, 1. - cf.x)), smoothstep(.08, .02, min(cf.y, 1. - cf.y)));
  vec3 c = glassPal(hash21(cid + id * 13.));
  return mix(c * (.45 + .5 * smoothstep(0., 7., p.y)), vec3(.008, .01, .02), lead);
}
// the west wall: stone, a great rose, three lancets
vec3 endWall(vec2 p) {
  vec3 col = vec3(.014, .019, .034) * (.8 + .4 * vnoise(p * 3.));
  vec2 pr = p - vec2(0., 12.4);
  float rr = length(pr);
  col += vec3(.03, .04, .07) * smoothstep(.14, 0., abs(rr - 2.45));
  col = mix(col, roseGlass(pr) * uGlass, smoothstep(.03, -.03, rr - 2.32));
  float dC = archD(vec2(p.x, p.y - 1.2), .82, 5.6), dL = archD(vec2(abs(p.x) - 1.95, p.y - 1.2), .5, 4.2);
  col += vec3(.03, .04, .07) * (smoothstep(.14, 0., abs(dC)) + smoothstep(.11, 0., abs(dL)));
  col = mix(col, lancetGlass(vec2(p.x, p.y - 1.2), 1.) * uGlass, smoothstep(.03, -.03, dC));
  col = mix(col, lancetGlass(vec2(abs(p.x) - 1.95, p.y - 1.2), 2.) * uGlass * .9, smoothstep(.03, -.03, dL));
  return col;
}

// ---------- the side walls: arcade, triforium, clerestory ----------
vec3 wallShade(float z, float y, float fp) {
  float zb = mod(z, B) - B * .5, azb = abs(zb);
  float row = floor(y / .75);
  float cx = floor((z + mod(row, 2.) * .9) / 1.8);
  vec3 col = vec3(.020, .026, .044) * (.82 + .3 * hash21(vec2(cx, row)));
  float jfade = smoothstep(.5, .08, fp / .75);
  col *= 1. - .30 * jfade * max(smoothstep(.46, .5, abs(fract((z + mod(row, 2.) * .9) / 1.8) - .5)), smoothstep(.46, .5, abs(fract(y / .75) - .5)));

  // the arcade: pointed arches opening on to a dark aisle with moonlit lancets far beyond
  float ad = archD(vec2(zb, y), 1.75, 4.2);
  float open = smoothstep(fp, -fp, ad) * step(y, 7.6);
  vec3 aisle = vec3(.006, .009, .020) + vec3(.07, .10, .19) * smoothstep(fp * 2., -fp * 2., archD(vec2(zb, y - 1.9), .62, 2.7)) * .5 * (.8 + .2 * vnoise(vec2(z * .3, y)));
  col += vec3(.02, .028, .05) * smoothstep(.28, .0, ad) * (1. - open) * step(y, 7.6);
  col = mix(col, aisle, open);

  // piers and the shafts that rise from them to the vault: round, so lit across their width
  float db = B * .5 - azb, pw = y < 7.5 ? PH : .34;
  if (db < pw && open < .5) {
    float x = db / pw;
    col = col * (.55 + 1.1 * sqrt(max(0., 1. - x * x))) + vec3(.012, .016, .03) * step(.9, x);
  }

  // triforium: three little dark arches a bay, between two string courses
  if (y > 7.5 && y < 8.8) {
    for (int i = -1; i <= 1; i++) col = mix(col, vec3(.005, .007, .014), smoothstep(fp, -fp, archD(vec2(zb - float(i) * 1.1, y - 7.6), .38, .45)));
  }
  // clerestory: the windows that let the moon in
  float cw = archD(vec2(zb, y - 8.95), .8, 1.8);
  float glass = smoothstep(fp, -fp, cw);
  float oculus = length(vec2(zb, y - 11.05));
  vec3 moonGlass = BEAM * (1.25 + .25 * vnoise(vec2(z * .5, y))) * uLight;
  moonGlass *= 1. - smoothstep(.05, .02, abs(zb)) - smoothstep(.04, .015, abs(oculus - .30)) * .8;
  col += vec3(.04, .055, .09) * smoothstep(.40, .0, cw) * (1. - glass);
  col = mix(col, moonGlass, glass);
  col += vec3(.02, .028, .05) * (smoothstep(.07, 0., abs(y - 7.5)) + smoothstep(.07, 0., abs(y - 8.8)) + smoothstep(.09, 0., abs(y - 12.1)));
  return col;
}

// ---------- the rib vault ----------
vec3 vaultShade(float x, float z, float fp) {
  float zc = mod(z, B) - B * .5;
  vec3 col = vec3(.010, .014, .027) * (.8 + .4 * vnoise(vec2(x, z) * 1.3));
  float transverse = smoothstep(.20, .07, abs(abs(zc) - B * .5));
  float diag = smoothstep(.10, .03, abs(abs(x) / W - abs(zc) / (B * .5)));
  float ridgeRib = smoothstep(.16, .05, abs(x)) * .8;
  float boss = smoothstep(.40, .22, length(vec2(x, zc)));
  float rib = max(max(transverse, diag * .85), max(ridgeRib, boss));
  return mix(col, vec3(.050, .062, .098), rib * smoothstep(.0, .15, 1. - fp * .06));
}

// ---------- the floor: worn flagstones that remember the windows ----------
vec3 floorShade(vec3 P, vec3 rd, float fp) {
  vec2 t = vec2(P.x / 1.6, P.z / 2.2);
  float row = floor(t.y);
  vec2 g = vec2(fract(t.x + mod(row, 2.) * .5), fract(t.y)), id = vec2(floor(t.x + mod(row, 2.) * .5), row);
  float joint = max(smoothstep(.04, .0, min(g.x, 1. - g.x)), smoothstep(.04, .0, min(g.y, 1. - g.y)));
  vec3 col = vec3(.014, .019, .033) * (.7 + .6 * hash21(id)) * (1. - .55 * joint * smoothstep(.5, .08, fp / .8));
  col *= .8 + .4 * vnoise(P.xz * 2.5);
  // the glass, reflected: a smear of colour along the middle of the nave
  float dz = ZE - P.z, xr = P.x + rd.x / rd.z * dz + (vnoise(P.xz * vec2(3., .7)) - .5) * .5, yr = -rd.y / rd.z * dz;
  if (abs(xr) < W && yr > .2 && yr < 16.) col += endWall(vec2(xr, yr)) * .20 * pow(1. - clamp(-rd.y, 0., 1.), 3.) * smoothstep(0., 4., dz) * (.6 + .4 * vnoise(P.xz * 1.2));
  // pools of moonlight under the clerestory windows, mullions and all
  vec3 pools = vec3(0.);
  float zr = mod(P.z, B) - B * .5;
  for (int s = 0; s < 2; s++) {
    float sd = s == 0 ? -1. : 1., wgt = s == 0 ? 1. : .38;
    float xi = (sd < 0. ? P.x + W : W - P.x);                       // distance in from the window's wall
    float top = 10.7 + sqrt(max(0., 4. * .64 - (abs(zr) + .8) * (abs(zr) + .8)));
    float lo = .55 * 8.9, hi = .55 * top;
    float inside = smoothstep(lo - .1, lo + .05, xi) * smoothstep(hi + .1, hi - .05, xi) * smoothstep(.85, .6, abs(zr));
    inside *= 1. - smoothstep(.06, .02, abs(zr)) * .85;
    pools += BEAM * inside * wgt;
  }
  col += pools * uBeams * .42 * (.7 + .3 * vnoise(P.xz * 1.5)) * smoothstep(-4., 3., P.z - uCam.z + 12.);
  return col;
}

// ---------- light in the air ----------
float beamDensity(vec3 p) {
  float zr = mod(p.z, B) - B * .5, d = 0.;
  for (int i = 0; i < 2; i++) {
    float s = i == 0 ? -1. : 1., wgt = i == 0 ? 1. : .38;
    vec2 rel = vec2((p.x - s * W) * -s, p.y - 10.7);
    float along = dot(rel, LDIR), perp = rel.x * LDIR.y - rel.y * LDIR.x;
    d += wgt * smoothstep(1.35, .7, abs(perp)) * smoothstep(-.2, 1.2, along) * exp(-along * .055) * smoothstep(.85, .4, abs(zr));
  }
  return d * (.65 + .7 * vnoise3(p * vec3(.9, .6, .9) + vec3(uTime * .03, 0., uTime * .02)));
}
vec3 dust(vec3 ro, vec3 rd, float tHit) {
  vec3 acc = vec3(0.);
  for (int k = 0; k < 2; k++) {
    float Dz = 7.5, off = k == 0 ? 0. : 3.7;
    float m = ceil((ro.z + .8 - off) / Dz), zp = off + m * Dz, dist = zp - ro.z, t = dist / rd.z;
    if (t > tHit) continue;
    vec3 P = ro + rd * t;
    float alpha = smoothstep(1.6, 3.4, dist) * smoothstep(Dz + .8, Dz - 2.5, dist);
    vec2 gp = (P.xy + vec2(uTime * .03, uTime * .05 + m * 13.)) / 1.1, id = floor(gp), f = fract(gp);
    float h = hash31(vec3(id, m + float(k) * 17.));
    vec2 pos = .5 + .30 * sin(uTime * (.2 + h * .4) + hash22(id + m) * 6.28);
    float d = length(f - pos) * 1.1, r = .035 + .03 * hash21(id + m * 3.);
    float tw = .5 + .5 * sin(uTime * (.5 + h) + h * 40.);
    float lightHere = beamDensity(P);
    acc += mix(SILVER, vec3(1., .78, .5), step(.82, hash21(id + 5.))) * step(.60, h) * exp(-d * d / (r * r)) * tw * alpha * (.10 + 1.9 * lightHere);
  }
  return acc;
}

void main() {
  vec2 q = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
  vec3 ro = uCam.xyz;
  vec3 rd = normalize(vec3(q.x, q.y, F));
  float cp = cos(uCam.w), sp = sin(uCam.w);
  rd = vec3(rd.x, rd.y * cp + rd.z * sp, rd.z * cp - rd.y * sp);

  // which surface do we meet first?
  float tEnd = (ZE - ro.z) / rd.z;
  float tFloor = rd.y < -1e-4 ? -ro.y / rd.y : 1e9;
  float tWall = rd.x > 1e-4 ? (W - ro.x) / rd.x : rd.x < -1e-4 ? (-W - ro.x) / rd.x : 1e9;
  float tHit = min(tEnd, min(tFloor, tWall));
  int kind = tHit == tFloor ? 0 : tHit == tWall ? 1 : 2;
  if (rd.y > 0.) {                                   // does the ray leave through the vault first?
    float t0 = 0., t1 = tHit;
    vec3 p = ro + rd * t1;
    if (p.y > vaultY(p.x)) {
      for (int i = 1; i <= 12; i++) { float t = tHit * float(i) / 12.; vec3 pp = ro + rd * t; if (pp.y > vaultY(pp.x)) { t1 = t; break; } t0 = t; }
      for (int i = 0; i < 6; i++) { float tm = .5 * (t0 + t1); vec3 pm = ro + rd * tm; if (pm.y > vaultY(pm.x)) t1 = tm; else t0 = tm; }
      tHit = t1; kind = 3;
    }
  }
  vec3 P = ro + rd * tHit;
  float pxw = tHit / (F * uRes.y);

  vec3 col;
  if (kind == 0) col = floorShade(P, rd, pxw / max(.1, -rd.y));
  else if (kind == 1) col = wallShade(P.z, P.y, pxw / max(.1, abs(rd.x)));
  else if (kind == 3) col = vaultShade(P.x, P.z, pxw / max(.1, rd.y));
  else col = endWall(P.xy);

  // the glow of the west window falls on everything near it
  col += vec3(.10, .12, .22) * uGlass * exp(-(ZE - P.z) / 13.) * .10 * (kind == 2 ? 0. : 1.);
  col *= mix(.5, 1., uLight);

  // haze: thicker with distance, bright where the shafts pass
  float tm = min(tHit, 28.);
  float N = 18.;
  float acc = 0., j = hash21(gl_FragCoord.xy);
  for (int i = 0; i < 18; i++) acc += beamDensity(ro + rd * ((float(i) + j) / N * tm)) * (tm / N);
  float fog = 1. - exp(-tHit * uFog * .018);
  col = mix(col, vec3(.030, .042, .075) * uLight, fog * .75);
  col += BEAM * acc * .075 * uBeams;
  col += dust(ro, rd, tHit) * uDust;

  fragColor = vec4(col, 1.);
}
`;

  const api = { FRAG, UNIFORMS };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.ETERNAL = root.ETERNAL || {}).glslInterior = api;
})(typeof self !== "undefined" ? self : globalThis);
