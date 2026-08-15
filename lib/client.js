/**
 * HTTP Client Implementation
 * @author Cognima
 * @license MIT
 */

'use strict';

import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import tls from 'node:tls';
import zlib from 'node:zlib';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { generateHeaders } from './headers.js';
import { detectResponseType, delay, buildQueryString, isValidUrl, deepMerge } from './utils.js';
import { createEventEmitter, events } from './events.js';
import { createInterceptorManager, createCookieJar } from './interceptor.js';
import { createRateLimiter } from './rate-limiter.js';
import { createCacheStore } from './cache.js';
import { getAgent, destroyAgents } from './agent.js';
import {
    SwiftlyError,
    ValidationError,
    RequestError,
    ResponseError,
    CircuitBreakerError,
    TimeoutError,
    AbortError
} from './errors.js';

// Lazy singleton for the optional undici transport — loaded once, shared by
// every client. Keeps the default path zero-dependency.
let undiciRequestFn = null;
let undiciLoading = null;
async function loadUndici() {
    if (undiciRequestFn) return undiciRequestFn;
    if (!undiciLoading) {
        undiciLoading = import('undici').then((mod) => {
            undiciRequestFn = mod.request;
            return undiciRequestFn;
        }).catch((e) => {
            undiciLoading = null;
            throw e;
        });
    }
    return undiciLoading;
}

// Lookup table for valid HTTP methods (faster than Array#includes in hot paths)
const VALID_METHODS = Object.freeze({
    GET: true, POST: true, PUT: true, DELETE: true, PATCH: true, HEAD: true, OPTIONS: true
});

class CircuitBreaker {
    constructor(config = {}) {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.config = {
            failureThreshold: 5,
            resetTimeout: 60000, // 1 minuto
            ...config
        };
        this.events = createEventEmitter();
    }

    async execute(command, domain) {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailureTime > this.config.resetTimeout) {
                this.state = 'HALF-OPEN';
                this.events.emit('circuit:half-open', { domain });
            } else {
                this.events.emit('circuit:rejected', { domain, state: this.state });
                throw new CircuitBreakerError('Circuit breaker is OPEN', domain);
            }
        }

        try {
            const result = await command();
            if (this.state === 'HALF-OPEN') {
                this.state = 'CLOSED';
                this.failureCount = 0;
                this.events.emit('circuit:close', { domain });
            }
            return result;
        } catch (error) {
            this.handleFailure(domain);
            throw error;
        }
    }

    handleFailure(domain) {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.failureCount >= this.config.failureThreshold) {
            this.state = 'OPEN';
            this.events.emit('circuit:open', {
                domain,
                failureCount: this.failureCount,
                resetTimeout: this.config.resetTimeout
            });
        }
    }

    getState() {
        return {
            state: this.state,
            failureCount: this.failureCount,
            lastFailureTime: this.lastFailureTime
        };
    }
}

class HTTPClient {
    constructor(config = {}) {
        this.config = {
            // Socket timeout is OPT-IN (perf-first, like axios's default of 0):
            // no per-request timer is created unless `timeout` is set.
            timeout: null,
            retries: 3,
            retryDelay: 1000,
            humanize: false, // Performance-first: no artificial delay
            followRedirects: true,
            maxRedirects: 5,
            validateSSL: true,
            useHttp2: false,
            debug: false, // Silent by default
            randomizeHeaders: false,
            cache: {
                enabled: true,
                ttl: 300000, // 5 minutos
                maxSize: 1000
            },
            rateLimiting: {
                enabled: false, // Performance-first: no throttle by default
                requestsPerSecond: 2,
                maxDelay: 64000,
                minDelay: 1000
            },
            compression: {
                request: true,
                response: true,
                minSize: 1024,   // Min bytes to gzip request payload
                responseMinSize: 0 // Min bytes to decompress response
            },
            // Timer-based timeouts are OPT-IN (perf-first): `config.timeout`
            // still guards the socket natively, but the connect/response/idle
            // timers only run when `timeouts` is explicitly configured.
            timeouts: null,
            session: {
                ttl: 3600000,    // 1 hora
                maxSessions: 100,
                autoCleanup: true
            },
            circuitBreaker: {
                enabled: false, // Desabilitado por padrão - ativar manualmente
                failureThreshold: 5,
                resetTimeout: 60000
            },
            proxy: null, // Proxy configuration { host, port, auth? }
            baseURL: null, // Base URL for all requests
            responseEncoding: 'utf-8',
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            decompress: true,

            // Connection pooling (keep-alive Agents per origin)
            keepAlive: true,
            maxSockets: Infinity,
            maxFreeSockets: 256,
            agent: null, // custom http.Agent / https.Agent override

            // Auth helpers
            auth: null,      // { username, password } -> Basic auth
            bearer: null,    // -> Authorization: Bearer <token>
            token: null,     // -> Authorization: <token>

            // Retry refinements
            retryOn: null,          // number[], or (error) => boolean
            retryBackoff: null,     // exponential factor (>=1); default: linear
            retryJitter: false,     // adds randomized jitter to backoff
            maxRetryAfter: 60000,   // cap for Retry-After honored delay
            onRetry: null,          // (attempt, error, delay) => void

            // Hooks (informational)
            onRequest: null,
            onResponse: null,
            onError: null,
            onDownloadProgress: null,
            onUploadProgress: null,

            // Streaming
            stream: false,

            // Transport: 'http' (default) | 'undici' (optional, lazy-loaded)
            transport: 'http',
            ...config
        };

        // Initialize core components
        this.events = createEventEmitter();
        this.interceptors = {
            request: createInterceptorManager(),
            response: createInterceptorManager()
        };
        this.cookieJar = createCookieJar();
        this.rateLimiter = createRateLimiter(this.config.rateLimiting);
        this.cache = createCacheStore(this.config.cache);

        // Connection pooling
        this.connectionPool = new Map();
        this.http2Sessions = new Map();

        // Session management
        this.sessions = new Map();
        this.sessionConfig = this.config.session;

        // Response transformers and validators
        this.responseTransformers = new Map();
        this.responseValidators = new Map();

        // Circuit breakers per domain
        this.circuitBreakers = new Map();

        // Route metrics
        this.routeMetrics = new Map();

        // Stale-while-revalidate in-flight refreshes
        this._refreshing = new Set();

        // Request deduplication map
        this.pendingRequests = new Map();

        // Hot-path caches: merged configs keyed by the user's config object
        // (same object is usually reused across requests) and parsed URLs
        // keyed by the URL string (polling/hot endpoints repeat the same URL).
        this._mergeCache = new WeakMap();
        this._urlCache = new Map();

        // Initialize metrics
        this.metrics = {
            requestCount: 0,
            totalTime: 0,
            cacheHits: 0,
            cacheMisses: 0,
            retries: 0,
            successCount: 0,
            errorCount: 0,
            averageResponseTime: 0,
            lastRequestTime: 0,
            totalDataTransferred: 0,
            http2Requests: 0,
            redirects: 0,
            activeSessions: 0,
            pooledConnections: 0,
            routeTimes: new Map() //Added for route response times
        };

        // Request deduplication map
        this.pendingRequests = new Map();

        // Register default transformers and validators
        this._registerDefaultTransformers();
        this._registerDefaultValidators();

        // Auto cleanup timer for sessions
        this._cleanupInterval = null;
        if (this.config.session.autoCleanup) {
            this._cleanupInterval = setInterval(() => this._cleanupSessions(), this.config.session.ttl);
            // Allow process to exit even with interval running
            if (this._cleanupInterval.unref) {
                this._cleanupInterval.unref();
            }
        }
    }

