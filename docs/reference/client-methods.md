# Client methods

Complete reference of everything a Swiftly client can do.

## createClient(config)

`createClient` is the factory behind `swiftly(config)` (in
`lib/client.js`). You normally never call it directly — `swiftly(...)` wraps
it. It returns an `HTTPClient` instance.

```js
import { createClient } from 'swiftly/lib/client.js';

const client = createClient({ timeout: 5000 });
```

The shared default client used by static calls is available as
`swiftly.client()`.

## HTTP verbs

| Method | Signature | Resolves with |
|--------|-----------|---------------|
| `get(url, config)` | `get(url, config = {})` | Parsed body |
| `post(url, data, config)` | `post(url, data = null, config = {})` | Parsed body |
| `put(url, data, config)` | `put(url, data = null, config = {})` | Parsed body |
| `patch(url, data, config)` | `patch(url, data = null, config = {})` | Parsed body |
| `delete(url, config)` | `delete(url, config = {})` | Parsed body |
| `head(url, config)` | `head(url, config = {})` | **Headers object only** |
| `options(url, config)` | `options(url, config = {})` | **Headers object only** |

`post` with `config.formData: true` and no `data` throws a `ValidationError`.

## request(method, url, data, config)

Low-level entry point used by all verbs. Uppercases the method.

```js
await client.request('GET', '/items', null, { params: { page: 1 } });
await client.request('PURGE', '/cache');
await client.request('POST', '/items', { name: 'X' });
```

## query(url, { query, variables }, config)

GraphQL helper. See [GraphQL](../guides/graphql.md).

```js
const data = await client.query(url, { query, variables: { id: 1 } });
```

Also supports the legacy form `query(queryString, variables, { endpoint })`.

## subscribe(url, callbacks, config)

SSE helper. Resolves with an unsubscribe function. See
[Server-Sent Events](../guides/server-sent-events.md).

## batch(requests)

Concurrent requests; each result is a body or `{ error }`. See
[Batch and deduplication](../guides/batch-and-deduplication.md).

```js
const results = await client.batch([
  { method: 'GET', url: '/users/1' },
  { method: 'POST', url: '/events', data: { type: 'click' } },
]);
```

## download(url, config)

GET with `responseType: 'buffer'`. Resolves with a `Buffer`.

```js
const buf = await client.download('https://example.com/file.zip');
```

## downloadTo(url, filePath, config)

Streams a GET directly to a file. **Argument order: URL first, then path.**

```js
const { path, bytes } = await client.downloadTo(
  'https://example.com/file.zip',
  '/tmp/file.zip',
  { onProgress: ({ percent }) => console.log(percent) },
);
```

- Rejects with `ResponseError` if status >= 400 (nothing written).
- `config.onProgress` receives `{ loaded, total, percent }`.
- Resolves with `{ path, bytes }`.

> `downloadTo` is available on the raw HTTPClient (`swiftly.client()`), not on
> the `swiftly(...)` wrapper.

## Event methods

| Method | Signature | Returns |
|--------|-----------|---------|
| `on(event, callback)` | `on('request:end', cb)` | The internal event emitter |
| `off(event, callback)` | `off('request:end', cb)` | The internal event emitter |

Omitting `callback` on `off` removes all listeners for the event. See
[Events](events.md).

## State & control

| Method | Behavior |
|--------|----------|
| `getMetrics()` | Metrics snapshot. See [Metrics](metrics.md). |
| `clearCache()` | Clears the cache store. |
| `resetCircuitBreakers(domain?)` | Reset one domain's breaker, or all. |
| `setConfig(partial)` | Replace client config (merged), resets the merge cache. Returns the client. |
| `clone(overrides)` | New independent client sharing merged config. |
| `close()` | Closes sessions, destroys pooled agents, clears cache. |
| `defaults` (getter) | The live merged config object. |

## Instance helpers (wrapper only)

These exist on the `swiftly(...)` wrapper:

| Method | Behavior |
|--------|----------|
| `setBaseURL(url)` | Set `config.baseURL`. |
| `setDefaultHeaders(headers)` | Merge headers into `config.headers`. |
| `setTimeout(ms)` | Set `config.timeout`. |
| `setDebug(bool)` | Set `config.debug`. |
| `getConfig()` | Return the live config object. |

## scrape(url, selector, config)

Fetch + parse in one step (wrapper only):

```js
const elements = await api.scrape('https://example.com', '.product-title');
```

Equivalent to a GET with `responseType: 'text'` and `cache: { enabled: false }`,
then `parseHTML(response, selector, config)`. See
[HTML parsing](../scraping/html-parsing.md).

## parse(html, selectors, config)

`parseHTML` alias (wrapper only).

```js
const data = api.parse(html, { title: '.title' });
```

## Parsing & extraction helpers

Also available as named imports from the package root:

- `parseHTML`, `parseXML`, `parseXMLTree`, `xmlToString`, `parseRSS`,
  `parseAtom`, `parseSitemap`, `parseCSV`, `toCSV`, `queryJSON`
- `extractLinks`, `extractImages`, `extractText`, `extractMeta`,
  `extractTables`, `extractForms`, `extractJsonLd`, `extractJSON`,
  `sanitizeHtml`, `htmlToMarkdown`
- `events` — the event-name constants map

## Interceptors

```js
client.interceptors.request.use(...);
client.interceptors.response.use(...);
```

See [Interceptors](../guides/interceptors.md).

## Cookies

```js
client.cookieJar.getCookiesMap(url);
client.cookieJar.setCookie(url, name, value, opts);
```

See [Cookies and sessions](../guides/cookies-and-sessions.md).

## Internal client state (advanced)

The raw HTTPClient exposes internal stores if you need them for tooling:
`events` (emitter), `interceptors`, `cookieJar`, `rateLimiter`, `cache`,
`connectionPool`, `http2Sessions`, `sessions`, `circuitBreakers`,
`routeMetrics`, `metrics`, `pendingRequests`.

These are not part of the stable API — use with care.

## Next steps

- [Events](events.md)
- [Metrics](metrics.md)
- [Error types](error-types.md)