# Errors

Every error thrown by Swiftly extends `SwiftlyError` and carries a stable
`code`, so you can branch on it reliably.

## Error types

| Error | `code` | When | Useful fields |
| ----- | ------ | ---- | ------------- |
| `ValidationError` | `VALIDATION_ERROR` | bad arguments / invalid URL | – |
| `RequestError` | `REQUEST_ERROR` | network failure (DNS, ECONNREFUSED, socket) | `cause` |
| `ResponseError` | `RESPONSE_ERROR` | non-2xx HTTP status | `response` (status, headers, body) |
| `TimeoutError` | `TIMEOUT_ERROR` | connect/response/idle timeout exceeded | – |
| `CircuitBreakerError` | `CIRCUIT_BREAKER_ERROR` | circuit breaker is open | `domain` |

All errors expose `message` and `code`.

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

## Handling errors

- **`ResponseError`** gives you the full server response, so you can read the
  status and body even on failure.
- **`RequestError`** wraps low-level network issues; the original error is on
  `err.cause`.
- Interceptors can also recover from errors via a `rejected` handler:

```js
api.interceptors.response.use(
  null,
  (error) => {
    if (error.code === 'RESPONSE_ERROR' && error.response.status === 401) {
      // e.g. refresh a token and retry
    }
    throw error;
  }
);
```

## Retry behavior

Retries are automatic and configurable (`retries`, `retryDelay`,
`retryBackoff`, `retryJitter`, `retryOn`, `maxRetryAfter`).

- By default a request is attempted `retries` times (default `3`).
- Backoff is linear unless `retryBackoff` (>= 1) is set for exponential growth;
  `retryJitter` adds randomness to avoid thundering herds.
- `retryOn` restricts which failures retry — an array of status codes or a
  predicate `(error) => boolean`. Network errors always retry.
- A server `Retry-After` header is honored, capped by `maxRetryAfter`.
- `onRetry(attempt, error, delay)` fires before each retry.

```js
const api = swiftly({
  retries: 5,
  retryBackoff: 2,
  retryJitter: true,
  retryOn: [429, 500, 502, 503, 504],
});
```
