import http from 'node:http';
import zlib from 'node:zlib';

export async function startServer() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const path = url.pathname;

        if (path === '/json') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, path, query: Object.fromEntries(url.searchParams) }));
            return;
        }

        if (path === '/text') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('hello world');
            return;
        }

        if (path === '/gzip') {
            const body = JSON.stringify({ compressed: true, data: 'x'.repeat(2048) });
            zlib.gzip(body, (err, zipped) => {
                res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' });
                res.end(zipped);
            });
            return;
        }

        if (path === '/redirect') {
            res.writeHead(302, { Location: '/json' });
            res.end();
            return;
        }

        if (path === '/redirect-loop') {
            res.writeHead(302, { Location: '/redirect-loop' });
            res.end();
            return;
        }

        if (path === '/error500') {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'boom' }));
            return;
        }

        if (path === '/client400') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'bad request' }));
            return;
        }

        if (path === '/slow') {
            setTimeout(() => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ slow: true }));
            }, 500);
            return;
        }

        if (path === '/echo') {
            let body = '';
            req.on('data', (c) => (body += c));
            req.on('end', () => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ method: req.method, body }));
            });
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return {
        port,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((resolve) => {
            // Destroy keep-alive sockets so server.close() doesn't hang on
            // pooled connections held by the client under test.
            if (typeof server.closeAllConnections === 'function') {
                server.closeAllConnections();
            }
            server.close(resolve);
        })
    };
}