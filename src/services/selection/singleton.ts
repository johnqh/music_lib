/**
 * The music-selection singleton.
 *
 * Same shape as the rest of the family's services (see `@sudobility/di`'s
 * storage and network singletons): initialise once at start-up, read it
 * everywhere, reset it in tests.
 *
 * A singleton because the selection *is* global to an open score — there is
 * one thing the user has selected, and every reader of it has to agree about
 * what that is. Two instances would let the toolbar and the renderer disagree
 * about which notes are highlighted.
 */
import type {
  IMusicSelection,
  IMusicSelectionSource,
} from '@sudobility/music_types';
import { MusicSelection } from './music-selection.js';

let instance: IMusicSelectionSource | null = null;

/**
 * Creates the singleton if it does not exist.
 *
 * Idempotent, so a second call from a re-mounting composition root does not
 * silently swap the selection out from under everything subscribed to it.
 */
export function initializeMusicSelection(
  override?: IMusicSelectionSource
): IMusicSelectionSource {
  if (!instance) instance = override ?? new MusicSelection();
  return instance;
}

/** The writable selection. Held by the store's selection actions and nothing else. */
export function getMusicSelectionSource(): IMusicSelectionSource {
  return initializeMusicSelection();
}

/** Read-only access, for anything that renders or reasons about the selection. */
export function getMusicSelection(): IMusicSelection {
  return initializeMusicSelection();
}

/** Drops the singleton. Tests only — a suite must not inherit the last one's selection. */
export function resetMusicSelection(): void {
  instance = null;
}
