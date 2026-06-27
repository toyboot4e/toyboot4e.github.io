// Populate `linkcard-cache.json` for `[[card:URL]]` links by scraping OGP /
// GitHub metadata from the live web; the build (`builder/src/bake.ts`) only ever
// *reads* it. Run via vite-node (`just linkcards`).
//
// The cache is NOT committed -- it's derived from the working tree, which may
// hold unpublished drafts. It's regenerated each build: `just build` runs this
// best-effort locally, and CI runs the whole build as an app (`nix run .#build`,
// which has network) so the fetch happens there too. Usage:
//
//   just linkcards            # fetch any new `[[card:URL]]`, keep existing
//   just linkcards --force    # re-fetch everything (refresh stale metadata)
//   just linkcards <url> ...  # fetch only the given URLs

import { parseHTML } from "linkedom";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Repo-root-relative (builder/src/ -> ../..), so paths resolve regardless of cwd.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CACHE_FILE = join(ROOT, "linkcard-cache.json");
const SRC_DIR = join(ROOT, "src");
const CARD_RE = /\[\[card:([^\]]+)\]\]/g;
const UA =
  "Mozilla/5.0 (compatible; toyboot4e-devlog-linkcard/1.0; +https://toyboot4e.github.io/)";

// A cache entry is either an OGP `card` (default, `kind` absent for back-compat)
// or a `github-code` embed (the literal source lines of a GitHub blob permalink).
type Card = {
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

// File extension -> Prism language. Only languages already loaded in
// `build/bake.ts` (loadLanguages) are mapped; an unmapped extension yields a
// plain, unhighlighted block (no `language-` class, no strict failure).
const EXT_LANG: Record<string, string> = {
  rs: "rust", hs: "haskell", nix: "nix", sh: "bash", bash: "bash", lua: "lua",
  php: "php", ts: "typescript", tsx: "tsx", js: "javascript", mjs: "javascript",
  cjs: "javascript", jsx: "javascript", json: "json", toml: "toml", py: "python",
  css: "css", c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
  cs: "csharp", yaml: "yaml", yml: "yaml", md: "markdown", el: "emacs-lisp",
  f90: "fortran", f95: "fortran", f: "fortran", for: "fortran", ini: "ini",
  diff: "diff", patch: "diff", dot: "dot", mk: "makefile",
};

const args = process.argv.slice(2);
const force = args.includes("--force") || args.includes("-f");
const urlArgs = args.filter((a) => !a.startsWith("-"));

// --- collect card URLs from org sources ------------------------------------
async function walkOrg(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkOrg(p)));
    else if (e.name.endsWith(".org")) out.push(p);
  }
  return out;
}

async function collectUrls(): Promise<string[]> {
  if (urlArgs.length) return [...new Set(urlArgs)];
  const urls = new Set<string>();
  for (const file of await walkOrg(SRC_DIR)) {
    const text = await readFile(file, "utf8");
    for (const m of text.matchAll(CARD_RE)) urls.add(m[1].trim());
  }
  return [...urls];
}

// --- OGP scraping ----------------------------------------------------------
function abs(base: string, ref: string | null | undefined): string | undefined {
  if (!ref) return undefined;
  try {
    return new URL(ref, base).toString();
  } catch {
    return undefined;
  }
}

// --- GitHub source-line embeds ---------------------------------------------
// A blob permalink with a line range -> the literal source lines. Without a
// range it's just a normal OGP card (handled by fetchCard). `ref` is assumed
// slash-free (a commit SHA or simple branch); use `y` on GitHub for a permalink.
type GhBlob = { owner: string; repo: string; ref: string; path: string; startLine: number; endLine: number };

function parseGitHubBlob(url: string): GhBlob | null {
  const m = url.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+?)(?:#L(\d+)(?:-L(\d+))?)?$/,
  );
  if (!m) return null;
  const startLine = m[5] ? +m[5] : 0;
  const endLine = m[6] ? +m[6] : startLine;
  return { owner: m[1], repo: m[2], ref: m[3], path: m[4], startLine, endLine };
}

