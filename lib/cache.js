/**
 * Cache System Implementation
 * @author Cognima
 * @license MIT
 */

class CacheStore {
    constructor(config = {}) {
        this.store = new Map();
        this.config = {
            ttl: 300000, // 5 minutos
            maxSize: 1000,
            ...config
        };
    }

    set(key, value, ttl = this.config.ttl) {
        if (this.store.size >= this.config.maxSize) {
            this._cleanup();
        }

        this.store.set(key, {
            value,
            expiresAt: Date.now() + ttl,
            lastAccess: Date.now()
        });
    }

    get(key) {
        const item = this.store.get(key);
        if (!item) return null;

        if (Date.now() > item.expiresAt) {
            this.store.delete(key);
            return null;
        }

        item.lastAccess = Date.now();
        return item.value;
    }

    has(key) {
        return this.get(key) !== null;
    }

    delete(key) {
        return this.store.delete(key);
    }

    clear() {
        this.store.clear();
    }

    _cleanup() {
        const now = Date.now();
        for (const [key, item] of this.store.entries()) {
            if (now > item.expiresAt) {
                this.store.delete(key);
            }
        }

        if (this.store.size >= this.config.maxSize) {
            const entries = Array.from(this.store.entries())
                .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

            const toDelete = Math.max(1, Math.floor(this.config.maxSize * 0.2));
            for (let i = 0; i < toDelete && i < entries.length; i++) {
                this.store.delete(entries[i][0]);
            }
        }
    }

    getCacheKey(method, url, data) {
        const parts = [method.toUpperCase(), url];
        if (data) {
            parts.push(typeof data === 'string' ? data : JSON.stringify(data));
        }
        return parts.join('|');
    }

    getStats() {
        const now = Date.now();
        let validItems = 0;
        let expiredItems = 0;
        let totalSize = 0;

        for (const [key, item] of this.store.entries()) {
            if (now > item.expiresAt) {
                expiredItems++;
            } else {
                validItems++;
                totalSize += JSON.stringify(item.value).length;
            }
        }

        return {
            size: this.store.size,
            validItems,
            expiredItems,
            maxSize: this.config.maxSize,
            totalSize,
            utilizationPercent: (this.store.size / this.config.maxSize) * 100
        };
    }
}

export const createCacheStore = (config) => new CacheStore(config);