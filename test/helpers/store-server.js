/**
 * SwiftMart — a realistic e-commerce mock server used by the end-to-end
 * user-journey tests. Simulates a real production API:
 *
 *   - session auth (login/me/logout with cookies)
 *   - bearer-token auth (token endpoint + protected routes)
 *   - paginated/filterable catalog (JSON API + CSV export)
 *   - HTML storefront (catalog page + product pages with JSON-LD)
 *   - RSS / Atom / sitemap feeds
 *   - GraphQL gateway
 *   - SSE notifications, binary downloads
 *   - compression (gzip/deflate/br both directions)
 *   - flaky endpoints (503 storms, 429 + Retry-After), redirect chains
 *
 * Every request is counted (per pathname) so tests can assert cache/dedup
 * behavior from the server's point of view.
 */

import http from 'node:http';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// In-memory "database"
// ---------------------------------------------------------------------------

const CATEGORIES = ['gadgets', 'apparel', 'books', 'accessories'];
const ADJECTIVES = ['Swiftly', 'Turbo', 'Neo', 'Hyper', 'Quantum', 'Solar', 'Zen', 'Nova'];
const NOUNS = ['Mug', 'Hoodie', 'Keyboard', 'Mouse', 'Journal', 'Lamp', 'Bottle', 'Sticker Pack'];

const products = [];
for (let i = 1; i <= 24; i++) {
    const adj = ADJECTIVES[i % ADJECTIVES.length];
    const noun = NOUNS[i % NOUNS.length];
    products.push({
        id: `p${i}`,
        name: `${adj} ${noun} ${i}`,
        price: Number((9.99 + i * 3.37).toFixed(2)),
        category: CATEGORIES[i % CATEGORIES.length],
        inStock: i % 3 !== 0,
        rating: Number((3.5 + (i % 15) / 10).toFixed(1)),
        tags: [noun.toLowerCase(), adj.toLowerCase(), `tag${i % 4}`],
        description: `The ${adj.toLowerCase()} ${noun.toLowerCase()} — item #${i} from the SwiftMart catalog.`
    });
}

const users = new Map([
    ['alice@swiftly.dev', { email: 'alice@swiftly.dev', password: 'secret', name: 'Alice Admin', role: 'admin' }],
    ['bob@swiftly.dev', { email: 'bob@swiftly.dev', password: 'hunter2', name: 'Bob Shopper', role: 'customer' }]
]);

const sessions = new Map(); // sid -> email
const tokens = new Map();   // token -> email

// Flaky-endpoint failure counters, keyed by the test-provided `key` param.
const flakyFailures = new Map();

// Request hit counter: pathname (no query) -> { method -> count }
const hits = new Map();

function countHit(req) {
    const path = new URL(req.url, 'http://localhost').pathname;
    const m = req.method;
    if (!hits.has(path)) hits.set(path, new Map());
    const byMethod = hits.get(path);
    byMethod.set(m, (byMethod.get(m) || 0) + 1);
}

export function getHits(pathname) {
    const byMethod = hits.get(pathname);
    if (!byMethod) return 0;
    let total = 0;
    for (const n of byMethod.values()) total += n;
    return total;
}

export function resetHits() {
    hits.clear();
    flakyFailures.clear();
    sessions.clear();
    tokens.clear();
}

// ---------------------------------------------------------------------------
// Small routing helpers
// ---------------------------------------------------------------------------

const json = (res, status, obj, extra = {}) => {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
    res.end(body);
};

const writeBody = (res, status, headers, body) => {
    res.writeHead(status, headers);
    res.end(body);
};

