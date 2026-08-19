/**
 * Where a drum sits on the staff, and what its notehead looks like.
 *
 * A percussion track's "pitch" is not a pitch — it is which drum was struck.
 * General MIDI puts the kick at 35/36 and the snare at 38, which as pitches
 * are B1 and D2: drawn literally they land six or seven ledger lines below a
 * treble staff, with stems long enough to reach into the next track's row.
 * That is what a drum part looked like here.
 *
 * Percussion notation answers a different question — not "how high is it" but
 * "which instrument is it" — so each drum gets a fixed line or space and, for
 * anything struck with a stick or shaken rather than hit like a drum, a cross
 * notehead. The positions below are the common drum-set convention: kick in
 * the bottom space, snare in the third space, hi-hat above the top line, toms
 * descending between them, cymbals crossed at the top.
 *
 * The keys are VexFlow's `note/octave/notehead` form, and the octaves in them
 * are staff positions read as if in treble clef, not sounding pitches. Nothing
 * outside this file should read them as pitch.
 */

/**
 * Cross (`noteheadXBlack`): sticks, cymbals, shakers — anything that is not a
 * drumhead.
 */
const X = 'x';
/**
 * Circled cross (`noteheadCircleX`): the standard "let it ring" mark, which is
 * how an open hi-hat is told from a closed one.
 *
 * Verified against VexFlow's own codes rather than assumed: `x` and `x2` are
 * both `noteheadXBlack`, `x3` is `noteheadCircleX`, and `ci` is
 * `noteheadCircledBlack` — a filled head inside a circle, which means nothing
 * here and is what open hi-hat was wrongly drawn with.
 */
const CIRCLE_X = 'x3';
/** Diamond: bells and cups. */
const DIAMOND = 'd';
/** Triangle: the cowbell's usual mark. */
const TRIANGLE = 'tu';

/**
 * General MIDI percussion (35-81) to staff position.
 *
 * Numbers outside this range are not General MIDI percussion; `percussionVexKey`
 * keeps them on the middle line rather than inventing a position, so an
 * unexpected note is visible and obviously unplaced instead of flying off the
 * staff.
 */
const DRUM_MAP: Record<number, string> = {
  35: 'f/4', // Acoustic Bass Drum
  36: 'f/4', // Bass Drum 1
  37: `c/5/${X}`, // Side Stick
  38: 'c/5', // Acoustic Snare
  39: `c/5/${X}`, // Hand Clap
  40: 'c/5', // Electric Snare
  41: 'g/4', // Low Floor Tom
  42: `g/5/${X}`, // Closed Hi-Hat
  43: 'a/4', // High Floor Tom
  44: `d/4/${X}`, // Pedal Hi-Hat
  45: 'b/4', // Low Tom
  46: `g/5/${CIRCLE_X}`, // Open Hi-Hat
  47: 'd/5', // Low-Mid Tom
  48: 'e/5', // Hi-Mid Tom
  49: `a/5/${X}`, // Crash Cymbal 1
  50: 'f/5', // High Tom
  51: `f/5/${X}`, // Ride Cymbal 1
  52: `b/5/${CIRCLE_X}`, // Chinese Cymbal
  53: `f/5/${DIAMOND}`, // Ride Bell
  54: `d/5/${X}`, // Tambourine
  55: `b/5/${X}`, // Splash Cymbal
  56: `e/5/${TRIANGLE}`, // Cowbell
  57: `a/5/${X}`, // Crash Cymbal 2
  58: `b/4/${X}`, // Vibraslap
  59: `f/5/${X}`, // Ride Cymbal 2
  // 60-81 are hand and Latin percussion rather than kit pieces, so there is no
  // drum-set convention to follow. They are spread over the staff by family,
  // pitched pairs keeping high above low, so a part stays readable.
  60: 'e/5', // Hi Bongo
  61: 'c/5', // Low Bongo
  62: 'd/5', // Mute Hi Conga
  63: 'd/5', // Open Hi Conga
  64: 'b/4', // Low Conga
  65: 'e/5', // High Timbale
  66: 'c/5', // Low Timbale
  67: `f/5/${X}`, // High Agogo
  68: `d/5/${X}`, // Low Agogo
  69: `g/5/${X}`, // Cabasa
  70: `g/5/${X}`, // Maracas
  71: `a/5/${X}`, // Short Whistle
  72: `a/5/${X}`, // Long Whistle
  73: `f/5/${X}`, // Short Guiro
  74: `f/5/${X}`, // Long Guiro
  75: `e/5/${X}`, // Claves
  76: `e/5/${X}`, // Hi Wood Block
  77: `c/5/${X}`, // Low Wood Block
  78: `d/5/${X}`, // Mute Cuica
  79: `d/5/${X}`, // Open Cuica
  80: `a/5/${X}`, // Mute Triangle
  81: `a/5/${CIRCLE_X}`, // Open Triangle
};

