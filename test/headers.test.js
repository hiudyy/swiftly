import { describe, it, expect } from 'vitest';
import { generateHeaders } from '../lib/headers.js';

describe('headers.generateHeaders', () => {
    it('produces stable, deterministic defaults', () => {
        const h1 = generateHeaders();
        const h2 = generateHeaders();
        expect(h1['User-Agent']).toBe(h2['User-Agent']);
        expect(h1['Accept-Language']).toBe(h2['Accept-Language']);
        expect(h1['Accept']).toContain('text/html');
        expect(h1['Accept-Encoding']).toBe('gzip, deflate, br');
    });
    it('uses the default User-Agent constant when none provided', () => {
        const h = generateHeaders();
        expect(h['User-Agent']).toBe('Swiftly/1.0 (+https://github.com/cognima/swiftly)');
    });
    it('honors a custom userAgent', () => {
        const h = generateHeaders({ userAgent: 'MyAgent/2.0' });
        expect(h['User-Agent']).toBe('MyAgent/2.0');
    });
    it('merges custom headers last (overriding defaults)', () => {
        const h = generateHeaders({ headers: { 'X-Custom': '1', 'Accept': 'application/json' } });
        expect(h['X-Custom']).toBe('1');
        expect(h['Accept']).toBe('application/json');
    });
    it('randomizes UA and Accept-Language when explicitly enabled', () => {
        const samples = new Set();
        for (let i = 0; i < 30; i++) {
            const h = generateHeaders({ randomizeHeaders: true });
            samples.add(h['User-Agent'] + '|' + h['Accept-Language']);
        }
        expect(samples.size).toBeGreaterThan(1);
    });
});
