// Render one article AND bake it (tree-sitter + KaTeX + cards) into final HTML -- the
// per-article unit of work. Shared by the render worker (the real build) and the
// golden tests, so what the tests pin is exactly what ships.
//
// Importing this pulls in bake.ts -> the heavy tree-sitter setup, so only the
// workers and tests use it; the orchestrator (build.ts) stays on render.ts +
// bake-util.ts.
import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import { parseHTML } from "linkedom";
import { renderArticle, type Meta } from "./render.tsx";
import { bakeDocument, stamp } from "./bake.ts";
import { destsOf, type Lang } from "./lang.ts";

export type Baked = {
  rel: string;
  lang: Lang;
  isDiary: boolean;
  draft: boolean;
  meta: Meta;
  out: string;
  fallback: { rel: string; out: string } | null;
  // every file to write: the page, its stand-in, and their `/en/` copies
  pages: { rel: string; out: string }[];
};

// A page may be served a directory deeper than its source (`/ja/`, `/en/`), so
// relative asset URLs (`./img/x.webp`) are pinned to the source's directory.
// Relative article links (`./other.html`) are left alone: they resolve to the
// other article in the same language tree. A static `.html` copied from `src`
// (`src` given) exists at the root only, so it is pinned like an asset.
const SKIP_URL_RE = /^(?:[a-z][a-z\d+.-]*:|[/#?])/iu;
const HTML_RE = /\.html(?:[#?]|$)/u;
function pinAssetUrls(root: Element, srcDir: string, src: string | undefined): void {
  for (const attr of ["src", "href", "poster"]) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const v = el.getAttribute(attr) ?? "";
      if (v === "" || SKIP_URL_RE.test(v)) {
        continue;
      }
      const pinned = posix.join("/", srcDir, v);
      if (!HTML_RE.test(v) || (src !== undefined && existsSync(join(src, pinned.replace(/[#?].*$/u, ""))))) {
        el.setAttribute(attr, pinned);
      }
    }
  }
}

export async function renderAndBake(
  rel: string,
  text: string,
  opts: { counterpart?: boolean; src?: string } = {},
): Promise<Baked> {
  const r = await renderArticle(rel, text, opts);
  const { document } = parseHTML(r.html);
  bakeDocument(document);
  // oxlint-disable-next-line typescript/no-base-to-string -- linkedom's toString() serialises the document (untyped)
  const serialize = (): string => document.toString();
  const content = document.querySelector("#content");
  if (content !== null) {
    pinAssetUrls(content, posix.dirname(rel), opts.src);
  }
  const out = stamp(serialize());
  const fallback =
    r.fallback === null || content === null
      ? null
      : { rel: r.fallback.rel, out: stamp(r.fallback.page(content.innerHTML)) };
  const pages = [
    ...destsOf(r.lang, r.rel).map((d) => ({ rel: d, out })),
    ...(fallback === null ? [] : destsOf("en", fallback.rel).map((d) => ({ rel: d, out: fallback.out }))),
  ];
  return { rel: r.rel, lang: r.lang, isDiary: r.isDiary, draft: r.draft, meta: r.meta, out, fallback, pages };
}
