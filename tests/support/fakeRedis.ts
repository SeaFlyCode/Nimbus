// Fake Redis en memoire pour les tests : evite de dependre d'une vraie instance Redis
// et de taper un reseau, tout en couvrant le sous-ensemble de l'API ioredis utilise par l'app.
interface Entry {
  value: string;
  expiresAt: number | null;
}

export class FakeRedis {
  private store = new Map<string, Entry>();
  private lists = new Map<string, string[]>();

  constructor(_url?: string, _options?: unknown) {}

  private isExpired(entry: Entry): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= Date.now();
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) return null;
    return entry.value;
  }

  async set(key: string, value: string | number, ...args: unknown[]): Promise<'OK'> {
    let expiresAt: number | null = null;
    const exIndex = args.findIndex((a) => a === 'EX');
    if (exIndex !== -1) {
      const seconds = Number(args[exIndex + 1]);
      expiresAt = Date.now() + seconds * 1000;
    }
    this.store.set(key, { value: String(value), expiresAt });
    return 'OK';
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.max(0, Math.round((entry.expiresAt - Date.now()) / 1000));
  }

  async incr(key: string): Promise<number> {
    const current = Number((await this.get(key)) ?? '0');
    const next = current + 1;
    await this.set(key, next);
    return next;
  }

  async lpush(key: string, value: string): Promise<number> {
    const list = this.lists.get(key) ?? [];
    list.unshift(value);
    this.lists.set(key, list);
    return list.length;
  }

  async ltrim(key: string, start: number, stop: number): Promise<'OK'> {
    const list = this.lists.get(key) ?? [];
    this.lists.set(key, list.slice(start, stop + 1));
    return 'OK';
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) ?? [];
    return list.slice(start, stop === -1 ? undefined : stop + 1);
  }

  pipeline() {
    const ops: Array<() => Promise<unknown>> = [];
    const self = this;
    return {
      lpush(key: string, value: string) {
        ops.push(() => self.lpush(key, value));
        return this;
      },
      ltrim(key: string, start: number, stop: number) {
        ops.push(() => self.ltrim(key, start, stop));
        return this;
      },
      async exec() {
        const results = [];
        for (const op of ops) results.push([null, await op()]);
        return results;
      },
    };
  }

  on(): void {}

  async quit(): Promise<'OK'> {
    return 'OK';
  }
}

export default FakeRedis;
