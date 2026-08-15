/**
 * Cache System Implementation (v2)
 * @author hiudy
 * @license MIT
 */

const defaultStorage = () => new Map();

class CacheStore {
    constructor(config = {}) {
        this.config = {
            ttl: 300000, // 5 minutos
            maxSize: 1000,
            staleWhileRevalidate: false,
            ...config
        };
        // Pluggable storage. Contract: `get(key)`, `set(key, entry)`,
        // `delete(key)`, `clear()`. `entry` is `{ value, expiresAt, lastAccess }`.
        this.storage = this.config.storage || defaultStorage();
        this.store = this.storage instanceof Map ? this.storage : null;
    }

    _wrap(key) {
        if (this.store) return this.store;
        return this.storage;
    }

    set(key, value, ttl = this.config.ttl) {
        const store = this._wrap(key);
        if (this.store && this.store.size >= this.config.maxSize) {
            this._cleanup();
        }

        const now = Date.now();
        store.set(key, {
            value,
            expiresAt: now + ttl,
            lastAccess: now
        });
    }

    get(key) {
        const item = this._getRaw(key);
        if (!item) return null;

        const now = Date.now();
        if (now > item.expiresAt) {
            this._wrap(key).delete(key);
            return null;
        }

        item.lastAccess = now;
        return item.value;
    }

    /**
     * Like get(), but returns expired entries too (used by stale-while-revalidate).
     * @returns {null | { value: any, stale: boolean }}
     */
    peek(key) {
        const item = this._getRaw(key);
        if (!item) return null;
        const now = Date.now();
        return { value: item.value, stale: now > item.expiresAt };
    }

    _getRaw(key) {
        const store = this._wrap(key);
        return store.get ? store.get(key) : null;
    }

    has(key) {
        return this.get(key) !== null;
    }

    delete(key) {
        return this._wrap(key).delete(key);
    }

    clear() {
        this._wrap().clear();
    }

    _cleanup() {
        const now = Date.now();
        const store = this.store;
        for (const [key, item] of store.entries()) {
            if (now > item.expiresAt) {
                store.delete(key);
            }
        }

        if (store.size >= this.config.maxSize) {
            const entries = Array.from(store.entries())
                .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

            const toDelete = Math.max(1, Math.floor(this.config.maxSize * 0.2));
            for (let i = 0; i < toDelete && i < entries.length; i++) {
                store.delete(entries[i][0]);
            }
        }
    }

    /**
     * Build a deterministic cache key.
     * @param {string} method - HTTP method
     * @param {string} url - request URL
     * @param {*} data - request body
     * @param {object} [options] - { ignoreQuery, keyBuilder, vary }
     * @returns {string}
     */
    getCacheKey(method, url, data, options = {}) {
        if (options.keyBuilder) {
            return options.keyBuilder(method, url, data);
        }

        let u = url;
        if (options.ignoreQuery) {
            const q = u.indexOf('?');
            u = q === -1 ? u : u.slice(0, q);
        }

        const parts = [method.toUpperCase(), u];
        if (data) {
            parts.push(typeof data === 'string' ? data : JSON.stringify(data));
        }
        // `vary` carries request identity (e.g. auth) so cached responses are
        // not shared between requests with different credentials/headers.
        if (options.vary) {
            parts.push('vary:' + options.vary);
        }
        return parts.join('|');
    }

    getStats() {
        const now = Date.now();
        let validItems = 0;
        let expiredItems = 0;
        let totalSize = 0;

        for (const [key, item] of (this.store ? this.store.entries() : [])) {
            if (now > item.expiresAt) {
                expiredItems++;
            } else {
                validItems++;
                totalSize += JSON.stringify(item.value).length;
            }
        }

        return {
            size: this.store ? this.store.size : 0,
            validItems,
            expiredItems,
            maxSize: this.config.maxSize,
            totalSize,
            utilizationPercent: this.store ? (this.store.size / this.config.maxSize) * 100 : 0
        };
    }
}

export const createCacheStore = (config) => new CacheStore(config);
export { CacheStore };