import { defineConfig } from "vitest/config";
import { generateScopedName, jsxOxc } from "./config-shared.ts";

// `css.modules.classNameStrategy:'scoped'` makes vitest run the real
// `generateScopedName` (its default 'stable' ignores it and emits `_name_hash`),
// so the goldens carry the shipped scoped names. `__source`/`__self` debug attrs
// (which vitest forces on regardless of jsxOxc) are dropped in html.ts.
export default defineConfig({
  css: { modules: { generateScopedName } },
  oxc: jsxOxc,
  test: {
    // process every CSS module (vitest stubs them to `{}` by default) and scope
    // via the real `generateScopedName` ('scoped'), so test class names == shipped.
    css: { include: [/.*/u], modules: { classNameStrategy: "scoped" } },
    include: ["test/**/*.test.ts"],
  },
});
