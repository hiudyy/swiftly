# ⚡ Swiftly

**The fastest, lightest HTTP client for Node.js. Zero dependencies.**

Swiftly is a batteries-included HTTP client built entirely on Node's native
`http` / `https` / `http2` modules. No `node-fetch`, no `undici`, no runtime
dependencies — just fast, reliable HTTP. An optional `undici` transport can be
enabled when you install it yourself.

```
npm install swiftly
```

## Highlights

- 🚀 **Zero dependencies** — uses only Node.js built-ins.
- ⚡ **Fast** — beats `axios` and `got` in throughput benchmarks.
- 🧩 **Consistent API** — every method resolves with the parsed body directly.
- 🕷️ **Built-in HTML parser** — CSS-like selectors (combinators, pseudo-classes,
  attribute operators) + element methods, `scrape()` and full extraction suite.
- 📦 **Parsers for everything** — XML, RSS, Atom, sitemap, CSV, JSONPath.
- 🔄 **Retries, redirects, caching (SWR), rate limiting, circuit breaker** built in.
- 🍪 **Cookie jar & sessions** — automatic across requests.
- 🧬 **HTTP/2, gzip/deflate/br, GraphQL, SSE, multipart/form-data, streaming,
  upload/download progress, AbortSignal, proxy tunnels**.
- 🔑 **Auth helpers** — `auth`, `bearer`, `token` in one line.
- 📝 **TypeScript types** included (`index.d.ts`).
- 📦 **Dual module** — works with `require()` and `import`.

## Quick start

```js
// ESM
import swiftly from 'swiftly';

// or CommonJS
// const swiftly = require('swiftly');

const todo = await swiftly.get('https://jsonplaceholder.typicode.com/todos/1');
console.log(todo.title); // "delectus aut autem"

await swiftly.post('https://example.com/api/items', { name: 'swiftly' });
await swiftly.put('https://example.com/api/items/1', { name: 'updated' });
await swiftly.patch('https://example.com/api/items/1', { status: 'done' });
await swiftly.delete('https://example.com/api/items/1');
```

### Create a configured client

```js
const api = swiftly({
    baseURL: 'https://api.example.com',
    timeout: 10000,
    headers: { Authorization: 'Bearer token' }
});

const users = await api.get('/users');
```

## Return value

**All request methods resolve with the parsed response body directly** — no
`{ data, status, headers }` wrapper to unwrap.

| Content-Type        | Returns                    |
| ------------------- | -------------------------- |
| `application/json`  | parsed JS object/array     |
| `text/plain`, etc.  | `string`                   |
| `text/html`         | HTML `string`              |
| anything else       | `Buffer`                   |

Request a specific format with `responseType`:

```js
const buf = await swiftly.download('https://example.com/file.zip'); // Buffer
const text = await swiftly.get(url, { responseType: 'text' });

// Full response access: parsed body + status/headers/config/duration
const { data, status, headers, duration } = await swiftly.get(url, { responseType: 'raw' });
```

## Streaming, cancellation & download

```js
// Stream the response body (retries are disabled for streams)
const { Readable } = await swiftly.get(url, { stream: true });
for await (const chunk of Readable) process.stdout.write(chunk);

// Abort with AbortSignal
const controller = new AbortController();
swiftly.get(url, { signal: controller.signal }).catch(err => console.log(err.code)); // ABORT_ERROR
setTimeout(() => controller.abort(), 100);

// Save straight to disk (streamed, progress-aware)
await swiftly.downloadTo('./file.zip', 'https://example.com/file.zip');
```

## Auth in one line

```js
await swiftly.get(url, { auth: { username: 'u', password: 'p' } }); // Basic
await swiftly.get(url, { auth: 'u:p' });
await swiftly.get(url, { bearer: 'token' });                        // Bearer
await swiftly.get(url, { token: 'token' });                         // Bearer alias
```

## Optional undici transport

Swiftly ships zero dependencies and uses Node's `http`/`http2` by default. If
you want the undici transport you install it yourself (optional peer):

```bash
npm install undici
```

```js
const res = await swiftly.get(url, { transport: 'undici' }); // config.transport = 'undici'
```

## Configuration

All options are optional. Sensible, **performance-first** defaults are applied.

