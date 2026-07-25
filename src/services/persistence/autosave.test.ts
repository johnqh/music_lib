import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosaver } from './autosave';

/** A controllable async op: `resolve()`/`reject()` settle the promise returned by the most recent call. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createAutosaver', () => {
  it('does not call save until debounceMs has elapsed after notifyChange', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosaver = createAutosaver(save, 2000);

    autosaver.notifyChange();
    await vi.advanceTimersByTimeAsync(1999);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of notifyChange calls into a single save', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosaver = createAutosaver(save, 2000);

    autosaver.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    autosaver.notifyChange(); // resets the timer
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush() is a no-op when nothing is dirty', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosaver = createAutosaver(save, 2000);

    await autosaver.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('flush() saves immediately and cancels the pending debounce timer', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosaver = createAutosaver(save, 2000);

    autosaver.notifyChange();
    await autosaver.flush();
    expect(save).toHaveBeenCalledTimes(1);

    // The debounce timer that would have fired at 2000ms must have been cancelled.
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('dispose() cancels a pending save and further notifyChange calls do nothing', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosaver = createAutosaver(save, 2000);

    autosaver.notifyChange();
    autosaver.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();

    autosaver.notifyChange();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
  });

  it('dispose() resolves flush() as a no-op even if a change was pending', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosaver = createAutosaver(save, 2000);

    autosaver.notifyChange();
    autosaver.dispose();
    await autosaver.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('a change that arrives during an in-flight save triggers a fresh debounced save afterward, not an immediate one', async () => {
    const first = deferred<void>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const autosaver = createAutosaver(save, 2000);

    autosaver.notifyChange();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);

    // A change arrives while the first save is still in flight.
    autosaver.notifyChange();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1); // no new save yet: still waiting on the first

    first.resolve();
    await vi.advanceTimersByTimeAsync(0); // let the `finally` handler run and re-arm the timer
    expect(save).toHaveBeenCalledTimes(1); // re-armed, but debounce hasn't elapsed yet

    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('flush() awaits an in-flight save, then saves again if a change arrived during it', async () => {
    const first = deferred<void>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const autosaver = createAutosaver(save, 2000);

    autosaver.notifyChange();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);

    autosaver.notifyChange(); // dirty again while the first save is in flight
    const flushPromise = autosaver.flush();

    first.resolve();
    await flushPromise;

    expect(save).toHaveBeenCalledTimes(2);
  });

  it('flush() resolves without an extra save when the in-flight save had no follow-up change', async () => {
    const first = deferred<void>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const autosaver = createAutosaver(save, 2000);

    autosaver.notifyChange();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);

    const flushPromise = autosaver.flush();
    first.resolve();
    await flushPromise;

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('propagates a save() rejection through flush()', async () => {
    const save = vi.fn().mockRejectedValue(new Error('save failed'));
    const autosaver = createAutosaver(save, 2000);

    autosaver.notifyChange();
    await expect(autosaver.flush()).rejects.toThrow('save failed');
  });

  it('a rejected timer-triggered save does not throw and later saves still work', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const autosaver = createAutosaver(save, 2000);

    autosaver.notifyChange();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);

    autosaver.notifyChange();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('uses a default debounceMs of 2000', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosaver = createAutosaver(save);

    autosaver.notifyChange();
    await vi.advanceTimersByTimeAsync(1999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
