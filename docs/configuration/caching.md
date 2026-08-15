# Caching

GET responses are cached **by default** (`cache.enabled: true`) using an
in-memory LRU store with TTL.

## Defaults

| Option | Default | Description |
|--------|---------|-------------|
| `cache.enabled` | `true` | Cache GET (non-stream) responses. |
| `cache.ttl` | `300000` | Entry lifetime (ms). |
| `cache.maxSize` | `1000` | Max entries; evicts the oldest 20% when full. |
| `cache.staleWhileRevalidate` | `false` | Serve stale while refreshing in background. |
| `cache.ignoreQuery` | — | Ignore the query string when building the key. |
| `cache.keyBuilder` | — | Custom `(method, url, data) => string`. |
| `cache.storage` | `Map` | Pluggable storage (`get/set/delete/clear`). |

## Basic use

```js
const api = swiftly({ cache: { enabled: true, ttl: 300_000 } });

await api.get('/config');              // miss -> network
await api.get('/config');              // hit -> cached value, no network
```

Per-request opt-out:

```js
await api.get('/stock', { cache: { enabled: false } }); // always fresh
```

## What gets cached

- Only **GET** requests.
- Only responses with status **200**.
- Never in stream mode.
- The **final transformed result** is cached (same shape as a live request),
  so cache hits are indistinguishable from live responses.

## Cache keys are auth-aware

Cache keys include an **auth identity** derived from `auth`/`bearer`/`token`.
Responses for one set of credentials are **never** served to another:

```js
const a = await api.get('/me', { bearer: 'token-a' });
const b = await api.get('/me', { bearer: 'token-b' }); // separate cache entry
```

## Stale-while-revalidate

Serve the last known value immediately while refreshing it in the background:

```js
const api = swiftly({
  cache: { enabled: true, ttl: 60_000, staleWhileRevalidate: true },
});

await api.get('/config');   // miss -> network, cached
await api.get('/config');   // stale hit -> returns immediately, refreshes in bg
```

The `cache:hit` event includes `stale: true` for stale hits.

## Ignoring the query string

```js
const api = swiftly({ cache: { ignoreQuery: true } });

await api.get('/data?a=1');
await api.get('/data?b=2'); // same cache entry
```

## Custom cache keys

```js
const api = swiftly({
  cache: {
    keyBuilder: (method, url, data) => `${method}:${url}:${JSON.stringify(data)}`,
  },
});
```

## Custom storage

Plug any store with `get/set/delete/clear` (plus optional `keys`/`size`):

```js
import { createClient } from 'swiftly/lib/client.js';

const api = swiftly({
  cache: {
    storage: {
      get: (k) => globalThis.myStore.get(k),
      set: (k, entry) => globalThis.myStore.set(k, entry),
      delete: (k) => globalThis.myStore.delete(k),
      clear: () => globalThis.myStore.clear(),
    },
  },
});
```

> Note: LRU eviction and stats only apply to the default `Map` storage.

## Managing the cache

```js
api.clearCache();            // wipe all entries

// Cache stats (the jar/cache are on the underlying client, see below)
swiftly.client().cache.getStats();
// { size, validItems, expiredItems, maxSize, totalSize, utilizationPercent }
```

> Note: like the cookie jar, the cache store lives on the underlying
> HTTPClient and is not forwarded on the `swiftly(...)` wrapper. Use
> `swiftly.client().cache` (shared client) or a raw client from `createClient`
> for direct access.

## Cache events

- `cache:hit` — `{ url }` (or `{ url, stale }` with SWR)
- `cache:miss` — `{ url }`
- `cache:store` — `{ url }` (a 200 GET was written)

See [Events](../reference/events.md).

## Next steps

- [Metrics](../reference/metrics.md)
- [Authentication](../guides/authentication.md)