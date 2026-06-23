// Bundle the build itself to plain JS in dist/ (run with `bun dist/main.js`), so
// the build no longer boots vite-node per process -- that Vite-dev-server startup
// (~244ms) was the main perf tax. `vite build` runs ONCE (~180ms), resolving the
// `.module.css` imports to their scoped maps at build time; the heavy node deps
// (uniorg/prism/katex/happy-dom/linkedom) are externalized and load natively at
// runtime. The Justfile's staleness guard skips even this 180ms when nothing
// changed. Shares the scoped-name + JSX config with the render/test paths.
import { defineConfig } from "vite";
import { builtinModules } from "node:module";
import { generateScopedName, jsxEsbuild } from "./config-shared.ts";

export default defineConfig({
  css: { modules: { generateScopedName } },
  esbuild: jsxEsbuild,
  build: {
    ssr: true,
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    target: "node20",
    lib: {
      entry: { main: "src/main.ts", "render-shard": "src/render-shard.ts" },
      formats: ["es"],
    },
    rollupOptions: {
      // externalize every bare specifier (node builtins + npm deps); only our
      // own relative modules + the resolved .module.css maps get bundled.
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`), /^[a-z@]/],
    },
  },
});
