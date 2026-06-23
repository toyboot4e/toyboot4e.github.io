// Build the shipped style assets into src/style/*.min.* (where the static copy in
// build.ts picks them up). Replaces the old Bun-based scripts/build-assets.ts:
//   1. CSS modules (src/styles/*.module.css) -> components.min.css, scoped via the
//      SAME vite.config.ts `generateScopedName` the render uses, so the class
//      names match. Built with Vite's programmatic API (write:false, in-memory).
//   2. style/prism CSS -> *.min.css (esbuild minify, url()/data: kept verbatim).
//   3. disco.ts / toc.ts -> *.min.js (esbuild bundle + minify for the browser).
import { build as viteBuild } from "vite";
import * as esbuild from "esbuild";
import { writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url)); // builder/src
const ROOT = join(HERE, "..", "..");
const STYLE = join(ROOT, "src", "style");
const VITE_CONFIG = join(HERE, "..", "vite.config.ts");
const log = (s: string) => console.log(`  -> ${s}`);

// 1. CSS modules -> components.min.css (reuse vite.config.ts so scoping matches).
const result = await viteBuild({
  configFile: VITE_CONFIG,
  logLevel: "error",
  build: {
    write: false,
    cssCodeSplit: false,
    cssMinify: true,
    rollupOptions: {
      input: join(HERE, "styles", "_all.ts"),
      output: { entryFileNames: "_all.js", assetFileNames: "[name][extname]" },
    },
  },
});
const output = (Array.isArray(result) ? result[0] : (result as any)).output;
const cssAsset = output.find((o: any) => o.type === "asset" && o.fileName.endsWith(".css"));
if (!cssAsset) throw new Error("assets: CSS-module build emitted no stylesheet");
// strip Vite's `/*$vite$:N*/` chunk marker
const css = String(cssAsset.source).replace(/\/\*\$vite\$:\d+\*\//g, "").trim() + "\n";
await writeFile(join(STYLE, "components.min.css"), css);
log(`components.min.css (${css.length} bytes)`);

// 2. Plain CSS -> *.min.css (minify only; keep every url()/data: URI as authored).
for (const f of ["style", "prism-dark", "prism-light"]) {
  const r = await esbuild.build({
    entryPoints: [join(STYLE, `${f}.css`)],
    minify: true,
    bundle: false,
    write: false,
  });
  await writeFile(join(STYLE, `${f}.min.css`), r.outputFiles[0].text);
  log(`${f}.min.css (${r.outputFiles[0].text.length} bytes)`);
}

// 3. Browser TS -> *.min.js (bundle + minify).
for (const f of ["disco", "toc"]) {
  const r = await esbuild.build({
    entryPoints: [join(STYLE, `${f}.ts`)],
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2020",
    write: false,
  });
  await writeFile(join(STYLE, `${f}.min.js`), r.outputFiles[0].text);
  log(`${f}.min.js (${r.outputFiles[0].text.length} bytes)`);
}
