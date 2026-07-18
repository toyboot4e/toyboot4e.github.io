// Keyboard chart component: a named key layout + a "which keys are pressed"
// spec -> static chart HTML (inline-grid of key <div>s, pressed keys
// highlighted). Rendered at build time and consumed by render.tsx for both
// `#+BEGIN_STENO` (layout `uni-v4`, the steno chord chart formerly inlined
// there) and the general `#+BEGIN_KEYBOARD <layout>` block. Styling lives in
// styles/keyboard.module.css (scoped class names via the `kb` map).
//
// Two layout kinds: a uniform chars grid (`chars`, one cell per grid track:
// uni-v4, qwerty-24) and explicitly placed keys (`keys`, half-unit x offsets
// and per-key vertical drop on an 18px track grid: tiny-18).
import { h, render, type Raw } from "./html.ts";
import kb from "./styles/keyboard.module.css";

// --- uni-v4: The Uni v4 steno keyboard (3x12) -------------------------------
// A stroke like `KAT` or `-S` highlights the keys it presses, resolved in steno
// key order (this is the port of the old client-side steno-viz.js).
const UNI_CHARS = [
  ["#", "T", "P", "H", "*", "", "*", "F", "P", "L", "T", "D"],
  ["S", "K", "W", "R", "", "", "", "R", "B", "G", "S", "Z"],
  ["", "", "#", "A", "O", "", "E", "U", "#", "", "", ""],
];
// Steno key order (#STKPWHRAO*EUFRPBLGTSDZ) mapped to [row, col] in UNI_CHARS.
const UNI_ORDER: Array<[number, number]> = [
  [0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3],
  [2, 2], [2, 3], [2, 4], [0, 4], [2, 6], [2, 7], [2, 8], [0, 7],
  [1, 7], [0, 8], [1, 8], [0, 9], [1, 9], [0, 10], [1, 10], [0, 11], [1, 11],
];

// Which keys a single (already upper-cased) stroke presses -> 3x12 boolean grid.
function uniPressed(stroke: string): boolean[][] {
  const ret = [Array(12).fill(false), Array(12).fill(false), Array(12).fill(false)];
  if (stroke) {
    const iRhs = 12; // first right-hand entry in UNI_ORDER; `-` jumps here
    let iOrder = 0;
    for (const c of stroke) {
      if (iOrder >= UNI_ORDER.length) break;
      if (c === "-") {
        if (iOrder < iRhs) iOrder = iRhs;
        continue;
      }
      while (iOrder < UNI_ORDER.length) {
        const [row, col] = UNI_ORDER[iOrder++];
        if (c === UNI_CHARS[row][col]) {
          ret[row][col] = true;
          break;
        }
      }
    }
  }
  // `*` (two cells) and `#` (three cells) light together if any of them is hit.
  const star = ret[0][4] || ret[0][6];
  ret[0][4] = ret[0][6] = star;
  const hash = ret[0][0] || ret[2][2] || ret[2][8];
  ret[0][0] = ret[2][2] = ret[2][8] = hash;
  return ret;
}

// --- shared bits for the case-sensitive char-spec layouts -------------------
// One chart per non-empty line; an empty body still draws one blank chart
// (matching uni-v4, where an empty stroke shows the unpressed layout).
function lineSpecs(body: string): string[] {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines : [""];
}

// Case-sensitive key spec -> the set of pressed key chars (whitespace ignored;
// an unknown key is an authoring error and fails the build).
function charSpecPressed(layoutName: string, known: Set<string>, spec: string): Set<string> {
  const on = new Set<string>();
  for (const c of spec.replace(/\s/g, "")) {
    if (!known.has(c)) throw new Error(`keyboard ${layoutName}: unknown key ${JSON.stringify(c)} in ${JSON.stringify(spec)}`);
    on.add(c);
  }
  return on;
}

