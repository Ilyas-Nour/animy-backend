// Simple Token Bucket / Leaky Bucket for Jikan API
// 3 requests per second = ~333ms. We use 400ms to be safe.

export class JikanRateLimiter {
  private nextAvailableTime = 0;
  private readonly INTERVAL = 400; // 400ms spacing

  async wait(): Promise<void> {
    const now = Date.now();
    // Schedule this request at the next available slot
    const start = Math.max(now, this.nextAvailableTime);
    this.nextAvailableTime = start + this.INTERVAL;

    const waitTime = start - now;
    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

// Global Singleton
export const jikanLimiter = new JikanRateLimiter();
