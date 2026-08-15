# Errors

Swiftly throws typed errors. All of them extend `SwiftlyError`, which extends
the built-in `Error` and carries a stable `code` you can switch on.

## Error types

| Error | `code` | When it's thrown |
| ----- | ------ | ---------------- |
| `SwiftlyError` | (base) | Base class for all Swiftly errors |
| `ValidationError` | `VALIDATION_ERROR` | Invalid method, URL, data, headers or config |
| `RequestError` | `REQUEST_ERROR` | Network failures (ECONNREFUSED, ENOTFOUND, ECONNRESET, DNS…) |
| `ResponseError` | `RESPONSE_ERROR` | A non-2xx HTTP status; has `.response` |
| `TimeoutError` | `TIMEOUT_ERROR` | Connect / response / idle timeout |
| `CircuitBreakerError` | `CIRCUIT_BREAKER_ERROR` | Circuit breaker is open |

## Handling errors

```js
import swiftly, {
    SwiftlyError,
    RequestError,
    ResponseError,
    TimeoutError
} from 'swiftly';

try {
    await swiftly.get('https://example.com');
} catch (err) {
    if (err instanceof TimeoutError) {
        console.error('Timed out:', err.type); // 'connect' | 'response' | 'idle'
    } else if (err instanceof ResponseError) {
        console.error('HTTP', err.response.status, err.response.data);
    } else if (err instanceof RequestError) {
        console.error('Network error:', err.message);
    } else if (err instanceof SwiftlyError) {
        console.error('Swiftly error:', err.code);
    }
}
```

Or switch on the code:

```js
catch (err) {
    switch (err.code) {
        case 'RESPONSE_ERROR': /* ... */ break;
        case 'TIMEOUT_ERROR':  /* ... */ break;
        case 'VALIDATION_ERROR': /* ... */ break;
    }
}
```

## Retry behavior

- **5xx** responses and **network errors** are retried up to `retries` times.
- **4xx** responses are **never** retried (except HTTP 429).
- **Exceeding `maxRedirects`** throws immediately (never retried).

> Note: `ResponseError`/`TimeoutError` (typed Swiftly errors) are never wrapped
> into a generic `RequestError`, so you can always rely on their type.