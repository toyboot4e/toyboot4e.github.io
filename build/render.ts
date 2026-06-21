// uniorg rendering core: org source -> page HTML string, plus the index /
// tag-page templates. Pure string production -- no disk, no bake. Shared by the
// render workers (articles) and the orchestrator (index + tag pages).
//
// This is the default build. The Emacs path (build.el + ox-slimhtml, run via
// `just build-emacs`) is the byte-for-byte reference this mirrors. See build.ts.
import { unified } from "unified";
import parse from "uniorg-parse";
import uniorg2rehype from "uniorg-rehype";
import rehypeKatex from "rehype-katex";
import stringify from "rehype-stringify";

export const SITE_URL = "https://toyboot4e.github.io/";

// --- static chrome (lifted verbatim from the canonical build) --------------
const HEADER = `<header role="banner"><nav role="navigation"><a href="/index.html"><svg class="nav-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg><span class="nav-label">Home</span></a><a href="https://atcoder.jp/users/toyboot4e"><svg class="nav-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978" /><path d="M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978" /><path d="M18 9h1.5a1 1 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z" /><path d="M6 9H4.5a1 1 0 0 1 0-5H6" /></svg><span class="nav-label">AtCoder</span></a><a href="https://github.com/toyboot4e"><svg class="nav-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6a9 9 0 0 0-9 9V3" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /></svg><span class="nav-label">GitHub</span></a><a href="https://qiita.com/toyboot4e"><svg class="nav-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18h-5" /><path d="M18 14h-8" /><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2" /><rect width="8" height="4" x="10" y="6" rx="1" /></svg><span class="nav-label">Qiita</span></a><a href="https://zenn.dev/toyboot4e"><svg class="nav-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v14" /><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" /></svg><span class="nav-label">Zenn</span></a><button id="theme-toggle" onclick="toggleTheme()" title="テーマ切替" aria-label="Toggle theme"></button><button id="disco-toggle" onclick="window.toggleDisco && toggleDisco()" aria-pressed="true" title="ディスコボール切替" aria-label="Toggle disco ball"></button></nav></header>`;
const FOOTER = `<footer role="contentinfo"><p>Styled with <a href="https://simplecss.org/">Simple.css</a></p><div><a href="/index.html"><svg class="nav-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg><span class="nav-label">Home</span></a><a href="https://github.com/toyboot4e"><svg class="nav-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6a9 9 0 0 0-9 9V3" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /></svg><span class="nav-label">GitHub</span></a></div></footer>`;
const TAIL = `<script type="text/javascript" src="/style/tocbot.min.js"></script><script>tocbot.init({ tocSelector: '#toc', contentSelector: '#content', headingSelector: 'h1, h2, h3, h4', collapseDepth: 6, scrollSmooth: false, orderedList: false });</script>`;
const DISCO_BODY = `<div class="disco-bg-light" aria-hidden="true"></div><canvas id="disco-canvas" aria-hidden="true"></canvas>`;
const DISCO_HEAD = `<script>try{if(localStorage.getItem('toybeam-disco')!=='off')document.documentElement.classList.add('disco-on')}catch(e){}</script><script type="text/javascript" defer src="/style/disco.min.js"></script>`;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// --- keyword metadata (uniorg-extract-keywords pulls in a buggy dep) --------
export function readKeywords(text: string): Record<string, string> {
  const re = /^[ \t]*#\+([A-Za-z_]+):[ \t]*(.*?)[ \t]*$/gm;
  const kw: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const k = m[1].toUpperCase();
    if (!(k in kw)) kw[k] = m[2];
  }
  return kw;
}

