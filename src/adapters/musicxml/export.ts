/**
 * `Score` -> MusicXML (score-partwise 4.0) export (spec §17). Pure and
 * read-only: never mutates `score`. Built by hand-assembling XML strings (a
 * small `escapeXml` helper covers the handful of characters MusicXML text
 * content needs escaped) rather than depending on an XML-building library,
 * per the Task 8 brief.
 *
 * Velocity has no standard per-note MusicXML representation (the closest,
 * `<sound dynamics="...">`, is a `<direction>`-level playback hint, not a
 * per-note one) — per the Task 8 brief's guidance, this adapter simply
 * doesn't emit velocity on export; `import.ts` documents the matching
 * default it applies on the way back in.
 */
import type {
  Clef,
  KeySignature,
  Measure,
  MusicalEvent,
  NoteEvent,
  Score,
  TempoEvent,
  TimeSignature,
  Track,
  Voice,
} from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import type { NotatedDuration } from './duration-map.js';
import { notateDuration } from './duration-map.js';

/** Escapes the five characters not otherwise safe inside MusicXML element text/attribute values. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---- Part-list --------------------------------------------------------------

function buildScorePartXml(track: Track, partId: string): string {
  const instrumentId = `${partId}-I1`;
  return (
    `<score-part id="${partId}">` +
    `<part-name>${escapeXml(track.name)}</part-name>` +
    `<score-instrument id="${instrumentId}"><instrument-name>${escapeXml(track.instrumentName)}</instrument-name></score-instrument>` +
    `<midi-instrument id="${instrumentId}">` +
    `<midi-channel>${track.midiChannel + 1}</midi-channel>` +
    `<midi-program>${track.midiProgram + 1}</midi-program>` +
    `</midi-instrument>` +
    `</score-part>\n`
  );
}

// ---- Attributes: key / time / clef -------------------------------------------

function sameTimeSignature(a: TimeSignature, b: TimeSignature): boolean {
  return a.numerator === b.numerator && a.denominator === b.denominator;
}

function sameKeySignature(a: KeySignature, b: KeySignature): boolean {
  return a.fifths === b.fifths && a.mode === b.mode;
}

function buildKeyXml(key: KeySignature): string {
  return `<key><fifths>${key.fifths}</fifths><mode>${key.mode}</mode></key>`;
}

function buildTimeXml(ts: TimeSignature): string {
  return `<time><beats>${ts.numerator}</beats><beat-type>${ts.denominator}</beat-type></time>`;
}

/** MusicXML `<clef>` sign/line for each supported domain `Clef`. */
const CLEF_SIGN_LINE: Record<Clef, { sign: string; line?: number }> = {
  treble: { sign: 'G', line: 2 },
  bass: { sign: 'F', line: 4 },
  alto: { sign: 'C', line: 3 },
  tenor: { sign: 'C', line: 4 },
  percussion: { sign: 'percussion' },
};

function buildClefXml(clef: Clef): string {
  const { sign, line } = CLEF_SIGN_LINE[clef];
  return `<clef><sign>${sign}</sign>${line !== undefined ? `<line>${line}</line>` : ''}</clef>`;
}

// ---- Tempo directions ---------------------------------------------------------

/** Tempo events whose tick falls within `[measure.startTick, measure end)`, sorted by tick. */
function tempoEventsInMeasure(
  tempoMap: TempoEvent[],
  measure: Measure
): TempoEvent[] {
  const end = measure.startTick + measure.durationTicks;
  return tempoMap
    .filter(t => t.tick >= measure.startTick && t.tick < end)
    .sort((a, b) => a.tick - b.tick);
}

/**
 * A `<direction>` carrying a metronome mark and `<sound tempo>` for one
 * tempo change. When the event doesn't fall exactly at the measure's start,
 * an `<offset>` (in divisions from measure start) records its position —
 * MusicXML treats `<offset>` as an authoritative timing hint independent of
 * where the `<direction>` happens to sit among the measure's `<note>`
 * elements, so this doesn't need to be interleaved into the note sequence.
 */
function buildTempoDirectionXml(tempo: TempoEvent, measure: Measure): string {
  const offsetTicks = tempo.tick - measure.startTick;
  const offsetXml = offsetTicks > 0 ? `<offset>${offsetTicks}</offset>` : '';
  const bpm = Number.isInteger(tempo.bpm)
    ? String(tempo.bpm)
    : tempo.bpm.toFixed(2);
  return (
    `<direction placement="above">` +
    `<direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type>` +
    `${offsetXml}` +
    `<sound tempo="${bpm}"/>` +
    `</direction>\n`
  );
}

