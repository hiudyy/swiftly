/**
 * Utility Functions
 * @author hiudy
 * @license MIT
 */

import querystring from 'node:querystring';

export function detectResponseType(contentType = '') {
    contentType = String(contentType).toLowerCase();

    if (contentType.includes('application/json')) {
        return 'json';
    } else if (contentType.includes('text/html')) {
        return 'html';
    } else if (contentType.includes('text/')) {
        return 'text';
    } else {
        return 'buffer';
    }
}

export const delay = (ms, signal = null) => new Promise((resolve, reject) => {
    if (signal) {
        if (signal.aborted) return reject(new Error('Aborted'));
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new Error('Aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
    } else {
        setTimeout(resolve, ms);
    }
});

export const buildQueryString = (params) => {
    const normalized = {};
    for (const [key, value] of Object.entries(params || {})) {
        // querystring.stringify drops nested objects (`o=`); serialize them
        // so the data is preserved in the URL.
        if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
            normalized[key] = JSON.stringify(value);
        } else {
            normalized[key] = value;
        }
    }
    return querystring.stringify(normalized);
};

export const isValidUrl = (string) => {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
};

/**
 * Deep merge objects (plain objects only, arrays/other values replace)
 */
export function deepMerge(target, source) {
    if (typeof source !== 'object' || source === null) return target;
    if (Array.isArray(source)) return source;

    const result = { ...target };
    for (const key in source) {
        const sv = source[key];
        if (
            sv && typeof sv === 'object' && !Array.isArray(sv) &&
            result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])
        ) {
            result[key] = deepMerge(result[key], sv);
        } else {
            result[key] = sv;
        }
    }
    return result;
}

/**
 * Parse URL with query params
 */
export function parseUrl(url) {
    try {
        const urlObj = new URL(url);
        return {
            protocol: urlObj.protocol,
            hostname: urlObj.hostname,
            port: urlObj.port,
            pathname: urlObj.pathname,
            search: urlObj.search,
            hash: urlObj.hash,
            params: Object.fromEntries(urlObj.searchParams)
        };
    } catch {
        return null;
    }
}

/**
 * Safe JSON parse
 */
export const safeJsonParse = (str, fallback = null) => {
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
};