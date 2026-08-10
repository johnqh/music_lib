/**
 * Line art per General MIDI program: hand-picked for the instruments people
 * actually reach for, family fallback for the rest, so all 128 resolve.
 *
 * Single-colour strokes on a 24x24 grid (`icon-art.ts`), drawn with no fill.
 * This replaced an emoji table, which had three problems a label-sized glyph
 * beside coloured staves could not carry: emoji render differently on every
 * platform, do not render at all where no emoji font is installed (a bare
 * headless browser, some Linux images), and cannot be recoloured — so the
 * gutter's icon stayed multicoloured while its text tracked the active-track
 * colour. Strokes take the caller's colour, so the icon now dims with the
 * track name beside it.
 *
 * The set is smaller than the mapping: several programs share art on purpose,
 * exactly as the emoji table had four programs on one piano glyph. Bass borrows
 * the guitar body — at this size a bass silhouette differs only in proportion,
 * and a distinct-but-unreadable icon is worse than an honest shared one.
 *
 * It lives beside the catalogue rather than in the app because the canvas
 * renderer draws it into the track gutter too, and one table beats passing a
 * per-track art map in as a render option.
 */
import { gmFamilyOf, gmInstrument } from './gm.js';
import type { GmFamily } from './gm.js';
import type { InstrumentIconArt } from './icon-art.js';

/** A keyboard: three white keys, three black keys sitting on top of them. */
const PIANO: InstrumentIconArt = {
  name: 'piano',
  shapes: [
    { kind: 'path', d: 'M3 8 L21 8 L21 16 L3 16 Z' },
    { kind: 'path', d: 'M9 8 L9 16' },
    { kind: 'path', d: 'M15 8 L15 16' },
    { kind: 'path', d: 'M6 8 L6 12.6' },
    { kind: 'path', d: 'M12 8 L12 12.6' },
    { kind: 'path', d: 'M18 8 L18 12.6' },
  ],
};

/**
 * A bell — glockenspiel, celesta, tubular bells, music box. Vibraphone and
 * marimba are struck bars rather than bells, but every bar-and-mallet drawing
 * of them read as a text-align icon, and a struck metal bar is near enough.
 */
const BELL: InstrumentIconArt = {
  name: 'bell',
  shapes: [
    {
      kind: 'path',
      d: 'M12 4 C8.6 4 7.2 7 7.2 11 C7.2 13.8 6.2 15.4 5.4 16.6 L18.6 16.6 C17.8 15.4 16.8 13.8 16.8 11 C16.8 7 15.4 4 12 4 Z',
    },
    { kind: 'path', d: 'M12 4 L12 2.2' },
    { kind: 'circle', cx: 12, cy: 19, r: 1.4 },
  ],
};

/** Pipes of differing length on a common foot. */
const ORGAN: InstrumentIconArt = {
  name: 'organ',
  shapes: [
    { kind: 'path', d: 'M3 19 L21 19' },
    { kind: 'path', d: 'M6 19 L6 6' },
    { kind: 'path', d: 'M10 19 L10 9.5' },
    { kind: 'path', d: 'M14 19 L14 4.5' },
    { kind: 'path', d: 'M18 19 L18 8' },
  ],
};

/** Two end panels with the bellows zigzagging between them. */
const ACCORDION: InstrumentIconArt = {
  name: 'accordion',
  shapes: [
    { kind: 'path', d: 'M3 5 L6.5 5 L6.5 19 L3 19 Z' },
    { kind: 'path', d: 'M17.5 5 L21 5 L21 19 L17.5 19 Z' },
    { kind: 'path', d: 'M6.5 8 L17.5 8 L17.5 16 L6.5 16 Z' },
    { kind: 'path', d: 'M9.25 8 L9.25 16' },
    { kind: 'path', d: 'M12 8 L12 16' },
    { kind: 'path', d: 'M14.75 8 L14.75 16' },
    { kind: 'circle', cx: 4.75, cy: 8, r: 0.9 },
  ],
};

