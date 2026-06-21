#!/usr/bin/env bun
// Warm watch daemon: a long-lived process that does ONE full build, then keeps
// the uniorg + Prism + KaTeX + happy-dom machinery resident and re-renders only
// the file you just changed. The full `just build` reloads all of that (~235ms
// per worker isolate) and re-renders all ~140 articles every run (~1.5s); here
// the heavy setup is paid once at startup, so an incremental `.org` save lands
// in ~10-50ms (a single warm render+bake), not seconds.
//
// What it watches (src/), and what each change does:
//   - `<name>.org`            -> warm render+bake just that page; regenerate the
//                                index + tag pages only if its metadata
//                                (title/date/tags/thumbnail) changed.
//   - deleted / `#+DRAFT` org -> remove its page + reindex.
//   - `style/*.css|*.ts`      -> rebuild the minified assets, copy them to out/.
//   - other static (img, ...) -> copy the one file.
//
// Release-only, like `just build` (drafts are skipped, no `draft/` support); use
// `just build-emacs --draft` for drafts. Run `just serve` alongside to preview.
//
// renderAndBake (the warm path) is imported at module load, so bake.ts's heavy
// Prism/happy-dom setup is done once and stays warm for every incremental save.
import { watch } from "node:fs";
import { mkdir, writeFile, rm, cp, readdir } from "node:fs/promises";
import { join, dirname, sep } from "node:path";
import { renderAndBake } from "./build/render-bake.ts";
import { type Meta } from "./build/render.tsx";
import { SRC, OUT, STATIC_RE, fullBuild, writeIndexAndTags } from "./build.ts";

// --- in-memory article metadata cache, keyed by output rel (e.g. diary/x.html).
// Seeded from the startup full build, kept in sync on every change; the index +
// tag pages are regenerated from it (never re-rendering the articles).
type Entry = { isDiary: boolean; meta: Meta };
const cache = new Map<string, Entry>();

// The metadata fields the index/tag cards render -- a change in any of these
// (not a body-only edit) means the index + tag pages must be regenerated.
const metaKey = (m: Meta) => JSON.stringify([m.href, m.titleHtml, m.date, m.tags, m.thumbnail]);

function lists() {
  const metas: Meta[] = [], diaryMetas: Meta[] = [];
  for (const e of cache.values()) (e.isDiary ? diaryMetas : metas).push(e.meta);
  const byHrefDesc = (a: Meta, b: Meta) => (a.href < b.href ? 1 : -1);
  metas.sort(byHrefDesc);
  diaryMetas.sort(byHrefDesc);
  const allTags = [...new Set(metas.flatMap((m) => m.tags))].sort();
  return { metas, diaryMetas, allTags };
}
const regenIndexTags = () => { const l = lists(); return writeIndexAndTags(l.metas, l.diaryMetas, l.allTags); };

const since = (t: number) => `${Math.round(performance.now() - t)}ms`;
const log = (msg: string) => console.log(`  ${msg}`);

// --- one .org change ---------------------------------------------------------
async function onOrg(relOrg: string): Promise<void> {
  const t = performance.now();
  const abs = join(SRC, relOrg);
  const outRel = relOrg.replace(/\.org$/, ".html");
  // deleted -> drop its page; reindex only if it was a published article
  if (!(await Bun.file(abs).exists())) {
    if (cache.delete(outRel)) { await rm(join(OUT, outRel), { force: true }); await regenIndexTags(); }
    log(`- ${relOrg} removed (${since(t)})`);
    return;
  }
  const r = await renderAndBake(relOrg, await Bun.file(abs).text());
  // became a #+DRAFT -> treat like a delete (release build skips drafts)
  if (r.draft) {
    if (cache.delete(r.rel)) { await rm(join(OUT, r.rel), { force: true }); await regenIndexTags(); }
    log(`~ ${relOrg} draft, skipped (${since(t)})`);
    return;
  }
  const dest = join(OUT, r.rel);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, r.out);
  const prev = cache.get(r.rel);
  const reindex = !prev || metaKey(prev.meta) !== metaKey(r.meta);
  cache.set(r.rel, { isDiary: r.isDiary, meta: r.meta });
  if (reindex) await regenIndexTags();
  log(`✓ ${r.rel}${reindex ? " + index/tags" : ""} (${since(t)})`);
}

// --- one static-file change --------------------------------------------------
async function runAssets(): Promise<void> {
  const p = Bun.spawn(["bun", "scripts/build-assets.ts"], { stdout: "ignore", stderr: "inherit" });
  await p.exited;
}
async function copyStyleAssets(): Promise<void> {
  const dir = join(SRC, "style");
  const files = (await readdir(dir)).filter((f) => STATIC_RE.test(f));
  await mkdir(join(OUT, "style"), { recursive: true });
  await Promise.all(files.map((f) => cp(join(dir, f), join(OUT, "style", f), { force: true }).catch(() => {})));
}
async function onStatic(relStatic: string): Promise<void> {
  const t = performance.now();
  // generated *.min.* are produced by runAssets below; ignore their own events
  // (no rebuild loop).
  if (/\.min\.(css|js)$/.test(relStatic)) return;
  // a hand-written style source (style.css, prism-*.css, disco.ts) -> re-minify
  // and copy all generated style assets.
  if (relStatic.startsWith(`style${sep}`)) {
    await runAssets();
    await copyStyleAssets();
    log(`style ${relStatic} -> re-minified (${since(t)})`);
    return;
  }
  // plain static (img, loose html/js) -> copy the single file.
  const dest = join(OUT, relStatic);
  await mkdir(dirname(dest), { recursive: true });
  await cp(join(SRC, relStatic), dest, { force: true }).catch(() => {});
  log(`static ${relStatic} (${since(t)})`);
}

// route a path (relative to SRC) to its handler, mirroring build.ts's filters
function route(relPath: string): Promise<void> {
  if (relPath.endsWith(".org")) {
    if (relPath === "index.org" || relPath.startsWith(`tags${sep}`)) return Promise.resolve(); // generated
    return onOrg(relPath);
  }
  if (STATIC_RE.test(relPath)) return onStatic(relPath);
  return Promise.resolve(); // .drawio, .ts diagrams, etc. -- not shipped
}

// debounce per path: editors fire several events (write + rename + chmod) per
// save; collapse them into one rebuild ~40ms after the last event.
const pending = new Map<string, ReturnType<typeof setTimeout>>();
function schedule(relPath: string): void {
  const prev = pending.get(relPath);
  if (prev) clearTimeout(prev);
  pending.set(relPath, setTimeout(() => {
    pending.delete(relPath);
    route(relPath).catch((e) => console.error(`  ! ${relPath}: ${e?.stack ?? e}`));
  }, 40));
}

// --- startup: one full build, seed the cache, then watch ---------------------
console.log("warm watch: building once (render+bake stays resident)…");
const t0 = performance.now();
const { outs } = await fullBuild();
for (const o of outs) for (const r of o.results) cache.set(r.rel, { isDiary: r.isDiary, meta: r.meta });
console.log(`  ready in ${since(t0)}; watching ${SRC}/ — incremental saves rebuild one file. Ctrl-C to stop.`);

const watcher = watch(SRC, { recursive: true }, (_event, filename) => {
  if (filename) schedule(typeof filename === "string" ? filename : filename.toString());
});
process.on("SIGINT", () => { watcher.close(); console.log("\nwarm watch: stopped."); process.exit(0); });
