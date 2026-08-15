# Response schema validation

Validate the parsed response body against a **type map** before using it.
Catches API changes and contract violations early.

## Schema format

A plain object mapping keys to JavaScript type names (as returned by
`typeof`):

```js
const schema = {
  id: 'number',
  name: 'string',
  email: 'string',
  tags: 'object',   // arrays are typeof 'object'
  address: 'object',
};
```

| Schema value | typeof match |
|--------------|--------------|
| `'string'` | `typeof value === 'string'` |
| `'number'` | `typeof value === 'number'` |
| `'boolean'` | `typeof value === 'boolean'` |
| `'object'` | `typeof value === 'object'` (arrays too) |
| `'function'` | `typeof value === 'function'` |
| `'undefined'` | `typeof value === 'undefined'` |

## Usage

```js
const user = await api.get('/user', {
  responseSchema: { id: 'number', name: 'string' },
});
```

On mismatch, a plain `Error` is thrown with a
`Schema validation failed: ...` message (`.response` and `.type` are attached
to the error).

```js
try {
  await api.get('/user', { responseSchema: { id: 'number' } });
} catch (error) {
  console.error(error.message); // Schema validation failed: ...
  console.error(error.response); // response attached
}
```

## Where it runs

- Only when `responseSchema` is set.
- Only for non-stream requests.
- Skipped when `responseType: 'raw'`.
- The validator is chosen by the response `Content-Type`:
  - `application/json` → type-map validation runs.
  - `text/html` → a built-in HTML validator runs (checks the body contains
    `<!DOCTYPE` or `<html`); it **ignores** the schema map.
  - `text/*` or other → nothing happens (silently no-op).

## What is validated

The **final transformed result** — i.e. the exact value the caller receives —
is validated, after transformers run.

## Example: strict API contract

```js
const api = swiftly({ baseURL: 'https://api.example.com' });

const fetchUser = (id) =>
  api.get(`/users/${id}`, {
    responseSchema: {
      id: 'number',
      name: 'string',
      email: 'string',
      createdAt: 'string',
    },
  });

const user = await fetchUser(1);
```

## Notes

- Type strings are JS `typeof` values — there is no `'integer'` or `'array'`
  type. Validate arrays as `'object'` and check `.length`/`.isArray()` yourself.
- Validation errors are plain `Error`s, **not** `ValidationError`s (that class
  is for argument validation).

## Next steps

- [Error types](error-types.md)
- [Responses](../guides/responses.md)