# Events

Swiftly emits events for lifecycle and diagnostic information. Listen on any
client, or on the shared default client for global visibility.

```js
const api = swiftly();

api.on('request:end', ({ method, url, status, time }) => {
  console.log(`${method} ${url} ${status} ${time}ms`);
});
```

## Registering & removing

```js
const onEnd = ({ status }) => console.log(status);
api.on('request:end', onEnd);

api.off('request:end', onEnd);        // remove one listener
api.off('request:end');               // remove all listeners for the event
```

`on()`/`off()` return the internal event emitter, so you can chain emitter
calls if you need `once` etc.

## Event reference

Payloads are produced **lazily** — the payload factory only runs when at least
one listener exists, so the hot path is unaffected when nobody is listening.

### Request lifecycle

| Event | Payload | When |
|-------|---------|------|
| `request:start` | `{ method, url, config }` | Before a request is executed. `url` is the formatted URL. |
| `request:end` | `{ method, url, status, time, size }` | After a request completes. `time` in ms; `size` = body bytes; `url` is the original URL. |
| `request:error` | the error object | Hard errors, non-retryable errors, and final retry failure. |
| `retry:attempt` | `{ attempt, error, nextRetryDelay }` | Before each retry. |
| `redirect` | `{ from, to }` | On each redirect. `from` = current URL, `to` = `Location` value. |
| `abort` | `{ url }` | When an `AbortSignal` fires mid-request. |

### Caching

| Event | Payload | When |
|-------|---------|------|
| `cache:hit` | `{ url }` (or `{ url, stale }` with SWR) | Cache served the response. |
| `cache:miss` | `{ url }` | Cache did not contain the key. |
| `cache:store` | `{ url }` | A 200 GET response was written to the cache. |

> `cache:invalid` and `socket:assigned` exist as constants but are **not
> emitted** by the implementation.

### Resilience

| Event | Payload | When |
|-------|---------|------|
| `rate:limit` | `{ url, error }` | A request was delayed by the rate limiter. |
| `circuit:open` | `{ domain, failureCount, resetTimeout }` | Breaker opened for a domain. |
| `circuit:half-open` | `{ domain }` | Breaker moved OPEN → HALF-OPEN (probing). |
| `circuit:close` | `{ domain }` | Breaker recovered (successful probe). |
| `circuit:rejected` | `{ domain, state: 'OPEN' }` | A request was refused while OPEN. |

### Progress

| Event | Payload | When |
|-------|---------|------|
| `progress` | `{ loaded, total, percent }` | Per response chunk (only when listeners exist). |
| `download:progress` | `{ loaded, total, percent }` | Same as `progress`. |
| `upload:progress` | `{ loaded, total, percent }` | Upload progress (per chunk for streams; single 100% for buffered payloads). |

### Sessions & proxy

| Event | Payload | When |
|-------|---------|------|
| `sessions:cleanup` | `{ cleaned }` | Background session cleanup removed expired sessions. |
| `proxy:connect` | `{ host, proxyHost }` | After a successful HTTPS CONNECT tunnel. |

### Errors in handlers

If a listener throws, the emitter logs the error and re-emits it as an
`error` event: `emit('error', error, eventName)`.

## The `events` constants

Import the constant map for safe event names:

```js
import swiftly, { events } from 'swiftly';

api.on(events.REQUEST_END, handler);
```

| Constant | Value |
|----------|-------|
| `REQUEST_START` | `'request:start'` |
| `REQUEST_END` | `'request:end'` |
| `REQUEST_ERROR` | `'request:error'` |
| `RETRY_ATTEMPT` | `'retry:attempt'` |
| `CACHE_HIT` | `'cache:hit'` |
| `CACHE_MISS` | `'cache:miss'` |
| `CACHE_STORE` | `'cache:store'` |
| `CACHE_INVALID` | `'cache:invalid'` |
| `RATE_LIMIT` | `'rate:limit'` |
| `REDIRECT` | `'redirect'` |
| `PROGRESS` | `'progress'` |
| `DOWNLOAD_PROGRESS` | `'download:progress'` |
| `UPLOAD_PROGRESS` | `'upload:progress'` |
| `SOCKET_ASSIGNED` | `'socket:assigned'` |
| `ABORT` | `'abort'` |
| `PROXY_CONNECT` | `'proxy:connect'` |
| `CIRCUIT_OPEN` | `'circuit:open'` |
| `CIRCUIT_CLOSE` | `'circuit:close'` |
| `CIRCUIT_HALF_OPEN` | `'circuit:half-open'` |
| `CIRCUIT_REJECTED` | `'circuit:rejected'` |

## Example: request logger

```js
import swiftly, { events } from 'swiftly';

const api = swiftly();
api.on(events.REQUEST_START, ({ method, url }) => console.log('→', method, url));
api.on(events.REQUEST_END,   ({ method, url, status, time }) => console.log('←', status, `${time}ms`, url));
api.on(events.REQUEST_ERROR, (error) => console.error('!', error.code));
```

## Next steps

- [Metrics](metrics.md)
- [Error types](error-types.md)