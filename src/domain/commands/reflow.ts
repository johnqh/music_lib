/**
 * Shared low-level, pure Measure/Track mutation helpers used by the note-
 * and structure-editing command factories (Task 5 brief). Every function
 * here returns new objects; none mutate their inputs.
 */
import { createId } from '../score/ids';
import { findEvent } from '../score/queries';
import { tieChainFor } from '../score/ties';
import type { Measure, MusicalEvent, NoteEvent, Score, ScoreMetadata, Track, UUID } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { pitchToMidi } from '../pitch/pitch';

/** Returns `metadata` with `updatedAt` refreshed to now. */
export function touchMetadata(metadata: ScoreMetadata): ScoreMetadata {
  return { ...metadata, updatedAt: new Date().toISOString() };
}

/**
 * Returns `{ ...score, tracks }` with `metadata.updatedAt` refreshed, but
 * only if `tracks` actually differs from `score.tracks` (checked
 * per-element by reference — every helper in this module returns an
 * unchanged track/measure/voice by reference when it made no edit, so this
 * is an exact "did anything really change" test). A true no-op command
 * (e.g. deleting an id that doesn't exist) therefore returns `score`
 * itself, not just a structurally-equal copy with a bumped timestamp.
 */
export function withTracks(score: Score, tracks: Track[]): Score {
  const changed = tracks.length !== score.tracks.length || tracks.some((t, i) => t !== score.tracks[i]);
  return changed ? { ...score, tracks, metadata: touchMetadata(score.metadata) } : score;
}

/**
 * Clears the matching tie flag on the immediate tie-chain partner(s) of
 * every note in `eventIds` that is *not itself* also in `eventIds` — so a
 * note about to be moved or deleted never leaves a dangling `tieStart`/
 * `tieStop` on a partner left behind. Must be called on `score` *before*
 * the notes in `eventIds` are actually removed/relocated, since it relies
 * on `tieChainFor`'s search of the note's current position; the notes in
 * `eventIds` themselves are expected to have their own tie flags cleared
 * separately by the caller (they're leaving their old position entirely).
 * Returns `score` unchanged (referentially) if nothing needed clearing.
 */
export function clearDanglingTies(score: Score, eventIds: ReadonlySet<UUID>): Score {
  const clears = new Map<UUID, { clearTieStart?: boolean; clearTieStop?: boolean }>();

  for (const id of eventIds) {
    const note = findEvent(score, id);
    if (!note || !isNoteEvent(note) || (!note.tieStart && !note.tieStop)) continue;

    const chain = tieChainFor(score, id);
    const index = chain.findIndex((n) => n.id === id);
    if (index === -1) continue;

    if (note.tieStop && index > 0) {
      const partner = chain[index - 1];
      if (!eventIds.has(partner.id)) {
        clears.set(partner.id, { ...clears.get(partner.id), clearTieStart: true });
      }
    }
    if (note.tieStart && index < chain.length - 1) {
      const partner = chain[index + 1];
      if (!eventIds.has(partner.id)) {
        clears.set(partner.id, { ...clears.get(partner.id), clearTieStop: true });
      }
    }
  }

  if (clears.size === 0) return score;

  const tracks = score.tracks.map((track) => {
    const measures = track.measures.map((measure) => {
      const voices = measure.voices.map((voice) => {
        const events = voice.events.map((event) => {
          const clear = clears.get(event.id);
          if (!clear || !isNoteEvent(event)) return event;
          const updated: NoteEvent = { ...event };
          if (clear.clearTieStart) delete updated.tieStart;
          if (clear.clearTieStop) delete updated.tieStop;
          return updated;
        });
        const changed = events.some((e, i) => e !== voice.events[i]);
        return changed ? { ...voice, events } : voice;
      });
      const changed = voices.some((v, i) => v !== measure.voices[i]);
      return changed ? { ...measure, voices } : measure;
    });
    const changed = measures.some((m, i) => m !== track.measures[i]);
    return changed ? { ...track, measures } : track;
  });

  return withTracks(score, tracks);
}

