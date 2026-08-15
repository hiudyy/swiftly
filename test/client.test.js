import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createClient } from '../lib/client.js';
import { startServer } from './helpers/server.js';
import {
    ResponseError,
    TimeoutError,
    CircuitBreakerError,
    AbortError,
    RequestError
} from '../lib/errors.js';

let srv;

beforeAll(async () => {
    srv = await startServer();
});

afterAll(async () => {
    await srv.close();
});

// client factory with caching OFF by default to keep tests independent
const mk = (cfg = {}) => createClient({ debug: false, cache: { enabled: false }, ...cfg });

describe('client HTTP methods', () => {
    it('GET returns parsed JSON body', async () => {
        const body = await mk().get(`${srv.url}/json?q=1`);
        expect(body.ok).toBe(true);
        expect(body.query.q).toBe('1');
    });
    it('POST sends and echoes a JSON body', async () => {
        const body = await mk().post(`${srv.url}/echo`, { hello: 'world' });
        expect(body.method).toBe('POST');
        expect(JSON.parse(body.body).hello).toBe('world');
    });
    it('PUT sends a body', async () => {
        const body = await mk().put(`${srv.url}/echo`, { a: 1 });
        expect(body.method).toBe('PUT');
        expect(JSON.parse(body.body).a).toBe(1);
    });
    it('PATCH sends a body', async () => {
        const body = await mk().patch(`${srv.url}/echo`, { a: 2 });
        expect(body.method).toBe('PATCH');
        expect(JSON.parse(body.body).a).toBe(2);
    });
    it('DELETE works', async () => {
        const body = await mk().delete(`${srv.url}/method`);
        expect(body.method).toBe('DELETE');
    });
    it('HEAD returns response headers', async () => {
        const headers = await mk().head(`${srv.url}/json`);
        expect(typeof headers).toBe('object');
        expect(headers['content-type']).toContain('application/json');
    });
    it('OPTIONS returns response headers', async () => {
        const headers = await mk().options(`${srv.url}/json`);
        expect(typeof headers).toBe('object');
    });
    it('returns text for text content', async () => {
        const body = await mk().get(`${srv.url}/text`, { responseType: 'text' });
        expect(body).toBe('hello world');
    });
    it('returns html for html content', async () => {
        const body = await mk().get(`${srv.url}/html`, { responseType: 'html' });
        expect(body).toContain('<h1>Hi</h1>');
    });
    it('returns a Buffer for buffer responseType', async () => {
        const buf = await mk().get(`${srv.url}/json`, { responseType: 'buffer' });
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect(JSON.parse(buf.toString()).ok).toBe(true);
    });
    it('raw responseType exposes status/headers/data', async () => {
        const res = await mk().get(`${srv.url}/json`, { responseType: 'raw' });
        expect(res.status).toBe(200);
        expect(res.data.ok).toBe(true);
        expect(res.headers['content-type']).toContain('application/json');
    });
});

describe('client query params, baseURL and headers', () => {
    it('builds query string from params', async () => {
        const body = await mk().get(`${srv.url}/json`, { params: { q: 'hello', n: 5 } });
        expect(body.query.q).toBe('hello');
        expect(body.query.n).toBe('5');
    });
    it('uses baseURL for relative paths', async () => {
        const body = await mk({ baseURL: srv.url }).get('/json');
        expect(body.ok).toBe(true);
    });
    it('treats a path starting with "http" (no scheme) as relative under baseURL', async () => {
        const c = mk({ baseURL: srv.url });
        // Before the fix this failed with "Invalid URL" because the path
        // looked like an absolute URL; now it resolves against baseURL and
        // reaches the server (404 here, not a URL parsing error).
        await expect(c.get('httpProxy/data')).rejects.toThrow('HTTP Error 404');
    });
    it('sends custom headers', async () => {
        const body = await mk().get(`${srv.url}/headers`, { headers: { 'X-Test': 'yes' } });
        expect(body.headers['x-test']).toBe('yes');
    });
    it('sends a custom userAgent', async () => {
        const body = await mk({ userAgent: 'CustomUA/1' }).get(`${srv.url}/headers`);
        expect(body.headers['user-agent']).toBe('CustomUA/1');
    });
});

