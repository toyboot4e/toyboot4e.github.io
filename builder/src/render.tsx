// uniorg rendering core: org source -> page HTML string, plus the index /
// tag-page templates. Pure string production -- no disk, no bake. Shared by the
// render workers (articles) and the orchestrator (index + tag pages). See
// build.ts for how this fits into the parallel build.
import type { Element, Properties, Root, RootContent, Text } from "hast";
import { unified } from "unified";
import type { AffiliatedKeywords, ObjectType, OrgNode, TableRow } from "uniorg";
import parse from "uniorg-parse";
import { defaultOptions } from "uniorg-parse/lib/parse-options.js";
import uniorg2rehype, { type Options as RehypeOptions } from "uniorg-rehype";
import rehypeKatex from "rehype-katex";
import stringify from "rehype-stringify";
import { classes } from "./css-module.ts";
import { arrayOf, isBoolean, isString, nullable, objectOf } from "./guard.ts";
import { h, Fragment, raw, render, type Child, type Raw } from "./html.ts";
// Scoped CSS-module class maps, resolved directly by Vite (`vite build` at bundle
// time, vite-node under watch). Each default export is `{ authoredName: scopedName }`. The matching
// scoped CSS ships as components.min.css (emitted by assets.ts, linked in
// headHtml); Vite's `generateScopedName` (vite.config.ts) keeps the names in
// sync between this render and that CSS build.
import cardModule from "./styles/article-card.module.css";
import kbModule from "./styles/keyboard.module.css";
import tocModule from "./styles/toc.module.css";
import { keyboardStrokesHtml } from "./keyboard.tsx";
import { expandMathbb } from "./math-util.ts";

const card = classes(cardModule, "article-card.module.css");
const kb = classes(kbModule, "keyboard.module.css");
const toc = classes(tocModule, "toc.module.css");

export const SITE_URL = "https://toyboot4e.github.io/";

// Register `card` as a custom Org link type. uniorg-parse@3.2.2
// (rasendubi/uniorg#153) anchored
// link-type detection to the start of the link, so EXTENDING the default
// linkTypes list makes `[[card:URL]]` parse as `linkType:"card"` with the `card:`
// prefix stripped from `path`. Before the fix the type was mis-detected (the
// `https://` inside matched), so we had to sniff the raw link string instead.
const PARSE_OPTS = { linkTypes: [...defaultOptions.linkTypes, "card"] };

