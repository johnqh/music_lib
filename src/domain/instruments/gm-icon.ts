/**
 * A glyph per General MIDI program: hand-picked for the instruments people
 * actually reach for, family fallback for the rest, so all 128 resolve.
 *
 * Emoji rather than an SVG set: the consuming app's chrome is already emoji
 * throughout, so a bespoke instrument set would be the inconsistent choice, and
 * ~36 hand-drawn glyphs is an illustration project with ongoing upkeep for a
 * label-sized affordance. The trade, recorded so it is not mistaken for an
 * oversight: emoji render differently across platforms — and not at all where
 * no emoji font is installed, such as a bare headless browser — and cannot be
 * recoloured to the theme.
 *
 * It lives beside the catalogue rather than in the app because the canvas
 * renderer draws it into the track gutter too, and one table beats passing a
 * per-track glyph map in as a render option.
 */
import { gmFamilyOf, gmInstrument } from './gm.js';
import type { GmFamily } from './gm.js';

/** Hand-picked glyphs for the instruments people actually reach for. */
const PROGRAM_EMOJI: Record<number, string> = {
  0: '🎹', // Acoustic Grand Piano
  1: '🎹', // Bright Acoustic Piano
  4: '🎹', // Electric Piano 1
  6: '🎹', // Harpsichord
  11: '🎵', // Vibraphone
  16: '🪗', // Drawbar Organ
  19: '🎛️', // Church Organ
  21: '🪗', // Accordion
  22: '🎶', // Harmonica
  24: '🎸', // Acoustic Guitar (nylon)
  25: '🎸', // Acoustic Guitar (steel)
  27: '🎸', // Electric Guitar (clean)
  30: '🎸', // Distortion Guitar
  32: '🎸', // Acoustic Bass
  33: '🎸', // Electric Bass (finger)
  40: '🎻', // Violin
  42: '🎻', // Cello
  46: '🎼', // Orchestral Harp
  48: '🎻', // String Ensemble 1
  52: '🎤', // Choir Aahs
  56: '🎺', // Trumpet
  57: '🎺', // Trombone
  58: '🎺', // Tuba
  64: '🎷', // Soprano Sax
  65: '🎷', // Alto Sax
  66: '🎷', // Tenor Sax
  71: '🎶', // Clarinet
  72: '🪈', // Piccolo
  73: '🪈', // Flute
  74: '🪈', // Recorder
  104: '🪕', // Sitar
  105: '🪕', // Banjo
  114: '🥁', // Steel Drums
  116: '🥁', // Taiko Drum
};

/** Every family has one, so all 128 programs resolve to something. */
const FAMILY_EMOJI: Record<GmFamily, string> = {
  piano: '🎹',
  'chromatic-percussion': '🎵',
  organ: '🪗',
  guitar: '🎸',
  bass: '🎸',
  strings: '🎻',
  ensemble: '🎼',
  brass: '🎺',
  reed: '🎷',
  pipe: '🪈',
  'synth-lead': '🎛️',
  'synth-pad': '🎛️',
  'synth-effects': '✨',
  ethnic: '🪕',
  percussive: '🥁',
  'sound-effects': '🔊',
};

/** The hand-picked glyph for `program`, else its family's. */
export function gmInstrumentEmoji(program: number): string {
  const picked = PROGRAM_EMOJI[program];
  if (picked) return picked;
  // An out-of-range program has no family; fall back rather than render blank.
  return gmInstrument(program) ? FAMILY_EMOJI[gmFamilyOf(program)] : FAMILY_EMOJI.piano;
}
