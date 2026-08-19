import { describe, expect, it } from 'vitest';
import { StaveNote } from 'vexflow';
import {
  crossHeadStemOffsets,
  isFootDrum,
  percussionVexKey,
} from './percussion.js';

/** The staff position a key resolves to, as VexFlow computes it. */
function line(key: string): number {
  return new StaveNote({ keys: [key], duration: 'q' }).getKeyProps()[0].line;
}

describe('percussionVexKey', () => {
  it('keeps every General MIDI drum on or near the staff', () => {
    // The bug this exists for: a kick at MIDI 36 drawn as the pitch B1 sat six
    // ledger lines below the staff, with a stem long enough to reach the next
    // track's row. In VexFlow's numbering the staff runs line 1 (E4, bottom)
    // to line 5 (F5, top); one ledger either side is still readable.
    for (let midi = 35; midi <= 81; midi += 1) {
      const l = line(percussionVexKey(midi));
      expect(l, `midi ${midi} sits at line ${l}`).toBeGreaterThanOrEqual(0.5);
      expect(l, `midi ${midi} sits at line ${l}`).toBeLessThanOrEqual(6.5);
    }
  });

  it('puts the kick below the snare, and the hi-hat above both', () => {
    const kick = line(percussionVexKey(36));
    const snare = line(percussionVexKey(38));
    const hiHat = line(percussionVexKey(42));
    expect(kick).toBeLessThan(snare);
    expect(snare).toBeLessThan(hiHat);
  });

  it('orders the toms low to high', () => {
    const lowFloor = line(percussionVexKey(41));
    const highFloor = line(percussionVexKey(43));
    const low = line(percussionVexKey(45));
    const lowMid = line(percussionVexKey(47));
    const hiMid = line(percussionVexKey(48));
    expect(lowFloor).toBeLessThan(highFloor);
    expect(highFloor).toBeLessThan(low);
    expect(low).toBeLessThan(lowMid);
    expect(lowMid).toBeLessThan(hiMid);
  });

  it('crosses the cymbals and sticks, and leaves the drumheads plain', () => {
    for (const midi of [37, 42, 46, 49, 51, 55]) {
      expect(percussionVexKey(midi), `midi ${midi}`).toMatch(/\/(x|x3)$/);
    }
    for (const midi of [36, 38, 41, 45, 47, 48]) {
      // No notehead suffix at all: just note/octave, so VexFlow draws its default.
      expect(percussionVexKey(midi).split('/'), `midi ${midi}`).toHaveLength(2);
    }
  });

  it('distinguishes closed from open hi-hat by notehead, not position', () => {
    const closed = percussionVexKey(42);
    const open = percussionVexKey(46);
    expect(closed.split('/').slice(0, 2)).toEqual(open.split('/').slice(0, 2));
    expect(closed).not.toBe(open);
  });

  it('uses the glyphs it means, checked against VexFlow rather than assumed', () => {
    // `x` and `x2` are the same cross; `x3` is the circled cross that marks a
    // ringing cymbal; `ci` is a filled head inside a circle and means nothing
    // here. Open hi-hat was drawn with `ci` until this was checked.
    const code = (key: string) =>
      new StaveNote({ keys: [key], duration: 'q' }).getKeyProps()[0].code;
    expect(code(percussionVexKey(42))).toBe('noteheadXBlack'); // closed hi-hat
    expect(code(percussionVexKey(46))).toBe('noteheadCircleX'); // open hi-hat
    expect(code(percussionVexKey(53))).toBe('noteheadDiamondBlack'); // ride bell
    expect(code(percussionVexKey(38))).toBeUndefined(); // snare: VexFlow's default drumhead
  });

  it('marks the kick and the hi-hat pedal as played by the feet', () => {
    for (const midi of [35, 36, 44])
      expect(isFootDrum(midi), `midi ${midi}`).toBe(true);
    for (const midi of [38, 42, 46, 49, 51])
      expect(isFootDrum(midi), `midi ${midi}`).toBe(false);
  });

  it('reaches a stem into a cross notehead, in whichever direction it points', () => {
    // A stem meets a head at its edge, halfway up — solid ink on an oval, the
    // hollow middle of a cross. VexFlow stopped four units short of even that,
    // grazing the upper arm tip at a point, so the stem read as a separate mark
    // floating above the note.
    const offsets = crossHeadStemOffsets([percussionVexKey(42)]);
    expect(offsets).toEqual({
      stem_up_y_base_offset: 5,
      stem_down_y_base_offset: -5,
    });
    // Symmetric: an up-stem reaches down to the head's bottom edge, a down-stem
    // up to its top edge, so both span the glyph.
    expect(offsets!.stem_up_y_base_offset).toBe(
      -offsets!.stem_down_y_base_offset
    );
  });

  it('leaves ordinary drumheads alone, and mixed chords with them', () => {
    // A snare already meets its stem; so does a chord whose outer head might be
    // the snare rather than the hi-hat.
    expect(crossHeadStemOffsets([percussionVexKey(38)])).toBeNull();
    expect(
      crossHeadStemOffsets([percussionVexKey(36), percussionVexKey(42)])
    ).toBeNull();
    expect(crossHeadStemOffsets([])).toBeNull();
  });

  it('treats the circled cross as a cross too', () => {
    // Open hi-hat is just as hollow at the edge as the closed one.
    expect(crossHeadStemOffsets([percussionVexKey(46)])).not.toBeNull();
  });

  it('parks anything that is not General MIDI percussion on the middle line', () => {
    // Visible and obviously unplaced beats flying off the staff.
    for (const midi of [0, 34, 82, 127]) {
      expect(line(percussionVexKey(midi))).toBe(3); // B4, the middle line
    }
  });
});
