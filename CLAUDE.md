# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a static site generator for a Japanese technical devlog. Content is authored in Org Mode (`.org` files) and converted to HTML by a custom TypeScript build (uniorg + tree-sitter + KaTeX, no Emacs). The build is a **Vite project in `builder/`**, run with `vite-node` — so the render imports its CSS modules (`*.module.css`) directly, Vite-scoped.

## Core Commands

### Building and Development
- `just build` - Build the devlog into `out/`. Runs the Vite builder
  (`cd builder && vite-node src/main.ts`): builds assets (`src/assets.ts`), then
  renders `.org` → HTML and bakes tree-sitter/KaTeX/link-cards in one pass
  (`builder/src/render.tsx` + `builder/src/bake.ts`), in-process, no separate
  format step. This is what nix/CI ship. `BUILD_PROF=1` prints phase timings.
- `just test` - Run the render/bake goldens + behavior tests with **vitest**
  (`cd builder && vitest run`); `just test-update` regenerates goldens.
- `just clean` - Clean `out/`
- `just watch` - Watch `src/` and run the fast warm `build` on change (release
  only; drafts are skipped). Also serves `out/` on port 8080 with **Vite-style
  live reload**: the browser refreshes the instant a rebuild lands (CSS edits
  hot-swap without navigating; a body-only edit reloads just the tab on that
  page). The reload client is injected at serve time only (SSE on
  `/__livereload`), so `out/` stays the byte-exact release output. `DEV_PORT=0`
  disables the server (preview with `just serve` instead);
  `builder/src/dev-server.ts` is the server.
- `just serve` - Start HTTP server on port 8080 to preview `out/` (plain static,
  no live reload — for inspecting the exact release output)

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

### Build Flow (the `builder/` Vite project, run via vite-node)
1. **Content**: Articles written in Org Mode format in `src/`
2. **Assets**: `builder/src/assets.ts` builds the CSS modules into
   `components.min.css` (Vite, same `generateScopedName` the render uses) and
   minifies/bundles the rest (esbuild).
3. **Orchestrate**: `builder/src/build.ts` lists sources and assembles the index
   + tag pages from the rendered metadata; `builder/src/main.ts` is the CLI entry.
4. **Render**: each `.org` is parsed with uniorg and rendered to page HTML
   (`builder/src/render.tsx`: uniorg2rehype + custom handlers + rehype-katex).
   Sharded across parallel `bun dist/render-shard.js` child processes, each with
   one warm tree-sitter/uniorg setup, overlapped with the asset/static/KaTeX copies.
5. **Bake**: the same pass bakes tree-sitter highlighting + KaTeX + `[[card:URL]]`
   cards in-process (`builder/src/bake.ts` + `builder/src/highlight.ts`),
   stamping a `<!--pp-->` sentinel.
6. **Static**: `html/js/css/png/...` (excluding `ltximg/`) copied from `src/`,
   concurrently with the render. Output: static files in `out/`.

Strict mode (`CI=1` / `--strict`) fails on unknown languages / KaTeX errors /
uncached cards.

### Key Files and Directories
- `builder/` - the Vite project: `vite.config.ts` (CSS-module scoping + JSX `h`
  factory), `vitest.config.ts`, `config-shared.ts`, `package.json`/`node_modules`
- `builder/src/main.ts` - CLI entry; `build.ts` - orchestration + helpers
- `builder/src/render.tsx` - org → page HTML; imports `./styles/*.module.css` directly
- `builder/src/bake.ts` / `bake-util.ts` - KaTeX/card bake engine; `highlight.ts` - tree-sitter engine
- `builder/grammars/` - vendored grammar `wasm/` + `queries/` (+ `vendor.sh`); see its README
- `builder/src/assets.ts` - builds `components.min.css` + minifies/bundles assets
- `builder/src/styles/*.module.css` - scoped CSS modules (Vite resolves them)
- `builder/src/html.ts` - tiny JSX-to-string runtime (`h`/`Fragment`/`raw`)
- `builder/test/` - vitest goldens (`golden/`) + fixtures (`fixtures/`)
- `scripts/fetch-linkcards.ts` - Bun OGP scraper (offline) -> `linkcard-cache.json`
- `linkcard-cache.json` - Committed OGP metadata for `[[card:URL]]` links
- `src/` - Source Org files (articles and pages); `src/style/` - global CSS + browser TS
- `src/tags/` - Auto-generated tag pages
- `out/` - Generated HTML output

### Custom Org Blocks
The build system supports these custom blocks:
- `#+BEGIN_DETAILS` / `#+END_DETAILS` - Collapsible details sections
- `#+BEGIN_YARUO` / `#+END_YARUO` - Special formatting for character dialogue
- `#+BEGIN_STENO` / `#+END_STENO` - Stenography notation blocks

