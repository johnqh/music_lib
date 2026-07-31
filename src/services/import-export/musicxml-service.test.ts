import { describe, expect, it } from 'vitest';
import { MusicXmlService } from './musicxml-service.js';
import { exportMusicXml } from '../../adapters/musicxml/export.js';
import { importMusicXml } from '../../adapters/musicxml/import.js';
import { twinkleScore } from '../../test/fixtures.js';
import { MockXmlParser } from '@sudobility/music_io/mocks';

describe('MusicXmlService', () => {
  it('export() matches the direct adapter call', async () => {
    const service = new MusicXmlService(new MockXmlParser());
    const score = twinkleScore();
    await expect(service.export(score)).resolves.toBe(exportMusicXml(score));
  });

  it('import() matches the direct adapter call', async () => {
    const service = new MusicXmlService(new MockXmlParser());
    const xml = exportMusicXml(twinkleScore());
    const direct = importMusicXml(xml, new MockXmlParser());
    const viaService = await service.import(xml);
    expect(viaService.warnings).toEqual(direct.warnings);
    expect(viaService.score.tracks.map((t) => t.name)).toEqual(direct.score.tracks.map((t) => t.name));
  });

  it('filenameFor() slugifies the score title', () => {
    const service = new MusicXmlService(new MockXmlParser());
    expect(service.filenameFor(twinkleScore())).toBe('twinkle-twinkle-little-star');
  });
});
