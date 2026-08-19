/**
 * The General MIDI Level 1 sound set: 128 programs, grouped into 16 families
 * of 8. Pure data and lookups — no Tone, no VexFlow, no store.
 *
 * `Track.midiProgram` is exactly a program number from this table, and
 * `music_types` already validates it to 0-127, so this module never has to
 * defend against a bad value from the schema — only against a hand-edited
 * score, which is why `gmInstrument` returns `null` rather than throwing.
 */

export type GmFamily =
  | 'piano'
  | 'chromatic-percussion'
  | 'organ'
  | 'guitar'
  | 'bass'
  | 'strings'
  | 'ensemble'
  | 'brass'
  | 'reed'
  | 'pipe'
  | 'synth-lead'
  | 'synth-pad'
  | 'synth-effects'
  | 'ethnic'
  | 'percussive'
  | 'sound-effects';

export type GmInstrument = {
  /** 0-127, matching `Track.midiProgram`. */
  program: number;
  /** The General MIDI name, e.g. "Acoustic Grand Piano". */
  name: string;
  family: GmFamily;
};

/** In program order: family `i` covers programs `i*8 .. i*8+7`. */
export const GM_FAMILIES: readonly GmFamily[] = [
  'piano',
  'chromatic-percussion',
  'organ',
  'guitar',
  'bass',
  'strings',
  'ensemble',
  'brass',
  'reed',
  'pipe',
  'synth-lead',
  'synth-pad',
  'synth-effects',
  'ethnic',
  'percussive',
  'sound-effects',
];

export const GM_FAMILY_LABELS: Record<GmFamily, string> = {
  piano: 'Piano',
  'chromatic-percussion': 'Chromatic Percussion',
  organ: 'Organ',
  guitar: 'Guitar',
  bass: 'Bass',
  strings: 'Strings',
  ensemble: 'Ensemble',
  brass: 'Brass',
  reed: 'Reed',
  pipe: 'Pipe',
  'synth-lead': 'Synth Lead',
  'synth-pad': 'Synth Pad',
  'synth-effects': 'Synth Effects',
  ethnic: 'Ethnic',
  percussive: 'Percussive',
  'sound-effects': 'Sound Effects',
};

/**
 * The 128 names in program order. Families are NOT stored per row: they are a
 * contiguous run of eight, so `gmFamilyOf` derives them and the table cannot
 * drift out of sync with `GM_FAMILIES`.
 */
const GM_NAMES: readonly string[] = [
  // 0-7 Piano
  'Acoustic Grand Piano',
  'Bright Acoustic Piano',
  'Electric Grand Piano',
  'Honky-tonk Piano',
  'Electric Piano 1',
  'Electric Piano 2',
  'Harpsichord',
  'Clavinet',
  // 8-15 Chromatic Percussion
  'Celesta',
  'Glockenspiel',
  'Music Box',
  'Vibraphone',
  'Marimba',
  'Xylophone',
  'Tubular Bells',
  'Dulcimer',
  // 16-23 Organ
  'Drawbar Organ',
  'Percussive Organ',
  'Rock Organ',
  'Church Organ',
  'Reed Organ',
  'Accordion',
  'Harmonica',
  'Tango Accordion',
  // 24-31 Guitar
  'Acoustic Guitar (nylon)',
  'Acoustic Guitar (steel)',
  'Electric Guitar (jazz)',
  'Electric Guitar (clean)',
  'Electric Guitar (muted)',
  'Overdriven Guitar',
  'Distortion Guitar',
  'Guitar Harmonics',
  // 32-39 Bass
  'Acoustic Bass',
  'Electric Bass (finger)',
  'Electric Bass (pick)',
  'Fretless Bass',
  'Slap Bass 1',
  'Slap Bass 2',
  'Synth Bass 1',
  'Synth Bass 2',
  // 40-47 Strings
  'Violin',
  'Viola',
  'Cello',
  'Contrabass',
  'Tremolo Strings',
  'Pizzicato Strings',
  'Orchestral Harp',
  'Timpani',
  // 48-55 Ensemble
  'String Ensemble 1',
  'String Ensemble 2',
  'Synth Strings 1',
  'Synth Strings 2',
  'Choir Aahs',
  'Voice Oohs',
  'Synth Voice',
  'Orchestra Hit',
  // 56-63 Brass
  'Trumpet',
  'Trombone',
  'Tuba',
  'Muted Trumpet',
  'French Horn',
  'Brass Section',
  'Synth Brass 1',
  'Synth Brass 2',
  // 64-71 Reed
  'Soprano Sax',
  'Alto Sax',
  'Tenor Sax',
  'Baritone Sax',
  'Oboe',
  'English Horn',
  'Bassoon',
  'Clarinet',
  // 72-79 Pipe
  'Piccolo',
  'Flute',
  'Recorder',
  'Pan Flute',
  'Blown Bottle',
  'Shakuhachi',
  'Whistle',
  'Ocarina',
  // 80-87 Synth Lead
  'Lead 1 (square)',
  'Lead 2 (sawtooth)',
  'Lead 3 (calliope)',
  'Lead 4 (chiff)',
  'Lead 5 (charang)',
  'Lead 6 (voice)',
  'Lead 7 (fifths)',
  'Lead 8 (bass + lead)',
  // 88-95 Synth Pad
  'Pad 1 (new age)',
  'Pad 2 (warm)',
  'Pad 3 (polysynth)',
  'Pad 4 (choir)',
  'Pad 5 (bowed)',
  'Pad 6 (metallic)',
  'Pad 7 (halo)',
  'Pad 8 (sweep)',
  // 96-103 Synth Effects
  'FX 1 (rain)',
  'FX 2 (soundtrack)',
  'FX 3 (crystal)',
  'FX 4 (atmosphere)',
  'FX 5 (brightness)',
  'FX 6 (goblins)',
  'FX 7 (echoes)',
  'FX 8 (sci-fi)',
  // 104-111 Ethnic
  'Sitar',
  'Banjo',
  'Shamisen',
  'Koto',
  'Kalimba',
  'Bagpipe',
  'Fiddle',
  'Shanai',
  // 112-119 Percussive
  'Tinkle Bell',
  'Agogo',
  'Steel Drums',
  'Woodblock',
  'Taiko Drum',
  'Melodic Tom',
  'Synth Drum',
  'Reverse Cymbal',
  // 120-127 Sound Effects
  'Guitar Fret Noise',
  'Breath Noise',
  'Seashore',
  'Bird Tweet',
  'Telephone Ring',
  'Helicopter',
  'Applause',
  'Gunshot',
];

/** The family a program belongs to. Arithmetic, because families are runs of eight. */
export function gmFamilyOf(program: number): GmFamily {
  return GM_FAMILIES[Math.floor(program / 8)];
}

export const GM_INSTRUMENTS: readonly GmInstrument[] = GM_NAMES.map(
  (name, program) => ({
    program,
    name,
    family: gmFamilyOf(program),
  })
);

/** `null` for anything that is not an integer in 0-127. */
export function gmInstrument(program: number): GmInstrument | null {
  if (!Number.isInteger(program) || program < 0 || program > 127) return null;
  return GM_INSTRUMENTS[program];
}

/** The eight programs of one family, in program order — what the picker groups by. */
export function gmInstrumentsByFamily(
  family: GmFamily
): readonly GmInstrument[] {
  return GM_INSTRUMENTS.filter(instrument => instrument.family === family);
}
