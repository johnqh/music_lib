/**
 * Versioned migration pipeline for `ProjectRecord`s (spec §18: "Versioned
 * project schema with migrations"). `migrateProjectRecord` takes raw,
 * untrusted data (whatever shape happens to be sitting in IndexedDB, or an
 * imported JSON file written by an older build) and walks it forward one
 * schema version at a time until it reaches `CURRENT_SCHEMA_VERSION`, then
 * validates the result against `projectRecordSchema`.
 *
 * `schemaVersion` bumps whenever `ProjectRecord`'s shape changes in a way
 * that needs a data transform (not just an optional-field addition that
 * defaults cleanly). Version 0 is implicit: any record predating the
 * `schemaVersion` field itself (and therefore also predating `uiPrefs`,
 * introduced in the same release) is treated as v0.
 */
import { projectRecordSchema, type ProjectRecord } from './db.js';

export const CURRENT_SCHEMA_VERSION = 1;

/** Thrown when `migrateProjectRecord` cannot bring raw data forward to `CURRENT_SCHEMA_VERSION` — either because no migration step exists for its version, or because it fails `projectRecordSchema` validation once migrated. Never silently discards invalid data. */
export class ProjectMigrationError extends Error {
  readonly details: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'ProjectMigrationError';
    this.details = details;
  }
}

type RawRecord = Record<string, unknown>;

/** One step per source version: transforms a record at version `N` into the shape expected at version `N + 1`. */
const MIGRATIONS: Record<number, (record: RawRecord) => RawRecord> = {
  // v0 -> v1: `schemaVersion` (and the optional `uiPrefs`) didn't exist yet.
  // `uiPrefs` is optional in the schema, so no default is needed for it;
  // only `schemaVersion` itself needs to be stamped on.
  0: (record) => ({ ...record, schemaVersion: 1 }),
};

function detectVersion(record: RawRecord): number {
  return typeof record.schemaVersion === 'number' ? record.schemaVersion : 0;
}

/**
 * Migrates `raw` forward to `CURRENT_SCHEMA_VERSION` and validates it.
 * Throws `ProjectMigrationError` (never silently discards data) if `raw`
 * isn't an object, if a migration step is missing for some intermediate
 * version, or if the fully-migrated record still fails
 * `projectRecordSchema`.
 */
export function migrateProjectRecord(raw: unknown): ProjectRecord {
  if (typeof raw !== 'object' || raw === null) {
    throw new ProjectMigrationError('Project record is not an object.', raw);
  }

  let record: RawRecord = { ...(raw as RawRecord) };
  let version = detectVersion(record);

  while (version < CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      throw new ProjectMigrationError(
        `No migration is defined from schema version ${version}.`,
        record,
      );
    }
    record = step(record);
    const nextVersion = detectVersion(record);
    if (nextVersion <= version) {
      throw new ProjectMigrationError(
        `Migration from schema version ${version} did not advance the schema version.`,
        record,
      );
    }
    version = nextVersion;
  }

  const parsed = projectRecordSchema.safeParse(record);
  if (!parsed.success) {
    throw new ProjectMigrationError(
      'Project record failed validation after migration.',
      parsed.error.issues,
    );
  }
  return parsed.data as ProjectRecord;
}
