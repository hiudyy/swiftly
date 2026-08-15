import { describe, it, expect } from 'vitest';
import { parseHTML, decodeEntities, encodeEntities } from '../lib/scraper.js';

const DOC = `<!DOCTYPE html><html><head><title>T</title></head><body>
  <header><h1>Title</h1></header>
  <main>
    <ul id="list">
      <li class="item first" data-id="1">One</li>
      <li class="item" data-id="2">Two</li>
      <li class="item last" data-id="3">Three</li>
    </ul>
    <p class="lead">Hello <strong>world</strong></p>
    <p>Second paragraph <a href="/x">link</a></p>
    <section>
      <article class="post">Post 1</article>
      <article class="post featured">Post 2</article>
    </section>
    <img src="a.png" alt="A">
    <img src="b.png">
    <span></span>
    <nav>
      <a href="/1" class="nav">1</a>
      <a href="/2" class="nav">2</a>
      <a href="/3" class="nav">3</a>
    </nav>
  </main>
</body></html>`;

describe('scraper entities', () => {
    it('decodeEntities handles named entities', () => {
        expect(decodeEntities('&lt;b&gt;')).toBe('<b>');
        expect(decodeEntities('&amp;')).toBe('&');
        expect(decodeEntities('&copy;')).toBe('©');
        expect(decodeEntities('&nbsp;')).toBe('\u00a0');
    });
    it('decodeEntities handles numeric entities', () => {
        expect(decodeEntities('&#65;')).toBe('A');
        expect(decodeEntities('&#x41;')).toBe('A');
        expect(decodeEntities('&#169;')).toBe('©');
    });
    it('decodeEntities leaves unknown / non-entities untouched', () => {
        expect(decodeEntities('plain')).toBe('plain');
        expect(decodeEntities('&nosuch;')).toBe('&nosuch;');
    });
    it('encodeEntities escapes special chars', () => {
        expect(encodeEntities('<b>')).toBe('&lt;b&gt;');
        expect(encodeEntities('a&b')).toBe('a&amp;b');
        expect(encodeEntities('"x"')).toBe('&quot;x&quot;');
        expect(encodeEntities("a'b")).toBe('a&#39;b');
    });
});

describe('scraper tag / id / class / universal', () => {
    it('tag selector', () => {
        expect(parseHTML(DOC, 'li').length).toBe(3);
        expect(parseHTML(DOC, 'article').length).toBe(2);
    });
    it('id selector', () => {
        expect(parseHTML(DOC, '#list').length).toBe(1);
    });
    it('class selector', () => {
        expect(parseHTML(DOC, '.item').length).toBe(3);
        expect(parseHTML(DOC, '.post').length).toBe(2);
    });
    it('universal selector returns all elements', () => {
        expect(parseHTML(DOC, '*').length).toBeGreaterThan(10);
    });
    it('combined tag+class', () => {
        expect(parseHTML(DOC, 'article.post').length).toBe(2);
    });
});

describe('scraper combinators', () => {
    it('descendant', () => {
        expect(parseHTML(DOC, '#list li').length).toBe(3);
        expect(parseHTML(DOC, 'main p').length).toBe(2);
    });
    it('child combinator', () => {
        expect(parseHTML(DOC, 'ul > li').length).toBe(3);
        expect(parseHTML(DOC, 'main > p').length).toBe(2);
    });
    it('adjacent sibling', () => {
        expect(parseHTML(DOC, 'a.nav + a.nav').length).toBe(2);
    });
    it('general sibling', () => {
        expect(parseHTML(DOC, 'a.nav ~ a.nav').length).toBe(2);
    });
    it('descendant with class filter', () => {
        expect(parseHTML(DOC, 'ul li.first').length).toBe(1);
        expect(parseHTML(DOC, 'ul li.last').length).toBe(1);
    });
});

