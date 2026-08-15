import { describe, it, expect } from 'vitest';
import {
    SwiftlyError,
    ValidationError,
    RequestError,
    ResponseError,
    CircuitBreakerError,
    TimeoutError
} from '../lib/errors.js';

describe('errors', () => {
    it('SwiftlyError carries code and context', () => {
        const e = new SwiftlyError('boom', 'X', { a: 1 });
        expect(e).toBeInstanceOf(Error);
        expect(e.code).toBe('X');
        expect(e.context.a).toBe(1);
        expect(e.name).toBe('SwiftlyError');
    });

    it('ValidationError', () => {
        const e = new ValidationError('bad');
        expect(e).toBeInstanceOf(SwiftlyError);
        expect(e.code).toBe('VALIDATION_ERROR');
        expect(e.name).toBe('ValidationError');
    });

    it('RequestError', () => {
        const e = new RequestError('net', { original: new Error('x') });
        expect(e.code).toBe('REQUEST_ERROR');
        expect(e.context.original).toBeInstanceOf(Error);
    });

    it('ResponseError carries response', () => {
        const resp = { status: 500, data: {} };
        const e = new ResponseError('HTTP Error 500', resp);
        expect(e.code).toBe('RESPONSE_ERROR');
        expect(e.response).toBe(resp);
    });

    it('CircuitBreakerError carries domain', () => {
        const e = new CircuitBreakerError('open', 'api.example.com');
        expect(e.code).toBe('CIRCUIT_BREAKER_ERROR');
        expect(e.domain).toBe('api.example.com');
    });

    it('TimeoutError carries type', () => {
        const e = new TimeoutError('timed out', 'connect');
        expect(e.code).toBe('TIMEOUT_ERROR');
        expect(e.type).toBe('connect');
    });
});