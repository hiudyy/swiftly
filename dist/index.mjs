// lib/client.js
import http2 from "http";
import https2 from "https";
import http22 from "http2";
import tls from "tls";
import zlib from "zlib";
import fs from "fs";
import { Readable } from "stream";

// lib/headers.js
var DEFAULT_USER_AGENT = "Swiftly/1.0 (+https://github.com/hiudyy/swiftly)";
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
var delay = (ms, signal = null) => new Promise((resolve, reject) => {
  if (signal) {
    if (signal.aborted) return reject(new Error("Aborted"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  } else {
    setTimeout(resolve, ms);
  }
});
var buildQueryString = (params) => {
  const normalized = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== null && typeof value === "object" && !(value instanceof Date)) {
      normalized[key] = JSON.stringify(value);
    } else {
      normalized[key] = value;
    }
  }
  return querystring.stringify(normalized);
};

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
  hasListeners(event) {
    const cb = this.events.get(event);
    return !!cb && cb.length > 0;
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
  CACHE_STORE: "cache:store",
  CACHE_INVALID: "cache:invalid",
  RATE_LIMIT: "rate:limit",
  REDIRECT: "redirect",
  PROGRESS: "progress",
  DOWNLOAD_PROGRESS: "download:progress",
  UPLOAD_PROGRESS: "upload:progress",
  SOCKET_ASSIGNED: "socket:assigned",
  ABORT: "abort",
  PROXY_CONNECT: "proxy:connect",
  CIRCUIT_OPEN: "circuit:open",
  CIRCUIT_CLOSE: "circuit:close",
  CIRCUIT_HALF_OPEN: "circuit:half-open",
  CIRCUIT_REJECTED: "circuit:rejected"
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
  _domainOf(target) {
    if (!target || typeof target !== "string") return target;
    if (target.startsWith("http://") || target.startsWith("https://") || target.includes("://")) {
      try {
        return new URL(target).hostname;
      } catch {
        return target;
      }
    }
    return target;
  }
  // Parse a target (URL or bare host) into the pieces used for matching.
  _parseTarget(target) {
    let hostname = "";
    let protocol = null;
    let pathname = "/";
    if (target && typeof target === "string" && target.includes("://")) {
      try {
        const u = new URL(target);
        hostname = u.hostname.toLowerCase();
        protocol = u.protocol;
        pathname = u.pathname || "/";
      } catch {
        hostname = target.toLowerCase();
      }
    } else {
      hostname = (target || "").toLowerCase();
    }
    return { hostname, protocol, pathname };
  }
  // RFC 6265 domain matching: a host-only cookie matches the exact host
  // only; a domain cookie also matches any subdomain of its domain.
  _domainMatches(requestHost, cookieDomain, hostOnly) {
    if (hostOnly) return requestHost === cookieDomain;
    if (requestHost === cookieDomain) return true;
    return requestHost.endsWith("." + cookieDomain);
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
    if (!domain || typeof domain !== "string") {
      throw new Error("Domain must be a non-empty string");
    }
    const reqDomain = domain.toLowerCase();
    if (typeof name === "string" && name.includes("=") && !name.includes("://")) {
      return this._setFromHeader(reqDomain, name);
    }
    if (!this.cookies.has(reqDomain)) {
      this.cookies.set(reqDomain, /* @__PURE__ */ new Map());
    }
    let entry;
    if (typeof name === "object" && name !== null) {
      entry = { name: name.name, value: String(name.value), ...name };
    } else {
      entry = { name, value: String(value), ...opts };
    }
    if (!entry.name) {
      throw new Error("Cookie name cannot be empty");
    }
    const cookieDomain = entry.domain ? String(entry.domain).toLowerCase().replace(/^\./, "") : reqDomain;
    const hostOnly = !entry.domain;
    this.cookies.get(cookieDomain).set(entry.name, {
      value: String(entry.value),
      expires: entry.expires instanceof Date ? entry.expires : entry.expires ? new Date(entry.expires) : null,
      httpOnly: !!entry.httpOnly,
      secure: !!entry.secure,
      sameSite: entry.sameSite || "Lax",
      _domain: cookieDomain,
      _hostOnly: hostOnly,
      _path: entry.path || "/"
    });
    return this;
  }
  // Internal: store a raw `Set-Cookie` response header for a domain.
  // Honors the Domain, Path, Secure, HttpOnly and SameSite attributes.
  _setFromHeader(domain, cookie) {
    const reqDomain = domain.toLowerCase();
    try {
      const parts = cookie.split(";").map((s) => s.trim()).filter(Boolean);
      if (parts.length === 0) throw new Error("Invalid cookie format");
      const first = parts[0].split("=");
      if (first.length < 2) throw new Error("Invalid cookie format");
      const name = first[0].trim();
      const value = first.slice(1).join("=").trim();
      if (!name) throw new Error("Cookie name cannot be empty");
      const getAttr = (attr) => {
        const p = parts.find((x) => x.toLowerCase().startsWith(attr.toLowerCase() + "="));
        return p ? p.slice(p.indexOf("=") + 1).trim() : null;
      };
      const domainAttr = getAttr("Domain");
      const pathAttr = getAttr("Path");
      const sameSiteAttr = getAttr("SameSite");
      const cookieDomain = domainAttr ? domainAttr.toLowerCase().replace(/^\./, "") : reqDomain;
      const hostOnly = !domainAttr;
      if (!this.cookies.has(cookieDomain)) {
        this.cookies.set(cookieDomain, /* @__PURE__ */ new Map());
      }
      const full = cookie.toLowerCase();
      this.cookies.get(cookieDomain).set(name, {
        value,
        expires: this._getExpiryFromCookie(cookie),
        httpOnly: full.includes("httponly"),
        secure: full.includes("secure"),
        sameSite: sameSiteAttr || "Lax",
        _domain: cookieDomain,
        _hostOnly: hostOnly,
        _path: pathAttr || "/"
      });
    } catch (error) {
    }
    return this;
  }
  /**
   * Get cookies for a URL/domain as a `Cookie` header value.
   * Respects the Domain (incl. subdomains), Path and Secure attributes.
   * @param {string} url - URL or domain
   * @returns {string}
   */
  getCookies(url) {
    if (this.cookies.size === 0) return "";
    this._clearExpired();
    const { hostname, protocol, pathname } = this._parseTarget(url);
    const out = [];
    for (const [domainKey, cookies] of this.cookies) {
      for (const [name, data] of cookies) {
        if (!this._domainMatches(hostname, data._domain, data._hostOnly)) continue;
        if (!pathname.startsWith(data._path)) continue;
        if (data.secure && protocol !== "https:") continue;
        out.push(`${name}=${data.value}`);
      }
    }
    return out.join("; ");
  }
  /**
   * Get the full cookie map for a URL/domain (for inspection; secure
   * cookies are included regardless of the request protocol).
   * @param {string} url - URL or domain
   * @returns {Array<{name, value, expires, httpOnly, secure, sameSite, path}>}
   */
  getCookiesMap(url) {
    this._clearExpired();
    const { hostname, pathname } = this._parseTarget(url);
    const out = [];
    for (const [domainKey, cookies] of this.cookies) {
      for (const [name, data] of cookies) {
        if (!this._domainMatches(hostname, data._domain, data._hostOnly)) continue;
        if (!pathname.startsWith(data._path)) continue;
        out.push({ name, ...data });
      }
    }
    return out;
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
        path: data.path || "/"
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
    if (!data || typeof data !== "object") return this;
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
        } catch (_) {
        }
      }
    }
    return this;
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
var defaultStorage = () => /* @__PURE__ */ new Map();
var CacheStore = class {
  constructor(config = {}) {
    this.config = {
      ttl: 3e5,
      // 5 minutos
      maxSize: 1e3,
      staleWhileRevalidate: false,
      ...config
    };
    this.storage = this.config.storage || defaultStorage();
    this.store = this.storage instanceof Map ? this.storage : null;
  }
  _wrap(key) {
    if (this.store) return this.store;
    return this.storage;
  }
  set(key, value, ttl = this.config.ttl) {
    const store = this._wrap(key);
    if (this.store && this.store.size >= this.config.maxSize) {
      this._cleanup();
    }
    const now = Date.now();
    store.set(key, {
      value,
      expiresAt: now + ttl,
      lastAccess: now
    });
  }
  get(key) {
    const item = this._getRaw(key);
    if (!item) return null;
    const now = Date.now();
    if (now > item.expiresAt) {
      this._wrap(key).delete(key);
      return null;
    }
    item.lastAccess = now;
    return item.value;
  }
  /**
   * Like get(), but returns expired entries too (used by stale-while-revalidate).
   * @returns {null | { value: any, stale: boolean }}
   */
  peek(key) {
    const item = this._getRaw(key);
    if (!item) return null;
    const now = Date.now();
    return { value: item.value, stale: now > item.expiresAt };
  }
  _getRaw(key) {
    const store = this._wrap(key);
    return store.get ? store.get(key) : null;
  }
  has(key) {
    return this.get(key) !== null;
  }
  delete(key) {
    return this._wrap(key).delete(key);
  }
  clear() {
    this._wrap().clear();
  }
  _cleanup() {
    const now = Date.now();
    const store = this.store;
    for (const [key, item] of store.entries()) {
      if (now > item.expiresAt) {
        store.delete(key);
      }
    }
    if (store.size >= this.config.maxSize) {
      const entries = Array.from(store.entries()).sort((a, b) => a[1].lastAccess - b[1].lastAccess);
      const toDelete = Math.max(1, Math.floor(this.config.maxSize * 0.2));
      for (let i = 0; i < toDelete && i < entries.length; i++) {
        store.delete(entries[i][0]);
      }
    }
  }
  /**
   * Build a deterministic cache key.
   * @param {string} method - HTTP method
   * @param {string} url - request URL
   * @param {*} data - request body
   * @param {object} [options] - { ignoreQuery, keyBuilder, vary }
   * @returns {string}
   */
  getCacheKey(method, url, data, options = {}) {
    if (options.keyBuilder) {
      return options.keyBuilder(method, url, data);
    }
    let u = url;
    if (options.ignoreQuery) {
      const q = u.indexOf("?");
      u = q === -1 ? u : u.slice(0, q);
    }
    const parts = [method.toUpperCase(), u];
    if (data) {
      parts.push(typeof data === "string" ? data : JSON.stringify(data));
    }
    if (options.vary) {
      parts.push("vary:" + options.vary);
    }
    return parts.join("|");
  }
  getStats() {
    const now = Date.now();
    let validItems = 0;
    let expiredItems = 0;
    let totalSize = 0;
    for (const [key, item] of this.store ? this.store.entries() : []) {
      if (now > item.expiresAt) {
        expiredItems++;
      } else {
        validItems++;
        totalSize += JSON.stringify(item.value).length;
      }
    }
    return {
      size: this.store ? this.store.size : 0,
      validItems,
      expiredItems,
      maxSize: this.config.maxSize,
      totalSize,
      utilizationPercent: this.store ? this.store.size / this.config.maxSize * 100 : 0
    };
  }
};
var createCacheStore = (config) => new CacheStore(config);

