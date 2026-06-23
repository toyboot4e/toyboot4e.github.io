// Homepage disco ball — a fixed, full-viewport WebGL background effect.
//
// Authored in TypeScript and bundled+minified to `disco.min.js` by
// `scripts/build-assets.ts` (bun), alongside the `*.min.css`. The `.ts` source is
// NOT copied into `out/` (the org-publish "static" component only matches
// `.js`/`.css`/… by extension); only the compiled `disco.min.js` ships.
//
// Design (see docs/adr/0003-homepage-disco-ball-webgl.md and CONTEXT.md):
//   - Site-wide: `build/render.tsx` emits the `<canvas id="disco-canvas">` and
//     this script (DISCO_BODY / DISCO_HEAD) on every page.
//   - Raw WebGL, one full-screen fragment shader — no framework. Runs in both
//     themes (u_light selects the palette/effect); starts/stops live as the user
//     toggles the theme or the disco button.
//   - A faceted mirror sphere (the hero) is shared. DARK adds a cast glint-field
//     on a near-black room; LIGHT adds rainbow rings and an aurora (upper sky)
//     over the bright page — see the light branch in main().
//   - Guards: pause when hidden; `prefers-reduced-motion` → one static frame;
//     reduced internal resolution (capped DPR, lower tier on coarse-pointer
//     devices); graceful no-WebGL skip; WebGL context-loss handling.

