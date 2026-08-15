/**
 * JSONPath-style query helper (dot/bracket notation, wildcards, numeric indexes).
 * Zero dependencies.
 * @author Cognima
 * @license MIT
 */

function tokenizePath(path) {
    const parts = [];
    let i = 0;
    const n = path.length;

    while (i < n) {
        const c = path[i];
        if (c === '.') {
            i++;
            continue;
        }
        if (c === '[') {
            const end = path.indexOf(']', i);
            if (end === -1) break;
            const inner = path.slice(i + 1, end).trim();
            if (inner === '*') {
                parts.push({ type: 'any' });
            } else if (inner[0] === "'" || inner[0] === '"') {
                parts.push({ type: 'key', value: inner.slice(1, -1) });
            } else {
                const idx = parseInt(inner, 10);
                parts.push(isNaN(idx) ? { type: 'key', value: inner } : { type: 'index', value: idx });
            }
            i = end + 1;
            continue;
        }
        if (c === '*') {
            parts.push({ type: 'any' });
            i++;
            continue;
        }
        let j = i;
        while (j < n && path[j] !== '.' && path[j] !== '[') j++;
        parts.push({ type: 'key', value: path.slice(i, j) });
        i = j;
    }
    return parts;
}

function step(nodes, part, next) {
    for (const node of nodes) {
        if (part.type === 'any') {
            if (Array.isArray(node)) {
                next.push(...node);
            } else if (node && typeof node === 'object') {
                next.push(...Object.values(node));
            }
        } else if (part.type === 'index') {
            if (Array.isArray(node)) {
                const idx = part.value < 0 ? node.length + part.value : part.value;
                if (idx >= 0 && idx < node.length) next.push(node[idx]);
            }
        } else if (node && typeof node === 'object' && part.value in node) {
            next.push(node[part.value]);
        }
    }
}

function evaluate(nodes, parts, idx) {
    if (idx >= parts.length) return nodes;
    const next = [];
    step(nodes, parts[idx], next);
    if (next.length === 0) return [];
    return evaluate(next, parts, idx + 1);
}

/**
 * Query nested JSON data using dot/bracket notation with wildcard support.
 *
 * Examples:
 *   queryJSON(data, 'user.name')
 *   queryJSON(data, 'items[0].price')
 *   queryJSON(data, 'items[*].name')  // -> array of names
 *   queryJSON(data, 'products[-1].id')
 *
 * @param {*} data
 * @param {string} path
 * @param {*} [fallback=undefined]
 * @returns {*} the single value, an array of matches, or the fallback.
 */
export function queryJSON(data, path, fallback) {
    const parts = tokenizePath(String(path));
    if (parts.length === 0) return fallback;
    const results = evaluate([data], parts, 0);
    if (results.length === 0) return fallback;
    return results.length === 1 ? results[0] : results;
}