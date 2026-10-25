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
// It also watches the builder's OWN sources (builder/src, grammars, configs).
// Those can't be applied warm -- this process already loaded the old modules and
// dist/render-shard.js is stale -- so on a builder change the daemon exits with
// code 75 and the `just watch` loop rebuilds the bundle and starts a fresh
// daemon; browsers reload when their SSE channel reconnects.
//
// Release-only, like `just build` (drafts are skipped). Run `just serve`
// alongside to preview.
//
// renderAndBake (the warm path) is imported at module load, so bake.ts's heavy
// tree-sitter setup is done once and stays warm for every incremental save.
import { watch, readdirSync, readFileSync, existsSync, unlinkSync, type FSWatcher } from "node:fs";
import { mkdir, writeFile, readFile, rm, cp, readdir } from "node:fs/promises";
import { join, dirname, relative, sep } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { renderAndBake } from "./render-bake.ts";
import type { Meta } from "./render.tsx";
import { SRC, OUT, STATIC_RE, fullBuild, listings, writeIndexAndTags } from "./build.ts";
import { counterpartOf, destsOf, fallbackRelOf, isPublished, langOf, outRelOf, type Lang } from "./lang.ts";
import { startDevServer, type DevServer } from "./dev-server.ts";
import { errorText } from "./guard.ts";

const HERE = import.meta.dirname; // builder/src

// Live preview: an HTTP server over out/ that pushes a browser reload after each
// rebuild (set DEV_PORT=0 to disable and preview with `just serve` instead).
const DEV_PORT = Number(process.env.DEV_PORT ?? "8080");
let dev: DevServer | null = null;
// "/diary/x.html" — the URL the dev client matches against location.pathname.
const urlOf = (outRel: string): string => `/${outRel.split(sep).join("/")}`;

// --- in-memory article metadata cache, keyed by output rel (e.g. diary/x.html).
// Seeded from the startup full build, kept in sync on every change; the index +
// tag pages are regenerated from it (never re-rendering the articles).
type Entry = { lang: Lang; isDiary: boolean; meta: Meta };
const cache = new Map<string, Entry>();

// The metadata fields the index/tag cards render -- a change in any of these
// (not a body-only edit) means the index + tag pages must be regenerated.
const metaKey = (m: Meta): string => JSON.stringify([m.href, m.titleHtml, m.date, m.tags, m.thumbnail]);

const regenIndexTags = async (): Promise<void> => writeIndexAndTags(listings(cache.values()));

const since = (t: number): string => `${Math.round(performance.now() - t)}ms`;
const log = (msg: string): void => {
  console.log(`  ${msg}`);
};

// --- one .org change ---------------------------------------------------------
// Drop an unpublished article's page(s), and its root stand-in unless a real
// translation has taken that path.
const rmAll = async (rels: string[]): Promise<void> => {
  await Promise.all(rels.map(async (rel) => rm(join(OUT, rel), { force: true })));
};
async function unpublish(relOrg: string, outRel: string): Promise<void> {
  const lang = langOf(relOrg);
  if (lang === "ja" && !isPublished(SRC, counterpartOf(relOrg))) {
    await rmAll(destsOf("en", fallbackRelOf(relOrg)));
  }
  if (cache.delete(outRel)) {
    await rmAll(destsOf(lang, outRel));
    await regenIndexTags();
    dev?.reload();
  }
}

async function onOrgFile(relOrg: string): Promise<void> {
  const t = performance.now();
  const abs = join(SRC, relOrg);
  const outRel = outRelOf(relOrg);
  // deleted -> drop its page; reindex only if it was a published article
  if (!existsSync(abs)) {
    await unpublish(relOrg, outRel);
    log(`- ${relOrg} removed (${since(t)})`);
    return;
  }
  const text = await readFile(abs, "utf8");
  const r = await renderAndBake(relOrg, text, {
    counterpart: isPublished(SRC, counterpartOf(relOrg)),
    src: SRC,
  });
  // became a #+DRAFT -> treat like a delete (release build skips drafts)
  if (r.draft) {
    await unpublish(relOrg, r.rel);
    log(`~ ${relOrg} draft, skipped (${since(t)})`);
    return;
  }
  for (const page of r.pages) {
    const dest = join(OUT, page.rel);
    // oxlint-disable-next-line eslint/no-await-in-loop -- four pages at most
    await mkdir(dirname(dest), { recursive: true });
    // oxlint-disable-next-line eslint/no-await-in-loop -- four pages at most
    await writeFile(dest, page.out);
  }
  const prev = cache.get(r.rel);
  const reindex = !prev || metaKey(prev.meta) !== metaKey(r.meta);
  cache.set(r.rel, { lang: r.lang, isDiary: r.isDiary, meta: r.meta });
  if (reindex) {
    await regenIndexTags();
  }
  // body-only edit -> reload just the tab on that page; a metadata change also
  // rewrote the index + tag pages, so reload every tab.
  if (reindex) {
    dev?.reload();
  } else {
    dev?.reload(urlOf(r.rel));
  }
  log(`✓ ${r.rel}${reindex ? " + index/tags" : ""} (${since(t)})`);
}

