/**
 * Rate Limiter Implementation
 * @author Cognima
 * @license MIT
 */

class RateLimiter {
    constructor(config = {}) {
        this.limits = new Map();
        this.delays = new Map();
        this.domainConfigs = new Map();
        this.defaultConfig = {
            requestsPerSecond: 2,
            maxDelay: 64000,
            minDelay: 1000,
            ...config
        };
    }

    async checkLimit(domain) {
        const config = this.domainConfigs.get(domain) || this.defaultConfig;

        if (!this.limits.has(domain)) {
            this.limits.set(domain, []);
            this.delays.set(domain, config.minDelay);
        }

        const requests = this.limits.get(domain);
        let currentDelay = this.delays.get(domain);

        // Loop ao invés de recursão para evitar stack overflow
        while (true) {
            const now = Date.now();

            // Limpar requests antigos (mais de 1 segundo)
            const cutoff = now - 1000;
            while (requests.length > 0 && requests[0] < cutoff) {
                requests.shift();
            }

            if (requests.length < config.requestsPerSecond) {
                requests.push(now);

                if (currentDelay > config.minDelay) {
                    currentDelay = Math.max(currentDelay / 2, config.minDelay);
                    this.delays.set(domain, currentDelay);
                }
                return;
            }

            await new Promise(resolve => setTimeout(resolve, currentDelay));

            currentDelay = Math.min(currentDelay * 2, config.maxDelay);
            this.delays.set(domain, currentDelay);
        }
    }

    setDomainConfig(domain, config) {
        const existingConfig = this.domainConfigs.get(domain) || this.defaultConfig;
        this.domainConfigs.set(domain, { ...existingConfig, ...config });
    }

    clearDomain(domain) {
        this.limits.delete(domain);
        this.delays.delete(domain);
        this.domainConfigs.delete(domain);
    }

    clear() {
        this.limits.clear();
        this.delays.clear();
        this.domainConfigs.clear();
    }
}

export const createRateLimiter = (config) => new RateLimiter(config);