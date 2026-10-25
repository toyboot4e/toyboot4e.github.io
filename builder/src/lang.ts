// Article languages. Japanese is the primary language at the root URLs; an
// English translation sits beside its source as `<name>.en.org` and ships under
// `/en/`. A Japanese article without a published translation still gets an
// `/en/` page (its Japanese body under English chrome + a notice), so the
// language switch never 404s; it is left out of the English listings.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { literal } from "./guard.ts";

export type Lang = "ja" | "en";
export const isLang = literal("ja", "en");

export const langOf = (relOrg: string): Lang => (relOrg.endsWith(".en.org") ? "en" : "ja");

// `foo.org` <-> `foo.en.org` (source paths relative to src/)
export const counterpartOf = (relOrg: string): string =>
  langOf(relOrg) === "en" ? relOrg.replace(/\.en\.org$/u, ".org") : relOrg.replace(/\.org$/u, ".en.org");

// `foo.org` -> `foo.html`, `foo.en.org` -> `en/foo.html`
export const outRelOf = (relOrg: string): string =>
  langOf(relOrg) === "en" ? `en/${relOrg.replace(/\.en\.org$/u, ".html")}` : relOrg.replace(/\.org$/u, ".html");

// The `/en/` page standing in for an untranslated Japanese article.
export const fallbackRelOf = (relOrg: string): string => `en/${relOrg.replace(/\.org$/u, ".html")}`;

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
