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
  id: string;
  name: string;
  description: string;
  build: () => Score;
};

/** One track of a template: a GM program, plus how it should be written. */
type TemplateTrack = Partial<Track> & { name: string };

/** A pitched track, named from the GM catalogue so the label matches the sound. */
function part(name: string, program: number, clef: Track['clef'] = 'treble'): TemplateTrack {
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

export const projectTemplates: ProjectTemplate[] = [
  // --- empty ensembles ----------------------------------------------------
  {
    id: 'lead-sheet',
    name: 'Lead Sheet',
    description: 'One treble staff, 16 bars of 4/4. The blank page.',
    build: () =>
      createEmptyScore({
        title: 'Lead Sheet',
        measures: 16,
        tracks: [part('Melody', 0)],
      }),
  },
  {
    id: 'piano-grand-staff',
    name: 'Piano (Grand Staff)',
    description: 'Treble over bass, 16 bars — two hands on one instrument.',
    build: () =>
      createEmptyScore({
        title: 'Piano',
        measures: 16,
        tracks: [part('Right Hand', 0), part('Left Hand', 0, 'bass')],
      }),
  },
  {
    id: 'string-quartet',
    name: 'String Quartet',
    description: 'Violin I & II, viola on alto clef, cello on bass. 16 bars.',
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
    name: 'Jazz Combo',
    description: 'Trumpet, piano, upright bass and a jazz kit. 32 bars, B♭ major.',
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
    name: 'Rock Band',
    description: 'Two guitars, bass and a rock kit. 32 bars at 120.',
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
    name: 'SATB Choir',
    description: 'Soprano, alto, tenor and bass voices. 16 bars.',
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
    name: 'Drum Kit',
    description: 'One percussion staff, 16 bars — the keyboard names every drum.',
    build: () =>
      createEmptyScore({
        title: 'Drum Kit',
        measures: 16,
        tracks: [drums()],
      }),
  },
  {
    id: 'waltz',
    name: 'Waltz (3/4)',
    description: 'Piano in three, 24 bars — a different meter to start in.',
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
    name: 'Jig (6/8)',
    description: 'A single melody line in compound time, 16 bars.',
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
    name: 'Gentle Piano Melody',
    description: 'An 8-measure C-major piano melody, written in, to start from.',
    build: () => withTitle(twinkleScore(), 'Gentle Piano Melody'),
  },
  {
    id: 'pop-arrangement',
    name: 'Pop Arrangement',
    description: 'A two-track treble/bass arrangement skeleton, with notes.',
    build: () => withTitle(twoTrackScore(), 'Pop Arrangement'),
  },
  {
    id: 'orchestral-passage',
    name: 'Orchestral Passage',
    description: 'Block chords to orchestrate.',
    build: () => withTitle(chordScore(), 'Orchestral Passage'),
  },
];

export function templateSummaries(): Array<Pick<ProjectTemplate, 'id' | 'name' | 'description'>> {
  return projectTemplates.map(({ id, name, description }) => ({ id, name, description }));
}

export function buildTemplate(id: string): Score | null {
  const template = projectTemplates.find((t) => t.id === id);
  return template ? template.build() : null;
}

function withTitle(score: Score, title: string): Score {
  return { ...score, metadata: { ...score.metadata, title } };
}
