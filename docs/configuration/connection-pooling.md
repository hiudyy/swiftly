# Connection pooling

Swiftly reuses TCP connections across requests using keep-alive agents, one
per origin. This dramatically reduces latency for repeated requests to the
same host.

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `keepAlive` | `true` | Reuse sockets. `false` disables pooling. |
| `maxSockets` | `Infinity` | Max concurrent sockets per origin. |
| `maxFreeSockets` | `256` | Idle sockets kept alive. |
| `keepAliveMsecs` | `1000` | Agent keep-alive socket time (ms). |
| `agent` | `null` | A custom `http.Agent` / `https.Agent`. |

## Defaults in practice

```js
const api = swiftly({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 256,
});
```

## Custom agent

Provide your own agent for full control. A custom agent **wins over pooling**
and is used as-is:

```js
import { Agent as HttpAgent } from 'node:http';

const api = swiftly({
  agent: new HttpAgent({ keepAlive: true, maxSockets: 50, scheduling: 'lifo' }),
});
```

## How pooling works

- A separate agent is created per `protocol://host:port` and per agent
  setting (`keepAlive`, `maxSockets`, `maxFreeSockets`).
- Agents are cached in the client's `connectionPool`.
- `api.close()` destroys every pooled agent.

## Monitoring

```js
const m = api.getMetrics();
console.log(m.pooledConnections); // number of pooled agents/origins
```

See [Metrics](../reference/metrics.md).

## Next steps

- [Compression](compression.md)
- [HTTP/2 and transport](http2-and-transport.md)