// pressed() for a placed layout whose spec chars are the key labels verbatim
function placedCharSpecPressed(layoutName: string, keys: PlacedKey[]): (spec: string) => boolean[] {
  return (spec) => {
    const on = charSpecPressed(layoutName, new Set(keys.map((k) => k.c)), spec);
    return keys.map((k) => on.has(k.c));
  };
}

const KeyIcon = ({ children }: { children?: any }): Raw => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{children}</svg>
);

// Lucide `space` / `corner-down-left` / `delete`
const SPACE_ICON: Raw = <KeyIcon><path d="M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1" /></KeyIcon>;
const ENTER_ICON: Raw = <KeyIcon><path d="M20 4v7a4 4 0 0 1-4 4H4" /><path d="m9 10-5 5 5 5" /></KeyIcon>;
const BACKSPACE_ICON: Raw = <KeyIcon><path d="M10 5a2 2 0 0 0-1.344.519l-6.328 5.74a1 1 0 0 0 0 1.481l6.328 5.741A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" /><path d="m12 9 6 6" /><path d="m18 9-6 6" /></KeyIcon>;
const SHIFT_ICON: Raw = <KeyIcon><path d="M9 19a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-6a1 1 0 0 1 1-1h3.293a.707.707 0 0 0 .5-1.207l-7.086-7.086a1 1 0 0 0-1.414 0l-7.086 7.086a.707.707 0 0 0 .5 1.207H8a1 1 0 0 1 1 1z" /></KeyIcon>;
const SPACE_KEY = { name: "Space", label: SPACE_ICON };
const ENTER_KEY = { name: "Enter", label: ENTER_ICON };

// --- qwerty-24: two qwerty rows + four thumb keys ---------------------------
// 5|5 split (spacer column between t/y); thumb row under r/t + y/u:
//   q w e r t  y u i o p
//   z x c v b  n m , . /
//         A S  J E
// A/S/J/E are Alphabet / Space / Japanese / Enter. The IME keys show macOS
// input-source style text labels ("A" / "あ" -- no kana glyph exists in
// Lucide); Space and Enter are Lucide icons (same inline-SVG convention as the
// nav icons: currentColor, 1em, stroked). Key spec is case-sensitive:
// lowercase = letter keys, uppercase = thumb keys (the layout has both `e` and
// Enter).
const QWERTY24_CHARS = [
  ["q", "w", "e", "r", "t", "", "y", "u", "i", "o", "p"],
  ["z", "x", "c", "v", "b", "", "n", "m", ",", ".", "/"],
  ["", "", "", "A", "S", "", "J", "E", "", "", ""],
];

// Thumb keys: label (a text label or a Lucide icon) + accessible name.
const QWERTY24_THUMBS: Record<string, { label: Raw | string; name: string }> = {
  A: { name: "Alphabet", label: "A" },
  S: SPACE_KEY,
  J: { name: "Japanese", label: "あ" },
  E: ENTER_KEY,
};

// pressed() for a chars-grid layout whose spec chars are the key labels verbatim
function gridCharSpecPressed(layoutName: string, chars: string[][]): (spec: string) => boolean[][] {
  const known = new Set(chars.flat().filter(Boolean));
  return (spec) => {
    const on = charSpecPressed(layoutName, known, spec);
    return chars.map((row) => row.map((c) => c !== "" && on.has(c)));
  };
}

