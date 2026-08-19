import { describe, expect, it } from 'vitest';
import {
  GM_PERCUSSION,
  GM_PERCUSSION_RANGE,
  gmPercussion,
  gmPercussionName,
} from './gm-percussion.js';
import { hasPercussionMapping } from '../../adapters/vexflow/percussion.js';

describe('gmPercussion', () => {
  it('covers every note in the General MIDI percussion range, with no gaps', () => {
    // A gap is a key on the keyboard that sounds a drum and cannot say which.
    const covered = GM_PERCUSSION.map(d => d.midi);
    const expected = [];
    for (
      let midi = GM_PERCUSSION_RANGE.min;
      midi <= GM_PERCUSSION_RANGE.max;
      midi += 1
    ) {
      expected.push(midi);
    }
    expect(covered).toEqual(expected);
  });

  it('names exactly what the staff draws', () => {
    // The notation mapping and this table are two views of one fact. A drum
    // one of them knows about and the other does not is drawn on the staff and
    // then labelled with nothing, or labelled and then drawn nowhere.
    for (const drum of GM_PERCUSSION) {
      expect(hasPercussionMapping(drum.midi), `${drum.name} is drawn`).toBe(
        true
      );
    }
    // And the other direction: nothing is drawn that this table cannot name.
    for (let midi = 0; midi < 128; midi += 1) {
      if (hasPercussionMapping(midi))
        expect(gmPercussion(midi), `note ${midi}`).not.toBeNull();
    }
  });

  it('gives every drum a key cap short enough to be one', () => {
    // Seven characters is what fits between two keys: the keyboard labels one
    // row of whites and one of blacks, and within a row the labels sit one
    // white key apart. Longer than this and neighbouring drums run together.
    for (const drum of GM_PERCUSSION) {
      expect(
        drum.short.length,
        `${drum.name} -> "${drum.short}"`
      ).toBeLessThanOrEqual(7);
      expect(drum.short.length).toBeGreaterThan(0);
    }
  });

  it('says the note number outside the range rather than inventing a pitch', () => {
    // "C8" would suggest something is going to sound there. Nothing is.
    expect(gmPercussion(34)).toBeNull();
    expect(gmPercussionName(34)).toBe('Note 34');
    expect(gmPercussionName(38)).toBe('Acoustic Snare');
  });
});
