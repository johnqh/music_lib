import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScoreSmithDb, type ProjectRecord } from './db.js';
import {
  ProjectDataError,
  ProjectNotFoundError,
  createProject,
  deleteProject,
  duplicateProject,
  exportProjectJson,
  importProjectJson,
  listProjects,
  loadProject,
  renameProject,
  saveProject,
} from './projects.js';
import { twinkleScore, twoTrackScore } from '../../test/fixtures.js';

let db: ScoreSmithDb;
let dbCounter = 0;

beforeEach(() => {
  dbCounter += 1;
  db = new ScoreSmithDb(`scoresmith-test-projects-${dbCounter}`);
  // Fake only `Date` (not setTimeout/queueMicrotask/etc.) — fake-indexeddb
  // schedules its request success/error events via real timers/microtasks,
  // so faking those too would hang every awaited Dexie operation.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2024-06-01T00:00:00.000Z'));
});

afterEach(async () => {
  vi.useRealTimers();
  await db.delete();
});

describe('createProject', () => {
  it('persists a new project with a fresh id and matching created/updated timestamps', async () => {
    const record = await createProject(db, { name: 'My Song', score: twinkleScore() });

    expect(record.id).toBeTruthy();
    expect(record.name).toBe('My Song');
    expect(record.schemaVersion).toBe(1);
    expect(record.createdAt).toBe('2024-06-01T00:00:00.000Z');
    expect(record.updatedAt).toBe('2024-06-01T00:00:00.000Z');

    const stored = await db.projects.get(record.id);
    expect(stored).toEqual(record);
  });

  it('persists optional uiPrefs and thumbnail when provided', async () => {
    const record = await createProject(db, {
      name: 'With Prefs',
      score: twinkleScore(),
      uiPrefs: { view: 'piano-roll', zoom: 2 },
      thumbnail: { measureCount: 8, trackNames: ['Piano'], durationSeconds: 16 },
    });

    expect(record.uiPrefs).toEqual({ view: 'piano-roll', zoom: 2 });
    expect(record.thumbnail).toEqual({
      measureCount: 8,
      trackNames: ['Piano'],
      durationSeconds: 16,
    });
  });
});

describe('saveProject', () => {
  it('bumps updatedAt but preserves createdAt', async () => {
    const created = await createProject(db, { name: 'Song', score: twinkleScore() });

    vi.setSystemTime(new Date('2024-06-02T00:00:00.000Z'));
    const saved = await saveProject(db, { ...created, name: 'Song (edited)' });

    expect(saved.createdAt).toBe('2024-06-01T00:00:00.000Z');
    expect(saved.updatedAt).toBe('2024-06-02T00:00:00.000Z');
    expect(saved.name).toBe('Song (edited)');

    const reloaded = await loadProject(db, created.id);
    expect(reloaded.name).toBe('Song (edited)');
  });

  it('rejects a record that fails schema validation', async () => {
    const created = await createProject(db, { name: 'Song', score: twinkleScore() });
    const broken = { ...created, score: { ...created.score, ppq: -1 } } as unknown as ProjectRecord;

    await expect(saveProject(db, broken)).rejects.toBeInstanceOf(ProjectDataError);
  });
});