// --- tiny-18: k3peta's Tiny 18, default layer -------------------------------
// https://github.com/k3peta/zmk-config-tiny18 -- 3+3 / 4+4 / 2+2 columnar
// split. Positions are the repo's config/tiny18.json (`x` in key units;
// half-unit stagger on the bottom row, outer pinky keys dropped 0.75u, as in
// its keymap-drawer chart):
//      w e r        u i o
//   a  s d t        h k l  ⏎
//         z g      n m
// Key spec: the 17 letters + uppercase E = Enter (case-sensitive, same
// convention as qwerty-24).
// `w`/`h` span multiple key units / rows (default 1); `id` names a key for
// order-based parsing when the display char is ambiguous (steno S-/-S etc.).
type PlacedKey = { c: string; row: number; x: number; w?: number; h?: number; drop?: boolean; id?: string };
const TINY18_KEYS: PlacedKey[] = [
  { c: "w", row: 0, x: 1 }, { c: "e", row: 0, x: 2 }, { c: "r", row: 0, x: 3 },
  { c: "u", row: 0, x: 7 }, { c: "i", row: 0, x: 8 }, { c: "o", row: 0, x: 9 },
  { c: "a", row: 1, x: 0, drop: true },
  { c: "s", row: 1, x: 1 }, { c: "d", row: 1, x: 2 }, { c: "t", row: 1, x: 3 },
  { c: "h", row: 1, x: 7 }, { c: "k", row: 1, x: 8 }, { c: "l", row: 1, x: 9 },
  { c: "E", row: 1, x: 10, drop: true },
  { c: "z", row: 2, x: 2.5 }, { c: "g", row: 2, x: 3.5 },
  { c: "n", row: 2, x: 6.5 }, { c: "m", row: 2, x: 7.5 },
];

// --- leversteno: Nolltronics Leversteno (stenotype layout) ------------------
// https://nollelectronics.com/products/leversteno -- the traditional stenotype
// arrangement: a one-piece number bar across the top, split key banks (0.5u
// center gap), a tall `*` on each side of the gap, and the A O / E U vowel
// pairs flanking the center:
//   ###########
//   S T P H *  * F P L T D
//   S K W R *  * R B G S Z
//         A O  E U
// A stroke (uni-v4 notation, e.g. `KAT` or `KAT/-S`) highlights keys in steno
// order; `#`, `*` and the doubled left `S` each light as one unit.
const LEVER_KEYS: PlacedKey[] = [
  { c: "#", id: "#", row: 0, x: 0, w: 11.5 },
  { c: "S", id: "S1", row: 1, x: 0 }, { c: "T", id: "T-", row: 1, x: 1 },
  { c: "P", id: "P-", row: 1, x: 2 }, { c: "H", id: "H-", row: 1, x: 3 },
  { c: "*", id: "*L", row: 1, x: 4, h: 2 },
  { c: "*", id: "*R", row: 1, x: 5.5, h: 2 },
  { c: "F", id: "-F", row: 1, x: 6.5 }, { c: "P", id: "-P", row: 1, x: 7.5 },
  { c: "L", id: "-L", row: 1, x: 8.5 }, { c: "T", id: "-T", row: 1, x: 9.5 },
  { c: "D", id: "-D", row: 1, x: 10.5 },
  { c: "S", id: "S2", row: 2, x: 0 }, { c: "K", id: "K-", row: 2, x: 1 },
  { c: "W", id: "W-", row: 2, x: 2 }, { c: "R", id: "R-", row: 2, x: 3 },
  { c: "R", id: "-R", row: 2, x: 6.5 }, { c: "B", id: "-B", row: 2, x: 7.5 },
  { c: "G", id: "-G", row: 2, x: 8.5 }, { c: "S", id: "-S", row: 2, x: 9.5 },
  { c: "Z", id: "-Z", row: 2, x: 10.5 },
  { c: "A", id: "A", row: 3, x: 3 }, { c: "O", id: "O", row: 3, x: 4 },
  { c: "E", id: "E", row: 3, x: 5.5 }, { c: "U", id: "U", row: 3, x: 6.5 },
];

