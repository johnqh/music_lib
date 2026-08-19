/**
 * The General MIDI drum kits — what `Track.midiProgram` means on a percussion
 * track.
 *
 * A drum track's program is not an instrument. General MIDI selects the kit
 * with a program change on the drum channel, so on a percussion-clef track the
 * same field that names a violin elsewhere names Room, TR-808 or Brush. Reading
 * it through `gm.ts` gives an answer that is wrong in a way nothing catches:
 * the picker offered "Acoustic Guitar (nylon)" for what the synth played as the
 * Electronic kit, and every derived lookup — range, polyphony, transposition —
 * answered for a guitar.
 *
 * The eight addresses below are the ones General MIDI defines. All eight are
 * present and audibly distinct in the shipped soundfont, which is not an
 * assumption: `general-midi.spec.ts` selects each one on a real synth and
 * compares what comes out.
 */

export type GmKit = {
  /** The program number that selects this kit, matching `Track.midiProgram`. */
  program: number;
  /** The conventional name, e.g. "TR-808". */
  name: string;
};

/**
 * In address order.
 *
 * Note that Electronic and TR-808 are adjacent: 24 and 25, not 24 and 32. That
 * irregularity is General MIDI's, and it is why kit regions cannot be derived
 * arithmetically the way instrument families can.
 */
export const GM_KITS: readonly GmKit[] = [
  { program: 0, name: 'Standard Kit' },
  { program: 8, name: 'Room Kit' },
  { program: 16, name: 'Power Kit' },
  { program: 24, name: 'Electronic Kit' },
  { program: 25, name: 'TR-808 Kit' },
  { program: 32, name: 'Jazz Kit' },
  { program: 40, name: 'Brush Kit' },
  { program: 48, name: 'Orchestra Kit' },
];

/** The kit at exactly `program`, or `null` where no kit is defined there. */
export function gmKit(program: number): GmKit | null {
  return GM_KITS.find(kit => kit.program === program) ?? null;
}

/**
 * The kit whose region contains `program` — always an answer.
 *
 * A kit occupies its address up to the next kit's, so program 45 is inside
 * Brush's region and program 3 inside Standard's. That is how General MIDI
 * hardware resolves an address it has no kit at, and it is what lets a MIDI
 * file that sets an undefined program on channel 10 be read as something rather
 * than refused. Anything below the first kit, or not a number at all, is
 * Standard: the kit every font has.
 */
export function gmKitAt(program: number): GmKit {
  if (!Number.isFinite(program)) return GM_KITS[0];
  let found = GM_KITS[0];
  for (const kit of GM_KITS) {
    if (kit.program <= program) found = kit;
  }
  return found;
}
