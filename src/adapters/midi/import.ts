/**
 * Standard MIDI File -> `Score` import (spec §15). `@tonejs/midi` is the
 * designated MIDI library (spec §15) and its use here is a sanctioned
 * exception to the adapters/services "no non-domain library" purity rule.
 *
 * MIDI stores performance timing, not notation semantics — this import is
 * necessarily an approximation (quantization, voice allocation, clef/staff
 * assignment, and key estimation are all best-effort heuristics), which is
 * why every result carries a `warnings` array the caller/wizard is expected
 * to surface (spec §15: "Do not claim MIDI import perfectly reconstructs
 * notation").
 */
import type { MidiCodec, MidiFile, MidiTrackData as SourceMidiTrack } from '@sudobility/music_types';
import { detectKeySignature } from './key-detection.js';
import { assembleTrackMeasures, buildMeasureSpans } from './measures.js';
import type { TimeSignatureChange } from './measures.js';
import type { MidiImportOptions } from './import-options.js';
import { midiToPitch, pitchToMidi } from '../../domain/pitch/pitch.js';
import { createId } from '../../domain/score/ids.js';
import type { KeySignature, NoteEvent, Score, TempoEvent, Track } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import type { QuantizeOptions } from '../../domain/quantization/options.js';
import { quantizeEvents } from '../../domain/quantization/quantize.js';
import { ticksFor } from '../../domain/time/ticks.js';
import { allocateVoices } from '../../domain/voicing/allocate.js';

/** The score model's fixed internal PPQ (spec §4/§15: every import is normalized to 480). */
const SCORE_PPQ = 480;
const DEFAULT_TEMPO_BPM = 120;
const MIN_BPM = 20;
const MAX_BPM = 400;
const MAX_VELOCITY = 127;
const SUSTAIN_CC_NUMBER = 64;
const SUSTAIN_DOWN_THRESHOLD = 0.5;
/** Max simultaneous notated voices `allocateVoices` may open per staff. */
const DEFAULT_MAX_VOICES = 4;
const DEFAULT_KEY_SIGNATURE: KeySignature = { fifths: 0, mode: 'major' };
const PERCUSSION_CHANNEL = 9;
/**
 * Onsets of the same pitch within this many ticks of each other are treated
 * as accidental duplicate triggers (not a deliberate ornament/grace note) by
 * `mergeNearDuplicates`. Deliberately independent of `quantizeGrid` — this
 * is about performance-timing noise, not the notation grid — roughly a
 * 128th note at 480 ppq (half of `import-options.ts`'s default
 * `minDurationTicks`, a 64th note, since a near-duplicate this close is
 * almost always well inside whatever floor is configured).
 */
const NEAR_DUPLICATE_TOLERANCE_TICKS = 15;

const ALWAYS_WARNING =
  'MIDI import approximates performance timing as notation: quantization, voice/staff assignment, and key detection are best-effort. Review the result before use.';

// ---- Tempo / time signature -----------------------------------------------

function buildTempoMap(sourceTempos: Array<{ ticks: number; bpm: number }>, ratio: number, warnings: string[]): TempoEvent[] {
  const converted = sourceTempos
    .map((t) => ({ tick: Math.round(t.ticks * ratio), bpm: t.bpm }))
    .sort((a, b) => a.tick - b.tick);
  const withOrigin = converted.length > 0 && converted[0].tick === 0 ? converted : [{ tick: 0, bpm: DEFAULT_TEMPO_BPM }, ...converted];

  return withOrigin.map((t) => {
    const bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, t.bpm));
    if (bpm !== t.bpm) {
      warnings.push(
        `Tempo event at tick ${t.tick} (${t.bpm.toFixed(1)} bpm) was outside the supported ${MIN_BPM}-${MAX_BPM} bpm range and was clamped to ${bpm} bpm.`,
      );
    }
    return { id: createId(), tick: t.tick, bpm };
  });
}

function convertTimeSignatures(
  sourceTimeSignatures: Array<{ ticks: number; timeSignature: number[] }>,
  ratio: number,
): TimeSignatureChange[] {
  return sourceTimeSignatures.map((t) => ({
    tick: Math.round(t.ticks * ratio),
    timeSignature: { numerator: t.timeSignature[0], denominator: t.timeSignature[1] },
  }));
}

// ---- Sustain pedal ----------------------------------------------------------

type Interval = { start: number; end: number };

