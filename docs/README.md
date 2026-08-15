# Swiftly Documentation

Swiftly is a fast, zero-dependency HTTP client for Node.js. This is the complete
reference — every feature, every option, every method, every event, every error.
Nothing is left out.

- [Getting started](getting-started/installation.md) — install, import, first request
- [Guides](guides/making-requests.md) — how to use each feature in practice
- [Configuration](configuration/overview.md) — every option, its default and effect
- [Reference](reference/client-methods.md) — methods, events, metrics, errors
- [Web scraping](scraping/html-parsing.md) — HTML, extraction, JSONPath, XML, CSV
- [CLI](cli.md) — command line usage
- [Advanced](advanced/undici.md) — undici, debugging, performance
- [Recipes](recipes.md) — copy-paste solutions for common scenarios

---

## Feature overview

| Area | What Swiftly gives you |
|------|------------------------|
| **Requests** | `get`, `post`, `put`, `patch`, `delete`, `head`, `options`, and low-level `request()` for any verb |
| **Responses** | Automatic JSON / HTML / text / buffer detection, `responseType` override, `raw` envelope |
| **Retries** | Exponential or linear backoff, jitter, `Retry-After` support, per-status retry rules |
| **Resilience** | Circuit breakers, rate limiting, socket timeouts, abort signals |
| **Caching** | Auth-aware LRU cache, TTL, stale-while-revalidate, custom storage |
| **Streaming** | `stream: true`, `download()` → Buffer, `downloadTo()` → file, upload/download progress |
| **GraphQL** | One-line queries with variables and structured errors |
| **SSE** | Server-Sent Events subscription with unsubscribe |
| **Batch** | Concurrent requests, never rejects — results or `{ error }` |
| **Sessions** | Cookie jar with RFC 6265 domain/path/secure matching |
| **Extensibility** | Request/response interceptors, hooks, events, custom agents |
| **Scraping** | HTML parser with CSS-like selectors, 10 extraction helpers, HTML→Markdown |
| **Data formats** | XML, RSS, Atom, sitemaps, CSV, JSONPath |
| **CLI** | `swiftly get`, `swiftly post`, `swiftly scrape`, … |

## Quick example

```js
import swiftly from 'swiftly';

const user = await swiftly.get('https://api.example.com/users/1');
console.log(user.name);
```

## Navigation

### Getting started
- [Installation](getting-started/installation.md)
- [Quickstart](getting-started/quickstart.md)
- [ESM and CommonJS](getting-started/esm-and-cjs.md)
- [Creating a client](getting-started/creating-a-client.md)

### Guides
- [Making requests](guides/making-requests.md)
- [Responses](guides/responses.md)
- [Query params and headers](guides/query-params-and-headers.md)
- [Authentication](guides/authentication.md)
- [Cookies and sessions](guides/cookies-and-sessions.md)
- [Streaming and downloads](guides/streaming-and-downloads.md)
- [GraphQL](guides/graphql.md)
- [Server-Sent Events](guides/server-sent-events.md)
- [Batch and deduplication](guides/batch-and-deduplication.md)
- [Interceptors](guides/interceptors.md)

### Configuration
- [Options reference](configuration/overview.md)
- [Retries](configuration/retries.md)
- [Timeouts](configuration/timeouts.md)
- [Circuit breaker](configuration/circuit-breaker.md)
- [Rate limiting](configuration/rate-limiting.md)
- [Caching](configuration/caching.md)
- [Proxy](configuration/proxy.md)
- [Connection pooling](configuration/connection-pooling.md)
- [Compression](configuration/compression.md)
- [HTTP/2 and transport](configuration/http2-and-transport.md)

### Reference
- [Client methods](reference/client-methods.md)
- [Events](reference/events.md)
- [Metrics](reference/metrics.md)
- [Error types](reference/error-types.md)
- [Response schema validation](reference/response-schema.md)
- [Internal utilities](reference/internal-utils.md)
- [TypeScript types](reference/typescript.md)

### Web scraping
- [HTML parsing](scraping/html-parsing.md)
- [Extraction suite](scraping/extraction.md)
- [Sanitizing and Markdown](scraping/sanitize-and-markdown.md)
- [JSONPath](scraping/jsonpath.md)
- [XML and feeds](scraping/xml-and-feeds.md)
- [CSV](scraping/csv.md)

### Elsewhere
- [CLI](cli.md)
- [Advanced: undici transport](advanced/undici.md)
- [Advanced: debugging](advanced/debugging.md)
- [Advanced: performance](advanced/performance.md)
- [Recipes](recipes.md)