/** A comb: wide, short, split down the middle. */
const HARMONICA: InstrumentIconArt = {
  name: 'harmonica',
  shapes: [
    { kind: 'path', d: 'M3 9.5 L21 9.5 L21 14.5 L3 14.5 Z' },
    { kind: 'path', d: 'M3 12 L21 12' },
    { kind: 'path', d: 'M7.5 9.5 L7.5 14.5' },
    { kind: 'path', d: 'M12 9.5 L12 14.5' },
    { kind: 'path', d: 'M16.5 9.5 L16.5 14.5' },
  ],
};

/** A waisted body with a round sound hole and a straight neck. Bass borrows it. */
const GUITAR: InstrumentIconArt = {
  name: 'guitar',
  shapes: [
    {
      kind: 'path',
      d: 'M12 10 C9.8 10 8.4 11.2 8.4 12.8 C8.4 14.2 9.6 14.6 9.6 15.8 C9.6 17 7.4 17.4 7.4 18.8 C7.4 20.4 9.6 21.5 12 21.5 C14.4 21.5 16.6 20.4 16.6 18.8 C16.6 17.4 14.4 17 14.4 15.8 C14.4 14.6 15.6 14.2 15.6 12.8 C15.6 11.2 14.2 10 12 10 Z',
    },
    { kind: 'path', d: 'M12 10 L12 3.2' },
    { kind: 'path', d: 'M10.3 3.2 L13.7 3.2' },
    { kind: 'circle', cx: 12, cy: 17.4, r: 1.4 },
  ],
};

/** A narrower waisted body with f-holes and a scroll. */
const VIOLIN: InstrumentIconArt = {
  name: 'violin',
  shapes: [
    {
      kind: 'path',
      d: 'M12 11 C10.3 11 9.2 12 9.2 13.3 C9.2 14.4 10.3 14.8 10.3 15.8 C10.3 16.9 8.8 17.3 8.8 18.6 C8.8 20 10.2 21 12 21 C13.8 21 15.2 20 15.2 18.6 C15.2 17.3 13.7 16.9 13.7 15.8 C13.7 14.8 14.8 14.4 14.8 13.3 C14.8 12 13.7 11 12 11 Z',
    },
    { kind: 'path', d: 'M12 11 L12 5.4' },
    { kind: 'path', d: 'M10.5 17.2 L10.5 19.2' },
    { kind: 'path', d: 'M13.5 17.2 L13.5 19.2' },
    { kind: 'circle', cx: 12, cy: 4.3, r: 1.2 },
  ],
};

/** A staff with a note on it — the written part, for the ensemble families. */
const ENSEMBLE: InstrumentIconArt = {
  name: 'ensemble',
  shapes: [
    { kind: 'path', d: 'M3 7 L21 7' },
    { kind: 'path', d: 'M3 10 L21 10' },
    { kind: 'path', d: 'M3 13 L21 13' },
    { kind: 'path', d: 'M3 16 L21 16' },
    { kind: 'path', d: 'M10.6 15.5 L10.6 6' },
    { kind: 'path', d: 'M10.6 6 C13 6.6 14.4 8 14.6 10' },
    { kind: 'circle', cx: 8.5, cy: 15.5, r: 2.1 },
  ],
};

/** A microphone on a stand — the voice families. */
const VOICE: InstrumentIconArt = {
  name: 'voice',
  shapes: [
    {
      kind: 'path',
      d: 'M12 3 C10.3 3 9 4.3 9 6 L9 11 C9 12.7 10.3 14 12 14 C13.7 14 15 12.7 15 11 L15 6 C15 4.3 13.7 3 12 3 Z',
    },
    { kind: 'path', d: 'M6.5 10.5 C6.5 15 9 17.5 12 17.5 C15 17.5 17.5 15 17.5 10.5' },
    { kind: 'path', d: 'M12 17.5 L12 21' },
    { kind: 'path', d: 'M8.5 21 L15.5 21' },
  ],
};

