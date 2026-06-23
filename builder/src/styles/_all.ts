// Aggregate entry for the CSS-module build (assets.ts): importing + referencing
// each map keeps Vite/rollup from tree-shaking the CSS away, so the scoped
// stylesheet is emitted. Not used at runtime.
import card from "./article-card.module.css";
import steno from "./steno.module.css";
import toc from "./toc.module.css";
export default Object.assign({}, card, steno, toc);
