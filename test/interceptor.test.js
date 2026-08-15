import { describe, it, expect, vi } from 'vitest';
import { createInterceptorManager, createCookieJar } from '../lib/interceptor.js';

describe('interceptor manager', () => {
    it('runs request chain in order', async () => {
        const im = createInterceptorManager();
        const order = [];
        im.use((cfg) => { order.push(1); cfg.a = 1; return cfg; });
        im.use((cfg) => { order.push(2); cfg.b = 2; return cfg; });
        const out = await im.executeRequestChain({});
        expect(order).toEqual([1, 2]);
        expect(out).toEqual({ a: 1, b: 2 });
    });

    it('eject removes an interceptor', async () => {
        const im = createInterceptorManager();
        const id = im.use((cfg) => { cfg.kept = true; return cfg; });
        im.use((cfg) => { cfg.removed = true; return cfg; });
        im.eject(id);
        const out = await im.executeRequestChain({});
        expect(out.kept).toBeUndefined();
        expect(out.removed).toBe(true);
    });

    it('clear removes all interceptors', async () => {
        const im = createInterceptorManager();
        im.use((cfg) => { cfg.x = 1; return cfg; });
        im.clear();
        expect(await im.executeRequestChain({})).toEqual({});
    });

    it('runs response chain', async () => {
        const im = createInterceptorManager();
        im.use((res) => ({ ...res, transformed: true }));
        expect(await im.executeResponseChain({ raw: true })).toEqual({ raw: true, transformed: true });
    });
});

describe('cookie jar', () => {
    it('sets and gets cookies per domain', () => {
        const jar = createCookieJar();
        jar.setCookie('x.com', 'session=abc123; Path=/');
        expect(jar.getCookies('x.com')).toBe('session=abc123');
        expect(jar.getCookies('other.com')).toBe('');
    });

    it('supports value with equals sign', () => {
        const jar = createCookieJar();
        jar.setCookie('x.com', 'token=a=b=c; Path=/');
        expect(jar.getCookies('x.com')).toBe('token=a=b=c');
    });

    it('expires cookies', () => {
        vi.useFakeTimers();
        try {
            const jar = createCookieJar();
            jar.setCookie('x.com', 'a=1; Expires=Wed, 21 Oct 2015 07:28:00 GMT');
            expect(jar.getCookies('x.com')).toBe('');
        } finally {
            vi.useRealTimers();
        }
    });
});