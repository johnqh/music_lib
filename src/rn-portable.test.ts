/**
 * music_lib must compose only what a React Native app can also load.
 *
 * Its own code is platform-free, but it is the package that binds everything
 * together, so its portability is mostly about WHICH ENTRY it imports from its
 * dependencies. `@sudobility/music_player` and `@sudobility/music_io` each
 * publish a `./web` and an `./rn` subpath and pick between them with a
 * `react-native` export condition on the root — so importing the root, or the
 * shared `./core`, is portable, and reaching into `/web` pins this package to
 * the browser for everyone downstream.
 *
 * That is a one-character mistake to make in an import and invisible until a
 * native build fails, so it is checked here.
 */
import { describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';

const WEB_ONLY =
  /\b(document|window|localStorage|sessionStorage|XMLHttpRequest|HTMLElement|HTMLCanvasElement|requestAnimationFrame|IntersectionObserver|ResizeObserver|Worker|DOMParser|FileReader)\b/;

function shipped(): string[] {
  return globSync('src/**/*.ts', { cwd: process.cwd() }).filter(
    f => !f.includes('.test.') && !f.startsWith('src/test/')
  );
}

function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/** Imports, read before strings are blanked. */
function importsOf(file: string): string[] {
  const raw = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  return [...raw.matchAll(/ from '([^']+)'/g)].map(m => m[1]);
}

describe('portability to React Native', () => {
  it('reaches for no browser-only entry of a sibling package', () => {
    const offenders: string[] = [];
    for (const file of shipped()) {
      for (const spec of importsOf(file)) {
        if (/^@sudobility\/[a-z_]+\/web(\/|$)/.test(spec)) {
          offenders.push(`${file}: ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('touches no global that React Native does not have', () => {
    const offenders = shipped().flatMap(file => {
      const match = WEB_ONLY.exec(codeOf(file));
      return match ? [`${file}: ${match[1]}`] : [];
    });
    expect(offenders).toEqual([]);
  });
});
