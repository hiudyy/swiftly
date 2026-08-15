# Retries

Swiftly retries failed requests automatically. **`retries` is the total number
of attempts** (not the number of retries after the first): the default `3`
means the request runs up to 3 times.

## Basic setup

```js
const api = swiftly({
  retries: 4,
  retryDelay: 500,      // base delay (ms)
  retryBackoff: 2,      // exponential factor
  retryJitter: true,    // randomize the delay
});
```

## What is retried

- **Transport errors** (network failures, DNS, socket errors) — always
  retryable.
- **HTTP 5xx** and **429** — retried by default.
- **4xx except 429** — NOT retried by default.
- **Hard errors** (max redirects, abort, stream errors) — never retried.

### Customize with retryOn

`number[]` of status codes:

```js
const api = swiftly({ retryOn: [429, 500, 502, 503, 504] });
```

Or a predicate receiving the **error**:

```js
const api = swiftly({
  retryOn: (error) =>
    error.code === 'RESPONSE_ERROR' &&
    [500, 502, 503, 504, 429].includes(error.response.status),
});
```

## Backoff

The delay between attempts is:

- **Linear (default)** when `retryBackoff` is `null`:
  `retryDelay * attempt`
- **Exponential** when `retryBackoff` is a number:
  `retryDelay * retryBackoff^(attempt-1)`

```js
const api = swiftly({ retryDelay: 1000, retryBackoff: 2 });
// attempt 1 -> 1000ms, attempt 2 -> 2000ms, attempt 3 -> 4000ms, ...
```

### Jitter

```js
retryJitter: true    // randomize fully
retryJitter: 500     // add up to 500ms of randomness
```

Jitter avoids "thundering herd" retry storms against a struggling service.

## Retry-After

If a response includes a `Retry-After` header, Swiftly honors it — capped at
`maxRetryAfter` (default 60000ms):

```js
const api = swiftly({ maxRetryAfter: 30_000 });
```

## Observing retries

```js
const api = swiftly({
  onRetry: (attempt, error, delay) =>
    console.log(`attempt ${attempt} failed, retrying in ${delay}ms:`, error.message),
});

// or via the event emitter
api.on('retry:attempt', ({ attempt, error, nextRetryDelay }) =>
  console.log(`retry ${attempt} in ${nextRetryDelay}ms`));
```

## Per-request

```js
await api.get('/slow-endpoint', { retries: 6, retryBackoff: 2 });
await api.get('/immediate', { retries: 1 }); // no retries
```

## Interplay with other features

- **Streaming** — `stream: true` forces `retries: 1`.
- **Circuit breaker** — failures counted by the breaker still respect retry
  semantics (a success after retries closes the breaker state for that domain).
- **`request:error` event** — emitted on final failure (after all attempts).

## Next steps

- [Timeouts](timeouts.md)
- [Circuit breaker](circuit-breaker.md)
- [Rate limiting](rate-limiting.md)