# Proxy

Route requests through an HTTP(S) proxy.

## Configuration

```js
const api = swiftly({
  proxy: {
    host: '127.0.0.1',
    port: 8080,
    auth: 'user:pass',              // optional string
    // or auth: { username: 'user', password: 'pass' }
  },
});
```

## How it works

- **HTTPS** targets → an HTTP `CONNECT` tunnel through the proxy
  (`validateSSL` still applies to the tunneled TLS).
- **HTTP** targets → the request is sent in absolute-form to the proxy.
- After a successful CONNECT (status 200), the `proxy:connect` event fires
  with `{ host, proxyHost }`.

## Example

```js
const api = swiftly({ proxy: { host: 'proxy.corp.local', port: 3128 } });

const page = await api.get('https://example.com');
```

## Per-request

```js
await api.get('https://example.com', {
  proxy: { host: '127.0.0.1', port: 8888 },
});
```

## Notes

- Proxy settings are part of the merged config, so a per-request `proxy`
  overrides the client's proxy for that request.
- The proxy `auth` may be a `'user:pass'` string or
  `{ username, password }`.

## Next steps

- [Connection pooling](connection-pooling.md)
- [HTTP/2 and transport](http2-and-transport.md)