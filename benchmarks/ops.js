// Swiftly benchmark — operation registry.
// Maps "(scenario, rowName)" -> { modules, build }.
// The worker imports ONLY the modules a given row declares, so each
// measurement runs in a clean, dedicated process (no cross-library GC/CPU
// interference). `build(libs, { base })` returns the async op fn `(i) => Promise`.

const SWIFTLY = '../index.mjs';
const EXTRACT = '../lib/extract.js';
const XML = '../lib/xml.js';
const CSV = '../lib/csv.js';
const JSONPATH = '../lib/jsonpath.js';
const HTTP = 'node:http';
const ZLIB = 'node:zlib';

const M = {
    swiftly: SWIFTLY,
    extract: EXTRACT,
    xml: XML,
    csv: CSV,
    jsonpath: JSONPATH,
    http: HTTP,
    zlib: ZLIB,
    axios: 'axios',
    got: 'got',
    nodefetch: 'node-fetch',
    superagent: 'superagent',
    ky: 'ky',
    undici: 'undici',
    cheerio: 'cheerio'
};

// All swift network calls must disable dedup so identical URLs aren't collapsed.
export const net = { cache: { enabled: false }, deduplicate: false };
const undiciNet = { ...net, transport: 'undici' };

// cheerio: the ESM module exposes `load`; fall back to the callable default.
const cheerioLoad = (cheerio) => (html) => (cheerio.load ? cheerio.load(html) : cheerio(html));

// Every module specifier is resolved relative to THIS file (benchmarks/).
export function resolveSpec(spec) {
    if (spec.startsWith('.')) return new URL(spec, import.meta.url).href;
    return spec;
}

const JOBS = {};

// ---------------------------------------------------------------------------
// 1. Simple JSON GET
// ---------------------------------------------------------------------------
JOBS['1:swiftly'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => () => swiftly.get(base + '/json', net) };
JOBS['1:swiftly (undici)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => () => swiftly.get(base + '/json', undiciNet) };
JOBS['1:raw http (ceiling)'] = { modules: { http: M.http }, build: ({ http }, { base }) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
    return () => new Promise((res, rej) => {
        http.get(base + '/json', { agent }, (r) => { r.resume(); r.on('end', res); }).on('error', rej);
    });
} };
JOBS['1:axios'] = { modules: { axios: M.axios, http: M.http }, build: ({ axios, http }, { base }) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
    const a = axios.default || axios;
    return () => a.get(base + '/json', { httpAgent: agent });
} };
JOBS['1:got'] = { modules: { got: M.got }, build: ({ got }, { base }) => {
    const g = got.default || got;
    return () => g(base + '/json');
} };
JOBS['1:node-fetch'] = { modules: { nodefetch: M.nodefetch }, build: ({ nodefetch }, { base }) => {
    const fetch = nodefetch.default || nodefetch;
    return () => fetch(base + '/json').then(r => r.text());
} };
JOBS['1:superagent'] = { modules: { superagent: M.superagent }, build: ({ superagent }, { base }) => {
    const sa = superagent.default || superagent;
    return () => sa.get(base + '/json');
} };
JOBS['1:undici'] = { modules: { undici: M.undici }, build: ({ undici }, { base }) => () => undici.request(base + '/json').then(r => r.body.json()) };

// ---------------------------------------------------------------------------
// 2. POST JSON (serialization)
// ---------------------------------------------------------------------------
const POST_PAYLOAD = { user: 'alice', roles: ['admin', 'editor'], note: 'x'.repeat(500) };
JOBS['2:swiftly'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => () => swiftly.post(base + '/post', POST_PAYLOAD, net) };
JOBS['2:swiftly (undici)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => () => swiftly.post(base + '/post', POST_PAYLOAD, undiciNet) };
JOBS['2:raw http (ceiling)'] = { modules: { http: M.http }, build: ({ http }, { base }) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
    return () => new Promise((res, rej) => {
        const req = http.request(base + '/post', { method: 'POST', agent, headers: { 'Content-Type': 'application/json' } }, (r) => { r.resume(); r.on('end', res); });
        req.on('error', rej);
        req.end(JSON.stringify(POST_PAYLOAD));
    });
} };
JOBS['2:axios'] = { modules: { axios: M.axios, http: M.http }, build: ({ axios, http }, { base }) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
    const a = axios.default || axios;
    return () => a.post(base + '/post', POST_PAYLOAD, { httpAgent: agent });
} };
JOBS['2:got'] = { modules: { got: M.got }, build: ({ got }, { base }) => {
    const g = got.default || got;
    return () => g.post(base + '/post', { json: POST_PAYLOAD });
} };
JOBS['2:node-fetch'] = { modules: { nodefetch: M.nodefetch }, build: ({ nodefetch }, { base }) => {
    const fetch = nodefetch.default || nodefetch;
    return () => fetch(base + '/post', { method: 'POST', body: JSON.stringify(POST_PAYLOAD), headers: { 'Content-Type': 'application/json' } }).then(r => r.text());
} };
JOBS['2:superagent'] = { modules: { superagent: M.superagent }, build: ({ superagent }, { base }) => {
    const sa = superagent.default || superagent;
    return () => sa.post(base + '/post').send(POST_PAYLOAD);
} };
JOBS['2:undici'] = { modules: { undici: M.undici }, build: ({ undici }, { base }) => () => undici.request(base + '/post', { method: 'POST', body: JSON.stringify(POST_PAYLOAD), headers: { 'Content-Type': 'application/json' } }).then(r => r.body.json()) };

