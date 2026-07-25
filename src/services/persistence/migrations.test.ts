import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  ProjectMigrationError,
  migrateProjectRecord,
} from './migrations.js';
import { twinkleScore } from '../../test/fixtures.js';

/** A v0 project record: no `schemaVersion`, no `uiPrefs` (both introduced in v1). */
function v0Record(): Record<string, unknown> {
  return {
    id: 'project-1',
    name: 'Twinkle',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    score: twinkleScore(),
  };
}

describe('CURRENT_SCHEMA_VERSION', () => {
  it('is 1', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
  });
});

describe('migrateProjectRecord', () => {
  it('migrates a v0 record (no schemaVersion, no uiPrefs) to the current version', () => {
    const migrated = migrateProjectRecord(v0Record());
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.uiPrefs).toBeUndefined();
    expect(migrated.id).toBe('project-1');
    expect(migrated.score).toEqual(v0Record().score);
  });

  it('passes an already-current record through validated but otherwise unchanged', () => {
    const current = {
      ...v0Record(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      uiPrefs: { view: 'notation' as const, zoom: 1 },
    };
    const migrated = migrateProjectRecord(current);
    expect(migrated).toEqual(current);
  });

  it('throws ProjectMigrationError for non-object input', () => {
    expect(() => migrateProjectRecord(null)).toThrow(ProjectMigrationError);
    expect(() => migrateProjectRecord('not a record')).toThrow(ProjectMigrationError);
    expect(() => migrateProjectRecord(undefined)).toThrow(ProjectMigrationError);
  });

  it('throws ProjectMigrationError (never silently discards) when migration cannot fix invalid data', () => {
    const broken = { ...v0Record(), score: { not: 'a score' } };
    expect(() => migrateProjectRecord(broken)).toThrow(ProjectMigrationError);
  });

  it('includes validation details on the thrown error', () => {
    const broken = { ...v0Record(), score: null };
    try {
      migrateProjectRecord(broken);
      expect.unreachable('expected migrateProjectRecord to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectMigrationError);
      expect((error as ProjectMigrationError).details).toBeDefined();
    }
  });
});
