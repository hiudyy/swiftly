/**
 * Stress battery — pushes every public parsing/extraction/client feature with
 * malformed, giant, polluted and adversarial inputs. The parsers are expected
 * to be tolerant: they must never throw, hang, or overflow on garbage.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseHTML, extractDocumentText, decodeEntities, encodeEntities } from '../lib/scraper.js';
import {
    parseXML,
    parseXMLTree,
    xmlToString,
    parseRSS,
    parseAtom,
    parseSitemap
} from '../lib/xml.js';
import { parseCSV, toCSV } from '../lib/csv.js';
import { queryJSON } from '../lib/jsonpath.js';
import {
    extractLinks,
    extractImages,
    extractText,
    extractMeta,
    extractTables,
    extractForms,
    extractJsonLd,
    extractJSON,
    sanitizeHtml,
    htmlToMarkdown
} from '../lib/extract.js';
import { createClient } from '../lib/client.js';
import { createCookieJar } from '../lib/interceptor.js';
import { startServer } from './helpers/server.js';

let srv;
const clients = [];

beforeAll(async () => {
    srv = await startServer();
});

afterAll(async () => {
    for (const c of clients) {
        try { await c.close(); } catch { /* ignore */ }
    }
    await srv.close();
});

const mk = (cfg = {}) => {
    const c = createClient({ debug: false, cache: { enabled: false }, ...cfg });
    clients.push(c);
    return c;
};

// ---------------------------------------------------------------------------
// HTML parser stress
// ---------------------------------------------------------------------------

describe('stress: HTML parser', () => {
    it('handles deeply nested documents without stack overflow', () => {
        const depth = 5000;
        const html = '<div>'.repeat(depth) + 'x' + '</div>'.repeat(depth);
        const els = parseHTML(html, 'div');
        expect(els.length).toBe(depth);
        expect(extractDocumentText(html)).toBe('x');
    });

    it('handles a giant document', () => {
        const rows = [];
        for (let i = 0; i < 10000; i++) {
            rows.push(`<tr><td>${i}</td><td><a href="/p/${i}">link ${i}</a></td></tr>`);
        }
        const html = `<table>${rows.join('')}</table>`;
        const links = parseHTML(html, 'a[href]');
        expect(links.length).toBe(10000);
        expect(links[9999].attr('href')).toBe('/p/9999');
    });

    it('survives malformed soup (stray <, unclosed tags, garbage)', () => {
        const html = `
            <div><p>one<div><p>two</div>
            < 3 < 4 <<div><span>x
            <div a=1 b='2' c="3>4" d e=f>
            </div>
            <p id="a"><p id="b">text
            <foo><bar><baz>deep
            <div><ul><li>a<li>b<li>c</ul></div>
            <table><tr><td>1<td>2</table>
        `;
        expect(() => parseHTML(html, 'div, p, li, td')).not.toThrow();
        expect(() => extractDocumentText(html)).not.toThrow();
    });

    it('does not crash on numeric entities out of range', () => {
        for (const entity of ['&#999999999999999;', '&#xFFFFFFFF;', '&#x110000;', '&#0;', '&#xD800;']) {
            const text = extractDocumentText(`<p>${entity}</p>`);
            expect(text.includes('\uFFFD')).toBe(true);
        }
    });

    it('keeps invalid named entities literal', () => {
        expect(extractDocumentText('<p>&bogus; &amp; &lt;</p>')).toBe('&bogus; & <');
    });

    it('decodeEntities round-trips special characters', () => {
        const s = '<tag attr="a&b">\u00e9\u4e2d\u6587\u{1F600}</tag>';
        expect(decodeEntities(encodeEntities(s))).toBe(s);
    });

    it('tolerates NUL bytes and a BOM', () => {
        const html = '\uFEFF<p>a\u0000b</p>';
        expect(() => parseHTML(html, 'p')).not.toThrow();
        expect(extractDocumentText(html)).toBe('a\u0000b');
    });

    it('handles script/style content containing tags', () => {
        // Like browsers: a literal </script> inside a JS string ends the block
        // (writers escape it as <\/script>). Both forms must not crash.
        const html = '<script>if (a < b) { x = "<\\/script>"; }</script><p>ok</p><style>div > span { color: red; }</style>';
        expect(() => parseHTML(html, 'p')).not.toThrow();
        expect(extractDocumentText(html)).toBe('ok');
        const nasty = '<script>var s = "</script>";</script>';
        expect(() => extractDocumentText(nasty)).not.toThrow();
    });

    it('treats comments containing > correctly', () => {
        const html = '<p>before<!-- a > b -->after</p>';
        expect(extractDocumentText(html)).toBe('beforeafter');
    });

    it('never throws on garbage selectors', () => {
        const html = '<div><p class="x">hi</p></div>';
        for (const sel of ['!!!', '[', 'div >>> p', ':nth-child(', 'a[b="c>d"]', '', ' ', 'div,', ',div', 'div:nth-child(2n+1)', 'p:not(.y)', 'p:has(span)']) {
            expect(() => parseHTML(html, sel)).not.toThrow();
        }
    });

    it('rejects non-string HTML with a clear error', () => {
        expect(() => parseHTML(42, 'p')).toThrow(/string or Buffer/);
        expect(() => parseHTML(null, 'p')).toThrow(/string or Buffer/);
    });

    it('parses attributes without quotes and boolean attributes', () => {
        const html = '<div a=1 b c="x y" d=\'z\'>t</div>';
        const [el] = parseHTML(html, 'div');
        expect(el.attr('a')).toBe('1');
        expect(el.attr('b')).toBe('');
        expect(el.attr('c')).toBe('x y');
        expect(el.attr('d')).toBe('z');
    });

    it('is not vulnerable to entity expansion bombs (no expansion loops)', () => {
        // Nested entities are decoded once; they never recursively expand.
        const bomb = '&amp;'.repeat(5000);
        const text = extractDocumentText(`<p>${bomb}</p>`);
        expect(text).toBe('&'.repeat(5000));
    });
});

