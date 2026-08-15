// Swiftly benchmark — dedicated HTTP server child process.
// Runs fully isolated from the measured workers so server processing/latency
// never contaminates client timings. Latency is injected via BENCH_SERVER_LATENCY.
// Prints "PORT <n>" on stdout.
import http from 'node:http';
import zlib from 'node:zlib';

const latency = parseInt(process.env.BENCH_SERVER_LATENCY || '0', 10) || 0;
const failMap = new Map();

function respond(res, status, headers, body) {
    const done = () => { res.writeHead(status, headers); res.end(body); };
    if (latency > 0) setTimeout(done, latency);
    else done();
}

const server = http.createServer((req, res) => {
    const url = req.url || '/';
    if (url === '/json' || url.startsWith('/json?') || url.startsWith('/json/')) {
        return respond(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify({ ok: true, id: url, data: 'x'.repeat(64) }));
    }
    if (url === '/big') {
        return respond(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify({ ok: true, items: new Array(2000).fill({ id: 1, name: 'x'.repeat(40) }) }));
    }
    if (url === '/text') {
        return respond(res, 200, { 'Content-Type': 'text/plain' }, 'x'.repeat(256));
    }
    if (url === '/gzip') {
        return respond(res, 200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, zlib.gzipSync(JSON.stringify({ ok: true, data: 'x'.repeat(256) })));
    }
    if (url === '/bin') {
        return respond(res, 200, { 'Content-Type': 'application/octet-stream' }, Buffer.alloc(1024, 7));
    }
    if (url === '/html') {
        const cards = new Array(20).fill('<div class="card"><h3 class="title">Product</h3><p class="price">$19.99</p></div>').join('\n');
        return respond(res, 200, { 'Content-Type': 'text/html' }, `<!DOCTYPE html><html><head><title>Shop</title></head><body><h1 id="main">Products</h1>${cards}</body></html>`);
    }
    if (url === '/post' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => respond(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify({ received: body.length, ok: true })));
        return;
    }
    if (url === '/upload' && req.method === 'POST') {
        let size = 0;
        req.on('data', (c) => (size += c.length));
        req.on('end', () => respond(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify({ uploaded: size, ok: true })));
        return;
    }
    if (url.startsWith('/flaky/')) {
        const id = url.split('/')[2];
        // Each unique id fails exactly once (the first request), then succeeds.
        if (!failMap.has(id)) failMap.set(id, 1);
        if (failMap.get(id) > 0) {
            failMap.set(id, 0);
            return respond(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'boom' }));
        }
        return respond(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify({ ok: true }));
    }
    respond(res, 404, {}, 'not found');
});

server.keepAliveTimeout = 60000;
server.headersTimeout = 65000;

await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.stdout.write(`PORT ${server.address().port}\n`);
process.stdout.on('error', () => process.exit(0));

process.on('SIGTERM', () => server.close(() => process.exit(0)));