describe('scraper attribute operators', () => {
    it('presence', () => {
        expect(parseHTML(DOC, '[data-id]').length).toBe(3);
        expect(parseHTML(DOC, '[alt]').length).toBe(1);
        expect(parseHTML(DOC, '[src]').length).toBe(2);
    });
    it('equals', () => {
        expect(parseHTML(DOC, '[data-id="2"]').length).toBe(1);
        expect(parseHTML(DOC, 'article.featured').length).toBe(1);
    });
    it('starts with', () => {
        expect(parseHTML(DOC, 'a[href^="/1"]').length).toBe(1);
    });
    it('ends with', () => {
        expect(parseHTML(DOC, '[href$="/3"]').length).toBe(1);
        expect(parseHTML(DOC, 'img[src$="png"]').length).toBe(2);
    });
    it('contains', () => {
        expect(parseHTML(DOC, '[href*="/"]').length).toBe(4);
        expect(parseHTML(DOC, '[href*="x"]').length).toBe(1);
    });
    it('word match', () => {
        expect(parseHTML(DOC, '[class~="item"]').length).toBe(3);
    });
    it('lang/dash match', () => {
        expect(parseHTML(DOC, '[class|="lead"]').length).toBe(1);
    });
});

describe('scraper pseudo-classes', () => {
    it(':first and :last', () => {
        expect(parseHTML(DOC, 'li:first').length).toBe(1);
        expect(parseHTML(DOC, 'li:first')[0].content).toBe('One');
        expect(parseHTML(DOC, 'li:last')[0].content).toBe('Three');
    });
    it(':nth-child', () => {
        expect(parseHTML(DOC, 'li:nth-child(2)').length).toBe(1);
        expect(parseHTML(DOC, 'li:nth-child(2)')[0].content).toBe('Two');
    });
    it(':nth-of-type', () => {
        expect(parseHTML(DOC, 'li:nth-of-type(3)').length).toBe(1);
        expect(parseHTML(DOC, 'article:nth-of-type(2)').length).toBe(1);
    });
    it(':eq', () => {
        expect(parseHTML(DOC, 'li:eq(0)')[0].content).toBe('One');
        expect(parseHTML(DOC, 'li:eq(2)')[0].content).toBe('Three');
    });
    it(':contains', () => {
        expect(parseHTML(DOC, 'li:contains(Two)').length).toBe(1);
        expect(parseHTML(DOC, 'p:contains(Hello)').length).toBe(1);
    });
    it(':empty', () => {
        expect(parseHTML(DOC, 'span:empty').length).toBe(1);
    });
    it(':not', () => {
        expect(parseHTML(DOC, 'li:not(.first)').length).toBe(2);
        expect(parseHTML(DOC, 'a:not(.nav)').length).toBe(1);
    });
    it(':has', () => {
        expect(parseHTML(DOC, 'p:has(a)').length).toBe(1);
        expect(parseHTML(DOC, 'li:has(a)').length).toBe(0);
    });
});

describe('scraper comma groups', () => {
    it('matches any selector in the group', () => {
        expect(parseHTML(DOC, 'h1, li, a').length).toBe(8);
    });
    it('mixed groups with combinators', () => {
        expect(parseHTML(DOC, 'ul > li, article.post').length).toBe(5);
    });
});

describe('scraper element methods', () => {
    const items = parseHTML(DOC, 'li.item');
    it('text() and content', () => {
        expect(items[1].text()).toBe('Two');
        expect(items[1].content).toBe('Two');
    });
    it('attr()', () => {
        expect(items[1].attr('data-id')).toBe('2');
        expect(items[1].attr('missing')).toBeNull();
    });
    it('data() extracts data-* attributes', () => {
        expect(items[1].data()).toEqual({ id: '2' });
    });
    it('find() within an element', () => {
        expect(items[0].find('span').length).toBe(0);
    });
    it('next() and prev()', () => {
        expect(items[0].next().text()).toBe('Two');
        expect(items[2].prev().text()).toBe('Two');
    });
    it('parent() and closest()', () => {
        expect(items[0].parent().tag).toBe('ul');
        expect(items[2].closest('body').tag).toBe('body');
        expect(items[0].closest('main').tag).toBe('main');
    });
    it('html and index', () => {
        expect(items[0].html).toContain('One');
        expect(items[0].index).toBe(1);
    });
    it('children', () => {
        const ul = parseHTML(DOC, '#list')[0];
        expect(ul.children.length).toBe(3);
        expect(ul.children[0].tag).toBe('li');
    });
});
