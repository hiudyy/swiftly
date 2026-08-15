import { describe, it, expect } from 'vitest';
import { createRateLimiter } from '../lib/rate-limiter.js';

describe('rate-limiter', () => {
    it('allows requests under the limit without delay', async () => {
        const rl = createRateLimiter({ requestsPerSecond: 5, minDelay: 5, maxDelay: 20 });
        const start = Date.now();
        for (let i = 0; i < 5; i++) await rl.checkLimit('x.com');
        expect(Date.now() - start).toBeLessThan(100);
    });
    it('throttles when the limit is exceeded until a slot frees', async () => {
        const rl = createRateLimiter({ requestsPerSecond: 1, minDelay: 10, maxDelay: 50 });
        await rl.checkLimit('x.com'); // fills the single slot
        const start = Date.now();
        await rl.checkLimit('x.com'); // must wait for the next 1s window
        expect(Date.now() - start).toBeGreaterThanOrEqual(5);
    });
    it('tracks domains independently', () => {
        const rl = createRateLimiter({ requestsPerSecond: 1, minDelay: 1000, maxDelay: 2000 });
        expect(() => rl.checkLimit('a.com')).not.toThrow();
        expect(() => rl.checkLimit('b.com')).not.toThrow();
    });
    it('setDomainConfig overrides defaults', () => {
        const rl = createRateLimiter({ requestsPerSecond: 1, minDelay: 5, maxDelay: 10 });
        rl.setDomainConfig('slow.com', { requestsPerSecond: 10 });
        const cfg = rl.domainConfigs.get('slow.com');
        expect(cfg.requestsPerSecond).toBe(10);
    });
    it('clearDomain resets a single domain', async () => {
        const rl = createRateLimiter({ requestsPerSecond: 1, minDelay: 1000, maxDelay: 2000 });
        await rl.checkLimit('a.com');
        rl.clearDomain('a.com');
        expect(rl.limits.has('a.com')).toBe(false);
    });
    it('clear resets all domains', () => {
        const rl = createRateLimiter({ requestsPerSecond: 5 });
        rl.limits.set('a.com', [Date.now()]);
        rl.clear();
        expect(rl.limits.size).toBe(0);
        expect(rl.delays.size).toBe(0);
    });
    it('uses the provided default config', () => {
        const rl = createRateLimiter({ requestsPerSecond: 7 });
        expect(rl.defaultConfig.requestsPerSecond).toBe(7);
    });
});