```js
const client = swiftly({
    // Timeouts (ms) — OPT-IN to keep the hot path free of timers.
    // `null` = no per-request socket/JS timers (fastest; like axios's 0).
    // Set `timeout` for a native socket guard, or `timeouts` for full control.
    timeout: null,
    timeouts: null, // { connect, response, idle } — see "Reliability" below

    // Retries
    retries: 3,
    retryDelay: 1000,

    // Redirects
    followRedirects: true,
    maxRedirects: 5,

    // Networking
    useHttp2: false,
    validateSSL: true,
    baseURL: null,

    // Performance (all OFF by default — Swiftly is fast out of the box)
    humanize: false,        // no artificial delay
    debug: false,           // no console spam
    rateLimiting: { enabled: false, requestsPerSecond: 2 },

    // Cache (ON by default — makes repeated GETs instant)
    cache: { enabled: true, ttl: 300000, maxSize: 1000 },

    // Compression
    compression: { request: true, response: true, minSize: 1024 },

    // Resilience
    circuitBreaker: { enabled: false, failureThreshold: 5, resetTimeout: 60000 },

    // Misc
    deduplicate: true,      // collapse concurrent identical GETs
    randomizeHeaders: false // stable headers = better reuse & caching
});
```

### v2 additions

```js
const client = swiftly({
    keepAlive: true,        // per-host connection pooling (default)
    maxSockets: 20,
    maxFreeSockets: 5,

    auth: { username: 'u', password: 'p' },
    bearer: 'token',

    transport: 'http',      // 'http' | 'http2' | 'undici' (optional dep)
    decompress: true,       // automatic gzip/deflate/br handling

    // Retry tuning
    retryOn: [429, 500, 502, 503, 504],   // statuses that trigger a retry
    retryBackoff: 'exponential',          // 'linear' | 'exponential'
    retryJitter: 100,                     // random ms added to the backoff
    maxRetryAfter: 30000,                 // cap on honoring Retry-After
    onRetry: (err, attempt) => {},

    // Hooks
    onRequest: (config) => config,
    onResponse: (data, response) => {},
    onError: (err) => {},
    onDownloadProgress: ({ bytes, total }) => {},
    onUploadProgress: ({ bytes, total }) => {},

    // Cache v2
    cache: {
        enabled: true,
        ttl: 300000,
        maxSize: 1000,
        staleWhileRevalidate: true, // serve stale + refresh in background
        ignoreQuery: false,         // cache key ignores query string
        storage: customStorage,     // pluggable { get, set, delete, clear }
        keyBuilder: (url, options) => url
    }
});
```

### Cookie jar API

```js
const c = swiftly();
c.cookies.setCookie('session=abc; Domain=example.com; Path=/');
c.cookies.getCookies('https://example.com/');   // [{ name, value, domain, path }]
c.cookies.getCookiesMap('https://example.com/');// { session: 'abc' }
c.cookies.clearCookies();
const json = c.cookies.toJSON();
c.cookies.fromJSON(json); // restore a saved session
```

### How to run faster

Swiftly is already fast by default. To maximize throughput:

1. Leave `humanize`, `debug` and `rateLimiting` **off** (the defaults).
2. Keep `cache.enabled: true` for repeated reads.
3. Keep `deduplicate: true` when many callers hit the same endpoint.
4. Set a reasonable `timeouts.response` so stuck requests fail fast.
5. Reuse a single instance (or the shared default client) to reuse connections.

## API reference

### Methods

| Method        | Description                                  |
| ------------- | -------------------------------------------- |
| `get(url, cfg)`    | Perform a GET request                     |
| `post(url, data, cfg)` | POST with JSON body                     |
| `put / patch(url, data, cfg)` | Update requests                |
| `delete / head / options(url, cfg)` | Other verbs                  |
| `download(url, cfg)` | Returns the body as a `Buffer`           |
| `downloadTo(path, url, cfg)` | Streams the body to a file         |
| `batch([...])` | Run many requests concurrently              |
| `query(url, { query, variables }, cfg)` | GraphQL                  |
| `scrape(url, selector, cfg)` | Fetch + parse HTML with CSS-like selectors |
| `parse(html, selectors)` | Parse HTML directly (no request)     |
| `subscribe(url, { onMessage, onOpen, onError }, cfg)` | SSE        |

### Instance & helpers

