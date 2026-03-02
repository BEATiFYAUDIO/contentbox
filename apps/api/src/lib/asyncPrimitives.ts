type TtlEntry<V> = {
  value: V;
  expiresAt: number;
};

export class TTLCache<K, V> {
  private readonly store = new Map<K, TtlEntry<V>>();

  get(key: K): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: K, value: V, ttlMs: number): void {
    const ttl = Math.max(1, Math.floor(Number(ttlMs || 0)));
    this.store.set(key, { value, expiresAt: Date.now() + ttl });
  }

  clear(key?: K): void {
    if (typeof key === "undefined") {
      this.store.clear();
      return;
    }
    this.store.delete(key);
  }
}

export class SingleFlight {
  private readonly inflight = new Map<string, Promise<unknown>>();

  async do<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const p = (async () => fn())().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, p);
    return p as Promise<T>;
  }
}

export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async use<T>(fn: () => Promise<T>): Promise<T> {
    const max = Math.max(1, Math.floor(Number(this.limit || 1)));
    if (this.active >= max) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active = Math.max(0, this.active - 1);
      const next = this.waiters.shift();
      if (next) next();
    }
  }
}

export class Cooldown {
  private readonly until = new Map<string, number>();

  set(key: string, ttlMs: number, _reason?: string): void {
    const ttl = Math.max(1, Math.floor(Number(ttlMs || 0)));
    this.until.set(String(key), Date.now() + ttl);
  }

  get(key: string): boolean {
    const exp = this.until.get(String(key));
    if (!exp) return false;
    if (exp <= Date.now()) {
      this.until.delete(String(key));
      return false;
    }
    return true;
  }

  clear(key: string): void {
    this.until.delete(String(key));
  }
}
