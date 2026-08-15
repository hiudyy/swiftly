# Timeouts

Swiftly offers two timeout systems. Both are **opt-in** by default — no
per-request timers are created unless you configure them (perf-first).

## timeout — socket-level

The simplest form. Applies a socket timeout to the request.

```js
const api = swiftly({ timeout: 5000 });
await api.get('/slow', { timeout: 10_000 }); // per-request override
```

When the timeout is hit the request fails with `TimeoutError` (code
`TIMEOUT_ERROR`).

## timeouts — connect / response / idle

Fine-grained timers configured with an object:

```js
const api = swiftly({
  timeouts: {
    connect: 2000,    // time to establish the connection
    response: 5000,   // time to receive the first response bytes
    idle: 10000,      // max idle time between data chunks
  },
});
```

When configured, defaults are `connect: 5000`, `response: 30000`,
`idle: 60000`. The request is destroyed with a `TimeoutError` whose `type` is
`'connect'`, `'response'` or `'idle'` respectively.

```js
try {
  await api.get(url, { timeouts: { connect: 1000 } });
} catch (error) {
  if (error.code === 'TIMEOUT_ERROR') {
    console.error('timed out at stage:', error.type); // 'connect'
  }
}
```

The idle timer is skipped in stream mode.

## Semantics

- `timeout` guards the whole request at the socket level.
- `timeouts` breaks the request into stages and can tell you *where* it stalled.
- Both can be combined; the first one to fire wins.

## Retry interaction

A timeout is a transport-level failure, so it is retried per your
[retries](retries.md) config by default. If you want a strict deadline across
all attempts, prefer a low `retries` value plus `timeout`:

```js
const api = swiftly({ timeout: 3000, retries: 2 });
```

## AbortSignal

You can also cancel from outside with an `AbortSignal`:

```js
const controller = new AbortController();
setTimeout(() => controller.abort(), 2000);

try {
  await api.get('/big', { signal: controller.signal });
} catch (error) {
  if (error.code === 'ABORT_ERROR') {
    console.error('aborted by signal');
  }
}
```

A pre-aborted signal throws `AbortError` immediately; aborting mid-request
destroys the request and emits the `abort` event. See [Events](../reference/events.md).

## Next steps

- [Retries](retries.md)
- [Error types](../reference/error-types.md)