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
