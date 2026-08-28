export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Espace les appels d'au moins minIntervalMs, pour respecter un rate-limit externe
// (ex: 50 req/min sur l'API AROME) sans avoir a gerer une file d'attente complexe.
export class RateThrottle {
  private nextAvailableAt = 0;

  constructor(private readonly minIntervalMs: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const wait = this.nextAvailableAt - Date.now();
    if (wait > 0) await sleep(wait);
    this.nextAvailableAt = Date.now() + this.minIntervalMs;
    return fn();
  }
}
