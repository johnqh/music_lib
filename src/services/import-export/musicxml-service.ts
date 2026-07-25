/**
 * MusicXML import/export service (spec §17). Unlike `MidiService` (Task 7),
 * this has no worker-offload path: `DOMParser`-based XML parsing and the
 * hand-built string export are both cheap, synchronous operations (no
 * quantization/voice-allocation passes), so there's no meaningful work to
 * move off the main thread. Exposed as a small class (rather than bare
 * functions) purely for interface parity with `MidiService`, so callers
 * that already depend on an injected import/export service can treat both
 * uniformly.
 */
import { exportMusicXml, safeFilename } from '../../adapters/musicxml/export';
import { importMusicXml } from '../../adapters/musicxml/import';
import type { MusicXmlImportResult } from '../../adapters/musicxml/import';
import type { Score } from '@sudobility/music_types';

export class MusicXmlService {
  /** Exports `score` as a MusicXML (score-partwise 4.0) document string. */
  async export(score: Score): Promise<string> {
    return exportMusicXml(score);
  }

  /** Imports a MusicXML document string as a `Score`, plus any import warnings (spec §17). */
  async import(xmlText: string): Promise<MusicXmlImportResult> {
    return importMusicXml(xmlText);
  }

  /** Safe (no extension) filename for `score`'s `.musicxml` download, derived from its title. */
  filenameFor(score: Score): string {
    return safeFilename(score.metadata.title);
  }
}
