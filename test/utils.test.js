import { describe, it, expect } from 'vitest';
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

describe('utils', () => {
    it('detectResponseType', () => {
        expect(detectResponseType('application/json; charset=utf-8')).toBe('json');
        expect(detectResponseType('text/html')).toBe('html');
        expect(detectResponseType('text/plain')).toBe('text');
        expect(detectResponseType('application/octet-stream')).toBe('buffer');
        expect(detectResponseType('')).toBe('buffer');
    });

    it('buildQueryString', () => {
        expect(buildQueryString({ a: '1', b: 'two' })).toBe('a=1&b=two');
    });

    it('isValidUrl', () => {
        expect(isValidUrl('https://example.com')).toBe(true);
        expect(isValidUrl('not a url')).toBe(false);
    });

    it('deepMerge handles nested plain objects but replaces arrays', () => {
        const target = { a: { x: 1, y: 2 }, list: [1, 2], s: 'old' };
        const source = { a: { y: 99 }, list: [3], s: 'new' };
        const out = deepMerge(target, source);
        expect(out.a.x).toBe(1);
        expect(out.a.y).toBe(99);
        expect(out.list).toEqual([3]);
        expect(out.s).toBe('new');
        // does not mutate target
        expect(target.a.y).toBe(2);
    });

    it('deepMerge returns target for non-object sources', () => {
        expect(deepMerge({ a: 1 }, null)).toEqual({ a: 1 });
    });

    it('parseUrl', () => {
        const p = parseUrl('https://example.com/a/b?x=1#frag');
        expect(p.hostname).toBe('example.com');
        expect(p.pathname).toBe('/a/b');
        expect(p.params).toEqual({ x: '1' });
        expect(parseUrl('bad')).toBeNull();
    });

    it('formatBytes and formatDuration', () => {
        expect(formatBytes(0)).toBe('0 Bytes');
        expect(formatBytes(1024)).toContain('KB');
        expect(formatDuration(500)).toBe('500ms');
        expect(formatDuration(1500)).toContain('s');
    });

    it('generateId is unique', () => {
        expect(generateId()).not.toBe(generateId());
    });

    it('retryWithBackoff retries and throws last error', async () => {
        let calls = 0;
        await expect(retryWithBackoff(() => { calls++; throw new Error('nope'); }, 3, 1)).rejects.toThrow('nope');
        expect(calls).toBe(3);
    });

    it('withTimeout rejects on timeout', async () => {
        await expect(withTimeout(delay(200), 10)).rejects.toThrow('Operation timed out');
    });

    it('safeJsonParse', () => {
        expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
        expect(safeJsonParse('bad', 'fallback')).toBe('fallback');
    });

    it('chunk', () => {
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });
});