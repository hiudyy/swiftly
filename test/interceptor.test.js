import { describe, it, expect } from 'vitest';
import {
    createInterceptorManager,
    createCookieJar,
    InterceptorManager,
    CookieJar
} from '../lib/interceptor.js';

describe('InterceptorManager', () => {
    it('runs request chain in order', async () => {
        const m = createInterceptorManager();
        const order = [];
        m.use((c) => { order.push(1); return c; });
        m.use((c) => { order.push(2); return c; });
        await m.executeRequestChain({});
        expect(order).toEqual([1, 2]);
    });
    it('mutates config through the chain', async () => {
        const m = createInterceptorManager();
        m.use((c) => ({ ...c, a: 1 }));
        m.use((c) => ({ ...c, b: 2 }));
        const out = await m.executeRequestChain({});
        expect(out).toEqual({ a: 1, b: 2 });
    });
    it('eject removes an interceptor', async () => {
        const m = createInterceptorManager();
        const id = m.use(() => {});
        m.eject(id);
        expect(m.handlers[id]).toBeNull();
    });
    it('clear removes all interceptors', async () => {
        const m = createInterceptorManager();
        m.use(() => {});
        m.use(() => {});
        m.clear();
        expect(m.handlers.length).toBe(0);
    });
    it('runs response chain', async () => {
        const m = createInterceptorManager();
        m.use((r) => ({ ...r, ok: true }));
        const out = await m.executeResponseChain({});
        expect(out.ok).toBe(true);
    });
    it('recovers via rejected handler when fulfilled throws', async () => {
        const m = createInterceptorManager();
        m.use(
            () => { throw new Error('boom'); },
            (err) => ({ recovered: err.message })
        );
        const out = await m.executeRequestChain({});
        expect(out.recovered).toBe('boom');
    });
    it('rethrows when no rejected handler', async () => {
        const m = createInterceptorManager();
        m.use(() => { throw new Error('boom'); });
        await expect(m.executeRequestChain({})).rejects.toThrow('boom');
    });
    it('executeResponseErrorChain returns the recovered value', async () => {
        const m = createInterceptorManager();
        m.use(null, () => ({ recovered: true }));
        const out = await m.executeResponseErrorChain(new Error('x'));
        expect(out).toEqual({ recovered: true });
    });
    it('executeResponseErrorChain rethrows when handlers return undefined', async () => {
        const m = createInterceptorManager();
        m.use(null, () => undefined);
        await expect(m.executeResponseErrorChain(new Error('x'))).rejects.toThrow('x');
    });
});

