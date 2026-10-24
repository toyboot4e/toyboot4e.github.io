// The build: `.org` sources -> static site, with uniorg (a JS org-mode parser).
// Bundled by `vite build` (run as `bun dist/main.js`), so `render.tsx` can import
// its `.module.css` files directly (Vite resolves the scoped class maps).
//
// Each article is rendered AND baked (tree-sitter + KaTeX + link cards) in one
// pass -- no intermediate write-then-re-parse. Render lives in `render.tsx`, the
// bake engine in `bake.ts`. Rendering is single-threaded (the per-file work shares
// one warm tree-sitter/uniorg setup), overlapped with the static + KaTeX copies.
//
// Paths are resolved relative to the repo root (this file's ../..), so the build
// is cwd-independent. Writes to `out/` by default (set OUT_DIR to override).
import { readdir, mkdir, writeFile, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { buildIndexHtml, buildTagHtml, type Meta } from "./render.tsx";
// Light helpers only -- the orchestrator must NOT import bake.ts (its tree-sitter
// grammar-loading setup is heavy); the render shards own the bake.
import { copyKatexAssets, mergeStats, parseTrustedJson, stamp, type BakeStats } from "./bake-util.ts";
import { buildAssets } from "./assets.ts";

// builder/src/build.ts -> repo root; HERE is builder/src
const HERE = import.meta.dirname;
const ROOT = join(HERE, "..", "..");
export const SRC = join(ROOT, "src");
export const OUT = process.env.OUT_DIR ?? join(ROOT, "out");
export const STRICT = process.argv.includes("--strict") || Boolean(process.env.CI);
// Render is sharded across this many parallel `bun dist/render-shard.js` child processes (one
// warm tree-sitter/uniorg setup each). Past ~6 the per-process startup
// outweighs the shrinking per-shard work; override with BUILD_WORKERS.
const WORKERS = Math.max(1, Number(process.env.BUILD_WORKERS) || Math.min(cpus().length, 6));

// Render shards MUST run the Vite-built bundle (dist/render-shard.js): Vite
// resolves the `*.module.css` imports to their scoped class maps at build time.
// Running the .ts source directly (e.g. `bun src/render-shard.ts`) bypasses Vite,
// so those imports are undefined and every CSS-module class (ToC, cards, keyboard)
// silently vanishes. `HERE` is dist/ under `bun dist/main.js` but src/ under the
// vite-node watch daemon, so derive the shard path from ROOT, not HERE.
const BUILDER = join(ROOT, "builder");
const SHARD = join(BUILDER, "dist", "render-shard.js");

export type WorkerOut = { results: { rel: string; isDiary: boolean; meta: Meta }[]; stats: BakeStats };

// List .org sources relative to SRC, skipping generated tag pages and index.org.
// `src/tags/` holds generated tag pages (we regenerate our own below), so skip
// the whole `tags/` subtree here.
export async function listOrg(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const lists = await Promise.all(
    entries.map(async (e): Promise<string[]> => {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        return e.name === "tags" ? [] : listOrg(p, base);
      }
      // relative to SRC
      return e.name.endsWith(".org") && e.name !== "index.org" ? [p.slice(base.length + 1)] : [];
    }),
  );
  return lists.flat();
}

// Static files copied verbatim: these extensions, recursive, excluding `ltximg/`
// (local LaTeX previews). Catches loose files like `og-preview.html` plus the
// `style/` and `img/` trees, while skipping `.org` sources and `.drawio`/`.ts`
// diagram/source files.
export const STATIC_RE = /\.(html|js|css|png|jpe?g|webp|gif|svg|mp4|mov|woff2|pdf)$/iu;

export async function listStatic(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const lists = await Promise.all(
    entries.map(async (e): Promise<string[]> => {
      // local LaTeX previews (not shipped)
      if (e.name === "ltximg") {
        return [];
      }
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        return listStatic(p, base);
      }
      return STATIC_RE.test(e.name) ? [p.slice(base.length + 1)] : [];
    }),
  );
  return lists.flat();
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
      // force:false + errorOnExist:false already skips an existing dest
      await cp(join(SRC, rel), dest, { force: false, errorOnExist: false });
    }),
  );
  return rels.length;
}

