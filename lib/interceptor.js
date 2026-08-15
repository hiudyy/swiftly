/**
 * Request/Response Interceptor System
 * @author Cognima
 * @license MIT
 */

class InterceptorManager {
    constructor() {
        this.handlers = [];
    }

    /**
     * Add an interceptor.
     * @param {Function} fulfilled - Called on success
     * @param {Function} rejected - Called on error
     * @returns {number} - ID for removal
     */
    use(fulfilled, rejected) {
        this.handlers.push({
            fulfilled: typeof fulfilled === 'function' ? fulfilled : null,
            rejected: typeof rejected === 'function' ? rejected : null
        });
        return this.handlers.length - 1;
    }

    /**
     * Remove an interceptor by ID.
     * @param {number} id - Interceptor ID
     */
    eject(id) {
        if (this.handlers[id]) {
            this.handlers[id] = null;
        }
    }

    clear() {
        this.handlers = [];
    }

    async executeRequestChain(config) {
        let result = config;

        for (const handler of this.handlers) {
            if (!handler) continue;

            try {
                if (handler.fulfilled) {
                    result = await handler.fulfilled(result);
                }
            } catch (error) {
                if (handler.rejected) {
                    result = await handler.rejected(error);
                } else {
                    throw error;
                }
            }
        }

        return result;
    }

    async executeResponseChain(response) {
        let result = response;

        for (const handler of this.handlers) {
            if (!handler) continue;

            try {
                if (handler.fulfilled) {
                    result = await handler.fulfilled(result);
                }
            } catch (error) {
                if (handler.rejected) {
                    result = await handler.rejected(error);
                } else {
                    throw error;
                }
            }
        }

        return result;
    }

    async executeResponseErrorChain(error) {
        for (const handler of this.handlers) {
            if (!handler || !handler.rejected) continue;

            try {
                const result = await handler.rejected(error);
                if (result !== undefined) {
                    return result;
                }
            } catch (newError) {
                error = newError;
            }
        }

        throw error;
    }
}

class CookieJar {
    constructor() {
        this.cookies = new Map();
    }

    _domainOf(target) {
        if (!target || typeof target !== 'string') return target;
        if (target.startsWith('http://') || target.startsWith('https://') || target.includes('://')) {
            try {
                return new URL(target).hostname;
            } catch {
                return target;
            }
        }
        return target;
    }

    /**
     * Public: set a cookie by URL (or domain) + name/value, or by name object,
     * or with a raw `Set-Cookie` header string as the second argument.
     * @param {string} url - URL or domain
     * @param {string|object} name - cookie name or { name, value, ...opts }
     * @param {*} [value]
     * @param {object} [opts] - { expires, httpOnly, secure, sameSite, path }
     * @returns {CookieJar}
     */
    setCookie(url, name, value, opts = {}) {
        const domain = this._domainOf(url);
        if (!domain || typeof domain !== 'string') {
            throw new Error('Domain must be a non-empty string');
        }

        // Raw Set-Cookie header string: setCookie(url, 'sid=abc; Path=/; HttpOnly')
        if (typeof name === 'string' && name.includes('=') && !name.includes('://')) {
            return this._setFromHeader(domain, name);
        }

        if (!this.cookies.has(domain)) {
            this.cookies.set(domain, new Map());
        }

        let entry;
        if (typeof name === 'object' && name !== null) {
            entry = { name: name.name, value: String(name.value), ...name };
        } else {
            entry = { name, value: String(value), ...opts };
        }

        if (!entry.name) {
            throw new Error('Cookie name cannot be empty');
        }

        this.cookies.get(domain).set(entry.name, {
            value: String(entry.value),
            expires: entry.expires instanceof Date ? entry.expires : (entry.expires ? new Date(entry.expires) : null),
            httpOnly: !!entry.httpOnly,
            secure: !!entry.secure,
            sameSite: entry.sameSite || 'Lax',
            path: entry.path || '/'
        });
        return this;
    }

