export class RateLimiter {
  private requests = new Map<string, number[]>();

  constructor(
    private maxRequests: number = 5,
    private windowSeconds: number = 30,
  ) {}

  isRateLimited(userId: string): boolean {
    const now = Date.now() / 1000;
    const times = (this.requests.get(userId) ?? []).filter(t => now - t < this.windowSeconds);

    if (times.length >= this.maxRequests) {
      this.requests.set(userId, times);
      return true;
    }

    times.push(now);
    this.requests.set(userId, times);
    return false;
  }
}
