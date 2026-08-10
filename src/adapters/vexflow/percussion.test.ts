import { describe, expect, it } from 'vitest';
import { StaveNote } from 'vexflow';
import { percussionVexKey } from './percussion.js';

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
      expect(l, `midi ${midi} sits at line ${l}`).toBeLessThanOrEqual(6);
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
      expect(percussionVexKey(midi), `midi ${midi}`).toMatch(/\/(x2|x3|ci)$/);
    }
    for (const midi of [36, 38, 41, 45, 47, 48]) {
      expect(percussionVexKey(midi), `midi ${midi}`).not.toMatch(/\/(x2|x3|ci|d)$/);
    }
  });

  it('distinguishes closed from open hi-hat by notehead, not position', () => {
    const closed = percussionVexKey(42);
    const open = percussionVexKey(46);
    expect(closed.split('/').slice(0, 2)).toEqual(open.split('/').slice(0, 2));
    expect(closed).not.toBe(open);
  });

  it('parks anything that is not General MIDI percussion on the middle line', () => {
    // Visible and obviously unplaced beats flying off the staff.
    for (const midi of [0, 34, 82, 127]) {
      expect(line(percussionVexKey(midi))).toBe(3); // B4, the middle line
    }
  });
});
