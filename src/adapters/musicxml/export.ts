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
import { tupletGroups } from '@sudobility/music_types';
import { parseChordSymbol } from '@sudobility/music_types';
import { notateDuration } from './duration-map.js';
import { barNumberAt } from '@sudobility/music_types';

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

/** The Italian a player reads for each jump. */
const JUMP_WORDS: Record<NonNullable<Measure['jump']>, string> = {
  'da-capo': 'D.C.',
  'da-capo-al-fine': 'D.C. al Fine',
  'da-capo-al-coda': 'D.C. al Coda',
  'dal-segno': 'D.S.',
  'dal-segno-al-fine': 'D.S. al Fine',
  'dal-segno-al-coda': 'D.S. al Coda',
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

/**
 * Domain ornament -> the `<ornaments>` child element that spells it.
 *
 * MusicXML uses the words the way a player does, unlike VexFlow's codes: a
 * `<mordent>` is the stroked one and `<inverted-mordent>` is not. So this map
 * reads straight across where the renderer's has to cross over.
 */
const ORNAMENT_ELEMENT: Record<NonNullable<NoteEvent['ornament']>, string> = {
  trill: 'trill-mark',
  mordent: 'mordent',
  'inverted-mordent': 'inverted-mordent',
  turn: 'turn',
};

function buildPitchXml(note: NoteEvent): string {
  const { step, accidental, octave } = note.pitch;
  const alter = accidental !== 0 ? `<alter>${accidental}</alter>` : '';
  return `<pitch><step>${step}</step>${alter}<octave>${octave}</octave></pitch>`;
}

type NoteSegmentOptions = {
  isChord: boolean;
  /** Set when this note belongs to a tuplet; `position` marks its ends. */
  tuplet?: {
    actualNotes: number;
    normalNotes: number;
    position: 'start' | 'middle' | 'stop';
  };
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
  /*
    A slur *is* a `<notations>` child, unlike a dynamic: it is a property of
    the note it starts or ends on rather than an instruction at a point in the
    measure. `number="1"` is MusicXML's slur id — one level is enough here
    because the model has no nested phrase marks.

    Only on the segment the note truly begins or ends on: a note decomposed
    into tied segments would otherwise open a slur at every join.
  */
  const slurXml = [
    opts.tieStop === false && note.slurStart
      ? '<slur type="start" number="1"/>'
      : '',
    opts.tieStart === false && note.slurStop
      ? '<slur type="stop" number="1"/>'
      : '',
  ].join('');
  const tupletNotation =
    opts.tuplet?.position === 'start'
      ? '<tuplet type="start" number="1"/>'
      : opts.tuplet?.position === 'stop'
        ? '<tuplet type="stop" number="1"/>'
        : '';
  /*
    The fermata. A `<notations>` child like the slur, and deliberately NOT a
    child of `<articulations>` — MusicXML separates them for the same reason
    the model does: an articulation says how a written length is played, a
    fermata suspends it.

    Only on the segment the note *ends* on. A note long enough to be written as
    tied segments carries one pause, held at the end of the whole note, and
    repeating the glyph at every join would print a row of them.
  */
  const fermataXml =
    note.fermata && opts.tieStart === false ? '<fermata type="upright"/>' : '';
  /*
    The ornament sign, in its own `<ornaments>` wrapper — a sibling of
    `<articulations>`, not a child. Only on the segment the note *begins* on:
    an ornament is played into the note, so a tied note carries one sign at
    its start rather than one per written segment.
  */
  /*
    A rolled chord. A `<notations>` child rather than a `<direction>`: unlike a
    dynamic it belongs to the notehead, and MusicXML puts it on every note of
    the chord — which is what the model stores too.
  */
  /*
    A slide, and the finger. Both `<notations>` children: they belong to the
    notehead, unlike the octave bracket below, which is an instruction at a
    point in the measure.

    The fingering nests inside `<technical>`, which is where MusicXML keeps
    anything about *how* an instrument produces the note.
  */
  const glissandoXml = [
    opts.tieStop === false && note.glissandoStart
      ? '<glissando type="start" number="1"/>'
      : '',
    opts.tieStart === false && note.glissandoStop
      ? '<glissando type="stop" number="1"/>'
      : '',
  ].join('');
  const fingeringXml =
    note.fingering && opts.tieStop === false
      ? `<technical><fingering>${escapeXml(note.fingering)}</fingering></technical>`
      : '';
  const arpeggiateXml =
    note.arpeggiate && opts.tieStop === false ? '<arpeggiate/>' : '';
  const ornamentsXml =
    note.ornament && opts.tieStop === false
      ? `<ornaments><${ORNAMENT_ELEMENT[note.ornament]}/></ornaments>`
      : '';
  const notations =
    tiedNotations ||
    articulationsXml ||
    slurXml ||
    tupletNotation ||
    fermataXml ||
    ornamentsXml ||
    arpeggiateXml ||
    glissandoXml ||
    fingeringXml
      ? `<notations>${tiedNotations}${articulationsXml}${ornamentsXml}${slurXml}${tupletNotation}${fermataXml}${arpeggiateXml}${glissandoXml}${fingeringXml}</notations>`
      : '';
  /*
    The sung syllable. A `<lyric>` is a child of `<note>`, not of
    `<notations>`: it is sung text rather than a performance marking.

    Only on the segment the note begins on — a note decomposed into tied
    segments would otherwise repeat the word at every join — and never on a
    chord's non-root member, where it would print the syllable once per
    notehead.
  */
  const lyricXml =
    note.lyric && !opts.isChord && opts.tieStop === false
      ? `<lyric><syllabic>${note.lyric.syllabic ?? 'single'}</syllabic>` +
        `<text>${escapeXml(note.lyric.text)}</text></lyric>`
      : '';
  /*
    A tuplet says two things in MusicXML: `<time-modification>` on every note
    in the group — how its written value is scaled — and a `<tuplet>` notation
    on the first and last, which is what draws the bracket. Both are needed;
    the modification alone plays correctly and prints without a bracket.
  */
  const timeModificationXml = opts.tuplet
    ? `<time-modification><actual-notes>${opts.tuplet.actualNotes}</actual-notes>` +
      `<normal-notes>${opts.tuplet.normalNotes}</normal-notes></time-modification>`
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
    timeModificationXml +
    notations +
    lyricXml +
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

  /*
    Which events belong to a tuplet, by event id.

    Derived from the durations by `tupletGroups`, the same rule the renderer
    brackets by — so what is exported is what is drawn. Keyed by id because the
    loop below walks chord groups rather than the flat event list.
  */
  const tupletByEventId = new Map<
    string,
    {
      actualNotes: number;
      normalNotes: number;
      position: 'start' | 'middle' | 'stop';
    }
  >();
  for (const group of tupletGroups(voice.events, ppq)) {
    for (let i = 0; i < group.length; i += 1) {
      const event = voice.events[group.start + i];
      if (!event) continue;
      tupletByEventId.set(event.id, {
        actualNotes: group.actualNotes,
        normalNotes: group.normalNotes,
        position:
          i === 0 ? 'start' : i === group.length - 1 ? 'stop' : 'middle',
      });
    }
  }

  for (const group of groupByStartTick(voice.events)) {
    const root = group[0];
    if (!isNoteEvent(root)) {
      for (const segment of notateDuration(root.durationTicks, ppq)) {
        xml += buildRestNoteXml(segment, voiceNumber);
      }
      continue;
    }

    /*
      A tuplet note is written as its *base* value and sounds for less: a
      triplet eighth is an `<type>eighth</type>` whose `<duration>` is two
      thirds of an eighth's divisions. `notateDuration` only knows plain
      values, so handing it 160 ticks classified it as the nearest thing it
      had — a 16th — and the note came back a third short.

      So the type is chosen from the unscaled length and the duration stays
      the real one. This is what `<time-modification>` exists to reconcile.
    */
    const rootTuplet = tupletByEventId.get(root.id);
    const segments = rootTuplet
      ? notateDuration(
          Math.round(
            (root.durationTicks * rootTuplet.actualNotes) /
              rootTuplet.normalNotes
          ),
          ppq
        ).map(segment => ({
          ...segment,
          ticks: Math.round(
            (segment.ticks * rootTuplet.normalNotes) / rootTuplet.actualNotes
          ),
        }))
      : notateDuration(root.durationTicks, ppq);
    /*
      A dynamic is a `<direction>` before the note, not a `<notations>` child:
      MusicXML treats it as an instruction to the player at a point in the
      measure rather than as a property of a notehead. Written once for the
      chord — the marking belongs to the moment — and taken from whichever
      voice member carries it.
    */
    const chordDynamic = group.find(
      (event): event is NoteEvent =>
        isNoteEvent(event) && event.dynamic !== undefined
    )?.dynamic;
    if (chordDynamic) {
      xml +=
        `<direction placement="below"><direction-type>` +
        `<dynamics><${chordDynamic}/></dynamics>` +
        `</direction-type></direction>\n`;
    }
    /*
      The hairpin's opening, as a `<direction>` before the note it starts on —
      a wedge is an instruction at a point in the measure, like a dynamic and
      unlike a slur. Its close is written *after* the closing note, further
      down, so the wedge actually spans that note rather than stopping at its
      onset.
    */
    const chordHairpin = group.find(
      e => isNoteEvent(e) && (e as NoteEvent).hairpinStart
    ) as NoteEvent | undefined;
    const chordOttava = group.find(
      e => isNoteEvent(e) && (e as NoteEvent).ottavaStart
    ) as NoteEvent | undefined;
    if (chordOttava?.ottavaStart) {
      const kind = chordOttava.ottavaStart;
      const size = kind === '8va' || kind === '8vb' ? 8 : 15;
      // `up` means the *notes* move up off the page — which is what a bracket
      // below the stave asks for. MusicXML names the direction the notes go,
      // not the direction the sound goes, and the two are opposites.
      const type = kind === '8va' || kind === '15ma' ? 'down' : 'up';
      xml +=
        `<direction><direction-type>` +
        `<octave-shift type="${type}" size="${size}"/>` +
        `</direction-type></direction>\n`;
    }
    if (chordHairpin?.hairpinStart) {
      xml +=
        `<direction placement="below"><direction-type>` +
        `<wedge type="${chordHairpin.hairpinStart}"/>` +
        `</direction-type></direction>\n`;
    }
    /*
      The chord symbol, as a `<harmony>` before the note it sits over — a
      measure-level element like `<direction>`, because a chord change happens
      at a point in the bar rather than belonging to a notehead.

      `kind="other"` carrying the typed text, deliberately: mapping every
      dialect of "minor seventh" onto MusicXML's enumeration is a dictionary
      that is wrong for somebody, and the printed text is what a player reads.
      The root is parsed out because that part is unambiguous.
    */
    const chordSymbol = isNoteEvent(root) ? root.chordSymbol : undefined;
    const parsedChord = chordSymbol ? parseChordSymbol(chordSymbol) : null;
    if (chordSymbol && parsedChord) {
      xml +=
        `<harmony print-frame="no">` +
        `<root><root-step>${parsedChord.step}</root-step>` +
        (parsedChord.alter !== 0
          ? `<root-alter>${parsedChord.alter}</root-alter>`
          : '') +
        `</root>` +
        `<kind text="${escapeXml(parsedChord.quality)}">other</kind>` +
        `</harmony>\n`;
    }

    /*
      Ornaments are written as their own `<note>` elements carrying `<grace/>`,
      placed before the note they decorate and given no `<duration>` — which is
      exactly how they behave: notes on the page that take none of the bar's
      time. Only the chord root's, since the model hangs them off a moment
      rather than a notehead.
    */
    for (const grace of isNoteEvent(root) ? (root.graceNotes ?? []) : []) {
      const { type, dots } = notateDuration(grace.durationTicks, ppq)[0] ?? {
        type: 'eighth' as const,
        dots: 0,
      };
      xml +=
        `<note><grace${grace.slashed ? ' slash="yes"' : ''}/>` +
        buildPitchXml({ pitch: grace.pitch } as NoteEvent) +
        `<voice>${voiceNumber}</voice>` +
        `<type>${type}</type>` +
        '<dot/>'.repeat(dots) +
        `</note>\n`;
    }

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
          // Only on the segment the note begins on: a decomposed note would
          // otherwise open a tuplet at every join.
          ...(segmentIndex === 0 && tupletByEventId.has(note.id)
            ? { tuplet: tupletByEventId.get(note.id) }
            : {}),
        });
      });
    });

    /*
      The hairpin's close, *after* the notes it ends on rather than before
      them. A `<direction>` sits at a point in the measure, so a stop emitted
      ahead of the closing note would end the wedge at that note's onset and
      leave it uncovered — the one asymmetry with the opening above.
    */
    const chordHairpinStop = group.find(
      e => isNoteEvent(e) && (e as NoteEvent).hairpinStop
    );
    const chordOttavaStop = group.find(
      e => isNoteEvent(e) && (e as NoteEvent).ottavaStop
    );
    if (chordOttavaStop) {
      xml +=
        `<direction><direction-type>` +
        `<octave-shift type="stop" size="8"/>` +
        `</direction-type></direction>\n`;
    }
    if (chordHairpinStop) {
      xml +=
        `<direction placement="below"><direction-type>` +
        `<wedge type="stop"/>` +
        `</direction-type></direction>\n`;
    }
  }
  return xml;
}