/** Mouthpiece, valves and a flared bell. */
const BRASS: InstrumentIconArt = {
  name: 'brass',
  shapes: [
    { kind: 'path', d: 'M5.2 12 L14 12' },
    { kind: 'path', d: 'M14 12 L20 6.5' },
    { kind: 'path', d: 'M14 12 L20 17.5' },
    { kind: 'path', d: 'M20 6.5 C21.6 9 21.6 15 20 17.5' },
    { kind: 'path', d: 'M8 12 L8 8.5' },
    { kind: 'path', d: 'M10.4 12 L10.4 8.5' },
    { kind: 'path', d: 'M12.8 12 L12.8 8.5' },
    { kind: 'circle', cx: 3.9, cy: 12, r: 1.3 },
  ],
};

/** The hooked body and upturned bell of a saxophone, with two keys. */
const SAX: InstrumentIconArt = {
  name: 'sax',
  shapes: [
    { kind: 'path', d: 'M15.5 3.5 L15.5 12.5 C15.5 17 11.9 20.5 7.7 20.5' },
    { kind: 'path', d: 'M7.7 20.5 C4.9 20.5 3.5 18.1 4.2 15.6' },
    { kind: 'path', d: 'M7.7 20.5 C7.2 18.7 7.2 17.4 7.6 16.2' },
    { kind: 'path', d: 'M4.2 15.6 L7.6 16.2' },
    { kind: 'path', d: 'M15.5 3.5 L13.4 2.3' },
    { kind: 'circle', cx: 17.1, cy: 7, r: 0.85 },
    { kind: 'circle', cx: 17.1, cy: 10, r: 0.85 },
  ],
};

/** A straight tube with finger holes — flute, recorder, clarinet, piccolo. */
const PIPE: InstrumentIconArt = {
  name: 'pipe',
  shapes: [
    { kind: 'path', d: 'M3.5 17.5 L17.5 3.5' },
    { kind: 'path', d: 'M6.5 20.5 L20.5 6.5' },
    { kind: 'path', d: 'M3.5 17.5 L6.5 20.5' },
    { kind: 'path', d: 'M17.5 3.5 L20.5 6.5' },
    { kind: 'circle', cx: 9.2, cy: 14.8, r: 0.8 },
    { kind: 'circle', cx: 12, cy: 12, r: 0.8 },
    { kind: 'circle', cx: 14.8, cy: 9.2, r: 0.8 },
  ],
};

/** A panel of sliders — the synth-lead family. */
const SYNTH: InstrumentIconArt = {
  name: 'synth',
  shapes: [
    { kind: 'path', d: 'M3 6 L21 6 L21 18 L3 18 Z' },
    { kind: 'path', d: 'M6.5 10 L17.5 10' },
    { kind: 'path', d: 'M6.5 14 L17.5 14' },
    { kind: 'circle', cx: 9.5, cy: 10, r: 1.5 },
    { kind: 'circle', cx: 14.5, cy: 14, r: 1.5 },
  ],
};

/** A slow wave — the synth pads. */
const PAD: InstrumentIconArt = {
  name: 'pad',
  shapes: [
    {
      kind: 'path',
      d: 'M2.5 12 C4.5 5 6.5 5 8.5 12 C10.5 19 12.5 19 14.5 12 C16.2 6 18.6 6 21.5 10',
    },
  ],
};

/** A star and a spark — the synth effects, which are gestures rather than instruments. */
const SPARKLE: InstrumentIconArt = {
  name: 'sparkle',
  shapes: [
    {
      kind: 'path',
      d: 'M12 3 C12 8 14 10 19 12 C14 14 12 16 12 21 C12 16 10 14 5 12 C10 10 12 8 12 3 Z',
    },
    { kind: 'path', d: 'M19.5 3.5 L19.5 7.5' },
    { kind: 'path', d: 'M17.5 5.5 L21.5 5.5' },
  ],
};

/** A round-bodied, long-necked instrument — sitar, banjo, shamisen. */
const ETHNIC: InstrumentIconArt = {
  name: 'ethnic',
  shapes: [
    { kind: 'path', d: 'M12 12 L19.5 4.5' },
    { kind: 'path', d: 'M18.3 3.3 L20.7 5.7' },
    { kind: 'circle', cx: 8.6, cy: 15.4, r: 4.8 },
    { kind: 'circle', cx: 8.6, cy: 15.4, r: 1.5 },
  ],
};

