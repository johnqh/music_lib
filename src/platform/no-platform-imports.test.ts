import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

/**
 * The point of the whole platform refactor, enforced. One stray import puts Web
 * Audio back into a React Native bundle, and nothing else in the suite would
 * notice — every test here runs in jsdom, where the offending import works fine.
 */
describe('music_lib is platform-free', () => {
  it('imports no audio or MIDI library anywhere', () => {
    const offenders = sourceFiles('src').filter((path) =>
      /from '(tone|@tonejs\/midi)'/.test(readFileSync(path, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('declares no platform runtime dependency', () => {
    const { dependencies } = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(dependencies).sort()).toEqual(['immer', 'vexflow', 'zod']);
  });

  it('touches no DOM global outside the canvas renderer, which is handed its context', () => {
    // `adapters/vexflow` is excluded deliberately: the renderer draws into a
    // 2D context the caller supplies, and was verified to run with no DOM at
    // all. It names DOM *types*, which is not the same as reaching for a
    // global.
    const offenders = sourceFiles('src')
      .filter((path) => !path.includes('adapters/vexflow'))
      .filter((path) => {
        const text = readFileSync(path, 'utf8');
        return /\b(document|DOMParser|localStorage)\s*[.(]/.test(text);
      });
    expect(offenders).toEqual([]);
  });
});
