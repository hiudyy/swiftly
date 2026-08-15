import { describe, it, expect } from 'vitest';
import {
    parseXML,
    parseXMLTree,
    xmlToString,
    parseRSS,
    parseAtom,
    parseSitemap
} from '../lib/xml.js';

describe('xml.parseXML', () => {
    it('produces plain objects with attrs/text/arrays', () => {
        const xml = '<root><item id="1">hello</item><item id="2">world</item></root>';
        const obj = parseXML(xml);
        expect(obj.item.length).toBe(2);
        expect(obj.item[0].$).toEqual({ id: '1' });
        expect(obj.item[0]['#text']).toBe('hello');
    });
    it('keeps single child as object, not array', () => {
        const obj = parseXML('<root><a>x</a></root>');
        expect(obj.a['#text']).toBe('x');
        expect(Array.isArray(obj.a)).toBe(false);
    });
    it('parses attributes into $', () => {
        const obj = parseXML('<r><a href="http://x"/></r>');
        expect(obj.a.$.href).toBe('http://x');
    });
    it('handles nested elements', () => {
        const obj = parseXML('<r><a><b>c</b></a></r>');
        expect(obj.a.b['#text']).toBe('c');
    });
    it('handles self-closing tags', () => {
        const obj = parseXML('<r><a/><b/></r>');
        expect(obj.a).toEqual({});
        expect(obj.b).toEqual({});
    });
    it('accepts a Buffer', () => {
        const obj = parseXML(Buffer.from('<r><a>1</a></r>'));
        expect(obj.a['#text']).toBe('1');
    });
    it('decodes XML entities in attributes (text kept verbatim)', () => {
        const obj = parseXML('<r><a href="x&amp;y">1 &lt; 2</a></r>');
        expect(obj.a.$.href).toBe('x&y');
        expect(obj.a['#text']).toBe('1 &lt; 2');
    });
    it('handles multiple root elements', () => {
        const obj = parseXML('<a>1</a><b>2</b>');
        expect(obj.root0['#text']).toBe('1');
        expect(obj.root1['#text']).toBe('2');
    });
    it('handles boolean attributes (no value)', () => {
        const obj = parseXML('<r><a disabled/></r>');
        expect(obj.a.$.disabled).toBe(true);
    });
    it('returns empty object for empty input', () => {
        expect(parseXML('')).toEqual({});
    });
    it('skips DOCTYPE declarations without polluting the tree', () => {
        const xml = '<?xml version="1.0"?>\n<!DOCTYPE rss SYSTEM "http://example.com/rss.dtd">\n<rss version="2.0"><channel><title>Feed</title></channel></rss>';
        // Single root is unwrapped (existing convention); the DOCTYPE must not
        // become a bogus node or leak garbage into the output.
        expect(parseXML(xml)).toEqual({
            $: { version: '2.0' },
            channel: { title: { '#text': 'Feed' } }
        });
    });
    it('skips internal DTD subsets (and stays XXE-immune)', () => {
        const xml = '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><root><a>1</a></root>';
        // The declaration is dropped entirely — no entity expansion happens.
        expect(parseXML(xml)).toEqual({ a: { '#text': '1' } });
    });
});

describe('xml.parseXMLTree', () => {
    it('exposes the raw node tree', () => {
        const tree = parseXMLTree('<root><a>b</a></root>');
        expect(tree.tag).toBe('root');
        expect(tree.children[0].tag).toBe('a');
        expect(tree.children[0].text).toBe('b');
    });
    it('captures attributes on the tree', () => {
        const tree = parseXMLTree('<a id="1"/>');
        expect(tree.attrs.id).toBe('1');
    });
    it('represents self-closing nodes without children', () => {
        const tree = parseXMLTree('<a/>');
        expect(tree.children.length).toBe(0);
    });
});

describe('xml.xmlToString', () => {
    it('serializes a simple object', () => {
        expect(xmlToString({ a: 'x' }, 'root')).toBe('<root><a>x</a></root>');
    });
    it('serializes attributes', () => {
        expect(xmlToString({ a: { $: { id: '1' }, '#text': 'x' } }, 'root'))
            .toBe('<root><a id="1">x</a></root>');
    });
    it('serializes arrays as repeated tags', () => {
        expect(xmlToString({ item: [{ '#text': '1' }, { '#text': '2' }] }, 'root'))
            .toBe('<root><item>1</item><item>2</item></root>');
    });
    it('escapes special characters', () => {
        expect(xmlToString({ a: '<b>&' }, 'root')).toBe('<root><a>&lt;b&gt;&amp;</a></root>');
    });
    it('round-trips parseXML output', () => {
        const obj = parseXML('<root><a>1</a><b id="2">x</b></root>');
        const back = parseXML(xmlToString(obj, 'root'));
        expect(back).toEqual(obj);
    });
    it('handles scalar root value', () => {
        expect(xmlToString('hi', 'root')).toBe('<root>hi</root>');
    });
});

