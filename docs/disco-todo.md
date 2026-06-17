# Disco / theme follow-up TODO

Working list for the three items requested (worked on while away). Each lands as
its own commit(s) on `main`. Status updated as I go.

## (1) CSS cleanup — disco / theme parts  — STATUS: in progress

The "conscious" cleanup discussed earlier: collapse the light/dark **duplication**
in the disco CSS using plain-CSS custom properties (no SCSS, no CSS Modules —
those don't fit a static, global-class, Emacs-exported site).

The pain: every theme-varying disco value is written 2–3× — once for the dark
base, once under `:root[data-theme="light"]`, and again under
`@media (prefers-color-scheme: light) :root:not([data-theme="dark"])` (a verbatim
copy with a different selector). Plan: hoist those values into `--disco-*` tokens
defined once per theme (the dual light selector stays, but only on the *token
block*, not on every consuming rule), so the many disco rules read `var(--disco-*)`
once. simple.css stays untouched.

## (2) Richer light-theme shader  — STATUS: todo

The light-theme WebGL effect (`src/style/disco.ts`, the `u_light` branch) reads
sparser/less satisfying than dark. Add more on-screen items in the light path
(more rings / spotlights / cast glints), tunable via the existing `L*` constants.
Keep the centre reading column calm; richness belongs in the margins. Build-verify
only — can't preview, so keep additions conservative and clearly tunable.

## (3) Pane-oriented article display in disco mode (experimental)  — STATUS: todo

Idea: in disco mode, each `h2` section becomes its own pane — a pane spans from
one `h2` to the next. Today the whole `#content` shares one `::before` backdrop.

Feasibility note: Org export emits a *flat* heading+content stream (no per-section
wrapper element), and CSS can't group "from one h2 to the next" on its own. So this
needs either (a) a small client script that wraps each h2-run in a `<section>` /
adds a backdrop, or (b) build.el emitting section wrappers. Prototype behind a
class/flag so the default rendering is unaffected; treat as experimental.
