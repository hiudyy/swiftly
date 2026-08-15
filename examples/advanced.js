// Advanced usage: instance, interceptors, batch, download, events
import swiftly from '../index.mjs';

// Create a configured client instance
const api = swiftly({
    baseURL: 'https://jsonplaceholder.typicode.com',
    timeout: 10000,
    debug: false
});

// Interceptors
api.interceptors.request.use((cfg) => {
    cfg.headers = { ...cfg.headers, 'X-Client': 'swiftly' };
    return cfg;
});

// Event: request start
api.on('request:start', ({ url }) => {
    console.log(`[event] starting ${url}`);
});

// Batch requests
const [a, b, c] = await api.batch([
    { method: 'get', url: '/todos/1' },
    { method: 'get', url: '/todos/2' },
    { method: 'get', url: '/todos/3' }
]);
console.log('BATCH ->', [a.id, b.id, c.id]);

// Download a file as a Buffer
const buf = await api.download('/todos/1', { responseType: 'json' });
console.log('DOWNLOAD ->', Buffer.isBuffer(buf) ? `${buf.length} bytes` : buf.id);

// Metrics
console.log('METRICS ->', api.getMetrics().requestCount, 'requests');