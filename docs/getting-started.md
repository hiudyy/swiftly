# Getting Started

Swiftly is a zero-dependency HTTP client for Node.js. This guide covers
installation and the two ways to use it.

## Installation

```bash
npm install swiftly
```

Works on Node.js `>= 14.13`. Swiftly ships both ESM and CommonJS builds.

## CommonJS

```js
const swiftly = require('swiftly');

const data = await swiftly.get('https://example.com/api');
```

## ESM

```js
import swiftly from 'swiftly';

const data = await swiftly.get('https://example.com/api');
```

## Two API styles

### 1. One-off static calls

Great for quick scripts. All static calls share a single internal client, so
connection pooling, cookies and cache are reused.

```js
await swiftly.get(url);
await swiftly.post(url, body);
await swiftly.put(url, body);
await swiftly.patch(url, body);
await swiftly.delete(url);
```

### 2. A configured client instance

Best for applications that talk to one or more APIs repeatedly.

```js
const api = swiftly({
    baseURL: 'https://api.example.com',
    timeout: 10000,
    headers: { 'X-App-Key': process.env.API_KEY }
});

const users = await api.get('/users');
const me = users[0];
const posts = await api.get(`/users/${me.id}/posts`);
```

## Your first request

```js
const todo = await swiftly.get('https://jsonplaceholder.typicode.com/todos/1');

// resolves with the parsed body directly:
console.log(todo.title);   // "delectus aut autem"
console.log(todo.id);      // 1
```

That's it. See [Configuration](./configuration.md) for every option, or
[Features](./features.md) for retries, caching, GraphQL, scraping and more.