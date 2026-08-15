# Streaming and downloads

Swiftly can stream responses, download to a `Buffer`, or stream directly to a
file — with progress callbacks.

## Streaming a response

Set `stream: true` to receive the body as a (decompressed) `Readable`:

```js
const { data } = await api.get('/file', { stream: true });

for await (const chunk of data) {
  process.stdout.write(chunk);
}
```

The resolved value is `{ data, headers, status, config }` and the stream also
carries `.headers`, `.status` and `.total` (byte length, or 0 if unknown).

Stream mode specifics:

- **Retries are disabled** (forced to 1 attempt).
- No caching, no request deduplication.
- gzip/deflate/br decompression still applies (set `decompress: false` or
  `compression.response: false` to get the raw compressed stream).
- A stream error rejects with `RequestError('Stream error')`.

```js
// Read compressed data without auto-decompression
const { data } = await api.get('/file.gz', { stream: true, decompress: false });
```

## download() — Buffer in one call

```js
const buf = await api.download('https://example.com/file.zip');
// buf is a Buffer
```

`download(url, config)` is a shortcut for
`get(url, { ...config, responseType: 'buffer' })`.

## downloadTo() — stream to a file

```js
const { path, bytes } = await api.downloadTo(
  'https://example.com/file.zip',
  '/tmp/file.zip',
  { onProgress: ({ loaded, total, percent }) => console.log(percent) },
);
```

`downloadTo(url, filePath, config)`:

- Streams the response (`stream: true`) to `filePath`.
- If the status is **>= 400**, it **rejects with `ResponseError`** without
  writing the file (or cleaning a partial one).
- `config.onProgress` receives `{ loaded, total, percent }`.
- Resolves with `{ path, bytes }`.

> Note: `downloadTo` is exposed on the raw HTTPClient (via `swiftly.client()`),
> but **not** on the `swiftly(...)` wrapper. The wrapper exposes `download`.

## Progress events

Progress callbacks work on buffered requests too:

```js
const api = swiftly({
  onDownloadProgress: ({ loaded, total, percent }) =>
    console.log(`↓ ${percent.toFixed(1)}%`),
  onUploadProgress: ({ loaded, total, percent }) =>
    console.log(`↑ ${percent.toFixed(1)}%`),
});
```

Or listen to the `download:progress` / `upload:progress` events (see
[Events](../reference/events.md)). Progress objects are only built when
someone is listening, so the hot path stays fast.

## Uploading a stream

Pass a `Readable` as the body:

```js
import { createReadStream } from 'node:fs';

await api.post('/upload', createReadStream('/tmp/big.bin'), {
  onUploadProgress: ({ loaded }) => console.log(loaded, 'bytes'),
});
```

For buffered payloads, a single upload-progress event is emitted at 100%.
For streamed bodies, events fire per chunk (`total: 0`).

## Multipart form data

Send `multipart/form-data` with `formData: true`:

```js
await api.post('/upload', {
  name: 'Ada',
  resume: {
    name: 'resume.pdf',             // optional filename (default 'file')
    type: 'application/pdf',        // optional Content-Type
    buffer: pdfBuffer,              // Buffer or ArrayBuffer-backed value
  },
}, { formData: true });
```

Behavior:

- A boundary (`----WebKitFormBoundary...`) is generated automatically.
- **Buffers** (or objects with an `ArrayBuffer` `buffer`) become file parts —
  `value.name` → filename, `value.type` → part Content-Type.
- Everything else becomes a string form field.
- Keys must be non-empty strings; `data` must be an object (`ValidationError`
  otherwise).
- `post(url, null, { formData: true })` throws a `ValidationError`.

## Compression and streaming

Request compression: JSON payloads of length >= `compression.minSize`
(1024 bytes default) are gzip-compressed automatically when
`compression.request` is enabled. See
[Compression](../configuration/compression.md).

## Next steps

- [Batch and deduplication](batch-and-deduplication.md)
- [Events](../reference/events.md)