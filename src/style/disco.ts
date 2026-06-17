// Homepage disco ball — a fixed, full-viewport WebGL background effect.
//
// Authored in TypeScript and bundled+minified to `disco.min.js` by
// `scripts/build-js.sh` (esbuild), mirroring how `*.min.css` is produced from
// hand-written CSS. The `.ts` source is NOT copied into `out/` (the org-publish
// "static" component only matches `.js`/`.css`/… by extension); only the
// compiled `disco.min.js` ships.
//
// Design (see docs/adr/0003-homepage-disco-ball-webgl.md and CONTEXT.md):
//   - Homepage only, gated by `has-disco` in build.el (a `<canvas id="disco-canvas">`
//     and this script are emitted only on index.html).
//   - Raw WebGL, one full-screen raymarched fragment shader — no framework.
//   - DARK THEME ONLY for v1. The render loop runs only while the *effective*
//     theme is dark, and starts/stops live as the user toggles the theme.
//     A clearly-marked light branch is stubbed for later.
//   - A faceted mirror sphere (the hero) plus a cast glint-field (the gorgeous
//     background), composed to keep the centre reading column dark.
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

varying vec2 v_uv;

// ============================================================
//  TUNABLE PALETTE  — re-grade the whole effect from here.
//  (Author note: warm gold key + cool counter-light + a colour
//   "pop"; bump POP / add lights for a more rainbow disco.)
// ============================================================
const vec3 KEY  = vec3(1.00, 0.72, 0.34);   // warm gold key light
const vec3 COOL = vec3(0.28, 0.52, 0.95);   // cool steel-blue counter-light
const vec3 POP  = vec3(0.92, 0.32, 0.70);   // magenta pop (the "bit more colour")
const vec3 ROOM = vec3(0.020, 0.022, 0.038); // near-black room

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
  vec3 c = ROOM;
  c += KEY  * pow(max(dot(d, normalize(vec3( 0.55, 0.55, 0.45))), 0.0), 48.0) * 3.2;
  c += COOL * pow(max(dot(d, normalize(vec3(-0.70, 0.25, 0.55))), 0.0), 70.0) * 2.2;
  c += POP  * pow(max(dot(d, normalize(vec3( 0.15,-0.55, 0.62))), 0.0), 80.0) * 1.7;
  c += KEY  * 0.035 * (0.5 + 0.5 * d.y);   // faint warm ambient gradient
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

void main(){
  // y-normalised, centre-origin coords (aspect-correct).
  vec2 p = (gl_FragCoord.xy * 2.0 - u_res) / u_res.y;

  // Reading-column mask: 0 in the central column (kept dark), 1 in the margins.
  float colMask = smoothstep(0.16, 0.46, abs(v_uv.x - 0.5));

  // --- background cast glint-field (margins only) ---
  vec3 bg = castDots(v_uv, u_time) * colMask;

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

    // Cool fresnel rim + a floor so unlit facets aren't pure black.
    col += COOL * pow(1.0 - max(n.z, 0.0), 3.0) * 0.35;
    col += ROOM * 3.5;

    // Dim the ball where it crosses the reading column, full in the margins.
    ball = col * mix(0.42, 1.0, colMask);
  }

  // Soft warm halo bleeding off the ball into the background.
  bg += KEY * 0.10 * smoothstep(R * 1.9, R, sqrt(r2)) * colMask;

  vec3 col = mix(bg, ball, mask);

  // Vignette → push brightness to the edges, darken the centre/bottom.
  float vig = smoothstep(1.7, 0.25, length(p * vec2(0.85, 1.0)));
  col *= mix(0.55, 1.0, vig);

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

function effectiveDark(): boolean {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark") return true;
  if (attr === "light") return false;
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

function start(): void {
  const canvas = document.getElementById("disco-canvas") as HTMLCanvasElement | null;
  if (!canvas) return;

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
    // Graceful no-WebGL skip: drop the element, leave the plain dark homepage.
    canvas.remove();
    return;
  }

  let prog = link(gl);
  if (!prog) {
    canvas.remove();
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

  // Quality tier: cheaper internal resolution, cheaper still on touch devices.
  const coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  const maxDpr = coarse ? 1.0 : 1.5;
  const resScale = coarse ? 0.7 : 1.0;

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr) * resScale;
    const w = Math.max(1, Math.round(canvas!.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas!.clientHeight * dpr));
    if (canvas!.width !== w || canvas!.height !== h) {
      canvas!.width = w;
      canvas!.height = h;
    }
    gl!.viewport(0, 0, w, h);
  }

  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
  let raf = 0;
  let running = false;
  let t0 = 0;
  let started = false; // first frame drawn (for fade-in)
  let enabled = discoPref(); // user on/off preference (the disco-toggle button)

  function frame(now: number): void {
    if (!running) return;
    if (!t0) t0 = now;
    resize();
    gl!.uniform2f(uRes, canvas!.width, canvas!.height);
    gl!.uniform1f(uTime, (now - t0) / 1000);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    if (!started) {
      started = true;
      canvas!.style.opacity = "1";
    }
    raf = window.requestAnimationFrame(frame);
  }

  function drawStill(): void {
    // prefers-reduced-motion: a single, frozen (still gorgeous) frame.
    resize();
    gl!.uniform2f(uRes, canvas!.width, canvas!.height);
    gl!.uniform1f(uTime, 9.0);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    canvas!.style.opacity = "1";
  }

  function run(): void {
    if (running) return;
    if (reduce && reduce.matches) {
      drawStill();
      return;
    }
    running = true;
    t0 = 0;
    raf = window.requestAnimationFrame(frame);
  }

  function stop(): void {
    running = false;
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
  }

  // Render while the effective theme is dark AND the user hasn't switched it off;
  // pause when the tab is hidden. The `disco-on` class marks "the ball is the
  // active background" (independent of pause) so CSS can make content translucent
  // to reveal it.
  function sync(): void {
    const active = effectiveDark() && enabled;
    document.documentElement.classList.toggle("disco-on", active);
    if (active && !document.hidden) {
      run();
    } else {
      stop();
      canvas!.style.opacity = "0";
      started = false;
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
    sync();
  };

  // React to: theme toggle (data-theme mutation), OS theme change, tab
  // visibility, reduced-motion change, and viewport resize.
  new MutationObserver(sync).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  if (window.matchMedia) {
    const mqDark = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => sync();
    mqDark.addEventListener ? mqDark.addEventListener("change", onChange) : mqDark.addListener(onChange);
    if (reduce) {
      const onReduce = () => {
        stop();
        sync();
      };
      reduce.addEventListener ? reduce.addEventListener("change", onReduce) : reduce.addListener(onReduce);
    }
  }
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("resize", () => {
    if (running) resize();
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

  sync();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
