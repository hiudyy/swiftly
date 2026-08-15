# API reference

Everything you can call on `swiftly` (the default export) and on a client
instance created with `swiftly(config)`. Both expose the same surface.

## HTTP methods

All return a `Promise` resolving with the **parsed response body** (unless
`responseType: 'raw'` / `'stream'`).

| Method | Signature | Notes |
| ------ | --------- | ----- |
| `get` | `get(url, config?)` | Query params via `config.params`. |
| `post` | `post(url, data?, config?)` | JSON body by default. |
| `put` | `put(url, data?, config?)` | JSON body by default. |
| `patch` | `patch(url, data?, config?)` | JSON body by default. |
| `delete` | `delete(url, config?)` | |
| `head` | `head(url, config?)` | HEAD request (no body). Read headers via `responseType: 'raw'`. |
| `options` | `options(url, config?)` | |
| `request` | `request(method, url, data?, config?)` | Low-level entry point for any verb. |

```js
await api.get('/users', { params: { page: 2 } });
await api.post('/users', { name: 'Ana' });
await api.request('PURGE', '/cache'); // any verb
```

`head` resolves with an object that carries the response headers (useful to
check `content-length` or `last-modified` without downloading a body).

## GraphQL — `query`

```js
const data = await api.query('https://api.example.com/graphql', {
  query: `query ($id: ID!) { user(id: $id) { name } }`,
  variables: { id: 1 },
});
// data === response.body.data
```

- Returns `response.body.data` on success.
- Throws an `Error` with `.graphqlErrors` when the server returns `errors`.
- A legacy form `query(queryString, variables, config)` is also supported for
  backwards compatibility.

## Server-Sent Events — `subscribe`

```js
const unsubscribe = await api.subscribe('https://api.example.com/stream', {
  onOpen: () => console.log('connected'),
  onMessage: (msg) => console.log(msg.data),
  onError: (err) => console.error(err),
});

// later, to stop:
unsubscribe();
```

- Resolves with an `unsubscribe()` function **once the stream is open**.
- Rejects (and calls `onError`) if the connection cannot be established.
- `msg` is the parsed SSE event (`{ id, event, data, retry }`).

## Batch — `batch`

Run many requests concurrently. Never rejects — each entry is either the
parsed body or `{ error }`.

```js
const results = await api.batch([
  { method: 'GET',  url: '/users/1' },
  { method: 'POST', url: '/events', data: { type: 'click' } },
  { method: 'GET',  url: '/users/2', config: { timeout: 2000 } },
]);

for (const r of results) {
  if (r.error) console.error('failed', r.error.code);
  else console.log('ok', r);
}
```

Each item is `{ method, url, data?, config? }`.

## Downloads

```js
const buf = await api.download('https://example.com/file.zip'); // Buffer
```
Equivalent to `get(url, { responseType: 'buffer' })`.

## Scraping

```js
const html = await api.get(url, { responseType: 'text' });
const data = api.parse(html, { title: 'h1', links: 'a@href' });

const titles = await api.scrape(url, '.product-title'); // fetch + parse
```

- `parse(html, selectors)` — parse HTML you already have (no request).
- `scrape(url, selector, config?)` — fetch the URL (as text) and parse.

See [Web scraping](scraping.md).

## Client instance helpers

| Helper | Description |
| ------ | ----------- |
| `setBaseURL(url)` | Set the base URL for relative requests. |
| `setTimeout(ms)` | Set the default socket timeout. |
| `setDefaultHeaders(obj)` | Merge default request headers. |
| `setDebug(bool)` | Toggle verbose logging. |
| `getConfig()` | Return the current (live) config object. |
| `clearCache()` | Empty the response cache. |
| `resetCircuitBreakers(domain?)` | Reset breaker state (all domains if omitted). |
| `getMetrics()` | Return runtime metrics. |
| `close()` | Close sockets, sessions, timers and free resources. |

```js
const api = swiftly();
api.setBaseURL('https://api.example.com');
api.setTimeout(5000);
api.setDefaultHeaders({ 'X-App': 'demo' });
api.setDebug(true);
console.log(api.getConfig().retries);
```

> Call `await api.close()` when you're done (e.g. in a CLI or server shutdown)
> to release sockets and HTTP/2 sessions promptly.

## Interceptors

Interceptors let you transform requests before they're sent and responses (or
errors) after they return.

```js
api.interceptors.request.use((config) => {
  config.headers['X-Trace'] = crypto.randomUUID();
  return config; // must return the (possibly mutated) config
});

api.interceptors.response.use(
  (response) => response,                    // success chain
  (error) => {                               // error chain (optional)
    if (error.code === 'RESPONSE_ERROR' && error.response.status === 401) {
      // e.g. refresh a token and retry
    }
    throw error;
  }
);
```

- `use(fulfilled?, rejected?)` returns an id.
- `eject(id)` removes a handler; `clear()` removes all.
- Request interceptors run in order before the request; response interceptors
  run in order after success. A `rejected` handler can recover from errors.
- Interceptors receive the **internal** request/response shapes, so they're
  powerful but operate below the parsed-body API.

## Events

Subscribe to lifecycle events with `api.on(event, cb)` / `api.off(event, cb)`.

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

Event name constants are also available as `swiftly.events` (e.g.
`swiftly.events.REQUEST_END`).

```js
api.on('circuit:open', ({ domain }) => alert(`breaker open for ${domain}`));
api.on('cache:hit', () => stats.hits++);
```

## Metrics

`api.getMetrics()` returns a snapshot:

```js
{
  requestCount,        // total requests sent
  successCount,        // 2xx responses
  errorCount,          // failed requests
  cacheHits,           // cache hits
  cacheMisses,         // cache misses
  retries,             // retry attempts made
  redirects,           // redirects followed
  totalTime,           // sum of response times (ms)
  averageResponseTime, // totalTime / requestCount
  totalDataTransferred,// bytes in + out
  lastRequestTime,     // timestamp of last request
  activeSessions,      // open HTTP/2 sessions
  pooledConnections,   // pooled socket groups
  http2Sessions,       // HTTP/2 session count
  cacheSize,           // cached entries
  circuitBreakers: [   // per-domain breaker state
    { domain, state: { state, failureCount, lastFailureTime } }
  ]
}
```

## Parsing & extraction utilities

All are also available as named imports:

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

- HTML: `parseHTML`, `extractLinks`, `extractImages`, `extractText`,
  `extractMeta`, `extractTables`, `extractForms`, `extractJsonLd`,
  `extractJSON`, `sanitizeHtml`, `htmlToMarkdown`.
- XML/feeds: `parseXML`, `parseXMLTree`, `xmlToString`, `parseRSS`,
  `parseAtom`, `parseSitemap`.
- Data: `parseCSV`, `toCSV`, `queryJSON`.

See [Web scraping](scraping.md) for usage.
