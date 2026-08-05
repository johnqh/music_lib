import { describe, expect, it } from 'vitest';
import { createEmptyScore } from './factory.js';
import { allNotes } from './queries.js';
import { addNoteCommand } from '../commands/note-commands.js';
import { extractPart } from './extract-part.js';
import { isNoteEvent } from '@sudobility/music_types';
import type { Pitch, Score } from '@sudobility/music_types';
import { pitchToMidi } from '../pitch/pitch.js';

const pitch = (step: string, octave = 4): Pitch =>
  ({ step, accidental: 0, octave }) as unknown as Pitch;

/** A two-track score whose first track's program is settable. */
function scoreWith(program: number): Score {
  const base = createEmptyScore({
    title: 'Part',
    measures: 2,
    tracks: [
      { name: 'Solo', instrumentName: 'Solo', clef: 'treble' as const },
      { name: 'Piano', instrumentName: 'Piano', clef: 'bass' as const },
    ],
  });
  const withProgram: Score = {
    ...base,
    tracks: base.tracks.map((t, i) => (i === 0 ? { ...t, midiProgram: program } : t)),
  };
  const track = withProgram.tracks[0];
  return ['C', 'D', 'E'].reduce(
    (acc, step, i) =>
      addNoteCommand({
        trackId: track.id,
        measureId: track.measures[0].id,
        voiceIndex: 0,
        pitch: pitch(step),
        startTick: i * withProgram.ppq,
        durationTicks: withProgram.ppq,
      }).execute(acc),
    withProgram,
  );
}

const spell = (p: Pitch) =>
  `${p.step}${p.accidental === 1 ? '#' : p.accidental === -1 ? 'b' : ''}`;

const steps = (score: Score) =>
  allNotes(score)
    .sort((a, b) => a.startTick - b.startTick)
    .map((n) => spell(n.pitch));

describe('extractPart', () => {
  it('keeps only the requested track', () => {
    const score = scoreWith(0);
    const part = extractPart(score, score.tracks[0].id)!;
    expect(part.tracks).toHaveLength(1);
    expect(part.tracks[0].id).toBe(score.tracks[0].id);
  });

  it('is null for a track that does not exist', () => {
    expect(extractPart(scoreWith(0), 'nope')).toBeNull();
  });

  it('leaves a non-transposing instrument exactly as it sounds', () => {
    const score = scoreWith(0); // Acoustic Grand Piano
    const part = extractPart(score, score.tracks[0].id)!;
    expect(steps(part)).toEqual(['C', 'D', 'E']);
    expect(part.tracks[0].measures[0].keySignature.fifths).toBe(
      score.tracks[0].measures[0].keySignature.fifths,
    );
  });

  it('writes a B-flat instrument a tone up', () => {
    const score = scoreWith(71); // Clarinet
    const part = extractPart(score, score.tracks[0].id)!;
    expect(steps(part)).toEqual(['D', 'E', 'F#']);
  });

  it('moves the key signature with the pitches', () => {
    // Without this the part is full of accidentals where a key belongs.
    const score = scoreWith(71);
    const part = extractPart(score, score.tracks[0].id)!;
    for (const measure of part.tracks[0].measures) {
      expect(measure.keySignature.fifths).toBe(2); // concert C -> D major
    }
  });

  it('spells in the new key, not the old one', () => {
    // The whole reason the key moves first: concert E in a B-flat part is F#,
    // not Gb. Both are the same sound; only one is correct notation.
    const score = scoreWith(71);
    const part = extractPart(score, score.tracks[0].id)!;
    const third = allNotes(part).sort((a, b) => a.startTick - b.startTick)[2];
    expect(third.pitch.step).toBe('F');
    expect(third.pitch.accidental).toBe(1);
  });

  it('moves an octave-transposing instrument without touching its key', () => {
    const score = scoreWith(24); // Acoustic Guitar
    const part = extractPart(score, score.tracks[0].id)!;
    expect(steps(part)).toEqual(['C', 'D', 'E']);

    const written = allNotes(part).sort((a, b) => a.startTick - b.startTick);
    const sounding = allNotes(score)
      .filter((n) => n.trackId === score.tracks[0].id)
      .sort((a, b) => a.startTick - b.startTick);
    expect(written[0].pitch.octave).toBe(sounding[0].pitch.octave + 1);
    expect(part.tracks[0].measures[0].keySignature.fifths).toBe(0);
  });

  it('does not modify the score it was given', () => {
    // The derived part is print-only; the real score must be untouched.
    const score = scoreWith(71);
    const before = steps(score);
    extractPart(score, score.tracks[0].id);
    expect(steps(score)).toEqual(before);
  });

  it('keeps rests and every other event in place', () => {
    // Only pitch and key change; the rest is the same music.
    const score = scoreWith(71);
    const part = extractPart(score, score.tracks[0].id)!;
    const sourceCounts = score.tracks[0].measures.map((m) =>
      m.voices.map((v) => v.events.length),
    );
    const partCounts = part.tracks[0].measures.map((m) => m.voices.map((v) => v.events.length));
    expect(partCounts).toEqual(sourceCounts);
  });
});

