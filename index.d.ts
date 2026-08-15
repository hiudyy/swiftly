// Type definitions for swiftly v2
// The fastest, lightest HTTP client for Node.js. Zero dependencies.

/// <reference types="node" />

import { Readable } from 'stream';

export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type ResponseType = 'json' | 'text' | 'html' | 'buffer' | 'raw';
export type TransportType = 'http' | 'http2' | 'undici';
export type RetryCondition = (status: number, response: any, options: Config) => boolean;

export interface CacheStorage {
    get(key: string): string | null;
    set(key: string, value: string): void;
    delete(key: string): void;
    clear(): void;
    keys?(): string[];
    size?(): number;
}

export interface CacheConfig {
    enabled?: boolean;
    ttl?: number;
    maxSize?: number;
    storage?: CacheStorage;
    staleWhileRevalidate?: boolean;
    ignoreQuery?: boolean;
    keyBuilder?: (url: string, options: Config) => string;
}

export interface RateLimitConfig {
    enabled?: boolean;
    requestsPerSecond?: number;
    maxDelay?: number;
    minDelay?: number;
}

export interface CompressionConfig {
    request?: boolean;
    response?: boolean;
    minSize?: number;
    responseMinSize?: number;
}

export interface TimeoutConfig {
    connect?: number;
    response?: number;
    idle?: number;
}

export interface SessionConfig {
    ttl?: number;
    maxSessions?: number;
    autoCleanup?: boolean;
}

export interface CircuitBreakerConfig {
    enabled?: boolean;
    failureThreshold?: number;
    resetTimeout?: number;
}

export interface ProxyConfig {
    host: string;
    port: number;
    auth?: string;
}

export interface RawResponse<T = any> {
    data: T;
    status: number;
    headers: Record<string, string>;
    config: Config;
    duration: number;
}

export interface Config {
    timeout?: number;
    connectTimeout?: number;
    retries?: number;
    retryDelay?: number;
    retryOn?: number[] | RetryCondition;
    retryBackoff?: 'linear' | 'exponential';
    retryJitter?: number;
    maxRetryAfter?: number;
    humanize?: boolean;
    followRedirects?: boolean;
    maxRedirects?: number;
    validateSSL?: boolean;
    useHttp2?: boolean;
    debug?: boolean;
    randomizeHeaders?: boolean;
    trackRouteTimes?: boolean;
    cache?: CacheConfig;
    rateLimiting?: RateLimitConfig;
    compression?: CompressionConfig;
    timeouts?: TimeoutConfig;
    session?: SessionConfig;
    circuitBreaker?: CircuitBreakerConfig;
    proxy?: ProxyConfig | null;
    baseURL?: string | null;
    responseEncoding?: string;
    maxContentLength?: number;
    maxBodyLength?: number;
    decompress?: boolean;
    responseType?: ResponseType;
    responseSchema?: Record<string, string>;
    params?: Record<string, string | number>;
    headers?: Record<string, string | number>;
    userAgent?: string;
    deduplicate?: boolean;
    keepAlive?: boolean;
    maxSockets?: number;
    maxFreeSockets?: number;
    agent?: any;
    auth?: { username: string; password: string } | string;
    bearer?: string;
    token?: string;
    stream?: boolean;
    signal?: AbortSignal;
    transport?: TransportType;
    onRequest?: (config: Config) => Config | void;
    onResponse?: (response: any) => any | void;
    onError?: (error: Error) => void;
    onRetry?: (error: Error, attempt: number) => void;
    onDownloadProgress?: (progress: { bytes: number; total: number }) => void;
    onUploadProgress?: (progress: { bytes: number; total: number }) => void;
}

export interface RequestOptions extends Config {
    params?: Record<string, string | number>;
    formData?: boolean;
}

export interface Metrics {
    requestCount: number;
    totalTime: number;
    cacheHits: number;
    cacheMisses: number;
    retries: number;
    successCount: number;
    errorCount: number;
    averageResponseTime: number;
    lastRequestTime: number;
    totalDataTransferred: number;
    http2Requests: number;
    redirects: number;
    activeSessions: number;
    pooledConnections: number;
    cacheSize: number;
    http2Sessions: number;
    circuitBreakers: Array<{ domain: string; state: string }>;
}

export interface CookieJar {
    setCookie(cookie: string | { name: string; value: string; domain?: string; path?: string }, url?: string): void;
    getCookies(url?: string): Array<{ name: string; value: string; domain: string; path: string }>;
    getCookiesMap(url?: string): Record<string, string>;
    clearCookies(domain?: string): void;
    toJSON(): string;
    fromJSON(json: string): void;
}

export interface InterceptorManager {
    use(fulfilled?: (config: any) => any, rejected?: (error: any) => any): number;
    eject(id: number): void;
    clear(): void;
}

