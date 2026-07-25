/**
 * Instrument factories (spec §10, Task 13 brief): six synthesized voices
 * (piano, electric piano, strings, bass, synth lead, drum kit), chosen by
 * `createInstrument(nameOrProgram, isPercussion)` from a track's
 * `instrumentName` (free text, e.g. "Electric Piano") or `midiProgram`
 * (General MIDI program number). `tone-engine.ts` is the only intended
 * caller — it does the tick/tempo/scheduling work and just needs a uniform
 * `InstrumentHandle` per track.
 *
 * "Synthesized, fallback synth if samples unavailable; structure so
 * SoundFont/sample libraries can be added later" (spec §10): no sample
 * assets are bundled with this repo yet, so `PIANO_SAMPLE_URLS` is empty
 * and `createPianoInstrument` always takes the synth-fallback branch today
 * — but that branch is real, exercised code (not a stub), so populating
 * the map (and setting a `baseUrl`) later is a one-line change with no
 * call-site impact anywhere else.
 */
import * as Tone from 'tone';
import { midiToHertz } from './midi.js';

/**
 * The uniform shape `tone-engine.ts` schedules through, regardless of which
 * underlying Tone.js instrument(s) back it. `velocity` is Tone's normalized
 * 0-1 range (not the domain's 0-127 `NoteEvent.velocity`) — callers convert
 * via `midi.ts`'s `normalizeVelocity` before calling in, keeping this
 * module free of any domain-velocity-range assumption.
 */
export type InstrumentHandle = {
  triggerAttackRelease(midi: number, durationSeconds: number, time: number, velocity: number): void;
  connect(node: Tone.ToneAudioNode): void;
  dispose(): void;
};

export type InstrumentCategory = 'piano' | 'electric-piano' | 'strings' | 'bass' | 'synth-lead' | 'drum-kit';

// ---- category resolution ---------------------------------------------------

const NAME_CATEGORY_PATTERNS: Array<[RegExp, InstrumentCategory]> = [
  [/drum|percussion|\bkit\b/i, 'drum-kit'],
  [/electric.?piano|rhodes|wurlitzer|e\.?\s?piano/i, 'electric-piano'],
  [/string|violin|viola|cello|orchestra/i, 'strings'],
  [/bass/i, 'bass'],
  [/synth.?lead|\blead\b|square/i, 'synth-lead'],
];

/** Category for a free-text `instrumentName`, defaulting to `'piano'` for anything unmatched (including plain "Piano"). */
function categoryForName(name: string): InstrumentCategory {
  for (const [pattern, category] of NAME_CATEGORY_PATTERNS) {
    if (pattern.test(name)) return category;
  }
  return 'piano';
}

/**
 * Category for a General MIDI program number (0-indexed GM1 sound set).
 * Only the ranges this module actually distinguishes are called out;
 * everything else (organ, guitar, brass, reed, pipe, ensemble, sound
 * effects, ...) falls back to `'piano'`, per spec §10's fallback-synth
 * guidance — there is no dedicated voice for those families yet.
 */
function categoryForProgram(program: number): InstrumentCategory {
  if (program === 4 || program === 5) return 'electric-piano'; // Electric Piano 1/2
  if (program >= 0 && program <= 7) return 'piano'; // Acoustic/Bright/Electric Grand, Honky-tonk, ...
  if (program >= 32 && program <= 39) return 'bass';
  if (program >= 40 && program <= 55) return 'strings'; // Strings + ensemble
  if (program >= 80 && program <= 87) return 'synth-lead';
  return 'piano';
}

/** Resolves the synthesized voice category for a track (`isPercussion` — a `percussion`-clef track per spec §4 — always wins, matching a GM drum-channel track regardless of its nominal program/name). */
export function resolveInstrumentCategory(nameOrProgram: string | number, isPercussion: boolean): InstrumentCategory {
  if (isPercussion) return 'drum-kit';
  return typeof nameOrProgram === 'number' ? categoryForProgram(nameOrProgram) : categoryForName(nameOrProgram);
}

// ---- pitched-voice wiring ---------------------------------------------------

/** The minimal shape every pitched Tone.js instrument used below satisfies. */
type PitchedVoice = Tone.ToneAudioNode & {
  triggerAttackRelease(note: number, duration: number, time?: number, velocity?: number): unknown;
};

function wrapVoice(voice: PitchedVoice): InstrumentHandle {
  return {
    triggerAttackRelease(midi, durationSeconds, time, velocity) {
      voice.triggerAttackRelease(midiToHertz(midi), durationSeconds, time, velocity);
    },
    connect(node) {
      voice.connect(node);
    },
    dispose() {
      voice.dispose();
    },
  };
}

