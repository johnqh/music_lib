import { describe, expect, it } from 'vitest';
import {
  TEMPLATE_IDS,
  type TemplateCopy,
  buildTemplate,
  newProjectScore,
  projectTemplates,
  templateSummaries,
} from './index.js';

/**
 * Stand-in copy: this module owns the music, not the words, so the tests
 * supply their own rather than asserting on English that no longer lives here.
 */
const COPY = Object.fromEntries(
  TEMPLATE_IDS.map(id => [
    id,
    { name: `name:${id}`, description: `desc:${id}` },
  ])
) as TemplateCopy;
import { validateScore } from '@sudobility/music_types';
import { gmKit } from '@sudobility/music_types';
import { gmInstrument } from '@sudobility/music_types';

describe('projectTemplates', () => {
  it('has unique ids, since the picker builds by id', () => {
    const ids = projectTemplates(COPY).map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('builds every template into a score with no validation errors', () => {
    // A template is the first thing a new user sees. One that arrives with a
    // measure that does not add up is worse than no template at all.
    for (const template of projectTemplates(COPY)) {
      const score = buildTemplate(template.id, COPY);
      expect(score, template.id).not.toBeNull();
      const errors = validateScore(score!).filter(
        issue => issue.severity === 'error'
      );
      expect(
        errors,
        `${template.id}: ${errors.map(e => e.message).join(', ')}`
      ).toEqual([]);
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
    for (const template of projectTemplates(COPY)) {
      for (const track of buildTemplate(template.id, COPY)!.tracks) {
        if (track.clef !== 'percussion') continue;
        const kit = gmKit(track.midiProgram);
        expect(
          kit,
          `${template.id}/${track.name} is at a real kit address`
        ).not.toBeNull();
        expect(track.instrumentName, `${template.id}/${track.name}`).toBe(
          kit!.name
        );
      }
    }
  });

  it('names its pitched parts after instruments that exist', () => {
    for (const template of projectTemplates(COPY)) {
      for (const track of buildTemplate(template.id, COPY)!.tracks) {
        if (track.clef === 'percussion') continue;
        expect(
          gmInstrument(track.midiProgram),
          `${template.id}/${track.name}`
        ).not.toBeNull();
      }
    }
  });

  it('summarises without building, since the picker only shows text', () => {
    expect(templateSummaries(COPY).map(t => t.id)).toEqual(
      projectTemplates(COPY).map(t => t.id)
    );
  });
});

describe('newProjectScore', () => {
  /*
    A project always has at least one track. This is one end of that rule;
    `removeTrack` refusing to delete the last track is the other. Without both,
    the reader gets an empty page with a red playhead on it and no way to tell
    whether anything is wrong — which is exactly how it presented.
  */
  it('opens a blank project on a piano track, ready to write on', () => {
    const score = newProjectScore('Untitled');
    expect(score.tracks).toHaveLength(1);
    const track = score.tracks[0];
    expect(track.name).toBe('Piano');
    expect(track.midiProgram).toBe(0);
    expect(track.clef).toBe('treble');
    // Bars to write into, each fully rested — an empty grid draws nothing.
    expect(track.measures.length).toBeGreaterThan(0);
    for (const measure of track.measures) {
      expect(measure.voices.length).toBeGreaterThan(0);
    }
  });

  it('names the instrument from the catalogue rather than by hand', () => {
    // `midiProgram` is the identity; a typed name is free to disagree with it.
    // Program 0 is "Acoustic Grand Piano", which is not the track's own name.
    const score = newProjectScore('Untitled');
    expect(score.tracks[0].instrumentName).toBe(gmInstrument(0)?.name);
  });

  it('titles the score with the project name', () => {
    expect(newProjectScore('Wedding March').metadata.title).toBe(
      'Wedding March'
    );
  });

  it('gives every template a track too', () => {
    // The same rule, for the other way into a new project.
    for (const template of projectTemplates(COPY)) {
      expect(template.build().tracks.length).toBeGreaterThan(0);
    }
  });
});
