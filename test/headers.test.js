import { describe, it, expect } from 'vitest';
import { generateHeaders } from '../lib/headers.js';

describe('generateHeaders', () => {
    it('produces stable, deterministic defaults', () => {
        const a = generateHeaders();
        const b = generateHeaders();
        expect(a).toEqual(b);
        expect(a['User-Agent']).toContain('Swiftly');
        expect(a['Accept-Encoding']).toBe('gzip, deflate, br');
        // no invalid keep-alive / connection header
        expect(a['Connection']).toBeUndefined();
    });

    it('merges custom headers', () => {
        const h = generateHeaders({ headers: { 'X-Custom': '1', 'User-Agent': 'CustomAgent' } });
        expect(h['X-Custom']).toBe('1');
        expect(h['User-Agent']).toBe('CustomAgent');
    });

    it('randomizes when explicitly enabled', () => {
        const seen = new Set();
        for (let i = 0; i < 20; i++) seen.add(generateHeaders({ randomizeHeaders: true })['User-Agent']);
        expect(seen.size).toBeGreaterThan(1);
    });
});