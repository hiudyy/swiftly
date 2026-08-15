# HTML parsing

Swiftly ships a **zero-dependency** HTML parser with CSS-like selectors.
Parse any HTML string or Buffer into a queryable tree.

## parseHTML(html, selectors, options)

```js
import { parseHTML } from 'swiftly';

const elements = parseHTML(html, '.product-title');
```

| Argument | Type | Description |
|----------|------|-------------|
| `html` | `string \| Buffer` | HTML source. Any other type throws. |
| `selectors` | `string \| object \| string[]` | What to extract (see below). |
| `options` | `object` | Reserved for future use (currently inert). |

## Selector forms

### 1. String selector → Element[]

```js
const links = parseHTML(html, 'a[href]');
```

### 2. Object map → results by name

```js
const results = parseHTML(html, {
  title: '.post h2',                    // Element[]
  hrefs: 'a@href',                      // attribute shorthand -> string[]
  first: { selector: '.price', multiple: false }, // single value or null
});
```

The object value can be:

- **A plain string** → `Element[]` for that selector.
- **A string with `@attr`** (e.g. `'a@href'`) → array of that attribute's
  values from all matches.
- **A config object** with these fields:

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `selector` | string | (required) | Selector to match. |
| `type` | `'text' \| 'html' \| 'attr'` | `'text'` | What to extract per element. |
| `attr` | string | — | Attribute name when `type: 'attr'`. |
| `multiple` | boolean | `true` | `true` → array; `false` → single value or `null`. |

### 3. Array of selectors → Element[][]

```js
const [paras, links] = parseHTML(html, ['p', 'a']);
```

## Selector syntax

- **Simple**: tag names, `*`, `#id`, `.class`, `[attr]`, `[attr="value"]`.
- **Attribute operators**: `=` exact, `^=` starts-with, `$=` ends-with,
  `*=` contains, `~=` word, `|=` prefix.
- **Combinators**: descendant (space), child `>`, adjacent sibling `+`,
  general sibling `~`.
- **Pseudo-classes**:
  - `:first`, `:last`, `:eq(n)` — **set-relative** (picked from the full
    match set in document order; `:eq` is 0-based, negative counts from the
    end) — like jQuery
  - `:first-child`, `:last-child`, `:only-child` — structural
  - `:first-of-type`, `:last-of-type`, `:only-of-type` — structural
  - `:nth-child(expr)` / `:nth-of-type(expr)` / `:nth-last-child(expr)` /
    `:nth-last-of-type(expr)` — `odd`, `even`, `an+b` (e.g. `2n+1`, `-n+3`),
    or a plain integer `n`
  - `:contains(text)`
  - `:empty`
  - `:not(sel)`
  - `:has(sel)`
- **Comma groups**: `'h1, h2'` — results are deduplicated across groups.

## The Element API

`querySelectorAll` and string-selector results return `Element` objects:

```js
const el = parseHTML(html, 'div.card')[0];

el.html;            // full outer HTML (raw)
el.content;         // trimmed inner text (raw, entities NOT decoded)
el.tag;             // lowercase tag name
el.attributes;      // attribute map (values ARE decoded)
el.children;        // nested Element[]
el.index;           // 1-based position among siblings

el.text();          // trimmed inner text (raw)
el.attr('href');    // attribute value or null
el.data();          // data-* attributes with the 'data-' prefix stripped

el.find('.item');   // descendant elements matching a selector
el.closest('section'); // nearest ancestor (self included) or null
el.parent();        // parent element or null
el.next();          // next sibling element or null
el.prev();          // previous sibling element or null
```

## Decoding entities

Element **attribute values** are entity-decoded automatically, but element
**text content** (`content`/`text()`) is kept raw. Use `decodeEntities` when
you need decoded text:

```js
import { parseHTML } from 'swiftly';
import { decodeEntities } from 'swiftly/lib/scraper.js';

const p = parseHTML('<p>Tom &amp; Jerry</p>', 'p')[0];
p.content;                        // 'Tom &amp; Jerry'  (raw)
decodeEntities(p.content);        // 'Tom & Jerry'
```

`decodeEntities` handles numeric (`&#65;`, `&#x41;`) and named entities
(`amp`, `lt`, `gt`, `quot`, `apos`, `nbsp`, `copy`, `reg`, `trade`, `hellip`,
`mdash`, `ndash`, quotes, `bull`, `middot`, currencies, and more).

## Parser behavior notes

- `script`, `style` and `textarea` contents are raw text (tags inside are not
  parsed).
- HTML comments and `<!DOCTYPE>` are skipped.
- Void tags (`br`, `img`, `input`, `meta`, …) never push onto the element
  stack.
- Tag/attribute names are lowercased.
- Repeated identical selector queries are cached within a single parse call.
- This is a tokenizer-based parser, not a full DOM — fine for most scraping.

## scrape() — fetch + parse in one step

```js
const api = swiftly();

const titles = await api.scrape('https://example.com', '.product-title');
// GET with responseType: 'text', cache off, then parseHTML
```

## parse() — parseHTML alias

```js
const data = api.parse(html, { title: { selector: '.title', multiple: false } });
```

## Next steps

- [Extraction suite](extraction.md)
- [Sanitizing and Markdown](sanitize-and-markdown.md)