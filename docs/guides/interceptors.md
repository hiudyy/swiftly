# Interceptors

Interceptors let you transform requests before they are sent and responses (or
errors) after they arrive.

## Registering

```js
const api = swiftly();

api.interceptors.request.use((config) => {
  config.headers['X-Trace'] = crypto.randomUUID();
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.code === 'RESPONSE_ERROR' && error.response.status === 401) {
      // e.g. refresh a token, then rethrow
    }
    throw error;
  },
);
```

## The two managers

Every client has:

```js
api.interceptors.request  // InterceptorManager
api.interceptors.response // InterceptorManager
```

### Request chain

`use(fulfilled, rejected)` — `fulfilled(config)` receives the request config
and must return the (possibly transformed) config. Handlers run in order, each
awaiting the previous result. If a `fulfilled` throws and that handler has a
`rejected`, the error is passed to `rejected` and its result continues the
chain; otherwise the error propagates.

```js
api.interceptors.request.use((config) => {
  config.headers['X-App'] = 'demo';
  return config;
});
```

### Response chain

`fulfilled(response)` transforms successful responses; `rejected(error)`
handles errors:

```js
api.interceptors.response.use(
  (res) => ({ ...res, processedAt: Date.now() }),
  async (error) => {
    if (error.code === 'RESPONSE_ERROR' && error.response.status === 429) {
      await wait(1000);
      // returning a value "handles" the error
    }
    throw error;
  },
);
```

The response error chain runs only `rejected` handlers. The first `rejected`
that returns a value `!== undefined` short-circuits and that value is the
result (error considered handled). If a `rejected` throws, that new error
replaces the current one and continues. If nothing handles it, the error is
thrown.

## Managing handlers

```js
const id = api.interceptors.request.use((c) => c); // returns handler id
api.interceptors.request.eject(id);                 // remove by id (slots are never reused)
api.interceptors.request.clear();                   // remove all
```

## Accessing interceptors on the shared client

```js
import swiftly from 'swiftly';

swiftly.client().interceptors.request.use((config) => config);
```

## Notes

- The request interceptor runs **after** URL formatting and cache lookup
  (the cache lookup uses the original config), so it cannot change the cache
  key. It does affect the outgoing request options.
- Interceptors run on the hot path — keep them cheap.

## Next steps

- [Events](../reference/events.md)
- [Authentication](authentication.md)