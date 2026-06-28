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

import { initHighlighter, highlight } from "./highlight.ts";
import katex from "katex";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { BakeStats } from "./bake-util.ts";
import { expandMathbb } from "./math-util.ts";

// Re-export the lightweight helpers so existing importers keep one entry point.
export { SENTINEL, stamp, mergeStats, copyKatexAssets, type BakeStats } from "./bake-util.ts";

// Repo-root-relative (builder/src/bake.ts -> ../..), so the cache resolves
// regardless of cwd.
const CARD_CACHE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "linkcard-cache.json");

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
let nPlain = 0, nDom = 0, nUnknown = 0, nHlError = 0;
let nMath = 0, nMathError = 0, nCards = 0, nCardMiss = 0;
const unknownLangs = new Set<string>();
const missingCards = new Set<string>();
const warn = (m: string) => console.warn(`  ! ${m}`);

export function getStats(): BakeStats {
  return {
    nPlain, nDom, nUnknown, nHlError, nMath, nMathError, nCards, nCardMiss,
    unknownLangs: [...unknownLangs], missingCards: [...missingCards],
  };
}
export function resetStats(): void {
  nPlain = nDom = nUnknown = nHlError = nMath = nMathError = nCards = nCardMiss = 0;
  unknownLangs.clear();
  missingCards.clear();
}

// --- code highlighting -----------------------------------------------------
// Each `<pre><code class="language-XX">` carries the raw source as text plus the
// opt-in metadata render.tsx attached: `data-line-numbers`/`data-line-start`
// (org `-n`/`+n`) and `data-coderefs`/`data-coderef-block` (the `(ref:label)`
// callouts). highlight() turns that into a fresh `<pre class="hl">`, swapped in
// for the placeholder.
function swapPre(document: any, pre: any, html: string): void {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const node = tmp.firstElementChild;
  if (node) pre.parentNode.replaceChild(node, pre);
}

function highlightCode(document: any): void {
  for (const code of document.querySelectorAll("pre code[class*='language-']")) {
    const lc = (code.getAttribute("class") || "").split(/\s+/).find((c: string) => c.startsWith("language-"));
    if (!lc) continue;
    const lang = lc.slice("language-".length);
    const pre = code.parentNode;
    const crAttr = code.getAttribute("data-coderefs");
    const opts = {
      lineNumbers: code.hasAttribute("data-line-numbers"),
      lineStart: code.getAttribute("data-line-start") ? Number(code.getAttribute("data-line-start")) : 1,
      coderefBlock: code.hasAttribute("data-coderef-block") ? Number(code.getAttribute("data-coderef-block")) : undefined,
      coderefs: crAttr ? JSON.parse(crAttr) : undefined,
    };
    let html: string | null = null;
    try {
      // PLAIN languages go through the highlighter as `text` -- same framing, no colours.
      html = highlight(code.textContent, PLAIN.has(lang) ? "text" : lang, opts);
    } catch (e: any) {
      nHlError++;
      warn(`highlight failed (${lang}): ${e?.message ?? e}`);
      continue;
    }
    if (html == null) {
      nUnknown++; unknownLangs.add(lang);
      warn(`unknown language: ${lang}`);
      continue;
    }
    swapPre(document, pre, html);
    if (PLAIN.has(lang)) nPlain++; else nDom++;
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
      const tex = expandMathbb(m[1] ?? m[2] ?? `\\begin{${m[3]}}${m[4]}\\end{${m[3]}}`);
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

// GitHub code embeds are highlighted by tree-sitter like the rest of the site,
// with a line-number gutter starting at the real source line (`lineStart`). The
// dual-theme colours are class-based and the CSS is global (style.css), so
// there's no per-page stylesheet to inject.
function renderGitHubCode(a: any, url: string, c: Card, document: any): void {
  // Header leads with `filename:Lnn` (leftmost); repo + ref pushed to the right.
  const lines =
    c.startLine === c.endLine ? `L${c.startLine}` : `L${c.startLine}-L${c.endLine}`;
  const repo = `${c.owner}/${c.repo}${c.refLabel ? ` @ ${c.refLabel}` : ""}`;
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
    ghIcon +
    `<span class="gh-embed-loc">` +
    `<span class="gh-embed-path">${esc(c.path || "")}</span>` +
    `<span class="gh-embed-lines">:${esc(lines)}</span>` +
    `<span class="gh-embed-ext" aria-hidden="true">↗</span>` +
    `</span>` +
    `<span class="gh-embed-repo">${esc(repo)}</span>`;

  let codeBlock: string;
  let hl: string | null = null;
  if (c.lang) {
    try {
      hl = highlight(c.code || "", c.lang, { lineNumbers: true, lineStart: c.startLine || 1 });
    } catch (e: any) {
      nHlError++;
      warn(`gh embed highlight failed (${c.lang}): ${e?.message ?? e}`);
    }
  }
  if (hl != null) {
    // Tag the highlighter's <pre> with the card class (its output always opens `<pre class="hl`).
    codeBlock = hl.replace('<pre class="hl', '<pre class="gh-embed-code hl');
    nDom++;
  } else {
    codeBlock = `<pre class="gh-embed-code gh-embed-plain hl"><code>${esc(c.code || "")}</code></pre>`;
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

// --- public API ------------------------------------------------------------
// Bake one parsed document in place: highlight code, render math, fill cards.
export function bakeDocument(document: any): void {
  highlightCode(document);
  renderMath(document);
  // Last: renderGitHubCode highlights its own (attached) <pre>, so running after
  // highlightCode keeps that pass from re-processing the embed's code.
  renderLinkCards(document);
}
