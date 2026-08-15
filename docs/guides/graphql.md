# GraphQL

`query()` sends a GraphQL request and unwraps the result for you.

## Basic query

```js
const data = await api.query('https://api.example.com/graphql', {
  query: `query ($id: ID!) {
    user(id: $id) { id name email }
  }`,
  variables: { id: 1 },
});

console.log(data); // the GraphQL `data` field
```

The method POSTs `{ query, variables }` with `Content-Type: application/json`
and `Accept: application/json`.

## What it returns

- If the response JSON has a `data` field, **that field** is returned.
- If the response has an `errors` array, an `Error` is thrown with the first
  error's message, and `.graphqlErrors` is set to the full errors array:

```js
try {
  await api.query(url, { query: '{ nope }' });
} catch (error) {
  console.error(error.message);          // e.g. 'Cannot query field "nope"'
  console.error(error.graphqlErrors);    // full errors array
}
```

- Otherwise the raw response is returned.

## Legacy call form

`query()` also supports the older signature — pass the query string first,
then variables, and the endpoint via `config.endpoint`:

```js
// query(queryString, variables, { endpoint })
const data = await api.query(
  'query ($id: ID!) { user(id: $id) { name } }',
  { id: 5 },
  { endpoint: 'https://api.example.com/graphql' },
);
```

Detection: if the first argument starts with `{`, `query` or `mutation`, it is
treated as a GraphQL query string and `endpoint` defaults to `/graphql`.

## Mutations

Same method — just write a mutation:

```js
const result = await api.query(url, {
  query: `mutation ($id: ID!, $email: String!) {
    updateUser(id: $id, email: $email) { id email }
  }`,
  variables: { id: 1, email: 'new@example.com' },
});
```

## Per-request config

Extra config (timeouts, retries, headers, …) is forwarded to the underlying
POST:

```js
await api.query(url, { query, variables }, { timeout: 10_000, retries: 2 });
```

## Next steps

- [Server-Sent Events](server-sent-events.md)
- [Error types](../reference/error-types.md)