// Publishing/unpublishing one language changes the other's language switch,
// hreflang links and (Japanese) `/en/` stand-in, so re-render the counterpart
// too, AFTER the changed file: an unpublished translation's rm of `x.html`
// must come before the Japanese re-render writes the stand-in there.
async function onOrg(relOrg: string): Promise<void> {
  await onOrgFile(relOrg);
  const other = counterpartOf(relOrg);
  if (existsSync(join(SRC, other))) {
    await onOrgFile(other);
  }
}

// --- one static-file change --------------------------------------------------
// The only child PROCESS the daemon spawns (the asset rebuild).
// Tracked so shutdown() can reap it if we're killed mid-rebuild.
let assetChild: ChildProcess | null = null;
async function runAssets(): Promise<void> {
  const child = spawn("bun", [join(HERE, "assets.ts")], {
    cwd: join(HERE, ".."),
    env: { ...process.env, ASSETS_CLI: "1" }, // trigger the standalone run
    stdio: ["ignore", "ignore", "inherit"],
  });
  assetChild = child;
  try {
    await new Promise<void>((resolve) => {
      child.on("exit", () => {
        resolve();
      });
    });
  } finally {
    assetChild = null;
  }
}
async function copyStyleAssets(): Promise<void> {
  const dir = join(SRC, "style");
  const entries = await readdir(dir);
  const files = entries.filter((f) => STATIC_RE.test(f));
  await mkdir(join(OUT, "style"), { recursive: true });
  await Promise.all(files.map(async (f) => cp(join(dir, f), join(OUT, "style", f), { force: true })));
}
async function onStatic(relStatic: string): Promise<void> {
  const t = performance.now();
  // generated *.min.* are produced by runAssets below; ignore their own events
  // (no rebuild loop).
  if (/\.min\.(css|js)$/u.test(relStatic)) {
    return;
  }
  // a hand-written style source (style.css, disco.ts, ...) -> re-minify
  // and copy all generated style assets.
  if (relStatic.startsWith(`style${sep}`)) {
    await runAssets();
    await copyStyleAssets();
    // .css edit -> swap stylesheets in place (no navigation); a .ts/.js edit
    // changes behaviour, so do a full reload to re-run it.
    if (relStatic.endsWith(".css")) {
      dev?.cssReload();
    } else {
      dev?.reload();
    }
    log(`style ${relStatic} -> re-minified (${since(t)})`);
    return;
  }
  // plain static (img, loose html/js) -> copy the single file.
  const dest = join(OUT, relStatic);
  await mkdir(dirname(dest), { recursive: true });
  await cp(join(SRC, relStatic), dest, { force: true });
  dev?.reload();
  log(`static ${relStatic} (${since(t)})`);
}

// route a path (relative to SRC) to its handler, mirroring build.ts's filters
async function route(relPath: string): Promise<void> {
  if (relPath.endsWith(".org")) {
    // index.org and tags/ are generated
    if (relPath !== "index.org" && !relPath.startsWith(`tags${sep}`)) {
      await onOrg(relPath);
    }
  } else if (STATIC_RE.test(relPath)) {
    await onStatic(relPath);
  }
  // else .drawio, .ts diagrams, etc. -- not shipped
}

// debounce per path: editors fire several events (write + rename + chmod) per
// save; collapse them into one rebuild ~40ms after the last event.
const pending = new Map<string, ReturnType<typeof setTimeout>>();
function schedule(relPath: string): void {
  const prev = pending.get(relPath);
  if (prev !== undefined) {
    clearTimeout(prev);
  }
  pending.set(
    relPath,
    setTimeout(() => {
      pending.delete(relPath);
      void (async (): Promise<void> => {
        try {
          await route(relPath);
        } catch (error) {
          console.error(`  ! ${relPath}: ${errorText(error, true)}`);
        }
      })();
    }, 40),
  );
}