// ---------------------------------------------------------------------------
// XML stress
// ---------------------------------------------------------------------------

describe('stress: XML parser', () => {
    it('handles deeply nested documents without stack overflow', () => {
        const depth = 20000;
        const xml = '<a>'.repeat(depth) + 'x' + '</a>'.repeat(depth);
        expect(() => parseXML(xml)).not.toThrow();
        expect(() => parseXMLTree(xml)).not.toThrow();
    });

    it('handles a giant document', () => {
        const items = [];
        for (let i = 0; i < 10000; i++) items.push(`<item id="${i}"><name>n${i}</name></item>`);
        const obj = parseXML(`<root>${items.join('')}</root>`);
        expect(obj.item.length).toBe(10000);
        expect(obj.item[0].$.id).toBe('0');
        expect(obj.item[9999].name['#text']).toBe('n9999');
    });

    it('skips DOCTYPE variants (SYSTEM, PUBLIC, internal subset)', () => {
        const variants = [
            '<!DOCTYPE rss SYSTEM "http://example.com/rss.dtd"><rss><channel/></rss>',
            '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd"><html><body/></html>',
            '<!DOCTYPE foo [<!ENTITY a "1"> <!ENTITY b SYSTEM "file:///etc/passwd">]><root><a>1</a></root>'
        ];
        for (const xml of variants) {
            expect(() => parseXML(xml)).not.toThrow();
        }
        expect(parseXML(variants[2])).toEqual({ a: { '#text': '1' } });
    });

    it('never expands entities (XXE-immune)', () => {
        const xml = '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><root><a>&xxe;</a></root>';
        // No expansion: the entity reference is kept as literal text.
        const obj = parseXML(xml);
        expect(obj.a['#text']).toContain('&xxe;');
    });

    it('tolerates malformed structure', () => {
        const inputs = [
            '', '   ', '<?xml version="1.0"?>', '<root>', '<root></wrong>',
            '<a><b></a></b>', '<a/>', '<a/><b/>', '<root a="1" b=\'2\' c>',
            'garbage without tags', '<root>&#xFFFFFFFF;</root>',
            '<root><a>text with <b>nested</a></root>',
            '<!-- unclosed comment <root>x</root>',
            '<![CDATA[ raw <not-a-tag> & stuff ]]>'
        ];
        for (const xml of inputs) {
            expect(() => parseXML(xml), `input: ${JSON.stringify(xml)}`).not.toThrow();
        }
    });

    it('parses CDATA, PIs and comments with special chars', () => {
        const xml = '<?xml version="1.0"?><!-- a > b --><root><a><![CDATA[<b>&c</b>]]></a></root>';
        const obj = parseXML(xml);
        expect(obj.a['#text']).toBe('<b>&c</b>');
    });

    it('out-of-range numeric entities in attributes become U+FFFD', () => {
        const obj = parseXML('<root a="&#999999999999999;" b="&#x110000;"/>');
        expect(obj.$.a).toBe('\uFFFD');
        expect(obj.$.b).toBe('\uFFFD');
    });

    it('feed helpers return empty results on garbage instead of throwing', () => {
        for (const garbage of ['', '<div>nope</div>', 'random text', '<rss>', '<?xml?><channel/>']) {
            expect(() => parseRSS(garbage)).not.toThrow();
            expect(() => parseAtom(garbage)).not.toThrow();
            expect(() => parseSitemap(garbage)).not.toThrow();
        }
    });

    it('xmlToString round-trips gnarly objects', () => {
        // Note: #text is kept verbatim by parseXML (no decoding), so only
        // attribute values with special chars round-trip as themselves.
        const obj = {
            $: { version: '2.0', weird: 'a>b&c' },
            '#text': 'plain text',
            item: [
                { $: { id: '1' }, '#text': 'one' },
                { $: { id: '2' }, title: { '#text': 'two and three' } }
            ],
            empty: {}
        };
        const xml = xmlToString(obj, 'root');
        const back = parseXML(xml);
        expect(back).toEqual(obj);
        // Escaped text is serialized verbatim (not decoded on re-parse).
        const escaped = parseXML(xmlToString({ '#text': 'a & b < c' }, 'root'));
        expect(escaped['#text']).toBe('a &amp; b &lt; c');
    });
});

