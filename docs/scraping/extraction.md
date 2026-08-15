# Extraction suite

Ten ready-made extractors for common scraping tasks. All accept `string |
Buffer` HTML. These are also exposed as named imports from the package root.

## extractLinks(html, baseUrl)

Extracts links from `a[href]`, deduplicated by href.

```js
import { extractLinks } from 'swiftly';

const links = extractLinks(html, 'https://site.example/blog/');
// [{ text: 'About', href: '/about', url: 'https://site.example/about' }, ...]
```

- `text` — link text (raw).
- `href` — raw href attribute.
- `url` — resolved absolute URL (when `baseUrl` given), else `href`.
- `mailto:`/`tel:`/`javascript:`/`data:`/fragment links are kept as-is.
- Duplicate hrefs: first occurrence wins.

## extractImages(html, baseUrl)

Extracts `img[src]`, deduplicated by src.

```js
const images = extractImages(html, 'https://site.example');
// [{ src, url, alt, title }, ...]
```

`alt` and `title` are `null` when absent.

## extractText(html)

Strips everything and returns clean readable text:

```js
const text = extractText(html);
```

- Removes `<script>`, `<style>`, `<noscript>` and comments.
- Strips all tags, collapses whitespace, trims.
- **Decodes entities** (the one extractor that decodes text).

## extractMeta(html)

Pulls page metadata into a flat object:

```js
const meta = extractMeta(html);
// { description: '...', og:title: '...', title: 'Fallback <title>' }
```

- Key = first of `name` / `property` / `http-equiv`; value = `content`.
- First occurrence wins for duplicates.
- Adds the `<title>` content as `title` only if no meta tag set it.

## extractTables(html, selector)

Extracts tables as header-keyed objects:

```js
const tables = extractTables(html); // default selector: 'table'
// [{ headers: ['Name', 'Price'], rows: [{ Name: 'Widget', Price: '$9.99' }] }]
```

- `headers` — trimmed text of the first `<tr>`.
- `rows` — objects keyed by header; missing cells are `null`.
- Pass any selector: `extractTables(html, '.pricing-table')`.
- Returns `[]` when nothing matches.

## extractForms(html)

Extracts forms and their fields:

```js
const forms = extractForms(html);
// [{ action, method, fields: [{ name, type, value }] }]
```

- `action` — form action or `null`; `method` — lowercased, default `'get'`.
- `fields` from `input`, `select`, `textarea`, `button` descendants (with a
  `name`).
- `type` is the tag name for non-inputs; `value` is inner content for
  textareas, else the `value` attribute.

## extractJsonLd(html)

Parses every `script[type="application/ld+json"]` block:

```js
const data = extractJsonLd(html); // Array of parsed JSON-LD values
```

Invalid JSON-LD blocks are silently skipped.

## extractJSON(html)

Extracts JSON embedded in scripts:

```js
const data = extractJSON(html); // Array of parsed values
```

- Preferred: all non-empty `script[type="application/json"]` blocks.
- Fallback (no typed blocks): all `<script>` blocks whose content starts with
  `{` or `[`.
- Parse failures are skipped.

## Summary

| Function | Returns |
|----------|---------|
| `extractLinks(html, baseUrl)` | `[{ text, href, url }]` |
| `extractImages(html, baseUrl)` | `[{ src, url, alt, title }]` |
| `extractText(html)` | `string` |
| `extractMeta(html)` | `{ name: content }` |
| `extractTables(html, selector?)` | `[{ headers, rows }]` |
| `extractForms(html)` | `[{ action, method, fields }]` |
| `extractJsonLd(html)` | `any[]` |
| `extractJSON(html)` | `any[]` |

## Next steps

- [HTML parsing](html-parsing.md)
- [Sanitizing and Markdown](sanitize-and-markdown.md)