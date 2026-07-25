/**
 * Project templates — deterministic starter scores surfaced as "New from
 * template" (replacing the deleted Dexie sample-project installer; the
 * server owns projects now, so samples became client-side templates).
 * Names preserved from the original samples.
 */
import type { Score } from '@sudobility/music_types';
import { chordScore, twinkleScore, twoTrackScore } from '../test/fixtures.js';

export type ProjectTemplate = {
  id: string;
  name: string;
  description: string;
  build: () => Score;
};

export const projectTemplates: ProjectTemplate[] = [
  {
    id: 'gentle-piano-melody',
    name: 'Gentle Piano Melody',
    description: 'An 8-measure C-major piano melody to start from.',
    build: () => withTitle(twinkleScore(), 'Gentle Piano Melody'),
  },
  {
    id: 'pop-arrangement',
    name: 'Pop Arrangement',
    description: 'A two-track treble/bass arrangement skeleton.',
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
