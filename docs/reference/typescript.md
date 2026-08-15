# TypeScript types

Swiftly ships its own type definitions (`index.d.ts`). Everything below is
exported and available for typed usage:

```ts
import swiftly, { type Config, type Metrics } from 'swiftly';

const api = swiftly<Config>({ rateLimiting: { enabled: true } });
const metrics: Metrics = api.getMetrics();
```

## Union types

- `HTTPMethod` — `'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'`
- `ResponseType` — `'json' | 'text' | 'html' | 'buffer' | 'raw'`
- `TransportType` — `'http' | 'http2' | 'undici'`
- `RetryCondition` — `(status: number, response: any, options: Config) => boolean`

## Config interfaces

| Interface | Shape |
|-----------|-------|
| `CacheStorage` | `{ get(key), set(key, value, ttl?), delete(key), clear(), entries() }` (all return `Promise` or plain values) |
| `CacheConfig` | `enabled?`, `maxSize?` (default 100), `ttl?` (default 60000), `staleWhileRevalidate?`, `ignoreQuery?`, `keyBuilder?`, `vary?` |
| `RateLimitConfig` | `enabled?`, `max?` (default 10), `windowMs?` (default 1000), `domainMax?` (default 10), `domainWindowMs?` (default 1000), `cooldownMs?` (default 10000) |
| `CompressionConfig` | `enabled?`, `minSize?` (default 1024), `threshold?` (default 0.8), `level?` (default 6) |
| `TimeoutConfig` | `connect?` (default 5000), `response?` (default 30000), `idle?` (default 60000) |
| `SessionConfig` | `enabled?`, `ttl?` (default 3600000), `cookies?` (default `{ enabled: true }`) |
| `CircuitBreakerConfig` | `enabled?`, `threshold?` (default 0.6), `timeout?` (default 30000), `maxFailures?` (default 5), `cooldownMs?` (default 10000) |
| `ProxyConfig` | `host`, `port`, `protocol?`, `auth?` (username/password), `bypass?` |

## `RawResponse<T>`

```ts
{ data: T; status: number; statusText: string; headers: Record<string, string>; config: Config }
```

## `Config`

The full client configuration — every option from the
[configuration overview](../configuration/overview.md): `timeout`, `retries`,
`retryDelay`, `retryBackoff`, `retryJitter`, `retryOn`, `maxRetryAfter`,
`humanize`, `followRedirects`, `maxRedirects`, `validateSSL`, `useHttp2`,
`transport`, `debug`, `randomizeHeaders`, `compression`, `timeouts`,
`headers`, `session`, `cache`, `rateLimiting`, `circuitBreaker`, `proxy`,
`baseURL`, `responseEncoding`, `responseType`, `maxContentLength`,
`maxBodyLength`, `decompress`, `keepAlive`, `maxSockets`, `maxFreeSockets`,
`keepAliveMsecs`, `agent`, `auth`, `bearer`, `token`, `onRequest`,
`onResponse`, `onError`, `onRetry`, `onDownloadProgress`, `onUploadProgress`,
`stream`, `responseSchema`, `trackRouteTimes`, `deduplicate`, `connectTimeout`.

`RequestOptions extends Config` adds `params`, `query` (GraphQL),
`formData`, `signal`, `userAgent`, `responseType` (per request).

## `Metrics`

```ts
{ requests: { total, cached, errors, byRoute }, circuitBreakers: Record<string, CircuitBreakerMetrics>, retries: number, avgDuration: number }
```

`CircuitBreakerMetrics` is `{ state, failures, successes, lastFailure,
lastSuccess, cooldownUntil, threshold }`. See [Metrics](metrics.md).

## Entities

- `CookieJar` — `setCookie`, `getCookies`, `getCookiesMap`, `clearCookies`,
  `toJSON`, `fromJSON`. See [Cookies and sessions](../guides/cookies-and-sessions.md).
- `InterceptorManager` — `use`, `eject`, `clear`, `executeRequestChain`,
  `executeResponseChain`, `executeResponseErrorChain`. See
  [Interceptors](../guides/interceptors.md).
- `ClientInstance` / `SwiftlyStatic` — the full method surface
  (`get/post/put/patch/delete/head/options`, `query`, `batch`, `download`,
  `subscribe`, `scrape`, `parseHTML` & friends, `on/off`, `interceptors`,
  `client`, `events`, `getMetrics`, `clearCache`, `resetCircuitBreakers`,
  `close`, `setBaseURL`, `setDefaultHeaders`, `setTimeout`, `setDebug`,
  `getConfig`).
- `Element` — the wrapper from `parseHTML` (`text()`, `data()`, `find()`,
  `findAll()`, `attr()`, `children()`, `parent()`).

## Known type mismatches

These are type-level inaccuracies in the shipped `index.d.ts` (the runtime
behavior is documented in the linked pages — follow the runtime):

- `retryBackoff` is typed `'linear' | 'exponential'` but the implementation
  treats it as a **number** (>= 1, exponential factor). See
  [Retries](../configuration/retries.md).
- `retryOn` is typed `(response: any) => boolean` but the runtime passes
  `(response, status, options)`.
- `downloadTo(filePath, url, config)` is typed in that order, but the
  implementation expects `downloadTo(url, filePath, config)`. See
  [Client methods](client-methods.md).
- `on`/`off` return the emitter (typed as the client).
- `connectTimeout` exists in the types but is never used at runtime.

## Next steps

- [Configuration overview](../configuration/overview.md)
- [Error types](error-types.md)