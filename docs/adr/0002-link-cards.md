# Link cards via a custom Org link type and a committed OGP cache

`[[card:https://example.com]]` renders an OGP rich-preview card (title,
description, image, site name, favicon). The metadata is fetched **ahead of
time** by `scripts/fetch-linkcards.ts` into a committed `linkcard-cache.json`,
and `scripts/postprocess.ts` bakes the card HTML from that cache. The build
itself never touches the network.

## Why fetch ahead of time instead of during the build

The release build is offline and hermetic: `nix build` runs in a sandbox with no
network, and CI runs `CI=1 bun scripts/postprocess.ts` (strict). Fetching OGP
during the post-process pass would break both. So the network step is split out:

- `just linkcards` (→ `scripts/fetch-linkcards.ts`) scans `src/` and `draft/`
  for `[[card:URL]]`, fetches each page once, scrapes `og:*` / `twitter:*` /
  `<title>` / `<meta name=description>` / `<link rel=icon>`, and writes
  `linkcard-cache.json` (sorted keys, for stable diffs). Existing entries are
  kept unless `--force`; URLs no longer referenced are pruned.
- `scripts/postprocess.ts` reads the cache and fills the placeholder anchors.

The cache is committed, so it is just source from the build's point of view —
`nix build` (whose `src = ./.`) and CI both read it offline and deterministically.

## Two card kinds: OGP card and GitHub code embed

A cache entry is discriminated by `kind`:

- **`card`** (default; `kind` omitted for back-compat) — OGP title / description /
  image / site name / favicon, scraped from the page's `<meta>` tags.
- **`github-code`** — for a GitHub *blob permalink with a line range*
  (`github.com/owner/repo/blob/<ref>/path#L10-L20`), the fetcher downloads the
  raw file, slices the lines, and stores the snippet plus a Prism language
  inferred from the extension. Post-process emits a `<figure>` with a header
  linking to GitHub and the code Prism-highlighted (same theme as the rest of the
  site), with a line-number gutter. A GitHub URL *without* a line range is just an
  ordinary OGP `card`.

The `github-code` figure is block-level, so (unlike the phrasing-only OGP card)
it replaces the enclosing `<p>` Org wrapped the lone link in, rather than sitting
inside it.

## Highlighting the embed (Prism, with a real-line gutter)

The embed is highlighted with **Prism**, like every other code block — so its
palette matches the site and there's no second highlighter to maintain. (An
earlier revision used Shiki with the `github-*` themes for GitHub-exact colors;
it was reverted in favour of site consistency. Shiki remains the way to get
GitHub's *exact* look if that's ever wanted — it ships the real `github-light` /
`github-dark` themes and works at build time; the only off-platform path to a
pixel-identical GitHub box is GitHub's runtime-JS gist embed, a non-starter
here.)

Mechanic worth noting (`scripts/postprocess.ts`): the Prism **`line-numbers`
plugin** only emits its gutter for an *attached* `<pre>` (it reads the
`line-numbers` class and `data-start` off the parent). The general
`highlightCode` path reuses a *detached* `<code>`, so the embed gets its own
path: a full `<pre class="line-numbers" data-start="<startLine>">` is built and
highlighted inside the happy-dom document, then its HTML is spliced into the
card. `data-start` makes the gutter begin at the **real** source line.
`renderLinkCards` runs *after* `highlightCode` so that pass doesn't re-process
the already-highlighted embed. An extension with no mapped Prism language
renders as a plain, unhighlighted block — never a strict failure.

Two gotchas the embed has to handle itself:

- **Prism stylesheets.** `build.el` only links the Prism CSS when the *exported*
  page already contains `language-` (`has-code`). The embed's `language-*` is
  injected *after* export, so a page whose only code is an embed would ship
  unstyled. `ensurePrismCss()` adds the two `<link>`s (matching build.el's ids +
  media) when missing, so style.js's theme toggle still drives them.
- **Flush to the border.** Prism's `pre[class*="language-"]` rule (specificity
  0,1,1) carries `margin:.5em 0` + `border-radius:.3em`, which beats a plain
  `.gh-embed-code` class and would leave a gap with rounded inner corners. The CSS
  uses the descendant selector `.gh-embed .gh-embed-code` (0,2,0) to win, so the
  header and code fill the figure flush to its border. The file extension maps to
  the most accurate Prism language id (e.g. `.el` → `emacs-lisp`, an alias of
  `lisp`), set in `fetch-linkcards.ts`.

## Why a custom link type, not a special block

`#+BEGIN_…` special blocks (DETAILS/STENO/YARUO) are the project's usual
extension point, but a card is fundamentally *a link*, and `[[card:URL]]` reads
that way. It is registered in `build.el` with `org-link-set-parameters` (not just
a branch in `my-org-html-link`) because Org otherwise aborts export trying to
*resolve* an unknown link type ("Unable to resolve link"). The `:export` handler
emits a placeholder `<a class="link-card" href data-link-card>` that the
post-process pass rewrites.

The baked card is **phrasing-only markup** (`<a>` wrapping `<span>`/`<img>`), so
it stays valid HTML inside the `<p>` Org wraps a lone link in; CSS turns the
anchor into a flex card.

## Consequences

- **Authoring is one step locally:** `just build` runs `just linkcards`
  best-effort first (`-` prefix, so offline/fetch errors don't fail it), so
  adding `[[card:URL]]` and building just works. A URL still missing from the
  cache (offline, or a failed fetch) degrades to a plain link and fails the build
  under `--strict` (CI/nix) — so a card can't *ship* without its committed
  metadata, even though local builds are forgiving. Commit `linkcard-cache.json`
  with the article.
- **Refreshing an existing card** (cache changed but the `.org` did not) needs a
  forced rebuild of that page (`just clean && just build`), because the
  `<!--pp-->` sentinel skips already-baked files that Emacs didn't regenerate.
- **External assets are hotlinked:** `og:image` and the favicon are served from
  the third-party origin (lazy-loaded). This leaks the visitor's IP to those
  hosts and is the one place the site isn't fully self-hosted. Mirroring images
  into the repo at `just linkcards` time (à la `scripts/to-webp.ts`) is a
  possible follow-up if that tradeoff matters.
