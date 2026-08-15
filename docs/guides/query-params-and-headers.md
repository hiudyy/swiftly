# Query params and headers

## Query params

Pass `params` on any request. Scalars, arrays and nested objects are all
serialized safely via `buildQueryString`:

```js
await api.get('/items', {
  params: {
    page: 1,
    tags: ['a', 'b'],          // ?tags=a&tags=b
    filter: { active: true },  // ?filter={"active":true}
  },
});
```

Notes:

- `null` values produce an empty value (`?key=`).
- `undefined` values are omitted.
- `Date` values are passed through to querystring stringification.
- Nested objects/arrays are JSON-stringified so they survive in the URL.

## Client-level default params

Set default params on the client; per-request `params` override them:

```js
const api = swiftly({ params: { lang: 'pt-BR' } });

await api.get('/items');                       // ?lang=pt-BR
await api.get('/items', { params: { page: 1 } }); // ?lang=pt-BR&page=1
```

## Headers

Per-request headers:

```js
await api.get('/me', { headers: { 'X-Request-Id': 'abc' } });
```

Client-level default headers:

```js
const api = swiftly({ headers: { 'X-App': 'demo' } });
```

Add more default headers later:

```js
api.setDefaultHeaders({ 'X-Version': '2' });
```

Custom headers **override** the generated ones (User-Agent, Accept, etc.).
Header values must be strings or numbers; anything else throws a
`ValidationError`.

## Generated default headers

Every request gets:

```
User-Agent:       Swiftly/1.0 (+https://github.com/hiudyy/swiftly)
Accept:           text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8
Accept-Language:  en-US,en;q=0.9
Accept-Encoding:  gzip, deflate, br
```

Overrides:

- `userAgent` config replaces the default User-Agent (unless header
  randomization is on).
- No `Connection` header is ever emitted — Node's agent manages keep-alive,
  and an explicit Connection header is invalid in HTTP/2.

## Header randomization (for scraping)

```js
const api = swiftly({ randomizeHeaders: true });
```

When enabled, `generateHeaders` picks a **random User-Agent** from a pool of 4
(Chrome/120 Windows, Chrome/120 macOS, Firefox/121, plus the Swiftly UA) and a
**random Accept-Language** from `['en-US', 'en-GB', 'pt-BR', 'es-ES', 'fr-FR',
'de-DE']`. Useful to look like a real browser when scraping. Off by default
(deterministic is better for caching and connection reuse).

## Next steps

- [Authentication](authentication.md)
- [Web scraping](../scraping/html-parsing.md)