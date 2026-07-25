/**
 * Sample-project seeding (spec §19: "At least three sample projects: 1)
 * simple piano melody; 2) four-track pop arrangement; 3) short
 * orchestral-style passage"). Built via `MockGenerationProvider` with fixed
 * seeds, so every install produces byte-for-byte identical scores — no
 * checked-in fixture JSON to keep in sync with the generator.
 *
 * `installSampleProjects` is idempotent — including under concurrent calls
 * on the same `db` (e.g. two tabs booting at once): the "which samples are
 * missing" check and the inserts happen inside a single `readwrite`
 * transaction on `projects`, so IndexedDB's own transaction serialization
 * rules out the check-then-insert race a naive "read names, then loop
 * `add`" would have (two concurrent transactions on the same store never
 * interleave; the second one's read is guaranteed to see the first one's
 * writes once it commits).
 */
import { MockGenerationProvider } from '../generation/mock-provider';
import type { GenerateScoreRequest } from '@sudobility/music_types';
import type { ProjectRecord, ScoreSmithDb } from './db';
import { createProject, listProjects } from './projects';

type SampleDefinition = {
  name: string;
  /** Fixed per-sample seed: keeps this sample's content stable across installs/releases, and independent of the other samples' seeds. */
  seed: string;
  request: GenerateScoreRequest;
};

const GENTLE_PIANO_MELODY: SampleDefinition = {
  name: 'Gentle Piano Melody',
  seed: 'scoresmith-sample-gentle-piano-melody-v1',
  request: {
    prompt: 'Create a gentle eight-measure piano melody in C major',
    title: 'Gentle Piano Melody',
    durationMeasures: 8,
    tempo: 96,
    keySignature: { fifths: 0, mode: 'major' },
    timeSignature: { numerator: 4, denominator: 4 },
    complexity: 'simple',
    tracks: [{ name: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' }],
  },
};

const POP_ARRANGEMENT: SampleDefinition = {
  name: 'Pop Arrangement',
  seed: 'scoresmith-sample-pop-arrangement-v1',
  request: {
    prompt: 'Create an upbeat pop arrangement with piano, bass, drums, and strings',
    title: 'Pop Arrangement',
    durationMeasures: 16,
    tempo: 120,
    complexity: 'moderate',
    tracks: [
      { name: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' },
      { name: 'Strings', instrumentName: 'String Ensemble', midiProgram: 48, clef: 'treble' },
      { name: 'Bass', instrumentName: 'Electric Bass', midiProgram: 33, clef: 'bass' },
      { name: 'Drums', instrumentName: 'Drum Kit', midiProgram: 0, clef: 'percussion' },
    ],
  },
};

const ORCHESTRAL_PASSAGE: SampleDefinition = {
  name: 'Orchestral Passage',
  seed: 'scoresmith-sample-orchestral-passage-v1',
  request: {
    prompt: 'Create a cinematic twelve-measure orchestral passage in D minor',
    title: 'Orchestral Passage',
    durationMeasures: 12,
    tempo: 88,
    keySignature: { fifths: -1, mode: 'minor' },
    complexity: 'complex',
    tracks: [
      { name: 'Violin I', instrumentName: 'Violin', midiProgram: 40, clef: 'treble' },
      { name: 'Violin II', instrumentName: 'Violin', midiProgram: 40, clef: 'treble' },
      { name: 'Cello & Bass', instrumentName: 'Cello', midiProgram: 42, clef: 'bass' },
    ],
  },
};

/** The three built-in sample projects (spec §19), in install order. */
export const SAMPLE_DEFINITIONS: readonly SampleDefinition[] = [
  GENTLE_PIANO_MELODY,
  POP_ARRANGEMENT,
  ORCHESTRAL_PASSAGE,
];

/**
 * Installs any sample project (from `SAMPLE_DEFINITIONS`) not already
 * present in `db` (matched by name), generating each via a fresh
 * `MockGenerationProvider` seeded per-sample. Returns the records that were
 * actually created (empty if every sample already existed). Safe to call on
 * every app boot, including concurrently from multiple tabs against the
 * same `db`: a second (or simultaneous) call creates nothing.
 */
export async function installSampleProjects(db: ScoreSmithDb): Promise<ProjectRecord[]> {
  // Generate every candidate score *before* opening the transaction below.
  // A Dexie transaction auto-commits as soon as the callback awaits
  // anything that isn't itself a Dexie operation on a table included in the
  // transaction — `MockGenerationProvider.generateScore` isn't one, so it
  // must not run inside the `db.transaction(...)` callback.
  const candidates = await Promise.all(
    SAMPLE_DEFINITIONS.map(async (sample) => {
      const provider = new MockGenerationProvider({ seed: sample.seed });
      const { score } = await provider.generateScore(sample.request);
      return { sample, score };
    }),
  );

  const created: ProjectRecord[] = [];

  // Check-and-insert as one atomic readwrite transaction: re-reading
  // `existingNames` *inside* the transaction (rather than once, up front)
  // is what makes concurrent `installSampleProjects` calls on the same `db`
  // race-free — IndexedDB serializes readwrite transactions on the same
  // store, so the second call's read only happens after the first call's
  // transaction (reads + writes) has fully committed.
  await db.transaction('rw', db.projects, async () => {
    const existingNames = new Set((await listProjects(db)).map((project) => project.name));

    for (const { sample, score } of candidates) {
      if (existingNames.has(sample.name)) continue;
      const record = await createProject(db, { name: sample.name, score });
      created.push(record);
      existingNames.add(sample.name);
    }
  });

  return created;
}
