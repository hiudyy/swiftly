# Compression

Swiftly handles compression on both sides of the wire — gzipping outgoing
request bodies and decompressing incoming responses.

## Response decompression

By default responses encoded with `gzip`, `deflate` or `br`
(brotli) are decompressed automatically:

```js
const api = swiftly(); // compression.response: true by default
const json = await api.get('https://api.example.com/big');
// json is already decompressed and parsed
```

| Option | Default | Description |
|--------|---------|-------------|
| `compression.response` | `true` | Decompress encoded responses. |
| `compression.responseMinSize` | `0` | Only decompress bodies with content-length >= this. |
| `decompress` | `true` | Master switch; `false` skips all response decompression. |

Get the raw compressed stream:

```js
const { data } = await api.get('/file.gz', { stream: true, decompress: false });
```

## Request compression

JSON request bodies of sufficient size are **gzip-compressed** automatically:

| Option | Default | Description |
|--------|---------|-------------|
| `compression.request` | `true` | Gzip JSON payloads. |
| `compression.minSize` | `1024` | Minimum JSON string length before compressing. |

```js
const api = swiftly({
  compression: { request: true, minSize: 2048 },
});

await api.post('/big', bigPayload); // payload >= 2048 chars -> gzip
```

Requests are compressed with gzip level 6, memLevel 8.

## Per-request

```js
await api.get('/raw', { decompress: false });
await api.post('/big', payload, { compression: { request: false } });
```

## Accept-Encoding

The default headers advertise `Accept-Encoding: gzip, deflate, br`, so servers
know they can compress responses.

## Next steps

- [Connection pooling](connection-pooling.md)
- [Streaming and downloads](../guides/streaming-and-downloads.md)