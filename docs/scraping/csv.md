# CSV

Zero-dependency CSV parsing and serialization — handles quotes, embedded
delimiters, embedded newlines, and CRLF.

## parseCSV(text, options)

```js
import { parseCSV } from 'swiftly';

const rows = parseCSV(csvText);
```

| Option | Default | Description |
|--------|---------|-------------|
| `header` | `true` | `true` → array of objects keyed by the header row; `false` → array of string arrays. |
| `delimiter` | `','` | Field separator. |
| `skipEmptyLines` | `true` | Drop rows where every field is empty. |

### Object mode (header: true)

```js
parseCSV('name,age\nAda,36\nBob,41');
// [{ name: 'Ada', age: '36' }, { name: 'Bob', age: '41' }]
```

- Headers are trimmed; values are left as strings.
- Missing trailing fields become `null`.
- Empty input returns `[]`.
- **Duplicate header names collect their values into an array** — no silent
  data loss: `parseCSV('a,a,b\n1,2,3')` → `[{ a: ['1','2'], b: '3' }]`.
  (Common with spreadsheet exports that have merged/renamed columns.)

### Array mode (header: false)

```js
parseCSV('a,b\n1,2', { header: false });
// [['a','b'], ['1','2']]
```

### Edge cases handled

- Quoted fields with embedded delimiters and newlines.
- Escaped quotes (`""` → `"`).
- CRLF and lone `\r` line endings.
- A trailing line without a newline is still emitted.

> A quote inside an already-started unquoted field is treated as a quote
> delimiter (RFC 4180 requires quoting the whole field), so malformed input
> like `foo"bar",baz` parses as `foobar`, `baz` — it is not kept literal.

## toCSV(rows, options)

```js
import { toCSV } from 'swiftly';

const csv = toCSV([
  { name: 'Ada', age: 36 },
  { name: 'Bob', age: 41 },
]);
// 'name,age\r\nAda,36\r\nBob,41'
```

| Option | Default | Description |
|--------|---------|-------------|
| `header` | `true` | Emit a header line (object rows). |
| `delimiter` | `','` | Field separator. |

- Accepts objects or arrays; shape is auto-detected from the first row.
- Object mode writes a header from `Object.keys(rows[0])`; missing keys → `''`.
- Lines joined with `\r\n` (CRLF).
- Fields containing the delimiter, a quote, `\n` or `\r` are quoted; embedded
  quotes are doubled.
- Returns `''` for empty/non-array input.

## Example: scrape a table to CSV

```js
import swiftly, { extractTables, toCSV } from 'swiftly';

const html = await swiftly.get('https://example.com/prices', {
  responseType: 'text',
});
const [table] = extractTables(html);
const csv = toCSV(table.rows); // header from the first row's keys
```

## Next steps

- [XML and feeds](xml-and-feeds.md)
- [Recipes](../recipes.md)