// ---------------------------------------------------------------------------
// 3. gzip decompression
// ---------------------------------------------------------------------------
JOBS['3:swiftly'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => () => swiftly.get(base + '/gzip', net) };
JOBS['3:swiftly (undici)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => () => swiftly.get(base + '/gzip', undiciNet) };
JOBS['3:raw + gunzip (ceiling)'] = { modules: { http: M.http, zlib: M.zlib }, build: ({ http, zlib }, { base }) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
    return () => new Promise((res, rej) => {
        http.get(base + '/gzip', { agent }, (r) => {
            const chunks = [];
            r.on('data', (c) => chunks.push(c));
            r.on('end', () => { zlib.gunzipSync(Buffer.concat(chunks)); res(); });
        }).on('error', rej);
    });
} };
JOBS['3:got'] = { modules: { got: M.got }, build: ({ got }, { base }) => {
    const g = got.default || got;
    return () => g(base + '/gzip');
} };
JOBS['3:superagent'] = { modules: { superagent: M.superagent }, build: ({ superagent }, { base }) => {
    const sa = superagent.default || superagent;
    return () => sa.get(base + '/gzip');
} };
JOBS['3:node-fetch (auto)'] = { modules: { nodefetch: M.nodefetch }, build: ({ nodefetch }, { base }) => {
    const fetch = nodefetch.default || nodefetch;
    return () => fetch(base + '/gzip').then(r => r.text());
} };
JOBS['3:undici (fetch)'] = { modules: { undici: M.undici }, build: ({ undici }, { base }) => () => undici.fetch(base + '/gzip').then(r => r.text()) };
JOBS['3:ky'] = { modules: { ky: M.ky }, build: ({ ky }, { base }) => {
    const k = ky.default || ky;
    return () => k(base + '/gzip').json();
} };

// ---------------------------------------------------------------------------
// 4. Large JSON (100 KB) parsing
// ---------------------------------------------------------------------------
JOBS['4:swiftly'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => () => swiftly.get(base + '/big', net) };
JOBS['4:swiftly (undici)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => () => swiftly.get(base + '/big', undiciNet) };
JOBS['4:raw + JSON.parse (ceiling)'] = { modules: { http: M.http }, build: ({ http }, { base }) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
    return () => new Promise((res, rej) => {
        http.get(base + '/big', { agent }, (r) => {
            const chunks = [];
            r.on('data', (c) => chunks.push(c));
            r.on('end', () => { JSON.parse(Buffer.concat(chunks).toString()); res(); });
        }).on('error', rej);
    });
} };
JOBS['4:axios'] = { modules: { axios: M.axios, http: M.http }, build: ({ axios, http }, { base }) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
    const a = axios.default || axios;
    return () => a.get(base + '/big', { httpAgent: agent });
} };
JOBS['4:got'] = { modules: { got: M.got }, build: ({ got }, { base }) => {
    const g = got.default || got;
    return () => g(base + '/big');
} };
JOBS['4:superagent'] = { modules: { superagent: M.superagent }, build: ({ superagent }, { base }) => {
    const sa = superagent.default || superagent;
    return () => sa.get(base + '/big');
} };
JOBS['4:undici'] = { modules: { undici: M.undici }, build: ({ undici }, { base }) => () => undici.request(base + '/big').then(r => r.body.json()) };
JOBS['4:ky'] = { modules: { ky: M.ky }, build: ({ ky }, { base }) => {
    const k = ky.default || ky;
    return () => k(base + '/big').json();
} };

