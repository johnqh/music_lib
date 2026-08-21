/**
 * MusicXML (score-partwise) -> `Score` import (spec §17), via `DOMParser`
 * (available in both the browser and Vitest/jsdom, per the Task 8 brief —
 * no XML-parsing library dependency).
 *
 * Unlike MIDI, MusicXML already carries full notation semantics (exact
 * durations, voices, ties, articulations, ...), so this import is a
 * structural translation rather than a heuristic reconstruction — but the
 * format is large, and real-world files routinely contain elements this
 * adapter's "basic support" (spec §17) doesn't cover (lyrics, grace notes,
 * ornaments, tuplet ratios, unusual clefs, ...). Those are always skipped
 * safely (never thrown on) and reported once each in the returned
 * `warnings` array — never silently.
 *
 * MusicXML has no standard per-note velocity (see `export.ts`'s header);
 * every imported note is given the domain default velocity, 80.
 */
import { createId } from '../../domain/score/ids.js';
import { DYNAMICS } from '@sudobility/music_types';
import type { XmlElement, XmlParser } from '@sudobility/music_types';
import type {
  Accidental,
  Clef,
  Dynamic,
  GraceNote,
  Lyric,
  KeySignature,
  Measure,
  MusicalEvent,
  NoteEvent,
  Pitch,
  PitchStep,
  RestEvent,
  Score,
  TempoEvent,
  TimeSignature,
  Track,
} from '@sudobility/music_types';
import { measureDurationTicks } from '../../domain/time/ticks.js';
import { ticksForNotatedType, isMusicXmlNoteType } from './duration-map.js';

