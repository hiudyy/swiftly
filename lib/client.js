/**
 * HTTP Client Implementation
 * @author Cognima
 * @license MIT
 */

'use strict';

import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import zlib from 'node:zlib';
import { generateHeaders } from './headers.js';
import { detectResponseType, delay, buildQueryString, isValidUrl, deepMerge } from './utils.js';
import { createEventEmitter, events } from './events.js';
import { createInterceptorManager, createCookieJar } from './interceptor.js';
import { createRateLimiter } from './rate-limiter.js';
import { createCacheStore } from './cache.js';
import {
    SwiftlyError,
    ValidationError,
    RequestError,
    ResponseError,
    CircuitBreakerError,
    TimeoutError
} from './errors.js';

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
            timeout: 30000,
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
            timeouts: {
                connect: 5000,
                response: 30000,
                idle: 60000
            },
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

        const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
        if (!validMethods.includes(method.toUpperCase())) {
            errors.push(`Invalid method: ${method}. Valid methods are: ${validMethods.join(', ')}`);
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
                Object.entries(params).forEach(([key, value]) => {
                    urlObj.searchParams.append(key, value);
                });
            }
            return urlObj.toString();
        } catch (error) {
            throw new Error(`Invalid URL: ${url}`);
        }
    }

    // Métodos HTTP melhorados
    async get(url, config = {}) {
        this._validateRequestParams('GET', url, null, config);
        const formattedUrl = this._formatUrl(url, config.params);
        this._log('info', `GET request to ${formattedUrl}`);

        try {
            return await this.request('GET', formattedUrl, null, config);
        } catch (error) {
            this._log('error', `GET request failed: ${error.message}`);
            throw error;
        }
    }

    async post(url, data = null, config = {}) {
        this._validateRequestParams('POST', url, data, config);
        const formattedUrl = this._formatUrl(url, config.params);
        this._log('info', `POST request to ${formattedUrl}`);

        try {
            if (config.formData && !data) {
                throw new ValidationError('Form data is required when formData option is enabled');
            }
            return await this.request('POST', formattedUrl, data, config);
        } catch (error) {
            this._log('error', `POST request failed: ${error.message}`);
            throw error;
        }
    }

    async put(url, data = null, config = {}) {
        this._validateRequestParams('PUT', url, data, config);
        const formattedUrl = this._formatUrl(url, config.params);
        this._log('info', `PUT request to ${formattedUrl}`);

        try {
            return await this.request('PUT', formattedUrl, data, config);
        } catch (error) {
            this._log('error', `PUT request failed: ${error.message}`);
            throw error;
        }
    }

    async delete(url, config = {}) {
        this._validateRequestParams('DELETE', url, null, config);
        const formattedUrl = this._formatUrl(url, config.params);
        this._log('info', `DELETE request to ${formattedUrl}`);

        try {
            return await this.request('DELETE', formattedUrl, null, config);
        } catch (error) {
            this._log('error', `DELETE request failed: ${error.message}`);
            throw error;
        }
    }

    async patch(url, data = null, config = {}) {
        this._validateRequestParams('PATCH', url, data, config);
        const formattedUrl = this._formatUrl(url, config.params);
        this._log('info', `PATCH request to ${formattedUrl}`);

        try {
            return await this.request('PATCH', formattedUrl, data, config);
        } catch (error) {
            this._log('error', `PATCH request failed: ${error.message}`);
            throw error;
        }
    }

    async head(url, config = {}) {
        this._validateRequestParams('HEAD', url, null, config);
        const formattedUrl = this._formatUrl(url, config.params);
        this._log('info', `HEAD request to ${formattedUrl}`);

        try {
            return await this.request('HEAD', formattedUrl, null, config);
        } catch (error) {
            this._log('error', `HEAD request failed: ${error.message}`);
            throw error;
        }
    }

    async options(url, config = {}) {
        this._validateRequestParams('OPTIONS', url, null, config);
        const formattedUrl = this._formatUrl(url, config.params);
        this._log('info', `OPTIONS request to ${formattedUrl}`);

        try {
            return await this.request('OPTIONS', formattedUrl, null, config);
        } catch (error) {
            this._log('error', `OPTIONS request failed: ${error.message}`);
            throw error;
        }
    }

    _registerDefaultTransformers() {
        // JSON transformer
        this.responseTransformers.set('json', async (data, headers) => {
            try {
                const text = data.toString('utf-8').trim();
                if (!text) {
                    throw new Error('Empty response body');
                }
                return JSON.parse(text);
            } catch (e) {
                throw new Error(`Invalid JSON response: ${e.message}`);
            }
        });

        // Text transformer
        this.responseTransformers.set('text', async (data) => {
            return data.toString('utf-8');
        });

        // HTML transformer with basic validation
        this.responseTransformers.set('html', async (data) => {
            const text = data.toString('utf-8');
            if (!text.includes('<!DOCTYPE html>') && !text.includes('<html')) {
                throw new Error('Invalid HTML response');
            }
            return text;
        });

        // Buffer passthrough
        this.responseTransformers.set('buffer', async (data) => data);
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



    async request(method, url, data = null, customConfig = {}) {
        const startTime = Date.now();
        const config = deepMerge(this.config, customConfig);
        const urlObj = new URL(url);
        const routeKey = `${method.toUpperCase()} ${urlObj.pathname}`; //Key for route metrics

        // Request deduplication for GET requests
        if (method.toUpperCase() === 'GET' && config.deduplicate !== false) {
            const dedupKey = `${method}:${url}`;
            const pending = this.pendingRequests.get(dedupKey);
            if (pending) {
                this._log('debug', `Deduplicating request: ${dedupKey}`);
                return pending;
            }
        }

        // Event: Request Start
        this.events.emit(events.REQUEST_START, { method, url, config });

        // Verificar cache
        if (config.cache.enabled && method.toUpperCase() === 'GET') {
            const cacheKey = this.cache.getCacheKey(method, url, data);
            const cachedResponse = this.cache.get(cacheKey);
            if (cachedResponse) {
                this.metrics.cacheHits++;
                this.events.emit(events.CACHE_HIT, { url });
                return cachedResponse;
            }
            this.metrics.cacheMisses++;
            this.events.emit(events.CACHE_MISS, { url });
        }

        // Create request promise for deduplication
        const dedupKey = method.toUpperCase() === 'GET' ? `${method}:${url}` : null;
        const requestPromise = this._executeRequest(method, url, data, config, startTime, routeKey, urlObj);
        
        if (dedupKey && config.deduplicate !== false) {
            this.pendingRequests.set(dedupKey, requestPromise);
            // Clean up dedup key when done (catch to prevent unhandled rejection)
            requestPromise
                .catch(() => {}) // Silently handle - actual error is thrown to caller
                .finally(() => this.pendingRequests.delete(dedupKey));
        }

        return requestPromise;
    }

    async _executeRequest(method, url, data, config, startTime, routeKey, urlObj) {

        // Rate Limiting
        if (config.rateLimiting.enabled) {
            try {
                await this.rateLimiter.checkLimit(urlObj.hostname, config.rateLimiting);
            } catch (error) {
                this.events.emit(events.RATE_LIMIT, { url, error: error.message });
                throw error;
            }
        }

        const options = {
            method: method,
            hostname: urlObj.hostname,
            port: urlObj.port ? Number(urlObj.port) : undefined,
            path: urlObj.pathname + urlObj.search,
            headers: generateHeaders(config),
            timeout: config.timeout,
            rejectUnauthorized: config.validateSSL,
            config // Store original config for interceptors
        };

        // Add cookies from jar
        const cookies = this.cookieJar.getCookies(urlObj.hostname);
        if (cookies) {
            options.headers['Cookie'] = cookies;
        }


        // Add query parameters if provided
        if (config.params) {
            options.path += (urlObj.search ? '&' : '?') + buildQueryString(config.params);
        }

        // Handle multipart/form-data
        if (data && config.formData) {
            const formData = await this._createFormData(data);
            data = formData.data;
            options.headers['Content-Type'] = `multipart/form-data; boundary=${formData.boundary}`;
        } else if (data && typeof data === 'object' && !Buffer.isBuffer(data) && !options.headers['Content-Type']) {
            options.headers['Content-Type'] = 'application/json';
        }


        // Comprimir payload se necessário (apenas objetos/arrays, não Buffers)
        if (data && typeof data === 'object' && !Buffer.isBuffer(data) && !options.headers['Content-Encoding']) {
            const compressedData = await this._compressData(data);
            data = compressedData.data;
            options.headers['Content-Encoding'] = compressedData.encoding;
        }

        // Process request through interceptors
        let finalOptions;
        try {
            finalOptions = await this.interceptors.request.executeRequestChain(options);
        } catch (error) {
            throw new RequestError('Request interceptor error', {
                original: error,
                options
            });
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

        const requestCommand = async () => {
            // Simulate human-like delay if enabled
            if (config.humanize) {
                await delay(Math.random() * 1000 + 500);
            }

            let response;
            const useHttp2 = config.useHttp2 && urlObj.protocol === 'https:';

            if (useHttp2) {
                response = await this._makeHttp2Request(urlObj, finalOptions, data);
                this.metrics.http2Requests++;
            } else {
                response = await this._makeRequest(urlObj.protocol, finalOptions, data);
            }
            return response;
        }


        while (attempt < config.retries) {
            try {
                // Executar com ou sem circuit breaker dependendo da configuração
                const response = circuitBreaker 
                    ? await circuitBreaker.execute(requestCommand, urlObj.hostname)
                    : await requestCommand();

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
                    // Propagate the redirect counter (bounded chains) and disable
                    // dedup so self-referential loops don't deadlock.
                    return this.request(method, redirectUrl, data, {
                        ...config,
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

                // Process response through interceptors
                const processedResponse = await this.interceptors.response.executeResponseChain(response);

                // Validate response
                const contentType = processedResponse.headers['content-type'] || '';
                const type = detectResponseType(contentType);
                const validator = this.responseValidators.get(type);
                if (validator) {
                    validator(processedResponse.data, this.config.responseSchema);
                }

                // Cache response if enabled
                if (config.cache.enabled && method.toUpperCase() === 'GET' && processedResponse.status === 200) {
                    const cacheKey = this.cache.getCacheKey(method, url, data);
                    this.cache.set(cacheKey, processedResponse, config.cache.ttl);
                }

                // Update metrics
                const requestTime = Date.now() - startTime;
                this.metrics.requestCount++;
                this.metrics.totalTime += requestTime;
                this.metrics.successCount++;
                this.metrics.lastRequestTime = requestTime;
                this.metrics.averageResponseTime = this.metrics.totalTime / this.metrics.requestCount;
                this.metrics.totalDataTransferred +=
                    (processedResponse.data ? processedResponse.data.length : 0);

                // Update route metrics
                let routeTime = this.routeMetrics.get(routeKey) || { count: 0, totalTime: 0 };
                routeTime.count++;
                routeTime.totalTime += requestTime;
                this.routeMetrics.set(routeKey, routeTime);
                this.metrics.routeTimes.set(routeKey, routeTime.totalTime / routeTime.count);

                // Event: Request End
                this.events.emit(events.REQUEST_END, {
                    method,
                    url,
                    status: processedResponse.status,
                    time: requestTime,
                    size: processedResponse.data ? processedResponse.data.length : 0
                });

                // For HEAD requests, return headers only
                if (method.toUpperCase() === 'HEAD') {
                    return processedResponse.headers;
                }

                // For OPTIONS requests, return headers
                if (method.toUpperCase() === 'OPTIONS') {
                    return processedResponse.headers;
                }

                return await this._processResponse(processedResponse, config.responseType);
            } catch (error) {
                // Never retry hard errors (e.g. max redirects exceeded)
                if (error._noRetry) {
                    this.metrics.errorCount++;
                    this.events.emit(events.REQUEST_ERROR, error);
                    throw error;
                }

                // Get status from error response
                const status = error.response?.status || 
                               error.context?.response?.status;
                
                // Don't retry on client errors (4xx) except 429 (rate limit)
                const isClientError = status >= 400 && status < 500 && status !== 429;
                
                if (isClientError) {
                    this.metrics.errorCount++;
                    this.events.emit(events.REQUEST_ERROR, error);
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

                this.events.emit(events.RETRY_ATTEMPT, {
                    attempt,
                    error: error.message,
                    nextRetryDelay: config.retryDelay * attempt
                });

                if (attempt === config.retries) {
                    this.events.emit(events.REQUEST_ERROR, error);
                    throw error;
                }

                await delay(config.retryDelay * attempt);
            }
        }
    }

    async _makeHttp2Request(urlObj, options, data) {
        const authority = `${urlObj.hostname}:${urlObj.port || 443}`;

        let session = this.http2Sessions.get(authority);
        if (!session || session.destroyed) {
            session = http2.connect(urlObj.href);
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
                    this.events.emit(events.PROGRESS, {
                        loaded: totalBytes,
                        total: parseInt(responseHeaders['content-length'], 10) || 0,
                        percent: totalBytes / (parseInt(responseHeaders['content-length'], 10) || 1) * 100
                    });
                }
            });

            req.on('end', () => {
                let body = Buffer.concat(chunks);

                // Decompress response when configured
                const encoding = responseHeaders && responseHeaders['content-encoding'];
                const contentLength = parseInt(responseHeaders && responseHeaders['content-length'], 10) || 0;
                const cfg = options.config || this.config;
                if (cfg.compression.response && contentLength >= cfg.compression.responseMinSize && encoding) {
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
                    status: responseStatus
                });
            });

            req.on('error', reject);

            if (data) {
                const payload = Buffer.isBuffer(data) ? data : (typeof data === 'string' ? data : JSON.stringify(data));
                req.write(payload);
            }

            req.end();
        });
    }

    _setupTimeouts(req, options) {
        const timeouts = {
            connect: options.config.timeouts?.connect || 5000,
            response: options.config.timeouts?.response || 30000,
            idle: options.config.timeouts?.idle || 60000
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
        req.once('response', (res) => {
            if (responseTimer) { clearTimeout(responseTimer); responseTimer = null; }

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

    _makeRequest(protocol, options, data) {
        return new Promise((resolve, reject) => {
            const client = protocol === 'https:' ? https : http;

            // Enhanced IPv6 handling
            if (options.hostname && options.hostname.includes(':')) {
                try {
                    // Remove brackets if present
                    options.hostname = options.hostname.replace(/^\[|\]$/g, '');
                    // Validate IPv6 format (including compressed notation with ::)
                    const ipv6Pattern = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|::)$/;
                    if (!ipv6Pattern.test(options.hostname)) {
                        throw new ValidationError('Invalid IPv6 address format', { hostname: options.hostname });
                    }
                    // Add brackets back for HTTP request
                    options.hostname = `[${options.hostname}]`;
                } catch (error) {
                    reject(new RequestError('Invalid IPv6 address', {
                        original: error,
                        options,
                        protocol
                    }));
                    return;
                }
            }

            const req = client.request(options, (res) => {
                // For HEAD and OPTIONS requests, return immediately with headers only
                if (options.method === 'HEAD' || options.method === 'OPTIONS') {
                    resolve({
                        data: Buffer.alloc(0),
                        headers: res.headers,
                        status: res.statusCode,
                        config: options
                    });
                    return;
                }

                const chunks = [];
                let stream = res;

                // Handle compressed responses (use per-request config, respect minSize)
                const contentLength = parseInt(res.headers['content-length'], 10) || 0;
                const requestCfg = options.config || this.config;
                const shouldDecompress = requestCfg.compression.response &&
                    contentLength >= requestCfg.compression.responseMinSize;
                if (shouldDecompress) {
                    const encoding = res.headers['content-encoding'];
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

                stream.on('data', chunk => {
                    chunks.push(chunk);
                    receivedBytes += chunk.length;

                    if (totalBytes) {
                        this.events.emit(events.PROGRESS, {
                            loaded: receivedBytes,
                            total: totalBytes,
                            percent: (receivedBytes / totalBytes) * 100
                        });
                    }
                });

                stream.on('end', () => {
                    resolve({
                        data: Buffer.concat(chunks),
                        headers: res.headers,
                        status: res.statusCode,
                        config: options // Include original config for error handling
                    });
                });

                stream.on('error', error => {
                    reject(new RequestError('Stream error', {
                        original: error,
                        options,
                        protocol
                    }));
                });
            });

            this._setupTimeouts(req, options);

            req.on('error', error => {
                let enhancedError;
                switch (error.code) {
                    case 'ECONNREFUSED':
                        enhancedError = new RequestError('Connection refused', {
                            original: error,
                            options,
                            protocol
                        });
                        break;
                    case 'ENOTFOUND':
                        enhancedError = new RequestError('Host not found', {
                            original: error,
                            options,
                            protocol
                        });
                        break;
                    case 'ECONNRESET':
                        enhancedError = new RequestError('Connection reset', {
                            original: error,
                            options,
                            protocol
                        });
                        break;
                    case 'ETIMEDOUT':
                        enhancedError = new TimeoutError('Connection timed out', 'connect', {
                            original: error,
                            options,
                            protocol
                        });
                        break;
                    default:
                        enhancedError = new RequestError(error.message, {
                            original: error,
                            options,
                            protocol
                        });
                }
                reject(enhancedError);
            });

            if (data) {
                // Data já foi serializado em _compressData ou é string/Buffer
                const payload = Buffer.isBuffer(data) ? data : (typeof data === 'string' ? data : JSON.stringify(data));
                req.write(payload);
            }

            req.end();
        });
    }

    async _processResponse(response, responseType) {
        if (response.status >= 400) {
            throw new ResponseError(`HTTP Error ${response.status}`, response);
        }

        const contentType = response.headers['content-type'] || '';
        const type = responseType || detectResponseType(contentType);

        // Validate responseType
        const validTypes = ['json', 'text', 'html', 'buffer'];
        if (responseType && !validTypes.includes(responseType)) {
            this._log('error', `Invalid responseType: ${responseType}, falling back to buffer`);
        }

        const transformer = this.responseTransformers.get(type) || this.responseTransformers.get('buffer');
        if (!transformer) {
            this._log('error', `No transformer found for type: ${type}, using buffer`);
            return response.data;
        }

        try {
            return await transformer(response.data, response.headers);
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
            const req = client.request(urlObj, options, (res) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`SSE connection failed: ${res.statusCode}`));
                    return;
                }

                res.setEncoding('utf8');
                let buffer = '';

                if (onOpen) onOpen();

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
            resolve(() => req.destroy());
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
            activeSessions: this.sessions.size,
            pooledConnections: this.connectionPool.size,
            http2Sessions: this.http2Sessions.size,
            cacheSize: this.cache.store.size,
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
        
        // Clear connection pool
        this.connectionPool.clear();
        
        // Clear cache
        this.cache.clear();

        this._log('info', 'All connections closed');
    }
}

export const createClient = (config) => new HTTPClient(config);