// ---------------------------------------------------------------------------
// 5. HTML scraper (multi-selector)
// ---------------------------------------------------------------------------
const SCRAPE_SELECTORS = {
    title: 'h1#main',
    cards: { selector: '.card .title', type: 'text' },
    prices: { selector: '.card .price', type: 'text' }
};
const scrapeHtml = (parseHTML, html, selectors) => parseHTML(html, selectors);
const cheerioScrape = ($, html) => {
    const doc = $(html);
    return {
        title: doc('h1#main').text(),
        cards: doc('.card .title').map((i, el) => doc(el).text()).get(),
        prices: doc('.card .price').map((i, el) => doc(el).text()).get()
    };
};
JOBS['5:swiftly (parseHTML)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => {
    const parseHTML = swiftly.parseHTML || null;
    return async () => {
        const html = await swiftly.get(base + '/html', { ...net, responseType: 'text' });
        return scrapeHtml(parseHTML, html, SCRAPE_SELECTORS);
    };
} };
JOBS['5:swiftly (undici + parseHTML)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => {
    const parseHTML = swiftly.parseHTML || null;
    return async () => {
        const html = await swiftly.get(base + '/html', { ...undiciNet, responseType: 'text' });
        return scrapeHtml(parseHTML, html, SCRAPE_SELECTORS);
    };
} };
JOBS['5:axios + cheerio'] = { modules: { axios: M.axios, cheerio: M.cheerio, http: M.http }, build: ({ axios, cheerio, http }, { base }) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
    const a = axios.default || axios;
    const $ = cheerioLoad(cheerio);
    return async () => {
        const html = await a.get(base + '/html', { httpAgent: agent, transformResponse: [d => d] });
        return cheerioScrape($, html.data);
    };
} };
JOBS['5:got + cheerio'] = { modules: { got: M.got, cheerio: M.cheerio }, build: ({ got, cheerio }, { base }) => {
    const g = got.default || got;
    const $ = cheerioLoad(cheerio);
    return async () => cheerioScrape($, await g(base + '/html'));
} };
JOBS['5:superagent + cheerio'] = { modules: { superagent: M.superagent, cheerio: M.cheerio }, build: ({ superagent, cheerio }, { base }) => {
    const sa = superagent.default || superagent;
    const $ = cheerioLoad(cheerio);
    return async () => cheerioScrape($, (await sa.get(base + '/html')).text);
} };
JOBS['5:node-fetch + cheerio'] = { modules: { nodefetch: M.nodefetch, cheerio: M.cheerio }, build: ({ nodefetch, cheerio }, { base }) => {
    const fetch = nodefetch.default || nodefetch;
    const $ = cheerioLoad(cheerio);
    return async () => cheerioScrape($, await fetch(base + '/html').then(r => r.text()));
} };
JOBS['5:ky + cheerio'] = { modules: { ky: M.ky, cheerio: M.cheerio }, build: ({ ky, cheerio }, { base }) => {
    const k = ky.default || ky;
    const $ = cheerioLoad(cheerio);
    return async () => cheerioScrape($, await k(base + '/html').text());
} };
JOBS['5:undici + cheerio'] = { modules: { undici: M.undici, cheerio: M.cheerio }, build: ({ undici, cheerio }, { base }) => {
    const $ = cheerioLoad(cheerio);
    return async () => cheerioScrape($, await undici.request(base + '/html').then(r => r.body.text()));
} };

