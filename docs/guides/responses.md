# Responses

Every request resolves with the **parsed response body** — there is no `{ data }`
wrapper to unwrap. The body's shape follows the response `Content-Type`.

## Automatic type detection

| Content-Type | Result |
|--------------|--------|
| `application/json` | Parsed JSON object / array |
| `text/html` | HTML string (validated) |
| `text/*` (other) | String |
| anything else | `Buffer` |

```js
const json   = await api.get('/user');          // application/json -> object
const page   = await api.get('/page');          // text/html -> string
const binary = await api.get('/file.bin');      // -> Buffer
```

## Forcing a type with responseType

`responseType` overrides content-type detection. Valid values:
`'json' | 'text' | 'html' | 'buffer' | 'raw'`.

```js
const text   = await api.get('/page', { responseType: 'text' });    // string, no HTML validation
const buffer = await api.get('/img.png', { responseType: 'buffer' }); // Buffer
const parsed = await api.get('/data', { responseType: 'json' });      // force JSON parse
```

Behavior of each transformer:

- **`json`** — UTF-8 string, strips BOM, `JSON.parse`. Throws `Invalid JSON
  response` on malformed body and `Empty response body` on empty input.
- **`text`** — UTF-8 string.
- **`html`** — UTF-8 string; throws `Invalid HTML response` unless the body
  contains `<!DOCTYPE html>` or `<html`.
- **`buffer`** — the raw `Buffer`, no transform.
- **`raw`** — auto-detects the body type but wraps the result (below).

An invalid `responseType` falls back to `buffer`.

## The raw envelope

`responseType: 'raw'` gives you status, headers, duration and the
auto-detected body together:

```js
const { data, status, headers, config, duration } =
  await api.get('/user', { responseType: 'raw' });

console.log(status);                       // e.g. 200
console.log(headers['content-type']);
console.log(duration);                     // request time in ms
console.log(data);                         // parsed body (auto-detected)
```

`config` is the internal request options object (it embeds `.config`, the
merged client/request config).

## Streaming the body

Set `stream: true` to receive the body as a (decompressed) `Readable` instead
of buffering it. The stream has `.headers`, `.status` and `.total` attached.

```js
const { data } = await api.get('/file', { stream: true });

for await (const chunk of data) {
  process.stdout.write(chunk);
}
```

Stream mode has specific behavior:

- Retries are disabled (forced to 1 attempt).
- Redirect-into-retry semantics are skipped.
- The response is **not cached** and requests are **not deduplicated**.
- Content decoding (gzip/deflate/br) still applies via `compression.response`.
- A stream `error` event rejects the request with `RequestError`.

See [Streaming and downloads](streaming-and-downloads.md).

## HTTP error responses

A response with status **>= 400** throws a `ResponseError` *before* any
transformation:

```js
try {
  await api.get('/missing');
} catch (error) {
  if (error.code === 'RESPONSE_ERROR') {
    console.error(error.response.status); // 404
    console.error(error.response.data);   // raw body
  }
}
```

See [Error types](../reference/error-types.md).

## Response schema validation

Validate the parsed JSON body against a type map before using it:

```js
const user = await api.get('/user', {
  responseSchema: { id: 'number', name: 'string' },
});
```

See [Response schema validation](../reference/response-schema.md).

## Caching interaction

The **final transformed result** is what gets cached (GET, 200, non-stream),
so cache hits return the same shape as a live request. See
[Caching](../configuration/caching.md).

## Next steps

- [Query params and headers](query-params-and-headers.md)
- [Streaming and downloads](streaming-and-downloads.md)