import { describe, it, expect, vi } from 'vitest';
import { createRateLimiter } from '../lib/rate-limiter.js';

describe('rate-limiter', () => {
    it('allows requests under the limit without delay', async () => {
        const rl = createRateLimiter({ requestsPerSecond: 5, minDelay: 10, maxDelay: 100 });
        const start = Date.now();
        await rl.checkLimit('x.com');
        await rl.checkLimit('x.com');
        expect(Date.now() - start).toBeLessThan(200);
    });

    it('throttles when the limit is exceeded until a slot frees', async () => {
        vi.useFakeTimers();
        try {
            const rl = createRateLimiter({ requestsPerSecond: 1, minDelay: 10, maxDelay: 5000 });
            await rl.checkLimit('x.com');
            // Second request exceeds the 1/sec limit -> must wait.
            const p = rl.checkLimit('x.com');
            let settled = false;
            p.then(() => (settled = true));

            // Not yet settled after a short wait.
            vi.advanceTimersByTimeAsync(50);
            expect(settled).toBe(false);

            // After the first request's 1s window elapses (plus backoff), it settles.
            await vi.advanceTimersByTimeAsync(2000);
            expect(settled).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('tracks domains independently', () => {
        const rl = createRateLimiter({ requestsPerSecond: 1 });
        expect(() => rl.checkLimit('a.com')).not.toThrow();
        expect(() => rl.checkLimit('b.com')).not.toThrow();
    });

    it('setDomainConfig overrides defaults', () => {
        const rl = createRateLimiter({ requestsPerSecond: 2 });
        rl.setDomainConfig('x.com', { requestsPerSecond: 10 });
        expect(rl.domainConfigs.get('x.com').requestsPerSecond).toBe(10);
    });

    it('clear resets all domains', () => {
        const rl = createRateLimiter();
        rl.setDomainConfig('x.com', { requestsPerSecond: 1 });
        rl.clear();
        expect(rl.domainConfigs.size).toBe(0);
        expect(rl.limits.size).toBe(0);
    });
});