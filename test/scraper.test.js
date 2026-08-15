import { describe, it, expect } from 'vitest';
import { parseHTML } from '../lib/scraper.js';

describe('scraper object selectors & edge cases', () => {
    const DOC = `<!DOCTYPE html><html><head><title>T</title></head><body>
    <ul id="list">
      <li class="item first" data-id="1">One</li>
      <li class="item" data-id="2">Two</li>
      <li class="item last" data-id="3">Three</li>
    </ul>
    <a href="https://a.example" class="btn">A</a>
    <a href="https://b.example" class="btn" target="_blank">B</a>
    <p><em>hello</em> world &amp; beyond</p>
    <script>if (a < b && c > d) { run(); }</script>
    </body></html>`;

    it('querySelectorAll by class', () => {
        expect(parseHTML(DOC, 'li.item').length).toBe(3);
    });
    it('querySelectorAll by tag', () => {
        expect(parseHTML(DOC, 'li').length).toBe(3);
        expect(parseHTML(DOC, 'a').length).toBe(2);
    });
    it('handles object selectors with attribute extraction shorthand', () => {
        const out = parseHTML(DOC, { links: 'a@href' });
        expect(out.links).toEqual(['https://a.example', 'https://b.example']);
    });
    it('handles config object with type attr and multiple', () => {
        const out = parseHTML(DOC, { names: { selector: 'li.item', type: 'text', multiple: true } });
        expect(out.names).toEqual(['One', 'Two', 'Three']);
    });
    it('returns nulls for empty html with object selectors', () => {
        const out = parseHTML('', { a: 'div', b: { selector: 'x', type: 'text' } });
        expect(out.a).toBeNull();
        expect(out.b).toBeNull();
    });
    it('throws on non-string html', () => {
        expect(() => parseHTML(123)).toThrow();
    });
    it('object selector string returns element arrays', () => {
        const out = parseHTML(DOC, { items: 'li.item' });
        expect(Array.isArray(out.items)).toBe(true);
        expect(out.items.length).toBe(3);
    });
    it('object selector with type html', () => {
        const out = parseHTML(DOC, { firstLi: { selector: 'li.item', type: 'html', multiple: false } });
        expect(out.firstLi).toContain('One');
    });
    it('object selector with type attr and multiple false', () => {
        const out = parseHTML(DOC, { firstId: { selector: 'li.item', type: 'attr', attr: 'data-id', multiple: false } });
        expect(out.firstId).toBe('1');
    });
    it('object selector multiple false returns null when empty', () => {
        const out = parseHTML(DOC, { missing: { selector: 'li.nope', type: 'text', multiple: false } });
        expect(out.missing).toBeNull();
    });
    it('handles Buffer input', () => {
        const out = parseHTML(Buffer.from('<p>hi</p>'), 'p');
        expect(out.length).toBe(1);
        expect(out[0].content).toBe('hi');
    });
    it('handles whitespace-only html', () => {
        expect(parseHTML('   ', 'div')).toEqual([]);
    });
    it('applies implied end tags (li/p close siblings)', () => {
        const html = '<ul><li>A<li>B<li>C</ul><p>Hello<p>World</p>';
        const out = parseHTML(html, { items: { selector: 'li', type: 'text' }, paras: { selector: 'p', type: 'text' } });
        expect(out.items).toEqual(['A', 'B', 'C']);
        expect(out.paras).toEqual(['Hello', 'World']);
    });
    it('applies implied end tags for table cells', () => {
        const out = parseHTML('<table><tr><td>A<td>B</tr><tr><td>C</table>', 'td');
        expect(out.map(e => e.text())).toEqual(['A', 'B', 'C']);
        expect(out[1].parent().tag).toBe('tr');
    });
    it('a block element closes an open p', () => {
        const out = parseHTML('<p>one<div>two', { p: { selector: 'p', type: 'text' }, div: { selector: 'div', type: 'text' } });
        expect(out.p).toEqual(['one']);
        expect(out.div).toEqual(['two']);
    });
    it('array selector returns array of arrays', () => {
        const out = parseHTML(DOC, ['li.item', 'a.btn']);
        expect(out.length).toBe(2);
        expect(out[0].length).toBe(3);
        expect(out[1].length).toBe(2);
    });
});
