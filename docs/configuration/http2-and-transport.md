# HTTP/2 and transport

Swiftly uses Node's built-in `http`/`https` by default. Two optional
transports are available.

## transport option

| Value | Meaning |
|-------|---------|
| `'http'` (default) | Node's built-in `http`/`https` with keep-alive pooling. Zero dependencies. |
| `'undici'` | The `undici` HTTP client. **Requires you to install `undici`** — Swiftly stays zero-dependency and lazy-loads it. |

```js
const api = swiftly({ transport: 'undici' });
```

If `undici` is not installed, a `ValidationError` is thrown when a request is
made with `transport: 'undici'`.

## useHttp2

Enable HTTP/2 (via Node's `http2`) for HTTPS requests:

```js
const api = swiftly({ useHttp2: true });
```

HTTP/2 applies only when:

- `useHttp2: true`, AND
- the URL protocol is `https:`, AND
- not in stream mode.

When HTTP/2 applies it **wins** over the `transport` selection. Requests made
over HTTP/2 increment `metrics.http2Requests`.

HTTP/2 sessions are pooled per authority and cleaned up by the session
lifecycle (`session.ttl`, `session.autoCleanup`). `api.close()` closes them.

## Transport precedence

1. HTTP/2 (if `useHttp2` + https + not stream)
2. `undici` (if `transport: 'undici'` and the above doesn't apply)
3. Node built-in `http`/`https`

## Per-request

```js
await api.get('https://api.example.com', { transport: 'undici' });
await api.get('https://api.example.com', { useHttp2: true });
```

## Notes

- HTTP/2 is only meaningful over HTTPS (HTTP/2 without TLS is not supported by
  Node in this path).
- Stream mode forces the built-in transport.
- The TypeScript type `TransportType` includes `'http2'`, but the runtime
  selects HTTP/2 via `useHttp2`, not via `transport`.

## Next steps

- [Undici in depth](../advanced/undici.md)
- [Connection pooling](connection-pooling.md)