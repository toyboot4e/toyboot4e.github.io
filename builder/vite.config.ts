import { defineConfig } from "vite";
import { generateScopedName, jsxEsbuild } from "./config-shared.ts";

export default defineConfig({
  css: { modules: { generateScopedName } },
  esbuild: jsxEsbuild,
});
