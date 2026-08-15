# Configuration

`swiftly(config)` accepts all options below. Every option is **optional**; the
defaults are performance-first (no timeout, no rate limiting, caching enabled).

Options are grouped by concern. The compact table in the
[README](../README.md) lists everything at a glance; this page explains each
one and shows how to use it.

## Networking

### `baseURL`
Prefix applied to relative request URLs.

```js
const api = swiftly({ baseURL: 'https://api.example.com' });
await api.get('/users/1'); // -> https://api.example.com/users/1
```
Absolute URLs ignore `baseURL`.

### `timeout`
Per-request socket timeout in **milliseconds**. `null` means no timer is
created (the OS default applies). This is opt-in for performance.

```js
swiftly({ timeout: 8000 }); // give up if no response within 8s
```

### `timeouts`
Finer-grained timers as an object: `{ connect, response, idle }` (ms). Use when
you need to distinguish connection vs. overall timeouts.

```js
swiftly({ timeouts: { connect: 2000, response: 5000, idle: 10000 } });
```

### `followRedirects` / `maxRedirects`
Whether to follow 3xx automatically, and how many hops to allow.

```js
swiftly({ followRedirects: true, maxRedirects: 5 });
```
Redirects are followed transparently; the final body is returned. Cookies set
on intermediate responses are stored.

### `validateSSL`
Reject invalid TLS certificates. Keep `true` in production. Set `false` only for
self-signed dev servers.

```js
swiftly({ validateSSL: false }); // dev only!
```

### `useHttp2`
Use HTTP/2 when the server supports it. Connections are pooled per session.

```js
swiftly({ useHttp2: true });
```

