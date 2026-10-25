// Render one article AND bake it (tree-sitter + KaTeX + cards) into final HTML -- the
// per-article unit of work. Shared by the render worker (the real build) and the
// golden tests, so what the tests pin is exactly what ships.
//
// Importing this pulls in bake.ts -> the heavy tree-sitter setup, so only the
// workers and tests use it; the orchestrator (build.ts) stays on render.ts +
// bake-util.ts.
import { posix } from "node:path";
import { parseHTML } from "linkedom";
import { renderArticle, type Meta } from "./render.tsx";
import { bakeDocument, stamp } from "./bake.ts";
import type { Lang } from "./lang.ts";

export type Baked = {
  rel: string;
  lang: Lang;
  isDiary: boolean;
  draft: boolean;
  meta: Meta;
  out: string;
  fallback: { rel: string; out: string } | null;
};

// A page served under `/en/` is one directory deeper than its source, so its
// relative asset URLs (`./img/x.webp`) must be pinned to the source's directory.
// Relative article links (`./other.html`) are left alone: they resolve to the
// other article's `/en/` page, translated or stand-in.
const SKIP_URL_RE = /^(?:[a-z][a-z\d+.-]*:|[/#?])|\.html(?:[#?]|$)/iu;
function pinAssetUrls(root: Element, srcDir: string): void {
  for (const attr of ["src", "href", "poster"]) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const v = el.getAttribute(attr) ?? "";
      if (v !== "" && !SKIP_URL_RE.test(v)) {
        el.setAttribute(attr, posix.join("/", srcDir, v));
      }
    }
  }
}

export async function renderAndBake(rel: string, text: string, opts: { counterpart?: boolean } = {}): Promise<Baked> {
  const r = await renderArticle(rel, text, opts);
  const { document } = parseHTML(r.html);
  bakeDocument(document);
  // oxlint-disable-next-line typescript/no-base-to-string -- linkedom's toString() serialises the document (untyped)
  const serialize = (): string => document.toString();
  const content = document.querySelector("#content");
  if (r.lang === "en" && content !== null) {
    pinAssetUrls(content, posix.dirname(rel));
  }
  const html = serialize();
  let fallback: Baked["fallback"] = null;
  if (r.fallback !== null && content !== null) {
    pinAssetUrls(content, posix.dirname(rel));
    fallback = { rel: r.fallback.rel, out: stamp(r.fallback.page(content.innerHTML)) };
  }
  return { rel: r.rel, lang: r.lang, isDiary: r.isDiary, draft: r.draft, meta: r.meta, out: stamp(html), fallback };
}
