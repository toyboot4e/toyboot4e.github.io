// Golden tests for the bun build's HTML output. Each fixture under fixtures/ is
// rendered AND baked (exactly as the build ships it, via render-bake.ts), plus a
// synthetic index + tag page assembled from the fixtures' metadata. The result
// is pinned byte-for-byte against golden/.
//
// Regenerate after an intentional output change:  UPDATE_GOLDEN=1 bun test
// (then eyeball `git diff test/golden/` before committing).
import { test, expect } from "bun:test";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { renderAndBake } from "../build/render-bake.ts";
import { buildIndexHtml, buildTagHtml, type Meta } from "../build/render.ts";

const FIX = join(import.meta.dir, "fixtures");
const GOLD = join(import.meta.dir, "golden");
const UPDATE = !!process.env.UPDATE_GOLDEN;

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

// Render every fixture up front so the index/tag tests can see all metadata.
const fixtures = (await readdir(FIX)).filter((f) => f.endsWith(".org")).sort();
const baked = await Promise.all(
  fixtures.map(async (fx) => ({ fx, r: await renderAndBake(fx, await readFile(join(FIX, fx), "utf8")) })),
);
const metas: Meta[] = baked.map((b) => b.r.meta);
const allTags = [...new Set(metas.flatMap((m) => m.tags))].sort();

for (const { fx, r } of baked) {
  test(`article: ${fx}`, async () => {
    await golden(fx.replace(/\.org$/, ".html"), r.out);
  });
}

test("index.html", async () => {
  await golden("index.html", buildIndexHtml(metas, [], allTags));
});

for (const tag of allTags) {
  test(`tag: ${tag}`, async () => {
    await golden(`tag-${tag}.html`, buildTagHtml(tag, metas.filter((m) => m.tags.includes(tag)), allTags));
  });
}
