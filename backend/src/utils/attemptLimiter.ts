/**
 * Limits how many wrong guesses an account gets in a time window
 * (DECISIONS.md #17). Used where a request must prove the user knows their
 * current password (changing the password or the email): without it, someone
 * holding a stolen session token could try passwords without limit.
 *
 * In memory and per process: it resets when the server restarts, and is not
 * shared across servers. That is enough for a single-server app; a deployment
 * with several instances would need a shared store.
 */

export interface LimiterOptions {
  maxFailures: number;
  windowMs: number;
  now?: () => number;
}

export interface AttemptLimiter {
  /** Milliseconds until another attempt is allowed, or 0 if one is allowed now. */
  blockedForMs(key: string): number;
  /** Record a wrong guess. */
  recordFailure(key: string): void;
  /** Forget the failures (after a correct guess). */
  reset(key: string): void;
}

export function createAttemptLimiter({ maxFailures, windowMs, now = Date.now }: LimiterOptions): AttemptLimiter {
  // key -> timestamps of recent failures
  const failures = new Map<string, number[]>();

  const recent = (key: string): number[] => {
    const cutoff = now() - windowMs;
    const kept = (failures.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length > 0) failures.set(key, kept);
    else failures.delete(key);
    return kept;
  };

  return {
    blockedForMs(key) {
      const kept = recent(key);
      if (kept.length < maxFailures) return 0;
      // blocked until the oldest of the counted failures falls out of the window
      return Math.max(0, kept[kept.length - maxFailures] + windowMs - now());
    },
    recordFailure(key) {
      failures.set(key, [...recent(key), now()]);
    },
    reset(key) {
      failures.delete(key);
    },
  };
}