// --- static chrome (header / footer / disco) -------------------------------
// Inline nav/footer icon wrapper (Lucide, stroked). One <svg> with the shared
// attributes; the caller supplies the <path>/<circle>/<rect> children.
const NavIcon = ({ children }: { readonly children?: Child }): Raw => (
  <svg
    class="nav-icon"
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

// The chrome links repeat on every page, so a keyboard/screen-reader user hits
// them before the article every single time -- hence the skip link (WCAG 2.4.1)
// and the list markup (AT announces "list, 7 items" and can skip the whole run).
// Each landmark is NAMED: two unnamed <nav>s (chrome + ToC) are indistinguishable
// in a screen reader's landmark menu (axe: landmark-unique).
const SKIP_LINK = (
  <a class="skip-link" href="#main">
    本文へスキップ
  </a>
);

const HEADER = (
  <header role="banner">
    <nav aria-label="サイトナビゲーション">
      <ul>
        <li>
          <a href="/index.html">
            <NavIcon>
              <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
              <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </NavIcon>
            <span class="nav-label">Home</span>
          </a>
        </li>
        <li>
          <a href="https://atcoder.jp/users/toyboot4e">
            <NavIcon>
              <path d="M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978" />
              <path d="M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978" />
              <path d="M18 9h1.5a1 1 0 0 0 0-5H18" />
              <path d="M4 22h16" />
              <path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z" />
              <path d="M6 9H4.5a1 1 0 0 1 0-5H6" />
            </NavIcon>
            <span class="nav-label">AtCoder</span>
          </a>
        </li>
        <li>
          <a href="https://github.com/toyboot4e">
            <NavIcon>
              <path d="M15 6a9 9 0 0 0-9 9V3" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
            </NavIcon>
            <span class="nav-label">GitHub</span>
          </a>
        </li>
        <li>
          <a href="https://qiita.com/toyboot4e">
            <NavIcon>
              <path d="M15 18h-5" />
              <path d="M18 14h-8" />
              <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2" />
              <rect width="8" height="4" x="10" y="6" rx="1" />
            </NavIcon>
            <span class="nav-label">Qiita</span>
          </a>
        </li>
        <li>
          <a href="https://zenn.dev/toyboot4e">
            <NavIcon>
              <path d="M12 7v14" />
              <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
            </NavIcon>
            <span class="nav-label">Zenn</span>
          </a>
        </li>
        <li>
          <button id="theme-toggle" onclick="toggleTheme()" title="テーマ切替" aria-label="テーマ切替"></button>
        </li>
        <li>
          <button
            id="disco-toggle"
            onclick="window.toggleDisco && toggleDisco()"
            aria-pressed="true"
            title="ディスコボール切替"
            aria-label="ディスコボール切替"
          ></button>
        </li>
      </ul>
    </nav>
  </header>
);

const FOOTER = (
  <footer role="contentinfo">
    <p>
      Styled with <a href="https://simplecss.org/">Simple.css</a>
    </p>
    <nav aria-label="フッターリンク">
      <ul>
        <li>
          <a href="/index.html">
            <NavIcon>
              <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
              <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </NavIcon>
            <span class="nav-label">Home</span>
          </a>
        </li>
        <li>
          <a href="https://github.com/toyboot4e">
            <NavIcon>
              <path d="M15 6a9 9 0 0 0-9 9V3" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
            </NavIcon>
            <span class="nav-label">GitHub</span>
          </a>
        </li>
      </ul>
    </nav>
  </footer>
);

const DISCO_BODY = (
  <Fragment>
    <div class="disco-bg-light" aria-hidden="true"></div>
    <canvas id="disco-canvas" aria-hidden="true"></canvas>
  </Fragment>
);

const DISCO_HEAD = (
  <Fragment>
    {/* set the disco class before first paint from the persisted preference */}
    <script>
      {raw(
        "try{if(localStorage.getItem('toybeam-disco')!=='off')document.documentElement.classList.add('disco-on')}catch(e){}",
      )}
    </script>
    <script type="text/javascript" defer src="/style/disco.min.js"></script>
  </Fragment>
);

// --- keyword metadata (uniorg-extract-keywords pulls in a buggy dep) --------
export function readKeywords(text: string): Map<string, string> {
  const kw = new Map<string, string>();
  for (const [, key = "", value = ""] of text.matchAll(/^[ \t]*#\+([A-Za-z_]+):[ \t]*(.*?)[ \t]*$/gmu)) {
    const k = key.toUpperCase();
    if (!kw.has(k)) {
      kw.set(k, value);
    }
  }
  return kw;
}

// DETAILS block summaries, in document order -- uniorg drops `#+BEGIN_DETAILS
// <summary>` parameters, so we recover them from the raw source and consume them
// as the special-block handler fires.
function detailsSummaries(text: string): string[] {
  return Array.from(text.matchAll(/^[ \t]*#\+BEGIN_DETAILS[ \t]+(.+?)[ \t]*$/gimu), ([, s = ""]) => s);
}

// uniorg-parse does NOT attach affiliated keywords (CAPTION) to `table` nodes
// (it does for paragraphs/src-blocks), so a table's `#+CAPTION:` is lost at parse
// time. Recover it from raw source: one entry per table in document order, the
// caption string if the line(s) immediately above it set one, else null. The
// table handler consumes these in order.
function tableCaptions(text: string): (string | null)[] {
  const caps: (string | null)[] = [];
  let pending: string | null = null;
  let inTable = false;
  for (const line of text.split("\n")) {
    if (/^[ \t]*\|/u.test(line)) {
      if (!inTable) {
        caps.push(pending);
        inTable = true;
      }
      pending = null;
      continue;
    }
    inTable = false;
    const cap = /^[ \t]*#\+CAPTION:[ \t]*(.*?)[ \t]*$/iu.exec(line);
    if (cap) {
      pending = cap[1] ?? "";
    } else if (!/^[ \t]*#\+/u.test(line)) {
      // blank/text breaks the attachment
      pending = null;
    }
  }
  return caps;
}

// Thumbnail src normalization: http(s) as-is, else strip any leading
// `./` or `/` and prefix a single `/`. (Was prefixing `/img/`, which double-
// prefixed the common `img/foo.webp` value -> `/img/img/foo.webp`, a broken src.)
function thumbnailSrc(v: string | undefined): string | null {
  if (v === undefined || v.trim() === "") {
    return null;
  }
  if (/^https?:\/\//u.test(v)) {
    return v;
  }
  return `/${v.trim().replace(/^(?:\.\/|\/)+/u, "")}`;
}
function absUrl(v: string | null): string | null {
  if (v === null || /^https?:\/\//u.test(v)) {
    return v;
  }
  return SITE_URL.replace(/\/$/u, "") + v;
}

// Per-file render state threaded through the custom handlers.
type RenderState = {
  source: string; // the raw org source, for verbatim block slicing
  details: string[]; // `#+BEGIN_DETAILS <summary>` params, in order
  keyboards: string[]; // `#+BEGIN_KEYBOARD <layout>` params, in order
  blockCounter: { n: number }; // positional src-block counter (for coderef ids)
  tableCaps: (string | null)[]; // per-table caption HTML (recovered from source)
  tableCounter: { n: number }; // index into tableCaps, advanced per table
  captionN: { figure: number; listing: number; table: number }; // per-kind caption counters
  coderefIds: string[]; // coderef anchor ids, for the JS-free hover-highlight <style>
  lastLineNum: number; // last line number of the previous numbered block, for `+n`
};

// rehype-stringify passes `raw` nodes through verbatim (allowDangerousHtml).
type RawNode = { type: "raw"; value: string };
declare module "hast" {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- module augmentation needs an interface
  interface RootContentMap {
    raw: RawNode;
  }
  // oxlint-disable-next-line typescript/consistent-type-definitions -- module augmentation needs an interface
  interface ElementContentMap {
    raw: RawNode;
  }
}
const textNode = (value: string): Text => ({ type: "text", value });
const rawNode = (value: string): RawNode => ({ type: "raw", value });

type Handlers = NonNullable<RehypeOptions["handlers"]>;
type Ctx = ThisParameterType<NonNullable<Handlers["paragraph"]>>;
type Hast = RootContent;

// The `(ref:label)` coderef marker, matched in place. Org replaces just the
// marker with the label at its original position (the surrounding code, comment
// leader included, stays) -- it does NOT strip the rest of the line.
const CODEREF_RE = /\(ref:([^)]+)\)/u;

// Keyboard charts (`#+BEGIN_STENO`, `#+BEGIN_KEYBOARD <layout>`) are rendered
// by keyboard.tsx (layouts uni-v4 / qwerty-24). uniorg drops the special-block
// parameter line, so like DETAILS summaries the `#+BEGIN_KEYBOARD <layout>`
// params are recovered from raw source and consumed in document order.
function keyboardLayouts(text: string): string[] {
  return Array.from(text.matchAll(/^[ \t]*#\+BEGIN_KEYBOARD[ \t]*(\S*)[ \t]*$/gimu), ([, s = ""]) => s);
}

// `#+CAPTION: ...` lives in uniorg's `node.affiliated.CAPTION` (array of caption
// rows, each an array of inline org nodes); uniorg2rehype otherwise drops it.
// Convert the caption's inline nodes to hast. The parent passed to `toHast` must
// own them as `.children` (uniorg-rehype does a sibling lookup on the parent) --
// the caption lives in `affiliated`, not `org.children`, so wrap it in a
// synthetic parent or the lookup crashes.
function captionHast(ctx: Ctx, cap: ObjectType[]): Hast[] {
  return ctx.toHast(cap, { type: "paragraph", children: cap, affiliated: {}, contentsBegin: 0, contentsEnd: 0 });
}

const isInlineNodes = (v: unknown): v is ObjectType[] =>
  Array.isArray(v) && v.every((x) => typeof x === "object" && x !== null && "type" in x);

// The first `#+CAPTION:` row's inline nodes (uniorg keeps CAPTION as a list of rows).
function captionOf(affiliated: AffiliatedKeywords | undefined): ObjectType[] | null {
  const rows = affiliated?.["CAPTION"];
  const first: unknown = Array.isArray(rows) ? rows[0] : undefined;
  return isInlineNodes(first) ? first : null;
}

// Caption numbering, matching org HTML export: a per-kind, per-document counter
// (only captioned elements are counted) and a typed prefix span.
const CAPTION_LABEL = { figure: "Figure", listing: "Listing", table: "Table" } as const;
type CaptionKind = keyof typeof CAPTION_LABEL;

// Wrap `body` in <figure> with a numbered <figcaption>, e.g.
// `<figcaption><span class="figure-number">Figure 1: </span>{caption}</figcaption>`.
function captionedFigure(
  ctx: Ctx,
  st: RenderState,
  org: OrgNode,
  body: Hast[],
  kind: CaptionKind,
  capNodes: Hast[],
): Element {
  st.captionN[kind]++;
  const n = st.captionN[kind];
  const num = ctx.h(org, "span", { className: [`${kind}-number`] }, [
    textNode(`${CAPTION_LABEL[kind]} ${String(n)}: `),
  ]);
  return ctx.h(org, "figure", {}, [...body, ctx.h(org, "figcaption", {}, [num, ...capNodes])]);
}

// --- custom uniorg2rehype handlers (use `this.toHast` / `this.h`) -----------
// A null return falls through to uniorg-rehype's default handler.
function makeHandlers(st: RenderState): Handlers {
  return {
    // A captioned paragraph (usually a lone image) -> <figure> with the caption.
    // `#+ATTR_HTML` width is handled by uniorg-rehype + `liftMediaAttrs` (which
    // moves it onto the <img>), so it isn't touched here. Plain paragraphs fall
    // through to uniorg's default <p>.
    paragraph(org) {
      const cap = captionOf(org.affiliated);
      if (cap === null) {
        return null;
      }
      const kids = this.toHast(org.children, org).filter((n) => !(n.type === "text" && n.value.trim() === ""));
      const [only] = kids;
      const onlyImg = kids.length === 1 && only?.type === "element" && only.tagName === "img";
      const inner = onlyImg ? kids : [this.h(org, "p", {}, kids)];
      return captionedFigure(this, st, org, inner, "figure", captionHast(this, cap));
    },
    // Tables: replicate uniorg-rehype's default table rendering (so uncaptioned
    // tables are byte-identical) but wrap in <figure> when captioned -- the
    // default handler drops `#+CAPTION`. table.el tables fall through to default.
    table(org) {
      if (org.tableType === "table.el") {
        return null;
      }
      const table = this.h(org, "table", {}, []);
      const headRow = (row: TableRow): Element =>
        this.h(
          row,
          "tr",
          {},
          row.children.map((cell) => this.h(cell, "th", {}, this.toHast(cell.children, cell))),
        );
      let hasHead = false;
      let group: TableRow[] = [];
      for (const r of org.children) {
        if (r.rowType === "rule") {
          if (hasHead) {
            table.children.push(this.h(org, "tbody", {}, this.toHast(group, org)));
          } else {
            table.children.push(
              this.h(
                org,
                "thead",
                {},
                group.map((row) => headRow(row)),
              ),
            );
            hasHead = true;
          }
          group = [];
        }
        group.push(r);
      }
      if (group.length > 0) {
        table.children.push(this.h(org, "tbody", {}, this.toHast(group, org)));
      }
      // table captions come from raw source (uniorg drops them), pre-rendered to
      // HTML and consumed here in document order.
      const capHtml = st.tableCaps[st.tableCounter.n] ?? null;
      st.tableCounter.n++;
      if (capHtml === null || capHtml === "") {
        return table;
      }
      return captionedFigure(this, st, org, [table], "table", [rawNode(capHtml)]);
    },
    // uniorg-rehype renders EVERY latex-fragment as `span.math.math-inline`, so
    // `$$...$$` and `\\[...\\]` (display delimiters) never get display mode and end
    // up left-aligned inline -- only `\\begin{}` environments (latex-environment)
    // become centered `math-display`. Mirror the default handler but pick the
    // class from the delimiter, so rehype-katex renders display math centered.
    "latex-fragment"(org) {
      const display = org.value.startsWith("$$") || org.value.startsWith(String.raw`\[`);
      const cls = display ? ["math", "math-display"] : ["math", "math-inline"];
      return this.h(org, "span", { className: cls }, [textNode(expandMathbb(org.contents.trim()))]);
    },
    "special-block"(org) {
      const t = org.blockType.toUpperCase();
      const kids = this.toHast(org.children, org);
      if (t === "DETAILS") {
        // `st.details` holds summaries already converted org->HTML (`=code=`,
        // `*bold*`, `$math$`, ...), pre-rendered async in renderArticle since
        // this handler is sync; insert as raw so the markup isn't escaped.
        const summary = st.details.shift() ?? "詳細";
        return this.h(org, "details", {}, [this.h(org, "summary", {}, [rawNode(summary)]), ...kids]);
      }
      // YARUO/AA is ASCII art -- render the block's text VERBATIM (sliced from
      // source via uniorg's content offsets), not org-parsed: otherwise `_x_`
      // becomes a subscript, `''` curls, etc. <pre> preserves the spacing; the
      // CSS scrolls it on the x-axis instead of wrapping (raw source slice ->
      // <pre class="yaruo">).
      if (t === "YARUO" || t === "AA") {
        const verbatim = st.source.slice(org.contentsBegin, org.contentsEnd).replace(/\n$/u, "");
        return this.h(org, "pre", { className: ["yaruo"] }, [textNode(verbatim)]);
      }
      if (t === "STENO" || t === "KEYBOARD") {
        // The block body (sliced verbatim from source, not org-parsed) is a
        // pressed-key spec drawn as a static keyboard chart per stroke/line
        // (keyboard.tsx). STENO is the steno chord chart (uni-v4 layout,
        // `/`-separated strokes like `KAT/-S`); KEYBOARD reads its layout from
        // the block parameter recovered into `st.keyboards`.
        const layout = t === "STENO" ? "uni-v4" : (st.keyboards.shift() ?? "");
        const body = st.source.slice(org.contentsBegin, org.contentsEnd);
        const chart = this.h(
          org,
          "div",
          { className: [kb("outline")] },
          keyboardStrokesHtml(layout, body).map((v) => rawNode(v)),
        );
        // `#+CAPTION:` -> numbered <figure>, same as a captioned image. uniorg
        // attaches CAPTION to special-block nodes, so no source recovery needed.
        const cap = captionOf(org.affiliated);
        if (cap === null) {
          return chart;
        }
        return captionedFigure(this, st, org, [chart], "figure", captionHast(this, cap));
      }
      return null;
    },
    // Code blocks: emit the raw source as text plus opt-in metadata; the
    // tree-sitter highlighter (in bake.ts) does the highlighting + markup.
    // `(ref:label)` callouts are replaced
    // in-place with the bare label, and their line + char span recorded in
    // `data-coderefs` so the bake step re-creates the whole-line `<a class=
    // "coderef-off">` self-link + `<span class="coderef-anchor">` label (and prose
    // `[[(label)]]` jumps stay valid). Line numbers are opt-in via org's `-n`/`+n`.
    "src-block"(org) {
      const lang = org.language ?? "";
      // uniorg-parse sets `switches` but its types omit it.
      const switches = "switches" in org && typeof org.switches === "string" ? org.switches : "";
      // org switches: `-n [N]` numbers from N (default 1); `+n [N]` continues from
      // the previous numbered block (+N, default +1). No switch -> no gutter.
      const lnm = /(?:^|\s)([-+])n(?:\s+(\d+))?(?:\s|$)/u.exec(switches);
      const lineNumbers = lnm !== null;
      let lineStart = 1;
      if (lnm) {
        const [, sign, num] = lnm;
        const n = num === undefined ? 1 : Math.trunc(Number(num));
        lineStart = sign === "-" ? n : st.lastLineNum + n;
      }
      const lines = org.value.replace(/\n$/u, "").split("\n");
      if (lineNumbers) {
        st.lastLineNum = lineStart + lines.length - 1;
      }

      // Number only blocks that actually contain a coderef (NOT every src-block),
      // so the first coderef block is `coderef-1-…` regardless of how many plain
      // code blocks precede it. The prose `[[(label)]]` link reads the same counter.
      const hasCoderef = lines.some((l) => CODEREF_RE.test(l));
      if (hasCoderef) {
        st.blockCounter.n++;
      }
      const N = String(st.blockCounter.n);
      const coderefs: { line: number; label: string; start: number; end: number }[] = [];
      const outLines = lines.map((line, i) => {
        const m = CODEREF_RE.exec(line);
        if (!m) {
          return line;
        }
        const [marker, label = ""] = m;
        st.coderefIds.push(`coderef-${N}-${label}`);
        const before = line.slice(0, m.index);
        coderefs.push({ line: i, label, start: before.length, end: before.length + label.length });
        return before + label + line.slice(m.index + marker.length);
      });

      const cls = lang === "" ? ["src"] : ["src", `language-${lang}`];
      const attrs: Properties = { className: cls };
      if (coderefs.length > 0) {
        attrs["data-coderefs"] = JSON.stringify(coderefs);
        attrs["data-coderef-block"] = N;
      }
      if (lineNumbers) {
        attrs["data-line-numbers"] = "";
        if (lineStart !== 1) {
          attrs["data-line-start"] = String(lineStart);
        }
      }
      const pre = this.h(org, "pre", {}, [this.h(org, "code", attrs, [textNode(outLines.join("\n"))])]);
      const cap = captionOf(org.affiliated);
      return cap === null ? pre : captionedFigure(this, st, org, [pre], "listing", captionHast(this, cap));
    },
    link(org) {
      const { rawLink } = org;
      const kids = this.toHast(org.children, org);
      // [[card:URL]] -> placeholder the bake pass fills from the cache. `card` is
      // registered in PARSE_OPTS.linkTypes, so the parser hands us linkType
      // "card" with the prefix already stripped from `path`.
      if (org.linkType === "card") {
        const url = org.path;
        return this.h(org, "a", { className: ["link-card"], "data-link-card": "", href: url }, [textNode(url)]);
      }
      // coderef [[(label)]] -> jump to the anchor in the MOST-RECENTLY-rendered
      // src-block (positional, via the shared block counter). A flat
      // label->id map broke when the same label (e.g. `1`) repeats across blocks:
      // every `[[(1)]]` then pointed at the last block. The label is wrapped in
      // <span class="coderef-anchor"> to match the in-code anchor styling.
      if (org.linkType === "coderef") {
        const id = `coderef-${String(st.blockCounter.n)}-${org.path}`;
        const inner =
          kids.length > 0 ? kids : [this.h(org, "span", { className: ["coderef-anchor"] }, [textNode(org.path)])];
        return this.h(org, "a", { href: `#${id}` }, inner);
      }
      // internal .org links -> .html
      if (rawLink.includes(".org") && !/^[a-z]+:\/\//u.test(rawLink)) {
        const href = rawLink.replace(/^file:/u, "").replace(/\.org(::.*)?$/u, ".html");
        return this.h(org, "a", { href }, kids.length > 0 ? kids : [textNode(href)]);
      }
      // image-file links with no description -> <img src alt>. uniorg's default
      // emits the <img> but drops `alt`; Emacs sets alt=basename, so match it
      // (the `paragraph` handler then applies any `#+ATTR_HTML` width to it).
      if (kids.length === 0 && /\.(webp|png|jpe?g|gif|svg|avif|bmp)$/iu.test(rawLink)) {
        const src = rawLink.replace(/^file:/u, "");
        return this.h(org, "img", { src, alt: src.replace(/^.*\//u, "") });
      }
      // default handles http(s)/mailto/etc.
      return null;
    },
  };
}

type HNode = Root | RootContent;
const childrenOf = (n: HNode): readonly RootContent[] => ("children" in n ? n.children : []);
const isElement = (n: HNode): n is Element => n.type === "element";
const isTextNode = (n: HNode): n is Text => n.type === "text";
const isHeading = (n: HNode, levels: RegExp): n is Element => isElement(n) && levels.test(n.tagName);

// Move a `width`/`height` attribute off a <p>/<figure> onto the <img> inside it.
// uniorg-rehype proxies `#+ATTR_HTML` to the image only when it's the paragraph's
// *sole* child, but a paragraph keeps a trailing "\n" text node, so the width
// lands on the CONTAINER instead -- sizing the <p>/<figure> wider than the text
// column (the image then fills it and overflows). On the <img> it's capped by
// `img { max-width: 100% }`. Matches Emacs, which puts the width on the <img>.
const lift = (from: Properties, to: Properties, k: "width" | "height"): void => {
  if (from[k] != null && to[k] == null) {
    to[k] = from[k];
  }
};

function liftMediaAttrs(): (tree: Root) => void {
  const findImg = (n: HNode): Element | undefined => {
    if (isElement(n) && n.tagName === "img") {
      return n;
    }
    for (const c of childrenOf(n)) {
      const img = findImg(c);
      if (img) {
        return img;
      }
    }
    return undefined;
  };
  const walk = (n: HNode): void => {
    if (
      isElement(n) &&
      (n.tagName === "p" || n.tagName === "figure") &&
      (n.properties.width != null || n.properties.height != null)
    ) {
      const img = findImg(n);
      if (img) {
        lift(n.properties, img.properties, "width");
        lift(n.properties, img.properties, "height");
        delete n.properties.width;
        delete n.properties.height;
      }
    }
    for (const c of childrenOf(n)) {
      walk(c);
    }
  };
  return walk;
}

// org headlines render h1.. but the page <h1> is the title-block; demote by one.
function demoteHeadings(): (tree: Root) => void {
  const walk = (n: HNode): void => {
    if (isHeading(n, /^h[1-5]$/u)) {
      n.tagName = `h${String(Number(n.tagName.slice(1)) + 1)}`;
    }
    for (const c of childrenOf(n)) {
      walk(c);
    }
  };
  return walk;
}

// Self-link headlines (like Org's `org-html-self-link-headlines`): give each
// heading id="<text>" and wrap its content in <a href="#<text>">…</a>.
function headingSelfLinks(): (tree: Root) => void {
  const textOf = (n: HNode): string =>
    isTextNode(n)
      ? n.value
      : childrenOf(n)
          .map((c) => textOf(c))
          .join("");
  const hasLink = (n: HNode): boolean => (isElement(n) && n.tagName === "a") || childrenOf(n).some((c) => hasLink(c));
  const walk = (n: HNode): void => {
    if (isHeading(n, /^h[1-6]$/u)) {
      const id = textOf(n);
      // A textless headline (a stray `*** ` in the org source) would otherwise
      // get id="" and a self-link to `#` with nothing in it: an unnamed link
      // sitting in the tab order (axe: link-name). No text, no anchor.
      if (id.trim() === "") {
        return;
      }
      n.properties = { ...n.properties, id };
      // A headline whose text is itself a link (`* [[url][label]]`) must NOT
      // get the self-link wrapper: nested <a> is invalid HTML, and the parser
      // recovers by splitting it into an EMPTY <a> plus the real one -- an
      // unnamed link in the tab order on every such heading (axe: link-name).
      // The id alone still makes the heading a fragment target and ToC entry.
      if (!hasLink(n)) {
        n.children = [{ type: "element", tagName: "a", properties: { href: `#${id}` }, children: n.children }];
      }
      // headings don't nest
      return;
    }
    for (const c of childrenOf(n)) {
      walk(c);
    }
  };
  return walk;
}

// A headline that is nothing but math (`*** $S_1, S_2$`) renders to a self-link
// whose only content is KaTeX output: a `<math>` for AT plus an `aria-hidden`
// visual span. Name computation does not descend into MathML, so both the link
// and the heading come out UNNAMED -- "link" with nothing after it, and a
// heading a screen reader cannot announce or list.
//
// Must run AFTER rehype-katex: before it the TeX is still ordinary text, so
// there is no way to tell a math-only headline from a normal one. The label is
// the heading's own id, which is the raw headline text (`S_1, S_2`) -- not
// beautiful read aloud, but it is the real name and it matches what the ToC and
// the URL fragment already say.
const classNames = (n: Element): string[] => {
  const c = n.properties.className;
  const list = Array.isArray(c) ? c : [c];
  return list.filter((x): x is string => typeof x === "string");
};

const isKatex = (n: HNode): boolean => isElement(n) && classNames(n).join(",").includes("katex");

function nameMathOnlyHeadings(): (tree: Root) => void {
  // Text a name computation would actually use. KaTeX output is skipped
  // wholesale: its MathML branch is full of text nodes (`S`, `3`, and a
  // `<annotation>` holding the raw TeX) that no name computation reads, and its
  // visual branch is aria-hidden. Counting either would make every math heading
  // look adequately named.
  const nameText = (n: HNode): string => {
    if (isTextNode(n)) {
      return n.value;
    }
    return isKatex(n)
      ? ""
      : childrenOf(n)
          .map((c) => nameText(c))
          .join("");
  };
  const walk = (n: HNode): void => {
    if (isHeading(n, /^h[1-6]$/u)) {
      const [link] = n.children;
      const { id } = n.properties;
      if (
        typeof id === "string" &&
        id !== "" &&
        link?.type === "element" &&
        link.tagName === "a" &&
        nameText(link).trim() === ""
      ) {
        link.properties = { ...link.properties, "aria-label": id };
      }
      return;
    }
    for (const c of childrenOf(n)) {
      walk(c);
    }
  };
  return walk;
}

// preserve-breaks (Org's `org-export-preserve-breaks t`): every soft newline
// inside a paragraph / list item / quote becomes a <br> (an explicit `\\\\` already
// does, via uniorg's line-break node). uniorg leaves soft newlines as literal
// text, so HTML would collapse them to a space; convert them here. A newline
// (with surrounding horizontal whitespace, like a list item's
// continuation indent) -> <br>. The trailing newline that terminates a block is
// dropped (no trailing <br>). Skips code/verbatim and math: <pre>/<code> keep
// their newlines literally, and a text node still carrying \\(/\\[/\\begin{ is raw
// math the bake step renders -- splitting it would break the TeX.
const SKIP_BREAK_TAGS = new Set(["pre", "code", "script", "style", "textarea"]);
// Block-level neighbours: a newline butting against one of these (or a block
// boundary) is structural layout, not a line break -- e.g. the newline between
// a list item's text and its nested <ul>, or a paragraph's terminator.
// oxfmt-ignore
const BLOCK = new Set([
  "p", "ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th", "blockquote",
  "div", "pre", "figure", "figcaption", "h1", "h2", "h3", "h4", "h5", "h6",
  "details", "summary", "hr", "section", "dl", "dt", "dd",
]);
const MATH_DELIM = /\\\(|\\\[|\\begin\{/u;
const isMathEl = (n: Element): boolean => classNames(n).some((x) => x.includes("math") || x.includes("katex"));
const atBlock = (sib: HNode | undefined): boolean => sib === undefined || (isElement(sib) && BLOCK.has(sib.tagName));
const BR: Element = { type: "element", tagName: "br", properties: {}, children: [] };

// One text node's soft newlines -> text + <br> runs.
function breakText(text: string, prev: HNode | undefined, next: HNode | undefined): (Text | Element)[] {
  const parts = text.split(/[ \t]*\n[ \t]*/u);
  // a newline adjacent to a block element (or a block boundary) is
  // structural, not a <br>: drop the empty leading/trailing segment it
  // produced so no spurious break is emitted there.
  if (atBlock(next)) {
    while (parts.length > 1 && parts.at(-1) === "") {
      parts.pop();
    }
  }
  if (atBlock(prev)) {
    while (parts.length > 1 && parts[0] === "") {
      parts.shift();
    }
  }
  const out: (Text | Element)[] = [];
  for (const [i, p] of parts.entries()) {
    if (i > 0) {
      out.push({ ...BR, properties: {}, children: [] });
    }
    if (p !== "") {
      out.push(textNode(p));
    }
  }
  return out;
}

function walkBreaks(node: Root | Element, skip: boolean): void {
  const childSkip = node.type === "element" ? skip || SKIP_BREAK_TAGS.has(node.tagName) || isMathEl(node) : skip;
  const breakLines = <T extends RootContent>(kids: readonly T[]): (T | Text | Element)[] => {
    const out: (T | Text | Element)[] = [];
    for (const [idx, child] of kids.entries()) {
      if (!childSkip && isTextNode(child) && child.value.includes("\n") && !MATH_DELIM.test(child.value)) {
        out.push(...breakText(child.value, kids[idx - 1], kids[idx + 1]));
      } else {
        if (isElement(child)) {
          walkBreaks(child, childSkip);
        }
        out.push(child);
      }
    }
    return out;
  };
  if (node.type === "root") {
    node.children = breakLines(node.children);
    return;
  }
  node.children = breakLines(node.children);
}

function preserveLineBreaks(): (tree: Root) => void {
  return (tree) => {
    walkBreaks(tree, false);
  };
}

async function orgToBody(src: string, st: RenderState): Promise<string> {
  const file = await unified()
    .use(parse, PARSE_OPTS)
    .use(uniorg2rehype, { handlers: makeHandlers(st) })
    .use(liftMediaAttrs)
    .use(demoteHeadings)
    .use(headingSelfLinks)
    // uniorg emits math as <span class="math math-inline|display">; render it
    // here (the bake step only matches \(...\) delimiters, which uniorg consumes).
    .use(rehypeKatex, { throwOnError: false, strict: false })
    // ...and only now can we tell which self-links KaTeX left textless.
    .use(nameMathOnlyHeadings)
    // preserve-breaks AFTER katex, so display-math TeX (which can contain
    // newlines) is already rendered and won't be split.
    .use(preserveLineBreaks)
    .use(stringify, { allowDangerousHtml: true, closeSelfClosing: true })
    .process(src);
  return String(file);
}

// Render a short org string (e.g. a `#+TITLE:`) as inline HTML: `=org=` ->
// `<code>org</code>`, `$x$` -> KaTeX, links, emphasis. Strips the wrapping <p>.
// Used for titles in the article <h1> and the index/tag cards, which were
// previously HTML-escaped (so `=org=` showed literally). Listing pages link
// katex.min.css only when a shown card title actually has math (listingHasMath).
async function orgInlineToHtml(s: string): Promise<string> {
  const out = String(
    await unified()
      .use(parse)
      .use(uniorg2rehype)
      .use(rehypeKatex, { throwOnError: false, strict: false })
      .use(stringify, { allowDangerousHtml: true, closeSelfClosing: true })
      .process(s),
  );
  return out.replace(/^\s*<p>([\s\S]*?)<\/p>\s*$/u, "$1").trim();
}

// Org string -> PLAIN text for <title> / og:title: convert org to HTML (so the
// markup syntax chars like `=`, `~`, `*` are consumed) and strip all tags. No
// KaTeX -- math stays as its readable source (`\TeX{}`) rather than katex spans.
// Entities are decoded back to text (re-escaped later for the HTML context).
async function orgInlineToText(s: string): Promise<string> {
  const out = String(
    await unified().use(parse).use(uniorg2rehype).use(stringify, { allowDangerousHtml: true }).process(s),
  );
  return out
    .replace(/^\s*<p>([\s\S]*?)<\/p>\s*$/u, "$1")
    .replaceAll(/<[^>]+>/gu, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .trim();
}

// --- page assembly ----------------------------------------------------------
export type Meta = {
  href: string;
  title: string;
  titleHtml: string;
  titleText: string;
  date: string;
  dateIso: string;
  tags: string[];
  thumbnail: string | null;
  draft: boolean;
  description: string;
};

export const isMeta = objectOf<Meta>({
  href: isString,
  title: isString,
  titleHtml: isString,
  titleText: isString,
  date: isString,
  dateIso: isString,
  tags: arrayOf(isString),
  thumbnail: nullable(isString),
  draft: isBoolean,
  description: isString,
});

const FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔦</text></svg>";

function headHtml(m: {
  title: string;
  description: string;
  url: string;
  thumbnail: string | null;
  hasCode: boolean;
  hasMath: boolean;
}): Raw {
  const img = absUrl(m.thumbnail);
  const twitter = img === null ? "summary" : "summary_large_image";
  return (
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      {/* The site title is the suffix, so the home page would read "Toybeam -
          Toybeam" -- the first thing a screen reader announces on page load. */}
      <title>{m.title === "Toybeam" ? "Toybeam" : `${m.title} - Toybeam`}</title>
      <meta name="description" content={m.description} />
      <link rel="icon" href={FAVICON} />
      <link rel="stylesheet" href="/style/simple.min.css" />
      <link rel="stylesheet" href="/style/style.min.css" />
      <link rel="stylesheet" href="/style/components.min.css" />
      {/* tree-sitter highlight colours are class-based (dual-theme palette);
          the `.hl` / coderef / diff / line-number rules live in style.css. */}
      {m.hasMath && <link rel="stylesheet" href="/style/katex/katex.min.css" />}
      <script type="text/javascript" src="/style/style.js"></script>
      {DISCO_HEAD}
      <meta property="og:type" content="article" />
      <meta property="og:title" content={m.title} />
      <meta property="og:description" content={m.description} />
      <meta property="og:url" content={m.url} />
      <meta property="og:site_name" content="Toybeam" />
      <meta property="og:locale" content="ja_JP" />
      {img !== null && <meta property="og:image" content={img} />}
      <meta name="twitter:card" content={twitter} />
      <meta name="twitter:creator" content="@toyboot4e" />
      <meta name="twitter:site" content="@toyboot4e" />
      {img !== null && <meta name="twitter:image" content={img} />}
    </head>
  );
}

// A run of tag links: real list markup, so AT announces "list, N items" and can
// jump past it instead of reading every tag as a loose link. `.org-tag-list` was
// already a flex container with the links as items -- the <li> just takes over as
// the flex item (CSS resets the marker/padding), so the layout is unchanged.
function tagListHtml(tags: string[]): Raw {
  return (
    <Fragment>
      {tags.map((t) => (
        <li>
          <a href={`/tags/${t}.html`} class="org-tag">
            <code>{t}</code>
          </a>
        </li>
      ))}
    </Fragment>
  );
}

// Open tags of the headings a ToC lists (h2-h4 -- h1 is the page title). Matches
// the `<h2 id="...">` the render pipeline emits (id via headingSelfLinks), robust
// to attribute order.
// oxlint-disable-next-line eslint/require-unicode-regexp -- bun (JSC) drops backreference matches on non-ASCII input under `u`
const TOC_HEADING_RE = /<h([2-4])\b([^>]*)>([\s\S]*?)<\/h\1>/g;

// Decode the handful of entities that survive tag-stripping back to text, so the
// JSX label child re-escapes them exactly once (otherwise `&lt;` -> `&amp;lt;`).
// `&amp;` is decoded last so it can't re-introduce another entity.
function decodeEntities(s: string): string {
  return s
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

type TocItem = { level: string; id: string; label: string };

// Scoped indentation class per heading level (the list is flat, so the depth is
// expressed by the link's class, not by nested <ul>s).
function tocNodeClass(level: string): string {
  return toc(`nodeH${level}`);
}

// Build the static table of contents from a page's content HTML: a flat list of
// links to its h2-h4 headings. Returns the `<nav>` plus the heading count, so the
// caller can skip the scrollspy script when empty. The nav keeps a global
// `id="toc"` purely as the scrollspy's hook; styling is the scoped CSS module
// (build/styles/toc.module.css). Replaces the old client-side tocbot.
function buildToc(contentHtml: string): { nav: Raw; count: number } {
  const items: TocItem[] = [];
  for (const [, level = "", attrs = "", inner = ""] of contentHtml.matchAll(TOC_HEADING_RE)) {
    const id = /\sid="([^"]*)"/u.exec(attrs)?.[1];
    if (id === undefined || id === "") {
      continue;
    }
    // strip the inner self-link anchor / inline markup down to plain text
    const label = decodeEntities(inner.replaceAll(/<[^>]+>/gu, ""))
      .replaceAll(/\s+/gu, " ")
      .trim();
    if (label === "") {
      continue;
    }
    items.push({ level, id, label });
  }
  const nav = (
    <nav id="toc" class={toc("toc")} aria-label="目次">
      {items.length > 0 && (
        <ul class={toc("tocList")}>
          {items.map((it) => (
            <li>
              <a class={`${toc("tocLink")} ${tocNodeClass(it.level)}`} href={`#${it.id}`}>
                {it.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
  return { nav, count: items.length };
}

function page(opts: { htmlClass?: string; head: Raw; titleBlock: Raw; content: Raw }): Raw {
  // h(...) builds strings eagerly, so the content is already serialised here --
  // scan it for headings and emit the ToC statically (no client-side pass).
  const { nav, count } = buildToc(render(opts.content));
  return (
    <Fragment>
      {raw("<!DOCTYPE html>")}
      <html lang="ja" class={opts.htmlClass}>
        {opts.head}
        <body>
          {DISCO_BODY}
          {SKIP_LINK}
          {HEADER}
          {/* tabindex="-1" so the skip link actually MOVES focus here; without it
              the browser only scrolls and the AT cursor stays in the header. */}
          <main id="main" tabindex="-1">
            {opts.titleBlock}
            <div id="content">{opts.content}</div>
            {nav}
          </main>
          {FOOTER}
          {/* scrollspy only -- the ToC list itself is static (buildToc); ship it
              only on pages that actually have a ToC */}
          {count > 0 && <script type="text/javascript" defer src="/style/toc.min.js"></script>}
        </body>
      </html>
    </Fragment>
  );
}

// JS-free coderef hover-highlight. A prose `[[(label)]]` link and its code line
// both resolve to `#coderef-N-label`, but live in different DOM subtrees, so no
// plain combinator connects them. `:has()` does: when a link to `#ID` is hovered
// anywhere in `#content`, highlight the element `#ID` (the code line) -- the
// hover-to-highlight behavior without any runtime JS.
// CSS can't bind the hovered href to the target id generically, so we emit one
// rule per coderef id present on the page (there are only a handful).
function coderefHoverStyle(ids: string[]): Raw {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) {
    return raw("");
  }
  // CSS rule text (a stylesheet body, not HTML) -> raw inside a JSX <style>; it
  // must not be entity-escaped or the `a[href="#id"]` selectors would break.
  const rules = uniq
    .map(
      (id) =>
        `#content:has(a[href="#${id}"]:hover) #${id}{background-color:color-mix(in srgb,var(--accent-hover) 20%,transparent)}`,
    )
    .join("");
  return <style>{raw(rules)}</style>;
}

function articleTitleBlock(m: Meta): Raw {
  return (
    <div class="title-block">
      <h1>{raw(m.titleHtml)}</h1>
      <div class="title-meta">
        <time class="title-date" datetime={m.dateIso}>
          {m.date}
        </time>
        {m.tags.length > 0 && <ul class="org-tag-list">{tagListHtml(m.tags)}</ul>}
      </div>
    </div>
  );
}

// One card in the listing `<ul>`. The card IS the <li> (it was already the flex
// item), so AT announces "list, N items" and can step card-by-card instead of
// wading through an undifferentiated run of title/date/tag links.
function articleCard(m: Meta, eager: boolean): Raw {
  return (
    <li class={card("articleCard")}>
      <div class={card("articleCardBody")}>
        {/* data-article-card: a STABLE hook for tooling (og-preview.html scrapes
            the article list from index.html). The CSS-module class is content-
            hashed, so it can't be relied on. */}
        <div>
          <a href={m.href} data-article-card class={card("articleCardLink")}>
            {raw(m.titleHtml)}
          </a>
        </div>
        <div class={card("articleCardMeta")}>
          {/* <date> is not an HTML element -- it parsed as an unknown inline box
              with no date semantics at all. <time datetime> is the real one. */}
          <time datetime={m.dateIso}>{m.date}</time>
          <ul class="org-tag-list">{tagListHtml(m.tags)}</ul>
        </div>
      </div>
      {m.thumbnail !== null && (
        <img
          class={card("articleCardThumbnail")}
          src={m.thumbnail}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
        />
      )}
    </li>
  );
}

// --- date formatting: `<2025-10-05 Sun>` -> `Oct  5, 2025` ------------------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Machine-readable form of the same stamp, for <time datetime>.
function isoDate(stamp: string): string {
  return /(\d{4}-\d{2}-\d{2})/u.exec(stamp)?.[1] ?? "";
}
function fmtDate(stamp: string): string {
  const m = /(\d{4})-(\d{2})-(\d{2})/u.exec(stamp);
  if (!m) {
    return "";
  }
  const [, year = "", month = "", dom = ""] = m;
  const day = String(Number(dom));
  return `${MONTHS[Number(month) - 1] ?? ""} ${day.padStart(2, " ")}, ${year}`;
}

function firstParagraphText(body: string): string {
  const m = /<p>([\s\S]*?)<\/p>/u.exec(body);
  const text = (m?.[1] ?? "")
    .replaceAll(/<[^>]+>/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim();
  return text.length > 150 ? `${text.slice(0, 150)}…` : text;
}

// A keyword's value, or undefined when unset or empty (`#+TITLE:` with nothing after it).
const keyword = (kw: Map<string, string>, key: string): string | undefined => {
  const v = kw.get(key);
  return v === "" ? undefined : v;
};

// --- public rendering API ---------------------------------------------------
export type Rendered = { rel: string; isDiary: boolean; draft: boolean; meta: Meta; html: string };

// Render one article's source to its full page HTML (pre-bake) + metadata.
// `rel` is the output path relative to OUT (e.g. `diary/2023-09-24.html`).
export async function renderArticle(rel: string, text: string): Promise<Rendered> {
  const kw = readKeywords(text);
  const outRel = rel.replace(/\.org$/u, ".html");
  const tags = (kw.get("FILETAGS") ?? "")
    .split(":")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  // Pre-render table captions (org inline -> HTML) since the handler is sync.
  const tableCaps = await Promise.all(
    tableCaptions(text).map(async (c) => (c === null || c === "" ? null : orgInlineToHtml(c))),
  );
  const st: RenderState = {
    source: text,
    // org markup in each `#+BEGIN_DETAILS <summary>` -> HTML (the handler is sync)
    details: await Promise.all(detailsSummaries(text).map(async (s) => orgInlineToHtml(s))),
    keyboards: keyboardLayouts(text),
    blockCounter: { n: 0 },
    tableCaps,
    tableCounter: { n: 0 },
    captionN: { figure: 0, listing: 0, table: 0 },
    coderefIds: [],
    lastLineNum: 0,
  };
  const body = await orgToBody(text, st);
  const title = keyword(kw, "TITLE") ?? outRel;
  const meta: Meta = {
    href: `/${outRel}`,
    title, // raw org title (kept for reference)
    titleHtml: await orgInlineToHtml(title), // org markup -> HTML (w/ KaTeX); article <h1> + listing cards
    titleText: await orgInlineToText(title), // org markup stripped, for <title>/og
    date: fmtDate(kw.get("DATE") ?? ""),
    dateIso: isoDate(kw.get("DATE") ?? ""),
    tags,
    thumbnail: thumbnailSrc(kw.get("THUMBNAIL")),
    draft: false,
    description: keyword(kw, "DESCRIPTION") ?? firstParagraphText(body),
  };
  const html = render(
    page({
      head: headHtml({
        title: meta.titleText,
        description: meta.description,
        url: SITE_URL + outRel,
        thumbnail: meta.thumbnail,
        // hasMath gates `katex.min.css`. Catch BOTH math forms: `.katex` spans
        // already rendered by rehype-katex (org `$...$`, in the body or the title),
        // and raw `\(...\)` / `\[` / `\begin{}` delimiters the bake step renders
        // later. Missing the former shipped 47 math pages unstyled.
        hasCode: body.includes("language-"),
        hasMath:
          body.includes('class="katex') || meta.titleHtml.includes('class="katex') || /\\\(|\\\[|\\begin\{/u.test(body),
      }),
      titleBlock: articleTitleBlock(meta),
      content: (
        <Fragment>
          {raw(body)}
          {coderefHoverStyle(st.coderefIds)}
        </Fragment>
      ),
    }),
  );
  return { rel: outRel, isDiary: outRel.startsWith("diary/"), draft: keyword(kw, "DRAFT") !== undefined, meta, html };
}

// A card title may carry KaTeX (e.g. `$\TeX{}$`), rendered into titleHtml by
// rehype-katex. Ship katex.min.css on the listing only when some shown card
// actually needs it -- the common all-prose case stays free of the CSS payload.
const listingHasMath = (cards: Meta[]): boolean => cards.some((m) => m.titleHtml.includes('class="katex'));

// index.html: Tags / Devlog (timeline) / Diary -- three sections, in that order.
export function buildIndexHtml(metas: Meta[], diaryMetas: Meta[], allTags: string[]): string {
  const section = (id: string, cards: Meta[]): Raw => (
    <Fragment>
      <h2 id={id}>
        <a href={`#${id}`}>{id}</a>
      </h2>
      <ul class={card("articleList")}>{cards.map((m, i) => articleCard(m, i === 0))}</ul>
    </Fragment>
  );
  const hasMath = listingHasMath([...metas, ...diaryMetas]);
  return render(
    page({
      htmlClass: "home",
      head: headHtml({
        title: "Toybeam",
        description: "Devlog of toyboot4e",
        url: SITE_URL,
        thumbnail: null,
        hasCode: false,
        hasMath,
      }),
      titleBlock: (
        <div class="title-block">
          <h1>Toybeam</h1>
          <div class="title-meta">
            <span class="title-date"></span>
          </div>
        </div>
      ),
      content: (
        <Fragment>
          <h2 id="Tags">
            <a href="#Tags">Tags</a>
          </h2>
          <ul class="org-tag-list">{tagListHtml(allTags)}</ul>
          {section("Devlog (timeline)", metas)}
          {section("Diary", diaryMetas)}
        </Fragment>
      ),
    }),
  );
}

export function buildTagHtml(tag: string, tagged: Meta[], allTags: string[]): string {
  const hasMath = listingHasMath(tagged);
  return render(
    page({
      htmlClass: "home",
      head: headHtml({
        title: `Toybeam (#${tag})`,
        description: "Devlog of toyboot4e",
        url: `${SITE_URL}tags/${tag}.html`,
        thumbnail: null,
        hasCode: false,
        hasMath,
      }),
      titleBlock: (
        <div class="title-block">
          <h1>
            Toybeam (<code>#{tag}</code>)
          </h1>
          <div class="title-meta">
            <span class="title-date"></span>
          </div>
        </div>
      ),
      content: (
        <Fragment>
          <h2 id="Tags">
            <a href="#Tags">Tags</a>
          </h2>
          <ul class="org-tag-list">{tagListHtml(allTags)}</ul>
          <h2 id="Devlog">
            Devlog (<code>#{tag}</code>)
          </h2>
          <ul class={card("articleList")}>{tagged.map((m, i) => articleCard(m, i === 0))}</ul>
        </Fragment>
      ),
    }),
  );
}
