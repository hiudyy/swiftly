/**
 * Extraction utilities built on top of the HTML parser.
 * @author hiudy
 * @license MIT
 */

import { parseHTML, decodeEntities, extractDocumentText } from './scraper.js';

function resolveUrl(href, baseUrl) {
    try {
        if (/^(?:[a-z]+:)?\/\//i.test(href) || /^(?:mailto|tel|javascript|data|sms|callto|#):/i.test(href)) {
            return href;
        }
        return new URL(href, baseUrl).href;
    } catch {
        return href;
    }
}

// Honor a <base href> when the caller does not pass an explicit baseUrl —
// real pages often set one and relative links only make sense against it.
function baseHrefOf(html) {
    const el = parseHTML(html, 'base[href]')[0];
    return el ? el.attr('href') : null;
}

/**
 * Extract all links (<a href>).
 * @param {string|Buffer} html
 * @param {string} [baseUrl] - resolve relative links to absolute (falls back to <base href>)
 * @returns {Array<{text, href, url}>}
 */
export function extractLinks(html, baseUrl = null) {
    const base = baseUrl || baseHrefOf(html);
    const seen = new Set();
    const out = [];
    for (const el of parseHTML(html, 'a[href]')) {
        const href = el.attr('href');
        if (!href || seen.has(href)) continue;
        seen.add(href);
        out.push({
            text: el.content,
            href,
            url: base ? resolveUrl(href, base) : href
        });
    }
    return out;
}

/**
 * Extract all images (<img src>).
 * @param {string|Buffer} html
 * @param {string} [baseUrl] - resolve relative images to absolute (falls back to <base href>)
 * @returns {Array<{src, url, alt, title}>}
 */
export function extractImages(html, baseUrl = null) {
    const base = baseUrl || baseHrefOf(html);
    const seen = new Set();
    const out = [];
    for (const el of parseHTML(html, 'img[src]')) {
        const src = el.attr('src');
        if (!src || seen.has(src)) continue;
        seen.add(src);
        out.push({
            src,
            url: base ? resolveUrl(src, base) : src,
            alt: el.attr('alt'),
            title: el.attr('title')
        });
    }
    return out;
}

/**
 * Extract the plain-text content of a page.
 * @param {string|Buffer} html
 * @returns {string}
 */
export function extractText(html) {
    return extractDocumentText(html);
}

/**
 * Extract <meta> tags (name/property/http-equiv) plus the page <title>.
 * @param {string|Buffer} html
 * @returns {object}
 */
export function extractMeta(html) {
    const meta = {};
    for (const el of parseHTML(html, 'meta')) {
        const name = el.attr('name') || el.attr('property') || el.attr('http-equiv');
        const content = el.attr('content');
        if (name && content !== null && !(name in meta)) {
            meta[name] = content;
        }
    }
    const titleEl = parseHTML(html, 'title')[0];
    if (titleEl && !meta.title) meta.title = titleEl.content;
    return meta;
}

/**
 * Extract HTML tables into structured data.
 * @param {string|Buffer} html
 * @param {string} [selector='table']
 * @returns {Array<{headers: string[], rows: object[]}>}
 */
export function extractTables(html, selector = 'table') {
    return parseHTML(html, selector).map(tbl => {
        const rows = tbl.find('tr').map(tr =>
            tr.find('th, td').flatMap(c => {
                // Honor colspan so spanned cells do not shift the columns.
                const span = parseInt(c.attr('colspan'), 10) || 1;
                return Array(span).fill(c.content);
            })
        );
        const headers = rows.length ? rows[0].map(h => h.trim()) : [];
        const body = rows.slice(1).map(row => {
            const obj = {};
            headers.forEach((h, i) => {
                if (h) obj[h] = row[i] ?? null;
            });
            return obj;
        });
        return { headers, rows: body };
    });
}

/**
 * Extract <form> fields.
 * @param {string|Buffer} html
 * @returns {Array<{action, method, fields: Array<{name,type,value}>}>}
 */