/** Pedal-down `[start, end)` intervals (target ticks) from a track's CC64 events; an unreleased pedal closes at `trackEndTick`. */
function sustainIntervals(sourceTrack: SourceMidiTrack, ratio: number, trackEndTick: number): Interval[] {
  const events = [...(sourceTrack.controlChanges[SUSTAIN_CC_NUMBER] ?? [])].sort((a, b) => a.ticks - b.ticks);
  const intervals: Interval[] = [];
  let downStart: number | null = null;

  for (const event of events) {
    const tick = Math.round(event.ticks * ratio);
    const down = event.value >= SUSTAIN_DOWN_THRESHOLD;
    if (down && downStart === null) {
      downStart = tick;
    } else if (!down && downStart !== null) {
      intervals.push({ start: downStart, end: tick });
      downStart = null;
    }
  }
  if (downStart !== null) intervals.push({ start: downStart, end: trackEndTick });

  return intervals;
}

/** Extends `rawEnd` to the release tick of whichever pedal-down interval it falls inside, if any. */
function extendThroughSustain(rawEnd: number, intervals: Interval[]): number {
  for (const interval of intervals) {
    if (rawEnd >= interval.start && rawEnd < interval.end) return interval.end;
  }
  return rawEnd;
}

// ---- Raw note extraction -----------------------------------------------------

type RawNote = { midi: number; startTick: number; durationTicks: number; velocity: number };

/**
 * Converts a source track's notes to target-tick `RawNote`s, optionally
 * extending each note's end through a sustain-pedal-down interval it falls
 * in (`sustainPedal: "extend"`). A same-pitch note's sustain extension is
 * then clamped so it never overlaps the *next* onset of that same pitch
 * (extending into a genuinely different pitch is fine and expected — that's
 * exactly what a pedal is for).
 */
function extractRawNotes(sourceTrack: SourceMidiTrack, ratio: number, sustainPedal: MidiImportOptions['sustainPedal']): RawNote[] {
  const trackEndTick = Math.round(sourceTrack.durationTicks * ratio);
  const intervals = sustainPedal === 'extend' ? sustainIntervals(sourceTrack, ratio, trackEndTick) : [];

  const spans = sourceTrack.notes.map((note) => {
    const startTick = Math.round(note.ticks * ratio);
    const rawEnd = Math.round((note.ticks + note.durationTicks) * ratio);
    const endTick = intervals.length > 0 ? extendThroughSustain(rawEnd, intervals) : rawEnd;
    return { midi: note.midi, startTick, endTick, velocity: note.velocity };
  });

  const byPitch = new Map<number, typeof spans>();
  for (const span of spans) {
    const bucket = byPitch.get(span.midi);
    if (bucket) bucket.push(span);
    else byPitch.set(span.midi, [span]);
  }
  for (const bucket of byPitch.values()) {
    bucket.sort((a, b) => a.startTick - b.startTick);
    for (let i = 0; i < bucket.length - 1; i += 1) {
      if (bucket[i].endTick > bucket[i + 1].startTick) {
        bucket[i].endTick = bucket[i + 1].startTick;
      }
    }
  }

  return spans.map((span) => ({
    midi: span.midi,
    startTick: span.startTick,
    durationTicks: Math.max(1, span.endTick - span.startTick),
    velocity: Math.min(MAX_VELOCITY, Math.max(0, Math.round(span.velocity * MAX_VELOCITY))),
  }));
}

// ---- Quantization -------------------------------------------------------------

/** Grid unit in ticks for `options.quantizeGrid`, or `1` (a no-op grid) when quantization is off. */
function gridTicksFor(options: MidiImportOptions): number {
  return options.quantizeGrid !== null ? ticksFor(options.quantizeGrid, SCORE_PPQ) : 1;
}

/**
 * Merges runs of same-pitch onsets within `toleranceTicks` of each other
 * into a single note (earliest start, spanning to the latest end, keeping
 * the louder velocity) — genuine accidental-duplicate-trigger cleanup, not
 * just onset repositioning (contrast `quantizeEvents`' `chordToleranceTicks`,
 * which only snaps near-simultaneous onsets onto a shared tick and is
 * meant for *chords*, i.e. different pitches — it never reduces note
 * count, so it can't by itself implement "merge near-duplicate notes").
 * Only ever compares notes of the *same* pitch, so legitimate chords
 * (different pitches, same or near onset) are never affected. Returns the
 * merged notes (sorted by `startTick`) and how many source notes were
 * folded into another (i.e. `input.length - notes.length`).
 */