```js
const c = swiftly();

c.on('request:end', ({ url, status, time }) => {});
c.off('request:end');

c.interceptors.request.use((cfg) => cfg);
c.interceptors.response.use((res) => res);

c.setBaseURL('https://example.com');
c.setTimeout(5000);
c.setDefaultHeaders({ 'X-App': 'demo' });
c.setDebug(false);

c.getMetrics();        // requestCount, cacheHits, retries, ...
c.clearCache();
c.resetCircuitBreakers();
await c.close();
```

### Shared default client

Static calls (`swiftly.get`, `swiftly.post`, …) share one internal client, so
connection pooling, the cookie jar and cache are reused across all of them.

```js
swiftly.client() === swiftly.client(); // true
```

## Errors

Swiftly throws typed errors (all extend `SwiftlyError`):

| Error             | Code                 | When                                  |
| ----------------- | -------------------- | ------------------------------------- |
| `ValidationError` | `VALIDATION_ERROR`   | bad arguments/URL                     |
| `RequestError`    | `REQUEST_ERROR`      | network failure (ECONNREFUSED, DNS…)  |
| `ResponseError`   | `RESPONSE_ERROR`     | non-2xx HTTP status (has `.response`) |
| `TimeoutError`    | `TIMEOUT_ERROR`      | connect/response/idle timeout         |
| `CircuitBreakerError` | `CIRCUIT_BREAKER_ERROR` | circuit breaker open             |

```js
try {
    await swiftly.get('https://example.com');
} catch (err) {
    if (err.code === 'RESPONSE_ERROR') {
        console.error('HTTP', err.response.status);
    }
}
```

## HTML scraping

Swiftly ships a real, zero-dependency HTML parser. Selectors support
**combinators** (` `, `>`, `+`, `~`), **attribute operators** (`=`, `^=`, `$=`,
`*=`, `~=`, `|=`), **pseudo-classes** (`:first`, `:last`, `:nth-child`,
`:nth-of-type`, `:contains`, `:not`, `:empty`, `:has`, `:eq`) and **comma
groups**.

```js
import { parseHTML } from 'swiftly';

const html = `<div class="item"><h1>A</h1></div>
              <div class="item"><h1>B</h1></div>
              <a href="/x">X</a><a href="/y">Y</a>`;

parseHTML(html, {
    titles: { selector: '.item h1', type: 'text', multiple: true },
    links:  'a@href'
});
// => { titles: ['A', 'B'], links: ['/x', '/y'] }

// Element objects
const items = parseHTML(html, '.item');
items[0].tag;                 // 'div'
items[0].content;             // 'A'
items[0].attr('class');       // 'item'
items[0].find('h1');          // []
items[0].parent();
items[0].closest('body');
items[0].next();              // sibling element or null
```

Or fetch + parse in one step:

```js
const titles = await swiftly.scrape('https://example.com', 'h2.title');
```

### Extraction suite

```js
import {
    extractLinks, extractImages, extractText, extractMeta,
    extractTables, extractForms, extractJsonLd, extractJSON,
    sanitizeHtml, htmlToMarkdown
} from 'swiftly';

extractLinks(html, 'https://site.example');   // [{ text, href, url }] (absolute urls)
extractImages(html, baseUrl);                 // [{ src, url, alt, title }]
extractText(html);                            // plain text
extractMeta(html);                            // { description, 'og:title', title }
extractTables(html, 'table');                 // [{ headers, rows }]
extractForms(html);                           // [{ action, method, fields }]
extractJsonLd(html);                          // parsed JSON-LD blocks
extractJSON(html);                            // JSON embedded in <script>
sanitizeHtml(html);                           // strips scripts/handlers/comments
htmlToMarkdown(html);                         // basic HTML -> Markdown
```

### XML, feeds, CSV & JSONPath

```js
import {
    parseXML, xmlToString, parseRSS, parseAtom, parseSitemap,
    parseCSV, toCSV, queryJSON
} from 'swiftly';

parseXML('<root id="1"><a>x</a><a>y</a></root>');
// => { $: { id: '1' }, a: [{ '#text': 'x' }, { '#text': 'y' }] }
xmlToString(doc, 'root');                     // back to XML

parseRSS(xml);       // -> [{ title, link, description, pubDate, guid, author, categories }]
parseAtom(xml);      // -> [{ title, link, summary, id, updated, author }]
parseSitemap(xml);   // -> [{ loc, lastmod, changefreq, priority }]

parseCSV('name,age\nAna,30');                 // -> [{ name: 'Ana', age: '30' }]
toCSV([{ name: 'Ana', age: 30 }]);            // -> 'name,age\r\nAna,30'

const data = { user: { name: 'Ana' }, items: [{ id: 1 }, { id: 2 }] };
queryJSON(data, 'user.name');                 // 'Ana'
queryJSON(data, 'items[*].id');               // [1, 2]
```