const maybeCompress = (res, req, body, extraHeaders = {}) => {
    const accept = req.headers['accept-encoding'] || '';
    const raw = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const send = (encoding, buf) => {
        const headers = {
            'Content-Type': 'application/json; charset=utf-8',
            'Vary': 'Accept-Encoding',
            ...extraHeaders
        };
        if (encoding) headers['Content-Encoding'] = encoding;
        if (!extraHeaders['Content-Length']) headers['Content-Length'] = String(buf.length);
        res.writeHead(200, headers);
        res.end(buf);
    };
    if (raw.length >= 1024) {
        if (accept.includes('gzip')) {
            zlib.gzip(raw, (e, buf) => send('gzip', buf));
            return;
        }
        if (accept.includes('br')) {
            zlib.brotliCompress(raw, (e, buf) => send('br', buf));
            return;
        }
        if (accept.includes('deflate')) {
            zlib.deflate(raw, (e, buf) => send('deflate', buf));
            return;
        }
    }
    send(null, raw);
};

// Collect + (optionally) decompress a request body.
function readBody(req, cb) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
        let buf = Buffer.concat(chunks);
        const encoding = req.headers['content-encoding'];
        const finish = (b) => cb(b.toString('utf-8'), req.headers['content-encoding'] || null);
        if (!encoding || encoding === 'identity') return finish(buf);
        try {
            if (encoding === 'gzip') buf = zlib.gunzipSync(buf);
            else if (encoding === 'deflate') buf = zlib.inflateSync(buf);
            else if (encoding === 'br') buf = zlib.brotliDecompressSync(buf);
            finish(buf);
        } catch (e) {
            cb(null, encoding);
        }
    });
}

function readJson(req, cb) {
    readBody(req, (text) => {
        if (text === null || text.trim() === '') return cb({});
        try {
            cb(JSON.parse(text));
        } catch (e) {
            cb(null);
        }
    });
}

const requireBearer = (req, res, next) => {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const email = token ? tokens.get(token) : null;
    if (!email) {
        json(res, 401, { error: 'missing or invalid bearer token' });
        return null;
    }
    return email;
};

const requireSession = (req, res, next) => {
    const cookie = req.headers['cookie'] || '';
    const sid = cookie.split(';').map((p) => p.trim())
        .find((p) => p.startsWith('sid='));
    const email = sid ? sessions.get(sid.slice(4)) : null;
    if (!email) {
        json(res, 401, { error: 'not authenticated' });
        return null;
    }
    return email;
};

// Pagination/filtering over the product list.
function queryProducts(url) {
    const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
    const perPage = Math.min(50, parseInt(url.searchParams.get('per_page'), 10) || 10);
    const category = url.searchParams.get('category');
    const minPrice = url.searchParams.get('min_price');
    const maxPrice = url.searchParams.get('max_price');
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const sort = url.searchParams.get('sort') || 'id';
    const order = url.searchParams.get('order') === 'desc' ? -1 : 1;

    let items = products.slice();
    if (category) items = items.filter((p) => p.category === category);
    if (minPrice) items = items.filter((p) => p.price >= Number(minPrice));
    if (maxPrice) items = items.filter((p) => p.price <= Number(maxPrice));
    if (q) items = items.filter((p) => (p.name + p.description).toLowerCase().includes(q));
    items.sort((a, b) => {
        const av = a[sort];
        const bv = b[sort];
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * order;
        return String(av).localeCompare(String(bv)) * order;
    });

    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const start = (page - 1) * perPage;
    return { page, perPage, total, totalPages, items: items.slice(start, start + perPage) };
}

// HTML storefront rendering -------------------------------------------------

