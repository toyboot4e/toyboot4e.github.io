// Validate every vendored grammar: load wasm, compile its combined query
// (highlights + locals, as highlight.ts does), collect the capture vocabulary.
// Run: node grammars/validate.mjs   (from builder/)
import { Parser, Language, Query } from "web-tree-sitter";
import { readFileSync, readdirSync, existsSync } from "node:fs";

await Parser.init({ locateFile: () => "node_modules/web-tree-sitter/web-tree-sitter.wasm" });

const ids = readdirSync("grammars/wasm").filter(f => f.endsWith(".wasm")).map(f => f.slice(0, -5)).sort();
const allCaps = new Set();
let bad = 0;
for (const id of ids) {
  try {
    const lang = await Language.load(`grammars/wasm/${id}.wasm`);
    let src = readFileSync(`grammars/queries/${id}.scm`, "utf8");
    const locals = `grammars/queries/${id}.locals.scm`;
    if (existsSync(locals)) src += "\n" + readFileSync(locals, "utf8");
    if (existsSync(`grammars/queries/${id}.injections.scm`)) // compile-check it too
      new Query(lang, readFileSync(`grammars/queries/${id}.injections.scm`, "utf8"));
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