// ---------------------------------------------------------------------------
// 6. batch (8 parallel GETs per call)
// ---------------------------------------------------------------------------
const BATCH_SIZE = 8;
const batchUrls = (base) => Array.from({ length: BATCH_SIZE }, () => base + '/json');
JOBS['6:swiftly (batch)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => () => swiftly.batch(batchUrls(base).map(u => ({ method: 'GET', url: u, config: net }))) };
JOBS['6:swiftly (undici + batch)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => () => swiftly.batch(batchUrls(base).map(u => ({ method: 'GET', url: u, config: undiciNet }))) };
const allOf = (map, fn) => () => Promise.all(map.map(fn));
JOBS['6:axios (Promise.all)'] = { modules: { axios: M.axios, http: M.http }, build: ({ axios, http }, { base }) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
    const a = axios.default || axios;
    return allOf(batchUrls(base), (u) => a.get(u, { httpAgent: agent }));
} };
JOBS['6:got (Promise.all)'] = { modules: { got: M.got }, build: ({ got }, { base }) => {
    const g = got.default || got;
    return allOf(batchUrls(base), (u) => g(u));
} };
JOBS['6:node-fetch (all)'] = { modules: { nodefetch: M.nodefetch }, build: ({ nodefetch }, { base }) => {
    const fetch = nodefetch.default || nodefetch;
    return allOf(batchUrls(base), (u) => fetch(u).then(r => r.text()));
} };
JOBS['6:superagent (all)'] = { modules: { superagent: M.superagent }, build: ({ superagent }, { base }) => {
    const sa = superagent.default || superagent;
    return allOf(batchUrls(base), (u) => sa.get(u));
} };
JOBS['6:ky (all)'] = { modules: { ky: M.ky }, build: ({ ky }, { base }) => {
    const k = ky.default || ky;
    return allOf(batchUrls(base), (u) => k(u).json());
} };
JOBS['6:undici (all)'] = { modules: { undici: M.undici }, build: ({ undici }, { base }) => allOf(batchUrls(base), (u) => undici.request(u).then(r => r.body.json())) };

// ---------------------------------------------------------------------------
// 7. download (binary 1 KB → Buffer)
// ---------------------------------------------------------------------------
JOBS['7:swiftly (download)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => () => swiftly.download(base + '/bin', net) };
JOBS['7:swiftly (undici + download)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => () => swiftly.download(base + '/bin', undiciNet) };
JOBS['7:node-fetch (arrayBuffer)'] = { modules: { nodefetch: M.nodefetch }, build: ({ nodefetch }, { base }) => {
    const fetch = nodefetch.default || nodefetch;
    return () => fetch(base + '/bin').then(r => r.arrayBuffer());
} };
JOBS['7:axios (arraybuffer)'] = { modules: { axios: M.axios, http: M.http }, build: ({ axios, http }, { base }) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
    const a = axios.default || axios;
    return () => a.get(base + '/bin', { httpAgent: agent, responseType: 'arraybuffer' });
} };
JOBS['7:got (buffer)'] = { modules: { got: M.got }, build: ({ got }, { base }) => {
    const g = got.default || got;
    return () => g(base + '/bin', { responseType: 'buffer' });
} };
JOBS['7:superagent (buffer)'] = { modules: { superagent: M.superagent }, build: ({ superagent }, { base }) => {
    const sa = superagent.default || superagent;
    return () => sa.get(base + '/bin').buffer(true);
} };
JOBS['7:ky (arrayBuffer)'] = { modules: { ky: M.ky }, build: ({ ky }, { base }) => {
    const k = ky.default || ky;
    return () => k(base + '/bin').arrayBuffer();
} };
JOBS['7:undici (arrayBuffer)'] = { modules: { undici: M.undici }, build: ({ undici }, { base }) => () => undici.request(base + '/bin').then(r => r.body.arrayBuffer()) };

// ---------------------------------------------------------------------------
// 8. retries (each request fails once, recovers)
// ---------------------------------------------------------------------------
const retrying = (impl, retries = 2) => async (url, cfg) => {
    let err;
    for (let i = 0; i <= retries; i++) {
        try { return await impl(url, cfg); } catch (e) { err = e; }
    }
    throw err;
};
JOBS['8:swiftly (retry)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => {
    const counter = { v: 0 };
    return () => {
        const id = counter.v++;
        // retryDelay: 0 measures the retry MECHANISM (re-send + status handling),
        // matching the immediate-retry loops of the competitors. Production
        // backoff (default 1000ms linear) is intentionally excluded here.
        return swiftly.get(`${base}/flaky/${id}`, { ...net, retries: 2, retryDelay: 0 });
    };
} };
JOBS['8:swiftly (undici + retry)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => {
    const counter = { v: 0 };
    return () => {
        const id = counter.v++;
        return swiftly.get(`${base}/flaky/${id}`, { ...undiciNet, retries: 2, retryDelay: 0 });
    };
} };
JOBS['8:axios + retry loop'] = { modules: { axios: M.axios, http: M.http }, build: ({ axios, http }, { base }) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
    const a = axios.default || axios;
    const counter = { v: 0 };
    return retrying(() => {
        const id = counter.v++;
        return a.get(`${base}/flaky/${id}`, { httpAgent: agent });
    }, 2);
} };
JOBS['8:got (retry)'] = { modules: { got: M.got }, build: ({ got }, { base }) => {
    const g = got.default || got;
    const counter = { v: 0 };
    return () => {
        const id = counter.v++;
        return g(`${base}/flaky/${id}`, { retry: { limit: 2 } });
    };
} };
JOBS['8:node-fetch + retry loop'] = { modules: { nodefetch: M.nodefetch }, build: ({ nodefetch }, { base }) => {
    const fetch = nodefetch.default || nodefetch;
    const counter = { v: 0 };
    return retrying(async () => {
        const id = counter.v++;
        const res = await fetch(`${base}/flaky/${id}`);
        const text = await res.text(); // consume body (failures too) so sockets release
        if (!res.ok) throw new Error(text);
        return text;
    }, 2);
} };
JOBS['8:superagent (.retry)'] = { modules: { superagent: M.superagent }, build: ({ superagent }, { base }) => {
    const sa = superagent.default || superagent;
    const counter = { v: 0 };
    return () => {
        const id = counter.v++;
        return sa.get(`${base}/flaky/${id}`).retry(2).catch(() => {});
    };
} };
JOBS['8:ky + retry loop'] = { modules: { ky: M.ky }, build: ({ ky }, { base }) => {
    const k = ky.default || ky;
    const counter = { v: 0 };
    return retrying(() => {
        const id = counter.v++;
        return k(`${base}/flaky/${id}`);
    }, 2);
} };
JOBS['8:undici + retry loop'] = { modules: { undici: M.undici }, build: ({ undici }, { base }) => {
    const counter = { v: 0 };
    return retrying(async () => {
        const id = counter.v++;
        const res = await undici.request(`${base}/flaky/${id}`);
        const text = await res.body.text(); // consume body (failures too) so sockets release
        if (res.statusCode >= 400) throw new Error(text);
        return text;
    }, 2);
} };

