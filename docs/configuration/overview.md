# Options reference

This is the complete reference of every configuration option. All options are
optional — defaults are **performance-first** (no timeout, no rate limiting,
caching on).

Config can be set at three levels:

1. **Client** — `swiftly({ ... })`
2. **Request** — `api.get(url, { ... })`
3. **Batch item** — `api.batch([{ method, url, data, config: { ... } }])`

Per-request config is shallow-merged over client defaults; nested objects
(`cache`, `rateLimiting`, `compression`, `session`, `circuitBreaker`,
`timeouts`) are merged one level deep.

---

## Defaults at a glance

```js
const defaults = {
  timeout: null,
  retries: 3,
  retryDelay: 1000,
  humanize: false,
  followRedirects: true,
  maxRedirects: 5,
  validateSSL: true,
  useHttp2: false,
  debug: false,
  randomizeHeaders: false,

  cache: { enabled: true, ttl: 300000, maxSize: 1000 },
  rateLimiting: { enabled: false, requestsPerSecond: 2, maxDelay: 64000, minDelay: 1000 },
  compression: { request: true, response: true, minSize: 1024, responseMinSize: 0 },
  timeouts: null,
  session: { ttl: 3600000, maxSessions: 100, autoCleanup: true },
  circuitBreaker: { enabled: false, failureThreshold: 5, resetTimeout: 60000 },

  proxy: null,
  baseURL: null,
  responseEncoding: 'utf-8',
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
  decompress: true,

  keepAlive: true,
  maxSockets: Infinity,
  maxFreeSockets: 256,
  agent: null,

  auth: null,
  bearer: null,
  token: null,

  retryOn: null,
  retryBackoff: null,
  retryJitter: false,
  maxRetryAfter: 60000,
  onRetry: null,

  onRequest: null,
  onResponse: null,
  onError: null,
  onDownloadProgress: null,
  onUploadProgress: null,

  stream: false,
  transport: 'http',
};
```

---

## Full option table

### Networking

| Option | Default | Description |
|--------|---------|-------------|
| `baseURL` | `null` | Prepended to relative URLs. |
| `timeout` | `null` | Socket-level request timeout (ms). **Opt-in** — no per-request timer unless set. |
| `timeouts` | `null` | Finer-grained opt-in timers: `{ connect, response, idle }`. See [Timeouts](timeouts.md). |
| `followRedirects` | `true` | Follow 301/302/303/307/308. |
| `maxRedirects` | `5` | Max redirect hops before error. |
| `validateSSL` | `true` | `rejectUnauthorized` for TLS. `false` disables cert validation (dev only). |
| `useHttp2` | `false` | Use Node `http2` when URL is `https:` and not streaming. |
| `transport` | `'http'` | `'http'` (node built-ins) or `'undici'` (optional peer dep). See [HTTP/2 and transport](http2-and-transport.md). |
| `proxy` | `null` | `{ host, port, auth? }`. See [Proxy](proxy.md). |
| `decompress` | `true` | Master switch for response decompression. `false` skips gzip/deflate/br. |
| `responseEncoding` | `'utf-8'` | Declared but **not consumed** by the implementation. |
| `maxContentLength` | `Infinity` | Declared but **not enforced** by the implementation. |
| `maxBodyLength` | `Infinity` | Declared but **not enforced** by the implementation. |
| `connectTimeout` | — | Declared in the TypeScript types only; never referenced by the JS implementation. |

### Retries

| Option | Default | Description |
|--------|---------|-------------|
| `retries` | `3` | Total attempts (1 = no retry). Forced to 1 in stream mode. |
| `retryDelay` | `1000` | Base delay (ms) between attempts. |
| `retryBackoff` | `null` | Exponential factor. `delay = retryDelay * retryBackoff^(attempt-1)`. `null` = linear. |
| `retryJitter` | `false` | Randomize backoff. `true` = full jitter; a number caps it. |
| `retryOn` | `null` | `number[]` of statuses to retry, or `(error) => boolean`. Default retries everything except 4xx (but **429 is retried**). |
| `maxRetryAfter` | `60000` | Cap (ms) for honoring a server `Retry-After` header. |
| `onRetry` | `null` | `(attempt, error, delay) => void` informational hook before each retry. |

See [Retries](retries.md).

### Connection pooling

| Option | Default | Description |
|--------|---------|-------------|
| `keepAlive` | `true` | Reuse TCP sockets (keep-alive agents per origin). |
| `maxSockets` | `Infinity` | Max concurrent sockets per origin. |
| `maxFreeSockets` | `256` | Idle sockets kept alive. |
| `keepAliveMsecs` | `1000` | Agent keep-alive socket ms. |
| `agent` | `null` | Custom `http.Agent`/`https.Agent`. Wins over pooling and is used as-is (never pooled). |

