import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '../score/factory';
import { validateScore } from '../validation/validator';
import { isNoteEvent } from '@sudobility/music_types';
import type { NoteEvent, Pitch } from '@sudobility/music_types';
import { addNoteCommand } from './note-commands';
import {
  applyQuantizedCommand,
  collectQuantizeTargets,
  pasteEventsCommand,
  quantizeCommand,
  transposeCommand,
} from './edit-commands';
import { quantizeEvents } from '../quantization/quantize';
import type { QuantizeOptions } from '../quantization/options';

const PITCH: Pitch = { step: 'C', accidental: 0, octave: 4 };

function baseScore() {
  return createEmptyScore({ title: 'S', measures: 2, tracks: [{ name: 'A' }, { name: 'B' }] });
}

function withOneNote(startTick = 0, durationTicks = 480) {
  const score = baseScore();
  const track = score.tracks[0];
  return addNoteCommand({
    trackId: track.id,
    measureId: track.measures[0].id,
    voiceIndex: 0,
    pitch: PITCH,
    startTick,
    durationTicks,
  }).execute(score);
}

function allNoteEvents(score: ReturnType<typeof withOneNote>): NoteEvent[] {
  return score.tracks.flatMap((t) => t.measures.flatMap((m) => m.voices.flatMap((v) => v.events.filter(isNoteEvent))));
}

describe('pasteEventsCommand', () => {
  it('pastes notes at the anchor tick, preserving relative offsets, on the destination track/voice', () => {
    const score = baseScore();
    const track = score.tracks[0];
    const destTrack = score.tracks[1];
    const notes: NoteEvent[] = [
      { id: 'src-1', pitch: PITCH, startTick: 100, durationTicks: 100, velocity: 80, voiceId: 'x', trackId: track.id },
      { id: 'src-2', pitch: PITCH, startTick: 200, durationTicks: 100, velocity: 80, voiceId: 'x', trackId: track.id },
    ];

    const cmd = pasteEventsCommand(notes, { trackId: destTrack.id, voiceIndex: 0, anchorTick: 0 });
    const next = cmd.execute(score);

    const pasted = allNoteEvents(next).sort((a, b) => a.startTick - b.startTick);
    expect(pasted).toHaveLength(2);
    expect(pasted[0].startTick).toBe(0);
    expect(pasted[1].startTick).toBe(100);
    expect(pasted.every((n) => n.trackId === destTrack.id)).toBe(true);
    // Fresh ids, not the source ids.
    expect(pasted.map((n) => n.id)).not.toContain('src-1');
    expect(pasted.map((n) => n.id)).not.toContain('src-2');

    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(score);
  });

  it('splits a pasted note into tied segments when it crosses a measure boundary', () => {
    const score = baseScore();
    const destTrack = score.tracks[1];
    const measureTicks = destTrack.measures[0].durationTicks;
    const notes: NoteEvent[] = [
      { id: 'src-1', pitch: PITCH, startTick: 0, durationTicks: 480, velocity: 80, voiceId: 'x', trackId: destTrack.id },
    ];

    const cmd = pasteEventsCommand(notes, {
      trackId: destTrack.id,
      voiceIndex: 0,
      anchorTick: measureTicks - 240,
    });
    const next = cmd.execute(score);

    const destResult = next.tracks.find((t) => t.id === destTrack.id)!;
    const m0Notes = destResult.measures[0].voices[0].events.filter(isNoteEvent);
    const m1Notes = destResult.measures[1].voices[0].events.filter(isNoteEvent);
    expect(m0Notes).toHaveLength(1);
    expect(m1Notes).toHaveLength(1);
    expect(m0Notes[0].tieStart).toBe(true);
    expect(m1Notes[0].tieStop).toBe(true);
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(score);
  });

  it('is a no-op for an unknown destination track', () => {
    const score = baseScore();
    const notes: NoteEvent[] = [
      { id: 'src-1', pitch: PITCH, startTick: 0, durationTicks: 100, velocity: 80, voiceId: 'x', trackId: 't1' },
    ];
    const cmd = pasteEventsCommand(notes, { trackId: 'missing', voiceIndex: 0, anchorTick: 0 });
    expect(cmd.execute(score)).toEqual(score);
  });

  it('is a no-op for an empty notes list', () => {
    const score = baseScore();
    const cmd = pasteEventsCommand([], { trackId: score.tracks[0].id, voiceIndex: 0, anchorTick: 0 });
    expect(cmd.execute(score)).toEqual(score);
  });
});

