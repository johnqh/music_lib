/**
 * A warning catalogue for tests.
 *
 * The importer no longer owns this text — a consumer supplies it — so the
 * suite plays the consumer. The wording matches what the importer used to
 * carry, which keeps the existing assertions (`/grace/i`, `/clef/i`) meaningful
 * without the library shipping English again.
 */
import type { MusicXmlWarnings } from '../adapters/musicxml/import.js';

export const TEST_MUSICXML_WARNINGS: MusicXmlWarnings = {
  unsupportedClef: (sign, line) =>
    `Unsupported clef (sign "${sign}", line ${line}) approximated as treble.`,
  unsupportedKeyMode: mode =>
    `Unsupported key mode "${mode}" was defaulted to major.`,
  unsupportedTime: measureNumber =>
    `A senza-misura or otherwise unsupported <time> element at measure ${measureNumber} did not change the time signature.`,
  complexTimeSignature:
    'A complex (multi-pair) time signature was simplified to its first beats/beat-type pair.',
  clefChangeDropped: (clef, measureNumber) =>
    `A clef change to ${clef} at measure ${measureNumber} was dropped (the domain model supports only one clef per track).`,
  unsupportedPitchStep: step =>
    `Unsupported pitch step "${step}" was defaulted to C.`,
  alterRounded: (alter, clamped) =>
    `A microtonal or out-of-range <alter> value (${alter}) was rounded/clamped to ${clamped}.`,
  graceNotes: 'Grace notes are not supported and were skipped.',
  lyrics: 'Lyrics are not supported and were ignored.',
  tuplets:
    'Tuplets (<time-modification>) are imported using their written duration in ticks, which may not reproduce the exact tuplet grouping.',
  ornaments: 'Ornaments are not supported and were ignored.',
  unsupportedNotation: tag => `Unsupported notation <${tag}> was ignored.`,
  unsupportedNoteElement: tag =>
    `Unsupported note element <${tag}> was ignored.`,
  unsupportedArticulation: tag =>
    `Unsupported articulation <${tag}> was ignored.`,
  multipleArticulations:
    'A note had more than one articulation; only the first was kept (the domain model supports one per note).',
  unpitched: 'Unpitched (percussion) notes are not supported and were skipped.',
  noPitchOrRest: 'A note with neither <pitch> nor <rest> was skipped.',
  noDuration: 'A note with no <duration> and no usable <type> was skipped.',
  nonPositiveDuration:
    'A note with non-positive duration was clamped to 1 tick.',
  noteTrimmed:
    'A note/rest extending past the end of its measure was trimmed to fit.',
  unsupportedMeasureElement: tag =>
    `Unsupported measure element <${tag}> was ignored.`,
  noTempo: defaultBpm =>
    `No tempo direction was found; defaulted to ${defaultBpm} bpm.`,
  tempoClamped: (bpm, min, max, clamped) =>
    `A tempo of ${bpm} bpm was outside the supported ${min}-${max} bpm range and was clamped to ${clamped}.`,
};
