/**
 * The shape `music_io`'s `readMod` produces.
 *
 * Declared here structurally rather than imported from music_types so the
 * score-building half does not wait on a publish cycle. The shapes are
 * identical and mutually assignable; when `ModFile` lands beside `MidiFile` in
 * music_types this becomes a re-export.
 */
export type ModSample = { index: number; name: string };
export type ModCell = { sample: number; period: number; effect: number; param: number };
export type ModFile = {
  title: string;
  channels: number;
  samples: ModSample[];
  order: number[];
  /** `patterns[p][row][channel]`. */
  patterns: ModCell[][][];
};
