// Populate `linkcard-cache.json` for `[[card:URL]]` links by scraping OGP /
// GitHub metadata from the live web; the build (`builder/src/bake.ts`) only ever
// *reads* it. Run via bun (`just linkcards`).
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
import { join } from "node:path";
import { parseTrustedJson, type Card } from "./bake-util.ts";

// Repo-root-relative (builder/src/ -> ../..), so paths resolve regardless of cwd.
const ROOT = join(import.meta.dirname, "..", "..");
const CACHE_FILE = join(ROOT, "linkcard-cache.json");
const SRC_DIR = join(ROOT, "src");
const CARD_RE = /\[\[card:([^\]]+)\]\]/gu;
const UA = "Mozilla/5.0 (compatible; toyboot4e-devlog-linkcard/1.0; +https://toyboot4e.github.io/)";

// File extension -> Prism language. Only languages already loaded in
// `build/bake.ts` (loadLanguages) are mapped; an unmapped extension yields a
// plain, unhighlighted block (no `language-` class, no strict failure).
const EXT_LANG: Record<string, string> = {
  rs: "rust",
  hs: "haskell",
  nix: "nix",
  sh: "bash",
  bash: "bash",
  lua: "lua",
  php: "php",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  json: "json",
  toml: "toml",
  py: "python",
  css: "css",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  el: "emacs-lisp",
  f90: "fortran",
  f95: "fortran",
  f: "fortran",
  for: "fortran",
  ini: "ini",
  diff: "diff",
  patch: "diff",
  dot: "dot",
  mk: "makefile",
};

const args = process.argv.slice(2);
const force = args.includes("--force") || args.includes("-f");
const urlArgs = args.filter((a) => !a.startsWith("-"));

// --- collect card URLs from org sources ------------------------------------
async function walkOrg(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const lists = await Promise.all(
    entries.map(async (e): Promise<string[]> => {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        return walkOrg(p);
      }
      return e.name.endsWith(".org") ? [p] : [];
    }),
  );
  return lists.flat();
}