describe('quantizeCommand', () => {
  it('snaps an off-grid note to the nearest grid line and round-trips through undo', () => {
    const withNote = withOneNote(50, 480); // 50 ticks off a 480-tick grid
    const noteId = allNoteEvents(withNote)[0].id;
    const options: QuantizeOptions = { grid: 480, quantizeStarts: true, quantizeDurations: false };

    const cmd = quantizeCommand([noteId], options);
    const next = cmd.execute(withNote);
    const notes = allNoteEvents(next);
    expect(notes).toHaveLength(1);
    expect(notes[0].startTick).toBe(0);
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(withNote);
  });

  it('is a no-op for unknown event ids', () => {
    const withNote = withOneNote();
    const options: QuantizeOptions = { grid: 480, quantizeStarts: true, quantizeDurations: false };
    const cmd = quantizeCommand(['missing'], options);
    expect(cmd.execute(withNote)).toEqual(withNote);
  });
});

describe('collectQuantizeTargets / applyQuantizedCommand (spec §29 worker-routing split)', () => {
  it('collects one target per touched voice, with that voice\'s current notes', () => {
    const withNote = withOneNote(50, 480);
    const noteId = allNoteEvents(withNote)[0].id;

    const targets = collectQuantizeTargets(withNote, [noteId]);

    expect(targets).toHaveLength(1);
    expect(targets[0].notes.map((n) => n.id)).toEqual([noteId]);
    expect(targets[0].trackId).toBe(withNote.tracks[0].id);
  });

  it('is empty for unknown event ids', () => {
    const withNote = withOneNote();
    expect(collectQuantizeTargets(withNote, ['missing'])).toEqual([]);
  });

  it('applyQuantizedCommand, fed the same quantizeEvents output collectQuantizeTargets/quantizeEvents would compute inline, matches quantizeCommand exactly (mod fresh filler-rest ids)', () => {
    const withNote = withOneNote(50, 480); // 50 ticks off a 480-tick grid
    const noteId = allNoteEvents(withNote)[0].id;
    const options: QuantizeOptions = { grid: 480, quantizeStarts: true, quantizeDurations: false };

    const targets = collectQuantizeTargets(withNote, [noteId]);
    const quantizedByVoiceId = new Map(targets.map((t) => [t.voiceId, quantizeEvents(t.notes, options)] as const));
    const precomputedCmd = applyQuantizedCommand(targets, quantizedByVoiceId);
    const inlineCmd = quantizeCommand([noteId], options);

    const viaPrecomputed = precomputedCmd.execute(withNote);
    const viaInline = inlineCmd.execute(withNote);

    // Each `.execute()` call independently reflows its voice (minting a
    // fresh `createId()` for any filler rest) and re-touches
    // `metadata.updatedAt` (`Date.now()`/`toISOString()`, which can tick
    // over a millisecond between the two calls) — both expected, harmless
    // divergences unrelated to what this test actually checks (that the two
    // code paths compute the same *musical* result), so both are normalized
    // out before comparing.
    const normalizeRestIds = (score: typeof viaPrecomputed) => ({
      ...score,
      metadata: { ...score.metadata, updatedAt: 'normalized' },
      tracks: score.tracks.map((t) => ({
        ...t,
        measures: t.measures.map((m) => ({
          ...m,
          voices: m.voices.map((v) => ({
            ...v,
            events: v.events.map((e) => (isNoteEvent(e) ? e : { ...e, id: 'rest' })),
          })),
        })),
      })),
    });

    expect(normalizeRestIds(viaPrecomputed)).toEqual(normalizeRestIds(viaInline));
    expect(validateScore(viaPrecomputed)).toEqual([]);
    expect(precomputedCmd.undo(viaPrecomputed)).toEqual(withNote);
  });

  it('degrades safely (reflows to fully-rested, not a throw) when a target has no entry in the quantized-results map', () => {
    const withNote = withOneNote(50, 480);
    const noteId = allNoteEvents(withNote)[0].id;
    const targets = collectQuantizeTargets(withNote, [noteId]);

    // An empty map, as if a concurrent edit removed the voice before the
    // (async) worker round-trip resolved with results for its key.
    const cmd = applyQuantizedCommand(targets, new Map());
    const next = cmd.execute(withNote);

    expect(allNoteEvents(next)).toHaveLength(0);
    expect(validateScore(next)).toEqual([]);
  });
});

describe('transposeCommand', () => {
  it('transposes notes by semitones, respelling per the measure key signature, and round-trips through undo', () => {
    const withNote = withOneNote();
    const noteId = allNoteEvents(withNote)[0].id;
    const cmd = transposeCommand([noteId], 1);

    const next = cmd.execute(withNote);
    expect(allNoteEvents(next)[0].pitch).toEqual({ step: 'C', accidental: 1, octave: 4 });
    expect(cmd.undo(next)).toEqual(withNote);
  });

  it('is a no-op for unknown event ids', () => {
    const withNote = withOneNote();
    const cmd = transposeCommand(['missing'], 3);
    expect(cmd.execute(withNote)).toEqual(withNote);
  });
});
