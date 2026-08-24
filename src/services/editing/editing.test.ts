import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testStoreContext } from '../../test/store-context.js';
import { createAppStore } from '../../store/useAppStore.js';
import {
  stressScore,
  twinkleScore,
  twoTrackScore,
} from '../../test/fixtures.js';
import { allNotes, findEvent } from '@sudobility/music_types';
import { isNoteEvent, changeTrackPropsCommand } from '@sudobility/music_types';
import {
  getMusicPosition,
  getMusicPositionSource,
  resetMusicPosition,
} from '@sudobility/music_types';
import type { NoteEvent } from '@sudobility/music_types';
import {
  changeAccidental,
  changeArticulation,
  changeDuration,
  changeVelocity,
  addBlankTrack,
  defaultInsertPitch,
  deleteSelected,
  duplicateSelected,
  findAdjacentEventId,
  insertChordAtCaret,
  insertNoteAtCaret,
  insertRestAtSelection,
  moveSelectionHorizontal,
  quantizeSelection,
  resolveInsertTarget,
  selectAll,
  selectedNoteIds,
  selectMeasure,
  selectTrackAction,
  changeOrnament,
  toggleArpeggiate,
  toggleFermata,
  toggleHairpin,
  toggleTie,
  stepCaret,
  caretToBarEdge,
  caretToScoreEdge,
  placeCaret,
  writeNoteAtPoint,
  selectToTick,
  selectMeasureRange,
  chooseDuration,
  chooseEditMode,
  canStackOnActiveTrack,
  writeLyric,
  lyricTextAt,
  setChordSymbol,
  setTempoAt,
  setPickup,
  setBarline,
  displayedPitchForNote,
  setNotePitch,
  moveNoteToTick,
  setDynamic,
  resizeNotes,
  setTimeSignature,
  setKeySignature,
  selectRegeneratedInRange,
  collisionForEditMode,
  prepareReplacement,
  exportScopeNeedsPrompt,
  exportTargetScore,
  cutWouldPrompt,
  pasteWouldPrompt,
  transposeOctave,
  transposeSemitone,
} from './editing.js';
import { transformCommand } from '@sudobility/music_types';
import type { QuantizeOptions } from '@sudobility/music_types';

function makeStore() {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(twinkleScore());
  return store;
}

afterEach(async () => {});

describe('resolveInsertTarget', () => {
  it('targets the caret tick in the active track', () => {
    const score = twinkleScore();
    const track = score.tracks[0];
    const secondMeasure = track.measures[1];
    const caret = secondMeasure.startTick + 120;

    expect(resolveInsertTarget(score, track.id, caret)).toEqual({
      trackId: track.id,
      measureId: secondMeasure.id,
      voiceIndex: 0,
      startTick: caret,
    });
  });

  it('inserts into the active track, not the first one', () => {
    // The whole point of the caret model: what you are editing is the active
    // track, and the old selection-based target could not express that.
    const score = twoTrackScore();
    const second = score.tracks[1];

    expect(resolveInsertTarget(score, second.id, 0)?.trackId).toBe(second.id);
  });

  it('clamps a caret past the last barline into the final measure', () => {
    const score = twinkleScore();
    const track = score.tracks[0];
    const last = track.measures[track.measures.length - 1];

    const target = resolveInsertTarget(score, track.id, 10_000_000)!;
    expect(target.measureId).toBe(last.id);
    expect(target.startTick).toBeLessThan(last.startTick + last.durationTicks);
  });

  it('falls back to the first track when none is active', () => {
    const score = twinkleScore();
    expect(resolveInsertTarget(score, null, 0)?.trackId).toBe(
      score.tracks[0].id
    );
  });
});

describe('insertNoteAtCaret', () => {
  it('adds a note at the target position using the current snapGrid duration', () => {
    const store = makeStore();
    const before = allNotes(store.getState().score!).length;

    insertNoteAtCaret(store, { step: 'C', accidental: 0, octave: 5 });

    const after = allNotes(store.getState().score!);
    expect(after.length).toBe(before + 1);
    expect(store.getState().canUndo).toBe(true);
  });

  it('is a no-op with no score loaded', () => {
    const store = createAppStore({ context: testStoreContext() });
    expect(() =>
      insertNoteAtCaret(store, { step: 'C', accidental: 0, octave: 4 })
    ).not.toThrow();
    expect(store.getState().score).toBeNull();
  });

  it('defaultInsertPitch follows the selected note, then falls back to middle C', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store
      .getState()
      .setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    expect(defaultInsertPitch(store)).toEqual(note.pitch);

    store.getState().clearSelection();
    expect(defaultInsertPitch(store)).toEqual({
      step: 'C',
      accidental: 0,
      octave: 4,
    });
  });
});

describe('insertRestAtSelection (alias of deleteSelected)', () => {
  it('removes the selected note, backfilling a rest', () => {
    const store = makeStore();
    const noteId = allNotes(store.getState().score!)[0].id;
    store
      .getState()
      .setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });

    insertRestAtSelection(store);

    expect(findEvent(store.getState().score!, noteId)).toBeNull();
  });
});

