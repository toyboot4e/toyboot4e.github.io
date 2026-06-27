// The build: `.org` sources -> static site, with uniorg (a JS org-mode parser).
// Run via Vite (`vite-node src/main.ts`), so `render.tsx` can import its
// `.module.css` files directly (Vite resolves the scoped class maps).
//
// Each article is rendered AND baked (tree-sitter + KaTeX + link cards) in one
// pass -- no intermediate write-then-re-parse. Render lives in `render.tsx`, the
// bake engine in `bake.ts`. Rendering is single-threaded (the per-file work shares
// one warm tree-sitter/uniorg setup), overlapped with the static + KaTeX copies.
//
// Paths are resolved relative to the repo root (this file's ../..), so the build
// is cwd-independent. Writes to `out/` by default (set OUT_DIR to override).
import { readdir, mkdir, writeFile, rm, cp } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { buildIndexHtml, buildTagHtml, type Meta } from "./render.tsx";
// Light helpers only -- the orchestrator must NOT import bake.ts (its tree-sitter
// grammar-loading setup is heavy); the render shards own the bake.
import { copyKatexAssets, mergeStats, stamp, type BakeStats } from "./bake-util.ts";
import { buildAssets } from "./assets.ts";

// builder/src/build.ts -> repo root; HERE is builder/src
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
export const SRC = join(ROOT, "src");
export const OUT = process.env.OUT_DIR ?? join(ROOT, "out");
export const STRICT = process.argv.includes("--strict") || !!process.env.CI;
// Render is sharded across this many parallel `vite-node` child processes (one
// warm tree-sitter/uniorg setup each). Past ~6 the per-process startup
// outweighs the shrinking per-shard work; override with BUILD_WORKERS.
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
// name collision -- this runs concurrently with the render, so skip any dest the
// render already wrote.
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

// Render+bake one shard in a child `bun` process running the bundled
// dist/render-shard.js (plain JS -- no per-process Vite boot), which writes the
// pages and prints its metadata + stats as JSON on stdout. Sharding across child
// processes is how we parallelise. `HERE` is dist/ at runtime (this file is
// bundled to dist/main.js), so the sibling render-shard.js is right here.
function runShard(files: string[]): Promise<WorkerOut> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", [join(HERE, "render-shard.js"), ...files], {
      cwd: join(HERE, ".."), // builder/, for node_modules resolution
      env: { ...process.env, OUT_DIR: OUT },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let buf = "";
    child.stdout!.on("data", (d) => (buf += d));
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve(JSON.parse(buf)) : reject(new Error(`render shard failed (exit ${code})`)),
    );
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
  stats: BakeStats; nStatic: number;
};

// The whole site build: clean OUT, render+bake every article (concurrently with
// the static + KaTeX copies), then assemble the index + tag pages.
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

  // Round-robin the sources across shards (interleaves big/small, code-heavy/
  // prose), then render each shard in a parallel child process. The static +
  // KaTeX copies run alongside so their I/O overlaps the CPU-bound rendering.
  const nShards = Math.min(WORKERS, files.length) || 1;
  const shards: string[][] = Array.from({ length: nShards }, () => []);
  files.forEach((f, i) => shards[i % nShards].push(f));
  // buildAssets() runs concurrently with the render (the shards don't need its
  // output); copyStatic waits for it, since it ships the freshly built *.min.*.
  const [outs, nStatic] = await Promise.all([
    Promise.all(shards.map(runShard)),
    buildAssets().then(() => copyStatic()),
    copyKatexAssets(OUT),
  ]);
  lap("render+assets+static+katex");

  const metas: Meta[] = [];       // devlog (src/*.org)
  const diaryMetas: Meta[] = [];  // diary (src/diary/*.org)
  for (const o of outs) for (const r of o.results) (r.isDiary ? diaryMetas : metas).push(r.meta);

  // sort newest-first by href (dates lead the filenames)
  const byHrefDesc = (a: Meta, b: Meta) => (a.href < b.href ? 1 : -1);
  metas.sort(byHrefDesc);
  diaryMetas.sort(byHrefDesc);
  // tags come from devlog entries only (not diary entries)
  const allTags = [...new Set(metas.flatMap((m) => m.tags))].sort();

  await writeIndexAndTags(metas, diaryMetas, allTags);
  lap("index+tags");

  return { outs, metas, diaryMetas, allTags, stats: mergeStats(outs.map((o) => o.stats)), nStatic };
}
