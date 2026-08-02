#!/usr/bin/env bun
/**
 * Accessibility auditing for the built site (`out/`).
 *
 * Dev-only tooling: it lives in its own package (`scripts/a11y/package.json`)
 * so the hermetic nix build's `builder/node_modules` stays untouched.
 *
 * Subcommands
 *   scan  [pages...]   axe-core over every built page, in BOTH themes (default)
 *   tree  <page>       accessibility-tree dump -- what a screen reader sees
 *                      (--flat: announcement order, the way it will be read)
 *   tab   <page>       tab order + focus-ring visibility for keyboard-only use
 *   contrast [pages]   one row per syntax-highlight bucket -- tune the palettes
 *
 * Everything runs against a throwaway static server over `out/`, in headless
 * Chromium (the system one -- no puppeteer download).
 */
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const OUT = join(ROOT, "out");
const require_ = createRequire(import.meta.url);
const AXE_PATH = require_.resolve("axe-core/axe.min.js");
const AXE_VERSION = JSON.parse(readFileSync(require_.resolve("axe-core/package.json"), "utf8")).version;

// --- CLI --------------------------------------------------------------------

type Cmd = "scan" | "tree" | "tab" | "contrast";
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));
const cmd: Cmd = (["scan", "tree", "tab", "contrast"] as const).find((c) => c === positional[0]) ?? "scan";
const targets = (cmd === positional[0] ? positional.slice(1) : positional).map(normalizePage);
const flagValue = (name: string): string | undefined =>
  argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const OPTS = {
  json: flags.has("--json"),
  // `tree --flat`: announcement order instead of an indented tree.
  flat: flags.has("--flat"),
  // Best-practice rules are advisory (not WCAG); off by default to keep the
  // report actionable, on with --all.
  all: flags.has("--all"),
  // The disco canvas is a WebGL animation on every page. It is `aria-hidden`
  // and axe cannot see through a canvas anyway, so it only makes the scan slow
  // and flaky -- opt in explicitly when auditing the effect itself.
  disco: flags.has("--disco"),
  themes: (flagValue("theme")?.split(",") ?? ["dark", "light"]) as string[],
  // Only these impacts fail the run (exit 1); `--fail-on=minor` for everything.
  failOn: flagValue("fail-on") ?? "serious",
  concurrency: Number(flagValue("jobs") ?? 4),
  maxExamples: Number(flagValue("examples") ?? 3),
};

const IMPACT_ORDER = ["minor", "moderate", "serious", "critical"];
const impactRank = (i: string | null | undefined) => IMPACT_ORDER.indexOf(i ?? "minor");

function normalizePage(p: string): string {
  const rel = p.startsWith(OUT) ? relative(OUT, p) : p.replace(/^\/+/, "");
  return rel.replace(/^out\//, "");
}

// --- page discovery ---------------------------------------------------------

function allPages(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (extname(e.name) === ".html") found.push(relative(OUT, abs));
    }
  };
  walk(OUT);
  return found.sort();
}

/**
 * A representative slice rather than all ~150 pages: the site is generated, so
 * pages of the same shape fail the same way. One of each template plus the
 * feature-heaviest articles covers the real surface in a fraction of the time.
 */
function samplePages(pages: string[]): string[] {
  const pick = new Set<string>();
  const first = (pred: (p: string) => boolean) => {
    const hit = pages.find(pred);
    if (hit) pick.add(hit);
  };
  first((p) => p === "index.html");
  first((p) => p.startsWith("tags/"));
  first((p) => p.startsWith("diary/"));
  // feature coverage: score each article by the constructs it exercises
  const FEATURES = [
    /class="hl"/,
    /katex/,
    /link-card/,
    /<details/,
    /class="[^"]*keyboard/,
    /<table/,
    /coderef/,
    /class="[^"]*yaruo/,
    /<img/,
  ];
  const scored = pages
    .filter((p) => !p.startsWith("tags/"))
    .map((p) => {
      const html = readFileSync(join(OUT, p), "utf8");
      return { p, score: FEATURES.filter((re) => re.test(html)).length };
    })
    .sort((a, b) => b.score - a.score);
  for (const s of scored.slice(0, 6)) pick.add(s.p);
  return [...pick];
}

// --- static server ----------------------------------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