// ---- piano (Sampler with synth fallback) ------------------------------------

/** See module doc: empty today (no bundled samples), by design. */
const PIANO_SAMPLE_URLS: Record<string, string> = {};

function createPianoFallbackSynth(): Tone.PolySynth<Tone.Synth> {
  return new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.005, decay: 0.35, sustain: 0.15, release: 0.6 },
  });
}

function createPianoInstrument(): InstrumentHandle {
  if (Object.keys(PIANO_SAMPLE_URLS).length === 0) {
    return wrapVoice(createPianoFallbackSynth());
  }
  try {
    return wrapVoice(new Tone.Sampler({ urls: PIANO_SAMPLE_URLS }));
  } catch {
    return wrapVoice(createPianoFallbackSynth());
  }
}

// ---- electric piano (FM) ----------------------------------------------------

function createElectricPianoInstrument(): InstrumentHandle {
  return wrapVoice(
    new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3.01,
      modulationIndex: 14,
      envelope: { attack: 0.001, decay: 1.2, sustain: 0.1, release: 0.8 },
      modulation: { type: 'square' },
      modulationEnvelope: { attack: 0.002, decay: 0.2, sustain: 0, release: 0.2 },
    }),
  );
}

// ---- strings (slow-attack PolySynth) ----------------------------------------

function createStringsInstrument(): InstrumentHandle {
  return wrapVoice(
    new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.6, decay: 0.3, sustain: 0.8, release: 1.2 },
    }),
  );
}

// ---- bass (MonoSynth) --------------------------------------------------------

function createBassInstrument(): InstrumentHandle {
  return wrapVoice(
    new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3 },
      filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.4, baseFrequency: 80, octaves: 2.5 },
    }),
  );
}

// ---- synth lead (PolySynth square) ------------------------------------------

function createSynthLeadInstrument(): InstrumentHandle {
  return wrapVoice(
    new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'square' },
      envelope: { attack: 0.02, decay: 0.1, sustain: 0.7, release: 0.2 },
    }),
  );
}

// ---- drum kit (MembraneSynth kick / NoiseSynth snare+hat) ------------------

/** GM percussion note numbers routed to the kick voice (bass drums + toms — pitched, membrane-appropriate). */
const KICK_NOTES = new Set([35, 36, 41, 43, 45, 47, 48, 50]);
/** GM percussion note numbers routed to the snare voice. */
const SNARE_NOTES = new Set([37, 38, 39, 40]);
/** Everything else (hi-hats, cymbals, other unpitched percussion) routes to the brighter/shorter "hat" noise voice. */

function createDrumKitInstrument(): InstrumentHandle {
  const kick = new Tone.MembraneSynth({
    envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.4 },
  });
  const snare = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 },
  });
  const hat = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
  });
  const hatFilter = new Tone.Filter(7000, 'highpass');
  hat.connect(hatFilter);

  const output = new Tone.Gain(1);
  kick.connect(output);
  snare.connect(output);
  hatFilter.connect(output);

  return {
    triggerAttackRelease(midi, durationSeconds, time, velocity) {
      if (KICK_NOTES.has(midi)) {
        kick.triggerAttackRelease(midiToHertz(midi), durationSeconds, time, velocity);
      } else if (SNARE_NOTES.has(midi)) {
        snare.triggerAttackRelease(durationSeconds, time, velocity);
      } else {
        hat.triggerAttackRelease(durationSeconds, time, velocity);
      }
    },
    connect(node) {
      output.connect(node);
    },
    dispose() {
      kick.dispose();
      snare.dispose();
      hat.dispose();
      hatFilter.dispose();
      output.dispose();
    },
  };
}

// ---- entry point --------------------------------------------------------------

/**
 * Builds the `InstrumentHandle` for a track (spec §10's six synthesized
 * voices). `nameOrProgram` is the track's `instrumentName` or
 * `midiProgram` (either is enough to resolve a category); `isPercussion`
 * should be `true` for a `percussion`-clef track (spec §4), which always
 * yields the drum kit regardless of `nameOrProgram`.
 */
export function createInstrument(nameOrProgram: string | number, isPercussion: boolean): InstrumentHandle {
  const category = resolveInstrumentCategory(nameOrProgram, isPercussion);
  switch (category) {
    case 'piano':
      return createPianoInstrument();
    case 'electric-piano':
      return createElectricPianoInstrument();
    case 'strings':
      return createStringsInstrument();
    case 'bass':
      return createBassInstrument();
    case 'synth-lead':
      return createSynthLeadInstrument();
    case 'drum-kit':
      return createDrumKitInstrument();
  }
}
