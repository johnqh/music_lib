import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateScore } from '../../domain/validation/validator.js';
import { ScoreSmithDb } from './db.js';
import { installSampleProjects } from './samples.js';
import { listProjects } from './projects.js';

let db: ScoreSmithDb;
let dbCounter = 0;

beforeEach(() => {
  dbCounter += 1;
  db = new ScoreSmithDb(`scoresmith-test-samples-${dbCounter}`);
});

afterEach(async () => {
  await db.delete();
});

describe('installSampleProjects', () => {
  it('installs exactly the three named sample projects', async () => {
    const created = await installSampleProjects(db);
    expect(created).toHaveLength(3);
    expect(created.map((p) => p.name).sort()).toEqual(
      ['Gentle Piano Melody', 'Orchestral Passage', 'Pop Arrangement'].sort(),
    );

    const all = await listProjects(db);
    expect(all).toHaveLength(3);
  });

  it('is idempotent: a second call installs nothing further', async () => {
    await installSampleProjects(db);
    const secondCall = await installSampleProjects(db);

    expect(secondCall).toEqual([]);
    const all = await listProjects(db);
    expect(all).toHaveLength(3);
  });

  it('is idempotent under concurrent calls on the same db (no TOCTOU duplicate inserts)', async () => {
    const [firstResult, secondResult] = await Promise.all([
      installSampleProjects(db),
      installSampleProjects(db),
    ]);

    // Together, exactly the three samples were created (split however the
    // two racing calls happened to divide the work) — never six.
    const combinedNames = [...firstResult, ...secondResult].map((p) => p.name).sort();
    expect(combinedNames).toEqual(
      ['Gentle Piano Melody', 'Orchestral Passage', 'Pop Arrangement'].sort(),
    );

    const all = await listProjects(db);
    expect(all).toHaveLength(3);
    expect(new Set(all.map((p) => p.name)).size).toBe(3);
  });

  it('every installed sample is a structurally valid score with zero validation errors', async () => {
    const created = await installSampleProjects(db);
    for (const record of created) {
      const issues = validateScore(record.score);
      expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    }
  });

  it('"Gentle Piano Melody" is an 8-measure single-piano-track score in C major', async () => {
    const created = await installSampleProjects(db);
    const sample = created.find((p) => p.name === 'Gentle Piano Melody')!;

    expect(sample.score.tracks).toHaveLength(1);
    expect(sample.score.tracks[0].measures).toHaveLength(8);
    expect(sample.score.tracks[0].measures[0].keySignature).toEqual({ fifths: 0, mode: 'major' });
  });

  it('"Pop Arrangement" has piano/strings/bass/drums tracks over 16 measures', async () => {
    const created = await installSampleProjects(db);
    const sample = created.find((p) => p.name === 'Pop Arrangement')!;

    expect(sample.score.tracks).toHaveLength(4);
    for (const track of sample.score.tracks) {
      expect(track.measures).toHaveLength(16);
    }
    const drumTrack = sample.score.tracks.find((t) => t.clef === 'percussion');
    expect(drumTrack).toBeDefined();
  });

  it('"Orchestral Passage" has 2 strings tracks + bass over 12 measures in D minor', async () => {
    const created = await installSampleProjects(db);
    const sample = created.find((p) => p.name === 'Orchestral Passage')!;

    expect(sample.score.tracks).toHaveLength(3);
    for (const track of sample.score.tracks) {
      expect(track.measures).toHaveLength(12);
      expect(track.measures[0].keySignature).toEqual({ fifths: -1, mode: 'minor' });
    }
    const stringsTracks = sample.score.tracks.filter((t) => t.clef === 'treble');
    const bassTracks = sample.score.tracks.filter((t) => t.clef === 'bass');
    expect(stringsTracks).toHaveLength(2);
    expect(bassTracks).toHaveLength(1);
  });

  it('produces byte-for-byte identical scores across separate installs (deterministic seeds)', async () => {
    const firstDb = new ScoreSmithDb('scoresmith-test-samples-determinism-1');
    const secondDb = new ScoreSmithDb('scoresmith-test-samples-determinism-2');
    try {
      const first = await installSampleProjects(firstDb);
      const second = await installSampleProjects(secondDb);

      const firstScores = first
        .map((p) => p.score)
        .sort((a, b) => a.metadata.title.localeCompare(b.metadata.title));
      const secondScores = second
        .map((p) => p.score)
        .sort((a, b) => a.metadata.title.localeCompare(b.metadata.title));
      expect(firstScores).toEqual(secondScores);
    } finally {
      await firstDb.delete();
      await secondDb.delete();
    }
  });
});