function serve() {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname);
      const file = Bun.file(join(OUT, path.endsWith("/") ? `${path}index.html` : path));
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      return new Response(file, { headers: { "content-type": MIME[extname(path)] ?? "application/octet-stream" } });
    },
  });
}

// --- browser ----------------------------------------------------------------

function chromePath(): string {
  const env = process.env.CHROME_PATH || process.env.CHROMIUM;
  if (env) return env;
  for (const c of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    const hit = Bun.which(c);
    if (hit) return hit;
  }
  throw new Error("no chromium found -- install one or set CHROME_PATH");
}

async function launch(): Promise<Browser> {
  return puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--force-prefers-reduced-motion"],
  });
}

/** Pin the theme + disco preference before the page's own inline scripts run. */
async function openPage(browser: Browser, url: string, theme: string): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: theme },
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  await page.evaluateOnNewDocument(
    (t: string, disco: boolean) => {
      try {
        localStorage.setItem("toybeam-theme", t);
        localStorage.setItem("toybeam-disco", disco ? "on" : "off");
      } catch {}
    },
    theme,
    OPTS.disco,
  );
  await page.goto(url, { waitUntil: "load" });
  return page;
}

// --- scan -------------------------------------------------------------------

type Violation = {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: { target: string[]; html: string; failureSummary?: string }[];
};

type Example = { page: string; theme: string; target: string; html: string; summary: string };
type Rule = {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  tags: string[];
  nodeCount: number;
  pages: Set<string>;
  examples: Example[];
};

async function scan(pages: string[]) {
  const server = serve();
  const base = `http://localhost:${server.port}`;
  const browser = await launch();
  const rules = new Map<string, Rule>();
  const jobs = pages.flatMap((p) => OPTS.themes.map((theme) => ({ page: p, theme })));
  let done = 0;
  let incomplete = 0;

  const runOne = async (job: { page: string; theme: string }) => {
    const page = await openPage(browser, `${base}/${job.page}`, job.theme);
    try {
      await page.addScriptTag({ path: AXE_PATH });
      const res = (await page.evaluate(async (runOnlyAll: boolean) => {
        const opts: any = { resultTypes: ["violations", "incomplete"] };
        if (!runOnlyAll) opts.runOnly = { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] };
        return await (window as any).axe.run(document, opts);
      }, OPTS.all)) as { violations: Violation[]; incomplete: Violation[] };

      incomplete += res.incomplete.length;
      for (const v of res.violations) {
        let r = rules.get(v.id);
        if (!r) {
          r = { id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, tags: v.tags, nodeCount: 0, pages: new Set(), examples: [] };
          rules.set(v.id, r);
        }
        if (impactRank(v.impact) > impactRank(r.impact)) r.impact = v.impact;
        r.nodeCount += v.nodes.length;
        r.pages.add(job.page);
        for (const n of v.nodes) {
          if (r.examples.length >= OPTS.maxExamples) break;
          r.examples.push({
            page: job.page,
            theme: job.theme,
            target: n.target.join(" "),
            html: n.html.replace(/\s+/g, " ").slice(0, 140),
            summary: (n.failureSummary ?? "").replace(/\s+/g, " ").replace(/^Fix any of the following: /, "").slice(0, 220),
          });
        }
      }
    } finally {
      await page.close();
      done++;
      if (!OPTS.json) process.stderr.write(`\r  scanning ${done}/${jobs.length}   `);
    }
  };

  // fixed-size worker pool over the job list
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: Math.min(OPTS.concurrency, queue.length) }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) await runOne(job);
    }),
  );
  if (!OPTS.json) process.stderr.write("\r".padEnd(30) + "\r");

  await browser.close();
  server.stop(true);

  const sorted = [...rules.values()].sort(
    (a, b) => impactRank(b.impact) - impactRank(a.impact) || b.nodeCount - a.nodeCount,
  );
  report(sorted, pages.length, jobs.length, incomplete);
  const failing = sorted.filter((r) => impactRank(r.impact) >= impactRank(OPTS.failOn));
  process.exit(failing.length ? 1 : 0);
}