// ---------------------------------------------------------------------------
// 9. rate limiting (high limit → overhead only)
// ---------------------------------------------------------------------------
const limited = (impl, perSec = 1e9) => {
    let last = Date.now();
    return async (i) => {
        const now = Date.now();
        if (now - last >= 1000 / perSec) last = now;
        return impl();
    };
};
JOBS['9:swiftly (rate-limited)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => {
    const rc = swiftly({ debug: false, rateLimiting: { enabled: true, requestsPerSecond: 1e9 } });
    return () => rc.get(base + '/json', net);
} };
JOBS['9:swiftly (undici + rate-limit)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => {
    const rc = swiftly({ debug: false, rateLimiting: { enabled: true, requestsPerSecond: 1e9 } });
    return () => rc.get(base + '/json', undiciNet);
} };
JOBS['9:axios + limiter'] = { modules: { axios: M.axios, http: M.http }, build: ({ axios, http }, { base }) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
    const a = axios.default || axios;
    return limited(() => a.get(base + '/json', { httpAgent: agent }));
} };
JOBS['9:got + limiter'] = { modules: { got: M.got }, build: ({ got }, { base }) => {
    const g = got.default || got;
    return limited(() => g(base + '/json'));
} };
JOBS['9:node-fetch + limiter'] = { modules: { nodefetch: M.nodefetch }, build: ({ nodefetch }, { base }) => {
    const fetch = nodefetch.default || nodefetch;
    return limited(() => fetch(base + '/json').then(r => r.text()));
} };
JOBS['9:superagent + limiter'] = { modules: { superagent: M.superagent }, build: ({ superagent }, { base }) => {
    const sa = superagent.default || superagent;
    return limited(() => sa.get(base + '/json'));
} };
JOBS['9:ky + limiter'] = { modules: { ky: M.ky }, build: ({ ky }, { base }) => {
    const k = ky.default || ky;
    return limited(() => k(base + '/json').json());
} };
JOBS['9:undici + limiter'] = { modules: { undici: M.undici }, build: ({ undici }, { base }) => limited(() => undici.request(base + '/json').then(r => r.body.json())) };

// ---------------------------------------------------------------------------
// 10. mixed workload (GET+POST+text+scrape+download)
// ---------------------------------------------------------------------------
const mixed = (ops) => (i) => ops[i % 5]();
JOBS['10:swiftly (mixed)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => mixed([
    () => swiftly.get(base + '/json', net),
    () => swiftly.post(base + '/post', { a: 1, b: 'x'.repeat(100) }, net),
    () => swiftly.get(base + '/text', { ...net, responseType: 'text' }),
    () => swiftly.get(base + '/html', { ...net, responseType: 'text' }).then(h => swiftly.parseHTML ? swiftly.parseHTML(h, { t: 'h1#main' }) : h),
    () => swiftly.download(base + '/bin', net)
]) };
JOBS['10:swiftly (undici + mixed)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => mixed([
    () => swiftly.get(base + '/json', undiciNet),
    () => swiftly.post(base + '/post', { a: 1, b: 'x'.repeat(100) }, undiciNet),
    () => swiftly.get(base + '/text', { ...undiciNet, responseType: 'text' }),
    () => swiftly.get(base + '/html', { ...undiciNet, responseType: 'text' }).then(h => swiftly.parseHTML ? swiftly.parseHTML(h, { t: 'h1#main' }) : h),
    () => swiftly.download(base + '/bin', undiciNet)
]) };
JOBS['10:axios (mixed)'] = { modules: { axios: M.axios, http: M.http }, build: ({ axios, http }, { base }) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
    const a = axios.default || axios;
    return mixed([
        () => a.get(base + '/json', { httpAgent: agent }),
        () => a.post(base + '/post', { a: 1, b: 'x'.repeat(100) }, { httpAgent: agent }),
        () => a.get(base + '/text', { httpAgent: agent }),
        () => a.get(base + '/html', { httpAgent: agent }),
        () => a.get(base + '/bin', { httpAgent: agent, responseType: 'arraybuffer' })
    ]);
} };
JOBS['10:got (mixed)'] = { modules: { got: M.got }, build: ({ got }, { base }) => {
    const g = got.default || got;
    return mixed([
        () => g(base + '/json'),
        () => g.post(base + '/post', { json: { a: 1, b: 'x'.repeat(100) } }),
        () => g(base + '/text'),
        () => g(base + '/html'),
        () => g(base + '/bin', { responseType: 'buffer' })
    ]);
} };
JOBS['10:node-fetch (mixed)'] = { modules: { nodefetch: M.nodefetch }, build: ({ nodefetch }, { base }) => {
    const fetch = nodefetch.default || nodefetch;
    return mixed([
        () => fetch(base + '/json').then(r => r.text()),
        () => fetch(base + '/post', { method: 'POST', body: JSON.stringify({ a: 1 }) }).then(r => r.text()),
        () => fetch(base + '/text').then(r => r.text()),
        () => fetch(base + '/html').then(r => r.text()),
        () => fetch(base + '/bin').then(r => r.arrayBuffer())
    ]);
} };
JOBS['10:superagent (mixed)'] = { modules: { superagent: M.superagent }, build: ({ superagent }, { base }) => {
    const sa = superagent.default || superagent;
    return mixed([
        () => sa.get(base + '/json'),
        () => sa.post(base + '/post').send({ a: 1 }),
        () => sa.get(base + '/text'),
        () => sa.get(base + '/html'),
        () => sa.get(base + '/bin').buffer(true)
    ]);
} };
JOBS['10:ky (mixed)'] = { modules: { ky: M.ky }, build: ({ ky }, { base }) => {
    const k = ky.default || ky;
    return mixed([
        () => k(base + '/json').json(),
        () => k(base + '/post', { method: 'POST', json: { a: 1 } }).json(),
        () => k(base + '/text').text(),
        () => k(base + '/html').text(),
        () => k(base + '/bin').arrayBuffer()
    ]);
} };
JOBS['10:undici (mixed)'] = { modules: { undici: M.undici }, build: ({ undici }, { base }) => mixed([
    () => undici.request(base + '/json').then(r => r.body.json()),
    () => undici.request(base + '/post', { method: 'POST', body: JSON.stringify({ a: 1 }), headers: { 'Content-Type': 'application/json' } }).then(r => r.body.json()),
    () => undici.request(base + '/text').then(r => r.body.text()),
    () => undici.request(base + '/html').then(r => r.body.text()),
    () => undici.request(base + '/bin').then(r => r.body.arrayBuffer())
]) };

