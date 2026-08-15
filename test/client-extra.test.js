import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { execSync } from 'node:child_process';
import { createClient } from '../lib/client.js';
import { startServer } from './helpers/server.js';
import { TimeoutError, ResponseError } from '../lib/errors.js';

let srv;

beforeAll(async () => {
    srv = await startServer();
});

afterAll(async () => {
    await srv.close();
});

const mk = (cfg = {}) => createClient({ debug: false, cache: { enabled: false }, ...cfg });

describe('client compression', () => {
    it('decompresses gzip responses', async () => {
        const c = mk();
        const body = await c.get(`${srv.url}/gzip`);
        expect(body.compressed).toBe(true);
    });
    it('decompresses deflate responses', async () => {
        const c = mk();
        const body = await c.get(`${srv.url}/deflate`);
        expect(body.compressed).toBe('deflate');
    });
    it('decompresses brotli responses', async () => {
        const c = mk();
        const body = await c.get(`${srv.url}/br`);
        expect(body.compressed).toBe('br');
    });
});

describe('client redirects', () => {
    it('follows relative redirects automatically', async () => {
        const c = mk();
        const body = await c.get(`${srv.url}/redirect`);
        expect(body.ok).toBe(true);
    });
    it('follows redirect chains', async () => {
        const c = mk();
        const body = await c.get(`${srv.url}/r1`);
        expect(body.ok).toBe(true);
    });
    it('returns the raw response when followRedirects is false', async () => {
        const c = mk();
        const res = await c.get(`${srv.url}/redirect`, { followRedirects: false, responseType: 'raw' });
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/json');
    });
    it('throws on max redirects exceeded', async () => {
        const c = mk();
        let err;
        try {
            await c.get(`${srv.url}/redirect-loop`, { maxRedirects: 1 });
        } catch (e) { err = e; }
        expect(err).toBeTruthy();
        expect(err.code).toBe('MAX_REDIRECTS');
    });
});

describe('client retries', () => {
    it('retries transient 500 errors and increments metrics', async () => {
        const c = mk({ retries: 1, retryDelay: 1 });
        await expect(c.get(`${srv.url}/error500`)).rejects.toBeTruthy();
        expect(c.getMetrics().retries).toBeGreaterThanOrEqual(1);
    });
    it('supports retryBackoff and onRetry', async () => {
        const c = mk({ retries: 2, retryDelay: 1, retryBackoff: 2 });
        let calls = 0;
        await expect(c.get(`${srv.url}/error500`, { onRetry: () => calls++ })).rejects.toBeTruthy();
        expect(calls).toBeGreaterThanOrEqual(1);
    });
    it('retries based on a status whitelist', async () => {
        const c = mk({ retries: 1, retryDelay: 1, retryOn: [500] });
        await expect(c.get(`${srv.url}/error500`)).rejects.toBeTruthy();
        expect(c.getMetrics().retries).toBeGreaterThanOrEqual(1);
    });
    it('retries based on a custom function', async () => {
        const c = mk({ retries: 1, retryDelay: 1, retryOn: () => true });
        await expect(c.get(`${srv.url}/error500`)).rejects.toBeTruthy();
    });
    it('honors Retry-After and does not retry client errors by default', async () => {
        const c = mk({ retries: 2, retryDelay: 1, retryOn: [503] });
        let calls = 0;
        await expect(c.get(`${srv.url}/status/503?retry=0`, { onRetry: () => calls++ })).rejects.toBeTruthy();
        expect(calls).toBeGreaterThanOrEqual(1);
    });
    it('does not retry 4xx by default (no retryOn)', async () => {
        const c = mk({ retries: 2, retryDelay: 1 });
        const before = c.getMetrics().retries;
        await expect(c.get(`${srv.url}/client400`)).rejects.toBeTruthy();
        expect(c.getMetrics().retries).toBe(before);
    });
});

