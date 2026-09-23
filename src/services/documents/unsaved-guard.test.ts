import { describe, expect, it } from 'vitest';
import { decideClose, decideQuit, hasUnwrittenWork } from './unsaved-guard';

const doc = (id: string, dirty: boolean) => ({ id, dirty });

describe('closing a document', () => {
  it('closes a clean one without asking', () => {
    expect(decideClose(doc('a', false))).toEqual({ kind: 'close' });
  });

  it('asks about an edited one, naming it', () => {
    const d = doc('a', true);
    expect(hasUnwrittenWork(d)).toBe(true);
    expect(decideClose(d)).toEqual({ kind: 'confirm', documents: [d] });
  });
});

describe('quitting', () => {
  it('says nothing when everything is written', () => {
    expect(decideQuit([doc('a', false), doc('b', false)])).toEqual({
      kind: 'close',
    });
  });

  it('names every unwritten document in one question, in order', () => {
    const a = doc('a', true);
    const b = doc('b', true);
    expect(decideQuit([doc('c', false), a, b])).toEqual({
      kind: 'confirm',
      documents: [a, b],
    });
  });

  it('is safe with nothing open', () => {
    expect(decideQuit([])).toEqual({ kind: 'close' });
  });
});
