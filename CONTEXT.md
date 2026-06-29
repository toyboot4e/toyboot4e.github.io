# Toybeam Devlog

A static, hermetic, JS-light Japanese technical devlog generated from Org Mode.
This glossary fixes the language for site features so design discussions stay precise.

## Language

**Disco Ball**:
The signature animated background effect on **every page** (site-wide), shown in
both themes (the effective theme selects the palette). A large, slowly
auto-rotating **faceted** mirror sphere is the visual hero: on dark it glows
against a black room and throws a **cast glint-field**; on light it reads as
reflective chrome over the bright page. Rainbow **spotlights** sweep in from the
top-left in both themes, and the light theme adds two rotating rainbow
light-rings. Decorative; sits behind content and never blocks reading. Runs by
default, GPU-gated, with a persisted on/off toggle.
_Avoid_: "mirror ball", "chrome orb" (it is faceted, not smooth), "background
animation" (too generic).

**Cast glint-field**:
The field of soft drifting light specks the **Disco Ball**'s facets throw across
the page — the "background" half of the effect. Composed to stay in the margins
and title area, faint over the **reading column**.

**Hero (of an effect)**:
The single element a visual effect is built around and that the eye lands on
first. For the **Disco Ball**, the hero is the sphere itself — not the scattered
light it casts.

**Reading column**:
The centre column of the homepage `main` grid (the ~50rem content column that
holds the title, tag list, and article cards). The **Disco Ball** is composed so
its brightness stays in the side margins and title area, keeping the reading
column dark enough to read over without any per-card backdrop.

**Has-flag**:
A build-time predicate in `headHtml` (`builder/src/render.tsx`, e.g. `hasCode`,
`hasMath`) that decides whether a page ships a given JS/CSS payload, so pages pay
only for what they use. (The **Disco Ball** is the exception — it ships site-wide
on every page, not behind a has-flag.)

## Language — code rendering

**Bake**:
The build-time pass that fills the render's placeholders with finished output —
**semantic highlighting**, KaTeX math, and **link cards** — in one in-process
step (`builder/src/bake.ts`), stamping a `<!--pp-->` sentinel that marks a page
baked. "Render" produces the page skeleton; "bake" fills in everything that needs
the highlighter or the link-card cache.
_Avoid_: "post-process", "format step" (it is in-process, not a separate run);
"compile".

**`.hl` palette**:
The syntax-highlighting colour system: a set of CSS variables (`--c-kw`,
`--c-str`, …) defined on `.hl` in `style.css` and rebound per theme. As with the
**Disco Ball**, the effective theme selects the palette — **sonokai** on dark,
**One Light** on light (both separate function/type/namespace hues, unlike
okaidia). Restyle all code by swapping the two `.hl` blocks.
_Avoid_: "the theme" (the palette is one part of a theme); "okaidia" (it is
sonokai).

**Colour bucket** (or just **bucket**):
One of the ~11 semantic colour classes a highlighted token can carry — `hl-kw`
keyword, `hl-str` string, `hl-fn` function, `hl-ty` type, `hl-com` comment, plus
`hl-num` `hl-con` `hl-tag` `hl-vbi` `hl-rex` `hl-esc`. Many grammar capture names
collapse into each bucket (via `CLASS_TABLE`); a token with no bucket renders as
default foreground. Buckets — not raw capture names — are our unit of colour.
_Avoid_: "token type", "scope" (those belong to the grammar; a bucket is ours).

**Semantic highlighting**:
The property that a token's colour reflects its *role*, not just its spelling — a
bound local stays plain while a function name is coloured — produced at **bake**
time by tree-sitter's `locals`/`injections` queries (the official
tree-sitter-highlight algorithm). The point of contrast with the old
keyword-regex highlighter (Prism).

**diff-`<lang>`**:
A code block written as a unified diff (leading `+`/`-` column) whose body is
highlighted as `<lang>` — e.g. `diff-hs` colours added/removed Haskell with the
gutter tinted. `diff` alone diffs plain text. The inner `<lang>` must be a known
grammar (or alias), same as a normal block.

**Link card**:
The block-level rich preview a bare `[[card:URL]]` link renders as (replacing the
link, not inline). Two kinds chosen by URL — an **OGP card** or a **GitHub code
embed**. Metadata is fetched ahead of time into a committed cache (the build is
offline), so a URL missing from the cache degrades to a plain link.

**OGP card**:
The **link card** kind for a generic page — title / description / image / favicon
read from the page's Open Graph tags.

**GitHub code embed**:
The **link card** kind for a GitHub blob permalink *with a line range*: it embeds
the actual source lines (**semantic highlighting**, **`.hl` palette**) with a
line-number gutter starting at the real source line. Without a line range it
falls back to an **OGP card**.

**Coderef**:
An org `(ref:label)` callout inside a code block — the line becomes a
self-linking anchor and the label is wrapped so prose `[[(label)]]` jumps to it.
Survives **diff-`<lang>`** (offsets shift to account for the `+`/`-` column).
