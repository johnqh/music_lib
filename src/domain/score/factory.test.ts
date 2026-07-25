import { describe, expect, it } from 'vitest';
import { appendMeasure, createEmptyScore, createTrack, rebuildMeasureTicks } from './factory';
import { isRestEvent } from '@sudobility/music_types';
import { measureDurationTicks } from '../time/ticks';

describe('createTrack', () => {
  it('fills in defaults for an unspecified instrument track', () => {
    const track = createTrack({ name: 'Lead' });
    expect(track.name).toBe('Lead');
    expect(track.id).toBeTruthy();
    expect(track.midiChannel).toBeGreaterThanOrEqual(0);
    expect(track.midiProgram).toBeGreaterThanOrEqual(0);
    expect(track.volume).toBe(1);
    expect(track.pan).toBe(0);
    expect(track.muted).toBe(false);
    expect(track.solo).toBe(false);
    expect(track.measures).toEqual([]);
  });

  it('respects explicit overrides', () => {
    const track = createTrack({ name: 'Bass', clef: 'bass', midiProgram: 33, midiChannel: 2 });
    expect(track.clef).toBe('bass');
    expect(track.midiProgram).toBe(33);
    expect(track.midiChannel).toBe(2);
  });

  it('generates a unique id per call', () => {
    const a = createTrack({ name: 'A' });
    const b = createTrack({ name: 'B' });
    expect(a.id).not.toBe(b.id);
  });
});

describe('createEmptyScore', () => {
  it('builds a score with sensible defaults from just a title', () => {
    const score = createEmptyScore({ title: 'Untitled' });
    expect(score.metadata.title).toBe('Untitled');
    expect(score.ppq).toBe(480);
    expect(score.version).toBe(1);
    expect(score.tempoMap).toEqual([{ id: expect.any(String), tick: 0, bpm: 120 }]);
    expect(score.tracks.length).toBeGreaterThan(0);
  });

  it('builds consistent measures with index/startTick/durationTicks per track', () => {
    const score = createEmptyScore({
      title: 'Twinkle',
      ppq: 480,
      measures: 3,
      timeSignature: { numerator: 4, denominator: 4 },
      tracks: [{ name: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' }],
    });

    const track = score.tracks[0];
    expect(track.measures).toHaveLength(3);

    const measureTicks = measureDurationTicks({ numerator: 4, denominator: 4 }, 480);
    track.measures.forEach((measure, i) => {
      expect(measure.index).toBe(i);
      expect(measure.startTick).toBe(i * measureTicks);
      expect(measure.durationTicks).toBe(measureTicks);
    });
  });

  it('fills each measure with one default voice containing a rest spanning the full measure', () => {
    const score = createEmptyScore({
      title: 'Twinkle',
      measures: 1,
      tracks: [{ name: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' }],
    });

    const measure = score.tracks[0].measures[0];
    expect(measure.voices).toHaveLength(1);
    const [voice] = measure.voices;
    expect(voice.events).toHaveLength(1);
    const [event] = voice.events;
    expect(isRestEvent(event)).toBe(true);
    expect(event.startTick).toBe(measure.startTick);
    expect(event.durationTicks).toBe(measure.durationTicks);
    expect(event.voiceId).toBe(voice.id);
    expect(event.trackId).toBe(score.tracks[0].id);
  });

  it('builds one set of measures per requested track, independently', () => {
    const score = createEmptyScore({
      title: 'Duet',
      measures: 2,
      tracks: [
        { name: 'Treble', clef: 'treble' },
        { name: 'Bass', clef: 'bass' },
      ],
    });

    expect(score.tracks).toHaveLength(2);
    expect(score.tracks[0].measures).toHaveLength(2);
    expect(score.tracks[1].measures).toHaveLength(2);
    // Each track's measures/voices/events must have distinct ids.
    const trackMeasureIds = score.tracks[0].measures.map((m) => m.id);
    const otherMeasureIds = score.tracks[1].measures.map((m) => m.id);
    expect(trackMeasureIds.some((id) => otherMeasureIds.includes(id))).toBe(false);
  });
});

describe('appendMeasure', () => {
  it('appends one more measure to every track, continuing tick numbering', () => {
    const score = createEmptyScore({
      title: 'Grows',
      measures: 2,
      tracks: [{ name: 'Piano' }],
    });

    const grown = appendMeasure(score);
    const track = grown.tracks[0];
    expect(track.measures).toHaveLength(3);

    const measureTicks = measureDurationTicks({ numerator: 4, denominator: 4 }, 480);
    const newMeasure = track.measures[2];
    expect(newMeasure.index).toBe(2);
    expect(newMeasure.startTick).toBe(2 * measureTicks);
    expect(newMeasure.durationTicks).toBe(measureTicks);
    expect(newMeasure.voices[0].events[0].startTick).toBe(newMeasure.startTick);
  });

  it('does not mutate the original score', () => {
    const score = createEmptyScore({ title: 'Immutable', measures: 1, tracks: [{ name: 'Piano' }] });
    appendMeasure(score);
    expect(score.tracks[0].measures).toHaveLength(1);
  });
});

describe('rebuildMeasureTicks', () => {
  it('recomputes index/startTick after a measure is removed from the middle', () => {
    const score = createEmptyScore({ title: 'Edited', measures: 3, tracks: [{ name: 'Piano' }] });
    const [m0, , m2] = score.tracks[0].measures;
    const edited = {
      ...score,
      tracks: [{ ...score.tracks[0], measures: [m0, m2] }],
    };

    const rebuilt = rebuildMeasureTicks(edited);
    const measures = rebuilt.tracks[0].measures;
    expect(measures).toHaveLength(2);
    expect(measures[0].index).toBe(0);
    expect(measures[0].startTick).toBe(0);
    expect(measures[1].index).toBe(1);
    expect(measures[1].startTick).toBe(measures[0].durationTicks);
  });

  it('shifts event startTicks within a measure by the same delta as the measure', () => {
    const score = createEmptyScore({ title: 'Edited', measures: 3, tracks: [{ name: 'Piano' }] });
    const [m0, , m2] = score.tracks[0].measures;
    const edited = { ...score, tracks: [{ ...score.tracks[0], measures: [m0, m2] }] };

    const rebuilt = rebuildMeasureTicks(edited);
    const secondMeasure = rebuilt.tracks[0].measures[1];
    expect(secondMeasure.voices[0].events[0].startTick).toBe(secondMeasure.startTick);
  });

  it('is a no-op (referentially, per measure) when ticks are already consistent', () => {
    const score = createEmptyScore({ title: 'Stable', measures: 2, tracks: [{ name: 'Piano' }] });
    const rebuilt = rebuildMeasureTicks(score);
    expect(rebuilt.tracks[0].measures[0]).toBe(score.tracks[0].measures[0]);
    expect(rebuilt.tracks[0].measures[1]).toBe(score.tracks[0].measures[1]);
  });
});
