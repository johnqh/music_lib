/**
 * What each General MIDI drum note is, by name.
 *
 * On a percussion track a note's pitch is not a pitch — it says which drum was
 * struck. The staff already draws that (`adapters/vexflow/percussion.ts` maps
 * the same 35-81 to noteheads and positions), but nothing could put it into
 * words, so a drum key on the keyboard was labelled "C" and read aloud as "C3".
 *
 * Two names per drum, because two places need different lengths: `name` is the
 * General MIDI name, which is what a screen reader and an inspector should say,
 * and `short` is what fits on a key cap. The short form is not a truncation —
 * "Closed Hi-Hat" shortens to "Cl HH", not to "Closed H" — so it is authored
 * rather than derived.
 *
 * The note numbers are exactly the ones the notation mapping covers; a test
 * pins the two to the same set, since a drum this table forgets would be drawn
 * on the staff and then labelled with nothing.
 */

export type GmPercussion = {
  /** The MIDI note number that sounds this drum, 35-81. */
  midi: number;
  /** The General MIDI name, e.g. "Acoustic Snare". */
  name: string;
  /** A short form for a key cap, e.g. "Snare". */
  short: string;
};

/** The range General MIDI assigns drums to. Every number in it sounds something. */
export const GM_PERCUSSION_RANGE = { min: 35, max: 81 } as const;

const TABLE: readonly GmPercussion[] = [
  { midi: 35, name: 'Acoustic Bass Drum', short: 'Kick' },
  { midi: 36, name: 'Bass Drum 1', short: 'Kick 1' },
  { midi: 37, name: 'Side Stick', short: 'Stick' },
  { midi: 38, name: 'Acoustic Snare', short: 'Snare' },
  { midi: 39, name: 'Hand Clap', short: 'Clap' },
  { midi: 40, name: 'Electric Snare', short: 'El Snr' },
  { midi: 41, name: 'Low Floor Tom', short: 'Flr Lo' },
  { midi: 42, name: 'Closed Hi-Hat', short: 'Cl HH' },
  { midi: 43, name: 'High Floor Tom', short: 'Flr Hi' },
  { midi: 44, name: 'Pedal Hi-Hat', short: 'Pd HH' },
  { midi: 45, name: 'Low Tom', short: 'Tom Lo' },
  { midi: 46, name: 'Open Hi-Hat', short: 'Op HH' },
  { midi: 47, name: 'Low-Mid Tom', short: 'Tom Md' },
  { midi: 48, name: 'Hi-Mid Tom', short: 'Tom MHi' },
  { midi: 49, name: 'Crash Cymbal 1', short: 'Crash' },
  { midi: 50, name: 'High Tom', short: 'Tom Hi' },
  { midi: 51, name: 'Ride Cymbal 1', short: 'Ride' },
  { midi: 52, name: 'Chinese Cymbal', short: 'China' },
  { midi: 53, name: 'Ride Bell', short: 'Bell' },
  { midi: 54, name: 'Tambourine', short: 'Tamb' },
  { midi: 55, name: 'Splash Cymbal', short: 'Splash' },
  { midi: 56, name: 'Cowbell', short: 'Cowbell' },
  { midi: 57, name: 'Crash Cymbal 2', short: 'Crash 2' },
  { midi: 58, name: 'Vibraslap', short: 'Vibslap' },
  { midi: 59, name: 'Ride Cymbal 2', short: 'Ride 2' },
  { midi: 60, name: 'Hi Bongo', short: 'Bong Hi' },
  { midi: 61, name: 'Low Bongo', short: 'Bong Lo' },
  { midi: 62, name: 'Mute Hi Conga', short: 'Cong Mt' },
  { midi: 63, name: 'Open Hi Conga', short: 'Cong Hi' },
  { midi: 64, name: 'Low Conga', short: 'Cong Lo' },
  { midi: 65, name: 'High Timbale', short: 'Timb Hi' },
  { midi: 66, name: 'Low Timbale', short: 'Timb Lo' },
  { midi: 67, name: 'High Agogo', short: 'Agog Hi' },
  { midi: 68, name: 'Low Agogo', short: 'Agog Lo' },
  { midi: 69, name: 'Cabasa', short: 'Cabasa' },
  { midi: 70, name: 'Maracas', short: 'Maracas' },
  { midi: 71, name: 'Short Whistle', short: 'Whis' },
  { midi: 72, name: 'Long Whistle', short: 'Whis Lg' },
  { midi: 73, name: 'Short Guiro', short: 'Guiro' },
  { midi: 74, name: 'Long Guiro', short: 'Guiro L' },
  { midi: 75, name: 'Claves', short: 'Claves' },
  { midi: 76, name: 'Hi Wood Block', short: 'Wood Hi' },
  { midi: 77, name: 'Low Wood Block', short: 'Wood Lo' },
  { midi: 78, name: 'Mute Cuica', short: 'Cuic Mt' },
  { midi: 79, name: 'Open Cuica', short: 'Cuica' },
  { midi: 80, name: 'Mute Triangle', short: 'Tri Mt' },
  { midi: 81, name: 'Open Triangle', short: 'Tri' },
];

const BY_MIDI = new Map(TABLE.map(drum => [drum.midi, drum]));

export const GM_PERCUSSION: readonly GmPercussion[] = TABLE;

/** The drum `midi` sounds, or `null` outside the General MIDI percussion range. */
export function gmPercussion(midi: number): GmPercussion | null {
  return BY_MIDI.get(midi) ?? null;
}

/**
 * What to call `midi` on a drum track.
 *
 * Falls back to the note number rather than to a pitch name: outside 35-81
 * nothing is going to sound, and "C8" would suggest otherwise.
 */
export function gmPercussionName(midi: number): string {
  return gmPercussion(midi)?.name ?? `Note ${midi}`;
}