// --- single instance --------------------------------------------------------
// A daemon orphaned by a backgrounded run whose pane was closed (bash doesn't
// SIGHUP background jobs) would keep watching and writing out/. Make `just watch`
// a singleton: on start, replace any prior instance recorded in .watch.pid, so
// daemons never stack up. The /proc cmdline check avoids killing an unrelated
// process that happens to have reused the PID (Linux; degrades to a no-op).
const PID_FILE = join(HERE, "..", "..", ".watch.pid"); // repo root
function isWatchDaemon(pid: number): boolean {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("watch.ts");
  } catch {
    return false;
  }
}
try {
  const old = Number(readFileSync(PID_FILE, "utf8"));
  if (old > 0 && old !== process.pid && isWatchDaemon(old)) {
    process.kill(old, "SIGTERM");
    console.log(`  replaced a stale watch daemon (pid ${old})`);
  }
} catch {
  /* no prior daemon */
}
await writeFile(PID_FILE, String(process.pid));

// --- startup: one full build, seed the cache, then watch ---------------------
console.log("warm watch: building once (render+bake stays resident)…");
const t0 = performance.now();
const { outs } = await fullBuild();
for (const o of outs) {
  for (const r of o.results) {
    cache.set(r.rel, { lang: r.lang, isDiary: r.isDiary, meta: r.meta });
  }
}
if (DEV_PORT > 0) {
  dev = startDevServer(DEV_PORT);
}
console.log(`  ready in ${since(t0)}; watching ${SRC}/ — incremental saves rebuild one file. Ctrl-C to stop.`);

// Watch one fs.watch per directory, recursing ourselves -- NOT
// `fs.watch(SRC, { recursive: true })`. On Linux that recursive flag is a JS shim
// that watches each file's inode; an atomic save (editors/sed/git write a temp
// file then rename it over the original) swaps the inode, so the watch goes stale
// and only the first save to a file is ever seen. A directory watch survives the
// swap (the dir's inode is stable), firing on every save.
const watchers: FSWatcher[] = [];
function watchDir(dir: string, onFile: (abs: string) => void): boolean {
  try {
    const w = watch(dir, (_event, filename) => {
      if (filename !== null) {
        onFile(join(dir, filename));
      }
    });
    w.on("error", () => {
      /* dir removed mid-session: ignore, don't crash */
    });
    watchers.push(w);
    return true;
  } catch {
    // unreadable/vanished dir -> skip
    return false;
  }
}
function watchTree(dir: string, onFile: (abs: string) => void): void {
  if (!watchDir(dir, onFile)) {
    return;
  }
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      watchTree(join(dir, e.name), onFile);
    }
  }
}
watchTree(SRC, (abs) => {
  schedule(relative(SRC, abs));
});

// Clean teardown on EVERY termination signal we can catch -- Ctrl-C (SIGINT),
// `kill` (SIGTERM), and tmux pane/window close (SIGHUP) -- so we close the
// watcher, reap an in-flight asset rebuild, and drop the PID file. (SIGKILL is
// uncatchable, but the OS reclaims our threads + the awaited child anyway.)
let stopping = false;
function shutdown(sig: string, code = 0): void {
  if (stopping) {
    return;
  }
  stopping = true;
  for (const w of watchers) {
    try {
      w.close();
    } catch {
      /* already closed */
    }
  }
  if (assetChild) {
    try {
      assetChild.kill();
    } catch {
      /* already exited */
    }
  }
  try {
    unlinkSync(PID_FILE);
  } catch {
    /* already gone */
  }
  console.log(`\nwarm watch: stopped (${sig}).`);
  process.exit(code);
}
// --- builder self-watch ------------------------------------------------------
// A builder-source change can't take effect in this warm process, so hand
// control back to the `just watch` loop: exit 75 (EX_TEMPFAIL, "restart me").
// The loop re-bundles dist/render-shard.js and starts a fresh daemon, whose
// startup full build renders everything with the new code; the reload client
// reloads each open tab when its SSE channel reconnects to the new server.
const RESTART_EXIT = 75;
const BUILDER = join(HERE, ".."); // builder/
// sources that shape the output: TS/TSX + CSS modules (src/), grammar wasm +
// queries (grammars/), the top-level vite/shared configs. Ignores dist/ writes,
// node_modules, editor temp files.
const BUILDER_RE = /\.(ts|tsx|css|scm|wasm)$/u;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
function onBuilderChange(abs: string): void {
  if (!BUILDER_RE.test(abs)) {
    return;
  }
  if (restartTimer) {
    clearTimeout(restartTimer);
  }
  restartTimer = setTimeout(() => {
    log(`builder change: ${relative(BUILDER, abs)} — restarting with a fresh build…`);
    shutdown("builder-change", RESTART_EXIT);
  }, 150);
}
watchTree(join(BUILDER, "src"), onBuilderChange);
watchTree(join(BUILDER, "grammars"), onBuilderChange);
watchDir(BUILDER, onBuilderChange); // non-recursive: vite*.config.ts, config-shared.ts

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => {
    shutdown(sig);
  });
}