// ---------------------------------------------------------------------------
// 11. COMPLEX: e-commerce checkout flow (5 sequential requests per iteration)
// ---------------------------------------------------------------------------
const flow = (get, post, base) => (i) => {
    const suffix = `?cart=${i}`;
    return get(base + '/json' + suffix)
        .then(() => post(base + '/post', { item: 'sku-123', qty: 1, cart: i }))
        .then(() => get(base + '/json/cart' + suffix))
        .then(() => post(base + '/post', { checkout: true, cart: i }))
        .then(() => get(base + '/json/receipt' + suffix));
};
JOBS['11:swiftly (flow)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => flow(
    (u) => swiftly.get(u, net),
    (u, d) => swiftly.post(u, d, net),
    base
) };
JOBS['11:swiftly (undici + flow)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => flow(
    (u) => swiftly.get(u, undiciNet),
    (u, d) => swiftly.post(u, d, undiciNet),
    base
) };
JOBS['11:axios (flow)'] = { modules: { axios: M.axios, http: M.http }, build: ({ axios, http }, { base }) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
    const a = axios.default || axios;
    return flow(
        (u) => a.get(u, { httpAgent: agent }),
        (u, d) => a.post(u, d, { httpAgent: agent }),
        base
    );
} };
JOBS['11:got (flow)'] = { modules: { got: M.got }, build: ({ got }, { base }) => {
    const g = got.default || got;
    return flow(
        (u) => g(u),
        (u, d) => g.post(u, { json: d }),
        base
    );
} };
JOBS['11:node-fetch (flow)'] = { modules: { nodefetch: M.nodefetch }, build: ({ nodefetch }, { base }) => {
    const fetch = nodefetch.default || nodefetch;
    return flow(
        (u) => fetch(u).then(r => r.text()),
        (u, d) => fetch(u, { method: 'POST', body: JSON.stringify(d) }).then(r => r.text()),
        base
    );
} };
JOBS['11:superagent (flow)'] = { modules: { superagent: M.superagent }, build: ({ superagent }, { base }) => {
    const sa = superagent.default || superagent;
    return flow(
        (u) => sa.get(u),
        (u, d) => sa.post(u).send(d),
        base
    );
} };
JOBS['11:undici (flow)'] = { modules: { undici: M.undici }, build: ({ undici }, { base }) => flow(
    (u) => undici.request(u).then(r => r.body.json()),
    (u, d) => undici.request(u, { method: 'POST', body: JSON.stringify(d), headers: { 'Content-Type': 'application/json' } }).then(r => r.body.json()),
    base
) };

