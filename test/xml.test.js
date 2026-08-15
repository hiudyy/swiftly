import { describe, it, expect } from 'vitest';
import { parseXML, parseXMLTree, xmlToString, parseRSS, parseAtom, parseSitemap } from '../lib/xml.js';

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>My Feed</title>
  <item><title>First</title><link>https://x/1</link><pubDate>Mon, 01 Jan 2026</pubDate><category>tech</category></item>
  <item><title>Second</title><link>https://x/2</link></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Entry One</title>
    <id>urn:1</id>
    <updated>2026-01-01T00:00:00Z</updated>
    <author><name>Jane</name></author>
    <link href="https://x/e1"/>
  </entry>
</feed>`;

const SITEMAP = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://x/a</loc><lastmod>2026-01-01</lastmod><priority>0.8</priority></url>
  <url><loc>https://x/b</loc></url>
</urlset>`;

describe('xml', () => {
    it('parseXML produces plain objects with attrs/text/arrays', () => {
        const doc = parseXML(`<root id="1"><a>x</a><a>y</a><b attr="v">text</b></root>`);
        expect(doc.$).toEqual({ id: '1' });
        expect(doc.a).toEqual([{ '#text': 'x' }, { '#text': 'y' }]);
        expect(doc.b).toEqual({ $: { attr: 'v' }, '#text': 'text' });
    });

    it('parseXMLTree exposes the raw tree', () => {
        const tree = parseXMLTree(`<root><child>hi</child></root>`);
        expect(tree.tag).toBe('root');
        expect(tree.children[0].tag).toBe('child');
        expect(tree.children[0].text).toBe('hi');
    });

    it('handles CDATA and comments', () => {
        const doc = parseXML(`<root><a><![CDATA[<b>raw</b>]]></a><!-- skip --></root>`);
        expect(doc.a['#text']).toBe('<b>raw</b>');
    });

    it('xmlToString round-trips', () => {
        const doc = parseXML(`<root><a>x</a><b n="2"><c>y</c></b></root>`);
        const back = xmlToString(doc, 'root');
        expect(back).toBe('<root><a>x</a><b n="2"><c>y</c></b></root>');
    });

    it('parseRSS', () => {
        const items = parseRSS(RSS);
        expect(items.length).toBe(2);
        expect(items[0].title).toBe('First');
        expect(items[0].link).toBe('https://x/1');
        expect(items[0].pubDate).toBe('Mon, 01 Jan 2026');
        expect(items[0].categories).toEqual(['tech']);
    });

    it('parseAtom', () => {
        const entries = parseAtom(ATOM);
        expect(entries.length).toBe(1);
        expect(entries[0].title).toBe('Entry One');
        expect(entries[0].author).toBe('Jane');
        expect(entries[0].link).toBe('https://x/e1');
        expect(entries[0].id).toBe('urn:1');
    });

    it('parseSitemap', () => {
        const urls = parseSitemap(SITEMAP);
        expect(urls.length).toBe(2);
        expect(urls[0].loc).toBe('https://x/a');
        expect(urls[0].priority).toBe('0.8');
        expect(urls[1].loc).toBe('https://x/b');
    });
});