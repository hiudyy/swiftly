# Performance

Swiftly is designed to be fast out of the box while staying zero-dependency.
This page covers how to get the most out of it and how to measure it.

## Perf-first defaults

- **No default timeouts** — no per-request timers unless you configure them.
- **No rate limiting** — `rateLimiting.enabled: false` by default.
- **Keep-alive pooling** — sockets are reused per origin.
- **Caching on** — repeated GETs short-circuit before URL parsing and request
  setup.
- **Lazy progress** — progress objects are only built when a listener exists.
- **Sync transformers** — the default JSON/text/html transformers run without
  an extra microtask.
- **Fast-path cache keys** — the cache lookup happens before URL parsing,
  dedup bookkeeping and event emission.

## Tuning

### Connection pooling

```js
const api = swiftly({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 256,
});
```

See [Connection pooling](../configuration/connection-pooling.md).

### Caching

```js
const api = swiftly({ cache: { enabled: true, ttl: 300_000, maxSize: 1000 } });
```

Cache hits skip nearly the whole pipeline. See [Caching](../configuration/caching.md).

### Deduplication

Concurrent GETs to the same URL share one request by default. See
[Batch and deduplication](../guides/batch-and-deduplication.md).

### Consider HTTP/2 or undici

```js
const api = swiftly({ useHttp2: true });        // multiplexed https
const api2 = swiftly({ transport: 'undici' });  // if you install undici
```

See [HTTP/2 and transport](../configuration/http2-and-transport.md).

## Measuring

### Metrics

```js
const m = api.getMetrics();
console.log(m.averageResponseTime, m.requestCount, m.cacheHits, m.totalDataTransferred);
```

See [Metrics](../reference/metrics.md).

### Benchmark harness

The repository ships an isolated benchmark lab at `benchmarks/bench.js`
that compares Swiftly against other HTTP clients (got, ky, axios, undici, …)
across configurations.

```bash
npm run bench        # default deep run (up to 100k requests)
npm run bench:deep   # the biggest: 1,000,000 requests + concurrency sweep
npm run bench:quick  # fast in-process smoke run
```

The deep bench is also wired into CI — it runs on every push via the
GitHub Actions workflow (`.github/workflows/bench.yml`), so performance
regressions surface immediately after each commit.

Bench behavior is controlled by environment variables (load tiers, request
counts, concurrency, rounds, warmup, latency, scenarios, host, GC, etc.).
See the top of `benchmarks/bench.js` for the full list.

## What to watch

- **Cache hit ratio** — high is good.
- **Average response time** across a steady workload.
- **Pooled connections** — stable, not growing unboundedly (`maxSockets`).
- **GC pressure** — streaming large bodies avoids big buffer concats
  (preallocation is used when the length is known and the body isn't
  decompressed).

## Next steps

- [Metrics](../reference/metrics.md)
- [Undici transport](undici.md)