/** Folds `next` into `base`: keeps `base`'s start, extends to cover both spans, keeps the louder velocity. */
function mergeInto(base: NoteEvent, next: NoteEvent): NoteEvent {
  const end = Math.max(base.startTick + base.durationTicks, next.startTick + next.durationTicks);
  return { ...base, durationTicks: end - base.startTick, velocity: Math.max(base.velocity, next.velocity) };
}

function mergeNearDuplicateNotes(notes: NoteEvent[], toleranceTicks: number): { notes: NoteEvent[]; mergedCount: number } {
  const byPitch = new Map<number, NoteEvent[]>();
  for (const note of notes) {
    const midi = pitchToMidi(note.pitch);
    const bucket = byPitch.get(midi);
    if (bucket) bucket.push(note);
    else byPitch.set(midi, [note]);
  }

  const kept: NoteEvent[] = [];
  let mergedCount = 0;

  for (const bucket of byPitch.values()) {
    const sorted = [...bucket].sort((a, b) => a.startTick - b.startTick);
    let current: NoteEvent | null = null;
    for (const note of sorted) {
      if (current !== null && note.startTick - current.startTick <= toleranceTicks) {
        current = mergeInto(current, note);
        mergedCount += 1;
      } else {
        if (current) kept.push(current);
        current = note;
      }
    }
    if (current) kept.push(current);
  }

  kept.sort((a, b) => a.startTick - b.startTick);
  return { notes: kept, mergedCount };
}

/** Number of `after` notes whose `durationTicks` differs from the `before` note sharing its id (i.e. was trimmed by overlap resolution). Ids not present in `before` (there are none, by construction) would not count. */
function countDurationChanges(before: NoteEvent[], after: NoteEvent[]): number {
  const beforeById = new Map(before.map((n) => [n.id, n]));
  let count = 0;
  for (const note of after) {
    const prior = beforeById.get(note.id);
    if (prior && prior.durationTicks !== note.durationTicks) count += 1;
  }
  return count;
}

// ---- Prepared per-selection data ----------------------------------------------

type PreparedSelection = {
  selection: MidiImportOptions['trackSelections'][number];
  sourceTrack: SourceMidiTrack;
  notes: NoteEvent[];
};

type PrepareStageCounts = { droppedShort: number; mergedDuplicates: number; trimmedOverlaps: number };

type PreparedNotes = { notes: NoteEvent[] } & PrepareStageCounts;

/**
 * Turns a selection's raw notes into cleaned-up `NoteEvent`s per `options`,
 * as three explicit, independently-measured stages so each cause of a note
 * being dropped/merged/trimmed can be reported accurately (rather than one
 * combined before/after count blamed entirely on `minDurationTicks`,
 * regardless of which stage actually changed anything):
 *
 * 1. Drop notes shorter than `minDurationTicks` + snap starts/durations to
 *    the quantization grid (`quantizeGrid`/`tripletDetection`). Only this
 *    stage can remove notes, so any count delta here is `droppedShort`.
 * 2. Merge near-duplicate same-pitch onsets (`mergeNearDuplicates`) via
 *    `mergeNearDuplicateNotes`. Any count delta here is `mergedDuplicates`.
 * 3. Resolve residual overlaps (always on) by trimming an overlapping
 *    note's duration down to the next note's start — this never changes
 *    note *count* (durations are floored at 1 tick, never dropped), so it's
 *    measured as `trimmedOverlaps`: how many notes had their duration
 *    shortened.
 */
