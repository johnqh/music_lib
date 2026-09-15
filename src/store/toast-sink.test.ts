/**
 * A host that renders toasts somewhere other than the store.
 *
 * The native app has no toast list to read; without a sink, a failed autosave
 * or a refused note lands in `state.toasts` and nobody ever sees it.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Toast } from '@sudobility/music_editing';
import { createAppStore } from './useAppStore.js';
import { testStoreContext } from '../test/store-context.js';

function recordingSink() {
  const pushed: Toast[] = [];
  const dismissed: string[] = [];
  return {
    pushed,
    dismissed,
    sink: {
      push: (toast: Toast) => pushed.push(toast),
      dismiss: (id: string) => dismissed.push(id),
    },
  };
}

describe('toast sink', () => {
  it('hands every toast to the sink, with an id, instead of the store', () => {
    const { pushed, sink } = recordingSink();
    const store = createAppStore({
      context: testStoreContext({ toasts: sink }),
    });

    const onClick = vi.fn();
    const id = store.getState().pushToast({
      message: 'Nope',
      severity: 'error',
      action: { label: 'Undo', onClick },
    });

    expect(pushed).toEqual([
      {
        id,
        message: 'Nope',
        severity: 'error',
        action: { label: 'Undo', onClick },
      },
    ]);
    // Held nowhere else: nobody would ever dismiss it from the store.
    expect(store.getState().toasts).toEqual([]);
  });

  it('defaults the severity as the store does', () => {
    const { pushed, sink } = recordingSink();
    const store = createAppStore({
      context: testStoreContext({ toasts: sink }),
    });
    store.getState().pushToast({ message: 'Hi' });
    expect(pushed[0]?.severity).toBe('info');
  });

  it('routes a dismissal to the sink', () => {
    const { dismissed, sink } = recordingSink();
    const store = createAppStore({
      context: testStoreContext({ toasts: sink }),
    });
    const id = store.getState().pushToast({ message: 'x' });
    store.getState().dismissToast(id);
    expect(dismissed).toEqual([id]);
  });

  it('leaves the store list in charge when no sink is given', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().pushToast({ message: 'kept' });
    expect(store.getState().toasts.map(t => t.message)).toEqual(['kept']);
  });
});
