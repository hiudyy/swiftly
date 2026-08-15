/**
 * Lightweight XML parser + serialization + feed helpers (RSS/Atom/sitemap).
 * Zero dependencies.
 * @author hiudy
 * @license MIT
 */

const XML_NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

function decodeXML(text) {
    if (!text || !text.includes('&')) return text;
    return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z0-9]+);/g, (m, e) => {
        if (e[0] === '#') {
            const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return isNaN(code) ? m : String.fromCodePoint(code);
        }
        return XML_NAMED[e.toLowerCase()] || m;
    });
}

function escapeXML(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function findXMLTagEnd(xml, start) {
    let quote = null;
    for (let j = start + 1; j < xml.length; j++) {
        const ch = xml[j];
        if (quote) {
            if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (ch === '>') {
            return j;
        }
    }
    return -1;
}

function tokenizeXML(xml) {
    const tokens = [];
    let i = 0;
    const n = xml.length;

    while (i < n) {
        const lt = xml.indexOf('<', i);
        if (lt === -1) {
            if (i < n) tokens.push({ type: 'text', text: xml.slice(i) });
            break;
        }
        if (lt > i) tokens.push({ type: 'text', text: xml.slice(i, lt) });

        if (xml.startsWith('<![CDATA[', lt)) {
            const end = xml.indexOf(']]>', lt);
            if (end === -1) break;
            tokens.push({ type: 'text', text: xml.slice(lt + 9, end) });
            i = end + 3;
            continue;
        }
        if (xml.startsWith('<!--', lt)) {
            const end = xml.indexOf('-->', lt);
            if (end === -1) break;
            i = end + 3;
            continue;
        }
        if (xml.startsWith('<?', lt)) {
            const end = xml.indexOf('?>', lt);
            if (end === -1) break;
            i = end + 2;
            continue;
        }
        if (xml[lt + 1] === '!') {
            // Other declarations (DOCTYPE, ENTITY, ...): skip to the closing
            // '>'. Internal subsets ([...]) may contain '>' characters, so
            // scan bracket-aware. Declarations are dropped entirely — no
            // entity expansion is performed, which keeps the parser
            // XXE-immune by design.
            let depth = 0;
            let quote = null;
            let j = lt + 2;
            for (; j < n; j++) {
                const ch = xml[j];
                if (quote) {
                    if (ch === quote) quote = null;
                } else if (ch === '"' || ch === "'") {
                    quote = ch;
                } else if (ch === '[') {
                    depth++;
                } else if (ch === ']') {
                    if (depth > 0) depth--;
                } else if (ch === '>' && depth === 0) {
                    break;
                }
            }
            i = j + 1;
            continue;
        }
        if (xml[lt + 1] === '/') {
            const end = xml.indexOf('>', lt);
            if (end === -1) break;
            tokens.push({ type: 'close', name: xml.slice(lt + 2, end).trim() });
            i = end + 1;
            continue;
        }
        const end = findXMLTagEnd(xml, lt);
        if (end === -1) break;
        const raw = xml.slice(lt + 1, end).trim();
        const selfClosing = raw.endsWith('/');
        const body = selfClosing ? raw.slice(0, -1).trim() : raw;
        const nameMatch = body.match(/^([^\s/>]+)/);
        const name = nameMatch ? nameMatch[1] : '';
        const rest = body.slice(nameMatch ? nameMatch[0].length : 0);
        const attrs = {};
        const attrRe = /([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'))?/g;
        let m;
        while ((m = attrRe.exec(rest)) !== null) {
            let val = m[2];
            if (val === undefined) val = true;
            else if (val[0] === '"' || val[0] === "'") val = decodeXML(val.slice(1, -1));
            attrs[m[1]] = val;
        }
        tokens.push({ type: 'open', name, attrs, selfClosing });
        i = end + 1;
    }
    return tokens;
}

function buildTree(tokens) {
    const root = { tag: '', attrs: {}, children: [], text: '', parent: null };
    let current = null;

    for (const tok of tokens) {
        if (tok.type === 'text') {
            if (current) current.text += tok.text;
            continue;
        }
        if (tok.type === 'close') {
            if (current && current.tag === tok.name) {
                current = current.parent;
            } else if (current) {
                // Implicit close: climb until we find the matching tag
                while (current && current.tag !== tok.name) current = current.parent;
                if (current) current = current.parent;
            }
            continue;
        }
        const node = { tag: tok.name, attrs: tok.attrs, children: [], text: '', parent: current };
        if (!current) {
            root.children.push(node);
        } else {
            current.children.push(node);
        }
        if (!tok.selfClosing) current = node;
    }

    const roots = root.children;
    return roots.length === 1 ? roots[0] : roots;
}

/**
 * Parse XML into a plain JS object.
 * Attributes are stored under `$`, text under `#text`, repeated child tags
 * become arrays.
 * @param {string|Buffer} xml
 * @returns {object}
 */
export function parseXML(xml) {
    const source = Buffer.isBuffer(xml) ? xml.toString('utf-8') : String(xml);
    const tree = buildTree(tokenizeXML(source));
    if (Array.isArray(tree)) {
        const out = {};
        tree.forEach((n, i) => { out[`root${i}`] = nodeToObject(n); });
        return out;
    }
    return nodeToObject(tree);
}

/**
 * Parse XML into the raw node tree: { tag, attrs, children, text }.
 * @param {string|Buffer} xml
 * @returns {object|object[]}
 */
export function parseXMLTree(xml) {
    const source = Buffer.isBuffer(xml) ? xml.toString('utf-8') : String(xml);
    return buildTree(tokenizeXML(source));
}

function nodeToObject(node) {
    // Iterative post-order conversion so deeply nested documents don't
    // overflow the call stack. Produces the same objects as the recursive
    // version (single child -> object, repeated tags -> array, $ attrs,
    // #text).
    const memo = new Map();
    const stack = [node];
    while (stack.length) {
        const n = stack.pop();
        if (memo.has(n)) continue;

        let ready = true;
        for (const c of n.children) {
            if (!memo.has(c)) {
                ready = false;
                stack.push(c);
            }
        }
        if (!ready) {
            stack.push(n);
            continue;
        }

        const obj = {};
        if (n.attrs && Object.keys(n.attrs).length) {
            obj.$ = { ...n.attrs };
        }
        const grouped = {};
        for (const child of n.children) {
            const childObj = memo.get(child);
            if (!grouped[child.tag]) grouped[child.tag] = [];
            grouped[child.tag].push(childObj);
        }
        for (const [tag, list] of Object.entries(grouped)) {
            obj[tag] = list.length === 1 ? list[0] : list;
        }
        const text = n.text ? n.text.trim() : '';
        if (text) obj['#text'] = text;
        memo.set(n, obj);
    }
    return memo.get(node);
}

function attrString(attrs) {
    return Object.entries(attrs).map(([k, v]) => ` ${k}="${escapeXML(v)}"`).join('');
}

function nodeToString(node) {
    let out = '';
    for (const [key, value] of Object.entries(node)) {
        if (key === '#text') {
            out += escapeXML(value);
            continue;
        }
        if (key === '$') continue;
        const list = Array.isArray(value) ? value : [value];
        for (const item of list) {
            if (item && typeof item === 'object') {
                out += `<${key}${item.$ ? attrString(item.$) : ''}>${nodeToString(item)}</${key}>`;
            } else {
                out += `<${key}>${escapeXML(item ?? '')}</${key}>`;
            }
        }
    }
    return out;
}

/**
 * Serialize a plain object (as produced by parseXML) back to XML.
 * @param {object} obj
 * @param {string} [rootName='root']
 * @returns {string}
 */
export function xmlToString(obj, rootName = 'root') {
    if (!obj || typeof obj !== 'object') return `<${rootName}>${escapeXML(obj ?? '')}</${rootName}>`;
    const attrs = obj.$ ? attrString(obj.$) : '';
    return `<${rootName}${attrs}>${nodeToString(obj)}</${rootName}>`;
}

// ---------------------------------------------------------------------------
// Feed helpers
// ---------------------------------------------------------------------------

function pick(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'object') {
        if (value['#text'] !== undefined) return value['#text'];
        if (value.$ && value.$.value !== undefined) return value.$.value;
        return null;
    }
    return value;
}

function toArray(value) {
    if (value === null || value === undefined) return [];
    return Array.isArray(value) ? value : [value];
}

/**
 * Parse an RSS feed into a list of items.
 * @param {string|Buffer} xml
 * @returns {Array<{title, link, description, pubDate, guid, author, categories}>}
 */
export function parseRSS(xml) {
    const doc = parseXML(xml);
    const channel = doc?.rss?.channel || doc?.channel || {};
    const items = channel.item || [];
    return toArray(items).map(item => ({
        title: pick(item.title),
        link: pick(item.link),
        description: pick(item.description),
        pubDate: pick(item.pubDate),
        guid: pick(item.guid),
        author: pick(item.author) || pick(item['dc:creator']),
        categories: toArray(item.category).map(pick)
    }));
}

function linkOf(link) {
    if (Array.isArray(link)) {
        const first = link[0];
        return typeof first === 'object' ? (first.$?.href ?? null) : first;
    }
    return typeof link === 'object' ? (link.$?.href ?? null) : link;
}

/**
 * Parse an Atom feed into a list of entries.
 * @param {string|Buffer} xml
 * @returns {Array<{title, link, summary, id, updated, author}>}
 */
export function parseAtom(xml) {
    const doc = parseXML(xml);
    const feed = doc?.feed || doc || {};
    const entries = feed.entry || [];
    return toArray(entries).map(entry => ({
        title: pick(entry.title),
        link: linkOf(entry.link),
        summary: pick(entry.summary),
        id: pick(entry.id),
        updated: pick(entry.updated),
        author: pick(entry.author?.name) || pick(entry.author)
    }));
}

/**
 * Parse an XML sitemap into a list of URLs.
 * @param {string|Buffer} xml
 * @returns {Array<{loc, lastmod, changefreq, priority}> | Array<{loc}>}
 */
export function parseSitemap(xml) {
    const doc = parseXML(xml);
    const urlset = doc?.urlset || doc || {};
    if (urlset.url) {
        return toArray(urlset.url).map(u => ({
            loc: pick(u.loc),
            lastmod: pick(u.lastmod),
            changefreq: pick(u.changefreq),
            priority: pick(u.priority)
        }));
    }
    const index = doc?.sitemapindex || doc || {};
    if (index.sitemap) {
        return toArray(index.sitemap).map(s => ({ loc: pick(s.loc) }));
    }
    return [];
}