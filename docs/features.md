# Features

## Retries

Transient failures (5xx and network errors) are retried automatically. 4xx
errors are never retried (except HTTP 429). The delay grows linearly:
`retryDelay * attempt`.

```js
const res = await swiftly.get(url, { retries: 3, retryDelay: 1000 });
```

## Caching

2xx GET responses are cached in memory by default. Repeated calls are instant.

```js
const a = await api.get('/profile');       // network
const b = await api.get('/profile');       // cache hit
```

Disable with `{ cache: { enabled: false } }`, or clear with `api.clearCache()`.

## Rate limiting

Off by default. Enable to throttle a domain:

```js
const api = swiftly({ rateLimiting: { enabled: true, requestsPerSecond: 5 } });
```

## Circuit breaker

Stops hammering an unhealthy domain. After `failureThreshold` failures the
circuit opens and requests are rejected until `resetTimeout` elapses.

```js
const api = swiftly({
    circuitBreaker: { enabled: true, failureThreshold: 5, resetTimeout: 60000 }
});
api.resetCircuitBreakers(); // manual reset
```

## Interceptors

Transform requests before they are sent and responses after they arrive.

```js
const api = swiftly();

api.interceptors.request.use((config) => {
    config.headers = { ...config.headers, 'X-Trace': crypto.randomUUID() };
    return config;
});

api.interceptors.response.use((res) => {
    // res = { data, headers, status, config }
    return res;
});
```

## Cookies & sessions

Cookies set by responses are stored in a jar and sent back automatically,
scoped per domain. Sessions are cleaned up automatically.

## Request deduplication

When multiple concurrent callers hit the exact same GET, Swiftly runs it once
and shares the result. Disable per request with `deduplicate: false`.

## Batch requests

Run many requests concurrently and collect all results:

```js
const [a, b, c] = await api.batch([
    { method: 'get', url: '/todos/1' },
    { method: 'get', url: '/todos/2' },
    { method: 'get', url: '/todos/3' }
]);
```

A failed item resolves as `{ error }` instead of rejecting the whole batch.

## Downloads

`download()` returns the body as a `Buffer`:

```js
const buf = await swiftly.download('https://example.com/archive.zip');
```

## GraphQL

```js
const data = await swiftly.query('https://api.example.com/graphql', {
    query: `{ user(id: 1) { name } }`,
    variables: {}
});
```

## Server-Sent Events (SSE)

```js
const stop = await swiftly.subscribe('https://api.example.com/events', {
    onOpen: () => console.log('connected'),
    onMessage: (data) => console.log(data),
    onError: (err) => console.error(err)
});
// later: stop();
```

## Web scraping

See [Scraping](./scraping.md) for the selector syntax and examples.

## Events

Emit lifecycle events with `on`/`off`:

```js
const api = swiftly();
api.on('request:start', ({ url, method }) => {});
api.on('request:end', ({ url, status, time }) => {});
api.on('cache:hit', ({ url }) => {});
api.on('retry:attempt', ({ attempt, nextRetryDelay }) => {});
api.on('request:error', (err) => {});
```

Event constants are exported: `swiftly.events.REQUEST_START`, etc.

## Metrics

```js
const m = api.getMetrics();
// { requestCount, cacheHits, cacheMisses, retries, successCount,
//   errorCount, averageResponseTime, totalDataTransferred, ... }
```