// ---------------------------------------------------------------------------
// 12. COMPLEX: paginated aggregation (5 pages/flow)
// ---------------------------------------------------------------------------
const paginate = (get, base) => async () => {
    const all = [];
    for (let page = 0; page < 5; page++) {
        all.push(await get(`${base}/json?page=${page}`));
    }
    return all;
};
JOBS['12:swiftly (pagination)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => paginate((u) => swiftly.get(u, net), base) };
JOBS['12:swiftly (undici + pagination)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => paginate((u) => swiftly.get(u, undiciNet), base) };
JOBS['12:axios (pagination)'] = { modules: { axios: M.axios, http: M.http }, build: ({ axios, http }, { base }) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
    const a = axios.default || axios;
    return paginate((u) => a.get(u, { httpAgent: agent }), base);
} };
JOBS['12:got (pagination)'] = { modules: { got: M.got }, build: ({ got }, { base }) => {
    const g = got.default || got;
    return paginate((u) => g(u), base);
} };
JOBS['12:node-fetch (pagination)'] = { modules: { nodefetch: M.nodefetch }, build: ({ nodefetch }, { base }) => {
    const fetch = nodefetch.default || nodefetch;
    return paginate((u) => fetch(u).then(r => r.text()), base);
} };
JOBS['12:superagent (pagination)'] = { modules: { superagent: M.superagent }, build: ({ superagent }, { base }) => {
    const sa = superagent.default || superagent;
    return paginate((u) => sa.get(u), base);
} };
JOBS['12:undici (pagination)'] = { modules: { undici: M.undici }, build: ({ undici }, { base }) => paginate((u) => undici.request(u).then(r => r.body.json()), base) };

// ---------------------------------------------------------------------------
// 13. COMPLEX: scraping at scale (fetch + parse + extract)
// ---------------------------------------------------------------------------
const SCALE_SELECTORS = {
    title: 'h1#main',
    items: { selector: '.card .title', type: 'text' },
    prices: { selector: '.card .price', type: 'text' }
};
JOBS['13:swiftly (scrape-at-scale)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => async () => {
    const html = await swiftly.get(base + '/html', { ...net, responseType: 'text' });
    const out = swiftly.parseHTML(html, SCALE_SELECTORS);
    return out.items.length + out.prices.length;
} };
JOBS['13:swiftly (undici + scale)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => async () => {
    const html = await swiftly.get(base + '/html', { ...undiciNet, responseType: 'text' });
    const out = swiftly.parseHTML(html, SCALE_SELECTORS);
    return out.items.length + out.prices.length;
} };
JOBS['13:got + cheerio (scale)'] = { modules: { got: M.got, cheerio: M.cheerio }, build: ({ got, cheerio }, { base }) => {
    const g = got.default || got;
    const $ = cheerioLoad(cheerio);
    return async () => {
        const html = await g(base + '/html');
        return $(html)('.card').length;
    };
} };
JOBS['13:axios + cheerio (scale)'] = { modules: { axios: M.axios, cheerio: M.cheerio, http: M.http }, build: ({ axios, cheerio, http }, { base }) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
    const a = axios.default || axios;
    const $ = cheerioLoad(cheerio);
    return async () => {
        const html = await a.get(base + '/html', { httpAgent: agent, transformResponse: [d => d] });
        return $(html.data)('.card').length;
    };
} };
JOBS['13:undici + cheerio (scale)'] = { modules: { undici: M.undici, cheerio: M.cheerio }, build: ({ undici, cheerio }, { base }) => {
    const $ = cheerioLoad(cheerio);
    return async () => {
        const html = await undici.request(base + '/html').then(r => r.body.text());
        return $(html)('.card').length;
    };
} };
JOBS['13:node-fetch + cheerio (scale)'] = { modules: { nodefetch: M.nodefetch, cheerio: M.cheerio }, build: ({ nodefetch, cheerio }, { base }) => {
    const fetch = nodefetch.default || nodefetch;
    const $ = cheerioLoad(cheerio);
    return async () => {
        const html = await fetch(base + '/html').then(r => r.text());
        return $(html)('.card').length;
    };
} };