/** A shell with an elliptical head. */
const DRUM: InstrumentIconArt = {
  name: 'drum',
  shapes: [
    {
      kind: 'path',
      d: 'M20 8 C20 9.66 16.42 11 12 11 C7.58 11 4 9.66 4 8 C4 6.34 7.58 5 12 5 C16.42 5 20 6.34 20 8 Z',
    },
    { kind: 'path', d: 'M4 8 L4 16' },
    { kind: 'path', d: 'M20 8 L20 16' },
    { kind: 'path', d: 'M4 10.5 L8 15.5 L12 10.5 L16 15.5 L20 10.5' },
    { kind: 'path', d: 'M4 16 C4 17.66 7.58 19 12 19 C16.42 19 20 17.66 20 16' },
  ],
};

/** A speaker cabinet — the sound-effects family, which is playback, not performance. */
const SPEAKER: InstrumentIconArt = {
  name: 'speaker',
  shapes: [
    { kind: 'path', d: 'M5 3 L19 3 L19 21 L5 21 Z' },
    { kind: 'circle', cx: 12, cy: 14.5, r: 3.6 },
    { kind: 'circle', cx: 12, cy: 7, r: 1.6 },
  ],
};

/** Hand-picked art for the instruments people actually reach for. */
const PROGRAM_ICON: Record<number, InstrumentIconArt> = {
  0: PIANO, // Acoustic Grand Piano
  1: PIANO, // Bright Acoustic Piano
  4: PIANO, // Electric Piano 1
  6: PIANO, // Harpsichord
  11: BELL, // Vibraphone
  16: ORGAN, // Drawbar Organ
  19: ORGAN, // Church Organ
  21: ACCORDION, // Accordion
  22: HARMONICA, // Harmonica
  24: GUITAR, // Acoustic Guitar (nylon)
  25: GUITAR, // Acoustic Guitar (steel)
  27: GUITAR, // Electric Guitar (clean)
  30: GUITAR, // Distortion Guitar
  32: GUITAR, // Acoustic Bass
  33: GUITAR, // Electric Bass (finger)
  40: VIOLIN, // Violin
  42: VIOLIN, // Cello
  48: VIOLIN, // String Ensemble 1
  52: VOICE, // Choir Aahs
  56: BRASS, // Trumpet
  57: BRASS, // Trombone
  58: BRASS, // Tuba
  64: SAX, // Soprano Sax
  65: SAX, // Alto Sax
  66: SAX, // Tenor Sax
  71: PIPE, // Clarinet — straight-bodied, so the tube reads truer than the sax hook
  72: PIPE, // Piccolo
  73: PIPE, // Flute
  74: PIPE, // Recorder
  104: ETHNIC, // Sitar
  105: ETHNIC, // Banjo
  114: DRUM, // Steel Drums
  116: DRUM, // Taiko Drum
};

/** Every family has one, so all 128 programs resolve to something. */
const FAMILY_ICON: Record<GmFamily, InstrumentIconArt> = {
  piano: PIANO,
  'chromatic-percussion': BELL,
  organ: ORGAN,
  guitar: GUITAR,
  bass: GUITAR,
  strings: VIOLIN,
  ensemble: ENSEMBLE,
  brass: BRASS,
  reed: SAX,
  pipe: PIPE,
  'synth-lead': SYNTH,
  'synth-pad': PAD,
  'synth-effects': SPARKLE,
  ethnic: ETHNIC,
  percussive: DRUM,
  'sound-effects': SPEAKER,
};

/**
 * The art for a drum kit.
 *
 * Not reachable through `gmInstrumentIcon`: a kit is addressed by a program
 * number that means something else entirely in the melodic table — Brush is 40,
 * where the instrument art is a violin.
 */
export function gmKitIcon(): InstrumentIconArt {
  return DRUM;
}

/** The hand-picked art for `program`, else its family's. */
export function gmInstrumentIcon(program: number): InstrumentIconArt {
  const picked = PROGRAM_ICON[program];
  if (picked) return picked;
  // An out-of-range program has no family; fall back rather than draw blank.
  return gmInstrument(program) ? FAMILY_ICON[gmFamilyOf(program)] : FAMILY_ICON.piano;
}