## CLI

```
swiftly get https://api.example.com
swiftly post https://api.example.com -d '{"key":"value"}'
swiftly scrape https://example.com -s '.main-content'
```

## Performance

Best-of-rounds, 25 concurrent workers, 500 requests each, local HTTP server
(`npm run bench`). Raw Node `http` is shown only as a **reference/ceiling** —
it does `res.resume()` and returns a raw stream with zero features. The real
competition is the feature-complete clients:

| client      | ~req/s | ~ms/req |
| ----------- | ------ | ------- |
| undici (raw) | 10,350 | 0.10 |
| **swiftly (undici)** | **10,200** | **0.10** |
| raw http (ceiling) | 9,300 | 0.11 |
| **swiftly (node:http)** | **8,100** | **0.12** |
| axios       | 3,900 | 0.26 |
| got         | 3,600 | 0.28 |
| node-fetch  | 3,200 | 0.31 |
| superagent  | 2,900 | 0.34 |

Swiftly is **~2–2.6× faster than axios, got, node-fetch and superagent** on
typical small-payload I/O, with **zero dependencies**. The default `node:http`
transport runs at **~88% of the raw `http` ceiling** while delivering the full
feature set (retries, cookies, caching, metrics, pooling, parsing). Routed
through the optional `undici` transport it lands at **~99% of raw undici** —
which does no JSON parsing or semantics (it returns an unparsed stream). For
very large bodies (100 KB+) the cost is dominated by `JSON.parse`, where swift
actually **wins** (it beats undici, got, ky, axios and superagent).

### Benchmark suite

The benchmark is a **fully isolated measurement lab**. Every
`scenario × client` row runs in its **own child process** (`--expose-gc` +
`--trace-gc`), the HTTP server runs in **its own child process**, and each
worker imports only the libraries it measures — so no library's GC, CPU or
module-loading leaks into another's numbers. Output per scenario is **two
tables**: one for **latency** (req/s, mean, p50/p95/p99/p999, min, max, CV)
and one for **resources** (CPU %, retained heap Δ/op, peak RSS, GC events/ms,
worst event-loop stall).

`npm run bench` first prints a **library profile** (raw+gzip bundle weight,
runtime deps, API surface, transports), then runs **16 scenarios** comparing
~5-7 clients (including **`swiftly` routed through the optional `undici`
transport**) plus the scale, latency-tier and memory/GC phases:

| # | Scenario | Competitors |
|---|----------|-------------|
| 1 | Simple JSON GET | swiftly(undici), undici, raw, axios, got, node-fetch, superagent |
| 2 | POST JSON (serialization) | swiftly(undici), undici, raw, axios, got, node-fetch, superagent |
| 3 | gzip decompression | swiftly(undici), raw+gunzip, got, superagent, node-fetch, undici(fetch), ky |
| 4 | Large JSON (100 KB) parsing | swiftly(undici), undici, raw, axios, got, superagent, ky |
| 5 | HTML scraper | swiftly(undici), cheerio + axios/got/superagent/node-fetch/ky/undici |
| 6 | `batch` (8 parallel GETs) | swiftly(undici), axios/got/node-fetch/superagent/ky/undici + `Promise.all` |
| 7 | `download` (binary → Buffer) | swiftly(undici), axios/got/node-fetch/superagent/ky/undici buffers |
| 8 | retries | swiftly(undici), axios/node-fetch/ky/undici + retry loop, got, superagent `.retry` |
| 9 | rate limiting | swiftly(undici), axios/got/node-fetch/superagent/ky/undici + limiter |
| 10 | mixed workload | swiftly(undici), undici, axios, got, node-fetch, superagent, ky |
| 11 | **complex**: e-commerce checkout flow | 5 sequential requests per iteration |
| 12 | **complex**: paginated aggregation | 5 pages fetched + merged per iteration |
| 13 | **complex**: scraping at scale | fetch + parse + extract per iteration |
| 14 | parsing & extraction toolkit | `swiftly` HTML-only row (apples-to-apples vs cheerio) + full 6-parser suite |
| 15 | connection reuse (keepAlive) | pooled vs unpooled swiftly/undici/axios |
| 16 | **transport matrix** | `swiftly` on node:http vs optional undici vs raw ceilings |