export function extractForms(html) {
    return parseHTML(html, 'form').map(f => ({
        action: f.attr('action'),
        method: (f.attr('method') || 'get').toLowerCase(),
        fields: f.find('input, select, textarea, button')
            .map(el => ({
                name: el.attr('name'),
                type: el.tag === 'input' ? (el.attr('type') || 'text') : el.tag,
                value: el.tag === 'textarea' ? el.content
                    : el.tag === 'select'
                        // A <select> submits the selected option's value (or
                        // the first option when none is marked selected).
                        ? (el.find('option[selected]')[0]?.attr('value') ??
                           el.find('option')[0]?.attr('value') ?? null)
                        : el.attr('value')
            }))
            .filter(x => x.name)
    }));
}

/**
 * Extract structured data from `<script type="application/ld+json">` blocks.
 * @param {string|Buffer} html
 * @returns {Array<any>}
 */
export function extractJsonLd(html) {
    const out = [];
    for (const el of parseHTML(html, 'script[type="application/ld+json"]')) {
        try {
            out.push(JSON.parse(el.content));
        } catch (_) { /* skip invalid JSON-LD */ }
    }
    return out;
}

/**
 * Extract JSON payloads embedded in <script> blocks. Prefers
 * `application/json` blocks, otherwise scans scripts for JSON-looking content.
 * @param {string|Buffer} html
 * @returns {Array<any>}
 */
export function extractJSON(html) {
    const candidates = [];
    for (const el of parseHTML(html, 'script[type="application/json"]')) {
        const t = el.content.trim();
        if (t) candidates.push(t);
    }
    if (candidates.length === 0) {
        for (const el of parseHTML(html, 'script')) {
            const t = el.content.trim();
            if (t && (t[0] === '{' || t[0] === '[')) candidates.push(t);
        }
    }
    const out = [];
    for (const text of candidates) {
        try { out.push(JSON.parse(text)); } catch (_) { /* skip */ }
    }
    return out;
}

// Linear-time removal of `<tag ...>...</tag>` blocks (from the opening `<tag`
// through the first closing `</tag>`). The lazy-regex equivalent is O(n^2)
// on documents with many unclosed openings, so we scan with indexOf instead.
function stripBlocks(html, tag) {
    const lower = html.toLowerCase();
    const openPrefix = `<${tag}`;
    const closePrefix = `</${tag}>`;
    let out = '';
    let searchFrom = 0;
    const n = html.length;
    while (searchFrom < n) {
        const open = lower.indexOf(openPrefix, searchFrom);
        if (open === -1) {
            out += html.slice(searchFrom);
            break;
        }
        // End of the opening tag: first '>' outside quotes.
        let tagEnd = -1;
        let quote = null;
        for (let j = open + 1; j < n; j++) {
            const ch = html[j];
            if (quote) {
                if (ch === quote) quote = null;
            } else if (ch === '"' || ch === "'") {
                quote = ch;
            } else if (ch === '>') {
                tagEnd = j;
                break;
            }
        }
        if (tagEnd === -1) {
            out += html.slice(searchFrom);
            break;
        }
        const close = lower.indexOf(closePrefix, tagEnd + 1);
        if (close === -1) {
            // No closing tag exists anywhere after this opening — the regex
            // could never match a block, so keep everything from here on.
            out += html.slice(searchFrom);
            break;
        }
        out += html.slice(searchFrom, open);
        searchFrom = close + closePrefix.length;
    }
    return out;
}

// Linear-time removal of `<!-- ... -->` comments (lazy-regex equivalent is
// quadratic on many unterminated openings).
function stripComments(html) {
    let out = '';
    let searchFrom = 0;
    const n = html.length;
    while (searchFrom < n) {
        const open = html.indexOf('<!--', searchFrom);
        if (open === -1) {
            out += html.slice(searchFrom);
            break;
        }
        const close = html.indexOf('-->', open + 4);
        if (close === -1) {
            // Unterminated comment: the regex never matched — keep it.
            out += html.slice(searchFrom);
            break;
        }
        out += html.slice(searchFrom, open);
        searchFrom = close + 3;
    }
    return out;
}

/**
 * Remove unsafe tags, comments and event handlers from HTML.
 * @param {string|Buffer} html
 * @param {object} [options] - { stripTags: string[], allowEventHandlers: boolean }
 * @returns {string}
 */
export function sanitizeHtml(html, options = {}) {
    const {
        stripTags = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'noscript', 'link', 'meta'],
        allowEventHandlers = false
    } = options;
    let out = Buffer.isBuffer(html) ? html.toString('utf-8') : String(html);

    for (const tag of stripTags) {
        out = stripBlocks(out, tag);
    }
    out = stripComments(out);
    if (!allowEventHandlers) {
        out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '');
    }
    out = out.replace(/(href|src|action)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=$2');
    return out;
}

