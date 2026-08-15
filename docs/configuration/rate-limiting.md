# Rate limiting

Rate limiting throttles requests **per hostname** to protect both the target
server and your own resources. Disabled by default.

## Configuration

```js
const api = swiftly({
  rateLimiting: {
    enabled: true,
    requestsPerSecond: 20,  // max requests per second per domain
    minDelay: 1000,         // floor delay between throttled requests (ms)
    maxDelay: 64000,        // cap on adaptive backoff (ms)
  },
});
```

## How it works

- A sliding 1-second window tracks timestamps per domain.
- When the window is full, the request **waits** an adaptive delay:
  - Starts at `minDelay`.
  - Doubles on each throttled request, capped at `maxDelay`.
  - Halves again toward `minDelay` once traffic settles.
- Timestamps older than 1 second are shifted off the window automatically.

## Events

When a request is delayed by the limiter, the `rate:limit` event fires:

```js
api.on('rate:limit', ({ url }) => console.warn('throttled:', url));
```

## Per-request overrides

Nested config merges, so you can relax a rule for one call:

```js
await api.get('/expensive', {
  rateLimiting: { requestsPerSecond: 2 },
});
```

## Compare: circuit breaker vs rate limiting

| | Circuit breaker | Rate limiting |
|--|----------------|---------------|
| Purpose | Stop after repeated failures | Stay under a safe request rate |
| Reaction | Reject immediately (OPEN) | Delay requests |
| Granularity | Per domain | Per domain |

## Next steps

- [Circuit breaker](circuit-breaker.md)
- [Retries](retries.md)
- [Events](../reference/events.md)