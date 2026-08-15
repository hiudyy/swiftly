/**
 * Advanced HTML Scraper — selector engine v2
 *
 * A zero-dependency, lightweight HTML parser + CSS-like selector engine.
 * Supports tag/id/class/attribute selectors, combinators (descendant, child,
 * adjacent, sibling), pseudo-classes (:first/:last/:eq/:first-child/
 * :last-child/:first-of-type/:last-of-type/:only-child/:only-of-type/
 * :nth-child/:nth-last-child/:nth-of-type/:nth-last-of-type/:contains/
 * :not/:empty/:has), attribute operators and comma groups.
 *
 * :first/:last/:eq are set-relative (they select from the full match set in
 * document order, like jQuery); the *-child/*-of-type forms are structural.
 *
 * Note: it is intentionally lighter than a full DOM. For very heavy scraping
 * pair Swiftly with a full parser.
 * @author hiudy
 * @license MIT
 */

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

// ---------------------------------------------------------------------------
// HTML entity decoding
// ---------------------------------------------------------------------------

const NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
    copy: '\u00a9', reg: '\u00ae', trade: '\u2122', hellip: '\u2026',
    mdash: '\u2014', ndash: '\u2013', lsquo: '\u2018', rsquo: '\u2019',
    ldquo: '\u201c', rdquo: '\u201d', bull: '\u2022', middot: '\u00b7',
    euro: '\u20ac', pound: '\u00a3', yen: '\u00a5', cents: '\u00a2',
    sect: '\u00a7', para: '\u00b6', deg: '\u00b0', plusmn: '\u00b1',
    frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be',
    oacute: '\u00f3', agrave: '\u00e0', eacute: '\u00e9', iacute: '\u00ed'
};