describe('xml.parseRSS', () => {
    const rss = `<?xml version="1.0"?>
    <rss version="2.0"><channel>
      <title>Ch</title>
      <item>
        <title>Post 1</title>
        <link>http://x/1</link>
        <description>Desc 1</description>
        <pubDate>Mon, 01 Jan 2024</pubDate>
        <guid>g1</guid>
        <category>tech</category>
        <category>news</category>
        <dc:creator>Author</dc:creator>
      </item>
      <item><title>Post 2</title><link>http://x/2</link></item>
    </channel></rss>`;

    it('parses channel items', () => {
        const items = parseRSS(rss);
        expect(items.length).toBe(2);
        expect(items[0].title).toBe('Post 1');
        expect(items[0].link).toBe('http://x/1');
        expect(items[0].description).toBe('Desc 1');
        expect(items[0].pubDate).toBe('Mon, 01 Jan 2024');
        expect(items[0].guid).toBe('g1');
    });
    it('collects categories and author', () => {
        const items = parseRSS(rss);
        expect(items[0].categories).toEqual(['tech', 'news']);
        expect(items[0].author).toBe('Author');
    });
    it('handles missing fields', () => {
        const items = parseRSS(rss);
        expect(items[1].description).toBeNull();
        expect(items[1].categories).toEqual([]);
    });
    it('returns empty array for non-rss', () => {
        expect(parseRSS('<root/>')).toEqual([]);
    });
    it('parses a feed with a DOCTYPE preamble', () => {
        const rss = '<?xml version="1.0"?><!DOCTYPE rss><rss version="2.0"><channel><title>Ch</title><item><title>P1</title><link>http://x/1</link></item></channel></rss>';
        const items = parseRSS(rss);
        expect(items.length).toBe(1);
        expect(items[0].title).toBe('P1');
        expect(items[0].link).toBe('http://x/1');
    });
});

describe('xml.parseAtom', () => {
    const atom = `<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Entry 1</title>
        <link href="http://x/1"/>
        <summary>Sum 1</summary>
        <id>id1</id>
        <updated>2024-01-01</updated>
        <author><name>Bob</name></author>
      </entry>
      <entry><title>E2</title><link href="http://x/2"/><id>id2</id></entry>
    </feed>`;

    it('parses entries', () => {
        const entries = parseAtom(atom);
        expect(entries.length).toBe(2);
        expect(entries[0].title).toBe('Entry 1');
        expect(entries[0].link).toBe('http://x/1');
        expect(entries[0].summary).toBe('Sum 1');
        expect(entries[0].id).toBe('id1');
        expect(entries[0].updated).toBe('2024-01-01');
    });
    it('parses author name', () => {
        expect(parseAtom(atom)[0].author).toBe('Bob');
    });
    it('handles missing fields', () => {
        const entries = parseAtom(atom);
        expect(entries[1].summary).toBeNull();
    });
});

describe('xml.parseSitemap', () => {
    const sitemap = `<?xml version="1.0"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>http://x/1</loc><lastmod>2024-01-01</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>
      <url><loc>http://x/2</loc></url>
    </urlset>`;

    it('parses url entries', () => {
        const urls = parseSitemap(sitemap);
        expect(urls.length).toBe(2);
        expect(urls[0].loc).toBe('http://x/1');
        expect(urls[0].lastmod).toBe('2024-01-01');
        expect(urls[0].changefreq).toBe('daily');
        expect(urls[0].priority).toBe('0.8');
    });
    it('handles missing optional fields', () => {
        expect(parseSitemap(sitemap)[1].lastmod).toBeNull();
    });
    it('parses sitemap index', () => {
        const idx = '<sitemapindex><sitemap><loc>http://x/s1</loc></sitemap></sitemapindex>';
        const urls = parseSitemap(idx);
        expect(urls).toEqual([{ loc: 'http://x/s1' }]);
    });
    it('returns empty array for unknown', () => {
        expect(parseSitemap('<r/>')).toEqual([]);
    });
});