const PROF = Boolean(process.env.BUILD_PROF);

// sort newest-first by href (dates lead the filenames)
export const byHrefDesc = (a: Meta, b: Meta): number => (a.href < b.href ? 1 : -1);

// Render+bake one shard in a child `bun` process running the bundled
// dist/render-shard.js (plain JS -- no per-process Vite boot), which writes the
// pages and prints its metadata + stats as JSON on stdout. Sharding across child
// processes is how we parallelise. The shard MUST be the Vite-built bundle (see
// SHARD) -- the raw .ts has unresolved CSS-module imports.
async function runShard(files: string[]): Promise<WorkerOut> {
  return new Promise((resolve, reject) => {
    if (!existsSync(SHARD)) {
      reject(
        new Error(
          `render shard bundle missing: ${SHARD}\n  run \`bunx vite build -c vite.build.config.ts\` (in builder/) first`,
        ),
      );
      return;
    }
    const child = spawn("bun", [SHARD, ...files], {
      cwd: BUILDER, // builder/, for node_modules resolution
      env: { ...process.env, OUT_DIR: OUT },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      buf += d;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve(parseTrustedJson<WorkerOut>(buf));
      } else {
        reject(new Error(`render shard failed (exit ${String(code)})`));
      }
    });
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
    allTags.map(async (tag) =>
      writePage(
        `tags/${tag}.html`,
        buildTagHtml(
          tag,
          metas.filter((m) => m.tags.includes(tag)),
          allTags,
        ),
      ),
    ),
  );
}

export type FullBuild = {
  outs: WorkerOut[];
  metas: Meta[];
  diaryMetas: Meta[];
  allTags: string[];
  stats: BakeStats;
  nStatic: number;
};

// The whole site build: clean OUT, render+bake every article (concurrently with
// the static + KaTeX copies), then assemble the index + tag pages.
export async function fullBuild(): Promise<FullBuild> {
  const t0 = performance.now();
  const lap = (l: string): void => {
    if (PROF) {
      console.error(`  [phase] ${l}: ${Math.round(performance.now() - t0)}ms`);
    }
  };
  // Wipe OUT's contents (drop stale output) but keep the dir and its tracked
  // `.gitkeep`, so building the default `out/` doesn't churn git every run.
  await mkdir(OUT, { recursive: true });
  const stale = await readdir(OUT);
  await Promise.all(
    stale.filter((e) => e !== ".gitkeep").map(async (e) => rm(join(OUT, e), { recursive: true, force: true })),
  );
  lap("clean OUT");

  const files = await listOrg(SRC);
  lap("listOrg");

  // Round-robin the sources across shards (interleaves big/small, code-heavy/
  // prose), then render each shard in a parallel child process. The static +
  // KaTeX copies run alongside so their I/O overlaps the CPU-bound rendering.
  const nShards = Math.min(WORKERS, files.length) || 1;
  const shards: string[][] = Array.from({ length: nShards }, (_, s) => files.filter((_f, i) => i % nShards === s));
  // buildAssets() runs concurrently with the render (the shards don't need its
  // output); copyStatic waits for it, since it ships the freshly built *.min.*.
  const [outs, nStatic] = await Promise.all([
    Promise.all(shards.map(async (s) => runShard(s))),
    buildAssets().then(async () => copyStatic()),
    copyKatexAssets(OUT),
  ]);
  lap("render+assets+static+katex");

  const metas: Meta[] = []; // devlog (src/*.org)
  const diaryMetas: Meta[] = []; // diary (src/diary/*.org)
  for (const o of outs) {
    for (const r of o.results) {
      (r.isDiary ? diaryMetas : metas).push(r.meta);
    }
  }

  metas.sort(byHrefDesc);
  diaryMetas.sort(byHrefDesc);
  // tags come from devlog entries only (not diary entries)
  const allTags = [...new Set(metas.flatMap((m) => m.tags))].toSorted();

  await writeIndexAndTags(metas, diaryMetas, allTags);
  lap("index+tags");

  return { outs, metas, diaryMetas, allTags, stats: mergeStats(outs.map((o) => o.stats)), nStatic };
}