describe('client auth', () => {
    it('sends Basic auth', async () => {
        const body = await mk({ auth: { username: 'user', password: 'pass' } }).get(`${srv.url}/auth`);
        expect(body.ok).toBe(true);
    });
    it('fails Basic auth with wrong credentials', async () => {
        await expect(
            mk({ auth: { username: 'user', password: 'wrong' } }).get(`${srv.url}/auth`)
        ).rejects.toBeInstanceOf(ResponseError);
    });
    it('sends Bearer token', async () => {
        const body = await mk({ bearer: 'secrettoken' }).get(`${srv.url}/headers`);
        expect(body.headers['authorization']).toBe('Bearer secrettoken');
    });
    it('sends raw token', async () => {
        const body = await mk({ token: 'rawtoken' }).get(`${srv.url}/headers`);
        expect(body.headers['authorization']).toBe('rawtoken');
    });
});

describe('client decompression', () => {
    it('decompresses gzip', async () => {
        const body = await mk().get(`${srv.url}/gzip`);
        expect(body.compressed).toBe(true);
        expect(body.data.length).toBe(2048);
    });
    it('decompresses deflate', async () => {
        const body = await mk().get(`${srv.url}/deflate`);
        expect(body.compressed).toBe('deflate');
        expect(body.data.length).toBe(2048);
    });
    it('decompresses brotli', async () => {
        const body = await mk().get(`${srv.url}/br`);
        expect(body.compressed).toBe('br');
        expect(body.data.length).toBe(2048);
    });
});

describe('client redirects', () => {
    it('follows a single redirect', async () => {
        const body = await mk().get(`${srv.url}/redirect`);
        expect(body.ok).toBe(true);
    });
    it('follows a redirect chain', async () => {
        const body = await mk().get(`${srv.url}/r1`);
        expect(body.ok).toBe(true);
    });
    it('does not follow redirects when disabled (raw status)', async () => {
        const res = await mk().get(`${srv.url}/redirect`, { followRedirects: false, responseType: 'raw' });
        expect(res.status).toBe(302);
    });
    it('throws on redirect loop exceeding maxRedirects', async () => {
        await expect(mk({ maxRedirects: 3 }).get(`${srv.url}/redirect-loop`))
            .rejects.toThrow('redirects exceeded');
    });
});

describe('client retries', () => {
    it('does not retry 4xx client errors', async () => {
        const c = mk({ retries: 5, retryDelay: 1 });
        await expect(c.get(`${srv.url}/client400`)).rejects.toBeInstanceOf(ResponseError);
        expect(c.getMetrics().retries).toBe(0);
    });
    it('retries 5xx and then throws', async () => {
        const c = mk({ retries: 2, retryDelay: 1 });
        await expect(c.get(`${srv.url}/error500`)).rejects.toBeInstanceOf(ResponseError);
        expect(c.getMetrics().retries).toBeGreaterThanOrEqual(1);
    });
    it('retries on 429 by default', async () => {
        const c = mk({ retries: 2, retryDelay: 1 });
        await expect(c.get(`${srv.url}/status/429`)).rejects.toBeInstanceOf(ResponseError);
        expect(c.getMetrics().retries).toBeGreaterThanOrEqual(1);
    });
    it('honors explicit retryOn status codes', async () => {
        const c = mk({ retries: 1, retryDelay: 1, retryOn: [500] });
        await expect(c.get(`${srv.url}/error500`)).rejects.toBeInstanceOf(ResponseError);
        expect(c.getMetrics().retries).toBeGreaterThanOrEqual(1);
    });
    it('does not retry when retryOn excludes the status', async () => {
        const c = mk({ retries: 3, retryDelay: 1, retryOn: [502] });
        await expect(c.get(`${srv.url}/error500`)).rejects.toBeInstanceOf(ResponseError);
        expect(c.getMetrics().retries).toBe(0);
    });
    it('supports a custom retryOn predicate', async () => {
        const c = mk({ retries: 1, retryDelay: 1, retryOn: (e) => e.response && e.response.status === 500 });
        await expect(c.get(`${srv.url}/error500`)).rejects.toBeInstanceOf(ResponseError);
        expect(c.getMetrics().retries).toBeGreaterThanOrEqual(1);
    });
    it('invokes onRetry callback', async () => {
        const onRetry = vi.fn();
        const c = mk({ retries: 2, retryDelay: 1, onRetry });
        await expect(c.get(`${srv.url}/error500`)).rejects.toBeInstanceOf(ResponseError);
        expect(onRetry).toHaveBeenCalled();
    });
});

