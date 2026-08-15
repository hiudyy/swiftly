# Batch and deduplication

## batch() — concurrent requests that never reject

Run many requests at once. Each result is either the **parsed body** or an
**`{ error }`** object — the batch promise itself never rejects.

```js
const results = await api.batch([
  { method: 'GET', url: '/users/1' },
  { method: 'POST', url: '/events', data: { type: 'click' } },
  { method: 'PUT', url: '/items/1', data: { name: 'X' } },
]);

for (const r of results) {
  if (r.error) {
    console.error('failed:', r.error.code, r.error.message);
  } else {
    console.log('ok:', r);
  }
}
```

### Request objects

| Field | Default | Description |
|-------|---------|-------------|
| `method` | `'GET'` | HTTP verb |
| `url` | — (required) | Request URL |
| `data` | `null` | Body, passed to `post`/`put`/`patch` |
| `config` | `{}` | Per-request config |

Body-bearing methods (`post`, `put`, `patch`) pass `data`; the others
(`get`, `delete`, `head`, `options`) don't.

### Errors

`batch` throws a `ValidationError` only if `requests` is not an array.
Individual failures resolve as `{ error }` — check `r.error` on every result.

## Request deduplication

By default, concurrent **GET** requests to the same URL are **deduplicated**:
only one network request is made and all callers share the same promise.

```js
const [a, b, c] = await Promise.all([
  api.get('/users/1'),
  api.get('/users/1'),
  api.get('/users/1'),
]);
// one HTTP request, three resolved promises
```

Disable it per request (or client-wide):

```js
await api.get('/users/1', { deduplicate: false });

const api2 = swiftly({ deduplicate: false }); // disabled for all requests
```

Deduplication is skipped for stream requests.

Dedup keys are **auth-aware**: concurrent GETs to the same URL with different
credentials — different `Authorization`/tokens or per-request `Cookie`
headers — are never merged. Each caller gets its own response; only identical
concurrent GETs share a single network request.

## trackRouteTimes — per-route metrics

Opt in to per-route timing metrics:

```js
const api = swiftly({ trackRouteTimes: true });

await api.get('/users/1');
await api.get('/users/2');

const m = api.getMetrics();
for (const [route, avgMs] of m.routeTimes) {
  console.log(route, avgMs); // 'GET /users/1' 12.3  ...
}
```

See [Metrics](../reference/metrics.md).

## Next steps

- [Interceptors](interceptors.md)
- [Metrics](../reference/metrics.md)