function prepareSelectionNotes(raw: RawNote[], tempTrackId: string, options: MidiImportOptions): PreparedNotes {
  const initialEvents: NoteEvent[] = raw.map((n) => ({
    id: createId(),
    pitch: midiToPitch(n.midi),
    startTick: n.startTick,
    durationTicks: n.durationTicks,
    velocity: n.velocity,
    voiceId: 'import',
    trackId: tempTrackId,
  }));

  const quantizing = options.quantizeGrid !== null;
  const grid = gridTicksFor(options);
  const snapQuantizeOptions: QuantizeOptions = {
    grid,
    quantizeStarts: quantizing,
    quantizeDurations: quantizing,
    tripletGrid: quantizing && options.tripletDetection,
    minDurationTicks: options.minDurationTicks,
  };
  const snapped = quantizeEvents(initialEvents, snapQuantizeOptions).filter(isNoteEvent);
  const droppedShort = initialEvents.length - snapped.length;

  const { notes: deduped, mergedCount: mergedDuplicates } = options.mergeNearDuplicates
    ? mergeNearDuplicateNotes(snapped, NEAR_DUPLICATE_TOLERANCE_TICKS)
    : { notes: snapped, mergedCount: 0 };

  const overlapQuantizeOptions: QuantizeOptions = { grid: 1, quantizeStarts: false, quantizeDurations: false, resolveOverlaps: true };
  const resolved = quantizeEvents(deduped, overlapQuantizeOptions).filter(isNoteEvent);
  const trimmedOverlaps = countDurationChanges(deduped, resolved);

  return { notes: resolved, droppedShort, mergedDuplicates, trimmedOverlaps };
}

// ---- Track assembly -------------------------------------------------------------

function trackVolume(sourceTrack: SourceMidiTrack): number {
  const cc = sourceTrack.controlChanges[7]?.[0];
  return cc ? cc.value : 1;
}

function trackPan(sourceTrack: SourceMidiTrack): number {
  const cc = sourceTrack.controlChanges[10]?.[0];
  return cc ? cc.value * 2 - 1 : 0;
}

function buildSingleTrack(
  prepared: PreparedSelection,
  spans: ReturnType<typeof buildMeasureSpans>,
  keySignature: KeySignature,
): Track {
  const trackId = createId();
  const groups = allocateVoices(prepared.notes, { maxVoices: DEFAULT_MAX_VOICES, splitPoint: Number.NEGATIVE_INFINITY });
  const lanes = groups.map((g) => g.notes);
  const measures = assembleTrackMeasures(lanes, spans, keySignature, trackId);
  const clef = prepared.selection.clef;

  return {
    id: trackId,
    name: prepared.selection.name,
    instrumentName: prepared.sourceTrack.instrument.name || 'Instrument',
    midiProgram: prepared.sourceTrack.instrument.number,
    midiChannel: clef === 'percussion' ? PERCUSSION_CHANNEL : Math.min(15, Math.max(0, prepared.sourceTrack.channel)),
    clef,
    volume: trackVolume(prepared.sourceTrack),
    pan: trackPan(prepared.sourceTrack),
    muted: false,
    solo: false,
    measures,
  };
}

/** Splits `prepared` into two linked grand-staff tracks ("Piano RH" upper/treble, "Piano LH" lower/bass) at `options.splitPointMidi`. */
function buildSplitTracks(
  prepared: PreparedSelection,
  spans: ReturnType<typeof buildMeasureSpans>,
  keySignature: KeySignature,
  splitPointMidi: number,
): Track[] {
  const groups = allocateVoices(prepared.notes, { maxVoices: DEFAULT_MAX_VOICES, splitPoint: splitPointMidi });
  const upperLanes = groups.filter((g) => g.staff === 'upper').map((g) => g.notes);
  const lowerLanes = groups.filter((g) => g.staff === 'lower').map((g) => g.notes);

  const rhId = createId();
  const lhId = createId();
  const shared = {
    instrumentName: prepared.sourceTrack.instrument.name || 'Instrument',
    midiProgram: prepared.sourceTrack.instrument.number,
    midiChannel: Math.min(15, Math.max(0, prepared.sourceTrack.channel)),
    volume: trackVolume(prepared.sourceTrack),
    pan: trackPan(prepared.sourceTrack),
    muted: false,
    solo: false,
  };

  return [
    {
      id: rhId,
      name: 'Piano RH',
      clef: 'treble',
      ...shared,
      measures: assembleTrackMeasures(upperLanes, spans, keySignature, rhId),
    },
    {
      id: lhId,
      name: 'Piano LH',
      clef: 'bass',
      ...shared,
      measures: assembleTrackMeasures(lowerLanes, spans, keySignature, lhId),
    },
  ];
}

// ---- Entry point ------------------------------------------------------------

export type MidiImportResult = { score: Score; warnings: string[] };