// lib/agent.js
import http from "http";
import https from "https";
function getAgent(protocol, hostKey, config, pool) {
  if (config && config.agent) return config.agent;
  const settings = config || {};
  const keepAlive = settings.keepAlive !== false;
  const maxSockets = settings.maxSockets || Infinity;
  const maxFreeSockets = settings.maxFreeSockets || 256;
  const cacheKey = `${protocol}//${hostKey}::ka=${keepAlive}:ms=${maxSockets}:mfs=${maxFreeSockets}`;
  let agent = pool.get(cacheKey);
  if (agent) return agent;
  const ctor = protocol === "https:" ? https.Agent : http.Agent;
  agent = new ctor({
    keepAlive,
    maxSockets,
    maxFreeSockets,
    // Keep warm sockets alive a bit longer; 0 disables per-request keepalive
    keepAliveMsecs: settings.keepAliveMsecs || 1e3
  });
  pool.set(cacheKey, agent);
  return agent;
}
function destroyAgents(pool) {
  for (const agent of pool.values()) {
    try {
      agent.destroy();
    } catch (_) {
    }
  }
  pool.clear();
}

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
var AbortError = class extends SwiftlyError {
  constructor(message = "Request aborted", context = {}) {
    super(message, "ABORT_ERROR", context);
    this.name = "AbortError";
  }
};

