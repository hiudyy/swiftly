# Authentication

Swiftly has three built-in auth helpers. Set them on the client or per request.

## Basic auth

```js
const api = swiftly({
  auth: { username: 'alice', password: 'secret' },
});
```

Produces `Authorization: Basic base64(alice:secret)`.

## Bearer token

```js
const api = swiftly({ bearer: 'my-token' });
```

Produces `Authorization: Bearer my-token`.

## Raw token

```js
const api = swiftly({ token: 'custom-value' });
```

Produces `Authorization: custom-value` (no scheme prefix).

## Per-request

All of them work per request too:

```js
await api.get('/private', { bearer: 'abc123' });
await api.get('/private', { auth: { username: 'bob', password: 'pw' } });
```

## Precedence with explicit Authorization header

If you pass an explicit `Authorization` header, it wins — **all** auth helpers
(`auth`, `bearer`, `token`) are skipped when the request already has an
`Authorization` header:

```js
await api.get('/private', {
  headers: { Authorization: 'Basic ' + base64('x:y') },
});
```

The auth helpers only run when no explicit `Authorization` header exists
(check the `if (!options.headers['Authorization'])` guard in the client).

## Combined example

```js
const api = swiftly({
  baseURL: 'https://api.example.com',
  bearer: 'abc123',
  headers: { 'X-App': 'demo' },
});

const me = await api.get('/me'); // Authorization: Bearer abc123
```

## Security notes

- Keep credentials out of `params` and URLs (they get logged by proxies).
- Cache keys are **auth-aware** — responses for different credentials are never
  shared. See [Caching](../configuration/caching.md).
- The `debug` logger prints request lines; don't enable it in production with
  sensitive credentials unless you know what you're doing.

## Next steps

- [Cookies and sessions](cookies-and-sessions.md)
- [Response schema validation](../reference/response-schema.md)