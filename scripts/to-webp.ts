#!/usr/bin/env bun

// Convert committed PNG/JPEG images in `src/img/` to WebP, in place.
//
// For each committed image we encode a `.webp`, and if it actually came out
// smaller we *replace* the original: the PNG/JPEG is deleted and every
// `<stem>.png` / `<stem>.jpg` reference in the committed `src/**.org` articles
// is rewritten to `<stem>.webp`. If WebP doesn't win, the original is kept
// untouched and its references are left alone.
//
// PNG  -> lossless WebP (safe for flat UI/screenshots, no quality loss)
// JPEG -> lossy WebP (q80)
//
// Only committed files are touched (`git ls-files`), so untracked work in
// progress is left alone. Re-running is safe: once an image is replaced it is
// gone from disk, and we skip git-tracked entries that no longer exist.

import { $ } from "bun";
import { stat, rm, readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

const IMG_DIRS = ["src/img", "src/diary/img"];
const JPG_QUALITY = 80;

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)}KB`;
const pct = (src: number, webp: number) => `-${(100 * (1 - webp / src)).toFixed(1)}%`;

/** Committed files under `dirs` matching `re` that still exist on disk. */
async function committed(dirs: string | string[], re: RegExp): Promise<string[]> {
  const out = (await $`git ls-files ${[dirs].flat()}`.quiet().text())
    .split("\n")
    .filter((p) => re.test(p));
  const live: string[] = [];
  for (const p of out) {
    try {
      await stat(p);
      live.push(p);
    } catch {
      // tracked but deleted from the working tree (e.g. already converted) — skip
    }
  }
  return live.sort();
}

const images = await committed(IMG_DIRS, /\.(png|jpe?g)$/i);

// `oldName -> newName` for every image we actually replaced, used to rewrite
// references in the articles afterwards.
const renames = new Map<string, string>();

// Paths to stage at the end: removed originals, new webps, rewritten articles.
const staged: string[] = [];

let made = 0;
let skipped = 0;
let totalSrc = 0;
let totalWebp = 0;

for (const src of images) {
  const name = basename(src);
  const webp = src.replace(/\.(png|jpe?g)$/i, ".webp");
  const srcSize = (await stat(src)).size;

  if (/\.png$/i.test(name)) {
    await $`cwebp -quiet -lossless -z 9 -m 6 -metadata none ${src} -o ${webp}`;
  } else {
    await $`cwebp -quiet -q ${JPG_QUALITY} -m 6 -metadata none ${src} -o ${webp}`;
  }

  const webpSize = (await stat(webp)).size;

  // If WebP didn't actually win, drop it and keep the original untouched.
  if (webpSize >= srcSize) {
    await rm(webp);
    console.log(`  ${name.padEnd(40)} webp not smaller — kept original`);
    skipped++;
    continue;
  }

  // WebP wins: replace the original and remember the rename.
  await rm(src);
  renames.set(name, basename(webp));
  staged.push(src, webp); // stage the removed original and the new webp

  console.log(
    `  ${name.padEnd(40)} ${kb(srcSize).padStart(9)} -> ${kb(webpSize).padStart(9)} webp (${pct(srcSize, webpSize)})`,
  );
  totalSrc += srcSize;
  totalWebp += webpSize;
  made++;
}

// Rewrite references in the committed articles.
let rewritten = 0;
if (renames.size) {
  const articles = await committed("src", /\.org$/i);
  for (const article of articles) {
    let text = await readFile(article, "utf8");
    const before = text;
    for (const [oldName, newName] of renames) {
      text = text.split(oldName).join(newName);
    }
    if (text !== before) {
      await writeFile(article, text);
      staged.push(article);
      rewritten++;
    }
  }
}

// Stage the removed originals, new webps, and rewritten articles in one batch.
if (staged.length) {
  await $`git add -- ${staged}`;
}

console.log(
  made
    ? `done: ${made} converted (${skipped} kept), ${rewritten} article(s) updated; ` +
        `${kb(totalSrc)} -> ${kb(totalWebp)} (${pct(totalSrc, totalWebp)}) across converted images`
    : `nothing to do (${skipped} kept)`,
);