// ---------------------------------------------------------------------------
// CSV stress
// ---------------------------------------------------------------------------

describe('stress: CSV', () => {
    it('parses a giant file', () => {
        const lines = ['id,name,score'];
        for (let i = 0; i < 20000; i++) lines.push(`${i},"name ${i}","${i % 100}"`);
        const rows = parseCSV(lines.join('\n'));
        expect(rows.length).toBe(20000);
        expect(rows[0]).toEqual({ id: '0', name: 'name 0', score: '0' });
        expect(rows[19999].name).toBe('name 19999');
    });

    it('tolerates malformed quoting without throwing', () => {
        const inputs = [
            'a,b\n1,"unclosed',
            'a,b\n"one",two"three',
            'a,b\n1,2\n3,"4',
            '"unclosed at start,1',
            'a,b\n"",2',
            'a,b\n1,"multi\nline",3',
            'a,b\r\n1,2\r3,4',
            '\uFEFFa,b\n1,2',
            'a,b\n1,\u00002'
        ];
        for (const input of inputs) {
            expect(() => parseCSV(input), `input: ${JSON.stringify(input)}`).not.toThrow();
        }
    });

    it('documents quote-in-middle-of-field behavior', () => {
        expect(parseCSV('a\nfoo"bar",baz')).toEqual([{ a: 'foobar' }]);
    });

    it('preserves duplicate headers as arrays (no silent loss)', () => {
        expect(parseCSV('a,a,b\n1,2,3')).toEqual([{ a: ['1', '2'], b: '3' }]);
        expect(parseCSV('a,b,a\n1,2,3')).toEqual([{ a: ['1', '3'], b: '2' }]);
    });

    it('handles unicode, empty fields and trailing delimiters', () => {
        expect(parseCSV('a,b,c\n\u4e2d\u6587,,3,')).toEqual([{ a: '\u4e2d\u6587', b: '', c: '3' }]);
    });

    it('toCSV round-trips nasty values', () => {
        const data = [
            { a: 'with,comma', b: 'with"quote', c: 'with\nnewline', d: 'with\r\ncrlf', e: '\u00e9\u4e2d\u6587' },
            { a: '', b: null, c: 'x', d: 'y', e: 'z' }
        ];
        const csv = toCSV(data);
        const back = parseCSV(csv);
        expect(back).toEqual(data.map(r => ({
            a: r.a, b: String(r.b ?? ''), c: r.c, d: r.d, e: r.e
        })));
    });

    it('array mode returns every row including the header line', () => {
        const rows = parseCSV('a,b\n1,2\n3,4\n5,6', { header: false });
        expect(rows.length).toBe(4);
        expect(rows.every(r => r.length === 2)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// JSONPath stress
// ---------------------------------------------------------------------------

describe('stress: JSONPath', () => {
    const data = {
        user: { name: 'Ana', tags: ['a', 'b', 'c'], profile: { age: 30 } },
        items: [
            { id: 1, meta: { x: 10 } },
            { id: 2, meta: { x: 20 } },
            { id: 3, meta: { x: 30 } }
        ],
        'weird key': 'value',
        matrix: [[1, 2], [3, 4]]
    };

    it('handles garbage paths without throwing', () => {
        for (const p of ['', '..', '...', '[', '[]', 'a[', 'a]', '!!!', 'user..name', 'a.b.', '.a.b', '[*][*]']) {
            expect(() => queryJSON(data, p), `path: ${JSON.stringify(p)}`).not.toThrow();
        }
    });

    it('resolves dot/bracket/wildcard/negative-index paths', () => {
        expect(queryJSON(data, 'user.name')).toBe('Ana');
        expect(queryJSON(data, 'items[0].id')).toBe(1);
        expect(queryJSON(data, 'items[*].id')).toEqual([1, 2, 3]);
        expect(queryJSON(data, 'items[-1].id')).toBe(3);
        expect(queryJSON(data, 'user.tags[1]')).toBe('b');
        expect(queryJSON(data, "['weird key']")).toBe('value');
        expect(queryJSON(data, 'items[*].meta.x')).toEqual([10, 20, 30]);
        expect(queryJSON(data, 'user.*')).toEqual(['Ana', ['a', 'b', 'c'], { age: 30 }]);
    });

    it('falls back for missing paths and returns undefined for primitives', () => {
        expect(queryJSON(data, 'missing.deep', 'FB')).toBe('FB');
        expect(queryJSON(data, 'user.name.more', 'FB')).toBe('FB');
        expect(queryJSON(data, 'user.tags[99]', 'FB')).toBe('FB');
        expect(queryJSON(data, 'user.name')).toBe('Ana');
    });

    it('does not blow up on huge arrays', () => {
        const big = { list: Array.from({ length: 100000 }, (_, i) => ({ v: i })) };
        const out = queryJSON(big, 'list[*].v');
        expect(out.length).toBe(100000);
        expect(out[99999]).toBe(99999);
    });
});

// ---------------------------------------------------------------------------
// Extraction stress
// ---------------------------------------------------------------------------

describe('stress: extraction suite', () => {
    const messy = `
        <!DOCTYPE html><html><head><title>T</title></head><body>
        <a href="/a">A</a><a href="/a">dup</a><a HREF="/b">B</a><a href="javascript:alert(1)">bad</a>
        <img src="/i.png" alt="I"><img src="/j.png">
        <table><tr><th>H1</th><th>H2</th></tr><tr><td>1</td><td>2</td></tr></table>
        <form action="/f" method="post"><input name="q" type="text" value="v"><textarea name="t">hi</textarea></form>
        <script type="application/ld+json">{"@type":"Thing"}</script>
        <script type="application/ld+json">not json</script>
        <script type="application/json">{"k":1}</script>
        <script>var x = { a: 1 };</script>
        <div onclick="evil()"><script>bad()</script>keep me<!-- c --></div>
        <p>a <b>b</b> <em>c</em></p>
        `;

    it('never throws on polluted HTML', () => {
        expect(() => extractLinks(messy)).not.toThrow();
        expect(() => extractImages(messy)).not.toThrow();
        expect(() => extractText(messy)).not.toThrow();
        expect(() => extractMeta(messy)).not.toThrow();
        expect(() => extractTables(messy)).not.toThrow();
        expect(() => extractForms(messy)).not.toThrow();
        expect(() => extractJsonLd(messy)).not.toThrow();
        expect(() => extractJSON(messy)).not.toThrow();
        expect(() => sanitizeHtml(messy)).not.toThrow();
        expect(() => htmlToMarkdown(messy)).not.toThrow();
    });

    it('extractLinks dedupes and resolves', () => {
        const links = extractLinks(messy, 'https://site.example/base/');
        expect(links.map(l => l.href)).toEqual(['/a', '/b', 'javascript:alert(1)']);
        expect(links[0].url).toBe('https://site.example/a');
    });

    it('extractText strips script/style and decodes entities', () => {
        expect(extractText('<div>keep<script>drop()</script><style>x{}</style></div>')).toBe('keep');
        expect(extractText('<p>&amp; &lt; &gt; &quot; &apos;</p>')).toBe('& < > " \'');
    });

    it('extractJsonLd skips invalid blocks', () => {
        const ld = extractJsonLd(messy);
        expect(ld).toEqual([{ '@type': 'Thing' }]);
    });

    it('extractJSON prefers typed blocks then falls back to scripts', () => {
        expect(extractJSON(messy)).toEqual([{ k: 1 }]);
        expect(extractJSON('<script>{"a":1}</script>')).toEqual([{ a: 1 }]);
    });

    it('sanitizeHtml removes scripts/comments/handlers and javascript: urls', () => {
        const clean = sanitizeHtml(messy);
        expect(clean).not.toMatch(/<script/i);
        expect(clean).not.toContain('<!--');
        expect(clean).not.toMatch(/onclick/i);
        expect(clean).not.toContain('javascript:');
        expect(clean).toContain('keep me');
    });

    it('sanitizeHtml stays linear on pathological input', () => {
        const nasty = '<p>ok</p>' + '<script>alert(1)'.repeat(20000) + '<p>end</p>';
        const t0 = Date.now();
        const out = sanitizeHtml(nasty);
        expect(Date.now() - t0).toBeLessThan(2000);
        expect(out).toContain('ok');
        expect(out).toContain('end');
    });

    it('htmlToMarkdown produces markdown without raw tags', () => {
        const md = htmlToMarkdown('<h1>T</h1><p>a <strong>b</strong></p><ul><li>x</li></ul>');
        expect(md).toContain('# T');
        expect(md).toContain('**b**');
        expect(md).toContain('- x');
        expect(md).not.toContain('<strong>');
    });

    it('extractTables tolerates ragged rows (missing cells become null)', () => {
        const tables = extractTables('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td></tr><tr><td>2</td><td>3</td><td>4</td></tr></table>');
        expect(tables[0].rows).toEqual([{ A: '1', B: null }, { A: '2', B: '3' }]);
    });
});

// ---------------------------------------------------------------------------
// Client stress (real HTTP)
// ---------------------------------------------------------------------------

describe('stress: HTTP client', () => {
    it('downloads a large body', async () => {
        const buf = await mk().download(`${srv.url}/big`);
        expect(buf.length).toBe(100000);
    });

    it('GET big body as text/buffer/raw', async () => {
        const c = mk();
        const text = await c.get(`${srv.url}/big`, { responseType: 'text' });
        expect(typeof text).toBe('string');
        const raw = await c.get(`${srv.url}/big`, { responseType: 'raw' });
        expect(raw.status).toBe(200);
        expect(raw.data.length).toBe(100000);
    });

    it('POSTs a large JSON body (compression path)', async () => {
        // The test echo server stores the raw (gzip) bytes, so only the
        // encoding + non-empty body are asserted here.
        const body = await mk().post(`${srv.url}/echo`, { big: 'x'.repeat(20000), n: 42 });
        expect(body.contentEncoding).toBe('gzip');
        expect(typeof body.body).toBe('string');
        expect(body.body.length).toBeGreaterThan(0);
    });

    it('streams a large body', async () => {
        const stream = await mk().get(`${srv.url}/big`, { stream: true });
        const chunks = [];
        await new Promise((resolve, reject) => {
            stream.on('data', (d) => chunks.push(d));
            stream.on('end', resolve);
            stream.on('error', reject);
        });
        expect(Buffer.concat(chunks).length).toBe(100000);
    });

    it('deduplicates many concurrent identical GETs', async () => {
        const c = mk();
        const results = await Promise.all(Array.from({ length: 50 }, () => c.get(`${srv.url}/json`)));
        for (const r of results) expect(r.ok).toBe(true);
        expect(c.getMetrics().requestCount).toBe(1);
    });

    it('never merges concurrent GETs with different credentials', async () => {
        const c = mk();
        const results = await Promise.all([
            c.get(`${srv.url}/headers`, { bearer: 'AAA' }),
            c.get(`${srv.url}/headers`, { bearer: 'BBB' }),
            c.get(`${srv.url}/headers`, { bearer: 'CCC' })
        ]);
        expect(results.map(r => r.headers.authorization)).toEqual([
            'Bearer AAA', 'Bearer BBB', 'Bearer CCC'
        ]);
    });

    it('cache keys vary by credentials', async () => {
        const c = mk({ cache: { enabled: true, ttl: 5000 } });
        const a = await c.get(`${srv.url}/headers`, { bearer: 'AAA' });
        const b = await c.get(`${srv.url}/headers`, { bearer: 'BBB' });
        expect(a.headers.authorization).toBe('Bearer AAA');
        expect(b.headers.authorization).toBe('Bearer BBB');
    });

    it('handles redirect chains and loops', async () => {
        expect((await mk().get(`${srv.url}/r1`)).ok).toBe(true);
        await expect(mk({ maxRedirects: 2 }).get(`${srv.url}/redirect-loop`)).rejects.toThrow(/redirects exceeded/);
    });

    it('treats http-prefixed relative paths as relative with baseURL', async () => {
        const c = mk({ baseURL: srv.url });
        await expect(c.get('httpProxy/data')).rejects.toThrow('HTTP Error 404');
    });

    it('sends cookies round-trip', async () => {
        const c = mk();
        await c.get(`${srv.url}/setcookie`);
        const body = await c.get(`${srv.url}/cookies`);
        expect(body.cookie).toContain('sid=abc123');
    });

    it('survives 4xx/5xx without leaking state', async () => {
        const c = mk();
        await expect(c.get(`${srv.url}/client400`)).rejects.toBeTruthy();
        await expect(c.get(`${srv.url}/error500`)).rejects.toBeTruthy();
        expect((await c.get(`${srv.url}/json`)).ok).toBe(true);
    });

    it('aborts mid-flight', async () => {
        const c = mk();
        const ac = new AbortController();
        const p = c.get(`${srv.url}/slow`, { signal: ac.signal });
        setTimeout(() => ac.abort(), 30);
        await expect(p).rejects.toBeTruthy();
    });

    it('accepts headers with empty-string values and query params with arrays', async () => {
        const c = mk();
        const body = await c.get(`${srv.url}/headers`, { headers: { 'X-Empty': '' } });
        expect(body.headers['x-empty']).toBe('');
        const q = await c.get(`${srv.url}/json`, { params: { tags: ['a', 'b'], o: { x: 1 } } });
        expect(q.query.tags).toBeDefined();
        expect(q.query.o).toBe('{"x":1}');
    });

    it('sends cookies and authorization together', async () => {
        const c = mk();
        await c.get(`${srv.url}/setcookie`);
        const body = await c.get(`${srv.url}/headers`, { bearer: 'tok' });
        expect(body.headers.authorization).toBe('Bearer tok');
        expect(body.headers.cookie).toContain('sid=abc123');
    });
});

// ---------------------------------------------------------------------------
// Cookie jar stress
// ---------------------------------------------------------------------------

describe('stress: cookie jar', () => {
    it('handles many cookies across domains/paths', () => {
        const jar = createCookieJar();
        for (let i = 0; i < 500; i++) {
            jar.setCookie('a.com', `c${i}=v${i}; Path=/`);
            jar.setCookie(`sub${i}.b.com`, `s${i}=x; Path=/api`);
        }
        const header = jar.getCookies('https://a.com/x');
        expect(header.split('; ').length).toBe(500);
        // host-only cookie on sub1.b.com: only its own cookie matches
        expect(jar.getCookies('https://sub1.b.com/api/users')).toBe('s1=x');
        expect(jar.getCookies('https://b.com/')).toBe('');
    });

    it('expires cookies via Max-Age and Expires', async () => {
        const jar = createCookieJar();
        jar.setCookie('a.com', 'gone=1; Max-Age=0');
        jar.setCookie('a.com', 'soon=1; Max-Age=1');
        jar.setCookie('a.com', 'past=1; Expires=' + new Date(Date.now() - 5000).toUTCString());
        expect(jar.getCookies('a.com')).toBe('soon=1');
        await new Promise((r) => setTimeout(r, 1100));
        expect(jar.getCookies('a.com')).toBe('');
    });

    it('toJSON/fromJSON preserves path and expiry across domains', () => {
        const jar = createCookieJar();
        jar.setCookie('a.com', 'p=1; Path=/admin; Max-Age=3600');
        jar.setCookie('b.com', 'q=2; Path=/; Secure');
        const json = jar.toJSON();
        expect(json['a.com'][0].path).toBe('/admin');
        const jar2 = createCookieJar();
        jar2.fromJSON(json);
        expect(jar2.getCookies('https://a.com/admin')).toBe('p=1');
        expect(jar2.getCookies('https://a.com/')).toBe('');
        expect(jar2.getCookies('https://b.com/')).toBe('q=2');
    });

    it('does not leak Path=/api cookies to /apikey', () => {
        const jar = createCookieJar();
        jar.setCookie('a.com', 's=1; Path=/api');
        expect(jar.getCookies('https://a.com/api')).toBe('s=1');
        expect(jar.getCookies('https://a.com/apikey')).toBe('');
    });

    it('ignores invalid raw Set-Cookie headers silently', () => {
        const jar = createCookieJar();
        for (const bad of ['=value', 'a===']) {
            expect(() => jar.setCookie('a.com', bad), `input: ${JSON.stringify(bad)}`).not.toThrow();
        }
        // '=value' has an empty name (dropped); 'a===' stores name 'a' value
        // '==' (serialized as 'a' + '=' + '==' = 'a===').
        expect(jar.getCookies('a.com')).toBe('a===');
    });
});
