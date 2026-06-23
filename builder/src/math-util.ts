// KaTeX's fonts (KaTeX_AMS, like LaTeX's amssymb) only contain UPPERCASE
// blackboard-bold glyphs, so KaTeX silently demotes `\mathbb{n}` to italic and
// `\mathbb{1}` to a plain digit. To support lowercase + digits, rewrite those
// `\mathbb{...}` args to the actual Unicode double-struck code points; KaTeX emits
// them as plain symbols (it has no glyph), so the browser's own math/Unicode font
// draws them -- we ship no font (a shipped blackboard font didn't match KaTeX's
// style). Uppercase is left as `\mathbb{X}` so it keeps KaTeX_AMS's glyphs.
const dsLower = (c: string) => String.fromCodePoint(0x1d552 + c.charCodeAt(0) - 0x61); // a-z -> 𝕒-𝕫
const dsDigit = (c: string) => String.fromCodePoint(0x1d7d8 + c.charCodeAt(0) - 0x30); // 0-9 -> 𝟘-𝟡

export function expandMathbb(tex: string): string {
  return tex.replace(/\\mathbb\s*\{([A-Za-z0-9]+)\}/g, (_m, body: string) =>
    [...body]
      .map((c) =>
        c >= "a" && c <= "z" ? dsLower(c) : c >= "0" && c <= "9" ? dsDigit(c) : `\\mathbb{${c}}`,
      )
      .join(""),
  );
}
