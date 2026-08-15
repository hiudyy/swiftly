# Recipes

Copy-paste patterns for real-world needs. Each snippet is self-contained.

## Authenticated client with token refresh

Store a token, and on `401` refresh it and retry once:

```js
import swiftly from 'swiftly';

let token = await login(); // your auth flow
const api = swiftly({ bearer: token });

async function authed(method, url, data, config) {
  try {
    return await api[method](url, data, config);
  } catch (err) {
    if (err.code === 'RESPONSE_ERROR' && err.response.status === 401) {
      token = await refreshToken();         // obtain a new token
      api.setDefaultHeaders({ Authorization: `Bearer ${token}` });
      return await api[method](url, data, config); // one retry
    }
    throw err;
  }
}

const me = await authed('get', '/me');
```

## A resilient client

Retries with backoff, a circuit breaker, a hard timeout, and per-domain rate
limiting — a solid default for calling flaky downstream services:

```js
const api = swiftly({
  timeout: 8000,
  retries: 4,
  retryDelay: 500,
  retryBackoff: 2,
  retryJitter: true,
  retryOn: [429, 500, 502, 503, 504],
  circuitBreaker: { enabled: true, failureThreshold: 5, resetTimeout: 60000 },
  rateLimiting: { enabled: true, requestsPerSecond: 20 },
});

api.on('circuit:open', ({ domain }) => console.warn(`breaker open: ${domain}`));
```

## Caching strategy

Cache GETs by default; use `staleWhileRevalidate` for snappy reads, and disable
the cache per request when you need fresh data:

```js
const api = swiftly({
  cache: { enabled: true, ttl: 60_000, staleWhileRevalidate: true },
});

await api.get('/config');                 // cached
await api.get('/config');                 // instant (possibly stale, refreshed in bg)

await api.get('/stock?sku=1', { cache: { enabled: false } }); // always fresh
```

Cache keys are **auth-aware**, so different credentials never share entries.

## A polite, rate-limited crawler

Crawl politely: throttle, add small delays, retry only on transient errors,
and surface progress via events:

```js
const crawler = swiftly({
  baseURL: 'https://example.com',
  rateLimiting: { enabled: true, requestsPerSecond: 2 },
  humanize: true,
  retries: 3,
  retryOn: [429, 500, 502, 503],
  randomizeHeaders: true,
  headers: { 'User-Agent': 'swiftly-crawler/1.0 (+https://your.site)' },
});

crawler.on('request:end', ({ url, time }) => console.log(`fetched ${url} in ${time}ms`));

for (const path of paths) {
  const html = await crawler.get(path, { responseType: 'text' });
  // ... extract data ...
}
```

## Streaming a large file to disk

Get a stream and pipe it to a file; report progress from the `data` chunks:

```js
import fs from 'node:fs';
import swiftly from 'swiftly';

const api = swiftly();
const stream = await api.get('https://example.com/big.zip', { stream: true, responseType: 'stream' });
// `stream` is the raw Readable; its `.status`/`.headers` are available.

let loaded = 0;
const out = fs.createWriteStream('./big.zip');
stream.on('data', (chunk) => { loaded += chunk.length; process.stdout.write(`\r${loaded} bytes`); });
await new Promise((resolve, reject) => {
  stream.pipe(out);
  out.on('finish', resolve);
  stream.on('error', reject);
  out.on('error', reject);
});
```

> For a `Buffer` in memory, prefer `api.download(url)` → `Buffer`.

## Consuming Server-Sent Events

```js
const unsubscribe = await api.subscribe('https://example.com/stream', {
  onOpen: () => console.log('connected'),
  onMessage: (msg) => console.log('event:', msg.data),
  onError: (err) => console.error('stream error', err),
});

// later:
unsubscribe();
```

`msg` is the parsed event: `{ id, event, data, retry }`. The promise rejects
if the connection fails.

## GraphQL with variables and errors

```js
try {
  const data = await api.query('https://api.example.com/graphql', {
    query: `
      query Repo($owner: String!) {
        repository(owner: $owner) { name }
      }`,
    variables: { owner: 'hiudy' },
  });
  console.log(data.repository.name);
} catch (err) {
  if (err.graphqlErrors) console.error('graphql:', err.graphqlErrors);
  else throw err;
}
```

## Fan-out with batch

Fetch many resources in one concurrent call; handle partial failures:

```js
const results = await api.batch(
  ids.map((id) => ({ method: 'GET', url: `/users/${id}` }))
);

const ok = results.filter((r) => !r.error);
const failed = results.filter((r) => r.error);
console.log(`got ${ok.length}, failed ${failed.length}`);
```

## Cookie / session login flow

Cookies from `Set-Cookie` are stored per domain and sent back automatically,
including `Domain` (subdomains), `Path` and `Secure`:

```js
const api = swiftly();

await api.post('/login', { user: 'ana', pass: '***' }); // stores session cookie
const dash = await api.get('/dashboard');               // cookie sent back
```

## Scraping pipeline

```js
import { parseHTML, extractTables } from 'swiftly';

const html = await api.get('https://example.com/products', { responseType: 'text' });

const { name, price } = parseHTML(html, {
  name:  { selector: 'h1', type: 'text', multiple: false },
  price: { selector: '.price', type: 'text', multiple: false },
});

const [specs] = extractTables(html);
console.log(name, price, specs?.rows);
```

## CSV round-trip

```js
import { parseCSV, toCSV } from 'swiftly';

// API returns CSV text
const csv = await api.get('/report.csv', { responseType: 'text' });
const rows = parseCSV(csv);              // [{ date, value }, ...]

// transform and write back
const out = toCSV(rows.map((r) => ({ ...r, value: Number(r.value) * 2 })));
await fs.promises.writeFile('./doubled.csv', out);
```

## Validating responses with `responseSchema`

Fail fast when a response doesn't match your contract. `responseSchema` is a
type map validated against the parsed JSON body:

```js
const api = swiftly({
  responseSchema: { id: 'number', name: 'string' },
});

await api.get('/users/1'); // throws if `id`/`name` have the wrong type
```


## Monitoring with metrics and events

Track cache hit-rate, slow requests, and breaker state in production:

```js
api.on('request:end', ({ url, time }) => {
  if (time > 1000) console.warn(`slow: ${url} (${time}ms)`);
});

setInterval(() => {
  const m = api.getMetrics();
  console.log({
    rps: m.requestCount,
    hitRate: m.cacheHits / (m.cacheHits + m.cacheMisses || 1),
    retries: m.retries,
    breakers: m.circuitBreakers,
  });
}, 10_000);
```

## Custom transport or proxy

```js
// optional, faster HTTP engine (install `undici` separately)
const fast = swiftly({ transport: 'undici' });

// route through a proxy
const proxied = swiftly({ proxy: { host: '127.0.0.1', port: 8080 } });
```

## Clean shutdown

Release sockets and HTTP/2 sessions when your process exits:

```js
process.on('SIGINT', async () => {
  await api.close();
  process.exit(0);
});
```
