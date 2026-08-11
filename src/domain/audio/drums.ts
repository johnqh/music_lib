/**
 * Drum transcription from a separated drum stem.
 *
 * The other half of hearing a recording. Basic Pitch reports **pitched** notes
 * and nothing else, so on a real mix it misses the drums entirely — measured on
 * a commercial pop track, percussion was 356 of the 496 events in a 30-second
 * window, which is why a transcription of it sounded nothing like the song.
 *
 * A drum is identified by *where its energy sits*, not by a pitch: a kick is
 * low and short, a snare is a broadband crack, a hi-hat is brief and high. So
 * this splits the signal into three bands, finds where each one suddenly gets
 * louder, and names the drum from the band that jumped. That is cheap, needs no
 * model, and is pure over a sample buffer — testable with synthesised hits and
 * a known answer, the same way `pitch-track` is.
 *
 * It is deliberately a **four-piece**: kick, snare, closed and open hi-hat. Ride
 * against crash, toms against each other and ghost notes all need a trained
 * model to separate, and guessing at them would put wrong drums in the score
 * rather than fewer right ones.
 */
import { GM_PERCUSSION_RANGE } from '../instruments/gm-percussion.js';

/** One drum stroke: which GM percussion note, when, and how hard. */
export type DrumHit = {
  /** A General MIDI percussion note, 35-81 — see `gm-percussion.ts`. */
  midi: number;
  startSec: number;
  /** 0..1, from how far the band's level jumped. */
  velocity: number;
};

/** GM percussion notes this recognises. Named rather than inline for the tests. */
export const DRUM_KICK = 36;
export const DRUM_SNARE = 38;
export const DRUM_HIHAT_CLOSED = 42;
export const DRUM_HIHAT_OPEN = 46;

/** Samples between analysis frames. ~11.6ms at 22050Hz — finer than any drum spacing. */
const HOP = 256;

/**
 * Samples each frame measures, overlapping its neighbours.
 *
 * Four hops rather than one, because a level taken over a single hop is not a
 * level at all down where a kick lives: 256 samples is 0.7 of a cycle at 60Hz,
 * so the measurement rises and falls with the waveform's own phase and one
 * decaying kick reports six separate strikes as it rings out. 1024 samples is
 * nearly three cycles and falls monotonically, which is what a decay is.
 */
const WINDOW = 1024;

/**
 * Band edges, in Hz.
 *
 * A kick's fundamental sits near 50-100Hz and a snare's body near 200Hz, so the
 * split between them is above the kick and below the snare. The hat band starts
 * high enough to miss a snare's body while keeping its own energy, which is
 * almost all above 5kHz.
 */
const KICK_MAX_HZ = 120;
const SNARE_MIN_HZ = 250;
const SNARE_MAX_HZ = 2000;
/**
 * A cymbal's energy runs from around 3kHz up, not from 6kHz — starting the band
 * that high left most of a hi-hat's sound in the snare's band, where it was
 * read as a snare on every stroke.
 */
const HIHAT_MIN_HZ = 4000;

/** Poles per filter. One pole is 6dB/octave, which leaks a kick into the snare band. */
const POLES = 4;

/**
 * How far above the local median a jump has to be to count as a hit.
 *
 * Relative to the neighbourhood rather than absolute, because a recording's
 * level is not knowable in advance and a chorus is louder than a verse.
 */
const THRESHOLD_FACTOR = 2.2;
/** Below this a "jump" is noise in a near-silent passage. */
const THRESHOLD_FLOOR = 1e-4;
/** Frames either side that form the neighbourhood the threshold is taken from. */
const MEDIAN_HALF_WIDTH = 12;

/**
 * Closest two hits on one drum can be, in seconds.
 *
 * Sixteenths at 200bpm are 75ms apart, so this has to sit below that; much
 * lower and one stroke's decay retriggers as a second stroke.
 */
const MIN_GAP_SEC = 0.04;

/**
 * How close two bands' strikes have to be to be one drum seen twice.
 *
 * A snare is broadband: struck once it deposits real energy in *every* band,
 * so without masking one backbeat reports a snare, a hi-hat nobody played, and
 * a kick that is really the snare's own 200Hz body. What is kept is the band
 * whose level jumped furthest relative to that band's own loudest jump, which
 * is what makes bands with very different absolute power comparable.
 *
 * The cost is that a genuine snare-and-hat unison — common — comes back as the
 * snare alone, and a kick struck with a snare reports whichever is stronger.
 * Losing the quieter half of a unison beats inventing drums that were never
 * played, and both are fixable later by a trained model.
 */
const COINCIDENT_SEC = 0.025;

