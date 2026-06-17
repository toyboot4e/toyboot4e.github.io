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

- **Site-wide.** Emitted on every page via `my-disco-page-p` (the `<canvas>`,
  `disco.min.js`, and toggle button). It shipped homepage-only first (to keep
  articles lean), then opened up site-wide once it was wanted everywhere; the
  per-page cost is bounded by the GPU gate, the persisted off-toggle, and the
  reduced-motion/visibility guards.
- **Both themes, one shader.** The effective theme drives a `u_light` uniform that
  selects the palette (dark/`*_L` light variants) and, on light, takes the
  ball-only (alpha) path so the bright page shows behind the ball rather than a
  dark room filling the viewport. The theme is re-applied live on toggle. Dark
  shipped first (it's the easier "beautiful"); light reuses all the plumbing — a
  chrome (dark-base, bright-glint) ball with a contact shadow, plus a tinted
  translucent cast-light field (colour dapples composited premultiplied over the
  page, not bright specks).
- **Readability by composition.** The canvas is `position: fixed; z-index: -1`
  behind content; brightness is pushed into the margins and title while the
  centre reading column is kept dark by a shader mask — so no per-card backdrop
  / `backdrop-filter` is needed and existing card styling is untouched.

## Build integration

Client TypeScript needs a transpile step (nothing compiled client JS before).
`src/style/disco.ts` is bundled+minified to `src/style/disco.min.js` by
`scripts/build-assets.ts`, the same Bun step that minifies the hand-written CSS
into `*.min.css`. Bun is already a build dependency (it runs the post-process and
link-card scripts) and bundles offline, so this adds no new tooling and stays
hermetic. The org-publish "static" component copies `disco.min.js` (matched by
extension) into `out/`; the `.ts` source is not matched and does not ship. The
generated `*.min.{css,js}` are git-ignored — the build regenerates them.

## Consequences

- The shader is art that needs visual tuning; palette and placement live in a
  clearly-marked `TUNABLE PALETTE` / constants block at the top of the shader.
- Guards ship with it: a 30fps cap; pause when the tab is hidden; reduced internal
  resolution (capped DPR; lower tier on coarse-pointer devices); graceful
  no-WebGL skip; and context-loss handling.
- **Only runs with a real GPU.** Software renderers (SwiftShader / llvmpipe /
  Mesa software / Microsoft Basic Render, via `WEBGL_debug_renderer_info`) are
  dropped outright — a full-screen shader on a CPU rasteriser is far too heavy and
  tanks Interaction-to-Next-Paint when the page compositor is software too. Those
  visitors get the plain dark homepage.
- **Static fallback** for a real-but-weak GPU (an adaptive frame-time governor
  steps the resolution down, then freezes) and for `prefers-reduced-motion`: the
  ball is drawn once (ball-only, transparent surround) and a compositor-cheap CSS
  layer (`.disco-bg-light`, transform/opacity only) supplies the drifting light.
- INP care: the theme/disco toggles defer the heavy WebGL redraw off the click's
  critical path, and the theme toggle skips its View Transition on the disco page
  (it would snapshot the full-screen canvas).
