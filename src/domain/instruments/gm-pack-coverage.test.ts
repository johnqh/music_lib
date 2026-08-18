/**
 * Every GM program resolves to a sample pack that actually exists.
 *
 * This check spans two packages — the catalogue is music_lib's, the pack
 * manifest and the naming rule are music_io's — so it cannot sit wholly in
 * either. It lives here because the catalogue is the thing that changes: adding
 * or renaming an instrument is what breaks the mapping, and this is where that
 * edit happens.
 *
 * It matters because the failure is silent: a name that misses resolves to a
 * 404, which parses to no samples, which is an instrument that plays nothing.
 *
 * music_io must not depend on music_lib (a contract test there enforces it), so
 * the dependency runs this way round — the same direction as the mock platform
 * these tests already use.
 */
import { describe, expect, it } from 'vitest';
import { gmPackName, PACK_NAMES } from '@sudobility/music_io/rn/gm-pack-name';
import { GM_INSTRUMENTS } from './gm.js';

describe('GM pack coverage', () => {
  const available = new Set<string>(PACK_NAMES);

  it('names a pack that exists for every one of the 128 GM programs', () => {
    const missing = GM_INSTRUMENTS.filter((i) => !available.has(gmPackName(i.program, i.name))).map(
      (i) => `${i.program} "${i.name}" -> ${gmPackName(i.program, i.name)}`,
    );
    expect(missing).toEqual([]);
  });

  it('covers the whole catalogue, so no program silently has no rule', () => {
    expect(GM_INSTRUMENTS).toHaveLength(128);
  });
});
