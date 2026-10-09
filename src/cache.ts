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

// shares one pending call per key, then keeps the settled result for ttlMs.
// the ttl starts when the call settles, so a slow or timed-out call is reused
// for the whole window instead of expiring the moment it ends
export function createSharedCalls<T>({
  ttlMs,
  now = Date.now,
  keepFailures,
}: {
  ttlMs: number;
  now?: () => number;
  keepFailures: boolean;
}) {
  const settled = createTtlCache<Promise<T>>({ ttlMs, now });
  const pending = new Map<string, Promise<T>>();

  return (key: string, call: () => Promise<T>): Promise<T> => {
    const existing = settled.get(key)?.value ?? pending.get(key);
    if (existing) return existing;

    const promise = call();
    pending.set(key, promise);
    promise
      .then(
        () => settled.set(key, promise),
        () => {
          if (keepFailures) settled.set(key, promise);
        },
      )
      .finally(() => pending.delete(key));
    return promise;
  };
}