/** How long the hat band has to stay up for the hat to be an open one. */
const OPEN_HIHAT_SEC = 0.12;

/**
 * One-pole lowpass, applied `poles` times.
 *
 * Written out rather than pulled from a DSP library because music_lib takes no
 * runtime dependencies, and because a cascade of one-poles is all this needs —
 * the bands are far enough apart that a steeper filter would not change which
 * drum wins.
 */
function lowpass(input: Float32Array, sampleRate: number, cutoffHz: number, poles: number): Float32Array {
  const a = 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  let out = input;
  for (let p = 0; p < poles; p += 1) {
    const next = new Float32Array(out.length);
    let y = 0;
    for (let i = 0; i < out.length; i += 1) {
      y += a * (out[i] - y);
      next[i] = y;
    }
    out = next;
  }
  return out;
}

/**
 * One-pole highpass, applied `poles` times.
 *
 * A real highpass rather than `signal - lowpass(signal)`. Subtracting a
 * *cascade* does not give a highpass: the two paths have different phase, so
 * they fail to cancel where they are both supposed to pass. Measured, a 60Hz
 * kick came through a 250Hz-2kHz band built that way at 0.76 amplitude and was
 * reported as a snare on every stroke. This form is down 50dB at 60Hz instead.
 */
function highpass(input: Float32Array, sampleRate: number, cutoffHz: number, poles: number): Float32Array {
  const a = Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  let out = input;
  for (let p = 0; p < poles; p += 1) {
    const next = new Float32Array(out.length);
    let y = 0;
    let previous = 0;
    for (let i = 0; i < out.length; i += 1) {
      y = a * (y + out[i] - previous);
      previous = out[i];
      next[i] = y;
    }
    out = next;
  }
  return out;
}

/** Root-mean-square per frame — the band's level over time. */
function frameLevels(band: Float32Array): Float32Array {
  const frames = Math.floor(band.length / HOP);
  const levels = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    let count = 0;
    // The window *ends* at this frame rather than starting from it. Looking
    // forward, a strike enters the window a whole window before it happens, so
    // every onset was reported up to 46ms early — audible, and enough to put a
    // hit on the wrong side of a sixteenth.
    const end = f * HOP + HOP;
    const start = Math.max(0, end - WINDOW);
    for (let i = start; i < Math.min(end, band.length); i += 1) {
      sum += band[i] * band[i];
      count += 1;
    }
    levels[f] = count > 0 ? Math.sqrt(sum / count) : 0;
  }
  return levels;
}

/**
 * Frames where the level jumps — a drum being struck.
 *
 * The rise, not the level: a hat ringing on is loud and is not a new stroke.
 */
function detectOnsets(levels: Float32Array, sampleRate: number): Array<{ frame: number; strength: number }> {
  const rise = new Float32Array(levels.length);
  for (let f = 1; f < levels.length; f += 1) rise[f] = Math.max(0, levels[f] - levels[f - 1]);

  const minGapFrames = Math.max(1, Math.round((MIN_GAP_SEC * sampleRate) / HOP));
  const onsets: Array<{ frame: number; strength: number }> = [];
  const window: number[] = [];

  for (let f = 1; f < rise.length - 1; f += 1) {
    // The neighbourhood's median, so a threshold follows the passage's own level.
    window.length = 0;
    for (let i = Math.max(0, f - MEDIAN_HALF_WIDTH); i < Math.min(rise.length, f + MEDIAN_HALF_WIDTH); i += 1) {
      window.push(rise[i]);
    }
    window.sort((a, b) => a - b);
    const threshold = Math.max(THRESHOLD_FLOOR, window[Math.floor(window.length / 2)] * THRESHOLD_FACTOR);

    if (rise[f] < threshold) continue;
    if (rise[f] < rise[f - 1] || rise[f] < rise[f + 1]) continue; // local peak only
    const previous = onsets[onsets.length - 1];
    if (previous && f - previous.frame < minGapFrames) {
      // Keep the stronger of two strokes too close to be separate.
      if (rise[f] > previous.strength) onsets[onsets.length - 1] = { frame: f, strength: rise[f] };
      continue;
    }
    onsets.push({ frame: f, strength: rise[f] });
  }
  return onsets;
}

/** Scales a band's jump into 0..1, against the loudest jump that band produced. */
function velocities(onsets: ReadonlyArray<{ frame: number; strength: number }>): number[] {
  const loudest = onsets.reduce((max, o) => Math.max(max, o.strength), 0);
  return onsets.map((o) => (loudest > 0 ? Math.min(1, o.strength / loudest) : 0.5));
}