/** The score model's fixed internal PPQ (spec §4/§17: every import is normalized to 480). */
const SCORE_PPQ = 480;
const DEFAULT_VELOCITY = 80;
const MIN_BPM = 20;
const MAX_BPM = 400;
const DEFAULT_TIME_SIGNATURE: TimeSignature = { numerator: 4, denominator: 4 };
const DEFAULT_KEY_SIGNATURE: KeySignature = { fifths: 0, mode: 'major' };
const DEFAULT_TEMPO_BPM = 120;
const VALID_STEPS: PitchStep[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** MusicXML `<articulations>` child element name -> domain `Articulation`. */
const ARTICULATION_FROM_ELEMENT: Record<
  string,
  NonNullable<NoteEvent['articulation']>
> = {
  staccato: 'staccato',
  accent: 'accent',
  tenuto: 'tenuto',
  'strong-accent': 'marcato',
};

// ---- Small DOM helpers -------------------------------------------------------

function directChild(el: XmlElement, tagName: string): XmlElement | null {
  for (const child of Array.from(el.children)) {
    if (child.tagName === tagName) return child;
  }
  return null;
}

function directChildren(el: XmlElement, tagName: string): XmlElement[] {
  return Array.from(el.children).filter(c => c.tagName === tagName);
}

function textOf(el: XmlElement | null, tagName: string): string | null {
  if (!el) return null;
  return directChild(el, tagName)?.textContent?.trim() ?? null;
}

function numberOf(el: XmlElement | null, tagName: string): number | null {
  const text = el ? textOf(el, tagName) : null;
  if (text === null) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

// ---- Warnings -----------------------------------------------------------------

/**
 * Every warning this importer can raise, in the caller's words.
 *
 * Functions where the warning names something it found — a clef, a tag, a
 * tempo — so the host can put the value where its own grammar wants it rather
 * than having English word order baked in here.
 */
export type MusicXmlWarnings = {
  unsupportedClef: (sign: string, line: number) => string;
  unsupportedKeyMode: (mode: string) => string;
  unsupportedTime: (measureNumber: number) => string;
  complexTimeSignature: string;
  clefChangeDropped: (clef: string, measureNumber: number) => string;
  unsupportedPitchStep: (step: string) => string;
  alterRounded: (alter: string, clamped: number) => string;
  graceNotes: string;
  lyrics: string;
  tuplets: string;
  unsupportedNotation: (tag: string) => string;
  unsupportedNoteElement: (tag: string) => string;
  unsupportedArticulation: (tag: string) => string;
  multipleArticulations: string;
  unpitched: string;
  noPitchOrRest: string;
  noDuration: string;
  nonPositiveDuration: string;
  noteTrimmed: string;
  unsupportedMeasureElement: (tag: string) => string;
  noTempo: (defaultBpm: number) => string;
  tempoClamped: (
    bpm: number,
    min: number,
    max: number,
    clamped: number
  ) => string;
};

/** Collects warnings, deduplicated by exact message text (so a repeated unsupported element only appears once). */
class WarningCollector {
  private readonly seen = new Set<string>();
  readonly messages: string[] = [];

  /** The caller's warning text; already threaded to every site that warns. */
  constructor(readonly text: MusicXmlWarnings) {}

  add(message: string): void {
    if (this.seen.has(message)) return;
    this.seen.add(message);
    this.messages.push(message);
  }
}

// ---- Part-list ------------------------------------------------------------------

type ScorePartMeta = {
  name: string;
  instrumentName: string;
  midiProgram: number;
  midiChannel: number;
};

function parsePartList(root: XmlElement): Map<string, ScorePartMeta> {
  const result = new Map<string, ScorePartMeta>();
  const partList = directChild(root, 'part-list');
  if (!partList) return result;

  for (const scorePart of directChildren(partList, 'score-part')) {
    const id = scorePart.getAttribute('id');
    if (!id) continue;
    const name = textOf(scorePart, 'part-name') ?? '';
    const instrumentEl = directChild(scorePart, 'score-instrument');
    const instrumentName =
      (instrumentEl ? textOf(instrumentEl, 'instrument-name') : null) ?? '';
    const midiInstrument = directChild(scorePart, 'midi-instrument');
    const midiChannel =
      (midiInstrument ? numberOf(midiInstrument, 'midi-channel') : null) ?? 1;
    const midiProgram =
      (midiInstrument ? numberOf(midiInstrument, 'midi-program') : null) ?? 1;
    result.set(id, { name, instrumentName, midiProgram, midiChannel });
  }
  return result;
}

// ---- Clef -----------------------------------------------------------------------

const CLEF_FROM_SIGN: Array<{ sign: string; line: number; clef: Clef }> = [
  { sign: 'G', line: 2, clef: 'treble' },
  { sign: 'F', line: 4, clef: 'bass' },
  { sign: 'C', line: 3, clef: 'alto' },
  { sign: 'C', line: 4, clef: 'tenor' },
];

function defaultLineForSign(sign: string): number {
  if (sign === 'G') return 2;
  if (sign === 'F') return 4;
  if (sign === 'C') return 3;
  return 2;
}

function parseClef(clefEl: XmlElement, warnings: WarningCollector): Clef {
  const sign = textOf(clefEl, 'sign') ?? '';
  if (sign === 'percussion' || sign === 'none') return 'percussion';

  const line = numberOf(clefEl, 'line') ?? defaultLineForSign(sign);
  const match = CLEF_FROM_SIGN.find(c => c.sign === sign && c.line === line);
  if (match) return match.clef;

  warnings.add(warnings.text.unsupportedClef(sign, line));
  return 'treble';
}

// ---- Attributes (divisions/key/time/clef) state ------------------------------

type MeasureState = {
  ratio: number; // SCORE_PPQ / source divisions
  timeSignature: TimeSignature;
  keySignature: KeySignature;
  /**
   * `null` until the first `<clef>` is seen, after which it's locked: the
   * domain model's `Track.clef` is a single track-wide value (`Measure` has
   * no per-measure clef), so a mid-part clef *change* can't be represented
   * at all — the first clef wins and any later, differing clef is dropped
   * with a warning (see `applyAttributes`), never silently overwriting it.
   */
  clef: Clef | null;
};

function applyAttributes(
  attrs: XmlElement,
  state: MeasureState,
  measureNumber: number,
  warnings: WarningCollector
): void {
  const divisions = numberOf(attrs, 'divisions');
  if (divisions !== null && divisions > 0) {
    state.ratio = SCORE_PPQ / divisions;
  }

  const keyEl = directChild(attrs, 'key');
  if (keyEl) {
    const fifths = numberOf(keyEl, 'fifths') ?? 0;
    const modeText = textOf(keyEl, 'mode');
    let mode: KeySignature['mode'] = 'major';
    if (modeText === 'major' || modeText === 'minor') {
      mode = modeText;
    } else if (modeText !== null) {
      warnings.add(warnings.text.unsupportedKeyMode(modeText));
    }
    state.keySignature = { fifths: Math.round(fifths), mode };
  }

  const timeEl = directChild(attrs, 'time');
  if (timeEl) {
    const beatsEls = directChildren(timeEl, 'beats');
    const beatTypeEls = directChildren(timeEl, 'beat-type');
    if (beatsEls.length === 0 || beatTypeEls.length === 0) {
      warnings.add(
        `A senza-misura or otherwise unsupported <time> element at measure ${measureNumber} did not change the time signature; the previous value was kept (4/4 if none had been set yet).`
      );
    } else {
      if (beatsEls.length > 1) {
        warnings.add(warnings.text.complexTimeSignature);
      }
      const numerator = Number(beatsEls[0].textContent);
      const denominator = Number(beatTypeEls[0].textContent);
      if (
        Number.isFinite(numerator) &&
        Number.isFinite(denominator) &&
        numerator > 0 &&
        denominator > 0
      ) {
        state.timeSignature = { numerator, denominator };
      }
    }
  }

  const clefEl = directChild(attrs, 'clef');
  if (clefEl) {
    const clef = parseClef(clefEl, warnings);
    if (state.clef === null) {
      // First clef seen for this part locks the track's clef: the domain
      // model (`Track.clef`) has no per-measure clef, so only one clef per
      // track can be represented at all (see `MeasureState.clef`'s doc).
      state.clef = clef;
    } else if (clef !== state.clef) {
      warnings.add(
        `A clef change to ${clef} at measure ${measureNumber} was dropped (the domain model supports only one clef per track); the track kept its first clef, ${state.clef}.`
      );
    }
  }
}

// ---- Note parsing -----------------------------------------------------------------

type RawEvent = {
  startTick: number; // measure-relative
  durationTicks: number;
  pitch: Pitch | null; // null => rest
  voiceNumber: string;
  articulation?: NoteEvent['articulation'];
  fermata?: boolean;
  ornament?: NoteEvent['ornament'];
  dynamic?: Dynamic;
  slurStart?: boolean;
  slurStop?: boolean;
  lyric?: Lyric;
  chordSymbol?: string;
  graceNotes?: GraceNote[];
  tieStart?: boolean;
  tieStop?: boolean;
};

function parseStep(text: string | null, warnings: WarningCollector): PitchStep {
  if (text && (VALID_STEPS as string[]).includes(text))
    return text as PitchStep;
  warnings.add(warnings.text.unsupportedPitchStep(text ?? ''));
  return 'C';
}

function parseAlter(
  alterText: string | null,
  warnings: WarningCollector
): Accidental {
  if (alterText === null) return 0;
  const raw = Number(alterText);
  if (!Number.isFinite(raw)) return 0;
  const rounded = Math.round(raw);
  const clamped = Math.max(-2, Math.min(2, rounded)) as Accidental;
  if (clamped !== raw) {
    warnings.add(warnings.text.alterRounded(alterText, clamped));
  }
  return clamped;
}

function parsePitch(pitchEl: XmlElement, warnings: WarningCollector): Pitch {
  const step = parseStep(textOf(pitchEl, 'step'), warnings);
  const alter = parseAlter(textOf(pitchEl, 'alter'), warnings);
  const octave = numberOf(pitchEl, 'octave') ?? 4;
  return { step, accidental: alter, octave };
}

/** Recognized-and-ignored purely-typographic note children; never warned about. */
const SILENTLY_IGNORED_NOTE_CHILDREN = new Set([
  'chord',
  'pitch',
  'rest',
  'unpitched',
  'duration',
  'tie',
  'voice',
  'type',
  'dot',
  'accidental',
  'stem',
  'notehead',
  'notehead-text',
  'staff',
  'beam',
  'instrument',
  'footnote',
  'level',
  'play',
  'listen',
]);

/**
 * The syllable sung on a note, or `undefined` when it carries none.
 *
 * `single` is the model's default and is not stored, so an ordinary one-word
 * syllable round-trips without carrying a redundant field.
 */
function parseLyric(noteEl: XmlElement): Lyric | undefined {
  const lyricEl = directChild(noteEl, 'lyric');
  if (!lyricEl) return undefined;
  const text = directChild(lyricEl, 'text')?.textContent?.trim();
  if (!text) return undefined;
  const syllabic = directChild(lyricEl, 'syllabic')?.textContent ?? undefined;
  return {
    text,
    ...(syllabic && syllabic !== 'single'
      ? { syllabic: syllabic as NonNullable<Lyric['syllabic']> }
      : {}),
  };
}

function warnUnsupportedNoteChildren(
  noteEl: XmlElement,
  warnings: WarningCollector
): void {
  for (const child of Array.from(noteEl.children)) {
    if (SILENTLY_IGNORED_NOTE_CHILDREN.has(child.tagName)) continue;
    if (child.tagName === 'grace') {
      // Read now: a `<grace/>` note is attached to the note it decorates
      // rather than dropped.
      continue;
    } else if (child.tagName === 'lyric') {
      // Read in `parseLyric`, so no longer dropped and no longer warned about.
      continue;
    } else if (child.tagName === 'time-modification') {
      // No longer simplified: `<duration>` already carries the scaling — a
      // triplet eighth genuinely has two thirds of an eighth's divisions — so
      // the imported tick length is the right one, and the model expresses it
      // as a `triplet-*` duration. `parseTimeModification` covers the case
      // where a note states only its `<type>`.
      continue;
    } else if (child.tagName === 'notations') {
      for (const notationChild of Array.from(child.children)) {
        if (
          notationChild.tagName === 'articulations' ||
          notationChild.tagName === 'tied' ||
          notationChild.tagName === 'slur' ||
          // Read in `parseFermata`, so no longer dropped and no longer warned
          // about.
          notationChild.tagName === 'fermata' ||
          // The bracket. Its scaling rides on `<time-modification>` and the
          // tick length, so there is nothing more to read here — but it is
          // understood, not ignored, and must not be reported as unsupported.
          notationChild.tagName === 'tuplet'
        )
          continue;
        if (notationChild.tagName === 'ornaments') {
          // Read in `parseOrnament`. A sign this model does not carry still
          // warns, so nothing is dropped silently — see there.
          continue;
        } else {
          warnings.add(
            warnings.text.unsupportedNotation(notationChild.tagName)
          );
        }
      }
    } else {
      warnings.add(warnings.text.unsupportedNoteElement(child.tagName));
    }
  }
}

/**
 * The ornament sign on `noteEl`, if it carries one this model can hold.
 *
 * MusicXML's `<ornaments>` is a much wider vocabulary than four signs — it
 * also carries `<wavy-line>`, `<schleifer>`, `<tremolo>` and more, and may
 * hold several at once. Anything unrecognised still warns rather than
 * vanishing, and the first recognised sign wins: the model stores one.
 */
function parseOrnament(
  noteEl: XmlElement,
  warnings: WarningCollector
): NoteEvent['ornament'] | undefined {
  const notations = directChild(noteEl, 'notations');
  const ornamentsEl = notations ? directChild(notations, 'ornaments') : null;
  if (!ornamentsEl) return undefined;

  let found: NoteEvent['ornament'] | undefined;
  for (const child of Array.from(ornamentsEl.children)) {
    const mapped = ORNAMENT_FROM_ELEMENT[child.tagName];
    if (mapped) {
      if (found === undefined) found = mapped;
      continue;
    }
    // `<accidental-mark>` qualifies a sign rather than being one, so it is
    // not a dropped ornament and must not be reported as one.
    if (child.tagName === 'accidental-mark') continue;
    warnings.add(warnings.text.unsupportedNotation(child.tagName));
  }
  return found;
}

/** MusicXML `<ornaments>` child -> domain ornament. The words line up here. */
const ORNAMENT_FROM_ELEMENT: Record<string, NoteEvent['ornament']> = {
  'trill-mark': 'trill',
  mordent: 'mordent',
  'inverted-mordent': 'inverted-mordent',
  turn: 'turn',
};

function parseArticulation(
  noteEl: XmlElement,
  warnings: WarningCollector
): NoteEvent['articulation'] | undefined {
  const notations = directChild(noteEl, 'notations');
  const articulationsEl = notations
    ? directChild(notations, 'articulations')
    : null;
  if (!articulationsEl) return undefined;

  let found: NoteEvent['articulation'] | undefined;
  let extraCount = 0;
  for (const child of Array.from(articulationsEl.children)) {
    const mapped = ARTICULATION_FROM_ELEMENT[child.tagName];
    if (mapped) {
      if (found === undefined) {
        found = mapped;
      } else {
        extraCount += 1;
      }
    } else {
      warnings.add(warnings.text.unsupportedArticulation(child.tagName));
    }
  }
  if (extraCount > 0) {
    warnings.add(warnings.text.multipleArticulations);
  }
  return found;
}

type ParsedNote = {
  /** Set when this `<note>` was an ornament, to attach to the next real note. */
  graceNote?: GraceNote;
  /** `null` when this note must be skipped (grace note, or unsupported/malformed content). */
  raw: RawEvent | null;
  /**
   * How far the shared cursor should advance because of this note, even
   * when `raw` is `null` — e.g. an unpitched/malformed note that still
   * carries a real `<duration>` still occupies that much time, so skipping
   * *emitting* it must not also desynchronize every note that follows it
   * in the same voice. A grace note is the one skip case that correctly
   * advances by 0 (it has no duration in the main rhythm at all).
   */
  cursorAdvance: number;
};

/**
 * Parses one `<note>` element into a `RawEvent` (measure-relative ticks).
 * `cursor` is the shared measure-relative tick cursor *before* this note;
 * `measureEndTick` bounds a `<rest measure="yes">` shorthand.
 */
function parseNote(
  noteEl: XmlElement,
  cursor: number,
  measureEndTick: number,
  ratio: number,
  warnings: WarningCollector
): ParsedNote {
  warnUnsupportedNoteChildren(noteEl, warnings);

  /*
    A grace note: no `<duration>`, so it advances nothing, and it is held to be
    attached to the note it decorates rather than dropped. `graceNote` is
    returned separately from `raw` because it is not an event of its own — the
    model hangs it off its principal.
  */
  const graceEl = directChild(noteEl, 'grace');
  if (graceEl) {
    const pitchElement = directChild(noteEl, 'pitch');
    if (!pitchElement) return { raw: null, cursorAdvance: 0 };
    const typeText = textOf(noteEl, 'type');
    const dots = directChildren(noteEl, 'dot').length;
    return {
      raw: null,
      cursorAdvance: 0,
      graceNote: {
        pitch: parsePitch(pitchElement, warnings),
        durationTicks:
          typeText && isMusicXmlNoteType(typeText)
            ? ticksForNotatedType(typeText, dots, SCORE_PPQ)
            : ticksForNotatedType('eighth', 0, SCORE_PPQ),
        ...(graceEl.getAttribute('slash') === 'yes' ? { slashed: true } : {}),
      },
    };
  }

  const restEl = directChild(noteEl, 'rest');
  const pitchEl = directChild(noteEl, 'pitch');
  const unpitchedEl = directChild(noteEl, 'unpitched');
  const hasUsablePitchOrRest = Boolean(restEl) || Boolean(pitchEl);

  if (!hasUsablePitchOrRest) {
    warnings.add(
      unpitchedEl ? warnings.text.unpitched : warnings.text.noPitchOrRest
    );
  }

  /*
    The tuplet ratio, when a note carries one.

    Only needed for the `<type>`-without-`<duration>` fallback below:
    `<duration>` is stated in divisions and already scaled, so a triplet
    eighth arrives at the right tick length with no help. A note giving only
    its written type would otherwise import a third too long.
  */
  const timeModEl = directChild(noteEl, 'time-modification');
  const actualNotes = Number(textOf(timeModEl ?? noteEl, 'actual-notes'));
  const normalNotes = Number(textOf(timeModEl ?? noteEl, 'normal-notes'));
  const tupletRatio =
    timeModEl &&
    Number.isFinite(actualNotes) &&
    Number.isFinite(normalNotes) &&
    actualNotes > 0
      ? normalNotes / actualNotes
      : 1;

  const durationEl = directChild(noteEl, 'duration');
  let durationTicks: number;
  if (durationEl) {
    const xmlDuration = Number(durationEl.textContent);
    durationTicks = Number.isFinite(xmlDuration)
      ? Math.round(xmlDuration * ratio)
      : 1;
  } else if (restEl && restEl.getAttribute('measure') === 'yes') {
    durationTicks = Math.max(1, measureEndTick - cursor);
  } else {
    const typeText = textOf(noteEl, 'type');
    const dots = directChildren(noteEl, 'dot').length;
    if (typeText && isMusicXmlNoteType(typeText)) {
      durationTicks = Math.round(
        ticksForNotatedType(typeText, dots, SCORE_PPQ) * tupletRatio
      );
    } else {
      warnings.add(warnings.text.noDuration);
      return { raw: null, cursorAdvance: 0 };
    }
  }
  if (durationTicks <= 0) {
    warnings.add(warnings.text.nonPositiveDuration);
    durationTicks = 1;
  }

  if (!hasUsablePitchOrRest) {
    // Skipped for lack of pitch/rest info, but its duration is known, so
    // the cursor still advances by it (see `ParsedNote.cursorAdvance`).
    return { raw: null, cursorAdvance: durationTicks };
  }

  const pitch = restEl ? null : pitchEl ? parsePitch(pitchEl, warnings) : null;
  const voiceNumber = textOf(noteEl, 'voice') ?? '1';
  const articulation = restEl ? undefined : parseArticulation(noteEl, warnings);
  const tieEls = directChildren(noteEl, 'tie');
  const tieStart = tieEls.some(t => t.getAttribute('type') === 'start');
  const tieStop = tieEls.some(t => t.getAttribute('type') === 'stop');

  // A phrase mark, which lives inside `<notations>` rather than beside the
  // `<tie>` elements — a slur is a property of the note, unlike a dynamic.
  const notationsEl = directChild(noteEl, 'notations');
  const slurEls = notationsEl ? directChildren(notationsEl, 'slur') : [];
  const slurStart = slurEls.some(el => el.getAttribute('type') === 'start');
  const slurStop = slurEls.some(el => el.getAttribute('type') === 'stop');

  /*
    A pause, also a `<notations>` child. Its presence is the whole marking —
    the `type` attribute only says which way the glyph is drawn, which the
    renderer decides for itself from the stem, and `<fermata>` with no
    attribute at all is both legal and common.

    Only on notes: the model carries a fermata on a `NoteEvent`, so one written
    over a rest is dropped rather than misfiled onto the following note.
  */
  const fermata = restEl
    ? false
    : notationsEl !== null && directChildren(notationsEl, 'fermata').length > 0;

  const ornament = restEl ? undefined : parseOrnament(noteEl, warnings);

  const lyric = restEl ? undefined : parseLyric(noteEl);

  const raw: RawEvent = {
    startTick: cursor,
    durationTicks,
    pitch,
    voiceNumber,
    articulation,
    tieStart,
    tieStop,
    ...(lyric ? { lyric } : {}),
    ...(slurStart ? { slurStart: true } : {}),
    ...(slurStop ? { slurStop: true } : {}),
    ...(fermata ? { fermata: true } : {}),
    ...(ornament ? { ornament } : {}),
  };
  return { raw, cursorAdvance: durationTicks };
}

// ---- Gap-filling within a measure's voice ------------------------------------

/**
 * Fills the gaps in one measure-voice's raw (measure-relative) events with
 * rests, trims any event extending past the measure end, and offsets every
 * event by `measureStartTick` to produce absolute score ticks — so the
 * voice's events cover `[measureStartTick, measureStartTick + durationTicks)`
 * exactly (spec §23's "voice content sums exactly to measure duration"
 * invariant). The counterpart of `adapters/midi/measures.ts`'s private
 * `fillVoiceGaps`, kept as a local copy since import here works from
 * already-measure-scoped XML content rather than a continuous cross-measure
 * timeline.
 */
function fillAndClip(
  raw: RawEvent[],
  durationTicks: number,
  measureStartTick: number,
  trackId: string,
  voiceId: string,
  warnings: WarningCollector
): MusicalEvent[] {
  const sorted = [...raw].sort((a, b) => a.startTick - b.startTick);
  const events: MusicalEvent[] = [];
  let cursor = 0;

  for (const item of sorted) {
    const start = Math.max(0, item.startTick);
    if (start > cursor) {
      events.push({
        id: createId(),
        startTick: measureStartTick + cursor,
        durationTicks: start - cursor,
        voiceId,
        trackId,
      });
    }
    let duration = item.durationTicks;
    if (start + duration > durationTicks) {
      warnings.add(warnings.text.noteTrimmed);
      duration = Math.max(1, durationTicks - start);
    }
    if (item.pitch) {
      const note: NoteEvent = {
        id: createId(),
        pitch: item.pitch,
        startTick: measureStartTick + start,
        durationTicks: duration,
        velocity: DEFAULT_VELOCITY,
        voiceId,
        trackId,
        ...(item.tieStart ? { tieStart: true } : {}),
        ...(item.tieStop ? { tieStop: true } : {}),
        ...(item.articulation ? { articulation: item.articulation } : {}),
        ...(item.fermata ? { fermata: true } : {}),
        ...(item.ornament ? { ornament: item.ornament } : {}),
        ...(item.dynamic ? { dynamic: item.dynamic } : {}),
        ...(item.slurStart ? { slurStart: true } : {}),
        ...(item.slurStop ? { slurStop: true } : {}),
        ...(item.lyric ? { lyric: item.lyric } : {}),
        ...(item.graceNotes?.length ? { graceNotes: item.graceNotes } : {}),
        ...(item.chordSymbol ? { chordSymbol: item.chordSymbol } : {}),
      };
      events.push(note);
    } else {
      const rest: RestEvent = {
        id: createId(),
        startTick: measureStartTick + start,
        durationTicks: duration,
        voiceId,
        trackId,
      };
      events.push(rest);
    }
    cursor = Math.max(cursor, start + duration);
  }

  if (cursor < durationTicks) {
    events.push({
      id: createId(),
      startTick: measureStartTick + cursor,
      durationTicks: durationTicks - cursor,
      voiceId,
      trackId,
    });
  }

  return events;
}

// ---- Measure parsing ------------------------------------------------------------

type ParsedMeasure = { measure: Measure; tempoEvents: TempoEvent[] };

function parseMeasure(
  measureEl: XmlElement,
  index: number,
  startTick: number,
  state: MeasureState,
  trackId: string,
  warnings: WarningCollector
): ParsedMeasure {
  const buckets = new Map<string, RawEvent[]>();
  const tempoEvents: TempoEvent[] = [];
  let cursor = 0;
  /** The position `<chord/>`-flagged notes attach to: the cursor value at the start of the current (non-chord) note. */
  let lastNoteStart = 0;
  /** Set by a `<direction>`, consumed by the next `<note>` it applies from. */
  let pendingDynamic: Dynamic | undefined;
  /** Set by a `<harmony>`, consumed by the note it sits over — same shape. */
  let pendingChordSymbol: string | undefined;
  /** Repeat structure, collected from this measure's `<barline>` elements. */
  let repeatStart = false;
  let repeatEnd = false;
  let endingNumbers: number[] | undefined;
  /**
   * Ornaments read so far, waiting for the note they decorate.
   *
   * MusicXML writes them *before* their principal, so by the time it is parsed
   * they have already gone past — the same shape of problem as a dynamic.
   */
  let pendingGraceNotes: GraceNote[] = [];

  const knownTags = new Set([
    'attributes',
    'note',
    'backup',
    'forward',
    'direction',
    'print',
    'barline',
    'sound',
  ]);

  for (const child of Array.from(measureEl.children)) {
    switch (child.tagName) {
      case 'attributes':
        applyAttributes(child, state, index + 1, warnings);
        break;

      case 'direction': {
        /*
          A dynamic marking. Held until the next `<note>`, which is the one it
          applies from — MusicXML places the direction *before* that note, so
          by the time the note is parsed the marking has already gone past.
        */
        const dynamicsEl = directChild(
          directChild(child, 'direction-type') ?? child,
          'dynamics'
        );
        const markName = dynamicsEl?.children[0]?.tagName;
        if (markName && (DYNAMICS as readonly string[]).includes(markName)) {
          pendingDynamic = markName as Dynamic;
        }

        const soundEl = directChild(child, 'sound');
        const tempoAttr = soundEl?.getAttribute('tempo');
        if (tempoAttr) {
          const bpmRaw = Number(tempoAttr);
          if (Number.isFinite(bpmRaw)) {
            const offsetEl = directChild(child, 'offset');
            const offsetTicks = offsetEl
              ? Math.round(Number(offsetEl.textContent) * state.ratio)
              : 0;
            tempoEvents.push({
              id: createId(),
              tick: startTick + Math.max(0, offsetTicks),
              bpm: bpmRaw,
            });
          }
        }
        break;
      }

      case 'harmony': {
        /*
          Rebuilt from the root plus the kind's display text, which is how it
          was written: `<kind>`'s enumerated value is deliberately not consulted
          because the text is what a player reads and what round-trips.
        */
        const rootEl = directChild(child, 'root');
        const step = rootEl ? textOf(rootEl, 'root-step') : null;
        if (step) {
          const alter = Number(rootEl ? textOf(rootEl, 'root-alter') : '0');
          const accidental = alter === 1 ? '#' : alter === -1 ? 'b' : '';
          const kindEl = directChild(child, 'kind');
          const quality =
            kindEl?.getAttribute('text') ?? kindEl?.textContent?.trim() ?? '';
          pendingChordSymbol = `${step}${accidental}${quality === 'other' ? '' : quality}`;
        }
        break;
      }

      case 'note': {
        const isChord = Boolean(directChild(child, 'chord'));
        // A chord note shares its "root" (the preceding non-chord note)'s
        // start position; a non-chord note starts wherever the shared
        // cursor currently sits (and becomes the new root for any chord
        // notes that follow it).
        const eventStart = isChord ? lastNoteStart : cursor;
        const measureEndTick = measureDurationTicks(
          state.timeSignature,
          SCORE_PPQ
        );
        const parsed = parseNote(
          child,
          eventStart,
          measureEndTick,
          state.ratio,
          warnings
        );
        const { raw, cursorAdvance } = parsed;
        if (parsed.graceNote) {
          pendingGraceNotes.push(parsed.graceNote);
        }
        if (raw) {
          // Ornaments belong to the next sounding note, never to a rest.
          if (pendingGraceNotes.length > 0 && raw.pitch !== null) {
            raw.graceNotes = pendingGraceNotes;
            pendingGraceNotes = [];
          }
          // Only a pitched note carries a dynamic: a rest has nothing to
          // sound at that level, and MusicXML would not put one on it.
          if (pendingChordSymbol && raw.pitch !== null) {
            raw.chordSymbol = pendingChordSymbol;
            pendingChordSymbol = undefined;
          }
          if (pendingDynamic && raw.pitch !== null) {
            raw.dynamic = pendingDynamic;
            pendingDynamic = undefined;
          }
          const bucket = buckets.get(raw.voiceNumber) ?? [];
          buckets.set(raw.voiceNumber, bucket);
          bucket.push(raw);
        }
        if (!isChord) {
          lastNoteStart = cursor;
          cursor += cursorAdvance;
        }
        break;
      }

      case 'backup': {
        const d = numberOf(child, 'duration') ?? 0;
        cursor = Math.max(0, cursor - Math.round(d * state.ratio));
        break;
      }

      case 'forward': {
        const d = numberOf(child, 'duration') ?? 0;
        cursor += Math.round(d * state.ratio);
        break;
      }

      case 'barline': {
        /*
          Repeat barlines and volta brackets.

          MusicXML states them per side — a forward repeat and an ending's
          start on the left, a backward repeat and its stop on the right — so
          both locations are read into the one measure the model stores them
          on. The ending's numbers come from the `number` attribute, which is a
          comma-separated list for a bar played on more than one pass.
        */
        const repeat = directChild(child, 'repeat');
        const direction = repeat?.getAttribute('direction');
        if (direction === 'forward') repeatStart = true;
        if (direction === 'backward') repeatEnd = true;

        const ending = directChild(child, 'ending');
        const numbers = ending?.getAttribute('number');
        if (numbers) {
          const parsed = numbers
            .split(',')
            .map(part => Number(part.trim()))
            .filter(n => Number.isInteger(n) && n > 0);
          if (parsed.length > 0) endingNumbers = parsed;
        }
        break;
      }

      case 'print':
      case 'sound':
        break;

      default:
        if (!knownTags.has(child.tagName)) {
          warnings.add(warnings.text.unsupportedMeasureElement(child.tagName));
        }
        break;
    }
  }

  // Computed only now (after every <attributes> in this measure has been
  // applied to `state`) so a measure whose own <attributes> changes the
  // time signature sizes itself by the *new* signature, not whatever was
  // in effect when this measure started.
  const durationTicks = measureDurationTicks(state.timeSignature, SCORE_PPQ);

  const voiceNumbers = [...buckets.keys()].sort(
    (a, b) => Number(a) - Number(b) || a.localeCompare(b)
  );
  const effectiveVoiceNumbers = voiceNumbers.length > 0 ? voiceNumbers : ['1'];

  const voices = effectiveVoiceNumbers.map((voiceNumber, i) => {
    const voiceId = createId();
    const raw = buckets.get(voiceNumber) ?? [];
    return {
      id: voiceId,
      name: `Voice ${i + 1}`,
      events: fillAndClip(
        raw,
        durationTicks,
        startTick,
        trackId,
        voiceId,
        warnings
      ),
    };
  });

  const measure: Measure = {
    id: createId(),
    index,
    startTick,
    durationTicks,
    timeSignature: state.timeSignature,
    keySignature: state.keySignature,
    voices,
    ...(repeatStart ? { repeatStart: true } : {}),
    ...(repeatEnd ? { repeatEnd: true } : {}),
    ...(endingNumbers ? { endingNumbers } : {}),
  };

  return { measure, tempoEvents };
}

// ---- Part / track assembly ------------------------------------------------------

function parsePart(
  partEl: XmlElement,
  meta: ScorePartMeta | undefined,
  partIndex: number,
  warnings: WarningCollector
): { track: Track; tempoEvents: TempoEvent[] } {
  const trackId = createId();
  const state: MeasureState = {
    ratio: 1,
    timeSignature: DEFAULT_TIME_SIGNATURE,
    keySignature: DEFAULT_KEY_SIGNATURE,
    clef: null,
  };

  const measures: Measure[] = [];
  const tempoEvents: TempoEvent[] = [];
  let startTick = 0;

  directChildren(partEl, 'measure').forEach((measureEl, index) => {
    const { measure, tempoEvents: measureTempos } = parseMeasure(
      measureEl,
      index,
      startTick,
      state,
      trackId,
      warnings
    );
    measures.push(measure);
    tempoEvents.push(...measureTempos);
    startTick += measure.durationTicks;
  });

  const track: Track = {
    id: trackId,
    name:
      meta?.name && meta.name.length > 0 ? meta.name : `Part ${partIndex + 1}`,
    instrumentName:
      meta?.instrumentName && meta.instrumentName.length > 0
        ? meta.instrumentName
        : 'Instrument',
    midiProgram: Math.min(
      127,
      Math.max(0, Math.round((meta?.midiProgram ?? 1) - 1))
    ),
    midiChannel: Math.min(
      15,
      Math.max(0, Math.round((meta?.midiChannel ?? 1) - 1))
    ),
    clef: state.clef ?? 'treble',
    volume: 1,
    pan: 0,
    muted: false,
    solo: false,
    measures,
  };

  return { track, tempoEvents };
}

// ---- Tempo map ------------------------------------------------------------------

function buildTempoMap(
  rawTempos: TempoEvent[],
  warnings: WarningCollector
): TempoEvent[] {
  const byTick = new Map<number, number>();
  for (const t of rawTempos) {
    if (!byTick.has(t.tick)) byTick.set(t.tick, t.bpm);
  }

  const sorted = [...byTick.entries()].sort((a, b) => a[0] - b[0]);
  const withOrigin =
    sorted.length > 0 && sorted[0][0] === 0
      ? sorted
      : [[0, DEFAULT_TEMPO_BPM] as [number, number], ...sorted];

  if (sorted.length === 0) {
    warnings.add(warnings.text.noTempo(DEFAULT_TEMPO_BPM));
  }

  return withOrigin.map(([tick, bpm]) => {
    const clamped = Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
    if (clamped !== bpm) {
      warnings.add(warnings.text.tempoClamped(bpm, MIN_BPM, MAX_BPM, clamped));
    }
    return { id: createId(), tick, bpm: clamped };
  });
}

// ---- Entry point ------------------------------------------------------------------

export type MusicXmlImportResult = { score: Score; warnings: string[] };

/**
 * Imports a MusicXML (score-partwise) document string as a `Score` (spec
 * §17): part-list (name/instrument/MIDI program/channel) -> tracks,
 * measures (attributes converted to 480-ppq divisions, key/time/clef),
 * notes/rests/chords/voices (via `<backup>`/`<forward>` cursor tracking),
 * ties, articulations, and tempo directions. Never throws for
 * unsupported-but-valid musical content (lyrics, grace notes, ornaments,
 * unsupported tuplet ratios/clefs/key modes, ...) — those are skipped and
 * reported once each in the returned `warnings`. Throws only for input
 * that isn't parseable XML, or whose root isn't `<score-partwise>`
 * (score-timewise documents aren't supported).
 */
export function importMusicXml(
  xmlText: string,
  parser: XmlParser,
  warningText: MusicXmlWarnings
): MusicXmlImportResult {
  // Well-formedness is the parser's business -- it throws XmlParseError -- so
  // all that is left here is rejecting a document that parses but is not a
  // score-partwise.
  const root = parser.parse(xmlText);
  if (root.tagName !== 'score-partwise') {
    throw new Error(
      `importMusicXml: expected a <score-partwise> root element, found <${root.tagName}>. score-timewise documents are not supported.`
    );
  }

  const warnings = new WarningCollector(warningText);
  const partMeta = parsePartList(root);

  const tracks: Track[] = [];
  const allTempoEvents: TempoEvent[] = [];
  Array.from(root.children)
    .filter(el => el.tagName === 'part')
    .forEach((partEl, index) => {
      const id = partEl.getAttribute('id');
      const { track, tempoEvents } = parsePart(
        partEl,
        id ? partMeta.get(id) : undefined,
        index,
        warnings
      );
      tracks.push(track);
      allTempoEvents.push(...tempoEvents);
    });

  const tempoMap = buildTempoMap(allTempoEvents, warnings);

  const workTitle = textOf(directChild(root, 'work'), 'work-title');
  const identification = directChild(root, 'identification');
  const composer = identification
    ? Array.from(directChildren(identification, 'creator'))
        .find(c => c.getAttribute('type') === 'composer')
        ?.textContent?.trim()
    : undefined;

  const now = new Date().toISOString();
  const score: Score = {
    id: createId(),
    version: 1,
    ppq: SCORE_PPQ,
    metadata: {
      title:
        workTitle && workTitle.length > 0 ? workTitle : 'Imported MusicXML',
      ...(composer ? { composer } : {}),
      createdAt: now,
      updatedAt: now,
    },
    tempoMap,
    tracks,
  };

  return { score, warnings: warnings.messages };
}
