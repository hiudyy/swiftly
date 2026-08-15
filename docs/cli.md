# CLI

Swiftly ships a small command-line client (`swiftly`) for quick requests and
scraping from the terminal.

## Usage

```bash
swiftly <method> <url> [options]
```

## Commands

```bash
swiftly get https://api.example.com/users/1
swiftly post https://api.example.com/users -d '{"name":"Ada"}'
swiftly put https://api.example.com/users/1 -d '{"name":"Ada+"}'
swiftly patch https://api.example.com/users/1 -d '{"name":"Ada!"}'
swiftly delete https://api.example.com/users/1
swiftly scrape https://example.com -s '.product-title'
```

Output is `JSON.stringify(response, null, 2)` (pretty-printed). On error it
prints `Error: <message>` and exits 1.

`scrape` requires `--selector` (exits with an error otherwise).

## Options

| Flag | Alias | Description |
|------|-------|-------------|
| `--data <json>` | `-d` | Request body. `JSON.parse`d; if that fails, used as a raw string. |
| `--selector <css>` | `-s` | Selector for `scrape`. |
| `--headers <json>` | `-h` | Custom headers object (invalid JSON → error). |
| `--timeout <ms>` | `-t` | Request timeout in milliseconds. |
| `--help` | — | Print usage and exit 0. |

Any method other than `get`, `post`, `put`, `patch`, `delete` or `scrape`
prints `Error: Invalid method` and exits 1. An invalid URL prints
`Error: Invalid URL`.

## Examples

```bash
# GET with headers and a timeout
swiftly get https://api.example.com/me -h '{"Authorization":"Bearer abc"}' -t 5000

# POST JSON
swiftly post https://api.example.com/users -d '{"name":"Ada"}'

# Scrape a selector from a page
swiftly scrape https://example.com -s 'a[href]'
```

## Notes

- The CLI uses the shared default client (same caching/pooling).
- `scrape` behaves like `api.scrape(url, selector)`: GET with
  `responseType: 'text'`, cache disabled, then `parseHTML`.
- `--headers` values must be valid JSON objects.

## Next steps

- [Getting started](getting-started/quickstart.md)
- [Web scraping](scraping/html-parsing.md)