async function fetchGitHubCode(url: string, gh: GhBlob): Promise<Card | null> {
  const raw = `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${gh.ref}/${gh.path}`;
  let res: Response;
  try {
    res = await fetch(raw, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  } catch (e: any) {
    console.warn(`  ! raw fetch failed: ${raw} (${e?.message ?? e})`);
    return null;
  }
  if (!res.ok) {
    console.warn(`  ! ${res.status} ${res.statusText}: ${raw}`);
    return null;
  }
  const all = (await res.text()).split("\n");
  const start = Math.max(1, gh.startLine);
  const end = Math.min(all.length, gh.endLine || gh.startLine);
  const code = all.slice(start - 1, end).join("\n");
  const ext = (gh.path.split("/").pop() || "").split(".").pop()?.toLowerCase() || "";
  const refLabel = /^[0-9a-f]{40}$/i.test(gh.ref) ? gh.ref.slice(0, 7) : gh.ref;
  const card: Card = {
    kind: "github-code",
    owner: gh.owner,
    repo: gh.repo,
    refLabel,
    path: gh.path,
    startLine: start,
    endLine: end,
    code,
  };
  if (EXT_LANG[ext]) card.lang = EXT_LANG[ext];
  return card;
}

// Dispatch: GitHub blob + line range -> code embed; everything else -> OGP card.
async function fetchEntry(url: string): Promise<Card | null> {
  const gh = parseGitHubBlob(url);
  if (gh && gh.startLine) return fetchGitHubCode(url, gh);
  return fetchCard(url);
}

async function fetchCard(url: string): Promise<Card | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
  } catch (e: any) {
    console.warn(`  ! fetch failed: ${url} (${e?.message ?? e})`);
    return null;
  }
  if (!res.ok) {
    console.warn(`  ! ${res.status} ${res.statusText}: ${url}`);
    return null;
  }
  const finalUrl = res.url || url;
  const { document } = parseHTML(await res.text());

  const meta = (sel: string): string | undefined => {
    const el = document.querySelector(sel);
    const v = el?.getAttribute("content");
    return v && v.trim() ? v.trim() : undefined;
  };
  const ogp = (prop: string) => meta(`meta[property="og:${prop}"]`) ?? meta(`meta[name="og:${prop}"]`);

  const title =
    ogp("title") ??
    meta('meta[name="twitter:title"]') ??
    (document.querySelector("title")?.textContent || "").trim() ??
    "";
  const description =
    ogp("description") ??
    meta('meta[name="description"]') ??
    meta('meta[name="twitter:description"]');
  const image = abs(finalUrl, ogp("image") ?? ogp("image:url") ?? meta('meta[name="twitter:image"]'));
  const siteName = ogp("site_name") ?? new URL(finalUrl).hostname;

  // favicon: prefer a declared <link rel="icon">, else the well-known path.
  const iconHref =
    document.querySelector('link[rel="icon"]')?.getAttribute("href") ??
    document.querySelector('link[rel="shortcut icon"]')?.getAttribute("href") ??
    document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href");
  const favicon = abs(finalUrl, iconHref) ?? abs(finalUrl, "/favicon.ico");

  if (!title) {
    console.warn(`  ! no title found: ${url}`);
    return null;
  }
  const card: Card = { title };
  if (description) card.description = description;
  if (image) card.image = image;
  if (siteName) card.siteName = siteName;
  if (favicon) card.favicon = favicon;
  return card;
}

// --- driver ----------------------------------------------------------------
let cache: Record<string, Card> = {};
try {
  cache = JSON.parse(await readFile(CACHE_FILE, "utf8"));
} catch {
  /* first run */
}

const urls = await collectUrls();
const referenced = new Set(urls);
let nFetched = 0,
  nKept = 0,
  nFailed = 0;

for (const url of urls) {
  if (!force && cache[url]) {
    nKept++;
    continue;
  }
  console.log(`  fetching: ${url}`);
  const card = await fetchEntry(url);
  if (card) {
    cache[url] = card;
    nFetched++;
  } else {
    nFailed++;
  }
}

// Drop entries no longer referenced by any org file (only on a full scan).
let nPruned = 0;
if (!urlArgs.length) {
  for (const key of Object.keys(cache)) {
    if (!referenced.has(key)) {
      delete cache[key];
      nPruned++;
    }
  }
}

// Write sorted by key for stable diffs.
const sorted: Record<string, Card> = {};
for (const key of Object.keys(cache).sort()) sorted[key] = cache[key];
await writeFile(CACHE_FILE, JSON.stringify(sorted, null, 2) + "\n");

console.log(
  `linkcards: ${nFetched} fetched, ${nKept} cached, ${nFailed} failed, ${nPruned} pruned ` +
  `(${Object.keys(sorted).length} total)`,
);
if (nFailed > 0) process.exit(1);
