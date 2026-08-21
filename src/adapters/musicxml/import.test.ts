import { testXmlParser } from '../../test/platform.js';
import { describe, expect, it } from 'vitest';
import { TEST_MUSICXML_WARNINGS } from '../../test/musicxml-warnings.js';
import { importMusicXml } from './import.js';
import { isNoteEvent, isRestEvent } from '@sudobility/music_types';
import type { NoteEvent } from '@sudobility/music_types';
import { pitchToMidi } from '../../domain/pitch/pitch.js';
import { ticksFor } from '../../domain/time/ticks.js';

// The mocks parser, not the web one: music_io/web imports music_lib, so
// reaching for it here would pull this package's own published dist back in
// through its dependency. The mocks entry depends on nothing of ours.
const parser = testXmlParser();

const MINIMAL_HEADER = (
  extraPartAttrs = ''
) => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
<work><work-title>Test Score</work-title></work>
<part-list>
<score-part id="P1"><part-name>Piano</part-name><midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part>
</part-list>
<part id="P1">
${extraPartAttrs}
</part>
</score-partwise>`;

describe('importMusicXml: structure/metadata', () => {
  it('throws on malformed XML', () => {
    expect(() =>
      importMusicXml(
        '<score-partwise><unclosed>',
        parser,
        TEST_MUSICXML_WARNINGS
      )
    ).toThrow();
  });

  it('throws on a non-score-partwise root', () => {
    const timewise = `<?xml version="1.0"?><score-timewise version="4.0"></score-timewise>`;
    expect(() =>
      importMusicXml(timewise, parser, TEST_MUSICXML_WARNINGS)
    ).toThrow(/score-partwise/);
  });

  it('reads work title, composer, and part name/instrument', () => {
    const xml = `<?xml version="1.0"?>
<score-partwise version="4.0">
<work><work-title>My Song</work-title></work>
<identification><creator type="composer">Jane Doe</creator></identification>
<part-list><score-part id="P1"><part-name>Lead Piano</part-name><midi-instrument id="P1-I1"><midi-channel>2</midi-channel><midi-program>5</midi-program></midi-instrument></score-part></part-list>
<part id="P1"><measure number="1">
<attributes><divisions>480</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><rest/><duration>1920</duration><voice>1</voice><type>whole</type></note>
</measure></part>
</score-partwise>`;
    const { score } = importMusicXml(xml, parser, TEST_MUSICXML_WARNINGS);
    expect(score.metadata.title).toBe('My Song');
    expect(score.metadata.composer).toBe('Jane Doe');
    expect(score.tracks[0].name).toBe('Lead Piano');
    expect(score.tracks[0].midiChannel).toBe(1); // xml 2 -> domain 1
    expect(score.tracks[0].midiProgram).toBe(4); // xml 5 -> domain 4
  });

  it('defaults the title when there is no <work-title>', () => {
    const xml = `<?xml version="1.0"?>