function report(rules: Rule[], pageCount: number, jobCount: number, incomplete: number) {
  if (OPTS.json) {
    console.log(JSON.stringify(rules.map((r) => ({ ...r, pages: [...r.pages] })), null, 2));
    return;
  }
  const scope = OPTS.all ? "all rules" : "WCAG 2.0/2.1/2.2 A+AA";
  console.log(`# a11y scan — ${pageCount} pages × ${OPTS.themes.join("/")} (${jobCount} loads), axe-core ${AXE_VERSION}, ${scope}`);
  if (!rules.length) {
    console.log("\nNo violations.");
  }
  console.log(`\n${rules.length} rule(s) violated, ${rules.reduce((n, r) => n + r.nodeCount, 0)} node(s) total\n`);
  for (const r of rules) {
    const wcag = r.tags.filter((t) => t.startsWith("wcag")).join(",") || r.tags.join(",");
    console.log(`[${r.impact}] ${r.id} — ${r.nodeCount} node(s) on ${r.pages.size} page(s)  (${wcag})`);
    console.log(`  ${r.help}`);
    console.log(`  ${r.helpUrl}`);
    for (const e of r.examples) {
      console.log(`  · ${e.page} [${e.theme}] ${e.target}`);
      console.log(`      ${e.html}`);
      if (e.summary) console.log(`      → ${e.summary}`);
    }
    console.log();
  }
  if (incomplete) console.log(`(${incomplete} "incomplete" result(s) axe could not decide — review manually)`);
}

// --- accessibility tree -----------------------------------------------------

/**
 * The closest machine-readable proxy for "what does a screen reader announce":
 * Chromium's own accessibility tree, the same one AT talks to over the platform
 * a11y API. Ignored/presentational nodes are dropped, so what prints is roughly
 * the announcement sequence in reading order.
 */
// Roles a screen reader names as landmarks when it reaches them.
const LANDMARKS: Record<string, string> = {
  banner: "banner", navigation: "navigation", main: "main",
  contentinfo: "contentinfo", complementary: "complementary",
  region: "region", search: "search", form: "form",
};

/**
 * Render the exposed nodes as an announcement sequence rather than a tree.
 * A screen reader does not read indentation -- it reads "<name>, <role>", says
 * how many items a list holds, and says the level of a heading. This is the view
 * to diff between builds: a structural change shows up as a changed line, and it
 * reads the way the page will actually sound.
 *
 * An approximation, not an emulator: every screen reader words things
 * differently and verbosity settings change what is spoken at all. It tells you
 * WHAT is exposed and in what order, which is the part that markup controls.
 */
function announce(seq: { node: any; name: string }[], byId: Map<any, any>, prop: (n: any, k: string) => any): string[] {
  const out: string[] = [];
  for (const { node: n, name } of seq) {
    const role = n.role?.value ?? "";
    // A missing name is a defect on a control and meaningless on a wrapper, so
    // only call it out where it is one.
    const MUST_BE_NAMED = new Set(["link", "button", "heading", "textbox", "checkbox", "img"]);
    const q = name ? `"${name.slice(0, 90)}"` : MUST_BE_NAMED.has(role) ? "(UNNAMED)" : "";
    if (role === "StaticText") {
      out.push(name);
    } else if (role === "heading") {
      out.push(`${q}, heading level ${prop(n, "level") ?? "?"}`);
    } else if (role === "list") {
      const items = (n.childIds ?? []).filter((c: any) => byId.get(c)?.role?.value === "listitem").length;
      out.push(`list with ${items} item${items === 1 ? "" : "s"}`);
    } else if (role === "listitem") {
      continue; // the item's own content is announced by its children
    } else if (LANDMARKS[role]) {
      out.push(name ? `${q}, ${LANDMARKS[role]} landmark` : `${LANDMARKS[role]} landmark`);
    } else if (role === "button") {
      const pressed = prop(n, "pressed");
      out.push(`${q}, button${pressed !== undefined ? `, ${pressed === "true" ? "pressed" : "not pressed"}` : ""}`);
    } else if (role === "link") {
      out.push(`${q}, link`);
    } else if (role === "RootWebArea") {
      out.push(`${q}, document`);
    } else {
      out.push(q ? `${q}, ${role}` : role);
    }
  }
  return out;
}

