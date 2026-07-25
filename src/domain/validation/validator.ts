/**
 * Score-validation engine (spec §23). `validateScore` checks a `Score`
 * against every rule in the Task 4 brief and returns `ValidationIssue[]`
 * (empty when the score is fully consistent). Pure and read-only: never
 * mutates its input.
 */
import type { Measure, Pitch, Score, Track, Voice } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { pitchToMidi } from '../pitch/pitch';
import { voiceChannel } from '../score/ties';
import type { ChannelCandidate } from '../score/ties';
import { ISSUE_CODES } from './issues';
import type { ValidationIssue } from './issues';

const MIN_MIDI = 0;
const MAX_MIDI = 127;
const MIN_VELOCITY = 0;
const MAX_VELOCITY = 127;
const MIN_MIDI_PROGRAM = 0;
const MAX_MIDI_PROGRAM = 127;
const MIN_MIDI_CHANNEL = 0;
const MAX_MIDI_CHANNEL = 15;
const VALID_TIME_SIG_DENOMINATORS = new Set([1, 2, 4, 8, 16, 32]);
const MIN_FIFTHS = -7;
const MAX_FIFTHS = 7;
const MIN_BPM = 20;
const MAX_BPM = 400;

/**
 * Maximum number of notes sounding at once (within a single track) before a
 * "too many simultaneous notes" readability warning fires. Spec §23 names
 * this rule but doesn't give a number; 10 is a deliberate implementer
 * default (roughly as many notes as a two-hand piano voicing on one staff
 * can render legibly), documented here so a later task can make it
 * configurable if that turns out to be too strict/loose in practice.
 */
const MAX_SIMULTANEOUS_NOTES = 10;

function samePitch(a: Pitch, b: Pitch): boolean {
  return a.step === b.step && a.accidental === b.accidental && a.octave === b.octave;
}

function issue(
  severity: ValidationIssue['severity'],
  code: string,
  message: string,
  extra?: Partial<Pick<ValidationIssue, 'objectId' | 'trackId' | 'measureId'>>,
): ValidationIssue {
  return { severity, code, message, ...extra };
}

// ---- Whole-score: tempo map, unique ids -----------------------------------

/** Tempo-map tick validity/ordering and bpm range (20-400). */
function checkTempoMap(score: Score): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let lastTick = -Infinity;

  for (const event of score.tempoMap) {
    if (event.tick < 0) {
      issues.push(
        issue(
          'error',
          ISSUE_CODES.NEGATIVE_TICK,
          `Tempo event ${event.id} has a negative tick (${event.tick}).`,
          {
            objectId: event.id,
          },
        ),
      );
    }
    if (event.tick < lastTick) {
      issues.push(
        issue(
          'error',
          ISSUE_CODES.TEMPO_MAP_UNSORTED,
          `Tempo map is not sorted by tick at event ${event.id} (tick ${event.tick} follows tick ${lastTick}).`,
          { objectId: event.id },
        ),
      );
    }
    lastTick = event.tick;

    if (event.bpm < MIN_BPM || event.bpm > MAX_BPM) {
      issues.push(
        issue(
          'error',
          ISSUE_CODES.INVALID_TEMPO_BPM,
          `Tempo event ${event.id} has bpm ${event.bpm}, expected ${MIN_BPM}-${MAX_BPM}.`,
          { objectId: event.id },
        ),
      );
    }
  }

  return issues;
}

/** Every id in the score (score/tempo/track/measure/voice/event) must be unique. */
function checkUniqueIds(score: Score): ValidationIssue[] {
  const counts = new Map<string, number>();
  const record = (id: string): void => {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  };

  record(score.id);
  for (const tempoEvent of score.tempoMap) record(tempoEvent.id);
  for (const track of score.tracks) {
    record(track.id);
    for (const measure of track.measures) {
      record(measure.id);
      for (const voice of measure.voices) {
        record(voice.id);
        for (const event of voice.events) record(event.id);
      }
    }
  }

  const issues: ValidationIssue[] = [];
  for (const [id, count] of counts) {
    if (count > 1) {
      issues.push(
        issue(
          'error',
          ISSUE_CODES.DUPLICATE_ID,
          `Id "${id}" is used ${count} times; ids must be unique.`,
          {
            objectId: id,
          },
        ),
      );
    }
  }
  return issues;
}

