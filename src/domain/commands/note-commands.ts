/**
 * Note-editing command factories (spec §7, §14). Each factory returns a
 * `ScoreCommand` built via `transformCommand`, wrapping a pure
 * `(Score) => Score` transform so undo (via Immer patches) is free and
 * structurally guaranteed to be a deep-equal inverse of execute.
 *
 * Every transform here keeps measures valid: `reflowVoice` (see
 * `reflow.ts`) fills gaps with rests and trims overflow after any note is
 * added, removed, resized, or relocated, and `moveNotesCommand` splits a
 * note that crosses a measure boundary into tied segments via Task 3's
 * `splitNoteAcrossMeasures`, per the Task 5 brief.
 */
import { createId } from '../score/ids.js';
import { splitNoteAcrossMeasures } from '../score/ties.js';
import type {
  Accidental,
  Articulation,
  DurationName,
  Hairpin,
  NoteEvent,
  Ornament,
  Ottava,
  Pitch,
  Score,
  Track,
  UUID,
} from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import type { Dynamic, GraceNote, Lyric } from '@sudobility/music_types';
import { findEvent } from '../score/queries.js';
import { ticksFor } from '../time/ticks.js';
import { transposePitch } from '../pitch/transpose.js';
import type { ScoreCommand } from './types.js';
import { transformCommand } from './snapshot.js';
import {
  clearDanglingTies,
  ensureVoiceAtIndex,
  insertNoteIntoTrack,
  removeNotesFromTrack,
  reflowVoice,
  withTracks,
} from './reflow.js';

// ---- shared traversal helpers ------------------------------------------------

/**
 * Applies `updater` to every note event in `score` whose id is in
 * `eventIds`; other events pass through unchanged. Preserves referential
 * equality at every level (voice/measure/track) that has no matching
 * event, so a call that matches nothing is a true no-op (see `withTracks`).
 */
function mapNotes(
  score: Score,
  eventIds: readonly UUID[],
  updater: (note: NoteEvent) => NoteEvent
): Score {
  const idSet = new Set(eventIds);
  const tracks = score.tracks.map(track => {
    const measures = track.measures.map(measure => {
      const voices = measure.voices.map(voice => {
        if (!voice.events.some(e => idSet.has(e.id))) return voice;
        return {
          ...voice,
          events: voice.events.map(event =>
            isNoteEvent(event) && idSet.has(event.id) ? updater(event) : event
          ),
        };
      });
      const measureChanged = voices.some((v, i) => v !== measure.voices[i]);
      return measureChanged ? { ...measure, voices } : measure;
    });
    const trackChanged = measures.some((m, i) => m !== track.measures[i]);
    return trackChanged ? { ...track, measures } : track;
  });
  return withTracks(score, tracks);
}

// ---- addNoteCommand -----------------------------------------------------------

export type AddNoteParams = {
  trackId: UUID;
  measureId: UUID;
  voiceIndex: number;
  pitch: Pitch;
  startTick: number;
  durationTicks: number;
  velocity?: number;
  articulation?: Articulation;
};

function addNote(score: Score, params: AddNoteParams): Score {
  const tracks = score.tracks.map(track => {
    if (track.id !== params.trackId) return track;
    const measureExists = track.measures.some(m => m.id === params.measureId);
    if (!measureExists) return track;

    const note: NoteEvent = {
      id: createId(),
      pitch: params.pitch,
      startTick: params.startTick,
      durationTicks: params.durationTicks,
      velocity: params.velocity ?? 80,
      voiceId: '', // renumbered by insertNoteIntoTrack to the destination voice's id
      trackId: track.id,
      ...(params.articulation ? { articulation: params.articulation } : {}),
    };
    return insertNoteIntoTrack(track, note, params.voiceIndex);
  });

  return withTracks(score, tracks);
}

