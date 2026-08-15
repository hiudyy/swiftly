import { describe, it, expect, vi } from 'vitest';
import { createCacheStore } from '../lib/cache.js';

describe('cache', () => {
    it('stores and retrieves values', () => {
        const c = createCacheStore();
        c.set('k', { a: 1 });
        expect(c.get('k')).toEqual({ a: 1 });
        expect(c.has('k')).toBe(true);
    });

    it('respects ttl', () => {
        vi.useFakeTimers();
        try {
            const c = createCacheStore({ ttl: 100 });
            c.set('k', 'v');
            vi.advanceTimersByTime(150);
            expect(c.get('k')).toBeNull();
            expect(c.has('k')).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('delete removes entries', () => {
        const c = createCacheStore();
        c.set('k', 'v');
        expect(c.delete('k')).toBe(true);
        expect(c.get('k')).toBeNull();
    });

    it('clear removes all entries', () => {
        const c = createCacheStore();
        c.set('a', 1);
        c.set('b', 2);
        c.clear();
        expect(c.getStats().size).toBe(0);
    });

    it('evicts least-recently-used entries when over capacity', () => {
        vi.useFakeTimers();
        try {
            const c = createCacheStore({ maxSize: 3, ttl: 60000 });
            c.set('a', 1);
            vi.advanceTimersByTime(10);
            c.set('b', 2);
            vi.advanceTimersByTime(10);
            c.set('c', 3);
            vi.advanceTimersByTime(10);
            c.get('a'); // touch a so it is most recent
            vi.advanceTimersByTime(10);
            c.set('d', 4); // over capacity -> evicts ~20% (1 item), LRU = b

            expect(c.has('b')).toBe(false);
            expect(c.has('a')).toBe(true);
            expect(c.has('c')).toBe(true);
            expect(c.has('d')).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('getCacheKey includes method, url and data', () => {
        const c = createCacheStore();
        const k1 = c.getCacheKey('GET', 'http://x', null);
        const k2 = c.getCacheKey('GET', 'http://x', { a: 1 });
        expect(k1).not.toBe(k2);
        expect(k1).toContain('http://x');
    });
});