type Interval = { start: number; end: number };

/** `target` minus every interval in `claimed` (assumed pairwise disjoint), as the remaining disjoint pieces. */
function subtractIntervals(target: Interval, claimed: readonly Interval[]): Interval[] {
  let pieces: Interval[] = [target];
  for (const c of claimed) {
    const next: Interval[] = [];
    for (const p of pieces) {
      if (c.end <= p.start || c.start >= p.end) {
        next.push(p); // no overlap with this claimed interval
        continue;
      }
      if (c.start > p.start) next.push({ start: p.start, end: Math.min(c.start, p.end) });
      if (c.end < p.end) next.push({ start: Math.max(c.end, p.start), end: p.end });
    }
    pieces = next.filter((iv) => iv.end > iv.start);
  }
  return pieces;
}

/** The longest of `pieces` (ties broken by earliest start), or `null` for an empty list. */
function largestPiece(pieces: readonly Interval[]): Interval | null {
  return pieces.reduce<Interval | null>((best, p) => {
    if (!best) return p;
    const bestLen = best.end - best.start;
    const pLen = p.end - p.start;
    if (pLen > bestLen || (pLen === bestLen && p.start < best.start)) return p;
    return best;
  }, null);
}

/**
 * Within notes that all share one identical span (a same-span cluster —
 * see `resolveOverlaps`), keeps only the last (highest original-array-
 * index) note per pitch (compared by MIDI, so enharmonic respellings of
 * the same physical pitch also dedupe), dropping earlier same-pitch
 * duplicates. Different-pitch notes at the identical span are unaffected
 * and all survive — that's the real, legitimate chord case. This exists
 * because "same span" alone isn't sufficient to call two notes a chord:
 * two *same-pitch* notes at the identical span are a genuine duplicate/
 * conflicting edit (e.g. a note dropped exactly onto an existing note of
 * the same pitch), and `validateScore`'s `checkOverlappingSamePitch`
 * correctly flags that as an error — silently keeping both would produce
 * an invalid score.
 */
function dedupeSamePitch(notes: readonly NoteEvent[]): NoteEvent[] {
  const byMidi = new Map<number, NoteEvent>();
  for (const note of notes) {
    // A later entry for the same pitch overwrites an earlier one, so the
    // last (highest-priority) note of that pitch wins — consistent with
    // resolveOverlaps's documented last-in-array-wins rule.
    byMidi.set(pitchToMidi(note.pitch), note);
  }
  return [...byMidi.values()];
}

/**
 * Resolves overlapping notes within one voice's note list into a set of
 * pairwise-disjoint placements (chords aside — see below), deterministically:
 *
 * - Notes sharing the *exact* same `(startTick, durationTicks)` are
 *   candidate chord members (per `allocateVoices`'s `groupChordClusters`/
 *   spec §25). Among same-span notes, only *different-pitch* ones form a
 *   real chord and all survive; same-pitch duplicates at that span are
 *   deduped down to the last one (see `dedupeSamePitch`) rather than kept
 *   as "overlapping."
 * - Between genuinely different spans that overlap, **last-in-array
 *   wins**: every command in this module that inserts/moves/resizes a
 *   note builds its voice's event list as `[...existingNotes, editedOrNewNote]`,
 *   so "last" always means "the note this edit just touched." The
 *   winning note keeps its full span; whatever it overlaps is trimmed
 *   down to its own remaining (non-overlapping) piece, or dropped
 *   entirely if fully covered. If trimming would leave a note with two
 *   disjoint remaining pieces (a higher-priority note punched a hole in
 *   its middle), only the longer piece survives — a note can't be split
 *   into two fragments by this step (Task 3's `splitNoteAcrossMeasures`
 *   is the tool for genuine multi-segment splitting, at measure
 *   boundaries; mid-note deletion-by-overlap is a deliberately simpler,
 *   documented edge case here).
 *
 * This is "replace-on-overlap" by design: it's what lets a piano-roll
 * drag/insert land a new note and have it take precedence over whatever
 * it's dropped onto, matching common DAW behavior, while still keeping
 * `reflowVoice`'s output well-formed (no silently-overlapping, no
 * silently-duplicate-pitch notes).
 */
