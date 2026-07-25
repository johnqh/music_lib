/**
 * Project CRUD + import/export (spec §18): create/rename/duplicate/delete/
 * open project; manual save; recent projects; export project as JSON;
 * import project JSON. Every read that returns a `ProjectRecord` goes
 * through `migrateProjectRecord` (`migrations.ts`), so callers never see
 * unmigrated or unvalidated data — invalid data is always surfaced as a
 * thrown `ProjectDataError`, never silently discarded.
 *
 * Every function takes the `ScoreSmithDb` instance explicitly (no module-
 * level singleton), matching the DI pattern used elsewhere in the app: the
 * caller decides which db (real, or an in-memory `fake-indexeddb` one in
 * tests) to operate on.
 */
import { createId } from '../../domain/score/ids';
import type { Score } from '@sudobility/music_types';
import {
  projectRecordSchema,
  type ProjectRecord,
  type ProjectThumbnail,
  type ScoreSmithDb,
  type UiPrefs,
} from './db';
import {
  CURRENT_SCHEMA_VERSION,
  ProjectMigrationError,
  migrateProjectRecord,
} from './migrations';

/** Thrown by `loadProject`/`importProjectJson` when the stored/imported data fails schema validation (post-migration). Carries the underlying Zod issues in `details`. Never thrown in place of silently discarding data. */
export class ProjectDataError extends Error {
  readonly details: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'ProjectDataError';
    this.details = details;
  }
}

/** Thrown by `loadProject` (and anything built on it) when no project with the given id exists. */
export class ProjectNotFoundError extends Error {
  readonly id: string;

  constructor(id: string) {
    super(`Project "${id}" was not found.`);
    this.name = 'ProjectNotFoundError';
    this.id = id;
  }
}

/** Re-throws a `ProjectMigrationError` as a `ProjectDataError` with a caller-appropriate message; rethrows anything else unchanged. */
function toProjectDataError(error: unknown, contextMessage: string): never {
  if (error instanceof ProjectMigrationError) {
    throw new ProjectDataError(`${contextMessage}: ${error.message}`, error.details);
  }
  throw error;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Validates `record` with `projectRecordSchema` before it's persisted, so corrupt data is rejected at write time (not just at the next read). */
function validateForWrite(record: ProjectRecord): ProjectRecord {
  const parsed = projectRecordSchema.safeParse(record);
  if (!parsed.success) {
    throw new ProjectDataError('Project record failed validation.', parsed.error.issues);
  }
  return parsed.data as ProjectRecord;
}

export type CreateProjectInput = {
  name: string;
  score: Score;
  uiPrefs?: UiPrefs;
  thumbnail?: ProjectThumbnail;
};

/** Creates and persists a brand-new project with a fresh id, `schemaVersion: CURRENT_SCHEMA_VERSION`, and `createdAt === updatedAt` (both "now"). */
export async function createProject(
  db: ScoreSmithDb,
  input: CreateProjectInput,
): Promise<ProjectRecord> {
  const timestamp = nowIso();
  const record: ProjectRecord = {
    id: createId(),
    name: input.name,
    createdAt: timestamp,
    updatedAt: timestamp,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    score: input.score,
    ...(input.uiPrefs ? { uiPrefs: input.uiPrefs } : {}),
    ...(input.thumbnail ? { thumbnail: input.thumbnail } : {}),
  };
  const validated = validateForWrite(record);
  await db.projects.add(validated);
  return validated;
}

/** Persists `record`, bumping `updatedAt` to now (the caller's `updatedAt`, if any, is ignored/overwritten). Upserts: creates the row if it doesn't already exist. */
export async function saveProject(db: ScoreSmithDb, record: ProjectRecord): Promise<ProjectRecord> {
  const updated = validateForWrite({ ...record, updatedAt: nowIso() });
  await db.projects.put(updated);
  return updated;
}

/** Loads a project by id: migrates it to the current schema version and validates it. Throws `ProjectNotFoundError` if no row has that id, or `ProjectDataError` (never silently discarding) if the stored data can't be migrated/validated. */
export async function loadProject(db: ScoreSmithDb, id: string): Promise<ProjectRecord> {
  const raw = await db.projects.get(id);
  if (raw === undefined) {
    throw new ProjectNotFoundError(id);
  }
  try {
    return migrateProjectRecord(raw);
  } catch (error) {
    return toProjectDataError(error, `Project "${id}" has invalid data`);
  }
}

/** Renames a project, bumping `updatedAt`. */
export async function renameProject(
  db: ScoreSmithDb,
  id: string,
  name: string,
): Promise<ProjectRecord> {
  const record = await loadProject(db, id);
  return saveProject(db, { ...record, name });
}

/** Copies a project under a fresh id (default name `"<original> (Copy)"`), with fresh `createdAt`/`updatedAt`. The embedded score (including its internal ids) is deep-cloned as-is. */
export async function duplicateProject(
  db: ScoreSmithDb,
  id: string,
  newName?: string,
): Promise<ProjectRecord> {
  const original = await loadProject(db, id);
  const timestamp = nowIso();
  const duplicate = validateForWrite({
    ...structuredClone(original),
    id: createId(),
    name: newName ?? `${original.name} (Copy)`,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.projects.add(duplicate);
  return duplicate;
}

/** Deletes a project by id. A no-op (not an error) if no project with that id exists. */
export async function deleteProject(db: ScoreSmithDb, id: string): Promise<void> {
  await db.projects.delete(id);
}

export type ListProjectsOptions = {
  sortBy?: 'name' | 'updatedAt';
  direction?: 'asc' | 'desc';
};

/** Lists every project, sorted by name or last-modified (spec §19: "search; sort by name or last modified"). Defaults to most-recently-updated first. */
export async function listProjects(
  db: ScoreSmithDb,
  options: ListProjectsOptions = {},
): Promise<ProjectRecord[]> {
  const sortBy = options.sortBy ?? 'updatedAt';
  const direction = options.direction ?? (sortBy === 'updatedAt' ? 'desc' : 'asc');
  const ordered = db.projects.orderBy(sortBy);
  return direction === 'desc' ? ordered.reverse().toArray() : ordered.toArray();
}

/** Exports a project as a downloadable JSON `Blob` (spec §18/§19: "export project as JSON"). */
export async function exportProjectJson(db: ScoreSmithDb, id: string): Promise<Blob> {
  const record = await loadProject(db, id);
  return new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
}

/** Imports a project from parsed JSON (spec §18/§19: "import project JSON"): validates/migrates it, assigns a fresh id and fresh `createdAt`/`updatedAt` (so importing never collides with — or inherits the age of — an existing project), and persists it. Throws `ProjectDataError` for data that fails validation. */
export async function importProjectJson(db: ScoreSmithDb, json: unknown): Promise<ProjectRecord> {
  let migrated: ProjectRecord;
  try {
    migrated = migrateProjectRecord(json);
  } catch (error) {
    return toProjectDataError(error, 'Imported project data is invalid');
  }

  const timestamp = nowIso();
  const imported = validateForWrite({
    ...migrated,
    id: createId(),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.projects.add(imported);
  return imported;
}