// Steno key order (#STKPWHRAO*EUFRPBLGTSDZ) -> the key ids each stroke char
// lights (multi-cell # / * / S light together, like uni-v4's merged cells).
const LEVER_ORDER: Array<[string, string[]]> = [
  ["#", ["#"]], ["S", ["S1", "S2"]], ["T", ["T-"]], ["K", ["K-"]], ["P", ["P-"]],
  ["W", ["W-"]], ["H", ["H-"]], ["R", ["R-"]], ["A", ["A"]], ["O", ["O"]],
  ["*", ["*L", "*R"]], ["E", ["E"]], ["U", ["U"]], ["F", ["-F"]], ["R", ["-R"]],
  ["P", ["-P"]], ["B", ["-B"]], ["L", ["-L"]], ["G", ["-G"]], ["T", ["-T"]],
  ["S", ["-S"]], ["D", ["-D"]], ["Z", ["-Z"]],
];
const LEVER_RHS = 11; // the E entry in LEVER_ORDER; `-` jumps here (as in uni-v4)
const LEVER_INDEX = new Map(LEVER_KEYS.map((k, i) => [k.id, i]));

// Which keys a single (already upper-cased) stroke presses, in LEVER_KEYS order.
function leverPressed(stroke: string): boolean[] {
  const ret = Array(LEVER_KEYS.length).fill(false);
  let iOrder = 0;
  for (const ch of stroke) {
    if (iOrder >= LEVER_ORDER.length) break;
    if (ch === "-") {
      if (iOrder < LEVER_RHS) iOrder = LEVER_RHS;
      continue;
    }
    while (iOrder < LEVER_ORDER.length) {
      const [c, ids] = LEVER_ORDER[iOrder++];
      if (c === ch) {
        for (const id of ids) ret[LEVER_INDEX.get(id)!] = true;
        break;
      }
    }
  }
  return ret;
}

// --- taipo: NotGate's Taipo chording system (one hand) ----------------------
// https://inkeys.wiki/en/keymaps/taipo -- two full mirrored 10-key halves; all
// documentation is written from the right hand's perspective, so that's the
// hand drawn here: a 2x4 block (keys labeled with their single-press letters)
// plus the two thumb keys below the index side. Pressed alone the inner thumb
// is Space and the outer is Backspace; in chords they select the extra layers.
//   i n s r
//   e t o a
//  O I          (O = outer thumb, I = inner thumb; inner sits closer to palm)
// Key spec: the 8 letters + uppercase I/O for the thumbs (case-sensitive; the
// layout has both `i`/`o` and I/O), e.g. `in` (chord y) or `inI`.
const TAIPO_KEYS: PlacedKey[] = [
  { c: "i", row: 0, x: 1 }, { c: "n", row: 0, x: 2 }, { c: "s", row: 0, x: 3 }, { c: "r", row: 0, x: 4 },
  { c: "e", row: 1, x: 1 }, { c: "t", row: 1, x: 2 }, { c: "o", row: 1, x: 3 }, { c: "a", row: 1, x: 4 },
  { c: "O", row: 2, x: 0.5 }, { c: "I", row: 2, x: 1.5 },
];
const TAIPO_THUMBS: Record<string, KeyMeta> = {
  I: { name: "Inner thumb (Space)", label: SPACE_ICON },
  O: { name: "Outer thumb (Backspace)", label: BACKSPACE_ICON },
};

// --- piano: Ben Vallack's Piano layout --------------------------------------
// Same physical shape as tiny-18 (columnar 3+3 / 4+4 with dropped outer pinky
// keys), but the four thumb keys merge pairwise into two 2u-wide keys: Space
// on the left, the α layer key on the right.
//      l g d        h u o
//   i  s r t        n e a  c
//        [ S ]    [ α ]
// Key spec: the 14 letters + uppercase S = Space and A = α (case-sensitive;
// the layout has both `s`/`a` and S/A), e.g. `lsS`.
const PIANO_KEYS: PlacedKey[] = [
  { c: "l", row: 0, x: 1 }, { c: "g", row: 0, x: 2 }, { c: "d", row: 0, x: 3 },
  { c: "h", row: 0, x: 7 }, { c: "u", row: 0, x: 8 }, { c: "o", row: 0, x: 9 },
  { c: "i", row: 1, x: 0, drop: true },
  { c: "s", row: 1, x: 1 }, { c: "r", row: 1, x: 2 }, { c: "t", row: 1, x: 3 },
  { c: "n", row: 1, x: 7 }, { c: "e", row: 1, x: 8 }, { c: "a", row: 1, x: 9 },
  { c: "c", row: 1, x: 10, drop: true },
  { c: "S", row: 2, x: 2.5, w: 2 },
  { c: "A", row: 2, x: 6.5, w: 2 },
];
const PIANO_THUMBS: Record<string, KeyMeta> = {
  S: SPACE_KEY,
  A: { name: "α", label: "α" },
};

