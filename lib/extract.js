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

/**
 * Extract all links (<a href>).
 * @param {string|Buffer} html
 * @param {string} [baseUrl] - resolve relative links to absolute
 * @returns {Array<{text, href, url}>}
 */
export function extractLinks(html, baseUrl = null) {
    const seen = new Set();
    const out = [];
    for (const el of parseHTML(html, 'a[href]')) {
        const href = el.attr('href');
        if (!href || seen.has(href)) continue;
        seen.add(href);
        out.push({
            text: el.content,
            href,
            url: baseUrl ? resolveUrl(href, baseUrl) : href
        });
    }
    return out;
}

/**
 * Extract all images (<img src>).
 * @param {string|Buffer} html
 * @param {string} [baseUrl]
 * @returns {Array<{src, url, alt, title}>}
 */
export function extractImages(html, baseUrl = null) {
    const seen = new Set();
    const out = [];
    for (const el of parseHTML(html, 'img[src]')) {
        const src = el.attr('src');
        if (!src || seen.has(src)) continue;
        seen.add(src);
        out.push({
            src,
            url: baseUrl ? resolveUrl(src, baseUrl) : src,
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
            tr.find('th, td').map(c => c.content)
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
                value: el.tag === 'textarea' ? el.content : el.attr('value')
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
        out = out.replace(new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
    }
    out = out.replace(/<!--[\s\S]*?-->/g, '');
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
    md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n# ${t.trim()}\n\n`);
    md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n## ${t.trim()}\n\n`);
    md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `\n### ${t.trim()}\n\n`);
    md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, t) => `\n#### ${t.trim()}\n\n`);
    md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, t) => `\n##### ${t.trim()}\n\n`);
    md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, t) => `\n###### ${t.trim()}\n\n`);
    md = md.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**');
    md = md.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*');
    md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
    md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, t) => `\n\`\`\`\n${t.trim()}\n\`\`\`\n`);
    md = md.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
    md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `- ${t.trim()}\n`);
    md = md.replace(/<br\s*\/?\s*>/gi, '\n');
    md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `\n${t.trim()}\n`);
    md = md.replace(/<\/?[^>]+>/g, '');
    return decodeEntities(md.replace(/\n{3,}/g, '\n\n').trim());
}