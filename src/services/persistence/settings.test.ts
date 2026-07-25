import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { ScoreSmithDb } from './db.js';
import { getSetting, loadAllSettings, setSetting } from './settings.js';

let db: ScoreSmithDb;
let counter = 0;

function makeDb(): ScoreSmithDb {
  counter += 1;
  return new ScoreSmithDb(`scoresmith-test-settings-${counter}`);
}

afterEach(async () => {
  await db?.delete();
});

describe('settings persistence', () => {
  it('getSetting falls back to the given default when unset', async () => {
    db = makeDb();
    expect(await getSetting(db, 'theme', 'system')).toBe('system');
  });

  it('setSetting then getSetting round-trips the value', async () => {
    db = makeDb();
    await setSetting(db, 'theme', 'dark');
    expect(await getSetting(db, 'theme', 'system')).toBe('dark');
  });

  it('loadAllSettings reads every key, falling back per-field', async () => {
    db = makeDb();
    await setSetting(db, 'developerMode', true);

    const settings = await loadAllSettings(db, {
      theme: 'system',
      developerMode: false,
      mockSeed: 'default-seed',
      historyLimit: null,
    });

    expect(settings).toEqual({
      theme: 'system',
      developerMode: true,
      mockSeed: 'default-seed',
      historyLimit: null,
    });
  });
});