// ---- Measures / parts -----------------------------------------------------------

function buildMeasureXml(
  measure: Measure,
  /**
   * The number a player calls this bar, or `null` for a pickup, which has
   * none. Resolved by the caller so this builder needs no notion of how the
   * numbering works.
   */
  printedNumber: number | null,
  isFirstMeasure: boolean,
  prevTimeSignature: TimeSignature | null,
  prevKeySignature: KeySignature | null,
  clef: Clef,
  ppq: number,
  tempoMap: TempoEvent[],
  includeTempo: boolean,
  /** Neighbours, for deriving where a volta bracket begins and ends. */
  prevMeasure: Measure | undefined,
  nextMeasure: Measure | undefined
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
  if (isFirstMeasure) {
    attrs.push(buildClefXml(clef));
  } else if (measure.clef) {
    // A clef change. `measure.clef` is set only on the bar where the clef
    // actually changes — the command drops a redundant marking rather than
    // storing it — so this needs no comparison with the previous bar.
    attrs.push(buildClefXml(measure.clef));
  }

  /*
    A pickup is `implicit="yes"` and carries no number a player counts — which
    is exactly what `barNumberAt` answers `null` for. Every other bar prints
    the number the part shows, so an exported score numbers its bars the same
    way the editor does.
  */
  /*
    The navigation marks, as `<direction>`s at the head of the bar.

    `<segno/>` and `<coda/>` are their own direction-types; the rest are
    `<words>` carrying the Italian a player reads, which is what MusicXML does
    with them. Each also gets the matching `<sound>` attribute — `dacapo`,
    `dalsegno`, `fine`, `tocoda` — because that is the half a *playing*
    application reads, and writing only the words would export a score that
    looks right and navigates nowhere.
  */
  const navigation: string[] = [];
  if (measure.segno)
    navigation.push(
      `<direction placement="above"><direction-type><segno/></direction-type><sound segno="segno"/></direction>`
    );
  if (measure.coda)
    navigation.push(
      `<direction placement="above"><direction-type><coda/></direction-type><sound coda="coda"/></direction>`
    );
  if (measure.toCoda)
    navigation.push(
      `<direction placement="above"><direction-type><words>To Coda</words></direction-type><sound tocoda="coda"/></direction>`
    );
  if (measure.fine)
    navigation.push(
      `<direction placement="above"><direction-type><words>Fine</words></direction-type><sound fine="yes"/></direction>`
    );
  if (measure.jump) {
    const words = JUMP_WORDS[measure.jump];
    const sound = measure.jump.startsWith('dal-segno')
      ? `dalsegno="segno"`
      : `dacapo="yes"`;
    navigation.push(
      `<direction placement="above"><direction-type><words>${words}</words></direction-type><sound ${sound}/></direction>`
    );
  }

  let xml = `<measure number="${printedNumber ?? 0}"${
    measure.pickup ? ' implicit="yes"' : ''
  }>\n`;
  if (attrs.length > 0) xml += `<attributes>${attrs.join('')}</attributes>\n`;
  xml += navigation.join('');

  /*
    The left-hand barline: a repeat opening, a volta opening, or both.

    MusicXML puts these in a `<barline location="left">` at the top of the
    measure, and the matching right-hand one at the bottom — which is why they
    are written in two places rather than one.
  */
  const opensEnding =
    Boolean(measure.endingNumbers?.length) && !sameEnding(prevMeasure, measure);
  if (measure.repeatStart || opensEnding) {
    xml +=
      `<barline location="left">` +
      (measure.repeatStart
        ? `<bar-style>heavy-light</bar-style><repeat direction="forward"/>`
        : '') +
      (opensEnding
        ? `<ending number="${measure.endingNumbers!.join(', ')}" type="start"/>`
        : '') +
      `</barline>\n`;
  }

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

  const closesEnding =
    Boolean(measure.endingNumbers?.length) && !sameEnding(nextMeasure, measure);
  /*
    A section break or the final barline. Written only where there is no
    repeat close on the same bar — the repeat below owns the right-hand
    barline there, and a `:|` is an instruction a player acts on where a
    double bar is a reading aid.
  */
  if (measure.barline && !measure.repeatEnd && !closesEnding) {
    xml +=
      `<barline location="right"><bar-style>` +
      (measure.barline === 'final' ? 'light-heavy' : 'light-light') +
      `</bar-style></barline>\n`;
  }
  if (measure.repeatEnd || closesEnding) {
    xml +=
      `<barline location="right">` +
      (closesEnding
        ? `<ending number="${measure.endingNumbers!.join(', ')}" type="stop"/>`
        : '') +
      (measure.repeatEnd
        ? `<bar-style>light-heavy</bar-style><repeat direction="backward"/>`
        : '') +
      `</barline>\n`;
  }

  xml += `</measure>\n`;
  return xml;
}

/** Whether two bars belong to the same volta — the same numbers, in order. */
function sameEnding(a: Measure | undefined, b: Measure | undefined): boolean {
  const left = a?.endingNumbers;
  const right = b?.endingNumbers;
  if (!left || !right) return false;
  return left.length === right.length && left.every((n, i) => n === right[i]);
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
      barNumberAt(track.measures, index),
      index === 0,
      prevTimeSignature,
      prevKeySignature,
      track.clef,
      ppq,
      tempoMap,
      includeTempo,
      track.measures[index - 1],
      track.measures[index + 1]
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
