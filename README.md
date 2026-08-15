# ⚡ Swiftly

The fastest, lightest **zero-dependency** HTTP client for Node.js — with
retries, circuit breakers, caching, rate limiting, cookies, GraphQL, SSE,
web scraping and a real HTML / XML / CSV parser built in.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/hiudyy/swiftly/blob/master/LICENSE)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)
[![Node](https://img.shields.io/badge/node-%3E%3D14.13-43853a.svg)](package.json)

```js
import swiftly from 'swiftly';

const user = await swiftly.get('https://api.example.com/users/1');
console.log(user.name);
```

## Why Swiftly?

- **Zero dependencies** — one install, no transitive supply chain.
- **Fast** — native `http`/`https` with keep-alive pooling; optional `undici` transport.
- **Resilient** — retries with backoff, circuit breakers, rate limiting and timeouts.
- **Smart caching** — shared cache with auth-aware keys (credentials never leak across requests).
- **Complete** — cookies/sessions, GraphQL, Server-Sent Events, streaming, batch.
- **Scraping built in** — CSS-like selectors, tables/forms/JSON-LD extraction, HTML→Markdown.
- **Typed errors**, events, metrics and a CLI.

## Install

```bash
npm install swiftly
```

Requires Node.js **>= 14.13**.

## ESM

```js
import swiftly from 'swiftly';

const items = await swiftly.get('https://api.example.com/items', {
  params: { page: 1 },
});
```

## CommonJS

`require('swiftly')` returns the same client function (with `.default` also
set), so everything below works identically:

```js
const swiftly = require('swiftly');

swiftly.get('https://api.example.com/items', { params: { page: 1 } })
  .then((items) => console.log(items));
```

## Creating a client

Pass a config object to get a client with its own defaults and shared state
(connection pool, cookie jar, cache, circuit breakers). Relative URLs resolve
against `baseURL`:

```js
const api = swiftly({
  baseURL: 'https://api.example.com',
  headers: { 'X-App': 'demo' },
  timeout: 5000,
  retries: 3,
  cache: { enabled: true, ttl: 300_000 },
});

const item = await api.get('/items/42'); // GET https://api.example.com/items/42
```

Both styles are the same client underneath — static calls
(`swiftly.get`, `swiftly.post`, …) share one internal client, so state persists
across calls.

## Making requests

```js
await api.get('/items');                       // GET
await api.get('/items', { params: { page: 2 } });

await api.post('/items', { name: 'Widget' });  // POST (JSON body)
await api.put('/items/1', { name: 'Widget+' });   // PUT
await api.patch('/items/1', { name: 'Widget!' }); // PATCH
await api.delete('/items/1');                  // DELETE
await api.head('/items/1');                    // HEAD
await api.options('/items');                   // OPTIONS

// any verb via the low-level entry point
await api.request('PURGE', '/cache');
```

## What requests return

Every request resolves with the **parsed response body** — no `{ data }`
wrapper to unwrap. The shape follows the response `Content-Type`:

```js
const json   = await api.get('/user');            // Content-Type: application/json -> object
const text   = await api.get('/page', { responseType: 'text' });   // string
const buffer = await api.get('/img.png', { responseType: 'buffer' }); // Buffer
const raw    = await api.get('/user', { responseType: 'raw' });    // { data, status, headers, duration }
```

`raw` gives you the full envelope:

```js
const { data, status, headers, duration } = await api.get('/user', { responseType: 'raw' });
console.log(status, duration, headers['content-type'], data);
```

Stream the body (retries are disabled for streams):

```js
const { data } = await api.get('/file', { stream: true });
for await (const chunk of data) process.stdout.write(chunk);
```

Download to a `Buffer` in one call:

```js
const buf = await api.download('https://example.com/file.zip');
```

## Query params & headers

```js
// Scalars, arrays and nested objects are all serialized safely:
await api.get('/items', {
  params: {
    page: 1,
    tags: ['a', 'b'],          // ?tags=a&tags=b
    filter: { active: true },  // ?filter={"active":true}
  },
});

// Headers per request, or as client defaults:
await api.get('/me', { headers: { 'X-Request-Id': 'abc' } });
api.setDefaultHeaders({ 'X-App': 'demo' });
```

## Auth

```js
swiftly({ auth: { username, password } }); // Basic
swiftly({ bearer: '<token>' });            // Bearer <token>
swiftly({ token: '<token>' });             // raw Authorization
```

## Configuration in practice

`swiftly(config)` accepts everything below — all optional, defaults are
performance-first (no timeout, no rate limiting, caching on). Each group is
shown in real code:

```js
const api = swiftly({
  // ----- Networking -----
  baseURL: 'https://api.example.com',  // prefix for relative URLs
  timeout: 8000,                       // per-request socket timeout (ms)
  timeouts: { connect: 2000, response: 5000, idle: 10000 }, // fine-grained timers
  followRedirects: true,               // follow 3xx automatically
  maxRedirects: 5,                     // max redirect hops
  validateSSL: true,                   // reject invalid TLS certs (dev: false)
  useHttp2: false,                     // try HTTP/2 when available
  transport: 'http',                   // 'http' | 'undici' (optional peer dep)
  proxy: { host: '127.0.0.1', port: 8080 }, // HTTP(S) proxy
  decompress: true,                    // auto gzip/deflate/br

  // ----- Retries -----
  retries: 3,                          // total attempts (1 = no retry)
  retryDelay: 500,                     // base delay (ms)
  retryBackoff: 2,                     // exponential factor (>=1); linear when null
  retryJitter: true,                   // randomize backoff
  retryOn: [429, 500, 502, 503, 504],  // status codes that trigger a retry
  maxRetryAfter: 30000,                // cap for an honored Retry-After (ms)
  onRetry: (attempt, error, delay) => console.log(`retry ${attempt} in ${delay}ms`),

  // ----- Performance -----
  keepAlive: true,                     // reuse TCP sockets (pooling)
  maxSockets: 100,                     // max concurrent sockets per origin
  maxFreeSockets: 256,                 // idle sockets kept alive
  agent: null,                         // custom http.Agent override
  humanize: false,                     // artificial delay between requests
  compression: { request: true, response: true, minSize: 1024, responseMinSize: 0 },
  session: { ttl: 3600000, maxSessions: 100, autoCleanup: true }, // HTTP/2 pool

  // ----- Caching (auth-aware keys) -----
  cache: {
    enabled: true,                     // cache GET responses
    ttl: 300_000,                      // entry lifetime (ms)
    maxSize: 1000,                     // LRU eviction
    staleWhileRevalidate: false,       // serve stale while refreshing
  },

  // ----- Resilience -----
  circuitBreaker: { enabled: true, failureThreshold: 5, resetTimeout: 60000 },
  rateLimiting: { enabled: true, requestsPerSecond: 20, minDelay: 1000, maxDelay: 64000 },

  // ----- Requests -----
  params: {},                          // default query params
  headers: {},                         // default headers
  auth: null,                          // { username, password } -> Basic
  bearer: null,                        // -> Authorization: Bearer <token>
  token: null,                         // -> Authorization: <token>
  responseType: 'json',                // 'json'|'text'|'html'|'buffer'|'raw' (default: auto-detected)
  responseSchema: { id: 'number' },    // type-map validated against the JSON body
  stream: false,                       // return the raw stream
  maxContentLength: Infinity,          // size guards
  maxBodyLength: Infinity,
  randomizeHeaders: false,             // randomize header ordering
  debug: false,                        // verbose logging

  // ----- Hooks -----
  onRequest: (cfg) => console.log('→', cfg.method, cfg.url),
  onResponse: (data, res) => console.log('←', res.status),
  onError: (err) => console.error('!', err.code),
  onDownloadProgress: ({ loaded, total }) => {},
  onUploadProgress: ({ loaded, total }) => {},
});
```

## Resilience

```js
const api = swiftly({
  retries: 4,
  retryBackoff: 2,
  retryJitter: true,
  retryOn: [429, 500, 502, 503, 504],
  timeout: 8000,
  circuitBreaker: { enabled: true, failureThreshold: 5, resetTimeout: 60000 },
  rateLimiting: { enabled: true, requestsPerSecond: 20 },
});

api.on('circuit:open', ({ domain }) => console.warn(`breaker open: ${domain}`));
```

- **Retries** — linear or exponential backoff + optional jitter; honors `Retry-After`.
- **Circuit breaker** — opens after `failureThreshold` failures, recovers after
  `resetTimeout`, and also trips on 5xx.
- **Rate limiting** — per-domain throttle with adaptive backoff.

## Caching

GET responses are cached by default using **auth-aware keys**, so responses for
different credentials are never shared:

```js
const api = swiftly({ cache: { enabled: true, ttl: 300_000, staleWhileRevalidate: true } });

await api.get('/config');                 // miss -> network
await api.get('/config');                 // hit  -> instant (possibly stale, refreshed in bg)
await api.get('/stock?sku=1', { cache: { enabled: false } }); // always fresh
```

## GraphQL

```js
const data = await api.query('https://api.example.com/graphql', {
  query: `query ($id: ID!) { user(id: $id) { name } }`,
  variables: { id: 1 },
});
// data is the GraphQL `data` field; throws Error with .graphqlErrors on server errors
```

## Server-Sent Events

```js
const unsubscribe = await api.subscribe('https://api.example.com/stream', {
  onOpen: () => console.log('connected'),
  onMessage: (msg) => console.log(msg.data),
  onError: (err) => console.error(err),
});

// later:
unsubscribe();
```

## Batch

Run many requests concurrently — never rejects, each result is the body or
`{ error }`:

```js
const results = await api.batch([
  { method: 'GET',  url: '/users/1' },
  { method: 'POST', url: '/events', data: { type: 'click' } },
]);

for (const r of results) {
  if (r.error) console.error('failed', r.error.code);
  else console.log('ok', r);
}
```

## Interceptors

Transform requests before they're sent, and responses/errors after:

```js
api.interceptors.request.use((config) => {
  config.headers['X-Trace'] = crypto.randomUUID();
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.code === 'RESPONSE_ERROR' && error.response.status === 401) {
      // e.g. refresh a token and retry
    }
    throw error;
  },
);
```

## Cookies & sessions

Cookies from `Set-Cookie` are stored per domain and sent back automatically,
with correct `Domain` (incl. subdomains), `Path` and `Secure` handling:

```js
const api = swiftly();
await api.get('https://example.com/login');     // stores the session cookie
await api.get('https://example.com/dashboard');  // cookie is sent back
```

## Web scraping

Swiftly ships a dependency-free HTML parser with CSS-like selectors:

```js
import { parseHTML, extractLinks, htmlToMarkdown } from 'swiftly';

const html = await swiftly.get('https://example.com', { responseType: 'text' });

const { titles, links } = parseHTML(html, {
  titles: { selector: '.post h2', type: 'text', multiple: true },
  links:  'a@href',
});

const md = htmlToMarkdown(html);
```

Fetch + parse in one step:

```js
const titles = await api.scrape('https://example.com', '.product-title');
```

## Error handling

All errors extend `SwiftlyError` and carry a `code` — branch on `code`, never on
message strings:

```js
try {
  await swiftly.get(url);
} catch (err) {
  switch (err.code) {
    case 'RESPONSE_ERROR':   console.error('HTTP', err.response.status, err.response.data); break;
    case 'REQUEST_ERROR':    console.error('network:', err.cause); break;
    case 'TIMEOUT_ERROR':    console.error('timed out'); break;
    case 'CIRCUIT_BREAKER_ERROR': console.error('breaker open:', err.domain); break;
    default:                 throw err;
  }
}
```

## Events & metrics

```js
api.on('request:end', ({ url, status, time }) => console.log(status, `${time}ms`, url));
api.on('circuit:open', ({ domain }) => {});

const m = api.getMetrics();
console.log(m); // requestCount, cacheHits/Misses, retries, averageResponseTime, ...
```

## CLI

```bash
swiftly get https://api.example.com
swiftly post https://api.example.com -d '{"key":"value"}'
swiftly scrape https://example.com -s '.main-content'
```

## Documentation

Full documentation, guides and recipes: [documentation index](https://github.com/hiudyy/swiftly/blob/master/docs/README.md)

## License

[MIT](https://github.com/hiudyy/swiftly/blob/master/LICENSE) © hiudy