// ---- Notes --------------------------------------------------------------------

/** Domain `Articulation` -> MusicXML `<articulations>` child element name. `marcato` maps to MusicXML's `<strong-accent>` (its name for the same mark). */
const ARTICULATION_ELEMENT: Record<
  NonNullable<NoteEvent['articulation']>,
  string
> = {
  staccato: 'staccato',
  accent: 'accent',
  tenuto: 'tenuto',
  marcato: 'strong-accent',
};

function buildArticulationXml(
  articulation: NonNullable<NoteEvent['articulation']>
): string {
  const name = ARTICULATION_ELEMENT[articulation];
  return name === 'strong-accent' ? '<strong-accent type="up"/>' : `<${name}/>`;
}

function buildPitchXml(note: NoteEvent): string {
  const { step, accidental, octave } = note.pitch;
  const alter = accidental !== 0 ? `<alter>${accidental}</alter>` : '';
  return `<pitch><step>${step}</step>${alter}<octave>${octave}</octave></pitch>`;
}

type NoteSegmentOptions = {
  isChord: boolean;
  segment: NotatedDuration;
  tieStop: boolean;
  tieStart: boolean;
  voiceNumber: number;
};

/** One `<note>` element for a pitched note segment (one of possibly several tied segments notating a single `NoteEvent`). */
function buildPitchedNoteXml(
  note: NoteEvent,
  opts: NoteSegmentOptions
): string {
  const tieElements = [
    opts.tieStop ? '<tie type="stop"/>' : '',
    opts.tieStart ? '<tie type="start"/>' : '',
  ].join('');
  const tiedNotations = [
    opts.tieStop ? '<tied type="stop"/>' : '',
    opts.tieStart ? '<tied type="start"/>' : '',
  ].join('');
  const articulationsXml = note.articulation
    ? `<articulations>${buildArticulationXml(note.articulation)}</articulations>`
    : '';
  const notations =
    tiedNotations || articulationsXml
      ? `<notations>${tiedNotations}${articulationsXml}</notations>`
      : '';
  const dots = '<dot/>'.repeat(opts.segment.dots);

  return (
    `<note>` +
    `${opts.isChord ? '<chord/>' : ''}` +
    buildPitchXml(note) +
    `<duration>${opts.segment.ticks}</duration>` +
    tieElements +
    `<voice>${opts.voiceNumber}</voice>` +
    `<type>${opts.segment.type}</type>` +
    dots +
    notations +
    `</note>\n`
  );
}

/** One `<note><rest/></note>` element for a rest segment (a rest whose length needs splitting across several `<type>`s isn't tied — MusicXML has no tie concept for rests). */
function buildRestNoteXml(
  segment: NotatedDuration,
  voiceNumber: number
): string {
  const dots = '<dot/>'.repeat(segment.dots);
  return `<note><rest/><duration>${segment.ticks}</duration><voice>${voiceNumber}</voice><type>${segment.type}</type>${dots}</note>\n`;
}

/** Groups `events` by exact `startTick`, in ascending tick order, preserving each group's original relative order. */
function groupByStartTick(events: MusicalEvent[]): MusicalEvent[][] {
  const order: number[] = [];
  const groups = new Map<number, MusicalEvent[]>();
  for (const event of events) {
    let group = groups.get(event.startTick);
    if (!group) {
      group = [];
      groups.set(event.startTick, group);
      order.push(event.startTick);
    }
    group.push(event);
  }
  order.sort((a, b) => a - b);
  return order.map(tick => groups.get(tick) as MusicalEvent[]);
}

/**
 * XML for one voice's events, in MusicXML note order. Notes sharing a
 * `startTick` are exported as a chord (the first is the "root" that
 * advances the cursor / determines the notated segments; every note in the
 * group — including the root — is notated using the *root's* duration, a
 * documented simplification that round-trips exactly whenever simultaneous
 * notes share a duration, as every fixture/test in this adapter's scope
 * does; a same-tick note with a genuinely different duration is notated at
 * the root's length instead of its own).
 */
function buildVoiceEventsXml(
  voice: Voice,
  voiceNumber: number,
  ppq: number
): string {
  let xml = '';
  for (const group of groupByStartTick(voice.events)) {
    const root = group[0];
    if (!isNoteEvent(root)) {
      for (const segment of notateDuration(root.durationTicks, ppq)) {
        xml += buildRestNoteXml(segment, voiceNumber);
      }
      continue;
    }

    const segments = notateDuration(root.durationTicks, ppq);
    group.forEach((event, groupIndex) => {
      const note = event as NoteEvent;
      segments.forEach((segment, segmentIndex) => {
        xml += buildPitchedNoteXml(note, {
          isChord: groupIndex > 0,
          segment,
          tieStop: segmentIndex === 0 ? Boolean(note.tieStop) : true,
          tieStart:
            segmentIndex === segments.length - 1
              ? Boolean(note.tieStart)
              : true,
          voiceNumber,
        });
      });
    });
  }
  return xml;
}

