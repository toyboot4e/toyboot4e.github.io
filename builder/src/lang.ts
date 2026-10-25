// Article languages. English is the default at the root URLs (also served
// under `/en/` as canonical-pointing copies); Japanese ships under `/ja/`. Every
// source names its language: `<name>.ja.org`, and an English translation beside
// it as `<name>.en.org`. A
// Japanese article without a published translation still gets a root page (its
// Japanese body under English chrome + a notice), so the language switch and
// the pre-`/ja/` URLs never 404; it is left out of the English listings.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { literal } from "./guard.ts";

export type Lang = "ja" | "en";
export const isLang = literal("ja", "en");

const LANG_ORG_RE = /\.(ja|en)\.org$/u;

export const hasLang = (relOrg: string): boolean => LANG_ORG_RE.test(relOrg);

export function langOf(relOrg: string): Lang {
  const l = LANG_ORG_RE.exec(relOrg)?.[1];
  if (!isLang(l)) {
    throw new Error(`${relOrg}: name the language, as <name>.ja.org or <name>.en.org`);
  }
  return l;
}

// `foo` from `foo.ja.org` / `foo.en.org` (source paths relative to src/)
const stemOf = (relOrg: string): string => relOrg.replace(LANG_ORG_RE, "");

// `foo.ja.org` <-> `foo.en.org`
export const counterpartOf = (relOrg: string): string =>
  `${stemOf(relOrg)}.${langOf(relOrg) === "en" ? "ja" : "en"}.org`;

// `foo.ja.org` -> `ja/foo.html`, `foo.en.org` -> `foo.html`
export const outRelOf = (relOrg: string): string =>
  langOf(relOrg) === "en" ? `${stemOf(relOrg)}.html` : `ja/${stemOf(relOrg)}.html`;

// The root page standing in for an untranslated Japanese article.
export const fallbackRelOf = (relOrg: string): string => `${stemOf(relOrg)}.html`;

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