/**
 * Adds a new note into `params.measureId`'s voice at `params.voiceIndex`,
 * backfilling rests around it. If the new note overlaps an existing note
 * in that voice, the overlap is resolved deterministically by
 * `reflowVoice`'s "replace-on-overlap" rule (see `reflow.ts`): the new
 * note wins, trimming or dropping whatever it overlaps.
 *
 * Only inserted into `params.measureId` itself: if `startTick +
 * durationTicks` extends past that measure's end, the note is silently
 * truncated to fit (by `reflowVoice`'s measure-clipping), not split into
 * tied segments the way `moveNotesCommand`/`pasteEventsCommand` split a
 * note that crosses a boundary. This is a deliberate, narrower behavior
 * for `addNoteCommand` specifically (an add always targets one named
 * measure, unlike a move/paste's computed destination) — callers that
 * want boundary-spanning insertion should add the note measure-local and
 * then use `moveNotesCommand`/`resizeNotesCommand` if it needs to extend
 * further, or split it into per-measure `addNoteCommand` calls themselves.
 */
export function addNoteCommand(
  params: AddNoteParams,
  label: string
): ScoreCommand {
  return transformCommand(label, score => addNote(score, params));
}

// ---- deleteEventsCommand -------------------------------------------------------

function deleteEvents(score: Score, eventIds: readonly UUID[]): Score {
  const idSet = new Set(eventIds);
  // Clear tie flags left dangling on any surviving partner of a deleted
  // note *before* actually removing the notes (clearDanglingTies needs
  // the deleted notes still in place to find their chain partners).
  const detied = clearDanglingTies(score, idSet);
  const tracks = detied.tracks.map(track => removeNotesFromTrack(track, idSet));
  return withTracks(detied, tracks);
}

/**
 * Deletes the given note events, backfilling rests so every affected
 * measure stays full. If a deleted note was tied to a partner that isn't
 * also being deleted, that partner's now-dangling tie flag is cleared.
 */
export function deleteEventsCommand(
  eventIds: UUID[],
  label: string
): ScoreCommand {
  return transformCommand(label, score => deleteEvents(score, eventIds));
}

// ---- moveNotesCommand -----------------------------------------------------------

export type MoveNotesParams = { deltaTicks: number; deltaSemitones: number };

function moveNotesOnTrack(
  track: Track,
  eventIds: ReadonlySet<UUID>,
  params: MoveNotesParams
): Track {
  type Moving = { note: NoteEvent; voiceIndex: number };
  const toMove: Moving[] = [];
  track.measures.forEach(measure => {
    measure.voices.forEach((voice, voiceIndex) => {
      voice.events.forEach(event => {
        if (isNoteEvent(event) && eventIds.has(event.id))
          toMove.push({ note: event, voiceIndex });
      });
    });
  });
  if (toMove.length === 0) return track;

  let working = removeNotesFromTrack(
    track,
    new Set(toMove.map(m => m.note.id))
  );
  const boundaries = working.measures.map(m => m.startTick);
  const lastMeasure = working.measures[working.measures.length - 1];
  const trackEnd = lastMeasure
    ? lastMeasure.startTick + lastMeasure.durationTicks
    : 0;

  for (const { note, voiceIndex } of toMove) {
    const maxStart = Math.max(0, trackEnd - note.durationTicks);
    const clampedStart = Math.max(
      0,
      Math.min(note.startTick + params.deltaTicks, maxStart)
    );
    const destMeasure =
      working.measures.find(
        m =>
          clampedStart >= m.startTick &&
          clampedStart < m.startTick + m.durationTicks
      ) ?? lastMeasure;
    const newPitch =
      params.deltaSemitones !== 0
        ? transposePitch(
            note.pitch,
            params.deltaSemitones,
            destMeasure?.keySignature
          )
        : note.pitch;

    const movedNote: NoteEvent = {
      ...note,
      startTick: clampedStart,
      pitch: newPitch,
      tieStart: undefined,
      tieStop: undefined,
    };
    const segments = splitNoteAcrossMeasures(movedNote, boundaries);
    for (const segment of segments) {
      working = insertNoteIntoTrack(working, segment, voiceIndex);
    }
  }

  return working;
}

function moveNotes(
  score: Score,
  eventIds: readonly UUID[],
  params: MoveNotesParams
): Score {
  const idSet = new Set(eventIds);
  // As in deleteEvents: clear dangling tie flags on any surviving partner
  // of a moved note before moveNotesOnTrack relocates it away.
  const detied = clearDanglingTies(score, idSet);
  const tracks = detied.tracks.map(track =>
    moveNotesOnTrack(track, idSet, params)
  );
  return withTracks(detied, tracks);
}