describe('CookieJar', () => {
    it('sets and gets cookies per domain', () => {
        const jar = createCookieJar();
        jar.setCookie('example.com', { name: 'a', value: '1' });
        expect(jar.getCookies('example.com')).toBe('a=1');
    });
    it('sets a cookie from a raw Set-Cookie header', () => {
        const jar = createCookieJar();
        jar.setCookie('example.com', 'sid=abc; Path=/; HttpOnly');
        expect(jar.getCookies('example.com')).toBe('sid=abc');
    });
    it('supports values containing equals signs', () => {
        const jar = createCookieJar();
        jar.setCookie('example.com', 'token=a=b=c');
        expect(jar.getCookies('example.com')).toBe('token=a=b=c');
    });
    it('returns name/value from getCookiesMap', () => {
        const jar = createCookieJar();
        jar.setCookie('example.com', { name: 'a', value: '1' });
        expect(jar.getCookiesMap('example.com')).toEqual(
            expect.arrayContaining([expect.objectContaining({ name: 'a', value: '1' })])
        );
    });
    it('parses HttpOnly, Secure and SameSite from raw headers', () => {
        const jar = createCookieJar();
        jar.setCookie('example.com', 'sid=abc; Path=/; HttpOnly; Secure; SameSite=Strict');
        const c = jar.getCookiesMap('example.com')[0];
        expect(c.httpOnly).toBe(true);
        expect(c.secure).toBe(true);
        expect(c.sameSite).toBe('Strict');
    });
    it('stores expiry and clears expired cookies', () => {
        const jar = createCookieJar();
        const past = new Date(Date.now() - 1000);
        jar.setCookie('example.com', { name: 'old', value: '1', expires: past });
        jar.setCookie('example.com', { name: 'new', value: '2' });
        expect(jar.getCookies('example.com')).toBe('new=2');
    });
    it('resolves domain from a URL', () => {
        const jar = createCookieJar();
        jar.setCookie('https://example.com/path', { name: 'a', value: '1' });
        expect(jar.getCookies('example.com')).toBe('a=1');
        expect(jar.getCookies('https://example.com/other')).toBe('a=1');
    });
    it('returns empty string for an empty jar (fast path)', () => {
        const jar = createCookieJar();
        expect(jar.getCookies('example.com')).toBe('');
    });
    it('clearCookies removes a single domain', () => {
        const jar = createCookieJar();
        jar.setCookie('a.com', { name: 'x', value: '1' });
        jar.setCookie('b.com', { name: 'y', value: '2' });
        jar.clearCookies('a.com');
        expect(jar.getCookies('a.com')).toBe('');
        expect(jar.getCookies('b.com')).toBe('y=2');
    });
    it('clearCookies without arg clears everything', () => {
        const jar = createCookieJar();
        jar.setCookie('a.com', { name: 'x', value: '1' });
        jar.clearCookies();
        expect(jar.getCookies('a.com')).toBe('');
    });
    it('toJSON / fromJSON round-trips', () => {
        const jar = createCookieJar();
        jar.setCookie('example.com', { name: 'a', value: '1', httpOnly: true });
        const json = jar.toJSON();
        const jar2 = createCookieJar();
        jar2.fromJSON(json);
        expect(jar2.getCookies('example.com')).toBe('a=1');
    });
    it('throws when domain is empty', () => {
        const jar = createCookieJar();
        expect(() => jar.setCookie('', { name: 'a', value: '1' })).toThrow();
    });
    it('throws when cookie name is empty (object form)', () => {
        const jar = createCookieJar();
        expect(() => jar.setCookie('example.com', { name: '', value: '1' })).toThrow();
    });
    it('ignores invalid raw cookie headers silently', () => {
        const jar = createCookieJar();
        expect(() => jar.setCookie('example.com', '=value')).not.toThrow();
        expect(jar.getCookies('example.com')).toBe('');
    });
    it('shares a Domain cookie across subdomains', () => {
        const jar = createCookieJar();
        jar.setCookie('api.example.com', 'sid=abc; Domain=example.com; Path=/');
        // stored under the domain attribute, matched by subdomain
        expect(jar.getCookies('https://api.example.com/')).toBe('sid=abc');
        expect(jar.getCookies('https://www.example.com/')).toBe('sid=abc');
        // not leaked to an unrelated domain
        expect(jar.getCookies('https://otherexample.com/')).toBe('');
        expect(jar.getCookies('https://xexample.com/')).toBe('');
    });
    it('host-only cookie is NOT sent to subdomains', () => {
        const jar = createCookieJar();
        jar.setCookie('api.example.com', 'sid=abc; Path=/');
        expect(jar.getCookies('https://api.example.com/')).toBe('sid=abc');
        expect(jar.getCookies('https://www.example.com/')).toBe('');
    });
    it('respects Path', () => {
        const jar = createCookieJar();
        jar.setCookie('example.com', 'sid=abc; Path=/admin');
        expect(jar.getCookies('https://example.com/admin')).toBe('sid=abc');
        expect(jar.getCookies('https://example.com/public')).toBe('');
    });
    it('omits Secure cookies on non-HTTPS requests', () => {
        const jar = createCookieJar();
        jar.setCookie('example.com', 'sid=abc; Secure; Path=/');
        expect(jar.getCookies('https://example.com/')).toBe('sid=abc');
        expect(jar.getCookies('http://example.com/')).toBe('');
    });
});
