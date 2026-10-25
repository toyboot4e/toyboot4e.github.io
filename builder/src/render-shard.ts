// One render shard: a child `bun dist/render-shard.js` process that renders + bakes the .org
// files passed as argv and writes the finished HTML, then prints its metadata +
// bake stats as JSON on stdout for the orchestrator (build.ts) to collect. This
// is how the build parallelises: build.ts spawns one of these per CPU shard, so
// all cores render+bake at once. Paths come from OUT_DIR / the repo root, matching
// build.ts.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { renderAndBake } from "./render-bake.ts";
import { getStats } from "./bake.ts";
import { counterpartOf, isPublished } from "./lang.ts";
import type { ShardResult } from "./build.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const SRC = join(ROOT, "src");
const OUT = process.env.OUT_DIR ?? join(ROOT, "out");

// performance.now() here ~= time since this process started, i.e. the bun
// startup + heavy imports (tree-sitter/uniorg). BUILD_PROF prints
// that "setup" cost vs the actual render time, to stderr (stdout carries JSON).
const tSetup = performance.now();
const files = process.argv.slice(2);
const results: ShardResult[] = [];
const madeDirs = new Set<string>();
const tRender0 = performance.now();
const texts = await Promise.all(files.map(async (relOrg) => readFile(join(SRC, relOrg), "utf8")));
const writes: Promise<void>[] = [];
for (const [i, relOrg] of files.entries()) {
  // oxlint-disable-next-line eslint/no-await-in-loop -- one warm tree-sitter/KaTeX setup, rendered one at a time
  const r = await renderAndBake(relOrg, texts[i] ?? "", {
    counterpart: isPublished(SRC, counterpartOf(relOrg)),
    src: SRC,
  });
  // release build: skip drafts
  if (r.draft) {
    continue;
  }
  for (const page of r.pages) {
    const dest = join(OUT, page.rel);
    const dir = dirname(dest);
    if (!madeDirs.has(dir)) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the dir must exist before the write below is queued
      await mkdir(dir, { recursive: true });
      madeDirs.add(dir);
    }
    writes.push(writeFile(dest, page.out));
  }
  results.push({ rel: r.rel, lang: r.lang, isDiary: r.isDiary, meta: r.meta });
}
await Promise.all(writes);
if (process.env.BUILD_PROF !== undefined) {
  console.error(
    `  [shard] setup=${Math.round(tSetup)}ms render=${Math.round(performance.now() - tRender0)}ms (${files.length} files)`,
  );
}
process.stdout.write(JSON.stringify({ results, stats: getStats() }));