<score-partwise version="4.0">
<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1">
<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><rest/><duration>1920</duration><voice>1</voice></note>
</measure></part>
</score-partwise>`;
    const { score } = importMusicXml(xml, parser, TEST_MUSICXML_WARNINGS);
    expect(score.metadata.title).toBe('Imported MusicXML');
  });
});

describe('importMusicXml: notes/rests/duration', () => {
  it('parses a single quarter note with pitch/duration/voice', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type></note>
<note><rest/><duration>1440</duration><voice>1</voice><type>half</type><dot/></note>
</measure>`);
    const { score } = importMusicXml(xml, parser, TEST_MUSICXML_WARNINGS);
    const events = score.tracks[0].measures[0].voices[0].events;
    expect(events).toHaveLength(2);
    expect(isNoteEvent(events[0])).toBe(true);
    if (isNoteEvent(events[0])) {
      expect(pitchToMidi(events[0].pitch)).toBe(60);
      expect(events[0].durationTicks).toBe(480);
      expect(events[0].velocity).toBe(80); // documented default (MusicXML has no per-note velocity)
    }
    expect(isRestEvent(events[1])).toBe(true);
    expect(events[1].durationTicks).toBe(1440);
  });

  it('converts divisions correctly (source divisions != target ppq)', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>24</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>24</duration><voice>1</voice><type>quarter</type></note>
<note><rest/><duration>72</duration><voice>1</voice></note>
</measure>`);
    const { score } = importMusicXml(xml, parser, TEST_MUSICXML_WARNINGS);
    const events = score.tracks[0].measures[0].voices[0].events;
    expect(events[0].durationTicks).toBe(480); // 24 divisions @ ratio 20 -> 480 ticks
    expect(events[1].durationTicks).toBe(1440);
  });

  it('handles a sharp via <alter>', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>1920</duration><voice>1</voice><type>whole</type></note>
</measure>`);
    const { score } = importMusicXml(xml, parser, TEST_MUSICXML_WARNINGS);
    const note = score.tracks[0].measures[0].voices[0].events[0];
    expect(isNoteEvent(note) && note.pitch.accidental).toBe(1);
  });

  it('supports a <rest measure="yes"/> shorthand with no explicit <duration>', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
<note><rest measure="yes"/><voice>1</voice></note>
</measure>`);
    const { score } = importMusicXml(xml, parser, TEST_MUSICXML_WARNINGS);
    const events = score.tracks[0].measures[0].voices[0].events;
    expect(events).toHaveLength(1);
    expect(events[0].durationTicks).toBe(3 * ticksFor('quarter', 480));
  });
});

describe('importMusicXml: chords and voices', () => {
  it('groups <chord/>-flagged notes onto the same start tick without advancing the cursor', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>1920</duration><voice>1</voice><type>whole</type></note>
<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1920</duration><voice>1</voice><type>whole</type></note>
<note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>1920</duration><voice>1</voice><type>whole</type></note>
</measure>`);
    const { score } = importMusicXml(xml, parser, TEST_MUSICXML_WARNINGS);
    const events = score.tracks[0].measures[0].voices[0].events;
    expect(events).toHaveLength(3);
    expect(new Set(events.map(e => e.startTick))).toEqual(new Set([0]));
    expect(
      events.map(e => isNoteEvent(e) && pitchToMidi(e.pitch)).sort()
    ).toEqual([60, 64, 67]);
  });

  it('separates voices via <backup>, correlating by ordinal position', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>5</octave></pitch><duration>1920</duration><voice>1</voice><type>whole</type></note>
<backup><duration>1920</duration></backup>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>1920</duration><voice>2</voice><type>whole</type></note>
</measure>`);
    const { score } = importMusicXml(xml, parser, TEST_MUSICXML_WARNINGS);
    const voices = score.tracks[0].measures[0].voices;
    expect(voices).toHaveLength(2);
    const v1 = voices[0].events[0];
    const v2 = voices[1].events[0];
    expect(isNoteEvent(v1) && pitchToMidi(v1.pitch)).toBe(72); // C5
    expect(isNoteEvent(v2) && pitchToMidi(v2.pitch)).toBe(48); // C3
  });

  it('fills a gap left by <forward/> with a rest', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<forward><duration>480</duration></forward>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>1440</duration><voice>1</voice><type>half</type><dot/></note>
</measure>`);
    const { score } = importMusicXml(xml, parser, TEST_MUSICXML_WARNINGS);
    const events = score.tracks[0].measures[0].voices[0].events;
    expect(events).toHaveLength(2);
    expect(isRestEvent(events[0])).toBe(true);
    expect(events[0].startTick).toBe(0);
    expect(events[0].durationTicks).toBe(480);
    expect(events[1].startTick).toBe(480);
  });
});

