# Sanitizing and Markdown

Helpers to clean HTML and convert it to Markdown.

## sanitizeHtml(html, options)

Remove dangerous or unwanted content from raw HTML (regex-based).

```js
import { sanitizeHtml } from 'swiftly';

const safe = sanitizeHtml(dirtyHtml);
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `stripTags` | `string[]` | `['script','style','iframe','object','embed','form','noscript','link','meta']` | Whole blocks removed (including content). |
| `allowEventHandlers` | `boolean` | `false` | `false` strips `on<event>` attributes. |

Behavior:

- HTML comments are always removed.
- With `allowEventHandlers: false`, event handler attributes (`onclick`,
  `onload`, …) are stripped.
- `javascript:` URLs in quoted `href`/`src`/`action` attributes are
  neutralized to empty values.

```js
sanitizeHtml(html, { stripTags: ['script'], allowEventHandlers: true });
```

## htmlToMarkdown(html)

Convert HTML to Markdown.

```js
import { htmlToMarkdown } from 'swiftly';

const md = htmlToMarkdown(html);
```

Conversion map:

| HTML | Markdown |
|------|----------|
| `h1`–`h6` | `#` … `######` |
| `strong` / `b` | `**text**` |
| `em` / `i` | `*text*` |
| `code` | `` `code` `` |
| `pre` | fenced code block |
| `a href` | `[text]` + `(url)` |
| `li` | `- text` (one per item) |
| `br` | newline |
| `p` | newline-padded block |

It runs `sanitizeHtml` first (default strip list), strips remaining tags,
collapses runs of 3+ newlines, and decodes entities.

## Decoding/encoding entities

The entity helpers live in `lib/scraper.js` (not re-exported from the package
root — import via the deep path):

```js
import { decodeEntities, encodeEntities } from 'swiftly/lib/scraper.js';

decodeEntities('Tom &amp; Jerry');   // 'Tom & Jerry'
decodeEntities('&#65;');             // 'A'
encodeEntities('<a href="x">');      // '&lt;a href=&quot;x&quot;&gt;'
```

- `decodeEntities` handles numeric (`&#NN;`, `&#xHH;`) and ~40 named entities.
- Unknown entities are left untouched.
- `encodeEntities` escapes `& < > " '`.

## Practical example

```js
import swiftly, { htmlToMarkdown } from 'swiftly';

const html = await swiftly.get('https://example.com/article', {
  responseType: 'text',
});
const md = htmlToMarkdown(html);
console.log(md);
```

## Next steps

- [Extraction suite](extraction.md)
- [JSONPath](jsonpath.md)