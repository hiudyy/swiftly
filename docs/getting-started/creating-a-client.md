# Creating a client

There are two ways to use Swiftly: **static calls** on the default export, and
**dedicated client instances**.

## Static calls (shared default client)

```js
import swiftly from 'swiftly';

await swiftly.get('https://api.example.com/users/1');
await swiftly.post('https://api.example.com/users', { name: 'Ada' });
```

All static calls (`get`, `post`, `put`, `patch`, `delete`, `head`, `options`,
`batch`, `download`, `query`, `subscribe`, `scrape`, `on`, `off`,
`clearCache`, `resetCircuitBreakers`, `getMetrics`) share a **single internal
default client**, so the connection pool, cookie jar, cache and circuit
breakers persist across calls. The default client is created lazily on first
use with `{ debug: false }`.

Access it directly for advanced use:

```js
import swiftly from 'swiftly';

const shared = swiftly.client(); // the shared HTTPClient
shared.interceptors.request.use((config) => config);
```

## Dedicated clients

Create an independent client with its own defaults and state:

```js
const api = swiftly({
  baseURL: 'https://api.example.com',
  headers: { 'X-App': 'demo' },
  timeout: 5000,
  retries: 3,
  cache: { enabled: true, ttl: 300_000 },
});
```

Each `swiftly(config)` call builds a fresh client — its own connection pool,
cookie jar, cache and circuit breakers.

## The client is callable

A client instance is itself a function: `api(url, config)` is a GET:

```js
const page = await api('https://api.example.com/page');
// equivalent to api.get('https://api.example.com/page')
```

## Client instance surface

| Member | Type | Description |
|--------|------|-------------|
| `get`, `post`, `put`, `patch`, `delete`, `head`, `options` | methods | HTTP verbs |
| `request(method, url, data, config)` | method | Any verb, low level |
| `query`, `subscribe`, `batch`, `download`, `scrape`, `parse` | methods | Advanced features |
| `on`, `off` | methods | Event listeners |
| `interceptors` | object | Request/response interceptor managers |
| `clearCache()`, `resetCircuitBreakers()` | methods | Reset state |
| `getMetrics()` | method | Metrics snapshot |
| `close()` | method | Close pools/sessions/cache |
| `setBaseURL(url)` | method | Change base URL |
| `setDefaultHeaders(headers)` | method | Merge default headers |
| `setTimeout(ms)` | method | Change default timeout |
| `setDebug(bool)` | method | Toggle debug logging |
| `getConfig()` | method | Live config object |

Note: `setBaseURL`, `setDefaultHeaders`, `setTimeout`, `setDebug` and
`getConfig` are exposed on the wrapper returned by `swiftly(...)`, while the
raw HTTPClient (from `swiftly.client()`) exposes `setConfig` and `clone`
instead. See [Client methods](../reference/client-methods.md).

## Merging config

Per-request config is shallow-merged over client defaults. Nested objects
(`cache`, `rateLimiting`, `compression`, `session`, `circuitBreaker`,
`timeouts`) are merged one level deep — a per-request `cache: { ttl: 1000 }`
keeps the client's other cache settings.

```js
const api = swiftly({ timeout: 5000, retries: 3 });

await api.get('/users', {
  timeout: 1000,          // override for this request only
  cache: { ttl: 10_000 }, // partial nested merge
});
```

## Next steps

- [Making requests](../guides/making-requests.md)
- [Options reference](../configuration/overview.md)