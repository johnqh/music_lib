import { describe, expect, it } from 'vitest';
import { keyTonicPitchClass } from './music-theory.js';
import { parsePrompt } from './prompt-parse.js';

describe('parsePrompt', () => {
  it('recognizes a major key name', () => {
    const hints = parsePrompt('Create a gentle eight-measure piano melody in C major');
    expect(hints.keySignature).toEqual({ fifths: 0, mode: 'major' });
    expect(hints.mood).toBe('gentle');
  });

  it('recognizes a minor key name', () => {
    const hints = parsePrompt('Create a cinematic sixteen-measure theme in D minor');
    expect(hints.keySignature?.mode).toBe('minor');
    expect(keyTonicPitchClass(hints.keySignature!)).toBe(2); // D
    expect(hints.style).toBe('cinematic');
  });

  it('recognizes a sharp key name', () => {
    const hints = parsePrompt('A piece in F# minor');
    expect(hints.keySignature?.mode).toBe('minor');
    expect(keyTonicPitchClass(hints.keySignature!)).toBe(6); // F#
  });

  it('recognizes a flat key name', () => {
    const hints = parsePrompt('A piece in Bb major');
    expect(keyTonicPitchClass(hints.keySignature!)).toBe(10); // Bb
  });

  it('recognizes an explicit meter', () => {
    const hints = parsePrompt('Create a playful waltz in 3/4 time');
    expect(hints.timeSignature).toEqual({ numerator: 3, denominator: 4 });
    expect(hints.style).toBe('waltz');
  });

  it('recognizes an explicit tempo', () => {
    const hints = parsePrompt('A driving piece at 128 bpm');
    expect(hints.tempo).toBe(128);
  });

  it('recognizes each style keyword', () => {
    for (const style of ['waltz', 'jazz', 'pop', 'cinematic', 'ambient', 'battle']) {
      expect(parsePrompt(`Create a ${style} piece`).style).toBe(style);
    }
  });

  it('recognizes each mood keyword', () => {
    for (const mood of ['gentle', 'dark', 'upbeat', 'dramatic', 'calm', 'energetic']) {
      expect(parsePrompt(`Create a ${mood} piece`).mood).toBe(mood);
    }
  });

  it('recognizes an energetic video-game battle theme prompt', () => {
    const hints = parsePrompt('Create an energetic video-game battle theme');
    expect(hints.style).toBe('battle');
    expect(hints.mood).toBe('energetic');
  });

  it('omits fields with no match, without guessing', () => {
    const hints = parsePrompt('Create a simple beginner melody using quarter and half notes');
    expect(hints.keySignature).toBeUndefined();
    expect(hints.timeSignature).toBeUndefined();
    expect(hints.tempo).toBeUndefined();
    expect(hints.style).toBeUndefined();
    expect(hints.mood).toBeUndefined();
  });

  it('is case-insensitive for style/mood/key matching', () => {
    const hints = parsePrompt('CREATE A JAZZ PIECE IN c MAJOR');
    expect(hints.style).toBe('jazz');
    expect(hints.keySignature).toEqual({ fifths: 0, mode: 'major' });
  });

  describe('does not mistake the article "a"/"an" for the pitch letter A (regression)', () => {
    it('"Create a minor pentatonic riff" detects no key signature', () => {
      const hints = parsePrompt('Create a minor pentatonic riff');
      expect(hints.keySignature).toBeUndefined();
    });

    it('"a minor" scale/chord phrasing elsewhere in a prompt also detects no key signature', () => {
      expect(parsePrompt('Write a minor blues lick').keySignature).toBeUndefined();
      expect(parsePrompt('Give me a major scale exercise').keySignature).toBeUndefined();
    });

    it('an explicit "in <key>" context cue still parses correctly, including a lowercase bare letter', () => {
      expect(parsePrompt('Create a piece in a minor').keySignature).toEqual({ fifths: 0, mode: 'minor' }); // A minor
      expect(parsePrompt('Create a piece in C major').keySignature).toEqual({ fifths: 0, mode: 'major' });
    });

    it('a bare uppercase key name (no "in") still parses correctly', () => {
      expect(parsePrompt('Db major, four measures').keySignature).toBeDefined();
      expect(keyTonicPitchClass(parsePrompt('Db major, four measures').keySignature!)).toBe(1); // Db
      expect(parsePrompt('C major scale study').keySignature).toEqual({ fifths: 0, mode: 'major' });
    });
  });
});