// --- asetniop: ten-key chording (https://asetniop.com) ----------------------
// The eight home keys (each finger's most common QWERTY letter) split 4|4,
// plus the two thumb keys: Shift on the left thumb, Space on the right (as in
// the tablet app), drawn 2u wide under the inner columns.
//   a s e t  n i o p
//       ⇧     ␣
// Key spec: the 8 letters + `^` = Shift and uppercase `S` = Space
// (case-sensitive: `s` is the home key), e.g. `et` (a chord) or `a^` (A).
const ASETNIOP_KEYS: PlacedKey[] = [
  { c: "a", row: 0, x: 0 }, { c: "s", row: 0, x: 1 }, { c: "e", row: 0, x: 2 }, { c: "t", row: 0, x: 3 },
  { c: "n", row: 0, x: 4.5 }, { c: "i", row: 0, x: 5.5 }, { c: "o", row: 0, x: 6.5 }, { c: "p", row: 0, x: 7.5 },
  { c: "^", row: 1, x: 2, w: 2 },
  { c: "S", row: 1, x: 4.5, w: 2 },
];
const ASETNIOP_THUMBS: Record<string, KeyMeta> = {
  "^": { name: "Shift", label: SHIFT_ICON },
  S: SPACE_KEY,
};

// --- artsey: one-handed 8-key system (https://artsey.io) --------------------
// The right-handed variant (the one that spells the name; the left-handed one
// is its mirror). Letters only -- everything else is combos, so the chart is a
// plain 2x4 grid. Key spec: the 8 lowercase letters, e.g. `ars`. (ardux, the
// community fork, shares this exact base grid -- use `artsey` for it too.)
const ARTSEY_CHARS = [
  ["a", "r", "t", "s"],
  ["e", "y", "i", "o"],
];

// --- shared chart rendering -------------------------------------------------
type KeyMeta = { label: Raw | string; name: string };
type LayoutBase = {
  gridClass: string;        // scoped grid-template class for this layout
  // block body -> one pressed-key spec per chart
  specs(body: string): string[];
  // per-key overrides: extra class / rendered label + accessible name
  keyClass?(c: string): string | undefined;
  keyLabel?(c: string): KeyMeta | undefined;
};
// uniform grid: one chars cell per grid track ("" = empty cell)
type GridLayout = LayoutBase & { chars: string[][]; pressed(spec: string): boolean[][] };
// explicit placement on half-unit tracks; pressed is parallel to `keys`
type PlacedLayout = LayoutBase & { keys: PlacedKey[]; pressed(spec: string): boolean[] };
type Layout = GridLayout | PlacedLayout;

