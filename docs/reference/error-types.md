# Error types

All errors thrown by Swiftly extend the base `SwiftlyError` class and carry a
stable `code`. **Branch on `code`, never on message strings.**

## Class hierarchy

```
SwiftlyError (base)
├── ValidationError        code: 'VALIDATION_ERROR'
├── RequestError           code: 'REQUEST_ERROR'
├── ResponseError          code: 'RESPONSE_ERROR'
├── CircuitBreakerError    code: 'CIRCUIT_BREAKER_ERROR'
├── TimeoutError           code: 'TIMEOUT_ERROR'
└── AbortError             code: 'ABORT_ERROR'
```

## SwiftlyError (base)

```js
class SwiftlyError extends Error {
  code: string
  context: object
}
```

Every Swiftly error has `name`, `message`, `code` and `context`.

## Handling by code

```js
try {
  await swiftly.get(url);
} catch (error) {
  switch (error.code) {
    case 'RESPONSE_ERROR':
      console.error('HTTP', error.response.status, error.response.data);
      break;
    case 'REQUEST_ERROR':
      console.error('network failure:', error.cause ?? error.original);
      break;
    case 'TIMEOUT_ERROR':
      console.error('timed out at stage:', error.type);
      break;
    case 'CIRCUIT_BREAKER_ERROR':
      console.error('breaker open for:', error.domain);
      break;
    case 'ABORT_ERROR':
      console.error('aborted by signal');
      break;
    case 'VALIDATION_ERROR':
      console.error('invalid arguments:', error.message);
      break;
    default:
      throw error; // unknown — rethrow
  }
}
```

## The error classes in detail

### ValidationError (`VALIDATION_ERROR`)

Thrown for invalid arguments before a request is made:

- Bad method / URL / data / headers.
- `formData` enabled but no data.
- `batch` with a non-array.
- `transport: 'undici'` when `undici` is not installed.

### RequestError (`REQUEST_ERROR`)

Thrown for transport/network failures:

- DNS resolution failure, connection refused, socket errors.
- Stream errors (`'Stream error'`).
- Carries the original error under `original` (plus `options` and `protocol`
  in the context).

### ResponseError (`RESPONSE_ERROR`)

Thrown when the response status is **>= 400**. Exposes the response:

```js
{
  code: 'RESPONSE_ERROR',
  response: {
    status,          // e.g. 404
    headers,         // response headers
    data,            // raw response body
    ...             // other response fields
  }
}
```

Also thrown by `downloadTo` when the stream status is >= 400.

### CircuitBreakerError (`CIRCUIT_BREAKER_ERROR`)

Thrown when a request is refused because the circuit breaker is OPEN.
Exposes `domain`.

### TimeoutError (`TIMEOUT_ERROR`)

Thrown when a timeout fires. Exposes `type`: `'connect'`, `'response'` or
`'idle'` (from `timeouts`) — or set for socket `timeout` failures.

### AbortError (`ABORT_ERROR`)

Thrown when the request is cancelled via an `AbortSignal` (or aborted). The
default message is `'Request aborted'`.

## MAX_REDIRECTS — a plain Error with a code

When the redirect chain exceeds `maxRedirects`, a **plain `Error`** (not a
`SwiftlyError`) is thrown with `code: 'MAX_REDIRECTS'` and
`_noRetry: true` (it is never retried):

```js
try {
  await api.get(url, { followRedirects: true, maxRedirects: 3 });
} catch (error) {
  if (error.code === 'MAX_REDIRECTS') {
    console.error('too many redirects');
  }
}
```

## GraphQL errors

`query()` throws a plain `Error` (not a SwiftlyError) when the GraphQL server
returns `errors`. It carries the full errors array:

```js
try {
  await api.query(url, { query: '{ nope }' });
} catch (error) {
  console.error(error.message);       // first error message
  console.error(error.graphqlErrors); // full array
}
```

## HTTP/status validation vs response validation

- `responseSchema` validation failures throw a plain `Error` with a
  `Schema validation failed: ...` message (and the transformer attaches
  `.response` / `.type`). These are not `ValidationError`s.
- A JSON parse failure throws `Invalid JSON response: <msg>`.

## request:error event

The `request:error` event receives the final error object (after all retries).
See [Events](events.md).

## Best practices

1. Switch on `error.code`, never message text.
2. For `RESPONSE_ERROR`, inspect `error.response.status` + `error.response.data`.
3. For `REQUEST_ERROR`, inspect the underlying `error.original`/`error.cause`.
4. Rethrow unknown errors so unexpected failures surface.

## Next steps

- [Client methods](client-methods.md)
- [Retries](../configuration/retries.md)