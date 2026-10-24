// Build-time "bake" core: tree-sitter syntax highlighting + KaTeX math +
// `[[card:URL]]` link cards, applied to a parsed HTML `document`.
//
// A representation-agnostic engine: it operates on a linkedom/DOM `document`.
// `build/render-worker.ts` drives it -- each freshly rendered article is baked
// in-process (no separate postprocess run, no disk round-trip), in a worker.
//
// Counters are module-level and therefore per-isolate; a worker reports its own
// `getStats()` back to the orchestrator, which aggregates. Call `resetStats()`
// between independent runs in the same isolate.

import { initHighlighter, highlight, type Coderef, type HlOpts } from "./highlight.ts";
import { renderToString } from "katex";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseTrustedJson, type BakeStats, type Card } from "./bake-util.ts";
import { expandMathbb } from "./math-util.ts";

// Re-export the lightweight helpers so existing importers keep one entry point.
export { SENTINEL, stamp, mergeStats, copyKatexAssets, type BakeStats } from "./bake-util.ts";

// Repo-root-relative (builder/src/bake.ts -> ../..), so the cache resolves
// regardless of cwd.
const CARD_CACHE = join(import.meta.dirname, "..", "..", "linkcard-cache.json");

// Rendered verbatim, never highlighted, never an error: plaintext aliases plus
// languages we have no tree-sitter grammar for and deliberately show plain --
// `ditaa` (an org-babel diagram DSL that also emits a generated image) and
// `plantuml`. They still go through the highlighter as `text` for the same
// `.hl` / `.line` framing as every other block. (dot/fortran/org ARE
// highlighted now -- see highlight.ts + grammars/.)
const PLAIN = new Set(["txt", "text", "plaintext", "plain", "ditaa", "plantuml"]);

// --- tree-sitter setup -----------------------------------------------------
// web-tree-sitter parses a code STRING and we emit HTML from the highlight
// query, so -- like Shiki before it -- no live DOM is needed. The engine
// (dual-theme + line numbers + diff-<lang> + coderefs) lives in highlight.ts.
await initHighlighter();

// --- counters --------------------------------------------------------------
let nPlain = 0;
let nDom = 0;
let nUnknown = 0;
let nHlError = 0;
let nMath = 0;
let nMathError = 0;
let nCards = 0;
let nCardMiss = 0;
const unknownLangs = new Set<string>();
const missingCards = new Set<string>();
const warn = (m: string): void => {
  console.warn(`  ! ${m}`);
};
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function getStats(): BakeStats {
  return {
    nPlain,
    nDom,
    nUnknown,
    nHlError,
    nMath,
    nMathError,
    nCards,
    nCardMiss,
    unknownLangs: [...unknownLangs],
    missingCards: [...missingCards],
  };
}
export function resetStats(): void {
  nPlain = 0;
  nDom = 0;
  nUnknown = 0;
  nHlError = 0;
  nMath = 0;
  nMathError = 0;
  nCards = 0;
  nCardMiss = 0;
  unknownLangs.clear();
  missingCards.clear();
}

// --- code highlighting -----------------------------------------------------
// Each `<pre><code class="language-XX">` carries the raw source as text plus the
// opt-in metadata render.tsx attached: `data-line-numbers`/`data-line-start`
// (org `-n`/`+n`) and `data-coderefs`/`data-coderef-block` (the `(ref:label)`
// callouts). highlight() turns that into a fresh `<pre class="hl">`, swapped in
// for the placeholder.
function swapPre(document: Document, pre: ChildNode, html: string): void {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const node = tmp.firstElementChild;
  if (node) {
    pre.replaceWith(node);
  }
}