describe('transposeSemitone / transposeOctave', () => {
  it('moves the selected note up one semitone', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store
      .getState()
      .setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    transposeSemitone(store, 1);

    const updated = findEvent(store.getState().score!, note.id) as NoteEvent;
    // C4 up a semitone re-spells as C#4 (sharp spelling default).
    expect(updated.pitch).toEqual({ step: 'C', accidental: 1, octave: 4 });
  });

  it('moves the selected note down one octave', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store
      .getState()
      .setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    transposeOctave(store, -1);

    const updated = findEvent(store.getState().score!, note.id) as NoteEvent;
    expect(updated.pitch.octave).toBe(note.pitch.octave - 1);
  });

  it('is a no-op when nothing is selected', () => {
    const store = makeStore();
    const before = store.getState().score;
    transposeSemitone(store, 1);
    expect(store.getState().score).toBe(before);
  });
});

describe('findAdjacentEventId / moveSelectionHorizontal', () => {
  it('finds the next and previous event within the same voice, across measures', () => {
    const score = twinkleScore();
    const channel = score.tracks[0].measures.flatMap(m => m.voices[0].events);
    const [first, second] = channel;

    expect(findAdjacentEventId(score, first.id, 'next')).toBe(second.id);
    expect(findAdjacentEventId(score, second.id, 'prev')).toBe(first.id);
  });

  it('returns null at the start/end of the channel', () => {
    const score = twinkleScore();
    const channel = score.tracks[0].measures.flatMap(m => m.voices[0].events);
    expect(findAdjacentEventId(score, channel[0].id, 'prev')).toBeNull();
    expect(
      findAdjacentEventId(score, channel[channel.length - 1].id, 'next')
    ).toBeNull();
  });

  it('moveSelectionHorizontal selects the adjacent event', () => {
    const store = makeStore();
    const channel = store
      .getState()
      .score!.tracks[0].measures.flatMap(m => m.voices[0].events);
    store.getState().setSelection({
      eventIds: [channel[0].id],
      measureIds: [],
      trackIds: [],
    });

    moveSelectionHorizontal(store, 'next');

    expect(store.getState().selection.eventIds).toEqual([channel[1].id]);
  });

  it('seeds the selection with the first note when nothing is selected and direction is next', () => {
    const store = makeStore();
    moveSelectionHorizontal(store, 'next');
    const firstNote = allNotes(store.getState().score!)[0];
    expect(store.getState().selection.eventIds).toEqual([firstNote.id]);
  });
});

describe('deleteSelected', () => {
  it('deletes the selected notes and clears the selection', () => {
    const store = makeStore();
    const noteId = allNotes(store.getState().score!)[0].id;
    store
      .getState()
      .setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });

    deleteSelected(store);

    expect(findEvent(store.getState().score!, noteId)).toBeNull();
    expect(store.getState().selection.eventIds).toEqual([]);
  });

  it('is a no-op when nothing is selected', () => {
    const store = makeStore();
    const before = store.getState().score;
    deleteSelected(store);
    expect(store.getState().score).toBe(before);
  });
});

describe('duplicateSelected', () => {
  it('pastes a copy of the selected note after its own end tick as one undoable command', () => {
    // twinkleScore's measures are fully packed with adjacent notes, so
    // pasting immediately after a note's end tick can land exactly on the
    // following note and replace it (reflowVoice's documented
    // replace-on-overlap rule) rather than strictly growing the note count
    // — assert the command actually ran (score reference changed, undoable)
    // rather than a specific note-count delta.
    const store = makeStore();
    const before = store.getState().score;
    const noteId = allNotes(store.getState().score!)[0].id;
    store
      .getState()
      .setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });

    duplicateSelected(store);

    expect(store.getState().score).not.toBe(before);
    expect(store.getState().canUndo).toBe(true);
  });

  it('is a no-op when nothing is selected', () => {
    const store = makeStore();
    const before = store.getState().score;
    duplicateSelected(store);
    expect(store.getState().score).toBe(before);
  });
});

describe('selectAll / selectMeasure / selectTrackAction', () => {
  it('selectAll selects every note in the score', () => {
    const store = makeStore();
    selectAll(store);
    const allIds = allNotes(store.getState().score!).map(n => n.id);
    expect(new Set(store.getState().selection.eventIds)).toEqual(
      new Set(allIds)
    );
  });

  it('selectMeasure replaces the selection with the given measure', () => {
    const store = makeStore();
    const measureId = store.getState().score!.tracks[0].measures[1].id;
    selectMeasure(store, measureId);
    expect(store.getState().selection).toEqual({
      eventIds: [],
      measureIds: [measureId],
      trackIds: [],
    });
  });

  it('selectTrackAction replaces the selection with the given track', () => {
    const store = makeStore();
    const trackId = store.getState().score!.tracks[0].id;
    selectTrackAction(store, trackId);
    expect(store.getState().selection).toEqual({
      eventIds: [],
      measureIds: [],
      trackIds: [trackId],
    });
  });
});