    // Método auxiliar para logs melhorado
    _log(level, ...args) {
        if (!this.config.debug) return;

        const timestamp = new Date().toISOString();
        switch (level) {
            case 'error':
                console.error(`[Swiftly ${timestamp}]`, ...args);
                break;
            case 'info':
                console.info(`[Swiftly ${timestamp}]`, ...args);
                break;
            case 'debug':
                console.log(`[Swiftly ${timestamp}]`, ...args);
                break;
        }
    }

    // Validação de parâmetros
    _validateRequestParams(method, url, data = null, config = {}) {
        // Fast path: common valid case (absolute URL, known method, no custom headers)
        if (
            typeof method === 'string' &&
            VALID_METHODS[method] &&
            typeof url === 'string' &&
            url.charCodeAt(0) === 104 && // 'h' — http(s):// absolute URL
            (data === null || typeof data === 'object' || typeof data === 'string') &&
            (config === undefined || config === null || typeof config === 'object') &&
            !(config && config.headers)
        ) {
            return;
        }

        const errors = [];

        if (!method || typeof method !== 'string') {
            errors.push('Method is required and must be a string');
        }

        if (!url) {
            errors.push('URL is required');
        } else if (typeof url !== 'string') {
            errors.push('URL must be a string');
        } else {
            // Verificar se é URL relativa ou absoluta
            const isRelativeUrl = url.startsWith('/') || !url.includes('://');
            const hasBaseURL = this.config && this.config.baseURL;
            
            // URLs relativas precisam de baseURL configurado
            if (isRelativeUrl && !hasBaseURL) {
                errors.push(`Relative URL "${url}" requires baseURL to be configured`);
            }
            // URLs absolutas precisam ter formato válido - mas só valida se tiver protocolo
            // Não validar novamente aqui pois _formatUrl já vai tratar
        }

        if (data !== null) {
            if (typeof data !== 'object' && typeof data !== 'string') {
                errors.push('Data must be an object, string or null');
            }
            // Permitir plain objects, arrays e Buffers
            if (typeof data === 'object' && !Array.isArray(data) && data.constructor !== Object && !(data instanceof Buffer)) {
                errors.push('Data object must be a plain object, array or Buffer');
            }
        }

        if (config && typeof config !== 'object') {
            errors.push('Config must be an object');
        }

        // Validate custom headers
        if (config && config.headers) {
            if (typeof config.headers !== 'object') {
                errors.push('Headers must be an object');
            } else {
                for (const [key, value] of Object.entries(config.headers)) {
                    if (typeof value !== 'string' && typeof value !== 'number') {
                        errors.push(`Header "${key}" must be a string or number, got ${typeof value}`);
                    }
                }
            }
        }

        if (!VALID_METHODS[method.toUpperCase()]) {
            errors.push(`Invalid method: ${method}. Valid methods are: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS`);
        }

        if (errors.length > 0) {
            throw new ValidationError(`Validation failed:\n- ${errors.join('\n- ')}`, {
                method,
                url,
                data,
                config
            });
        }
    }

    // Método auxiliar para formatar URL
    _formatUrl(url, params) {
        // Fast path: no baseURL and no extra params -> use the URL as-is.
        if (!this.config.baseURL && !params) {
            return url;
        }
        try {
            // Apply baseURL if configured and url is relative
            let fullUrl = url;
            if (this.config.baseURL && !url.startsWith('http')) {
                const base = this.config.baseURL.replace(/\/$/, '');
                const path = url.startsWith('/') ? url : '/' + url;
                fullUrl = base + path;
            }
            
            const urlObj = new URL(fullUrl);
            if (params) {
                const qs = buildQueryString(params);
                if (qs) {
                    urlObj.search = urlObj.search ? `${urlObj.search}&${qs}` : `?${qs}`;
                }
            }
            return urlObj.toString();
        } catch (error) {
            throw new Error(`Invalid URL: ${url}`);
        }
    }

    // Métodos HTTP melhorados
    async get(url, config = {}) {
        this._validateRequestParams('GET', url, null, config);
        this._log('info', `GET request to ${url}`);

        return this.request('GET', url, null, config).catch((error) => {
            this._log('error', `GET request failed: ${error.message}`);
            throw error;
        });
    }

    async post(url, data = null, config = {}) {
        this._validateRequestParams('POST', url, data, config);
        this._log('info', `POST request to ${url}`);

        if (config.formData && !data) {
            throw new ValidationError('Form data is required when formData option is enabled');
        }
        return this.request('POST', url, data, config).catch((error) => {
            this._log('error', `POST request failed: ${error.message}`);
            throw error;
        });
    }

    async put(url, data = null, config = {}) {
        this._validateRequestParams('PUT', url, data, config);
        this._log('info', `PUT request to ${url}`);

        return this.request('PUT', url, data, config).catch((error) => {
            this._log('error', `PUT request failed: ${error.message}`);
            throw error;
        });
    }

    async delete(url, config = {}) {
        this._validateRequestParams('DELETE', url, null, config);
        this._log('info', `DELETE request to ${url}`);

        return this.request('DELETE', url, null, config).catch((error) => {
            this._log('error', `DELETE request failed: ${error.message}`);
            throw error;
        });
    }

    async patch(url, data = null, config = {}) {
        this._validateRequestParams('PATCH', url, data, config);
        this._log('info', `PATCH request to ${url}`);

        return this.request('PATCH', url, data, config).catch((error) => {
            this._log('error', `PATCH request failed: ${error.message}`);
            throw error;
        });
    }

    async head(url, config = {}) {
        this._validateRequestParams('HEAD', url, null, config);
        this._log('info', `HEAD request to ${url}`);

        return this.request('HEAD', url, null, config).catch((error) => {
            this._log('error', `HEAD request failed: ${error.message}`);
            throw error;
        });
    }

    async options(url, config = {}) {
        this._validateRequestParams('OPTIONS', url, null, config);
        this._log('info', `OPTIONS request to ${url}`);

        return this.request('OPTIONS', url, null, config).catch((error) => {
            this._log('error', `OPTIONS request failed: ${error.message}`);
            throw error;
        });
    }

    _registerDefaultTransformers() {
        // JSON transformer (synchronous so the hot path skips the extra await)
        this.responseTransformers.set('json', (data) => {
            try {
                const text = data.toString('utf-8');
                if (!text.length) {
                    throw new Error('Empty response body');
                }
                // Strip UTF-8 BOM if present (JSON.parse rejects it), avoids a full trim()
                if (text.charCodeAt(0) === 0xFEFF) {
                    return JSON.parse(text.slice(1));
                }
                return JSON.parse(text);
            } catch (e) {
                throw new Error(`Invalid JSON response: ${e.message}`);
            }
        });

        // Text transformer
        this.responseTransformers.set('text', (data) => {
            return data.toString('utf-8');
        });

        // HTML transformer with basic validation
        this.responseTransformers.set('html', (data) => {
            const text = data.toString('utf-8');
            if (!text.includes('<!DOCTYPE html>') && !text.includes('<html')) {
                throw new Error('Invalid HTML response');
            }
            return text;
        });

        // Buffer passthrough
        this.responseTransformers.set('buffer', (data) => data);
    }

    _registerDefaultValidators() {
        // JSON Schema validator
        this.responseValidators.set('json', (data, schema) => {
            if (!schema) return true;
            try {
                // Basic schema validation
                for (const [key, type] of Object.entries(schema)) {
                    if (typeof data[key] !== type) {
                        throw new Error(`Invalid type for ${key}`);
                    }
                }
                return true;
            } catch (error) {
                throw new Error(`Schema validation failed: ${error.message}`);
            }
        });

        // HTML validator - garante que data é string
        this.responseValidators.set('html', (data) => {
            const text = Buffer.isBuffer(data) ? data.toString('utf-8') : String(data || '');
            return text.includes('<!DOCTYPE') || text.includes('<html');
        });
    }