const LAYOUTS: Record<string, Layout> = {
  "uni-v4": {
    chars: UNI_CHARS,
    gridClass: kb.strokeUni,
    // `/`-separated strokes (e.g. `KAT/-S`), one chart per stroke.
    specs: (body) => body.trim().toUpperCase().split("/"),
    pressed: uniPressed,
    keyClass: (c) => (c === "*" ? kb.keyFat : undefined),
  },
  "qwerty-24": {
    chars: QWERTY24_CHARS,
    gridClass: kb.strokeQwerty24,
    specs: lineSpecs,
    pressed: gridCharSpecPressed("qwerty-24", QWERTY24_CHARS),
    keyLabel: (c) => QWERTY24_THUMBS[c],
  },
  "tiny-18": {
    keys: TINY18_KEYS,
    gridClass: kb.strokeTiny18,
    specs: lineSpecs,
    pressed: placedCharSpecPressed("tiny-18", TINY18_KEYS),
    keyLabel: (c) => (c === "E" ? ENTER_KEY : undefined),
  },
  "piano": {
    keys: PIANO_KEYS,
    gridClass: kb.strokeTiny18, // same geometry/grid as tiny-18
    specs: lineSpecs,
    pressed: placedCharSpecPressed("piano", PIANO_KEYS),
    keyLabel: (c) => PIANO_THUMBS[c],
  },
  "taipo": {
    keys: TAIPO_KEYS,
    gridClass: kb.strokeTaipo,
    specs: lineSpecs,
    pressed: placedCharSpecPressed("taipo", TAIPO_KEYS),
    keyLabel: (c) => TAIPO_THUMBS[c],
  },
  "asetniop": {
    keys: ASETNIOP_KEYS,
    gridClass: kb.strokeAsetniop,
    specs: lineSpecs,
    pressed: placedCharSpecPressed("asetniop", ASETNIOP_KEYS),
    keyLabel: (c) => ASETNIOP_THUMBS[c],
  },
  "artsey": {
    chars: ARTSEY_CHARS,
    gridClass: kb.strokeArtsey,
    specs: lineSpecs,
    pressed: gridCharSpecPressed("artsey", ARTSEY_CHARS),
  },
  "leversteno": {
    keys: LEVER_KEYS,
    gridClass: kb.strokeLever,
    // uni-v4 stroke notation: `/`-separated strokes, one chart per stroke.
    specs: (body) => body.trim().toUpperCase().split("/"),
    pressed: leverPressed,
  },
};

// One key -> its <div> (label text or icon, pressed highlight, extra classes).
function keyDiv(layout: Layout, c: string, on: boolean, extraCls: (string | false | undefined)[], style?: string): Raw {
  const meta = layout.keyLabel?.(c);
  const isIcon = meta && typeof meta.label !== "string";
  const cls = [kb.key, layout.keyClass?.(c), isIcon && kb.keyIcon, ...extraCls, on && kb.keyPressed]
    .filter(Boolean).join(" ");
  return meta
    ? <div class={cls} style={style} title={meta.name} aria-label={meta.name}>{meta.label}</div>
    : <div class={cls} style={style}>{c}</div>;
}

// One spec -> its grid of <div> keys (an HTML string with scoped class names).
function strokeHtml(layout: Layout, spec: string): string {
  const cells: Raw[] = [];
  if ("chars" in layout) {
    const pressed = layout.pressed(spec);
    for (let row = 0; row < layout.chars.length; row++) {
      for (let col = 0; col < layout.chars[row].length; col++) {
        const c = layout.chars[row][col];
        if (c === "") cells.push(<div class={kb.cell}></div>);
        else cells.push(keyDiv(layout, c, pressed[row][col], []));
      }
    }
  } else {
    const on = layout.pressed(spec);
    layout.keys.forEach((k, i) => {
      // 18px half-unit tracks: key unit x -> track x*2+1, one unit = 2 tracks
      const style = `grid-row:${k.row + 1}${k.h ? `/span ${k.h}` : ""};`
        + `grid-column:${k.x * 2 + 1}/span ${(k.w ?? 1) * 2}`;
      cells.push(keyDiv(layout, k.c, on[i], [kb.keyPlaced, k.drop && kb.keyDrop], style));
    });
  }
  return render(<div class={`${kb.stroke} ${layout.gridClass}`}>{cells}</div>);
}

// The block body -> chart HTML strings, one per stroke/line. Throws on an
// unknown layout or key: an authoring error should fail the build loudly.
export function keyboardStrokesHtml(layoutName: string, body: string): string[] {
  const layout = LAYOUTS[layoutName];
  if (!layout) {
    throw new Error(
      `unknown keyboard layout ${JSON.stringify(layoutName)} (known: ${Object.keys(LAYOUTS).join(", ")})`,
    );
  }
  return layout.specs(body).map((s) => strokeHtml(layout, s));
}