describe('per-note property changes', () => {
  it('changeDuration sets the selected note duration', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store
      .getState()
      .setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    changeDuration(store, 'eighth');

    const updated = findEvent(store.getState().score!, note.id);
    expect(updated?.durationTicks).toBe(store.getState().score!.ppq / 2);
  });

  it('changeVelocity sets the selected note velocity', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store
      .getState()
      .setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    changeVelocity(store, 100);

    const updated = findEvent(store.getState().score!, note.id) as NoteEvent;
    expect(updated.velocity).toBe(100);
  });

  it('changeArticulation sets and clears the selected note articulation', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store
      .getState()
      .setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    changeArticulation(store, 'staccato');
    expect(
      (findEvent(store.getState().score!, note.id) as NoteEvent).articulation
    ).toBe('staccato');

    changeArticulation(store, undefined);
    expect(
      (findEvent(store.getState().score!, note.id) as NoteEvent).articulation
    ).toBeUndefined();
  });

  it('changeAccidental sets the selected note accidental', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store
      .getState()
      .setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    changeAccidental(store, 1);

    expect(
      (findEvent(store.getState().score!, note.id) as NoteEvent).pitch
        .accidental
    ).toBe(1);
  });

  it('toggleTie toggles tieStart on the selected note', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store
      .getState()
      .setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    toggleTie(store, 'tieStart');
    expect(
      (findEvent(store.getState().score!, note.id) as NoteEvent).tieStart
    ).toBe(true);

    toggleTie(store, 'tieStart');
    expect(
      (findEvent(store.getState().score!, note.id) as NoteEvent).tieStart
    ).toBe(false);
  });

  it('toggleFermata puts a pause on the selected note and takes it off again', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store
      .getState()
      .setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    toggleFermata(store);
    expect(
      (findEvent(store.getState().score!, note.id) as NoteEvent).fermata
    ).toBe(true);

    toggleFermata(store);
    expect(
      (findEvent(store.getState().score!, note.id) as NoteEvent).fermata
    ).toBeUndefined();
  });

  it('changeOrnament sets and clears the selected note ornament', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store
      .getState()
      .setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    changeOrnament(store, 'trill');
    expect(
      (findEvent(store.getState().score!, note.id) as NoteEvent).ornament
    ).toBe('trill');

    changeOrnament(store, 'mordent');
    expect(
      (findEvent(store.getState().score!, note.id) as NoteEvent).ornament
    ).toBe('mordent');

    changeOrnament(store, undefined);
    expect(
      (findEvent(store.getState().score!, note.id) as NoteEvent).ornament
    ).toBeUndefined();
  });

  it('toggleFermata does nothing with an empty selection', () => {
    // One note is enough, unlike a slur — but zero still has to be a no-op
    // rather than a command that marks the whole score.
    const store = makeStore();
    store
      .getState()
      .setSelection({ eventIds: [], measureIds: [], trackIds: [] });
    const before = store.getState().score;

    toggleFermata(store);

    expect(store.getState().score).toBe(before);
    // And no undo entry: a refused command still dispatches without the guard.
    expect(store.getState().canUndo).toBe(false);
  });
});

describe('quantizeSelection', () => {
  it('dispatches a quantize command for the selected notes', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store
      .getState()
      .setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    const ppq = store.getState().score!.ppq;

    quantizeSelection(store, {
      grid: ppq / 4,
      quantizeStarts: true,
      quantizeDurations: true,
    });

    expect(store.getState().canUndo).toBe(true);
  });

  it('quantizes a 2400-note selection correctly — the size that used to be routed through a worker', async () => {
    const store = createAppStore({ context: testStoreContext() });
    // 1 track x 600 measures x 4 notes/measure = 2400 notes, spread across 600
    // per-measure voices (stressScore's convention). This was the case that
    // crossed the old >2000-event worker threshold; the worker is gone (the
    // offload measured at 0.57ms of saved work), so what matters now is simply
    // that a selection this size still quantizes correctly on the one path.
    const big = stressScore(1, 600);
    store.getState().setScore(big);
    const ids = allNotes(store.getState().score!).map(n => n.id);
    expect(ids.length).toBeGreaterThan(2000);
    store
      .getState()
      .setSelection({ eventIds: ids, measureIds: [], trackIds: [] });

    const options: QuantizeOptions = {
      grid: big.ppq / 4,
      quantizeStarts: true,
      quantizeDurations: true,
    };

    await quantizeSelection(store, options);

    expect(store.getState().canUndo).toBe(true);
    expect(
      allNotes(store.getState().score!).every(
        n => n.startTick % (big.ppq / 4) === 0
      )
    ).toBe(true);
  });
});

describe('selectedNoteIds', () => {
  it('keeps only ids that resolve to note events', () => {
    const score = twinkleScore();
    const noteId = allNotes(score)[0].id;
    const ids = selectedNoteIds(score, {
      eventIds: [noteId, 'nonexistent'],
      measureIds: [],
      trackIds: [],
    });
    expect(ids).toEqual([noteId]);
  });

  it('drops rest event ids', () => {
    const score = twinkleScore();
    const restId = score.tracks[0].measures[0].voices[0].events.find(
      e => !isNoteEvent(e)
    )?.id;
    // twinkleScore's measures are fully covered by notes, so there may be no
    // rest at all; only assert the filtering behavior when one exists.
    if (!restId) return;
    const ids = selectedNoteIds(score, {
      eventIds: [restId],
      measureIds: [],
      trackIds: [],
    });
    expect(ids).toEqual([]);
  });
});

