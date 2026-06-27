// Lightweight bake helpers with NO tree-sitter/KaTeX import, so the build
// orchestrator (build.ts) can stamp output, copy KaTeX assets and merge worker
// stats without paying the heavy tree-sitter + DOM setup cost that `bake.ts`
// triggers at import time. Only the workers (which actually highlight) import `bake.ts`.
import { createRequire } from "node:module";
import { readdir, mkdir, cp } from "node:fs/promises";
import { dirname, join } from "node:path";

export const SENTINEL = "<!--pp-->";

export type BakeStats = {
  nPlain: number; nDom: number; nUnknown: number; nHlError: number;
  nMath: number; nMathError: number; nCards: number; nCardMiss: number;
  unknownLangs: string[]; missingCards: string[];
};

// Stamp the sentinel right after the doctype so a later run can skip via a
// string scan.
export function stamp(out: string): string {
  return /<!doctype html>/i.test(out)
    ? out.replace(/(<!doctype html>)/i, `$1${SENTINEL}`)
    : SENTINEL + out;
}

// Combine per-worker stats into one (used by the orchestrator).
export function mergeStats(parts: BakeStats[]): BakeStats {
  const acc: BakeStats = {
    nPlain: 0, nDom: 0, nUnknown: 0, nHlError: 0, nMath: 0, nMathError: 0,
    nCards: 0, nCardMiss: 0, unknownLangs: [], missingCards: [],
  };
  const ul = new Set<string>(), mc = new Set<string>();
  for (const p of parts) {
    acc.nPlain += p.nPlain; acc.nDom += p.nDom; acc.nUnknown += p.nUnknown;
    acc.nHlError += p.nHlError; acc.nMath += p.nMath; acc.nMathError += p.nMathError;
    acc.nCards += p.nCards; acc.nCardMiss += p.nCardMiss;
    p.unknownLangs.forEach((x) => ul.add(x));
    p.missingCards.forEach((x) => mc.add(x));
  }
  acc.unknownLangs = [...ul];
  acc.missingCards = [...mc];
  return acc;
}

// Copy katex.min.css + woff2 fonts into <out>/style/katex/ (woff2 only: modern
// browsers never fetch the woff/ttf @font-face fallbacks). Single source of
// truth is the installed `katex` package, so the CSS and renderer never drift.
export async function copyKatexAssets(outDir: string): Promise<void> {
  const require = createRequire(import.meta.url);
  const dist = join(dirname(require.resolve("katex/package.json")), "dist");
  const dest = join(outDir, "style", "katex");
  await mkdir(join(dest, "fonts"), { recursive: true });
  await cp(join(dist, "katex.min.css"), join(dest, "katex.min.css"));
  for (const f of await readdir(join(dist, "fonts"))) {
    if (f.endsWith(".woff2")) await cp(join(dist, "fonts", f), join(dest, "fonts", f));
  }
}
