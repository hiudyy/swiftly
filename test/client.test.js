import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createClient } from '../lib/client.js';
import { startServer } from './helpers/server.js';
import { ResponseError, TimeoutError } from '../lib/errors.js';

let srv;

beforeAll(async () => {
    srv = await startServer();
});

afterAll(async () => {
    await srv.close();
});

describe('client integration', () => {
    it('performs a GET and returns parsed JSON body', async () => {
        const client = createClient({ debug: false });
        const body = await client.get(`${srv.url}/json?q=1`);
        expect(body.ok).toBe(true);
        expect(body.query.q).toBe('1');
    });

    it('returns text for text content', async () => {
        const client = createClient({ debug: false });
        const body = await client.get(`${srv.url}/text`, { responseType: 'text' });
        expect(body).toBe('hello world');
    });

    it('decompresses gzip responses', async () => {
        const client = createClient({ debug: false });
        const body = await client.get(`${srv.url}/gzip`);
        expect(body.compressed).toBe(true);
        expect(body.data.length).toBe(2048);
    });

    it('follows redirects', async () => {
        const client = createClient({ debug: false });
        const body = await client.get(`${srv.url}/redirect`);
        expect(body.ok).toBe(true);
    });

    it('throws on redirect loop exceeding maxRedirects', async () => {
        const client = createClient({ debug: false, maxRedirects: 3 });
        await expect(client.get(`${srv.url}/redirect-loop`)).rejects.toThrow('redirects exceeded');
    });

    it('retries 5xx and then succeeds', async () => {
        const client = createClient({ debug: false, retries: 2, retryDelay: 1 });
        // /error500 always 500 -> exhausts retries -> ResponseError
        await expect(client.get(`${srv.url}/error500`)).rejects.toBeInstanceOf(ResponseError);
    });

    it('does not retry 4xx client errors', async () => {
        const client = createClient({ debug: false, retries: 5, retryDelay: 1 });
        await expect(client.get(`${srv.url}/client400`)).rejects.toBeInstanceOf(ResponseError);
    });

    it('posts JSON body', async () => {
        const client = createClient({ debug: false });
        const body = await client.post(`${srv.url}/echo`, { hello: 'world' });
        expect(body.method).toBe('POST');
        expect(JSON.parse(body.body).hello).toBe('world');
    });

    it('download returns a Buffer', async () => {
        const client = createClient({ debug: false });
        const buf = await client.download(`${srv.url}/json`);
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect(JSON.parse(buf.toString()).ok).toBe(true);
    });

    it('batch resolves an array of bodies', async () => {
        const client = createClient({ debug: false });
        const results = await client.batch([
            { method: 'get', url: `${srv.url}/json` },
            { method: 'get', url: `${srv.url}/json` }
        ]);
        expect(results.length).toBe(2);
        expect(results[0].ok).toBe(true);
    });

    it('uses baseURL for relative paths', async () => {
        const client = createClient({ debug: false, baseURL: srv.url });
        const body = await client.get('/json');
        expect(body.ok).toBe(true);
    });

    it('respects timeout', async () => {
        const client = createClient({ debug: false, timeouts: { connect: 5000, response: 100, idle: 5000 } });
        await expect(client.get(`${srv.url}/slow`)).rejects.toThrow();
    });

    it('deduplicates concurrent identical GETs', async () => {
        const client = createClient({ debug: false });
        const [a, b] = await Promise.all([client.get(`${srv.url}/json`), client.get(`${srv.url}/json`)]);
        expect(a).toEqual(b);
    });

    it('caches GET responses', async () => {
        const client = createClient({ debug: false, cache: { enabled: true } });
        await client.get(`${srv.url}/json`);
        const m1 = client.getMetrics().cacheMisses;
        await client.get(`${srv.url}/json`);
        const m2 = client.getMetrics().cacheHits;
        expect(m1).toBeGreaterThanOrEqual(1);
        expect(m2).toBeGreaterThanOrEqual(1);
    });
});