/**
 * Moves the given notes by `deltaTicks` (clamped within their track's
 * existing tick span) and transposes them by `deltaSemitones`. A note
 * whose new position crosses a measure boundary is split into tied
 * segments (Task 3's `splitNoteAcrossMeasures`); any pre-existing tie
 * flags on the moved note are cleared first, since its former tie
 * partner(s) are no longer necessarily adjacent after the move. If a
 * moved note was tied to a partner that isn't also being moved, that
 * partner's now-dangling tie flag is cleared too.
 */
export function moveNotesCommand(
  eventIds: UUID[],
  params: MoveNotesParams,
  label: string
): ScoreCommand {
  return transformCommand(label, score => moveNotes(score, eventIds, params));
}

// ---- resizeNotesCommand / changeDurationCommand ----------------------------------

function resizeNotes(
  score: Score,
  eventIds: readonly UUID[],
  durationTicks: number
): Score {
  const idSet = new Set(eventIds);
  const tracks = score.tracks.map(track => {
    const measures = track.measures.map(measure => {
      let nextMeasure = measure;
      let changed = false;
      for (const voice of measure.voices) {
        if (!voice.events.some(e => idSet.has(e.id))) continue;
        changed = true;
        const measureEnd = measure.startTick + measure.durationTicks;
        const updatedNotes = voice.events.filter(isNoteEvent).map(e => {
          if (!idSet.has(e.id)) return e;
          const clamped = Math.max(
            1,
            Math.min(durationTicks, measureEnd - e.startTick)
          );
          return { ...e, durationTicks: clamped };
        });
        const withResized = {
          ...nextMeasure,
          voices: nextMeasure.voices.map(v =>
            v.id === voice.id ? { ...v, events: updatedNotes } : v
          ),
        };
        nextMeasure = reflowVoice(withResized, voice.id, track.id);
      }
      return changed ? nextMeasure : measure;
    });
    const trackChanged = measures.some((m, i) => m !== track.measures[i]);
    return trackChanged ? { ...track, measures } : track;
  });
  return withTracks(score, tracks);
}

/**
 * Sets the given notes' duration to `durationTicks` (a raw tick length,
 * e.g. from a piano-roll drag-resize), clamped to fit within each note's
 * current measure (no cross-measure re-splitting), then reflows.
 */
export function resizeNotesCommand(
  eventIds: UUID[],
  durationTicks: number,
  label: string
): ScoreCommand {
  return transformCommand(label, score =>
    resizeNotes(score, eventIds, durationTicks)
  );
}

/** Sets the given notes' duration to a named value (e.g. from the inspector), converted to ticks via the score's ppq. */
export function changeDurationCommand(
  eventIds: UUID[],
  duration: DurationName,
  label: string
): ScoreCommand {
  return transformCommand(label, score =>
    resizeNotes(score, eventIds, ticksFor(duration, score.ppq))
  );
}

// ---- simple per-note field commands ------------------------------------------

/** Sets the given notes' pitch to an absolute `Pitch`. */
export function changePitchCommand(
  eventIds: UUID[],
  pitch: Pitch,
  label: string
): ScoreCommand {
  return transformCommand(label, score =>
    mapNotes(score, eventIds, note => ({ ...note, pitch }))
  );
}

/** Sets the given notes' velocity (0-127). */
export function changeVelocityCommand(
  eventIds: UUID[],
  velocity: number,
  label: string
): ScoreCommand {
  return transformCommand(label, score =>
    mapNotes(score, eventIds, note => ({ ...note, velocity }))
  );
}

/** Sets (or clears, when `articulation` is `undefined`) the given notes' articulation. */
export function changeArticulationCommand(
  eventIds: UUID[],
  articulation: Articulation | undefined,
  label: string
): ScoreCommand {
  return transformCommand(label, score =>
    mapNotes(score, eventIds, note => {
      if (articulation) return { ...note, articulation };
      const updated: NoteEvent = { ...note };
      delete updated.articulation;
      return updated;
    })
  );
}

/**
 * Sets (or clears, when `ornament` is `undefined`) the given notes' ornament.
 *
 * Shaped like `changeArticulationCommand` rather than like the fermata toggle,
 * because an ornament is a choice among several rather than an on/off: a menu
 * sets the one it names, and "None" clears. A note carries at most one sign —
 * a trill that is also a turn is not a marking anybody writes.
 */
