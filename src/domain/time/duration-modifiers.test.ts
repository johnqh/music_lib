import { describe, expect, it } from 'vitest';
import { ticksFor } from '../../index.js';
import type { DurationName } from '@sudobility/music_types';
import {
  BASE_DURATIONS,
  composeDuration,
  durationParts,
  withBase,
  withModifier,
} from '../time/duration-modifiers.js';

describe('durationParts', () => {
  it('splits a plain value', () => {
    expect(durationParts('quarter')).toEqual({
      base: 'quarter',
      modifier: 'none',
    });
  });

  it('splits a dotted value', () => {
    expect(durationParts('dotted-quarter')).toEqual({
      base: 'quarter',
      modifier: 'dotted',
    });
  });

  it('splits a triplet value', () => {
    expect(durationParts('triplet-eighth')).toEqual({
      base: 'eighth',
      modifier: 'triplet',
    });
  });

  it('round-trips every name the model has', () => {
    for (const base of BASE_DURATIONS) {
      for (const modifier of ['none', 'dotted', 'triplet'] as const) {
        const name = composeDuration({ base, modifier });
        expect(durationParts(name)).toEqual({ base, modifier });
      }
    }
  });

  it('produces names the model can actually measure', () => {
    // The real check: every composed name must resolve to a tick length.
    // A typo here would silently produce NaN ticks rather than fail loudly.
    for (const base of BASE_DURATIONS) {
      for (const modifier of ['none', 'dotted', 'triplet'] as const) {
        const name = composeDuration({ base, modifier });
        expect(Number.isFinite(ticksFor(name, 480)), name).toBe(true);
        expect(ticksFor(name, 480), name).toBeGreaterThan(0);
      }
    }
  });
});

describe('withModifier', () => {
  it('applies a dot', () => {
    expect(withModifier('quarter', 'dotted')).toBe('dotted-quarter');
  });

  it('removes the dot when it is already there', () => {
    expect(withModifier('dotted-quarter', 'dotted')).toBe('quarter');
  });

  it('replaces the other modifier rather than stacking', () => {
    // The model has no dotted triplet, so the type cannot express one and
    // neither can this. Replacing is plainer than silently picking one.
    expect(withModifier('dotted-quarter', 'triplet')).toBe('triplet-quarter');
    expect(withModifier('triplet-quarter', 'dotted')).toBe('dotted-quarter');
  });
});

describe('withBase', () => {
  it('keeps the modifier when the note value changes', () => {
    expect(withBase('dotted-quarter', 'eighth')).toBe('dotted-eighth');
    expect(withBase('triplet-half', 'sixteenth')).toBe('triplet-sixteenth');
  });

  it('leaves a plain value plain', () => {
    expect(withBase('quarter', 'half')).toBe('half');
  });
});

describe('the durations are actually different lengths', () => {
  it('a dotted note is half again as long', () => {
    expect(ticksFor('dotted-quarter' as DurationName, 480)).toBe(720);
  });

  it('a triplet is two thirds as long', () => {
    expect(ticksFor('triplet-quarter' as DurationName, 480)).toBe(320);
  });
});