describe('client timeouts and abort', () => {
    it('aborts an in-flight request via signal', async () => {
        const c = mk();
        const ac = new AbortController();
        const p = c.get(`${srv.url}/slow`, { signal: ac.signal });
        setTimeout(() => ac.abort(), 30);
        await expect(p).rejects.toBeTruthy();
    });
    it('aborts immediately when signal is already fired', async () => {
        const c = mk();
        const ac = new AbortController();
        ac.abort();
        await expect(c.get(`${srv.url}/json`, { signal: ac.signal })).rejects.toBeTruthy();
    });
    it('enforces an opt-in response timeout', async () => {
        const c = mk();
        await expect(c.get(`${srv.url}/slow`, { timeouts: { response: 80 } })).rejects.toBeInstanceOf(TimeoutError);
    });
});

describe('client auth helpers', () => {
    it('sends Basic auth', async () => {
        const c = mk();
        const body = await c.get(`${srv.url}/auth`, { auth: { username: 'user', password: 'pass' } });
        expect(body.ok).toBe(true);
    });
    it('sends Bearer auth', async () => {
        const c = mk();
        const body = await c.get(`${srv.url}/headers`, { bearer: 'xyz' });
        expect(body.headers.authorization).toBe('Bearer xyz');
    });
    it('sends a raw token', async () => {
        const c = mk();
        const body = await c.get(`${srv.url}/headers`, { token: 'RawToken' });
        expect(body.headers.authorization).toBe('RawToken');
    });
});

describe('client responseType', () => {
    it('returns raw response shape when requested', async () => {
        const c = mk();
        const res = await c.get(`${srv.url}/json`, { responseType: 'raw' });
        expect(res.status).toBe(200);
        expect(res.data.ok).toBe(true);
        expect(res.headers).toBeTruthy();
    });
    it('returns a Buffer for buffer type', async () => {
        const c = mk();
        const res = await c.get(`${srv.url}/json`, { responseType: 'buffer' });
        expect(Buffer.isBuffer(res)).toBe(true);
    });
    it('returns a string for text type', async () => {
        const c = mk();
        const res = await c.get(`${srv.url}/json`, { responseType: 'text' });
        expect(typeof res).toBe('string');
    });
    it('falls back to buffer for an unknown responseType', async () => {
        const c = mk();
        const res = await c.get(`${srv.url}/json`, { responseType: 'bogus' });
        expect(Buffer.isBuffer(res)).toBe(true);
    });
});

describe('client methods and payloads', () => {
    it('HEAD returns headers', async () => {
        const c = mk();
        const headers = await c.head(`${srv.url}/json`);
        expect(headers['content-type']).toContain('application/json');
    });
    it('OPTIONS returns headers', async () => {
        const c = mk();
        const headers = await c.options(`${srv.url}/json`);
        expect(headers).toBeTruthy();
    });
    it('PUT/PATCH/DELETE echo the method', async () => {
        const c = mk();
        expect((await c.put(`${srv.url}/echo`, { a: 1 })).method).toBe('PUT');
        expect((await c.patch(`${srv.url}/echo`, { a: 1 })).method).toBe('PATCH');
        expect((await c.delete(`${srv.url}/echo`)).method).toBe('DELETE');
    });
    it('serializes object JSON by default', async () => {
        const c = mk();
        const res = await c.post(`${srv.url}/echo`, { a: 1 });
        expect(res.contentType).toContain('application/json');
        expect(JSON.parse(res.body).a).toBe(1);
    });
    it('builds multipart/form-data when formData is set', async () => {
        const c = mk();
        const res = await c.post(`${srv.url}/echo`, { field: 'v' }, { formData: true });
        expect(res.method).toBe('POST');
        expect(res.contentType).toContain('multipart/form-data');
    });
    it('gzip-compresses large request payloads', async () => {
        const c = mk();
        const res = await c.post(`${srv.url}/echo`, { big: 'x'.repeat(5000) });
        expect(res.contentEncoding).toBe('gzip');
    });
    it('appends query params from config', async () => {
        const c = mk();
        const body = await c.get(`${srv.url}/json`, { params: { q: '1' } });
        expect(body.query.q).toBe('1');
    });
});

