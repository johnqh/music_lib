/**
 * The shape `music_io`'s `TrackerCodec.decode` produces.
 *
 * Re-exported rather than redeclared: the model lives in music_types beside
 * `MidiFile`, so both halves of the import path see the same type.
 */
export type {
  TrackerCell,
  TrackerFormat,
  TrackerInstrument,
  TrackerModule,
} from '@sudobility/music_types';
