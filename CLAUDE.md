# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a static site generator for a Japanese technical devlog. Content is authored in Org Mode (`.org` files) and converted to HTML by a custom TypeScript build that runs on Bun (uniorg + Prism/KaTeX, no Emacs).

## Core Commands

### Building and Development
- `just build` - Build the devlog into `out/`. Renders `.org` → HTML and bakes
  Prism/KaTeX/link-cards in one parallel pass (`build.ts` + `build/render*.tsx` +
  `build/bake*.ts`); bakes in-process, no separate format step. This is what
  nix/CI ship. `BUILD_WORKERS=N` caps worker threads; `BUILD_PROF=1` prints
  phase/worker timings.
- `just clean` - Clean `out/`
- `just watch` - Watch `src/` and run the fast warm `build` on change (release
  only; drafts are skipped)
- `just serve` - Start HTTP server on port 8080 to preview `out/`

### Processing
- `just linkcards` - Fetch OGP metadata for `[[card:URL]]` links into
  `linkcard-cache.json` (committed). `--force` refreshes all (use to pick up
  changed remote metadata); pass URLs to fetch only those. `just build` already
  runs this best-effort, so you rarely call it directly — but `--force` and the
  initial fetch when offline-building still need it. The hermetic nix/CI build
  only *reads* the cache (no network), so the cache must be committed.

### Nix Build
- `nix build` - Build the shipped site using Nix flakes
- `nix develop` - Dev shell with all deps

## Architecture

### Build Flow
1. **Content**: Articles written in Org Mode format in `src/`
2. **Orchestrate**: `build.ts` lists sources, shards them round-robin across
   worker threads, and assembles the index + tag pages from returned metadata.
3. **Render**: each worker parses `.org` with uniorg and renders the page HTML
   (`build/render.tsx`: uniorg2rehype + custom handlers + rehype-katex).
4. **Bake**: the same worker bakes Prism highlighting + KaTeX + `[[card:URL]]`
   cards in-process (`build/bake.ts`), stamping a `<!--pp-->` sentinel. No
   separate format step.
5. **Static**: `html/js/css/png/...` (excluding `ltximg/`) copied from `src/`,
   concurrently with the workers. Output: static files in `out/`.

Strict mode (`CI=1` / `--strict`) fails on unknown languages / KaTeX errors /
uncached cards. See `docs/adr/0001-build-time-prism-katex-ssr.md` and
`docs/adr/0002-link-cards.md`.

### Key Files and Directories
- `build.ts` - Build orchestrator (parallel worker fan-out)
- `build/render.tsx` / `render-worker.ts` - org → page HTML (worker)
- `build/bake.ts` / `bake-util.ts` - Prism/KaTeX/card bake engine
- `build/styles/*.module.css` - scoped CSS modules (bundled by `scripts/build-assets.ts`)
- `scripts/fetch-linkcards.ts` - Bun OGP scraper (offline) -> `linkcard-cache.json`
- `linkcard-cache.json` - Committed OGP metadata for `[[card:URL]]` links
- `src/` - Source Org files (articles and pages)
- `src/tags/` - Auto-generated tag pages
- `out/` - Generated HTML output

### Custom Org Blocks
The build system supports these custom blocks:
- `#+BEGIN_DETAILS` / `#+END_DETAILS` - Collapsible details sections
- `#+BEGIN_YARUO` / `#+END_YARUO` - Special formatting for character dialogue
- `#+BEGIN_STENO` / `#+END_STENO` - Stenography notation blocks

### Link Cards
`[[card:https://example.com]]` (a custom Org link type, registered in
`build/render.tsx` via uniorg's `linkTypes`) renders a rich preview. Two kinds,
chosen by URL:
- **OGP card** — title / description / image / favicon scraped from the page.
- **GitHub code embed** — a blob permalink *with a line range*
  (`github.com/owner/repo/blob/<sha>/file#L10-L20`) embeds the actual source
  lines, Prism-highlighted (same theme as the rest of the site) with a
  line-number gutter that starts at the real source line. Use a commit-SHA
  permalink (`y` on GitHub) for reproducibility. Without a line range it's just an
  OGP card. See `docs/adr/0002-link-cards.md`.

Because the build is offline/hermetic (nix/CI sandbox has no network), metadata
is fetched **ahead of time** by `scripts/fetch-linkcards.ts` (`just linkcards`)
into the committed `linkcard-cache.json`; `build/bake.ts` bakes the card HTML
from that cache. A URL absent from the cache degrades to a plain link and
fails the build under `--strict` (CI/nix), so the cache must be committed
alongside the article. See `docs/adr/0002-link-cards.md`.

### Header & Footer Icons
The header nav and footer links carry small inline-SVG icons (no icon font, no
runtime JS, no extra requests — keeps the build hermetic/offline). Each icon uses
`currentColor` and `1em` sizing, so it inherits the link colour, the accent
colour on hover, and works in both themes.

The SVG markup **lives inline in the `HEADER` / `FOOTER` template-string
constants in `build/render.tsx`** — there are no separate asset files or wrapper
helpers. Alignment is CSS only (`.nav-icon`, the `header > nav a` / `footer > div
a` flex rules in `style.css`).

All icons are [Lucide](https://lucide.dev) (license ISC), stroked multi-`<path>`
(`viewBox="0 0 24 24"`, `fill=none`, `stroke=currentColor`, `stroke-width=2`,
round caps). We deliberately **do not** use the real GitHub/Qiita/Zenn brand
logos: their brand guidelines forbid recolouring, and we tint every icon with
`currentColor` + hover accent. So the external links use generic semantic
stand-ins (the text label carries the brand name): GitHub = `git-branch` (code
repo), Qiita = `newspaper` (articles), Zenn = `book-open` (books). Home = house,
AtCoder = trophy (also a stand-in — AtCoder has no official icon). The same
`git-branch` stand-in is reused for the GitHub code-embed link-card header
(`gh-embed-icon` in `build/bake.ts`).

To add/refresh one: `curl` the raw SVG
(`raw.githubusercontent.com/lucide-icons/lucide/main/icons/<name>.svg`) and paste
the `<svg>` (with `class="nav-icon"`) inline into the `HEADER` / `FOOTER` string.
Keep external-site links to generic icons, not the destination's trademarked
logo.

### Dependencies
- **External tools**: Bun (runs the build, bundles/minifies assets)
- **Node deps** (build-time, vendored offline for `nix build` via `buildNpmPackage`):
  `prismjs`, `katex`, `linkedom`, `happy-dom`, `uniorg`
- **Frontend**: Simple.css, custom fonts, `katex.min.css` (no runtime Prism/MathJax)

## Development Notes

### Content Structure
- Articles use Org Mode with custom metadata headers
- Automatic sitemap generation from org file metadata  
- Tag system with automatic tag page generation
- Japanese language support with proper HTML lang attributes

### Syntax Highlighting
All at build time. Code blocks get `language-XX` classes from uniorg;
`build/bake.ts` then bakes Prism highlighting. Most blocks use a fast
`Prism.highlight()` string call; blocks needing plugin hooks (coderef
`keep-markup`, `line-numbers`, `diff-*`) go through a happy-dom
`highlightElement`. **Add new languages to the `loadLanguages` list in
`build/bake.ts`**, or strict CI fails on the unknown tag. `org` has no Prism
grammar and renders as plain text.

### Build Modes
- **Release (the only mode)**: `just build` renders `src/` only and skips
  `#+DRAFT` articles. There is no draft build path.

The build is split across `build.ts` (orchestration) + `build/render*.tsx`
(org → HTML) + `build/bake*.ts` (Prism/KaTeX/cards).