describe('dispatchTracked', () => {
  it('pushes an error toast when the command introduces a new validation error', () => {
    const store = makeStore();
    const noteId = allNotes(store.getState().score!)[0].id;
    expect(store.getState().toasts).toEqual([]);

    // changeVelocity(store, 500) goes through dispatchTracked and produces an
    // out-of-range (0-127) velocity -> INVALID_VELOCITY validation error.
    store
      .getState()
      .setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });
    changeVelocity(store, 500);

    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].severity).toBe('error');
  });

  it('does not push a toast for a command that stays valid', () => {
    const store = makeStore();
    const noteId = allNotes(store.getState().score!)[0].id;
    store
      .getState()
      .setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });

    changeVelocity(store, 100);

    expect(store.getState().toasts).toEqual([]);
  });

  it('does not re-announce a pre-existing validation error on an unrelated later edit', () => {
    const store = makeStore();
    const notes = allNotes(store.getState().score!);

    // Directly dispatch a command that introduces an error, bypassing
    // dispatchTracked (simulating a pre-existing invalid state from some
    // other source), then perform an unrelated dispatchTracked edit.
    store.getState().dispatchCommand(
      transformCommand('Force invalid velocity', score => ({
        ...score,
        tracks: score.tracks.map(t => ({
          ...t,
          measures: t.measures.map(m => ({
            ...m,
            voices: m.voices.map(v => ({
              ...v,
              events: v.events.map(e =>
                e.id === notes[0].id ? { ...e, velocity: 500 } : e
              ),
            })),
          })),
        })),
      }))
    );
    expect(store.getState().toasts).toEqual([]);

    store
      .getState()
      .setSelection({ eventIds: [notes[1].id], measureIds: [], trackIds: [] });
    changeVelocity(store, 90);

    expect(store.getState().toasts).toEqual([]);
  });
});

describe('the playback edit lock, at the entry points', () => {
  it('refuses note entry while playing', () => {
    const store = makeStore();
    store.getState().setPlaybackState('playing');
    const before = store.getState().score;

    insertNoteAtCaret(store, { step: 'C', accidental: 0, octave: 5 });

    expect(store.getState().score).toBe(before);
  });

  it('refuses chord entry while playing, which is the piano keyboard route', () => {
    const store = makeStore();
    store.getState().setPlaybackState('playing');
    const before = store.getState().score;

    expect(
      insertChordAtCaret(store, [{ step: 'C', accidental: 0, octave: 5 }])
    ).toBe(false);
    expect(store.getState().score).toBe(before);
  });
});

describe('hairpins and arpeggios', () => {
  it('toggleHairpin marks the ends of the selection and nothing between', () => {
    const store = makeStore();
    const notes = allNotes(store.getState().score!)
      .filter(isNoteEvent)
      .slice(0, 4);
    store.getState().setSelection({
      eventIds: notes.map(n => n.id),
      measureIds: [],
      trackIds: [],
    });

    toggleHairpin(store, 'crescendo');

    const after = allNotes(store.getState().score!).filter(isNoteEvent);
    expect(
      (after.find(n => n.id === notes[0].id) as NoteEvent).hairpinStart
    ).toBe('crescendo');
    expect(
      (after.find(n => n.id === notes[3].id) as NoteEvent).hairpinStop
    ).toBe(true);
    expect(
      (after.find(n => n.id === notes[1].id) as NoteEvent).hairpinStart
    ).toBeUndefined();
  });

  it('toggleHairpin needs two notes, and refuses without spending an undo step', () => {
    // Asserting on `canUndo`, not just on the score: the command refuses a
    // one-note span too, so an unguarded action still *dispatches* — and a
    // dispatched command that changes nothing leaves an undo entry that does
    // nothing when pressed. Measured: canUndo goes true.
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store
      .getState()
      .setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    const before = store.getState().score;

    toggleHairpin(store, 'crescendo');

    expect(store.getState().score).toBe(before);
    expect(store.getState().canUndo).toBe(false);
  });

  it('the other direction flips an existing hairpin rather than clearing it', () => {
    const store = makeStore();
    const notes = allNotes(store.getState().score!)
      .filter(isNoteEvent)
      .slice(0, 3);
    const ids = notes.map(n => n.id);
    store
      .getState()
      .setSelection({ eventIds: ids, measureIds: [], trackIds: [] });

    toggleHairpin(store, 'crescendo');
    toggleHairpin(store, 'diminuendo');

    const after = allNotes(store.getState().score!).filter(isNoteEvent);
    expect((after.find(n => n.id === ids[0]) as NoteEvent).hairpinStart).toBe(
      'diminuendo'
    );
  });

  it('the same direction twice removes it', () => {
    const store = makeStore();
    const ids = allNotes(store.getState().score!)
      .filter(isNoteEvent)
      .slice(0, 3)
      .map(n => n.id);
    store
      .getState()
      .setSelection({ eventIds: ids, measureIds: [], trackIds: [] });

    toggleHairpin(store, 'crescendo');
    toggleHairpin(store, 'crescendo');

    const after = allNotes(store.getState().score!).filter(isNoteEvent);
    expect(
      (after.find(n => n.id === ids[0]) as NoteEvent).hairpinStart
    ).toBeUndefined();
  });

  it('toggleArpeggiate marks and unmarks the selection', () => {
    const store = makeStore();
    const ids = allNotes(store.getState().score!)
      .filter(isNoteEvent)
      .slice(0, 2)
      .map(n => n.id);
    store
      .getState()
      .setSelection({ eventIds: ids, measureIds: [], trackIds: [] });

    toggleArpeggiate(store);
    expect(
      (findEvent(store.getState().score!, ids[0]) as NoteEvent).arpeggiate
    ).toBe(true);

    toggleArpeggiate(store);
    expect(
      (findEvent(store.getState().score!, ids[0]) as NoteEvent).arpeggiate
    ).toBeUndefined();
  });
});