### `transport`
Underlying engine: `'http'` (default, Node's `http`/`https`) or `'undici'`
(optional peer dependency, lazy-loaded).

```js
swiftly({ transport: 'undici' });
```
`undici` must be installed separately (`npm i undici`).

### `proxy`
Route requests through an HTTP/HTTPS proxy.

```js
swiftly({ proxy: { host: '127.0.0.1', port: 8080, auth: { username: 'u', password: 'p' } } });
```
For HTTPS targets the client issues a `CONNECT` tunnel through the proxy.

### `decompress`
Automatically decompress `gzip` / `deflate` / `br` responses. Almost always
leave `true`.

```js
swiftly({ decompress: true });
```

## Retries

### `retries`
**Total** attempts (not extra retries). `retries: 3` means up to 3 tries;
`retries: 1` means exactly one try (no retry); `retries: 0` means zero attempts
and the call resolves `undefined` — avoid `0`.

```js
swiftly({ retries: 3 });
```

### `retryDelay`
Base delay (ms) between attempts.

### `retryBackoff`
Exponential factor (≥ 1). When set, delay grows as `retryDelay * backoff^(n-1)`.
Omit for linear backoff.

```js
swiftly({ retries: 5, retryDelay: 500, retryBackoff: 2 });
// delays: 500, 1000, 2000, 4000, ...
```

### `retryJitter`
Add randomized jitter to the backoff to avoid thundering herds.

```js
swiftly({ retryBackoff: 2, retryJitter: true });
```

### `retryOn`
Restrict *which* failures retry. Accepts an array of status codes, or a
predicate `(error) => boolean`. Network errors always retry regardless.

```js
swiftly({ retryOn: [429, 500, 502, 503, 504] });
swiftly({ retryOn: (err) => err.code === 'RESPONSE_ERROR' && err.response.status >= 500 });
```

### `maxRetryAfter`
Upper bound (ms) for an honored `Retry-After` header, so a server can't force
you to wait forever.

### `onRetry`
Hook called before each retry.

```js
swiftly({ onRetry: (attempt, error, delay) => console.log(`retry ${attempt} in ${delay}ms`) });
```

## Performance

### `keepAlive` / `maxSockets` / `maxFreeSockets`
Connection pooling. `keepAlive: true` reuses TCP sockets (huge speedup for many
small requests). `maxSockets` caps concurrency per origin; `maxFreeSockets`
caps idle sockets kept warm.

```js
swiftly({ keepAlive: true, maxSockets: 100, maxFreeSockets: 256 });
```

### `agent`
Provide your own `http.Agent` / `https.Agent` to fully control pooling, TLS, or
proxying.

### `humanize`
Add a small artificial delay between requests. Off by default; useful when
politely crawling a slow server.

### `compression`
Controls gzip/brotli for request and response bodies.

```js
swiftly({ compression: { request: true, response: true, minSize: 1024, responseMinSize: 0 } });
```
`request`/`response` toggle compression; `minSize` is the smallest request
payload worth compressing; `responseMinSize` the smallest response to
decompress.

### `session`
HTTP/2 session pool settings: `ttl`, `maxSessions`, `autoCleanup`.

## Caching

GET responses are cached by default using **auth-aware keys** — responses for
different credentials (`auth` / `bearer` / `token` / `Authorization` header)
are stored under separate keys, so one user's cached response is never returned
to another.

| Option | Default | Description |
| ------ | ------- | ----------- |
| `cache.enabled` | `true` | Cache GET responses. |
| `cache.ttl` | `300000` | Entry lifetime in ms. |
| `cache.maxSize` | `1000` | Max entries; LRU eviction when full. |
| `cache.staleWhileRevalidate` | `false` | Serve stale immediately while refreshing in background. |
| `cache.keyBuilder` | `null` | Custom `(method, url, data) => string`. |

```js
const api = swiftly({
  cache: { enabled: true, ttl: 60_000, staleWhileRevalidate: true },
});

await api.get('/users/1'); // miss -> network
await api.get('/users/1'); // hit  -> instant (cached)
```

Disable per request with `cache: { enabled: false }`.

## Resilience

### `circuitBreaker`
Per-domain breaker that **opens** after `failureThreshold` failures and
recovers after `resetTimeout`. While open, requests fail fast with
`CircuitBreakerError` instead of hammering a dead dependency. It also trips on
5xx responses.

```js
swiftly({
  circuitBreaker: { enabled: true, failureThreshold: 5, resetTimeout: 60000 },
});
```
Listen with `api.on('circuit:open', ...)`. Reset manually via
`api.resetCircuitBreakers()`.

### `rateLimiting`
Optional per-domain throttle with adaptive backoff.

```js
swiftly({
  rateLimiting: { enabled: true, requestsPerSecond: 10, minDelay: 1000, maxDelay: 64000 },
});
```

## Requests

| Option | Description |
| ------ | ----------- |
| `params` | Query string object (nested/arrays serialized). |
| `headers` | Request headers. |
| `auth` | `{ username, password }` → Basic auth. |
| `bearer` | `Bearer <token>`. |
| `token` | Raw `Authorization` value. |
| `responseType` | `'json' \| 'text' \| 'buffer' \| 'stream' \| 'raw'`. |
| `responseSchema` | Object schema `{ key: 'type' }` validated against the parsed JSON body; throws on type mismatch. |
| `stream` | Return the raw response stream (retries off). |
| `maxContentLength` / `maxBodyLength` | Size guards (default `Infinity`). |
| `randomizeHeaders` | Randomize header ordering (fingerprint evasion). |
| `debug` | Verbose logging. |

### `responseSchema`
Validate the parsed JSON body against a simple type schema. It's an object
mapping each expected key to its required `typeof` string; on mismatch the
request throws.

```js
const api = swiftly({
  responseSchema: { id: 'number', name: 'string' },
});
// throws if `id` is not a number or `name` is not a string
```


## Hooks

Lifecycle callbacks, all optional:

| Hook | Signature | When |
| ---- | --------- | ---- |
| `onRequest` | `(config) => void` | before the request is sent |
| `onResponse` | `(response) => void` | after a successful response |
| `onError` | `(error) => void` | after a failed request |
| `onDownloadProgress` | `({ loaded, total }) => void` | download progress |
| `onUploadProgress` | `({ loaded, total }) => void` | upload progress |

```js
swiftly({
  onRequest: (cfg) => console.log('→', cfg.method, cfg.url),
  onResponse: (res) => console.log('←', res.status),
  onError: (err) => console.error('!', err.code),
});
```
