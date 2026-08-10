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

/** Cross: sticks, cymbals, shakers — anything that is not a drumhead. */
const X = 'x2';
/** Circled cross: the ringing counterpart of a closed sound. */
const CIRCLE_X = 'ci';
/** Diamond: bells and cups. */
const DIAMOND = 'd';
/** A second cross, to separate cymbals that share a position. */
const X_ALT = 'x3';

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
  52: `a/5/${CIRCLE_X}`, // Chinese Cymbal
  53: `f/5/${DIAMOND}`, // Ride Bell
  54: `d/5/${X}`, // Tambourine
  55: `g/5/${X_ALT}`, // Splash Cymbal
  56: `e/5/${DIAMOND}`, // Cowbell
  57: `a/5/${X_ALT}`, // Crash Cymbal 2
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

/** The VexFlow key for General MIDI percussion note `midi`. */
export function percussionVexKey(midi: number): string {
  return DRUM_MAP[midi] ?? UNMAPPED;
}
