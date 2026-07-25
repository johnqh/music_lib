import type { UUID } from '@sudobility/music_types';

const HEX_CHARS = '0123456789abcdef';

/**
 * Fallback v4-UUID generator for non-secure contexts, where
 * `crypto.randomUUID` is unavailable (it requires a secure context per the
 * Web Crypto spec). Not cryptographically strong; adequate for local
 * identifiers only.
 */
function randomUuidFallback(): UUID {
  let result = '';
  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      result += '-';
    } else if (i === 14) {
      result += '4';
    } else if (i === 19) {
      result += HEX_CHARS[8 + Math.floor(Math.random() * 4)]; // one of 8, 9, a, b
    } else {
      result += HEX_CHARS[Math.floor(Math.random() * 16)];
    }
  }
  return result;
}

/**
 * Generates a v4 UUID. Uses `crypto.randomUUID` when available, falling back
 * to a `Math.random`-based generator in non-secure contexts (e.g. `http://`
 * origins other than `localhost`) where `crypto.randomUUID` is undefined.
 */
export function createId(): UUID {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return randomUuidFallback();
}