function codeOpts(code: HTMLElement): HlOpts {
  const { coderefs, lineStart, coderefBlock } = code.dataset;
  const opts: HlOpts = {
    lineNumbers: Object.hasOwn(code.dataset, "lineNumbers"),
    lineStart: lineStart === undefined || lineStart === "" ? 1 : Number(lineStart),
  };
  if (coderefBlock !== undefined) {
    opts.coderefBlock = Number(coderefBlock);
  }
  if (coderefs !== undefined && coderefs !== "") {
    opts.coderefs = parseTrustedJson<Coderef[]>(coderefs);
  }
  return opts;
}

function highlightCode(document: Document): void {
  for (const code of document.querySelectorAll<HTMLElement>("pre code[class*='language-']")) {
    const lc = (code.getAttribute("class") ?? "").split(/\s+/u).find((c) => c.startsWith("language-"));
    const pre = code.parentElement;
    if (lc === undefined || pre === null) {
      continue;
    }
    const lang = lc.slice("language-".length);
    let html: string | null = null;
    try {
      // PLAIN languages go through the highlighter as `text` -- same framing, no colours.
      html = highlight(code.textContent, PLAIN.has(lang) ? "text" : lang, codeOpts(code));
    } catch (error) {
      nHlError++;
      warn(`highlight failed (${lang}): ${errorText(error)}`);
      continue;
    }
    if (html === null) {
      nUnknown++;
      unknownLangs.add(lang);
      warn(`unknown language: ${lang}`);
      continue;
    }
    swapPre(document, pre, html);
    if (PLAIN.has(lang)) {
      nPlain++;
    } else {
      nDom++;
    }
  }
}

// --- math ------------------------------------------------------------------
const SKIP_MATH = new Set(["PRE", "CODE", "SCRIPT", "STYLE"]);
// oxlint-disable-next-line eslint/require-unicode-regexp -- bun (JSC) drops backreference matches on non-ASCII input under `u`
const MATH_RE = /\\\((.+?)\\\)|\\\[([\s\S]+?)\\\]|\\begin\{([a-z*]+)\}([\s\S]+?)\\end\{\3\}/g;

const SHOW_TEXT = 0x4;
const TEXT_NODE = 3;
const isText = (n: Node): n is Text => n.nodeType === TEXT_NODE;

const inSkippedElement = (n: Node): boolean => {
  for (let p = n.parentNode; p; p = p.parentNode) {
    if (SKIP_MATH.has(p.nodeName)) {
      return true;
    }
  }
  return false;
};