/**
 * The caret, which is the shared position and not a store field.
 *
 * These assertions used to live in music_app, spying on `playbackController`
 * — which meant the only coverage of "note entry advances the caret" was a
 * mock in a component test, and moving the editor here would have dropped it
 * silently. There is one position now, so a test can simply read it.
 */
describe('the caret', () => {
  beforeEach(() => {
    resetMusicPosition();
  });

  it('advances past what was written, so a run of taps lays out a melody', () => {
    const store = makeStore();
    getMusicPositionSource().moveTo(0);

    insertNoteAtCaret(
      store,
      { step: 'C', accidental: 0, octave: 4 },
      { advanceCaret: true }
    );

    expect(getMusicPosition().reportedTick).toBeGreaterThan(0);
  });

  it('advances once for a whole chord, however many notes it holds', () => {
    const store = makeStore();
    getMusicPositionSource().moveTo(0);

    insertChordAtCaret(
      store,
      [
        { step: 'C', accidental: 0, octave: 4 },
        { step: 'E', accidental: 0, octave: 4 },
        { step: 'G', accidental: 0, octave: 4 },
      ],
      { advanceCaret: true }
    );

    const after = getMusicPosition().reportedTick;
    // One note's length, not three: a chord occupies one position.
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThanOrEqual(store.getState().score!.ppq * 4);
  });

  it('does not move when the caller says not to', () => {
    const store = makeStore();
    getMusicPositionSource().moveTo(960);

    insertChordAtCaret(store, [{ step: 'C', accidental: 0, octave: 4 }], {
      advanceCaret: false,
    });

    expect(getMusicPosition().reportedTick).toBe(960);
  });

  it('steps by the current note value, and never off the front of the score', () => {
    const store = makeStore();
    getMusicPositionSource().moveTo(0);

    stepCaret(store, 'next');
    const forward = getMusicPosition().reportedTick;
    expect(forward).toBeGreaterThan(0);

    stepCaret(store, 'prev');
    expect(getMusicPosition().reportedTick).toBe(0);

    stepCaret(store, 'prev');
    expect(getMusicPosition().reportedTick).toBe(0);
  });

  it('jumps to the edges of the bar and of the score', () => {
    const store = makeStore();
    getMusicPositionSource().moveTo(240);

    caretToBarEdge(store, 'start');
    expect(getMusicPosition().reportedTick).toBe(0);

    caretToScoreEdge(store, 'end');
    expect(getMusicPosition().reportedTick).toBeGreaterThan(0);

    caretToScoreEdge(store, 'start');
    expect(getMusicPosition().reportedTick).toBe(0);
  });
});

describe('clicking the sheet', () => {
  beforeEach(() => {
    resetMusicPosition();
  });

  it('placeCaret aims the caret, activates the track and clears the selection at once', () => {
    // Three writes as one action: doing them separately is how you get "the
    // caret jumped but the track did not".
    const store = makeStore();
    const track = store.getState().score!.tracks[0];
    const note = allNotes(store.getState().score!)[0];
    store
      .getState()
      .setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    placeCaret(store, { tick: 960, trackId: track.id });

    expect(getMusicPosition().reportedTick).toBe(960);
    expect(store.getState().activeTrackId).toBe(track.id);
    expect(store.getState().selection.eventIds).toEqual([]);
  });

  it('placeCaret leaves the active track alone when the click missed a stave', () => {
    const store = makeStore();
    const tracks = store.getState().score!.tracks;
    store.getState().setActiveTrack(tracks[0].id);

    placeCaret(store, { tick: 480, trackId: null });

    expect(store.getState().activeTrackId).toBe(tracks[0].id);
  });

  it('writeNoteAtPoint writes at the click and advances past it', () => {
    const store = makeStore();
    const track = store.getState().score!.tracks[0];

    writeNoteAtPoint(store, {
      tick: 0,
      trackId: track.id,
      pitch: { step: 'D', accidental: 0, octave: 5 },
    });

    const written = allNotes(store.getState().score!).filter(
      n => n.startTick === 0 && n.pitch.step === 'D' && n.pitch.octave === 5
    );
    expect(written.length).toBeGreaterThan(0);
    expect(getMusicPosition().reportedTick).toBeGreaterThan(0);
  });

  it('selectToTick selects from the caret without moving it', () => {
    // Not moving it is the point: the same anchor extends again and again.
    const store = makeStore();
    getMusicPositionSource().moveTo(0);

    selectToTick(store, { tick: 1920, allTracks: false });

    expect(getMusicPosition().reportedTick).toBe(0);
    expect(store.getState().selection.range).toEqual({
      startTick: 0,
      endTick: 1920,
      trackIds: [store.getState().score!.tracks[0].id],
    });
  });

  it('selectToTick carries an explicit range, so an empty span is still selectable', () => {
    // `selectionToRange` cannot derive a span from an empty list of ids, and
    // regenerating a run of empty bars has to work.
    const store = makeStore();
    getMusicPositionSource().moveTo(1920);

    selectToTick(store, { tick: 0, allTracks: true });

    const range = store.getState().selection.range!;
    expect(range.startTick).toBe(0);
    expect(range.endTick).toBe(1920);
    expect(range.trackIds).toHaveLength(store.getState().score!.tracks.length);
  });

  it('selectMeasureRange selects one bar across every track, and returns the anchor', () => {
    const store = makeStore();

    const anchor = selectMeasureRange(store, {
      index: 2,
      anchor: null,
      extend: false,
      allTracks: false,
    });

    expect(anchor).toBe(2);
    const selected = store.getState().selection.measureIds;
    expect(selected).toHaveLength(store.getState().score!.tracks.length);
  });

  it('selectMeasureRange grows and shrinks from one anchor rather than walking', () => {
    // What every list does: extending twice from the same anchor re-spans it.
    const store = makeStore();
    const trackCount = store.getState().score!.tracks.length;

    selectMeasureRange(store, {
      index: 1,
      anchor: null,
      extend: false,
      allTracks: true,
    });
    selectMeasureRange(store, {
      index: 3,
      anchor: 1,
      extend: true,
      allTracks: true,
    });
    expect(store.getState().selection.measureIds).toHaveLength(3 * trackCount);

    selectMeasureRange(store, {
      index: 2,
      anchor: 1,
      extend: true,
      allTracks: true,
    });
    expect(store.getState().selection.measureIds).toHaveLength(2 * trackCount);
  });

  it('selectMeasureRange keeps its anchor while extending', () => {
    const store = makeStore();
    expect(
      selectMeasureRange(store, {
        index: 3,
        anchor: 1,
        extend: true,
        allTracks: false,
      })
    ).toBe(1);
  });
});