describe('client circuit breaker', () => {
    // A closed port forces connection failures (the only failures the breaker counts).
    const DEAD = 'http://127.0.0.1:1';
    it('opens after the failure threshold and rejects subsequent requests', async () => {
        const c = mk({ retries: 1, circuitBreaker: { enabled: true, failureThreshold: 3, resetTimeout: 60000 } });
        for (let i = 0; i < 3; i++) {
            await expect(c.get(DEAD)).rejects.toThrow();
        }
        const state = c.getMetrics().circuitBreakers.find(x => x.domain === '127.0.0.1');
        expect(state.state.state).toBe('OPEN');
        await expect(c.get(`${srv.url}/json`)).rejects.toBeInstanceOf(CircuitBreakerError);
    });
    it('resetCircuitBreakers closes the breaker', async () => {
        const c = mk({ retries: 1, circuitBreaker: { enabled: true, failureThreshold: 2, resetTimeout: 60000 } });
        for (let i = 0; i < 2; i++) {
            await expect(c.get(DEAD)).rejects.toThrow();
        }
        c.resetCircuitBreakers('127.0.0.1');
        const body = await c.get(`${srv.url}/json`);
        expect(body.ok).toBe(true);
    });
    it('opens after repeated 5xx server errors', async () => {
        const c = mk({ retries: 1, circuitBreaker: { enabled: true, failureThreshold: 3, resetTimeout: 60000 } });
        for (let i = 0; i < 3; i++) {
            await expect(c.get(`${srv.url}/error500`)).rejects.toThrow();
        }
        const state = c.getMetrics().circuitBreakers.find(x => x.domain === '127.0.0.1');
        expect(state.state.state).toBe('OPEN');
        await expect(c.get(`${srv.url}/json`)).rejects.toBeInstanceOf(CircuitBreakerError);
    });
    it('allows only a single probe request in HALF-OPEN', async () => {
        const c = mk({ retries: 1, retryDelay: 1, circuitBreaker: { enabled: true, failureThreshold: 1, resetTimeout: 1 } });
        await expect(c.get(DEAD)).rejects.toThrow();
        await new Promise((r) => setTimeout(r, 5));
        // deduplicate: false so each request actually reaches the breaker
        // (identical GETs would otherwise share a single deduped promise).
        const results = await Promise.allSettled(Array.from({ length: 6 }, () => c.get(`${srv.url}/json`, { deduplicate: false })));
        const ok = results.filter(r => r.status === 'fulfilled');
        const rejected = results.filter(r => r.status === 'rejected');
        // Exactly one trial passes; the concurrent burst fails fast.
        expect(ok.length).toBe(1);
        expect(ok[0].value.ok).toBe(true);
        expect(rejected.length).toBe(5);
        for (const r of rejected) {
            expect(r.reason).toBeInstanceOf(CircuitBreakerError);
        }
    });
});

describe('client cache', () => {
    it('caches GET responses and reports hit/miss', async () => {
        const c = mk({ cache: { enabled: true, ttl: 5000 } });
        await c.get(`${srv.url}/json`);
        const m1 = c.getMetrics().cacheMisses;
        await c.get(`${srv.url}/json`);
        const m2 = c.getMetrics().cacheHits;
        expect(m1).toBeGreaterThanOrEqual(1);
        expect(m2).toBeGreaterThanOrEqual(1);
    });
    it('clearCache empties the cache', async () => {
        const c = mk({ cache: { enabled: true, ttl: 5000 } });
        await c.get(`${srv.url}/json`);
        c.clearCache();
        expect(c.getMetrics().cacheSize).toBe(0);
    });
    it('does not cache when disabled', async () => {
        const c = mk({ cache: { enabled: false } });
        await c.get(`${srv.url}/json`);
        expect(c.getMetrics().cacheHits).toBe(0);
        expect(c.getMetrics().cacheMisses).toBe(0);
    });
    it('uses a custom keyBuilder', async () => {
        const keyBuilder = vi.fn(() => 'fixed-key');
        const c = mk({ cache: { enabled: true, ttl: 5000, keyBuilder } });
        await c.get(`${srv.url}/json`);
        expect(keyBuilder).toHaveBeenCalled();
        await c.get(`${srv.url}/text`);
        // same key -> second is a hit
        expect(c.getMetrics().cacheHits).toBeGreaterThanOrEqual(1);
    });
    it('does not share cached responses across different auth', async () => {
        const c = mk({ cache: { enabled: true, ttl: 5000 } });
        const a = await c.get(`${srv.url}/headers`, { bearer: 'AAA' });
        const b = await c.get(`${srv.url}/headers`, { bearer: 'BBB' });
        expect(a.headers.authorization).toBe('Bearer AAA');
        expect(b.headers.authorization).toBe('Bearer BBB');
    });
});