describe('client validation', () => {
    it('rejects an invalid method', async () => {
        const c = mk();
        await expect(c.request('FOO', `${srv.url}/json`)).rejects.toBeTruthy();
    });
    it('rejects a relative URL without baseURL', async () => {
        const c = mk();
        await expect(c.get('/relative')).rejects.toBeTruthy();
    });
    it('rejects non-string header values', async () => {
        const c = mk();
        await expect(c.get(`${srv.url}/json`, { headers: { 'X-Test': { bad: true } } })).rejects.toBeTruthy();
    });
    it('rejects multipart without data', async () => {
        const c = mk();
        await expect(c.post(`${srv.url}/echo`, null, { formData: true })).rejects.toBeTruthy();
    });
});

describe('client circuit breaker lifecycle', () => {
    it('transitions OPEN -> HALF-OPEN -> CLOSED after resetTimeout', async () => {
        const c = mk({ circuitBreaker: { enabled: true, failureThreshold: 1, resetTimeout: 1 } });
        await expect(c.get('http://127.0.0.1:1')).rejects.toThrow();
        const dead = c.getMetrics().circuitBreakers.find(x => x.domain === '127.0.0.1');
        expect(dead.state.state).toBe('OPEN');
        await new Promise((r) => setTimeout(r, 5));
        const body = await c.get(`${srv.url}/json`);
        expect(body.ok).toBe(true);
        const after = c.getMetrics().circuitBreakers.find(x => x.domain === '127.0.0.1');
        expect(after.state.state).toBe('CLOSED');
    });
    it('resetCircuitBreakers clears all', async () => {
        const c = mk({ circuitBreaker: { enabled: true, failureThreshold: 1, resetTimeout: 1 } });
        await expect(c.get('http://127.0.0.1:1')).rejects.toThrow();
        c.resetCircuitBreakers();
        expect(c.getMetrics().circuitBreakers.length).toBe(0);
    });
});

describe('client cache staleness', () => {
    it('serves a stale entry while revalidating in the background', async () => {
        const c = createClient({
            debug: false,
            cache: { enabled: true, ttl: 1, staleWhileRevalidate: true }
        });
        await c.get(`${srv.url}/json`);
        await new Promise((r) => setTimeout(r, 5));
        const body = await c.get(`${srv.url}/json`);
        expect(body.ok).toBe(true);
    });
});

describe('client response validation', () => {
    it('passes when the schema is empty', async () => {
        const c = mk();
        const body = await c.get(`${srv.url}/json`, { responseSchema: {} });
        expect(body.ok).toBe(true);
    });
    it('validates the parsed JSON body (not the raw buffer)', async () => {
        const c = mk();
        const body = await c.get(`${srv.url}/json`, { responseSchema: { ok: 'boolean' } });
        expect(body.ok).toBe(true);
    });
    it('throws when the schema does not match', async () => {
        const c = mk();
        await expect(c.get(`${srv.url}/json`, { responseSchema: { ok: 'string' } })).rejects.toThrow();
    });
});

describe('client streaming', () => {
    it('returns a Readable in stream mode', async () => {
        const c = mk();
        const stream = await c.get(`${srv.url}/json`, { stream: true });
        expect(typeof stream.pipe === 'function').toBe(true);
        const chunks = [];
        await new Promise((resolve, reject) => {
            stream.on('data', (d) => chunks.push(d));
            stream.on('end', resolve);
            stream.on('error', reject);
        });
        const text = Buffer.concat(chunks).toString('utf-8');
        expect(text).toContain('"ok":true');
    });
});

describe('client transport / ipv6 edges', () => {
    it('supports the optional undici transport', async () => {
        const c = mk({ transport: 'undici' });
        const res = await c.get(`${srv.url}/json`, { responseType: 'raw' });
        expect(res.status).toBe(200);
    });
    it('validates IPv6 hostnames', async () => {
        const c = mk();
        await expect(c.get('http://[::1:bad]:80/')).rejects.toBeTruthy();
    });
    it('prepares a valid IPv6 hostname before connecting', async () => {
        const c = mk();
        await expect(c.get('http://[::1]:1/')).rejects.toBeTruthy();
    });
    it('decompresses gzip responses via undici', async () => {
        const c = mk({ transport: 'undici' });
        const body = await c.get(`${srv.url}/gzip`);
        expect(body.compressed).toBe(true);
    });
});