// DETAILS block summaries, in document order -- uniorg drops `#+BEGIN_DETAILS
// <summary>` parameters, so we recover them from the raw source and consume them
// as the special-block handler fires.
function detailsSummaries(text: string): string[] {
  return [...text.matchAll(/^[ \t]*#\+BEGIN_DETAILS[ \t]+(.+?)[ \t]*$/gim)].map((m) => m[1]);
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
    if (/^[ \t]*\|/.test(line)) {
      if (!inTable) { caps.push(pending); inTable = true; }
      pending = null;
      continue;
    }
    inTable = false;
    const cap = line.match(/^[ \t]*#\+CAPTION:[ \t]*(.*?)[ \t]*$/i);
    if (cap) pending = cap[1];
    else if (!/^[ \t]*#\+/.test(line)) pending = null; // blank/text breaks the attachment
  }
  return caps;
}

// Mirror build.el's `my-thumbnail-src`: http(s) as-is, else strip any leading
// `./` or `/` and prefix a single `/`. (Was prefixing `/img/`, which double-
// prefixed the common `img/foo.webp` value -> `/img/img/foo.webp`, a broken src.)
function thumbnailSrc(v?: string): string | null {
  if (!v || !v.trim()) return null;
  if (/^https?:\/\//.test(v)) return v;
  return "/" + v.trim().replace(/^(?:\.\/|\/)+/, "");
}
const absUrl = (v: string | null) =>
  v == null ? null : /^https?:\/\//.test(v) ? v : SITE_URL.replace(/\/$/, "") + v;

// Per-file render state threaded through the custom handlers.
type RenderState = {
  details: string[];          // `#+BEGIN_DETAILS <summary>` params, in order
  blockCounter: { n: number }; // mirrors build.el's `my-codeblock-counter`
  coderefs: Map<string, string>; // coderef label -> anchor id, updated in doc order
  tableCaps: (string | null)[];  // per-table caption HTML (recovered from source)
  tableCounter: { n: number };   // index into tableCaps, advanced per table
};

// The `(ref:label)` coderef marker, matched in place. Org replaces just the
// marker with the label at its original position (the surrounding code, comment
// leader included, stays) -- it does NOT strip the rest of the line.
const CODEREF_RE = /\(ref:([^)]+)\)/;

// `#+CAPTION: ...` lives in uniorg's `node.affiliated.CAPTION` (array of caption
// rows, each an array of inline org nodes); uniorg2rehype otherwise drops it.
// Convert the caption's inline nodes to hast. The parent passed to `toHast` must
// own them as `.children` (uniorg-rehype does a sibling lookup on the parent) --
// the caption lives in `affiliated`, not `org.children`, so wrap it in a
// synthetic parent or the lookup crashes.
function captionHast(ctx: any, cap: any[]): any[] {
  return ctx.toHast(cap, { type: "paragraph", children: cap });
}

// Wrap an element in <figure>…<figcaption> when it carries a caption, so the
// caption survives. (We don't add org's "Figure N:" auto-numbering.)
function captionWrap(ctx: any, org: any, node: any): any {
  const cap = org.affiliated?.CAPTION?.[0];
  if (!cap) return node;
  return ctx.h(org, "figure", {}, [node, ctx.h(org, "figcaption", {}, captionHast(ctx, cap))]);
}

// Parse an org `#+ATTR_HTML` plist (`[":width 75%", ":height 10"]`) into hast
// properties. Emacs applies these verbatim as element attributes.
function parseAttrHtml(arr: string[]): Record<string, string> {
  const props: Record<string, string> = {};
  const toks = arr.join(" ").trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].startsWith(":")) {
      props[toks[i].slice(1)] = toks[i + 1] && !toks[i + 1].startsWith(":") ? toks[++i] : "";
    }
  }
  return props;
}

