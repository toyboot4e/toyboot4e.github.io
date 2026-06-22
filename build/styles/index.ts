// CSS-module barrel: build-assets.ts bundles this with `Bun.build`, which scopes
// the `.module.css` class names and emits both the scoped CSS (-> components.css,
// linked on the pages) and the class-name maps re-exported here. render.tsx
// imports the generated map (`build/styles/generated.js`) -- NOT this file
// directly, since `.module.css` only resolves through the bundler.
import card from "./article-card.module.css";
import steno from "./steno.module.css";
import toc from "./toc.module.css";

export { card, steno, toc };
