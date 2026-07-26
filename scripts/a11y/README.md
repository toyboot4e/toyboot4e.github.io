# Accessibility tooling

How this site's accessibility is measured, and how to test the parts a machine
cannot measure.

Everything here is **dev-only**. It has its own `package.json` on purpose: the
hermetic nix/CI build resolves `builder/node_modules` from a pinned
`package-lock.json`, and adding a browser driver there would bloat that closure
and force an `npmDepsHash` bump for tooling the build never runs. `bun install`
in this directory is all the setup there is; `out/` must already be built.

**Do not rebuild while a scan runs.** The tools serve `out/` straight off disk,
so a concurrent `just build` gets caught mid-write and reports nonsense —
`html-has-lang`, `document-title` and `target-size` failures on whichever pages
were being rewritten. Any of those three appearing on a scattered subset of pages
is the tell.

## The four commands

```sh
just build          # the tools read out/, so build first

just a11y           # axe-core, every page, both themes   <- the gate
just a11y-tree      # what a screen reader is handed
just a11y-tab       # what a keyboard user walks through
just a11y-contrast  # one row per syntax-highlight colour
```

### `just a11y` — axe-core over the whole site

The main gate. Loads every built page in headless Chromium **twice, once per
theme**, injects [axe-core](https://github.com/dequelabs/axe-core) and reports
violations grouped by rule rather than by node — one palette colour that fails
shows up as thousands of nodes otherwise. Exits non-zero on a `serious`+ finding,
so it works as a CI check.

Both themes matter: the light and dark palettes are independent sets of colours,
and in practice the light one failed contrast where dark passed.

```sh
just a11y                      # whole site, WCAG 2.0/2.1/2.2 level A + AA
just a11y --sample             # one page per template + the feature-heaviest ones (fast)
just a11y --all                # + advisory "best-practice" rules
just a11y index.html tags/nix.html
just a11y --theme=dark --json  # machine-readable
just a11y --fail-on=minor      # stricter exit code
just a11y --disco              # keep the WebGL background on (off by default: slow, and
                               # axe cannot see through a canvas anyway)
```

Why axe and not just Lighthouse: `just audit` (Lighthouse) samples **one page**
and runs a subset of these rules. It is still useful for perf/SEO, but it is not
an accessibility gate for a 160-page site.

### `just a11y-tree` — the accessibility tree

Chromium's own accessibility tree via CDP `Accessibility.getFullAXTree` — the
same structure it hands to a real screen reader over the platform accessibility
API, printed in reading order with roles, accessible names and heading levels.
Ignored nodes and layout noise are filtered out, so what prints is close to the
announcement sequence.

**This is the highest-value thing to read before and after any markup change.**
It catches exactly the class of problem axe scores as "passing": an unnamed
landmark, a run of 17 links with no list around them, a heading that announces as
nothing, a control whose name is a shrug. Those are not rule violations; they are
just a bad experience, and they are invisible unless you look at this.

```sh
just a11y-tree                       # index.html, dark
just a11y-tree 2024-07-07-nix-flakes.html --theme=light
```

### `just a11y-tab` — keyboard walkthrough

Presses Tab repeatedly and records what takes focus, in what order, under what
accessible name, and whether it shows a focus ring. This is how you notice that
the skip link is missing, that a control is a mystery focus stop, or that a
custom widget swallowed the tab order.

### `just a11y-contrast` — the syntax palettes

One row per `hl-*` bucket with its measured ratio against the background it
actually renders on, per theme, alpha layers composited. **Run this after
touching either `.hl` palette in `style.css`** — axe reports the same handful of
palette entries as thousands of nodes, which tells you nothing about which
colours to change.

## Where axe over-reports

`scrollable-region-focusable` checks the *markup* for a tab stop or focusable
content. It does not know that **Chromium 127+ and Firefox put overflowing scroll
containers in the tab order natively, and only the overflowing ones** — measured
here on Chromium 149 and Firefox 151, where Tab visits the overflowing `<pre>`s
and never a fitting one. So the rule fires on markup that already works in both
engines.

We satisfy it at build time anyway (`focusableScrollBlocks` in `bake.ts` puts
`tabindex="0"` on every `<pre>`), because the native behaviour is not universal —
WebKit and older engines are untested/unsupported here — and because a static
attribute needs no JavaScript. Do not "fix" this by measuring overflow in the
browser and setting the attribute at runtime: that puts an accessibility
affordance behind JS on a site that otherwise ships almost none, and only saves a
no-op tab stop on blocks that happen to fit (a median page has 3 code blocks;
p90 is 9, max 26).

## What automated testing does not catch

Rule engines catch on the order of a third of real accessibility problems. They
verify that a name *exists*, never that it is *useful*; that headings nest, never
that they describe anything. Nothing above can tell you whether the page makes
sense when you cannot see it. That needs a screen reader.

Specific things on this site that no rule can check:

- Does the reading order of an article still make sense with the ToC at the end
  of `main`?
- Are `#+BEGIN_STENO` / `#+BEGIN_KEYBOARD` charts comprehensible, or just a wall
  of announced key names? (They are decorative grids of `<div>`s; a chart may be
  better off summarised in prose next to it.)
- Does a code block with `(ref:label)` coderefs read coherently?
- Do the KaTeX formulas read correctly? (MathML is rendered for AT, but coverage
  differs sharply per screen reader.)
- Is the disco ball's motion distracting even though it is `aria-hidden`?

## Testing with a screen reader

### Linux (this machine — NixOS + i3)

**Orca** is the screen reader. It is not installed here, and outside GNOME it
needs the accessibility bus turned on explicitly. In your NixOS configuration:

```nix
environment.systemPackages = with pkgs; [ orca ];
services.gnome.at-spi2-core.enable = true;   # the AT-SPI bus Orca talks over
```

Speech needs a voice: `speechd` is already present (`spd-say` exists), but a
synthesiser with Japanese coverage does not come with it. `espeak-ng` speaks
Japanese intelligibly enough for testing; `open-jtalk` sounds far better if you
want to judge how the prose actually lands.

Then, per session:

```sh
orca &            # F1 opens preferences; pick the speech synthesiser + voice
```

Firefox is the better pairing on Linux (Chromium's Linux accessibility is
weaker). Firefox enables its accessibility engine on demand; if Orca sees
nothing, check `accessibility.force_disabled` is `0` in `about:config`.

Orca keys worth knowing (default "laptop" layout uses Caps Lock as the Orca
modifier):

| Key | What it does |
| --- | --- |
| `Orca + Space` | preferences |
| `Tab` / `Shift+Tab` | next/previous focusable — the tour `just a11y-tab` prints |
| `H` / `Shift+H` | next/previous heading |
| `1`–`6` | next heading at that level |
| `L` | next list · `I` next list item |
| `K` | next link |
| `M` | next landmark ← **the one to try first here** |
| `Orca + Ctrl + Space` | list all landmarks / headings / links |

### Cross-checking on other platforms

Screen readers differ enough that passing in one proves little. In rough order of
real-world usage:

| Platform | Reader | Browser | Notes |
| --- | --- | --- | --- |
| Windows | **NVDA** (free) | Firefox | the reference pairing; test here if you test anywhere |
| Windows | JAWS | Chrome | commercial, the enterprise default |
| macOS | **VoiceOver** (built in, `Cmd+F5`) | Safari | rotor: `VO+U` |
| iOS | VoiceOver | Safari | Settings → Accessibility; the mobile reality check |
| Android | TalkBack | Chrome | |

For a Japanese-language site, test with a **Japanese voice** — the pronunciation
of mixed Japanese/English/code text is a real part of the experience, and it is
why this site's UI labels (`テーマ切替`, `本文へスキップ`, `目次`) are Japanese:
the page is `lang="ja"`, so a Japanese TTS voice reads English labels with
Japanese phonetics.

### A concrete script for this site

Load the home page with your eyes closed (or the monitor off) and confirm each:

1. **Landing.** The title announces as `Toybeam`, not `Toybeam - Toybeam`.
2. **Skip link.** One Tab, then Enter. You should land in `main`, past the whole
   nav. Confirm the next Tab is a content link, not another nav link.
3. **Landmarks.** Pull up the landmark list (`M` in Orca, rotor in VoiceOver).
   You should get banner / `サイトナビゲーション` / main / `目次` / contentinfo —
   each one named, no two identical.
4. **Tag list.** It should announce as a list with a count, and you should be
   able to jump out of it in one keystroke rather than 17.
5. **Article list.** Same: a list of N items, each card one item, each with a
   title link, a date and its tags.
6. **An article** (a code-heavy one such as `2024-07-07-nix-flakes.html`):
   - headings step 1 → 2 → 3 with no gaps;
   - every heading announces something (`S_3`, not silence);
   - a long code block can be reached and scrolled with the arrow keys;
   - `<details>` blocks announce collapsed/expanded and toggle with Enter.
7. **Theme toggle.** Announces `テーマ切替`, as a button.
8. **Disco toggle.** Announces its pressed state, and that state changes when you
   activate it.

## Known remaining issues

Both are authored content, not build bugs, so they are left for the author.

### `nested-interactive`

`nested-interactive` — a `#+BEGIN_DETAILS` whose summary contains a link, e.g.

```org
#+BEGIN_DETAILS [[https://atcoder.jp/contests/arc177/tasks/arc177_a][A 問題]]
```

`<summary>` is itself a control, so a link inside it is a control nested in a
control: the keyboard gets two stops that do different things in the same place,
and screen readers disagree about what to announce. It is authored content, not a
build bug, so it is left alone. The fix is to move the link into the body:

```org
#+BEGIN_DETAILS A 問題
[[https://atcoder.jp/contests/arc177/tasks/arc177_a][問題ページ]]
...
#+END_DETAILS
```

Affected: `src/diary/2024-05-19.org`, `src/2024-07-07-nix-flakes.org`.

### `heading-order`

Three articles jump a heading level (an org `*` headline followed by `***`, so
`<h2>` then `<h4>`). A screen reader user navigating by heading reads that as a
missing section — the outline says there is a level-3 heading somewhere they
skipped. Promote the deeper headline by one `*`.

Affected: `src/2026-06-17-blog-improvements-9.org`, `src/diary/2024-02-25.org`,
`src/diary/2024-06-30.org`. Re-find them any time with `just a11y --all`.
