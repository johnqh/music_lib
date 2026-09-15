import { describe, expect, it } from 'vitest';
import {
  barsForSeconds,
  formatDuration,
  parseDuration,
  secondsForBars,
} from './score-duration.js';

describe('score duration', () => {
  it('reads bars as seconds at the tempo and meter', () => {
    expect(secondsForBars(16, '120')).toBe(32);
    expect(secondsForBars(8, '60')).toBe(32);
    // 6/8 is three quarter notes a bar.
    expect(secondsForBars(4, '60', { numerator: 6, denominator: 8 })).toBe(12);
  });

  it('uses the default tempo when none is given', () => {
    expect(secondsForBars(16, '')).toBe(32);
  });

  it('turns a length back into the nearest whole bars, at least one', () => {
    expect(barsForSeconds(61, '120')).toBe(31);
    expect(barsForSeconds(0.2, '120')).toBe(1);
  });

  it('formats and parses m:ss', () => {
    expect(formatDuration(62)).toBe('1:02');
    expect(parseDuration('45')).toBe(45);
    expect(parseDuration('1:05')).toBe(65);
    for (const text of ['', '0', '1:75', 'abc']) {
      expect(parseDuration(text)).toBeNull();
    }
  });
});