// ----------------------------------------------------------------------------
// Shaders
// ----------------------------------------------------------------------------

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// GLSL ES 1.00 (WebGL1): no transpose()/inverse(), so rotations are inverted by
// negating angles. Loops need constant bounds.
const FRAG = `
precision highp float;

uniform vec2  u_res;
uniform float u_time;
uniform float u_ballOnly; // 1.0 = draw only the ball (transparent elsewhere) so a
                          // cheap CSS layer can supply the drifting light instead.
uniform float u_light;    // 0.0 = dark theme, 1.0 = light theme. Selects the palette
                          // below; light also takes the ball-only (alpha) path so the
                          // bright page shows behind a reflective-silver ball.

varying vec2 v_uv;

// ============================================================
//  TUNABLE PALETTE  — re-grade the whole effect from here.
//  Two themes; *_L is the light-theme variant (mixed in by u_light).
//  Dark = emissive glints on black. Light = reflective silver/chrome
//  on a bright "showroom" (ROOM_L light-grey so facets aren't black).
// ============================================================
const vec3 KEY  = vec3(1.00, 0.72, 0.34);   // warm gold key light
const vec3 COOL = vec3(0.28, 0.52, 0.95);   // cool steel-blue counter-light
const vec3 POP  = vec3(0.92, 0.32, 0.70);   // magenta pop (the "bit more colour")
const vec3 ROOM = vec3(0.020, 0.022, 0.038); // near-black room

const vec3 KEY_L  = vec3(1.00, 0.82, 0.42);  // light: warm highlight
const vec3 COOL_L = vec3(0.40, 0.62, 1.00);  // light: cool highlight
const vec3 POP_L  = vec3(0.95, 0.42, 0.75);  // light: colour pop
const vec3 ROOM_L = vec3(0.16, 0.18, 0.24);  // light: dark steel base — chrome reads
                                             // as mostly-dark with bright glints, so it
                                             // pops against the bright page (not pale grey)

// Light-theme cast field: rainbow beams fanning from the top-left, plus a
// self-rotating ring of rainbow lights whose centre circles the viewport but is
// biased up-right so it mostly stays clear of the (lower-left) ball.
const float LBEAM_ALPHA  = 0.55;              // spotlight intensity from the top-left
const float LBEAM_WIDTH  = 0.34;              // angular half-width of the soft halo cone
const float LBEAM_CORE   = 0.09;              // narrow bright beam core (the "light")
const float LBEAM_SWEEP  = 0.30;              // how fast the spotlights sweep
const float LBEAM_DARK   = 1.10;              // beam brightness added to the dark room
const float LRING_RADIUS = 0.40;              // radius of the circle the lights ride
const float LRING_DOT    = 0.14;              // soft glow size of each light
const float LRING_ALPHA  = 0.50;              // ring light intensity over the page
const float LRING_SPEED  = 0.5;               // lights' rotation around the ring
const float LRING_PULSE       = 0.32;         // radius shrink/expand amount
const float LRING_PULSE_SPEED = 0.8;          // breathing speed
const float LRING_ORBIT       = 0.48;         // ellipse extent of the centre's travel
const float LRING_ORBIT_SPEED = 0.25;         // ring centre orbit speed
// Both rings share the same right-side orbit; ring 2 is half a turn (PI) out of
// phase so the two ride opposite points and together fill the right side.
const float LRING_BIAS_X      = 0.62;         // right-side orbit centre (clear of the ball)
const float LRING_BIAS_Y      = 0.00;
const float LAURORA_ALPHA = 0.45;             // aurora brightness (light theme, over white)
const float LAURORA_RAYS  = 6.0;              // number of fanning rays (angular frequency)
const float LAURORA_DARK  = 0.5;              // aurora gain added to the dark sky (it glows there)

const float BALL_RADIUS = 0.95;
const vec2  BALL_SCREEN = vec2(-0.98, -0.30);  // y-normalised; offset into the left margin
const float BALL_SCALE  = 0.98;               // bigger = larger ball on screen
const float SPIN_SPEED  = 0.13;
const float TILT        = 0.38;               // fixed lean so the spin axis isn't dead vertical
const float FACET_LAT   = 22.0;               // mirror tiles top-to-bottom
const float FACET_LON   = 44.0;               // mirror tiles around
const float PI          = 3.14159265;

mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c); }
mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c); }

float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Procedural "room" the facets reflect: a dark space with a few bright,
// coloured key lights. Returns radiance for a reflection direction.
vec3 environment(vec3 d){
  vec3 key  = mix(KEY,  KEY_L,  u_light);
  vec3 cool = mix(COOL, COOL_L, u_light);
  vec3 pop  = mix(POP,  POP_L,  u_light);
  vec3 room = mix(ROOM, ROOM_L, u_light);
  vec3 c = room;
  c += key  * pow(max(dot(d, normalize(vec3( 0.55, 0.55, 0.45))), 0.0), 48.0) * 3.2;
  c += cool * pow(max(dot(d, normalize(vec3(-0.70, 0.25, 0.55))), 0.0), 70.0) * 2.2;
  c += pop  * pow(max(dot(d, normalize(vec3( 0.15,-0.55, 0.62))), 0.0), 80.0) * 1.7;
  c += key  * 0.035 * (0.5 + 0.5 * d.y);   // faint warm ambient gradient
  return c;
}

// Cast glint-field: layered soft drifting specks of light, the ball's "throw"
// across the page. Kept faint and tinted; masked to the margins by the caller.
vec3 castDots(vec2 uv, float t){
  vec3 c = vec3(0.0);
  float aspect = u_res.x / u_res.y;
  for (int i = 0; i < 3; i++){
    float fi = float(i);
    vec2 g = uv * vec2(aspect, 1.0) * (5.0 + fi * 3.5);
    g += vec2(t * (0.045 + 0.02 * fi), -t * 0.025);
    vec2 id = floor(g);
    vec2 f  = fract(g) - 0.5;
    float h = hash21(id + fi * 19.0);
    vec2  o = (vec2(hash21(id + 1.3), hash21(id + 2.7)) - 0.5) * 0.6;
    float d = length(f - o);
    float spk = smoothstep(0.26, 0.0, d) * step(0.62, h);
    vec3 tint = mix(KEY, mix(COOL, POP, hash21(id + 5.0)), hash21(id + 7.0));
    c += tint * spk * (0.35 + 0.65 * hash21(id + 3.0));
  }
  return c * 0.55;
}

// Hue (0..1) → saturated RGB (for the rainbow ring).
vec3 hue(float h){
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}

// Light-theme cast field: a self-rotating circle of rainbow lights at the
// top-left. Twelve coloured lights ride a circle and orbit its centre. Returns a
// PREMULTIPLIED-alpha colour so it composites cleanly over the page. p is the
// y-normalised centre-origin coord (same space as main()).
// Rainbow spotlights: a few wide soft cones sweeping out from the top-left (they
// widen with distance like real spotlights). Composited in FRONT of the ball.
vec4 castBeam(vec2 p, float t){
  float aspect = u_res.x / u_res.y;
  // Apex pushed off-screen beyond the top-left so the on-screen cones are wide
  // (not pinched at the corner).
  vec2  src  = vec2(-aspect * 1.35, 1.45);
  vec2  d    = p - src;
  float bang = atan(d.y, d.x);
  float fall = smoothstep(4.0, 0.4, length(d)); // brightest near the source
  vec4 acc = vec4(0.0);
  for (int k = 0; k < 3; k++){
    float fk   = float(k);
    float base = -0.10 - 1.0 * (fk / 2.0);                 // spread across the down-right fan
    float ca   = base + 0.30 * sin(t * LBEAM_SWEEP + fk * 2.1);
    float dang = bang - ca;
    float cone = exp(-dang * dang / (LBEAM_WIDTH * LBEAM_WIDTH)); // soft halo
    float core = exp(-dang * dang / (LBEAM_CORE * LBEAM_CORE));   // bright defined beam
    vec3  col  = hue(fract(fk / 3.0 + t * 0.03));
    float a    = (cone * 0.30 + core) * fall * LBEAM_ALPHA;
    acc += vec4(col * a, a);
  }
  return min(acc, vec4(0.9));
}

// A self-rotating rainbow ring on the shared right-side orbit. dir spins the
// lights, huePhase shifts its colours, orbitPhase offsets where its centre sits on
// the orbit (PI apart = opposite points, so two rings fill the space).
vec4 ringAt(vec2 p, float t, float dir, float huePhase, float orbitPhase, vec2 bias){
  float aspect = u_res.x / u_res.y;
  float radius = LRING_RADIUS * (1.0 + LRING_PULSE * sin(t * LRING_PULSE_SPEED + huePhase * 6.28));
  float oa = t * LRING_ORBIT_SPEED + orbitPhase;
  vec2  center = vec2(bias.x * aspect, bias.y)
               + LRING_ORBIT * vec2(cos(oa) * aspect, sin(oa));
  vec4 acc = vec4(0.0);
  for (int k = 0; k < 12; k++){
    float fk  = float(k);
    float ang = t * LRING_SPEED * dir + fk * (6.2831853 / 12.0);
    vec2  lp  = center + radius * vec2(cos(ang), sin(ang));
    float dd  = length(p - lp) / LRING_DOT;
    float glow = exp(-dd * dd);                   // soft round light
    vec3  col  = hue(fk / 12.0 + huePhase);       // each light a different rainbow hue
    float a    = glow * LRING_ALPHA;
    acc += vec4(col * a, a);
  }
  return acc;
}

// Aurora: curtains of light fanning out across the sky dome — angular ray stripes
// radiating from a vanishing point high above (the 3D perspective: rays converge
// at the zenith, spread toward the horizon). Teal-green ↔ violet, brightest in a
// mid-sky band, soft. Premultiplied-alpha.
vec4 aurora(vec2 p, float t){
  vec2  vp  = vec2(0.1, 2.3);                                // vanishing point above the screen
  vec2  d   = p - vp;
  float ang = atan(d.x, -d.y);                              // fan angle (0 = straight down from vp)
  // angular ray stripes, irregular widths via a slow wobble, gentle drift
  float rc  = ang * LAURORA_RAYS + 0.6 * sin(ang * 5.0 + t * 0.15) + t * 0.04;
  float ray = smoothstep(0.5, 0.12, abs(fract(rc) - 0.5));  // soft curtain
  // aurora hangs in the upper sky, brightest through a mid band, fading up + down
  float vEnv = smoothstep(-0.15, 0.35, p.y) * smoothstep(1.25, 0.55, p.y) + 0.35 * smoothstep(0.1, 0.6, p.y);
  vEnv = clamp(vEnv, 0.0, 1.0);
  // colour: teal-green ↔ violet across the fan, lifting toward violet higher up
  float mixA = 0.5 + 0.5 * sin(ang * 2.5 + t * 0.10);
  vec3  col  = mix(vec3(0.30, 0.95, 0.72), vec3(0.55, 0.32, 0.95), mixA);
  col = mix(col, vec3(0.52, 0.30, 0.95), smoothstep(0.35, 1.0, p.y));
  float a = ray * vEnv * LAURORA_ALPHA;
  return vec4(col, 1.0) * a;
}

void main(){
  // y-normalised, centre-origin coords (aspect-correct).
  vec2 p = (gl_FragCoord.xy * 2.0 - u_res) / u_res.y;

  // Reading-column mask: 0 in the central column (kept dark), 1 in the margins.
  float colMask = smoothstep(0.16, 0.46, abs(v_uv.x - 0.5));

  // --- background cast glint-field (margins only; DARK theme only — the light
  // path composites its own layers and never reads bg, so skip the work. u_light
  // is a uniform, so this branch is coherent across the draw and stays cheap) ---
  vec3 bg = vec3(0.0);
  if (u_light < 0.5) bg = castDots(v_uv, u_time) * colMask;

  // --- the faceted mirror ball ---
  vec2  q  = (p - BALL_SCREEN) / BALL_SCALE;
  float r2 = dot(q, q);
  float R  = BALL_RADIUS;

  vec3  ball = vec3(0.0);
  float aa   = 2.5 / u_res.y;
  float mask = smoothstep(R, R - aa, sqrt(r2));   // 1 inside the disc, 0 outside

  if (r2 < R * R) {
    // Orthographic front-hemisphere normal.
    vec3 n = normalize(vec3(q, sqrt(max(R * R - r2, 0.0))));

    // Spin the sphere, then quantise the surface into mirror facets in
    // latitude/longitude so each tile reflects the room at a discrete angle.
    mat3 rot    = rotY(u_time * SPIN_SPEED) * rotX(TILT);
    mat3 invRot = rotX(-TILT) * rotY(-u_time * SPIN_SPEED);
    vec3 on = rot * n;

    float lat = asin(clamp(on.y, -1.0, 1.0));
    float lon = atan(on.z, on.x);
    float u   = (lon / (2.0 * PI) + 0.5) * FACET_LON;
    float v   = (lat /  PI        + 0.5) * FACET_LAT;
    float clon = ((floor(u) + 0.5) / FACET_LON - 0.5) * 2.0 * PI;
    float clat = ((floor(v) + 0.5) / FACET_LAT - 0.5) *  PI;
    vec3 facetObj = vec3(cos(clat) * cos(clon), sin(clat), cos(clat) * sin(clon));
    vec3 facetN   = invRot * facetObj;

    vec3 refl = reflect(vec3(0.0, 0.0, -1.0), facetN);
    vec3 col  = environment(refl);

    // Per-facet sparkle (static identity per tile) so tiles read individually.
    float spark = hash21(vec2(floor(u), floor(v)) * 1.7);
    col *= 0.55 + 0.9 * spark;

    // Dark "mortar" gaps between tiles.
    vec2 cell = vec2(fract(u), fract(v));
    float edge = smoothstep(0.0, 0.07, cell.x) * smoothstep(0.0, 0.07, 1.0 - cell.x)
               * smoothstep(0.0, 0.07, cell.y) * smoothstep(0.0, 0.07, 1.0 - cell.y);
    col *= mix(0.22, 1.0, edge);

    // Cool fresnel rim + a floor so unlit facets aren't pure black (light grey
    // on the light theme, so the ball reads as reflective silver).
    col += mix(COOL, COOL_L, u_light) * pow(1.0 - max(n.z, 0.0), 3.0) * 0.35;
    col += mix(ROOM, ROOM_L, u_light) * mix(3.5, 1.0, u_light);

    // Dim the ball where it crosses the reading column, full in the margins.
    ball = col * mix(0.42, 1.0, colMask);
  }

  // Ball-only path: output just the ball with straight alpha, transparent
  // everywhere else. Used for the dark static fallback (a CSS layer supplies the
  // light behind) AND for the light theme (the bright page shows behind a
  // reflective ball — a dark "room" filling the viewport would look wrong there).
  // Dark static fallback (reduced-motion): plain ball-only; the CSS layer behind
  // supplies the drifting light.
  if (u_ballOnly > 0.5 && u_light < 0.5) {
    vec3 c = ball / (ball + vec3(1.0));
    c = pow(c, vec3(1.0 / 2.2));
    gl_FragColor = vec4(c, mask);
    return;
  }

  // Light theme: composite (premultiplied, "over") the page-relative layers —
  // a tinted cast-light field at the bottom, a soft contact shadow, then the ball
  // on top — and emit straight alpha so it lays over the bright page.
  if (u_light > 0.5) {
    vec3 bc = pow(ball / (ball + vec3(1.0)), vec3(1.0 / 2.2));
    vec4 ballP = vec4(bc * mask, mask);

    vec2 sq = (p - (BALL_SCREEN + vec2(0.06, -0.13))) / BALL_SCALE;
    float shA = smoothstep(R * 1.35, R * 0.7, length(sq)) * (1.0 - mask) * 0.30;
    vec4 shadP = vec4(vec3(0.04, 0.05, 0.09) * shA, shA);

    // Layer order: two counter-rotating rainbow rings behind the ball; ball +
    // contact shadow; then the rainbow spotlights IN FRONT (light on the ball's face).
    // Rainbow rings: two on the right orbit (half a turn apart), plus a third
    // drifting upper-left to fill more of the screen — a richer light-theme field
    // (the reading column is covered by the card/heading panes). Tune via LRING_*
    // and each ring's bias. TODO #2 — eyeball the count/placement.
    vec2 ringBias = vec2(LRING_BIAS_X, LRING_BIAS_Y);
    vec4 ringP = ringAt(p, u_time, 1.0, 0.0, 0.0, ringBias)
               + ringAt(p, u_time, -1.0, 0.5, 3.14159265, ringBias)
               + ringAt(p, u_time, 1.0, 0.27, 1.7, vec2(-0.55, 0.42));
    // Aurora ribbons (upper sky).
    ringP = min(ringP + aurora(p, u_time), vec4(0.97));
    vec4 beamP = castBeam(p, u_time);
    vec4 o = ballP + (1.0 - ballP.a) * (shadP + (1.0 - shadP.a) * ringP);
    o = beamP + (1.0 - beamP.a) * o;
    gl_FragColor = vec4(o.a > 0.001 ? o.rgb / o.a : vec3(0.0), o.a);
    return;
  }

  // Soft warm halo bleeding off the ball into the background.
  bg += KEY * 0.10 * smoothstep(R * 1.9, R, sqrt(r2)) * colMask;

  // Aurora curtains glowing across the upper sky. Added to the BACKGROUND (before
  // the ball is composited) so the ball occludes it — it sits behind the ball;
  // additive on the dark room so it glows. Premultiplied → .rgb.
  bg += aurora(p, u_time).rgb * LAURORA_DARK;

  vec3 col = mix(bg, ball, mask);

  // Vignette → push brightness to the edges, darken the centre/bottom.
  float vig = smoothstep(1.7, 0.25, length(p * vec2(0.85, 1.0)));
  col *= mix(0.55, 1.0, vig);

  // Rainbow spotlights from the top-left, added to the dark room as bright
  // coloured beams (same source as the light theme).
  col += castBeam(p, u_time).rgb * LBEAM_DARK;

  // Reinhard tonemap + gamma.
  col = col / (col + vec3(1.0));
  col = pow(col, vec3(1.0 / 2.2));

  gl_FragColor = vec4(col, 1.0);
}
`;

