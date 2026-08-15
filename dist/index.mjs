// lib/client.js
import http from "http";
import https from "https";
import http2 from "http2";
import zlib from "zlib";

// lib/headers.js
var DEFAULT_USER_AGENT = "Swiftly/1.0 (+https://github.com/cognima/swiftly)";
var userAgents = [
  DEFAULT_USER_AGENT,
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0"
];
var languages = ["en-US", "en-GB", "pt-BR", "es-ES", "fr-FR", "de-DE"];
function generateHeaders(config = {}) {
  const randomize = !!config.randomizeHeaders;
  const headers = {
    "User-Agent": randomize ? userAgents[Math.floor(Math.random() * userAgents.length)] : config.userAgent || DEFAULT_USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": randomize ? languages[Math.floor(Math.random() * languages.length)] : "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br"
  };
  if (config.headers) {
    Object.assign(headers, config.headers);
  }
  return headers;
}

// lib/utils.js
import querystring from "querystring";
function detectResponseType(contentType = "") {
  contentType = String(contentType).toLowerCase();
  if (contentType.includes("application/json")) {
    return "json";
  } else if (contentType.includes("text/html")) {
    return "html";
  } else if (contentType.includes("text/")) {
    return "text";
  } else {
    return "buffer";
  }
}
var delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var buildQueryString = (params) => querystring.stringify(params);
function deepMerge(target, source) {
  if (typeof source !== "object" || source === null) return target;
  if (Array.isArray(source)) return source;
  const result = { ...target };
  for (const key in source) {
    const sv = source[key];
    if (sv && typeof sv === "object" && !Array.isArray(sv) && result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key], sv);
    } else {
      result[key] = sv;
    }
  }
  return result;
}

// lib/events.js
var EventEmitter = class {
  constructor() {
    this.events = /* @__PURE__ */ new Map();
  }
  on(event, callback) {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event).push(callback);
    return this;
  }
  off(event, callback) {
    if (!this.events.has(event)) return this;
    if (!callback) {
      this.events.delete(event);
      return this;
    }
    const callbacks = this.events.get(event).filter((cb) => cb !== callback);
    this.events.set(event, callbacks);
    return this;
  }
  emit(event, ...args) {
    if (!this.events.has(event)) return false;
    const callbacks = this.events.get(event);
    let hasError = false;
    callbacks.forEach((callback) => {
      try {
        callback.apply(null, args);
      } catch (error) {
        hasError = true;
        console.error(`Error in event handler for "${event}":`, error);
        if (event !== "error") {
          this.emit("error", error, event);
        }
      }
    });
    return !hasError;
  }
  once(event, callback) {
    const onceCallback = (...args) => {
      this.off(event, onceCallback);
      callback.apply(null, args);
    };
    return this.on(event, onceCallback);
  }
};
var createEventEmitter = () => new EventEmitter();
var events = {
  REQUEST_START: "request:start",
  REQUEST_END: "request:end",
  REQUEST_ERROR: "request:error",
  RETRY_ATTEMPT: "retry:attempt",
  CACHE_HIT: "cache:hit",
  CACHE_MISS: "cache:miss",
  RATE_LIMIT: "rate:limit",
  REDIRECT: "redirect",
  PROGRESS: "progress"
};

