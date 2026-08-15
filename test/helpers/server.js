import http from 'node:http';
import zlib from 'node:zlib';

export async function startServer() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const path = url.pathname;
        const write = (status, headers, body) => {
            res.writeHead(status, headers);
            res.end(body);
        };
        const json = (status, obj, extra = {}) =>
            write(status, { 'Content-Type': 'application/json', ...extra }, JSON.stringify(obj));
        const collect = (cb) => {
            let body = '';
            req.on('data', (c) => (body += c));
            req.on('end', () => cb(body));
        };

        // Existing endpoints ----------------------------------------------------
        if (path === '/json') {
            json(200, { ok: true, path, query: Object.fromEntries(url.searchParams) });
            return;
        }
        if (path === '/text') {
            write(200, { 'Content-Type': 'text/plain' }, 'hello world');
            return;
        }
        if (path === '/gzip') {
            const body = JSON.stringify({ compressed: true, data: 'x'.repeat(2048) });
            zlib.gzip(body, (err, zipped) => {
                write(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, zipped);
            });
            return;
        }
        if (path === '/redirect') {
            write(302, { Location: '/json' });
            return;
        }
        if (path === '/redirect-loop') {
            write(302, { Location: '/redirect-loop' });
            return;
        }
        if (path === '/error500') {
            json(500, { error: 'boom' });
            return;
        }
        if (path === '/client400') {
            json(400, { error: 'bad request' });
            return;
        }
        if (path === '/slow') {
            setTimeout(() => json(200, { slow: true }), 500);
            return;
        }

        // Echo (any method) ----------------------------------------------------
        if (path === '/echo') {
            collect((body) => json(200, {
                method: req.method,
                body,
                contentType: req.headers['content-type'] || null,
                contentEncoding: req.headers['content-encoding'] || null,
                query: Object.fromEntries(url.searchParams)
            }));
            return;
        }

        // Echo request headers ------------------------------------------------
        if (path === '/headers') {
            json(200, { headers: req.headers });
            return;
        }

        // HTML -----------------------------------------------------------------
        if (path === '/html') {
            write(200, { 'Content-Type': 'text/html' },
                '<!DOCTYPE html><html><head><title>Page</title></head><body><h1>Hi</h1><p>Body</p></body></html>');
            return;
        }

        // Deflate / Brotli -----------------------------------------------------
        if (path === '/deflate') {
            const body = JSON.stringify({ compressed: 'deflate', data: 'y'.repeat(2048) });
            zlib.deflate(body, (err, zipped) => {
                write(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'deflate' }, zipped);
            });
            return;
        }
        if (path === '/br') {
            const body = JSON.stringify({ compressed: 'br', data: 'z'.repeat(2048) });
            zlib.brotliCompress(body, (err, zipped) => {
                write(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'br' }, zipped);
            });
            return;
        }

        // Redirect chains -------------------------------------------------------
        if (path === '/r1') { write(302, { Location: '/r2' }); return; }
        if (path === '/r2') { write(302, { Location: '/json' }); return; }

        // Generic status -------------------------------------------------------
        const statusMatch = path.match(/^\/status\/(\d+)$/);
        if (statusMatch) {
            const retry = url.searchParams.get('retry');
            const extra = retry ? { 'Retry-After': retry } : {};
            json(Number(statusMatch[1]), { code: Number(statusMatch[1]) }, extra);
            return;
        }

        // Cookies --------------------------------------------------------------
        if (path === '/setcookie') {
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Set-Cookie': 'sid=abc123; Path=/; HttpOnly',
                'Set-Cookie2': 'theme=dark; Path=/'
            });
            res.end(JSON.stringify({ ok: true }));
            return;
        }
        if (path === '/cookies') {
            json(200, { cookie: req.headers['cookie'] || null });
            return;
        }

        // Auth -----------------------------------------------------------------
        if (path === '/auth') {
            const auth = req.headers['authorization'];
            const expected = 'Basic ' + Buffer.from('user:pass').toString('base64');
            if (auth === expected) json(200, { ok: true, user: 'user' });
            else json(401, { error: 'unauthorized' });
            return;
        }

        // GraphQL echo ---------------------------------------------------------
        if (path === '/graphql') {
            collect((body) => {
                let parsed = {};
                try { parsed = JSON.parse(body || '{}'); } catch { /* ignore */ }
                json(200, { query: parsed.query, variables: parsed.variables || {} });
            });
            return;
        }

        // Large body for download ---------------------------------------------
        if (path === '/big') {
            write(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(100000) },
                Buffer.alloc(100000, 7));
            return;
        }

        // SSE ------------------------------------------------------------------
        if (path === '/sse') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive'
            });
            let n = 0;
            const timer = setInterval(() => {
                n++;
                res.write(`data: event-${n}\n\n`);
                if (n >= 3) {
                    clearInterval(timer);
                    res.end();
                }
            }, 20);
            req.on('close', () => clearInterval(timer));
            return;
        }

        // HEAD / OPTIONS already handled by method echo below; default 404
        if (path === '/method') {
            collect((body) => json(200, { method: req.method, body }));
            return;
        }

        json(404, { error: 'not found' });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return {
        port,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((resolve) => {
            if (typeof server.closeAllConnections === 'function') {
                server.closeAllConnections();
            }
            server.close(resolve);
        })
    };
}
