# Configuration

All options are passed to `swiftly(config)`. Every option is optional; defaults
are performance-first (no timeout, no rate limiting, caching on).

## Networking

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `baseURL` | `string` | `null` | Prefix applied to relative request URLs. |
| `timeout` | `number` | `null` | Per-request socket timeout in ms (opt-in; no timer is created unless set). |
| `timeouts` | `object` | `null` | Connect/response/idle timers: `{ connect, response, idle }` in ms. |
| `followRedirects` | `boolean` | `true` | Automatically follow 3xx responses. |
| `maxRedirects` | `number` | `5` | Maximum number of redirects to follow. |
| `validateSSL` | `boolean` | `true` | Reject invalid TLS certificates. |
| `useHttp2` | `boolean` | `false` | Use HTTP/2 when available. |
| `transport` | `'http' \| 'undici'` | `'http'` | Underlying transport (`undici` is an optional peer dependency, lazy-loaded). |
| `proxy` | `object` | `null` | `{ host, port, auth? }` HTTP/HTTPS proxy. |
| `decompress` | `boolean` | `true` | Automatically decompress gzip/deflate/br responses. |

## Retries & redirects

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `retries` | `number` | `3` | Total attempts (1 = one try, no retry). |
| `retryDelay` | `number` | `1000` | Base delay between attempts (ms). |
| `retryBackoff` | `number` | `null` | Exponential factor (>= 1); linear when omitted. |
| `retryJitter` | `boolean` | `false` | Add randomized jitter to the backoff. |
| `retryOn` | `number[] \| (err) => boolean` | `null` | Status codes / predicate that decides whether to retry. |
| `maxRetryAfter` | `number` | `60000` | Cap (ms) for an honored `Retry-After` header. |
| `onRetry` | `(attempt, error, delay) => void` | `null` | Hook called before each retry. |

## Performance controls

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `keepAlive` | `boolean` | `true` | Reuse TCP connections (connection pooling). |
| `maxSockets` | `number` | `Infinity` | Max concurrent sockets per origin. |
| `maxFreeSockets` | `number` | `256` | Idle sockets kept alive. |
| `agent` | `http.Agent` | `null` | Custom agent override. |
| `humanize` | `boolean` | `false` | Add artificial delay between requests. |
| `compression` | `object` | `{ request: true, response: true, minSize: 1024, responseMinSize: 0 }` | gzip/brotli request & response handling. |
| `session` | `object` | `{ ttl: 3600000, maxSessions: 100, autoCleanup: true }` | HTTP/2 session pooling. |

## Caching

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `cache.enabled` | `boolean` | `true` | Cache GET responses. |
| `cache.ttl` | `number` | `300000` | Entry lifetime in ms. |
| `cache.maxSize` | `number` | `1000` | Max number of entries (LRU eviction). |
| `cache.staleWhileRevalidate` | `boolean` | `false` | Serve stale while refreshing in the background. |
| `cache.keyBuilder` | `(method, url, data) => string` | `null` | Custom cache key. |

The cache key is **auth-aware**: responses for different credentials
(`auth` / `bearer` / `token` / `Authorization` header) are stored under
separate keys, so one user's cached response is never returned to another.

## Resilience

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `circuitBreaker.enabled` | `boolean` | `false` | Enable the per-domain circuit breaker. |
| `circuitBreaker.failureThreshold` | `number` | `5` | Failures before the breaker opens. |
| `circuitBreaker.resetTimeout` | `number` | `60000` | Cool-down before half-open recovery. |
| `rateLimiting.enabled` | `boolean` | `false` | Enable per-domain rate limiting. |
| `rateLimiting.requestsPerSecond` | `number` | `2` | Target request rate per domain. |
| `rateLimiting.minDelay` / `maxDelay` | `number` | `1000` / `64000` | Backoff bounds for throttling. |

## Requests

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `params` | `object` | – | Query string params (nested objects/arrays are serialized). |
| `headers` | `object` | – | Request headers. |
| `auth` | `{ username, password }` | `null` | Basic auth. |
| `bearer` | `string` | `null` | Bearer token. |
| `token` | `string` | `null` | Raw `Authorization` value. |
| `responseType` | `'json' \| 'text' \| 'buffer' \| 'stream' \| 'raw'` | `'json'` | Expected/forced response shape. |
| `responseSchema` | `function` | `null` | Validate/transform the parsed body (throws `ValidationError` on failure). |
| `stream` | `boolean` | `false` | Return the raw response stream. |
| `maxContentLength` / `maxBodyLength` | `number` | `Infinity` | Size guards. |
| `randomizeHeaders` | `boolean` | `false` | Randomize header ordering. |
| `debug` | `boolean` | `false` | Verbose logging. |

### Hooks

| Option | Signature | When |
| ------ | --------- | ---- |
| `onRequest` | `(config) => void` | before a request is sent |
| `onResponse` | `(response) => void` | after a successful response |
| `onError` | `(error) => void` | after a failed request |
| `onDownloadProgress` | `({ loaded, total }) => void` | download progress |
| `onUploadProgress` | `({ loaded, total }) => void` | upload progress |

## Configuration helpers

On a client instance you can also change config at runtime:

```js
const api = swiftly();

api.setBaseURL('https://api.example.com');
api.setTimeout(5000);
api.setDefaultHeaders({ 'X-App': 'demo' });
api.setDebug(true);
api.getConfig(); // current config
```