describe('the toolbar', () => {
  it('chooseDuration retimes the selection and arms the next note', () => {
    // Both, because that is what choosing a length means — a button that did
    // one of them would mean different things depending on the selection.
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store
      .getState()
      .setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    // Shorter, so it fits where the note already sits: lengthening would run
    // into its neighbour, which is a question about `changeDuration` rather
    // than about the toolbar doing both halves of its job.
    chooseDuration(store, 'eighth');

    expect(store.getState().snapGrid).toBe('eighth');
    const after = findEvent(store.getState().score!, note.id)!;
    expect(after.durationTicks).toBe(store.getState().score!.ppq / 2);
  });

  it('addBlankTrack creates a track and makes it active', () => {
    const store = makeStore();
    const before = store.getState().score!.tracks.length;

    const id = addBlankTrack(store);

    expect(id).toBeTruthy();
    expect(store.getState().score!.tracks).toHaveLength(before + 1);
    expect(store.getState().activeTrackId).toBe(id);
  });

  it('chooseEditMode falls back to replace where the track cannot stack', () => {
    // Stacking onto a monophonic part cannot work, and the refusal would only
    // surface after you had already played something.
    const store = makeStore();
    const track = store.getState().score!.tracks[0];
    store.getState().setActiveTrack(track.id);
    store
      .getState()
      .dispatchCommand(
        changeTrackPropsCommand(track.id, { midiProgram: 56 }, 'trumpet')
      );

    chooseEditMode(store, 'stack');

    expect(store.getState().editMode).toBe('replace');
    expect(canStackOnActiveTrack(store)).toBe(false);
  });

  it('chooseEditMode allows stacking on a polyphonic track', () => {
    const store = makeStore();
    const track = store.getState().score!.tracks[0];
    store.getState().setActiveTrack(track.id);
    store
      .getState()
      .dispatchCommand(
        changeTrackPropsCommand(track.id, { midiProgram: 0 }, 'piano')
      );

    chooseEditMode(store, 'stack');

    expect(store.getState().editMode).toBe('stack');
  });
});

describe('lyrics', () => {
  it('derives how a syllable joins from the keystrokes, not from a field', () => {
    // A writer knows they are mid-word; `syllabic` is what draws the trailing
    // hyphen and fills MusicXML's <syllabic>.
    const store = makeStore();
    const notes = allNotes(store.getState().score!);

    const continuing = writeLyric(store, {
      noteId: notes[0].id,
      text: 'hal',
      continuing: false,
      hyphenated: true,
    });
    expect(continuing).toBe(true);

    writeLyric(store, {
      noteId: notes[1].id,
      text: 'le',
      continuing: true,
      hyphenated: true,
    });
    writeLyric(store, {
      noteId: notes[2].id,
      text: 'lujah',
      continuing: true,
      hyphenated: false,
    });

    const written = allNotes(store.getState().score!);
    expect(written[0].lyric).toEqual({ text: 'hal', syllabic: 'begin' });
    expect(written[1].lyric).toEqual({ text: 'le', syllabic: 'middle' });
    expect(written[2].lyric).toEqual({ text: 'lujah', syllabic: 'end' });
  });

  it('clears the lyric rather than storing a blank one', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    writeLyric(store, {
      noteId: note.id,
      text: 'la',
      continuing: false,
      hyphenated: false,
    });

    writeLyric(store, {
      noteId: note.id,
      text: '   ',
      continuing: false,
      hyphenated: false,
    });

    expect(findEvent(store.getState().score!, note.id)).not.toHaveProperty(
      'lyric.text'
    );
  });

  it('lyricTextAt reads the live score, not a snapshot the caller is holding', () => {
    // Stepping back over a word just typed showed an empty field until this
    // read the score instead.
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    expect(lyricTextAt(store, note.id)).toBe('');

    writeLyric(store, {
      noteId: note.id,
      text: 'sol',
      continuing: false,
      hyphenated: false,
    });

    expect(lyricTextAt(store, note.id)).toBe('sol');
  });
});

