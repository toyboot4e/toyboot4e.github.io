// Shared Vite settings used by both the build (vite.config.ts) and the tests
// (vitest.config.ts), so the render and the tests/CSS scope identically.

// Deterministic, hash-free scoped names so the render (vite-node) and the CSS
// build (assets.ts) produce identical class names: `article-card.module.css`
// class `articleCard` -> `article-card_articleCard`.
export const generateScopedName = (name: string, filename: string) => {
  const base = filename.split("/").pop()!.replace(/\.module\.css$/, "");
  return `${base}_${name}`;
};

// Classic JSX via the `h` runtime (src/html.ts). jsxDev:false stops esbuild's dev
// transform from injecting `__source`/`__self` debug attributes into every
// element (vite-node / vitest run in dev mode, where they're on by default).
export const jsxEsbuild = {
  jsx: "transform" as const,
  jsxFactory: "h",
  jsxFragment: "Fragment",
  jsxDev: false,
};
