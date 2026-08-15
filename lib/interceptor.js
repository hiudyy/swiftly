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

    setCookie(domain, cookie) {
        if (!domain || typeof domain !== 'string') {
            throw new Error('Domain must be a non-empty string');
        }

        if (!cookie || typeof cookie !== 'string') {
            throw new Error('Cookie must be a non-empty string');
        }

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

            this.cookies.get(domain).set(name, {
                value,
                expires: this._getExpiryFromCookie(cookie),
                httpOnly: cookie.toLowerCase().includes('httponly'),
                secure: cookie.toLowerCase().includes('secure'),
                sameSite: this._getSameSiteFromCookie(cookie)
            });
        } catch (error) {
            // Invalid cookies are ignored silently.
        }
    }

    getCookies(domain) {
        this._clearExpired();
        const cookies = this.cookies.get(domain);
        if (!cookies) return '';

        return Array.from(cookies.entries())
            .map(([name, data]) => `${name}=${data.value}`)
            .join('; ');
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