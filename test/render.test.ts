// Component-level tests for the bun render+bake. Instead of pinning whole pages
// (which are dominated by repeated chrome -- header/footer/<head>), we:
//   1. golden ONLY the rendered org body (#content) per fixture, so the snapshot
//      is just what the fixture exercises;
//   2. assert the page shell (chrome) once; and
//   3. assert specific behaviors (coderefs, caption numbering, cards, titles, …)
//      on tiny inline inputs.
//
// Regenerate the body goldens after an intentional change:
//   UPDATE_GOLDEN=1 bun test
import { test, expect } from "bun:test";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { renderAndBake } from "../build/render-bake.ts";
import { buildIndexHtml, buildTagHtml, type Meta } from "../build/render.tsx";

const FIX = join(import.meta.dir, "fixtures");
const GOLD = join(import.meta.dir, "golden");
const UPDATE = !!process.env.UPDATE_GOLDEN;

// The rendered org body only -- the page chrome lives in the shell test below.
const contentOf = (html: string): string =>
  parseHTML(html).document.getElementById("content")?.innerHTML ?? "";
// `#main` inner minus the title block -- for the index/tag listing pages.
const mainOf = (html: string): string =>
  parseHTML(html).document.getElementById("main")?.innerHTML ?? "";

async function golden(name: string, actual: string): Promise<void> {
  const file = join(GOLD, name);
  if (UPDATE) {
    await mkdir(GOLD, { recursive: true });
    await writeFile(file, actual);
    return;
  }
  let expected: string;
  try {
    expected = await readFile(file, "utf8");
  } catch {
    throw new Error(`missing golden '${name}' -- run \`UPDATE_GOLDEN=1 bun test\``);
  }
  expect(actual).toBe(expected);
}

const bake = async (name: string, org: string) => (await renderAndBake(name, org)).out;

// --- 1. body-fragment goldens (one per fixture) ----------------------------
const fixtures = (await readdir(FIX)).filter((f) => f.endsWith(".org")).sort();
const baked = await Promise.all(
  fixtures.map(async (fx) => ({ fx, r: await renderAndBake(fx, await readFile(join(FIX, fx), "utf8")) })),
);
const metas: Meta[] = baked.map((b) => b.r.meta);
const allTags = [...new Set(metas.flatMap((m) => m.tags))].sort();

for (const { fx, r } of baked) {
  test(`body: ${fx}`, async () => {
    await golden(fx.replace(/\.org$/, ".body.html"), contentOf(r.out));
  });
}

test("index listing", async () => {
  await golden("index.main.html", mainOf(buildIndexHtml(metas, [], allTags)));
});
test("tag listing", async () => {
  const tag = allTags[0];
  await golden("tag.main.html", mainOf(buildTagHtml(tag, metas.filter((m) => m.tags.includes(tag)), allTags)));
});

// --- 2. page shell (chrome), asserted once ---------------------------------
test("page shell", async () => {
  const out = await bake("x.org", "#+TITLE: Hi\nbody\n");
  expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
  expect(out).toContain('<html lang="ja">');
  expect(out).toContain('<link rel="stylesheet" href="/style/components.min.css">');
  expect(out).toContain('<header role="banner">');
  expect(out).toContain('<footer role="contentinfo">');
  expect(out).toContain('<nav id="toc"></nav>'); // tocbot mount
  expect(out).toContain("<!--pp-->"); // bake sentinel
});

// --- 3. behavior assertions (components, tiny inputs) ----------------------
test("coderef: line wrapped in .coderef-off, marker -> anchor, prose link styled", async () => {
  const out = await bake("c.org", '#+BEGIN_SRC haskell\nmain = a -- (ref:a)\n#+END_SRC\n\nsee [[(a)]]\n');
  // whole line wrapped + focusable (clickable -> :focus highlight)
  expect(out).toContain('<span id="coderef-1-a" class="coderef-off" tabindex="0">');
  expect(out).toContain('<span class="coderef-anchor">a</span>'); // (ref:a) marker -> anchor
  expect(out).toContain('<a href="#coderef-1-a"><span class="coderef-anchor">a</span></a>'); // prose link
  expect(out).not.toContain("(ref:a)"); // marker consumed
});

