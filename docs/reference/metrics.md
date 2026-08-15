# Metrics

`getMetrics()` returns a snapshot of client activity.

```js
const m = api.getMetrics();
console.log(m);
```

## Shape

| Field | Type | Meaning |
|-------|------|---------|
| `requestCount` | number | Total requests executed. |
| `totalTime` | number | Sum of request durations (ms). |
| `cacheHits` | number | Cache hits. |
| `cacheMisses` | number | Cache misses. |
| `retries` | number | Retry attempts performed. |
| `successCount` | number | Successful requests. |
| `errorCount` | number | Failed requests. |
| `averageResponseTime` | number | `totalTime / requestCount` (ms). |
| `lastRequestTime` | number | Duration of the most recent request (ms). |
| `totalDataTransferred` | number | Total response bytes received. |
| `http2Requests` | number | Requests served over HTTP/2. |
| `redirects` | number | Redirects followed. |
| `activeSessions` | number | Live session count (`sessions.size`). |
| `pooledConnections` | number | Pooled agent/origin count. |
| `http2Sessions` | number | Open HTTP/2 sessions. |
| `cacheSize` | number | Entries in the cache. |
| `circuitBreakers` | array | `[{ domain, state }]` per-domain breaker state. |
| `routeTimes` | Map | Per-route average times (`trackRouteTimes: true` only). |

## Route-level timing

Opt in with `trackRouteTimes: true`, then read `routeTimes`:

```js
const api = swiftly({ trackRouteTimes: true });

await api.get('/users/1');
await api.get('/users/2');

const m = api.getMetrics();
for (const [route, avg] of m.routeTimes) {
  console.log(route, avg); // e.g. 'GET /users/1' 12.4
}
```

Route keys look like `GET /path`.

## Cache stats

Cache internals are available via `getMetrics().cacheSize`, or directly on the
underlying client's cache store (the wrapper does not forward it):

```js
import swiftly from 'swiftly';

swiftly.client().cache.getStats();
// { size, validItems, expiredItems, maxSize, totalSize, utilizationPercent }
```

See [Caching](../configuration/caching.md).

## Example: watchdog

```js
setInterval(() => {
  const m = api.getMetrics();
  if (m.errorCount > 0) {
    const ratio = m.errorCount / m.requestCount;
    console.warn(`error ratio: ${(ratio * 100).toFixed(1)}%`);
  }
}, 5000);
```

## Next steps

- [Events](events.md)
- [Client methods](client-methods.md)