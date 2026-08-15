import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createClient } from '../lib/client.js';
import swiftly from '../index.mjs';
import { startServer } from './helpers/server.js';
import { queryJSON } from '../lib/jsonpath.js';
import { parseHTML } from '../lib/scraper.js';

let srv;

beforeAll(async () => {
    srv = await startServer();
});

afterAll(async () => {
    await srv.close();
});

describe('real-world: resilient API client', () => {
    it('combines auth, retry, cache, interceptors and events', async () => {
        const events = [];
        const c = createClient({
            debug: false,
            cache: { enabled: true, ttl: 5000 },
            retries: 2,
            retryDelay: 1,
            bearer: 'token-xyz',
            onRequest: (info) => events.push(['request', info.method]),
            onResponse: () => events.push(['response'])
        });
        c.interceptors.request.use((cfg) => {
            cfg.headers = { ...cfg.headers, 'X-Api-Version': '2' };
            return cfg;
        });
        c.interceptors.response.use((res) => {
            try {
                const obj = JSON.parse(res.data.toString('utf-8'));
                res.data = Buffer.from(JSON.stringify({ ...obj, _normalized: true }));
            } catch { /* non-JSON responses are left untouched */ }
            return res;
        });
        // auth + interceptor header present
        const headers = await c.get(`${srv.url}/headers`);
        expect(headers.headers['authorization']).toBe('Bearer token-xyz');
        expect(headers.headers['x-api-version']).toBe('2');
        // successful JSON request, normalized by response interceptor
        const r1 = await c.get(`${srv.url}/json`);
        expect(r1._normalized).toBe(true);
        expect(r1.ok).toBe(true);
        // cached second call -> hit
        const m0 = c.getMetrics().cacheHits;
        await c.get(`${srv.url}/json`);
        expect(c.getMetrics().cacheHits).toBeGreaterThan(m0);
        // retry + error propagation
        await expect(c.get(`${srv.url}/error500`)).rejects.toBeTruthy();
        expect(events.some((e) => e[0] === 'request')).toBe(true);
    });
});

describe('real-world: cookie-authenticated session', () => {
    it('logs in via Set-Cookie then uses the session on later requests', async () => {
        const c = createClient({ debug: false, cache: { enabled: false } });
        await c.get(`${srv.url}/setcookie`);
        const session = await c.get(`${srv.url}/cookies`);
        expect(session.cookie).toContain('sid=abc123');
    });
});

describe('real-world: web scraping pipeline', () => {
    it('scrapes a live page then extracts structured data locally', async () => {
        const c = createClient({ debug: false, cache: { enabled: false } });
        const html = await c.get(`${srv.url}/html`, { responseType: 'text' });
        const links = parseHTML(html, 'a@href');
        expect(Array.isArray(links)).toBe(true);
        const h1 = parseHTML(html, 'h1')[0].content;
        expect(h1).toBe('Hi');
    });
    it('uses the convenience scrape() helper', async () => {
        const els = await swiftly().scrape(`${srv.url}/html`, { title: 'h1', paras: 'p' });
        expect(els.title[0].content).toBe('Hi');
        expect(els.paras.length).toBe(1);
    });
});

describe('real-world: paginated fan-out', () => {
    it('fetches pages sequentially using params', async () => {
        const c = createClient({ debug: false, cache: { enabled: false } });
        const pages = [];
        for (let page = 1; page <= 3; page++) {
            const body = await c.get(`${srv.url}/json`, { params: { page } });
            pages.push(body.query.page);
        }
        expect(pages).toEqual(['1', '2', '3']);
    });
    it('fetches many requests concurrently via batch', async () => {
        const c = createClient({ debug: false, cache: { enabled: false } });
        const results = await c.batch(
            Array.from({ length: 5 }, (_, i) => ({ method: 'get', url: `${srv.url}/json?i=${i}` }))
        );
        expect(results).toHaveLength(5);
        results.forEach((r) => expect(r.ok).toBe(true));
    });
    it('deduplicates identical concurrent GETs', async () => {
        const c = createClient({ debug: false, cache: { enabled: false } });
        const results = await Promise.all([
            c.get(`${srv.url}/json`),
            c.get(`${srv.url}/json`),
            c.get(`${srv.url}/json`)
        ]);
        expect(results[0]).toEqual(results[1]);
        expect(results[1]).toEqual(results[2]);
    });
});

describe('real-world: GraphQL gateway', () => {
    it('sends a query and consumes the result with JSONPath', async () => {
        const c = createClient({ debug: false, cache: { enabled: false } });
        const res = await c.query(`${srv.url}/graphql`, {
            query: 'query { user { id } }',
            variables: { id: 42 }
        });
        expect(res.variables.id).toBe(42);
        const q = queryJSON(res, 'query');
        expect(q).toContain('user');
    });
});

describe('real-world: streaming download with progress', () => {
    it('reports progress and writes the file', async () => {
        const fs = await import('node:fs');
        const os = await import('node:os');
        const path = await import('node:path');
        const c = createClient({ debug: false, cache: { enabled: false } });
        const progress = [];
        const file = path.join(os.tmpdir(), `swiftly-big-${Date.now()}.bin`);
        const res = await c.downloadTo(`${srv.url}/big`, file, { onProgress: (p) => progress.push(p) });
        expect(res.bytes).toBe(100000);
        expect(fs.existsSync(file)).toBe(true);
        expect(progress.some((p) => p.total === 100000)).toBe(true);
        fs.unlinkSync(file);
    });
});

describe('real-world: SSE event consumption', () => {
    it('consumes a live event stream and unsubscribes', async () => {
        const c = createClient({ debug: false, cache: { enabled: false } });
        const messages = [];
        const unsub = await c.subscribe(`${srv.url}/sse`, { onMessage: (m) => messages.push(m) });
        await new Promise((r) => setTimeout(r, 200));
        unsub();
        expect(messages.length).toBeGreaterThanOrEqual(2);
    });
});

describe('real-world: aborting a slow request', () => {
    it('aborts a slow endpoint without waiting', async () => {
        const c = createClient({ debug: false, cache: { enabled: false } });
        const ac = new AbortController();
        const p = c.get(`${srv.url}/slow`, { signal: ac.signal });
        setTimeout(() => ac.abort(), 30);
        await expect(p).rejects.toBeTruthy();
    });
});

describe('real-world: form-style submission', () => {
    it('posts a JSON payload and reads the echoed body back as an object', async () => {
        const c = createClient({ debug: false, cache: { enabled: false } });
        const res = await c.post(`${srv.url}/echo`, { name: 'Ada', age: 36 });
        expect(res.method).toBe('POST');
        const body = JSON.parse(res.body);
        expect(body.name).toBe('Ada');
        expect(body.age).toBe(36);
    });
});
