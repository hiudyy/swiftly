import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    detectResponseType,
    delay,
    buildQueryString,
    isValidUrl,
    deepMerge,
    parseUrl,
    formatBytes,
    formatDuration,
    generateId,
    retryWithBackoff,
    withTimeout,
    safeJsonParse,
    chunk
} from '../lib/utils.js';

describe('utils.detectResponseType', () => {
    it('detects json', () => {
        expect(detectResponseType('application/json')).toBe('json');
        expect(detectResponseType('application/json; charset=utf-8')).toBe('json');
    });
    it('detects html', () => {
        expect(detectResponseType('text/html')).toBe('html');
        expect(detectResponseType('TEXT/HTML')).toBe('html');
    });
    it('detects text', () => {
        expect(detectResponseType('text/plain')).toBe('text');
        expect(detectResponseType('text/csv')).toBe('text');
    });
    it('defaults to buffer', () => {
        expect(detectResponseType('image/png')).toBe('buffer');
        expect(detectResponseType('application/octet-stream')).toBe('buffer');
    });
    it('handles empty / non-string input', () => {
        expect(detectResponseType('')).toBe('buffer');
        expect(detectResponseType(undefined)).toBe('buffer');
        expect(detectResponseType(null)).toBe('buffer');
    });
});

describe('utils.delay', () => {
    it('resolves after ms', async () => {
        const start = Date.now();
        await delay(20);
        expect(Date.now() - start).toBeGreaterThanOrEqual(15);
    });
    it('resolves immediately when signal not provided', async () => {
        await expect(delay(1)).resolves.toBeUndefined();
    });
    it('rejects when signal already aborted', async () => {
        const ac = new AbortController();
        ac.abort();
        await expect(delay(1000, ac.signal)).rejects.toThrow('Aborted');
    });
    it('rejects when signal aborts during wait', async () => {
        const ac = new AbortController();
        const p = delay(1000, ac.signal);
        setTimeout(() => ac.abort(), 10);
        await expect(p).rejects.toThrow('Aborted');
    });
});

describe('utils.buildQueryString', () => {
    it('stringifies an object', () => {
        expect(buildQueryString({ a: 1, b: 'x y' })).toBe('a=1&b=x%20y');
    });
    it('handles numbers and multiple keys', () => {
        expect(buildQueryString({ page: 2, size: 10 })).toBe('page=2&size=10');
    });
    it('returns empty string for empty object', () => {
        expect(buildQueryString({})).toBe('');
    });
});

describe('utils.isValidUrl', () => {
    it('accepts absolute URLs', () => {
        expect(isValidUrl('https://example.com')).toBe(true);
        expect(isValidUrl('http://localhost:3000/path?q=1')).toBe(true);
    });
    it('rejects relative / invalid URLs', () => {
        expect(isValidUrl('/relative/path')).toBe(false);
        expect(isValidUrl('not a url')).toBe(false);
        expect(isValidUrl('')).toBe(false);
    });
    it('rejects non-strings gracefully', () => {
        expect(isValidUrl(null)).toBe(false);
        expect(isValidUrl(undefined)).toBe(false);
    });
});

describe('utils.deepMerge', () => {
    it('merges nested plain objects', () => {
        const a = { x: 1, nested: { a: 1, b: 2 } };
        const b = { nested: { b: 3, c: 4 } };
        expect(deepMerge(a, b)).toEqual({ x: 1, nested: { a: 1, b: 3, c: 4 } });
    });
    it('replaces arrays instead of merging', () => {
        expect(deepMerge({ a: [1, 2, 3] }, { a: [4] })).toEqual({ a: [4] });
    });
    it('returns target when source is not an object', () => {
        expect(deepMerge({ a: 1 }, null)).toEqual({ a: 1 });
        expect(deepMerge({ a: 1 }, undefined)).toEqual({ a: 1 });
        expect(deepMerge({ a: 1 }, 5)).toEqual({ a: 1 });
    });
    it('replaces target value when source value is an array', () => {
        expect(deepMerge({ a: { b: 1 } }, { a: [1, 2] })).toEqual({ a: [1, 2] });
    });
    it('overwrites primitives', () => {
        expect(deepMerge({ a: 1, b: 2 }, { a: 9 })).toEqual({ a: 9, b: 2 });
    });
    it('does not mutate the source', () => {
        const src = { nested: { a: 1 } };
        const out = deepMerge({ nested: { b: 2 } }, src);
        src.nested.a = 99;
        expect(out.nested.a).toBe(1);
    });
});

