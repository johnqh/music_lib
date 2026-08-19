/**
 * The drawing vocabulary the instrument icons are authored in: a tiny,
 * renderer-neutral shape list plus a parser for the path subset it allows.
 *
 * Two consumers draw the same art through different APIs — the canvas track
 * gutter (`stroke-icon.ts`) and the app's `<svg>` component — so the art itself
 * cannot be expressed in either one's terms. SVG path data is the natural
 * authoring format, but handing it to canvas would mean `Path2D`, which jsdom
 * does not implement; the gutter's drawing would then be untestable in the unit
 * suite. Parsing the subset ourselves keeps one authored source and keeps both
 * renderers testable.
 *
 * The subset is deliberately small: absolute `M`/`L`/`C`/`Q`/`Z` and explicit
 * circles. No arcs (their SVG parameterisation is endpoint-based and converting
 * it to canvas's centre-based `arc` is exactly the fiddly, bug-prone code this
 * design avoids) and no relative commands (an icon is authored once and read
 * many times; absolute coordinates stay readable). Anything else throws, so a
 * malformed icon fails in the test suite rather than drawing silently wrong.
 */

/** Icons are authored on a 24x24 grid, like most line-art sets. */
export const ICON_VIEWBOX = 24;

/**
 * Stroke width in viewbox units. Scales with the icon, so the weight stays
 * proportional at any size rather than going hairline when drawn small.
 */
export const ICON_STROKE_WIDTH = 1.6;

export type IconShape =
  | { readonly kind: 'path'; readonly d: string }
  | {
      readonly kind: 'circle';
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
    };

/** One instrument's line art. `name` is a stable id — useful in tests and debugging, never shown. */
export type InstrumentIconArt = {
  readonly name: string;
  readonly shapes: readonly IconShape[];
};

export type PathSegment =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'line'; x: number; y: number }
  | {
      kind: 'cubic';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      x: number;
      y: number;
    }
  | { kind: 'quad'; x1: number; y1: number; x: number; y: number }
  | { kind: 'close' };

const COMMAND_ARITY: Record<string, number> = { M: 2, L: 2, C: 6, Q: 4, Z: 0 };

/** Command letters and numbers; anything else in the string is ignored as separator. */
const TOKEN = /[A-Za-z]|-?\d*\.?\d+/g;

function segmentFor(command: string, n: readonly number[]): PathSegment {
  switch (command) {
    case 'M':
      return { kind: 'move', x: n[0], y: n[1] };
    case 'L':
      return { kind: 'line', x: n[0], y: n[1] };
    case 'C':
      return {
        kind: 'cubic',
        x1: n[0],
        y1: n[1],
        x2: n[2],
        y2: n[3],
        x: n[4],
        y: n[5],
      };
    default:
      return { kind: 'quad', x1: n[0], y1: n[1], x: n[2], y: n[3] };
  }
}

/**
 * Parses an authored path into segments any renderer can replay.
 *
 * Implements SVG's implicit-repetition rule (a command's operands may repeat
 * without restating the letter) and its companion rule that the pairs after an
 * `M` are line-tos, because both are how path data is normally written and an
 * author would reasonably expect them to work.
 */
export function parseIconPath(d: string): PathSegment[] {
  const tokens = d.match(TOKEN) ?? [];
  const segments: PathSegment[] = [];
  let command: string | null = null;
  let i = 0;

  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) {
      command = tokens[i];
      i += 1;
      if (!(command in COMMAND_ARITY)) {
        throw new Error(`Unsupported icon path command "${command}" in "${d}"`);
      }
    }
    if (command == null)
      throw new Error(`Icon path must start with a command: "${d}"`);

    const arity = COMMAND_ARITY[command];
    if (arity === 0) {
      segments.push({ kind: 'close' });
      // Nothing may follow a Z but another command, so drop back to
      // "expecting a letter" rather than repeating the close forever.
      command = null;
      continue;
    }

    const operands = tokens.slice(i, i + arity).map(Number);
    if (operands.length < arity || operands.some(Number.isNaN)) {
      throw new Error(
        `Icon path command "${command}" wants ${arity} numbers in "${d}"`
      );
    }
    i += arity;
    segments.push(segmentFor(command, operands));

    // SVG: the coordinate pairs following a moveto are implicit linetos.
    if (command === 'M') command = 'L';
  }

  return segments;
}