describe('extractPart collapses silence', () => {
  /** One track: a note in bar 0, then `silentBars` empty bars, then a note. */
  function scoreWithSilence(silentBars: number): Score {
    const base = createEmptyScore({
      title: 'Rest',
      measures: silentBars + 2,
      tracks: [{ name: 'Solo', instrumentName: 'Solo', clef: 'treble' as const }],
    });
    const track = base.tracks[0];
    const withFirst = addNoteCommand({
      trackId: track.id,
      measureId: track.measures[0].id,
      voiceIndex: 0,
      pitch: pitch('C'),
      startTick: 0,
      durationTicks: base.ppq,
    }).execute(base);
    const last = withFirst.tracks[0].measures[silentBars + 1];
    return addNoteCommand({
      trackId: track.id,
      measureId: last.id,
      voiceIndex: 0,
      pitch: pitch('C'),
      startTick: last.startTick,
      durationTicks: base.ppq,
    }).execute(withFirst);
  }

  it('replaces a long silence with measures carrying the count', () => {
    // The 24 silent bars survive as counts, but in two rests rather than one:
    // feature 4 puts a rehearsal mark at bar 16, and a multi-measure rest may
    // not span a mark — a mark hidden inside a rest is one no player can find.
    // That split is correct engraving, not a regression.
    const score = scoreWithSilence(24);
    const part = extractPart(score, score.tracks[0].id)!;
    const rests = part.tracks[0].measures.filter((m) => m.multiMeasureRestCount);
    expect(rests.map((m) => m.multiMeasureRestCount)).toEqual([15, 9]);
    expect(rests.reduce((sum, m) => sum + m.multiMeasureRestCount!, 0)).toBe(24);
    expect(rests[1].rehearsalMark).toBe('A');
  });

  it('keeps the numbering true across the rest', () => {
    // A player counting 15, then 9 from the mark, must land on the bar the
    // score calls 26.
    const score = scoreWithSilence(24);
    const part = extractPart(score, score.tracks[0].id)!;
    expect(part.tracks[0].measures.map((m) => m.index)).toEqual([0, 1, 16, 25]);
  });

  it('leaves the score it was given uncollapsed', () => {
    const score = scoreWithSilence(24);
    const before = score.tracks[0].measures.length;
    extractPart(score, score.tracks[0].id);
    expect(score.tracks[0].measures).toHaveLength(before);
  });

  it('collapses after transposing, so both apply to one part', () => {
    const score = scoreWithSilence(4);
    const clarinet: Score = {
      ...score,
      tracks: score.tracks.map((t) => ({ ...t, midiProgram: 71 })),
    };
    const part = extractPart(clarinet, clarinet.tracks[0].id)!;
    expect(part.tracks[0].measures[1].multiMeasureRestCount).toBe(4);
    expect(part.tracks[0].measures[0].keySignature.fifths).toBe(2);
  });
});