// --- custom uniorg2rehype handlers (use `this.toHast` / `this.h`) -----------
function makeHandlers(st: RenderState) {
  return {
    // Paragraphs carrying `#+CAPTION` and/or `#+ATTR_HTML` (usually around a lone
    // image): apply the ATTR_HTML attributes to the image and, when captioned,
    // wrap in <figure>. Plain paragraphs fall through to uniorg's default <p>.
    paragraph: function (this: any, org: any) {
      const cap = org.affiliated?.CAPTION?.[0];
      const attr = org.affiliated?.ATTR_HTML;
      if (!cap && !attr) return undefined;
      const kids = this.toHast(org.children, org)
        .filter((n: any) => !(n.type === "text" && !String(n.value).trim()));
      if (attr) {
        // uniorg drops #+ATTR_HTML -> images lose their authored width and render
        // full-size. Apply it to the (first) img, matching Emacs.
        const props = parseAttrHtml(attr);
        const img = kids.find((k: any) => k.tagName === "img");
        if (img) img.properties = { ...img.properties, ...props };
      }
      if (!cap) return this.h(org, "p", {}, kids); // ATTR-only: keep the <p>
      const onlyImg = kids.length === 1 && kids[0].tagName === "img";
      const inner = onlyImg ? kids : [this.h(org, "p", {}, kids)];
      return this.h(org, "figure", {}, [...inner, this.h(org, "figcaption", {}, captionHast(this, cap))]);
    },
    // Tables: replicate uniorg-rehype's default table rendering (so uncaptioned
    // tables are byte-identical) but wrap in <figure> when captioned -- the
    // default handler drops `#+CAPTION`. table.el tables fall through to default.
    table: function (this: any, org: any) {
      if (org.tableType === "table.el") return undefined;
      const table = this.h(org, "table", {}, []);
      let hasHead = false;
      let group: any[] = [];
      org.children.forEach((r: any) => {
        if (r.rowType === "rule") {
          if (!hasHead) {
            table.children.push(this.h(org, "thead", {}, group.map((row: any) =>
              this.h(row, "tr", {}, row.children.map((cell: any) =>
                this.h(cell, "th", {}, this.toHast(cell.children, cell)))))));
            hasHead = true;
          } else {
            table.children.push(this.h(org, "tbody", {}, this.toHast(group, org)));
          }
          group = [];
        }
        group.push(r);
      });
      if (group.length) table.children.push(this.h(org, "tbody", {}, this.toHast(group, org)));
      // table captions come from raw source (uniorg drops them), pre-rendered to
      // HTML and consumed here in document order.
      const capHtml = st.tableCaps[st.tableCounter.n++];
      if (!capHtml) return table;
      return this.h(org, "figure", {}, [
        table,
        this.h(org, "figcaption", {}, [{ type: "raw", value: capHtml }]),
      ]);
    },
    "special-block": function (this: any, org: any) {
      const t = (org.blockType || "").toUpperCase();
      const kids = this.toHast(org.children, org);
      if (t === "DETAILS") {
        const summary = st.details.shift() ?? "詳細";
        return this.h(org, "details", {}, [
          this.h(org, "summary", {}, [{ type: "text", value: summary }]),
          ...kids,
        ]);
      }
      if (t === "YARUO" || t === "AA") return this.h(org, "div", { className: ["yaruo"] }, kids);
      if (t === "STENO") return this.h(org, "div", { className: ["steno"] }, kids);
      return undefined; // fall through to uniorg's default special-block
    },
    // Code blocks: replace each `(ref:label)` marker in place with an anchor
    // span (id=coderef-<N>-<label>) showing the label, so prose `[[(label)]]`
    // links can jump to it. The marker keeps its position in the line (comment
    // leader and surrounding code intact), matching org. The span is non-empty
    // (holds the label) so Prism's keep-markup re-tokenisation doesn't drop it.
    "src-block": function (this: any, org: any) {
      const lang = org.language || "";
      const N = ++st.blockCounter.n;
      const lines = String(org.value ?? "").replace(/\n$/, "").split("\n");
      const codeChildren: any[] = [];
      lines.forEach((line, i) => {
        const m = line.match(CODEREF_RE);
        if (m) {
          const label = m[1];
          const id = `coderef-${N}-${label}`;
          st.coderefs.set(label, id);
          const before = line.slice(0, m.index);
          const after = line.slice(m.index! + m[0].length);
          if (before) codeChildren.push({ type: "text", value: before });
          codeChildren.push(this.h(org, "span", { id, className: ["coderef-anchor"] }, [
            { type: "text", value: label },
          ]));
          if (after) codeChildren.push({ type: "text", value: after });
        } else {
          codeChildren.push({ type: "text", value: line });
        }
        if (i < lines.length - 1) codeChildren.push({ type: "text", value: "\n" });
      });
      // class="src language-XX" matches what the bake/Prism step expects; omit
      // the language- class for an unlabelled block so it isn't flagged unknown.
      const cls = lang ? ["src", `language-${lang}`] : ["src"];
      const pre = this.h(org, "pre", {}, [this.h(org, "code", { className: cls }, codeChildren)]);
      return captionWrap(this, org, pre);
    },
    link: function (this: any, org: any) {
      const raw: string = org.rawLink || "";
      const kids = this.toHast(org.children, org);
      // `card:` is a custom Org link type (build.el registers it via
      // `org-link-set-parameters`). uniorg's analog is its `linkTypes` parse
      // option, but uniorg-parse@3.2.1 doesn't export `defaultOptions`, and the
      // option replaces (not extends) the default list -- so we'd break https/
      // mailto/etc. We match on `rawLink` instead, which is robust.
      // [[card:URL]] -> placeholder the bake pass fills from the cache
      if (raw.startsWith("card:")) {
        const url = raw.slice("card:".length);
        return this.h(org, "a", { className: ["link-card"], "data-link-card": "", href: url }, [
          { type: "text", value: url },
        ]);
      }
      // coderef [[(label)]] -> link to the anchor registered by its src-block,
      // with the label wrapped in <span class="coderef-anchor"> (matches Emacs
      // and the in-code anchor, so the same hover/jump styling applies).
      if (org.linkType === "coderef") {
        const id = st.coderefs.get(org.path) ?? `coderef-${org.path}`;
        const inner = kids.length
          ? kids
          : [this.h(org, "span", { className: ["coderef-anchor"] }, [{ type: "text", value: org.path }])];
        return this.h(org, "a", { href: `#${id}` }, inner);
      }
      // internal .org links -> .html
      if (raw.includes(".org") && !/^[a-z]+:\/\//.test(raw)) {
        const href = raw.replace(/^file:/, "").replace(/\.org(::.*)?$/, ".html");
        return this.h(org, "a", { href }, kids.length ? kids : [{ type: "text", value: href }]);
      }
      // image-file links with no description -> <img src alt>. uniorg's default
      // emits the <img> but drops `alt`; Emacs sets alt=basename, so match it
      // (the `paragraph` handler then applies any `#+ATTR_HTML` width to it).
      if (!kids.length && /\.(webp|png|jpe?g|gif|svg|avif|bmp)$/i.test(raw)) {
        const src = raw.replace(/^file:/, "");
        return this.h(org, "img", { src, alt: src.replace(/^.*\//, "") });
      }
      return undefined; // default handles http(s)/mailto/etc.
    },
  };
}

// org headlines render h1.. but the page <h1> is the title-block; demote by one.
function demoteHeadings() {
  return (tree: any) => {
    const walk = (n: any) => {
      if (n.tagName && /^h[1-5]$/.test(n.tagName)) n.tagName = "h" + (Number(n.tagName[1]) + 1);
      (n.children || []).forEach(walk);
    };
    walk(tree);
  };
}

// Match build.el (`org-html-self-link-headlines`): give each heading
// id="<text>" and wrap its content in <a href="#<text>">…</a>.
function headingSelfLinks() {
  const textOf = (n: any): string =>
    n.type === "text" ? n.value : (n.children || []).map(textOf).join("");
  return (tree: any) => {
    const walk = (n: any) => {
      if (n.tagName && /^h[1-6]$/.test(n.tagName)) {
        const id = textOf(n);
        n.properties = { ...n.properties, id };
        n.children = [{ type: "element", tagName: "a", properties: { href: `#${id}` }, children: n.children }];
        return; // headings don't nest
      }
      (n.children || []).forEach(walk);
    };
    walk(tree);
  };
}

async function orgToBody(src: string, st: RenderState): Promise<string> {
  const file = await unified()
    .use(parse)
    .use(uniorg2rehype, { handlers: makeHandlers(st) })
    .use(demoteHeadings)
    .use(headingSelfLinks)
    // uniorg emits math as <span class="math math-inline|display">; render it
    // here (the bake step only matches \(...\) delimiters, which uniorg consumes).
    .use(rehypeKatex, { throwOnError: false, strict: false })
    .use(stringify, { allowDangerousHtml: true, closeSelfClosing: true })
    .process(src);
  return String(file);
}

// Render a short org string (e.g. a `#+TITLE:`) as inline HTML: `=org=` ->
// `<code>org</code>`, `$x$` -> KaTeX, links, emphasis. Strips the wrapping <p>.
// Used for titles in the article <h1> and the index/tag cards, which were
// previously HTML-escaped (so `=org=` showed literally).
async function orgInlineToHtml(s: string): Promise<string> {
  const out = String(
    await unified()
      .use(parse)
      .use(uniorg2rehype)
      .use(rehypeKatex, { throwOnError: false, strict: false })
      .use(stringify, { allowDangerousHtml: true, closeSelfClosing: true })
      .process(s),
  );
  return out.replace(/^\s*<p>([\s\S]*?)<\/p>\s*$/, "$1").trim();
}

// --- page assembly ----------------------------------------------------------
export type Meta = {
  href: string; title: string; titleHtml: string; date: string; tags: string[];
  thumbnail: string | null; draft: boolean; description: string;
};

function headHtml(m: { title: string; description: string; url: string; thumbnail: string | null;
  hasCode: boolean; hasMath: boolean; hasSteno: boolean }): string {
  const img = absUrl(m.thumbnail);
  const twitter = img ? "summary_large_image" : "summary";
  return (
    `<head><meta charset="utf-8"/>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"/>` +
    `<title>${esc(m.title)} - Toybeam</title>` +
    `<meta name="description" content="${esc(m.description)}"/>` +
    `<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔦</text></svg>"/>` +
    `<link rel="stylesheet" href="/style/simple.min.css"/>` +
    `<link rel="stylesheet" href="/style/style.min.css"/>` +
    (m.hasCode
      ? `<link rel="stylesheet" id="prism-dark" href="/style/prism-dark.min.css" media="(prefers-color-scheme: dark)"/>` +
        `<link rel="stylesheet" id="prism-light" href="/style/prism-light.min.css" media="(prefers-color-scheme: light)"/>`
      : "") +
    (m.hasMath ? `<link rel="stylesheet" href="/style/katex/katex.min.css"/>` : "") +
    `<script type="text/javascript" src="/style/style.js"></script>` +
    DISCO_HEAD +
    (m.hasSteno ? `<script type="text/javascript" async src="/style/steno-viz.js"></script>` : "") +
    `<meta property="og:type" content="article"/>` +
    `<meta property="og:title" content="${esc(m.title)}"/>` +
    `<meta property="og:description" content="${esc(m.description)}"/>` +
    `<meta property="og:url" content="${esc(m.url)}"/>` +
    `<meta property="og:site_name" content="Toybeam"/>` +
    `<meta property="og:locale" content="ja_JP"/>` +
    (img ? `<meta property="og:image" content="${esc(img)}"/>` : "") +
    `<meta name="twitter:card" content="${twitter}"/>` +
    `<meta name="twitter:creator" content="@toyboot4e"/>` +
    `<meta name="twitter:site" content="@toyboot4e"/>` +
    (img ? `<meta name="twitter:image" content="${esc(img)}"/>` : "") +
    `</head>`
  );
}

function tagListHtml(tags: string[]): string {
  return tags
    .map((t) => `<a href="/tags/${t}.html" class="org-tag"><code>${esc(t)}</code></a>`)
    .join("");
}

function page(opts: {
  htmlClass?: string; head: string; titleBlock: string; content: string;
}): string {
  const cls = opts.htmlClass ? ` class="${opts.htmlClass}"` : "";
  return (
    `<!DOCTYPE html><html lang="ja"${cls}>${opts.head}` +
    `<body>${DISCO_BODY}${HEADER}` +
    `<main role="main" id="main">${opts.titleBlock}<div id="content">${opts.content}</div></main>` +
    `${FOOTER}${TAIL}</body></html>`
  );
}

function articleTitleBlock(m: Meta): string {
  return (
    `<div class="title-block"><h1>${m.titleHtml}</h1>` +
    `<div class="title-meta"><span class="title-date">${esc(m.date)}</span>` +
    (m.tags.length ? `<p class="org-tag-list">${tagListHtml(m.tags)}</p>` : "") +
    `</div></div>`
  );
}

function articleCard(m: Meta, eager: boolean): string {
  const thumb = m.thumbnail
    ? `<img class="article-card-thumbnail" src="${esc(m.thumbnail)}" alt="" loading="${eager ? "eager" : "lazy"}" decoding="async"/>`
    : "";
  return (
    `<div class="article-card"><div class="article-card-body">` +
    `<div><a href="${esc(m.href)}" class="article-card-link">${m.titleHtml}</a></div>` +
    `<div class="article-card-meta"><date>${esc(m.date)}</date>` +
    `<span class="org-tag-list">${tagListHtml(m.tags)}</span></div></div>${thumb}</div>`
  );
}

// --- date formatting: `<2025-10-05 Sun>` -> `Oct  5, 2025` ------------------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(raw: string): string {
  const m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const day = String(Number(m[3]));
  return `${MONTHS[Number(m[2]) - 1]} ${day.padStart(2, " ")}, ${m[1]}`;
}

function firstParagraphText(body: string): string {
  const m = body.match(/<p>([\s\S]*?)<\/p>/);
  const text = (m ? m[1] : "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return text.length > 150 ? text.slice(0, 150) + "…" : text;
}

// --- public rendering API ---------------------------------------------------
export type Rendered = { rel: string; isDiary: boolean; draft: boolean; meta: Meta; html: string };

// Render one article's source to its full page HTML (pre-bake) + metadata.
// `rel` is the output path relative to OUT (e.g. `diary/2023-09-24.html`).
export async function renderArticle(rel: string, text: string): Promise<Rendered> {
  const kw = readKeywords(text);
  const outRel = rel.replace(/\.org$/, ".html");
  const tags = (kw.FILETAGS || "").split(":").map((s) => s.trim()).filter(Boolean);
  // Pre-render table captions (org inline -> HTML) since the handler is sync.
  const tableCaps = await Promise.all(
    tableCaptions(text).map((c) => (c ? orgInlineToHtml(c) : null)),
  );
  const body = await orgToBody(text, {
    details: detailsSummaries(text),
    blockCounter: { n: 0 },
    coderefs: new Map(),
    tableCaps,
    tableCounter: { n: 0 },
  });
  const title = kw.TITLE || outRel;
  const meta: Meta = {
    href: "/" + outRel,
    title, // plain text, for <title>/og:title
    titleHtml: await orgInlineToHtml(title), // org markup, for <h1> + cards
    date: fmtDate(kw.DATE || ""),
    tags,
    thumbnail: thumbnailSrc(kw.THUMBNAIL),
    draft: false,
    description: kw.DESCRIPTION || firstParagraphText(body),
  };
  const html = page({
    head: headHtml({
      title: meta.title, description: meta.description, url: SITE_URL + outRel, thumbnail: meta.thumbnail,
      // hasMath gates `katex.min.css`. Catch BOTH math forms: `.katex` spans
      // already rendered by rehype-katex (org `$...$`, in the body or the title),
      // and raw `\(...\)` / `\[` / `\begin{}` delimiters the bake step renders
      // later. Missing the former shipped 47 math pages unstyled.
      hasCode: body.includes("language-"),
      hasMath: body.includes('class="katex') || meta.titleHtml.includes('class="katex') || /\\\(|\\\[|\\begin\{/.test(body),
      hasSteno: body.includes("<steno-outline"),
    }),
    titleBlock: articleTitleBlock(meta),
    content: body,
  });
  return { rel: outRel, isDiary: outRel.startsWith("diary/"), draft: !!kw.DRAFT, meta, html };
}

// index.html: Tags / Devlog (timeline) / Diary -- same three sections, ids and
// ordering as build.el's `my-generate-sitemap`.
export function buildIndexHtml(metas: Meta[], diaryMetas: Meta[], allTags: string[]): string {
  const section = (id: string, cards: Meta[]) =>
    `<h2 id="${id}"><a href="#${id}">${esc(id)}</a></h2>` +
    `<div class="article-list">${cards.map((m, i) => articleCard(m, i === 0)).join("")}</div>`;
  const content =
    `<h2 id="Tags"><a href="#Tags">Tags</a></h2><div class="org-tag-list">${tagListHtml(allTags)}</div>` +
    section("Devlog (timeline)", metas) +
    section("Diary", diaryMetas);
  // a card title may carry KaTeX (e.g. `$\TeX{}$`); link the stylesheet if so
  const hasMath = [...metas, ...diaryMetas].some((m) => m.titleHtml.includes('class="katex'));
  return page({
    htmlClass: "home",
    head: headHtml({ title: "Toybeam", description: "Devlog of toyboot4e", url: SITE_URL, thumbnail: null, hasCode: false, hasMath, hasSteno: false }),
    titleBlock: `<div class="title-block"><h1>Toybeam</h1><div class="title-meta"><span class="title-date"></span></div></div>`,
    content,
  });
}

export function buildTagHtml(tag: string, tagged: Meta[], allTags: string[]): string {
  const content =
    `<h2 id="Tags"><a href="#Tags">Tags</a></h2><div class="org-tag-list">${tagListHtml(allTags)}</div>` +
    `<h2 id="Devlog">Devlog (#${esc(tag)})</h2>` +
    `<div class="article-list">${tagged.map((m, i) => articleCard(m, i === 0)).join("")}</div>`;
  const hasMath = tagged.some((m) => m.titleHtml.includes('class="katex'));
  return page({
    htmlClass: "home",
    head: headHtml({ title: `Toybeam (#${tag})`, description: "Devlog of toyboot4e", url: `${SITE_URL}tags/${tag}.html`, thumbnail: null, hasCode: false, hasMath, hasSteno: false }),
    titleBlock: `<div class="title-block"><h1>Toybeam (<code>#${esc(tag)}</code>)</h1><div class="title-meta"><span class="title-date"></span></div></div>`,
    content,
  });
}
