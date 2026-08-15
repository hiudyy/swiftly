/**
 * Event System Implementation
 * @author Cognima
 * @license MIT
 */

'use strict';

class EventEmitter {
    constructor() {
        this.events = new Map();
    }

    on(event, callback) {
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }
        this.events.get(event).push(callback);
        return this; // Para permitir method chaining
    }

    off(event, callback) {
        if (!this.events.has(event)) return this;
        if (!callback) {
            this.events.delete(event);
            return this;
        }
        const callbacks = this.events.get(event).filter(cb => cb !== callback);
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
        
        callbacks.forEach(callback => {
            try {
                callback.apply(null, args);
            } catch (error) {
                hasError = true;
                console.error(`Error in event handler for "${event}":`, error);
                // Emit error event if not already emitting error
                if (event !== 'error') {
                    this.emit('error', error, event);
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
}

export const createEventEmitter = () => new EventEmitter();
export const events = {
    REQUEST_START: 'request:start',
    REQUEST_END: 'request:end',
    REQUEST_ERROR: 'request:error',
    RETRY_ATTEMPT: 'retry:attempt',
    CACHE_HIT: 'cache:hit',
    CACHE_MISS: 'cache:miss',
    CACHE_STORE: 'cache:store',
    CACHE_INVALID: 'cache:invalid',
    RATE_LIMIT: 'rate:limit',
    REDIRECT: 'redirect',
    PROGRESS: 'progress',
    DOWNLOAD_PROGRESS: 'download:progress',
    UPLOAD_PROGRESS: 'upload:progress',
    SOCKET_ASSIGNED: 'socket:assigned',
    ABORT: 'abort',
    PROXY_CONNECT: 'proxy:connect',
    CIRCUIT_OPEN: 'circuit:open',
    CIRCUIT_CLOSE: 'circuit:close',
    CIRCUIT_HALF_OPEN: 'circuit:half-open',
    CIRCUIT_REJECTED: 'circuit:rejected'
};
