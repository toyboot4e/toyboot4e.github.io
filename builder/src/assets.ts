// Build the shipped style assets into src/style/*.min.* (where the static copy in
// build.ts picks them up). Replaces the old Bun-based scripts/build-assets.ts:
//   1. CSS modules (src/styles/*.module.css) -> components.min.css, scoped via the
//      SAME vite.config.ts `generateScopedName` the render uses, so the class
//      names match. Built with Vite's programmatic API (write:false, in-memory).
//   2. plain style CSS -> *.min.css (esbuild minify, url()/data: kept verbatim).
//   3. style.ts / disco.ts / toc.ts / nav.ts -> *.min.js (esbuild bundle + minify for the browser).
import { build as viteBuild } from "vite";
import { build as esbuild } from "esbuild";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

// This module runs from builder/src (bun / vite-node) OR builder/dist (bundled), both
// one level under builder/, so anchor everything to builder/ and the repo root.
const BUILDER = join(import.meta.dirname, "..");
const ROOT = join(BUILDER, "..");
const STYLE = join(ROOT, "src", "style");
const VITE_CONFIG = join(BUILDER, "vite.config.ts");
const ALL_CSS_ENTRY = join(BUILDER, "src", "styles", "_all.ts");

// Build all the shipped style assets. Imported + awaited by the build
// orchestrator (build.ts, overlapped with the render) and runnable standalone
// via `just assets` (the CLI guard below).
const log = (s: string): void => {
  console.log(`  -> ${s}`);
};

const writeAsset = async (name: string, text: string): Promise<void> => {
  await writeFile(join(STYLE, name), text);
  log(`${name} (${text.length} bytes)`);
};

const esbuildText = async (opts: Parameters<typeof esbuild>[0]): Promise<string> => {
  const r = await esbuild({ ...opts, write: false });
  const [file] = r.outputFiles;
  if (!file) {
    throw new Error("assets: esbuild emitted no output");
  }
  return file.text;
};

export async function buildAssets(): Promise<void> {
  // 1. CSS modules -> components.min.css (reuse vite.config.ts so scoping matches).
  const result = await viteBuild({
    configFile: VITE_CONFIG,
    logLevel: "error",
    build: {
      write: false,
      cssCodeSplit: false,
      cssMinify: true,
      rolldownOptions: {
        input: ALL_CSS_ENTRY,
        output: { entryFileNames: "_all.js", assetFileNames: "[name][extname]" },
      },
    },
  });
  const out = Array.isArray(result) ? result[0] : result;
  const cssAsset =
    out !== undefined && "output" in out
      ? out.output.find((o) => o.type === "asset" && o.fileName.endsWith(".css"))
      : undefined;
  if (cssAsset?.type !== "asset") {
    throw new Error("assets: CSS-module build emitted no stylesheet");
  }
  const source = typeof cssAsset.source === "string" ? cssAsset.source : new TextDecoder().decode(cssAsset.source);
  // strip Vite's `/*$vite$:N*/` chunk marker
  await writeAsset("components.min.css", `${source.replaceAll(/\/\*\$vite\$:\d+\*\//gu, "").trim()}\n`);

  await Promise.all([
    // 2. Plain CSS -> *.min.css (minify only; keep every url()/data: URI as authored).
    ...["style"].map(async (f) =>
      writeAsset(
        `${f}.min.css`,
        await esbuildText({ entryPoints: [join(STYLE, `${f}.css`)], minify: true, bundle: false }),
      ),
    ),
    // 3. Browser TS -> *.min.js (bundle + minify).
    ...["style", "disco", "toc", "nav"].map(async (f) =>
      writeAsset(
        `${f}.min.js`,
        await esbuildText({
          entryPoints: [join(STYLE, `${f}.ts`)],
          bundle: true,
          minify: true,
          // classic scripts share one global scope: wrap each so minified
          // top-level names can't collide across them
          format: "iife",
          target: "es2020",
        }),
      ),
    ),
  ]);
}

// Run standalone for `just assets` and the watch daemon's incremental rebuild
// (both set ASSETS_CLI=1). The build orchestrator imports buildAssets() instead
// and runs it overlapped with the render -- once bundled into dist/main.js this
// module has no entry of its own, so an env flag is the reliable way to tell the two apart.
if (process.env.ASSETS_CLI !== undefined) {
  await buildAssets();
}