const ENTITY_RE = /&(#[xX]?[0-9a-fA-F]+|[a-zA-Z0-9]+);/g;

// WHATWG numeric character reference rules: 0, surrogate and out-of-range
// code points are replaced with U+FFFD instead of throwing.
function decodeNumericEntity(code) {
    if (code === 0 || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) {
        return '\uFFFD';
    }
    return String.fromCodePoint(code);
}

export function decodeEntities(text) {
    if (!text || !text.includes('&')) return text;
    return text.replace(ENTITY_RE, (match, entity) => {
        if (entity[0] === '#') {
            const code = entity[1] === 'x' || entity[1] === 'X'
                ? parseInt(entity.slice(2), 16)
                : parseInt(entity.slice(1), 10);
            return isNaN(code) ? match : decodeNumericEntity(code);
        }
        return NAMED_ENTITIES[entity.toLowerCase()] || match;
    });
}

export function encodeEntities(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

function findTagEnd(html, start) {
    let quote = null;
    for (let j = start + 1; j < html.length; j++) {
        const ch = html[j];
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

function parseTag(raw) {
    const body = raw.slice(1, -1).trim();
    const nameMatch = body.match(/^([^\s/]+)/);
    const name = nameMatch ? nameMatch[1].toLowerCase() : '';
    const rest = body.slice(nameMatch ? nameMatch[0].length : 0);
    const selfClosing = /\/\s*$/.test(rest);

    const attrs = {};
    const attrRe = /([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/g;
    let m;
    while ((m = attrRe.exec(rest)) !== null) {
        let val = m[2];
        if (val === undefined) {
            val = '';
        } else if (val[0] === '"' || val[0] === "'") {
            val = val.slice(1, -1);
        }
        attrs[m[1].toLowerCase()] = decodeEntities(val);
    }
    return { name, attrs, selfClosing };
}

function tokenize(html) {
    const tokens = [];
    let i = 0;
    const len = html.length;

    while (i < len) {
        const lt = html.indexOf('<', i);
        if (lt === -1) {
            if (i < len) tokens.push({ type: 'text', text: html.slice(i) });
            break;
        }
        if (lt > i) tokens.push({ type: 'text', text: html.slice(i, lt) });

        const after = html[lt + 1];
        if (after === undefined) {
            // lone trailing '<' — plain text
            tokens.push({ type: 'text', text: '<' });
            i = lt + 1;
            continue;
        }
        if (after === '!' || after === '?') {
            const end = html.indexOf('>', lt);
            if (end === -1) break;
            const inner = html.slice(lt + 2, end).trim().toLowerCase();
            if (inner.startsWith('--')) {
                // comment — scan to the real "-->", comments may contain '>'
                const cend = html.indexOf('-->', lt + 3);
                const stop = cend === -1 ? end : cend + 2;
                tokens.push({ type: 'comment', raw: html.slice(lt, stop + 1) });
                i = stop + 1;
            } else {
                // doctype, XML/processing declaration, bogus comment — skipped
                tokens.push({ type: 'doctype', raw: html.slice(lt, end + 1) });
                i = end + 1;
            }
        } else if (after === '/') {
            const end = html.indexOf('>', lt);
            if (end === -1) break;
            const name = html.slice(lt + 2, end).trim().split(/\s+/)[0].toLowerCase();
            tokens.push({ type: 'close', name, raw: html.slice(lt, end + 1) });
            i = end + 1;
        } else if (/[a-zA-Z]/.test(after)) {
            const end = findTagEnd(html, lt);
            if (end === -1) break;
            const raw = html.slice(lt, end + 1);
            const parsed = parseTag(raw);
            tokens.push({
                type: parsed.selfClosing || VOID_TAGS.has(parsed.name) ? 'selfclose' : 'open',
                name: parsed.name,
                attrs: parsed.attrs,
                selfClosing: parsed.selfClosing || VOID_TAGS.has(parsed.name),
                raw
            });
            i = end + 1;

            // Raw-text elements: script/style contents may contain '<' and must
            // not be parsed as tags. Consume straight through to the close tag.
            if (!parsed.selfClosing && (parsed.name === 'script' || parsed.name === 'style' || parsed.name === 'textarea')) {
                const closer = html.toLowerCase().indexOf(`</${parsed.name}`, i);
                if (closer === -1) break;
                if (closer > i) {
                    tokens.push({ type: 'text', text: html.slice(i, closer) });
                }
                tokens.push({ type: 'close', name: parsed.name, raw: `</${parsed.name}>` });
                i = closer + parsed.name.length + 3;
                continue;
            }
        } else {
            // '<' followed by a non-tag character (digit, space, etc.): text
            tokens.push({ type: 'text', text: '<' });
            i = lt + 1;
        }
    }
    return tokens;
}

// ---------------------------------------------------------------------------
// Tree builder
// ---------------------------------------------------------------------------

// HTML implied end tags: opening one of these auto-closes an open ancestor of
// the listed tags (the HTML5 "optional end tag" rules).
const AUTO_CLOSE = {
    li: ['li'],
    dt: ['dt', 'dd'],
    dd: ['dt', 'dd'],
    p: ['p'],
    rt: ['rt', 'rp'],
    rp: ['rt', 'rp'],
    optgroup: ['optgroup'],
    option: ['option', 'optgroup'],
    caption: ['caption'],
    colgroup: ['colgroup'],
    thead: ['thead', 'tbody', 'tfoot'],
    tbody: ['thead', 'tbody', 'tfoot'],
    tfoot: ['thead', 'tbody', 'tfoot'],
    tr: ['tr', 'tbody', 'thead', 'tfoot'],
    td: ['td', 'th'],
    th: ['td', 'th']
};

// Block-level elements that close an open <p> (HTML5 "in body" rule).
const CLOSES_P = new Set([
    'address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog',
    'dir', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main',
    'menu', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'ul'
]);

function applyImpliedCloses(stack, tag) {
    const closers = AUTO_CLOSE[tag];
    if (closers) {
        for (let k = stack.length - 1; k >= 1; k--) {
            if (closers.includes(stack[k].tag)) {
                stack.length = k;
                return;
            }
        }
    }
    if (CLOSES_P.has(tag)) {
        for (let k = stack.length - 1; k >= 1; k--) {
            if (stack[k].tag === 'p') {
                stack.length = k;
                return;
            }
        }
    }
}

function buildTree(tokens) {
    const root = { tag: '#root', attrs: {}, children: [], parent: null, text: '', index: 0, typeIndex: 0, selfClosing: false, raw: '', parts: [] };
    const stack = [root];

    for (const tok of tokens) {
        if (tok.type === 'text') {
            const text = decodeEntities(tok.text);
            const top = stack[stack.length - 1];
            top.text += text;
            top.parts.push({ kind: 'text', text });
            continue;
        }
        if (tok.type === 'comment' || tok.type === 'doctype') continue;
        if (tok.type === 'close') {
            for (let k = stack.length - 1; k >= 1; k--) {
                if (stack[k].tag === tok.name) {
                    stack.length = k;
                    break;
                }
            }
            continue;
        }
        applyImpliedCloses(stack, tok.name);
        const parent = stack[stack.length - 1];
        // In HTML a "/>" on a non-void element is ignored: the element stays open.
        const isVoid = VOID_TAGS.has(tok.name);
        const node = {
            tag: tok.name,
            attrs: tok.attrs,
            children: [],
            parent,
            text: '',
            index: 0,
            typeIndex: 0,
            selfClosing: isVoid,
            raw: tok.raw,
            parts: []
        };
        parent.children.push(node);
        parent.parts.push({ kind: 'el', node });
        if (!isVoid) stack.push(node);
    }

    assignIndices(root);
    return root;
}

function assignIndices(root) {
    // Iterative so deeply nested documents don't overflow the call stack.
    const stack = [root];
    while (stack.length) {
        const node = stack.pop();
        const siblings = node.children;
        const typeCounters = new Map();
        for (let i = 0; i < siblings.length; i++) {
            const child = siblings[i];
            child.index = i + 1;
            const t = child.tag;
            const c = (typeCounters.get(t) || 0) + 1;
            typeCounters.set(t, c);
            child.typeIndex = c;
            stack.push(child);
        }
    }
}

// Iterative pre-order walk mirroring the previous recursion: returns every
// node of the tree, root excluded.
function collectAll(root) {
    const out = [];
    const stack = [...root.children].reverse();
    while (stack.length) {
        const n = stack.pop();
        out.push(n);
        for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
    }
    return out;
}

// Iterative (explicit frame stack) so deeply nested documents don't overflow
// the call stack; yields the same text as the recursive version.
function elementText(node) {
    let out = '';
    const stack = [{ node, idx: 0 }];
    while (stack.length) {
        const frame = stack[stack.length - 1];
        const parts = frame.node.parts;
        if (frame.idx >= parts.length) {
            stack.pop();
            continue;
        }
        const part = parts[frame.idx++];
        if (part.kind === 'text') {
            out += part.text;
        } else {
            const c = part.node;
            if (c.tag === 'script' || c.tag === 'style' || c.tag === 'noscript') continue;
            stack.push({ node: c, idx: 0 });
        }
    }
    return out;
}

// Iterative version of outerHTML — same output as the recursive one, but safe
// on deeply nested trees.
function outerHTML(node) {
    if (node.selfClosing) return node.raw;
    let out = node.raw;
    const stack = [{ node, idx: 0 }];
    while (stack.length) {
        const frame = stack[stack.length - 1];
        const parts = frame.node.parts;
        if (frame.idx >= parts.length) {
            const n = frame.node;
            if (!n.selfClosing) out += `</${n.tag}>`;
            stack.pop();
            continue;
        }
        const part = parts[frame.idx++];
        if (part.kind === 'text') {
            out += part.text;
        } else {
            const c = part.node;
            if (c.selfClosing) {
                out += c.raw;
            } else {
                out += c.raw;
                stack.push({ node: c, idx: 0 });
            }
        }
    }
    return out;
}

function previousSiblingElement(node) {
    const sib = node.parent ? node.parent.children : [];
    return sib[node.index - 2] || null;
}

function nextSiblingElement(node) {
    const sib = node.parent ? node.parent.children : [];
    return sib[node.index] || null;
}

// ---------------------------------------------------------------------------
// Selector compilation
// ---------------------------------------------------------------------------

function findMatching(sel, start, open, close) {
    let depth = 0;
    let quote = null;
    for (let j = start; j < sel.length; j++) {
        const c = sel[j];
        if (quote) {
            if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
            quote = c;
        } else if (c === open) {
            depth++;
        } else if (c === close) {
            depth--;
            if (depth === 0) return j;
        }
    }
    return sel.length - 1;
}

function findPseudoEnd(sel, start) {
    let depth = 0;
    let quote = null;
    // start points at the leading ':' — begin scanning just past it
    for (let j = start + 1; j < sel.length; j++) {
        const c = sel[j];
        if (quote) {
            if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
            quote = c;
        } else if (c === '(') {
            depth++;
        } else if (c === ')') {
            if (depth === 0) return j;
            depth--;
        } else if (depth === 0 && (c === ':' || c === ' ' || c === '>' || c === '+' || c === '~' || c === ',' || c === '#' || c === '.' || c === '[' || c === '*')) {
            return j - 1;
        }
    }
    return sel.length - 1;
}

function parseAttr(raw) {
    const m = raw.match(/^\s*([^\s=^$*~|]+)\s*(?:(\^=|\$=|\*=|\|=|~=|=)\s*(?:"([^"]*)"|'([^']*)'|([^\s]*))?)?/);
    if (!m) return { name: '', operator: undefined, value: '' };
    return {
        name: m[1].toLowerCase(),
        operator: m[2],
        value: m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : (m[5] !== undefined ? m[5] : ''))
    };
}

function parsePseudo(raw) {
    const paren = raw.indexOf('(');
    if (paren === -1) return { name: raw.trim().toLowerCase(), arg: null, groups: null };
    const name = raw.slice(0, paren).trim().toLowerCase();
    const arg = raw.slice(paren + 1, -1).trim();
    if (name === 'not' || name === 'has') {
        return { name, arg, groups: compileSelector(arg) };
    }
    if (name === 'nth-child' || name === 'nth-of-type' || name === 'nth-last-child' || name === 'nth-last-of-type') {
        return { name, arg: parseNth(arg), groups: null };
    }
    if (name === 'eq' || name === 'contains') {
        const inner = arg.match(/^['"]?(.*?)['"]?$/);
        return { name, arg: inner ? inner[1] : arg, groups: null };
    }
    return { name, arg, groups: null };
}

function parseNth(expr) {
    const e = String(expr).trim().toLowerCase();
    if (e === 'odd') return { a: 2, b: 1 };
    if (e === 'even') return { a: 2, b: 0 };
    const m = e.match(/^([+-]?\d*)n\s*([+-]\s*\d+)?$/);
    if (m) {
        let a = 0;
        if (m[1] === '' || m[1] === '+') a = 1;
        else if (m[1] === '-') a = -1;
        else a = parseInt(m[1], 10);
        let b = 0;
        if (m[2]) b = parseInt(m[2].replace(/\s/g, ''), 10);
        return { a, b };
    }
    const n = parseInt(e, 10);
    return isNaN(n) ? null : { a: 0, b: n };
}

function nthMatches(index, { a, b }) {
    if (!a && !b) return false;
    if (a === 0) return index === b;
    const x = index - b;
    return x % a === 0 && x / a >= 0;
}

function tokenizeSelector(sel) {
    const tokens = [];
    let i = 0;
    const n = sel.length;
    let needDescendant = false;
    const isSimpleStart = (c) => c === '#' || c === '.' || c === '[' || c === ':' || c === '*' || /[a-zA-Z0-9]/.test(c);

    while (i < n) {
        const ch = sel[i];
        if (ch === ' ' || ch === '\t' || ch === '\n') {
            needDescendant = true;
            i++;
            continue;
        }
        if (ch === '>') { tokens.push({ type: 'combinator', value: '>' }); needDescendant = false; i++; continue; }
        if (ch === '+') { tokens.push({ type: 'combinator', value: '+' }); needDescendant = false; i++; continue; }
        if (ch === '~') { tokens.push({ type: 'combinator', value: '~' }); needDescendant = false; i++; continue; }
        if (ch === ',') { tokens.push({ type: 'comma' }); needDescendant = false; i++; continue; }

        if (needDescendant && isSimpleStart(ch) &&
            tokens.length &&
            tokens[tokens.length - 1].type !== 'combinator' &&
            tokens[tokens.length - 1].type !== 'comma') {
            tokens.push({ type: 'combinator', value: ' ' });
        }
        needDescendant = false;

        if (ch === '*') { tokens.push({ type: 'universal' }); i++; continue; }
        if (ch === '#') {
            let j = i + 1;
            while (j < n && !/[\s>+~,#.*\[\]:]/.test(sel[j])) j++;
            tokens.push({ type: 'id', value: sel.slice(i + 1, j) });
            i = j; continue;
        }
        if (ch === '.') {
            let j = i + 1;
            while (j < n && !/[\s>+~,#.*\[\]:]/.test(sel[j])) j++;
            tokens.push({ type: 'class', value: sel.slice(i + 1, j) });
            i = j; continue;
        }
        if (ch === '[') {
            const end = findMatching(sel, i, '[', ']');
            tokens.push({ type: 'attr', raw: sel.slice(i + 1, end) });
            i = end + 1; continue;
        }
        if (ch === ':') {
            const end = findPseudoEnd(sel, i);
            tokens.push({ type: 'pseudo', raw: sel.slice(i + 1, end + 1) });
            i = end + 1; continue;
        }
        let j = i;
        while (j < n && !/[\s>+~,#.*\[\]:]/.test(sel[j])) j++;
        tokens.push({ type: 'tag', value: sel.slice(i, j).toLowerCase() });
        i = j;
    }
    return tokens;
}

function compileSelector(selector) {
    const tokens = tokenizeSelector(String(selector).trim());
    const groups = [];
    let current = [];
    let step = { combinator: null, simple: [] };

    for (const tok of tokens) {
        if (tok.type === 'comma') {
            if (step.simple.length) current.push(step);
            if (current.length) groups.push(current);
            current = [];
            step = { combinator: null, simple: [] };
            continue;
        }
        if (tok.type === 'combinator') {
            if (step.simple.length) current.push(step);
            step = { combinator: tok.value, simple: [] };
            continue;
        }
        if (tok.type === 'pseudo') {
            step.simple.push({ type: 'pseudo', ...parsePseudo(tok.raw) });
        } else {
            step.simple.push(tok);
        }
    }
    if (step.simple.length) current.push(step);
    if (current.length) groups.push(current);
    return groups;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function hasClass(node, cls) {
    const c = node.attrs['class'];
    if (!c) return false;
    return String(c).split(/\s+/).includes(cls);
}

function applyAttrOp(op, value, expected) {
    switch (op) {
        case '=': return value === expected;
        case '^=': return value.startsWith(expected);
        case '$=': return value.endsWith(expected);
        case '*=': return value.includes(expected);
        case '~=': return String(value).split(/\s+/).includes(expected);
        case '|=': return value === expected || value.startsWith(expected + '-');
        default: return false;
    }
}

function matchesCompound(node, simple) {
    for (const tok of simple) {
        switch (tok.type) {
            case 'tag':
                if (node.tag !== tok.value) return false;
                break;
            case 'universal':
                break;
            case 'id':
                if (node.attrs['id'] !== tok.value) return false;
                break;
            case 'class':
                if (!hasClass(node, tok.value)) return false;
                break;
            case 'attr': {
                const spec = parseAttr(tok.raw);
                const v = node.attrs[spec.name];
                if (spec.operator === undefined) {
                    if (v === undefined) return false;
                } else if (v === undefined || !applyAttrOp(spec.operator, v, spec.value)) {
                    return false;
                }
                break;
            }
            case 'pseudo':
                if (!matchesPseudo(node, tok)) return false;
                break;
        }
    }
    return true;
}

function matchesPseudo(node, pseudo) {
    switch (pseudo.name) {
        case 'first-child':
            return node.index === 1;
        case 'last-child':
            return node.parent ? node.index === node.parent.children.length : false;
        case 'first-of-type':
            return node.typeIndex === 1;
        case 'last-of-type':
            return typeCount(node, node.tag) === node.typeIndex;
        case 'only-child':
            return node.parent ? node.parent.children.length === 1 : false;
        case 'only-of-type':
            return typeCount(node, node.tag) === 1;
        case 'nth-child':
            return !!pseudo.arg && nthMatches(node.index, pseudo.arg);
        case 'nth-of-type':
            return !!pseudo.arg && nthMatches(node.typeIndex, pseudo.arg);
        case 'nth-last-child':
            return !!pseudo.arg && node.parent &&
                nthMatches(node.parent.children.length - node.index + 1, pseudo.arg);
        case 'nth-last-of-type':
            return !!pseudo.arg &&
                nthMatches(typeCount(node, node.tag) - node.typeIndex + 1, pseudo.arg);
        case 'eq':
        case 'first':
        case 'last':
            // Set-relative (positional) pseudos: they depend on the whole
            // match set, so matching treats them as always-true and the final
            // document-ordered result is filtered by applyPositional().
            return true;
        case 'contains':
            return elementText(node).includes(pseudo.arg || '');
        case 'empty':
            return node.children.length === 0 && !node.text.trim();
        case 'not':
            return !matchesAnyGroup(node, pseudo.groups);
        case 'has':
            return hasMatchingDescendant(node, pseudo.groups);
        default:
            return false;
    }
}

// Number of siblings with the same tag as `node` (1-based counting helper
// for the *-of-type pseudos).
function typeCount(node, tag) {
    const parent = node.parent;
    if (!parent) return 0;
    let count = 0;
    for (const sibling of parent.children) {
        if (sibling.tag === tag) count++;
    }
    return count;
}

// Apply set-relative pseudos (:first, :last, :eq) to a document-ordered list
// of matched nodes. `simple` is the final compound of the selector group.
function applyPositional(nodes, simple) {
    let first = false;
    let last = false;
    let eq = null;
    for (const tok of simple) {
        if (tok.type !== 'pseudo') continue;
        if (tok.name === 'first') first = true;
        else if (tok.name === 'last') last = true;
        else if (tok.name === 'eq') eq = Number(tok.arg) || 0;
    }
    if (!first && !last && eq === null) return nodes;
    if (nodes.length === 0) return nodes;
    if (eq !== null) {
        const i = eq < 0 ? nodes.length + eq : eq;
        return i >= 0 && i < nodes.length ? [nodes[i]] : [];
    }
    if (first) return [nodes[0]];
    if (last) return [nodes[nodes.length - 1]];
    return nodes;
}

function matchesAnyGroup(node, groups) {
    if (!groups) return false;
    for (const steps of groups) {
        if (steps.length === 0) continue;
        const last = steps[steps.length - 1].simple;
        if (matchesCompound(node, last) && matchLeft(node, steps, steps.length - 2)) return true;
    }
    return false;
}

function hasMatchingDescendant(node, groups) {
    if (!groups) return false;
    const stack = [...node.children];
    while (stack.length) {
        const n = stack.pop();
        if (matchesAnyGroup(n, groups)) return true;
        for (const c of n.children) stack.push(c);
    }
    return false;
}

function matchLeft(node, steps, idx) {
    if (idx < 0) return true;
    const combinator = steps[idx + 1].combinator;
    const compound = steps[idx].simple;

    if (combinator === '>') {
        const parent = node.parent;
        if (!parent || parent.tag === '#root') return false;
        return matchesCompound(parent, compound) && matchLeft(parent, steps, idx - 1);
    }
    if (combinator === ' ') {
        let anc = node.parent;
        while (anc && anc.tag !== '#root') {
            if (matchesCompound(anc, compound) && matchLeft(anc, steps, idx - 1)) return true;
            anc = anc.parent;
        }
        return false;
    }
    if (combinator === '+') {
        const prev = previousSiblingElement(node);
        if (!prev) return false;
        return matchesCompound(prev, compound) && matchLeft(prev, steps, idx - 1);
    }
    if (combinator === '~') {
        let prev = previousSiblingElement(node);
        while (prev) {
            if (matchesCompound(prev, compound) && matchLeft(prev, steps, idx - 1)) return true;
            prev = previousSiblingElement(prev);
        }
        return false;
    }
    return false;
}

function queryAllSteps(doc, steps) {
    const lastCompound = steps[steps.length - 1].simple;
    const out = [];
    const all = collectAll(doc);
    for (const n of all) {
        if (matchesCompound(n, lastCompound) && matchLeft(n, steps, steps.length - 2)) {
            out.push(n);
        }
    }
    return applyPositional(out, lastCompound);
}

// ---------------------------------------------------------------------------
// Element objects
// ---------------------------------------------------------------------------

function toElement(node) {
    if (node._el) return node._el;

    // Build elements bottom-up (post-order) so deeply nested trees don't
    // overflow the call stack. Lazily-invoked accessors (parent/next/prev/
    // closest/text/find) still resolve on demand via toElement().
    const order = [];
    const stack = [node];
    while (stack.length) {
        const n = stack.pop();
        order.push(n);
        for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
    }
    for (let i = order.length - 1; i >= 0; i--) {
        const n = order[i];
        if (n._el) continue;
        const el = {
            attributes: { ...n.attrs },
            children: n.children.map(c => c._el),
            tag: n.tag,
            index: n.index,
            text: () => elementText(n).trim(),
            attr: (name) => (name in n.attrs ? n.attrs[name] : null),
            find: (sel) => findWithin(n, sel),
            parent: () => (n.parent && n.parent.tag !== '#root' ? toElement(n.parent) : null),
            closest: (sel) => closestWithin(n, sel),
            next: () => { const s = nextSiblingElement(n); return s ? toElement(s) : null; },
            prev: () => { const s = previousSiblingElement(n); return s ? toElement(s) : null; },
            data: () => {
                const out = {};
                for (const [k, v] of Object.entries(n.attrs)) {
                    if (k.startsWith('data-')) out[k.slice(5)] = v;
                }
                return out;
            }
        };
        // Lazy + cached: materializing html/content eagerly for every node is
        // O(n^2) on deep documents. Computed on first access instead.
        let htmlCache;
        let contentCache;
        Object.defineProperty(el, 'html', { get: () => (htmlCache ??= outerHTML(n)), enumerable: true });
        Object.defineProperty(el, 'content', { get: () => (contentCache ??= elementText(n).trim()), enumerable: true });
        Object.defineProperty(el, '_node', { value: n, enumerable: false });
        n._el = el;
    }
    return node._el;
}

function findWithin(node, sel) {
    const groups = compileSelector(sel);
    const seen = new Set();
    const out = [];
    for (const steps of groups) {
        const lastCompound = steps[steps.length - 1].simple;
        const matches = [];
        const stack = [...node.children];
        while (stack.length) {
            const n = stack.pop();
            if (matchesCompound(n, lastCompound) && matchLeft(n, steps, steps.length - 2)) {
                matches.push(n);
            }
            for (const c of n.children) stack.push(c);
        }
        matches.reverse(); // document order
        for (const n of applyPositional(matches, lastCompound)) {
            if (!seen.has(n)) {
                seen.add(n);
                out.push(n);
            }
        }
    }
    return out.map(toElement);
}

function closestWithin(node, sel) {
    const groups = compileSelector(sel);
    let n = node;
    while (n && n.tag !== '#root') {
        if (matchesAnyGroup(n, groups)) return toElement(n);
        n = n.parent;
    }
    return null;
}

function createParser(doc) {
    const cache = new Map();

    function queryAll(selector) {
        if (typeof selector !== 'string') return [];
        if (cache.has(selector)) return cache.get(selector);

        const groups = compileSelector(selector);
        const seen = new Set();
        const nodes = [];
        for (const steps of groups) {
            for (const n of queryAllSteps(doc, steps)) {
                if (!seen.has(n)) {
                    seen.add(n);
                    nodes.push(n);
                }
            }
        }
        const els = nodes.map(toElement);
        cache.set(selector, els);
        return els;
    }

    return {
        querySelectorAll: queryAll,
        querySelector: (sel) => queryAll(sel)[0] || null,
        document: doc
    };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract the full visible text of an HTML document using the real parser.
 * Skips script/style/noscript content, decodes entities and collapses runs of
 * whitespace — robust against malformed markup (stray "<", comments containing
 * ">", unclosed tags, etc.).
 * @param {string|Buffer} html
 * @returns {string}
 */
export function extractDocumentText(html) {
    const source = Buffer.isBuffer(html) ? html.toString('utf-8') : String(html);
    return elementText(buildTree(tokenize(source))).replace(/\s+/g, ' ').trim();
}

/**
 * Parse HTML and extract data with CSS-like selectors.
 *
 * @param {string|Buffer} html - HTML source
 * @param {string|object|string[]} selectors -
 *   - string: CSS-like selector -> array of matched elements
 *   - object: map of { key: selector | { selector, type, attr, multiple } }
 *   - array: array of selectors -> array of arrays
 * @param {object} [options]
 * @returns {*} parsed result
 */
export function parseHTML(html, selectors, options = {}) {
    if (Buffer.isBuffer(html)) {
        html = html.toString('utf-8');
    }

    if (typeof html !== 'string') {
        throw new Error(`HTML must be a string or Buffer, got ${typeof html}`);
    }

    if (!html || html.trim().length === 0) {
        if (typeof selectors === 'object' && !Array.isArray(selectors)) {
            const results = {};
            for (const key of Object.keys(selectors)) {
                results[key] = null;
            }
            return results;
        }
        return [];
    }

    const parser = createParser(buildTree(tokenize(html)));

    if (typeof selectors === 'string') {
        return parser.querySelectorAll(selectors);
    }

    if (typeof selectors === 'object' && !Array.isArray(selectors)) {
        const results = {};

        for (const [key, config] of Object.entries(selectors)) {
            if (typeof config === 'string') {
                const attrMatch = config.match(/^(.*)@([^@]+)$/);
                if (attrMatch && attrMatch[1].trim()) {
                    const [, sel, attr] = attrMatch;
                    results[key] = parser.querySelectorAll(sel.trim()).map(el => el.attr(attr.trim()));
                } else {
                    results[key] = parser.querySelectorAll(config);
                }
                continue;
            }

            if (typeof config === 'object' && config.selector) {
                const { selector, type = 'text', attr, multiple = true } = config;
                const elements = parser.querySelectorAll(selector);

                let extractedData;
                switch (type) {
                    case 'text':
                        extractedData = elements.map(el => el.content);
                        break;
                    case 'html':
                        extractedData = elements.map(el => el.html);
                        break;
                    case 'attr':
                        extractedData = elements.map(el => (attr ? el.attr(attr) : null));
                        break;
                    default:
                        extractedData = elements.map(el => el.content);
                }

                results[key] = multiple ? extractedData : (extractedData[0] || null);
                continue;
            }

            results[key] = parser.querySelectorAll(String(config));
        }

        return results;
    }

    if (Array.isArray(selectors)) {
        return selectors.map(sel => parser.querySelectorAll(sel));
    }

    return [];
}