describe('the inspector', () => {
  it('setChordSymbol stores what was typed, and ignores a no-op', () => {
    // `C-7`, `Cmin7` and `Cm7` are one chord written three ways; refusing or
    // rewriting any of them would lose what the player meant.
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];

    setChordSymbol(store, note.id, 'Cmaj7(add13)');
    expect(
      (findEvent(store.getState().score!, note.id) as NoteEvent).chordSymbol
    ).toBe('Cmaj7(add13)');

    // Unchanged text is not an undo entry.
    const score = store.getState().score;
    setChordSymbol(store, note.id, 'Cmaj7(add13)');
    expect(store.getState().score).toBe(score);
  });

  it('setTempoAt refuses a value that is not a tempo', () => {
    const store = makeStore();
    const before = store.getState().score!.tempoMap.length;

    expect(setTempoAt(store, { tick: 1920, bpm: 0 })).toBe(false);
    expect(setTempoAt(store, { tick: 1920, bpm: Number.NaN })).toBe(false);
    expect(store.getState().score!.tempoMap).toHaveLength(before);
  });

  it('setTempoAt writes a change at a bar, so a piece can change part-way', () => {
    const store = makeStore();

    expect(setTempoAt(store, { tick: 1920, bpm: 92 })).toBe(true);

    expect(
      store
        .getState()
        .score!.tempoMap.some(e => e.tick === 1920 && e.bpm === 92)
    ).toBe(true);
  });

  it('setPickup marks bar 1 and takes the marking off again', () => {
    const store = makeStore();

    setPickup(store, 1);
    expect(store.getState().score!.tracks[0].measures[0].pickup).toBe(true);

    setPickup(store, null);
    expect(store.getState().score!.tracks[0].measures[0].pickup).toBeFalsy();
  });

  it('setBarline applies across every track, so the parts cannot disagree', () => {
    const store = makeStore();

    setBarline(store, 1, 'double');

    for (const track of store.getState().score!.tracks) {
      expect(track.measures[1].barline).toBe('double');
    }
  });
});

describe('the note panel', () => {
  it('displayedPitchForNote shows the written pitch for a transposing part', () => {
    const store = makeStore();
    const track = store.getState().score!.tracks[0];
    store
      .getState()
      .dispatchCommand(
        changeTrackPropsCommand(track.id, { midiProgram: 71 }, 'clarinet')
      );
    const score = store.getState().score!;
    const note = allNotes(score)[0] as NoteEvent;

    expect(displayedPitchForNote(score, note, 'written')).not.toEqual(
      note.pitch
    );
    expect(displayedPitchForNote(score, note, 'concert')).toEqual(note.pitch);
  });

  it('setNotePitch stores the sounding pitch when the panel shows written', () => {
    // On a B-flat clarinet read in written pitch the two differ by a tone, and
    // storing what was typed writes a note that draws right and sounds wrong.
    const store = makeStore();
    const track = store.getState().score!.tracks[0];
    store
      .getState()
      .dispatchCommand(
        changeTrackPropsCommand(track.id, { midiProgram: 71 }, 'clarinet')
      );
    const note = allNotes(store.getState().score!)[0];
    const typed = { step: 'D' as const, accidental: 0 as const, octave: 5 };

    setNotePitch(store, note.id, typed, 'written');

    const stored = (findEvent(store.getState().score!, note.id) as NoteEvent)
      .pitch;
    expect(stored).not.toEqual(typed);
  });

  it('setNotePitch stores exactly what was typed in concert pitch', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    const typed = { step: 'D' as const, accidental: 0 as const, octave: 5 };

    setNotePitch(store, note.id, typed, 'concert');

    expect(
      (findEvent(store.getState().score!, note.id) as NoteEvent).pitch
    ).toEqual(typed);
  });

  it('moveNoteToTick ignores a move to where the note already is', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    const score = store.getState().score;

    moveNoteToTick(store, note.id, note.startTick);

    expect(store.getState().score).toBe(score);
  });

  it('setDynamic marks the level and takes the marking off again', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];

    setDynamic(store, [note.id], 'ff');
    expect(
      (findEvent(store.getState().score!, note.id) as NoteEvent).dynamic
    ).toBe('ff');

    setDynamic(store, [note.id], undefined);
    expect(
      (findEvent(store.getState().score!, note.id) as NoteEvent).dynamic
    ).toBeUndefined();
  });

  it('resizeNotes retimes to a plain note value', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];

    resizeNotes(store, [note.id], 'eighth');

    expect(
      (findEvent(store.getState().score!, note.id) as NoteEvent).durationTicks
    ).toBe(store.getState().score!.ppq / 2);
  });
});