// ---- Track-level ------------------------------------------------------------

/** midiProgram (0-127) and midiChannel (0-15) range checks. */
function checkTrack(track: Track): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (track.midiProgram < MIN_MIDI_PROGRAM || track.midiProgram > MAX_MIDI_PROGRAM) {
    issues.push(
      issue(
        'error',
        ISSUE_CODES.INVALID_MIDI_PROGRAM,
        `Track "${track.name}" has midiProgram ${track.midiProgram}, expected ${MIN_MIDI_PROGRAM}-${MAX_MIDI_PROGRAM}.`,
        { objectId: track.id, trackId: track.id },
      ),
    );
  }
  if (track.midiChannel < MIN_MIDI_CHANNEL || track.midiChannel > MAX_MIDI_CHANNEL) {
    issues.push(
      issue(
        'error',
        ISSUE_CODES.INVALID_MIDI_CHANNEL,
        `Track "${track.name}" has midiChannel ${track.midiChannel}, expected ${MIN_MIDI_CHANNEL}-${MAX_MIDI_CHANNEL}.`,
        { objectId: track.id, trackId: track.id },
      ),
    );
  }

  return issues;
}

/**
 * A track's measures must be contiguous and sequentially indexed: measure
 * at array position `i` must have `index === i` and `startTick` equal to
 * the previous measure's `startTick + durationTicks` (0 for the first).
 * Checked against each measure's *actual* preceding measure (not a
 * recomputed ideal), so one bad measure doesn't cascade a flood of
 * downstream false positives.
 */
function checkMeasureOrdering(track: Track): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let expectedStart = 0;

  track.measures.forEach((measure, position) => {
    if (measure.index !== position) {
      issues.push(
        issue(
          'error',
          ISSUE_CODES.MEASURE_ORDERING,
          `Measure at position ${position} of track "${track.name}" has index ${measure.index}, expected ${position}.`,
          { objectId: measure.id, trackId: track.id, measureId: measure.id },
        ),
      );
    }
    if (measure.startTick !== expectedStart) {
      issues.push(
        issue(
          'error',
          ISSUE_CODES.MEASURE_ORDERING,
          `Measure ${measure.index} of track "${track.name}" starts at tick ${measure.startTick}, expected ${expectedStart} (immediately after the previous measure).`,
          { objectId: measure.id, trackId: track.id, measureId: measure.id },
        ),
      );
    }
    expectedStart = measure.startTick + measure.durationTicks;
  });

  return issues;
}

/**
 * Sweep-line max concurrent NoteEvent count across the whole track (all
 * measures/voices). Note-off is treated as occurring strictly before a
 * note-on at the same tick, so back-to-back (non-overlapping) notes don't
 * count as simultaneous.
 */
function checkTooManySimultaneousNotes(track: Track): ValidationIssue[] {
  const points: Array<{ tick: number; delta: 1 | -1 }> = [];
  for (const measure of track.measures) {
    for (const voice of measure.voices) {
      for (const event of voice.events) {
        if (!isNoteEvent(event)) continue;
        points.push({ tick: event.startTick, delta: 1 });
        points.push({ tick: event.startTick + event.durationTicks, delta: -1 });
      }
    }
  }
  points.sort((a, b) => a.tick - b.tick || a.delta - b.delta);

  let current = 0;
  let max = 0;
  for (const point of points) {
    current += point.delta;
    max = Math.max(max, current);
  }

  if (max > MAX_SIMULTANEOUS_NOTES) {
    return [
      issue(
        'warning',
        ISSUE_CODES.TOO_MANY_SIMULTANEOUS_NOTES,
        `Track "${track.name}" has up to ${max} notes sounding simultaneously (readability threshold ${MAX_SIMULTANEOUS_NOTES}).`,
        { trackId: track.id },
      ),
    ];
  }
  return [];
}

// ---- Measure-level ------------------------------------------------------------

