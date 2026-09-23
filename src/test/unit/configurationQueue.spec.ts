import { describe, expect, test, vi } from 'vitest';

import {
  ConfigurationQueue,
  applyWithRollback,
} from '#server/utils/configurationQueue';

describe('configuration mutations', () => {
  test('serializes the entire read, write, apply and rollback operation', async () => {
    const queue = new ConfigurationQueue();
    const events: string[] = [];
    let unlock!: () => void;
    const gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const first = queue.run(async () => {
      events.push('first');
      await gate;
      events.push('restored');
      throw new Error('apply failed');
    });
    const caught = first.catch(() => {});
    const second = queue.run(async () => {
      events.push('second');
    });
    await Promise.resolve();
    expect(events).toEqual(['first']);
    unlock();
    await Promise.all([caught, second]);
    expect(events).toEqual(['first', 'restored', 'second']);
  });

  test('restores previous persistent settings and reapplies them on failure', async () => {
    let stored = 5;
    const sync = vi
      .fn()
      .mockRejectedValueOnce(new Error('tc failed'))
      .mockResolvedValueOnce(undefined);
    await expect(
      applyWithRollback({
        read: async () => stored,
        write: async () => {
          stored = 20;
        },
        restore: async (old) => {
          stored = old;
        },
        sync,
      })
    ).rejects.toThrow('Previous settings were restored');
    expect(stored).toBe(5);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  test('reports rollback failure instead of claiming success', async () => {
    const restore = vi.fn().mockResolvedValue(undefined);
    await expect(
      applyWithRollback({
        read: async () => 5,
        write: async () => {},
        restore,
        sync: async () => {
          throw new Error('tc unavailable');
        },
      })
    ).rejects.toBeInstanceOf(AggregateError);
    expect(restore).toHaveBeenCalledWith(5);
  });

  test('does not apply rules when the atomic database write failed', async () => {
    const sync = vi.fn();
    const restore = vi.fn();
    await expect(
      applyWithRollback({
        read: async () => 5,
        write: async () => {
          throw new Error('database');
        },
        restore,
        sync,
      })
    ).rejects.toThrow('database');
    expect(sync).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });

  test('keeps new settings when applying succeeds', async () => {
    const restore = vi.fn();
    await applyWithRollback({
      read: async () => 5,
      write: async () => {},
      restore,
      sync: async () => {},
    });
    expect(restore).not.toHaveBeenCalled();
  });
});
