export const loginRatePolicy = {
  key: (email: string, ip: string) =>
    `${email.trim().toLowerCase()}\u0000${ip.trim()}`,
  windowMinutes: 15,
  maximumFailures: 5,
  blockMinutes: 15,
} as const;

type LoginAttemptState = {
  windowStartedAt: number;
  failureCount: number;
  blockedUntil: number | null;
};

export type LoginRateDecision = Readonly<{
  blocked: boolean;
  failureCount: number;
  retryAfterMs: number;
}>;

export class LoginRateLimiter {
  readonly #attempts = new Map<string, LoginAttemptState>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  isBlocked(email: string, ip: string): boolean {
    const key = loginRatePolicy.key(email, ip);
    const state = this.#attempts.get(key);

    if (!state?.blockedUntil) return false;
    if (state.blockedUntil > this.#now()) return true;

    this.#attempts.delete(key);
    return false;
  }

  registerFailure(email: string, ip: string): LoginRateDecision {
    const key = loginRatePolicy.key(email, ip);
    const now = this.#now();
    const windowMs = loginRatePolicy.windowMinutes * 60 * 1000;
    const blockMs = loginRatePolicy.blockMinutes * 60 * 1000;
    const previous = this.#attempts.get(key);

    if (previous?.blockedUntil && previous.blockedUntil > now) {
      return {
        blocked: true,
        failureCount: previous.failureCount,
        retryAfterMs: previous.blockedUntil - now,
      };
    }

    const state =
      previous && now - previous.windowStartedAt < windowMs
        ? previous
        : { windowStartedAt: now, failureCount: 0, blockedUntil: null };

    state.failureCount += 1;

    if (state.failureCount >= loginRatePolicy.maximumFailures) {
      state.blockedUntil = now + blockMs;
    }

    this.#attempts.set(key, state);

    return {
      blocked: state.blockedUntil !== null,
      failureCount: state.failureCount,
      retryAfterMs: state.blockedUntil ? state.blockedUntil - now : 0,
    };
  }

  clear(email: string, ip: string): void {
    this.#attempts.delete(loginRatePolicy.key(email, ip));
  }
}
