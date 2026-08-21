import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, reportError, setErrorLogging } from './errors.js';
import { createAppStore } from '../store/useAppStore.js';
import { testStoreContext } from '../test/store-context.js';

const freshStore = () => createAppStore({ context: testStoreContext() });

afterEach(() => {
  setErrorLogging(false);
  vi.restoreAllMocks();
});

describe('reportError', () => {
  it('pushes the user-facing message as an error toast', () => {
    const store = freshStore();

    reportError(
      new AppError({
        code: 'midi-import',
        userMessage: 'That file is not MIDI.',
      }),
      {
        context: 'Import failed',
        store,
      }
    );

    const toasts = store.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.message).toBe('Import failed: That file is not MIDI.');
    expect(toasts[0]!.severity).toBe('error');
  });

  it('logs no technical detail by default, so a production bundle stays quiet', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

    reportError(new Error('boom'), { store: freshStore() });

    expect(debug).not.toHaveBeenCalled();
  });

  it('logs the raw error once the app turns logging on', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const err = new Error('boom');
    setErrorLogging(true);

    reportError(err, { context: 'Save failed', store: freshStore() });

    expect(debug).toHaveBeenCalledWith('[Moosiac error]', 'Save failed', err);
  });

  it('still shows the user a toast when logging is on — the console is additional, not instead', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const store = freshStore();
    setErrorLogging(true);

    reportError(new Error('boom'), { store });

    expect(store.getState().toasts).toHaveLength(1);
  });
});
