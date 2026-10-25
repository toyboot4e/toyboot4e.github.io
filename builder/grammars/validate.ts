// Validate every vendored grammar: load wasm, compile its combined query
// (highlights + locals, as highlight.ts does, resolving `; inherits:`), collect
// the capture vocabulary. Run: bun grammars/validate.ts   (from builder/)
import { Parser, Language, Query } from "web-tree-sitter";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { errorText } from "../src/guard.ts";

await Parser.init({ locateFile: () => "node_modules/web-tree-sitter/web-tree-sitter.wasm" });

// Mirror highlight.ts's readQuery: splice `; inherits:` base queries in place so
// we compile what the build actually runs (else js/ts/tsx look near-empty here).
const INHERITS_RE = /^[ \t]*;+[ \t]*inherits[ \t]*:?[ \t]*([a-z_,()-]+)[ \t]*$/gmu;
const readQuery = (id: string, suffix: string, seen = new Set<string>()): string => {
  if (seen.has(id)) {
    return "";
  }
  seen.add(id);
  const path = `grammars/queries/${id}${suffix}.scm`;
  if (!existsSync(path)) {
    return "";
  }
  return readFileSync(path, "utf8").replaceAll(INHERITS_RE, (_m, langs: string) =>
    langs
      .split(",")
      .map((l) => `\n${readQuery(l.trim().replaceAll(/[()]/gu, ""), suffix, seen)}\n`)
      .join(""),
  );
};

const ids = readdirSync("grammars/wasm")
  .filter((f) => f.endsWith(".wasm"))
  .map((f) => f.slice(0, -".wasm".length))
  .toSorted();
const allCaps = new Set<string>();
let bad = 0;
for (const id of ids) {
  try {
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential: one report line per grammar, in order
    const lang = await Language.load(`grammars/wasm/${id}.wasm`);
    const src = `${readQuery(id, "")}\n${readQuery(id, ".locals")}`;
    const inj = readQuery(id, ".injections");
    if (inj.trim() !== "") {
      // compile-check it too
      new Query(lang, inj).delete();
    }
    const q = new Query(lang, src);
    for (const n of q.captureNames) {
      allCaps.add(n);
    }
    process.stdout.write(`  ✓ ${id.padEnd(12)} ${q.captureNames.length} captures\n`);
  } catch (error) {
    bad++;
    process.stdout.write(`  ✗ ${id.padEnd(12)} ${errorText(error).split("\n")[0] ?? ""}\n`);
  }
}
console.log(`\n${ids.length - bad}/${ids.length} queries compiled.`);
console.log(`\n=== union of ${allCaps.size} capture names (drives CSS classes) ===`);
console.log([...allCaps].toSorted().join("\n"));