async function tree(pagePath: string, theme: string) {
  const server = serve();
  const browser = await launch();
  const page = await openPage(browser, `http://localhost:${server.port}/${pagePath}`, theme);
  // Raw CDP, not page.accessibility.snapshot(): puppeteer's `interestingOnly`
  // filter prunes landmark containers, which is exactly what we need to see.
  const cdp = await page.createCDPSession();
  const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as any;
  const byId = new Map(nodes.map((n: any) => [n.nodeId, n]));
  const lines: string[] = [];
  const seq: { node: any; name: string }[] = [];
  const prop = (n: any, name: string) => n.properties?.find((p: any) => p.name === name)?.value?.value;
  const walk = (id: string, depth: number, parentName?: string) => {
    const n: any = byId.get(id);
    if (!n) return;
    // `ignored` nodes are not exposed to AT at all -- skip the node but keep
    // walking, so their exposed descendants stay in reading order.
    // InlineTextBox is a layout detail, and a StaticText that just repeats the
    // name its parent already carries is pure noise; both are dropped so the
    // dump reads like an announcement sequence rather than a DOM listing.
    const skip =
      n.ignored ||
      n.role?.value === "none" ||
      n.role?.value === "generic" ||
      n.role?.value === "InlineTextBox" ||
      (n.role?.value === "StaticText" && n.name?.value === parentName);
    if (!skip) {
      const name = n.name?.value ? ` "${String(n.name.value).replace(/\s+/g, " ").slice(0, 90)}"` : "";
      const extra = [
        prop(n, "level") ? `level=${prop(n, "level")}` : "",
        prop(n, "pressed") !== undefined ? `pressed=${prop(n, "pressed")}` : "",
        prop(n, "expanded") !== undefined ? `expanded=${prop(n, "expanded")}` : "",
        prop(n, "disabled") ? "disabled" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const text = n.role?.value === "StaticText" ? "" : name;
      lines.push(`${"  ".repeat(depth)}${n.role?.value}${text || name}${extra ? ` (${extra})` : ""}`);
      seq.push({ node: n, name: n.name?.value ? String(n.name.value).replace(/\s+/g, " ").trim() : "" });
    }
    for (const c of n.childIds ?? []) walk(c, skip ? depth : depth + 1, n.name?.value || parentName);
  };
  walk(nodes[0].nodeId, 0);

  if (OPTS.flat) {
    console.log(`# announcement order — ${pagePath} [${theme}]  (approximates a screen reader reading top to bottom)\n`);
    console.log(announce(seq, byId, prop).join("\n"));
  } else {
    console.log(`# accessibility tree — ${pagePath} [${theme}]  (what AT is handed, in reading order)\n`);
    console.log(lines.join("\n"));
  }
  await browser.close();
  server.stop(true);
}

// --- tab order --------------------------------------------------------------

/** Walk the page with Tab the way a keyboard-only user does, and record what
 *  lands focus, in what order, with what accessible name and focus ring. */
async function tabOrder(pagePath: string, theme: string) {
  const server = serve();
  const browser = await launch();
  const page = await openPage(browser, `http://localhost:${server.port}/${pagePath}`, theme);
  console.log(`# tab order — ${pagePath} [${theme}]\n`);
  const seen = new Set<string>();
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const label =
        el.getAttribute("aria-label") ||
        (el as HTMLElement).innerText?.replace(/\s+/g, " ").trim().slice(0, 60) ||
        el.getAttribute("title") ||
        "";
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id,
        cls: el.className?.toString().slice(0, 40),
        label,
        href: (el as HTMLAnchorElement).href ?? "",
        outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
        boxShadow: cs.boxShadow === "none" ? "" : cs.boxShadow.slice(0, 40),
        offscreen: rect.width === 0 || rect.height === 0,
      };
    });
    if (!info) break;
    const key = `${info.tag}#${info.id}.${info.cls}|${info.label}|${info.href}`;
    if (seen.has(key)) break; // wrapped around to the browser chrome
    seen.add(key);
    const ring = info.outline.startsWith("none") && !info.boxShadow ? "NO FOCUS RING" : info.outline;
    console.log(
      `${String(i + 1).padStart(2)}. <${info.tag}${info.id ? `#${info.id}` : ""}> ${info.label || "(no name)"}` +
        `${info.offscreen ? "  [zero-size]" : ""}\n     ring: ${ring}${info.boxShadow ? ` | shadow: ${info.boxShadow}` : ""}`,
    );
  }
  await browser.close();
  server.stop(true);
}

// --- syntax-palette contrast -----------------------------------------------

