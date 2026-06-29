#!/usr/bin/env bun
// Warm watch daemon: a long-lived process that does ONE full build, then keeps
// the uniorg + tree-sitter + KaTeX machinery resident and re-renders only
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
// Release-only, like `just build` (drafts are skipped). Run `just serve`
// alongside to preview.
//
// renderAndBake (the warm path) is imported at module load, so bake.ts's heavy
// tree-sitter setup is done once and stays warm for every incremental save.
import { watch, readdirSync, readFileSync, existsSync, unlinkSync, type FSWatcher } from "node:fs";
import { mkdir, writeFile, readFile, rm, cp, readdir } from "node:fs/promises";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { renderAndBake } from "./render-bake.ts";
import { type Meta } from "./render.tsx";
import { SRC, OUT, STATIC_RE, fullBuild, writeIndexAndTags } from "./build.ts";
import { startDevServer, type DevServer } from "./dev-server.ts";

const HERE = dirname(fileURLToPath(import.meta.url)); // builder/src

// Live preview: an HTTP server over out/ that pushes a browser reload after each
// rebuild (set DEV_PORT=0 to disable and preview with `just serve` instead).
const DEV_PORT = Number(process.env.DEV_PORT ?? "8080");
let dev: DevServer | null = null;
// "/diary/x.html" — the URL the dev client matches against location.pathname.
const urlOf = (outRel: string) => "/" + outRel.split(sep).join("/");

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
  if (!existsSync(abs)) {
    if (cache.delete(outRel)) { await rm(join(OUT, outRel), { force: true }); await regenIndexTags(); dev?.reload(); }
    log(`- ${relOrg} removed (${since(t)})`);
    return;
  }
  const r = await renderAndBake(relOrg, await readFile(abs, "utf8"));
  // became a #+DRAFT -> treat like a delete (release build skips drafts)
  if (r.draft) {
    if (cache.delete(r.rel)) { await rm(join(OUT, r.rel), { force: true }); await regenIndexTags(); dev?.reload(); }
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
  // body-only edit -> reload just the tab on that page; a metadata change also
  // rewrote the index + tag pages, so reload every tab.
  if (reindex) dev?.reload(); else dev?.reload(urlOf(r.rel));
  log(`✓ ${r.rel}${reindex ? " + index/tags" : ""} (${since(t)})`);
}

// --- one static-file change --------------------------------------------------
// The only child PROCESS the daemon spawns (the asset rebuild, via vite-node).
// Tracked so shutdown() can reap it if we're killed mid-rebuild.
let assetChild: ChildProcess | null = null;
async function runAssets(): Promise<void> {
  assetChild = spawn("bunx", ["vite-node", join(HERE, "assets.ts")], {
    cwd: join(HERE, ".."), // builder/, so vite-node finds vite.config.ts
    env: { ...process.env, ASSETS_CLI: "1" }, // trigger the standalone run
    stdio: ["ignore", "ignore", "inherit"],
  });
  try { await new Promise<void>((res) => assetChild!.on("exit", () => res())); } finally { assetChild = null; }
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
  // a hand-written style source (style.css, disco.ts, ...) -> re-minify
  // and copy all generated style assets.
  if (relStatic.startsWith(`style${sep}`)) {
    await runAssets();
    await copyStyleAssets();
    // .css edit -> swap stylesheets in place (no navigation); a .ts/.js edit
    // changes behaviour, so do a full reload to re-run it.
    if (relStatic.endsWith(".css")) dev?.cssReload(); else dev?.reload();
    log(`style ${relStatic} -> re-minified (${since(t)})`);
    return;
  }
  // plain static (img, loose html/js) -> copy the single file.
  const dest = join(OUT, relStatic);
  await mkdir(dirname(dest), { recursive: true });
  await cp(join(SRC, relStatic), dest, { force: true }).catch(() => {});
  dev?.reload();
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

// --- single instance --------------------------------------------------------
// A daemon orphaned by a backgrounded run whose pane was closed (bash doesn't
// SIGHUP background jobs) would keep watching and writing out/. Make `just watch`
// a singleton: on start, replace any prior instance recorded in .watch.pid, so
// daemons never stack up. The /proc cmdline check avoids killing an unrelated
// process that happens to have reused the PID (Linux; degrades to a no-op).
const PID_FILE = join(HERE, "..", "..", ".watch.pid"); // repo root
function isWatchDaemon(pid: number): boolean {
  try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("watch.ts"); } catch { return false; }
}
try {
  const old = Number(readFileSync(PID_FILE, "utf8"));
  if (old && old !== process.pid && isWatchDaemon(old)) {
    process.kill(old, "SIGTERM");
    console.log(`  replaced a stale watch daemon (pid ${old})`);
  }
} catch { /* no prior daemon */ }
await writeFile(PID_FILE, String(process.pid));

// --- startup: one full build, seed the cache, then watch ---------------------
console.log("warm watch: building once (render+bake stays resident)…");
const t0 = performance.now();
const { outs } = await fullBuild();
for (const o of outs) for (const r of o.results) cache.set(r.rel, { isDiary: r.isDiary, meta: r.meta });
if (DEV_PORT > 0) dev = startDevServer(DEV_PORT);
console.log(`  ready in ${since(t0)}; watching ${SRC}/ — incremental saves rebuild one file. Ctrl-C to stop.`);

// Watch one fs.watch per directory, recursing ourselves -- NOT
// `fs.watch(SRC, { recursive: true })`. On Linux that recursive flag is a JS shim
// that watches each file's inode; an atomic save (editors/sed/git write a temp
// file then rename it over the original) swaps the inode, so the watch goes stale
// and only the first save to a file is ever seen. A directory watch survives the
// swap (the dir's inode is stable), firing on every save.
const watchers: FSWatcher[] = [];
function watchTree(dir: string): void {
  try {
    const w = watch(dir, (_event, filename) => {
      if (filename) schedule(relative(SRC, join(dir, filename.toString())));
    });
    w.on("error", () => { /* dir removed mid-session: ignore, don't crash */ });
    watchers.push(w);
  } catch { return; } // unreadable/vanished dir -> skip
  for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) watchTree(join(dir, e.name));
}
watchTree(SRC);

// Clean teardown on EVERY termination signal we can catch -- Ctrl-C (SIGINT),
// `kill` (SIGTERM), and tmux pane/window close (SIGHUP) -- so we close the
// watcher, reap an in-flight asset rebuild, and drop the PID file. (SIGKILL is
// uncatchable, but the OS reclaims our threads + the awaited child anyway.)
let stopping = false;
function shutdown(sig: string): void {
  if (stopping) return;
  stopping = true;
  for (const w of watchers) { try { w.close(); } catch { /* already closed */ } }
  if (assetChild) { try { assetChild.kill(); } catch { /* already exited */ } }
  try { unlinkSync(PID_FILE); } catch { /* already gone */ }
  console.log(`\nwarm watch: stopped (${sig}).`);
  process.exit(0);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => shutdown(sig));
