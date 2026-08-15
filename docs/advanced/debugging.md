# Debugging

Tools and techniques for figuring out what Swiftly is doing.

## debug mode

Enable verbose logging with `debug: true`:

```js
const api = swiftly({ debug: true });
```

Log lines are prefixed with `[Swiftly <ISO timestamp>]` and cover request
lifecycle, cache hits/misses, retries, redirects and internal state changes.

```js
api.setDebug(true);   // toggle later
api.setDebug(false);
```

## Hooks

The informational hooks give you a per-request view without log spam:

```js
const api = swiftly({
  onRequest: ({ method, url, options }) => console.log('→', method, url),
  onResponse: (data, res) => console.log('←', res.status),
  onError: (error) => console.error('!', error.code, error.message),
  onRetry: (attempt, error, delay) => console.log(`retry ${attempt} in ${delay}ms`),
});
```

## Events

Events give you the same visibility asynchronously and can power dashboards:

```js
api.on('request:start', ({ method, url }) => console.log('→', method, url));
api.on('request:end', ({ status, time }) => console.log('←', status, `${time}ms`));
api.on('cache:hit', ({ url }) => console.log('cached:', url));
api.on('retry:attempt', ({ attempt, error, nextRetryDelay }) => {});
api.on('circuit:open', ({ domain }) => {});
```

See [Events](../reference/events.md) for every event and its payload.

## Common problems

### "Invalid JSON response"
The body did not parse as JSON. Inspect the raw body:

```js
const raw = await api.get(url, { responseType: 'raw' });
console.log(raw.status, raw.data, raw.headers['content-type']);
```

### Unexpected 4xx/5xx
`RESPONSE_ERROR` — read `error.response.status` and `error.response.data`.

### Requests hanging
- Add `timeout` or `timeouts`.
- Check whether the server requires TLS settings you disabled
  (`validateSSL: false` is a dev-only escape hatch).

### Cache returning stale-looking data
- Verify `cache.ttl` and whether `staleWhileRevalidate` is on.
- Listen to `cache:hit` / `cache:miss`.
- Opt out per request: `{ cache: { enabled: false } }`.

### Retries making things slow
- Lower `retries` or `retryDelay`, or narrow `retryOn`.

## Inspecting the live config

```js
console.log(api.getConfig());
console.log(swiftly.client().defaults);
```

## Network-level debugging

- `validateSSL: false` helps rule out TLS issues in development.
- `randomizeHeaders: true` avoids trivial bot detection when scraping.
- For deep network inspection, run under your favorite proxy and point Swiftly
  at it with the [proxy](../configuration/proxy.md) option, or use
  `NODE_DEBUG=http,https` env vars with the built-in transport.

## Next steps

- [Events](../reference/events.md)
- [Error types](../reference/error-types.md)
- [Performance](performance.md)