    _cleanupSessions() {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [domain, session] of this.sessions.entries()) {
            if (now - session.lastAccess > this.sessionConfig.ttl) {
                this.sessions.delete(domain);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            this.metrics.activeSessions = this.sessions.size;
            this.events.emit('sessions:cleanup', { cleaned: cleanedCount });
        }
    }

    async _getSession(domain) {
        let session = this.sessions.get(domain);

        // Clean expired sessions
        if (this.sessions.size > this.sessionConfig.maxSessions) {
            for (const [key, sess] of this.sessions.entries()) {
                if (Date.now() - sess.lastAccess > this.sessionConfig.ttl) {
                    this.sessions.delete(key);
                }
            }
        }

        if (!session || Date.now() - session.lastAccess > this.sessionConfig.ttl) {
            session = {
                cookies: new Map(),
                lastAccess: Date.now(),
                customHeaders: new Map()
            };
            this.sessions.set(domain, session);
        }

        session.lastAccess = Date.now();
        return session;
    }



    // Bounded URL cache — `new URL()` runs every request; hot endpoints and
    // polling repeat the same URL string, so cache the parsed object.
    _parseUrl(url) {
        const cached = this._urlCache.get(url);
        if (cached) return cached;
        const parsed = new URL(url);
        if (this._urlCache.size > 1024) this._urlCache.clear();
        this._urlCache.set(url, parsed);
        return parsed;
    }

    _mergeConfig(customConfig) {
        // Fast path: use the instance defaults directly.
        if (!customConfig || Object.keys(customConfig).length === 0) {
            return this.config;
        }
        // Config objects are typically reused across requests — cache the merge
        // by object reference. `this.config` can only change via setConfig/clone,
        // which reset the cache.
        const cached = this._mergeCache.get(customConfig);
        if (cached) return cached;
        // Shallow copy + merge nested objects only when the key is provided.
        const merged = { ...this.config };
        for (const key in customConfig) {
            const v = customConfig[key];
            const base = this.config[key];
            if (v && typeof v === 'object' && !Array.isArray(v) &&
                base && typeof base === 'object' && !Array.isArray(base)) {
                merged[key] = { ...base, ...v };
            } else {
                merged[key] = v;
            }
        }
        this._mergeCache.set(customConfig, merged);
        return merged;
    }

    _emit(event, factory) {
        if (this.events.hasListeners(event)) {
            this.events.emit(event, factory());
        }
    }

    async request(method, url, data = null, customConfig = {}) {
        const startTime = Date.now();
        const config = this._mergeConfig(customConfig);
        const upperMethod = method.toUpperCase();
        const isGet = upperMethod === 'GET';
        // URL formatting centralized here (baseURL + params applied once).
        const formattedUrl = this._formatUrl(url, config.params);

        // Cache lookup FIRST — on a hit we skip URL parsing, route keys,
        // dedup bookkeeping and event emission entirely (fast path).
        if (config.cache.enabled && isGet && !config.stream) {
            const cacheKey = this.cache.getCacheKey(upperMethod, formattedUrl, data, config.cache);
            if (config.cache.staleWhileRevalidate) {
                const peeked = this.cache.peek(cacheKey);
                if (peeked) {
                    this.metrics.cacheHits++;
                    this._emit(events.CACHE_HIT, () => ({ url: formattedUrl, stale: peeked.stale }));
                    if (peeked.stale && !this._refreshing.has(cacheKey)) {
                        this._refreshing.add(cacheKey);
                        this._refreshCacheEntry(cacheKey, upperMethod, formattedUrl, data, config)
                            .catch(() => {})
                            .finally(() => this._refreshing.delete(cacheKey));
                    }
                    return peeked.value;
                }
            } else {
                const cachedResponse = this.cache.get(cacheKey);
                if (cachedResponse) {
                    this.metrics.cacheHits++;
                    this._emit(events.CACHE_HIT, () => ({ url: formattedUrl }));
                    return cachedResponse;
                }
            }
            this.metrics.cacheMisses++;
            this._emit(events.CACHE_MISS, () => ({ url: formattedUrl }));
        }

        const urlObj = this._parseUrl(formattedUrl);
        // routeKey only needed when route times are tracked (opt-in)
        const routeKey = config.trackRouteTimes
            ? `${upperMethod} ${urlObj.pathname}`
            : null;

        // Request deduplication for GET requests (skipped for streams)
        if (isGet && config.deduplicate !== false && !config.stream) {
            const dedupKey = `${upperMethod}:${formattedUrl}`;
            const pending = this.pendingRequests.get(dedupKey);
            if (pending) {
                this._log('debug', `Deduplicating request: ${dedupKey}`);
                return pending;
            }
        }

        // Event: Request Start
        this._emit(events.REQUEST_START, () => ({ method: upperMethod, url: formattedUrl, config }));

        // Create request promise for deduplication
        const dedupKey = isGet && !config.stream ? `${upperMethod}:${formattedUrl}` : null;
        const requestPromise = this._executeRequest(upperMethod, formattedUrl, data, config, startTime, routeKey, urlObj);

        if (dedupKey && config.deduplicate !== false) {
            this.pendingRequests.set(dedupKey, requestPromise);
            // Clean up dedup key when done (catch to prevent unhandled rejection)
            requestPromise
                .catch(() => {}) // Silently handle - actual error is thrown to caller
                .finally(() => this.pendingRequests.delete(dedupKey));
        }

        return requestPromise;
    }

    // Background refresh for stale-while-revalidate cache entries.
    async _refreshCacheEntry(cacheKey, method, url, data, config) {
        try {
            const result = await this._executeRequest(
                method, url, data,
                { ...config, cache: { enabled: false }, stream: false },
                Date.now(), null, new URL(url)
            );
            if (result !== undefined && result !== null) {
                this.cache.set(cacheKey, result, config.cache.ttl);
            }
        } catch (_) { /* keep stale entry on failure */ }
    }

