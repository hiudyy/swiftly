# Recipes

Copy-paste solutions for common scenarios. Each recipe is self-contained.

## 1. A reusable API client

```js
import swiftly from 'swiftly';

export const api = swiftly({
  baseURL: 'https://api.example.com',
  headers: { 'X-App': 'demo' },
  timeout: 5000,
  retries: 3,
  retryBackoff: 2,
  retryJitter: true,
  cache: { enabled: true, ttl: 300_000 },
});

export const get = (path, config) => api.get(path, config);
export const post = (path, data, config) => api.post(path, data, config);
```

## 2. Auth session (login, then authed calls)

```js
const api = swiftly();

await api.post('https://example.com/login', {
  username: 'alice',
  password: 'secret',
}); // server sets a session cookie

const dashboard = await api.get('https://example.com/dashboard');
// cookie is sent automatically
```

## 3. Bearer-token service

```js
const api = swiftly({ bearer: token, baseURL: 'https://api.example.com' });

const refreshToken = async () => {
  const { token: newToken } = await api.post('/auth/refresh');
  api.setDefaultHeaders({ Authorization: `Bearer ${newToken}` });
};
```

## 4. Resilient scraping loop with retries + delays

```js
const api = swiftly({
  retries: 4,
  retryBackoff: 2,
  retryJitter: true,
  retryOn: [429, 500, 502, 503, 504],
  randomizeHeaders: true,
  circuitBreaker: { enabled: true, failureThreshold: 5, resetTimeout: 60_000 },
});

for (const url of urls) {
  try {
    const html = await api.get(url, { responseType: 'text' });
    const titles = await api.scrape(url, '.article-title');
    console.log(url, titles.length, 'titles');
  } catch (error) {
    console.error('skipping', url, error.code);
  }
}
```

## 5. Scrape a table and export to CSV

```js
import { extractTables, toCSV } from 'swiftly';

const html = await api.get('https://example.com/prices', {
  responseType: 'text',
});
const [table] = extractTables(html);
const csv = toCSV(table.rows);
```

## 6. Download a file with progress

```js
await api.downloadTo(
  'https://example.com/report.pdf',
  '/tmp/report.pdf',
  { onProgress: ({ loaded, total, percent }) => console.log(`${percent.toFixed(1)}%`) },
);
```

## 7. Watch a GraphQL feed

```js
const data = await api.query('https://api.example.com/graphql', {
  query: `{ recentPosts { id title } }`,
});
for (const post of data.recentPosts) console.log(post.title);
```

## 8. Live SSE stream

```js
const stop = await api.subscribe('https://api.example.com/events', {
  onOpen: () => console.log('connected'),
  onMessage: (msg) => {
    if (msg.data) console.log(JSON.parse(msg.data));
  },
});

setTimeout(stop, 60_000);
```

## 9. Concurrency-safe cache-busting stock prices

```js
// Auth-aware + never stale: fetch fresh data for a SKU
const stock = await api.get('/stock', {
  params: { sku: 'A-1' },
  cache: { enabled: false },
});
```

## 10. Health-check monitor

```js
setInterval(async () => {
  const started = Date.now();
  try {
    await api.get('/health');
    console.log('OK', Date.now() - started, 'ms');
  } catch (error) {
    console.error('DOWN', error.code);
  }
}, 30_000);
```

## 11. Batch fan-out (never rejects)

```js
const results = await api.batch(
  ids.map((id) => ({ method: 'GET', url: `/users/${id}` })),
);

const ok = results.filter((r) => !r.error).length;
console.log(`${ok}/${ids.length} fetched`);
```

## 12. Request logging for every call

```js
import swiftly, { events } from 'swiftly';

swiftly.on(events.REQUEST_START, ({ method, url }) => console.log('→', method, url));
swiftly.on(events.REQUEST_END, ({ method, url, status, time }) =>
  console.log('←', status, `${time}ms`, url),
);
swiftly.on(events.REQUEST_ERROR, (error) => console.error('!', error.code, error.message));
```

## 13. Parse an RSS feed to items

```js
import { parseRSS } from 'swiftly';

const xml = await api.get('https://feeds.example.com/rss', {
  responseType: 'text',
});
for (const item of parseRSS(xml)) {
  console.log(item.title, '->', item.link);
}
```

## 14. Type-check a JSON API response

```js
const user = await api.get('/users/1', {
  responseSchema: { id: 'number', name: 'string', email: 'string' },
});
```

## 15. Timeout + abort control

```js
const controller = new AbortController();
setTimeout(() => controller.abort(), 800);

try {
  await api.get('/slow', { signal: controller.signal, timeouts: { connect: 1000, response: 5000 } });
} catch (error) {
  if (error.code === 'ABORT_ERROR') console.error('cancelled');
  if (error.code === 'TIMEOUT_ERROR') console.error('slow', error.type);
}
```

## Next steps

- [Guides](guides/making-requests.md)
- [Configuration](configuration/overview.md)
- [Web scraping](scraping/html-parsing.md)