export function changeOrnamentCommand(
  eventIds: UUID[],
  ornament: Ornament | undefined,
  label: string
): ScoreCommand {
  return transformCommand(label, score =>
    mapNotes(score, eventIds, note => {
      if (ornament) return { ...note, ornament };
      const updated: NoteEvent = { ...note };
      delete updated.ornament;
      return updated;
    })
  );
}

/**
 * Puts a fermata on the given notes, or takes it off the ones that have one.
 *
 * Toggles on the *whole selection together* rather than per note: the state is
 * read from whether every selected note already carries one, so a mixed
 * selection gains fermatas rather than flipping each note independently. A
 * control that did the latter would leave a selection half-marked and look
 * broken.
 *
 * Unlike `toggleSlurCommand` this needs no endpoints and refuses nothing — a
 * fermata is a property of a single note, so one note is a perfectly good
 * selection and each marked note stands alone. Chords are marked note by note
 * because that is what the selection contains; the renderer draws one fermata
 * per notehead position, which is what a chord with a pause looks like.
 */
export function toggleFermataCommand(
  eventIds: UUID[],
  label: string
): ScoreCommand {
  return transformCommand(label, score => {
    const notes = eventIds
      .map(id => findEvent(score, id))
      .filter(
        (event): event is NoteEvent => event !== null && isNoteEvent(event)
      );
    if (notes.length === 0) return score;

    // Only remove when every selected note already has one, so a selection
    // that is partly marked becomes fully marked rather than inverting.
    const allMarked = notes.every(note => note.fermata);

    return mapNotes(score, eventIds, note => {
      if (allMarked) {
        const updated: NoteEvent = { ...note };
        delete updated.fermata;
        return updated;
      }
      return { ...note, fermata: true };
    });
  });
}

/**
 * Sets or clears the dynamic marking the given notes start.
 *
 * A dynamic is stored on the note it applies *from* and governs until the next
 * one on that track, so marking one note `f` is how a passage becomes loud —
 * there is nothing to apply to the notes in between, and applying it to each
 * would print a marking under every notehead.
 */
export function changeDynamicCommand(
  eventIds: UUID[],
  dynamic: Dynamic | undefined,
  label: string
): ScoreCommand {
  return transformCommand(label, score =>
    mapNotes(score, eventIds, note => {
      if (dynamic) return { ...note, dynamic };
      const updated: NoteEvent = { ...note };
      delete updated.dynamic;
      return updated;
    })
  );
}

/** Sets the given notes' pitch accidental, keeping their step/octave. */
export function changeAccidentalCommand(
  eventIds: UUID[],
  accidental: Accidental,
  label: string
): ScoreCommand {
  return transformCommand(label, score =>
    mapNotes(score, eventIds, note => ({
      ...note,
      pitch: { ...note.pitch, accidental },
    }))
  );
}

/** Toggles `tieStart` or `tieStop` on the given notes. */
export function toggleTieCommand(
  eventIds: UUID[],
  which: 'tieStart' | 'tieStop',
  label: string
): ScoreCommand {
  return transformCommand(label, score =>
    mapNotes(score, eventIds, note => ({ ...note, [which]: !note[which] }))
  );
}

/**
 * Slurs a selection, or removes the slur it already carries.
 *
 * Takes the whole selection rather than a flag per note, because that is what
 * a slur is: one mark over a run of notes. The caller says "slur these" and
 * this decides which of them is the start and which the stop — marking them
 * individually would let a user create a start with no stop, which draws
 * nothing and is invisible to fix.
 *
 * Endpoints are the earliest and latest note by tick, not the order the ids
 * arrived in: a selection built by shift-clicking around a phrase is still
 * that phrase.
 *
 * Fewer than two notes cannot be slurred — a phrase mark over one note means
 * nothing — and toggling off is offered when the span is already slurred, so
 * the same control removes what it made.
 */
export function toggleSlurCommand(
  eventIds: UUID[],
  label: string
): ScoreCommand {
  return transformCommand(label, score => {
    const notes = eventIds
      .map(id => findEvent(score, id))
      .filter(
        (event): event is NoteEvent => event !== null && isNoteEvent(event)
      )
      .sort((a, b) => a.startTick - b.startTick);
    if (notes.length < 2) return score;

    const first = notes[0];
    const last = notes[notes.length - 1];
    const alreadySlurred = Boolean(first.slurStart && last.slurStop);

    return mapNotes(score, eventIds, note => {
      const updated: NoteEvent = { ...note };
      delete updated.slurStart;
      delete updated.slurStop;
      if (alreadySlurred) return updated;
      if (note.id === first.id) updated.slurStart = true;
      if (note.id === last.id) updated.slurStop = true;
      return updated;
    });
  });
}

