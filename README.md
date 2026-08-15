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

## Quick start

**ESM**

```js
import swiftly from 'swiftly';

const items = await swiftly.get('https://api.example.com/items', {
  params: { page: 1 },
});
```

**CommonJS**

```js
const swiftly = require('swiftly');
```

**Creating a client**

Pass a config object to get a client with its own defaults and shared state
(connection pool, cookie jar, cache, circuit breakers). Relative URLs resolve
against `baseURL`.

```js
import swiftly from 'swiftly';

const api = swiftly({
  baseURL: 'https://api.example.com',
  headers: { 'X-App': 'demo' },
  timeout: 5000,
  retries: 3,
  cache: { enabled: true, ttl: 300_000 },
});

const item = await api.get('/items/42'); // GET https://api.example.com/items/42
```

Both the default export and client instances are equivalent — static calls
(`swiftly.get`, `swiftly.post`, …) reuse one internal client, so state persists
across calls.

## Configuration

`swiftly(config)` accepts the options below (all optional; defaults are
performance-first — no timeout, no rate limiting, caching on). Every group is
shown; for per-option detail see
[Configuration](https://github.com/hiudyy/swiftly/blob/master/docs/configuration.md).

| Group | Option | Default | Description |
| ----- | ------ | ------- | ----------- |
| Networking | `baseURL` | `null` | Prefix applied to relative URLs. |
| | `timeout` | `null` | Per-request socket timeout (ms); opt-in. |
| | `timeouts` | `null` | `{ connect, response, idle }` timers (ms). |
| | `followRedirects` | `true` | Follow 3xx responses. |
| | `maxRedirects` | `5` | Max redirects to follow. |
| | `validateSSL` | `true` | Reject invalid TLS certificates. |
| | `useHttp2` | `false` | Use HTTP/2 when available. |
| | `transport` | `'http'` | `'http'` or `'undici'` (optional peer dependency). |
| | `proxy` | `null` | `{ host, port, auth? }` HTTP(S) proxy. |
| | `decompress` | `true` | Auto gzip/deflate/br. |
| Retries | `retries` | `3` | Total attempts (1 = no retry). |
| | `retryDelay` | `1000` | Base delay between attempts (ms). |
| | `retryBackoff` | `null` | Exponential factor (≥1); linear when `null`. |
| | `retryJitter` | `false` | Randomize backoff. |
| | `retryOn` | `null` | `number[]` of status codes or `(err) => boolean`. |
| | `maxRetryAfter` | `60000` | Cap (ms) for an honored `Retry-After`. |
| | `onRetry` | `null` | `(attempt, error, delay) => void`. |
| Performance | `keepAlive` | `true` | Reuse TCP connections (pooling). |
| | `maxSockets` | `Infinity` | Max concurrent sockets per origin. |
| | `maxFreeSockets` | `256` | Idle sockets kept alive. |
| | `agent` | `null` | Custom `http.Agent` override. |
| | `humanize` | `false` | Artificial delay between requests. |
| | `compression` | `{ request: true, response: true, minSize: 1024, responseMinSize: 0 }` | Compression handling. |
| | `session` | `{ ttl: 3600000, maxSessions: 100, autoCleanup: true }` | HTTP/2 session pool. |
| Caching | `cache.enabled` | `true` | Cache GET responses. |
| | `cache.ttl` | `300000` | Entry lifetime (ms). |
| | `cache.maxSize` | `1000` | Max entries (LRU eviction). |
| | `cache.staleWhileRevalidate` | `false` | Serve stale while refreshing. |
| | `cache.keyBuilder` | `null` | Custom `(method, url, data) => string`. |
| Resilience | `circuitBreaker.enabled` | `false` | Enable per-domain breaker. |
| | `circuitBreaker.failureThreshold` | `5` | Failures before it opens. |
| | `circuitBreaker.resetTimeout` | `60000` | Cool-down before recovery (ms). |
| | `rateLimiting.enabled` | `false` | Enable per-domain throttling. |
| | `rateLimiting.requestsPerSecond` | `2` | Target rate per domain. |
| | `rateLimiting.minDelay` / `maxDelay` | `1000` / `64000` | Backoff bounds (ms). |
| Requests | `params` | – | Query params (nested objects/arrays serialized). |
| | `headers` | – | Request headers. |
| | `auth` | `null` | `{ username, password }` → Basic. |
| | `bearer` | `null` | `Bearer <token>`. |
| | `token` | `null` | Raw `Authorization`. |
| | `responseType` | `'json'` | `'json' \| 'text' \| 'buffer' \| 'stream' \| 'raw'`. |
| | `responseSchema` | `null` | Validate/transform body (throws `ValidationError`). |
| | `stream` | `false` | Return raw response stream. |
| | `maxContentLength` / `maxBodyLength` | `Infinity` | Size guards. |
| | `randomizeHeaders` | `false` | Randomize header ordering. |
| | `debug` | `false` | Verbose logging. |
| Hooks | `onRequest` | `null` | `(config) => void`. |
| | `onResponse` | `null` | `(response) => void`. |
| | `onError` | `null` | `(error) => void`. |
| | `onDownloadProgress` | `null` | `({ loaded, total }) => void`. |
| | `onUploadProgress` | `null` | `({ loaded, total }) => void`. |

## Request methods

| Method | Signature |
| ------ | --------- |
| `get` / `delete` / `head` / `options` | `get(url, config?)` |
| `post` / `put` / `patch` | `post(url, data?, config?)` |
| `query` (GraphQL) | `query(url, { query, variables }, config?)` |
| `subscribe` (SSE) | `subscribe(url, { onMessage, onError, onOpen }, config?)` → `unsubscribe()` |
| `batch` | `batch([{ method, url, data?, config? }])` |
| `download` | `download(url, config?)` → `Buffer` |
| `scrape` | `scrape(url, selector, config?)` |
| `parse` | `parse(html, selectors)` (no request) |

## Return value

Every request resolves with the **parsed response body** — no `{ data }` wrapper.

| Content-Type | Returns |
| ------------ | ------- |
| `application/json` | parsed object / array |
| `text/*`, `html` | `string` |
| other | `Buffer` |

Force a shape with `responseType`:

```js
await swiftly.get(url, { responseType: 'text' });    // string
await swiftly.get(url, { responseType: 'buffer' });  // Buffer
await swiftly.get(url, { responseType: 'raw' });     // { data, status, headers, duration }
await swiftly.get(url, { responseType: 'stream' });  // Readable stream
```

## Auth

```js
swiftly({ auth: { username, password } }); // Basic
swiftly({ bearer: '<token>' });            // Bearer <token>
swiftly({ token: '<token>' });             // raw Authorization
```

## Resilience

```js
const api = swiftly({
  retries: 3,
  retryDelay: 1000,
  retryBackoff: 2,        // exponential backoff
  retryJitter: true,
  retryOn: [429, 500, 502, 503, 504],
  timeout: 8000,
  circuitBreaker: { enabled: true, failureThreshold: 5, resetTimeout: 60000 },
  rateLimiting: { enabled: true, requestsPerSecond: 10 },
});
```

- **Retries** — automatic with linear/exponential backoff + optional jitter; honors `Retry-After`.
- **Circuit breaker** — opens after `failureThreshold` failures and recovers after `resetTimeout` (also trips on 5xx).
- **Rate limiting** — optional per-domain throttle with adaptive backoff.
- **Timeouts** — opt-in connect/response/idle timers via `timeouts`.

## Caching

GET responses are cached by default using **auth-aware keys**, so responses for
different credentials are never shared.

```js
const api = swiftly({
  cache: { enabled: true, ttl: 300_000, staleWhileRevalidate: true },
});
```

## Streaming & downloads

```js
// Stream the body (retries are disabled for streams)
const { Readable } = await swiftly.get(url, { stream: true });
for await (const chunk of Readable) process.stdout.write(chunk);

// Download to a Buffer
const buf = await swiftly.download('https://example.com/file.zip');
```

## GraphQL

```js
const data = await swiftly.query('https://api.example.com/graphql', {
  query: `query ($id: ID!) { user(id: $id) { name } }`,
  variables: { id: 1 },
});
// data === response.body.data
```

## Server-Sent Events

```js
const unsubscribe = await swiftly.subscribe('https://api.example.com/stream', {
  onMessage: (msg) => console.log(msg.data),
  onError: (err) => console.error(err),
});
// call unsubscribe() to stop
```

## Batch

```js
const results = await swiftly.batch([
  { method: 'GET', url: '/users/1' },
  { method: 'POST', url: '/events', data: { type: 'click' } },
]);
// each entry is the parsed body, or { error } on failure
```

## Interceptors

```js
const api = swiftly();
api.interceptors.request.use((cfg) => {
  cfg.headers['X-Trace'] = crypto.randomUUID();
  return cfg;
});
api.interceptors.response.use((res) => res);
```

## Cookies & sessions

Cookies from `Set-Cookie` are stored per domain and sent back automatically,
with correct `Domain` (incl. subdomains), `Path` and `Secure` handling.

```js
const api = swiftly();
await api.get('https://example.com/login');     // stores the session cookie
await api.get('https://example.com/dashboard');  // cookie is sent back
```

## Web scraping

Swiftly ships a dependency-free HTML parser with CSS-like selectors.

```js
import { parseHTML, extractLinks, htmlToMarkdown } from 'swiftly';

const html = await swiftly.get('https://example.com', { responseType: 'text' });

const { titles, links } = parseHTML(html, {
  titles: { selector: '.post h2', type: 'text', multiple: true },
  links:  'a@href',
});

const md = htmlToMarkdown(html);
```

See [Web scraping](https://github.com/hiudyy/swiftly/blob/master/docs/scraping.md)
for the full selector syntax and the extraction suite (`extractLinks`,
`extractTables`, `extractJsonLd`, …).

## Error handling

All errors extend `SwiftlyError` and carry a `code`:

| Error | `code` | When |
| ----- | ------ | ---- |
| `ValidationError` | `VALIDATION_ERROR` | bad arguments / URL |
| `RequestError` | `REQUEST_ERROR` | network failure (DNS, ECONNREFUSED…) |
| `ResponseError` | `RESPONSE_ERROR` | non-2xx (has `.response`) |
| `TimeoutError` | `TIMEOUT_ERROR` | timeout exceeded |
| `CircuitBreakerError` | `CIRCUIT_BREAKER_ERROR` | breaker is open |

```js
try {
  await swiftly.get(url);
} catch (err) {
  if (err.code === 'RESPONSE_ERROR') console.error(err.response.status);
}
```

See [Errors](https://github.com/hiudyy/swiftly/blob/master/docs/errors.md).

## Events & metrics

```js
api.on('request:end', ({ url, status, time }) => {});
api.on('circuit:open', ({ domain }) => {});

api.getMetrics(); // { requestCount, cacheHits, cacheMisses, retries, … }
```

## CLI

```bash
swiftly get https://api.example.com
swiftly post https://api.example.com -d '{"key":"value"}'
swiftly scrape https://example.com -s '.main-content'
```

## Documentation

- [Getting started](https://github.com/hiudyy/swiftly/blob/master/docs/getting-started.md)
- [Configuration](https://github.com/hiudyy/swiftly/blob/master/docs/configuration.md)
- [API reference](https://github.com/hiudyy/swiftly/blob/master/docs/api.md)
- [Web scraping](https://github.com/hiudyy/swiftly/blob/master/docs/scraping.md)
- [Errors](https://github.com/hiudyy/swiftly/blob/master/docs/errors.md)

## License

[MIT](https://github.com/hiudyy/swiftly/blob/master/LICENSE) © hiudy
