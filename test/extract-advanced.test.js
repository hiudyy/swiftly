import { describe, it, expect } from 'vitest';
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

const BASE = 'https://site.example/blog/';
const PAGE = `<!DOCTYPE html><html>
<head>
  <title>My Page</title>
  <meta name="description" content="A cool page">
  <meta property="og:title" content="My Page">
  <meta name="twitter:card" content="summary">
  <meta http-equiv="content-type" content="text/html">
</head>
<body>
  <a href="/about">About</a>
  <a href="https://ext.example">External</a>
  <a href="mailto:a@b.com">Mail</a>
  <a href="#frag">Frag</a>
  <img src="/logo.png" alt="Logo" title="LT">
  <img src="/noalt.png">
  <table id="t">
    <tr><th>Name</th><th>Age</th></tr>
    <tr><td>Ana</td><td>30</td></tr>
    <tr><td>Bob</td><td>25</td></tr>
  </table>
  <table id="t2"><tr><th>X</th></tr><tr><td>1</td></tr></table>
  <form action="/submit" method="post">
    <input name="email" type="email">
    <input name="pwd" type="password" value="secret">
    <input name="remember" type="checkbox" value="yes">
    <input name="hidden" type="hidden" value="h">
    <select name="color"><option value="r">R</option></select>
    <textarea name="message">hi</textarea>
    <button name="go">Go</button>
  </form>
  <form><input name="q" type="text"></form>
  <script type="application/ld+json">{"@type":"Product","name":"Gadget"}</script>
  <script type="application/ld+json">{"@type":"Article","name":"Post"}</script>
  <script type="application/ld+json">not json</script>
  <script type="application/json">{"key":"value"}</script>
  <script type="application/json">[1,2,3]</script>
  <script onclick="alert(1)">var x = 1;</script>
  <p>Hello <strong>world</strong> &amp; more</p>
</body></html>`;

