import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http2 from 'node:http2';
import { execSync } from 'node:child_process';
import { createClient } from '../lib/client.js';

let server;
let base;

beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swiftly-h2-'));
    const key = path.join(dir, 'key.pem');
    const cert = path.join(dir, 'cert.pem');
    execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${key} -out ${cert} -days 1 -subj "/CN=localhost" -addext "subjectAltName=IP:127.0.0.1"`);
    const opts = { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
    server = http2.createSecureServer(opts);
    server.on('stream', (stream, headers) => {
        stream.respond({ 'content-type': 'application/json', ':status': 200 });
        stream.end(JSON.stringify({ ok: true, path: headers[':path'] }));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    base = `https://127.0.0.1:${port}`;
});

afterAll(() => new Promise((r) => server.close(r)));

describe('client http2 transport', () => {
    it('performs a request over HTTP/2 honoring validateSSL:false', async () => {
        const c = createClient({ debug: false, cache: { enabled: false }, validateSSL: false, useHttp2: true });
        const body = await c.get(`${base}/json`);
        expect(body.ok).toBe(true);
        expect(c.getMetrics().http2Requests).toBeGreaterThanOrEqual(1);
    });
    it('reports the HTTP/2 session in metrics', async () => {
        const c = createClient({ debug: false, cache: { enabled: false }, validateSSL: false, useHttp2: true });
        await c.get(`${base}/json`);
        expect(c.getMetrics().http2Sessions).toBeGreaterThanOrEqual(1);
    });
});
