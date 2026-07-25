/**
 * Natural-language prompt parsing for the generation panel (spec §11,
 * §21, §32): extracts key/tempo/meter/style/mood hints from a free-text
 * prompt so `MockGenerationProvider.generateScore` can honor prompts like
 * "Create a cinematic sixteen-measure theme in D minor" even when the
 * caller didn't also set the corresponding structured `GenerateScoreRequest`
 * fields. Any hint the request already sets explicitly takes precedence
 * (see mock-provider.ts) — this module only ever *suggests* values.
 */
import type { Accidental, KeySignature, PitchStep, TimeSignature } from '@sudobility/music_types';
import { pitchToMidi } from '../../domain/pitch/pitch.js';
import { keySignatureForTonicPitchClass } from './music-theory.js';

export type PromptHints = {
  keySignature?: KeySignature;
  timeSignature?: TimeSignature;
  tempo?: number;
  style?: string;
  mood?: string;
};

/**
 * Recognizes a key name in one of three ways, tried in order, none of
 * which lets the English article "a"/"A" (as in "Create **a** minor
 * pentatonic riff") masquerade as the pitch letter A:
 *
 * 1. An explicit "in <key>" context cue (e.g. "in a minor", "in C major",
 *    "in Db major") — case-insensitive, since "in" itself is the
 *    disambiguating cue, not the letter's case.
 * 2. A bare, case-sensitive **uppercase** letter (e.g. "C major", "Db
 *    major" — the accidental token may still be lowercase "b"/"#") with no
 *    "in" needed.
 * 3. A bare **lowercase** letter, but only when an accidental token is
 *    also present (e.g. "db major") — an unaccompanied lowercase letter
 *    ("a minor") is exactly the shape of the "a"/"an" article problem, so
 *    it's only accepted with an explicit "in" (pattern 1) or an accidental
 *    that a stray article could never carry.
 */
const KEY_NAME_WITH_CONTEXT_PATTERN = /\bin\s+([A-Ga-g])(#|b)?\s+(major|minor)\b/i;
const KEY_NAME_BARE_UPPERCASE_PATTERN = /\b([A-G])(#|b)?\s+(major|minor)\b/;
const KEY_NAME_BARE_LOWERCASE_WITH_ACCIDENTAL_PATTERN = /\b([a-g])(#|b)\s+(major|minor)\b/;

/** Recognizes an explicit meter like "3/4" or "6 / 8". */
const METER_PATTERN = /\b(\d{1,2})\s*\/\s*(\d{1,2})\b/;

/** Recognizes an explicit tempo like "120 bpm" or "96bpm". */
const TEMPO_PATTERN = /\b(\d{2,3})\s*bpm\b/i;

const STYLES = ['waltz', 'jazz', 'pop', 'cinematic', 'ambient', 'battle'];
const MOODS = ['gentle', 'dark', 'upbeat', 'dramatic', 'calm', 'energetic'];

/** Converts a regex-captured note-name + accidental into a `KeySignature` for the given mode. */
function keySignatureFromNoteName(letter: string, accidentalToken: string | undefined, mode: 'major' | 'minor'): KeySignature {
  const step = letter.toUpperCase() as PitchStep;
  const accidental: Accidental = accidentalToken === '#' ? 1 : accidentalToken === 'b' ? -1 : 0;
  const pitchClass = (((pitchToMidi({ step, accidental, octave: 4 }) - 60) % 12) + 12) % 12;
  return keySignatureForTonicPitchClass(pitchClass, mode);
}

/**
 * Extracts whatever key/tempo/meter/style/mood hints can be recognized in
 * `prompt`'s free text. Fields with no match are omitted (never guessed).
 *
 * Deliberately does **not** support a "mode without a tonic" hint (e.g.
 * treating a bare "minor" in "Create a minor pentatonic riff" as "some
 * unspecified minor key"): a tonic-less key signature isn't representable
 * by `KeySignature`, and guessing a default tonic would be indistinguishable
 * from the article/pitch-letter ambiguity this function is careful to avoid
 * elsewhere. Such a prompt simply yields no `keySignature` hint.
 */
export function parsePrompt(prompt: string): PromptHints {
  const hints: PromptHints = {};
  const lower = prompt.toLowerCase();

  const keyMatch =
    KEY_NAME_WITH_CONTEXT_PATTERN.exec(prompt) ??
    KEY_NAME_BARE_UPPERCASE_PATTERN.exec(prompt) ??
    KEY_NAME_BARE_LOWERCASE_WITH_ACCIDENTAL_PATTERN.exec(prompt);
  if (keyMatch) {
    const mode = keyMatch[3].toLowerCase() === 'minor' ? 'minor' : 'major';
    hints.keySignature = keySignatureFromNoteName(keyMatch[1], keyMatch[2], mode);
  }

  const meterMatch = METER_PATTERN.exec(prompt);
  if (meterMatch) {
    hints.timeSignature = { numerator: Number(meterMatch[1]), denominator: Number(meterMatch[2]) };
  }

  const tempoMatch = TEMPO_PATTERN.exec(prompt);
  if (tempoMatch) {
    hints.tempo = Number(tempoMatch[1]);
  }

  const style = STYLES.find((s) => lower.includes(s));
  if (style) hints.style = style;

  const mood = MOODS.find((m) => lower.includes(m));
  if (mood) hints.mood = mood;

  return hints;
}
