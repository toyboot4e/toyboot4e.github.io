#!/usr/bin/env bun
// The build: `.org` sources -> static site, with uniorg (a JS org-mode parser)
// + bun, no Emacs. This is what `just build` runs and what nix/CI ship.
//
// Two things make it fast:
//
//   1. Merge: each article is rendered AND baked (Prism + KaTeX + link cards)
//      in one pass -- no intermediate write-then-re-parse. Render lives in
//      `build/render.tsx`, the bake engine in `build/bake.ts`.
//   2. Parallel: articles are sharded across worker threads (one isolate each),
//      so all cores render+bake at once. The orchestrator only assembles the
//      index + tag pages from the returned metadata.
//
// Writes to `out/` by default (set OUT_DIR to target another dir). Opt-in
// `BUILD_PROF=1` prints phase/worker timings; `BUILD_WORKERS=N` overrides the
// worker count.
//
// Coverage note: paragraphs/headings/lists/tables/links/emphasis/code come from
// uniorg; the custom bits (DETAILS/YARUO/STENO blocks, [[card:]] links, .org->
// .html links, heading demotion, page chrome, index + tag pages) live in
// scripts/render.ts. Coderef callouts inside src-blocks are the least faithful.
import { Worker } from "node:worker_threads";
import { readdir, mkdir, writeFile, rm, cp } from "node:fs/promises";
import { join, dirname } from "node:path";
import { cpus } from "node:os";
import { buildIndexHtml, buildTagHtml, type Meta } from "./build/render.tsx";
// Only the light helpers here -- the main thread never highlights, so it must
// not import bake.ts (that triggers the heavy Prism/happy-dom setup). The
// workers own the bake; the index/tag pages carry no code/math/cards and are
// written as-is.
import { copyKatexAssets, mergeStats, stamp, type BakeStats } from "./build/bake-util.ts";

export const SRC = "src";
export const OUT = process.env.OUT_DIR ?? "out";
export const STRICT = process.argv.includes("--strict") || !!process.env.CI;
// Each worker is a fresh isolate that re-runs the Prism/happy-dom/uniorg setup
// (~250ms), so more workers is not always faster: past ~6 the fixed per-isolate
// setup outweighs the shrinking per-shard work (empirically flat 3-6, worse at
// 8+ on a 20-core box). Cap accordingly; override with BUILD_WORKERS.
const WORKERS = Math.max(1, Number(process.env.BUILD_WORKERS) || Math.min(cpus().length, 6));

export type WorkerOut = { results: { rel: string; isDiary: boolean; meta: Meta }[]; stats: BakeStats };

// List .org sources relative to SRC, skipping generated tag pages and index.org.
// `src/tags/` holds generated tag pages (we regenerate our own below), so skip
// the whole `tags/` subtree here.
export async function listOrg(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "tags") continue;
      out.push(...(await listOrg(p, base)));
    } else if (e.name.endsWith(".org") && e.name !== "index.org") {
      out.push(p.slice(base.length + 1)); // relative to SRC
    }
  }
  return out;
}

// Static files copied verbatim: these extensions, recursive, excluding `ltximg/`
// (local LaTeX previews). Catches loose files like `og-preview.html` plus the
// `style/` and `img/` trees, while skipping `.org` sources and `.drawio`/`.ts`
// diagram/source files.
export const STATIC_RE = /\.(html|js|css|png|jpe?g|webp|gif|svg|mp4|mov|woff2|pdf)$/i;

export async function listStatic(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === "ltximg") continue; // local LaTeX previews (not shipped)
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listStatic(p, base)));
    else if (STATIC_RE.test(e.name)) out.push(p.slice(base.length + 1));
  }
  return out;
}

// Copy static files into OUT. Rendered pages win on the (currently nonexistent)
// name collision -- `cp` here runs concurrently with the workers, so skip any
// dest a worker already wrote.
export async function copyStatic(): Promise<number> {
  const rels = await listStatic(SRC);
  await Promise.all(
    rels.map(async (rel) => {
      const dest = join(OUT, rel);
      await mkdir(dirname(dest), { recursive: true });
      await cp(join(SRC, rel), dest, { force: false, errorOnExist: false }).catch(() => {});
    }),
  );
  return rels.length;
}

const PROF = !!process.env.BUILD_PROF;
function runWorker(files: string[]): Promise<WorkerOut> {
  return new Promise((resolve, reject) => {
    const spawn = performance.now();
    const w = new Worker(new URL("./build/render-worker.ts", import.meta.url), {
      workerData: { files, srcDir: SRC, outDir: OUT },
    });
    w.once("message", (m: WorkerOut & { prof?: any }) => {
      if (PROF && m.prof) {
        const wall = Math.round(performance.now() - spawn);
        console.error(`  [worker] wall=${wall}ms setup≈${wall - m.prof.workMs}ms work=${m.prof.workMs}ms (render=${m.prof.renderMs} bake=${m.prof.bakeMs} io=${m.prof.ioMs}) n=${m.prof.n}`);
      }
      resolve(m); w.terminate();
    });
    w.once("error", reject);
  });
}