describe('client cookies', () => {
    it('stores cookies from Set-Cookie and sends them back', async () => {
        const c = mk();
        await c.get(`${srv.url}/setcookie`);
        const body = await c.get(`${srv.url}/cookies`);
        expect(body.cookie).toContain('sid=abc123');
    });
});

describe('client abort / timeout', () => {
    it('throws AbortError when signal already aborted', async () => {
        const ac = new AbortController();
        ac.abort();
        await expect(mk().get(`${srv.url}/json`, { signal: ac.signal })).rejects.toBeInstanceOf(AbortError);
    });
    it('throws AbortError on mid-flight abort', async () => {
        const ac = new AbortController();
        const p = mk().get(`${srv.url}/slow`, { signal: ac.signal });
        setTimeout(() => ac.abort(), 50);
        await expect(p).rejects.toBeInstanceOf(AbortError);
    });
    it('honors a socket timeout option without breaking normal requests', async () => {
        const body = await mk({ timeout: 100 }).get(`${srv.url}/json`);
        expect(body.ok).toBe(true);
    });
    it('respects response timeout config', async () => {
        await expect(mk({ timeouts: { response: 100, connect: 5000, idle: 5000 } }).get(`${srv.url}/slow`))
            .rejects.toThrow();
    });
});

describe('client events', () => {
    it('emits request:start and request:end', async () => {
        const c = mk();
        const start = vi.fn();
        const end = vi.fn();
        c.on('request:start', start);
        c.on('request:end', end);
        await c.get(`${srv.url}/json`);
        expect(start).toHaveBeenCalled();
        expect(end).toHaveBeenCalled();
    });
    it('emits retry:attempt on retries', async () => {
        const c = mk({ retries: 1, retryDelay: 1 });
        const attempt = vi.fn();
        c.on('retry:attempt', attempt);
        await expect(c.get(`${srv.url}/error500`)).rejects.toThrow();
        expect(attempt).toHaveBeenCalled();
    });
    it('emits cache:hit on cached responses', async () => {
        const c = mk({ cache: { enabled: true, ttl: 5000 } });
        const hit = vi.fn();
        c.on('cache:hit', hit);
        await c.get(`${srv.url}/json`);
        await c.get(`${srv.url}/json`);
        expect(hit).toHaveBeenCalled();
    });
    it('off removes a listener', async () => {
        const c = mk();
        const fn = vi.fn();
        c.on('request:start', fn);
        c.off('request:start', fn);
        await c.get(`${srv.url}/json`);
        expect(fn).not.toHaveBeenCalled();
    });
});

describe('client interceptors & hooks', () => {
    it('request interceptor can add headers', async () => {
        const c = mk();
        c.interceptors.request.use((cfg) => {
            cfg.headers = { ...cfg.headers, 'X-Injected': '1' };
            return cfg;
        });
        const body = await c.get(`${srv.url}/headers`);
        expect(body.headers['x-injected']).toBe('1');
    });
    it('response interceptor is invoked with the raw response', async () => {
        const c = mk();
        let seen = null;
        c.interceptors.response.use((res) => {
            seen = res;
            return res;
        });
        await c.get(`${srv.url}/json`);
        expect(seen).not.toBeNull();
        expect(Buffer.isBuffer(seen.data)).toBe(true);
        expect(seen.status).toBe(200);
    });
    it('onRequest and onResponse hooks are invoked', async () => {
        const onRequest = vi.fn();
        const onResponse = vi.fn();
        const c = mk({ onRequest, onResponse });
        await c.get(`${srv.url}/json`);
        expect(onRequest).toHaveBeenCalled();
        expect(onResponse).toHaveBeenCalled();
    });
    it('response interceptor still runs on 5xx (no breaker)', async () => {
        const c = mk();
        let seen = null;
        c.interceptors.response.use((res) => { seen = res; return res; });
        await expect(c.get(`${srv.url}/error500`)).rejects.toBeInstanceOf(ResponseError);
        expect(seen).not.toBeNull();
        expect(seen.status).toBe(500);
    });
    it('onError hook is invoked on failure', async () => {
        const onError = vi.fn();
        const c = mk({ retries: 1, onError });
        await expect(c.get(`${srv.url}/error500`)).rejects.toThrow();
        expect(onError).toHaveBeenCalled();
    });
});

describe('client query (GraphQL)', () => {
    it('posts a GraphQL query and variables', async () => {
        const res = await mk().query(`${srv.url}/graphql`, { query: 'query X { a }', variables: { v: 1 } });
        expect(res.query).toBe('query X { a }');
        expect(res.variables).toEqual({ v: 1 });
    });
});