describe('importMusicXml: ties and articulations', () => {
  it('sets tieStart/tieStop from <tie type="..."/>', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>G</step><octave>4</octave></pitch><duration>1920</duration><tie type="start"/><voice>1</voice><type>whole</type><notations><tied type="start"/></notations></note>
</measure>
<measure number="2">
<note><pitch><step>G</step><octave>4</octave></pitch><duration>1920</duration><tie type="stop"/><voice>1</voice><type>whole</type><notations><tied type="stop"/></notations></note>
</measure>`);
    const { score } = importMusicXml(xml, parser, TEST_MUSICXML_WARNINGS);
    const first = score.tracks[0].measures[0].voices[0].events[0];
    const second = score.tracks[0].measures[1].voices[0].events[0];
    expect(isNoteEvent(first) && first.tieStart).toBe(true);
    expect(isNoteEvent(first) && first.tieStop).toBeUndefined();
    expect(isNoteEvent(second) && second.tieStop).toBe(true);
    expect(isNoteEvent(second) && second.tieStart).toBeUndefined();
  });

  it('maps <strong-accent> to marcato and other articulation elements to their domain equivalents', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type><notations><articulations><staccato/></articulations></notations></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type><notations><articulations><strong-accent type="up"/></articulations></notations></note>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>960</duration><voice>1</voice><type>half</type></note>
</measure>`);
    const { score } = importMusicXml(xml, parser, TEST_MUSICXML_WARNINGS);
    const events = score.tracks[0].measures[0].voices[0].events;
    expect(isNoteEvent(events[0]) && events[0].articulation).toBe('staccato');
    expect(isNoteEvent(events[1]) && events[1].articulation).toBe('marcato');
    expect(isNoteEvent(events[2]) && events[2].articulation).toBeUndefined();
  });
});

