# Disco / theme follow-up TODO

Worked through while away. All four landed as their own commits on `main` (after
the history was squashed into clean units). The two visual ones (2, 3) couldn't
be previewed here, so they need an eyeball + tuning.

## (1) CSS cleanup — disco / theme parts  — DONE (`refactor(css): hoist disco surface colors into --disco-* tokens`)

Collapsed the light/dark duplication: all disco pane/surface colors now live in
`--disco-*` tokens defined once per theme; rules read `var(--disco-*)`. The only
remaining duplication is the three tokens that must differ in light theme (card
bg/hover, header/footer chrome) — explicit-light + the OS-light media query,
which can't merge. Plain CSS, no SCSS/CSS-Modules (don't fit). simple.css
untouched. Behaviour-preserving.

## (2) Richer light-theme shader  — DONE, NEEDS EYEBALL (`feat(disco): richer light-theme field — a third rainbow ring`)

Parametrized `ringAt`'s center bias and added a third rainbow ring drifting
upper-left (the two existing rings stay on the right orbit), so more of the
screen carries the light. Tunable via the `LRING_*` constants and each ring's
bias in `src/style/disco.ts`. Couldn't preview — check the count/placement; add
more rings or a cast-glint sprinkle if it still reads sparse.

## (3) Pane-per-h2 article display (experimental)  — TRIED, REVERTED

Prototyped (JS section-wrapping into `.disco-sec` panes) but reverted — final
decision is to keep the previous design: articles use the single content
backdrop, and the homepage/tag pages use the header-based heading panes (chips)
with their cards. No `.disco-sec`, no layout unification.

## (4) Tag pages styled like index.html  — DONE (`feat: give tag pages the same (home) styling as index.html`)

Tag pages now carry the `home` class (via `my-listing-page-p` in build.el) and
disco.ts detects "home" from that class, so tag pages get the card/heading
styling and full-opacity effect like the homepage instead of the article
treatment.
