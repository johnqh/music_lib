import { describe, expect, it } from 'vitest';
import { resolveThemeMode } from './prefs';
import { THEME_MODES } from '@sudobility/music_types';

describe('resolveThemeMode', () => {
  it('follows the device in system mode', () => {
    expect(resolveThemeMode('system', true)).toBe('dark');
    expect(resolveThemeMode('system', false)).toBe('light');
  });

  it('ignores the device once a scheme is chosen', () => {
    expect(resolveThemeMode('light', true)).toBe('light');
    expect(resolveThemeMode('dark', false)).toBe('dark');
  });

  it('answers a concrete scheme for every mode', () => {
    for (const mode of THEME_MODES)
      expect(['light', 'dark']).toContain(resolveThemeMode(mode, true));
  });
});
