/**
 * This package's own test fixtures, on top of the shared ones.
 *
 * The score fixtures live in `@sudobility/music_types/test` and are
 * re-exported here so a suite still imports one module. They used to be a
 * byte copy of that file, which is how five packages came to hold five
 * declarations of `C_MAJOR`.
 */
export * from '@sudobility/music_types/test';
