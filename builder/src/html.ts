// Tiny JSX runtime that produces HTML strings (no DOM, no React) for the build's
// page templating. Configured via tsconfig (`jsxFactory: "h"`,
// `jsxFragmentFactory: "Fragment"`), so `.tsx` templating compiles to `h(...)`
// calls.
//
// Escaping model (like React): text children/attribute values are HTML-escaped;
// already-rendered HTML (org body, KaTeX, nested component output) is opaque --
// every `h(...)` returns a `Raw`, and `raw(s)` wraps a pre-rendered string so it
// passes through unescaped. A bare string child is treated as text and escaped.

export type Raw = { readonly __html: string };
export type Child = Raw | string | number | boolean | null | undefined | readonly Child[];
type AttrValue = string | number | boolean | null | undefined;
type Props = Readonly<Record<string, unknown>>;
type Component = (props: Props) => Raw;

const isRaw = (x: unknown): x is Raw => typeof x === "object" && x !== null && "__html" in x;

export const raw = (s: string): Raw => ({ __html: s });

// One escaper for both text and attributes (matches the prior templating, which
// used a single esc covering & < > ").
const esc = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

// HTML void elements -> self-closing (`<meta .../>`), matching the prior output.
// The always-empty SVG leaf elements (used in the inline nav/footer icons) are
// included so JSX serialises them self-closed (`<path .../>`) too.
// oxfmt-ignore
const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
  "path", "circle", "rect", "line", "polyline", "polygon", "ellipse",
]);

// Array.isArray doesn't narrow a readonly array out of a union.
const isList = (c: Child): c is readonly Child[] => Array.isArray(c);

const renderChildren = (children: readonly Child[]): string => {
  let out = "";
  for (const c of children) {
    if (isList(c)) {
      out += renderChildren(c);
    } else if (isRaw(c)) {
      out += c.__html;
    } else if (typeof c === "string") {
      out += esc(c);
    } else if (typeof c === "number") {
      out += String(c);
    }
  }
  return out;
};

export const Fragment = ({ children }: { readonly children?: Child }): Raw =>
  raw(renderChildren(children === undefined ? [] : [children]));

// `__source` / `__self` are debug props the dev JSX transform injects; the
// build disables that (config-shared oxc jsx.development:false), but vitest forces it on,
// so drop them here too -- they must never reach the HTML.
const SKIP_PROP = new Set(["children", "__source", "__self"]);

const attrText = (k: string, v: unknown): string => {
  if (typeof v === "string") {
    return v;
  }
  if (typeof v === "number") {
    return String(v);
  }
  throw new TypeError(`html: attribute ${k} is not a string or number`);
};

const renderAttrs = (props: Props | null): string => {
  if (!props) {
    return "";
  }
  let out = "";
  for (const [k, v] of Object.entries(props)) {
    if (SKIP_PROP.has(k) || v === null || v === undefined || v === false) {
      continue;
    }
    out += v === true ? ` ${k}` : ` ${k}="${esc(attrText(k, v))}"`;
  }
  return out;
};

export function h(tag: string | Component, props: Props | null, ...children: Child[]): Raw {
  if (typeof tag === "function") {
    return tag({ ...props, children });
  }
  const inner = renderChildren(children);
  if (VOID.has(tag) && !inner) {
    return raw(`<${tag}${renderAttrs(props)}/>`);
  }
  return raw(`<${tag}${renderAttrs(props)}>${inner}</${tag}>`);
}

// Final stringify of a top-level node (or raw passthrough).
export const render = (node: Raw | string): string => (isRaw(node) ? node.__html : node);

declare global {
  namespace JSX {
    type Element = Raw;
    type ElementChildrenAttribute = { children: unknown };
    type IntrinsicElements = Record<string, Readonly<Record<string, AttrValue | Child>>>;
  }
}
