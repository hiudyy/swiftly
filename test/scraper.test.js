import { describe, it, expect } from 'vitest';
import { parseHTML } from '../lib/scraper.js';

const HTML = `<!DOCTYPE html><html><body>
<div class="card"><h1 id="title">Hello</h1></div>
<div class="card"><h1>World</h1></div>
<a href="https://example.com/link">Go</a>
</body></html>`;

describe('scraper', () => {
    it('querySelectorAll by class', () => {
        const els = parseHTML(HTML, '.card');
        expect(els.length).toBe(2);
        expect(els[0].content).toContain('Hello');
    });

    it('querySelectorAll by tag', () => {
        const els = parseHTML(HTML, 'h1');
        expect(els.length).toBe(2);
    });

    it('handles object selectors with attribute extraction', () => {
        const out = parseHTML(HTML, { links: 'a@href' });
        expect(out.links).toEqual(['https://example.com/link']);
    });

    it('handles config object with type attr and multiple', () => {
        const out = parseHTML(HTML, {
            title: { selector: '#title', type: 'text', multiple: false }
        });
        expect(out.title).toContain('Hello');
    });

    it('returns nulls for empty html with object selectors', () => {
        expect(parseHTML('', { a: '.x' })).toEqual({ a: null });
    });

    it('throws on non-string html', () => {
        expect(() => parseHTML(null, '.x')).toThrow();
    });
});