import { describe, it, expect } from 'vitest';
import { parseHTML, decodeEntities, encodeEntities } from '../lib/scraper.js';

const DOC = `<!DOCTYPE html><html><head><title>T</title></head><body>
<ul id="list">
  <li class="item first">One</li>
  <li class="item" data-id="2">Two</li>
  <li class="item last">Three</li>
</ul>
<a href="https://a.example" class="btn">A</a>
<a href="https://b.example" class="btn" target="_blank">B</a>
<p><em>hello</em> world &amp; beyond</p>
<script>if (a < b && c > d) { run(); }</script>
</body></html>`;

describe('scraper v2', () => {
    it('combinators: descendant, child, sibling', () => {
        expect(parseHTML(DOC, 'li.item').length).toBe(3);
        expect(parseHTML(DOC, 'ul > li').length).toBe(3);
        expect(parseHTML(DOC, 'ul li.first').length).toBe(1);
        expect(parseHTML(DOC, 'a + a').length).toBe(1);
        expect(parseHTML(DOC, 'a ~ a').length).toBe(1);
    });

    it('attribute operators', () => {
        expect(parseHTML(DOC, '[target]').length).toBe(1);
        expect(parseHTML(DOC, '[target="_blank"]').length).toBe(1);
        expect(parseHTML(DOC, 'a[href^="https://a"]').length).toBe(1);
        expect(parseHTML(DOC, 'a[href$="example"]').length).toBe(2);
        expect(parseHTML(DOC, 'a[href*=".example"]').length).toBe(2);
    });

    it('pseudo-classes', () => {
        expect(parseHTML(DOC, 'li:first').length).toBe(1);
        expect(parseHTML(DOC, 'li:first')[0].content).toBe('One');
        expect(parseHTML(DOC, 'li:last').length).toBe(1);
        expect(parseHTML(DOC, 'li:nth-child(2)').length).toBe(1);
        expect(parseHTML(DOC, 'li:contains(Two)').length).toBe(1);
        expect(parseHTML(DOC, 'li:not(.first)').length).toBe(2);
        expect(parseHTML(DOC, 'li:has(a)').length).toBe(0);
    });

    it('comma groups', () => {
        expect(parseHTML(DOC, 'h1, li, a').length).toBe(5);
    });

    it('element methods', () => {
        const els = parseHTML(DOC, 'li.item');
        expect(els[1].text()).toBe('Two');
        expect(els[1].attr('data-id')).toBe('2');
        expect(els[1].data()).toEqual({ id: '2' });
        expect(els[1].find('span').length).toBe(0);
        expect(els[0].next().text()).toBe('Two');
        expect(els[2].prev().text()).toBe('Two');
        expect(els[0].parent().tag).toBe('ul');
        expect(els[2].closest('body').tag).toBe('body');
        expect(els[0].html).toContain('One');
        expect(els[0].content).toBe('One');
    });

    it('comma selectors with attr shorthand in object config', () => {
        const out = parseHTML(DOC, {
            links: 'a@href',
            names: { selector: 'li.item', type: 'text', multiple: true }
        });
        expect(out.links).toEqual(['https://a.example', 'https://b.example']);
        expect(out.names).toEqual(['One', 'Two', 'Three']);
    });

    it('decodes entities and preserves raw text elements', () => {
        const out = parseHTML(DOC, { p: { selector: 'p', type: 'text', multiple: false } });
        expect(out.p).toContain('hello');
        expect(out.p).toContain('&');
        expect(decodeEntities('&lt;b&gt;')).toBe('<b>');
        expect(encodeEntities('<b>')).toBe('&lt;b&gt;');
    });

    it('does not choke on < inside script content', () => {
        const scripts = parseHTML(DOC, 'script');
        expect(scripts.length).toBe(1);
        expect(scripts[0].content).toContain('a < b');
    });

    it('multiple result shapes', () => {
        const out = parseHTML(DOC, {
            first: 'li.item:first',
            attrs: { selector: 'a.btn', type: 'attr', attr: 'href', multiple: true }
        });
        expect(out.first[0].content).toBe('One');
        expect(out.attrs).toEqual(['https://a.example', 'https://b.example']);
    });
});