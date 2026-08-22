import { describe, expect, it } from 'vitest';
import { ticksFor } from '../../index.js';
import type { NoteEvent } from '@sudobility/music_types';
import { durationDisplay } from './duration-selection.js';

const PPQ = 480;

/** Only the field the display depends on; the rest of a NoteEvent is irrelevant here. */
const note = (durationTicks: number) => ({ durationTicks }) as NoteEvent;

describe('durationDisplay', () => {
  it('shows what the next note will be when nothing is selected', () => {
    // With no selection the control is an instruction about the future, not a
    // readout of the past.
    expect(durationDisplay([], PPQ, 'eighth')).toEqual({
      kind: 'single',
      duration: 'eighth',
      base: 'eighth',
    });
  });

  it("shows the selected note's own duration, not the armed one", () => {
    const display = durationDisplay(
      [note(ticksFor('half', PPQ))],
      PPQ,
      'sixteenth'
    );
    expect(display).toEqual({ kind: 'single', duration: 'half', base: 'half' });
  });

  it('shows the shared duration when several notes agree', () => {
    const quarter = ticksFor('quarter', PPQ);
    expect(
      durationDisplay(
        [note(quarter), note(quarter), note(quarter)],
        PPQ,
        'whole'
      )
    ).toEqual({
      kind: 'single',
      duration: 'quarter',
      base: 'quarter',
    });
  });

  it('is mixed when they disagree — not the first, and not the armed value', () => {
    // Either of those would claim the selection is something it is not, and
    // then picking that same value from the menu would look like a no-op while
    // rewriting every other note in the selection.
    const display = durationDisplay(
      [note(ticksFor('quarter', PPQ)), note(ticksFor('eighth', PPQ))],
      PPQ,
      'quarter'
    );
    expect(display).toEqual({ kind: 'mixed' });
  });

  it('reports the base of a dotted or triplet note, so the modifiers stay separate', () => {
    expect(
      durationDisplay([note(ticksFor('dotted-quarter', PPQ))], PPQ, 'whole')
    ).toEqual({
      kind: 'single',
      duration: 'dotted-quarter',
      base: 'quarter',
    });
    expect(
      durationDisplay([note(ticksFor('triplet-eighth', PPQ))], PPQ, 'whole')
    ).toEqual({
      kind: 'single',
      duration: 'triplet-eighth',
      base: 'eighth',
    });
  });

  it('is mixed for a length no duration name covers, rather than rounding it', () => {
    // Imported and quantized music carries odd tick counts. Rounding one to the
    // nearest name would offer to "keep" a value the note does not have.
    expect(durationDisplay([note(500)], PPQ, 'quarter')).toEqual({
      kind: 'mixed',
    });
  });
});
