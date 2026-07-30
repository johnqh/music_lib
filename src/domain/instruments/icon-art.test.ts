import { describe, expect, it } from 'vitest';
import { parseIconPath } from './icon-art.js';

describe('parseIconPath', () => {
  it('parses each supported command', () => {
    expect(parseIconPath('M1 2 L3 4 C5 6 7 8 9 10 Q11 12 13 14 Z')).toEqual([
      { kind: 'move', x: 1, y: 2 },
      { kind: 'line', x: 3, y: 4 },
      { kind: 'cubic', x1: 5, y1: 6, x2: 7, y2: 8, x: 9, y: 10 },
      { kind: 'quad', x1: 11, y1: 12, x: 13, y: 14 },
      { kind: 'close' },
    ]);
  });

  it('reads decimals and negatives, comma- or space-separated', () => {
    expect(parseIconPath('M-1.5,2 L.5 -3')).toEqual([
      { kind: 'move', x: -1.5, y: 2 },
      { kind: 'line', x: 0.5, y: -3 },
    ]);
  });

  it('repeats a command implicitly when operands continue without a new letter', () => {
    expect(parseIconPath('L1 2 3 4')).toEqual([
      { kind: 'line', x: 1, y: 2 },
      { kind: 'line', x: 3, y: 4 },
    ]);
  });

  it('treats pairs after a moveto as linetos, as SVG does', () => {
    expect(parseIconPath('M1 2 3 4')).toEqual([
      { kind: 'move', x: 1, y: 2 },
      { kind: 'line', x: 3, y: 4 },
    ]);
  });

  it('accepts a command after a close rather than looping on the Z', () => {
    expect(parseIconPath('M1 2 Z M3 4 Z')).toEqual([
      { kind: 'move', x: 1, y: 2 },
      { kind: 'close' },
      { kind: 'move', x: 3, y: 4 },
      { kind: 'close' },
    ]);
  });

  it('rejects an unsupported command rather than skipping it', () => {
    // Arcs and relative commands are outside the subset on purpose; a silent
    // skip would draw a subtly wrong icon instead of failing the suite.
    expect(() => parseIconPath('M1 2 A3 4 0 0 1 5 6')).toThrow(/Unsupported/);
    expect(() => parseIconPath('M1 2 l3 4')).toThrow(/Unsupported/);
  });

  it('rejects operands that do not start with a command', () => {
    expect(() => parseIconPath('1 2 3 4')).toThrow(/must start with a command/);
  });

  it('rejects a truncated operand list', () => {
    expect(() => parseIconPath('M1 2 C3 4 5')).toThrow(/wants 6 numbers/);
  });
});
