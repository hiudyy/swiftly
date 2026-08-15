# Web scraping

Swiftly ships a lightweight, **dependency-free** HTML parser. It is
regex-based — fast and small, but not a full browser DOM. Pair it with a
dedicated parser (e.g. `cheerio`) for heavy-duty DOM work.

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
- `[attr=value]` — elements by attribute
- `a@href` — extract an attribute value from matches

Selectors support combinators (` `, `>`, `+`, `~`), attribute operators
(`=`, `^=`, `$=`, `*=`, `~=`, `|=`), pseudo-classes (`:first`, `:last`,
`:nth-child`, `:nth-of-type`, `:contains`, `:not`, `:empty`, `:has`, `:eq`)
and comma groups.

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

Elements also expose helpers: `attr(name)`, `find(selector)`, `parent()`,
`closest(selector)`, `next()`, `text()`.

## Extraction suite

```js
import {
  extractLinks, extractImages, extractText, extractMeta,
  extractTables, extractForms, extractJsonLd, extractJSON,
  sanitizeHtml, htmlToMarkdown
} from 'swiftly';

extractLinks(html, 'https://site.example'); // [{ text, href, url }] (absolute)
extractImages(html, baseUrl);               // [{ src, url, alt, title }]
extractText(html);                          // plain text
extractMeta(html);                          // { description, 'og:title', title }
extractTables(html, 'table');               // [{ headers, rows }]
extractForms(html);                         // [{ action, method, fields }]
extractJsonLd(html);                        // parsed JSON-LD blocks
extractJSON(html);                          // JSON embedded in <script>
sanitizeHtml(html);                         // strips scripts/handlers/comments
htmlToMarkdown(html);                       // basic HTML → Markdown
```

## XML, feeds, CSV & JSONPath

```js
import {
  parseXML, xmlToString, parseRSS, parseAtom, parseSitemap,
  parseCSV, toCSV, queryJSON
} from 'swiftly';

parseXML('<root id="1"><a>x</a><a>y</a></root>');
// => { $: { id: '1' }, a: [{ '#text': 'x' }, { '#text': 'y' }] }

xmlToString(doc, 'root');        // back to XML
parseRSS(xml);                   // [{ title, link, description, pubDate, guid, author, categories }]
parseAtom(xml);                  // [{ title, link, summary, id, updated, author }]
parseSitemap(xml);               // [{ loc, lastmod, changefreq, priority }]

parseCSV('name,age\nAna,30');    // [{ name: 'Ana', age: '30' }]
toCSV([{ name: 'Ana', age: 30 }]); // 'name,age\r\nAna,30'

const data = { user: { name: 'Ana' }, items: [{ id: 1 }, { id: 2 }] };
queryJSON(data, 'user.name');    // 'Ana'
queryJSON(data, 'items[*].id');  // [1, 2]
```
