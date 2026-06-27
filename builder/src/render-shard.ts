// One render shard: a child `vite-node` process that renders + bakes the .org
// files passed as argv and writes the finished HTML, then prints its metadata +
// bake stats as JSON on stdout for the orchestrator (build.ts) to collect. This
// is how the build parallelises: build.ts spawns one of these per CPU shard, so
// all cores render+bake at once (vite-node can't use worker threads, so we shard
// across processes instead). Paths come from OUT_DIR / the repo root, matching
// build.ts.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderAndBake } from "./render-bake.ts";
import { getStats } from "./bake.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "src");
const OUT = process.env.OUT_DIR ?? join(ROOT, "out");

// performance.now() here ~= time since this process started, i.e. the vite-node
// startup + transform + heavy imports (tree-sitter/uniorg). BUILD_PROF prints
// that "setup" cost vs the actual render time, to stderr (stdout carries JSON).
const tSetup = performance.now();
const files = process.argv.slice(2);
const results: { rel: string; isDiary: boolean; meta: unknown }[] = [];
const madeDirs = new Set<string>();
const tRender0 = performance.now();
for (const relOrg of files) {
  const text = await readFile(join(SRC, relOrg), "utf8");
  const r = await renderAndBake(relOrg, text);
  if (r.draft) continue; // release build: skip drafts
  const dest = join(OUT, r.rel);
  const dir = dirname(dest);
  if (!madeDirs.has(dir)) { await mkdir(dir, { recursive: true }); madeDirs.add(dir); }
  await writeFile(dest, r.out);
  results.push({ rel: r.rel, isDiary: r.isDiary, meta: r.meta });
}
if (process.env.BUILD_PROF) {
  console.error(`  [shard] setup=${Math.round(tSetup)}ms render=${Math.round(performance.now() - tRender0)}ms (${files.length} files)`);
}
process.stdout.write(JSON.stringify({ results, stats: getStats() }));
