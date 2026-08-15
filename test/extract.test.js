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

const PAGE = `<!DOCTYPE html><html>
<head>
  <title>My Page</title>
  <meta name="description" content="A cool page">
  <meta property="og:title" content="My Page">
</head>
<body>
  <a href="/about">About</a>
  <a href="https://ext.example">External</a>
  <img src="/logo.png" alt="Logo">
  <table id="t">
    <tr><th>Name</th><th>Age</th></tr>
    <tr><td>Ana</td><td>30</td></tr>
    <tr><td>Bob</td><td>25</td></tr>
  </table>
  <form action="/submit" method="post">
    <input name="email" type="email">
    <textarea name="message">hi</textarea>
  </form>
  <script type="application/ld+json">{"@type":"Product","name":"Gadget"}</script>
  <script type="application/json">{"key":"value"}</script>
  <script onclick="alert(1)">var x = 1;</script>
  <p>Hello <strong>world</strong>!</p>
</body></html>`;

describe('extract', () => {
    it('extractLinks with base resolution and dedupe', () => {
        const links = extractLinks(PAGE, 'https://site.example/blog/');
        expect(links.length).toBe(2);
        expect(links[0].url).toBe('https://site.example/about');
        expect(links[1].url).toBe('https://ext.example');
        expect(links[0].text).toBe('About');
    });

    it('extractImages', () => {
        const imgs = extractImages(PAGE, 'https://site.example/');
        expect(imgs.length).toBe(1);
        expect(imgs[0].url).toBe('https://site.example/logo.png');
        expect(imgs[0].alt).toBe('Logo');
    });

    it('extractText strips tags and decodes entities', () => {
        const text = extractText('<p>Hello <strong>world</strong> &amp; more</p><script>bad()</script>');
        expect(text).toBe('Hello world & more');
    });

    it('extractMeta', () => {
        const meta = extractMeta(PAGE);
        expect(meta.description).toBe('A cool page');
        expect(meta['og:title']).toBe('My Page');
        expect(meta.title).toBe('My Page');
    });

    it('extractTables', () => {
        const tables = extractTables(PAGE);
        expect(tables.length).toBe(1);
        expect(tables[0].headers).toEqual(['Name', 'Age']);
        expect(tables[0].rows).toEqual([{ Name: 'Ana', Age: '30' }, { Name: 'Bob', Age: '25' }]);
    });

    it('extractForms', () => {
        const forms = extractForms(PAGE);
        expect(forms.length).toBe(1);
        expect(forms[0].action).toBe('/submit');
        expect(forms[0].method).toBe('post');
        expect(forms[0].fields.map(f => f.name)).toEqual(['email', 'message']);
    });

    it('extractJsonLd', () => {
        const ld = extractJsonLd(PAGE);
        expect(ld.length).toBe(1);
        expect(ld[0]['@type']).toBe('Product');
    });

    it('extractJSON prefers application/json blocks', () => {
        const json = extractJSON(PAGE);
        expect(json.length).toBe(1);
        expect(json[0]).toEqual({ key: 'value' });
    });

    it('sanitizeHtml removes scripts, comments and handlers', () => {
        const dirty = `<div onclick="x()"><script>alert(1)</script>ok<!-- c --></div>`;
        const clean = sanitizeHtml(dirty);
        expect(clean).not.toContain('script');
        expect(clean).not.toContain('onclick');
        expect(clean).not.toContain('<!--');
        expect(clean).toContain('ok');
    });

    it('htmlToMarkdown converts basic structure', () => {
        const md = htmlToMarkdown(`<h1>Title</h1><p>A <strong>b</strong> <a href="https://x">link</a></p>`);
        expect(md).toContain('# Title');
        expect(md).toContain('**b**');
        expect(md).toContain('[link](https://x)');
    });
});