/**
 * A drum stem → GM percussion hits.
 *
 * Expects the **drum stem alone**, as separation produces it. Run over a whole
 * mix it reports the bass guitar as kick drums and every cymbal-shaped
 * consonant in the vocal as a hi-hat.
 */
export function transcribeDrums(samples: Float32Array, sampleRate: number): DrumHit[] {
  if (samples.length < HOP * 4) return [];

  const kickBand = lowpass(samples, sampleRate, KICK_MAX_HZ, POLES);
  // The snare's body: a lowpass and a highpass in series, where a subtraction
  // of two lowpasses would leak the kick straight through.
  const snareBand = highpass(
    lowpass(samples, sampleRate, SNARE_MAX_HZ, POLES),
    sampleRate,
    SNARE_MIN_HZ,
    POLES,
  );
  const hatBand = highpass(samples, sampleRate, HIHAT_MIN_HZ, POLES);

  const secondsPerFrame = HOP / sampleRate;
  const kickLevels = frameLevels(kickBand);
  const snareLevels = frameLevels(snareBand);
  const hatLevels = frameLevels(hatBand);

  const kickOnsets = detectOnsets(kickLevels, sampleRate);
  const snareOnsets = detectOnsets(snareLevels, sampleRate);
  const hatOnsets = detectOnsets(hatLevels, sampleRate);

  const kickVelocities = velocities(kickOnsets);
  const snareVelocities = velocities(snareOnsets);
  const hatVelocities = velocities(hatOnsets);
  const snareSeconds = snareOnsets.map((o) => o.frame * secondsPerFrame);

  /**
   * True when this strike is really the snare's own energy in another band.
   *
   * Both conditions matter. A snare has to have been struck at this instant —
   * a level comparison alone would silence every hi-hat in a passage where
   * something else keeps the middle busy — and the snare band has to actually
   * be the louder one, which is where the physics is: a kick's energy below
   * 120Hz dwarfs its energy at 250-2000, so a real kick is never outranked,
   * while a snare's 200Hz body leaking into the kick band always is.
   */
  const isSnareBleed = (frame: number, bandLevels: Float32Array): boolean => {
    const atSec = frame * secondsPerFrame;
    const struck = snareSeconds.some((s) => Math.abs(s - atSec) <= COINCIDENT_SEC);
    return struck && snareLevels[frame] > bandLevels[frame];
  };

  const kickSeconds = kickOnsets.map((o) => o.frame * secondsPerFrame);
  /**
   * The mirror of `isSnareBleed`: a beater click is broadband too.
   *
   * A kick's attack puts a short burst into the snare's band, so without this a
   * four-on-the-floor pattern comes back with a phantom snare on every kick.
   * Together the two rules mean a coincident kick and snare report whichever
   * band is louder — the tradeoff noted on `COINCIDENT_SEC`.
   */
  const isKickBleed = (frame: number): boolean => {
    const atSec = frame * secondsPerFrame;
    const struck = kickSeconds.some((k) => Math.abs(k - atSec) <= COINCIDENT_SEC);
    return struck && kickLevels[frame] > snareLevels[frame];
  };

  const hits: DrumHit[] = [];

  kickOnsets.forEach((o, i) => {
    if (isSnareBleed(o.frame, kickLevels)) return;
    hits.push({ midi: DRUM_KICK, startSec: o.frame * secondsPerFrame, velocity: kickVelocities[i] });
  });

  snareOnsets.forEach((o, i) => {
    if (isKickBleed(o.frame)) return;
    hits.push({ midi: DRUM_SNARE, startSec: o.frame * secondsPerFrame, velocity: snareVelocities[i] });
  });

  const openFrames = Math.max(1, Math.round(OPEN_HIHAT_SEC / secondsPerFrame));
  hatOnsets.forEach((o, i) => {
    if (isSnareBleed(o.frame, hatLevels)) return;
    // Open if the band is still up well after the strike; a closed hat is gone.
    const after = Math.min(hatLevels.length - 1, o.frame + openFrames);
    const sustained = hatLevels[after] > hatLevels[o.frame] * 0.5;
    hits.push({
      midi: sustained ? DRUM_HIHAT_OPEN : DRUM_HIHAT_CLOSED,
      startSec: o.frame * secondsPerFrame,
      velocity: hatVelocities[i],
    });
  });

  return hits.sort((a, b) => a.startSec - b.startSec);
}

/** Every note this can emit is a real GM percussion address. */
export function isPercussionNote(midi: number): boolean {
  return midi >= GM_PERCUSSION_RANGE.min && midi <= GM_PERCUSSION_RANGE.max;
}