const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function renderCatalogPage() {
    const cards = products.map((p) => `
      <article class="product-card" data-id="${p.id}" data-category="${p.category}">
        <h2 class="product-name">${escapeHtml(p.name)}</h2>
        <span class="price" data-price="${p.price.toFixed(2)}">$${p.price.toFixed(2)}</span>
        <span class="stock ${p.inStock ? 'in' : 'out'}">${p.inStock ? 'In stock' : 'Out of stock'}</span>
        <a class="details-link" href="/product/${p.id}">View details</a>
      </article>`).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head><title>SwiftMart catalog</title><meta name="description" content="Everything the modern dev needs."></head>
<body>
  <nav><a href="/">Home</a> <a href="/catalog">Catalog</a> <a href="/feed.xml">RSS</a></nav>
  <main>
    <h1>Catalog</h1>
    <ul class="breadcrumbs"><li>Home</li><li>Catalog</li></ul>
    <div class="product-grid">${cards}</div>
  </main>
</body>
</html>`;
}

function renderProductPage(p) {
    const jsonLd = {
        '@context': 'https://schema.org/',
        '@type': 'Product',
        name: p.name,
        sku: p.id,
        category: p.category,
        offers: { '@type': 'Offer', price: p.price, availability: p.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' },
        aggregateRating: { '@type': 'AggregateRating', ratingValue: p.rating, reviewCount: 3 }
    };
    const reviews = [1, 2, 3].map((n) => `
      <li class="review"><span class="review-author">user${n}</span>
      <p class="review-body">Great ${p.category.toLowerCase()} item, would buy again (${n}/3).</p></li>`).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <title>${escapeHtml(p.name)} — SwiftMart</title>
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
  <main itemscope itemtype="https://schema.org/Product">
    <h1 class="product-title" itemprop="name">${escapeHtml(p.name)}</h1>
    <span class="price" itemprop="price" content="${p.price.toFixed(2)}">$${p.price.toFixed(2)}</span>
    <p class="description" itemprop="description">${escapeHtml(p.description)}</p>
    <ul class="tags">${p.tags.map((t) => `<li class="tag">${escapeHtml(t)}</li>`).join('')}</ul>
    <h2>Reviews</h2>
    <ul class="reviews">${reviews}</ul>
  </main>
</body>
</html>`;
}