describe('importMusicXml: tempo', () => {
  it('reads <sound tempo> into the tempo map', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>96</per-minute></metronome></direction-type><sound tempo="96"/></direction>
<note><rest/><duration>1920</duration><voice>1</voice></note>
</measure>`);
    const { score } = importMusicXml(xml, parser, TEST_MUSICXML_WARNINGS);
    expect(score.tempoMap).toHaveLength(1);
    expect(score.tempoMap[0].tick).toBe(0);
    expect(score.tempoMap[0].bpm).toBe(96);
  });

  it('defaults to 120bpm and warns when no tempo direction is present', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><rest/><duration>1920</duration><voice>1</voice></note>
</measure>`);
    const { score, warnings } = importMusicXml(
      xml,
      parser,
      TEST_MUSICXML_WARNINGS
    );
    expect(score.tempoMap).toEqual([
      { id: expect.any(String), tick: 0, bpm: 120 },
    ]);
    expect(warnings.some(w => /no tempo direction/i.test(w))).toBe(true);
  });

  it('clamps an out-of-range tempo and warns', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<direction><sound tempo="1000"/></direction>
<note><rest/><duration>1920</duration><voice>1</voice></note>
</measure>`);
    const { score, warnings } = importMusicXml(
      xml,
      parser,
      TEST_MUSICXML_WARNINGS
    );
    expect(score.tempoMap[0].bpm).toBe(400);
    expect(warnings.some(w => /clamped/i.test(w))).toBe(true);
  });
});

describe('importMusicXml: unsupported/decorative elements never throw, and are reported', () => {
  it('imports lyrics rather than dropping them with a warning', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type><lyric><text>la</text></lyric></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>1440</duration><voice>1</voice><type>half</type><dot/><lyric><text>la</text></lyric></note>
</measure>`);
    const { score, warnings } = importMusicXml(
      xml,
      parser,
      TEST_MUSICXML_WARNINGS
    );
    const events = score.tracks[0].measures[0].voices[0].events;
    expect(events).toHaveLength(2);
    // They used to be dropped, and warned about once (deduplicated).
    expect(warnings.filter(w => /lyric/i.test(w))).toHaveLength(0);
    expect(events.filter(isNoteEvent).map(e => e.lyric?.text)).toEqual([
      'la',
      'la',
    ]);
  });

  it('reads how a syllable joins the next, which is what draws the hyphen', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type><lyric><syllabic>begin</syllabic><text>beau</text></lyric></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type><lyric><syllabic>end</syllabic><text>ty</text></lyric></note>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>960</duration><voice>1</voice><type>half</type><lyric><syllabic>single</syllabic><text>now</text></lyric></note>
</measure>`);
    const { score } = importMusicXml(xml, parser, TEST_MUSICXML_WARNINGS);
    const notes =
      score.tracks[0].measures[0].voices[0].events.filter(isNoteEvent);

    expect(notes[0].lyric).toEqual({ text: 'beau', syllabic: 'begin' });
    expect(notes[1].lyric).toEqual({ text: 'ty', syllabic: 'end' });
    // `single` is the model's default, so it is not stored.
    expect(notes[2].lyric).toEqual({ text: 'now' });
  });

  it('attaches a grace note to the note it decorates, taking no time from the bar', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><grace slash="yes"/><pitch><step>B</step><octave>4</octave></pitch><voice>1</voice><type>eighth</type></note>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>1920</duration><voice>1</voice><type>whole</type></note>
</measure>`);
    const { score, warnings } = importMusicXml(
      xml,
      parser,
      TEST_MUSICXML_WARNINGS
    );
    const events = score.tracks[0].measures[0].voices[0].events;

    // One event, not two: the ornament hangs off its principal.
    expect(events).toHaveLength(1);
    expect(events[0].durationTicks).toBe(1920);
    expect(warnings.some(w => /grace/i.test(w))).toBe(false);

    const principal = events[0] as NoteEvent;
    expect(principal.graceNotes).toHaveLength(1);
    expect(principal.graceNotes?.[0].pitch.step).toBe('B');
    expect(principal.graceNotes?.[0].slashed).toBe(true);
  });

  it('skips an unpitched note but still advances the cursor by its duration, so later notes keep their correct position', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched><duration>480</duration><voice>1</voice><type>quarter</type></note>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>1440</duration><voice>1</voice><type>half</type><dot/></note>
</measure>`);
    const { score, warnings } = importMusicXml(
      xml,
      parser,
      TEST_MUSICXML_WARNINGS
    );
    const events = score.tracks[0].measures[0].voices[0].events;
    // The unpitched note is skipped (a rest fills its slot); the pitched
    // note that follows must start at tick 480 (after it), not tick 0.
    expect(events).toHaveLength(2);
    expect(isRestEvent(events[0])).toBe(true);
    expect(events[0].startTick).toBe(0);
    expect(events[0].durationTicks).toBe(480);
    expect(isNoteEvent(events[1]) && events[1].startTick).toBe(480);
    expect(warnings.some(w => /unpitched/i.test(w))).toBe(true);
  });

  it('imports an ornament and a tuplet, warning about neither', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>320</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><notations><ornaments><turn/></ornaments></notations></note>
<note><rest/><duration>1600</duration><voice>1</voice></note>
</measure>`);
    const { score, warnings } = importMusicXml(
      xml,
      parser,
      TEST_MUSICXML_WARNINGS
    );
    expect(score.tracks[0].measures[0].voices[0].events[0].durationTicks).toBe(
      320
    );
    // The turn is now read onto the note rather than reported as unsupported.
    const first = score.tracks[0].measures[0].voices[0].events[0];
    expect(isNoteEvent(first) && first.ornament).toBe('turn');
    expect(warnings.some(w => /ornament/i.test(w))).toBe(false);
    // `<duration>` already carries the scaling, so the tick length above is
    // correct and nothing is simplified.
    expect(warnings.some(w => /tuplet/i.test(w))).toBe(false);
  });

  it('scales a tuplet that states only its written type', () => {
    // The fallback path: no <duration>, so the ratio has to be applied or the
    // note imports a third too long.
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note>
</measure>`);
    const { score } = importMusicXml(xml, parser, TEST_MUSICXML_WARNINGS);
    // An eighth is 240 ticks; a triplet eighth is 160.
    expect(score.tracks[0].measures[0].voices[0].events[0].durationTicks).toBe(
      160
    );
  });

  it('approximates an unsupported clef as treble with a warning', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>1</line></clef></attributes>
<note><rest/><duration>1920</duration><voice>1</voice></note>
</measure>`);
    const { score, warnings } = importMusicXml(
      xml,
      parser,
      TEST_MUSICXML_WARNINGS
    );
    expect(score.tracks[0].clef).toBe('treble');
    expect(warnings.some(w => /clef/i.test(w))).toBe(true);
  });

  it('parses a recognized bass clef without warning', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>
<note><rest/><duration>1920</duration><voice>1</voice></note>
</measure>`);
    const { score, warnings } = importMusicXml(
      xml,
      parser,
      TEST_MUSICXML_WARNINGS
    );
    expect(score.tracks[0].clef).toBe('bass');
    expect(warnings.some(w => /clef/i.test(w))).toBe(false);
  });

  it('a single-clef part across multiple measures keeps that clef and emits no clef warning', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note><rest/><duration>1920</duration><voice>1</voice></note>
</measure>
<measure number="2">
<note><rest/><duration>1920</duration><voice>1</voice></note>
</measure>`);
    const { score, warnings } = importMusicXml(
      xml,
      parser,
      TEST_MUSICXML_WARNINGS
    );
    expect(score.tracks[0].clef).toBe('treble');
    expect(warnings.some(w => /clef/i.test(w))).toBe(false);
  });

  it('keeps the first clef and drops a mid-score clef change with a warning naming the measure (Track has no per-measure clef)', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>C</step><octave>5</octave></pitch><duration>1920</duration><voice>1</voice><type>whole</type></note>
</measure>
<measure number="2">
<attributes><clef><sign>F</sign><line>4</line></clef></attributes>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>1920</duration><voice>1</voice><type>whole</type></note>
</measure>`);
    const { score, warnings } = importMusicXml(
      xml,
      parser,
      TEST_MUSICXML_WARNINGS
    );
    // The track keeps the FIRST clef (treble) rather than silently
    // flipping to whatever clef was last seen anywhere in the part.
    expect(score.tracks[0].clef).toBe('treble');
    // Notes themselves are still imported correctly regardless of clef;
    // only the *rendered staff* would be affected, and that's out of
    // scope for the domain model (no per-measure clef field to hold it).
    const notes = score.tracks[0].measures.flatMap(m => m.voices[0].events);
    expect(notes.map(n => n.durationTicks)).toEqual([1920, 1920]);
    expect(warnings.some(w => /clef change.*measure 2.*dropped/i.test(w))).toBe(
      true
    );
  });

  it('keeps the previous time signature (not 4/4) on a senza-misura/malformed <time>, and says so', () => {
    const xml = MINIMAL_HEADER(`<measure number="1">
<attributes><divisions>480</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
<note><rest/><duration>1440</duration><voice>1</voice></note>
</measure>
<measure number="2">
<attributes><time><senza-misura/></time></attributes>
<note><rest/><duration>1440</duration><voice>1</voice></note>
</measure>`);
    const { score, warnings } = importMusicXml(
      xml,
      parser,
      TEST_MUSICXML_WARNINGS
    );
    // Kept measure 1's 3/4, *not* reset to 4/4 -- the warning message must
    // describe this actual behavior, not claim a 4/4 default that doesn't
    // happen here.
    expect(score.tracks[0].measures[1].timeSignature).toEqual({
      numerator: 3,
      denominator: 4,
    });
    expect(
      warnings.some(
        w =>
          /measure 2/.test(w) &&
          /kept/i.test(w) &&
          !/defaulted to 4\/4/i.test(w)
      )
    ).toBe(true);
  });
});