// ---------------------------------------------------------------------------
// 14. Parsing & extraction toolkit (HTML+XML+CSV+JSONPath)
// ---------------------------------------------------------------------------
const XML_SAMPLE = '<catalog><item id="1"><name>A</name><price>10</price></item><item id="2"><name>B</name><price>20</price></item></catalog>';
const CSV_SAMPLE = 'name,price\nA,10\nB,20';
const JSON_DATA = { products: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] };
const TK_SELECTORS = { t: 'h1#main', cards: { selector: '.card .title', type: 'text' } };
JOBS['14:swiftly (HTML parse)'] = { modules: { swiftly: M.swiftly, extract: M.extract }, build: ({ swiftly, extract }, { base }) => async () => {
    const html = await swiftly.get(base + '/html', { ...net, responseType: 'text' });
    const out = swiftly.parseHTML(html, TK_SELECTORS);
    return out.cards.length + extract.extractText(html).length;
} };
JOBS['14:swiftly undici (HTML parse)'] = { modules: { swiftly: M.swiftly, extract: M.extract }, build: ({ swiftly, extract }, { base }) => async () => {
    const html = await swiftly.get(base + '/html', { ...undiciNet, responseType: 'text' });
    const out = swiftly.parseHTML(html, TK_SELECTORS);
    return out.cards.length + extract.extractText(html).length;
} };
JOBS['14:swiftly (full 6-parser suite)'] = { modules: { swiftly: M.swiftly, extract: M.extract, xml: M.xml, csv: M.csv, jsonpath: M.jsonpath }, build: ({ swiftly, extract, xml, csv, jsonpath }, { base }) => async () => {
    const html = await swiftly.get(base + '/html', { ...net, responseType: 'text' });
    const els = swiftly.parseHTML(html, TK_SELECTORS);
    const text = extract.extractText(html);
    const md = extract.htmlToMarkdown(html);
    const x = xml.parseXML(XML_SAMPLE);
    const c = csv.parseCSV(CSV_SAMPLE);
    const jp = jsonpath.queryJSON(JSON_DATA, 'products[*].id');
    return els.cards.length + text.length + md.length + x.catalog + c.length + jp.length;
} };
JOBS['14:got + cheerio (extract)'] = { modules: { got: M.got, cheerio: M.cheerio }, build: ({ got, cheerio }, { base }) => {
    const g = got.default || got;
    const $ = cheerioLoad(cheerio);
    return async () => {
        const html = await g(base + '/html');
        const doc = $(html);
        const cards = doc('.card .title').map((i, el) => doc(el).text()).get();
        return cards.length + doc.text().length;
    };
} };
JOBS['14:axios + cheerio (extract)'] = { modules: { axios: M.axios, cheerio: M.cheerio, http: M.http }, build: ({ axios, cheerio, http }, { base }) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
    const a = axios.default || axios;
    const $ = cheerioLoad(cheerio);
    return async () => {
        const html = await a.get(base + '/html', { httpAgent: agent, transformResponse: [d => d] });
        return $(html.data)('.card').length;
    };
} };
JOBS['14:undici + cheerio (extract)'] = { modules: { undici: M.undici, cheerio: M.cheerio }, build: ({ undici, cheerio }, { base }) => {
    const $ = cheerioLoad(cheerio);
    return async () => {
        const html = await undici.request(base + '/html').then(r => r.body.text());
        return $(html)('.card').length;
    };
} };

// ---------------------------------------------------------------------------
// 15. Connection reuse (keepAlive pooling)
// ---------------------------------------------------------------------------
JOBS['15:swiftly (keepAlive)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => () => swiftly.get(base + '/json', net) };
JOBS['15:swiftly (no pool)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => () => swiftly.get(base + '/json', { ...net, keepAlive: false }) };
JOBS['15:swiftly (undici keepAlive)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => () => swiftly.get(base + '/json', undiciNet) };
JOBS['15:undici (keepAlive)'] = { modules: { undici: M.undici }, build: ({ undici }, { base }) => {
    const dispatcher = new undici.Agent({ keepAliveTimeout: 60e3 });
    return () => undici.request(base + '/json', { dispatcher }).then(r => r.body.json());
} };
JOBS['15:undici (default)'] = { modules: { undici: M.undici }, build: ({ undici }, { base }) => () => undici.request(base + '/json').then(r => r.body.json()) };
JOBS['15:axios (keepAlive)'] = { modules: { axios: M.axios, http: M.http }, build: ({ axios, http }, { base }) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
    const a = axios.default || axios;
    return () => a.get(base + '/json', { httpAgent: agent });
} };

// ---------------------------------------------------------------------------
// 16. Transport matrix (node:http vs optional undici)
// ---------------------------------------------------------------------------
JOBS['16:swiftly (node:http)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => () => swiftly.get(base + '/json', net) };
JOBS['16:swiftly (undici)'] = { modules: { swiftly: M.swiftly }, build: ({ swiftly }, { base }) => () => swiftly.get(base + '/json', undiciNet) };
JOBS['16:raw http (ceiling)'] = { modules: { http: M.http }, build: ({ http }, { base }) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
    return () => new Promise((res, rej) => {
        http.get(base + '/json', { agent }, (r) => { r.resume(); r.on('end', res); }).on('error', rej);
    });
} };
JOBS['16:undici (raw)'] = { modules: { undici: M.undici }, build: ({ undici }, { base }) => () => undici.request(base + '/json').then(r => r.body.json()) };

export function getJob(scenario, row) {
    const key = `${scenario}:${row}`;
    const job = JOBS[key];
    if (!job) throw new Error(`Unknown job: ${key}`);
    return { ...job, modules: { ...job.modules } };
}