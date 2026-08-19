import { describe, expect, it } from 'vitest';
import {
  UNLIMITED_POLYPHONY,
  gmMaxPolyphony,
  gmSupportsChord,
} from './gm-polyphony.js';
import { GM_INSTRUMENTS } from './gm.js';

describe('gmMaxPolyphony', () => {
  it('gives wind and brass soloists a single note', () => {
    expect(gmMaxPolyphony(56)).toBe(1); // Trumpet
    expect(gmMaxPolyphony(65)).toBe(1); // Alto Sax
    expect(gmMaxPolyphony(73)).toBe(1); // Flute
    expect(gmMaxPolyphony(71)).toBe(1); // Clarinet
  });

  it('gives bowed strings double stops', () => {
    expect(gmMaxPolyphony(40)).toBe(2); // Violin
    expect(gmMaxPolyphony(42)).toBe(2); // Cello
  });

  it('counts strings on plucked instruments', () => {
    expect(gmMaxPolyphony(24)).toBe(6); // Acoustic Guitar (nylon)
    expect(gmMaxPolyphony(33)).toBe(4); // Electric Bass (finger)
  });

  it('leaves chordal instruments unlimited', () => {
    expect(gmMaxPolyphony(0)).toBe(UNLIMITED_POLYPHONY); // Acoustic Grand Piano
    expect(gmMaxPolyphony(19)).toBe(UNLIMITED_POLYPHONY); // Church Organ
    expect(gmMaxPolyphony(11)).toBe(UNLIMITED_POLYPHONY); // Vibraphone
  });

  it('treats sections as unlimited even inside the brass family', () => {
    // 61 sits among the solo brass but is a whole section.
    expect(gmMaxPolyphony(60)).toBe(1); // French Horn
    expect(gmMaxPolyphony(61)).toBe(UNLIMITED_POLYPHONY); // Brass Section
  });

  it('exempts the chordal outliers inside the strings family', () => {
    expect(gmMaxPolyphony(46)).toBe(UNLIMITED_POLYPHONY); // Orchestral Harp
    expect(gmMaxPolyphony(47)).toBe(UNLIMITED_POLYPHONY); // Timpani
  });

  it('handles the single-line players inside the ethnic family', () => {
    expect(gmMaxPolyphony(105)).toBe(UNLIMITED_POLYPHONY); // Banjo
    expect(gmMaxPolyphony(109)).toBe(1); // Bagpipe
    expect(gmMaxPolyphony(110)).toBe(2); // Fiddle
  });

  it('leaves synths unlimited, since polyphony there is a patch setting', () => {
    expect(gmMaxPolyphony(80)).toBe(UNLIMITED_POLYPHONY); // Lead 1 (square)
    expect(gmMaxPolyphony(88)).toBe(UNLIMITED_POLYPHONY); // Pad 1 (new age)
  });

  it('gives an unknown program the benefit of the doubt', () => {
    // Blocking an edit against a guess is worse than allowing it.
    expect(gmMaxPolyphony(-1)).toBe(UNLIMITED_POLYPHONY);
    expect(gmMaxPolyphony(128)).toBe(UNLIMITED_POLYPHONY);
    expect(gmMaxPolyphony(3.5)).toBe(UNLIMITED_POLYPHONY);
  });

  it('never returns less than one for a real program', () => {
    // A zero would make every instrument unwritable.
    for (const instrument of GM_INSTRUMENTS) {
      expect(
        gmMaxPolyphony(instrument.program),
        instrument.name
      ).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('gmSupportsChord', () => {
  it('permits a single note on anything', () => {
    for (const instrument of GM_INSTRUMENTS) {
      expect(gmSupportsChord(instrument.program, 1), instrument.name).toBe(
        true
      );
    }
  });

  it('refuses a chord a trumpet could not play', () => {
    expect(gmSupportsChord(56, 2)).toBe(false);
  });

  it('permits a double stop but not a triple on a violin', () => {
    expect(gmSupportsChord(40, 2)).toBe(true);
    expect(gmSupportsChord(40, 3)).toBe(false);
  });

  it('permits a six-note guitar chord but not seven', () => {
    expect(gmSupportsChord(24, 6)).toBe(true);
    expect(gmSupportsChord(24, 7)).toBe(false);
  });
});