// lib/client.js
var undiciRequestFn = null;
var undiciLoading = null;
async function loadUndici() {
  if (undiciRequestFn) return undiciRequestFn;
  if (!undiciLoading) {
    undiciLoading = import("undici").then((mod) => {
      undiciRequestFn = mod.request;
      return undiciRequestFn;
    }).catch((e) => {
      undiciLoading = null;
      throw e;
    });
  }
  return undiciLoading;
}
var VALID_METHODS = Object.freeze({
  GET: true,
  POST: true,
  PUT: true,
  DELETE: true,
  PATCH: true,
  HEAD: true,
  OPTIONS: true
});
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
var HTTPClient = class _HTTPClient {
  constructor(config = {}) {
    this.config = {
      // Socket timeout is OPT-IN (perf-first, like axios's default of 0):
      // no per-request timer is created unless `timeout` is set.
      timeout: null,
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
      // Timer-based timeouts are OPT-IN (perf-first): `config.timeout`
      // still guards the socket natively, but the connect/response/idle
      // timers only run when `timeouts` is explicitly configured.
      timeouts: null,
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
      // Connection pooling (keep-alive Agents per origin)
      keepAlive: true,
      maxSockets: Infinity,
      maxFreeSockets: 256,
      agent: null,
      // custom http.Agent / https.Agent override
      // Auth helpers
      auth: null,
      // { username, password } -> Basic auth
      bearer: null,
      // -> Authorization: Bearer <token>
      token: null,
      // -> Authorization: <token>
      // Retry refinements
      retryOn: null,
      // number[], or (error) => boolean
      retryBackoff: null,
      // exponential factor (>=1); default: linear
      retryJitter: false,
      // adds randomized jitter to backoff
      maxRetryAfter: 6e4,
      // cap for Retry-After honored delay
      onRetry: null,
      // (attempt, error, delay) => void
      // Hooks (informational)
      onRequest: null,
      onResponse: null,
      onError: null,
      onDownloadProgress: null,
      onUploadProgress: null,
      // Streaming
      stream: false,
      // Transport: 'http' (default) | 'undici' (optional, lazy-loaded)
      transport: "http",
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
    this._refreshing = /* @__PURE__ */ new Set();
    this.pendingRequests = /* @__PURE__ */ new Map();
    this._mergeCache = /* @__PURE__ */ new WeakMap();
    this._urlCache = /* @__PURE__ */ new Map();
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
    if (typeof method === "string" && VALID_METHODS[method] && typeof url === "string" && url.charCodeAt(0) === 104 && // 'h' — http(s):// absolute URL
    (data === null || typeof data === "object" || typeof data === "string") && (config === void 0 || config === null || typeof config === "object") && !(config && config.headers)) {
      return;
    }
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
    if (!VALID_METHODS[method.toUpperCase()]) {
      errors.push(`Invalid method: ${method}. Valid methods are: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS`);
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
    if (!this.config.baseURL && !params) {
      return url;
    }
    try {
      let fullUrl = url;
      if (this.config.baseURL && !url.startsWith("http")) {
        const base = this.config.baseURL.replace(/\/$/, "");
        const path = url.startsWith("/") ? url : "/" + url;
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
  // Compute an auth identity string used to vary the cache key, so that
  // responses for different credentials are never shared (prevents
  // leaking one user's cached response to another on the same endpoint).
  _authVary(config) {
    const parts = [
      config.headers && config.headers["Authorization"],
      config.auth && config.auth.username,
      config.auth && config.auth.password,
      config.bearer,
      config.token
    ];
    return parts.filter(Boolean).join("|");
  }
  // Métodos HTTP melhorados
  async get(url, config = {}) {
    this._validateRequestParams("GET", url, null, config);
    this._log("info", `GET request to ${url}`);
    return this.request("GET", url, null, config).catch((error) => {
      this._log("error", `GET request failed: ${error.message}`);
      throw error;
    });
  }
  async post(url, data = null, config = {}) {
    this._validateRequestParams("POST", url, data, config);
    this._log("info", `POST request to ${url}`);
    if (config.formData && !data) {
      throw new ValidationError("Form data is required when formData option is enabled");
    }
    return this.request("POST", url, data, config).catch((error) => {
      this._log("error", `POST request failed: ${error.message}`);
      throw error;
    });
  }
  async put(url, data = null, config = {}) {
    this._validateRequestParams("PUT", url, data, config);
    this._log("info", `PUT request to ${url}`);
    return this.request("PUT", url, data, config).catch((error) => {
      this._log("error", `PUT request failed: ${error.message}`);
      throw error;
    });
  }
  async delete(url, config = {}) {
    this._validateRequestParams("DELETE", url, null, config);
    this._log("info", `DELETE request to ${url}`);
    return this.request("DELETE", url, null, config).catch((error) => {
      this._log("error", `DELETE request failed: ${error.message}`);
      throw error;
    });
  }
  async patch(url, data = null, config = {}) {
    this._validateRequestParams("PATCH", url, data, config);
    this._log("info", `PATCH request to ${url}`);
    return this.request("PATCH", url, data, config).catch((error) => {
      this._log("error", `PATCH request failed: ${error.message}`);
      throw error;
    });
  }
  async head(url, config = {}) {
    this._validateRequestParams("HEAD", url, null, config);
    this._log("info", `HEAD request to ${url}`);
    return this.request("HEAD", url, null, config).catch((error) => {
      this._log("error", `HEAD request failed: ${error.message}`);
      throw error;
    });
  }
  async options(url, config = {}) {
    this._validateRequestParams("OPTIONS", url, null, config);
    this._log("info", `OPTIONS request to ${url}`);
    return this.request("OPTIONS", url, null, config).catch((error) => {
      this._log("error", `OPTIONS request failed: ${error.message}`);
      throw error;
    });
  }
  _registerDefaultTransformers() {
    this.responseTransformers.set("json", (data) => {
      try {
        const text = data.toString("utf-8");
        if (!text.length) {
          throw new Error("Empty response body");
        }
        if (text.charCodeAt(0) === 65279) {
          return JSON.parse(text.slice(1));
        }
        return JSON.parse(text);
      } catch (e) {
        throw new Error(`Invalid JSON response: ${e.message}`);
      }
    });
    this.responseTransformers.set("text", (data) => {
      return data.toString("utf-8");
    });
    this.responseTransformers.set("html", (data) => {
      const text = data.toString("utf-8");
      if (!text.includes("<!DOCTYPE html>") && !text.includes("<html")) {
        throw new Error("Invalid HTML response");
      }
      return text;
    });
    this.responseTransformers.set("buffer", (data) => data);
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
    if (!customConfig || Object.keys(customConfig).length === 0) {
      return this.config;
    }
    const cached = this._mergeCache.get(customConfig);
    if (cached) return cached;
    const merged = { ...this.config };
    for (const key in customConfig) {
      const v = customConfig[key];
      const base = this.config[key];
      if (v && typeof v === "object" && !Array.isArray(v) && base && typeof base === "object" && !Array.isArray(base)) {
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
    const isGet = upperMethod === "GET";
    const formattedUrl = this._formatUrl(url, config.params);
    if (config.cache.enabled && isGet && !config.stream) {
      const cacheKey = this.cache.getCacheKey(upperMethod, formattedUrl, data, {
        ...config.cache,
        vary: this._authVary(config)
      });
      if (config.cache.staleWhileRevalidate) {
        const peeked = this.cache.peek(cacheKey);
        if (peeked) {
          this.metrics.cacheHits++;
          this._emit(events.CACHE_HIT, () => ({ url: formattedUrl, stale: peeked.stale }));
          if (peeked.stale && !this._refreshing.has(cacheKey)) {
            this._refreshing.add(cacheKey);
            this._refreshCacheEntry(cacheKey, upperMethod, formattedUrl, data, config).catch(() => {
            }).finally(() => this._refreshing.delete(cacheKey));
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
    const routeKey = config.trackRouteTimes ? `${upperMethod} ${urlObj.pathname}` : null;
    if (isGet && config.deduplicate !== false && !config.stream) {
      const dedupKey2 = `${upperMethod}:${formattedUrl}`;
      const pending = this.pendingRequests.get(dedupKey2);
      if (pending) {
        this._log("debug", `Deduplicating request: ${dedupKey2}`);
        return pending;
      }
    }
    this._emit(events.REQUEST_START, () => ({ method: upperMethod, url: formattedUrl, config }));
    const dedupKey = isGet && !config.stream ? `${upperMethod}:${formattedUrl}` : null;
    const requestPromise = this._executeRequest(upperMethod, formattedUrl, data, config, startTime, routeKey, urlObj);
    if (dedupKey && config.deduplicate !== false) {
      this.pendingRequests.set(dedupKey, requestPromise);
      requestPromise.catch(() => {
      }).finally(() => this.pendingRequests.delete(dedupKey));
    }
    return requestPromise;
  }
  // Background refresh for stale-while-revalidate cache entries.
  async _refreshCacheEntry(cacheKey, method, url, data, config) {
    try {
      const result = await this._executeRequest(
        method,
        url,
        data,
        { ...config, cache: { enabled: false }, stream: false },
        Date.now(),
        null,
        new URL(url)
      );
      if (result !== void 0 && result !== null) {
        this.cache.set(cacheKey, result, config.cache.ttl);
      }
    } catch (_) {
    }
  }
  async _executeRequest(method, url, data, config, startTime, routeKey, urlObj) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (config.signal && config.signal.aborted) {
      throw new AbortError();
    }
    if (config.rateLimiting.enabled) {
      try {
        await this.rateLimiter.checkLimit(urlObj.hostname, config.rateLimiting);
      } catch (error) {
        this.events.emit(events.RATE_LIMIT, { url, error: error.message });
        throw error;
      }
    }
    const streamMode = !!config.stream;
    if (streamMode && config.retries > 1) {
      config = { ...config, retries: 1 };
    }
    const options = {
      method,
      hostname: urlObj.hostname,
      port: urlObj.port ? Number(urlObj.port) : void 0,
      path: urlObj.pathname + urlObj.search,
      headers: generateHeaders(config),
      // Only create a native socket timer when a timeout is configured.
      timeout: typeof config.timeout === "number" ? config.timeout : void 0,
      rejectUnauthorized: config.validateSSL,
      config
      // Store original config for interceptors
    };
    if (config.agent) {
      options.agent = config.agent;
    } else if (!config.transport || config.transport === "http") {
      const hostKey = `${urlObj.hostname}:${urlObj.port || (urlObj.protocol === "https:" ? 443 : 80)}`;
      options.agent = getAgent(urlObj.protocol, hostKey, config, this.connectionPool);
    }
    const cookies = this.cookieJar.getCookies(urlObj.href);
    if (cookies) {
      options.headers["Cookie"] = cookies;
    }
    if (!options.headers["Authorization"]) {
      if (config.auth && config.auth.username !== void 0) {
        options.headers["Authorization"] = "Basic " + Buffer.from(`${config.auth.username}:${config.auth.password || ""}`).toString("base64");
      } else if (config.bearer) {
        options.headers["Authorization"] = `Bearer ${config.bearer}`;
      } else if (config.token) {
        options.headers["Authorization"] = config.token;
      }
    }
    if (data && config.formData) {
      const formData = await this._createFormData(data);
      data = formData.data;
      options.headers["Content-Type"] = `multipart/form-data; boundary=${formData.boundary}`;
    } else if (data && typeof data === "object" && !Buffer.isBuffer(data) && !(data instanceof Readable) && !options.headers["Content-Type"]) {
      options.headers["Content-Type"] = "application/json";
    }
    if (data && typeof data === "object" && !Buffer.isBuffer(data) && !(data instanceof Readable) && !options.headers["Content-Encoding"]) {
      const compressedData = await this._compressData(data);
      data = compressedData.data;
      options.headers["Content-Encoding"] = compressedData.encoding;
    }
    let finalOptions = options;
    if (this.interceptors.request.handlers.length > 0) {
      try {
        finalOptions = await this.interceptors.request.executeRequestChain(options);
      } catch (error) {
        throw new RequestError("Request interceptor error", {
          original: error,
          options
        });
      }
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
    if (config.humanize) {
      await delay(Math.random() * 1e3 + 500, config.signal);
    }
    if (config.onRequest) {
      try {
        config.onRequest({ method, url, options: finalOptions });
      } catch (_) {
      }
    }
    const useHttp2 = config.useHttp2 && urlObj.protocol === "https:" && !streamMode;
    const useUndici = config.transport === "undici" && !useHttp2 && !streamMode;
    const performRequest = useUndici ? () => this._undiciRequest(urlObj, finalOptions, data) : useHttp2 ? () => this._makeHttp2Request(urlObj, finalOptions, data) : () => this._makeRequest(urlObj.protocol, finalOptions, data);
    while (attempt < config.retries) {
      try {
        const response = circuitBreaker ? await circuitBreaker.execute(performRequest, urlObj.hostname) : await performRequest();
        if (useHttp2) this.metrics.http2Requests++;
        if (circuitBreaker && response.status >= 500) {
          circuitBreaker.handleFailure(urlObj.hostname);
        }
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
          if (response.data && typeof response.data.destroy === "function") {
            response.data.destroy();
          }
          return this.request(method, redirectUrl, data, {
            ...config,
            params: void 0,
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
        const processedResponse = this.interceptors.response.handlers.length > 0 ? await this.interceptors.response.executeResponseChain(response) : response;
        const requestTime = Date.now() - startTime;
        processedResponse.duration = requestTime;
        const bodyLength = processedResponse.data ? processedResponse.data.length ?? 0 : 0;
        this.metrics.requestCount++;
        this.metrics.totalTime += requestTime;
        this.metrics.successCount++;
        this.metrics.lastRequestTime = requestTime;
        this.metrics.totalDataTransferred += bodyLength;
        if (config.trackRouteTimes) {
          let routeTime = this.routeMetrics.get(routeKey) || { count: 0, totalTime: 0 };
          routeTime.count++;
          routeTime.totalTime += requestTime;
          this.routeMetrics.set(routeKey, routeTime);
          this.metrics.routeTimes.set(routeKey, routeTime.totalTime / routeTime.count);
        }
        this._emit(events.REQUEST_END, () => ({
          method,
          url,
          status: processedResponse.status,
          time: requestTime,
          size: bodyLength
        }));
        if (method === "HEAD") {
          return processedResponse.headers;
        }
        if (method === "OPTIONS") {
          return processedResponse.headers;
        }
        if (streamMode) {
          if (config.onResponse) {
            try {
              config.onResponse(processedResponse.data, processedResponse);
            } catch (_) {
            }
          }
          return processedResponse.data;
        }
        const processed = this._processResponse(processedResponse, config.responseType);
        const result = processed && typeof processed.then === "function" ? await processed : processed;
        if (config.responseSchema && !streamMode && config.responseType !== "raw") {
          const type = detectResponseType(processedResponse.headers["content-type"] || "");
          const validator = this.responseValidators.get(type);
          if (validator) {
            validator(result, config.responseSchema);
          }
        }
        if (config.cache.enabled && method === "GET" && processedResponse.status === 200 && !streamMode) {
          const cacheKey = this.cache.getCacheKey(method, url, data, {
            ...config.cache,
            vary: this._authVary(config)
          });
          this.cache.set(cacheKey, result, config.cache.ttl);
          this._emit(events.CACHE_STORE, () => ({ url }));
        }
        if (config.onResponse) {
          try {
            config.onResponse(result, processedResponse);
          } catch (_) {
          }
        }
        return result;
      } catch (error) {
        if (error._noRetry || error instanceof AbortError) {
          this.metrics.errorCount++;
          this.events.emit(events.REQUEST_ERROR, error);
          if (config.onError) {
            try {
              config.onError(error);
            } catch (_) {
            }
          }
          throw error;
        }
        const status = ((_a = error.response) == null ? void 0 : _a.status) || ((_c = (_b = error.context) == null ? void 0 : _b.response) == null ? void 0 : _c.status);
        let shouldRetry;
        if (config.retryOn) {
          shouldRetry = Array.isArray(config.retryOn) ? status !== void 0 && config.retryOn.includes(status) : config.retryOn(error) === true;
        } else {
          shouldRetry = !(status >= 400 && status < 500 && status !== 429);
        }
        if (!shouldRetry) {
          this.metrics.errorCount++;
          this.events.emit(events.REQUEST_ERROR, error);
          if (config.onError) {
            try {
              config.onError(error);
            } catch (_) {
            }
          }
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
        let nextDelay = config.retryBackoff ? config.retryDelay * Math.pow(config.retryBackoff, attempt - 1) : config.retryDelay * attempt;
        const retryAfter = ((_e = (_d = error.response) == null ? void 0 : _d.headers) == null ? void 0 : _e["retry-after"]) ?? ((_h = (_g = (_f = error.context) == null ? void 0 : _f.response) == null ? void 0 : _g.headers) == null ? void 0 : _h["retry-after"]);
        if (retryAfter) {
          const secs = parseInt(retryAfter, 10);
          if (!isNaN(secs)) {
            nextDelay = Math.min(secs * 1e3, config.maxRetryAfter ?? Infinity);
          }
        }
        if (config.retryJitter) {
          const jitterMax = config.retryJitter === true ? nextDelay : config.retryJitter;
          nextDelay += Math.random() * jitterMax;
        }
        if (config.onRetry) {
          try {
            config.onRetry(attempt, error, nextDelay);
          } catch (_) {
          }
        }
        this.events.emit(events.RETRY_ATTEMPT, {
          attempt,
          error: error.message,
          nextRetryDelay: nextDelay
        });
        if (attempt === config.retries) {
          this.events.emit(events.REQUEST_ERROR, error);
          if (config.onError) {
            try {
              config.onError(error);
            } catch (_) {
            }
          }
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
      session = http22.connect(urlObj.href, {
        rejectUnauthorized: options.rejectUnauthorized
      });
      this.http2Sessions.set(authority, session);
      session.on("error", () => {
        this.http2Sessions.delete(authority);
      });
      session.on("goaway", () => {
        this.http2Sessions.delete(authority);
      });
    }
    return new Promise((resolve, reject) => {
      var _a;
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
      const signal = (_a = options.config) == null ? void 0 : _a.signal;
      if (signal) {
        if (signal.aborted) {
          req.destroy(new AbortError());
        } else {
          const onAbort = () => req.destroy(new AbortError());
          signal.addEventListener("abort", onAbort, { once: true });
          req.once("close", () => signal.removeEventListener("abort", onAbort));
        }
      }
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
          const total = parseInt(responseHeaders["content-length"], 10) || 0;
          if (total && this.events.hasListeners(events.PROGRESS)) {
            this.events.emit(events.PROGRESS, {
              loaded: totalBytes,
              total,
              percent: totalBytes / total * 100
            });
          }
        }
      });
      req.on("end", () => {
        let body = Buffer.concat(chunks);
        const encoding = responseHeaders && responseHeaders["content-encoding"];
        const contentLength = parseInt(responseHeaders && responseHeaders["content-length"], 10) || 0;
        const cfg = options.config || this.config;
        if (cfg.compression.response && cfg.decompress !== false && contentLength >= cfg.compression.responseMinSize && encoding) {
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
          status: responseStatus,
          config: options
        });
      });
      req.on("error", reject);
      if (data) {
        if (data instanceof Readable) {
          data.pipe(req);
        } else {
          const payload = Buffer.isBuffer(data) ? data : typeof data === "string" ? data : JSON.stringify(data);
          req.write(payload);
        }
      }
      req.end();
    });
  }
  _setupTimeouts(req, options) {
    const configured = options.config && options.config.timeouts;
    if (!configured) return;
    const timeouts = {
      connect: configured.connect || 5e3,
      response: configured.response || 3e4,
      idle: configured.idle || 6e4
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
      const isStreaming = !!(options.config && options.config.stream);
      if (isStreaming) return;
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
  _prepareHostname(options) {
    if (!options.hostname || !options.hostname.includes(":")) return;
    options.hostname = options.hostname.replace(/^\[|\]$/g, "");
    const ipv6Pattern = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|::)$/;
    if (!ipv6Pattern.test(options.hostname)) {
      throw new ValidationError("Invalid IPv6 address format", { hostname: options.hostname });
    }
    options.hostname = `[${options.hostname}]`;
  }
  _attachSignal(req, options) {
    var _a;
    const signal = (_a = options.config) == null ? void 0 : _a.signal;
    if (!signal) return;
    if (signal.aborted) {
      req.destroy(new AbortError());
      return;
    }
    const onAbort = () => {
      this.events.emit(events.ABORT, { url: options.path });
      req.destroy(new AbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    req.once("close", () => signal.removeEventListener("abort", onAbort));
  }
  _enhanceError(error, options, protocol) {
    if (error instanceof SwiftlyError) return error;
    switch (error.code) {
      case "ECONNREFUSED":
        return new RequestError("Connection refused", { original: error, options, protocol });
      case "ENOTFOUND":
        return new RequestError("Host not found", { original: error, options, protocol });
      case "ECONNRESET":
        return new RequestError("Connection reset", { original: error, options, protocol });
      case "ETIMEDOUT":
        return new TimeoutError("Connection timed out", "connect", { original: error, options, protocol });
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
      data.on("data", (chunk) => {
        loaded += chunk.length;
        const progress = { loaded, total: 0, percent: 0 };
        if (config.onUploadProgress) config.onUploadProgress(progress);
        this._emit(events.UPLOAD_PROGRESS, () => progress);
      });
      data.on("error", (err) => req.destroy(err));
      data.pipe(req);
      return;
    }
    const payload = Buffer.isBuffer(data) ? data : typeof data === "string" ? data : JSON.stringify(data);
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
    const isHead = options.method === "HEAD" || options.method === "OPTIONS";
    if (isHead) {
      resolve({
        data: Buffer.alloc(0),
        headers: res.headers,
        status: res.statusCode,
        config: options
      });
      return;
    }
    if (requestCfg.stream) {
      const encoding2 = res.headers["content-encoding"];
      let stream2 = res;
      if (requestCfg.compression.response && encoding2 && requestCfg.decompress !== false) {
        if (encoding2 === "gzip") {
          stream2 = res.pipe(zlib.createGunzip());
        } else if (encoding2 === "deflate") {
          stream2 = res.pipe(zlib.createInflate());
        } else if (encoding2 === "br") {
          stream2 = res.pipe(zlib.createBrotliDecompress());
        }
      }
      stream2.headers = res.headers;
      stream2.status = res.statusCode;
      stream2.total = parseInt(res.headers["content-length"], 10) || 0;
      stream2.on("error", (error) => {
        reject(new RequestError("Stream error", { original: error, options }));
      });
      resolve({
        data: stream2,
        headers: res.headers,
        status: res.statusCode,
        config: options
      });
      return;
    }
    const chunks = [];
    let stream = res;
    const contentLength = parseInt(res.headers["content-length"], 10) || 0;
    const encoding = res.headers["content-encoding"];
    const isDecompressing = requestCfg.compression.response && requestCfg.decompress !== false && encoding && contentLength >= requestCfg.compression.responseMinSize;
    if (isDecompressing) {
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
    const canPrealloc = !isDecompressing && contentLength > 0;
    let prealloc = canPrealloc ? Buffer.allocUnsafe(contentLength) : null;
    let writeOffset = 0;
    const hasProgress = totalBytes > 0 && (requestCfg.onDownloadProgress || this.events.hasListeners(events.PROGRESS) || this.events.hasListeners(events.DOWNLOAD_PROGRESS));
    stream.on("data", (chunk) => {
      receivedBytes += chunk.length;
      if (prealloc) {
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
          percent: receivedBytes / totalBytes * 100
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
    stream.on("end", () => {
      const data = prealloc ? writeOffset === contentLength ? prealloc : prealloc.subarray(0, writeOffset) : Buffer.concat(chunks);
      resolve({
        data,
        headers: res.headers,
        status: res.statusCode,
        config: options
        // Include original config for error handling
      });
    });
    stream.on("error", (error) => {
      reject(new RequestError("Stream error", {
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
        return reject(new RequestError("Invalid IPv6 address", {
          original: error,
          options,
          protocol
        }));
      }
      const client = protocol === "https:" ? https2 : http2;
      const req = client.request(options, (res) => {
        this._handleResponseStream(res, options, resolve, reject);
      });
      this._attachSignal(req, options);
      this._setupTimeouts(req, options);
      req.on("error", (error) => {
        reject(this._enhanceError(error, options, protocol));
      });
      this._sendPayload(req, data, options.config || {});
    });
  }
  _makeProxiedRequest(protocol, options, data) {
    return new Promise((resolve, reject) => {
      const proxy = options.config.proxy;
      const proxyHost = proxy.host;
      const proxyPort = proxy.port || (protocol === "https:" ? 443 : 80);
      let proxyAuth = null;
      if (proxy.auth) {
        const creds = typeof proxy.auth === "string" ? proxy.auth : `${proxy.auth.username}:${proxy.auth.password || ""}`;
        proxyAuth = "Basic " + Buffer.from(creds).toString("base64");
      }
      const handler = (res) => this._handleResponseStream(res, options, resolve, reject);
      if (protocol === "https:") {
        const connectReq = http2.request({
          host: proxyHost,
          port: proxyPort,
          method: "CONNECT",
          path: `${options.hostname}:${options.port || 443}`,
          headers: proxyAuth ? { "Proxy-Authorization": proxyAuth } : {}
        });
        connectReq.on("connect", (res, socket) => {
          if (res.statusCode !== 200) {
            socket.destroy();
            reject(new RequestError(`Proxy CONNECT failed: HTTP ${res.statusCode}`, { options, protocol }));
            return;
          }
          this.events.emit(events.PROXY_CONNECT, { host: options.hostname, proxyHost });
          const servername = String(options.hostname).replace(/^\[|\]$/g, "");
          const tlsSocket = tls.connect({
            socket,
            servername,
            rejectUnauthorized: options.rejectUnauthorized
          });
          const req = https2.request({
            ...options,
            createConnection: () => tlsSocket,
            agent: false
          }, handler);
          this._attachSignal(req, options);
          this._setupTimeouts(req, options);
          req.on("error", (error) => reject(this._enhanceError(error, options, protocol)));
          this._sendPayload(req, data, options.config || {});
        });
        connectReq.on("error", (error) => {
          reject(new RequestError("Proxy connection failed", { original: error, options, protocol }));
        });
        connectReq.end();
      } else {
        const target = `http://${options.hostname}:${options.port || 80}${options.path}`;
        const headers = { ...options.headers, Host: `${options.hostname}:${options.port || 80}` };
        if (proxyAuth) headers["Proxy-Authorization"] = proxyAuth;
        const req = http2.request({
          host: proxyHost,
          port: proxyPort,
          method: options.method,
          path: target,
          headers,
          agent: false
        }, handler);
        this._attachSignal(req, options);
        this._setupTimeouts(req, options);
        req.on("error", (error) => reject(this._enhanceError(error, options, protocol)));
        this._sendPayload(req, data, options.config || {});
      }
    });
  }
  _processResponse(response, responseType) {
    if (response.status >= 400) {
      throw new ResponseError(`HTTP Error ${response.status}`, response);
    }
    const contentType = response.headers["content-type"] || "";
    const type = responseType && responseType !== "raw" ? responseType : detectResponseType(contentType);
    const validTypes = ["json", "text", "html", "buffer", "raw"];
    if (responseType && !validTypes.includes(responseType)) {
      this._log("error", `Invalid responseType: ${responseType}, falling back to buffer`);
    }
    const transformer = this.responseTransformers.get(type) || this.responseTransformers.get("buffer");
    if (!transformer) {
      this._log("error", `No transformer found for type: ${type}, using buffer`);
      return response.data;
    }
    const finish = (data) => {
      if (responseType === "raw") {
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
      if (result && typeof result.then === "function") {
        return result.then(
          finish,
          (error) => {
            error.response = response;
            error.type = type;
            throw error;
          }
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
      const client = urlObj.protocol === "https:" ? https2 : http2;
      const reqOptions = { ...options };
      if (typeof reqOptions.timeout !== "number") delete reqOptions.timeout;
      const req = client.request(urlObj, reqOptions, (res) => {
        if (res.statusCode !== 200) {
          const err = new Error(`SSE connection failed: ${res.statusCode}`);
          if (onError) onError(err);
          reject(err);
          return;
        }
        res.setEncoding("utf8");
        let buffer = "";
        if (onOpen) onOpen();
        resolve(() => req.destroy());
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
      averageResponseTime: this.metrics.requestCount ? this.metrics.totalTime / this.metrics.requestCount : 0,
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
  // Stream a download directly to disk with progress reporting.
  async downloadTo(url, filePath, config = {}) {
    const stream = await this.get(url, { ...config, stream: true });
    const { onProgress } = config;
    const total = stream.total || 0;
    let loaded = 0;
    if (typeof stream.status === "number" && stream.status >= 400) {
      try {
        stream.destroy();
      } catch {
      }
      throw new ResponseError(`HTTP Error ${stream.status}`, {
        status: stream.status,
        headers: stream.headers || {}
      });
    }
    return new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(filePath);
      stream.on("data", (chunk) => {
        loaded += chunk.length;
        if (onProgress) {
          onProgress({ loaded, total, percent: total ? loaded / total * 100 : 0 });
        }
      });
      stream.on("error", (err) => {
        ws.destroy();
        reject(err);
      });
      ws.on("error", reject);
      ws.on("finish", () => resolve({ path: filePath, bytes: loaded }));
      stream.pipe(ws);
    });
  }
  // Optional undici transport (lazy-loaded, keeps the default path zero-dep)
  async _undiciRequest(urlObj, options, data) {
    var _a, _b, _c, _d;
    let request;
    try {
      request = await loadUndici();
    } catch (e) {
      throw new ValidationError(
        "transport: 'undici' requires the optional dependency 'undici' to be installed",
        { transport: "undici" }
      );
    }
    const body = data ? Buffer.isBuffer(data) ? data : typeof data === "string" ? data : JSON.stringify(data) : void 0;
    let result;
    try {
      result = await request(urlObj.href, {
        method: options.method,
        headers: options.headers,
        body,
        signal: (_a = options.config) == null ? void 0 : _a.signal,
        headersTimeout: (_c = (_b = options.config) == null ? void 0 : _b.timeouts) == null ? void 0 : _c.response,
        bodyTimeout: typeof ((_d = options.config) == null ? void 0 : _d.timeout) === "number" ? options.config.timeout : void 0,
        maxRedirections: 0
        // redirects are handled by swiftly
      });
    } catch (e) {
      if (e && (e.name === "AbortError" || e.code === "UND_ERR_ABORTED" || e.code === "ABORT_ERR")) {
        throw new AbortError();
      }
      throw e;
    }
    const { statusCode, headers: resHeaders, body: resBody } = result;
    let buf = Buffer.from(await resBody.arrayBuffer());
    const cfg = options.config || this.config;
    const encoding = resHeaders["content-encoding"];
    if (cfg.compression.response && cfg.decompress !== false && encoding) {
      try {
        if (encoding === "gzip") {
          buf = zlib.gunzipSync(buf);
        } else if (encoding === "deflate") {
          buf = zlib.inflateSync(buf);
        } else if (encoding === "br") {
          buf = zlib.brotliDecompressSync(buf);
        }
      } catch (e) {
        throw new RequestError("Decompression failed", { original: e, options });
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
    this._mergeCache = /* @__PURE__ */ new WeakMap();
    return this;
  }
  // Create a new client sharing this client's config (fresh pools/cookies).
  clone(overrides = {}) {
    return new _HTTPClient(this._mergeConfig(overrides));
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
    destroyAgents(this.connectionPool);
    this.cache.clear();
    this._log("info", "All connections closed");
  }
};
var createClient = (config) => new HTTPClient(config);

// lib/scraper.js
var VOID_TAGS = /* @__PURE__ */ new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
var NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\xA0",
  copy: "\xA9",
  reg: "\xAE",
  trade: "\u2122",
  hellip: "\u2026",
  mdash: "\u2014",
  ndash: "\u2013",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201C",
  rdquo: "\u201D",
  bull: "\u2022",
  middot: "\xB7",
  euro: "\u20AC",
  pound: "\xA3",
  yen: "\xA5",
  cents: "\xA2",
  sect: "\xA7",
  para: "\xB6",
  deg: "\xB0",
  plusmn: "\xB1",
  frac12: "\xBD",
  frac14: "\xBC",
  frac34: "\xBE",
  oacute: "\xF3",
  agrave: "\xE0",
  eacute: "\xE9",
  iacute: "\xED"
};
var ENTITY_RE = /&(#x?[0-9a-fA-F]+|[a-zA-Z0-9]+);/g;
function decodeEntities(text) {
  if (!text || !text.includes("&")) return text;
  return text.replace(ENTITY_RE, (match, entity) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return isNaN(code) ? match : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[entity.toLowerCase()] || match;
  });
}
function findTagEnd(html, start) {
  let quote = null;
  for (let j = start + 1; j < html.length; j++) {
    const ch = html[j];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return j;
    }
  }
  return -1;
}
function parseTag(raw) {
  const body = raw.slice(1, -1).trim();
  const nameMatch = body.match(/^([^\s/]+)/);
  const name = nameMatch ? nameMatch[1].toLowerCase() : "";
  const rest = body.slice(nameMatch ? nameMatch[0].length : 0);
  const selfClosing = /\/\s*$/.test(rest);
  const attrs = {};
  const attrRe = /([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/g;
  let m;
  while ((m = attrRe.exec(rest)) !== null) {
    let val = m[2];
    if (val === void 0) {
      val = "";
    } else if (val[0] === '"' || val[0] === "'") {
      val = val.slice(1, -1);
    }
    attrs[m[1].toLowerCase()] = decodeEntities(val);
  }
  return { name, attrs, selfClosing };
}
function tokenize(html) {
  const tokens = [];
  let i = 0;
  const len = html.length;
  while (i < len) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      if (i < len) tokens.push({ type: "text", text: html.slice(i) });
      break;
    }
    if (lt > i) tokens.push({ type: "text", text: html.slice(i, lt) });
    const after = html[lt + 1];
    if (after === "!") {
      const end = html.indexOf(">", lt);
      if (end === -1) break;
      const inner = html.slice(lt + 2, end).trim().toLowerCase();
      tokens.push({ type: inner.startsWith("--") ? "comment" : "doctype", raw: html.slice(lt, end + 1) });
      i = end + 1;
    } else if (after === "/") {
      const end = html.indexOf(">", lt);
      if (end === -1) break;
      const name = html.slice(lt + 2, end).trim().split(/\s+/)[0].toLowerCase();
      tokens.push({ type: "close", name, raw: html.slice(lt, end + 1) });
      i = end + 1;
    } else if (after !== void 0) {
      const end = findTagEnd(html, lt);
      if (end === -1) break;
      const raw = html.slice(lt, end + 1);
      const parsed = parseTag(raw);
      tokens.push({
        type: parsed.selfClosing || VOID_TAGS.has(parsed.name) ? "selfclose" : "open",
        name: parsed.name,
        attrs: parsed.attrs,
        selfClosing: parsed.selfClosing || VOID_TAGS.has(parsed.name),
        raw
      });
      i = end + 1;
      if (!parsed.selfClosing && (parsed.name === "script" || parsed.name === "style" || parsed.name === "textarea")) {
        const closer = html.toLowerCase().indexOf(`</${parsed.name}`, i);
        if (closer === -1) break;
        if (closer > i) {
          tokens.push({ type: "text", text: html.slice(i, closer) });
        }
        tokens.push({ type: "close", name: parsed.name, raw: `</${parsed.name}>` });
        i = closer + parsed.name.length + 3;
        continue;
      }
    } else {
      break;
    }
  }
  return tokens;
}
var AUTO_CLOSE = {
  li: ["li"],
  dt: ["dt", "dd"],
  dd: ["dt", "dd"],
  p: ["p"],
  rt: ["rt", "rp"],
  rp: ["rt", "rp"],
  optgroup: ["optgroup"],
  option: ["option", "optgroup"],
  caption: ["caption"],
  colgroup: ["colgroup"],
  thead: ["thead", "tbody", "tfoot"],
  tbody: ["thead", "tbody", "tfoot"],
  tfoot: ["thead", "tbody", "tfoot"],
  tr: ["tr", "tbody", "thead", "tfoot"],
  td: ["td", "th"],
  th: ["td", "th"]
};
var CLOSES_P = /* @__PURE__ */ new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "center",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "ul"
]);
function applyImpliedCloses(stack, tag) {
  const closers = AUTO_CLOSE[tag];
  if (closers) {
    for (let k = stack.length - 1; k >= 1; k--) {
      if (closers.includes(stack[k].tag)) {
        stack.length = k;
        return;
      }
    }
  }
  if (CLOSES_P.has(tag)) {
    for (let k = stack.length - 1; k >= 1; k--) {
      if (stack[k].tag === "p") {
        stack.length = k;
        return;
      }
    }
  }
}
function buildTree(tokens) {
  const root = { tag: "#root", attrs: {}, children: [], parent: null, text: "", index: 0, typeIndex: 0, selfClosing: false, raw: "" };
  const stack = [root];
  for (const tok of tokens) {
    if (tok.type === "text") {
      stack[stack.length - 1].text += tok.text;
      continue;
    }
    if (tok.type === "comment" || tok.type === "doctype") continue;
    if (tok.type === "close") {
      for (let k = stack.length - 1; k >= 1; k--) {
        if (stack[k].tag === tok.name) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    applyImpliedCloses(stack, tok.name);
    const parent = stack[stack.length - 1];
    const node = {
      tag: tok.name,
      attrs: tok.attrs,
      children: [],
      parent,
      text: "",
      index: 0,
      typeIndex: 0,
      selfClosing: tok.selfClosing,
      raw: tok.raw
    };
    parent.children.push(node);
    if (!tok.selfClosing) stack.push(node);
  }
  assignIndices(root);
  return root;
}
function assignIndices(node) {
  const siblings = node.children;
  const typeCounters = /* @__PURE__ */ new Map();
  for (let i = 0; i < siblings.length; i++) {
    const child = siblings[i];
    child.index = i + 1;
    const t = child.tag;
    const c = (typeCounters.get(t) || 0) + 1;
    typeCounters.set(t, c);
    child.typeIndex = c;
    assignIndices(child);
  }
}
function elementText(node) {
  let out = node.text;
  for (const c of node.children) {
    if (c.tag === "script" || c.tag === "style" || c.tag === "noscript") continue;
    out += elementText(c);
  }
  return out;
}
function outerHTML(node) {
  if (node.selfClosing) return node.raw;
  let out = node.raw + node.text;
  for (const c of node.children) out += outerHTML(c);
  out += `</${node.tag}>`;
  return out;
}
function previousSiblingElement(node) {
  const sib = node.parent ? node.parent.children : [];
  return sib[node.index - 2] || null;
}
function nextSiblingElement(node) {
  const sib = node.parent ? node.parent.children : [];
  return sib[node.index] || null;
}
function findMatching(sel, start, open, close) {
  let depth = 0;
  let quote = null;
  for (let j = start; j < sel.length; j++) {
    const c = sel[j];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === open) {
      depth++;
    } else if (c === close) {
      depth--;
      if (depth === 0) return j;
    }
  }
  return sel.length - 1;
}
function findPseudoEnd(sel, start) {
  let depth = 0;
  let quote = null;
  for (let j = start + 1; j < sel.length; j++) {
    const c = sel[j];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "(") {
      depth++;
    } else if (c === ")") {
      if (depth === 0) return j;
      depth--;
    } else if (depth === 0 && (c === ":" || c === " " || c === ">" || c === "+" || c === "~" || c === "," || c === "#" || c === "." || c === "[" || c === "*")) {
      return j - 1;
    }
  }
  return sel.length - 1;
}
function parseAttr(raw) {
  const m = raw.match(/^\s*([^\s=^$*~|]+)\s*(?:(\^=|\$=|\*=|\|=|~=|=)\s*(?:"([^"]*)"|'([^']*)'|([^\s]*))?)?/);
  if (!m) return { name: "", operator: void 0, value: "" };
  return {
    name: m[1].toLowerCase(),
    operator: m[2],
    value: m[3] !== void 0 ? m[3] : m[4] !== void 0 ? m[4] : m[5] !== void 0 ? m[5] : ""
  };
}
function parsePseudo(raw) {
  const paren = raw.indexOf("(");
  if (paren === -1) return { name: raw.trim().toLowerCase(), arg: null, groups: null };
  const name = raw.slice(0, paren).trim().toLowerCase();
  const arg = raw.slice(paren + 1, -1).trim();
  if (name === "not" || name === "has") {
    return { name, arg, groups: compileSelector(arg) };
  }
  if (name === "nth-child" || name === "nth-of-type") {
    return { name, arg: parseNth(arg), groups: null };
  }
  if (name === "eq" || name === "contains") {
    const inner = arg.match(/^['"]?(.*?)['"]?$/);
    return { name, arg: inner ? inner[1] : arg, groups: null };
  }
  return { name, arg, groups: null };
}
function parseNth(expr) {
  const e = String(expr).trim().toLowerCase();
  if (e === "odd") return { a: 2, b: 1 };
  if (e === "even") return { a: 2, b: 0 };
  const m = e.match(/^([+-]?\d*)n\s*([+-]\s*\d+)?$/);
  if (m) {
    let a = 0;
    if (m[1] === "" || m[1] === "+") a = 1;
    else if (m[1] === "-") a = -1;
    else a = parseInt(m[1], 10);
    let b = 0;
    if (m[2]) b = parseInt(m[2].replace(/\s/g, ""), 10);
    return { a, b };
  }
  const n = parseInt(e, 10);
  return isNaN(n) ? null : { a: 0, b: n };
}
function nthMatches(index, { a, b }) {
  if (!a && !b) return false;
  if (a === 0) return index === b;
  const x = index - b;
  return x % a === 0 && x / a >= 0;
}
function tokenizeSelector(sel) {
  const tokens = [];
  let i = 0;
  const n = sel.length;
  let needDescendant = false;
  const isSimpleStart = (c) => c === "#" || c === "." || c === "[" || c === ":" || c === "*" || /[a-zA-Z0-9]/.test(c);
  while (i < n) {
    const ch = sel[i];
    if (ch === " " || ch === "	" || ch === "\n") {
      needDescendant = true;
      i++;
      continue;
    }
    if (ch === ">") {
      tokens.push({ type: "combinator", value: ">" });
      needDescendant = false;
      i++;
      continue;
    }
    if (ch === "+") {
      tokens.push({ type: "combinator", value: "+" });
      needDescendant = false;
      i++;
      continue;
    }
    if (ch === "~") {
      tokens.push({ type: "combinator", value: "~" });
      needDescendant = false;
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma" });
      needDescendant = false;
      i++;
      continue;
    }
    if (needDescendant && isSimpleStart(ch) && tokens.length && tokens[tokens.length - 1].type !== "combinator" && tokens[tokens.length - 1].type !== "comma") {
      tokens.push({ type: "combinator", value: " " });
    }
    needDescendant = false;
    if (ch === "*") {
      tokens.push({ type: "universal" });
      i++;
      continue;
    }
    if (ch === "#") {
      let j2 = i + 1;
      while (j2 < n && !/[\s>+~,#.*\[\]:]/.test(sel[j2])) j2++;
      tokens.push({ type: "id", value: sel.slice(i + 1, j2) });
      i = j2;
      continue;
    }
    if (ch === ".") {
      let j2 = i + 1;
      while (j2 < n && !/[\s>+~,#.*\[\]:]/.test(sel[j2])) j2++;
      tokens.push({ type: "class", value: sel.slice(i + 1, j2) });
      i = j2;
      continue;
    }
    if (ch === "[") {
      const end = findMatching(sel, i, "[", "]");
      tokens.push({ type: "attr", raw: sel.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (ch === ":") {
      const end = findPseudoEnd(sel, i);
      tokens.push({ type: "pseudo", raw: sel.slice(i + 1, end + 1) });
      i = end + 1;
      continue;
    }
    let j = i;
    while (j < n && !/[\s>+~,#.*\[\]:]/.test(sel[j])) j++;
    tokens.push({ type: "tag", value: sel.slice(i, j).toLowerCase() });
    i = j;
  }
  return tokens;
}
function compileSelector(selector) {
  const tokens = tokenizeSelector(String(selector).trim());
  const groups = [];
  let current = [];
  let step2 = { combinator: null, simple: [] };
  for (const tok of tokens) {
    if (tok.type === "comma") {
      if (step2.simple.length) current.push(step2);
      if (current.length) groups.push(current);
      current = [];
      step2 = { combinator: null, simple: [] };
      continue;
    }
    if (tok.type === "combinator") {
      if (step2.simple.length) current.push(step2);
      step2 = { combinator: tok.value, simple: [] };
      continue;
    }
    if (tok.type === "pseudo") {
      step2.simple.push({ type: "pseudo", ...parsePseudo(tok.raw) });
    } else {
      step2.simple.push(tok);
    }
  }
  if (step2.simple.length) current.push(step2);
  if (current.length) groups.push(current);
  return groups;
}
function hasClass(node, cls) {
  const c = node.attrs["class"];
  if (!c) return false;
  return String(c).split(/\s+/).includes(cls);
}
function applyAttrOp(op, value, expected) {
  switch (op) {
    case "=":
      return value === expected;
    case "^=":
      return value.startsWith(expected);
    case "$=":
      return value.endsWith(expected);
    case "*=":
      return value.includes(expected);
    case "~=":
      return String(value).split(/\s+/).includes(expected);
    case "|=":
      return value === expected || value.startsWith(expected + "-");
    default:
      return false;
  }
}
function matchesCompound(node, simple) {
  for (const tok of simple) {
    switch (tok.type) {
      case "tag":
        if (node.tag !== tok.value) return false;
        break;
      case "universal":
        break;
      case "id":
        if (node.attrs["id"] !== tok.value) return false;
        break;
      case "class":
        if (!hasClass(node, tok.value)) return false;
        break;
      case "attr": {
        const spec = parseAttr(tok.raw);
        const v = node.attrs[spec.name];
        if (spec.operator === void 0) {
          if (v === void 0) return false;
        } else if (v === void 0 || !applyAttrOp(spec.operator, v, spec.value)) {
          return false;
        }
        break;
      }
      case "pseudo":
        if (!matchesPseudo(node, tok)) return false;
        break;
    }
  }
  return true;
}
function matchesPseudo(node, pseudo) {
  switch (pseudo.name) {
    case "first-child":
    case "first":
      return node.index === 1;
    case "last-child":
    case "last":
      return node.parent ? node.index === node.parent.children.length : false;
    case "nth-child":
      return !!pseudo.arg && nthMatches(node.index, pseudo.arg);
    case "nth-of-type":
      return !!pseudo.arg && nthMatches(node.typeIndex, pseudo.arg);
    case "eq":
      return node.index === (Number(pseudo.arg) || 0) + 1;
    case "contains":
      return elementText(node).includes(pseudo.arg || "");
    case "empty":
      return node.children.length === 0 && !node.text.trim();
    case "not":
      return !matchesAnyGroup(node, pseudo.groups);
    case "has":
      return hasMatchingDescendant(node, pseudo.groups);
    default:
      return false;
  }
}
function matchesAnyGroup(node, groups) {
  if (!groups) return false;
  for (const steps of groups) {
    if (steps.length === 0) continue;
    const last = steps[steps.length - 1].simple;
    if (matchesCompound(node, last) && matchLeft(node, steps, steps.length - 2)) return true;
  }
  return false;
}
function hasMatchingDescendant(node, groups) {
  if (!groups) return false;
  const stack = [...node.children];
  while (stack.length) {
    const n = stack.pop();
    if (matchesAnyGroup(n, groups)) return true;
    for (const c of n.children) stack.push(c);
  }
  return false;
}
function matchLeft(node, steps, idx) {
  if (idx < 0) return true;
  const combinator = steps[idx + 1].combinator;
  const compound = steps[idx].simple;
  if (combinator === ">") {
    const parent = node.parent;
    if (!parent || parent.tag === "#root") return false;
    return matchesCompound(parent, compound) && matchLeft(parent, steps, idx - 1);
  }
  if (combinator === " ") {
    let anc = node.parent;
    while (anc && anc.tag !== "#root") {
      if (matchesCompound(anc, compound) && matchLeft(anc, steps, idx - 1)) return true;
      anc = anc.parent;
    }
    return false;
  }
  if (combinator === "+") {
    const prev = previousSiblingElement(node);
    if (!prev) return false;
    return matchesCompound(prev, compound) && matchLeft(prev, steps, idx - 1);
  }
  if (combinator === "~") {
    let prev = previousSiblingElement(node);
    while (prev) {
      if (matchesCompound(prev, compound) && matchLeft(prev, steps, idx - 1)) return true;
      prev = previousSiblingElement(prev);
    }
    return false;
  }
  return false;
}
function collectAll(root) {
  const out = [];
  (function walk(n) {
    for (const c of n.children) {
      out.push(c);
      walk(c);
    }
  })(root);
  return out;
}
function queryAllSteps(doc, steps) {
  const lastCompound = steps[steps.length - 1].simple;
  const out = [];
  const all = collectAll(doc);
  for (const n of all) {
    if (matchesCompound(n, lastCompound) && matchLeft(n, steps, steps.length - 2)) {
      out.push(n);
    }
  }
  return out;
}
function toElement(node) {
  if (node._el) return node._el;
  const el = {
    html: outerHTML(node),
    content: elementText(node).trim(),
    attributes: { ...node.attrs },
    children: node.children.map(toElement),
    tag: node.tag,
    index: node.index,
    text: () => elementText(node).trim(),
    attr: (name) => name in node.attrs ? node.attrs[name] : null,
    find: (sel) => findWithin(node, sel),
    parent: () => node.parent && node.parent.tag !== "#root" ? toElement(node.parent) : null,
    closest: (sel) => closestWithin(node, sel),
    next: () => {
      const s = nextSiblingElement(node);
      return s ? toElement(s) : null;
    },
    prev: () => {
      const s = previousSiblingElement(node);
      return s ? toElement(s) : null;
    },
    data: () => {
      const out = {};
      for (const [k, v] of Object.entries(node.attrs)) {
        if (k.startsWith("data-")) out[k.slice(5)] = v;
      }
      return out;
    }
  };
  Object.defineProperty(el, "_node", { value: node, enumerable: false });
  node._el = el;
  return el;
}
function findWithin(node, sel) {
  const groups = compileSelector(sel);
  const out = [];
  const stack = [...node.children];
  while (stack.length) {
    const n = stack.pop();
    if (matchesAnyGroup(n, groups)) out.push(n);
    for (const c of n.children) stack.push(c);
  }
  return out.reverse().map(toElement);
}
function closestWithin(node, sel) {
  const groups = compileSelector(sel);
  let n = node;
  while (n && n.tag !== "#root") {
    if (matchesAnyGroup(n, groups)) return toElement(n);
    n = n.parent;
  }
  return null;
}
function createParser(doc) {
  const cache = /* @__PURE__ */ new Map();
  function queryAll(selector) {
    if (typeof selector !== "string") return [];
    if (cache.has(selector)) return cache.get(selector);
    const groups = compileSelector(selector);
    const seen = /* @__PURE__ */ new Set();
    const nodes = [];
    for (const steps of groups) {
      for (const n of queryAllSteps(doc, steps)) {
        if (!seen.has(n)) {
          seen.add(n);
          nodes.push(n);
        }
      }
    }
    const els = nodes.map(toElement);
    cache.set(selector, els);
    return els;
  }
  return {
    querySelectorAll: queryAll,
    querySelector: (sel) => queryAll(sel)[0] || null,
    document: doc
  };
}
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
  const parser = createParser(buildTree(tokenize(html)));
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
          results[key] = parser.querySelectorAll(sel).map((el) => el.attr(attr));
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
            extractedData = elements.map((el) => el.content);
            break;
          case "html":
            extractedData = elements.map((el) => el.html);
            break;
          case "attr":
            extractedData = elements.map((el) => attr ? el.attr(attr) : null);
            break;
          default:
            extractedData = elements.map((el) => el.content);
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

// lib/extract.js
function resolveUrl(href, baseUrl) {
  try {
    if (/^(?:[a-z]+:)?\/\//i.test(href) || /^(?:mailto|tel|javascript|data|sms|callto|#):/i.test(href)) {
      return href;
    }
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}
function extractLinks(html, baseUrl = null) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const el of parseHTML(html, "a[href]")) {
    const href = el.attr("href");
    if (!href || seen.has(href)) continue;
    seen.add(href);
    out.push({
      text: el.content,
      href,
      url: baseUrl ? resolveUrl(href, baseUrl) : href
    });
  }
  return out;
}
function extractImages(html, baseUrl = null) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const el of parseHTML(html, "img[src]")) {
    const src = el.attr("src");
    if (!src || seen.has(src)) continue;
    seen.add(src);
    out.push({
      src,
      url: baseUrl ? resolveUrl(src, baseUrl) : src,
      alt: el.attr("alt"),
      title: el.attr("title")
    });
  }
  return out;
}
function extractText(html) {
  const source = Buffer.isBuffer(html) ? html.toString("utf-8") : String(html);
  return decodeEntities(
    source.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  );
}
function extractMeta(html) {
  const meta = {};
  for (const el of parseHTML(html, "meta")) {
    const name = el.attr("name") || el.attr("property") || el.attr("http-equiv");
    const content = el.attr("content");
    if (name && content !== null && !(name in meta)) {
      meta[name] = content;
    }
  }
  const titleEl = parseHTML(html, "title")[0];
  if (titleEl && !meta.title) meta.title = titleEl.content;
  return meta;
}
function extractTables(html, selector = "table") {
  return parseHTML(html, selector).map((tbl) => {
    const rows = tbl.find("tr").map(
      (tr) => tr.find("th, td").map((c) => c.content)
    );
    const headers = rows.length ? rows[0].map((h) => h.trim()) : [];
    const body = rows.slice(1).map((row) => {
      const obj = {};
      headers.forEach((h, i) => {
        if (h) obj[h] = row[i] ?? null;
      });
      return obj;
    });
    return { headers, rows: body };
  });
}
function extractForms(html) {
  return parseHTML(html, "form").map((f) => ({
    action: f.attr("action"),
    method: (f.attr("method") || "get").toLowerCase(),
    fields: f.find("input, select, textarea, button").map((el) => ({
      name: el.attr("name"),
      type: el.tag === "input" ? el.attr("type") || "text" : el.tag,
      value: el.tag === "textarea" ? el.content : el.attr("value")
    })).filter((x) => x.name)
  }));
}
function extractJsonLd(html) {
  const out = [];
  for (const el of parseHTML(html, 'script[type="application/ld+json"]')) {
    try {
      out.push(JSON.parse(el.content));
    } catch (_) {
    }
  }
  return out;
}
function extractJSON(html) {
  const candidates = [];
  for (const el of parseHTML(html, 'script[type="application/json"]')) {
    const t = el.content.trim();
    if (t) candidates.push(t);
  }
  if (candidates.length === 0) {
    for (const el of parseHTML(html, "script")) {
      const t = el.content.trim();
      if (t && (t[0] === "{" || t[0] === "[")) candidates.push(t);
    }
  }
  const out = [];
  for (const text of candidates) {
    try {
      out.push(JSON.parse(text));
    } catch (_) {
    }
  }
  return out;
}
function sanitizeHtml(html, options = {}) {
  const {
    stripTags = ["script", "style", "iframe", "object", "embed", "form", "noscript", "link", "meta"],
    allowEventHandlers = false
  } = options;
  let out = Buffer.isBuffer(html) ? html.toString("utf-8") : String(html);
  for (const tag of stripTags) {
    out = out.replace(new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, "gi"), "");
  }
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  if (!allowEventHandlers) {
    out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, "");
  }
  out = out.replace(/(href|src|action)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, "$1=$2");
  return out;
}
function htmlToMarkdown(html) {
  let md = sanitizeHtml(html);
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `
# ${t.trim()}

`);
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `
## ${t.trim()}

`);
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `
### ${t.trim()}

`);
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, t) => `
#### ${t.trim()}

`);
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, t) => `
##### ${t.trim()}

`);
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, t) => `
###### ${t.trim()}

`);
  md = md.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, "**$1**");
  md = md.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, "*$1*");
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, t) => `
\`\`\`
${t.trim()}
\`\`\`
`);
  md = md.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `- ${t.trim()}
`);
  md = md.replace(/<br\s*\/?\s*>/gi, "\n");
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `
${t.trim()}
`);
  md = md.replace(/<\/?[^>]+>/g, "");
  return decodeEntities(md.replace(/\n{3,}/g, "\n\n").trim());
}

// lib/xml.js
var XML_NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\xA0" };
function decodeXML(text) {
  if (!text || !text.includes("&")) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z0-9]+);/g, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return isNaN(code) ? m : String.fromCodePoint(code);
    }
    return XML_NAMED[e.toLowerCase()] || m;
  });
}
function escapeXML(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function findXMLTagEnd(xml, start) {
  let quote = null;
  for (let j = start + 1; j < xml.length; j++) {
    const ch = xml[j];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return j;
    }
  }
  return -1;
}
function tokenizeXML(xml) {
  const tokens = [];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) {
      if (i < n) tokens.push({ type: "text", text: xml.slice(i) });
      break;
    }
    if (lt > i) tokens.push({ type: "text", text: xml.slice(i, lt) });
    if (xml.startsWith("<![CDATA[", lt)) {
      const end2 = xml.indexOf("]]>", lt);
      if (end2 === -1) break;
      tokens.push({ type: "text", text: xml.slice(lt + 9, end2) });
      i = end2 + 3;
      continue;
    }
    if (xml.startsWith("<!--", lt)) {
      const end2 = xml.indexOf("-->", lt);
      if (end2 === -1) break;
      i = end2 + 3;
      continue;
    }
    if (xml.startsWith("<?", lt)) {
      const end2 = xml.indexOf("?>", lt);
      if (end2 === -1) break;
      i = end2 + 2;
      continue;
    }
    if (xml[lt + 1] === "/") {
      const end2 = xml.indexOf(">", lt);
      if (end2 === -1) break;
      tokens.push({ type: "close", name: xml.slice(lt + 2, end2).trim() });
      i = end2 + 1;
      continue;
    }
    const end = findXMLTagEnd(xml, lt);
    if (end === -1) break;
    const raw = xml.slice(lt + 1, end).trim();
    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1).trim() : raw;
    const nameMatch = body.match(/^([^\s/>]+)/);
    const name = nameMatch ? nameMatch[1] : "";
    const rest = body.slice(nameMatch ? nameMatch[0].length : 0);
    const attrs = {};
    const attrRe = /([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'))?/g;
    let m;
    while ((m = attrRe.exec(rest)) !== null) {
      let val = m[2];
      if (val === void 0) val = true;
      else if (val[0] === '"' || val[0] === "'") val = decodeXML(val.slice(1, -1));
      attrs[m[1]] = val;
    }
    tokens.push({ type: "open", name, attrs, selfClosing });
    i = end + 1;
  }
  return tokens;
}
function buildTree2(tokens) {
  const root = { tag: "", attrs: {}, children: [], text: "", parent: null };
  let current = null;
  for (const tok of tokens) {
    if (tok.type === "text") {
      if (current) current.text += tok.text;
      continue;
    }
    if (tok.type === "close") {
      if (current && current.tag === tok.name) {
        current = current.parent;
      } else if (current) {
        while (current && current.tag !== tok.name) current = current.parent;
        if (current) current = current.parent;
      }
      continue;
    }
    const node = { tag: tok.name, attrs: tok.attrs, children: [], text: "", parent: current };
    if (!current) {
      root.children.push(node);
    } else {
      current.children.push(node);
    }
    if (!tok.selfClosing) current = node;
  }
  const roots = root.children;
  return roots.length === 1 ? roots[0] : roots;
}
function parseXML(xml) {
  const source = Buffer.isBuffer(xml) ? xml.toString("utf-8") : String(xml);
  const tree = buildTree2(tokenizeXML(source));
  if (Array.isArray(tree)) {
    const out = {};
    tree.forEach((n, i) => {
      out[`root${i}`] = nodeToObject(n);
    });
    return out;
  }
  return nodeToObject(tree);
}
function parseXMLTree(xml) {
  const source = Buffer.isBuffer(xml) ? xml.toString("utf-8") : String(xml);
  return buildTree2(tokenizeXML(source));
}
function nodeToObject(node) {
  const obj = {};
  if (node.attrs && Object.keys(node.attrs).length) {
    obj.$ = { ...node.attrs };
  }
  const grouped = {};
  for (const child of node.children) {
    if (!grouped[child.tag]) grouped[child.tag] = [];
    grouped[child.tag].push(child);
  }
  for (const [tag, list] of Object.entries(grouped)) {
    obj[tag] = list.length === 1 ? nodeToObject(list[0]) : list.map(nodeToObject);
  }
  const text = node.text ? node.text.trim() : "";
  if (text) obj["#text"] = text;
  return obj;
}
function attrString(attrs) {
  return Object.entries(attrs).map(([k, v]) => ` ${k}="${escapeXML(v)}"`).join("");
}
function nodeToString(node) {
  let out = "";
  for (const [key, value] of Object.entries(node)) {
    if (key === "#text") {
      out += escapeXML(value);
      continue;
    }
    if (key === "$") continue;
    const list = Array.isArray(value) ? value : [value];
    for (const item of list) {
      if (item && typeof item === "object") {
        out += `<${key}${item.$ ? attrString(item.$) : ""}>${nodeToString(item)}</${key}>`;
      } else {
        out += `<${key}>${escapeXML(item ?? "")}</${key}>`;
      }
    }
  }
  return out;
}
function xmlToString(obj, rootName = "root") {
  if (!obj || typeof obj !== "object") return `<${rootName}>${escapeXML(obj ?? "")}</${rootName}>`;
  const attrs = obj.$ ? attrString(obj.$) : "";
  return `<${rootName}${attrs}>${nodeToString(obj)}</${rootName}>`;
}
function pick(value) {
  if (value === null || value === void 0) return null;
  if (typeof value === "object") {
    if (value["#text"] !== void 0) return value["#text"];
    if (value.$ && value.$.value !== void 0) return value.$.value;
    return null;
  }
  return value;
}
function toArray(value) {
  if (value === null || value === void 0) return [];
  return Array.isArray(value) ? value : [value];
}
function parseRSS(xml) {
  var _a;
  const doc = parseXML(xml);
  const channel = ((_a = doc == null ? void 0 : doc.rss) == null ? void 0 : _a.channel) || (doc == null ? void 0 : doc.channel) || {};
  const items = channel.item || [];
  return toArray(items).map((item) => ({
    title: pick(item.title),
    link: pick(item.link),
    description: pick(item.description),
    pubDate: pick(item.pubDate),
    guid: pick(item.guid),
    author: pick(item.author) || pick(item["dc:creator"]),
    categories: toArray(item.category).map(pick)
  }));
}
function linkOf(link) {
  var _a, _b;
  if (Array.isArray(link)) {
    const first = link[0];
    return typeof first === "object" ? ((_a = first.$) == null ? void 0 : _a.href) ?? null : first;
  }
  return typeof link === "object" ? ((_b = link.$) == null ? void 0 : _b.href) ?? null : link;
}
function parseAtom(xml) {
  const doc = parseXML(xml);
  const feed = (doc == null ? void 0 : doc.feed) || doc || {};
  const entries = feed.entry || [];
  return toArray(entries).map((entry) => {
    var _a;
    return {
      title: pick(entry.title),
      link: linkOf(entry.link),
      summary: pick(entry.summary),
      id: pick(entry.id),
      updated: pick(entry.updated),
      author: pick((_a = entry.author) == null ? void 0 : _a.name) || pick(entry.author)
    };
  });
}
function parseSitemap(xml) {
  const doc = parseXML(xml);
  const urlset = (doc == null ? void 0 : doc.urlset) || doc || {};
  if (urlset.url) {
    return toArray(urlset.url).map((u) => ({
      loc: pick(u.loc),
      lastmod: pick(u.lastmod),
      changefreq: pick(u.changefreq),
      priority: pick(u.priority)
    }));
  }
  const index = (doc == null ? void 0 : doc.sitemapindex) || doc || {};
  if (index.sitemap) {
    return toArray(index.sitemap).map((s) => ({ loc: pick(s.loc) }));
  }
  return [];
}

// lib/csv.js
function escapeCSV(value, delimiter) {
  const s = value === null || value === void 0 ? "" : String(value);
  if (s.includes(delimiter) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
function parseCSV(text, options = {}) {
  const { header = true, delimiter = ",", skipEmptyLines = true } = options;
  const source = Buffer.isBuffer(text) ? text.toString("utf-8") : String(text);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (inQuotes) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (skipEmptyLines) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].every((f) => f.trim() === "")) rows.splice(i, 1);
    }
  }
  if (rows.length === 0) return header ? [] : [];
  if (!header) return rows;
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = r[i] ?? null;
    });
    return obj;
  });
}
function toCSV(rows, options = {}) {
  const { header = true, delimiter = "," } = options;
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const isObjects = typeof rows[0] === "object" && rows[0] !== null && !Array.isArray(rows[0]);
  const lines = [];
  let keys = null;
  if (isObjects && header) {
    keys = Object.keys(rows[0]);
    lines.push(keys.map((k) => escapeCSV(k, delimiter)).join(delimiter));
  }
  for (const row of rows) {
    if (isObjects) {
      const k = keys || Object.keys(row);
      lines.push(k.map((key) => escapeCSV(row[key], delimiter)).join(delimiter));
    } else {
      lines.push(row.map((v) => escapeCSV(v, delimiter)).join(delimiter));
    }
  }
  return lines.join("\r\n");
}

// lib/jsonpath.js
function tokenizePath(path) {
  const parts = [];
  let i = 0;
  const n = path.length;
  while (i < n) {
    const c = path[i];
    if (c === ".") {
      i++;
      continue;
    }
    if (c === "[") {
      const end = path.indexOf("]", i);
      if (end === -1) break;
      const inner = path.slice(i + 1, end).trim();
      if (inner === "*") {
        parts.push({ type: "any" });
      } else if (inner[0] === "'" || inner[0] === '"') {
        parts.push({ type: "key", value: inner.slice(1, -1) });
      } else {
        const idx = parseInt(inner, 10);
        parts.push(isNaN(idx) ? { type: "key", value: inner } : { type: "index", value: idx });
      }
      i = end + 1;
      continue;
    }
    if (c === "*") {
      parts.push({ type: "any" });
      i++;
      continue;
    }
    let j = i;
    while (j < n && path[j] !== "." && path[j] !== "[") j++;
    parts.push({ type: "key", value: path.slice(i, j) });
    i = j;
  }
  return parts;
}
function step(nodes, part, next) {
  for (const node of nodes) {
    if (part.type === "any") {
      if (Array.isArray(node)) {
        next.push(...node);
      } else if (node && typeof node === "object") {
        next.push(...Object.values(node));
      }
    } else if (part.type === "index") {
      if (Array.isArray(node)) {
        const idx = part.value < 0 ? node.length + part.value : part.value;
        if (idx >= 0 && idx < node.length) next.push(node[idx]);
      }
    } else if (node && typeof node === "object" && part.value in node) {
      next.push(node[part.value]);
    }
  }
}
function evaluate(nodes, parts, idx) {
  if (idx >= parts.length) return nodes;
  const next = [];
  step(nodes, parts[idx], next);
  if (next.length === 0) return [];
  return evaluate(next, parts, idx + 1);
}
function queryJSON(data, path, fallback) {
  const parts = tokenizePath(String(path));
  if (parts.length === 0) return fallback;
  const results = evaluate([data], parts, 0);
  if (results.length === 0) return fallback;
  return results.length === 1 ? results[0] : results;
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
  instance.parse = (html, selectors, config2 = {}) => parseHTML(html, selectors, config2);
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
    client.config.headers = { ...client.config.headers || {}, ...headers };
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
var index_default = swiftly;
export {
  index_default as default,
  events,
  extractForms,
  extractImages,
  extractJSON,
  extractJsonLd,
  extractLinks,
  extractMeta,
  extractTables,
  extractText,
  htmlToMarkdown,
  parseAtom,
  parseCSV,
  parseHTML,
  parseRSS,
  parseSitemap,
  parseXML,
  parseXMLTree,
  queryJSON,
  sanitizeHtml,
  toCSV,
  xmlToString
};
/**
 * Header Generation Utils
 * @author hiudy
 * @license MIT
 */
/**
 * Utility Functions
 * @author hiudy
 * @license MIT
 */
/**
 * Event System Implementation
 * @author hiudy
 * @license MIT
 */
/**
 * Request/Response Interceptor System
 * @author hiudy
 * @license MIT
 */
/**
 * Rate Limiter Implementation
 * @author hiudy
 * @license MIT
 */
/**
 * Cache System Implementation (v2)
 * @author hiudy
 * @license MIT
 */
/**
 * Connection Pooling (keep-alive Agents)
 * @author hiudy
 * @license MIT
 */
/**
 * Custom Error Classes
 * @author hiudy
 * @license MIT
 */
/**
 * HTTP Client Implementation
 * @author hiudy
 * @license MIT
 */
/**
 * Advanced HTML Scraper — selector engine v2
 *
 * A zero-dependency, lightweight HTML parser + CSS-like selector engine.
 * Supports tag/id/class/attribute selectors, combinators (descendant, child,
 * adjacent, sibling), pseudo-classes (:first/:last/:nth-child/:nth-of-type/
 * :contains/:not/:empty/:has), attribute operators and comma groups.
 *
 * Note: it is intentionally lighter than a full DOM. For very heavy scraping
 * pair Swiftly with a full parser.
 * @author hiudy
 * @license MIT
 */
/**
 * Extraction utilities built on top of the HTML parser.
 * @author hiudy
 * @license MIT
 */
/**
 * Lightweight XML parser + serialization + feed helpers (RSS/Atom/sitemap).
 * Zero dependencies.
 * @author hiudy
 * @license MIT
 */
/**
 * CSV parser & serializer (quotes, embedded delimiters/newlines, CRLF).
 * Zero dependencies.
 * @author hiudy
 * @license MIT
 */
/**
 * JSONPath-style query helper (dot/bracket notation, wildcards, numeric indexes).
 * Zero dependencies.
 * @author hiudy
 * @license MIT
 */
/**
 * Swiftly - Lightweight HTTP client (ESM entry)
 * @author hiudy
 * @license MIT
 */
//# sourceMappingURL=index.mjs.map
