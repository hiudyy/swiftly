# Server-Sent Events

`subscribe()` opens an SSE stream (`text/event-stream`) and resolves with an
**unsubscribe function** once the connection is established.

## Basic usage

```js
const unsubscribe = await api.subscribe('https://api.example.com/stream', {
  onOpen: () => console.log('connected'),
  onMessage: (msg) => {
    if (msg.data) console.log(msg.data);   // data lines are JSON-parsed when possible
  },
  onError: (error) => console.error(error),
});

// later:
unsubscribe(); // destroys the underlying request
```

## Callbacks

| Callback | Called when |
|----------|-------------|
| `onMessage(msg)` | Each SSE event; `msg.data` holds the payload. `data:` lines are `JSON.parse`d when possible (raw string otherwise). |
| `onError(error)` | A stream or request error. |
| `onOpen()` | The stream is established (first response event). |

## How it works

- Sends `Accept: text/event-stream`, `Cache-Control: no-cache`,
  `Connection: keep-alive`.
- A non-200 status calls `onError` and rejects the promise.
- The returned `unsubscribe()` destroys the underlying request.

## Notes

- SSE is long-lived — the connection stays open until you unsubscribe or the
  server closes it.
- Add per-request config as the third argument (`subscribe(url, callbacks, config)`).
- Retries/backoff do not apply to an open stream (only to establishing it).

## Example: live ticker

```js
const stop = await api.subscribe('https://api.example.com/trades', {
  onOpen: () => console.log('listening to trades'),
  onMessage: (msg) => {
    const trade = JSON.parse(msg.data);
    renderTrade(trade);
  },
});

setTimeout(stop, 60_000); // listen for 1 minute
```

## Next steps

- [Streaming and downloads](streaming-and-downloads.md)
- [Batch and deduplication](batch-and-deduplication.md)