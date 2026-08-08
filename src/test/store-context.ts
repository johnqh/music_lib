/**
 * Test doubles for the store's backend context: an in-memory MusicClient
 * fake (project CRUD over a Map) and a deterministic generation provider
 * (fixture scores / velocity-shifted candidates — mirroring music_api's
 * AI_TEST_MODE FixtureTransport). `testStoreContext()` assembles a
 * StoreContext most store tests can use as-is.
 */
import type { MusicClient } from '@sudobility/music_client';
import {
  isNoteEvent,
  type GenerateScoreRequest,
  type GenerateScoreResult,
  type MusicGenerationProvider,
  type ProjectCreateRequest,
  type ProjectListQuery,
  type ProjectRecord,
  type GenerationJob,
  type ProjectSummary,
  type ProjectUpdateRequest,
  type RegenerateRegionRequest,
  type RegenerateRegionResult,
  type Score,
} from '@sudobility/music_types';
import { createEmptyScore } from '../domain/score/factory.js';
import type { PrefsStorage, StoreContext } from '../store/context.js';

export class FakeMusicClient {
  private readonly records = new Map<string, ProjectRecord>();
  private readonly jobs = new Map<string, GenerationJob>();
  private jobCounter = 0;
  private nextId = 0;
  /** Set to make the next N calls reject (network-failure simulation). */
  failNextSaves = 0;
  updateCalls = 0;

  async listProjects(_token: string, query?: ProjectListQuery): Promise<ProjectSummary[]> {
    let list = [...this.records.values()].map(({ score: _s, uiPrefs: _u, ...summary }) => summary);
    if (query?.search) {
      const needle = query.search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(needle));
    }
    list.sort((a, b) =>
      query?.sort === 'name' ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt)
    );
    return list;
  }

  async getProject(id: string, _token: string): Promise<ProjectRecord> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Project not found: ${id}`);
    return structuredClone(record);
  }

  async createProject(req: ProjectCreateRequest, _token: string): Promise<ProjectRecord> {
    this.nextId += 1;
    const now = new Date(2026, 0, 1, 0, 0, this.nextId).toISOString();
    const record: ProjectRecord = {
      id: `proj-${this.nextId}`,
      name: req.name,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
      // A freshly created project is editable; only a generation job moves it.
      status: 'ready',
      lastGenerationError: null,
      score: structuredClone(req.score),
      ...(req.uiPrefs ? { uiPrefs: req.uiPrefs } : {}),
    };
    this.records.set(record.id, record);
    return structuredClone(record);
  }

  async updateProject(id: string, req: ProjectUpdateRequest, _token: string): Promise<ProjectRecord> {
    this.updateCalls += 1;
    if (this.failNextSaves > 0) {
      this.failNextSaves -= 1;
      throw new Error('Simulated save failure');
    }
    const existing = this.records.get(id);
    if (!existing) throw new Error(`Project not found: ${id}`);
    const updated: ProjectRecord = {
      ...existing,
      ...(req.name !== undefined ? { name: req.name } : {}),
      ...(req.score !== undefined ? { score: structuredClone(req.score) } : {}),
      ...(req.uiPrefs !== undefined ? { uiPrefs: req.uiPrefs } : {}),
      updatedAt: new Date(2026, 0, 2, 0, 0, (this.nextId += 1)).toISOString(),
    };
    this.records.set(id, updated);
    return structuredClone(updated);
  }

  async deleteProject(id: string, _token: string): Promise<void> {
    if (!this.records.delete(id)) throw new Error(`Project not found: ${id}`);
  }

  async generateScore(): Promise<GenerateScoreResult> {
    throw new Error('FakeMusicClient.generateScore not stubbed - use the provider override');
  }

  async regenerateRegion(): Promise<RegenerateRegionResult> {
    throw new Error('FakeMusicClient.regenerateRegion not stubbed - use the provider override');
  }

  async health(): Promise<boolean> {
    return true;
  }

  // -- Generation jobs -------------------------------------------------------

  async createJob(
    req: { projectId: string; kind: string; request: unknown },
    _token: string
  ): Promise<GenerationJob> {
    const record = this.records.get(req.projectId);
    if (!record) throw new Error(`Project not found: ${req.projectId}`);
    this.records.set(req.projectId, { ...record, status: 'generating' });
    this.jobCounter += 1;
    const job: GenerationJob = {
      id: `job-${this.jobCounter}`,
      projectId: req.projectId,
      kind: req.kind as GenerationJob['kind'],
      status: 'running',
      createdAt: new Date(2026, 0, 1).toISOString(),
      finishedAt: null,
      error: null,
    };
    this.jobs.set(job.id, job);
    return structuredClone(job);
  }

  async getJob(id: string, _token: string): Promise<GenerationJob> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job not found: ${id}`);
    return structuredClone(job);
  }

  async cancelJob(id: string, _token: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job not found: ${id}`);
    this.jobs.set(id, { ...job, status: 'cancelled' });
    await this.cancelProjectGeneration(job.projectId, _token);
  }

  async getProjectStatus(
    id: string,
    _token: string
  ): Promise<{ status: ProjectRecord['status']; updatedAt: string }> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Project not found: ${id}`);
    return { status: record.status, updatedAt: record.updatedAt };
  }

  async cancelProjectGeneration(projectId: string, _token: string): Promise<void> {
    const record = this.records.get(projectId);
    if (!record) throw new Error(`Project not found: ${projectId}`);
    this.records.set(projectId, { ...record, status: 'ready' });
  }

  /** Test-inspection helper. */
  storedRecord(id: string): ProjectRecord | undefined {
    return this.records.get(id);
  }

  /** Test helper: put a project into `generating` without going through a job. */
  setProjectStatus(id: string, status: ProjectRecord['status']): void {
    const record = this.records.get(id);
    if (record) this.records.set(id, { ...record, status });
  }
}

