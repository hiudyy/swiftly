/**
 * End-to-end "real user" journeys against the SwiftMart mock store.
 *
 * These tests exercise Swiftly the way a production app would: authenticated
 * sessions, token-based APIs, scraping pipelines, RSS readers, resilience
 * under flaky upstreams, concurrency/dedup, streaming, GraphQL, compression,
 * redirects and cache isolation between tenants.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient } from '../lib/client.js';
import { createCookieJar } from '../lib/interceptor.js';
import swiftly from '../index.mjs';
import { startStoreServer } from './helpers/store-server.js';
import { parseHTML } from '../lib/scraper.js';
import { extractJsonLd, htmlToMarkdown, extractLinks } from '../lib/extract.js';
import { parseRSS, parseAtom, parseSitemap, parseXML } from '../lib/xml.js';
import { parseCSV } from '../lib/csv.js';

let srv;

beforeAll(async () => {
    srv = await startStoreServer();
});

afterAll(async () => {
    await srv.close();
});

beforeEach(() => {
    srv.resetHits();
});

// ---------------------------------------------------------------------------
// 🔐 Session auth journey
// ---------------------------------------------------------------------------
describe('user journey: session-authenticated shopping session', () => {
    it('logs in, keeps the session cookie, and hits protected routes', async () => {
        const api = createClient({ cache: { enabled: false } });
        const login = await api.post(`${srv.url}/api/login`, { email: 'alice@swiftly.dev', password: 'secret' });
        expect(login.email).toBe('alice@swiftly.dev');
        expect(login.role).toBe('admin');

        const me = await api.get(`${srv.url}/api/me`);
        expect(me.email).toBe('alice@swiftly.dev');
        expect(me.name).toBe('Alice Admin');
    });

    it('keeps the session alive across a paginated, cached browsing session', async () => {
        const api = createClient({ cache: { enabled: true, ttl: 60000 } });
        await api.post(`${srv.url}/api/login`, { email: 'alice@swiftly.dev', password: 'secret' });

        const page1 = await api.get(`${srv.url}/api/products?page=1&per_page=5`);
        expect(page1.items).toHaveLength(5);
        const m1 = api.getMetrics().cacheHits;
        const page1again = await api.get(`${srv.url}/api/products?page=1&per_page=5`);
        expect(page1again.items).toEqual(page1.items);
        expect(api.getMetrics().cacheHits).toBeGreaterThan(m1);

        // session cookie still attached on the cached miss path
        const me = await api.get(`${srv.url}/api/me`);
        expect(me.email).toBe('alice@swiftly.dev');
    });

    it('logout clears the session and protected routes then fail with 401', async () => {
        const api = createClient({ cache: { enabled: false } });
        await api.post(`${srv.url}/api/login`, { email: 'alice@swiftly.dev', password: 'secret' });
        await api.post(`${srv.url}/api/logout`);
        await expect(api.get(`${srv.url}/api/me`)).rejects.toMatchObject({
            code: 'RESPONSE_ERROR',
            response: { status: 401 }
        });
    });

    it('rejects wrong credentials with a typed 401 error', async () => {
        const api = createClient({ cache: { enabled: false } });
        await expect(api.post(`${srv.url}/api/login`, { email: 'alice@swiftly.dev', password: 'nope' }))
            .rejects.toMatchObject({ code: 'RESPONSE_ERROR', response: { status: 401 } });
    });
});

// ---------------------------------------------------------------------------
// 🔑 Bearer token API client
// ---------------------------------------------------------------------------
describe('user journey: bearer-token API client with interceptors', () => {
    async function authedClient() {
        const api = createClient({ cache: { enabled: false } });
        const { token } = await api.post(`${srv.url}/api/token`, { email: 'alice@swiftly.dev', password: 'secret' });
        api.interceptors.request.use((cfg) => {
            cfg.headers = { ...cfg.headers, Authorization: `Bearer ${token}` };
            return cfg;
        });
        api.token = token; // stash for assertions
        return api;
    }

    it('obtains a token and auto-attaches it on every request', async () => {
        const api = await authedClient();
        const account = await api.get(`${srv.url}/api/account`);
        expect(account.email).toBe('alice@swiftly.dev');
        expect(account.plan).toBe('pro');
    });

    it('runs a full product CRUD lifecycle', async () => {
        const api = await authedClient();
        const created = await api.post(`${srv.url}/api/products`, {
            name: 'Limited Edition Poster', price: 42, category: 'accessories'
        });
        expect(created.id).toBeTruthy();
        expect(created.price).toBe(42);

        const fetched = await api.get(`${srv.url}/api/products/${created.id}`);
        expect(fetched.name).toBe('Limited Edition Poster');

        const patched = await api.patch(`${srv.url}/api/products/${created.id}`, { price: 19.99, inStock: false });
        expect(patched.price).toBe(19.99);
        expect(patched.inStock).toBe(false);

        const deleted = await api.delete(`${srv.url}/api/products/${created.id}`);
        expect(deleted.deleted).toBe(created.id);

        await expect(api.get(`${srv.url}/api/products/${created.id}`))
            .rejects.toMatchObject({ code: 'RESPONSE_ERROR', response: { status: 404 } });
    });

    it('validates body payloads with a typed 422', async () => {
        const api = await authedClient();
        await expect(api.post(`${srv.url}/api/products`, { name: 'No price' }))
            .rejects.toMatchObject({ code: 'RESPONSE_ERROR', response: { status: 422 } });
    });

    it('unwraps an API envelope with a response interceptor', async () => {
        const api = createClient({ cache: { enabled: false } });
        api.interceptors.response.use((res) => {
            try {
                const obj = JSON.parse(res.data.toString('utf-8'));
                if (obj && obj.ok && obj.data) res.data = Buffer.from(JSON.stringify(obj.data));
            } catch { /* leave non-envelopes alone */ }
            return res;
        });
        const body = await api.get(`${srv.url}/api/envelope`);
        expect(body).toEqual({ version: '2.4.1', env: 'production' });
    });
});