describe('loadProject', () => {
  it('throws ProjectNotFoundError for a missing id', async () => {
    await expect(loadProject(db, 'does-not-exist')).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('throws ProjectDataError (never silently discards) for corrupt stored data', async () => {
    await db.projects.put({
      id: 'broken',
      name: 'Broken',
      score: { not: 'a score' },
    } as unknown as ProjectRecord);

    await expect(loadProject(db, 'broken')).rejects.toBeInstanceOf(ProjectDataError);
  });

  it('migrates a v0 record (no schemaVersion) on load', async () => {
    const v0 = {
      id: 'legacy',
      name: 'Legacy Project',
      createdAt: '2023-01-01T00:00:00.000Z',
      updatedAt: '2023-01-01T00:00:00.000Z',
      score: twinkleScore(),
    };
    await db.projects.put(v0 as unknown as ProjectRecord);

    const loaded = await loadProject(db, 'legacy');
    expect(loaded.schemaVersion).toBe(1);
  });
});

describe('renameProject', () => {
  it('updates the name and bumps updatedAt', async () => {
    const created = await createProject(db, { name: 'Original', score: twinkleScore() });
    vi.setSystemTime(new Date('2024-06-03T00:00:00.000Z'));

    const renamed = await renameProject(db, created.id, 'Renamed');
    expect(renamed.name).toBe('Renamed');
    expect(renamed.updatedAt).toBe('2024-06-03T00:00:00.000Z');
  });
});

describe('duplicateProject', () => {
  it('creates a new record with a fresh id and default "(Copy)" name', async () => {
    const created = await createProject(db, { name: 'Original', score: twoTrackScore() });
    const copy = await duplicateProject(db, created.id);

    expect(copy.id).not.toBe(created.id);
    expect(copy.name).toBe('Original (Copy)');
    expect(copy.score).toEqual(created.score);

    const all = await listProjects(db);
    expect(all).toHaveLength(2);
  });

  it('accepts an explicit new name', async () => {
    const created = await createProject(db, { name: 'Original', score: twinkleScore() });
    const copy = await duplicateProject(db, created.id, 'Custom Name');
    expect(copy.name).toBe('Custom Name');
  });
});

describe('deleteProject', () => {
  it('removes the project', async () => {
    const created = await createProject(db, { name: 'Doomed', score: twinkleScore() });
    await deleteProject(db, created.id);

    await expect(loadProject(db, created.id)).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('is a no-op for a missing id', async () => {
    await expect(deleteProject(db, 'does-not-exist')).resolves.toBeUndefined();
  });
});

describe('listProjects', () => {
  it('sorts by updatedAt descending by default', async () => {
    const first = await createProject(db, { name: 'A', score: twinkleScore() });
    vi.setSystemTime(new Date('2024-06-05T00:00:00.000Z'));
    const second = await createProject(db, { name: 'B', score: twinkleScore() });

    const list = await listProjects(db);
    expect(list.map((p) => p.id)).toEqual([second.id, first.id]);
  });

  it('sorts by name ascending when requested', async () => {
    await createProject(db, { name: 'Zeta', score: twinkleScore() });
    await createProject(db, { name: 'Alpha', score: twinkleScore() });

    const list = await listProjects(db, { sortBy: 'name' });
    expect(list.map((p) => p.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('honors an explicit direction override', async () => {
    await createProject(db, { name: 'Alpha', score: twinkleScore() });
    await createProject(db, { name: 'Zeta', score: twinkleScore() });

    const list = await listProjects(db, { sortBy: 'name', direction: 'desc' });
    expect(list.map((p) => p.name)).toEqual(['Zeta', 'Alpha']);
  });
});

describe('exportProjectJson / importProjectJson', () => {
  it('round-trips a project through JSON export/import with a fresh id', async () => {
    const created = await createProject(db, { name: 'Exportable', score: twinkleScore() });

    const blob = await exportProjectJson(db, created.id);
    expect(blob.type).toBe('application/json');
    const text = await blob.text();
    const json = JSON.parse(text);
    expect(json.id).toBe(created.id);

    vi.setSystemTime(new Date('2024-06-10T00:00:00.000Z'));
    const imported = await importProjectJson(db, json);

    expect(imported.id).not.toBe(created.id);
    expect(imported.name).toBe('Exportable');
    expect(imported.score).toEqual(created.score);
    expect(imported.createdAt).toBe('2024-06-10T00:00:00.000Z');

    const all = await listProjects(db);
    expect(all).toHaveLength(2);
  });

  it('exportProjectJson throws ProjectNotFoundError for a missing project', async () => {
    await expect(exportProjectJson(db, 'nope')).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('importProjectJson throws ProjectDataError for invalid JSON data', async () => {
    await expect(importProjectJson(db, { not: 'a project' })).rejects.toBeInstanceOf(
      ProjectDataError,
    );
  });

  it('importProjectJson migrates a v0 record while importing', async () => {
    const v0 = {
      id: 'legacy-import',
      name: 'Legacy Import',
      createdAt: '2023-01-01T00:00:00.000Z',
      updatedAt: '2023-01-01T00:00:00.000Z',
      score: twinkleScore(),
    };
    const imported = await importProjectJson(db, v0);
    expect(imported.schemaVersion).toBe(1);
    expect(imported.id).not.toBe('legacy-import');
  });
});
