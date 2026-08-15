# ⚡ Swiftly

**The fastest, lightest HTTP client for Node.js. Zero dependencies.**

Swiftly is a batteries-included HTTP client built entirely on Node's native
`http` / `https` / `http2` modules. No `node-fetch`, no `undici`, no runtime
dependencies — just fast, reliable HTTP.

```
npm install swiftly
```

## Highlights

- 🚀 **Zero dependencies** — uses only Node.js built-ins.
- ⚡ **Fast** — beats `axios` and `got` in throughput benchmarks.
- 🧩 **Consistent API** — every method resolves with the parsed body directly.
- 🔄 **Retries, redirects, caching, rate limiting, circuit breaker** built in.
- 🍪 **Cookie jar & sessions** — automatic across requests.
- 🧬 **HTTP/2, gzip/deflate/br, GraphQL, SSE, multipart/form-data**.
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
```

## Configuration

All options are optional. Sensible, **performance-first** defaults are applied.

```js
const client = swiftly({
    // Timeouts (ms)
    timeout: 30000,
    timeouts: { connect: 5000, response: 30000, idle: 60000 },

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
| `batch([...])` | Run many requests concurrently              |
| `query(url, { query, variables }, cfg)` | GraphQL                  |
| `scrape(url, selector, cfg)` | Parse HTML with CSS-like selectors    |
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

## Web scraping

```js
import { parseHTML } from 'swiftly';

const html = '<div class="item"><h1>A</h1></div><div class="item"><h1>B</h1></div>';

parseHTML(html, {
    titles: { selector: '.item h1', type: 'text', multiple: true },
    links:  'a@href'
});
// => { titles: ['A', 'B'], links: [...] }
```

> Note: `parseHTML` is a regex-based lightweight parser (zero deps). For
> heavy-duty scraping, pair Swiftly with a full HTML parser.

## CLI

```
swiftly get https://api.example.com
swiftly post https://api.example.com -d '{"key":"value"}'
swiftly scrape https://example.com -s '.main-content'
```

## Performance

Best-of-3 rounds, 25 concurrent workers, 500 requests each, local HTTP server:

| client   | req/s  | ms/req |
| -------- | ------ | ------ |
| raw http | 4,715  | 0.212  |
| **swiftly** | **3,041** | **0.329** |
| axios    | 2,530  | 0.395  |
| got      | 2,053  | 0.487  |

Run it yourself: `npm run bench`

Swiftly is ~1.2× faster than axios and ~1.5× faster than got, with **zero
dependencies**, while staying within ~1.5× of raw Node `http`.

## Development

```bash
npm install
npm test          # build + run unit & integration tests
npm run test:watch
npm run typecheck # validate TypeScript definitions
npm run bench     # run the performance benchmark
npm run build     # rebuild dist/ (ESM + CJS bundles)
npm run check     # syntax check
```

## License

MIT © [Cognima](https://github.com/cognima)