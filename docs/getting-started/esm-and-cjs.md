# ESM and CommonJS

Swiftly works in both module systems. The default export is the same callable
client function either way.

## ESM (recommended)

```js
import swiftly from 'swiftly';

const user = await swiftly.get('https://api.example.com/users/1');
```

Named imports for parsing and extraction helpers:

```js
import swiftly, {
  parseHTML,
  parseXML,
  parseCSV,
  queryJSON,
  extractLinks,
  htmlToMarkdown,
  events,
} from 'swiftly';
```

See the full list of named exports in
[Parsing & extraction helpers](../reference/client-methods.md#parsing--extraction-helpers).

## CommonJS

```js
const swiftly = require('swiftly');
```

`require('swiftly')` returns the client function directly, and `.default` is
also set on it, so `require('swiftly').default` works too (useful for
interoperable tooling).

```js
const swiftly = require('swiftly');

swiftly.get('https://api.example.com/items', { params: { page: 1 } })
  .then((items) => console.log(items));
```

Named imports from CommonJS:

```js
const swiftly = require('swiftly');
const { parseHTML, parseCSV } = swiftly; // also exposed as properties
```

All named helpers are available as properties of the default export, so both
styles work.

## TypeScript

```ts
import swiftly from 'swiftly';
// or
import * as swiftly from 'swiftly';
```

`esModuleInterop` is recommended for `import swiftly from 'swiftly'`.

## Key facts

- Both entry points resolve to the **same** runtime client.
- Static methods (`swiftly.get`, …) on the default export share one internal
  default client (same connection pool, cookie jar, cache).
- A client created via `swiftly({ ... })` is fully independent.

## Next steps

- [Creating a client](creating-a-client.md)