// ---------------------------------------------------------------------------
// 👥 Multi-tenant cache isolation
// ---------------------------------------------------------------------------
describe('user journey: multi-tenant cache isolation', () => {
    it('never serves one tenant\u2019s cached body to another tenant', async () => {
        const a = createClient({ cache: { enabled: true, ttl: 60000 } });
        const b = createClient({ cache: { enabled: true, ttl: 60000 } });
        const { token: tokenA } = await a.post(`${srv.url}/api/token`, { email: 'alice@swiftly.dev', password: 'secret' });
        const { token: tokenB } = await b.post(`${srv.url}/api/token`, { email: 'bob@swiftly.dev', password: 'hunter2' });
        a.setConfig({ bearer: tokenA });
        b.setConfig({ bearer: tokenB });

        const r1 = await a.get(`${srv.url}/api/tenant`);
        expect(r1.tenant).toBe('alice@swiftly.dev');
        const r2 = await a.get(`${srv.url}/api/tenant`); // cache hit for A
        expect(r2).toEqual(r1);

        const r3 = await b.get(`${srv.url}/api/tenant`); // must NOT hit A's cache entry
        expect(r3.tenant).toBe('bob@swiftly.dev');

        expect(a.getMetrics().cacheHits).toBeGreaterThan(0);
        expect(srv.getHits('/api/tenant')).toBe(2); // one real request per tenant
    });
});

// ---------------------------------------------------------------------------
// 🕷️ Catalog crawler (scraping pipeline)
// ---------------------------------------------------------------------------
describe('user journey: catalog crawler with scraping', () => {
    it('paginates the JSON API and scrapes the HTML storefront consistently', async () => {
        const api = createClient({ cache: { enabled: false } });
        const json = await api.get(`${srv.url}/api/products?per_page=50`);
        const jsonNames = json.items.map((p) => p.name).sort();

        const html = await api.get(`${srv.url}/catalog`, { responseType: 'text' });
        const scraped = parseHTML(html, {
            names: { selector: '.product-card .product-name', type: 'text' },
            prices: { selector: '.product-card .price', type: 'attr', attr: 'data-price' },
            links: '.details-link@href'
        });

        expect(scraped.names.length).toBe(json.total);
        expect(scraped.names.sort()).toEqual(jsonNames);
        expect(scraped.prices.length).toBe(json.total);
        expect(scraped.links[0]).toMatch(/^\/product\/p\d+$/);
    });

    it('extracts JSON-LD structured data from a product page', async () => {
        const api = createClient({ cache: { enabled: false } });
        const page = await api.get(`${srv.url}/product/p3`, { responseType: 'text' });
        const ld = extractJsonLd(page);
        expect(ld.length).toBeGreaterThan(0);
        expect(ld[0]['@type']).toBe('Product');

        const apiProduct = await api.get(`${srv.url}/api/products/p3`);
        expect(ld[0].name).toBe(apiProduct.name);
        expect(Number(ld[0].offers.price)).toBe(apiProduct.price);
    });

    it('crawls the storefront following links found on the page', async () => {
        const api = createClient({ cache: { enabled: false } });
        const html = await api.get(`${srv.url}/catalog`, { responseType: 'text' });
        const links = extractLinks(html).map((l) => l.href).filter((l) => l.startsWith('/product/'));
        expect(links.length).toBeGreaterThan(0);

        const detail = await api.get(`${srv.url}${links[0]}`, { responseType: 'text' });
        const title = parseHTML(detail, 'h1.product-title')[0].content;
        const price = parseHTML(detail, '.price')[0].content;
        expect(title).toMatch(/Swiftly|Turbo|Neo|Hyper|Quantum|Solar|Zen|Nova/);
        expect(price).toMatch(/^\$\d+\.\d{2}$/);
    });

    it('downloads the CSV export and parses it back into objects', async () => {
        const api = createClient({ cache: { enabled: false } });
        const total = (await api.get(`${srv.url}/api/products?per_page=1`)).total;

        const csv = await api.get(`${srv.url}/api/products.csv`);
        expect(typeof csv).toBe('string');
        const rows = parseCSV(csv);
        expect(rows.length).toBe(total);
        expect(rows[0]).toHaveProperty('id');
        expect(rows[0]).toHaveProperty('price');

        const ids = rows.map((r) => r.id);
        expect(ids[0]).toMatch(/^p\d+$/);
        expect(new Set(ids).size).toBe(rows.length);
    });

    it('runs a full catalog fan-out with batch and no failures', async () => {
        const api = createClient({ cache: { enabled: false } });
        const list = await api.get(`${srv.url}/api/products?per_page=8`);
        const results = await api.batch(
            list.items.map((p) => ({ method: 'get', url: `${srv.url}/api/products/${p.id}` }))
        );
        expect(results).toHaveLength(list.items.length);
        results.forEach((r) => expect(r.id).toBeTruthy());
        expect(new Set(results.map((r) => r.name)).size).toBe(results.length);
    });
});