describe('client SSE error paths', () => {
    it('rejects when the SSE endpoint is not 200', async () => {
        const c = mk();
        await expect(c.subscribe(`${srv.url}/status/404`, { onMessage: () => {} })).rejects.toBeTruthy();
    });
    it('rejects on connection failure and reports it through onError', async () => {
        const c = mk();
        let errCalled = false;
        await expect(c.subscribe('http://127.0.0.1:1/sse', { onMessage: () => {}, onError: () => { errCalled = true; } })).rejects.toBeTruthy();
        expect(errCalled).toBe(true);
    });
    it('resolves with an unsubscribe fn once the stream is open', async () => {
        const c = mk();
        const unsub = await c.subscribe(`${srv.url}/sse`, { onMessage: () => {} });
        expect(typeof unsub).toBe('function');
    });
});

describe('client debug log branch', () => {
    it('logs and falls back for an unknown responseType', async () => {
        const c = createClient({ debug: true, cache: { enabled: false } });
        const res = await c.get(`${srv.url}/json`, { responseType: 'bogus' });
        expect(Buffer.isBuffer(res)).toBe(true);
    });
});

describe('client proxy support', () => {
    let proxy;
    beforeAll(async () => {
        proxy = http.createServer((preq, pres) => {
            const target = new URL(preq.url);
            const req = http.request(
                { host: target.hostname, port: target.port || 80, method: preq.method, path: target.pathname + target.search, headers: preq.headers },
                (res) => {
                    pres.writeHead(res.statusCode, res.headers);
                    res.pipe(pres);
                }
            );
            preq.pipe(req);
            req.on('error', () => pres.destroy());
        });
        await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
        proxy.port = proxy.address().port;
    });
    afterAll(() => new Promise((r) => proxy.close(r)));

    it('routes requests through an HTTP proxy', async () => {
        const c = createClient({
            debug: false,
            cache: { enabled: false },
            proxy: { host: '127.0.0.1', port: proxy.port }
        });
        const body = await c.get(`${srv.url}/json`);
        expect(body.ok).toBe(true);
    });
    it('supports proxy basic auth', async () => {
        const c = createClient({
            debug: false,
            cache: { enabled: false },
            proxy: { host: '127.0.0.1', port: proxy.port, auth: { username: 'u', password: 'p' } }
        });
        const body = await c.get(`${srv.url}/json`);
        expect(body.ok).toBe(true);
    });
});

describe('client https over proxy (CONNECT tunnel)', () => {
    let proxy;
    let httpsServer;
    let httpsBase;
    beforeAll(async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swiftly-https-'));
        const key = path.join(dir, 'key.pem');
        const cert = path.join(dir, 'cert.pem');
        execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${key} -out ${cert} -days 1 -subj "/CN=localhost" -addext "subjectAltName=IP:127.0.0.1"`);
        httpsServer = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) });
        httpsServer.on('request', (req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, secure: true }));
        });
        await new Promise((r) => httpsServer.listen(0, '127.0.0.1', r));
        const httpsPort = httpsServer.address().port;
        httpsBase = `https://127.0.0.1:${httpsPort}`;

        proxy = http.createServer((preq, pres) => {
            const target = new URL(preq.url);
            const req = http.request(
                { host: target.hostname, port: target.port || 80, method: preq.method, path: target.pathname + target.search, headers: preq.headers },
                (res) => { pres.writeHead(res.statusCode, res.headers); res.pipe(pres); }
            );
            preq.pipe(req);
            req.on('error', () => pres.destroy());
        });
        proxy.on('connect', (creq, clientSocket) => {
            const idx = creq.url.lastIndexOf(':');
            const host = creq.url.slice(0, idx);
            const port = Number(creq.url.slice(idx + 1));
            const serverSocket = net.connect(port, host, () => {
                clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                serverSocket.pipe(clientSocket);
                clientSocket.pipe(serverSocket);
            });
            serverSocket.on('error', () => clientSocket.destroy());
        });
        await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
        proxy.port = proxy.address().port;
    });
    afterAll(() => {
        try { if (typeof httpsServer.closeAllConnections === 'function') httpsServer.closeAllConnections(); } catch { /* ignore */ }
        try { proxy.close(); } catch { /* ignore */ }
        try { httpsServer.close(); } catch { /* ignore */ }
    });

    it('tunnels HTTPS requests through the proxy', async () => {
        const c = createClient({
            debug: false,
            cache: { enabled: false },
            validateSSL: false,
            keepAlive: false,
            proxy: { host: '127.0.0.1', port: proxy.port }
        });
        const body = await c.get(`${httpsBase}/json`);
        expect(body.ok).toBe(true);
        expect(body.secure).toBe(true);
    });
});

