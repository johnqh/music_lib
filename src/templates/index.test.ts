import { describe, expect, it } from 'vitest';
import { buildTemplate, projectTemplates, templateSummaries } from './index.js';
import { validateScore } from '../domain/validation/validator.js';
import { gmKit } from '../domain/instruments/gm-kit.js';
import { gmInstrument } from '../domain/instruments/gm.js';

describe('projectTemplates', () => {
  it('has unique ids, since the picker builds by id', () => {
    const ids = projectTemplates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('builds every template into a score with no validation errors', () => {
    // A template is the first thing a new user sees. One that arrives with a
    // measure that does not add up is worse than no template at all.
    for (const template of projectTemplates) {
      const score = buildTemplate(template.id);
      expect(score, template.id).not.toBeNull();
      const errors = validateScore(score!).filter((issue) => issue.severity === 'error');
      expect(errors, `${template.id}: ${errors.map((e) => e.message).join(', ')}`).toEqual([]);
      expect(score!.tracks.length, template.id).toBeGreaterThan(0);
      expect(score!.tracks[0].measures.length, template.id).toBeGreaterThan(0);
    }
  });

  it('gives every drum track a real kit, named as one', () => {
    // A percussion track's program is a kit and a pitched track's is an
    // instrument, and the two tables disagree at almost every address — a
    // template that set a drum track to program 40 would read "Violin" in the
    // picker and play Brush. Only percussion is pinned here: the pitched
    // fixtures carry deliberately short hand-written names ("Piano", not
    // "Acoustic Grand Piano").
    for (const template of projectTemplates) {
      for (const track of buildTemplate(template.id)!.tracks) {
        if (track.clef !== 'percussion') continue;
        const kit = gmKit(track.midiProgram);
        expect(kit, `${template.id}/${track.name} is at a real kit address`).not.toBeNull();
        expect(track.instrumentName, `${template.id}/${track.name}`).toBe(kit!.name);
      }
    }
  });

  it('names its pitched parts after instruments that exist', () => {
    for (const template of projectTemplates) {
      for (const track of buildTemplate(template.id)!.tracks) {
        if (track.clef === 'percussion') continue;
        expect(gmInstrument(track.midiProgram), `${template.id}/${track.name}`).not.toBeNull();
      }
    }
  });

  it('summarises without building, since the picker only shows text', () => {
    expect(templateSummaries().map((t) => t.id)).toEqual(projectTemplates.map((t) => t.id));
  });
});