Raw `http` appears only as a **ceiling reference** in the I/O scenarios. Feature
scenarios are matched with realistic equivalents (e.g. `parseHTML` vs
`cheerio`) so nothing runs unchallenged. In the day-to-day complex flows
(pagination, scraping at scale) swiftly consistently wins, including against
undici.

#### Phases

- **A — scenarios**: the 16 benchmarks above, dual latency + resource tables.
- **B — latency profile**: the same core clients re-measured against a server
  injecting `0/1/10/50/100` ms of latency, so the picture holds under real
  network conditions.
- **C — scale profile**: N swept from **1 to 100,000** (1,000,000 in deep mode)
  per core client — cold-start, warm throughput, and sustained load in one view.
- **D — concurrency sweep** (deep only): C = `1,8,25,100,250` at fixed N.
- **E — memory/GC stress**: sustained runs reporting CPU %, retained heap/op,
  peak RSS, GC events and pauses.
- **Summary**: per-scenario winners + wall time.

#### Total control

Every knob is an environment variable — the bench prints what it ran:

| Variable | Default | Purpose |
|----------|---------|---------|
| `SWIFTLY_BENCH_N` | `400` | requests per scenario |
| `SWIFTLY_BENCH_C` | `25` | concurrency (workers) |
| `SWIFTLY_BENCH_ROUNDS` | `3` | best-of rounds |
| `SWIFTLY_BENCH_WARMUP` | `40` | discarded warmup requests (JIT + connection warm-up) |
| `SWIFTLY_BENCH_LATENCY` | `0` | artificial per-request server delay (ms) |
| `SWIFTLY_BENCH_SCENARIOS` | `all` | comma list, e.g. `1,3,16` |
| `SWIFTLY_BENCH_HOST` | *(local)* | external base URL (skips the local server) |
| `SWIFTLY_BENCH_UNDICI` | `1` | `0` disables the `swiftly (undici)` rows |
| `SWIFTLY_BENCH_PROFILE` | `1` | `0` skips the library profile section |
| `SWIFTLY_BENCH_ISOLATE` | `1` | `0` = in-process quick mode (limited resource metrics) |
| `SWIFTLY_BENCH_GC` | `1` | `0` disables `--expose-gc` / `--trace-gc` |
| `SWIFTLY_BENCH_SCALE` | `1,10,100,1e3,1e4,1e5` | N sweep for Phase C (`1e6` via deep) |
| `SWIFTLY_BENCH_LATENCIES` | `0,1,10,50,100` | server latency tiers for Phase B (ms) |
| `SWIFTLY_BENCH_CONCURRENCIES` | `1,8,25,100,250` | C sweep for Phase D (deep only) |
| `SWIFTLY_BENCH_STRESS_N` | `50000` | sustained requests for Phase E |
| `SWIFTLY_BENCH_DEEP` | `0` | `1` = deep mode (1M tier + concurrency sweep) |
| `SWIFTLY_BENCH_1M` | `0` | `1` adds the 1,000,000-request tier |

```bash
npm run bench        # full isolated run (up to 100K, ~5-10 min)
npm run bench:deep   # + 1,000,000 requests + concurrency sweep
npm run bench:quick  # lightweight in-process smoke test

# targeted runs
SWIFTLY_BENCH_SCENARIOS=1,16 SWIFTLY_BENCH_N=200 SWIFTLY_BENCH_C=20 npm run bench
SWIFTLY_BENCH_SCALE=1e3,1e4 npm run bench          # throughput scaling only
SWIFTLY_BENCH_LATENCIES=0,25,100 npm run bench      # latency profile only
SWIFTLY_BENCH_ISOLATE=0 npm run bench               # legacy in-process mode
```

## Development

```bash
npm install
npm test          # build + run unit & integration tests
npm run test:watch
npm run typecheck # validate TypeScript definitions
npm run bench     # run the performance benchmark
npm run bench:deep     # deep mode: 1M requests + concurrency sweep
npm run bench:quick    # fast in-process smoke test
npm run build     # rebuild dist/ (ESM + CJS bundles)
npm run check     # syntax check
```

## License

MIT © [Cognima](https://github.com/cognima)