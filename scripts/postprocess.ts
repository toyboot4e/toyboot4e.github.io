#!/usr/bin/env bun

// Emacs-path post-processor (`just build-emacs`): bake syntax highlighting +
// math + link cards into the published HTML, so pages ship no highlighting/math
// JavaScript.
//
//   - Prism highlights every `<pre><code class="language-XX">` at build time.
//   - KaTeX renders `\(...\)`, `\[...\]` and bare `\begin{env}...\end{env}` math.
//   - `[[card:URL]]` placeholders are filled from `linkcard-cache.json`.
//
// The bake itself lives in `scripts/bake.ts` (shared with the default bun
// build's in-process bake, so the logic never drifts). This file is just the
// driver: read each built file, parse it, bake, stamp, write back.
//
// Idempotent: a processed file gets a `<!--pp-->` sentinel right after the
// doctype and is skipped on the next run. Emacs regenerates changed articles
// without it, so warm rebuilds only touch what changed. `just clean` (and the
// sandboxed `nix build`) start with no sentinels, so everything is reprocessed.
//
// Failure policy: bad macros / unknown languages degrade (red `.katex-error`
// text, unhighlighted code) and warn. With `--strict` (CI) the process exits
// non-zero if any KaTeX error or unknown language was seen.

import { parseHTML } from "linkedom";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bakeDocument, copyKatexAssets, getStats, SENTINEL, stamp } from "../build/bake.ts";

const STRICT = process.argv.includes("--strict") || !!process.env.CI;
const OUT = process.env.OUT_DIR ?? "out";

let nFiles = 0, nSkippedFiles = 0;

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}

async function processFile(file: string): Promise<void> {
  const html = await readFile(file, "utf8");
  if (html.includes(SENTINEL)) { nSkippedFiles++; return; }
  const { document } = parseHTML(html);
  bakeDocument(document);
  await writeFile(file, stamp(document.toString()));
  nFiles++;
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const files = args.length ? args : await walk(OUT);
for (const f of files) await processFile(f);
await copyKatexAssets(OUT);

const s = getStats();
console.log(
  `post: ${nFiles} processed, ${nSkippedFiles} already stamped | ` +
  `code: ${s.nPlain} fast + ${s.nDom} dom, ${s.nUnknown} unknown, ${s.nHlError} failed | ` +
  `math: ${s.nMath} rendered, ${s.nMathError} errored | ` +
  `cards: ${s.nCards} baked, ${s.nCardMiss} missing`,
);

if (STRICT && (s.nMathError > 0 || s.nUnknown > 0 || s.nCardMiss > 0)) {
  console.error(
    `post: FAILED (strict) -- ${s.nMathError} math error(s), ` +
    `${s.nUnknown} unknown language(s)${s.unknownLangs.length ? `: ${s.unknownLangs.join(", ")}` : ""}` +
    `, ${s.nCardMiss} uncached link card(s)${s.missingCards.length ? `: ${s.missingCards.join(", ")}` : ""}`,
  );
  process.exit(1);
}
