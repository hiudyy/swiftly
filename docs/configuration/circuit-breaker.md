# Circuit breaker

The circuit breaker stops a client from hammering a failing service. It is
**disabled by default** — enable it explicitly.

## Configuration

```js
const api = swiftly({
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,   // consecutive failures before the breaker opens
    resetTimeout: 60000,   // ms before OPEN -> HALF-OPEN (a single probe)
  },
});
```

## States

| State | Meaning |
|-------|---------|
| `CLOSED` | Normal operation; requests flow through. |
| `OPEN` | After `failureThreshold` consecutive failures. Requests are **rejected immediately** with `CircuitBreakerError` — no network call. |
| `HALF-OPEN` | After `resetTimeout`, a **single probe request** is allowed. Success → back to CLOSED. Failure → back to OPEN. While the probe is in flight, other requests are rejected immediately (fail fast) so a burst can't all hit a still-recovering service. |

Each **hostname/domain** gets its own breaker.

## What counts as a failure

- Transport/network errors.
- HTTP responses with status **>= 500**.

## Example

```js
const api = swiftly({
  circuitBreaker: { enabled: true, failureThreshold: 3, resetTimeout: 10_000 },
});

try {
  await api.get('https://flaky.example.com/data');
} catch (error) {
  if (error.code === 'CIRCUIT_BREAKER_ERROR') {
    console.error('breaker open for domain:', error.domain);
  }
}
```

## Events

```js
api.on('circuit:open',     ({ domain, failureCount }) => console.warn('OPEN', domain));
api.on('circuit:half-open',({ domain }) => console.log('probing', domain));
api.on('circuit:close',    ({ domain }) => console.log('recovered', domain));
api.on('circuit:rejected', ({ domain }) => console.warn('rejected', domain));
```

See [Events](../reference/events.md).

## Resetting

```js
api.resetCircuitBreakers();                  // all domains
api.resetCircuitBreakers('api.example.com'); // one domain
```

## Next steps

- [Retries](retries.md)
- [Rate limiting](rate-limiting.md)
- [Error types](../reference/error-types.md)