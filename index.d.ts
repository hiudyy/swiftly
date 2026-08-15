// Type definitions for swiftly
// Lightweight HTTP client for Node.js. Zero dependencies.

/// <reference types="node" />

export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type ResponseType = 'json' | 'text' | 'html' | 'buffer';

export interface CacheConfig {
    enabled?: boolean;
    ttl?: number;
    maxSize?: number;
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

export interface Config {
    timeout?: number;
    retries?: number;
    retryDelay?: number;
    humanize?: boolean;
    followRedirects?: boolean;
    maxRedirects?: number;
    validateSSL?: boolean;
    useHttp2?: boolean;
    debug?: boolean;
    randomizeHeaders?: boolean;
    cache?: CacheConfig;
    rateLimiting?: RateLimitConfig;
    compression?: CompressionConfig;
    timeouts?: TimeoutConfig;
    session?: SessionConfig;
    circuitBreaker?: CircuitBreakerConfig;
    proxy?: null | { host: string; port: number; auth?: string };
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

export interface InterceptorManager {
    use(fulfilled?: (config: any) => any, rejected?: (error: any) => any): number;
    eject(id: number): void;
    clear(): void;
}

export interface ClientInstance {
    (url: string, config?: RequestOptions): Promise<any>;

    get<T = any>(url: string, config?: RequestOptions): Promise<T>;
    post<T = any>(url: string, data?: object | string | null, config?: RequestOptions): Promise<T>;
    put<T = any>(url: string, data?: object | string | null, config?: RequestOptions): Promise<T>;
    patch<T = any>(url: string, data?: object | string | null, config?: RequestOptions): Promise<T>;
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

    batch<T = any>(
        requests: Array<{ method?: string; url: string; data?: any; config?: RequestOptions }>
    ): Promise<T[]>;
    download(url: string, config?: RequestOptions): Promise<Buffer>;

    on(event: string, callback: (...args: any[]) => void): ClientInstance;
    off(event: string, callback?: (...args: any[]) => void): ClientInstance;
    interceptors: { request: InterceptorManager; response: InterceptorManager };

    clearCache(): void;
    resetCircuitBreakers(domain?: string): void;
    getMetrics(): Metrics;
    close(): Promise<void>;

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

export const events: Record<string, string>;
export function parseHTML<T = any>(
    html: string | Buffer,
    selectors: string | Record<string, any> | string[],
    options?: { debug?: boolean }
): T;

declare const swiftly: SwiftlyStatic;
export default swiftly;