export interface ClientInstance {
    (url: string, config?: RequestOptions): Promise<any>;

    get<T = any>(url: string, config?: RequestOptions): Promise<T>;
    post<T = any>(url: string, data?: object | string | Readable | null, config?: RequestOptions): Promise<T>;
    put<T = any>(url: string, data?: object | string | Readable | null, config?: RequestOptions): Promise<T>;
    patch<T = any>(url: string, data?: object | string | Readable | null, config?: RequestOptions): Promise<T>;
    delete<T = any>(url: string, config?: RequestOptions): Promise<T>;
    head<T = any>(url: string, config?: RequestOptions): Promise<T>;
    options<T = any>(url: string, config?: RequestOptions): Promise<T>;

    query<T = any>(
        url: string,
        queryData: { query: string; variables?: Record<string, any> },
        config?: RequestOptions
    ): Promise<T>;
    subscribe(
        url: string,
        callbacks: { onMessage?: (data: any) => void; onError?: (error: Error) => void; onOpen?: () => void },
        config?: RequestOptions
    ): Promise<() => void>;

    scrape<T = any>(
        url: string,
        selector: string | Record<string, any> | string[],
        config?: RequestOptions
    ): Promise<T>;
    parse<T = any>(html: string | Buffer, selectors: string | Record<string, any> | string[], config?: object): T;

    batch<T = any>(
        requests: Array<{ method?: string; url: string; data?: any; config?: RequestOptions }>
    ): Promise<T[]>;
    download(url: string, config?: RequestOptions): Promise<Buffer>;
    downloadTo(filePath: string, url: string, config?: RequestOptions): Promise<string>;

    on(event: string, callback: (...args: any[]) => void): ClientInstance;
    off(event: string, callback?: (...args: any[]) => void): ClientInstance;
    interceptors: { request: InterceptorManager; response: InterceptorManager };
    cookies: CookieJar;

    clearCache(): void;
    resetCircuitBreakers(domain?: string): void;
    getMetrics(): Metrics;
    close(): Promise<void>;
    defaults: Config;
    setConfig(partial: Config): void;
    clone(config?: Config): ClientInstance;

    setBaseURL(url: string): void;
    setDefaultHeaders(headers: Record<string, string | number>): void;
    setTimeout(timeout: number): void;
    setDebug(debug: boolean): void;
    getConfig(): Config;
}

export interface SwiftlyStatic extends ClientInstance {
    (config?: Config): ClientInstance;
    client: () => ClientInstance;
}

export interface Element {
    tag: string;
    index: number;
    content: string;
    html: string;
    attributes: Record<string, string | null>;
    children: Element[];
    text(): string;
    attr(name: string): string | null;
    find(selector: string): Element[];
    parent(): Element | null;
    closest(selector: string): Element | null;
    next(): Element | null;
    prev(): Element | null;
    data(attributePrefix?: string): Record<string, string>;
}

export function parseHTML<T = any>(
    html: string | Buffer,
    selectors: string | Record<string, any> | string[],
    options?: { debug?: boolean }
): T;
export function parseXML<T = any>(xml: string | Buffer): T;
export function parseXMLTree<T = any>(xml: string | Buffer): T;
export function xmlToString(obj: any, rootName?: string): string;
export function parseRSS(xml: string | Buffer): Array<Record<string, any>>;
export function parseAtom(xml: string | Buffer): Array<Record<string, any>>;
export function parseSitemap(xml: string | Buffer): Array<Record<string, any>>;
export function parseCSV(text: string | Buffer, options?: { header?: boolean; delimiter?: string; skipEmptyLines?: boolean }): any[];
export function toCSV(rows: any[], options?: { header?: boolean; delimiter?: string }): string;
export function queryJSON<T = any>(data: any, path: string, fallback?: T): T;

export function extractLinks(html: string | Buffer, baseUrl?: string): Array<{ text: string; href: string; url: string }>;
export function extractImages(html: string | Buffer, baseUrl?: string): Array<{ src: string; url: string; alt: string | null; title: string | null }>;
export function extractText(html: string | Buffer): string;
export function extractMeta(html: string | Buffer): Record<string, string>;
export function extractTables(html: string | Buffer, selector?: string): Array<{ headers: string[]; rows: Record<string, any>[] }>;
export function extractForms(html: string | Buffer): Array<{ action: string | null; method: string; fields: Array<{ name: string; type: string; value: string | null }> }>;
export function extractJsonLd(html: string | Buffer): any[];
export function extractJSON(html: string | Buffer): any[];
export function sanitizeHtml(html: string | Buffer, options?: { stripTags?: string[]; allowEventHandlers?: boolean }): string;
export function htmlToMarkdown(html: string | Buffer): string;

export const events: Record<string, string>;

declare const swiftly: SwiftlyStatic;
export default swiftly;