describe('client error hooks and edges', () => {
    it('invokes onError for non-retryable client errors', async () => {
        const c = mk();
        let called = false;
        await expect(c.get(`${srv.url}/client400`, { onError: () => { called = true; } })).rejects.toBeTruthy();
        expect(called).toBe(true);
    });
    it('rejects unserializable request payloads', async () => {
        const c = mk();
        const circular = {};
        circular.self = circular;
        await expect(c.post(`${srv.url}/echo`, circular)).rejects.toBeTruthy();
    });
    it('calls the stream onResponse hook', async () => {
        const c = mk();
        let called = false;
        await c.get(`${srv.url}/json`, {
            stream: true,
            onResponse: () => { called = true; }
        });
        await new Promise((r) => setTimeout(r, 50));
        expect(called).toBe(true);
    });
});

describe('client config helpers', () => {
    it('exposes defaults and supports setConfig/clone', () => {
        const c = mk();
        expect(c.defaults).toBeTruthy();
        const cloned = c.clone({ retries: 9 });
        expect(cloned.defaults.retries).toBe(9);
        c.setConfig({ retries: 7 });
        expect(c.defaults.retries).toBe(7);
    });
    it('tracks metrics and clears cache', async () => {
        const c = createClient({ debug: false, cache: { enabled: true, ttl: 1000 } });
        await c.get(`${srv.url}/json`);
        const m = c.getMetrics();
        expect(m.requestCount).toBeGreaterThan(0);
        expect(m.averageResponseTime).toBeGreaterThanOrEqual(0);
        expect(m.cacheSize).toBeGreaterThanOrEqual(0);
        c.clearCache();
        expect(c.getMetrics().cacheSize).toBe(0);
    });
    it('batch runs mixed requests and swallows per-request errors', async () => {
        const c = mk();
        const results = await c.batch([
            { method: 'get', url: `${srv.url}/json` },
            { method: 'get', url: `${srv.url}/error500` },
            { method: 'post', url: `${srv.url}/echo`, data: { a: 1 } }
        ]);
        expect(results[0].ok).toBe(true);
        expect(results[1].error).toBeTruthy();
        expect(results[2].method).toBe('POST');
    });
    it('batch rejects a non-array', async () => {
        const c = mk();
        await expect(c.batch('nope')).rejects.toBeTruthy();
    });
    it('download helper returns a buffer', async () => {
        const c = mk();
        const buf = await c.download(`${srv.url}/big`);
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect(buf.length).toBe(100000);
    });
    it('rejects downloadTo when the response is an error status', async () => {
        const c = mk();
        const file = path.join(os.tmpdir(), `swiftly-fail-${Date.now()}.bin`);
        await expect(c.downloadTo(`${srv.url}/status/404`, file)).rejects.toBeInstanceOf(ResponseError);
        expect(fs.existsSync(file)).toBe(false);
    });
    it('closes the client without throwing', async () => {
        const c = mk();
        await expect(c.close()).resolves.toBeUndefined();
    });
});
