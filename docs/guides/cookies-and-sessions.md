# Cookies and sessions

Swiftly keeps a per-client **cookie jar**. Cookies from `Set-Cookie` headers
are stored per domain and sent back automatically on later requests.

## Automatic cookie handling

```js
const api = swiftly();

await api.get('https://example.com/login');       // stores session cookie
await api.get('https://example.com/dashboard');   // cookie is sent back
```

## RFC 6265 matching

The jar honors the cookie spec:

- **Domain** — host-only cookies match only their exact host; `Domain=`
  cookies also match any subdomain.
- **Path** — RFC 6265 path matching: a cookie is sent only when the request
  path matches the cookie's path (a `Path=/api` cookie is *not* sent to
  `/apikey`); paths that don't start with `/` fall back to `/`.
- **Secure** — `Secure` cookies are only sent over `https:`.
- **Expiry** — expired cookies are purged automatically when reading.
  `Max-Age` is honored (relative seconds) and takes precedence over
  `Expires`; `Max-Age=0` deletes the cookie.
- **HttpOnly / SameSite** — attributes are stored (SameSite defaults to `Lax`).

## Accessing the jar

The cookie jar lives on the underlying HTTP client as `cookieJar`. For the
**shared default client** used by static calls, reach it via `swiftly.client()`:

```js
import swiftly from 'swiftly';

const jar = swiftly.client().cookieJar;

// Inspect cookies matching a URL
const cookies = jar.getCookiesMap('https://example.com');
// -> [{ name, value, expires, httpOnly, secure, sameSite, path }]

// Get just the Cookie header string
const header = jar.getCookies('https://example.com');
// -> 'sid=abc123; theme=dark'

// Clear a domain, or everything
jar.clearCookies('https://example.com');
jar.clearCookies();
```

> Note: the `swiftly(...)` wrapper does not currently forward the jar
> (`api.cookieJar` is not set). Use `swiftly.client()` (the shared client) or
> a raw client from `createClient` (`import { createClient } from
> 'swiftly/lib/client.js'`) when you need direct jar access. The jar is
> shared by all static calls anyway.

## Setting cookies manually

```js
const jar = swiftly.client().cookieJar;

jar.setCookie('https://example.com', 'theme', 'dark', {
  path: '/',
  httpOnly: false,
  secure: false,
});

// Object form
jar.setCookie('https://example.com', { name: 'lang', value: 'pt-BR' });

// Raw Set-Cookie header form
jar.setCookie('https://example.com', 'sid=abc; Path=/; HttpOnly; Secure');
```

## Serialization

```js
const jar = swiftly.client().cookieJar;
const json = jar.toJSON();
jar.fromJSON(json); // restore later (e.g. across restarts)
```

## Session lifecycle

The `session` config controls cookie/header session cleanup:

| Option | Default | Effect |
|--------|---------|--------|
| `session.ttl` | `3600000` (1h) | Expiry for stored per-domain sessions |
| `session.maxSessions` | `100` | Above this, expired sessions are purged on access |
| `session.autoCleanup` | `true` | Background cleanup interval (`.unref()`'d), emits `sessions:cleanup` |

```js
const api = swiftly({
  session: { ttl: 30 * 60 * 1000, maxSessions: 500, autoCleanup: true },
});
```

## Cookies + auth cache safety

Because GET responses are cached with **auth-aware keys**, a cached response
for one set of credentials (including cookie-based sessions) is never returned
to another. See [Caching](../configuration/caching.md).

## Next steps

- [Interceptors](interceptors.md)
- [Web scraping](../scraping/html-parsing.md)