// ----------------------------------------------------------------------------
// Bootstrap
// ----------------------------------------------------------------------------

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    // eslint-disable-next-line no-console
    console.warn("disco: shader compile failed:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function link(gl: WebGLRenderingContext): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn("disco: program link failed:", gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

// User on/off preference for the effect, persisted like the theme. Default on.
// localStorage access can throw on iOS (storage blocked) — swallow and default on.
const DISCO_KEY = "toybeam-disco";
function discoPref(): boolean {
  try {
    return localStorage.getItem(DISCO_KEY) !== "off";
  } catch (e) {
    return true;
  }
}

// Software GL (SwiftShader / llvmpipe / Mesa software / Microsoft Basic Render)
// fills every pixel on the CPU — a full-screen shader animates far too slowly.
// Detect it so we can freeze to a single static frame instead of animating.
// Returns false when the renderer string is unavailable (masked for privacy);
// the runtime frame-time governor then catches the slow case anyway.
function isSoftwareRenderer(g: WebGLRenderingContext): boolean {
  try {
    const ext = g.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return false;
    const r = String(g.getParameter((ext as any).UNMASKED_RENDERER_WEBGL) || "").toLowerCase();
    return /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen/.test(r);
  } catch (e) {
    return false;
  }
}

// matchMedia helpers (guarded — matchMedia is absent in very old engines).
function mm(query: string): MediaQueryList | null {
  return window.matchMedia ? window.matchMedia(query) : null;
}
function onMedia(mql: MediaQueryList | null, cb: () => void): void {
  if (!mql) return;
  // addListener is the deprecated fallback for old WebKit.
  mql.addEventListener ? mql.addEventListener("change", cb) : mql.addListener(cb);
}

function sameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === location.origin;
  } catch (e) {
    return false;
  }
}