/**
 * Contrast of every syntax-highlight bucket against the background it actually
 * renders on, per theme. axe reports thousands of nodes for the same handful of
 * palette entries; this collapses them to one row per `hl-*` class so the two
 * `.hl` palettes in style.css can be tuned and re-checked in seconds.
 */
async function contrast(pages: string[]) {
  const server = serve();
  const browser = await launch();
  for (const theme of OPTS.themes) {
    const rows = new Map<string, { cls: string; fg: string; bg: string; ratio: number; count: number; sample: string }>();
    for (const p of pages) {
      const page = await openPage(browser, `http://localhost:${server.port}/${p}`, theme);
      const found = await page.evaluate(() => {
        const parse = (c: string): [number, number, number, number] => {
          const n = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
          // Chromium serialises a `color-mix()` result as `color(srgb r g b / a)`
          // with components in 0..1, not the 0..255 of `rgb()`. Reading those as
          // 0..255 turns a pale wash into near-black and makes a failing
          // combination look like a comfortable pass -- so scale by channel
          // notation, not by guessing.
          const scale = c.startsWith("color(") ? 255 : 1;
          return [n[0] * scale, n[1] * scale, n[2] * scale, n[3] ?? 1];
        };
        // Effective background: composite every semi-transparent layer down the
        // ancestor chain. Diff rows and coderef highlights are alpha washes
        // (`rgba(46,160,67,.13)`), so taking the first non-zero-alpha colour as
        // opaque would report a vivid green nobody ever sees.
        const bgOf = (el: Element): [number, number, number, number] => {
          const layers: [number, number, number, number][] = [];
          for (let e: Element | null = el; e; e = e.parentElement) {
            const c = parse(getComputedStyle(e).backgroundColor);
            if (c[3] > 0) layers.push(c);
            if (c[3] >= 1) break;
          }
          let out: [number, number, number, number] = [255, 255, 255, 1];
          for (const [r, g, b, a] of layers.reverse()) {
            out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a), 1];
          }
          return out;
        };
        const lum = ([r, g, b]: number[]) => {
          const f = (v: number) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const hex = (c: number[]) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
        const out: { cls: string; fg: string; bg: string; ratio: number; sample: string }[] = [];
        for (const el of document.querySelectorAll<HTMLElement>('[class*="hl-"]')) {
          const cls = [...el.classList].find((c) => c.startsWith("hl-"));
          if (!cls) continue;
          const fg = parse(getComputedStyle(el).color);
          const bg = bgOf(el);
          const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
          out.push({
            cls,
            fg: hex(fg),
            bg: hex(bg),
            ratio: Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100,
            sample: (el.textContent ?? "").trim().slice(0, 18),
          });
        }
        return out;
      });
      for (const f of found) {
        const key = `${f.cls}|${f.fg}|${f.bg}`;
        const prev = rows.get(key);
        if (prev) prev.count++;
        else rows.set(key, { ...f, count: 1 });
      }
      await page.close();
    }
    const sorted = [...rows.values()].sort((a, b) => a.ratio - b.ratio);
    console.log(`\n# syntax palette contrast — [${theme}]  (AA body text needs 4.5:1)\n`);
    console.log("  ratio  class     fg       on bg     nodes  sample");
    for (const r of sorted) {
      const mark = r.ratio >= 4.5 ? "ok  " : r.ratio >= 3 ? "FAIL" : "FAIL";
      console.log(
        `  ${String(r.ratio).padStart(5)}  ${mark} ${r.cls.padEnd(8)} ${r.fg}  ${r.bg}  ${String(r.count).padStart(5)}  ${r.sample}`,
      );
    }
  }
  await browser.close();
  server.stop(true);
}

// --- main -------------------------------------------------------------------

try {
  statSync(OUT);
} catch {
  console.error("out/ does not exist — run `just build` first");
  process.exit(2);
}

const theme = OPTS.themes[0] ?? "dark";
if (cmd === "tree") await tree(targets[0] ?? "index.html", theme);
else if (cmd === "tab") await tabOrder(targets[0] ?? "index.html", theme);
else if (cmd === "contrast") await contrast(targets.length ? targets : samplePages(allPages()));
else {
  const pages = targets.length ? targets : flags.has("--sample") ? samplePages(allPages()) : allPages();
  await scan(pages);
}
