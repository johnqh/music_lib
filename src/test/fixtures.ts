/**
 * This package's own test fixtures, on top of the shared ones.
 *
 * The score fixtures live in `@sudobility/music_types/test` and are
 * re-exported here so a suite still imports one module. They used to be a
 * byte copy of that file, which is how five packages came to hold five
 * declarations of `C_MAJOR`; only what genuinely needs something this
 * package owns — a `RenderTheme` — is written out below.
 */
export * from '@sudobility/music_types/test';

import type { RenderTheme } from '@sudobility/music_drawing';

/**
 * A `RenderTheme` for tests: every role gets a distinct, obviously-fake
 * value so an assertion that the wrong role was used fails loudly instead of
 * matching a lookalike hex. Shared here (rather than redeclared per suite)
 * so adding a role to `RenderTheme` breaks in one place, and so consuming
 * apps' jsdom suites can import the same object.
 */
export function testRenderTheme(): RenderTheme {
  return {
    foreground: '#111111',
    noteNormal: '#222222',
    noteInactive: '#888888',
    noteSelected: '#333333',
    noteRegenerated: '#444444',
    notePlaying: '#555555',
    staveActive: '#666666',
    staveInactive: '#777777',
    caret: '#888888',
  };
}