test("coderef: only coderef-bearing blocks are numbered (a plain block before it doesn't bump N)", async () => {
  const out = await bake("c.org",
    "#+BEGIN_SRC bash\necho hi\n#+END_SRC\n" +              // no coderef -> not numbered
    "#+BEGIN_SRC haskell\nx -- (ref:1)\n#+END_SRC\nsee [[(1)]]\n");
  expect(out).toContain('id="coderef-1-1"');        // first coderef block is 1, not 2
  expect(out).not.toContain("coderef-2");
  expect(out).toContain('<a href="#coderef-1-1">'); // prose link resolves to it
});

test("coderef: repeated labels resolve per-block (positional, not last-wins)", async () => {
  // both blocks use label `1`; each prose `[[(1)]]` must target ITS block.
  const out = await bake("c.org",
    "#+BEGIN_SRC haskell\nx -- (ref:1)\n#+END_SRC\nfirst [[(1)]]\n" +
    "#+BEGIN_SRC haskell\ny -- (ref:1)\n#+END_SRC\nsecond [[(1)]]\n");
  expect(out).toContain('id="coderef-1-1"'); // block 1 anchor
  expect(out).toContain('id="coderef-2-1"'); // block 2 anchor
  // first prose link -> block 1, second -> block 2 (the bug pointed both at block 2)
  const links = [...out.matchAll(/<a href="(#coderef-\d+-1)"><span class="coderef-anchor">/g)].map((m) => m[1]);
  expect(links).toEqual(["#coderef-1-1", "#coderef-2-1"]);
});

test("captions: Figure/Listing/Table numbering, per kind", async () => {
  const out = await bake("cap.org",
    "#+CAPTION: one\n[[./img/a.webp]]\n\n#+CAPTION: two\n[[./img/b.webp]]\n\n" +
    "#+CAPTION: code\n#+BEGIN_SRC bash\nx\n#+END_SRC\n\n#+CAPTION: tbl\n| a |\n|---|\n| 1 |\n");
  expect(out).toContain('<span class="figure-number">Figure 1: </span>');
  expect(out).toContain('<span class="figure-number">Figure 2: </span>');
  expect(out).toContain('<span class="listing-number">Listing 1: </span>');
  expect(out).toContain('<span class="table-number">Table 1: </span>');
});

test("image: #+ATTR_HTML width lands on <img>, not the container", async () => {
  const out = await bake("i.org", "#+ATTR_HTML: :width 880px\n[[./img/a.webp]]\n");
  expect(out).toContain('<img src="./img/a.webp" alt="a.webp" width="880px"');
  expect(out).not.toMatch(/<(p|figure)[^>]*width=/);
});

test("article card: scoped class, org-markup title, thumbnail path", async () => {
  const { meta } = await renderAndBake("a.org", "#+TITLE: =code= t\n#+THUMBNAIL: img/a.webp\nx\n");
  const html = buildIndexHtml([meta], [], []);
  expect(html).toMatch(/class="articleCard_[A-Za-z0-9]+"/); // CSS-module scoped
  expect(html).toContain("<code class=\"inline-verbatim\">code</code> t"); // title htmlized
  expect(html).toContain('src="/img/a.webp"'); // thumbnail not /img/img/
});

test("title: <title> strips org markup, <h1> keeps it", async () => {
  const out = await bake("t.org", "#+TITLE: =org= and *bold*\nx\n");
  expect(out).toContain("<title>org and bold - Toybeam</title>"); // stripped
  expect(out).toContain("<h1><code class=\"inline-verbatim\">org</code> and <strong>bold</strong></h1>");
});

test("YARUO/AA: verbatim <pre>, org markup NOT parsed", async () => {
  const out = await bake("y.org", "#+BEGIN_YARUO\n( _人_ )  *not bold*\n#+END_YARUO\n");
  expect(out).toContain('<pre class="yaruo">( _人_ )  *not bold*</pre>');
  expect(out).not.toContain("<sub>"); // _人_ stays literal, not a subscript
});

test("diff blocks get the diff-highlight class (for +/- line backgrounds)", async () => {
  const out = await bake("d.org", "#+BEGIN_SRC diff\n- a\n+ b\n#+END_SRC\n");
  expect(out).toMatch(/<code class="src language-diff diff-highlight">/);
});

test("internal .org link -> .html", async () => {
  const out = await bake("l.org", "see [[./other.org][other]]\n");
  expect(out).toContain('<a href="./other.html">other</a>');
});
