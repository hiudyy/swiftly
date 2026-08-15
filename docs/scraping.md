# Web scraping

Swiftly ships a lightweight, **dependency-free** HTML parser. It is
regex-based — fast and small, but not a full browser DOM. For heavy DOM work
pair it with a dedicated parser (e.g. `cheerio`). For most extraction tasks it
is more than enough and adds zero weight to your bundle.

## parseHTML

```js
import { parseHTML } from 'swiftly';

const html = `<div class="item"><h1>A</h1></div>
              <div class="item"><h1>B</h1></div>
              <a href="/x">X</a><a href="/y">Y</a>`;

parseHTML(html, {
  titles: { selector: '.item h1', type: 'text', multiple: true },
  links:  'a@href',
});
// => { titles: ['A', 'B'], links: ['/x', '/y'] }
```

Fetch + parse in one call:

```js
const titles = await swiftly.scrape('https://example.com', '.product-title');
```

## Selector syntax

- `#id` — element by id
- `.class` — elements by class
- `tag` — elements by tag name (`h1`, `a`, `div`, …)
- `[attr=value]` — elements by attribute (also `^=`, `$=`, `*=`, `~=`, `|=`)
- `a@href` — extract an attribute value from matches

Selectors support:

- **Combinators**: descendant (` `), child (`>`), adjacent (`+`), sibling (`~`).
- **Attribute operators**: `=`, `^=` (starts with), `$=` (ends with),
  `*=` (contains), `~=` (space-separated word), `|=` (prefix).
- **Pseudo-classes**: `:first`, `:last`, `:nth-child(n)`, `:nth-of-type(n)`,
  `:contains(text)`, `:not(sel)`, `:empty`, `:has(sel)`, `:eq(n)`.
- **Comma groups**: `'h1, h2'` matches both.

```js
parseHTML(html, {
  first: 'li:first',
  even:  'tr:nth-child(even)',
  withLink: 'div:has(a)',
  labeled: 'input[type="text"]',
});
```

## Selector forms

Pass a **string**, **array**, or **object map**.

```js
parseHTML(html, '.item');                 // string  -> array of elements
parseHTML(html, ['.item', 'a']);         // array   -> array of arrays
parseHTML(html, {                         // object  -> one key per selector
  titles: { selector: '.item h1', type: 'text', multiple: true },
  link:   'a@href',
  main:   { selector: '#main', type: 'html', multiple: false },
});
```

### Config object options

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `selector` | `string` | – | The selector to match. |
| `type` | `'text' \| 'html' \| 'attr'` | `'text'` | What to extract. |
| `attr` | `string` | – | Attribute name (when `type: 'attr'`). |
| `multiple` | `boolean` | `true` | Return all matches vs. just the first. |

## Element object

Each match has the shape:

```js
{
  html: '<h1>Hello</h1>',        // full outer HTML
  content: 'Hello',              // trimmed inner text
  attributes: { id: 'title' },   // parsed attributes
  children: [],                  // nested element objects
}
```

Elements also expose helpers:

| Helper | Returns |
| ------ | ------- |
| `el.attr(name)` | attribute value |
| `el.text()` | inner text |
| `el.find(selector)` | descendant matches |
| `el.parent()` | parent element or `null` |
| `el.closest(selector)` | nearest ancestor matching |
| `el.next()` | next sibling element or `null` |

```js
const items = parseHTML(html, '.item');
items[0].attr('class');   // 'item'
items[0].find('h1').text();
```

## Extraction suite

Convenience extractors that go straight from an HTML string to structured data.

```js
import {
  extractLinks, extractImages, extractText, extractMeta,
  extractTables, extractForms, extractJsonLd, extractJSON,
  sanitizeHtml, htmlToMarkdown
} from 'swiftly';

extractLinks(html, 'https://site.example'); // [{ text, href, url }]  (absolute urls)
extractImages(html, baseUrl);               // [{ src, url, alt, title }]
extractText(html);                          // plain text
extractMeta(html);                          // { description, 'og:title', title, ... }
extractTables(html, 'table');               // [{ headers, rows }]
extractForms(html);                         // [{ action, method, fields }]
extractJsonLd(html);                        // parsed JSON-LD blocks
extractJSON(html);                          // JSON embedded in <script>
sanitizeHtml(html);                         // strips scripts/handlers/comments
htmlToMarkdown(html);                       // basic HTML → Markdown
```

`extractTables` returns one entry per table:

```js
const [table] = extractTables(html);
table.headers; // ['Name', 'Price']
table.rows;    // [['Widget', '$9.99'], ...]
```

## XML, feeds, CSV & JSONPath

### XML

```js
import { parseXML, xmlToString } from 'swiftly';

const doc = parseXML('<root id="1"><a>x</a><a>y</a></root>');
// => { $: { id: '1' }, a: [{ '#text': 'x' }, { '#text': 'y' }] }

xmlToString(doc, 'root'); // serialize back to XML
```

`parseXMLTree` returns a richer tree (preserving element/attribute structure)
when you need to walk it programmatically.

### Feeds

```js
import { parseRSS, parseAtom, parseSitemap } from 'swiftly';

parseRSS(xml);     // [{ title, link, description, pubDate, guid, author, categories }]
parseAtom(xml);    // [{ title, link, summary, id, updated, author }]
parseSitemap(xml); // [{ loc, lastmod, changefreq, priority }]
```

### CSV

```js
import { parseCSV, toCSV } from 'swiftly';

parseCSV('name,age\nAna,30');    // [{ name: 'Ana', age: '30' }]
toCSV([{ name: 'Ana', age: 30 }]); // 'name,age\r\nAna,30'
```

`parseCSV` returns objects keyed by the header row. `toCSV` turns an array of
objects (or arrays) back into CSV text.

### JSONPath

```js
import { queryJSON } from 'swiftly';

const data = { user: { name: 'Ana' }, items: [{ id: 1 }, { id: 2 }] };
queryJSON(data, 'user.name');    // 'Ana'
queryJSON(data, 'items[*].id');  // [1, 2]
```

`queryJSON` supports dot paths and the `[*]` wildcard for arrays.

## Tips

- Scrape responsibly: set a `User-Agent`/`baseURL`, and respect `robots.txt`
  and rate limits (see [Recipes](recipes.md) for a polite crawler).
- For very large pages, fetch with `responseType: 'text'` once and call
  `parseHTML` multiple times rather than re-fetching.
- When a site needs JS rendering, Swiftly's parser won't execute scripts —
  use it for server-rendered HTML.