/**
 * The middle line — where anything unrecognised goes, so it stays on the staff.
 *
 * The staff runs from line 1 (bottom, E4) to line 5 (top, F5) in VexFlow's
 * numbering; every mapping above stays within one ledger of that, and the
 * pedal hi-hat is deliberately just below it, as convention has it.
 */
const UNMAPPED = 'b/4';

/**
 * The kit pieces played with the feet: both bass drums and the hi-hat pedal.
 *
 * They are stemmed downward against the hands, which is what lets a drum staff
 * carry a whole kit on five lines and still be read at a glance.
 */
const FOOT_DRUMS = new Set([35, 36, 44]);

/** Whether `midi` is struck with a foot rather than a hand. */
export function isFootDrum(midi: number): boolean {
  return FOOT_DRUMS.has(midi);
}

/**
 * How far a cross notehead's stem must reach into the glyph to join it.
 *
 * A stem meets a notehead at its right (or left) edge, halfway up. On an oval
 * that is solid ink; on a cross it is the hollow middle, and the only ink at
 * that edge is the two arm tips at the corners. VexFlow's default stops the
 * stem four units short of even the halfway point, so it grazed the upper tip
 * at a single point and read as a separate mark sitting above the note.
 *
 * Half a notehead — five units at the default glyph scale — runs the stem the
 * full height of the glyph, bridging both arm tips, which is what reads as
 * joined. Measured from the rendered SVG in both directions: +5 lands an
 * up-stem exactly on the head's bottom edge and -5 lands a down-stem exactly
 * on its top edge, while -9 and beyond overshoot past the glyph.
 */
const CROSS_STEM_OVERLAP = 5;

/** Whether `key` (VexFlow `note/octave/head` form) draws as a cross. */
function isCrossHead(key: string): boolean {
  const head = key.split('/')[2];
  return head === X || head === CIRCLE_X;
}

/**
 * The stem base offsets that join a stem to `keys`, or `null` when they need
 * none.
 *
 * Only when *every* head in the group is a cross: the stem attaches to one
 * outer head, and in a mixed chord that may be an ordinary one, which already
 * meets its stem correctly.
 */
export function crossHeadStemOffsets(
  keys: string[]
): { stem_up_y_base_offset: number; stem_down_y_base_offset: number } | null {
  if (keys.length === 0 || !keys.every(isCrossHead)) return null;
  return {
    stem_up_y_base_offset: CROSS_STEM_OVERLAP,
    stem_down_y_base_offset: -CROSS_STEM_OVERLAP,
  };
}

/** The VexFlow key for General MIDI percussion note `midi`. */
export function percussionVexKey(midi: number): string {
  return DRUM_MAP[midi] ?? UNMAPPED;
}

/**
 * Whether `midi` has a staff position of its own.
 *
 * Exposed because `UNMAPPED` is `b/4`, which is also a real position — Low Tom
 * sits there — so the return of `percussionVexKey` cannot be used to tell a
 * drum this table knows from one it does not. `gm-percussion.ts` pins its own
 * coverage against this, since a drum in one and not the other is either drawn
 * without a name or named without a place to draw it.
 */
export function hasPercussionMapping(midi: number): boolean {
  return midi in DRUM_MAP;
}
