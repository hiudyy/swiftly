# Getting started

This guide takes you from install to your first real requests, and explains
how Swiftly turns HTTP responses into usable values.

## Installation

```bash
npm install swiftly
```

```bash
yarn add swiftly
```

```bash
pnpm add swiftly
```

**Requirements**

- Node.js **>= 14.13** (the `>=` is important — Swiftly uses modern syntax).
- No native modules, no build step, **zero runtime dependencies**.

## Importing

### ESM (recommended)

```js
import swiftly from 'swiftly';
```

### CommonJS

```js
const swiftly = require('swiftly');
```

### TypeScript

Swiftly ships `index.d.ts` with JSDoc-derived types, so editors provide
autocomplete out of the box:

```ts
import swiftly from 'swiftly';

// typed config + response
const api = swiftly({ timeout: 5000 });
const user: unknown = await api.get('/users/1');
```

## Two API styles

Swiftly offers two equivalent ways to call it.

### 1. Static calls (no setup)

```js
const user = await swiftly.get('https://api.example.com/users/1');
const created = await swiftly.post('https://api.example.com/users', { name: 'Ana' });
```

All static methods (`swiftly.get`, `swiftly.post`, `swiftly.query`, …) share a
**single internal client**. That means the connection pool, cookie jar and
cache are reused automatically — so static calls are cheap and state persists
across them.

### 2. A configured client instance

Pass a config object to get a client with its own defaults and state:

```js
const api = swiftly({
  baseURL: 'https://api.example.com',
  headers: { 'X-App': 'demo' },
  timeout: 5000,
  retries: 3,
});

const user = await api.get('/users/1'); // GET https://api.example.com/users/1
```

The returned value is a callable function with the same methods attached, plus
helpers (`setBaseURL`, `setTimeout`, `setDefaultHeaders`, `getMetrics`, …).
Both styles are the same client underneath — you can mix them freely.

> **Tip:** prefer a configured client for an API you call repeatedly. `baseURL`
> keeps your URLs short, and the shared pool/keep-alive pays off under load.

## Your first request

```js
import swiftly from 'swiftly';

const res = await swiftly.get('https://api.example.com/items', {
  params: { page: 1, sort: 'desc' },
});

console.log(res); // the parsed JSON body
```

That's the whole flow: build the URL (with params), send the request, parse
the body, and hand it back.

## What a request returns

Every request resolves with the **parsed response body** — there is no
`{ data }` wrapper to unwrap. The shape depends on the response `Content-Type`:

| Response `Content-Type` | Resolves to |
| ----------------------- | ----------- |
| `application/json`      | JS object / array |
| `text/*`, `html`        | `string` |
| anything else           | `Buffer` |

### Controlling the shape with `responseType`

When the server lies about its content type, or you want a specific format,
force it:

```js
await swiftly.get(url, { responseType: 'text' });    // always a string
await swiftly.get(url, { responseType: 'buffer' });  // always a Buffer
await swiftly.get(url, { responseType: 'raw' });     // { data, status, headers, duration }
await swiftly.get(url, { responseType: 'stream' });  // Readable stream (no parse)
```

- **`json`** (default) — parse JSON, fall back to `Buffer` if not JSON.
- **`text`** — decode the body as a string.
- **`buffer`** — return the raw `Buffer` (good for binaries).
- **`raw`** — return the **envelope**: `{ data, status, headers, config, duration }`.
  Use this when you need status/headers without an interceptor.
- **`stream`** — return the raw `Readable` stream (retries are disabled).

```js
const { data, status, headers, duration } = await swiftly.get(url, { responseType: 'raw' });
console.log(status, duration, headers['content-type']);
```

## Query parameters

`params` is an object. Scalars become `key=value`; arrays repeat the key;
nested objects are JSON-encoded so no data is lost.

```js
await swiftly.get(url, {
  params: {
    page: 1,
    tags: ['a', 'b'],          // ?tags=a&tags=b
    filter: { active: true },  // ?filter={"active":true}
  },
});
```

Nested objects are **not** silently dropped (they used to become
`[object Object]`) — they are serialized as JSON so the server receives the
full value.

## Headers

Set headers per request or as defaults on the client.

```js
// per request
await api.get('/me', { headers: { 'X-Request-Id': 'abc' } });

// client-wide default (merged, not replaced)
api.setDefaultHeaders({ 'X-App': 'demo' });
```

`Authorization` headers are handled for you via `auth` / `bearer` / `token`
(see [Configuration](configuration.md) and [Recipes](recipes.md)).

## Inspecting what happens

Turn on `debug` to log every request/response:

```js
const api = swiftly({ debug: true });
await api.get('/users/1');
```

Or hook into lifecycle events:

```js
api.on('request:end', ({ url, status, time }) => {
  console.log(status, `${time}ms`, url);
});
```

## Where to go next

- [Configuration](configuration.md) — every option, with examples.
- [API reference](api.md) — methods, interceptors, events, metrics.
- [Web scraping](scraping.md) — `parseHTML`, extraction suite, XML/CSV/JSONPath.
- [Errors](errors.md) — typed errors and retry behavior.
- [Recipes](recipes.md) — copy-paste patterns for real-world needs.
