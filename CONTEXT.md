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
A build-time predicate in `build.el` (e.g. `has-code`, `has-math`, `has-steno`)
that decides whether a page ships a given JS/CSS payload. New effects follow this
gate so pages pay only for what they use. The **Disco Ball** ships under a new
`has-disco` flag.
