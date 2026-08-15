# Quickstart

Make your first request in under a minute.

## 1. A simple GET

```js
import swiftly from 'swiftly';

const user = await swiftly.get('https://api.example.com/users/1');
console.log(user.id, user.name);
```

No `.data` wrapper: **the promise resolves with the parsed response body**
(JSON is parsed automatically). See [Responses](../guides/responses.md).

## 2. A POST with a JSON body

```js
const created = await swiftly.post('https://api.example.com/users', {
  name: 'Ada',
  email: 'ada@example.com',
});
```

Objects passed as the second argument are sent as JSON with
`Content-Type: application/json`.

## 3. Query params

```js
const items = await swiftly.get('https://api.example.com/items', {
  params: { page: 2, tags: ['a', 'b'] },
});
```

Nested objects and arrays are serialized safely. See
[Query params and headers](../guides/query-params-and-headers.md).

## 4. A client with defaults

Static calls (`swiftly.get`, `swiftly.post`, …) share one internal client. For
reusable defaults, create your own client:

```js
const api = swiftly({
  baseURL: 'https://api.example.com',
  timeout: 5000,
  headers: { 'X-App': 'demo' },
});

const user = await api.get('/users/1'); // GET https://api.example.com/users/1
const post = await api.post('/users', { name: 'Ada' });
```

## 5. Handle errors

```js
try {
  await swiftly.get('https://api.example.com/missing');
} catch (error) {
  if (error.code === 'RESPONSE_ERROR') {
    console.error('HTTP', error.response.status);
  } else {
    console.error(error.code, error.message);
  }
}
```

Every error carries a stable `code`. See [Error types](../reference/error-types.md).

## 6. Run it

```js
// demo.mjs
import swiftly from 'swiftly';

const items = await swiftly.get('https://jsonplaceholder.typicode.com/posts', {
  params: { _limit: 2 },
});
console.log(items[0].title);
```

```bash
node demo.mjs
```

## Next steps

- [Creating a client](creating-a-client.md) — config, shared state, helpers
- [Making requests](../guides/making-requests.md) — every HTTP verb