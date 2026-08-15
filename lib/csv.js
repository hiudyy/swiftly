/**
 * CSV parser & serializer (quotes, embedded delimiters/newlines, CRLF).
 * Zero dependencies.
 * @author Cognima
 * @license MIT
 */

function escapeCSV(value, delimiter) {
    const s = value === null || value === undefined ? '' : String(value);
    if (s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

/**
 * Parse CSV text into rows of objects (header: true) or arrays (header: false).
 * @param {string|Buffer} text
 * @param {object} [options] - { header: boolean, delimiter: string, skipEmptyLines: boolean }
 * @returns {object[]|string[][]}
 */
export function parseCSV(text, options = {}) {
    const { header = true, delimiter = ',', skipEmptyLines = true } = options;
    const source = Buffer.isBuffer(text) ? text.toString('utf-8') : String(text);

    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (inQuotes) {
            if (c === '"') {
                if (source[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === delimiter) {
            row.push(field);
            field = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && source[i + 1] === '\n') i++;
            row.push(field);
            field = '';
            rows.push(row);
            row = [];
        } else {
            field += c;
        }
    }

    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    if (skipEmptyLines) {
        for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i].every(f => f.trim() === '')) rows.splice(i, 1);
        }
    }

    if (rows.length === 0) return header ? [] : [];

    if (!header) return rows;

    const headers = rows[0].map(h => h.trim());
    return rows.slice(1).map(r => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = r[i] ?? null; });
        return obj;
    });
}

/**
 * Serialize rows to CSV text. Accepts arrays of arrays or arrays of objects.
 * @param {Array<object|Array>} rows
 * @param {object} [options] - { header: boolean, delimiter: string }
 * @returns {string}
 */
export function toCSV(rows, options = {}) {
    const { header = true, delimiter = ',' } = options;
    if (!Array.isArray(rows) || rows.length === 0) return '';

    const isObjects = typeof rows[0] === 'object' && rows[0] !== null && !Array.isArray(rows[0]);
    const lines = [];
    let keys = null;

    if (isObjects && header) {
        keys = Object.keys(rows[0]);
        lines.push(keys.map(k => escapeCSV(k, delimiter)).join(delimiter));
    }

    for (const row of rows) {
        if (isObjects) {
            const k = keys || Object.keys(row);
            lines.push(k.map(key => escapeCSV(row[key], delimiter)).join(delimiter));
        } else {
            lines.push(row.map(v => escapeCSV(v, delimiter)).join(delimiter));
        }
    }

    return lines.join('\r\n');
}