import { describe, it, expect } from 'vitest';
import swiftly from '../index.mjs';

describe('swiftly main export', () => {
    it('is a factory function', () => {
        expect(typeof swiftly).toBe('function');
    });

    it('exposes the full static API', () => {
        for (const m of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'query', 'subscribe', 'scrape', 'batch', 'download', 'on', 'off', 'clearCache', 'getMetrics']) {
            expect(typeof swiftly[m]).toBe('function');
        }
    });

    it('exposes events and shared client accessor', () => {
        expect(swiftly.events).toBeTruthy();
        expect(typeof swiftly.client).toBe('function');
    });

    it('static calls share a singleton default client', () => {
        expect(swiftly.client()).toBe(swiftly.client());
    });

    it('creates independent instances via the factory', () => {
        const a = swiftly();
        const b = swiftly();
        expect(a).not.toBe(b);
        for (const m of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'query', 'subscribe', 'scrape', 'batch', 'download', 'on', 'off', 'clearCache', 'getMetrics']) {
            expect(typeof a[m]).toBe('function');
        }
    });
});