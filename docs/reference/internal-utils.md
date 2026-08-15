# Internal utilities

These modules power Swiftly internally. They are **not** re-exported from the
package root, but you can import them directly from the deep paths below if you
need them. Not part of the stable API — but documented for completeness.

## lib/utils.js

`import { ... } from 'swiftly/lib/utils.js'`

| Function | Signature | Behavior |
|----------|-----------|----------|
| `detectResponseType(contentType)` | `(string) => 'json' \| 'html' \| 'text' \| 'buffer'` | Lowercased checks: `application/json` → json, `text/html` → html, `text/` → text, else buffer. |
| `delay(ms, signal?)` | `(number, AbortSignal?) => Promise<void>` | Wait; rejects with `Error('Aborted')` if the signal aborts. |
| `buildQueryString(params)` | `(object) => string` | `querystring.stringify`; nested objects JSON-stringified. |
| `isValidUrl(string)` | `(string) => boolean` | `new URL()` parses without throwing. |
| `deepMerge(target, source)` | `(object, object) => object` | Immutable deep merge (arrays replace). |
| `parseUrl(url)` | `(string) => { protocol, hostname, port, pathname, search, hash, params } \| null` | Parsed URL plus `params` map; `null` if invalid. |
| `formatBytes(bytes, decimals?)` | `(number, number) => string` | `'1.5 KB'`, SI base 1024. |
| `formatDuration(ms)` | `(number) => string` | `'42ms'` / `'1.20s'` / `'2.00m'`. |
| `generateId()` | `() => string` | Base-36 timestamp + random suffix. |
| `retryWithBackoff(fn, maxRetries?, baseDelay?)` | `(fn, number, number) => Promise` | Retries `fn()` with exponential backoff. |
| `withTimeout(promise, ms, message?)` | `(Promise, number, string) => Promise` | Race with a timeout rejection. |
| `safeJsonParse(str, fallback?)` | `(string, any) => any` | `JSON.parse` with a fallback on failure. |
| `chunk(array, size)` | `(Array, number) => Array<Array>` | Split into arrays of at most `size`. |

## lib/agent.js — connection pooling

`import { getAgent, destroyAgents } from 'swiftly/lib/agent.js'`

- `getAgent(protocol, hostKey, config, pool)` — returns (and caches) an
  `http.Agent`/`https.Agent` per `protocol://host` and per setting
  (`keepAlive`, `maxSockets`, `maxFreeSockets`, `keepAliveMsecs`). A custom
  `config.agent` wins and is never pooled.
- `destroyAgents(pool)` — destroys every agent and clears the pool (used by
  `client.close()`).

## lib/headers.js — header generation

`import { generateHeaders } from 'swiftly/lib/headers.js'`

`generateHeaders(config)` returns `{ 'User-Agent', Accept, Accept-Language,
Accept-Encoding }`. With `config.randomizeHeaders` it picks a random
User-Agent (Chrome/120 Windows, Chrome/120 macOS, Firefox/121, Swiftly UA) and
a random Accept-Language. Custom `config.headers` override the generated ones.
The default User-Agent is
`Swiftly/1.0 (+https://github.com/hiudyy/swiftly)`.

## lib/events.js — emitter

`import { createEventEmitter, events } from 'swiftly/lib/events.js'`

A small `EventEmitter` (`on`, `off`, `once`, `emit`, `hasListeners`) plus the
`events` constant map of all event names. See [Events](events.md).

## lib/errors.js — error classes

`import { SwiftlyError, ValidationError, RequestError, ResponseError,
CircuitBreakerError, TimeoutError, AbortError } from 'swiftly/lib/errors.js'`

The full error hierarchy. See [Error types](error-types.md).

## lib/cache.js — CacheStore

`import { CacheStore, createCacheStore } from 'swiftly/lib/cache.js'`

LRU + TTL store. Methods: `set(key, value, ttl?)`, `get(key)`, `peek(key)`
(→ `{ value, stale }`), `has(key)`, `delete(key)`, `clear()`,
`getCacheKey(method, url, data, options)`, `getStats()`. See
[Caching](../configuration/caching.md).

## lib/rate-limiter.js — RateLimiter

`import { RateLimiter, createRateLimiter } from 'swiftly/lib/rate-limiter.js'`

Sliding-window throttle with adaptive delay. Methods: `checkLimit(domain)`,
`setDomainConfig(domain, config)`, `clearDomain(domain)`, `clear()`. See
[Rate limiting](../configuration/rate-limiting.md).

## lib/interceptor.js — InterceptorManager & CookieJar

`import { InterceptorManager, CookieJar, createInterceptorManager, createCookieJar } from 'swiftly/lib/interceptor.js'`

- `InterceptorManager` — `use(fulfilled, rejected)`, `eject(id)`, `clear()`,
  `executeRequestChain(config)`, `executeResponseChain(response)`,
  `executeResponseErrorChain(error)`. See [Interceptors](../guides/interceptors.md).
- `CookieJar` — `setCookie(url, name, value, opts)`, `getCookies(url)`,
  `getCookiesMap(url)`, `clearCookies(url?)`, `toJSON()`, `fromJSON(data)`.
  RFC 6265 Domain/Path/Secure matching. See
  [Cookies and sessions](../guides/cookies-and-sessions.md).

## lib/scraper.js — entity helpers

`import { decodeEntities, encodeEntities } from 'swiftly/lib/scraper.js'`

Entity decoding/encoding. See [Sanitizing and Markdown](../scraping/sanitize-and-markdown.md).

## Next steps

- [Client methods](client-methods.md)
- [Events](events.md)