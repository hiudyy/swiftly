// Web scraping with selectors
import { parseHTML } from '../lib/scraper.js';

const html = `<!DOCTYPE html><html><body>
<div class="repo"><h1 id="name">swiftly</h1><a class="link" href="https://github.com/cognima/swiftly">Go</a></div>
<div class="repo"><h1 id="name">other</h1><a class="link" href="https://example.com">Go</a></div>
</body></html>`;

const parsed = parseHTML(html, {
    titles: { selector: 'h1', type: 'text', multiple: true },
    links: '.link@href'
});

console.log('TITLES ->', parsed.titles);
console.log('LINKS  ->', parsed.links);