// lib/interceptor.js
var InterceptorManager = class {
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
      fulfilled: typeof fulfilled === "function" ? fulfilled : null,
      rejected: typeof rejected === "function" ? rejected : null
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
        if (result !== void 0) {
          return result;
        }
      } catch (newError) {
        error = newError;
      }
    }
    throw error;
  }
};
var CookieJar = class {
  constructor() {
    this.cookies = /* @__PURE__ */ new Map();
  }
  setCookie(domain, cookie) {
    if (!domain || typeof domain !== "string") {
      throw new Error("Domain must be a non-empty string");
    }
    if (!cookie || typeof cookie !== "string") {
      throw new Error("Cookie must be a non-empty string");
    }
    if (!this.cookies.has(domain)) {
      this.cookies.set(domain, /* @__PURE__ */ new Map());
    }
    try {
      const cookieParts = cookie.split(";")[0].split("=");
      if (cookieParts.length < 2) {
        throw new Error("Invalid cookie format");
      }
      const name = cookieParts[0].trim();
      const value = cookieParts.slice(1).join("=").trim();
      if (!name) {
        throw new Error("Cookie name cannot be empty");
      }
      this.cookies.get(domain).set(name, {
        value,
        expires: this._getExpiryFromCookie(cookie),
        httpOnly: cookie.toLowerCase().includes("httponly"),
        secure: cookie.toLowerCase().includes("secure"),
        sameSite: this._getSameSiteFromCookie(cookie)
      });
    } catch (error) {
    }
  }
  getCookies(domain) {
    this._clearExpired();
    const cookies = this.cookies.get(domain);
    if (!cookies) return "";
    return Array.from(cookies.entries()).map(([name, data]) => `${name}=${data.value}`).join("; ");
  }
  _getExpiryFromCookie(cookie) {
    const expires = cookie.split(";").find((part) => part.trim().toLowerCase().startsWith("expires="));
    return expires ? new Date(expires.split("=")[1]) : null;
  }
  _getSameSiteFromCookie(cookie) {
    const sameSite = cookie.split(";").find((part) => part.trim().toLowerCase().startsWith("samesite="));
    return sameSite ? sameSite.split("=")[1].trim() : "Lax";
  }
  _clearExpired() {
    const now = /* @__PURE__ */ new Date();
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
};
var createInterceptorManager = () => new InterceptorManager();
var createCookieJar = () => new CookieJar();

// lib/rate-limiter.js
var RateLimiter = class {
  constructor(config = {}) {
    this.limits = /* @__PURE__ */ new Map();
    this.delays = /* @__PURE__ */ new Map();
    this.domainConfigs = /* @__PURE__ */ new Map();
    this.defaultConfig = {
      requestsPerSecond: 2,
      maxDelay: 64e3,
      minDelay: 1e3,
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
    while (true) {
      const now = Date.now();
      const cutoff = now - 1e3;
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
      await new Promise((resolve) => setTimeout(resolve, currentDelay));
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
};
var createRateLimiter = (config) => new RateLimiter(config);

// lib/cache.js
var CacheStore = class {
  constructor(config = {}) {
    this.store = /* @__PURE__ */ new Map();
    this.config = {
      ttl: 3e5,
      // 5 minutos
      maxSize: 1e3,
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
      const entries = Array.from(this.store.entries()).sort((a, b) => a[1].lastAccess - b[1].lastAccess);
      const toDelete = Math.max(1, Math.floor(this.config.maxSize * 0.2));
      for (let i = 0; i < toDelete && i < entries.length; i++) {
        this.store.delete(entries[i][0]);
      }
    }
  }
  getCacheKey(method, url, data) {
    const parts = [method.toUpperCase(), url];
    if (data) {
      parts.push(typeof data === "string" ? data : JSON.stringify(data));
    }
    return parts.join("|");
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
      utilizationPercent: this.store.size / this.config.maxSize * 100
    };
  }
};
var createCacheStore = (config) => new CacheStore(config);

// lib/errors.js
var SwiftlyError = class extends Error {
  constructor(message, code, context = {}) {
    super(message);
    this.name = "SwiftlyError";
    this.code = code;
    this.context = context;
  }
};
var ValidationError = class extends SwiftlyError {
  constructor(message, context = {}) {
    super(message, "VALIDATION_ERROR", context);
    this.name = "ValidationError";
  }
};
var RequestError = class extends SwiftlyError {
  constructor(message, context = {}) {
    super(message, "REQUEST_ERROR", context);
    this.name = "RequestError";
  }
};
var ResponseError = class extends SwiftlyError {
  constructor(message, response, context = {}) {
    super(message, "RESPONSE_ERROR", { response, ...context });
    this.name = "ResponseError";
    this.response = response;
  }
};
var CircuitBreakerError = class extends SwiftlyError {
  constructor(message, domain, context = {}) {
    super(message, "CIRCUIT_BREAKER_ERROR", { domain, ...context });
    this.name = "CircuitBreakerError";
    this.domain = domain;
  }
};
var TimeoutError = class extends SwiftlyError {
  constructor(message, type, context = {}) {
    super(message, "TIMEOUT_ERROR", { type, ...context });
    this.name = "TimeoutError";
    this.type = type;
  }
};

// lib/client.js
var CircuitBreaker = class {
  constructor(config = {}) {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.config = {
      failureThreshold: 5,
      resetTimeout: 6e4,
      // 1 minuto
      ...config
    };
    this.events = createEventEmitter();
  }
  async execute(command, domain) {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime > this.config.resetTimeout) {
        this.state = "HALF-OPEN";
        this.events.emit("circuit:half-open", { domain });
      } else {
        this.events.emit("circuit:rejected", { domain, state: this.state });
        throw new CircuitBreakerError("Circuit breaker is OPEN", domain);
      }
    }
    try {
      const result = await command();
      if (this.state === "HALF-OPEN") {
        this.state = "CLOSED";
        this.failureCount = 0;
        this.events.emit("circuit:close", { domain });
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
      this.state = "OPEN";
      this.events.emit("circuit:open", {
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
};
var HTTPClient = class {
  constructor(config = {}) {
    this.config = {
      timeout: 3e4,
      retries: 3,
      retryDelay: 1e3,
      humanize: false,
      // Performance-first: no artificial delay
      followRedirects: true,
      maxRedirects: 5,
      validateSSL: true,
      useHttp2: false,
      debug: false,
      // Silent by default
      randomizeHeaders: false,
      cache: {
        enabled: true,
        ttl: 3e5,
        // 5 minutos
        maxSize: 1e3
      },
      rateLimiting: {
        enabled: false,
        // Performance-first: no throttle by default
        requestsPerSecond: 2,
        maxDelay: 64e3,
        minDelay: 1e3
      },
      compression: {
        request: true,
        response: true,
        minSize: 1024,
        // Min bytes to gzip request payload
        responseMinSize: 0
        // Min bytes to decompress response
      },
      timeouts: {
        connect: 5e3,
        response: 3e4,
        idle: 6e4
      },
      session: {
        ttl: 36e5,
        // 1 hora
        maxSessions: 100,
        autoCleanup: true
      },
      circuitBreaker: {
        enabled: false,
        // Desabilitado por padrão - ativar manualmente
        failureThreshold: 5,
        resetTimeout: 6e4
      },
      proxy: null,
      // Proxy configuration { host, port, auth? }
      baseURL: null,
      // Base URL for all requests
      responseEncoding: "utf-8",
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      decompress: true,
      ...config
    };
    this.events = createEventEmitter();
    this.interceptors = {
      request: createInterceptorManager(),
      response: createInterceptorManager()
    };
    this.cookieJar = createCookieJar();
    this.rateLimiter = createRateLimiter(this.config.rateLimiting);
    this.cache = createCacheStore(this.config.cache);
    this.connectionPool = /* @__PURE__ */ new Map();
    this.http2Sessions = /* @__PURE__ */ new Map();
    this.sessions = /* @__PURE__ */ new Map();
    this.sessionConfig = this.config.session;
    this.responseTransformers = /* @__PURE__ */ new Map();
    this.responseValidators = /* @__PURE__ */ new Map();
    this.circuitBreakers = /* @__PURE__ */ new Map();
    this.routeMetrics = /* @__PURE__ */ new Map();
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
      routeTimes: /* @__PURE__ */ new Map()
      //Added for route response times
    };
    this.pendingRequests = /* @__PURE__ */ new Map();
    this._registerDefaultTransformers();
    this._registerDefaultValidators();
    this._cleanupInterval = null;
    if (this.config.session.autoCleanup) {
      this._cleanupInterval = setInterval(() => this._cleanupSessions(), this.config.session.ttl);
      if (this._cleanupInterval.unref) {
        this._cleanupInterval.unref();
      }
    }
  }
  // Método auxiliar para logs melhorado
  _log(level, ...args) {
    if (!this.config.debug) return;
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    switch (level) {
      case "error":
        console.error(`[Swiftly ${timestamp}]`, ...args);
        break;
      case "info":
        console.info(`[Swiftly ${timestamp}]`, ...args);
        break;
      case "debug":
        console.log(`[Swiftly ${timestamp}]`, ...args);
        break;
    }
  }
  // Validação de parâmetros
  _validateRequestParams(method, url, data = null, config = {}) {
    const errors = [];
    if (!method || typeof method !== "string") {
      errors.push("Method is required and must be a string");
    }
    if (!url) {
      errors.push("URL is required");
    } else if (typeof url !== "string") {
      errors.push("URL must be a string");
    } else {
      const isRelativeUrl = url.startsWith("/") || !url.includes("://");
      const hasBaseURL = this.config && this.config.baseURL;
      if (isRelativeUrl && !hasBaseURL) {
        errors.push(`Relative URL "${url}" requires baseURL to be configured`);
      }
    }
    if (data !== null) {
      if (typeof data !== "object" && typeof data !== "string") {
        errors.push("Data must be an object, string or null");
      }
      if (typeof data === "object" && !Array.isArray(data) && data.constructor !== Object && !(data instanceof Buffer)) {
        errors.push("Data object must be a plain object, array or Buffer");
      }
    }
    if (config && typeof config !== "object") {
      errors.push("Config must be an object");
    }
    if (config && config.headers) {
      if (typeof config.headers !== "object") {
        errors.push("Headers must be an object");
      } else {
        for (const [key, value] of Object.entries(config.headers)) {
          if (typeof value !== "string" && typeof value !== "number") {
            errors.push(`Header "${key}" must be a string or number, got ${typeof value}`);
          }
        }
      }
    }
    const validMethods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
    if (!validMethods.includes(method.toUpperCase())) {
      errors.push(`Invalid method: ${method}. Valid methods are: ${validMethods.join(", ")}`);
    }
    if (errors.length > 0) {
      throw new ValidationError(`Validation failed:
- ${errors.join("\n- ")}`, {
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
      let fullUrl = url;
      if (this.config.baseURL && !url.startsWith("http")) {
        const base = this.config.baseURL.replace(/\/$/, "");
        const path = url.startsWith("/") ? url : "/" + url;
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
    this._validateRequestParams("GET", url, null, config);
    const formattedUrl = this._formatUrl(url, config.params);
    this._log("info", `GET request to ${formattedUrl}`);
    try {
      return await this.request("GET", formattedUrl, null, config);
    } catch (error) {
      this._log("error", `GET request failed: ${error.message}`);
      throw error;
    }
  }
  async post(url, data = null, config = {}) {
    this._validateRequestParams("POST", url, data, config);
    const formattedUrl = this._formatUrl(url, config.params);
    this._log("info", `POST request to ${formattedUrl}`);
    try {
      if (config.formData && !data) {
        throw new ValidationError("Form data is required when formData option is enabled");
      }
      return await this.request("POST", formattedUrl, data, config);
    } catch (error) {
      this._log("error", `POST request failed: ${error.message}`);
      throw error;
    }
  }
  async put(url, data = null, config = {}) {
    this._validateRequestParams("PUT", url, data, config);
    const formattedUrl = this._formatUrl(url, config.params);
    this._log("info", `PUT request to ${formattedUrl}`);
    try {
      return await this.request("PUT", formattedUrl, data, config);
    } catch (error) {
      this._log("error", `PUT request failed: ${error.message}`);
      throw error;
    }
  }
  async delete(url, config = {}) {
    this._validateRequestParams("DELETE", url, null, config);
    const formattedUrl = this._formatUrl(url, config.params);
    this._log("info", `DELETE request to ${formattedUrl}`);
    try {
      return await this.request("DELETE", formattedUrl, null, config);
    } catch (error) {
      this._log("error", `DELETE request failed: ${error.message}`);
      throw error;
    }
  }
  async patch(url, data = null, config = {}) {
    this._validateRequestParams("PATCH", url, data, config);
    const formattedUrl = this._formatUrl(url, config.params);
    this._log("info", `PATCH request to ${formattedUrl}`);
    try {
      return await this.request("PATCH", formattedUrl, data, config);
    } catch (error) {
      this._log("error", `PATCH request failed: ${error.message}`);
      throw error;
    }
  }
  async head(url, config = {}) {
    this._validateRequestParams("HEAD", url, null, config);
    const formattedUrl = this._formatUrl(url, config.params);
    this._log("info", `HEAD request to ${formattedUrl}`);
    try {
      return await this.request("HEAD", formattedUrl, null, config);
    } catch (error) {
      this._log("error", `HEAD request failed: ${error.message}`);
      throw error;
    }
  }
  async options(url, config = {}) {
    this._validateRequestParams("OPTIONS", url, null, config);
    const formattedUrl = this._formatUrl(url, config.params);
    this._log("info", `OPTIONS request to ${formattedUrl}`);
    try {
      return await this.request("OPTIONS", formattedUrl, null, config);
    } catch (error) {
      this._log("error", `OPTIONS request failed: ${error.message}`);
      throw error;
    }
  }
  _registerDefaultTransformers() {
    this.responseTransformers.set("json", async (data, headers) => {
      try {
        const text = data.toString("utf-8").trim();
        if (!text) {
          throw new Error("Empty response body");
        }
        return JSON.parse(text);
      } catch (e) {
        throw new Error(`Invalid JSON response: ${e.message}`);
      }
    });
    this.responseTransformers.set("text", async (data) => {
      return data.toString("utf-8");
    });
    this.responseTransformers.set("html", async (data) => {
      const text = data.toString("utf-8");
      if (!text.includes("<!DOCTYPE html>") && !text.includes("<html")) {
        throw new Error("Invalid HTML response");
      }
      return text;
    });
    this.responseTransformers.set("buffer", async (data) => data);
  }
  _registerDefaultValidators() {
    this.responseValidators.set("json", (data, schema) => {
      if (!schema) return true;
      try {
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
    this.responseValidators.set("html", (data) => {
      const text = Buffer.isBuffer(data) ? data.toString("utf-8") : String(data || "");
      return text.includes("<!DOCTYPE") || text.includes("<html");
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
      this.events.emit("sessions:cleanup", { cleaned: cleanedCount });
    }
  }
  async _getSession(domain) {
    let session = this.sessions.get(domain);
    if (this.sessions.size > this.sessionConfig.maxSessions) {
      for (const [key, sess] of this.sessions.entries()) {
        if (Date.now() - sess.lastAccess > this.sessionConfig.ttl) {
          this.sessions.delete(key);
        }
      }
    }
    if (!session || Date.now() - session.lastAccess > this.sessionConfig.ttl) {
      session = {
        cookies: /* @__PURE__ */ new Map(),
        lastAccess: Date.now(),
        customHeaders: /* @__PURE__ */ new Map()
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
    const routeKey = `${method.toUpperCase()} ${urlObj.pathname}`;
    if (method.toUpperCase() === "GET" && config.deduplicate !== false) {
      const dedupKey2 = `${method}:${url}`;
      const pending = this.pendingRequests.get(dedupKey2);
      if (pending) {
        this._log("debug", `Deduplicating request: ${dedupKey2}`);
        return pending;
      }
    }
    this.events.emit(events.REQUEST_START, { method, url, config });
    if (config.cache.enabled && method.toUpperCase() === "GET") {
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
    const dedupKey = method.toUpperCase() === "GET" ? `${method}:${url}` : null;
    const requestPromise = this._executeRequest(method, url, data, config, startTime, routeKey, urlObj);
    if (dedupKey && config.deduplicate !== false) {
      this.pendingRequests.set(dedupKey, requestPromise);
      requestPromise.catch(() => {
      }).finally(() => this.pendingRequests.delete(dedupKey));
    }
    return requestPromise;
  }
  async _executeRequest(method, url, data, config, startTime, routeKey, urlObj) {
    var _a, _b, _c;
    if (config.rateLimiting.enabled) {
      try {
        await this.rateLimiter.checkLimit(urlObj.hostname, config.rateLimiting);
      } catch (error) {
        this.events.emit(events.RATE_LIMIT, { url, error: error.message });
        throw error;
      }
    }
    const options = {
      method,
      hostname: urlObj.hostname,
      port: urlObj.port ? Number(urlObj.port) : void 0,
      path: urlObj.pathname + urlObj.search,
      headers: generateHeaders(config),
      timeout: config.timeout,
      rejectUnauthorized: config.validateSSL,
      config
      // Store original config for interceptors
    };
    const cookies = this.cookieJar.getCookies(urlObj.hostname);
    if (cookies) {
      options.headers["Cookie"] = cookies;
    }
    if (config.params) {
      options.path += (urlObj.search ? "&" : "?") + buildQueryString(config.params);
    }
    if (data && config.formData) {
      const formData = await this._createFormData(data);
      data = formData.data;
      options.headers["Content-Type"] = `multipart/form-data; boundary=${formData.boundary}`;
    } else if (data && typeof data === "object" && !Buffer.isBuffer(data) && !options.headers["Content-Type"]) {
      options.headers["Content-Type"] = "application/json";
    }
    if (data && typeof data === "object" && !Buffer.isBuffer(data) && !options.headers["Content-Encoding"]) {
      const compressedData = await this._compressData(data);
      data = compressedData.data;
      options.headers["Content-Encoding"] = compressedData.encoding;
    }
    let finalOptions;
    try {
      finalOptions = await this.interceptors.request.executeRequestChain(options);
    } catch (error) {
      throw new RequestError("Request interceptor error", {
        original: error,
        options
      });
    }
    let attempt = 0;
    let redirectCount = config.redirectCount || 0;
    let circuitBreaker = null;
    if (config.circuitBreaker && config.circuitBreaker.enabled) {
      circuitBreaker = this.circuitBreakers.get(urlObj.hostname);
      if (!circuitBreaker) {
        circuitBreaker = new CircuitBreaker(config.circuitBreaker);
        this.circuitBreakers.set(urlObj.hostname, circuitBreaker);
      }
    }
    const requestCommand = async () => {
      if (config.humanize) {
        await delay(Math.random() * 1e3 + 500);
      }
      let response;
      const useHttp2 = config.useHttp2 && urlObj.protocol === "https:";
      if (useHttp2) {
        response = await this._makeHttp2Request(urlObj, finalOptions, data);
        this.metrics.http2Requests++;
      } else {
        response = await this._makeRequest(urlObj.protocol, finalOptions, data);
      }
      return response;
    };
    while (attempt < config.retries) {
      try {
        const response = circuitBreaker ? await circuitBreaker.execute(requestCommand, urlObj.hostname) : await requestCommand();
        if (config.followRedirects && [301, 302, 303, 307, 308].includes(response.status)) {
          if (redirectCount >= config.maxRedirects) {
            const err = new Error(`Max redirects exceeded (${config.maxRedirects})`);
            err.code = "MAX_REDIRECTS";
            err._noRetry = true;
            throw err;
          }
          redirectCount++;
          this.metrics.redirects++;
          const location = response.headers.location;
          this.events.emit(events.REDIRECT, { from: url, to: location });
          const redirectUrl = location.startsWith("http") ? location : new URL(location, url).href;
          return this.request(method, redirectUrl, data, {
            ...config,
            redirectCount,
            deduplicate: false
          });
        }
        const responseCookies = response.headers["set-cookie"];
        if (Array.isArray(responseCookies)) {
          responseCookies.forEach((cookie) => {
            this.cookieJar.setCookie(urlObj.hostname, cookie);
          });
        }
        const processedResponse = await this.interceptors.response.executeResponseChain(response);
        const contentType = processedResponse.headers["content-type"] || "";
        const type = detectResponseType(contentType);
        const validator = this.responseValidators.get(type);
        if (validator) {
          validator(processedResponse.data, this.config.responseSchema);
        }
        if (config.cache.enabled && method.toUpperCase() === "GET" && processedResponse.status === 200) {
          const cacheKey = this.cache.getCacheKey(method, url, data);
          this.cache.set(cacheKey, processedResponse, config.cache.ttl);
        }
        const requestTime = Date.now() - startTime;
        this.metrics.requestCount++;
        this.metrics.totalTime += requestTime;
        this.metrics.successCount++;
        this.metrics.lastRequestTime = requestTime;
        this.metrics.averageResponseTime = this.metrics.totalTime / this.metrics.requestCount;
        this.metrics.totalDataTransferred += processedResponse.data ? processedResponse.data.length : 0;
        let routeTime = this.routeMetrics.get(routeKey) || { count: 0, totalTime: 0 };
        routeTime.count++;
        routeTime.totalTime += requestTime;
        this.routeMetrics.set(routeKey, routeTime);
        this.metrics.routeTimes.set(routeKey, routeTime.totalTime / routeTime.count);
        this.events.emit(events.REQUEST_END, {
          method,
          url,
          status: processedResponse.status,
          time: requestTime,
          size: processedResponse.data ? processedResponse.data.length : 0
        });
        if (method.toUpperCase() === "HEAD") {
          return processedResponse.headers;
        }
        if (method.toUpperCase() === "OPTIONS") {
          return processedResponse.headers;
        }
        return await this._processResponse(processedResponse, config.responseType);
      } catch (error) {
        if (error._noRetry) {
          this.metrics.errorCount++;
          this.events.emit(events.REQUEST_ERROR, error);
          throw error;
        }
        const status = ((_a = error.response) == null ? void 0 : _a.status) || ((_c = (_b = error.context) == null ? void 0 : _b.response) == null ? void 0 : _c.status);
        const isClientError = status >= 400 && status < 500 && status !== 429;
        if (isClientError) {
          this.metrics.errorCount++;
          this.events.emit(events.REQUEST_ERROR, error);
          throw error;
        }
        attempt++;
        this.metrics.retries++;
        this.metrics.errorCount++;
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
      session.on("error", () => {
        this.http2Sessions.delete(authority);
      });
      session.on("goaway", () => {
        this.http2Sessions.delete(authority);
      });
    }
    return new Promise((resolve, reject) => {
      const headers = { ...options.headers };
      delete headers["connection"];
      delete headers["keep-alive"];
      delete headers["transfer-encoding"];
      delete headers["upgrade-insecure-requests"];
      delete headers["host"];
      const req = session.request({
        ...headers,
        ":method": options.method,
        ":path": options.path,
        ":authority": urlObj.host,
        ":scheme": "https"
      });
      const chunks = [];
      let totalBytes = 0;
      let responseHeaders = null;
      let responseStatus = null;
      req.on("response", (headers2) => {
        responseStatus = headers2[":status"];
        responseHeaders = { ...headers2 };
        delete responseHeaders[":status"];
        delete responseHeaders[":method"];
        delete responseHeaders[":path"];
        delete responseHeaders[":authority"];
        delete responseHeaders[":scheme"];
      });
      req.on("data", (chunk) => {
        chunks.push(chunk);
        totalBytes += chunk.length;
        if (responseHeaders) {
          this.events.emit(events.PROGRESS, {
            loaded: totalBytes,
            total: parseInt(responseHeaders["content-length"], 10) || 0,
            percent: totalBytes / (parseInt(responseHeaders["content-length"], 10) || 1) * 100
          });
        }
      });
      req.on("end", () => {
        let body = Buffer.concat(chunks);
        const encoding = responseHeaders && responseHeaders["content-encoding"];
        const contentLength = parseInt(responseHeaders && responseHeaders["content-length"], 10) || 0;
        const cfg = options.config || this.config;
        if (cfg.compression.response && contentLength >= cfg.compression.responseMinSize && encoding) {
          try {
            if (encoding === "gzip") {
              body = zlib.gunzipSync(body);
            } else if (encoding === "deflate") {
              body = zlib.inflateSync(body);
            } else if (encoding === "br") {
              body = zlib.brotliDecompressSync(body);
            }
          } catch (e) {
            reject(new RequestError("Decompression failed", { original: e, options }));
            return;
          }
        }
        resolve({
          data: body,
          headers: responseHeaders,
          status: responseStatus
        });
      });
      req.on("error", reject);
      if (data) {
        const payload = Buffer.isBuffer(data) ? data : typeof data === "string" ? data : JSON.stringify(data);
        req.write(payload);
      }
      req.end();
    });
  }
  _setupTimeouts(req, options) {
    var _a, _b, _c;
    const timeouts = {
      connect: ((_a = options.config.timeouts) == null ? void 0 : _a.connect) || 5e3,
      response: ((_b = options.config.timeouts) == null ? void 0 : _b.response) || 3e4,
      idle: ((_c = options.config.timeouts) == null ? void 0 : _c.idle) || 6e4
    };
    let connectTimer = null;
    let responseTimer = null;
    let idleTimer = null;
    const clearAll = () => {
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
      if (responseTimer) {
        clearTimeout(responseTimer);
        responseTimer = null;
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };
    req.once("close", clearAll);
    req.once("error", clearAll);
    connectTimer = setTimeout(() => {
      req.destroy(new TimeoutError("Connection timeout", "connect"));
    }, timeouts.connect);
    req.once("socket", () => {
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
      responseTimer = setTimeout(() => {
        req.destroy(new TimeoutError("Response timeout", "response"));
      }, timeouts.response);
    });
    req.once("response", (res) => {
      if (responseTimer) {
        clearTimeout(responseTimer);
        responseTimer = null;
      }
      const startIdle = () => {
        if (idleTimer) {
          clearTimeout(idleTimer);
        }
        idleTimer = setTimeout(() => {
          req.destroy(new TimeoutError("Idle timeout", "idle"));
        }, timeouts.idle);
      };
      startIdle();
      res.on("data", startIdle);
      res.once("end", () => {
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
      });
      res.once("error", clearAll);
    });
  }
  _makeRequest(protocol, options, data) {
    return new Promise((resolve, reject) => {
      const client = protocol === "https:" ? https : http;
      if (options.hostname && options.hostname.includes(":")) {
        try {
          options.hostname = options.hostname.replace(/^\[|\]$/g, "");
          const ipv6Pattern = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|::)$/;
          if (!ipv6Pattern.test(options.hostname)) {
            throw new ValidationError("Invalid IPv6 address format", { hostname: options.hostname });
          }
          options.hostname = `[${options.hostname}]`;
        } catch (error) {
          reject(new RequestError("Invalid IPv6 address", {
            original: error,
            options,
            protocol
          }));
          return;
        }
      }
      const req = client.request(options, (res) => {
        if (options.method === "HEAD" || options.method === "OPTIONS") {
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
        const contentLength = parseInt(res.headers["content-length"], 10) || 0;
        const requestCfg = options.config || this.config;
        const shouldDecompress = requestCfg.compression.response && contentLength >= requestCfg.compression.responseMinSize;
        if (shouldDecompress) {
          const encoding = res.headers["content-encoding"];
          if (encoding === "gzip") {
            stream = res.pipe(zlib.createGunzip());
          } else if (encoding === "deflate") {
            stream = res.pipe(zlib.createInflate());
          } else if (encoding === "br") {
            stream = res.pipe(zlib.createBrotliDecompress());
          }
        }
        let totalBytes = contentLength;
        let receivedBytes = 0;
        stream.on("data", (chunk) => {
          chunks.push(chunk);
          receivedBytes += chunk.length;
          if (totalBytes) {
            this.events.emit(events.PROGRESS, {
              loaded: receivedBytes,
              total: totalBytes,
              percent: receivedBytes / totalBytes * 100
            });
          }
        });
        stream.on("end", () => {
          resolve({
            data: Buffer.concat(chunks),
            headers: res.headers,
            status: res.statusCode,
            config: options
            // Include original config for error handling
          });
        });
        stream.on("error", (error) => {
          reject(new RequestError("Stream error", {
            original: error,
            options,
            protocol
          }));
        });
      });
      this._setupTimeouts(req, options);
      req.on("error", (error) => {
        let enhancedError;
        switch (error.code) {
          case "ECONNREFUSED":
            enhancedError = new RequestError("Connection refused", {
              original: error,
              options,
              protocol
            });
            break;
          case "ENOTFOUND":
            enhancedError = new RequestError("Host not found", {
              original: error,
              options,
              protocol
            });
            break;
          case "ECONNRESET":
            enhancedError = new RequestError("Connection reset", {
              original: error,
              options,
              protocol
            });
            break;
          case "ETIMEDOUT":
            enhancedError = new TimeoutError("Connection timed out", "connect", {
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
        const payload = Buffer.isBuffer(data) ? data : typeof data === "string" ? data : JSON.stringify(data);
        req.write(payload);
      }
      req.end();
    });
  }
  async _processResponse(response, responseType) {
    if (response.status >= 400) {
      throw new ResponseError(`HTTP Error ${response.status}`, response);
    }
    const contentType = response.headers["content-type"] || "";
    const type = responseType || detectResponseType(contentType);
    const validTypes = ["json", "text", "html", "buffer"];
    if (responseType && !validTypes.includes(responseType)) {
      this._log("error", `Invalid responseType: ${responseType}, falling back to buffer`);
    }
    const transformer = this.responseTransformers.get(type) || this.responseTransformers.get("buffer");
    if (!transformer) {
      this._log("error", `No transformer found for type: ${type}, using buffer`);
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
      return { data: jsonStr, encoding: "identity" };
    }
    if (jsonStr.length < this.config.compression.minSize) {
      return { data: jsonStr, encoding: "identity" };
    }
    return new Promise((resolve, reject) => {
      zlib.gzip(jsonStr, {
        level: 6,
        // Balanced compression
        memLevel: 8
        // Moderate memory usage
      }, (err, compressed) => {
        if (err) {
          resolve({ data: jsonStr, encoding: "identity" });
        } else {
          resolve({ data: compressed, encoding: "gzip" });
        }
      });
    });
  }
  async _createFormData(data) {
    if (!data || typeof data !== "object") {
      throw new ValidationError("FormData must be an object");
    }
    const boundary = `----WebKitFormBoundary${Math.random().toString(36).slice(2)}`;
    const chunks = [];
    for (const [key, value] of Object.entries(data)) {
      if (!key || typeof key !== "string") {
        throw new ValidationError("FormData keys must be non-empty strings");
      }
      chunks.push(Buffer.from(`\r
--${boundary}\r
`));
      if (Buffer.isBuffer(value) || value && value.buffer instanceof ArrayBuffer) {
        const filename = value.name || "file";
        chunks.push(Buffer.from(`Content-Disposition: form-data; name="${key}"; filename="${filename}"\r
`));
        chunks.push(Buffer.from(`Content-Type: ${value.type || "application/octet-stream"}\r
\r
`));
        chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value.buffer));
      } else {
        chunks.push(Buffer.from(`Content-Disposition: form-data; name="${key}"\r
\r
`));
        chunks.push(Buffer.from(String(value)));
      }
    }
    chunks.push(Buffer.from(`\r
--${boundary}--\r
`));
    return {
      boundary,
      data: Buffer.concat(chunks)
    };
  }
  // GraphQL support
  async query(url, { query, variables = {} } = {}, config = {}) {
    let endpoint = url;
    let queryData = query;
    let vars = variables;
    if (typeof url === "string" && (url.trim().startsWith("{") || url.trim().startsWith("query") || url.trim().startsWith("mutation"))) {
      queryData = url;
      vars = query || {};
      endpoint = config.endpoint || "/graphql";
    }
    const data = {
      query: queryData,
      variables: vars
    };
    const response = await this.post(endpoint, data, {
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      ...config
    });
    if (response && response.data) {
      return response.data;
    }
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
        "Accept": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      }
    };
    return new Promise((resolve, reject) => {
      const client = urlObj.protocol === "https:" ? https : http;
      const req = client.request(urlObj, options, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE connection failed: ${res.statusCode}`));
          return;
        }
        res.setEncoding("utf8");
        let buffer = "";
        if (onOpen) onOpen();
        res.on("data", (chunk) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop();
          lines.forEach((line) => {
            if (line.startsWith("data: ")) {
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
        res.on("error", (error) => {
          if (onError) onError(error);
          reject(error);
        });
      });
      req.on("error", (error) => {
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
    this._log("info", "Cache cleared");
  }
  // Reset circuit breakers
  resetCircuitBreakers(domain = null) {
    if (domain) {
      this.circuitBreakers.delete(domain);
      this._log("info", `Circuit breaker reset for domain: ${domain}`);
    } else {
      this.circuitBreakers.clear();
      this._log("info", "All circuit breakers reset");
    }
  }
  // Batch requests
  async batch(requests) {
    if (!Array.isArray(requests)) {
      throw new ValidationError("Batch requests must be an array");
    }
    return Promise.all(requests.map((req) => {
      const { method = "GET", url, data, config } = req;
      const methodLower = method.toLowerCase();
      const methodsWithBody = ["post", "put", "patch"];
      if (methodsWithBody.includes(methodLower)) {
        return this[methodLower](url, data, config).catch((err) => ({ error: err }));
      } else {
        return this[methodLower](url, config).catch((err) => ({ error: err }));
      }
    }));
  }
  // Download file helper - resolves with the raw Buffer (consistent with responseType: 'buffer')
  async download(url, config = {}) {
    return this.get(url, { ...config, responseType: "buffer" });
  }
  _getFilenameFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      return pathname.substring(pathname.lastIndexOf("/") + 1) || "download";
    } catch {
      return "download";
    }
  }
  // Close all connections
  async close() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
    for (const [authority, session] of this.http2Sessions.entries()) {
      session.close();
      this.http2Sessions.delete(authority);
    }
    this.sessions.clear();
    this.connectionPool.clear();
    this.cache.clear();
    this._log("info", "All connections closed");
  }
};
var createClient = (config) => new HTTPClient(config);

// lib/scraper.js
var AdvancedHTMLParser = class {
  constructor(html, options = {}) {
    this.html = typeof html === "string" ? html : String(html || "");
    this.elementCache = /* @__PURE__ */ new Map();
    this.debug = options.debug || false;
  }
  querySelector(selector) {
    return this._parseSelector(selector, true);
  }
  querySelectorAll(selector) {
    return this._parseSelector(selector, false);
  }
  _parseSelector(selector, single = false) {
    if (typeof selector !== "string") {
      return single ? null : [];
    }
    const parts = selector.trim().split(" ").filter((part) => part);
    let results = [this.html];
    for (const part of parts) {
      results = this._processSelectorPart(results, part);
      if (!results.length) break;
    }
    const attrMatch = selector.match(/@([a-z-]+)$/i);
    if (attrMatch) {
      results = results.map((el) => this._extractAttribute(el, attrMatch[1]));
    }
    return single ? results[0] || null : results;
  }
  _processSelectorPart(elements, selector) {
    if (typeof selector !== "string") {
      return [];
    }
    const results = [];
    const idMatch = selector.match(/^#([\w-]+)/);
    const classMatch = selector.match(/^\.([\w-]+)/);
    const attrMatch = selector.match(/\[([^\]=]+)(?:=([^\]]+))?\]/);
    for (const el of elements) {
      if (typeof el !== "string") continue;
      if (idMatch) {
        const found = this._getElementById(idMatch[1], el);
        if (found) results.push(found);
      } else if (classMatch) {
        results.push(...this._getElementsByClassName(classMatch[1], el));
      } else if (attrMatch) {
        results.push(...this._getElementsByAttribute(attrMatch[1], attrMatch[2], el));
      } else {
        results.push(...this._getElementsByTagName(selector, el));
      }
    }
    return results;
  }
  _getElementById(id, html = this.html) {
    const cacheKey = `id:${id}`;
    if (this.elementCache.has(cacheKey)) return this.elementCache.get(cacheKey);
    const regex = new RegExp(`<[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i");
    const match = regex.exec(html);
    const result = match ? this._createElementObject(match[0], match[1]) : null;
    this.elementCache.set(cacheKey, result);
    return result;
  }
  _getElementsByClassName(className, html = this.html) {
    const cacheKey = `class:${className}`;
    if (this.elementCache.has(cacheKey)) return this.elementCache.get(cacheKey);
    const regex = new RegExp(`<[^>]+class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "gi");
    const results = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
      results.push(this._createElementObject(match[0], match[1]));
    }
    this.elementCache.set(cacheKey, results);
    return results;
  }
  _getElementsByAttribute(attrName, attrValue, html = this.html) {
    const regex = attrValue ? new RegExp(`<[^>]+${attrName}=["']${attrValue}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "gi") : new RegExp(`<[^>]+${attrName}=["'][^"']+["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "gi");
    const results = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
      results.push(this._createElementObject(match[0], match[1]));
    }
    return results;
  }
  _getElementsByTagName(tag, html = this.html) {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
    const results = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
      results.push(this._createElementObject(match[0], match[1]));
    }
    return results;
  }
  _extractAttribute(element, attrName) {
    if (!(element == null ? void 0 : element.html)) return null;
    const match = element.html.match(new RegExp(`${attrName}=["']([^"']+)["']`, "i"));
    return match ? match[1] : null;
  }
  _createElementObject(fullHtml, content) {
    return {
      html: fullHtml,
      content: content.trim(),
      attributes: this._parseAttributes(fullHtml),
      children: this._getChildren(content)
    };
  }
  _parseAttributes(html) {
    const attrRegex = /(\w+)=["']([^"']+)["']/g;
    const attributes = {};
    let match;
    while ((match = attrRegex.exec(html)) !== null) {
      attributes[match[1]] = match[2];
    }
    return attributes;
  }
  _getChildren(html) {
    const children = [];
    const regex = /<[^>]+>([\s\S]*?)<\/[^>]+>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      if (match[1].trim()) {
        children.push(this._createElementObject(match[0], match[1]));
      }
    }
    return children;
  }
};
function parseHTML(html, selectors, options = {}) {
  if (Buffer.isBuffer(html)) {
    html = html.toString("utf-8");
  }
  if (typeof html !== "string") {
    throw new Error(`HTML must be a string or Buffer, got ${typeof html}`);
  }
  if (!html || html.trim().length === 0) {
    if (typeof selectors === "object" && !Array.isArray(selectors)) {
      const results = {};
      for (const key of Object.keys(selectors)) {
        results[key] = null;
      }
      return results;
    }
    return [];
  }
  const parser = new AdvancedHTMLParser(html, options);
  if (typeof selectors === "string") {
    return parser.querySelectorAll(selectors);
  }
  if (typeof selectors === "object" && !Array.isArray(selectors)) {
    const results = {};
    for (const [key, config] of Object.entries(selectors)) {
      if (typeof config === "string") {
        const attrMatch = config.match(/^(.+)@(\w+)$/);
        if (attrMatch) {
          const [, sel, attr] = attrMatch;
          const elements = parser.querySelectorAll(sel);
          results[key] = elements.map((el) => parser._extractAttribute(el, attr));
        } else {
          results[key] = parser.querySelectorAll(config);
        }
        continue;
      }
      if (typeof config === "object" && config.selector) {
        const { selector, type = "text", attr, multiple = true } = config;
        const elements = parser.querySelectorAll(selector);
        let extractedData;
        switch (type) {
          case "text":
            extractedData = elements.map((el) => (el == null ? void 0 : el.content) || "");
            break;
          case "html":
            extractedData = elements.map((el) => (el == null ? void 0 : el.html) || "");
            break;
          case "attr":
            extractedData = elements.map(
              (el) => attr ? parser._extractAttribute(el, attr) : null
            );
            break;
          default:
            extractedData = elements.map((el) => (el == null ? void 0 : el.content) || "");
        }
        results[key] = multiple ? extractedData : extractedData[0] || null;
        continue;
      }
      results[key] = parser.querySelectorAll(String(config));
    }
    return results;
  }
  if (Array.isArray(selectors)) {
    return selectors.map((sel) => parser.querySelectorAll(sel));
  }
  return [];
}

// index.mjs
var defaultClient = null;
var getDefaultClient = () => {
  if (!defaultClient) {
    defaultClient = createClient({ debug: false });
  }
  return defaultClient;
};
var swiftly = (config = {}) => {
  const client = createClient(config);
  const instance = (url, reqConfig) => client.get(url, reqConfig);
  instance.get = (url, config2) => client.get(url, config2);
  instance.post = (url, data, config2) => client.post(url, data, config2);
  instance.put = (url, data, config2) => client.put(url, data, config2);
  instance.patch = (url, data, config2) => client.patch(url, data, config2);
  instance.delete = (url, config2) => client.delete(url, config2);
  instance.head = (url, config2) => client.head(url, config2);
  instance.options = (url, config2) => client.options(url, config2);
  instance.on = (event, callback) => client.on(event, callback);
  instance.off = (event, callback) => client.off(event, callback);
  instance.interceptors = client.interceptors;
  instance.query = (url, queryData, config2) => client.query(url, queryData, config2);
  instance.subscribe = (url, callbacks, config2) => client.subscribe(url, callbacks, config2);
  instance.scrape = (url, selector, config2 = {}) => {
    return client.get(url, { ...config2, responseType: "text", cache: { enabled: false } }).then((response) => parseHTML(response, selector, config2));
  };
  instance.batch = (requests) => client.batch(requests);
  instance.download = (url, config2) => client.download(url, config2);
  instance.clearCache = () => client.clearCache();
  instance.resetCircuitBreakers = (domain) => client.resetCircuitBreakers(domain);
  instance.getMetrics = () => client.getMetrics();
  instance.close = () => client.close();
  instance.setBaseURL = (url) => {
    client.config.baseURL = url;
  };
  instance.setDefaultHeaders = (headers) => {
    Object.assign(client.config.headers || {}, headers);
  };
  instance.setTimeout = (timeout) => {
    client.config.timeout = timeout;
  };
  instance.setDebug = (debug) => {
    client.config.debug = debug;
  };
  instance.getConfig = () => client.config;
  return instance;
};
var bindStatic = (method) => (url, ...args) => getDefaultClient()[method](url, ...args);
swiftly.get = bindStatic("get");
swiftly.post = bindStatic("post");
swiftly.put = bindStatic("put");
swiftly.patch = bindStatic("patch");
swiftly.delete = bindStatic("delete");
swiftly.head = bindStatic("head");
swiftly.options = bindStatic("options");
swiftly.batch = bindStatic("batch");
swiftly.download = bindStatic("download");
swiftly.query = bindStatic("query");
swiftly.subscribe = bindStatic("subscribe");
swiftly.clearCache = bindStatic("clearCache");
swiftly.resetCircuitBreakers = bindStatic("resetCircuitBreakers");
swiftly.getMetrics = bindStatic("getMetrics");
swiftly.on = bindStatic("on");
swiftly.off = bindStatic("off");
swiftly.scrape = bindStatic("scrape");
swiftly.client = getDefaultClient;
swiftly.events = events;
var index_default = swiftly;
export {
  index_default as default,
  events,
  parseHTML
};
/**
 * Header Generation Utils
 * @author Cognima
 * @license MIT
 */
/**
 * Utility Functions
 * @author Cognima
 * @license MIT
 */
/**
 * Event System Implementation
 * @author Cognima
 * @license MIT
 */
/**
 * Request/Response Interceptor System
 * @author Cognima
 * @license MIT
 */
/**
 * Rate Limiter Implementation
 * @author Cognima
 * @license MIT
 */
/**
 * Cache System Implementation
 * @author Cognima
 * @license MIT
 */
/**
 * Custom Error Classes
 * @author Cognima
 * @license MIT
 */
/**
 * HTTP Client Implementation
 * @author Cognima
 * @license MIT
 */
/**
 * Advanced HTML Scraper
 * @author Cognima
 * @license MIT
 */
/**
 * Swiftly - Lightweight HTTP client (ESM entry)
 * @author Cognima
 * @license MIT
 */
//# sourceMappingURL=index.mjs.map
