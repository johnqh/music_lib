/**
 * `exportMusicXml` unit tests (Task 8 brief): assert on the *parsed*
 * document structure (via `DOMParser`, available in jsdom per the brief)
 * rather than raw string matching, so tests aren't brittle to incidental
 * whitespace/attribute-order choices.
 */
import { describe, expect, it } from 'vitest';
import { escapeXml, exportMusicXml, safeFilename } from './export.js';
import { createId } from '../../domain/score/ids.js';
import type { Measure, NoteEvent, Score, Track } from '@sudobility/music_types';
import { measureDurationTicks, ticksFor } from '../../domain/time/ticks.js';
import { chordScore, twinkleScore, twoTrackScore } from '../../test/fixtures.js';

function parse(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parserError = doc.getElementsByTagName('parsererror');
  expect(parserError.length, `XML failed to parse: ${xml.slice(0, 500)}`).toBe(0);
  return doc;
}

function textOf(el: Element | null | undefined, selector: string): string | null {
  return el?.querySelector(selector)?.textContent ?? null;
}

describe('exportMusicXml', () => {
  it('produces a well-formed score-partwise 4.0 document with work title and part-list', () => {
    const doc = parse(exportMusicXml(twinkleScore()));
    const root = doc.documentElement;
    expect(root.tagName).toBe('score-partwise');
    expect(root.getAttribute('version')).toBe('4.0');
    expect(textOf(doc.documentElement, 'work > work-title')).toBe('Twinkle Twinkle Little Star');

    const scoreParts = doc.querySelectorAll('part-list > score-part');
    expect(scoreParts).toHaveLength(1);
    expect(textOf(scoreParts[0], 'part-name')).toBe('Piano');
    expect(textOf(scoreParts[0], 'midi-instrument > midi-channel')).toBe('1'); // domain 0 -> xml 1
    expect(textOf(scoreParts[0], 'midi-instrument > midi-program')).toBe('1'); // domain 0 -> xml 1
  });

  it('emits divisions/key/time/clef attributes on the first measure', () => {
    const doc = parse(exportMusicXml(twinkleScore()));
    const firstMeasure = doc.querySelector('part measure');
    expect(textOf(firstMeasure, 'attributes > divisions')).toBe('480');
    expect(textOf(firstMeasure, 'attributes > key > fifths')).toBe('0');
    expect(textOf(firstMeasure, 'attributes > key > mode')).toBe('major');
    expect(textOf(firstMeasure, 'attributes > time > beats')).toBe('4');
    expect(textOf(firstMeasure, 'attributes > time > beat-type')).toBe('4');
    expect(textOf(firstMeasure, 'attributes > clef > sign')).toBe('G');
    expect(textOf(firstMeasure, 'attributes > clef > line')).toBe('2');
  });

  it('does not repeat unchanged key/time attributes on later measures', () => {
    const doc = parse(exportMusicXml(twinkleScore()));
    const measures = doc.querySelectorAll('part measure');
    expect(measures.length).toBe(8);
    for (let i = 1; i < measures.length; i += 1) {
      expect(measures[i].querySelector('attributes > key')).toBeNull();
      expect(measures[i].querySelector('attributes > time')).toBeNull();
      expect(measures[i].querySelector('attributes > divisions')).toBeNull();
    }
  });

  it('emits a bass clef for a bass-clef track', () => {
    const doc = parse(exportMusicXml(twoTrackScore()));
    const parts = doc.querySelectorAll('part');
    expect(parts).toHaveLength(2);
    const bassPart = parts[1];
    expect(textOf(bassPart, 'measure > attributes > clef > sign')).toBe('F');
    expect(textOf(bassPart, 'measure > attributes > clef > line')).toBe('4');
  });

  it('emits notes with pitch/duration/voice/type matching the domain note', () => {
    const doc = parse(exportMusicXml(twinkleScore()));
    const firstNote = doc.querySelector('part measure note');
    expect(firstNote).not.toBeNull();
    expect(textOf(firstNote, 'pitch > step')).toBe('C');
    expect(firstNote?.querySelector('pitch > alter')).toBeNull(); // natural: no <alter>
    expect(textOf(firstNote, 'pitch > octave')).toBe('4');
    expect(textOf(firstNote, 'duration')).toBe('480'); // quarter at ppq 480
    expect(textOf(firstNote, 'voice')).toBe('1');
    expect(textOf(firstNote, 'type')).toBe('quarter');
    expect(firstNote?.querySelector('rest')).toBeNull();
  });

  it('emits a sharp/flat as <alter>', () => {
    const trackId = createId();
    const track: Track = {
      id: trackId,
      name: 'Piano',
      instrumentName: 'Piano',
      midiProgram: 0,
      midiChannel: 0,
      clef: 'treble',
      volume: 1,
      pan: 0,
      muted: false,
      solo: false,
      measures: [
        {
          id: createId(),
          index: 0,
          startTick: 0,
          durationTicks: measureDurationTicks({ numerator: 4, denominator: 4 }, 480),
          timeSignature: { numerator: 4, denominator: 4 },
          keySignature: { fifths: 0, mode: 'major' },
          voices: [
            {
              id: createId(),
              name: 'Voice 1',
              events: [
                {
                  id: createId(),
                  pitch: { step: 'F', accidental: 1, octave: 4 },
                  startTick: 0,
                  durationTicks: measureDurationTicks({ numerator: 4, denominator: 4 }, 480),
                  velocity: 80,
                  voiceId: 'v',
                  trackId,
                } as NoteEvent,
              ],
            },
          ],
        },
      ],
    };
    const score: Score = {
      id: createId(),
      version: 1,
      ppq: 480,
      metadata: { title: 'Sharp Test', createdAt: 'x', updatedAt: 'x' },
      tempoMap: [{ id: createId(), tick: 0, bpm: 120 }],
      tracks: [track],
    };
    const doc = parse(exportMusicXml(score));
    expect(textOf(doc.documentElement, 'note > pitch > step')).toBe('F');
    expect(textOf(doc.documentElement, 'note > pitch > alter')).toBe('1');
  });

  it('emits chord notes with <chord/> on every note after the first at a shared start tick', () => {
    const doc = parse(exportMusicXml(chordScore()));
    const firstMeasureNotes = (doc.querySelector('part measure') as Element).querySelectorAll('note');
    expect(firstMeasureNotes).toHaveLength(3); // C-E-G triad
    expect(firstMeasureNotes[0].querySelector('chord')).toBeNull();
    expect(firstMeasureNotes[1].querySelector('chord')).not.toBeNull();
    expect(firstMeasureNotes[2].querySelector('chord')).not.toBeNull();
    // Whole-measure chord in 4/4 at ppq 480 -> whole note, 1920 ticks.
    for (const note of Array.from(firstMeasureNotes)) {
      expect(textOf(note, 'duration')).toBe('1920');
      expect(textOf(note, 'type')).toBe('whole');
    }
  });

  it('emits a <backup> between voices and gives each voice its own <voice> number', () => {
    const ppq = 480;
    const ts = { numerator: 4, denominator: 4 };
    const trackId = createId();
    const measureTicks = measureDurationTicks(ts, ppq);
    const voice1Id = createId();
    const voice2Id = createId();
    const measure: Measure = {
      id: createId(),
      index: 0,
      startTick: 0,
      durationTicks: measureTicks,
      timeSignature: ts,
      keySignature: { fifths: 0, mode: 'major' },
      voices: [
        {
          id: voice1Id,
          name: 'Voice 1',
          events: [
            {
              id: createId(),
              pitch: { step: 'C', accidental: 0, octave: 5 },
              startTick: 0,
              durationTicks: measureTicks,
              velocity: 80,
              voiceId: voice1Id,
              trackId,
            } as NoteEvent,
          ],
        },
        {
          id: voice2Id,
          name: 'Voice 2',
          events: [
            {
              id: createId(),
              pitch: { step: 'C', accidental: 0, octave: 3 },
              startTick: 0,
              durationTicks: measureTicks,
              velocity: 80,
              voiceId: voice2Id,
              trackId,
            } as NoteEvent,
          ],
        },
      ],
    };
    const track: Track = {
      id: trackId,
      name: 'Piano',
      instrumentName: 'Piano',
      midiProgram: 0,
      midiChannel: 0,
      clef: 'treble',
      volume: 1,
      pan: 0,
      muted: false,
      solo: false,
      measures: [measure],
    };
    const score: Score = {
      id: createId(),
      version: 1,
      ppq,
      metadata: { title: 'Two Voices', createdAt: 'x', updatedAt: 'x' },
      tempoMap: [{ id: createId(), tick: 0, bpm: 120 }],
      tracks: [track],
    };

    const doc = parse(exportMusicXml(score));
    const measureEl = doc.querySelector('part measure') as Element;
    const children = Array.from(measureEl.children).map((c) => c.tagName);
    const backupIndex = children.indexOf('backup');
    expect(backupIndex).toBeGreaterThan(-1);

    const notes = doc.querySelectorAll('part measure note');
    expect(notes).toHaveLength(2);
    expect(textOf(notes[0], 'voice')).toBe('1');
    expect(textOf(notes[1], 'voice')).toBe('2');
    expect(textOf(measureEl, 'backup > duration')).toBe(String(measureTicks));
  });

  it('splits a duration that does not notate as a single value into tied notes', () => {
    // A 6/8 measure (1440 ticks at ppq 480) holding one note spanning the
    // first 5 eighth notes (1200 ticks -- not a single, possibly-dotted
    // notated value) followed by a rest filling the last eighth note.
    const ppq = 480;
    const ts = { numerator: 6, denominator: 8 };
    const trackId = createId();
    const voiceId = createId();
    const durationTicks = measureDurationTicks(ts, ppq);
    expect(durationTicks).toBe(6 * ticksFor('eighth', ppq));
    const noteTicks = 5 * ticksFor('eighth', ppq);
    const measure: Measure = {
      id: createId(),
      index: 0,
      startTick: 0,
      durationTicks,
      timeSignature: ts,
      keySignature: { fifths: 0, mode: 'major' },
      voices: [
        {
          id: voiceId,
          name: 'Voice 1',
          events: [
            {
              id: createId(),
              pitch: { step: 'A', accidental: 0, octave: 4 },
              startTick: 0,
              durationTicks: noteTicks,
              velocity: 80,
              voiceId,
              trackId,
            } as NoteEvent,
            {
              id: createId(),
              startTick: noteTicks,
              durationTicks: durationTicks - noteTicks,
              voiceId,
              trackId,
            },
          ],
        },
      ],
    };
    const track: Track = {
      id: trackId,
      name: 'Piano',
      instrumentName: 'Piano',
      midiProgram: 0,
      midiChannel: 0,
      clef: 'treble',
      volume: 1,
      pan: 0,
      muted: false,
      solo: false,
      measures: [measure],
    };
    const score: Score = {
      id: createId(),
      version: 1,
      ppq,
      metadata: { title: 'Six Eight Tie Split', createdAt: 'x', updatedAt: 'x' },
      tempoMap: [{ id: createId(), tick: 0, bpm: 120 }],
      tracks: [track],
    };

    const doc = parse(exportMusicXml(score));
    expect(textOf(doc.documentElement, 'attributes > time > beats')).toBe('6');
    expect(textOf(doc.documentElement, 'attributes > time > beat-type')).toBe('8');

    const allNotes = Array.from(doc.querySelectorAll('part measure note'));
    const notes = allNotes.filter((n) => n.querySelector('rest') === null); // exclude the trailing filler rest
    expect(notes.length).toBeGreaterThan(1);
    const durations = notes.map((n) => Number(textOf(n, 'duration')));
    expect(durations.reduce((a, b) => a + b, 0)).toBe(noteTicks);

    expect(notes[0].querySelector('tie[type="start"]')).not.toBeNull();
    expect(notes[0].querySelector('tie[type="stop"]')).toBeNull();
    const last = notes[notes.length - 1];
    expect(last.querySelector('tie[type="stop"]')).not.toBeNull();
    expect(last.querySelector('tie[type="start"]')).toBeNull();
  });

  it('emits <tie>/<tied> for a note that already has tieStart/tieStop set (e.g. a tie split at a barline)', () => {
    const ppq = 480;
    const ts = { numerator: 4, denominator: 4 };
    const trackId = createId();
    const measureTicks = measureDurationTicks(ts, ppq);
    const halfTicks = ticksFor('half', ppq);
    const voice1Id = createId();
    const voice2Id = createId();
    const measures: Measure[] = [
      {
        id: createId(),
        index: 0,
        startTick: 0,
        durationTicks: measureTicks,
        timeSignature: ts,
        keySignature: { fifths: 0, mode: 'major' },
        voices: [
          {
            id: voice1Id,
            name: 'Voice 1',
            events: [
              {
                id: createId(),
                pitch: { step: 'G', accidental: 0, octave: 4 },
                startTick: measureTicks - halfTicks,
                durationTicks: halfTicks,
                velocity: 80,
                voiceId: voice1Id,
                trackId,
                tieStart: true,
              } as NoteEvent,
              {
                id: createId(),
                pitch: { step: 'G', accidental: 0, octave: 4 },
                startTick: 0,
                durationTicks: measureTicks - halfTicks,
                velocity: 80,
                voiceId: voice1Id,
                trackId,
              } as NoteEvent,
            ],
          },
        ],
      },
      {
        id: createId(),
        index: 1,
        startTick: measureTicks,
        durationTicks: measureTicks,
        timeSignature: ts,
        keySignature: { fifths: 0, mode: 'major' },
        voices: [
          {
            id: voice2Id,
            name: 'Voice 1',
            events: [
              {
                id: createId(),
                pitch: { step: 'G', accidental: 0, octave: 4 },
                startTick: measureTicks,
                durationTicks: halfTicks,
                velocity: 80,
                voiceId: voice2Id,
                trackId,
                tieStop: true,
              } as NoteEvent,
              {
                id: createId(),
                pitch: { step: 'A', accidental: 0, octave: 4 },
                startTick: measureTicks + halfTicks,
                durationTicks: measureTicks - halfTicks,
                velocity: 80,
                voiceId: voice2Id,
                trackId,
              } as NoteEvent,
            ],
          },
        ],
      },
    ];
    const track: Track = {
      id: trackId,
      name: 'Piano',
      instrumentName: 'Piano',
      midiProgram: 0,
      midiChannel: 0,
      clef: 'treble',
      volume: 1,
      pan: 0,
      muted: false,
      solo: false,
      measures,
    };
    const score: Score = {
      id: createId(),
      version: 1,
      ppq,
      metadata: { title: 'Tie Across Barline', createdAt: 'x', updatedAt: 'x' },
      tempoMap: [{ id: createId(), tick: 0, bpm: 120 }],
      tracks: [track],
    };

    const doc = parse(exportMusicXml(score));
    const parts = doc.querySelectorAll('part measure');
    const measure1Notes = parts[0].querySelectorAll('note');
    const measure2Notes = parts[1].querySelectorAll('note');
    const tieStartNote = measure1Notes[1]; // the second-written note is the one starting the tie (G at beat 3)
    expect(tieStartNote.querySelector('tie[type="start"]')).not.toBeNull();
    expect(tieStartNote.querySelector('notations > tied[type="start"]')).not.toBeNull();
    const tieStopNote = measure2Notes[0];
    expect(tieStopNote.querySelector('tie[type="stop"]')).not.toBeNull();
    expect(tieStopNote.querySelector('notations > tied[type="stop"]')).not.toBeNull();
  });

  it('emits articulations mapped to their MusicXML element (marcato -> strong-accent)', () => {
    const ppq = 480;
    const trackId = createId();
    const voiceId = createId();
    const ts = { numerator: 4, denominator: 4 };
    const measureTicks = measureDurationTicks(ts, ppq);
    const q = ticksFor('quarter', ppq);
    const articulations = ['staccato', 'accent', 'tenuto', 'marcato'] as const;
    const events: NoteEvent[] = articulations.map((articulation, i) => ({
      id: createId(),
      pitch: { step: 'C', accidental: 0, octave: 4 },
      startTick: i * q,
      durationTicks: q,
      velocity: 80,
      voiceId,
      trackId,
      articulation,
    }));
    const measure: Measure = {
      id: createId(),
      index: 0,
      startTick: 0,
      durationTicks: measureTicks,
      timeSignature: ts,
      keySignature: { fifths: 0, mode: 'major' },
      voices: [{ id: voiceId, name: 'Voice 1', events }],
    };
    const track: Track = {
      id: trackId,
      name: 'Piano',
      instrumentName: 'Piano',
      midiProgram: 0,
      midiChannel: 0,
      clef: 'treble',
      volume: 1,
      pan: 0,
      muted: false,
      solo: false,
      measures: [measure],
    };
    const score: Score = {
      id: createId(),
      version: 1,
      ppq,
      metadata: { title: 'Articulations', createdAt: 'x', updatedAt: 'x' },
      tempoMap: [{ id: createId(), tick: 0, bpm: 120 }],
      tracks: [track],
    };

    const doc = parse(exportMusicXml(score));
    const notes = doc.querySelectorAll('part measure note');
    expect(notes[0].querySelector('notations > articulations > staccato')).not.toBeNull();
    expect(notes[1].querySelector('notations > articulations > accent')).not.toBeNull();
    expect(notes[2].querySelector('notations > articulations > tenuto')).not.toBeNull();
    expect(notes[3].querySelector('notations > articulations > strong-accent')).not.toBeNull();
  });

  it('emits a rest as <rest/> with no <pitch>', () => {
    const doc = parse(exportMusicXml(twinkleScore()));
    // twinkleScore has no rests; build a tiny score with one.
    const ppq = 480;
    const trackId = createId();
    const voiceId = createId();
    const ts = { numerator: 4, denominator: 4 };
    const measureTicks = measureDurationTicks(ts, ppq);
    const measure: Measure = {
      id: createId(),
      index: 0,
      startTick: 0,
      durationTicks: measureTicks,
      timeSignature: ts,
      keySignature: { fifths: 0, mode: 'major' },
      voices: [
        { id: voiceId, name: 'Voice 1', events: [{ id: createId(), startTick: 0, durationTicks: measureTicks, voiceId, trackId }] },
      ],
    };
    const track: Track = {
      id: trackId,
      name: 'Piano',
      instrumentName: 'Piano',
      midiProgram: 0,
      midiChannel: 0,
      clef: 'treble',
      volume: 1,
      pan: 0,
      muted: false,
      solo: false,
      measures: [measure],
    };
    const restScore: Score = {
      id: createId(),
      version: 1,
      ppq,
      metadata: { title: 'Rest', createdAt: 'x', updatedAt: 'x' },
      tempoMap: [{ id: createId(), tick: 0, bpm: 120 }],
      tracks: [track],
    };
    const restDoc = parse(exportMusicXml(restScore));
    const note = restDoc.querySelector('part measure note') as Element;
    expect(note.querySelector('rest')).not.toBeNull();
    expect(note.querySelector('pitch')).toBeNull();
    expect(textOf(note, 'duration')).toBe(String(measureTicks));
    void doc; // (twinkleScore doc parsed above only to sanity-check no rests present)
  });

  it('emits a tempo direction with <sound tempo> on the first measure of the first part only', () => {
    const doc = parse(exportMusicXml(twoTrackScore()));
    const parts = doc.querySelectorAll('part');
    expect(parts[0].querySelector('measure direction sound')?.getAttribute('tempo')).toBe('120');
    expect(parts[1].querySelector('measure direction sound')).toBeNull();
  });

  it('escapes XML-significant characters in the title', () => {
    expect(escapeXml('A & B < C > "D" \'E\'')).toBe('A &amp; B &lt; C &gt; &quot;D&quot; &apos;E&apos;');
    const score: Score = {
      id: createId(),
      version: 1,
      ppq: 480,
      metadata: { title: 'Rock & Roll <Suite>', createdAt: 'x', updatedAt: 'x' },
      tempoMap: [{ id: createId(), tick: 0, bpm: 120 }],
      tracks: [],
    };
    const doc = parse(exportMusicXml(score));
    expect(textOf(doc.documentElement, 'work > work-title')).toBe('Rock & Roll <Suite>');
  });
});

describe('safeFilename', () => {
  it('slugifies a title into a lowercase-hyphenated filename', () => {
    expect(safeFilename('Twinkle Twinkle Little Star')).toBe('twinkle-twinkle-little-star');
  });

  it('falls back to "untitled" for a title with no alphanumeric characters', () => {
    expect(safeFilename('   ')).toBe('untitled');
    expect(safeFilename('***')).toBe('untitled');
  });
});