function resolveOverlaps(originalNotes: readonly NoteEvent[]): NoteEvent[] {
  type Cluster = { startTick: number; durationTicks: number; notes: NoteEvent[]; priority: number };
  const clusters = new Map<string, Cluster>();

  originalNotes.forEach((note, priority) => {
    const key = `${note.startTick}:${note.durationTicks}`;
    const existing = clusters.get(key);
    if (existing) {
      existing.notes.push(note);
      existing.priority = Math.max(existing.priority, priority);
    } else {
      clusters.set(key, { startTick: note.startTick, durationTicks: note.durationTicks, notes: [note], priority });
    }
  });

  const orderedByPriorityDesc = [...clusters.values()].sort((a, b) => b.priority - a.priority);
  const claimed: Interval[] = [];
  const placed: NoteEvent[] = [];

  for (const cluster of orderedByPriorityDesc) {
    const target: Interval = { start: cluster.startTick, end: cluster.startTick + cluster.durationTicks };
    const chosen = largestPiece(subtractIntervals(target, claimed));
    if (!chosen) continue; // fully covered by a higher-priority note/chord; drop this cluster entirely

    const survivors = dedupeSamePitch(cluster.notes);
    for (const note of survivors) {
      placed.push({ ...note, startTick: chosen.start, durationTicks: chosen.end - chosen.start });
    }
    claimed.push(chosen);
  }

  return placed;
}

/**
 * Rebuilds the voice at `voiceId` within `measure` so its note content is
 * exactly what was already there — minus overlap resolution (see
 * `resolveOverlaps`) — but gap-filled with fresh rests and trimmed to fit
 * the measure: notes are grouped into non-overlapping (chord-aware)
 * placements, clipped to the measure's span, and any silent gap
 * between/after them (up to the measure's end) is filled with a new
 * `RestEvent`. Existing `RestEvent`s are discarded and regenerated from
 * scratch. Returns `measure` unchanged (referentially) if it has no voice
 * with `voiceId`.
 *
 * `trackId` is taken as an explicit parameter (rather than read off an
 * existing event) so this still works when the voice's note content is
 * completely empty (e.g. after deleting every note in it).
 */
export function reflowVoice(measure: Measure, voiceId: UUID, trackId: UUID): Measure {
  const voiceIndex = measure.voices.findIndex((v) => v.id === voiceId);
  if (voiceIndex === -1) return measure;
  const voice = measure.voices[voiceIndex];

  const measureStart = measure.startTick;
  const measureEnd = measure.startTick + measure.durationTicks;

  const originalNotes = voice.events.filter(isNoteEvent);
  const resolved = resolveOverlaps(originalNotes);

  // Re-group the (now pairwise-disjoint, chords aside) resolved notes by
  // their final span, so chord siblings are emitted together without a
  // spurious rest/cursor-advance between them.
  type Group = { startTick: number; durationTicks: number; notes: NoteEvent[] };
  const groupsByKey = new Map<string, Group>();
  for (const note of resolved) {
    const key = `${note.startTick}:${note.durationTicks}`;
    const group = groupsByKey.get(key);
    if (group) group.notes.push(note);
    else groupsByKey.set(key, { startTick: note.startTick, durationTicks: note.durationTicks, notes: [note] });
  }
  const groups = [...groupsByKey.values()].sort((a, b) => a.startTick - b.startTick);

  const events: MusicalEvent[] = [];
  let cursor = measureStart;

  for (const group of groups) {
    const start = Math.max(group.startTick, cursor, measureStart);
    const end = Math.min(group.startTick + group.durationTicks, measureEnd);
    if (end <= start) continue;

    if (start > cursor) {
      events.push({ id: createId(), startTick: cursor, durationTicks: start - cursor, voiceId, trackId });
    }
    for (const note of group.notes) {
      events.push({ ...note, startTick: start, durationTicks: end - start, voiceId, trackId });
    }
    cursor = end;
  }

  if (cursor < measureEnd) {
    events.push({ id: createId(), startTick: cursor, durationTicks: measureEnd - cursor, voiceId, trackId });
  }

  const voices = measure.voices.map((v, i) => (i === voiceIndex ? { ...v, events } : v));
  return { ...measure, voices };
}

