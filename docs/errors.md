# Errors

Every error thrown by Swiftly extends `SwiftlyError` and carries a stable
`code`, so you can branch on it reliably without string-matching messages.

## Error types

| Error | `code` | When | Useful fields |
| ----- | ------ | ---- | ------------- |
| `ValidationError` | `VALIDATION_ERROR` | bad arguments / invalid URL | – |
| `RequestError` | `REQUEST_ERROR` | network failure (DNS, ECONNREFUSED, socket) | `cause` |
| `ResponseError` | `RESPONSE_ERROR` | non-2xx HTTP status | `response` (`status`, `headers`, `body`) |
| `TimeoutError` | `TIMEOUT_ERROR` | connect/response/idle timeout exceeded | – |
| `CircuitBreakerError` | `CIRCUIT_BREAKER_ERROR` | circuit breaker is open | `domain` |

All errors expose `.message` and `.code`.

```js
import swiftly from 'swiftly';

try {
  await swiftly.get('https://api.example.com/users/1');
} catch (err) {
  switch (err.code) {
    case 'RESPONSE_ERROR':
      console.error('HTTP', err.response.status, err.response.body);
      break;
    case 'REQUEST_ERROR':
      console.error('network:', err.cause);
      break;
    case 'TIMEOUT_ERROR':
      console.error('timed out');
      break;
    case 'CIRCUIT_BREAKER_ERROR':
      console.error('breaker open for', err.domain);
      break;
  }
}
```

## `ResponseError`

Thrown for any non-2xx status. The full server response is on `err.response`,
so you can read status and body even on failure:

```js
try {
  await api.post('/users', payload);
} catch (err) {
  if (err.code === 'RESPONSE_ERROR') {
    if (err.response.status === 422) {
      console.log('validation:', err.response.body.errors);
    }
  }
}
```

## `RequestError`

Wraps low-level network problems. The original error (Node `Error`) is on
`err.cause` — useful for distinguishing `ECONNREFUSED`, `ENOTFOUND` (DNS), etc.

```js
if (err.code === 'REQUEST_ERROR' && err.cause?.code === 'ENOTFOUND') {
  console.error('DNS failure');
}
```

## Handling errors

### With `try/catch`

The simplest and most common approach (see above).

### With interceptors

A `rejected` handler in a response interceptor can recover from errors — for
example, refresh a token on 401 and retry:

```js
api.interceptors.response.use(
  null,
  async (error) => {
    if (error.code === 'RESPONSE_ERROR' && error.response.status === 401) {
      const token = await refreshToken();
      api.setDefaultHeaders({ Authorization: `Bearer ${token}` });
      // re-run the original request (you'd track its args in a real impl)
    }
    throw error;
  }
);
```

See [Recipes](recipes.md) for a complete token-refresh pattern.

### Per-request errors in `batch`

`batch` never rejects. Each result is either the parsed body or
`{ error }`:

```js
const results = await api.batch([/* ... */]);
const failed = results.filter((r) => r.error);
```

## Retry behavior

Retries are automatic and configurable.

- Total attempts = `retries` (default `3`); `retries: 1` = one try, no retry.
- **Network errors always retry** (regardless of `retryOn`).
- `retryOn` restricts which *HTTP* failures retry: an array of status codes, or
  a predicate `(error) => boolean`.
- Backoff is **linear** by default; set `retryBackoff` (≥ 1) for exponential
  growth, and `retryJitter: true` to randomize it (avoids thundering herds).
- A server `Retry-After` header is honored, capped by `maxRetryAfter`.
- `onRetry(attempt, error, delay)` fires before each retry.

```js
const api = swiftly({
  retries: 5,
  retryDelay: 500,
  retryBackoff: 2,
  retryJitter: true,
  retryOn: [429, 500, 502, 503, 504],
  maxRetryAfter: 30_000,
  onRetry: (attempt, err, delay) => console.log(`retry ${attempt} (${delay}ms)`),
});
```

### Retry timeline example

`retries: 4, retryDelay: 500, retryBackoff: 2`:

```
attempt 1  -> fails
wait 500ms
attempt 2  -> fails
wait 1000ms
attempt 3  -> fails
wait 2000ms
attempt 4  -> success (or throws after last)
```

## Circuit breaker lifecycle

When `circuitBreaker.enabled` is true, each domain has its own breaker:

1. **CLOSED** — requests flow normally. Failures increment a counter.
2. After `failureThreshold` failures (including 5xx responses), the breaker
   moves to **OPEN**.
3. While **OPEN**, requests fail *immediately* with `CircuitBreakerError` —
   no network call is made.
4. After `resetTimeout` ms, the breaker goes to **HALF-OPEN**: the next request
   is allowed through.
   - Success → back to **CLOSED**, counter reset.
   - Failure → back to **OPEN**.

Listen to the lifecycle:

```js
api.on('circuit:open',       ({ domain }) => console.warn(`breaker OPEN: ${domain}`));
api.on('circuit:half-open',  ({ domain }) => console.info(`testing: ${domain}`));
api.on('circuit:close',      ({ domain }) => console.info(`recovered: ${domain}`));
```

Inspect/reset state:

```js
const { circuitBreakers } = api.getMetrics();
console.log(circuitBreakers); // [{ domain, state: { state, failureCount, ... } }]

api.resetCircuitBreakers();        // reset all domains
api.resetCircuitBreakers('api.example.com'); // reset one
```

Use circuit breakers in front of flaky downstream dependencies so a partial
outage doesn't cascade.
