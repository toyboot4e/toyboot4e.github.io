import { defineConfig } from "vite";
import { generateScopedName, jsxOxc } from "./config-shared.ts";

export default defineConfig({
  css: { modules: { generateScopedName } },
  oxc: jsxOxc,
});
