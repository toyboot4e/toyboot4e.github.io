#!/usr/bin/env bun

// Bake syntax highlighting and math into the published HTML, so pages ship no
// highlighting/math JavaScript.
//
//   - Prism highlights every `<pre><code class="language-XX">` at build time.
//   - KaTeX renders `\(...\)`, `\[...\]` and bare `\begin{env}...\end{env}` math.
//
// The two old runtime loads (`prism.js` ~597 KiB on code pages, the MathJax CDN
// ~256 KiB on math pages) are gone; math pages now need only `katex.min.css`
// (~23 KiB) + woff2 fonts, copied here into `out/style/katex/`.
//
// DOM strategy (see ADR): a *hybrid*. linkedom parses/serialises each document
// and handles the math walk and plain code blocks (`Prism.highlight()` is a pure
// string call). Only blocks that need a Prism `highlightElement` hook -- ones
// with embedded markup (coderef callouts), a `line-numbers` class, or a `diff-*`
// language -- are routed through happy-dom, the one DOM complete enough to run
// `keep-markup` (linkedom lacks `Range.setStart`/`Text.splitText`).
//
// Idempotent: a processed file gets a `<!--pp-->` sentinel right after the
// doctype and is skipped on the next run. Emacs regenerates changed articles
// without it, so warm rebuilds only touch what changed. `just clean` (and the
// sandboxed `nix build`) start with no sentinels, so everything is reprocessed.
//
// Failure policy: bad macros / unknown languages degrade (red `.katex-error`
// text, unhighlighted code) and warn. With `--strict` (CI) the process exits
// non-zero if any KaTeX error or unknown language was seen.

