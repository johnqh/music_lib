import { describe, expect, it } from 'vitest';
import { createMusicIo } from '@sudobility/music_io/mocks';
import { analyzeMidi } from './analyze.js';
import { importMidi } from './import.js';
import { defaultMidiImportOptions } from './import-options.js';
import { TempoMap } from '../../domain/time/tempo-map.js';
import { appendFileSync } from 'node:fs';

/** Minimal Standard MIDI File writer, so the file's division (ppq) can be chosen. */
function smf(ppq: number, bpm: number, quarterNotes: number): ArrayBuffer {
  const bytes: number[] = [];
  const push = (...b: number[]) => bytes.push(...b);
  const u32 = (n: number) =>
    push((n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
  const u16 = (n: number) => push((n >> 8) & 255, n & 255);
  push(0x4d, 0x54, 0x68, 0x64);
  u32(6);
  u16(0);
  u16(1);
  u16(ppq); // MThd, format 0, 1 track

  const track: number[] = [];
  const tp = (...b: number[]) => track.push(...b);
  const tvlq = (n: number) => {
    const out = [n & 0x7f];
    n >>= 7;
    while (n > 0) {
      out.unshift((n & 0x7f) | 0x80);
      n >>= 7;
    }
    tp(...out);
  };
  const uspq = Math.round(60_000_000 / bpm);
  tvlq(0);
  tp(0xff, 0x51, 0x03, (uspq >> 16) & 255, (uspq >> 8) & 255, uspq & 255); // tempo
  for (let i = 0; i < quarterNotes; i++) {
    tvlq(0);
    tp(0x90, 60, 100); // note on
    tvlq(ppq);
    tp(0x80, 60, 0); // note off one quarter later
  }
  tvlq(0);
  tp(0xff, 0x2f, 0x00); // end of track

  push(0x4d, 0x54, 0x72, 0x6b);
  u32(track.length);
  push(...track);
  return new Uint8Array(bytes).buffer;
}

async function onsets(ppq: number, bpm: number, n: number): Promise<number[]> {
  const codec = createMusicIo().midiCodec;
  const bytes = smf(ppq, bpm, n);
  const summary = analyzeMidi(bytes, codec);
  const { score } = importMidi(bytes, defaultMidiImportOptions(summary), codec);
  const map = new TempoMap(score.tempoMap, score.ppq);
  return score.tracks[0].measures
    .flatMap(m => m.voices.flatMap(v => v.events))
    .filter(e => 'pitch' in e)
    .map(e => map.ticksToSeconds((e as { startTick: number }).startTick));
}

describe('midi import speed across resolutions and tempos', () => {
  it('places notes at the right wall-clock time whatever the file ppq and tempo', async () => {
    const rows: string[] = [];
    let worst = 0;
    for (const ppq of [96, 192, 384, 480, 960]) {
      for (const bpm of [60, 90, 120, 144, 180]) {
        const got = await onsets(ppq, bpm, 8);
        const expected = Array.from({ length: 8 }, (_, i) => (i * 60) / bpm);
        const drift = got.map((s, i) => Math.abs(s - (expected[i] ?? 0)));
        const max = Math.max(...drift);
        worst = Math.max(worst, max);
        rows.push(
          `  ppq ${String(ppq).padStart(3)} @ ${String(bpm).padStart(3)}bpm: ${got.length}/8 notes, worst drift ${(max * 1000).toFixed(1)}ms, last note ${got.at(-1)?.toFixed(3)}s (expect ${expected.at(-1)?.toFixed(3)}s)`
        );
      }
    }
    appendFileSync(
      '/tmp/speed.txt',
      rows.join('\n') + `\n\nWORST OVERALL: ${(worst * 1000).toFixed(1)}ms\n`
    );
    expect(worst).toBeLessThan(0.005);
  });
});
