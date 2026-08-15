# Undici transport

Swiftly can use the `undici` HTTP client instead of Node's built-in
`http`/`https`. This is **opt-in** and keeps the package zero-dependency —
`undici` is lazy-loaded only when you ask for it.

## Install

```bash
npm install undici
```

## Enable

```js
const api = swiftly({ transport: 'undici' });
```

If `undici` is not installed, making a request throws a `ValidationError`.

## Per-request

```js
await api.get('https://api.example.com', { transport: 'undici' });
```

## How it interacts with other features

- **HTTP/2 wins**: if `useHttp2` applies (https, non-stream), it takes
  precedence over the `undici` transport.
- **Stream mode** forces the built-in transport (undici is skipped when
  `stream: true`).
- `timeout` is passed to undici as `bodyTimeout`.
- Interceptors, retries, caching and events all still work the same.

## Why use undici?

- Sometimes faster connection handling and header parsing for high-throughput
  workloads.
- A different implementation to run against when you want to compare.

## Benchmarks

The repo includes a benchmark harness comparing Swiftly's built-in transport
against undici and other HTTP clients. See
[Performance](performance.md).

## Next steps

- [HTTP/2 and transport](../configuration/http2-and-transport.md)
- [Performance](performance.md)