function renderMath(document: Document): void {
  const walker = document.createTreeWalker(document.body, SHOW_TEXT);
  const targets: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (isText(n) && !inSkippedElement(n) && /\\\(|\\\[|\\begin\{/u.test(n.data)) {
      targets.push(n);
    }
  }
  for (const node of targets) {
    const text = node.data;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(MATH_RE)) {
      if (m.index > last) {
        frag.append(document.createTextNode(text.slice(last, m.index)));
      }
      const [whole, inline, display, env, envBody] = m;
      const displayMode = display !== undefined || env !== undefined;
      const tex = expandMathbb(inline ?? display ?? `\\begin{${env ?? ""}}${envBody ?? ""}\\end{${env ?? ""}}`);
      const span = document.createElement("span");
      let html: string;
      try {
        // throwOnError:true lets us *detect* a genuine parse error; strict:false
        // silences cosmetic LaTeX-incompatibility notices (Japanese in math
        // mode, `\\` in display) that render fine and aren't ours to fix.
        html = renderToString(tex, { displayMode, throwOnError: true, strict: false });
      } catch (error) {
        nMathError++;
        warn(`katex: ${errorText(error).split("\n")[0] ?? ""}`);
        // ...then re-render leniently so the page still gets red error text.
        html = renderToString(tex, { displayMode, throwOnError: false, strict: false });
      }
      span.innerHTML = html;
      frag.append(span);
      nMath++;
      last = m.index + whole.length;
    }
    if (last < text.length) {
      frag.append(document.createTextNode(text.slice(last)));
    }
    node.replaceWith(frag);
  }
}

// --- link cards ------------------------------------------------------------
// Emacs turns `[[card:URL]]` into `<a class="link-card" href data-link-card>`;
// here we fill it from the committed cache (populated offline by `just
// linkcards` -> scripts/fetch-linkcards.ts). A URL missing from the cache
// degrades to a plain link and, under --strict (CI/nix), fails the build -- so
// the offline build always has the metadata it needs in source.
let cards = new Map<string, Card>();
try {
  const text = await readFile(CARD_CACHE, "utf8");
  cards = new Map(Object.entries(parseTrustedJson<Record<string, Card>>(text)));
} catch {
  /* no cache yet -- every card will degrade (and fail strict) */
}

const esc = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function addClass(el: Element, cls: string): void {
  const cur = (el.getAttribute("class") ?? "").split(/\s+/u).filter(Boolean);
  if (!cur.includes(cls)) {
    cur.push(cls);
  }
  el.setAttribute("class", cur.join(" "));
}

// Replace the placeholder anchor with a block element. If the anchor is the
// sole content of its parent `<p>` (the usual case -- a card on its own line),
// replace that `<p>`, so the block isn't nested inside a paragraph; otherwise
// replace the anchor in place.
function replaceWithBlock(a: Element, html: string, document: Document): void {
  const p = a.parentElement?.closest("p") ?? null;
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const node = tmp.firstElementChild;
  if (!node) {
    return;
  }
  const target = p !== null && p.textContent.trim() === a.textContent.trim() ? p : a;
  target.replaceWith(node);
}

// GitHub code embeds are highlighted by tree-sitter like the rest of the site,
// with a line-number gutter starting at the real source line (`lineStart`). The
// dual-theme colours are class-based and the CSS is global (style.css), so
// there's no per-page stylesheet to inject.
function renderGitHubCode(a: Element, url: string, c: Card, document: Document): void {
  // Header leads with `filename:Lnn` (leftmost); repo + ref pushed to the right.
  const start = String(c.startLine);
  const lines = c.startLine === c.endLine ? `L${start}` : `L${start}-L${String(c.endLine)}`;
  const ref = c.refLabel === undefined || c.refLabel === "" ? "" : ` @ ${c.refLabel}`;
  const repo = `${c.owner ?? ""}/${c.repo ?? ""}${ref}`;
  // A code-repo mark (Lucide `git-branch`, stroked, inlined so no external
  // request) + a ↗ next to the line range mark the header as an external link,
  // since the tree-sitter-highlighted body otherwise reads as a plain code block. We
  // use a generic stand-in rather than the real GitHub logo on purpose: GitHub's
  // brand guidelines forbid recolouring, and `gh-embed-icon` is themed/tinted
  // with `currentColor`. Matches the nav's stand-in (see `my-icon-github`).
  const ghIcon =
    '<svg class="gh-embed-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M15 6a9 9 0 0 0-9 9V3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/></svg>';
  const head =
    `${ghIcon}<span class="gh-embed-loc">` +
    `<span class="gh-embed-path">${esc(c.path ?? "")}</span>` +
    `<span class="gh-embed-lines">:${esc(lines)}</span>` +
    `<span class="gh-embed-ext" aria-hidden="true">↗</span>` +
    `</span>` +
    `<span class="gh-embed-repo">${esc(repo)}</span>`;

  let codeBlock: string;
  let hl: string | null = null;
  if (c.lang !== undefined && c.lang !== "") {
    try {
      hl = highlight(c.code ?? "", c.lang, { lineNumbers: true, lineStart: c.startLine ?? 1 });
    } catch (error) {
      nHlError++;
      warn(`gh embed highlight failed (${c.lang}): ${errorText(error)}`);
    }
  }
  if (hl === null) {
    codeBlock = `<pre class="gh-embed-code gh-embed-plain hl"><code>${esc(c.code ?? "")}</code></pre>`;
  } else {
    // Tag the highlighter's <pre> with the card class (its output always opens `<pre class="hl`).
    codeBlock = hl.replace('<pre class="hl', '<pre class="gh-embed-code hl');
    nDom++;
  }

  const html =
    `<figure class="gh-embed">` +
    `<figcaption class="gh-embed-head">` +
    `<a href="${esc(url)}" target="_blank" rel="noopener">${head}</a>` +
    `</figcaption>${codeBlock}</figure>`;
  replaceWithBlock(a, html, document);
  nCards++;
}

const nonEmpty = (s: string | undefined): s is string => s !== undefined && s !== "";

function renderLinkCards(document: Document): void {
  for (const a of document.querySelectorAll<HTMLElement>("a[data-link-card]")) {
    delete a.dataset["linkCard"];
    const url = a.getAttribute("href") ?? "";
    const card = cards.get(url);
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
    try {
      host = new URL(url).hostname;
    } catch {
      /* keep empty */
    }
    const site = esc(nonEmpty(card.siteName) ? card.siteName : host);
    const favicon = nonEmpty(card.favicon)
      ? `<img class="link-card-favicon" src="${esc(card.favicon)}" alt="" loading="lazy" decoding="async" width="16" height="16">`
      : "";
    const desc = nonEmpty(card.description) ? `<span class="link-card-desc">${esc(card.description)}</span>` : "";
    const image = nonEmpty(card.image)
      ? `<span class="link-card-image"><img src="${esc(card.image)}" alt="" loading="lazy" decoding="async"></span>`
      : "";
    const title = esc(nonEmpty(card.title) ? card.title : url);
    a.innerHTML =
      `<span class="link-card-text">` +
      `<span class="link-card-title">${title}</span>${desc}<span class="link-card-site">${favicon}${site}</span>` +
      `</span>${image}`;
    nCards++;
  }
}

// --- keyboard access to scrollable blocks ----------------------------------
// simple.css gives every `<pre>` `overflow: auto`, so any block wider than the
// column can only be scrolled by dragging it -- a keyboard-only user cannot read
// past the right edge (WCAG 2.1.1; axe: scrollable-region-focusable). A tab stop
// makes the arrow keys scroll it.
//
// Applied to EVERY `<pre>`, unconditionally, rather than only the ones that
// actually overflow. Overflow depends on the viewport, so it is not knowable at
// build time -- it was previously measured in the browser and the attribute set
// at runtime, which was the wrong trade: it put an accessibility affordance
// behind JS on a site that otherwise ships none, and it duplicated work the
// platform already does (Chromium 149 and Firefox 151 both put overflowing
// scroll containers in the tab order natively, and only the overflowing ones).
// The static attribute is a superset of that native behaviour, so it costs a
// no-op tab stop on blocks that happen to fit -- a median page has 3 code blocks
// -- and in exchange it needs no JS and also covers engines without the feature.
//
// Keyed off the element here rather than at the four places that emit a `<pre>`
// (highlight.ts, the GitHub-embed fallback, YARUO and plain example blocks), so
// a future fifth cannot miss it.
//
// Deliberately no `role`: `role="region"` would add dozens of landmarks to a
// screen reader's landmark menu, and any explicit role overrides `<pre>`'s own
// "preformatted text" semantics.
function focusableScrollBlocks(document: Document): void {
  for (const pre of document.querySelectorAll("pre")) {
    if (!pre.hasAttribute("tabindex")) {
      pre.setAttribute("tabindex", "0");
    }
  }
}

// --- public API ------------------------------------------------------------
// Bake one parsed document in place: highlight code, render math, fill cards.
export function bakeDocument(document: Document): void {
  highlightCode(document);
  renderMath(document);
  // Last: renderGitHubCode highlights its own (attached) <pre>, so running after
  // highlightCode keeps that pass from re-processing the embed's code.
  renderLinkCards(document);
  // After every pass that can create a <pre> (highlightCode swaps in fresh ones,
  // renderLinkCards builds the GitHub embeds).
  focusableScrollBlocks(document);
}
