# Swiftly Documentation

This folder holds the full Swiftly documentation. The package
[README](../README.md) links here for deeper references.

## Guides

- [Getting started](getting-started.md) — install, import styles, first
  requests, return values, `responseType`, params, headers, debugging.
- [Configuration](configuration.md) — every client option, explained with
  examples and grouped by concern.
- [API reference](api.md) — methods, instance helpers, interceptors, events,
  metrics and the parsing/extraction utilities.
- [Web scraping](scraping.md) — `parseHTML` selector syntax, the extraction
  suite, and XML / feeds / CSV / JSONPath.
- [Errors](errors.md) — typed error `code`s, retry behavior and the circuit
  breaker lifecycle.
- [Recipes](recipes.md) — copy-paste patterns: token refresh, resilient
  client, crawler, streaming, SSE, GraphQL, batch, cookies, scraping, CSV,
  monitoring, proxy/shutdown.

## Quick links

| Topic | Where |
| ----- | ----- |
| All config options | [Configuration](configuration.md) |
| Retries / circuit breaker / rate limiting | [Configuration](configuration.md) → Resilience · [Errors](errors.md) |
| Caching semantics | [Configuration](configuration.md) → Caching |
| Selector syntax (`#id`, `.class`, `a@href`) | [Web scraping](scraping.md) |
| Typed error `code`s | [Errors](errors.md) |
| Real-world patterns | [Recipes](recipes.md) |
