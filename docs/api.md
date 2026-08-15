# API reference

## HTTP methods

All methods return a `Promise` that resolves with the **parsed response body**
(unless `responseType: 'raw'` / `'stream'`).

| Method | Signature | Notes |
| ------ | --------- | ----- |
| `get` | `get(url, config?)` | Query params via `config.params`. |
| `post` | `post(url, data?, config?)` | JSON body by default. |
| `put` | `put(url, data?, config?)` | JSON body by default. |
| `patch` | `patch(url, data?, config?)` | JSON body by default. |
| `delete` | `delete(url, config?)` | |
| `head` | `head(url, config?)` | |
| `options` | `options(url, config?)` | |
| `request` | `request(method, url, data?, config?)` | Low-level entry point. |

```js
await api.get('/users', { params: { page: 2 } });
await api.post('/users', { name: 'Ana' });
await api.request('PURGE', '/cache');
```

## GraphQL — `query`

```js
const data = await api.query('https://api.example.com/graphql', {
  query: `query ($id: ID!) { user(id: $id) { name } }`,
  variables: { id: 1 },
});
// data === response.body.data
```

Throws an `Error` with `.graphqlErrors` when the server returns `errors`.

## Server-Sent Events — `subscribe`

```js
const unsubscribe = await api.subscribe('https://api.example.com/stream', {
  onOpen: () => {},
  onMessage: (msg) => console.log(msg.data),
  onError: (err) => console.error(err),
});

// later:
unsubscribe();
```

Resolves with an `unsubscribe()` function once the stream is open, and rejects
if the connection fails (the error is also passed to `onError`).

## Batch — `batch`

```js
const results = await api.batch([
  { method: 'GET',  url: '/users/1' },
  { method: 'POST', url: '/events', data: { type: 'click' } },
]);
```

Resolves with an array (one entry per request). Each entry is the parsed body,
or `{ error }` if that individual request failed — the batch itself never
rejects.

## Downloads

```js
const buf = await api.download('https://example.com/file.zip'); // Buffer
```

## Scraping

```js
const html = await api.get(url, { responseType: 'text' });
const data = api.parse(html, { title: 'h1', links: 'a@href' });

const titles = await api.scrape(url, '.product-title'); // fetch + parse
```

See [Web scraping](scraping.md).

## Instance helpers

| Helper | Description |
| ------ | ----------- |
| `setBaseURL(url)` | Set the base URL for relative requests. |
| `setTimeout(ms)` | Set the default socket timeout. |
| `setDefaultHeaders(obj)` | Merge default request headers. |
| `setDebug(bool)` | Toggle verbose logging. |
| `getConfig()` | Return the current config. |
| `clearCache()` | Empty the response cache. |
| `resetCircuitBreakers(domain?)` | Reset breaker state (all domains if omitted). |
| `getMetrics()` | Return runtime metrics. |
| `close()` | Close sockets, sessions, timers and free resources. |

## Interceptors

```js
api.interceptors.request.use((config) => {
  config.headers['X-Trace'] = crypto.randomUUID();
  return config;
});

api.interceptors.response.use((response) => response);
```

- `use(fulfilled?, rejected?)` returns an id.
- `eject(id)` removes a handler.
- `clear()` removes all handlers.

Request interceptors run before the request is sent; response interceptors run
on success (and on the response chain). A rejected handler can recover from
errors.

## Events

```js
api.on('request:end', ({ url, status, time }) => {});
api.off('request:end', handler);
```

Available events (also exposed as `swiftly.events`):

| Event | Payload |
| ----- | ------- |
| `request:start` | `{ url, method }` |
| `request:end` | `{ url, status, time }` |
| `request:error` | `{ url, error }` |
| `retry:attempt` | `{ attempt, error, delay }` |
| `cache:hit` / `cache:miss` / `cache:store` / `cache:invalid` | `{ url }` |
| `rate:limit` | `{ domain, delay }` |
| `redirect` | `{ from, to }` |
| `download:progress` / `upload:progress` | `{ loaded, total }` |
| `circuit:open` / `circuit:close` / `circuit:half-open` / `circuit:rejected` | `{ domain, ... }` |
| `abort` | `{ url }` |
| `proxy:connect` | `{ host, port }` |

## Metrics

`api.getMetrics()` returns:

```js
{
  requestCount, cacheHits, cacheMisses, cacheSize,
  retries, redirects, errors, activeConnections, routeMetrics
}
```

## Parsing & extraction utilities

All are also exported as named imports:

```js
import {
  parseHTML, parseXML, parseXMLTree, xmlToString,
  parseRSS, parseAtom, parseSitemap,
  parseCSV, toCSV, queryJSON,
  extractLinks, extractImages, extractText, extractMeta,
  extractTables, extractForms, extractJsonLd, extractJSON,
  sanitizeHtml, htmlToMarkdown
} from 'swiftly';
```

See [Web scraping](scraping.md) and the README for usage.
