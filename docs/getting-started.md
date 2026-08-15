# Getting started

## Installation

```bash
npm install swiftly
```

Swiftly requires **Node.js >= 14.13** and has **zero runtime dependencies**.

## Import styles

**ESM** (recommended):

```js
import swiftly from 'swiftly';
```

**CommonJS**:

```js
const swiftly = require('swiftly');
```

## Two API styles

### 1. One-off static calls

You can call methods directly on the default export. All static calls share a
single internal client, so the connection pool, cookie jar and cache are
reused automatically.

```js
const user = await swiftly.get('https://api.example.com/users/1');
const created = await swiftly.post('https://api.example.com/users', { name: 'Ana' });
```

### 2. A configured client instance

Pass a config object to get a client with its own defaults and state. The
returned function supports the same methods, plus helpers to tweak config at
runtime.

```js
const api = swiftly({
  baseURL: 'https://api.example.com',
  headers: { 'X-App': 'demo' },
  timeout: 5000,
  retries: 3,
  cache: { enabled: true, ttl: 300_000 },
});

// Relative URLs resolve against baseURL
const user = await api.get('/users/1');
```

Both styles are equivalent under the hood — the static methods are just a
shared default client, so mixing them is fine.

## Your first request

```js
import swiftly from 'swiftly';

const res = await swiftly.get('https://api.example.com/items', {
  params: { page: 1, sort: 'desc' },
});

console.log(res); // parsed JSON body
```

## Return value

Requests resolve with the **parsed body** directly — there is no `{ data }`
wrapper to unwrap.

| Response `Content-Type` | Resolves to |
| ----------------------- | ----------- |
| `application/json`      | JS object / array |
| `text/*`, `html`        | `string` |
| anything else           | `Buffer` |

Override the shape with `responseType`:

```js
await swiftly.get(url, { responseType: 'text' });   // string
await swiftly.get(url, { responseType: 'buffer' }); // Buffer
await swiftly.get(url, { responseType: 'raw' });    // { data, status, headers, duration }
await swiftly.get(url, { responseType: 'stream' }); // Readable stream
```

## Next steps

- Tune behavior in [Configuration](configuration.md).
- Explore the [API reference](api.md).
- Scrape pages with [Web scraping](scraping.md).
