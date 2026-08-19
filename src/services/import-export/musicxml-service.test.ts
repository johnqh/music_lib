import { describe, expect, it } from 'vitest';
import { TEST_MUSICXML_WARNINGS } from '../../test/musicxml-warnings.js';
import { MusicXmlService } from './musicxml-service.js';
import { exportMusicXml } from '../../adapters/musicxml/export.js';
import { importMusicXml } from '../../adapters/musicxml/import.js';
import { twinkleScore } from '../../test/fixtures.js';
import { MockXmlParser } from '@sudobility/music_io/mocks';

describe('MusicXmlService', () => {
  it('export() matches the direct adapter call', async () => {
    const service = new MusicXmlService(
      new MockXmlParser(),
      TEST_MUSICXML_WARNINGS
    );
    const score = twinkleScore();
    await expect(service.export(score)).resolves.toBe(exportMusicXml(score));
  });

  it('import() matches the direct adapter call', async () => {
    const service = new MusicXmlService(
      new MockXmlParser(),
      TEST_MUSICXML_WARNINGS
    );
    const xml = exportMusicXml(twinkleScore());
    const direct = importMusicXml(
      xml,
      new MockXmlParser(),
      TEST_MUSICXML_WARNINGS
    );
    const viaService = await service.import(xml);
    expect(viaService.warnings).toEqual(direct.warnings);
    expect(viaService.score.tracks.map(t => t.name)).toEqual(
      direct.score.tracks.map(t => t.name)
    );
  });

  it('filenameFor() slugifies the score title', () => {
    const service = new MusicXmlService(
      new MockXmlParser(),
      TEST_MUSICXML_WARNINGS
    );
    expect(service.filenameFor(twinkleScore())).toBe(
      'twinkle-twinkle-little-star'
    );
  });
});
