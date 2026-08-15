/**
 * Header Generation Utils
 * @author hiudy
 * @license MIT
 */

// Stable default User-Agent (deterministic -> better caching & connection reuse).
const DEFAULT_USER_AGENT = 'Swiftly/1.0 (+https://github.com/hiudyy/swiftly)';

const userAgents = [
    DEFAULT_USER_AGENT,
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
];

const languages = ['en-US', 'en-GB', 'pt-BR', 'es-ES', 'fr-FR', 'de-DE'];

/**
 * Generate request headers.
 *
 * By default headers are stable/deterministic for maximum connection reuse,
 * caching and speed. Randomize the User-Agent / Accept-Language only when
 * `config.randomizeHeaders` is explicitly enabled (useful for scraping).
 *
 * @param {object} [config] - Request config
 * @returns {object} Headers object
 */
export function generateHeaders(config = {}) {
    const randomize = !!config.randomizeHeaders;

    const headers = {
        'User-Agent': randomize
            ? userAgents[Math.floor(Math.random() * userAgents.length)]
            : (config.userAgent || DEFAULT_USER_AGENT),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': randomize
            ? languages[Math.floor(Math.random() * languages.length)]
            : 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br'
    };

    // Node.js manages keep-alive via its Agent; do not send an explicit
    // Connection header (it is also invalid in HTTP/2).

    // Add custom headers
    if (config.headers) {
        Object.assign(headers, config.headers);
    }

    return headers;
}