// ---- Measures / parts -----------------------------------------------------------

function buildMeasureXml(
  measure: Measure,
  isFirstMeasure: boolean,
  prevTimeSignature: TimeSignature | null,
  prevKeySignature: KeySignature | null,
  clef: Clef,
  ppq: number,
  tempoMap: TempoEvent[],
  includeTempo: boolean
): string {
  const attrs: string[] = [];
  if (isFirstMeasure) attrs.push(`<divisions>${ppq}</divisions>`);
  if (
    !prevKeySignature ||
    !sameKeySignature(prevKeySignature, measure.keySignature)
  ) {
    attrs.push(buildKeyXml(measure.keySignature));
  }
  if (
    !prevTimeSignature ||
    !sameTimeSignature(prevTimeSignature, measure.timeSignature)
  ) {
    attrs.push(buildTimeXml(measure.timeSignature));
  }
  if (isFirstMeasure) attrs.push(buildClefXml(clef));

  let xml = `<measure number="${measure.index + 1}">\n`;
  if (attrs.length > 0) xml += `<attributes>${attrs.join('')}</attributes>\n`;

  if (includeTempo) {
    for (const tempo of tempoEventsInMeasure(tempoMap, measure)) {
      xml += buildTempoDirectionXml(tempo, measure);
    }
  }

  measure.voices.forEach((voice, voiceIndex) => {
    if (voiceIndex > 0) {
      // Every voice sums exactly to the measure's duration (spec §23), so
      // rewinding by the full measure length always lands back at its start.
      xml += `<backup><duration>${measure.durationTicks}</duration></backup>\n`;
    }
    xml += buildVoiceEventsXml(voice, voiceIndex + 1, ppq);
  });

  xml += `</measure>\n`;
  return xml;
}

function buildPartXml(
  track: Track,
  partId: string,
  ppq: number,
  tempoMap: TempoEvent[],
  includeTempo: boolean
): string {
  let xml = `<part id="${partId}">\n`;
  let prevTimeSignature: TimeSignature | null = null;
  let prevKeySignature: KeySignature | null = null;

  track.measures.forEach((measure, index) => {
    xml += buildMeasureXml(
      measure,
      index === 0,
      prevTimeSignature,
      prevKeySignature,
      track.clef,
      ppq,
      tempoMap,
      includeTempo
    );
    prevTimeSignature = measure.timeSignature;
    prevKeySignature = measure.keySignature;
  });

  xml += `</part>\n`;
  return xml;
}

// ---- Entry point ------------------------------------------------------------

/**
 * Exports `score` as a MusicXML (score-partwise 4.0) document string:
 * work title/composer, part-list (with MIDI program/channel per track),
 * per-track parts with attributes (divisions/key/time, emitted on the
 * first measure and again whenever key/time change; clef, once per part),
 * notes/rests/chords/voices (`<backup>` between voices), ties (splitting a
 * note whose duration doesn't notate as a single value into tied
 * segments), articulations, and tempo (`<sound tempo>` directions, emitted
 * once — in the first part — per tempo-map entry).
 */
export function exportMusicXml(score: Score): string {
  const partIds = score.tracks.map((_, i) => `P${i + 1}`);
  const partList = score.tracks
    .map((track, i) => buildScorePartXml(track, partIds[i]))
    .join('');
  const parts = score.tracks
    .map((track, i) =>
      buildPartXml(track, partIds[i], score.ppq, score.tempoMap, i === 0)
    )
    .join('');

  const work = `<work><work-title>${escapeXml(score.metadata.title)}</work-title></work>\n`;
  const identification = score.metadata.composer
    ? `<identification><creator type="composer">${escapeXml(score.metadata.composer)}</creator></identification>\n`
    : '';

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<score-partwise version="4.0">\n` +
    work +
    identification +
    `<part-list>\n${partList}</part-list>\n` +
    parts +
    `</score-partwise>\n`
  );
}

/**
 * Slugifies `title` into a filesystem/URL-safe download filename (no
 * extension). Identical behavior to `adapters/midi/export.ts`'s
 * `safeFilename` (kept as a local copy so this module has no cross-adapter
 * dependency); see that module for the rationale.
 */
export function safeFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'untitled';
}