### Link Cards
`[[card:https://example.com]]` (a custom Org link type, registered in
`builder/src/render.tsx` via uniorg's `linkTypes`) renders a rich preview. Two
kinds, chosen by URL:
- **OGP card** — title / description / image / favicon scraped from the page.
- **GitHub code embed** — a blob permalink *with a line range*
  (`github.com/owner/repo/blob/<sha>/file#L10-L20`) embeds the actual source
  lines, tree-sitter-highlighted (same theme as the rest of the site) with a
  line-number gutter that starts at the real source line. Use a commit-SHA
  permalink (`y` on GitHub) for reproducibility. Without a line range it's just an
  OGP card.

Because the build is offline/hermetic (nix/CI sandbox has no network), metadata
is fetched **ahead of time** by `scripts/fetch-linkcards.ts` (`just linkcards`)
into the committed `linkcard-cache.json`; `builder/src/bake.ts` bakes the card
HTML from that cache. A URL absent from the cache degrades to a plain link and
fails the build under `--strict` (CI/nix), so the cache must be committed
alongside the article.

### Header & Footer Icons
The header nav and footer links carry small inline-SVG icons (no icon font, no
runtime JS, no extra requests — keeps the build hermetic/offline). Each icon uses
`currentColor` and `1em` sizing, so it inherits the link colour, the accent
colour on hover, and works in both themes.

The SVG markup **lives inline as JSX in the `HEADER` / `FOOTER` constants in
`builder/src/render.tsx`** (a shared `NavIcon` component wraps the `<svg>`) —
there are no separate asset files. Alignment is CSS only (`.nav-icon`, the
`header > nav a` / `footer > div a` flex rules in `style.css`).

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
the `<svg>` (with `class="nav-icon"`) inline into the `HEADER` / `FOOTER` JSX (or
wrap its `<path>`s in `<NavIcon>`). Keep external-site links to generic icons, not
the destination's trademarked logo.

### CSS Modules
Component styles live in `builder/src/styles/*.module.css` (article-card, steno,
toc). `render.tsx` imports them directly (`import card from
"./styles/article-card.module.css"`) and Vite returns the scoped class map.
`generateScopedName` (`builder/config-shared.ts`) is deterministic and hash-free
(`article-card.module.css` class `articleCard` -> `article-card_articleCard`), so
the render and the CSS build (`assets.ts` -> `components.min.css`) agree on names.
Disco/theme rules in a module use `:global()` for ancestor classes. The remaining
global CSS stays in `src/style/style.css`.

### Dependencies
- **Build tooling** (in `builder/`): `vite` + `vite-node` (run the build, resolve
  CSS modules), `esbuild` (minify CSS / bundle browser TS), `vitest` (tests). Bun
  is used as the launcher (`bunx vite-node`) and still runs `scripts/fetch-linkcards.ts`.
- **Node deps**: `web-tree-sitter`, `katex`, `linkedom`, `uniorg` (render/bake)
- **Frontend**: Simple.css, custom fonts, `katex.min.css` (no runtime highlighter/MathJax)

## Development Notes

### Content Structure
- Articles use Org Mode with custom metadata headers
- Automatic sitemap generation from org file metadata  
- Tag system with automatic tag page generation
- Japanese language support with proper HTML lang attributes

### Syntax Highlighting
All at build time, by **tree-sitter** via `web-tree-sitter`
(`builder/src/highlight.ts`; replaced Shiki — parses a string, no DOM). It
implements the **official `tree-sitter-highlight` algorithm** (the one Helix /
GitHub use), NOT a naive pass — this is what makes highlighting *semantic*:
- **last-pattern-wins** precedence (curated queries put generic captures first,
  specific ones later to override);
- **locals**: a `@local.reference` reuses its `@local.definition`'s highlight, so
  real local variables aren't mislabeled by broad fallback patterns (e.g. a
  haskell function name is coloured as a function, a bound var stays plain);
- **injections**: a sub-region is re-highlighted with another grammar (makefile
  recipe → bash, markdown → markdown_inline, fenced code → its language).
Nesting resolves by painting larger ranges first so inner nodes win. `render.tsx`
emits each code block as raw text on `<code class="language-XX">` + opt-in
metadata; `bake.ts` feeds that to `highlight()` and swaps in the `<pre
class="hl">`. Capture names → `hl-<bucket>` CSS classes via `CLASS_TABLE`. Features:
- **Dual theme** (mandatory light/dark): CLASS-based. `style.css` defines an `.hl`
  palette of CSS variables (`--c-kw`, `--c-str`, …) rebound per theme via
  `[data-theme]` + `prefers-color-scheme`. Palette = sonokai (dark) + One Light
  (light) — swap the two `.hl` blocks in `style.css` to restyle everything.
- **Line numbers**: opt-in per block via org's `-n`/`+n` switch; a CSS counter on
  the `.line` spans (also on GitHub code-embeds, starting at the source line).
- **diff-`<lang>`**: strip the +/- column, highlight the body as `<lang>`, mark
  `.line.diff.add`/`.remove`. **Coderefs**: `(ref:label)` → the line becomes an
  `<a class="line coderef-off">` and the label span gets `coderef-anchor`.
- **Languages**: each needs a vendored `grammars/wasm/<id>.wasm` + Helix-sourced
  `grammars/queries/<id>.{scm,locals.scm,injections.scm}` — **add one with
  `grammars/vendor.sh`** (see its README), then map the org token in `ALIAS` in
  `highlight.ts`; otherwise strict CI fails on the unknown tag.
  `ditaa`/`plantuml` have no grammar and render as plain text. Helix's thin
  js/ts/tsx (and cpp) queries use `; inherits:` to pull in shared base query sets
  (`ecma`/`_javascript`/`_typescript`/`_jsx`, grammar-less) — `highlight.ts`'s
  `readQuery` resolves that, so those bases must be vendored too or js/ts/tsx
  highlight almost nothing (with no build error).

### Build Modes
- **Release (the only mode)**: `just build` renders `src/` only and skips
  `#+DRAFT` articles. There is no draft build path.

The build is split across `builder/src/build.ts` (orchestration) +
`builder/src/render.tsx` (org → HTML) + `builder/src/bake.ts` + `highlight.ts` (tree-sitter/KaTeX/cards).