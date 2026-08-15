/**
 * Utility Functions
 * @author Cognima
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

export const buildQueryString = (params) => querystring.stringify(params);

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
 * Format bytes to human readable
 */
export function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * Format duration to human readable
 */
export function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60000).toFixed(2)}m`;
}

/**
 * Generate unique ID
 */
export const generateId = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

/**
 * Retry with exponential backoff
 */
export async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries - 1) {
                await delay(baseDelay * Math.pow(2, attempt));
            }
        }
    }
    throw lastError;
}

/**
 * Timeout wrapper for promises
 */
export const withTimeout = (promise, ms, message = 'Operation timed out') => Promise.race([
    promise,
    new Promise((_, reject) => {
        setTimeout(() => reject(new Error(message)), ms);
    })
]);

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

/**
 * Chunk array into smaller arrays
 */
export function chunk(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}