describe('extractPart carries the score-wide marks', () => {
  /** Two tracks, 40 bars, everything sounding. */
  function twoTrackFull(): Score {
    const base = createEmptyScore({
      title: 'Marks',
      measures: 40,
      tracks: [
        { name: 'One', instrumentName: 'Piano', clef: 'treble' as const },
        { name: 'Two', instrumentName: 'Piano', clef: 'bass' as const },
      ],
    });
    return base.tracks.reduce(
      (acc, track) =>
        track.measures.reduce(
          (inner, m) =>
            addNoteCommand({
              trackId: track.id,
              measureId: m.id,
              voiceIndex: 0,
              pitch: pitch('C'),
              startTick: m.startTick,
              durationTicks: base.ppq,
            }).execute(inner),
          acc,
        ),
      base,
    );
  }

  it('gives both parts the same letters at the same bars', () => {
    // The single most important property: "from B" means one bar for everyone.
    const score = twoTrackFull();
    const labelsOf = (trackId: string) =>
      extractPart(score, trackId)!
        .tracks[0].measures.filter((m) => m.rehearsalMark !== undefined)
        .map((m) => [m.index, m.rehearsalMark] as const);

    expect(labelsOf(score.tracks[0].id)).toEqual(labelsOf(score.tracks[1].id));
    expect(labelsOf(score.tracks[0].id).length).toBeGreaterThan(0);
  });

  it('marks the part from the whole score, not from that track alone', () => {
    // Silencing track two must still mark track one's part at the entrance,
    // because a landmark belongs to everybody.
    const base = twoTrackFull();
    const score: Score = {
      ...base,
      tracks: base.tracks.map((t, i) =>
        i === 1
          ? { ...t, measures: t.measures.map((m, j) => (j >= 4 && j <= 8 ? { ...m, voices: [] } : m)) }
          : t,
      ),
    };
    const first = extractPart(score, score.tracks[0].id)!;
    expect(first.tracks[0].measures.some((m) => m.index === 9 && m.rehearsalMark)).toBe(true);
  });
});

describe('extractPart cues an entry after a long rest', () => {
  /** Two tracks, `bars` bars, everything sounding; track 0's program is `program`. */
  function twoTrack(bars: number, program: number): Score {
    const base = createEmptyScore({
      title: 'Cue',
      measures: bars,
      tracks: [
        { name: 'Solo', instrumentName: 'Solo', clef: 'treble' as const },
        { name: 'Piano', instrumentName: 'Piano', clef: 'bass' as const },
      ],
    });
    const withProgram: Score = {
      ...base,
      tracks: base.tracks.map((t, i) => (i === 0 ? { ...t, midiProgram: program } : t)),
    };
    return withProgram.tracks.reduce(
      (acc, track) =>
        track.measures.reduce(
          (inner, m) =>
            addNoteCommand({
              trackId: track.id,
              measureId: m.id,
              voiceIndex: 0,
              pitch: pitch('C'),
              startTick: m.startTick,
              durationTicks: base.ppq,
            }).execute(inner),
          acc,
        ),
      withProgram,
    );
  }

  /** `score` with track 0 silent from bar `from` to bar `to`, inclusive. */
  function hush(score: Score, from: number, to: number): Score {
    return {
      ...score,
      tracks: score.tracks.map((t, i) =>
        i !== 0
          ? t
          : { ...t, measures: t.measures.map((m, j) => (j >= from && j <= to ? { ...m, voices: [] } : m)) },
      ),
    };
  }

  it('puts a cue on the bar before the entry', () => {
    const score = hush(twoTrack(30, 0), 1, 20);
    const part = extractPart(score, score.tracks[0].id)!;
    const cued = part.tracks[0].measures.find((m) => m.cue !== undefined);
    expect(cued?.index).toBe(20);
    expect(cued?.cue?.label).toBe('Piano');
  });

  it('writes the cue in the part’s own transposition', () => {
    // A clarinet reads a tone above concert pitch. A cue printed at concert
    // pitch inside its part is a tone wrong against everything around it —
    // worse than no cue. This is the test that catches a pipeline reordering.
    const cueNote = (score: Score) => {
      const part = extractPart(score, score.tracks[0].id)!;
      const cue = part.tracks[0].measures.find((m) => m.cue !== undefined)!.cue!;
      return pitchToMidi(cue.events.filter(isNoteEvent)[0].pitch);
    };

    // Program 71 is a clarinet: written a tone above what it sounds.
    expect(cueNote(hush(twoTrack(30, 71), 1, 20)) - cueNote(hush(twoTrack(30, 0), 1, 20))).toBe(2);
  });

  it('leaves the cue bar written out rather than collapsed', () => {
    const score = hush(twoTrack(30, 0), 1, 20);
    const part = extractPart(score, score.tracks[0].id)!;
    const cued = part.tracks[0].measures.find((m) => m.cue !== undefined)!;
    expect(cued.multiMeasureRestCount).toBeUndefined();
  });
});
