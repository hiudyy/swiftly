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
            c.get('a');
            vi.advanceTimersByTime(10);
            c.set('d', 4);
            expect(c.has('b')).toBe(false);
            expect(c.has('a')).toBe(true);
            expect(c.has('c')).toBe(true);
            expect(c.has('d')).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
    it('cleanup drops expired entries before evicting by LRU', () => {
        vi.useFakeTimers();
        try {
            const c = createCacheStore({ maxSize: 2, ttl: 100 });
            c.set('a', 1);
            vi.advanceTimersByTime(10);
            c.set('b', 2);
            vi.advanceTimersByTime(200); // b now expired
            c.set('c', 3); // triggers cleanup: a and b expired removed, no LRU eviction needed
            expect(c.has('b')).toBe(false);
            expect(c.has('a')).toBe(false);
            expect(c.has('c')).toBe(true);
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
        expect(k1).toContain('GET');
    });
    it('getCacheKey ignores query when configured', () => {
        const c = createCacheStore();
        const k1 = c.getCacheKey('GET', 'http://x?a=1', null, { ignoreQuery: true });
        const k2 = c.getCacheKey('GET', 'http://x?a=2', null, { ignoreQuery: true });
        expect(k1).toBe(k2);
    });
    it('getCacheKey uses a custom keyBuilder', () => {
        const c = createCacheStore();
        const k = c.getCacheKey('GET', 'http://x', null, { keyBuilder: () => 'custom' });
        expect(k).toBe('custom');
    });
    it('peek returns stale flag', () => {
        vi.useFakeTimers();
        try {
            const c = createCacheStore({ ttl: 100 });
            c.set('k', 'v');
            vi.advanceTimersByTime(150);
            const p = c.peek('k');
            expect(p.value).toBe('v');
            expect(p.stale).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
    it('getStats reports sizes', () => {
        const c = createCacheStore({ maxSize: 10 });
        c.set('a', 1);
        c.set('b', 2);
        const stats = c.getStats();
        expect(stats.size).toBe(2);
        expect(stats.maxSize).toBe(10);
        expect(stats.validItems).toBe(2);
    });
    it('supports a custom pluggable storage', () => {
        const backing = new Map();
        const custom = {
            get: (k) => (backing.has(k) ? backing.get(k) : null),
            set: (k, v) => backing.set(k, v),
            delete: (k) => backing.delete(k),
            clear: () => backing.clear()
        };
        const c = createCacheStore({ storage: custom });
        c.set('k', 'v');
        expect(c.get('k')).toBe('v');
        expect(backing.has('k')).toBe(true);
        c.delete('k');
        expect(c.get('k')).toBeNull();
        c.clear();
        expect(backing.size).toBe(0);
    });
});
