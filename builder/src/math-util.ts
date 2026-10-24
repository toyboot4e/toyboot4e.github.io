// KaTeX's fonts (KaTeX_AMS, like LaTeX's amssymb) only contain UPPERCASE
// blackboard-bold glyphs, so KaTeX silently demotes `\mathbb{n}` to italic and
// `\mathbb{1}` to a plain digit. To support lowercase + digits, rewrite those
// `\mathbb{...}` args to the actual Unicode double-struck code points; KaTeX emits
// them as plain symbols (it has no glyph), so the browser's own math/Unicode font
// draws them -- we ship no font (a shipped blackboard font didn't match KaTeX's
// style). Uppercase is left as `\mathbb{X}` so it keeps KaTeX_AMS's glyphs.
const DS_LOWER_A = 0x1_d5_52; // 𝕒
const DS_DIGIT_0 = 0x1_d7_d8; // 𝟘
const shift = (c: string, from: string, to: number): string =>
  String.fromCodePoint(to + (c.codePointAt(0) ?? 0) - (from.codePointAt(0) ?? 0));

const doubleStruck = (c: string): string => {
  if (c >= "a" && c <= "z") {
    return shift(c, "a", DS_LOWER_A);
  }
  if (c >= "0" && c <= "9") {
    return shift(c, "0", DS_DIGIT_0);
  }
  return `\\mathbb{${c}}`;
};

export function expandMathbb(tex: string): string {
  return tex.replaceAll(/\\mathbb\s*\{([A-Za-z0-9]+)\}/gu, (_m, body: string) =>
    Array.from(body, doubleStruck).join(""),
  );
}
