# XML and feeds

Zero-dependency XML parser/serializer plus helpers for RSS, Atom and
sitemaps. All functions accept `string | Buffer`.

## parseXML(xml)

Parses XML into a plain object:

```js
import { parseXML } from 'swiftly';

parseXML('<a b="1"><c>hi</c><c>yo</c></a>');
// { $: { b: '1' }, c: [ { '#text': 'hi' }, { '#text': 'yo' } ] }
```

Shape rules:

- Attributes live under `$` (`{ $: { attr: value } }`).
- Text content under `#text` (only when non-empty).
- Repeated child tags become arrays; single occurrences become objects.
- Attribute values with no `=` become `true`.
- Comments, processing instructions and the XML declaration are skipped.
- Declarations (`<!DOCTYPE ...>`, including internal DTD subsets) are
  skipped and never expanded — the parser performs **no entity expansion**, so
  it is immune to XXE by design.
- CDATA becomes text.
- Mismatched close tags are tolerated (implicit close up the stack).

Multiple roots → object keyed `root0`, `root1`, ….

## parseXMLTree(xml)

The low-level node tree:

```js
const nodes = parseXMLTree(xml);
// { tag, attrs, children, text, parent } — single node, or array of nodes
```

## xmlToString(obj, rootName)

The inverse of `parseXML` — serialize an object back to XML:

```js
import { xmlToString } from 'swiftly';

xmlToString({ $: { version: '2' }, item: { '#text': 'hi' } }, 'root');
// <root version="2"><item>hi</item></root>

xmlToString('just text'); // <root>just text</root>
```

- `$` → attributes; `#text` → escaped text; other keys → child elements
  (arrays repeat the element).
- `null`/`undefined` scalars serialize as empty elements.

## parseRSS(xml)

Parse an RSS feed:

```js
import { parseRSS } from 'swiftly';

const items = parseRSS(xml);
// [{ title, link, description, pubDate, guid, author, categories }, ...]
```

- `author` falls back to `dc:creator` when missing.
- `categories` is an array (each category string or null).
- Returns `[]` if the feed has no items.

## parseAtom(xml)

Parse an Atom feed:

```js
import { parseAtom } from 'swiftly';

const entries = parseAtom(xml);
// [{ title, link, summary, id, updated, author }, ...]
```

- `link` is resolved from the entry's `href` attribute.
- `author` prefers `author.name`.

## parseSitemap(xml)

Parse a sitemap:

```js
import { parseSitemap } from 'swiftly';

// urlset -> [{ loc, lastmod, changefreq, priority }, ...]
// sitemapindex -> [{ loc }, ...]
// otherwise -> []
```

## Example: fetch + parse a feed

```js
import swiftly, { parseRSS, parseAtom } from 'swiftly';

const xml = await swiftly.get('https://feeds.example.com/rss', {
  responseType: 'text',
});

for (const item of parseRSS(xml)) {
  console.log(item.title, item.link);
}
```

## Next steps

- [CSV](csv.md)
- [Extraction suite](extraction.md)