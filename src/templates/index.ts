/**
 * Project templates — deterministic starter scores surfaced as "New from
 * template" (replacing the deleted Dexie sample-project installer; the
 * server owns projects now, so samples became client-side templates).
 *
 * Most of these are **empty ensembles**: the right instruments, clefs, keys,
 * meters and bar counts, with nothing written in them. That is what a template
 * is for — the tedious part of starting a score is naming four staves and
 * setting their clefs and transpositions, not writing the first note, and a
 * template that arrives with music in it has to be deleted before it can be
 * used. The three that carry notes are marked as such in their descriptions.
 *
 * Instrument numbers are General MIDI programs (`gm.ts`); `instrumentName` is
 * taken from the same catalogue rather than typed out, so the two cannot drift
 * — the same rule the track editor follows.
 */
import type { Score, Track } from '@sudobility/music_types';
import { createEmptyScore } from '../domain/score/factory.js';
import { gmInstrument } from '../domain/instruments/gm.js';
import { gmKitAt } from '../domain/instruments/gm-kit.js';
import { chordScore, twinkleScore, twoTrackScore } from '../test/fixtures.js';

export type ProjectTemplate = {
  id: TemplateId;
  name: string;
  description: string;
  build: () => Score;
};

/** Every template this module can build. Stable — it is persisted in nothing, but hosts key their copy off it. */
export const TEMPLATE_IDS = [
  'lead-sheet',
  'piano-grand-staff',
  'string-quartet',
  'jazz-combo',
  'rock-band',
  'satb-choir',
  'drum-kit',
  'waltz',
  'jig',
  'gentle-piano-melody',
  'pop-arrangement',
  'orchestral-passage',
] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];

/**
 * The name and description shown for each template, supplied by the host.
 *
 * This module owns the *music* — which instruments, clefs, keys and bar counts
 * a starter score has — and nothing else. The words describing them are the
 * host's, because only the host knows what language it is speaking.
 */
export type TemplateCopy = Record<
  TemplateId,
  { name: string; description: string }
>;

/** One track of a template: a GM program, plus how it should be written. */
type TemplateTrack = Partial<Track> & { name: string };

/** A pitched track, named from the GM catalogue so the label matches the sound. */
function part(
  name: string,
  program: number,
  clef: Track['clef'] = 'treble'
): TemplateTrack {
  return {
    name,
    midiProgram: program,
    instrumentName: gmInstrument(program)?.name ?? name,
    clef,
  };
}

/**
 * A drum track. Its `midiProgram` addresses a **kit**, not an instrument, which
 * is why it cannot go through `part` — see `gm-kit.ts`.
 */
function drums(name = 'Drums', kit = 0): TemplateTrack {
  const resolved = gmKitAt(kit);
  return {
    name,
    midiProgram: resolved.program,
    instrumentName: resolved.name,
    clef: 'percussion',
  };
}

export function projectTemplates(copy: TemplateCopy): ProjectTemplate[] {
  return [
    // --- empty ensembles ----------------------------------------------------
    {
      id: 'lead-sheet',
      name: copy['lead-sheet'].name,
      description: copy['lead-sheet'].description,
      build: () =>
        createEmptyScore({
          title: 'Lead Sheet',
          measures: 16,
          tracks: [part('Melody', 0)],
        }),
    },
    {
      id: 'piano-grand-staff',
      name: copy['piano-grand-staff'].name,
      description: copy['piano-grand-staff'].description,
      build: () =>
        createEmptyScore({
          title: 'Piano',
          measures: 16,
          tracks: [part('Right Hand', 0), part('Left Hand', 0, 'bass')],
        }),
    },
    {
      id: 'string-quartet',
      name: copy['string-quartet'].name,
      description: copy['string-quartet'].description,
      build: () =>
        createEmptyScore({
          title: 'String Quartet',
          measures: 16,
          tracks: [
            part('Violin I', 40),
            part('Violin II', 40),
            part('Viola', 41, 'alto'),
            part('Cello', 42, 'bass'),
          ],
        }),
    },
    {
      id: 'jazz-combo',
      name: copy['jazz-combo'].name,
      description: copy['jazz-combo'].description,
      build: () =>
        createEmptyScore({
          title: 'Jazz Combo',
          measures: 32,
          keySignature: { fifths: -2, mode: 'major' },
          tempo: 132,
          tracks: [
            part('Trumpet', 56),
            part('Piano', 0),
            part('Bass', 32, 'bass'),
            drums('Drums', 32),
          ],
        }),
    },
    {
      id: 'rock-band',
      name: copy['rock-band'].name,
      description: copy['rock-band'].description,
      build: () =>
        createEmptyScore({
          title: 'Rock Band',
          measures: 32,
          tracks: [
            part('Lead Guitar', 29),
            part('Rhythm Guitar', 27),
            part('Bass', 33, 'bass'),
            drums('Drums', 16),
          ],
        }),
    },
    {
      id: 'satb-choir',
      name: copy['satb-choir'].name,
      description: copy['satb-choir'].description,
      build: () =>
        createEmptyScore({
          title: 'SATB Choir',
          measures: 16,
          tracks: [
            part('Soprano', 52),
            part('Alto', 52),
            part('Tenor', 53),
            part('Bass', 53, 'bass'),
          ],
        }),
    },
    {
      id: 'drum-kit',
      name: copy['drum-kit'].name,
      description: copy['drum-kit'].description,
      build: () =>
        createEmptyScore({
          title: 'Drum Kit',
          measures: 16,
          tracks: [drums()],
        }),
    },
    {
      id: 'waltz',
      name: copy['waltz'].name,
      description: copy['waltz'].description,
      build: () =>
        createEmptyScore({
          title: 'Waltz',
          measures: 24,
          timeSignature: { numerator: 3, denominator: 4 },
          tempo: 160,
          tracks: [part('Right Hand', 0), part('Left Hand', 0, 'bass')],
        }),
    },
    {
      id: 'jig',
      name: copy['jig'].name,
      description: copy['jig'].description,
      build: () =>
        createEmptyScore({
          title: 'Jig',
          measures: 16,
          timeSignature: { numerator: 6, denominator: 8 },
          tempo: 116,
          tracks: [part('Melody', 73)],
        }),
    },

    // --- starters that carry music ------------------------------------------
    {
      id: 'gentle-piano-melody',
      name: copy['gentle-piano-melody'].name,
      description: copy['gentle-piano-melody'].description,
      build: () => withTitle(twinkleScore(), 'Gentle Piano Melody'),
    },
    {
      id: 'pop-arrangement',
      name: copy['pop-arrangement'].name,
      description: copy['pop-arrangement'].description,
      build: () => withTitle(twoTrackScore(), 'Pop Arrangement'),
    },
    {
      id: 'orchestral-passage',
      name: copy['orchestral-passage'].name,
      description: copy['orchestral-passage'].description,
      build: () => withTitle(chordScore(), 'Orchestral Passage'),
    },
  ];
}

export function templateSummaries(
  copy: TemplateCopy
): Array<Pick<ProjectTemplate, 'id' | 'name' | 'description'>> {
  return projectTemplates(copy).map(({ id, name, description }) => ({
    id,
    name,
    description,
  }));
}

/**
 * Builds one template by id.
 *
 * Takes the copy because a template's name is also the created project's
 * title, and that title is the host's words — the same reason the list does.
 */
export function buildTemplate(id: string, copy: TemplateCopy): Score | null {
  const template = projectTemplates(copy).find(t => t.id === id);
  return template ? template.build() : null;
}

function withTitle(score: Score, title: string): Score {
  return { ...score, metadata: { ...score.metadata, title } };
}