/** Deterministic generation provider mirroring music_api's fixture transport. */
export class FakeGenerationProvider implements MusicGenerationProvider {
  readonly id = 'fake-provider';
  readonly name = 'Fake Provider';
  calls: Array<{ kind: 'generate' | 'regenerate'; request: unknown }> = [];

  async generateScore(request: GenerateScoreRequest, signal?: AbortSignal): Promise<GenerateScoreResult> {
    this.calls.push({ kind: 'generate', request });
    await Promise.resolve();
    signal?.throwIfAborted();
    const score: Score = createEmptyScore({
      title: request.title ?? 'Generated Piece',
      measures: request.durationMeasures,
      tempo: request.tempo,
      timeSignature: request.timeSignature,
      keySignature: request.keySignature,
      tracks: request.tracks.map((t) => ({
        name: t.name,
        instrumentName: t.instrumentName,
        midiProgram: t.midiProgram,
        clef: t.clef,
      })),
    });
    return { score: withArpeggios(score), warnings: [] };
  }

  async regenerateRegion(
    request: RegenerateRegionRequest,
    signal?: AbortSignal
  ): Promise<RegenerateRegionResult> {
    this.calls.push({ kind: 'regenerate', request });
    await Promise.resolve();
    signal?.throwIfAborted();
    // Fresh ids throughout (deterministic counters), mirroring real AI
    // output — candidate fragments never reuse the source region's ids, so
    // acceptCandidate's selection-remap path is genuinely exercised.
    const candidates = Array.from({ length: request.candidateCount }, (_, i) => ({
      id: `fake-cand-${i + 1}`,
      label: `Candidate ${i + 1}`,
      fragment: {
        ...request.selectedFragment,
        tracks: request.selectedFragment.tracks.map((t, ti) => ({
          ...t,
          measures: t.measures.map((m, mi) => {
            const measureId = `fk-c${i}-t${ti}-m${mi}`;
            return {
              ...m,
              id: measureId,
              voices: m.voices.map((v, vi) => {
                const voiceId = `${measureId}-v${vi}`;
                return {
                  ...v,
                  id: voiceId,
                  events: v.events.map((e, ei) =>
                    isNoteEvent(e)
                      ? {
                          ...e,
                          id: `${voiceId}-e${ei}`,
                          voiceId,
                          velocity: Math.max(1, Math.min(127, e.velocity - 10 + i * 10)),
                        }
                      : { ...e, id: `${voiceId}-e${ei}`, voiceId }
                  ),
                };
              }),
            };
          }),
        })),
      },
    }));
    return { candidates, warnings: [] };
  }
}

/**
 * Replaces each measure's whole-rest with a deterministic quarter-note
 * arpeggio when the measure is exactly four quarters long, so generated
 * fixture scores contain pitched events (integration tests edit notes).
 */
function withArpeggios(score: Score): Score {
  const STEPS: Array<{ step: 'C' | 'E' | 'G'; octave: number }> = [
    { step: 'C', octave: 4 },
    { step: 'E', octave: 4 },
    { step: 'G', octave: 4 },
    { step: 'C', octave: 5 },
  ];
  const quarter = score.ppq;
  let n = 0;
  return {
    ...score,
    tracks: score.tracks.map((track) => ({
      ...track,
      measures: track.measures.map((measure) => {
        if (measure.durationTicks !== 4 * quarter || measure.voices.length !== 1) return measure;
        const voice = measure.voices[0];
        return {
          ...measure,
          voices: [
            {
              ...voice,
              events: STEPS.map((p, i) => ({
                id: `fk-note-${(n += 1)}`,
                pitch: { step: p.step, accidental: 0 as const, octave: p.octave },
                startTick: measure.startTick + i * quarter,
                durationTicks: quarter,
                velocity: 80,
                voiceId: voice.id,
                trackId: track.id,
              })),
            },
          ],
        };
      }),
    })),
  };
}

export class MemoryPrefsStorage implements PrefsStorage {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

export type TestStoreContext = StoreContext & {
  fakeClient: FakeMusicClient;
  fakeProvider: FakeGenerationProvider;
};

export function testStoreContext(overrides: Partial<StoreContext> = {}): TestStoreContext {
  const fakeClient = new FakeMusicClient();
  const fakeProvider = new FakeGenerationProvider();
  return {
    client: fakeClient as unknown as MusicClient,
    getToken: async () => 'test-token',
    storage: new MemoryPrefsStorage(),
    provider: fakeProvider,
    ...overrides,
    fakeClient,
    fakeProvider,
  };
}