    async _executeRequest(method, url, data, config, startTime, routeKey, urlObj) {
        // Abort before doing any work if the signal already fired
        if (config.signal && config.signal.aborted) {
            throw new AbortError();
        }

        // Rate Limiting
        if (config.rateLimiting.enabled) {
            try {
                await this.rateLimiter.checkLimit(urlObj.hostname, config.rateLimiting);
            } catch (error) {
                this.events.emit(events.RATE_LIMIT, { url, error: error.message });
                throw error;
            }
        }

        // Stream mode disables retries/redirect-then-retry semantics
        const streamMode = !!config.stream;
        if (streamMode && config.retries > 1) {
            config = { ...config, retries: 1 };
        }

        const options = {
            method: method,
            hostname: urlObj.hostname,
            port: urlObj.port ? Number(urlObj.port) : undefined,
            path: urlObj.pathname + urlObj.search,
            headers: generateHeaders(config),
            // Only create a native socket timer when a timeout is configured.
            timeout: typeof config.timeout === 'number' ? config.timeout : undefined,
            rejectUnauthorized: config.validateSSL,
            config // Store original config for interceptors
        };

        // Connection pooling: per-origin keep-alive Agent
        if (config.agent) {
            options.agent = config.agent;
        } else if (!config.transport || config.transport === 'http') {
            const hostKey = `${urlObj.hostname}:${urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80)}`;
            options.agent = getAgent(urlObj.protocol, hostKey, config, this.connectionPool);
        }

        // Add cookies from jar
        const cookies = this.cookieJar.getCookies(urlObj.hostname);
        if (cookies) {
            options.headers['Cookie'] = cookies;
        }

        // Auth helpers (only when no explicit Authorization header is set)
        if (!options.headers['Authorization']) {
            if (config.auth && config.auth.username !== undefined) {
                options.headers['Authorization'] = 'Basic ' +
                    Buffer.from(`${config.auth.username}:${config.auth.password || ''}`).toString('base64');
            } else if (config.bearer) {
                options.headers['Authorization'] = `Bearer ${config.bearer}`;
            } else if (config.token) {
                options.headers['Authorization'] = config.token;
            }
        }

        // Handle multipart/form-data
        if (data && config.formData) {
            const formData = await this._createFormData(data);
            data = formData.data;
            options.headers['Content-Type'] = `multipart/form-data; boundary=${formData.boundary}`;
        } else if (data && typeof data === 'object' && !Buffer.isBuffer(data) && !(data instanceof Readable) && !options.headers['Content-Type']) {
            options.headers['Content-Type'] = 'application/json';
        }

        // Comprimir payload se necessário (apenas objetos/arrays, não Buffers/streams)
        if (data && typeof data === 'object' && !Buffer.isBuffer(data) && !(data instanceof Readable) && !options.headers['Content-Encoding']) {
            const compressedData = await this._compressData(data);
            data = compressedData.data;
            options.headers['Content-Encoding'] = compressedData.encoding;
        }

        // Process request through interceptors (fast path when none are set)
        let finalOptions = options;
        if (this.interceptors.request.handlers.length > 0) {
            try {
                finalOptions = await this.interceptors.request.executeRequestChain(options);
            } catch (error) {
                throw new RequestError('Request interceptor error', {
                    original: error,
                    options
                });
            }
        }

        let attempt = 0;
        let redirectCount = config.redirectCount || 0;
        
        // Só criar circuit breaker se estiver habilitado
        let circuitBreaker = null;
        if (config.circuitBreaker && config.circuitBreaker.enabled) {
            circuitBreaker = this.circuitBreakers.get(urlObj.hostname);
            if (!circuitBreaker) {
                circuitBreaker = new CircuitBreaker(config.circuitBreaker);
                this.circuitBreakers.set(urlObj.hostname, circuitBreaker);
            }
        }

        // Simulate human-like delay if enabled (outside the hot path)
        if (config.humanize) {
            await delay(Math.random() * 1000 + 500, config.signal);
        }

        // onRequest hook (informational)
        if (config.onRequest) {
            try { config.onRequest({ method, url, options: finalOptions }); } catch (_) {}
        }

        const useHttp2 = config.useHttp2 && urlObj.protocol === 'https:' && !streamMode;
        // Transport selection: node:http (default) or optional undici (lazy)
        const useUndici = config.transport === 'undici' && !useHttp2 && !streamMode;
        // Plain function returning a promise — avoids an extra async/await hop per request
        const performRequest = useUndici
            ? () => this._undiciRequest(urlObj, finalOptions, data)
            : useHttp2
                ? () => this._makeHttp2Request(urlObj, finalOptions, data)
                : () => this._makeRequest(urlObj.protocol, finalOptions, data);

        while (attempt < config.retries) {
            try {
                // Executar com ou sem circuit breaker dependendo da configuração
                const response = circuitBreaker
                    ? await circuitBreaker.execute(performRequest, urlObj.hostname)
                    : await performRequest();
                if (useHttp2) this.metrics.http2Requests++;

                // Server errors (5xx) are transient failures of the downstream
                // service, so they must count toward the circuit breaker like
                // transport failures do. We count them here (after the request
                // returns, before the transform/interceptor path) so the normal
                // response handling and retry logic are preserved unchanged.
                if (circuitBreaker && response.status >= 500) {
                    circuitBreaker.handleFailure(urlObj.hostname);
                }

                // Handle redirects
                if (config.followRedirects && [301, 302, 303, 307, 308].includes(response.status)) {
                    if (redirectCount >= config.maxRedirects) {
                        const err = new Error(`Max redirects exceeded (${config.maxRedirects})`);
                        err.code = 'MAX_REDIRECTS';
                        err._noRetry = true;
                        throw err;
                    }
                    redirectCount++;
                    this.metrics.redirects++;

                    const location = response.headers.location;
                    this.events.emit(events.REDIRECT, { from: url, to: location });

                    // Converter URL relativa em absoluta se necessário
                    const redirectUrl = location.startsWith('http') ? location : new URL(location, url).href;
                    // Destroy an unconsumed stream before following the redirect
                    if (response.data && typeof response.data.destroy === 'function') {
                        response.data.destroy();
                    }
                    // Propagate the redirect counter (bounded chains), disable
                    // dedup/params so self-referential loops don't deadlock or re-append.
                    return this.request(method, redirectUrl, data, {
                        ...config,
                        params: undefined,
                        redirectCount,
                        deduplicate: false
                    });
                }

                // Store cookies from response
                const responseCookies = response.headers['set-cookie'];
                if (Array.isArray(responseCookies)) {
                    responseCookies.forEach(cookie => {
                        this.cookieJar.setCookie(urlObj.hostname, cookie);
                    });
                }

                // Process response through interceptors (fast path when none are set)
                const processedResponse = this.interceptors.response.handlers.length > 0
                    ? await this.interceptors.response.executeResponseChain(response)
                    : response;

                // Update metrics
                const requestTime = Date.now() - startTime;
                processedResponse.duration = requestTime;
                const bodyLength = processedResponse.data
                    ? (processedResponse.data.length ?? 0)
                    : 0;
                this.metrics.requestCount++;
                this.metrics.totalTime += requestTime;
                this.metrics.successCount++;
                this.metrics.lastRequestTime = requestTime;
                this.metrics.totalDataTransferred += bodyLength;

                // Update route metrics (opt-in to keep the hot path lean)
                if (config.trackRouteTimes) {
                    let routeTime = this.routeMetrics.get(routeKey) || { count: 0, totalTime: 0 };
                    routeTime.count++;
                    routeTime.totalTime += requestTime;
                    this.routeMetrics.set(routeKey, routeTime);
                    this.metrics.routeTimes.set(routeKey, routeTime.totalTime / routeTime.count);
                }

                // Event: Request End
                this._emit(events.REQUEST_END, () => ({
                    method,
                    url,
                    status: processedResponse.status,
                    time: requestTime,
                    size: bodyLength
                }));

                // For HEAD requests, return headers only
                if (method === 'HEAD') {
                    return processedResponse.headers;
                }

                // For OPTIONS requests, return headers
                if (method === 'OPTIONS') {
                    return processedResponse.headers;
                }

                // Stream mode: hand back the raw (decompressed) Readable
                if (streamMode) {
                    if (config.onResponse) {
                        try { config.onResponse(processedResponse.data, processedResponse); } catch (_) {}
                    }
                    return processedResponse.data;
                }

                // _processResponse is synchronous for sync transformers — only
                // await when a (user) transformer actually returns a promise.
                const processed = this._processResponse(processedResponse, config.responseType);
                const result = processed && typeof processed.then === 'function'
                    ? await processed
                    : processed;

                // Validate the parsed body the caller actually receives. This runs
                // after transformers so `result` is the real (e.g. JSON) object.
                if (config.responseSchema && !streamMode && config.responseType !== 'raw') {
                    const type = detectResponseType(processedResponse.headers['content-type'] || '');
                    const validator = this.responseValidators.get(type);
                    if (validator) {
                        validator(result, config.responseSchema);
                    }
                }

                // Cache the final result (consistent shape with cache hits)
                if (config.cache.enabled && method === 'GET' && processedResponse.status === 200 && !streamMode) {
                    const cacheKey = this.cache.getCacheKey(method, url, data, config.cache);
                    this.cache.set(cacheKey, result, config.cache.ttl);
                    this._emit(events.CACHE_STORE, () => ({ url }));
                }

                if (config.onResponse) {
                    try { config.onResponse(result, processedResponse); } catch (_) {}
                }

                return result;
            } catch (error) {
                // Never retry hard errors (max redirects, abort, stream errors)
                if (error._noRetry || error instanceof AbortError) {
                    this.metrics.errorCount++;
                    this.events.emit(events.REQUEST_ERROR, error);
                    if (config.onError) { try { config.onError(error); } catch (_) {} }
                    throw error;
                }

                // Get status from error response
                const status = error.response?.status ||
                               error.context?.response?.status;

                // Decide whether to retry: explicit retryOn overrides the default
                let shouldRetry;
                if (config.retryOn) {
                    shouldRetry = Array.isArray(config.retryOn)
                        ? (status !== undefined && config.retryOn.includes(status))
                        : config.retryOn(error) === true;
                } else {
                    // Don't retry on client errors (4xx) except 429 (rate limit)
                    shouldRetry = !(status >= 400 && status < 500 && status !== 429);
                }

                if (!shouldRetry) {
                    this.metrics.errorCount++;
                    this.events.emit(events.REQUEST_ERROR, error);
                    if (config.onError) { try { config.onError(error); } catch (_) {} }
                    throw error;
                }

                attempt++;
                this.metrics.retries++;
                this.metrics.errorCount++;

                // Wrap only raw errors; keep typed SwiftlyErrors (ResponseError, TimeoutError, etc.)
                if (!(error instanceof SwiftlyError)) {
                    error = new RequestError(error.message, {
                        original: error,
                        method,
                        url,
                        config
                    });
                }

                // Backoff: exponential factor when retryBackoff set, else linear
                let nextDelay = config.retryBackoff
                    ? config.retryDelay * Math.pow(config.retryBackoff, attempt - 1)
                    : config.retryDelay * attempt;

                // Honor Retry-After when the server asks for it (capped)
                const retryAfter = error.response?.headers?.['retry-after'] ??
                                   error.context?.response?.headers?.['retry-after'];
                if (retryAfter) {
                    const secs = parseInt(retryAfter, 10);
                    if (!isNaN(secs)) {
                        nextDelay = Math.min(secs * 1000, config.maxRetryAfter ?? Infinity);
                    }
                }

                // Optional jitter to avoid thundering herds
                if (config.retryJitter) {
                    const jitterMax = config.retryJitter === true ? nextDelay : config.retryJitter;
                    nextDelay += Math.random() * jitterMax;
                }

                if (config.onRetry) {
                    try { config.onRetry(attempt, error, nextDelay); } catch (_) {}
                }

                this.events.emit(events.RETRY_ATTEMPT, {
                    attempt,
                    error: error.message,
                    nextRetryDelay: nextDelay
                });

                if (attempt === config.retries) {
                    this.events.emit(events.REQUEST_ERROR, error);
                    if (config.onError) { try { config.onError(error); } catch (_) {} }
                    throw error;
                }

                await delay(nextDelay, config.signal);
            }
        }
    }

