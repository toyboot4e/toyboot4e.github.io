// Tree-sitter-based syntax highlighting (replaces Shiki). DOM-free: web-tree-sitter
// parses a code STRING and we emit HTML from the highlight/locals/injection queries.
//
// This implements the official `tree-sitter-highlight` algorithm (the one Helix
// and GitHub use) — NOT a naive "first capture wins" pass:
//   - LAST matching pattern wins for a node (curated queries put generic captures
//     first, specific ones later to override).
//   - locals.scm scope resolution: a `@local.reference` reuses the highlight of
//     its `@local.definition`, so genuine local variables don't get mislabeled by
//     broad fallback patterns (this is what gives real *semantic* highlighting,
//     e.g. a haskell function name coloured as a function, a bound var left plain).
//   - injections.scm: a sub-region is re-highlighted with another grammar
//     (makefile recipe → bash, markdown → markdown_inline, fenced code → its lang).
// Nesting is resolved by painting larger ranges first so inner nodes win.
//
// Grammars (.wasm) + queries (highlights/locals/injections .scm) are vendored from
// Helix's curated query set under `grammars/` (see grammars/vendor.sh); the
// hermetic build only READS them.
//
// Dual theme is CLASS-based: each token span gets an `hl-<bucket>` class coloured
// per theme by style.css. Capture-name → bucket mapping is CLASS_TABLE below.
//
// Wrapping handles the three corpus needs: line numbers (org `-n`/`+n`), diff-<lang>
// (+/- column), and `(ref:label)` coderef callouts.

import { Parser, Language, Query } from "web-tree-sitter";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url)); // builder/src
const WASM_DIR = join(HERE, "..", "grammars", "wasm");
const QUERY_DIR = join(HERE, "..", "grammars", "queries");

// org `#+BEGIN_SRC <tok>` language tokens that differ from the vendored grammar id.
const ALIAS: Record<string, string> = {
  hs: "haskell", sh: "bash", shell: "bash", elisp: "emacs-lisp",
  "c++": "cpp", "c#": "csharp", js: "javascript", ts: "typescript", yml: "yaml",
  "fortran-free-form": "fortran", md: "markdown", lisp: "commonlisp",
  "markdown.inline": "markdown_inline", "markdown-inline": "markdown_inline",
};

// Plaintext aliases: framed like every other block but never highlighted.
const PLAIN_TOKENS = new Set(["text", "txt", "plaintext", "plain"]);

// Capture name (Helix vocabulary, dotted hierarchy) -> colour bucket (CSS class
// suffix). Matched most-specific-first: a capture matches an entry when it equals
// the key or starts with `<key>.`. Anything unmatched (operators, punctuation,
// plain/parameter/member variables) renders as default foreground (no span).
//   com=comment kw=keyword str=string esc=escape rex=regex num=number/bool
//   fn=function ty=type/namespace/constructor con=constant vbi=builtin-var tag=tag
const CLASS_TABLE: [string, string][] = [
  ["constant.character.escape", "esc"],
  ["constant.numeric", "num"],
  ["constant.builtin.boolean", "num"],
  ["constant.character", "str"],
  ["constant.builtin", "con"],
  ["constant.macro", "con"],
  ["constant", "con"],
  ["comment", "com"],
  ["string.regexp", "rex"],
  ["string.special", "str"],
  ["string", "str"],
  ["character", "str"],
  ["escape", "esc"],
  ["number", "num"],
  ["boolean", "num"],
  ["type", "ty"],
  ["constructor", "ty"],
  ["namespace", "ty"],
  ["function", "fn"],
  ["keyword", "kw"],
  ["label", "con"],
  ["attribute", "con"],
  ["tag", "tag"],
  ["variable.builtin", "vbi"],
  // markdown markup
  ["markup.heading", "kw"],
  ["markup.bold", "con"], ["markup.strong", "con"],
  ["markup.italic", "ty"], ["markup.emphasis", "ty"],
  ["markup.raw", "str"], ["markup.inline", "str"],
  ["markup.link", "tag"],
  ["markup.list", "kw"],
  ["markup.quote", "com"],
];

