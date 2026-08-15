# Installation

Swiftly has **zero runtime dependencies**. Installing it installs only Swiftly
itself — no transitive dependencies, no supply chain surprises.

## Requirements

- Node.js **>= 14.13** (ESM support)

## Install

```bash
npm install swiftly
```

## Import

ESM (modern, recommended):

```js
import swiftly from 'swiftly';
```

CommonJS:

```js
const swiftly = require('swiftly');
```

Both return the same callable client, so every example in this documentation
works with either. See [ESM and CommonJS](esm-and-cjs.md).

## TypeScript

The package ships its own types (`index.d.ts`). No `@types` package needed:

```ts
import swiftly from 'swiftly';

const user = await swiftly.get<{ id: number; name: string }>('/users/1');
```

## Optional extras

Swiftly is 100% functional with just Node's built-in `http`/`https`. Two
features are **opt-in** and never force a dependency on you:

- **`transport: 'undici'`** — uses the `undici` HTTP client instead of Node's
  built-in modules. You must install `undici` yourself for this to work. See
  [HTTP/2 and transport](../configuration/http2-and-transport.md).

Nothing else is ever required.

## Verify the install

```bash
node -e "import('swiftly').then(s => console.log(typeof s.get))"  # -> function
```

## Next steps

- [Quickstart](quickstart.md) — make your first request
- [ESM and CommonJS](esm-and-cjs.md) — both module systems in depth