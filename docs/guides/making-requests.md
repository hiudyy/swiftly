# Making requests

Every HTTP verb is a method on the client (or on the static export). All of
them return a promise of the **parsed response body**.

```js
const api = swiftly({ baseURL: 'https://api.example.com' });

await api.get('/items');                      // GET
await api.get('/items', { params: { page: 2 } });

await api.post('/items', { name: 'Widget' }); // POST, JSON body
await api.put('/items/1', { name: 'Widget+' });
await api.patch('/items/1', { name: 'Widget!' });
await api.delete('/items/1');
await api.head('/items/1');
await api.options('/items');
```

## Method signatures

| Method | Signature | Notes |
|--------|-----------|-------|
| `get(url, config)` | `get(url, config = {})` | |
| `post(url, data, config)` | `post(url, data = null, config = {})` | `data` sent as JSON body |
| `put(url, data, config)` | `put(url, data = null, config = {})` | |
| `patch(url, data, config)` | `patch(url, data = null, config = {})` | |
| `delete(url, config)` | `delete(url, config = {})` | |
| `head(url, config)` | `head(url, config = {})` | Returns **response headers only** |
| `options(url, config)` | `options(url, config = {})` | Returns **response headers only** |
| `request(method, url, data, config)` | `request(method, url, data = null, customConfig = {})` | Any verb |

## HEAD and OPTIONS

`head` and `options` resolve with the **response headers object** — there is no
body to return. To get headers for other requests, use `responseType: 'raw'`
(see [Responses](responses.md)).

```js
const headers = await api.head('/items/1');
console.log(headers['content-type']);

const allowed = await api.options('/items');
console.log(allowed['allow']);
```

## Any verb with request()

`request()` is the low-level entry point used by all verb methods. Use it for
verbs Swiftly doesn't have a named method for (e.g. `PURGE`, `TRACE`):

```js
const result = await api.request('PURGE', '/cache');
const result2 = await api.request('POST', '/items', { name: 'X' });
```

`request(method, url, data, config)` — method is uppercased internally.

## Sending bodies

- **Objects / arrays** → serialized as JSON, `Content-Type: application/json`.
- **Strings** → sent as-is (text/plain-ish).
- **Buffers** → sent raw.
- **Streams** → piped with upload progress. See
  [Streaming and downloads](streaming-and-downloads.md).

## GET caching is automatic

GET responses are cached by default (`cache.enabled: true`). See
[Caching](../configuration/caching.md). To opt out per request:

```js
await api.get('/stock', { cache: { enabled: false } });
```

## Retries apply automatically

Default `retries: 3` (total attempts). See
[Retries](../configuration/retries.md).

## Redirects

By default Swiftly follows 3xx redirects (301, 302, 303, 307, 308), up to
`maxRedirects` (default 5):

```js
const api = swiftly({
  followRedirects: true,
  maxRedirects: 5,
});

await api.get('/old-link');   // follows to the new location
```

Notes:

- Each hop emits the `redirect` event with `{ from, to }` (see
  [Events](../reference/events.md)).
- `Location` values are resolved against the current URL.
- Exceeding `maxRedirects` throws an error with `code: 'MAX_REDIRECTS'`
  (never retried). See [Error types](../reference/error-types.md).
- Disable entirely: `swiftly({ followRedirects: false })`.
- On redirects, query params/dedup are not re-applied; redirect-into-retry
  semantics differ from normal retries.

## Next steps

- [Responses](responses.md)
- [Query params and headers](query-params-and-headers.md)
- [Authentication](authentication.md)