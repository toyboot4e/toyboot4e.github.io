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

function thumbnailSrc(v?: string): string | null {
  if (!v) return null;
  if (/^https?:\/\//.test(v) || v.startsWith("/")) return v;
  return "/img/" + v; // matches build.el's my-thumbnail-src default
}
const absUrl = (v: string | null) =>
  v == null ? null : /^https?:\/\//.test(v) ? v : SITE_URL.replace(/\/$/, "") + v;

// Per-file render state threaded through the custom handlers.
type RenderState = {
  details: string[];          // `#+BEGIN_DETAILS <summary>` params, in order
  blockCounter: { n: number }; // mirrors build.el's `my-codeblock-counter`
  coderefs: Map<string, string>; // coderef label -> anchor id, updated in doc order
};

// `# (ref:1)` / `-- (ref:main)` / `! (ref:2)` at end of a code line: an optional
// comment leader (#, --, ;, //, %, ! across the languages used) + the
// `(ref:label)` marker. Org strips the whole thing and leaves a line anchor.
const CODEREF_RE = /\s*(?:#+|-{2,}|;+|\/\/+|%+|!+)?\s*\(ref:([^)]+)\)\s*$/;

// --- custom uniorg2rehype handlers (use `this.toHast` / `this.h`) -----------
function makeHandlers(st: RenderState) {
  return {
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
    // Code blocks: strip `(ref:label)` markers and drop a matching anchor span
    // (id=coderef-<N>-<label>) so prose `[[(label)]]` links can jump to them.
    // Mirrors build.el's coderef handling (minus the cosmetic hover JS).
    "src-block": function (this: any, org: any) {
      const lang = org.language || "";
      const N = ++st.blockCounter.n;
      const lines = String(org.value ?? "").replace(/\n$/, "").split("\n");
      const codeChildren: any[] = [];
      lines.forEach((line, i) => {
        const m = line.match(CODEREF_RE);
        if (m) {
          const text = line.slice(0, line.length - m[0].length);
          const id = `coderef-${N}-${m[1]}`;
          st.coderefs.set(m[1], id);
          // Wrap the line's code in the anchor span (not an empty span): Prism's
          // keep-markup re-tokenises the code and drops empty markup, so an empty
          // anchor would vanish and its jump link would dangle. (Mirrors how the
          // Emacs build wraps the whole coderef line.)
          codeChildren.push(this.h(org, "span", { id, className: ["coderef-anchor"] }, [
            { type: "text", value: text },
          ]));
        } else {
          codeChildren.push({ type: "text", value: line });
        }
        if (i < lines.length - 1) codeChildren.push({ type: "text", value: "\n" });
      });
      // class="src language-XX" matches what the bake/Prism step expects; omit
      // the language- class for an unlabelled block so it isn't flagged unknown.
      const cls = lang ? ["src", `language-${lang}`] : ["src"];
      return this.h(org, "pre", {}, [this.h(org, "code", { className: cls }, codeChildren)]);
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
      // coderef [[(label)]] -> jump to the anchor registered by its src-block
      if (org.linkType === "coderef") {
        const id = st.coderefs.get(org.path) ?? `coderef-${org.path}`;
        return this.h(org, "a", { href: `#${id}` }, kids.length ? kids : [{ type: "text", value: org.path }]);
      }
      // internal .org links -> .html
      if (raw.includes(".org") && !/^[a-z]+:\/\//.test(raw)) {
        const href = raw.replace(/^file:/, "").replace(/\.org(::.*)?$/, ".html");
        return this.h(org, "a", { href }, kids.length ? kids : [{ type: "text", value: href }]);
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

// --- page assembly ----------------------------------------------------------
export type Meta = {
  href: string; title: string; date: string; tags: string[];
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
    `<div class="title-block"><h1>${esc(m.title)}</h1>` +
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
    `<div><a href="${esc(m.href)}" class="article-card-link">${esc(m.title)}</a></div>` +
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
  const body = await orgToBody(text, {
    details: detailsSummaries(text),
    blockCounter: { n: 0 },
    coderefs: new Map(),
  });
  const meta: Meta = {
    href: "/" + outRel,
    title: kw.TITLE || outRel,
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
      // already rendered by rehype-katex (org `$...$`), and raw `\(...\)` / `\[`
      // / `\begin{}` delimiters the bake step renders later. Missing the former
      // shipped 47 math pages unstyled.
      hasCode: body.includes("language-"),
      hasMath: body.includes('class="katex') || /\\\(|\\\[|\\begin\{/.test(body),
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
  return page({
    htmlClass: "home",
    head: headHtml({ title: "Toybeam", description: "Devlog of toyboot4e", url: SITE_URL, thumbnail: null, hasCode: false, hasMath: false, hasSteno: false }),
    titleBlock: `<div class="title-block"><h1>Toybeam</h1><div class="title-meta"><span class="title-date"></span></div></div>`,
    content,
  });
}

export function buildTagHtml(tag: string, tagged: Meta[], allTags: string[]): string {
  const content =
    `<h2 id="Tags"><a href="#Tags">Tags</a></h2><div class="org-tag-list">${tagListHtml(allTags)}</div>` +
    `<h2 id="Devlog">Devlog (#${esc(tag)})</h2>` +
    `<div class="article-list">${tagged.map((m, i) => articleCard(m, i === 0)).join("")}</div>`;
  return page({
    htmlClass: "home",
    head: headHtml({ title: `Toybeam (#${tag})`, description: "Devlog of toyboot4e", url: `${SITE_URL}tags/${tag}.html`, thumbnail: null, hasCode: false, hasMath: false, hasSteno: false }),
    titleBlock: `<div class="title-block"><h1>Toybeam (<code>#${esc(tag)}</code>)</h1><div class="title-meta"><span class="title-date"></span></div></div>`,
    content,
  });
}