describe('utils.parseUrl', () => {
    it('parses protocol/hostname/port/pathname', () => {
        const u = parseUrl('https://example.com:8080/a/b?x=1#frag');
        expect(u.protocol).toBe('https:');
        expect(u.hostname).toBe('example.com');
        expect(u.port).toBe('8080');
        expect(u.pathname).toBe('/a/b');
    });
    it('parses query params into an object', () => {
        expect(parseUrl('http://x.com/?a=1&b=two').params).toEqual({ a: '1', b: 'two' });
    });
    it('exposes search and hash', () => {
        const u = parseUrl('http://x.com/p?a=1#h');
        expect(u.search).toBe('?a=1');
        expect(u.hash).toBe('#h');
    });
    it('returns null on invalid URL', () => {
        expect(parseUrl('not a url')).toBeNull();
        expect(parseUrl('')).toBeNull();
    });
});

describe('utils.formatBytes', () => {
    it('handles zero', () => {
        expect(formatBytes(0)).toBe('0 Bytes');
    });
    it('formats bytes', () => {
        expect(formatBytes(512)).toBe('512 Bytes');
    });
    it('formats KB', () => {
        expect(formatBytes(1024)).toBe('1 KB');
    });
    it('formats MB and GB', () => {
        expect(formatBytes(1024 * 1024 * 5)).toBe('5 MB');
        expect(formatBytes(1024 * 1024 * 1024 * 2)).toBe('2 GB');
    });
    it('respects decimals argument', () => {
        expect(formatBytes(1536, 1)).toBe('1.5 KB');
    });
    it('formats TB for very large values', () => {
        expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1 TB');
    });
});

describe('utils.formatDuration', () => {
    it('formats milliseconds', () => {
        expect(formatDuration(500)).toBe('500ms');
    });
    it('formats seconds', () => {
        expect(formatDuration(1500)).toBe('1.50s');
    });
    it('formats minutes', () => {
        expect(formatDuration(120000)).toBe('2.00m');
    });
});

describe('utils.generateId', () => {
    it('produces a non-empty string', () => {
        expect(typeof generateId()).toBe('string');
        expect(generateId().length).toBeGreaterThan(0);
    });
    it('produces unique values', () => {
        const ids = new Set(Array.from({ length: 100 }, () => generateId()));
        expect(ids.size).toBe(100);
    });
});

describe('utils.retryWithBackoff', () => {
    it('returns the value on first success', async () => {
        await expect(retryWithBackoff(async () => 42)).resolves.toBe(42);
    });
    it('retries until success', async () => {
        let n = 0;
        const r = await retryWithBackoff(async () => {
            n++;
            if (n < 3) throw new Error('fail');
            return 'ok';
        }, 5, 1);
        expect(r).toBe('ok');
        expect(n).toBe(3);
    });
    it('throws the last error after exhausting retries', async () => {
        let n = 0;
        await expect(retryWithBackoff(async () => {
            n++;
            throw new Error('always');
        }, 2, 1)).rejects.toThrow('always');
        expect(n).toBe(2);
    });
});

describe('utils.withTimeout', () => {
    it('resolves when the promise resolves first', async () => {
        await expect(withTimeout(Promise.resolve('done'), 100)).resolves.toBe('done');
    });
    it('rejects when the timer fires first', async () => {
        const p = new Promise((resolve) => setTimeout(resolve, 100));
        await expect(withTimeout(p, 10)).rejects.toThrow('timed out');
    });
    it('uses a custom message', async () => {
        const p = new Promise((resolve) => setTimeout(resolve, 100));
        await expect(withTimeout(p, 10, 'custom')).rejects.toThrow('custom');
    });
});

describe('utils.safeJsonParse', () => {
    it('parses valid JSON', () => {
        expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
    });
    it('returns fallback for invalid JSON', () => {
        expect(safeJsonParse('not json')).toBeNull();
        expect(safeJsonParse('not json', { def: true })).toEqual({ def: true });
    });
    it('parses arrays and primitives', () => {
        expect(safeJsonParse('[1,2,3]')).toEqual([1, 2, 3]);
        expect(safeJsonParse('"str"')).toBe('str');
    });
});

describe('utils.chunk', () => {
    it('splits an array into chunks', () => {
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });
    it('returns an empty array for empty input', () => {
        expect(chunk([], 3)).toEqual([]);
    });
    it('returns whole array when size is larger', () => {
        expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
    });
    it('handles exact division', () => {
        expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
    });
});