describe('extract advanced', () => {
    it('extractLinks resolves relative urls and dedupes', () => {
        const links = extractLinks(PAGE, BASE);
        const about = links.find(l => l.href === '/about');
        expect(about.url).toBe('https://site.example/about');
    });
    it('extractLinks keeps absolute / special urls intact', () => {
        const links = extractLinks(PAGE, BASE);
        expect(links.find(l => l.href === 'https://ext.example').url).toBe('https://ext.example');
        expect(links.find(l => l.href === 'mailto:a@b.com').url).toBe('mailto:a@b.com');
        expect(links.find(l => l.href === '#frag').url).toBe('https://site.example/blog/#frag');
    });
    it('extractLinks without base returns raw href', () => {
        const links = extractLinks(PAGE);
        expect(links.find(l => l.href === '/about').url).toBe('/about');
    });
    it('extractLinks deduplicates identical hrefs', () => {
        const html = '<a href="/x">a</a><a href="/x">b</a>';
        expect(extractLinks(html).length).toBe(1);
    });
    it('extractLinks captures link text', () => {
        const links = extractLinks(PAGE, BASE);
        expect(links.find(l => l.href === '/about').text).toBe('About');
    });

    it('extractImages resolves src and reads alt/title', () => {
        const imgs = extractImages(PAGE, BASE);
        const logo = imgs.find(i => i.src === '/logo.png');
        expect(logo.url).toBe('https://site.example/logo.png');
        expect(logo.alt).toBe('Logo');
        expect(logo.title).toBe('LT');
    });
    it('extractImages reports null alt when absent', () => {
        const imgs = extractImages(PAGE, BASE);
        expect(imgs.find(i => i.src === '/noalt.png').alt).toBeNull();
    });
    it('extractImages dedupes by src', () => {
        expect(extractImages('<img src="/a.png"><img src="/a.png">').length).toBe(1);
    });

    it('extractText strips scripts and entities', () => {
        const text = extractText('<p>Hello <strong>world</strong> &amp; more</p><script>bad()</script>');
        expect(text).toBe('Hello world & more');
    });
    it('extractText collapses whitespace', () => {
        expect(extractText('<div>a\n   b</div>')).toBe('a b');
    });
    it('extractText removes style/noscript/comments', () => {
        const text = extractText('<div>keep<style>x</style><noscript>n</noscript><!-- c --></div>');
        expect(text).toBe('keep');
    });

    it('extractMeta collects name/property/http-equiv and title', () => {
        const meta = extractMeta(PAGE);
        expect(meta.description).toBe('A cool page');
        expect(meta['og:title']).toBe('My Page');
        expect(meta['twitter:card']).toBe('summary');
        expect(meta['content-type']).toBe('text/html');
        expect(meta.title).toBe('My Page');
    });
    it('extractMeta keeps first occurrence on duplicate names', () => {
        const meta = extractMeta('<meta name="x" content="1"><meta name="x" content="2">');
        expect(meta.x).toBe('1');
    });

    it('extractTables parses multiple tables', () => {
        const tables = extractTables(PAGE);
        expect(tables.length).toBe(2);
        expect(tables[0].headers).toEqual(['Name', 'Age']);
        expect(tables[0].rows).toEqual([{ Name: 'Ana', Age: '30' }, { Name: 'Bob', Age: '25' }]);
    });
    it('extractTables accepts a custom selector', () => {
        const tables = extractTables(PAGE, '#t2');
        expect(tables.length).toBe(1);
        expect(tables[0].rows).toEqual([{ X: '1' }]);
    });
    it('extractTables returns empty array for no match', () => {
        expect(extractTables('<div></div>')).toEqual([]);
    });

    it('extractForms defaults method to get', () => {
        const forms = extractForms(PAGE);
        expect(forms[1].action).toBeNull();
        expect(forms[1].method).toBe('get');
    });
    it('extractForms captures method, action and fields', () => {
        const form = extractForms(PAGE)[0];
        expect(form.action).toBe('/submit');
        expect(form.method).toBe('post');
        const names = form.fields.map(f => f.name);
        expect(names).toEqual(['email', 'pwd', 'remember', 'hidden', 'color', 'message', 'go']);
    });
    it('extractForms maps input types correctly', () => {
        const form = extractForms(PAGE)[0];
        const byName = Object.fromEntries(form.fields.map(f => [f.name, f]));
        expect(byName.email.type).toBe('email');
        expect(byName.pwd.value).toBe('secret');
        expect(byName.remember.type).toBe('checkbox');
        expect(byName.hidden.type).toBe('hidden');
        expect(byName.color.type).toBe('select');
        expect(byName.message.type).toBe('textarea');
        expect(byName.message.value).toBe('hi');
        expect(byName.go.type).toBe('button');
    });
    it('extractForms ignores fields without a name', () => {
        const forms = extractForms('<form><input type="text"></form>');
        expect(forms[0].fields.length).toBe(0);
    });

    it('extractJsonLd parses valid blocks and skips invalid', () => {
        const ld = extractJsonLd(PAGE);
        expect(ld.length).toBe(2);
        expect(ld[0]['@type']).toBe('Product');
        expect(ld[1]['@type']).toBe('Article');
    });
    it('extractJsonLd returns empty when none', () => {
        expect(extractJsonLd('<div></div>')).toEqual([]);
    });

    it('extractJSON prefers application/json blocks', () => {
        const json = extractJSON(PAGE);
        expect(json.length).toBe(2);
        expect(json[0]).toEqual({ key: 'value' });
        expect(json[1]).toEqual([1, 2, 3]);
    });
    it('extractJSON scans plain scripts when no typed block', () => {
        const json = extractJSON('<script>{"a":1}</script>');
        expect(json).toEqual([{ a: 1 }]);
    });

    it('sanitizeHtml removes default dangerous tags', () => {
        const clean = sanitizeHtml('<div onclick="x()"><script>alert(1)</script>ok<!-- c --></div>');
        expect(clean).not.toContain('script');
        expect(clean).not.toContain('onclick');
        expect(clean).not.toContain('<!--');
        expect(clean).toContain('ok');
    });
    it('sanitizeHtml removes javascript: hrefs', () => {
        const clean = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
        expect(clean).not.toContain('javascript:');
    });
    it('sanitizeHtml honors a custom stripTags list', () => {
        const clean = sanitizeHtml('<div><script>bad</script><style>x</style></div>', { stripTags: ['script'] });
        expect(clean).not.toContain('bad');
        expect(clean).toContain('<style>');
    });
    it('sanitizeHtml keeps event handlers when allowed', () => {
        const clean = sanitizeHtml('<div onclick="x()">ok</div>', { allowEventHandlers: true });
        expect(clean).toContain('onclick');
    });

    it('htmlToMarkdown converts headings', () => {
        expect(htmlToMarkdown('<h1>Title</h1>')).toContain('# Title');
        expect(htmlToMarkdown('<h3>Sub</h3>')).toContain('### Sub');
    });
    it('htmlToMarkdown converts emphasis and code', () => {
        expect(htmlToMarkdown('<p>A <strong>b</strong> <em>i</em> <code>x</code></p>'))
            .toContain('**b**');
        expect(htmlToMarkdown('<p><em>i</em></p>')).toContain('*i*');
        expect(htmlToMarkdown('<p><code>x</code></p>')).toContain('`x`');
    });
    it('htmlToMarkdown converts links and lists', () => {
        expect(htmlToMarkdown('<a href="https://x">link</a>')).toContain('[link](https://x)');
        const md = htmlToMarkdown('<ul><li>a</li><li>b</li></ul>');
        expect(md).toContain('- a');
        expect(md).toContain('- b');
    });
    it('htmlToMarkdown handles line breaks', () => {
        expect(htmlToMarkdown('a<br>b')).toBe('a\nb');
    });
});