/** Time signature (numerator >= 1, denominator in {1,2,4,8,16,32}) and key signature (fifths -7..7). */
function checkMeasureSignatures(track: Track, measure: Measure): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { timeSignature, keySignature } = measure;

  if (timeSignature.numerator < 1 || !VALID_TIME_SIG_DENOMINATORS.has(timeSignature.denominator)) {
    issues.push(
      issue(
        'error',
        ISSUE_CODES.INVALID_TIME_SIGNATURE,
        `Measure ${measure.index} has invalid time signature ${timeSignature.numerator}/${timeSignature.denominator} (numerator must be >= 1; denominator must be one of 1, 2, 4, 8, 16, 32).`,
        { objectId: measure.id, trackId: track.id, measureId: measure.id },
      ),
    );
  }
  if (keySignature.fifths < MIN_FIFTHS || keySignature.fifths > MAX_FIFTHS) {
    issues.push(
      issue(
        'error',
        ISSUE_CODES.INVALID_KEY_SIGNATURE,
        `Measure ${measure.index} has key signature fifths=${keySignature.fifths}, expected ${MIN_FIFTHS}..${MAX_FIFTHS}.`,
        { objectId: measure.id, trackId: track.id, measureId: measure.id },
      ),
    );
  }

  return issues;
}

/** Same-pitch overlap (error) within one voice's note events. Different-pitch overlaps (chords/independent lines) are out of scope for this rule. */
function checkOverlappingSamePitch(
  track: Track,
  measure: Measure,
  voice: Voice,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const notes = voice.events.filter(isNoteEvent);

  for (let i = 0; i < notes.length; i += 1) {
    for (let j = i + 1; j < notes.length; j += 1) {
      const a = notes[i];
      const b = notes[j];
      const overlaps =
        a.startTick < b.startTick + b.durationTicks && b.startTick < a.startTick + a.durationTicks;
      if (overlaps && samePitch(a.pitch, b.pitch)) {
        issues.push(
          issue(
            'error',
            ISSUE_CODES.OVERLAPPING_SAME_PITCH,
            `Notes ${a.id} and ${b.id} in voice "${voice.name}" (measure ${measure.index}) overlap in time at the same pitch.`,
            { objectId: b.id, trackId: track.id, measureId: measure.id },
          ),
        );
      }
    }
  }

  return issues;
}

/**
 * Total *covered* ticks of a voice's events, merging overlapping/touching
 * spans into disjoint intervals before summing their lengths. A plain
 * "sum every event's durationTicks" would double-count block chords
 * (multiple `NoteEvent`s deliberately sharing one startTick/duration, as
 * built by `fixtures.ts`'s `buildChordMeasures`/spec §25 voice allocation)
 * as if they were sequential content several times the measure's length.
 * Merging first means a chord (or any simultaneous/overlapping content)
 * counts once, at its own span, matching how the notated timeline actually
 * reads.
 */
function coveredTicks(events: Array<{ startTick: number; durationTicks: number }>): number {
  const spans = events
    .map((e) => ({ start: e.startTick, end: e.startTick + e.durationTicks }))
    .sort((a, b) => a.start - b.start);

  let total = 0;
  let i = 0;
  while (i < spans.length) {
    let end = spans[i].end;
    let j = i + 1;
    while (j < spans.length && spans[j].start <= end) {
      end = Math.max(end, spans[j].end);
      j += 1;
    }
    total += end - spans[i].start;
    i = j;
  }
  return total;
}

/**
 * Per-voice checks within a measure: positive duration, nonnegative
 * startTick, containment within the measure, valid track/voice references,
 * note-only velocity/pitch-range checks, same-pitch overlap, and the
 * voice's covered-ticks total vs. the measure's duration (error if it
 * covers more, warning if less).
 */