/**
 * Convert simple HTML to Markdown (basic: headings, emphasis, links, lists,
 * code blocks).
 * @param {string|Buffer} html
 * @returns {string}
 */
export function htmlToMarkdown(html) {
    let md = sanitizeHtml(html);
    // NOTE: every tag pattern below uses a `(?=[\s/>])` boundary after the tag
    // name so `<b ...` matches `<b>` but NOT `<blockquote>/<body>/<br>`, `<a`
    // matches `<a>` but NOT `<article>/<area>`, etc. Without it, a regex like
    // `<b[^>]*>` swallows whole unrelated tags and corrupts the output.
    // Images: `![alt](src)` (alt defaults to the src when missing).
    md = md.replace(/<img(?=[\s/>])[^>]*>/gi, (tag) => {
        const src = /src=["']([^"']+)["']/i.exec(tag);
        if (!src) return '';
        const alt = /alt=["']([^"']*)["']/i.exec(tag);
        return `![${alt ? alt[1] : src[1]}](${src[1]})`;
    });
    md = md.replace(/<hr(?=[\s/>])[^>]*>/gi, '\n---\n');
    md = md.replace(/<h1(?=[\s/>])[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n# ${t.trim()}\n\n`);
    md = md.replace(/<h2(?=[\s/>])[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n## ${t.trim()}\n\n`);
    md = md.replace(/<h3(?=[\s/>])[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `\n### ${t.trim()}\n\n`);
    md = md.replace(/<h4(?=[\s/>])[^>]*>([\s\S]*?)<\/h4>/gi, (_, t) => `\n#### ${t.trim()}\n\n`);
    md = md.replace(/<h5(?=[\s/>])[^>]*>([\s\S]*?)<\/h5>/gi, (_, t) => `\n##### ${t.trim()}\n\n`);
    md = md.replace(/<h6(?=[\s/>])[^>]*>([\s\S]*?)<\/h6>/gi, (_, t) => `\n###### ${t.trim()}\n\n`);
    md = md.replace(/<(?:strong|b)(?=[\s/>])[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**');
    md = md.replace(/<(?:em|i)(?=[\s/>])[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*');
    // Convert <pre> blocks to fenced code FIRST (stripping any inner tags),
    // then wrap the remaining <code> in inline backticks — otherwise the
    // content of a <pre><code> block would get wrapped in inline code markers
    // inside the fence.
    md = md.replace(/<pre(?=[\s/>])[^>]*>([\s\S]*?)<\/pre>/gi, (_, t) => `\n\`\`\`\n${t.replace(/<[^>]+>/g, '').trim()}\n\`\`\`\n`);
    md = md.replace(/<code(?=[\s/>])[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
    // Lists: ordered lists get sequential numbering, unordered get bullets.
    md = md.replace(/<ol(?=[\s/>])[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
        let n = 0;
        return inner.replace(/<li(?=[\s/>])[^>]*>([\s\S]*?)<\/li>/gi, (__, t) => `${++n}. ${t.trim()}\n`);
    });
    md = md.replace(/<ul(?=[\s/>])[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => {
        return inner.replace(/<li(?=[\s/>])[^>]*>([\s\S]*?)<\/li>/gi, (__, t) => `- ${t.trim()}\n`);
    });
    md = md.replace(/<li(?=[\s/>])[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `- ${t.trim()}\n`);
    md = md.replace(/<a(?=[\s/>])[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
    md = md.replace(/<br\s*\/?\s*>/gi, '\n');
    md = md.replace(/<p(?=[\s/>])[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `\n${t.trim()}\n`);
    // Blockquotes: prefix each line with "> " (after <p> collapse).
    md = md.replace(/<blockquote(?=[\s/>])[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) => {
        const lines = t.replace(/\n{2,}/g, '\n').split('\n').filter((l) => l.trim() !== '');
        return '\n' + lines.map((l) => `> ${l.trim()}`).join('\n') + '\n';
    });
    md = md.replace(/<\/?[^>]+>/g, '');
    return decodeEntities(md.replace(/\n{3,}/g, '\n\n').trim());
}