describe('client subscribe (SSE)', () => {
    it('receives server-sent events and can unsubscribe', async () => {
        const messages = [];
        const unsub = await mk().subscribe(`${srv.url}/sse`, { onMessage: (m) => messages.push(m) });
        await new Promise((r) => setTimeout(r, 200));
        unsub();
        expect(messages.length).toBeGreaterThanOrEqual(1);
        expect(messages[0]).toBe('event-1');
    });
});

describe('client batch', () => {
    it('resolves an array of bodies for mixed methods', async () => {
        const results = await mk().batch([
            { method: 'get', url: `${srv.url}/json` },
            { method: 'get', url: `${srv.url}/json` },
            { method: 'post', url: `${srv.url}/echo`, data: { x: 1 } }
        ]);
        expect(results.length).toBe(3);
        expect(results[0].ok).toBe(true);
        expect(JSON.parse(results[2].body).x).toBe(1);
    });
    it('returns {error} for failed batch requests', async () => {
        const results = await mk().batch([
            { method: 'get', url: `${srv.url}/client400` }
        ]);
        expect(results[0].error).toBeInstanceOf(ResponseError);
    });
    it('throws for a non-array batch', async () => {
        await expect(mk().batch('nope')).rejects.toThrow();
    });
});

describe('client download', () => {
    it('download returns a Buffer', async () => {
        const buf = await mk().download(`${srv.url}/json`);
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect(JSON.parse(buf.toString()).ok).toBe(true);
    });
    it('downloadTo writes a file and reports bytes', async () => {
        const fs = await import('node:fs');
        const os = await import('node:os');
        const path = await import('node:path');
        const file = path.join(os.tmpdir(), `swiftly-dl-${Date.now()}.bin`);
        const res = await mk().downloadTo(`${srv.url}/json`, file);
        expect(res.bytes).toBeGreaterThan(0);
        expect(fs.existsSync(file)).toBe(true);
        fs.unlinkSync(file);
    });
});

describe('client deduplication', () => {
    it('deduplicates concurrent identical GETs', async () => {
        const c = mk();
        const [a, b] = await Promise.all([
            c.get(`${srv.url}/json`),
            c.get(`${srv.url}/json`)
        ]);
        expect(a).toEqual(b);
    });
    it('does not merge concurrent GETs with different credentials', async () => {
        const c = mk();
        const [a, b] = await Promise.all([
            c.get(`${srv.url}/headers`, { bearer: 'AAA' }),
            c.get(`${srv.url}/headers`, { bearer: 'BBB' })
        ]);
        // Each caller must get its own authenticated response (dedup key
        // varies by auth), never the other user's.
        expect(a.headers.authorization).toBe('Bearer AAA');
        expect(b.headers.authorization).toBe('Bearer BBB');
    });
});

describe('client metrics & config', () => {
    it('tracks metrics', async () => {
        const c = mk();
        await c.get(`${srv.url}/json`);
        const m = c.getMetrics();
        expect(m.requestCount).toBeGreaterThanOrEqual(1);
        expect(m.successCount).toBeGreaterThanOrEqual(1);
        expect(typeof m.averageResponseTime).toBe('number');
        expect(m.totalDataTransferred).toBeGreaterThanOrEqual(0);
    });
    it('setConfig mutates defaults', () => {
        const c = mk();
        c.setConfig({ timeout: 5000 });
        expect(c.defaults.timeout).toBe(5000);
    });
    it('clone creates an independent instance', () => {
        const c = mk({ timeout: 111 });
        const clone = c.clone({ timeout: 222 });
        expect(clone).not.toBe(c);
        expect(clone.defaults.timeout).toBe(222);
        expect(c.defaults.timeout).toBe(111);
    });
});

describe('client responseSchema', () => {
    it('passes an empty schema through without throwing', async () => {
        const body = await mk({ responseSchema: {} }).get(`${srv.url}/json`);
        expect(body.ok).toBe(true);
    });
    it('throws when the schema does not match the raw response', async () => {
        await expect(mk({ responseSchema: { ok: 'string' } }).get(`${srv.url}/json`))
            .rejects.toThrow(/Schema/);
    });
});

describe('client humanize', () => {
    it('still resolves when humanize is enabled', async () => {
        const body = await mk({ humanize: true }).get(`${srv.url}/json`);
        expect(body.ok).toBe(true);
    });
});

describe('client rate limiting', () => {
    it('does not throw when rate limiting is enabled', async () => {
        const c = mk({ rateLimiting: { enabled: true, requestsPerSecond: 50 } });
        const body = await c.get(`${srv.url}/json`);
        expect(body.ok).toBe(true);
    });
});
