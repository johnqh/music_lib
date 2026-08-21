/**
 * Articulations were drawn and exported long before they were played. These
 * pin the resolution that made them audible, and — more importantly — the
 * three things it must not disturb.
 */
import { describe, expect, it } from 'vitest';
import {
  articulatedDuration,
  articulatedVelocity,
  articulationSound,
} from './articulation.js';

describe('articulationSound', () => {
  it('plays an unmarked note plain', () => {
    expect(articulationSound(undefined)).toEqual({
      lengthFactor: 1,
      velocityDelta: 0,
    });
  });

  it('separates length from weight across the four markings', () => {
    // The whole reason a marking resolves to two numbers: staccato is about
    // length and accent is about weight. If either collapsed into the other
    // the two would be indistinguishable.
    const staccato = articulationSound('staccato');
    const accent = articulationSound('accent');

    expect(staccato.lengthFactor).toBeLessThan(1);
    expect(staccato.velocityDelta).toBe(0);

    expect(accent.lengthFactor).toBe(1);
    expect(accent.velocityDelta).toBeGreaterThan(0);
  });

  it('makes marcato both harder and shorter than an accent', () => {
    // Which is the difference between the two markings; if marcato were only
    // louder it would just be a bigger accent.
    const accent = articulationSound('accent');
    const marcato = articulationSound('marcato');

    expect(marcato.velocityDelta).toBeGreaterThan(accent.velocityDelta);
    expect(marcato.lengthFactor).toBeLessThan(accent.lengthFactor);
  });

  it('shortens marcato less than staccato', () => {
    // Marcato is detached; staccato is *short*. Getting these the same way
    // round would make marcato the shorter of the two, which no player reads.
    expect(articulationSound('marcato').lengthFactor).toBeGreaterThan(
      articulationSound('staccato').lengthFactor
    );
  });
});

describe('articulatedVelocity', () => {
  it('leaves an unmarked note exactly as it was', () => {
    expect(articulatedVelocity(80, undefined)).toBe(80);
  });

  it('adds weight rather than setting a level', () => {
    // The doctrine dynamics established: an accent is an offset, so an accent
    // in a quiet passage is quieter than an accent in a loud one, and both are
    // louder than what is around them.
    const quiet = articulatedVelocity(40, 'accent');
    const loud = articulatedVelocity(96, 'accent');

    expect(quiet).toBeGreaterThan(40);
    expect(loud).toBeGreaterThan(96);
    expect(quiet).toBeLessThan(loud);
  });

  it('clamps to the MIDI range rather than overflowing', () => {
    expect(articulatedVelocity(127, 'marcato')).toBe(127);
    expect(articulatedVelocity(1, 'staccato')).toBe(1);
  });

  it('does not touch velocity for a length-only marking', () => {
    expect(articulatedVelocity(80, 'staccato')).toBe(80);
  });
});

describe('articulatedDuration', () => {
  it('leaves an unmarked note its full length', () => {
    expect(articulatedDuration(480, undefined)).toBe(480);
  });

  it('shortens a staccato note', () => {
    expect(articulatedDuration(480, 'staccato')).toBe(240);
  });

  it('holds a tenuto note its full written length', () => {
    // Tenuto means exactly this, and an unmarked note is already full length —
    // so the marking is audible only in its emphasis.
    expect(articulatedDuration(480, 'tenuto')).toBe(480);
    expect(articulatedVelocity(80, 'tenuto')).toBeGreaterThan(80);
  });

  it('never rounds a short note down to silence', () => {
    // A 32nd marked staccato at speed is still a note; a zero-length one
    // simply would not sound.
    expect(articulatedDuration(1, 'staccato')).toBeGreaterThanOrEqual(1);
    expect(articulatedDuration(0, 'staccato')).toBeGreaterThanOrEqual(1);
  });
});
