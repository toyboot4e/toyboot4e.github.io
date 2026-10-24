// Lightweight bake helpers with NO tree-sitter/KaTeX import, so the build
// orchestrator (build.ts) can stamp output, copy KaTeX assets and merge worker
// stats without paying the heavy tree-sitter + DOM setup cost that `bake.ts`
// triggers at import time. Only the workers (which actually highlight) import `bake.ts`.
import { createRequire } from "node:module";
import { readdir, mkdir, cp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { arrayOf, isNumber, isString, literal, objectOf, optional } from "./guard.ts";

export const SENTINEL = "<!--pp-->";

// A `linkcard-cache.json` entry: an OGP `card` (default, `kind` absent for
// back-compat) or a `github-code` embed (the literal source lines of a GitHub blob permalink).
export type Card = {
  kind?: "card" | "github-code";
  // kind: card (OGP)
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
  // kind: github-code
  owner?: string;
  repo?: string;
  refLabel?: string;
  path?: string;
  startLine?: number;
  endLine?: number;
  lang?: string;
  code?: string;
};

const optString = optional(isString);
const optNumber = optional(isNumber);
export const isCard = objectOf<Card>({
  kind: optional(literal("card", "github-code")),
  title: optString,
  description: optString,
  image: optString,
  siteName: optString,
  favicon: optString,
  owner: optString,
  repo: optString,
  refLabel: optString,
  path: optString,
  startLine: optNumber,
  endLine: optNumber,
  lang: optString,
  code: optString,
});

export type BakeStats = {
  nPlain: number;
  nDom: number;
  nUnknown: number;
  nHlError: number;
  nMath: number;
  nMathError: number;
  nCards: number;
  nCardMiss: number;
  unknownLangs: string[];
  missingCards: string[];
};

export const isBakeStats = objectOf<BakeStats>({
  nPlain: isNumber,
  nDom: isNumber,
  nUnknown: isNumber,
  nHlError: isNumber,
  nMath: isNumber,
  nMathError: isNumber,
  nCards: isNumber,
  nCardMiss: isNumber,
  unknownLangs: arrayOf(isString),
  missingCards: arrayOf(isString),
});

// Stamp the sentinel right after the doctype so a later run can skip via a
// string scan.
export function stamp(out: string): string {
  return /<!doctype html>/iu.test(out) ? out.replace(/(<!doctype html>)/iu, `$1${SENTINEL}`) : SENTINEL + out;
}

// Combine per-worker stats into one (used by the orchestrator).
export function mergeStats(parts: BakeStats[]): BakeStats {
  const acc: BakeStats = {
    nPlain: 0,
    nDom: 0,
    nUnknown: 0,
    nHlError: 0,
    nMath: 0,
    nMathError: 0,
    nCards: 0,
    nCardMiss: 0,
    unknownLangs: [],
    missingCards: [],
  };
  const ul = new Set<string>(),
    mc = new Set<string>();
  for (const p of parts) {
    acc.nPlain += p.nPlain;
    acc.nDom += p.nDom;
    acc.nUnknown += p.nUnknown;
    acc.nHlError += p.nHlError;
    acc.nMath += p.nMath;
    acc.nMathError += p.nMathError;
    acc.nCards += p.nCards;
    acc.nCardMiss += p.nCardMiss;
    for (const x of p.unknownLangs) {
      ul.add(x);
    }
    for (const x of p.missingCards) {
      mc.add(x);
    }
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
  const files = await readdir(join(dist, "fonts"));
  const fonts = files.filter((f) => f.endsWith(".woff2"));
  await Promise.all(fonts.map(async (f) => cp(join(dist, "fonts", f), join(dest, "fonts", f))));
}
