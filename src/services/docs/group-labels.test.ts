import { describe, expect, it } from 'vitest';
import { DOCS_GROUPS } from '@sudobility/music_types';
import { docsGroupLabelKey } from './docs-content';

describe('docs group label keys', () => {
  it('names every docs group under docs.group', () => {
    expect(DOCS_GROUPS.map(docsGroupLabelKey)).toEqual([
      'docs.group.start',
      'docs.group.using',
      'docs.group.reference',
    ]);
  });
});
