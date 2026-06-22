// Minify the hand-written CSS and bundle+minify the hand-written TypeScript in
// src/style/ into the *.min.css / *.min.js that ship. Replaces the old
// scripts/min-css.sh + scripts/build-js.sh esbuild pair: Bun is already a build
// dependency (it runs the render+bake and fetch-linkcards.ts), and its bundler
// minifies both CSS and TS offline — so esbuild is no longer needed anywhere.
//
// Run via `bun scripts/build-assets.ts` (by `just assets`, itself run by
// `just build`). Works in the hermetic nix sandbox: no network, no /usr/bin/env.
// The generated *.min.* are git-ignored — the build owns them; build.ts's static
// copy step ships them into out/style/ by extension.
//
// CSS is minified in place (`external: ["*"]`): Bun's bundler would otherwise try
// to resolve url(...) assets, but the font/data URIs must ship as written. JS is
// bundled then minified. Bun's CSS parser is stricter than esbuild's and fails
// the build on invalid CSS (e.g. `var(foo)` missing the `--` prefix) — a feature.

import { basename } from "node:path";

const STYLE_DIR = "src/style";
const CSS = ["style", "prism-dark", "prism-light"];
const TS = ["disco"];

async function report(result: Awaited<ReturnType<typeof Bun.build>>) {
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  for (const out of result.outputs) {
    const bytes = (await Bun.file(out.path).arrayBuffer()).byteLength;
    console.log(`  -> ${basename(out.path)} (${bytes} bytes)`);
  }
}

// CSS: minify only — keep every url(...) / data: URI exactly as authored.
await report(
  await Bun.build({
    entrypoints: CSS.map((f) => `${STYLE_DIR}/${f}.css`),
    outdir: STYLE_DIR,
    naming: "[name].min.[ext]",
    minify: true,
    external: ["*"],
  }),
);

// TS: bundle + minify for the browser.
await report(
  await Bun.build({
    entrypoints: TS.map((f) => `${STYLE_DIR}/${f}.ts`),
    outdir: STYLE_DIR,
    naming: "[name].min.[ext]",
    minify: true,
    target: "browser",
  }),
);

// CSS modules (build/styles/*.module.css): Bun scopes the class names and emits
// (1) the scoped CSS -> src/style/components.min.css (static-copied to out/ and
// linked on the pages) and (2) the class-name maps -> build/styles/generated.js
// (imported by render.tsx). Kept separate from the global style.css so the
// entangled disco/theme rules there are untouched. Both are git-ignored, owned
// by this step. Outputs are in-memory (no outdir) so the two artifacts can go to
// different paths.
const mods = await Bun.build({ entrypoints: ["build/styles/index.ts"], minify: true });
if (!mods.success) {
  for (const log of mods.logs) console.error(log);
  process.exit(1);
}
for (const out of mods.outputs) {
  const text = await out.text();
  const dest = out.path.endsWith(".css") ? `${STYLE_DIR}/components.min.css` : "build/styles/generated.js";
  await Bun.write(dest, text);
  console.log(`  -> ${dest} (${text.length} bytes)`);
}