/**
 * Imports a Standard MIDI File as a `Score` (spec §15): converts note times
 * to 480-ppq score ticks, imports the tempo map and time signatures,
 * applies sustain-pedal extension, Task 4 quantization (grid/triplet/
 * minimum-duration/near-duplicate merging), key estimation and enharmonic
 * respelling, Task 4 voice allocation, optional piano grand-staff split,
 * and measure generation (notes split across measure boundaries with
 * ties) — per track selected in `options.trackSelections`. Always returns a
 * `warnings` array (never throws for merely-imperfect input); the caller is
 * expected to surface it before the import is committed (spec §15: MIDI
 * import must be reviewable, and one undoable operation once committed).
 */
/**
 * Converts an already-decoded MIDI file into a `Score`.
 *
 * Split out from `importMidi` so the heavy work — quantization and voice
 * allocation — can be handed to a worker without the worker needing a codec.
 * `MidiFile` is plain data and therefore structured-cloneable; a `MidiCodec` is
 * not, and giving the worker one would make music_lib depend on music_io.
 */
export function importMidiFile(midi: MidiFile, options: MidiImportOptions): MidiImportResult {
  const warnings: string[] = [ALWAYS_WARNING];
  const ratio = SCORE_PPQ / midi.header.ppq;

  const tempoMap = buildTempoMap(midi.header.tempos, ratio, warnings);
  const timeSignatureChanges = convertTimeSignatures(midi.header.timeSignatures, ratio);

  const preparedSelections: PreparedSelection[] = [];
  for (const selection of options.trackSelections) {
    if (!selection.include) continue;
    const sourceTrack = midi.tracks[selection.sourceIndex];
    if (!sourceTrack) {
      warnings.push(`Track selection references source track ${selection.sourceIndex}, which doesn't exist in this file; it was skipped.`);
      continue;
    }

    const raw = extractRawNotes(sourceTrack, ratio, options.sustainPedal);
    const prepared = prepareSelectionNotes(raw, `import-${selection.sourceIndex}`, options);
    if (prepared.droppedShort > 0) {
      warnings.push(`Track "${selection.name}": dropped ${prepared.droppedShort} note(s) shorter than ${options.minDurationTicks} ticks.`);
    }
    if (prepared.mergedDuplicates > 0) {
      warnings.push(`Track "${selection.name}": merged ${prepared.mergedDuplicates} near-duplicate note(s).`);
    }
    if (prepared.trimmedOverlaps > 0) {
      warnings.push(`Track "${selection.name}": trimmed ${prepared.trimmedOverlaps} overlapping note(s) to resolve timing conflicts.`);
    }

    preparedSelections.push({ selection, sourceTrack, notes: prepared.notes });
  }

  if (preparedSelections.length === 0) {
    warnings.push('No tracks were selected for import; the imported score has no tracks.');
  }

  const allNotes = preparedSelections.flatMap((p) => p.notes);
  const keySignature = options.detectKey ? detectKeySignature(allNotes) : DEFAULT_KEY_SIGNATURE;
  const respelledSelections = preparedSelections.map((p) => ({
    ...p,
    notes: p.notes.map((n) => ({ ...n, pitch: midiToPitch(pitchToMidi(n.pitch), keySignature) })),
  }));

  const endTick = respelledSelections.reduce((max, p) => {
    const localMax = p.notes.reduce((m, n) => Math.max(m, n.startTick + n.durationTicks), 0);
    return Math.max(max, localMax);
  }, 0);
  const spans = buildMeasureSpans(timeSignatureChanges, SCORE_PPQ, endTick);

  const tracks: Track[] = respelledSelections.flatMap((prepared) =>
    options.pianoStaffSplit
      ? buildSplitTracks(prepared, spans, keySignature, options.splitPointMidi)
      : [buildSingleTrack(prepared, spans, keySignature)],
  );

  const now = new Date().toISOString();
  const score: Score = {
    id: createId(),
    version: 1,
    ppq: SCORE_PPQ,
    metadata: {
      // The neutral model makes `name` optional, since not every Standard MIDI
      // File carries one; @tonejs/midi papered over that with an empty string.
      title: (midi.header.name ?? '').trim().length > 0 ? midi.header.name!.trim() : 'Imported MIDI',
      createdAt: now,
      updatedAt: now,
    },
    tempoMap,
    tracks,
  };

  return { score, warnings };
}

/** Decodes `data` and imports it. The codec is the only platform-bound part. */
export function importMidi(
  data: ArrayBuffer,
  options: MidiImportOptions,
  codec: MidiCodec,
): MidiImportResult {
  return importMidiFile(codec.decode(data), options);
}