function checkVoice(track: Track, measure: Measure, voice: Voice): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const event of voice.events) {
    if (event.durationTicks <= 0) {
      issues.push(
        issue(
          'error',
          ISSUE_CODES.NON_POSITIVE_DURATION,
          `Event ${event.id} has non-positive durationTicks (${event.durationTicks}).`,
          { objectId: event.id, trackId: track.id, measureId: measure.id },
        ),
      );
    }
    if (event.startTick < 0) {
      issues.push(
        issue(
          'error',
          ISSUE_CODES.NEGATIVE_TICK,
          `Event ${event.id} has a negative startTick (${event.startTick}).`,
          {
            objectId: event.id,
            trackId: track.id,
            measureId: measure.id,
          },
        ),
      );
    }
    if (
      event.startTick < measure.startTick ||
      event.startTick + event.durationTicks > measure.startTick + measure.durationTicks
    ) {
      issues.push(
        issue(
          'error',
          ISSUE_CODES.EVENT_OUTSIDE_MEASURE,
          `Event ${event.id} [${event.startTick}, ${event.startTick + event.durationTicks}) falls outside measure ${measure.index}'s span [${measure.startTick}, ${measure.startTick + measure.durationTicks}).`,
          { objectId: event.id, trackId: track.id, measureId: measure.id },
        ),
      );
    }
    if (event.trackId !== track.id) {
      issues.push(
        issue(
          'error',
          ISSUE_CODES.INVALID_TRACK_REFERENCE,
          `Event ${event.id} references trackId "${event.trackId}" but lives on track "${track.id}".`,
          { objectId: event.id, trackId: track.id, measureId: measure.id },
        ),
      );
    }
    if (event.voiceId !== voice.id) {
      issues.push(
        issue(
          'error',
          ISSUE_CODES.INVALID_VOICE_REFERENCE,
          `Event ${event.id} references voiceId "${event.voiceId}" but lives in voice "${voice.id}".`,
          { objectId: event.id, trackId: track.id, measureId: measure.id },
        ),
      );
    }

    if (isNoteEvent(event)) {
      if (event.velocity < MIN_VELOCITY || event.velocity > MAX_VELOCITY) {
        issues.push(
          issue(
            'error',
            ISSUE_CODES.INVALID_VELOCITY,
            `Note ${event.id} has velocity ${event.velocity}, expected ${MIN_VELOCITY}-${MAX_VELOCITY}.`,
            { objectId: event.id, trackId: track.id, measureId: measure.id },
          ),
        );
      }
      const midi = pitchToMidi(event.pitch);
      if (midi < MIN_MIDI || midi > MAX_MIDI) {
        issues.push(
          issue(
            'error',
            ISSUE_CODES.INVALID_PITCH_RANGE,
            `Note ${event.id} has pitch MIDI ${midi}, expected ${MIN_MIDI}-${MAX_MIDI}.`,
            { objectId: event.id, trackId: track.id, measureId: measure.id },
          ),
        );
      }
    }
  }

  const covered = coveredTicks(voice.events);
  if (covered > measure.durationTicks) {
    issues.push(
      issue(
        'error',
        ISSUE_CODES.MEASURE_OVERFULL,
        `Voice "${voice.name}" in measure ${measure.index} covers ${covered} ticks, exceeding the measure's ${measure.durationTicks}.`,
        { objectId: voice.id, trackId: track.id, measureId: measure.id },
      ),
    );
  } else if (covered < measure.durationTicks) {
    issues.push(
      issue(
        'warning',
        ISSUE_CODES.MEASURE_UNDERFULL,
        `Voice "${voice.name}" in measure ${measure.index} covers ${covered} ticks, short of the measure's ${measure.durationTicks}.`,
        { objectId: voice.id, trackId: track.id, measureId: measure.id },
      ),
    );
  }

  issues.push(...checkOverlappingSamePitch(track, measure, voice));

  return issues;
}

// ---- Ties (whole-score, since a tie may cross a measure boundary) ---------

/** The most voices any single measure of `track` has (so every voice-ordinal channel is covered). */
function trackVoiceCount(track: Track): number {
  return track.measures.reduce((max, measure) => Math.max(max, measure.voices.length), 0);
}

/**
 * The first candidate in `index.get(tick)` (if any) that isn't `excludeId`
 * itself, carries `requireFlag`, and shares `pitch` — the same (tick,
 * pitch, tie-flag) matching `domain/score/ties.ts`'s `findForwardPartner`/
 * `findBackwardPartner` use, just against a prebuilt index instead of a
 * fresh linear scan.
 */
function findIndexedPartner(
  index: Map<number, ChannelCandidate[]>,
  tick: number,
  excludeId: string,
  pitch: Pitch,
  requireFlag: (candidate: ChannelCandidate) => boolean,
): ChannelCandidate | undefined {
  const candidates = index.get(tick);
  if (!candidates) return undefined;
  return candidates.find((c) => c.event.id !== excludeId && requireFlag(c) && samePitch(c.event.pitch, pitch));
}