    async _makeHttp2Request(urlObj, options, data) {
        const authority = `${urlObj.hostname}:${urlObj.port || 443}`;

        let session = this.http2Sessions.get(authority);
        if (!session || session.destroyed) {
            session = http2.connect(urlObj.href, {
                rejectUnauthorized: options.rejectUnauthorized
            });
            this.http2Sessions.set(authority, session);

            session.on('error', () => {
                this.http2Sessions.delete(authority);
            });

            session.on('goaway', () => {
                this.http2Sessions.delete(authority);
            });
        }

        return new Promise((resolve, reject) => {
            const headers = { ...options.headers };
            delete headers['connection'];
            delete headers['keep-alive'];
            delete headers['transfer-encoding'];
            delete headers['upgrade-insecure-requests'];
            delete headers['host'];

            const req = session.request({
                ...headers,
                ':method': options.method,
                ':path': options.path,
                ':authority': urlObj.host,
                ':scheme': 'https'
            });

            // Abort support for HTTP/2
            const signal = options.config?.signal;
            if (signal) {
                if (signal.aborted) {
                    req.destroy(new AbortError());
                } else {
                    const onAbort = () => req.destroy(new AbortError());
                    signal.addEventListener('abort', onAbort, { once: true });
                    req.once('close', () => signal.removeEventListener('abort', onAbort));
                }
            }

            const chunks = [];
            let totalBytes = 0;
            let responseHeaders = null;
            let responseStatus = null;

            req.on('response', (headers) => {
                responseStatus = headers[':status'];
                responseHeaders = { ...headers };
                delete responseHeaders[':status'];
                delete responseHeaders[':method'];
                delete responseHeaders[':path'];
                delete responseHeaders[':authority'];
                delete responseHeaders[':scheme'];
            });

            req.on('data', (chunk) => {
                chunks.push(chunk);
                totalBytes += chunk.length;

                if (responseHeaders) {
                    const total = parseInt(responseHeaders['content-length'], 10) || 0;
                    if (total && this.events.hasListeners(events.PROGRESS)) {
                        this.events.emit(events.PROGRESS, {
                            loaded: totalBytes,
                            total,
                            percent: (totalBytes / total) * 100
                        });
                    }
                }
            });

            req.on('end', () => {
                let body = Buffer.concat(chunks);

                // Decompress response when configured
                const encoding = responseHeaders && responseHeaders['content-encoding'];
                const contentLength = parseInt(responseHeaders && responseHeaders['content-length'], 10) || 0;
                const cfg = options.config || this.config;
                if (cfg.compression.response && cfg.decompress !== false &&
                    contentLength >= cfg.compression.responseMinSize && encoding) {
                    try {
                        if (encoding === 'gzip') {
                            body = zlib.gunzipSync(body);
                        } else if (encoding === 'deflate') {
                            body = zlib.inflateSync(body);
                        } else if (encoding === 'br') {
                            body = zlib.brotliDecompressSync(body);
                        }
                    } catch (e) {
                        reject(new RequestError('Decompression failed', { original: e, options }));
                        return;
                    }
                }

                resolve({
                    data: body,
                    headers: responseHeaders,
                    status: responseStatus,
                    config: options
                });
            });

            req.on('error', reject);

            if (data) {
                if (data instanceof Readable) {
                    data.pipe(req);
                } else {
                    const payload = Buffer.isBuffer(data) ? data : (typeof data === 'string' ? data : JSON.stringify(data));
                    req.write(payload);
                }
            }

            req.end();
        });
    }