describe('measure signatures', () => {
  it('setTimeSignature applies to every selected bar in one call', () => {
    // One decision to the person making it, so the loop belongs here rather
    // than at a call site that could get it subtly different.
    const store = makeStore();
    const ids = store
      .getState()
      .score!.tracks[0].measures.slice(0, 3)
      .map(m => m.id);

    setTimeSignature(store, ids, { numerator: 3, denominator: 4 });

    for (const measure of store
      .getState()
      .score!.tracks[0].measures.slice(0, 3)) {
      expect(measure.timeSignature).toEqual({ numerator: 3, denominator: 4 });
    }
  });

  it('setKeySignature applies to every selected bar in one call', () => {
    const store = makeStore();
    const ids = store
      .getState()
      .score!.tracks[0].measures.slice(0, 2)
      .map(m => m.id);

    setKeySignature(store, ids, { fifths: 3, mode: 'major' });

    for (const measure of store
      .getState()
      .score!.tracks[0].measures.slice(0, 2)) {
      expect(measure.keySignature).toEqual({ fifths: 3, mode: 'major' });
    }
  });

  it('both are no-ops on an empty selection', () => {
    const store = makeStore();
    const score = store.getState().score;

    setTimeSignature(store, [], { numerator: 3, denominator: 4 });
    setKeySignature(store, [], { fifths: 1, mode: 'minor' });

    expect(store.getState().score).toBe(score);
  });
});

describe('generated material', () => {
  it('marks what a generation wrote, including a note it overran', () => {
    // Found by the region asked for, because a job applies server-side and
    // there is no command to watch. Overlap, not containment: a note already
    // sounding into the region was replaced too.
    const store = makeStore();
    const track = store.getState().score!.tracks[0];
    const first = allNotes(store.getState().score!).filter(
      n => n.trackId === track.id
    )[0];

    selectRegeneratedInRange(store, {
      startTick: first.startTick + 1,
      endTick: first.startTick + 2,
      trackIds: [track.id],
    });

    expect(store.getState().selection.eventIds).toContain(first.id);
  });

  it('marks nothing when the region is on another track', () => {
    const store = makeStore();
    const other = store.getState().score!.tracks.at(-1)!;
    const before = store.getState().selection.eventIds;

    selectRegeneratedInRange(store, {
      startTick: 0,
      endTick: 1,
      trackIds: [`${other.id}-nope`],
    });

    expect(store.getState().selection.eventIds).toEqual(before);
  });

  it('collisionForEditMode ripples in insert mode and passes the rest through', () => {
    expect(collisionForEditMode('insert')).toBe('ripple');
    expect(collisionForEditMode('replace')).toBe('replace');
    expect(collisionForEditMode('stack')).toBe('stack');
  });
});

describe('replacement and export scope', () => {
  const submission = () => ({
    instruction: 'darker',
    constraints: {
      preserveBoundaryNotes: false,
      preserveHarmony: false,
      preserveRhythm: false,
      preserveMelody: false,
    },
  });

  it('derives the region from the selection rather than asking for it', () => {
    // The dialog collects settings; sending those alone would leave the server
    // guessing at the part of the score nobody described.
    const store = makeStore();
    const measures = store.getState().score!.tracks[0].measures.slice(0, 2);
    store.getState().setSelection({
      eventIds: [],
      measureIds: measures.map(m => m.id),
      trackIds: [],
    });

    const prepared = prepareReplacement(store, 'measures', submission());

    expect(prepared).not.toBeNull();
    expect(prepared!.kind).toBe('replace-measures');
    expect(prepared!.range.startTick).toBe(measures[0].startTick);
    expect(prepared!.request.instruction).toBe('darker');
  });

  it('answers null when the selection yields no region', () => {
    // "Replace the notes" with nothing selected has no honest answer.
    const store = makeStore();
    store.getState().clearSelection();

    expect(prepareReplacement(store, 'notes', submission())).toBeNull();
  });

  it('asks about export scope only when something is hidden', () => {
    // A dialog whose options do the same thing is a click nobody can get
    // wrong, so it should not appear.
    const store = makeStore();
    store.getState().setScore(twoTrackScore());
    expect(exportScopeNeedsPrompt(store)).toBe(false);

    store.getState().setVisibleTracks([store.getState().score!.tracks[0].id]);

    expect(exportScopeNeedsPrompt(store)).toBe(true);
  });

  it('narrows the exported score to the visible tracks when asked', () => {
    const store = makeStore();
    store.getState().setScore(twoTrackScore());
    const all = store.getState().score!.tracks.length;
    store.getState().setVisibleTracks([store.getState().score!.tracks[0].id]);

    expect(exportTargetScore(store, 'all')!.tracks).toHaveLength(all);
    expect(exportTargetScore(store, 'visible')!.tracks).toHaveLength(1);
  });
});

describe('clipboard prompts', () => {
  it('does not ask to cut when nothing follows on that track', () => {
    // Sliding the rest of the track up moves nothing, so the two answers
    // produce identical scores.
    const store = makeStore();
    const notes = allNotes(store.getState().score!);
    const last = notes[notes.length - 1];
    store
      .getState()
      .setSelection({ eventIds: [last.id], measureIds: [], trackIds: [] });

    expect(cutWouldPrompt(store)).toBe(false);
  });

  it('asks to cut when something follows it', () => {
    const store = makeStore();
    const first = allNotes(store.getState().score!)[0];
    store
      .getState()
      .setSelection({ eventIds: [first.id], measureIds: [], trackIds: [] });

    expect(cutWouldPrompt(store)).toBe(true);
  });

  it('does not ask with an empty selection or an empty clipboard', () => {
    const store = makeStore();
    store.getState().clearSelection();

    expect(cutWouldPrompt(store)).toBe(false);
    expect(pasteWouldPrompt(store)).toBe(false);
  });
});
