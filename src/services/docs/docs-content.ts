/**
 * What the documentation covers, and in what order.
 *
 * Structure only: every string here is an i18n key, so the prose lives in
 * each locale's `app.json` and a Chinese reader gets Chinese documentation.
 * That is not a preference — `locale-parity.test.ts` enforces it, after 42
 * strings once shipped untranslated because a missing key silently falls back
 * to English and looks like a working app.
 *
 * A topic's `body` is a list of paragraph keys rather than one long string so
 * the page can lay them out, and so a translator works a paragraph at a time.
 * Three topics render generated content as well — the shortcut table, the
 * instrument catalogue and the format lists are read from the code rather than
 * described in prose, because prose about a table is a copy of that table.
 */

/*
  Here rather than in an app because two of them render this documentation, and
  the structure is what says which topics exist and in what order. The prose
  stays in each host's locale files — the library holds no strings in any
  language — so this is keys and shape only. The topic ids, the groups and the
  shapes are vocabulary, in music_types; this is the table built from them.
*/
import type {
  DocsGroup,
  DocsTopic,
  DocsTopicId,
  DocsWidget,
} from '@sudobility/music_types';

const k = (topic: DocsTopicId, rest: string) => `docs.${topic}.${rest}`;

function topic(
  id: DocsTopicId,
  headings: readonly (readonly [string, number])[],
  widget?: DocsWidget
): DocsTopic {
  return {
    id,
    title: k(id, 'title'),
    summary: k(id, 'summary'),
    sections: headings.map(([name, paragraphs]) => ({
      heading: k(id, `${name}.heading`),
      body: Array.from({ length: paragraphs }, (_, i) =>
        k(id, `${name}.p${i + 1}`)
      ),
    })),
    ...(widget ? { widget } : {}),
  };
}

export const DOCS_TOPICS: readonly (DocsTopic & { group: DocsGroup })[] = [
  {
    group: 'start',
    ...topic('getting-started', [
      ['what', 2],
      ['firstProject', 3],
      ['dashboard', 2],
    ]),
  },
  {
    group: 'start',
    ...topic('navigation', [
      ['routes', 3],
      ['account', 2],
    ]),
  },
  {
    group: 'using',
    ...topic('editor', [
      ['canvas', 3],
      ['caret', 3],
      ['noteInput', 3],
      ['editModes', 2],
      ['voices', 2],
      ['layout', 2],
    ]),
  },
  {
    group: 'using',
    ...topic('notation', [
      ['ties', 2],
      ['dynamics', 3],
      ['articulation', 2],
      ['ornaments', 2],
      ['grace', 2],
      ['tuplets', 2],
      ['beams', 2],
      ['lyrics', 3],
      ['chords', 2],
      ['spans', 3],
    ]),
  },
  {
    group: 'using',
    ...topic('structure', [
      ['bars', 3],
      ['signatures', 3],
      ['pickup', 2],
      ['barlines', 2],
      ['repeats', 3],
      ['navigation', 3],
      ['tempo', 2],
      ['clefs', 2],
    ]),
  },
  {
    group: 'using',
    ...topic('tracks', [
      ['adding', 2],
      ['instrument', 3],
      ['mixing', 3],
      ['visibility', 2],
      ['active', 2],
    ]),
  },
  {
    group: 'using',
    ...topic('playback', [
      ['transport', 3],
      ['keyboard', 3],
      ['following', 2],
    ]),
  },
  {
    group: 'using',
    ...topic('midi-input', [
      ['connecting', 3],
      ['playing', 2],
    ]),
  },
  {
    group: 'using',
    ...topic('inspector', [
      ['tabs', 4],
      ['editing', 2],
    ]),
  },
  {
    group: 'using',
    ...topic('generation', [
      ['whole', 3],
      ['track', 2],
      ['replace', 3],
      ['credits', 2],
      ['quality', 3],
    ]),
  },
  {
    group: 'using',
    ...topic('sharing', [
      ['snapshots', 3],
      ['publish', 3],
    ]),
  },
  {
    group: 'using',
    ...topic('settings', [
      ['appearance', 2],
      ['pitch', 3],
      ['developer', 2],
    ]),
  },
  { group: 'reference', ...topic('shortcuts', [['intro', 2]], 'shortcuts') },
  {
    group: 'reference',
    ...topic(
      'instruments',
      [
        ['catalogue', 3],
        ['compass', 3],
        ['percussion', 3],
      ],
      'instruments'
    ),
  },
  {
    group: 'reference',
    ...topic(
      'formats',
      [
        ['importing', 3],
        ['exporting', 3],
        ['fidelity', 2],
      ],
      'formats'
    ),
  },
  {
    group: 'reference',
    ...topic('limits', [
      ['byDesign', 3],
      ['known', 3],
    ]),
  },
];

export function docsTopic(
  id: string
): (DocsTopic & { group: DocsGroup }) | null {
  return DOCS_TOPICS.find(t => t.id === id) ?? null;
}

/** The i18n key a docs group's heading is written under. */
export function docsGroupLabelKey(group: DocsGroup): string {
  return `docs.group.${group}`;
}
