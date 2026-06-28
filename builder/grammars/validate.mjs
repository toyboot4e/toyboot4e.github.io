// Validate every vendored grammar: load wasm, compile its combined query
// (highlights + locals, as highlight.ts does, resolving `; inherits:`), collect
// the capture vocabulary. Run: node grammars/validate.mjs   (from builder/)
import { Parser, Language, Query } from "web-tree-sitter";
import { readFileSync, readdirSync, existsSync } from "node:fs";

await Parser.init({ locateFile: () => "node_modules/web-tree-sitter/web-tree-sitter.wasm" });

// Mirror highlight.ts's readQuery: splice `; inherits:` base queries in place so
// we compile what the build actually runs (else js/ts/tsx look near-empty here).
const INHERITS_RE = /^[ \t]*;+[ \t]*inherits[ \t]*:?[ \t]*([a-z_,()-]+)[ \t]*$/gm;
const readQuery = (id, suffix, seen = new Set()) => {
  if (seen.has(id)) return "";
  seen.add(id);
  const path = `grammars/queries/${id}${suffix}.scm`;
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").replace(INHERITS_RE, (_m, langs) =>
    langs.split(",").map(l => `\n${readQuery(l.trim().replace(/[()]/g, ""), suffix, seen)}\n`).join(""));
};

const ids = readdirSync("grammars/wasm").filter(f => f.endsWith(".wasm")).map(f => f.slice(0, -5)).sort();
const allCaps = new Set();
let bad = 0;
for (const id of ids) {
  try {
    const lang = await Language.load(`grammars/wasm/${id}.wasm`);
    const src = readQuery(id, "") + "\n" + readQuery(id, ".locals");
    const inj = readQuery(id, ".injections");
    if (inj.trim()) new Query(lang, inj); // compile-check it too
    const q = new Query(lang, src);
    q.captureNames.forEach(n => allCaps.add(n));
    process.stdout.write(`  ✓ ${id.padEnd(12)} ${q.captureNames.length} captures\n`);
  } catch (e) {
    bad++;
    process.stdout.write(`  ✗ ${id.padEnd(12)} ${String(e.message ?? e).split("\n")[0]}\n`);
  }
}
console.log(`\n${ids.length - bad}/${ids.length} queries compiled.`);
console.log(`\n=== union of ${allCaps.size} capture names (drives CSS classes) ===`);
console.log([...allCaps].sort().join("\n"));