/**
 * A tieStart note must have a matching tieStop note at the next position
 * (same track/voice-channel, immediately following tick, same pitch) —
 * warning otherwise. Symmetrically, a tieStop note must have a matching
 * tieStart note immediately preceding it.
 *
 * Originally implemented via `tieChainFor` per tied note, which — for a
 * track with many tied notes — rebuilds its voice-ordinal channel
 * (`voiceChainFor`'s `locateVoiceIndex` + `voiceChannel`, each O(track
 * size)) from scratch on *every* call and walks the full backward/forward
 * chain by linear-scanning the channel at each hop: O(n) work per tied
 * note, O(n^2) worst case across a track with O(n) tied notes (flagged in
 * the Task 4 ledger as a risk against spec §29's 20k-note target).
 *
 * This only ever needs to know whether *one specific* note has a forward/
 * backward partner (not the whole chain), so it builds each track/voice-
 * ordinal channel exactly once via `voiceChannel` (same shared convention
 * `tieChainFor` uses — see its doc comment), then indexes that channel by
 * start tick and by end tick (`startTick + durationTicks`) for O(1)-average
 * partner lookups. Net cost: O(n) per track instead of O(n^2). Matching
 * semantics (same "does a same-pitch, correctly-tie-flagged event exist
 * at the adjoining tick, within this voice-ordinal channel" question) are
 * identical to the previous `tieChainFor`-based check, so the exact same
 * set of issues is produced — see `checkTieTargets`'s tests, which cover
 * both directions.
 */
function checkTieTargets(score: Score): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const track of score.tracks) {
    const voiceCount = trackVoiceCount(track);

    for (let voiceIndex = 0; voiceIndex < voiceCount; voiceIndex += 1) {
      const channel = voiceChannel(track, voiceIndex);
      if (channel.length === 0) continue;

      const byStartTick = new Map<number, ChannelCandidate[]>();
      const byEndTick = new Map<number, ChannelCandidate[]>();
      for (const candidate of channel) {
        const start = candidate.event.startTick;
        const end = start + candidate.event.durationTicks;
        const startBucket = byStartTick.get(start);
        if (startBucket) startBucket.push(candidate);
        else byStartTick.set(start, [candidate]);
        const endBucket = byEndTick.get(end);
        if (endBucket) endBucket.push(candidate);
        else byEndTick.set(end, [candidate]);
      }

      for (const { event, measureIndex } of channel) {
        if (!event.tieStart && !event.tieStop) continue;
        const measureId = track.measures[measureIndex]?.id;

        if (event.tieStart) {
          const targetTick = event.startTick + event.durationTicks;
          const partner = findIndexedPartner(byStartTick, targetTick, event.id, event.pitch, (c) =>
            Boolean(c.event.tieStop),
          );
          if (!partner) {
            issues.push(
              issue(
                'warning',
                ISSUE_CODES.MISSING_TIE_TARGET,
                `Note ${event.id} has tieStart but no matching tieStop note at the next position with the same pitch.`,
                { objectId: event.id, trackId: track.id, measureId },
              ),
            );
          }
        }
        if (event.tieStop) {
          const partner = findIndexedPartner(byEndTick, event.startTick, event.id, event.pitch, (c) =>
            Boolean(c.event.tieStart),
          );
          if (!partner) {
            issues.push(
              issue(
                'warning',
                ISSUE_CODES.MISSING_TIE_TARGET,
                `Note ${event.id} has tieStop but no matching tieStart note ending at its start tick with the same pitch.`,
                { objectId: event.id, trackId: track.id, measureId },
              ),
            );
          }
        }
      }
    }
  }

  return issues;
}

// ---- Entry point ------------------------------------------------------------

/** Validates a `Score` against every rule in spec §23 (Task 4 brief scope). Read-only; never mutates `score`. */
export function validateScore(score: Score): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  issues.push(...checkUniqueIds(score));
  issues.push(...checkTempoMap(score));

  for (const track of score.tracks) {
    issues.push(...checkTrack(track));
    issues.push(...checkMeasureOrdering(track));
    issues.push(...checkTooManySimultaneousNotes(track));

    for (const measure of track.measures) {
      issues.push(...checkMeasureSignatures(track, measure));
      for (const voice of measure.voices) {
        issues.push(...checkVoice(track, measure, voice));
      }
    }
  }

  issues.push(...checkTieTargets(score));

  return issues;
}
