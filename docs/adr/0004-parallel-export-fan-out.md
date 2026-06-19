# Parallelise Org export across worker processes with a coordinator-owned cache

The Org → HTML export is the build's only real bottleneck (~7 s of an ~8 s clean
build; everything else — assets, link cards, Prettier, post-process — is under
1.5 s combined). `org-publish` runs it as a single-threaded sequential loop
(`dolist` over files in one Emacs process), and Emacs Lisp has no usable
in-process parallelism for this. So `build.el` now runs as a **coordinator** that
fans the per-file export out to N **worker** Emacs subprocesses via
`make-process`, and owns the `org-publish` timestamp cache itself.

The export is the right thing to parallelise and the only thing worth it: it is
CPU-bound and uniform per file (~0.037 s/file, no hot file — the slowest single
article is 0.135 s), so wall-clock scales with cores. `just build` parallelises
by default; CI inherits it for free (`nix build` → `just build --release` picks
up `$NIX_BUILD_CORES`).

## Why the coordinator owns the cache (the surprising part)

The hard part isn't spawning processes — it's the `.org-timestamps` cache that
decides which files are stale. If every worker read and wrote it, they would race
on the same cache file. The resolution: **only the coordinator touches the
cache; workers are stateless force-exporters.**

This works because of how `org-publish` already behaves. `org-publish-file`
stamps a file *after* exporting it, storing the source's *current* mtime
(`org-publish-update-timestamp` → `org-publish-cache-mtime-of-src`); staleness is
a plain "stored stamp < source mtime" comparison (`org-publish-cache-file-needs-
publishing`). So "compute the stale set up front, export, then stamp" is exactly
what stock Org does — just lifted out of the per-file loop into the coordinator:

1. `org-publish-initialize-cache`, then `org-publish-cache-file-needs-publishing`
   per base file → the stale set.
2. Partition the stale set; spawn `emacs … --script build.el -- --export-worker
   <chunk>` per worker (dual-mode `build.el`); each force-exports its list and
   never opens the cache.
3. For each file whose worker exited 0, `org-publish-update-timestamp`; then
   `org-publish-write-cache-file` once.

Because steps 1 and 3 call Org's own functions, the on-disk cache stays identical
to what a plain serial `just build` produces — the two are interchangeable, and a
file is **never stamped unless its worker actually produced the HTML** (the cache
invariant). The one caveat — a source edited *during* its own export could be
missed next run — is not new: single-process `org-publish` has the same window
because it, too, stamps the post-export mtime.

## Considered alternatives

- **`org-publish`'s `async` flag** — rejected: it forks *one* background Emacs to
  run the whole job off the main process (so an interactive session doesn't
  block); it does not split work across cores.
- **External bash/`xargs -P` driver** — rejected: splits the build across three
  cross-language invocations (gen index/tags → workers → stamp cache), spreads
  cache logic out of `build.el` against the "monolithic build.el" convention, and
  needs a tool not in the nix build inputs. Elisp `make-process` keeps everything
  in one file/language with no new dependency.
- **Per-worker cache dirs, merged afterward** — rejected: reintroduces the format
  juggling that coordinator-ownership avoids entirely.
- **Per-file failure precision** — rejected for **per-chunk fail-fast**: a worker
  aborts on its first export error (like `org-publish-file` today) and exits
  non-zero; the coordinator stamps only fully-successful chunks and fails the
  build on any worker error. Simpler worker, bounded rework (one chunk) on the
  rare broken-article case.

## Consequences

- **Worker count** `N = min(stale-count, $NIX_BUILD_CORES || num-processors)` —
  bounded by the *stale* set (not total articles, so a 1-file incremental spawns
  1 worker), and by nix's core allotment rather than raw host `nproc` to stay a
  good hermetic-sandbox citizen. No per-worker chunk floor: workers boot in
  parallel, so more workers is faster wall-clock until cores run out.
- **In-process threshold.** Below ~10 stale files the build exports in-process
  (today's serial path) instead of forking. The coordinator is already booted, so
  a worker's ~0.36 s startup only pays off once parallel savings exceed it
  (`startup ÷ per-file ≈ 10`). This keeps `watch` (edit one article → one stale
  file) from regressing. `-j 1` forces in-process always; `-j N` forces N.
- **Output is order-independent.** Per-article export carries no cross-file
  mutable state: `my-codeblock-counter` resets per file in `my-html-head`, and
  the eager-image budget lives only in coordinator-side index/tag generation. So
  worker assignment cannot change the HTML — the build stays reproducible/
  hermetic.
- Export errors no longer abort the instant they occur — sibling workers finish
  and their good output is stamped — but the build still exits non-zero, so a
  retry re-does only the failed chunk.
