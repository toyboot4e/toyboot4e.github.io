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
const unknownLangs = new Set<string>();
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
  `math: ${nMath} rendered, ${nMathError} errored`,
);

if (STRICT && (nMathError > 0 || nUnknown > 0)) {
  console.error(
    `post: FAILED (strict) -- ${nMathError} math error(s), ` +
    `${nUnknown} unknown language(s)${unknownLangs.size ? `: ${[...unknownLangs].join(", ")}` : ""}`,
  );
  process.exit(1);
}
