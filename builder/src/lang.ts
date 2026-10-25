// Article languages. English is the default at the root URLs (also served
// under `/en/` as canonical-pointing copies); Japanese ships under `/ja/`. An
// English translation sits beside its Japanese source as `<name>.en.org`. A
// Japanese article without a published translation still gets a root page (its
// Japanese body under English chrome + a notice), so the language switch and
// the pre-`/ja/` URLs never 404; it is left out of the English listings.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { literal } from "./guard.ts";

export type Lang = "ja" | "en";
export const isLang = literal("ja", "en");

export const langOf = (relOrg: string): Lang => (relOrg.endsWith(".en.org") ? "en" : "ja");

// `foo.org` <-> `foo.en.org` (source paths relative to src/)
export const counterpartOf = (relOrg: string): string =>
  langOf(relOrg) === "en" ? relOrg.replace(/\.en\.org$/u, ".org") : relOrg.replace(/\.org$/u, ".en.org");

// `foo.org` -> `ja/foo.html`, `foo.en.org` -> `foo.html`
export const outRelOf = (relOrg: string): string =>
  langOf(relOrg) === "en" ? relOrg.replace(/\.en\.org$/u, ".html") : `ja/${relOrg.replace(/\.org$/u, ".html")}`;

// The root page standing in for an untranslated Japanese article.
export const fallbackRelOf = (relOrg: string): string => relOrg.replace(/\.org$/u, ".html");

// Every root (English) page is also written here, byte-identical: its
// `canonical` already names the root URL.
export const aliasRelOf = (rootRel: string): string => `en/${rootRel}`;

// Where a page in `lang` is written: an English page also gets its `/en/` copy.
export const destsOf = (lang: Lang, rel: string): string[] => (lang === "en" ? [rel, aliasRelOf(rel)] : [rel]);

// Mirrors render.tsx's `keyword(kw, "DRAFT") !== undefined`: a non-empty value.
const DRAFT_RE = /^[ \t]*#\+draft:[ \t]*\S/imu;

// Whether `relOrg` exists and is not a draft, i.e. whether the build ships it.
export function isPublished(src: string, relOrg: string): boolean {
  try {
    return !DRAFT_RE.test(readFileSync(join(src, relOrg), "utf8"));
  } catch {
    return false;
  }
}