/**
 * Writes a hairpin across the selection, or removes the one it already has.
 *
 * Shaped like `toggleSlurCommand`, because a hairpin is the same kind of thing
 * — one mark over a run of notes. The caller says "crescendo these" and this
 * decides which of them opens it and which closes it; marking them one at a
 * time would let a user create an opening with no close, which draws nothing
 * and is invisible to fix.
 *
 * Endpoints are the earliest and latest note **by tick**, not the order the
 * ids arrived in, so a selection built by shift-clicking around a phrase is
 * still that phrase.
 *
 * Fewer than two notes is refused: a wedge over one note has nowhere to open
 * to. Re-applying the **same** direction to a span that already carries it
 * removes it, so one control undoes what it made; applying the **other**
 * direction flips it, which is what reaching for the other button means.
 */
export function toggleHairpinCommand(
  eventIds: UUID[],
  hairpin: Hairpin,
  label: string
): ScoreCommand {
  return transformCommand(label, score => {
    const notes = eventIds
      .map(id => findEvent(score, id))
      .filter(
        (event): event is NoteEvent => event !== null && isNoteEvent(event)
      )
      .sort((a, b) => a.startTick - b.startTick);
    if (notes.length < 2) return score;

    const first = notes[0];
    const last = notes[notes.length - 1];
    const sameAlready =
      first.hairpinStart === hairpin && Boolean(last.hairpinStop);

    return mapNotes(score, eventIds, note => {
      const updated: NoteEvent = { ...note };
      delete updated.hairpinStart;
      delete updated.hairpinStop;
      if (sameAlready) return updated;
      if (note.id === first.id) updated.hairpinStart = hairpin;
      if (note.id === last.id) updated.hairpinStop = true;
      return updated;
    });
  });
}

/**
 * Rolls the selected chords, or stops rolling them.
 *
 * Toggles the whole selection together, like the fermata: the state is read
 * from whether *every* selected note already carries the flag, so a partly
 * marked selection becomes fully marked rather than inverting note by note.
 *
 * The mark belongs to a chord, but the selection is notes — so this simply
 * sets the flag on what was selected and lets the renderer decide. A lone note
 * keeps the flag harmlessly and draws nothing, which is better than refusing:
 * selecting a bar and rolling its chords should not fail because one beat
 * happens to be a single note.
 */
export function toggleArpeggiateCommand(
  eventIds: UUID[],
  label: string
): ScoreCommand {
  return transformCommand(label, score => {
    const notes = eventIds
      .map(id => findEvent(score, id))
      .filter(
        (event): event is NoteEvent => event !== null && isNoteEvent(event)
      );
    if (notes.length === 0) return score;

    const allMarked = notes.every(note => note.arpeggiate);
    return mapNotes(score, eventIds, note => {
      if (allMarked) {
        const updated: NoteEvent = { ...note };
        delete updated.arpeggiate;
        return updated;
      }
      return { ...note, arpeggiate: true };
    });
  });
}

/**
 * Brackets the selection at an octave, or removes the bracket it has.
 *
 * A span like the hairpin: endpoints by tick, two notes minimum, the same
 * displacement twice removes it and a different one replaces it.
 */
export function toggleOttavaCommand(
  eventIds: UUID[],
  ottava: Ottava,
  label: string
): ScoreCommand {
  return transformCommand(label, score => {
    const notes = eventIds
      .map(id => findEvent(score, id))
      .filter(
        (event): event is NoteEvent => event !== null && isNoteEvent(event)
      )
      .sort((a, b) => a.startTick - b.startTick);
    if (notes.length < 2) return score;

    const first = notes[0];
    const last = notes[notes.length - 1];
    const sameAlready =
      first.ottavaStart === ottava && Boolean(last.ottavaStop);

    return mapNotes(score, eventIds, note => {
      const updated: NoteEvent = { ...note };
      delete updated.ottavaStart;
      delete updated.ottavaStop;
      if (sameAlready) return updated;
      if (note.id === first.id) updated.ottavaStart = ottava;
      if (note.id === last.id) updated.ottavaStop = true;
      return updated;
    });
  });
}