// Returns the colour bucket for a capture name, or "" for default foreground.
function classOf(name: string): string {
  for (const [key, bucket] of CLASS_TABLE) {
    if (name === key || name.startsWith(key + ".")) return bucket;
  }
  return "";
}

/** A coderef callout on `line` (0-based); `[start,end)` is the label's char span. */
export type Coderef = { line: number; label: string; start: number; end: number };

export type HlOpts = {
  lineNumbers?: boolean; // org -n/+n switch present
  lineStart?: number; // 1-based first line number (default 1)
  coderefBlock?: number; // N for coderef-N-label ids
  coderefs?: Coderef[];
};

// `query` is highlights.scm + locals.scm combined (locals capture names —
// local.scope / local.definition[.kind] / local.reference — recognised by name).
// `inj` is the optional injections.scm query.
type Grammar = { language: Language; query: Query; inj?: Query };

let parser: Parser | undefined;
const grammars = new Map<string, Grammar>();

/** Build the parser + load every vendored grammar. Awaited once at bake startup. */
export async function initHighlighter(): Promise<void> {
  if (parser) return;
  const require = createRequire(import.meta.url);
  const runtimeWasm = require.resolve("web-tree-sitter/web-tree-sitter.wasm");
  await Parser.init({ locateFile: () => runtimeWasm });
  parser = new Parser();

  const ids = readdirSync(WASM_DIR)
    .filter((f) => f.endsWith(".wasm"))
    .map((f) => f.slice(0, -".wasm".length));
  for (const id of ids) {
    const language = await Language.load(readFileSync(join(WASM_DIR, `${id}.wasm`)));
    let src = readFileSync(join(QUERY_DIR, `${id}.scm`), "utf8");
    const localsPath = join(QUERY_DIR, `${id}.locals.scm`);
    if (existsSync(localsPath)) src += "\n" + readFileSync(localsPath, "utf8");
    // Local patches, appended LAST so they win (last-pattern-wins). These are our
    // own additions/overrides on top of Helix's queries and are NOT touched by
    // vendor.sh, so they survive re-vendoring.
    const localPath = join(QUERY_DIR, `${id}.local.scm`);
    if (existsSync(localPath)) src += "\n" + readFileSync(localPath, "utf8");
    const g: Grammar = { language, query: new Query(language, src) };
    const injPath = join(QUERY_DIR, `${id}.injections.scm`);
    if (existsSync(injPath)) g.inj = new Query(language, readFileSync(injPath, "utf8"));
    grammars.set(id, g);
  }
}

