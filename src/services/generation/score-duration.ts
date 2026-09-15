/**
 * How long a number of bars plays, and back again.
 *
 * The New Project dialogs show a Duration field beside Bars, for somebody
 * fitting music to a video: they know how long the clip is, not how many bars
 * that makes. Bars stay what a request carries; this only converts between the
 * two at the form's tempo and meter. Shared by both apps so the two dialogs
 * cannot disagree about how long sixteen bars is.
 *
 * A blank or unusable tempo is the server's default, which is what the piece
 * will actually play at. The tempo counts quarter notes, so a bar of 6/8 is
 * three of them.
 */
import { DEFAULT_BPM } from '@sudobility/music_types';
import type { TimeSignature } from '@sudobility/music_types';

const COMMON_TIME: TimeSignature = { numerator: 4, denominator: 4 };

function secondsPerBar(
  tempoText: string,
  timeSignature?: TimeSignature
): number {
  const bpm = Number(tempoText) > 0 ? Number(tempoText) : DEFAULT_BPM;
  const ts = timeSignature ?? COMMON_TIME;
  return ((ts.numerator * 4) / ts.denominator) * (60 / bpm);
}

export function secondsForBars(
  bars: number,
  tempoText: string,
  timeSignature?: TimeSignature
): number {
  return bars * secondsPerBar(tempoText, timeSignature);
}

/** Whole bars nearest a length, never fewer than one. */
export function barsForSeconds(
  seconds: number,
  tempoText: string,
  timeSignature?: TimeSignature
): number {
  return Math.max(
    1,
    Math.round(seconds / secondsPerBar(tempoText, timeSignature))
  );
}

/** Seconds as `m:ss`. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** `"45"`, `"0:45"` or `"1:05"` as seconds; null for anything else. */
export function parseDuration(text: string): number | null {
  const match = /^(?:(\d+):)?(\d+)$/.exec(text.trim());
  if (!match) return null;
  const seconds = Number(match[2]);
  if (match[1] !== undefined && seconds >= 60) return null;
  const total = Number(match[1] ?? 0) * 60 + seconds;
  return total > 0 ? total : null;
}
