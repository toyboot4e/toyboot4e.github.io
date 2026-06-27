// Render one article AND bake it (tree-sitter + KaTeX + cards) into final HTML -- the
// per-article unit of work. Shared by the render worker (the real build) and the
// golden tests, so what the tests pin is exactly what ships.
//
// Importing this pulls in bake.ts -> the heavy tree-sitter setup, so only the
// workers and tests use it; the orchestrator (build.ts) stays on render.ts +
// bake-util.ts.
import { parseHTML } from "linkedom";
import { renderArticle, type Meta } from "./render.tsx";
import { bakeDocument, stamp } from "./bake.ts";

export type Baked = { rel: string; isDiary: boolean; draft: boolean; meta: Meta; out: string };

export async function renderAndBake(rel: string, text: string): Promise<Baked> {
  const r = await renderArticle(rel, text);
  const { document } = parseHTML(r.html);
  bakeDocument(document);
  return { rel: r.rel, isDiary: r.isDiary, draft: r.draft, meta: r.meta, out: stamp(document.toString()) };
}