/**
 * Slides between the selected notes, or removes the slide.
 *
 * Two notes exactly is the usual case and two is the minimum: a glissando is
 * a line *between* noteheads, so one note has nothing to slide to. A wider
 * selection slides from its first note to its last, which is what dragging
 * across a run and asking for a slide means.
 */
export function toggleGlissandoCommand(
  eventIds: UUID[],
  label: string
): ScoreCommand {
  return transformCommand(label, score => {
    const notes = eventIds
      .map(id => findEvent(score, id))
      .filter(
        (event): event is NoteEvent => event !== null && isNoteEvent(event)
      )
      .sort((a, b) => a.startTick - b.startTick);
    if (notes.length < 2) return score;

    const first = notes[0];
    const last = notes[notes.length - 1];
    const already = Boolean(first.glissandoStart && last.glissandoStop);

    return mapNotes(score, eventIds, note => {
      const updated: NoteEvent = { ...note };
      delete updated.glissandoStart;
      delete updated.glissandoStop;
      if (already) return updated;
      if (note.id === first.id) updated.glissandoStart = true;
      if (note.id === last.id) updated.glissandoStop = true;
      return updated;
    });
  });
}

/**
 * Sets or clears the finger written on the given notes.
 *
 * Blank clears it rather than storing an empty string, which would reserve
 * space beside the notehead and print nothing.
 */
export function setFingeringCommand(
  eventIds: UUID[],
  fingering: string | undefined,
  label: string
): ScoreCommand {
  const trimmed = fingering?.trim();
  return transformCommand(label, score =>
    mapNotes(score, eventIds, note => {
      if (trimmed) return { ...note, fingering: trimmed };
      const updated: NoteEvent = { ...note };
      delete updated.fingering;
      return updated;
    })
  );
}

/**
 * Sets or clears the syllable sung on one note.
 *
 * One note at a time, unlike the other note commands: every syllable in a line
 * is different, so applying one across a selection could only ever write the
 * same word repeatedly.
 *
 * Blank text clears the lyric rather than storing an empty one — an empty
 * syllable would reserve space under the note and print nothing.
 */
export function setLyricCommand(
  eventId: UUID,
  lyric: Lyric | undefined,
  label: string
): ScoreCommand {
  return transformCommand(label, score =>
    mapNotes(score, [eventId], note => {
      const updated: NoteEvent = { ...note };
      if (!lyric || lyric.text.trim() === '') {
        delete updated.lyric;
        return updated;
      }
      updated.lyric = {
        text: lyric.text.trim(),
        // `single` is the default the model states, so storing it would only
        // be noise in every saved score.
        ...(lyric.syllabic && lyric.syllabic !== 'single'
          ? { syllabic: lyric.syllabic }
          : {}),
      };
      return updated;
    })
  );
}

/**
 * Sets or clears the chord symbol printed from a note.
 *
 * One note at a time, like a lyric: every chord in a progression is different,
 * so applying one across a selection could only write the same symbol
 * repeatedly. Blank text clears it rather than storing an empty symbol, which
 * would reserve space above the stave and print nothing.
 */
export function setChordSymbolCommand(
  eventId: UUID,
  symbol: string | undefined,
  label: string
): ScoreCommand {
  return transformCommand(label, score =>
    mapNotes(score, [eventId], note => {
      const updated: NoteEvent = { ...note };
      const trimmed = symbol?.trim();
      if (!trimmed) {
        delete updated.chordSymbol;
        return updated;
      }
      updated.chordSymbol = trimmed;
      return updated;
    })
  );
}

/**
 * Turns a written note into a grace note on the note that follows it.
 *
 * The note leaves the voice and reappears hanging off its neighbour, and the
 * gap it leaves is filled with a rest — so the bar still adds up, which is the
 * whole reason grace notes are stored on their principal rather than as events
 * of their own.
 *
 * The principal is the next note *in the same voice*, since that is what the
 * ornament leads into. A note with nothing after it cannot become one: an
 * ornament with nothing to ornament would simply vanish from the page.
 */