See [Connection pooling](connection-pooling.md).

### Caching

| Option | Default | Description |
|--------|---------|-------------|
| `cache.enabled` | `true` | Cache GET responses. |
| `cache.ttl` | `300000` | Entry lifetime (ms). |
| `cache.maxSize` | `1000` | Max entries; evicts oldest 20% when full. |
| `cache.staleWhileRevalidate` | `false` | Serve stale entries while refreshing in background. |
| `cache.ignoreQuery` | — | Drop the query string from the cache key. |
| `cache.keyBuilder` | — | Custom `(method, url, data) => string`. |
| `cache.storage` | `Map` | Pluggable storage (`get/set/delete/clear`). |

Cache keys are **auth-aware** (`vary`). See [Caching](caching.md).

### Resilience

| Option | Default | Description |
|--------|---------|-------------|
| `circuitBreaker.enabled` | `false` | Enable per-hostname circuit breaker. |
| `circuitBreaker.failureThreshold` | `5` | Consecutive failures (transport or HTTP >= 500) before OPEN. |
| `circuitBreaker.resetTimeout` | `60000` | ms before OPEN → HALF-OPEN. |
| `rateLimiting.enabled` | `false` | Throttle per-hostname. |
| `rateLimiting.requestsPerSecond` | `2` | Max requests per second per domain. |
| `rateLimiting.minDelay` | `1000` | Floor delay (ms). |
| `rateLimiting.maxDelay` | `64000` | Cap on adaptive backoff delay (ms). |

See [Circuit breaker](circuit-breaker.md) and [Rate limiting](rate-limiting.md).

### Compression

| Option | Default | Description |
|--------|---------|-------------|
| `compression.request` | `true` | Gzip-compress JSON payloads >= `minSize`. |
| `compression.response` | `true` | Decompress gzip/deflate/br responses. |
| `compression.minSize` | `1024` | Min JSON string length to gzip the request body. |
| `compression.responseMinSize` | `0` | Min content-length to decompress a response. |

See [Compression](compression.md).

### Sessions

| Option | Default | Description |
|--------|---------|-------------|
| `session.ttl` | `3600000` | Session expiry (1h). |
| `session.maxSessions` | `100` | Above this, expired sessions purged on access. |
| `session.autoCleanup` | `true` | Background cleanup timer (emits `sessions:cleanup`). |

See [Cookies and sessions](../guides/cookies-and-sessions.md).

### Auth & requests

| Option | Default | Description |
|--------|---------|-------------|
| `auth` | `null` | `{ username, password }` → `Basic` header. |
| `bearer` | `null` | → `Authorization: Bearer <token>`. |
| `token` | `null` | → `Authorization: <token>`. |
| `headers` | `{}` | Default headers (override generated ones). |
| `params` | `{}` | Default query params. |
| `userAgent` | Swiftly UA | Overrides the default User-Agent. |
| `responseType` | auto | `'json' \| 'text' \| 'html' \| 'buffer' \| 'raw'`. See [Responses](../guides/responses.md). |
| `responseSchema` | — | Type map validated against the JSON body. See [Response schema](../reference/response-schema.md). |
| `stream` | `false` | Return a Readable instead of a buffered body. |
| `signal` | — | `AbortSignal` for cancellation. |
| `formData` | — | Encode `data` as `multipart/form-data`. |
| `deduplicate` | `true` | Deduplicate concurrent GETs to the same URL. Set `false` to disable. |
| `trackRouteTimes` | `false` | Record per-route metrics. |

### Behavior & hooks

| Option | Default | Description |
|--------|---------|-------------|
| `humanize` | `false` | Random 500–1500ms delay before each request (perf-first: off). |
| `randomizeHeaders` | `false` | Randomize User-Agent and Accept-Language. |
| `debug` | `false` | Verbose logging (`[Swiftly ...]` lines). |
| `onRequest` | `null` | `({ method, url, options }) => void` pre-flight. |
| `onResponse` | `null` | `(data, response) => void` after response. |
| `onError` | `null` | `(error) => void` on final failure. |
| `onDownloadProgress` | `null` | `({ loaded, total, percent }) => void`. |
| `onUploadProgress` | `null` | `({ loaded, total, percent }) => void`. |

---

## Next steps

- [Retries](retries.md)
- [Timeouts](timeouts.md)
- [Caching](caching.md)