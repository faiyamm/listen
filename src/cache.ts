export type TtlCache<T> = {
  get(key: string): { value: T } | undefined;
  set(key: string, value: T): void;
};

export function createTtlCache<T>({
  ttlMs,
  maxEntries = 500,
  now = Date.now,
}: {
  ttlMs: number;
  maxEntries?: number;
  now?: () => number;
}): TtlCache<T> {
  const entries = new Map<string, { value: T; expiresAt: number }>();

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return { value: entry.value };
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, expiresAt: now() + ttlMs });
      if (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
    },
  };
}

// rejects if the call hasn't settled by then, so a fetcher that ignores its
// abort signal can't leave a key pending forever
function withDeadline<T>(promise: Promise<T>, deadlineMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`gave up after ${deadlineMs}ms`)),
      deadlineMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// shares one pending call per key, then keeps the result: a success for
// ttlMs and a failure for failureTtlMs. both count from when the call
// settles, so a slow or timed-out call is reused for the whole window
// instead of expiring the moment it ends
export function createSharedCalls<T>({
  ttlMs,
  failureTtlMs,
  deadlineMs,
  now = Date.now,
}: {
  ttlMs: number;
  failureTtlMs: number;
  deadlineMs: number;
  now?: () => number;
}) {
  const succeeded = createTtlCache<Promise<T>>({ ttlMs, now });
  const failed = createTtlCache<Promise<T>>({ ttlMs: failureTtlMs, now });
  const pending = new Map<string, Promise<T>>();

  return (key: string, call: () => Promise<T>): Promise<T> => {
    const existing =
      succeeded.get(key)?.value ?? failed.get(key)?.value ?? pending.get(key);
    if (existing) return existing;

    const promise = withDeadline(call(), deadlineMs);
    pending.set(key, promise);
    promise
      .then(
        () => succeeded.set(key, promise),
        () => failed.set(key, promise),
      )
      .finally(() => pending.delete(key));
    return promise;
  };
}