export function toGraceNoteCommand(eventId: UUID, label: string): ScoreCommand {
  return transformCommand(label, score => {
    const tracks = score.tracks.map(track => ({
      ...track,
      measures: track.measures.map(measure => ({
        ...measure,
        voices: measure.voices.map(voice => {
          const index = voice.events.findIndex(e => e.id === eventId);
          if (index === -1) return voice;

          const source = voice.events[index];
          if (!isNoteEvent(source)) return voice;

          // The principal: the next *note* after it in this voice.
          const principalIndex = voice.events.findIndex(
            (e, i) => i > index && isNoteEvent(e)
          );
          if (principalIndex === -1) return voice;
          const principal = voice.events[principalIndex] as NoteEvent;

          const grace: GraceNote = {
            pitch: source.pitch,
            durationTicks: source.durationTicks,
            slashed: true,
          };

          /*
            Ornaments the source itself carried travel with it, ahead of the
            note it becomes: turning a decorated note into a grace note should
            move the whole ornamental run to the new principal, not silently
            drop everything in front of it.
          */
          const carried: GraceNote[] = [...(source.graceNotes ?? []), grace];

          return {
            ...voice,
            events: voice.events.map((event, i) => {
              // The time the note occupied stays occupied, by a rest: an
              // ornament borrows from its principal, it does not shorten the
              // bar.
              if (i === index)
                return {
                  id: source.id,
                  startTick: source.startTick,
                  durationTicks: source.durationTicks,
                  voiceId: source.voiceId,
                  trackId: source.trackId,
                };
              if (i === principalIndex)
                return {
                  ...principal,
                  graceNotes: [...(principal.graceNotes ?? []), ...carried],
                };
              return event;
            }),
          };
        }),
      })),
    }));
    return withTracks(score, tracks);
  });
}

/** Removes every ornament from the given notes. */
export function clearGraceNotesCommand(
  eventIds: UUID[],
  label: string
): ScoreCommand {
  return transformCommand(label, score =>
    mapNotes(score, eventIds, note => {
      const updated: NoteEvent = { ...note };
      delete updated.graceNotes;
      return updated;
    })
  );
}

// ---- changeVoiceCommand -----------------------------------------------------------

function changeVoice(
  score: Score,
  eventIds: readonly UUID[],
  targetVoiceIndex: number
): Score {
  const idSet = new Set(eventIds);
  const tracks = score.tracks.map(track => {
    const measures = track.measures.map(measure => {
      const matches: NoteEvent[] = [];
      measure.voices.forEach(voice => {
        voice.events.forEach(e => {
          if (isNoteEvent(e) && idSet.has(e.id)) matches.push(e);
        });
      });
      if (matches.length === 0) return measure;

      let nextMeasure = measure;
      for (const voice of measure.voices) {
        if (!voice.events.some(e => idSet.has(e.id))) continue;
        const remaining = voice.events
          .filter(isNoteEvent)
          .filter(e => !idSet.has(e.id));
        const withRemoved = {
          ...nextMeasure,
          voices: nextMeasure.voices.map(v =>
            v.id === voice.id ? { ...v, events: remaining } : v
          ),
        };
        nextMeasure = reflowVoice(withRemoved, voice.id, track.id);
      }

      nextMeasure = ensureVoiceAtIndex(nextMeasure, targetVoiceIndex, track.id);
      const targetVoice = nextMeasure.voices[targetVoiceIndex];
      const existingNotes = targetVoice.events.filter(isNoteEvent);
      const movedNotes = matches.map(n => ({
        ...n,
        voiceId: targetVoice.id,
      }));
      nextMeasure = {
        ...nextMeasure,
        voices: nextMeasure.voices.map((v, i) =>
          i === targetVoiceIndex
            ? { ...v, events: [...existingNotes, ...movedNotes] }
            : v
        ),
      };
      return reflowVoice(nextMeasure, targetVoice.id, track.id);
    });
    const trackChanged = measures.some((m, i) => m !== track.measures[i]);
    return trackChanged ? { ...track, measures } : track;
  });
  return withTracks(score, tracks);
}

/** Moves the given notes to the voice at ordinal position `targetVoiceIndex` within their current measure (created if absent). */
export function changeVoiceCommand(
  eventIds: UUID[],
  targetVoiceIndex: number,
  label: string
): ScoreCommand {
  return transformCommand(label, score =>
    changeVoice(score, eventIds, targetVoiceIndex)
  );
}
