# Homepage disco ball: hand-written WebGL, not a 3D framework

The homepage shows a large, slowly-rotating **faceted mirror sphere** with a
**cast glint-field** as a full-viewport background effect (see `CONTEXT.md`). We
implement it as **one hand-written WebGL fragment shader** (a single full-screen
raymarched pass in `src/style/disco.ts`), not with Three.js or any 3D library.

## Why

The site is deliberately hermetic and JS-light: client scripts are hand-written
vanilla, and every payload is gated by a `has-*` flag in `build.el` so a page
ships JS only when it needs it. Pulling in Three.js would put a ~150 KB runtime
framework — the first on the site — onto the homepage, and would have to be
vendored for the offline/nix build. A raw fragment shader is a single
self-contained file with **zero runtime dependency**, and raymarching is exactly
how you get a genuinely beautiful reflective, faceted ball with a procedural
environment. The cost is authoring difficulty, which is a one-time price.

## Scope decisions

- **Homepage only.** Emitted under a new `has-disco` gate (the `<canvas>` and
  `disco.min.js` appear only on `index.html`), consistent with `has-code` /
  `has-steno`. Article pages stay lean and battery-friendly.
- **Dark theme only (v1).** A disco ball is only beautiful against darkness; on a
  white reading page it looks cheap. The render loop runs only while the
  *effective* theme is dark and starts/stops live on theme toggle. A light branch
  is intentionally stubbed (palette in tunable GLSL consts, theme read in JS) so
  adding light later is tuning, not a rewrite.
- **Readability by composition.** The canvas is `position: fixed; z-index: -1`
  behind content; brightness is pushed into the margins and title while the
  centre reading column is kept dark by a shader mask — so no per-card backdrop
  / `backdrop-filter` is needed and existing card styling is untouched.

## Build integration

Client TypeScript needs a transpile step (nothing compiled client JS before).
`src/style/disco.ts` is bundled+minified to `src/style/disco.min.js` by
`scripts/build-js.sh` via **esbuild**, mirroring how `scripts/min-css.sh`
produces `*.min.css`. esbuild is already a vendored, offline build dependency, so
this adds no new tooling and stays hermetic. The org-publish "static" component
copies `disco.min.js` (matched by extension) into `out/`; the `.ts` source is not
matched and does not ship. The generated `*.min.js` is committed, like `*.min.css`.

## Consequences

- The shader is art that needs visual tuning; palette and placement live in a
  clearly-marked `TUNABLE PALETTE` / constants block at the top of the shader.
- Guards ship with it: pause when the tab is hidden, `prefers-reduced-motion` →
  one static frame, reduced internal resolution (capped DPR; lower tier on
  coarse-pointer devices), graceful no-WebGL skip, and context-loss handling.