/**
 * Returns `measure` with a voice guaranteed to exist at ordinal position
 * `voiceIndex` in `measure.voices` (per the Task 3 voice-identity
 * convention: voices correlate across measures by ordinal index, not id).
 * Missing intermediate voices (and `voiceIndex` itself, if absent) are
 * created as fresh, fully-rested voices. Returns `measure` unchanged
 * (referentially) if a voice already exists at that index.
 */
export function ensureVoiceAtIndex(measure: Measure, voiceIndex: number, trackId: UUID): Measure {
  if (measure.voices[voiceIndex]) return measure;

  const voices = measure.voices.slice();
  while (voices.length <= voiceIndex) {
    const voiceId = createId();
    voices.push({
      id: voiceId,
      name: `Voice ${voices.length + 1}`,
      events: [
        {
          id: createId(),
          startTick: measure.startTick,
          durationTicks: measure.durationTicks,
          voiceId,
          trackId,
        },
      ],
    });
  }
  return { ...measure, voices };
}

/**
 * Removes every note event whose id is in `eventIds` from `track`,
 * reflowing (rest-backfilling) each voice that actually lost a note.
 * Measures/voices with nothing removed are returned unchanged
 * (referentially), so unaffected structure is preserved.
 */
export function removeNotesFromTrack(track: Track, eventIds: ReadonlySet<UUID>): Track {
  const measures = track.measures.map((measure) => {
    let nextMeasure = measure;
    let changed = false;

    for (const voice of measure.voices) {
      if (!voice.events.some((e) => eventIds.has(e.id))) continue;
      changed = true;
      const remainingNotes = voice.events.filter(isNoteEvent).filter((e) => !eventIds.has(e.id));
      const withRemoved = {
        ...nextMeasure,
        voices: nextMeasure.voices.map((v) => (v.id === voice.id ? { ...v, events: remainingNotes } : v)),
      };
      nextMeasure = reflowVoice(withRemoved, voice.id, track.id);
    }

    return changed ? nextMeasure : measure;
  });

  const trackChanged = measures.some((m, i) => m !== track.measures[i]);
  return trackChanged ? { ...track, measures } : track;
}

/**
 * Inserts `note` into `track` at the measure whose span contains
 * `note.startTick`, in the voice at ordinal position `voiceIndex`
 * (created if necessary via `ensureVoiceAtIndex`), then reflows that
 * voice. `note` is expected to already fit entirely within one measure's
 * span (the caller — e.g. a note-move that crosses a measure boundary —
 * is responsible for splitting it first, per Task 3's
 * `splitNoteAcrossMeasures`). If no measure contains `note.startTick`,
 * `track` is returned unchanged.
 */
export function insertNoteIntoTrack(track: Track, note: NoteEvent, voiceIndex: number): Track {
  const measures = track.measures.map((measure) => {
    if (note.startTick < measure.startTick || note.startTick >= measure.startTick + measure.durationTicks) {
      return measure;
    }

    const ensured = ensureVoiceAtIndex(measure, voiceIndex, track.id);
    const voice = ensured.voices[voiceIndex];
    const existingNotes = voice.events.filter(isNoteEvent);
    const withInserted = {
      ...ensured,
      voices: ensured.voices.map((v, i) =>
        i === voiceIndex
          ? { ...v, events: [...existingNotes, { ...note, voiceId: v.id, trackId: track.id }] }
          : v,
      ),
    };
    return reflowVoice(withInserted, voice.id, track.id);
  });

  const trackChanged = measures.some((m, i) => m !== track.measures[i]);
  return trackChanged ? { ...track, measures } : track;
}
