/** Serialize read/modify/apply operations; a failed operation must not poison the queue. */
export class ConfigurationQueue {
  #tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation);
    this.#tail = result.catch(() => {});
    return result;
  }
}

/** Restore persisted settings and reconcile rules after a partially applied update. */
export async function applyWithRollback<T>(options: {
  read: () => Promise<T>;
  write: () => Promise<unknown>;
  restore: (previous: T) => Promise<unknown>;
  sync: () => Promise<unknown>;
}) {
  const previous = await options.read();
  await options.write();
  try {
    await options.sync();
  } catch (error) {
    try {
      await options.restore(previous);
      await options.sync();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Could not apply or restore client settings. Check the server logs and restart the interface before retrying.',
        { cause: rollbackError }
      );
    }
    throw new Error(
      'Could not apply client settings. Previous settings were restored. Check the server logs for details.',
      { cause: error }
    );
  }
}
