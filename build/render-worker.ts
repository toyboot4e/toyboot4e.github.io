// Render worker: takes a shard of .org files, renders each to a full page,
// bakes it (Prism + KaTeX + cards) in-process, and writes the finished HTML --
// no separate postprocess pass, no disk round-trip for re-parsing. Reports the
// article metadata (for the orchestrator's index / tag pages) and its bake stats
// back to the main thread.
//
// One isolate per worker, so the Prism/happy-dom globals set up in bake.ts and
// the uniorg pipeline in render.ts stay isolated and parallel-safe.
import { parentPort, workerData } from "node:worker_threads";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { type Meta } from "./render.ts";
import { getStats } from "./bake.ts";
import { renderAndBake } from "./render-bake.ts";

type In = { files: string[]; srcDir: string; outDir: string };
type OutMeta = { rel: string; isDiary: boolean; meta: Meta };

const { files, srcDir, outDir } = workerData as In;

const PROF = !!process.env.BUILD_PROF;
const tWork = performance.now();
let tRender = 0, tBake = 0, tIo = 0;

// Most articles share one of a couple of output dirs (OUT root, OUT/diary);
// remember which we've created so we don't pay an mkdir syscall per file.
const madeDirs = new Set<string>();
async function ensureDir(d: string): Promise<void> {
  if (madeDirs.has(d)) return;
  await mkdir(d, { recursive: true });
  madeDirs.add(d);
}

const results: OutMeta[] = [];
for (const relOrg of files) {
  const a = performance.now();
  const text = await Bun.file(join(srcDir, relOrg)).text();
  const r = await renderAndBake(relOrg, text);
  tRender += performance.now() - a; // render+bake lumped (split lives in render-bake)
  if (r.draft) continue; // release build: skip drafts (no file, not indexed)
  const b = performance.now();
  const dest = join(outDir, r.rel);
  await ensureDir(dirname(dest));
  await writeFile(dest, r.out);
  tIo += performance.now() - b;
  results.push({ rel: r.rel, isDiary: r.isDiary, meta: r.meta });
}

const prof = PROF
  ? { n: files.length, workMs: Math.round(performance.now() - tWork), renderMs: Math.round(tRender), bakeMs: Math.round(tBake), ioMs: Math.round(tIo) }
  : undefined;
parentPort!.postMessage({ results, stats: getStats(), prof });
