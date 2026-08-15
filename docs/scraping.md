# Web Scraping

Swiftly ships a lightweight, dependency-free HTML parser for extracting data
from web pages. It's regex-based — fast and small, but not a full browser DOM.
Pair it with a dedicated HTML parser for heavy-duty jobs.

## parseHTML

```js
import swiftly, { parseHTML } from 'swiftly';

// Fetch a page and extract
const html = await swiftly.get('https://example.com', { responseType: 'text' });

const result = parseHTML(html, {
    title: { selector: 'h1', type: 'text', multiple: false },
    links: '.content a@href',
    prices: { selector: '.price', type: 'text', multiple: true }
});
```

## Selector syntax

- `#id` — element by id
- `.class` — elements by class
- `tag` — elements by tag name (e.g. `h1`, `a`, `div`)
- `[attr=value]` — elements by attribute
- `a@href` — extract an attribute value from matches

## Selector forms

You can pass a `string`, an `array`, or an object map.

**String** returns all matches:

```js
parseHTML(html, '.item'); // => array of element objects
```

**Object map** returns an object with one key per selector:

```js
parseHTML(html, {
    titles: { selector: 'h1', type: 'text', multiple: true },
    link:   'a@href',
    main:   { selector: '#main', type: 'html', multiple: false }
});
```

### Config object options

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `selector` | `string` | – | The selector to match |
| `type` | `string` | `'text'` | `text` \| `html` \| `attr` |
| `attr` | `string` | – | Attribute name (when `type: 'attr'`) |
| `multiple` | `boolean` | `true` | Return all matches vs. just the first |

## Element object

Each match has the shape:

```js
{
    html: '<h1>Hello</h1>',      // full outer HTML
    content: 'Hello',            // trimmed inner text
    attributes: { id: 'title' }, // parsed attributes
    children: []                 // nested element objects
}
```

## Scrape a live URL

`swiftly.scrape(url, selector)` fetches the page and parses it in one call:

```js
const titles = await swiftly.scrape('https://example.com', '.product-title');
```