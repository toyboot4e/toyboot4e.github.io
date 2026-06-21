// Tiny JSX runtime that produces HTML strings (no DOM, no React) for the build's
// page templating. Configured via tsconfig (`jsxFactory: "h"`,
// `jsxFragmentFactory: "Fragment"`), so `.tsx` templating compiles to `h(...)`
// calls.
//
// Escaping model (like React): text children/attribute values are HTML-escaped;
// already-rendered HTML (org body, KaTeX, nested component output) is opaque --
// every `h(...)` returns a `Raw`, and `raw(s)` wraps a pre-rendered string so it
// passes through unescaped. A bare string child is treated as text and escaped.

export type Raw = { __html: string };
export const Fragment = Symbol("Fragment");

const isRaw = (x: unknown): x is Raw =>
  typeof x === "object" && x !== null && "__html" in (x as any);

export const raw = (s: string): Raw => ({ __html: s });

// One escaper for both text and attributes (matches the prior templating, which
// used a single esc covering & < > ").
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// HTML void elements -> self-closing (`<meta .../>`), matching the prior output.
const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function renderChildren(children: any[]): string {
  let out = "";
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    out += isRaw(c) ? c.__html : esc(String(c));
  }
  return out;
}

function renderAttrs(props: Record<string, any> | null): string {
  if (!props) return "";
  let out = "";
  for (const [k, v] of Object.entries(props)) {
    if (k === "children" || v == null || v === false) continue;
    if (v === true) out += ` ${k}`;
    else out += ` ${k}="${esc(String(v))}"`;
  }
  return out;
}

export function h(tag: any, props: Record<string, any> | null, ...children: any[]): Raw {
  // children may also arrive via props.children (automatic-runtime-style usage)
  const kids = children.length ? children : props?.children != null ? [props.children] : [];
  if (tag === Fragment) return raw(renderChildren(kids));
  if (typeof tag === "function") return tag(props ? { ...props, children: kids } : { children: kids });
  const inner = renderChildren(kids);
  if (VOID.has(tag) && !inner) return raw(`<${tag}${renderAttrs(props)}/>`);
  return raw(`<${tag}${renderAttrs(props)}>${inner}</${tag}>`);
}

// Final stringify of a top-level node (or raw passthrough).
export const render = (node: Raw | string): string => (isRaw(node) ? node.__html : node);
