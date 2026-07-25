import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { ScoreSmithDb, projectRecordSchema, type ProjectRecord } from './db';
import { twinkleScore } from '../../test/fixtures';

function makeRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'project-1',
    name: 'Twinkle',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    schemaVersion: 1,
    score: twinkleScore(),
    ...overrides,
  };
}

describe('ScoreSmithDb', () => {
  let db: ScoreSmithDb | undefined;

  afterEach(async () => {
    await db?.delete();
    db = undefined;
  });

  it('opens with a projects table and a settings table', async () => {
    db = new ScoreSmithDb('scoresmith-test-open');
    await db.open();
    expect(db.tables.map((t) => t.name).sort()).toEqual(['projects', 'settings']);
  });

  it('stores and retrieves a project record by id', async () => {
    db = new ScoreSmithDb('scoresmith-test-crud');
    const record = makeRecord();
    await db.projects.put(record);

    const loaded = await db.projects.get(record.id);
    expect(loaded).toEqual(record);
  });

  it('indexes projects by name and updatedAt for sorted queries', async () => {
    db = new ScoreSmithDb('scoresmith-test-index');
    await db.projects.bulkPut([
      makeRecord({ id: 'a', name: 'Bravo', updatedAt: '2024-01-02T00:00:00.000Z' }),
      makeRecord({ id: 'b', name: 'Alpha', updatedAt: '2024-01-03T00:00:00.000Z' }),
    ]);

    const byName = await db.projects.orderBy('name').toArray();
    expect(byName.map((r) => r.id)).toEqual(['b', 'a']);

    const byUpdatedAt = await db.projects.orderBy('updatedAt').toArray();
    expect(byUpdatedAt.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('stores and retrieves settings by key', async () => {
    db = new ScoreSmithDb('scoresmith-test-settings');
    await db.settings.put({ key: 'theme', value: 'dark' });
    await db.settings.put({ key: 'mockSeed', value: 42 });

    expect(await db.settings.get('theme')).toEqual({ key: 'theme', value: 'dark' });
    expect(await db.settings.get('mockSeed')).toEqual({ key: 'mockSeed', value: 42 });
  });

  it('accepts explicit indexedDB/IDBKeyRange options', async () => {
    db = new ScoreSmithDb('scoresmith-test-options', { indexedDB, IDBKeyRange });
    await db.open();
    expect(db.tables.map((t) => t.name).sort()).toEqual(['projects', 'settings']);
  });
});

describe('projectRecordSchema', () => {
  it('accepts a well-formed project record', () => {
    const record = makeRecord();
    expect(() => projectRecordSchema.parse(record)).not.toThrow();
  });

  it('accepts an optional uiPrefs and thumbnail', () => {
    const record = makeRecord({
      uiPrefs: { view: 'piano-roll', zoom: 1.5 },
      thumbnail: { measureCount: 8, trackNames: ['Piano'], durationSeconds: 12.5 },
    });
    expect(projectRecordSchema.parse(record)).toMatchObject({
      uiPrefs: { view: 'piano-roll', zoom: 1.5 },
      thumbnail: { measureCount: 8, trackNames: ['Piano'], durationSeconds: 12.5 },
    });
  });

  it('rejects a record missing schemaVersion', () => {
    const withoutSchemaVersion: Record<string, unknown> = { ...makeRecord() };
    delete withoutSchemaVersion.schemaVersion;
    expect(() => projectRecordSchema.parse(withoutSchemaVersion)).toThrow();
  });

  it('rejects a record with an invalid embedded score', () => {
    const record = makeRecord({ score: { ...twinkleScore(), ppq: -1 } });
    expect(() => projectRecordSchema.parse(record)).toThrow();
  });
});
