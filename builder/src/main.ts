// CLI entry for the build (`vite-node src/main.ts`). build.ts is the library
// (fullBuild + helpers, imported by watch + tests); this just runs it once and
// prints the summary, failing under strict mode on unknown langs / KaTeX errors /
// uncached cards.
import { fullBuild, OUT, STRICT } from "./build.ts";

const t0 = performance.now();
const { metas, diaryMetas, allTags, stats: s, nStatic } = await fullBuild();
const ms = Math.round(performance.now() - t0);
console.log(
  `build: ${metas.length} articles + ${diaryMetas.length} diary + index + ${allTags.length} tags ` +
  `+ ${nStatic} static -> ${OUT} in ${ms}ms`,
);
console.log(
  `  bake: code ${s.nPlain} fast + ${s.nDom} dom, ${s.nUnknown} unknown, ${s.nHlError} failed | ` +
  `math ${s.nMath} | cards ${s.nCards} baked, ${s.nCardMiss} missing`,
);

if (STRICT && (s.nMathError > 0 || s.nUnknown > 0 || s.nCardMiss > 0)) {
  console.error(
    `build: FAILED (strict) -- ${s.nMathError} math error(s), ` +
    `${s.nUnknown} unknown language(s)${s.unknownLangs.length ? `: ${s.unknownLangs.join(", ")}` : ""}` +
    `, ${s.nCardMiss} uncached link card(s)${s.missingCards.length ? `: ${s.missingCards.join(", ")}` : ""}`,
  );
  process.exit(1);
}