function renderFeed(kind) {
    if (kind === 'atom') {
        const entries = products.slice(0, 5).map((p) => `
  <entry>
    <title>${escapeHtml(p.name)}</title>
    <link href="http://store.test/product/${p.id}"/>
    <id>urn:swiftmart:${p.id}</id>
    <updated>2024-06-01T10:00:00Z</updated>
    <summary>${escapeHtml(p.description)}</summary>
    <author><name>SwiftMart</name></author>
  </entry>`).join('\n');
        return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>SwiftMart new arrivals</title>
  <id>urn:swiftmart:feed</id>
  <updated>2024-06-01T10:00:00Z</updated>
  <link href="http://store.test/"/>
${entries}
</feed>`;
    }
    const items = products.slice(0, 5).map((p) => `
    <item>
      <title>${escapeHtml(p.name)}</title>
      <link>http://store.test/product/${p.id}</link>
      <guid isPermaLink="false">${p.id}</guid>
      <pubDate>Mon, 01 Jun 2024 10:00:00 GMT</pubDate>
      <description>${escapeHtml(p.description)}</description>
      <category>${p.category}</category>
      <dc:creator>SwiftMart</dc:creator>
    </item>`).join('\n');
    return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>SwiftMart new arrivals</title>
    <link>http://store.test/</link>
    <description>Fresh products from SwiftMart</description>
${items}
  </channel>
</rss>`;
}

function renderSitemap() {
    const urls = products.map((p) => `
  <url><loc>http://store.test/product/${p.id}</loc><lastmod>2024-06-01</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`).join('\n');
    return `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

function renderCSV() {
    const header = 'id,name,price,category,inStock';
    const rows = products.map((p) => `${p.id},"${p.name.replace(/"/g, '""')}",${p.price},${p.category},${p.inStock}`);
    return [header, ...rows].join('\n');
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export async function startStoreServer() {
    const server = http.createServer((req, res) => {
        countHit(req);
        const url = new URL(req.url, 'http://localhost');
        const path = url.pathname;

        // ---- Auth: sessions -------------------------------------------------
        if (path === '/api/login' && req.method === 'POST') {
            return readJson(req, (body) => {
                const user = body && users.get(body.email);
                if (!user || user.password !== body.password) {
                    return json(res, 401, { error: 'invalid credentials' });
                }
                const sid = crypto.randomBytes(16).toString('hex');
                sessions.set(sid, user.email);
                res.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Set-Cookie': `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`
                });
                res.end(JSON.stringify({ email: user.email, name: user.name, role: user.role }));
            });
        }
        if (path === '/api/logout' && req.method === 'POST') {
            const cookie = req.headers['cookie'] || '';
            const sid = cookie.split(';').map((p) => p.trim()).find((p) => p.startsWith('sid='));
            if (sid) sessions.delete(sid.slice(4));
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Set-Cookie': 'sid=; Path=/; HttpOnly; Max-Age=0'
            });
            return res.end(JSON.stringify({ ok: true }));
        }
        if (path === '/api/me') {
            const email = requireSession(req, res);
            if (!email) return;
            const u = users.get(email);
            return json(res, 200, { email, name: u.name, role: u.role });
        }

        // ---- Auth: bearer tokens --------------------------------------------
        if (path === '/api/token' && req.method === 'POST') {
            return readJson(req, (body) => {
                const user = body && users.get(body.email);
                if (!user || user.password !== body.password) {
                    return json(res, 401, { error: 'invalid credentials' });
                }
                const token = crypto.randomBytes(24).toString('hex');
                tokens.set(token, user.email);
                json(res, 200, { token, expires_in: 3600 });
            });
        }
        if (path === '/api/account') {
            const email = requireBearer(req, res);
            if (!email) return;
            const u = users.get(email);
            return json(res, 200, { email, name: u.name, role: u.role, plan: 'pro' });
        }

        // ---- Tenant isolation probe -------------------------------------------
        if (path === '/api/tenant') {
            const email = requireBearer(req, res);
            if (!email) return;
            return json(res, 200, { tenant: email, plan: email === 'alice@swiftly.dev' ? 'pro' : 'free' });
        }

        // ---- Catalog: JSON API -------------------------------------------------
        if (path === '/api/products' && req.method === 'GET') {
            const result = queryProducts(url);
            const body = JSON.stringify({ ...result, source: 'api' });
            return maybeCompress(res, req, body);
        }
        if (path === '/api/products' && req.method === 'POST') {
            const email = requireBearer(req, res);
            if (!email) return;
            return readJson(req, (body) => {
                if (!body || !body.name || typeof body.price !== 'number') {
                    return json(res, 422, { error: 'name (string) and price (number) are required' });
                }
                const id = `p${products.length + 1}`;
                const product = {
                    id,
                    name: body.name,
                    price: body.price,
                    category: body.category || 'accessories',
                    inStock: body.inStock !== false,
                    rating: 0,
                    tags: body.tags || [],
                    description: body.description || ''
                };
                products.push(product);
                json(res, 201, product);
            });
        }
        const productMatch = path.match(/^\/api\/products\/(p\d+)$/);
        if (productMatch) {
            const product = products.find((p) => p.id === productMatch[1]);
            if (!product) return json(res, 404, { error: 'product not found' });
            if (req.method === 'GET') {
                const body = JSON.stringify({ ...product, source: 'api' });
                return maybeCompress(res, req, body);
            }
            if (req.method === 'PATCH') {
                const email = requireBearer(req, res);
                if (!email) return;
                return readJson(req, (body) => {
                    Object.assign(product, body);
                    json(res, 200, product);
                });
            }
            if (req.method === 'DELETE') {
                const email = requireBearer(req, res);
                if (!email) return;
                const idx = products.indexOf(product);
                products.splice(idx, 1);
                return json(res, 200, { deleted: product.id });
            }
        }
        if (path === '/api/products.csv') {
            res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' });
            return res.end(renderCSV());
        }
        const reviewsMatch = path.match(/^\/api\/products\/(p\d+)\/reviews$/);
        if (reviewsMatch && req.method === 'GET') {
            const product = products.find((p) => p.id === reviewsMatch[1]);
            if (!product) return json(res, 404, { error: 'product not found' });
            return json(res, 200, {
                productId: product.id,
                reviews: [
                    { id: 1, author: 'user1', rating: 5, body: 'Excellent.' },
                    { id: 2, author: 'user2', rating: 4, body: 'Good value.' }
                ]
            });
        }

        // ---- API envelope (for response-interceptor tests) ---------------------
        if (path === '/api/envelope') {
            return json(res, 200, { ok: true, data: { version: '2.4.1', env: 'production' } });
        }

        // ---- Echo / headers ----------------------------------------------------
        if (path === '/api/echo') {
            return readBody(req, (body, encoding) => {
                let parsed = null;
                try { parsed = body ? JSON.parse(body) : null; } catch { /* raw */ }
                json(res, 200, {
                    method: req.method,
                    path,
                    query: Object.fromEntries(url.searchParams),
                    contentType: req.headers['content-type'] || null,
                    contentEncoding: encoding,
                    body: parsed === null ? body : parsed,
                    userAgent: req.headers['user-agent'] || null
                });
            });
        }
        if (path === '/api/headers') {
            return json(res, 200, { headers: req.headers });
        }

        // ---- Compression probes -------------------------------------------------
        const compressedMatch = path.match(/^\/api\/compressed\/(gzip|deflate|br)$/);
        if (compressedMatch) {
            const body = JSON.stringify({ ok: true, type: compressedMatch[1], data: 'x'.repeat(4096) });
            const encode = {
                gzip: (b, cb) => zlib.gzip(b, cb),
                deflate: (b, cb) => zlib.deflate(b, cb),
                br: (b, cb) => zlib.brotliCompress(b, cb)
            }[compressedMatch[1]];
            return encode(Buffer.from(body), (err, buf) => {
                if (err) return json(res, 500, { error: 'compress failed' });
                writeBody(res, 200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Encoding': compressedMatch[1],
                    'Content-Length': String(buf.length)
                }, buf);
            });
        }

        // ---- Redirects -----------------------------------------------------------
        const redirectMatch = path.match(/^\/api\/redirect\/(\d+)$/);
        if (redirectMatch) {
            const hops = Number(redirectMatch[1]);
            if (hops <= 1) {
                res.writeHead(302, { Location: '/api/products?page=1&per_page=3' });
                return res.end();
            }
            res.writeHead(302, { Location: `/api/redirect/${hops - 1}` });
            return res.end();
        }
        if (path === '/api/redirect/loop') {
            res.writeHead(302, { Location: '/api/redirect/loop' });
            return res.end();
        }

        // ---- Flaky / limited / slow / error -------------------------------------
        if (path === '/api/flaky') {
            const key = url.searchParams.get('key') || 'default';
            const fails = parseInt(url.searchParams.get('fails'), 10) || 1;
            const count = (flakyFailures.get(key) || 0) + 1;
            flakyFailures.set(key, count);
            if (count <= fails) {
                return json(res, 503, { error: 'upstream unavailable', attempt: count });
            }
            return json(res, 200, { ok: true, attempts: count });
        }
        if (path === '/api/limited') {
            return json(res, 429, { error: 'slow down' }, { 'Retry-After': '1' });
        }
        const slowMatch = path.match(/^\/api\/slow$/);
        if (slowMatch) {
            const ms = parseInt(url.searchParams.get('ms'), 10) || 1000;
            return setTimeout(() => json(res, 200, { slow: true, ms }), ms);
        }
        const errorMatch = path.match(/^\/api\/error\/(\d+)$/);
        if (errorMatch) {
            const code = Number(errorMatch[1]);
            return json(res, code, { error: `simulated HTTP ${code}`, code });
        }

        // ---- Files ----------------------------------------------------------------
        const fileMatch = path.match(/^\/files\/(.+)$/);
        if (fileMatch && req.method === 'GET') {
            const name = fileMatch[1];
            if (name === 'photo.png') {
                const content = Buffer.alloc(64 * 1024, 0xAB);
                return writeBody(res, 200, {
                    'Content-Type': 'image/png',
                    'Content-Length': String(content.length),
                    'Content-Disposition': `attachment; filename="${name}"`
                }, content);
            }
            if (name === 'catalog.json') {
                const body = JSON.stringify(products.slice(0, 5));
                return writeBody(res, 200, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) }, body);
            }
            return json(res, 404, { error: 'file not found' });
        }

        // ---- SSE -------------------------------------------------------------------
        if (path === '/api/notifications') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive'
            });
            let n = 0;
            const timer = setInterval(() => {
                n++;
                res.write(`data: ${JSON.stringify({ seq: n, type: 'stock-update', at: Date.now() })}\n\n`);
                if (n >= 5) {
                    clearInterval(timer);
                    res.end();
                }
            }, 15);
            req.on('close', () => clearInterval(timer));
            return;
        }
        if (path === '/api/notifications-secure') {
            const email = requireBearer(req, res);
            if (!email) return;
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive'
            });
            let n = 0;
            const timer = setInterval(() => {
                n++;
                res.write(`data: ${JSON.stringify({ seq: n, tenant: email })}\n\n`);
                if (n >= 3) {
                    clearInterval(timer);
                    res.end();
                }
            }, 15);
            req.on('close', () => clearInterval(timer));
            return;
        }

        // ---- GraphQL -----------------------------------------------------------------
        if (path === '/graphql' && req.method === 'POST') {
            return readJson(req, (body) => {
                const q = (body && body.query) || '';
                if (q.includes('products')) {
                    const items = products.slice(0, 5).map((p) => ({ id: p.id, name: p.name, price: p.price }));
                    return json(res, 200, { data: { products: items } });
                }
                const single = q.match(/product\(id:\s*"([^"]+)"\)/);
                if (single) {
                    const p = products.find((x) => x.id === single[1]);
                    if (!p) return json(res, 200, { data: { product: null } });
                    return json(res, 200, { data: { product: { id: p.id, name: p.name, price: p.price, category: p.category } } });
                }
                if (q.includes('me')) {
                    const email = requireBearer(req, res);
                    if (!email) return;
                    const u = users.get(email);
                    return json(res, 200, { data: { me: { email, name: u.name } } });
                }
                return json(res, 200, {
                    data: null,
                    errors: [{ message: `Cannot query field '${q}'`, locations: [{ line: 1, column: 1 }] }]
                });
            });
        }

        // ---- HTML storefront ----------------------------------------------------------
        if (path === '/') {
            return writeBody(res, 200, { 'Content-Type': 'text/html; charset=utf-8' },
                '<!DOCTYPE html><html><head><title>SwiftMart</title></head><body><h1>SwiftMart</h1><a href="/catalog">Catalog</a></body></html>');
        }
        if (path === '/catalog') {
            return writeBody(res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, renderCatalogPage());
        }
        const pageMatch = path.match(/^\/product\/(p\d+)$/);
        if (pageMatch) {
            const product = products.find((p) => p.id === pageMatch[1]);
            if (!product) return writeBody(res, 404, { 'Content-Type': 'text/html' }, '<h1>Not found</h1>');
            return writeBody(res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, renderProductPage(product));
        }

        // ---- Feeds ----------------------------------------------------------------------
        if (path === '/feed.xml') {
            return writeBody(res, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' }, renderFeed('rss'));
        }
        if (path === '/feed.atom') {
            return writeBody(res, 200, { 'Content-Type': 'application/atom+xml; charset=utf-8' }, renderFeed('atom'));
        }
        if (path === '/sitemap.xml') {
            return writeBody(res, 200, { 'Content-Type': 'application/xml; charset=utf-8' }, renderSitemap());
        }

        // ---- Misc ------------------------------------------------------------------------
        if (path === '/api/version') {
            return json(res, 200, { version: '2.4.1', name: 'swiftmart-api' });
        }

        json(res, 404, { error: 'not found' });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return {
        port,
        url: `http://127.0.0.1:${port}`,
        getHits,
        resetHits,
        close: () => new Promise((resolve) => {
            if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
            server.close(resolve);
        })
    };
}