// ---------------------------------------------------------------------------
// 📰 RSS reader pipeline
// ---------------------------------------------------------------------------
describe('user journey: RSS reader pipeline', () => {
    const localize = (link) => link.replace('http://store.test', srv.url);

    it('parses the RSS feed (auto-detected as buffer) and reads articles as markdown', async () => {
        const api = createClient({ cache: { enabled: false } });
        const feed = await api.get(`${srv.url}/feed.xml`); // application/rss+xml -> Buffer
        const items = parseRSS(feed);
        expect(items.length).toBe(5);
        expect(items[0].title).toBeTruthy();
        expect(items[0].categories).toContain(items[0].categories[0]);

        for (const item of items.slice(0, 2)) {
            const html = await api.get(localize(item.link), { responseType: 'text' });
            const h1 = parseHTML(html, 'h1.product-title')[0].content;
            expect(h1).toBe(item.title);
            const md = htmlToMarkdown(html);
            expect(md).toContain(item.title);
        }
    });

    it('parses the Atom feed and the sitemap', async () => {
        const api = createClient({ cache: { enabled: false } });
        const atom = parseAtom(await api.get(`${srv.url}/feed.atom`, { responseType: 'text' }));
        expect(atom.length).toBe(5);
        expect(atom[0].link).toMatch(/\/product\/p\d+$/);

        const sitemap = parseSitemap(await api.get(`${srv.url}/sitemap.xml`, { responseType: 'text' }));
        expect(sitemap.length).toBeGreaterThan(0);
        expect(sitemap[0].loc).toMatch(/\/product\/p\d+$/);

        // XML round-trip sanity: the sitemap is valid XML (the parsed root IS the urlset)
        const tree = parseXML(await api.get(`${srv.url}/sitemap.xml`, { responseType: 'text' }));
        expect(tree.url.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// 🛡️ Resilience under a flaky upstream
// ---------------------------------------------------------------------------
describe('user journey: resilience under a flaky upstream', () => {
    it('retries a flaky endpoint and succeeds once it recovers', async () => {
        const retries = [];
        const api = createClient({
            cache: { enabled: false },
            retries: 4,
            retryDelay: 5,
            onRetry: (attempt, err, delay) => retries.push({ attempt, code: err.code, delay })
        });
        const result = await api.get(`${srv.url}/api/flaky?key=fl1&fails=2`);
        expect(result.ok).toBe(true);
        expect(result.attempts).toBe(3);
        expect(retries.length).toBe(2);
        expect(retries[0].code).toBe('RESPONSE_ERROR');
        expect(api.getMetrics().retries).toBe(2);
        expect(srv.getHits('/api/flaky')).toBe(3);
    });

    it('honors Retry-After on 429 responses', async () => {
        const delays = [];
        const api = createClient({
            cache: { enabled: false },
            retries: 3,
            retryDelay: 5,
            maxRetryAfter: 100,
            onRetry: (attempt, err, delay) => delays.push(delay)
        });
        await expect(api.get(`${srv.url}/api/limited`))
            .rejects.toMatchObject({ code: 'RESPONSE_ERROR', response: { status: 429 } });
        // onRetry fires once per failed attempt (3 attempts total)
        expect(delays.length).toBe(3);
        // server asked for 1s; the client caps it at maxRetryAfter (100ms)
        expect(delays.every((d) => d === 100)).toBe(true);
    });

    it('does not retry client errors (4xx) by default', async () => {
        const api = createClient({ cache: { enabled: false }, retries: 4, retryDelay: 1 });
        await expect(api.get(`${srv.url}/api/error/400`)).rejects.toMatchObject({ code: 'RESPONSE_ERROR' });
        expect(srv.getHits('/api/error/400')).toBe(1);
        expect(api.getMetrics().retries).toBe(0);
    });

    it('opens the circuit breaker after repeated failures, fails fast, then recovers', async () => {
        const opened = [];
        const api = createClient({
            cache: { enabled: false },
            retries: 1,
            circuitBreaker: { enabled: true, failureThreshold: 3, resetTimeout: 600 }
        });
        api.on('circuit:open', ({ domain }) => opened.push(domain));

        for (let i = 0; i < 3; i++) {
            await expect(api.get(`${srv.url}/api/error/503`)).rejects.toBeTruthy();
        }
        expect(srv.getHits('/api/error/503')).toBe(3);
        expect(api.getMetrics().circuitBreakers[0].state.state).toBe('OPEN');

        // while OPEN: rejected without touching the network
        await expect(api.get(`${srv.url}/api/error/503`))
            .rejects.toMatchObject({ code: 'CIRCUIT_BREAKER_ERROR' });
        expect(srv.getHits('/api/error/503')).toBe(3);

        // after the reset window: half-open probe succeeds -> closed again
        await new Promise((r) => setTimeout(r, 700));
        const version = await api.get(`${srv.url}/api/version`);
        expect(version.version).toBe('2.4.1');
        expect(api.getMetrics().circuitBreakers[0].state.state).toBe('CLOSED');
        expect(opened.length).toBeGreaterThan(0);
    });

    it('times out slow endpoints with a typed TIMEOUT_ERROR', async () => {
        const api = createClient({
            cache: { enabled: false },
            retries: 1,
            timeouts: { connect: 1000, response: 250, idle: 1000 }
        });
        const start = Date.now();
        await expect(api.get(`${srv.url}/api/slow?ms=3000`))
            .rejects.toMatchObject({ code: 'TIMEOUT_ERROR' });
        expect(Date.now() - start).toBeLessThan(1500);
    });

    it('aborts slow requests via AbortController', async () => {
        const api = createClient({ cache: { enabled: false }, retries: 1 });
        const ac = new AbortController();
        const p = api.get(`${srv.url}/api/slow?ms=5000`, { signal: ac.signal });
        setTimeout(() => ac.abort(), 50);
        const start = Date.now();
        await expect(p).rejects.toMatchObject({ code: 'ABORT_ERROR' });
        expect(Date.now() - start).toBeLessThan(1000);
    });
});

// ---------------------------------------------------------------------------
// ⚡ Concurrency, dedup and batch
// ---------------------------------------------------------------------------
describe('user journey: concurrency, dedup and batch', () => {
    it('collapses 10 identical concurrent GETs into a single server hit', async () => {
        const api = createClient({ cache: { enabled: false } });
        const results = await Promise.all(
            Array.from({ length: 10 }, () => api.get(`${srv.url}/api/products?page=1&per_page=3`))
        );
        results.forEach((r) => expect(r.items).toHaveLength(3));
        expect(srv.getHits('/api/products')).toBe(1);
    });

    it('does not deduplicate concurrent requests with different auth identities', async () => {
        const api = createClient({ cache: { enabled: false } });
        const { token: t1 } = await api.post(`${srv.url}/api/token`, { email: 'alice@swiftly.dev', password: 'secret' });
        const { token: t2 } = await api.post(`${srv.url}/api/token`, { email: 'bob@swiftly.dev', password: 'hunter2' });

        const [a, b] = await Promise.all([
            api.get(`${srv.url}/api/tenant`, { bearer: t1 }),
            api.get(`${srv.url}/api/tenant`, { bearer: t2 })
        ]);
        expect(a.tenant).toBe('alice@swiftly.dev');
        expect(b.tenant).toBe('bob@swiftly.dev');
        expect(srv.getHits('/api/tenant')).toBe(2);
    });

    it('runs a mixed batch and isolates per-request failures', async () => {
        const api = createClient({ cache: { enabled: false } });
        const results = await api.batch([
            { method: 'get', url: `${srv.url}/api/version` },
            { method: 'post', url: `${srv.url}/api/products`, data: { name: 'Unauth', price: 1 } },
            { method: 'get', url: `${srv.url}/api/products?per_page=2` },
            { method: 'delete', url: `${srv.url}/api/products/p1` } // no auth -> 401
        ]);
        expect(results[0].version).toBe('2.4.1');
        expect(results[1].error.code).toBe('RESPONSE_ERROR');
        expect(results[1].error.response.status).toBe(401);
        expect(results[2].items).toHaveLength(2);
        expect(results[3].error.code).toBe('RESPONSE_ERROR');
    });
});

// ---------------------------------------------------------------------------
// 📡 Streaming, SSE and downloads
// ---------------------------------------------------------------------------
describe('user journey: streaming, SSE and downloads', () => {
    it('consumes live SSE notifications and unsubscribes', async () => {
        const api = createClient({ cache: { enabled: false } });
        const messages = [];
        const unsub = await api.subscribe(`${srv.url}/api/notifications`, {
            onOpen: () => messages.push('OPEN'),
            onMessage: (m) => messages.push(m)
        });
        await new Promise((r) => setTimeout(r, 250));
        unsub();
        const events = messages.filter((m) => m && typeof m === 'object');
        expect(events.length).toBeGreaterThanOrEqual(4);
        expect(events[0].type).toBe('stock-update');
        expect(messages[0]).toBe('OPEN');
    });

    it('subscribes to an authenticated SSE stream using the client bearer token', async () => {
        const api = createClient({ cache: { enabled: false } });
        // register the token server-side the way the app would
        const { token } = await api.post(`${srv.url}/api/token`, { email: 'alice@swiftly.dev', password: 'secret' });
        api.setConfig({ bearer: token });

        const messages = [];
        const unsub = await api.subscribe(`${srv.url}/api/notifications-secure`, {
            onMessage: (m) => messages.push(m)
        });
        await new Promise((r) => setTimeout(r, 150));
        unsub();
        expect(messages.length).toBeGreaterThanOrEqual(2);
        expect(messages.every((m) => m.tenant === 'alice@swiftly.dev')).toBe(true);
    });

    it('downloads a binary file as a buffer', async () => {
        const api = createClient({ cache: { enabled: false } });
        const buf = await api.download(`${srv.url}/files/photo.png`);
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect(buf.length).toBe(64 * 1024);
        expect(buf[0]).toBe(0xAB);
    });

    it('streams a download to disk with progress reporting', async () => {
        const fs = await import('node:fs');
        const os = await import('node:os');
        const path = await import('node:path');
        const api = createClient({ cache: { enabled: false } });
        const progress = [];
        const file = path.join(os.tmpdir(), `swiftly-photo-${Date.now()}.png`);
        const res = await api.downloadTo(`${srv.url}/files/photo.png`, file, {
            onProgress: (p) => progress.push(p)
        });
        expect(res.bytes).toBe(64 * 1024);
        expect(fs.statSync(file).size).toBe(64 * 1024);
        expect(progress.some((p) => p.total === 64 * 1024 && p.loaded === p.total)).toBe(true);
        fs.unlinkSync(file);
    });

    it('streams a gzip-compressed response and decompresses on the fly', async () => {
        const api = createClient({ cache: { enabled: false } });
        const stream = await api.get(`${srv.url}/api/compressed/gzip`, { stream: true });
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        expect(body.ok).toBe(true);
        expect(body.type).toBe('gzip');
    });

    it('rejects a download when the server returns an error status', async () => {
        const api = createClient({ cache: { enabled: false } });
        await expect(api.downloadTo(`${srv.url}/api/error/404`, '/tmp/should-not-exist.bin'))
            .rejects.toMatchObject({ code: 'RESPONSE_ERROR' });
    });
});

// ---------------------------------------------------------------------------
// 🧩 GraphQL gateway
// ---------------------------------------------------------------------------
describe('user journey: GraphQL gateway', () => {
    it('queries the product list and a single product', async () => {
        const api = createClient({ cache: { enabled: false } });
        const list = await api.query(`${srv.url}/graphql`, {
            query: 'query { products { id name price } }'
        });
        expect(list.products).toHaveLength(5);
        expect(list.products[0].id).toBe('p1');

        const single = await api.query(`${srv.url}/graphql`, {
            query: 'query { product(id: "p4") { id name category } }'
        });
        expect(single.product.name).toBeTruthy();
        expect(single.product.category).toBeTruthy();
    });

    it('propagates GraphQL errors from the gateway', async () => {
        const api = createClient({ cache: { enabled: false } });
        try {
            await api.query(`${srv.url}/graphql`, { query: 'query { bogusField }' });
            throw new Error('expected query to reject');
        } catch (err) {
            expect(err.graphqlErrors).toBeTruthy();
            expect(err.graphqlErrors[0].message).toContain('bogusField');
        }
    });
});

// ---------------------------------------------------------------------------
// 📦 Compression
// ---------------------------------------------------------------------------
describe('user journey: compression', () => {
    it('transparently decompresses gzip, deflate and brotli responses', async () => {
        const api = createClient({ cache: { enabled: false } });
        for (const type of ['gzip', 'deflate', 'br']) {
            const body = await api.get(`${srv.url}/api/compressed/${type}`);
            expect(body.ok).toBe(true);
            expect(body.type).toBe(type);
            expect(body.data.length).toBe(4096);
        }
    });

    it('compresses large JSON request bodies with gzip and small ones stay identity', async () => {
        const api = createClient({ cache: { enabled: false } });
        const big = { payload: 'x'.repeat(3000), n: 1 };
        const bigEcho = await api.post(`${srv.url}/api/echo`, big);
        expect(bigEcho.contentEncoding).toBe('gzip');
        expect(bigEcho.body.payload).toBe(big.payload);

        const smallEcho = await api.post(`${srv.url}/api/echo`, { hello: 'world' });
        expect(['identity', null]).toContain(smallEcho.contentEncoding);
        expect(smallEcho.body.hello).toBe('world');
    });

    it('round-trips multipart/form-data uploads', async () => {
        const api = createClient({ cache: { enabled: false } });
        const echo = await api.post(`${srv.url}/api/echo`, {
            field: 'value',
            avatar: { name: 'avatar.png', type: 'image/png', buffer: Buffer.from([1, 2, 3, 4]) }
        }, { formData: true });
        expect(echo.contentType).toContain('multipart/form-data; boundary=');
        expect(echo.body).toContain('name="field"');
        expect(echo.body).toContain('filename="avatar.png"');
        // the file bytes must be uploaded, not the stringified object
        expect(echo.body).not.toContain('[object Object]');
        expect(echo.body.includes('\x01\x02\x03\x04')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 🔀 Redirects
// ---------------------------------------------------------------------------
describe('user journey: redirects', () => {
    it('follows a chain of redirects down to the resource', async () => {
        const api = createClient({ cache: { enabled: false } });
        const result = await api.get(`${srv.url}/api/redirect/3`);
        expect(result.items).toHaveLength(3);
        expect(api.getMetrics().redirects).toBe(3);
    });

    it('bails out with MAX_REDIRECTS on a redirect loop', async () => {
        const api = createClient({ cache: { enabled: false }, maxRedirects: 3, retries: 1 });
        await expect(api.get(`${srv.url}/api/redirect/loop`))
            .rejects.toMatchObject({ code: 'MAX_REDIRECTS' });
        expect(srv.getHits('/api/redirect/loop')).toBe(4); // initial + 3 hops
    });

    it('does not follow redirects when disabled', async () => {
        const api = createClient({ cache: { enabled: false }, followRedirects: false });
        const raw = await api.get(`${srv.url}/api/redirect/1`, { responseType: 'raw' });
        expect(raw.status).toBe(302);
        expect(raw.headers.location).toBe('/api/products?page=1&per_page=3');
    });
});

// ---------------------------------------------------------------------------
// 🧭 URL handling and params
// ---------------------------------------------------------------------------
describe('user journey: URL handling and params', () => {
    it('resolves relative URLs against baseURL', async () => {
        const api = createClient({ baseURL: srv.url, cache: { enabled: false } });
        const v1 = await api.get('/api/version');
        expect(v1.version).toBe('2.4.1');
        const v2 = await api.get('api/version');
        expect(v2.version).toBe('2.4.1');
    });

    it('serializes arrays and nested objects into query params', async () => {
        const api = createClient({ cache: { enabled: false } });
        const echo = await api.get(`${srv.url}/api/echo`, {
            params: { page: 1, tags: ['a', 'b'], filter: { active: true } }
        });
        expect(echo.query.page).toBe('1');
        expect(echo.query.tags).toBe('b'); // repeat keys: tags=a&tags=b
        expect(JSON.parse(echo.query.filter)).toEqual({ active: true });
    });

    it('supports arbitrary verbs through the low-level entry point', async () => {
        const api = createClient({ cache: { enabled: false } });
        const echo = await api.request('PURGE', `${srv.url}/api/echo`, null, {});
        expect(echo.method).toBe('PURGE');
    });

    it('honors config mutations when a config object is reused across calls', async () => {
        const api = createClient({ cache: { enabled: false } });
        const cfg = { responseType: 'text' };

        const r1 = await api.get(`${srv.url}/api/version`, cfg);
        expect(typeof r1).toBe('string'); // text

        // same object, different responseType -> the very same URL must now
        // come back as a raw envelope, not the stale 'text' merge
        cfg.responseType = 'raw';
        const r2 = await api.get(`${srv.url}/api/version`, cfg);
        expect(r2.status).toBe(200);
        expect(r2.data.version).toBe('2.4.1');
    });
});

// ---------------------------------------------------------------------------
// 🧪 Events, metrics and debugging
// ---------------------------------------------------------------------------
describe('user journey: events, metrics and debugging', () => {
    it('emits the full lifecycle and keeps sane metrics', async () => {
        const seen = [];
        const api = createClient({ cache: { enabled: true, ttl: 60000 } });
        api.on('request:start', (e) => seen.push(['start', e.url]));
        api.on('request:end', (e) => seen.push(['end', e.status]));
        api.on('cache:miss', () => seen.push(['miss']));
        api.on('cache:store', () => seen.push(['store']));
        api.on('cache:hit', () => seen.push(['hit']));

        await api.get(`${srv.url}/api/version`);
        await api.get(`${srv.url}/api/version`);

        expect(seen.filter((s) => s[0] === 'start')).toHaveLength(1);
        expect(seen.filter((s) => s[0] === 'end')).toHaveLength(1);
        expect(seen).toContainEqual(['miss']);
        expect(seen).toContainEqual(['store']);
        expect(seen).toContainEqual(['hit']);

        const m = api.getMetrics();
        expect(m.requestCount).toBe(1);
        expect(m.cacheHits).toBe(1);
        expect(m.cacheMisses).toBe(1);
        expect(m.averageResponseTime).toBeGreaterThan(0);
        expect(m.totalDataTransferred).toBeGreaterThan(0);
    });

    it('invalidates the cache with clearCache() so new data is seen', async () => {
        const api = createClient({ cache: { enabled: true, ttl: 60000 } });
        const before = (await api.get(`${srv.url}/api/products?per_page=1`)).total;
        await api.post(`${srv.url}/api/token`, { email: 'alice@swiftly.dev', password: 'secret' })
            .then(async ({ token }) => {
                api.setConfig({ bearer: token });
            });
        await api.post(`${srv.url}/api/products`, { name: 'Cache-Buster Mug', price: 9.99 });
        await api.clearCache();
        const after = (await api.get(`${srv.url}/api/products?per_page=1`)).total;
        expect(after).toBe(before + 1);
        // clean up the created product
        const found = await api.get(`${srv.url}/api/products?q=cache-buster&per_page=1`);
        await api.delete(`${srv.url}/api/products/${found.items[0].id}`);
    });
});

// ---------------------------------------------------------------------------
// 🧨 Typed errors & validation
// ---------------------------------------------------------------------------
describe('user journey: typed errors and validation', () => {
    it('surfaces RESPONSE_ERROR with the raw response attached', async () => {
        const api = createClient({ cache: { enabled: false }, retries: 1, retryDelay: 1 });
        try {
            await api.get(`${srv.url}/api/error/503`);
            throw new Error('expected rejection');
        } catch (err) {
            expect(err.code).toBe('RESPONSE_ERROR');
            expect(err.response.status).toBe(503);
            expect(err.response.data).toBeInstanceOf(Buffer);
        }
    });

    it('surfaces REQUEST_ERROR for connection-level failures', async () => {
        const api = createClient({ cache: { enabled: false }, retries: 1 });
        await expect(api.get('http://127.0.0.1:1/nope')).rejects.toMatchObject({
            code: 'REQUEST_ERROR'
        });
    });

    it('throws VALIDATION_ERROR for invalid inputs', async () => {
        const api = createClient({ cache: { enabled: false } });
        await expect(api.get(null)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(api.get(`${srv.url}/x`, { headers: { 'X-Foo': { bad: true } } }))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(api.get('relative/without/base')).rejects.toMatchObject({
            code: 'VALIDATION_ERROR'
        });
        // 'h'-prefixed strings are not URLs: they must fail with a typed
        // error, not a raw TypeError (regression: fast-path validation)
        await expect(api.get('hello')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(api.get('http//x.com')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});

// ---------------------------------------------------------------------------
// 🧠 Public API surface (index.mjs / index.cjs)
// ---------------------------------------------------------------------------
describe('user journey: public API surface', () => {
    it('exposes a working static scrape() helper', async () => {
        const title = await swiftly.scrape(`${srv.url}/product/p1`, 'h1.product-title');
        expect(Array.isArray(title)).toBe(true);
        expect(title[0].content).toBe('Turbo Hoodie 1');
    });

    it('exposes working instance helpers: scrape/parse/batch/download', async () => {
        const api = swiftly({ cache: { enabled: false } });
        const names = await api.scrape(`${srv.url}/catalog`, '.product-card .product-name');
        expect(names.length).toBeGreaterThan(0);

        const html = await api.get(`${srv.url}/catalog`, { responseType: 'text' });
        const parsed = api.parse(html, { first: '.product-card .product-name' });
        expect(parsed.first[0].content).toBe(names[0].content);

        const buf = await api.download(`${srv.url}/files/catalog.json`);
        expect(JSON.parse(buf.toString('utf-8')).length).toBe(5);
    });

    it('exposes a working static client with shared state', async () => {
        const shared = swiftly.client();
        expect(typeof shared.interceptors.request.use).toBe('function');
        const v = await swiftly.get(`${srv.url}/api/version`);
        expect(v.version).toBe('2.4.1');
    });
});

// ---------------------------------------------------------------------------
// 🩺 Deep-dive regressions found while probing more of the library
// ---------------------------------------------------------------------------
describe('deep-dive regressions', () => {
    it('runs response error interceptors and can recover the request', async () => {
        const api = createClient({ cache: { enabled: false }, retries: 1 });
        const seen = [];
        api.interceptors.response.use(
            (res) => res,
            (err) => {
                seen.push(err.response?.status);
                if (err.response && err.response.status === 401) {
                    // simulate a token refresh: recover with a 200 envelope
                    return {
                        data: Buffer.from(JSON.stringify({ recovered: true, from: 'interceptor' })),
                        status: 200,
                        headers: { 'content-type': 'application/json' }
                    };
                }
                throw err;
            }
        );
        const result = await api.get(`${srv.url}/api/me`); // 401 without a session
        expect(result).toEqual({ recovered: true, from: 'interceptor' });
        expect(seen).toEqual([401]);
    });

    it('still propagates errors when the response error interceptor rethrows', async () => {
        const api = createClient({ cache: { enabled: false }, retries: 1 });
        const seen = [];
        api.interceptors.response.use(
            (res) => res,
            (err) => { seen.push(err.code); throw err; }
        );
        await expect(api.get(`${srv.url}/api/error/500`))
            .rejects.toMatchObject({ code: 'RESPONSE_ERROR' });
        expect(seen).toEqual(['RESPONSE_ERROR']);
    });

    it('does not leak cached responses between a lowercase-auth request and an anonymous one', async () => {
        const api = createClient({ cache: { enabled: true, ttl: 60000 }, retries: 1 });
        const { token } = await api.post(`${srv.url}/api/token`, { email: 'alice@swiftly.dev', password: 'secret' });
        const authed = await api.get(`${srv.url}/api/tenant`, { headers: { authorization: `Bearer ${token}` } });
        expect(authed.tenant).toBe('alice@swiftly.dev');
        // anonymous request must NOT be served the authenticated cached body
        await expect(api.get(`${srv.url}/api/tenant`))
            .rejects.toMatchObject({ code: 'RESPONSE_ERROR', response: { status: 401 } });
        expect(srv.getHits('/api/tenant')).toBe(2);
    });

    it('honors per-request compression.request=false (no gzip upload)', async () => {
        const api = createClient({ cache: { enabled: false } });
        const big = { payload: 'z'.repeat(3000) };
        const gzipped = await api.post(`${srv.url}/api/echo`, big);
        expect(gzipped.contentEncoding).toBe('gzip');
        const plain = await api.post(`${srv.url}/api/echo`, big, { compression: { request: false } });
        expect(['identity', null]).toContain(plain.contentEncoding);
        expect(plain.body.payload).toBe(big.payload);
    });

    it('enforces the timeout option and aborts slow requests', async () => {
        const api = createClient({ cache: { enabled: false }, retries: 1, timeout: 250 });
        const start = Date.now();
        await expect(api.get(`${srv.url}/api/slow?ms=3000`))
            .rejects.toMatchObject({ code: 'TIMEOUT_ERROR' });
        expect(Date.now() - start).toBeLessThan(1500);
    });

    it('enforces maxContentLength on downloads', async () => {
        const api = createClient({ cache: { enabled: false }, retries: 1, maxContentLength: 1024 });
        await expect(api.download(`${srv.url}/files/photo.png`))
            .rejects.toMatchObject({ code: 'REQUEST_ERROR' });
    });

    it('enforces maxBodyLength on uploads', async () => {
        const api = createClient({ cache: { enabled: false }, retries: 1, maxBodyLength: 10 });
        await expect(api.post(`${srv.url}/api/echo`, { payload: 'x'.repeat(500) }))
            .rejects.toMatchObject({ code: 'REQUEST_ERROR' });
    });

    it('keeps cookies with the same name but different Paths separate', () => {
        const jar = createCookieJar();
        jar.setCookie('https://shop.test', 'sid=root; Path=/; HttpOnly');
        jar.setCookie('https://shop.test', 'sid=admin; Path=/admin');
        // RFC 6265: a Path=/ cookie also matches /admin, so BOTH are sent
        expect(jar.getCookies('https://shop.test/')).toBe('sid=root');
        expect(jar.getCookies('https://shop.test/admin')).toBe('sid=root; sid=admin');
        expect(jar.getCookies('https://shop.test/admin/settings')).toBe('sid=root; sid=admin');
        // a different path does NOT see the admin-only cookie
        expect(jar.getCookies('https://shop.test/products')).toBe('sid=root');
        // overwriting the same (name, path) still replaces the value in place
        jar.setCookie('https://shop.test', 'sid=root2; Path=/');
        expect(jar.getCookies('https://shop.test/')).toBe('sid=root2');
        expect(jar.getCookies('https://shop.test/admin')).toBe('sid=root2; sid=admin');
    });

    it('renders <pre><code> blocks as fenced code without inner backticks', () => {
        const md = htmlToMarkdown('<pre><code>const a = 1;\nconsole.log(a);</code></pre>');
        expect(md).toContain('```');
        expect(md).toContain('const a = 1;');
        expect(md).not.toContain('`const a');
    });

    it('extracts the selected option value from <select> fields', async () => {
        const { extractForms } = await import('../lib/extract.js');
        const html = '<form action="/submit">' +
            '<input name="user" value="ada">' +
            '<select name="role"><option value="admin">Admin</option><option value="staff">Staff</option></select>' +
            '<select name="region"><option>EU</option><option value="us" selected>US</option></select>' +
            '</form>';
        const fields = extractForms(html)[0].fields;
        expect(fields.find((f) => f.name === 'role').value).toBe('admin');
        expect(fields.find((f) => f.name === 'region').value).toBe('us');
        expect(fields.find((f) => f.name === 'user').value).toBe('ada');
    });
});
