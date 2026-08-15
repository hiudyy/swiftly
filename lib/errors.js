/**
 * Custom Error Classes
 * @author Cognima
 * @license MIT
 */

'use strict';

class SwiftlyError extends Error {
    constructor(message, code, context = {}) {
        super(message);
        this.name = 'SwiftlyError';
        this.code = code;
        this.context = context;
    }
}

class ValidationError extends SwiftlyError {
    constructor(message, context = {}) {
        super(message, 'VALIDATION_ERROR', context);
        this.name = 'ValidationError';
    }
}

class RequestError extends SwiftlyError {
    constructor(message, context = {}) {
        super(message, 'REQUEST_ERROR', context);
        this.name = 'RequestError';
    }
}

class ResponseError extends SwiftlyError {
    constructor(message, response, context = {}) {
        super(message, 'RESPONSE_ERROR', { response, ...context });
        this.name = 'ResponseError';
        this.response = response;
    }
}

class CircuitBreakerError extends SwiftlyError {
    constructor(message, domain, context = {}) {
        super(message, 'CIRCUIT_BREAKER_ERROR', { domain, ...context });
        this.name = 'CircuitBreakerError';
        this.domain = domain;
    }
}

class TimeoutError extends SwiftlyError {
    constructor(message, type, context = {}) {
        super(message, 'TIMEOUT_ERROR', { type, ...context });
        this.name = 'TimeoutError';
        this.type = type;
    }
}

export {
    SwiftlyError,
    ValidationError,
    RequestError,
    ResponseError,
    CircuitBreakerError,
    TimeoutError
};
