# Configuration

Every option is optional. Swiftly applies **performance-first defaults** — no
artificial delays, no throttling, no log spam — so it is fast out of the box.

Pass options to the factory (`swiftly(opts)`) or per-request
(`client.get(url, opts)`). Per-request options are deep-merged over instance
options.

## Networking

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `timeout` | `number` | `30000` | Overall request timeout (ms) |
| `timeouts.connect` | `number` | `5000` | Connection timeout (ms) |
| `timeouts.response` | `number` | `30000` | Time to receive response headers (ms) |
| `timeouts.idle` | `number` | `60000` | Max idle gap between data chunks (ms) |
| `useHttp2` | `boolean` | `false` | Use HTTP/2 over HTTPS |
| `validateSSL` | `boolean` | `true` | Reject invalid TLS certificates |
| `baseURL` | `string \| null` | `null` | Prefix for relative URLs |
| `proxy` | `object \| null` | `null` | `{ host, port, auth? }` |

## Retries & redirects

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `retries` | `number` | `3` | Attempts for transient (5xx/network) errors |
| `retryDelay` | `number` | `1000` | Base delay (ms); grows linearly per attempt |
| `followRedirects` | `boolean` | `true` | Follow 301/302/303/307/308 |
| `maxRedirects` | `number` | `5` | Max redirect hops |

4xx errors are **never** retried (except 429). Hard failures such as exceeding
`maxRedirects` are not retried either.

## Performance controls

| Option | Type | Default | Notes |
| ------ | ---- | ------- | ----- |
| `humanize` | `boolean` | `false` | Adds a random 500–1500ms delay. Keep OFF |
| `debug` | `boolean` | `false` | Prints request logs. Keep OFF |
| `rateLimiting.enabled` | `boolean` | `false` | Throttle per domain. Keep OFF |
| `rateLimiting.requestsPerSecond` | `number` | `2` | Used when enabled |
| `rateLimiting.maxDelay` | `number` | `64000` | Max throttle wait (ms) |
| `rateLimiting.minDelay` | `number` | `1000` | Min throttle wait (ms) |
| `randomizeHeaders` | `boolean` | `false` | Rotate UA / Accept-Language |
| `deduplicate` | `boolean` | `true` | Collapse concurrent identical GETs |

> The defaults exist so Swiftly is **fast and predictable**. Enable
> `humanize`, `debug` or rate limiting only when you explicitly want them.

## Caching

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `cache.enabled` | `boolean` | `true` | Cache 2xx GET responses in memory |
| `cache.ttl` | `number` | `300000` | Cache lifetime (ms) |
| `cache.maxSize` | `number` | `1000` | Max cached entries (LRU eviction) |

Disable per request with `{ cache: { enabled: false } }`.

## Compression

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `compression.request` | `boolean` | `true` | gzip outgoing JSON bodies |
| `compression.response` | `boolean` | `true` | Decompress gzip/deflate/br |
| `compression.minSize` | `number` | `1024` | Min request bytes to compress |
| `compression.responseMinSize` | `number` | `0` | Min response bytes to decompress |

## Resilience

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `circuitBreaker.enabled` | `boolean` | `false` | Open the circuit after failures |
| `circuitBreaker.failureThreshold` | `number` | `5` | Failures before opening |
| `circuitBreaker.resetTimeout` | `number` | `60000` | Wait before retrying (ms) |

## Requests

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `responseType` | `string` | auto | `json` \| `text` \| `html` \| `buffer` |
| `params` | `object` | `{}` | Extra query-string params |
| `headers` | `object` | `{}` | Custom request headers |
| `userAgent` | `string` | Swiftly UA | Custom User-Agent |
| `responseSchema` | `object` | – | Basic type validation of the response |
| `formData` | `boolean` | `false` | Send `data` as `multipart/form-data` |

## Configuration helpers

```js
const c = swiftly();
c.setBaseURL('https://example.com');
c.setTimeout(5000);
c.setDefaultHeaders({ 'X-App': 'demo' });
c.setDebug(false);
c.getConfig(); // returns the effective config object
```