async function collectUrls(): Promise<string[]> {
  if (urlArgs.length > 0) {
    return [...new Set(urlArgs)];
  }
  const files = await walkOrg(SRC_DIR);
  const texts = await Promise.all(files.map(async (file) => readFile(file, "utf8")));
  const urls = new Set<string>();
  for (const text of texts) {
    for (const [, url = ""] of text.matchAll(CARD_RE)) {
      urls.add(url.trim());
    }
  }
  return [...urls];
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// --- OGP scraping ----------------------------------------------------------
function abs(base: string, ref: string | null | undefined): string | undefined {
  if (ref === null || ref === undefined || ref === "") {
    return undefined;
  }
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
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+?)(?:#L(\d+)(?:-L(\d+))?)?$/u.exec(url);
  if (!m) {
    return null;
  }
  const [, owner = "", repo = "", ref = "", path = "", start, end] = m;
  const startLine = start === undefined ? 0 : Number(start);
  const endLine = end === undefined ? startLine : Number(end);
  return { owner, repo, ref, path, startLine, endLine };
}

async function fetchGitHubCode(gh: GhBlob): Promise<Card | null> {
  const raw = `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${gh.ref}/${gh.path}`;
  let res: Response;
  try {
    res = await fetch(raw, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    console.warn(`  ! raw fetch failed: ${raw} (${errorText(error)})`);
    return null;
  }
  if (!res.ok) {
    console.warn(`  ! ${res.status} ${res.statusText}: ${raw}`);
    return null;
  }
  const body = await res.text();
  const all = body.split("\n");
  const start = Math.max(1, gh.startLine);
  const end = Math.min(all.length, gh.endLine === 0 ? gh.startLine : gh.endLine);
  const code = all.slice(start - 1, end).join("\n");
  const ext = (gh.path.split("/").at(-1) ?? "").split(".").at(-1)?.toLowerCase() ?? "";
  const refLabel = /^[0-9a-f]{40}$/iu.test(gh.ref) ? gh.ref.slice(0, 7) : gh.ref;
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
  const lang = EXT_LANG[ext];
  if (lang !== undefined) {
    card.lang = lang;
  }
  return card;
}

async function fetchCard(url: string): Promise<Card | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    console.warn(`  ! fetch failed: ${url} (${errorText(error)})`);
    return null;
  }
  if (!res.ok) {
    console.warn(`  ! ${res.status} ${res.statusText}: ${url}`);
    return null;
  }
  const finalUrl = res.url || url;
  const html = await res.text();
  const { document } = parseHTML(html);

  const meta = (sel: string): string | undefined => {
    const v = document.querySelector(sel)?.getAttribute("content")?.trim();
    return v === undefined || v === "" ? undefined : v;
  };
  const ogp = (prop: string): string | undefined =>
    meta(`meta[property="og:${prop}"]`) ?? meta(`meta[name="og:${prop}"]`);

  const title =
    ogp("title") ?? meta('meta[name="twitter:title"]') ?? (document.querySelector("title")?.textContent ?? "").trim();
  const description =
    ogp("description") ?? meta('meta[name="description"]') ?? meta('meta[name="twitter:description"]');
  const image = abs(finalUrl, ogp("image") ?? ogp("image:url") ?? meta('meta[name="twitter:image"]'));
  const siteName = ogp("site_name") ?? new URL(finalUrl).hostname;

  // favicon: prefer a declared <link rel="icon">, else the well-known path.
  const iconHref =
    document.querySelector('link[rel="icon"]')?.getAttribute("href") ??
    document.querySelector('link[rel="shortcut icon"]')?.getAttribute("href") ??
    document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href");
  const favicon = abs(finalUrl, iconHref) ?? abs(finalUrl, "/favicon.ico");

  if (title === "") {
    console.warn(`  ! no title found: ${url}`);
    return null;
  }
  const card: Card = { title };
  if (description !== undefined) {
    card.description = description;
  }
  if (image !== undefined) {
    card.image = image;
  }
  if (siteName !== "") {
    card.siteName = siteName;
  }
  if (favicon !== undefined) {
    card.favicon = favicon;
  }
  return card;
}

// Dispatch: GitHub blob + line range -> code embed; everything else -> OGP card.
async function fetchEntry(url: string): Promise<Card | null> {
  const gh = parseGitHubBlob(url);
  if (gh !== null && gh.startLine > 0) {
    return fetchGitHubCode(gh);
  }
  return fetchCard(url);
}

// --- driver ----------------------------------------------------------------
const cache = new Map<string, Card>();
try {
  const text = await readFile(CACHE_FILE, "utf8");
  for (const [url, card] of Object.entries(parseTrustedJson<Record<string, Card>>(text))) {
    cache.set(url, card);
  }
} catch {
  /* first run */
}

const urls = await collectUrls();
const referenced = new Set(urls);
const toFetch = urls.filter((url) => force || !cache.has(url));
const nKept = urls.length - toFetch.length;
const fetched = await Promise.all(
  toFetch.map(async (url) => {
    console.log(`  fetching: ${url}`);
    return [url, await fetchEntry(url)] as const;
  }),
);
let nFetched = 0;
let nFailed = 0;
for (const [url, card] of fetched) {
  if (card) {
    cache.set(url, card);
    nFetched++;
  } else {
    nFailed++;
  }
}

// Drop entries no longer referenced by any org file (only on a full scan).
let nPruned = 0;
if (urlArgs.length === 0) {
  for (const key of cache.keys()) {
    if (!referenced.has(key)) {
      cache.delete(key);
      nPruned++;
    }
  }
}

// Write sorted by key for stable diffs.
const sorted = Object.fromEntries([...cache.keys()].toSorted().map((k) => [k, cache.get(k)]));
await writeFile(CACHE_FILE, `${JSON.stringify(sorted, null, 2)}\n`);

console.log(
  `linkcards: ${nFetched} fetched, ${nKept} cached, ${nFailed} failed, ${nPruned} pruned ` +
    `(${Object.keys(sorted).length} total)`,
);
if (nFailed > 0) {
  process.exit(1);
}