/** Canonical grammar id for an org language token, or null if we have no grammar. */
function canonical(lang: string): string | null {
  const id = ALIAS[lang] ?? lang;
  return grammars.has(id) ? id : null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Def = { name: string; hl: string };
type Scope = { end: number; defs: Def[] };

// Parse `src` with grammar `id` and paint colour buckets into `cls` at `offset`,
// implementing the official tree-sitter-highlight algorithm (see file header).
function paintInto(cls: (string | null)[], src: string, id: string, offset: number, depth: number): void {
  const g = grammars.get(id);
  if (!g) return;
  parser!.setLanguage(g.language);
  const tree = parser!.parse(src)!;

  const caps = g.query.captures(tree.rootNode);
  // Group same-node captures together (start asc, then outer-first), with the
  // LAST query pattern last so it wins the selection below.
  caps.sort((a, b) =>
    a.node.startIndex - b.node.startIndex ||
    b.node.endIndex - a.node.endIndex ||
    a.patternIndex - b.patternIndex);

  const scopes: Scope[] = [{ end: src.length, defs: [] }];
  const resolved: { s: number; e: number; hl: string }[] = [];

  let i = 0;
  while (i < caps.length) {
    const s = caps[i].node.startIndex;
    const e = caps[i].node.endIndex;
    while (scopes.length > 1 && s >= scopes[scopes.length - 1].end) scopes.pop();

    let def: Def | null = null;
    let refHl: string | undefined; // a local.reference reuses its definition's bucket
    let sel: string | undefined; // selected highlight bucket; last pattern wins

    // Consume every capture on this exact node.
    while (i < caps.length && caps[i].node.startIndex === s && caps[i].node.endIndex === e) {
      const name = caps[i].name;
      if (name === "local.scope") {
        scopes.push({ end: e, defs: [] });
      } else if (name === "local.definition-value") {
        /* value-range hint only; ignored */
      } else if (name.startsWith("local.definition")) {
        def = { name: src.slice(s, e), hl: "" };
        scopes[scopes.length - 1].defs.push(def);
      } else if (name === "local.reference") {
        const nm = src.slice(s, e);
        for (let k = scopes.length - 1; k >= 0 && refHl === undefined; k--) {
          for (let j = scopes[k].defs.length - 1; j >= 0; j--) {
            if (scopes[k].defs[j].name === nm) { refHl = scopes[k].defs[j].hl; break; }
          }
        }
      } else {
        sel = classOf(name); // highlight capture — keep advancing so the last wins
      }
      i++;
    }

    const bucket = sel ?? ""; // "" => default foreground
    if (def) def.hl = bucket;
    const emit = refHl !== undefined ? refHl : bucket;
    if (emit) resolved.push({ s, e, hl: emit });
  }

  // Collect injection regions (as plain values) before freeing the tree.
  const regions: { start: number; end: number; lang: string }[] = [];
  if (g.inj && depth < 3) {
    for (const m of g.inj.matches(tree.rootNode)) {
      let lang = m.setProperties?.["injection.language"];
      let content: { startIndex: number; endIndex: number } | null = null;
      for (const cap of m.captures) {
        if (cap.name === "injection.content") content = cap.node;
        else if (cap.name === "injection.language") lang = src.slice(cap.node.startIndex, cap.node.endIndex);
      }
      if (content && lang) regions.push({ start: content.startIndex, end: content.endIndex, lang });
    }
  }
  tree.delete();

  // Paint larger ranges first so inner (more specific) nodes override them.
  resolved.sort((a, b) => b.e - b.s - (a.e - a.s));
  for (const r of resolved) for (let k = r.s; k < r.e; k++) cls[offset + k] = r.hl;

  // Injected sub-regions overwrite the parent's colours for their range.
  for (const reg of regions) {
    const cid = canonical(reg.lang);
    if (cid) paintInto(cls, src.slice(reg.start, reg.end), cid, offset + reg.start, depth + 1);
  }
}

function paint(src: string, id: string): (string | null)[] {
  const cls: (string | null)[] = new Array(src.length).fill(null);
  paintInto(cls, src, id, 0, 0);
  return cls;
}

// Render one line's inner HTML: coalesce runs of equal colour bucket into
// `<span class="hl-X">`, breaking runs at the coderef-anchor boundaries and
// merging the `coderef-anchor` class onto the segments inside it (matching the
// old Shiki decoration output: a single span, not a nested wrapper).
function renderLine(src: string, cls: (string | null)[], ls: number, le: number, anchor: { s: number; e: number } | null): string {
  let html = "";
  let i = ls;
  while (i < le) {
    const k = cls[i];
    let j = i + 1;
    while (j < le && cls[j] === k && !(anchor && (j === anchor.s || j === anchor.e))) j++;
    const inAnchor = !!anchor && i >= anchor.s && i < anchor.e;
    const raw = src.slice(i, j);
    const text = esc(raw);
    const classes: string[] = [];
    // Colouring whitespace has no visual effect; skip the class to cut span noise.
    if (k && /\S/.test(raw)) classes.push("hl-" + k);
    if (inAnchor) classes.push("coderef-anchor");
    html += classes.length ? `<span class="${classes.join(" ")}">${text}</span>` : text;
    i = j;
  }
  return html;
}

type LineStatus = "add" | "remove" | "context";

// Assemble the full `<pre class="hl">…</pre>` from the painted source.
// `status` (diff only) marks add/remove lines; coderef opts retag whole lines.
function assemble(src: string, cls: (string | null)[], opts: HlOpts, status: LineStatus[] | null): string {
  const lineTexts = src.split("\n");
  const coderefByLine = new Map<number, Coderef>();
  for (const c of opts.coderefs ?? []) coderefByLine.set(c.line, c);

  const rows: string[] = [];
  let pos = 0;
  for (let ln = 0; ln < lineTexts.length; ln++) {
    const ls = pos;
    const le = pos + lineTexts[ln].length;
    pos = le + 1; // skip the '\n'

    const cr = coderefByLine.get(ln);
    const anchor = cr ? { s: ls + cr.start, e: ls + cr.end } : null;
    const inner = renderLine(src, cls, ls, le, anchor);

    const lineClasses = ["line"];
    if (status && status[ln] !== "context") lineClasses.push("diff", status[ln]);

    if (cr && opts.coderefBlock != null) {
      const id = `coderef-${opts.coderefBlock}-${cr.label}`;
      lineClasses.push("coderef-off");
      rows.push(`<a class="${lineClasses.join(" ")}" id="${id}" href="#${id}">${inner}</a>`);
    } else {
      rows.push(`<span class="${lineClasses.join(" ")}">${inner}</span>`);
    }
  }

  const preClasses = ["hl"];
  if (status) preClasses.push("diff");
  if (opts.lineNumbers) preClasses.push("line-numbers");
  const codeStyle = opts.lineNumbers ? ` style="counter-reset: ln ${(opts.lineStart ?? 1) - 1}"` : "";
  return `<pre class="${preClasses.join(" ")}"><code${codeStyle}>${rows.join("\n")}</code></pre>`;
}

// diff-<lang>: the org corpus marks changes with a leading `+`/`-` at column 0
// and leaves context lines unprefixed. Strip that column, highlight the aligned
// body as <lang>, then tag changed lines so CSS draws the +/- gutter + bg.
function highlightDiff(code: string, inner: string, opts: HlOpts): string {
  const lines = code.split("\n");
  const status: LineStatus[] = lines.map((l) => (l[0] === "+" ? "add" : l[0] === "-" ? "remove" : "context"));
  const bodies = lines.map((l, i) => (status[i] === "context" ? l : l.slice(1)));
  const body = bodies.join("\n");
  const id = canonical(inner); // e.g. diff-org -> null -> plain body, still diffed
  const cls = id ? paint(body, id) : new Array(body.length).fill(null);
  // Coderef char offsets were measured on the un-stripped line; on a +/- line the
  // body lost its 1-char prefix, so shift those decorations left by one.
  const shifted: HlOpts = {
    ...opts,
    coderefs: (opts.coderefs ?? []).map((c) =>
      status[c.line] === "context" ? c : { ...c, start: c.start - 1, end: c.end - 1 }),
  };
  return assemble(body, cls, shifted, status);
}

/**
 * Highlight `code` (lang = org language token). Returns the `<pre class="hl">…`
 * HTML, or null if we have no grammar for `lang` (caller renders it verbatim).
 */
export function highlight(code: string, lang: string, opts: HlOpts = {}): string | null {
  const src = code.replace(/\n$/, ""); // trailing newline -> no phantom last line
  // `diff` (plain) diffs a text body; `diff-<lang>` diffs <lang> source.
  if (lang === "diff" || lang.startsWith("diff-"))
    return highlightDiff(src, lang === "diff" ? "text" : lang.slice(5), opts);
  if (PLAIN_TOKENS.has(lang)) return assemble(src, new Array(src.length).fill(null), opts, null);
  const id = canonical(lang);
  if (!id) return null;
  return assemble(src, paint(src, id), opts, null);
}