    // Internal: store a raw `Set-Cookie` response header for a domain.
    _setFromHeader(domain, cookie) {
        if (!this.cookies.has(domain)) {
            this.cookies.set(domain, new Map());
        }
        try {
            const cookieParts = cookie.split(';')[0].split('=');
            if (cookieParts.length < 2) {
                throw new Error('Invalid cookie format');
            }

            const name = cookieParts[0].trim();
            const value = cookieParts.slice(1).join('=').trim();

            if (!name) {
                throw new Error('Cookie name cannot be empty');
            }

            const full = cookie.toLowerCase();
            this.cookies.get(domain).set(name, {
                value,
                expires: this._getExpiryFromCookie(cookie),
                httpOnly: full.includes('httponly'),
                secure: full.includes('secure'),
                sameSite: this._getSameSiteFromCookie(cookie)
            });
        } catch (error) {
            // Invalid cookies are ignored silently.
        }
        return this;
    }

    /**
     * Get cookies for a URL/domain as a `Cookie` header value.
     * @param {string} url - URL or domain
     * @returns {string}
     */
    getCookies(url) {
        const domain = this._domainOf(url);
        if (this.cookies.size === 0) return ''; // fast path: empty jar
        this._clearExpired();
        const cookies = this.cookies.get(domain);
        if (!cookies) return '';

        return Array.from(cookies.entries())
            .map(([name, data]) => `${name}=${data.value}`)
            .join('; ');
    }

    /**
     * Get the full cookie map for a URL/domain.
     * @param {string} url - URL or domain
     * @returns {Array<{name, value, expires, httpOnly, secure, sameSite, path}>}
     */
    getCookiesMap(url) {
        const domain = this._domainOf(url);
        this._clearExpired();
        const cookies = this.cookies.get(domain);
        if (!cookies) return [];
        return Array.from(cookies.entries()).map(([name, data]) => ({ name, ...data }));
    }

    /**
     * Remove cookies for a URL/domain (or all if omitted).
     * @param {string} [url]
     * @returns {CookieJar}
     */
    clearCookies(url = null) {
        if (url) {
            this.cookies.delete(this._domainOf(url));
        } else {
            this.cookies.clear();
        }
        return this;
    }

    /**
     * Serialize the entire jar (persistable to disk/DB).
     * @returns {object}
     */
    toJSON() {
        const out = {};
        for (const [domain, cookies] of this.cookies.entries()) {
            out[domain] = Array.from(cookies.entries()).map(([name, data]) => ({
                name,
                value: data.value,
                expires: data.expires ? data.expires.toISOString() : null,
                httpOnly: data.httpOnly,
                secure: data.secure,
                sameSite: data.sameSite,
                path: data.path || '/'
            }));
        }
        return out;
    }

    /**
     * Restore a jar previously produced by toJSON().
     * @param {object} data
     * @returns {CookieJar}
     */
    fromJSON(data) {
        if (!data || typeof data !== 'object') return this;
        this.cookies.clear();
        for (const [domain, list] of Object.entries(data)) {
            if (!Array.isArray(list)) continue;
            for (const c of list) {
                try {
                    this.setCookie(domain, c.name, c.value, {
                        expires: c.expires ? new Date(c.expires) : null,
                        httpOnly: c.httpOnly,
                        secure: c.secure,
                        sameSite: c.sameSite,
                        path: c.path
                    });
                } catch (_) { /* skip invalid */ }
            }
        }
        return this;
    }

    _getExpiryFromCookie(cookie) {
        const expires = cookie.split(';')
            .find(part => part.trim().toLowerCase().startsWith('expires='));

        return expires ? new Date(expires.split('=')[1]) : null;
    }

    _getSameSiteFromCookie(cookie) {
        const sameSite = cookie.split(';')
            .find(part => part.trim().toLowerCase().startsWith('samesite='));

        return sameSite ? sameSite.split('=')[1].trim() : 'Lax';
    }

    _clearExpired() {
        const now = new Date();
        for (const [domain, cookies] of this.cookies.entries()) {
            for (const [name, data] of cookies.entries()) {
                if (data.expires && data.expires < now) {
                    cookies.delete(name);
                }
            }
            if (cookies.size === 0) {
                this.cookies.delete(domain);
            }
        }
    }
}

export const createInterceptorManager = () => new InterceptorManager();
export const createCookieJar = () => new CookieJar();
export { InterceptorManager, CookieJar };