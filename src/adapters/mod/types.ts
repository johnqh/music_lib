/**
 * The shape `music_io`'s `ModCodec.decode` produces.
 *
 * Was declared structurally here so the score-building half did not wait on a
 * publish cycle; now that `ModFile` lives beside `MidiFile` in music_types,
 * this is the re-export it was always going to become.
 */
export type { ModCell, ModFile, ModSample } from '@sudobility/music_types';
