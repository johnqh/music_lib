/**
 * Validation issue types (spec §23). `validateScore` (`./validator.ts`)
 * returns `ValidationIssue[]`; the UI displays them and, via `objectId`/
 * `trackId`/`measureId`, navigates to the affected object on click.
 */

export type ValidationSeverity = 'error' | 'warning';

export type ValidationIssue = {
  severity: ValidationSeverity;
  code: string;
  message: string;
  objectId?: string;
  trackId?: string;
  measureId?: string;
};

/**
 * Stable, machine-readable codes for every rule `validateScore` checks.
 * Kept as a `const` object (not a string-literal union on `ValidationIssue`)
 * so new rules can be added without a breaking type change to consumers
 * that only pattern-match on known codes.
 */
export const ISSUE_CODES = {
  DUPLICATE_ID: 'duplicate-id',
  INVALID_PITCH_RANGE: 'invalid-pitch-range',
  NON_POSITIVE_DURATION: 'non-positive-duration',
  NEGATIVE_TICK: 'negative-tick',
  INVALID_VELOCITY: 'invalid-velocity',
  INVALID_MIDI_PROGRAM: 'invalid-midi-program',
  INVALID_MIDI_CHANNEL: 'invalid-midi-channel',
  INVALID_TIME_SIGNATURE: 'invalid-time-signature',
  INVALID_KEY_SIGNATURE: 'invalid-key-signature',
  MEASURE_OVERFULL: 'measure-overfull',
  MEASURE_UNDERFULL: 'measure-underfull',
  EVENT_OUTSIDE_MEASURE: 'event-outside-measure',
  MISSING_TIE_TARGET: 'missing-tie-target',
  INVALID_TRACK_REFERENCE: 'invalid-track-reference',
  INVALID_VOICE_REFERENCE: 'invalid-voice-reference',
  OVERLAPPING_SAME_PITCH: 'overlapping-same-pitch',
  TOO_MANY_SIMULTANEOUS_NOTES: 'too-many-simultaneous-notes',
  TEMPO_MAP_UNSORTED: 'tempo-map-unsorted',
  INVALID_TEMPO_BPM: 'invalid-tempo-bpm',
  MEASURE_ORDERING: 'measure-ordering',
} as const;

export type IssueCode = (typeof ISSUE_CODES)[keyof typeof ISSUE_CODES];