    _setupTimeouts(req, options) {
        // Fast path: timers are opt-in. The native socket timeout
        // (`config.timeout`) still guards every request.
        const configured = options.config && options.config.timeouts;
        if (!configured) return;

        const timeouts = {
            connect: configured.connect || 5000,
            response: configured.response || 30000,
            idle: configured.idle || 60000
        };

        let connectTimer = null;
        let responseTimer = null;
        let idleTimer = null;

        const clearAll = () => {
            if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
            if (responseTimer) { clearTimeout(responseTimer); responseTimer = null; }
            if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        };

        // Clean up timers on completion to avoid leaks.
        req.once('close', clearAll);
        req.once('error', clearAll);

        // Connection timeout (covers DNS + connect).
        connectTimer = setTimeout(() => {
            req.destroy(new TimeoutError('Connection timeout', 'connect'));
        }, timeouts.connect);

        // Response timeout: starts once a socket is assigned; cleared on headers.
        req.once('socket', () => {
            if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
            responseTimer = setTimeout(() => {
                req.destroy(new TimeoutError('Response timeout', 'response'));
            }, timeouts.response);
        });

        // Idle timeout between chunks: resets on each data event.
        // Skipped in stream mode — a data listener would consume the body
        // before the caller starts reading it.
        req.once('response', (res) => {
            if (responseTimer) { clearTimeout(responseTimer); responseTimer = null; }

            const isStreaming = !!(options.config && options.config.stream);
            if (isStreaming) return;

            const startIdle = () => {
                if (idleTimer) { clearTimeout(idleTimer); }
                idleTimer = setTimeout(() => {
                    req.destroy(new TimeoutError('Idle timeout', 'idle'));
                }, timeouts.idle);
            };

            startIdle();
            res.on('data', startIdle);
            res.once('end', () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } });
            res.once('error', clearAll);
        });
    }

    _prepareHostname(options) {
        if (!options.hostname || !options.hostname.includes(':')) return;
        // Remove brackets if present
        options.hostname = options.hostname.replace(/^\[|\]$/g, '');
        // Validate IPv6 format (including compressed notation with ::)
        const ipv6Pattern = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|::)$/;
        if (!ipv6Pattern.test(options.hostname)) {
            throw new ValidationError('Invalid IPv6 address format', { hostname: options.hostname });
        }
        // Add brackets back for HTTP request
        options.hostname = `[${options.hostname}]`;
    }

    _attachSignal(req, options) {
        const signal = options.config?.signal;
        if (!signal) return;
        if (signal.aborted) {
            req.destroy(new AbortError());
            return;
        }
        const onAbort = () => {
            this.events.emit(events.ABORT, { url: options.path });
            req.destroy(new AbortError());
        };
        signal.addEventListener('abort', onAbort, { once: true });
        req.once('close', () => signal.removeEventListener('abort', onAbort));
    }

    _enhanceError(error, options, protocol) {
        if (error instanceof SwiftlyError) return error;
        switch (error.code) {
            case 'ECONNREFUSED':
                return new RequestError('Connection refused', { original: error, options, protocol });
            case 'ENOTFOUND':
                return new RequestError('Host not found', { original: error, options, protocol });
            case 'ECONNRESET':
                return new RequestError('Connection reset', { original: error, options, protocol });
            case 'ETIMEDOUT':
                return new TimeoutError('Connection timed out', 'connect', { original: error, options, protocol });
            default:
                return new RequestError(error.message, { original: error, options, protocol });
        }
    }

    _sendPayload(req, data, config = {}) {
        if (!data) {
            req.end();
            return;
        }
        if (data instanceof Readable) {
            let loaded = 0;
            data.on('data', (chunk) => {
                loaded += chunk.length;
                const progress = { loaded, total: 0, percent: 0 };
                if (config.onUploadProgress) config.onUploadProgress(progress);
                this._emit(events.UPLOAD_PROGRESS, () => progress);
            });
            data.on('error', (err) => req.destroy(err));
            data.pipe(req);
            return;
        }
        const payload = Buffer.isBuffer(data) ? data : (typeof data === 'string' ? data : JSON.stringify(data));
        const bytes = Buffer.byteLength(payload);
        req.write(payload, () => {
            const progress = { loaded: bytes, total: bytes, percent: 100 };
            if (config.onUploadProgress) config.onUploadProgress(progress);
            this._emit(events.UPLOAD_PROGRESS, () => progress);
        });
        req.end();
    }

    _handleResponseStream(res, options, resolve, reject) {
        const requestCfg = options.config || this.config;
        const isHead = options.method === 'HEAD' || options.method === 'OPTIONS';

        // For HEAD and OPTIONS requests, return immediately with headers only
        if (isHead) {
            resolve({
                data: Buffer.alloc(0),
                headers: res.headers,
                status: res.statusCode,
                config: options
            });
            return;
        }

        // Stream mode: hand back a (decompressed) Readable instead of buffering
        if (requestCfg.stream) {
            const encoding = res.headers['content-encoding'];
            let stream = res;
            if (requestCfg.compression.response && encoding && requestCfg.decompress !== false) {
                if (encoding === 'gzip') {
                    stream = res.pipe(zlib.createGunzip());
                } else if (encoding === 'deflate') {
                    stream = res.pipe(zlib.createInflate());
                } else if (encoding === 'br') {
                    stream = res.pipe(zlib.createBrotliDecompress());
                }
            }
            stream.headers = res.headers;
            stream.status = res.statusCode;
            stream.total = parseInt(res.headers['content-length'], 10) || 0;
            stream.on('error', error => {
                reject(new RequestError('Stream error', { original: error, options }));
            });
            resolve({
                data: stream,
                headers: res.headers,
                status: res.statusCode,
                config: options
            });
            return;
        }

        const chunks = [];
        let stream = res;

        // Handle compressed responses (use per-request config, respect minSize and decompress flag)
        const contentLength = parseInt(res.headers['content-length'], 10) || 0;
        const encoding = res.headers['content-encoding'];
        const isDecompressing = requestCfg.compression.response &&
            requestCfg.decompress !== false &&
            encoding &&
            contentLength >= requestCfg.compression.responseMinSize;
        if (isDecompressing) {
            if (encoding === 'gzip') {
                stream = res.pipe(zlib.createGunzip());
            } else if (encoding === 'deflate') {
                stream = res.pipe(zlib.createInflate());
            } else if (encoding === 'br') {
                stream = res.pipe(zlib.createBrotliDecompress());
            }
        }

        let totalBytes = contentLength;
        let receivedBytes = 0;

        // Fast path: when the response is NOT actually decompressed and the
        // length is known, accumulate straight into a preallocated buffer
        // (avoids the repeated Buffer.concat reallocations that hurt large bodies).
        const canPrealloc = !isDecompressing && contentLength > 0;
        let prealloc = canPrealloc ? Buffer.allocUnsafe(contentLength) : null;
        let writeOffset = 0;

        // Progress events are opt-in — don't build the object when nobody listens.
        const hasProgress = totalBytes > 0 && (
            requestCfg.onDownloadProgress ||
            this.events.hasListeners(events.PROGRESS) ||
            this.events.hasListeners(events.DOWNLOAD_PROGRESS)
        );

        stream.on('data', chunk => {
            receivedBytes += chunk.length;
            if (prealloc) {
                // Single-chunk fast path: the whole body arrived in one event —
                // reuse the chunk buffer directly (no allocUnsafe + copy).
                if (writeOffset === 0 && receivedBytes === contentLength) {
                    prealloc = chunk;
                    writeOffset = contentLength;
                } else {
                    chunk.copy(prealloc, writeOffset);
                    writeOffset += chunk.length;
                }
            } else {
                chunks.push(chunk);
            }

            if (hasProgress) {
                const progress = {
                    loaded: receivedBytes,
                    total: totalBytes,
                    percent: (receivedBytes / totalBytes) * 100
                };
                if (this.events.hasListeners(events.PROGRESS)) {
                    this.events.emit(events.PROGRESS, progress);
                }
                if (this.events.hasListeners(events.DOWNLOAD_PROGRESS)) {
                    this.events.emit(events.DOWNLOAD_PROGRESS, progress);
                }
                if (requestCfg.onDownloadProgress) requestCfg.onDownloadProgress(progress);
            }
        });

        stream.on('end', () => {
            const data = prealloc
                ? (writeOffset === contentLength ? prealloc : prealloc.subarray(0, writeOffset))
                : Buffer.concat(chunks);
            resolve({
                data,
                headers: res.headers,
                status: res.statusCode,
                config: options // Include original config for error handling
            });
        });

        stream.on('error', error => {
            reject(new RequestError('Stream error', {
                original: error,
                options
            }));
        });
    }

    _makeRequest(protocol, options, data) {
        if (options.config && options.config.proxy) {
            return this._makeProxiedRequest(protocol, options, data);
        }

        return new Promise((resolve, reject) => {
            try {
                this._prepareHostname(options);
            } catch (error) {
                return reject(new RequestError('Invalid IPv6 address', {
                    original: error,
                    options,
                    protocol
                }));
            }

            const client = protocol === 'https:' ? https : http;
            const req = client.request(options, (res) => {
                this._handleResponseStream(res, options, resolve, reject);
            });

            this._attachSignal(req, options);
            this._setupTimeouts(req, options);

            req.on('error', error => {
                reject(this._enhanceError(error, options, protocol));
            });

            this._sendPayload(req, data, options.config || {});
        });
    }

    _makeProxiedRequest(protocol, options, data) {
        return new Promise((resolve, reject) => {
            const proxy = options.config.proxy;
            const proxyHost = proxy.host;
            const proxyPort = proxy.port || (protocol === 'https:' ? 443 : 80);
            let proxyAuth = null;
            if (proxy.auth) {
                const creds = typeof proxy.auth === 'string'
                    ? proxy.auth
                    : `${proxy.auth.username}:${proxy.auth.password || ''}`;
                proxyAuth = 'Basic ' + Buffer.from(creds).toString('base64');
            }

            const handler = (res) => this._handleResponseStream(res, options, resolve, reject);

            if (protocol === 'https:') {
                // HTTPS through proxy: establish a CONNECT tunnel first
                const connectReq = http.request({
                    host: proxyHost,
                    port: proxyPort,
                    method: 'CONNECT',
                    path: `${options.hostname}:${options.port || 443}`,
                    headers: proxyAuth ? { 'Proxy-Authorization': proxyAuth } : {}
                });

                connectReq.on('connect', (res, socket) => {
                    if (res.statusCode !== 200) {
                        socket.destroy();
                        reject(new RequestError(`Proxy CONNECT failed: HTTP ${res.statusCode}`, { options, protocol }));
                        return;
                    }
                    this.events.emit(events.PROXY_CONNECT, { host: options.hostname, proxyHost });

                    const servername = String(options.hostname).replace(/^\[|\]$/g, '');
                    const tlsSocket = tls.connect({
                        socket,
                        servername,
                        rejectUnauthorized: options.rejectUnauthorized
                    });

                    const req = https.request({
                        ...options,
                        createConnection: () => tlsSocket,
                        agent: false
                    }, handler);

                    this._attachSignal(req, options);
                    this._setupTimeouts(req, options);
                    req.on('error', error => reject(this._enhanceError(error, options, protocol)));
                    this._sendPayload(req, data, options.config || {});
                });

                connectReq.on('error', error => {
                    reject(new RequestError('Proxy connection failed', { original: error, options, protocol }));
                });
                connectReq.end();
            } else {
                // HTTP through proxy: send the request to the proxy in absolute-form
                const target = `http://${options.hostname}:${options.port || 80}${options.path}`;
                const headers = { ...options.headers, Host: `${options.hostname}:${options.port || 80}` };
                if (proxyAuth) headers['Proxy-Authorization'] = proxyAuth;

                const req = http.request({
                    host: proxyHost,
                    port: proxyPort,
                    method: options.method,
                    path: target,
                    headers,
                    agent: false
                }, handler);

                this._attachSignal(req, options);
                this._setupTimeouts(req, options);
                req.on('error', error => reject(this._enhanceError(error, options, protocol)));
                this._sendPayload(req, data, options.config || {});
            }
        });
    }

    _processResponse(response, responseType) {
        if (response.status >= 400) {
            throw new ResponseError(`HTTP Error ${response.status}`, response);
        }

        const contentType = response.headers['content-type'] || '';
        // 'raw' keeps the auto-detected body type; other responseType values win
        const type = (responseType && responseType !== 'raw')
            ? responseType
            : detectResponseType(contentType);

        // Validate responseType (raw is valid: returns { data, status, headers, config, duration })
        const validTypes = ['json', 'text', 'html', 'buffer', 'raw'];
        if (responseType && !validTypes.includes(responseType)) {
            this._log('error', `Invalid responseType: ${responseType}, falling back to buffer`);
        }

        const transformer = this.responseTransformers.get(type) || this.responseTransformers.get('buffer');
        if (!transformer) {
            this._log('error', `No transformer found for type: ${type}, using buffer`);
            return response.data;
        }

        const finish = (data) => {
            // Full response access (status/headers/duration alongside the parsed body)
            if (responseType === 'raw') {
                return {
                    data,
                    status: response.status,
                    headers: response.headers,
                    config: response.config,
                    duration: response.duration
                };
            }
            return data;
        };

        try {
            const result = transformer(response.data, response.headers);
            // Sync fast path: zero microtasks for the (default) sync transformers.
            if (result && typeof result.then === 'function') {
                return result.then(
                    finish,
                    (error) => { error.response = response; error.type = type; throw error; }
                );
            }
            return finish(result);
        } catch (error) {
            error.response = response;
            error.type = type;
            throw error;
        }
    }

    async _compressData(data) {
        let jsonStr;
        try {
            jsonStr = JSON.stringify(data);
        } catch (error) {
            throw new ValidationError(`Cannot serialize data: ${error.message}`, { data: typeof data });
        }
        
        if (!this.config.compression.request) {
            return { data: jsonStr, encoding: 'identity' };
        }

        if (jsonStr.length < this.config.compression.minSize) {
            return { data: jsonStr, encoding: 'identity' };
        }

        return new Promise((resolve, reject) => {
            zlib.gzip(jsonStr, {
                level: 6, // Balanced compression
                memLevel: 8 // Moderate memory usage
            }, (err, compressed) => {
                if (err) {
                    resolve({ data: jsonStr, encoding: 'identity' });
                } else {
                    resolve({ data: compressed, encoding: 'gzip' });
                }
            });
        });
    }

    async _createFormData(data) {
        if (!data || typeof data !== 'object') {
            throw new ValidationError('FormData must be an object');
        }

        const boundary = `----WebKitFormBoundary${Math.random().toString(36).slice(2)}`;
        const chunks = [];

        for (const [key, value] of Object.entries(data)) {
            if (!key || typeof key !== 'string') {
                throw new ValidationError('FormData keys must be non-empty strings');
            }

            chunks.push(Buffer.from(`\r\n--${boundary}\r\n`));

            if (Buffer.isBuffer(value) || (value && value.buffer instanceof ArrayBuffer)) {
                // Handle file uploads
                const filename = value.name || 'file';
                chunks.push(Buffer.from(`Content-Disposition: form-data; name="${key}"; filename="${filename}"\r\n`));
                chunks.push(Buffer.from(`Content-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`));
                chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value.buffer));
            } else {
                // Handle normal form fields
                chunks.push(Buffer.from(`Content-Disposition: form-data; name="${key}"\r\n\r\n`));
                chunks.push(Buffer.from(String(value)));
            }
        }
        chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));

        return {
            boundary,
            data: Buffer.concat(chunks)
        };
    }

    // GraphQL support
    async query(url, { query, variables = {} } = {}, config = {}) {
        // Support both (url, {query, variables}) and legacy ({query, variables, endpoint})
        let endpoint = url;
        let queryData = query;
        let vars = variables;
        
        // Handle legacy call: query(queryString, variables, {endpoint})
        // Verifica se url parece ser uma query GraphQL ao invés de URL
        if (typeof url === 'string' && (
            url.trim().startsWith('{') || 
            url.trim().startsWith('query') ||
            url.trim().startsWith('mutation')
        )) {
            // Legacy format: query(queryString, variables, config)
            queryData = url;
            vars = query || {};
            endpoint = config.endpoint || '/graphql';
        }
        
        const data = {
            query: queryData,
            variables: vars
        };

        const response = await this.post(endpoint, data, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            ...config
        });
        
        // Return data directly if successful
        if (response && response.data) {
            return response.data;
        }
        
        // Handle GraphQL errors
        if (response && response.errors && response.errors.length > 0) {
            const error = new Error(response.errors[0].message);
            error.graphqlErrors = response.errors;
            throw error;
        }
        
        return response;
    }

    // Server-Sent Events support
    async subscribe(url, callbacks = {}, config = {}) {
        const { onMessage, onError, onOpen } = callbacks;
        const urlObj = new URL(url);
        const options = {
            ...this.config,
            ...config,
            headers: {
                ...generateHeaders(config),
                'Accept': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            }
        };

        return new Promise((resolve, reject) => {
            const client = urlObj.protocol === 'https:' ? https : http;
            const reqOptions = { ...options };
            if (typeof reqOptions.timeout !== 'number') delete reqOptions.timeout;
            const req = client.request(urlObj, reqOptions, (res) => {
                if (res.statusCode !== 200) {
                    const err = new Error(`SSE connection failed: ${res.statusCode}`);
                    if (onError) onError(err);
                    reject(err);
                    return;
                }

                res.setEncoding('utf8');
                let buffer = '';

                if (onOpen) onOpen();
                // Resolve only once the stream is actually established.
                resolve(() => req.destroy());

                res.on('data', (chunk) => {
                    buffer += chunk;
                    const lines = buffer.split('\n');
                    buffer = lines.pop();

                    lines.forEach(line => {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            try {
                                const parsedData = JSON.parse(data);
                                if (onMessage) onMessage(parsedData);
                            } catch (e) {
                                if (onMessage) onMessage(data);
                            }
                        }
                    });
                });

                res.on('error', (error) => {
                    if (onError) onError(error);
                    reject(error);
                });
            });

            req.on('error', (error) => {
                if (onError) onError(error);
                reject(error);
            });

            req.end();
        });
    }

    // Event handling methods
    on(event, callback) {
        return this.events.on(event, callback);
    }

    off(event, callback) {
        return this.events.off(event, callback);
    }

    // Get current metrics
    getMetrics() {
        return {
            ...this.metrics,
            averageResponseTime: this.metrics.requestCount
                ? this.metrics.totalTime / this.metrics.requestCount
                : 0,
            activeSessions: this.sessions.size,
            pooledConnections: this.connectionPool.size,
            http2Sessions: this.http2Sessions.size,
            cacheSize: this.cache.getStats().size,
            circuitBreakers: Array.from(this.circuitBreakers.entries()).map(([domain, cb]) => ({
                domain,
                state: cb.getState()
            }))
        };
    }

    // Clear all caches
    clearCache() {
        this.cache.clear();
        this._log('info', 'Cache cleared');
    }

    // Reset circuit breakers
    resetCircuitBreakers(domain = null) {
        if (domain) {
            this.circuitBreakers.delete(domain);
            this._log('info', `Circuit breaker reset for domain: ${domain}`);
        } else {
            this.circuitBreakers.clear();
            this._log('info', 'All circuit breakers reset');
        }
    }

    // Batch requests
    async batch(requests) {
        if (!Array.isArray(requests)) {
            throw new ValidationError('Batch requests must be an array');
        }

        return Promise.all(requests.map(req => {
            const { method = 'GET', url, data, config } = req;
            const methodLower = method.toLowerCase();
            
            // Métodos que aceitam body: POST, PUT, PATCH
            const methodsWithBody = ['post', 'put', 'patch'];
            
            if (methodsWithBody.includes(methodLower)) {
                return this[methodLower](url, data, config).catch(err => ({ error: err }));
            } else {
                // GET, DELETE, HEAD, OPTIONS - não passam data
                return this[methodLower](url, config).catch(err => ({ error: err }));
            }
        }));
    }

    // Download file helper - resolves with the raw Buffer (consistent with responseType: 'buffer')
    async download(url, config = {}) {
        return this.get(url, { ...config, responseType: 'buffer' });
    }

    // Stream a download directly to disk with progress reporting.
    async downloadTo(url, filePath, config = {}) {
        const stream = await this.get(url, { ...config, stream: true });
        const { onProgress } = config;
        const total = stream.total || 0;
        let loaded = 0;

        // Stream mode bypasses _processResponse, so errors (4xx/5xx) are not
        // surfaced automatically — reject explicitly instead of writing the
        // error body to disk as if it were a successful download.
        if (typeof stream.status === 'number' && stream.status >= 400) {
            try { stream.destroy(); } catch { /* ignore */ }
            throw new ResponseError(`HTTP Error ${stream.status}`, {
                status: stream.status,
                headers: stream.headers || {}
            });
        }

        return new Promise((resolve, reject) => {
            const ws = fs.createWriteStream(filePath);
            stream.on('data', chunk => {
                loaded += chunk.length;
                if (onProgress) {
                    onProgress({ loaded, total, percent: total ? (loaded / total) * 100 : 0 });
                }
            });
            stream.on('error', err => { ws.destroy(); reject(err); });
            ws.on('error', reject);
            ws.on('finish', () => resolve({ path: filePath, bytes: loaded }));
            stream.pipe(ws);
        });
    }

    // Optional undici transport (lazy-loaded, keeps the default path zero-dep)
    async _undiciRequest(urlObj, options, data) {
        let request;
        try {
            request = await loadUndici();
        } catch (e) {
            throw new ValidationError(
                "transport: 'undici' requires the optional dependency 'undici' to be installed",
                { transport: 'undici' }
            );
        }

        const body = data
            ? (Buffer.isBuffer(data) ? data : (typeof data === 'string' ? data : JSON.stringify(data)))
            : undefined;

        let result;
        try {
            result = await request(urlObj.href, {
                method: options.method,
                headers: options.headers,
                body,
                signal: options.config?.signal,
                headersTimeout: options.config?.timeouts?.response,
                bodyTimeout: typeof options.config?.timeout === 'number' ? options.config.timeout : undefined,
                maxRedirections: 0 // redirects are handled by swiftly
            });
        } catch (e) {
            // Normalize undici abort errors into our AbortError
            if (e && (e.name === 'AbortError' || e.code === 'UND_ERR_ABORTED' || e.code === 'ABORT_ERR')) {
                throw new AbortError();
            }
            throw e;
        }
        const { statusCode, headers: resHeaders, body: resBody } = result;

        // Fast path: undici's native accumulation (avoids per-chunk pushes
        // and Buffer.concat).
        let buf = Buffer.from(await resBody.arrayBuffer());

        const cfg = options.config || this.config;
        const encoding = resHeaders['content-encoding'];
        if (cfg.compression.response && cfg.decompress !== false && encoding) {
            try {
                if (encoding === 'gzip') {
                    buf = zlib.gunzipSync(buf);
                } else if (encoding === 'deflate') {
                    buf = zlib.inflateSync(buf);
                } else if (encoding === 'br') {
                    buf = zlib.brotliDecompressSync(buf);
                }
            } catch (e) {
                throw new RequestError('Decompression failed', { original: e, options });
            }
        }

        return {
            data: buf,
            headers: resHeaders,
            status: statusCode,
            config: options
        };
    }

    // Live config access / mutation
    get defaults() {
        return this.config;
    }

    setConfig(partial = {}) {
        this.config = this._mergeConfig(partial);
        this._mergeCache = new WeakMap(); // base config changed: cached merges are stale
        return this;
    }

    // Create a new client sharing this client's config (fresh pools/cookies).
    clone(overrides = {}) {
        return new HTTPClient(this._mergeConfig(overrides));
    }

    _getFilenameFromUrl(url) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            return pathname.substring(pathname.lastIndexOf('/') + 1) || 'download';
        } catch {
            return 'download';
        }
    }

    // Close all connections
    async close() {
        // Clear cleanup interval
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
            this._cleanupInterval = null;
        }
        
        // Close HTTP/2 sessions
        for (const [authority, session] of this.http2Sessions.entries()) {
            session.close();
            this.http2Sessions.delete(authority);
        }

        // Clear sessions
        this.sessions.clear();
        
        // Destroy pooled keep-alive agents (close sockets)
        destroyAgents(this.connectionPool);
        
        // Clear cache
        this.cache.clear();

        this._log('info', 'All connections closed');
    }
}

export const createClient = (config) => new HTTPClient(config);