import { Window } from "happy-dom";
import { parseHTML } from "linkedom";
import katex from "katex";
import { createRequire } from "node:module";
import { readdir, readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { dirname, join } from "node:path";

const STRICT = process.argv.includes("--strict") || !!process.env.CI;
const SENTINEL = "<!--pp-->";
const OUT = "out";
const CARD_CACHE = "linkcard-cache.json";

// Rendered as-is, never highlighted, never an error: the plaintext aliases plus
// languages that stock Prism has no grammar for and that we deliberately show
// verbatim -- `ditaa` (an org-babel diagram DSL that also emits a generated
// image) and `org` (no official Prism grammar; Org source stays readable plain).
const PLAIN = new Set(["txt", "text", "plaintext", "plain", "ditaa", "org"]);

// --- Prism setup -----------------------------------------------------------
// Prism's browser-oriented plugins read DOM globals at import time, so a
// complete DOM (happy-dom) must be live on `globalThis` before `prismjs` loads.
const hw = new Window();
const g = globalThis as any;
g.window = hw;
g.self = hw;
g.document = hw.document;
g.Node = hw.Node;
g.Element = hw.Element;
g.HTMLElement = hw.HTMLElement;
g.DocumentFragment = hw.DocumentFragment;
g.getComputedStyle = hw.getComputedStyle.bind(hw);
g.Option = (hw as any).Option;

const Prism = (await import("prismjs")).default as any;
g.Prism = Prism;
const loadLanguages = (await import("prismjs/components/index.js")).default as any;
// Languages in use across the corpus (loadLanguages resolves inter-deps and
// aliases, e.g. `lisp` -> `elisp`). Add here when a new language appears.
loadLanguages([
  "haskell", "nix", "bash", "fortran", "lua", "rust", "php", "typescript",
  "tsx", "json", "toml", "makefile", "csharp", "cpp", "lisp", "yaml",
  "python", "css", "ini", "diff", "markdown", "clike", "c", "javascript",
  "plantuml", "dot",
]);
// Kept plugins (see ADR / plan). keep-markup preserves coderef markup;
// diff-highlight handles `diff-*`; autolinker + inline-color are visual.
await import("prismjs/plugins/keep-markup/prism-keep-markup.js");
await import("prismjs/plugins/diff-highlight/prism-diff-highlight.js");
await import("prismjs/plugins/autolinker/prism-autolinker.js");
await import("prismjs/plugins/inline-color/prism-inline-color.js");
await import("prismjs/plugins/line-numbers/prism-line-numbers.js");
const hdoc = hw.document;

// --- counters --------------------------------------------------------------
let nFiles = 0, nSkippedFiles = 0;
let nPlain = 0, nDom = 0, nUnknown = 0, nHlError = 0;
let nMath = 0, nMathError = 0;
let nCards = 0, nCardMiss = 0;
const unknownLangs = new Set<string>();
const missingCards = new Set<string>();
const warn = (m: string) => console.warn(`  ! ${m}`);

// --- code highlighting -----------------------------------------------------
// A block needs the DOM path if it has embedded markup (coderef callouts), a
// `line-numbers` class, or a `diff-*` language -- all rely on highlightElement
// hooks that the fast `Prism.highlight()` string path does not fire.
function needsDom(code: any, pre: any, lang: string): boolean {
  if (code.children.length > 0) return true;
  if (lang.startsWith("diff-")) return true;
  const cls = (code.getAttribute("class") || "") + " " + ((pre && pre.getAttribute("class")) || "");
  return /\bline-numbers\b/.test(cls);
}

function highlightCode(document: any): void {
  for (const code of document.querySelectorAll("pre code[class*='language-']")) {
    const lc = (code.getAttribute("class") || "").split(/\s+/).find((c: string) => c.startsWith("language-"));
    if (!lc) continue;
    const lang = lc.slice("language-".length);
    if (PLAIN.has(lang)) continue;
    const pre = code.parentNode;
    const dom = needsDom(code, pre, lang);
    if (!dom && !Prism.languages[lang]) {
      nUnknown++; unknownLangs.add(lang);
      warn(`unknown language: ${lang}`);
      continue;
    }
    if (dom) {
      // Highlight in a reused happy-dom <code> (keep-markup needs a real DOM),
      // then splice the result back into the linkedom node.
      const hc = hdoc.createElement("code");
      hc.className = code.getAttribute("class");
      hc.innerHTML = code.innerHTML;
      try {
        Prism.highlightElement(hc);
        code.innerHTML = hc.innerHTML;
        nDom++;
      } catch (e: any) {
        nHlError++;
        warn(`highlight failed (${lang}): ${e?.message ?? e}`);
      }
    } else {
      code.innerHTML = Prism.highlight(code.textContent, Prism.languages[lang], lang);
      nPlain++;
    }
  }
}

// --- math ------------------------------------------------------------------
const SKIP_MATH = new Set(["PRE", "CODE", "SCRIPT", "STYLE"]);
const MATH_RE = /\\\((.+?)\\\)|\\\[([\s\S]+?)\\\]|\\begin\{([a-z*]+)\}([\s\S]+?)\\end\{\3\}/g;

function renderMath(document: any): void {
  const walker = document.createTreeWalker(document.body, 0x4 /* SHOW_TEXT */);
  const targets: any[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    let inSkip = false;
    for (let p = n.parentNode; p; p = p.parentNode) {
      if (SKIP_MATH.has(p.nodeName)) { inSkip = true; break; }
    }
    if (!inSkip && /\\\(|\\\[|\\begin\{/.test(n.data)) targets.push(n);
  }
  for (const node of targets) {
    const text: string = node.data;
    const frag = document.createDocumentFragment();
    let last = 0, m: RegExpExecArray | null;
    MATH_RE.lastIndex = 0;
    while ((m = MATH_RE.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const displayMode = m[2] !== undefined || m[3] !== undefined;
      const tex = m[1] ?? m[2] ?? `\\begin{${m[3]}}${m[4]}\\end{${m[3]}}`;
      const span = document.createElement("span");
      let html: string;
      try {
        // throwOnError:true lets us *detect* a genuine parse error; strict:false
        // silences cosmetic LaTeX-incompatibility notices (Japanese in math
        // mode, `\\` in display) that render fine and aren't ours to fix.
        html = katex.renderToString(tex, { displayMode, throwOnError: true, strict: false });
      } catch (e: any) {
        nMathError++;
        warn(`katex: ${String(e?.message ?? e).split("\n")[0]}`);
        // ...then re-render leniently so the page still gets red error text.
        html = katex.renderToString(tex, { displayMode, throwOnError: false, strict: false });
      }
      span.innerHTML = html;
      frag.appendChild(span);
      nMath++;
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
}

// --- link cards ------------------------------------------------------------
// Emacs turns `[[card:URL]]` into `<a class="link-card" href data-link-card>`;
// here we fill it from the committed cache (populated offline by `just
// linkcards` -> scripts/fetch-linkcards.ts). A URL missing from the cache
// degrades to a plain link and, under --strict (CI/nix), fails the build -- so
// the offline build always has the metadata it needs in source.
type Card = {
  kind?: "card" | "github-code";
  // kind: card (OGP)
  title?: string; description?: string; image?: string; siteName?: string; favicon?: string;
  // kind: github-code
  owner?: string; repo?: string; refLabel?: string; path?: string;
  startLine?: number; endLine?: number; lang?: string; code?: string;
};
let cards: Record<string, Card> = {};
try {
  cards = JSON.parse(await readFile(CARD_CACHE, "utf8"));
} catch {
  /* no cache yet -- every card will degrade (and fail strict) */
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function addClass(el: any, cls: string): void {
  const cur = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean);
  if (!cur.includes(cls)) cur.push(cls);
  el.setAttribute("class", cur.join(" "));
}

// Replace the placeholder anchor with a block element. If the anchor is the
// sole content of its parent `<p>` (the usual case -- a card on its own line),
// replace that `<p>`, so the block isn't nested inside a paragraph; otherwise
// replace the anchor in place.
function replaceWithBlock(a: any, html: string, document: any): void {
  let p = a.parentNode;
  while (p && p.nodeName !== "P") p = p.parentNode;
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const node = tmp.firstElementChild;
  if (!node) return;
  const target = p && p.textContent.trim() === a.textContent.trim() ? p : a;
  target.parentNode.replaceChild(node, target);
}

// GitHub code embeds are highlighted with Prism (same as the rest of the site),
// with a line-number gutter starting at the real source line. The Prism
// `line-numbers` plugin only emits its gutter for an *attached* <pre> (it reads
// the `line-numbers` class + `data-start` off the parent), so -- unlike the
// general highlightCode path which reuses a detached <code> -- we highlight a
// full <pre> built in the happy-dom document, then splice its HTML into the card.
// build.el only links the Prism stylesheets when the *exported* page already
// contains `language-` (see `has-code`). A GitHub embed's code is injected here,
// after export, so a page whose only code is an embed would ship unstyled
// (no highlighting, no gutter). Add the links if missing, mirroring build.el's
// markup exactly (ids + media) so style.js's theme toggle still controls them.
function ensurePrismCss(document: any): void {
  if (document.getElementById("prism-dark")) return;
  const head = document.querySelector("head");
  if (!head) return;
  for (const [id, file, scheme] of [
    ["prism-dark", "prism-dark.min.css", "dark"],
    ["prism-light", "prism-light.min.css", "light"],
  ]) {
    const link = document.createElement("link");
    link.setAttribute("rel", "stylesheet");
    link.setAttribute("id", id);
    link.setAttribute("href", `/style/${file}`);
    link.setAttribute("media", `(prefers-color-scheme: ${scheme})`);
    head.appendChild(link);
  }
}

function renderGitHubCode(a: any, url: string, c: Card, document: any): void {
  // Header leads with `filename:Lnn` (leftmost); repo + ref pushed to the right.
  const lines =
    c.startLine === c.endLine ? `L${c.startLine}` : `L${c.startLine}-L${c.endLine}`;
  const repo = `${c.owner}/${c.repo}${c.refLabel ? ` @ ${c.refLabel}` : ""}`;
  // A code-repo mark (Lucide `git-branch`, stroked, inlined so no external
  // request) + a ↗ next to the line range mark the header as an external link,
  // since the Prism-highlighted body otherwise reads as a plain code block. We
  // use a generic stand-in rather than the real GitHub logo on purpose: GitHub's
  // brand guidelines forbid recolouring, and `gh-embed-icon` is themed/tinted
  // with `currentColor`. Matches the nav's stand-in (see `my-icon-github`).
  const ghIcon =
    '<svg class="gh-embed-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M15 6a9 9 0 0 0-9 9V3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/></svg>';
  const head =
    ghIcon +
    `<span class="gh-embed-loc">` +
    `<span class="gh-embed-path">${esc(c.path || "")}</span>` +
    `<span class="gh-embed-lines">:${esc(lines)}</span>` +
    `<span class="gh-embed-ext" aria-hidden="true">↗</span>` +
    `</span>` +
    `<span class="gh-embed-repo">${esc(repo)}</span>`;

  let codeBlock: string;
  if (c.lang && Prism.languages[c.lang]) {
    const pre = hdoc.createElement("pre");
    pre.className = "gh-embed-code line-numbers";
    pre.setAttribute("data-start", String(c.startLine || 1));
    const code = hdoc.createElement("code");
    code.className = `language-${c.lang}`;
    code.textContent = c.code || "";
    pre.appendChild(code);
    hdoc.body.appendChild(pre); // line-numbers plugin needs the <pre> parent
    try {
      Prism.highlightElement(code);
      codeBlock = pre.outerHTML;
      ensurePrismCss(document); // page may have no other code block
      nDom++;
    } catch (e: any) {
      nHlError++;
      warn(`gh embed highlight failed (${c.lang}): ${e?.message ?? e}`);
      codeBlock = `<pre class="gh-embed-code gh-embed-plain"><code>${esc(c.code || "")}</code></pre>`;
    } finally {
      hdoc.body.removeChild(pre);
    }
  } else {
    codeBlock = `<pre class="gh-embed-code gh-embed-plain"><code>${esc(c.code || "")}</code></pre>`;
  }

  const html =
    `<figure class="gh-embed">` +
    `<figcaption class="gh-embed-head">` +
    `<a href="${esc(url)}" target="_blank" rel="noopener">${head}</a>` +
    `</figcaption>` +
    codeBlock +
    `</figure>`;
  replaceWithBlock(a, html, document);
  nCards++;
}

function renderLinkCards(document: any): void {
  for (const a of document.querySelectorAll("a[data-link-card]")) {
    a.removeAttribute("data-link-card");
    const url = a.getAttribute("href") || "";
    const card = cards[url];
    if (!card) {
      nCardMiss++;
      missingCards.add(url);
      addClass(a, "link-card--plain");
      warn(`link card not in cache (run \`just linkcards\`): ${url}`);
      continue;
    }
    if (card.kind === "github-code") {
      renderGitHubCode(a, url, card, document);
      continue;
    }
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener");
    let host = "";
    try { host = new URL(url).hostname; } catch { /* keep empty */ }
    const site = esc(card.siteName || host);
    const favicon = card.favicon
      ? `<img class="link-card-favicon" src="${esc(card.favicon)}" alt="" loading="lazy" decoding="async" width="16" height="16">`
      : "";
    const desc = card.description
      ? `<span class="link-card-desc">${esc(card.description)}</span>`
      : "";
    const image = card.image
      ? `<span class="link-card-image"><img src="${esc(card.image)}" alt="" loading="lazy" decoding="async"></span>`
      : "";
    a.innerHTML =
      `<span class="link-card-text">` +
      `<span class="link-card-title">${esc(card.title || url)}</span>` +
      desc +
      `<span class="link-card-site">${favicon}${site}</span>` +
      `</span>` +
      image;
    nCards++;
  }
}

// --- KaTeX assets ----------------------------------------------------------
// Copy katex.min.css + woff2 fonts into out/style/katex/ (woff2 only: modern
// browsers never fetch the woff/ttf @font-face fallbacks). Single source of
// truth is the installed `katex` package, so the CSS and renderer never drift.
async function copyKatexAssets(): Promise<void> {
  const require = createRequire(import.meta.url);
  const dist = join(dirname(require.resolve("katex/package.json")), "dist");
  const dest = join(OUT, "style", "katex");
  await mkdir(join(dest, "fonts"), { recursive: true });
  await cp(join(dist, "katex.min.css"), join(dest, "katex.min.css"));
  for (const f of await readdir(join(dist, "fonts"))) {
    if (f.endsWith(".woff2")) await cp(join(dist, "fonts", f), join(dest, "fonts", f));
  }
}

// --- driver ----------------------------------------------------------------
async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}

async function processFile(file: string): Promise<void> {
  const html = await readFile(file, "utf8");
  if (html.includes(SENTINEL)) { nSkippedFiles++; return; }
  const { document } = parseHTML(html);
  highlightCode(document);
  renderMath(document);
  // Last: renderGitHubCode highlights its own (attached) <pre>, so running after
  // highlightCode keeps that pass from re-processing the embed's code.
  renderLinkCards(document);
  // Stamp right after the doctype so the next run can skip via a string scan.
  let out = document.toString();
  out = /<!doctype html>/i.test(out)
    ? out.replace(/(<!doctype html>)/i, `$1${SENTINEL}`)
    : SENTINEL + out;
  await writeFile(file, out);
  nFiles++;
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const files = args.length ? args : await walk(OUT);
for (const f of files) await processFile(f);
await copyKatexAssets();

console.log(
  `post: ${nFiles} processed, ${nSkippedFiles} already stamped | ` +
  `code: ${nPlain} fast + ${nDom} dom, ${nUnknown} unknown, ${nHlError} failed | ` +
  `math: ${nMath} rendered, ${nMathError} errored | ` +
  `cards: ${nCards} baked, ${nCardMiss} missing`,
);

if (STRICT && (nMathError > 0 || nUnknown > 0 || nCardMiss > 0)) {
  console.error(
    `post: FAILED (strict) -- ${nMathError} math error(s), ` +
    `${nUnknown} unknown language(s)${unknownLangs.size ? `: ${[...unknownLangs].join(", ")}` : ""}` +
    `, ${nCardMiss} uncached link card(s)${missingCards.size ? `: ${[...missingCards].join(", ")}` : ""}`,
  );
  process.exit(1);
}
