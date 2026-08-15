# JSONPath

`queryJSON(data, path, fallback)` extracts values from parsed JSON using a
simplified JSONPath syntax.

```js
import { queryJSON } from 'swiftly';

const data = {
  user: { name: 'Ada' },
  items: [
    { id: 1, price: 10 },
    { id: 2, price: 20 },
  ],
};

queryJSON(data, 'user.name');        // 'Ada'
queryJSON(data, 'items[0].price');   // 10
queryJSON(data, 'items[*].price');   // [10, 20]
```

## Signature

```js
queryJSON(data, path, fallback)
```

- `data` — the root value (object or array).
- `path` — JSONPath-style string.
- `fallback` — returned when nothing matches (default `undefined`).

## Return value

- Single match → the value itself.
- Multiple matches → an **array** of values.
- No match (or empty path) → `fallback`.

## Supported syntax

| Syntax | Example | Behavior |
|--------|---------|----------|
| Dot notation | `user.name` | Key access. |
| Bracket index | `items[0]` | Numeric index. |
| Negative index | `items[-1]` | From the end. |
| Bracket wildcard | `items[*]` | All elements (arrays) / values (objects). |
| Bare wildcard | `*` | All values at this level. |
| Quoted key | `["a b"]`, `['a b']` | Keys with spaces/special chars. |
| Chained | `items[*].price`, `*[*]` | Multiple matches accumulate. |

## Examples

```js
const api = swiftly();
const raw = await api.get('https://api.example.com/orders', { responseType: 'raw' });

const firstPrice   = queryJSON(raw.data, 'orders[0].total');
const allNames     = queryJSON(raw.data, 'customers[*].name');
const nested       = queryJSON(raw.data, 'store["open hours"]');
const notFound     = queryJSON(raw.data, 'missing.field', 'default');
```

## Limitations

This is a **simplified** subset:

- No `$` / `@` root markers.
- No recursive descent (`..`).
- No filters (`[?(…)]`), slices (`[1:3]`) or unions.
- Wildcards flatten one level per `*` step.

For full JSONPath, combine with your favorite library on the parsed data.

## Next steps

- [XML and feeds](xml-and-feeds.md)
- [CSV](csv.md)