// Write one finished page: stamp (postprocess idempotency) + write. Used for the
// index + tag pages, which carry no code/math/cards and skip the bake entirely.
export async function writePage(rel: string, html: string): Promise<void> {
  const dest = join(OUT, rel);
  await mkdir(join(dest, ".."), { recursive: true });
  await writeFile(dest, stamp(html));
}

// (Re)generate index.html + every tag page from the article metadata. The watch
// daemon calls this whenever an article's metadata (title/date/tags) changes.
export async function writeIndexAndTags(metas: Meta[], diaryMetas: Meta[], allTags: string[]): Promise<void> {
  await writePage("index.html", buildIndexHtml(metas, diaryMetas, allTags));
  await Promise.all(
    allTags.map((tag) =>
      writePage(`tags/${tag}.html`, buildTagHtml(tag, metas.filter((m) => m.tags.includes(tag)), allTags)),
    ),
  );
}

export type FullBuild = {
  outs: WorkerOut[]; metas: Meta[]; diaryMetas: Meta[]; allTags: string[];
  stats: BakeStats; nStatic: number; nWorkers: number;
};

// The whole site build: clean OUT, render+bake every article across workers
// (concurrently with the static + KaTeX copies), then assemble the index + tag
// pages. Returns the per-article worker results (so a caller can seed a metadata
// cache -- the watch daemon does) plus aggregated metadata and bake stats.
export async function fullBuild(): Promise<FullBuild> {
  const t0 = performance.now();
  const lap = (l: string) => { if (PROF) console.error(`  [phase] ${l}: ${Math.round(performance.now() - t0)}ms`); };
  // Wipe OUT's contents (drop stale output) but keep the dir and its tracked
  // `.gitkeep`, so building the default `out/` doesn't churn git every run.
  await mkdir(OUT, { recursive: true });
  await Promise.all(
    (await readdir(OUT))
      .filter((e) => e !== ".gitkeep")
      .map((e) => rm(join(OUT, e), { recursive: true, force: true })),
  );
  lap("clean OUT");

  const files = await listOrg(SRC);
  lap("listOrg");
  // Round-robin sharding. Tried LPT balancing by source byte size, but it was
  // consistently slower than round-robin: byte size badly mis-estimates the real
  // render+bake cost (a code-dense 16KB article out-costs a 60KB prose diary),
  // and the upfront stat() pass delays worker spawn. Files come out of listOrg
  // in directory order (roughly chronological), so round-robin already
  // interleaves big/small and code-heavy/prose well enough.
  const nWorkers = Math.min(WORKERS, files.length) || 1;
  const shards: string[][] = Array.from({ length: nWorkers }, () => []);
  files.forEach((f, i) => shards[i % nWorkers].push(f));

  // Workers (render+bake) and the static/KaTeX copies are independent -- run
  // them together so the image/asset I/O overlaps the CPU-bound rendering.
  const [outs, nStatic] = await Promise.all([
    Promise.all(shards.map(runWorker)),
    copyStatic(),
    copyKatexAssets(OUT),
  ]);
  lap("workers+static+katex");

  const metas: Meta[] = [];       // devlog (src/*.org)
  const diaryMetas: Meta[] = [];  // diary (src/diary/*.org)
  for (const o of outs) {
    for (const r of o.results) (r.isDiary ? diaryMetas : metas).push(r.meta);
  }

  // sort newest-first by href (dates lead the filenames)
  const byHrefDesc = (a: Meta, b: Meta) => (a.href < b.href ? 1 : -1);
  metas.sort(byHrefDesc);
  diaryMetas.sort(byHrefDesc);
  // tags come from devlog entries only (not diary entries)
  const allTags = [...new Set(metas.flatMap((m) => m.tags))].sort();

  await writeIndexAndTags(metas, diaryMetas, allTags);
  lap("index+tags");

  return { outs, metas, diaryMetas, allTags, stats: mergeStats(outs.map((o) => o.stats)), nStatic, nWorkers };
}

async function main() {
  const t0 = performance.now();
  const { metas, diaryMetas, allTags, stats: s, nStatic, nWorkers } = await fullBuild();
  const ms = Math.round(performance.now() - t0);
  console.log(
    `build.ts: ${metas.length} articles + ${diaryMetas.length} diary + index + ${allTags.length} tags ` +
    `+ ${nStatic} static via ${nWorkers} workers -> ${OUT}/ in ${ms}ms`,
  );
  console.log(
    `  bake: code ${s.nPlain} fast + ${s.nDom} dom, ${s.nUnknown} unknown, ${s.nHlError} failed | ` +
    `math ${s.nMath} | cards ${s.nCards} baked, ${s.nCardMiss} missing`,
  );

  if (STRICT && (s.nMathError > 0 || s.nUnknown > 0 || s.nCardMiss > 0)) {
    console.error(
      `build.ts: FAILED (strict) -- ${s.nMathError} math error(s), ` +
      `${s.nUnknown} unknown language(s)${s.unknownLangs.length ? `: ${s.unknownLangs.join(", ")}` : ""}` +
      `, ${s.nCardMiss} uncached link card(s)${s.missingCards.length ? `: ${s.missingCards.join(", ")}` : ""}`,
    );
    process.exit(1);
  }
}

// Only run the CLI build when invoked directly (`bun build.ts`); when imported
// (e.g. by watch.ts) just expose fullBuild + helpers without building.
if (import.meta.main) await main();