// Wall-clock epoch (ms) shared across same-tab navigations (sessionStorage), so
// the shader time is continuous between pages — performance.now() resets per
// page, so it can't carry the animation over. A fresh tab/visit starts over.
function discoEpoch(): number {
  try {
    const s = sessionStorage.getItem("toybeam-disco-t0");
    if (s) return parseFloat(s);
    const e = Date.now();
    sessionStorage.setItem("toybeam-disco-t0", String(e));
    return e;
  } catch (e) {
    return Date.now();
  }
}

function effectiveDark(): boolean {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark") return true;
  if (attr === "light") return false;
  const m = mm("(prefers-color-scheme: dark)");
  return !!(m && m.matches);
}

function start(): void {
  const canvas = document.getElementById("disco-canvas") as HTMLCanvasElement | null;
  if (!canvas) return;

  // Tear down ALL disco UI — the effect can't/shouldn't run on this device. This
  // includes the disco-toggle button: a control for an absent effect is just a
  // dead button, so remove it rather than leave it unresponsive.
  function disable(): void {
    document.documentElement.classList.remove("disco-on", "disco-static");
    canvas!.remove();
    const bg = document.querySelector(".disco-bg-light");
    if (bg) bg.remove();
    const tgl = document.getElementById("disco-toggle");
    if (tgl) tgl.remove();
  }

  // Canvas opacity (recomputed per theme in sync). Homepage: full. Article/tag
  // pages: DARK dims to 0.55; LIGHT to 0.7 — the old 0.55 over the bright page
  // was what washed the light-theme article background into fog, and the
  // drop-shadowed reading panes (CSS) give the separation instead of heavy dim.
  // "home" = a card-listing page (homepage or a tag page); render.tsx puts the
  // `home` class on those. They run the effect at full opacity like the homepage;
  // long-form article pages (no `home` class) dim (below). Keying off the class
  // keeps this in sync with the CSS, which switches on the same `home` class.
  const home = document.documentElement.classList.contains("home");
  let onOpacity = "1";
  // Same-site navigation shows the disco instantly (no fade-in); a fresh/external
  // visit (or toggling it on) fades via the `disco-animating` opt-in class.
  const fromSameSite = !!document.referrer && sameOrigin(document.referrer);

  const opts: WebGLContextAttributes = {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: "low-power",
  };
  let gl = (canvas.getContext("webgl", opts) ||
    canvas.getContext("experimental-webgl", opts)) as WebGLRenderingContext | null;
  if (!gl) {
    // Graceful no-WebGL skip: leave the plain dark homepage.
    disable();
    return;
  }

  // Drop the effect entirely on software renderers (no real GPU): a full-screen
  // shader is far too heavy on the CPU, and even the static-ball + CSS-light
  // fallback wrecks Interaction-to-Next-Paint when the compositor is software too.
  // Plain dark homepage instead.
  if (isSoftwareRenderer(gl)) {
    disable();
    return;
  }

  let prog = link(gl);
  if (!prog) {
    disable();
    return;
  }

  // Full-screen triangle.
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.useProgram(prog);
  const uRes = gl.getUniformLocation(prog, "u_res");
  const uTime = gl.getUniformLocation(prog, "u_time");
  const uBallOnly = gl.getUniformLocation(prog, "u_ballOnly");
  const uLight = gl.getUniformLocation(prog, "u_light");

  // Quality tier: cheaper internal resolution, cheaper still on touch devices.
  const coarseMql = mm("(pointer: coarse)");
  const coarse = !!(coarseMql && coarseMql.matches);
  const maxDpr = coarse ? 1.0 : 1.5;
  const resScale = coarse ? 0.7 : 1.0;

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr) * resScale * govScale;
    const w = Math.max(1, Math.round(canvas!.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas!.clientHeight * dpr));
    if (canvas!.width !== w || canvas!.height !== h) {
      canvas!.width = w;
      canvas!.height = h;
    }
    gl!.viewport(0, 0, w, h);
  }

  const reduce = mm("(prefers-reduced-motion: reduce)");
  const epoch = discoEpoch(); // wall-clock base for the shader time (cross-page)
  let raf = 0;
  let running = false;
  let started = false; // first frame drawn (for fade-in)
  let enabled = discoPref(); // user on/off preference (the disco-toggle button)
  let light = false; // current effective theme is light (drives u_light); set in sync()
  let fadeTimer = 0; // pending teardown during a graceful switch-off fade
  let animTimer = 0; // window during which disco transitions are enabled

  // Framerate cap. The spin is slow, so 30fps is indistinguishable from 60 but
  // halves continuous fill for everyone.
  const MIN_INTERVAL = 1000 / 30;
  // Adaptive governor — the real-GPU gate. Renderer-string sniffing (above) can be
  // defeated by privacy masking, so frame time is the ground truth: if frames are
  // slow, lower the resolution; if they're catastrophic or stay slow at the floor,
  // REMOVE the effect (no usable GPU). Only `prefers-reduced-motion` keeps a static
  // ball; a struggling device gets the plain dark homepage.
  let govScale = 1.0; // resolution multiplier, lowered under load
  let dropped = false; // effect removed entirely (no GPU / too weak)
  let lastDraw = 0; // timestamp of the last actual draw
  let warmup = 0; // drawn-frame count (skip governor during startup jank)
  let slow = 0; // consecutive sustained-slow frames (weak GPU → lower res)
  let vslow = 0; // consecutive catastrophic frames (no GPU → drop fast)

  function drop(): void {
    dropped = true;
    stop();
    disable(); // also removes the disco-toggle button — no control for an absent effect
  }

  function degrade(): void {
    if (govScale > 0.34) govScale *= 0.6; // shrink the buffer a notch, keep animating
    else drop(); // can't hold even the floor → give up and remove it
  }

  // Resize, set uniforms, draw, and reveal on the first frame. Shared by the
  // animated loop and the static (ball-only) render.
  function paint(timeSeconds: number, ballOnly: boolean): void {
    resize();
    gl!.uniform2f(uRes, canvas!.width, canvas!.height);
    gl!.uniform1f(uTime, timeSeconds);
    gl!.uniform1f(uBallOnly, ballOnly ? 1 : 0);
    gl!.uniform1f(uLight, light ? 1 : 0);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    if (!started) {
      started = true;
      canvas!.style.opacity = onOpacity;
    }
  }

  function frame(now: number): void {
    if (!running) return;
    raf = window.requestAnimationFrame(frame);

    // Framerate cap: skip this callback if too little time has passed.
    if (lastDraw && now - lastDraw < MIN_INTERVAL - 1) return;
    const dt = lastDraw ? now - lastDraw : MIN_INTERVAL;
    lastDraw = now;

    // After a short warmup (ignore startup/compile jank), police frame time.
    if (++warmup > 5) {
      // Catastrophically slow (<~7fps): no usable GPU. Drop fast so it never
      // lingers as a laggy mess — a few such frames is well under a second.
      if (dt > 150) {
        if (++vslow >= 3) {
          drop();
          return;
        }
      } else {
        vslow = 0;
      }
      // Sustained slow (can't hold the 30fps target): a weak GPU — lower the
      // resolution, and if it still can't cope, degrade() drops it.
      if (dt > MIN_INTERVAL * 2) {
        if (++slow >= 10) {
          slow = 0;
          degrade();
          return;
        }
      } else {
        slow = 0;
      }
    }

    paint((Date.now() - epoch) / 1000, false); // wall-clock → continuous across pages
  }

  // Static path (`prefers-reduced-motion` only): draw the ball ONCE, ball-only
  // (transparent surround), and let the CSS `.disco-bg-light` layer supply the
  // drifting light. `disco-static` on <html> reveals it. (Software / weak GPUs are
  // dropped, not frozen — see drop().)
  function staticMode(): boolean {
    return !!(reduce && reduce.matches);
  }

  let stillPending = 0;
  function drawStill(): void {
    // Toggle the class synchronously (cheap — paints immediately), but DEFER the
    // heavy ball fill to a later task so it never blocks the paint that responds
    // to a click/tap (keeps Interaction-to-Next-Paint low). Coalesced. The CSS
    // light layer is dark-theme only — on light, a reflective ball over the bright
    // page is enough and the bright-speck layer would vanish.
    document.documentElement.classList.toggle("disco-static", !light);
    if (stillPending) return;
    stillPending = window.setTimeout(() => {
      stillPending = 0;
      paint(9.0, true);
    }, 0);
  }

  function run(): void {
    if (running) return;
    // Reduced motion → the static ball + CSS light path. Capable GPUs animate the
    // full shader; software / weak GPUs are dropped by the governor.
    if (staticMode()) {
      drawStill();
      return;
    }
    document.documentElement.classList.remove("disco-static");
    running = true;
    lastDraw = 0;
    warmup = 0;
    slow = 0;
    raf = window.requestAnimationFrame(frame);
  }

  function stop(): void {
    running = false;
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
  }

  // Briefly enable the disco transitions so this on/off (or first appearance)
  // fades; removed after, so hover / theme / same-site nav stay instant.
  function animate(): void {
    document.documentElement.classList.add("disco-animating");
    if (animTimer) clearTimeout(animTimer);
    animTimer = window.setTimeout(() => {
      document.documentElement.classList.remove("disco-animating");
      animTimer = 0;
    }, 900);
  }

  // Show whenever the user hasn't switched it off (both themes now); pause when
  // the tab is hidden. The effective theme just selects the palette (`light` →
  // u_light), re-applied live on theme toggle. The `disco-on` class marks "the
  // ball is the active background" so CSS can make content translucent to reveal it.
  function sync(): void {
    if (dropped) return;
    light = !effectiveDark();
    // Homepage: full. Article/tag pages dim — dark to 0.55, light to 0.7 (enough
    // to settle the effect behind the drop-shadowed panes without the fog wash).
    onOpacity = home ? "1" : light ? "0.7" : "0.55";
    if (enabled) {
      document.documentElement.classList.add("disco-on");
      // Cancel any in-flight switch-off fade and bring it back.
      if (fadeTimer) {
        clearTimeout(fadeTimer);
        fadeTimer = 0;
      }
      if (!document.hidden) {
        run();
        // Reflect the theme/page opacity live on a theme toggle (paint only sets
        // it on the first frame). Guard on `started` so we never reveal a blank
        // canvas before its first draw.
        if (started) canvas!.style.opacity = onOpacity;
      } else {
        // Hidden tab: pause rendering but keep the mode (disco-on stays).
        stop();
        canvas!.style.opacity = "0";
        started = false;
      }
    } else {
      // Switched off: revert the content styling immediately so it animates back
      // (via disco-animating) IN SYNC with the canvas fade — no late snap — then
      // keep the ball spinning through the fade before stopping.
      document.documentElement.classList.remove("disco-on", "disco-static");
      canvas!.style.opacity = "0";
      const finish = () => {
        stop();
        started = false;
        fadeTimer = 0;
      };
      if (!document.hidden && running) {
        if (fadeTimer) clearTimeout(fadeTimer);
        fadeTimer = window.setTimeout(finish, 850);
      } else {
        if (fadeTimer) clearTimeout(fadeTimer);
        finish();
      }
    }
  }

  // The disco-toggle button (homepage, dark theme): flip the preference, persist
  // it, and reflect the pressed state for the dimmed-when-off styling.
  const btn = document.getElementById("disco-toggle");
  function reflectBtn(): void {
    if (btn) btn.setAttribute("aria-pressed", enabled ? "true" : "false");
  }
  reflectBtn();
  (window as any).toggleDisco = function (): void {
    enabled = !enabled;
    try {
      localStorage.setItem(DISCO_KEY, enabled ? "on" : "off");
    } catch (e) {
      /* storage blocked — preference is session-only */
    }
    reflectBtn();
    animate(); // fade this on/off in or out
    sync();
  };

  // React to: theme toggle (data-theme mutation), OS theme change, tab
  // visibility, reduced-motion change, and viewport resize.
  new MutationObserver(sync).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  onMedia(mm("(prefers-color-scheme: dark)"), sync);
  onMedia(reduce, () => {
    stop();
    sync();
  });
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("resize", () => {
    // The animated loop already resizes itself each frame (resize + redraw in the
    // same frame). Calling resize() here too reallocates+clears the canvas with
    // the redraw deferred to the next frame → a blank flash, e.g. when a mobile
    // URL/search bar shows and changes the viewport height. So only the static
    // render needs a nudge to avoid stretching.
    if (!running && document.documentElement.classList.contains("disco-on")) drawStill();
  });

  // WebGL context loss: stop cleanly, then rebuild on restore.
  canvas.addEventListener(
    "webglcontextlost",
    (e) => {
      e.preventDefault();
      stop();
    },
    false,
  );
  canvas.addEventListener(
    "webglcontextrestored",
    () => {
      prog = link(gl!);
      if (!prog) return;
      gl!.useProgram(prog);
      sync();
    },
    false,
  );

  // Fade in only on a COLD entry (fresh tab / external referrer); on same-site
  // navigation reveal instantly. The previous page already showed the effect, so
  // a fade adds nothing — and an animating full-screen canvas on every navigation
  // is extra compositor work that can amplify display-level tearing. The shared
  // clock (discoEpoch) keeps the animation continuous across pages either way;
  // this only governs the opacity reveal.
  if (!fromSameSite) animate();

  sync();
}

// Defer the WebGL init until the browser is idle AFTER the first content paint:
// the shader compile + first frame are heavy, and starting them at
// DOMContentLoaded steals the main thread from the LCP element -- on sparse
// listing pages that pushed LCP from ~1.5s to ~7s (Lighthouse). The effect is
// decorative and fades in, so a beat later is invisible.
const kick = () =>
  "requestIdleCallback" in window
    ? (window as any).requestIdleCallback(start, { timeout: 1500 })
    : setTimeout(start, 200);
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", kick);
} else {
  kick();
}
