/**
 * Swiftly - Lightweight HTTP client (ESM entry)
 * @author Cognima
 * @license MIT
 */

import { createClient } from './lib/client.js';
import { parseHTML } from './lib/scraper.js';
import { events } from './lib/events.js';
import {
    extractLinks,
    extractImages,
    extractText,
    extractMeta,
    extractTables,
    extractForms,
    extractJsonLd,
    extractJSON,
    sanitizeHtml,
    htmlToMarkdown
} from './lib/extract.js';
import { parseXML, parseXMLTree, xmlToString, parseRSS, parseAtom, parseSitemap } from './lib/xml.js';
import { parseCSV, toCSV } from './lib/csv.js';
import { queryJSON } from './lib/jsonpath.js';

// Shared default client so static calls reuse the connection pool,
// cookie jar and cache instead of spinning up a new client each time.
let defaultClient = null;
const getDefaultClient = () => {
    if (!defaultClient) {
        defaultClient = createClient({ debug: false });
    }
    return defaultClient;
};

/**
 * Create a Swiftly client instance.
 * @param {object} [config] - Client configuration
 * @returns {object} Client instance
 */
const swiftly = (config = {}) => {
    const client = createClient(config);

    const instance = (url, reqConfig) => client.get(url, reqConfig);
    instance.get = (url, config) => client.get(url, config);
    instance.post = (url, data, config) => client.post(url, data, config);
    instance.put = (url, data, config) => client.put(url, data, config);
    instance.patch = (url, data, config) => client.patch(url, data, config);
    instance.delete = (url, config) => client.delete(url, config);
    instance.head = (url, config) => client.head(url, config);
    instance.options = (url, config) => client.options(url, config);

    instance.on = (event, callback) => client.on(event, callback);
    instance.off = (event, callback) => client.off(event, callback);

    instance.interceptors = client.interceptors;

    instance.query = (url, queryData, config) => client.query(url, queryData, config);

    instance.subscribe = (url, callbacks, config) => client.subscribe(url, callbacks, config);

    instance.scrape = (url, selector, config = {}) => {
        return client.get(url, { ...config, responseType: 'text', cache: { enabled: false } })
            .then(response => parseHTML(response, selector, config));
    };

    instance.parse = (html, selectors, config = {}) => parseHTML(html, selectors, config);

    instance.batch = (requests) => client.batch(requests);
    instance.download = (url, config) => client.download(url, config);
    instance.clearCache = () => client.clearCache();
    instance.resetCircuitBreakers = (domain) => client.resetCircuitBreakers(domain);
    instance.getMetrics = () => client.getMetrics();
    instance.close = () => client.close();

    instance.setBaseURL = (url) => { client.config.baseURL = url; };
    instance.setDefaultHeaders = (headers) => {
        Object.assign(client.config.headers || {}, headers);
    };
    instance.setTimeout = (timeout) => { client.config.timeout = timeout; };
    instance.setDebug = (debug) => { client.config.debug = debug; };
    instance.getConfig = () => client.config;

    return instance;
};

// Direct method access on the main export (shared default client)
const bindStatic = (method) => (url, ...args) => getDefaultClient()[method](url, ...args);
swiftly.get = bindStatic('get');
swiftly.post = bindStatic('post');
swiftly.put = bindStatic('put');
swiftly.patch = bindStatic('patch');
swiftly.delete = bindStatic('delete');
swiftly.head = bindStatic('head');
swiftly.options = bindStatic('options');
swiftly.batch = bindStatic('batch');
swiftly.download = bindStatic('download');
swiftly.query = bindStatic('query');
swiftly.subscribe = bindStatic('subscribe');
swiftly.clearCache = bindStatic('clearCache');
swiftly.resetCircuitBreakers = bindStatic('resetCircuitBreakers');
swiftly.getMetrics = bindStatic('getMetrics');
swiftly.on = bindStatic('on');
swiftly.off = bindStatic('off');
swiftly.scrape = bindStatic('scrape');

// Expose the shared client for advanced usage (interceptors, config)
swiftly.client = getDefaultClient;

// Export event constants
swiftly.events = events;

// Parsing & extraction utilities
swiftly.parseHTML = parseHTML;
swiftly.parseXML = parseXML;
swiftly.parseXMLTree = parseXMLTree;
swiftly.xmlToString = xmlToString;
swiftly.parseRSS = parseRSS;
swiftly.parseAtom = parseAtom;
swiftly.parseSitemap = parseSitemap;
swiftly.parseCSV = parseCSV;
swiftly.toCSV = toCSV;
swiftly.queryJSON = queryJSON;
swiftly.extractLinks = extractLinks;
swiftly.extractImages = extractImages;
swiftly.extractText = extractText;
swiftly.extractMeta = extractMeta;
swiftly.extractTables = extractTables;
swiftly.extractForms = extractForms;
swiftly.extractJsonLd = extractJsonLd;
swiftly.extractJSON = extractJSON;
swiftly.sanitizeHtml = sanitizeHtml;
swiftly.htmlToMarkdown = htmlToMarkdown;

export default swiftly;
export {
    events,
    parseHTML,
    parseXML,
    parseXMLTree,
    xmlToString,
    parseRSS,
    parseAtom,
    parseSitemap,
    parseCSV,
    toCSV,
    queryJSON,
    extractLinks,
    extractImages,
    extractText,
    extractMeta,
    extractTables,
    extractForms,
    extractJsonLd,
    extractJSON,
    sanitizeHtml,
    htmlToMarkdown
};