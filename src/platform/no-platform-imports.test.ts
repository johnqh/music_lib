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
 * Prose is not code. Every rule below greps raw text, so without this a doc
 * comment that writes `document.` fails the build — and the temptation is
 * then to weaken the rule rather than reword the comment. The `[^:]` guard
 * keeps `https://` from eating the rest of its line.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Globals that exist on the web and nowhere else. Deliberately not a list of
 * everything `lib.dom.d.ts` names: `Blob`, `FormData`, `AbortSignal`,
 * `URLSearchParams` and friends are typed there but implemented by React
 * Native too, so banning them would be noise.
 */
const WEB_ONLY_GLOBALS = [
  'document',
  'window',
  'navigator',
  'localStorage',
  'sessionStorage',
  'DOMParser',
  'XMLSerializer',
  'XMLHttpRequest',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
  'matchMedia',
  'alert',
];

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

  it('touches no web-only global outside the canvas renderer, which is handed its context', () => {
    // `adapters/vexflow` is excluded deliberately: the renderer draws into a
    // 2D context the caller supplies, and was verified to run with no DOM at
    // all. It names DOM *types*, which is not the same as reaching for a
    // global.
    const pattern = new RegExp(`(^|[^.\\w])(globalThis\\.)?(${WEB_ONLY_GLOBALS.join('|')})\\s*[.([]`, 'm');
    const offenders = sourceFiles('src')
      .filter((path) => !path.includes('adapters/vexflow'))
      .filter((path) => pattern.test(stripComments(readFileSync(path, 'utf8'))));
    expect(offenders).toEqual([]);
  });

  /**
   * `import.meta` is the one hazard a `typeof` guard cannot cover: it is
   * syntax, not a value, so it is resolved when the consumer's bundler parses
   * the file rather than when the branch runs. Metro transforms modules to
   * CommonJS, where `import.meta` has no meaning — a React Native app fails to
   * build before any guard of ours executes. Node and Vite both support it,
   * which is why nothing else in this repo, or in music_app, would notice.
   *
   * Anything environment-shaped therefore has to be injected by the app:
   * `platform/workers.ts` for worker construction, `setErrorLogging` for
   * dev-only console output.
   */
  it('emits no `import.meta`, which React Native\'s bundler cannot parse', () => {
    const offenders = sourceFiles('src').filter((path) =>
      /import\s*\.\s*meta/.test(stripComments(readFileSync(path, 'utf8'))),
    );
    expect(offenders).toEqual([]);
  });

  /**
   * Threading is a platform capability like audio or file access, and this
   * package deliberately has none of those.
   *
   * There were two workers here, thin wrappers that moved `quantizeEvents` and
   * `importMidiFile` off the main thread. They cost a `Worker` type in two
   * service classes, a requestId/postMessage protocol, two `.worker.js` entry
   * points, `"WebWorker"` in tsconfig's `lib`, and — once React Native was in
   * scope — a whole injection seam to build them from outside. What they
   * bought was measured: `quantizeEvents` takes **0.57ms** at the 2000-event
   * count where the app routed to the worker, against a ~5ms notation redraw,
   * and `postMessage` structure-clones the event array both ways. The offload
   * plausibly cost more than the work.
   *
   * Both were deleted. The synchronous path they fell back to — the one every
   * test and every non-web platform already took — is now the only path.
   */
  it('names no `Worker`: threading is a platform capability, and this package has none', () => {
    const offenders = sourceFiles('src').filter((path) =>
      /\b(Worker|postMessage)\b/.test(stripComments(readFileSync(path, 'utf8'))),
    );
    expect(offenders).toEqual([]);
  });
});
